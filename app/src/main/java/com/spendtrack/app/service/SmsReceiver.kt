package com.spendtrack.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.core.notification.PromptReconciler
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {

    private val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        ServiceLocator.init(context.applicationContext)

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val sender = messages.first().originatingAddress ?: "Bank"
        val bodyBuilder = StringBuilder()
        var timestamp = System.currentTimeMillis()

        for (sms in messages) {
            bodyBuilder.append(sms.messageBody)
            timestamp = sms.timestampMillis
        }

        val fullText = bodyBuilder.toString()

        receiverScope.launch {
            try {
                val isSmsEnabled = ServiceLocator.settingsManager.isSmsDetectionEnabled.first()
                if (!isSmsEnabled) return@launch

                com.spendtrack.app.core.parser.CardBillParser.parseStatement(fullText)?.let {
                    com.spendtrack.app.core.automation.AutomationRunner.onCardStatement(it)
                    return@launch
                }
                com.spendtrack.app.core.parser.CardBillParser.parsePayment(fullText)?.let {
                    com.spendtrack.app.core.automation.AutomationRunner.onCardPayment(it)
                }

                val parsed = TransactionParser.parseAny(
                    title = sender,
                    text = fullText,
                    sourcePackage = null,
                    timestamp = timestamp
                )
                if (parsed == null) {
                    // Money moved but the parser could not read it: never stay silent about that.
                    com.spendtrack.app.core.notification.MissedMessages.noteIfMoney(context.applicationContext, sender, fullText, timestamp)
                    return@launch
                }

                SafeLogger.i("Parsed transaction from SMS ($sender): Amount=${parsed.amount}, Type=${parsed.transactionType}")
                val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)
                PromptReconciler.clearPaired(context.applicationContext)
                if (result is DeduplicationEngine.DeduplicationResult.NewTransaction) {
                    val txn = result.transaction
                    if (txn.transactionType == com.spendtrack.app.core.model.TransactionType.INCOME && !txn.isExcluded) {
                        com.spendtrack.app.core.automation.AutomationRunner.onIncomeLogged(context.applicationContext, txn)
                    } else {
                        // Already entered in Kharcha Book by hand? Then there is nothing to ask.
                        val answered = txn.needsReview && !txn.isExcluded &&
                            PromptReconciler.resolveIfEnteredByHand(context.applicationContext, txn.id)
                        if (!answered) {
                            val activeTrip = ServiceLocator.settingsManager.activeTripNameFlow.first()
                            val knownTrips = ServiceLocator.transactionRepository.getAllKnownTrips()
                            ExpensePromptNotifier.announce(context.applicationContext, txn, activeTrip, knownTrips)
                        }
                    }
                    runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(context.applicationContext) }
                    ServiceLocator.cloudSyncRepository.syncPending()
                    if (txn.transactionType == com.spendtrack.app.core.model.TransactionType.EXPENSE && !txn.isExcluded) {
                        runCatching { com.spendtrack.app.core.automation.AutomationRunner.checkBudgets(context.applicationContext) }
                    }
                } else if (result is DeduplicationEngine.DeduplicationResult.MergedWithExisting) {
                    val merged = result.updatedTransaction
                    if (!merged.needsReview || merged.isExcluded ||
                        merged.transactionType == com.spendtrack.app.core.model.TransactionType.INTERNAL_TRANSFER) {
                        NudgeScheduler.cancel(context.applicationContext, merged.id)
                        ExpensePromptNotifier.dismiss(context.applicationContext, merged.id)
                        ServiceLocator.cloudSyncRepository.syncPending()
                    }
                }
            } catch (e: Exception) {
                SafeLogger.e("Error processing incoming SMS", e)
            }
        }
    }
}
