# Correção: EBUSY no build Android Windows

## Problema

Durante `npm run build:android`, o script `clean:android-native` tentava remover caches Android dentro de `node_modules`.

No Windows, arquivos `.jar` dentro de `node_modules/*/android/build` podem ficar travados por processos como Gradle daemon, Android Studio, Java, antivírus ou indexadores do sistema. Quando isso acontece, o Node lança erro como:

```txt
Error: EBUSY: resource busy or locked, unlink '...node_modules\\react-native-screens\\android\\build\\intermediates\\lint-cache...jar'
```

## Ajuste aplicado

O script `scripts/clean-android-native-cache.js` foi alterado para:

- Parar o Gradle daemon antes da limpeza, quando a pasta `android` existir.
- Limpar apenas os caches nativos necessários para resolver o erro de CMake/autolinking:
  - `android/app/.cxx`
  - `android/app/.externalNativeBuild`
  - `android/app/build/generated/autolinking`
  - `android/app/build/generated/source/codegen`
  - caches C/C++ intermediários do app
- Preservar `node_modules` por padrão, evitando `EBUSY` no Windows.
- Tratar `EBUSY`, `EPERM` e `ENOTEMPTY` como aviso quando possível, em vez de derrubar imediatamente o build.

## Como usar

Rode normalmente:

```powershell
npm run build:android
```

## Se ainda houver arquivo travado

Feche Android Studio, emulador e processos Java/Gradle, depois rode:

```powershell
cd android
.\gradlew --stop
cd ..
npm run build:android
```

## Limpeza agressiva opcional

Somente se precisar limpar também os builds nativos dentro de `node_modules`, rode:

```powershell
$env:CLEAN_NODE_MODULES_ANDROID="1"
npm run clean:android-native
Remove-Item Env:CLEAN_NODE_MODULES_ANDROID
```

Use isso com Android Studio/emulador fechados para evitar arquivos bloqueados.
