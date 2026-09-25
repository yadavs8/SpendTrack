package com.spendtrack.app

import com.spendtrack.app.core.utils.CurrencyUtils
import org.junit.Assert.assertEquals
import org.junit.Test

class CurrencyUtilsTest {

    @Test
    fun formatPaise_lakhsGrouping_formatsCorrectly() {
        assertEquals("₹1,50,000", CurrencyUtils.formatPaise(15000000L))
        assertEquals("₹10,00,000", CurrencyUtils.formatPaise(100000000L))
        assertEquals("₹1,00,00,000", CurrencyUtils.formatPaise(1000000000L))
        assertEquals("₹450", CurrencyUtils.formatPaise(45000L))
        assertEquals("₹20", CurrencyUtils.formatPaise(2000L))
    }

    @Test
    fun formatPaise_withDecimals_formatsAccurately() {
        assertEquals("₹1,299.50", CurrencyUtils.formatPaise(129950L, showDecimals = true))
        assertEquals("₹40.25", CurrencyUtils.formatPaise(4025L, showDecimals = true))
    }

    @Test
    fun rupeesToPaise_andBack_maintainsPrecision() {
        assertEquals(45000L, CurrencyUtils.rupeesToPaise(450.0))
        assertEquals(129999L, CurrencyUtils.rupeesToPaise(1299.99))
        assertEquals(1299.99, CurrencyUtils.paiseToRupees(129999L), 0.001)
    }
}
