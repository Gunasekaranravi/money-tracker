package expo.modules.smsreader

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsPermissionException :
  CodedException("ERR_SMS_PERMISSION", "READ_SMS permission is not granted", null)

class SmsReaderModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    // Returns inbox messages newer than `sinceMs` (epoch millis), newest first, at most `limit`.
    AsyncFunction("getMessages") { sinceMs: Double, limit: Int ->
      val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
        PackageManager.PERMISSION_GRANTED
      if (!granted) throw SmsPermissionException()

      val results = mutableListOf<Map<String, Any?>>()
      val cursor = context.contentResolver.query(
        Uri.parse("content://sms/inbox"),
        arrayOf("_id", "address", "body", "date"),
        "date > ?",
        arrayOf(sinceMs.toLong().toString()),
        "date DESC"
      )
      cursor?.use {
        val idIdx = it.getColumnIndexOrThrow("_id")
        val addrIdx = it.getColumnIndexOrThrow("address")
        val bodyIdx = it.getColumnIndexOrThrow("body")
        val dateIdx = it.getColumnIndexOrThrow("date")
        while (it.moveToNext() && results.size < limit) {
          results.add(
            mapOf(
              "id" to it.getString(idIdx),
              "address" to it.getString(addrIdx),
              "body" to it.getString(bodyIdx),
              "date" to it.getLong(dateIdx).toDouble()
            )
          )
        }
      }
      results
    }
  }
}
