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
  /**
   * Agents' notifications and the permanent one each have a group of their own: left
   * ungrouped, Android (16, One UI 8) bundles all of an app's notifications under one
   * card, here the permanent one, and the agents' ones don't show.
   */
  const val GROUP_AGENTS = "dev.shepherd.agents"
  const val GROUP_CONNECTION = "dev.shepherd.connection"
  /** The agents group's summary: with one, Android keeps the group as it is instead of bundling it itself. */
  const val SUMMARY_ID = 4202

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
      .setGroup(GROUP_CONNECTION)
      .setContentIntent(openIntent(context, "shepherd://", 0))
      .build()

  private fun actionIntent(context: Context, id: Int, paneId: String, url: String, key: String, label: String): Intent =
    Intent(context, ActionReceiver::class.java)
      .putExtra(ActionReceiver.EXTRA_NOTIFICATION_ID, id)
      .putExtra(ActionReceiver.EXTRA_PANE_ID, paneId)
      .putExtra(ActionReceiver.EXTRA_KEY, key)
      .putExtra(ActionReceiver.EXTRA_LABEL, label)
      .putExtra(ActionReceiver.EXTRA_URL, url)

  /** Sends an answer the same way a notification button does: through ActionReceiver, checked by the app. */
  fun answerIntent(context: Context, id: Int, paneId: String, url: String, key: String, label: String, requestCode: Int): PendingIntent =
    PendingIntent.getBroadcast(context, requestCode, actionIntent(context, id, paneId, url, key, label), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

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
    /** A Reply box that sends text to the agent; its hint, e.g. "Message claude…". Null for none. */
    replyHint: String? = null,
    /** The answer the reply is for ("Type something."): its key and label. Empty key: a new message. */
    replyKey: String = "",
    replyLabel: String = "Reply",
    /** Unlock (fingerprint or screen lock) before an answer from the lock screen is sent. */
    requireAuth: Boolean = false,
    /** Hide the content on the lock screen (App lock); Android's "sensitive content" setting decides. */
    privateContent: Boolean = false,
  ): String {
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
      .setGroup(GROUP_AGENTS)
    if (timeoutMs > 0) builder.setTimeoutAfter(timeoutMs)
    // Tells the app when Android or you dismiss it (not when the app removes it), to find what's removing them.
    builder.setDeleteIntent(
      PendingIntent.getBroadcast(
        context,
        id * 8 + 6,
        Intent(context, ActionReceiver::class.java).setAction(ActionReceiver.ACTION_DISMISSED).putExtra(ActionReceiver.EXTRA_NOTIFICATION_ID, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      ),
    )
    builder.setVisibility(if (privateContent) NotificationCompat.VISIBILITY_PRIVATE else NotificationCompat.VISIBILITY_PUBLIC)
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
        actionIntent(context, id, paneId, url, replyKey, replyLabel),
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      builder.addAction(
        NotificationCompat.Action.Builder(0, replyLabel, pending)
          .addRemoteInput(input)
          .setAllowGeneratedReplies(false)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .setAuthenticationRequired(requireAuth)
          .build(),
      )
    }
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return "not shown: notifications are off for Shepherd (${state(context, channel)})"
    try {
      manager.notify(id, builder.build())
      manager.notify(SUMMARY_ID, summary(context))
    } catch (e: SecurityException) {
      return "not shown: ${e.message} (${state(context, channel)})"
    }
    // Whether Android lists it as showing: notify() gives no other sign when it drops one.
    val showing = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
      context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.id == id }
    return "${if (showing) "showing" else "posted, but Android doesn't list it as showing"} (${state(context, channel)})"
  }

  private fun summary(context: Context): android.app.Notification =
    NotificationCompat.Builder(context, CHANNEL_FINISHED)
      .setSmallIcon(R.drawable.shepherd_notification_icon)
      .setContentTitle("Shepherd")
      .setGroup(GROUP_AGENTS)
      .setGroupSummary(true)
      // The agents' own notifications make the sound, not this.
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setSilent(true)
      .setAutoCancel(true)
      .setContentIntent(openIntent(context, "shepherd://", SUMMARY_ID))
      .build()

  /** Whether Android still lists this notification as showing. */
  fun isShowing(context: Context, id: Int): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
      context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.id == id }

  /** Remove one; and the group's summary once no agent's notification is left. */
  fun cancel(context: Context, id: Int) {
    val manager = NotificationManagerCompat.from(context)
    manager.cancel(id)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val left = context.getSystemService(NotificationManager::class.java).activeNotifications
        .any { it.notification.group == GROUP_AGENTS && it.id != SUMMARY_ID }
      if (!left) manager.cancel(SUMMARY_ID)
    }
  }

  /** What decides whether a notification shows: the app's switch, the permission, the category's importance, Do Not Disturb. */
  fun state(context: Context, channel: String): String {
    val manager = context.getSystemService(NotificationManager::class.java)
    val permission = Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val importance = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.getNotificationChannel(channel)?.importance else null
    // Every Shepherd notification Android holds: id, category, group, and whether it's a bundle's summary.
    val active = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      manager.activeNotifications.joinToString(" ") { "${it.id}/${it.notification.channelId}/${it.notification.group ?: "-"}${if (it.notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY != 0) "/summary" else ""}" }
    } else ""
    return "enabled=${manager.areNotificationsEnabled()} permission=$permission channel=$channel importance=$importance dnd=${manager.currentInterruptionFilter} active=[$active]"
  }
}
