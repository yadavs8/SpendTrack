package com.spendtrack.app.core.deduplication

import java.util.Locale
import kotlin.math.abs

/**
 * "Do these two messages describe the same payment?" -- the on-device matcher behind duplicate
 * detection. One real payment often produces several texts that arrive hours apart and look
 * nothing alike: the bank's debit SMS, the UPI app's notification, and the merchant's own
 * "thank you, premium received" SMS or WhatsApp. Each used to become its own expense (an insurance
 * premium was saved three times), because the old check only looked 15 minutes either side and
 * needed the merchant names to match.
 *
 * This scores a pair on the evidence a person would use -- same amount, how close in time, shared
 * names, a shared policy / order / reference number, different senders, receipt-style wording --
 * and penalises what points to two separate payments (same app twice, different named payees,
 * small round amounts that repeat). Everything runs on the phone; no message text leaves it.
 */
object SmartMatcher {

    /** Score at or above which two messages are treated as one payment and merged automatically. */
    const val SAME_PAYMENT = 0.60

    /** Score at or above which the user is asked "same payment?" instead of guessing. */
    const val MAYBE_SAME = 0.38

    /** Messages further apart than this are never the same payment. */
    const val MAX_WINDOW_MS = 72 * 60 * 60 * 1000L

    data class Msg(
        val amount: Double,
        val time: Long,
        val merchant: String? = null,
        val vpa: String? = null,
        val rawText: String? = null,
        val ref: String? = null,
        val last4: String? = null,
        /** "SMS", "NOTIFICATION", "SMS+NOTIFICATION"... */
        val source: String? = null,
        val sourcePackage: String? = null,
        val incoming: Boolean = false
    )

    private const val UNKNOWN_MERCHANT = "unknown merchant"

    private val RECEIPT_WORDS = Regex(
        """(?i)\b(?:premium|policy|insurance|receipt|invoice|order|booking|renew(?:al|ed)?|thank\s*you|successfully\s+received|payment\s+received|has\s+been\s+received|we\s+(?:have\s+)?received|towards|bill\s+(?:paid|payment))\b"""
    )
    private val UPI_RRN = Regex("""^\d{12}$""")
    // Reference-like numbers, separators allowed ("4012/7788/22", "ORD-88231").
    private val ID_NUMBER = Regex("""\d[\d/\-]{3,}\d""")
    private val WORD = Regex("""[a-z][a-z0-9&]{2,}""")

    // Words every money message shares; they say nothing about *which* payment it is.
    private val STOP_WORDS = setOf(
        "the", "and", "for", "you", "your", "our", "has", "have", "been", "was", "with", "from", "via", "upi",
        "ref", "utr", "rrn", "txn", "transaction", "payment", "paid", "pay", "sent", "debited", "credited", "spent",
        "received", "amount", "account", "acct", "bank", "card", "credit", "debit", "inr", "dear", "customer",
        "thank", "thanks", "successful", "successfully", "done", "info", "avl", "bal", "balance", "available",
        "not", "call", "sms", "block", "fraud", "report", "this", "that", "are", "will", "now", "time", "date",
        "dated", "towards", "rupees", "only", "mobile", "app", "help", "visit", "www", "http", "https", "com",
        "regards", "team", "ltd", "pvt", "limited", "india", "private", "services", "payments", "unknown",
        "merchant", "mandate", "auto", "autopay", "nach", "imps", "neft", "rtgs", "vpa", "net", "banking", "kotak",
        "hdfc", "icici", "axis", "sbi", "pnb", "canara", "yes", "indusind", "idfc", "bob", "baroda", "phonepe",
        "gpay", "google", "paytm", "bhim", "cred", "whatsapp", "jan", "feb", "mar", "apr", "may", "jun", "jul",
        "aug", "sep", "sept", "oct", "nov", "dec", "monday", "tuesday", "wednesday", "thursday", "friday",
        "saturday", "sunday", "today", "on", "at", "to", "of", "is", "in", "it", "by"
    )

    /**
     * 0.0 (clearly different) .. 1.0 (certainly the same payment), or null when they can't be the
     * same payment at all (other direction, different amount, too far apart, different card, two
     * different UPI reference numbers).
     */
    fun score(a: Msg, b: Msg): Double? {
        if (a.incoming != b.incoming) return null
        if (a.amount <= 0 || b.amount <= 0) return null
        val amountDiff = abs(a.amount - b.amount)
        if (amountDiff > 1.0) return null // ₹1,234.50 vs ₹1,235 is a rounded copy; anything more is another payment
        val gap = abs(a.time - b.time)
        if (gap > MAX_WINDOW_MS) return null
        if (!a.last4.isNullOrBlank() && !b.last4.isNullOrBlank() && a.last4 != b.last4) return null

        val refA = a.ref?.trim()?.takeIf { it.isNotEmpty() }
        val refB = b.ref?.trim()?.takeIf { it.isNotEmpty() }
        if (refA != null && refB != null) {
            if (refA.equals(refB, ignoreCase = true)) return 1.0
            // Two different UPI reference numbers are two payments. Other "Ref No." values (a policy or
            // order number in a merchant's text) are weaker evidence, so they only count against.
            if (UPI_RRN.matches(refA) && UPI_RRN.matches(refB)) return null
        }

        var s = 0.0
        if (amountDiff > 0.009) s -= 0.05
        if (refA != null && refB != null) s -= 0.15

        s += when {
            gap <= 10 * 60 * 1000L -> 0.30
            gap <= 2 * 60 * 60 * 1000L -> 0.22
            gap <= 6 * 60 * 60 * 1000L -> 0.18
            gap <= 24 * 60 * 60 * 1000L -> 0.14
            else -> 0.06
        }

        // Who was paid.
        val merchantA = cleanMerchant(a.merchant)
        val merchantB = cleanMerchant(b.merchant)
        val textTokensA = tokens(listOfNotNull(a.rawText, a.merchant, a.vpa?.substringBefore('@')).joinToString(" "))
        val textTokensB = tokens(listOfNotNull(b.rawText, b.merchant, b.vpa?.substringBefore('@')).joinToString(" "))
        val sharedText = textTokensA.intersect(textTokensB).size
        if (merchantA != null && merchantB != null) {
            val ma = tokens(merchantA)
            val mb = tokens(merchantB)
            val jaccard = if (ma.isEmpty() || mb.isEmpty()) 0.0 else ma.intersect(mb).size.toDouble() / ma.union(mb).size
            val compactA = merchantA.replace(Regex("[^a-z0-9]"), "")
            val compactB = merchantB.replace(Regex("[^a-z0-9]"), "")
            val contains = compactA.length >= 4 && compactB.length >= 4 && (compactA.contains(compactB) || compactB.contains(compactA))
            s += when {
                jaccard >= 0.5 || contains -> 0.25
                jaccard > 0.0 -> 0.15
                sharedText >= 2 -> 0.12
                else -> -0.10 // two different named payees
            }
        } else {
            s += when {
                sharedText >= 2 -> 0.15
                sharedText == 1 -> 0.07
                else -> 0.0
            }
        }

        // A policy / order / account number quoted in both texts.
        if (sharedLongNumber(a.rawText, b.rawText, a.amount)) s += 0.25

        // Same app or sender twice is usually two payments; a bank SMS plus an app or merchant text is one.
        val sameSender = a.sourcePackage == b.sourcePackage && a.source == b.source && senderOf(a.rawText) == senderOf(b.rawText)
        if (sameSender) s -= 0.15 else s += 0.10

        // "Thank you, we received your premium" after a debit is the merchant confirming that debit.
        val receiptA = isReceiptStyle(a.rawText)
        val receiptB = isReceiptStyle(b.rawText)
        if (receiptA != receiptB && !sameSender) s += 0.12 else if (receiptA || receiptB) s += 0.06

        // Big or odd amounts rarely repeat by chance (₹12,345 twice in a day is one payment);
        // ₹20 chai twice a day is two.
        val amount = maxOf(a.amount, b.amount)
        if (amount >= 1000) s += 0.05
        if (amount >= 500 && amount % 100.0 != 0.0) s += 0.10
        if (amount < 100) s -= 0.10

        return s.coerceIn(0.0, 1.0)
    }

    fun isReceiptStyle(text: String?): Boolean = !text.isNullOrBlank() && RECEIPT_WORDS.containsMatchIn(text)

    private fun cleanMerchant(m: String?): String? {
        val t = m?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
        if (t == UNKNOWN_MERCHANT) return null
        return t
    }

    private fun tokens(text: String): Set<String> =
        WORD.findAll(text.lowercase(Locale.ROOT)).map { it.value }.filter { it !in STOP_WORDS }.toSet()

    /** First word of the text, which for SMS is usually the sender ("AX-HDFCBK ...", "ICICI Lombard: ..."). */
    private fun senderOf(text: String?): String =
        text?.trim()?.substringBefore(' ')?.lowercase(Locale.ROOT).orEmpty()

    private fun sharedLongNumber(a: String?, b: String?, amount: Double): Boolean {
        if (a.isNullOrBlank() || b.isNullOrBlank()) return false
        val amountDigits = setOf(
            amount.toLong().toString(),
            String.format(Locale.US, "%.2f", amount).replace(".", "")
        )
        fun ids(t: String) = ID_NUMBER.findAll(t).map { it.value.filter(Char::isDigit) }.filter { it.length >= 5 }.toSet()
        val numbersA = ids(a).filter { it !in amountDigits && !looksLikeDate(it) }.toSet()
        if (numbersA.isEmpty()) return false
        val numbersB = ids(b)
        return numbersA.any { it in numbersB }
    }

    // 14102026 / 20261014 / 141026 are dates, which every message from that day shares.
    private fun looksLikeDate(n: String): Boolean = n.length in 6..8 && (n.startsWith("20") || n.endsWith("2026") || n.endsWith("2025") || n.endsWith("2027"))
}
