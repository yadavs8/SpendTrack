package com.spendtrack.app.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.spendtrack.app.MainActivity
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.service.QuickActionReceiver

/**
 * "What's this for?" prompt shown the moment an auto-detected expense can't be confidently
 * categorized. Lets the user resolve it with one tap (quick category) or a typed note, both from
 * the notification shade -- never requires opening the app.
 */
object ExpensePromptNotifier {

    private const val CHANNEL_ID = "spendtrack_review_channel"
    const val EXTRA_TRANSACTION_ID = "transaction_id"
    const val EXTRA_CATEGORY_ID = "category_id"
    const val EXTRA_CATEGORY_NAME = "category_name"
    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val REMOTE_INPUT_KEY = "note_reply"

    /** Default, always-present categories (see AppDatabase.DEFAULT_CATEGORIES) offered as one-tap picks. */
    private val QUICK_CATEGORIES = listOf(
        "cat_food" to "Food & Dining",
        "cat_transport" to "Transport",
        "cat_shopping" to "Shopping"
    )

    fun notificationIdFor(transactionId: String): Int = transactionId.hashCode()

    fun show(context: Context, transaction: TransactionEntity) {
        ensureChannel(context)

        val notificationId = notificationIdFor(transaction.id)
        val amountLabel = "₹${transaction.amount.toInt()}"
        val merchantLabel = transaction.merchantName?.takeIf { it.isNotBlank() }

        val contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle(if (merchantLabel != null) "$amountLabel at $merchantLabel — what's this for?" else "$amountLabel spent — what's this for?")
            .setContentText("Tap a category, or reply with a note")
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)

        QUICK_CATEGORIES.forEach { (categoryId, categoryName) ->
            builder.addAction(quickCategoryAction(context, transaction.id, notificationId, categoryId, categoryName))
        }
        builder.addAction(addNoteAction(context, transaction.id, notificationId))

        androidx.core.app.NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    fun dismiss(context: Context, transactionId: String) {
        androidx.core.app.NotificationManagerCompat.from(context).cancel(notificationIdFor(transactionId))
    }

    private fun quickCategoryAction(
        context: Context,
        transactionId: String,
        notificationId: Int,
        categoryId: String,
        categoryName: String
    ): NotificationCompat.Action {
        val intent = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_QUICK_CATEGORIZE
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_CATEGORY_ID, categoryId)
            putExtra(EXTRA_CATEGORY_NAME, categoryName)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            (transactionId + categoryId).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Action.Builder(0, categoryName, pendingIntent).build()
    }

    private fun addNoteAction(context: Context, transactionId: String, notificationId: Int): NotificationCompat.Action {
        val intent = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_ADD_NOTE
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            (transactionId + "_note").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY)
            .setLabel("What was this for? (e.g. Milk, Vegetables)")
            .build()
        return NotificationCompat.Action.Builder(0, "Add note", pendingIntent)
            .addRemoteInput(remoteInput)
            .build()
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Categorize Expenses",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Asks what an auto-detected expense was for, and reminds you until you answer."
            }
            manager.createNotificationChannel(channel)
        }
    }
}
