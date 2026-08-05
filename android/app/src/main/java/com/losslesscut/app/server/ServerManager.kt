package com.losslesscut.app.server

import android.content.Context
import android.util.Log
import com.losslesscut.app.BuildConfig
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
        if (BuildConfig.ENABLE_YTDLP) {
            BinaryExtractor.writeYtdlpWrapper(appContext, binaryDir!!)
        }
        ConfigGenerator.write(appContext, binaryDir!!, BuildConfig.ENABLE_YTDLP)
    }

    fun start() {
        synchronized(lock) {
            if (isRunningLocked()) {
                Log.d(TAG, "Servidor ya corriendo")
                return
            }
            try {
                ensureExtracted()
            } catch (e: Exception) {
                // No matar la app por un fallo de extraccion: si ya hay un
                // servidor respondiendo, se sigue usando; el proximo arranque
                // reintenta la extraccion.
                Log.e(TAG, "Error extrayendo binarios; se intentara con el servidor existente", e)
            }

            // Si un servidor (p.ej. huerfano de una ejecucion anterior que el
            // force-stop no mato) ya responde en el puerto, reutilizarlo:
            // lanzar otro moriria con "bind: address already in use" y la
            // app quedaria sin servidor.
            if (isPortServed()) {
                Log.i(TAG, "Ya hay un servidor activo en :$LOCAL_PORT; se reutiliza")
                return
            }

            val serverBin = File(binaryDir!!, serverBinaryName())
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

    /**
     * Health check del servidor local. Suspendida y ejecutada en IO:
     * la conexion HTTP desde el main thread lanza NetworkOnMainThreadException.
     */
    suspend fun isHealthy(): Boolean = withContext(Dispatchers.IO) {
        try {
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

    /** Comprobacion rapida: hay un servidor respondiendo en el puerto. */
    private fun isPortServed(): Boolean {
        var served = false
        val t = Thread {
            served = try {
                val conn = URL("http://127.0.0.1:$LOCAL_PORT/health").openConnection() as HttpURLConnection
                conn.connectTimeout = 300
                conn.readTimeout = 300
                conn.responseCode == 200
            } catch (_: Exception) {
                false
            }
        }
        t.start()
        t.join(1200)
        return served
    }

    /**
     * Nombre del binario del server segun la ABI del dispositivo.
     * En emuladores/Waydroid x86_64 usamos el binario nativo (el arm64
     * bajo traduccion libndk corrompe el heap del GC de Go).
     */
    private fun serverBinaryName(): String {
        val abis = android.os.Build.SUPPORTED_ABIS
        if (abis.any { it.startsWith("x86_64") }) {
            return "server_x86_64"
        }
        return "server_arm64"
    }

    companion object {
        private const val TAG = "ServerManager"
        const val LOCAL_PORT = 8090
        const val BASE_URL = "http://127.0.0.1:$LOCAL_PORT"
        const val NOTIFICATION_CHANNEL_ID = "losslesscut_server"
    }
}
