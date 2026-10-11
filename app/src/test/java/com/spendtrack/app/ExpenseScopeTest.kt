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

    private val owners = ExpenseScope.parseOwners("Sanjeev Yadav, sanjeev@okhdfcbank")

    @Test
    fun selfPayment_detectsOwnerNameUpiIdAndPhrases() {
        assertEquals(true, ExpenseScope.isSelfPayment("Sanjeev Yadav", null, "Paid to Sanjeev Yadav UPI", owners))
        assertEquals(true, ExpenseScope.isSelfPayment(null, "sanjeev@okhdfcbank", null, owners))
        assertEquals(true, ExpenseScope.isSelfPayment(null, null, "Self transfer between ICICI and HDFC"))
        assertEquals(true, ExpenseScope.isSelfPayment("HDFC Bank", null, "Transfer to my account in HDFC from ICICI"))
        assertEquals(false, ExpenseScope.isSelfPayment("Swiggy", "swiggy@icici", "Swiggy order", owners))
    }

    @Test
    fun selfPayment_ignoresGreetingAndSharedFirstNames() {
        // Bank greets the account holder by name on every payment -- that is not a self-transfer.
        assertEquals(false, ExpenseScope.isSelfPayment("Swiggy", "swiggy@icici", "Dear Sanjeev, Rs 450 debited to Swiggy", owners))
        // A different person / shop that shares the first name.
        assertEquals(false, ExpenseScope.isSelfPayment("Sanjeev Medical Store", "sanjeevmed@ybl", null, owners))
        assertEquals(false, ExpenseScope.isSelfPayment("Sanjeev Kumar", "sanjeev@ybl", null, owners))
        // "linked account" appears in ordinary debit SMS.
        assertEquals(false, ExpenseScope.isSelfPayment("Zepto", null, "Rs 300 debited from your linked account XX12 to Zepto", owners))
        // No owners configured: only explicit self-transfer phrasing counts.
        assertEquals(false, ExpenseScope.isSelfPayment("Sanjeev Yadav", null, null))
    }

    @Test
    fun investment_shortBrokerNamesNeedWholeWords() {
        assertEquals(false, ExpenseScope.isInvestment("Govardhan Dairy", null, "Paid to Govardhan Dairy"))
        assertEquals(false, ExpenseScope.isInvestment("Dhanlaxmi Kirana", null, "Kirana"))
        assertEquals(false, ExpenseScope.isInvestment("Kitekat Pet Store", null, "Cat food"))
        assertEquals(true, ExpenseScope.isInvestment("Dhan", "raise@dhan", "Add funds to Dhan"))
    }

    @Test
    fun stripScope_removesTripAndProjectLabels() {
        assertEquals("Fuel", ExpenseScope.stripScope("✈️ Goa: Fuel"))
        assertEquals("🔨 Fuel", ExpenseScope.describe("HPCL", "✈️ Goa: Fuel", true, ExpenseScope.PROJECT))
        assertEquals("✈️ Goa: Fuel", ExpenseScope.describe("HPCL", "🏠 Fuel", true, ExpenseScope.TRIP, "Goa"))
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

        // Clearing Corporations & Depositories (ICCL, NSE Clearing, NSCCL)
        assertEquals(true, ExpenseScope.isInvestment("India Clearing Corp", null, "Paid to India Clearing Corp"))
        assertEquals(true, ExpenseScope.isInvestment("Indian Clearing Corp", null, "Debit to Indian Clearing Corp"))
        assertEquals(true, ExpenseScope.isInvestment("Indian Clearing Corporation Ltd", null, "Settlement debit"))
        assertEquals(true, ExpenseScope.isInvestment(null, "iccl@icici", "UPI/12345/ICCL/Pay"))
        assertEquals(true, ExpenseScope.isInvestment("NSE Clearing", null, "NSE Clearing trade debit"))
        assertEquals(true, ExpenseScope.isInvestment("NSCCL", null, "NSCCL funds transfer"))

        // Rejections (Regular spends)
        assertEquals(false, ExpenseScope.isInvestment("Swiggy", null, "Food delivery"))
        assertEquals(false, ExpenseScope.isInvestment("Starbucks Coffee", null, "Coffee at outlet"))
        assertEquals(false, ExpenseScope.isInvestment("Amazon India", null, "Amazon shopping"))
        assertEquals(false, ExpenseScope.isInvestment("Zepto", null, "Grocery order"))
        assertEquals(false, ExpenseScope.isInvestment("Lavish Kirana", null, "Kirana groceries"))
    }
}
