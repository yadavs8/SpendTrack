package com.spendtrack.app.core.nudge

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.service.QuickActionReceiver
import java.util.concurrent.TimeUnit

/**
 * Escalating reminder schedule for an expense still waiting on a category/scope: quick at first
 * (15 min), then a few hours apart, settling into a once-a-day nag until the user resolves it.
 * Uses both WorkManager and AlarmManager so battery optimization / screen-off on devices like OnePlus
 * does not drop unacknowledged expense reminders.
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

    /**
     * Triggered when the user explicitly clears/swipes away an unreviewed notification without answering.
     * Uses AlarmManager so the reminder still fires under aggressive battery management (OnePlus).
     */
    fun scheduleDismissalReprompt(context: Context, transactionId: String, delayMinutes: Long = 30L) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val intent = Intent(context, QuickActionReceiver::class.java).apply {
                action = QuickActionReceiver.ACTION_REPROMPT_NUDGE
                putExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID, transactionId)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                ("reprompt_$transactionId").hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val triggerAt = System.currentTimeMillis() + (delayMinutes * 60 * 1000L)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager?.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            } else {
                alarmManager?.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            }
        } catch (_: Exception) {
            enqueue(context, transactionId, stage = 0)
        }
    }

    fun cancel(context: Context, transactionId: String) {
        WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(transactionId))
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val intent = Intent(context, QuickActionReceiver::class.java).apply {
                action = QuickActionReceiver.ACTION_REPROMPT_NUDGE
                putExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID, transactionId)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                ("reprompt_$transactionId").hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager?.cancel(pendingIntent)
        } catch (_: Exception) {}
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
