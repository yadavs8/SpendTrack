package com.spendtrack.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.spendtrack.app.MainActivity
import com.spendtrack.app.R
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.ui.log.LogExpenseActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Home-screen widget: this month's Kharcha Book total and forecast (as last reported by the page,
 * so web-only entries count too), how many payments still need a choice, and "+ Cash".
 */
object KharchaWidget {

    suspend fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, KharchaWidgetProvider::class.java))
        if (ids.isEmpty()) return
        ServiceLocator.init(context.applicationContext)

        val summary = ServiceLocator.settingsManager.webSummaryFlow.first()
        val pending = runCatching { ServiceLocator.transactionRepository.countAwaitingChoice() }.getOrDefault(0)

        val views = RemoteViews(context.packageName, R.layout.widget_kharcha)
        views.setTextViewText(R.id.widget_month, summary.optString("month").ifBlank { "This month" })
        views.setTextViewText(R.id.widget_total, summary.optString("spentLabel").ifBlank { "Open app to load" })
        val projected = summary.optString("projectedLabel")
        views.setTextViewText(R.id.widget_forecast, if (projected.isNotBlank()) "Month-end ≈ $projected" else "")
        if (pending > 0) {
            views.setViewVisibility(R.id.widget_pending, View.VISIBLE)
            views.setTextViewText(R.id.widget_pending, if (pending == 1) "1 payment needs a choice" else "$pending payments need a choice")
        } else {
            views.setViewVisibility(R.id.widget_pending, View.GONE)
        }

        views.setOnClickPendingIntent(
            R.id.widget_root,
            PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        )
        views.setOnClickPendingIntent(
            R.id.widget_add_cash,
            PendingIntent.getActivity(
                context, 1,
                LogExpenseActivity.cashIntent(context),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        )
        manager.updateAppWidget(ids, views)
    }

    /** Fire-and-forget refresh for callers that are not in a coroutine. */
    fun refreshAsync(context: Context) {
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch { runCatching { refresh(app) } }
    }
}

class KharchaWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try { KharchaWidget.refresh(context.applicationContext) } finally { pending.finish() }
        }
    }
}
