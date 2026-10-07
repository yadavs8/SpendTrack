package com.spendtrack.app

import com.spendtrack.app.core.model.ExpenseScope
import org.junit.Assert.assertEquals
import org.junit.Test

class ExpenseScopeTest {

    private val rawSms = "ICICI Bank Acct XX602 debited for Rs 90.00 on 05-Oct-26; Piyush Yadav credited. UPI:664408525138."

    @Test
    fun family_usesMerchantNotRawSms() {
        val desc = ExpenseScope.describe("Piyush Yadav", rawSms, isEdited = false, scope = ExpenseScope.FAMILY)
        assertEquals("🏠 Piyush Yadav", desc)
    }

    @Test
    fun personal_usesMerchantWithoutPrefix() {
        val desc = ExpenseScope.describe("Swiggy", rawSms, isEdited = false, scope = ExpenseScope.PERSONAL)
        assertEquals("Swiggy", desc)
    }

    @Test
    fun investment_usesMerchantWithPrefix() {
        val desc = ExpenseScope.describe("Zerodha", rawSms, isEdited = false, scope = ExpenseScope.INVESTMENT)
        assertEquals("📈 Zerodha", desc)
    }

    @Test
    fun typedNote_winsOverMerchant() {
        val desc = ExpenseScope.describe("Ramesh Dairy", "Milk", isEdited = true, scope = ExpenseScope.FAMILY)
        assertEquals("🏠 Milk", desc)
    }

    @Test
    fun switchingScope_doesNotStackPrefixes() {
        val asFamily = ExpenseScope.describe("Zepto", "🏠 Groceries", isEdited = true, scope = ExpenseScope.FAMILY)
        assertEquals("🏠 Groceries", asFamily)
        val backToPersonal = ExpenseScope.describe("Zepto", "🏠 Groceries", isEdited = true, scope = ExpenseScope.PERSONAL)
        assertEquals("Groceries", backToPersonal)
        val asInvestment = ExpenseScope.describe("Groww", "📈 SIP Mutual Fund", isEdited = true, scope = ExpenseScope.INVESTMENT)
        assertEquals("📈 SIP Mutual Fund", asInvestment)
    }

    @Test
    fun noMerchantNoNote_fallsBackToExpense() {
        val desc = ExpenseScope.describe(null, rawSms, isEdited = false, scope = ExpenseScope.PERSONAL)
        assertEquals("Expense", desc)
    }

    @Test
    fun selfPayment_detectsSanjeevYadav() {
        val isSelf1 = ExpenseScope.isSelfPayment("Sanjeev Yadav", null, "Paid to Sanjeev Yadav UPI")
        assertEquals(true, isSelf1)

        val isSelf2 = ExpenseScope.isSelfPayment(null, "sanjeev@okhdfcbank", null)
        assertEquals(true, isSelf2)

        val isSelf3 = ExpenseScope.isSelfPayment(null, null, "Self transfer between ICICI and HDFC")
        assertEquals(true, isSelf3)

        val isSelf4 = ExpenseScope.isSelfPayment("HDFC Bank", null, "Transfer to my account in HDFC from ICICI")
        assertEquals(true, isSelf4)

        assertEquals(false, ExpenseScope.isSelfPayment("Swiggy", "swiggy@icici", "Swiggy order"))
    }

    @Test
    fun investment_detectsBrokersAndAmcs() {
        // Brokers
        assertEquals(true, ExpenseScope.isInvestment("Zerodha Broking", null, "Paid to Zerodha"))
        assertEquals(true, ExpenseScope.isInvestment("Groww", "groww@billdesk", "Groww Invest"))
        assertEquals(true, ExpenseScope.isInvestment("Angel One", null, "Angel Broking trade"))
        assertEquals(true, ExpenseScope.isInvestment("INDmoney", null, "INDmoney deposit"))
        assertEquals(true, ExpenseScope.isInvestment("Kuvera", null, "Kuvera MF investment"))
        assertEquals(true, ExpenseScope.isInvestment("Upstox", null, "Upstox funds added"))

        // AMCs and Schemes
        assertEquals(true, ExpenseScope.isInvestment("CAMS", null, "CAMS Mutual Fund transfer"))
        assertEquals(true, ExpenseScope.isInvestment("KFintech", null, "KFintech folio"))
        assertEquals(true, ExpenseScope.isInvestment("Nippon India", null, "Nippon India Mutual Fund"))
        assertEquals(true, ExpenseScope.isInvestment("HDFC AMC", null, "HDFC Mutual Fund"))
        assertEquals(true, ExpenseScope.isInvestment("ICICI Prudential", null, "ICICI Pru AMC"))
        assertEquals(true, ExpenseScope.isInvestment("Parag Parikh", null, "PPFAS Flexi Cap"))
        assertEquals(true, ExpenseScope.isInvestment("SBI Mutual Fund", null, "SBI MF SIP"))

        // SIP / Schemes
        assertEquals(true, ExpenseScope.isInvestment(null, null, "SIP debit towards Axis Bluechip"))
        assertEquals(true, ExpenseScope.isInvestment(null, null, "Transfer towards PPF account"))
        assertEquals(true, ExpenseScope.isInvestment(null, null, "Contribution to NPS Tier 1"))

        // Rejections (Regular spends)
        assertEquals(false, ExpenseScope.isInvestment("Swiggy", null, "Food delivery"))
        assertEquals(false, ExpenseScope.isInvestment("Starbucks Coffee", null, "Coffee at outlet"))
        assertEquals(false, ExpenseScope.isInvestment("Amazon India", null, "Amazon shopping"))
        assertEquals(false, ExpenseScope.isInvestment("Zepto", null, "Grocery order"))
    }
}
