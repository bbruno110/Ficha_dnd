import * as Clipboard from 'expo-clipboard';

export type AppTraceLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppTraceRecord = {
  id: string;
  timestamp: string;
  timestampMs: number;
  level: AppTraceLevel;
  category: string;
  action: string;
  screen?: string;
  source?: string;
  functionName?: string;
  message?: string;
  sessionId?: string;
  characterId?: string | number;
  characterName?: string;
  playerId?: string | number;
  playerName?: string;
  playerKey?: string;
  eventId?: string;
  eventType?: string;
  envelopeType?: string;
  seq?: string | number;
  serverSeq?: string | number;
  entityType?: string;
  entityId?: string | number;
  entityRevision?: string | number;
  fromKey?: string;
  toKey?: string;
  before?: unknown;
  after?: unknown;
  args?: unknown;
  result?: unknown;
  patch?: unknown;
  payload?: unknown;
  decision?: unknown;
  reason?: string;
  durationMs?: number;
  tags?: string[];
  [key: string]: unknown;
};

export type AppTraceInput = Partial<Omit<AppTraceRecord, 'id' | 'timestamp' | 'timestampMs' | 'category' | 'action'>> & {
  level?: AppTraceLevel;
  [key: string]: unknown;
};

export type AppTraceState = {
  logs: AppTraceRecord[];
  paused: boolean;
  currentScreen?: string;
  mode?: string;
  sessionId?: string;
  characterId?: string | number;
};

const MAX_TRACE_LOGS = 2000;
const MAX_STRING_LENGTH = 1800;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 4;

let logs: AppTraceRecord[] = [];
let paused = false;
let currentScreen = '';
let currentMode = '';
let currentSessionId = '';
let currentCharacterId: string | number | undefined;
let traceCounter = 0;
const listeners = new Set<() => void>();

// Em jogo real, console.log em todo evento LAN causa atraso perceptivel,
// principalmente com 3+ celulares. O trace continua em memoria para exportacao,
// mas console e notificacao de listeners ficam controlados.
let consoleTraceEnabled = false;
let verboseTraceEnabled = false;
let pendingEmit = false;

const ALWAYS_TRACE_CATEGORIES = new Set([
  'ERROR',
  'UI_BUTTON_PRESS',
  'SCREEN',
  'LAN_JOIN',
  'LAN_KICK',
]);

const ALWAYS_TRACE_ACTION_PATTERNS = [
  'SESSION',
  'KICK',
  'JOIN',
  'HOST_UNREACHABLE',
  'NACK',
  'ERROR',
  'BUILD',
];


export function traceApp(category: string, action: string, data: AppTraceInput = {}) {
  try {
    if (paused) return null;
    if (!shouldStoreTrace(category, action, data)) return null;

    const timestampMs = Date.now();
    const safeData = sanitizeValue(data) as Record<string, unknown>;
    const record: AppTraceRecord = {
      ...safeData,
      id: makeTraceId(timestampMs),
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      level: normalizeLevel(safeData.level),
      category,
      action,
    };

    hydrateRecordFromNestedValues(record);
    updateTraceContext(record);

    // Evita copiar o array inteiro em toda linha de log. Em Android isso reduz
    // travadas durante eventos LAN em lote.
    logs.push(record);
    if (logs.length > MAX_TRACE_LOGS) logs = logs.slice(-MAX_TRACE_LOGS);
    scheduleTraceChange();

    if (consoleTraceEnabled) {
      try {
        console.log('[APP TRACE]', category, action, record);
      } catch {
        // Console logging must never affect the app.
      }
    }

    return record;
  } catch {
    return null;
  }
}


function shouldStoreTrace(category: string, action: string, data: AppTraceInput = {}) {
  if (verboseTraceEnabled) return true;
  if (data.level === 'error' || data.level === 'warn') return true;
  if (ALWAYS_TRACE_CATEGORIES.has(category)) return true;
  const value = `${category}:${action}`.toUpperCase();
  if (ALWAYS_TRACE_ACTION_PATTERNS.some((pattern) => value.includes(pattern))) return true;

  // Mantem eventos vivos importantes, mas evita flood de polling/heartbeat/sqlite.
  if (category === 'EVENT_RECEIVED' || category === 'EVENT_APPLIED' || category === 'EVENT_CREATED') {
    const eventType = String(data.eventType || data.type || '').toLowerCase();
    return [
      'player_patch',
      'effect_patch',
      'inventory_patch',
      'session_patch',
      'session_ended',
      'player_kicked',
      'pending_save_patch',
    ].includes(eventType);
  }

  return false;
}

function scheduleTraceChange() {
  if (pendingEmit) return;
  pendingEmit = true;
  setTimeout(() => {
    pendingEmit = false;
    emitTraceChange();
  }, 100);
}

export function setTraceVerbose(enabled: boolean) {
  verboseTraceEnabled = enabled;
  emitTraceChange();
}

export function isTraceVerbose() {
  return verboseTraceEnabled;
}

export function setTraceConsole(enabled: boolean) {
  consoleTraceEnabled = enabled;
}

export function traceButton(screen: string, buttonName: string, data: AppTraceInput = {}) {
  return traceApp('UI_BUTTON_PRESS', buttonName, {
    ...data,
    screen,
    source: data.source || 'button',
    message: data.message || `Botao pressionado: ${buttonName}`,
  });
}

export function traceFunctionCall(functionName: string, args?: unknown, context: AppTraceInput = {}) {
  return traceApp('FUNCTION_CALL', functionName, {
    ...context,
    functionName,
    args,
  });
}

export function traceFunctionReturn(functionName: string, result?: unknown, context: AppTraceInput = {}) {
  return traceApp('FUNCTION_RETURN', functionName, {
    ...context,
    functionName,
    result,
  });
}

export function traceStateChange(
  category: string,
  action: string,
  before: unknown,
  after: unknown,
  data: AppTraceInput = {},
) {
  return traceApp(category, action, {
    ...data,
    before,
    after,
  });
}

export function traceLanEvent(action: string, event: unknown, data: AppTraceInput = {}) {
  return traceApp(inferLanEventCategory(action, event), action, {
    ...data,
    ...extractLanEventFields(event),
    event: summarizeTraceValue(event),
  });
}

export function traceSocket(action: string, data: AppTraceInput = {}) {
  return traceApp(inferSocketCategory(action, data), action, data);
}

export function traceSqlite(action: string, data: AppTraceInput = {}) {
  return traceApp(inferSqliteCategory(action), action, data);
}

export function traceScreen(screen: string, action: string, data: AppTraceInput = {}) {
  currentScreen = screen;
  return traceApp('SCREEN', action, {
    ...data,
    screen,
  });
}

export function traceError(category: string, action: string, error: unknown, data: AppTraceInput = {}) {
  return traceApp('ERROR', action, {
    ...data,
    category,
    level: 'error',
    error: formatTraceError(error),
    message: data.message || getErrorMessage(error),
  });
}

export async function traceAsyncOperation<T>(
  name: string,
  context: AppTraceInput,
  asyncFn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  traceFunctionCall(name, context.args, {
    ...context,
    functionName: name,
  });

  try {
    const result = await asyncFn();
    traceFunctionReturn(name, result, {
      ...context,
      functionName: name,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    traceError('ERROR', name, error, {
      ...context,
      functionName: name,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function getTraceLogs() {
  return logs;
}

export function getTraceState(): AppTraceState {
  return {
    logs,
    paused,
    currentScreen,
    mode: currentMode,
    sessionId: currentSessionId,
    characterId: currentCharacterId,
  };
}

export function subscribeTraceLogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearTraceLogs() {
  logs = [];
  emitTraceChange();
}

export function pauseTrace() {
  traceApp('APP', 'TRACE_PAUSED', { level: 'info' });
  paused = true;
  emitTraceChange();
}

export function resumeTrace() {
  paused = false;
  traceApp('APP', 'TRACE_RESUMED', { level: 'info' });
  emitTraceChange();
}

export function isTracePaused() {
  return paused;
}

export function serializeTraceLogs(options?: { limit?: number; pretty?: boolean }) {
  const selectedLogs = typeof options?.limit === 'number'
    ? logs.slice(-Math.max(0, options.limit))
    : logs;
  const exportedAt = new Date().toISOString();
  const header = [
    '=== APP TRACE EXPORT ===',
    `ExportedAt: ${exportedAt}`,
    `Mode: ${currentMode || ''}`,
    `CurrentScreen: ${currentScreen || ''}`,
    `SessionId: ${currentSessionId || ''}`,
    `CharacterId: ${currentCharacterId ?? ''}`,
    `TotalLogs: ${selectedLogs.length}`,
    '==========',
  ].join('\n');

  const body = options?.pretty
    ? JSON.stringify(selectedLogs, null, 2)
    : selectedLogs.map((entry) => JSON.stringify(entry)).join('\n');

  return `${header}\n${body}`;
}

export async function copyTraceLogsToClipboard(options?: { limit?: number; pretty?: boolean }) {
  const text = serializeTraceLogs(options);
  await Clipboard.setStringAsync(text);
  return text;
}

export function summarizeTraceValue(value: unknown) {
  return sanitizeValue(value, 0);
}

function makeTraceId(timestampMs: number) {
  traceCounter += 1;
  return `trace_${timestampMs}_${traceCounter}`;
}

function emitTraceChange() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listeners are UI-only; ignore failures.
    }
  }
}

function updateTraceContext(record: AppTraceRecord) {
  if (record.screen) currentScreen = String(record.screen);
  if (record.sessionId) currentSessionId = String(record.sessionId);
  if (record.characterId != null) currentCharacterId = record.characterId;
  if (record.mode) currentMode = String(record.mode);
}

function hydrateRecordFromNestedValues(record: AppTraceRecord) {
  const event = (record.event || record.payloadEvent) as Record<string, unknown> | undefined;
  const envelope = (record.envelope || record.messageEnvelope) as Record<string, unknown> | undefined;

  if (event && typeof event === 'object') {
    Object.assign(record, extractLanEventFields(event), record);
  }

  if (envelope && typeof envelope === 'object') {
    if (!record.envelopeType && envelope.type) record.envelopeType = String(envelope.type);
    const nestedEvent = envelope.event as unknown;
    if (nestedEvent) Object.assign(record, extractLanEventFields(nestedEvent), record);
  }
}

function extractLanEventFields(event: unknown): Partial<AppTraceRecord> {
  if (!event || typeof event !== 'object') return {};
  const raw = event as Record<string, unknown>;
  return {
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    eventId: raw.id ? String(raw.id) : undefined,
    eventType: raw.type ? String(raw.type) : undefined,
    seq: raw.seq as string | number | undefined,
    serverSeq: raw.serverSeq as string | number | undefined,
    entityType: raw.entityType ? String(raw.entityType) : undefined,
    entityId: raw.entityId as string | number | undefined,
    entityRevision: raw.entityRevision as string | number | undefined,
    fromKey: raw.fromKey ? String(raw.fromKey) : undefined,
    toKey: raw.toKey ? String(raw.toKey) : undefined,
    patch: raw.numberPatch || raw.effectPatch || raw.inventoryPatch,
  };
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  try {
    if (value == null) return value;
    if (typeof value === 'string') return truncateString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return formatTraceError(value);
    if (depth >= MAX_DEPTH) return summarizeLeaf(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
      if (value.length > MAX_ARRAY_ITEMS) {
        items.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`);
      }
      return items;
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, nestedValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
        result[key] = sanitizeValue(nestedValue, depth + 1);
      }
      if (entries.length > MAX_OBJECT_KEYS) {
        result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
      }
      return result;
    }

    return String(value);
  } catch {
    return '[Unserializable]';
  }
}

function summarizeLeaf(value: unknown) {
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `[Object keys=${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',...' : ''}]`;
  }
  return truncateString(String(value));
}

function truncateString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function normalizeLevel(value: unknown): AppTraceLevel {
  return value === 'debug' || value === 'warn' || value === 'error' ? value : 'info';
}

function inferLanEventCategory(action: string, event: unknown) {
  const normalized = action.toUpperCase();
  const eventType = event && typeof event === 'object' ? String((event as Record<string, unknown>).type || '') : '';
  if (normalized.includes('CREATE')) return 'EVENT_CREATED';
  if (normalized.includes('RECEIVE')) return 'EVENT_RECEIVED';
  if (normalized.includes('DECISION')) return 'EVENT_DECISION';
  if (normalized.includes('IGNORE') || normalized.includes('SKIP')) return 'EVENT_IGNORED';
  if (normalized.includes('APPLY') || normalized.includes('APPLIED')) return 'EVENT_APPLIED';
  if (eventType) return 'EVENT_RECEIVED';
  return 'EVENT_RECEIVED';
}

function inferSocketCategory(action: string, data: AppTraceInput) {
  const normalized = action.toUpperCase();
  const envelopeType = String(data.envelopeType || data.type || '').toUpperCase();
  if (normalized.includes('RECEIVE')) return 'SOCKET_RECEIVE';
  if (normalized.includes('DONE')) return 'SOCKET_SEND_DONE';
  if (normalized.includes('START') || envelopeType) return 'SOCKET_SEND_START';
  return 'SOCKET_SEND_START';
}

function inferSqliteCategory(action: string) {
  const normalized = action.toUpperCase();
  if (normalized.includes('ERROR')) return 'SQLITE_ERROR';
  if (normalized.includes('READ') && normalized.includes('DONE')) return 'SQLITE_READ_DONE';
  if (normalized.includes('READ')) return 'SQLITE_READ_START';
  if (normalized.includes('WRITE') && normalized.includes('DONE')) return 'SQLITE_WRITE_DONE';
  if (normalized.includes('SAVE') || normalized.includes('UPDATE') || normalized.includes('INSERT') || normalized.includes('DELETE')) {
    return normalized.includes('DONE') ? 'SQLITE_WRITE_DONE' : 'SQLITE_WRITE_START';
  }
  return 'SQLITE_READ_START';
}

function formatTraceError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: truncateString(error.stack || ''),
    };
  }
  return {
    message: String(error),
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Erro desconhecido');
}
