package com.spendtrack.app.core.utils

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs

/**
 * Currency utilities for Indian Rupee (INR) with paise precision (Long)
 * and correct Indian numbering system formatting (e.g. ₹1,50,000).
 */
object CurrencyUtils {

    fun rupeesToPaise(rupees: Double): Long {
        return Math.round(rupees * 100.0)
    }

    fun paiseToRupees(paise: Long): Double {
        return paise / 100.0
    }

    /**
     * Formats paise into Indian Rupee string with correct Indian digit grouping.
     * e.g. 15000000L -> "₹1,50,000" or "₹1,50,000.00"
     */
    fun formatPaise(paise: Long, showDecimals: Boolean = false): String {
        val isNegative = paise < 0
        val absPaise = abs(paise)
        val rupeesPart = absPaise / 100
        val paisePart = absPaise % 100

        val formattedRupees = formatIndianGrouping(rupeesPart)

        val result = if (showDecimals && paisePart > 0) {
            String.format(Locale.ROOT, "₹%s.%02d", formattedRupees, paisePart)
        } else {
            "₹$formattedRupees"
        }

        return if (isNegative) "-$result" else result
    }

    fun formatRupees(rupees: Double, showDecimals: Boolean = false): String {
        return formatPaise(rupeesToPaise(rupees), showDecimals)
    }

    /**
     * Indian numbering system grouping:
     * Last 3 digits, then groups of 2.
     * e.g. 1234567 -> "12,34,567"
     */
    private fun formatIndianGrouping(value: Long): String {
        val s = value.toString()
        if (s.length <= 3) return s

        val lastThree = s.substring(s.length - 3)
        val rest = s.substring(0, s.length - 3)

        val sb = StringBuilder()
        var count = 0
        for (i in rest.length - 1 downTo 0) {
            sb.append(rest[i])
            count++
            if (count % 2 == 0 && i > 0) {
                sb.append(',')
            }
        }
        val formattedRest = sb.reverse().toString()
        return "$formattedRest,$lastThree"
    }
}
