package com.spendtrack.app

import android.app.Application
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private const val FALSE_DETECTION_CLEANUP_VERSION = 1

class SpendTrackApp : Application() {

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)

        // Pre-heat database to initialize default categories
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val categories = ServiceLocator.categoryRepository.getAllCategoriesSync()
                SafeLogger.i("Database initialized with ${categories.size} categories")

                // One-time removal of OTPs / offers / reminders recorded by older, looser parser versions
                val settings = ServiceLocator.settingsManager
                if (settings.falseDetectionCleanupVersion.first() < FALSE_DETECTION_CLEANUP_VERSION) {
                    val removed = ServiceLocator.transactionRepository.purgeFalseDetections()
                    settings.setFalseDetectionCleanupVersion(FALSE_DETECTION_CLEANUP_VERSION)
                    SafeLogger.i("Removed $removed falsely detected transactions")
                }
            } catch (e: Exception) {
                SafeLogger.e("Error warming database", e)
            }
        }
    }
}
