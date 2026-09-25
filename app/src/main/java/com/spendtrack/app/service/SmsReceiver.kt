package com.spendtrack.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.spendtrack.app.core.logger.SafeLogger
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

        // Keep the receiver alive until parsing and the DB write finish; otherwise the process
        // may be killed as soon as onReceive returns and the SMS is silently lost.
        val pendingResult = goAsync()
        receiverScope.launch {
            try {
                val isSmsEnabled = ServiceLocator.settingsManager.isSmsDetectionEnabled.first()
                if (!isSmsEnabled) return@launch

                // Same pipeline as notifications: user-taught templates, rule pack, then heuristics
                val parsed = ServiceLocator.rulePackEngine.parse(
                    title = sender,
                    text = fullText,
                    sourcePackage = null,
                    timestamp = timestamp
                ) ?: return@launch

                SafeLogger.i("Parsed transaction from SMS ($sender): Amount=${parsed.amount}, Type=${parsed.transactionType}")
                ServiceLocator.transactionRepository.ingestTransaction(parsed)
            } catch (e: Exception) {
                SafeLogger.e("Error processing incoming SMS", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
