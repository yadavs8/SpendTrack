package com.spendtrack.app.data.repository

import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.normalizer.MerchantNormalizer
import com.spendtrack.app.core.parser.TransactionFilter
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.dao.PaymentMethodSpend
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlinx.coroutines.flow.Flow
import java.util.Calendar
import java.util.UUID

private const val USER_TEMPLATE_CONFIDENCE = 0.98f

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
     */
    suspend fun ingestTransaction(parsed: ParsedTransaction): DeduplicationEngine.DeduplicationResult {
        val normalizedMerchant = MerchantNormalizer.normalize(parsed.merchantRaw, parsed.merchantVpa)
        val categoryResult = categoryEngine.resolveCategory(normalizedMerchant, parsed.merchantVpa)

        return deduplicationEngine.process(
            parsed = parsed,
            normalizedMerchant = normalizedMerchant,
            categoryId = categoryResult.categoryId
        )
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

    /**
     * Removes auto-detected entries whose original message fails the current [TransactionFilter]
     * (OTPs, offers, reminders, requests, failed payments, incoming money). Manually added,
     * user-edited and demo entries are never touched. Returns the number of entries removed.
     */
    suspend fun purgeFalseDetections(): Int {
        var removed = 0
        for (txn in transactionDao.getAllTransactionsSync()) {
            if (txn.isManuallyAdded || txn.isEdited || txn.isDemo) continue
            if (txn.source == "MANUAL" || txn.source == "IMPORT") continue
            // Entries confirmed by both SMS and notification, and user-taught template matches (0.98)
            if (txn.source.contains("+") || txn.confidenceScore == USER_TEMPLATE_CONFIDENCE) continue
            val raw = txn.description ?: continue
            if (TransactionFilter.rejectionReason(raw, requireDebitEvidence = true) != null) {
                transactionDao.deleteById(txn.id)
                removed++
            }
        }
        return removed
    }

    suspend fun getAllTransactionsSync(): List<TransactionEntity> =
        transactionDao.getAllTransactionsSync()
}
