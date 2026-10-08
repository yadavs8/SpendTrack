package com.spendtrack.app.core.deduplication

import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlin.math.abs

class DeduplicationEngine(
    private val transactionDao: TransactionDao,
    private val timeWindowMillis: Long = 5 * 60 * 1000L // 5 minutes window
) {

    sealed class DeduplicationResult {
        data class NewTransaction(val transaction: TransactionEntity) : DeduplicationResult()
        data class MergedWithExisting(val updatedTransaction: TransactionEntity) : DeduplicationResult()
    }

    suspend fun process(
        parsed: ParsedTransaction,
        normalizedMerchant: String,
        categoryId: String
    ): DeduplicationResult {
        val startWindow = parsed.dateTime - timeWindowMillis
        val endWindow = parsed.dateTime + timeWindowMillis

        // Search for potential candidate transactions in DB
        val candidates = transactionDao.findPotentialDuplicates(
            amount = parsed.amount,
            startWindow = startWindow,
            endWindow = endWindow,
            upiRef = parsed.upiReference
        )

        for (candidate in candidates) {
            // Different UPI references = two real payments (e.g. paying ₹90 twice), never merge them.
            if (!parsed.upiReference.isNullOrBlank() && !candidate.upiReference.isNullOrBlank() &&
                candidate.upiReference != parsed.upiReference) continue

            val isExactRefMatch = !parsed.upiReference.isNullOrBlank() &&
                    candidate.upiReference == parsed.upiReference

            val isSameAmount = candidate.amount == parsed.amount
            val isWithinWindow = abs(candidate.dateTime - parsed.dateTime) <= timeWindowMillis
            val isExactMerchant = isExactMerchantMatch(candidate.merchantName, normalizedMerchant)
            val isFuzzyMerchant = isFuzzyMerchantMatch(candidate.merchantName, normalizedMerchant)
            val isMerchantMatch = isExactMerchant || isFuzzyMerchant || candidate.merchantName.isNullOrBlank() || normalizedMerchant.isBlank()

            val hasConflictingAccount = !parsed.accountLast4.isNullOrBlank() &&
                    !candidate.accountLast4.isNullOrBlank() &&
                    candidate.accountLast4 != parsed.accountLast4

            val hasConflictingRef = !parsed.upiReference.isNullOrBlank() &&
                    !candidate.upiReference.isNullOrBlank() &&
                    candidate.upiReference != parsed.upiReference

            // Candidate and parsed source analysis for dual ingestion pairing
            val candidateIsUpiApp = candidate.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(candidate.sourcePackage)
            val parsedIsUpiApp = parsed.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(parsed.sourcePackage)

            // Comprehensive merge conditions:
            // 1. Exact UPI reference / UTR match
            // 2. Same amount within 5 min for same merchant with no conflicting ref or account (catches repeated notification updates, PhonePe/GPay updates, and SMS)
            // Money in and money out are never the same event unless the bank ref says so (the
            // two legs of a self-transfer share one ref -- merging those is exactly right).
            val sameDirection = isIncoming(candidate.transactionType) == isIncoming(parsed.transactionType)
            val shouldMerge = isExactRefMatch || (
                sameDirection && isSameAmount && isWithinWindow && isMerchantMatch && !hasConflictingRef && !hasConflictingAccount
            )

            // A refund can quote the original payment's ref; it is matched to that expense later, not merged.
            if (isExactRefMatch && !sameDirection &&
                (parsed.transactionType == TransactionType.REFUND || candidate.transactionType == TransactionType.REFUND)) continue

            // Same ref going out *and* coming in on this phone = both legs of a transfer between the
            // user's own accounts. Not spending, not income.
            if (isExactRefMatch && !sameDirection) {
                val transfer = candidate.copy(
                    transactionType = TransactionType.INTERNAL_TRANSFER,
                    isExcluded = true,
                    needsReview = false,
                    needsCloudDelete = candidate.needsCloudDelete || candidate.syncedToCloud,
                    syncedToCloud = false,
                    rawNotificationText = candidate.rawNotificationText ?: parsed.rawText,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(transfer)
                return DeduplicationResult.MergedWithExisting(transfer)
            }

            if (shouldMerge) {
                val bestMerchant = when {
                    candidateIsUpiApp && !candidate.merchantName.isNullOrBlank() -> candidate.merchantName
                    parsedIsUpiApp && !normalizedMerchant.isNullOrBlank() -> normalizedMerchant
                    !candidate.merchantName.isNullOrBlank() -> candidate.merchantName
                    else -> normalizedMerchant
                }
                val merged = candidate.copy(
                    merchantName = bestMerchant,
                    upiReference = candidate.upiReference ?: parsed.upiReference,
                    bankReference = candidate.bankReference ?: parsed.bankReference,
                    accountLast4 = candidate.accountLast4 ?: parsed.accountLast4,
                    bankName = candidate.bankName ?: parsed.bankName,
                    merchantVpa = candidate.merchantVpa ?: parsed.merchantVpa,
                    rawNotificationText = candidate.rawNotificationText ?: parsed.rawText,
                    source = if (candidate.source != parsed.source) "${candidate.source}+${parsed.source}" else candidate.source,
                    confidenceScore = 1.0f,
                    // PRESERVE user's review state: if user already answered/saved, keep it resolved!
                    needsReview = candidate.needsReview,
                    isEdited = candidate.isEdited,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(merged)
                return DeduplicationResult.MergedWithExisting(merged)
            }
        }

        // Check if there is an identical amount within 2 minutes to prevent accidental duplicate taps without dropping real distinct expenses:
        // Flag for user review instead of silently merging or silently ignoring!
        val hasRecentIdenticalAmount = candidates.any {
            it.amount == parsed.amount && abs(it.dateTime - parsed.dateTime) <= (2 * 60 * 1000L) &&
                    (parsed.upiReference.isNullOrBlank() || it.upiReference.isNullOrBlank()) &&
                    isIncoming(it.transactionType) == isIncoming(parsed.transactionType)
        }

        // Only spends ask "where should this go?"; income, withdrawals and transfers are filed by rule.
        val needsReview = parsed.transactionType == TransactionType.EXPENSE &&
                ((parsed.confidenceScore < 0.90f) || hasRecentIdenticalAmount)

        val newEntity = TransactionEntity(
            amount = parsed.amount,
            currency = parsed.currency,
            merchantName = normalizedMerchant,
            merchantVpa = parsed.merchantVpa,
            description = parsed.rawText,
            categoryId = categoryId,
            paymentMethod = parsed.paymentMethod,
            transactionType = parsed.transactionType,
            dateTime = parsed.dateTime, // Preserves exact notification/SMS post time!
            upiReference = parsed.upiReference,
            bankReference = parsed.bankReference,
            accountLast4 = parsed.accountLast4,
            bankName = parsed.bankName,
            source = parsed.source,
            sourcePackage = parsed.sourcePackage,
            rawNotificationText = parsed.rawText,
            confidenceScore = parsed.confidenceScore,
            isManuallyAdded = false,
            needsReview = needsReview,
            // Income and cash withdrawals are kept (they have their own views); transfers never count,
            // and a refund counts only through the expense it reduces.
            isExcluded = parsed.transactionType == TransactionType.INTERNAL_TRANSFER ||
                    parsed.transactionType == TransactionType.REFUND ||
                    parsed.transactionType == TransactionType.UNKNOWN,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        transactionDao.insertTransaction(newEntity)
        return DeduplicationResult.NewTransaction(newEntity)
    }

    private fun isIncoming(type: TransactionType): Boolean =
        type == TransactionType.INCOME || type == TransactionType.REFUND

    private fun isExactMerchantMatch(merchantA: String?, merchantB: String?): Boolean {
        if (merchantA.isNullOrBlank() || merchantB.isNullOrBlank()) return false
        val a = merchantA.trim().lowercase()
        val b = merchantB.trim().lowercase()
        return a == b || (a.length > 3 && b.length > 3 && (a.contains(b) || b.contains(a)))
    }

    private fun isFuzzyMerchantMatch(merchantA: String?, merchantB: String?): Boolean {
        if (merchantA.isNullOrBlank() || merchantB.isNullOrBlank()) return true
        val cleanA = merchantA.lowercase().replace(Regex("[^a-z0-9]"), "")
        val cleanB = merchantB.lowercase().replace(Regex("[^a-z0-9]"), "")
        return cleanA.contains(cleanB) || cleanB.contains(cleanA)
    }
}
