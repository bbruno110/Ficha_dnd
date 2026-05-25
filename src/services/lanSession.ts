import { NativeModules, Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  fetchLanTcpPayload,
  LAN_TCP_PORT,
  getLanTcpClientEvents,
  getLanTcpHostEvents,
  getLanTcpHostJoinedRows,
  isTcpLanUrl,
  resolveLanTcpUrlByInviteCode,
  sendLanTcpEvent,
  sendLanTcpJoin,
  startLanTcpHost,
  stopLanTcpHost,
  updateLanTcpHostPayload,
} from './lanTcpTransport';

const LAN_START_TIMEOUT_MS = 4500;

const CUSTOM_TABLES = [
  'items',
  'races',
  'classes',
  'subclasses',
  'spells',
  'starting_kits',
  'spellcasting_progression',
] as const;

const SELECTABLE_CUSTOM_TABLES = [
  'items',
  'races',
  'classes',
  'subclasses',
  'spells',
  'starting_kits',
] as const;

type CustomTable = (typeof CUSTOM_TABLES)[number];
export type SelectableCustomTable = (typeof SELECTABLE_CUSTOM_TABLES)[number];

export type CatalogSelection = Partial<Record<SelectableCustomTable, number[]>>;

export type LanSessionStatus = 'active' | 'paused' | 'ended';
export type LanEffectUnit = 'turn' | 'minute' | 'hour' | 'rest';
export type LanAdvanceUnit = 'turn' | 'minute' | 'hour' | 'shortRest' | 'longRest';
export type LanEffectTarget = 'FOR' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR' | 'CA' | 'HP' | 'PV_TEMP' | 'custom';
export type LanEffectKind = 'stat' | 'hp' | 'temp_hp' | 'status' | 'custom';

export type LanSessionRules = {
  id: string;
  name: string;
  masterName: string;
  level: number;
  allowExisting: boolean;
  inviteCode: string;
};

export type LanSessionEffect = {
  id: string;
  name: string;
  target: LanEffectTarget;
  value: number;
  remaining: number;
  unit: LanEffectUnit;
  kind?: LanEffectKind;
  mode?: 'add' | 'set';
  durationText?: string;
  status?: string;
  source?: string;
  color?: string;
  secondaryColor?: string;
};

export type LanSessionPlayerState = {
  id: number;
  sessionId: string;
  remoteKey?: string;
  playerName: string;
  characterId?: number | null;
  sourceCharacterId?: number | null;
  characterName: string;
  level: number;
  className: string;
  race: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  xp: number;
  gp: number;
  sp: number;
  cp: number;
  stats: Record<string, unknown>;
  equipment: Record<string, unknown>;
  effects: LanSessionEffect[];
  pendingCharacter?: Record<string, unknown> | null;
  pendingDiff?: string[];
};

export type LanSessionState = {
  status: LanSessionStatus;
  currentTurn: number;
  elapsedMinutes: number;
  players: LanSessionPlayerState[];
};

export type LanSessionPayload = {
  type: 'ficha-dnd-lan-session';
  version: 1;
  createdAt: string;
  session: LanSessionRules;
  catalog: Record<CustomTable, Record<string, unknown>[]>;
  selectedCatalog?: CatalogSelection;
  state?: LanSessionState;
  events?: LanSessionEvent[];
};

export type CatalogOption = {
  key: string;
  table: SelectableCustomTable;
  id: number;
  name: string;
  group: string;
  detail: string;
};

export type LanSessionSummary = LanSessionRules & {
  status: LanSessionStatus;
  currentTurn: number;
  elapsedMinutes: number;
  joinUrl?: string;
  active: boolean;
  isMaster: boolean;
  selectedCatalog: CatalogSelection;
  playerCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type LanTradeItem = {
  name: string;
  qty: number;
  weight?: number;
  damage?: string;
  damage_type?: string;
  properties?: string;
  descricao?: string;
  effect_json?: string;
  duration_value?: number | null;
  duration_unit?: string | null;
};

export type LanResourceRequest = {
  kind: 'xp' | 'hp' | 'stat' | 'inventory';
  action?: 'add' | 'remove' | 'heal' | 'damage' | 'set' | 'temp';
  amount?: number;
  field?: string;
  value?: number;
  item?: LanTradeItem;
  duration?: number;
  unit?: LanEffectUnit;
  message?: string;
};

export type LanSpellEventMode = 'heal' | 'damage' | 'effect';
export type LanSessionEventType =
  | 'send_item'
  | 'trade_offer'
  | 'trade_accept'
  | 'trade_decline'
  | 'public_status'
  | 'spell_hp'
  | 'spell_effect'
  | 'player_joined'
  | 'effect_expired'
  | 'player_kicked'
  | 'character_update_review'
  | 'resource_request'
  | 'resource_review'
  | 'player_patch'
  | 'inventory_patch'
  | 'effect_patch'
  | 'session_patch'
  | 'timeline_event';

export type LanSessionEvent = {
  id: string;
  sessionId: string;
  seq?: number;
  type: LanSessionEventType;
  fromKey: string;
  fromName: string;
  toKey: string;
  toName: string;
  clientMsgId?: string;
  item?: LanTradeItem;
  offeredItem?: LanTradeItem;
  requestedItem?: LanTradeItem;
  publicState?: {
    hpCurrent: number;
    hpMax: number;
    tempHp?: number;
    level: number;
  };
  spellEffect?: {
    spellName: string;
    mode: LanSpellEventMode;
    amount?: number;
    target?: LanEffectTarget;
    value?: number;
    durationText?: string;
    durationRemaining?: number;
    durationUnit?: LanEffectUnit;
    description?: string;
  };
  expiredEffect?: LanSessionEffect;
  resourceRequest?: LanResourceRequest;
  inventoryPatch?: {
    equipment: Record<string, unknown>;
    reason?: string;
  };
  numberPatch?: Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;
  tradeId?: string;
  message?: string;
  createdAt: string;
};

export type PublicLanPlayer = {
  key: string;
  playerName: string;
  characterName: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  isSelf: boolean;
};

type LanNativeModule = {
  startSession: (payload: string, port: number) => Promise<{ url?: string; urls?: string[] }>;
  stopSession: () => Promise<boolean>;
  updatePayload: (payload: string) => Promise<boolean>;
  getJoinedPlayers: () => Promise<string[]>;
  getSessionEvents: () => Promise<string[]>;
};

const lanNative = NativeModules.LanSessionModule as LanNativeModule | undefined;

const TABLE_COLUMNS: Record<CustomTable, string[]> = {
  items: ['name', 'weight', 'damage', 'damage_type', 'properties', 'descricao', 'effect_json', 'duration_value', 'duration_unit', 'criador'],
  races: ['name', 'stat_bonuses', 'speed', 'features', 'criador'],
  classes: ['name', 'recommended_stats', 'starting_equipment', 'starting_gold', 'hit_dice', 'saves', 'subclass_level', 'is_caster', 'features', 'criador'],
  subclasses: ['name', 'class_name', 'level_required', 'bonus_skills', 'features', 'criador'],
  spells: ['name', 'level', 'category', 'classes', 'casting_time', 'range', 'components', 'duration', 'damage_dice', 'damage_type', 'saving_throw', 'description', 'effect_json', 'duration_value', 'duration_unit', 'class_level_required', 'criador'],
  starting_kits: ['name', 'target_name', 'target_type', 'items', 'criador'],
  spellcasting_progression: ['source_type', 'source_name', 'level', 'cantrips_known', 'spells_known', 'slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8', 'slot_9', 'criador'],
};

const TABLE_LABELS: Record<SelectableCustomTable, string> = {
  items: 'Item',
  races: 'Raca',
  classes: 'Classe',
  subclasses: 'Subclasse',
  spells: 'Magia/Skill',
  starting_kits: 'Kit',
};

export function makeSessionId() {
  return `lan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function makeLanEventId() {
  return `event_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makeLanCharacterKey(sessionId: string, character: Record<string, unknown>) {
  return `${sessionId}:${character.id || 'novo'}:${character.name || 'personagem'}`;
}

export function makeCatalogKey(table: SelectableCustomTable, id: number) {
  return `${table}:${id}`;
}

export function emptyCatalogSelection(): CatalogSelection {
  return {};
}

export async function prepareLanSessionStorage(db: SQLiteDatabase) {
  await ensureLanSchema(db);
}

export function selectionFromKeys(keys: string[]): CatalogSelection {
  const selection = emptyCatalogSelection();

  for (const key of keys) {
    const [table, rawId] = key.split(':');
    const id = Number(rawId);
    if (!isSelectableTable(table) || !Number.isFinite(id)) continue;
    selection[table] = [...(selection[table] || []), id];
  }

  return normalizeCatalogSelection(selection);
}

export function keysFromSelection(selection?: CatalogSelection) {
  if (!selection) return [];
  return SELECTABLE_CUSTOM_TABLES.flatMap((table) => (selection[table] || []).map((id) => makeCatalogKey(table, id)));
}

export async function getCustomCatalogOptions(db: SQLiteDatabase): Promise<CatalogOption[]> {
  const options: CatalogOption[] = [];

  for (const tableName of SELECTABLE_CUSTOM_TABLES) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${tableName} WHERE criador IS NOT NULL AND criador != 'base' ORDER BY name ASC`
    );

    for (const row of rows) {
      const id = toNumber(row.id);
      if (!id) continue;

      options.push({
        key: makeCatalogKey(tableName, id),
        table: tableName,
        id,
        name: String(row.name || 'Sem nome'),
        group: TABLE_LABELS[tableName],
        detail: describeCatalogOption(tableName, row),
      });
    }
  }

  return options;
}

export async function buildLanSessionPayload(
  db: SQLiteDatabase,
  session: LanSessionRules,
  selection?: CatalogSelection
): Promise<LanSessionPayload> {
  const catalog = makeEmptyCatalog();
  const normalizedSelection = selection ? normalizeCatalogSelection(selection) : undefined;

  for (const tableName of SELECTABLE_CUSTOM_TABLES) {
    const selectedIds = normalizedSelection?.[tableName];

    if (normalizedSelection && (!selectedIds || selectedIds.length === 0)) {
      catalog[tableName] = [];
      continue;
    }

    if (selectedIds && selectedIds.length > 0) {
      const placeholders = selectedIds.map(() => '?').join(',');
      catalog[tableName] = await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${tableName} WHERE criador IS NOT NULL AND criador != 'base' AND id IN (${placeholders}) ORDER BY id ASC`,
        selectedIds
      );
    } else {
      catalog[tableName] = await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${tableName} WHERE criador IS NOT NULL AND criador != 'base' ORDER BY id ASC`
      );
    }
  }

  await appendRelatedSpellProgressions(db, catalog);

  return {
    type: 'ficha-dnd-lan-session',
    version: 1,
    createdAt: new Date().toISOString(),
    session,
    catalog,
    selectedCatalog: normalizedSelection,
    state: {
      status: 'active',
      currentTurn: 1,
      elapsedMinutes: 0,
      players: [],
    },
    events: [],
  };
}

export async function saveLanSession(db: SQLiteDatabase, payload: LanSessionPayload, joinUrl?: string, options?: { isMaster?: boolean }) {
  await ensureLanSchema(db);
  const state = payload.state || { status: 'active' as const, currentTurn: 1, elapsedMinutes: 0, players: [] };
  const selectedCatalog = normalizeCatalogSelection(payload.selectedCatalog);
  const transport = getTransportInfoFromJoinUrl(joinUrl);
  const isMaster = options?.isMaster ?? true;
  const existingSession = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM lan_sessions WHERE id = ?`,
    [payload.session.id]
  );

  const values = [
    payload.session.name,
    payload.session.masterName,
    payload.session.level,
    payload.session.allowExisting ? 1 : 0,
    payload.session.inviteCode,
    joinUrl || null,
    JSON.stringify(payload),
    state.status,
    state.currentTurn,
    state.elapsedMinutes,
    JSON.stringify(selectedCatalog),
    transport.mode,
    transport.host,
    transport.port,
    isMaster ? 1 : 0,
  ];

  if (existingSession) {
    await db.runAsync(
      `UPDATE lan_sessions
       SET name = ?, master_name = ?, level = ?, allow_existing = ?, invite_code = ?,
           join_url = ?, payload_json = ?, active = 1, status = ?, current_turn = ?,
           elapsed_minutes = ?, selected_catalog_json = ?, transport_mode = ?,
           host_ip = ?, host_port = ?, protocol_version = 1, is_master = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...values, payload.session.id]
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO lan_sessions (
      id, name, master_name, level, allow_existing, invite_code, join_url, payload_json,
      active, status, current_turn, elapsed_minutes, current_seq, selected_catalog_json,
      transport_mode, host_ip, host_port, protocol_version, is_master, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`,
    [
      payload.session.id,
      ...values.slice(0, 7),
      ...values.slice(7, 10),
      0,
      ...values.slice(10, 15),
    ]
  );
}

export async function getSavedLanSessions(db: SQLiteDatabase): Promise<LanSessionSummary[]> {
  await ensureLanSchema(db);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT s.*,
            SUM(CASE WHEN COALESCE(p.is_active, 1) = 1 AND p.kicked_at IS NULL THEN 1 ELSE 0 END) as player_count,
            MAX(CASE WHEN COALESCE(p.is_active, 1) = 1 AND p.kicked_at IS NULL AND p.character_id IS NOT NULL THEN 1 ELSE 0 END) as has_bound_character
     FROM lan_sessions s
     LEFT JOIN lan_session_players p ON p.session_id = s.id
     GROUP BY s.id
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC`
  );

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name || 'Mesa de D&D'),
    masterName: String(row.master_name || 'Mestre'),
    level: toNumber(row.level, 1),
    allowExisting: Boolean(row.allow_existing),
    inviteCode: String(row.invite_code || ''),
    status: normalizeSessionStatus(row.status),
    currentTurn: toNumber(row.current_turn, 1),
    elapsedMinutes: toNumber(row.elapsed_minutes),
    joinUrl: row.join_url ? String(row.join_url) : undefined,
    active: Boolean(row.active),
    isMaster: Boolean(row.is_master) && toNumber(row.has_bound_character) === 0,
    selectedCatalog: normalizeCatalogSelection(parseJsonValue(row.selected_catalog_json, {})),
    playerCount: toNumber(row.player_count),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));
}

export async function deleteLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  await db.runAsync(`DELETE FROM lan_session_trades WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_pending_requests WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_events WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_players WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_sessions WHERE id = ?`, [sessionId]);
}

export async function startLanServer(payload: LanSessionPayload) {
  try {
    return await withTimeout(startLanTcpHost(payload), LAN_START_TIMEOUT_MS);
  } catch {
    await stopLanTcpHost();
    return '';
  }
}

export function isEmulatorOnlyTcpUrl(url?: string) {
  if (!isTcpLanUrl(url)) return false;

  try {
    return isAndroidEmulatorPrivateHost(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

export async function getMasterJoinedPlayers(joinUrl?: string) {
  if (isTcpLanUrl(joinUrl)) return getLanTcpHostJoinedRows();
  return [];
}

export async function getNativeSessionEvents(joinUrl?: string) {
  if (isTcpLanUrl(joinUrl)) return getLanTcpHostEvents();
  return [];
}

export async function stopLanServer() {
  await stopLanTcpHost();
  if (Platform.OS !== 'android' || !lanNative?.stopSession) return false;
  return lanNative.stopSession();
}

export async function fetchLanSessionPayload(url: string): Promise<LanSessionPayload> {
  if (isTcpLanUrl(url)) return fetchLanTcpPayload(url);
  throw new Error('Sessao LAN precisa usar URL tcp:// para socket local.');
}

export async function resolveLanSessionUrlByInviteCode(code: string) {
  const inviteCode = code.trim().toUpperCase();
  if (!inviteCode) return '';
  return resolveLanTcpUrlByInviteCode(inviteCode);
}

export async function fetchLanSessionEvents(joinUrl: string, sessionId?: string): Promise<LanSessionEvent[]> {
  if (!joinUrl) return [];
  if (isTcpLanUrl(joinUrl)) return getLanTcpClientEvents(joinUrl, sessionId);
  return [];
}

export async function sendLanSessionEvent(joinUrl: string | undefined, event: LanSessionEvent) {
  if (isTcpLanUrl(joinUrl)) return sendLanTcpEvent(joinUrl, event);
  throw new Error('Sessao LAN sem socket TCP ativo.');
}

export async function importLanCatalog(db: SQLiteDatabase, payload: LanSessionPayload) {
  for (const tableName of CUSTOM_TABLES) {
    for (const rawRow of payload.catalog[tableName] || []) {
      const row = { ...rawRow, criador: 'importado' };
      await upsertCatalogRow(db, tableName, row);
    }
  }
}

export async function rememberLanSessionEvent(db: SQLiteDatabase, event: LanSessionEvent) {
  await ensureLanSchema(db);
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM lan_session_events WHERE id = ?`,
    [event.id]
  );
  if (existing) return false;
  const eventWithSeq = await withLanEventSeq(db, event);

  await db.runAsync(
    `INSERT INTO lan_session_events (
      id, session_id, seq, type, from_key, to_key, client_msg_id, payload_json, processed
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      eventWithSeq.id,
      eventWithSeq.sessionId,
      eventWithSeq.seq ?? null,
      eventWithSeq.type,
      eventWithSeq.fromKey || null,
      eventWithSeq.toKey || null,
      eventWithSeq.clientMsgId || null,
      JSON.stringify(eventWithSeq),
    ]
  );
  return true;
}

export async function getLanSessionEvents(db: SQLiteDatabase, sessionId: string, limit = 30): Promise<LanSessionEvent[]> {
  await ensureLanSchema(db);
  const rows = await db.getAllAsync<{ payload_json: string }>(
    `SELECT payload_json
     FROM lan_session_events
     WHERE session_id = ?
     ORDER BY COALESCE(seq, 0) DESC, created_at DESC
     LIMIT ?`,
    [sessionId, limit]
  );

  return rows
    .map((row) => parseLanSessionEvent(row.payload_json))
    .filter(Boolean) as LanSessionEvent[];
}

async function withLanEventSeq(db: SQLiteDatabase, event: LanSessionEvent): Promise<LanSessionEvent> {
  if (Number.isFinite(event.seq)) return event;

  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT current_seq FROM lan_sessions WHERE id = ?`,
    [event.sessionId]
  );
  const nextSeq = toNumber(session?.current_seq) + 1;
  await db.runAsync(
    `UPDATE lan_sessions SET current_seq = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [nextSeq, event.sessionId]
  );

  return { ...event, seq: nextSeq };
}

export async function getLocalLanSessionForCharacter(db: SQLiteDatabase, characterId: number) {
  await ensureLanSchema(db);
  return db.getFirstAsync<{
    sessionId: string;
    joinUrl?: string;
    payloadJson?: string;
  }>(
    `SELECT s.id as sessionId, s.join_url as joinUrl, s.payload_json as payloadJson
     FROM lan_session_players p
     JOIN lan_sessions s ON s.id = p.session_id
     WHERE p.character_id = ? AND COALESCE(p.is_active, 1) = 1 AND p.kicked_at IS NULL
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC
     LIMIT 1`,
    [characterId]
  );
}

export async function getBoundLanCharacter(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  return db.getFirstAsync<{
    characterId: number;
    sessionId: string;
    sessionName: string;
    joinUrl?: string;
    payloadJson?: string;
  }>(
    `SELECT p.character_id as characterId, s.id as sessionId, s.name as sessionName,
            s.join_url as joinUrl, s.payload_json as payloadJson
     FROM lan_session_players p
     JOIN lan_sessions s ON s.id = p.session_id
     WHERE p.session_id = ? AND p.character_id IS NOT NULL
       AND COALESCE(p.is_active, 1) = 1 AND p.kicked_at IS NULL
     ORDER BY p.last_seen_at DESC
     LIMIT 1`,
    [sessionId]
  );
}

export async function getCharacterLanBinding(db: SQLiteDatabase, characterId: number) {
  await ensureLanSchema(db);
  return db.getFirstAsync<{
    characterId: number;
    sessionId: string;
    sessionName: string;
    joinUrl?: string;
  }>(
    `SELECT p.character_id as characterId, s.id as sessionId, s.name as sessionName, s.join_url as joinUrl
     FROM lan_session_players p
     JOIN lan_sessions s ON s.id = p.session_id
     WHERE p.character_id = ? AND COALESCE(p.is_active, 1) = 1 AND p.kicked_at IS NULL
     ORDER BY p.last_seen_at DESC
     LIMIT 1`,
    [characterId]
  );
}

export async function unlinkCharacterFromLanSession(db: SQLiteDatabase, characterId: number, sessionId?: string) {
  await ensureLanSchema(db);
  if (sessionId) {
    await db.runAsync(`DELETE FROM lan_session_players WHERE character_id = ? AND session_id = ?`, [characterId, sessionId]);
  } else {
    await db.runAsync(`DELETE FROM lan_session_players WHERE character_id = ?`, [characterId]);
  }
}

export function getPublicLanPlayers(payload: LanSessionPayload, selfKey?: string): PublicLanPlayer[] {
  return (payload.state?.players || []).map((player) => {
    const key = player.remoteKey || `${payload.session.id}:${player.sourceCharacterId || player.characterId || player.characterName}:${player.characterName}`;
    return {
      key,
      playerName: player.playerName,
      characterName: player.characterName,
      level: player.level,
      hpCurrent: player.hpCurrent,
      hpMax: player.hpMax,
      tempHp: player.tempHp || 0,
      isSelf: Boolean(selfKey && key === selfKey),
    };
  });
}

export async function getLanSessionState(db: SQLiteDatabase, sessionId: string): Promise<LanSessionState> {
  await ensureLanSchema(db);
  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  const players = await getLanSessionPlayers(db, sessionId);

  return {
    status: normalizeSessionStatus(session?.status),
    currentTurn: toNumber(session?.current_turn, 1),
    elapsedMinutes: toNumber(session?.elapsed_minutes),
    players,
  };
}

export async function refreshLanSessionPayload(db: SQLiteDatabase, sessionId: string): Promise<LanSessionPayload | null> {
  await ensureLanSchema(db);
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM lan_sessions WHERE id = ?`, [sessionId]);
  if (!row) return null;

  const storedPayload = parseJsonValue<LanSessionPayload | null>(row.payload_json, null);
  const payload: LanSessionPayload = storedPayload || {
    type: 'ficha-dnd-lan-session',
    version: 1,
    createdAt: new Date().toISOString(),
    session: {
      id: String(row.id),
      name: String(row.name || 'Mesa de D&D'),
      masterName: String(row.master_name || 'Mestre'),
      level: toNumber(row.level, 1),
      allowExisting: Boolean(row.allow_existing),
      inviteCode: String(row.invite_code || makeInviteCode()),
    },
    catalog: makeEmptyCatalog(),
  };

  payload.session = {
    ...payload.session,
    id: String(row.id),
    name: String(row.name || payload.session.name),
    masterName: String(row.master_name || payload.session.masterName),
    level: toNumber(row.level, payload.session.level),
    allowExisting: Boolean(row.allow_existing),
    inviteCode: String(row.invite_code || payload.session.inviteCode),
  };
  payload.selectedCatalog = normalizeCatalogSelection(row.selected_catalog_json ? parseJsonValue(row.selected_catalog_json, {}) : payload.selectedCatalog);
  payload.state = await getLanSessionState(db, sessionId);
  payload.events = await getLanSessionEvents(db, sessionId, 50);

  await db.runAsync(
    `UPDATE lan_sessions SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(payload), sessionId]
  );

  return payload;
}

export async function syncLanSessionPayload(db: SQLiteDatabase, sessionId: string) {
  const payload = await refreshLanSessionPayload(db, sessionId);
  if (!payload) return null;

  if (Platform.OS === 'android' && lanNative?.updatePayload) {
    await lanNative.updatePayload(JSON.stringify(payload));
  }

  const row = await db.getFirstAsync<{ joinUrl?: string }>(
    `SELECT join_url as joinUrl FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  updateLanHostPayload(row?.joinUrl, payload);

  return payload;
}

export async function rebuildLanSessionCatalog(
  db: SQLiteDatabase,
  sessionId: string,
  selection: CatalogSelection,
  joinUrl?: string
) {
  const summary = (await getSavedLanSessions(db)).find((entry) => entry.id === sessionId);
  if (!summary) return null;

  const payload = await buildLanSessionPayload(db, {
    id: summary.id,
    name: summary.name,
    masterName: summary.masterName,
    level: summary.level,
    allowExisting: summary.allowExisting,
    inviteCode: summary.inviteCode,
  }, selection);
  payload.state = await getLanSessionState(db, sessionId);

  await saveLanSession(db, payload, joinUrl || summary.joinUrl);
  await syncLanSessionPayload(db, sessionId);
  return payload;
}

export async function pauseLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  await db.runAsync(
    `UPDATE lan_sessions SET status = 'paused', active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [sessionId]
  );
  return syncLanSessionPayload(db, sessionId);
}

export async function endLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  await db.runAsync(
    `UPDATE lan_sessions SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [sessionId]
  );
  return syncLanSessionPayload(db, sessionId);
}

export async function resumeLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  await db.runAsync(
    `UPDATE lan_sessions SET status = 'active', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [sessionId]
  );
  return syncLanSessionPayload(db, sessionId);
}

export async function joinLanSessionWithCharacter(db: SQLiteDatabase, sessionId: string, characterId: number, playerName = '') {
  await ensureLanSchema(db);
  const character = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [characterId]);
  const normalized = normalizeCharacterState(character || {});

  await db.runAsync(
    `INSERT OR REPLACE INTO lan_session_players (
      session_id, remote_key, player_name, character_id, character_name, character_snapshot,
      hp_current, hp_max, temp_hp, xp, gp, sp, cp, stats_json, equipment_json, effects_json, last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      sessionId,
      makeLanCharacterKey(sessionId, { ...character, id: characterId }),
      playerName || normalized.characterName,
      characterId,
      normalized.characterName,
      JSON.stringify(character || {}),
      normalized.hpCurrent,
      normalized.hpMax,
      normalized.tempHp,
      normalized.xp,
      normalized.gp,
      normalized.sp,
      normalized.cp,
      JSON.stringify(normalized.stats),
      JSON.stringify(normalized.equipment),
      '[]',
    ]
  );

  await syncLanSessionPayload(db, sessionId);
  return character;
}

export async function notifyMasterJoin(joinUrl: string | undefined, sessionId: string, character: Record<string, unknown> | null, playerName = '', options?: { reviewSnapshot?: boolean }) {
  if (!joinUrl || !character) return false;
  if (isTcpLanUrl(joinUrl)) {
    return sendLanTcpJoin(joinUrl, {
      sessionId,
      playerName: playerName || character.name,
      remoteKey: makeLanCharacterKey(sessionId, character),
      character,
      reviewSnapshot: Boolean(options?.reviewSnapshot),
    });
  }
  return false;
}

export async function upsertLanSessionPlayerFromNetwork(db: SQLiteDatabase, entry: any) {
  await ensureLanSchema(db);
  const sessionId = String(entry?.sessionId || '');
  const character = entry?.character || {};
  if (!sessionId || !character) return null;

  const normalized = normalizeCharacterState(character);
  const remoteKey = String(entry.remoteKey || `${sessionId}:${entry.playerName || normalized.playerName}:${normalized.sourceCharacterId || normalized.characterName}`);
  const playerName = String(entry.playerName || normalized.playerName || normalized.characterName);
  const existing = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players WHERE session_id = ? AND remote_key = ?`,
    [sessionId, remoteKey]
  );

  if (existing) {
    if (!toNumber(existing.is_active, 1) || existing.kicked_at) {
      return null;
    }

    const pendingDiff = entry.reviewSnapshot ? describeCharacterDiff(existing, normalized) : [];
    if (pendingDiff.length > 0) {
      await db.runAsync(
        `UPDATE lan_session_players
         SET player_name = ?, character_name = ?, pending_character_snapshot = ?, notes = ?,
             is_connected = 1, last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [playerName, normalized.characterName, JSON.stringify(character), JSON.stringify(pendingDiff), Number(existing.id)]
      );
      await rememberLanSessionEvent(db, {
        id: makeLanEventId(),
        sessionId,
        type: 'character_update_review',
        fromKey: remoteKey,
        fromName: playerName,
        toKey: 'master',
        toName: 'Mestre',
        message: `${normalized.characterName} voltou com alteracoes pendentes: ${pendingDiff.join('; ')}.`,
        createdAt: new Date().toISOString(),
      });
      await syncLanSessionPayload(db, sessionId);
      return Number(existing.id);
    }

    await db.runAsync(
      `UPDATE lan_session_players
       SET player_name = ?, character_name = ?, character_snapshot = ?,
           pending_character_snapshot = NULL, notes = NULL, is_connected = 1,
           last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [playerName, normalized.characterName, JSON.stringify(character), Number(existing.id)]
    );
    await syncLanSessionPayload(db, sessionId);
    return Number(existing.id);
  }

  const result = await db.runAsync(
    `INSERT INTO lan_session_players (
      session_id, remote_key, player_name, character_id, character_name, character_snapshot,
      hp_current, hp_max, temp_hp, xp, gp, sp, cp, stats_json, equipment_json, effects_json, last_seen_at
    )
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', CURRENT_TIMESTAMP)`,
    [
      sessionId,
      remoteKey,
      playerName,
      normalized.characterName,
      JSON.stringify(character),
      normalized.hpCurrent,
      normalized.hpMax,
      normalized.tempHp,
      normalized.xp,
      normalized.gp,
      normalized.sp,
      normalized.cp,
      JSON.stringify(normalized.stats),
      JSON.stringify(normalized.equipment),
    ]
  );

  await rememberLanSessionEvent(db, {
    id: makeLanEventId(),
    sessionId,
    type: 'player_joined',
    fromKey: remoteKey,
    fromName: playerName,
    toKey: 'master',
    toName: 'Mestre',
    message: `${normalized.characterName} entrou na sessao.`,
    createdAt: new Date().toISOString(),
  });
  await syncLanSessionPayload(db, sessionId);
  return Number(result.lastInsertRowId);
}

export async function updateLanPlayerNumbers(
  db: SQLiteDatabase,
  playerId: number,
  patch: Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>
) {
  await ensureLanSchema(db);
  const allowed = {
    hpCurrent: 'hp_current',
    hpMax: 'hp_max',
    tempHp: 'temp_hp',
    xp: 'xp',
    gp: 'gp',
    sp: 'sp',
    cp: 'cp',
  } as const;

  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;

  const setSql = entries.map(([key]) => `${allowed[key as keyof typeof allowed]} = ?`).join(', ');
  const values = entries.map(([, value]) => Math.max(0, Math.floor(Number(value) || 0)));
  await db.runAsync(
    `UPDATE lan_session_players
     SET ${setSql}, revision_seq = COALESCE(revision_seq, 0) + 1, last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [...values, playerId]
  );

  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT session_id, character_id FROM lan_session_players WHERE id = ?`,
    [playerId]
  );

  if (player?.character_id) {
    await updateLocalCharacterNumbers(db, Number(player.character_id), patch);
  }

  if (player?.session_id) {
    await syncLanSessionPayload(db, String(player.session_id));
  }
}

export async function kickLanSessionPlayer(db: SQLiteDatabase, playerId: number) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players WHERE id = ?`,
    [playerId]
  );
  if (!player) return;

  const sessionId = String(player.session_id || '');
  const snapshot = parseJsonValue<Record<string, unknown>>(player.character_snapshot, {});
  const normalized = normalizeCharacterState(snapshot);
  const playerKey = String(player.remote_key || `${sessionId}:${player.character_id || normalized.characterName}:${normalized.characterName}`);

  await db.runAsync(
    `UPDATE lan_session_players
     SET is_active = 0, is_connected = 0, kicked_at = CURRENT_TIMESTAMP,
         revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [playerId]
  );
  await rememberLanSessionEvent(db, {
    id: makeLanEventId(),
    sessionId,
    type: 'player_kicked',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: playerKey,
    toName: normalized.characterName,
    message: `${normalized.characterName} foi removido da sessao pelo mestre.`,
    createdAt: new Date().toISOString(),
  });
  await syncLanSessionPayload(db, sessionId);
}

export async function updateLanPlayerEquipment(
  db: SQLiteDatabase,
  playerId: number,
  equipment: Record<string, unknown>,
  message?: string
) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT session_id, remote_key, character_name, character_id FROM lan_session_players WHERE id = ? AND COALESCE(is_active, 1) = 1`,
    [playerId]
  );
  if (!player) return false;

  await db.runAsync(
    `UPDATE lan_session_players
     SET equipment_json = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(normalizeEquipment(equipment)), playerId]
  );

  if (player.character_id) {
    await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [JSON.stringify(normalizeEquipment(equipment)), Number(player.character_id)]);
  }

  if (message) {
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId: String(player.session_id),
      type: 'inventory_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: String(player.remote_key || ''),
      toName: String(player.character_name || 'Personagem'),
      inventoryPatch: { equipment: normalizeEquipment(equipment), reason: message },
      message,
      createdAt: new Date().toISOString(),
    });
  }

  await syncLanSessionPayload(db, String(player.session_id));
  return true;
}

export async function applyLanPlayerInventoryPatch(
  db: SQLiteDatabase,
  sessionId: string,
  remoteKey: string,
  equipment: Record<string, unknown>,
  allowIncreases = false
) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, equipment_json FROM lan_session_players
     WHERE session_id = ? AND remote_key = ? AND COALESCE(is_active, 1) = 1`,
    [sessionId, remoteKey]
  );
  if (!player) return false;

  const currentEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(player.equipment_json, {}));
  const nextEquipment = normalizeEquipment(equipment);
  if (!allowIncreases && hasInventoryIncrease(currentEquipment, nextEquipment)) return false;

  return updateLanPlayerEquipment(db, Number(player.id), nextEquipment);
}

export async function applyLanInventoryTransferEvent(db: SQLiteDatabase, event: LanSessionEvent) {
  await ensureLanSchema(db);

  if (event.type === 'send_item' && event.item) {
    const fromPlayer = await getActiveLanPlayerByRemoteKey(db, event.sessionId, event.fromKey);
    const toPlayer = await getActiveLanPlayerByRemoteKey(db, event.sessionId, event.toKey);
    if (!fromPlayer || !toPlayer) return false;

    const fromEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(fromPlayer.equipment_json, {}));
    const toEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(toPlayer.equipment_json, {}));
    const removed = removeTradeItemFromEquipment(fromEquipment, event.item);
    if (!removed) return false;

    await updateLanPlayerEquipment(db, Number(fromPlayer.id), fromEquipment);
    await updateLanPlayerEquipment(db, Number(toPlayer.id), addTradeItemToEquipment(toEquipment, event.item));
    return true;
  }

  if (event.type === 'trade_accept' && event.offeredItem && event.requestedItem) {
    const acceptingPlayer = await getActiveLanPlayerByRemoteKey(db, event.sessionId, event.fromKey);
    const offeringPlayer = await getActiveLanPlayerByRemoteKey(db, event.sessionId, event.toKey);
    if (!acceptingPlayer || !offeringPlayer) return false;

    const acceptingEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(acceptingPlayer.equipment_json, {}));
    const offeringEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(offeringPlayer.equipment_json, {}));
    if (!removeTradeItemFromEquipment(acceptingEquipment, event.requestedItem)) return false;
    if (!removeTradeItemFromEquipment(offeringEquipment, event.offeredItem)) return false;

    await updateLanPlayerEquipment(
      db,
      Number(acceptingPlayer.id),
      addTradeItemToEquipment(acceptingEquipment, event.offeredItem)
    );
    await updateLanPlayerEquipment(
      db,
      Number(offeringPlayer.id),
      addTradeItemToEquipment(offeringEquipment, event.requestedItem)
    );
    return true;
  }

  return false;
}

export async function applyLanPlayerNumberPatch(
  db: SQLiteDatabase,
  sessionId: string,
  remoteKey: string,
  patch: LanSessionEvent['numberPatch']
) {
  await ensureLanSchema(db);
  if (!patch) return false;

  const player = await getActiveLanPlayerByRemoteKey(db, sessionId, remoteKey);
  if (!player) return false;

  const currentCoinValue = toNumber(player.gp) * 100 + toNumber(player.sp) * 10 + toNumber(player.cp);
  const nextGp = patch.gp == null ? toNumber(player.gp) : Math.max(0, toNumber(patch.gp));
  const nextSp = patch.sp == null ? toNumber(player.sp) : Math.max(0, toNumber(patch.sp));
  const nextCp = patch.cp == null ? toNumber(player.cp) : Math.max(0, toNumber(patch.cp));
  const nextCoinValue = nextGp * 100 + nextSp * 10 + nextCp;

  if (nextCoinValue > currentCoinValue) return false;

  const allowedPatch: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>> = {};
  if (patch.gp != null) allowedPatch.gp = nextGp;
  if (patch.sp != null) allowedPatch.sp = nextSp;
  if (patch.cp != null) allowedPatch.cp = nextCp;
  await updateLanPlayerNumbers(db, Number(player.id), allowedPatch);
  return true;
}

export async function applyLanResourceRequest(db: SQLiteDatabase, event: LanSessionEvent, accepted: boolean) {
  await ensureLanSchema(db);
  const request = event.resourceRequest;
  if (!request) return false;

  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players
     WHERE session_id = ? AND remote_key = ? AND COALESCE(is_active, 1) = 1`,
    [event.sessionId, event.fromKey]
  );
  if (!player) return false;

  if (accepted) {
    const playerId = Number(player.id);
    if (request.kind === 'xp') {
      await updateLanPlayerNumbers(db, playerId, {
        xp: Math.max(0, toNumber(player.xp) + toNumber(request.amount)),
      });
    }

    if (request.kind === 'hp') {
      await updateLanPlayerNumbers(db, playerId, {
        hpCurrent: Math.max(0, Math.min(toNumber(player.hp_max), toNumber(player.hp_current) + toNumber(request.amount))),
      });
    }

    if (request.kind === 'stat' && request.field) {
      await addLanPlayerEffect(db, playerId, {
        name: request.message || `Pedido de ${request.field}`,
        target: normalizeEffectTarget(request.field),
        value: toNumber(request.value ?? request.amount),
        remaining: Math.max(1, toNumber(request.duration, 1)),
        unit: request.unit || 'rest',
        durationText: request.duration ? `${request.duration} ${request.unit || 'rest'}` : 'Pedido do jogador',
        kind: request.field === 'PV_TEMP' ? 'temp_hp' : request.field === 'HP' ? 'hp' : 'stat',
        source: event.fromName,
      });
    }
  }

  await rememberLanSessionEvent(db, {
    id: makeLanEventId(),
    sessionId: event.sessionId,
    type: 'resource_review',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: event.fromKey,
    toName: event.fromName,
    tradeId: event.id,
    resourceRequest: request,
    message: accepted
      ? `Mestre aceitou: ${describeResourceRequest(request)}.`
      : `Mestre recusou: ${describeResourceRequest(request)}.`,
    createdAt: new Date().toISOString(),
  });

  await syncLanSessionPayload(db, event.sessionId);
  return true;
}

export async function reviewLanPlayerPendingSnapshot(db: SQLiteDatabase, playerId: number, accepted: boolean) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players WHERE id = ?`,
    [playerId]
  );
  if (!player) return;

  const sessionId = String(player.session_id || '');
  const pending = parseJsonValue<Record<string, unknown> | null>(player.pending_character_snapshot, null);

  if (accepted && pending) {
    const normalized = normalizeCharacterState(pending);
    await db.runAsync(
      `UPDATE lan_session_players
       SET character_name = ?, character_snapshot = ?, pending_character_snapshot = NULL, notes = NULL,
           hp_current = ?, hp_max = ?, temp_hp = ?, xp = ?, gp = ?, sp = ?, cp = ?,
           stats_json = ?, equipment_json = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
           last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        normalized.characterName,
        JSON.stringify(pending),
        normalized.hpCurrent,
        normalized.hpMax,
        toNumber((pending as any).temp_hp),
        normalized.xp,
        normalized.gp,
        normalized.sp,
        normalized.cp,
        JSON.stringify(normalized.stats),
        JSON.stringify(normalized.equipment),
        playerId,
      ]
    );
  } else {
    await db.runAsync(
      `UPDATE lan_session_players
       SET pending_character_snapshot = NULL, notes = NULL, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [playerId]
    );
  }

  await rememberLanSessionEvent(db, {
    id: makeLanEventId(),
    sessionId,
    type: 'character_update_review',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: String(player.remote_key || ''),
    toName: normalizeCharacterState(parseJsonValue<Record<string, unknown>>(player.character_snapshot, {})).characterName,
    message: accepted ? 'Mestre aceitou a ficha atualizada.' : 'Mestre recusou a ficha atualizada; estado da sessao mantido.',
    createdAt: new Date().toISOString(),
  });
  await syncLanSessionPayload(db, sessionId);
}

export async function addLanPlayerEffect(
  db: SQLiteDatabase,
  playerId: number,
  effect: Omit<LanSessionEffect, 'id'>
) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT session_id, temp_hp, effects_json FROM lan_session_players WHERE id = ?`,
    [playerId]
  );
  if (!player) return;

  const effects = parseJsonValue<LanSessionEffect[]>(player.effects_json, []);
  const normalizedEffect: LanSessionEffect = {
    ...effect,
    id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: effect.kind || inferEffectKind(effect.target),
    remaining: Math.max(1, Math.floor(effect.remaining || 1)),
    value: Math.floor(effect.value || 0),
  };
  effects.push({
    ...normalizedEffect,
  });

  const nextTempHp = normalizedEffect.target === 'PV_TEMP'
    ? Math.max(0, toNumber(player.temp_hp) + Math.max(0, normalizedEffect.value))
    : toNumber(player.temp_hp);

  await db.runAsync(
    `UPDATE lan_session_players
     SET effects_json = ?, temp_hp = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(effects), nextTempHp, playerId]
  );
  await syncLanSessionPayload(db, String(player.session_id));
}

export async function removeLanPlayerEffect(db: SQLiteDatabase, playerId: number, effectId: string) {
  await ensureLanSchema(db);
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT session_id, temp_hp, effects_json FROM lan_session_players WHERE id = ?`,
    [playerId]
  );
  if (!player) return;

  const effects = parseJsonValue<LanSessionEffect[]>(player.effects_json, []);
  const removed = effects.find((effect) => effect.id === effectId);
  const nextEffects = effects.filter((effect) => effect.id !== effectId);
  const nextTempHp = removed?.target === 'PV_TEMP'
    ? Math.max(0, toNumber((player as any).temp_hp) - Math.max(0, toNumber(removed.value)))
    : toNumber((player as any).temp_hp);
  await db.runAsync(
    `UPDATE lan_session_players
     SET effects_json = ?, temp_hp = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(nextEffects), nextTempHp, playerId]
  );
  await syncLanSessionPayload(db, String(player.session_id));
}

export async function advanceLanSessionTime(db: SQLiteDatabase, sessionId: string, unit: LanAdvanceUnit) {
  await ensureLanSchema(db);
  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT current_turn, elapsed_minutes FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  const currentTurn = toNumber(session?.current_turn, 1);
  const elapsedMinutes = toNumber(session?.elapsed_minutes);
  const nextTurn = unit === 'turn' ? currentTurn + 1 : currentTurn;
  const minuteDelta = unit === 'minute' ? 1 : unit === 'hour' || unit === 'shortRest' ? 60 : unit === 'longRest' ? 480 : 0;

  await db.runAsync(
    `UPDATE lan_sessions SET current_turn = ?, elapsed_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [nextTurn, elapsedMinutes + minuteDelta, sessionId]
  );

  const players = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, remote_key, player_name, character_id, character_snapshot, hp_max, temp_hp, effects_json
     FROM lan_session_players
     WHERE session_id = ?`,
    [sessionId]
  );

  for (const player of players) {
    const effects = parseJsonValue<LanSessionEffect[]>(player.effects_json, []);
    const { active, expired } = tickEffects(effects, unit);
    const nextHp = unit === 'longRest' ? toNumber(player.hp_max) : undefined;
    const expiredTempHp = expired
      .filter((effect) => effect.target === 'PV_TEMP')
      .reduce((sum, effect) => sum + Math.max(0, toNumber(effect.value)), 0);
    const nextTempHp = Math.max(0, toNumber(player.temp_hp) - expiredTempHp);

    await db.runAsync(
      `UPDATE lan_session_players
       SET effects_json = ?, hp_current = COALESCE(?, hp_current), temp_hp = ?,
           revision_seq = COALESCE(revision_seq, 0) + 1, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(active), nextHp ?? null, nextTempHp, toNumber(player.id)]
    );

    if (nextHp !== undefined && player.character_id) {
      await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [nextHp, Number(player.character_id)]);
    }

    const normalized = normalizeCharacterState(parseJsonValue<Record<string, unknown>>(player.character_snapshot, {}));
    const characterName = normalized.characterName;
    const playerKey = String(player.remote_key || `${sessionId}:${player.character_id || characterName}:${characterName}`);

    for (const effect of expired) {
      await rememberLanSessionEvent(db, {
        id: makeLanEventId(),
        sessionId,
        type: 'effect_expired',
        fromKey: 'session',
        fromName: 'Sessao',
        toKey: playerKey,
        toName: characterName,
        expiredEffect: effect,
        message: `${characterName}: ${effect.name} acabou.`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return syncLanSessionPayload(db, sessionId);
}

export async function applyLanSessionStateToCharacter(
  db: SQLiteDatabase,
  payload: LanSessionPayload,
  characterId: number
) {
  const character = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, name FROM characters WHERE id = ?`,
    [characterId]
  );
  if (!character || !payload.state?.players?.length) return false;

  const match = payload.state.players.find((player) => {
    if (player.sourceCharacterId && player.sourceCharacterId === characterId) return true;
    return player.characterName === String(character.name || '');
  });
  if (!match) return false;

  const stats = applyEffectsToStats(match.stats, match.effects);

  await db.runAsync(
    `UPDATE characters
     SET hp_current = ?, hp_max = ?, temp_hp = ?, xp = ?, gp = ?, sp = ?, cp = ?,
         stats = ?, equipment = ?, active_effects_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      match.hpCurrent,
      match.hpMax,
      match.tempHp,
      match.xp,
      match.gp,
      match.sp,
      match.cp,
      JSON.stringify(stats),
      JSON.stringify(match.equipment),
      JSON.stringify(match.effects),
      characterId,
    ]
  );

  return true;
}

export function buildJoinDeepLink(joinUrl: string, payload: LanSessionPayload) {
  const params = new URLSearchParams({
    code: payload.session.inviteCode,
    sessionId: payload.session.id,
  });

  if (joinUrl) params.set('url', joinUrl);
  else params.set('data', JSON.stringify(payload));

  return `fichadnd:///sessionJoin?${params.toString()}`;
}

export function formatElapsedTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes.toString().padStart(2, '0')}min`;
}

export function summarizeEffect(effect: LanSessionEffect) {
  const sign = effect.value > 0 ? '+' : '';
  const unitLabel = effect.unit === 'turn' ? 'turnos' : effect.unit === 'minute' ? 'min' : effect.unit === 'hour' ? 'h' : 'descanso';
  const targetLabel = effect.target === 'PV_TEMP' ? 'PV temp.' : effect.target;
  const valueText = effect.target === 'custom' || effect.value === 0 ? '' : ` ${targetLabel} ${sign}${effect.value}`;
  return `${effect.name}:${valueText} (${effect.remaining} ${unitLabel})`;
}

function inferEffectKind(target: LanEffectTarget): LanEffectKind {
  if (target === 'PV_TEMP') return 'temp_hp';
  if (target === 'HP') return 'hp';
  if (target === 'custom') return 'custom';
  return 'stat';
}

async function appendRelatedSpellProgressions(db: SQLiteDatabase, catalog: LanSessionPayload['catalog']) {
  const customNames = [
    ...catalog.classes.map((row) => String(row.name)),
    ...catalog.subclasses.map((row) => String(row.name)),
    ...catalog.races.map((row) => String(row.name)),
  ].filter(Boolean);

  catalog.spellcasting_progression = [];
  if (customNames.length === 0) return;

  const placeholders = customNames.map(() => '?').join(',');
  const relatedProgressions = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM spellcasting_progression WHERE source_name IN (${placeholders})`,
    customNames
  );

  const seen = new Set<string>();
  for (const progression of relatedProgressions) {
    const key = `${progression.source_type}:${progression.source_name}:${progression.level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    catalog.spellcasting_progression.push(progression);
  }
}

async function upsertCatalogRow(db: SQLiteDatabase, tableName: CustomTable, row: Record<string, unknown>) {
  if (tableName === 'subclasses') {
    await db.runAsync(`DELETE FROM subclasses WHERE name = ? AND class_name = ?`, [bindValue(row.name), bindValue(row.class_name)]);
  } else if (tableName === 'spells') {
    await db.runAsync(`DELETE FROM spells WHERE name = ? AND level = ? AND classes = ?`, [bindValue(row.name), bindValue(row.level), bindValue(row.classes)]);
  } else if (tableName === 'starting_kits') {
    await db.runAsync(`DELETE FROM starting_kits WHERE name = ? AND target_name = ?`, [bindValue(row.name), bindValue(row.target_name)]);
  }

  const columns = TABLE_COLUMNS[tableName];
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((column) => bindValue(row[column]));
  const command = ['items', 'races', 'classes', 'spellcasting_progression'].includes(tableName)
    ? 'INSERT OR REPLACE'
    : 'INSERT';

  await db.runAsync(
    `${command} INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
    values
  );
}

async function getLanSessionPlayers(db: SQLiteDatabase, sessionId: string): Promise<LanSessionPlayerState[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players
     WHERE session_id = ? AND COALESCE(is_active, 1) = 1 AND kicked_at IS NULL
     ORDER BY joined_at ASC, id ASC`,
    [sessionId]
  );

  return rows.map((row) => {
    const snapshot = parseJsonValue<Record<string, unknown>>(row.character_snapshot, {});
    const normalized = normalizeCharacterState(snapshot);
    const stats = parseJsonValue<Record<string, unknown>>(row.stats_json, normalized.stats);
    const equipment = parseJsonValue<Record<string, unknown>>(row.equipment_json, normalized.equipment);
    const pendingCharacter = parseJsonValue<Record<string, unknown> | null>(row.pending_character_snapshot, null);
    const pendingDiff = parseJsonValue<string[]>(row.notes, []);

    return {
      id: toNumber(row.id),
      sessionId,
      remoteKey: row.remote_key ? String(row.remote_key) : undefined,
      playerName: String(row.player_name || normalized.playerName),
      characterId: row.character_id == null ? null : toNumber(row.character_id),
      sourceCharacterId: normalized.sourceCharacterId,
      characterName: String(row.character_name || normalized.characterName),
      level: normalized.level,
      className: normalized.className,
      race: normalized.race,
      hpCurrent: toNumber(row.hp_current, normalized.hpCurrent),
      hpMax: toNumber(row.hp_max, normalized.hpMax),
      tempHp: toNumber(row.temp_hp, normalized.tempHp),
      xp: toNumber(row.xp, normalized.xp),
      gp: toNumber(row.gp, normalized.gp),
      sp: toNumber(row.sp, normalized.sp),
      cp: toNumber(row.cp, normalized.cp),
      stats,
      equipment,
      effects: parseJsonValue<LanSessionEffect[]>(row.effects_json, []),
      pendingCharacter,
      pendingDiff: Array.isArray(pendingDiff) ? pendingDiff : [],
    };
  });
}

async function ensureLanSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      master_name TEXT,
      level INTEGER NOT NULL,
      allow_existing INTEGER NOT NULL DEFAULT 1,
      invite_code TEXT NOT NULL,
      join_url TEXT,
      transport_mode TEXT NOT NULL DEFAULT 'tcp',
      host_ip TEXT,
      host_port INTEGER,
      protocol_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      current_turn INTEGER NOT NULL DEFAULT 1,
      elapsed_minutes INTEGER NOT NULL DEFAULT 0,
      current_seq INTEGER NOT NULL DEFAULT 0,
      selected_catalog_json TEXT DEFAULT '{}',
      is_master INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_session_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      remote_key TEXT,
      player_name TEXT,
      character_id INTEGER,
      character_name TEXT,
      character_snapshot TEXT,
      hp_current INTEGER DEFAULT 0,
      hp_max INTEGER DEFAULT 0,
      temp_hp INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      gp INTEGER DEFAULT 0,
      sp INTEGER DEFAULT 0,
      cp INTEGER DEFAULT 0,
      stats_json TEXT DEFAULT '{}',
      equipment_json TEXT DEFAULT '{}',
      effects_json TEXT DEFAULT '[]',
      pending_character_snapshot TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_connected INTEGER NOT NULL DEFAULT 0,
      last_ack_seq INTEGER NOT NULL DEFAULT 0,
      revision_seq INTEGER NOT NULL DEFAULT 0,
      kicked_at DATETIME,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, character_id)
    );

    CREATE TABLE IF NOT EXISTS lan_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER,
      type TEXT NOT NULL,
      from_key TEXT,
      to_key TEXT,
      client_msg_id TEXT,
      payload_json TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_session_pending_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      player_key TEXT NOT NULL,
      player_name TEXT,
      kind TEXT NOT NULL,
      amount INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_session_trades (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      offer_json TEXT NOT NULL DEFAULT '{}',
      request_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns: [string, string, string][] = [
    ['lan_sessions', 'status', "TEXT NOT NULL DEFAULT 'active'"],
    ['lan_sessions', 'current_turn', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_sessions', 'elapsed_minutes', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_sessions', 'current_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_sessions', 'selected_catalog_json', "TEXT DEFAULT '{}'"],
    ['lan_sessions', 'transport_mode', "TEXT NOT NULL DEFAULT 'tcp'"],
    ['lan_sessions', 'host_ip', 'TEXT'],
    ['lan_sessions', 'host_port', 'INTEGER'],
    ['lan_sessions', 'protocol_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_sessions', 'is_master', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_sessions', 'updated_at', 'DATETIME'],
    ['lan_session_players', 'remote_key', 'TEXT'],
    ['lan_session_players', 'character_name', 'TEXT'],
    ['lan_session_players', 'hp_current', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'hp_max', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'temp_hp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'xp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'gp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'sp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'cp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'stats_json', "TEXT DEFAULT '{}'"],
    ['lan_session_players', 'equipment_json', "TEXT DEFAULT '{}'"],
    ['lan_session_players', 'effects_json', "TEXT DEFAULT '[]'"],
    ['lan_session_players', 'pending_character_snapshot', 'TEXT'],
    ['lan_session_players', 'notes', 'TEXT'],
    ['lan_session_players', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_session_players', 'is_connected', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'last_ack_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'revision_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'kicked_at', 'DATETIME'],
    ['lan_session_players', 'last_seen_at', 'DATETIME'],
    ['lan_session_events', 'seq', 'INTEGER'],
    ['lan_session_events', 'from_key', 'TEXT'],
    ['lan_session_events', 'to_key', 'TEXT'],
    ['lan_session_events', 'client_msg_id', 'TEXT'],
    ['lan_session_events', 'processed', 'INTEGER NOT NULL DEFAULT 0'],
    ['items', 'effect_json', "TEXT DEFAULT '[]'"],
    ['items', 'duration_value', 'INTEGER'],
    ['items', 'duration_unit', 'TEXT'],
    ['spells', 'effect_json', "TEXT DEFAULT '[]'"],
    ['spells', 'duration_value', 'INTEGER'],
    ['spells', 'duration_unit', 'TEXT'],
  ];

  for (const [table, column, definition] of columns) {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch {
      // Coluna ja existe ou a tabela acabou de ser criada com a coluna.
    }
  }

  try {
    await db.execAsync(`UPDATE lan_sessions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);`);
  } catch {
    // Mantem compatibilidade com estados intermediarios de migracao.
  }

  try {
    await db.execAsync(`UPDATE lan_session_players SET last_seen_at = COALESCE(last_seen_at, joined_at, CURRENT_TIMESTAMP);`);
  } catch {
    // Mantem compatibilidade com estados intermediarios de migracao.
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_lan_players_session ON lan_session_players(session_id);
    CREATE INDEX IF NOT EXISTS idx_lan_players_remote_key ON lan_session_players(session_id, remote_key);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_seq ON lan_session_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_created ON lan_session_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lan_requests_session_status ON lan_session_pending_requests(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_lan_trades_session_status ON lan_session_trades(session_id, status);
  `);
}

function normalizeCharacterState(character: Record<string, unknown>) {
  const characterName = String(character.name || 'Personagem');

  return {
    playerName: characterName,
    characterName,
    sourceCharacterId: character.id == null ? null : toNumber(character.id),
    level: toNumber(character.level, 1),
    className: String(character.class || '-'),
    race: String(character.race || '-'),
    hpCurrent: toNumber(character.hp_current),
    hpMax: toNumber(character.hp_max),
    tempHp: toNumber(character.temp_hp),
    xp: toNumber(character.xp),
    gp: toNumber(character.gp),
    sp: toNumber(character.sp),
    cp: toNumber(character.cp),
    stats: parseJsonValue<Record<string, unknown>>(character.stats, {}),
    equipment: normalizeEquipment(character.equipment),
  };
}

function describeCharacterDiff(current: Record<string, unknown>, incoming: ReturnType<typeof normalizeCharacterState>) {
  const diffs: string[] = [];
  const currentSnapshot = normalizeCharacterState(parseJsonValue<Record<string, unknown>>(current.character_snapshot, {}));
  const currentValues = {
    hpCurrent: toNumber(current.hp_current, currentSnapshot.hpCurrent),
    hpMax: toNumber(current.hp_max, currentSnapshot.hpMax),
    tempHp: toNumber(current.temp_hp, currentSnapshot.tempHp),
    xp: toNumber(current.xp, currentSnapshot.xp),
    gp: toNumber(current.gp, currentSnapshot.gp),
    sp: toNumber(current.sp, currentSnapshot.sp),
    cp: toNumber(current.cp, currentSnapshot.cp),
    stats: parseJsonValue<Record<string, unknown>>(current.stats_json, currentSnapshot.stats),
    equipment: parseJsonValue<Record<string, unknown>>(current.equipment_json, currentSnapshot.equipment),
  };

  if (
    incoming.hpCurrent !== currentValues.hpCurrent ||
    incoming.hpMax !== currentValues.hpMax ||
    incoming.tempHp !== currentValues.tempHp
  ) {
    diffs.push(`HP ${currentValues.hpCurrent}/${currentValues.hpMax} (+${currentValues.tempHp}) -> ${incoming.hpCurrent}/${incoming.hpMax} (+${incoming.tempHp})`);
  }
  if (incoming.xp !== currentValues.xp) diffs.push(`XP ${currentValues.xp} -> ${incoming.xp}`);
  if (incoming.gp !== currentValues.gp || incoming.sp !== currentValues.sp || incoming.cp !== currentValues.cp) {
    diffs.push(`Moedas ${currentValues.gp} PO, ${currentValues.sp} PP, ${currentValues.cp} PC -> ${incoming.gp} PO, ${incoming.sp} PP, ${incoming.cp} PC`);
  }
  if (JSON.stringify(incoming.stats) !== JSON.stringify(currentValues.stats)) diffs.push('Atributos alterados');
  if (JSON.stringify(incoming.equipment) !== JSON.stringify(currentValues.equipment)) diffs.push('Inventario alterado');

  return diffs;
}

function normalizeEquipment(value: unknown): Record<string, unknown> {
  const equipment = parseJsonValue<any>(value, {});
  if (Array.isArray(equipment)) return { bag: equipment, slots: {} };
  if (!equipment || typeof equipment !== 'object') return { bag: [], slots: {} };
  return {
    ...equipment,
    bag: Array.isArray(equipment.bag) ? equipment.bag : [],
    slots: equipment.slots || {},
  };
}

async function getActiveLanPlayerByRemoteKey(db: SQLiteDatabase, sessionId: string, remoteKey: string) {
  return db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, equipment_json, gp, sp, cp
     FROM lan_session_players
     WHERE session_id = ? AND remote_key = ? AND COALESCE(is_active, 1) = 1`,
    [sessionId, remoteKey]
  );
}

function addTradeItemToEquipment(equipment: Record<string, unknown>, tradeItem: LanTradeItem) {
  const nextEquipment = normalizeEquipment(equipment);
  const bag = Array.isArray((nextEquipment as any).bag) ? [...(nextEquipment as any).bag] : [];
  const itemName = String(tradeItem.name || '').trim();
  const qty = Math.max(1, toNumber(tradeItem.qty, 1));
  const existingIndex = bag.findIndex((entry: any) => String(entry?.name || '').trim().toLowerCase() === itemName.toLowerCase());

  if (existingIndex >= 0) {
    bag[existingIndex] = { ...bag[existingIndex], qty: Math.max(0, toNumber(bag[existingIndex].qty)) + qty };
  } else if (itemName) {
    bag.push({ ...tradeItem, name: itemName, qty });
  }

  return { ...nextEquipment, bag };
}

function removeTradeItemFromEquipment(equipment: Record<string, unknown>, tradeItem: LanTradeItem) {
  const bag = Array.isArray((equipment as any).bag) ? [...(equipment as any).bag] : [];
  const itemName = String(tradeItem.name || '').trim().toLowerCase();
  const qty = Math.max(1, toNumber(tradeItem.qty, 1));
  const index = bag.findIndex((entry: any) => String(entry?.name || '').trim().toLowerCase() === itemName);
  if (index < 0) return false;

  const currentQty = Math.max(0, toNumber(bag[index].qty, 1));
  if (currentQty < qty) return false;

  const nextQty = currentQty - qty;
  if (nextQty <= 0) bag.splice(index, 1);
  else bag[index] = { ...bag[index], qty: nextQty };

  (equipment as any).bag = bag;
  return true;
}

function hasInventoryIncrease(currentEquipment: Record<string, unknown>, nextEquipment: Record<string, unknown>) {
  const currentCounts = getEquipmentCounts(currentEquipment);
  const nextCounts = getEquipmentCounts(nextEquipment);

  for (const [name, qty] of Object.entries(nextCounts)) {
    if (qty > (currentCounts[name] || 0)) return true;
  }

  return false;
}

function getEquipmentCounts(equipment: Record<string, unknown>) {
  const bag = Array.isArray((equipment as any).bag) ? (equipment as any).bag : [];
  const slots = (equipment as any).slots && typeof (equipment as any).slots === 'object'
    ? Object.values((equipment as any).slots).filter(Boolean)
    : [];

  return [...bag, ...slots].reduce<Record<string, number>>((counts, item: any) => {
    const name = String(item?.name || '').trim().toLowerCase();
    if (!name) return counts;
    counts[name] = (counts[name] || 0) + Math.max(0, toNumber(item.qty, 1));
    return counts;
  }, {});
}

function normalizeEffectTarget(value: unknown): LanEffectTarget {
  const target = String(value || '').toUpperCase();
  if (target === 'FOR' || target === 'DES' || target === 'CON' || target === 'INT' || target === 'SAB' || target === 'CAR' || target === 'CA' || target === 'HP' || target === 'PV_TEMP') {
    return target as LanEffectTarget;
  }
  return 'custom';
}

function describeResourceRequest(request: LanResourceRequest) {
  if (request.message) return request.message;
  if (request.kind === 'xp') return `XP ${toNumber(request.amount) >= 0 ? '+' : ''}${toNumber(request.amount)}`;
  if (request.kind === 'hp') return `HP ${toNumber(request.amount) >= 0 ? '+' : ''}${toNumber(request.amount)}`;
  if (request.kind === 'stat') return `${request.field || 'atributo'} ${toNumber(request.value ?? request.amount) >= 0 ? '+' : ''}${toNumber(request.value ?? request.amount)}`;
  if (request.kind === 'inventory') return request.item ? `${request.item.qty}x ${request.item.name}` : 'inventario';
  return 'pedido';
}

function applyEffectsToStats(stats: Record<string, unknown>, effects: LanSessionEffect[]) {
  const nextStats: Record<string, any> = { ...stats };
  const tempMods: Record<string, number> = {};

  for (const effect of effects) {
    if (!['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(effect.target)) continue;
    if (effect.mode === 'set') {
      const baseValue = toNumber(nextStats[effect.target], effect.target === 'CA' ? 10 : 10);
      tempMods[effect.target] = effect.value - baseValue;
    } else {
      tempMods[effect.target] = (tempMods[effect.target] || 0) + effect.value;
    }
  }

  nextStats.temp_mods = tempMods;

  return nextStats;
}

async function updateLocalCharacterNumbers(
  db: SQLiteDatabase,
  characterId: number,
  patch: Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>
) {
  const columnMap = {
    hpCurrent: 'hp_current',
    hpMax: 'hp_max',
    tempHp: 'temp_hp',
    xp: 'xp',
    gp: 'gp',
    sp: 'sp',
    cp: 'cp',
  } as const;
  const entries = Object.entries(patch).filter(([key, value]) => key in columnMap && value !== undefined);
  if (entries.length === 0) return;

  const setSql = entries.map(([key]) => `${columnMap[key as keyof typeof columnMap]} = ?`).join(', ');
  const values = entries.map(([, value]) => Math.max(0, Math.floor(Number(value) || 0)));
  await db.runAsync(`UPDATE characters SET ${setSql} WHERE id = ?`, [...values, characterId]);
}

function tickEffects(effects: LanSessionEffect[], unit: LanAdvanceUnit) {
  const next = effects.map((effect) => {
      let delta = 0;
      if (effect.unit === 'turn' && unit === 'turn') delta = 1;
      if (effect.unit === 'minute') {
        if (unit === 'minute') delta = 1;
        if (unit === 'hour' || unit === 'shortRest') delta = 60;
        if (unit === 'longRest') delta = 480;
      }
      if (effect.unit === 'hour') {
        if (unit === 'hour' || unit === 'shortRest') delta = 1;
        if (unit === 'longRest') delta = 8;
      }
      if (effect.unit === 'rest' && (unit === 'shortRest' || unit === 'longRest')) delta = effect.remaining;
      return { ...effect, remaining: Math.max(0, effect.remaining - delta) };
    });

  return {
    active: next.filter((effect) => effect.remaining > 0),
    expired: next.filter((effect) => effect.remaining <= 0),
  };
}

function describeCatalogOption(tableName: SelectableCustomTable, row: Record<string, unknown>) {
  if (tableName === 'items') {
    return [row.damage, row.damage_type, row.properties].filter((value) => value && value !== '-').join(' - ') || 'Item customizado';
  }
  if (tableName === 'spells') {
    return [row.level, row.category, row.duration, row.damage_dice].filter((value) => value && value !== '-').join(' - ') || 'Magia customizada';
  }
  if (tableName === 'races') return `Deslocamento ${row.speed || '-'}`;
  if (tableName === 'classes') return `Dado de vida d${row.hit_dice || '-'}`;
  if (tableName === 'subclasses') return `Classe ${row.class_name || '-'} - Nivel ${row.level_required || 1}`;
  if (tableName === 'starting_kits') return `${row.target_type || '-'}: ${row.target_name || '-'}`;
  return '';
}

function makeEmptyCatalog(): LanSessionPayload['catalog'] {
  return {
    items: [],
    races: [],
    classes: [],
    subclasses: [],
    spells: [],
    starting_kits: [],
    spellcasting_progression: [],
  };
}

function normalizeCatalogSelection(selection?: CatalogSelection | Record<string, unknown> | null): CatalogSelection {
  const normalized = emptyCatalogSelection();
  if (!selection || typeof selection !== 'object') return normalized;

  for (const table of SELECTABLE_CUSTOM_TABLES) {
    const rawIds = (selection as Record<string, unknown>)[table];
    if (!Array.isArray(rawIds)) continue;
    const ids = Array.from(new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
    if (ids.length > 0) normalized[table] = ids;
  }

  return normalized;
}

function isSelectableTable(value: string): value is SelectableCustomTable {
  return SELECTABLE_CUSTOM_TABLES.includes(value as SelectableCustomTable);
}

function normalizeSessionStatus(value: unknown): LanSessionStatus {
  if (value === 'paused' || value === 'ended') return value;
  return 'active';
}

function bindValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
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

function parseLanSessionEvent(value: unknown) {
  const event = parseJsonValue<LanSessionEvent | null>(value, null);
  if (!event || typeof event !== 'object') return null;
  if (!event.id || !event.sessionId || !event.type) return null;
  return event;
}

function isAndroidEmulatorPrivateHost(host: string) {
  return /^10\.0\.[23]\.\d+$/.test(host);
}

function getTransportInfoFromJoinUrl(joinUrl?: string) {
  if (!joinUrl) return { mode: 'tcp', host: null as string | null, port: null as number | null };

  try {
    const parsed = new URL(joinUrl);
    const mode = parsed.protocol.startsWith('tcp') ? 'tcp' : 'unsupported';
    const port = parsed.port ? Number(parsed.port) : LAN_TCP_PORT;
    return {
      mode,
      host: parsed.hostname || null,
      port: Number.isFinite(port) ? port : null,
    };
  } catch {
    return { mode: 'tcp', host: null as string | null, port: null as number | null };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('LAN request timed out')), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function updateLanHostPayload(joinUrl: string | undefined, payload: LanSessionPayload) {
  if (isTcpLanUrl(joinUrl)) updateLanTcpHostPayload(payload);
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
