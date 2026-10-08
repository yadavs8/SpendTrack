package com.spendtrack.app.core.model

/**
 * Kharcha Book has no scope column -- a family expense is just a description starting with "🏠 ".
 * This builds that description for an auto-detected expense once the user picks Personal/Family.
 */
object ExpenseScope {
    const val PERSONAL = "personal"
    const val FAMILY = "family"
    const val INVESTMENT = "investment"
    const val TRIP = "trip"
    private const val FAMILY_PREFIX = "🏠 "
    private const val INVESTMENT_PREFIX = "📈 "
    private const val TRIP_PREFIX = "✈️ "

    /**
     * Base text is the user's own note if they typed one (isEdited), else the merchant name --
     * never the raw description, which for auto-detected expenses is the full bank SMS.
     */
    fun describe(merchantName: String?, description: String?, isEdited: Boolean, scope: String, tripName: String? = null): String {
        val base = (if (isEdited) description?.takeIf { it.isNotBlank() } else null)
            ?: merchantName?.takeIf { it.isNotBlank() }
            ?: "Expense"
        val clean = base.trim()
            .removePrefix("🏠").removePrefix("👤").removePrefix("📈").removePrefix("✈️")
            .replace(Regex("^[\\[\\(]?[Tt]rip:?[^\\]\\)]*[\\]\\)]?\\s*"), "")
            .trim()
        return when {
            scope.equals(FAMILY, ignoreCase = true) -> FAMILY_PREFIX + clean
            scope.equals(INVESTMENT, ignoreCase = true) -> INVESTMENT_PREFIX + clean
            scope.equals(TRIP, ignoreCase = true) -> {
                val label = tripName?.trim()?.takeIf { it.isNotBlank() } ?: "Trip"
                "$TRIP_PREFIX$label: $clean"
            }
            else -> clean
        }
    }

    private val SELF_KEYWORDS = listOf(
        "sanjeev yadav",
        "sanjeev",
        "self transfer",
        "own account",
        "transfer to self",
        "transfer to own",
        "to self",
        "to own account",
        "to my account",
        "hdfc to icici",
        "icici to hdfc",
        "linked account"
    )

    private val INVESTMENT_SUBSTRING_KEYWORDS = listOf(
        // Clearing Corporations & Settlement
        "india clearing", "indian clearing", "clearing corp", "clearing corporation",
        "iccl", "nsccl", "nse clearing", "bse clearing", "ccil",
        // Brokers & Apps
        "zerodha", "kite",
        "groww", "nextbillion",
        "angelone", "angel one", "angel broking",
        "indmoney", "ind money", "finzoom",
        "upstox", "rksv",
        "kuvera",
        "dhan", "raise financial",
        "5paisa",
        "paytm money",
        "sharekhan", "geojit", "motilal oswal", "icici direct", "hdfc sky", "kotak securities",
        // AMCs / Mutual Funds
        "mutual fund", "mf central", "camsonline", "camsinvest",
        "kfintech", "kfin",
        "nippon india", "nippon mutual fund",
        "hdfc amc", "hdfc mutual fund", "hdfc mf",
        "icici pru", "icici prudential", "icici mutual fund",
        "sbi mutual fund", "sbi mf", "sbimf",
        "axis mutual fund", "axis mf", "axismf",
        "mirae asset", "parag parikh", "ppfas", "uti mutual fund", "uti amc", "utimf",
        "kotak mutual fund", "dsp mutual fund", "quant mutual fund",
        "tata mutual fund", "aditya birla sun life", "bandhan mutual fund",
        "systematic investment",
        "public provident fund",
        "national pension", "cra-nsdl", "protean",
        "sukanya",
        "sovereign gold", "rbi retail direct",
        "cdsl", "nsdl"
    )

    private val INVESTMENT_WORD_REGEX = Regex(
        """(?i)\b(?:sip|ppf|nps|sgb|ssy|cams|etf|iccl|nsccl|ccil)\b"""
    )

    private val INVESTMENT_VPA_PATTERNS = listOf(
        "@zerodha", "@groww", "@angelone", "@abma", "@indmoney", "@upstox",
        "@kuvera", "@dhan", "@5paisa", "@paytmmoney", "@mfcentral", "@nippon",
        "@iccl", "@nsccl", "@bse", "@nse"
    )

    /**
     * Checks if a transaction is a payment to oneself (Sanjeev Yadav / self account).
     */
    fun isSelfPayment(merchantName: String?, merchantVpa: String?, rawText: String?): Boolean {
        val name = (merchantName ?: "").lowercase()
        val vpa = (merchantVpa ?: "").lowercase()
        val raw = (rawText ?: "").lowercase()
        val combined = "$name $vpa $raw"

        return SELF_KEYWORDS.any { combined.contains(it) } ||
                vpa.contains("sanjeev") || vpa.contains("yadavs")
    }

    /**
     * Checks if a transaction is destined for an investment broker, AMC, mutual fund, SIP, or government scheme.
     */
    fun isInvestment(merchantName: String?, merchantVpa: String?, rawText: String?): Boolean {
        val name = (merchantName ?: "").lowercase()
        val vpa = (merchantVpa ?: "").lowercase()
        val raw = (rawText ?: "").lowercase()
        val combined = "$name $vpa $raw"

        if (INVESTMENT_VPA_PATTERNS.any { vpa.contains(it) || raw.contains(it) }) return true
        if (INVESTMENT_SUBSTRING_KEYWORDS.any { combined.contains(it) }) return true
        if (INVESTMENT_WORD_REGEX.containsMatchIn(combined)) return true

        return false
    }
}
