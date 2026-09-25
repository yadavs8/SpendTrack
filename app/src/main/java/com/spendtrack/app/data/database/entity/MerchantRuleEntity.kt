package com.spendtrack.app.data.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "merchant_rules",
    indices = [
        Index(value = ["merchantPattern"], unique = true)
    ]
)
data class MerchantRuleEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val merchantPattern: String,
    val categoryId: String,
    val categoryName: String,
    val confidence: Float = 1.0f,
    val userCreated: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)
