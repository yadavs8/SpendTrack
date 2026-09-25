package com.spendtrack.app.service

import android.app.Notification
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
import com.spendtrack.app.core.utils.CurrencyUtils
import com.spendtrack.app.core.utils.OemBatteryHelper
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

    // Apps re-post / update the same notification (progress, "tap to view", group refresh).
    // Remember recently processed notification contents so one payment is recorded once.
    private val recentlyProcessed = object : LinkedHashMap<String, Long>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > 100
    }

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(applicationContext)
        createNotificationChannel()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        // Some OEMs unbind listeners in the background; ask the system to reconnect us
        OemBatteryHelper.requestServiceRebind(applicationContext)
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        if (packageName == applicationContext.packageName) return // never parse our own confirmations

        val notification = sbn.notification ?: return
        // Group summaries repeat their children; ongoing notifications are progress/status, not payments
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return

        val extras = notification.extras ?: return

        // Extract text fields. bigText is the expanded form of text, so prefer it instead of joining both
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()

        val fullText = if (!bigText.isNullOrBlank()) bigText else text
        if (title.isNullOrBlank() && fullText.isNullOrBlank()) return

        val contentKey = "$packageName|$title|$fullText"
        synchronized(recentlyProcessed) {
            val now = System.currentTimeMillis()
            val last = recentlyProcessed[contentKey]
            if (last != null && now - last < DUPLICATE_WINDOW_MS) return
            recentlyProcessed[contentKey] = now
        }

        serviceScope.launch {
            try {
                // Only apps the user has enabled in Settings (plus bank apps) are read
                val monitoredApps = ServiceLocator.settingsManager.monitoredAppsFlow.first()
                val isMonitored = monitoredApps.contains(packageName) ||
                        isBankApp(packageName)

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
                            // Refunds and self-transfers are stored silently - they are not expenses
                            if (!txn.transactionType.isExpense) return@launch
                            showExpenseNotification(
                                "Expense recorded: ${CurrencyUtils.formatRupees(txn.amount, showDecimals = true)} at ${txn.merchantName}",
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

    private fun isBankApp(packageName: String): Boolean {
        val pkg = packageName.lowercase()
        return KNOWN_BANK_PACKAGES.contains(pkg) || pkg.contains("bank")
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

    companion object {
        private const val DUPLICATE_WINDOW_MS = 10 * 60 * 1000L

        private val KNOWN_BANK_PACKAGES = setOf(
            "com.snapwork.hdfc",               // HDFC Bank
            "com.sbi.lotusintouch",            // SBI YONO
            "com.sbi.upi",                     // BHIM SBI Pay
            "com.csam.icici.bank.imobile",     // ICICI iMobile
            "com.axis.mobile",                 // Axis Mobile
            "com.msf.kbank.mobile",            // Kotak
            "com.idfcfirstbank.optimus",       // IDFC FIRST
            "com.bankofbaroda.mconnect",       // Bank of Baroda
            "com.fss.pnbpsp",                  // PNB
            "com.canarabank.mobility"          // Canara
        )
    }
}
