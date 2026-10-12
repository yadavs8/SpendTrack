package com.spendtrack.app

import com.spendtrack.app.core.automation.KnownPayees
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

class KnownPayeesTest {
    private val rules = KnownPayees.defaults()
    private fun at(day: Int): Long = Calendar.getInstance().apply { set(2026, Calendar.OCTOBER, day, 10, 0, 0) }.timeInMillis

    @Test fun niecePayeeIsFamily() {
        val r = KnownPayees.match("Priyanka Mehta", null, "Rs 5000 debited. Priyanka Mehta credited", 5000.0, at(1), rules)
        assertEquals("r-niece", r?.id); assertEquals("family", r?.scope)
    }

    @Test fun milkVendorIsFamily() {
        val r = KnownPayees.match("Jagroop Shoshri Chand", null, null, 2400.0, at(1), rules)
        assertEquals("family", r?.scope)
    }

    @Test fun licOnThe22ndIsInvestment() {
        val r = KnownPayees.match("LIC of India", null, null, 5000.0, at(22), rules)
        assertEquals("investment", r?.scope)
    }

    @Test fun licFarFromItsDayIsNotCaught() {
        assertNull(KnownPayees.match("LIC of India", null, null, 5000.0, at(9), rules))
    }

    @Test fun smallInsurancePremiumOn16thIsPersonal() {
        val r = KnownPayees.match("Star Health Insurance Premium", null, null, 1800.0, at(16), rules)
        assertEquals("personal", r?.scope)
    }

    @Test fun insuranceAboveTheCapIsNotCaught() {
        assertNull(KnownPayees.match("Star Health Insurance Premium", null, null, 9000.0, at(16), rules))
    }

    @Test fun ordinaryMerchantIsNotCaught() {
        assertNull(KnownPayees.match("Zomato", null, "Rs 450 debited", 450.0, at(5), rules))
    }
}
