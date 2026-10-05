package com.spendtrack.app

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionParserTest {

    @Test
    fun parse_upiDebitFromSwiggy_isExpense() {
        val title = "Google Pay"
        val text = "UPI transaction successful. Rs 450 paid to SWIGGY. Ref 123456789012."
        val result = TransactionParser.parse(title, text, "com.google.android.apps.nbu.paisa.user")

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(450.0, result.amount, 0.01)
        assertEquals(PaymentMethod.UPI, result.paymentMethod)
        assertEquals("123456789012", result.upiReference)
    }

    @Test
    fun parse_bankSmsDebitForAmazon_isExpense() {
        val title = "HDFCBK"
        val text = "Your A/c XX1234 is debited with Rs 1,299 for UPI transaction to AMAZON. UTR: 987654321012"
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(1299.0, result.amount, 0.01)
        assertEquals(PaymentMethod.UPI, result.paymentMethod)
        assertEquals("1234", result.accountLast4)
        assertEquals("987654321012", result.upiReference)
    }

    @Test
    fun parse_creditNotification_isIgnored() {
        val title = "SBI Bank"
        val text = "Your A/c XX1234 is credited with Rs 5,000 on 25-Sep-26 by UPI/xyz@upi/Ref 321654987."
        val result = TransactionParser.parse(title, text)

        // Strict requirement: Credits MUST be ignored!
        assertNull("Credits must not be recorded", result)
    }

    @Test
    fun parse_salaryCredit_isIgnored() {
        val title = "ICICI Bank"
        val text = "Salary credited. Rs 54,000 deposited in your A/c XX8989."
        val result = TransactionParser.parse(title, text)

        assertNull("Salary credit must be ignored", result)
    }

    @Test
    fun parse_cashbackReceived_isIgnored() {
        val title = "PhonePe"
        val text = "Cashback received! ₹50 credited to your wallet for payment to Swiggy."
        val result = TransactionParser.parse(title, text, "com.phonepe.app")

        assertNull("Cashback credited must be ignored", result)
    }

    @Test
    fun parse_refundFromMerchant_isRefundType() {
        val title = "Amazon Pay"
        val text = "Rs 500 refunded by AMAZON for order #402-1234. Refund credited to original source."
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.REFUND, result!!.transactionType)
        assertEquals(500.0, result.amount, 0.01)
    }

    @Test
    fun parse_internalTransferBetweenOwnAccounts_isInternalTransfer() {
        val title = "Bank Alert"
        val text = "Rs 20,000 transferred from A/c XX1234 to A/c XX5678 on 25-Sep."
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.INTERNAL_TRANSFER, result!!.transactionType)
        assertEquals(20000.0, result.amount, 0.01)
    }

    @Test
    fun parse_failedOrDeclinedTransaction_isIgnored() {
        val title = "Google Pay"
        val text = "Payment failed! ₹240 to Uber could not be completed. Your bank declined the transaction."
        val result = TransactionParser.parse(title, text, "com.google.android.apps.nbu.paisa.user")

        assertNull("Failed transactions must be ignored", result)
    }

    @Test
    fun parse_phonePeDebit_extractsCorrectly() {
        val title = "PhonePe"
        val text = "Paid ₹245 to Uber India from State Bank of India A/c 5678. Txn ID: T26092512345."
        val result = TransactionParser.parse(title, text, "com.phonepe.app")

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(245.0, result.amount, 0.01)
        assertEquals(PaymentMethod.UPI, result.paymentMethod)
        assertEquals("5678", result.accountLast4)
    }

    @Test
    fun parse_creditCardDebit_isExpense() {
        val title = "Axis Bank"
        val text = "Spent Rs. 649.00 on your Credit Card XX9999 at NETFLIX on 25-Sep-26."
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(649.0, result.amount, 0.01)
        assertEquals(PaymentMethod.CREDIT_CARD, result.paymentMethod)
        assertEquals("9999", result.accountLast4)
    }

    // Real ICICI SMS: the payee is "credited", but it is our debit.
    @Test
    fun parse_iciciUpiDebitWithPayeeCredited_isExpense() {
        val text = "ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited. UPI:664408525138. Call 18002662 for dispute. SMS BLOCK 602 to 9215676766."
        val result = TransactionParser.parse("ICICI Bank", text, "com.android.mms")

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(90.0, result.amount, 0.01)
        assertEquals("602", result.accountLast4)
        assertEquals("664408525138", result.upiReference)
        assertEquals("Piyush Yadav", result.merchantRaw)
    }

    @Test
    fun parse_fourDigitAmountWithoutComma_isNotTruncated() {
        val text = "ICICI Bank Acct XX602 debited for Rs 2250.00 on 05-Oct-26; MAMTA KASYAP credited. UPI:664413510229."
        val result = TransactionParser.parse("ICICI Bank", text)

        assertNotNull(result)
        assertEquals(2250.0, result!!.amount, 0.01)
    }

    // Real CRED ad that was logged as a ₹1 expense.
    @Test
    fun parse_paymentAppPromo_isIgnored() {
        val result = TransactionParser.parse(
            "leaving in 6 hours: The Coin Rush",
            "unlocked for Sanjeev: roadside assistance at ₹1. tap to claim it now.",
            "com.dreamplug.androidapp"
        )
        assertNull("Ads from payment apps must not become expenses", result)
        assertNull(TransactionParser.parse("Myntra", "Get it for ₹998", "net.one97.paytm"))
    }

    @Test
    fun parse_balanceBeforeAmount_usesDebitAmount() {
        val result = TransactionParser.parse("HDFCBK", "Avl Bal Rs 25,000.00. Rs 300 debited from a/c XX1234 to zepto@ybl")
        assertNotNull(result)
        assertEquals(300.0, result!!.amount, 0.01)
    }

    @Test
    fun looksLikeBankSms_rejectsChatsThatMentionPaying() {
        assertTrue(TransactionParser.looksLikeBankSms("ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26"))
        assertFalse(TransactionParser.looksLikeBankSms("Bhai I paid Rs 500 for the tickets, send me your share"))
    }

    @Test
    fun extractAmount_handlesVariousIndianFormats() {
        assertEquals(450.0, TransactionParser.extractAmount("Paid Rs 450 at Swiggy")!!, 0.01)
        assertEquals(1299.50, TransactionParser.extractAmount("Debited with Rs. 1,299.50")!!, 0.01)
        assertEquals(50000.0, TransactionParser.extractAmount("Spent INR 50,000 on purchase")!!, 0.01)
        assertEquals(40.0, TransactionParser.extractAmount("Paid ₹40 to Chaiwala")!!, 0.01)
        assertEquals(1299.0, TransactionParser.extractAmount("Rs 1299 debited")!!, 0.01)
        assertEquals(90.0, TransactionParser.extractAmount("Paid ₹ 90 to Rahul")!!, 0.01)
    }
}
