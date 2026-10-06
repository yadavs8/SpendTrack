package com.spendtrack.app.ui.screens.webview

import android.annotation.SuppressLint
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import com.spendtrack.app.core.logger.SafeLogger
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
                if (com.spendtrack.app.BuildConfig.DEBUG) {
                    WebView.setWebContentsDebuggingEnabled(true)
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                            SafeLogger.i("WebConsole [${message.messageLevel()}] ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                            return true
                        }
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(
                        view: WebView,
                        errorCode: Int,
                        description: String?,
                        failingUrl: String?
                    ) {
                        SafeLogger.e("WebView load error ($errorCode) on $failingUrl: $description")
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        SafeLogger.i("WebView page finished: $url")
                        if (com.spendtrack.app.BuildConfig.DEBUG) {
                            view.evaluateJavascript(
                                """
                                (function(){
                                  console.log('DIAG navigator.onLine=' + navigator.onLine);
                                  try {
                                    var raw = Object.keys(localStorage).filter(function(k){return k.indexOf('supabase')>=0 || k.indexOf('sb-')===0});
                                    console.log('DIAG localStorage supabase keys=' + JSON.stringify(raw));
                                  } catch(e) { console.log('DIAG localStorage err=' + e); }
                                  fetch('${com.spendtrack.app.core.network.SupabaseConfig.SUPABASE_URL}/auth/v1/health', {
                                    headers: {apikey: '${com.spendtrack.app.core.network.SupabaseConfig.SUPABASE_ANON_KEY}'}
                                  }).then(function(r){ return r.text().then(function(t){ console.log('DIAG fetch status=' + r.status + ' body=' + t); }); })
                                    .catch(function(e){ console.log('DIAG fetch error=' + e); });
                                })();
                                """.trimIndent(),
                                null
                            )
                        }
                    }
                }
                loadUrl(KHARCHA_BOOK_URL)
                webView = this
                webViewRef(this)
            }
        }
    )
}
