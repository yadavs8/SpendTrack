package com.spendtrack.app.core.model

/**
 * Represents the nature/direction of money movement.
 * Only EXPENSE is counted towards spending dashboards and metrics.
 * Names are stored in Room -- add new values, never rename existing ones.
 */
enum class TransactionType {
    EXPENSE,            // Outgoing money (UPI payment, card swipe, cash spend)
    INCOME,             // Incoming money (salary, UPI received, interest, cashback) - shown under Incomings
    REFUND,             // Money back for an expense - reduces that expense when it can be matched
    INTERNAL_TRANSFER,  // Between the user's own accounts, or a credit card bill payment - EXCLUDED
    CASH_WITHDRAWAL,    // ATM / cash withdrawal - moves money into the cash wallet, not a spend by itself
    UNKNOWN;            // Unidentifiable notification type

    val isExpense: Boolean
        get() = this == EXPENSE

    /** Synced to Kharcha Book's `kind` column. */
    val kindCode: String
        get() = when (this) {
            EXPENSE -> "expense"
            INCOME -> "income"
            REFUND -> "refund"
            INTERNAL_TRANSFER -> "transfer"
            CASH_WITHDRAWAL -> "cash_withdrawal"
            UNKNOWN -> "expense"
        }
}
