package com.spendtrack.app.core.sync

import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.network.SupabaseSyncClient
import com.spendtrack.app.data.database.entity.TransactionEntity

/**
 * v139: a payment reaches Kharcha Book the moment it is read, not only once its "Personal / Family / Trip?"
 * question is answered. Until then its row says "⏳ <payee>" (to sort). Answering updates that same row
 * (by its id, kept in [TransactionEntity.cloudRowId]), so it never turns into two rows. A payment left
 * unanswered is still in Kharcha Book, and can be sorted there.
 *
 * Not pushed early: possible duplicate copies (the duplicate question decides first), re-reads of old
 * messages (Kharcha Book may already have them), and anything that is not a spend.
 */
object UnsortedSync {
    const val MARK = "⏳ "
    /** Payments older than this are not pushed early (an old unanswered prompt is left to the user). */
    const val WINDOW_MS = 14L * 24 * 3600 * 1000

    fun isUnsorted(description: String?): Boolean = description?.trimStart()?.startsWith("⏳") == true

    /** "⏳ Bikanervala Man": the payee (or the user's own note), with no scope yet. */
    fun description(t: TransactionEntity): String {
        val base = (if (t.isEdited) t.description?.takeIf { it.isNotBlank() } else null)
            ?: t.merchantName?.takeIf { it.isNotBlank() }
            ?: "Expense"
        val clean = ExpenseScope.stripScope(base).removePrefix("⏳").trim().ifBlank { "Expense" }
        return (MARK + clean).take(60)
    }

    fun shouldPush(t: TransactionEntity, now: Long, rereadAfterMs: Long): Boolean =
        t.needsReview && !t.syncedToCloud && t.cloudRowId == null &&
            !t.isExcluded && !t.isDemo && !t.needsCloudDelete &&
            t.transactionType == TransactionType.EXPENSE &&
            t.amount - t.refundedAmount > 0.0 &&
            t.linkedTransactionId == null &&
            now - t.dateTime in 0..WINDOW_MS &&
            t.createdAt - t.dateTime <= rereadAfterMs

    /** A row pushed early that must leave Kharcha Book: it turned out not to be a spend that counts. */
    fun shouldRemove(t: TransactionEntity): Boolean =
        t.cloudRowId != null && !t.syncedToCloud &&
            (t.isExcluded || t.isDemo || t.transactionType != TransactionType.EXPENSE)

    /**
     * The Kharcha Book row that already answers an unanswered payment, or null.
     *
     * - Its own early row counts once the user changed it there (moved it to Family, renamed it...),
     *   i.e. it no longer starts with ⏳.
     * - A row with the same bank/UPI ref counts once it was moved somewhere (a scope mark).
     * - Otherwise a row typed in by hand (no ref) with the same amount, closest in time, unless the
     *   earlier answered payments of that amount already used them all ([alreadyUsed]).
     * Rows still waiting to be sorted (⏳) never answer a different payment.
     */
    fun pickHandEntry(
        rows: List<SupabaseSyncClient.CloudRow>,
        amount: Double,
        ref: String?,
        ownRowId: String?,
        dateTime: Long,
        alreadyUsed: Int,
        scopeMarks: List<String>
    ): SupabaseSyncClient.CloudRow? {
        val sameAmount = rows.filter { r ->
            Math.abs(r.amount - amount) < 0.01 && (r.kind == null || r.kind == "expense" || r.kind == "transfer")
        }
        if (ownRowId != null) {
            sameAmount.firstOrNull { it.id == ownRowId && !isUnsorted(it.description) }?.let { return it }
        }
        sameAmount.firstOrNull { r ->
            r.refNo != null && r.refNo == ref && scopeMarks.any { r.description.trimStart().startsWith(it) }
        }?.let { return it }
        val byHand = sameAmount.filter { it.refNo == null && it.id != ownRowId && !isUnsorted(it.description) }
        if (byHand.isEmpty() || byHand.size <= alreadyUsed) return null
        return byHand.minByOrNull { Math.abs(it.spentAt - dateTime) }
    }
}
