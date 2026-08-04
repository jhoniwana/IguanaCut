package com.losslesscut.app.server

import android.content.Context
import android.util.Log
import com.losslesscut.app.BuildConfig
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Gestiona el ciclo de vida del servidor Go local (127.0.0.1).
 * El backend es un ELF estatico ARM64 compilado con CGO_ENABLED=0.
 */
class ServerManager(private val appContext: Context) {

    private val lock = Any()
    private var process: Process? = null
    private var binaryDir: File? = null

    fun ensureExtracted() {
        binaryDir?.let { return }
        BinaryExtractor.extractNative(appContext)
        BinaryExtractor.extractWeb(appContext)
        binaryDir = File(appContext.filesDir, "native")
        ConfigGenerator.write(appContext, binaryDir!!, BuildConfig.ENABLE_YTDLP)
    }

    fun start() {
        synchronized(lock) {
            if (isRunningLocked()) {
                Log.d(TAG, "Servidor ya corriendo")
                return
            }
            ensureExtracted()

            val serverBin = File(binaryDir!!, "server_arm64")
            val configFile = File(appContext.filesDir, "backend/config.yaml")

            val builder = ProcessBuilder(serverBin.absolutePath, "-config", configFile.absolutePath)
            builder.directory(appContext.filesDir)
            builder.redirectErrorStream(true)

            try {
                val p = builder.start()
                process = p
                Log.i(TAG, "Servidor iniciado")
                Thread {
                    p.inputStream.bufferedReader().forEachLine { line ->
                        Log.d(TAG, "server: $line")
                    }
                }.start()
            } catch (e: IOException) {
                Log.e(TAG, "Error iniciando servidor", e)
            }
        }
    }

    fun stop() {
        synchronized(lock) {
            process?.let { p ->
                p.destroy()
                try {
                    p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
                if (p.isAlive) p.destroyForcibly()
            }
            process = null
            Log.i(TAG, "Servidor detenido")
        }
    }

    fun isHealthy(): Boolean {
        return try {
            val conn = URL("http://127.0.0.1:$LOCAL_PORT/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 1000
            conn.readTimeout = 1000
            conn.responseCode == 200
        } catch (_: IOException) {
            false
        } finally {
            // no-op
        }
    }

    private fun isRunningLocked(): Boolean = process?.isAlive == true

    companion object {
        private const val TAG = "ServerManager"
        const val LOCAL_PORT = 8090
        const val BASE_URL = "http://127.0.0.1:$LOCAL_PORT"
        const val NOTIFICATION_CHANNEL_ID = "losslesscut_server"
    }
}
