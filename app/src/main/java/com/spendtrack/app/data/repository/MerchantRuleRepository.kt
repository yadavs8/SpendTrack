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
            scope = existing?.scope,
            scopeConfirmations = existing?.scopeConfirmations ?: 0,
            confidence = confidence,
            userCreated = true,
            createdAt = System.currentTimeMillis()
        )
        merchantRuleDao.insertRule(entity)
    }

    /** Records an answer; matching the previous answer counts toward auto-filing, a different one restarts. */
    suspend fun saveScopeRule(
        merchantPattern: String,
        scope: String
    ) {
        val pattern = merchantPattern.trim()
        if (pattern.isBlank()) return
        val existing = merchantRuleDao.findMatchingRule(pattern)
        val confirmations = if (existing?.scope.equals(scope, ignoreCase = true)) (existing?.scopeConfirmations ?: 0) + 1 else 1
        val entity = MerchantRuleEntity(
            id = existing?.id ?: UUID.randomUUID().toString(),
            merchantPattern = pattern,
            categoryId = existing?.categoryId ?: "cat_other",
            categoryName = existing?.categoryName ?: "Other",
            scope = scope,
            scopeConfirmations = confirmations,
            confidence = 1.0f,
            userCreated = true,
            createdAt = System.currentTimeMillis()
        )
        merchantRuleDao.insertRule(entity)
    }

    suspend fun findMatchingRule(merchant: String): MerchantRuleEntity? {
        if (merchant.isBlank()) return null
        return merchantRuleDao.findMatchingRule(merchant.trim())
    }

    suspend fun deleteRule(id: String) {
        merchantRuleDao.deleteById(id)
    }
}
