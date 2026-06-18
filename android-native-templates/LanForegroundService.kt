package com.fichadnd.lan

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class LanForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "ficha_dnd_lan_session"
    const val NOTIFICATION_ID = 45555
    const val ACTION_STOP = "com.fichadnd.lan.STOP"
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    val sessionName = intent?.getStringExtra("sessionName") ?: "Sessao LAN"
    val playerCount = intent?.getIntExtra("playerCount", 0) ?: 0
    startForeground(NOTIFICATION_ID, buildNotification(sessionName, playerCount))
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Sessao LAN",
        NotificationManager.IMPORTANCE_LOW
      )
      channel.description = "Mantem a sessao LAN ativa enquanto o mestre usa outro app ou bloqueia a tela."
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(sessionName: String, playerCount: Int): Notification {
    val stopIntent = Intent(this, LanForegroundService::class.java).apply { action = ACTION_STOP }
    val stopPendingIntent = PendingIntent.getService(
      this,
      1,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload_done)
      .setContentTitle("Ficha D&D — Sessao LAN ativa")
      .setContentText("$sessionName • $playerCount jogador(es) conectado(s)")
      .setOngoing(true)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPendingIntent)
      .build()
  }
}
