package com.spendtrack.app.data.di

import android.content.Context
import com.spendtrack.app.core.backup.DataImportExportManager
import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.data.database.AppDatabase
import com.spendtrack.app.data.datastore.SettingsManager
import com.spendtrack.app.data.repository.CategoryRepository
import com.spendtrack.app.data.repository.MerchantRuleRepository
import com.spendtrack.app.data.repository.TransactionRepository

object ServiceLocator {

    private var appContext: Context? = null

    val database: AppDatabase by lazy {
        val ctx = appContext ?: throw IllegalStateException("ServiceLocator not initialized with Context")
        AppDatabase.getInstance(ctx)
    }

    val settingsManager: SettingsManager by lazy {
        val ctx = appContext ?: throw IllegalStateException("ServiceLocator not initialized with Context")
        SettingsManager(ctx)
    }

    val categoryRepository: CategoryRepository by lazy {
        CategoryRepository(database.categoryDao())
    }

    val merchantRuleRepository: MerchantRuleRepository by lazy {
        MerchantRuleRepository(database.merchantRuleDao())
    }

    val categoryEngine: CategoryEngine by lazy {
        CategoryEngine(database.merchantRuleDao(), database.categoryDao())
    }

    val deduplicationEngine: DeduplicationEngine by lazy {
        DeduplicationEngine(database.transactionDao())
    }

    val transactionRepository: TransactionRepository by lazy {
        TransactionRepository(
            transactionDao = database.transactionDao(),
            categoryEngine = categoryEngine,
            deduplicationEngine = deduplicationEngine,
            merchantRuleRepository = merchantRuleRepository
        )
    }

    val userAccountRepository: com.spendtrack.app.data.repository.UserAccountRepository by lazy {
        com.spendtrack.app.data.repository.UserAccountRepository(database.userAccountDao())
    }

    val rulePackEngine: com.spendtrack.app.core.parser.rulepack.RulePackEngine by lazy {
        val ctx = appContext ?: throw IllegalStateException("ServiceLocator not initialized with Context")
        com.spendtrack.app.core.parser.rulepack.RulePackEngine(ctx, database.templateRuleDao())
    }

    val importExportManager: DataImportExportManager by lazy {
        DataImportExportManager(
            transactionRepository = transactionRepository,
            categoryEngine = categoryEngine
        )
    }

    fun init(context: Context) {
        if (appContext == null) {
            appContext = context.applicationContext
        }
    }
}
