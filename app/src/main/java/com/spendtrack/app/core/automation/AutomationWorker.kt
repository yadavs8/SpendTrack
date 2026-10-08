package com.spendtrack.app.core.automation

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.spendtrack.app.data.di.ServiceLocator
import java.util.Calendar
import java.util.concurrent.TimeUnit

/** Runs the morning (bills, settle-up, budgets) or evening (cash, weekly summary, budgets) checks. */
class AutomationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        ServiceLocator.init(applicationContext)
        when (inputData.getString(KEY_SLOT)) {
            SLOT_MORNING -> AutomationRunner.morning(applicationContext)
            SLOT_EVENING -> AutomationRunner.evening(applicationContext)
        }
        return Result.success()
    }

    companion object {
        const val KEY_SLOT = "slot"
        const val SLOT_MORNING = "morning"
        const val SLOT_EVENING = "evening"

        /** Daily at ~9:00 and ~20:30. Safe to call on every app start (keeps the existing schedule). */
        fun schedule(context: Context) {
            enqueue(context, SLOT_MORNING, 9, 0)
            enqueue(context, SLOT_EVENING, 20, 30)
        }

        private fun enqueue(context: Context, slot: String, hour: Int, minute: Int) {
            val now = Calendar.getInstance()
            val next = (now.clone() as Calendar).apply {
                set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                if (!after(now)) add(Calendar.DAY_OF_YEAR, 1)
            }
            val request = PeriodicWorkRequestBuilder<AutomationWorker>(24, TimeUnit.HOURS, 2, TimeUnit.HOURS)
                .setInitialDelay(next.timeInMillis - now.timeInMillis, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf(KEY_SLOT to slot))
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("kharcha_automation_$slot", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
