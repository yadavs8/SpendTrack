package com.spendtrack.app.service

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.spendtrack.app.core.notification.ExpenseFiler
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Handles the expense prompt's buttons, swipes and reminders without opening the app. */
class QuickActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_QUICK_CATEGORIZE = "com.spendtrack.app.ACTION_QUICK_CATEGORIZE"
        const val ACTION_ADD_NOTE = "com.spendtrack.app.ACTION_ADD_NOTE"
        const val ACTION_SET_SCOPE = "com.spendtrack.app.ACTION_SET_SCOPE"
        const val ACTION_NOTIFICATION_DISMISSED = "com.spendtrack.app.ACTION_NOTIFICATION_DISMISSED"
        const val ACTION_REPROMPT_NUDGE = "com.spendtrack.app.ACTION_REPROMPT_NUDGE"
        const val ACTION_NOT_INCOME = "com.spendtrack.app.ACTION_NOT_INCOME"
        const val ACTION_LOG_MISSED = "com.spendtrack.app.ACTION_LOG_MISSED"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val transactionId = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID) ?: return
        val appContext = context.applicationContext
        ServiceLocator.init(appContext)

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repo = ServiceLocator.transactionRepository
                when (intent.action) {
                    ACTION_NOTIFICATION_DISMISSED -> {
                        // Swiped away unanswered: remind once later (not in 5 minutes, and without
                        // restarting the whole reminder schedule).
                        val txn = repo.getTransactionById(transactionId)
                        if (txn != null && txn.needsReview && !txn.isExcluded) {
                            NudgeScheduler.cancel(appContext, transactionId)
                            NudgeScheduler.scheduleDismissalReprompt(appContext, transactionId)
                        }
                    }
                    ACTION_REPROMPT_NUDGE -> {
                        val txn = repo.getTransactionById(transactionId)
                        if (txn != null && txn.needsReview && !txn.isExcluded &&
                            !com.spendtrack.app.core.notification.PromptReconciler.resolveIfEnteredByHand(appContext, txn.id)) {
                            val settings = ServiceLocator.settingsManager
                            val activeTrip = settings.activeTripNameFlow.first()
                            val isTripPaused = settings.isTripPausedFlow.first()
                            val activeProject = settings.activeProjectNameFlow.first()
                            val isProjectPaused = settings.isProjectPausedFlow.first()
                            val knownTrips = repo.getAllKnownTrips()
                            val knownProjects = repo.getAllKnownProjects()
                            ExpensePromptNotifier.show(
                                appContext, txn,
                                activeTripName = activeTrip,
                                isTripPaused = isTripPaused,
                                activeProjectName = activeProject,
                                isProjectPaused = isProjectPaused,
                                alert = true,
                                trips = knownTrips,
                                projects = knownProjects
                            )
                            NudgeScheduler.scheduleNext(appContext, txn.id, previousStage = 0)
                        }
                    }
                    ACTION_SET_SCOPE -> {
                        val scope = intent.getStringExtra(ExpensePromptNotifier.EXTRA_SCOPE) ?: ExpensePromptNotifier.SCOPE_PERSONAL
                        val tripName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRIP_NAME)
                        val projectName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_PROJECT_NAME)
                        ExpenseFiler.file(appContext, transactionId, scope, tripName, projectName)
                    }
                    ACTION_QUICK_CATEGORIZE -> {
                        repo.resolveNeedsReview(
                            transactionId = transactionId,
                            categoryId = intent.getStringExtra(ExpensePromptNotifier.EXTRA_CATEGORY_ID),
                            categoryName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_CATEGORY_NAME)
                        )
                        NudgeScheduler.cancel(appContext, transactionId)
                        ExpensePromptNotifier.dismiss(appContext, transactionId)
                        ServiceLocator.cloudSyncRepository.syncPending()
                    }
                    ACTION_LOG_MISSED -> {
                        // A bank message the parser could not read, filed by the user's choice.
                        val asIncome = intent.getStringExtra(com.spendtrack.app.core.notification.MissedMessages.EXTRA_KIND) == com.spendtrack.app.core.notification.MissedMessages.KIND_INCOME
                        com.spendtrack.app.core.notification.MissedMessages.log(appContext, transactionId, asIncome)
                    }
                    ACTION_NOT_INCOME -> {
                        // "That wasn't income" (e.g. money back from a friend for a shared bill):
                        // drop it here and, if it already reached Kharcha Book, remove it there by ref.
                        repo.undoAutoIncome(transactionId)
                        com.spendtrack.app.core.automation.AutomationNotifier.cancel(appContext, 0x7B50 + (transactionId.hashCode() and 0xFF))
                        ServiceLocator.cloudSyncRepository.syncPending()
                    }
                    ACTION_ADD_NOTE -> {
                        // From notifications posted by older versions that still carry inline reply.
                        val note = RemoteInput.getResultsFromIntent(intent)
                            ?.getCharSequence(ExpensePromptNotifier.REMOTE_INPUT_KEY)?.toString()
                        ExpenseFiler.file(appContext, transactionId, ExpensePromptNotifier.SCOPE_PERSONAL, note = note)
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
