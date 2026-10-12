package com.spendtrack.app.core.automation

import org.json.JSONObject

/** The last 4 digits of the user's own bank accounts, from Kharcha Book's "My accounts and cards" (shared setting `kharcha_own`). */
object OwnAccounts {
    const val SHARED_KEY = "kharcha_own"

    /** Used until the user's own list has synced: their ICICI (3602) and HDFC (8749) accounts. */
    val DEFAULT_LAST4S: Set<String> = setOf("3602", "8749")

    /** Banks print 3 or 4 digits ("XX602" / "XX3602"); two numbers are the same account if one ends with the other. */
    fun sameAccount(a: String?, b: String?): Boolean {
        val x = a.orEmpty().filter { it.isDigit() }
        val y = b.orEmpty().filter { it.isDigit() }
        if (x.length < 3 || y.length < 3) return false
        return x.endsWith(y) || y.endsWith(x)
    }

    fun isOwn(last4: String?, own: Set<String>): Boolean = own.any { sameAccount(it, last4) }

    /** Bank account last-4s (cards are left out: a card bill payment is not an account-to-account move). */
    fun bankLast4s(json: String?): Set<String> {
        if (json.isNullOrBlank()) return DEFAULT_LAST4S
        return try {
            val banks = JSONObject(json).optJSONArray("banks") ?: return DEFAULT_LAST4S
            val out = HashSet<String>()
            for (i in 0 until banks.length()) {
                val d = banks.optJSONObject(i)?.optString("last4").orEmpty().filter { it.isDigit() }
                if (d.length >= 3) out += d.takeLast(4)
            }
            if (out.isEmpty()) DEFAULT_LAST4S else out
        } catch (_: Exception) {
            DEFAULT_LAST4S
        }
    }
}
