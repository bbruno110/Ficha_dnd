# Build Android - limpeza de cache nativo CMake/codegen

Este projeto usa Expo/React Native com módulos nativos. Em alguns builds Android, o `gradlew clean` pode falhar antes do build real quando o cache do CMake aponta para pastas de codegen ainda não geradas em `node_modules`, por exemplo:

- `react-native-gesture-handler/android/build/generated/source/codegen/jni`
- `react-native-reanimated/android/build/generated/source/codegen/jni`
- `react-native-worklets/android/build/generated/source/codegen/jni`

Para evitar isso, o script `build:android` executa antes:

```bash
npm run clean:android-native
```

Depois disso ele roda o Gradle normalmente:

```bash
cd android && gradlew clean && gradlew assembleRelease
```

## Comandos

```bash
npm run build:android
npm run build:android:debug
```
