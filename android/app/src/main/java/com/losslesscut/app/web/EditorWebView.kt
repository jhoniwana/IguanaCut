package com.losslesscut.app.web

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.losslesscut.app.server.ServerManager
import org.json.JSONObject

/**
 * Puente JS <-> nativo. El frontend React puede llamar a
 * window.AndroidBridge.* para acceder a capacidades nativas
 * (importar/exportar via SAF, etc.).
 */
class AndroidBridge(private val context: Context) {

    @JavascriptInterface
    fun platform(): String = "android"

    @JavascriptInterface
    fun getDeviceInfo(): String {
        return JSONObject()
            .put("isAndroid", true)
            .put("platform", "android")
            .put("version", android.os.Build.VERSION.RELEASE)
            .toString()
    }
}

@Composable
fun EditorWebView(modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current

    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                setBackgroundColor(Color.parseColor("#0d1117"))

                addJavascriptInterface(AndroidBridge(ctx), "AndroidBridge")

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val url = request?.url
                        if (url == null) return false
                        return if (url.toString().startsWith(ServerManager.BASE_URL)) {
                            false
                        } else {
                            // URLs externas se abren en el navegador
                            try {
                                ctx.startActivity(
                                    Intent(Intent.ACTION_VIEW, Uri.parse(url.toString()))
                                )
                            } catch (_: Exception) {
                                // sin navegador disponible
                            }
                            true
                        }
                    }
                }

                loadUrl(ServerManager.BASE_URL)
            }
        },
        modifier = modifier
    )
}
