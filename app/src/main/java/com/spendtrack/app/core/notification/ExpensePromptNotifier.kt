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
    const val EXTRA_SCOPE = "expense_scope"
    const val EXTRA_TRIP_NAME = "trip_name"
    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val REMOTE_INPUT_KEY = "note_reply"

    const val SCOPE_PERSONAL = "personal"
    const val SCOPE_FAMILY = "family"
    const val SCOPE_INVESTMENT = "investment"
    const val SCOPE_TRIP = "trip"

    fun notificationIdFor(transactionId: String): Int = transactionId.hashCode()

    fun show(context: Context, transaction: TransactionEntity, activeTripName: String? = null) {
        ensureChannel(context)

        val notificationId = notificationIdFor(transaction.id)
        val amountLabel = "₹${if (transaction.amount % 1.0 == 0.0) transaction.amount.toInt().toString() else String.format(java.util.Locale.US, "%.2f", transaction.amount)}"
        val merchantLabel = transaction.merchantName?.takeIf { it.isNotBlank() }

        val contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_TRANSACTION_ID, transaction.id)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
                action = "com.spendtrack.app.ACTION_REVIEW_EXPENSE"
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_NOTIFICATION_DISMISSED
            putExtra(EXTRA_TRANSACTION_ID, transaction.id)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val deletePendingIntent = PendingIntent.getBroadcast(
            context,
            (transaction.id + "_dismiss").hashCode(),
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (merchantLabel != null) "$amountLabel at $merchantLabel" else "$amountLabel spent"
        val subtitle = if (!activeTripName.isNullOrBlank()) "✈️ Active Trip: $activeTripName" else "Personal, Family, or Investment?"
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(subtitle)
            .setContentIntent(contentIntent)
            .setDeleteIntent(deletePendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)

        if (!activeTripName.isNullOrBlank()) {
            // Prominent Trip button as first action!
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_TRIP, "✈️ $activeTripName", activeTripName))
        }

        // 1. "Personal" one-tap action
        builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))

        // 2. "Family" one-tap action
        builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_FAMILY, "🏠 Family"))

        // 3. "Investment" one-tap action
        builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_INVESTMENT, "📈 Investment"))

        // 4. "Add note" inline reply action
        builder.addAction(addNoteAction(context, transaction.id, notificationId))

        androidx.core.app.NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    fun dismiss(context: Context, transactionId: String) {
        androidx.core.app.NotificationManagerCompat.from(context).cancel(notificationIdFor(transactionId))
    }

    private fun scopeAction(
        context: Context,
        transactionId: String,
        notificationId: Int,
        scope: String,
        label: String,
        tripName: String? = null
    ): NotificationCompat.Action {
        val intent = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_SET_SCOPE
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_SCOPE, scope)
            if (tripName != null) {
                putExtra(EXTRA_TRIP_NAME, tripName)
            }
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            (transactionId + "_" + scope).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Action.Builder(0, label, pendingIntent).build()
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
            .setLabel("Add note (e.g. Milk, Groceries)")
            .build()
        return NotificationCompat.Action.Builder(0, "Add Note", pendingIntent)
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
