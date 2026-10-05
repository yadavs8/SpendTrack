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
import kotlinx.coroutines.launch

/**
 * Handles taps on the "what's this for?" notification -- a quick category pick, or a typed note
 * sent via the notification's inline reply. Resolves the transaction without ever opening the app.
 */
class QuickActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_QUICK_CATEGORIZE = "com.spendtrack.app.ACTION_QUICK_CATEGORIZE"
        const val ACTION_ADD_NOTE = "com.spendtrack.app.ACTION_ADD_NOTE"
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
            } finally {
                pendingResult.finish()
            }
        }
    }
}
