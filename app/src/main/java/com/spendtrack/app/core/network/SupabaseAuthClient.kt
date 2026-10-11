package com.spendtrack.app.core.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/** Supabase answered and refused the credentials (signed out elsewhere, revoked, wrong password). */
class AuthRejectedException(message: String) : IOException(message)

data class SupabaseSession(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String
)

/**
 * Minimal Supabase Auth (GoTrue) REST client: password sign-in and refresh-token renewal.
 * No SDK dependency -- a handful of JSON-over-HTTPS calls over OkHttp.
 */
class SupabaseAuthClient(private val client: OkHttpClient = OkHttpClient()) {

    private val jsonMediaType = "application/json".toMediaType()

    fun signInWithPassword(email: String, password: String): Result<SupabaseSession> {
        val body = JSONObject().apply {
            put("email", email)
            put("password", password)
        }.toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/auth/v1/token?grant_type=password")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Content-Type", "application/json")
            .post(body)
            .build()

        return runCatching {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw IOException(extractErrorMessage(text, response.code))
                }
                parseSession(text)
            }
        }
    }

    fun refreshSession(refreshToken: String): Result<SupabaseSession> {
        val body = JSONObject().apply {
            put("refresh_token", refreshToken)
        }.toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("${SupabaseConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token")
            .addHeader("apikey", SupabaseConfig.SUPABASE_ANON_KEY)
            .addHeader("Content-Type", "application/json")
            .post(body)
            .build()

        return runCatching {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = extractErrorMessage(text, response.code)
                    if (response.code in 400..499) throw AuthRejectedException(message)
                    throw IOException(message)
                }
                parseSession(text)
            }
        }
    }

    private fun parseSession(text: String): SupabaseSession {
        val json = JSONObject(text)
        val user = json.getJSONObject("user")
        return SupabaseSession(
            accessToken = json.getString("access_token"),
            refreshToken = json.getString("refresh_token"),
            userId = user.getString("id"),
            email = user.optString("email", "")
        )
    }

    private fun extractErrorMessage(body: String, code: Int): String {
        return runCatching {
            JSONObject(body).optString("error_description").ifBlank {
                JSONObject(body).optString("msg", "HTTP $code")
            }
        }.getOrDefault("HTTP $code")
    }
}
