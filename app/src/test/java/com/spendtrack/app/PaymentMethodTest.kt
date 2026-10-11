package com.spendtrack.app

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.PaymentInstrumentClassifier
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/** Credit card, debit card, UPI, ATM, net banking and wallet payments are told apart. */
class PaymentMethodTest {

    private fun parse(sender: String, text: String, pkg: String? = null) =
        TransactionParser.parse(sender, text, pkg).also { assertNotNull("should parse: $text", it) }!!

    // ---- credit cards ----

    @Test fun hdfcCreditCard_bareCardWording() {
        val r = parse("HDFCBK", "Spent Rs.1,499.00 On HDFC Bank Card 4321 At AMAZON On 2026-10-05:14:22:10. Not You? To Block+Reissue Call 18002586161")
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals("4321", r.accountLast4)
        assertEquals("HDFC", r.bankName)
        assertEquals(1499.0, r.amount, 0.01)
        assertEquals(TransactionType.EXPENSE, r.transactionType)
    }

    @Test fun iciciCreditCard_availableLimit() {
        val r = parse("ICICIT", "INR 2,500.00 spent using ICICI Bank Card XX9999 on 01-Oct-26 on DMART. Avl Limit: INR 47,500.00. If not you, call 1800 2662/SMS BLOCK 9999 to 9215676766")
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals("9999", r.accountLast4)
        assertEquals(2500.0, r.amount, 0.01)
    }

    @Test fun iciciCreditCard_usedForTransaction() {
        val r = parse("ICICIT", "ICICI Bank Credit Card XX1234 has been used for a transaction of INR 499.00 on 05-Oct-26 at SWIGGY. Avl Limit: INR 98,501.00.")
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals("1234", r.accountLast4)
        assertEquals(499.0, r.amount, 0.01)
    }

    @Test fun sbiCard() {
        val r = parse("SBICRD", "Rs.799.00 spent on your SBI Credit Card ending 5678 at FLIPKART on 04/10/26. Trxn not done by you? Report at https://sbicard.com/Dispute")
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals("5678", r.accountLast4)
        assertEquals("SBI Card", r.bankName)
    }

    @Test fun rupayCreditCardOverUpi_isStillCreditCard() {
        val r = parse("HDFCBK", "Rs 250.00 debited from HDFC Bank RuPay Credit Card XX4321 to VPA chaiwala@ybl via UPI on 05-10-26. UPI Ref 528812345678")
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals("4321", r.accountLast4)
    }

    // ---- debit cards ----

    @Test fun hdfcDebitCard() {
        val r = parse("HDFCBK", "Rs.640.00 spent on HDFC Bank Debit Card xx7788 at BIG BAZAAR on 03-10-26. Avl bal: Rs 12,300.00")
        assertEquals(PaymentMethod.DEBIT_CARD, r.paymentMethod)
        assertEquals("7788", r.accountLast4)
    }

    @Test fun posDebitFromAccount() {
        val r = parse("SBIINB", "Your A/C XXXXX1234 Debited INR 1,250.00 on 05/10/26 -POS at RELIANCE SMART. Avl Balance INR 23,450.00")
        assertEquals(PaymentMethod.DEBIT_CARD, r.paymentMethod)
    }

    @Test fun cardWithAccountBalance_isDebitCard() {
        val r = parse("AXISBK", "INR 300.00 spent on Axis Bank Card no. XX4455 at UBER on 05-10-26. A/c Avl Bal INR 8,000.")
        assertEquals(PaymentMethod.DEBIT_CARD, r.paymentMethod)
        assertEquals("4455", r.accountLast4)
    }

    // ---- UPI ----

    @Test fun upiFromAccount() {
        val r = parse("ICICIT", "ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited. UPI:664408525138.")
        assertEquals(PaymentMethod.UPI, r.paymentMethod)
        assertEquals("602", r.accountLast4)
        assertEquals("ICICI", r.bankName)
    }

    @Test fun upiApp() {
        val r = parse("PhonePe", "Paid ₹245 to Uber India from State Bank of India A/c 5678. Txn ID: T26092512345.", "com.phonepe.app")
        assertEquals(PaymentMethod.UPI, r.paymentMethod)
    }

    // ---- ATM, net banking ----

    @Test fun atmWithdrawal_isCashWithdrawal_notExpense() {
        val r = parse("HDFCBK", "Rs.5000.00 withdrawn at ATM HDFC0001234 from A/c XX1234 on 05-10-26. Avl Bal Rs 20,000.")
        assertEquals(PaymentMethod.ATM, r.paymentMethod)
        assertEquals(TransactionType.CASH_WITHDRAWAL, r.transactionType)
        assertEquals(5000.0, r.amount, 0.01)
        assertEquals("ATM cash", r.merchantRaw)
    }

    @Test fun sbiAtmCashWdl() {
        val r = parse("SBIINB", "Dear Customer, Your A/c no. XX1234 is debited by Rs.2000.00 on 05Oct26 for ATM WDL at SBI KOTHRUD. Avl bal Rs 9,000.")
        assertEquals(TransactionType.CASH_WITHDRAWAL, r.transactionType)
    }

    @Test fun atmCumDebitCardPurchase_isNotWithdrawal() {
        val r = parse("PNBSMS", "Rs 450 spent using your ATM cum Debit Card XX9090 at MEDPLUS on 05-10-26.")
        assertEquals(PaymentMethod.DEBIT_CARD, r.paymentMethod)
        assertEquals(TransactionType.EXPENSE, r.transactionType)
    }

    @Test fun neftDebit_isNetBanking() {
        val r = parse("KOTAKB", "Rs 15,000 debited from A/c XX5678 via NEFT to RAMESH KUMAR on 05-10-26. Ref NEFT0012345678")
        assertEquals(PaymentMethod.BANK_TRANSFER, r.paymentMethod)
    }

    @Test fun nachAutoDebit_isNetBanking() {
        val r = parse("HDFCBK", "Rs 2,500 debited from A/c XX1234 towards NACH ACH-DR LIC OF INDIA on 05-10-26.")
        assertEquals(PaymentMethod.BANK_TRANSFER, r.paymentMethod)
    }

    // ---- registered cards win ----

    @Test fun registeredDebitCard_beatsWording() {
        val i = PaymentInstrumentClassifier.classify("Spent Rs.100 On HDFC Bank Card 4321 At CAFE", registeredDebit = setOf("4321"))
        assertEquals(PaymentMethod.DEBIT_CARD, i.method)
    }
}
