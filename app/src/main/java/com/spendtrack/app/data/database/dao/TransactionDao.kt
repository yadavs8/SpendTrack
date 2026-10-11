package com.spendtrack.app.data.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.spendtrack.app.data.database.entity.TransactionEntity
import kotlinx.coroutines.flow.Flow

data class CategorySpend(
    @ColumnInfo(name = "categoryId") val categoryId: String?,
    @ColumnInfo(name = "total") val total: Double,
    @ColumnInfo(name = "count") val count: Int
)

data class PaymentMethodSpend(
    @ColumnInfo(name = "paymentMethod") val paymentMethod: String,
    @ColumnInfo(name = "total") val total: Double,
    @ColumnInfo(name = "count") val count: Int
)

data class DailySpend(
    @ColumnInfo(name = "dayTimestamp") val dayTimestamp: Long,
    @ColumnInfo(name = "total") val total: Double
)

@Dao
interface TransactionDao {

    @Query("SELECT * FROM transactions WHERE isExcluded = 0 AND transactionType = 'EXPENSE' ORDER BY dateTime DESC")
    fun getAllExpenses(): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE isExcluded = 0 AND transactionType = 'EXPENSE' AND dateTime BETWEEN :startTime AND :endTime ORDER BY dateTime DESC")
    fun getExpensesForRange(startTime: Long, endTime: Long): Flow<List<TransactionEntity>>

    @Query("SELECT SUM(amount) FROM transactions WHERE isExcluded = 0 AND transactionType = 'EXPENSE' AND dateTime BETWEEN :startTime AND :endTime")
    fun getTotalSpentForRange(startTime: Long, endTime: Long): Flow<Double?>

    @Query("SELECT COUNT(*) FROM transactions WHERE isExcluded = 0 AND transactionType = 'EXPENSE' AND dateTime BETWEEN :startTime AND :endTime")
    fun getTransactionCountForRange(startTime: Long, endTime: Long): Flow<Int>

    @Query("SELECT * FROM transactions WHERE isExcluded = 0 AND transactionType = 'EXPENSE' ORDER BY dateTime DESC LIMIT :limit")
    fun getRecentExpenses(limit: Int = 10): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE needsReview = 1 AND isExcluded = 0 ORDER BY dateTime DESC")
    fun getNeedsReviewTransactions(): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE needsReview = 1 AND isExcluded = 0 ORDER BY dateTime DESC")
    suspend fun getNeedsReviewTransactionsSync(): List<TransactionEntity>

    @Query("""
        SELECT categoryId, SUM(amount) AS total, COUNT(*) AS count 
        FROM transactions 
        WHERE isExcluded = 0 AND transactionType = 'EXPENSE' AND dateTime BETWEEN :startTime AND :endTime 
        GROUP BY categoryId 
        ORDER BY total DESC
    """)
    fun getCategorySpends(startTime: Long, endTime: Long): Flow<List<CategorySpend>>

    @Query("""
        SELECT paymentMethod, SUM(amount) AS total, COUNT(*) AS count 
        FROM transactions 
        WHERE isExcluded = 0 AND transactionType = 'EXPENSE' AND dateTime BETWEEN :startTime AND :endTime 
        GROUP BY paymentMethod 
        ORDER BY total DESC
    """)
    fun getPaymentMethodSpends(startTime: Long, endTime: Long): Flow<List<PaymentMethodSpend>>

    @Query("SELECT * FROM transactions WHERE id = :id LIMIT 1")
    suspend fun getTransactionById(id: String): TransactionEntity?

    @Query("""
        SELECT * FROM transactions 
        WHERE (amount = :amount AND dateTime BETWEEN :startWindow AND :endWindow)
           OR (upiReference IS NOT NULL AND upiReference = :upiRef)
        LIMIT 5
    """)
    suspend fun findPotentialDuplicates(amount: Double, startWindow: Long, endWindow: Long, upiRef: String?): List<TransactionEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransaction(transaction: TransactionEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransactions(transactions: List<TransactionEntity>)

    @Update
    suspend fun updateTransaction(transaction: TransactionEntity)

    @Delete
    suspend fun deleteTransaction(transaction: TransactionEntity)

    @Query("DELETE FROM transactions WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM transactions WHERE isDemo = 1")
    suspend fun deleteDemoTransactions()

    @Query("SELECT * FROM transactions ORDER BY dateTime DESC")
    suspend fun getAllTransactionsSync(): List<TransactionEntity>

    /**
     * Ready to push to Kharcha Book: real (not excluded/demo) expenses that are either answered, or
     * carry a bank/UPI ref -- those go up immediately under the merchant name, and answering the
     * Personal/Family prompt later upserts the same row by ref_no. Unanswered ones without a ref
     * wait, since pushing them twice would create a duplicate.
     */
    @Query("""
        SELECT * FROM transactions
        WHERE syncedToCloud = 0 AND isExcluded = 0 AND isDemo = 0 AND needsCloudDelete = 0
            AND transactionType IN ('EXPENSE', 'INCOME', 'CASH_WITHDRAWAL')
            AND (needsReview = 0
                 OR (upiReference IS NOT NULL AND upiReference != '')
                 OR (bankReference IS NOT NULL AND bankReference != ''))
        ORDER BY dateTime ASC
    """)
    suspend fun getUnsyncedExpenses(): List<TransactionEntity>

    @Query("UPDATE transactions SET syncedToCloud = 1 WHERE id = :id")
    suspend fun markSynced(id: String)

    /** Rows that were pushed to Kharcha Book but must now be removed there (transfer / fully refunded). */
    @Query("SELECT * FROM transactions WHERE needsCloudDelete = 1 AND isDemo = 0")
    suspend fun getPendingCloudDeletes(): List<TransactionEntity>

    @Query("UPDATE transactions SET needsCloudDelete = 0, syncedToCloud = 1 WHERE id = :id")
    suspend fun markCloudDeleted(id: String)

    /** Expenses a refund could belong to: same or larger amount, not already fully refunded, recent first. */
    @Query("""
        SELECT * FROM transactions
        WHERE transactionType = 'EXPENSE' AND isExcluded = 0 AND isDemo = 0
            AND dateTime BETWEEN :since AND :until
            AND amount - refundedAmount >= :amount - 0.005
        ORDER BY dateTime DESC
        LIMIT 50
    """)
    suspend fun findRefundCandidates(amount: Double, since: Long, until: Long): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE (upiReference = :ref OR bankReference = :ref) AND transactionType = 'EXPENSE' AND isDemo = 0 LIMIT 1")
    suspend fun findExpenseByRef(ref: String): TransactionEntity?

    /** Cash wallet: ATM withdrawals and logged cash spends in a time range. */
    @Query("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE transactionType = 'CASH_WITHDRAWAL' AND isExcluded = 0 AND isDemo = 0 AND dateTime BETWEEN :start AND :end")
    suspend fun sumCashWithdrawn(start: Long, end: Long): Double

    @Query("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE transactionType = 'EXPENSE' AND paymentMethod = 'CASH' AND isExcluded = 0 AND isDemo = 0 AND dateTime BETWEEN :start AND :end")
    suspend fun sumCashSpent(start: Long, end: Long): Double

    @Query("SELECT COUNT(*) FROM transactions WHERE transactionType = 'EXPENSE' AND paymentMethod = 'CASH' AND isDemo = 0 AND dateTime BETWEEN :start AND :end")
    suspend fun countCashSpends(start: Long, end: Long): Int
}
