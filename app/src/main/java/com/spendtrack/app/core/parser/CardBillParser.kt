package com.spendtrack.app.core.parser

import java.util.Calendar

/**
 * Credit card statements and bill payments, from bank SMS:
 *  - "Total Amt Due Rs 12,345 ... Payment Due Date 10-OCT-26" -> a bill to remind about
 *  - "Payment of Rs 12,345 received towards your Credit Card XX1234" -> that bill is paid
 * A statement is never an expense: the card swipes already were.
 */
object CardBillParser {

    data class Statement(val totalDue: Double, val minDue: Double?, val dueDate: Long, val last4: String?, val bank: String?)
    data class Payment(val amount: Double?, val last4: String?, val bank: String?)

    private val CARD = Regex("""(?i)\bcredit\s*card\b|\bcard\s*(?:ending|xx|\*|no\.?)|\bcard\s+\d{4}\b|\bsbi\s*card\b""")
    private val NUM = """([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)"""
    private val TOTAL_DUE = Regex("""(?i)\b(?:total\s*(?:amt\.?|amount)?\s*due|tad)\b\s*(?:of|is|:|-)?\s*(?:rs\.?|inr|₹)\s*$NUM""")
    private val MIN_DUE = Regex("""(?i)\bmin(?:imum)?\.?\s*(?:amt\.?|amount)?\s*due\b\s*(?:of|is|:|-)?\s*(?:rs\.?|inr|₹)\s*$NUM""")
    private val DUE_DATE = Regex("""(?i)\b(?:payment\s*due\s*date|due\s*date|due\s*(?:by|on)|payable\s*(?:by|on)|pay\s*by)\b\s*[:\-]?\s*(\d{1,2})[-/ ]?([A-Za-z]{3,9}|\d{1,2})[-/ ,]*(\d{2,4})""")
    private val PAYMENT_RECEIVED = Regex(
        """(?i)\b(?:payment|amount)\b[^;\n]{0,40}?\b(?:received|credited)\b[^;\n]{0,40}?\b(?:towards|to|on|in)\s+(?:your\s+)?[^;\n]{0,30}?\bcard\b|\bcredit\s*card\b[^;\n]{0,60}?\b(?:payment|amount)\b[^;\n]{0,30}?\b(?:received|credited)\b"""
    )
    private val MONTHS = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

    fun parseStatement(text: String, now: Long = System.currentTimeMillis()): Statement? {
        if (!CARD.containsMatchIn(text)) return null
        val total = TOTAL_DUE.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull() ?: return null
        if (total <= 0) return null
        val due = DUE_DATE.find(text)?.let { dateOf(it.groupValues[1], it.groupValues[2], it.groupValues[3]) } ?: return null
        if (due < now - 24L * 3600 * 1000) return null // already past
        val min = MIN_DUE.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()
        val inst = PaymentInstrumentClassifier.classify(text)
        return Statement(total, min, due, inst.last4, inst.bank)
    }

    fun parsePayment(text: String): Payment? {
        if (!PAYMENT_RECEIVED.containsMatchIn(text)) return null
        val inst = PaymentInstrumentClassifier.classify(text)
        return Payment(TransactionParser.extractAmount(text), inst.last4, inst.bank)
    }

    private fun dateOf(dayS: String, monS: String, yearS: String): Long? {
        val day = dayS.toIntOrNull() ?: return null
        val month = monS.toIntOrNull()?.minus(1) ?: MONTHS.indexOf(monS.take(3).lowercase()).takeIf { it >= 0 } ?: return null
        var year = yearS.toIntOrNull() ?: return null
        if (year < 100) year += 2000
        if (day !in 1..31 || month !in 0..11) return null
        return Calendar.getInstance().apply {
            clear(); set(year, month, day, 10, 0)
        }.takeIf { it.get(Calendar.DAY_OF_MONTH) == day }?.timeInMillis
    }
}
