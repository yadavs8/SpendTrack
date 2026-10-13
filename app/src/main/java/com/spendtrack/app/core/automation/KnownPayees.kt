package com.spendtrack.app.core.automation

import org.json.JSONArray
import java.util.Calendar

/**
 * Payments that happen every month and are always filed the same way: the niece allowance and the
 * milk vendor go to Family, the LIC premium to Investment, the insurance premium to Personal...
 *
 * The rules are the ones on Kharcha Book's Rules screen (shared setting `kharcha_rules`), so one
 * list serves both apps. Nothing there yet? [defaults] (the same list the web app starts with).
 */
object KnownPayees {

    data class Rule(
        val id: String,
        val name: String,
        val words: List<String>,
        val day: Int,          // day of the month it is paid (0 = no fixed day)
        val amount: Double,    // usual amount (0 = varies)
        val maxAmount: Double, // never more than this (0 = no cap)
        val strictDay: Boolean,// only counts near [day] (so a name that also appears in other messages is not caught)
        val scope: String      // personal | family | investment
    )

    fun defaults(): List<Rule> = listOf(
        Rule("r-emi", "Flat EMI", listOf("emi", "flat emi", "home loan"), 5, 0.0, 0.0, false, "personal"),
        Rule("r-niece", "Niece allowance", listOf("priyanka mehta", "priyanka", "bhabi"), 1, 5000.0, 0.0, false, "family"),
        Rule("r-milk", "Milk vendor", listOf("jagroop", "shoshri chand"), 1, 0.0, 0.0, false, "family"),
        Rule("r-kirana", "Lavish Kirana Store", listOf("lavish kirana", "lavish kirana store"), 0, 0.0, 0.0, false, "family"),
        Rule("r-lic", "LIC premium", listOf("lic", "lic of india", "life insurance corporation"), 22, 5000.0, 0.0, true, "investment"),
        Rule("r-insurance", "Insurance premium", listOf("insurance premium", "life insurance", "health insurance", "hdfc life", "icici pru", "max life", "star health", "bajaj allianz", "tata aia", "sbi life"), 16, 0.0, 2000.0, true, "personal")
    )

    /** Rules from the shared setting (a JSON array in a string); [defaults] when it is missing or unreadable. */
    fun parse(json: String?): List<Rule> {
        if (json.isNullOrBlank()) return defaults()
        return try {
            val arr = JSONArray(json)
            val out = ArrayList<Rule>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val name = o.optString("name").trim()
                if (name.isEmpty()) continue
                val wordsArr = o.optJSONArray("words")
                val words = ArrayList<String>()
                if (wordsArr != null) for (j in 0 until wordsArr.length()) {
                    val w = wordsArr.optString(j).lowercase().replace(Regex("\\s+"), " ").trim()
                    if (w.isNotEmpty()) words += w
                }
                val scope = o.optString("scope").takeIf { it == "family" || it == "investment" || it == "personal" } ?: "personal"
                out += Rule(
                    id = o.optString("id", name), name = name, words = words,
                    day = o.optInt("day", 0).takeIf { it in 1..31 } ?: 0,
                    amount = o.optDouble("amount", 0.0).takeIf { it > 0 } ?: 0.0,
                    maxAmount = o.optDouble("max", 0.0).takeIf { it > 0 } ?: 0.0,
                    strictDay = o.optBoolean("strict", false),
                    scope = scope
                )
            }
            out
        } catch (_: Exception) {
            defaults()
        }
    }

    private fun wordIn(text: String, word: String): Boolean =
        Regex("(^|[^a-z0-9])" + Regex.escape(word) + "([^a-z0-9]|$)").containsMatchIn(text)

    /** Is [dateTime] within [slack] days of day-of-month [day] (the end of a short month counts as the 31st)? */
    internal fun nearDay(dateTime: Long, day: Int, slack: Int): Boolean {
        val c = Calendar.getInstance().apply { timeInMillis = dateTime }
        val dim = c.getActualMaximum(Calendar.DAY_OF_MONTH)
        val d = c.get(Calendar.DAY_OF_MONTH)
        val target = minOf(day, dim)
        return kotlin.math.abs(d - target) <= slack
    }

    /**
     * The rule an outgoing payment belongs to, or null. A rule's words must appear in the payee name,
     * UPI id or the message; [Rule.maxAmount] caps the amount, and a [Rule.strictDay] rule also needs
     * the payment to fall within two days of its day of the month.
     */
    fun match(merchant: String?, vpa: String?, raw: String?, amount: Double, dateTime: Long, rules: List<Rule>): Rule? {
        val text = listOfNotNull(merchant, vpa, raw).joinToString(" ").lowercase().replace(Regex("\\s+"), " ")
        if (text.isBlank()) return null
        for (r in rules) {
            if (r.maxAmount > 0 && amount > r.maxAmount + 0.005) continue
            if (r.strictDay && r.day > 0 && !nearDay(dateTime, r.day, 2)) continue
            val keys = r.words + r.name.lowercase()
            if (keys.any { it.isNotBlank() && wordIn(text, it) }) return r
        }
        return null
    }
}
