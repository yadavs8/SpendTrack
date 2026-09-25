package com.spendtrack.app.data.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase
import com.spendtrack.app.data.database.converters.Converters
import com.spendtrack.app.data.database.dao.CategoryDao
import com.spendtrack.app.data.database.dao.MerchantRuleDao
import com.spendtrack.app.data.database.dao.TransactionDao
import com.spendtrack.app.data.database.dao.TemplateRuleDao
import com.spendtrack.app.data.database.dao.UserAccountDao
import com.spendtrack.app.data.database.entity.CategoryEntity
import com.spendtrack.app.data.database.entity.MerchantRuleEntity
import com.spendtrack.app.data.database.entity.TemplateRuleEntity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.database.entity.UserAccountEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        TransactionEntity::class,
        CategoryEntity::class,
        MerchantRuleEntity::class,
        UserAccountEntity::class,
        TemplateRuleEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun transactionDao(): TransactionDao
    abstract fun categoryDao(): CategoryDao
    abstract fun merchantRuleDao(): MerchantRuleDao
    abstract fun userAccountDao(): UserAccountDao
    abstract fun templateRuleDao(): TemplateRuleDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "spendtrack_database"
                )
                    .addCallback(DatabaseCallback())
                    .fallbackToDestructiveMigration(false)
                    .build()
                INSTANCE = instance
                instance
            }
        }

        val DEFAULT_CATEGORIES = listOf(
            CategoryEntity(
                id = "cat_food",
                name = "Food & Dining",
                iconName = "restaurant",
                colorHex = "#FF7043",
                isDefault = true,
                displayOrder = 1
            ),
            CategoryEntity(
                id = "cat_transport",
                name = "Transport",
                iconName = "directions_car",
                colorHex = "#42A5F5",
                isDefault = true,
                displayOrder = 2
            ),
            CategoryEntity(
                id = "cat_shopping",
                name = "Shopping",
                iconName = "shopping_bag",
                colorHex = "#AB47BC",
                isDefault = true,
                displayOrder = 3
            ),
            CategoryEntity(
                id = "cat_bills",
                name = "Bills & Utilities",
                iconName = "receipt_long",
                colorHex = "#FFA726",
                isDefault = true,
                displayOrder = 4
            ),
            CategoryEntity(
                id = "cat_entertainment",
                name = "Entertainment",
                iconName = "movie",
                colorHex = "#EC407A",
                isDefault = true,
                displayOrder = 5
            ),
            CategoryEntity(
                id = "cat_health",
                name = "Health",
                iconName = "medical_services",
                colorHex = "#26A69A",
                isDefault = true,
                displayOrder = 6
            ),
            CategoryEntity(
                id = "cat_personal",
                name = "Personal",
                iconName = "person",
                colorHex = "#7E57C2",
                isDefault = true,
                displayOrder = 7
            ),
            CategoryEntity(
                id = "cat_home",
                name = "Home",
                iconName = "home",
                colorHex = "#8D6E63",
                isDefault = true,
                displayOrder = 8
            ),
            CategoryEntity(
                id = "cat_travel",
                name = "Travel",
                iconName = "flight",
                colorHex = "#29B6F6",
                isDefault = true,
                displayOrder = 9
            ),
            CategoryEntity(
                id = "cat_financial",
                name = "Financial",
                iconName = "account_balance",
                colorHex = "#78909C",
                isDefault = true,
                displayOrder = 10
            ),
            CategoryEntity(
                id = "cat_other",
                name = "Other",
                iconName = "more_horiz",
                colorHex = "#9E9E9E",
                isDefault = true,
                displayOrder = 11
            )
        )

        private class DatabaseCallback : Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                super.onCreate(db)
                INSTANCE?.let { database ->
                    CoroutineScope(Dispatchers.IO).launch {
                        database.categoryDao().insertCategories(DEFAULT_CATEGORIES)
                    }
                }
            }
        }
    }
}
