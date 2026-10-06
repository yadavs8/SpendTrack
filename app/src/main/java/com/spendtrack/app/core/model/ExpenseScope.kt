package com.spendtrack.app.core.model

/**
 * Kharcha Book has no scope column -- a family expense is just a description starting with "🏠 ".
 * This builds that description for an auto-detected expense once the user picks Personal/Family.
 */
object ExpenseScope {
    const val PERSONAL = "personal"
    const val FAMILY = "family"
    private const val FAMILY_PREFIX = "🏠 "

    /**
     * Base text is the user's own note if they typed one (isEdited), else the merchant name --
     * never the raw description, which for auto-detected expenses is the full bank SMS.
     */
    fun describe(merchantName: String?, description: String?, isEdited: Boolean, scope: String): String {
        val base = (if (isEdited) description?.takeIf { it.isNotBlank() } else null)
            ?: merchantName?.takeIf { it.isNotBlank() }
            ?: "Expense"
        val clean = base.trim().removePrefix("🏠").removePrefix("👤").trim()
        return if (scope.equals(FAMILY, ignoreCase = true)) FAMILY_PREFIX + clean else clean
    }
}
