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
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "Where does this go?" prompt for an auto-detected expense. Exactly one notification per payment:
 * reminders re-post the same id, and answering turns that same notification into "✅ Logged…".
 *
 * Android shows at most 3 action buttons, so: the two likeliest answers plus "↔ Own transfer" (money
 * moved between your own accounts). Tapping the notification body opens [LogExpenseActivity] with every
 * destination (Family, Investment, Project, any trip, a new trip, a note, own transfer).
 */
object ExpensePromptNotifier {

    const val CHANNEL_ID = "spendtrack_review_channel"
    const val LOGGED_CHANNEL_ID = "spendtrack_logged_channel"
    const val EXTRA_TRANSACTION_ID = "transaction_id"
    const val EXTRA_CATEGORY_ID = "category_id"
    const val EXTRA_CATEGORY_NAME = "category_name"
    const val EXTRA_SCOPE = "expense_scope"
    const val EXTRA_TRIP_NAME = "trip_name"
    const val EXTRA_TRIP_ONLY = "trip_only"
    const val EXTRA_PROJECT_NAME = "project_name"
    const val EXTRA_PROJECT_ONLY = "project_only"
    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val REMOTE_INPUT_KEY = "note_reply"
    private const val SYNC_PROBLEM_ID = 0x5C0FF

    const val SCOPE_PERSONAL = "personal"
    const val SCOPE_FAMILY = "family"
    const val SCOPE_INVESTMENT = "investment"
    const val SCOPE_TRIP = "trip"
    const val SCOPE_PROJECT = "project"
    const val SCOPE_TRANSFER = "transfer"

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
            d.startsWith("🔨") -> scopeLabel(SCOPE_PROJECT, null, d.removePrefix("🔨").substringBefore(':').trim())
            d.startsWith("🔁") -> scopeLabel(SCOPE_TRANSFER, null)
            d.startsWith("✈") -> scopeLabel(SCOPE_TRIP, d.removePrefix("✈️").removePrefix("✈").substringBefore(':').trim())
            else -> scopeLabel(SCOPE_PERSONAL, null)
        }
    }

    fun scopeLabel(scope: String, tripName: String?, projectName: String? = null): String = when (scope) {
        SCOPE_FAMILY -> "🏠 Family"
        SCOPE_INVESTMENT -> "📈 Investment"
        SCOPE_PROJECT -> "🔨 ${projectName?.takeIf { it.isNotBlank() } ?: "Project"}"
        SCOPE_TRANSFER -> "🔁 Own transfer"
        SCOPE_TRIP -> "✈️ ${tripName?.takeIf { it.isNotBlank() } ?: "Trip"}"
        else -> "👤 Personal"
    }

    /**
     * Shows (or re-shows, for a reminder) the prompt asking: Personal, Family, Trips, or Projects?
     */
    fun show(
        context: Context,
        transaction: TransactionEntity,
        activeTripName: String? = null,
        isTripPaused: Boolean = false,
        activeProjectName: String? = null,
        isProjectPaused: Boolean = false,
        alert: Boolean = true,
        trips: List<String> = emptyList(),
        projects: List<String> = emptyList(),
        duplicateOf: TransactionEntity? = null
    ) {
        if (transaction.amount <= 0.0 || transaction.isExcluded) {
            dismiss(context, transaction.id)
            return
        }

        ensureChannel(context)

        val notificationId = notificationIdFor(transaction.id)
        if (duplicateOf != null && transaction.transactionType == com.spendtrack.app.core.model.TransactionType.EXPENSE) {
            showPossibleDuplicate(context, transaction, duplicateOf, notificationId, alert)
            return
        }
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        val title = if (merchant != null) "${amountLabel(transaction.amount)} at $merchant" else "${amountLabel(transaction.amount)} spent"

        val effectiveTrip = if (!isTripPaused && !activeTripName.isNullOrBlank()) activeTripName else null
        val effectiveProject = if (!isProjectPaused && !activeProjectName.isNullOrBlank()) activeProjectName else null

        val knownTrips = (
            listOfNotNull(activeTripName?.trim()?.takeIf { it.isNotBlank() }) +
                trips.mapNotNull { it.trim().takeIf { t -> t.isNotBlank() } }
            ).distinct()

        val knownProjects = (
            listOfNotNull(activeProjectName?.trim()?.takeIf { it.isNotBlank() }) +
                projects.mapNotNull { it.trim().takeIf { p -> p.isNotBlank() } }
            ).distinct()

        val question = when {
            effectiveTrip != null && effectiveProject != null ->
                "Both '$effectiveTrip' & '$effectiveProject' active. Where should this go?"
            effectiveTrip != null -> "Trip active: Personal, Family, or '$effectiveTrip'?"
            effectiveProject != null -> "Project active: Personal, Family, or '$effectiveProject'?"
            else -> "Where should this go? Personal, Family, or Trips/Projects?"
        }
        val text = "${whenLabel(transaction.dateTime)} · $question"

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pickerIntent(context, transaction.id, notificationId, tripOnly = false, projectOnly = false))
            .setDeleteIntent(dismissIntent(context, transaction.id, notificationId))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)

        // Android displays up to 3 action buttons: always provide Personal/Family/Trip and Discard
        if (effectiveTrip != null && effectiveProject != null) {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_TRIP, "✈️ $effectiveTrip", tripName = effectiveTrip))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
            builder.addAction(discardAction(context, transaction.id, notificationId))
        } else if (effectiveTrip != null) {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_TRIP, "✈️ $effectiveTrip", tripName = effectiveTrip))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
            builder.addAction(discardAction(context, transaction.id, notificationId))
        } else if (effectiveProject != null) {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PROJECT, "🔨 $effectiveProject", projectName = effectiveProject))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
            builder.addAction(discardAction(context, transaction.id, notificationId))
        } else {
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_PERSONAL, "👤 Personal"))
            builder.addAction(scopeAction(context, transaction.id, notificationId, SCOPE_FAMILY, "🏠 Family"))
            builder.addAction(discardAction(context, transaction.id, notificationId))
        }

        NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    /**
     * A payment that looks like one already logged (the bank SMS, then the insurer's receipt hours later).
     * Asks once, with the answer on the buttons, instead of silently dropping or double-counting it.
     */
    private fun showPossibleDuplicate(
        context: Context,
        transaction: TransactionEntity,
        earlier: TransactionEntity,
        notificationId: Int,
        alert: Boolean
    ) {
        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() && !it.equals("Unknown Merchant", ignoreCase = true) }
        val earlierWhat = earlier.merchantName?.takeIf { it.isNotBlank() && !it.equals("Unknown Merchant", ignoreCase = true) }
            ?.let { " at $it" } ?: ""
        val title = "${amountLabel(transaction.amount)}${if (merchant != null) " at $merchant" else ""} — logged already?"
        val text = "Looks like the ${amountLabel(earlier.amount)}$earlierWhat on ${whenLabel(earlier.dateTime)}. Same payment?"
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text\n\nThis message: ${whenLabel(transaction.dateTime)}"))
            .setContentIntent(pickerIntent(context, transaction.id, notificationId, tripOnly = false, projectOnly = false))
            .setDeleteIntent(dismissIntent(context, transaction.id, notificationId))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)
            .addAction(simpleAction(context, transaction.id, notificationId, QuickActionReceiver.ACTION_SAME_PAYMENT, "✅ Same payment"))
            .addAction(simpleAction(context, transaction.id, notificationId, QuickActionReceiver.ACTION_NOT_DUPLICATE, "➕ Different payment"))
            .addAction(discardAction(context, transaction.id, notificationId))
        NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    fun discardAction(context: Context, transactionId: String, notificationId: Int): NotificationCompat.Action =
        simpleAction(context, transactionId, notificationId, QuickActionReceiver.ACTION_DISCARD, "🚫 Discard")

    private fun simpleAction(context: Context, transactionId: String, notificationId: Int, action: String, label: String): NotificationCompat.Action {
        val intent = Intent(context, QuickActionReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            (transactionId + "_" + action).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Action.Builder(0, label, pendingIntent).build()
    }

    /** Brief silent note that a second copy was folded into the payment already logged. */
    fun showMerged(context: Context, kept: TransactionEntity) {
        ensureChannel(context)
        val notificationId = notificationIdFor(kept.id)
        val merchant = kept.merchantName?.takeIf { it.isNotBlank() && !it.equals("Unknown Merchant", ignoreCase = true) }
        val builder = NotificationCompat.Builder(context, LOGGED_CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("✅ Counted once")
            .setContentText("${amountLabel(kept.amount)}${if (merchant != null) " at $merchant" else ""} · ${whenLabel(kept.dateTime)}")
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(3000)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    /**
     * An expense that was filed without asking (a known payee like the milk vendor or the niece
     * allowance, an investment, a merchant answered the same way before). It replaces any prompt for
     * the same payment, says where it went, and tapping it opens the picker to move it.
     */
    fun showAutoLogged(context: Context, transaction: TransactionEntity) {
        ensureChannel(context)
        val label = labelForDescription(transaction.description)
        val what = transaction.description?.takeIf { it.isNotBlank() }?.let { stripLabelPrefix(it) }
            ?: transaction.merchantName?.takeIf { it.isNotBlank() }
        val notificationId = notificationIdFor(transaction.id)
        val builder = NotificationCompat.Builder(context, LOGGED_CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("🤖 Auto-logged under $label")
            .setContentText("${amountLabel(transaction.amount)}${if (what != null) " · $what" else ""} · ${whenLabel(transaction.dateTime)}")
            .setContentIntent(pickerIntent(context, transaction.id, notificationId, tripOnly = false))
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(4000)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        NotificationManagerCompat.from(context).notify(notificationId, builder.build())
    }

    private fun stripLabelPrefix(description: String): String =
        com.spendtrack.app.core.model.ExpenseScope.stripScope(description).take(60)

    /**
     * Call after a new payment was ingested: asks if it still needs an answer, otherwise announces
     * where it was filed. Nothing for transfers, income, refunds and cash withdrawals.
     */
    fun announce(
        context: Context,
        txn: TransactionEntity,
        activeTripName: String?,
        isTripPaused: Boolean = false,
        activeProjectName: String? = null,
        isProjectPaused: Boolean = false,
        trips: List<String> = emptyList(),
        projects: List<String> = emptyList(),
        duplicateOf: TransactionEntity? = null
    ) {
        if (txn.isExcluded || txn.transactionType != com.spendtrack.app.core.model.TransactionType.EXPENSE || txn.amount <= 0.0) return
        if (txn.needsReview) {
            show(
                context, txn,
                activeTripName = activeTripName,
                isTripPaused = isTripPaused,
                activeProjectName = activeProjectName,
                isProjectPaused = isProjectPaused,
                alert = true,
                trips = trips,
                projects = projects,
                duplicateOf = duplicateOf
            )
            com.spendtrack.app.core.nudge.NudgeScheduler.scheduleFirst(context, txn.id)
        } else if (txn.isEdited) {
            showAutoLogged(context, txn)
        }
    }

    /** Dismisses the active prompt immediately and shows a brief silent confirmation that auto-clears. */
    fun showLogged(context: Context, transaction: TransactionEntity, label: String) {
        ensureChannel(context)
        val notificationId = notificationIdFor(transaction.id)
        // Cancel the high-priority prompt first so its action buttons and ongoing state stop immediately.
        NotificationManagerCompat.from(context).cancel(notificationId)

        val merchant = transaction.merchantName?.takeIf { it.isNotBlank() }
        val what = if (merchant != null) "${amountLabel(transaction.amount)} at $merchant" else amountLabel(transaction.amount)
        val builder = NotificationCompat.Builder(context, LOGGED_CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("✅ Logged as $label")
            .setContentText("$what · ${whenLabel(transaction.dateTime)}")
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(2500)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        NotificationManagerCompat.from(context).notify(notificationId, builder.build())

        val appCtx = context.applicationContext
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
            kotlinx.coroutines.delay(2500)
            runCatching { NotificationManagerCompat.from(appCtx).cancel(notificationId) }
        }
    }

    /**
     * Shown when an expense was filed but could not reach Kharcha Book (e.g. the sync session was
     * signed out), so "✅ Logged" is never the last word on an expense that only exists on the phone.
     */
    fun showSyncProblem(context: Context, reason: String) {
        ensureChannel(context)
        val open = PendingIntent.getActivity(
            context,
            SYNC_PROBLEM_ID,
            Intent(context, com.spendtrack.app.MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("Saved on phone, not in Kharcha Book yet")
            .setContentText(reason)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$reason It will be sent automatically once this is fixed. Open SpendTrack → Settings → Cloud Sync."))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        NotificationManagerCompat.from(context).notify(SYNC_PROBLEM_ID, builder.build())
    }

    fun dismiss(context: Context, transactionId: String) {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(transactionId))
    }

    private fun pickerIntent(
        context: Context,
        transactionId: String,
        notificationId: Int,
        tripOnly: Boolean = false,
        projectOnly: Boolean = false
    ): PendingIntent =
        PendingIntent.getActivity(
            context,
            when {
                tripOnly -> (transactionId + "_trip_picker").hashCode()
                projectOnly -> (transactionId + "_proj_picker").hashCode()
                else -> notificationId
            },
            Intent(context, LogExpenseActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_TRANSACTION_ID, transactionId)
                putExtra(EXTRA_TRIP_ONLY, tripOnly)
                putExtra(EXTRA_PROJECT_ONLY, projectOnly)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun tripPickerAction(
        context: Context,
        transactionId: String,
        notificationId: Int,
        label: String
    ): NotificationCompat.Action =
        NotificationCompat.Action.Builder(
            0,
            label,
            pickerIntent(context, transactionId, notificationId, tripOnly = true)
        ).build()

    private fun projectPickerAction(
        context: Context,
        transactionId: String,
        notificationId: Int,
        label: String
    ): NotificationCompat.Action =
        NotificationCompat.Action.Builder(
            0,
            label,
            pickerIntent(context, transactionId, notificationId, projectOnly = true)
        ).build()

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
        tripName: String? = null,
        projectName: String? = null
    ): NotificationCompat.Action {
        val intent = Intent(context, QuickActionReceiver::class.java).apply {
            action = QuickActionReceiver.ACTION_SET_SCOPE
            putExtra(EXTRA_TRANSACTION_ID, transactionId)
            putExtra(EXTRA_SCOPE, scope)
            if (tripName != null) putExtra(EXTRA_TRIP_NAME, tripName)
            if (projectName != null) putExtra(EXTRA_PROJECT_NAME, projectName)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            (transactionId + "_" + scope + (tripName ?: "") + (projectName ?: "")).hashCode(),
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

    fun ensureChannelPublic(context: Context) = ensureChannel(context)

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
            val loggedChannel = NotificationChannel(
                LOGGED_CHANNEL_ID,
                "Logged Expense Confirmation",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Brief silent confirmation when an expense is logged."
                setSound(null, null)
                enableVibration(false)
            }
            manager.createNotificationChannel(channel)
            manager.createNotificationChannel(loggedChannel)
        }
    }
}
