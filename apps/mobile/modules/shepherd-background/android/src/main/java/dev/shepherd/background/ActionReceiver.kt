package dev.shepherd.background

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/**
 * An answer button was pressed. The app answers over its open connection;
 * if its JavaScript isn't running, the notification asks for a tap instead.
 */
class ActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
    if (intent.action == ACTION_DISMISSED) {
      ShepherdBackgroundModule.emitDismissed(id)
      return
    }
    val paneId = intent.getStringExtra(EXTRA_PANE_ID) ?: return
    val key = intent.getStringExtra(EXTRA_KEY) ?: return
    val label = intent.getStringExtra(EXTRA_LABEL) ?: key
    val url = intent.getStringExtra(EXTRA_URL) ?: "shepherd://"
    // A typed reply, from the notification's Reply box.
    val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifications.REMOTE_INPUT_KEY)?.toString()
    if (!ShepherdBackgroundModule.emitAnswer(id, paneId, key, label, reply)) {
      // Android doesn't let a button open the app from here, so ask for a tap instead.
      val what = if (reply != null) "your reply" else "“$label”"
      Notifications.show(context, id, Notifications.CHANNEL_INPUT, "Open Shepherd to answer", "Shepherd wasn't running, so $what wasn't sent.", url, paneId, emptyList(), 0)
    }
  }

  companion object {
    const val EXTRA_NOTIFICATION_ID = "notificationId"
    const val EXTRA_PANE_ID = "paneId"
    const val EXTRA_KEY = "key"
    const val EXTRA_LABEL = "label"
    const val EXTRA_URL = "url"
    const val ACTION_DISMISSED = "dev.shepherd.background.DISMISSED"
  }
}
