package com.spendtrack.app

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.parser.AmazonPayMail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AmazonPayMailTest {
    private val t = 1_794_200_000_000L

    @Test
    fun walletPurchase_isReadFromTheEmailNotification() {
        val p = AmazonPayMail.parse("Amazon Pay India", "Your payment of ₹ 318.0 to Blinkit. was successful Hi sanjeev, Your payment to Blinkit. was Approved", t)!!
        assertEquals(318.0, p.amount, 0.001)
        assertEquals("Blinkit (Amazon Pay)", p.merchantRaw)
        assertEquals(PaymentMethod.WALLET, p.paymentMethod)
        assertEquals(AmazonPayMail.GMAIL_PACKAGE, p.sourcePackage)
    }

    @Test
    fun payLaterOrder_isMarkedPayLater() {
        assertNull(AmazonPayMail.parse("Amazon Pay India", "Order successfully placed using Amazon Pay Later as payment mode. Hi sanjeev, Thank you for using Amazon Pay Later. Total Order Amount: Rs. 1819 Amount paid", t + 60_000))
        val p = AmazonPayMail.parse("Amazon Pay India", "Your payment of ₹ 1818.76 to Zomato APL was successful", t + 62_000)!!
        assertEquals(1818.76, p.amount, 0.001)
        assertEquals("Zomato (Amazon Pay Later)", p.merchantRaw)
    }

    @Test
    fun otherEmails_andDeclinedPayments_areIgnored() {
        assertNull(AmazonPayMail.parse("Rahul", "Lunch tomorrow? I paid Rs 500 for the cab", t))
        assertNull(AmazonPayMail.parse("Amazon Pay India", "Your payment to Blinkit. was declined", t))
        assertNull(AmazonPayMail.parse("Amazon Pay India", "₹148.00 added to your Amazon Pay Balance.", t))
    }
}
