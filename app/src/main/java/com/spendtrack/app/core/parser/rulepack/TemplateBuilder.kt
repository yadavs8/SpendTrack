package com.spendtrack.app.core.parser.rulepack

/**
 * Builds a reusable regex from a sample message and the snippets the user marked in it
 * ("Teach This Format"). Digits and whitespace in the surrounding text are generalised so the
 * template still matches future messages with different dates, balances or references.
 */
object TemplateBuilder {

    data class Template(
        val regexPattern: String,
        val amountGroupIndex: Int,
        val merchantGroupIndex: Int,
        val refGroupIndex: Int?
    )

    private const val AMOUNT_GROUP = "([0-9,]+(?:\\.[0-9]{1,2})?)"
    private const val MERCHANT_GROUP = "(.+?)"
    private const val MERCHANT_GROUP_AT_END = "([^\\n]+)"
    private const val REF_GROUP = "([0-9A-Za-z]+)"

    // Literal text kept around the captures to anchor the match
    private const val CONTEXT_CHARS = 20

    private enum class Kind { AMOUNT, MERCHANT, REF }

    private data class Span(val kind: Kind, val start: Int, val end: Int)

    /** Returns null when a snippet isn't found in the message or the snippets overlap. */
    fun build(rawText: String, amount: String, merchant: String, ref: String? = null): Template? {
        val spans = mutableListOf<Span>()
        spans += findSpan(rawText, amount.trim(), Kind.AMOUNT) ?: return null
        spans += findSpan(rawText, merchant.trim(), Kind.MERCHANT) ?: return null
        if (!ref.isNullOrBlank()) {
            spans += findSpan(rawText, ref.trim(), Kind.REF) ?: return null
        }
        spans.sortBy { it.start }
        for (i in 1 until spans.size) {
            if (spans[i].start < spans[i - 1].end) return null
        }

        val sb = StringBuilder("(?i)")
        sb.append(generalize(rawText.substring((spans.first().start - CONTEXT_CHARS).coerceAtLeast(0), spans.first().start)))

        val groupIndex = mutableMapOf<Kind, Int>()
        spans.forEachIndexed { i, span ->
            groupIndex[span.kind] = i + 1
            val isLast = i == spans.lastIndex
            val following = if (isLast) {
                rawText.substring(span.end, (span.end + CONTEXT_CHARS).coerceAtMost(rawText.length))
            } else {
                rawText.substring(span.end, spans[i + 1].start)
            }
            sb.append(
                when (span.kind) {
                    Kind.AMOUNT -> AMOUNT_GROUP
                    Kind.REF -> REF_GROUP
                    // A lazy group needs text after it to stop at
                    Kind.MERCHANT -> if (following.isEmpty()) MERCHANT_GROUP_AT_END else MERCHANT_GROUP
                }
            )
            sb.append(generalize(following))
        }

        val template = Template(
            regexPattern = sb.toString(),
            amountGroupIndex = groupIndex.getValue(Kind.AMOUNT),
            merchantGroupIndex = groupIndex.getValue(Kind.MERCHANT),
            refGroupIndex = groupIndex[Kind.REF]
        )

        // The template must at least reproduce the example it was taught from
        val match = Regex(template.regexPattern).find(rawText) ?: return null
        val parsedAmount = match.groupValues[template.amountGroupIndex].replace(",", "").toDoubleOrNull()
        if (parsedAmount == null || parsedAmount <= 0) return null
        return template
    }

    private fun findSpan(text: String, snippet: String, kind: Kind): Span? {
        if (snippet.isEmpty()) return null
        val start = text.indexOf(snippet).takeIf { it >= 0 }
            ?: text.indexOf(snippet, ignoreCase = true).takeIf { it >= 0 }
            ?: return null
        return Span(kind, start, start + snippet.length)
    }

    /** Escapes literal text, turning digit runs into \d+ and whitespace runs into \s+. */
    private fun generalize(literal: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < literal.length) {
            val c = literal[i]
            when {
                c.isDigit() -> {
                    while (i < literal.length && literal[i].isDigit()) i++
                    sb.append("\\d+")
                    continue
                }
                c.isWhitespace() -> {
                    while (i < literal.length && literal[i].isWhitespace()) i++
                    sb.append("\\s+")
                    continue
                }
                c.isLetter() -> sb.append(c)
                // Backslash before a non-letter is always a literal escape in Java regex
                else -> sb.append('\\').append(c)
            }
            i++
        }
        return sb.toString()
    }
}
