package com.losslesscut.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.losslesscut.app.server.ServerManager

class LosslessCutApp : Application() {

    val serverManager: ServerManager by lazy { ServerManager(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            ServerManager.NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply { setShowBadge(false) }
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }
}
