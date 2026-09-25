package com.spendtrack.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.data.database.dao.CategorySpend
import com.spendtrack.app.data.database.entity.CategoryEntity
import com.spendtrack.app.data.database.entity.TemplateRuleEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import java.util.Calendar

data class HomeUiState(
    val todaySpend: Double = 0.0,
    val weekSpend: Double = 0.0,
    val monthSpend: Double = 0.0,
    val monthlyBudget: Double = 0.0,
    val dailyLimit: Double = 0.0,
    val isDailyLimitExceeded: Boolean = false,
    val isMonthlyBudgetExceeded: Boolean = false,
    val daysRemainingInMonth: Int = 1,
    val dailyBudgetVelocity: Double = 0.0,
    val recentExpenses: List<TransactionEntity> = emptyList(),
    val categorySpends: List<CategorySpend> = emptyList(),
    val categories: Map<String, CategoryEntity> = emptyMap(),
    val needsReviewCount: Int = 0,
    val needsReviewList: List<TransactionEntity> = emptyList()
)

class HomeViewModel : ViewModel() {

    private val repository = ServiceLocator.transactionRepository
    private val categoryRepo = ServiceLocator.categoryRepository
    private val settingsManager = ServiceLocator.settingsManager

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private data class Periods(val todayStart: Long, val weekStart: Long, val monthStart: Long)

    private fun currentPeriods(): Periods {
        fun startOfToday() = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val today = startOfToday()
        val week = startOfToday().apply { set(Calendar.DAY_OF_WEEK, firstDayOfWeek) }
        // Computed from today, not from the week start, which can fall in the previous month
        val month = startOfToday().apply { set(Calendar.DAY_OF_MONTH, 1) }
        return Periods(today.timeInMillis, week.timeInMillis, month.timeInMillis)
    }

    // Re-emits when the day rolls over so totals don't go stale if the app stays open past midnight
    private val periodsFlow = flow {
        while (true) {
            emit(currentPeriods())
            delay(60_000L)
        }
    }.distinctUntilChanged()

    init {
        loadData()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun loadData() {
        // Open-ended ranges so transactions recorded after this screen opened are still counted
        val end = Long.MAX_VALUE

        viewModelScope.launch {
            periodsFlow.flatMapLatest { (todayStart, weekStart, monthStart) ->
                combine(
                    repository.getTotalSpentForRange(todayStart, end),
                    repository.getTotalSpentForRange(weekStart, end),
                    repository.getTotalSpentForRange(monthStart, end),
                    repository.getRecentExpenses(10),
                    repository.getCategorySpends(monthStart, end),
                    categoryRepo.allCategories,
                    repository.needsReviewExpenses,
                    settingsManager.monthlyBudgetFlow,
                    settingsManager.dailyLimitFlow
                ) { values ->
                    val todaySpend = values[0] as? Double ?: 0.0
                    val weekSpend = values[1] as? Double ?: 0.0
                    val monthSpend = values[2] as? Double ?: 0.0
                    @Suppress("UNCHECKED_CAST")
                    val recent = values[3] as List<TransactionEntity>
                    @Suppress("UNCHECKED_CAST")
                    val catSpends = values[4] as List<CategorySpend>
                    @Suppress("UNCHECKED_CAST")
                    val allCats = values[5] as List<CategoryEntity>
                    @Suppress("UNCHECKED_CAST")
                    val reviewList = values[6] as List<TransactionEntity>
                    val budget = values[7] as Double
                    val dailyLimit = values[8] as Double

                    val catMap = allCats.associateBy { it.id }
                    val isLimitExceeded = dailyLimit > 0.0 && todaySpend > dailyLimit

                    val todayDay = Calendar.getInstance().get(Calendar.DAY_OF_MONTH)
                    val totalDays = Calendar.getInstance().getActualMaximum(Calendar.DAY_OF_MONTH)
                    val daysRemaining = (totalDays - todayDay + 1).coerceAtLeast(1)
                    val budgetRemaining = (budget - monthSpend).coerceAtLeast(0.0)
                    val velocity = if (budget > 0.0) budgetRemaining / daysRemaining else 0.0
                    val isBudgetExceeded = budget > 0.0 && monthSpend > budget

                    HomeUiState(
                        todaySpend = todaySpend,
                        weekSpend = weekSpend,
                        monthSpend = monthSpend,
                        monthlyBudget = budget,
                        dailyLimit = dailyLimit,
                        isDailyLimitExceeded = isLimitExceeded,
                        isMonthlyBudgetExceeded = isBudgetExceeded,
                        daysRemainingInMonth = daysRemaining,
                        dailyBudgetVelocity = velocity,
                        recentExpenses = recent,
                        categorySpends = catSpends,
                        categories = catMap,
                        needsReviewCount = reviewList.size,
                        needsReviewList = reviewList
                    )
                }
            }.collect { state ->
                _uiState.value = state
            }
        }
    }

    fun addExpense(
        amount: Double,
        merchant: String,
        categoryId: String,
        method: PaymentMethod,
        notes: String?
    ) {
        viewModelScope.launch {
            repository.addManualExpense(
                amount = amount,
                merchantName = merchant,
                categoryId = categoryId,
                paymentMethod = method,
                description = notes
            )
        }
    }

    fun confirmTransaction(transaction: TransactionEntity) {
        viewModelScope.launch {
            repository.confirmTransaction(transaction)
        }
    }

    /** Saves a user-taught parsing template and applies the taught values to this transaction. */
    fun teachFormat(transaction: TransactionEntity, rule: TemplateRuleEntity, amount: Double, merchant: String) {
        viewModelScope.launch {
            ServiceLocator.database.templateRuleDao().insertTemplateRule(rule)
            repository.updateTransaction(
                transaction = transaction,
                newMerchantName = merchant,
                newAmount = amount.takeIf { it > 0 }
            )
        }
    }

    fun deleteTransaction(transaction: TransactionEntity) {
        viewModelScope.launch {
            repository.deleteTransaction(transaction)
        }
    }
}
