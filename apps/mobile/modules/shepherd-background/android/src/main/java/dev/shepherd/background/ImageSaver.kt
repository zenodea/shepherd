package dev.shepherd.background

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64

/**
 * Saves an image from a conversation into Pictures/Shepherd, where the
 * gallery finds it. Android 10 and later let an app add its own pictures
 * there without a storage permission.
 */
object ImageSaver {
  fun save(context: Context, base64: String, mime: String, name: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("Saving images needs Android 10 or later.")
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, name)
      put(MediaStore.Images.Media.MIME_TYPE, mime)
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Shepherd")
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Couldn't create the picture.")
    try {
      resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("Couldn't write the picture.")
      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    return uri.toString()
  }
}
