package com.iguanacut.app.server

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
    private const val MARKER = ".extracted_v11"

    // Binarios que deben quedar ejecutables tras la copia (los .so/libs no)
    private val EXECUTABLE_BINS = setOf(
        "server_arm64",
        "server_x86_64",
        "ffmpeg",
        "ffprobe",
        "python3/bin/python3.12",
        "python3/bin/qjs",   // runtime JS de yt-dlp (solvers anti-bot de YouTube)
        "yt-dlp",
    )

    // Binario del server segun la ABI (misma logica que ServerManager)
    private fun serverBinaryName(): String {
        val abis = android.os.Build.SUPPORTED_ABIS
        return if (abis.any { it.startsWith("x86_64") }) "server_x86_64" else "server_arm64"
    }

    /** Compara el inicio del asset con el archivo extraido (detecta builds nuevos). */
    private fun headMatches(context: Context, assetPath: String, file: File): Boolean {
        return try {
            val expected = ByteArray(4096)
            val actual = ByteArray(4096)
            val n1 = context.assets.open(assetPath).use { it.read(expected) }
            val n2 = file.inputStream().use { it.read(actual) }
            n1 == n2 && expected.copyOf(n1).contentEquals(actual.copyOf(n2))
        } catch (_: Exception) {
            false
        }
    }

    fun extractNative(context: Context): File {
        val target = File(context.filesDir, NATIVE_DIR)
        val marker = File(target, MARKER)
        if (marker.exists()) {
            // Canarios: si la APK trae un server o ffmpeg distinto (build
            // nuevo), re-extraer; de lo contrario una reinstalacion seguira
            // ejecutando los binarios viejos.
            val serverName = serverBinaryName()
            val canaries = listOf(
                Pair("native/$serverName", File(target, serverName)),
                Pair("native/ffmpeg", File(target, "ffmpeg")),
                Pair("native/python3/bin/python3.12", File(target, "python3/bin/python3.12")),
            )
            val fresh = canaries.all { (assetPath, file) ->
                file.isFile && headMatches(context, assetPath, file)
            }
            if (fresh) {
                Log.d(TAG, "Binarios ya extraidos en $target")
                return target
            }
            marker.delete()
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
            # qjs (runtime JS anti-bot de YouTube) y ffmpeg/ffprobe (merge
            # de streams) se buscan por PATH
            export PATH="$nativeDir:$pythonHome/bin:${'$'}PATH"
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
        // El frontend embebido cambia con cada APK (bundle con hash nuevo).
        // Si el index.html del assets difiere del extraido, re-extraer:
        // de lo contrario una reinstalacion seguira sirviendo la web vieja.
        val indexAsset = context.assets.open("web/index.html").use { it.readBytes() }
        val indexHash = indexAsset.fold(1) { acc, b -> acc * 31 + b }.toString()
        if (marker.exists()) {
            if (marker.readText().trim() == indexHash) return target
            target.deleteRecursively()
        }
        target.mkdirs()
        copyTree(context, "web", target)
        marker.writeText(indexHash)
        return target
    }

    private fun copyTree(context: Context, assetDir: String, target: File) {
        val entries = context.assets.list(assetDir).orEmpty()
        for (entry in entries) {
            val assetPath = "$assetDir/$entry"
            val out = File(target, entry)
            if (context.assets.list(assetPath).isNullOrEmpty()) {
                context.assets.open(assetPath).use { input ->
                    // Copiar a temporal + rename: si el destino esta en ejecucion
                    // (server), sobrescribirlo lanza ETXTBSY. El rename reemplaza
                    // la entrada del directorio sin tocar el inode en uso.
                    val tmp = File(out.parentFile, "${out.name}.tmp${System.nanoTime()}")
                    tmp.outputStream().use { output -> input.copyTo(output) }
                    if (!tmp.renameTo(out)) {
                        out.outputStream().use { output -> tmp.inputStream().use { it.copyTo(output) } }
                        tmp.delete()
                    }
                }
            } else {
                out.mkdirs()
                copyTree(context, assetPath, out)
            }
        }
    }
}
