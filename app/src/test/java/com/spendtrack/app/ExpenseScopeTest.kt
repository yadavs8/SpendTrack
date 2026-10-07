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

        assertEquals(false, ExpenseScope.isSelfPayment("Swiggy", "swiggy@icici", "Swiggy order"))
    }
}
