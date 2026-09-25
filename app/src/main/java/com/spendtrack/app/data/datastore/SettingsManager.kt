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
        val KEY_ONBOARDING_COMPLETE = booleanPreferencesKey("onboarding_complete")

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

    val isOnboardingComplete: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_ONBOARDING_COMPLETE] ?: false
    }

    suspend fun setOnboardingComplete(complete: Boolean) {
        context.dataStore.edit { it[KEY_ONBOARDING_COMPLETE] = complete }
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
