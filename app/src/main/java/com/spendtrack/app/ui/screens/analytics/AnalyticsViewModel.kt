package com.spendtrack.app.ui.screens.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.dao.PaymentMethodSpend
import com.spendtrack.app.data.database.entity.CategoryEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.core.logger.SafeLogger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.util.Calendar

data class MonthComparison(
    val currentMonthName: String,
    val currentMonthTotal: Double,
    val previousMonthName: String,
    val previousMonthTotal: Double,
    val difference: Double
)

data class AnalyticsUiState(
    val totalSpendThisMonth: Double = 0.0,
    val dailyAverage: Double = 0.0,
    val transactionCount: Int = 0,
    val largestTransaction: TransactionEntity? = null,
    val topMerchant: String? = null,
    val topMerchantSpend: Double = 0.0,
    val categorySpends: List<CategorySpend> = emptyList(),
    val paymentMethodSpends: List<PaymentMethodSpend> = emptyList(),
    val categories: Map<String, CategoryEntity> = emptyMap(),
    val monthComparison: MonthComparison? = null,
    val last7DaysSpend: List<com.spendtrack.app.ui.components.charts.DailyBarData> = emptyList(),
    val monthlyBudget: Double = 0.0
)

class AnalyticsViewModel : ViewModel() {

    private val repository = ServiceLocator.transactionRepository
    private val categoryRepo = ServiceLocator.categoryRepository

    private val _uiState = MutableStateFlow(AnalyticsUiState())
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()

    init {
        loadAnalytics()
    }

    private fun loadAnalytics() {
        val cal = Calendar.getInstance()

        // Current Month range
        cal.set(Calendar.DAY_OF_MONTH, 1)
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        val currentMonthStart = cal.timeInMillis
        val currentMonthName = java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault()).format(cal.time)

        val dayOfMonth = Calendar.getInstance().get(Calendar.DAY_OF_MONTH)
        val now = System.currentTimeMillis()

        // Previous Month range
        cal.add(Calendar.MONTH, -1)
        val prevMonthStart = cal.timeInMillis
        val prevMonthName = java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault()).format(cal.time)
        val prevMonthEnd = currentMonthStart - 1

        val settingsManager = ServiceLocator.settingsManager

        viewModelScope.launch {
            combine(
                repository.getExpensesForRange(currentMonthStart, now),
                repository.getTotalSpentForRange(currentMonthStart, now),
                repository.getCategorySpends(currentMonthStart, now),
                repository.getPaymentMethodSpends(currentMonthStart, now),
                categoryRepo.allCategories,
                repository.getTotalSpentForRange(prevMonthStart, prevMonthEnd),
                settingsManager.monthlyBudgetFlow
            ) { values ->
                @Suppress("UNCHECKED_CAST")
                val currentTxns = values[0] as List<TransactionEntity>
                val currentTotal = values[1] as? Double ?: 0.0
                @Suppress("UNCHECKED_CAST")
                val catSpends = values[2] as List<CategorySpend>
                @Suppress("UNCHECKED_CAST")
                val methodSpends = values[3] as List<PaymentMethodSpend>
                @Suppress("UNCHECKED_CAST")
                val allCats = values[4] as List<CategoryEntity>
                val prevTotal = values[5] as? Double ?: 0.0
                val budget = values[6] as? Double ?: 0.0

                val catMap = allCats.associateBy { it.id }
                val dailyAvg = if (dayOfMonth > 0) currentTotal / dayOfMonth else 0.0
                val largest = currentTxns.maxByOrNull { it.amount }

                // Top merchant
                val merchantMap = currentTxns.groupBy { it.merchantName ?: "Unknown" }
                    .mapValues { entry -> entry.value.sumOf { it.amount } }
                val topEntry = merchantMap.maxByOrNull { it.value }

                // Omit the comparison when there's no prior-month spending to compare
                // against, so a new user doesn't see a misleading "+100%" spike.
                val comparison = if (prevTotal > 0.0) {
                    MonthComparison(
                        currentMonthName = currentMonthName,
                        currentMonthTotal = currentTotal,
                        previousMonthName = prevMonthName,
                        previousMonthTotal = prevTotal,
                        difference = currentTotal - prevTotal
                    )
                } else {
                    null
                }

                val sevenDays = calculate7DaysSpend(currentTxns)

                AnalyticsUiState(
                    totalSpendThisMonth = currentTotal,
                    dailyAverage = dailyAvg,
                    transactionCount = currentTxns.size,
                    largestTransaction = largest,
                    topMerchant = topEntry?.key,
                    topMerchantSpend = topEntry?.value ?: 0.0,
                    categorySpends = catSpends,
                    paymentMethodSpends = methodSpends,
                    categories = catMap,
                    monthComparison = comparison,
                    last7DaysSpend = sevenDays,
                    monthlyBudget = budget
                )
            }.catch { e ->
                SafeLogger.e("Error loading analytics", e)
            }.collect { state ->
                _uiState.value = state
            }
        }
    }

    private fun calculate7DaysSpend(transactions: List<TransactionEntity>): List<com.spendtrack.app.ui.components.charts.DailyBarData> {
        val list = mutableListOf<com.spendtrack.app.ui.components.charts.DailyBarData>()
        val dayFormat = java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault())

        for (i in 6 downTo 0) {
            val c = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, -i)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val start = c.timeInMillis
            val end = start + 86400000L - 1L
            val daySum = transactions
                .filter { it.dateTime in start..end && it.transactionType == com.spendtrack.app.core.model.TransactionType.EXPENSE }
                .sumOf { it.amount }

            list.add(
                com.spendtrack.app.ui.components.charts.DailyBarData(
                    dayLabel = dayFormat.format(c.time),
                    amount = daySum,
                    isToday = (i == 0)
                )
            )
        }
        return list
    }
}
