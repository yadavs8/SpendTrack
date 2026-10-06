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

        val DEFAULT_MONITORED_APPS = setOf(
            "com.google.android.apps.nbu.paisa.user", // Google Pay
            "com.phonepe.app",                       // PhonePe
            "net.one97.paytm",                       // Paytm
            "in.org.npci.upiapp",                    // BHIM
            "com.dreamplug.androidapp"               // CRED
        )
    }

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
