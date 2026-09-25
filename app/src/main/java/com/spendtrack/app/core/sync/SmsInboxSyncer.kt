package com.spendtrack.app.core.sync

import android.content.Context
import android.provider.Telephony
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.parser.TransactionFilter
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object SmsInboxSyncer {

    data class SyncResult(
        val scannedCount: Int,
        val importedCount: Int
    )

    /**
     * @param sinceMillis only SMS received after this time are scanned. The automatic startup sync
     * passes the previous sync time so entries the user deleted are not re-imported on every launch.
     */
    suspend fun syncPastBankSms(
        context: Context,
        maxMessagesToScan: Int = 200,
        sinceMillis: Long = 0L
    ): SyncResult = withContext(Dispatchers.IO) {
        ServiceLocator.init(context.applicationContext)

        var scanned = 0
        var imported = 0

        try {
            val contentResolver = context.contentResolver
            val projection = arrayOf(
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            )

            val cursor = contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                "${Telephony.Sms.DATE} > ?",
                arrayOf(sinceMillis.toString()),
                "${Telephony.Sms.DATE} DESC"
            )

            cursor?.use { c ->
                val addressIdx = c.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIdx = c.getColumnIndex(Telephony.Sms.BODY)
                val dateIdx = c.getColumnIndex(Telephony.Sms.DATE)

                while (c.moveToNext() && scanned < maxMessagesToScan) {
                    scanned++
                    val address = if (addressIdx >= 0) c.getString(addressIdx) else null
                    val body = if (bodyIdx >= 0) c.getString(bodyIdx) else null
                    val timestamp = if (dateIdx >= 0) c.getLong(dateIdx) else System.currentTimeMillis()

                    if (body.isNullOrBlank()) continue
                    if (TransactionFilter.isPersonalSmsSender(address)) continue

                    val parsed = ServiceLocator.rulePackEngine.parse(
                        title = address,
                        text = body,
                        sourcePackage = null,
                        timestamp = timestamp
                    ) ?: continue

                    // Idempotent: the same SMS may already be stored by SmsReceiver or an earlier sync
                    if (ServiceLocator.transactionRepository.isAlreadyRecorded(parsed)) continue

                    val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)
                    if (result is com.spendtrack.app.core.deduplication.DeduplicationEngine.DeduplicationResult.NewTransaction) {
                        imported++
                        SafeLogger.i("Synced historical bank SMS ($address): ${result.transaction.amount} at ${result.transaction.merchantName}")
                    }
                }
            }
        } catch (e: Exception) {
            SafeLogger.e("Error syncing historical bank SMS", e)
        }

        SyncResult(scannedCount = scanned, importedCount = imported)
    }
}
