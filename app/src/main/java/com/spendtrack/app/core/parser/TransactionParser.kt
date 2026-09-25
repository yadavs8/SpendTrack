package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.TransactionType
import java.util.Locale
import java.util.regex.Pattern

object TransactionParser {

    // Regex for amounts: supports ₹, Rs, Rs., INR with optional commas and decimals.
    // The lookbehind stops "yours 5" / "hours 2" from being read as "Rs 5".
    private val AMOUNT_REGEX = Regex(
        """(?i)(?:(?<![a-z])(?:Rs\.?|INR)|₹)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])"""
    )
    private val AMOUNT_FALLBACK_REGEX = Regex(
        """(?i)\b(?:debited\s*(?:by|with|for)?|spent|paid)\s*(?:Rs\.?|INR|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])"""
    )

    // Amounts preceded by these words are balances / limits, not the transaction amount
    private val NON_TXN_AMOUNT_PREFIX = Regex(
        """(?i)(?:bal(?:ance)?|avl|avbl|available|limit|lmt|outstanding|due)[^0-9]{0,12}$"""
    )

    // Regex for VPA (UPI ID)
    private val VPA_REGEX = Regex("""([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})""")

    // Regex for UPI Ref / UTR / RRN (typically 12 digits). The reference must contain at least
    // 6 digits so words like "Txn successful" are never captured as a reference - a bogus shared
    // reference would make the deduplication engine merge unrelated payments together.
    private val UPI_REF_REGEX = Regex(
        """(?i)\b(?:UPI\s*Ref(?:erence)?(?:\s*no\.?)?|UPI|UTR(?:\s*no\.?)?|RRN|Txn(?:\s*id)?|Transaction\s*id|Ref(?:erence)?(?:\s*no\.?)?|Refno)\s*[:#=\-\s]?\s*(?=[0-9a-zA-Z]*[0-9]{6})([0-9a-zA-Z]{8,22})\b"""
    )

    // Regex for Account last 3-4 digits
    private val ACCOUNT_LAST4_REGEX = Regex(
        """(?i)(?:A/c|Acct|Account|Card)\s*(?:no\.?)?\s*[*xX]{0,8}(\d{3,4})"""
    )

    // Merchant name ends at a connector word, a sentence break ("Swiggy. UPI Ref...") or the end.
    // A dot followed by a letter ("Amazon.in") is part of the name.
    private const val MERCHANT_END =
        """(?=\s+(?:on|via|using|ref|refno|utr|rrn|txn|through|from|for|dated|is|was|has|successfully|successful)\b|\s*[,;:(\n]|\.(?:\s|$)|\s*$)"""

    // Patterns for merchant extraction
    private val MERCHANT_PATTERNS = listOf(
        Regex("""(?i)\b(?:paid\s*to|sent\s*to|transfer(?:red)?\s*to|trf\s*to|to\s*VPA|to)\s+([a-zA-Z0-9&@.\-_ ]+?)$MERCHANT_END"""),
        Regex("""(?i)\b(?:at|towards)\s+([a-zA-Z0-9&@.\-_ ]+?)$MERCHANT_END"""),
        Regex("""(?i)(?:Info[:\s/]+UPI/)([^/]+)"""),
        // ICICI style: "Acct XX123 debited for Rs 500.00 on 25-Sep-26; RAMESH credited."
        Regex("""(?i)[;.]\s*([a-zA-Z][a-zA-Z0-9&.\- ]{1,40}?)\s+credited\b""")
    )

    // Keywords signaling internal transfers
    private val TRANSFER_KEYWORDS = listOf(
        "transferred from a/c", "transferred to a/c", "self transfer", "internal transfer"
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
        // Newline keeps the title ("₹120 paid to Chai Point") from running into the body ("Paid via UPI")
        val fullContent = joinTitleAndText(title, text)
        if (fullContent.isBlank()) return null

        val lowerContent = fullContent.lowercase(Locale.ROOT)

        // 1. Reject OTPs, offers, reminders, requests, failed/pending payments and incoming money.
        //    Only messages proving money has already left the account get past this point.
        if (TransactionFilter.rejectionReason(fullContent) != null) {
            return null
        }

        // 2. Refunds are recorded (excluded from spend) so they can be matched to the original expense
        val isRefund = TransactionFilter.isRefund(fullContent)

        // 3. Internal transfers between the user's own accounts
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

        // 4. Prevent double counting: Card swipe is expense; card bill payment is internal transfer
        val isCardBillPayment = lowerContent.contains("credit card bill") ||
                lowerContent.contains("card bill") ||
                (sourcePackage == "com.dreamplug.androidapp" && lowerContent.contains("credit card")) ||
                lowerContent.contains("towards your credit card")
        if (isCardBillPayment) {
            isInternalTransfer = true
        }

        // 5. Extract Amount
        val amount = extractAmount(fullContent) ?: return null
        if (amount <= 0.0) return null

        // 6. Extract VPA (UPI ID)
        val vpa = extractVpa(fullContent)

        // 7. Extract Merchant Name
        val merchantRaw = extractMerchant(fullContent, vpa)

        // 8. Extract UPI / Bank Reference
        val upiRef = extractReference(fullContent)

        // 9. Extract Account last 4 digits
        val accountLast4 = extractAccountLast4(fullContent)

        // 10. Determine Payment Method
        val paymentMethod = when {
            vpa != null || lowerContent.contains("upi") || (sourcePackage != null && MONITORED_UPI_PACKAGES.contains(sourcePackage)) -> PaymentMethod.UPI
            lowerContent.contains("debit card") -> PaymentMethod.DEBIT_CARD
            lowerContent.contains("credit card") -> PaymentMethod.CREDIT_CARD
            lowerContent.contains("cash") -> PaymentMethod.CASH
            lowerContent.contains("neft") || lowerContent.contains("rtgs") || lowerContent.contains("imps") -> PaymentMethod.BANK_TRANSFER
            else -> PaymentMethod.UPI
        }

        // 11. Determine Transaction Type
        val txnType = when {
            isInternalTransfer -> TransactionType.INTERNAL_TRANSFER
            isRefund -> TransactionType.REFUND
            else -> TransactionType.EXPENSE
        }

        // 12. Confidence Score
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

    fun extractAmount(text: String): Double? {
        val candidates = AMOUNT_REGEX.findAll(text).toList()
        // Skip "Avl Bal Rs 10,000" / "Limit Rs 50,000" style amounts that precede the real one
        val match = candidates.firstOrNull { !isBalanceAmount(text, it.range.first) }
            ?: candidates.firstOrNull()
            ?: AMOUNT_FALLBACK_REGEX.find(text)
            ?: return null
        val amountStr = match.groupValues[1].replace(",", "").trim()
        return amountStr.toDoubleOrNull()
    }

    fun joinTitleAndText(title: String?, text: String?): String =
        listOfNotNull(title?.trim(), text?.trim()).filter { it.isNotEmpty() }.joinToString("\n")

    fun extractVpa(text: String): String? = VPA_REGEX.find(text)?.value

    fun extractReference(text: String): String? = UPI_REF_REGEX.find(text)?.groupValues?.get(1)

    fun extractAccountLast4(text: String): String? = ACCOUNT_LAST4_REGEX.find(text)?.groupValues?.get(1)

    private fun isBalanceAmount(text: String, amountStart: Int): Boolean {
        val prefix = text.substring((amountStart - 25).coerceAtLeast(0), amountStart)
        return NON_TXN_AMOUNT_PREFIX.containsMatchIn(prefix)
    }

    private fun extractMerchant(text: String, vpa: String?): String? {
        for (pattern in MERCHANT_PATTERNS) {
            val match = pattern.find(text)
            if (match != null) {
                val candidate = match.groupValues[1].trim()
                if (candidate.isNotBlank() && candidate.length > 1 && !candidate.equals("vpa", ignoreCase = true)) {
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
}
