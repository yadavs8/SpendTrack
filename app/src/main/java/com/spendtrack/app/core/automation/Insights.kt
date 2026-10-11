package com.spendtrack.app.core.automation

import com.spendtrack.app.data.repository.KharchaRules
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * Pure calculations behind the automations, on Kharcha Book rows (the same rows the web app
 * shows), so phone alerts agree with the app. No Android code here -- see InsightsTest.
 */
object Insights {

    data class Row(val amount: Double, val desc: String, val ts: Long, val kind: String? = null, val method: String? = null)

    fun isExpense(r: Row) = KharchaRules.isExpense(r.desc, r.kind)
    private fun isCashSpend(r: Row) = isExpense(r) && r.method == "cash"

    /**
     * Spending the way Kharcha Book totals it: every expense, plus cash taken out at an ATM that
     * hasn't been itemised yet ("unaccounted cash") -- so withdrawing ₹5,000 still counts once,
     * and logging "Milk ₹60 (cash)" later moves ₹60 out of "unaccounted", never double counts.
     */
    fun monthSpend(rows: List<Row>): Double = rows.filter(::isExpense).sumOf { it.amount } + unaccountedCash(rows)

    fun cashWithdrawn(rows: List<Row>) = rows.filter { KharchaRules.isCashWithdrawal(it.desc, it.kind) }.sumOf { it.amount }
    fun cashSpent(rows: List<Row>) = rows.filter(::isCashSpend).sumOf { it.amount }
    fun unaccountedCash(rows: List<Row>) = (cashWithdrawn(rows) - cashSpent(rows)).coerceAtLeast(0.0)

    fun byCategory(rows: List<Row>): Map<String, Double> {
        val out = linkedMapOf<String, Double>()
        rows.filter(::isExpense).forEach { out[KharchaRules.category(it.desc)] = (out[KharchaRules.category(it.desc)] ?: 0.0) + it.amount }
        val cash = unaccountedCash(rows)
        if (cash > 0) out["💵 Unaccounted cash"] = (out["💵 Unaccounted cash"] ?: 0.0) + cash
        return out
    }

    data class BudgetHit(val name: String, val spent: Double, val budget: Double, val threshold: Int) {
        val pct: Int get() = ((spent / budget) * 100).roundToInt()
    }

    /**
     * Budgets crossed this month: the overall monthly budget and each category budget, at 80% and
     * 100%. Only the highest threshold crossed is returned per budget (no "80%" right after "100%").
     */
    fun budgetHits(rows: List<Row>, monthlyBudget: Double, categoryBudgets: Map<String, Double>): List<BudgetHit> {
        val hits = mutableListOf<BudgetHit>()
        fun check(name: String, spent: Double, budget: Double) {
            if (budget <= 0) return
            val pct = spent / budget
            val t = when { pct >= 1.0 -> 100; pct >= 0.8 -> 80; else -> return }
            hits += BudgetHit(name, spent, budget, t)
        }
        check("Monthly budget", monthSpend(rows), monthlyBudget)
        val cats = byCategory(rows)
        categoryBudgets.forEach { (name, budget) -> check(name, cats[name] ?: 0.0, budget) }
        return hits
    }

    data class Settlement(val familySpent: Double, val motherWithdrawn: Double) {
        val pending: Double get() = (familySpent - motherWithdrawn).coerceAtLeast(0.0)
    }

    /** Same as the web's getFamilySettlement: family spends minus what Maa has already reimbursed. */
    fun settlement(rows: List<Row>): Settlement = Settlement(
        familySpent = rows.filter { isExpense(it) && KharchaRules.isFamilyEntry(it.desc) }.sumOf { it.amount },
        motherWithdrawn = rows.filter { KharchaRules.isIncome(it.desc, it.kind) && KharchaRules.isMotherSettlement(it.desc) }.sumOf { it.amount }
    )

    data class Week(val total: Double, val previous: Double, val topCategory: String?, val topAmount: Double) {
        val changePct: Int? get() = if (previous > 0) (((total - previous) / previous) * 100).roundToInt() else null
    }

    fun week(thisWeek: List<Row>, lastWeek: List<Row>): Week {
        val top = byCategory(thisWeek).maxByOrNull { it.value }
        return Week(monthSpend(thisWeek), monthSpend(lastWeek), top?.key, top?.value ?: 0.0)
    }

    // ---- time helpers (device time zone) ----

    fun monthStart(now: Long, monthsBack: Int = 0): Long = Calendar.getInstance().apply {
        timeInMillis = now
        add(Calendar.MONTH, -monthsBack)
        set(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    /** Monday 00:00 of the week containing [now], [weeksBack] weeks earlier. */
    fun weekStart(now: Long, weeksBack: Int = 0): Long = Calendar.getInstance().apply {
        timeInMillis = now
        firstDayOfWeek = Calendar.MONDAY
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        val dow = (get(Calendar.DAY_OF_WEEK) + 5) % 7 // Monday = 0
        add(Calendar.DAY_OF_YEAR, -dow - 7 * weeksBack)
    }.timeInMillis

    fun monthKey(ts: Long): String = Calendar.getInstance().apply { timeInMillis = ts }.let {
        "%04d-%02d".format(it.get(Calendar.YEAR), it.get(Calendar.MONTH) + 1)
    }

    fun rupees(v: Double): String {
        val n = v.roundToInt()
        val s = n.toString()
        if (s.length <= 3) return "₹$s"
        val last3 = s.takeLast(3)
        val rest = s.dropLast(3).reversed().chunked(2).joinToString(",").reversed()
        return "₹$rest,$last3"
    }
}
