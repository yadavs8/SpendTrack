package com.spendtrack.app.core.model

/**
 * Represents the nature/direction of money movement.
 * Only EXPENSE is counted towards spending dashboards and metrics.
 */
enum class TransactionType {
    EXPENSE,            // Outgoing money (UPI payment, debit card, ATM withdrawal, cash spend)
    INCOME,             // Incoming money (salary, UPI received, bank deposit, interest) - EXCLUDED
    REFUND,             // Reversal/refund for an expense - EXCLUDED from total spend, can be linked
    INTERNAL_TRANSFER,  // Transfer between user's own accounts - EXCLUDED from spending
    UNKNOWN;            // Unidentifiable notification type

    val isExpense: Boolean
        get() = this == EXPENSE
}
