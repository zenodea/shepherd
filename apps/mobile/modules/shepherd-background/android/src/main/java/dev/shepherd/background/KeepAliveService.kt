package dev.shepherd.background

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat

/**
 * Keeps the app's process, and with it the connection to the computer,
 * alive in the background. Android requires the permanent notification.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Notifications.ensureChannels(this)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Shepherd"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Connected"
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, Notifications.connection(this, title, text), type)
    // Not sticky: a restart without the app's JavaScript would have no connection to keep.
    return START_NOT_STICKY
  }

  companion object {
    const val NOTIFICATION_ID = 4201
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
  }
}
