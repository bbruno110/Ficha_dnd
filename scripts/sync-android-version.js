const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appJsonPath = path.join(projectRoot, 'app.json');
const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');

if (!fs.existsSync(buildGradlePath)) {
  throw new Error(`Android build.gradle nao encontrado: ${buildGradlePath}`);
}

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const versionName = String(appJson?.expo?.version || '').trim();
const versionCode = Number(appJson?.expo?.android?.versionCode);

if (!versionName) {
  throw new Error('Defina expo.version no app.json.');
}

if (!Number.isInteger(versionCode) || versionCode < 1) {
  throw new Error('Defina expo.android.versionCode como inteiro maior que zero no app.json.');
}

const original = fs.readFileSync(buildGradlePath, 'utf8');

// O Gradle atual le diretamente o app.json. Este fallback mantem a sincronizacao
// caso a pasta android seja recriada pelo Expo com valores fixos.
if (
  original.includes('versionCode expoAndroidVersionCode') &&
  original.includes('versionName expoAppVersion')
) {
  console.log(`Versao Android vinculada ao app.json: ${versionName} (${versionCode}).`);
  process.exit(0);
}

const versionCodePattern = /^(\s*)versionCode\s+\d+\s*$/m;
const versionNamePattern = /^(\s*)versionName\s+["'][^"']*["']\s*$/m;

if (!versionCodePattern.test(original) || !versionNamePattern.test(original)) {
  throw new Error('Nao foi possivel localizar versionCode/versionName em android/app/build.gradle.');
}

let updated = original.replace(
  versionCodePattern,
  `$1versionCode ${versionCode}`
);
updated = updated.replace(
  versionNamePattern,
  `$1versionName "${versionName}"`
);

if (updated === original) {
  console.log(`Versao Android ja estava sincronizada: ${versionName} (${versionCode}).`);
} else {
  fs.writeFileSync(buildGradlePath, updated, 'utf8');
  console.log(`Versao Android sincronizada: ${versionName} (${versionCode}).`);
}
