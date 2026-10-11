package com.spendtrack.app.core.automation

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.spendtrack.app.MainActivity

/**
 * Budget alerts, bill reminders, cash and settle-up nudges, weekly summaries and "income logged"
 * notes. A separate channel from the "where should this go?" prompts, so either can be muted alone.
 */
object AutomationNotifier {

    const val CHANNEL_ID = "kharcha_insights"

    data class Action(val title: String, val intent: PendingIntent)

    fun post(context: Context, id: Int, title: String, text: String, bigText: String? = null,
             actions: List<Action> = emptyList(), contentIntent: PendingIntent? = null, silent: Boolean = false) {
        ensureChannel(context)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.spendtrack.app.R.drawable.ic_notification)
            .setColor(0xFF0B5D75.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText ?: text))
            .setContentIntent(contentIntent ?: openApp(context, id))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setSilent(silent)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        actions.take(3).forEach { builder.addAction(0, it.title, it.intent) }
        runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
    }

    fun openApp(context: Context, requestCode: Int): PendingIntent = PendingIntent.getActivity(
        context, requestCode,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    /** Opens WhatsApp with [message] ready to send (the user picks the chat). */
    fun whatsApp(context: Context, requestCode: Int, message: String): PendingIntent {
        val uri = Uri.parse("https://wa.me/?text=" + Uri.encode(message))
        val installed = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull {
            runCatching { context.packageManager.getPackageInfo(it, 0) }.isSuccess
        }
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            if (installed != null) setPackage(installed)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun activity(context: Context, requestCode: Int, intent: Intent): PendingIntent =
        PendingIntent.getActivity(context, requestCode, intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun broadcast(context: Context, requestCode: Int, intent: Intent): PendingIntent =
        PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Insights & reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Budget alerts, bill and card due dates, cash and settle-up reminders, weekly summary, income logged"
            }
        )
    }
}
