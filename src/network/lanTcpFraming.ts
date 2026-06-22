declare const require: (moduleName: string) => any;

export function getTcpSocketModule() {
  try {
    const module = require('react-native-tcp-socket');
    return module.default || module;
  } catch {
    throw new Error('Modulo TCP nativo indisponivel. Gere um dev build/APK com react-native-tcp-socket.');
  }
}

export function dataToString(data: unknown) {
  if (typeof data === 'string') return data;
  if (data && typeof (data as { toString?: () => string }).toString === 'function') {
    return (data as { toString: () => string }).toString();
  }
  return String(data || '');
}

export function encodeFrame(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export function readFrames(buffer: string, incoming: string) {
  const combined = buffer + incoming;
  const parts = combined.split('\n');
  const nextBuffer = parts.pop() || '';
  const frames: unknown[] = [];

  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      frames.push(null);
    }
  }

  return { frames, nextBuffer };
}
