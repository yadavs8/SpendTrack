package com.spendtrack.app.core.model

/**
 * Kharcha Book has no scope column -- the scope is a description prefix ("🏠 ", "📈 ", "✈️ Goa: ",
 * "🔨 "). This builds that description once the user picks where an auto-detected expense belongs,
 * and holds the heuristics that file an expense without asking.
 */
object ExpenseScope {
    const val PERSONAL = "personal"
    const val FAMILY = "family"
    const val INVESTMENT = "investment"
    const val TRIP = "trip"
    const val PROJECT = "project"
    private const val FAMILY_PREFIX = "🏠 "
    private const val INVESTMENT_PREFIX = "📈 "
    private const val TRIP_PREFIX = "✈️ "
    private const val PROJECT_PREFIX = "🔨 "

    /**
     * Base text is the user's own note if they typed one (isEdited), else the merchant name --
     * never the raw description, which for auto-detected expenses is the full bank SMS.
     */
    fun describe(merchantName: String?, description: String?, isEdited: Boolean, scope: String, tripName: String? = null): String {
        val base = (if (isEdited) description?.takeIf { it.isNotBlank() } else null)
            ?: merchantName?.takeIf { it.isNotBlank() }
            ?: "Expense"
        val clean = stripScope(base)
        return when {
            scope.equals(FAMILY, ignoreCase = true) -> FAMILY_PREFIX + clean
            scope.equals(INVESTMENT, ignoreCase = true) -> INVESTMENT_PREFIX + clean
            scope.equals(PROJECT, ignoreCase = true) -> PROJECT_PREFIX + clean
            scope.equals(TRIP, ignoreCase = true) -> {
                val label = tripName?.trim()?.takeIf { it.isNotBlank() } ?: "Trip"
                "$TRIP_PREFIX$label: $clean"
            }
            else -> clean
        }
    }

    /** Removes any existing scope prefix, including a "✈️ Goa: " trip label, so scopes never stack. */
    fun stripScope(text: String): String {
        var t = text.trim()
        if (t.startsWith("✈")) {
            t = t.removePrefix("✈️").removePrefix("✈").trim()
            val colon = t.indexOf(':')
            if (colon in 1..40) t = t.substring(colon + 1)
        }
        return t.trim()
            .removePrefix("🏠").removePrefix("👤").removePrefix("📈").removePrefix("🔨")
            .replace(Regex("^[\\[\\(]?[Tt]rip:?[^\\]\\)]*[\\]\\)]?\\s*"), "")
            .trim()
    }

    // Explicit "this is my own money moving" phrasing in the SMS/notification text.
    private val SELF_TRANSFER_PHRASES = Regex(
        """(?i)\bself[- ]?transfer\b|\btransfer(?:red)?\s+to\s+(?:self|own|my)\b|\bto\s+(?:your\s+)?own\s+(?:account|a/c)\b|\bto\s+self\b"""
    )

    /**
     * True when money is moving between the user's own accounts.
     *
     * [owners] are the user's own full name(s) and UPI ID(s), from settings. They are matched only
     * against the payee name and UPI ID -- never the whole SMS, which often greets the account
     * holder by name ("Dear Sanjeev, Rs 500 debited...") on every payment. A full name is required
     * (a payee merely sharing a first name is someone else), and UPI IDs must match exactly.
     */
    fun isSelfPayment(merchantName: String?, merchantVpa: String?, rawText: String?, owners: List<String> = emptyList()): Boolean {
        if (SELF_TRANSFER_PHRASES.containsMatchIn(rawText ?: "")) return true
        return isFromPeople(merchantName, merchantVpa, owners)
    }

    /** The payer/payee is one of [people] (full names or exact UPI IDs; same rules as owners). */
    fun isFromPeople(merchantName: String?, merchantVpa: String?, people: List<String>): Boolean {
        val payee = (merchantName ?: "").lowercase().replace(Regex("\\s+"), " ").trim()
        val vpa = (merchantVpa ?: "").lowercase().trim()
        return people.map { it.lowercase().replace(Regex("\\s+"), " ").trim() }.any { owner ->
            when {
                owner.contains('@') -> vpa.isNotBlank() && vpa == owner
                owner.split(' ').size < 2 -> false
                else -> payee == owner || payee.startsWith("$owner ")
            }
        }
    }

    /** Parses the comma/newline separated "your name and UPI IDs" setting. */
    fun parseOwners(setting: String?): List<String> =
        (setting ?: "").split(',', '\n').map { it.trim() }.filter { it.isNotBlank() }

    private val INVESTMENT_SUBSTRING_KEYWORDS = listOf(
        // Clearing Corporations & Settlement
        "india clearing", "indian clearing", "clearing corp", "clearing corporation",
        "nse clearing", "bse clearing",
        // Brokers & Apps (short names like "dhan"/"kite" are whole-word only, below)
        "zerodha",
        "groww", "nextbillion",
        "angelone", "angel one", "angel broking",
        "indmoney", "ind money", "finzoom",
        "upstox", "rksv",
        "kuvera",
        "raise financial",
        "5paisa",
        "paytm money",
        "sharekhan", "geojit", "motilal oswal", "icici direct", "hdfc sky", "kotak securities",
        // AMCs / Mutual Funds
        "mutual fund", "mf central", "camsonline", "camsinvest",
        "kfintech",
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
        "sovereign gold", "rbi retail direct"
    )

    // Short tokens that appear inside ordinary words ("Govardhan Dairy", "Dhanlaxmi Kirana",
    // "kite shop") must match as whole words only.
    private val INVESTMENT_WORD_REGEX = Regex(
        """(?i)\b(?:sip|ppf|nps|sgb|ssy|cams|etf|iccl|nsccl|ccil|dhan|kite|kfin|cdsl|nsdl)\b"""
    )

    private val INVESTMENT_VPA_PATTERNS = listOf(
        "@zerodha", "@groww", "@angelone", "@abma", "@indmoney", "@upstox",
        "@kuvera", "@dhan", "@5paisa", "@paytmmoney", "@mfcentral", "@nippon",
        "@iccl", "@nsccl", "@bse", "@nse"
    )

    /** True for payments to a broker, AMC, mutual fund, SIP, clearing corp or government scheme. */
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
