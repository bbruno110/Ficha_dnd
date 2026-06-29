import { LAN_DEFAULT_PORT, ParsedSessionCode } from '../types/lan';

const CODE_PREFIX = 'DNDLAN';
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function uniqueIps(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ip = String(value || '').trim();
    if (!ip || ip === '0.0.0.0' || seen.has(ip)) continue;
    seen.add(ip);
    result.push(ip);
  }
  return result;
}

export function makeShortSessionCode() {
  const nextPart = (length: number) => {
    let result = '';
    for (let index = 0; index < length; index += 1) {
      result += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
    }
    return result;
  };
  return `${nextPart(4)}-${nextPart(4)}-${nextPart(4)}`;
}

export function buildSessionShareCode(sessionId: string, hostIp: string, port = LAN_DEFAULT_PORT, hostCandidates: string[] = []) {
  const candidates = uniqueIps([hostIp, ...hostCandidates]);
  return `${CODE_PREFIX}|${sessionId}|${hostIp}|${port}|${candidates.join(',')}`;
}

export function formatManualSessionCode(rawCode: string) {
  const trimmed = rawCode.trim();
  if (!trimmed) return '';
  if (
    trimmed.includes('|') ||
    trimmed.startsWith('{') ||
    /^https?:\/\//i.test(trimmed) ||
    /^fichadnd:\/\//i.test(trimmed) ||
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(trimmed)
  ) {
    return trimmed;
  }

  const compact = trimmed
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 12);

  const groups = compact.match(/.{1,4}/g) || [];
  return groups.join('-');
}

export function parseSessionCode(rawCode: string): ParsedSessionCode | null {
  let trimmed = rawCode.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const codeParam = url.searchParams.get('code') || url.searchParams.get('session') || url.searchParams.get('sessionCode');
    if (codeParam) {
      const parsedFromParam = parseSessionCode(decodeURIComponent(codeParam));
      if (parsedFromParam) return parsedFromParam;
    }
  } catch {}

  if (/^DNDLAN:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^DNDLAN:\/\//i, `${CODE_PREFIX}|`);
  }

  const formattedShortCode = formatManualSessionCode(trimmed);
  if (/^[A-Z2-9]{4}-[A-Z2-9]{4}(-[A-Z2-9]{4})?$/.test(formattedShortCode)) {
    return {
      sessionId: formattedShortCode,
      hostIp: '',
      hostCandidates: [],
      port: LAN_DEFAULT_PORT,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<ParsedSessionCode>;
    if (parsed.sessionId && parsed.hostIp) {
      const hostCandidates = Array.isArray(parsed.hostCandidates)
        ? uniqueIps(parsed.hostCandidates.map(String))
        : uniqueIps([String(parsed.hostIp)]);
      return {
        sessionId: String(parsed.sessionId).toUpperCase(),
        hostIp: String(parsed.hostIp),
        hostCandidates,
        port: Number(parsed.port || LAN_DEFAULT_PORT),
      };
    }
  } catch {}

  if (trimmed.includes('|')) {
    const [prefix, sessionId, hostIp, port, candidates] = trimmed.split('|');
    if (prefix.toUpperCase() === CODE_PREFIX && sessionId && hostIp) {
      const hostCandidates = uniqueIps([hostIp, ...(candidates ? candidates.split(',') : [])]);
      return {
        sessionId: sessionId.toUpperCase(),
        hostIp,
        hostCandidates,
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
        hostCandidates: uniqueIps([ipSegments.join('.')]),
        port,
      };
    }
  }

  return null;
}
