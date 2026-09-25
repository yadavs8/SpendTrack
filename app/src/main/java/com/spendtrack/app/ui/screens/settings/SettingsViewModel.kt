package com.spendtrack.app.ui.screens.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.spendtrack.app.core.backup.DataImportExportManager
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.io.InputStream

data class SettingsUiState(
    val monitoredApps: Set<String> = emptySet(),
    val isSmsEnabled: Boolean = false,
    val monthlyBudget: Double = 0.0,
    val dailyLimit: Double = 0.0,
    val isDailyLimitAlertEnabled: Boolean = false,
    val isBiometricEnabled: Boolean = false,
    val confirmationNotifs: Boolean = true,
    val merchantRules: List<MerchantRuleEntity> = emptyList(),
    val userAccounts: List<com.spendtrack.app.data.database.entity.UserAccountEntity> = emptyList(),
    val importMessage: String? = null,
    val exportCsvContent: String? = null
)

class SettingsViewModel : ViewModel() {

    private val settingsManager = ServiceLocator.settingsManager
    private val merchantRuleRepo = ServiceLocator.merchantRuleRepository
    private val transactionRepo = ServiceLocator.transactionRepository
    private val importExportManager = ServiceLocator.importExportManager
    private val userAccountRepo = ServiceLocator.userAccountRepository

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadSettings()
    }

    private fun loadSettings() {
        viewModelScope.launch {
            combine(
                settingsManager.monitoredAppsFlow,
                settingsManager.isSmsDetectionEnabled,
                settingsManager.monthlyBudgetFlow,
                settingsManager.dailyLimitFlow,
                settingsManager.isDailyLimitAlertEnabled,
                settingsManager.isBiometricEnabled,
                settingsManager.showConfirmationNotifs,
                merchantRuleRepo.allRules,
                userAccountRepo.allAccounts
            ) { values ->
                @Suppress("UNCHECKED_CAST")
                val apps = values[0] as Set<String>
                val sms = values[1] as Boolean
                val budget = values[2] as Double
                val dailyLimit = values[3] as Double
                val alert = values[4] as Boolean
                val biometric = values[5] as Boolean
                val notifs = values[6] as Boolean
                @Suppress("UNCHECKED_CAST")
                val rules = values[7] as List<MerchantRuleEntity>
                @Suppress("UNCHECKED_CAST")
                val accounts = values[8] as List<com.spendtrack.app.data.database.entity.UserAccountEntity>

                SettingsUiState(
                    monitoredApps = apps,
                    isSmsEnabled = sms,
                    monthlyBudget = budget,
                    dailyLimit = dailyLimit,
                    isDailyLimitAlertEnabled = alert,
                    isBiometricEnabled = biometric,
                    confirmationNotifs = notifs,
                    merchantRules = rules,
                    userAccounts = accounts
                )
            }.collect { state ->
                _uiState.value = state
            }
        }
    }

    fun addAccount(bankName: String, last4: String, type: com.spendtrack.app.data.database.entity.AccountType, nickname: String?) {
        viewModelScope.launch {
            userAccountRepo.addAccount(bankName, last4, type, nickname)
        }
    }

    fun deleteAccount(id: String) {
        viewModelScope.launch {
            userAccountRepo.deleteAccount(id)
        }
    }

    fun toggleMonitoredApp(pkg: String, enable: Boolean) {
        viewModelScope.launch {
            settingsManager.setMonitoredApp(pkg, enable)
        }
    }

    fun toggleSms(enable: Boolean) {
        viewModelScope.launch {
            settingsManager.setSmsDetection(enable)
        }
    }

    fun updateMonthlyBudget(amount: Double) {
        viewModelScope.launch {
            settingsManager.setMonthlyBudget(amount)
        }
    }

    fun updateDailyLimit(amount: Double, enableAlert: Boolean) {
        viewModelScope.launch {
            settingsManager.setDailyLimit(amount, enableAlert)
        }
    }

    fun toggleConfirmationNotifs(enable: Boolean) {
        viewModelScope.launch {
            settingsManager.setConfirmationNotifs(enable)
        }
    }

    fun toggleBiometric(enable: Boolean) {
        viewModelScope.launch {
            settingsManager.setBiometricLock(enable)
        }
    }

    fun deleteMerchantRule(ruleId: String) {
        viewModelScope.launch {
            merchantRuleRepo.deleteRule(ruleId)
        }
    }

    fun generateDemoData() {
        viewModelScope.launch {
            transactionRepo.generateDemoData()
        }
    }

    fun clearDemoData() {
        viewModelScope.launch {
            transactionRepo.clearDemoData()
        }
    }

    fun exportTransactionsCsv(onReady: (String) -> Unit) {
        viewModelScope.launch {
            val txns = transactionRepo.getAllTransactionsSync()
            val csv = importExportManager.exportToCsv(txns)
            onReady(csv)
        }
    }

    fun exportCsvFile(context: Context, onReady: (android.net.Uri) -> Unit) {
        viewModelScope.launch {
            val txns = transactionRepo.getAllTransactionsSync()
            val uri = importExportManager.exportCsvToFile(context, txns)
            onReady(uri)
        }
    }

    fun exportTransactionsJson(onReady: (String) -> Unit) {
        viewModelScope.launch {
            val txns = transactionRepo.getAllTransactionsSync()
            val json = importExportManager.exportToJson(txns)
            onReady(json)
        }
    }

    fun exportJsonFile(context: Context, onReady: (android.net.Uri) -> Unit) {
        viewModelScope.launch {
            val txns = transactionRepo.getAllTransactionsSync()
            val uri = importExportManager.exportJsonToFile(context, txns)
            onReady(uri)
        }
    }

    fun importCsv(stream: InputStream, onComplete: (DataImportExportManager.ImportResult) -> Unit) {
        viewModelScope.launch {
            val result = importExportManager.importFromCsv(stream)
            onComplete(result)
        }
    }
}
