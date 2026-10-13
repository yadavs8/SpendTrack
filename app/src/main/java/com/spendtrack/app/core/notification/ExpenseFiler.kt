package com.spendtrack.app.core.notification

import android.content.Context
import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.flow.first

/**
 * Files an auto-detected expense where the user chose -- from a notification button or the
 * "Log to…" picker -- and tidies up: reminders stop, prompts for duplicate copies of the same
 * payment disappear, the prompt turns into "✅ Logged…", and it syncs to Kharcha Book with its
 * original date and time.
 */
object ExpenseFiler {

    suspend fun file(context: Context, transactionId: String, scope: String, tripName: String? = null, note: String? = null) {
        // Stop the prompt notification and its scheduled reminders immediately
        NudgeScheduler.cancel(context, transactionId)
        ExpensePromptNotifier.dismiss(context, transactionId)

        val repo = ServiceLocator.transactionRepository
        if (!note.isNullOrBlank()) repo.resolveNeedsReview(transactionId = transactionId, note = note.trim())
        val duplicateIds = repo.resolveScope(transactionId = transactionId, scope = scope, tripName = tripName)

        duplicateIds.forEach { id ->
            NudgeScheduler.cancel(context, id)
            ExpensePromptNotifier.dismiss(context, id)
        }

        val updatedTxn = repo.getTransactionById(transactionId)
        val effectiveTripName = tripName?.trim()?.takeIf { it.isNotBlank() } ?: run {
            val d = updatedTxn?.description?.trim().orEmpty()
            if (d.startsWith("✈")) d.removePrefix("✈️").removePrefix("✈").substringBefore(':').trim().takeIf { it.isNotBlank() && !it.equals("Trip", ignoreCase = true) }
            else null
        }

        if (scope.equals(ExpenseScope.TRIP, ignoreCase = true) && !effectiveTripName.isNullOrBlank()) {
            ServiceLocator.cloudSyncRepository.pushSharedSettings(ServiceLocator.settingsManager.addTrip(effectiveTripName))
        }

        if (updatedTxn != null) {
            val finalLabel = ExpensePromptNotifier.labelForDescription(updatedTxn.description)
            ExpensePromptNotifier.showLogged(context, updatedTxn, finalLabel)
        }
        runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(context) }
        ServiceLocator.cloudSyncRepository.syncPending()

        // "✅ Logged" alone is misleading if it never reached Kharcha Book -- say so.
        val settings = ServiceLocator.settingsManager
        val stillLocal = repo.getTransactionById(transactionId)?.let { !it.syncedToCloud && it.transactionType.isExpense } ?: false
        if (stillLocal && settings.isCloudSyncEnabled.first()) {
            val reason = settings.cloudSyncLastError.first()
                ?: if (settings.cloudSyncAccessToken.first() == null) "Cloud Sync is not signed in." else null
            if (reason != null) ExpensePromptNotifier.showSyncProblem(context, reason)
        }
    }
}
