package com.spendtrack.app

import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionFilter
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Messages that look like payments but are NOT money leaving the account must never be recorded,
 * while genuine debit alerts from banks and UPI apps must still be recorded.
 */
class FalsePositiveFilterTest {

    private val gpay = "com.google.android.apps.nbu.paisa.user"
    private val phonePe = "com.phonepe.app"
    private val paytm = "net.one97.paytm"

    // ---------- Must be ignored ----------

    @Test
    fun otp_isIgnored() {
        assertNull(TransactionParser.parse("VM-HDFCBK", "OTP for txn of Rs 2,499.00 at AMAZON on card XX1234 is 482913. Do not share it with anyone."))
        assertNull(TransactionParser.parse("AX-ICICIB", "123456 is your One Time Password to pay Rs 500 to Swiggy. Valid for 5 mins."))
    }

    @Test
    fun paymentRequest_isIgnored() {
        assertNull(TransactionParser.parse("Rahul requested ₹200", "Tap to pay", gpay))
        assertNull(TransactionParser.parse("Payment request", "Rahul has requested money ₹350 from you on Google Pay", gpay))
        assertNull(TransactionParser.parse("PhonePe", "You have a collect request of ₹999 from merchant@ybl", phonePe))
    }

    @Test
    fun billReminderAndDues_areIgnored() {
        assertNull(TransactionParser.parse("Airtel", "Your Airtel bill of ₹499 is due on 28-Sep. Pay now on Google Pay", gpay))
        assertNull(TransactionParser.parse("VM-HDFCBK", "Your HDFC Bank Credit Card statement: Total amount due Rs 12,450. Minimum amount due Rs 620. Due date 05-Oct."))
        assertNull(TransactionParser.parse("VM-SBIINB", "Rs 5,000 will be debited from your A/c XX1234 on 05-Oct towards SIP."))
        assertNull(TransactionParser.parse("JD-ICICIB", "Your EMI of Rs 3,200 is scheduled to be debited on 02-Oct."))
    }

    @Test
    fun offersAndCashbackPromos_areIgnored() {
        assertNull(TransactionParser.parse("PhonePe", "Get flat ₹100 cashback on your next payment above ₹500! Offer valid till Sunday", phonePe))
        assertNull(TransactionParser.parse("Paytm", "You won a scratch card worth up to ₹250. Pay using Paytm UPI to claim", paytm))
        assertNull(TransactionParser.parse("VM-AXISBK", "Pre-approved personal loan of Rs 5,00,000 for you! Apply now: https://axis.bk/xyz"))
        assertNull(TransactionParser.parse("Google Pay", "Pay ₹1 and get ₹50 off on your next recharge", gpay))
    }

    @Test
    fun failedAndPendingPayments_areIgnored() {
        assertNull(TransactionParser.parse("Google Pay", "Payment of ₹450 to Swiggy is pending. We'll update you shortly.", gpay))
        assertNull(TransactionParser.parse("PhonePe", "Transaction of ₹1,200 to Zomato was unsuccessful. Money will be refunded if debited.", phonePe))
        assertNull(TransactionParser.parse("VM-HDFCBK", "Txn of Rs 3,000 on card XX1234 declined due to insufficient balance."))
    }

    @Test
    fun incomingMoney_isIgnored() {
        assertNull(TransactionParser.parse("Rahul paid you ₹500", "Paid to you via Google Pay", gpay))
        assertNull(TransactionParser.parse("PhonePe", "Received ₹1,000 from Amit Kumar", phonePe))
        assertNull(TransactionParser.parse("Google Pay", "Priya sent you ₹250", gpay))
        assertNull(TransactionParser.parse("VM-SBIINB", "Dear Customer, Rs 25,000 transferred to your A/c XX1234 by NEFT from ACME PVT LTD."))
        assertNull(TransactionParser.parse("AD-KOTAKB", "Rs.2,000 credited to your A/c XX5678 on 25-09-26. UPI Ref 526812345678."))
    }

    @Test
    fun wordsContainingRs_areNotAmounts() {
        // "yours 50" / "hours 2" must not be read as "Rs 50" / "Rs 2"
        assertNull(TransactionParser.extractAmount("Thank you for being ours for 5 years"))
        assertNull(TransactionParser.parse("Paytm", "Your order is yours 50 minutes away. Payment mode: UPI", paytm))
    }

    @Test
    fun genericAppNotification_withoutDebit_isIgnored() {
        // Being posted by a UPI app is no longer enough - the text must prove money left the account
        assertNull(TransactionParser.parse("Google Pay", "Your balance is ₹12,450", gpay))
        assertNull(TransactionParser.parse("PhonePe", "Recharge your mobile with ₹299 plan", phonePe))
    }

    @Test
    fun personalSmsSender_isDetected() {
        assertTrue(TransactionFilter.isPersonalSmsSender("+919876543210"))
        assertTrue(TransactionFilter.isPersonalSmsSender("9876543210"))
        assertFalse(TransactionFilter.isPersonalSmsSender("VM-HDFCBK"))
        assertFalse(TransactionFilter.isPersonalSmsSender("JD-SBIUPI-S"))
    }

    // ---------- Must still be recorded ----------

    @Test
    fun realGpayDebit_isRecorded() {
        val r = TransactionParser.parse("₹450 paid to Swiggy", "Paid via UPI from HDFC Bank XX1234. UPI Ref No 526812345678", gpay)
        assertNotNull(r)
        assertEquals(TransactionType.EXPENSE, r!!.transactionType)
        assertEquals(450.0, r.amount, 0.01)
        assertEquals("526812345678", r.upiReference)
    }

    @Test
    fun realSbiUpiDebit_isRecorded() {
        val r = TransactionParser.parse(
            "VM-SBIUPI",
            "Dear UPI user A/C X1234 debited by 250.0 on date 25Sep26 trf to RAMESH KUMAR Refno 526812345678. If not u? call 1800111109. -SBI"
        )
        assertNotNull(r)
        assertEquals(250.0, r!!.amount, 0.01)
        assertEquals("526812345678", r.upiReference)
    }

    @Test
    fun realIciciDebit_withBeneficiaryCredited_isRecorded() {
        // "RAMESH credited" refers to the payee - this is still money leaving the user's account
        val r = TransactionParser.parse(
            "AX-ICICIT",
            "ICICI Bank Acct XX123 debited for Rs 500.00 on 25-Sep-26; RAMESH credited. UPI:526812345678. Call 18002662 for dispute."
        )
        assertNotNull(r)
        assertEquals(TransactionType.EXPENSE, r!!.transactionType)
        assertEquals(500.0, r.amount, 0.01)
    }

    @Test
    fun realHdfcCardSpend_withAvailableLimit_usesSpendAmount() {
        val r = TransactionParser.parse(
            "VM-HDFCBK",
            "Spent Rs.1,299.00 On HDFC Bank Card 1234 At AMAZON On 2026-09-25:10:15:22. Avl Lmt Rs.85,000. Not You? Call 18002586161"
        )
        assertNotNull(r)
        assertEquals(1299.0, r!!.amount, 0.01)
    }

    @Test
    fun balanceBeforeAmount_isSkipped() {
        assertEquals(500.0, TransactionParser.extractAmount("Avl Bal Rs 10,000.00. Rs 500 debited from A/c XX12")!!, 0.01)
    }

    @Test
    fun txnSuccessfulWord_isNotAReference() {
        // A word must never become the UPI reference, or unrelated payments get merged together
        val r = TransactionParser.parse("PhonePe", "Txn successful. Paid ₹120 to Chai Point", phonePe)
        assertNotNull(r)
        assertNull(r!!.upiReference)
    }

    @Test
    fun atmWithdrawal_isRecorded() {
        val r = TransactionParser.parse("VM-AXISBK", "Rs 2,000 withdrawn at ATM from A/c XX4321 on 25-09-26. Avl Bal Rs 8,000")
        assertNotNull(r)
        assertEquals(2000.0, r!!.amount, 0.01)
    }

    @Test
    fun merchantName_stopsAtSentenceBreak() {
        assertEquals("Swiggy", TransactionParser.parse("Google Pay", "₹450 paid to Swiggy. UPI Ref 526812345678", gpay)!!.merchantRaw)
        assertEquals("Chai Point", TransactionParser.parse("₹120 paid to Chai Point", "Paid via UPI", gpay)!!.merchantRaw)
        assertEquals("Amazon.in", TransactionParser.parse("Paytm", "Paid Rs 80 to Amazon.in successfully", paytm)!!.merchantRaw)
        assertEquals(
            "RAMESH KUMAR",
            TransactionParser.parse("JD-SBIUPI", "Dear UPI user A/C X1234 debited by 250.0 on date 25Sep26 trf to RAMESH KUMAR Refno 526812345678")!!.merchantRaw
        )
    }
}
