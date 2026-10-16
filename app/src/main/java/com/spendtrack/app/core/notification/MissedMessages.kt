package com.spendtrack.app.core.notification

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.spendtrack.app.core.deduplication.DeduplicationEngine
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.CardBillParser
import com.spendtrack.app.core.parser.PaymentInstrumentClassifier
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.service.QuickActionReceiver
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject

/**
 * The safety net against silence. A bank message that clearly moves money (an amount plus "credited",
 * "debited", "dividend"...) but that the parser could not turn into a payment is never dropped quietly:
 * it is kept, the user gets a notification with the amount and two buttons -- "It's income" / "It's a
 * spend" -- and tapping one files it properly (a spend still asks where it should go).
 */
object MissedMessages {

    private const val PREFS = "kharcha_missed"
    private const val KEY_ITEMS = "items"
    private const val KEY_HANDLED = "handled"
    const val EXTRA_KIND = "missed_kind"
    const val KIND_INCOME = "income"
    const val KIND_EXPENSE = "expense"

    data class Item(val id: String, val ts: Long, val amount: Double, val sender: String?, val text: String)

    private val MONEY_WORDS = Regex("""(?i)\b(?:credited|debited|deposited|received|withdrawn|dividend|salary|interest|refund(?:ed)?|paid|sent|spent)\b""")
    private val ACCOUNT_WORDS = Regex("""(?i)\b(?:a/c|acct?|account|upi|neft|imps|rtgs|nach|ach|ecs|avl\s*bal|available\s*bal)\b""")
    private val CARD_BILL = Regex("""(?i)\bcredit\s*card\b|\bcard\s*bill\b""")

    /** True for a bank message that moves money, so silence about it would be wrong. */
    fun looksLikeMoney(text: String, sender: String? = null): Boolean {
        if (text.isBlank()) return false
        if (TransactionParser.isNonTransaction(text) || TransactionParser.isNotYetCompleted(text)) return false
        if (CardBillParser.parseStatement(text) != null) return false
        if (CARD_BILL.containsMatchIn(text)) return false
        val amount = TransactionParser.extractAmount(text) ?: return false
        if (amount <= 0) return false
        if (!MONEY_WORDS.containsMatchIn(text)) return false
        return ACCOUNT_WORDS.containsMatchIn(text) || TransactionParser.looksLikeBankSms(text) || TransactionParser.looksLikeBankCreditSms(text) ||
            (sender != null && Regex("""(?i)bank|icici|hdfc|axis|sbi|kotak|pnb|bob|indus|paytm|cred""").containsMatchIn(sender))
    }

    private fun idOf(text: String): String = text.trim().replace(Regex("\\s+"), " ").hashCode().toString(16)

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): List<Item> = try {
        val arr = JSONArray(prefs(context).getString(KEY_ITEMS, "[]"))
        (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            Item(o.optString("id"), o.optLong("ts"), o.optDouble("amount"), o.optString("sender").takeIf { it.isNotBlank() }, o.optString("text"))
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun save(context: Context, items: List<Item>) {
        val arr = JSONArray()
        items.takeLast(30).forEach {
            arr.put(JSONObject().put("id", it.id).put("ts", it.ts).put("amount", it.amount).put("sender", it.sender ?: "").put("text", it.text.take(400)))
        }
        prefs(context).edit().putString(KEY_ITEMS, arr.toString()).apply()
    }

    private fun handled(context: Context): MutableSet<String> =
        (prefs(context).getString(KEY_HANDLED, "") ?: "").split(',').filter { it.isNotBlank() }.toMutableSet()

    private fun markHandled(context: Context, id: String) {
        val set = handled(context).also { it.add(id) }
        prefs(context).edit().putString(KEY_HANDLED, set.toList().takeLast(300).joinToString(",")).apply()
    }

    /**
     * Call when a message could not be parsed. Keeps it and (unless it is an old message found by a
     * catch-up scan) tells the user. A message already kept, or already answered, is not repeated.
     */
    fun noteIfMoney(context: Context, sender: String?, text: String, ts: Long, notify: Boolean = true) {
        try {
            if (!looksLikeMoney(text, sender)) return
            val id = idOf(text)
            if (id in handled(context)) return
            val items = load(context)
            if (items.any { it.id == id }) return
            val amount = TransactionParser.extractAmount(text) ?: return
            save(context, items + Item(id, ts, amount, sender, text))
            SafeLogger.i("Kept an unreadable bank message of ₹$amount for the user to file")
            if (notify) post(context, load(context).first { it.id == id })
        } catch (e: Exception) {
            SafeLogger.e("MissedMessages.noteIfMoney failed", e)
        }
    }

    private fun notificationId(id: String): Int = ("missed_$id").hashCode()

    private fun post(context: Context, item: Item) {
        val appContext = context.applicationContext
        val channel = ExpensePromptNotifier.CHANNEL_ID
        runCatching { ExpensePromptNotifier.ensureChannelPublic(appContext) }
        val nid = notificationId(item.id)
        fun action(kind: String, label: String): NotificationCompat.Action {
            val intent = Intent(appContext, QuickActionReceiver::class.java).apply {
                action = QuickActionReceiver.ACTION_LOG_MISSED
                putExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID, item.id)
                putExtra(EXTRA_KIND, kind)
                putExtra(ExpensePromptNotifier.EXTRA_NOTIFICATION_ID, nid)
            }
            val pi = PendingIntent.getBroadcast(appContext, ("missed_${item.id}_$kind").hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            return NotificationCompat.Action.Builder(0, label, pi).build()
        }
        val open = PendingIntent.getActivity(
            appContext, nid,
            Intent(appContext, com.spendtrack.app.MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(appContext, channel)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle("📩 ${ExpensePromptNotifier.amountLabel(item.amount)} — I couldn't read this bank message")
            .setContentText(item.text.take(100))
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.text.take(300) + "\n\nWhat is it?"))
            .setContentIntent(open)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .addAction(action(KIND_INCOME, "💰 It's income"))
            .addAction(action(KIND_EXPENSE, "💸 It's a spend"))
        runCatching { NotificationManagerCompat.from(appContext).notify(nid, builder.build()) }
    }

    /** Files a kept message as income or a spend, then forgets it. */
    suspend fun log(context: Context, id: String, asIncome: Boolean) {
        val appContext = context.applicationContext
        val item = load(appContext).firstOrNull { it.id == id }
        NotificationManagerCompat.from(appContext).cancel(notificationId(id))
        if (item == null) return
        val inst = PaymentInstrumentClassifier.classify(item.text, item.sender, null)
        val ref = TransactionParser.extractReference(item.text)
        val parsed = ParsedTransaction(
            amount = item.amount,
            merchantRaw = if (asIncome) "Received" else "Bank payment",
            paymentMethod = if (inst.method == PaymentMethod.OTHER) PaymentMethod.BANK_TRANSFER else inst.method,
            transactionType = if (asIncome) TransactionType.INCOME else TransactionType.EXPENSE,
            upiReference = ref,
            bankReference = ref,
            accountLast4 = inst.last4,
            bankName = inst.bank,
            dateTime = item.ts,
            source = "SMS",
            rawText = item.text,
            confidenceScore = if (asIncome) 0.95f else 0.6f,   // a spend still asks where it goes
            incomeKind = if (asIncome) "RECEIVED" else null
        )
        val result = ServiceLocator.transactionRepository.ingestTransaction(parsed)
        PromptReconciler.clearPaired(appContext)
        if (result is DeduplicationEngine.DeduplicationResult.NewTransaction) {
            val txn = result.transaction
            if (txn.transactionType == TransactionType.INCOME && !txn.isExcluded) {
                com.spendtrack.app.core.automation.AutomationRunner.onIncomeLogged(appContext, txn)
            } else {
                ExpensePromptNotifier.announce(
                    appContext, txn, ServiceLocator.settingsManager.activeTripNameFlow.first(),
                    duplicateOf = ServiceLocator.transactionRepository.duplicateCandidateFor(txn)
                )
            }
        }
        ServiceLocator.cloudSyncRepository.syncPending()
        markHandled(appContext, id)
        save(appContext, load(appContext).filter { it.id != id })
    }
}
