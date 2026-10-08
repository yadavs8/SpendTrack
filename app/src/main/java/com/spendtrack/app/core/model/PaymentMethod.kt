package com.spendtrack.app.core.model

/**
 * How the money left (or arrived): kept separate so card spends, UPI and cash never blur together.
 * [code] is what's synced to Kharcha Book's `method` column -- stable, never rename it.
 * Enum names are stored in Room, so existing values must keep their names too.
 */
enum class PaymentMethod(val displayName: String, val code: String) {
    UPI("UPI", "upi"),
    DEBIT_CARD("Debit Card", "debit_card"),
    CREDIT_CARD("Credit Card", "credit_card"),
    CASH("Cash", "cash"),
    BANK_TRANSFER("Net Banking", "netbanking"), // NEFT / IMPS / RTGS / NACH auto-debit
    ATM("ATM", "atm"),
    WALLET("Wallet", "wallet"),
    OTHER("Other", "other");

    companion object {
        fun fromCode(code: String?): PaymentMethod? = entries.firstOrNull { it.code == code }
    }
}
