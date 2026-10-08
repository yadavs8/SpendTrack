package com.spendtrack.app.core.network

import com.spendtrack.app.data.database.entity.TransactionEntity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Pushes a resolved expense (real description already known -- not still `needsReview`) to the
 * `daily_expenses` table the Kharcha Book web app reads. Uses PostgREST upsert
 * (`Prefer: resolution=merge-duplicates`) on the (user_id, ref_no) unique index from
 * supabase/daily_expenses_v2_sms.sql, so re-sending the same transaction is a no-op.
 */
class SupabaseSyncClient(private val client: OkHttpClient = OkHttpClient()) {

    private val jsonMediaType = "application/json".toMediaType()
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun upsertExpense(accessToken: String, transaction: TransactionEntity): Result<Unit> {
        val refNo = (transaction.upiReference ?: transaction.bankReference)?.take(40)
        val description = buildDescription(transaction)
        val rawSms = transaction.rawNotificationText?.take(500)

        val row = JSONObject().apply {
            put("amount", transaction.amount)
            put("description", description)
            put("spent_at", isoFormat.format(Date(transaction.dateTime)))
            if (refNo != null) put("ref_no", refNo)
            if (rawSms != null) put("raw_sms", rawSms)
        }
        // user_id defaults server-side to auth.uid() -- never send it explicitly.

        val payload = JSONArray().put(row).toString().toRequestBody(jsonMediaType)

        val url = buildString {
            append("${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses")
            if (refNo != null) append("?on_conflict=user_id,ref_no")
        }

        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
            .post(payload)
            .build()

        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val body = response.body?.string().orEmpty()
                    throw IOException("Sync failed (${response.code}): $body")
                }
            }
        }
    }

    /**
     * Reads the shared settings document (kharcha_settings.data) the web app also uses.
     * Success(null) = no row yet, or the table hasn't been created (v4 SQL not run) -- callers then
     * keep using the local copy.
     */
    fun fetchSettings(accessToken: String): Result<JSONObject?> {
        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/rest/v1/kharcha_settings?select=data")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .get()
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.code == 404 || body.contains("PGRST205") || body.contains("42P01")) return@use null
                if (!response.isSuccessful) throw IOException("Settings fetch failed (${response.code}): $body")
                val rows = JSONArray(body)
                if (rows.length() == 0) null else rows.getJSONObject(0).optJSONObject("data") ?: JSONObject()
            }
        }
    }

    /** Writes the whole shared settings document (one row per user, keyed by user_id). */
    fun pushSettings(accessToken: String, data: JSONObject): Result<Unit> {
        val payload = JSONArray().put(JSONObject().put("data", data)).toString().toRequestBody(jsonMediaType)
        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/rest/v1/kharcha_settings?on_conflict=user_id")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
            .post(payload)
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.code == 404 || body.contains("PGRST205") || body.contains("42P01")) return@use
                if (!response.isSuccessful) throw IOException("Settings push failed (${response.code}): $body")
            }
        }
    }

    /**
     * A user-edited description (Personal/Family answer or typed note) wins. Otherwise the merchant
     * name -- never an unedited `description`, which for auto-detected expenses is the raw bank SMS
     * (account digits and all).
     */
    private fun buildDescription(transaction: TransactionEntity): String {
        val edited = transaction.description?.takeIf { transaction.isEdited && it.isNotBlank() }
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        return (edited ?: merchant ?: "Expense").take(60)
    }
}
