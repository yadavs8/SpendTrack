package com.spendtrack.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.spendtrack.app.core.security.BiometricAuthManager
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.ui.navigation.Screen
import com.spendtrack.app.ui.screens.analytics.AnalyticsScreen
import com.spendtrack.app.ui.screens.analytics.AnalyticsViewModel
import com.spendtrack.app.ui.screens.home.HomeScreen
import com.spendtrack.app.ui.screens.home.HomeViewModel
import com.spendtrack.app.ui.screens.onboarding.OnboardingScreen
import com.spendtrack.app.ui.screens.settings.SettingsScreen
import com.spendtrack.app.ui.screens.settings.SettingsViewModel
import com.spendtrack.app.ui.screens.transactions.TransactionsScreen
import com.spendtrack.app.ui.screens.transactions.TransactionsViewModel
import com.spendtrack.app.ui.theme.SpendTrackTheme

class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            SpendTrackTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val isBiometricEnabled by ServiceLocator.settingsManager.isBiometricEnabled
                        .collectAsState(initial = false)
                    var isUnlocked by remember { mutableStateOf(false) }

                    LaunchedEffect(isBiometricEnabled) {
                        if (!isBiometricEnabled) {
                            isUnlocked = true
                        }
                    }

                    if (isBiometricEnabled && !isUnlocked) {
                        LaunchedEffect(Unit) {
                            BiometricAuthManager.authenticate(
                                activity = this@MainActivity,
                                onSuccess = { isUnlocked = true }
                            )
                        }

                        LockScreen(
                            onUnlockClick = {
                                BiometricAuthManager.authenticate(
                                    activity = this@MainActivity,
                                    onSuccess = { isUnlocked = true }
                                )
                            }
                        )
                    } else {
                        MainApp()
                    }
                }
            }
        }
    }
}

@Composable
fun LockScreen(onUnlockClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = "Locked",
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "SpendTrack is Locked",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Biometric or device screen lock is required to view your financial transactions.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onUnlockClick,
            shape = CircleShape,
            modifier = Modifier.height(50.dp)
        ) {
            Icon(Icons.Default.Fingerprint, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Unlock App", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun MainApp() {
    var isOnboarded by remember { mutableStateOf(false) }

    if (!isOnboarded) {
        OnboardingScreen(onFinished = { isOnboarded = true })
        return
    }

    var currentScreen by remember { mutableStateOf<Screen>(Screen.Home) }

    // ViewModels
    val homeViewModel: HomeViewModel = viewModel()
    val transactionsViewModel: TransactionsViewModel = viewModel()
    val analyticsViewModel: AnalyticsViewModel = viewModel()
    val settingsViewModel: SettingsViewModel = viewModel()

    // Request POST_NOTIFICATIONS permission on Android 13+
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { _ -> }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                Screen.items.forEach { screen ->
                    NavigationBarItem(
                        icon = { Icon(screen.icon, contentDescription = screen.title) },
                        label = { Text(screen.title) },
                        selected = currentScreen == screen,
                        onClick = { currentScreen = screen }
                    )
                }
            }
        }
    ) { innerPadding ->
        val modifier = Modifier.padding(innerPadding)
        when (currentScreen) {
            Screen.Home -> HomeScreen(
                viewModel = homeViewModel,
                onNavigateToTransactions = { currentScreen = Screen.Transactions },
                modifier = modifier
            )
            Screen.Transactions -> TransactionsScreen(
                viewModel = transactionsViewModel,
                modifier = modifier
            )
            Screen.Analytics -> AnalyticsScreen(
                viewModel = analyticsViewModel,
                modifier = modifier
            )
            Screen.Settings -> SettingsScreen(
                viewModel = settingsViewModel,
                modifier = modifier
            )
        }
    }
}
