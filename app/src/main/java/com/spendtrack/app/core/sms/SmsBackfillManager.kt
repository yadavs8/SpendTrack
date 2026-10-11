package com.spendtrack.app.core.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.flow.first

object SmsBackfillManager {

    /**
     * Scans recent bank SMS from telephony inbox (e.g. past 24 hours) to backfill any transactions
     * that were missed due to device sleep, battery optimization, or app restarts.
     * All messages are passed through DeduplicationEngine, so existing transactions are safely
     * merged or preserved without creating duplicates.
     */
    suspend fun backfillMissedSms(
        context: Context,
        windowMillis: Long = 24 * 60 * 60 * 1000L // 24 hours backfill
    ): Int {
        val appContext = context.applicationContext

        // 1. Verify SMS permission is granted
        val hasPermission = ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.READ_SMS
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) {
            return 0
        }

        // 2. Check if SMS detection is enabled in settings
        val isEnabled = try {
            ServiceLocator.settingsManager.isSmsDetectionEnabled.first()
        } catch (e: Exception) {
            false
        }
        if (!isEnabled) {
            return 0
        }

        val sinceTime = System.currentTimeMillis() - windowMillis
        var processedCount = 0
        var newCount = 0

        try {
            val cursor = appContext.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
                "${Telephony.Sms.DATE} >= ?",
                arrayOf(sinceTime.toString()),
                "${Telephony.Sms.DATE} ASC"
            )

            cursor?.use {
                val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
                val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)

                while (it.moveToNext()) {
                    val address = if (addressIdx != -1) it.getString(addressIdx) ?: "" else ""
                    val body = if (bodyIdx != -1) it.getString(bodyIdx) ?: "" else ""
                    val date = if (dateIdx != -1) it.getLong(dateIdx) else System.currentTimeMillis()

                    if (body.isBlank()) continue

                    // Fast filter: only examine bank-like messages
                    if (!TransactionParser.looksLikeBankSms(body) && !TransactionParser.looksLikeBankCreditSms(body) && !isBankSender(address)) {
                        continue
                    }

                    val statement = com.spendtrack.app.core.parser.CardBillParser.parseStatement(body)
                    if (statement != null) {
                        com.spendtrack.app.core.automation.AutomationRunner.onCardStatement(statement)
                        continue
                    }
                    com.spendtrack.app.core.parser.CardBillParser.parsePayment(body)?.let {
                        com.spendtrack.app.core.automation.AutomationRunner.onCardPayment(it)
                    }

                        val parsed = TransactionParser.parseAny(
                        title = address,
                        text = body,
                        sourcePackage = null,
                        timestamp = date
                    ) ?: continue

                    processedCount++
                    val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)
                    if (result is DeduplicationEngine.DeduplicationResult.NewTransaction) {
                        newCount++
                    }
                }
            }

            if (processedCount > 0) {
                SafeLogger.i("SmsBackfillManager: Processed $processedCount bank SMS ($newCount new transactions).")
                ServiceLocator.cloudSyncRepository.syncPending()
            }
        } catch (e: Exception) {
            SafeLogger.e("SmsBackfillManager: Error reading SMS inbox for backfill", e)
        }

        return newCount
    }

    private fun isBankSender(address: String): Boolean {
        val lower = address.lowercase()
        return lower.contains("bank") ||
                lower.contains("hdfc") ||
                lower.contains("icici") ||
                lower.contains("axis") ||
                lower.contains("sbi") ||
                lower.contains("kotak") ||
                lower.contains("pnb") ||
                lower.contains("bob") ||
                lower.contains("indus") ||
                lower.contains("paytm") ||
                lower.contains("cred")
    }
}
