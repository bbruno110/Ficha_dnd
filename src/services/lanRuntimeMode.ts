import { traceApp } from './debug/appTrace';

export type SheetRuntimeMode = 'OFFLINE' | 'LAN_PLAYER' | 'LAN_HOST';

export type SheetRuntimeModeInput = {
  routeSessionId?: string | null;
  routeJoinUrl?: string | null;
  lanInfo?: { sessionId?: string | null; joinUrl?: string | null } | null;
  isMaster?: boolean;
};

export const LAN_PLAYER_AUTHORITATIVE_FIELDS = new Set([
  'hp_current',
  'hp_max',
  'temp_hp',
  'xp',
  'gp',
  'sp',
  'cp',
  'stats',
  'active_effects',
  'active_effects_json',
  'equipment',
]);

export function getSheetRuntimeMode(input: SheetRuntimeModeInput): SheetRuntimeMode {
  if (input.isMaster) return 'LAN_HOST';

  const sessionId = String(input.lanInfo?.sessionId || input.routeSessionId || '').trim();
  const joinUrl = String(input.lanInfo?.joinUrl || input.routeJoinUrl || '').trim();

  if (sessionId || joinUrl) return 'LAN_PLAYER';
  return 'OFFLINE';
}

export function isOfflineMode(mode: SheetRuntimeMode) {
  return mode === 'OFFLINE';
}

export function isLanPlayerMode(mode: SheetRuntimeMode) {
  return mode === 'LAN_PLAYER';
}

export function isLanHostMode(mode: SheetRuntimeMode) {
  return mode === 'LAN_HOST';
}

export function splitLanPlayerAuthoritativeUpdates<T extends Record<string, unknown>>(updates: T) {
  const safeUpdates: Partial<T> = {};
  const blockedUpdates: Partial<T> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (LAN_PLAYER_AUTHORITATIVE_FIELDS.has(key)) {
      (blockedUpdates as Record<string, unknown>)[key] = value;
    } else {
      (safeUpdates as Record<string, unknown>)[key] = value;
    }
  }

  return { safeUpdates, blockedUpdates };
}

export function hasLanBlockedUpdates(updates?: Record<string, unknown>) {
  return Boolean(updates && Object.keys(updates).length > 0);
}

export function debugLanFlow(label: string, payload?: Record<string, unknown>) {
  // Nunca use console.log no caminho quente do multiplayer. O console do Android
  // atrasa o socket e a renderizacao quando ha varios celulares conectados.
  try {
    traceApp(inferLanDebugCategory(label), label, {
      ...(payload || {}),
      source: 'debugLanFlow',
      tags: ['lan'],
    });
  } catch {
    // noop
  }
}

function inferLanDebugCategory(label: string) {
  const value = label.toUpperCase();
  if (value.includes('SQLITE') && value.includes('DONE')) return 'SQLITE_WRITE_DONE';
  if (value.includes('SQLITE')) return 'SQLITE_WRITE_START';
  if (value.includes('SOCKET') && value.includes('RECEIVE')) return 'SOCKET_RECEIVE';
  if (value.includes('SOCKET') && value.includes('DONE')) return 'SOCKET_SEND_DONE';
  if (value.includes('SOCKET')) return 'SOCKET_SEND_START';
  if (value.includes('EVENT_CREATED')) return 'EVENT_CREATED';
  if (value.includes('EVENT_RECEIVED') || value.includes('PATCH_RECEIVED')) return 'EVENT_RECEIVED';
  if (value.includes('EVENT_DECISION')) return 'EVENT_DECISION';
  if (value.includes('IGNORE') || value.includes('SKIPPED')) return 'EVENT_IGNORED';
  if (value.includes('APPLY') || value.includes('APPLIED')) return 'EVENT_APPLIED';
  if (value.includes('SENT')) return 'SOCKET_SEND_DONE';
  if (value.includes('PAYLOAD') && value.includes('IGNORE')) return 'PAYLOAD_IGNORED';
  if (value.includes('PAYLOAD')) return 'PAYLOAD_APPLIED';
  if (value.includes('SNAPSHOT') && value.includes('SKIP')) return 'SNAPSHOT_IGNORED';
  if (value.includes('SNAPSHOT')) return 'SNAPSHOT_RECEIVED';
  if (value.includes('PUBLIC_STATUS') && value.includes('IGNORE')) return 'PUBLIC_STATUS_IGNORED';
  if (value.includes('PUBLIC_STATUS')) return 'PUBLIC_STATUS_RECEIVED';
  if (value.includes('RESYNC') && value.includes('DONE')) return 'RESYNC_RECEIVED';
  if (value.includes('RESYNC')) return 'RESYNC_REQUEST';
  if (value.includes('POLL')) return 'POLLING_TICK';
  if (value.includes('KICK')) return 'LAN_KICK';
  if (value.includes('JOIN')) return 'LAN_JOIN';
  if (value.includes('RUNTIME') || value.includes('STATE')) return 'STATE_CHANGE';
  return 'APP';
}
