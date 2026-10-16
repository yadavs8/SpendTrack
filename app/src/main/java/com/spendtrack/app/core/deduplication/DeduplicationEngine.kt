package com.spendtrack.app.core.deduplication

import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlin.math.abs

class DeduplicationEngine(
    private val transactionDao: TransactionDao,
    private val timeWindowMillis: Long = 15 * 60 * 1000L // 15 minutes window
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
        val parsedRef = parsed.upiReference?.takeIf { it.isNotBlank() }
            ?: parsed.bankReference?.takeIf { it.isNotBlank() }

        // Search for potential candidate transactions in DB
        val candidates = transactionDao.findPotentialDuplicates(
            amount = parsed.amount,
            startWindow = startWindow,
            endWindow = endWindow,
            upiRef = parsedRef
        )

        // "Unknown Merchant" is the normaliser's placeholder, not a name: it must match like an empty one.
        val knownMerchant = normalizedMerchant.takeUnless { isUnknownMerchant(it) }.orEmpty()

        for (candidate in candidates) {
            val candidateMerchant = candidate.merchantName?.takeUnless { isUnknownMerchant(it) }
            val candidateRef = candidate.upiReference?.takeIf { it.isNotBlank() }
                ?: candidate.bankReference?.takeIf { it.isNotBlank() }

            // Different UPI/bank references = two real payments (e.g. paying ₹90 twice), never merge them.
            if (!parsedRef.isNullOrBlank() && !candidateRef.isNullOrBlank() &&
                candidateRef != parsedRef) continue

            val isExactRefMatch = !parsedRef.isNullOrBlank() && candidateRef == parsedRef

            val isSameAmount = candidate.amount == parsed.amount
            val timeDiff = abs(candidate.dateTime - parsed.dateTime)
            val isWithinWindow = timeDiff <= timeWindowMillis
            val isWithin10Min = timeDiff <= 10 * 60 * 1000L
            val isExactMerchant = isExactMerchantMatch(candidateMerchant, knownMerchant)
            val isFuzzyMerchant = !candidateMerchant.isNullOrBlank() && knownMerchant.isNotBlank() &&
                isFuzzyMerchantMatch(candidateMerchant, knownMerchant)
            val isMerchantMatch = isExactMerchant || isFuzzyMerchant || candidateMerchant.isNullOrBlank() || knownMerchant.isBlank()

            val hasConflictingAccount = !parsed.accountLast4.isNullOrBlank() &&
                    !candidate.accountLast4.isNullOrBlank() &&
                    candidate.accountLast4 != parsed.accountLast4

            val hasConflictingRef = !parsedRef.isNullOrBlank() &&
                    !candidateRef.isNullOrBlank() &&
                    candidateRef != parsedRef

            // Candidate and parsed source analysis for dual ingestion pairing (e.g., GPay notification + Bank SMS)
            val candidateIsUpiApp = candidate.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(candidate.sourcePackage)
            val parsedIsUpiApp = parsed.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(parsed.sourcePackage)
            val isComplementaryDualSource = (candidateIsUpiApp != parsedIsUpiApp) || (candidate.source != parsed.source)

            val hasAnyRefEvidence = !parsedRef.isNullOrBlank() || !candidateRef.isNullOrBlank()
            val hasRealMerchantMatch = isExactMerchant || isFuzzyMerchant
            val heuristicMergeAllowed = hasAnyRefEvidence || hasRealMerchantMatch
            val sameDirection = isIncoming(candidate.transactionType) == isIncoming(parsed.transactionType)
            val shouldMerge = isExactRefMatch || (
                sameDirection && isSameAmount && !hasConflictingRef && !hasConflictingAccount && (
                    (isWithinWindow && isMerchantMatch && heuristicMergeAllowed) ||
                    (isWithin10Min && hasAnyRefEvidence && (isComplementaryDualSource || !candidate.needsReview))
                )
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

            if (shouldMerge) return mergeInto(candidate, parsed, normalizedMerchant)
        }

        // Smart pass: the same payment told by different senders, hours or a day apart (bank debit SMS,
        // then the insurer's "premium received", then the dealer's WhatsApp). See SmartMatcher.
        var possibleDuplicateOf: String? = null
        if (parsed.transactionType == TransactionType.EXPENSE || parsed.transactionType == TransactionType.INCOME) {
            val me = SmartMatcher.Msg(
                amount = parsed.amount,
                time = parsed.dateTime,
                merchant = knownMerchant.ifBlank { null },
                vpa = parsed.merchantVpa,
                rawText = parsed.rawText,
                ref = parsedRef,
                last4 = parsed.accountLast4,
                source = parsed.source,
                sourcePackage = parsed.sourcePackage,
                incoming = isIncoming(parsed.transactionType)
            )
            val wide = transactionDao.findAmountNear(
                amountLow = parsed.amount - 1.0,
                amountHigh = parsed.amount + 1.0,
                startWindow = parsed.dateTime - SmartMatcher.MAX_WINDOW_MS,
                endWindow = parsed.dateTime + SmartMatcher.MAX_WINDOW_MS
            )
            var best: TransactionEntity? = null
            var bestScore = 0.0
            for (c in wide) {
                // Typed in by hand is matched separately (PromptReconciler); an own transfer is never a spend.
                if (c.isManuallyAdded || c.transactionType != parsed.transactionType) continue
                val score = SmartMatcher.score(me, toMsg(c)) ?: continue
                if (score > bestScore) { best = c; bestScore = score }
            }
            if (best != null && bestScore >= SmartMatcher.SAME_PAYMENT) return mergeInto(best, parsed, normalizedMerchant)
            if (best != null && bestScore >= SmartMatcher.MAYBE_SAME && parsed.transactionType == TransactionType.EXPENSE) {
                possibleDuplicateOf = best.id // not sure: ask "same payment?" instead of guessing either way
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
                ((parsed.confidenceScore < 0.90f) || hasRecentIdenticalAmount || possibleDuplicateOf != null)

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
            // EXPENSE: the earlier entry this may be a second copy of (the prompt asks "same payment?").
            linkedTransactionId = possibleDuplicateOf,
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

    /** Folds a second copy of a payment into the entry already recorded for it. */
    private suspend fun mergeInto(
        candidate: TransactionEntity,
        parsed: ParsedTransaction,
        normalizedMerchant: String
    ): DeduplicationResult {
        val candidateIsUpiApp = candidate.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(candidate.sourcePackage)
        val parsedIsUpiApp = parsed.sourcePackage != null && com.spendtrack.app.core.parser.TransactionParser.MONITORED_UPI_PACKAGES.contains(parsed.sourcePackage)
        val candidateMerchant = candidate.merchantName?.takeUnless { isUnknownMerchant(it) }
        val parsedMerchant = normalizedMerchant.takeUnless { isUnknownMerchant(it) }
        val bestMerchant = when {
            candidateIsUpiApp && !candidateMerchant.isNullOrBlank() -> candidateMerchant
            parsedIsUpiApp && !parsedMerchant.isNullOrBlank() -> parsedMerchant
            !candidateMerchant.isNullOrBlank() -> candidateMerchant
            !parsedMerchant.isNullOrBlank() -> parsedMerchant
            else -> candidate.merchantName ?: normalizedMerchant
        }
        // A row already in Kharcha Book without a ref must not gain one now: the next upsert would be
        // keyed on the new ref and add a second row there instead of updating this one.
        val keepRefsAsIs = candidate.syncedToCloud &&
            candidate.upiReference.isNullOrBlank() && candidate.bankReference.isNullOrBlank()
        val merged = candidate.copy(
            merchantName = bestMerchant,
            upiReference = if (keepRefsAsIs) candidate.upiReference else candidate.upiReference ?: parsed.upiReference,
            bankReference = if (keepRefsAsIs) candidate.bankReference else candidate.bankReference ?: parsed.bankReference,
            accountLast4 = candidate.accountLast4 ?: parsed.accountLast4,
            bankName = candidate.bankName ?: parsed.bankName,
            merchantVpa = candidate.merchantVpa ?: parsed.merchantVpa,
            rawNotificationText = candidate.rawNotificationText ?: parsed.rawText,
            source = if (candidate.source != parsed.source && !candidate.source.contains(parsed.source)) "${candidate.source}+${parsed.source}" else candidate.source,
            confidenceScore = 1.0f,
            // PRESERVE user's review state: if user already answered/saved, keep it resolved!
            needsReview = candidate.needsReview,
            isEdited = candidate.isEdited,
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(merged)
        return DeduplicationResult.MergedWithExisting(merged)
    }

    private fun isUnknownMerchant(name: String?): Boolean =
        name.isNullOrBlank() || name.trim().equals("Unknown Merchant", ignoreCase = true)

    private fun isIncoming(type: TransactionType): Boolean =
        type == TransactionType.INCOME || type == TransactionType.REFUND

    companion object {
        fun toMsg(t: TransactionEntity): SmartMatcher.Msg = SmartMatcher.Msg(
            amount = t.amount,
            time = t.dateTime,
            merchant = t.merchantName,
            vpa = t.merchantVpa,
            rawText = t.rawNotificationText,
            ref = t.upiReference?.takeIf { it.isNotBlank() } ?: t.bankReference?.takeIf { it.isNotBlank() },
            last4 = t.accountLast4,
            source = t.source,
            sourcePackage = t.sourcePackage,
            incoming = t.transactionType == TransactionType.INCOME || t.transactionType == TransactionType.REFUND
        )
    }

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
