package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.TransactionType
import java.util.Locale
import java.util.regex.Pattern

object TransactionParser {

    // Regex for amounts: supports ₹, Rs, Rs., INR with optional commas and decimals.
    // The comma form needs at least one comma; otherwise "Rs 2250.00" would stop at "225".
    private const val AMOUNT_NUMBER = """([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])"""
    private val AMOUNT_REGEX = Regex(
        """(?i)(?:\bRs\.?|\bINR|₹)[\s  ]*$AMOUNT_NUMBER"""
    )
    private val AMOUNT_FALLBACK_REGEX = Regex(
        """(?i)\b(?:debited\s*(?:by|with|for)?|spent|paid)\s*(?:Rs\.?|INR|₹)?[\s  ]*$AMOUNT_NUMBER"""
    )

    // Regex for VPA (UPI ID)
    private val VPA_REGEX = Regex("""([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})""")

    // Regex for UPI Ref / UTR / RRN (10-14 digits, typically 12). Also ICICI's "UPI:664408525138" and SBI's "Refno 4123...".
    private val UPI_REF_REGEX = Regex(
        """(?i)(?:UPI\s*Ref(?:erence)?(?:\s*no\.?)?|UPI(?=\s*[:/])|UTR|RRN|Txn(?:\s*id)?|Ref(?:\s*no\.?)?)\s*[:#=/\-\s]?\s*([0-9a-zA-Z]*[0-9]{6}[0-9a-zA-Z]*)"""
    )

    // Regex for Account last 3-4 digits
    private val ACCOUNT_LAST4_REGEX = Regex(
        """(?i)(?:A/c|Acct|Account|Card)\s*(?:no\.?)?\s*[*xX]{0,8}(\d{3,4})"""
    )

    // Patterns for merchant extraction
    private val MERCHANT_PATTERNS = listOf(
        // ICICI: "Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited."
        Regex("""(?i);\s*([a-zA-Z][a-zA-Z0-9\s&.\-_']{1,40}?)\s+credited"""),
        Regex("""(?i)(?:paid\s*to|sent\s*to|transfer\s*to|to\s*VPA|to)\s+([a-zA-Z0-9\s&.\-_]+?)(?:\s+(?:on|via|using|ref|utr|through|from|for|dated|\.|$))"""),
        Regex("""(?i)(?:at|for|towards)\s+([a-zA-Z0-9\s&.\-_]+?)(?:\s+(?:on|via|using|ref|utr|from|\.|$))"""),
        Regex("""(?i)(?:Info[:\s/]+UPI/)([^/]+)""")
    )

    // Keywords signaling incoming / credit transactions (MUST IGNORE)
    private val CREDIT_KEYWORDS = listOf(
        "credited", "credit", "received", "salary", "cashback", "deposited", "added to account"
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

    // Money that hasn't actually left the account yet: scheduled/future mandate debits, autopay
    // reminders, payment or collect *requests* still awaiting approval, and the PIN/approval prompt
    // itself. These commonly contain the same "debited"/"paid"/"payment" words as a completed
    // transaction, so the debit-intent check alone cannot tell them apart -- only the tense/status
    // words below can. When in doubt here, the right call is to NOT record it: a missed real expense
    // is far less harmful than a phantom one that never happened.
    private val NOT_YET_COMPLETED_REGEX = Regex(
        """(?i)\b(?:will\s+be\s+(?:debited|deducted|charged|executed)|scheduled\s+(?:on|for)|due\s+on|upcoming\s+payment|payment\s+reminder|collect\s+request|payment\s+request|has\s+requested|requested\s+(?:a\s+payment\s+of|rs\.?|inr|₹)|awaiting\s+(?:your\s+)?approval|enter\s+(?:your\s+)?upi\s+pin|approve\s+(?:this\s+|the\s+)?(?:payment|transaction|request)|tap\s+to\s+pay)\b"""
    )

    /** True for scheduled/pending/requested payments that have not actually completed yet. */
    fun isNotYetCompleted(text: String): Boolean {
        val lower = text.lowercase(Locale.ROOT)
        return NOT_YET_COMPLETED_REGEX.containsMatchIn(text) || PENDING_KEYWORDS.any { lower.contains(it) }
    }

    // Ads and offers from payment apps (e.g. CRED's "roadside assistance at ₹1. tap to claim it now.")
    // and OTPs. These mention a rupee amount but no money moved.
    private val NON_TRANSACTION_REGEX = Regex(
        """(?i)\b(?:claim|unlock(?:ed)?|tap to|offer|deal|starting (?:from|at)|get it for|\d+\s*%\s*off|flat\s*(?:rs\.?|₹)?\s*\d+\s*off|win|won|reward|coupon|voucher|scratch|coins?|hurry|limited (?:time|period)|pre-approved|apply now|otp|one[- ]time password|verification code)\b"""
    )

    // Money actually leaving the account. Note "credited" can still appear in a debit SMS for the payee
    // ("...debited for Rs 90.00; Piyush Yadav credited"), so a strong outgoing verb wins over it.
    private val STRONG_DEBIT_REGEX = Regex("""(?i)\b(?:debited|spent|withdrawn|paid|sent)\b""")
    private val DEBIT_INTENT_REGEX = Regex(
        """(?i)\b(?:debited|spent|paid|sent|withdrawn|purchase|charged|transferred|payment\s+(?:of|to|successful|done)|txn\s+of|transaction\s+of)\b"""
    )

    // SMS apps whose notifications carry bank SMS. Read these when SMS permission is not granted.
    val MESSAGING_PACKAGES = setOf(
        "com.android.mms",                        // OnePlus / Oppo / Realme
        "com.oneplus.mms",
        "com.google.android.apps.messaging",      // Google Messages
        "com.samsung.android.messaging",          // Samsung
        "com.miui.smsextra",                      // Xiaomi
        "com.android.messaging",
        "com.truecaller"
    )
    // Only bank-shaped messages are taken from SMS apps, so a friend's "I paid Rs 500" text is never logged.
    private val BANK_SMS_SHAPE_REGEX = Regex(
        """(?i)(?:a/c|acct|account|card)[\s\S]*\b(?:debited|spent|withdrawn)\b|\b(?:debited|spent|withdrawn)\b[\s\S]*(?:a/c|acct|account|card)"""
    )

    fun looksLikeBankSms(text: String): Boolean = BANK_SMS_SHAPE_REGEX.containsMatchIn(text)

    /** True for ads, offers and OTPs that mention an amount but are not transactions. */
    fun isNonTransaction(text: String): Boolean = NON_TRANSACTION_REGEX.containsMatchIn(text)

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

        // 0. Ads, offers and OTPs -> DO NOT RECORD
        if (isNonTransaction(fullContent)) return null

        // 1. Check for Failed / Declined payments -> DO NOT RECORD
        for (failedKey in FAILED_KEYWORDS) {
            if (lowerContent.contains(failedKey)) {
                return null
            }
        }

        // 1.5. Scheduled/future debits, payment & collect requests, pending/processing status,
        // and PIN-approval prompts -> the money has not actually moved yet. DO NOT RECORD.
        if (isNotYetCompleted(fullContent)) {
            return null
        }

        // 2. Check for Refunds
        var isRefund = false
        for (refundKey in REFUND_KEYWORDS) {
            if (lowerContent.contains(refundKey)) {
                isRefund = true
                break
            }
        }

        // 3. Check for Credits / Income -> MUST BE IGNORED unless it's a refund
        if (!isRefund && !STRONG_DEBIT_REGEX.containsMatchIn(fullContent)) {
            // "credit card" is an instrument or bill payment, not incoming money!
            val contentWithoutCard = lowerContent.replace("credit card", "cc")
            for (creditKey in CREDIT_KEYWORDS) {
                if (contentWithoutCard.contains(creditKey)) {
                    return null
                }
            }
        }

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

        // 5. Must contain debit / payment / spent intent if not refund or transfer.
        // Whole words only ("sent" must not match "present"), and coming from a payment app is not enough on its own.
        val isDebitOrSpend = DEBIT_INTENT_REGEX.containsMatchIn(fullContent) ||
                isRefund ||
                isInternalTransfer

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

    private val BALANCE_BEFORE_REGEX = Regex("""(?i)\b(?:avl|avail(?:able)?|bal|balance|limit|outstanding|due)\b[^0-9]{0,12}$""")

    fun extractAmount(text: String): Double? {
        // Skip "Avl Bal Rs 25,000" / "Avl limit Rs 50,000" so the balance is never taken as the spend.
        val match = AMOUNT_REGEX.findAll(text).firstOrNull { m ->
            !BALANCE_BEFORE_REGEX.containsMatchIn(text.substring(maxOf(0, m.range.first - 25), m.range.first))
        } ?: AMOUNT_FALLBACK_REGEX.find(text)
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
