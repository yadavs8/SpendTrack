package com.spendtrack.app.data.repository

import com.spendtrack.app.data.database.dao.MerchantRuleDao
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class MerchantRuleRepository(
    private val merchantRuleDao: MerchantRuleDao
) {
    val allRules: Flow<List<MerchantRuleEntity>> = merchantRuleDao.getAllRules()

    suspend fun saveRule(
        merchantPattern: String,
        categoryId: String,
        categoryName: String,
        confidence: Float = 1.0f
    ) {
        val existing = merchantRuleDao.findMatchingRule(merchantPattern)
        val entity = MerchantRuleEntity(
            id = existing?.id ?: UUID.randomUUID().toString(),
            merchantPattern = merchantPattern.trim(),
            categoryId = categoryId,
            categoryName = categoryName,
            confidence = confidence,
            userCreated = true,
            createdAt = System.currentTimeMillis()
        )
        merchantRuleDao.insertRule(entity)
    }

    suspend fun deleteRule(id: String) {
        merchantRuleDao.deleteById(id)
    }
}
