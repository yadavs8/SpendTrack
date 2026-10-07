package com.spendtrack.app

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.spendtrack.app.core.security.BiometricAuthManager
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.ui.screens.settings.SettingsScreen
import com.spendtrack.app.ui.screens.settings.SettingsViewModel
import com.spendtrack.app.ui.screens.webview.KharchaWebViewScreen
import com.spendtrack.app.ui.theme.SpendTrackTheme
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {

    private var activeWebView: WebView? = null

    override fun onResume() {
        super.onResume()
        // If app comes to foreground, tell the web view to reload recent data instantly
        activeWebView?.evaluateJavascript(
            "if (typeof refreshData === 'function') { refreshData(); }",
            null
        )
    }

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
                        MainApp(onWebViewAttached = { activeWebView = it })
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
            text = "Kharcha Book is Locked",
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

/**
 * The whole app is now just Kharcha Book (the web app) plus a settings gear that opens
 * SpendTrack's native screens -- notification/SMS access, Cloud Sync sign-in, biometric lock --
 * none of which a web page can grant itself. Detection/categorize/sync keep running in the
 * background regardless of which of these two is on screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainApp(onWebViewAttached: (WebView?) -> Unit = {}) {
    // Persisted, so onboarding shows once -- not on every cold start. null = still reading DataStore.
    val isOnboarded by ServiceLocator.settingsManager.isOnboarded.collectAsState(initial = null)
    val scope = rememberCoroutineScope()

    when (isOnboarded) {
        null -> {
            Box(Modifier.fillMaxSize().background(Color(0xFF0B5D75)))
            return
        }
        false -> {
            com.spendtrack.app.ui.screens.onboarding.OnboardingScreen(
                onFinished = { scope.launch { ServiceLocator.settingsManager.setOnboarded() } }
            )
            return
        }
        true -> Unit
    }

    val settingsViewModel: SettingsViewModel = viewModel()
    var showSettings by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    // Request POST_NOTIFICATIONS permission on Android 13+. Uses ActivityCompat directly with a
    // fixed request code -- some OEM ROMs (observed on OxygenOS/ColorOS) enforce a stricter 16-bit
    // requestCode check than AndroidX's auto-generated codes from rememberLauncherForActivityResult
    // satisfy, crashing with "Can only use lower 16 bits for requestCode".
    val activity = LocalContext.current as? android.app.Activity
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity?.let {
                androidx.core.app.ActivityCompat.requestPermissions(
                    it,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
    }

    BackHandler(enabled = showSettings) { showSettings = false }
    BackHandler(enabled = !showSettings && webView?.canGoBack() == true) { webView?.goBack() }

    if (showSettings) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Settings") },
                    navigationIcon = {
                        IconButton(onClick = { showSettings = false }) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Back to Kharcha Book")
                        }
                    }
                )
            }
        ) { padding ->
            SettingsScreen(viewModel = settingsViewModel, modifier = Modifier.padding(padding))
        }
    } else {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0B5D75)) // Kharcha Book's --hero-bg: no flash before the page paints
        ) {
            KharchaWebViewScreen(
                webViewRef = {
                    webView = it
                    onWebViewAttached(it)
                },
                modifier = Modifier.statusBarsPadding()
            )
            IconButton(
                onClick = { showSettings = true },
                // zIndex is required here: an embedded AndroidView (the WebView) can otherwise
                // render above sibling Compose content regardless of composition order.
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(12.dp)
                    .zIndex(10f)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer)
            ) {
                Icon(
                    Icons.Default.Settings,
                    contentDescription = "App settings",
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }
    }
}
