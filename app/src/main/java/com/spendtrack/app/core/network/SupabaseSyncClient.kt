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
     * A note the user explicitly typed into the categorize prompt (isEdited = true, description
     * overwritten with their answer) wins -- that's a deliberate correction. Otherwise the
     * normalized merchant name. Falls back to whatever's in `description` (raw notification/SMS
     * text for never-reviewed transactions) only as a last resort.
     */
    private fun buildDescription(transaction: TransactionEntity): String {
        val note = transaction.description?.takeIf { it.isNotBlank() }
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        val best = if (transaction.isEdited && note != null) note else (merchant ?: note) ?: "Expense"
        return best.take(60)
    }
}
