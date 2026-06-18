# Templates nativos Android para Foreground Service LAN

O ZIP principal desta conversa não contém a pasta `android`, então estes arquivos ficam como template para copiar quando o projeto Android nativo estiver disponível.

Copie os arquivos `.kt` para algo como:

`android/app/src/main/java/<seu_pacote>/lan/`

Depois registre `LanForegroundServicePackage` no `MainApplication.kt` e adicione a permissão abaixo no `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />

<application>
  <service
    android:name=".lan.LanForegroundService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="dataSync" />
</application>
```

A bridge JS já procura por `NativeModules.LanForegroundService` em `src/services/lan/LanForegroundService.ts`. O módulo também expõe `getLanAddresses()` para listar interfaces IPv4 reais do Android, incluindo Wi-Fi, dados e hotspot quando o sistema permitir.
