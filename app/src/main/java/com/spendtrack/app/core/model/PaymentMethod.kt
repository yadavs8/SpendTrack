package com.spendtrack.app.core.model

/**
 * Payment method used for the transaction.
 */
enum class PaymentMethod(val displayName: String) {
    UPI("UPI"),
    DEBIT_CARD("Debit Card"),
    CREDIT_CARD("Credit Card"),
    CASH("Cash"),
    BANK_TRANSFER("Bank Transfer"),
    OTHER("Other")
}
