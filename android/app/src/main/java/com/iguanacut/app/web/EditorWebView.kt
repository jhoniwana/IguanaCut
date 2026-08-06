package com.iguanacut.app.web

import com.iguanacut.app.BuildConfig
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.app.DownloadManager
import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import android.os.Environment
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
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
import com.iguanacut.app.server.ServerManager
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

    /**
     * Comparte un archivo exportado (cortes) via el chooser de Android.
     * El archivo debe existir en filesDir/storage/outputs (donde el server
     * Go interno guarda las exportaciones).
     */
    @JavascriptInterface
    fun shareFile(fileName: String): String {
        return try {
            val output = File(context.filesDir, "storage/outputs/$fileName")
            if (!output.exists()) return "{\"ok\": false, \"error\": \"not found\"}"
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", output)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "video/*"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(intent, "Share")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
            "{\"ok\": true}"
        } catch (e: Exception) {
            "{\"ok\": false, \"error\": \"${e.message}\"}"
        }
    }


    @JavascriptInterface
    fun saveToGallery(fileName: String): String {
        return try {
            val src = listOf(
                File(context.filesDir, "storage/downloads/$fileName"),
                File(context.filesDir, "storage/outputs/$fileName"),
            ).firstOrNull { it.exists() } ?: return "{\"ok\": false, \"error\": \"not found\"}"
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                if (Build.VERSION.SDK_INT >= 29) {
                    put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/IguanaCut")
                } else {
                    val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "IguanaCut")
                    dir.mkdirs()
                    put(MediaStore.Video.Media.DATA, File(dir, fileName).absolutePath)
                }
            }
            val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: return "{\"ok\": false, \"error\": \"insert failed\"}"
            resolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
                ?: return "{\"ok\": false, \"error\": \"write failed\"}"
            "{\"ok\": true}"
        } catch (e: Exception) {
            "{\"ok\": false, \"error\": \"${e.message}\"}"
        }
    }

    @JavascriptInterface
    fun openVideo(fileName: String): String {
        return try {
            val file = listOf(
                File(context.filesDir, "storage/downloads/$fileName"),
                File(context.filesDir, "storage/outputs/$fileName"),
            ).firstOrNull { it.exists() } ?: return "{\"ok\": false, \"error\": \"not found\"}"
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "video/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(intent, "Play")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
            "{\"ok\": true}"
        } catch (e: Exception) {
            "{\"ok\": false, \"error\": \"${e.message}\"}"
        }
    }

    /** Abre una URL externa (video directo o YouTube) en el reproductor del
     *  sistema / app correspondiente (no descarga, no guarda nada). */
    @JavascriptInterface
    fun playUrl(url: String): String {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            "{\"ok\": true}"
        } catch (e: Exception) {
            "{\"ok\": false, \"error\": \"${e.message}\"}"
        }
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
                // Sin zoom: el pinch accidental agranda la UI y deja fuera
                // el header (boton de volver a home).
                settings.setSupportZoom(false)
                settings.builtInZoomControls = false
                settings.displayZoomControls = false
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
