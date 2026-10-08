package com.spendtrack.app.core.model

/**
 * Descriptions for money that isn't a spend. Kharcha Book reads the type from these prefixes
 * (web app.js isIncome / isSalary / isMotherSettlement / isCashWithdrawal), so they must stay in step:
 *   "💼 ..."                     salary          (isSalary)
 *   "👵 Withdrawn from Mother"   family reimbursement (isMotherSettlement)
 *   "💰 ..."                     any other income
 *   "💵 Cash withdrawn ..."      ATM withdrawal -> cash wallet (not a spend by itself)
 */
object MoneyLabels {
    const val CASH_WITHDRAWN_PREFIX = "💵 Cash withdrawn"

    fun income(kind: String?, payer: String?, bank: String?, fromFamily: Boolean): String {
        val who = payer?.trim()?.takeIf { it.isNotBlank() }
        val text = when {
            fromFamily -> "👵 Withdrawn from Mother" + (who?.let { " · $it" } ?: "")
            kind == "SALARY" -> "💼 Salary" + (who?.let { " · $it" } ?: "")
            kind == "INTEREST" -> "💰 Interest" + (bank?.let { " · $it" } ?: "")
            kind == "CASHBACK" -> "💰 Cashback" + (who?.let { " · $it" } ?: "")
            kind == "DIVIDEND" -> "💰 Dividend" + (who?.let { " · $it" } ?: "")
            else -> "💰 Received" + (who?.let { " · $it" } ?: "")
        }
        return text.take(60)
    }

    fun unmatchedRefund(merchant: String?): String =
        ("💰 Refund" + (merchant?.trim()?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")).take(60)

    fun cashWithdrawal(bank: String?): String =
        (CASH_WITHDRAWN_PREFIX + (bank?.let { " · $it ATM" } ?: "")).take(60)

    /** "HDFC Credit Card ··4321" style label for prompts and the card summary. */
    fun instrument(method: PaymentMethod, bank: String?, last4: String?): String {
        val tail = last4?.takeIf { it.isNotBlank() }?.let { " ··$it" } ?: ""
        val b = bank?.takeIf { it.isNotBlank() }?.let { "$it " } ?: ""
        return when (method) {
            PaymentMethod.CREDIT_CARD -> "${b}Credit Card$tail"
            PaymentMethod.DEBIT_CARD -> "${b}Debit Card$tail"
            PaymentMethod.UPI -> "UPI" + (bank?.let { " · $it" } ?: "") + tail
            PaymentMethod.BANK_TRANSFER -> "${b}Net Banking$tail"
            PaymentMethod.ATM -> "${b}ATM$tail"
            else -> method.displayName
        }.trim()
    }
}
