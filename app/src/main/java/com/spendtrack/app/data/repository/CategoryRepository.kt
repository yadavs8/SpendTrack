package com.spendtrack.app.data.repository

import com.spendtrack.app.data.database.dao.CategoryDao
import com.spendtrack.app.data.database.entity.CategoryEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class CategoryRepository(
    private val categoryDao: CategoryDao
) {
    val allCategories: Flow<List<CategoryEntity>> = categoryDao.getAllCategories()

    suspend fun getCategoryById(id: String): CategoryEntity? =
        categoryDao.getCategoryById(id)

    suspend fun getAllCategoriesSync(): List<CategoryEntity> =
        categoryDao.getAllCategoriesSync()

    suspend fun addCustomCategory(
        name: String,
        iconName: String = "category",
        colorHex: String = "#3F51B5",
        monthlyBudget: Double? = null
    ): Long {
        val entity = CategoryEntity(
            id = "custom_${UUID.randomUUID()}",
            name = name,
            iconName = iconName,
            colorHex = colorHex,
            isDefault = false,
            monthlyBudget = monthlyBudget,
            displayOrder = 99
        )
        return categoryDao.insertCategory(entity)
    }

    suspend fun updateCategoryBudget(categoryId: String, monthlyBudget: Double?) {
        val cat = categoryDao.getCategoryById(categoryId) ?: return
        categoryDao.updateCategory(cat.copy(monthlyBudget = monthlyBudget))
    }
}
