package com.losslesscut.app.server

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Extrae binarios y assets del APK a almacenamiento privado de la app.
 * Los binarios empaquetados en assets no pueden ejecutarse in-place:
 * se copian a filesDir/native con permisos de ejecución.
 */
object BinaryExtractor {

    private const val TAG = "BinaryExtractor"
    private const val NATIVE_DIR = "native"
    private const val MARKER = ".extracted_v2"

    // Binarios que deben quedar ejecutables tras la copia (los .so/libs no)
    private val EXECUTABLE_BINS = setOf(
        "server_arm64",
        "ffmpeg",
        "ffprobe",
        "python3/bin/python3.12",
        "yt-dlp",
    )

    fun extractNative(context: Context): File {
        val target = File(context.filesDir, NATIVE_DIR)
        val marker = File(target, MARKER)
        if (marker.exists()) {
            Log.d(TAG, "Binarios ya extraidos en $target")
            return target
        }
        target.mkdirs()

        copyTree(context, NATIVE_DIR, target)

        // Marcar ejecutables (solo archivos, no libs)
        EXECUTABLE_BINS.forEach { rel ->
            val f = File(target, rel)
            if (f.isFile) {
                f.setExecutable(true, false)
                Log.d(TAG, "Marcado ejecutable: $rel")
            }
        }
        marker.writeText("1")
        return target
    }

    /**
     * Genera el wrapper ejecutable de yt-dlp en runtime. Python embebido
     * necesita PYTHONHOME y LD_LIBRARY_PATH absolutos del filesDir, que
     * solo se conocen en el dispositivo. El backend Go ejecuta este path
     * tal cual (config ytdlp.path).
     */
    fun writeYtdlpWrapper(context: Context, nativeDir: File) {
        val pythonHome = File(nativeDir, "python3").absolutePath
        val pyBin = File(pythonHome, "bin/python3.12").absolutePath
        val script = """
            #!/system/bin/sh
            # Wrapper generado en runtime: python3 arm64 embebido + yt-dlp
            export PYTHONHOME="$pythonHome"
            export PYTHONNOUSERSITE=1
            export LD_LIBRARY_PATH="$pythonHome/lib"
            exec "$pyBin" -m yt_dlp "${'$'}@"
        """.trimIndent() + "\n"

        val wrapper = File(nativeDir, "yt-dlp")
        wrapper.writeText(script)
        wrapper.setExecutable(true, false)
        Log.d(TAG, "Wrapper yt-dlp escrito en ${wrapper.absolutePath}")
    }

    /**
     * El backend Go sirve el frontend desde <storage>/../backend/web.
     * Con storage = filesDir/storage, eso equivale a filesDir/backend/web.
     */
    fun extractWeb(context: Context): File {
        val target = File(context.filesDir, "backend/web")
        val marker = File(context.filesDir, ".web_extracted_v1")
        if (marker.exists()) return target
        target.mkdirs()
        copyTree(context, "web", target)
        marker.writeText("1")
        return target
    }

    private fun copyTree(context: Context, assetDir: String, target: File) {
        val entries = context.assets.list(assetDir).orEmpty()
        for (entry in entries) {
            val assetPath = "$assetDir/$entry"
            val out = File(target, entry)
            if (context.assets.list(assetPath).isNullOrEmpty()) {
                context.assets.open(assetPath).use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
            } else {
                out.mkdirs()
                copyTree(context, assetPath, out)
            }
        }
    }
}
