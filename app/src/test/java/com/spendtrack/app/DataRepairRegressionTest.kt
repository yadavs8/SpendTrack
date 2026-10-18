package com.spendtrack.app

import com.spendtrack.app.core.automation.KnownPayees
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The real ICICI card SMS that ended up as "👤 Flat EMI (9215676766. To Convert This Txn To Emi...". */
class DataRepairRegressionTest {

    private val airbnb = "JM-ICICIT-S Rs 18,160.20 spent on ICICI Bank Card XX1014 on 12-Oct-26 at Airbnb Payments. Avl Lmt: Rs 38,973.35. " +
        "To dispute, call 18002662/SMS BLOCK 1014 to 9215676766. To convert this txn to EMI give a missed call on 9924667667. " +
        "Know more about EMI conversion at https://icici.co/ICICIT/j/18c32f22"
    private val amazonPay = "JD-ICICIT-S INR 699.00 spent using ICICI Bank Card XX1014 on 03-Oct-26 on AMAZON PAY IN E. Avl Limit: INR 71,182.77. " +
        "If not you, call 1800 2662/SMS BLOCK 1014 to 9215676766."

    @Test fun cardSpend_merchantIsThePlace_notTheBlockNumber() {
        val r = TransactionParser.parse("ICICIT", airbnb)
        assertNotNull(r)
        assertEquals("Airbnb Payments", r!!.merchantRaw)
        assertEquals(PaymentMethod.CREDIT_CARD, r.paymentMethod)
        assertEquals(18160.20, r.amount, 0.001)
    }

    @Test fun cardSpend_onMerchantWording() {
        assertEquals("AMAZON PAY IN E", TransactionParser.parse("ICICIT", amazonPay)!!.merchantRaw)
    }

    @Test fun emiOfferFooter_doesNotMatchTheFlatEmiRule() {
        val r = KnownPayees.match("Airbnb Payments", null, airbnb, 18160.20, System.currentTimeMillis(), KnownPayees.defaults())
        assertNull("the bank's EMI-conversion footer is not a Flat EMI payment", r)
    }

    // Real SMS recorded as a ₹1,199.50 spend called "Be Debited": it's a reminder of a future debit.
    @Test fun standingInstructionReminder_isNotASpend() {
        assertNull(TransactionParser.parse("ICICIT", "AX-ICICIT-T Payment of INR 1199.50 towards Merchant Tickertape to be debited from ICICI Bank Credit Card 1014, as per Standing Instruction ICmFNfOZby, is due by 16/10/2026. To cancel this debit or your Standing Instructions, visit www.icici.bank.in"))
    }

    @Test fun realEmiPayment_stillMatches() {
        val r = KnownPayees.match("HDFC Home Loan", null, "Rs 31,000 debited from A/c XX8749 towards Flat EMI on 05-10-26", 31000.0, System.currentTimeMillis(), KnownPayees.defaults())
        assertEquals("Flat EMI", r?.name)
    }
}
