package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.TransactionType
import java.util.Locale
import java.util.regex.Pattern

object TransactionParser {

    // Regex for amounts: supports ₹, Rs, Rs., INR with optional commas and decimals
    private val AMOUNT_REGEX = Regex(
        // Lookbehind stops the case-insensitive "rs" inside words ("Orders 2") being read as a currency
        """(?i)(?<![a-z])(?:Rs\.?|INR|₹)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)"""
    )
    private val AMOUNT_FALLBACK_REGEX = Regex(
        """(?i)(?:debited\s*(?:by|with)?|spent|paid)\s*(?:Rs\.?|INR|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)"""
    )

    // Regex for VPA (UPI ID)
    private val VPA_REGEX = Regex("""([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})""")

    // Regex for UPI Ref / UTR / RRN (10-14 digits, typically 12)
    private val UPI_REF_REGEX = Regex(
        """(?i)(?:UPI\s*Ref(?:erence)?(?:\s*no\.?)?|UTR|RRN|Txn(?:\s*id)?|Ref)\s*[:#=\-\s]?\s*([0-9a-zA-Z]{8,16})"""
    )

    // Regex for Account last 3-4 digits
    private val ACCOUNT_LAST4_REGEX = Regex(
        """(?i)(?:A/c|Acct|Account|Card)\s*(?:no\.?)?\s*[*xX]{0,8}(\d{3,4})"""
    )

    // Patterns for merchant extraction
    private val MERCHANT_PATTERNS = listOf(
        // ICICI style: "Acct XX123 debited for Rs 500.00 on 12-Sep-24; SWIGGY credited."
        Regex("""(?i);\s*([a-zA-Z0-9\s&.\-_]+?)\s+credited"""),
        Regex("""(?i)(?:paid\s*to|sent\s*to|transfer\s*to|to\s*VPA|to)\s+([a-zA-Z0-9\s&.\-_]+?)(?:\s+(?:on|via|using|ref|utr|through|from|for|dated|\.|$))"""),
        Regex("""(?i)(?:at|for|towards)\s+([a-zA-Z0-9\s&.\-_]+?)(?:\s+(?:on|via|using|ref|utr|from|\.|$))"""),
        Regex("""(?i)(?:Info[:\s/]+UPI/)([^/]+)""")
    )

    // Keywords signaling incoming / credit transactions (MUST IGNORE)
    private val CREDIT_KEYWORDS = listOf(
        "credited", "credit", "received", "salary", "cashback", "deposited", "added to account",
        "paid you", "sent you"
    )

    // "credit"/"credited" also appear in genuine debit alerts ("...; SWIGGY credited",
    // "Avl credit limit"), so they are ignored only when there is no explicit debit wording.
    private val WEAK_CREDIT_KEYWORDS = setOf("credited", "credit")
    private val EXPLICIT_DEBIT_KEYWORDS = listOf("debited", "spent", "withdrawn")

    // Payment requests and reminders mention an amount but no money has moved yet
    private val REQUEST_KEYWORDS = listOf(
        "requested", "request from", "collect request", "payment request"
    )

    // Keywords signaling refunds
    private val REFUND_KEYWORDS = listOf(
        "refund", "refunded", "reversed", "reversal"
    )

    // Keywords signaling internal transfers
    private val TRANSFER_KEYWORDS = listOf(
        "transferred from a/c", "transferred to a/c", "self transfer", "internal transfer"
    )

    // Keywords signaling failed/pending payments
    private val FAILED_KEYWORDS = listOf(
        "failed", "declined", "cancelled", "canceled", "rejected"
    )
    private val PENDING_KEYWORDS = listOf(
        "pending", "in progress", "processing"
    )

    // Supported UPI package names
    val MONITORED_UPI_PACKAGES = setOf(
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",                       // PhonePe
        "net.one97.paytm",                       // Paytm
        "in.org.npci.upiapp",                    // BHIM
        "com.dreamplug.androidapp",               // CRED
        "com.naviapp",                           // Navi
        "in.amazon.mShop.android.shopping"       // Amazon Pay
    )

    fun parse(
        title: String?,
        text: String?,
        sourcePackage: String? = null,
        timestamp: Long = System.currentTimeMillis()
    ): ParsedTransaction? {
        val fullContent = "${title ?: ""} ${text ?: ""}".trim()
        if (fullContent.isBlank()) return null

        val lowerContent = fullContent.lowercase(Locale.ROOT)

        // 1-3. Failed payments, payment requests and incoming money are never recorded
        if (shouldIgnore(fullContent)) return null

        val isRefund = isRefund(fullContent)

        // 4. Check for Internal Transfers & Credit Card Bill Payments
        var isInternalTransfer = false
        for (transferKey in TRANSFER_KEYWORDS) {
            if (lowerContent.contains(transferKey)) {
                val matches = ACCOUNT_LAST4_REGEX.findAll(fullContent).toList()
                if (matches.size >= 2) {
                    isInternalTransfer = true
                    break
                }
            }
        }

        // Prevent double counting: Card swipe is expense; card bill payment is internal transfer
        val isCardBillPayment = lowerContent.contains("credit card bill") ||
                lowerContent.contains("card bill") ||
                (sourcePackage == "com.dreamplug.androidapp" && lowerContent.contains("credit card")) ||
                lowerContent.contains("towards your credit card")
        if (isCardBillPayment) {
            isInternalTransfer = true
        }

        // 5. Must contain debit / payment / spent intent if not refund or transfer
        val isDebitOrSpend = lowerContent.contains("debited") ||
                lowerContent.contains("paid") ||
                lowerContent.contains("payment") ||
                lowerContent.contains("spent") ||
                lowerContent.contains("sent") ||
                lowerContent.contains("purchase") ||
                lowerContent.contains("txn") ||
                lowerContent.contains("transaction") ||
                isRefund ||
                isInternalTransfer ||
                (sourcePackage != null && MONITORED_UPI_PACKAGES.contains(sourcePackage))

        if (!isDebitOrSpend) {
            return null
        }

        // 6. Extract Amount
        val amount = extractAmount(fullContent) ?: return null

        // 7. Extract VPA (UPI ID)
        val vpa = VPA_REGEX.find(fullContent)?.value

        // 8. Extract Merchant Name
        val merchantRaw = extractMerchant(fullContent, vpa)

        // 9. Extract UPI / Bank Reference
        val upiRef = UPI_REF_REGEX.find(fullContent)?.groupValues?.get(1)

        // 10. Extract Account last 4 digits
        val accountLast4 = ACCOUNT_LAST4_REGEX.find(fullContent)?.groupValues?.get(1)

        // 11. Determine Payment Method
        val paymentMethod = when {
            vpa != null || lowerContent.contains("upi") || (sourcePackage != null && MONITORED_UPI_PACKAGES.contains(sourcePackage)) -> PaymentMethod.UPI
            lowerContent.contains("debit card") -> PaymentMethod.DEBIT_CARD
            lowerContent.contains("credit card") -> PaymentMethod.CREDIT_CARD
            lowerContent.contains("cash") -> PaymentMethod.CASH
            lowerContent.contains("neft") || lowerContent.contains("rtgs") || lowerContent.contains("imps") -> PaymentMethod.BANK_TRANSFER
            else -> PaymentMethod.UPI
        }

        // 12. Determine Transaction Type
        val txnType = when {
            isInternalTransfer -> TransactionType.INTERNAL_TRANSFER
            isRefund -> TransactionType.REFUND
            else -> TransactionType.EXPENSE
        }

        // 13. Confidence Score
        var confidence = 0.70f
        if (amount > 0) confidence += 0.10f
        if (!merchantRaw.isNullOrBlank() || vpa != null) confidence += 0.10f
        if (upiRef != null) confidence += 0.05f
        if (sourcePackage != null && MONITORED_UPI_PACKAGES.contains(sourcePackage)) confidence += 0.05f
        confidence = confidence.coerceAtMost(1.0f)

        return ParsedTransaction(
            amount = amount,
            currency = "INR",
            merchantRaw = merchantRaw,
            merchantVpa = vpa,
            paymentMethod = paymentMethod,
            transactionType = txnType,
            upiReference = upiRef,
            bankReference = upiRef,
            accountLast4 = accountLast4,
            dateTime = timestamp,
            source = if (sourcePackage != null) "NOTIFICATION" else "SMS",
            sourcePackage = sourcePackage,
            rawText = fullContent,
            confidenceScore = confidence
        )
    }

    /** Refund / reversal wording. */
    fun isRefund(content: String): Boolean {
        val lower = content.lowercase(Locale.ROOT)
        return REFUND_KEYWORDS.any { lower.contains(it) }
    }

    /**
     * True for messages that must never become a transaction: failed/declined payments,
     * payment requests, and incoming money (unless it is a refund, which is tracked separately).
     */
    fun shouldIgnore(content: String): Boolean {
        val lower = content.lowercase(Locale.ROOT)

        if (FAILED_KEYWORDS.any { lower.contains(it) }) return true
        if (REQUEST_KEYWORDS.any { lower.contains(it) }) return true
        if (isRefund(content)) return false

        // "credit card" is an instrument or bill payment, not incoming money!
        val contentWithoutCard = lower.replace("credit card", "cc")
        val hasExplicitDebit = EXPLICIT_DEBIT_KEYWORDS.any { contentWithoutCard.contains(it) }
        return CREDIT_KEYWORDS.any { key ->
            contentWithoutCard.contains(key) && !(hasExplicitDebit && key in WEAK_CREDIT_KEYWORDS)
        }
    }

    fun extractAmount(text: String): Double? {
        val match = AMOUNT_REGEX.find(text) ?: AMOUNT_FALLBACK_REGEX.find(text)
        if (match != null) {
            val amountStr = match.groupValues[1].replace(",", "").trim()
            return amountStr.toDoubleOrNull()
        }
        return null
    }

    private fun extractMerchant(text: String, vpa: String?): String? {
        for (pattern in MERCHANT_PATTERNS) {
            val match = pattern.find(text)
            if (match != null) {
                val candidate = match.groupValues[1].trim()
                if (candidate.length > 1 && !candidate.equals("vpa", ignoreCase = true) && !looksLikeAmount(candidate)) {
                    return candidate
                }
            }
        }

        // If no merchant found from text, fall back to VPA username if available
        if (vpa != null) {
            return vpa.substringBefore('@').replace(".", " ")
        }

        return null
    }

    // Rejects captures like "Rs 500.00" from "debited for Rs 500.00 on ..."
    private fun looksLikeAmount(candidate: String): Boolean =
        !candidate.any { it.isLetter() } ||
            Regex("""(?i)^(?:rs\.?|inr)\s*[0-9]""").containsMatchIn(candidate)
}
