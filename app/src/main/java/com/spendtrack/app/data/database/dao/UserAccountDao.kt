package com.spendtrack.app.data.database.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.spendtrack.app.data.database.entity.UserAccountEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface UserAccountDao {

    @Query("SELECT * FROM user_accounts ORDER BY isDefault DESC, bankName ASC")
    fun getAllAccounts(): Flow<List<UserAccountEntity>>

    @Query("SELECT * FROM user_accounts ORDER BY isDefault DESC, bankName ASC")
    suspend fun getAllAccountsSync(): List<UserAccountEntity>

    @Query("SELECT * FROM user_accounts WHERE accountLast4 = :last4 LIMIT 1")
    suspend fun findAccountByLast4(last4: String): UserAccountEntity?

    @Query("SELECT COUNT(*) FROM user_accounts WHERE accountLast4 = :last4")
    suspend fun isUserAccount(last4: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAccount(account: UserAccountEntity): Long

    @Update
    suspend fun updateAccount(account: UserAccountEntity)

    @Delete
    suspend fun deleteAccount(account: UserAccountEntity)

    @Query("DELETE FROM user_accounts WHERE id = :id")
    suspend fun deleteById(id: String)
}
