import type { SQLiteDatabase } from 'expo-sqlite';

import type { LanSessionEvent, LanSessionPayload } from './lanSession';

export type LanSyncRole = 'master' | 'player';
export type LanConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';
export type LanEnvelopeType =
  | 'hello'
  | 'welcome'
  | 'event_propose'
  | 'event_commit'
  | 'ack'
  | 'resync_request'
  | 'snapshot'
  | 'heartbeat'
  | 'heartbeat_ack'
  | 'session_rejected';

export type LanEnvelopeV2 = {
  protocol: 'ficha-dnd-lan-v2';
  type: LanEnvelopeType;
  sessionId: string;
  deviceId: string;
  sentAt: string;
};

export type LanHelloEnvelope = LanEnvelopeV2 & {
  type: 'hello';
  role: LanSyncRole;
  playerKey?: string;
  characterId?: number;
  characterName?: string;
  lastAppliedSeq: number;
  lastSnapshotSeq: number;
  lastKnownSessionRevision: number;
  pendingClientMsgIds: string[];
};

export type LanWelcomeEnvelope = LanEnvelopeV2 & {
  type: 'welcome';
  currentSeq: number;
  sessionRevision: number;
  snapshot?: LanSessionPayload;
  events: LanSessionEvent[];
};

export type LanAckEnvelope = LanEnvelopeV2 & {
  type: 'ack';
  playerKey: string;
  lastAppliedSeq: number;
  receivedEventIds: string[];
};

export type LanSyncState = {
  sessionId: string;
  deviceId: string;
  role: LanSyncRole;
  playerKey?: string;
  lastAppliedSeq: number;
  lastSnapshotSeq: number;
  lastKnownSessionRevision: number;
  connectionStatus: LanConnectionStatus;
};

export type LanOutboxRow = {
  id: string;
  sessionId: string;
  clientMsgId: string;
  targetRole: string;
  envelope: LanEnvelopeV2;
  status: 'pending' | 'sending' | 'acked' | 'failed';
  retryCount: number;
  nextRetryAt?: string;
};

export async function ensureLanSyncSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_sync_state (
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      role TEXT NOT NULL,
      player_key TEXT,
      last_applied_seq INTEGER NOT NULL DEFAULT 0,
      last_snapshot_seq INTEGER NOT NULL DEFAULT 0,
      last_known_session_revision INTEGER NOT NULL DEFAULT 0,
      connection_status TEXT NOT NULL DEFAULT 'offline',
      last_connected_at TEXT,
      last_disconnected_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS lan_outbox (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      client_msg_id TEXT NOT NULL,
      target_role TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      acked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_player_acks (
      session_id TEXT NOT NULL,
      player_key TEXT NOT NULL,
      last_applied_seq INTEGER NOT NULL DEFAULT 0,
      last_ack_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pending_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, player_key)
    );

    CREATE TABLE IF NOT EXISTS lan_session_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      snapshot_seq INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns: [string, string, string][] = [
    ['lan_session_events', 'server_seq', 'INTEGER'],
    ['lan_session_events', 'entity_type', 'TEXT'],
    ['lan_session_events', 'entity_id', 'TEXT'],
    ['lan_session_events', 'entity_revision', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_events', 'ack_required', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_events', 'delivered_at', 'TEXT'],
    ['lan_session_events', 'applied_at', 'TEXT'],
  ];

  for (const [table, column, definition] of columns) {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch {
      // Column already exists.
    }
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_lan_sync_state_session ON lan_sync_state(session_id, role);
    CREATE INDEX IF NOT EXISTS idx_lan_outbox_session_status ON lan_outbox(session_id, status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_lan_outbox_client_msg ON lan_outbox(session_id, client_msg_id);
    CREATE INDEX IF NOT EXISTS idx_lan_snapshots_session_seq ON lan_session_snapshots(session_id, snapshot_seq DESC);
  `);

  try {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_lan_events_session_server_seq ON lan_session_events(session_id, server_seq);
      CREATE INDEX IF NOT EXISTS idx_lan_events_session_client_msg ON lan_session_events(session_id, client_msg_id);
    `);
  } catch {
    // The base LAN schema creates this table; callers that arrive earlier can retry later.
  }
}

export async function getLanSyncState(
  db: SQLiteDatabase,
  sessionId: string,
  deviceId: string,
  role: LanSyncRole = 'player'
): Promise<LanSyncState> {
  await ensureLanSyncSchema(db);

  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT *
     FROM lan_sync_state
     WHERE session_id = ? AND device_id = ?
     LIMIT 1`,
    [sessionId, deviceId]
  );

  if (!row) {
    return {
      sessionId,
      deviceId,
      role,
      lastAppliedSeq: 0,
      lastSnapshotSeq: 0,
      lastKnownSessionRevision: 0,
      connectionStatus: 'offline',
    };
  }

  return {
    sessionId,
    deviceId,
    role: row.role === 'master' ? 'master' : 'player',
    playerKey: row.player_key ? String(row.player_key) : undefined,
    lastAppliedSeq: toNumber(row.last_applied_seq),
    lastSnapshotSeq: toNumber(row.last_snapshot_seq),
    lastKnownSessionRevision: toNumber(row.last_known_session_revision),
    connectionStatus: normalizeConnectionStatus(row.connection_status),
  };
}

export async function markLanConnectionStatus(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    deviceId: string;
    role?: LanSyncRole;
    playerKey?: string;
    status: LanConnectionStatus;
  }
) {
  await ensureLanSyncSchema(db);

  await db.runAsync(
    `INSERT INTO lan_sync_state (
       session_id, device_id, role, player_key, connection_status,
       last_connected_at, last_disconnected_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'online' THEN CURRENT_TIMESTAMP ELSE NULL END,
             CASE WHEN ? = 'offline' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id, device_id) DO UPDATE SET
       role = excluded.role,
       player_key = COALESCE(excluded.player_key, lan_sync_state.player_key),
       connection_status = excluded.connection_status,
       last_connected_at = CASE WHEN excluded.connection_status = 'online' THEN CURRENT_TIMESTAMP ELSE lan_sync_state.last_connected_at END,
       last_disconnected_at = CASE WHEN excluded.connection_status = 'offline' THEN CURRENT_TIMESTAMP ELSE lan_sync_state.last_disconnected_at END,
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.sessionId,
      input.deviceId,
      input.role || 'player',
      input.playerKey || null,
      input.status,
      input.status,
      input.status,
    ]
  );
}

export async function shouldApplyLanSnapshot(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    deviceId: string;
    role?: LanSyncRole;
    snapshotSeq: number;
  }
) {
  const state = await getLanSyncState(db, input.sessionId, input.deviceId, input.role || 'player');

  // Snapshot repetido ou antigo não deve sobrescrever patch/evento já aplicado.
  // Antes estava usando >= lastAppliedSeq; isso permitia reaplicar o mesmo payload
  // salvo e causava piscada: valor novo -> valor antigo -> valor novo.
  if (input.snapshotSeq <= state.lastSnapshotSeq) return false;
  if (input.snapshotSeq < state.lastAppliedSeq) return false;
  return true;
}

export async function markLanSnapshotApplied(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    deviceId: string;
    role?: LanSyncRole;
    playerKey?: string;
    snapshotSeq: number;
    sessionRevision?: number;
  }
) {
  await ensureLanSyncSchema(db);

  await db.runAsync(
    `INSERT INTO lan_sync_state (
       session_id, device_id, role, player_key, last_applied_seq,
       last_snapshot_seq, last_known_session_revision, connection_status, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'online', CURRENT_TIMESTAMP)
     ON CONFLICT(session_id, device_id) DO UPDATE SET
       role = excluded.role,
       player_key = COALESCE(excluded.player_key, lan_sync_state.player_key),
       last_applied_seq = MAX(lan_sync_state.last_applied_seq, excluded.last_applied_seq),
       last_snapshot_seq = MAX(lan_sync_state.last_snapshot_seq, excluded.last_snapshot_seq),
       last_known_session_revision = MAX(lan_sync_state.last_known_session_revision, excluded.last_known_session_revision),
       connection_status = 'online',
       last_connected_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.sessionId,
      input.deviceId,
      input.role || 'player',
      input.playerKey || null,
      input.snapshotSeq,
      input.snapshotSeq,
      input.sessionRevision || 0,
    ]
  );
}

export async function markLanEventsApplied(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    deviceId: string;
    role?: LanSyncRole;
    playerKey?: string;
    events: LanSessionEvent[];
  }
) {
  const sequencedEvents = orderLanEvents(input.events).filter((event) => Number.isFinite(event.seq));
  if (sequencedEvents.length === 0) return;

  await ensureLanSyncSchema(db);

  const state = await getLanSyncState(db, input.sessionId, input.deviceId, input.role || 'player');
  let nextSeq = state.lastAppliedSeq;

  for (const event of sequencedEvents) {
    const seq = Number(event.seq);
    if (seq <= nextSeq) continue;

    if (nextSeq > 0 && seq !== nextSeq + 1) {
      break;
    }

    nextSeq = seq;
  }

  if (nextSeq <= state.lastAppliedSeq) return;

  await db.runAsync(
    `INSERT INTO lan_sync_state (
       session_id, device_id, role, player_key, last_applied_seq,
       connection_status, last_connected_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 'online', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id, device_id) DO UPDATE SET
       role = excluded.role,
       player_key = COALESCE(excluded.player_key, lan_sync_state.player_key),
       last_applied_seq = MAX(lan_sync_state.last_applied_seq, excluded.last_applied_seq),
       connection_status = 'online',
       last_connected_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [input.sessionId, input.deviceId, input.role || 'player', input.playerKey || null, nextSeq]
  );

  if (input.playerKey) {
    await saveLanPlayerAck(db, {
      sessionId: input.sessionId,
      playerKey: input.playerKey,
      lastAppliedSeq: nextSeq,
    });
  }
}

export async function saveLanPlayerAck(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    playerKey: string;
    lastAppliedSeq: number;
    pendingCount?: number;
  }
) {
  await ensureLanSyncSchema(db);

  await db.runAsync(
    `INSERT INTO lan_player_acks (session_id, player_key, last_applied_seq, pending_count, last_ack_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id, player_key) DO UPDATE SET
       last_applied_seq = MAX(lan_player_acks.last_applied_seq, excluded.last_applied_seq),
       pending_count = excluded.pending_count,
       last_ack_at = CURRENT_TIMESTAMP`,
    [input.sessionId, input.playerKey, input.lastAppliedSeq, input.pendingCount || 0]
  );
}

export async function enqueueLanOutbox(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    clientMsgId: string;
    targetRole: 'master' | 'player';
    envelope: LanEnvelopeV2;
  }
) {
  await ensureLanSyncSchema(db);

  const existing = await db.getFirstAsync<{ id: string; status: string }>(
    `SELECT id, status FROM lan_outbox WHERE session_id = ? AND client_msg_id = ? LIMIT 1`,
    [input.sessionId, input.clientMsgId]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE lan_outbox
       SET envelope_json = ?,
           status = CASE WHEN status = 'acked' THEN 'acked' ELSE 'pending' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(input.envelope), existing.id]
    );
    return;
  }

  const id = `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.runAsync(
    `INSERT INTO lan_outbox (id, session_id, client_msg_id, target_role, envelope_json, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [
      id,
      input.sessionId,
      input.clientMsgId,
      input.targetRole,
      JSON.stringify(input.envelope),
    ]
  );
}

export async function listPendingLanOutbox(
  db: SQLiteDatabase,
  sessionId: string,
  limit = 25
): Promise<LanOutboxRow[]> {
  await ensureLanSyncSchema(db);

  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT *
     FROM lan_outbox
     WHERE session_id = ?
       AND status IN ('pending', 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
     ORDER BY created_at ASC
     LIMIT ?`,
    [sessionId, limit]
  );

  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    clientMsgId: String(row.client_msg_id),
    targetRole: String(row.target_role),
    envelope: parseJsonValue<LanEnvelopeV2>(row.envelope_json, {
      protocol: 'ficha-dnd-lan-v2',
      type: 'resync_request',
      sessionId,
      deviceId: 'unknown',
      sentAt: new Date().toISOString(),
    }),
    status: normalizeOutboxStatus(row.status),
    retryCount: toNumber(row.retry_count),
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : undefined,
  }));
}

export async function markLanOutboxAttempt(
  db: SQLiteDatabase,
  id: string,
  retryCount: number
) {
  await ensureLanSyncSchema(db);
  const nextDelaySeconds = Math.min(15, Math.max(1, retryCount === 0 ? 1 : retryCount * 2));

  await db.runAsync(
    `UPDATE lan_outbox
     SET status = 'failed',
         retry_count = ?,
         next_retry_at = datetime('now', '+' || ? || ' seconds'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status != 'acked'`,
    [retryCount + 1, nextDelaySeconds, id]
  );
}

export async function markLanOutboxAcked(
  db: SQLiteDatabase,
  sessionId: string,
  clientMsgId: string
) {
  await ensureLanSyncSchema(db);

  await db.runAsync(
    `UPDATE lan_outbox
     SET status = 'acked',
         acked_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE session_id = ? AND client_msg_id = ?`,
    [sessionId, clientMsgId]
  );
}

export async function buildWelcomeForPlayer(
  db: SQLiteDatabase,
  hello: LanHelloEnvelope
): Promise<LanWelcomeEnvelope> {
  await ensureLanSyncSchema(db);

  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT current_seq, payload_json
     FROM lan_sessions
     WHERE id = ?`,
    [hello.sessionId]
  );
  const currentSeq = toNumber(session?.current_seq);
  const events = await db.getAllAsync<{ payload_json: string }>(
    `SELECT payload_json
     FROM lan_session_events
     WHERE session_id = ? AND COALESCE(seq, server_seq, 0) > ?
     ORDER BY COALESCE(seq, server_seq, 0) ASC
     LIMIT 100`,
    [hello.sessionId, hello.lastAppliedSeq]
  );
  const parsedEvents = events
    .map((row) => parseJsonValue<LanSessionEvent | null>(row.payload_json, null))
    .filter(Boolean) as LanSessionEvent[];
  const firstSeq = parsedEvents[0]?.seq || 0;
  const shouldSendSnapshot = hello.lastAppliedSeq === 0 || (firstSeq > 0 && firstSeq !== hello.lastAppliedSeq + 1);
  const snapshot = shouldSendSnapshot
    ? parseJsonValue<LanSessionPayload | undefined>(session?.payload_json, undefined)
    : undefined;

  return {
    protocol: 'ficha-dnd-lan-v2',
    type: 'welcome',
    sessionId: hello.sessionId,
    deviceId: 'master',
    sentAt: new Date().toISOString(),
    currentSeq,
    sessionRevision: currentSeq,
    snapshot,
    events: parsedEvents,
  };
}

export async function saveLanSessionSnapshot(
  db: SQLiteDatabase,
  payload: LanSessionPayload,
  snapshotSeq = getLanPayloadSnapshotSeq(payload)
) {
  await ensureLanSyncSchema(db);

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM lan_session_snapshots WHERE session_id = ? AND snapshot_seq = ? LIMIT 1`,
    [payload.session.id, snapshotSeq]
  );
  if (existing) return;

  const id = `snapshot_${payload.session.id}_${snapshotSeq}_${Date.now()}`;
  await db.runAsync(
    `INSERT INTO lan_session_snapshots (id, session_id, snapshot_seq, revision, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      payload.session.id,
      snapshotSeq,
      getSessionRevision(payload),
      JSON.stringify(payload),
    ]
  );
}

export function getLanPayloadSnapshotSeq(payload?: LanSessionPayload | null) {
  if (!payload) return 0;
  return Math.max(0, ...((payload.events || []).map((event) => toNumber(event.seq))));
}

export function orderLanEvents(events: LanSessionEvent[]) {
  return [...events].sort((a, b) => toNumber(a.seq) - toNumber(b.seq));
}

function getSessionRevision(payload: LanSessionPayload) {
  return Math.max(
    getLanPayloadSnapshotSeq(payload),
    toNumber(payload.state?.currentTurn) + toNumber(payload.state?.elapsedMinutes)
  );
}

function normalizeConnectionStatus(value: unknown): LanConnectionStatus {
  if (value === 'connecting' || value === 'online' || value === 'reconnecting') return value;
  return 'offline';
}

function normalizeOutboxStatus(value: unknown): LanOutboxRow['status'] {
  if (value === 'sending' || value === 'acked' || value === 'failed') return value;
  return 'pending';
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
