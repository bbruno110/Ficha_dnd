package com.fichadnd.lan

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.net.Inet4Address
import java.net.NetworkInterface

class LanForegroundServiceModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "LanForegroundService"

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    try {
      val intent = Intent(reactContext, LanForegroundService::class.java)
      intent.putExtra("sessionId", options.getString("sessionId"))
      intent.putExtra("sessionName", options.getString("sessionName") ?: "Sessao LAN")
      intent.putExtra("hostIp", if (options.hasKey("hostIp")) options.getString("hostIp") else null)
      intent.putExtra("port", if (options.hasKey("port")) options.getInt("port") else 45555)
      intent.putExtra("playerCount", if (options.hasKey("playerCount")) options.getInt("playerCount") else 0)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("LAN_FOREGROUND_START_ERROR", error)
    }
  }

  @ReactMethod
  fun update(options: ReadableMap, promise: Promise) {
    start(options, promise)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val intent = Intent(reactContext, LanForegroundService::class.java)
      intent.action = LanForegroundService.ACTION_STOP
      reactContext.startService(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("LAN_FOREGROUND_STOP_ERROR", error)
    }
  }

  @ReactMethod
  fun getLanAddresses(promise: Promise) {
    try {
      val result = Arguments.createArray()
      val interfaces = NetworkInterface.getNetworkInterfaces()

      while (interfaces.hasMoreElements()) {
        val networkInterface = interfaces.nextElement()
        val addresses = networkInterface.inetAddresses

        while (addresses.hasMoreElements()) {
          val address = addresses.nextElement()
          if (address is Inet4Address && !address.isLoopbackAddress) {
            val hostAddress = address.hostAddress ?: continue
            if (hostAddress == "0.0.0.0") continue

            val item = Arguments.createMap()
            item.putString("address", hostAddress)
            item.putString("interfaceName", networkInterface.name)
            item.putBoolean("isLoopback", address.isLoopbackAddress)
            result.pushMap(item)
          }
        }
      }

      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("LAN_ADDRESSES_ERROR", error)
    }
  }
}
