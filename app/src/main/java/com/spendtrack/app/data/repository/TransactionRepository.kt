package com.spendtrack.app.data.repository

import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.model.MoneyLabels
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.normalizer.MerchantNormalizer
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.dao.PaymentMethodSpend
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.datastore.SettingsManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.Calendar
import java.util.UUID

class TransactionRepository(
    private val transactionDao: TransactionDao,
    private val categoryEngine: CategoryEngine,
    private val deduplicationEngine: DeduplicationEngine,
    private val merchantRuleRepository: MerchantRuleRepository,
    private val settingsManager: SettingsManager? = null,
    private val userAccountDao: com.spendtrack.app.data.database.dao.UserAccountDao? = null
) {

    companion object {
        /** A merchant is filed automatically once answered the same way this many times in a row. */
        const val AUTO_FILE_AFTER_ANSWERS = 2
    }

    val allExpenses: Flow<List<TransactionEntity>> = transactionDao.getAllExpenses()
    val needsReviewExpenses: Flow<List<TransactionEntity>> = transactionDao.getNeedsReviewTransactions()

    fun getExpensesForRange(startTime: Long, endTime: Long): Flow<List<TransactionEntity>> =
        transactionDao.getExpensesForRange(startTime, endTime)

    fun getTotalSpentForRange(startTime: Long, endTime: Long): Flow<Double?> =
        transactionDao.getTotalSpentForRange(startTime, endTime)

    fun getTransactionCountForRange(startTime: Long, endTime: Long): Flow<Int> =
        transactionDao.getTransactionCountForRange(startTime, endTime)

    fun getRecentExpenses(limit: Int = 10): Flow<List<TransactionEntity>> =
        transactionDao.getRecentExpenses(limit)

    fun getCategorySpends(startTime: Long, endTime: Long): Flow<List<CategorySpend>> =
        transactionDao.getCategorySpends(startTime, endTime)

    fun getPaymentMethodSpends(startTime: Long, endTime: Long): Flow<List<PaymentMethodSpend>> =
        transactionDao.getPaymentMethodSpends(startTime, endTime)

    /** Unanswered, still-counted payments -- the number the widget shows. */
    suspend fun countAwaitingChoice(): Int =
        transactionDao.getNeedsReviewTransactionsSync().count { !it.isExcluded }

    /**
     * A cash spend typed in from the widget / app shortcut. Returns its id so it can be filed
     * straight away (Personal, Family, trip...) through the same path as a detected payment.
     */
    suspend fun addCashExpense(amount: Double, note: String?): String {
        val label = note?.trim()?.takeIf { it.isNotBlank() }
        val now = System.currentTimeMillis()
        val entity = TransactionEntity(
            amount = amount,
            merchantName = label ?: "Cash",
            description = label,
            categoryId = "cat_other",
            paymentMethod = PaymentMethod.CASH,
            transactionType = TransactionType.EXPENSE,
            dateTime = now,
            source = "MANUAL",
            isManuallyAdded = true,
            isEdited = label != null,
            needsReview = false,
            createdAt = now,
            updatedAt = now
        )
        transactionDao.insertTransaction(entity)
        return entity.id
    }

    suspend fun getTransactionById(id: String): TransactionEntity? =
        transactionDao.getTransactionById(id)

    // Truecaller and Messages post the same bank SMS within milliseconds. Processed in parallel, both
    // would pass the duplicate check before either is saved -- two rows, two prompts. One at a time.
    private val ingestMutex = Mutex()

    /**
     * Ingest a parsed payment: normalise, deduplicate, then decide whether to ask the user.
     *
     * Filed without asking: own-account transfers (excluded -- moving your own money is not
     * spending), investments, and merchants answered the same way twice in a row. During an active
     * trip the merchant memory is skipped and the user is always asked (trip offered first): the
     * petrol pump you use every week could be trip fuel today.
     */
    suspend fun ingestTransaction(parsed: ParsedTransaction): DeduplicationEngine.DeduplicationResult = ingestMutex.withLock {
        val normalizedMerchant = MerchantNormalizer.normalize(parsed.merchantRaw, parsed.merchantVpa)
        val categoryResult = categoryEngine.resolveCategory(normalizedMerchant, parsed.merchantVpa)

        val result = deduplicationEngine.process(
            parsed = parsed,
            normalizedMerchant = normalizedMerchant,
            categoryId = categoryResult.categoryId
        )

        if (result !is DeduplicationEngine.DeduplicationResult.NewTransaction) return@withLock result

        when (result.transaction.transactionType) {
            TransactionType.INCOME -> return@withLock DeduplicationEngine.DeduplicationResult.NewTransaction(fileIncome(result.transaction, parsed.incomeKind))
            TransactionType.REFUND -> return@withLock DeduplicationEngine.DeduplicationResult.NewTransaction(fileRefund(result.transaction))
            TransactionType.CASH_WITHDRAWAL -> {
                val w = result.transaction.copy(
                    description = MoneyLabels.cashWithdrawal(result.transaction.bankName),
                    isEdited = true,
                    needsReview = false,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(w)
                return@withLock DeduplicationEngine.DeduplicationResult.NewTransaction(w)
            }
            TransactionType.EXPENSE -> Unit
            else -> return@withLock result
        }
        if (result.transaction.isExcluded) return@withLock result

        val txn = applyRegisteredCard(result.transaction)
        val now = System.currentTimeMillis()
        // Already flagged by dedup (low-confidence parse, or a same-amount payment moments ago):
        // that needs a human look, never an automatic filing.
        if (txn.needsReview) return@withLock result

        val raw = txn.rawNotificationText ?: txn.description
        val owners = ExpenseScope.parseOwners(runCatching { settingsManager?.ownerIdentityFlow?.first() }.getOrNull())
        val activeTrip = runCatching { settingsManager?.activeTripNameFlow?.first() }.getOrNull()
        val merchantKey = txn.merchantName ?: txn.merchantVpa
        val rule = if (!merchantKey.isNullOrBlank()) merchantRuleRepository.findMatchingRule(merchantKey) else null

        val updated = when {
            ExpenseScope.isSelfPayment(txn.merchantName, txn.merchantVpa, raw, owners) -> txn.copy(
                transactionType = TransactionType.INTERNAL_TRANSFER,
                isExcluded = true,
                needsReview = false,
                updatedAt = now
            )
            ExpenseScope.isInvestment(txn.merchantName, txn.merchantVpa, raw) -> txn.copy(
                description = ExpenseScope.describe(txn.merchantName, txn.description, txn.isEdited, ExpenseScope.INVESTMENT),
                categoryId = "cat_financial",
                needsReview = false,
                isEdited = true,
                updatedAt = now
            )
            activeTrip.isNullOrBlank() && rule?.scope != null && rule.scopeConfirmations >= AUTO_FILE_AFTER_ANSWERS -> txn.copy(
                description = ExpenseScope.describe(txn.merchantName, txn.description, txn.isEdited, rule.scope),
                categoryId = rule.categoryId.takeIf { it.isNotBlank() && it != "cat_other" } ?: txn.categoryId,
                needsReview = false,
                isEdited = true,
                updatedAt = now
            )
            else -> txn.copy(needsReview = true, updatedAt = now)
        }
        transactionDao.updateTransaction(updated)
        DeduplicationEngine.DeduplicationResult.NewTransaction(updated)
    }

    /** Undo an automatically logged income: excluded locally, and removed from Kharcha Book by ref. */
    suspend fun undoAutoIncome(transactionId: String) {
        val txn = transactionDao.getTransactionById(transactionId) ?: return
        if (txn.transactionType != TransactionType.INCOME) return
        val hasRef = !txn.upiReference.isNullOrBlank() || !txn.bankReference.isNullOrBlank()
        transactionDao.updateTransaction(
            txn.copy(
                isExcluded = true,
                needsCloudDelete = txn.syncedToCloud && hasRef,
                syncedToCloud = if (hasRef) false else txn.syncedToCloud,
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    /**
     * A card the user registered in Settings → Accounts is classified by what they said it is
     * (credit / debit), whatever the SMS wording suggested.
     */
    private suspend fun applyRegisteredCard(txn: TransactionEntity): TransactionEntity {
        val last4 = txn.accountLast4?.takeIf { it.length >= 3 } ?: return txn
        if (txn.paymentMethod != PaymentMethod.CREDIT_CARD && txn.paymentMethod != PaymentMethod.DEBIT_CARD) return txn
        val account = runCatching { userAccountDao?.findAccountByLast4(last4) }.getOrNull() ?: return txn
        val method = when (account.accountType) {
            com.spendtrack.app.data.database.entity.AccountType.CREDIT_CARD -> PaymentMethod.CREDIT_CARD
            com.spendtrack.app.data.database.entity.AccountType.SAVINGS,
            com.spendtrack.app.data.database.entity.AccountType.CURRENT -> PaymentMethod.DEBIT_CARD
            else -> return txn
        }
        if (method == txn.paymentMethod && txn.bankName != null) return txn
        val fixed = txn.copy(paymentMethod = method, bankName = txn.bankName ?: account.bankName)
        transactionDao.updateTransaction(fixed)
        return fixed
    }

    /**
     * Money in: own-account transfers are dropped (both legs of a self-transfer already cancel out
     * by ref in the duplicate check; this catches the rest by the owner's names). Credits from the
     * people set as family payers are Maa's reimbursements; everything else is labelled by kind.
     */
    private suspend fun fileIncome(txn: TransactionEntity, kind: String?): TransactionEntity {
        val now = System.currentTimeMillis()
        val raw = txn.rawNotificationText ?: txn.description
        val owners = ExpenseScope.parseOwners(runCatching { settingsManager?.ownerIdentityFlow?.first() }.getOrNull())
        val autoIncome = runCatching { settingsManager?.automationFlow(SettingsManager.KEY_AUTO_INCOME)?.first() }.getOrNull() ?: true
        val updated = if (!autoIncome || ExpenseScope.isSelfPayment(txn.merchantName, txn.merchantVpa, raw, owners)) {
            txn.copy(
                transactionType = if (autoIncome) TransactionType.INTERNAL_TRANSFER else TransactionType.INCOME,
                isExcluded = true,
                needsReview = false,
                updatedAt = now
            )
        } else {
            val family = ExpenseScope.parseOwners(runCatching { settingsManager?.familyPayersFlow?.first() }.getOrNull())
            val fromFamily = ExpenseScope.isFromPeople(txn.merchantName, txn.merchantVpa, family)
            txn.copy(
                description = MoneyLabels.income(kind, txn.merchantName, txn.bankName, fromFamily),
                categoryId = "cat_financial",
                isEdited = true,
                needsReview = false,
                updatedAt = now
            )
        }
        transactionDao.updateTransaction(updated)
        return updated
    }

    /**
     * Money back for an earlier spend. Matched to that expense (by the payment's ref quoted in the
     * refund, else by merchant name and an amount it could cover, within 90 days) and the expense
     * is reduced -- so totals show what was really spent. If nothing matches (e.g. the purchase
     * happened before the app was installed), it is logged as income instead, so the money is
     * still accounted for.
     */
    private suspend fun fileRefund(refund: TransactionEntity): TransactionEntity {
        val now = System.currentTimeMillis()
        val raw = (refund.rawNotificationText ?: refund.description ?: "").lowercase()
        val byRef = listOfNotNull(refund.upiReference, refund.bankReference).firstNotNullOfOrNull { transactionDao.findExpenseByRef(it) }
        val original = byRef?.takeIf { it.amount - it.refundedAmount >= refund.amount - 0.005 } ?: run {
            val candidates = transactionDao.findRefundCandidates(refund.amount, refund.dateTime - 90L * 24 * 3600 * 1000, refund.dateTime)
            candidates.firstOrNull { c ->
                val name = c.merchantName?.lowercase()?.trim().orEmpty()
                val core = name.split(' ').firstOrNull { it.length >= 4 }
                (name.length >= 3 && raw.contains(name)) || (core != null && raw.contains(core)) ||
                    (!c.merchantVpa.isNullOrBlank() && raw.contains(c.merchantVpa.lowercase())) ||
                    (!refund.merchantName.isNullOrBlank() && name.isNotBlank() &&
                        refund.merchantName.lowercase().let { it.contains(name) || name.contains(it) })
            }
        }

        if (original != null) {
            val hasRef = !original.upiReference.isNullOrBlank() || !original.bankReference.isNullOrBlank()
            // Kharcha Book can only be corrected through the ref; an already-pushed expense without
            // one can't be updated there, so log the refund as income instead (keeps totals honest).
            if (hasRef || !original.syncedToCloud) {
                val refunded = (original.refundedAmount + refund.amount).coerceAtMost(original.amount)
                val fully = original.amount - refunded < 0.005
                val updatedOriginal = original.copy(
                    refundedAmount = refunded,
                    isRefunded = true,
                    // Fully refunded: remove it from Kharcha Book; partly: re-push the reduced amount.
                    needsCloudDelete = fully && original.syncedToCloud,
                    isExcluded = fully,
                    syncedToCloud = false,
                    updatedAt = now
                )
                transactionDao.updateTransaction(updatedOriginal)
                val linked = refund.copy(linkedTransactionId = original.id, isExcluded = true, needsReview = false, updatedAt = now)
                transactionDao.updateTransaction(linked)
                return linked
            }
        }

        val asIncome = refund.copy(
            transactionType = TransactionType.INCOME,
            description = MoneyLabels.unmatchedRefund(refund.merchantName),
            isExcluded = false,
            isEdited = true,
            needsReview = false,
            updatedAt = now
        )
        transactionDao.updateTransaction(asIncome)
        return asIncome
    }

    /**
     * Resolves a "what's this for?" prompt: either a quick category tap, or a typed note from the
     * notification's inline reply. Learns a merchant rule so the same vendor auto-categorizes next time.
     */
    suspend fun resolveNeedsReview(
        transactionId: String,
        categoryId: String? = null,
        categoryName: String? = null,
        note: String? = null
    ) {
        val transaction = transactionDao.getTransactionById(transactionId) ?: return

        if (categoryId != null && categoryName != null) {
            val merchant = transaction.merchantName
            if (!merchant.isNullOrBlank()) {
                merchantRuleRepository.saveRule(
                    merchantPattern = merchant,
                    categoryId = categoryId,
                    categoryName = categoryName
                )
            }
        }

        val updated = transaction.copy(
            categoryId = categoryId ?: transaction.categoryId,
            description = note?.takeIf { it.isNotBlank() } ?: transaction.description,
            needsReview = false,
            isEdited = note?.isNotBlank() == true || transaction.isEdited,
            syncedToCloud = keepSyncedFlagAfterEdit(transaction),
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)
    }

    /** Resolves the "Personal, Family, Investment, or Trip?" prompt for an auto-detected expense and remembers the merchant scope. */
    /** Returns the ids of duplicate copies that were resolved along with it (their prompts must be cleared too). */
    suspend fun resolveScope(
        transactionId: String,
        scope: String,
        tripName: String? = null
    ): List<String> {
        val transaction = transactionDao.getTransactionById(transactionId) ?: return emptyList()

        // Auto-learn / remember user's scope decision for this merchant so they are never asked again! (unless it's a temporary trip)
        val merchantKey = transaction.merchantName ?: transaction.merchantVpa
        // Trips and projects are temporary, so they never train the per-merchant memory.
        if (!merchantKey.isNullOrBlank() &&
            !scope.equals(ExpenseScope.TRIP, ignoreCase = true) &&
            !scope.equals(ExpenseScope.PROJECT, ignoreCase = true)) {
            merchantRuleRepository.saveScopeRule(merchantKey, scope)
        }

        val updated = transaction.copy(
            description = ExpenseScope.describe(
                merchantName = transaction.merchantName,
                description = transaction.description,
                isEdited = transaction.isEdited,
                scope = scope,
                tripName = tripName
            ),
            needsReview = false,
            isEdited = true,
            syncedToCloud = keepSyncedFlagAfterEdit(transaction),
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)

        // Copies of the same payment saved before the duplicate guard existed: resolve them too.
        return resolveCompanionDuplicates(transaction)
    }

    /**
     * Unanswered copies of the same payment (same bank/UPI ref, or same merchant and amount minutes
     * apart with no conflicting ref) are marked excluded so they never count twice or re-prompt.
     * A different merchant with the same amount is a different payment and is left alone.
     */
    private suspend fun resolveCompanionDuplicates(primary: TransactionEntity): List<String> {
        val window = 10 * 60 * 1000L
        val companions = transactionDao.findPotentialDuplicates(
            amount = primary.amount,
            startWindow = primary.dateTime - window,
            endWindow = primary.dateTime + window,
            upiRef = primary.upiReference
        )
        val resolvedIds = mutableListOf<String>()
        for (c in companions) {
            if (c.id == primary.id || !c.needsReview) continue
            val sameRef = !primary.upiReference.isNullOrBlank() && c.upiReference == primary.upiReference
            val conflictingRef = !primary.upiReference.isNullOrBlank() && !c.upiReference.isNullOrBlank() &&
                    c.upiReference != primary.upiReference
            val sameMerchant = !c.merchantName.isNullOrBlank() && c.merchantName.equals(primary.merchantName, ignoreCase = true)
            if (conflictingRef || !(sameRef || sameMerchant)) continue
            transactionDao.updateTransaction(
                c.copy(needsReview = false, isExcluded = true, updatedAt = System.currentTimeMillis())
            )
            resolvedIds += c.id
        }
        return resolvedIds
    }

    /**
     * Self-healing repair: scans all currently unreviewed transactions in the database.
     * If any match investment brokers/clearing houses (like India Clearing Corp) or self-transfers,
     * auto-resolves them immediately so user does not have to manually re-enter anything.
     */
    suspend fun repairAndAutoRouteInvestments(): Int {
        val unreviewed = transactionDao.getNeedsReviewTransactionsSync()
        val owners = ExpenseScope.parseOwners(runCatching { settingsManager?.ownerIdentityFlow?.first() }.getOrNull())
        var fixedCount = 0
        for (txn in unreviewed) {
            val raw = txn.rawNotificationText ?: txn.description
            val isInvestment = ExpenseScope.isInvestment(txn.merchantName, txn.merchantVpa, raw)
            val isSelf = ExpenseScope.isSelfPayment(txn.merchantName, txn.merchantVpa, raw, owners)

            if (isInvestment) {
                val resolved = txn.copy(
                    description = ExpenseScope.describe(
                        merchantName = txn.merchantName,
                        description = txn.description,
                        isEdited = txn.isEdited,
                        scope = ExpenseScope.INVESTMENT
                    ),
                    categoryId = "cat_financial",
                    needsReview = false,
                    isEdited = true,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(resolved)
                fixedCount++
            } else if (isSelf) {
                // Moving money between your own accounts is not spending.
                val resolved = txn.copy(
                    transactionType = TransactionType.INTERNAL_TRANSFER,
                    isExcluded = true,
                    needsReview = false,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(resolved)
                fixedCount++
            }
        }
        return fixedCount
    }

    /**
     * An expense with a bank/UPI ref may already be in Kharcha Book (synced before it was answered);
     * re-pushing it upserts the same row by ref_no, so clear the flag. Without a ref a re-push would
     * insert a duplicate -- those are only ever synced after being answered, so leave them alone.
     */
    private fun keepSyncedFlagAfterEdit(transaction: TransactionEntity): Boolean {
        val hasRef = !transaction.upiReference.isNullOrBlank() || !transaction.bankReference.isNullOrBlank()
        return if (hasRef) false else transaction.syncedToCloud
    }

    /**
     * Add manual expense (e.g. Cash, card, manual UPI).
     */
    suspend fun addManualExpense(
        amount: Double,
        merchantName: String,
        categoryId: String,
        paymentMethod: PaymentMethod,
        dateTime: Long = System.currentTimeMillis(),
        description: String? = null
    ): Long {
        val normalized = MerchantNormalizer.normalize(merchantName)
        val entity = TransactionEntity(
            id = UUID.randomUUID().toString(),
            amount = amount,
            currency = "INR",
            merchantName = normalized,
            description = description,
            categoryId = categoryId,
            paymentMethod = paymentMethod,
            transactionType = TransactionType.EXPENSE,
            dateTime = dateTime,
            source = "MANUAL",
            confidenceScore = 1.0f,
            isManuallyAdded = true,
            needsReview = false,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
        return transactionDao.insertTransaction(entity)
    }

    /**
     * Update an existing transaction and learn user's merchant categorization preference.
     */
    suspend fun updateTransaction(
        transaction: TransactionEntity,
        newCategoryId: String? = null,
        newCategoryName: String? = null,
        newMerchantName: String? = null,
        newAmount: Double? = null,
        newPaymentMethod: PaymentMethod? = null
    ) {
        val updatedMerchant = newMerchantName?.let { MerchantNormalizer.normalize(it) } ?: transaction.merchantName
        val updatedCategory = newCategoryId ?: transaction.categoryId

        // Learn user rule if category was updated
        if (newCategoryId != null && !updatedMerchant.isNullOrBlank() && newCategoryName != null) {
            merchantRuleRepository.saveRule(
                merchantPattern = updatedMerchant,
                categoryId = newCategoryId,
                categoryName = newCategoryName
            )
        }

        val updated = transaction.copy(
            merchantName = updatedMerchant,
            categoryId = updatedCategory,
            amount = newAmount ?: transaction.amount,
            paymentMethod = newPaymentMethod ?: transaction.paymentMethod,
            isEdited = true,
            needsReview = false,
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)
    }

    suspend fun confirmTransaction(transaction: TransactionEntity) {
        val updated = transaction.copy(
            needsReview = false,
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)
    }

    suspend fun excludeTransaction(transaction: TransactionEntity, isExcluded: Boolean) {
        val updated = transaction.copy(
            isExcluded = isExcluded,
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)
    }

    suspend fun markAsRefund(transaction: TransactionEntity) {
        val updated = transaction.copy(
            transactionType = TransactionType.REFUND,
            isExcluded = true,
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)
    }

    suspend fun deleteTransaction(transaction: TransactionEntity) {
        transactionDao.deleteTransaction(transaction)
    }

    suspend fun deleteTransactionById(id: String) {
        transactionDao.deleteById(id)
    }

    suspend fun clearDemoData() {
        transactionDao.deleteDemoTransactions()
    }

    suspend fun generateDemoData() {
        // Clear old demo transactions first
        transactionDao.deleteDemoTransactions()

        val now = System.currentTimeMillis()
        val cal = Calendar.getInstance()

        // Helper to get time today or N days ago
        fun getPastTime(daysAgo: Int, hour: Int, minute: Int): Long {
            cal.timeInMillis = now
            cal.add(Calendar.DAY_OF_YEAR, -daysAgo)
            cal.set(Calendar.HOUR_OF_DAY, hour)
            cal.set(Calendar.MINUTE, minute)
            return cal.timeInMillis
        }

        val demoList = listOf(
            TransactionEntity(
                amount = 450.0,
                merchantName = "Swiggy",
                merchantVpa = "swiggy@icici",
                categoryId = "cat_food",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(0, 13, 15), // Today
                source = "NOTIFICATION",
                sourcePackage = "com.google.android.apps.nbu.paisa.user",
                isDemo = true
            ),
            TransactionEntity(
                amount = 40.0,
                merchantName = "Chai Point",
                categoryId = "cat_food",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(0, 10, 30), // Today
                source = "NOTIFICATION",
                sourcePackage = "com.phonepe.app",
                isDemo = true
            ),
            TransactionEntity(
                amount = 245.0,
                merchantName = "Uber",
                merchantVpa = "uber@axisbank",
                categoryId = "cat_transport",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(0, 9, 15), // Today
                source = "NOTIFICATION",
                sourcePackage = "net.one97.paytm",
                isDemo = true
            ),
            TransactionEntity(
                amount = 1299.0,
                merchantName = "Amazon",
                merchantVpa = "amazonpay@icici",
                categoryId = "cat_shopping",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(1, 16, 45), // Yesterday
                source = "NOTIFICATION",
                sourcePackage = "com.google.android.apps.nbu.paisa.user",
                isDemo = true
            ),
            TransactionEntity(
                amount = 2000.0,
                merchantName = "HPCL Fuel",
                categoryId = "cat_transport",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(2, 11, 20), // 2 days ago
                source = "NOTIFICATION",
                sourcePackage = "com.phonepe.app",
                isDemo = true
            ),
            TransactionEntity(
                amount = 649.0,
                merchantName = "Netflix",
                categoryId = "cat_entertainment",
                paymentMethod = PaymentMethod.CREDIT_CARD,
                dateTime = getPastTime(3, 19, 0), // 3 days ago
                source = "SMS",
                isDemo = true
            ),
            TransactionEntity(
                amount = 1500.0,
                merchantName = "Gym Membership",
                categoryId = "cat_health",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(4, 8, 30),
                source = "NOTIFICATION",
                isDemo = true
            ),
            TransactionEntity(
                amount = 200.0,
                merchantName = "Street Food Snacks",
                categoryId = "cat_food",
                paymentMethod = PaymentMethod.CASH,
                dateTime = getPastTime(5, 17, 40),
                source = "MANUAL",
                isManuallyAdded = true,
                isDemo = true
            ),
            TransactionEntity(
                amount = 1199.0,
                merchantName = "Airtel Broadband",
                categoryId = "cat_bills",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(6, 14, 10),
                source = "NOTIFICATION",
                isDemo = true
            ),
            TransactionEntity(
                amount = 350.0,
                merchantName = "Apollo Pharmacy",
                categoryId = "cat_health",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(10, 18, 50),
                source = "NOTIFICATION",
                isDemo = true
            ),
            TransactionEntity(
                amount = 4500.0,
                merchantName = "BigBasket Groceries",
                categoryId = "cat_food",
                paymentMethod = PaymentMethod.UPI,
                dateTime = getPastTime(14, 12, 0),
                source = "NOTIFICATION",
                isDemo = true
            )
        )

        transactionDao.insertTransactions(demoList)
    }

    suspend fun getAllTransactionsSync(): List<TransactionEntity> =
        transactionDao.getAllTransactionsSync()
}
