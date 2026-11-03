package com.spendtrack.app.core.deduplication

import java.util.Locale

/**
 * Recognises the *same message* seen again, so one bank SMS or payment notification is read once.
 *
 * The same text reaches the app several times: the SMS itself and the Messages app's notification
 * of it, a notification re-posted when the app refreshes it or when the phone reconnects, a chat
 * notification re-sent with "2 new messages". Re-reading it is what kept re-asking about one payment.
 *
 * A repeat is recognised when the normalised text matches one seen in the last few days and either
 * the text carries a reference/account number (it can only be that one message), or it is the same
 * notification (same post time), or it came back within a few minutes. Two real ₹20 payments with
 * identical wording hours apart are still two payments.
 */
object MessageFingerprint {

    const val KEEP_FOR_MS = 3 * 24 * 60 * 60 * 1000L
    const val QUICK_REPEAT_MS = 3 * 60 * 1000L

    private val COUNTERS = Regex("""(?i)\(?\b\d+\s+(?:new\s+)?messages?\b\)?|\b\d+\s+more\b""")
    private val SPACES = Regex("""\s+""")
    private val STRONG_ID = Regex("""(?i)(?:\b(?:ref|utr|rrn|txn|upi|a/c|acct?|account|card)\b[^0-9]{0,12}[0-9xX*]{3,})|\d{8,}""")

    /** Text with whitespace, case and "(3 new messages)" style counters removed. */
    fun normalize(text: String?): String =
        COUNTERS.replace(text.orEmpty(), " ").lowercase(Locale.ROOT).replace(SPACES, " ").trim()

    fun keyOf(text: String?): String = normalize(text).hashCode().toString(16)

    /** True when the text names a reference or account number, so an identical copy is the same message. */
    fun hasStrongId(text: String?): Boolean = !text.isNullOrBlank() && STRONG_ID.containsMatchIn(text)

    data class Seen(val at: Long, val postedAt: Long)

    /**
     * Is a message with [text] (posted at [postedAt], seen [now]) a repeat of [previous]?
     */
    fun isRepeat(previous: Seen?, text: String?, postedAt: Long, now: Long): Boolean {
        if (previous == null) return false
        if (now - previous.at > KEEP_FOR_MS) return false
        if (previous.postedAt == postedAt) return true // the same notification re-posted
        if (hasStrongId(text)) return true
        return now - previous.at <= QUICK_REPEAT_MS
    }
}
