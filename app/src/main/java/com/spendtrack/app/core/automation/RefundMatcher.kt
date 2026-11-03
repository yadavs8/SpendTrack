package com.spendtrack.app.core.automation

import com.spendtrack.app.core.parser.IncomeParser
import java.util.Locale

/**
 * Which earlier spend a refund belongs to. Pure logic (see RefundMatcherTest).
 *
 * A refund is matched by the merchant it comes from ("Airbnb", "Myntra"), never by amount alone --
 * a wrong match would lower the wrong purchase. Among that merchant's purchases it prefers one with
 * the same amount (a full refund), otherwise the smallest one the refund fits inside (a partial
 * refund, e.g. a cancellation fee kept back), most recent first on a tie.
 */
object RefundMatcher {

    data class Candidate(val key: String, val amount: Double, val text: String, val description: String, val spentAt: Long)

    // Words in merchant names that don't identify the merchant.
    private val STOP = setOf(
        "payments", "payment", "india", "private", "limited", "ltd", "pvt", "technologies", "technology",
        "services", "service", "store", "stores", "online", "bank", "card", "credit", "debit", "refund", "refunded",
        "reversal", "credited", "account", "your", "from", "towards", "with", "designs", "design", "retail",
        "solutions", "internet", "commerce", "ecommerce", "enterprises", "trading", "company", "merchant"
    )
    private val BRANDS = listOf(
        "airbnb", "myntra", "amazon", "flipkart", "swiggy", "zomato", "ajio", "nykaa", "meesho", "uber", "rapido",
        "makemytrip", "goibibo", "irctc", "agoda", "booking.com", "bigbasket", "blinkit", "zepto", "bookmyshow",
        "cleartrip", "oyo", "tatacliq", "decathlon", "croma", "jiomart", "firstcry", "lenskart", "urban company",
        "indigo", "spicejet", "akasa", "vistara", "air india", "redbus", "ixigo", "dominos", "mcdonald", "netflix",
        "hotstar", "spotify"
        // not "google"/"apple": a refund paid through Google Pay would match a Google Play purchase
    )

    // Money really back in the account/card -- not a shop's "refund initiated / will be credited".
    private val CREDITED = Regex("""(?i)(?:a/c|acct|account|card)[\s\S]{0,80}\b(?:credited|reversed|refunded)\b|\b(?:credited|reversed|refunded)\b[\s\S]{0,80}(?:a/c|acct|account|card)""")
    private val NOT_YET = Regex("""(?i)\b(?:initiated|will be (?:credited|refunded|processed)|being processed|in process|request(?:ed)? for refund|refund request|within \d+\s*(?:-\s*\d+\s*)?(?:working |business )?days)\b""")
    private val FROM = Regex("""(?i)\b(?:refund|reversal|refunded|credited)\b[^.;]{0,60}?\b(?:from|by)\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=\s+(?:has|have|is|was|on|for|to|towards|against|ref|upi|via|into|in)\b|[.,;(]|$)""")

    /** Is this a refund that has actually reached the bank account / card? */
    fun isRealCredit(raw: String): Boolean = CREDITED.containsMatchIn(raw) && !NOT_YET.containsMatchIn(raw)

    /** Who the money came back from ("Airbnb Payments", "MYNTRA DESIGNS"), if the message says. */
    fun refundFrom(raw: String, parsedMerchant: String?): String? =
        FROM.find(raw)?.groupValues?.get(1)?.trim()
            ?: IncomeParser.extractPayer(raw)
            ?: parsedMerchant?.takeIf { it.isNotBlank() && !it.contains("card", ignoreCase = true) && !it.contains("your", ignoreCase = true) }

    /** Words that identify the merchant: distinctive words of [from], plus known brands named anywhere. */
    fun keywords(from: String?, raw: String): List<String> {
        val words = (from ?: "").lowercase(Locale.ROOT).split(Regex("[^a-z0-9.]+"))
            .map { it.trim('.') }.filter { it.length >= 4 && it !in STOP }
        val lower = raw.lowercase(Locale.ROOT)
        val brands = BRANDS.filter { lower.contains(it) }
        return (words + brands).distinct()
    }

    private val BUSINESS_WORDS = Regex("""(?i)\b(?:pvt|private|ltd|limited|llp|inc|technologies|technology|services|payments|retail|ecommerce|e-commerce|online|stores?|designs?|enterprises|solutions|india)\b""")

    /**
     * Is the sender a business (a merchant can refund you) rather than a person? Money from a friend
     * or relative stays income -- only shops' credits are treated as quiet refunds.
     */
    fun looksLikeBusiness(payer: String?, raw: String): Boolean {
        val p = payer?.lowercase(Locale.ROOT).orEmpty()
        if (p.isNotBlank() && (BUSINESS_WORDS.containsMatchIn(p) || BRANDS.any { p.contains(it) })) return true
        return BRANDS.any { raw.lowercase(Locale.ROOT).contains(it) }
    }

    fun matches(c: Candidate, keys: List<String>): Boolean {
        val t = c.text.lowercase(Locale.ROOT)
        return keys.any { k -> t.contains(k) }
    }

    /** The purchase this refund belongs to, or null when nothing fits safely. */
    fun pick(cands: List<Candidate>, refund: Double, keys: List<String>): Candidate? {
        if (keys.isEmpty()) return null
        val fits = cands.filter { matches(it, keys) && it.amount >= refund - 0.5 }
        if (fits.isEmpty()) return null
        fits.filter { kotlin.math.abs(it.amount - refund) <= 1.0 }.maxByOrNull { it.spentAt }?.let { return it }
        val smallest = fits.minOf { it.amount }
        return fits.filter { it.amount == smallest }.maxByOrNull { it.spentAt }
    }

    private val NOTE = Regex("""\s*\(↩ ₹([\d,]+(?:\.\d+)?) refunded\)\s*$""")

    /** "Myntra (↩ ₹1,200 refunded)": adds to any refund already noted; keeps the label within 60 chars. */
    fun withRefundNote(description: String, refundedNow: Double): String {
        val prev = NOTE.find(description)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull() ?: 0.0
        val base = NOTE.replace(description, "").trim()
        val note = " (↩ ${Insights.rupees(prev + refundedNow)} refunded)"
        return base.take((60 - note.length).coerceAtLeast(10)).trimEnd() + note
    }
}
