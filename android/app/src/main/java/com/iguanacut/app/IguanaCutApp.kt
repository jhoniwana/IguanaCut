package com.iguanacut.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.iguanacut.app.server.ServerManager

class IguanaCutApp : Application() {

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
