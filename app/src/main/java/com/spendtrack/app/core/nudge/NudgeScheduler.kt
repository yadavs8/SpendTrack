package com.spendtrack.app.core.nudge

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * Escalating reminder schedule for an expense still waiting on a category/note: quick at first
 * (15 min), then a few hours apart, settling into a once-a-day nag until the user resolves it.
 * Each stage re-schedules the next one from inside NudgeWorker, so the chain self-terminates the
 * moment the transaction is no longer `needsReview` -- no explicit cancel required on that path.
 */
object NudgeScheduler {

    const val KEY_TRANSACTION_ID = "transaction_id"
    const val KEY_STAGE = "stage"

    private val STAGE_DELAYS_MINUTES = listOf(15L, 120L, 180L, 180L, 1440L) // last stage repeats

    fun delayMinutesForStage(stage: Int): Long =
        STAGE_DELAYS_MINUTES[stage.coerceIn(0, STAGE_DELAYS_MINUTES.lastIndex)]

    fun scheduleFirst(context: Context, transactionId: String) {
        enqueue(context, transactionId, stage = 0)
    }

    fun scheduleNext(context: Context, transactionId: String, previousStage: Int) {
        enqueue(context, transactionId, stage = previousStage + 1)
    }

    fun cancel(context: Context, transactionId: String) {
        WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(transactionId))
    }

    private fun enqueue(context: Context, transactionId: String, stage: Int) {
        val request = OneTimeWorkRequestBuilder<NudgeWorker>()
            .setInitialDelay(delayMinutesForStage(stage), TimeUnit.MINUTES)
            .setInputData(
                workDataOf(
                    KEY_TRANSACTION_ID to transactionId,
                    KEY_STAGE to stage
                )
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            uniqueWorkName(transactionId),
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    private fun uniqueWorkName(transactionId: String) = "nudge_$transactionId"
}
