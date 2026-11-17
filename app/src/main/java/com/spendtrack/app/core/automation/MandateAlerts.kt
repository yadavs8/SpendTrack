package com.spendtrack.app.core.automation

import android.content.Context
import com.spendtrack.app.core.parser.TransactionParser

/**
 * A payment the bank takes by itself (UPI AutoPay, card standing instruction, NACH/ACH/ECS) that FAILED.
 * The parser rightly logs nothing for it (no money moved), so without this it went unnoticed: the Anthropic
 * standing instruction failed on 21 Oct 2026 and nothing said so. Now it raises its own notification.
 */
object MandateAlerts {
    private val MANDATE = Regex("""(?i)standing\s+instruction|auto\s?pay|\bmandate\b|\bN?ACH\b|\bECS\b|auto[- ]?debit|\bSI\b""")
    private val FAILED = Regex("""(?i)could\s+not\s+be\s+(?:processed|completed)|not\s+(?:been\s+)?processed|\bfail(?:ed|ure)\b|\bdeclined\b|unsuccessful|insufficient|\bbounced\b|dishonou?red|\brejected\b""")
    private val PAYEE = listOf(
        Regex("""(?i)towards\s+(?:Merchant\s+)?(.+?)\s+(?:via|for|to\s+be|as\s+per|is\s+due|on\s+\w+\s+Bank)\b"""),
        Regex("""(?i)to\s+Merchant\s+(.+?),?\s+as\s+per"""),
        Regex("""(?i)\bN?ACH\s*D-\s*([A-Za-z][^-]*?)\s*(?:-|\.|$)""")
    )

    data class Failed(val payee: String, val amount: Double?)

    /** The failed mandate in this message, or null when it is not one. */
    fun failedMandate(text: String): Failed? {
        if (!MANDATE.containsMatchIn(text) || !FAILED.containsMatchIn(text)) return null
        val payee = PAYEE.firstNotNullOfOrNull { it.find(text)?.groupValues?.get(1)?.trim() }?.takeIf { it.isNotBlank() } ?: "An automatic payment"
        return Failed(payee, TransactionParser.extractAmount(text))
    }

    /** Posts "payment failed" for a failed mandate debit. True when it was one (so nothing else should be done with it). */
    fun notifyIfFailed(context: Context, text: String): Boolean {
        val f = failedMandate(text) ?: return false
        val amt = f.amount?.let { "₹" + String.format(java.util.Locale.ENGLISH, "%,.2f", it).removeSuffix(".00") } ?: "A payment"
        AutomationNotifier.post(
            context, 7300 + (f.payee.lowercase().hashCode() and 0x3FF),
            "❌ Automatic payment failed: ${f.payee}",
            "$amt did not go through. Check the card or account, or the service may stop.",
            "$amt to ${f.payee} did not go through, so nothing was logged as spending. Check the card or account balance, " +
                "or the service may stop. SpendTrack > More > AutoPay radar lists all your automatic payments."
        )
        return true
    }
}
