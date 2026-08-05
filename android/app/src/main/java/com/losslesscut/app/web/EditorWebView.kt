package com.losslesscut.app.web

import com.losslesscut.app.BuildConfig
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.app.DownloadManager
import android.os.Environment
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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

    // Callback pendiente del file chooser del WebView; se resuelve cuando
    // el picker SAF devuelve el/los Uri(s) (o lista vacia si cancela).
    val pendingFileCallback = remember { arrayOfNulls<ValueCallback<Array<Uri>>>(1) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        val callback = pendingFileCallback[0] ?: return@rememberLauncherForActivityResult
        // null = cancelacion; lista vacia la tratamos igual
        callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
        pendingFileCallback[0] = null
    }

    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                // El layout ancho + overview dan la escala compacta de la UI;
                // los modales ya no dependen de vh (unidades fijas en px).
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                // Sin cache HTTP: los assets van embebidos en el APK, y la
                // cache del WebView puede servir el index.html viejo (que
                // referencia un bundle con hash antiguo) tras reinstalar ->
                // React no monta y la pantalla queda vacia.
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                setBackgroundColor(Color.parseColor("#0d1117"))

                // Inspeccion remota (chrome://inspect / CDP) en debug
                if (BuildConfig.DEBUG) {
                    WebView.setWebContentsDebuggingEnabled(true)
                }

                addJavascriptInterface(AndroidBridge(ctx), "AndroidBridge")

                setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                    if (!url.startsWith(ServerManager.BASE_URL)) {
                        // URLs externas se abren en el navegador
                        try {
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (_: Exception) {
                        }
                        return@setDownloadListener
                    }
                    val filename = downloadFilename(contentDisposition, url)
                    val request = DownloadManager.Request(Uri.parse(url))
                        .setTitle(filename)
                        .setMimeType(mimeType ?: "application/octet-stream")
                        .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                        )
                        .setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, filename
                        )
                    val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                    try {
                        dm?.enqueue(request)
                    } catch (_: SecurityException) {
                        // API <= 28 sin WRITE_EXTERNAL_STORAGE: guardar en dir propio de la app
                        try {
                            request.setDestinationInExternalFilesDir(
                                ctx, Environment.DIRECTORY_DOWNLOADS, filename
                            )
                            dm?.enqueue(request)
                        } catch (_: Exception) {
                            Log.e(TAG, "Descarga fallida: $url")
                        }
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                        Log.d(TAG, "console[${message?.messageLevel()}]: ${message?.message()} " +
                                "(${message?.sourceId()}:${message?.lineNumber()})")
                        return true
                    }

                    override fun onShowFileChooser(
                        webView: WebView?,
                        filePathCallback: ValueCallback<Array<Uri>>?,
                        fileChooserParams: FileChooserParams?
                    ): Boolean {
                        if (filePathCallback == null) return false
                        // Si el WebView re-dispara sin haber resuelto el anterior,
                        // cancelamos el callback previo para no colgarlo.
                        pendingFileCallback[0]?.onReceiveValue(null)
                        pendingFileCallback[0] = filePathCallback
                        val types = fileChooserParams?.acceptTypes.orEmpty().toList()
                        val mime = when {
                            types.any { it.contains("video") } -> "video/*"
                            types.any { it.contains("audio") } -> "audio/*"
                            else -> "*/*"
                        }
                        filePickerLauncher.launch(mime)
                        return true
                    }
                }

                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?
                    ) {
                        Log.e(TAG, "webview error: ${error?.errorCode} ${error?.description} url=${request?.url}")
                    }

                    override fun onReceivedHttpError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        errorResponse: WebResourceResponse?
                    ) {
                        Log.e(TAG, "webview http ${errorResponse?.statusCode}: ${request?.url}")
                    }

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

/** Nombre de archivo desde Content-Disposition, con fallback a la URL. */
private fun downloadFilename(contentDisposition: String?, url: String): String {
    val fromHeader = contentDisposition
        ?.split(';')
        ?.map { it.trim() }
        ?.firstOrNull { it.startsWith("filename=", ignoreCase = true) }
        ?.removePrefix("filename=")
        ?.trim('"', '\'')
    if (!fromHeader.isNullOrBlank()) return fromHeader
    val fromUrl = url.substringAfterLast('/').substringBefore('?')
    return fromUrl.ifBlank { "export.bin" }
}

private const val TAG = "EditorWebView"
