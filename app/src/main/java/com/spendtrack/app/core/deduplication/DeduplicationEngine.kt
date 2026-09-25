package com.spendtrack.app.core.deduplication

import com.spendtrack.app.core.model.ParsedTransaction
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
            // UPI apps frequently re-post or update the same notification; that is not a new payment
            val isSameMessageRepost = !parsed.rawText.isNullOrBlank() &&
                    candidate.description == parsed.rawText &&
                    candidate.sourcePackage == parsed.sourcePackage &&
                    candidate.amount == parsed.amount &&
                    abs(candidate.dateTime - parsed.dateTime) <= timeWindowMillis
            if (isSameMessageRepost) {
                return DeduplicationResult.MergedWithExisting(candidate)
            }

            val isExactRefMatch = !parsed.upiReference.isNullOrBlank() &&
                    candidate.upiReference == parsed.upiReference

            val isSameAmount = candidate.amount == parsed.amount
            val isWithinWindow = abs(candidate.dateTime - parsed.dateTime) <= timeWindowMillis
            val isExactMerchant = isExactMerchantMatch(candidate.merchantName, normalizedMerchant)
            val isSameAccount = !parsed.accountLast4.isNullOrBlank() &&
                    candidate.accountLast4 == parsed.accountLast4

            // Strict auto-merge condition:
            // 1. Exact UPI reference / UTR match
            // 2. OR: Same amount + within window + same account + same merchant
            // 3. OR: Different source (Notification vs SMS) for exact same merchant and amount within window
            val isMultiSourcePair = candidate.source != parsed.source && isSameAmount && isWithinWindow && isExactMerchant

            if (isExactRefMatch || (isSameAmount && isWithinWindow && isSameAccount && isExactMerchant) || isMultiSourcePair) {
                val merged = candidate.copy(
                    upiReference = candidate.upiReference ?: parsed.upiReference,
                    bankReference = candidate.bankReference ?: parsed.bankReference,
                    accountLast4 = candidate.accountLast4 ?: parsed.accountLast4,
                    merchantVpa = candidate.merchantVpa ?: parsed.merchantVpa,
                    source = if (candidate.source != parsed.source) "${candidate.source}+${parsed.source}" else candidate.source,
                    confidenceScore = 1.0f,
                    needsReview = false,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(merged)
                return DeduplicationResult.MergedWithExisting(merged)
            }
        }

        // Check if there is an identical amount within 2 minutes to prevent accidental duplicate taps without dropping real distinct expenses:
        // Flag for user review instead of silently merging or silently ignoring!
        val hasRecentIdenticalAmount = candidates.any {
            it.amount == parsed.amount && abs(it.dateTime - parsed.dateTime) <= (2 * 60 * 1000L)
        }

        val needsReview = (parsed.confidenceScore < 0.90f) || hasRecentIdenticalAmount

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
            source = parsed.source,
            sourcePackage = parsed.sourcePackage,
            confidenceScore = parsed.confidenceScore,
            isManuallyAdded = false,
            needsReview = needsReview,
            isExcluded = !parsed.transactionType.isExpense,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        transactionDao.insertTransaction(newEntity)
        return DeduplicationResult.NewTransaction(newEntity)
    }

    private fun isExactMerchantMatch(merchantA: String?, merchantB: String?): Boolean {
        if (merchantA.isNullOrBlank() || merchantB.isNullOrBlank()) return false
        val a = merchantA.trim().lowercase()
        val b = merchantB.trim().lowercase()
        return a == b || (a.length > 3 && b.length > 3 && (a.contains(b) || b.contains(a)))
    }
}
