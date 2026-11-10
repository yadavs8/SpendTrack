package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType

/**
 * v141: a purchase paid from the Amazon Pay balance or with Amazon Pay Later sends no bank SMS, so it was
 * never logged (Blinkit / Zomato orders). Amazon does email "Your payment of ₹ 318.0 to Blinkit. was
 * successful" the same second, and Gmail shows that as a notification: this reads it, so the purchase is
 * logged in real time. Only these Amazon Pay emails are read from Gmail; every other email is ignored.
 */
object AmazonPayMail {
    const val GMAIL_PACKAGE = "com.google.android.gm"

    private val PAID = Regex("""(?i)your payment of\s*(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)\s+to\s+(.{2,40}?)\.?\s+was successful""")
    private val PAY_LATER = Regex("""(?i)amazon pay later[\s\S]{0,120}?total order amount:?\s*(?:₹|rs\.?|inr)\s*([\d,]+)""")

    // The "paid with Pay Later" email comes a second before the payment email of the same order.
    @Volatile private var laterAmount = 0L
    @Volatile private var laterAt = 0L

    fun parse(title: String?, text: String?, timestamp: Long): ParsedTransaction? {
        val all = "${title.orEmpty()} ${text.orEmpty()}"
        if (!all.contains("amazon pay", ignoreCase = true) && !PAID.containsMatchIn(all)) return null
        PAY_LATER.find(all)?.let {
            laterAmount = it.groupValues[1].replace(",", "").toLongOrNull() ?: 0L
            laterAt = timestamp
        }
        val m = PAID.find(all) ?: return null
        val amount = m.groupValues[1].replace(",", "").toDoubleOrNull()?.takeIf { it > 0 } ?: return null
        val shop = cleanShop(m.groupValues[2])
        val payLater = laterAmount > 0 && Math.abs(timestamp - laterAt) <= 3 * 60_000L &&
            Math.abs(Math.round(amount) - laterAmount) <= 1
        return ParsedTransaction(
            amount = amount,
            merchantRaw = if (payLater) "$shop (Amazon Pay Later)" else "$shop (Amazon Pay)",
            paymentMethod = if (payLater) PaymentMethod.OTHER else PaymentMethod.WALLET,
            transactionType = TransactionType.EXPENSE,
            dateTime = timestamp,
            source = "NOTIFICATION",
            sourcePackage = GMAIL_PACKAGE,
            rawText = "Amazon Pay: ${m.value}",
            confidenceScore = 0.95f
        )
    }

    /** "Zomato APL" -> "Zomato", "Blinkit." -> "Blinkit". */
    fun cleanShop(raw: String): String =
        raw.trim().trimEnd('.').replace(Regex("""(?i)\s+(apl|pvt|private|ltd|limited|india)\b.*$"""), "").trim().ifBlank { "Amazon Pay" }
}
