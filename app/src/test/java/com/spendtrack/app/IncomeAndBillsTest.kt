package com.spendtrack.app

import com.spendtrack.app.core.automation.AutomationRunner
import com.spendtrack.app.core.automation.Insights
import com.spendtrack.app.core.model.MoneyLabels
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.CardBillParser
import com.spendtrack.app.core.parser.IncomeParser
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.repository.KharchaRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class IncomeAndBillsTest {

    // ---------------- income ----------------

    @Test fun salaryNeft() {
        val r = TransactionParser.parseAny("HDFCBK", "Rs 54,000.00 credited to your A/c XX8989 on 01-10-26 by NEFT from ACME TECHNOLOGIES PVT LTD. Salary for Sep. Avl Bal Rs 60,000")
        assertNotNull(r); r!!
        assertEquals(TransactionType.INCOME, r.transactionType)
        assertEquals(54000.0, r.amount, 0.01)
        assertEquals("SALARY", r.incomeKind)
        assertEquals("ACME TECHNOLOGIES PVT LTD", r.merchantRaw)
    }

    @Test fun iciciUpiCredit_payerIsTheOneDebited() {
        val r = IncomeParser.parse("ICICIT", "Dear Customer, Acct XX602 is credited with Rs 500.00 on 05-Oct-26 from Rahul Sharma. UPI:664409999999-ICICI Bank.")
        assertNotNull(r); r!!
        assertEquals(TransactionType.INCOME, r.transactionType)
        assertEquals("Rahul Sharma", r.merchantRaw)
        assertEquals("664409999999", r.upiReference)
    }

    @Test fun gpayPaidYou() {
        val r = IncomeParser.parse("Google Pay", "Rahul Sharma paid you ₹500", "com.google.android.apps.nbu.paisa.user")
        assertNotNull(r); r!!
        assertEquals("Rahul Sharma", r.merchantRaw)
        assertEquals(500.0, r.amount, 0.01)
    }

    @Test fun ourDebitWithPayeeCredited_isNotIncome() {
        assertNull(IncomeParser.parse("ICICIT", "ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited. UPI:664408525138."))
        // ...and the full parser still sees it as the expense it is.
        assertEquals(TransactionType.EXPENSE, TransactionParser.parseAny("ICICIT", "ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited. UPI:664408525138.")!!.transactionType)
    }

    @Test fun cardBillPaymentCredited_isNotIncome() {
        assertNull(IncomeParser.parse("HDFCBK", "Payment of Rs 12,345.00 has been credited to your HDFC Bank Credit Card XX4321 on 05-10-26. Thank you."))
    }

    @Test fun failedTxnReversal_isNotIncome() {
        assertNull(IncomeParser.parse("SBIINB", "Rs 500 credited to your A/c XX1234 on 05-10-26 as reversal of failed UPI txn 664400001111."))
    }

    @Test fun loanDisbursal_isNotIncome() {
        assertNull(IncomeParser.parse("HDFCBK", "Rs 2,00,000 credited to A/c XX1234 towards loan disbursement on 05-10-26."))
    }

    @Test fun chatFromSmsApp_isNotIncome() {
        assertNull(IncomeParser.parse("Rahul", "bhai I sent you Rs 500, check your account", "com.android.mms"))
    }

    @Test fun interestAndCashback() {
        assertEquals("INTEREST", IncomeParser.parse("SBIINB", "Rs 1,234 credited to your A/c XX1234 on 30-09-26 towards Savings Interest.")!!.incomeKind)
        assertEquals("CASHBACK", IncomeParser.parse("PhonePe", "Cashback received! ₹50 credited to your wallet for payment to Swiggy.", "com.phonepe.app")!!.incomeKind)
    }

    @Test fun refundCredit_isRefund() {
        val r = TransactionParser.parseAny("HDFCBK", "Rs 799 refunded to your A/c XX1234 by MYNTRA on 05-10-26. Ref 528800001111")
        assertEquals(TransactionType.REFUND, r!!.transactionType)
    }

    @Test fun incomeLabels_matchKharchaBookTags() {
        assertTrue(KharchaRules.isSalary(MoneyLabels.income("SALARY", "ACME", null, false)))
        assertTrue(KharchaRules.isMotherSettlement(MoneyLabels.income("RECEIVED", "Mamta", null, true)))
        assertTrue(KharchaRules.isIncome(MoneyLabels.income("RECEIVED", "Rahul", null, false)))
        assertTrue(KharchaRules.isIncome(MoneyLabels.unmatchedRefund("Myntra")))
        assertTrue(KharchaRules.isCashWithdrawal(MoneyLabels.cashWithdrawal("HDFC")))
        assertFalse(KharchaRules.isExpense(MoneyLabels.cashWithdrawal("HDFC")))
    }

    // ---------------- card statements ----------------

    private val oct1 = Calendar.getInstance().apply { clear(); set(2026, Calendar.OCTOBER, 1, 9, 0) }.timeInMillis

    @Test fun hdfcStatement() {
        val s = CardBillParser.parseStatement("Your HDFC Bank Credit Card XX4321 statement is generated. Total Amt Due: Rs 12,345.00 Min Amt Due: Rs 620.00 Payment Due Date: 10-OCT-26.", oct1)
        assertNotNull(s); s!!
        assertEquals(12345.0, s.totalDue, 0.01)
        assertEquals(620.0, s.minDue!!, 0.01)
        assertEquals("4321", s.last4)
        assertEquals(10, Calendar.getInstance().apply { timeInMillis = s.dueDate }.get(Calendar.DAY_OF_MONTH))
    }

    @Test fun sbiStatementSlashDate() {
        val s = CardBillParser.parseStatement("E-statement of SBI Credit Card ending 5678 dated 20/09/2026 has been sent. Total Amt Due Rs 8,450; Min Amt Due Rs 423; Payable by 10/10/2026.", oct1)
        assertNotNull(s)
        assertEquals("SBI Card", s!!.bank)
    }

    @Test fun statementIsNeverAnExpense() {
        assertNull(TransactionParser.parse("HDFCBK", "Your HDFC Bank Credit Card XX4321 statement is generated. Total Amt Due: Rs 12,345.00 Payment Due Date: 10-OCT-26."))
    }

    @Test fun cardPaymentReceived() {
        val p = CardBillParser.parsePayment("Payment of Rs 12,345.00 received towards your HDFC Bank Credit Card XX4321 on 08-10-26. Thank you.")
        assertNotNull(p)
        assertEquals("4321", p!!.last4)
    }

    // ---------------- insights ----------------

    private fun row(amount: Double, desc: String, kind: String? = null, method: String? = null) = Insights.Row(amount, desc, oct1, kind, method)

    @Test fun cashIsCountedOnce() {
        val rows = listOf(
            row(5000.0, "💵 Cash withdrawn · HDFC ATM", "cash_withdrawal", "atm"),
            row(60.0, "Milk", "expense", "cash"),
            row(200.0, "Swiggy", "expense", "upi")
        )
        assertEquals(4940.0, Insights.unaccountedCash(rows), 0.01)
        // 200 UPI + 60 cash + 4,940 still-unaccounted cash = the 5,200 that actually left
        assertEquals(5200.0, Insights.monthSpend(rows), 0.01)
    }

    @Test fun budgetThresholds() {
        val rows = listOf(row(4900.0, "🛒 General Grocery"), row(1000.0, "Swiggy"))
        val hits = Insights.budgetHits(rows, monthlyBudget = 5000.0, categoryBudgets = mapOf("🛒 Grocery" to 6000.0, "🍔 Food & Dining" to 5000.0))
        assertEquals(100, hits.first { it.name == "Monthly budget" }.threshold)
        assertEquals(80, hits.first { it.name == "🛒 Grocery" }.threshold)
        assertTrue(hits.none { it.name == "🍔 Food & Dining" })
    }

    @Test fun settlementMatchesWeb() {
        val rows = listOf(row(3000.0, "🏠 Electricity Bill"), row(1000.0, "🏠 Lavish Kirana"), row(2500.0, "👵 Withdrawn from Mother"), row(500.0, "Swiggy"))
        val s = Insights.settlement(rows)
        assertEquals(4000.0, s.familySpent, 0.01)
        assertEquals(1500.0, s.pending, 0.01)
    }

    @Test fun recurringKeyMatchesWeb() {
        assertEquals("airtel broadband", AutomationRunner.recurringKey("🏠 Airtel Broadband (Sep)"))
        assertEquals("netflix", AutomationRunner.recurringKey("Netflix"))
    }

    @Test fun indianRupeeFormat() {
        assertEquals("₹1,23,456", Insights.rupees(123456.0))
        assertEquals("₹950", Insights.rupees(950.0))
    }
}
