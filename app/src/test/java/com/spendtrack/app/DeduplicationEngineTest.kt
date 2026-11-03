package com.spendtrack.app

import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.deduplication.DeduplicationEngine.DeduplicationResult
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.dao.PaymentMethodSpend
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The duplicate engine against an in-memory table: one real payment told by several texts is one entry. */
class DeduplicationEngineTest {

    private val t0 = 1_792_000_000_000L
    private val hour = 3_600_000L

    private class FakeDao : TransactionDao {
        val rows = linkedMapOf<String, TransactionEntity>()
        override suspend fun insertTransaction(transaction: TransactionEntity): Long { rows[transaction.id] = transaction; return 1 }
        override suspend fun updateTransaction(transaction: TransactionEntity) { rows[transaction.id] = transaction }
        override suspend fun getTransactionById(id: String) = rows[id]
        override suspend fun findPotentialDuplicates(amount: Double, startWindow: Long, endWindow: Long, upiRef: String?) =
            rows.values.filter {
                (it.amount == amount && it.dateTime in startWindow..endWindow) ||
                    (!upiRef.isNullOrBlank() && (it.upiReference == upiRef || it.bankReference == upiRef))
            }.sortedByDescending { it.dateTime }
        override suspend fun findAmountNear(amountLow: Double, amountHigh: Double, startWindow: Long, endWindow: Long) =
            rows.values.filter {
                it.amount in amountLow..amountHigh && it.dateTime in startWindow..endWindow && !it.isDemo && !it.isExcluded &&
                    (it.transactionType == TransactionType.EXPENSE || it.transactionType == TransactionType.INCOME)
            }.sortedByDescending { it.dateTime }

        override suspend fun purgeZeroAmountTransactions(): Int {
            val toRemove = rows.filter { it.value.amount <= 0 }.keys
            toRemove.forEach { rows.remove(it) }
            return toRemove.size
        }
        override suspend fun getZeroAmountTransactions(): List<TransactionEntity> =
            rows.values.filter { it.amount <= 0 }
        override suspend fun findByRawText(rawText: String): TransactionEntity? =
            rows.values.firstOrNull { it.rawNotificationText == rawText }
        override suspend fun findRecentSimilarExpenses(amount: Double, since: Long, until: Long): List<TransactionEntity> =
            rows.values.filter { it.amount == amount && it.dateTime in since..until && !it.isExcluded && !it.isDemo }

        override fun getAllExpenses(): Flow<List<TransactionEntity>> = TODO()
        override fun getExpensesForRange(startTime: Long, endTime: Long): Flow<List<TransactionEntity>> = TODO()
        override fun getTotalSpentForRange(startTime: Long, endTime: Long): Flow<Double?> = TODO()
        override fun getTransactionCountForRange(startTime: Long, endTime: Long): Flow<Int> = TODO()
        override fun getRecentExpenses(limit: Int): Flow<List<TransactionEntity>> = TODO()
        override fun getNeedsReviewTransactions(): Flow<List<TransactionEntity>> = TODO()
        override suspend fun getNeedsReviewTransactionsSync(): List<TransactionEntity> = TODO()
        override fun getCategorySpends(startTime: Long, endTime: Long): Flow<List<CategorySpend>> = TODO()
        override fun getPaymentMethodSpends(startTime: Long, endTime: Long): Flow<List<PaymentMethodSpend>> = TODO()
        override suspend fun findSameAmountNear(amount: Double, startWindow: Long, endWindow: Long, excludeId: String): List<TransactionEntity> =
            rows.values.filter { it.amount == amount && it.dateTime in startWindow..endWindow && it.id != excludeId }
        override suspend fun getCountedSince(since: Long): List<TransactionEntity> = TODO()
        override suspend fun insertTransactions(transactions: List<TransactionEntity>) {
            transactions.forEach { rows[it.id] = it }
        }
        override suspend fun deleteTransaction(transaction: TransactionEntity) {
            rows.remove(transaction.id)
        }
        override suspend fun deleteById(id: String) {
            rows.remove(id)
        }
        override suspend fun deleteDemoTransactions() = TODO()
        override suspend fun getAllTransactionsSync(): List<TransactionEntity> = rows.values.toList()
        override suspend fun getUnsyncedExpenses(): List<TransactionEntity> = TODO()
        override suspend fun getLocalTripDescriptions(): List<String> = TODO()
        override suspend fun getLocalProjectDescriptions(): List<String> = TODO()
        override suspend fun getUnmovedLavishKiranaExpenses(): List<TransactionEntity> = TODO()
        override suspend fun markSynced(id: String) = TODO()
        override suspend fun getPendingCloudDeletes(): List<TransactionEntity> = TODO()
        override suspend fun markCloudDeleted(id: String) = TODO()
        override suspend fun findRefundCandidates(amount: Double, since: Long, until: Long): List<TransactionEntity> = TODO()
        override suspend fun findExpenseByRef(ref: String): TransactionEntity? =
            rows.values.firstOrNull { (it.upiReference == ref || it.bankReference == ref) && !it.isExcluded }
        override suspend fun sumCashWithdrawn(start: Long, end: Long): Double = TODO()
        override suspend fun sumCashSpent(start: Long, end: Long): Double = TODO()
        override suspend fun countCashSpends(start: Long, end: Long): Int = TODO()
    }

    private fun parsed(
        amount: Double, at: Long, merchant: String?, raw: String, ref: String? = null, last4: String? = null,
        pkg: String? = "com.google.android.apps.messaging", source: String = "NOTIFICATION", confidence: Float = 0.95f
    ) = ParsedTransaction(
        amount = amount, merchantRaw = merchant, paymentMethod = PaymentMethod.UPI, transactionType = TransactionType.EXPENSE,
        upiReference = ref, bankReference = ref, accountLast4 = last4, dateTime = at, source = source,
        sourcePackage = pkg, rawText = raw, confidenceScore = confidence
    )

    @Test
    fun insurancePremium_bankDebitThenInsurerReceipt_isOneEntry() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        val first = engine.process(
            parsed(12345.0, t0, "ICICI LOMBARD GIC", "AX-ICICIB Acct XX602 debited for Rs 12,345.00 on 14-Oct-26; ICICI LOMBARD GIC credited. UPI:664408525138", ref = "664408525138", last4 = "602"),
            "ICICI Lombard GIC", "cat_other"
        )
        assertTrue(first is DeduplicationResult.NewTransaction)
        val second = engine.process(
            parsed(12345.0, t0 + 3 * hour, null, "ICICILM Thank you! We have received your premium of Rs 12,345.00 for policy 4012/7788/22. ICICI Lombard"),
            "Unknown Merchant", "cat_other"
        )
        assertTrue(second is DeduplicationResult.MergedWithExisting)
        assertEquals(1, dao.rows.size)
    }

    @Test
    fun maybeDuplicate_isAskedAbout_notMergedOrHidden() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        val a = engine.process(parsed(1299.0, t0, "Amazon", "HDFCBK Rs 1,299 spent on HDFC Card XX1234 at AMAZON", last4 = "1234", pkg = null, source = "SMS"), "Amazon", "cat_shopping")
        val b = engine.process(parsed(1299.0, t0 + 4 * hour, "Amazon", "HDFCBK Rs 1,299 spent on HDFC Card XX1234 at AMAZON", last4 = "1234", pkg = null, source = "SMS"), "Amazon", "cat_shopping")
        assertTrue(b is DeduplicationResult.NewTransaction)
        val second = (b as DeduplicationResult.NewTransaction).transaction
        assertEquals((a as DeduplicationResult.NewTransaction).transaction.id, second.linkedTransactionId)
        assertTrue(second.needsReview)
        assertEquals(2, dao.rows.size)
    }

    @Test
    fun twoSmallPaymentsToTheSameShop_areTwoEntries() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        val gpay = "com.google.android.apps.nbu.paisa.user"
        engine.process(parsed(20.0, t0, "Raju Tea", "Google Pay ₹20 paid to Raju Tea", pkg = gpay), "Raju Tea", "cat_food")
        val b = engine.process(parsed(20.0, t0 + 5 * hour, "Raju Tea", "Google Pay ₹20 paid to Raju Tea", pkg = gpay), "Raju Tea", "cat_food")
        assertTrue(b is DeduplicationResult.NewTransaction)
        assertNull((b as DeduplicationResult.NewTransaction).transaction.linkedTransactionId)
        assertEquals(2, dao.rows.size)
    }

    @Test
    fun unknownMerchant_isNotTreatedAsADifferentName() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        engine.process(parsed(640.0, t0, "Rahul", "Google Pay ₹640 paid to Rahul. UPI Ref 123456789012", ref = "123456789012", pkg = "com.google.android.apps.nbu.paisa.user"), "Rahul", "cat_other")
        val b = engine.process(parsed(640.0, t0 + 60_000, null, "AD-SBIBNK Rs 640 debited from A/c XX7788 on 14Oct", last4 = "7788", pkg = null, source = "SMS"), "Unknown Merchant", "cat_other")
        assertTrue(b is DeduplicationResult.MergedWithExisting)
        assertEquals("Rahul", (b as DeduplicationResult.MergedWithExisting).updatedTransaction.merchantName)
    }

    @Test
    fun zeroAmount_isNotSavedAsNewTransaction() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        val result = engine.process(
            parsed(0.0, t0, "Unknown", "A/c debited for Rs 0"),
            "Unknown", "cat_other"
        )
        assertTrue(result is DeduplicationResult.MergedWithExisting)
        assertEquals(0, dao.rows.size)
    }

    @Test
    fun rawTextDuplicate_withinWindow_isMergedWithoutNewEntry() = runBlocking {
        val dao = FakeDao()
        val engine = DeduplicationEngine(dao)
        val msg = "HDFCBK: Rs 150 spent on Card XX1234 at CAFE"
        val first = engine.process(parsed(150.0, t0, "CAFE", msg), "CAFE", "cat_food")
        assertTrue(first is DeduplicationResult.NewTransaction)
        assertEquals(1, dao.rows.size)

        // Same notification / SMS delivered again 30 seconds later
        val second = engine.process(parsed(150.0, t0 + 30_000, "CAFE", msg), "CAFE", "cat_food")
        assertTrue(second is DeduplicationResult.MergedWithExisting)
        assertEquals(1, dao.rows.size)
    }
}
