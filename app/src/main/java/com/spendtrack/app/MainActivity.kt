package com.spendtrack.app

import android.Manifest
import android.content.Intent
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
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.spendtrack.app.core.security.BiometricAuthManager
import com.spendtrack.app.core.sms.SmsBackfillManager
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.ui.screens.settings.SettingsScreen
import com.spendtrack.app.ui.screens.settings.SettingsViewModel
import com.spendtrack.app.ui.screens.webview.KharchaWebViewScreen
import com.spendtrack.app.ui.theme.SpendTrackTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : FragmentActivity() {

    private var activeWebView: WebView? = null

    // v155: "What did you buy?" from the Amazon Pay notification: handed to the page once it is ready.
    private var pendingWalletJs: String? = null
    private val walletHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private fun deliverWalletPrompt(attempt: Int = 0) {
        val js = pendingWalletJs ?: return
        val wv = activeWebView
        if (wv == null) { if (attempt < 30) walletHandler.postDelayed({ deliverWalletPrompt(attempt + 1) }, 1000); return }
        wv.evaluateJavascript(js) { res ->
            if (res == "true") pendingWalletJs = null
            else if (attempt < 30) walletHandler.postDelayed({ deliverWalletPrompt(attempt + 1) }, 1000)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        com.spendtrack.app.core.automation.WalletPrompt.jsFor(intent)?.let { pendingWalletJs = it; deliverWalletPrompt() }
    }

    // Fingerprint lock: asked when the app opens and again after a minute away. Kept here (not in
    // Compose) so onStart can lock again; the page underneath stays loaded while the lock is shown.
    private var isUnlocked by mutableStateOf(false)
    private var everUnlocked by mutableStateOf(false)
    private var backgroundedAt = 0L

    override fun onStop() {
        super.onStop()
        backgroundedAt = android.os.SystemClock.elapsedRealtime()
    }

    override fun onStart() {
        super.onStart()
        if (backgroundedAt > 0 && android.os.SystemClock.elapsedRealtime() - backgroundedAt > RELOCK_AFTER_MS) {
            isUnlocked = false
        }
    }

    override fun onResume() {
        super.onResume()
        deliverWalletPrompt()
        // If app comes to foreground, tell the web view to reload recent data instantly
        activeWebView?.evaluateJavascript(
            "if (typeof refreshData === 'function') { refreshData(); }",
            null
        )
        // Background backfill for missed SMS and self-healing auto-route for investments.
        // Everything here is best-effort housekeeping -- never let it crash the app that's just
        // come to the foreground, so it is all one guarded block, not individually-trusted calls.
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val repaired = ServiceLocator.transactionRepository.repairAndAutoRouteInvestments()
                val newEntries = SmsBackfillManager.backfillMissedSms(applicationContext) +
                    SmsBackfillManager.catchUpMonthIfDue(applicationContext)
                val answered = runCatching { com.spendtrack.app.core.notification.PromptReconciler.reconcileAll(applicationContext) }.getOrDefault(0)
                // ₹0 / WhatsApp-chat junk from older versions, and copies of one payment saved more than once.
                val tidied = runCatching { com.spendtrack.app.core.deduplication.DuplicateJanitor.run(applicationContext) }.getOrDefault(0)
                if (repaired > 0 || newEntries > 0 || answered > 0 || tidied > 0) {
                    ServiceLocator.cloudSyncRepository.syncPending()
                    withContext(Dispatchers.Main) {
                        activeWebView?.evaluateJavascript(
                            "if (typeof refreshData === 'function') { refreshData(); }",
                            null
                        )
                    }
                }
            } catch (e: Exception) {
                com.spendtrack.app.core.logger.SafeLogger.e("onResume housekeeping failed", e)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A crash last time takes priority over everything else -- checked before any Compose,
        // Room or ServiceLocator code runs, so a broken main screen can never hide this.
        if (CrashActivity.hasPendingCrash(this)) {
            startActivity(Intent(this, CrashActivity::class.java))
            finish()
            return
        }
        enableEdgeToEdge()
        pendingWalletJs = com.spendtrack.app.core.automation.WalletPrompt.jsFor(intent)

        setContent {
            SpendTrackTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // null until the setting has been read, so a locked app never flashes its data first.
                    val isBiometricEnabled by ServiceLocator.settingsManager.isBiometricEnabled
                        .collectAsState(initial = null)
                    val locked = isBiometricEnabled == true && !isUnlocked

                    LaunchedEffect(isBiometricEnabled) {
                        if (isBiometricEnabled == false) {
                            isUnlocked = true
                        }
                    }
                    LaunchedEffect(isUnlocked) { if (isUnlocked) everUnlocked = true }

                    val askFingerprint = {
                        BiometricAuthManager.authenticate(
                            activity = this@MainActivity,
                            title = "Unlock SpendTrack",
                            subtitle = "Use your fingerprint or phone screen lock",
                            onSuccess = { isUnlocked = true }
                        )
                    }

                    Box(modifier = Modifier.fillMaxSize()) {
                        // The page is created only after the first unlock, then kept underneath the lock
                        // screen, so locking again after a minute away does not reload it.
                        if (everUnlocked) {
                            MainApp(onWebViewAttached = { activeWebView = it })
                        }
                        if (locked) {
                            LaunchedEffect(Unit) { askFingerprint() }
                            Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                                LockScreen(onUnlockClick = { askFingerprint() })
                            }
                        }
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

/**
 * The whole app is now just SpendTrack (the web app) plus a settings gear that opens
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
            Box(Modifier.fillMaxSize().background(Color(0xFFF0F4F8)))
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
    val appContext = LocalContext.current.applicationContext

    // Request POST_NOTIFICATIONS (Android 13+) and SMS permissions (for sideload build) at launch.
    // Uses ActivityCompat directly with a fixed request code -- some OEM ROMs (OxygenOS/ColorOS)
    // enforce a 16-bit requestCode check.
    val activity = LocalContext.current as? android.app.Activity
    LaunchedEffect(Unit) {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        perms.add(Manifest.permission.RECEIVE_SMS)
        perms.add(Manifest.permission.READ_SMS)
        activity?.let {
            androidx.core.app.ActivityCompat.requestPermissions(
                it,
                perms.toTypedArray(),
                1001
            )
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
                            Icon(Icons.Default.ArrowBack, contentDescription = "Back to SpendTrack")
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
                .background(Color(0xFFF0F4F8)) // the page's own background: no flash before it paints
        ) {
            KharchaWebViewScreen(
                webViewRef = {
                    webView = it
                    onWebViewAttached(it)
                },
                onOpenSettings = { showSettings = true },
                onPageReady = { /* no-op */ },
                onSummary = { json ->
                    scope.launch {
                        ServiceLocator.settingsManager.saveWebSummary(json)
                        com.spendtrack.app.widget.KharchaWidget.refresh(appContext)
                        // Recurring bills the web detected -> phone reminders before they're due.
                        runCatching {
                            com.spendtrack.app.core.automation.AutomationRunner.onWebBills(org.json.JSONObject(json).optJSONArray("bills"))
                        }
                    }
                },
                modifier = Modifier.statusBarsPadding()
            )
            // Native Settings button: ALWAYS present, never removed or hidden by web page events.
            IconButton(
                onClick = { showSettings = true },
                // zIndex: ensures it floats clearly above the WebView
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(end = 12.dp, top = 6.dp)
                    .size(42.dp)
                    .zIndex(100f)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer)
            ) {
                Icon(
                    Icons.Default.Settings,
                    contentDescription = "App settings",
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(22.dp)
                )
            }
        }
    }
}

private const val RELOCK_AFTER_MS = 60_000L
