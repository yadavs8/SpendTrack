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

    companion object {
        /** A row created this long after its payment is a re-read of an old message (see syncPending). */
        const val REREAD_AFTER_MS = 6L * 60 * 60 * 1000
    }

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

            // Purge any local invalid <= 0 transactions so they never cause constraint errors
            val purged = transactionDao.purgeZeroAmountTransactions()
            if (purged > 0) {
                SafeLogger.i("Purged $purged invalid zero-amount transaction(s) from local database")
            }

            // Rows that turned out to be transfers or were fully refunded: remove them by ref.
            for (gone in transactionDao.getPendingCloudDeletes()) {
                val ref = gone.upiReference ?: gone.bankReference
                if (ref.isNullOrBlank()) {
                    // No ref: remove it by the exact SMS text and time it was synced with. If that can't be
                    // done (an older Kharcha Book without raw_sms), stop trying rather than retry forever.
                    var bySource = withContext(Dispatchers.IO) { syncClient.deleteBySource(token, gone) }
                    if (bySource.isFailure && isUnauthorized(bySource.exceptionOrNull())) {
                        token = refreshAccessToken() ?: return
                        bySource = withContext(Dispatchers.IO) { syncClient.deleteBySource(token, gone) }
                    }
                    if (bySource.isSuccess || gone.rawNotificationText.isNullOrBlank() ||
                        bySource.exceptionOrNull()?.message?.contains("(4") == true) {
                        transactionDao.markCloudDeleted(gone.id)
                    }
                    continue
                }
                var del = withContext(Dispatchers.IO) { syncClient.deleteByRef(token, ref) }
                if (del.isFailure && isUnauthorized(del.exceptionOrNull())) {
                    token = refreshAccessToken() ?: return
                    del = withContext(Dispatchers.IO) { syncClient.deleteByRef(token, ref) }
                }
                if (del.isSuccess) transactionDao.markCloudDeleted(gone.id)
            }

            // Ensure all Lavish Kirana Store expenses live in Family locally and re-sync if they have a ref.
            for (kirana in transactionDao.getUnmovedLavishKiranaExpenses()) {
                val hasRef = !kirana.upiReference.isNullOrBlank() || !kirana.bankReference.isNullOrBlank()
                val familyDesc = com.spendtrack.app.core.model.ExpenseScope.describe(
                    kirana.merchantName, kirana.description, kirana.isEdited, com.spendtrack.app.core.model.ExpenseScope.FAMILY
                )
                transactionDao.updateTransaction(
                    kirana.copy(
                        description = familyDesc,
                        needsReview = false,
                        isEdited = true,
                        syncedToCloud = if (hasRef) false else kirana.syncedToCloud,
                        updatedAt = System.currentTimeMillis()
                    )
                )
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
                val effectiveAmount = Math.round((transaction.amount - transaction.refundedAmount) * 100) / 100.0
                if (transaction.amount <= 0.0 || effectiveAmount <= 0.0) {
                    transactionDao.deleteById(transaction.id)
                    continue
                }

                // An auto-detected income the user already typed in by hand (e.g. "💼 Salary 1")
                // stays on the phone, so the money is never counted twice.
                if (transaction.transactionType == com.spendtrack.app.core.model.TransactionType.INCOME &&
                    isAlreadyLoggedByHand(token, transaction)) {
                    transactionDao.markSynced(transaction.id)
                    continue
                }
                // A row created long after its payment is a re-read of an old message (catch-up after
                // a reinstall/reset). If Kharcha Book already has that payment, its label is the user's
                // -- take it, never overwrite it. (A re-read once replaced two weeks of labels.)
                val ref = (transaction.upiReference ?: transaction.bankReference)?.takeIf { it.isNotBlank() }
                if (ref != null && transaction.createdAt - transaction.dateTime > REREAD_AFTER_MS) {
                    val existing = withContext(Dispatchers.IO) { syncClient.fetchDescriptionByRef(token, ref) }
                    if (existing.isFailure) continue // can't tell yet: try again next sync, don't risk overwriting
                    val cloudDesc = existing.getOrNull()
                    if (cloudDesc != null) {
                        transactionDao.updateTransaction(
                            transaction.copy(description = cloudDesc, isEdited = true, needsReview = false,
                                syncedToCloud = true, updatedAt = System.currentTimeMillis())
                        )
                        continue
                    }
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


    private val SCOPE_MARKS = listOf("🏠", "👤", "📈", "✈", "🔨", "🔁", "💼", "👵")

    /**
     * The Kharcha Book row the user already entered by hand for this payment (same amount, within
     * 36 hours), or null. Rows that came from this phone (same bank/UPI ref) only count once the
     * user has moved them somewhere (Family / Trip / ...), because an untouched push is just the
     * phone's own copy. Hand rows already used by an earlier, answered payment of the same amount
     * are not counted twice.
     */
    suspend fun findHandEntry(txn: com.spendtrack.app.data.database.entity.TransactionEntity): SupabaseSyncClient.CloudRow? {
        val window = 36L * 3600 * 1000
        val rows = fetchCloudRows(txn.dateTime - window, txn.dateTime + window) ?: return null
        val ref = (txn.upiReference ?: txn.bankReference)?.take(40)
        val amount = Math.round((txn.amount - txn.refundedAmount) * 100) / 100.0
        val sameAmount = rows.filter { r ->
            Math.abs(r.amount - amount) < 0.01 && (r.kind == null || r.kind == "expense" || r.kind == "transfer")
        }
        sameAmount.firstOrNull { r -> r.refNo != null && r.refNo == ref && SCOPE_MARKS.any { r.description.trimStart().startsWith(it) } }
            ?.let { return it }
        val byHand = sameAmount.filter { it.refNo == null }
        if (byHand.isEmpty()) return null
        val alreadyUsed = transactionDao.findSameAmountNear(txn.amount, txn.dateTime - window, txn.dateTime + window, txn.id)
            .count { it.syncedToCloud && it.transactionType == com.spendtrack.app.core.model.TransactionType.EXPENSE &&
                it.upiReference.isNullOrBlank() && it.bankReference.isNullOrBlank() }
        if (byHand.size <= alreadyUsed) return null
        return byHand.minByOrNull { Math.abs(it.spentAt - txn.dateTime) }
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
                val signedOut = error is com.spendtrack.app.core.network.AuthRejectedException
                settingsManager.setCloudSyncError(
                    if (signedOut)
                        // Usually a sign-out from Kharcha Book on an old version, which signed out every device.
                        "Signed out of Kharcha Book. Please sign in again here."
                    else
                        "Couldn't reach Kharcha Book (offline?). Will retry automatically."
                )
                // Silence is the worst outcome: payments keep piling up on the phone but never reach Kharcha Book.
                // Say so loudly, at most twice a day.
                if (signedOut && settingsManager.claimAlert("signedout|${System.currentTimeMillis() / (12L * 3600 * 1000)}")) {
                    com.spendtrack.app.data.di.ServiceLocator.contextOrNull()?.let {
                        com.spendtrack.app.core.notification.ExpensePromptNotifier.showSyncProblem(
                            it, "You are signed out, so new payments are NOT reaching Kharcha Book. Open the app, tap ⚙️ > Cloud Sync and sign in again."
                        )
                    }
                }
                null
            }
        )
    }

    private fun isUnauthorized(error: Throwable?): Boolean {
        val message = error?.message ?: return false
        return message.contains("401") || message.contains("JWT")
    }
}
