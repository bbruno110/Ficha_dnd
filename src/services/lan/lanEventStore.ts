import type { SQLiteDatabase } from 'expo-sqlite';

import type { LanSessionEvent } from '../lanSession';

export type LanEventCommitResult = {
  event: LanSessionEvent;
  inserted: boolean;
};

export async function ensureLanEventStoreSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER,
      server_seq INTEGER,
      type TEXT NOT NULL,
      from_key TEXT,
      to_key TEXT,
      client_msg_id TEXT,
      payload_json TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT,
      entity_id TEXT,
      entity_revision INTEGER NOT NULL DEFAULT 0,
      ack_required INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      applied_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns: [string, string, string][] = [
    ['lan_sessions', 'current_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_events', 'seq', 'INTEGER'],
    ['lan_session_events', 'server_seq', 'INTEGER'],
    ['lan_session_events', 'from_key', 'TEXT'],
    ['lan_session_events', 'to_key', 'TEXT'],
    ['lan_session_events', 'client_msg_id', 'TEXT'],
    ['lan_session_events', 'processed', 'INTEGER NOT NULL DEFAULT 0'],
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
      // Table/column already exists or is created by the caller's base schema.
    }
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_seq ON lan_session_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_server_seq ON lan_session_events(session_id, server_seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_client_msg ON lan_session_events(session_id, client_msg_id);
    CREATE INDEX IF NOT EXISTS idx_lan_events_entity_revision ON lan_session_events(session_id, entity_type, entity_id, entity_revision);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_created ON lan_session_events(session_id, created_at);
  `);
}

export async function commitLanEvent(
  db: SQLiteDatabase,
  event: LanSessionEvent,
): Promise<LanEventCommitResult> {
  await ensureLanEventStoreSchema(db);

  const existingById = await db.getFirstAsync<{ payload_json: string }>(
    `SELECT payload_json FROM lan_session_events WHERE id = ? LIMIT 1`,
    [event.id]
  );
  if (existingById) {
    return { event: parseLanEvent(existingById.payload_json, event) || event, inserted: false };
  }

  if (event.clientMsgId) {
    const existingByClientMsg = await db.getFirstAsync<{ payload_json: string }>(
      `SELECT payload_json
       FROM lan_session_events
       WHERE session_id = ? AND client_msg_id = ?
       LIMIT 1`,
      [event.sessionId, event.clientMsgId]
    );
    if (existingByClientMsg) {
      return { event: parseLanEvent(existingByClientMsg.payload_json, event) || event, inserted: false };
    }
  }

  const entityType = event.entityType || inferLanEventEntityType(event);
  const entityId = String(event.entityId || inferLanEventEntityId(event));
  const serverSeq = await resolveServerSeq(db, event);
  const entityRevision = await nextEntityRevision(db, event, entityType, entityId);
  const committedEvent: LanSessionEvent = {
    ...event,
    protocol: event.protocol || 'ficha-dnd-lan-v2',
    seq: serverSeq,
    serverSeq,
    entityType,
    entityId,
    entityRevision,
    ackRequired: event.ackRequired ?? shouldRequireLanAck(event),
  };

  await db.runAsync(
    `INSERT INTO lan_session_events (
       id, session_id, seq, server_seq, type, from_key, to_key, client_msg_id,
       payload_json, processed, entity_type, entity_id, entity_revision, ack_required, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      committedEvent.id,
      committedEvent.sessionId,
      committedEvent.seq ?? null,
      committedEvent.serverSeq ?? committedEvent.seq ?? null,
      committedEvent.type,
      committedEvent.fromKey || null,
      committedEvent.toKey || null,
      committedEvent.clientMsgId || null,
      JSON.stringify(committedEvent),
      committedEvent.entityType || null,
      committedEvent.entityId || null,
      committedEvent.entityRevision ?? 0,
      committedEvent.ackRequired ? 1 : 0,
      committedEvent.createdAt || new Date().toISOString(),
    ]
  );

  return { event: committedEvent, inserted: true };
}

export async function listLanEvents(
  db: SQLiteDatabase,
  sessionId: string,
  limit = 30,
): Promise<LanSessionEvent[]> {
  await ensureLanEventStoreSchema(db);
  const rows = await db.getAllAsync<{ payload_json: string }>(
    `SELECT payload_json
     FROM lan_session_events
     WHERE session_id = ?
     ORDER BY COALESCE(seq, server_seq, 0) DESC, created_at DESC
     LIMIT ?`,
    [sessionId, limit]
  );

  return rows.map((row) => parseLanEvent(row.payload_json, null)).filter(Boolean) as LanSessionEvent[];
}

export async function listLanEventsAfterSeq(
  db: SQLiteDatabase,
  sessionId: string,
  afterSeq: number,
  limit = 100,
): Promise<LanSessionEvent[]> {
  await ensureLanEventStoreSchema(db);
  const rows = await db.getAllAsync<{ payload_json: string }>(
    `SELECT payload_json
     FROM lan_session_events
     WHERE session_id = ? AND COALESCE(seq, server_seq, 0) > ?
     ORDER BY COALESCE(seq, server_seq, 0) ASC
     LIMIT ?`,
    [sessionId, Math.max(0, Math.floor(Number(afterSeq) || 0)), limit]
  );

  return rows.map((row) => parseLanEvent(row.payload_json, null)).filter(Boolean) as LanSessionEvent[];
}

export async function markLanEventDelivered(db: SQLiteDatabase, eventId: string) {
  await ensureLanEventStoreSchema(db);
  await db.runAsync(
    `UPDATE lan_session_events SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    [eventId]
  );
}

async function resolveServerSeq(db: SQLiteDatabase, event: LanSessionEvent) {
  const providedSeq = toNumber(event.serverSeq ?? event.seq);
  if (providedSeq > 0) {
    await db.runAsync(
      `UPDATE lan_sessions
       SET current_seq = MAX(COALESCE(current_seq, 0), ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [providedSeq, event.sessionId]
    );
    return providedSeq;
  }

  return nextServerSeq(db, event.sessionId);
}

async function nextServerSeq(db: SQLiteDatabase, sessionId: string) {
  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT current_seq FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  const nextSeq = toNumber(session?.current_seq) + 1;
  await db.runAsync(
    `UPDATE lan_sessions SET current_seq = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [nextSeq, sessionId]
  );
  return nextSeq;
}

async function nextEntityRevision(
  db: SQLiteDatabase,
  event: LanSessionEvent,
  entityType: string,
  entityId: string,
) {
  const provided = toNumber(event.entityRevision);
  if (provided > 0) return provided;

  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT MAX(entity_revision) as maxRevision
     FROM lan_session_events
     WHERE session_id = ? AND entity_type = ? AND entity_id = ?`,
    [event.sessionId, entityType, entityId]
  );

  return toNumber(row?.maxRevision) + 1;
}

function inferLanEventEntityType(event: LanSessionEvent) {
  if (event.type === 'session_patch' || event.type === 'session_ended' || event.type === 'timeline_event') return 'session';
  if (event.type.includes('save')) return 'save';
  if (event.type.includes('action') || event.type.includes('skill') || event.type.includes('spell') || event.type.includes('ability')) return 'action';
  if (
    event.type === 'inventory_patch' ||
    event.type === 'send_item' ||
    event.type === 'send_item_request' ||
    event.type === 'send_item_result' ||
    event.type.startsWith('trade_')
  ) return 'inventory';
  if (event.type === 'coin_self_patch_request') return 'player';
  if (event.type === 'effect_patch' || event.type === 'effect_catalog_patch' || event.type === 'effect_expired') return 'effect';
  if (event.type === 'resource_request' || event.type === 'resource_review' || event.type === 'pending_save_patch') return 'request';
  return 'player';
}

function inferLanEventEntityId(event: LanSessionEvent) {
  return event.toKey || event.fromKey || event.tradeId || event.sessionId;
}

function shouldRequireLanAck(event: LanSessionEvent) {
  return event.toKey !== 'master' && event.toKey !== 'party' && event.toKey !== 'session';
}

function parseLanEvent(value: unknown, fallback: LanSessionEvent | null): LanSessionEvent | null {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as LanSessionEvent;

  try {
    return JSON.parse(value) as LanSessionEvent;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
