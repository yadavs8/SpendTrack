package com.spendtrack.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Home : Screen("home", "Home", Icons.Default.Home)
    object Transactions : Screen("transactions", "Transactions", Icons.Default.ReceiptLong)
    object Analytics : Screen("analytics", "Analytics", Icons.Default.Analytics)
    object Settings : Screen("settings", "Settings", Icons.Default.Settings)

    companion object {
        // Lazy: avoids a JVM/ART class-initialization-order crash where this list, built eagerly
        // at class-load time, could reference a sibling singleton (Home, Transactions, ...)
        // before its own <clinit> had run, yielding a null entry (NPE on screen.icon).
        val items: List<Screen> by lazy { listOf(Home, Transactions, Analytics, Settings) }
    }
}
