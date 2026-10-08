package com.spendtrack.app.service

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Handles taps on the "what's this for?" notification -- a quick category pick, or a typed note
 * sent via the notification's inline reply. Resolves the transaction without ever opening the app.
 */
class QuickActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_QUICK_CATEGORIZE = "com.spendtrack.app.ACTION_QUICK_CATEGORIZE"
        const val ACTION_ADD_NOTE = "com.spendtrack.app.ACTION_ADD_NOTE"
        const val ACTION_SET_SCOPE = "com.spendtrack.app.ACTION_SET_SCOPE"
        const val ACTION_NOTIFICATION_DISMISSED = "com.spendtrack.app.ACTION_NOTIFICATION_DISMISSED"
        const val ACTION_REPROMPT_NUDGE = "com.spendtrack.app.ACTION_REPROMPT_NUDGE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val transactionId = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID) ?: return
        val notificationId = intent.getIntExtra(ExpensePromptNotifier.EXTRA_NOTIFICATION_ID, -1)
        val appContext = context.applicationContext
        ServiceLocator.init(appContext)

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_NOTIFICATION_DISMISSED -> {
                        // User cleared notification without answering.
                        // If transaction is still unreviewed, schedule a guaranteed 5-minute re-prompt!
                        val txn = ServiceLocator.transactionRepository.getTransactionById(transactionId)
                        if (txn != null && txn.needsReview && !txn.isExcluded) {
                            NudgeScheduler.scheduleDismissalReprompt(appContext, transactionId)
                        }
                        return@launch
                    }
                    ACTION_REPROMPT_NUDGE -> {
                        // AlarmManager re-prompt fired: re-display notification prompt if still unreviewed
                        val txn = ServiceLocator.transactionRepository.getTransactionById(transactionId)
                        if (txn != null && txn.needsReview && !txn.isExcluded) {
                            val activeTrip = ServiceLocator.settingsManager.activeTripNameFlow.first()
                            ExpensePromptNotifier.show(appContext, txn, activeTrip)
                            NudgeScheduler.scheduleFirst(appContext, txn.id)
                        }
                        return@launch
                    }
                    ACTION_SET_SCOPE -> {
                        val scope = intent.getStringExtra(ExpensePromptNotifier.EXTRA_SCOPE) ?: ExpensePromptNotifier.SCOPE_PERSONAL
                        val tripName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRIP_NAME)
                        ServiceLocator.transactionRepository.resolveScope(
                            transactionId = transactionId,
                            scope = scope,
                            tripName = tripName
                        )
                    }
                    ACTION_QUICK_CATEGORIZE -> {
                        val categoryId = intent.getStringExtra(ExpensePromptNotifier.EXTRA_CATEGORY_ID)
                        val categoryName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_CATEGORY_NAME)
                        ServiceLocator.transactionRepository.resolveNeedsReview(
                            transactionId = transactionId,
                            categoryId = categoryId,
                            categoryName = categoryName
                        )
                    }
                    ACTION_ADD_NOTE -> {
                        val note = RemoteInput.getResultsFromIntent(intent)
                            ?.getCharSequence(ExpensePromptNotifier.REMOTE_INPUT_KEY)
                            ?.toString()
                        ServiceLocator.transactionRepository.resolveNeedsReview(
                            transactionId = transactionId,
                            note = note
                        )
                    }
                }
                if (notificationId != -1) {
                    androidx.core.app.NotificationManagerCompat.from(appContext).cancel(notificationId)
                }
                NudgeScheduler.cancel(appContext, transactionId)
                // Now has a real description -- push it to Kharcha Book.
                ServiceLocator.cloudSyncRepository.syncPending()

                if (intent.action == ACTION_SET_SCOPE) {
                    val scope = intent.getStringExtra(ExpensePromptNotifier.EXTRA_SCOPE) ?: ExpensePromptNotifier.SCOPE_PERSONAL
                    val tripName = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRIP_NAME)
                    val scopeLabel = when (scope) {
                        ExpensePromptNotifier.SCOPE_FAMILY -> "🏠 Family"
                        ExpensePromptNotifier.SCOPE_INVESTMENT -> "📈 Investment"
                        ExpensePromptNotifier.SCOPE_TRIP -> "✈️ ${tripName ?: "Trip"}"
                        else -> "👤 Personal"
                    }
                    val confirmBuilder = androidx.core.app.NotificationCompat.Builder(appContext, "spendtrack_review_channel")
                        .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
                        .setColor(0xFF0B5D75.toInt())
                        .setContentTitle("✅ Saved as $scopeLabel")
                        .setContentText("Synced to Kharcha Book")
                        .setAutoCancel(true)
                        .setTimeoutAfter(3000) // auto-dismiss after 3s
                        .setPriority(androidx.core.app.NotificationCompat.PRIORITY_LOW)
                    androidx.core.app.NotificationManagerCompat.from(appContext).notify(notificationId + 1000, confirmBuilder.build())
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
