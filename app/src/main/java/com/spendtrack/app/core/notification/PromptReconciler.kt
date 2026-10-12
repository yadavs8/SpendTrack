package com.spendtrack.app.core.notification

import android.content.Context
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.withTimeoutOrNull

/**
 * "Where should this go?" is only asked for payments nobody has answered. If the user already
 * entered the payment in Kharcha Book -- under Family, Personal, a trip... -- the prompt is wrong:
 * this finds that entry, adopts its description, and clears the notification and its reminders.
 */
object PromptReconciler {

    /** Checks one payment. True when it was already entered and has been resolved. */
    suspend fun resolveIfEnteredByHand(context: Context, transactionId: String): Boolean {
        val repo = ServiceLocator.transactionRepository
        val txn = repo.getTransactionById(transactionId) ?: return false
        if (!txn.needsReview || txn.isExcluded) return false
        val row = withTimeoutOrNull(6000) {
            runCatching { ServiceLocator.cloudSyncRepository.findHandEntry(txn) }.getOrNull()
        } ?: return false
        repo.adoptCloudEntry(transactionId, row.description)
        NudgeScheduler.cancel(context, transactionId)
        ExpensePromptNotifier.dismiss(context, transactionId)
        SafeLogger.i("Prompt $transactionId resolved from an entry already in Kharcha Book")
        return true
    }

    /** Checks every unanswered payment from the last two weeks. Returns how many were resolved. */
    suspend fun reconcileAll(context: Context): Int {
        var n = 0
        for (t in ServiceLocator.transactionRepository.getRecentUnanswered()) {
            if (runCatching { resolveIfEnteredByHand(context, t.id) }.getOrDefault(false)) n++
        }
        return n
    }

    /** Clears prompts and reminders for payments that were just paired into an own-account transfer. */
    fun clearPaired(context: Context) {
        ServiceLocator.transactionRepository.drainPairedIds().forEach { id ->
            NudgeScheduler.cancel(context, id)
            ExpensePromptNotifier.dismiss(context, id)
        }
    }
}
