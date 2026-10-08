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

    /**
     * method / account_last4 / bank / kind come from supabase/kharcha_v5_money_types.sql. Until that
     * runs, the first push fails with "column not found" and this switches them off for the session.
     */
    @Volatile var hasMoneyTypeColumns = true

    fun upsertExpense(accessToken: String, transaction: TransactionEntity): Result<Unit> {
        val first = upsertOnce(accessToken, transaction, hasMoneyTypeColumns)
        val err = first.exceptionOrNull()?.message.orEmpty()
        if (hasMoneyTypeColumns && first.isFailure && isMissingColumn(err)) {
            hasMoneyTypeColumns = false
            return upsertOnce(accessToken, transaction, false)
        }
        return first
    }

    private fun isMissingColumn(message: String): Boolean =
        message.contains("PGRST204") || message.contains("42703") || Regex("(?i)could not find the '.*' column").containsMatchIn(message)

    private fun upsertOnce(accessToken: String, transaction: TransactionEntity, withTypes: Boolean): Result<Unit> {
        val refNo = (transaction.upiReference ?: transaction.bankReference)?.take(40)
        val description = buildDescription(transaction)
        val rawSms = transaction.rawNotificationText?.take(500)
        // A partly refunded expense shows what was really spent.
        val amount = Math.round((transaction.amount - transaction.refundedAmount) * 100) / 100.0

        val row = JSONObject().apply {
            put("amount", amount)
            put("description", description)
            put("spent_at", isoFormat.format(Date(transaction.dateTime)))
            if (refNo != null) put("ref_no", refNo)
            if (rawSms != null) put("raw_sms", rawSms)
            if (withTypes) {
                put("kind", transaction.transactionType.kindCode)
                put("method", transaction.paymentMethod.code)
                transaction.accountLast4?.takeIf { it.isNotBlank() }?.let { put("account_last4", it.take(6)) }
                transaction.bankName?.takeIf { it.isNotBlank() }?.let { put("bank", it.take(40)) }
            }
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
     * Removes a row that no longer belongs in Kharcha Book (became a transfer, or fully refunded).
     * Only by ref_no -- never by guessing -- so nothing the user typed in can be deleted.
     */
    fun deleteByRef(accessToken: String, refNo: String): Result<Unit> {
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?ref_no=eq.${java.net.URLEncoder.encode(refNo, "UTF-8")}"
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Prefer", "return=minimal")
            .delete()
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Delete failed (${response.code}): ${response.body?.string().orEmpty()}")
            }
        }
    }

    /** A row of the user's Kharcha Book, as the automations need it. */
    data class CloudRow(val amount: Double, val description: String, val spentAt: Long, val refNo: String?, val kind: String?, val method: String?)

    /**
     * The user's rows between two instants (RLS limits it to their own). Used by budget alerts,
     * the weekly summary and the settle-up reminder, so they see web-typed entries too.
     */
    fun fetchRows(accessToken: String, fromMillis: Long, toMillis: Long): Result<List<CloudRow>> {
        val cols = if (hasMoneyTypeColumns) "amount,description,spent_at,ref_no,kind,method" else "amount,description,spent_at,ref_no"
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?select=$cols" +
            "&spent_at=gte.${enc(isoFormat.format(Date(fromMillis)))}&spent_at=lt.${enc(isoFormat.format(Date(toMillis)))}&order=spent_at.asc&limit=5000"
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .get()
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    if (hasMoneyTypeColumns && isMissingColumn(body)) {
                        hasMoneyTypeColumns = false
                        return@use fetchRows(accessToken, fromMillis, toMillis).getOrThrow()
                    }
                    throw IOException("Fetch failed (${response.code}): $body")
                }
                val arr = JSONArray(body)
                (0 until arr.length()).map { i ->
                    val o = arr.getJSONObject(i)
                    CloudRow(
                        amount = o.optDouble("amount", 0.0),
                        description = o.optString("description", ""),
                        spentAt = parseIso(o.optString("spent_at")),
                        refNo = o.optString("ref_no").takeIf { !o.isNull("ref_no") && it.isNotBlank() },
                        kind = o.optString("kind").takeIf { !o.isNull("kind") && it.isNotBlank() },
                        method = o.optString("method").takeIf { !o.isNull("method") && it.isNotBlank() }
                    )
                }
            }
        }
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    private fun parseIso(s: String?): Long {
        if (s.isNullOrBlank()) return 0L
        return runCatching { java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli() }
            .recoverCatching { java.time.Instant.parse(s).toEpochMilli() }
            .getOrDefault(0L)
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
