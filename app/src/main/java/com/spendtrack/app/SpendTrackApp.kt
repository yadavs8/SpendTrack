package com.spendtrack.app

import android.app.Application
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SpendTrackApp : Application() {

    override fun onCreate() {
        super.onCreate()
        installCrashReporter()
        ServiceLocator.init(this)
        // Morning/evening automations (bills, settle-up, cash, weekly summary, budgets).
        runCatching { com.spendtrack.app.core.automation.AutomationWorker.schedule(this) }
        // Watchdog: re-binds the notification listener and runs a safety-net SMS backfill every
        // ~30 min, independent of the app being open, so an OS-killed listener self-heals.
        runCatching { com.spendtrack.app.core.automation.ListenerWatchdogWorker.schedule(this) }

        // Pre-heat database to initialize default categories and purge any stuck zero-amount entries
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val categories = ServiceLocator.categoryRepository.getAllCategoriesSync()
                SafeLogger.i("Database initialized with ${categories.size} categories")
                val zeroRows = ServiceLocator.database.transactionDao().getZeroAmountTransactions()
                for (z in zeroRows) {
                    com.spendtrack.app.core.notification.ExpensePromptNotifier.dismiss(this@SpendTrackApp, z.id)
                }
                val purged = ServiceLocator.database.transactionDao().purgeZeroAmountTransactions()
                if (purged > 0) {
                    SafeLogger.i("Purged $purged invalid zero-amount transaction(s) on startup")
                    ServiceLocator.settingsManager.setCloudSyncError(null)
                }
            } catch (e: Exception) {
                SafeLogger.e("Error warming database", e)
            }
            // Trips / owner identity edited on the web since the app last ran.
            runCatching { ServiceLocator.cloudSyncRepository.refreshSharedSettings() }
            runCatching { ServiceLocator.cloudSyncRepository.syncPending() }
        }
    }

    /**
     * So a crash is never silent again: write the stack trace to a plain file before the process
     * dies, then hand off to whatever the OS would normally do (its own crash dialog, logcat's
     * FATAL EXCEPTION, process death) so nothing about today's behaviour changes except that the
     * next launch can show what happened. MainActivity checks for this file before doing anything
     * else and, if present, opens the Compose/Room-free CrashActivity instead.
     */
    private fun installCrashReporter() {
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val writer = java.io.StringWriter()
                throwable.printStackTrace(java.io.PrintWriter(writer))
                CrashActivity.crashFile(this).writeText(
                    "Kharcha Book crashed\n" +
                        "Time: ${java.util.Date()}\n" +
                        "Thread: ${thread.name}\n\n" +
                        writer.toString()
                )
            } catch (_: Throwable) {
                // Writing the report must never itself throw into this handler.
            }
            previousHandler?.uncaughtException(thread, throwable)
        }
    }
}
