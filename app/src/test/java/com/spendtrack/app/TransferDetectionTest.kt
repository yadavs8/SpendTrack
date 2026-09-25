package com.spendtrack.app

import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class TransferDetectionTest {

    @Test
    fun parse_creditCardBillPayment_isInternalTransfer() {
        val title = "CRED"
        val text = "Payment of Rs. 15,400 towards your credit card bill ending in 4321 was successful."
        val result = TransactionParser.parse(title, text, "com.dreamplug.androidapp")

        assertNotNull(result)
        // Must be INTERNAL_TRANSFER to prevent double counting with card swipes!
        assertEquals(TransactionType.INTERNAL_TRANSFER, result!!.transactionType)
        assertEquals(15400.0, result.amount, 0.01)
    }

    @Test
    fun parse_transferBetweenOwnAccounts_isInternalTransfer() {
        val title = "HDFC Bank Alert"
        val text = "Rs 25,000 transferred from A/c XX1234 to A/c XX5678 on 25-Sep."
        val result = TransactionParser.parse(title, text)

        assertNotNull(result)
        assertEquals(TransactionType.INTERNAL_TRANSFER, result!!.transactionType)
        assertEquals(25000.0, result.amount, 0.01)
    }
}
