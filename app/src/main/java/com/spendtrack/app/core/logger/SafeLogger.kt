package com.spendtrack.app.core.logger

import android.util.Log

/**
 * Privacy-first logger.
 * Automatically redacts account numbers, VPA handles, phone numbers,
 * and sensitive message fragments before logging.
 */
object SafeLogger {
    private const val TAG = "SpendTrack"

    private val ACCOUNT_REGEX = Regex("""(?i)(?:a/c|acct|account|card)\s*(?:no\.?|num\.?)?\s*(?:ending\s*)?(?:in\s*)?([xX*]*\d{2,4})""")
    private val VPA_REGEX = Regex("""[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}""")
    private val PHONE_REGEX = Regex("""(?:\+91|91)?[6-9]\d{9}""")
    private val REF_REGEX = Regex("""(?i)(?:ref|rrn|utr|txn)(?:\s*(?:no\.?|id)?)?\s*[:=]?\s*([a-zA-Z0-9]{8,18})""")

    fun redact(input: String?): String {
        if (input.isNullOrBlank()) return ""
        var sanitized = input
        sanitized = VPA_REGEX.replace(sanitized) { match ->
            val vpa = match.value
            val atIdx = vpa.indexOf('@')
            if (atIdx > 2) {
                vpa.take(2) + "***" + vpa.substring(atIdx)
            } else {
                "***" + vpa.substring(atIdx)
            }
        }
        sanitized = PHONE_REGEX.replace(sanitized, "******XXXX")
        sanitized = REF_REGEX.replace(sanitized) { match ->
            val prefix = match.value.take(4)
            "$prefix***REDACTED"
        }
        sanitized = ACCOUNT_REGEX.replace(sanitized, "A/c **XXXX")
        return sanitized
    }

    fun d(message: String) {
        Log.d(TAG, redact(message))
    }

    fun i(message: String) {
        Log.i(TAG, redact(message))
    }

    fun w(message: String, throwable: Throwable? = null) {
        Log.w(TAG, redact(message), throwable)
    }

    fun e(message: String, throwable: Throwable? = null) {
        Log.e(TAG, redact(message), throwable)
    }
}
