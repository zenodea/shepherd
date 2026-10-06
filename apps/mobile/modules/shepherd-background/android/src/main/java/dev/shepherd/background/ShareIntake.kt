package dev.shepherd.background

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import java.io.File

/**
 * What another app shared to Shepherd from its share sheet: text, a link or
 * images. Images are copied into the app's cache right away, because the
 * permission to read another app's content:// URI can end with the activity
 * that received it.
 */
object ShareIntake {
  private const val HANDLED = "dev.shepherd.share.handled"
  private const val MAX_IMAGES = 10
  private const val KEEP_MS = 24 * 60 * 60_000L

  fun isShare(intent: Intent?): Boolean =
    intent != null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)

  /** A share not handed to JS yet: not reopened from recents, and not taken before (the intent is marked). */
  fun isNew(intent: Intent?): Boolean =
    isShare(intent) &&
      intent!!.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0 &&
      !intent.getBooleanExtra(HANDLED, false)

  fun markHandled(intent: Intent) {
    intent.putExtra(HANDLED, true)
  }

  /** { text, subject, images: file:// URIs, failed: images that couldn't be read }, or null when there's nothing. */
  fun read(context: Context, intent: Intent): Map<String, Any?>? {
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
    val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()?.takeIf { it.isNotBlank() }
    // Other files (a .txt, a PDF) aren't for agents; only images are kept.
    val streams = streams(intent).mapNotNull { uri -> mimeOf(context, intent, uri)?.takeIf { it.startsWith("image/") }?.let { uri to it } }
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    cleanUp(dir)
    var failed = 0
    val images = streams.take(MAX_IMAGES).mapIndexedNotNull { i, (uri, mime) ->
      copyImage(context, uri, mime, dir, i).also { if (it == null) failed++ }
    }
    if (text == null && subject == null && images.isEmpty() && failed == 0) return null
    return mapOf("text" to text, "subject" to subject, "images" to images, "failed" to failed)
  }

  /** Base64 of an image copied by `read`; nothing outside its folder. */
  fun readBase64(context: Context, uri: String): String {
    val dir = File(context.cacheDir, "shared").canonicalFile
    val file = File(Uri.parse(uri).path ?: "").canonicalFile
    if (file.parentFile != dir) throw IllegalArgumentException("Not a shared image.")
    return Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
  }

  private fun streams(intent: Intent): List<Uri> {
    val list = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { list += it }
    } else {
      IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { list += it }
    }
    // Some apps only put them in the clip data.
    if (list.isEmpty()) {
      val clip = intent.clipData
      if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { list += it }
    }
    return list.distinct()
  }

  private fun mimeOf(context: Context, intent: Intent, uri: Uri): String? {
    val known = try {
      context.contentResolver.getType(uri)
    } catch (e: Exception) {
      null
    }
    return known
      ?: MimeTypeMap.getFileExtensionFromUrl(uri.toString())?.lowercase()?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
      ?: intent.type
  }

  private fun copyImage(context: Context, uri: Uri, mime: String, dir: File, index: Int): String? {
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
    val file = File(dir, "${System.currentTimeMillis()}-$index.$ext")
    return try {
      context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: return null
      Uri.fromFile(file).toString()
    } catch (e: Exception) {
      file.delete()
      null
    }
  }

  /** Shares from more than a day ago have been sent or dropped. */
  private fun cleanUp(dir: File) {
    val cutoff = System.currentTimeMillis() - KEEP_MS
    dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
  }
}
