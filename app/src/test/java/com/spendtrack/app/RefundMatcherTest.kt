package com.spendtrack.app

import com.spendtrack.app.core.automation.RefundMatcher
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RefundMatcherTest {

    private val day = 24L * 3600 * 1000
    private val now = 1_800_000_000_000L
    private fun c(id: String, amount: Double, text: String, daysAgo: Int = 5) =
        RefundMatcher.Candidate(id, amount, text, text, now - daysAgo * day)

    // The three Manali Airbnb card payments, a Myntra order, and unrelated spends.
    private val cands = listOf(
        c("a1", 18160.20, "✈️ Manali trip 20-28 november: Airbnb Payments Rs 18,160.20 spent on ICICI Bank Card XX1014 at Airbnb Payments"),
        c("a2", 13566.0, "✈️ Manali trip 20-28 november: Airbnb Payments Rs 13,566.00 spent on ICICI Bank Card XX1014 at Airbnb Payments"),
        c("a3", 21650.64, "✈️ Manali trip 20-28 november: Airbnb Payments", 6),
        c("m1", 2462.0, "👤 Myntra"),
        c("g1", 1390.0, "👤 Google Play")
    )

    @Test fun cancelledAirbnbBooking_fullRefund_matchesThatBooking() {
        val raw = "Refund of INR 13,566.00 from Airbnb Payments for your cancelled booking has been credited to your ICICI Bank Credit Card XX1014 on 20-Oct-26."
        assertTrue(RefundMatcher.isRealCredit(raw))
        val keys = RefundMatcher.keywords(RefundMatcher.refundFrom(raw, null), raw)
        assertEquals("a2", RefundMatcher.pick(cands, 13566.0, keys)?.key)
    }

    @Test fun partialAirbnbRefund_minusFees_takesTheSmallestBookingItFits() {
        val raw = "Refund of INR 12,000.00 from Airbnb Payments has been credited to your ICICI Bank Credit Card XX1014."
        val keys = RefundMatcher.keywords(RefundMatcher.refundFrom(raw, null), raw)
        assertEquals("a2", RefundMatcher.pick(cands, 12000.0, keys)?.key) // 13,566 is the smallest booking ≥ 12,000
    }

    @Test fun myntraReturn_quietCredit_matchesMyntra_notGooglePlay() {
        val raw = "Dear Customer, Acct XX602 is credited with Rs 1,200.00 on 20-Oct-26 from MYNTRA DESIGNS PVT LTD. UPI:665900001111-ICICI Bank."
        assertTrue(RefundMatcher.isRealCredit(raw))
        assertTrue(RefundMatcher.looksLikeBusiness("MYNTRA DESIGNS PVT LTD", raw))
        val keys = RefundMatcher.keywords(RefundMatcher.refundFrom(raw, null), raw)
        assertEquals("m1", RefundMatcher.pick(cands, 1200.0, keys)?.key)
    }

    @Test fun refundBiggerThanAnyPurchase_orUnknownMerchant_matchesNothing() {
        val raw = "Refund of Rs 5,000 from Myntra credited to your A/c XX602."
        assertNull(RefundMatcher.pick(cands, 5000.0, RefundMatcher.keywords(RefundMatcher.refundFrom(raw, null), raw)))
        val other = "Rs 300 credited to your A/c XX602 as refund from Some Shop."
        assertNull(RefundMatcher.pick(cands, 300.0, RefundMatcher.keywords(RefundMatcher.refundFrom(other, null), other)))
    }

    @Test fun refundInitiated_isNotMoneyBackYet() {
        assertFalse(RefundMatcher.isRealCredit("Your refund of Rs 2,462 for order 123 has been initiated and will be credited to your account within 5-7 working days. - Myntra"))
    }

    @Test fun moneyFromAPerson_isNotTreatedAsAShopRefund() {
        assertFalse(RefundMatcher.looksLikeBusiness("Rahul Sharma", "Acct XX602 is credited with Rs 500.00 from Rahul Sharma. UPI:66590000"))
    }

    @Test fun refundNote_accumulates_andStaysShort() {
        val once = RefundMatcher.withRefundNote("👤 Myntra", 1200.0)
        assertEquals("👤 Myntra (↩ ₹1,200 refunded)", once)
        assertEquals("👤 Myntra (↩ ₹1,700 refunded)", RefundMatcher.withRefundNote(once, 500.0))
        assertTrue(RefundMatcher.withRefundNote("✈️ Manali trip 20-28 november: Airbnb Payments", 12000.0).length <= 60)
    }

    @Test fun cancelledBookingRefundSms_isParsedAsRefund_notDroppedAsFailed() {
        val r = TransactionParser.parse("ICICIT", "Refund of INR 13,566.00 from Airbnb Payments for your cancelled booking has been credited to your ICICI Bank Credit Card XX1014 on 20-Oct-26.")
        assertNotNull(r)
        assertEquals(TransactionType.REFUND, r!!.transactionType)
        assertEquals(13566.0, r.amount, 0.001)
    }
}
