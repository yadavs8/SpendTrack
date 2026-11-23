package com.spendtrack.app.core.model

/**
 * Trip mode files every fresh payment into the active trip. Some payments are clearly not trip spends,
 * and filing them there splits them with friends and inflates the trip:
 *  - a credit card bill (CRED, "credit card bill", BBPS card payment) only pays for spends already counted,
 *  - a very large transfer (₹25,000 and more: a fixed deposit, rent, money to your own or family accounts),
 *  - subscriptions and bills that carry on whatever you are doing (Claude, Netflix, phone/DTH recharges...),
 *  - a payee you have already filed as Personal / Family / Investment twice or more.
 * For those the phone asks "Personal / Family / Trip?" instead of deciding. Everything else still goes
 * to the trip by itself, as before.
 */
object TripFilingGuard {
    const val LARGE_AMOUNT = 25_000.0

    private val CARD_BILL = Regex(
        // Paying the card bill, not a purchase made with the card ("spent on your credit card" is a normal spend).
        """(?i)\bcred\b|cred\.club|credit\s*card\s*(?:bill|dues?)|\bcard\s*(?:bill|dues)\b|\bcc\s*bill\b|\bbbps\b|""" +
            """\b(?:payment|paid)\b[^.]{0,40}\btowards\b[^.]{0,30}\bcard\b|received\s+towards\s+(?:your\s+)?(?:credit\s+)?card"""
    )
    private val SUBSCRIPTION = Regex(
        """(?i)anthropic|\bclaude\b|openai|chatgpt|netflix|spotify|youtube\s*premium|google\s*(?:one|play|storage|workspace)|apple\.com|icloud|""" +
            """amazon\s*prime|prime\s*video|hotstar|jiocinema|sonyliv|zee5|microsoft|adobe|github|notion|canva|linkedin|""" +
            """\brecharge\b|\bpostpaid\b|\bbroadband\b|\bdth\b|tata\s*play|airtel\s*(?:xstream|dth|postpaid)|jio\s*fiber|""" +
            """\binsurance\b|\bpremium\b|\bemi\b|\bloan\b|\bsip\b|mutual\s*fund"""
    )
    private val OTHER_SCOPES = setOf(ExpenseScope.PERSONAL, ExpenseScope.FAMILY, ExpenseScope.INVESTMENT)

    /** Why this payment should be asked about instead of auto-filed to the trip, or null to file it. */
    fun reasonToAsk(
        merchantName: String?,
        merchantVpa: String?,
        rawText: String?,
        amount: Double,
        learnedScope: String?,
        learnedConfirmations: Int,
        autoFileAfter: Int
    ): String? {
        val who = listOfNotNull(merchantName, merchantVpa).joinToString(" ")
        val all = "$who ${rawText.orEmpty()}"
        if (learnedScope != null && learnedConfirmations >= autoFileAfter &&
            OTHER_SCOPES.any { it.equals(learnedScope, ignoreCase = true) }) return "learned:$learnedScope"
        if (CARD_BILL.containsMatchIn(all)) return "card-bill"
        if (amount >= LARGE_AMOUNT) return "large"
        if (SUBSCRIPTION.containsMatchIn(who)) return "subscription"
        return null
    }
}
