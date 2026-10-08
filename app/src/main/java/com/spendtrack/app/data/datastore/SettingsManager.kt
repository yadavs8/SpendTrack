package com.spendtrack.app.data.datastore

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore(name = "spendtrack_settings")

class SettingsManager(private val context: Context) {

    companion object {
        val KEY_MONITORED_APPS = stringSetPreferencesKey("monitored_apps")
        val KEY_NOTIFICATION_ENABLED = booleanPreferencesKey("notification_enabled")
        val KEY_SMS_ENABLED = booleanPreferencesKey("sms_enabled")
        val KEY_MONTHLY_BUDGET = doublePreferencesKey("monthly_budget")
        val KEY_DAILY_LIMIT = doublePreferencesKey("daily_limit")
        val KEY_DAILY_LIMIT_ALERT = booleanPreferencesKey("daily_limit_alert")
        val KEY_BIOMETRIC_LOCK = booleanPreferencesKey("biometric_lock")
        val KEY_DARK_MODE = stringPreferencesKey("dark_mode") // "SYSTEM", "LIGHT", "DARK"
        val KEY_CONFIRMATION_NOTIFS = booleanPreferencesKey("confirmation_notifications")
        val KEY_ONBOARDED = booleanPreferencesKey("onboarded")

        // Cloud Sync: one-time link to the Kharcha Book Supabase account
        val KEY_CLOUD_SYNC_ENABLED = booleanPreferencesKey("cloud_sync_enabled")
        val KEY_CLOUD_SYNC_EMAIL = stringPreferencesKey("cloud_sync_email")
        val KEY_CLOUD_SYNC_ACCESS_TOKEN = stringPreferencesKey("cloud_sync_access_token")
        val KEY_CLOUD_SYNC_REFRESH_TOKEN = stringPreferencesKey("cloud_sync_refresh_token")
        val KEY_CLOUD_SYNC_LAST_ERROR = stringPreferencesKey("cloud_sync_last_error")
        val KEY_CLOUD_SYNC_LAST_SUCCESS_AT = stringPreferencesKey("cloud_sync_last_success_at")

        // Legacy phone-only active trip (before settings were shared with the web app)
        val KEY_ACTIVE_TRIP_NAME = stringPreferencesKey("active_trip_name")

        // Copy of the shared settings document (Supabase kharcha_settings.data). Keys and string
        // values are exactly what the web app uses, e.g. "kharcha_active_trip_name".
        val KEY_SHARED_SETTINGS_JSON = stringPreferencesKey("shared_settings_json")
        const val SHARED_ACTIVE_TRIP = "kharcha_active_trip_name"
        const val SHARED_ALL_TRIPS = "kharcha_all_trips_list"
        const val SHARED_OWNER_IDENTITY = "kharcha_owner_identity"

        // Last month summary the web page reported (JSON) -- what the home-screen widget shows.
        val KEY_WEB_SUMMARY = stringPreferencesKey("web_month_summary")

        val DEFAULT_MONITORED_APPS = setOf(
            "com.google.android.apps.nbu.paisa.user", // Google Pay
            "com.phonepe.app",                       // PhonePe
            "net.one97.paytm",                       // Paytm
            "in.org.npci.upiapp",                    // BHIM
            "com.dreamplug.androidapp"               // CRED
        )
    }

    val sharedSettingsFlow: Flow<JSONObject> = context.dataStore.data.map { prefs ->
        parseJson(prefs[KEY_SHARED_SETTINGS_JSON])
    }

    val activeTripNameFlow: Flow<String?> = context.dataStore.data.map { prefs ->
        val shared = parseJson(prefs[KEY_SHARED_SETTINGS_JSON])
        if (shared.has(SHARED_ACTIVE_TRIP)) shared.optStringOrNull(SHARED_ACTIVE_TRIP)
        else prefs[KEY_ACTIVE_TRIP_NAME]?.takeIf { it.isNotBlank() }
    }

    /** Every trip the user has created (web or phone), active one first. */
    val tripNamesFlow: Flow<List<String>> = context.dataStore.data.map { prefs ->
        val shared = parseJson(prefs[KEY_SHARED_SETTINGS_JSON])
        val active = if (shared.has(SHARED_ACTIVE_TRIP)) shared.optStringOrNull(SHARED_ACTIVE_TRIP)
            else prefs[KEY_ACTIVE_TRIP_NAME]?.takeIf { it.isNotBlank() }
        val saved = runCatching {
            val arr = JSONArray(shared.optStringOrNull(SHARED_ALL_TRIPS) ?: "[]")
            (0 until arr.length()).mapNotNull { arr.optString(it).trim().takeIf { t -> t.isNotBlank() } }
        }.getOrDefault(emptyList())
        (listOfNotNull(active) + saved).distinct()
    }

    /** The user's own full name(s) and UPI ID(s), used to recognise self-transfers. */
    val ownerIdentityFlow: Flow<String> = context.dataStore.data.map { prefs ->
        parseJson(prefs[KEY_SHARED_SETTINGS_JSON]).optStringOrNull(SHARED_OWNER_IDENTITY) ?: ""
    }

    /** Applies a change to the shared document and returns the new version (to push to Supabase). */
    suspend fun updateShared(change: (JSONObject) -> Unit): JSONObject {
        var updated = JSONObject()
        context.dataStore.edit { prefs ->
            val doc = parseJson(prefs[KEY_SHARED_SETTINGS_JSON])
            change(doc)
            prefs[KEY_SHARED_SETTINGS_JSON] = doc.toString()
            updated = doc
        }
        return updated
    }

    /** Replaces the local copy with the server's document (server wins). */
    suspend fun replaceShared(doc: JSONObject) {
        context.dataStore.edit { it[KEY_SHARED_SETTINGS_JSON] = doc.toString() }
    }

    val webSummaryFlow: Flow<JSONObject> = context.dataStore.data.map { prefs -> parseJson(prefs[KEY_WEB_SUMMARY]) }

    suspend fun saveWebSummary(json: String) {
        val parsed = runCatching { JSONObject(json) }.getOrNull() ?: return
        context.dataStore.edit { it[KEY_WEB_SUMMARY] = parsed.toString() }
    }

    private fun parseJson(raw: String?): JSONObject =
        runCatching { JSONObject(raw ?: "{}") }.getOrDefault(JSONObject())

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotBlank() }

    val monitoredAppsFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[KEY_MONITORED_APPS] ?: DEFAULT_MONITORED_APPS
    }

    val isSmsDetectionEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_SMS_ENABLED] ?: false
    }

    val monthlyBudgetFlow: Flow<Double> = context.dataStore.data.map { prefs ->
        prefs[KEY_MONTHLY_BUDGET] ?: 0.0
    }

    val dailyLimitFlow: Flow<Double> = context.dataStore.data.map { prefs ->
        prefs[KEY_DAILY_LIMIT] ?: 0.0
    }

    val isDailyLimitAlertEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_DAILY_LIMIT_ALERT] ?: false
    }

    val isBiometricEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_BIOMETRIC_LOCK] ?: false
    }

    val showConfirmationNotifs: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_CONFIRMATION_NOTIFS] ?: true
    }

    val darkModeFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_DARK_MODE] ?: "SYSTEM"
    }

    val isOnboarded: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_ONBOARDED] ?: false
    }

    suspend fun setOnboarded() {
        context.dataStore.edit { it[KEY_ONBOARDED] = true }
    }

    val isCloudSyncEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_CLOUD_SYNC_ENABLED] ?: false
    }

    val cloudSyncEmail: Flow<String?> = context.dataStore.data.map { prefs -> prefs[KEY_CLOUD_SYNC_EMAIL] }

    val cloudSyncAccessToken: Flow<String?> = context.dataStore.data.map { prefs -> prefs[KEY_CLOUD_SYNC_ACCESS_TOKEN] }

    val cloudSyncRefreshToken: Flow<String?> = context.dataStore.data.map { prefs -> prefs[KEY_CLOUD_SYNC_REFRESH_TOKEN] }

    val cloudSyncLastError: Flow<String?> = context.dataStore.data.map { prefs -> prefs[KEY_CLOUD_SYNC_LAST_ERROR] }

    val cloudSyncLastSuccessAt: Flow<Long?> = context.dataStore.data.map { prefs ->
        prefs[KEY_CLOUD_SYNC_LAST_SUCCESS_AT]?.toLongOrNull()
    }

    suspend fun saveCloudSyncSession(email: String, accessToken: String, refreshToken: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_CLOUD_SYNC_EMAIL] = email
            prefs[KEY_CLOUD_SYNC_ACCESS_TOKEN] = accessToken
            prefs[KEY_CLOUD_SYNC_REFRESH_TOKEN] = refreshToken
            prefs[KEY_CLOUD_SYNC_ENABLED] = true
            prefs.remove(KEY_CLOUD_SYNC_LAST_ERROR)
        }
    }

    suspend fun updateCloudSyncAccessToken(accessToken: String, refreshToken: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_CLOUD_SYNC_ACCESS_TOKEN] = accessToken
            prefs[KEY_CLOUD_SYNC_REFRESH_TOKEN] = refreshToken
        }
    }

    suspend fun setCloudSyncEnabled(enabled: Boolean) {
        context.dataStore.edit { it[KEY_CLOUD_SYNC_ENABLED] = enabled }
    }

    suspend fun setCloudSyncError(message: String?) {
        context.dataStore.edit { prefs ->
            if (message == null) prefs.remove(KEY_CLOUD_SYNC_LAST_ERROR) else prefs[KEY_CLOUD_SYNC_LAST_ERROR] = message
        }
    }

    suspend fun setCloudSyncLastSuccessAt(timestamp: Long) {
        context.dataStore.edit { it[KEY_CLOUD_SYNC_LAST_SUCCESS_AT] = timestamp.toString() }
    }

    /** Sets (or clears) the active trip in the shared document; returns it for pushing to Supabase. */
    suspend fun setActiveTripName(tripName: String?): JSONObject {
        context.dataStore.edit { it.remove(KEY_ACTIVE_TRIP_NAME) }
        return updateShared { doc ->
            if (tripName.isNullOrBlank()) doc.put(SHARED_ACTIVE_TRIP, JSONObject.NULL)
            else {
                doc.put(SHARED_ACTIVE_TRIP, tripName.trim())
                addTripTo(doc, tripName.trim())
            }
        }
    }

    /** Adds a trip to the shared trip list without making it active. */
    suspend fun addTrip(tripName: String): JSONObject = updateShared { addTripTo(it, tripName.trim()) }

    private fun addTripTo(doc: JSONObject, name: String) {
        if (name.isBlank()) return
        val arr = runCatching { JSONArray(doc.optStringOrNull(SHARED_ALL_TRIPS) ?: "[]") }.getOrDefault(JSONArray())
        val existing = (0 until arr.length()).map { arr.optString(it).trim() }
        if (name !in existing) arr.put(name)
        // The web app stores every value as a string, so the list is a JSON-encoded string.
        doc.put(SHARED_ALL_TRIPS, arr.toString())
    }

    suspend fun setOwnerIdentity(value: String): JSONObject =
        updateShared { it.put(SHARED_OWNER_IDENTITY, value.trim()) }

    suspend fun clearCloudSyncSession() {
        context.dataStore.edit { prefs ->
            prefs.remove(KEY_CLOUD_SYNC_EMAIL)
            prefs.remove(KEY_CLOUD_SYNC_ACCESS_TOKEN)
            prefs.remove(KEY_CLOUD_SYNC_REFRESH_TOKEN)
            prefs.remove(KEY_CLOUD_SYNC_LAST_ERROR)
            prefs[KEY_CLOUD_SYNC_ENABLED] = false
        }
    }

    suspend fun setMonitoredApp(packageName: String, enabled: Boolean) {
        context.dataStore.edit { prefs ->
            val current = prefs[KEY_MONITORED_APPS]?.toMutableSet() ?: DEFAULT_MONITORED_APPS.toMutableSet()
            if (enabled) {
                current.add(packageName)
            } else {
                current.remove(packageName)
            }
            prefs[KEY_MONITORED_APPS] = current
        }
    }

    suspend fun setSmsDetection(enabled: Boolean) {
        context.dataStore.edit { it[KEY_SMS_ENABLED] = enabled }
    }

    suspend fun setMonthlyBudget(amount: Double) {
        context.dataStore.edit { it[KEY_MONTHLY_BUDGET] = amount }
    }

    suspend fun setDailyLimit(amount: Double, enableAlert: Boolean) {
        context.dataStore.edit {
            it[KEY_DAILY_LIMIT] = amount
            it[KEY_DAILY_LIMIT_ALERT] = enableAlert
        }
    }

    suspend fun setBiometricLock(enabled: Boolean) {
        context.dataStore.edit { it[KEY_BIOMETRIC_LOCK] = enabled }
    }

    suspend fun setConfirmationNotifs(enabled: Boolean) {
        context.dataStore.edit { it[KEY_CONFIRMATION_NOTIFS] = enabled }
    }

    suspend fun setDarkMode(mode: String) {
        context.dataStore.edit { it[KEY_DARK_MODE] = mode }
    }
}
