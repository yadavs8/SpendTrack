package com.spendtrack.app.core.automation

import android.content.Context
import android.content.Intent
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.CardBillParser
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.datastore.SettingsManager
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.data.repository.KharchaRules
import com.spendtrack.app.service.QuickActionReceiver
import com.spendtrack.app.ui.log.LogExpenseActivity
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * The automations. Each one is switchable in Settings, fires at most once per occasion (see
 * SettingsManager.claimAlert), and reads Kharcha Book's own rows -- so web-typed entries count too.
 * When Cloud Sync is off it falls back to what the phone detected itself.
 */
object AutomationRunner {

    // Fixed notification ids, one per kind (a newer alert of the same kind replaces the older).
    private const val ID_BUDGET = 0x7B00
    private const val ID_CASH = 0x7B10
    private const val ID_BILL = 0x7B20
    private const val ID_SETTLE = 0x7B30
    private const val ID_WEEKLY = 0x7B40
    private const val ID_INCOME = 0x7B50

    private val settings get() = ServiceLocator.settingsManager

    // ---------------- data ----------------

    /** Kharcha Book rows for [from, to); falls back to the phone's own records if the cloud isn't reachable. */
    private suspend fun rows(from: Long, to: Long): List<Insights.Row> {
        val cloud = runCatching { ServiceLocator.cloudSyncRepository.fetchCloudRows(from, to) }.getOrNull()
        if (cloud != null) return cloud.map { Insights.Row(it.amount, it.description, it.spentAt, it.kind, it.method) }
        return ServiceLocator.transactionRepository.getAllTransactionsSync()
            .filter { !it.isDemo && !it.isExcluded && it.dateTime in from until to }
            .mapNotNull { localRow(it) }
    }

    private fun localRow(t: TransactionEntity): Insights.Row? {
        val kind = when (t.transactionType) {
            TransactionType.EXPENSE -> "expense"
            TransactionType.INCOME -> "income"
            TransactionType.CASH_WITHDRAWAL -> "cash_withdrawal"
            else -> return null
        }
        val desc = (if (t.isEdited) t.description else null) ?: t.merchantName ?: "Expense"
        return Insights.Row(t.amount - t.refundedAmount, desc, t.dateTime, kind, t.paymentMethod.code)
    }

    private suspend fun enabled(key: androidx.datastore.preferences.core.Preferences.Key<Boolean>) =
        runCatching { settings.automationFlow(key).first() }.getOrDefault(true)

    private suspend fun shared(key: String): String? = runCatching { settings.sharedValueFlow(key).first() }.getOrNull()

    // ---------------- 1. budget alerts ----------------

    suspend fun checkBudgets(context: Context, now: Long = System.currentTimeMillis()) {
        if (!enabled(SettingsManager.KEY_BUDGET_ALERTS)) return
        val monthly = shared(SettingsManager.SHARED_MONTHLY_BUDGET)?.toDoubleOrNull() ?: 0.0
        val catBudgets = runCatching {
            val o = JSONObject(shared(SettingsManager.SHARED_CATEGORY_BUDGETS) ?: "{}")
            o.keys().asSequence().associateWith { o.optDouble(it, 0.0) }.filterValues { it > 0 }
        }.getOrDefault(emptyMap())
        if (monthly <= 0 && catBudgets.isEmpty()) return

        val start = Insights.monthStart(now)
        val month = Insights.monthKey(now)
        val hits = Insights.budgetHits(rows(start, now + 60_000), monthly, catBudgets)
        // Newest, most severe first; one notification summarising anything newly crossed.
        val fresh = hits.filter { settings.claimAlert("budget|$month|${it.name}|${it.threshold}") }
        if (fresh.isEmpty()) return
        val daysLeft = daysLeftInMonth(now)
        val lines = fresh.sortedByDescending { it.pct }.map { h ->
            val left = h.budget - h.spent
            val tail = if (left > 0) "${Insights.rupees(left)} left for $daysLeft days" else "${Insights.rupees(-left)} over"
            "${if (h.threshold >= 100) "🔴" else "🟠"} ${h.name}: ${Insights.rupees(h.spent)} of ${Insights.rupees(h.budget)} (${h.pct}%) · $tail"
        }
        val worst = fresh.maxByOrNull { it.pct }!!
        val title = if (worst.threshold >= 100) "Over budget: ${worst.name}" else "Nearing budget: ${worst.name}"
        AutomationNotifier.post(context, ID_BUDGET, title, lines.first(), lines.joinToString("\n"))
    }

    // ---------------- 2. income logged (with undo) ----------------

    suspend fun onIncomeLogged(context: Context, txn: TransactionEntity) {
        if (txn.transactionType != TransactionType.INCOME || txn.isExcluded) return
        if (!settings.showConfirmationNotifs.first()) return
        val undo = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_NOT_INCOME
            putExtra(com.spendtrack.app.core.notification.ExpensePromptNotifier.EXTRA_TRANSACTION_ID, txn.id)
        }
        AutomationNotifier.post(
            context, ID_INCOME + (txn.id.hashCode() and 0xFF),
            "💰 ${Insights.rupees(txn.amount)} received — logged as income",
            txn.description ?: "Income",
            actions = listOf(AutomationNotifier.Action("Not income", AutomationNotifier.broadcast(context, txn.id.hashCode(), undo))),
            silent = true
        )
    }

    // ---------------- 3. cash wallet nudge (evening) ----------------

    suspend fun cashNudge(context: Context, now: Long = System.currentTimeMillis()) {
        if (!enabled(SettingsManager.KEY_CASH_NUDGE)) return
        // Only while there's been a recent withdrawal: cash from weeks ago is long spent or deliberate.
        val dao = ServiceLocator.database.transactionDao()
        if (dao.sumCashWithdrawn(now - 14L * 24 * 3600 * 1000, now) <= 0) return
        val r = rows(Insights.monthStart(now, 1), now + 60_000)
        val unaccounted = Insights.unaccountedCash(r)
        if (unaccounted < 100) return
        if (!settings.claimAlert("cash|${dayKey(now)}")) return
        val log = AutomationNotifier.activity(context, ID_CASH, LogExpenseActivity.cashIntent(context))
        AutomationNotifier.post(
            context, ID_CASH,
            "💵 ${Insights.rupees(unaccounted)} cash not yet logged",
            "Spent any cash today? Log it so your categories stay accurate.",
            "You withdrew ${Insights.rupees(Insights.cashWithdrawn(r))} and logged ${Insights.rupees(Insights.cashSpent(r))} of cash spends. " +
                "Anything not logged is counted as \"Unaccounted cash\".",
            actions = listOf(AutomationNotifier.Action("Log cash spend", log))
        )
    }

    // ---------------- 4. bills & card due dates (morning) ----------------

    data class Bill(val id: String, val label: String, val amount: Double, val due: Long, val source: String,
                    val last4: String?, val bank: String?, val key: String?, val paid: Boolean) {
        fun toJson(): JSONObject = JSONObject().put("id", id).put("label", label).put("amount", amount).put("due", due)
            .put("source", source).put("last4", last4 ?: JSONObject.NULL).put("bank", bank ?: JSONObject.NULL)
            .put("key", key ?: JSONObject.NULL).put("paid", paid)
        companion object {
            fun from(o: JSONObject) = Bill(o.optString("id"), o.optString("label"), o.optDouble("amount", 0.0), o.optLong("due"),
                o.optString("source"), o.optString("last4").takeIf { !o.isNull("last4") && it.isNotBlank() },
                o.optString("bank").takeIf { !o.isNull("bank") && it.isNotBlank() },
                o.optString("key").takeIf { !o.isNull("key") && it.isNotBlank() }, o.optBoolean("paid"))
        }
    }

    private suspend fun loadBills(): MutableList<Bill> = runCatching {
        val arr = JSONArray(settings.billsJsonFlow.first())
        (0 until arr.length()).map { Bill.from(arr.getJSONObject(it)) }.toMutableList()
    }.getOrDefault(mutableListOf())

    private suspend fun saveBills(bills: List<Bill>) {
        val cutoff = System.currentTimeMillis() - 40L * 24 * 3600 * 1000
        settings.saveBillsJson(JSONArray().apply { bills.filter { it.due >= cutoff }.forEach { put(it.toJson()) } }.toString())
    }

    /** A credit card statement SMS: remember the due date (one bill per card per due date). */
    suspend fun onCardStatement(s: CardBillParser.Statement) {
        val id = "card|${s.bank ?: "card"}|${s.last4 ?: ""}|${dayKey(s.dueDate)}"
        val bills = loadBills().filterNot { it.id == id }.toMutableList()
        val label = listOfNotNull(s.bank, "Credit Card", s.last4?.let { "··$it" }).joinToString(" ")
        bills += Bill(id, label, s.totalDue, s.dueDate, "card", s.last4, s.bank, null, false)
        saveBills(bills)
    }

    /** "Payment received towards your credit card": that card's open statement is paid. */
    suspend fun onCardPayment(p: CardBillParser.Payment) {
        val bills = loadBills()
        var changed = false
        val updated = bills.map { b ->
            val sameCard = b.source == "card" && !b.paid &&
                ((p.last4 != null && b.last4 == p.last4) || (p.last4 == null && p.bank != null && b.bank == p.bank))
            if (sameCard) { changed = true; b.copy(paid = true) } else b
        }
        if (changed) saveBills(updated)
    }

    /** Recurring bills/subscriptions the web app detected (reported each time it renders). */
    suspend fun onWebBills(json: JSONArray?, now: Long = System.currentTimeMillis()) {
        if (json == null) return
        val cardBills = loadBills().filter { it.source == "card" }
        val cal = Calendar.getInstance()
        val web = (0 until json.length()).mapNotNull { i ->
            val o = json.optJSONObject(i) ?: return@mapNotNull null
            val day = o.optInt("day", 0).takeIf { it in 1..31 } ?: return@mapNotNull null
            cal.timeInMillis = now
            val maxDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
            cal.set(Calendar.DAY_OF_MONTH, day.coerceAtMost(maxDay)); cal.set(Calendar.HOUR_OF_DAY, 10); cal.set(Calendar.MINUTE, 0)
            val label = o.optString("label").take(40).ifBlank { return@mapNotNull null }
            Bill("web|${o.optString("key")}|${Insights.monthKey(now)}", label, o.optDouble("amount", 0.0), cal.timeInMillis,
                "recurring", null, null, o.optString("key"), o.optBoolean("paidThisMonth"))
        }
        saveBills(cardBills + web)
    }

    suspend fun billReminders(context: Context, now: Long = System.currentTimeMillis()) {
        if (!enabled(SettingsManager.KEY_BILL_REMINDERS)) return
        val bills = loadBills()
        if (bills.isEmpty()) return
        // Recurring bills paid since the web last reported: look for this month's payment by key.
        var thisMonth: List<Insights.Row>? = null
        val due = mutableListOf<Pair<Bill, Long>>()
        for (b in bills) {
            if (b.paid) continue
            val days = daysBetween(now, b.due)
            val remindAt = if (b.source == "card") setOf(3L, 1L, 0L) else setOf(2L, 0L)
            if (days !in remindAt) continue
            if (b.source == "recurring" && b.key != null) {
                if (thisMonth == null) thisMonth = rows(Insights.monthStart(now), now + 60_000)
                if (thisMonth!!.any { Insights.isExpense(it) && recurringKey(it.desc) == b.key }) continue
            }
            if (settings.claimAlert("bill|${b.id}|$days")) due += b to days
        }
        if (due.isEmpty()) return
        val lines = due.sortedBy { it.second }.map { (b, d) ->
            val whenTxt = when (d) { 0L -> "due today"; 1L -> "due tomorrow"; else -> "due in $d days (${fmtDay(b.due)})" }
            "${if (b.source == "card") "💳" else "🔁"} ${b.label}: ${Insights.rupees(b.amount)} $whenTxt"
        }
        val first = due.minByOrNull { it.second }!!
        AutomationNotifier.post(context, ID_BILL,
            if (first.first.source == "card") "Card bill ${if (first.second == 0L) "due today" else "coming up"}" else "Bill coming up",
            lines.first(), lines.joinToString("\n"))
    }

    // ---------------- 5. monthly settle-up with family (1st-3rd of the month) ----------------

    suspend fun settleNudge(context: Context, now: Long = System.currentTimeMillis()) {
        if (!enabled(SettingsManager.KEY_SETTLE_NUDGE)) return
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        if (cal.get(Calendar.DAY_OF_MONTH) > 3) return
        val prevStart = Insights.monthStart(now, 1)
        val prevKey = Insights.monthKey(prevStart)
        val s = Insights.settlement(rows(prevStart, Insights.monthStart(now)))
        if (s.pending < 1) return
        if (!settings.claimAlert("settle|$prevKey")) return
        val monthName = SimpleDateFormat("MMMM", Locale("en", "IN")).format(Date(prevStart))
        val upi = shared(SettingsManager.SHARED_MY_UPI)?.trim().orEmpty()
        val amount = Insights.rupees(s.pending)
        var msg = "Hi Maa, $amount for family expenses in $monthName."
        if (upi.isNotBlank()) {
            msg += "\nPay to UPI ID: $upi\nupi://pay?pa=${android.net.Uri.encode(upi)}&pn=${android.net.Uri.encode("Settle up")}&am=${"%.2f".format(Locale.US, s.pending)}&cu=INR&tn=${android.net.Uri.encode("Family expenses $monthName")}"
        }
        AutomationNotifier.post(context, ID_SETTLE,
            "🏠 $monthName family share: $amount",
            "Family spends ${Insights.rupees(s.familySpent)}, settled ${Insights.rupees(s.motherWithdrawn)}. Ask Maa on WhatsApp?",
            actions = listOf(AutomationNotifier.Action("Ask on WhatsApp", AutomationNotifier.whatsApp(context, ID_SETTLE, msg))))
    }

    // ---------------- 6. weekly summary (Sunday evening) ----------------

    suspend fun weeklySummary(context: Context, now: Long = System.currentTimeMillis()) {
        if (!enabled(SettingsManager.KEY_WEEKLY_SUMMARY)) return
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        if (cal.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY) return
        val thisStart = Insights.weekStart(now)
        val lastStart = Insights.weekStart(now, 1)
        if (!settings.claimAlert("week|${dayKey(thisStart)}")) return
        // Same span of last week (Mon..now-7d), so a Sunday-evening total isn't compared to a full week.
        val w = Insights.week(rows(thisStart, now + 60_000), rows(lastStart, now - 7L * 24 * 3600 * 1000 + 60_000))
        if (w.total <= 0 && w.previous <= 0) return
        val change = w.changePct?.let { if (it >= 0) "▲ $it% vs last week" else "▼ ${-it}% vs last week" } ?: "first week tracked"
        val top = w.topCategory?.let { " · top: $it ${Insights.rupees(w.topAmount)}" } ?: ""
        AutomationNotifier.post(context, ID_WEEKLY, "This week: ${Insights.rupees(w.total)}", "$change$top")
    }

    // ---------------- scheduling entry points ----------------

    suspend fun morning(context: Context) {
        safely("bills") { billReminders(context) }
        safely("settle") { settleNudge(context) }
        safely("budget") { checkBudgets(context) }
    }

    suspend fun evening(context: Context) {
        safely("cash") { cashNudge(context) }
        safely("weekly") { weeklySummary(context) }
        safely("budget") { checkBudgets(context) }
    }

    private suspend fun safely(what: String, block: suspend () -> Unit) {
        try { block() } catch (e: Exception) { SafeLogger.e("Automation '$what' failed", e) }
    }

    // ---------------- helpers ----------------

    /** Same key the web's recurringBills uses (first 3 words of the payee, scope tags removed). */
    fun recurringKey(desc: String): String =
        ExpenseScope.stripScope(desc).lowercase()
            .replace(Regex("\\([^)]*\\)"), " ").replace(Regex("[^a-z\\s]"), " ").trim()
            .split(Regex("\\s+")).filter { it.isNotBlank() }.take(3).joinToString(" ")

    private fun dayKey(ts: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ts))
    private fun fmtDay(ts: Long) = SimpleDateFormat("d MMM", Locale("en", "IN")).format(Date(ts))

    private fun daysLeftInMonth(now: Long): Int {
        val c = Calendar.getInstance().apply { timeInMillis = now }
        return c.getActualMaximum(Calendar.DAY_OF_MONTH) - c.get(Calendar.DAY_OF_MONTH) + 1
    }

    /** Whole calendar days from [from] to [to] (0 = same day). */
    fun daysBetween(from: Long, to: Long): Long {
        fun midnight(t: Long) = Calendar.getInstance().apply {
            timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        return Math.round((midnight(to) - midnight(from)) / 86_400_000.0)
    }
}
