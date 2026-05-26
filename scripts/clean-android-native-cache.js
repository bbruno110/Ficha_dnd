const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targets = [
  path.join(projectRoot, 'android', 'app', '.cxx'),
];

for (const target of targets) {
  const relative = path.relative(projectRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe clean target: ${target}`);
  }

  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Cleaned ${relative}`);
}
