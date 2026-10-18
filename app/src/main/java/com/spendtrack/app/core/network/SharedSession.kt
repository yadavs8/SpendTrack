package com.spendtrack.app.core.network

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * The one Supabase sign-in shared by Kharcha Book (the page inside the app) and the phone's
 * background sync. Kharcha Book's supabase-js keeps its session here (via KharchaNative.auth*Item)
 * instead of the WebView's localStorage, and the sync reads -- and, when it renews it, writes --
 * the same entry. So signing in once in Kharcha Book is all the phone ever needs: no separate
 * Cloud Sync login, and no two copies of a refresh token renewing behind each other's back
 * (which Supabase treats as token reuse and answers by signing both out).
 *
 * Plain SharedPreferences on purpose: the WebView bridge calls are synchronous.
 */
object SharedSession {

    private const val PREFS = "kharcha_shared_auth"
    @Volatile private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs == null) prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    // ---- raw storage, as supabase-js sees it (keys like "sb-<project>-auth-token") ----

    fun getItem(key: String): String? = prefs?.getString(key, null)
    fun setItem(key: String, value: String) { prefs?.edit()?.putString(key, value)?.commit() }
    fun removeItem(key: String) { prefs?.edit()?.remove(key)?.commit() }

    private val authKey: String
        get() = "sb-" + SupabaseConfig.SUPABASE_URL.removePrefix("https://").substringBefore('.') + "-auth-token"

    data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long, val email: String?)

    /** Kharcha Book's current session, or null when it isn't signed in (on this phone). */
    fun current(): Session? {
        val raw = getItem(authKey) ?: return null
        return runCatching {
            val o = JSONObject(raw).let { if (it.has("currentSession")) it.getJSONObject("currentSession") else it }
            val access = o.optString("access_token").takeIf { it.isNotBlank() } ?: return null
            val refresh = o.optString("refresh_token").takeIf { it.isNotBlank() } ?: return null
            Session(access, refresh, o.optLong("expires_at", 0L), o.optJSONObject("user")?.optString("email")?.takeIf { it.isNotBlank() })
        }.getOrNull()
    }

    /**
     * Stores a renewed session (the /token?grant_type=refresh_token response, which has the same
     * shape supabase-js saves), so the page picks the new tokens up on its next check.
     */
    fun saveRenewed(responseJson: String) {
        val o = runCatching { JSONObject(responseJson) }.getOrNull() ?: return
        if (!o.has("expires_at") && o.has("expires_in")) {
            o.put("expires_at", System.currentTimeMillis() / 1000 + o.optLong("expires_in", 3600))
        }
        setItem(authKey, o.toString())
    }
}
