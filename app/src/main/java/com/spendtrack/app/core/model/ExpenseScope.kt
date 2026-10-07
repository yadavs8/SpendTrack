package com.spendtrack.app.core.model

/**
 * Kharcha Book has no scope column -- a family expense is just a description starting with "🏠 ".
 * This builds that description for an auto-detected expense once the user picks Personal/Family.
 */
object ExpenseScope {
    const val PERSONAL = "personal"
    const val FAMILY = "family"
    const val INVESTMENT = "investment"
    private const val FAMILY_PREFIX = "🏠 "
    private const val INVESTMENT_PREFIX = "📈 "

    /**
     * Base text is the user's own note if they typed one (isEdited), else the merchant name --
     * never the raw description, which for auto-detected expenses is the full bank SMS.
     */
    fun describe(merchantName: String?, description: String?, isEdited: Boolean, scope: String): String {
        val base = (if (isEdited) description?.takeIf { it.isNotBlank() } else null)
            ?: merchantName?.takeIf { it.isNotBlank() }
            ?: "Expense"
        val clean = base.trim().removePrefix("🏠").removePrefix("👤").removePrefix("📈").trim()
        return when {
            scope.equals(FAMILY, ignoreCase = true) -> FAMILY_PREFIX + clean
            scope.equals(INVESTMENT, ignoreCase = true) -> INVESTMENT_PREFIX + clean
            else -> clean
        }
    }

    private val SELF_KEYWORDS = listOf(
        "sanjeev yadav",
        "sanjeev",
        "self transfer",
        "own account",
        "transfer to self"
    )

    /**
     * Checks if a transaction is a payment to oneself (Sanjeev Yadav / self account).
     */
    fun isSelfPayment(merchantName: String?, merchantVpa: String?, rawText: String?): Boolean {
        val name = (merchantName ?: "").lowercase()
        val vpa = (merchantVpa ?: "").lowercase()
        val raw = (rawText ?: "").lowercase()

        return SELF_KEYWORDS.any {
            name.contains(it) || vpa.contains(it) || raw.contains(it)
        }
    }
}
