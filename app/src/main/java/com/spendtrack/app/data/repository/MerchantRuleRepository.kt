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
        // REPLACE on the unique merchantPattern index updates an existing rule for the same merchant.
        // Don't reuse the id of a substring match (e.g. "Ola" for "Ola Cabs"): that would overwrite a different rule.
        val entity = MerchantRuleEntity(
            id = UUID.randomUUID().toString(),
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
