package com.spendtrack.app.ui.screens.webview

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/** The Kharcha Book Supabase-backed web app the whole UI now lives inside. */
const val KHARCHA_BOOK_URL = "https://yadavs8.github.io/SpendTrack/web/kharcha-book/"

/**
 * Hosts Kharcha Book as the app's entire UI. SpendTrack's own detection/categorize/sync engine
 * keeps running invisibly in the background (notification listener, SMS receiver, WorkManager
 * nudges) -- this screen is just the window onto the same web app you'd open in a browser.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun KharchaWebViewScreen(
    webViewRef: (WebView?) -> Unit,
    modifier: Modifier = Modifier
) {
    var webView by remember { mutableStateOf<WebView?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            webView?.destroy()
            webViewRef(null)
        }
    }

    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.databaseEnabled = true
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                webViewClient = WebViewClient()
                loadUrl(KHARCHA_BOOK_URL)
                webView = this
                webViewRef(this)
            }
        }
    )
}
