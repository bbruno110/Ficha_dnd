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
  // Log temporario para diagnostico LAN. Remova depois que o fluxo estiver estabilizado.
  try {
    console.log(`[LAN DEBUG] ${label}`, payload || {});
  } catch {
    // noop
  }
}
