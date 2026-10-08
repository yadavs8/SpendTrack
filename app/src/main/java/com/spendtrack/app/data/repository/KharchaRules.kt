package com.spendtrack.app.data.repository

/**
 * Kharcha Book's own rules for reading a row (web/kharcha-book/app.js), mirrored so the phone's
 * alerts and summaries show the same numbers as the app: isIncome, isInvestment, isFamilyEntry,
 * isCashWithdrawal and categoryBreakdown's category names.
 *
 * Keep in step with app.js -- KharchaRulesTest pins the same cases the web tests use.
 */
object KharchaRules {

    private val INCOME_WORD_START = Regex("""^(?:salary|pension|income)\b""")
    private val PAID_OUT_WORDS = Regex("""\b(?:tax|premium|policy|plan|fund|contribution|emi|paid|to|maid)\b""")
    private val INVESTMENT_WORDS = Regex("""\b(?:sip|ppf|nps|fd|stocks|shares)\b""")

    fun isIncome(desc: String?, kind: String? = null): Boolean {
        if (kind == "income") return true
        if (kind == "expense" || kind == "cash_withdrawal" || kind == "transfer") return false
        val d = desc?.trim()?.lowercase() ?: return false
        if (d.isEmpty()) return false
        if (d.startsWith("🏠") || d.startsWith("👤") || d.contains("🔨") || d.contains("📈")) return false
        if (d.contains("💼") || d.contains("👵") || d.startsWith("💰")) return true
        if (d.contains("withdrawn from mother")) return true
        return INCOME_WORD_START.containsMatchIn(d) && !PAID_OUT_WORDS.containsMatchIn(d)
    }

    fun isInvestment(desc: String?): Boolean {
        val d = desc?.trim()?.lowercase() ?: return false
        return d.contains("📈") || d.startsWith("investment") || d.contains("mutual fund") ||
            d.contains("fixed deposit") || INVESTMENT_WORDS.containsMatchIn(d)
    }

    fun isCashWithdrawal(desc: String?, kind: String? = null): Boolean =
        kind == "cash_withdrawal" || (desc?.trim()?.startsWith("💵 Cash withdrawn") == true)

    fun isExpense(desc: String?, kind: String? = null): Boolean =
        !isIncome(desc, kind) && !isInvestment(desc) && !isCashWithdrawal(desc, kind) && kind != "transfer"

    fun isSalary(desc: String?, kind: String? = null): Boolean {
        if (!isIncome(desc, kind)) return false
        val d = desc!!.lowercase()
        return (d.contains("💼") || d.contains("salary")) && !isMotherSettlement(desc) && !d.contains("maid")
    }

    fun isMotherSettlement(desc: String?): Boolean {
        val d = desc?.lowercase() ?: return false
        return d.contains("withdrawn from mother") || (d.contains("👵") && d.contains("withdraw"))
    }

    private fun isProjectEntry(d: String) = d.contains("🔨") || d.contains("renovation") || d.contains("labour") || d.contains("mistri")

    fun isFamilyEntry(desc: String?): Boolean {
        val d = desc?.lowercase() ?: return false
        if (isProjectEntry(d) && (d.contains("👵") || d.contains("mother"))) return false
        if (isProjectEntry(d)) return true
        return d.contains("🏠") || d.contains("family") || d.contains("niece") || d.contains("electricity") || d.contains("gas") || d.contains("bill")
    }

    /** The category name Kharcha Book shows (and keys category budgets by). */
    fun category(desc: String?): String {
        val clean = (desc ?: "").replace(Regex("^[🏠👤]\\s*"), "").trim()
        val l = clean.lowercase()
        fun has(vararg w: String) = w.any { l.contains(it) }
        return when {
            clean.startsWith("💵 Unaccounted cash") -> "💵 Unaccounted cash"
            clean.contains("🛒") || has("grocery", "supermarket", "dmart", "zepto", "blinkit", "instamart", "bigbasket") -> "🛒 Grocery"
            clean.contains("🥦") || has("vegetable", "sabzi", "fruits") -> "🥦 Vegetables"
            clean.contains("🥛") || has("milk", "doodh", "dairy", "paneer", "curd") -> "🥛 Milk & Dairy"
            clean.contains("⚡") || has("electricity", "power", "bescom", "light bill") -> "⚡ Electricity Bill"
            clean.contains("🔥") || has("gas", "cylinder", "indane", "hp gas", "bharat gas") -> "🔥 Gas Bill"
            clean.contains("📱") || has("airtel", "jio", "vodafone", "vi ", "wifi", "wi-fi", "broadband", "recharge", "fiber", "telecom") -> "📱 Mobile & WiFi"
            clean.contains("⛽") || has("petrol", "fuel", "diesel", "cng", "hpcl", "bpcl", "iocl", "shell") -> "⛽ Fuel"
            clean.contains("🍔") || has("swiggy", "zomato", "food", "restaurant", "cafe", "pizza", "burger", "chai", "tea", "coffee", "snacks") -> "🍔 Food & Dining"
            clean.contains("🛍️") || has("shopping", "amazon", "flipkart", "myntra", "meesho", "nykaa", "ajio") -> "🛍️ Online Shopping"
            clean.contains("👧") || has("niece", "allowance") -> "👧 Niece Allowance"
            clean.contains("💊") || has("medicine", "doctor", "pharmacy", "apollo", "1mg", "clinic", "hospital") -> "💊 Health & Medicines"
            clean.contains("🧹") || has("maid", "house help", "kamwali") -> "🧹 House Help"
            clean.contains("🛺") || has("auto", "cab", "taxi", "uber", "ola", "rapido", "metro") -> "🛺 Travel & Cab"
            has("cash", "atm", "withdrawal") -> "💵 Cash Withdrawal"
            has("transfer", "diye", "given to", "sent to") -> "🤝 Personal Transfers"
            else -> "💳 " + clean.replace(Regex("^[^\\p{L}\\p{N}]+"), "").trim().ifEmpty { "Other Spends" }
        }
    }
}
