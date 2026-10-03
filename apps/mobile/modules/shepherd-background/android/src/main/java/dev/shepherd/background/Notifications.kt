package dev.shepherd.background

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput

/** One answer button: the herdr key that picks it, and its label. */
data class AnswerButton(val key: String, val label: String)

/** Shepherd's notification channels, and building its notifications. */
object Notifications {
  /** "claude needs input": loud. */
  const val CHANNEL_INPUT = "input"
  /** "claude finished": a normal notification. */
  const val CHANNEL_FINISHED = "finished"
  /** The permanent "connected" notification of the background service: silent. */
  const val CHANNEL_CONNECTION = "connection"
  /** Where a typed reply comes back in the action's intent. */
  const val REMOTE_INPUT_KEY = "reply"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannels(
      listOf(
        NotificationChannel(CHANNEL_INPUT, "Agents that need you", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "When an agent asks a question, with its answers as buttons"
        },
        NotificationChannel(CHANNEL_FINISHED, "Agents that finished", NotificationManager.IMPORTANCE_DEFAULT),
        NotificationChannel(CHANNEL_CONNECTION, "Connection to your computer", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Shepherd stays connected in the background"
          setShowBadge(false)
        },
      ),
    )
  }

  /** Opens `url` (a shepherd:// link) in the app. */
  fun openIntent(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun connection(context: Context, title: String, text: String): android.app.Notification =
    NotificationCompat.Builder(context, CHANNEL_CONNECTION)
      .setSmallIcon(R.drawable.shepherd_notification_icon)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      // Shows when it last changed, so it's clear the connection is live.
      .setShowWhen(true)
      .setWhen(System.currentTimeMillis())
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(openIntent(context, "shepherd://", 0))
      .build()

  private fun actionIntent(context: Context, id: Int, paneId: String, url: String, key: String, label: String): Intent =
    Intent(context, ActionReceiver::class.java)
      .putExtra(ActionReceiver.EXTRA_NOTIFICATION_ID, id)
      .putExtra(ActionReceiver.EXTRA_PANE_ID, paneId)
      .putExtra(ActionReceiver.EXTRA_KEY, key)
      .putExtra(ActionReceiver.EXTRA_LABEL, label)
      .putExtra(ActionReceiver.EXTRA_URL, url)

  fun show(
    context: Context,
    id: Int,
    channel: String,
    title: String,
    body: String,
    url: String,
    paneId: String,
    answers: List<AnswerButton>,
    timeoutMs: Long,
    /** A "Reply" box that sends text to the agent; its hint, e.g. "Message claude…". Null for none. */
    replyHint: String? = null,
    /** App lock is on: keep the content private and ask for the fingerprint before an answer is sent. */
    requireAuth: Boolean = false,
  ) {
    ensureChannels(context)
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.shepherd_notification_icon)
      .setContentTitle(title)
      .setContentText(body.lineSequence().firstOrNull() ?: body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(openIntent(context, url, id))
      .setPriority(if (channel == CHANNEL_INPUT) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(if (channel == CHANNEL_INPUT) NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
    if (timeoutMs > 0) builder.setTimeoutAfter(timeoutMs)
    // On the lock screen: everything, so it can be answered there, unless App
    // lock is on; then Android's "sensitive content" setting decides.
    builder.setVisibility(if (requireAuth) NotificationCompat.VISIBILITY_PRIVATE else NotificationCompat.VISIBILITY_PUBLIC)
    answers.forEachIndexed { index, answer ->
      val intent = actionIntent(context, id, paneId, url, answer.key, answer.label)
      // A distinct request code per button, so the extras aren't shared between them.
      val pending = PendingIntent.getBroadcast(context, id * 8 + index + 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(
        NotificationCompat.Action.Builder(0, answer.label, pending)
          .setAuthenticationRequired(requireAuth)
          .build(),
      )
    }
    if (replyHint != null) {
      val input = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(replyHint).build()
      // Android fills the typed text into this intent, so it has to be mutable.
      val pending = PendingIntent.getBroadcast(
        context,
        id * 8 + 7,
        actionIntent(context, id, paneId, url, "", "Reply"),
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(
        NotificationCompat.Action.Builder(0, "Reply", pending)
          .addRemoteInput(input)
          .setAllowGeneratedReplies(false)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .setAuthenticationRequired(requireAuth)
          .build(),
      )
    }
    val manager = NotificationManagerCompat.from(context)
    if (manager.areNotificationsEnabled()) {
      try {
        manager.notify(id, builder.build())
      } catch (e: SecurityException) {
        // The notification permission was revoked in the meantime.
      }
    }
  }
}
