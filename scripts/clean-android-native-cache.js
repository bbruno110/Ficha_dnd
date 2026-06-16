#!/usr/bin/env node
/**
 * Limpa somente os caches nativos Android que costumam quebrar o CMake/autolinking.
 *
 * Importante:
 * - Nao apaga caches dentro de node_modules por padrao, porque no Windows esses
 *   arquivos podem ficar bloqueados pelo Gradle/Android Studio/antivirus e gerar EBUSY.
 * - Para uma limpeza agressiva de node_modules, rode manualmente com:
 *   CLEAN_NODE_MODULES_ANDROID=1 node ./scripts/clean-android-native-cache.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const gradlewPath = path.join(rootDir, 'android', isWindows ? 'gradlew.bat' : 'gradlew');

const requiredTargets = [
  // Caches que causam erro em :app:externalNativeBuildCleanRelease.
  'android/app/.cxx',
  'android/app/.externalNativeBuild',
  'android/app/build/generated/autolinking',
  'android/app/build/generated/source/codegen',
  'android/app/build/intermediates/cxx',
  'android/app/build/intermediates/merged_native_libs',
  'android/app/build/intermediates/stripped_native_libs',
];

const optionalTargets = [
  // Esses podem estar bloqueados no Windows. Se falhar, o script apenas avisa.
  'android/build',
  'android/.gradle',
];

const aggressiveNodeModulesTargets = [
  'node_modules/react-native-gesture-handler/android/build',
  'node_modules/react-native-reanimated/android/build',
  'node_modules/react-native-worklets/android/build',
  'node_modules/react-native-screens/android/build',
  'node_modules/react-native-safe-area-context/android/build',
  'node_modules/react-native-svg/android/build',
];

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // pequeno retry sincrono para Windows liberar handle de arquivo
  }
}

function removeTarget(relativePath, options = {}) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) return true;

  const attempts = options.optional ? 2 : 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(absolutePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      console.log(`[android-clean] removido: ${relativePath}`);
      return true;
    } catch (error) {
      const code = error && error.code ? error.code : 'UNKNOWN';
      const locked = ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code);
      if (locked && attempt < attempts) {
        sleepMs(250);
        continue;
      }

      const message = `[android-clean] aviso: nao foi possivel remover ${relativePath} (${code}).`;
      if (options.optional || locked) {
        console.warn(`${message} Continuando.`);
        console.warn('[android-clean] dica: feche Android Studio/emulador, pare processos Java/Gradle ou reinicie o terminal se o erro persistir.');
        return false;
      }

      console.error(message);
      throw error;
    }
  }

  return false;
}

console.log('[android-clean] preparando limpeza nativa Android...');

if (fs.existsSync(gradlewPath)) {
  try {
    console.log('[android-clean] parando Gradle daemon...');
    spawnSync(gradlewPath, ['--stop'], {
      cwd: path.join(rootDir, 'android'),
      stdio: 'ignore',
      shell: isWindows,
    });
  } catch (_error) {
    console.warn('[android-clean] aviso: nao foi possivel parar o Gradle daemon. Continuando.');
  }
}

console.log('[android-clean] limpando caches obrigatorios...');
requiredTargets.forEach((target) => removeTarget(target));

console.log('[android-clean] limpando caches opcionais...');
optionalTargets.forEach((target) => removeTarget(target, { optional: true }));

if (process.env.CLEAN_NODE_MODULES_ANDROID === '1') {
  console.log('[android-clean] limpeza agressiva em node_modules habilitada...');
  aggressiveNodeModulesTargets.forEach((target) => removeTarget(target, { optional: true }));
} else {
  console.log('[android-clean] node_modules preservado para evitar EBUSY no Windows.');
}

console.log('[android-clean] limpeza concluida.');
