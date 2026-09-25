package com.spendtrack.app.core.parser

import java.util.Locale

/**
 * Decides whether a notification / SMS describes money that has ALREADY left the user's account.
 *
 * Every parsing path (user templates, JSON rule pack, heuristic parser) must pass through
 * [rejectionReason] first, so OTPs, offers, bill reminders, payment requests, failed/pending
 * payments and incoming money are never recorded as expenses.
 */
object TransactionFilter {

    // One-time passwords and verification codes ("OTP for txn of Rs 500 at Amazon")
    private val OTP_REGEX = Regex(
        """(?i)\b(?:otp|one[\s-]?time[\s-]?pass(?:word|code)?|verification\s*code|security\s*code|cvv|do\s*not\s*share|don'?t\s*share|never\s*share)\b"""
    )

    // Payment did not go through, or has not completed yet
    private val FAILED_OR_PENDING_REGEX = Regex(
        """(?i)\b(?:failed|failure|declined|unsuccessful|not\s+successful|could\s*not\s*be\s*(?:completed|processed)|couldn'?t\s*be\s*(?:completed|processed)|cancell?ed|rejected|insufficient|timed?\s*out|pending|in\s*progress|processing(?!\s*(?:fee|charge))|on\s*hold|awaiting|initiated|under\s*process)\b"""
    )

    // Money requested from the user, dues that are NOT yet paid, future / scheduled debits.
    // Rejected even when the message also contains words like "debited" ("will be debited on 5th").
    private val REQUEST_OR_FUTURE_REGEX = Regex(
        """(?i)(?:\brequest(?:ed|s)?\s+(?:of|for|from|money|rs\.?|inr|₹|\d)|\bhas\s+requested\b|\brequesting\b|\b(?:money|payment|collect|upi)\s+request\b|\bis\s+due\b|\bdue\s+(?:on|by|date|in|today|tomorrow)\b|\bover\s*due\b|\bpay\s+now\b|\bwill\s+be\s+(?:auto[\s-]?)?(?:debited|charged|deducted|paid)\b|\bto\s+be\s+(?:debited|charged|deducted)\b|\bscheduled\b|\bupcoming\b|\bmandate\s+(?:created|registered|set\s*up|setup|approved|request)\b|\bauto[\s-]?pay\s+(?:set\s*up|setup|activated|enabled)\b)"""
    )

    // Money unmistakably came IN - rejected even if the text also says "transferred"/"paid"
    private val STRONG_INCOMING_REGEX = Regex(
        """(?i)(?:\bcredited\s+(?:to|in|into)\s+(?:your|ur)\b|\b(?:your|ur)\s+(?:a/c|acct|account|wallet)\s*(?:no\.?)?\s*[x*]*\d*\s+(?:is|has\s+been)\s+credited\b|\breceived\s+(?:from|rs\.?|inr|₹|\d)|\byou\s+(?:have\s+)?received\b|\bpaid\s+you\b|\bsent\s+you\b|\bhas\s+sent\s+(?:you|rs\.?|inr|₹|\d)|\btransferred\s+to\s+(?:your|ur|you)\b|\bdeposited\s+(?:in|to|into)\s+(?:your|ur)\b|\badded\s+to\s+(?:your|ur)\b)"""
    )

    // Marketing / offers. Only rejected when the message has no strong "money already left" evidence.
    private val PROMO_REGEX = Regex(
        """(?i)(?:\boffers?\b|\bget\s+(?:up\s*to|upto|flat|extra)\b|\bup\s*to\b|\bupto\b|\bflat\s+(?:rs\.?|inr|₹|\d)|%\s*off\b|\bdiscount\b|\bcoupon\b|\bvoucher\b|\bwin\b|\bwon\b|\breward|\bscratch\s*card\b|\bpre[\s-]?approved\b|\beligible\b|\bapply\s+now\b|\bclick\b|\bhttps?://|\bt\s*&\s*c\b|\bcashback\b|\bexciting\b|\bhurry\b|\blimited\s+period\b|\bshop\s+now\b|\bbuy\s+now\b|\binstant\s+loan\b|\bloan\s+(?:of|up\s*to|upto)\b)"""
    )

    // Money came IN (salary, UPI received, someone paid the user). Checked only when there is no debit evidence.
    private val INCOMING_REGEX = Regex(
        """(?i)(?:\bcredited\b|\breceived\b|\bdeposited\b|\bpaid\s+you\b|\bsent\s+you\b|\bhas\s+sent\b|\btransferred\s+to\s+you\b|\badded\s+to\s+(?:your\s+)?(?:a/c|account|wallet|balance)\b|\bsalary\b|\binterest\s+(?:paid|earned)\b)"""
    )

    // Strong evidence that money has already left the user's account / card / wallet
    private val DEBIT_EVIDENCE_REGEX = Regex(
        """(?i)(?:\bdebited\b|\bdebit(?:ed)?\s+(?:of|by|with|for)\b|\bspent\b|\bpaid\s+(?:to\b|rs\.?|inr|₹|\d|successfully\b|for\b|at\b)|\byou\s+(?:have\s+)?paid\b|\bpayment\b.{0,80}?\b(?:successful|successfully|completed|done|made)\b|(?:rs\.?|inr|₹)\s*[0-9][0-9,]*(?:\.[0-9]+)?\s+(?:(?:has\s+been|was|is)\s+)?(?:paid|sent|debited|spent|deducted)\b|\b(?:transaction|txn|recharge|bill\s+payment)\b.{0,40}?\bsuccessful(?:ly)?\b|\bpaid\s+via\b|\bsent\s+(?:to\b|rs\.?|inr|₹|\d)|\bmoney\s+sent\b|\btransferred\s+(?:to|from)\b|\bwithdrawn\b|\bwithdrawal\s+of\b|\bpurchase\s+(?:of|at|for)\b|\bpurchased\b|\b(?:txn|transaction)\s+of\s+(?:rs\.?|inr|₹)\s*[0-9][0-9,]*(?:\.[0-9]+)?\s+(?:done\s+)?(?:at|on|using|via|from|to)\b|\bused\s+(?:for|at)\b|\bdeducted\b|\bcharged\b|\bauto[\s-]?debit(?:ed)?\s+(?:of|for)\b)"""
    )

    // Refunds / reversals are recorded (as excluded REFUND entries) but never as expenses
    private val REFUND_REGEX = Regex("""(?i)\b(?:refund|refunded|reversed|reversal)\b""")

    /** Mobile numbers (with or without +91) - SMS from people, not banks. */
    private val PERSONAL_SENDER_REGEX = Regex("""^\+?\d{10,}$""")

    fun isRefund(text: String): Boolean = REFUND_REGEX.containsMatchIn(text)

    fun hasDebitEvidence(text: String): Boolean {
        // "credit card" is an instrument, not incoming money; "prepaid"/"unpaid" are not "paid"
        return DEBIT_EVIDENCE_REGEX.containsMatchIn(normalize(text))
    }

    /**
     * Returns null when [text] looks like a genuine, completed outgoing transaction (or refund),
     * otherwise a short reason why it must be ignored.
     *
     * @param requireDebitEvidence false only for user-taught templates, where the user has already
     * confirmed the message format represents a real payment.
     */
    fun rejectionReason(text: String, requireDebitEvidence: Boolean = true): String? {
        if (text.isBlank()) return "empty"
        val content = normalize(text)

        if (OTP_REGEX.containsMatchIn(content)) return "otp"
        if (FAILED_OR_PENDING_REGEX.containsMatchIn(content)) return "failed_or_pending"
        if (REQUEST_OR_FUTURE_REGEX.containsMatchIn(content)) return "request_or_future"

        val refund = isRefund(content)
        if (!refund && STRONG_INCOMING_REGEX.containsMatchIn(content)) return "incoming"
        val debit = DEBIT_EVIDENCE_REGEX.containsMatchIn(content)

        if (!refund && !debit && INCOMING_REGEX.containsMatchIn(content)) return "incoming"
        if (!refund && !debit && PROMO_REGEX.containsMatchIn(content)) return "promotion"
        if (requireDebitEvidence && !refund && !debit) return "no_debit_evidence"

        return null
    }

    /** SMS from a 10+ digit phone number is a personal message, never a bank alert. */
    fun isPersonalSmsSender(sender: String?): Boolean {
        if (sender.isNullOrBlank()) return false
        return PERSONAL_SENDER_REGEX.matches(sender.replace(" ", "").replace("-", ""))
    }

    private fun normalize(text: String): String =
        text.replace(Regex("""(?i)credit\s*card"""), "card")
            .replace('\n', ' ')
            .lowercase(Locale.ROOT)
}
