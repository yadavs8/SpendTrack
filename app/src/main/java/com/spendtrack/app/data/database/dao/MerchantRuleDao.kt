package com.spendtrack.app.data.database.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MerchantRuleDao {

    @Query("SELECT * FROM merchant_rules ORDER BY createdAt DESC")
    fun getAllRules(): Flow<List<MerchantRuleEntity>>

    @Query("SELECT * FROM merchant_rules ORDER BY createdAt DESC")
    suspend fun getAllRulesSync(): List<MerchantRuleEntity>

    @Query("SELECT * FROM merchant_rules WHERE LOWER(:merchant) LIKE '%' || LOWER(merchantPattern) || '%' LIMIT 1")
    suspend fun findMatchingRule(merchant: String): MerchantRuleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRule(rule: MerchantRuleEntity): Long

    @Update
    suspend fun updateRule(rule: MerchantRuleEntity)

    @Delete
    suspend fun deleteRule(rule: MerchantRuleEntity)

    @Query("DELETE FROM merchant_rules WHERE id = :id")
    suspend fun deleteById(id: String)
}
