package com.spendtrack.app.data.database.converters

import androidx.room.TypeConverter
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType

class Converters {
    @TypeConverter
    fun fromTransactionType(value: TransactionType?): String {
        return value?.name ?: TransactionType.EXPENSE.name
    }

    @TypeConverter
    fun toTransactionType(value: String?): TransactionType {
        return try {
            if (value != null) TransactionType.valueOf(value) else TransactionType.EXPENSE
        } catch (e: Exception) {
            TransactionType.EXPENSE
        }
    }

    @TypeConverter
    fun fromPaymentMethod(value: PaymentMethod?): String {
        return value?.name ?: PaymentMethod.UPI.name
    }

    @TypeConverter
    fun toPaymentMethod(value: String?): PaymentMethod {
        return try {
            if (value != null) PaymentMethod.valueOf(value) else PaymentMethod.UPI
        } catch (e: Exception) {
            PaymentMethod.UPI
        }
    }

    @TypeConverter
    fun fromAccountType(value: com.spendtrack.app.data.database.entity.AccountType?): String {
        return value?.name ?: com.spendtrack.app.data.database.entity.AccountType.SAVINGS.name
    }

    @TypeConverter
    fun toAccountType(value: String?): com.spendtrack.app.data.database.entity.AccountType {
        return try {
            if (value != null) com.spendtrack.app.data.database.entity.AccountType.valueOf(value) else com.spendtrack.app.data.database.entity.AccountType.SAVINGS
        } catch (e: Exception) {
            com.spendtrack.app.data.database.entity.AccountType.SAVINGS
        }
    }
}
