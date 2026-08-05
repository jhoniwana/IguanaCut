package com.losslesscut.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.losslesscut.app.server.ServerManager
import com.losslesscut.app.server.ServerService
import com.losslesscut.app.web.EditorWebView
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // El contenido debe caber bajo las barras del sistema: sin esto la
        // WebView dibuja detras de la barra de estado y los botones del
        // header quedan "intocables" (el sistema se traga los toques).
        WindowCompat.setDecorFitsSystemWindows(window, true)
        requestNotificationPermissionIfNeeded()
        startServerService()

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ServerScreen()
                }
            }
        }
    }

    private fun startServerService() {
        val intent = android.content.Intent(this, ServerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    @Composable
    fun ServerScreen() {
        val app = application as LosslessCutApp
        val serverManager = remember { app.serverManager }
        val ready by produceState(initialValue = false) {
            while (!value) {
                if (serverManager.isHealthy()) {
                    value = true
                } else {
                    delay(500)
                }
            }
        }
        if (ready) {
            EditorWebView(modifier = Modifier.fillMaxSize())
        } else {
            LoadingScreen()
        }
    }

    @Composable
    fun LoadingScreen() {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.align(Alignment.Center), strokeWidth = 3.dp)
            Text(
                getString(R.string.loading),
                modifier = Modifier.align(Alignment.Center).offset(y = 48.dp),
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
            )
        }
    }
}
