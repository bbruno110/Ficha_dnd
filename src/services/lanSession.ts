import type { SQLiteDatabase } from 'expo-sqlite';
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';

import {
  applyEffectToPlayer,
  consumeTempHpFromPlayer,
  ensureEffectSchema,
  listEffects,
  removeEffectFromPlayer,
  removeTempHpEffectsFromPlayer,
  tickTurnEffects,
  type LanEffectPatch,
  type LanPendingSave,
} from './effects';
import { applyDamageWithTempHp } from './combat/hpDamageService';
import {
  commitLanEvent,
  ensureLanEventStoreSchema,
  listLanEvents,
} from './lan/lanEventStore';
import { ensureLanSyncSchema, saveLanSessionSnapshot } from './lanSyncEngine';
import {
  fetchLanTcpPayload,
  getLanTcpClientEvents,
  getLanTcpHostAcks,
  getLanTcpHostEvents,
  getLanTcpHostJoinedRows,
  isTcpLanUrl,
  kickLanTcpHostJoinedPlayer,
  LAN_TCP_PORT,
  resetLanTcpClient,
  resolveLanTcpUrlByInviteCode,
  requestLanTcpResync,
  sendLanTcpAck,
  sendLanTcpNack,
  sendLanTcpEvent,
  sendLanTcpJoin,
  startLanTcpHost,
  stopLanTcpHost,
  subscribeLanTcpClientUpdates,
  type ClientUpdate as TcpClientUpdate,
  subscribeLanTcpHostUpdates,
  updateLanTcpHostPayload,
  type HostUpdate,
} from './lanTcpTransport';
import { debugLanFlow } from './lanRuntimeMode';
import { getExpectedLevelForXp } from './xpProgressionService';

const LAN_START_TIMEOUT_MS = 4500;
const LAN_FOREGROUND_STOP_EVENT = 'LanSessionForegroundStop';
const POST_NOTIFICATIONS_PERMISSION = 'android.permission.POST_NOTIFICATIONS' as Parameters<typeof PermissionsAndroid.check>[0];
let lanClientId = '';

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
export type LanEffectUnit =
  | 'instant'
  | 'turn'
  | 'round'
  | 'minute'
  | 'hour'
  | 'day'
  | 'short_rest'
  | 'long_rest'
  | 'rest'
  | 'concentration'
  | 'while_equipped'
  | 'while_active'
  | 'until_save'
  | 'permanent'
  | 'manual';
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
  /**
   * Identifica a instancia atual do host TCP.
   * O sessionId pode ser o mesmo ao reabrir uma mesa, mas o hostInstanceId muda.
   */
  hostInstanceId?: string;
};

export type LanSessionEffect = {
  id: string;
  name: string;
  target: LanEffectTarget;
  value: number;
  remaining: number;
  unit: LanEffectUnit;
  isPermanent?: boolean;
  kind?: LanEffectKind;
  mode?: 'add' | 'set';
  durationText?: string;
  status?: string;
  statusKey?: string;
  source?: string;
  sourceType?: string;
  sourceId?: string;
  color?: string;
  secondaryColor?: string;
  icon?: string;
  visibleToPlayer?: boolean;
  publicNote?: string;
  privateNote?: string;
  saveDc?: number | null;
  saveAbility?: string | null;
  repeatSave?: string | null;
  removableBySave?: boolean;
  visualPriority?: number;
};

export type LanSessionPlayerState = {
  id: number;
  sessionId: string;
  remoteKey?: string;
  clientId?: string;
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
  characterSnapshot?: Record<string, unknown>;
  pendingCharacter?: Record<string, unknown> | null;
  pendingDiff?: string[];
  revisionSeq?: number;
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
  effectCatalog?: Record<string, unknown>[];
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
  clientRequestId?: string;
  kind: 'xp' | 'hp' | 'temp_hp' | 'coin' | 'stat' | 'buff' | 'condition' | 'inventory';
  action?: 'add' | 'remove' | 'heal' | 'damage' | 'set' | 'temp';
  operation?: string;
  amount?: number;
  field?: string;
  value?: number;
  item?: LanTradeItem;
  duration?: number;
  unit?: LanEffectUnit;
  message?: string;
};

export type LanSpellEventMode = 'heal' | 'damage' | 'effect';
export type LanActionRollMode = 'virtual' | 'manual';
export type LanActionKind = 'heal' | 'damage' | 'effect' | 'attack' | 'save' | 'item' | 'skill' | 'ability' | 'spell';
export type LanSessionEventType =
  | 'skill_cast_request'
  | 'ability_use_request'
  | 'spell_cast_request'
  | 'item_use_request'
  | 'action_result'
  | 'skill_result'
  | 'spell_cast_result'
  | 'ability_use_result'
  | 'public_action_result'
  | 'effect_save_request'
  | 'effect_save_result'
  | 'send_item'
  | 'send_item_request'
  | 'send_item_result'
  | 'trade_offer'
  | 'trade_accept'
  | 'trade_decline'
  | 'trade_result'
  | 'coin_self_patch_request'
  | 'master_grant_item'
  | 'quest_reward_granted'
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
  | 'effect_catalog_patch'
  | 'pending_save_patch'
  | 'session_patch'
  | 'session_ended'
  | 'timeline_event';

export type LanSessionEvent = {
  protocol?: 'ficha-dnd-lan-v2';
  id: string;
  sessionId: string;
  seq?: number;
  serverSeq?: number;
  type: LanSessionEventType;
  fromKey: string;
  fromName: string;
  toKey: string;
  toName: string;
  clientMsgId?: string;
  entityType?: string;
  entityId?: string;
  entityRevision?: number;
  baseRevision?: number;
  ackRequired?: boolean;
  originClientId?: string;
  item?: LanTradeItem;
  offeredItem?: LanTradeItem;
  requestedItem?: LanTradeItem;
  actionRequest?: {
    actionId?: string;
    actionName?: string;
    actionKind?: LanActionKind | string;
    sourceType?: 'spell' | 'item' | 'skill' | 'ability' | 'manual' | string;
    targetKind?: 'self' | 'player' | 'party' | 'manual' | 'enemy' | string;
    targetKey?: string;
    targetName?: string;
    rollMode?: LanActionRollMode;
    rolls?: Array<{
      rollMode?: LanActionRollMode;
      formula?: string;
      dice?: string;
      rawRoll?: number;
      manualValue?: number;
      modifier?: number;
      total?: number;
      rollId?: string;
      timestamp?: string;
    }>;
    declaredValue?: number;
    spellEffect?: LanSessionEvent['spellEffect'];
    item?: LanTradeItem;
    itemQty?: number;
    effects?: Record<string, unknown>[];
    chosenAttr?: string;
    save?: {
      enabled?: boolean;
      saveAbility?: string;
      fallbackAbilities?: string[];
      dc?: number;
      rollMode?: LanActionRollMode | 'target_choice';
      saveOnSuccess?: 'none' | 'half' | 'negates' | 'reduces_duration' | 'removes_condition' | 'custom' | string;
      saveOnFailure?: 'apply_full' | 'apply_half' | 'custom' | string;
      pendingEffectPayload?: Record<string, unknown>;
    };
    attack?: {
      attackRoll?: number;
      attackModifier?: number;
      attackTotal?: number;
      rollMode?: LanActionRollMode;
      targetAC?: number;
      isCritical?: boolean;
      isFumble?: boolean;
      hit?: boolean;
      damageRoll?: number;
      damageType?: string;
    };
    createdAt?: string;
  };
  actionResult?: {
    actionId?: string;
    requestId?: string;
    status: 'accepted' | 'rejected';
    reason?: string;
    targetKey?: string;
    amount?: number;
    hpCurrent?: number;
    tempHp?: number;
    attack?: Record<string, unknown>;
    roll?: Record<string, unknown>;
  };
  saveRequest?: {
    id: string;
    sourceEffectId?: string;
    sourceEffectName?: string;
    targetKey: string;
    saveAbility: string;
    fallbackAbilities?: string[];
    dc?: number | null;
    rollMode?: LanActionRollMode | 'target_choice';
    saveOnSuccess?: string;
    saveOnFailure?: string;
    pendingEffectPayload?: Record<string, unknown>;
  };
  saveResult?: {
    requestId: string;
    rollMode: LanActionRollMode;
    dice?: string;
    rawRoll?: number;
    manualValue?: number;
    modifier?: number;
    total?: number;
    dc?: number | null;
    passed?: boolean;
  };
  coinPatchRequest?: {
    targetKey?: string;
    current?: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>>;
    next?: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>>;
    currentTotalCopper?: number;
    nextTotalCopper?: number;
    reason?: string;
  };
  sendItemRequest?: {
    requestId?: string;
    fromKey?: string;
    toKey?: string;
    item?: LanTradeItem;
    qty?: number;
  };
  sendItemResult?: {
    requestId?: string;
    status: 'accepted' | 'rejected';
    reason?: string;
  };
  tradeAccept?: {
    tradeId?: string;
    fromKey?: string;
    toKey?: string;
  };
  tradeResult?: {
    tradeId?: string;
    status: 'accepted' | 'rejected';
    reason?: string;
  };
  publicState?: {
    hpCurrent: number;
    hpMax: number;
    tempHp?: number;
    level: number;
  };
  spellEffect?: {
    spellName: string;
    mode: LanSpellEventMode;
    effectMode?: 'add' | 'set';
    amount?: number;
    target?: LanEffectTarget;
    value?: number;
    durationText?: string;
    durationRemaining?: number;
    durationUnit?: LanEffectUnit;
    status?: string;
    color?: string;
    secondaryColor?: string;
    description?: string;
  };
  expiredEffect?: LanSessionEffect;
  effectPatch?: LanEffectPatch;
  effectCatalogPatch?: {
    action: 'upsert' | 'disable' | 'delete';
    effect?: Record<string, unknown>;
    statusKey?: string;
  };
  pendingSavePatch?: {
    action: 'create' | 'resolve';
    save?: LanPendingSave;
    id?: string;
    result?: Record<string, unknown>;
  };
  sessionPatch?: {
    status?: LanSessionStatus;
    hostInstanceId?: string;
    sessionEpoch?: number;
    pausedAt?: string;
    resumedAt?: string;
    reason?: string;
    keepPlayersLinked?: boolean;
    readOnlyForPlayers?: boolean;
  };
  sessionEnded?: {
    endedAt?: string;
    reason?: string;
    unlinkPlayers?: boolean;
    allowOfflineAfterEnd?: boolean;
    preserveOfficialRewards?: boolean;
    clearTemporarySessionEffects?: boolean;
  };
  resourceRequest?: LanResourceRequest;
  inventoryPatch?: {
    targetKey?: string;
    equipment: Record<string, unknown>;
    reason?: string;
    action?: 'grant' | 'remove' | 'set_quantity' | 'replace' | 'self_update' | 'transfer_in' | 'transfer_out' | string;
    grantId?: string;
  };
  numberPatch?: Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;
  statsPatch?: Record<string, unknown>;
  tradeId?: string;
  visibility?: 'public' | 'party' | 'private' | string;
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
  startForegroundSession?: (sessionName: string, inviteCode: string, joinUrl: string, playerCount: number) => Promise<boolean>;
  updateForegroundSession?: (sessionName: string, inviteCode: string, joinUrl: string, playerCount: number) => Promise<boolean>;
  stopForegroundSession?: () => Promise<boolean>;
  consumeForegroundStopRequest?: () => Promise<boolean>;
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

export function makeLanHostInstanceId() {
  return `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  const normalizedSession: LanSessionRules = {
    ...session,
    hostInstanceId: session.hostInstanceId || makeLanHostInstanceId(),
  };

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
  const effectCatalog = await listEffects(db);

  return {
    type: 'ficha-dnd-lan-session',
    version: 1,
    createdAt: new Date().toISOString(),
    session: normalizedSession,
    catalog,
    effectCatalog: effectCatalog.map((effect) => ({
      statusKey: effect.statusKey,
      name: effect.name,
      kind: effect.kind,
      category: effect.category,
      description: effect.description,
      color: effect.color,
      secondaryColor: effect.secondaryColor,
      icon: effect.icon,
      stackable: effect.stackable,
      removableBySave: effect.removableBySave,
      repeatSave: effect.repeatSave,
      saveAbility: effect.saveAbility,
      saveOnSuccess: effect.saveOnSuccess,
      defaultDurationValue: effect.defaultDurationValue,
      defaultDurationUnit: effect.defaultDurationUnit,
      visualPriority: effect.visualPriority,
      rulesJson: effect.rulesJson,
      active: effect.active,
    })),
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

export async function saveLanSession(
  db: SQLiteDatabase,
  payload: LanSessionPayload,
  joinUrl?: string,
  options?: { isMaster?: boolean }
) {
  await ensureLanSchema(db);

  const state = payload.state || {
    status: 'active' as const,
    currentTurn: 1,
    elapsedMinutes: 0,
    players: [],
  };

  const selectedCatalog = normalizeCatalogSelection(payload.selectedCatalog);
  const transport = getTransportInfoFromJoinUrl(joinUrl);

  // IMPORTANTE:
  // Por segurança, o padrão agora é jogador.
  // Só vira mestre quando a tela do mestre passar explicitamente { isMaster: true }.
  const isMaster = options?.isMaster === true;

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
       SET name = ?,
           master_name = ?,
           level = ?,
           allow_existing = ?,
           invite_code = ?,
           join_url = ?,
           payload_json = ?,
           status = ?,
           current_turn = ?,
           elapsed_minutes = ?,
           selected_catalog_json = ?,
           transport_mode = ?,
           host_ip = ?,
           host_port = ?,
           is_master = ?,
           active = CASE WHEN ? = 'ended' THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...values, state.status, payload.session.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO lan_sessions (
        id, name, master_name, level, allow_existing, invite_code,
        join_url, payload_json, status, current_turn, elapsed_minutes,
        selected_catalog_json, transport_mode, host_ip, host_port,
        is_master, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'ended' THEN 0 ELSE 1 END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [payload.session.id, ...values, state.status]
    );
  }

  await saveLanSessionSnapshot(db, payload).catch(() => {});
}

export async function getSavedLanSessions(db: SQLiteDatabase): Promise<LanSessionSummary[]> {
  await ensureLanSchema(db);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT s.*,
            CASE
              WHEN COALESCE(s.is_master, 0) = 1 THEN (
                SELECT COUNT(*)
                FROM lan_session_players p
                WHERE p.session_id = s.id
                  AND COALESCE(p.is_active, 1) = 1
                  AND p.kicked_at IS NULL
              )
              ELSE 0
            END as player_count,
            CASE
              WHEN COALESCE(s.is_master, 0) = 0 THEN (
                SELECT COUNT(*)
                FROM lan_local_character_bindings b
                WHERE b.session_id = s.id
                  AND COALESCE(b.is_active, 1) = 1
              )
              ELSE 0
            END as bound_count
     FROM lan_sessions s
     WHERE COALESCE(s.active, 1) = 1
       AND COALESCE(s.status, 'active') != 'ended'
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC`
  );

  return rows
    .filter((row) => normalizeSessionStatus(row.status) !== 'ended' && Boolean(toNumber(row.active, 1)))
    .filter((row) => toNumber(row.is_master) === 1 || toNumber(row.bound_count) > 0)
    .map((row) => ({
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
    isMaster: toNumber(row.is_master) === 1,
    selectedCatalog: normalizeCatalogSelection(parseJsonValue(row.selected_catalog_json, {})),
    playerCount: toNumber(row.player_count),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  }));
}

export async function deleteLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);
  await db.runAsync(`DELETE FROM lan_pending_saves WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_active_effects WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_trades WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_pending_requests WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_events WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_session_players WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_local_character_bindings WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM lan_sessions WHERE id = ?`, [sessionId]);
}

export async function startLanServer(payload: LanSessionPayload) {
  let joinUrl = '';

  try {
    joinUrl = await withTimeout(startLanTcpHost(payload), LAN_START_TIMEOUT_MS);
  } catch (error) {
    await stopLanTcpHost();

    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `[LAN TCP] Não foi possível abrir o servidor TCP na porta ${LAN_TCP_PORT}. ` +
      `Erro original: ${message}`
    );
  }

  if (!joinUrl) {
    throw new Error('[LAN TCP] O servidor TCP iniciou, mas nenhuma URL LAN foi gerada.');
  }

  // IMPORTANTE:
  // Desative temporariamente o foreground service até confirmar que o TCP inicia.
  await startLanForegroundSession(payload, joinUrl);

  return joinUrl;
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
  // Quando a tela do mestre já está hospedando uma sessão local, o transporte TCP
  // mantém os joins em memória no host. Não dependa de joinUrl preenchida aqui,
  // porque durante retomada/foreground o estado React pode ficar alguns ms atrasado.
  if (!joinUrl || isTcpLanUrl(joinUrl)) return getLanTcpHostJoinedRows();
  return [];
}

export async function getNativeSessionEvents(joinUrl?: string) {
  // Mesmo raciocínio do roster: se somos o host local, os eventos ficam em memória
  // no transporte e devem ser consumidos pela tela do mestre ainda que joinUrl esteja
  // momentaneamente vazio/desatualizado.
  if (!joinUrl || isTcpLanUrl(joinUrl)) return getLanTcpHostEvents();
  return [];
}

export async function getNativeSessionAcks(joinUrl?: string) {
  if (!joinUrl || isTcpLanUrl(joinUrl)) return getLanTcpHostAcks();
  return [];
}

export type LanSessionHostUpdate = HostUpdate;

export function subscribeLanSessionHostUpdates(
  joinUrl: string | undefined,
  listener: (update?: LanSessionHostUpdate) => void,
) {
  if (joinUrl && !isTcpLanUrl(joinUrl)) return () => {};
  return subscribeLanTcpHostUpdates(listener);
}

export type LanSessionClientUpdate = TcpClientUpdate;

export function subscribeLanSessionClientUpdates(
  joinUrl: string | undefined,
  listener: (update?: LanSessionClientUpdate) => void,
) {
  if (!isTcpLanUrl(joinUrl)) return () => {};
  return subscribeLanTcpClientUpdates(listener);
}

export async function stopLanServer() {
  await stopLanForegroundSession();
  await stopLanTcpHost();
  if (Platform.OS !== 'android' || !lanNative?.stopSession) return false;
  return lanNative.stopSession();
}

export async function stopLanServerTransportOnly() {
  await stopLanForegroundSession();
  await stopLanTcpHost();
  if (Platform.OS !== 'android' || !lanNative?.stopSession) return false;
  return lanNative.stopSession();
}

export async function switchLanRole(nextRole: 'master' | 'player') {
  if (nextRole === 'master') {
    resetLanClientConnection();
    return;
  }

  await stopLanServerTransportOnly();
  resetLanClientConnection();
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

export type FetchLanSessionEventsOptions = {
  afterSeq?: number;
  playerKey?: string;
  includeGlobal?: boolean;
};

export async function fetchLanSessionEvents(
  joinUrl: string,
  sessionId?: string,
  options?: FetchLanSessionEventsOptions,
): Promise<LanSessionEvent[]> {
  if (!joinUrl) return [];
  const afterSeq = Math.max(0, Math.floor(Number(options?.afterSeq || 0)));
  if (isTcpLanUrl(joinUrl)) return getLanTcpClientEvents(joinUrl, sessionId, {
    afterSeq,
    playerKey: options?.playerKey,
    includeGlobal: options?.includeGlobal !== false,
  });
  return [];
}

export async function sendLanSessionEvent(joinUrl: string | undefined, event: LanSessionEvent) {
  if (isTcpLanUrl(joinUrl)) return sendLanTcpEvent(joinUrl, event);
  throw new Error('Sessao LAN sem socket TCP ativo.');
}

export async function ackLanSessionEvent(joinUrl: string | undefined, ack: { sessionId: string; eventId: string; clientMsgId?: string; playerKey?: string; lastAppliedSeq?: number; entityId?: string; entityRevision?: number }) {
  if (!joinUrl) return false;
  if (isTcpLanUrl(joinUrl)) return sendLanTcpAck(joinUrl, ack);
  return false;
}

export async function requestLanSessionResync(joinUrl: string | undefined, request: { sessionId: string; playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number>; includeGlobal?: boolean }) {
  if (!joinUrl) return false;
  if (isTcpLanUrl(joinUrl)) return requestLanTcpResync(joinUrl, request);
  return false;
}

export async function nackLanSessionEvent(joinUrl: string | undefined, nack: { sessionId: string; eventId?: string; clientMsgId?: string; playerKey?: string; reason: string }) {
  if (!joinUrl) return false;
  if (isTcpLanUrl(joinUrl)) return sendLanTcpNack(joinUrl, nack);
  return false;
}

export async function rememberAndSendLanSessionEvent(
  db: SQLiteDatabase,
  joinUrl: string | undefined,
  event: LanSessionEvent
) {
  await ensureLanSchema(db);
  const { event: committedEvent, inserted } = await commitLanEvent(db, event);
  if (!inserted) return null;

  if (joinUrl) {
    await sendLanSessionEvent(joinUrl, committedEvent);
  }

  return committedEvent;
}

export function resetLanClientConnection() {
  resetLanTcpClient();
}

export async function getLanClientId() {
  if (!lanClientId) {
    lanClientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return lanClientId;
}

export async function closeAllLanSessionsBeforeCreate(db: SQLiteDatabase) {
  await ensureLanSchema(db);
  await db.runAsync(
    `UPDATE lan_sessions
     SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE active = 1`
  );
  await db.runAsync(
    `UPDATE lan_session_players
     SET is_active = 0,
         is_connected = 0,
         kicked_at = COALESCE(kicked_at, CURRENT_TIMESTAMP),
         last_seen_at = CURRENT_TIMESTAMP
     WHERE session_id IN (SELECT id FROM lan_sessions WHERE active = 0)`
  );
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
  const result = await commitLanEvent(db, event);
  return result.inserted;
}

export async function getLanSessionEvents(db: SQLiteDatabase, sessionId: string, limit = 30): Promise<LanSessionEvent[]> {
  await ensureLanSchema(db);
  return listLanEvents(db, sessionId, limit);
}

export async function getLocalLanSessionForCharacter(db: SQLiteDatabase, characterId: number) {
  await ensureLanSchema(db);
  return db.getFirstAsync<{
    sessionId: string;
    joinUrl?: string;
    payloadJson?: string;
    remoteKey?: string;
  }>(
    `SELECT s.id as sessionId,
            COALESCE(b.join_url, s.join_url) as joinUrl,
            s.payload_json as payloadJson,
            b.remote_key as remoteKey
     FROM lan_local_character_bindings b
     JOIN lan_sessions s ON s.id = b.session_id
     WHERE b.character_id = ?
       AND COALESCE(b.is_active, 1) = 1
       AND COALESCE(s.active, 1) = 1
       AND COALESCE(s.status, 'active') != 'ended'
     ORDER BY COALESCE(b.updated_at, b.joined_at) DESC
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
    remoteKey?: string;
  }>(
    `SELECT b.character_id as characterId,
            s.id as sessionId,
            s.name as sessionName,
            COALESCE(b.join_url, s.join_url) as joinUrl,
            s.payload_json as payloadJson,
            b.remote_key as remoteKey
     FROM lan_local_character_bindings b
     JOIN lan_sessions s ON s.id = b.session_id
     WHERE b.session_id = ?
       AND COALESCE(b.is_active, 1) = 1
       AND COALESCE(s.active, 1) = 1
       AND COALESCE(s.status, 'active') != 'ended'
     ORDER BY COALESCE(b.updated_at, b.joined_at) DESC
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
    remoteKey?: string;
  }>(
    `SELECT b.character_id as characterId,
            s.id as sessionId,
            s.name as sessionName,
            COALESCE(b.join_url, s.join_url) as joinUrl,
            b.remote_key as remoteKey
     FROM lan_local_character_bindings b
     JOIN lan_sessions s ON s.id = b.session_id
     WHERE b.character_id = ?
       AND COALESCE(b.is_active, 1) = 1
       AND COALESCE(s.active, 1) = 1
       AND COALESCE(s.status, 'active') != 'ended'
     ORDER BY COALESCE(b.updated_at, b.joined_at) DESC
     LIMIT 1`,
    [characterId]
  );
}

export async function unlinkCharacterFromLanSession(db: SQLiteDatabase, characterId: number, sessionId?: string) {
  await ensureLanSchema(db);
  if (sessionId) {
    await db.runAsync(
      `UPDATE lan_local_character_bindings
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = ? AND session_id = ?`,
      [characterId, sessionId]
    );
    await deactivateLocalPlayerSessionIfNoActiveBindings(db, sessionId);
    return;
  }

  const affectedSessions = await db.getAllAsync<{ sessionId: string }>(
    `SELECT DISTINCT session_id as sessionId
     FROM lan_local_character_bindings
     WHERE character_id = ?
       AND COALESCE(is_active, 1) = 1`,
    [characterId]
  );

  await db.runAsync(
    `UPDATE lan_local_character_bindings
     SET is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE character_id = ?`,
    [characterId]
  );

  for (const row of affectedSessions) {
    if (row.sessionId) await deactivateLocalPlayerSessionIfNoActiveBindings(db, row.sessionId);
  }
}

async function deactivateLocalPlayerSessionIfNoActiveBindings(db: SQLiteDatabase, sessionId: string) {
  const row = await db.getFirstAsync<{ isMaster?: number; activeBindings?: number }>(
    `SELECT COALESCE(s.is_master, 0) as isMaster,
            (
              SELECT COUNT(*)
              FROM lan_local_character_bindings b
              WHERE b.session_id = s.id
                AND COALESCE(b.is_active, 1) = 1
            ) as activeBindings
     FROM lan_sessions s
     WHERE s.id = ?
     LIMIT 1`,
    [sessionId]
  );

  if (!row || toNumber(row.isMaster) === 1 || toNumber(row.activeBindings) > 0) return;

  await db.runAsync(
    `UPDATE lan_sessions
     SET active = 0,
         status = 'ended',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND COALESCE(is_master, 0) = 0`,
    [sessionId]
  );
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
  payload.effectCatalog = (await listEffects(db)).map((effect) => ({
    statusKey: effect.statusKey,
    name: effect.name,
    kind: effect.kind,
    category: effect.category,
    description: effect.description,
    color: effect.color,
    secondaryColor: effect.secondaryColor,
    icon: effect.icon,
    stackable: effect.stackable,
    removableBySave: effect.removableBySave,
    repeatSave: effect.repeatSave,
    saveAbility: effect.saveAbility,
    saveOnSuccess: effect.saveOnSuccess,
    defaultDurationValue: effect.defaultDurationValue,
    defaultDurationUnit: effect.defaultDurationUnit,
    visualPriority: effect.visualPriority,
    rulesJson: effect.rulesJson,
    active: effect.active,
  }));
  payload.state = await getLanSessionState(db, sessionId);
  payload.events = await getLanSessionEvents(db, sessionId, 50);

  await db.runAsync(
    `UPDATE lan_sessions SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(payload), sessionId]
  );
  await saveLanSessionSnapshot(db, payload).catch(() => {});

  return payload;
}

export async function syncLanSessionPayload(
  db: SQLiteDatabase,
  sessionId: string,
  options?: { broadcast?: boolean }
) {
  const payload = await refreshLanSessionPayload(db, sessionId);
  if (!payload) return null;

  if (Platform.OS === 'android' && lanNative?.updatePayload) {
    await lanNative.updatePayload(JSON.stringify(payload));
  }

  const row = await db.getFirstAsync<{ joinUrl?: string; isMaster?: number }>(
    `SELECT join_url as joinUrl, is_master as isMaster FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  // Durante a sessao ativa, o estado vivo (HP/XP/condicoes/inventario) deve ser
  // propagado por eventos versionados. Payload completo so deve ir para clientes
  // quando o chamador pedir explicitamente broadcast estrutural.
  updateLanHostPayload(row?.joinUrl, payload, { broadcast: options?.broadcast === true });
  if (toNumber(row?.isMaster) === 1) {
    await updateLanForegroundSession(payload, row?.joinUrl);
  }

  return payload;
}

export function subscribeLanForegroundStop(listener: () => void) {
  if (Platform.OS !== 'android') return () => {};
  const subscription = DeviceEventEmitter.addListener(LAN_FOREGROUND_STOP_EVENT, listener);
  return () => {
    subscription.remove();
  };
}

export async function consumeLanForegroundStopRequest() {
  if (Platform.OS !== 'android' || !lanNative?.consumeForegroundStopRequest) return false;

  try {
    return await lanNative.consumeForegroundStopRequest();
  } catch {
    return false;
  }
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

  await saveLanSession(db, payload, joinUrl || summary.joinUrl, { isMaster: summary.isMaster });
  await syncLanSessionPayload(db, sessionId);
  return payload;
}

export async function pauseLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);

  // PAUSAR = campanha ainda existe e continuará depois.
  // Mantém sessão ativa no banco e mantém jogadores/fichas vinculados.
  // Apenas muda o estado para leitura no jogador e interrompe a notificação de mesa ativa.
  await db.runAsync(
    `UPDATE lan_sessions
     SET status = 'paused', active = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND COALESCE(status, 'active') != 'ended'`,
    [sessionId]
  );
  await stopLanForegroundSession().catch(() => false);
  return syncLanSessionPayload(db, sessionId, { broadcast: true });
}

export async function endLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);

  // ENCERRAR = campanha finalizada. A mesa não é retomável.
  // Todos os vínculos locais/remotos da sessão são desativados para que as fichas
  // possam voltar ao singleplayer ou entrar em outra sessão.
  await runLanDbTransaction(db, async () => {
    await db.runAsync(
      `UPDATE lan_sessions
       SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sessionId]
    );
    await db.runAsync(
      `UPDATE lan_session_players
       SET is_active = 0,
           is_connected = 0,
           kicked_at = COALESCE(kicked_at, CURRENT_TIMESTAMP),
           last_seen_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`,
      [sessionId]
    );
    await db.runAsync(
      `UPDATE lan_local_character_bindings
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`,
      [sessionId]
    ).catch(() => undefined);
  });
  await stopLanForegroundSession().catch(() => false);
  return syncLanSessionPayload(db, sessionId, { broadcast: true });
}

export async function resumeLanSession(db: SQLiteDatabase, sessionId: string) {
  await ensureLanSchema(db);

  // RETOMAR = volta da pausa. Mantém os mesmos jogadores vinculados.
  await db.runAsync(
    `UPDATE lan_sessions
     SET status = 'active', active = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND COALESCE(status, 'active') != 'ended'`,
    [sessionId]
  );
  return syncLanSessionPayload(db, sessionId, { broadcast: true });
}

export async function joinLanSessionWithCharacter(
  db: SQLiteDatabase,
  sessionId: string,
  characterId: number,
  playerName = '',
  options?: { joinUrl?: string; inviteCode?: string }
) {
  await ensureLanSchema(db);
  const character = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [characterId]);
  const normalized = normalizeCharacterState(character || {});
  const remoteKey = makeLanCharacterKey(sessionId, { ...(character || {}), id: characterId });

  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT join_url, invite_code FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );

  await db.runAsync(
    `INSERT INTO lan_local_character_bindings (
       session_id, character_id, join_url, invite_code, remote_key, role, is_active, joined_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 'player', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id, character_id) DO UPDATE SET
       join_url = COALESCE(excluded.join_url, lan_local_character_bindings.join_url),
       invite_code = COALESCE(excluded.invite_code, lan_local_character_bindings.invite_code),
       remote_key = excluded.remote_key,
       role = 'player',
       is_active = 1,
       updated_at = CURRENT_TIMESTAMP`,
    [
      sessionId,
      characterId,
      options?.joinUrl || String(session?.join_url || '') || null,
      options?.inviteCode || String(session?.invite_code || '') || null,
      remoteKey,
    ]
  );

  return character || {
    id: characterId,
    name: normalized.characterName,
  };
}

export async function notifyMasterJoin(joinUrl: string | undefined, sessionId: string, character: Record<string, unknown> | null, playerName = '', options?: { reviewSnapshot?: boolean }) {
  if (!joinUrl || !character) return false;
  const clientId = await getLanClientId();
  if (isTcpLanUrl(joinUrl)) {
    return sendLanTcpJoin(joinUrl, {
      sessionId,
      clientId,
      playerName: playerName || character.name,
      remoteKey: makeLanCharacterKey(sessionId, character),
      sourceCharacterId: character.id,
      character,
      reviewSnapshot: Boolean(options?.reviewSnapshot),
    });
  }
  return false;
}

export async function upsertLanSessionPlayerFromNetwork(db: SQLiteDatabase, entry: any) {
  await ensureLanSchema(db);
  const sessionId = String(entry?.sessionId || '');
  const clientId = String(entry?.clientId || '');
  const character = entry?.character || {};
  if (!sessionId || !character) return null;

  const normalized = normalizeCharacterState(character);
  const remoteKey = String(entry.remoteKey || `${sessionId}:${entry.playerName || normalized.playerName}:${normalized.sourceCharacterId || normalized.characterName}`);
  const playerName = String(entry.playerName || normalized.playerName || normalized.characterName);

  if (!hasMinimumLanJoinSnapshot(character, normalized)) {
    debugLanFlow('MASTER_JOIN_SNAPSHOT_INCOMPLETE_REJECTED', {
      sessionId,
      remoteKey,
      clientId,
      playerName,
      sourceCharacterId: normalized.sourceCharacterId,
      characterName: normalized.characterName,
      className: normalized.className,
      race: normalized.race,
      hpCurrent: normalized.hpCurrent,
      hpMax: normalized.hpMax,
      statsKeys: Object.keys(normalized.stats || {}),
    });
    return null;
  }

  const blockedSameJoin = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT id FROM lan_session_players
     WHERE session_id = ?
       AND (
         remote_key = ?
         OR (? != '' AND client_id = ?)
       )
       AND (kicked_at IS NOT NULL OR COALESCE(is_active, 1) = 0)
     LIMIT 1`,
    [sessionId, remoteKey, clientId, clientId]
  );
  if (blockedSameJoin) {
    debugLanFlow('MASTER_JOIN_ROW_IGNORED_KICKED', {
      sessionId,
      remoteKey,
      clientId,
      playerName,
      characterName: normalized.characterName,
      blockedPlayerId: blockedSameJoin.id,
    });
    return null;
  }

  const existingByClient = clientId
    ? await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM lan_session_players
       WHERE session_id = ? AND client_id = ? AND COALESCE(is_active, 1) = 1 AND kicked_at IS NULL
       LIMIT 1`,
      [sessionId, clientId]
    )
    : null;

  const existing = existingByClient || await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_session_players WHERE session_id = ? AND remote_key = ? LIMIT 1`,
    [sessionId, remoteKey]
  );

  if (existing) {
    if (!toNumber(existing.is_active, 1) || existing.kicked_at) {
      debugLanFlow('MASTER_JOIN_ROW_IGNORED_KICKED', {
        sessionId,
        remoteKey,
        clientId,
        playerName,
        characterName: normalized.characterName,
        existingPlayerId: existing.id,
      });
      return null;
    }

    const pendingDiff = entry.reviewSnapshot ? describeCharacterDiff(existing, normalized) : [];
    if (pendingDiff.length > 0) {
      const existingPendingSnapshot = String(existing.pending_character_snapshot || '');
      const existingPendingDiff = String(existing.notes || '');
      const nextPendingSnapshot = JSON.stringify(character);
      const nextPendingDiff = JSON.stringify(pendingDiff);
      if (existingPendingSnapshot === nextPendingSnapshot && existingPendingDiff === nextPendingDiff) {
        debugLanFlow('MASTER_PENDING_SNAPSHOT_DUPLICATE_SKIPPED', {
          sessionId,
          remoteKey,
          clientId,
          playerName,
          characterName: normalized.characterName,
          pendingDiff,
        });
        return Number(existing.id);
      }

      if (await canAutoAcceptLevelUpSnapshot(db, existing, normalized, pendingDiff)) {
        await updateLanPlayerFromNormalizedSnapshot(db, Number(existing.id), character, normalized);
        await rememberLanSessionEvent(db, {
          id: makeLanEventId(),
          sessionId,
          type: 'character_update_review',
          fromKey: 'master',
          fromName: 'Mestre',
          toKey: remoteKey,
          toName: normalized.characterName,
          entityType: 'request',
          entityId: remoteKey,
          ackRequired: true,
          originClientId: 'master',
          message: `${normalized.characterName} subiu de nivel e a ficha foi sincronizada com a sessao.`,
          createdAt: new Date().toISOString(),
        });
        return Number(existing.id);
      }

      await db.runAsync(
        `UPDATE lan_session_players
         SET remote_key = ?, client_id = COALESCE(?, client_id), player_name = ?, character_name = ?,
             pending_character_snapshot = ?, notes = ?, is_connected = 1, last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [remoteKey, clientId || null, playerName, normalized.characterName, JSON.stringify(character), JSON.stringify(pendingDiff), Number(existing.id)]
      );
      await rememberLanSessionEvent(db, {
        id: makeLanEventId(),
        sessionId,
        type: 'character_update_review',
        fromKey: remoteKey,
        fromName: playerName,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'request',
        entityId: remoteKey,
        message: `${normalized.characterName} voltou com alteracoes pendentes: ${pendingDiff.join('; ')}.`,
        createdAt: new Date().toISOString(),
      });
      return Number(existing.id);
    }

    // Sem diff pendente, JOIN/reconnect e apenas presenca.
    // Nao pode sobrescrever HP/XP/moedas/efeitos oficiais do mestre com
    // snapshot local antigo do jogador. So hidratamos registro realmente
    // provisório ou uma revisao explicita de ficha.
    const existingLooksProvisional =
      toNumber(existing.hp_max) <= 0 ||
      !existing.character_snapshot ||
      String(existing.character_snapshot || '').trim() === '{}' ||
      String(existing.notes || '').includes('Jogador pendente');

    if (entry.reviewSnapshot || existingLooksProvisional) {
      await updateLanPlayerFromNormalizedSnapshot(db, Number(existing.id), character, normalized);
    }

    await db.runAsync(
      `UPDATE lan_session_players
       SET remote_key = ?,
           client_id = COALESCE(?, client_id),
           player_name = ?,
           character_name = COALESCE(character_name, ?),
           character_snapshot = COALESCE(NULLIF(character_snapshot, '{}'), ?),
           is_connected = 1,
           last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [remoteKey, clientId || null, playerName, normalized.characterName, JSON.stringify(character), Number(existing.id)]
    );

    return Number(existing.id);
  }

  const result = await db.runAsync(
    `INSERT INTO lan_session_players (
      session_id, remote_key, client_id, player_name, character_id, character_name, character_snapshot,
      level, class_name, race, hp_current, hp_max, temp_hp, xp, gp, sp, cp, stats_json, equipment_json, effects_json, last_seen_at
    )
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', CURRENT_TIMESTAMP)`,
    [
      sessionId,
      remoteKey,
      clientId || null,
      playerName,
      normalized.characterName,
      JSON.stringify(character),
      normalized.level,
      normalized.className,
      normalized.race,
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
  return Number(result.lastInsertRowId);
}

export async function updateLanPlayerNumbers(
  db: SQLiteDatabase,
  playerId: number,
  patch: Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>,
  options?: { syncPayload?: boolean }
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

  if (options?.syncPayload && player?.session_id) {
    await syncLanSessionPayload(db, String(player.session_id));
  }
}

export async function updateLanPlayerStats(
  db: SQLiteDatabase,
  playerId: number,
  stats: Record<string, unknown>,
  options?: { syncPayload?: boolean }
) {
  await ensureLanSchema(db);
  const nextStats = stats && typeof stats === 'object' ? stats : {};
  const player = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT session_id, character_id FROM lan_session_players WHERE id = ? AND COALESCE(is_active, 1) = 1`,
    [playerId]
  );
  if (!player) return false;

  await db.runAsync(
    `UPDATE lan_session_players
     SET stats_json = ?, revision_seq = COALESCE(revision_seq, 0) + 1, last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(nextStats), playerId]
  );

  if (player.character_id) {
    await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [JSON.stringify(nextStats), Number(player.character_id)]);
  }

  if (options?.syncPayload && player.session_id) {
    await syncLanSessionPayload(db, String(player.session_id));
  }

  return true;
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
  const clientId = String(player.client_id || '');

  await db.runAsync(
    `UPDATE lan_session_players
     SET is_active = 0, is_connected = 0, kicked_at = CURRENT_TIMESTAMP,
         revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [playerId]
  );
  kickLanTcpHostJoinedPlayer(sessionId, playerKey, clientId);
  const event: LanSessionEvent = {
    id: makeLanEventId(),
    sessionId,
    type: 'player_kicked',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: playerKey,
    toName: normalized.characterName,
    message: `${normalized.characterName} foi removido da sessao pelo mestre.`,
    createdAt: new Date().toISOString(),
  };
  await rememberLanSessionEvent(db, event);
  await syncLanSessionPayload(db, sessionId);
  return event;
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
      entityType: 'inventory',
      entityId: String(player.remote_key || ''),
      ackRequired: true,
      originClientId: 'master',
      inventoryPatch: {
        targetKey: String(player.remote_key || ''),
        equipment: normalizeEquipment(equipment),
        reason: message,
        action: 'grant',
      },
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
  const status = await getLanSessionStatus(db, sessionId);
  if (status !== 'active') return false;

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

type LanInventoryMutationResult = {
  accepted: boolean;
  reason?: string;
  targetKeys: string[];
};

export async function applyLanCoinSelfPatchRequest(db: SQLiteDatabase, event: LanSessionEvent) {
  await ensureLanSchema(db);
  const request = event.coinPatchRequest;
  const targetKey = String(request?.targetKey || event.fromKey || '');
  if (!request?.next || !targetKey || targetKey !== event.fromKey) {
    return { accepted: false, reason: 'Pedido de moedas invalido.' };
  }

  const session = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT status FROM lan_sessions WHERE id = ?`,
    [event.sessionId]
  );
  if (String(session?.status || 'active') !== 'active') {
    return { accepted: false, reason: 'Sessao em leitura.' };
  }

  const player = await getActiveLanPlayerByRemoteKey(db, event.sessionId, targetKey);
  if (!player) return { accepted: false, reason: 'Jogador nao encontrado.' };

  const current = {
    gp: Math.max(0, toNumber(player.gp)),
    sp: Math.max(0, toNumber(player.sp)),
    cp: Math.max(0, toNumber(player.cp)),
  };
  const next = {
    gp: request.next.gp == null ? current.gp : Math.max(0, Math.floor(toNumber(request.next.gp))),
    sp: request.next.sp == null ? current.sp : Math.max(0, Math.floor(toNumber(request.next.sp))),
    cp: request.next.cp == null ? current.cp : Math.max(0, Math.floor(toNumber(request.next.cp))),
  };
  const currentTotalCopper = coinsToCopper(current);
  const nextTotalCopper = coinsToCopper(next);

  if (nextTotalCopper > currentTotalCopper) {
    return { accepted: false, reason: 'Jogador nao pode aumentar moedas sem aprovacao do mestre.' };
  }

  await updateLanPlayerNumbers(db, Number(player.id), next, { syncPayload: false });
  await syncLanSessionPayload(db, event.sessionId, { broadcast: false });

  return {
    accepted: true,
    targetKey,
    patch: next,
    currentTotalCopper,
    nextTotalCopper,
    reason: request.reason || event.message,
  };
}

export async function applyLanSendItemRequest(db: SQLiteDatabase, event: LanSessionEvent): Promise<LanInventoryMutationResult> {
  await ensureLanSchema(db);
  const request = event.sendItemRequest;
  const item = request?.item || event.item;
  const fromKey = String(request?.fromKey || event.fromKey || '');
  const toKey = String(request?.toKey || event.toKey || '');

  if (!item || !fromKey || !toKey || toKey === 'master' || fromKey !== event.fromKey) {
    return { accepted: false, reason: 'Pedido de envio invalido.', targetKeys: [fromKey].filter(Boolean) };
  }

  const result = await runLanDbTransaction(db, async () => {
    const status = await getLanSessionStatus(db, event.sessionId);
    if (status !== 'active') return { accepted: false, reason: 'Sessao em leitura.', targetKeys: [fromKey] };

    const fromPlayer = await getActiveLanPlayerForMutation(db, event.sessionId, fromKey);
    const toPlayer = await getActiveLanPlayerForMutation(db, event.sessionId, toKey);
    if (!fromPlayer || !toPlayer) return { accepted: false, reason: 'Jogador de origem ou destino nao encontrado.', targetKeys: [fromKey] };

    const transferItem = normalizeTradeItemForMutation(item);
    if (!transferItem) return { accepted: false, reason: 'Item invalido.', targetKeys: [fromKey] };

    const fromEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(fromPlayer.equipment_json, {}));
    const toEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(toPlayer.equipment_json, {}));
    if (!removeTradeItemFromEquipment(fromEquipment, transferItem)) {
      return { accepted: false, reason: 'Quantidade insuficiente no inventario de origem.', targetKeys: [fromKey] };
    }

    const nextToEquipment = addTradeItemToEquipment(toEquipment, transferItem);
    await writeLanPlayerEquipmentSnapshot(db, fromPlayer, fromEquipment);
    await writeLanPlayerEquipmentSnapshot(db, toPlayer, nextToEquipment);

    return { accepted: true, targetKeys: [fromKey, toKey], reason: event.message };
  });

  if (result.accepted) await syncLanSessionPayload(db, event.sessionId, { broadcast: false });
  return result;
}

export async function applyLanTradeAcceptRequest(db: SQLiteDatabase, event: LanSessionEvent): Promise<LanInventoryMutationResult> {
  await ensureLanSchema(db);

  const offerEvent = event.tradeId ? await getStoredLanTradeOffer(db, event.sessionId, event.tradeId) : null;
  const offeredItemSource = event.offeredItem || offerEvent?.offeredItem;
  const requestedItemSource = event.requestedItem;
  const offeredItem = normalizeTradeItemForMutation(offeredItemSource);
  const requestedItem = normalizeTradeItemForMutation(requestedItemSource);

  if (!offeredItem) {
    return { accepted: false, reason: 'Troca sem item oferecido.', targetKeys: [event.fromKey].filter(Boolean) };
  }

  const offeringKey = String(event.tradeAccept?.fromKey || offerEvent?.fromKey || (event.toKey !== 'master' ? event.toKey : '') || '');
  const acceptingKey = String(event.tradeAccept?.toKey || event.fromKey || '');
  if (!offeringKey || !acceptingKey || offeringKey === acceptingKey) {
    return { accepted: false, reason: 'Participantes da troca invalidos.', targetKeys: [acceptingKey].filter(Boolean) };
  }

  const result = await runLanDbTransaction(db, async () => {
    const status = await getLanSessionStatus(db, event.sessionId);
    if (status !== 'active') return { accepted: false, reason: 'Sessao em leitura.', targetKeys: [offeringKey, acceptingKey] };

    const offeringPlayer = await getActiveLanPlayerForMutation(db, event.sessionId, offeringKey);
    const acceptingPlayer = await getActiveLanPlayerForMutation(db, event.sessionId, acceptingKey);
    if (!offeringPlayer || !acceptingPlayer) {
      return { accepted: false, reason: 'Jogador da troca nao encontrado.', targetKeys: [offeringKey, acceptingKey] };
    }

    const offeringEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(offeringPlayer.equipment_json, {}));
    const acceptingEquipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(acceptingPlayer.equipment_json, {}));
    if (!removeTradeItemFromEquipment(offeringEquipment, offeredItem)) {
      return { accepted: false, reason: 'O item oferecido nao esta mais disponivel.', targetKeys: [offeringKey, acceptingKey] };
    }

    if (requestedItem && !removeTradeItemFromEquipment(acceptingEquipment, requestedItem)) {
      return { accepted: false, reason: 'O item de contraoferta nao esta mais disponivel.', targetKeys: [offeringKey, acceptingKey] };
    }

    await writeLanPlayerEquipmentSnapshot(
      db,
      offeringPlayer,
      requestedItem ? addTradeItemToEquipment(offeringEquipment, requestedItem) : offeringEquipment,
    );
    await writeLanPlayerEquipmentSnapshot(db, acceptingPlayer, addTradeItemToEquipment(acceptingEquipment, offeredItem));

    return { accepted: true, targetKeys: [offeringKey, acceptingKey], reason: event.message };
  });

  if (result.accepted) await syncLanSessionPayload(db, event.sessionId, { broadcast: false });
  return result;
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

export async function ensurePendingRemotePlayerFromEvent(
  db: SQLiteDatabase,
  sessionId: string,
  event: LanSessionEvent
) {
  await ensureLanSchema(db);

  const fromKey = String(event.fromKey || '');
  if (!fromKey || fromKey === 'master' || fromKey === 'session' || fromKey === 'party') {
    return null;
  }

  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id
     FROM lan_session_players
     WHERE session_id = ?
       AND remote_key = ?
       AND COALESCE(is_active, 1) = 1
       AND kicked_at IS NULL
     LIMIT 1`,
    [sessionId, fromKey]
  );

  if (existing?.id) {
    await db.runAsync(
      `UPDATE lan_session_players
       SET is_connected = 1, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [existing.id]
    );
    return existing.id;
  }

  const fallbackName = String(event.fromName || 'Jogador pendente');
  const result = await db.runAsync(
    `INSERT INTO lan_session_players (
      session_id,
      remote_key,
      player_name,
      character_id,
      character_name,
      character_snapshot,
      hp_current,
      hp_max,
      temp_hp,
      xp,
      gp,
      sp,
      cp,
      stats_json,
      equipment_json,
      effects_json,
      notes,
      is_active,
      is_connected,
      last_seen_at
    )
    VALUES (?, ?, ?, NULL, ?, '{}', 0, 0, 0, 0, 0, 0, 0, '{}', '{}', '[]', ?, 1, 0, CURRENT_TIMESTAMP)`,
    [sessionId, fromKey, fallbackName, fallbackName, JSON.stringify(['Jogador pendente: aguarde novo join/snapshot para completar a ficha.'])]
  );

  return result.lastInsertRowId;
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
      }, { syncPayload: false });
    }

    if (request.kind === 'hp') {
      const amount = toNumber(request.amount);
      if (amount < 0) {
        const damage = applyDamageWithTempHp({
          hpCurrent: toNumber(player.hp_current),
          hpMax: toNumber(player.hp_max),
          tempHp: toNumber(player.temp_hp),
          damage: Math.abs(amount),
        });
        await updateLanPlayerNumbers(db, playerId, {
          hpCurrent: damage.nextHpCurrent,
          tempHp: damage.nextTempHp,
        }, { syncPayload: false });
        if (damage.absorbedTempHp > 0) {
          await consumeLanPlayerTempHpAfterDamage(db, playerId, damage.absorbedTempHp, { syncPayload: false });
        }
      } else {
        await updateLanPlayerNumbers(db, playerId, {
          hpCurrent: Math.max(0, Math.min(toNumber(player.hp_max), toNumber(player.hp_current) + amount)),
        }, { syncPayload: false });
      }
    }

    if (request.kind === 'temp_hp') {
      const requestedTempHp = Math.max(0, toNumber(request.amount ?? request.value));
      await updateLanPlayerNumbers(db, playerId, {
        tempHp: Math.max(0, Math.max(toNumber(player.temp_hp), requestedTempHp)),
      }, { syncPayload: false });
    }

    if (request.kind === 'coin') {
      const coinField = normalizeCoinField(request.field);
      if (coinField) {
        await updateLanPlayerNumbers(db, playerId, {
          [coinField]: Math.max(0, toNumber(player[coinField]) + toNumber(request.amount ?? request.value)),
        }, { syncPayload: false });
      }
    }

    if ((request.kind === 'stat' || request.kind === 'buff' || request.kind === 'condition') && request.field) {
      const target = request.kind === 'condition' ? 'custom' : normalizeEffectTarget(request.field);
      await addLanPlayerEffect(db, playerId, {
        name: request.message || `Pedido de ${request.field}`,
        target,
        value: toNumber(request.value ?? request.amount),
        remaining: Math.max(1, toNumber(request.duration, 1)),
        unit: request.unit || 'rest',
        durationText: request.duration ? `${request.duration} ${request.unit || 'rest'}` : 'Pedido do jogador',
        kind: request.kind === 'condition' ? 'status' : request.field === 'PV_TEMP' ? 'temp_hp' : request.field === 'HP' ? 'hp' : 'stat',
        status: request.kind === 'condition' ? request.field : undefined,
        source: event.fromName,
      }, { syncPayload: false });
    }

    if (request.kind === 'inventory' && request.item) {
      const equipment = normalizeEquipment(parseJsonValue<Record<string, unknown>>(player.equipment_json, {}));
      await updateLanPlayerEquipment(
        db,
        playerId,
        addTradeItemToEquipment(equipment, request.item),
        `Mestre entregou ${request.item.qty}x ${request.item.name} para ${event.fromName}.`
      );
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

  await syncLanSessionPayload(db, event.sessionId, { broadcast: false });
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
  const oldSnapshot = normalizeCharacterState(
    parseJsonValue<Record<string, unknown>>(player.character_snapshot, {})
  );

  let acceptedMessage = 'Mestre recusou a ficha atualizada; estado da sessão mantido.';
  let toName = oldSnapshot.characterName;

  if (accepted && pending) {
    const normalized = normalizeCharacterState(pending);
    toName = normalized.characterName;

    await updateLanPlayerFromNormalizedSnapshot(db, playerId, pending, normalized);

    acceptedMessage =
      normalized.level > oldSnapshot.level
        ? `${normalized.characterName} subiu de nível ${oldSnapshot.level} -> ${normalized.level}. HP ${oldSnapshot.hpCurrent}/${oldSnapshot.hpMax} -> ${normalized.hpCurrent}/${normalized.hpMax}.`
        : `Mestre aceitou a ficha atualizada de ${normalized.characterName}.`;
  } else {
    await db.runAsync(
      `UPDATE lan_session_players
       SET pending_character_snapshot = NULL,
           notes = NULL,
           last_seen_at = CURRENT_TIMESTAMP
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
    toName,
    entityType: 'request',
    entityId: String(player.remote_key || playerId),
    ackRequired: true,
    originClientId: 'master',
    message: acceptedMessage,
    createdAt: new Date().toISOString(),
  });

  await syncLanSessionPayload(db, sessionId);
}

type LanEffectMutationOptions = {
  /**
   * syncPayload=false keeps the LAN hot path fast. The caller can debounce
   * payload rebuilds later; live state is delivered by event_commit.
   */
  syncPayload?: boolean;
  /** When false, only mutates SQLite/cache and does not create a lan_session_events row. */
  recordEvent?: boolean;
};

export async function addLanPlayerEffect(
  db: SQLiteDatabase,
  playerId: number,
  effect: Omit<LanSessionEffect, 'id'> & { id?: string },
  options: LanEffectMutationOptions = {},
) {
  await ensureLanSchema(db);
  const result = await applyEffectToPlayer(db, playerId, {
    id: (effect as any).id,
    statusKey: effect.statusKey || effect.status,
    name: effect.name,
    target: effect.target,
    value: effect.value,
    remaining: effect.remaining,
    unit: effect.unit,
    mode: effect.mode,
    kind: effect.kind,
    durationText: effect.durationText,
    sourceName: effect.source,
    sourceType: effect.sourceType,
    sourceId: effect.sourceId,
    color: effect.color,
    secondaryColor: effect.secondaryColor,
    icon: effect.icon,
    visibleToPlayer: effect.visibleToPlayer,
    publicNote: effect.publicNote,
    privateNote: effect.privateNote,
    saveDc: effect.saveDc,
    saveAbility: effect.saveAbility,
    repeatSave: effect.repeatSave,
    useCatalogDefaults: Boolean(effect.statusKey || effect.status),
  });
  if (!result) return;

  const event = options.recordEvent === false
    ? null
    : await recordEffectPatchEvent(db, result.sessionId, result.targetKey, result.targetName, result.patch, `${result.snapshot.name} aplicado em ${result.targetName}.`);
  if (options.syncPayload !== false) {
    await syncLanSessionPayload(db, result.sessionId, { broadcast: false });
  }
  return { ...result, event };
}

export async function addLanPlayerEffectsBatch(
  db: SQLiteDatabase,
  playerId: number,
  effects: Omit<LanSessionEffect, 'id'>[],
  message?: string,
  options: LanEffectMutationOptions = {},
) {
  await ensureLanSchema(db);
  const results = [];

  for (const effect of effects) {
    const result = await applyEffectToPlayer(db, playerId, {
      statusKey: effect.statusKey || effect.status,
      name: effect.name,
      target: effect.target,
      value: effect.value,
      remaining: effect.remaining,
      unit: effect.unit,
      mode: effect.mode,
      kind: effect.kind,
      durationText: effect.durationText,
      sourceName: effect.source,
      sourceType: effect.sourceType || 'lan_session',
      sourceId: effect.sourceId,
      appliedByKey: 'master',
      appliedByName: 'Mestre',
      color: effect.color,
      secondaryColor: effect.secondaryColor,
      icon: effect.icon,
      visibleToPlayer: effect.visibleToPlayer,
      publicNote: effect.publicNote,
      privateNote: effect.privateNote,
      saveDc: effect.saveDc,
      saveAbility: effect.saveAbility,
      repeatSave: effect.repeatSave,
      useCatalogDefaults: Boolean(effect.statusKey || effect.status),
    });
    if (result) results.push(result);
  }

  if (results.length === 0) return null;

  const first = results[0];
  const patch: LanEffectPatch = {
    targetKey: first.targetKey,
    add: results.flatMap((result) => result.patch.add || []),
    update: results.flatMap((result) => result.patch.update || []),
    remove: results.flatMap((result) => result.patch.remove || []),
  };
  const effectCount = patch.add.length + patch.update.length;
  const eventMessage = message || `Mestre aplicou ${effectCount} efeito(s) em ${first.targetName}.`;

  const event = options.recordEvent === false
    ? null
    : await recordEffectPatchEvent(db, first.sessionId, first.targetKey, first.targetName, patch, eventMessage);
  if (options.syncPayload !== false) {
    await syncLanSessionPayload(db, first.sessionId, { broadcast: false });
  }

  return {
    sessionId: first.sessionId,
    targetKey: first.targetKey,
    targetName: first.targetName,
    patch,
    results,
    event,
  };
}

export async function removeLanPlayerEffect(db: SQLiteDatabase, playerId: number, effectId: string, options: LanEffectMutationOptions = {}) {
  await ensureLanSchema(db);
  const result = await removeEffectFromPlayer(db, playerId, effectId);
  if (!result) return;

  const event = options.recordEvent === false
    ? null
    : await recordEffectPatchEvent(db, result.sessionId, result.targetKey, result.targetName, result.patch, `${result.removed.name} removido de ${result.targetName}.`);
  if (options.syncPayload !== false) {
    await syncLanSessionPayload(db, result.sessionId, { broadcast: false });
  }
  return { ...result, event };
}

export async function removeLanPlayerTempHpEffects(db: SQLiteDatabase, playerId: number) {
  await ensureLanSchema(db);
  const result = await removeTempHpEffectsFromPlayer(db, playerId);
  if (!result) return;

  await recordEffectPatchEvent(db, result.sessionId, result.targetKey, result.targetName, result.patch, `PV temporario consumido de ${result.targetName}.`);
  await syncLanSessionPayload(db, result.sessionId, { broadcast: false });
  return result;
}

export async function consumeLanPlayerTempHpAfterDamage(db: SQLiteDatabase, playerId: number, absorbedTempHp: number, options: LanEffectMutationOptions = {}) {
  await ensureLanSchema(db);
  const result = await consumeTempHpFromPlayer(db, playerId, absorbedTempHp);
  if (!result) return;

  const hasPatch = Boolean((result.patch.update?.length || 0) > 0 || (result.patch.remove?.length || 0) > 0);
  if (hasPatch) {
    const event = options.recordEvent === false
      ? null
      : await recordEffectPatchEvent(
        db,
        result.sessionId,
        result.targetKey,
        result.targetName,
        result.patch,
        `PV temporario absorveu ${result.absorbed} de dano de ${result.targetName}.`,
      );
    if (options.syncPayload !== false) {
      await syncLanSessionPayload(db, result.sessionId, { broadcast: false });
    }
    return { ...result, event };
  }
  return result;
}

export async function advanceLanSessionTime(db: SQLiteDatabase, sessionId: string, unit: LanAdvanceUnit, options: { syncPayload?: boolean } = {}) {
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

  const tickResult = await tickTurnEffects(db, sessionId, unit);

  for (const patch of tickResult.patches) {
    const target = tickResult.expired.find((entry) => entry.targetKey === patch.targetKey)
      || tickResult.restored.find((entry) => entry.targetKey === patch.targetKey);
    await recordEffectPatchEvent(
      db,
      sessionId,
      patch.targetKey,
      target?.targetName || patch.targetKey,
      patch,
      'Efeitos atualizados pela passagem de tempo.'
    );
  }

  for (const entry of tickResult.expired) {
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId,
      type: 'effect_expired',
      fromKey: 'session',
      fromName: 'Sessao',
      toKey: entry.targetKey,
      toName: entry.targetName,
      expiredEffect: entry.effect as LanSessionEffect,
      message: `${entry.targetName}: ${entry.effect.name} acabou.`,
      createdAt: new Date().toISOString(),
    });
  }

  for (const save of tickResult.pendingSaves) {
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId,
      type: 'pending_save_patch',
      fromKey: 'session',
      fromName: 'Sessao',
      toKey: save.targetKey,
      toName: save.targetKey,
      pendingSavePatch: { action: 'create', save },
      message: `Teste pendente criado para ${save.sourceName || 'efeito'}.`,
      createdAt: new Date().toISOString(),
    });
  }

  if (options.syncPayload === false) {
    return null;
  }
  return syncLanSessionPayload(db, sessionId);
}

async function recordEffectPatchEvent(
  db: SQLiteDatabase,
  sessionId: string,
  targetKey: string,
  targetName: string,
  patch: LanEffectPatch,
  message: string,
): Promise<LanSessionEvent> {
  const event: LanSessionEvent = {
    id: makeLanEventId(),
    sessionId,
    type: 'effect_patch',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: targetKey,
    toName: targetName,
    entityType: 'effect',
    entityId: targetKey,
    ackRequired: true,
    originClientId: 'master',
    effectPatch: patch,
    message,
    createdAt: new Date().toISOString(),
  };
  const result = await commitLanEvent(db, event);
  return result.event;
}

function normalizeJsonColumn(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export async function applyLanSessionStateToCharacter(
  db: SQLiteDatabase,
  payload: LanSessionPayload,
  characterId: number,
  options?: { remoteKey?: string; characterName?: string }
) {
  const character = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM characters WHERE id = ?`,
    [characterId]
  );
  if (!character || !payload.state?.players?.length) return false;

  const localName = String(options?.characterName || character.name || '');
  const localKey = makeLanCharacterKey(payload.session.id, character);
  const match = payload.state.players.find((player) => (
    Boolean(options?.remoteKey) && player.remoteKey === options?.remoteKey
  )) || payload.state.players.find((player) => (
    player.remoteKey === localKey
  )) || payload.state.players.find((player) => (
    player.characterName === localName
  )) || payload.state.players.find((player) => (
    player.sourceCharacterId === characterId &&
    payload.state!.players.filter((candidate) => candidate.sourceCharacterId === characterId).length === 1
  ));
  if (!match) return false;

  const stats = applyEffectsToStats(match.stats, match.effects);
  const snapshot = match.characterSnapshot || {};

  const snapshotSpells = (snapshot as any).spells;
  const snapshotSaveValues = (snapshot as any).save_values;
  const snapshotSkillValues = (snapshot as any).skill_values;
  const snapshotProficiencies = (snapshot as any).proficiencies;

  // Se o jogador acabou de fazer level up localmente, um snapshot antigo do mestre
  // nao pode rebaixar a ficha de volta para o nivel anterior. Isso acontece quando
  // o mestre distribui XP, o jogador sobe nivel, mas o snapshot oficial ainda nao
  // aceitou a ficha atualizada. Mantemos os campos estruturais locais ate o mestre
  // receber/aceitar o snapshot de level up.
  const localStats = parseJsonValue<Record<string, unknown>>(character.stats, {});
  const localLevel = toNumber(character.level, 1);
  const officialLevel = toNumber(match.level, 1);
  const localXp = toNumber(character.xp, 0);
  const officialXp = toNumber(match.xp, 0);
  const bestKnownXp = Math.max(localXp, officialXp);
  const expectedLevelForBestKnownXp = await getExpectedLevelForXp(db, bestKnownXp);
  const keepLocalLevelProgress =
    localLevel > officialLevel &&
    localLevel <= expectedLevelForBestKnownXp;

  const nextLevel = keepLocalLevelProgress ? localLevel : officialLevel;
  const nextClassName = keepLocalLevelProgress ? String(character.class || match.className || '-') : match.className;
  const nextRace = keepLocalLevelProgress ? String(character.race || match.race || '-') : match.race;
  const nextHpCurrent = keepLocalLevelProgress ? Math.max(toNumber(character.hp_current, match.hpCurrent), match.hpCurrent) : match.hpCurrent;
  const nextHpMax = keepLocalLevelProgress ? Math.max(toNumber(character.hp_max, match.hpMax), match.hpMax) : match.hpMax;
  const nextXp = keepLocalLevelProgress ? bestKnownXp : officialXp;
  const nextStats = keepLocalLevelProgress ? localStats : stats;
  const nextSpells = keepLocalLevelProgress ? null : snapshotSpells;
  const nextSaveValues = keepLocalLevelProgress ? null : snapshotSaveValues;
  const nextSkillValues = keepLocalLevelProgress ? null : snapshotSkillValues;
  const nextProficiencies = keepLocalLevelProgress ? null : snapshotProficiencies;

  await db.runAsync(
    `UPDATE characters
     SET level = ?,
         class = ?,
         race = ?,
         hp_current = ?,
         hp_max = ?,
         temp_hp = ?,
         xp = ?,
         gp = ?,
         sp = ?,
         cp = ?,
         stats = ?,
         equipment = ?,
         active_effects_json = ?,
         spells = COALESCE(?, spells),
         save_values = COALESCE(?, save_values),
         skill_values = COALESCE(?, skill_values),
         proficiencies = COALESCE(?, proficiencies),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      nextLevel,
      nextClassName,
      nextRace,
      nextHpCurrent,
      nextHpMax,
      match.tempHp,
      nextXp,
      match.gp,
      match.sp,
      match.cp,
      JSON.stringify(nextStats),
      JSON.stringify(match.equipment),
      JSON.stringify(match.effects),
      nextSpells == null ? null : normalizeJsonColumn(nextSpells),
      nextSaveValues == null ? null : normalizeJsonColumn(nextSaveValues),
      nextSkillValues == null ? null : normalizeJsonColumn(nextSkillValues),
      nextProficiencies == null ? null : normalizeJsonColumn(nextProficiencies),
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
  const unitLabel = formatEffectUnitLabel(effect.unit);
  const targetLabel = effect.target === 'PV_TEMP' ? 'PV temp.' : effect.target;
  const valueText = effect.target === 'custom' || effect.value === 0 ? '' : ` ${targetLabel} ${sign}${effect.value}`;
  if (effect.isPermanent || effect.unit === 'permanent') {
    return `${effect.name}:${valueText} (permanente)`;
  }
  return `${effect.name}:${valueText} (${effect.remaining} ${unitLabel})`;
}

function formatEffectUnitLabel(unit: LanEffectUnit) {
  const labels: Record<LanEffectUnit, string> = {
    instant: 'instant.',
    turn: 'turnos',
    round: 'rodadas',
    minute: 'min',
    hour: 'h',
    day: 'dias',
    short_rest: 'desc. curto',
    long_rest: 'desc. longo',
    rest: 'descanso',
    concentration: 'conc.',
    while_equipped: 'equipado',
    while_active: 'ativo',
    until_save: 'ate save',
    permanent: 'permanente',
    manual: 'manual',
  };
  return labels[unit] || 'tempo';
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
      clientId: row.client_id ? String(row.client_id) : undefined,
      playerName: String(row.player_name || normalized.playerName),
      characterId: row.character_id == null ? null : toNumber(row.character_id),
      sourceCharacterId: normalized.sourceCharacterId,
      characterName: String(row.character_name || normalized.characterName),
      level: toNumber(row.level, normalized.level),
      className: String(row.class_name || normalized.className),
      race: String(row.race || normalized.race),
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
      characterSnapshot: snapshot,
      pendingCharacter,
      pendingDiff: Array.isArray(pendingDiff) ? pendingDiff : [],
      revisionSeq: toNumber(row.revision_seq),
    };
  });
}

async function ensureLanSchema(db: SQLiteDatabase) {
  await ensureEffectSchema(db);
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
      client_id TEXT,
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

    CREATE TABLE IF NOT EXISTS lan_local_character_bindings (
      session_id TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      join_url TEXT,
      invite_code TEXT,
      remote_key TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      is_active INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, character_id)
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

  await ensureLanSyncSchema(db);
  await ensureLanEventStoreSchema(db);

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
    ['lan_session_players', 'client_id', 'TEXT'],
    ['lan_session_players', 'character_name', 'TEXT'],
    ['lan_session_players', 'level', 'INTEGER DEFAULT 1'],
    ['lan_session_players', 'class_name', 'TEXT'],
    ['lan_session_players', 'race', 'TEXT'],
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
    CREATE INDEX IF NOT EXISTS idx_lan_local_bindings_character ON lan_local_character_bindings(character_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_lan_local_bindings_session ON lan_local_character_bindings(session_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_seq ON lan_session_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_server_seq ON lan_session_events(session_id, server_seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_client_msg ON lan_session_events(session_id, client_msg_id);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_created ON lan_session_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lan_requests_session_status ON lan_session_pending_requests(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_lan_trades_session_status ON lan_session_trades(session_id, status);
  `);

  try {
    await db.execAsync(`
      DELETE FROM lan_session_players
      WHERE remote_key IS NOT NULL
        AND id NOT IN (
          SELECT MAX(id)
          FROM lan_session_players
          WHERE remote_key IS NOT NULL
          GROUP BY session_id, remote_key
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lan_players_session_remote_key_unique
      ON lan_session_players(session_id, remote_key)
      WHERE remote_key IS NOT NULL;
    `);
  } catch {
    // Se houver base antiga com duplicidades difíceis, o app segue sem derrubar a inicialização.
  }

  try {
    await db.execAsync(`
      DELETE FROM lan_session_players
      WHERE client_id IS NOT NULL
        AND id NOT IN (
          SELECT MAX(id)
          FROM lan_session_players
          WHERE client_id IS NOT NULL
          GROUP BY session_id, client_id
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lan_players_session_client_id_unique
      ON lan_session_players(session_id, client_id)
      WHERE client_id IS NOT NULL;
    `);
  } catch {
    // Mesmo motivo acima: não bloquear abertura por dados legados.
  }
}

function normalizeCharacterState(character: Record<string, unknown>) {
  const characterName = String(character.name || 'Personagem');

  // Aceita snake_case e camelCase porque snapshots podem vir do SQLite,
  // do estado React, de payload LAN ou de versões anteriores do app.
  const hpCurrent = toNumber(
    character.hp_current ??
    character.hpCurrent ??
    character.currentHp ??
    character.hp,
    0
  );

  const hpMax = toNumber(
    character.hp_max ??
    character.hpMax ??
    character.maxHp ??
    character.max_hp,
    hpCurrent
  );

  return {
    playerName: characterName,
    characterName,
    sourceCharacterId: character.id == null ? null : toNumber(character.id),
    level: toNumber(character.level, 1),
    className: String(character.class || character.className || '-'),
    race: String(character.race || '-'),
    hpCurrent,
    hpMax,
    tempHp: toNumber(character.temp_hp ?? character.tempHp),
    xp: toNumber(character.xp),
    gp: toNumber(character.gp),
    sp: toNumber(character.sp),
    cp: toNumber(character.cp),
    stats: parseJsonValue<Record<string, unknown>>(character.stats, {}),
    equipment: normalizeEquipment(character.equipment),
  };
}

function hasMinimumLanJoinSnapshot(
  character: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeCharacterState>
) {
  const hasName = Boolean(String(character.name || normalized.characterName || '').trim());
  const hasRace = Boolean(String(normalized.race || '').trim()) && normalized.race !== '-';
  const hasClass = Boolean(String(normalized.className || '').trim()) && normalized.className !== '-';
  const hasHp = normalized.hpMax > 0;
  const hasStats = Boolean(normalized.stats && Object.keys(normalized.stats).length > 0);
  const hasSourceCharacter = normalized.sourceCharacterId != null && normalized.sourceCharacterId > 0;
  return hasName && hasRace && hasClass && hasHp && hasStats && hasSourceCharacter;
}

async function updateLanPlayerFromNormalizedSnapshot(
  db: SQLiteDatabase,
  playerId: number,
  snapshot: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeCharacterState>
) {
  await db.runAsync(
    `UPDATE lan_session_players
     SET character_name = ?,
         character_snapshot = ?,
         pending_character_snapshot = NULL,
         notes = NULL,
         level = ?,
         class_name = ?,
         race = ?,
         hp_current = ?,
         hp_max = ?,
         temp_hp = ?,
         xp = ?,
         gp = ?,
         sp = ?,
         cp = ?,
         stats_json = ?,
         equipment_json = ?,
         revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      normalized.characterName,
      JSON.stringify(snapshot),
      normalized.level,
      normalized.className,
      normalized.race,
      normalized.hpCurrent,
      normalized.hpMax,
      normalized.tempHp,
      normalized.xp,
      normalized.gp,
      normalized.sp,
      normalized.cp,
      JSON.stringify(normalized.stats),
      JSON.stringify(normalized.equipment),
      playerId,
    ]
  );
}

async function canAutoAcceptLevelUpSnapshot(
  db: SQLiteDatabase,
  current: Record<string, unknown>,
  incoming: ReturnType<typeof normalizeCharacterState>,
  diffs: string[]
) {
  const currentSnapshot = normalizeCharacterState(parseJsonValue<Record<string, unknown>>(current.character_snapshot, {}));
  const currentLevel = toNumber(current.level, currentSnapshot.level);
  const currentXp = toNumber(current.xp, currentSnapshot.xp);
  const bestKnownXp = Math.max(currentXp, incoming.xp);

  // O level up pode chegar do jogador logo apos o mestre enviar XP. Em redes LAN
  // lentas, o roster oficial ainda pode estar com XP antigo no exato momento do
  // reviewSnapshot. Por isso a autorizacao considera o maior XP conhecido entre
  // o mestre e a ficha do jogador. Ainda bloqueamos inventario, moedas e mudanca
  // de raca para nao aceitar alteracoes sensiveis sem revisao.
  const levelIsAuthorizedByXp =
    incoming.level > currentLevel &&
    incoming.level <= await getExpectedLevelForXp(db, bestKnownXp);
  const hasBlockedDiff = diffs.some((diff) => (
    diff.startsWith('Invent') ||
    diff.startsWith('Moedas') ||
    diff.startsWith('Ra')
  ));

  return levelIsAuthorizedByXp && !hasBlockedDiff;
}

function describeCharacterDiff(current: Record<string, unknown>, incoming: ReturnType<typeof normalizeCharacterState>) {
  const diffs: string[] = [];
  const currentSnapshot = normalizeCharacterState(parseJsonValue<Record<string, unknown>>(current.character_snapshot, {}));

  const currentValues = {
    level: toNumber(current.level, currentSnapshot.level),
    className: String(current.class_name || currentSnapshot.className || '-'),
    race: String(current.race || currentSnapshot.race || '-'),
    stats: parseJsonValue<Record<string, unknown>>(current.stats_json, currentSnapshot.stats),
    equipment: parseJsonValue<Record<string, unknown>>(current.equipment_json, currentSnapshot.equipment),
  };

  if (incoming.level !== currentValues.level) {
    if (incoming.level > currentValues.level) {
      diffs.push(`Subiu de nível ${currentValues.level} -> ${incoming.level}`);
    } else {
      diffs.push(`Nível alterado ${currentValues.level} -> ${incoming.level}`);
    }
  }

  if (incoming.className !== currentValues.className) {
    diffs.push(`Classe alterada: ${currentValues.className} -> ${incoming.className}`);
  }

  if (incoming.race !== currentValues.race) {
    diffs.push(`Raça alterada: ${currentValues.race} -> ${incoming.race}`);
  }

  if (JSON.stringify(incoming.stats) !== JSON.stringify(currentValues.stats)) {
    diffs.push('Atributos alterados');
  }

  // Inventário é um recurso vivo no modo LAN. Alterações oficiais do mestre,
  // envio entre jogadores, troca, consumo e redução própria não devem virar
  // "Atualização pendente" de ficha no painel do mestre.
  // O controle/validação acontece por inventory_patch/send_item/trade.

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
    `SELECT id, remote_key, character_name, character_id, equipment_json, revision_seq, gp, sp, cp
     FROM lan_session_players
     WHERE session_id = ? AND remote_key = ? AND COALESCE(is_active, 1) = 1`,
    [sessionId, remoteKey]
  );
}

async function getActiveLanPlayerForMutation(db: SQLiteDatabase, sessionId: string, remoteKey: string) {
  return db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, remote_key, character_name, character_id, equipment_json, revision_seq
     FROM lan_session_players
     WHERE session_id = ? AND remote_key = ? AND COALESCE(is_active, 1) = 1`,
    [sessionId, remoteKey]
  );
}

async function getLanSessionStatus(db: SQLiteDatabase, sessionId: string) {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT status FROM lan_sessions WHERE id = ?`,
    [sessionId]
  );
  return normalizeSessionStatus(row?.status);
}

async function runLanDbTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>) {
  const transactional = db as SQLiteDatabase & { withTransactionAsync?: (task: () => Promise<T>) => Promise<T> };
  if (typeof transactional.withTransactionAsync === 'function') {
    return transactional.withTransactionAsync(task);
  }

  await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = await task();
    await db.execAsync('COMMIT');
    return result;
  } catch (error) {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function writeLanPlayerEquipmentSnapshot(
  db: SQLiteDatabase,
  player: Record<string, unknown>,
  equipment: Record<string, unknown>
) {
  const normalized = normalizeEquipment(equipment);
  const playerId = Number(player.id);

  await db.runAsync(
    `UPDATE lan_session_players
     SET equipment_json = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(normalized), playerId]
  );

  if (player.character_id) {
    await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [
      JSON.stringify(normalized),
      Number(player.character_id),
    ]);
  }

  return normalized;
}

async function getStoredLanTradeOffer(db: SQLiteDatabase, sessionId: string, tradeId: string) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    `SELECT payload_json
     FROM lan_session_events
     WHERE session_id = ? AND id = ? AND type = 'trade_offer'
     LIMIT 1`,
    [sessionId, tradeId]
  );
  return parseJsonValue<LanSessionEvent | null>(row?.payload_json, null);
}

function normalizeTradeItemForMutation(item?: LanTradeItem | null): LanTradeItem | null {
  const name = String(item?.name || '').trim();
  if (!name) return null;
  return {
    ...item,
    name,
    qty: Math.max(1, Math.floor(toNumber(item?.qty, 1))),
  };
}

function coinsToCopper(coins: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>>) {
  return Math.max(0, Math.floor(toNumber(coins.gp))) * 100 +
    Math.max(0, Math.floor(toNumber(coins.sp))) * 10 +
    Math.max(0, Math.floor(toNumber(coins.cp)));
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

function normalizeCoinField(value: unknown): 'gp' | 'sp' | 'cp' | null {
  if (value === 'gp' || value === 'sp' || value === 'cp') return value;
  return null;
}

function describeResourceRequest(request: LanResourceRequest) {
  if (request.message) return request.message;
  if (request.kind === 'xp') return `XP ${toNumber(request.amount) >= 0 ? '+' : ''}${toNumber(request.amount)}`;
  if (request.kind === 'hp') return `HP ${toNumber(request.amount) >= 0 ? '+' : ''}${toNumber(request.amount)}`;
  if (request.kind === 'temp_hp') return `PV temporario ${toNumber(request.amount ?? request.value) >= 0 ? '+' : ''}${toNumber(request.amount ?? request.value)}`;
  if (request.kind === 'coin') return `${request.field || 'moedas'} ${toNumber(request.amount ?? request.value) >= 0 ? '+' : ''}${toNumber(request.amount ?? request.value)}`;
  if (request.kind === 'stat' || request.kind === 'buff') return `${request.field || 'atributo'} ${toNumber(request.value ?? request.amount) >= 0 ? '+' : ''}${toNumber(request.value ?? request.amount)}`;
  if (request.kind === 'condition') return `condicao ${request.field || 'manual'}`;
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

function updateLanHostPayload(joinUrl: string | undefined, payload: LanSessionPayload, options?: { broadcast?: boolean }) {
  if (isTcpLanUrl(joinUrl)) updateLanTcpHostPayload(payload, options);
}

async function startLanForegroundSession(payload: LanSessionPayload, joinUrl: string | undefined) {
  if (!canUseLanForegroundService(joinUrl)) return;
  if (payload.state?.status && payload.state.status !== 'active') {
    await stopLanForegroundSession();
    return;
  }
  if (!lanNative?.startForegroundSession) return;

  try {
    await requestLanNotificationPermission();
    const info = getLanForegroundInfo(payload, joinUrl || '');
    await lanNative.startForegroundSession(info.sessionName, info.inviteCode, info.joinUrl, info.playerCount);
  } catch (error) {
    console.warn('[LAN] Nao foi possivel iniciar notificacao foreground da mesa:', error);
  }
}

async function updateLanForegroundSession(payload: LanSessionPayload, joinUrl: string | undefined) {
  if (!canUseLanForegroundService(joinUrl)) return;
  if (payload.state?.status && payload.state.status !== 'active') {
    await stopLanForegroundSession();
    return;
  }
  if (!lanNative?.updateForegroundSession) return;

  try {
    const info = getLanForegroundInfo(payload, joinUrl || '');
    await lanNative.updateForegroundSession(info.sessionName, info.inviteCode, info.joinUrl, info.playerCount);
  } catch (error) {
    console.warn('[LAN] Nao foi possivel atualizar notificacao foreground da mesa:', error);
  }
}

async function stopLanForegroundSession() {
  if (Platform.OS !== 'android' || !lanNative?.stopForegroundSession) return false;

  try {
    return await lanNative.stopForegroundSession();
  } catch {
    return false;
  }
}

async function requestLanNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;

  const alreadyGranted = await PermissionsAndroid.check(POST_NOTIFICATIONS_PERMISSION);
  if (alreadyGranted) return true;

  const result = await PermissionsAndroid.request(POST_NOTIFICATIONS_PERMISSION, {
    title: 'Notificacao da mesa LAN',
    message: 'Permita a notificacao persistente para manter a sessao do mestre visivel em segundo plano.',
    buttonPositive: 'Permitir',
    buttonNegative: 'Agora nao',
  });

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function canUseLanForegroundService(joinUrl: string | undefined) {
  return Platform.OS === 'android' && isTcpLanUrl(joinUrl);
}

function getLanForegroundInfo(payload: LanSessionPayload, joinUrl: string) {
  return {
    sessionName: payload.session.name || 'Mesa LAN',
    inviteCode: payload.session.inviteCode || '',
    joinUrl,
    playerCount: payload.state?.players?.length || 0,
  };
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
