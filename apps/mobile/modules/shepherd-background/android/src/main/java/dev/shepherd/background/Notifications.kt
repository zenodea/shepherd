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
    answers.forEachIndexed { index, answer ->
      val intent = Intent(context, ActionReceiver::class.java)
        .putExtra(ActionReceiver.EXTRA_NOTIFICATION_ID, id)
        .putExtra(ActionReceiver.EXTRA_PANE_ID, paneId)
        .putExtra(ActionReceiver.EXTRA_KEY, answer.key)
        .putExtra(ActionReceiver.EXTRA_LABEL, answer.label)
        .putExtra(ActionReceiver.EXTRA_URL, url)
      // A distinct request code per button, so the extras aren't shared between them.
      val pending = PendingIntent.getBroadcast(context, id * 8 + index + 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(0, answer.label, pending)
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
