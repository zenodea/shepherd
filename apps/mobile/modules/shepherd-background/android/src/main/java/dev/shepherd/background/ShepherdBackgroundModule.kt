package dev.shepherd.background

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class Answer : Record {
  @Field val key: String = ""
  @Field val label: String = ""
}

class AgentNotification : Record {
  @Field val id: Int = 0
  /** "input" or "finished". */
  @Field val channel: String = Notifications.CHANNEL_INPUT
  @Field val title: String = ""
  @Field val body: String = ""
  /** Where a tap goes, e.g. shepherd://agent/w1%3Ap1?host=… */
  @Field val url: String = "shepherd://"
  @Field val paneId: String = ""
  @Field val answers: List<Answer> = emptyList()
  /** Remove it after this long; 0 keeps it. */
  @Field val timeoutMs: Long = 0
  /** Hint for a Reply box that sends text to the agent; empty for none. */
  @Field val replyHint: String = ""
  /** App lock is on: private on the lock screen, fingerprint before answering. */
  @Field val requireAuth: Boolean = false
}

/**
 * Background connection and notifications, without any push service: a
 * foreground service keeps the app running, a headless JS task keeps its
 * timers running, and the app posts its own notifications.
 */
class ShepherdBackgroundModule : Module() {
  private var keepAliveTask: Int? = null
  // A tick from Android's main thread, which keeps running in the background
  // even when React Native pauses JS timers: JS checks its connection on it.
  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      sendEvent("onTick", bundleOf())
      handler.postDelayed(this, TICK_MS)
    }
  }
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ShepherdBackground")

    Events("onAnswer", "onTick")

    OnCreate { current = this@ShepherdBackgroundModule }
    OnDestroy {
      handler.removeCallbacks(tick)
      if (current === this@ShepherdBackgroundModule) current = null
    }

    AsyncFunction("start") { title: String, text: String ->
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
      handler.removeCallbacks(tick)
      handler.postDelayed(tick, TICK_MS)
      // React Native pauses JS timers in the background unless a headless task is running.
      val react = context as? ReactContext
      if (keepAliveTask == null && react != null) {
        keepAliveTask = HeadlessJsTaskContext.getInstance(react)
          .startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("update") { title: String, text: String ->
      val manager = NotificationManagerCompat.from(context)
      if (manager.areNotificationsEnabled()) {
        try {
          manager.notify(KeepAliveService.NOTIFICATION_ID, Notifications.connection(context, title, text))
        } catch (e: SecurityException) {
        }
      }
    }

    AsyncFunction("stop") {
      handler.removeCallbacks(tick)
      val react = context as? ReactContext
      keepAliveTask?.let { task -> react?.let { HeadlessJsTaskContext.getInstance(it).finishTask(task) } }
      keepAliveTask = null
      context.stopService(Intent(context, KeepAliveService::class.java))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("notify") { notification: AgentNotification ->
      Notifications.show(
        context,
        notification.id,
        notification.channel,
        notification.title,
        notification.body,
        notification.url,
        notification.paneId,
        notification.answers.map { AnswerButton(it.key, it.label) },
        notification.timeoutMs,
        notification.replyHint.ifEmpty { null },
        notification.requireAuth,
      )
    }

    AsyncFunction("cancel") { id: Int ->
      NotificationManagerCompat.from(context).cancel(id)
    }

    Function("notificationsEnabled") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  companion object {
    /** Registered in JS with AppRegistry.registerHeadlessTask; never finishes until stop(). */
    const val KEEP_ALIVE_TASK = "ShepherdKeepAlive"
    const val TICK_MS = 15_000L

    @Volatile private var current: ShepherdBackgroundModule? = null

    /** Hand a pressed answer button, or a typed reply, to JS. False when the app's JS isn't running. */
    fun emitAnswer(notificationId: Int, paneId: String, key: String, label: String, reply: String?): Boolean {
      val module = current ?: return false
      module.sendEvent(
        "onAnswer",
        bundleOf("notificationId" to notificationId, "paneId" to paneId, "key" to key, "label" to label, "reply" to reply),
      )
      return true
    }
  }
}
