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
import android.webkit.JsPromptResult
import android.webkit.JsResult
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

/**
 * WebViews ignore `<a download>`. Pages make downloads by clicking such a link (often to a blob:
 * URL), so this patches the click: the file is read in the page and handed to
 * KharchaNative.shareBase64 -> Android's share sheet (save to Files/Drive, send on WhatsApp).
 * Installed once per page load; harmless if the page never downloads anything.
 */
private const val DOWNLOAD_BRIDGE_JS = """
(function () {
  if (window.__kharchaDownloadBridge || !window.KharchaNative || !window.KharchaNative.shareBase64) return;
  window.__kharchaDownloadBridge = true;
  // Pages revoke the blob: URL right after click(); keep each blob so it can still be read.
  var blobs = {}, origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) { var u = origCreate.call(URL, obj); if (obj instanceof Blob) blobs[u] = obj; return u; };
  var orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var a = this;
    if (!a.hasAttribute('download') || !a.href) return orig.apply(a, arguments);
    var name = a.getAttribute('download') || 'kharcha-file';
    var kept = blobs[a.href];
    (kept ? Promise.resolve(kept) : fetch(a.href).then(function (r) { return r.blob(); })).then(function (blob) {
      delete blobs[a.href];
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || ''), i = s.indexOf(',');
        window.KharchaNative.shareBase64(name, blob.type || '', i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(blob);
    }).catch(function () { orig.apply(a, []); });
  };
})();
"""

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
            val loadedUrl = java.util.concurrent.atomic.AtomicReference<String?>(KHARCHA_BOOK_URL)
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

                    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                        android.app.AlertDialog.Builder(view.context)
                            .setMessage(message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                            .setOnCancelListener { result.cancel() }
                            .show()
                        return true
                    }

                    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                        android.app.AlertDialog.Builder(view.context)
                            .setMessage(message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                            .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                            .setOnCancelListener { result.cancel() }
                            .show()
                        return true
                    }

                    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
                        val input = android.widget.EditText(view.context).apply {
                            setText(defaultValue ?: "")
                        }
                        android.app.AlertDialog.Builder(view.context)
                            .setMessage(message ?: "")
                            .setView(input)
                            .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
                            .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                            .setOnCancelListener { result.cancel() }
                            .show()
                        return true
                    }

                    // <input type="file">: receipt photos, "Restore backup". Without this the WebView
                    // silently ignores the tap -- one reason a second (Chrome) copy of the app was needed.
                    override fun onShowFileChooser(view: WebView, callback: android.webkit.ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                        val activity = view.context as? androidx.activity.ComponentActivity
                        if (activity == null) { callback.onReceiveValue(null); return false }
                        val launcher = arrayOfNulls<androidx.activity.result.ActivityResultLauncher<Intent>>(1)
                        launcher[0] = activity.activityResultRegistry.register(
                            "kharcha_file_" + System.nanoTime(),
                            androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
                        ) { result ->
                            val uris = FileChooserParams.parseResult(result.resultCode, result.data)
                            callback.onReceiveValue(uris)
                            launcher[0]?.unregister()
                        }
                        val intent = runCatching { params.createIntent() }.getOrNull()
                            ?: Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                        return try {
                            launcher[0]!!.launch(intent)
                            true
                        } catch (e: Exception) {
                            launcher[0]?.unregister()
                            callback.onReceiveValue(null)
                            false
                        }
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
                    // Bridge calls arrive on a background thread, where view.url can't be read;
                    // the page address is mirrored here by the WebViewClient instead.
                    private fun fromKharchaNow(): Boolean = loadedUrl.get()?.startsWith(KHARCHA_BOOK_ORIGIN) == true

                    @JavascriptInterface
                    fun openSettings() {
                        main.post { if (fromKharcha()) openSettings() }
                    }

                    /** Pick one contact (name + phone) for a trip. ACTION_PICK on phone numbers needs no contacts
                     *  permission: the system picker only hands back the one row the person chose. */
                    @JavascriptInterface
                    fun pickContact() {
                        main.post {
                            if (!fromKharcha()) return@post
                            val activity = view.context as? androidx.activity.ComponentActivity ?: return@post
                            val launcher = arrayOfNulls<androidx.activity.result.ActivityResultLauncher<Intent>>(1)
                            launcher[0] = activity.activityResultRegistry.register(
                                "kharcha_contact_" + System.nanoTime(),
                                androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
                            ) { result ->
                                launcher[0]?.unregister()
                                var json = "null"
                                val uri = result.data?.data
                                if (result.resultCode == android.app.Activity.RESULT_OK && uri != null) {
                                    runCatching {
                                        view.context.contentResolver.query(
                                            uri,
                                            arrayOf(
                                                android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                                                android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
                                            ), null, null, null
                                        )?.use { c ->
                                            if (c.moveToFirst()) {
                                                json = org.json.JSONObject()
                                                    .put("name", c.getString(0) ?: "")
                                                    .put("tel", c.getString(1) ?: "")
                                                    .toString()
                                            }
                                        }
                                    }.onFailure { SafeLogger.e("Contact pick failed", it as? Exception) }
                                }
                                view.evaluateJavascript("window.__kharchaContactPicked && window.__kharchaContactPicked($json)", null)
                            }
                            val intent = Intent(Intent.ACTION_PICK, android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI)
                            runCatching { launcher[0]!!.launch(intent) }.onFailure {
                                launcher[0]?.unregister()
                                view.evaluateJavascript("window.__kharchaContactPicked && window.__kharchaContactPicked(null)", null)
                            }
                        }
                    }

                    /** Launch UPI payment chooser directly to pay a trip member or friend. */
                    @JavascriptInterface
                    fun payUpi(vpa: String?, name: String?, amount: String?, note: String?) {
                        if (vpa.isNullOrBlank()) return
                        main.post {
                            if (!fromKharcha()) return@post
                            val encodedPa = Uri.encode(vpa.trim(), "@")
                            val encodedPn = Uri.encode(name?.trim() ?: "Kharcha")
                            val encodedAm = Uri.encode(amount?.trim() ?: "0")
                            val encodedTn = Uri.encode(note?.trim() ?: "Settlement")
                            val uriString = "upi://pay?pa=$encodedPa&pn=$encodedPn&am=$encodedAm&cu=INR&tn=$encodedTn"
                            openExternally(view.context, uriString)
                        }
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

                    /** Any download (backup JSON, month report image, trip export) as base64 -> share sheet. */
                    @JavascriptInterface
                    fun shareBase64(fileName: String?, mimeType: String?, base64: String?) {
                        if (base64.isNullOrBlank() || base64.length > 20_000_000) return
                        val safeName = (fileName ?: "kharcha-file").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
                        main.post {
                            if (!fromKharcha()) return@post
                            runCatching {
                                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                                val dir = java.io.File(view.context.cacheDir, "exports").apply { mkdirs() }
                                val file = java.io.File(dir, safeName).apply { writeBytes(bytes) }
                                val uri = androidx.core.content.FileProvider.getUriForFile(view.context, "${view.context.packageName}.fileprovider", file)
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
                                    putExtra(Intent.EXTRA_STREAM, uri)
                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                }
                                view.context.startActivity(Intent.createChooser(send, "Save or share $safeName").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }.onFailure { SafeLogger.e("File share failed", it as? Exception) }
                        }
                    }

                    // Kharcha Book's sign-in lives in the app (SharedSession), not the WebView's storage,
                    // so the background sync uses the very same session -- one sign-in, no second login.
                    // Synchronous on purpose (supabase-js storage is called in-line). Only Supabase keys.
                    @JavascriptInterface
                    fun authGetItem(key: String?): String? =
                        if (key != null && key.startsWith("sb-") && fromKharchaNow()) com.spendtrack.app.core.network.SharedSession.getItem(key) else null

                    @JavascriptInterface
                    fun authSetItem(key: String?, value: String?) {
                        if (key == null || value == null || !key.startsWith("sb-") || value.length > 100_000 || !fromKharchaNow()) return
                        com.spendtrack.app.core.network.SharedSession.setItem(key, value)
                    }

                    @JavascriptInterface
                    fun authRemoveItem(key: String?) {
                        if (key == null || !key.startsWith("sb-") || !fromKharchaNow()) return
                        com.spendtrack.app.core.network.SharedSession.removeItem(key)
                    }

                    @JavascriptInterface
                    fun reportSummary(json: String?) {
                        if (json.isNullOrBlank() || json.length > 20000) return // summary + recurring bills list
                        main.post { if (fromKharcha()) summary(json) }
                    }
                }, "KharchaNative")

                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                        loadedUrl.set(url)
                    }

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
                        if (url?.startsWith(KHARCHA_BOOK_ORIGIN) == true) view.evaluateJavascript(DOWNLOAD_BRIDGE_JS, null)
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
