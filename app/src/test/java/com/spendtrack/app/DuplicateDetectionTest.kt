package com.spendtrack.app

import com.spendtrack.app.core.deduplication.MessageFingerprint
import com.spendtrack.app.core.deduplication.SmartMatcher
import com.spendtrack.app.core.deduplication.SmartMatcher.Msg
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.IncomeParser
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DuplicateDetectionTest {

    private val t0 = 1_792_000_000_000L
    private val min = 60_000L
    private val hour = 60 * min
    private val gpay = "com.google.android.apps.nbu.paisa.user"
    private val messages = "com.google.android.apps.messaging"

    private fun same(a: Msg, b: Msg): Boolean = (SmartMatcher.score(a, b) ?: 0.0) >= SmartMatcher.SAME_PAYMENT
    private fun maybe(a: Msg, b: Msg): Boolean = (SmartMatcher.score(a, b) ?: 0.0) >= SmartMatcher.MAYBE_SAME

    // ---- The insurance premium that was saved three times ----

    private val bankDebit = Msg(
        amount = 12345.0, time = t0, merchant = "ICICI Lombard GIC",
        rawText = "AX-ICICIB Acct XX602 debited for Rs 12,345.00 on 14-Oct-26; ICICI LOMBARD GIC credited. UPI:664408525138",
        ref = "664408525138", last4 = "602", source = "NOTIFICATION", sourcePackage = messages
    )
    private val insurerReceipt = Msg(
        amount = 12345.0, time = t0 + 3 * hour, merchant = "Unknown Merchant",
        rawText = "ICICILM Thank you! We have received your premium of Rs 12,345.00 for policy 4012/7788/22. ICICI Lombard",
        source = "NOTIFICATION", sourcePackage = messages
    )
    private val dealerWhatsApp = Msg(
        amount = 12345.0, time = t0 + 26 * hour, merchant = "insurance",
        rawText = "Platinum Motocorp Dear customer, insurance payment of Rs 12,345 paid for policy 4012/7788/22. Thank you",
        source = "NOTIFICATION", sourcePackage = "com.whatsapp"
    )

    @Test
    fun insurerReceiptHoursLater_isTheSamePaymentAsTheBankDebit() {
        assertTrue(same(bankDebit, insurerReceipt))
    }

    @Test
    fun dealerMessageNextDay_withTheSamePolicyNumber_isTheSamePayment() {
        assertTrue(same(insurerReceipt, dealerWhatsApp))
    }

    // ---- One payment, two sources ----

    @Test
    fun bankSmsAndUpiAppNotification_minutesApart_areOnePayment() {
        val app = Msg(450.0, t0, merchant = "Raju Kumar", rawText = "Google Pay ₹450 paid to Raju Kumar", source = "NOTIFICATION", sourcePackage = gpay)
        val sms = Msg(450.0, t0 + 2 * min, merchant = "RAJU KUMAR", rawText = "HDFCBK Rs 450 debited from A/c XX1234 to RAJU KUMAR", last4 = "1234", source = "SMS")
        assertTrue(same(app, sms))
    }

    @Test
    fun sameReference_isAlwaysTheSamePayment() {
        val a = Msg(90.0, t0, ref = "123456789012", source = "SMS")
        val b = Msg(90.0, t0 + 2 * hour, ref = "123456789012", source = "NOTIFICATION", sourcePackage = gpay)
        assertEquals(1.0, SmartMatcher.score(a, b)!!, 0.0001)
    }

    // ---- Real separate payments must stay separate ----

    @Test
    fun twoChaiPaymentsToTheSameVendorHoursApart_areTwoPayments() {
        val a = Msg(20.0, t0, merchant = "Raju Tea Stall", rawText = "Google Pay ₹20 paid to Raju Tea Stall", source = "NOTIFICATION", sourcePackage = gpay)
        val b = a.copy(time = t0 + 4 * hour)
        assertFalse(maybe(a, b))
    }

    @Test
    fun samAmountToTwoDifferentFriends_areTwoPayments() {
        val a = Msg(500.0, t0, merchant = "Rahul Sharma", rawText = "Google Pay ₹500 paid to Rahul Sharma", source = "NOTIFICATION", sourcePackage = gpay)
        val b = Msg(500.0, t0 + hour, merchant = "Priya Verma", rawText = "Google Pay ₹500 paid to Priya Verma", source = "NOTIFICATION", sourcePackage = gpay)
        assertFalse(maybe(a, b))
    }

    @Test
    fun twoDifferentUpiReferences_areNeverMerged() {
        val a = Msg(90.0, t0, merchant = "Piyush", ref = "111111111111", source = "SMS")
        val b = Msg(90.0, t0 + min, merchant = "Piyush", ref = "222222222222", source = "NOTIFICATION", sourcePackage = gpay)
        assertNull(SmartMatcher.score(a, b))
    }

    @Test
    fun differentCards_differentAmounts_orFarApart_areNeverMatched() {
        val a = Msg(1000.0, t0, merchant = "Amazon", last4 = "1111")
        assertNull(SmartMatcher.score(a, a.copy(last4 = "2222")))
        assertNull(SmartMatcher.score(a, a.copy(amount = 1100.0, last4 = null)))
        assertNull(SmartMatcher.score(a, a.copy(time = t0 + 4 * 24 * hour, last4 = null)))
        assertNull(SmartMatcher.score(a, a.copy(incoming = true, last4 = null)))
    }

    @Test
    fun monthlySipNextMonth_isOutsideTheWindow() {
        val a = Msg(5000.0, t0, merchant = "Zerodha", rawText = "NACH Rs 5000 debited A/c XX12 Zerodha")
        assertNull(SmartMatcher.score(a, a.copy(time = t0 + 30L * 24 * hour)))
    }

    // ---- Same message seen twice ----

    @Test
    fun sameBankSmsSeenAgain_isARepeat() {
        val text = "Rs 450 debited from A/c XX1234 to RAJU on 14-Oct. UPI Ref 123456789012"
        val seen = MessageFingerprint.Seen(at = t0, postedAt = t0)
        assertTrue(MessageFingerprint.isRepeat(seen, text, postedAt = t0 + 5 * hour, now = t0 + 5 * hour))
        assertEquals(MessageFingerprint.keyOf(text), MessageFingerprint.keyOf("  $text (2 new messages)"))
    }

    @Test
    fun identicalWordingWithoutReference_hoursApart_isANewPayment() {
        val text = "₹20 paid to Raju Tea Stall"
        val seen = MessageFingerprint.Seen(at = t0, postedAt = t0)
        assertTrue(MessageFingerprint.isRepeat(seen, text, postedAt = t0, now = t0 + 2 * hour)) // same notification re-posted
        assertTrue(MessageFingerprint.isRepeat(seen, text, postedAt = t0 + min, now = t0 + min))
        assertFalse(MessageFingerprint.isRepeat(seen, text, postedAt = t0 + 3 * hour, now = t0 + 3 * hour))
        assertFalse(MessageFingerprint.isRepeat(null, text, postedAt = t0, now = t0))
    }

    // ---- Junk that used to become "₹0 at Unknown Merchant" ----

    @Test
    fun zeroRupeeMessage_isNotAnExpense() {
        assertNull(TransactionParser.parse("Platinum Motocorp", "Your invoice of Rs 0 has been paid. Thank you", "com.whatsapp"))
        assertNull(TransactionParser.parse("HDFCBK", "Rs 0.00 debited from A/c XX1234 to AMAZON"))
    }

    @Test
    fun whatsAppChats_areNotPayments_butWhatsAppPayIs() {
        assertFalse(TransactionParser.looksLikeWhatsAppPayment("Dear customer, insurance payment of Rs 4,500 received for your bike. Thank you, Platinum Motocorp"))
        assertFalse(TransactionParser.looksLikeWhatsAppPayment("I paid ₹500 for dinner, send your share"))
        assertFalse(TransactionParser.looksLikeWhatsAppPayment("Your payment of ₹0 is pending"))
        assertTrue(TransactionParser.looksLikeWhatsAppPayment("You paid ₹200 to Rahul Sharma"))
        assertTrue(TransactionParser.looksLikeWhatsAppPayment("₹150 sent to Priya"))
        assertTrue(TransactionParser.looksLikeWhatsAppPayment("Payment of ₹300 to Raju successful"))
        assertTrue(TransactionParser.looksLikeWhatsAppPayment("Rahul sent you ₹500"))
    }

    @Test
    fun insurerReceiptSms_isNotIncome() {
        assertNull(IncomeParser.parse("ICICILM", "We have received Rs 12,345 towards premium for policy 4012/7788. Thank you"))
        // A real bank credit still is.
        val credit = IncomeParser.parse("HDFCBK", "Rs 5,000 credited to your A/c XX1234 by RAHUL on 14-Oct. UPI Ref 123456789012")
        assertNotNull(credit)
        assertEquals(TransactionType.INCOME, credit!!.transactionType)
    }
}
