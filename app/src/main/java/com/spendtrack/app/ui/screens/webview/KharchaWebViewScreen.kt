package com.spendtrack.app.ui.screens.webview

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.widget.Toast
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

/**
 * Opens a link the WebView shouldn't handle itself: wa.me / whatsapp:// in WhatsApp, upi:// in a
 * UPI app (with a chooser), intent:// as the page asked, anything else in the browser.
 */
internal fun openExternally(context: Context, url: String) {
    // WhatsApp links go straight to WhatsApp (then WhatsApp Business) instead of an "Open with" chooser.
    val uri = Uri.parse(url)
    val isWhatsApp = uri.scheme == "whatsapp" || uri.host == "wa.me" || uri.host == "api.whatsapp.com"
    if (isWhatsApp) {
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: ActivityNotFoundException) { }
        }
    }
    try {
        val intent = if (url.startsWith("intent:")) {
            Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                component = null
                selector = null
            }
        } else {
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val launch = if (url.startsWith("upi:")) Intent.createChooser(intent, "Pay with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) else intent
        context.startActivity(launch)
    } catch (e: ActivityNotFoundException) {
        val fallback = if (url.startsWith("intent:")) runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }.getOrNull() else null
        if (fallback != null) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(fallback)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        } else {
            val app = if (url.startsWith("upi:")) "a UPI app" else if (url.contains("wa.me") || url.startsWith("whatsapp:")) "WhatsApp" else "an app"
            Toast.makeText(context, "Couldn't open $app for this link", Toast.LENGTH_SHORT).show()
        }
    } catch (e: Exception) {
        SafeLogger.e("Could not open external link", e)
    }
}

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
                // target="_blank" links (WhatsApp "Ask", settle-up) arrive via onCreateWindow below.
                settings.setSupportMultipleWindows(true)
                settings.javaScriptCanOpenWindowsAutomatically = true
                setBackgroundColor(0xFFF0F4F8.toInt()) // page --bg, so there's no flash before it paints
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                if (com.spendtrack.app.BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                        if (com.spendtrack.app.BuildConfig.DEBUG) {
                            SafeLogger.i("WebConsole [${message.messageLevel()}] ${message.message()}")
                        }
                        return true
                    }

                    // A target="_blank" link or window.open(): catch the URL in a throwaway WebView
                    // and hand it to the right app instead of opening a window we can't show.
                    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                        val catcher = WebView(view.context)
                        catcher.webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                                openExternally(view.context, request.url.toString())
                                v.destroy()
                                return true
                            }
                        }
                        (resultMsg.obj as WebView.WebViewTransport).webView = catcher
                        resultMsg.sendToTarget()
                        return true
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

                    /** Export CSV: WebViews can't do browser downloads, so share the file instead (Drive, WhatsApp, Files...). */
                    @JavascriptInterface
                    fun shareFile(fileName: String?, mimeType: String?, content: String?) {
                        if (content == null || content.length > 5_000_000) return
                        val safeName = (fileName ?: "kharcha.csv").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
                        main.post {
                            if (!fromKharcha()) return@post
                            runCatching {
                                val dir = java.io.File(view.context.cacheDir, "exports").apply { mkdirs() }
                                val file = java.io.File(dir, safeName).apply { writeText(content) }
                                val uri = androidx.core.content.FileProvider.getUriForFile(view.context, "${view.context.packageName}.fileprovider", file)
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = mimeType ?: "text/csv"
                                    putExtra(Intent.EXTRA_STREAM, uri)
                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                }
                                view.context.startActivity(Intent.createChooser(send, "Save or share $safeName").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }.onFailure { SafeLogger.e("CSV share failed", it as? Exception) }
                        }
                    }

                    @JavascriptInterface
                    fun reportSummary(json: String?) {
                        if (json.isNullOrBlank() || json.length > 4000) return
                        main.post { if (fromKharcha()) summary(json) }
                    }
                }, "KharchaNative")

                webViewClient = object : WebViewClient() {
                    // Kharcha Book stays in here; everything else (WhatsApp "Ask" links, upi:// pay
                    // links, tel:, mailto:, other sites) goes to the app that handles it. Without this
                    // the WebView tried to load wa.me itself and died on its whatsapp:// redirect.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url.toString()
                        if (url.startsWith(KHARCHA_BOOK_URL)) return false
                        if (url.startsWith(KHARCHA_BOOK_ORIGIN) && !request.isForMainFrame) return false
                        openExternally(view.context, url)
                        return true
                    }

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
