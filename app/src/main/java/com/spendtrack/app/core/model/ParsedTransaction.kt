package com.spendtrack.app.core.model

/**
 * Output data structure from parsing notification or SMS text.
 */
data class ParsedTransaction(
    val amount: Double,
    val currency: String = "INR",
    val merchantRaw: String? = null,
    val merchantVpa: String? = null,
    val paymentMethod: PaymentMethod = PaymentMethod.UPI,
    val transactionType: TransactionType = TransactionType.EXPENSE,
    val upiReference: String? = null,
    val bankReference: String? = null,
    val accountLast4: String? = null,
    val dateTime: Long = System.currentTimeMillis(),
    val source: String, // "NOTIFICATION", "SMS", "MANUAL"
    val sourcePackage: String? = null,
    val rawText: String? = null,
    val confidenceScore: Float = 1.0f
)
