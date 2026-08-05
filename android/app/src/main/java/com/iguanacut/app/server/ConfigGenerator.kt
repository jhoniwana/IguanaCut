package com.iguanacut.app.server

import android.content.Context
import java.io.File

/**
 * Genera el config.yaml del backend en tiempo de ejecución con rutas
 * absolutas del almacenamiento privado de la app. Sin esto el backend
 * usaría los defaults del repo que no existen en Android.
 */
object ConfigGenerator {

    fun write(context: Context, nativeDir: File, enableYtdlp: Boolean) {
        val configDir = File(context.filesDir, "backend")
        configDir.mkdirs()
        val config = File(configDir, "config.yaml")

        val storageBase = File(context.filesDir, "storage").absolutePath
        val ytdlpPath = if (enableYtdlp) File(nativeDir, "yt-dlp").absolutePath else ""

        val content = """
            server:
              host: 127.0.0.1
              port: ${ServerManager.LOCAL_PORT}
              max_upload_size: 10737418240
              production: true
              cors_origins:
                - "*"

            storage:
              base_path: $storageBase
              auto_cleanup: false
              cleanup_after_days: 7

            ffmpeg:
              path: ${File(nativeDir, "ffmpeg").absolutePath}
              ffprobe_path: ${File(nativeDir, "ffprobe").absolutePath}
              threads: 0

            ytdlp:
              path: $ytdlpPath
              max_quality: 1080p
        """.trimIndent() + "\n"

        config.writeText(content)
    }
}
