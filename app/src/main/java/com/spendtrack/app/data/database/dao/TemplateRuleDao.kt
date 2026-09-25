package com.spendtrack.app.data.database.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.spendtrack.app.data.database.entity.TemplateRuleEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TemplateRuleDao {

    @Query("SELECT * FROM template_rules ORDER BY createdAt DESC")
    fun getAllTemplateRules(): Flow<List<TemplateRuleEntity>>

    @Query("SELECT * FROM template_rules WHERE senderOrPackage = :senderOrPackage")
    suspend fun getRulesForSender(senderOrPackage: String): List<TemplateRuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTemplateRule(rule: TemplateRuleEntity): Long

    @Delete
    suspend fun deleteTemplateRule(rule: TemplateRuleEntity)
}
