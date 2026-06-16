import { LAN_DEFAULT_PORT, LanMessage, ParsedSessionCode } from '../types/lan';

const CODE_PREFIX = 'DNDLAN';
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeSessionId(length = 8) {
  let result = '';
  for (let index = 0; index < length; index++) {
    result += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return result;
}

export function buildSessionCode(sessionId: string, hostIp: string, port = LAN_DEFAULT_PORT) {
  const ipPart = hostIp.replace(/\./g, '-');
  return `${CODE_PREFIX}-${sessionId}-${ipPart}-${port}`;
}

export function parseSessionCode(rawCode: string): ParsedSessionCode | null {
  const trimmed = rawCode.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<ParsedSessionCode>;
    if (parsed.sessionId && parsed.hostIp) {
      return {
        sessionId: String(parsed.sessionId).toUpperCase(),
        hostIp: String(parsed.hostIp),
        port: Number(parsed.port || LAN_DEFAULT_PORT),
      };
    }
  } catch {}

  if (trimmed.includes('|')) {
    const [prefix, sessionId, hostIp, port] = trimmed.split('|');
    if (prefix === CODE_PREFIX && sessionId && hostIp) {
      return {
        sessionId: sessionId.toUpperCase(),
        hostIp,
        port: Number(port || LAN_DEFAULT_PORT),
      };
    }
  }

  const parts = trimmed.split('-');
  if (parts.length >= 7 && parts[0].toUpperCase() === CODE_PREFIX) {
    const sessionId = parts[1].toUpperCase();
    const ipSegments = parts.slice(2, 6);
    const port = Number(parts[6] || LAN_DEFAULT_PORT);

    if (ipSegments.length === 4 && ipSegments.every(segment => Number(segment) >= 0 && Number(segment) <= 255)) {
      return {
        sessionId,
        hostIp: ipSegments.join('.'),
        port,
      };
    }
  }

  return null;
}

export function encodeLanMessage(message: LanMessage) {
  return `${JSON.stringify(message)}\n`;
}

export function readLanFrames(buffer: string, incoming: string) {
  const combined = buffer + incoming;
  const parts = combined.split('\n');
  const nextBuffer = parts.pop() || '';
  const messages: LanMessage[] = [];

  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;

    try {
      messages.push(JSON.parse(line) as LanMessage);
    } catch {
      messages.push({ type: 'ERROR', message: 'Mensagem LAN invalida.' });
    }
  }

  return { messages, nextBuffer };
}

