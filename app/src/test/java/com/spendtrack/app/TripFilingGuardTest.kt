package com.spendtrack.app

import com.spendtrack.app.core.model.TripFilingGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Trip mode must not file payments that are clearly not trip spends (cases from a real Manali trip). */
class TripFilingGuardTest {
    private fun ask(name: String?, amount: Double, raw: String? = null, vpa: String? = null, scope: String? = null, n: Int = 0) =
        TripFilingGuard.reasonToAsk(name, vpa, raw, amount, scope, n, 2)

    @Test fun credCardBillIsAsked() {
        assertEquals("card-bill", ask("CRED", 3999.0, "Rs 3999 debited from A/c XX12 to cred.club@axisb UPI Ref 1234", "cred.club@axisb"))
    }

    @Test fun creditCardBillSmsIsAsked() {
        assertEquals("card-bill", ask("HDFC Bank", 12000.0, "Payment of Rs 12000 received towards your credit card ending 4321"))
    }

    @Test fun fiveLakhTransferIsAsked() {
        assertEquals("large", ask("Ffd", 503000.0, "INR 503000 debited via NEFT"))
    }

    @Test fun claudeSubscriptionIsAsked() {
        assertEquals("subscription", ask("Anthropic* Clau", 2399.0, "Rs 2399 spent on your credit card at ANTHROPIC* CLAU"))
    }

    @Test fun phoneRechargeIsAsked() {
        assertEquals("subscription", ask("Airtel Postpaid", 599.0))
    }

    @Test fun payeeAlwaysFiledAsFamilyIsAsked() {
        assertEquals("learned:family", ask("Vijay Vegetable", 140.0, scope = "family", n = 3))
    }

    @Test fun payeeFiledOnceIsStillTrip() {
        assertNull(ask("Vijay Vegetable", 140.0, scope = "family", n = 1))
    }

    @Test fun realTripSpendsStillGoToTheTrip() {
        assertNull(ask("Pinewood Dhaba", 1496.0, "Rs 1496 debited to Pinewood Dhaba UPI"))
        assertNull(ask("Kasol Inn Guest", 3819.0))
        assertNull(ask("T U Petros", 750.0))
        assertNull(ask("Khalilpur Toll Plaza", 65.0, "FASTag toll"))
        assertNull(ask("Airbnb Payments", 18160.2, "Rs 18160.20 spent on your ICICI Bank Credit Card XX1234 at Airbnb"))
        assertNull(ask("Zomato", 640.0, "INR 640 spent on credit card"))   // buying with a card is a spend, not a card bill
    }

    @Test fun wordsInsideNamesDoNotTrigger() {
        assertNull(ask("Credible Dhaba", 450.0))          // "cred" only as a whole word
        assertNull(ask("Sipping Chai Cafe", 120.0))       // "sip" only as a whole word
    }
}
