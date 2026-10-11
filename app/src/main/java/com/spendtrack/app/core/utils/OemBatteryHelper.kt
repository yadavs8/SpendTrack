package com.spendtrack.app.core.utils

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.spendtrack.app.service.SpendTrackNotificationListener

object OemBatteryHelper {

    val manufacturer: String = Build.MANUFACTURER.lowercase()

    val isAggressiveOem: Boolean = manufacturer in listOf(
        "xiaomi", "redmi", "poco",
        "vivo", "iqoo",
        "oppo", "realme", "oneplus",
        "samsung", "huawei", "honor"
    )

    data class OemGuidance(
        val title: String,
        val steps: List<String>,
        val intent: Intent? = null
    )

    fun getGuidance(context: Context): OemGuidance {
        return when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                OemGuidance(
                    title = "Xiaomi / MIUI / HyperOS Setup",
                    steps = listOf(
                        "1. Open Settings -> Apps -> Manage Apps -> Kharcha Book.",
                        "2. Enable 'Autostart'.",
                        "3. Tap 'Battery saver' and select 'No restrictions'.",
                        "4. Lock Kharcha Book in the Recent Apps tray."
                    )
                )
            }
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> {
                OemGuidance(
                    title = "Vivo / FuntouchOS Setup",
                    steps = listOf(
                        "1. Open Settings -> Battery -> Background power consumption management.",
                        "2. Find Kharcha Book and select 'Allow high background power consumption'.",
                        "3. In Settings -> Apps -> Kharcha Book, enable 'Autostart'."
                    )
                )
            }
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> {
                OemGuidance(
                    title = "Oppo / Realme / OnePlus Setup",
                    steps = listOf(
                        "1. Open Settings -> Apps -> App management -> Kharcha Book.",
                        "2. Tap 'Battery usage' and enable 'Allow background activity' and 'Allow auto-launch'.",
                        "3. Lock Kharcha Book in the Recent Apps screen."
                    )
                )
            }
            manufacturer.contains("samsung") -> {
                OemGuidance(
                    title = "Samsung One UI Setup",
                    steps = listOf(
                        "1. Open Settings -> Apps -> Kharcha Book -> Battery.",
                        "2. Select 'Unrestricted'.",
                        "3. Ensure Kharcha Book is NOT in 'Sleeping apps' or 'Deep sleeping apps'."
                    )
                )
            }
            else -> {
                OemGuidance(
                    title = "Battery Optimization Setup",
                    steps = listOf(
                        "1. Open Settings -> Apps -> Kharcha Book -> Battery.",
                        "2. Set Battery usage to 'Unrestricted' so Android does not stop transaction detection."
                    )
                )
            }
        }
    }

    /**
     * Rebinds the NotificationListenerService if dropped by the system.
     */
    fun requestServiceRebind(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val componentName = ComponentName(context, SpendTrackNotificationListener::class.java)
            android.service.notification.NotificationListenerService.requestRebind(componentName)
        }
    }
}
