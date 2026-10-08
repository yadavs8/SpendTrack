package com.spendtrack.app.core.nudge

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.flow.first

class NudgeWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val transactionId = inputData.getString(NudgeScheduler.KEY_TRANSACTION_ID) ?: return Result.success()
        val stage = inputData.getInt(NudgeScheduler.KEY_STAGE, 0)

        ServiceLocator.init(applicationContext)
        val transaction = ServiceLocator.transactionRepository.getTransactionById(transactionId)
            ?: return Result.success() // deleted since

        if (!transaction.needsReview || transaction.isExcluded) {
            // Already resolved (quick action, note reply, or handled in the Needs Review screen).
            return Result.success()
        }

        SafeLogger.i("Re-prompting for uncategorized expense $transactionId (stage $stage)")
        val activeTrip = ServiceLocator.settingsManager.activeTripNameFlow.first()
        ExpensePromptNotifier.show(applicationContext, transaction, activeTrip)
        NudgeScheduler.scheduleNext(applicationContext, transactionId, previousStage = stage)

        return Result.success()
    }
}
