package com.spendtrack.app.core.automation

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.spendtrack.app.MainActivity
import com.spendtrack.app.core.logger.SafeLogger
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.data.di.ServiceLocator
import java.util.concurrent.TimeUnit

/**
 * v155: a card payment "on AMAZON PAY WALL" only loads the Amazon Pay balance; the Blinkit / Amazon order it paid for
 * is the spending, and Amazon's own message about it (an email) often never reaches the phone. So the order went
 * unlogged (18 Nov 2026: Blinkit ₹2,294, of which the card paid ₹2,089.90).
 * Ten minutes after such a top-up, if no Amazon Pay purchase has been logged, ask: "What did you buy?".
 * The buttons open SpendTrack's own form (window.kharchaWalletPrompt), where the full order amount can be entered.
 */
object WalletPrompt {
    private val AMAZON_PAY_WALL = Regex("""(?i)amazon\s*pay\s*wal""")
    const val EXTRA_AMOUNT = "wallet_prompt_amount"
    const val EXTRA_TS = "wallet_prompt_ts"
    const val EXTRA_SHOP = "wallet_prompt_shop"

    fun isAmazonPayTopup(text: String): Boolean = AMAZON_PAY_WALL.containsMatchIn(text)

    /** Called for every bank message that was logged: schedules the check for Amazon Pay top-ups. */
    fun onLogged(context: Context, text: String, amount: Double, timestamp: Long) {
        if (!isAmazonPayTopup(text) || amount <= 0.0) return
        runCatching {
            val req = OneTimeWorkRequestBuilder<WalletPromptWorker>()
                .setInitialDelay(10, TimeUnit.MINUTES)
                .setInputData(workDataOf("amount" to amount, "ts" to timestamp))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("wallet_prompt_$timestamp", ExistingWorkPolicy.KEEP, req)
        }.onFailure { SafeLogger.e("WalletPrompt: could not schedule", it) }
    }

    fun openIntent(context: Context, amount: Double, ts: Long, shop: String?, requestCode: Int): PendingIntent {
        val i = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_AMOUNT, amount); putExtra(EXTRA_TS, ts); if (shop != null) putExtra(EXTRA_SHOP, shop)
        }
        return PendingIntent.getActivity(context, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** The JS call for the page, or null when the intent is not a wallet prompt. */
    fun jsFor(intent: Intent?): String? {
        val amount = intent?.getDoubleExtra(EXTRA_AMOUNT, 0.0) ?: return null
        if (amount <= 0.0) return null
        val ts = intent.getLongExtra(EXTRA_TS, 0L)
        val shop = intent.getStringExtra(EXTRA_SHOP)?.replace(Regex("[^A-Za-z0-9 ]"), "") ?: ""
        return "(window.kharchaWalletPrompt ? window.kharchaWalletPrompt({amount:$amount,ts:$ts,shop:'$shop'}) : false)"
    }

    internal suspend fun check(context: Context, amount: Double, ts: Long) {
        val dao = ServiceLocator.database.transactionDao()
        val near = dao.findAmountNear(0.01, 1.0e9, ts - 15 * 60_000L, ts + 6 * 3_600_000L)
        val explained = near.any {
            !isAmazonPayTopup(it.description.orEmpty()) &&
                (it.paymentMethod == PaymentMethod.WALLET || it.merchantName.orEmpty().contains("Amazon Pay", ignoreCase = true))
        }
        if (explained) return
        val rupees = "₹" + String.format(java.util.Locale.ENGLISH, "%,.2f", amount).removeSuffix(".00")
        val id = 7600 + ((ts / 1000L) % 300L).toInt()
        AutomationNotifier.post(
            context, id,
            "👛 $rupees went into Amazon Pay. What did you buy?",
            "Amazon Pay doesn't tell your bank what you bought. Tap to log the order.",
            "$rupees went into Amazon Pay. Log the order so it counts as spending; if part was paid from your Amazon Pay " +
                "balance, enter the full order amount from the invoice.",
            actions = listOf(
                AutomationNotifier.Action("Blinkit", openIntent(context, amount, ts, "Blinkit", id * 10 + 1)),
                AutomationNotifier.Action("Amazon", openIntent(context, amount, ts, "Amazon", id * 10 + 2)),
                AutomationNotifier.Action("Other", openIntent(context, amount, ts, null, id * 10 + 3))
            ),
            contentIntent = openIntent(context, amount, ts, null, id * 10)
        )
    }
}

class WalletPromptWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        ServiceLocator.init(applicationContext)
        val amount = inputData.getDouble("amount", 0.0)
        val ts = inputData.getLong("ts", 0L)
        if (amount > 0.0 && ts > 0L) runCatching { WalletPrompt.check(applicationContext, amount, ts) }
            .onFailure { SafeLogger.e("WalletPrompt: check failed", it) }
        return Result.success()
    }
}
