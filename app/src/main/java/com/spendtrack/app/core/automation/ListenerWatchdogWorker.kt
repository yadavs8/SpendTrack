package com.spendtrack.app.core.automation

import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.sms.SmsBackfillManager
import com.spendtrack.app.service.SpendTrackNotificationListener
import java.util.concurrent.TimeUnit

/**
 * OnePlus/Oppo/Xiaomi-style "deep optimization" can silently kill the notification listener
 * while the phone sits idle, with no crash to report. This runs every ~30 min regardless of
 * whether the app is open, and does two independent things so a payment is never lost:
 *  1. Asks the OS to rebind the listener if it has been detached.
 *  2. Re-scans the last 24h of bank SMS (same safety net MainActivity runs on open), so even a
 *     fully dead listener is caught up next time this worker fires.
 */
class ListenerWatchdogWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        runCatching {
            NotificationListenerService.requestRebind(
                ComponentName(applicationContext, SpendTrackNotificationListener::class.java)
            )
        }.onFailure { SafeLogger.e("Watchdog: requestRebind failed", it) }

        runCatching {
            SmsBackfillManager.backfillMissedSms(applicationContext)
        }.onFailure { SafeLogger.e("Watchdog: SMS backfill failed", it) }

        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "kharcha_listener_watchdog"

        /** Safe to call on every app start; WorkManager keeps the existing schedule. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ListenerWatchdogWorker>(30, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
