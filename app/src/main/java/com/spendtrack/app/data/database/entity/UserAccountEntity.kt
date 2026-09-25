package com.spendtrack.app.data.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

enum class AccountType {
    SAVINGS,
    CURRENT,
    CREDIT_CARD,
    WALLET
}

@Entity(
    tableName = "user_accounts",
    indices = [
        Index(value = ["accountLast4"])
    ]
)
data class UserAccountEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val bankName: String,
    val accountLast4: String,
    val accountType: AccountType = AccountType.SAVINGS,
    val nickname: String? = null,
    val isDefault: Boolean = false,
    val createdAt: Long = System.currentTimeMillis()
)
