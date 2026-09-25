package com.spendtrack.app

import com.spendtrack.app.core.parser.rulepack.TemplateBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TemplateBuilderTest {

    private val sample = "MyBank: INR 1,250.50 spent at CHAI POINT on 12/09 via card 4321. Ref 99887766. Bal INR 5,000"

    @Test
    fun build_matchesFutureMessagesFromSameSender() {
        val template = TemplateBuilder.build(sample, amount = "1,250.50", merchant = "CHAI POINT", ref = "99887766")
        assertNotNull(template)

        val next = "MyBank: INR 80 spent at SWIGGY on 03/10 via card 4321. Ref 11223344. Bal INR 4,920"
        val match = Regex(template!!.regexPattern).find(next)
        assertNotNull("Template should match a new message with different values", match)
        assertEquals("80", match!!.groupValues[template.amountGroupIndex])
        assertEquals("SWIGGY", match.groupValues[template.merchantGroupIndex])
        assertEquals("11223344", match.groupValues[template.refGroupIndex!!])
    }

    @Test
    fun build_merchantBeforeAmount_assignsGroupsInOrder() {
        val text = "Paid to Ramesh Stores Rs 300 successfully"
        val template = TemplateBuilder.build(text, amount = "300", merchant = "Ramesh Stores")
        assertNotNull(template)
        assertEquals(1, template!!.merchantGroupIndex)
        assertEquals(2, template.amountGroupIndex)
    }

    @Test
    fun build_snippetNotInMessage_returnsNull() {
        assertNull(TemplateBuilder.build(sample, amount = "999", merchant = "CHAI POINT"))
    }
}
