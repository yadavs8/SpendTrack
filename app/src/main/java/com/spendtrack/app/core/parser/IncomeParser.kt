package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType

/**
 * Money coming *in*: salary, UPI received, NEFT/IMPS credits, interest, cashback -- and refunds,
 * which are matched to the original expense later.
 *
 * Deliberately strict, because a wrong "income" inflates savings just like a phantom expense
 * inflates spending. A message counts only when *your* account/card is the one credited
 * ("A/c XX12 credited", "credited to your account", "Rahul paid you ₹500"). It is NOT income when:
 *  - your account was debited (ICICI writes "...debited ...; Rahul credited" for your own payment),
 *  - it's a credit card bill payment landing on the card (that's a transfer),
 *  - it's a loan disbursal, a failed-payment reversal of money that never left, or an offer/OTP.
 * Own-account transfers are filtered later, by the owner's names in settings.
 */
object IncomeParser {

    enum class Kind(val label: String) { SALARY("Salary"), INTEREST("Interest"), CASHBACK("Cashback"), DIVIDEND("Dividend"), RECEIVED("Received") }

    // Our account / card is the one credited.
    private val OUR_ACCOUNT_CREDITED = Regex(
        """(?i)(?:a/c|acct|account|wallet)\b[^.;]{0,45}?\b(?:is\s+|has\s+been\s+|was\s+)?credited\b|\bcredited\s+(?:to|in|into)\s+(?:your\s+)?(?:a/c|acct|account|wallet|bank)|\b(?:deposited|added)\s+(?:to|in|into)\s+(?:your\s+)?(?:a/c|acct|account|wallet)|\bcredited\s*(?:with|by|for|:)?\s*(?:rs\.?|inr|₹)"""
    )
    // App notifications: "Rahul paid you ₹500", "You received ₹500 from Rahul".
    private val RECEIVED_BY_YOU = Regex("""(?i)\b(?:paid|sent)\s+you\b|\byou(?:'ve| have)?\s+received\b|\breceived\s+(?:rs\.?|inr|₹)|\bmoney\s+received\b""")
    // Our account debited -> this is a payment, whatever else is "credited".
    private val OUR_ACCOUNT_DEBITED = Regex("""(?i)(?:a/c|acct|account|card)\b[^.;]{0,45}?\b(?:is\s+|has\s+been\s+|was\s+)?debited\b|\bdebited\s+(?:from|to)\s+(?:your\s+)?(?:a/c|acct|account)|\byou\s+(?:paid|sent)\b|\bspent\b|\bwithdrawn\b""")

    private val CARD_PAYMENT = Regex("""(?i)\bcredit\s*card\b|\bcard\s*(?:ending|xx|\*|no\.?)|towards\s+your\s+card|\bcard\s+bill\b""")
    private val REFUND = Regex("""(?i)\brefund(?:ed)?\b|\brevers(?:ed|al)\b|\bchargeback\b""")
    // Reversal of a payment that failed: the money never left, so it's neither income nor a refund.
    private val FAILED_REVERSAL = Regex("""(?i)\b(?:failed|unsuccessful|declined)\b""")
    private val LOAN = Regex("""(?i)\bloan\b|\bdisburs""")

    private val SALARY = Regex("""(?i)\bsalary\b|\bsal\b|\bpayroll\b|\bsal\s*cr\b""")
    private val INTEREST = Regex("""(?i)\binterest\b|\bint\.?\s*cr\b|\bint\s+pd\b""")
    private val CASHBACK = Regex("""(?i)\bcash\s*back\b""")
    private val DIVIDEND = Regex("""(?i)\bdividend\b|\bdiv\b""")

    // Who sent it.
    private val PAYER_PATTERNS = listOf(
        Regex("""(?i)^\s*([A-Za-z][A-Za-z .'&-]{1,40}?)\s+(?:paid|sent)\s+you\b"""),                 // GPay: "Rahul Sharma paid you ₹500"
        Regex("""(?i);\s*([A-Za-z][A-Za-z0-9 .'&-]{1,40}?)\s+debited\b"""),                         // ICICI: "...credited ...; RAHUL debited"
        Regex("""(?i)\bfrom\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 .'&-]{1,40}?)(?=\s+(?:on|via|ref|upi|utr|imps|neft|to|in|a/c|acct|is|has)\b|[.;,(]|\s*$)"""),
        Regex("""(?i)\bby\s+(?!upi\b|neft\b|imps\b|rtgs\b|transfer\b|cash\b)([A-Za-z][A-Za-z0-9 .'&-]{1,40}?)(?=\s+(?:on|via|ref|upi|utr|imps|neft|is|has)\b|[.;,(]|\s*$)"""),
        Regex("""(?i)\b(?:upi|imps|neft)[/-](?:cr[/-])?\d{6,}[/-]([A-Za-z][A-Za-z .]{1,30})""")  // "Info: UPI/CR/123456/RAHUL"
    )
    private val PAYER_STOP = Regex("""(?i)^(?:your|you|a/c|account|acct|bank|upi|vpa|the|rs|inr|self)\b""")
    private val VPA = Regex("""\b([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})\b""")

    fun parse(title: String?, text: String?, sourcePackage: String? = null, timestamp: Long = System.currentTimeMillis()): ParsedTransaction? {
        val body = text ?: ""
        val full = "${title ?: ""} $body".trim()
        if (full.isBlank()) return null
        if (TransactionParser.isNonTransaction(full) || TransactionParser.isNotYetCompleted(full)) return null

        val isCredit = OUR_ACCOUNT_CREDITED.containsMatchIn(full) || RECEIVED_BY_YOU.containsMatchIn(full)
        if (!isCredit) return null
        // "Paid you" is incoming even though it contains "paid"; anything else debiting us is a payment.
        if (!RECEIVED_BY_YOU.containsMatchIn(full) && OUR_ACCOUNT_DEBITED.containsMatchIn(full)) return null
        // Money from an SMS app must look like a bank credit alert, not a chat ("I sent you ₹500").
        if (sourcePackage != null && sourcePackage in TransactionParser.MESSAGING_PACKAGES &&
            !TransactionParser.looksLikeBankCreditSms(full)) return null

        if (LOAN.containsMatchIn(full)) return null
        val isRefund = REFUND.containsMatchIn(full)
        if (isRefund && FAILED_REVERSAL.containsMatchIn(full)) return null
        // A payment credited to a credit card is the bill being paid (a transfer), unless it's a refund.
        if (!isRefund && CARD_PAYMENT.containsMatchIn(full)) return null

        val amount = TransactionParser.extractAmount(full) ?: return null
        if (amount <= 0) return null

        val instrument = PaymentInstrumentClassifier.classify(body.ifBlank { full }, title, sourcePackage)
        val vpa = VPA.find(full)?.value
        val payer = extractPayer(body.ifBlank { full }) ?: vpa?.substringBefore('@')?.replace('.', ' ')
        val kind = when {
            isRefund -> null
            SALARY.containsMatchIn(full) -> Kind.SALARY
            INTEREST.containsMatchIn(full) -> Kind.INTEREST
            CASHBACK.containsMatchIn(full) -> Kind.CASHBACK
            DIVIDEND.containsMatchIn(full) -> Kind.DIVIDEND
            else -> Kind.RECEIVED
        }
        val ref = TransactionParser.extractReference(full)
        val method = when (instrument.method) {
            PaymentMethod.ATM, PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD ->
                if (isRefund) instrument.method else PaymentMethod.BANK_TRANSFER
            else -> instrument.method
        }

        return ParsedTransaction(
            amount = amount,
            currency = "INR",
            merchantRaw = payer ?: kind?.label,
            merchantVpa = vpa,
            paymentMethod = method,
            transactionType = if (isRefund) TransactionType.REFUND else TransactionType.INCOME,
            upiReference = ref,
            bankReference = ref,
            accountLast4 = instrument.last4,
            bankName = instrument.bank,
            dateTime = timestamp,
            source = if (sourcePackage != null) "NOTIFICATION" else "SMS",
            sourcePackage = sourcePackage,
            rawText = full,
            confidenceScore = 0.95f,
            incomeKind = kind?.name
        )
    }

    fun extractPayer(text: String): String? {
        for (p in PAYER_PATTERNS) {
            val name = p.find(text)?.groupValues?.get(1)?.trim()?.trimEnd('.', '-', ' ') ?: continue
            if (name.length >= 2 && !PAYER_STOP.containsMatchIn(name) && name.any { it.isLetter() }) return name
        }
        return null
    }
}
