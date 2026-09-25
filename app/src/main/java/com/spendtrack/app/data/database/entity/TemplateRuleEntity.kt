package com.spendtrack.app.data.database.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "template_rules")
data class TemplateRuleEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val senderOrPackage: String,
    val regexPattern: String,
    val amountGroupIndex: Int = 1,
    val merchantGroupIndex: Int = 2,
    val refGroupIndex: Int? = null,
    val createdAt: Long = System.currentTimeMillis()
)
