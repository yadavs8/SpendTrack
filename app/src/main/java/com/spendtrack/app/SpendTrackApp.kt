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
        ServiceLocator.init(this)
        installCrashLogger()

        // Pre-heat database to initialize default categories
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val categories = ServiceLocator.categoryRepository.getAllCategoriesSync()
                SafeLogger.i("Database initialized with ${categories.size} categories")
            } catch (e: Exception) {
                SafeLogger.e("Error warming database", e)
            }
        }
    }

    /**
     * Logs uncaught exceptions before delegating to the platform's default handler,
     * so a crash leaves a diagnosable trace instead of vanishing silently.
     */
    private fun installCrashLogger() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                SafeLogger.e("Uncaught exception on thread ${thread.name}", throwable)
            } catch (_: Exception) {
                // Never let logging itself block crash handoff.
            }
            defaultHandler?.uncaughtException(thread, throwable)
        }
    }
}
