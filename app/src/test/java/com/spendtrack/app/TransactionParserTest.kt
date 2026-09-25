package com.spendtrack.app

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
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

    @Test
    fun extractAmount_handlesVariousIndianFormats() {
        assertEquals(450.0, TransactionParser.extractAmount("Paid Rs 450 at Swiggy")!!, 0.01)
        assertEquals(1299.50, TransactionParser.extractAmount("Debited with Rs. 1,299.50")!!, 0.01)
        assertEquals(50000.0, TransactionParser.extractAmount("Spent INR 50,000 on purchase")!!, 0.01)
        assertEquals(40.0, TransactionParser.extractAmount("Paid ₹40 to Chaiwala")!!, 0.01)
    }

    @Test
    fun parse_iciciDebitNamingCreditedPayee_isExpense() {
        val title = "ICICIB"
        val text = "ICICI Bank Acct XX123 debited for Rs 500.00 on 12-Sep-26; SWIGGY credited. UPI:625412345678. Call 18002662 for dispute."
        val result = TransactionParser.parse(title, text)

        assertNotNull("Debits that name the credited payee must be recorded", result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(500.0, result.amount, 0.01)
        assertEquals("SWIGGY", result.merchantRaw)
    }

    @Test
    fun parse_cardSpendMentioningCreditLimit_isExpense() {
        val title = "KOTAKB"
        val text = "Rs.1,250.00 spent on Kotak Card x4321 at DMART on 12-Sep-26. Avl credit limit Rs.48,750.00"
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.EXPENSE, result!!.transactionType)
        assertEquals(1250.0, result.amount, 0.01)
    }

    @Test
    fun parse_sbiUpiDebitWithoutCurrencySymbol_isExpense() {
        val title = "SBIUPI"
        val text = "Dear UPI user A/C X1234 debited by 20.0 on date 12Sep26 trf to Swiggy Refno 625412345678. If not u? call 1800111109. -SBI"
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(20.0, result!!.amount, 0.01)
        assertEquals("Swiggy", result.merchantRaw)
    }

    @Test
    fun parse_moneyReceivedOnUpiApp_isIgnored() {
        val result = TransactionParser.parse("Rahul Sharma", "Rahul Sharma paid you ₹500", "com.google.android.apps.nbu.paisa.user")

        assertNull("Incoming UPI payments must not be recorded as expenses", result)
    }

    @Test
    fun parse_paymentRequest_isIgnored() {
        val result = TransactionParser.parse("PhonePe", "Rahul has requested ₹500 from you. Pay now", "com.phonepe.app")

        assertNull("Payment requests are not payments", result)
    }

    @Test
    fun shouldIgnore_plainCredit_isTrue() {
        assertTrue(TransactionParser.shouldIgnore("Your A/c XX1234 is credited with Rs 5,000"))
    }
}
