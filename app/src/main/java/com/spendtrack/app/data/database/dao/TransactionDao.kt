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

    // Includes excluded, refunded and transfer rows so the user can review and undo them
    @Query("SELECT * FROM transactions ORDER BY dateTime DESC")
    fun getAllTransactions(): Flow<List<TransactionEntity>>

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
}
