package com.spendtrack.app.data.database.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val iconName: String = "category",
    val colorHex: String = "#6200EE",
    val isDefault: Boolean = false,
    val monthlyBudget: Double? = null,
    val displayOrder: Int = 0
)
