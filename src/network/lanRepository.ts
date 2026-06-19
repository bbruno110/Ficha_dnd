import { SQLiteDatabase } from 'expo-sqlite';
import {
  LanCharacterSnapshot,
  LanContentTable,
  LanCampaignState,
  LanCustomContentPayload,
  LanCustomContentRef,
  LanCustomContentType,
  LanOfficialEventMessage,
  LanOfficialEventType,
  LanRole,
  LanSessionRecord,
  LanSessionStatus,
} from '../types/lan';

export const CUSTOM_CONTENT_DEFINITIONS: {
  type: LanCustomContentType;
  tableName: LanContentTable;
  titleField: string;
  subtitleFields: string[];
}[] = [
  { type: 'Item', tableName: 'items', titleField: 'name', subtitleFields: ['properties', 'damage'] },
  { type: 'Efeito', tableName: 'effects', titleField: 'effect_type', subtitleFields: ['effect_kind', 'source_table'] },
  { type: 'Raca', tableName: 'races', titleField: 'name', subtitleFields: ['speed'] },
  { type: 'Classe', tableName: 'classes', titleField: 'name', subtitleFields: ['hit_dice', 'saves'] },
  { type: 'Subclasse', tableName: 'subclasses', titleField: 'name', subtitleFields: ['class_name', 'level_required'] },
  { type: 'Magia/Skill', tableName: 'spells', titleField: 'name', subtitleFields: ['level', 'category'] },
  { type: 'Kit', tableName: 'starting_kits', titleField: 'name', subtitleFields: ['target_name', 'target_type'] },
];

export const LAN_ALL_CUSTOM_CONTENT_KEY = '__LAN_ALL_CUSTOM_CONTENT__';

const TABLE_COLUMNS: Record<LanContentTable, string[]> = {
  items: ['name', 'weight', 'damage', 'damage_type', 'category', 'is_consumable', 'properties', 'descricao', 'criador'],
  effects: [
    'source_table',
    'source_id',
    'source_name',
    'trigger',
    'effect_kind',
    'effect_type',
    'condition_name',
    'value_mode',
    'dice_count',
    'dice_sides',
    'dice_bonus',
    'fixed_value',
    'chance_percent',
    'duration_value',
    'duration_unit',
    'target',
    'stacking',
    'notes',
    'metadata',
    'sort_order',
    'criador',
  ],
  races: ['name', 'stat_bonuses', 'speed', 'features', 'criador'],
  classes: [
    'name',
    'recommended_stats',
    'starting_equipment',
    'starting_gold',
    'hit_dice',
    'saves',
    'subclass_level',
    'is_caster',
    'features',
    'criador',
  ],
  subclasses: ['name', 'class_name', 'level_required', 'bonus_skills', 'features', 'criador'],
  spells: [
    'name',
    'level',
    'category',
    'classes',
    'casting_time',
    'casting_time_value',
    'casting_time_unit',
    'range',
    'range_value',
    'range_unit',
    'range_shape',
    'components',
    'duration',
    'duration_value',
    'duration_unit',
    'damage_dice',
    'damage_type',
    'saving_throw',
    'description',
    'class_level_required',
    'criador',
  ],
  starting_kits: ['name', 'target_name', 'target_type', 'items', 'criador'],
  spellcasting_progression: [
    'source_type',
    'source_name',
    'level',
    'cantrips_known',
    'spells_known',
    'slot_1',
    'slot_2',
    'slot_3',
    'slot_4',
    'slot_5',
    'slot_6',
    'slot_7',
    'slot_8',
    'slot_9',
    'criador',
  ],
};

const TABLE_KEY_COLUMNS: Record<LanContentTable, string[]> = {
  items: ['name'],
  effects: ['source_table', 'source_name', 'effect_kind', 'effect_type', 'sort_order'],
  races: ['name'],
  classes: ['name'],
  subclasses: ['name', 'class_name'],
  spells: ['name'],
  starting_kits: ['name', 'target_name', 'target_type'],
  spellcasting_progression: ['source_type', 'source_name', 'level'],
};

function makeDeviceId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseSelectedContent(raw?: string | null) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function makeRefKey(tableName: LanContentTable, id: number) {
  return `${tableName}-${id}`;
}

function toSqlValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

export async function getOrCreateDeviceId(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ device_id: string }>(
    `SELECT device_id FROM lan_device_identity WHERE id = 'local'`
  );

  if (row?.device_id) return row.device_id;

  const deviceId = makeDeviceId();
  await db.runAsync(`INSERT INTO lan_device_identity (id, device_id) VALUES ('local', ?)`, [deviceId]);
  return deviceId;
}

export async function updateLocalPlayerName(db: SQLiteDatabase, playerName: string) {
  const deviceId = await getOrCreateDeviceId(db);
  await db.runAsync(
    `INSERT OR REPLACE INTO lan_device_identity (id, device_id, player_name) VALUES ('local', ?, ?)`,
    [deviceId, playerName]
  );
}

function toJsonText(value: unknown) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function fromJsonText(value?: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function makeEventId(sessionId: string, seq: number) {
  return `evt_${sessionId}_${seq}_${Date.now().toString(36)}`;
}

export async function getLocalPlayerName(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ player_name?: string | null }>(
    `SELECT player_name FROM lan_device_identity WHERE id = 'local'`
  );

  return row?.player_name || 'Jogador';
}

export async function closeOpenLanSessions(db: SQLiteDatabase, role?: LanRole) {
  if (role) {
    await db.runAsync(
      `UPDATE lan_sessions SET status = 'inactive', linked_character_id = NULL WHERE role = ? AND status IN ('open', 'connected')`,
      [role]
    );
    return;
  }

  await db.runAsync(
    `UPDATE lan_sessions SET status = 'inactive', linked_character_id = NULL WHERE status IN ('open', 'connected')`
  );
}

export async function saveLanSession(db: SQLiteDatabase, session: LanSessionRecord) {
  await db.runAsync(
    `INSERT OR REPLACE INTO lan_sessions (
      id, name, role, status, session_code, host_ip, port, sync_custom_content,
      selected_content, allow_existing_character, linked_character_id, opened_at, closed_at, last_connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.name,
      session.role,
      session.status,
      session.session_code || null,
      session.host_ip || null,
      session.port || null,
      session.sync_custom_content,
      session.selected_content || '[]',
      session.allow_existing_character,
      session.linked_character_id || null,
      session.opened_at || new Date().toISOString(),
      session.closed_at || null,
      session.last_connected_at || null,
    ]
  );

  await ensureLanSessionState(db, session.id, session.status);
}

export async function setLanSessionStatus(db: SQLiteDatabase, sessionId: string, status: LanSessionStatus) {
  await db.runAsync(
    `UPDATE lan_sessions
     SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN CURRENT_TIMESTAMP ELSE closed_at END,
         paused_at = CASE WHEN ? = 'paused' THEN CURRENT_TIMESTAMP ELSE paused_at END,
         resumed_at = CASE WHEN ? IN ('open', 'connected') THEN CURRENT_TIMESTAMP ELSE resumed_at END,
         last_connected_at = CASE WHEN ? IN ('open', 'connected') THEN CURRENT_TIMESTAMP ELSE last_connected_at END,
         linked_character_id = CASE WHEN ? IN ('closed', 'inactive') THEN NULL ELSE linked_character_id END
     WHERE id = ?`,
    [status, status, status, status, status, status, sessionId]
  );

  await db.runAsync(
    `UPDATE lan_session_state
     SET status = ?, paused = CASE WHEN ? = 'paused' THEN 1 ELSE 0 END, updated_at = CURRENT_TIMESTAMP
     WHERE session_id = ?`,
    [status, status, sessionId]
  );
}

export async function getLanSessions(db: SQLiteDatabase, includeClosed = false) {
  return db.getAllAsync<LanSessionRecord>(
    `SELECT * FROM lan_sessions
     ${includeClosed ? '' : `WHERE status NOT IN ('closed', 'inactive')`}
     ORDER BY
       CASE status
         WHEN 'open' THEN 0
         WHEN 'connected' THEN 0
         WHEN 'paused' THEN 1
         WHEN 'inactive' THEN 2
         ELSE 3
       END,
       COALESCE(last_connected_at, resumed_at, paused_at, opened_at, created_at) DESC`
  );
}

export async function getLanSessionById(db: SQLiteDatabase, sessionId: string) {
  return db.getFirstAsync<LanSessionRecord>(
    `SELECT * FROM lan_sessions WHERE id = ? LIMIT 1`,
    [sessionId]
  );
}

export async function getActiveLanSession(db: SQLiteDatabase) {
  return db.getFirstAsync<LanSessionRecord>(
    `SELECT * FROM lan_sessions
     WHERE status IN ('open', 'connected')
     ORDER BY
       CASE status
         WHEN 'open' THEN 0
         WHEN 'connected' THEN 0
         ELSE 2
       END,
       COALESCE(last_connected_at, resumed_at, paused_at, opened_at, created_at) DESC
     LIMIT 1`
  );
}

export async function ensureLanSessionState(db: SQLiteDatabase, sessionId: string, status: LanSessionStatus = 'open') {
  await db.runAsync(
    `INSERT OR IGNORE INTO lan_session_state (session_id, status, turn, campaign_minutes, paused, last_event_seq)
     VALUES (?, ?, 1, 0, ?, 0)`,
    [sessionId, status, status === 'paused' ? 1 : 0]
  );
}

export async function getLanSessionState(db: SQLiteDatabase, sessionId: string): Promise<LanCampaignState> {
  await ensureLanSessionState(db, sessionId);
  const row = await db.getFirstAsync<{
    session_id: string;
    status: LanSessionStatus;
    turn: number;
    campaign_minutes: number;
    paused: number;
    updated_at: string;
  }>(`SELECT * FROM lan_session_state WHERE session_id = ?`, [sessionId]);

  return {
    sessionId,
    status: row?.status || 'open',
    turn: Number(row?.turn || 1),
    campaignMinutes: Number(row?.campaign_minutes || 0),
    paused: Boolean(row?.paused),
    updatedAt: row?.updated_at || new Date().toISOString(),
  };
}

export async function updateLanSessionState(
  db: SQLiteDatabase,
  sessionId: string,
  updates: Partial<Pick<LanCampaignState, 'status' | 'turn' | 'campaignMinutes' | 'paused'>>
) {
  await ensureLanSessionState(db, sessionId);
  const entries: [string, string | number][] = [];
  if (updates.status) entries.push(['status', updates.status]);
  if (updates.turn !== undefined) entries.push(['turn', updates.turn]);
  if (updates.campaignMinutes !== undefined) entries.push(['campaign_minutes', updates.campaignMinutes]);
  if (updates.paused !== undefined) entries.push(['paused', updates.paused ? 1 : 0]);
  if (entries.length === 0) return;

  await db.runAsync(
    `UPDATE lan_session_state SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`,
    [...entries.map(([, value]) => value), sessionId]
  );
}

export async function getNextLanEventSeq(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSessionState(db, sessionId);
  await db.runAsync(
    `UPDATE lan_session_state
     SET last_event_seq = IFNULL(last_event_seq, 0) + 1, updated_at = CURRENT_TIMESTAMP
     WHERE session_id = ?`,
    [sessionId]
  );
  const row = await db.getFirstAsync<{ last_event_seq: number }>(
    `SELECT last_event_seq FROM lan_session_state WHERE session_id = ?`,
    [sessionId]
  );
  return Number(row?.last_event_seq || 0);
}

export async function appendLanOfficialEvent(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    eventType: LanOfficialEventType;
    commandId?: string | null;
    actorDeviceId?: string | null;
    actorName?: string | null;
    targetDeviceId?: string | null;
    targetCharacterId?: number | null;
    targetName?: string | null;
    previousValue?: unknown;
    currentValue?: unknown;
    description: string;
    payload?: Record<string, unknown>;
  }
): Promise<LanOfficialEventMessage> {
  const seq = await getNextLanEventSeq(db, input.sessionId);
  const at = new Date().toISOString();
  const event: LanOfficialEventMessage = {
    type: 'LAN_EVENT',
    sessionId: input.sessionId,
    eventId: makeEventId(input.sessionId, seq),
    seq,
    commandId: input.commandId || null,
    eventType: input.eventType,
    actorDeviceId: input.actorDeviceId || null,
    actorName: input.actorName || null,
    targetDeviceId: input.targetDeviceId || null,
    targetCharacterId: input.targetCharacterId || null,
    targetName: input.targetName || null,
    previousValue: input.previousValue,
    currentValue: input.currentValue,
    description: input.description,
    payload: input.payload || {},
    at,
  };

  await db.runAsync(
    `INSERT OR IGNORE INTO lan_event_log (
      session_id, seq, event_id, command_id, event_type, actor_device_id, actor_name,
      target_device_id, target_character_id, target_name, previous_value, current_value,
      description, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.sessionId,
      event.seq,
      event.eventId,
      event.commandId || null,
      event.eventType,
      event.actorDeviceId || null,
      event.actorName || null,
      event.targetDeviceId || null,
      event.targetCharacterId || null,
      event.targetName || null,
      toJsonText(event.previousValue),
      toJsonText(event.currentValue),
      event.description,
      JSON.stringify(event.payload || {}),
      event.at,
    ]
  );

  return event;
}

export async function saveLanOfficialEvent(db: SQLiteDatabase, event: LanOfficialEventMessage) {
  await ensureLanSessionState(db, event.sessionId);
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM lan_event_log WHERE session_id = ? AND event_id = ? LIMIT 1`,
    [event.sessionId, event.eventId]
  );
  if (existing?.id) return false;

  await db.runAsync(
    `INSERT OR IGNORE INTO lan_event_log (
      session_id, seq, event_id, command_id, event_type, actor_device_id, actor_name,
      target_device_id, target_character_id, target_name, previous_value, current_value,
      description, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.sessionId,
      event.seq,
      event.eventId,
      event.commandId || null,
      event.eventType,
      event.actorDeviceId || null,
      event.actorName || null,
      event.targetDeviceId || null,
      event.targetCharacterId || null,
      event.targetName || null,
      toJsonText(event.previousValue),
      toJsonText(event.currentValue),
      event.description,
      JSON.stringify(event.payload || {}),
      event.at,
    ]
  );

  const row = await db.getFirstAsync<{ last_event_seq: number }>(
    `SELECT last_event_seq FROM lan_session_state WHERE session_id = ?`,
    [event.sessionId]
  );
  if (event.seq > Number(row?.last_event_seq || 0)) {
    await db.runAsync(`UPDATE lan_session_state SET last_event_seq = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`, [
      event.seq,
      event.sessionId,
    ]);
  }

  return true;
}

export async function getLanEventByCommandId(db: SQLiteDatabase, sessionId: string, commandId?: string | null) {
  if (!commandId) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_event_log WHERE session_id = ? AND command_id = ? ORDER BY seq ASC, id ASC LIMIT 1`,
    [sessionId, commandId]
  );
  return row ? rowToOfficialEvent(row) : null;
}

export async function getLanTradeResolutionEvent(db: SQLiteDatabase, sessionId: string, offerCommandId?: string | null) {
  if (!offerCommandId) return null;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM lan_event_log
     WHERE session_id = ? AND event_type IN ('TRADE_ACCEPTED', 'TRADE_DECLINED')
     ORDER BY seq ASC, id ASC`,
    [sessionId]
  );
  for (const row of rows) {
    const event = rowToOfficialEvent(row);
    if (String((event.payload as any)?.offerCommandId || '') === offerCommandId) {
      return event;
    }
  }
  return null;
}

export async function getLanTradeCounterEvent(db: SQLiteDatabase, sessionId: string, offerCommandId?: string | null) {
  if (!offerCommandId) return null;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM lan_event_log
     WHERE session_id = ? AND event_type = 'TRADE_COUNTERED'
     ORDER BY seq DESC, id DESC`,
    [sessionId]
  );
  for (const row of rows) {
    const event = rowToOfficialEvent(row);
    if (String((event.payload as any)?.offerCommandId || '') === offerCommandId) {
      return event;
    }
  }
  return null;
}

function rowToOfficialEvent(row: Record<string, unknown>): LanOfficialEventMessage {
  return {
    type: 'LAN_EVENT',
    sessionId: String(row.session_id || ''),
    eventId: String(row.event_id || ''),
    seq: Number(row.seq || 0),
    commandId: (row.command_id as string | null) || null,
    eventType: String(row.event_type || 'SNAPSHOT_SYNCED') as LanOfficialEventType,
    actorDeviceId: (row.actor_device_id as string | null) || null,
    actorName: (row.actor_name as string | null) || null,
    targetDeviceId: (row.target_device_id as string | null) || null,
    targetCharacterId: row.target_character_id === null || row.target_character_id === undefined ? null : Number(row.target_character_id),
    targetName: (row.target_name as string | null) || null,
    previousValue: fromJsonText(row.previous_value as string | null),
    currentValue: fromJsonText(row.current_value as string | null),
    description: String(row.description || ''),
    payload: (fromJsonText(row.payload as string | null) as Record<string, unknown>) || {},
    at: String(row.created_at || new Date().toISOString()),
  };
}

export async function getLanHistoryPage(db: SQLiteDatabase, sessionId: string, page = 0, pageSize = 20) {
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const offset = Math.max(0, page) * safePageSize;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM lan_event_log WHERE session_id = ? ORDER BY seq DESC, id DESC LIMIT ? OFFSET ?`,
    [sessionId, safePageSize, offset]
  );
  return rows.map(rowToOfficialEvent);
}

export async function getLanEventsSince(db: SQLiteDatabase, sessionId: string, sinceSeq = 0, limit = 100) {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM lan_event_log WHERE session_id = ? AND IFNULL(seq, 0) > ? ORDER BY seq ASC LIMIT ?`,
    [sessionId, sinceSeq, limit]
  );
  return rows.map(rowToOfficialEvent);
}

export async function linkCharacterToSession(db: SQLiteDatabase, sessionId: string, characterId: number | null) {
  await db.runAsync(`UPDATE lan_sessions SET linked_character_id = ? WHERE id = ?`, [characterId, sessionId]);
}

export async function getCustomContentRefs(db: SQLiteDatabase): Promise<LanCustomContentRef[]> {
  const refs: LanCustomContentRef[] = [];

  for (const definition of CUSTOM_CONTENT_DEFINITIONS.filter(definition => definition.tableName !== 'effects')) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${definition.tableName} WHERE criador IN ('proprio', 'importado') ORDER BY ${definition.titleField} ASC`
    );

    for (const row of rows) {
      const id = Number(row.id);
      const name = String(row[definition.titleField] || 'Sem nome');
      const subtitle = definition.subtitleFields
        .map(field => row[field])
        .filter(value => value !== null && value !== undefined && value !== '')
        .map(String)
        .join(' / ');

      refs.push({
        key: makeRefKey(definition.tableName, id),
        id,
        name,
        type: definition.type,
        tableName: definition.tableName,
        subtitle,
        criador: typeof row.criador === 'string' ? row.criador : undefined,
      });
    }
  }

  return refs;
}

export async function getSelectedCustomContentPayloads(
  db: SQLiteDatabase,
  selectedKeys: string[]
): Promise<LanCustomContentPayload[]> {
  const selected = new Set(selectedKeys);
  const includeAll = selected.has(LAN_ALL_CUSTOM_CONTENT_KEY);
  const payloads: LanCustomContentPayload[] = [];
  const progressionSourceNames: string[] = [];

  for (const definition of CUSTOM_CONTENT_DEFINITIONS) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${definition.tableName} WHERE criador IN ('proprio', 'importado')`
    );

    for (const row of rows) {
      const id = Number(row.id);
      if (!includeAll && !selected.has(makeRefKey(definition.tableName, id))) continue;

      const { id: _id, ...data } = row;
      payloads.push({
        type: definition.type,
        tableName: definition.tableName,
        data,
      });

      if (['classes', 'subclasses', 'races'].includes(definition.tableName) && typeof row.name === 'string') {
        progressionSourceNames.push(row.name);
      }

      if (['items', 'spells'].includes(definition.tableName)) {
        const effectRows = await db.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM effects WHERE source_table = ? AND source_id = ? ORDER BY sort_order ASC`,
          [definition.tableName, id]
        );

        for (const effectRow of effectRows) {
          const { id: _id, ...data } = effectRow;
          payloads.push({
            type: 'Efeito',
            tableName: 'effects',
            data,
          });
        }
      }
    }
  }

  if (progressionSourceNames.length > 0) {
    const placeholders = progressionSourceNames.map(() => '?').join(',');
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM spellcasting_progression WHERE source_name IN (${placeholders})`,
      progressionSourceNames
    );

    for (const row of rows) {
      const { id: _id, ...data } = row;
      payloads.push({
        type: 'Progressao Magica',
        tableName: 'spellcasting_progression',
        data,
      });
    }
  }

  return payloads;
}

export async function upsertCustomContentPayloads(db: SQLiteDatabase, records: LanCustomContentPayload[]) {
  for (const record of records) {
    const tableName = record.tableName;
    if (!TABLE_COLUMNS[tableName]) continue;

    const allowedColumns = TABLE_COLUMNS[tableName];
    const keyColumns = TABLE_KEY_COLUMNS[tableName];
    const data: Record<string, unknown> = {};

    for (const column of allowedColumns) {
      if (column === 'criador') data[column] = 'importado';
      else if (column in record.data) data[column] = record.data[column];
    }

    if (tableName === 'effects' && typeof data.source_table === 'string' && typeof data.source_name === 'string') {
      const sourceTable = data.source_table;
      if (sourceTable === 'items' || sourceTable === 'spells') {
        const source = await db.getFirstAsync<{ id: number }>(
          `SELECT id FROM ${sourceTable} WHERE name = ? LIMIT 1`,
          [data.source_name]
        );

        if (source?.id) {
          data.source_id = source.id;
        }
      }
    }

    const hasKeys = keyColumns.every(column => data[column] !== undefined && data[column] !== null);
    if (!hasKeys) continue;

    const whereClause = keyColumns.map(column => `${column} = ?`).join(' AND ');
    const keyValues = keyColumns.map(column => toSqlValue(data[column]));
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM ${tableName} WHERE ${whereClause} LIMIT 1`,
      keyValues
    );

    if (existing?.id) {
      const updateColumns = allowedColumns.filter(column => !keyColumns.includes(column) && data[column] !== undefined);
      if (updateColumns.length === 0) continue;

      await db.runAsync(
        `UPDATE ${tableName} SET ${updateColumns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`,
        [...updateColumns.map(column => toSqlValue(data[column])), existing.id]
      );
    } else {
      const insertColumns = allowedColumns.filter(column => data[column] !== undefined);
      await db.runAsync(
        `INSERT INTO ${tableName} (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
        insertColumns.map(column => toSqlValue(data[column]))
      );
    }
  }
}

export async function getCharacterSnapshot(db: SQLiteDatabase, characterId: number): Promise<LanCharacterSnapshot | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [characterId]);
  if (!row) return null;

  return {
    localId: Number(row.id),
    name: String(row.name || 'Personagem'),
    race: String(row.race || ''),
    class: String(row.class || ''),
    level: Number(row.level || 1),
    updatedAt: new Date().toISOString(),
    data: row,
  };
}

export async function saveCharacterSnapshot(
  db: SQLiteDatabase,
  sessionId: string,
  ownerDeviceId: string,
  snapshot: LanCharacterSnapshot
) {
  await db.runAsync(
    `INSERT INTO lan_character_snapshots (
      session_id, owner_device_id, remote_character_id, character_name, payload, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, owner_device_id, remote_character_id)
    DO UPDATE SET character_name = excluded.character_name, payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`,
    [sessionId, ownerDeviceId, String(snapshot.localId), snapshot.name, JSON.stringify(snapshot)]
  );
}

export async function upsertLanPlayer(
  db: SQLiteDatabase,
  sessionId: string,
  deviceId: string,
  playerName: string,
  characterId?: number | null,
  characterName?: string | null,
  connected = true
) {
  await db.runAsync(
    `INSERT INTO lan_session_players (
      session_id, device_id, player_name, character_id, character_name, connected, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, device_id)
    DO UPDATE SET player_name = excluded.player_name, character_id = excluded.character_id,
      character_name = COALESCE(excluded.character_name, character_name), connected = excluded.connected, last_seen_at = CURRENT_TIMESTAMP`,
    [sessionId, deviceId, playerName, characterId || null, characterName || null, connected ? 1 : 0]
  );
}

export async function getLanPlayers(db: SQLiteDatabase, sessionId: string) {
  return db.getAllAsync<{
    device_id: string;
    player_name: string;
    character_id?: number | null;
    character_name?: string | null;
    connected: number;
    last_seen_at: string;
    snapshot_payload?: string | null;
    snapshot_updated_at?: string | null;
  }>(
    `SELECT p.*, s.payload AS snapshot_payload, s.updated_at AS snapshot_updated_at
     FROM lan_session_players p
     LEFT JOIN lan_character_snapshots s
       ON s.session_id = p.session_id
      AND s.owner_device_id = p.device_id
      AND s.remote_character_id = CAST(p.character_id AS TEXT)
     WHERE p.session_id = ?
     ORDER BY p.last_seen_at DESC`,
    [sessionId]
  );
}

export function selectedContentFromSession(session: LanSessionRecord | null | undefined) {
  return parseSelectedContent(session?.selected_content);
}
