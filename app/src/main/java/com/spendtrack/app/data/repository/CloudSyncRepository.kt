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
            val pending = transactionDao.getUnsyncedExpenses()
            if (pending.isEmpty()) return

            for (transaction in pending) {
                var result = withContext(Dispatchers.IO) { syncClient.upsertExpense(token, transaction) }

                if (result.isFailure && isUnauthorized(result.exceptionOrNull())) {
                    token = refreshAccessToken() ?: break
                    result = withContext(Dispatchers.IO) { syncClient.upsertExpense(token, transaction) }
                }

                result.fold(
                    onSuccess = {
                        transactionDao.markSynced(transaction.id)
                        settingsManager.setCloudSyncLastSuccessAt(System.currentTimeMillis())
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

    private suspend fun refreshAccessToken(): String? {
        val refreshToken = settingsManager.cloudSyncRefreshToken.first() ?: return null
        val result = withContext(Dispatchers.IO) { authClient.refreshSession(refreshToken) }
        return result.fold(
            onSuccess = { session ->
                settingsManager.updateCloudSyncAccessToken(session.accessToken, session.refreshToken)
                session.accessToken
            },
            onFailure = {
                settingsManager.setCloudSyncError("Session expired. Please sign in again.")
                null
            }
        )
    }

    private fun isUnauthorized(error: Throwable?): Boolean {
        val message = error?.message ?: return false
        return message.contains("401") || message.contains("JWT")
    }
}
