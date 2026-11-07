package com.spendtrack.app

import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.network.SupabaseSyncClient.CloudRow
import com.spendtrack.app.core.sync.UnsortedSync
import com.spendtrack.app.data.database.entity.TransactionEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** v139: a payment goes to Kharcha Book as "⏳ to sort" before its question is answered. */
class UnsortedSyncTest {

    private val now = 1_794_000_000_000L
    private val marks = listOf("🏠", "👤", "📈", "✈", "🔨", "🔁", "💼", "👵")

    private fun waiting(
        amount: Double = 2640.0,
        at: Long = now - 10 * 60_000L,
        ref: String? = "667724020817"
    ) = TransactionEntity(
        amount = amount,
        merchantName = "Anju",
        description = "ICICI Bank Acct XX602 debited for Rs 2640.00 on 07-Nov-26; Anju credited. UPI:667724020817.",
        transactionType = TransactionType.EXPENSE,
        dateTime = at,
        upiReference = ref,
        needsReview = true,
        createdAt = at + 5_000L
    )

    @Test
    fun anUnansweredPayment_isPushedRightAway_asToSort() {
        val t = waiting()
        assertTrue(UnsortedSync.shouldPush(t, now, 6 * 3600_000L))
        assertEquals("⏳ Anju", UnsortedSync.description(t))
        assertTrue(UnsortedSync.isUnsorted("⏳ Anju"))
        assertFalse(UnsortedSync.isUnsorted("🏠 Anju"))
    }

    @Test
    fun notPushedEarly_whenAnswered_alreadyThere_aPossibleDuplicate_aReRead_orNotASpend() {
        val reread = 6 * 3600_000L
        assertFalse(UnsortedSync.shouldPush(waiting().copy(needsReview = false), now, reread))
        assertFalse(UnsortedSync.shouldPush(waiting().copy(cloudRowId = "row-1"), now, reread))
        assertFalse(UnsortedSync.shouldPush(waiting().copy(linkedTransactionId = "other"), now, reread))
        assertFalse(UnsortedSync.shouldPush(waiting().copy(isExcluded = true), now, reread))
        assertFalse(UnsortedSync.shouldPush(waiting().copy(transactionType = TransactionType.INTERNAL_TRANSFER), now, reread))
        assertFalse(UnsortedSync.shouldPush(waiting().copy(refundedAmount = 2640.0), now, reread))
        // an old message read again after a reinstall: Kharcha Book may already have it
        val old = waiting(at = now - 3 * 24 * 3600_000L).copy(createdAt = now)
        assertFalse(UnsortedSync.shouldPush(old, now, reread))
    }

    @Test
    fun anEarlyRowLeaves_whenThePaymentStopsCounting() {
        assertTrue(UnsortedSync.shouldRemove(waiting().copy(cloudRowId = "row-1", isExcluded = true)))
        assertTrue(UnsortedSync.shouldRemove(waiting().copy(cloudRowId = "row-1", transactionType = TransactionType.INTERNAL_TRANSFER)))
        assertFalse(UnsortedSync.shouldRemove(waiting().copy(cloudRowId = "row-1")))
        assertFalse(UnsortedSync.shouldRemove(waiting().copy(isExcluded = true)))
    }

    @Test
    fun itsOwnToSortRow_neverAnswersTheQuestion_butOneSortedInKharchaBookDoes() {
        val t = waiting(ref = null).copy(cloudRowId = "row-1")
        val own = CloudRow(2640.0, "⏳ Anju", t.dateTime, null, "expense", "upi", id = "row-1")
        assertNull(UnsortedSync.pickHandEntry(listOf(own), 2640.0, null, "row-1", t.dateTime, 0, marks))

        val sortedThere = own.copy(description = "🏠 Anju")
        assertEquals("row-1", UnsortedSync.pickHandEntry(listOf(sortedThere), 2640.0, null, "row-1", t.dateTime, 0, marks)?.id)
    }

    @Test
    fun anotherPaymentsToSortRow_isNotTakenForAHandEntry() {
        val other = CloudRow(10.0, "⏳ Coffee", now, null, "expense", "credit_card", id = "row-9")
        assertNull(UnsortedSync.pickHandEntry(listOf(other), 10.0, null, null, now, 0, marks))
    }

    @Test
    fun aHandTypedRow_stillAnswersIt_andARefRowOnlyOnceMoved() {
        val hand = CloudRow(9283.0, "🏠 Car insurance · Brezza", now, null, "expense", "credit_card", id = "row-h")
        assertEquals("row-h", UnsortedSync.pickHandEntry(listOf(hand), 9283.0, null, null, now, 0, marks)?.id)
        // already used by an earlier answered payment of the same amount
        assertNull(UnsortedSync.pickHandEntry(listOf(hand), 9283.0, null, null, now, 1, marks))

        val byRef = CloudRow(2640.0, "🏠 Anju (paid via CRED)", now, "667724020817", "expense", "upi", id = "row-r")
        assertEquals("row-r", UnsortedSync.pickHandEntry(listOf(byRef), 2640.0, "667724020817", null, now, 0, marks)?.id)
        val untouchedRef = byRef.copy(description = "Anju")
        assertNull(UnsortedSync.pickHandEntry(listOf(untouchedRef), 2640.0, "667724020817", null, now, 0, marks))
    }
}
