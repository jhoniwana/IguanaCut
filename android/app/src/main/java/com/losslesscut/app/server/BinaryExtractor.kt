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
    private const val MARKER = ".extracted_v1"

    fun extractNative(context: Context): File {
        val target = File(context.filesDir, NATIVE_DIR)
        val marker = File(target, MARKER)
        if (marker.exists()) {
            Log.d(TAG, "Binarios ya extraidos en $target")
            return target
        }
        target.mkdirs()

        val assets = context.assets.list(NATIVE_DIR).orEmpty()
        for (name in assets) {
            if (name == MARKER) continue
            val out = File(target, name)
            context.assets.open("$NATIVE_DIR/$name").use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            }
            out.setExecutable(true, false)
            out.setReadable(true, false)
            Log.d(TAG, "Extraido: $name (${out.length()} bytes)")
        }
        marker.writeText("1")
        return target
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
