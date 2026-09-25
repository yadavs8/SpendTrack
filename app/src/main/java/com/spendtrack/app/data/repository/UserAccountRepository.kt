package com.spendtrack.app.data.repository

import com.spendtrack.app.data.database.dao.UserAccountDao
import com.spendtrack.app.data.database.entity.AccountType
import com.spendtrack.app.data.database.entity.UserAccountEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class UserAccountRepository(
    private val userAccountDao: UserAccountDao
) {
    val allAccounts: Flow<List<UserAccountEntity>> = userAccountDao.getAllAccounts()

    suspend fun addAccount(
        bankName: String,
        last4: String,
        accountType: AccountType,
        nickname: String? = null
    ): Long {
        val entity = UserAccountEntity(
            id = UUID.randomUUID().toString(),
            bankName = bankName.trim(),
            accountLast4 = last4.trim(),
            accountType = accountType,
            nickname = nickname?.trim()
        )
        return userAccountDao.insertAccount(entity)
    }

    suspend fun deleteAccount(id: String) {
        userAccountDao.deleteById(id)
    }

    suspend fun isUserAccount(last4: String): Boolean {
        return userAccountDao.isUserAccount(last4) > 0
    }

    suspend fun getAllAccountsSync(): List<UserAccountEntity> {
        return userAccountDao.getAllAccountsSync()
    }
}
