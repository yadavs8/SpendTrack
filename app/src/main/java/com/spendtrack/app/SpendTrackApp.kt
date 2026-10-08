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
        // Morning/evening automations (bills, settle-up, cash, weekly summary, budgets).
        runCatching { com.spendtrack.app.core.automation.AutomationWorker.schedule(this) }

        // Pre-heat database to initialize default categories
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val categories = ServiceLocator.categoryRepository.getAllCategoriesSync()
                SafeLogger.i("Database initialized with ${categories.size} categories")
            } catch (e: Exception) {
                SafeLogger.e("Error warming database", e)
            }
            // Trips / owner identity edited on the web since the app last ran.
            runCatching { ServiceLocator.cloudSyncRepository.refreshSharedSettings() }
        }
    }
}
