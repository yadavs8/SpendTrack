package com.spendtrack.app.ui.screens.transactions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.data.database.entity.CategoryEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.util.Calendar

enum class DateFilter(val displayName: String) {
    ALL("All"),
    TODAY("Today"),
    YESTERDAY("Yesterday"),
    THIS_WEEK("This Week"),
    THIS_MONTH("This Month")
}

data class TransactionsUiState(
    val transactions: List<TransactionEntity> = emptyList(),
    val filteredTransactions: List<TransactionEntity> = emptyList(),
    val categories: Map<String, CategoryEntity> = emptyMap(),
    val searchQuery: String = "",
    val selectedDateFilter: DateFilter = DateFilter.ALL,
    val selectedCategoryFilter: String? = null,
    val selectedMethodFilter: PaymentMethod? = null
)

class TransactionsViewModel : ViewModel() {

    private val repository = ServiceLocator.transactionRepository
    private val categoryRepo = ServiceLocator.categoryRepository

    private val _uiState = MutableStateFlow(TransactionsUiState())
    val uiState: StateFlow<TransactionsUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            combine(
                repository.allExpenses,
                categoryRepo.allCategories
            ) { allTxns, allCats ->
                val catMap = allCats.associateBy { it.id }
                _uiState.value = _uiState.value.copy(
                    transactions = allTxns,
                    categories = catMap
                )
                applyFilters()
            }.collect {}
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
        applyFilters()
    }

    fun onDateFilterChanged(filter: DateFilter) {
        _uiState.value = _uiState.value.copy(selectedDateFilter = filter)
        applyFilters()
    }

    fun onCategoryFilterChanged(categoryId: String?) {
        val newCat = if (_uiState.value.selectedCategoryFilter == categoryId) null else categoryId
        _uiState.value = _uiState.value.copy(selectedCategoryFilter = newCat)
        applyFilters()
    }

    fun onMethodFilterChanged(method: PaymentMethod?) {
        val newMethod = if (_uiState.value.selectedMethodFilter == method) null else method
        _uiState.value = _uiState.value.copy(selectedMethodFilter = newMethod)
        applyFilters()
    }

    private fun applyFilters() {
        val state = _uiState.value
        val now = System.currentTimeMillis()
        val cal = Calendar.getInstance()

        var filtered = state.transactions

        // 1. Date Filter
        filtered = when (state.selectedDateFilter) {
            DateFilter.ALL -> filtered
            DateFilter.TODAY -> {
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                val start = cal.timeInMillis
                filtered.filter { it.dateTime >= start }
            }
            DateFilter.YESTERDAY -> {
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                val end = cal.timeInMillis
                cal.add(Calendar.DAY_OF_YEAR, -1)
                val start = cal.timeInMillis
                filtered.filter { it.dateTime in start..end }
            }
            DateFilter.THIS_WEEK -> {
                cal.set(Calendar.DAY_OF_WEEK, cal.firstDayOfWeek)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                val start = cal.timeInMillis
                filtered.filter { it.dateTime >= start }
            }
            DateFilter.THIS_MONTH -> {
                cal.set(Calendar.DAY_OF_MONTH, 1)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                val start = cal.timeInMillis
                filtered.filter { it.dateTime >= start }
            }
        }

        // 2. Category Filter
        if (state.selectedCategoryFilter != null) {
            filtered = filtered.filter { it.categoryId == state.selectedCategoryFilter }
        }

        // 3. Payment Method Filter
        if (state.selectedMethodFilter != null) {
            filtered = filtered.filter { it.paymentMethod == state.selectedMethodFilter }
        }

        // 4. Text Search
        if (state.searchQuery.isNotBlank()) {
            val q = state.searchQuery.trim().lowercase()
            filtered = filtered.filter { txn ->
                (txn.merchantName?.lowercase()?.contains(q) == true) ||
                        (txn.description?.lowercase()?.contains(q) == true) ||
                        (txn.upiReference?.lowercase()?.contains(q) == true) ||
                        (txn.amount.toString().contains(q))
            }
        }

        _uiState.value = state.copy(filteredTransactions = filtered)
    }

    fun updateTransaction(
        transaction: TransactionEntity,
        newCategoryId: String?,
        newCategoryName: String?,
        newMerchant: String?,
        newAmount: Double?,
        newMethod: PaymentMethod?
    ) {
        viewModelScope.launch {
            repository.updateTransaction(
                transaction = transaction,
                newCategoryId = newCategoryId,
                newCategoryName = newCategoryName,
                newMerchantName = newMerchant,
                newAmount = newAmount,
                newPaymentMethod = newMethod
            )
        }
    }

    fun excludeTransaction(transaction: TransactionEntity, exclude: Boolean) {
        viewModelScope.launch {
            repository.excludeTransaction(transaction, exclude)
        }
    }

    fun markAsRefund(transaction: TransactionEntity) {
        viewModelScope.launch {
            repository.markAsRefund(transaction)
        }
    }

    fun deleteTransaction(transaction: TransactionEntity) {
        viewModelScope.launch {
            repository.deleteTransaction(transaction)
        }
    }
}
