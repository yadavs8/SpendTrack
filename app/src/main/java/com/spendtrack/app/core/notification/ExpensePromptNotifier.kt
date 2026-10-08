package com.spendtrack.app.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.service.QuickActionReceiver
import com.spendtrack.app.ui.log.LogExpenseActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "Where does this go?" prompt for an auto-detected expense. Exactly one notification per payment:
 * reminders re-post the same id, and answering turns that same notification into "✅ Logged…".
 *
 * Android shows at most 3 action buttons, so: the two likeliest answers plus "More…", which opens
 * [LogExpenseActivity] with every destination (Family, Investment, Project, any trip, a new trip,
 * a note). Tapping the notification body opens the same picker.
 */
object ExpensePromptNotifier {

    const val CHANNEL_ID = "spendtrack_review_channel"
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
    const val SCOPE_PROJECT = "project"

    fun notificationIdFor(transactionId: String): Int = transactionId.hashCode()

    fun amountLabel(amount: Double): String =
        "₹" + if (amount % 1.0 == 0.0) amount.toInt().toString() else String.format(Locale.US, "%.2f", amount)

    fun whenLabel(epochMillis: Long): String =
        SimpleDateFormat("d MMM, h:mm a", Locale("en", "IN")).format(Date(epochMillis))

    /** Reads the scope back from a filed description's prefix ("📈 Zerodha" -> "📈 Investment"). */
    fun labelForDescription(description: String?): String {
        val d = description?.trim().orEmpty()
        return when {
            d.startsWith("📈") -> scopeLabel(SCOPE_INVESTMENT, null)
            d.startsWith("🏠") -> scopeLabel(SCOPE_FAMILY, null)
            d.startsWith("🔨") -> scopeLabel(SCOPE_PROJECT, null)
            d.startsWith("✈") -> scopeLabel(SCOPE_TRIP, d.removePrefix("✈️").removePrefix("✈").substringBefore(':').trim())
            else -> scopeLabel(SCOPE_PERSONAL, null)
        }
    }

    fun scopeLabel(scope: String, tripName: String?): String = when (scope) {
        SCOPE_FAMILY -> "🏠 Family"
        SCOPE_INVESTMENT -> "📈 Investment"
        SCOPE_PROJECT -> "🔨 Project"
        SCOPE_TRIP -> "✈️ ${tripName?.takeIf { it.isNotBlank() } ?: "Trip"}"
        else -> "👤 Personal"
    }

    /**
     * Shows (or re-shows, for a reminder) the prompt. [alert] = false updates it silently, so a
     * duplicate copy of the same payment never makes the phone ring twice.
     */
    fun show(context: Context, transaction: TransactionEntity, activeTripName: String? = null, alert: Boolean = true) {
        ensureChannel(context)

        val notificationId = notificationIdFor(transaction.id)
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        val title = if (merchant != null) "${amountLabel(transaction.amount)} at $merchant" else "${amountLabel(transaction.amount)} spent"
        val trip = activeTripName?.takeIf { it.isNotBlank() }
        val question = if (trip != null) "Trip expense, or something else?" else "Where should this go?"
        val text = "${whenLabel(transaction.dateTime)} · $question"

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pickerIntent(context, transaction.id, notificationId))
            .setDeleteIntent(dismissIntent(context, transaction.id, notificationId))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(false)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)

        if (trip != null) {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_TRIP, "✈️ $trip", trip))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
        } else {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_FAMILY, "🏠 Family"))
        }
        builder.addAction(NotificationCompat.Action.Builder(0, "More…", pickerIntent(context, transaction.id, notificationId)).build())

        NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    /** Replaces the prompt with a silent confirmation that disappears on its own. */
    fun showLogged(context: Context, transaction: TransactionEntity, label: String) {
        ensureChannel(context)
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        val what = if (merchant != null) "${amountLabel(transaction.amount)} at $merchant" else amountLabel(transaction.amount)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("✅ Logged as $label")
            .setContentText("$what · ${whenLabel(transaction.dateTime)}")
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(4000)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        NotificationManagerCompat.from(context).notify(notificationIdFor(transaction.id), builder.build())
    }

    fun dismiss(context: Context, transactionId: String) {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(transactionId))
    }

    private fun pickerIntent(context: Context, transactionId: String, notificationId: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, LogExpenseActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_TRANSACTION_ID, transactionId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun dismissIntent(context: Context, transactionId: String, notificationId: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            (transactionId + "_dismiss").hashCode(),
            Intent(context, QuickActionReceiver::class.java).apply {
                action = QuickActionReceiver.ACTION_NOTIFICATION_DISMISSED
                putExtra(EXTRA_TRANSACTION_ID, transactionId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

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
            if (tripName != null) putExtra(EXTRA_TRIP_NAME, tripName)
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

    /** Kept for older notifications still in the shade that carry the inline-reply action. */
    @Suppress("unused")
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
        val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel("Add note").build()
        return NotificationCompat.Action.Builder(0, "Add Note", pendingIntent).addRemoteInput(remoteInput).build()
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Categorize Expenses",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Asks where an auto-detected expense belongs, and reminds you until you answer."
            }
            manager.createNotificationChannel(channel)
        }
    }
}
