import { SQLiteDatabase } from 'expo-sqlite';
import {
  LanCharacterSnapshot,
  LanContentTable,
  LanCustomContentPayload,
  LanCustomContentRef,
  LanCustomContentType,
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
  { type: 'Raca', tableName: 'races', titleField: 'name', subtitleFields: ['speed'] },
  { type: 'Classe', tableName: 'classes', titleField: 'name', subtitleFields: ['hit_dice', 'saves'] },
  { type: 'Subclasse', tableName: 'subclasses', titleField: 'name', subtitleFields: ['class_name', 'level_required'] },
  { type: 'Magia/Skill', tableName: 'spells', titleField: 'name', subtitleFields: ['level', 'category'] },
  { type: 'Kit', tableName: 'starting_kits', titleField: 'name', subtitleFields: ['target_name', 'target_type'] },
];

const TABLE_COLUMNS: Record<LanContentTable, string[]> = {
  items: ['name', 'weight', 'damage', 'damage_type', 'properties', 'descricao', 'criador'],
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
    'range',
    'components',
    'duration',
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

export async function closeOpenLanSessions(db: SQLiteDatabase, role?: LanRole) {
  if (role) {
    await db.runAsync(
      `UPDATE lan_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE role = ? AND status IN ('open', 'connected')`,
      [role]
    );
    return;
  }

  await db.runAsync(
    `UPDATE lan_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE status IN ('open', 'connected')`
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
}

export async function setLanSessionStatus(db: SQLiteDatabase, sessionId: string, status: LanSessionStatus) {
  await db.runAsync(
    `UPDATE lan_sessions
     SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN CURRENT_TIMESTAMP ELSE closed_at END,
         last_connected_at = CASE WHEN ? IN ('open', 'connected') THEN CURRENT_TIMESTAMP ELSE last_connected_at END
     WHERE id = ?`,
    [status, status, status, sessionId]
  );
}

export async function getActiveLanSession(db: SQLiteDatabase) {
  return db.getFirstAsync<LanSessionRecord>(
    `SELECT * FROM lan_sessions WHERE status IN ('open', 'connected') ORDER BY opened_at DESC LIMIT 1`
  );
}

export async function linkCharacterToSession(db: SQLiteDatabase, sessionId: string, characterId: number | null) {
  await db.runAsync(`UPDATE lan_sessions SET linked_character_id = ? WHERE id = ?`, [characterId, sessionId]);
}

export async function getCustomContentRefs(db: SQLiteDatabase): Promise<LanCustomContentRef[]> {
  const refs: LanCustomContentRef[] = [];

  for (const definition of CUSTOM_CONTENT_DEFINITIONS) {
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
  const payloads: LanCustomContentPayload[] = [];
  const progressionSourceNames: string[] = [];

  for (const definition of CUSTOM_CONTENT_DEFINITIONS) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${definition.tableName} WHERE criador IN ('proprio', 'importado')`
    );

    for (const row of rows) {
      const id = Number(row.id);
      if (!selected.has(makeRefKey(definition.tableName, id))) continue;

      const { id: _id, ...data } = row;
      payloads.push({
        type: definition.type,
        tableName: definition.tableName,
        data,
      });

      if (['classes', 'subclasses', 'races'].includes(definition.tableName) && typeof row.name === 'string') {
        progressionSourceNames.push(row.name);
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
      character_name = excluded.character_name, connected = excluded.connected, last_seen_at = CURRENT_TIMESTAMP`,
    [sessionId, deviceId, playerName, characterId || null, characterName || null, connected ? 1 : 0]
  );
}

export async function getLanPlayers(db: SQLiteDatabase, sessionId: string) {
  return db.getAllAsync<{
    device_id: string;
    player_name: string;
    character_name?: string | null;
    connected: number;
    last_seen_at: string;
  }>(`SELECT * FROM lan_session_players WHERE session_id = ? ORDER BY last_seen_at DESC`, [sessionId]);
}

export function selectedContentFromSession(session: LanSessionRecord | null | undefined) {
  return parseSelectedContent(session?.selected_content);
}
