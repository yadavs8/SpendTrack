package com.spendtrack.app.data.repository

import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.network.SupabaseAuthClient
import com.spendtrack.app.core.network.SupabaseSyncClient
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.datastore.SettingsManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * One-time-linked, otherwise invisible sync of resolved expenses into the same Supabase
 * `daily_expenses` table the Kharcha Book web app reads. SpendTrack does the detecting and
 * categorizing in the background; Kharcha Book stays the only app the user actually opens.
 *
 * Signing in once (Settings -> Cloud Sync) with the Kharcha Book account's email/password scopes
 * every write by Row Level Security, exactly like the web app.
 */
class CloudSyncRepository(
    private val transactionDao: TransactionDao,
    private val settingsManager: SettingsManager,
    private val authClient: SupabaseAuthClient = SupabaseAuthClient(),
    private val syncClient: SupabaseSyncClient = SupabaseSyncClient()
) {
    private val syncMutex = Mutex()

    suspend fun signIn(email: String, password: String): Result<Unit> {
        val result = withContext(Dispatchers.IO) { authClient.signInWithPassword(email, password) }
        return result.fold(
            onSuccess = { session ->
                settingsManager.saveCloudSyncSession(session.email, session.accessToken, session.refreshToken)
                Result.success(Unit)
            },
            onFailure = { error -> Result.failure(error) }
        )
    }

    suspend fun signOut() {
        settingsManager.clearCloudSyncSession()
    }

    /**
     * Pushes every resolved-but-unsynced expense (see TransactionDao.getUnsyncedExpenses --
     * excludes anything still `needsReview`). Safe to call after every ingest, after a categorize
     * prompt is answered, and from a manual "Sync Now" button: it's a no-op when Cloud Sync is
     * off, not signed in, or there's nothing ready to send.
     */
    suspend fun syncPending() {
        if (!settingsManager.isCloudSyncEnabled.first()) return
        val accessToken = settingsManager.cloudSyncAccessToken.first() ?: return

        syncMutex.withLock {
            var token = accessToken

            // Rows that turned out to be transfers or were fully refunded: remove them by ref.
            for (gone in transactionDao.getPendingCloudDeletes()) {
                val ref = gone.upiReference ?: gone.bankReference
                if (ref.isNullOrBlank()) { transactionDao.markCloudDeleted(gone.id); continue }
                var del = withContext(Dispatchers.IO) { syncClient.deleteByRef(token, ref) }
                if (del.isFailure && isUnauthorized(del.exceptionOrNull())) {
                    token = refreshAccessToken() ?: return
                    del = withContext(Dispatchers.IO) { syncClient.deleteByRef(token, ref) }
                }
                if (del.isSuccess) transactionDao.markCloudDeleted(gone.id)
            }

            val pending = transactionDao.getUnsyncedExpenses()
            if (pending.isEmpty()) {
                // Nothing left to send is itself a successful sync (e.g. right after a fresh
                // install, before this phone has anything new to push) -- record it as one, so
                // the settings screen doesn't keep showing "Not synced yet" forever.
                settingsManager.setCloudSyncError(null)
                settingsManager.setCloudSyncLastSuccessAt(System.currentTimeMillis())
                return
            }

            for (transaction in pending) {
                // An auto-detected income the user already typed in by hand (e.g. "💼 Salary 1")
                // stays on the phone, so the money is never counted twice.
                if (transaction.transactionType == com.spendtrack.app.core.model.TransactionType.INCOME &&
                    isAlreadyLoggedByHand(token, transaction)) {
                    transactionDao.markSynced(transaction.id)
                    continue
                }
                var result = withContext(Dispatchers.IO) { syncClient.upsertExpense(token, transaction) }

                if (result.isFailure && isUnauthorized(result.exceptionOrNull())) {
                    token = refreshAccessToken() ?: break
                    result = withContext(Dispatchers.IO) { syncClient.upsertExpense(token, transaction) }
                }

                result.fold(
                    onSuccess = {
                        transactionDao.markSynced(transaction.id)
                        settingsManager.setCloudSyncLastSuccessAt(System.currentTimeMillis())
                        settingsManager.setCloudSyncError(null)
                    },
                    onFailure = { error ->
                        SafeLogger.e("Cloud sync failed for transaction ${transaction.id}", error as? Exception)
                        settingsManager.setCloudSyncError(error.message ?: "Sync failed")
                        // Keep going -- one bad row shouldn't block the rest of the batch.
                    }
                )
            }
        }
    }

    /**
     * Pulls the shared settings (trips, active trip, owner identity...) the web app edits.
     * Server wins for keys it has; keys only this phone knows are kept and pushed back. A no-op when
     * signed out, offline, or before the kharcha_settings table exists.
     */
    suspend fun refreshSharedSettings() {
        if (!settingsManager.isCloudSyncEnabled.first()) return
        val server = withFreshToken { token -> syncClient.fetchSettings(token) }?.getOrNull()
        val local = settingsManager.sharedSettingsFlow.first()
        if (server == null) {
            if (local.length() > 0) pushSharedSettings(local)
            return
        }
        var hadLocalOnly = false
        local.keys().forEach { key ->
            if (!server.has(key)) { server.put(key, local.get(key)); hadLocalOnly = true }
        }
        settingsManager.replaceShared(server)
        if (hadLocalOnly) pushSharedSettings(server)
    }

    suspend fun pushSharedSettings(doc: org.json.JSONObject) {
        if (!settingsManager.isCloudSyncEnabled.first()) return
        val result = withFreshToken { token -> syncClient.pushSettings(token, doc) }
        result?.exceptionOrNull()?.let { SafeLogger.e("Settings push failed", it as? Exception) }
    }

    /** Runs a Supabase call, refreshing an expired session once. Null when not signed in. */
    private suspend fun <T> withFreshToken(call: (String) -> Result<T>): Result<T>? {
        val token = settingsManager.cloudSyncAccessToken.first() ?: return null
        var result = withContext(Dispatchers.IO) { call(token) }
        if (result.isFailure && isUnauthorized(result.exceptionOrNull())) {
            val fresh = refreshAccessToken() ?: return result
            result = withContext(Dispatchers.IO) { call(fresh) }
        }
        return result
    }

    private suspend fun isAlreadyLoggedByHand(token: String, income: com.spendtrack.app.data.database.entity.TransactionEntity): Boolean {
        val window = 3L * 24 * 3600 * 1000
        val rows = withContext(Dispatchers.IO) { syncClient.fetchRows(token, income.dateTime - window, income.dateTime + window) }.getOrNull()
            ?: return false
        return rows.any { r ->
            r.refNo == null && Math.abs(r.amount - income.amount) < 0.01 && KharchaRules.isIncome(r.description, r.kind)
        }
    }

    /** Signed-in access token, refreshed if needed; null when Cloud Sync is off or signed out. */
    suspend fun freshToken(): String? {
        if (!settingsManager.isCloudSyncEnabled.first()) return null
        val token = settingsManager.cloudSyncAccessToken.first() ?: return null
        val probe = withContext(Dispatchers.IO) { syncClient.fetchRows(token, 0L, 1L) }
        if (probe.isFailure && isUnauthorized(probe.exceptionOrNull())) return refreshAccessToken()
        return token
    }

    /** The user's Kharcha Book rows in [from, to), for automations (budgets, summaries, settle-up). */
    suspend fun fetchCloudRows(from: Long, to: Long): List<SupabaseSyncClient.CloudRow>? {
        val token = freshToken() ?: return null
        return withContext(Dispatchers.IO) { syncClient.fetchRows(token, from, to) }.getOrNull()
    }

    private suspend fun refreshAccessToken(): String? {
        val refreshToken = settingsManager.cloudSyncRefreshToken.first() ?: return null
        val result = withContext(Dispatchers.IO) { authClient.refreshSession(refreshToken) }
        return result.fold(
            onSuccess = { session ->
                settingsManager.updateCloudSyncAccessToken(session.accessToken, session.refreshToken)
                session.accessToken
            },
            onFailure = { error ->
                settingsManager.setCloudSyncError(
                    if (error is com.spendtrack.app.core.network.AuthRejectedException)
                        // Usually a sign-out from Kharcha Book on an old version, which signed out every device.
                        "Signed out of Kharcha Book. Please sign in again here."
                    else
                        "Couldn't reach Kharcha Book (offline?). Will retry automatically."
                )
                null
            }
        )
    }

    private fun isUnauthorized(error: Throwable?): Boolean {
        val message = error?.message ?: return false
        return message.contains("401") || message.contains("JWT")
    }
}
