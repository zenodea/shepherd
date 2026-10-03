package dev.shepherd.background

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/**
 * The home-screen widget: which agents need you. The app pushes a small
 * summary whenever its agents change; this draws the last one it saved.
 */
class ShepherdWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, render(context))
  }

  companion object {
    private const val PREFS = "shepherd_widget"
    private const val KEY = "summary"
    private val LINES = intArrayOf(R.id.widget_line1, R.id.widget_line2, R.id.widget_line3)
    private val ANSWERS = intArrayOf(R.id.widget_answer1, R.id.widget_answer2)

    /** Save the app's latest summary (JSON) and redraw every widget. */
    fun update(context: Context, json: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ShepherdWidget::class.java))
      if (ids.isEmpty()) return
      val views = render(context)
      for (id in ids) manager.updateAppWidget(id, views)
    }

    private fun color(status: String): Int = when (status) {
      "blocked" -> Color.parseColor("#F97316")
      "working" -> Color.parseColor("#60A5FA")
      "done" -> Color.parseColor("#22C55E")
      else -> Color.parseColor("#A3A3A3")
    }

    private fun render(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.shepherd_widget)
      views.setOnClickPendingIntent(R.id.widget_root, Notifications.openIntent(context, "shepherd://", 9001))
      val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return views
      val summary = try {
        JSONObject(saved)
      } catch (e: Exception) {
        return views
      }
      views.setTextViewText(R.id.widget_title, summary.optString("title", "Shepherd"))
      views.setTextViewText(R.id.widget_summary, summary.optString("summary", ""))
      // The summary takes the colour of the most urgent state: orange when an agent needs you.
      val tone = summary.optString("tone", "idle")
      views.setTextColor(R.id.widget_summary, if (tone == "idle") Color.parseColor("#FAFAFA") else color(tone))
      val at = summary.optLong("at", 0L)
      views.setTextViewText(R.id.widget_updated, if (at > 0) DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at)) else "")
      val ask = summary.optJSONObject("ask")
      renderAsk(context, views, ask)
      val lines = summary.optJSONArray("lines")
      // With a question showing, one agent line fits: the one asking.
      val shown = if (ask != null) 1 else LINES.size
      LINES.forEachIndexed { index, viewId ->
        val line = if (index < shown) lines?.optJSONObject(index) else null
        if (line == null) {
          views.setViewVisibility(viewId, View.GONE)
        } else {
          views.setViewVisibility(viewId, View.VISIBLE)
          views.setTextViewText(viewId, "●  " + line.optString("text"))
          views.setTextColor(viewId, color(line.optString("status")))
          // Tapping an agent opens it, its question and answers included.
          val url = line.optString("url")
          if (url.isNotEmpty()) views.setOnClickPendingIntent(viewId, Notifications.openIntent(context, url, 9100 + index))
        }
      }
      return views
    }

    private fun renderAsk(context: Context, views: RemoteViews, ask: JSONObject?) {
      val answers = ask?.optJSONArray("answers")
      if (ask == null || answers == null || answers.length() == 0) {
        views.setViewVisibility(R.id.widget_ask, View.GONE)
        return
      }
      views.setViewVisibility(R.id.widget_ask, View.VISIBLE)
      views.setTextViewText(R.id.widget_question, ask.optString("question"))
      val id = ask.optInt("notificationId")
      val paneId = ask.optString("paneId")
      val url = ask.optString("url", "shepherd://")
      ANSWERS.forEachIndexed { index, viewId ->
        val answer = answers.optJSONObject(index)
        if (answer == null) {
          views.setViewVisibility(viewId, View.GONE)
        } else {
          val label = answer.optString("label")
          views.setViewVisibility(viewId, View.VISIBLE)
          views.setTextViewText(viewId, label)
          views.setOnClickPendingIntent(viewId, Notifications.answerIntent(context, id, paneId, url, answer.optString("key"), label, 9200 + index))
        }
      }
    }
  }
}
