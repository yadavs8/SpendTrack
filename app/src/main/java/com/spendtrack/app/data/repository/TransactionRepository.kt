package com.spendtrack.app.data.repository

import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.normalizer.MerchantNormalizer
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.dao.PaymentMethodSpend
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlinx.coroutines.flow.Flow
import java.util.Calendar
import java.util.UUID

class TransactionRepository(
    private val transactionDao: TransactionDao,
    private val categoryEngine: CategoryEngine,
    private val deduplicationEngine: DeduplicationEngine,
    private val merchantRuleRepository: MerchantRuleRepository
) {

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

    suspend fun getTransactionById(id: String): TransactionEntity? =
        transactionDao.getTransactionById(id)

    /**
     * Ingest an incoming parsed transaction through normalization, categorization, and deduplication.
     * Every new real expense is flagged `needsReview` -- the signal the notification listener uses to
     * ask "Personal or Family?". Refunds and own-account transfers (isExcluded) never count toward
     * spending, so they are never asked about.
     */
    suspend fun ingestTransaction(parsed: ParsedTransaction): DeduplicationEngine.DeduplicationResult {
        val normalizedMerchant = MerchantNormalizer.normalize(parsed.merchantRaw, parsed.merchantVpa)
        val categoryResult = categoryEngine.resolveCategory(normalizedMerchant, parsed.merchantVpa)

        val result = deduplicationEngine.process(
            parsed = parsed,
            normalizedMerchant = normalizedMerchant,
            categoryId = categoryResult.categoryId
        )

        if (result is DeduplicationEngine.DeduplicationResult.NewTransaction &&
            !result.transaction.needsReview &&
            !result.transaction.isExcluded &&
            result.transaction.transactionType == TransactionType.EXPENSE
        ) {
            val rawText = result.transaction.rawNotificationText ?: result.transaction.description
            val isSelf = ExpenseScope.isSelfPayment(
                merchantName = result.transaction.merchantName,
                merchantVpa = result.transaction.merchantVpa,
                rawText = rawText
            )
            val isInvestment = ExpenseScope.isInvestment(
                merchantName = result.transaction.merchantName,
                merchantVpa = result.transaction.merchantVpa,
                rawText = rawText
            )
            val merchantKey = result.transaction.merchantName ?: result.transaction.merchantVpa
            val learnedRule = if (!merchantKey.isNullOrBlank()) {
                merchantRuleRepository.findMatchingRule(merchantKey)
            } else null

            val updatedTxn = when {
                isSelf -> {
                    // Self payment to user's own account (Sanjeev Yadav) -> automatically Personal!
                    result.transaction.copy(
                        description = ExpenseScope.describe(
                            merchantName = result.transaction.merchantName,
                            description = result.transaction.description,
                            isEdited = result.transaction.isEdited,
                            scope = ExpenseScope.PERSONAL
                        ),
                        needsReview = false,
                        isEdited = true,
                        updatedAt = System.currentTimeMillis()
                    )
                }
                isInvestment -> {
                    // Investment broker / AMC (Zerodha, Groww, Angel One, AMCs, etc.) -> automatically Investment!
                    result.transaction.copy(
                        description = ExpenseScope.describe(
                            merchantName = result.transaction.merchantName,
                            description = result.transaction.description,
                            isEdited = result.transaction.isEdited,
                            scope = ExpenseScope.INVESTMENT
                        ),
                        categoryId = "cat_financial",
                        needsReview = false,
                        isEdited = true,
                        updatedAt = System.currentTimeMillis()
                    )
                }
                learnedRule?.scope != null -> {
                    // Learned merchant memory from past user decision -> automatically apply remembered scope!
                    result.transaction.copy(
                        description = ExpenseScope.describe(
                            merchantName = result.transaction.merchantName,
                            description = result.transaction.description,
                            isEdited = result.transaction.isEdited,
                            scope = learnedRule.scope
                        ),
                        categoryId = learnedRule.categoryId.takeIf { it.isNotBlank() && it != "cat_other" }
                            ?: result.transaction.categoryId,
                        needsReview = false,
                        isEdited = true,
                        updatedAt = System.currentTimeMillis()
                    )
                }
                else -> {
                    // First time merchant -> ask user "Personal, Family, or Investment?"
                    result.transaction.copy(
                        needsReview = true,
                        updatedAt = System.currentTimeMillis()
                    )
                }
            }
            transactionDao.updateTransaction(updatedTxn)
            return DeduplicationEngine.DeduplicationResult.NewTransaction(updatedTxn)
        }

        return result
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

    /** Resolves the "Personal, Family, or Investment?" prompt for an auto-detected expense and remembers the merchant scope. */
    suspend fun resolveScope(
        transactionId: String,
        scope: String
    ) {
        val transaction = transactionDao.getTransactionById(transactionId) ?: return

        // Auto-learn / remember user's scope decision for this merchant so they are never asked again!
        val merchantKey = transaction.merchantName ?: transaction.merchantVpa
        if (!merchantKey.isNullOrBlank()) {
            merchantRuleRepository.saveScopeRule(merchantKey, scope)
        }

        val updated = transaction.copy(
            description = ExpenseScope.describe(
                merchantName = transaction.merchantName,
                description = transaction.description,
                isEdited = transaction.isEdited,
                scope = scope
            ),
            needsReview = false,
            isEdited = true,
            syncedToCloud = keepSyncedFlagAfterEdit(transaction),
            updatedAt = System.currentTimeMillis()
        )
        transactionDao.updateTransaction(updated)

        // Resolve companion duplicates for same amount/merchant in DB so orphan nudges never re-prompt
        resolveCompanionDuplicates(transaction, scope)
    }

    private suspend fun resolveCompanionDuplicates(primary: TransactionEntity, scope: String) {
        val window = 10 * 60 * 1000L
        val companions = transactionDao.findPotentialDuplicates(
            amount = primary.amount,
            startWindow = primary.dateTime - window,
            endWindow = primary.dateTime + window,
            upiRef = primary.upiReference
        )
        for (c in companions) {
            if (c.id != primary.id && c.needsReview) {
                val resolved = c.copy(
                    description = ExpenseScope.describe(
                        merchantName = c.merchantName ?: primary.merchantName,
                        description = c.description,
                        isEdited = true,
                        scope = scope
                    ),
                    needsReview = false,
                    isEdited = true,
                    isExcluded = true,
                    updatedAt = System.currentTimeMillis()
                )
                transactionDao.updateTransaction(resolved)
            }
        }
    }

    /**
     * Self-healing repair: scans all currently unreviewed transactions in the database.
     * If any match investment brokers/clearing houses (like India Clearing Corp) or self-transfers,
     * auto-resolves them immediately so user does not have to manually re-enter anything.
     */
    suspend fun repairAndAutoRouteInvestments(): Int {
        val unreviewed = transactionDao.getNeedsReviewTransactionsSync()
        var fixedCount = 0
        for (txn in unreviewed) {
            val raw = txn.rawNotificationText ?: txn.description
            val isInvestment = ExpenseScope.isInvestment(txn.merchantName, txn.merchantVpa, raw)
            val isSelf = ExpenseScope.isSelfPayment(txn.merchantName, txn.merchantVpa, raw)

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
                val resolved = txn.copy(
                    description = ExpenseScope.describe(
                        merchantName = txn.merchantName,
                        description = txn.description,
                        isEdited = txn.isEdited,
                        scope = ExpenseScope.PERSONAL
                    ),
                    needsReview = false,
                    isEdited = true,
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
