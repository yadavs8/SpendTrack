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

    /** The row as Kharcha Book stores it; null for an amount that is fully refunded (nothing to send). */
    private fun rowJson(transaction: TransactionEntity, description: String, withTypes: Boolean): JSONObject? {
        val refNo = (transaction.upiReference ?: transaction.bankReference)?.take(40)
        val rawSms = transaction.rawNotificationText?.take(500)
        // A partly refunded expense shows what was really spent.
        val amount = Math.round((transaction.amount - transaction.refundedAmount) * 100) / 100.0
        if (amount <= 0.0) return null
        return JSONObject().apply {
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
    }

    private fun upsertOnce(accessToken: String, transaction: TransactionEntity, withTypes: Boolean): Result<Unit> {
        val refNo = (transaction.upiReference ?: transaction.bankReference)?.take(40)
        val row = rowJson(transaction, buildDescription(transaction), withTypes)
            ?: return Result.success(Unit) // Do not send invalid <= 0 amounts to Supabase
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
     * v139: puts a payment that is still waiting for its "Personal / Family / Trip?" answer into Kharcha Book,
     * as "⏳ <payee>". Returns the row's id (to update it in place once answered). A row Kharcha Book already
     * has for the same bank/UPI ref is left exactly as it is, and its id is returned.
     */
    fun insertUnsorted(accessToken: String, transaction: TransactionEntity, description: String): Result<String?> {
        val first = insertUnsortedOnce(accessToken, transaction, description, hasMoneyTypeColumns)
        if (hasMoneyTypeColumns && first.isFailure && isMissingColumn(first.exceptionOrNull()?.message.orEmpty())) {
            hasMoneyTypeColumns = false
            return insertUnsortedOnce(accessToken, transaction, description, false)
        }
        return first
    }

    private fun insertUnsortedOnce(accessToken: String, transaction: TransactionEntity, description: String, withTypes: Boolean): Result<String?> {
        val refNo = (transaction.upiReference ?: transaction.bankReference)?.take(40)
        val row = rowJson(transaction, description, withTypes) ?: return Result.success(null)
        val url = buildString {
            append("${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?select=id")
            if (refNo != null) append("&on_conflict=user_id,ref_no")
        }
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", if (refNo != null) "resolution=ignore-duplicates,return=representation" else "return=representation")
            .post(JSONArray().put(row).toString().toRequestBody(jsonMediaType))
            .build()
        return runCatching {
            val id = client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw IOException("Sync failed (${response.code}): $body")
                val arr = runCatching { JSONArray(body) }.getOrNull()
                if (arr != null && arr.length() > 0) arr.getJSONObject(0).optString("id").takeIf { it.isNotBlank() } else null
            }
            // Nothing new was added: Kharcha Book already has this ref. Use that row.
            id ?: refNo?.let { fetchIdByRef(accessToken, it).getOrThrow() }
                ?: throw IOException("Sync failed: no row id came back")
        }
    }

    /** The id of the row with this bank/UPI ref, or null when there is none. */
    fun fetchIdByRef(accessToken: String, refNo: String): Result<String?> {
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?select=id&limit=1&ref_no=eq.${enc(refNo)}"
        val request = Request.Builder().url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .get().build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw IOException("Lookup failed (${response.code}): $body")
                val arr = JSONArray(body)
                if (arr.length() == 0) null else arr.getJSONObject(0).optString("id").takeIf { it.isNotBlank() }
            }
        }
    }

    /**
     * v139: the answered payment rewrites the row it was pushed as (by id). Ok(false) when that row is gone
     * (the user deleted it in Kharcha Book). A clash with another row's ref fails with "(409)".
     */
    fun updateById(accessToken: String, id: String, transaction: TransactionEntity): Result<Boolean> {
        val first = updateByIdOnce(accessToken, id, transaction, hasMoneyTypeColumns)
        if (hasMoneyTypeColumns && first.isFailure && isMissingColumn(first.exceptionOrNull()?.message.orEmpty())) {
            hasMoneyTypeColumns = false
            return updateByIdOnce(accessToken, id, transaction, false)
        }
        return first
    }

    private fun updateByIdOnce(accessToken: String, id: String, transaction: TransactionEntity, withTypes: Boolean): Result<Boolean> {
        val row = rowJson(transaction, buildDescription(transaction), withTypes) ?: return Result.success(true)
        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?id=eq.${enc(id)}&select=id")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=representation")
            .patch(row.toString().toRequestBody(jsonMediaType))
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw IOException("Sync failed (${response.code}): $body")
                runCatching { JSONArray(body).length() > 0 }.getOrDefault(true)
            }
        }
    }

    /** The description Kharcha Book already has for this bank/UPI ref, or null when it has no such row. */
    fun fetchDescriptionByRef(accessToken: String, refNo: String): Result<String?> {
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?select=description&limit=1&ref_no=eq.${java.net.URLEncoder.encode(refNo, "UTF-8")}"
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .get()
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw IOException("Lookup failed (${response.code}): $body")
                val arr = JSONArray(body)
                if (arr.length() == 0) null else arr.getJSONObject(0).optString("description").takeIf { it.isNotBlank() }
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

    /**
     * Removes a phone-synced row that has no ref (a duplicate copy, or "not a payment"), matched on the
     * exact SMS text *and* time it was synced with -- both written by this app, so a row the user typed
     * in (no raw_sms) can never match.
     */
    fun deleteBySource(accessToken: String, transaction: TransactionEntity): Result<Unit> {
        val rawSms = transaction.rawNotificationText?.take(500)?.takeIf { it.isNotBlank() }
            ?: return Result.failure(IOException("No source text to match"))
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses" +
            "?raw_sms=eq.${enc(rawSms)}&spent_at=eq.${enc(isoFormat.format(Date(transaction.dateTime)))}&ref_no=is.null"
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
    data class CloudRow(val amount: Double, val description: String, val spentAt: Long, val refNo: String?, val kind: String?, val method: String?, val id: String? = null)

    /**
     * The user's rows between two instants (RLS limits it to their own). Used by budget alerts,
     * the weekly summary and the settle-up reminder, so they see web-typed entries too.
     */
    fun fetchRows(accessToken: String, fromMillis: Long, toMillis: Long): Result<List<CloudRow>> {
        val cols = if (hasMoneyTypeColumns) "id,amount,description,spent_at,ref_no,kind,method" else "id,amount,description,spent_at,ref_no"
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
                        method = o.optString("method").takeIf { !o.isNull("method") && it.isNotBlank() },
                        id = o.optString("id").takeIf { !o.isNull("id") && it.isNotBlank() }
                    )
                }
            }
        }
    }

    /** A Kharcha Book row a refund might belong to (with its id and original SMS, for matching). */
    data class RefundCandidate(val id: String, val amount: Double, val description: String, val rawSms: String?, val spentAt: Long, val kind: String?)

    /** Spends in [from, to) that a refund could be matched against. */
    fun fetchRefundCandidates(accessToken: String, fromMillis: Long, toMillis: Long): Result<List<RefundCandidate>> {
        val kindCol = if (hasMoneyTypeColumns) ",kind" else ""
        val url = "${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?select=id,amount,description,raw_sms,spent_at$kindCol" +
            "&spent_at=gte.${enc(isoFormat.format(Date(fromMillis)))}&spent_at=lt.${enc(isoFormat.format(Date(toMillis)))}&order=spent_at.desc&limit=2000"
        val request = Request.Builder().url(url)
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .get().build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw IOException("Fetch failed (${response.code}): $body")
                val arr = JSONArray(body)
                (0 until arr.length()).map { i ->
                    val o = arr.getJSONObject(i)
                    RefundCandidate(
                        id = o.getString("id"),
                        amount = o.optDouble("amount", 0.0),
                        description = o.optString("description", ""),
                        rawSms = o.optString("raw_sms").takeIf { !o.isNull("raw_sms") && it.isNotBlank() },
                        spentAt = parseIso(o.optString("spent_at")),
                        kind = o.optString("kind").takeIf { !o.isNull("kind") && it.isNotBlank() }
                    )
                }
            }
        }
    }

    /** Lowers a row's amount after a partial refund (and notes it in the description). */
    fun updateAmountById(accessToken: String, id: String, amount: Double, description: String): Result<Unit> {
        val body = JSONObject().put("amount", amount).put("description", description.take(60)).toString().toRequestBody(jsonMediaType)
        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?id=eq.${enc(id)}")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "return=minimal")
            .patch(body).build()
        return runCatching {
            client.newCall(request).execute().use { r -> if (!r.isSuccessful) throw IOException("Update failed (${r.code}): ${r.body?.string().orEmpty()}") }
        }
    }

    /** Removes a row that was fully refunded. */
    fun deleteById(accessToken: String, id: String): Result<Unit> {
        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/rest/v1/daily_expenses?id=eq.${enc(id)}")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("Prefer", "return=minimal")
            .delete().build()
        return runCatching {
            client.newCall(request).execute().use { r -> if (!r.isSuccessful) throw IOException("Delete failed (${r.code}): ${r.body?.string().orEmpty()}") }
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
