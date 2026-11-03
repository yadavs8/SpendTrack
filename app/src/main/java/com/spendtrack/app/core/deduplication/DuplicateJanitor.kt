package com.spendtrack.app.core.deduplication

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.core.nudge.NudgeScheduler
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.service.QuickActionReceiver
import org.json.JSONArray
import org.json.JSONObject

/**
 * Check-up of what is already saved, run when the app opens:
 *  1. Junk older versions let in -- "₹0" entries and WhatsApp chat messages read as payments -- stops
 *     counting and stops being asked about.
 *  2. Copies of one payment (see [SmartMatcher]) are folded together. A copy nobody answered yet is
 *     folded quietly; when several copies were each filed by hand (the insurance premium saved three
 *     times), one notification asks "keep one?", since only the user can say for sure.
 */
object DuplicateJanitor {

    private const val PREFS = "kharcha_duplicate_janitor"
    private const val KEY_LAST_SCAN = "last_scan"
    private const val KEY_GROUPS = "groups"          // groupKey -> [ids] awaiting an answer
    private const val KEY_ANSWERED = "answered"      // groupKeys already answered (never asked again)
    private const val SCAN_EVERY_MS = 6 * 60 * 60 * 1000L
    private const val LOOK_BACK_MS = 60L * 24 * 60 * 60 * 1000L

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Returns how many entries changed (so the caller can sync and refresh). */
    suspend fun run(context: Context, now: Long = System.currentTimeMillis()): Int {
        val appContext = context.applicationContext
        val repo = ServiceLocator.transactionRepository
        var changed = 0
        val recent = repo.getCountedSince(now - LOOK_BACK_MS)

        // 1. Junk.
        for (t in recent) {
            if (t.isManuallyAdded || t.transactionType != TransactionType.EXPENSE) continue
            val zero = t.amount <= 0.0
            val whatsAppChat = t.needsReview && t.sourcePackage in TransactionParser.WHATSAPP_PACKAGES &&
                !TransactionParser.looksLikeWhatsAppPayment(t.rawNotificationText, anchored = false)
            if (zero || whatsAppChat) {
                if (repo.discardNotPayment(t.id)) {
                    NudgeScheduler.cancel(appContext, t.id)
                    ExpensePromptNotifier.dismiss(appContext, t.id)
                    changed++
                }
            }
        }

        // 2. Copies of one payment (not more often than every few hours).
        val p = prefs(appContext)
        if (now - p.getLong(KEY_LAST_SCAN, 0L) < SCAN_EVERY_MS) return changed
        p.edit().putLong(KEY_LAST_SCAN, now).apply()

        val counted = repo.getCountedSince(now - LOOK_BACK_MS).filter { !it.isManuallyAdded && it.amount > 0 }
        val answered = answeredKeys(appContext)
        for (group in findGroups(counted)) {
            val keeper = pickKeeper(group)
            // Copies nobody has answered yet: fold them in without asking.
            val unanswered = group.filter { it.id != keeper.id && it.needsReview }
            for (copy in unanswered) {
                repo.confirmDuplicate(copy.id, keeper.id)
                NudgeScheduler.cancel(appContext, copy.id)
                ExpensePromptNotifier.dismiss(appContext, copy.id)
                changed++
            }
            // Several copies each filed by hand: ask once.
            val filed = group.filter { it.id == keeper.id || !it.needsReview }
            if (filed.size >= 2) {
                val key = groupKey(filed)
                if (key !in answered) askKeepOne(appContext, key, filed)
            }
        }
        if (changed > 0) SafeLogger.i("Duplicate check-up tidied $changed entries")
        return changed
    }

    /** The user's answer to "₹X logged N times — keep one?". */
    suspend fun answer(context: Context, groupKey: String, keepOne: Boolean) {
        val appContext = context.applicationContext
        NotificationManagerCompat.from(appContext).cancel(notificationId(groupKey))
        val ids = pendingGroups(appContext)[groupKey].orEmpty()
        markAnswered(appContext, groupKey)
        if (!keepOne || ids.size < 2) return
        val repo = ServiceLocator.transactionRepository
        val entries = ids.mapNotNull { repo.getTransactionById(it) }.filter { !it.isExcluded }
        if (entries.size < 2) return
        val keeper = pickKeeper(entries)
        entries.filter { it.id != keeper.id }.forEach { repo.confirmDuplicate(it.id, keeper.id) }
        repo.getTransactionById(keeper.id)?.let { ExpensePromptNotifier.showMerged(appContext, it) }
        runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(appContext) }
        ServiceLocator.cloudSyncRepository.syncPending()
    }

    /** Groups of entries that are one payment, by [SmartMatcher] (oldest first in each group). */
    fun findGroups(entries: List<TransactionEntity>): List<List<TransactionEntity>> {
        val sorted = entries.sortedBy { it.dateTime }
        val parent = IntArray(sorted.size) { it }
        fun find(i: Int): Int { var x = i; while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }; return x }
        for (i in sorted.indices) {
            val a = sorted[i]
            for (j in i + 1 until sorted.size) {
                val b = sorted[j]
                if (b.dateTime - a.dateTime > SmartMatcher.MAX_WINDOW_MS) break
                if (a.transactionType != b.transactionType) continue
                val score = SmartMatcher.score(DeduplicationEngine.toMsg(a), DeduplicationEngine.toMsg(b)) ?: continue
                if (score >= SmartMatcher.SAME_PAYMENT) parent[find(j)] = find(i)
            }
        }
        return sorted.indices.groupBy { find(it) }.values.filter { it.size >= 2 }.map { idx -> idx.map { sorted[it] } }
    }

    /** The entry to keep: one the user filed, then one with a bank reference, then the earliest. */
    fun pickKeeper(group: List<TransactionEntity>): TransactionEntity =
        group.sortedWith(
            compareBy<TransactionEntity>(
                { if (!it.needsReview) 0 else 1 },
                { if (!it.upiReference.isNullOrBlank() || !it.bankReference.isNullOrBlank()) 0 else 1 },
                { it.dateTime }
            )
        ).first()

    private fun groupKey(entries: List<TransactionEntity>): String =
        entries.map { it.id }.sorted().joinToString(",").hashCode().toString(16)

    private fun notificationId(groupKey: String): Int = ("dup_group_$groupKey").hashCode()

    private fun askKeepOne(context: Context, key: String, entries: List<TransactionEntity>) {
        val groups = pendingGroups(context).toMutableMap()
        groups[key] = entries.map { it.id }
        savePendingGroups(context, groups)

        val first = entries.minByOrNull { it.dateTime } ?: return
        val merchant = entries.mapNotNull { it.merchantName }
            .firstOrNull { it.isNotBlank() && !it.equals("Unknown Merchant", ignoreCase = true) }
        val title = "${ExpensePromptNotifier.amountLabel(first.amount)}${if (merchant != null) " at $merchant" else ""} logged ${entries.size} times"
        val dates = entries.sortedBy { it.dateTime }.joinToString(", ") { ExpensePromptNotifier.whenLabel(it.dateTime) }
        val text = "Looks like one payment, saved from ${entries.size} different messages ($dates). Keep it once?"

        val nid = notificationId(key)
        fun action(action: String, label: String): NotificationCompat.Action {
            val intent = Intent(context, QuickActionReceiver::class.java).apply {
                this.action = action
                putExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID, key) // the group key travels in this slot
                putExtra(ExpensePromptNotifier.EXTRA_NOTIFICATION_ID, nid)
            }
            val pi = PendingIntent.getBroadcast(context, ("dup_${key}_$action").hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            return NotificationCompat.Action.Builder(0, label, pi).build()
        }
        val open = PendingIntent.getActivity(
            context, nid,
            Intent(context, com.spendtrack.app.MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        runCatching { ExpensePromptNotifier.ensureChannelPublic(context) }
        val builder = NotificationCompat.Builder(context, ExpensePromptNotifier.CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .addAction(action(QuickActionReceiver.ACTION_KEEP_ONE, "✅ Keep one"))
            .addAction(action(QuickActionReceiver.ACTION_KEEP_ALL, "Keep all ${entries.size}"))
        runCatching { NotificationManagerCompat.from(context).notify(nid, builder.build()) }
    }

    private fun pendingGroups(context: Context): Map<String, List<String>> = try {
        val o = JSONObject(prefs(context).getString(KEY_GROUPS, "{}") ?: "{}")
        o.keys().asSequence().associateWith { k ->
            val arr = o.optJSONArray(k) ?: JSONArray()
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
        }
    } catch (_: Exception) {
        emptyMap()
    }

    private fun savePendingGroups(context: Context, groups: Map<String, List<String>>) {
        val o = JSONObject()
        groups.entries.toList().takeLast(30).forEach { (k, ids) -> o.put(k, JSONArray(ids)) }
        prefs(context).edit().putString(KEY_GROUPS, o.toString()).apply()
    }

    private fun answeredKeys(context: Context): Set<String> =
        (prefs(context).getString(KEY_ANSWERED, "") ?: "").split(',').filter { it.isNotBlank() }.toSet()

    private fun markAnswered(context: Context, key: String) {
        val set = answeredKeys(context).toMutableList().apply { if (key !in this) add(key) }
        prefs(context).edit().putString(KEY_ANSWERED, set.takeLast(300).joinToString(",")).apply()
        savePendingGroups(context, pendingGroups(context) - key)
    }
}
