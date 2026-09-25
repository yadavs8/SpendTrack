package com.spendtrack.app.data.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import java.util.UUID

@Entity(
    tableName = "transactions",
    indices = [
        Index(value = ["dateTime"]),
        Index(value = ["merchantName"]),
        Index(value = ["categoryId"]),
        Index(value = ["upiReference"]),
        Index(value = ["isExcluded"]),
        Index(value = ["transactionType"])
    ]
)
data class TransactionEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val amount: Double,
    val currency: String = "INR",
    val merchantName: String? = null,
    val merchantVpa: String? = null,
    val description: String? = null,
    val categoryId: String? = null,
    val paymentMethod: PaymentMethod = PaymentMethod.UPI,
    val transactionType: TransactionType = TransactionType.EXPENSE,
    val dateTime: Long = System.currentTimeMillis(),
    val upiReference: String? = null,
    val bankReference: String? = null,
    val accountLast4: String? = null,
    val source: String = "NOTIFICATION", // "NOTIFICATION", "SMS", "MANUAL", "IMPORT"
    val sourcePackage: String? = null,
    val rawNotificationText: String? = null,
    val confidenceScore: Float = 1.0f,
    val isManuallyAdded: Boolean = false,
    val isEdited: Boolean = false,
    val isExcluded: Boolean = false,
    val needsReview: Boolean = false,
    val isDemo: Boolean = false,
    val isRefunded: Boolean = false,
    val refundedAmount: Double = 0.0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
