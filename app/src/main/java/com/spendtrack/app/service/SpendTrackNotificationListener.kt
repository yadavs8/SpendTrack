package com.spendtrack.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import com.spendtrack.app.R
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class SpendTrackNotificationListener : NotificationListenerService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val CHANNEL_ID = "spendtrack_expense_channel"

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(applicationContext)
        createNotificationChannel()
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName
        val extras = sbn.notification?.extras ?: return

        // Extract text fields
        val title = extras.getCharSequence("android.title")?.toString()
        val text = extras.getCharSequence("android.text")?.toString()
        val bigText = extras.getCharSequence("android.bigText")?.toString()
        val subText = extras.getCharSequence("android.subText")?.toString()

        val fullText = listOfNotNull(text, bigText, subText).joinToString(" ")

        serviceScope.launch {
            try {
                // Check if package is monitored
                val monitoredApps = ServiceLocator.settingsManager.monitoredAppsFlow.first()
                val isMonitored = monitoredApps.contains(packageName) ||
                        TransactionParser.MONITORED_UPI_PACKAGES.contains(packageName) ||
                        packageName.contains("bank", ignoreCase = true)

                if (!isMonitored) return@launch

                val parsed = ServiceLocator.rulePackEngine.parse(
                    title = title,
                    text = fullText,
                    sourcePackage = packageName,
                    timestamp = sbn.postTime
                ) ?: return@launch

                SafeLogger.i("Parsed transaction from notification ($packageName): Amount=${parsed.amount}, Type=${parsed.transactionType}")

                val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)

                // Optional confirmation notification
                val showNotif = ServiceLocator.settingsManager.showConfirmationNotifs.first()
                if (showNotif) {
                    when (result) {
                        is DeduplicationEngine.DeduplicationResult.NewTransaction -> {
                            val txn = result.transaction
                            showExpenseNotification(
                                "Expense recorded: ₹${txn.amount.toInt()} at ${txn.merchantName}",
                                "Method: ${txn.paymentMethod.displayName}"
                            )
                        }
                        is DeduplicationEngine.DeduplicationResult.MergedWithExisting -> {
                            // Merged multi-source, no spam
                        }
                    }
                }
            } catch (e: Exception) {
                SafeLogger.e("Error processing notification", e)
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Expense Confirmation"
            val descriptionText = "Shows quick confirmation when an expense is recorded"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun showExpenseNotification(title: String, message: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val contentIntent = android.app.PendingIntent.getActivity(
            this,
            0,
            android.content.Intent(this, com.spendtrack.app.MainActivity::class.java).apply {
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle(title)
            .setContentText(message)
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build()

        notificationManager.notify((System.currentTimeMillis() % 10000).toInt(), notification)
    }
}
