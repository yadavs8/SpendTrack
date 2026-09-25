package com.spendtrack.app

import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.data.database.dao.CategoryDao
import com.spendtrack.app.data.database.dao.MerchantRuleDao
import com.spendtrack.app.data.database.entity.CategoryEntity
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class CategoryEngineTest {

    private class NoRulesDao : MerchantRuleDao {
        override fun getAllRules(): Flow<List<MerchantRuleEntity>> = flowOf(emptyList())
        override suspend fun getAllRulesSync(): List<MerchantRuleEntity> = emptyList()
        override suspend fun findMatchingRule(merchant: String): MerchantRuleEntity? = null
        override suspend fun insertRule(rule: MerchantRuleEntity): Long = 0
        override suspend fun updateRule(rule: MerchantRuleEntity) = Unit
        override suspend fun deleteRule(rule: MerchantRuleEntity) = Unit
        override suspend fun deleteById(id: String) = Unit
    }

    private class NoCategoriesDao : CategoryDao {
        override fun getAllCategories(): Flow<List<CategoryEntity>> = flowOf(emptyList())
        override suspend fun getAllCategoriesSync(): List<CategoryEntity> = emptyList()
        override suspend fun getCategoryById(id: String): CategoryEntity? = null
        override suspend fun getCategoryByName(name: String): CategoryEntity? = null
        override suspend fun insertCategories(categories: List<CategoryEntity>) = Unit
        override suspend fun insertCategory(category: CategoryEntity): Long = 0
        override suspend fun updateCategory(category: CategoryEntity) = Unit
        override suspend fun getCategoryCount(): Int = 0
    }

    private val engine = CategoryEngine(NoRulesDao(), NoCategoriesDao())

    @Test
    fun resolveCategory_keywordInsideAnotherWord_doesNotMatch() = runTest {
        assertEquals("cat_entertainment", engine.resolveCategory("Steam Games").categoryId)
        assertEquals("cat_other", engine.resolveCategory("David Kumar").categoryId)
        assertEquals("cat_other", engine.resolveCategory("Premium Traders").categoryId)
    }

    @Test
    fun resolveCategory_wholeWordKeyword_matches() = runTest {
        assertEquals("cat_food", engine.resolveCategory("Chai Point").categoryId)
        assertEquals("cat_transport", engine.resolveCategory("Ola").categoryId)
        assertEquals("cat_food", engine.resolveCategory("Swiggy", "swiggy@icici").categoryId)
    }
}
