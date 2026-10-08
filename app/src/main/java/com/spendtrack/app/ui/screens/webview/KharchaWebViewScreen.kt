package com.spendtrack.app.ui.screens.webview

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.spendtrack.app.core.logger.SafeLogger

/** The Kharcha Book Supabase-backed web app the whole UI now lives inside. */
const val KHARCHA_BOOK_URL = "https://yadavs8.github.io/SpendTrack/web/kharcha-book/"
private const val KHARCHA_BOOK_ORIGIN = "https://yadavs8.github.io"

/**
 * Hosts Kharcha Book as the app's entire UI. The detection/categorize/sync engine keeps running
 * in the background; this screen is the window onto the same web app you'd open in a browser.
 *
 * The page talks back through `window.KharchaNative` (only when it is Kharcha Book itself):
 * opening the native Settings from its own header button, and reporting the month summary the
 * home-screen widget shows.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
fun KharchaWebViewScreen(
    webViewRef: (WebView?) -> Unit,
    onOpenSettings: () -> Unit,
    onPageReady: (Boolean) -> Unit,
    onSummary: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    val openSettings by rememberUpdatedState(onOpenSettings)
    val pageReady by rememberUpdatedState(onPageReady)
    val summary by rememberUpdatedState(onSummary)

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
                setBackgroundColor(0xFFF0F4F8.toInt()) // page --bg, so there's no flash before it paints
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                if (com.spendtrack.app.BuildConfig.DEBUG) {
                    WebView.setWebContentsDebuggingEnabled(true)
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                            SafeLogger.i("WebConsole [${message.messageLevel()}] ${message.message()}")
                            return true
                        }
                    }
                }

                val main = Handler(Looper.getMainLooper())
                val view = this
                addJavascriptInterface(object {
                    private fun fromKharcha(): Boolean = view.url?.startsWith(KHARCHA_BOOK_ORIGIN) == true

                    @JavascriptInterface
                    fun openSettings() {
                        main.post { if (fromKharcha()) openSettings() }
                    }

                    @JavascriptInterface
                    fun reportSummary(json: String?) {
                        if (json.isNullOrBlank() || json.length > 4000) return
                        main.post { if (fromKharcha()) summary(json) }
                    }
                }, "KharchaNative")

                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                        SafeLogger.e("WebView load error ($errorCode): $description")
                        pageReady(false)
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        pageReady(url?.startsWith(KHARCHA_BOOK_ORIGIN) == true)
                    }
                }
                loadUrl(KHARCHA_BOOK_URL)
                webView = this
                webViewRef(this)
            }
        }
    )
}
