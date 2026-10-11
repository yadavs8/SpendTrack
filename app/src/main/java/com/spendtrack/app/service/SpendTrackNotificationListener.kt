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
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class SpendTrackNotificationListener : NotificationListenerService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val CHANNEL_ID = "spendtrack_expense_channel"

    companion object {
        private val processedNotificationCache = java.util.concurrent.ConcurrentHashMap<String, Long>()
        private const val DEBOUNCE_WINDOW_MS = 15_000L // coalesce reposts of the same notification, not distinct payments
    }

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(applicationContext)
        createNotificationChannel()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        SafeLogger.i("Notification listener connected")
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName
        if (packageName == applicationContext.packageName) return
        val extras = sbn.notification?.extras ?: return

        // Extract text fields
        val title = extras.getCharSequence("android.title")?.toString()
        val text = extras.getCharSequence("android.text")?.toString()
        val bigText = extras.getCharSequence("android.bigText")?.toString()
        val subText = extras.getCharSequence("android.subText")?.toString()

        // Never log notification text: this listener sees every app's notifications (chats, OTPs).
        val fullText = listOfNotNull(text, bigText, subText).joinToString(" ")

        val now = System.currentTimeMillis()
        processedNotificationCache.entries.removeIf { now - it.value > DEBOUNCE_WINDOW_MS }
        val fingerprint = "${sbn.key}:$fullText"
        if (processedNotificationCache.putIfAbsent(fingerprint, now) != null) {
            return
        }

        serviceScope.launch {
            try {
                // Check if package is monitored
                val monitoredApps = ServiceLocator.settingsManager.monitoredAppsFlow.first()
                val isMonitored = monitoredApps.contains(packageName) ||
                        TransactionParser.MONITORED_UPI_PACKAGES.contains(packageName) ||
                        // Bank SMS shown by the SMS app; works even when SMS permission isn't granted
                        TransactionParser.MESSAGING_PACKAGES.contains(packageName) ||
                        packageName.contains("bank", ignoreCase = true)

                if (!isMonitored) return@launch

                // Credit card statement / bill payment: remember the due date, or mark it paid.
                // (A statement is never an expense; a bill payment is a transfer, handled by the parser.)
                val cardText = listOfNotNull(title, fullText).joinToString(" ")
                com.spendtrack.app.core.parser.CardBillParser.parseStatement(cardText)?.let {
                    com.spendtrack.app.core.automation.AutomationRunner.onCardStatement(it)
                    return@launch
                }
                com.spendtrack.app.core.parser.CardBillParser.parsePayment(cardText)?.let {
                    com.spendtrack.app.core.automation.AutomationRunner.onCardPayment(it)
                }

                val parsed = ServiceLocator.rulePackEngine.parse(
                    title = title,
                    text = fullText,
                    sourcePackage = packageName,
                    timestamp = sbn.postTime
                ) ?: return@launch

                SafeLogger.i("Parsed transaction from notification ($packageName): Amount=${parsed.amount}, Type=${parsed.transactionType}")

                // Pick up a trip started on the web a moment ago (bounded, so a slow network
                // never delays the prompt for long; offline just uses the cached copy).
                withTimeoutOrNull(2500) { runCatching { ServiceLocator.cloudSyncRepository.refreshSharedSettings() } }

                val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)

                when (result) {
                    is DeduplicationEngine.DeduplicationResult.NewTransaction -> {
                        val txn = result.transaction
                        when {
                            // Own-account transfer / matched refund: nothing to ask or announce.
                            txn.isExcluded -> Unit
                            txn.transactionType == com.spendtrack.app.core.model.TransactionType.INCOME ->
                                com.spendtrack.app.core.automation.AutomationRunner.onIncomeLogged(applicationContext, txn)
                            // ATM cash: goes to the cash wallet; the evening nudge asks what it was spent on.
                            txn.transactionType == com.spendtrack.app.core.model.TransactionType.CASH_WITHDRAWAL -> Unit
                            txn.needsReview -> {
                                // Ask right away, then keep reminding until answered.
                                val activeTrip = ServiceLocator.settingsManager.activeTripNameFlow.first()
                                ExpensePromptNotifier.show(applicationContext, txn, activeTrip)
                                NudgeScheduler.scheduleFirst(applicationContext, txn.id)
                            }
                            // Filed automatically (investment / remembered merchant): one quiet note.
                            ServiceLocator.settingsManager.showConfirmationNotifs.first() ->
                                ExpensePromptNotifier.showLogged(
                                    applicationContext, txn,
                                    ExpensePromptNotifier.labelForDescription(txn.description) + " (auto)"
                                )
                        }
                        // Lands in Kharcha Book now if it has a bank/UPI ref (answering later
                        // updates the same row); see TransactionDao.getUnsyncedExpenses.
                        runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(applicationContext) }
                        ServiceLocator.cloudSyncRepository.syncPending()
                        if (txn.transactionType == com.spendtrack.app.core.model.TransactionType.EXPENSE && !txn.isExcluded) {
                            runCatching { com.spendtrack.app.core.automation.AutomationRunner.checkBudgets(applicationContext) }
                        }
                    }
                    is DeduplicationEngine.DeduplicationResult.MergedWithExisting -> {
                        // Second copy of a payment we already have (e.g. Truecaller + Messages): no new prompt.
                        // If the merge revealed a transfer between own accounts, its pending prompt goes away.
                        val merged = result.updatedTransaction
                        if (merged.transactionType == com.spendtrack.app.core.model.TransactionType.INTERNAL_TRANSFER) {
                            NudgeScheduler.cancel(applicationContext, merged.id)
                            ExpensePromptNotifier.dismiss(applicationContext, merged.id)
                            ServiceLocator.cloudSyncRepository.syncPending()
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
}
