import DiceRoller3D, { type DiceRollRequest, type DiceRollResult } from '@/components/DiceRoller3D';
import QrCodeView from '@/components/QrCodeView';
import { useLanAppLifecycle } from '@/hooks/useLanAppLifecycle';
import {
  traceApp,
  traceButton,
  traceError,
  traceFunctionCall,
  traceFunctionReturn,
  traceScreen,
  traceSocket,
  traceSqlite,
  traceStateChange,
} from '@/services/debug/appTrace';
import { applyDamageWithTempHp } from '@/services/combat/hpDamageService';
import { resolveAttackAgainstArmorClass } from '@/services/combat/attackResolverService';
import {
  canUseVisualDiceRoll,
  formatDiceRollBreakdown,
  parseUsableDiceFormula,
  rollParsedDiceFormula,
  type ParsedDiceFormula,
} from '@/services/combat/diceFormulaService';
import { listEffects } from '@/services/effects/effectCatalogService';
import { createEffectDurationPayload } from '@/services/effects/effectDurationService';
import { createPendingSave, listPendingSaves, resolveSave } from '@/services/effects/effectResolver';
import type { LanPendingSave } from '@/services/effects/effectTypes';
import {
  addLanPlayerEffect,
  addLanPlayerEffectsBatch,
  advanceLanSessionTime,
  applyLanCoinSelfPatchRequest,
  applyLanInventoryTransferEvent,
  applyLanPlayerInventoryPatch,
  applyLanPlayerNumberPatch,
  applyLanPlayerProgressionPatchFromEvent,
  applyLanResourceRequest,
  applyLanSendItemRequest,
  applyLanTradeAcceptRequest,
  buildJoinDeepLink,
  buildLanSessionPayload,
  consumeLanForegroundStopRequest,
  consumeLanPlayerTempHpAfterDamage,
  deleteLanSession,
  ensurePendingRemotePlayerFromEvent,
  formatElapsedTime,
  getActiveLanSessionConflict,
  getBoundLanCharacter,
  getCustomCatalogOptions,
  getLanSessionEvents,
  getLanSessionState,
  getMasterJoinedPlayers,
  getNativeSessionAcks,
  getNativeSessionEvents,
  getSavedLanSessions,
  isEmulatorOnlyTcpUrl,
  keysFromSelection,
  kickLanSessionPlayer,
  makeInviteCode,
  makeLanCharacterKey,
  makeLanEventId,
  makeLanHostInstanceId,
  makeSessionId,
  pauseLanSession,
  rebuildLanSessionCatalog,
  rememberAndSendLanSessionEvent,
  rememberLanSessionEvent,
  removeLanPlayerEffect,
  removeLanPlayerTempHpEffects,
  resetLanClientConnection,
  reviewLanPlayerPendingSnapshot,
  saveLanSession,
  sendLanSessionEvent,
  selectionFromKeys,
  startLanServer,
  stopLanServer,
  subscribeLanForegroundStop,
  subscribeLanSessionHostUpdates,
  summarizeEffect,
  switchLanRole,
  syncLanSessionPayload,
  updateLanPlayerEquipment,
  updateLanPlayerNumbers,
  updateLanPlayerStats,
  upsertLanSessionPlayerFromNetwork,
  type CatalogOption,
  type LanAdvanceUnit,
  type LanEffectTarget,
  type LanEffectUnit,
  type LanSessionEvent,
  type LanSessionEffect,
  type LanSessionHostUpdate,
  type LanSessionPayload,
  type LanSessionPlayerState,
  type LanSessionState,
  type LanSessionSummary,
  type LanTradeItem,
} from '@/services/lanSession';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import { updateLanTcpHostPayload } from '@/services/lanTcpTransport';
import { executeLanHostCommandOnce } from '@/services/lan/lanCommandBus';
import {
  applyIncomingSnapshot,
  dispatchMasterCommand,
  getLanProjection,
  subscribeLanProjection,
} from '@/services/lan/engine/LanEngineBridge';
import { legacyPayloadToLanSnapshot } from '@/services/lan/engine/LanSnapshotAdapter';
import type {
  CharacterProjection,
  LanAuthoritativeEvent,
  LanCommand,
  SessionProjection,
} from '@/services/lan/engine/LanTypes';
import { subscribeLanForegroundRecovery } from '@/services/lan/lanForegroundRecoveryBus';
import { enqueueLanEntityMutation, getLanInventoryQueueKey, getLanPlayerQueueKey, getLanSessionQueueKey } from '@/services/lan/lanEntityQueue';
import {
  applyHostEffectPatchRuntime,
  applyHostInventoryPatchRuntime,
  applyHostNumberDeltaRuntime,
  applyHostNumberPatchRuntime,
  applyHostTurnRuntime,
  mergeSessionStatePreservingLiveFields,
  removeHostPlayerRuntime,
  replaceLanRuntimeStateFromBootstrap,
} from '@/stores/lanSessionRuntimeStore';
import { appColors, appGradients, lanSessionStyles as styles } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

const CATALOG_FILTERS = ['Todos', 'Item', 'Raca', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit'];
const EFFECT_TARGETS: LanEffectTarget[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'HP', 'PV_TEMP', 'custom'];
const EFFECT_UNITS: { label: string; value: LanEffectUnit }[] = [
  { label: 'Manual', value: 'manual' },
  { label: 'Turnos', value: 'turn' },
  { label: 'Minutos', value: 'minute' },
  { label: 'Horas', value: 'hour' },
  { label: 'Descanso', value: 'rest' },
];
const STAT_KEYS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const INVENTORY_FILTERS = ['Todos', 'Armas', 'Armaduras', 'Consumiveis', 'Efeitos', 'Outros'] as const;
const SESSION_HISTORY_PAGE_SIZE = 50;
const SESSION_HISTORY_INITIAL_LIMIT = 50;
const SESSION_HISTORY_MAX_IN_MEMORY = 500;
const MASTER_SQLITE_RELOAD_COOLDOWN_MS = 9000;
const MASTER_REPEATABLE_ACTION_QUEUE_DELAY_MS = 80;
const MASTER_REPEATABLE_ACTION_MAX_QUEUE_DEPTH = 50;

// v109: guarda de ciclo de vida fora do componente. Em Expo/StrictMode ou com telas
// duplicadas na pilha, refs locais podem nascer de novo; esse mapa impede pause/resume/end
// duplicados para a mesma sessão em janelas curtas.
const GLOBAL_MASTER_LIFECYCLE_ACTIONS = new Map<string, number>();
function acquireMasterLifecycleAction(key: string, ttlMs = 2500) {
  const now = Date.now();
  for (const [entryKey, expiresAt] of GLOBAL_MASTER_LIFECYCLE_ACTIONS) {
    if (expiresAt <= now) GLOBAL_MASTER_LIFECYCLE_ACTIONS.delete(entryKey);
  }
  const expiresAt = GLOBAL_MASTER_LIFECYCLE_ACTIONS.get(key) || 0;
  if (expiresAt > now) return false;
  GLOBAL_MASTER_LIFECYCLE_ACTIONS.set(key, now + ttlMs);
  return true;
}
function releaseMasterLifecycleAction(key: string) {
  GLOBAL_MASTER_LIFECYCLE_ACTIONS.delete(key);
}

function getLanPlayerEntityQueueKeys(sessionId: string, player: Pick<LanSessionPlayerState, 'id' | 'remoteKey' | 'characterName'> | null | undefined) {
  if (!sessionId || !player) return [];
  return [
    getLanPlayerQueueKey(sessionId, player.id),
    player.remoteKey ? getLanPlayerQueueKey(sessionId, player.remoteKey) : undefined,
    player.characterName ? getLanPlayerQueueKey(sessionId, player.characterName) : undefined,
  ];
}

function sanitizeIntegerInput(text: string, allowNegative = false) {
  const value = String(text || '');
  const startsNegative = allowNegative && value.trim().startsWith('-');
  const digits = value.replace(/[^0-9]/g, '');
  if (startsNegative) return digits ? `-${digits}` : '-';
  return digits;
}


function getMasterTimelineDedupeKey(event: LanSessionEvent | null | undefined) {
  if (!event) return '';
  const id = String(event.id || '').trim();
  const sourceId = String(event.sourceClientMsgId || event.clientMsgId || event.tradeId || '').trim();
  const message = String(event.message || '').trim();
  if (sourceId && (event.type === 'resource_review' || event.type === 'player_patch' || event.type === 'effect_patch' || event.type === 'inventory_patch')) {
    return `source:${sourceId}:${event.toKey || ''}:${message || event.type}`;
  }
  if (id) return `id:${id}`;
  return `${event.type}:${event.fromKey || ''}:${event.toKey || ''}:${message}:${event.createdAt || ''}`;
}

function mergeMasterTimelineEvent(current: LanSessionEvent[], event: LanSessionEvent | null | undefined, limit = SESSION_HISTORY_MAX_IN_MEMORY) {
  if (!event) return current;
  const nextKey = getMasterTimelineDedupeKey(event);
  const nextId = String(event.id || '');
  const filtered = current.filter((item) => {
    if (nextId && String(item.id || '') === nextId) return false;
    return getMasterTimelineDedupeKey(item) !== nextKey;
  });
  return [event, ...filtered].slice(0, limit);
}

function cloneEquipmentForHost(value: unknown) {
  const normalized = normalizeHostEquipment(value);
  return {
    ...normalized,
    bag: Array.isArray(normalized.bag) ? [...normalized.bag] : [],
    slots: normalized.slots && typeof normalized.slots === 'object' ? { ...normalized.slots } : {},
  };
}

function normalizeHostItemName(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getHostInventoryItemId(item?: Partial<LanTradeItem> | null) {
  const raw = (item as any)?.inventoryItemId ?? (item as any)?.inventory_item_id ?? (item as any)?.itemId ?? (item as any)?.item_id ??
    (item as any)?.catalogItemId ?? (item as any)?.catalog_item_id ?? (item as any)?.sourceItemId ?? (item as any)?.source_item_id ??
    (item as any)?.dbId ?? (item as any)?.id;
  const normalized = normalizeHostItemName(raw);
  return normalized && normalized !== '0' ? normalized : '';
}

function getHostInventoryStackKey(item?: Partial<LanTradeItem> | null) {
  const explicit = normalizeHostItemName((item as any)?.stackKey || (item as any)?.stack_key);
  if (explicit) return explicit;
  return [
    normalizeHostItemName((item as any)?.name || (item as any)?.nome || (item as any)?.label),
    normalizeHostItemName((item as any)?.damage || (item as any)?.dano || ''),
    normalizeHostItemName((item as any)?.damage_type || (item as any)?.tipo_dano || ''),
    normalizeHostItemName((item as any)?.properties || (item as any)?.propriedades || ''),
    normalizeHostItemName((item as any)?.effect_json || (item as any)?.effectJson || ''),
    normalizeHostItemName((item as any)?.duration_unit || ''),
    String((item as any)?.duration_value ?? ''),
  ].join('|');
}

function isSameHostInventoryItem(entry?: Partial<LanTradeItem> | null, item?: Partial<LanTradeItem> | null) {
  if (!entry || !item) return false;
  const entryId = getHostInventoryItemId(entry);
  const itemId = getHostInventoryItemId(item);
  if (entryId && itemId && entryId === itemId) return true;

  // Importante: IDs de inventario podem ser locais ao dono do item.
  // Em uma troca, a Adaga do jogador A pode ter inventoryItemId diferente
  // da Adaga ja existente no jogador B. Se os IDs diferirem, ainda devemos
  // cair para stackKey/nome para somar a pilha correta no destino.
  const entryStack = getHostInventoryStackKey(entry);
  const itemStack = getHostInventoryStackKey(item);
  if (entryStack && itemStack && entryStack === itemStack) return true;
  const entryName = normalizeHostItemName((entry as any)?.name || (entry as any)?.nome || (entry as any)?.label);
  const itemName = normalizeHostItemName((item as any)?.name || (item as any)?.nome || (item as any)?.label);
  return Boolean(entryName && itemName && entryName === itemName);
}

function findHostInventoryBagIndex(bag: any[], item?: Partial<LanTradeItem> | null) {
  if (!Array.isArray(bag) || !item) return -1;
  return bag.findIndex((entry: any) => isSameHostInventoryItem(entry, item));
}

function addItemToHostEquipment(equipment: unknown, item?: Partial<LanTradeItem> | null, fallbackQty = 1) {
  const nextEquipment = cloneEquipmentForHost(equipment);
  const name = String(item?.name || '').trim();
  if (!name) return nextEquipment;
  const qty = Math.max(1, Math.floor(Number(item?.qty ?? fallbackQty) || fallbackQty));
  const bag = Array.isArray(nextEquipment.bag) ? [...nextEquipment.bag] : [];
  const index = findHostInventoryBagIndex(bag, item);
  if (index >= 0) {
    bag[index] = { ...bag[index], qty: Math.max(0, Math.floor(Number(bag[index]?.qty || 0))) + qty };
  } else {
    bag.push({ ...(item || {}), name, qty });
  }
  return { ...nextEquipment, bag };
}

function removeItemFromHostEquipment(equipment: unknown, item?: Partial<LanTradeItem> | null, fallbackQty = 1) {
  const nextEquipment = cloneEquipmentForHost(equipment);
  const name = String(item?.name || '').trim();
  if (!name) return { equipment: nextEquipment, removed: false };
  const qty = Math.max(1, Math.floor(Number(item?.qty ?? fallbackQty) || fallbackQty));
  const bag = Array.isArray(nextEquipment.bag) ? [...nextEquipment.bag] : [];
  const slots = nextEquipment.slots && typeof nextEquipment.slots === 'object' ? { ...nextEquipment.slots } : {};
  const index = findHostInventoryBagIndex(bag, item);
  if (index >= 0) {
    const current = bag[index];
    const currentQty = Math.max(1, Math.floor(Number(current?.qty || 1)));
    if (currentQty < qty) return { equipment: { ...nextEquipment, bag, slots }, removed: false };
    const nextQty = Math.max(0, currentQty - qty);
    if (nextQty <= 0) bag.splice(index, 1);
    else bag[index] = { ...current, qty: nextQty };
    return { equipment: { ...nextEquipment, bag, slots }, removed: true };
  }

  for (const [slotKey, rawSlotItem] of Object.entries(slots)) {
    const slotItem = rawSlotItem as any;
    if (!slotItem || !isSameHostInventoryItem(slotItem, item)) continue;
    const currentQty = Math.max(1, Math.floor(Number(slotItem.qty || 1)));
    if (currentQty < qty) return { equipment: { ...nextEquipment, bag, slots }, removed: false };
    const nextQty = Math.max(0, currentQty - qty);
    if (nextQty <= 0) (slots as any)[slotKey] = null;
    else (slots as any)[slotKey] = { ...slotItem, qty: nextQty };
    return { equipment: { ...nextEquipment, bag, slots }, removed: true };
  }

  return { equipment: { ...nextEquipment, bag, slots }, removed: false };
}

function getHostItemQty(equipment: unknown, item?: Partial<LanTradeItem> | null) {
  if (!item?.name) return 0;
  const normalized = normalizeHostEquipment(equipment);
  let total = 0;
  for (const entry of (Array.isArray(normalized.bag) ? normalized.bag : [])) {
    if (isSameHostInventoryItem(entry as any, item)) {
      total += Math.max(0, Math.floor(Number((entry as any)?.qty || 1)));
    }
  }
  const slots = normalized.slots && typeof normalized.slots === 'object' ? normalized.slots : {};
  for (const rawSlotItem of Object.values(slots)) {
    const slotItem = rawSlotItem as any;
    if (slotItem && isSameHostInventoryItem(slotItem, item)) {
      total += Math.max(1, Math.floor(Number(slotItem.qty || 1)));
    }
  }
  return total;
}

function hasHostItemQty(equipment: unknown, item?: Partial<LanTradeItem> | null, fallbackQty = 1) {
  if (!item?.name) return false;
  const qty = Math.max(1, Math.floor(Number(item?.qty ?? fallbackQty) || fallbackQty));
  return getHostItemQty(equipment, item) >= qty;
}

type InventoryFilter = (typeof INVENTORY_FILTERS)[number];
type ReferenceOption = { id: string; name: string; stat?: string };
type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;
const makeAuthoritativeNumberPatch = (player: LanSessionPlayerState, patch?: NumberPatch): Required<NumberPatch> => {
  const next = { ...player, ...(patch || {}) };
  return {
    hpCurrent: Math.max(0, Math.floor(Number(next.hpCurrent) || 0)),
    hpMax: Math.max(0, Math.floor(Number(next.hpMax) || 0)),
    tempHp: Math.max(0, Math.floor(Number(next.tempHp) || 0)),
    xp: Math.max(0, Math.floor(Number(next.xp) || 0)),
    gp: Math.max(0, Math.floor(Number(next.gp) || 0)),
    sp: Math.max(0, Math.floor(Number(next.sp) || 0)),
    cp: Math.max(0, Math.floor(Number(next.cp) || 0)),
  };
};

const COIN_TO_COPPER = { gp: 100, sp: 10, cp: 1 } as const;
const sanitizeCoinPatch = (coins: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>>) => ({
  gp: Math.max(0, Math.floor(Number(coins.gp || 0))),
  sp: Math.max(0, Math.floor(Number(coins.sp || 0))),
  cp: Math.max(0, Math.floor(Number(coins.cp || 0))),
});
const coinPatchToCopper = (coins: Partial<Pick<LanSessionPlayerState, 'gp' | 'sp' | 'cp'>>) => {
  const safe = sanitizeCoinPatch(coins);
  return safe.gp * COIN_TO_COPPER.gp + safe.sp * COIN_TO_COPPER.sp + safe.cp;
};

const inferNumberPatchIntent = (patch?: NumberPatch): LanSessionEvent['numberPatchIntent'] => {
  const keys = Object.keys(patch || {}).filter((key) => (patch as any)?.[key] !== undefined);
  if (keys.length === 0) return 'mixed';
  const coinKeys = ['gp', 'sp', 'cp'];
  const hpKeys = ['hpCurrent', 'hpMax'];
  if (keys.every((key) => coinKeys.includes(key))) return 'coins';
  if (keys.every((key) => key === 'tempHp')) return 'temp_hp';
  if (keys.every((key) => hpKeys.includes(key))) return 'hp';
  if (keys.every((key) => key === 'xp')) return 'xp';
  return 'mixed';
};

const isTempHpLanEffectSnapshot = (effect: any) => (
  String(effect?.target || '').toUpperCase() === 'PV_TEMP' ||
  String(effect?.kind || '').toLowerCase() === 'temp_hp'
);

const getTempHpLanEffectValue = (effect: any) => isTempHpLanEffectSnapshot(effect)
  ? Math.max(0, Math.floor(Number(effect?.value) || 0))
  : 0;

type EffectDraft = {
  name: string;
  target: LanEffectTarget;
  value: number;
  remaining: number;
  unit: LanEffectUnit;
  durationText?: string;
  isPermanent?: boolean;
  kind?: 'stat' | 'hp' | 'temp_hp' | 'status' | 'custom';
  mode?: 'add' | 'set';
  source?: string;
  sourceType?: string;
  sourceId?: string;
  visibleToPlayer?: boolean;
  publicNote?: string;
  privateNote?: string;
  icon?: string;
  removableBySave?: boolean;
  visualPriority?: number;
  autoExpire?: boolean;
  status?: string;
  statusKey?: string;
  color?: string;
  secondaryColor?: string;
  saveAbility?: string;
  saveDc?: number;
  repeatSave?: string;
  saveOnSuccess?: string;
};

function lanDomainEffectToSessionEffect(effect: any): LanSessionEffect {
  const unit = String(effect?.unit || 'manual') as LanEffectUnit;
  const id = String(effect?.effectId || effect?.id || effect?.sourceId || `engine_fx_${Date.now()}`);
  return {
    id,
    name: String(effect?.name || 'Efeito'),
    target: normalizeEffectTarget(effect?.target || 'custom'),
    value: Math.floor(Number(effect?.value || 0)),
    remaining: Math.max(0, Math.floor(Number(effect?.remaining || 0))),
    unit,
    isPermanent: unit === 'permanent' || unit === 'manual' || unit === 'while_equipped',
    kind: effect?.kind,
    mode: effect?.mode === 'set' ? 'set' : 'add',
    source: String(effect?.source || effect?.sourceType || 'Mestre'),
    sourceType: effect?.sourceType || 'manual',
    sourceId: String(effect?.sourceId || id),
    status: effect?.kind === 'status' ? String(effect?.name || effect?.status || '') : effect?.status,
    statusKey: effect?.statusKey || effect?.status || (effect?.kind === 'status' ? effect?.effectId : undefined),
    color: effect?.color,
    secondaryColor: effect?.secondaryColor,
    visualPriority: effect?.visualPriority,
    visibleToPlayer: effect?.visibleToPlayer !== false,
  } as LanSessionEffect;
}

function mergeLanProjectionIntoSessionState(
  projection: SessionProjection,
  currentState: LanSessionState | null | undefined,
): LanSessionState {
  const currentPlayers = currentState?.players || [];
  const usedPlayerIds = new Set<number>();
  const playersFromProjection = Object.values(projection.players).map((character, index) => {
    const existing = currentPlayers.find((player) => (
      player.remoteKey === character.playerKey ||
      String(player.sourceCharacterId || player.characterId || player.id || '') === String(character.characterId || '') ||
      player.characterName === character.name
    ));
    if (existing?.id != null) usedPlayerIds.add(existing.id);
    const nextId = existing?.id ?? (index + 1);
    return {
      ...(existing || {
        id: nextId,
        sessionId: projection.sessionId,
        playerName: character.name,
        characterName: character.name,
        level: character.level || 1,
        className: character.className || '',
        race: character.race || '',
      }),
      remoteKey: existing?.remoteKey || character.playerKey,
      sourceCharacterId: existing?.sourceCharacterId || character.characterId,
      characterId: existing?.characterId || character.characterId,
      characterName: character.name,
      level: character.level || existing?.level || 1,
      className: character.className || existing?.className || '',
      race: character.race || existing?.race || '',
      hpCurrent: character.hpCurrent,
      hpMax: character.hpMax,
      tempHp: character.tempHp,
      xp: character.xp,
      gp: character.coins.gp,
      sp: character.coins.sp,
      cp: character.coins.cp,
      stats: { ...(existing?.stats || {}), ...character.effectiveStats },
      equipment: normalizeHostEquipment(character.inventory || character.equipment || existing?.equipment),
      effects: character.activeEffects.map(lanDomainEffectToSessionEffect),
      playerRevisionSeq: projection.versions.players[character.playerKey] || existing?.playerRevisionSeq || existing?.revisionSeq || 0,
      effectRevisionSeq: projection.versions.effects[character.playerKey] || existing?.effectRevisionSeq || 0,
      inventoryRevisionSeq: projection.versions.inventories[character.playerKey] || existing?.inventoryRevisionSeq || 0,
      revisionSeq: Math.max(
        projection.versions.players[character.playerKey] || 0,
        projection.versions.effects[character.playerKey] || 0,
        projection.versions.inventories[character.playerKey] || 0,
        Number(existing?.revisionSeq || 0),
      ),
    } as LanSessionPlayerState;
  });

  const legacyOnlyPlayers = currentPlayers.filter((player) => !usedPlayerIds.has(player.id));
  return {
    ...(currentState || { status: 'active', currentTurn: 1, elapsedMinutes: 0, players: [] }),
    status: projection.status,
    currentTurn: projection.currentTurn,
    elapsedMinutes: projection.elapsedMinutes,
    players: [...playersFromProjection, ...legacyOnlyPlayers],
  };
}

function effectDraftToEngineEffect(draft: EffectDraft, targetKey: string, commandId: string) {
  const effectId = String(draft.sourceId || `${commandId}:effect`);
  return {
    id: effectId,
    effectId,
    sourceId: effectId,
    sourceType: draft.sourceType || 'manual',
    targetKey,
    name: draft.name || 'Efeito',
    kind: draft.kind || (draft.target === 'PV_TEMP' ? 'temp_hp' : STAT_KEYS.includes(String(draft.target)) ? 'stat' : 'custom'),
    target: draft.target || 'custom',
    value: Math.floor(Number(draft.value || 0)),
    mode: draft.mode || 'add',
    isPermanent: draft.isPermanent === true || draft.unit === 'permanent',
    remaining: Math.max(0, Math.floor(Number(draft.remaining || 0))),
    unit: draft.isPermanent ? 'permanent' : draft.unit || 'manual',
    status: 'active',
    stackPolicy: draft.kind === 'temp_hp' || draft.target === 'PV_TEMP' ? 'highest' : 'replace_same_source',
    source: draft.source || 'Mestre',
    statusKey: draft.statusKey || draft.status,
    color: draft.color,
    secondaryColor: draft.secondaryColor,
    saveAbility: draft.saveAbility,
    saveDc: draft.saveDc,
    repeatSave: draft.repeatSave,
    saveOnSuccess: draft.saveOnSuccess,
    visibleToPlayer: draft.visibleToPlayer !== false,
  };
}

function authoritativeEventToLanSessionEvent(
  event: LanAuthoritativeEvent | null | undefined,
  options?: {
    targetPlayer?: LanSessionPlayerState | null;
    message?: string;
    hostInstanceId?: string;
  },
): LanSessionEvent | null {
  if (!event) return null;
  const payload = (event.payload || {}) as any;
  const targetKey = String(payload.targetKey || event.aggregateId || options?.targetPlayer?.remoteKey || '');
  const targetName = options?.targetPlayer?.characterName || targetKey || 'Todos';
  const seq = Math.max(1, Math.floor(Number(event.serverSeq || 0) || Date.now()));
  const base = {
    id: event.eventId,
    sessionId: event.sessionId,
    seq,
    serverSeq: seq,
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: targetKey || 'all',
    toName: targetName,
    entityType: event.aggregateType,
    entityId: event.aggregateId,
    entityRevision: event.aggregateRevision,
    ackRequired: true,
    originClientId: 'master',
    sourceClientMsgId: event.commandId,
    message: options?.message,
    createdAt: event.createdAt,
  } satisfies Partial<LanSessionEvent>;

  if (event.type === 'player_patch') {
    const numberPatch = payload.patch || {};
    return {
      ...base,
      type: 'player_patch',
      numberPatch,
      numberPatchIntent: inferNumberPatchIntent(numberPatch),
      message: options?.message || `${targetName}: ficha atualizada pelo mestre.`,
    } as LanSessionEvent;
  }

  if (event.type === 'effect_patch') {
    const add = Array.isArray(payload.add) ? payload.add.map(lanDomainEffectToSessionEffect) : [];
    const update = Array.isArray(payload.update) ? payload.update.map(lanDomainEffectToSessionEffect) : [];
    const remove = Array.isArray(payload.remove) ? payload.remove.map(String) : [];
    return {
      ...base,
      type: 'effect_patch',
      effectPatch: { targetKey, add, update, remove },
      numberPatch: payload.numberPatch,
      numberPatchIntent: payload.numberPatch ? inferNumberPatchIntent(payload.numberPatch) : undefined,
      message: options?.message || `${targetName}: efeitos atualizados pelo mestre.`,
    } as LanSessionEvent;
  }

  if (['character_transaction', 'party_transaction', 'spell_transaction', 'reward_transaction'].includes(event.type)) {
    const participantKeys = Array.from(new Set([
      payload.targetKey || targetKey,
      ...Object.keys(payload.changesByTarget || {}),
      payload.trade?.fromKey,
      payload.trade?.toKey,
      payload.trade?.actorKey,
    ].filter(Boolean).map(String)));
    return ({
      ...base,
      type: event.type as any,
      targetKey: payload.targetKey || targetKey,
      participantKeys,
      participants: participantKeys,
      changes: payload.changes,
      changesByTarget: payload.changesByTarget,
      pendingSave: payload.pendingSave,
      trade: payload.trade,
      rolls: payload.rolls,
      characterTransaction: payload,
      message: options?.message || payload.message || `${targetName}: transacao LAN aplicada.`,
    } as unknown) as LanSessionEvent;
  }

  if (event.type === 'session_patch') {
    const status = payload.status as LanSessionState['status'] | undefined;
    return {
      ...base,
      type: 'session_patch',
      toKey: 'all',
      toName: 'Todos',
      ackRequired: false,
      sessionPatch: {
        ...payload,
        pausedAt: status === 'paused' ? event.createdAt : payload.pausedAt,
        resumedAt: status === 'active' ? event.createdAt : payload.resumedAt,
        hostInstanceId: options?.hostInstanceId || payload.hostInstanceId,
        readOnlyForPlayers: status === 'paused' ? true : status === 'active' ? false : payload.readOnlyForPlayers,
      },
      message: options?.message || (status === 'paused'
        ? 'O mestre pausou a sessao. A campanha continuara depois.'
        : status === 'active'
          ? 'O mestre retomou a sessao.'
          : `Tempo da sessao avancou.`),
    } as LanSessionEvent;
  }

  if (event.type === 'session_ended') {
    return {
      ...base,
      type: 'session_ended',
      toKey: 'all',
      toName: 'Todos',
      entityType: 'session',
      entityId: event.sessionId,
      sessionEnded: {
        endedAt: event.createdAt,
        reason: 'campaign_finished',
        unlinkPlayers: true,
        allowOfflineAfterEnd: true,
        preserveOfficialRewards: true,
        clearTemporarySessionEffects: true,
      },
      message: options?.message || 'O mestre encerrou a campanha. As fichas foram desvinculadas da sessao.',
    } as LanSessionEvent;
  }

  return null;
}

type DiceValueResolution = {
  total: number;
  mode: 'manual' | 'virtual';
  formula: string;
  breakdown?: string;
};

const PERMANENT_STAT_TARGETS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'] as const;

type EffectOption = {
  key: string;
  name: string;
  group: string;
  detail: string;
  effects: any[];
  durationValue?: number | null;
  durationUnit?: LanEffectUnit | null;
  durationText?: string;
  statusKey?: string;
  color?: string;
  secondaryColor?: string;
};

type InventoryItemOption = LanTradeItem & {
  id: number;
  descricao?: string;
  category?: InventoryFilter;
};

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const masterMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const silentPayloadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSessionStateRunningRef = useRef(false);
  const reloadSessionStateQueuedRef = useRef<string | null>(null);
  const reloadSessionStateLastRunAtRef = useRef(0);
  const sessionLifecycleLockUntilRef = useRef(0);
  const endingSessionRef = useRef(false);
  const pauseToggleRunningRef = useRef(false);
  const pendingMasterActionIdsRef = useRef<Set<string>>(new Set());
  const masterActionLastAcceptedAtRef = useRef<Map<string, number>>(new Map());
  const masterActionQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const masterActionQueueDepthRef = useRef<Map<string, number>>(new Map());
  const grantItemCooldownRef = useRef<Set<string>>(new Set());
  const processedHostActionIdsRef = useRef<Set<string>>(new Set());
  // v84: revisão própria de inventário por jogador. Não use revisionSeq de player/HP
  // para inventory_patch; isso era a causa de troca chegar no socket e ser descartada
  // como old_entity_revision em alguns celulares.
  const inventoryRevisionByPlayerRef = useRef<Record<string, number>>({});
  const pendingHostJoinPromisesRef = useRef<Record<string, Promise<LanSessionPayload | null>>>({});
  const completedHostJoinAtRef = useRef<Record<string, number>>({});
  const seenNativeHostEventIdsRef = useRef<Set<string>>(new Set());
  const latestHostCoinMutationRef = useRef<Record<string, { opSeq: number; at: number; totalCopper: number }>>({});
  const publicStatusTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPublicStatusRef = useRef<Record<string, {
    sessionId: string;
    player: LanSessionPlayerState;
    reason: string;
    numberPatch?: NumberPatch;
  }>>({});
  const tempHpEffectSilentSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingTempHpEffectSilentSyncRef = useRef<Record<string, {
    sessionId: string;
    playerId: number;
    playerKey?: string;
    absorbedTempHp: number;
    source: string;
  }>>({});

  const enqueueMasterMutation = useCallback((task: () => Promise<void>) => {
    const run = masterMutationQueueRef.current
      .catch(() => undefined)
      .then(task);

    masterMutationQueueRef.current = run.catch((error) => {
      console.warn('[LAN MASTER MUTATION FAILED]', error);
    });

    return run;
  }, []);

  const [sessionName, setSessionName] = useState('Mesa de D&D');
  const [masterName, setMasterName] = useState('Mestre');
  const [level, setLevel] = useState('1');
  const [allowExisting, setAllowExisting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [pendingMasterActionIds, setPendingMasterActionIds] = useState<string[]>([]);
  const [payload, setPayload] = useState<LanSessionPayload | null>(null);
  const [sessionState, setSessionState] = useState<LanSessionState | null>(null);
  const [lanProjection, setLanProjection] = useState<SessionProjection | null>(null);
  const [sessionEvents, setSessionEvents] = useState<LanSessionEvent[]>([]);
  const [sessionHistoryLimit, setSessionHistoryLimit] = useState(SESSION_HISTORY_INITIAL_LIMIT);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [sessionHistoryHasMore, setSessionHistoryHasMore] = useState(true);
  const [joinUrl, setJoinUrl] = useState('');
  const [joinLink, setJoinLink] = useState('');

  useEffect(() => {
    const tag = 'ficha-dnd-lan-master-active';
    const shouldKeepAwake = Boolean(payload?.session?.id && joinUrl && !isEndingSession && sessionState?.status !== 'ended');

    if (!shouldKeepAwake) return;

    void activateKeepAwakeAsync(tag).catch((error) => {
      debugLanFlow('MASTER_KEEP_AWAKE_ACTIVATE_FAILED', {
        sessionId: payload?.session?.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    debugLanFlow('MASTER_KEEP_AWAKE_ACTIVE', {
      sessionId: payload?.session?.id,
      status: sessionState?.status,
    });

    return () => {
      try {
        deactivateKeepAwake(tag);
      } catch {
        // keep-awake cleanup is best-effort.
      }
    };
  }, [isEndingSession, joinUrl, payload?.session?.id, sessionState?.status]);
  const [savedSessions, setSavedSessions] = useState<LanSessionSummary[]>([]);


  const applyRuntimeStateToUiAndTransport = useCallback((nextState: LanSessionState | null) => {
    if (!nextState) return;
    sessionStateRef.current = nextState;
    setSessionState(nextState);
    setPayload((current) => {
      if (!current) return current;
      const nextPayload = { ...current, state: nextState };
      updateLanTcpHostPayload(nextPayload, { broadcast: false });
      return nextPayload;
    });
  }, []);

  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [selectedCatalogKeys, setSelectedCatalogKeys] = useState<string[]>([]);
  const [catalogModalVisible, setCatalogModalVisible] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState('Todos');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [effectTargetPlayerId, setEffectTargetPlayerId] = useState<number | 'ALL'>('ALL'); // NOVO: Controle de alvo do efeito
  const [effectName, setEffectName] = useState('Efeito temporario');
  const [effectTarget, setEffectTarget] = useState<LanEffectTarget>('FOR');
  const [effectValue, setEffectValue] = useState('2');
  const [effectDuration, setEffectDuration] = useState('3');
  const [effectUnit, setEffectUnit] = useState<LanEffectUnit>('turn');
  const [effectMode, setEffectMode] = useState<'add' | 'set'>('add');
  const [effectSource, setEffectSource] = useState('');
  const [effectStatusKey, setEffectStatusKey] = useState('');
  const [effectColor, setEffectColor] = useState('');
  const [effectSecondaryColor, setEffectSecondaryColor] = useState('');
  const [effectSearch, setEffectSearch] = useState('');
  const [selectedEffectKeys, setSelectedEffectKeys] = useState<string[]>([]);
  const [effectSaveInfo, setEffectSaveInfo] = useState('');
  const [effectOptions, setEffectOptions] = useState<EffectOption[]>([]);
  const [expandedPlayerIds, setExpandedPlayerIds] = useState<number[]>([]);
  const [reviewedSpellEventIds, setReviewedSpellEventIds] = useState<string[]>([]);
  const [reviewedRequestEventIds, setReviewedRequestEventIds] = useState<string[]>([]);
  const [pendingSaves, setPendingSaves] = useState<LanPendingSave[]>([]);
  const [xpPool, setXpPool] = useState('1000');
  const [masterDiceRollRequest, setMasterDiceRollRequest] = useState<DiceRollRequest | undefined>();
  const [masterDiceValuePrompt, setMasterDiceValuePrompt] = useState<{
    visible: boolean;
    title: string;
    message: string;
    formula: string;
    qty: number;
    manualValue: string;
  }>({ visible: false, title: '', message: '', formula: '', qty: 1, manualValue: '' });
  const pendingMasterDiceValueResolverRef = useRef<((result: DiceValueResolution | null) => void) | null>(null);
  const pendingMasterVisualDiceValueRef = useRef<{
    parsed: ParsedDiceFormula;
    resolve: (result: DiceValueResolution | null) => void;
  } | null>(null);

  const [inventoryModalPlayer, setInventoryModalPlayer] = useState<LanSessionPlayerState | null>(null);
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryItemOption[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('Todos');
  const [grantItemQty, setGrantItemQty] = useState('1');
  const [detailPlayer, setDetailPlayer] = useState<LanSessionPlayerState | null>(null);
  const [effectListModalPlayer, setEffectListModalPlayer] = useState<LanSessionPlayerState | null>(null);
  const [skillOptions, setSkillOptions] = useState<ReferenceOption[]>([]);
  const [saveOptions, setSaveOptions] = useState<ReferenceOption[]>([]);
  const [spellOptions, setSpellOptions] = useState<ReferenceOption[]>([]);

  // Mantém os modais do mestre apontando para o objeto vivo do runtime.
  // Sem isso, a ficha aberta antes de equipar/consumir continuava presa em um snapshot antigo.
  useEffect(() => {
    const players = sessionState?.players || [];
    if (players.length === 0) return;

    setDetailPlayer((current) => {
      if (!current) return current;
      return players.find((player) => (
        player.remoteKey === current.remoteKey ||
        player.id === current.id ||
        player.characterName === current.characterName
      )) || current;
    });

    setInventoryModalPlayer((current) => {
      if (!current) return current;
      return players.find((player) => (
        player.remoteKey === current.remoteKey ||
        player.id === current.id ||
        player.characterName === current.characterName
      )) || current;
    });

    setEffectListModalPlayer((current) => {
      if (!current) return current;
      return players.find((player) => (
        player.remoteKey === current.remoteKey ||
        player.id === current.id ||
        player.characterName === current.characterName
      )) || current;
    });
  }, [sessionState]);
  
  // NOVO: Estado para o Modal de Edição Rápida (HP, XP, Moedas, Atributos)
  const [quickEdit, setQuickEdit] = useState<{
    player: LanSessionPlayerState;
    type: 'STAT' | 'HP' | 'XP' | 'COIN' | 'PV_TEMP';
    stat?: string;
  } | null>(null);
  const [qeValue, setQeValue] = useState('');
  const [qeDuration, setQeDuration] = useState('1');
  const [qeUnit, setQeUnit] = useState<LanEffectUnit>('hour');
  const [qeIsTemp, setQeIsTemp] = useState(true);
  const [qeGP, setQeGP] = useState('');
  const [qeSP, setQeSP] = useState('');
  const [qeCP, setQeCP] = useState('');

  const activeSessionId = payload?.session.id;
  const sessionStateRef = useRef<LanSessionState | null>(null);
  const isMasterActionPending = useCallback((actionId: string) => pendingMasterActionIds.includes(actionId), [pendingMasterActionIds]);
  const runMasterAction = useCallback(async (
    actionId: string,
    task: () => Promise<void>,
    options?: {
      cooldownMs?: number;
      keepPendingMs?: number;
      mode?: 'drop' | 'queue';
      queueDelayMs?: number;
      maxQueueDepth?: number;
    }
  ) => {
    const mode = options?.mode || 'drop';
    const cooldownMs = Math.max(0, Math.floor(Number(options?.cooldownMs || 0)));
    const keepPendingMs = Math.max(0, Math.floor(Number(options?.keepPendingMs || 0)));
    const queueDelayMs = Math.max(0, Math.floor(Number(options?.queueDelayMs || 0)));
    const maxQueueDepth = Math.max(1, Math.floor(Number(options?.maxQueueDepth || MASTER_REPEATABLE_ACTION_MAX_QUEUE_DEPTH)));

    const markPending = () => {
      if (pendingMasterActionIdsRef.current.has(actionId)) return;
      pendingMasterActionIdsRef.current.add(actionId);
      setPendingMasterActionIds((current) => current.includes(actionId) ? current : [...current, actionId]);
    };

    const releasePending = () => {
      pendingMasterActionIdsRef.current.delete(actionId);
      setPendingMasterActionIds((current) => current.filter((id) => id !== actionId));
    };

    const releasePendingAfterDelay = () => {
      if (keepPendingMs > 0) {
        setTimeout(releasePending, keepPendingMs);
      } else {
        releasePending();
      }
    };

    const executeTask = async (executionMode: 'drop' | 'queue') => {
      const startedAt = Date.now();
      masterActionLastAcceptedAtRef.current.set(actionId, startedAt);
      traceApp('BUTTON_PRESS', executionMode === 'queue' ? 'ACTION_SUBMIT_QUEUE_ITEM_STARTED' : 'ACTION_SUBMIT_STARTED', {
        screen: 'lan-session',
        source: 'runMasterAction',
        sessionId: activeSessionId,
        actionId,
        mode: executionMode,
        cooldownMs,
        keepPendingMs,
        queueDelayMs,
      });
      try {
        await task();
        traceApp('BUTTON_PRESS', executionMode === 'queue' ? 'ACTION_SUBMIT_QUEUE_ITEM_DONE' : 'ACTION_SUBMIT_DONE', {
          screen: 'lan-session',
          source: 'runMasterAction',
          sessionId: activeSessionId,
          actionId,
          mode: executionMode,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        traceError('BUTTON_PRESS', executionMode === 'queue' ? 'ACTION_SUBMIT_QUEUE_ITEM_FAILED' : 'ACTION_SUBMIT_FAILED', error, {
          screen: 'lan-session',
          source: 'runMasterAction',
          sessionId: activeSessionId,
          actionId,
          mode: executionMode,
        });
        throw error;
      } finally {
        if (queueDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, queueDelayMs));
        }
      }
    };

    if (mode === 'queue') {
      if (isEndingSession) {
        traceApp('BUTTON_PRESS', 'ACTION_SUBMIT_IGNORED_SESSION_ENDING', {
          screen: 'lan-session',
          source: 'runMasterAction',
          sessionId: activeSessionId,
          actionId,
          mode,
        });
        return;
      }

      const currentDepth = masterActionQueueDepthRef.current.get(actionId) || 0;
      if (currentDepth >= maxQueueDepth) {
        traceApp('BUTTON_PRESS', 'ACTION_SUBMIT_QUEUE_FULL', {
          screen: 'lan-session',
          source: 'runMasterAction',
          sessionId: activeSessionId,
          actionId,
          mode,
          queueDepth: currentDepth,
          maxQueueDepth,
          decision: 'ignore_new_click_for_same_action_entity_only',
        });
        return;
      }

      markPending();
      masterActionQueueDepthRef.current.set(actionId, currentDepth + 1);
      const previous = masterActionQueuesRef.current.get(actionId) || Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(() => executeTask('queue'));

      masterActionQueuesRef.current.set(actionId, queued);
      traceApp('BUTTON_PRESS', 'ACTION_SUBMIT_QUEUED', {
        screen: 'lan-session',
        source: 'runMasterAction',
        sessionId: activeSessionId,
        actionId,
        mode,
        queueDelayMs,
        queueDepth: currentDepth + 1,
        maxQueueDepth,
      });

      const cleanup = () => {
        const nextDepth = Math.max(0, (masterActionQueueDepthRef.current.get(actionId) || 1) - 1);
        if (nextDepth > 0) {
          masterActionQueueDepthRef.current.set(actionId, nextDepth);
        } else {
          masterActionQueueDepthRef.current.delete(actionId);
        }
        if (masterActionQueuesRef.current.get(actionId) !== queued) return;
        masterActionQueuesRef.current.delete(actionId);
        releasePendingAfterDelay();
      };
      queued.then(cleanup, cleanup);
      return queued;
    }

    const now = Date.now();
    const lastAcceptedAt = masterActionLastAcceptedAtRef.current.get(actionId) || 0;
    if (cooldownMs > 0 && now - lastAcceptedAt < cooldownMs) {
      traceApp('BUTTON_PRESS', 'ACTION_SUBMIT_IGNORED_COOLDOWN', {
        screen: 'lan-session',
        source: 'runMasterAction',
        sessionId: activeSessionId,
        actionId,
        cooldownMs,
        elapsedMs: now - lastAcceptedAt,
      });
      return;
    }

    if (isEndingSession || pendingMasterActionIdsRef.current.has(actionId)) {
      traceApp('BUTTON_PRESS', 'ACTION_SUBMIT_IGNORED_ALREADY_PENDING', {
        screen: 'lan-session',
        source: 'runMasterAction',
        sessionId: activeSessionId,
        actionId,
        isEndingSession,
      });
      return;
    }

    markPending();
    try {
      await executeTask('drop');
    } finally {
      releasePendingAfterDelay();
    }
  }, [activeSessionId, isEndingSession]);
  const selectedPlayer = useMemo(
    () => sessionState?.players.find((player) => player.id === selectedPlayerId) || sessionState?.players[0],
    [selectedPlayerId, sessionState?.players]
  );

  useFocusEffect(
    useCallback(() => {
      traceScreen('lan-session', 'LAN_SESSION_SCREEN_FOCUS', {
        source: 'LanSessionScreen',
        sessionId: activeSessionId,
        joinUrl,
        playerCount: sessionStateRef.current?.players.length || 0,
      });
    }, [activeSessionId, joinUrl])
  );

  useEffect(() => {
    sessionStateRef.current = sessionState;
    if (activeSessionId && !getLanProjection(activeSessionId)) {
      replaceLanRuntimeStateFromBootstrap(activeSessionId, sessionState);
    }
  }, [activeSessionId, sessionState]);

  useEffect(() => {
    if (!activeSessionId) {
      setLanProjection(null);
      return;
    }
    setLanProjection(getLanProjection(activeSessionId));
    return subscribeLanProjection(activeSessionId, (projection) => {
      setLanProjection(projection);
      if (!projection) return;
      const nextState = mergeLanProjectionIntoSessionState(projection, sessionStateRef.current);
      sessionStateRef.current = nextState;
      setSessionState(nextState);
      setPayload((current) => {
        if (!current || current.session.id !== activeSessionId) return current;
        return { ...current, state: nextState };
      });
    });
  }, [activeSessionId]);

  /** @deprecated Corte 6: lock de runtime legado virou no-op; projection/engine é a fonte viva. */
  const holdLiveRuntimeLock = useCallback((reason: string, durationMs = 12000) => {
    debugLanFlow('MASTER_LIVE_RUNTIME_LOCK_DEPRECATED_NOOP_CUT6', {
      sessionId: activeSessionId,
      reason,
      durationMs,
      decision: 'engine_projection_is_authoritative',
    });
  }, [activeSessionId]);

  const applyExternalSessionState = useCallback((
    sessionId: string,
    incomingState: LanSessionState | null | undefined,
    source: 'sqlite' | 'snapshot' | 'runtime' = 'sqlite',
  ) => {
    if (!incomingState) {
      if (getLanProjection(sessionId)) {
        debugLanFlow('MASTER_EXTERNAL_STATE_NULL_SKIPPED_PROJECTION_SOURCE_CUT6', {
          sessionId,
          source,
          decision: 'projection_preserved',
        });
        return sessionStateRef.current;
      }
      sessionStateRef.current = null;
      setSessionState(null);
      return null;
    }

    const projection = getLanProjection(sessionId);
    if (projection && source !== 'runtime') {
      const projectedState = mergeLanProjectionIntoSessionState(projection, sessionStateRef.current || incomingState);
      sessionStateRef.current = projectedState;
      setSessionState(projectedState);
      debugLanFlow('MASTER_EXTERNAL_STATE_SKIPPED_PROJECTION_SOURCE_CUT6', {
        sessionId,
        source,
        playerCount: projectedState.players.length,
        currentTurn: projectedState.currentTurn,
        elapsedMinutes: projectedState.elapsedMinutes,
        status: projectedState.status,
        decision: 'sqlite_snapshot_payload_cannot_override_projection',
      });
      return projectedState;
    }

    traceStateChange('STATE_VERSION_COMPARE', 'MASTER_EXTERNAL_STATE_MERGE_START', {
      playerCount: sessionStateRef.current?.players.length || 0,
      currentTurn: sessionStateRef.current?.currentTurn,
      elapsedMinutes: sessionStateRef.current?.elapsedMinutes,
    }, {
      playerCount: incomingState.players.length,
      currentTurn: incomingState.currentTurn,
      elapsedMinutes: incomingState.elapsedMinutes,
    }, {
      screen: 'lan-session',
      source,
      sessionId,
      decision: 'merge_preserving_live_fields',
    });
    const merged = mergeSessionStatePreservingLiveFields(sessionStateRef.current, incomingState, sessionId, source);
    if (merged === sessionStateRef.current) {
      traceStateChange('STATE_CHANGE', 'MASTER_EXTERNAL_STATE_MERGE_NOOP', incomingState, merged, {
        screen: 'lan-session',
        source,
        sessionId,
        decision: 'no_real_change',
      });
      return merged;
    }
    sessionStateRef.current = merged;
    setSessionState(merged);
    traceStateChange('STATE_CHANGE', 'MASTER_EXTERNAL_STATE_MERGE_DONE', incomingState, merged, {
      screen: 'lan-session',
      source,
      sessionId,
      decision: 'merged',
    });
    return merged;
  }, []);

  const applyExternalPayload = useCallback((
    nextPayload: LanSessionPayload | null | undefined,
    source: 'sqlite' | 'snapshot' | 'runtime' = 'snapshot',
  ) => {
    if (!nextPayload) return null;
    traceApp(source === 'snapshot' ? 'SNAPSHOT_RECEIVED' : 'PAYLOAD_RECEIVED', 'MASTER_EXTERNAL_PAYLOAD_RECEIVED', {
      screen: 'lan-session',
      source,
      sessionId: nextPayload.session.id,
      payload: {
        playerCount: nextPayload.state?.players.length || 0,
        eventCount: nextPayload.events?.length || 0,
        currentTurn: nextPayload.state?.currentTurn,
        elapsedMinutes: nextPayload.state?.elapsedMinutes,
      },
    });
    const mergedState = applyExternalSessionState(nextPayload.session.id, nextPayload.state || null, source);
    const mergedPayload = mergedState ? { ...nextPayload, state: mergedState } : nextPayload;
    setPayload((current) => {
      const currentFirstEventId = current?.events?.[0]?.id || '';
      const nextFirstEventId = mergedPayload.events?.[0]?.id || '';
      const sameStructuralPayload = Boolean(
        current &&
        current.session.id === mergedPayload.session.id &&
        current.state === mergedPayload.state &&
        (current.events?.length || 0) === (mergedPayload.events?.length || 0) &&
        currentFirstEventId === nextFirstEventId
      );
      return sameStructuralPayload ? current : mergedPayload;
    });
    traceApp(source === 'snapshot' ? 'SNAPSHOT_APPLIED' : 'PAYLOAD_APPLIED', 'MASTER_EXTERNAL_PAYLOAD_APPLIED', {
      screen: 'lan-session',
      source,
      sessionId: nextPayload.session.id,
      decision: 'structural_merge_preserving_live_fields',
      payload: {
        playerCount: mergedPayload.state?.players.length || 0,
        eventCount: mergedPayload.events?.length || 0,
      },
    });
    return mergedPayload;
  }, [applyExternalSessionState]);

  const scheduleSilentPayloadRefresh = useCallback((
    sessionId: string,
    options?: { broadcast?: boolean; immediate?: boolean },
  ) => {
    if (!sessionId) return;
    if (silentPayloadRefreshTimerRef.current) {
      clearTimeout(silentPayloadRefreshTimerRef.current);
    }

    const shouldBroadcast = Boolean(options?.broadcast);
    const delayMs = options?.immediate ? 50 : 250;

    silentPayloadRefreshTimerRef.current = setTimeout(() => {
      silentPayloadRefreshTimerRef.current = null;
      void (async () => {
        try {
          traceApp('POLLING_TICK', 'MASTER_SILENT_PAYLOAD_REFRESH_TICK', {
            screen: 'lan-session',
            source: 'scheduleSilentPayloadRefresh',
            sessionId,
          });
          const nextPayload = await syncLanSessionPayload(db, sessionId, { broadcast: shouldBroadcast });
          if (!nextPayload || activeSessionId !== sessionId) return;
          applyExternalPayload(nextPayload, 'sqlite');
        } catch (error) {
          console.warn('[LAN MASTER] Falha ao recalcular payload silencioso:', error);
        }
      })();
    }, delayMs);
  }, [activeSessionId, applyExternalPayload, db]);

  useEffect(() => () => {
    if (silentPayloadRefreshTimerRef.current) {
      clearTimeout(silentPayloadRefreshTimerRef.current);
      silentPayloadRefreshTimerRef.current = null;
    }
    Object.values(tempHpEffectSilentSyncTimersRef.current).forEach((timer) => clearTimeout(timer));
    tempHpEffectSilentSyncTimersRef.current = {};
    pendingTempHpEffectSilentSyncRef.current = {};
  }, []);

  const getPlayerRevision = useCallback(async (playerId: number) => {
    const row = await db.getFirstAsync<{ revisionSeq?: number }>(
      `SELECT COALESCE(revision_seq, 0) as revisionSeq FROM lan_session_players WHERE id = ?`,
      [playerId]
    );
    return Math.max(0, Math.floor(Number(row?.revisionSeq || 0)));
  }, [db]);


  const summarizePlayerPublicEffects = useCallback((effects: LanSessionPlayerState['effects'] | undefined) => (
    (effects || [])
      .filter((effect) => effect.visibleToPlayer !== false)
      .filter((effect) => {
        const target = String(effect.target || '').toUpperCase();
        const permanent = Boolean(effect.isPermanent || String(effect.unit || '').toLowerCase() === 'permanent');
        // Mostra condições, PV temporário e também buffs temporários de atributo.
        // Buff permanente de atributo continua oculto da lista de efeitos para não duplicar a ficha.
        return !(permanent && PERMANENT_STAT_TARGETS.includes(target as any) && effect.kind !== 'hp' && effect.kind !== 'temp_hp');
      })
      .map((effect) => ({
        id: effect.id,
        name: effect.name || effect.status || effect.statusKey || 'Efeito',
        status: effect.status,
        statusKey: effect.statusKey,
        target: effect.target,
        value: effect.value,
        kind: effect.kind,
        source: effect.source,
        remaining: effect.remaining,
        unit: effect.unit,
        color: effect.color,
        secondaryColor: effect.secondaryColor,
        publicNote: effect.publicNote,
      }))
  ), []);

  const sendPublicPlayerStatus = useCallback(async (
    sessionId: string,
    player: LanSessionPlayerState,
    reason: string,
    numberPatch?: NumberPatch,
  ) => {
    const playerKey = player.remoteKey || '';
    if (!joinUrl || !sessionId || !playerKey) return null;

    const pendingKey = `${sessionId}:${playerKey}`;
    pendingPublicStatusRef.current[pendingKey] = { sessionId, player, reason, numberPatch };
    if (publicStatusTimersRef.current[pendingKey]) {
      clearTimeout(publicStatusTimersRef.current[pendingKey]);
    }

    const isLiveFastStatus = Boolean(numberPatch) || /effect|inventory|trade|send_item|coin|xp|temp/i.test(String(reason || ''));
    const publicStatusDelayMs = isLiveFastStatus ? 0 : 80;
    publicStatusTimersRef.current[pendingKey] = setTimeout(() => {
      const pending = pendingPublicStatusRef.current[pendingKey];
      delete pendingPublicStatusRef.current[pendingKey];
      delete publicStatusTimersRef.current[pendingKey];
      if (!pending) return;

      const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.remoteKey === playerKey) || pending.player;
      const latestPatch = pending.numberPatch;
      const hpCurrent = Math.max(0, Math.floor(Number(latestPatch?.hpCurrent ?? latestPlayer.hpCurrent) || 0));
      const hpMax = Math.max(0, Math.floor(Number(latestPatch?.hpMax ?? latestPlayer.hpMax) || 0));
      const tempHp = Math.max(0, Math.floor(Number(latestPatch?.tempHp ?? latestPlayer.tempHp) || 0));
      const seq = Date.now();
      const event: LanSessionEvent = {
        id: makeLanEventId(),
        sessionId: pending.sessionId,
        seq,
        serverSeq: seq,
        type: 'public_status',
        fromKey: playerKey,
        fromName: latestPlayer.characterName,
        toKey: 'session',
        toName: 'session',
        entityType: 'public_status',
        entityId: playerKey,
        entityRevision: seq,
        ackRequired: false,
        originClientId: 'master',
        publicState: {
          hpCurrent,
          hpMax,
          tempHp,
          level: latestPlayer.level,
          stats: latestPlayer.stats,
          effectiveStats: buildMasterEffectiveStats(latestPlayer),
          equipment: normalizeHostEquipment(latestPlayer.equipment),
          effects: summarizePlayerPublicEffects(latestPlayer.effects),
        },
        message: `${latestPlayer.characterName} atualizou status publico (${pending.reason}).`,
        createdAt: new Date().toISOString(),
      };

      void sendLanSessionEvent(joinUrl, event)
        .then(() => {
          debugLanFlow('MASTER_PUBLIC_STATUS_SENT', {
            sessionId: pending.sessionId,
            playerKey,
            reason: pending.reason,
            hpCurrent,
            hpMax,
            tempHp,
            effectCount: event.publicState?.effects?.length || 0,
            coalesced: true,
          });
        })
        .catch((error) => {
          debugLanFlow('MASTER_PUBLIC_STATUS_SEND_FAILED', {
            sessionId: pending.sessionId,
            playerKey,
            reason: pending.reason,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, publicStatusDelayMs);

    return null;
  }, [joinUrl, summarizePlayerPublicEffects]);


  const applyProgressionPatchRuntimeFirst = useCallback(async (
    event: LanSessionEvent,
    source = 'progression_patch_runtime_first',
  ) => {
    if (!payload?.session?.id || !event?.progressionPatch) return false;
    const sessionId = payload.session.id;
    holdLiveRuntimeLock(`level_up:${source}`, 22000);
    const patch = event.progressionPatch;
    const fromKey = String(event.fromKey || event.entityId || '').trim();
    const fromName = String(event.fromName || '').trim();
    const currentState = sessionStateRef.current;
    const currentPlayer = currentState?.players.find((entry) => (
      (fromKey && entry.remoteKey === fromKey) ||
      (fromName && entry.characterName === fromName) ||
      (event.toKey && entry.remoteKey === event.toKey)
    ));
    if (!currentState || !currentPlayer) {
      debugLanFlow('MASTER_LEVEL_UP_RUNTIME_FIRST_PLAYER_NOT_FOUND_V89', {
        sessionId,
        eventId: event.id,
        fromKey,
        fromName,
        source,
      });
      return false;
    }

    const inferLevelFromClassLabel = (value: unknown) => {
      const matches = String(value || '').match(/\b\d+\b/g) || [];
      return matches.reduce((total, item) => total + Math.max(0, Math.floor(Number(item) || 0)), 0);
    };
    const currentLevel = Math.max(
      1,
      Math.floor(Number(currentPlayer.level || 1) || 1),
      inferLevelFromClassLabel(currentPlayer.className)
    );
    const incomingClassName = String(patch.className || currentPlayer.className || '').trim();
    const incomingLevel = Math.max(
      1,
      Math.floor(Number(patch.level || 0) || 0),
      inferLevelFromClassLabel(incomingClassName)
    );
    const currentXp = Math.max(0, Math.floor(Number(currentPlayer.xp || 0) || 0));
    // v92: level-up nao pode depender de leitura SQLite durante evento vivo.
    // A autorizacao aqui protege regressao/race change, mas aceita imediatamente progressao local.
    const expectedLevel = Math.max(currentLevel, Math.floor(Number(patch.level || 0) || 0), inferLevelFromClassLabel(patch.className));

    const incomingRace = String(patch.race || currentPlayer.race || '').trim();
    const currentRace = String(currentPlayer.race || '').trim();
    const raceChanged = Boolean(incomingRace && currentRace && incomingRace !== currentRace);
    const incomingHpMax = Math.max(0, Math.floor(Number(patch.hpMax || 0) || 0));
    const hasProgressionShape =
      incomingLevel > currentLevel ||
      incomingHpMax > Math.max(0, Math.floor(Number(currentPlayer.hpMax || 0) || 0)) ||
      (incomingClassName && incomingClassName !== String(currentPlayer.className || '').trim());
    const authorized = hasProgressionShape && !raceChanged && incomingLevel >= currentLevel && incomingLevel <= Math.max(expectedLevel, currentLevel);

    debugLanFlow('MASTER_LEVEL_UP_RUNTIME_FIRST_CHECK_V89', {
      sessionId,
      eventId: event.id,
      playerId: currentPlayer.id,
      fromKey,
      fromName,
      currentLevel,
      incomingLevel,
      currentXp,
      expectedLevel,
      incomingHpMax,
      raceChanged,
      hasProgressionShape,
      authorized,
      source,
    });

    if (!authorized) return false;

    const nextHpMax = Math.max(
      Math.max(0, Math.floor(Number(currentPlayer.hpMax || 0) || 0)),
      incomingHpMax
    );
    const incomingHpCurrent = Math.max(0, Math.floor(Number(patch.hpCurrent || 0) || 0));
    const nextHpCurrent = Math.max(
      0,
      Math.min(
        Math.max(nextHpMax, 1),
        Math.max(Math.floor(Number(currentPlayer.hpCurrent || 0) || 0), incomingHpCurrent)
      )
    );

    const numberResult = applyHostNumberPatchRuntime(
      sessionId,
      currentState,
      currentPlayer.id,
      { hpCurrent: nextHpCurrent, hpMax: nextHpMax },
      'runtime'
    );
    const baseState = numberResult?.state || currentState;
    const basePlayer = numberResult?.player || currentPlayer;
    const currentSnapshot = (basePlayer.characterSnapshot && typeof basePlayer.characterSnapshot === 'object')
      ? basePlayer.characterSnapshot as Record<string, unknown>
      : {};
    const nextSnapshot = {
      ...currentSnapshot,
      ...(patch.characterSnapshot || {}),
      level: incomingLevel,
      class: incomingClassName || basePlayer.className,
      race: incomingRace || basePlayer.race,
      hp_max: nextHpMax,
      hp_current: nextHpCurrent,
      xp: currentXp,
      gp: basePlayer.gp,
      sp: basePlayer.sp,
      cp: basePlayer.cp,
    };
    const cleanPlayerRevision = (value: unknown) => {
      const revision = Math.max(0, Math.floor(Number(value || 0) || 0));
      return revision > 1000000 ? 0 : revision;
    };
    const currentCleanRevision = Math.max(
      cleanPlayerRevision(currentPlayer.revisionSeq),
      cleanPlayerRevision(basePlayer.revisionSeq),
      cleanPlayerRevision(numberResult?.revision),
      cleanPlayerRevision((patch as any).revisionSeq),
      cleanPlayerRevision(event.entityRevision),
    );
    // v95: level-up/rejoin usa seq temporal, mas revisionSeq de player precisa
    // continuar pequena e monotônica. Nunca carregue Date.now() para revisionSeq,
    // senão a ficha privada passa a competir com snapshots/checkpoints temporais.
    const nextProgressionRevision = Math.max(1, currentCleanRevision + 1);
    const nextPlayer: LanSessionPlayerState = {
      ...basePlayer,
      level: incomingLevel,
      className: incomingClassName || basePlayer.className,
      race: incomingRace || basePlayer.race,
      hpCurrent: nextHpCurrent,
      hpMax: nextHpMax,
      stats: (patch.stats as LanSessionPlayerState['stats']) || basePlayer.stats,
      characterSnapshot: nextSnapshot as LanSessionPlayerState['characterSnapshot'],
      revisionSeq: nextProgressionRevision,
    };
    const nextState: LanSessionState = {
      ...baseState,
      players: baseState.players.map((entry) => entry.id === currentPlayer.id ? nextPlayer : entry),
    };

    sessionStateRef.current = nextState;
    setSessionState(nextState);
    setPayload((current) => current ? ({ ...current, state: nextState }) : current);
    setInventoryModalPlayer((current) => current?.remoteKey === nextPlayer.remoteKey ? nextPlayer : current);
    setDetailPlayer((current) => current?.remoteKey === nextPlayer.remoteKey ? nextPlayer : current);
    void sendPublicPlayerStatus(sessionId, nextPlayer, source, {
      hpCurrent: nextPlayer.hpCurrent,
      hpMax: nextPlayer.hpMax,
      tempHp: nextPlayer.tempHp,
      xp: nextPlayer.xp,
      gp: nextPlayer.gp,
      sp: nextPlayer.sp,
      cp: nextPlayer.cp,
    });

    // v95: eco autoritativo para a ficha do jogador.
    // IMPORTANTE: seq/serverSeq continuam temporais, mas entityRevision NAO pode
    // usar Date.now(), event.seq ou event.entityRevision do join/level-up.
    // A revision correta do agregado e a revisionSeq pequena do player no mestre.
    const authoritativePlayerRevision = Math.max(1, cleanPlayerRevision(nextPlayer.revisionSeq));

    const echoToKey = String(nextPlayer.remoteKey || '');
    if (joinUrl && echoToKey) {
      const echoSeq = Date.now();
      const echoEvent: LanSessionEvent = {
        id: makeLanEventId(),
        sessionId,
        seq: echoSeq,
        serverSeq: echoSeq,
        type: 'player_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: echoToKey,
        toName: nextPlayer.characterName || nextPlayer.playerName || 'Jogador',
        entityType: 'player',
        entityId: echoToKey,
        entityRevision: authoritativePlayerRevision,
        ackRequired: true,
        originClientId: 'master',
        numberPatch: {
          hpCurrent: nextPlayer.hpCurrent,
          hpMax: nextPlayer.hpMax,
          tempHp: nextPlayer.tempHp,
          xp: nextPlayer.xp,
          gp: nextPlayer.gp,
          sp: nextPlayer.sp,
          cp: nextPlayer.cp,
        },
        progressionPatch: {
          revisionSeq: authoritativePlayerRevision,
          level: nextPlayer.level,
          className: nextPlayer.className,
          race: nextPlayer.race,
          hpCurrent: nextPlayer.hpCurrent,
          hpMax: nextPlayer.hpMax,
          stats: nextPlayer.stats as Record<string, unknown>,
          characterSnapshot: nextSnapshot as Record<string, unknown>,
        },
        statsPatch: nextPlayer.stats as Record<string, unknown>,
        numberPatchIntent: 'level_up_authoritative_echo',
        message: `${nextPlayer.characterName} sincronizado apos subir de nivel.`,
        createdAt: new Date(echoSeq).toISOString(),
      };
      void sendLanSessionEvent(joinUrl, echoEvent)
        .then(() => debugLanFlow('MASTER_LEVEL_UP_AUTHORITATIVE_ECHO_SENT_V95', {
          sessionId,
          playerId: nextPlayer.id,
          playerKey: nextPlayer.remoteKey,
          eventId: echoEvent.id,
          hpCurrent: nextPlayer.hpCurrent,
          hpMax: nextPlayer.hpMax,
          level: nextPlayer.level,
        }))
        .catch((error) => debugLanFlow('MASTER_LEVEL_UP_AUTHORITATIVE_ECHO_ERROR_V95', {
          sessionId,
          playerId: nextPlayer.id,
          playerKey: nextPlayer.remoteKey,
          reason: error instanceof Error ? error.message : String(error),
        }));
      void rememberLanSessionEvent(db, echoEvent).catch(() => {});
    }

    debugLanFlow('MASTER_LEVEL_UP_RUNTIME_FIRST_APPLIED_V94', {
      sessionId,
      eventId: event.id,
      playerId: nextPlayer.id,
      remoteKey: nextPlayer.remoteKey,
      level: nextPlayer.level,
      className: nextPlayer.className,
      hpCurrent: nextPlayer.hpCurrent,
      hpMax: nextPlayer.hpMax,
      source,
    });
    return true;
  }, [db, holdLiveRuntimeLock, joinUrl, payload?.session?.id, sendPublicPlayerStatus]);

  const sendLiveEventToClients = useCallback(async (event: LanSessionEvent | null | undefined) => {
    if (!event || !joinUrl) return false;

    if (['player_patch', 'effect_patch', 'inventory_patch', 'player_progression_patch', 'session_patch'].includes(String(event.type || ''))) {
      holdLiveRuntimeLock(`send_live_event:${event.type}`, event.type === 'player_progression_patch' ? 22000 : 12000);
    }

    try {
      await sendLanSessionEvent(joinUrl, event);
      debugLanFlow('MASTER_EVENT_SENT', {
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        toKey: event.toKey,
      });
      setSessionEvents((current) => mergeMasterTimelineEvent(current, event));
      return true;
    } catch (error) {
      console.warn('[LAN MASTER] Falha ao enviar evento vivo:', {
        type: event.type,
        id: event.id,
        toKey: event.toKey,
        error,
      });
      return false;
    }
  }, [holdLiveRuntimeLock, joinUrl]);

  const sendLatestLiveEvent = useCallback(async (
    sessionId: string,
    predicate: (event: LanSessionEvent) => boolean,
  ) => {
    const events = await getLanSessionEvents(db, sessionId, 40);
    const event = events.find(predicate);
    if (event) {
      debugLanFlow('MASTER_EVENT_CREATED', {
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
      });
      await sendLiveEventToClients(event);
    }
    return event || null;
  }, [db, sendLiveEventToClients]);

  const sendRecentLiveEvents = useCallback(async (
    sessionId: string,
    predicate: (event: LanSessionEvent) => boolean,
  ) => {
    const events = await getLanSessionEvents(db, sessionId, 40);
    const selected = events.filter(predicate).slice(0, 20).reverse();
    for (const event of selected) {
      await sendLiveEventToClients(event);
    }
  }, [db, sendLiveEventToClients]);

  const applyAndSendEffectResult = useCallback(async (
    sessionId: string,
    result: { targetKey?: string; patch?: NonNullable<LanSessionEvent['effectPatch']>; event?: LanSessionEvent | null } | null | undefined,
  ) => {
    if (!result?.targetKey || !result.patch) return null;
    holdLiveRuntimeLock('effect_patch_runtime', 12000);

    const beforeState = sessionStateRef.current;
    const beforePlayer = beforeState?.players.find((entry) => (
      entry.remoteKey === result.targetKey ||
      entry.characterName === result.targetKey ||
      String(entry.id) === result.targetKey
    ));
    const beforeTempHp = Math.max(0, Math.floor(Number(beforePlayer?.tempHp || 0)));
    const beforeTempHpIds = new Set((beforePlayer?.effects || [])
      .filter(isTempHpLanEffectSnapshot)
      .map((effect) => String(effect?.id || ''))
      .filter(Boolean));
    let bundledTempHpNumberPatch: NumberPatch | undefined;

    const runtimeResult = applyHostEffectPatchRuntime(sessionId, beforeState, result.targetKey, result.patch);
    if (runtimeResult) {
      let nextRuntimeState = runtimeResult.state;
      let nextRuntimePlayer = runtimeResult.player;

      const incomingTempHp = (result.patch.add || [])
        .filter(isTempHpLanEffectSnapshot)
        .reduce((max, effect) => Math.max(max, getTempHpLanEffectValue(effect)), 0);
      const removedTempHpEffect = (result.patch.remove || []).some((id) => beforeTempHpIds.has(String(id)));
      const hasTempHpEffectAfter = (runtimeResult.player.effects || []).some((effect) => (
        isTempHpLanEffectSnapshot(effect) && getTempHpLanEffectValue(effect) > 0
      ));
      const nextAuthoritativeTempHp = incomingTempHp > beforeTempHp
        ? incomingTempHp
        : removedTempHpEffect && !hasTempHpEffectAfter && beforeTempHp > 0
          ? 0
          : null;

      if (nextAuthoritativeTempHp != null) {
        const numberRuntimeResult = applyHostNumberPatchRuntime(
          sessionId,
          runtimeResult.state,
          runtimeResult.player.id,
          { tempHp: nextAuthoritativeTempHp }
        );
        if (numberRuntimeResult) {
          nextRuntimeState = numberRuntimeResult.state;
          nextRuntimePlayer = numberRuntimeResult.player;
          bundledTempHpNumberPatch = makeAuthoritativeNumberPatch(numberRuntimeResult.player, numberRuntimeResult.patch);
          void updateLanPlayerNumbers(db, numberRuntimeResult.player.id, numberRuntimeResult.patch, { syncPayload: false }).catch((error) => {
            debugLanFlow('MASTER_TEMP_HP_EFFECT_NUMBER_PATCH_PERSIST_FAILED', {
              sessionId,
              playerId: numberRuntimeResult.player.id,
              playerKey: numberRuntimeResult.player.remoteKey,
              tempHp: nextAuthoritativeTempHp,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      sessionStateRef.current = nextRuntimeState;
      setSessionState(nextRuntimeState);
      setPayload((current) => current ? ({ ...current, state: nextRuntimeState }) : current);
      setInventoryModalPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
      setDetailPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
      const publicPlayer = nextRuntimePlayer.remoteKey
        ? nextRuntimeState.players.find((entry) => entry.remoteKey === nextRuntimePlayer.remoteKey)
        : nextRuntimePlayer;
      if (publicPlayer) void sendPublicPlayerStatus(sessionId, publicPlayer, 'effect_patch');
    }

    let sentEvent: LanSessionEvent | null = null;
    if (result.event) {
      const eventToSend = bundledTempHpNumberPatch
        ? {
            ...result.event,
            numberPatch: bundledTempHpNumberPatch,
            numberPatchIntent: inferNumberPatchIntent(bundledTempHpNumberPatch),
            entityType: result.event.entityType || 'effect',
            entityId: result.event.entityId || result.targetKey,
          }
        : result.event;
      await sendLiveEventToClients(eventToSend);
      sentEvent = eventToSend;
    } else {
      sentEvent = await sendLatestLiveEvent(sessionId, (event) => (
        event.type === 'effect_patch' && event.toKey === result.targetKey
      ));
    }

    return sentEvent;
  }, [db, holdLiveRuntimeLock, sendLatestLiveEvent, sendLiveEventToClients, sendPublicPlayerStatus]);

  const rememberSentEventInTimeline = useCallback((event: LanSessionEvent | null | undefined) => {
    if (!event) return;
    setSessionEvents((current) => mergeMasterTimelineEvent(current, event));
  }, []);

  const getPlayerEngineKey = useCallback((player: LanSessionPlayerState | null | undefined) => {
    if (!player || !activeSessionId) return '';
    if (player.remoteKey) return player.remoteKey;
    const projection = lanProjection || getLanProjection(activeSessionId);
    const match = Object.values(projection?.players || {}).find((entry) => (
      String(entry.characterId || '') === String(player.sourceCharacterId || player.characterId || player.id || '') ||
      entry.name === player.characterName
    ));
    return match?.playerKey || makeLanCharacterKey(activeSessionId, {
      id: player.sourceCharacterId || player.characterId || player.id,
      name: player.characterName,
    });
  }, [activeSessionId, lanProjection]);

  const applyProjectionToMasterUi = useCallback((projection: SessionProjection | null | undefined) => {
    if (!projection) return null;
    setLanProjection(projection);
    const nextState = mergeLanProjectionIntoSessionState(projection, sessionStateRef.current);
    applyRuntimeStateToUiAndTransport(nextState);
    setInventoryModalPlayer((current) => {
      if (!current) return current;
      return nextState.players.find((entry) => entry.id === current.id || entry.remoteKey === current.remoteKey) || current;
    });
    setDetailPlayer((current) => {
      if (!current) return current;
      return nextState.players.find((entry) => entry.id === current.id || entry.remoteKey === current.remoteKey) || current;
    });
    setEffectListModalPlayer((current) => {
      if (!current) return current;
      return nextState.players.find((entry) => entry.id === current.id || entry.remoteKey === current.remoteKey) || current;
    });
    return nextState;
  }, [applyRuntimeStateToUiAndTransport]);

  const dispatchMasterEngineCommand = useCallback((
    command: LanCommand,
    options?: {
      targetPlayer?: LanSessionPlayerState | null;
      message?: string;
      hostInstanceId?: string;
      persistEvent?: boolean;
      sendEvent?: boolean;
    },
  ) => {
    if (endingSessionRef.current && command.type !== 'end_session') return null;
    traceApp('EVENT_CREATED', 'MASTER_COMMAND_DISPATCHED_TO_ENGINE', {
      screen: 'lan-session',
      source: 'dispatchMasterEngineCommand',
      sessionId: command.sessionId,
      commandType: command.type,
      commandId: command.commandId,
      targetKey: 'targetKey' in command ? command.targetKey : undefined,
    });

    if (!getLanProjection(command.sessionId) && payload?.session.id === command.sessionId) {
      applyIncomingSnapshot(legacyPayloadToLanSnapshot(payload, {
        source: 'bootstrap',
        structural: true,
        snapshotSeq: Date.now(),
      }));
    }

    const result = dispatchMasterCommand(command);
    applyProjectionToMasterUi(result.projection);
    const liveEvent = authoritativeEventToLanSessionEvent(result.event, {
      targetPlayer: options?.targetPlayer,
      message: options?.message,
      hostInstanceId: options?.hostInstanceId || payload?.session.hostInstanceId,
    });

    if (liveEvent) {
      rememberSentEventInTimeline(liveEvent);
      if (options?.sendEvent !== false) {
        void sendLanSessionEvent(joinUrl, liveEvent).catch((error) => {
          debugLanFlow('MASTER_ENGINE_EVENT_SEND_FAILED', {
            sessionId: command.sessionId,
            commandType: command.type,
            commandId: command.commandId,
            eventId: liveEvent.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
      }
      if (options?.persistEvent !== false) {
        void rememberLanSessionEvent(db, liveEvent).catch(() => false);
      }
      debugLanFlow('MASTER_ENGINE_EVENT_CREATED', {
        sessionId: command.sessionId,
        commandType: command.type,
        commandId: command.commandId,
        eventId: liveEvent.id,
        eventType: liveEvent.type,
        applied: result.applied,
      });
    }

    return { result, event: liveEvent };
  }, [applyProjectionToMasterUi, db, joinUrl, payload, rememberSentEventInTimeline]);

  const dispatchMasterEffectDraft = useCallback((
    player: LanSessionPlayerState,
    draft: EffectDraft,
    message?: string,
  ) => {
    if (!payload?.session?.id) return null;
    const targetKey = getPlayerEngineKey(player);
    if (!targetKey) return null;
    const isTempHp = draft.target === 'PV_TEMP' || draft.kind === 'temp_hp';
    const commandId = `master_${isTempHp ? 'temp_hp' : 'effect'}:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    if (isTempHp) {
      return dispatchMasterEngineCommand({
        type: 'apply_temp_hp',
        commandId,
        sessionId: payload.session.id,
        actorKey: 'master',
        targetKey,
        amount: Math.max(0, Math.floor(Number(draft.value || 0))),
        duration: {
          value: Math.max(0, Math.floor(Number(draft.remaining || 0))),
          unit: draft.unit as any,
        },
      }, {
        targetPlayer: player,
        message: message || `${draft.name || 'PV temporario'} aplicado em ${player.characterName}.`,
      });
    }
    return dispatchMasterEngineCommand({
      type: 'apply_effect',
      commandId,
      sessionId: payload.session.id,
      actorKey: 'master',
      targetKey,
      effect: effectDraftToEngineEffect(draft, targetKey, commandId),
    }, {
      targetPlayer: player,
      message: message || `${draft.name || 'Efeito'} aplicado em ${player.characterName}.`,
    });
  }, [dispatchMasterEngineCommand, getPlayerEngineKey, payload?.session?.id]);

  const sendOfficialInventoryPatch = useCallback(async (
    sessionId: string,
    player: LanSessionPlayerState,
    reason: string,
    action: NonNullable<LanSessionEvent['inventoryPatch']>['action'] = 'replace',
    sourceClientMsgId?: string,
    options?: {
      itemDelta?: NonNullable<LanSessionEvent['inventoryPatch']>['itemDelta'];
      itemDeltas?: Array<NonNullable<NonNullable<LanSessionEvent['inventoryPatch']>['itemDelta']>>;
      tradeCommit?: NonNullable<LanSessionEvent['inventoryPatch']>['tradeCommit'];
      statsPatch?: Record<string, unknown>;
      ackRequired?: boolean;
      entityRevision?: number;
    },
  ) => {
    const rawProvidedInventoryRevision = Math.max(0, Math.floor(Number(options?.entityRevision || 0)));
    const providedRevision = rawProvidedInventoryRevision > 1000000 ? 0 : rawProvidedInventoryRevision;
    const revisionKey = String(player.remoteKey || player.id || 'player');
    const lastInventoryRevision = Math.max(0, Math.floor(Number(inventoryRevisionByPlayerRef.current[revisionKey] || 0)));
    const entityRevision = providedRevision > 0
      ? Math.max(providedRevision, lastInventoryRevision + 1)
      : lastInventoryRevision + 1;
    inventoryRevisionByPlayerRef.current[revisionKey] = entityRevision;
    const eventId = makeLanEventId();
    const event: LanSessionEvent = {
      id: eventId,
      sessionId,
      type: 'inventory_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: player.remoteKey || '',
      toName: player.characterName,
      entityType: 'inventory',
      entityId: player.remoteKey || String(player.id),
      entityRevision,
      ackRequired: options?.ackRequired ?? true,
      originClientId: 'master',
      sourceClientMsgId,
      inventoryPatch: {
        targetKey: player.remoteKey || '',
        equipment: normalizeHostEquipment(player.equipment),
        itemDelta: options?.itemDelta,
        itemDeltas: options?.itemDeltas,
        tradeCommit: options?.tradeCommit,
        reason,
        action,
        grantId: action === 'grant' ? eventId : undefined,
      },
      statsPatch: options?.statsPatch,
      message: reason,
      createdAt: new Date().toISOString(),
    };

    // Caminho rápido: envio vivo antes de SQLite. Se persistência travar, o jogador
    // ainda recebe o inventário/equipamento no mesmo momento e o histórico fica em memória.
    rememberSentEventInTimeline(event);
    // Não aguarde socket/ACK para liberar o fluxo de troca/doação. O evento já está
    // no histórico em memória e o transporte tem fila priorizada; a persistência vem depois.
    void sendLanSessionEvent(joinUrl, event)
      .then((sent) => {
        debugLanFlow('MASTER_INVENTORY_PATCH_SOCKET_SETTLED', {
          eventId: event.id,
          sessionId,
          playerId: player.id,
          playerKey: player.remoteKey,
          action,
          sent,
        });
      })
      .catch((error) => {
        debugLanFlow('MASTER_INVENTORY_PATCH_SEND_FAILED', {
          eventId: event.id,
          sessionId,
          playerId: player.id,
          playerKey: player.remoteKey,
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    void rememberLanSessionEvent(db, event).catch(() => false);
    // Inventario/equipamento já é enviado pelo inventory_patch. Não envie public_status aqui,
    // pois ele gerava ACKs/eventos extras e podia reativar resync em massa.
    debugLanFlow('MASTER_INVENTORY_PATCH_SENT_FAST', {
      eventId: event.id,
      sessionId,
      playerId: player.id,
      playerKey: player.remoteKey,
      action,
      entityRevision,
      sent: 'queued_non_blocking',
    });
    return event;
  }, [db, joinUrl, rememberSentEventInTimeline]);


  const applyHostInventoryRuntimePatch = useCallback((
    targetKey: string | undefined,
    equipment: unknown,
    statsPatch?: Record<string, unknown>,
  ) => {
    if (!activeSessionId || !sessionStateRef.current || !targetKey) return null;

    const normalizedEquipment = normalizeHostEquipment(equipment);
    const sanitizedStats = statsPatch && typeof statsPatch === 'object'
      ? statsPatch
      : undefined;
    const runtimeResult = applyHostInventoryPatchRuntime(
      activeSessionId,
      sessionStateRef.current,
      targetKey,
      normalizedEquipment,
      sanitizedStats,
      'runtime'
    );

    if (!runtimeResult?.player) return null;
    const patchedPlayer = runtimeResult.player;
    const nextState = runtimeResult.state;

    applyRuntimeStateToUiAndTransport(nextState);
    setInventoryModalPlayer((current) => current?.remoteKey === patchedPlayer.remoteKey ? patchedPlayer : current);
    setDetailPlayer((current) => current?.remoteKey === patchedPlayer.remoteKey ? patchedPlayer : current);

    debugLanFlow('MASTER_INVENTORY_RUNTIME_PATCH_APPLIED', {
      sessionId: activeSessionId,
      targetKey,
      playerId: patchedPlayer.id,
      playerName: patchedPlayer.characterName,
      revisionSeq: patchedPlayer.revisionSeq,
      bagCount: Array.isArray((normalizedEquipment as any).bag) ? (normalizedEquipment as any).bag.length : 0,
      slotKeys: Object.keys((normalizedEquipment as any).slots || {}),
      hasStatsPatch: Boolean(statsPatch),
      decision: 'runtime_marked_as_live_to_prevent_snapshot_flicker',
    });

    return patchedPlayer;
  }, [activeSessionId, applyHostInventoryPatchRuntime, applyRuntimeStateToUiAndTransport]);

  const handleHostCoinSelfPatchEvent = useCallback(async (
    event: LanSessionEvent,
    source: 'realtime' | 'poll' = 'realtime'
  ) => {
    if (!activeSessionId || event.sessionId !== activeSessionId || !event.coinPatchRequest) return false;

    const nativeEventId = String(event.id || '');
    if (nativeEventId) seenNativeHostEventIdsRef.current.add(nativeEventId);

    const coinActionId = `coin:${event.clientMsgId || event.id}`;
    if (processedHostActionIdsRef.current.has(coinActionId)) {
      debugLanFlow('MASTER_COIN_FAST_DUPLICATE_IGNORED', { sessionId: activeSessionId, eventId: event.id, actionId: coinActionId, source });
      return true;
    }

    const targetKey = String(event.coinPatchRequest.targetKey || event.fromKey || '');
    const runtimeState = sessionStateRef.current;
    const runtimePlayer = runtimeState?.players.find((entry) => (
      entry.remoteKey === targetKey || entry.remoteKey === event.fromKey || entry.characterName === event.fromName
    ));
    if (!runtimeState || !runtimePlayer?.remoteKey) {
      debugLanFlow('MASTER_COIN_FAST_REJECTED_NO_PLAYER', { sessionId: activeSessionId, eventId: event.id, targetKey, fromKey: event.fromKey, source });
      return false;
    }

    const currentCoins = sanitizeCoinPatch({ gp: runtimePlayer.gp, sp: runtimePlayer.sp, cp: runtimePlayer.cp });
    const nextCoins = sanitizeCoinPatch({
      gp: event.coinPatchRequest.next?.gp == null ? currentCoins.gp : event.coinPatchRequest.next.gp,
      sp: event.coinPatchRequest.next?.sp == null ? currentCoins.sp : event.coinPatchRequest.next.sp,
      cp: event.coinPatchRequest.next?.cp == null ? currentCoins.cp : event.coinPatchRequest.next.cp,
    });
    const currentTotalCopper = coinPatchToCopper(currentCoins);
    const nextTotalCopper = coinPatchToCopper(nextCoins);
    const requestCurrentTotal = Number(event.coinPatchRequest.currentTotalCopper || 0);
    const opSeq = Math.max(0, Number(event.coinPatchRequest.opSeq || 0));
    const eventAt = Date.parse(String(event.createdAt || '')) || Number(event.seq || event.serverSeq || 0) || Date.now();
    const latest = latestHostCoinMutationRef.current[runtimePlayer.remoteKey] || { opSeq: 0, at: 0, totalCopper: currentTotalCopper };

    if ((opSeq > 0 && opSeq < latest.opSeq) || (opSeq <= 0 && eventAt < latest.at)) {
      processedHostActionIdsRef.current.add(coinActionId);
      debugLanFlow('MASTER_COIN_FAST_STALE_COMMAND_IGNORED', { sessionId: activeSessionId, eventId: event.id, targetKey: runtimePlayer.remoteKey, opSeq, latestOpSeq: latest.opSeq, eventAt, latestAt: latest.at, nextCoins, source });
      return true;
    }

    processedHostActionIdsRef.current.add(coinActionId);
    const reviewRequestEvent: LanSessionEvent = {
      id: String(event.clientMsgId || event.id || makeLanEventId()),
      clientMsgId: String(event.clientMsgId || event.id || makeLanEventId()),
      sessionId: activeSessionId,
      type: 'resource_request',
      fromKey: event.fromKey,
      fromName: event.fromName,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'request',
      entityId: String(event.fromKey || targetKey),
      ackRequired: true,
      resourceRequest: {
        clientRequestId: String(event.clientMsgId || event.id || makeLanEventId()),
        kind: 'coin',
        action: 'set',
        coins: nextCoins,
        message: event.coinPatchRequest.reason || event.message || `${runtimePlayer.characterName} pediu ajuste de moedas.`,
      },
      coinPatchRequest: event.coinPatchRequest,
      message: event.coinPatchRequest.reason || event.message || `${runtimePlayer.characterName} pediu ajuste de moedas.`,
      createdAt: event.createdAt || new Date().toISOString(),
    };

    rememberSentEventInTimeline(reviewRequestEvent);
    void rememberLanSessionEvent(db, reviewRequestEvent).catch(() => false);
    if (getLanProjection(activeSessionId)) {
      const targetEngineKey = getPlayerEngineKey(runtimePlayer);
      dispatchMasterEngineCommand({
        type: 'request_reward',
        commandId: `coin_request:${reviewRequestEvent.clientMsgId || reviewRequestEvent.id}`,
        sessionId: activeSessionId,
        actorKey: String(event.fromKey || targetEngineKey),
        targetKey: targetEngineKey,
        requestId: String(reviewRequestEvent.clientMsgId || reviewRequestEvent.id),
        coins: nextCoins,
        message: reviewRequestEvent.message,
      }, { targetPlayer: runtimePlayer, message: reviewRequestEvent.message, sendEvent: false });
    }
    latestHostCoinMutationRef.current[runtimePlayer.remoteKey] = {
      opSeq: Math.max(latest.opSeq, opSeq),
      at: Math.max(latest.at, eventAt, Date.now()),
      totalCopper: currentTotalCopper,
    };
    scheduleSilentPayloadRefresh(activeSessionId);
    debugLanFlow('MASTER_COIN_SELF_PATCH_CONVERTED_TO_REVIEW_REQUEST', {
      sessionId: activeSessionId,
      eventId: event.id,
      requestEventId: reviewRequestEvent.id,
      targetKey: runtimePlayer.remoteKey,
      currentCoins,
      nextCoins,
      currentTotalCopper,
      nextTotalCopper,
      requestCurrentTotal,
      source,
      decision: 'wait_master_accept',
    });
    return true;
  }, [activeSessionId, db, dispatchMasterEngineCommand, getPlayerEngineKey, rememberSentEventInTimeline, scheduleSilentPayloadRefresh]);

  const handleHostInventoryPatchEvent = useCallback(async (
    event: LanSessionEvent,
    source: 'realtime' | 'poll' = 'realtime'
  ) => {
    if (!activeSessionId || event.sessionId !== activeSessionId || !event.inventoryPatch?.equipment) return false;
    // Eventos oficiais emitidos pelo próprio mestre são confirmação para os jogadores.
    // O host NÃO pode processá-los novamente como comando, senão entra em loop:
    // inventory_patch(master) -> callback do host -> novo inventory_patch(master) -> ...
    if (event.fromKey === 'master' || event.originClientId === 'master') {
      debugLanFlow('MASTER_INVENTORY_AUTHORITATIVE_ECHO_IGNORED', {
        sessionId: activeSessionId,
        eventId: event.id,
        source,
        action: event.inventoryPatch?.action,
        targetKey: event.inventoryPatch?.targetKey || event.toKey,
        decision: 'do_not_reprocess_master_commit',
      });
      return true;
    }
    const nativeEventId = String(event.id || '');
    if (nativeEventId) seenNativeHostEventIdsRef.current.add(nativeEventId);
    const inventoryActionId = `inventory:${event.clientMsgId || event.id}`;
    if (processedHostActionIdsRef.current.has(inventoryActionId)) {
      debugLanFlow('MASTER_INVENTORY_FAST_DUPLICATE_IGNORED', { sessionId: activeSessionId, eventId: event.id, actionId: inventoryActionId, source });
      return true;
    }
    processedHostActionIdsRef.current.add(inventoryActionId);

    const targetKey = event.inventoryPatch.targetKey || event.fromKey;
    const runtimePlayer = applyHostInventoryRuntimePatch(
      targetKey,
      event.inventoryPatch.equipment,
      event.statsPatch && typeof event.statsPatch === 'object' ? event.statsPatch as Record<string, unknown> : undefined,
    );
    if (!runtimePlayer?.remoteKey) {
      debugLanFlow('MASTER_INVENTORY_FAST_NO_PLAYER', { sessionId: activeSessionId, eventId: event.id, targetKey, source });
      return false;
    }

    rememberSentEventInTimeline({ ...event, message: event.inventoryPatch.reason || event.message || `${runtimePlayer.characterName} atualizou o inventario.` });
    void sendOfficialInventoryPatch(
      activeSessionId,
      runtimePlayer,
      event.inventoryPatch.reason || event.message || `${runtimePlayer.characterName} atualizou o inventario.`,
      event.inventoryPatch.action || 'self_update',
      event.clientMsgId || event.id,
      {
        itemDelta: event.inventoryPatch.itemDelta,
        itemDeltas: event.inventoryPatch.itemDeltas?.filter(Boolean) as any,
        tradeCommit: event.inventoryPatch.tradeCommit,
        statsPatch: event.statsPatch && typeof event.statsPatch === 'object'
          ? event.statsPatch as Record<string, unknown>
          : undefined,
        entityRevision: Math.max(1, Number(runtimePlayer.revisionSeq || 0)),
      },
    );
    void sendPublicPlayerStatus(activeSessionId, runtimePlayer, event.inventoryPatch.action || 'inventory_patch');
    void enqueueLanEntityMutation([getLanPlayerQueueKey(activeSessionId, runtimePlayer.remoteKey)], async () => {
      await rememberLanSessionEvent(db, event).catch(() => false);
      const applied = await applyLanPlayerInventoryPatch(db, activeSessionId, event.fromKey, event.inventoryPatch?.equipment || runtimePlayer.equipment, false, event.inventoryPatch?.baseEquipment);
      if (applied && event.statsPatch && typeof event.statsPatch === 'object') {
        const nextStats = sanitizePlayerOwnedStatsPatch(
          runtimePlayer.stats,
          event.statsPatch as Record<string, unknown>,
          {
            allowBaseStats: Boolean(
              event.inventoryPatch?.itemDelta?.mode === 'remove' ||
              event.inventoryPatch?.action === 'remove' ||
              String(event.message || event.inventoryPatch?.reason || '').toLowerCase().includes('consumiu')
            ),
          },
        );
        await updateLanPlayerStats(db, runtimePlayer.id, nextStats, { syncPayload: false });
        // Se o statsPatch mudou CON permanente ou equipamento alterou CON, o runtime
        // já recalculou hpMax/hpCurrent. Persistir evita reload voltar ao HP antigo.
        await updateLanPlayerNumbers(db, runtimePlayer.id, {
          hpMax: runtimePlayer.hpMax,
          hpCurrent: runtimePlayer.hpCurrent,
        }, { syncPayload: false }).catch(() => false);
      }
      scheduleSilentPayloadRefresh(activeSessionId);
    });
    debugLanFlow('MASTER_INVENTORY_FAST_RUNTIME_COMMITTED_DIRECT', { sessionId: activeSessionId, eventId: event.id, targetKey: runtimePlayer.remoteKey, playerName: runtimePlayer.characterName, source, action: event.inventoryPatch.action, decision: 'runtime_first_persist_later' });
    return true;
  }, [activeSessionId, applyHostInventoryRuntimePatch, db, rememberSentEventInTimeline, scheduleSilentPayloadRefresh, sendOfficialInventoryPatch, sendPublicPlayerStatus]);


  const handleHostEffectPatchEventFast = useCallback(async (
    event: LanSessionEvent,
    source: 'realtime' | 'poll' = 'realtime',
  ) => {
    if (!activeSessionId || event.sessionId !== activeSessionId || event.type !== 'effect_patch' || !event.effectPatch) return false;
    if (event.fromKey === 'master' || event.originClientId === 'master') return true;

    const nativeEventId = String(event.id || '');
    if (nativeEventId) seenNativeHostEventIdsRef.current.add(nativeEventId);

    const actionId = `effect:${event.clientMsgId || event.id}`;
    if (processedHostActionIdsRef.current.has(actionId)) {
      debugLanFlow('MASTER_EFFECT_FAST_DUPLICATE_IGNORED', { sessionId: activeSessionId, eventId: event.id, actionId, source });
      return true;
    }
    processedHostActionIdsRef.current.add(actionId);

    const currentState = sessionStateRef.current;
    const targetPlayer = (currentState?.players || []).find((entry) => (
      entry.remoteKey === event.effectPatch?.targetKey ||
      entry.remoteKey === event.fromKey ||
      entry.characterName === event.fromName
    ));
    if (!targetPlayer?.remoteKey) {
      debugLanFlow('MASTER_EFFECT_FAST_NO_PLAYER', { sessionId: activeSessionId, eventId: event.id, source, targetKey: event.effectPatch?.targetKey });
      return false;
    }

    const incomingPatch = event.effectPatch;
    const optimisticRuntime = applyHostEffectPatchRuntime(activeSessionId, currentState, targetPlayer.remoteKey, incomingPatch, 'event');
    if (optimisticRuntime) {
      sessionStateRef.current = optimisticRuntime.state;
      setSessionState(optimisticRuntime.state);
      setPayload((current) => current ? ({ ...current, state: optimisticRuntime.state }) : current);
      setDetailPlayer((current) => current?.remoteKey === optimisticRuntime.player.remoteKey ? optimisticRuntime.player : current);
      void sendPublicPlayerStatus(activeSessionId, optimisticRuntime.player, 'effect_patch_fast_optimistic');
    }

    rememberSentEventInTimeline({ ...event, message: event.message || `${targetPlayer.characterName} aplicou efeito.` });

    const officialPatch: NonNullable<LanSessionEvent['effectPatch']> = {
      targetKey: targetPlayer.remoteKey,
      add: [],
      update: [],
      remove: [],
    };

    await enqueueLanEntityMutation([getLanPlayerQueueKey(activeSessionId, targetPlayer.remoteKey)], async () => {
      await rememberLanSessionEvent(db, event).catch(() => false);

      for (const effectId of incomingPatch.remove || []) {
        const removeResult = await removeLanPlayerEffect(db, targetPlayer.id, String(effectId), { syncPayload: false, recordEvent: false });
        if (removeResult?.patch) {
          officialPatch.remove.push(...(removeResult.patch.remove || []));
          officialPatch.update.push(...((removeResult.patch.update || []) as any[]));
        } else {
          officialPatch.remove.push(String(effectId));
        }
      }

      for (const effect of [...(incomingPatch.add || []), ...(incomingPatch.update || [])]) {
        const sourceId = String((effect as any).sourceId || (effect as any).id || event.clientMsgId || event.id || '');
        const patchEffectResult = await addLanPlayerEffect(db, targetPlayer.id, {
          id: String((effect as any).id || '') || undefined,
          name: String((effect as any).name || event.message || 'Efeito de item'),
          target: ((effect as any).target || 'custom') as LanEffectTarget,
          value: Number((effect as any).value || 0),
          remaining: Number((effect as any).remaining ?? 1),
          unit: ((effect as any).unit || 'rest') as LanEffectUnit,
          isPermanent: Boolean((effect as any).isPermanent || (effect as any).unit === 'permanent'),
          durationText: (effect as any).durationText,
          kind: (effect as any).kind,
          mode: (effect as any).mode,
          status: (effect as any).status,
          statusKey: (effect as any).statusKey || (effect as any).status,
          color: (effect as any).color,
          secondaryColor: (effect as any).secondaryColor,
          source: (effect as any).source || event.fromName,
          sourceType: (effect as any).sourceType || 'item',
          sourceId,
          visibleToPlayer: (effect as any).visibleToPlayer !== false,
          publicNote: (effect as any).publicNote,
          privateNote: (effect as any).privateNote,
          saveDc: (effect as any).saveDc ?? null,
          saveAbility: (effect as any).saveAbility ?? null,
          repeatSave: (effect as any).repeatSave ?? null,
          removableBySave: (effect as any).removableBySave,
          visualPriority: (effect as any).visualPriority,
        } as any, { syncPayload: false, recordEvent: false });

        if (patchEffectResult?.patch) {
          officialPatch.add.push(...((patchEffectResult.patch.add || []) as any[]));
          officialPatch.update.push(...((patchEffectResult.patch.update || []) as any[]));
          officialPatch.remove.push(...(patchEffectResult.patch.remove || []));
        }
      }
    });

    const hasOfficialPatch = Boolean(officialPatch.add.length || officialPatch.update.length || officialPatch.remove.length);
    if (!hasOfficialPatch) return true;

    const runtimeAfterDb = applyHostEffectPatchRuntime(activeSessionId, sessionStateRef.current, targetPlayer.remoteKey, officialPatch, 'runtime');
    const finalPlayer = runtimeAfterDb?.player || (sessionStateRef.current?.players || []).find((entry) => entry.remoteKey === targetPlayer.remoteKey) || targetPlayer;
    if (runtimeAfterDb) {
      sessionStateRef.current = runtimeAfterDb.state;
      setSessionState(runtimeAfterDb.state);
      setPayload((current) => current ? ({ ...current, state: runtimeAfterDb.state }) : current);
      setDetailPlayer((current) => current?.remoteKey === runtimeAfterDb.player.remoteKey ? runtimeAfterDb.player : current);
    }

    const seq = Date.now();
    const officialEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId: activeSessionId,
      seq,
      serverSeq: seq,
      type: 'effect_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetPlayer.remoteKey,
      toName: targetPlayer.characterName,
      entityType: 'effect',
      entityId: targetPlayer.remoteKey,
      entityRevision: runtimeAfterDb?.revision || Math.max(0, Number(targetPlayer.revisionSeq || 0)) + 1,
      ackRequired: true,
      originClientId: 'master',
      sourceClientMsgId: event.clientMsgId || event.id,
      effectPatch: officialPatch,
      message: event.message || `${targetPlayer.characterName} aplicou efeito de item.`,
      createdAt: new Date(seq).toISOString(),
    };

    const committedEvent = await rememberAndSendLanSessionEvent(db, joinUrl, officialEvent);
    rememberSentEventInTimeline(committedEvent || officialEvent);
    if (!committedEvent) void sendLanSessionEvent(joinUrl, officialEvent).catch(() => false);
    void sendPublicPlayerStatus(activeSessionId, finalPlayer, 'effect_patch_fast_commit');
    void syncLanSessionPayload(db, activeSessionId, { broadcast: false }).catch(() => null);
    debugLanFlow('MASTER_EFFECT_FAST_RUNTIME_COMMITTED_DIRECT', { sessionId: activeSessionId, eventId: event.id, targetKey: targetPlayer.remoteKey, source });
    return true;
  }, [activeSessionId, applyHostEffectPatchRuntime, db, joinUrl, rememberSentEventInTimeline, sendPublicPlayerStatus]);

  const sendItemTransferResult = useCallback(async (
    sessionId: string,
    targetKey: string,
    targetName: string,
    requestId: string | undefined,
    accepted: boolean,
    reason: string,
  ) => {
    const event = await rememberAndSendLanSessionEvent(db, joinUrl, {
      id: makeLanEventId(),
      sessionId,
      type: 'send_item_result',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: targetName,
      entityType: 'inventory',
      entityId: requestId || targetKey,
      ackRequired: true,
      originClientId: 'master',
      sendItemResult: {
        requestId,
        status: accepted ? 'accepted' : 'rejected',
        reason,
      },
      message: reason,
      createdAt: new Date().toISOString(),
    });
    return event;
  }, [db, joinUrl]);

  const sendTradeResult = useCallback(async (
    sessionId: string,
    targetKey: string,
    targetName: string,
    tradeId: string | undefined,
    accepted: boolean,
    reason: string,
    options?: {
      tradeCommit?: NonNullable<LanSessionEvent['tradeResult']>['tradeCommit'];
    },
  ) => {
    const event = await rememberAndSendLanSessionEvent(db, joinUrl, {
      id: makeLanEventId(),
      sessionId,
      type: 'trade_result',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: targetName,
      entityType: 'inventory',
      entityId: tradeId || targetKey,
      ackRequired: true,
      originClientId: 'master',
      tradeId,
      tradeResult: {
        tradeId,
        status: accepted ? 'accepted' : 'rejected',
        reason,
        tradeCommit: accepted ? options?.tradeCommit : undefined,
      },
      message: reason,
      createdAt: new Date().toISOString(),
    });
    return event;
  }, [db, joinUrl]);

  const handleHostSendItemRequestFast = useCallback(async (event: LanSessionEvent) => {
    if (!activeSessionId || event.sessionId !== activeSessionId || !event.sendItemRequest) return false;
    const eventId = String(event.id || '');
    if (eventId) seenNativeHostEventIdsRef.current.add(eventId);
    const actionId = `send_item:${event.sendItemRequest.requestId || event.clientMsgId || event.id}`;
    if (processedHostActionIdsRef.current.has(actionId)) {
      debugLanFlow('MASTER_SEND_ITEM_FAST_DUPLICATE_IGNORED', { sessionId: activeSessionId, eventId: event.id, actionId });
      return true;
    }
    const state = sessionStateRef.current;
    const fromKey = String(event.sendItemRequest.fromKey || event.fromKey || '');
    const toKey = String(event.sendItemRequest.toKey || event.toKey || '');
    const sourcePlayer = state?.players.find((entry) => entry.remoteKey === fromKey);
    const targetPlayer = state?.players.find((entry) => entry.remoteKey === toKey);
    const item = event.sendItemRequest.item || event.item;
    const qty = Math.max(1, Number(event.sendItemRequest.qty || item?.qty || 1));
    if (!state || !sourcePlayer?.remoteKey || !targetPlayer?.remoteKey || !item?.name) {
      debugLanFlow('MASTER_SEND_ITEM_FAST_FALLBACK_SQLITE', { sessionId: activeSessionId, eventId: event.id, fromKey, toKey, hasItem: Boolean(item?.name) });
      return false;
    }

    if (getLanProjection(activeSessionId)) {
      const sourceEngineKey = getPlayerEngineKey(sourcePlayer);
      const targetEngineKey = getPlayerEngineKey(targetPlayer);
      const commandId = `send_item:${event.sendItemRequest.requestId || event.clientMsgId || event.id}`;
      const itemInstanceId = String((item as any).id || (item as any).inventoryItemId || (item as any).inventory_item_id || (item as any).stackKey || getInventoryStackKey(item));
      try {
        const engineResult = dispatchMasterEngineCommand({
          type: 'send_item',
          commandId,
          sessionId: activeSessionId,
          actorKey: String(event.fromKey || sourceEngineKey),
          fromKey: sourceEngineKey,
          toKey: targetEngineKey,
          itemInstanceId,
          qty,
          message: event.message || `${event.fromName} enviou ${qty}x ${item.name} para ${targetPlayer.characterName}.`,
        }, {
          targetPlayer,
          message: event.message || `${event.fromName} enviou ${qty}x ${item.name} para ${targetPlayer.characterName}.`,
        });
        processedHostActionIdsRef.current.add(actionId);
        rememberSentEventInTimeline({ ...event, message: engineResult?.event?.message || event.message });
        const projection = engineResult?.result?.projection;
        const projectedSource = projection?.players?.[sourceEngineKey];
        const projectedTarget = projection?.players?.[targetEngineKey];
        void enqueueLanEntityMutation([getLanPlayerQueueKey(activeSessionId, sourcePlayer.remoteKey), getLanPlayerQueueKey(activeSessionId, targetPlayer.remoteKey)], async () => {
          await rememberLanSessionEvent(db, event).catch(() => false);
          if (projectedSource) await updateLanPlayerEquipment(db, sourcePlayer.id, projectedSource.inventory).catch(() => false);
          if (projectedTarget) await updateLanPlayerEquipment(db, targetPlayer.id, projectedTarget.inventory).catch(() => false);
          scheduleSilentPayloadRefresh(activeSessionId);
        });
        const reason = event.message || `${event.fromName} enviou ${qty}x ${item.name} para ${targetPlayer.characterName}.`;
        void sendItemTransferResult(activeSessionId, sourcePlayer.remoteKey, sourcePlayer.characterName, event.sendItemRequest.requestId || event.id, true, reason);
        void sendItemTransferResult(activeSessionId, targetPlayer.remoteKey, targetPlayer.characterName, event.sendItemRequest.requestId || event.id, true, reason);
        debugLanFlow('MASTER_SEND_ITEM_ENGINE_COMMITTED', {
          sessionId: activeSessionId,
          eventId: event.id,
          commandId,
          fromKey: sourceEngineKey,
          toKey: targetEngineKey,
          itemName: item.name,
          qty,
        });
        return true;
      } catch (error) {
        processedHostActionIdsRef.current.add(actionId);
        const reason = error instanceof Error ? error.message : 'Envio cancelado pela engine.';
        void sendItemTransferResult(activeSessionId, sourcePlayer.remoteKey, sourcePlayer.characterName, event.sendItemRequest.requestId || event.id, false, reason);
        void sendItemTransferResult(activeSessionId, targetPlayer.remoteKey, targetPlayer.characterName, event.sendItemRequest.requestId || event.id, false, reason);
        debugLanFlow('MASTER_SEND_ITEM_ENGINE_REJECTED', {
          sessionId: activeSessionId,
          eventId: event.id,
          reason,
        });
        return true;
      }
    }

    const sourceRemoval = removeItemFromHostEquipment(sourcePlayer.equipment, item, qty);
    const clientSourceBefore = event.sendItemRequest.sourceEquipmentBefore
      ? cloneEquipmentForHost(event.sendItemRequest.sourceEquipmentBefore)
      : cloneEquipmentForHost(sourcePlayer.equipment);
    const clientSourceAfter = event.sendItemRequest.sourceEquipmentAfter
      ? cloneEquipmentForHost(event.sendItemRequest.sourceEquipmentAfter)
      : null;
    const clientSnapshotRemovedItem = Boolean(
      clientSourceAfter &&
      getHostItemQty(clientSourceBefore, item) - getHostItemQty(clientSourceAfter, item) >= qty
    );
    const sourceAfter = sourceRemoval.removed
      ? sourceRemoval.equipment
      : clientSnapshotRemovedItem && clientSourceAfter
        ? clientSourceAfter
        : null;
    if (!sourceAfter) {
      processedHostActionIdsRef.current.add(actionId);
      const reason = `${sourcePlayer.characterName} nao possui mais ${qty}x ${item.name}. Envio cancelado.`;
      void sendItemTransferResult(activeSessionId, sourcePlayer.remoteKey, sourcePlayer.characterName, event.sendItemRequest.requestId || event.id, false, reason);
      void sendItemTransferResult(activeSessionId, targetPlayer.remoteKey, targetPlayer.characterName, event.sendItemRequest.requestId || event.id, false, reason);
      debugLanFlow('MASTER_SEND_ITEM_FAST_CANCELLED_MISSING_ITEM', { sessionId: activeSessionId, eventId: event.id, fromKey, toKey, itemName: item.name, qty });
      return true;
    }
    const targetAfter = addItemToHostEquipment(targetPlayer.equipment, item, qty);
    const sourcePatched = applyHostInventoryRuntimePatch(fromKey, sourceAfter);
    const targetPatched = applyHostInventoryRuntimePatch(toKey, targetAfter);
    const reason = event.message || `${event.fromName} enviou ${qty}x ${item.name} para ${targetPlayer.characterName}.`;
    const sendItemRequestId = event.sendItemRequest.requestId || event.id;
    const sourceRemoteKey = String(sourcePlayer.remoteKey);
    const targetRemoteKey = String(targetPlayer.remoteKey);

    processedHostActionIdsRef.current.add(actionId);
    rememberSentEventInTimeline({ ...event, message: reason });
    void (async () => {
      const patchSends: Promise<unknown>[] = [];
      if (sourcePatched?.remoteKey) patchSends.push(sendOfficialInventoryPatch(activeSessionId, sourcePatched, reason, 'transfer_out', event.clientMsgId || event.id, {
        itemDelta: { mode: 'remove', item: { ...(item as any), qty }, qty },
        itemDeltas: [{ mode: 'remove', item: { ...(item as any), qty }, qty }],
        entityRevision: Math.max(1, Number(sourcePatched.revisionSeq || 0)),
      }));
      if (targetPatched?.remoteKey) patchSends.push(sendOfficialInventoryPatch(activeSessionId, targetPatched, reason, 'transfer_in', event.clientMsgId || event.id, {
        itemDelta: { mode: 'add', item: { ...(item as any), qty }, qty },
        itemDeltas: [{ mode: 'add', item: { ...(item as any), qty }, qty }],
        entityRevision: Math.max(1, Number(targetPatched.revisionSeq || 0)),
      }));
      const resultSends = [
        sendItemTransferResult(activeSessionId, sourceRemoteKey, sourcePlayer.characterName, sendItemRequestId, true, reason),
        sendItemTransferResult(activeSessionId, targetRemoteKey, targetPlayer.characterName, sendItemRequestId, true, reason),
      ];
      await Promise.allSettled([...patchSends, ...resultSends]);
    })().catch((error) => {
      debugLanFlow('MASTER_SEND_ITEM_FAST_BACKGROUND_NOTIFY_FAILED', {
        sessionId: activeSessionId,
        eventId: event.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    void enqueueLanEntityMutation([getLanPlayerQueueKey(activeSessionId, sourcePlayer.remoteKey), getLanPlayerQueueKey(activeSessionId, targetPlayer.remoteKey)], async () => {
      await rememberLanSessionEvent(db, event).catch(() => false);
      if (sourcePatched) await updateLanPlayerEquipment(db, sourcePatched.id, sourceAfter).catch(() => false);
      if (targetPatched) await updateLanPlayerEquipment(db, targetPatched.id, targetAfter).catch(() => false);
      scheduleSilentPayloadRefresh(activeSessionId);
    });
    debugLanFlow('MASTER_SEND_ITEM_FAST_RUNTIME_COMMITTED_DIRECT', { sessionId: activeSessionId, eventId: event.id, fromKey, toKey, itemName: item.name, qty });
    return true;
  }, [activeSessionId, applyHostInventoryRuntimePatch, db, rememberSentEventInTimeline, scheduleSilentPayloadRefresh, sendItemTransferResult, sendOfficialInventoryPatch]);

  const handleHostTradeAcceptFast = useCallback(async (event: LanSessionEvent) => {
    if (!activeSessionId || event.sessionId !== activeSessionId || event.type !== 'trade_accept') return false;
    const eventId = String(event.id || '');
    if (eventId) seenNativeHostEventIdsRef.current.add(eventId);

    const tradeId = String(event.tradeId || event.tradeAccept?.tradeId || event.clientMsgId || event.id || '');
    const actionId = `trade_accept:${tradeId}`;
    let fromKey = String(event.tradeAccept?.fromKey || event.fromKey || '');
    let toKey = String(event.tradeAccept?.toKey || (event.toKey !== 'master' ? event.toKey : '') || '');

    const queueKeys = [
      getLanInventoryQueueKey(activeSessionId, fromKey),
      getLanInventoryQueueKey(activeSessionId, toKey),
    ];

    return await enqueueLanEntityMutation(queueKeys, async () => {
      if (processedHostActionIdsRef.current.has(actionId)) {
        debugLanFlow('MASTER_TRADE_FAST_DUPLICATE_IGNORED', {
          sessionId: activeSessionId,
          eventId: event.id,
          tradeId,
          actionId,
          fromKey,
          toKey,
          decision: 'idempotent_trade_accept_already_committed',
        });
        return true;
      }

      const state = sessionStateRef.current;
      let fromPlayer = state?.players.find((entry) => entry.remoteKey === fromKey);
      let toPlayer = state?.players.find((entry) => entry.remoteKey === toKey);
      const offered = event.offeredItem;
      const requested = event.requestedItem;
      if (!state || !fromPlayer?.remoteKey || !toPlayer?.remoteKey || !offered?.name) {
        debugLanFlow('MASTER_TRADE_FAST_FALLBACK_SQLITE', {
          sessionId: activeSessionId,
          eventId: event.id,
          tradeId,
          fromKey,
          toKey,
          hasOffered: Boolean(offered?.name),
          decision: 'runtime_not_ready_do_not_mark_processed',
        });
        return false;
      }

      const offeredQty = Math.max(1, Number(offered.qty || 1));
      const requestedQty = Math.max(1, Number(requested?.qty || 1));

      // Em contra-proposta, preserve a direcao real pelo dono do item.
      // Se from/to vier invertido, normaliza antes de mexer nos inventarios.
      if (!hasHostItemQty(fromPlayer.equipment, offered, offeredQty) && hasHostItemQty(toPlayer.equipment, offered, offeredQty)) {
        const previousFromKey = fromKey;
        const previousFromPlayer = fromPlayer;
        fromKey = toKey;
        fromPlayer = toPlayer;
        toKey = previousFromKey;
        toPlayer = previousFromPlayer;
        debugLanFlow('MASTER_TRADE_FAST_DIRECTION_NORMALIZED', {
          sessionId: activeSessionId,
          eventId: event.id,
          tradeId,
          offeredItem: offered.name,
          fromKey,
          toKey,
        });
      }

      const fromRemoteKey = String(fromPlayer.remoteKey || fromKey);
      const toRemoteKey = String(toPlayer.remoteKey || toKey);

      if (getLanProjection(activeSessionId)) {
        const sourceEngineKey = getPlayerEngineKey(fromPlayer);
        const targetEngineKey = getPlayerEngineKey(toPlayer);
        const commandId = `trade_item:${tradeId || event.clientMsgId || event.id}`;
        const itemInstanceId = String((offered as any).id || (offered as any).inventoryItemId || (offered as any).inventory_item_id || (offered as any).stackKey || getInventoryStackKey(offered));
        const requestedItemInstanceId = requested?.name
          ? String((requested as any).id || (requested as any).inventoryItemId || (requested as any).inventory_item_id || (requested as any).stackKey || getInventoryStackKey(requested))
          : undefined;
        try {
          const engineResult = dispatchMasterEngineCommand({
            type: 'trade_item',
            commandId,
            sessionId: activeSessionId,
            actorKey: String(event.fromKey || sourceEngineKey),
            fromKey: sourceEngineKey,
            toKey: targetEngineKey,
            itemInstanceId,
            requestedItemInstanceId,
            qty: offeredQty,
            requestedQty: requested?.name ? requestedQty : undefined,
            tradeId,
            message: event.message || `${fromPlayer.characterName} concluiu uma troca com ${toPlayer.characterName}.`,
          }, {
            targetPlayer: toPlayer,
            message: event.message || `${fromPlayer.characterName} concluiu uma troca com ${toPlayer.characterName}.`,
          });
          processedHostActionIdsRef.current.add(actionId);
          rememberSentEventInTimeline({ ...event, message: engineResult?.event?.message || event.message });
          const projection = engineResult?.result?.projection;
          const projectedSource = projection?.players?.[sourceEngineKey];
          const projectedTarget = projection?.players?.[targetEngineKey];
          void enqueueLanEntityMutation([
            getLanPlayerQueueKey(activeSessionId, fromRemoteKey),
            getLanPlayerQueueKey(activeSessionId, toRemoteKey),
          ], async () => {
            await rememberLanSessionEvent(db, event).catch(() => false);
            if (projectedSource) await updateLanPlayerEquipment(db, fromPlayer.id, projectedSource.inventory).catch(() => false);
            if (projectedTarget) await updateLanPlayerEquipment(db, toPlayer.id, projectedTarget.inventory).catch(() => false);
            scheduleSilentPayloadRefresh(activeSessionId, { broadcast: true, immediate: true });
          }, { action: 'persist_trade_commit_engine', tradeId, fromKey: fromRemoteKey, toKey: toRemoteKey });
          const reason = event.message || `${fromPlayer.characterName} concluiu uma troca com ${toPlayer.characterName}.`;
          void sendTradeResult(activeSessionId, fromRemoteKey, fromPlayer.characterName, tradeId, true, reason);
          void sendTradeResult(activeSessionId, toRemoteKey, toPlayer.characterName, tradeId, true, reason);
          debugLanFlow('MASTER_TRADE_ENGINE_COMMITTED', {
            sessionId: activeSessionId,
            eventId: event.id,
            commandId,
            tradeId,
            fromKey: sourceEngineKey,
            toKey: targetEngineKey,
          });
          return true;
        } catch (error) {
          processedHostActionIdsRef.current.add(actionId);
          const reason = error instanceof Error ? error.message : 'Troca cancelada pela engine.';
          void sendTradeResult(activeSessionId, fromRemoteKey, fromPlayer.characterName, tradeId, false, reason);
          void sendTradeResult(activeSessionId, toRemoteKey, toPlayer.characterName, tradeId, false, reason);
          debugLanFlow('MASTER_TRADE_ENGINE_REJECTED', {
            sessionId: activeSessionId,
            eventId: event.id,
            tradeId,
            reason,
          });
          return true;
        }
      }

      const fromRemoved = removeItemFromHostEquipment(fromPlayer.equipment, offered, offeredQty);
      if (!fromRemoved.removed) {
        processedHostActionIdsRef.current.add(actionId);
        const reason = `${fromPlayer.characterName} nao possui mais ${offeredQty}x ${offered.name}. Troca cancelada.`;
        void sendTradeResult(activeSessionId, fromRemoteKey, fromPlayer.characterName, tradeId, false, reason);
        void sendTradeResult(activeSessionId, toRemoteKey, toPlayer.characterName, tradeId, false, reason);
        debugLanFlow('MASTER_TRADE_FAST_CANCELLED_MISSING_OFFERED', { sessionId: activeSessionId, eventId: event.id, tradeId, fromKey, toKey, itemName: offered.name });
        return true;
      }

      let fromAfter = fromRemoved.equipment;
      let toAfter = cloneEquipmentForHost(toPlayer.equipment);
      if (requested?.name) {
        const requestedRemoved = removeItemFromHostEquipment(toPlayer.equipment, requested, requestedQty);
        if (!requestedRemoved.removed) {
          processedHostActionIdsRef.current.add(actionId);
          const reason = `${toPlayer.characterName} nao possui mais ${requestedQty}x ${requested.name}. Troca cancelada.`;
          void sendTradeResult(activeSessionId, fromRemoteKey, fromPlayer.characterName, tradeId, false, reason);
          void sendTradeResult(activeSessionId, toRemoteKey, toPlayer.characterName, tradeId, false, reason);
          debugLanFlow('MASTER_TRADE_FAST_CANCELLED_MISSING_REQUESTED', { sessionId: activeSessionId, eventId: event.id, tradeId, fromKey, toKey, itemName: requested.name });
          return true;
        }
        toAfter = requestedRemoved.equipment;
        fromAfter = addItemToHostEquipment(fromAfter, requested, requestedQty);
      }
      toAfter = addItemToHostEquipment(toAfter, offered, offeredQty);

      const fromPatched = applyHostInventoryRuntimePatch(fromRemoteKey, fromAfter);
      const toPatched = applyHostInventoryRuntimePatch(toRemoteKey, toAfter);
      const reason = event.message || `${fromPlayer.characterName} concluiu uma troca com ${toPlayer.characterName}.`;
      const commitId = [
        'trade_commit',
        activeSessionId,
        tradeId || event.id || event.clientMsgId || Date.now(),
        event.id || event.clientMsgId || '',
        `${fromRemoteKey}->${toRemoteKey}`,
      ].filter(Boolean).join(':');

      const fromDeltas: Array<NonNullable<NonNullable<LanSessionEvent['inventoryPatch']>['itemDelta']>> = [
        { mode: 'remove', item: { ...(offered as any), qty: offeredQty }, qty: offeredQty },
      ];
      const toDeltas: Array<NonNullable<NonNullable<LanSessionEvent['inventoryPatch']>['itemDelta']>> = [
        { mode: 'add', item: { ...(offered as any), qty: offeredQty }, qty: offeredQty },
      ];
      if (requested?.name) {
        fromDeltas.push({ mode: 'add', item: { ...(requested as any), qty: requestedQty }, qty: requestedQty });
        toDeltas.unshift({ mode: 'remove', item: { ...(requested as any), qty: requestedQty }, qty: requestedQty });
      }

      // A transacao passa a ser considerada processada somente depois que o runtime
      // foi alterado. Isso permite varias trocas simultaneas entre pares diferentes,
      // mas impede duas conclusoes da mesma troca.
      processedHostActionIdsRef.current.add(actionId);
      rememberSentEventInTimeline({ ...event, message: reason });

      const tradePatchSends: Promise<unknown>[] = [];
      if (fromPatched?.remoteKey) tradePatchSends.push(sendOfficialInventoryPatch(activeSessionId, fromPatched, reason, 'trade_commit', tradeId, {
        itemDelta: fromDeltas[0],
        itemDeltas: fromDeltas,
        tradeCommit: {
          tradeId,
          commitId,
          offeringKey: fromRemoteKey,
          acceptingKey: toRemoteKey,
          targetKey: fromRemoteKey,
          itemDeltas: fromDeltas as any,
        } as any,
      }));
      if (toPatched?.remoteKey) tradePatchSends.push(sendOfficialInventoryPatch(activeSessionId, toPatched, reason, 'trade_commit', tradeId, {
        itemDelta: toDeltas[0],
        itemDeltas: toDeltas,
        tradeCommit: {
          tradeId,
          commitId,
          offeringKey: fromRemoteKey,
          acceptingKey: toRemoteKey,
          targetKey: toRemoteKey,
          itemDeltas: toDeltas as any,
        } as any,
      }));
      const tradeResultSends = [
        sendTradeResult(activeSessionId, fromRemoteKey, fromPlayer.characterName, tradeId, true, reason, {
          tradeCommit: {
            tradeId,
            commitId,
            offeringKey: fromRemoteKey,
            acceptingKey: toRemoteKey,
            targetKey: fromRemoteKey,
            itemDeltas: fromDeltas as any,
          } as any,
        }),
        sendTradeResult(activeSessionId, toRemoteKey, toPlayer.characterName, tradeId, true, reason, {
          tradeCommit: {
            tradeId,
            commitId,
            offeringKey: fromRemoteKey,
            acceptingKey: toRemoteKey,
            targetKey: toRemoteKey,
            itemDeltas: toDeltas as any,
          } as any,
        }),
      ];
      void Promise.allSettled([...tradePatchSends, ...tradeResultSends]).then((results) => {
        debugLanFlow('MASTER_TRADE_FAST_NOTIFICATIONS_SETTLED', {
          sessionId: activeSessionId,
          eventId: event.id,
          tradeId,
          sentCount: tradePatchSends.length + tradeResultSends.length,
          rejectedCount: results.filter((result) => result.status === 'rejected').length,
        });
      });

      void enqueueLanEntityMutation([
        getLanPlayerQueueKey(activeSessionId, fromRemoteKey),
        getLanPlayerQueueKey(activeSessionId, toRemoteKey),
      ], async () => {
        await rememberLanSessionEvent(db, event).catch(() => false);
        if (fromPatched) await updateLanPlayerEquipment(db, fromPatched.id, fromAfter).catch(() => false);
        if (toPatched) await updateLanPlayerEquipment(db, toPatched.id, toAfter).catch(() => false);
        scheduleSilentPayloadRefresh(activeSessionId, { broadcast: true, immediate: true });
      }, { action: 'persist_trade_commit', tradeId, fromKey: fromRemoteKey, toKey: toRemoteKey });

      debugLanFlow('MASTER_TRADE_FAST_RUNTIME_COMMITTED_DIRECT', {
        sessionId: activeSessionId,
        eventId: event.id,
        tradeId,
        fromKey: fromRemoteKey,
        toKey: toRemoteKey,
        queueKeys,
      });
      return true;
    }, { action: 'trade_accept_fast', tradeId, fromKey, toKey });
  }, [activeSessionId, applyHostInventoryRuntimePatch, db, rememberSentEventInTimeline, scheduleSilentPayloadRefresh, sendOfficialInventoryPatch, sendTradeResult]);

  const sendActionResult = useCallback(async (
    sessionId: string,
    targetKey: string,
    targetName: string,
    result: NonNullable<LanSessionEvent['actionResult']>,
    message: string,
    type: LanSessionEvent['type'] = 'action_result',
  ) => {
    const event = await rememberAndSendLanSessionEvent(db, joinUrl, {
      id: makeLanEventId(),
      sessionId,
      type,
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: targetName,
      entityType: 'action',
      entityId: result.actionId || result.requestId || targetKey,
      ackRequired: true,
      originClientId: 'master',
      actionResult: result,
      message,
      createdAt: new Date().toISOString(),
    });
    rememberSentEventInTimeline(event);
    return event;
  }, [db, joinUrl, rememberSentEventInTimeline]);

  const sendEffectSaveRequest = useCallback(async (
    sessionId: string,
    targetKey: string,
    targetName: string,
    saveRequest: NonNullable<LanSessionEvent['saveRequest']>,
    pendingSave?: LanPendingSave | null,
  ) => {
    const saveForPatch: LanPendingSave = pendingSave || {
      id: saveRequest.id,
      sessionId,
      targetKey,
      sourceType: 'effect_save_request',
      sourceId: saveRequest.sourceEffectId || null,
      sourceName: saveRequest.sourceEffectName || null,
      effectPayload: (saveRequest.pendingEffectPayload || {}) as Record<string, unknown>,
      ability: saveRequest.saveAbility,
      dc: saveRequest.dc ?? null,
      dcMode: 'fixed',
      status: 'pending',
      result: {},
    };
    setPendingSaves((current) => {
      if (current.some((entry) => entry.id === saveForPatch.id)) return current;
      return [saveForPatch, ...current];
    });
    const event = await rememberAndSendLanSessionEvent(db, joinUrl, {
      id: makeLanEventId(),
      sessionId,
      type: 'effect_save_request',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: targetName,
      entityType: 'save',
      entityId: saveRequest.id,
      ackRequired: true,
      originClientId: 'master',
      saveRequest,
      pendingSavePatch: {
        action: 'create',
        save: saveForPatch,
      },
      message: `${targetName} precisa rolar ${saveRequest.saveAbility}${saveRequest.dc ? ` CD ${saveRequest.dc}` : ''}.`,
      createdAt: new Date().toISOString(),
    });
    debugLanFlow('MASTER_EFFECT_SAVE_REQUEST_CREATED', {
      eventId: event?.id,
      requestId: saveRequest.id,
      targetKey,
      saveAbility: saveRequest.saveAbility,
      dc: saveRequest.dc,
    });
    rememberSentEventInTimeline(event);
    return event;
  }, [db, joinUrl, rememberSentEventInTimeline]);

  const applyPermanentStatEffectToPlayer = useCallback(async (
    sessionId: string,
    player: LanSessionPlayerState,
    effect: EffectDraft,
  ) => {
    const target = String(effect.target || '').toUpperCase();
    if (!isPermanentStatEffect(effect)) return null;

    const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id || entry.remoteKey === player.remoteKey) || player;
    const currentStats = latestPlayer.stats && typeof latestPlayer.stats === 'object' ? latestPlayer.stats : {};
    const currentValue = Math.floor(Number(currentStats[target]) || 10);
    const nextValue = effect.mode === 'set'
      ? Math.floor(Number(effect.value) || currentValue)
      : currentValue + Math.floor(Number(effect.value) || 0);
    const nextStats = {
      ...currentStats,
      [target]: String(Math.max(0, nextValue)),
    };
    const nextRevision = Math.max(0, Number(latestPlayer.revisionSeq || 0)) + 1;
    let numberPatch: NumberPatch | undefined;
    let nextHpMax = Number(latestPlayer.hpMax || 0);
    let nextHpCurrent = Number(latestPlayer.hpCurrent || 0);
    if (target === 'CON') {
      const beforeMod = Math.floor(((currentValue || 10) - 10) / 2);
      const afterMod = Math.floor(((Math.max(0, nextValue) || 10) - 10) / 2);
      const hpDelta = (afterMod - beforeMod) * Math.max(1, Number(latestPlayer.level || 1));
      if (hpDelta !== 0) {
        nextHpMax = Math.max(1, nextHpMax + hpDelta);
        nextHpCurrent = Math.max(0, nextHpCurrent + hpDelta);
        numberPatch = { hpMax: nextHpMax, hpCurrent: nextHpCurrent };
      }
    }
    const updatedPlayer: LanSessionPlayerState = {
      ...latestPlayer,
      hpMax: nextHpMax,
      hpCurrent: nextHpCurrent,
      stats: nextStats,
      revisionSeq: nextRevision,
    };
    const currentState = sessionStateRef.current;
    if (currentState) {
      const nextState = {
        ...currentState,
        players: currentState.players.map((entry) => (
          entry.id === updatedPlayer.id || entry.remoteKey === updatedPlayer.remoteKey ? updatedPlayer : entry
        )),
      };
      sessionStateRef.current = nextState;
      setSessionState(nextState);
      setPayload((current) => current ? ({ ...current, state: nextState }) : current);
      setInventoryModalPlayer((current) => current?.remoteKey === updatedPlayer.remoteKey ? updatedPlayer : current);
      setDetailPlayer((current) => current?.remoteKey === updatedPlayer.remoteKey ? updatedPlayer : current);
    }

    const seq = Date.now();
    const event: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'player_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: updatedPlayer.remoteKey || '',
      toName: updatedPlayer.characterName,
      entityType: 'player',
      entityId: updatedPlayer.remoteKey || String(updatedPlayer.id),
      entityRevision: nextRevision,
      ackRequired: true,
      originClientId: 'master',
      statsPatch: nextStats,
      numberPatch,
      message: `${effect.name} aplicado permanentemente em ${updatedPlayer.characterName}.`,
      createdAt: new Date().toISOString(),
    };

    rememberSentEventInTimeline(event);
    void sendLanSessionEvent(joinUrl, event).catch((error) => {
      debugLanFlow('MASTER_PERMANENT_STAT_PATCH_SEND_FAILED', {
        sessionId,
        eventId: event.id,
        playerKey: updatedPlayer.remoteKey,
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
    void sendPublicPlayerStatus(sessionId, updatedPlayer, 'permanent_stat_patch');
    void enqueueLanEntityMutation([getLanPlayerQueueKey(sessionId, updatedPlayer.remoteKey)], async () => {
      await updateLanPlayerStats(db, updatedPlayer.id, nextStats, { syncPayload: false }).catch(() => false);
      if (numberPatch) {
        await updateLanPlayerNumbers(db, updatedPlayer.id, numberPatch, { syncPayload: false }).catch(() => false);
      }
      await rememberLanSessionEvent(db, event).catch(() => false);
      scheduleSilentPayloadRefresh(sessionId);
    });
    return { player: updatedPlayer, statsPatch: nextStats, event };
  }, [db, joinUrl, rememberSentEventInTimeline, scheduleSilentPayloadRefresh, sendPublicPlayerStatus]);
  
  const filteredCatalogOptions = useMemo(() => {
    const search = catalogSearch.trim().toLowerCase();
    return catalogOptions.filter((option) => {
      const matchesFilter = catalogFilter === 'Todos' || option.group === catalogFilter;
      const matchesSearch = !search || option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [catalogFilter, catalogOptions, catalogSearch]);
  
  const selectedCatalogSet = useMemo(() => new Set(selectedCatalogKeys), [selectedCatalogKeys]);
  const selectedEffectSet = useMemo(() => new Set(selectedEffectKeys), [selectedEffectKeys]);
  const selectedEffectOptions = useMemo(
    () => effectOptions.filter((option) => selectedEffectSet.has(option.key)),
    [effectOptions, selectedEffectSet]
  );
  
  const filteredEffectOptions = useMemo(() => {
    const search = effectSearch.trim().toLowerCase();
    return effectOptions.filter((option) => {
      if (!search) return true;
      return option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
    }).slice(0, 12);
  }, [effectOptions, effectSearch]);

  const filteredInventoryCatalog = useMemo(() => {
    const search = inventorySearch.trim().toLowerCase();
    return inventoryCatalog.filter((item) => {
      const matchesFilter = inventoryFilter === 'Todos' || getInventoryItemCategory(item) === inventoryFilter;
      const matchesSearch = !search || matchesInventorySearch(item, search);
      return matchesFilter && matchesSearch;
    }).slice(0, 60);
  }, [inventoryCatalog, inventoryFilter, inventorySearch]);

  const reviewedRequestEventSet = useMemo(() => {
    const reviewedIds = sessionEvents
      .filter((event) => event.type === 'resource_review' && event.tradeId)
      .map((event) => String(event.tradeId));
    return new Set([...reviewedRequestEventIds, ...reviewedIds]);
  }, [reviewedRequestEventIds, sessionEvents]);

  const loadSavedSessions = useCallback(async () => {
    setSavedSessions(await getSavedLanSessions(db));
  }, [db]);

  const loadCatalogOptions = useCallback(async () => {
    const options = await getCustomCatalogOptions(db);
    setCatalogOptions(options);
    setSelectedCatalogKeys((current) => current.length > 0 ? current : options.map((option) => option.key));
  }, [db]);



  const loadEffectOptions = useCallback(async () => {
    const spells = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, name, level, damage_dice, damage_type, duration, effect_json, duration_value, duration_unit
       FROM spells
       ORDER BY name ASC`
    );
    const items = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit
       FROM items
       ORDER BY name ASC`
    );
    const conditions = await listEffects(db);
    const saves = await db.getAllAsync<ReferenceOption>(`SELECT id, name, stat FROM saving_throws ORDER BY name ASC`);
    const skills = await db.getAllAsync<ReferenceOption>(`SELECT id, name, stat FROM skills ORDER BY name ASC`);

    setSaveOptions(saves);
    setSkillOptions(skills);
    setSpellOptions(spells.map((spell) => ({
      id: String(spell.id || ''),
      name: String(spell.name || 'Magia'),
    })));

    setInventoryCatalog(items.map((row) => ({
      id: Number(row.id) || 0,
      name: String(row.name || 'Item'),
      qty: 1,
      weight: Number(row.weight) || 0,
      damage: String(row.damage || ''),
      damage_type: String(row.damage_type || ''),
      properties: String(row.properties || ''),
      descricao: String(row.descricao || ''),
      effect_json: String(row.effect_json || '[]'),
      duration_value: row.duration_value == null ? null : Number(row.duration_value),
      duration_unit: row.duration_unit ? String(row.duration_unit) : null,
      category: getInventoryItemCategory(row),
    })));

    setEffectOptions([
      ...conditions.map((row) => ({
        key: `condition:${row.id || row.statusKey}`,
        name: String(row.name || 'Condicao'),
        group: 'Condicao',
        detail: String(row.description || 'Condicao da mesa'),
        effects: [{
          target: row.target || 'custom',
          value: Number(row.value) || 0,
          status: row.statusKey,
          statusKey: row.statusKey,
          color: row.color,
          secondaryColor: row.secondaryColor,
          conditionName: row.name,
          saveAbility: row.saveAbility || (row.rulesJson as any)?.save?.ability || (row.rulesJson as any)?.saveAbility,
          saveDc: (row.rulesJson as any)?.save?.dc ?? (row.rulesJson as any)?.saveDc ?? (row.rulesJson as any)?.dc,
          repeatSave: row.repeatSave,
          saveOnSuccess: row.saveOnSuccess || (row.rulesJson as any)?.save?.onSuccess || (row.rulesJson as any)?.saveOnSuccess,
        }],
        // v100: condicao/status e manual por padrao. Antes vinha 1 turn e era
        // removida no primeiro ADVANCE_TIME_TURN, dando o efeito de aparecer e sumir.
        durationValue: null,
        durationUnit: 'manual' as LanEffectUnit,
        durationText: 'Manual',
        statusKey: row.statusKey ? String(row.statusKey) : undefined,
        color: row.color ? String(row.color) : undefined,
        secondaryColor: row.secondaryColor ? String(row.secondaryColor) : undefined,
      })),
      ...spells.map((row) => ({
        key: `spell:${row.id}`,
        name: String(row.name || 'Magia'),
        group: 'Magia/Skill',
        detail: [row.level, row.damage_dice, row.damage_type, row.duration].filter(Boolean).join(' - '),
        effects: parseOptionEffects(row.effect_json),
        durationValue: Number(row.duration_value) || null,
        durationUnit: normalizeEffectUnit(row.duration_unit),
        durationText: String(row.duration || ''),
      })),
      ...items.map((row) => ({
        key: `item:${row.id}`,
        name: String(row.name || 'Item'),
        group: 'Item',
        detail: [row.damage, row.damage_type, row.properties, row.descricao].filter(Boolean).join(' - '),
        effects: parseOptionEffects(row.effect_json),
        durationValue: Number(row.duration_value) || null,
        durationUnit: normalizeEffectUnit(row.duration_unit),
        durationText: row.duration_value ? `${row.duration_value} ${row.duration_unit || ''}` : '',
      })),
    ]);
  }, [db]);

  /** @deprecated Corte 6: reload permanece apenas para bootstrap/cache/visual; nunca corrige gameplay vivo. */
  const reloadSessionState = useCallback(async (sessionId: string, syncPayload = false) => {
    if (!sessionId) return;
    if (reloadSessionStateRunningRef.current) {
      if (syncPayload) reloadSessionStateQueuedRef.current = sessionId;
      debugLanFlow('MASTER_RELOAD_SESSION_STATE_DEBOUNCED_CUT6', {
        sessionId,
        syncPayload,
        reason: 'reload_already_running',
      });
      return;
    }

    reloadSessionStateRunningRef.current = true;
    reloadSessionStateLastRunAtRef.current = Date.now();
    const startedAt = Date.now();
    try {
      traceFunctionCall('reloadSessionState', { sessionId, syncPayload }, {
        screen: 'lan-session',
        source: 'reloadSessionState',
        sessionId,
        decision: 'visual_cache_only_cut6',
      });

      const projection = getLanProjection(sessionId);
      if (projection) {
        const projectedState = mergeLanProjectionIntoSessionState(projection, sessionStateRef.current);
        sessionStateRef.current = projectedState;
        setSessionState(projectedState);
        setPayload((current) => current && current.session.id === sessionId
          ? { ...current, state: projectedState }
          : current);
        setSessionEvents(await getLanSessionEvents(db, sessionId, SESSION_HISTORY_INITIAL_LIMIT));
        setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
        setPendingSaves(await listPendingSaves(db, sessionId));

        if (syncPayload) {
          const nextPayload = await syncLanSessionPayload(db, sessionId, { broadcast: false });
          if (nextPayload) {
            setPayload((current) => current && current.session.id === sessionId
              ? { ...nextPayload, state: projectedState }
              : current);
          }
        }

        debugLanFlow('MASTER_RELOAD_SESSION_STATE_VISUAL_ONLY_CUT6', {
          sessionId,
          syncPayload,
          playerCount: projectedState.players.length,
          currentTurn: projectedState.currentTurn,
          elapsedMinutes: projectedState.elapsedMinutes,
          status: projectedState.status,
          decision: 'sqlite_payload_cache_did_not_override_projection',
        });
        traceFunctionReturn('reloadSessionState', {
          sessionId,
          playerCount: projectedState.players.length,
          currentTurn: projectedState.currentTurn,
          elapsedMinutes: projectedState.elapsedMinutes,
        }, {
          screen: 'lan-session',
          source: 'reloadSessionState',
          sessionId,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      let nextState = await getLanSessionState(db, sessionId);
      const currentStatus = sessionStateRef.current?.status;
      if (Date.now() < sessionLifecycleLockUntilRef.current && currentStatus && nextState.status !== currentStatus) {
        debugLanFlow('MASTER_RELOAD_SESSION_STATE_LIFECYCLE_STATUS_LOCKED', {
          sessionId,
          sqliteStatus: nextState.status,
          keptStatus: currentStatus,
        });
        nextState = { ...nextState, status: currentStatus };
      }
      applyExternalSessionState(sessionId, nextState, 'sqlite');
      setSessionEvents(await getLanSessionEvents(db, sessionId, SESSION_HISTORY_INITIAL_LIMIT));
      setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
      setPendingSaves(await listPendingSaves(db, sessionId));

      if (syncPayload) {
        const nextPayload = await syncLanSessionPayload(db, sessionId, { broadcast: false });
        if (nextPayload) applyExternalPayload(nextPayload, 'sqlite');
      }
      traceFunctionReturn('reloadSessionState', {
        sessionId,
        playerCount: nextState.players.length,
        currentTurn: nextState.currentTurn,
        elapsedMinutes: nextState.elapsedMinutes,
      }, {
        screen: 'lan-session',
        source: 'reloadSessionState',
        sessionId,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      reloadSessionStateRunningRef.current = false;
      const queuedSessionId = reloadSessionStateQueuedRef.current;
      reloadSessionStateQueuedRef.current = null;
      if (queuedSessionId && queuedSessionId !== sessionId) {
        debugLanFlow('MASTER_RELOAD_SESSION_STATE_QUEUE_DROPPED_CUT6', {
          sessionId,
          queuedSessionId,
          reason: 'reload_is_visual_cache_only',
        });
      }
    }
  }, [applyExternalPayload, applyExternalSessionState, db]);

  const resumeMasterHost = useCallback(async () => {
  if (!payload?.session?.id || isEndingSession || endingSessionRef.current) return;

  const sessionId = payload.session.id;
  const currentStatus = sessionStateRef.current?.status || payload.state?.status || 'active';
  if (currentStatus === 'ended') return;

  const livePayload: LanSessionPayload = {
    ...payload,
    state: sessionStateRef.current || payload.state,
  };

  // v109: foreground/focus NÃO pode recriar o host nem salvar payload completo quando
  // o servidor TCP já está vivo. Isso era a origem de snapshots/bootstrap atrasados,
  // joins duplicados e efeitos reaparecendo após level-up/pausa.
  const reusedLiveHost = updateLanTcpHostPayload(livePayload, { broadcast: false });
  if (reusedLiveHost) {
    debugLanFlow('MASTER_RESUME_HOST_REUSED_LIVE_SOCKET_V109', {
      sessionId,
      joinUrl,
      status: currentStatus,
      decision: 'skip_start_server_and_skip_sqlite_save',
    });
    return;
  }

  const guardKey = `${sessionId}:resume_host_start`;
  if (!acquireMasterLifecycleAction(guardKey, 8000)) {
    debugLanFlow('MASTER_RESUME_HOST_START_DEDUPED_V109', {
      sessionId,
      joinUrl,
      status: currentStatus,
    });
    return;
  }

  try {
    traceApp('LAN_JOIN', 'MASTER_RESUME_HOST_START_SOCKET_V109', {
      screen: 'lan-session',
      source: 'resumeMasterHost',
      sessionId,
      joinUrl,
      status: currentStatus,
    });
    const nextJoinUrl = await startLanServer(livePayload);

    await saveLanSession(db, livePayload, nextJoinUrl, { isMaster: true });

    applyExternalPayload(livePayload, 'sqlite');
    setJoinUrl(nextJoinUrl);
    setJoinLink(buildJoinDeepLink(nextJoinUrl, livePayload));

    await loadSavedSessions();
    debugLanFlow('MASTER_RESUME_HOST_SOCKET_STARTED_V109', {
      sessionId,
      nextJoinUrl,
    });
  } catch (error) {
    console.warn('[LAN] Não foi possível retomar o host LAN automaticamente:', error);
    traceError('LAN_JOIN', 'MASTER_RESUME_HOST_FAILED_V109', error, {
      screen: 'lan-session',
      source: 'resumeMasterHost',
      sessionId,
      joinUrl,
    });
  } finally {
    releaseMasterLifecycleAction(guardKey);
  }
}, [applyExternalPayload, buildJoinDeepLink, db, isEndingSession, joinUrl, loadSavedSessions, payload, saveLanSession, startLanServer]);

useLanAppLifecycle({
  enabled: Boolean(payload?.session?.id && joinUrl),
  onBackground: async () => {
  },
  onForeground: async () => {
    await resumeMasterHost();
  },
});

useFocusEffect(
  useCallback(() => {
    if (!payload?.session?.id || !joinUrl || isEndingSession) return;
    let disposed = false;
    setTimeout(() => {
      if (!disposed) void resumeMasterHost();
    }, 120);
    return () => {
      disposed = true;
    };
  }, [isEndingSession, joinUrl, payload?.session?.id, resumeMasterHost])
);

useEffect(() => {
  if (!payload?.session?.id || !joinUrl) return;
  const unsubscribe = subscribeLanForegroundRecovery((reason) => {
    traceApp('LAN_JOIN', 'MASTER_EXTERNAL_FOREGROUND_RECOVERY_START', {
      screen: 'lan-session',
      source: 'subscribeLanForegroundRecovery',
      reason,
      sessionId: payload.session.id,
      joinUrl,
    });
    void resumeMasterHost();
  });
  return () => {
    unsubscribe();
  };
}, [joinUrl, payload?.session?.id, resumeMasterHost]);

  useEffect(() => {
    loadCatalogOptions();
    loadEffectOptions();
    loadSavedSessions();
  }, [loadCatalogOptions, loadEffectOptions, loadSavedSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    const pollJoinedPlayers = async () => {
      if (sessionStateRef.current?.status === 'paused' || endingSessionRef.current) {
        return;
      }
      const joinedPlayers = await getMasterJoinedPlayers(joinUrl);
      let changedPlayers = false;
      let shouldReloadSessionState = false;

      for (const entry of joinedPlayers) {
        const entrySessionId = String(entry?.sessionId || '');
        if (entrySessionId === activeSessionId) {
          try {
            const upsertResult = await upsertLanSessionPlayerFromNetwork(db, entry);
            const upsertChanged = Boolean(
              upsertResult &&
              (typeof upsertResult !== 'object' || (upsertResult as any).changed !== false)
            );
            if (upsertChanged) changedPlayers = true;
          } catch (error) {
            const entryCharacter =
              entry?.character && typeof entry.character === 'object'
                ? entry.character as Record<string, unknown>
                : {};

            console.warn('[LAN] Nao foi possivel registrar entrada do jogador:', {
              error,
              activeSessionId,
              entrySessionId,
              remoteKey: entry?.remoteKey,
              clientId: entry?.clientId,
              characterName: String(entryCharacter.name || ''),
            });
          }
        } else if (entrySessionId) {
          console.warn('[LAN] Join ignorado por sessionId diferente:', {
            activeSessionId,
            entrySessionId,
            remoteKey: entry?.remoteKey,
            clientId: entry?.clientId,
          });
        }
      }

      if (changedPlayers) {
        const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
        shouldReloadSessionState = true;

        if (syncedPayload) {
          applyExternalPayload(syncedPayload, 'sqlite');
          debugLanFlow('MASTER_PLAYER_STATE_RELOADED', {
            source: 'join_changed',
            sessionId: activeSessionId,
            playerCount: syncedPayload.state?.players?.length || 0,
          });
        }
      }

      const events = await getNativeSessionEvents(joinUrl);
      if (events.length > 0) {
        const currentState = await getLanSessionState(db, activeSessionId);
        for (const event of events) {
          if (event.sessionId !== activeSessionId) continue;
          const nativeEventId = String(event.id || '');
          if (nativeEventId && seenNativeHostEventIdsRef.current.has(nativeEventId)) {
            continue;
          }
          if (nativeEventId) seenNativeHostEventIdsRef.current.add(nativeEventId);

          const isMasterAuthoredLivePatch =
            (event.fromKey === 'master' || event.originClientId === 'master') &&
            (event.type === 'effect_patch'
              || event.type === 'inventory_patch'
              || event.type === 'player_patch'
              || event.type === 'pending_save_patch'
              || event.type === 'session_patch');
          if (isMasterAuthoredLivePatch) {
            debugLanFlow('MASTER_IGNORE_OWN_AUTHORITATIVE_EVENT', {
              sessionId: activeSessionId,
              eventId: event.id,
              type: event.type,
              fromKey: event.fromKey,
              toKey: event.toKey,
              originClientId: event.originClientId,
            });
            continue;
          }

          if (event.type === 'effect_save_result' && event.saveResult) {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_EFFECT_SAVE_RESULT_RECEIVED', {
              eventId: event.id,
              requestId: event.saveResult.requestId,
              fromKey: event.fromKey,
              total: event.saveResult.total,
              dc: event.saveResult.dc,
              passed: event.saveResult.passed,
              fresh,
            });
            if (!fresh) continue;

            // v108: fecha o card pendente do mestre imediatamente; a persistência/resolução vem depois.
            setPendingSaves((current) => current.filter((entry) => entry.id !== event.saveResult?.requestId));

            const resolved = await resolveSave(db, event.saveResult.requestId, Boolean(event.saveResult.passed), event.saveResult.total);
            if (!resolved) {
              debugLanFlow('MASTER_EFFECT_SAVE_RESULT_ALREADY_RESOLVED_V106', {
                sessionId: activeSessionId,
                requestId: event.saveResult.requestId,
                eventId: event.id,
                fromKey: event.fromKey,
              });
              setPendingSaves((current) => current.filter((entry) => entry.id !== event.saveResult?.requestId));
              setPendingSaves(await listPendingSaves(db, activeSessionId));
              continue;
            }
            const targetState = await getLanSessionState(db, activeSessionId);
            const targetPlayer = targetState.players.find((entry) => entry.remoteKey === event.fromKey || entry.characterName === event.fromName);
            if (!targetPlayer) continue;

            const pendingPayload = resolved.effectPayload as Record<string, any>;
            const save = pendingPayload.save || {};
            const onSuccess = String(save.onSuccess || save.saveOnSuccess || pendingPayload.saveOnSuccess || 'negates');
            const passed = Boolean(event.saveResult.passed);
            let appliedAfterSave = false;
            let keptActiveEffectAfterFailedSave = false;

            if (passed) {
              debugLanFlow('MASTER_EFFECT_SAVE_PASSED', {
                requestId: event.saveResult.requestId,
                targetKey: event.fromKey,
                onSuccess,
              });
            } else {
              debugLanFlow('MASTER_EFFECT_SAVE_FAILED', {
                requestId: event.saveResult.requestId,
                targetKey: event.fromKey,
              });
            }

            const activeEffectId = getActiveEffectIdFromPendingPayload(pendingPayload, targetPlayer);
            if (activeEffectId) {
              if (passed) {
                const removal = await removeLanPlayerEffect(db, targetPlayer.id, activeEffectId, { syncPayload: false });
                if (removal?.targetKey) {
                  await applyAndSendEffectResult(activeSessionId, removal);
                  appliedAfterSave = true;
                }
              } else {
                keptActiveEffectAfterFailedSave = true;
                debugLanFlow('MASTER_ACTIVE_EFFECT_SAVE_FAILED_KEEPING_EFFECT', {
                  requestId: event.saveResult.requestId,
                  targetKey: event.fromKey,
                  effectId: activeEffectId,
                });
              }
            } else if (String(pendingPayload.type || pendingPayload.kind || '') === 'damage') {
              const baseDamage = Math.max(0, Number(pendingPayload.amount || pendingPayload.value || 0));
              const finalDamage = passed && onSuccess === 'half' ? Math.ceil(baseDamage / 2) : passed && onSuccess !== 'half' ? 0 : baseDamage;
              if (finalDamage > 0) {
                const damageResult = applyDamageWithTempHp({
                  hpCurrent: targetPlayer.hpCurrent,
                  hpMax: targetPlayer.hpMax,
                  tempHp: targetPlayer.tempHp,
                  damage: finalDamage,
                });
                debugLanFlow('DAMAGE_WITH_TEMP_HP_CALCULATED', {
                  sessionId: activeSessionId,
                  playerId: targetPlayer.id,
                  source: 'save_result_damage',
                  damage: finalDamage,
                  result: damageResult,
                });
                await updateLanPlayerNumbers(db, targetPlayer.id, { hpCurrent: damageResult.nextHpCurrent, tempHp: damageResult.nextTempHp }, { syncPayload: false });
                queueTempHpEffectsSyncAfterDamage(activeSessionId, targetPlayer.id, damageResult.absorbedTempHp, 'save_result_damage', targetPlayer.remoteKey);
                const nextState = await getLanSessionState(db, activeSessionId);
                const updatedTarget = nextState.players.find((entry) => entry.id === targetPlayer.id) || targetPlayer;
                const patchEvent = await rememberAndSendLanSessionEvent(db, joinUrl, {
                  id: makeLanEventId(),
                  sessionId: activeSessionId,
                  type: 'player_patch',
                  fromKey: 'master',
                  fromName: 'Mestre',
                  toKey: updatedTarget.remoteKey || '',
                  toName: updatedTarget.characterName,
                  entityType: 'player',
                  entityId: updatedTarget.remoteKey || String(updatedTarget.id),
                  entityRevision: Math.max(0, Number(updatedTarget.revisionSeq || 0)),
                  ackRequired: true,
                  originClientId: 'master',
                  numberPatch: makeAuthoritativeNumberPatch(updatedTarget),
                  message: `${pendingPayload.sourceName || 'Efeito'} causou ${finalDamage} de dano em ${updatedTarget.characterName}.`,
                  createdAt: new Date().toISOString(),
                });
                rememberSentEventInTimeline(patchEvent);
                appliedAfterSave = true;
              }
            } else if (!passed || (passed && onSuccess !== 'negates' && onSuccess !== 'ignore')) {
              const draftAfterSave = buildEffectDraftFromPendingSavePayload(pendingPayload, {
                dc: event.saveResult.dc,
                sourceName: event.fromName,
              });
              if (passed && onSuccess === 'half') {
                draftAfterSave.value = Math.ceil(Number(draftAfterSave.value || 0) / 2);
              }
              const permanentResult = isPermanentStatEffect(draftAfterSave)
                ? await applyPermanentStatEffectToPlayer(activeSessionId, targetPlayer, draftAfterSave)
                : null;
              const result = permanentResult ? null : await addLanPlayerEffect(db, targetPlayer.id, draftAfterSave, { syncPayload: false });
              if (result?.targetKey) {
                await applyAndSendEffectResult(activeSessionId, result);
                appliedAfterSave = true;
              }
              if (permanentResult) appliedAfterSave = true;
            }

            debugLanFlow(
              appliedAfterSave
                ? 'MASTER_EFFECT_APPLIED_AFTER_SAVE'
                : keptActiveEffectAfterFailedSave
                  ? 'MASTER_ACTIVE_EFFECT_SAVE_FAILED_NO_CHANGE'
                  : 'MASTER_EFFECT_NEGATED_BY_SAVE',
              {
              requestId: event.saveResult.requestId,
              targetKey: event.fromKey,
              },
            );

            const resolveSeq = Date.now();
            const resolveEvent: LanSessionEvent = {
              id: makeLanEventId(),
              sessionId: activeSessionId,
              seq: resolveSeq,
              serverSeq: resolveSeq,
              type: 'pending_save_patch',
              fromKey: 'master',
              fromName: 'Mestre',
              toKey: event.fromKey,
              toName: event.fromName,
              entityType: 'save',
              entityId: event.saveResult.requestId,
              entityRevision: resolveSeq,
              ackRequired: true,
              originClientId: 'master',
              pendingSavePatch: {
                action: 'resolve',
                id: event.saveResult.requestId,
                result: event.saveResult,
              },
              message: passed ? 'Salvaguarda passou.' : 'Salvaguarda falhou.',
              createdAt: new Date(resolveSeq).toISOString(),
            };
            rememberSentEventInTimeline(resolveEvent);
            setPendingSaves((current) => current.filter((entry) => entry.id !== event.saveResult?.requestId));
            void sendLanSessionEvent(joinUrl, resolveEvent).catch(() => false);
            void rememberLanSessionEvent(db, resolveEvent).catch(() => false);
            void listPendingSaves(db, activeSessionId).then(setPendingSaves).catch(() => undefined);
            scheduleSilentPayloadRefresh(activeSessionId);
            continue;
          }

          if (
            (event.type === 'spell_cast_request' || event.type === 'item_use_request' || event.type === 'skill_cast_request' || event.type === 'ability_use_request') &&
            event.actionRequest
          ) {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_ACTION_REQUEST_RECEIVED', {
              eventId: event.id,
              type: event.type,
              fromKey: event.fromKey,
              actionKind: event.actionRequest.actionKind,
              actionName: event.actionRequest.actionName,
              targetKey: event.actionRequest.targetKey,
              fresh,
            });
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            if (!fresh) continue;

            const hostActionId = String(event.actionRequest.actionId || event.clientMsgId || event.id);
            if (processedHostActionIdsRef.current.has(hostActionId)) {
              debugLanFlow('DUPLICATE_ACTION_IGNORED_BY_HOST', {
                sessionId: activeSessionId,
                eventId: event.id,
                actionId: hostActionId,
                type: event.type,
                fromKey: event.fromKey,
              });
              continue;
            }
            processedHostActionIdsRef.current.add(hostActionId);

            const sessionSnapshot = await getLanSessionState(db, activeSessionId);
            const sourcePlayer = sessionSnapshot.players.find((entry) => entry.remoteKey === event.fromKey || entry.characterName === event.fromName);
            const targetKey = String(event.actionRequest.targetKey || event.fromKey);
            const targetPlayer = sessionSnapshot.players.find((entry) => entry.remoteKey === targetKey || entry.characterName === event.actionRequest?.targetName);
            const targetKind = String(event.actionRequest.targetKind || '').toLowerCase();
            const isExternalTarget = targetKind === 'external' || targetKind === 'manual' || targetKind === 'enemy';
            const reject = async (reason: string) => {
              await sendActionResult(
                activeSessionId,
                event.fromKey,
                event.fromName,
                { actionId: event.actionRequest?.actionId || event.id, requestId: event.id, status: 'rejected', reason },
                reason,
                event.type === 'spell_cast_request' ? 'spell_cast_result' : 'action_result'
              );
            };

            if (sessionSnapshot.status !== 'active') {
              await reject('Sessao em leitura.');
              continue;
            }
            if (!sourcePlayer) {
              await reject('Origem nao encontrada na sessao.');
              continue;
            }
            if (!targetPlayer && !isExternalTarget) {
              await reject('Origem ou alvo nao encontrado na sessao.');
              continue;
            }

            if (!targetPlayer && isExternalTarget) {
              const externalSpellEffect = event.actionRequest.spellEffect || event.spellEffect;
              if (!externalSpellEffect) {
                await reject('Acao externa sem efeito mecanico.');
                continue;
              }
              let attackResult: Record<string, unknown> | undefined;
              const declaredAmount = Math.abs(Number(externalSpellEffect.amount || event.actionRequest.declaredValue || 0));
              if (event.actionRequest.attack?.attackTotal != null && event.actionRequest.attack.targetAC != null) {
                const resolvedAttack = resolveAttackAgainstArmorClass({
                  rawRoll: Number(event.actionRequest.attack.attackRoll || 0),
                  modifier: Number(event.actionRequest.attack.attackModifier || 0),
                  targetArmorClass: Number(event.actionRequest.attack.targetAC || 10),
                  rollMode: event.actionRequest.attack.rollMode,
                  damageTotal: declaredAmount,
                  damageType: externalSpellEffect.description,
                });
                attackResult = { ...resolvedAttack, targetAc: resolvedAttack.targetAC };
              }
              await sendActionResult(
                activeSessionId,
                event.fromKey,
                event.fromName,
                {
                  actionId: event.actionRequest.actionId,
                  requestId: event.id,
                  status: 'accepted',
                  reason: `${externalSpellEffect.spellName} registrado contra alvo externo/manual.`,
                  targetKey,
                  amount: declaredAmount,
                  roll: event.actionRequest.rolls?.[0],
                  attack: attackResult,
                },
                `${externalSpellEffect.spellName} registrado contra alvo externo/manual.`,
                event.type === 'spell_cast_request' ? 'spell_cast_result' : 'action_result'
              );
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
              continue;
            }
            if (!targetPlayer) continue;

            if (event.type === 'item_use_request') {
              const item = event.actionRequest.item;
              const qty = Math.max(1, Number(event.actionRequest.itemQty || item?.qty || 1));
              const equipment = normalizeHostEquipment(sourcePlayer.equipment);
              const removed = removeHostEquipmentItem(equipment, String(item?.name || event.actionRequest.actionName || ''), qty);
              if (!removed) {
                await reject('Item indisponivel ou quantidade insuficiente.');
                continue;
              }
              const runtimeRemovedPlayer = applyHostInventoryRuntimePatch(
                sourcePlayer.remoteKey || event.fromKey,
                equipment,
                undefined,
              );
              const updatedSource = runtimeRemovedPlayer || { ...sourcePlayer, equipment };
              let itemTargetState = updatedSource;
              let itemNumberPatch: NumberPatch | null = null;
              void enqueueLanEntityMutation([getLanPlayerQueueKey(activeSessionId, sourcePlayer.remoteKey || event.fromKey)], async () => {
                await updateLanPlayerEquipment(db, sourcePlayer.id, equipment).catch(() => false);
                scheduleSilentPayloadRefresh(activeSessionId);
              });
              await sendOfficialInventoryPatch(
                activeSessionId,
                updatedSource,
                `${sourcePlayer.characterName} consumiu ${qty}x ${item?.name || event.actionRequest.actionName}.`,
                'remove',
                event.clientMsgId || event.id,
                {
                  itemDelta: {
                    mode: 'remove',
                    item: item || { name: event.actionRequest.actionName },
                    qty,
                    stackKey: getInventoryStackKey(item || { name: event.actionRequest.actionName }),
                  },
                  itemDeltas: [{
                    mode: 'remove',
                    item: item || { name: event.actionRequest.actionName },
                    qty,
                    stackKey: getInventoryStackKey(item || { name: event.actionRequest.actionName }),
                  }],
                  entityRevision: runtimeRemovedPlayer?.revisionSeq ? Math.max(1, Number(runtimeRemovedPlayer.revisionSeq || 0)) : undefined,
                },
              );

              for (const rawEffect of event.actionRequest.effects || []) {
                const draft = buildHostEffectDraftFromRaw(rawEffect, event.actionRequest, item?.name || event.actionRequest.actionName || 'Item');
                if (draft.kind === 'heal') {
                  const healAmount = Math.max(0, Number(draft.value || 0));
                  if (healAmount > 0) {
                    const nextHp = Math.min(itemTargetState.hpMax, itemTargetState.hpCurrent + healAmount);
                    await updateLanPlayerNumbers(db, itemTargetState.id, { hpCurrent: nextHp }, { syncPayload: false });
                    itemTargetState = { ...itemTargetState, hpCurrent: nextHp };
                    itemNumberPatch = { ...(itemNumberPatch || {}), hpCurrent: nextHp };
                  }
                  continue;
                }
                if (!draft.name) continue;
                if (shouldCreateHostSave(rawEffect)) {
                  const saveConfig = getHostSaveConfig(rawEffect);
                  debugLanFlow('MASTER_EFFECT_SAVE_CONFIGURED', {
                    actionId: event.actionRequest.actionId,
                    effectName: draft.name,
                    saveAbility: saveConfig?.saveAbility,
                    dc: saveConfig?.dc,
                  });
                  const pending = await createPendingSave(db, {
                    sessionId: activeSessionId,
                    playerId: itemTargetState.id,
                    targetKey: itemTargetState.remoteKey || '',
                    sourceType: 'item',
                    sourceId: event.actionRequest.actionId || event.id,
                    sourceName: draft.name,
                    appliedByKey: event.fromKey,
                    appliedByName: event.fromName,
                  }, {
                    ...draft,
                    save: {
                      ability: saveConfig?.saveAbility,
                      dc: saveConfig?.dc,
                      onSuccess: saveConfig?.saveOnSuccess || 'negates',
                    },
                  });
                  if (pending && itemTargetState.remoteKey) {
                    await sendEffectSaveRequest(activeSessionId, itemTargetState.remoteKey, itemTargetState.characterName, {
                      id: pending.id,
                      sourceEffectId: String(event.actionRequest.actionId || event.id),
                      sourceEffectName: draft.name,
                      targetKey: itemTargetState.remoteKey,
                      saveAbility: pending.ability,
                      dc: pending.dc ?? null,
                      rollMode: 'target_choice',
                      saveOnSuccess: saveConfig?.saveOnSuccess || 'negates',
                      saveOnFailure: 'apply_full',
                      pendingEffectPayload: pending.effectPayload,
                    }, pending);
                  }
                  continue;
                }
                const permanentResult = isPermanentStatEffect(draft as any)
                  ? await applyPermanentStatEffectToPlayer(activeSessionId, itemTargetState, draft as any)
                  : null;
                if (permanentResult?.player) {
                  itemTargetState = permanentResult.player;
                  debugLanFlow('MASTER_ITEM_PERMANENT_STAT_APPLIED_AS_PLAYER_PATCH', {
                    actionId: event.actionRequest.actionId,
                    effectName: draft.name,
                    target: draft.target,
                    value: draft.value,
                  });
                  continue;
                }
                debugLanFlow('MASTER_EFFECT_APPLIES_DIRECT_NO_SAVE', {
                  actionId: event.actionRequest.actionId,
                  effectName: draft.name,
                });
                const itemEffectResult = await addLanPlayerEffect(db, itemTargetState.id, draft as any, { syncPayload: false });
                await applyAndSendEffectResult(activeSessionId, itemEffectResult);
              }
              if (itemNumberPatch) {
                const stateAfterNumbers = await getLanSessionState(db, activeSessionId);
                const healedTarget = stateAfterNumbers.players.find((entry) => entry.id === itemTargetState.id) || itemTargetState;
                const patchEvent = await rememberAndSendLanSessionEvent(db, joinUrl, {
                  id: makeLanEventId(),
                  sessionId: activeSessionId,
                  type: 'player_patch',
                  fromKey: 'master',
                  fromName: 'Mestre',
                  toKey: healedTarget.remoteKey || '',
                  toName: healedTarget.characterName,
                  entityType: 'player',
                  entityId: healedTarget.remoteKey || String(healedTarget.id),
                  entityRevision: Math.max(0, Number(healedTarget.revisionSeq || 0)),
                  ackRequired: true,
                  originClientId: 'master',
                  numberPatch: makeAuthoritativeNumberPatch(healedTarget, itemNumberPatch),
                  message: `${item?.name || event.actionRequest.actionName || 'Item'} atualizou PV de ${healedTarget.characterName}.`,
                  createdAt: new Date().toISOString(),
                });
                rememberSentEventInTimeline(patchEvent);
              }
              // Não reenviar player/effect patches recentes aqui. O consumo já emite
              // os commits específicos acima (inventory_patch, player_patch/effect_patch).
              // Reenviar o histórico recente fazia o jogador receber dano/efeito antigo
              // depois do consumo, criando atraso e sensação de rollback.
              await sendActionResult(
                activeSessionId,
                event.fromKey,
                event.fromName,
                { actionId: event.actionRequest.actionId, requestId: event.id, status: 'accepted', reason: 'Item confirmado pelo mestre.' },
                'Item confirmado pelo mestre.'
              );
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
              continue;
            }

            const spellEffect = event.actionRequest.spellEffect || event.spellEffect;
            if (!spellEffect) {
              await reject('Acao sem efeito mecanico.');
              continue;
            }

            const saveConfig = event.actionRequest.save;
            if (spellEffect.mode !== 'heal' && saveConfig?.enabled !== false && saveConfig?.saveAbility && Number(saveConfig.dc || 0) > 0) {
              debugLanFlow('MASTER_EFFECT_SAVE_CONFIGURED', {
                actionId: event.actionRequest.actionId,
                effectName: spellEffect.spellName,
                saveAbility: saveConfig.saveAbility,
                dc: saveConfig.dc,
              });
              const pendingPayload = spellEffect.mode === 'damage'
                ? {
                  type: 'damage',
                  sourceName: spellEffect.spellName,
                  amount: Math.abs(Number(spellEffect.amount || event.actionRequest.declaredValue || 0)),
                  save: {
                    ability: saveConfig.saveAbility,
                    dc: saveConfig.dc,
                    onSuccess: saveConfig.saveOnSuccess || 'half',
                  },
                }
                : {
                  ...buildHostEffectDraftFromSpell(spellEffect, event.fromName),
                  save: {
                    ability: saveConfig.saveAbility,
                    dc: saveConfig.dc,
                    onSuccess: saveConfig.saveOnSuccess || 'negates',
                  },
                };
              const pending = await createPendingSave(db, {
                sessionId: activeSessionId,
                playerId: targetPlayer.id,
                targetKey: targetPlayer.remoteKey || '',
                sourceType: 'spell',
                sourceId: event.actionRequest.actionId || event.id,
                sourceName: spellEffect.spellName,
                appliedByKey: event.fromKey,
                appliedByName: event.fromName,
              }, pendingPayload);
              if (pending && targetPlayer.remoteKey) {
                await sendEffectSaveRequest(activeSessionId, targetPlayer.remoteKey, targetPlayer.characterName, {
                  id: pending.id,
                  sourceEffectId: String(event.actionRequest.actionId || event.id),
                  sourceEffectName: spellEffect.spellName,
                  targetKey: targetPlayer.remoteKey,
                  saveAbility: pending.ability,
                  fallbackAbilities: saveConfig.fallbackAbilities,
                  dc: pending.dc ?? null,
                  rollMode: 'target_choice',
                  saveOnSuccess: saveConfig.saveOnSuccess || (spellEffect.mode === 'damage' ? 'half' : 'negates'),
                  saveOnFailure: 'apply_full',
                  pendingEffectPayload: pending.effectPayload,
                }, pending);
                await sendActionResult(
                  activeSessionId,
                  event.fromKey,
                  event.fromName,
                  { actionId: event.actionRequest.actionId, requestId: event.id, status: 'accepted', reason: 'Aguardando salvaguarda do alvo.' },
                  'Aguardando salvaguarda do alvo.',
                  'spell_cast_result'
                );
              }
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
              continue;
            }

            if (spellEffect.mode === 'heal' || spellEffect.mode === 'damage') {
              const amount = Math.abs(Number(spellEffect.amount || event.actionRequest.declaredValue || 0));
              if (amount <= 0) {
                await reject('Valor de cura/dano invalido.');
                continue;
              }
              let attackResult: Record<string, unknown> | undefined;
              if (spellEffect.mode === 'damage' && event.actionRequest.attack?.attackTotal != null) {
                const attackRoll = Math.max(0, Number(event.actionRequest.attack.attackRoll || 0));
                const attackModifier = Number(event.actionRequest.attack.attackModifier || 0);
                const attackTotal = Number(event.actionRequest.attack.attackTotal || 0);
                const targetAc = calculateHostArmorClass(targetPlayer);
                if (attackRoll <= 0 || attackTotal <= 0) {
                  await reject('Rolagem de ataque invalida.');
                  continue;
                }
                const resolvedAttack = resolveAttackAgainstArmorClass({
                  rawRoll: attackRoll,
                  modifier: attackModifier,
                  targetArmorClass: targetAc,
                  rollMode: event.actionRequest.attack.rollMode,
                  damageTotal: amount,
                  damageType: spellEffect.description,
                });
                attackResult = { ...resolvedAttack, targetAc: resolvedAttack.targetAC };
                debugLanFlow(resolvedAttack.hit ? 'MASTER_ATTACK_HIT_AC' : 'MASTER_ATTACK_MISS_AC', {
                  actionId: event.actionRequest.actionId,
                  attackTotal: resolvedAttack.attackTotal,
                  targetAc: resolvedAttack.targetAC,
                  isCritical: resolvedAttack.isCritical,
                  isFumble: resolvedAttack.isFumble,
                  targetKey: targetPlayer.remoteKey,
                });
                if (!resolvedAttack.hit) {
                  const missReason = `${spellEffect.spellName} errou CA ${resolvedAttack.targetAC}.`;
                  await sendActionResult(
                    activeSessionId,
                    event.fromKey,
                    event.fromName,
                    {
                      actionId: event.actionRequest.actionId,
                      requestId: event.id,
                      status: 'accepted',
                      reason: missReason,
                      targetKey: targetPlayer.remoteKey,
                      amount: 0,
                      roll: event.actionRequest.rolls?.[0],
                      attack: attackResult,
                    },
                    missReason,
                    'spell_cast_result'
                  );
                  if (targetPlayer.remoteKey && targetPlayer.remoteKey !== event.fromKey) {
                    await sendActionResult(
                      activeSessionId,
                      targetPlayer.remoteKey,
                      targetPlayer.characterName,
                      {
                        actionId: event.actionRequest.actionId,
                        requestId: event.id,
                        status: 'accepted',
                        reason: missReason,
                        targetKey: targetPlayer.remoteKey,
                        amount: 0,
                        attack: attackResult,
                      },
                      missReason,
                      'spell_cast_result'
                    );
                  }
                  continue;
                }
              }
              let nextHpCurrent = targetPlayer.hpCurrent;
              let nextTempHp = targetPlayer.tempHp;
              let absorbedTempHp = 0;
              if (spellEffect.mode === 'heal') {
                nextHpCurrent = Math.min(targetPlayer.hpMax, targetPlayer.hpCurrent + amount);
              } else {
                const damageResult = applyDamageWithTempHp({
                  hpCurrent: targetPlayer.hpCurrent,
                  hpMax: targetPlayer.hpMax,
                  tempHp: targetPlayer.tempHp,
                  damage: amount,
                });
                nextTempHp = damageResult.nextTempHp;
                nextHpCurrent = damageResult.nextHpCurrent;
                debugLanFlow('DAMAGE_WITH_TEMP_HP_CALCULATED', {
                  sessionId: activeSessionId,
                  playerId: targetPlayer.id,
                  source: 'spell_damage',
                  damage: amount,
                  result: damageResult,
                });
                absorbedTempHp = damageResult.absorbedTempHp;
              }
              await updateLanPlayerNumbers(db, targetPlayer.id, { hpCurrent: nextHpCurrent, tempHp: nextTempHp }, { syncPayload: false });
              queueTempHpEffectsSyncAfterDamage(activeSessionId, targetPlayer.id, absorbedTempHp, 'spell_damage', targetPlayer.remoteKey);
              const nextState = await getLanSessionState(db, activeSessionId);
              const updatedTarget = nextState.players.find((entry) => entry.id === targetPlayer.id) || targetPlayer;
              const patchEvent = await rememberAndSendLanSessionEvent(db, joinUrl, {
                id: makeLanEventId(),
                sessionId: activeSessionId,
                type: 'player_patch',
                fromKey: 'master',
                fromName: 'Mestre',
                toKey: updatedTarget.remoteKey || '',
                toName: updatedTarget.characterName,
                entityType: 'player',
                entityId: updatedTarget.remoteKey || String(updatedTarget.id),
                entityRevision: Math.max(0, Number(updatedTarget.revisionSeq || 0)),
                ackRequired: true,
                originClientId: 'master',
                numberPatch: makeAuthoritativeNumberPatch(updatedTarget),
                message: `${event.fromName} usou ${spellEffect.spellName} em ${updatedTarget.characterName}.`,
                createdAt: new Date().toISOString(),
              });
              rememberSentEventInTimeline(patchEvent);
              await sendActionResult(
                activeSessionId,
                event.fromKey,
                event.fromName,
                {
                  actionId: event.actionRequest.actionId,
                  requestId: event.id,
                  status: 'accepted',
                  reason: `${spellEffect.spellName} aplicado.`,
                  targetKey: updatedTarget.remoteKey,
                  amount,
                  hpCurrent: updatedTarget.hpCurrent,
                  tempHp: updatedTarget.tempHp,
                  roll: event.actionRequest.rolls?.[0],
                  attack: attackResult,
                },
                `${spellEffect.spellName} aplicado.`,
                'spell_cast_result'
              );
              if (updatedTarget.remoteKey && updatedTarget.remoteKey !== event.fromKey) {
                await sendActionResult(
                  activeSessionId,
                  updatedTarget.remoteKey,
                  updatedTarget.characterName,
                  {
                    actionId: event.actionRequest.actionId,
                    requestId: event.id,
                    status: 'accepted',
                    reason: `${spellEffect.spellName} aplicado em voce.`,
                    targetKey: updatedTarget.remoteKey,
                    amount,
                    hpCurrent: updatedTarget.hpCurrent,
                    tempHp: updatedTarget.tempHp,
                    attack: attackResult,
                  },
                  `${spellEffect.spellName} aplicado em voce.`,
                  'spell_cast_result'
                );
              }
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
              continue;
            }

            const draft = buildHostEffectDraftFromSpell(spellEffect, event.fromName);
            debugLanFlow('MASTER_EFFECT_APPLIES_DIRECT_NO_SAVE', {
              actionId: event.actionRequest.actionId,
              effectName: draft.name,
            });
            const result = await addLanPlayerEffect(db, targetPlayer.id, draft as any, { syncPayload: false });
            await applyAndSendEffectResult(activeSessionId, result);
            await sendActionResult(
              activeSessionId,
              event.fromKey,
              event.fromName,
              { actionId: event.actionRequest.actionId, requestId: event.id, status: 'accepted', reason: `${spellEffect.spellName} aplicado.` },
              `${spellEffect.spellName} aplicado.`,
              'spell_cast_result'
            );
            await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            shouldReloadSessionState = true;
            continue;
          }

          if (event.type === 'coin_self_patch_request' && event.coinPatchRequest) {
            await handleHostCoinSelfPatchEvent(event, 'poll');
            shouldReloadSessionState = false;
            continue;
          }


          if (event.type === 'send_item_request' && event.sendItemRequest) {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_SEND_ITEM_REQUEST_RECEIVED', {
              eventId: event.id,
              fromKey: event.fromKey,
              toKey: event.sendItemRequest.toKey,
              itemName: event.sendItemRequest.item?.name,
              qty: event.sendItemRequest.qty,
              fresh,
            });
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            const commandGate = await executeLanHostCommandOnce(db, event, async () => ({ gated: true }));
            if (commandGate.status === 'duplicate') {
              debugLanFlow('HOST_COMMAND_DUPLICATE_SKIP_EVENT', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: commandGate.reason || 'persistent_command_duplicate',
              });
              continue;
            }
            if (!fresh) {
              debugLanFlow('HOST_STORED_DUPLICATE_BUT_PROCESSING_REQUEST', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: 'stored_duplicate_but_idempotency_gate_will_decide',
              });
            }
            const sendActionId = `send_item:${event.sendItemRequest.requestId || event.clientMsgId || event.id}`;
            if (processedHostActionIdsRef.current.has(sendActionId)) {
              debugLanFlow('SEND_ITEM_DUPLICATE_IGNORED', {
                sessionId: activeSessionId,
                eventId: event.id,
                actionId: sendActionId,
              });
              continue;
            }
            processedHostActionIdsRef.current.add(sendActionId);

            const result = await applyLanSendItemRequest(db, event);
            const nextState = await getLanSessionState(db, activeSessionId);
            sessionStateRef.current = nextState;
            setSessionState(nextState);
            setPayload((current) => current ? ({ ...current, state: nextState }) : current);
            const affectedPlayers = nextState.players.filter((entry) => result.targetKeys.includes(entry.remoteKey || ''));
            const reason = result.accepted
              ? event.message || 'Item enviado entre jogadores.'
              : result.reason || 'Envio de item recusado automaticamente.';

            if (result.accepted) {
              debugLanFlow('MASTER_SEND_ITEM_SQLITE_DONE', {
                eventId: event.id,
                targetKeys: result.targetKeys,
              });
              const sentItem = event.sendItemRequest?.item || event.item;
              const sentQty = Math.max(1, Number(event.sendItemRequest?.qty || sentItem?.qty || 1));
              for (const player of affectedPlayers) {
                const isSender = player.remoteKey === event.fromKey;
                const action = isSender ? 'transfer_out' : 'transfer_in';
                await sendOfficialInventoryPatch(activeSessionId, player, reason, action, event.clientMsgId || event.id, {
                  itemDelta: sentItem ? {
                    mode: isSender ? 'remove' : 'add',
                    item: { ...(sentItem as any), qty: sentQty },
                    qty: sentQty,
                  } : undefined,
                  itemDeltas: sentItem ? [{
                    mode: isSender ? 'remove' : 'add',
                    item: { ...(sentItem as any), qty: sentQty },
                    qty: sentQty,
                  }] : undefined,
                });
              }
            }

            const resultKeys = result.targetKeys.length > 0 ? result.targetKeys : [event.fromKey];
            for (const key of Array.from(new Set(resultKeys))) {
              const target = nextState.players.find((entry) => entry.remoteKey === key);
              await sendItemTransferResult(
                activeSessionId,
                key,
                target?.characterName || (key === event.fromKey ? event.fromName : key),
                event.sendItemRequest.requestId || event.id,
                result.accepted,
                reason
              );
            }

            scheduleSilentPayloadRefresh(activeSessionId);
            continue;
          }

          if (event.type === 'trade_accept') {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_TRADE_ACCEPT_REQUEST_RECEIVED', {
              eventId: event.id,
              tradeId: event.tradeId,
              fromKey: event.fromKey,
              offeringKey: event.tradeAccept?.fromKey,
              fresh,
            });
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            const commandGate = await executeLanHostCommandOnce(db, event, async () => ({ gated: true }));
            if (commandGate.status === 'duplicate') {
              debugLanFlow('HOST_COMMAND_DUPLICATE_SKIP_EVENT', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: commandGate.reason || 'persistent_command_duplicate',
              });
              continue;
            }
            if (!fresh) {
              debugLanFlow('HOST_STORED_DUPLICATE_BUT_PROCESSING_REQUEST', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: 'stored_duplicate_but_idempotency_gate_will_decide',
              });
            }
            const tradeActionId = `trade_accept:${event.tradeId || event.tradeAccept?.tradeId || event.clientMsgId || event.id}`;
            if (processedHostActionIdsRef.current.has(tradeActionId)) {
              debugLanFlow('TRADE_DUPLICATE_IGNORED', {
                sessionId: activeSessionId,
                eventId: event.id,
                actionId: tradeActionId,
                tradeId: event.tradeId,
              });
              continue;
            }
            processedHostActionIdsRef.current.add(tradeActionId);

            const result = await applyLanTradeAcceptRequest(db, event);
            const nextState = await getLanSessionState(db, activeSessionId);
            const affectedPlayers = nextState.players.filter((entry) => result.targetKeys.includes(entry.remoteKey || ''));
            const offeringKey = String(event.tradeAccept?.fromKey || '');
            const acceptingKey = String(event.tradeAccept?.toKey || '');
            const reason = result.accepted
              ? event.message || 'Troca concluída entre jogadores.'
              : result.reason || 'Troca recusada automaticamente.';
            const commitId = [
              'trade_commit',
              activeSessionId,
              event.tradeId || event.tradeAccept?.tradeId || event.clientMsgId || event.id || Date.now(),
              event.id || event.clientMsgId || '',
              `${offeringKey}->${acceptingKey}`,
            ].filter(Boolean).join(':');

            if (result.accepted) {
              debugLanFlow('MASTER_TRADE_SQLITE_DONE', {
                eventId: event.id,
                tradeId: event.tradeId,
                targetKeys: result.targetKeys,
              });
              const offeredItem = event.offeredItem;
              const requestedItem = event.requestedItem;
              for (const player of affectedPlayers) {
                const playerKey = String(player.remoteKey || '');
                const authoritativeDeltas = result.itemDeltasByTarget?.[playerKey];
                const itemDeltas: Array<NonNullable<NonNullable<LanSessionEvent['inventoryPatch']>['itemDelta']>> = Array.isArray(authoritativeDeltas)
                  ? authoritativeDeltas.filter(Boolean) as any
                  : [];
                if (itemDeltas.length === 0) {
                  if (playerKey === offeringKey) {
                    if (offeredItem) itemDeltas.push({ mode: 'remove', item: offeredItem as any, qty: Math.max(1, Number((offeredItem as any)?.qty || 1)) });
                    if (requestedItem) itemDeltas.push({ mode: 'add', item: requestedItem as any, qty: Math.max(1, Number((requestedItem as any)?.qty || 1)) });
                  } else if (playerKey === acceptingKey) {
                    if (requestedItem) itemDeltas.push({ mode: 'remove', item: requestedItem as any, qty: Math.max(1, Number((requestedItem as any)?.qty || 1)) });
                    if (offeredItem) itemDeltas.push({ mode: 'add', item: offeredItem as any, qty: Math.max(1, Number((offeredItem as any)?.qty || 1)) });
                  }
                }
                await sendOfficialInventoryPatch(activeSessionId, player, reason, 'trade_commit', event.clientMsgId || event.id, {
                  itemDelta: itemDeltas[0],
                  itemDeltas,
                  tradeCommit: {
                    tradeId: event.tradeId,
                    commitId,
                    offeringKey,
                    acceptingKey,
                    targetKey: playerKey,
                    itemDeltas: itemDeltas as any,
                  } as any,
                });
              }
            }

            for (const key of result.targetKeys.length > 0 ? result.targetKeys : [event.fromKey]) {
              const player = nextState.players.find((entry) => entry.remoteKey === key);
              if (player?.remoteKey || key === event.fromKey) {
                const tradeDeltasForTarget = result.itemDeltasByTarget?.[player?.remoteKey || key] || [];
                await sendTradeResult(
                  activeSessionId,
                  player?.remoteKey || key,
                  player?.characterName || (key === event.fromKey ? event.fromName : key),
                  event.tradeId,
                  result.accepted,
                  reason,
                  result.accepted && tradeDeltasForTarget.length > 0 ? {
                    tradeCommit: {
                      tradeId: event.tradeId,
                      commitId,
                      offeringKey,
                      acceptingKey,
                      targetKey: player?.remoteKey || key,
                      itemDeltas: tradeDeltasForTarget as any,
                    } as any,
                  } : undefined
                );
              }
            }

            sessionStateRef.current = nextState;
            setSessionState(nextState);
            setPayload((current) => current ? ({ ...current, state: nextState }) : current);
            scheduleSilentPayloadRefresh(activeSessionId);
            shouldReloadSessionState = false;
            continue;
          }

          if (event.type === 'trade_decline') {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) {
              debugLanFlow('HOST_STORED_DUPLICATE_BUT_PROCESSING_REQUEST', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: 'stored_duplicate_but_idempotency_gate_will_decide',
              });
            }
            const declineActionId = `trade_decline:${event.tradeId || event.tradeAccept?.tradeId || event.clientMsgId || event.id}:${event.fromKey}`;
            if (processedHostActionIdsRef.current.has(declineActionId)) {
              debugLanFlow('TRADE_DUPLICATE_IGNORED', {
                sessionId: activeSessionId,
                eventId: event.id,
                actionId: declineActionId,
                tradeId: event.tradeId,
              });
              continue;
            }
            processedHostActionIdsRef.current.add(declineActionId);
            const nextState = await getLanSessionState(db, activeSessionId);
            const targetKeys = Array.from(new Set([
              event.tradeAccept?.fromKey,
              event.tradeAccept?.toKey,
              event.fromKey,
            ].filter(Boolean).map(String)));
            const reason = event.message || `${event.fromName} recusou a troca.`;
            for (const key of targetKeys) {
              const player = nextState.players.find((entry) => entry.remoteKey === key);
              if (player?.remoteKey || key === event.fromKey) {
                await sendTradeResult(
                  activeSessionId,
                  player?.remoteKey || key,
                  player?.characterName || (key === event.fromKey ? event.fromName : key),
                  event.tradeId,
                  false,
                  reason
                );
              }
            }
            await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            shouldReloadSessionState = true;
            continue;
          }

          if (event.type === 'resource_request' && event.resourceRequest) {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_RESOURCE_REQUEST_RECEIVED_IMMEDIATE', {
              eventId: event.id,
              fromKey: event.fromKey,
              fromName: event.fromName,
              resourceKind: event.resourceRequest.kind,
              fresh,
            });
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            const commandGate = await executeLanHostCommandOnce(db, event, async () => ({ gated: true }));
            if (commandGate.status === 'duplicate') {
              debugLanFlow('HOST_COMMAND_DUPLICATE_SKIP_EVENT', {
                sessionId: activeSessionId,
                eventId: event.id,
                type: event.type,
                reason: commandGate.reason || 'persistent_command_duplicate',
              });
              continue;
            }
            if (getLanProjection(activeSessionId) && (event.resourceRequest.kind === 'xp' || event.resourceRequest.kind === 'coin')) {
              const requestedPlayer = currentState.players.find((entry) => (
                entry.remoteKey === event.fromKey ||
                entry.characterName === event.fromName
              ));
              const requestedTargetKey = requestedPlayer ? getPlayerEngineKey(requestedPlayer) : String(event.fromKey || '');
              if (requestedTargetKey) {
                const field = event.resourceRequest.kind === 'coin' ? normalizeResourceCoinField(event.resourceRequest.field) : null;
                dispatchMasterEngineCommand({
                  type: 'request_reward',
                  commandId: `resource_request:${event.resourceRequest.clientRequestId || event.clientMsgId || event.id}`,
                  sessionId: activeSessionId,
                  actorKey: String(event.fromKey || requestedTargetKey),
                  targetKey: requestedTargetKey,
                  requestId: String(event.resourceRequest.clientRequestId || event.clientMsgId || event.id),
                  xp: event.resourceRequest.kind === 'xp' ? Math.max(0, Math.floor(Number(event.resourceRequest.amount || 0))) : undefined,
                  coins: event.resourceRequest.kind === 'coin'
                    ? ((event.resourceRequest as any).coins || (field ? { [field]: Math.max(0, Math.floor(Number(event.resourceRequest.amount ?? event.resourceRequest.value ?? 0))) } : undefined))
                    : undefined,
                  message: event.resourceRequest.message || event.message,
                }, { targetPlayer: requestedPlayer || null, message: event.resourceRequest.message || event.message, sendEvent: false });
              }
            }
            if (fresh) {
              // v108: pedido do jogador ja aparece pelo runtime. Nao rode sync/reload pesado aqui,
              // pois isso bloqueava respostas e fazia os pedidos chegarem atrasados.
              scheduleSilentPayloadRefresh(activeSessionId);
            }
            continue;
          }

          if (event.type === 'player_joined') {
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            const alreadyPresent = currentState.players.some((entry) => (
              (event.fromKey && entry.remoteKey === event.fromKey) ||
              (event.fromName && entry.characterName === event.fromName)
            ));
            if (alreadyPresent) {
              traceApp('EVENT_IGNORED', 'MASTER_PLAYER_JOINED_DUPLICATE_NOOP', {
                screen: 'lan-session',
                source: 'pollJoinedPlayers',
                sessionId: activeSessionId,
                eventId: event.id,
                eventType: event.type,
                fromKey: event.fromKey,
                playerName: event.fromName,
                decision: 'player_already_present',
              });
              continue;
            }
            const fresh = await rememberLanSessionEvent(db, event);
            // O evento de entrada também precisa criar um jogador pendente,
            // porque em algumas redes o evento chega antes do roster do join.
            if (fresh) {
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
            }
            continue;
          }

          const player = currentState.players.find((entry) => (
            entry.remoteKey === event.fromKey ||
            entry.remoteKey === event.toKey ||
            entry.characterName === event.fromName ||
            entry.characterName === event.toName
          ));

          if (!player) {
            console.warn('[LAN EVENT SKIPPED]', {
              reason: 'PLAYER_NOT_FOUND',
              type: event.type,
              fromKey: event.fromKey,
              fromName: event.fromName,
            });
            await rememberLanSessionEvent(db, {
              ...event,
              message: `[PENDENTE SEM PLAYER] ${event.message || event.type}`,
            });
            continue;
          }

          if (event.type === 'public_status' && event.publicState) {
            continue;
          }

          if (event.type === 'spell_hp' && event.spellEffect?.amount != null) {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            const targetPlayer = currentState.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
            if (!targetPlayer) continue;
            await updateLanPlayerNumbers(db, targetPlayer.id, {
              hpCurrent: Math.max(0, Math.min(targetPlayer.hpMax, targetPlayer.hpCurrent + event.spellEffect.amount)),
            });
            shouldReloadSessionState = true;
          }

          if (event.type === 'spell_effect' && event.spellEffect) {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            const targetPlayer = currentState.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
            if (!targetPlayer) continue;
            const spellEffectResult = await addLanPlayerEffect(db, targetPlayer.id, {
              name: event.spellEffect.spellName,
              target: event.spellEffect.target || 'custom',
              value: event.spellEffect.value || 0,
              remaining: event.spellEffect.durationRemaining ?? 1,
              unit: event.spellEffect.durationUnit || 'rest',
              durationText: event.spellEffect.durationText,
              isPermanent: event.spellEffect.durationUnit === 'permanent',
              kind: event.spellEffect.target === 'PV_TEMP' ? 'temp_hp' : undefined,
              mode: event.spellEffect.effectMode,
              status: event.spellEffect.status,
              statusKey: event.spellEffect.status,
              color: event.spellEffect.color,
              secondaryColor: event.spellEffect.secondaryColor,
              source: event.fromName,
            }, { syncPayload: false });
            await applyAndSendEffectResult(activeSessionId, spellEffectResult);
            shouldReloadSessionState = false;
          }

          if ((event.type as string) === 'send_item' || (event.type as string) === 'trade_accept') {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            await applyLanInventoryTransferEvent(db, event);
            shouldReloadSessionState = true;
          }

          if ((event.type as string) === 'trade_offer' || (event.type as string) === 'trade_decline') {
            const fresh = await rememberLanSessionEvent(db, event);
            if (fresh) {
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
            }
          }

          if (event.type === 'player_progression_patch' && event.progressionPatch) {
            await applyProgressionPatchRuntimeFirst(event, 'native_progression_patch_runtime_first');
            const appliedPlayerId = await applyLanPlayerProgressionPatchFromEvent(db, activeSessionId, event);
            if (appliedPlayerId) {
              const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              if (syncedPayload) {
                applyExternalPayload(syncedPayload, 'sqlite');
              }
              setSessionEvents(await getLanSessionEvents(db, activeSessionId, SESSION_HISTORY_INITIAL_LIMIT));
              setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
              shouldReloadSessionState = false;
            }
            continue;
          }

          if (event.type === 'player_patch' && event.numberPatch) {
            const applied = await applyLanPlayerNumberPatch(db, activeSessionId, event.fromKey, event.numberPatch, event);
            if (applied) {
              await rememberLanSessionEvent(db, event);
              const nextState = await getLanSessionState(db, activeSessionId);
              sessionStateRef.current = nextState;
              setSessionState(nextState);
              setPayload((current) => current ? ({ ...current, state: nextState }) : current);
              const targetPlayer = nextState.players.find((entry) => (
                entry.remoteKey === event.fromKey ||
                entry.characterName === event.fromName
              ));

              if (targetPlayer?.remoteKey) {
                void sendPublicPlayerStatus(activeSessionId, targetPlayer, 'player_patch');
                const officialPatch = makeAuthoritativeNumberPatch(targetPlayer);

                const committedEvent = await rememberAndSendLanSessionEvent(db, joinUrl, {
                  id: makeLanEventId(),
                  sessionId: activeSessionId,
                  type: 'player_patch',
                  fromKey: 'master',
                  fromName: 'Mestre',
                  toKey: targetPlayer.remoteKey,
                  toName: targetPlayer.characterName,
                  entityType: 'player',
                  entityId: targetPlayer.remoteKey,
                  entityRevision: Math.max(0, Number(targetPlayer.revisionSeq || 0)),
                  ackRequired: true,
                  originClientId: 'master',
                  numberPatchIntent: event.coinPatchRequest ? 'self_coin' : inferNumberPatchIntent(event.numberPatch as NumberPatch),
                  sourceClientMsgId: event.clientMsgId || event.id,
                  coinPatchRequest: event.coinPatchRequest,
                  numberPatch: officialPatch,
                  message: event.message || `${targetPlayer.characterName} teve recursos atualizados pelo mestre.`,
                  createdAt: new Date().toISOString(),
                });

                if (committedEvent) {
                  setSessionEvents((current) => mergeMasterTimelineEvent(current, committedEvent));
                }
              }

              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
              shouldReloadSessionState = true;
            }
          }


          if (event.type === 'inventory_patch' && event.inventoryPatch) {
            await handleHostInventoryPatchEvent(event, 'poll');
            shouldReloadSessionState = false;
            continue;
          }


          if (event.type === 'effect_patch' && event.effectPatch) {
            const targetPlayer = (sessionStateRef.current?.players || currentState.players).find((entry) => (
              entry.remoteKey === event.effectPatch?.targetKey ||
              entry.remoteKey === event.fromKey ||
              entry.characterName === event.fromName
            ));

            if (!targetPlayer?.remoteKey) continue;

            const incomingPatch = event.effectPatch;
            const effectActionId = `effect:${event.clientMsgId || event.id}`;

            // v56: ao consumir item temporario, o jogador envia effect_patch como proposta.
            // O mestre deve mostrar na hora e depois devolver um commit autoritativo.
            // Sem isso, a ficha do mestre ficava sem FOR/CON/condicao e a passagem de turno
            // nao tinha efeito oficial para decrementar/remover.
            const optimisticRuntime = applyHostEffectPatchRuntime(activeSessionId, sessionStateRef.current || currentState, targetPlayer.remoteKey, incomingPatch, 'event');
            if (optimisticRuntime) {
              sessionStateRef.current = optimisticRuntime.state;
              setSessionState(optimisticRuntime.state);
              setPayload((current) => current ? ({ ...current, state: optimisticRuntime.state }) : current);
              void sendPublicPlayerStatus(activeSessionId, optimisticRuntime.player, 'player_effect_propose_optimistic');
            }

            const commandGate = await executeLanHostCommandOnce(db, event, async () => {
              await rememberLanSessionEvent(db, event).catch(() => false);

              const officialPatch: NonNullable<LanSessionEvent['effectPatch']> = {
                targetKey: targetPlayer.remoteKey || incomingPatch.targetKey,
                add: [],
                update: [],
                remove: [],
              };

              for (const effectId of incomingPatch.remove || []) {
                const removeResult = await removeLanPlayerEffect(db, targetPlayer.id, String(effectId), { syncPayload: false, recordEvent: false });
                if (removeResult?.patch) {
                  officialPatch.remove.push(...(removeResult.patch.remove || []));
                  officialPatch.update.push(...((removeResult.patch.update || []) as any[]));
                } else {
                  officialPatch.remove.push(String(effectId));
                }
              }

              for (const effect of [...(incomingPatch.add || []), ...(incomingPatch.update || [])]) {
                const sourceId = String((effect as any).sourceId || (effect as any).id || event.clientMsgId || event.id || '');
                const patchEffectResult = await addLanPlayerEffect(db, targetPlayer.id, {
                  id: String((effect as any).id || '') || undefined,
                  name: String((effect as any).name || event.message || 'Efeito de item'),
                  target: ((effect as any).target || 'custom') as LanEffectTarget,
                  value: Number((effect as any).value || 0),
                  remaining: Number((effect as any).remaining ?? 1),
                  unit: ((effect as any).unit || 'rest') as LanEffectUnit,
                  isPermanent: Boolean((effect as any).isPermanent || (effect as any).unit === 'permanent'),
                  durationText: (effect as any).durationText,
                  kind: (effect as any).kind,
                  mode: (effect as any).mode,
                  status: (effect as any).status,
                  statusKey: (effect as any).statusKey || (effect as any).status,
                  color: (effect as any).color,
                  secondaryColor: (effect as any).secondaryColor,
                  source: (effect as any).source || event.fromName,
                  sourceType: (effect as any).sourceType || 'item',
                  sourceId,
                  visibleToPlayer: (effect as any).visibleToPlayer !== false,
                  publicNote: (effect as any).publicNote,
                  privateNote: (effect as any).privateNote,
                  saveDc: (effect as any).saveDc ?? null,
                  saveAbility: (effect as any).saveAbility ?? null,
                  repeatSave: (effect as any).repeatSave ?? null,
                  removableBySave: (effect as any).removableBySave,
                  visualPriority: (effect as any).visualPriority,
                } as any, { syncPayload: false, recordEvent: false });

                if (patchEffectResult?.patch) {
                  officialPatch.add.push(...((patchEffectResult.patch.add || []) as any[]));
                  officialPatch.update.push(...((patchEffectResult.patch.update || []) as any[]));
                  officialPatch.remove.push(...(patchEffectResult.patch.remove || []));
                }
              }

              const hasOfficialPatch = Boolean(
                officialPatch.add.length || officialPatch.update.length || officialPatch.remove.length
              );
              if (!hasOfficialPatch) return { applied: false };

              const runtimeAfterDb = applyHostEffectPatchRuntime(activeSessionId, sessionStateRef.current || currentState, targetPlayer.remoteKey || officialPatch.targetKey, officialPatch, 'runtime');
              if (runtimeAfterDb) {
                sessionStateRef.current = runtimeAfterDb.state;
                setSessionState(runtimeAfterDb.state);
                setPayload((current) => current ? ({ ...current, state: runtimeAfterDb.state }) : current);
              }

              const seq = Date.now();
              const officialEvent: LanSessionEvent = {
                id: makeLanEventId(),
                sessionId: activeSessionId,
                seq,
                serverSeq: seq,
                type: 'effect_patch',
                fromKey: 'master',
                fromName: 'Mestre',
                toKey: targetPlayer.remoteKey || officialPatch.targetKey,
                toName: targetPlayer.characterName,
                entityType: 'effect',
                entityId: targetPlayer.remoteKey || officialPatch.targetKey,
                entityRevision: runtimeAfterDb?.revision || Math.max(0, Number(targetPlayer.revisionSeq || 0)) + 1,
                ackRequired: true,
                originClientId: 'master',
                sourceClientMsgId: event.clientMsgId || event.id,
                effectPatch: officialPatch,
                message: event.message || `${targetPlayer.characterName} aplicou efeito de item.`,
                createdAt: new Date(seq).toISOString(),
              };

              const committedEvent = await rememberAndSendLanSessionEvent(db, joinUrl, officialEvent);
              if (committedEvent) {
                rememberSentEventInTimeline(committedEvent);
              } else {
                rememberSentEventInTimeline(officialEvent);
                void sendLanSessionEvent(joinUrl, officialEvent).catch(() => false);
              }

              const finalPlayer = (sessionStateRef.current?.players || []).find((entry) => entry.remoteKey === targetPlayer.remoteKey) || targetPlayer;
              void sendPublicPlayerStatus(activeSessionId, finalPlayer, 'player_effect_official_commit');
              return { applied: true, eventId: committedEvent?.id || officialEvent.id };
            });

            if (commandGate.status === 'duplicate') {
              debugLanFlow('HOST_EFFECT_PATCH_DUPLICATE_SKIPPED', {
                sessionId: activeSessionId,
                eventId: event.id,
                clientMsgId: event.clientMsgId,
                actionId: effectActionId,
              });
            }

            await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            shouldReloadSessionState = false;
            continue;
          }
        }
      }

      if (shouldReloadSessionState) {
        await reloadSessionState(activeSessionId, false);
        debugLanFlow('MASTER_PLAYER_STATE_RELOADED', {
          source: 'poll_or_realtime',
          sessionId: activeSessionId,
        });
      } else {
        traceApp('POLLING_TICK', 'MASTER_POLL_NO_CHANGE_SKIPPED', {
          screen: 'lan-session',
          source: 'pollJoinedPlayers',
          sessionId: activeSessionId,
          decision: 'no_relevant_change',
        });
      }
    };

    pollJoinedPlayers();
    // v109: fallback de eventos genéricos precisa ser quase em tempo real;
    // a deduplicação por eventId evita reaplicar eventos já tratados.
    const timer = setInterval(pollJoinedPlayers, 1000);
    const unsubscribeRealtime = subscribeLanSessionHostUpdates(joinUrl, (update?: LanSessionHostUpdate) => {
      traceApp('SUBSCRIPTION_UPDATE', 'MASTER_HOST_SUBSCRIPTION_UPDATE', {
        screen: 'lan-session',
        source: 'subscribeLanSessionHostUpdates',
        sessionId: activeSessionId,
        joinUrl,
        eventId: update?.event?.id,
        eventType: update?.event?.type,
        envelopeType: update?.envelopeType,
        reason: update?.reason,
      });
      if (
        update?.reason === 'join' ||
        update?.event?.type === 'player_joined'
      ) {
        void (async () => {
          const entry = update.joinEntry;
          if (!entry || String(entry.sessionId || '') !== activeSessionId) {
            update.rejectJoin?.('JOIN_SESSION_ID_MISMATCH');
            return;
          }

          const joinIdentity = String(entry.remoteKey || entry.clientId || entry.playerName || '').trim();
          const joinKey = `${activeSessionId}:${joinIdentity}`;
          const now = Date.now();
          const hasRuntimePlayer = Boolean((sessionStateRef.current?.players || []).some((player) => (
            player.remoteKey === entry.remoteKey ||
            (entry.clientId && player.clientId === entry.clientId) ||
            player.characterName === entry.playerName
          )));

          const broadcastRosterPublicStatus = (payloadToBroadcast?: LanSessionPayload | null, reason = 'join_roster_public_status_sync') => {
            const players = payloadToBroadcast?.state?.players || sessionStateRef.current?.players || [];
            for (const player of players) {
              if (player?.remoteKey) void sendPublicPlayerStatus(activeSessionId, player, reason);
            }
          };

          if (hasRuntimePlayer) {
            const incomingCharacter = entry.character && typeof entry.character === 'object'
              ? entry.character as Record<string, unknown>
              : null;
            if (incomingCharacter) {
              const parseJoinStats = (value: unknown) => {
                if (value && typeof value === 'object') return value as Record<string, unknown>;
                try {
                  const parsed = JSON.parse(String(value || '{}'));
                  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
                } catch {
                  return {};
                }
              };
              const inferJoinLevel = (classNameValue: unknown) => {
                const matches = String(classNameValue || '').match(/\b\d+\b/g) || [];
                return matches.reduce((total, item) => total + Math.max(0, Math.floor(Number(item) || 0)), 0);
              };
              const className = String(incomingCharacter.class || incomingCharacter.className || '').trim();
              const joinLevel = Math.max(
                1,
                Math.floor(Number(incomingCharacter.level || 0) || 0),
                inferJoinLevel(className)
              );
              const joinHpCurrent = Math.max(0, Math.floor(Number(
                incomingCharacter.hp_current ?? incomingCharacter.hpCurrent ?? incomingCharacter.currentHp ?? incomingCharacter.hp ?? 0
              ) || 0));
              const joinHpMax = Math.max(0, Math.floor(Number(
                incomingCharacter.hp_max ?? incomingCharacter.hpMax ?? incomingCharacter.maxHp ?? incomingCharacter.max_hp ?? joinHpCurrent
              ) || 0));
              await applyProgressionPatchRuntimeFirst({
                id: makeLanEventId(),
                sessionId: activeSessionId,
                type: 'player_progression_patch',
                fromKey: String(entry.remoteKey || ''),
                fromName: String(incomingCharacter.name || entry.playerName || ''),
                toKey: 'master',
                toName: 'Mestre',
                entityType: 'player',
                entityId: String(entry.remoteKey || ''),
                ackRequired: false,
                progressionPatch: {
                  level: joinLevel,
                  className,
                  race: String(incomingCharacter.race || ''),
                  hpCurrent: joinHpCurrent,
                  hpMax: joinHpMax,
                  stats: parseJoinStats(incomingCharacter.stats),
                  spells: incomingCharacter.spells,
                  saveValues: incomingCharacter.save_values ?? incomingCharacter.saveValues,
                  skillValues: incomingCharacter.skill_values ?? incomingCharacter.skillValues,
                  proficiencies: incomingCharacter.proficiencies,
                  characterSnapshot: incomingCharacter,
                },
                message: `${String(incomingCharacter.name || entry.playerName || 'Jogador')} sincronizou progressao ao reconectar.`,
                createdAt: new Date().toISOString(),
              } as LanSessionEvent, 'join_snapshot_progression_runtime_first');
            }
            const runtimePayload = payload
              ? { ...payload, state: sessionStateRef.current || payload.state }
              : null;
            traceApp('LAN_JOIN', 'MASTER_JOIN_RUNTIME_PLAYER_REUSED_IMMEDIATE_V89', {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
              decision: 'complete_join_before_sqlite_upsert',
            });
            completedHostJoinAtRef.current[joinKey] = Date.now();
            update.completeJoin?.(runtimePayload);
            broadcastRosterPublicStatus(runtimePayload, 'join_runtime_reused_immediate');

            void (async () => {
              try {
                const upsertResult = await upsertLanSessionPlayerFromNetwork(db, entry);
                traceApp('LAN_JOIN', 'MASTER_JOIN_BACKGROUND_UPSERT_DONE_V89', {
                  screen: 'lan-session',
                  source: 'subscribeLanSessionHostUpdates',
                  sessionId: activeSessionId,
                  remoteKey: entry.remoteKey,
                  clientId: entry.clientId,
                  playerName: entry.playerName,
                  result: upsertResult,
                });
                const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
                if (syncedPayload) {
                  applyExternalPayload(syncedPayload, 'sqlite');
                  broadcastRosterPublicStatus(syncedPayload, 'join_runtime_reused_background_sync');
                }
              } catch (error) {
                traceError('LAN_JOIN', 'MASTER_JOIN_BACKGROUND_UPSERT_FAILED_V89', error, {
                  screen: 'lan-session',
                  source: 'subscribeLanSessionHostUpdates',
                  sessionId: activeSessionId,
                  remoteKey: entry.remoteKey,
                  clientId: entry.clientId,
                  playerName: entry.playerName,
                });
              }
            })();
            return;
          }

          const currentJoinPromise = pendingHostJoinPromisesRef.current[joinKey];
          if (currentJoinPromise) {
            traceApp('LAN_JOIN', 'MASTER_JOIN_DUPLICATE_ATTACHED_TO_IN_FLIGHT', {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
            });
            currentJoinPromise
              .then((syncedPayload) => {
                update.completeJoin?.(syncedPayload);
                broadcastRosterPublicStatus(syncedPayload, 'join_duplicate_in_flight_roster_sync');
              })
              .catch((error) => {
                traceError('LAN_JOIN', 'MASTER_JOIN_DUPLICATE_ATTACH_FAILED', error, {
                  screen: 'lan-session',
                  source: 'subscribeLanSessionHostUpdates',
                  sessionId: activeSessionId,
                  remoteKey: entry.remoteKey,
                  clientId: entry.clientId,
                  playerName: entry.playerName,
                });
                update.rejectJoin?.('JOIN_UPSERT_FAILED');
              });
            return;
          }

          if (hasRuntimePlayer && now - (completedHostJoinAtRef.current[joinKey] || 0) < 15000) {
            traceApp('LAN_JOIN', 'MASTER_JOIN_DUPLICATE_READY_REUSED', {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
            });
            const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            if (syncedPayload) applyExternalPayload(syncedPayload, 'sqlite');
            update.completeJoin?.(syncedPayload);
            broadcastRosterPublicStatus(syncedPayload, 'join_duplicate_ready_roster_sync');
            return;
          }

          const processJoinPromise = (async () => {
            traceApp('LAN_JOIN', 'MASTER_JOIN_UPSERT_START', {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
            });
            const upsertResult = await upsertLanSessionPlayerFromNetwork(db, entry);
            traceApp('LAN_JOIN', 'MASTER_JOIN_UPSERT_DONE', {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
              result: upsertResult,
            });
            if (!upsertResult) {
              traceApp('LAN_JOIN', 'MASTER_JOIN_UPSERT_REJECTED', {
                screen: 'lan-session',
                source: 'subscribeLanSessionHostUpdates',
                sessionId: activeSessionId,
                remoteKey: entry.remoteKey,
                clientId: entry.clientId,
                playerName: entry.playerName,
              });
              throw new Error('JOIN_UPSERT_FAILED');
            }
            const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            if (syncedPayload) {
              applyExternalPayload(syncedPayload, 'sqlite');
              traceApp('LAN_JOIN', 'MASTER_JOIN_RUNTIME_PLAYER_ADDED', {
                screen: 'lan-session',
                source: 'subscribeLanSessionHostUpdates',
                sessionId: activeSessionId,
                remoteKey: entry.remoteKey,
                clientId: entry.clientId,
                playerName: entry.playerName,
                playerCount: syncedPayload.state?.players?.length || 0,
                hasOfficialPlayer: Boolean((syncedPayload.state?.players || []).some((player) => (
                  player.remoteKey === entry.remoteKey ||
                  (entry.clientId && player.clientId === entry.clientId) ||
                  player.characterName === entry.playerName
                ))),
              });
            }
            completedHostJoinAtRef.current[joinKey] = Date.now();
            return syncedPayload;
          })();

          pendingHostJoinPromisesRef.current[joinKey] = processJoinPromise;
          try {
            const syncedPayload = await processJoinPromise;
            update.completeJoin?.(syncedPayload);
            broadcastRosterPublicStatus(syncedPayload, 'join_roster_full_sync');
            if (syncedPayload) {
              void (async () => {
                setSessionEvents(await getLanSessionEvents(db, activeSessionId, SESSION_HISTORY_INITIAL_LIMIT));
                setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
              })().catch((error) => {
                debugLanFlow('MASTER_JOIN_HISTORY_REFRESH_FAILED', {
                  sessionId: activeSessionId,
                  remoteKey: entry.remoteKey,
                  clientId: entry.clientId,
                  reason: error instanceof Error ? error.message : String(error),
                });
              });
            }
          } catch (error) {
            traceError('LAN_JOIN', 'MASTER_JOIN_UPSERT_ERROR', error, {
              screen: 'lan-session',
              source: 'subscribeLanSessionHostUpdates',
              sessionId: activeSessionId,
              remoteKey: entry.remoteKey,
              clientId: entry.clientId,
              playerName: entry.playerName,
            });
            update.rejectJoin?.('JOIN_UPSERT_FAILED');
          } finally {
            if (pendingHostJoinPromisesRef.current[joinKey] === processJoinPromise) {
              delete pendingHostJoinPromisesRef.current[joinKey];
            }
          }        })();
        return;
      }
      if (update?.event?.sessionId === activeSessionId && update.event.type === 'player_progression_patch' && update.event.progressionPatch) {
        void (async () => {
          const event = update.event!;
          traceApp('EVENT_RECEIVED', 'MASTER_LEVEL_UP_PATCH_RECEIVED_IMMEDIATE', {
            screen: 'lan-session',
            source: 'subscribeLanSessionHostUpdates',
            sessionId: activeSessionId,
            eventId: event.id,
            eventType: event.type,
            fromKey: event.fromKey,
            playerName: event.fromName,
            payload: event.progressionPatch,
          });
          await applyProgressionPatchRuntimeFirst(event, 'socket_progression_patch_runtime_first');
          const appliedPlayerId = await applyLanPlayerProgressionPatchFromEvent(db, activeSessionId, event);
          if (appliedPlayerId) {
            const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            if (syncedPayload) {
              applyExternalPayload(syncedPayload, 'sqlite');
              setSessionEvents(await getLanSessionEvents(db, activeSessionId, SESSION_HISTORY_INITIAL_LIMIT));
              setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
            }
          }
        })();
        return;
      }

      if (update?.event?.sessionId === activeSessionId && update.event.type === 'resource_request') {
        void (async () => {
          const event = update.event!;
          traceApp('EVENT_RECEIVED', 'MASTER_REQUEST_RECEIVED_IMMEDIATE', {
            screen: 'lan-session',
            source: 'subscribeLanSessionHostUpdates',
            sessionId: activeSessionId,
            eventId: event.id,
            eventType: event.type,
            fromKey: event.fromKey,
            playerName: event.fromName,
            payload: event.resourceRequest,
          });
          // Pedido do jogador precisa aparecer no mestre imediatamente.
          // Persistência e ensure de player ficam em background para não quebrar a imersão.
          if (event.id) seenNativeHostEventIdsRef.current.add(String(event.id));
          setSessionEvents((current) => mergeMasterTimelineEvent(current, event));
          void rememberLanSessionEvent(db, event).catch(() => false);
          void ensurePendingRemotePlayerFromEvent(db, activeSessionId, event).catch(() => null);
          traceApp('UI_UPDATE', 'MASTER_RESOURCE_REQUEST_VISIBLE', {
            screen: 'lan-session',
            source: 'subscribeLanSessionHostUpdates',
            sessionId: activeSessionId,
            eventId: event.id,
            eventType: event.type,
            playerName: event.fromName,
            decision: 'runtime_visible_before_sqlite',
          });
        })();
        return;
      }
      if (update?.event?.sessionId === activeSessionId && update.event.type === 'coin_self_patch_request') {
        void handleHostCoinSelfPatchEvent(update.event, 'realtime');
        return;
      }

      if (update?.event?.sessionId === activeSessionId && update.event.type === 'inventory_patch') {
        void handleHostInventoryPatchEvent(update.event, 'realtime');
        return;
      }

      if (update?.event?.sessionId === activeSessionId && update.event.type === 'effect_patch') {
        void handleHostEffectPatchEventFast(update.event, 'realtime');
        return;
      }

      if (update?.event?.sessionId === activeSessionId && update.event.type === 'send_item_request') {
        void (async () => {
          const handled = await handleHostSendItemRequestFast(update.event!);
          if (!handled) void pollJoinedPlayers();
        })();
        return;
      }

      if (update?.event?.sessionId === activeSessionId && update.event.type === 'trade_accept') {
        void (async () => {
          const handled = await handleHostTradeAcceptFast(update.event!);
          if (!handled) void pollJoinedPlayers();
        })();
        return;
      }

      if (update?.event?.sessionId === activeSessionId) {
        traceApp('SUBSCRIPTION_UPDATE', 'MASTER_SUBSCRIPTION_EVENT_PROCESS_NOW', {
          screen: 'lan-session',
          source: 'subscribeLanSessionHostUpdates',
          sessionId: activeSessionId,
          joinUrl,
          eventId: update.event.id,
          eventType: update.event.type,
          envelopeType: update.envelopeType,
          decision: 'process_native_event_immediately',
        });
        void pollJoinedPlayers();
        return;
      }

      traceApp('SUBSCRIPTION_UPDATE', 'MASTER_SUBSCRIPTION_NO_CHANGE_SKIPPED', {
        screen: 'lan-session',
        source: 'subscribeLanSessionHostUpdates',
        sessionId: activeSessionId,
        joinUrl,
        decision: 'host_update_notification_is_not_state_change',
      });
    });
    return () => {
      clearInterval(timer);
      unsubscribeRealtime();
    };
  }, [
    activeSessionId,
    applyExternalPayload,
    db,
    joinUrl,
    reloadSessionState,
    handleHostCoinSelfPatchEvent,
    handleHostInventoryPatchEvent,
    handleHostEffectPatchEventFast,
    applyProgressionPatchRuntimeFirst,
    handleHostSendItemRequestFast,
    handleHostTradeAcceptFast,
    rememberSentEventInTimeline,
    applyHostInventoryRuntimePatch,
    sendActionResult,
    sendEffectSaveRequest,
    sendItemTransferResult,
    sendOfficialInventoryPatch,
    sendRecentLiveEvents,
    sendTradeResult,
  ]);

  const handleStartSession = async () => {
    const parsedLevel = Math.max(1, Math.min(20, parseInt(level, 10) || 1));
    const startedAt = Date.now();
    traceButton('lan-session', 'START_LAN_SESSION', {
      source: 'master_click',
      args: { sessionName, masterName, level: parsedLevel, allowExisting },
    });

    const activeConflict = await getActiveLanSessionConflict(db, undefined, 'master');
    if (activeConflict) {
      Alert.alert(
        'Sessão LAN ativa',
        `Você já está ${activeConflict.role === 'master' ? 'mestrando' : 'jogando'} em uma sessão ativa: ${activeConflict.sessionName}. Pause, saia ou encerre essa sessão antes de iniciar outra.`
      );
      return;
    }

    setLoading(true);

    try {
      // Troca explicitamente para o papel de mestre sem apagar sessões salvas.
      await switchLanRole('master');
      await stopLanServer();

      const nextPayload = await buildLanSessionPayload(db, {
        id: makeSessionId(),
        name: sessionName.trim() || 'Mesa de D&D',
        masterName: masterName.trim() || 'Mestre',
        level: parsedLevel,
        allowExisting,
        inviteCode: makeInviteCode(),
      }, selectionFromKeys(selectedCatalogKeys));

      const nextJoinUrl = await startLanServer(nextPayload);

      if (!nextJoinUrl) {
        throw new Error('Servidor TCP não retornou URL. A sessão não será salva.');
      }

      await saveLanSession(db, nextPayload, nextJoinUrl, { isMaster: true });
      replaceLanRuntimeStateFromBootstrap(nextPayload.session.id, nextPayload.state || null);
      setPayload(nextPayload);
      setSessionState(nextPayload.state || null);
      setSessionEvents([]);
      setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
      setSessionHistoryHasMore(true);
      setPendingSaves([]);
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedPlayerId(null);

      await loadSavedSessions();
      traceFunctionReturn('handleStartSession', {
        sessionId: nextPayload.session.id,
        joinUrl: nextJoinUrl,
      }, {
        screen: 'lan-session',
        source: 'master_click',
        sessionId: nextPayload.session.id,
        durationMs: Date.now() - startedAt,
      });

      if (isEmulatorOnlyTcpUrl(nextJoinUrl)) {
        Alert.alert(
          'IP do emulador detectado',
          'A mesa abriu em IP interno do emulador. Para socket puro, use o celular fisico como mestre ou redirecione a porta TCP do emulador e entre manualmente por tcp://10.0.2.2:43115/... em outro emulador.'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      Alert.alert(
        'Erro ao iniciar sessão LAN',
        message || 'Erro desconhecido ao iniciar a sessão.'
      );

      console.error('[LAN] Erro ao iniciar sessão:', error);
      traceError('LAN_JOIN', 'START_LAN_SESSION_ERROR', error, {
        screen: 'lan-session',
        source: 'master_click',
        durationMs: Date.now() - startedAt,
      });
      } finally {
      setLoading(false);
    }
  };

  const handleResumeSavedSession = async (session: LanSessionSummary) => {
    const startedAt = Date.now();
    traceButton('lan-session', 'RESUME_SAVED_SESSION', {
      source: 'master_click',
      sessionId: session.id,
      args: { isMaster: session.isMaster, status: session.status, joinUrl: session.joinUrl },
    });
    const activeConflict = await getActiveLanSessionConflict(db, session.id, session.isMaster ? 'master' : 'player');
    if (activeConflict) {
      Alert.alert(
        'Sessão LAN ativa',
        `Você já está ${activeConflict.role === 'master' ? 'mestrando' : 'jogando'} em uma sessão ativa: ${activeConflict.sessionName}. Pause, saia ou encerre essa sessão antes de trocar.`
      );
      return;
    }

    if (!session.isMaster) {
      const bound = await getBoundLanCharacter(db, session.id);
      if (bound?.characterId) {
        router.replace(`/sheet?id=${bound.characterId}&sessionId=${session.id}&joinUrl=${encodeURIComponent(session.joinUrl || bound.joinUrl || '')}` as any);
      } else {
        router.replace(`/sessionJoin?code=${session.inviteCode}&url=${encodeURIComponent(session.joinUrl || '')}` as any);
      }
      return;
    }

    setLoading(true);
    try {
      traceApp('LAN_JOIN', 'RESUME_SESSION_FAST_START', {
        screen: 'lan-session',
        source: 'handleResumeSavedSession',
        sessionId: session.id,
        joinUrl: session.joinUrl,
      });
      await switchLanRole('master');
      await db.runAsync(
        `UPDATE lan_sessions SET status = 'active', active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [session.id]
      );
      const savedRow = await db.getFirstAsync<{ payloadJson?: string }>(
        `SELECT payload_json as payloadJson FROM lan_sessions WHERE id = ? LIMIT 1`,
        [session.id]
      );
      let nextPayload = parsePayloadJson(savedRow?.payloadJson);
      if (!nextPayload) {
        nextPayload = await buildLanSessionPayload(db, {
          id: session.id,
          name: session.name,
          masterName: session.masterName,
          level: session.level,
          allowExisting: session.allowExisting,
          inviteCode: session.inviteCode || makeInviteCode(),
        }, session.selectedCatalog);
        nextPayload.state = await getLanSessionState(db, session.id);
      } else if (!nextPayload.state) {
        nextPayload = { ...nextPayload, state: await getLanSessionState(db, session.id) };
      }
      if (!nextPayload) throw new Error('Sessão não encontrada.');
      const resumedHostInstanceId = makeLanHostInstanceId();
      const activeState = nextPayload.state
        ? { ...nextPayload.state, status: 'active' as const }
        : { ...(await getLanSessionState(db, session.id)), status: 'active' as const };
      nextPayload = {
        ...nextPayload,
        session: { ...nextPayload.session, hostInstanceId: resumedHostInstanceId },
        state: activeState,
      };

      const nextJoinUrl = await startLanServer(nextPayload);

      if (!nextJoinUrl) {
        throw new Error('Servidor TCP não retornou URL ao retomar a sessão. A sessão não será salva como ativa.');
      }

      await saveLanSession(db, nextPayload, nextJoinUrl, { isMaster: true });
      applyExternalPayload(nextPayload, 'sqlite');
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedCatalogKeys(keysFromSelection(nextPayload.selectedCatalog));
      traceApp('LAN_JOIN', 'RESUME_SESSION_UI_READY', {
        screen: 'lan-session',
        source: 'handleResumeSavedSession',
        sessionId: session.id,
        joinUrl: nextJoinUrl,
        payload: {
          playerCount: nextPayload.state?.players?.length || 0,
          eventCount: nextPayload.events?.length || 0,
        },
      });
      void (async () => {
        try {
          traceApp('LAN_JOIN', 'RESUME_SESSION_BACKGROUND_LOAD_START', {
            screen: 'lan-session',
            source: 'handleResumeSavedSession',
            sessionId: session.id,
          });
          const [events, pendingSaves, nextState] = await Promise.all([
            getLanSessionEvents(db, session.id, SESSION_HISTORY_INITIAL_LIMIT),
            listPendingSaves(db, session.id),
            getLanSessionState(db, session.id),
          ]);
          applyExternalSessionState(session.id, nextState, 'sqlite');
          setSessionEvents(events);
          setPendingSaves(pendingSaves);
          traceApp('LAN_JOIN', 'RESUME_SESSION_BACKGROUND_LOAD_DONE', {
            screen: 'lan-session',
            source: 'handleResumeSavedSession',
            sessionId: session.id,
            result: {
              eventCount: events.length,
              pendingSaveCount: pendingSaves.length,
              playerCount: nextState.players.length,
            },
          });
        } catch (error) {
          traceError('LAN_JOIN', 'RESUME_SESSION_BACKGROUND_LOAD_ERROR', error, {
            screen: 'lan-session',
            source: 'handleResumeSavedSession',
            sessionId: session.id,
          });
        }
      })();
      await loadSavedSessions();
      traceFunctionReturn('handleResumeSavedSession', {
        sessionId: session.id,
        joinUrl: nextJoinUrl,
      }, {
        screen: 'lan-session',
        source: 'master_click',
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
      });
      if (isEmulatorOnlyTcpUrl(nextJoinUrl)) {
        Alert.alert(
          'IP do emulador detectado',
          'A mesa retomou em IP interno do emulador. Para socket puro, use o celular fisico como mestre ou redirecione a porta TCP do emulador e entre manualmente por tcp://10.0.2.2:43115/... em outro emulador.'
        );
      }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        Alert.alert(
          'Erro ao retomar sessão LAN',
          message || 'Erro desconhecido ao retomar a sessão.'
        );

        console.error('[LAN] Erro ao retomar sessão:', error);
      } finally {
      setLoading(false);
    }
  };

  const finishStopSession = useCallback(async () => {
    const sessionIdForGuard = payload?.session.id || '';
    const endGuardKey = sessionIdForGuard ? `${sessionIdForGuard}:end_session` : '';
    if (endingSessionRef.current || (endGuardKey && !acquireMasterLifecycleAction(endGuardKey, 10000))) {
      traceApp('LAN_JOIN', 'MASTER_SESSION_END_IGNORED_ALREADY_ENDING', {
        screen: 'lan-session',
        source: 'finishStopSession',
        sessionId: payload?.session.id,
      });
      return;
    }
    endingSessionRef.current = true;
    setIsEndingSession(true);
    const endingPlayers = sessionStateRef.current?.players || [];
    const endingState = payload?.session.id && sessionStateRef.current
      ? { ...sessionStateRef.current, status: 'ended' as const, players: [] }
      : null;
    if (payload?.session.id) {
      if (endingState) {
        sessionStateRef.current = endingState;
        setSessionState(endingState);
      }
      setPayload((current) => current ? ({ ...current, state: endingState || current.state }) : current);
      setSelectedPlayerId(null);
      setExpandedPlayerIds([]);
    }
    try {
    if (payload) {
      traceApp('LAN_JOIN', 'MASTER_END_SESSION_START', {
        screen: 'lan-session',
        source: 'finishStopSession',
        sessionId: payload.session.id,
        joinUrl,
      });
      traceApp('EVENT_CREATED', 'MASTER_SESSION_ENDED_BROADCAST_START', {
        screen: 'lan-session',
        source: 'finishStopSession',
        sessionId: payload.session.id,
      });
      const endedAt = new Date().toISOString();
      if (!getLanProjection(payload.session.id)) {
        applyIncomingSnapshot(legacyPayloadToLanSnapshot(payload, {
          source: 'bootstrap',
          structural: true,
          snapshotSeq: Date.now(),
        }));
      }
      const engineEndResult = dispatchMasterCommand({
        type: 'end_session',
        commandId: `master_end:${payload.session.id}:${Date.now()}`,
        sessionId: payload.session.id,
        actorKey: 'master',
      });
      applyProjectionToMasterUi(engineEndResult.projection);
      const engineEndedEvent = authoritativeEventToLanSessionEvent(engineEndResult.event, {
        message: 'O mestre encerrou a campanha. As fichas foram desvinculadas da sessao.',
      });
      const endedEvent: LanSessionEvent = engineEndedEvent || {
        id: makeLanEventId(),
        sessionId: payload.session.id,
        type: 'session_ended',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: 'all',
        toName: 'Todos',
        entityType: 'session',
        entityId: payload.session.id,
        entityRevision: Date.now(),
        ackRequired: true,
        originClientId: 'master',
        sessionEnded: {
          endedAt,
          reason: 'campaign_finished',
          unlinkPlayers: true,
          allowOfflineAfterEnd: true,
          preserveOfficialRewards: true,
          clearTemporarySessionEffects: true,
        },
        message: 'O mestre encerrou a campanha. As fichas foram desvinculadas da sessao.',
        createdAt: endedAt,
      };
      updateLanTcpHostPayload({
        ...payload,
        state: endingState || { ...((payload.state || {}) as any), status: 'ended', players: [] },
      }, { broadcast: false });
      const sentEvent = endedEvent;
      rememberSentEventInTimeline(endedEvent);
      setSessionEvents((current) => mergeMasterTimelineEvent(current, endedEvent));
      await sendLanSessionEvent(joinUrl, endedEvent).catch((error) => {
        traceError('SOCKET_SEND_START', 'MASTER_SESSION_ENDED_EVENT_SEND_ERROR', error, {
          screen: 'lan-session',
          source: 'finishStopSession',
          sessionId: payload.session.id,
          eventId: endedEvent.id,
        });
        return false;
      });
      void rememberLanSessionEvent(db, endedEvent).catch(() => false);
      for (const player of endingPlayers) {
        if (!player.remoteKey) continue;
        traceApp('EVENT_CREATED', 'MASTER_SESSION_ENDED_SENT_TO_PLAYER', {
          screen: 'lan-session',
          source: 'finishStopSession',
          sessionId: payload.session.id,
          eventId: sentEvent.id,
          playerKey: player.remoteKey,
          playerName: player.characterName,
        });
      }
      if (joinUrl) {
        traceApp('EVENT_CREATED', 'MASTER_SESSION_ENDED_SENT', {
          screen: 'lan-session',
          source: 'finishStopSession',
          sessionId: payload.session.id,
          eventId: sentEvent.id,
          eventType: sentEvent.type,
        });
        void waitForSessionEndAcks(sentEvent.id, payload.session.id, endingPlayers);
      }
      await db.runAsync(
        `UPDATE lan_sessions
         SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [payload.session.id]
      );
      await db.runAsync(
        `UPDATE lan_session_players
         SET is_active = 0,
             is_connected = 0,
             kicked_at = COALESCE(kicked_at, CURRENT_TIMESTAMP),
             last_seen_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`,
        [payload.session.id]
      );
      traceApp('SQLITE_WRITE_DONE', 'MASTER_SESSION_ENDED_DB_DONE', {
        screen: 'lan-session',
        source: 'finishStopSession',
        sessionId: payload.session.id,
      });
    }
    await stopLanServer();
    traceApp('SOCKET_SEND_DONE', 'MASTER_SESSION_HOST_STOPPED', {
      screen: 'lan-session',
      source: 'finishStopSession',
      sessionId: payload?.session.id,
    });
    resetLanClientConnection();
    if (payload?.session.id) {
      replaceLanRuntimeStateFromBootstrap(payload.session.id, null);
    }
    traceApp('STATE_CHANGE', 'MASTER_SESSION_RUNTIME_CLEARED', {
      screen: 'lan-session',
      source: 'finishStopSession',
      sessionId: payload?.session.id,
    });
    setPayload(null);
    setSessionState(null);
    setSessionEvents([]);
      setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
      setSessionHistoryHasMore(true);
    setJoinUrl('');
    setJoinLink('');
    setSelectedPlayerId(null);
    await loadSavedSessions();
    traceApp('UI_UPDATE', 'MASTER_SESSION_UI_CLOSED_AFTER_END', {
      screen: 'lan-session',
      source: 'finishStopSession',
      sessionId: payload?.session.id,
    });
    router.replace('/' as any);
    } catch (error) {
      endingSessionRef.current = false;
      if (endGuardKey) releaseMasterLifecycleAction(endGuardKey);
      setIsEndingSession(false);
      traceError('LAN_JOIN', 'MASTER_SESSION_END_FAILED', error, {
        screen: 'lan-session',
        source: 'finishStopSession',
        sessionId: payload?.session.id,
      });
      throw error;
    }

    async function waitForSessionEndAcks(eventId: string, sessionId: string, players: LanSessionPlayerState[]) {
      const pendingKeys = new Set(players.map((player) => player.remoteKey).filter(Boolean) as string[]);
      const deadline = Date.now() + 5500;

      while (pendingKeys.size > 0 && Date.now() < deadline) {
        const acks = await getNativeSessionAcks(joinUrl).catch(() => []);
        for (const ack of acks) {
          const ackEventId = String((ack as any).eventId || '');
          const ackPlayerKey = String((ack as any).playerKey || '');
          if (ackEventId !== eventId || !pendingKeys.has(ackPlayerKey)) continue;
          pendingKeys.delete(ackPlayerKey);
          traceApp('EVENT_RECEIVED', 'MASTER_SESSION_ENDED_ACK_RECEIVED', {
            screen: 'lan-session',
            source: 'finishStopSession',
            sessionId,
            eventId,
            playerKey: ackPlayerKey,
          });
        }
        if (pendingKeys.size > 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }

      for (const playerKey of pendingKeys) {
        traceApp('EVENT_RECEIVED', 'MASTER_SESSION_ENDED_ACK_TIMEOUT', {
          screen: 'lan-session',
          source: 'finishStopSession',
          sessionId,
          eventId,
          playerKey,
        });
      }
    }
  }, [db, joinUrl, loadSavedSessions, payload, router]);

  const handleStopSession = useCallback(async () => {
    if (endingSessionRef.current || isEndingSession) {
      traceApp('LAN_JOIN', 'MASTER_SESSION_END_IGNORED_ALREADY_ENDING', {
        screen: 'lan-session',
        source: 'handleStopSession',
        sessionId: payload?.session.id,
      });
      return;
    }
    if (!payload) {
      await finishStopSession();
      return;
    }
    traceApp('LAN_JOIN', 'MASTER_END_SESSION_CONFIRM_OPENED', {
      screen: 'lan-session',
      source: 'handleStopSession',
      sessionId: payload.session.id,
      joinUrl,
    });
    Alert.alert(
      'Encerrar campanha?',
      'Isso finalizara definitivamente esta sessao.\nAs fichas dos jogadores serao desvinculadas da mesa.\nCada jogador podera continuar usando sua ficha no modo offline ou vincula-la em outra sessao depois.\n\nEsta acao nao e igual a pausar.',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: () => {
            traceApp('LAN_JOIN', 'MASTER_END_SESSION_CANCELLED', {
              screen: 'lan-session',
              source: 'handleStopSession',
              sessionId: payload.session.id,
            });
          },
        },
        {
          text: 'Encerrar definitivamente',
          style: 'destructive',
          onPress: () => {
            void finishStopSession();
          },
        },
      ]
    );
  }, [finishStopSession, isEndingSession, joinUrl, payload]);

  useEffect(() => {
    if (!payload?.session?.id) return;

    let handlingStopRequest = false;
    const stopFromNotification = async () => {
      if (handlingStopRequest) return;
      handlingStopRequest = true;
      try {
        await handleStopSession();
      } finally {
        handlingStopRequest = false;
      }
    };

    const unsubscribe = subscribeLanForegroundStop(() => {
      void stopFromNotification();
    });

    const timer = setInterval(() => {
      void (async () => {
        if (await consumeLanForegroundStopRequest()) {
          await stopFromNotification();
        }
      })();
    }, 1500);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [handleStopSession, payload?.session?.id]);

  const handleCopyInviteCode = async () => {
    if (!payload) return;
    await Clipboard.setStringAsync(payload.session.inviteCode);
    Alert.alert(
      'Codigo copiado',
      joinUrl
        ? `Codigo ${payload.session.inviteCode} copiado. O jogador pode digitar esse codigo em Entrada manual na mesma rede.`
        : `Codigo ${payload.session.inviteCode} copiado, mas a mesa ainda nao tem socket TCP ativo para entrada por codigo.`
    );
  };

  const handleCopyJoinInvite = async () => {
    if (!payload || !joinLink) return;
    await Clipboard.setStringAsync(joinLink);
    Alert.alert('Convite copiado', 'O jogador pode colar esse convite em Entrada manual para entrar como jogador.');
  };

  const handleDeleteSavedSession = (session: LanSessionSummary) => {
    Alert.alert(
      'Excluir sessão',
      `Excluir "${session.name}" e os jogadores salvos nela?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            if (payload?.session.id === session.id) {
              await stopLanServer();
              resetLanClientConnection();
              setPayload(null);
              setSessionState(null);
              setSessionEvents([]);
      setSessionHistoryLimit(SESSION_HISTORY_INITIAL_LIMIT);
      setSessionHistoryHasMore(true);
              setJoinUrl('');
              setJoinLink('');
              setSelectedPlayerId(null);
            }
            await deleteLanSession(db, session.id);
            await loadSavedSessions();
          },
        },
      ]
    );
  };

  const handleTogglePause = async () => {
    if (!payload || !sessionStateRef.current || pauseToggleRunningRef.current || endingSessionRef.current) return;
    const sessionId = payload.session.id;
    const latestState = sessionStateRef.current || sessionState;
    const wasPaused = latestState.status === 'paused';
    const targetStatus = wasPaused ? 'active' : 'paused';
    const lifecycleKey = `${sessionId}:toggle:${targetStatus}`;
    if (!acquireMasterLifecycleAction(lifecycleKey, 2500)) {
      debugLanFlow('MASTER_SESSION_TOGGLE_DEDUPED_V109', {
        sessionId,
        targetStatus,
        currentStatus: latestState.status,
      });
      return;
    }

    if (wasPaused) {
      const activeConflict = await getActiveLanSessionConflict(db, sessionId, 'master');
      if (activeConflict) {
        releaseMasterLifecycleAction(lifecycleKey);
        Alert.alert(
          'SessÃ£o LAN ativa',
          `VocÃª jÃ¡ estÃ¡ ${activeConflict.role === 'master' ? 'mestrando' : 'jogando'} em uma sessÃ£o ativa: ${activeConflict.sessionName}. Pause, saia ou encerre essa sessÃ£o antes de retomar outra.`
        );
        return;
      }
    }

    pauseToggleRunningRef.current = true;
    const resumedHostInstanceId = wasPaused ? makeLanHostInstanceId() : payload.session.hostInstanceId;
    try {
      dispatchMasterEngineCommand({
        type: wasPaused ? 'resume_session' : 'pause_session',
        commandId: `master_${wasPaused ? 'resume' : 'pause'}:${sessionId}:${Date.now()}`,
        sessionId,
        actorKey: 'master',
      }, {
        hostInstanceId: resumedHostInstanceId,
        message: wasPaused ? 'O mestre retomou a sessao.' : 'O mestre pausou a sessao. A campanha continuara depois.',
      });

      if (wasPaused) {
        setPayload((current) => current ? ({ ...current, session: { ...current.session, hostInstanceId: resumedHostInstanceId } }) : current);
      }

      void (async () => {
        try {
          await db.runAsync(
            `UPDATE lan_sessions
             SET status = ?, active = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND COALESCE(status, 'active') != 'ended'`,
            [targetStatus, sessionId],
          );
          if (wasPaused) {
            const currentPayload = payload
              ? { ...payload, session: { ...payload.session, hostInstanceId: resumedHostInstanceId }, state: { ...latestState, status: 'active' as const } }
              : null;
            if (currentPayload) await saveLanSession(db, currentPayload, joinUrl, { isMaster: true });
            await recordMasterTimelineEvent('Mestre continuou a campanha.').catch(() => false);
          } else {
            await recordMasterTimelineEvent('Mestre pausou a campanha para continuar depois.').catch(() => false);
          }
          await loadSavedSessions().catch(() => undefined);
        } catch (error) {
          debugLanFlow('MASTER_SESSION_TOGGLE_ENGINE_DB_FAILED', {
            sessionId,
            targetStatus,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    } finally {
      pauseToggleRunningRef.current = false;
      releaseMasterLifecycleAction(lifecycleKey);
    }
    return;

    /*
     * @deprecated Corte 3: caminho antigo de pause/resume substituido por
     * pause_session/resume_session acima. Mantido temporariamente apenas como
     * referencia durante a migracao LAN.
     *
    if (!wasPaused) {
      pauseToggleRunningRef.current = true;
      sessionLifecycleLockUntilRef.current = Date.now() + 12000;
      traceApp('LAN_JOIN', 'MASTER_SESSION_PAUSE_FAST_START_V106', {
        screen: 'lan-session',
        source: 'handleTogglePause',
        sessionId,
      });

      const now = new Date().toISOString();
      const optimisticState: LanSessionState = { ...latestState, status: 'paused' as const };
      sessionStateRef.current = optimisticState;
      setSessionState(optimisticState);
      setPayload((current) => current ? ({ ...current, state: optimisticState }) : current);
      // v107: pausar nao derruba mais o socket. Mantemos o host vivo e apenas
      // atualizamos o snapshot em memoria para que o jogador receba pause/resume
      // no mesmo joinUrl/porta.
      updateLanTcpHostPayload({ ...payload, state: optimisticState }, { broadcast: false });

      const seq = Date.now();
      const event: LanSessionEvent = {
        id: makeLanEventId(),
        sessionId,
        seq,
        serverSeq: seq,
        type: 'session_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: 'all',
        toName: 'Todos',
        entityType: 'session',
        entityId: sessionId,
        entityRevision: seq,
        ackRequired: false,
        originClientId: 'master',
        sessionPatch: {
          status: 'paused',
          pausedAt: now,
          reason: 'master_paused',
          keepPlayersLinked: true,
          readOnlyForPlayers: true,
          hostInstanceId: payload.session.hostInstanceId,
        },
        message: 'O mestre pausou a sessao. A campanha continuara depois.',
        createdAt: now,
      };

      rememberSentEventInTimeline(event);
      setSessionEvents((current) => mergeMasterTimelineEvent(current, event));
      void sendLanSessionEvent(joinUrl, event).catch((error) => {
        debugLanFlow('MASTER_SESSION_PAUSE_FAST_SEND_FAILED_V106', {
          sessionId,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      void rememberLanSessionEvent(db, event).catch(() => false);
      void db.runAsync(
        `UPDATE lan_sessions
         SET status = 'paused', active = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND COALESCE(status, 'active') != 'ended'`,
        [sessionId],
      ).then(async () => {
        // v107: nao parar o servidor TCP aqui. Se a porta muda durante a pausa,
        // os jogadores continuam presos no joinUrl antigo e nunca recebem o evento
        // de retomada. A sessao fica read-only pelo status=paused.
        updateLanTcpHostPayload({ ...payload, state: optimisticState }, { broadcast: false });
        await recordMasterTimelineEvent('Mestre pausou a campanha para continuar depois.').catch(() => false);
        await loadSavedSessions().catch(() => undefined);
        debugLanFlow('MASTER_SESSION_PAUSED_DB_DONE_V107_KEEP_SOCKET', { sessionId });
      }).catch((error) => {
        debugLanFlow('MASTER_SESSION_PAUSED_DB_FAILED_V106', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        pauseToggleRunningRef.current = false;
        releaseMasterLifecycleAction(lifecycleKey);
      });

      debugLanFlow('MASTER_SESSION_PAUSED_SENT_FAST_V106', {
        sessionId,
        eventId: event.id,
        decision: 'ui_and_socket_before_sqlite',
      });
      return;
    }

    const activeConflict = await getActiveLanSessionConflict(db, sessionId, 'master');
    if (activeConflict) {
      releaseMasterLifecycleAction(lifecycleKey);
      Alert.alert(
        'Sessão LAN ativa',
        `Você já está ${activeConflict.role === 'master' ? 'mestrando' : 'jogando'} em uma sessão ativa: ${activeConflict.sessionName}. Pause, saia ou encerre essa sessão antes de retomar outra.`
      );
      return;
    }

    pauseToggleRunningRef.current = true;
    sessionLifecycleLockUntilRef.current = Date.now() + 12000;
    const resumedHostInstanceId = makeLanHostInstanceId();
    traceApp('LAN_JOIN', 'MASTER_SESSION_RESUME_FAST_START_V108', {
      screen: 'lan-session',
      source: 'handleTogglePause',
      sessionId,
    });

    const nowIso = new Date().toISOString();
    const optimisticState: LanSessionState = { ...latestState, status: 'active' as const };
    const payloadForUi = {
      ...payload,
      session: { ...payload.session, hostInstanceId: resumedHostInstanceId },
      state: optimisticState,
    };
    sessionStateRef.current = optimisticState;
    setSessionState(optimisticState);
    setPayload(payloadForUi);
    updateLanTcpHostPayload(payloadForUi, { broadcast: false });

    const seq = Date.now();
    const event: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'session_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: 'all',
      toName: 'Todos',
      entityType: 'session',
      entityId: sessionId,
      entityRevision: seq,
      ackRequired: false,
      originClientId: 'master',
      sessionPatch: {
        status: 'active',
        resumedAt: nowIso,
        hostInstanceId: resumedHostInstanceId,
        sessionEpoch: seq,
        readOnlyForPlayers: false,
      },
      message: 'O mestre retomou a sessao.',
      createdAt: nowIso,
    };

    rememberSentEventInTimeline(event);
    setSessionEvents((current) => mergeMasterTimelineEvent(current, event));
    void sendLanSessionEvent(joinUrl, event).catch((error) => {
      debugLanFlow('MASTER_SESSION_RESUME_FAST_SEND_FAILED_V108', {
        sessionId,
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
    void rememberLanSessionEvent(db, event).catch(() => false);

    void (async () => {
      try {
        await db.runAsync(
          `UPDATE lan_sessions
           SET status = 'active', active = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND COALESCE(status, 'active') != 'ended'`,
          [sessionId],
        );
        await saveLanSession(db, payloadForUi, joinUrl, { isMaster: true });
        await recordMasterTimelineEvent('Mestre continuou a campanha.').catch(() => false);
        await loadSavedSessions().catch(() => undefined);
        debugLanFlow('MASTER_SESSION_RESUMED_DB_DONE_V108_KEEP_SOCKET', { sessionId, eventId: event.id });
      } catch (error) {
        debugLanFlow('MASTER_SESSION_RESUMED_DB_FAILED_V108', {
          sessionId,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pauseToggleRunningRef.current = false;
        releaseMasterLifecycleAction(lifecycleKey);
      }
    })();

    debugLanFlow('MASTER_SESSION_RESUMED_SENT_FAST_V108', {
      sessionId,
      eventId: event.id,
      decision: 'ui_and_socket_before_sqlite',
    });
    return;
    */
  };

  const handleAdvanceTime = async (unit: LanAdvanceUnit) => {
    if (!payload) return;
    const sessionId = payload.session.id;
    const repeatableTimeUnit = unit === 'turn' || unit === 'minute' || unit === 'hour';

    await runMasterAction(
      `advance_time:${unit}`,
      async () => {
        if (!payload) return;
        const sessionId = payload.session.id;
    const startedAt = Date.now();
    const beforeState = sessionStateRef.current;

    traceButton('lan-session', `ADVANCE_TIME_${unit}`, {
      source: 'master_click',
      sessionId,
      args: { unit },
      before: {
        currentTurn: beforeState?.currentTurn,
        elapsedMinutes: beforeState?.elapsedMinutes,
      },
    });

    dispatchMasterEngineCommand({
      type: 'advance_turn',
      commandId: `master_advance:${sessionId}:${unit}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      sessionId,
      actorKey: 'master',
      unit,
    }, {
      message: `Tempo da sessao avancou: ${formatAdvanceUnit(unit)}.`,
    });
    void recordMasterTimelineEvent(`Mestre avancou ${formatAdvanceUnit(unit)}.`);
    return;

    /*
     * @deprecated Corte 3: caminho antigo de advance time substituido por
     * advance_turn no engine. Mantido temporariamente como referencia.
     *
    holdLiveRuntimeLock('advance_time_runtime', 12000);
    const runtimeResult = applyHostTurnRuntime(sessionId, beforeState, unit);
    if (!runtimeResult) return;

    sessionStateRef.current = runtimeResult.state;
    setSessionState(runtimeResult.state);
    setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    updateLanTcpHostPayload({ ...payload, state: runtimeResult.state }, { broadcast: false });

    const now = Date.now();
    const sessionPatchEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq: now,
      serverSeq: now,
      type: 'session_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: 'all',
      toName: 'Todos',
      entityType: 'session',
      entityId: sessionId,
      entityRevision: runtimeResult.revision,
      ackRequired: true,
      originClientId: 'master',
      sessionPatch: {
        currentTurn: runtimeResult.state.currentTurn,
        elapsedMinutes: runtimeResult.state.elapsedMinutes,
        advanceUnit: unit,
        reason: 'advance_time_runtime_first',
      },
      message: `Tempo da sessao avancou: ${formatAdvanceUnit(unit)}.`,
      createdAt: new Date(now).toISOString(),
    };

    rememberSentEventInTimeline(sessionPatchEvent);
    void sendLanSessionEvent(joinUrl, sessionPatchEvent).catch((error) => {
      debugLanFlow('MASTER_TURN_SESSION_PATCH_SEND_FAILED', {
        sessionId,
        eventId: sessionPatchEvent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });

    // Enviar imediatamente os patches de efeito calculados pelo runtime.
    // O SQLite apenas confirma depois; ele não pode atrasar a saída de buff/condição/PV temp.
    const beforePlayersByKey = new Map<string, LanSessionPlayerState>();
    for (const player of beforeState?.players || []) {
      if (player.remoteKey) beforePlayersByKey.set(player.remoteKey, player);
    }
    for (const player of runtimeResult.state.players) {
      if (!player.remoteKey) continue;
      const beforePlayer = beforePlayersByKey.get(player.remoteKey);
      if (!beforePlayer) continue;
      const beforeEffects = beforePlayer.effects || [];
      const afterEffects = player.effects || [];
      const afterById = new Map(afterEffects.map((effect) => [String(effect.id), effect]));
      const beforeById = new Map(beforeEffects.map((effect) => [String(effect.id), effect]));
      const removed = beforeEffects.filter((effect) => !afterById.has(String(effect.id)) && String(effect.id || '').trim());
      const updated = afterEffects.filter((effect) => {
        const previous = beforeById.get(String(effect.id));
        return previous && Number((previous as any).remaining || 0) !== Number((effect as any).remaining || 0);
      });

      const beforeTempHp = Math.max(0, Math.floor(Number(beforePlayer.tempHp || 0)));
      const afterTempHp = Math.max(0, Math.floor(Number(player.tempHp || 0)));

      if (removed.length || updated.length || beforeTempHp !== afterTempHp) {
        const patch = {
          targetKey: player.remoteKey,
          add: [],
          update: updated as any[],
          remove: removed.map((effect) => String(effect.id)),
        };
        const effectPatchEvent: LanSessionEvent = {
          id: makeLanEventId(),
          sessionId,
          seq: Date.now(),
          serverSeq: Date.now(),
          type: 'effect_patch',
          fromKey: 'master',
          fromName: 'Mestre',
          toKey: player.remoteKey,
          toName: player.characterName,
          entityType: 'effect',
          entityId: player.remoteKey,
          entityRevision: Number(player.revisionSeq || runtimeResult.revision),
          ackRequired: true,
          originClientId: 'master',
          effectPatch: patch,
          numberPatch: beforeTempHp !== afterTempHp ? { tempHp: afterTempHp } : undefined,
          numberPatchIntent: beforeTempHp !== afterTempHp ? 'temp_hp' : undefined,
          message: beforeTempHp !== afterTempHp && afterTempHp <= 0
            ? `${player.characterName}: PV temporario expirou pela passagem de tempo.`
            : `${player.characterName}: efeitos atualizados pela passagem de tempo.`,
          createdAt: new Date().toISOString(),
        };
        rememberSentEventInTimeline(effectPatchEvent);
        void sendLanSessionEvent(joinUrl, effectPatchEvent).catch(() => false);
        if (beforeTempHp !== afterTempHp) {
          void updateLanPlayerNumbers(db, player.id, { tempHp: afterTempHp }, { syncPayload: false }).catch((error) => {
            debugLanFlow('MASTER_TEMP_HP_TICK_NUMBER_PERSIST_FAILED', {
              sessionId,
              playerId: player.id,
              playerKey: player.remoteKey,
              tempHp: afterTempHp,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      for (const expired of removed) {
        const expiredEvent: LanSessionEvent = {
          id: makeLanEventId(),
          sessionId,
          seq: Date.now(),
          serverSeq: Date.now(),
          type: 'effect_expired',
          fromKey: 'session',
          fromName: 'Sessao',
          toKey: player.remoteKey,
          toName: player.characterName,
          entityType: 'effect',
          entityId: player.remoteKey,
          entityRevision: Number(player.revisionSeq || runtimeResult.revision),
          ackRequired: false,
          originClientId: 'master',
          expiredEffect: expired,
          message: `${player.characterName}: ${expired.name || 'Efeito'} acabou.`,
          createdAt: new Date().toISOString(),
        };
        rememberSentEventInTimeline(expiredEvent);
        void sendLanSessionEvent(joinUrl, expiredEvent).catch(() => false);
      }

      if (removed.length || updated.length) {
        void sendPublicPlayerStatus(sessionId, player, 'turn_effect_tick');
      }

      if (unit === 'turn' && player.remoteKey) {
        for (const effect of afterEffects) {
          const repeatSave = String((effect as any)?.repeatSave || '').toLowerCase();
          const saveAbility = String((effect as any)?.saveAbility || '').toUpperCase();
          const saveDc = Number((effect as any)?.saveDc || 0) || 0;
          const effectUnit = String((effect as any)?.unit || '').toLowerCase();
          const isStillActive = (effect as any)?.isPermanent === true ||
            effectUnit === 'manual' ||
            effectUnit === 'permanent' ||
            effectUnit === 'while_equipped' ||
            effectUnit === 'concentration' ||
            Number((effect as any)?.remaining || 0) > 0;
          const shouldPromptSave = isStillActive && saveAbility && saveDc > 0 && (
            repeatSave === 'end_of_turn' ||
            repeatSave === 'start_of_turn' ||
            repeatSave === 'turn' ||
            repeatSave === 'each_turn'
          );
          if (!shouldPromptSave) continue;
          const sourceId = String((effect as any)?.id || (effect as any)?.sourceId || (effect as any)?.statusKey || effect.name || 'effect');
          const pending = await createPendingSave(db, {
            sessionId,
            playerId: player.id,
            targetKey: player.remoteKey,
            sourceType: 'turn_effect_save',
            sourceId,
            sourceName: String((effect as any)?.name || 'Efeito'),
            appliedByKey: 'master',
            appliedByName: 'Mestre',
          }, {
            ...effect,
            save: {
              ability: saveAbility,
              dc: saveDc,
              onSuccess: String((effect as any)?.saveOnSuccess || 'negates'),
              repeatSave,
            },
          } as any).catch(() => null);
          if (!pending) continue;
          const saveEventSeq = Date.now();
          const saveEvent: LanSessionEvent = {
            id: makeLanEventId(),
            sessionId,
            seq: saveEventSeq,
            serverSeq: saveEventSeq,
            type: 'pending_save_patch',
            fromKey: 'session',
            fromName: 'Sessao',
            toKey: player.remoteKey,
            toName: player.characterName,
            entityType: 'save',
            entityId: pending.id,
            entityRevision: runtimeResult.state.currentTurn,
            ackRequired: true,
            originClientId: 'master',
            pendingSavePatch: {
              action: 'create',
              save: pending,
            },
            message: `Teste pendente criado para ${pending.sourceName || 'efeito'}.`,
            createdAt: new Date(saveEventSeq).toISOString(),
          };
          rememberSentEventInTimeline(saveEvent);
          setPendingSaves((current) => {
            if (current.some((entry) => entry.id === pending.id)) return current;
            return [pending, ...current];
          });
          void rememberLanSessionEvent(db, saveEvent).catch(() => false);
          void sendLanSessionEvent(joinUrl, saveEvent).catch(() => false);
          debugLanFlow('MASTER_TURN_PENDING_SAVE_PATCH_SENT_V106', {
            sessionId,
            playerKey: player.remoteKey,
            playerName: player.characterName,
            effectId: sourceId,
            effectName: (effect as any)?.name,
            saveId: pending.id,
            ability: pending.ability,
            dc: pending.dc,
            turn: runtimeResult.state.currentTurn,
          });
        }
      }
    }

    debugLanFlow('MASTER_TURN_RUNTIME_FIRST_SENT', {
      sessionId,
      unit,
      currentTurn: runtimeResult.state.currentTurn,
      elapsedMinutes: runtimeResult.state.elapsedMinutes,
      durationMs: Date.now() - startedAt,
      decision: 'socket_and_history_before_sqlite',
    });

    void enqueueLanEntityMutation([getLanSessionQueueKey(sessionId)], async () => {
      const eventsBeforeAdvance = await getLanSessionEvents(db, sessionId, 200);
      const eventIdsBeforeAdvance = new Set(eventsBeforeAdvance.map((event) => event.id));
      await rememberLanSessionEvent(db, sessionPatchEvent).catch(() => false);
      await advanceLanSessionTime(db, sessionId, unit, {
        syncPayload: false,
        skipSessionPatchEvent: true,
        nextCurrentTurn: runtimeResult.state.currentTurn,
        nextElapsedMinutes: runtimeResult.state.elapsedMinutes,
        skipEffectTick: false,
        skipPendingSaveEvents: true,
        // v106: pending save de turno ja foi emitido pelo runtime vivo acima.
        // SQLite nao pode criar outro alerta atrasado/duplicado.
        // v56: runtime envia a remoção imediatamente, mas SQLite também precisa
        // decrementar/remover em background; senão o próximo reload/snapshot traz
        // o efeito vencido de volta para mestre e jogador.
      });
      await sendRecentLiveEvents(sessionId, (event) => (
        !eventIdsBeforeAdvance.has(event.id) && event.type === 'pending_save_patch'
      ));
      setPendingSaves(await listPendingSaves(db, sessionId));
      await recordMasterTimelineEvent(`Mestre avancou ${formatAdvanceUnit(unit)}.`);
      scheduleSilentPayloadRefresh(sessionId);
    }, { screen: 'lan-session', source: 'handleAdvanceTime', sessionId, unit });

    traceFunctionReturn('handleAdvanceTime', {
      sessionId,
      unit,
      currentTurn: runtimeResult.state.currentTurn,
      elapsedMinutes: runtimeResult.state.elapsedMinutes,
    }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId,
      durationMs: Date.now() - startedAt,
    });
    */
  
      },
      repeatableTimeUnit
        ? { mode: 'queue', queueDelayMs: MASTER_REPEATABLE_ACTION_QUEUE_DELAY_MS }
        : { mode: 'drop', cooldownMs: 500, keepPendingMs: 500 }
    );
  };

  const handleApplyCatalogSelection = async () => {
    if (!payload) {
      setCatalogModalVisible(false);
      return;
    }

    const nextPayload = await rebuildLanSessionCatalog(db, payload.session.id, selectionFromKeys(selectedCatalogKeys), joinUrl);
    if (nextPayload) {
      applyExternalPayload(nextPayload, 'sqlite');
    }
    setCatalogModalVisible(false);
  };

  const handleToggleCatalogOption = (key: string) => {
    setSelectedCatalogKeys((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  const handleSetFilteredCatalog = (selected: boolean) => {
    const visibleKeys = filteredCatalogOptions.map((option) => option.key);
    setSelectedCatalogKeys((current) => {
      if (selected) return Array.from(new Set([...current, ...visibleKeys]));
      return current.filter((key) => !visibleKeys.includes(key));
    });
  };

  const recordMasterTimelineEvent = async (message: string, player?: LanSessionPlayerState) => {
    if (!payload) return;
    const event: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'timeline_event',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: player?.remoteKey || 'party',
      toName: player?.characterName || 'Party',
      visibility: player?.remoteKey ? 'private' : 'party',
      message,
      createdAt: new Date().toISOString(),
    };

    // Histórico da campanha é UI/runtime first. SQLite é cache, não pode atrasar a mesa.
    rememberSentEventInTimeline(event);
    void rememberLanSessionEvent(db, event).catch(() => false);
  };

  /** @deprecated Corte 3: dano/cura/PV temporario do mestre usam dispatchMasterEngineCommand. */
  const persistHostNumberPatch = useCallback(async (playerId: number, patch: NumberPatch, message: string) => {
    if (!payload?.session?.id || endingSessionRef.current) return;
    const sessionId = payload.session.id;
    holdLiveRuntimeLock('persist_number_patch', 12000);
    const targetPlayer = sessionStateRef.current?.players.find((entry) => entry.id === playerId);
    if (!targetPlayer) return;
    traceFunctionCall('persistHostNumberPatch', { playerId, patch, message }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId,
      playerId,
      playerKey: targetPlayer.remoteKey,
      playerName: targetPlayer.characterName,
      before: {
        hpCurrent: targetPlayer.hpCurrent,
        hpMax: targetPlayer.hpMax,
        tempHp: targetPlayer.tempHp,
        xp: targetPlayer.xp,
        gp: targetPlayer.gp,
        sp: targetPlayer.sp,
        cp: targetPlayer.cp,
        revisionSeq: targetPlayer.revisionSeq,
      },
      patch,
    });
    const seq = Date.now();
    const authoritativePatch = makeAuthoritativeNumberPatch(targetPlayer, patch);
    const liveEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'player_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetPlayer.remoteKey || '',
      toName: targetPlayer.characterName,
      entityType: 'player',
      entityId: targetPlayer.remoteKey || String(targetPlayer.id),
      entityRevision: Math.max(1, Number(targetPlayer.revisionSeq || 0)),
      ackRequired: true,
      originClientId: 'master',
      numberPatchIntent: inferNumberPatchIntent(patch),
      numberPatch: authoritativePatch,
      message,
      createdAt: new Date().toISOString(),
    };

    debugLanFlow('MASTER_EVENT_CREATED', {
      eventId: liveEvent.id,
      seq: liveEvent.seq,
      entityRevision: liveEvent.entityRevision,
      type: liveEvent.type,
      numberPatch: liveEvent.numberPatch,
    });
    traceApp('EVENT_CREATED', 'MASTER_PLAYER_PATCH_EVENT_CREATED', {
      screen: 'lan-session',
      source: 'persistHostNumberPatch',
      sessionId,
      playerId,
      playerKey: targetPlayer.remoteKey,
      playerName: targetPlayer.characterName,
      eventId: liveEvent.id,
      eventType: liveEvent.type,
      seq: liveEvent.seq,
      serverSeq: liveEvent.serverSeq,
      entityType: liveEvent.entityType,
      entityId: liveEvent.entityId,
      entityRevision: liveEvent.entityRevision,
      fromKey: liveEvent.fromKey,
      toKey: liveEvent.toKey,
      patch: liveEvent.numberPatch,
    });

    // v85: a barra publica dos outros jogadores precisa nascer do mesmo patch
    // autoritativo de HP/XP/moedas, sem esperar envio/ACK do player_patch do alvo.
    // Antes o public_status so era disparado no .then do envio do player_patch; se a fila
    // do alvo demorasse, os demais jogadores viam HP antigo no roster por alguns segundos.
    void sendPublicPlayerStatus(sessionId, targetPlayer, 'number_patch_immediate', authoritativePatch);

    traceSocket('SOCKET_SEND_START', {
      screen: 'lan-session',
      source: 'persistHostNumberPatch',
      functionName: 'persistHostNumberPatch',
      sessionId,
      playerId,
      playerKey: targetPlayer.remoteKey,
      playerName: targetPlayer.characterName,
      eventId: liveEvent.id,
      eventType: liveEvent.type,
      envelopeType: 'event_commit',
      toKey: liveEvent.toKey,
      patch: liveEvent.numberPatch,
    });
    void sendLanSessionEvent(joinUrl, liveEvent)
      .then(() => {
        debugLanFlow('MASTER_EVENT_SENT', {
          eventId: liveEvent.id,
          toKey: liveEvent.toKey,
          numberPatch: liveEvent.numberPatch,
        });
        traceSocket('SOCKET_SEND_DONE', {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
          envelopeType: 'event_commit',
          toKey: liveEvent.toKey,
          patch: liveEvent.numberPatch,
        });
        traceFunctionReturn('persistHostNumberPatch', {
          sent: true,
          eventId: liveEvent.id,
        }, {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
        });
        setSessionEvents((current) => mergeMasterTimelineEvent(current, liveEvent));
      })
      .catch((error) => {
        traceError('SOCKET_SEND_START', 'MASTER_PLAYER_PATCH_SOCKET_SEND_ERROR', error, {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
          envelopeType: 'event_commit',
        });
        console.warn('[LAN MASTER] Falha ao enviar evento vivo imediato:', error);
      });

    void (async () => {
      try {
        debugLanFlow('MASTER_SQLITE_PERSIST_START', { sessionId, playerId, patch });
        traceSqlite('SQLITE_WRITE_START', {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          table: 'lan_session_events/lan_session_players',
          operation: 'PERSIST_PLAYER_PATCH_BACKGROUND',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          patch,
        });
        await rememberLanSessionEvent(db, liveEvent);
        await updateLanPlayerNumbers(db, playerId, patch, { syncPayload: false });
        debugLanFlow('MASTER_SQLITE_PERSIST_DONE', { sessionId, playerId, patch });
        traceSqlite('SQLITE_WRITE_DONE', {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          table: 'lan_session_events/lan_session_players',
          operation: 'PERSIST_PLAYER_PATCH_BACKGROUND',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          patch,
        });

        scheduleSilentPayloadRefresh(sessionId);
      } catch (error) {
        console.warn('[LAN MASTER] Falha ao persistir patch vivo no SQLite:', error);
      }
    })();
  }, [db, holdLiveRuntimeLock, joinUrl, payload?.session?.id, scheduleSilentPayloadRefresh, sendPublicPlayerStatus]);



  /** @deprecated Corte 3: aplicacao direta de efeitos do mestre usa apply_effect/apply_temp_hp no engine. */
  const persistHostEffectsBatchPatch = useCallback((
    player: LanSessionPlayerState,
    drafts: EffectDraft[],
    message?: string,
  ) => {
    if (!payload?.session?.id || endingSessionRef.current || drafts.length === 0) return null;
    const sessionId = payload.session.id;
    holdLiveRuntimeLock('persist_effect_batch_patch', 12000);
    const targetKey = player.remoteKey || makeLanCharacterKey(sessionId, { id: player.sourceCharacterId || player.id, name: player.characterName });
    const existingTempEffects = (player.effects || []).filter((effect) => (
      String(effect?.target || '').toUpperCase() === 'PV_TEMP' || String(effect?.kind || '').toLowerCase() === 'temp_hp'
    ));
    const currentTempHp = Math.max(0, Math.floor(Number(player.tempHp || 0)));
    const tempDrafts = drafts.filter((draft) => draft.target === 'PV_TEMP' || draft.kind === 'temp_hp');
    const incomingTempHp = tempDrafts.reduce((max, draft) => Math.max(max, Math.max(0, Math.floor(Number(draft.value || 0)))), 0);
    const hasAcceptedTempHp = incomingTempHp > currentTempHp;

    const effectSnapshots = drafts
      .filter((draft) => {
        const isTempHp = draft.target === 'PV_TEMP' || draft.kind === 'temp_hp';
        if (!isTempHp) return true;
        return hasAcceptedTempHp && Math.max(0, Math.floor(Number(draft.value || 0))) === incomingTempHp;
      })
      .map((draft) => {
        const activeId = String(draft.sourceId || '').startsWith('active_fx_')
          ? String(draft.sourceId)
          : `active_fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
          id: activeId,
          name: draft.name || 'Efeito',
          target: draft.target,
          value: Math.floor(Number(draft.value || 0)),
          remaining: Math.max(0, Math.floor(Number(draft.remaining || 0))),
          unit: draft.unit,
          isPermanent: Boolean(draft.isPermanent),
          kind: draft.kind,
          mode: draft.mode || 'add',
          durationText: draft.durationText,
          status: draft.status,
          statusKey: draft.statusKey || draft.status,
          source: draft.source || 'Mestre',
          sourceType: draft.sourceType || 'lan_session',
          sourceId: activeId,
          color: draft.color,
          secondaryColor: draft.secondaryColor,
          icon: draft.icon,
          visibleToPlayer: draft.visibleToPlayer !== false,
          publicNote: draft.publicNote,
          privateNote: draft.privateNote,
          saveDc: draft.saveDc ?? null,
          saveAbility: draft.saveAbility ?? null,
          repeatSave: draft.repeatSave ?? null,
          removableBySave: draft.removableBySave,
          visualPriority: draft.visualPriority,
          autoExpire: (draft as any).autoExpire,
        } as LanSessionEffect;
      });

    if (effectSnapshots.length === 0) {
      debugLanFlow('MASTER_FAST_EFFECT_BATCH_IGNORED_NO_VALID_EFFECTS_V92', {
        sessionId,
        playerId: player.id,
        targetKey,
        incomingTempHp,
        currentTempHp,
      });
      return null;
    }

    const patch: NonNullable<LanSessionEvent['effectPatch']> = {
      targetKey,
      add: effectSnapshots as any[],
      update: [],
      remove: hasAcceptedTempHp ? existingTempEffects.map((effect) => String(effect.id)).filter(Boolean) : [],
    };

    const runtimeResult = applyHostEffectPatchRuntime(sessionId, sessionStateRef.current, targetKey, patch);
    if (!runtimeResult) return null;
    let nextRuntimeState = runtimeResult.state;
    let nextRuntimePlayer = runtimeResult.player;

    if (hasAcceptedTempHp) {
      const tempHpRuntimeResult = applyHostNumberPatchRuntime(sessionId, runtimeResult.state, runtimeResult.player.id, { tempHp: incomingTempHp });
      if (tempHpRuntimeResult) {
        nextRuntimeState = tempHpRuntimeResult.state;
        nextRuntimePlayer = tempHpRuntimeResult.player;
      }
    }

    sessionStateRef.current = nextRuntimeState;
    setSessionState(nextRuntimeState);
    setPayload((current) => current ? ({ ...current, state: nextRuntimeState }) : current);
    setInventoryModalPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
    setDetailPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
    setEffectListModalPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);

    const seq = Date.now();
    const liveEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'effect_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: player.characterName,
      entityType: 'effect',
      entityId: targetKey,
      entityRevision: runtimeResult.revision,
      ackRequired: true,
      originClientId: 'master',
      effectPatch: patch,
      numberPatch: hasAcceptedTempHp ? { tempHp: nextRuntimePlayer.tempHp } : undefined,
      numberPatchIntent: hasAcceptedTempHp ? 'temp_hp_effect' : undefined,
      message: message || `Mestre aplicou ${effectSnapshots.length} efeito(s) em ${player.characterName}.`,
      createdAt: new Date(seq).toISOString(),
    };

    debugLanFlow('MASTER_FAST_EFFECT_BATCH_PATCH_EVENT_CREATED_V92', {
      sessionId,
      playerId: player.id,
      playerKey: targetKey,
      eventId: liveEvent.id,
      seq: liveEvent.seq,
      entityRevision: liveEvent.entityRevision,
      addCount: patch.add?.length || 0,
      removeCount: patch.remove?.length || 0,
      tempHp: nextRuntimePlayer.tempHp,
    });

    rememberSentEventInTimeline(liveEvent);
    void sendPublicPlayerStatus(sessionId, nextRuntimePlayer, 'effect_batch_patch_immediate', liveEvent.numberPatch as NumberPatch | undefined);
    void sendLanSessionEvent(joinUrl, liveEvent)
      .then(() => {
        debugLanFlow('MASTER_FAST_EFFECT_BATCH_PATCH_EVENT_SENT_V92', {
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
          entityRevision: liveEvent.entityRevision,
        });
      })
      .catch((error) => {
        traceError('SOCKET_SEND_START', 'MASTER_FAST_EFFECT_BATCH_PATCH_SOCKET_SEND_ERROR_V92', error, {
          screen: 'lan-session',
          source: 'persistHostEffectsBatchPatch',
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
        });
      });

    void (async () => {
      try {
        await rememberLanSessionEvent(db, liveEvent);
        await addLanPlayerEffectsBatch(db, player.id, effectSnapshots as any[], liveEvent.message, { syncPayload: false, recordEvent: false });
        if (hasAcceptedTempHp) {
          await updateLanPlayerNumbers(db, nextRuntimePlayer.id, { tempHp: nextRuntimePlayer.tempHp }, { syncPayload: false });
        }
        scheduleSilentPayloadRefresh(sessionId);
      } catch (error) {
        console.warn('[LAN MASTER] Falha ao persistir batch de efeitos no SQLite:', error);
        debugLanFlow('MASTER_FAST_EFFECT_BATCH_SQLITE_ERROR_V92', {
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return { event: liveEvent, player: nextRuntimePlayer, patch };
  }, [db, holdLiveRuntimeLock, joinUrl, payload?.session?.id, scheduleSilentPayloadRefresh, sendPublicPlayerStatus]);



  /** @deprecated Corte 3: aplicacao direta de efeito do mestre usa apply_effect/apply_temp_hp no engine. */
  const persistHostEffectPatch = useCallback((
    player: LanSessionPlayerState,
    draft: EffectDraft,
    message?: string,
  ) => {
    if (!payload?.session?.id || endingSessionRef.current) return null;
    const sessionId = payload.session.id;
    holdLiveRuntimeLock('persist_effect_patch', 12000);
    const targetKey = player.remoteKey || makeLanCharacterKey(sessionId, { id: player.sourceCharacterId || player.id, name: player.characterName });
    const activeId = String(draft.sourceId || '').startsWith('active_fx_')
      ? String(draft.sourceId)
      : `active_fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const isTempHp = draft.target === 'PV_TEMP' || draft.kind === 'temp_hp';
    const existingTempEffects = (player.effects || []).filter((effect) => (
      String(effect?.target || '').toUpperCase() === 'PV_TEMP' || String(effect?.kind || '').toLowerCase() === 'temp_hp'
    ));
    const incomingTempHp = Math.max(0, Math.floor(Number(draft.value || 0)));
    const currentTempHp = Math.max(0, Math.floor(Number(player.tempHp || 0)));

    if (isTempHp && incomingTempHp <= 0) {
      debugLanFlow('MASTER_FAST_EFFECT_IGNORED_INVALID_TEMP_HP', { sessionId, playerId: player.id, incomingTempHp });
      return null;
    }
    if (isTempHp && currentTempHp > 0 && incomingTempHp <= currentTempHp) {
      // Regra padrao D&D: PV temporario nao acumula. Valor menor/igual nao substitui o atual.
      debugLanFlow('MASTER_FAST_EFFECT_IGNORED_TEMP_HP_LOWER_OR_EQUAL', {
        sessionId,
        playerId: player.id,
        targetKey,
        currentTempHp,
        incomingTempHp,
      });
      return null;
    }

    const effectSnapshot = {
      id: activeId,
      name: draft.name || 'Efeito',
      target: draft.target,
      value: Math.floor(Number(draft.value || 0)),
      remaining: Math.max(0, Math.floor(Number(draft.remaining || 0))),
      unit: draft.unit,
      isPermanent: Boolean(draft.isPermanent),
      kind: draft.kind,
      mode: draft.mode || 'add',
      durationText: draft.durationText,
      status: draft.status,
      statusKey: draft.statusKey || draft.status,
      source: draft.source || 'Mestre',
      sourceType: draft.sourceType || 'lan_session',
      sourceId: activeId,
      color: draft.color,
      secondaryColor: draft.secondaryColor,
      icon: draft.icon,
      visibleToPlayer: draft.visibleToPlayer !== false,
      publicNote: draft.publicNote,
      privateNote: draft.privateNote,
      saveDc: draft.saveDc ?? null,
      saveAbility: draft.saveAbility ?? null,
      repeatSave: draft.repeatSave ?? null,
      removableBySave: draft.removableBySave,
      visualPriority: draft.visualPriority,
      autoExpire: (draft as any).autoExpire,
    } as LanSessionEffect;

    const patch: NonNullable<LanSessionEvent['effectPatch']> = {
      targetKey,
      add: [effectSnapshot as any],
      update: [],
      remove: isTempHp ? existingTempEffects.map((effect) => String(effect.id)).filter(Boolean) : [],
    };

    const runtimeResult = applyHostEffectPatchRuntime(sessionId, sessionStateRef.current, targetKey, patch);
    if (!runtimeResult) return null;
    let nextRuntimeState = runtimeResult.state;
    let nextRuntimePlayer = runtimeResult.player;

    if (isTempHp) {
      const tempHpRuntimeResult = applyHostNumberPatchRuntime(sessionId, runtimeResult.state, runtimeResult.player.id, { tempHp: incomingTempHp });
      if (tempHpRuntimeResult) {
        nextRuntimeState = tempHpRuntimeResult.state;
        nextRuntimePlayer = tempHpRuntimeResult.player;
      }
    }

    sessionStateRef.current = nextRuntimeState;
    setSessionState(nextRuntimeState);
    setPayload((current) => current ? ({ ...current, state: nextRuntimeState }) : current);
    setInventoryModalPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
    setDetailPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);

    const seq = Date.now();
    const liveEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'effect_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: player.characterName,
      entityType: 'effect',
      entityId: targetKey,
      entityRevision: runtimeResult.revision,
      ackRequired: true,
      originClientId: 'master',
      effectPatch: patch,
      numberPatch: isTempHp ? { tempHp: nextRuntimePlayer.tempHp } : undefined,
      numberPatchIntent: isTempHp ? 'temp_hp_effect' : undefined,
      message: message || `${effectSnapshot.name} aplicado em ${player.characterName}.`,
      createdAt: new Date().toISOString(),
    };

    debugLanFlow('MASTER_FAST_EFFECT_PATCH_EVENT_CREATED', {
      sessionId,
      playerId: player.id,
      playerKey: targetKey,
      eventId: liveEvent.id,
      seq: liveEvent.seq,
      entityRevision: liveEvent.entityRevision,
      addCount: patch.add?.length || 0,
      removeCount: patch.remove?.length || 0,
      tempHp: nextRuntimePlayer.tempHp,
    });

    // v74: PV temporario aplicado por efeito nao deve gerar um segundo player_patch.
    // O proprio effect_patch carrega numberPatch.tempHp e o cliente aplica ambos
    // no mesmo evento/ACK. Isso evita duplicidade, reorder e atraso perceptivel.

    // O histórico/status público precisa aparecer junto com o efeito, não depois do ACK.
    rememberSentEventInTimeline(liveEvent);
    void sendPublicPlayerStatus(sessionId, nextRuntimePlayer, 'effect_patch_immediate', liveEvent.numberPatch as NumberPatch | undefined);
    void sendLanSessionEvent(joinUrl, liveEvent)
      .then(() => {
        debugLanFlow('MASTER_FAST_EFFECT_PATCH_EVENT_SENT', {
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
          entityRevision: liveEvent.entityRevision,
        });
      })
      .catch((error) => {
        traceError('SOCKET_SEND_START', 'MASTER_FAST_EFFECT_PATCH_SOCKET_SEND_ERROR', error, {
          screen: 'lan-session',
          source: 'persistHostEffectPatch',
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
        });
      });

    void (async () => {
      try {
        await rememberLanSessionEvent(db, liveEvent);
        await addLanPlayerEffect(db, player.id, effectSnapshot as any, { syncPayload: false, recordEvent: false });
        if (isTempHp) {
          await updateLanPlayerNumbers(db, nextRuntimePlayer.id, { tempHp: nextRuntimePlayer.tempHp }, { syncPayload: false });
        }
        scheduleSilentPayloadRefresh(sessionId);
      } catch (error) {
        traceError('SQLITE_WRITE_START', 'MASTER_FAST_EFFECT_PATCH_PERSIST_ERROR', error, {
          screen: 'lan-session',
          source: 'persistHostEffectPatch',
          sessionId,
          playerId: player.id,
          playerKey: targetKey,
          eventId: liveEvent.id,
        });
      }
    })();

    return liveEvent;
  }, [db, holdLiveRuntimeLock, joinUrl, payload?.session?.id, scheduleSilentPayloadRefresh, sendPublicPlayerStatus]);


  /** @deprecated Corte 3: remocao de efeito do mestre usa remove_effect no engine. */
  const persistHostEffectRemovalPatch = useCallback((
    playerId: number,
    effectId: string,
    message?: string,
  ) => {
    if (!payload?.session?.id || endingSessionRef.current) return null;
    const sessionId = payload.session.id;
    holdLiveRuntimeLock('effect_remove_runtime', 12000);
    const currentState = sessionStateRef.current;
    const player = currentState?.players.find((entry) => entry.id === playerId);
    if (!player) {
      debugLanFlow('MASTER_REMOVE_EFFECT_RUNTIME_PLAYER_NOT_FOUND', { sessionId, playerId, effectId });
      return null;
    }

    const targetKey = player.remoteKey || makeLanCharacterKey(sessionId, { id: player.sourceCharacterId || player.id, name: player.characterName });
    const removedEffect = (player.effects || []).find((effect) => (
      String((effect as any)?.id || '') === String(effectId) ||
      String((effect as any)?.lanEffectId || '') === String(effectId) ||
      String((effect as any)?.sourceId || '') === String(effectId)
    ));
    const wasTempHpEffect = isTempHpLanEffectSnapshot(removedEffect);
    const patch: NonNullable<LanSessionEvent['effectPatch']> = {
      targetKey,
      add: [],
      update: [],
      remove: [String(effectId)],
    };

    const effectRuntimeResult = applyHostEffectPatchRuntime(sessionId, currentState, targetKey, patch);
    if (!effectRuntimeResult) {
      debugLanFlow('MASTER_REMOVE_EFFECT_RUNTIME_PATCH_FAILED', { sessionId, playerId, targetKey, effectId });
      return null;
    }

    let nextRuntimeState = effectRuntimeResult.state;
    let nextRuntimePlayer = effectRuntimeResult.player;
    let entityRevision = effectRuntimeResult.revision;
    let bundledNumberPatch: NumberPatch | undefined;

    if (wasTempHpEffect) {
      const nextTempHp = (nextRuntimePlayer.effects || [])
        .filter(isTempHpLanEffectSnapshot)
        .reduce((max, effect) => Math.max(max, getTempHpLanEffectValue(effect)), 0);
      const numberRuntimeResult = applyHostNumberPatchRuntime(
        sessionId,
        nextRuntimeState,
        nextRuntimePlayer.id,
        { tempHp: nextTempHp }
      );
      if (numberRuntimeResult) {
        nextRuntimeState = numberRuntimeResult.state;
        nextRuntimePlayer = numberRuntimeResult.player;
        entityRevision = Math.max(entityRevision, numberRuntimeResult.revision);
        bundledNumberPatch = { tempHp: nextRuntimePlayer.tempHp };
      }
    }

    sessionStateRef.current = nextRuntimeState;
    setSessionState(nextRuntimeState);
    setPayload((current) => current ? ({ ...current, state: nextRuntimeState }) : current);
    setInventoryModalPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);
    setDetailPlayer((current) => current?.remoteKey === nextRuntimePlayer.remoteKey ? nextRuntimePlayer : current);

    const seq = Date.now();
    const liveEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'effect_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetKey,
      toName: player.characterName,
      entityType: 'effect',
      entityId: targetKey,
      entityRevision,
      ackRequired: true,
      originClientId: 'master',
      effectPatch: patch,
      numberPatch: bundledNumberPatch,
      numberPatchIntent: bundledNumberPatch ? inferNumberPatchIntent(bundledNumberPatch) : undefined,
      message: message || `${String((removedEffect as any)?.name || 'Efeito')} removido de ${player.characterName}.`,
      createdAt: new Date().toISOString(),
    };

    debugLanFlow('MASTER_REMOVE_EFFECT_RUNTIME_FIRST', {
      sessionId,
      playerId,
      playerKey: targetKey,
      effectId,
      eventId: liveEvent.id,
      entityRevision,
      wasTempHpEffect,
      numberPatch: bundledNumberPatch,
      decision: 'ui_and_socket_before_sqlite',
    });

    rememberSentEventInTimeline(liveEvent);
    void sendPublicPlayerStatus(sessionId, nextRuntimePlayer, 'effect_remove_immediate', bundledNumberPatch);
    void sendLanSessionEvent(joinUrl, liveEvent).catch((error) => {
      debugLanFlow('MASTER_REMOVE_EFFECT_SOCKET_SEND_FAILED', {
        sessionId,
        playerId,
        playerKey: targetKey,
        effectId,
        eventId: liveEvent.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    });

    void (async () => {
      try {
        await rememberLanSessionEvent(db, liveEvent).catch(() => false);
        await removeLanPlayerEffect(db, playerId, effectId, { syncPayload: false }).catch((error) => {
          debugLanFlow('MASTER_REMOVE_EFFECT_BACKGROUND_DB_FAILED', {
            sessionId,
            playerId,
            effectId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        if (bundledNumberPatch?.tempHp != null) {
          await updateLanPlayerNumbers(db, playerId, { tempHp: bundledNumberPatch.tempHp }, { syncPayload: false }).catch(() => undefined);
        }
        scheduleSilentPayloadRefresh(sessionId);
      } catch (error) {
        debugLanFlow('MASTER_REMOVE_EFFECT_BACKGROUND_FAILED', {
          sessionId,
          playerId,
          effectId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return liveEvent;
  }, [db, holdLiveRuntimeLock, joinUrl, payload?.session?.id, rememberSentEventInTimeline, scheduleSilentPayloadRefresh, sendPublicPlayerStatus]);

  const applyMasterPlayerPatchInternal = async (
    player: LanSessionPlayerState,
    patch: NumberPatch,
    message: string
  ) => {
    if (!payload || endingSessionRef.current) return;
    traceFunctionCall('applyMasterPlayerPatchInternal', { playerId: player.id, patch, message }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      before: {
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        xp: player.xp,
        gp: player.gp,
        sp: player.sp,
        cp: player.cp,
        revisionSeq: player.revisionSeq,
      },
      patch,
    });

    const hasProjection = Boolean(getLanProjection(payload.session.id));
    const patchKeys = Object.keys(patch).filter((key) => (patch as any)[key] != null);
    const onlyXp = patchKeys.length === 1 && patch.xp != null;
    const onlyCoins = patchKeys.length > 0 && patchKeys.every((key) => key === 'gp' || key === 'sp' || key === 'cp');
    if (hasProjection && (onlyXp || onlyCoins)) {
      const targetKey = getPlayerEngineKey(player);
      const commandId = `master_${onlyXp ? 'set_xp' : 'set_coins'}:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const command: LanCommand = onlyXp
        ? {
            type: 'set_xp',
            commandId,
            sessionId: payload.session.id,
            actorKey: 'master',
            targetKey,
            xp: Math.max(0, Math.floor(Number(patch.xp || 0))),
            reason: message,
          }
        : {
            type: 'set_coins',
            commandId,
            sessionId: payload.session.id,
            actorKey: 'master',
            targetKey,
            coins: {
              gp: patch.gp ?? player.gp,
              sp: patch.sp ?? player.sp,
              cp: patch.cp ?? player.cp,
            },
            reason: message,
          };
      const engineResult = dispatchMasterEngineCommand(command, { targetPlayer: player, message });
      const projectedPlayer = engineResult?.result?.projection?.players?.[targetKey];
      const nextPatch = projectedPlayer ? {
        xp: projectedPlayer.xp,
        gp: projectedPlayer.coins.gp,
        sp: projectedPlayer.coins.sp,
        cp: projectedPlayer.coins.cp,
      } : patch;
      void enqueueLanEntityMutation([getLanPlayerQueueKey(payload.session.id, player.remoteKey)], async () => {
        await updateLanPlayerNumbers(db, player.id, nextPatch, { syncPayload: false }).catch(() => false);
        if (engineResult?.event) await rememberLanSessionEvent(db, engineResult.event).catch(() => false);
        scheduleSilentPayloadRefresh(payload.session.id);
      });
      traceFunctionReturn('applyMasterPlayerPatchInternal', {
        playerId: player.id,
        patch: nextPatch,
        source: 'engine_projection',
      }, {
        screen: 'lan-session',
        source: 'engine/master',
        sessionId: payload.session.id,
        playerId: player.id,
        playerKey: player.remoteKey,
        playerName: player.characterName,
      });
      return;
    }

    const runtimeResult = applyHostNumberPatchRuntime(payload.session.id, sessionStateRef.current, player.id, patch);
    if (!runtimeResult) return;

    sessionStateRef.current = runtimeResult.state;
    setSessionState(runtimeResult.state);
    setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    traceStateChange('STATE_CHANGE', 'MASTER_RUNTIME_PLAYER_PATCH_APPLIED', player, runtimeResult.player, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      patch: runtimeResult.patch,
      entityRevision: runtimeResult.revision,
    });

    debugLanFlow('MASTER_CLICK_HP_LOCAL_RUNTIME_APPLIED', {
      playerId: player.id,
      remoteKey: player.remoteKey,
      characterName: player.characterName,
      patch: runtimeResult.patch,
      beforeHp: player.hpCurrent,
      afterHp: runtimeResult.player.hpCurrent,
      revision: runtimeResult.revision,
    });

    await persistHostNumberPatch(player.id, runtimeResult.patch, message);
    traceFunctionReturn('applyMasterPlayerPatchInternal', {
      playerId: player.id,
      patch: runtimeResult.patch,
      revision: runtimeResult.revision,
    }, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });
    return;

  };

  const handleUpdatePlayerPatch = async (
    player: LanSessionPlayerState,
    patch: NumberPatch,
    message: string
  ) => applyMasterPlayerPatchInternal(player, patch, message);

  const grantXpToPlayerFast = async (
    player: LanSessionPlayerState,
    deltaXp: number,
    source = 'master_xp_direct',
  ) => {
    if (!payload?.session?.id || endingSessionRef.current) return null;
    const latestPlayer = sessionStateRef.current?.players.find((entry) => (
      entry.id === player.id ||
      entry.remoteKey === player.remoteKey ||
      (player.clientId && entry.clientId === player.clientId) ||
      entry.characterName === player.characterName
    )) || player;
    const cleanDelta = Math.floor(Number(deltaXp) || 0);
    if (cleanDelta === 0) {
      debugLanFlow('MASTER_XP_FAST_NOOP_ZERO_DELTA', {
        sessionId: payload.session.id,
        playerId: latestPlayer.id,
        playerKey: latestPlayer.remoteKey,
        playerName: latestPlayer.characterName,
        source,
      });
      return latestPlayer;
    }
    const nextXp = Math.max(0, Math.floor(Number(latestPlayer.xp || 0) + cleanDelta));
    traceApp('EVENT_CREATED', 'MASTER_XP_FAST_PATCH_PREPARED', {
      screen: 'lan-session',
      source,
      sessionId: payload.session.id,
      playerId: latestPlayer.id,
      playerKey: latestPlayer.remoteKey,
      playerName: latestPlayer.characterName,
      before: { xp: latestPlayer.xp, level: latestPlayer.level, revisionSeq: latestPlayer.revisionSeq },
      patch: { xp: nextXp },
      deltaXp: cleanDelta,
    });
    await applyMasterPlayerPatchInternal(
      latestPlayer,
      { xp: nextXp },
      `Mestre ${cleanDelta >= 0 ? 'concedeu' : 'removeu'} ${Math.abs(cleanDelta)} XP de ${latestPlayer.characterName}.`
    );
    return sessionStateRef.current?.players.find((entry) => entry.id === latestPlayer.id) || latestPlayer;
  };

  const handleUpdatePlayerDelta = async (
    player: LanSessionPlayerState,
    field: 'hpCurrent' | 'xp' | 'gp' | 'sp' | 'cp' | 'tempHp',
    delta: number,
    messagePrefix?: string
  ) => {
    if (!payload || endingSessionRef.current) return;
    const sessionId = payload.session.id;
    await enqueueLanEntityMutation(getLanPlayerEntityQueueKeys(sessionId, player), async () => {
    const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id) || player;
    player = latestPlayer;
    const buttonName = field === 'hpCurrent' && delta < 0
      ? 'MASTER_CLICK_HP_MINUS'
      : field === 'hpCurrent' && delta > 0
        ? 'MASTER_CLICK_HP_PLUS'
        : `MASTER_CLICK_${field}_${delta}`;
    traceButton('lan-session', buttonName, {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta, messagePrefix },
      before: {
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        xp: player.xp,
        gp: player.gp,
        sp: player.sp,
        cp: player.cp,
        revisionSeq: player.revisionSeq,
      },
    });
    traceApp('STATE_BEFORE', `${buttonName}_STATE_BEFORE`, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta },
      before: {
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        xp: player.xp,
        gp: player.gp,
        sp: player.sp,
        cp: player.cp,
        revisionSeq: player.revisionSeq,
      },
    });
    traceFunctionCall('handleUpdatePlayerDelta', { playerId: player.id, field, delta, messagePrefix }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });

    const targetKey = getPlayerEngineKey(player);
    if (targetKey && field === 'hpCurrent' && delta !== 0) {
      const amount = Math.abs(Math.floor(Number(delta) || 0));
      dispatchMasterEngineCommand({
        type: delta < 0 ? 'apply_damage' : 'apply_heal',
        commandId: `master_${delta < 0 ? 'damage' : 'heal'}:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        sessionId: payload.session.id,
        actorKey: 'master',
        targetKey,
        amount,
      }, {
        targetPlayer: player,
        message: messagePrefix || (delta < 0
          ? `Mestre causou ${amount} de dano em ${player.characterName}.`
          : `Mestre curou ${amount} HP de ${player.characterName}.`),
      });
      return;
    }

    if (targetKey && field === 'tempHp' && delta !== 0) {
      const nextTempHp = Math.max(0, Math.floor(Number(player.tempHp || 0) + Number(delta || 0)));
      dispatchMasterEngineCommand({
        type: 'apply_temp_hp',
        commandId: `master_temp_hp:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        sessionId: payload.session.id,
        actorKey: 'master',
        targetKey,
        amount: nextTempHp,
      }, {
        targetPlayer: player,
        message: messagePrefix || `Mestre ajustou PV temporario de ${player.characterName}.`,
      });
      return;
    }

    const runtimeResult = applyHostNumberDeltaRuntime(payload.session.id, sessionStateRef.current, player.id, field, delta);
    if (!runtimeResult) return;

    sessionStateRef.current = runtimeResult.state;
    setSessionState(runtimeResult.state);
    setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    traceApp('STATE_AFTER', `${buttonName}_STATE_AFTER`, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta },
      after: {
        hpCurrent: runtimeResult.player.hpCurrent,
        hpMax: runtimeResult.player.hpMax,
        tempHp: runtimeResult.player.tempHp,
        xp: runtimeResult.player.xp,
        gp: runtimeResult.player.gp,
        sp: runtimeResult.player.sp,
        cp: runtimeResult.player.cp,
        revisionSeq: runtimeResult.player.revisionSeq,
      },
      patch: runtimeResult.patch,
    });
    traceStateChange('STATE_CHANGE', 'MASTER_RUNTIME_PLAYER_DELTA_APPLIED', player, runtimeResult.player, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta },
      patch: runtimeResult.patch,
      entityRevision: runtimeResult.revision,
    });
    debugLanFlow('MASTER_CLICK_HP_LOCAL_RUNTIME_APPLIED', {
      playerId: player.id,
      remoteKey: player.remoteKey,
      characterName: player.characterName,
      field,
      delta,
      patch: runtimeResult.patch,
      afterHp: runtimeResult.player.hpCurrent,
      revision: runtimeResult.revision,
    });

    await persistHostNumberPatch(
      player.id,
      runtimeResult.patch,
      messagePrefix || `Mestre ajustou ${formatPlayerField(field as any)} de ${runtimeResult.player.characterName}.`
    );
    traceFunctionReturn('handleUpdatePlayerDelta', {
      playerId: player.id,
      field,
      delta,
      patch: runtimeResult.patch,
      revision: runtimeResult.revision,
    }, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });
    return;

    }, { screen: 'lan-session', source: 'handleUpdatePlayerDelta', sessionId, playerId: player.id, field, delta });
  };

  const syncTempHpEffectsAfterDamageSilently = async (
    sessionId: string,
    playerId: number,
    absorbedTempHp: number,
    source: string,
    playerKey?: string,
  ) => {
    const cleanAbsorbed = Math.max(0, Math.floor(Number(absorbedTempHp) || 0));
    if (cleanAbsorbed <= 0) return;

    // v79: dano em PV temporario nao deve gerar um effect_patch vivo separado.
    // O player_patch autoritativo ja carrega numberPatch.tempHp e o cliente sincroniza
    // o efeito visual localmente a partir desse numero. O sync abaixo apenas mantém o
    // SQLite/runtime do mestre coerentes, sem bloquear a fila de dano/cura e sem mandar
    // um segundo evento que possa chegar atrasado.
    const result = await consumeLanPlayerTempHpAfterDamage(db, playerId, cleanAbsorbed, {
      syncPayload: false,
      recordEvent: false,
    });
    if (!result?.targetKey) {
      debugLanFlow('TEMP_HP_DAMAGE_NO_EFFECT_PATCH', { sessionId, playerId, absorbedTempHp: cleanAbsorbed, source });
      return;
    }

    const hasPatch = Boolean((result.patch.update?.length || 0) > 0 || (result.patch.remove?.length || 0) > 0);
    if (!hasPatch) {
      debugLanFlow('TEMP_HP_DAMAGE_EFFECT_SYNC_NOOP', {
        sessionId,
        playerId,
        targetKey: result.targetKey,
        absorbedTempHp: cleanAbsorbed,
        source,
      });
      return;
    }

    const runtimeResult = applyHostEffectPatchRuntime(sessionId, sessionStateRef.current, result.targetKey, result.patch);
    if (runtimeResult) {
      sessionStateRef.current = runtimeResult.state;
      setSessionState(runtimeResult.state);
      setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    }

    // Atualiza payload depois, em baixa prioridade. Não aguarda e não publica snapshot.
    scheduleSilentPayloadRefresh(sessionId);

    debugLanFlow('PLAYER_TEMP_HP_EFFECTS_SYNCED_AFTER_DAMAGE_SILENT', {
      sessionId,
      playerId,
      playerKey,
      targetKey: result.targetKey,
      absorbed: result.absorbed,
      source,
      updated: result.patch.update?.map((effect: { id: string; value?: number }) => ({ id: effect.id, value: effect.value })),
      removed: result.patch.remove,
      liveEventSent: false,
    });
  };

  const queueTempHpEffectsSyncAfterDamage = (
    sessionId: string,
    playerId: number,
    absorbedTempHp: number,
    source: string,
    playerKey?: string,
  ) => {
    const cleanAbsorbed = Math.max(0, Math.floor(Number(absorbedTempHp) || 0));
    if (!sessionId || !playerId || cleanAbsorbed <= 0) return;

    const syncKey = `${sessionId}:${playerKey || playerId}`;
    const pending = pendingTempHpEffectSilentSyncRef.current[syncKey];
    pendingTempHpEffectSilentSyncRef.current[syncKey] = {
      sessionId,
      playerId,
      playerKey,
      absorbedTempHp: (pending?.absorbedTempHp || 0) + cleanAbsorbed,
      source,
    };

    if (tempHpEffectSilentSyncTimersRef.current[syncKey]) {
      clearTimeout(tempHpEffectSilentSyncTimersRef.current[syncKey]);
    }

    // Debounce curto e fora da fila crítica do jogador. Assim, vários danos seguidos
    // reduzem PV temporário imediatamente via player_patch e a limpeza do efeito roda
    // uma vez só, sem travar a próxima ação do mestre.
    tempHpEffectSilentSyncTimersRef.current[syncKey] = setTimeout(() => {
      const next = pendingTempHpEffectSilentSyncRef.current[syncKey];
      delete pendingTempHpEffectSilentSyncRef.current[syncKey];
      delete tempHpEffectSilentSyncTimersRef.current[syncKey];
      if (!next) return;

      void syncTempHpEffectsAfterDamageSilently(
        next.sessionId,
        next.playerId,
        next.absorbedTempHp,
        next.source,
        next.playerKey,
      ).catch((error) => {
        debugLanFlow('TEMP_HP_DAMAGE_EFFECT_SYNC_BACKGROUND_FAILED', {
          sessionId: next.sessionId,
          playerId: next.playerId,
          playerKey: next.playerKey,
          absorbedTempHp: next.absorbedTempHp,
          source: next.source,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }, 220);
  };

  const handleApplyDamageToPlayer = async (player: LanSessionPlayerState, damage: number) => {
    if (!payload) return;
    const sessionId = payload.session.id;
    const actionId = `damage:${player.id}`;

    await runMasterAction(actionId, async () => {
      await enqueueLanEntityMutation(getLanPlayerEntityQueueKeys(sessionId, player), async () => {
        const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id) || player;
        const cleanDamage = Math.max(0, Math.floor(Number(damage) || 0));
        if (cleanDamage <= 0) return;

        traceButton('lan-session', 'MASTER_APPLY_DAMAGE', {
          source: 'master_click',
          sessionId: payload.session.id,
          playerId: latestPlayer.id,
          playerKey: latestPlayer.remoteKey,
          playerName: latestPlayer.characterName,
          args: { damage: cleanDamage },
          before: {
            hpCurrent: latestPlayer.hpCurrent,
            hpMax: latestPlayer.hpMax,
            tempHp: latestPlayer.tempHp,
          },
        });
        const targetKey = getPlayerEngineKey(latestPlayer);
        if (!targetKey) return;
        dispatchMasterEngineCommand({
          type: 'apply_damage',
          commandId: `master_damage:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          sessionId: payload.session.id,
          actorKey: 'master',
          targetKey,
          amount: cleanDamage,
        }, {
          targetPlayer: latestPlayer,
          message: `Mestre causou ${cleanDamage} de dano em ${latestPlayer.characterName}.`,
        });
      }, { screen: 'lan-session', source: 'handleApplyDamageToPlayer', sessionId, playerId: player.id, field: 'hpCurrent' });
    }, { mode: 'queue', queueDelayMs: MASTER_REPEATABLE_ACTION_QUEUE_DELAY_MS });
  };

  const handleUpdatePlayer = async (
    player: LanSessionPlayerState,
    field: 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp',
    value: number
  ) => {
    if (!payload?.session?.id) return;
    const sessionId = payload.session.id;
    await enqueueLanEntityMutation(getLanPlayerEntityQueueKeys(sessionId, player), async () => {
      const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id) || player;
      const cleanValue = Math.max(0, Math.floor(Number(value) || 0));
      const targetKey = getPlayerEngineKey(latestPlayer);
      if (targetKey && field === 'hpCurrent') {
        const currentHp = Math.max(0, Math.floor(Number(latestPlayer.hpCurrent || 0)));
        const delta = cleanValue - currentHp;
        if (delta !== 0) {
          dispatchMasterEngineCommand({
            type: delta < 0 ? 'apply_damage' : 'apply_heal',
            commandId: `master_${delta < 0 ? 'damage' : 'heal'}:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
            sessionId,
            actorKey: 'master',
            targetKey,
            amount: Math.abs(delta),
          }, {
            targetPlayer: latestPlayer,
            message: `Mestre ajustou ${formatPlayerField(field)} de ${latestPlayer.characterName} para ${cleanValue}.`,
          });
        }
        return;
      }
      if (targetKey && field === 'tempHp') {
        dispatchMasterEngineCommand({
          type: 'apply_temp_hp',
          commandId: `master_temp_hp:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          sessionId,
          actorKey: 'master',
          targetKey,
          amount: cleanValue,
        }, {
          targetPlayer: latestPlayer,
          message: `Mestre ajustou ${formatPlayerField(field)} de ${latestPlayer.characterName} para ${cleanValue}.`,
        });
        return;
      }
      await handleUpdatePlayerPatch(
        latestPlayer,
        { [field]: cleanValue },
        `Mestre ajustou ${formatPlayerField(field)} de ${latestPlayer.characterName} para ${cleanValue}.`
      );
    }, { screen: 'lan-session', source: 'handleUpdatePlayer', sessionId, playerId: player.id, field });
  };

  const handleKickPlayer = (player: LanSessionPlayerState) => {
    traceButton('lan-session', 'MASTER_OPEN_KICK_PLAYER_CONFIRM', {
      source: 'master_click',
      sessionId: payload?.session?.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      before: player,
    });
    Alert.alert(
      'Remover jogador',
      `Remover ${player.characterName} desta sessão? Ele poderá escolher ou criar outro personagem ao entrar de novo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            traceButton('lan-session', 'MASTER_CONFIRM_KICK_PLAYER', {
              source: 'master_click',
              sessionId: payload?.session?.id,
              playerId: player.id,
              playerKey: player.remoteKey,
              playerName: player.characterName,
              before: player,
            });
            const runtimeResult = payload?.session?.id
              ? removeHostPlayerRuntime(payload.session.id, sessionStateRef.current, player)
              : null;
            if (runtimeResult) {
              sessionStateRef.current = runtimeResult.state;
              setSessionState(runtimeResult.state);
              setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
              debugLanFlow('MASTER_KICK_RUNTIME_APPLIED', {
                playerId: player.id,
                remoteKey: player.remoteKey,
                clientId: player.clientId,
                characterName: player.characterName,
                sessionId: payload?.session?.id,
                revision: runtimeResult.revision,
              });
            }
            debugLanFlow('MASTER_KICK_REMOVED_FROM_ROSTER', {
              playerId: player.id,
              remoteKey: player.remoteKey,
              clientId: player.clientId,
              characterName: player.characterName,
              sessionId: payload?.session?.id,
            });
            if (selectedPlayerId === player.id) setSelectedPlayerId(null);
            setExpandedPlayerIds((current) => current.filter((id) => id !== player.id));
            await kickLanSessionPlayer(db, player.id);
            if (payload?.session?.id) {
              const kickedEvent = await sendLatestLiveEvent(payload.session.id, (event) => (
                event.type === 'player_kicked' &&
                (
                  Boolean(player.remoteKey && event.toKey === player.remoteKey) ||
                  event.toName === player.characterName
                )
              ));
              debugLanFlow('MASTER_KICK_SENT_LIVE', {
                eventId: kickedEvent?.id,
                sessionId: payload.session.id,
                remoteKey: player.remoteKey,
                clientId: player.clientId,
                characterName: player.characterName,
              });
              await reloadSessionState(payload.session.id, false);
            }
          },
        },
      ]
    );
  };

  const handleReviewPending = async (player: LanSessionPlayerState, accepted: boolean) => {
    await reviewLanPlayerPendingSnapshot(db, player.id, accepted);
    if (payload?.session?.id) await reloadSessionState(payload!.session.id, false);
  };

  const handleSelectEffectOption = (option: EffectOption) => {
    setSelectedEffectKeys((current) => (
      current.includes(option.key)
        ? current.filter((key) => key !== option.key)
        : [...current, option.key]
    ));

    const firstEffect = option.effects[0] || {};
    setEffectName(firstEffect.conditionName || option.name);
    setEffectSource(option.group);
    setEffectStatusKey(option.statusKey || String(firstEffect.status || ''));
    setEffectColor(option.color || String(firstEffect.color || ''));
    setEffectSecondaryColor(option.secondaryColor || String(firstEffect.secondaryColor || ''));
    setEffectSaveInfo(formatEffectSaveInfo(firstEffect));
    setEffectTarget(normalizeEffectTarget(firstEffect.target || firstEffect.stat || firstEffect.type));
    setEffectValue(String(firstEffect.value ?? firstEffect.val ?? firstEffect.amount ?? 0));
    setEffectMode(firstEffect.mode === 'set' ? 'set' : 'add');
    const isConditionOption = option.group === 'Condicao' || Boolean(option.statusKey || firstEffect.statusKey || firstEffect.status);
    const duration = isConditionOption
      ? { value: 0, remaining: 0, unit: 'manual', isPermanent: false }
      : createEffectDurationPayload({
          value: option.durationValue ?? firstEffect.durationValue ?? firstEffect.duration ?? 1,
          unit: option.durationUnit || firstEffect.durationUnit || firstEffect.unit || inferUnitFromText(option.durationText),
        });
    // v102: não sobrescreva duração/unidade já ajustada pelo mestre ao marcar mais
    // condições. O default manual só entra se a seleção de condição começou agora.
    setEffectDuration((current) => {
      const currentNumber = Math.max(0, Math.floor(Number(current) || 0));
      if (isConditionOption && (selectedEffectKeys.length > 0 || currentNumber > 0)) return current;
      return String(duration.value || 0);
    });
    setEffectUnit((current) => {
      if (isConditionOption && selectedEffectKeys.length > 0) return current;
      return duration.unit as LanEffectUnit;
    });
  };

  const clearSelectedEffects = () => {
    setSelectedEffectKeys([]);
    setEffectSaveInfo('');
    setEffectSource('');
    setEffectName('Efeito temporario');
  };

  const handleDistributeXp = async () => {
    if (!payload?.session?.id) return;
    const latestPlayers = (sessionStateRef.current?.players || sessionState?.players || [])
      .filter((player) => player && player.remoteKey);
    if (latestPlayers.length === 0) return;
    const totalXp = Math.max(0, parseInt(xpPool, 10) || 0);
    traceButton('lan-session', 'MASTER_DISTRIBUTE_XP', {
      source: 'master_click',
      sessionId: payload.session.id,
      args: { totalXp, playerCount: latestPlayers.length },
      before: latestPlayers.map((player) => ({ id: player.id, name: player.characterName, xp: player.xp, revisionSeq: player.revisionSeq })),
    });
    const baseShare = Math.floor(totalXp / latestPlayers.length);
    const remainder = totalXp % latestPlayers.length;
    await Promise.all(latestPlayers.map((player, index) => (
      grantXpToPlayerFast(player, baseShare + (index < remainder ? 1 : 0), 'master_distribute_xp')
    )));
    await recordMasterTimelineEvent(`Mestre distribuiu ${totalXp} XP para a party.`);
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const handleAcceptSpellEffect = async (event: LanSessionEvent, accepted: boolean) => {
    if (!payload) return;
    const targetPlayer = sessionState?.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
    if (accepted && targetPlayer && event.spellEffect) {
      const spellEffectResult = await addLanPlayerEffect(db, targetPlayer.id, {
        name: event.spellEffect.spellName,
        target: event.spellEffect.target || 'custom',
        value: event.spellEffect.value || 0,
        remaining: event.spellEffect.durationRemaining ?? 1,
        unit: event.spellEffect.durationUnit || 'rest',
        durationText: event.spellEffect.durationText,
        isPermanent: event.spellEffect.durationUnit === 'permanent',
        kind: event.spellEffect.target === 'PV_TEMP' ? 'temp_hp' : undefined,
        mode: event.spellEffect.effectMode,
        status: event.spellEffect.status,
        statusKey: event.spellEffect.status,
        color: event.spellEffect.color,
        secondaryColor: event.spellEffect.secondaryColor,
        source: event.fromName,
      }, { syncPayload: false });
      await applyAndSendEffectResult(payload.session.id, spellEffectResult);
    }
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'character_update_review',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: event.fromKey,
      toName: event.fromName,
      entityType: 'request',
      entityId: event.fromKey || event.id,
      ackRequired: Boolean(event.fromKey),
      originClientId: 'master',
      message: accepted
        ? `Mestre aceitou ${event.spellEffect?.spellName || 'efeito'} de ${event.fromName}.`
        : `Mestre recusou ${event.spellEffect?.spellName || 'efeito'} de ${event.fromName}.`,
      createdAt: new Date().toISOString(),
    });

    await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
      latestEvent.type === 'character_update_review' && latestEvent.toKey === event.fromKey
    ));

    setReviewedSpellEventIds((current) => Array.from(new Set([...current, event.id])));
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const handleReviewResourceRequest = async (event: LanSessionEvent, accepted: boolean) => enqueueMasterMutation(async () => {
    if (!payload?.session?.id) return;
    const sessionId = payload.session.id;
    const request = event.resourceRequest;
    const resourceRequestId = String(request?.clientRequestId || event.clientMsgId || event.id);
    const actionId = `resource:${resourceRequestId}:${accepted ? 'accept' : 'reject'}`;

    if (processedHostActionIdsRef.current.has(actionId)) {
      debugLanFlow('DUPLICATE_ACTION_IGNORED_BY_HOST', {
        sessionId,
        eventId: event.id,
        actionId,
        type: event.type,
      });
      return;
    }
    processedHostActionIdsRef.current.add(actionId);

    traceButton('lan-session', accepted ? 'MASTER_ACCEPT_RESOURCE_REQUEST' : 'MASTER_REJECT_RESOURCE_REQUEST', {
      source: 'master_click',
      sessionId,
      eventId: event.id,
      eventType: event.type,
      fromKey: event.fromKey,
      playerName: event.fromName,
      payload: request,
    });

    if (!request) return;

    const reviewEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      type: 'resource_review',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: event.fromKey,
      toName: event.fromName,
      tradeId: event.id,
      resourceRequest: request,
      sourceClientMsgId: resourceRequestId,
      ackRequired: true,
      originClientId: 'master',
      message: accepted
        ? `Mestre aceitou: ${describeResourceForReview(request)}.`
        : `Mestre recusou: ${describeResourceForReview(request)}.`,
      createdAt: new Date().toISOString(),
    };

    // Histórico/feedback primeiro: não espere SQLite ou payload.
    rememberSentEventInTimeline(reviewEvent);
    void sendLanSessionEvent(joinUrl, reviewEvent).catch((error) => {
      debugLanFlow('MASTER_RESOURCE_REVIEW_SEND_FAILED', {
        sessionId,
        eventId: reviewEvent.id,
        requestId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
    void rememberLanSessionEvent(db, reviewEvent).catch(() => false);
    setReviewedRequestEventIds((current) => Array.from(new Set([...current, event.id])));

    if (!accepted) {
      scheduleSilentPayloadRefresh(sessionId);
      return;
    }

    const runtimeState = sessionStateRef.current || await getLanSessionState(db, sessionId);
    const targetPlayer = runtimeState.players.find((player) => player.remoteKey === event.fromKey || player.characterName === event.fromName);
    if (!targetPlayer?.remoteKey) {
      debugLanFlow('MASTER_RESOURCE_REQUEST_ACCEPT_NO_RUNTIME_PLAYER', {
        sessionId,
        eventId: event.id,
        fromKey: event.fromKey,
        fromName: event.fromName,
      });
      return;
    }

    if (getLanProjection(sessionId) && (request.kind === 'xp' || request.kind === 'coin' || request.kind === 'inventory')) {
      const targetKey = getPlayerEngineKey(targetPlayer);
      const commandId = `master_resource_${request.kind}:${resourceRequestId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      let command: LanCommand | null = null;
      if (request.kind === 'xp') {
        command = {
          type: 'grant_reward',
          commandId,
          sessionId,
          actorKey: 'master',
          targetKey,
          requestId: resourceRequestId,
          xp: Math.max(0, Math.floor(Number(request.amount || 0))),
          message: reviewEvent.message,
        };
      } else if (request.kind === 'coin') {
        const bundledCoins = sanitizeCoinPatch((request as any).coins || {});
        const hasBundledCoins = bundledCoins.gp > 0 || bundledCoins.sp > 0 || bundledCoins.cp > 0 || request.action === 'set';
        if (request.action === 'set' && hasBundledCoins) {
          command = {
            type: 'set_coins',
            commandId,
            sessionId,
            actorKey: 'master',
            targetKey,
            coins: bundledCoins,
            reason: reviewEvent.message,
          };
        } else if (hasBundledCoins) {
          command = {
            type: 'grant_reward',
            commandId,
            sessionId,
            actorKey: 'master',
            targetKey,
            requestId: resourceRequestId,
            coins: bundledCoins,
            message: reviewEvent.message,
          };
        } else {
          const field = normalizeResourceCoinField(request.field);
          if (field) {
            command = {
              type: 'grant_reward',
              commandId,
              sessionId,
              actorKey: 'master',
              targetKey,
              requestId: resourceRequestId,
              coins: { [field]: Math.max(0, Math.floor(Number(request.amount ?? request.value ?? 0))) },
              message: reviewEvent.message,
            } as LanCommand;
          }
        }
      } else if (request.kind === 'inventory' && request.item) {
        command = {
          type: 'grant_reward',
          commandId,
          sessionId,
          actorKey: 'master',
          targetKey,
          items: [{ ...(request.item as any), qty: Math.max(1, Number((request.item as any)?.qty || 1)) }],
          message: reviewEvent.message,
        };
      }
      if (command) {
        const engineResult = dispatchMasterEngineCommand(command, { targetPlayer, message: reviewEvent.message });
        const projectedPlayer = engineResult?.result?.projection?.players?.[targetKey];
        if (projectedPlayer) {
          void enqueueLanEntityMutation([getLanPlayerQueueKey(sessionId, String(targetPlayer.remoteKey || ''))], async () => {
            await rememberLanSessionEvent(db, event).catch(() => false);
            if (request.kind === 'inventory') {
              await updateLanPlayerEquipment(db, targetPlayer.id, projectedPlayer.inventory).catch(() => false);
            } else {
              await updateLanPlayerNumbers(db, targetPlayer.id, {
                xp: projectedPlayer.xp,
                gp: projectedPlayer.coins.gp,
                sp: projectedPlayer.coins.sp,
                cp: projectedPlayer.coins.cp,
              }, { syncPayload: false }).catch(() => false);
            }
            if (engineResult?.event) await rememberLanSessionEvent(db, engineResult.event).catch(() => false);
            scheduleSilentPayloadRefresh(sessionId);
          });
        }
        debugLanFlow('MASTER_RESOURCE_REQUEST_ACCEPT_ENGINE_COMMITTED', {
          sessionId,
          requestId: event.id,
          commandType: command.type,
          commandId,
          targetKey,
          decision: 'engine_projection_first',
        });
        return;
      }
    }

    const numericPatch: NumberPatch = {};
    let shouldSendNumberPatch = false;
    let absorbedTempHp = 0;

    if (request.kind === 'xp') {
      numericPatch.xp = Math.max(0, Math.floor(Number(targetPlayer.xp || 0) + Number(request.amount || 0)));
      shouldSendNumberPatch = true;
    }

    if (request.kind === 'hp') {
      const amount = Number(request.amount || 0);
      if (amount < 0) {
        const damageResult = applyDamageWithTempHp({
          hpCurrent: targetPlayer.hpCurrent,
          hpMax: targetPlayer.hpMax,
          tempHp: targetPlayer.tempHp,
          damage: Math.abs(amount),
        });
        numericPatch.hpCurrent = damageResult.nextHpCurrent;
        numericPatch.tempHp = damageResult.nextTempHp;
        absorbedTempHp = damageResult.absorbedTempHp;
      } else {
        numericPatch.hpCurrent = Math.max(0, Math.min(Number(targetPlayer.hpMax || 0), Number(targetPlayer.hpCurrent || 0) + amount));
      }
      shouldSendNumberPatch = true;
    }

    if (request.kind === 'temp_hp') {
      const requestedTempHp = Math.max(0, Math.floor(Number(request.amount ?? request.value ?? 0)));
      numericPatch.tempHp = Math.max(Number(targetPlayer.tempHp || 0), requestedTempHp);
      shouldSendNumberPatch = true;
    }

    if (request.kind === 'coin') {
      const field = normalizeResourceCoinField(request.field);
      if (field) {
        numericPatch[field] = Math.max(0, Math.floor(Number((targetPlayer as any)[field] || 0) + Number(request.amount ?? request.value ?? 0)));
        shouldSendNumberPatch = true;
      }
    }

    if (shouldSendNumberPatch) {
      const runtimePatch = applyHostNumberPatchRuntime(sessionId, runtimeState, targetPlayer.id, numericPatch, 'runtime');
      if (!runtimePatch?.player || !runtimePatch.state) {
        debugLanFlow('MASTER_RESOURCE_REQUEST_RUNTIME_PATCH_FAILED', { sessionId, eventId: event.id, request });
        return;
      }

      sessionStateRef.current = runtimePatch.state;
      setSessionState(runtimePatch.state);
      setPayload((current) => current ? ({ ...current, state: runtimePatch.state }) : current);
      setInventoryModalPlayer((current) => current?.remoteKey === runtimePatch.player.remoteKey ? runtimePatch.player : current);
      setDetailPlayer((current) => current?.remoteKey === runtimePatch.player.remoteKey ? runtimePatch.player : current);

      const patchEvent: LanSessionEvent = {
        id: makeLanEventId(),
        sessionId,
        seq: Date.now(),
        serverSeq: Date.now(),
        type: 'player_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: runtimePatch.player.remoteKey || '',
        toName: runtimePatch.player.characterName,
        entityType: 'player',
        entityId: runtimePatch.player.remoteKey || String(runtimePatch.player.id),
        entityRevision: runtimePatch.revision,
        ackRequired: true,
        originClientId: 'master',
        numberPatchIntent: inferNumberPatchIntent(numericPatch),
        sourceClientMsgId: resourceRequestId,
        tradeId: event.id,
        numberPatch: numericPatch,
        message: reviewEvent.message,
        createdAt: new Date().toISOString(),
      };

      rememberSentEventInTimeline(patchEvent);
      void sendLanSessionEvent(joinUrl, patchEvent).catch((error) => {
        debugLanFlow('MASTER_RESOURCE_PLAYER_PATCH_SEND_FAILED', {
          sessionId,
          eventId: patchEvent.id,
          requestId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      void sendPublicPlayerStatus(sessionId, runtimePatch.player, 'resource_review');
      queueTempHpEffectsSyncAfterDamage(sessionId, runtimePatch.player.id, absorbedTempHp, 'resource_review_hp_damage', runtimePatch.player.remoteKey);

      void enqueueLanEntityMutation([getLanPlayerQueueKey(sessionId, runtimePatch.player.remoteKey)], async () => {
        await rememberLanSessionEvent(db, event).catch(() => false);
        await updateLanPlayerNumbers(db, runtimePatch.player.id, numericPatch, { syncPayload: false }).catch(() => false);
        await rememberLanSessionEvent(db, patchEvent).catch(() => false);
        scheduleSilentPayloadRefresh(sessionId);
      });

      debugLanFlow('MASTER_RESOURCE_REQUEST_ACCEPT_RUNTIME_FIRST', {
        sessionId,
        requestId: event.id,
        patchEventId: patchEvent.id,
        playerKey: runtimePatch.player.remoteKey,
        numberPatch: numericPatch,
        revision: runtimePatch.revision,
        decision: 'ui_and_socket_before_sqlite',
      });
      return;
    }

    if (request.kind === 'inventory' && request.item) {
      const nextEquipment = addItemToHostEquipment(targetPlayer.equipment, request.item as any, Number((request.item as any)?.qty || 1));
      const runtimePlayer = applyHostInventoryRuntimePatch(String(targetPlayer.remoteKey || ''), nextEquipment);
      if (runtimePlayer?.remoteKey) {
        void sendOfficialInventoryPatch(sessionId, runtimePlayer, reviewEvent.message || 'Item concedido pelo mestre.', 'grant', resourceRequestId, {
          itemDelta: {
            mode: 'add',
            item: request.item as any,
            qty: Math.max(1, Number((request.item as any)?.qty || 1)),
            stackKey: getInventoryStackKey(request.item as any),
          },
          itemDeltas: [{
            mode: 'add',
            item: request.item as any,
            qty: Math.max(1, Number((request.item as any)?.qty || 1)),
            stackKey: getInventoryStackKey(request.item as any),
          }],
          entityRevision: Math.max(1, Number(runtimePlayer.revisionSeq || 0)),
        });
        void enqueueLanEntityMutation([getLanPlayerQueueKey(sessionId, String(runtimePlayer.remoteKey || ''))], async () => {
          await rememberLanSessionEvent(db, event).catch(() => false);
          await updateLanPlayerEquipment(db, runtimePlayer.id, nextEquipment).catch(() => false);
          scheduleSilentPayloadRefresh(sessionId);
        });
        debugLanFlow('MASTER_RESOURCE_INVENTORY_REQUEST_ACCEPTED_FAST', {
          sessionId,
          requestId: event.id,
          playerKey: runtimePlayer.remoteKey,
          itemName: (request.item as any)?.name,
          decision: 'runtime_inventory_patch_before_sqlite',
        });
        return;
      }
    }

    if ((request.kind === 'stat' || request.kind === 'buff' || request.kind === 'condition') && request.field) {
      const requestedTarget = String(request.field || '').toUpperCase();
      const amount = Number(request.amount ?? request.value ?? 0);
      const isPermanentAttribute = request.kind === 'stat' && STAT_KEYS.includes(requestedTarget) && (
        request.unit === 'permanent' ||
        String(request.action || '') === 'permanent' ||
        (!request.duration && request.operation !== 'temp')
      );

      if (isPermanentAttribute) {
        const draft: EffectDraft = {
          name: `Ajuste permanente de ${requestedTarget}`,
          target: requestedTarget as LanEffectTarget,
          value: amount,
          remaining: 0,
          unit: 'permanent',
          durationText: 'Permanente',
          isPermanent: true,
          kind: 'stat',
          mode: 'add',
          source: 'Mestre (Pedido aprovado)',
        };
        const result = await applyPermanentStatEffectToPlayer(sessionId, targetPlayer, draft);
        if (result?.event) {
          debugLanFlow('MASTER_RESOURCE_STAT_REQUEST_ACCEPTED_FAST', {
            sessionId,
            requestId: event.id,
            eventId: result.event.id,
            playerKey: targetPlayer.remoteKey,
            stat: requestedTarget,
            amount,
            decision: 'runtime_stats_patch_before_sqlite',
          });
        }
        scheduleSilentPayloadRefresh(sessionId);
        return;
      }

      const duration = createEffectDurationPayload({
        value: request.duration == null ? 1 : request.duration,
        unit: request.unit || 'turn',
      });
      const target = request.kind === 'condition' ? 'custom' : normalizeEffectTarget(request.field);
      const draft: EffectDraft = {
        name: request.message || `Pedido de ${request.field}`,
        target,
        value: amount,
        remaining: Math.max(1, Number(duration.remaining || 1)),
        unit: duration.unit as LanEffectUnit,
        durationText: `${Math.max(1, Number(duration.remaining || 1))} ${duration.unit}`,
        isPermanent: false,
        kind: request.kind === 'condition' ? 'status' : target === 'PV_TEMP' ? 'temp_hp' : target === 'HP' ? 'hp' : 'stat',
        status: request.kind === 'condition' ? request.field : undefined,
        statusKey: request.kind === 'condition' ? request.field : undefined,
        mode: 'add',
        source: 'Mestre (Pedido aprovado)',
        visibleToPlayer: true,
      };
      persistHostEffectPatch(targetPlayer, draft, reviewEvent.message);
      scheduleSilentPayloadRefresh(sessionId);
      return;
    }

    // Efeitos, condições, buffs e inventário ainda precisam da regra completa do serviço,
    // mas o histórico/feedback já foi emitido acima. A persistência roda em segundo plano.
    void (async () => {
      const applied = await applyLanResourceRequest(db, event, accepted).catch((error) => {
        debugLanFlow('MASTER_RESOURCE_REQUEST_BACKGROUND_APPLY_FAILED', {
          sessionId,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      if (!applied) return;
      if (['stat', 'buff', 'condition'].includes(request.kind)) {
        await sendRecentLiveEvents(sessionId, (latestEvent) => (
          latestEvent.type === 'effect_patch' && latestEvent.toKey === event.fromKey
        ));
      }
      if (request.kind === 'inventory') {
        await sendRecentLiveEvents(sessionId, (latestEvent) => (
          latestEvent.type === 'inventory_patch' && latestEvent.toKey === event.fromKey
        ));
      }
      scheduleSilentPayloadRefresh(sessionId);
    })();
  });

  const handleResolvePendingSave = async (save: LanPendingSave, passed: boolean) => {
    if (!payload) return;
    const resolved = await resolveSave(db, save.id, passed);
    if (!resolved) {
      debugLanFlow('MASTER_PENDING_SAVE_ALREADY_RESOLVED_V106', {
        sessionId: payload.session.id,
        saveId: save.id,
        passed,
      });
      setPendingSaves((current) => current.filter((entry) => entry.id !== save.id));
      setPendingSaves(await listPendingSaves(db, payload.session.id));
      return;
    }
    const targetPlayer = sessionStateRef.current?.players.find((entry) => entry.remoteKey === save.targetKey)
      || sessionState?.players.find((entry) => entry.remoteKey === save.targetKey);
    const pendingPayload = (resolved.effectPayload || save.effectPayload || {}) as Record<string, any>;
    const activeEffectId = targetPlayer ? getActiveEffectIdFromPendingPayload(pendingPayload, targetPlayer) : '';

    if (targetPlayer && activeEffectId) {
      if (passed) {
        const removal = await removeLanPlayerEffect(db, targetPlayer.id, activeEffectId, { syncPayload: false });
        await applyAndSendEffectResult(payload.session.id, removal);
      } else {
        debugLanFlow('MASTER_ACTIVE_EFFECT_SAVE_FAILED_KEEPING_EFFECT', {
          sessionId: payload.session.id,
          targetKey: save.targetKey,
          effectId: activeEffectId,
        });
      }
    } else if (targetPlayer && !passed) {
      const draftAfterSave = buildEffectDraftFromPendingSavePayload(pendingPayload, {
        dc: save.dc,
        sourceName: save.sourceName,
      });
      const permanentResult = isPermanentStatEffect(draftAfterSave)
        ? await applyPermanentStatEffectToPlayer(payload.session.id, targetPlayer, draftAfterSave)
        : null;
      const result = permanentResult ? null : await addLanPlayerEffect(db, targetPlayer.id, draftAfterSave, { syncPayload: false });
      await applyAndSendEffectResult(payload.session.id, result);
    }
    setPendingSaves((current) => current.filter((entry) => entry.id !== save.id));
    await rememberAndSendLanSessionEvent(db, joinUrl, {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'pending_save_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: save.targetKey,
      toName: save.targetKey,
      entityType: 'save',
      entityId: save.id,
      ackRequired: true,
      originClientId: 'master',
      pendingSavePatch: {
        action: 'resolve',
        id: save.id,
        // v107: jogador fecha modal por id ou result.requestId; envie ambos.
        result: { passed, requestId: save.id },
      },
      message: `Mestre marcou ${save.sourceName || 'teste'} como ${passed ? 'sucesso' : 'falha'}.`,
      createdAt: new Date().toISOString(),
    });
    setPendingSaves(await listPendingSaves(db, payload.session.id));
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const handleGrantItemToPlayer = async (item: InventoryItemOption) => {
    const qty = Math.max(1, parseInt(grantItemQty, 10) || 1);
    const actionId = `grant_item:${inventoryModalPlayer?.id || 'none'}:${item.id || item.name}:${qty}:${Date.now()}`;

    await runMasterAction(actionId, async () => {
    if (!inventoryModalPlayer || !payload) return;
    debugLanFlow('MASTER_GRANT_ITEM_START', {
      sessionId: payload.session.id,
      playerId: inventoryModalPlayer.id,
      playerKey: inventoryModalPlayer.remoteKey,
      itemName: item.name,
      qty,
    });
    traceButton('lan-session', 'MASTER_GRANT_ITEM', {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: inventoryModalPlayer.id,
      playerKey: inventoryModalPlayer.remoteKey,
      playerName: inventoryModalPlayer.characterName,
      args: { itemName: item.name, qty },
      before: inventoryModalPlayer.equipment,
    });
    const latestInventoryPlayer = sessionStateRef.current?.players.find((entry) => entry.id === inventoryModalPlayer.id || entry.remoteKey === inventoryModalPlayer.remoteKey) || inventoryModalPlayer;
    const equipment = normalizeHostEquipment(latestInventoryPlayer.equipment as any);
    const nextItem = {
      name: item.name,
      weight: item.weight || 0,
      damage: item.damage || '',
      damage_type: item.damage_type || '',
      properties: item.properties || '',
      descricao: item.descricao || '',
      effect_json: item.effect_json || '[]',
      duration_value: item.duration_value ?? null,
      duration_unit: item.duration_unit || null,
    };
    const targetKey = getPlayerEngineKey(latestInventoryPlayer);
    if (getLanProjection(payload.session.id) && targetKey) {
      const engineResult = dispatchMasterEngineCommand({
        type: 'grant_reward',
        commandId: actionId,
        sessionId: payload.session.id,
        actorKey: 'master',
        targetKey,
        items: [{ ...nextItem, qty }],
        message: `Mestre entregou ${qty}x ${item.name} para ${latestInventoryPlayer.characterName}.`,
      }, {
        targetPlayer: latestInventoryPlayer,
        message: `Mestre entregou ${qty}x ${item.name} para ${latestInventoryPlayer.characterName}.`,
      });
      const projectedPlayer = engineResult?.result?.projection?.players?.[targetKey];
      if (projectedPlayer) {
        setInventoryModalPlayer((current) => current?.remoteKey === latestInventoryPlayer.remoteKey
          ? mergeLanProjectionIntoSessionState(engineResult.result.projection, sessionStateRef.current).players.find((entry) => entry.remoteKey === latestInventoryPlayer.remoteKey) || current
          : current);
        void enqueueLanEntityMutation([getLanPlayerQueueKey(payload.session.id, String(latestInventoryPlayer.remoteKey || ''))], async () => {
          await updateLanPlayerEquipment(db, latestInventoryPlayer.id, projectedPlayer.inventory).catch(() => false);
          scheduleSilentPayloadRefresh(payload.session.id);
        });
      }
      debugLanFlow('MASTER_GRANT_ITEM_ENGINE_COMMITTED', {
        sessionId: payload.session.id,
        playerId: latestInventoryPlayer.id,
        playerKey: targetKey,
        itemName: item.name,
        qty,
        commandId: actionId,
      });
      return;
    }
    const bag = mergeInventoryItemIntoBag(equipment.bag, nextItem, qty);
    const nextEquipment = { ...equipment, bag };
    const nextPlayer: LanSessionPlayerState = {
      ...latestInventoryPlayer,
      equipment: nextEquipment,
      revisionSeq: Math.max(0, Number(inventoryModalPlayer.revisionSeq || 0)) + 1,
    };

    // Fast path: a UI do mestre e o jogador recebem o inventory_patch antes do reload/payload.
    // Marca também o runtime como vivo; assim um reload/snapshot antigo não remove o item recém-entregue.
    const runtimeResult = applyHostInventoryPatchRuntime(
      payload.session.id,
      sessionStateRef.current,
      nextPlayer.remoteKey || String(nextPlayer.id),
      nextEquipment,
      undefined,
      'runtime'
    );
    const optimisticState = runtimeResult?.state || (sessionStateRef.current
      ? {
          ...sessionStateRef.current,
          players: sessionStateRef.current.players.map((player) => player.id === nextPlayer.id ? nextPlayer : player),
        }
      : null);
    const optimisticPlayer = runtimeResult?.player || nextPlayer;
    setInventoryModalPlayer(optimisticPlayer);
    if (optimisticState) {
      applyRuntimeStateToUiAndTransport(optimisticState);
    }

    const persistPromise = updateLanPlayerEquipment(
      db,
      inventoryModalPlayer.id,
      nextEquipment
    );

    debugLanFlow('MASTER_GRANT_ITEM_RUNTIME_APPLIED', {
      sessionId: payload.session.id,
      playerId: nextPlayer.id,
      playerKey: nextPlayer.remoteKey,
      itemName: item.name,
      qty,
      mode: 'fast_path_before_reload',
    });

    const event = await sendOfficialInventoryPatch(
      payload.session.id,
      optimisticPlayer,
      `Mestre entregou ${qty}x ${item.name} para ${optimisticPlayer.characterName}.`,
      'grant',
      actionId,
      {
        itemDelta: {
          mode: 'add',
          item: nextItem,
          qty,
          stackKey: getInventoryStackKey({ ...nextItem, qty }),
        },
        itemDeltas: [{
          mode: 'add',
          item: nextItem,
          qty,
          stackKey: getInventoryStackKey({ ...nextItem, qty }),
        }],
        entityRevision: Math.max(1, Number(optimisticPlayer.revisionSeq || 0)),
      }
    );
    debugLanFlow('MASTER_GRANT_ITEM_PATCH_SENT', {
      sessionId: payload.session.id,
      eventId: event?.id,
      playerId: nextPlayer.id,
      playerKey: nextPlayer.remoteKey,
      itemName: item.name,
      qty,
    });

    await persistPromise;
    debugLanFlow('MASTER_GRANT_ITEM_SQLITE_DONE', {
      sessionId: payload.session.id,
      playerId: inventoryModalPlayer.id,
      playerKey: inventoryModalPlayer.remoteKey,
      itemName: item.name,
      qty,
    });
    scheduleSilentPayloadRefresh(payload.session.id);
    });
  };

  const toggleExpandedPlayer = (playerId: number) => {
    setExpandedPlayerIds((current) => (
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    ));
  };

  // NOVO: Função para Aplicar Efeitos considerando o novo seletor (Toda a party ou Específico)
  const completeMasterDiceValuePrompt = useCallback((result: DiceValueResolution | null) => {
    const resolver = pendingMasterDiceValueResolverRef.current;
    pendingMasterDiceValueResolverRef.current = null;
    pendingMasterVisualDiceValueRef.current = null;
    setMasterDiceValuePrompt({ visible: false, title: '', message: '', formula: '', qty: 1, manualValue: '' });
    resolver?.(result);
  }, []);

  const requestMasterDiceValueForUse = useCallback((title: string, formula: string, qty = 1) => {
    const parsed = parseUsableDiceFormula(formula, qty);
    if (!parsed) return Promise.resolve<DiceValueResolution | null>(null);

    return new Promise<DiceValueResolution | null>((resolve) => {
      pendingMasterDiceValueResolverRef.current = resolve;
      setMasterDiceValuePrompt({
        visible: true,
        title,
        message: `Informe o valor final de ${parsed.formula} ou use o dado virtual.`,
        formula,
        qty,
        manualValue: '',
      });
    });
  }, []);

  const rollMasterDiceValuePromptVirtually = useCallback(() => {
    const resolver = pendingMasterDiceValueResolverRef.current;
    if (!resolver) return;

    const parsed = parseUsableDiceFormula(masterDiceValuePrompt.formula, masterDiceValuePrompt.qty);
    if (!parsed) {
      completeMasterDiceValuePrompt(null);
      return;
    }

    setMasterDiceValuePrompt((current) => ({ ...current, visible: false }));
    if (canUseVisualDiceRoll(parsed)) {
      pendingMasterVisualDiceValueRef.current = { parsed, resolve: resolver };
      setMasterDiceRollRequest({ sides: parsed.sides, count: parsed.count, nonce: Date.now() });
      return;
    }

    const rolled = rollParsedDiceFormula(parsed);
    completeMasterDiceValuePrompt({
      total: rolled.total,
      mode: 'virtual',
      formula: parsed.formula,
      breakdown: rolled.breakdown,
    });
  }, [completeMasterDiceValuePrompt, masterDiceValuePrompt.formula, masterDiceValuePrompt.qty]);

  const submitManualMasterDiceValuePrompt = useCallback(() => {
    const value = Math.max(0, Math.floor(Number(masterDiceValuePrompt.manualValue) || 0));
    if (value <= 0) return;
    const parsed = parseUsableDiceFormula(masterDiceValuePrompt.formula, masterDiceValuePrompt.qty);
    completeMasterDiceValuePrompt({
      total: value,
      mode: 'manual',
      formula: parsed?.formula || masterDiceValuePrompt.formula,
      breakdown: String(value),
    });
  }, [completeMasterDiceValuePrompt, masterDiceValuePrompt.formula, masterDiceValuePrompt.manualValue, masterDiceValuePrompt.qty]);

  const handleMasterDiceRollComplete = useCallback((result: DiceRollResult) => {
    const pending = pendingMasterVisualDiceValueRef.current;
    if (!pending) return;
    const total = Math.max(0, Math.floor(Number(result.total || 0) + Number(pending.parsed.modifier || 0)));
    completeMasterDiceValuePrompt({
      total,
      mode: 'virtual',
      formula: pending.parsed.formula,
      breakdown: formatDiceRollBreakdown((result.rolls || []).join('+'), pending.parsed.modifier),
    });
  }, [completeMasterDiceValuePrompt]);

  const handleApplyEffect = async () => runMasterAction('apply_effect', () => enqueueMasterMutation(async () => {
    if (!sessionState || !payload?.session?.id) return;
    traceButton('lan-session', 'MASTER_APPLY_EFFECT', {
      source: 'master_click',
      sessionId: payload.session.id,
      args: {
        effectTargetPlayerId,
        selectedEffectKeys,
        effectName,
        effectTarget,
        effectValue,
        effectDuration,
        effectUnit,
      },
    });

    const targets = effectTargetPlayerId === 'ALL'
      ? sessionState.players
      : sessionState.players.filter((player) => player.id === effectTargetPlayerId);

    if (targets.length === 0) return;

    const rawManualDuration = createEffectDurationPayload({ value: effectDuration, unit: effectUnit });
    const selectedConditionCount = selectedEffectOptions.filter((option) => (
      option.group === 'Condicao' || Boolean(option.statusKey || option.effects?.[0]?.statusKey || option.effects?.[0]?.status)
    )).length;
    const typedDurationValue = Math.max(0, Math.floor(Number(effectDuration) || 0));
    // v102: em v101 o log mostrou effectDuration="1" e effectUnit="manual" ao aplicar
    // condições. Isso acontecia porque selecionar outra condição podia restaurar o default
    // manual, mesmo o mestre tendo digitado quantidade/esperando turnos. Para condição,
    // quantidade > 0 + unidade manual vira turnos; quantidade vazia/0 continua manual.
    const manualDuration = selectedConditionCount > 0 && rawManualDuration.unit === 'manual' && typedDurationValue > 0
      ? createEffectDurationPayload({ value: String(typedDurationValue), unit: 'turn' })
      : rawManualDuration;
    debugLanFlow('EFFECT_DURATION_PAYLOAD_CREATED_V102', {
      sessionId: payload.session.id,
      rawValue: rawManualDuration.value,
      rawRemaining: rawManualDuration.remaining,
      rawUnit: rawManualDuration.unit,
      typedDurationValue,
      selectedConditionCount,
      value: manualDuration.value,
      remaining: manualDuration.remaining,
      unit: manualDuration.unit,
      isPermanent: manualDuration.isPermanent,
    });
    const parsedManualDiceValue = parseUsableDiceFormula(effectValue);
    const resolvedManualDiceValue = parsedManualDiceValue
      ? await requestMasterDiceValueForUse('Aplicar efeito', effectValue, 1)
      : null;
    if (parsedManualDiceValue && !resolvedManualDiceValue) return;
    const manualEffectValue = resolvedManualDiceValue?.total ?? (parseInt(effectValue, 10) || 0);
    const manualEffectValueDetail = resolvedManualDiceValue?.breakdown
      ? `${resolvedManualDiceValue.formula}: ${resolvedManualDiceValue.breakdown}`
      : '';
    const manualDurationText = formatLanDurationText(manualDuration.remaining, manualDuration.unit, manualDuration.isPermanent);
    const selectedDurationOverridesCondition = manualDuration.isPermanent || manualDuration.unit !== 'manual';
    const drafts: EffectDraft[] = selectedEffectOptions.length > 0
      ? selectedEffectOptions.map((option) => {
        const draft = makeEffectDraftFromOption(option);
        const isConditionDraft = option.group === 'Condicao' || draft.kind === 'status' || Boolean(draft.statusKey || draft.status);
        const shouldUseManualDuration = !isConditionDraft || selectedDurationOverridesCondition;
        const nextRemaining = shouldUseManualDuration ? manualDuration.remaining : draft.remaining;
        const nextUnit = (shouldUseManualDuration ? manualDuration.unit : draft.unit) as LanEffectUnit;
        const nextDurationText = shouldUseManualDuration
          ? manualDurationText
          : (draft.durationText || 'Manual');
        // v101: condicao continua manual por padrao, mas se o mestre escolher
        // quantidade/unidade no modal (ex.: 1 turno), essa escolha deve vencer
        // o default do catalogo. Na v100 o status sempre voltava como Manual.
        const nextAutoExpire = isConditionDraft
          ? (selectedDurationOverridesCondition && nextUnit !== 'manual' && nextUnit !== 'permanent')
          : (draft as any).autoExpire;
        return {
          ...draft,
          value: manualEffectValue,
          remaining: nextRemaining,
          unit: nextUnit,
          durationText: nextDurationText,
          source: [draft.source, manualEffectValueDetail].filter(Boolean).join(' - ') || draft.source,
          autoExpire: nextAutoExpire,
          saveDc: draft.saveDc || (draft.saveAbility && manualEffectValue > 0 ? manualEffectValue : undefined),
        };
      })
      : [{
        name: effectName.trim() || 'Efeito temporario',
        target: effectTarget,
        value: manualEffectValue,
        remaining: manualDuration.remaining,
        unit: manualDuration.unit as LanEffectUnit,
        durationText: manualDurationText,
        kind: effectTarget === 'PV_TEMP' ? 'temp_hp' : effectTarget === 'HP' ? 'hp' : effectTarget === 'custom' ? 'custom' : 'stat',
        mode: effectMode,
        source: [effectSource.trim(), effectSaveInfo, manualEffectValueDetail].filter(Boolean).join(' - ') || undefined,
        statusKey: effectTarget === 'custom' ? effectStatusKey || undefined : undefined,
        color: effectColor || undefined,
        secondaryColor: effectSecondaryColor || undefined,
      }];

    for (const targetPlayer of targets) {
      const effectsToApply = drafts.map((draft) => {
        const usesStatusCatalog = draft.kind === 'status' || draft.target === 'custom';
        return {
          name: draft.name,
          target: draft.target,
          value: draft.value,
          remaining: draft.remaining,
          unit: draft.unit,
          durationText: draft.durationText,
          kind: draft.kind,
          mode: draft.mode,
          source: draft.source || 'Mestre',
          status: usesStatusCatalog ? draft.statusKey : undefined,
          statusKey: usesStatusCatalog ? draft.statusKey : undefined,
          color: draft.color,
          secondaryColor: draft.secondaryColor,
          saveAbility: draft.saveAbility,
          saveDc: draft.saveDc,
          repeatSave: draft.repeatSave,
          saveOnSuccess: draft.saveOnSuccess,
          autoExpire: (draft as any).autoExpire,
        };
      });
      const directEffects = [];
      for (const effect of effectsToApply) {
        if (effect.saveAbility && Number(effect.saveDc || 0) > 0 && targetPlayer.remoteKey) {
          debugLanFlow('MASTER_EFFECT_SAVE_CONFIGURED', {
            targetKey: targetPlayer.remoteKey,
            effectName: effect.name,
            saveAbility: effect.saveAbility,
            dc: effect.saveDc,
          });
          const pending = await createPendingSave(db, {
            sessionId: payload.session.id,
            playerId: targetPlayer.id,
            targetKey: targetPlayer.remoteKey,
            sourceType: 'master_effect',
            sourceId: effect.statusKey || effect.name,
            sourceName: effect.name,
            appliedByKey: 'master',
            appliedByName: 'Mestre',
          }, {
            ...effect,
            save: {
              ability: effect.saveAbility,
              dc: effect.saveDc,
              onSuccess: effect.saveOnSuccess || 'negates',
            },
          });
          if (pending) {
            await sendEffectSaveRequest(payload.session.id, targetPlayer.remoteKey, targetPlayer.characterName, {
              id: pending.id,
              sourceEffectId: effect.statusKey || effect.name,
              sourceEffectName: effect.name,
              targetKey: targetPlayer.remoteKey,
              saveAbility: pending.ability,
              dc: pending.dc ?? null,
              rollMode: 'target_choice',
              saveOnSuccess: effect.saveOnSuccess || 'negates',
              saveOnFailure: 'apply_full',
              pendingEffectPayload: pending.effectPayload,
            }, pending);
          }
        } else {
          debugLanFlow('MASTER_EFFECT_APPLIES_DIRECT_NO_SAVE', {
            targetKey: targetPlayer.remoteKey,
            effectName: effect.name,
          });
          directEffects.push(effect);
        }
      }
      for (const effect of directEffects) {
        dispatchMasterEffectDraft(
          targetPlayer,
          effect,
          `${effect.name || 'Efeito'} aplicado em ${targetPlayer.characterName}.`
        );
      }
    }

    await recordMasterTimelineEvent(`Mestre aplicou ${drafts.length} efeito(s) em ${targets.length} alvo(s).`);
    setSelectedEffectKeys([]);
  }));

  const handleRemoveEffect = async (playerId: number, effectId: string) => {
    if (!payload?.session?.id) return;
    const player = sessionStateRef.current?.players.find((entry) => entry.id === playerId);
    traceButton('lan-session', 'MASTER_REMOVE_EFFECT', {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId,
      entityId: effectId,
    });
    if (player) {
      const targetKey = getPlayerEngineKey(player);
      if (targetKey) {
        dispatchMasterEngineCommand({
          type: 'remove_effect',
          commandId: `master_remove_effect:${targetKey}:${effectId}:${Date.now()}`,
          sessionId: payload.session.id,
          actorKey: 'master',
          targetKey,
          effectId,
        }, {
          targetPlayer: player,
          message: `${String((player.effects || []).find((effect) => String((effect as any).id || (effect as any).effectId || '') === String(effectId))?.name || 'Efeito')} removido de ${player.characterName}.`,
        });
        void recordMasterTimelineEvent('Mestre removeu um efeito ativo.');
        return;
      }
    }

    const event = persistHostEffectRemovalPatch(playerId, effectId);
    if (event) {
      void recordMasterTimelineEvent('Mestre removeu um efeito ativo.');
      return;
    }

    // Fallback: se o runtime ainda nao tinha o efeito, usa o caminho antigo.
    void enqueueMasterMutation(async () => {
      if (!payload?.session?.id) return;
      const result = await removeLanPlayerEffect(db, playerId, effectId, { syncPayload: false });
      await applyAndSendEffectResult(payload.session.id, result);
      await recordMasterTimelineEvent('Mestre removeu um efeito ativo.');
      scheduleSilentPayloadRefresh(payload.session.id);
    });
  };

  // NOVO: Funções para o Modal de Edição Rápida
  const openQuickEdit = (player: LanSessionPlayerState, type: 'STAT' | 'HP' | 'XP' | 'COIN' | 'PV_TEMP', stat?: string) => {
    setQeValue('');
    setQeDuration('1');
    setQeUnit('hour');
    setQeIsTemp(type === 'STAT' || type === 'PV_TEMP');
    setQeGP('');
    setQeSP('');
    setQeCP('');
    setQuickEdit({ player, type, stat });
  };

  const handleQuickEditValueChange = (text: string) => {
    const allowNegative = quickEdit?.type === 'HP' || quickEdit?.type === 'PV_TEMP';
    const nextValue = sanitizeIntegerInput(text, allowNegative);
    setQeValue(nextValue);
    const isDamageValue = nextValue.trim().startsWith('-');
    if (isDamageValue && allowNegative) {
      setQeIsTemp(false);
    }
  };

  const handleApplyQuickEdit = async () => {
    if (!quickEdit) return;
    const previewVal = parseInt(qeValue, 10) || 0;
    const isDamageQuickEdit = (quickEdit.type === 'HP' || quickEdit.type === 'PV_TEMP') && previewVal < 0;
    const actionId = isDamageQuickEdit
      ? `quick_edit_damage:${quickEdit.player.id}`
      : `quick_edit:${quickEdit.player.id}:${quickEdit.type}:${quickEdit.stat || 'none'}`;

    return runMasterAction(actionId, async () => {
    if (!quickEdit) return;
    const { player, type, stat } = quickEdit;
    const val = parseInt(qeValue, 10) || 0;
    traceButton('lan-session', 'MASTER_APPLY_QUICK_EDIT', {
      source: 'master_click',
      sessionId: payload?.session?.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { type, stat, val, qeValue, qeGP, qeSP, qeCP, qeDuration, qeUnit, qeIsTemp },
      before: player,
    });

    if (type === 'XP') {
       // v89: XP direto precisa usar o mesmo caminho vivo de HP/moedas.
       // Antes dependia de reload/SQLite e podia nao gerar player_patch imediato.
      setQuickEdit(null);
       await grantXpToPlayerFast(player, val, 'master_quick_xp');
       return;
    } else if (type === 'COIN') {
       const addGp = parseInt(qeGP, 10) || 0;
       const addSp = parseInt(qeSP, 10) || 0;
       const addCp = parseInt(qeCP, 10) || 0;
       const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id) || player;
       const patchedGp = Math.max(0, Math.floor(Number(latestPlayer.gp || 0) + addGp));
       const patchedSp = Math.max(0, Math.floor(Number(latestPlayer.sp || 0) + addSp));
       const patchedCp = Math.max(0, Math.floor(Number(latestPlayer.cp || 0) + addCp));

       // v40: não normalize PP/PC para PO. O mestre deve conseguir entregar
       // exatamente a denominação escolhida: +20 PP aumenta sp, não converte
       // automaticamente para +2 PO.
       setQuickEdit(null);
       await handleUpdatePlayerPatch(
         latestPlayer,
         { gp: patchedGp, sp: patchedSp, cp: patchedCp },
         `Mestre ajustou moedas de ${latestPlayer.characterName} para ${patchedGp} PO, ${patchedSp} PP, ${patchedCp} PC.`
       );
    } else if (type === 'STAT' && stat && !qeIsTemp) {
       if (!payload?.session?.id) return;
       const normalizedTarget = String(stat).toUpperCase() as LanEffectTarget;
       const permanentStatEffect: EffectDraft = {
         name: `Ajuste permanente de ${normalizedTarget}`,
         target: normalizedTarget,
         value: val,
         remaining: 0,
         unit: 'permanent',
         durationText: 'Permanente',
         isPermanent: true,
         kind: 'stat',
         mode: 'add',
         source: 'Mestre (Permanente)',
       };
       dispatchMasterEffectDraft(
         player,
         permanentStatEffect,
         `Mestre aplicou ${val >= 0 ? '+' : ''}${val} permanente em ${normalizedTarget} de ${player.characterName}.`
       );
       void recordMasterTimelineEvent(`Mestre aplicou ${val >= 0 ? '+' : ''}${val} permanente em ${normalizedTarget} de ${player.characterName}.`, player);
       setQuickEdit(null);
       return;
      /*
      const result = await applyPermanentStatEffectToPlayer(payload.session.id, player, permanentStatEffect);
       if (result?.player) {
         // Runtime-first: não recarregue SQLite aqui. O reload era a causa do delay
         // e podia devolver atributos antigos enquanto o player_patch ainda chegava.
         void recordMasterTimelineEvent(`Mestre aplicou ${val >= 0 ? '+' : ''}${val} permanente em ${normalizedTarget} de ${player.characterName}.`, result.player);
         scheduleSilentPayloadRefresh(payload.session.id);
       }
       setQuickEdit(null);
       */
    } else if ((type === 'HP' || type === 'PV_TEMP') && val < 0) {
       const latestPlayer = sessionStateRef.current?.players.find((entry) => entry.id === player.id) || player;
       const damage = Math.abs(val);
       const targetKey = getPlayerEngineKey(latestPlayer);
       if (payload?.session?.id && targetKey) {
         dispatchMasterEngineCommand({
           type: 'apply_damage',
           commandId: `master_damage:${targetKey}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
           sessionId: payload.session.id,
           actorKey: 'master',
           targetKey,
           amount: damage,
         }, {
           targetPlayer: latestPlayer,
           message: `Mestre causou ${damage} de dano em ${latestPlayer.characterName}.`,
         });
       }
       setQuickEdit(null);
    } else if (type === 'HP' && !qeIsTemp) {
       await handleUpdatePlayer(player, 'hpCurrent', val);
    } else {
       // STAT, PV_TEMP, ou HP (Temporário = Max HP buff)
       const effectType = type === 'HP' && qeIsTemp ? 'PV_TEMP' : type;
       const effTarget = effectType === 'PV_TEMP' ? 'PV_TEMP' : effectType === 'HP' ? 'HP' : (stat as LanEffectTarget);
       const effName = effectType === 'PV_TEMP' ? 'PV Temporario' : effectType === 'HP' ? 'HP Maximo Temporario' : `Ajuste de ${stat}`;
       const effKind = effectType === 'PV_TEMP' ? 'temp_hp' : effectType === 'HP' ? 'hp' : 'stat';
       const duration = createEffectDurationPayload({ value: qeDuration, unit: qeUnit });

       const draft: EffectDraft = {
           name: effName,
           target: effTarget,
           value: val,
           remaining: qeIsTemp ? duration.remaining : 0,
           unit: qeIsTemp ? duration.unit as LanEffectUnit : 'permanent',
           durationText: qeIsTemp ? formatLanDurationText(duration.remaining, duration.unit, duration.isPermanent) : 'Permanente',
           isPermanent: !qeIsTemp,
           kind: effKind,
           mode: 'add',
           source: qeIsTemp ? 'Mestre' : 'Mestre (Permanente)',
       };
       dispatchMasterEffectDraft(player, draft, `${effName} aplicado em ${player.characterName}.`);
    }
    setQuickEdit(null);
    }, isDamageQuickEdit
      ? { mode: 'queue', queueDelayMs: MASTER_REPEATABLE_ACTION_QUEUE_DELAY_MS }
      : { mode: 'drop', cooldownMs: 350, keepPendingMs: 250 });
  };

  const renderQuickEditModal = () => {
    if (!quickEdit) return null;
    const { type, stat, player } = quickEdit;
    const parsedValue = parseInt(qeValue, 10) || 0;
    const isDamageQuickEdit = (type === 'HP' || type === 'PV_TEMP') && parsedValue < 0;
    const quickEditActionId = isDamageQuickEdit
      ? `quick_edit_damage:${player.id}`
      : `quick_edit:${player.id}:${type}:${stat || 'none'}`;
    const showTempToggle = (type === 'STAT' || type === 'PV_TEMP' || type === 'HP') && !isDamageQuickEdit;
    
    let title = '';
    if (type === 'HP') title = 'Ajustar Vida (HP)';
    else if (type === 'XP') title = 'Adicionar XP';
    else if (type === 'COIN') title = 'Adicionar Moedas';
    else if (type === 'PV_TEMP') title = 'PV Temporário';
    else if (type === 'STAT') title = `Modificar ${stat}`;

    return (
      <Modal visible={!!quickEdit} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{title}</Text>
                <Text style={styles.mutedText}>{player.characterName}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setQuickEdit(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            {type === 'COIN' ? (
              <View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Ouro (PO)</Text>
                  <TextInput style={styles.input} value={qeGP} onChangeText={(value) => setQeGP(sanitizeIntegerInput(value))} keyboardType="number-pad" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Prata (PP)</Text>
                  <TextInput style={styles.input} value={qeSP} onChangeText={(value) => setQeSP(sanitizeIntegerInput(value))} keyboardType="number-pad" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Bronze (PC)</Text>
                  <TextInput style={styles.input} value={qeCP} onChangeText={(value) => setQeCP(sanitizeIntegerInput(value))} keyboardType="number-pad" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
              </View>
            ) : (
              <View style={{ marginVertical: 10 }}>
                <Text style={styles.label}>{type === 'HP' ? 'Novo Valor de HP (Ex: 15)' : type === 'XP' ? 'Quantidade de XP para dar' : 'Valor do buff/dano (Ex: 5, -2)'}</Text>
                <TextInput
                  style={styles.input}
                  value={qeValue}
                  onChangeText={handleQuickEditValueChange}
                  keyboardType={(type === 'HP' || type === 'PV_TEMP') ? 'numeric' : 'number-pad'}
                  placeholder={(type === 'HP' || type === 'PV_TEMP') ? 'Ex: 5 ou -2' : 'Ex: 5'}
                  placeholderTextColor={appColors.placeholderLight}
                />
              </View>
            )}

            {isDamageQuickEdit && (
              <View style={styles.ruleRow}>
                <View style={styles.ruleTextBox}>
                  <Text style={styles.ruleTitle}>Dano direto</Text>
                  <Text style={styles.ruleDescription}>Valor negativo em HP/PV temporario sempre vira dano: consome PV temporario primeiro e depois HP real. Nao cria efeito temporario nem permanente.</Text>
                </View>
              </View>
            )}

            {showTempToggle && (
              <View style={styles.ruleRow}>
                <View style={styles.ruleTextBox}>
                  <Text style={styles.ruleTitle}>Efeito Temporário?</Text>
                  <Text style={styles.ruleDescription}>{qeIsTemp ? 'Desaparece com o tempo.' : 'Permanente (Fica até ser removido).'}</Text>
                </View>
                <Switch value={qeIsTemp} onValueChange={setQeIsTemp} trackColor={{ false: appColors.neutral, true: appColors.primary }} thumbColor={appColors.textPrimary} />
              </View>
            )}

            {showTempToggle && qeIsTemp && (
              <View style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Tempo</Text>
                  <TextInput style={styles.input} value={qeDuration} onChangeText={(value) => setQeDuration(sanitizeIntegerInput(value))} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Medida</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {EFFECT_UNITS.map(u => (
                      <TouchableOpacity key={u.value} style={[styles.filterChip, qeUnit === u.value && styles.filterChipActive]} onPress={() => setQeUnit(u.value)}>
                        <Text style={[styles.filterChipText, qeUnit === u.value && styles.filterChipTextActive]}>{u.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 16 }, (isEndingSession || isMasterActionPending(quickEditActionId)) && { opacity: 0.5 }]}
              disabled={isEndingSession || isMasterActionPending(quickEditActionId)}
              onPress={handleApplyQuickEdit}
            >
              <Text style={styles.primaryButtonText}>{isMasterActionPending(quickEditActionId) ? 'SALVANDO...' : 'SALVAR ALTERAÇÃO'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPlayerDetailsModal = () => {
    if (!detailPlayer) return null;

    const snapshot = detailPlayer.characterSnapshot || {};
    const saveIds = parseStringArray(snapshot.save_values).length
      ? parseStringArray(snapshot.save_values)
      : parseStringArray(snapshot.proficiencies).filter((id) => id.startsWith('save_'));
    const skillIds = parseStringArray(snapshot.skill_values).length
      ? parseStringArray(snapshot.skill_values)
      : parseStringArray(snapshot.proficiencies).filter((id) => id.startsWith('skill_'));
    const spellIds = parseStringArray(snapshot.spells);
    const bag = Array.isArray((detailPlayer.equipment as any)?.bag) ? (detailPlayer.equipment as any).bag : [];
    const equippedItems = getEquippedItemsForMaster(detailPlayer.equipment);

    return (
      <Modal visible={!!detailPlayer} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{detailPlayer.characterName}</Text>
                <Text style={styles.mutedText}>{detailPlayer.race} - {detailPlayer.className} - Nivel {detailPlayer.level}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetailPlayer(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
              <View style={styles.metricGrid}>
                {STAT_KEYS.map((stat) => (
                  <View key={stat} style={styles.metricBox}>
                    <Text style={styles.metricLabel}>{stat}</Text>
                    <Text style={styles.metricValue}>{getEffectiveStat(detailPlayer, stat)}</Text>
                    <Text style={styles.mutedText}>{getMasterStatSourceText(detailPlayer, stat)}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Recursos</Text>
                <Text style={styles.inventoryText}>
                  HP {detailPlayer.hpCurrent}/{detailPlayer.hpMax} - PV temp {detailPlayer.tempHp} - XP {detailPlayer.xp}
                </Text>
                <Text style={styles.inventoryText}>
                  Moedas: {detailPlayer.gp} PO, {detailPlayer.sp} PP, {detailPlayer.cp} PC
                </Text>
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Testes e pericias</Text>
                <Text style={styles.inventoryText}>Testes: {formatReferenceNames(saveIds, saveOptions) || 'Nenhum registrado.'}</Text>
                <Text style={styles.inventoryText}>Pericias: {formatReferenceNames(skillIds, skillOptions) || 'Nenhuma registrada.'}</Text>
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Habilidades e magias</Text>
                <Text style={styles.inventoryText}>{String(snapshot.features_traits || 'Nenhuma habilidade/historia mecanica registrada.')}</Text>
                {spellIds.length > 0 && (
                  <Text style={styles.inventoryText}>Magias: {formatReferenceNames(spellIds, spellOptions)}</Text>
                )}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Historia</Text>
                {['personality_traits', 'ideals', 'bonds', 'flaws', 'backstory', 'allies_organizations', 'languages'].map((field) => (
                  snapshot[field] ? (
                    <Text key={field} style={styles.inventoryText}>
                      {formatCharacterField(field)}: {String(snapshot[field])}
                    </Text>
                  ) : null
                ))}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Inventario</Text>
                {bag.length === 0 ? (
                  <Text style={styles.inventoryText}>Bolsa vazia.</Text>
                ) : bag.map((item: any, index: number) => (
                  <Text key={`${item?.name || 'item'}-${index}`} style={styles.inventoryText}>
                    {item.qty || 1}x {item.name || 'Item'}{describeInventoryItem(item) ? ` - ${describeInventoryItem(item)}` : ''}
                  </Text>
                ))}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Equipados</Text>
                {equippedItems.length === 0 ? (
                  <Text style={styles.inventoryText}>Nenhum equipamento sincronizado como equipado.</Text>
                ) : equippedItems.map((entry) => (
                  <View key={entry.slotKey} style={styles.effectRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.effectText}>{entry.slotLabel}: {entry.itemName}</Text>
                      {!!entry.metaText && <Text style={styles.inventoryText}>{entry.metaText}</Text>}
                      <Text style={styles.inventoryText}>{entry.effectText ? `Efeitos: ${entry.effectText}` : 'Sem efeitos mecânicos cadastrados.'}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {getVisibleMasterEffects(detailPlayer.effects).length > 0 && (
                <View style={styles.effectBox}>
                  <Text style={styles.strongText}>Efeitos ativos</Text>
                  {getVisibleMasterEffects(detailPlayer.effects).map((effect) => (
                    <Text key={effect.id} style={styles.effectText}>{summarizeEffect(effect)}</Text>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderCatalogModal = () => (
    <Modal visible={catalogModalVisible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalPanel}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Acervo da sessao</Text>
              <Text style={styles.mutedText}>{selectedCatalogKeys.length} itens customizados selecionados</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setCatalogModalVisible(false)}>
              <Ionicons name="close" size={22} color={appColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={catalogSearch}
            onChangeText={setCatalogSearch}
            placeholder="Buscar classe, raca, magia, item..."
            placeholderTextColor={appColors.placeholderLight}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRail}>
              {CATALOG_FILTERS.map((filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[styles.filterChip, catalogFilter === filter && styles.filterChipActive]}
                  onPress={() => setCatalogFilter(filter)}
                >
                  <Text style={[styles.filterChipText, catalogFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.toolbar}>
            <TouchableOpacity style={styles.smallButton} onPress={() => handleSetFilteredCatalog(true)}>
              <Ionicons name="checkmark" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Selecionar filtro</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={() => handleSetFilteredCatalog(false)}>
              <Ionicons name="remove" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Limpar filtro</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
            {filteredCatalogOptions.length === 0 ? (
              <Text style={styles.hint}>Nenhum item customizado encontrado neste filtro.</Text>
            ) : filteredCatalogOptions.map((option) => {
              const selected = selectedCatalogSet.has(option.key);
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.catalogRow, selected && styles.catalogRowActive]}
                  onPress={() => handleToggleCatalogOption(option.key)}
                >
                  <View style={[styles.catalogCheck, selected && styles.catalogCheckActive]}>
                    {selected && <Ionicons name="checkmark" size={15} color={appColors.primaryDark} />}
                  </View>
                  <View style={styles.catalogTextBox}>
                    <Text style={styles.catalogTag}>{option.group}</Text>
                    <Text style={styles.catalogName}>{option.name}</Text>
                    <Text style={styles.catalogMeta}>{option.detail}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.primaryButton} onPress={handleApplyCatalogSelection}>
            <Text style={styles.primaryButtonText}>{payload ? 'SINCRONIZAR ACERVO' : 'APLICAR ACERVO'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderInventoryModal = () => {
    if (!inventoryModalPlayer) return null;
    const equipment = inventoryModalPlayer.equipment as any;
    const bag = Array.isArray(equipment?.bag) ? equipment.bag : [];

    return (
      <Modal visible={!!inventoryModalPlayer} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Inventário Completo</Text>
                <Text style={styles.mutedText}>{inventoryModalPlayer.characterName}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setInventoryModalPlayer(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inventoryBox}>
              <Text style={styles.strongText}>Entregar item</Text>
              <TextInput
                style={styles.searchInput}
                value={inventorySearch}
                onChangeText={setInventorySearch}
                placeholder="Buscar por nome, dano, tipo, propriedade ou descricao..."
                placeholderTextColor={appColors.placeholderLight}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.filterRail}>
                  {INVENTORY_FILTERS.map((filter) => (
                    <TouchableOpacity
                      key={filter}
                      style={[styles.filterChip, inventoryFilter === filter && styles.filterChipActive]}
                      onPress={() => setInventoryFilter(filter)}
                    >
                      <Text style={[styles.filterChipText, inventoryFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.toolbar}>
                <TouchableOpacity style={styles.smallButton} onPress={() => setGrantItemQty(String(Math.max(1, (parseInt(grantItemQty, 10) || 1) - 1)))}>
                  <Ionicons name="remove" size={16} color={appColors.textPrimary} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, { width: 86, textAlign: 'center', marginBottom: 0 }]}
                  value={grantItemQty}
                  onChangeText={setGrantItemQty}
                  keyboardType="numeric"
                  placeholder="Qtd"
                  placeholderTextColor={appColors.placeholderLight}
                />
                <TouchableOpacity style={styles.smallButton} onPress={() => setGrantItemQty(String((parseInt(grantItemQty, 10) || 1) + 1))}>
                  <Ionicons name="add" size={16} color={appColors.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
                {filteredInventoryCatalog.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.catalogRow} onPress={() => handleGrantItemToPlayer(item)}>
                    <View style={styles.catalogTextBox}>
                      <Text style={styles.catalogTag}>{getInventoryItemCategory(item)}</Text>
                      <Text style={styles.catalogName}>{item.name}</Text>
                      <Text style={styles.catalogMeta}>{describeInventoryItem(item)}</Text>
                    </View>
                    <Ionicons name="add-circle" size={20} color={appColors.success} />
                  </TouchableOpacity>
                ))}
                {filteredInventoryCatalog.length === 0 && (
                  <Text style={styles.hint}>Nenhum item encontrado neste filtro.</Text>
                )}
              </ScrollView>
            </View>

            <ScrollView>
              {bag.length === 0 ? (
                <Text style={styles.hint}>O inventário está vazio.</Text>
              ) : (
                bag.map((item: any, index: number) => (
                  <View key={index} style={styles.catalogRow}>
                    <View style={styles.catalogTextBox}>
                      <Text style={styles.catalogName}>{item.qty || 1}x {item.name || 'Item'}</Text>
                      {(item.weight || item.type) && (
                        <Text style={styles.catalogMeta}>
                          {[item.type, item.weight ? `${item.weight} kg` : null].filter(Boolean).join(' - ')}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderSetup = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Criar sala</Text>

        <Text style={styles.label}>NOME DA SESSÃO</Text>
        <TextInput style={styles.input} value={sessionName} onChangeText={setSessionName} placeholder="Ex: A mina perdida" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NOME DO MESTRE</Text>
        <TextInput style={styles.input} value={masterName} onChangeText={setMasterName} placeholder="Mestre" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NÍVEL DA MESA</Text>
        <TextInput style={styles.input} value={level} onChangeText={setLevel} keyboardType="numeric" placeholder="1" placeholderTextColor={appColors.placeholderLight} />

        <View style={styles.ruleRow}>
          <View style={styles.ruleTextBox}>
            <Text style={styles.ruleTitle}>Permitir personagem existente</Text>
            <Text style={styles.ruleDescription}>Se desligado, os jogadores precisam criar uma ficha nova para esta sessão.</Text>
          </View>
          <Switch value={allowExisting} onValueChange={setAllowExisting} trackColor={{ false: appColors.neutral, true: appColors.primary }} thumbColor={appColors.textPrimary} />
        </View>

        <View style={styles.catalogSummaryBox}>
          <View style={styles.catalogSummaryRow}>
            <View style={styles.catalogSummaryTextBox}>
              <Text style={styles.catalogSummaryText}>Acervo preparado</Text>
              <Text style={styles.mutedText}>{selectedCatalogKeys.length} customizados serão sincronizados pelo QR.</Text>
            </View>
            <TouchableOpacity style={styles.smallButton} onPress={() => {
              traceButton('lan-session', 'OPEN_CATALOG_MODAL', { source: 'master_click' });
              setCatalogModalVisible(true);
            }}>
              <Ionicons name="albums" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleStartSession} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'INICIANDO...' : 'INICIAR SESSÃO LAN'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.joinSessionButton} onPress={() => {
          traceButton('lan-session', 'OPEN_SESSION_JOIN', { source: 'player_click' });
          router.replace('/sessionJoin' as any);
        }} disabled={loading}>
          <Ionicons name="qr-code" size={18} color={appColors.success} />
          <Text style={styles.joinSessionButtonText}>ENTRAR EM SESSÃO EXISTENTE</Text>
        </TouchableOpacity>
      </View>

      {savedSessions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sessoes salvas</Text>
          {savedSessions.map((session) => (
            <View key={session.id} style={styles.savedSessionRow}>
              <View style={styles.savedSessionContent}>
                <TouchableOpacity style={styles.savedSessionTextBox} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                  <Text style={styles.savedSessionTitle}>{session.name}</Text>
                  <Text style={styles.savedSessionMeta}>
                    {session.isMaster ? 'Mestre' : 'Jogador'} - Nivel {session.level} - Turno {session.currentTurn} - {session.playerCount} jogador(es)
                  </Text>
                </TouchableOpacity>
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                    <Ionicons name={session.isMaster ? 'play' : 'person'} size={16} color={appColors.success} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleDeleteSavedSession(session)} disabled={loading}>
                    <Ionicons name="trash" size={16} color={appColors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );

  const renderSessionControls = () => {
    if (!payload || !sessionState) return null;
    const paused = sessionState.status === 'paused';

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>{payload.session.name}</Text>
            <Text style={styles.mutedText}>Nível {payload.session.level} - Código {payload.session.inviteCode}</Text>
          </View>
          <View style={[styles.statusPill, paused && styles.statusPillPaused]}>
            <Text style={[styles.statusPillText, paused && styles.statusPillTextPaused]}>{paused ? 'Pausada' : 'Ativa'}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Turno</Text>
            <Text style={styles.metricValue}>{sessionState.currentTurn}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Tempo</Text>
            <Text style={styles.metricValue}>{formatElapsedTime(sessionState.elapsedMinutes)}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Jogadores</Text>
            <Text style={styles.metricValue}>{sessionState.players.length}</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleAdvanceTime('turn')}>
            <Ionicons name="play-forward" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Turno</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleAdvanceTime('minute')}>
            <Ionicons name="time" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Min</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleAdvanceTime('hour')}>
            <Ionicons name="hourglass" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Hora</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleAdvanceTime('shortRest')}>
            <Ionicons name="cafe" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Desc. curto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleAdvanceTime('longRest')}>
            <Ionicons name="moon" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Desc. longo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar código</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, paused ? styles.smallButtonSuccess : styles.smallButtonActive, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={handleTogglePause}>
            <Ionicons name={paused ? 'play' : 'pause'} size={15} color={paused ? appColors.success : appColors.primary} />
            <Text style={[styles.smallButtonText, paused ? styles.smallButtonTextSuccess : styles.smallButtonTextActive]}>{paused ? 'Continuar' : 'Pausar'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={handleStopSession}>
            <Ionicons name="stop" size={15} color={appColors.danger} />
            <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>{isEndingSession ? 'Encerrando' : 'Encerrar'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderQrCard = () => {
    if (!payload) return null;

    return (
      <View style={styles.card}>
        <View style={styles.qrHeader}>
          <View style={styles.qrHeaderTextBox}>
            <Text style={styles.sectionTitle}>Entrada por QR</Text>
            <Text style={styles.mutedText}>O QR serve para entrar ou voltar para a sessão pausada.</Text>
          </View>
          <View style={styles.qrIconBox}>
            <Ionicons name="qr-code" size={22} color={appColors.primary} />
          </View>
        </View>

        <QrCodeView value={joinLink} />

        {!joinUrl && (
          <Text style={styles.warningText}>
            Socket TCP indisponível neste ambiente. Use um dev build/native build; o Expo Go não consegue hospedar TCP local.
          </Text>
        )}

        <View style={styles.linkBox}>
          <Text style={styles.linkText}>{joinLink}</Text>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar código</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyJoinInvite}>
            <Ionicons name="link" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar convite</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };


  const loadMoreSessionHistory = useCallback(async () => {
    const activeSessionId = payload?.session?.id;
    if (!activeSessionId || sessionHistoryLoading) return;

    const nextLimit = Math.min(sessionHistoryLimit + SESSION_HISTORY_PAGE_SIZE, SESSION_HISTORY_MAX_IN_MEMORY);
    if (nextLimit <= sessionHistoryLimit) {
      setSessionHistoryHasMore(false);
      return;
    }

    setSessionHistoryLoading(true);
    try {
      const events = await getLanSessionEvents(db, activeSessionId, nextLimit);
      setSessionEvents(events);
      setSessionHistoryLimit(nextLimit);
      setSessionHistoryHasMore(events.length >= nextLimit && nextLimit < SESSION_HISTORY_MAX_IN_MEMORY);
      debugLanFlow('MASTER_SESSION_HISTORY_PAGE_LOADED', {
        sessionId: activeSessionId,
        loaded: events.length,
        limit: nextLimit,
        maxInMemory: SESSION_HISTORY_MAX_IN_MEMORY,
      });
    } catch (error) {
      traceError('LAN_JOIN', 'MASTER_SESSION_HISTORY_PAGE_LOAD_ERROR', error, {
        screen: 'lan-session',
        source: 'loadMoreSessionHistory',
        sessionId: activeSessionId,
      });
    } finally {
      setSessionHistoryLoading(false);
    }
  }, [db, payload?.session?.id, sessionHistoryLimit, sessionHistoryLoading]);

  const renderCatalogCard = () => {
    if (!payload) return null;

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>Acervo sincronizado</Text>
            <Text style={styles.mutedText}>{selectedCatalogKeys.length} customizados liberados para jogadores.</Text>
          </View>
          <TouchableOpacity style={styles.smallButton} onPress={() => setCatalogModalVisible(true)}>
            <Ionicons name="refresh" size={16} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Editar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderTimelineCard = () => {
    const visibleEvents = sessionEvents.filter(shouldShowSessionEventInMasterTimeline);
    if (!payload) return null;
    const canLoadMoreHistory = sessionHistoryHasMore && sessionHistoryLimit < SESSION_HISTORY_MAX_IN_MEMORY;

    const renderTimelineEvent = ({ item: event }: { item: LanSessionEvent }) => (
      <View style={styles.sessionEventRow}>
        <Ionicons
          name={event.type === 'effect_expired' ? 'hourglass' : event.type === 'player_joined' ? 'person-add' : 'sparkles'}
          size={16}
          color={event.type === 'effect_expired' ? appColors.warning : appColors.success}
        />
        <Text style={styles.sessionEventText}>{formatSessionEvent(event)}</Text>

        {event.type === 'spell_effect' && event.fromKey !== 'master' && reviewedSpellEventIds.includes('__spell_review_disabled__') && !reviewedSpellEventIds.includes(event.id) && (
          <View style={styles.savedSessionActions}>
            <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleAcceptSpellEffect(event, true)}>
              <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>OK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleAcceptSpellEffect(event, false)}>
              <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Não</Text>
            </TouchableOpacity>
          </View>
        )}

        {event.type === 'resource_request' && event.fromKey !== 'master' && !reviewedRequestEventSet.has(event.id) && (
          <View style={styles.savedSessionActions}>
            <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleReviewResourceRequest(event, true)}>
              <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Aceitar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleReviewResourceRequest(event, false)}>
              <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Recusar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Histórico da sessão</Text>
            <Text style={styles.mutedText}>
              Mostrando {visibleEvents.length} evento(s) de jogo carregado(s). O histórico completo fica salvo no SQLite.
            </Text>
          </View>
          <Ionicons name="list" size={22} color={appColors.primary} />
        </View>

        {visibleEvents.length === 0 ? (
          <Text style={styles.hint}>Nenhum registro da campanha nesta sessão ainda.</Text>
        ) : (
          <FlatList
            data={visibleEvents}
            keyExtractor={(event, index) => event.id || `${event.type}-${index}`}
            renderItem={renderTimelineEvent}
            style={{ maxHeight: 250 }}
            nestedScrollEnabled={true}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
            removeClippedSubviews={true}
            showsVerticalScrollIndicator={true}
          />
        )}

        <View style={styles.toolbar}>
          <TouchableOpacity
            style={[styles.smallButton, (!canLoadMoreHistory || sessionHistoryLoading) && { opacity: 0.5 }]}
            onPress={loadMoreSessionHistory}
            disabled={!canLoadMoreHistory || sessionHistoryLoading}
          >
            <Ionicons name="chevron-down" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>{sessionHistoryLoading ? 'Carregando...' : 'Carregar mais'}</Text>
          </TouchableOpacity>
          <Text style={styles.mutedText}>Limite visual: {SESSION_HISTORY_MAX_IN_MEMORY}</Text>
        </View>
      </View>
    );
  };

  const renderPlayers = () => {
    if (!sessionState) return null;

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>Painel dos jogadores</Text>
            <Text style={styles.mutedText}>HP, XP, moedas, inventário, status e efeitos ativos.</Text>
          </View>
          <Ionicons name="people" size={24} color={appColors.primary} />
        </View>

        {sessionState.players.length === 0 ? (
          <Text style={styles.hint}>Nenhum jogador notificou entrada ainda.</Text>
        ) : sessionState.players.map(renderPlayerCard)}

        {renderMasterEffectsModal(effectListModalPlayer, () => setEffectListModalPlayer(null))}

        {pendingSaves.length > 0 && (
          <View style={styles.effectForm}>
            <Text style={styles.strongText}>Testes pendentes</Text>
            {pendingSaves.map((save) => {
              const player = sessionState.players.find((entry) => entry.remoteKey === save.targetKey);
              return (
                <View key={save.id} style={styles.catalogRow}>
                  <View style={styles.catalogTextBox}>
                    <Text style={styles.catalogName}>{player?.characterName || save.targetKey}</Text>
                    <Text style={styles.catalogMeta}>
                      {save.sourceName || 'Efeito'} - {save.ability}{save.dc ? ` CD ${save.dc}` : ' CD manual'}
                    </Text>
                  </View>
                  <View style={styles.savedSessionActions}>
                    <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleResolvePendingSave(save, true)}>
                      <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Passou</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleResolvePendingSave(save, false)}>
                      <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Falhou</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {sessionState.players.length > 0 && (
          <View style={styles.effectForm}>
            <Text style={styles.strongText}>Distribuir XP para a party</Text>
            <View style={styles.effectInputRow}>
              <TextInput
                style={styles.effectInput}
                value={xpPool}
                onChangeText={setXpPool}
                keyboardType="numeric"
                placeholder="1000"
                placeholderTextColor={appColors.placeholderLight}
              />
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={handleDistributeXp}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Distribuir</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {sessionState.players.length > 0 && renderEffectForm()}
      </View>
    );
  };


  const renderMasterEffectsModal = (player: LanSessionPlayerState | null, onClose: () => void) => {
    const effects = getVisibleMasterEffects(player?.effects || []);
    return (
      <Modal visible={Boolean(player)} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <View style={styles.publicEffectModalOverlay}>
          <TouchableOpacity style={styles.publicEffectBackdrop} activeOpacity={1} onPress={onClose} />
          <View style={styles.publicEffectModalPanel}>
            <View style={styles.publicEffectModalHeader}>
              <View style={styles.publicEffectModalIcon}>
                <Ionicons name="sparkles" size={18} color={appColors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.publicEffectModalTitle} numberOfLines={1}>Efeitos de {player?.characterName || 'jogador'}</Text>
                <Text style={styles.publicEffectModalSubtitle}>{effects.length} efeito(s) ativo(s) visível(is)</Text>
              </View>
              <TouchableOpacity style={styles.publicEffectModalClose} onPress={onClose}>
                <Ionicons name="close" size={20} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.publicEffectModalList} contentContainerStyle={{ paddingBottom: 6 }} nestedScrollEnabled>
              {effects.length === 0 ? (
                <Text style={styles.publicEffectModalEmpty}>Nenhum efeito ativo.</Text>
              ) : effects.map((effect: any, index) => (
                <View key={`${effect.id || effect.name || 'effect'}:${index}`} style={styles.publicEffectModalRow}>
                  <View style={[styles.publicEffectDot, effect.color ? { backgroundColor: effect.color } : null]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.publicEffectModalName} numberOfLines={1}>{getEffectDisplayName(effect)}</Text>
                    <Text style={styles.publicEffectModalMeta}>{summarizeEffect(effect)}</Text>
                  </View>
                  {player && (
                    <TouchableOpacity style={styles.publicEffectTrashButton} onPress={() => handleRemoveEffect(player.id, String(effect.id))}>
                      <Ionicons name="trash" size={15} color={appColors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPlayerCard = (player: LanSessionPlayerState) => {
    const selected = selectedPlayer?.id === player.id;
    const expanded = expandedPlayerIds.includes(player.id);
    const hpPercent = player.hpMax > 0 ? Math.max(0, Math.min(100, (player.hpCurrent / player.hpMax) * 100)) : 0;
    const bagPreview = getBagPreview(player.equipment);
    const equippedItems = getEquippedItemsForMaster(player.equipment);
    const visibleEffects = getVisibleMasterEffects(player.effects);
    const effectSummary = formatMasterEffectSummary(visibleEffects, 2);
    const armorClass = calculateHostArmorClass(player);

    return (
      <TouchableOpacity
        key={player.id}
        style={[styles.playerCard, selected && styles.playerCardActive]}
        onPress={() => setSelectedPlayerId(player.id)}
      >
        <View style={styles.playerHeader}>
          <TouchableOpacity
            style={styles.playerTitleBox}
            activeOpacity={effectSummary.hasMore ? 0.75 : 1}
            onPress={() => {
              setSelectedPlayerId(player.id);
              if (effectSummary.hasMore) setEffectListModalPlayer(player);
            }}
          >
            <Text style={styles.playerName} numberOfLines={1}>{player.characterName}</Text>
            <Text style={styles.playerMeta} numberOfLines={1}>{player.race} - {player.className} - Nível {player.level}</Text>
            <Text style={styles.mutedText} numberOfLines={1}>
              HP {player.hpCurrent}/{player.hpMax}{player.tempHp > 0 ? ` +${player.tempHp}` : ''} - CA {armorClass} - XP {player.xp} - {player.gp} PO
            </Text>
            {effectSummary.total > 0 && (
              <Text style={[styles.inventoryText, { color: appColors.success }]} numberOfLines={1} ellipsizeMode="tail">
                {effectSummary.text}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.statusPill} onPress={() => toggleExpandedPlayer(player.id)}>
            <Text style={styles.statusPillText}>{expanded ? 'Menos' : 'Mais info'}</Text>
          </TouchableOpacity>
        </View>

        {player.pendingCharacter && (
          <View style={styles.effectBox}>
            <Text style={styles.strongText}>Atualização pendente</Text>
            <Text style={styles.inventoryText}>
              {player.pendingDiff?.length ? player.pendingDiff.join(' | ') : 'A ficha local do jogador mudou desde o ultimo estado da sessao.'}
            </Text>
            <View style={styles.toolbar}>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleReviewPending(player, true)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Aceitar ficha</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleReviewPending(player, false)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Manter sessao</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.hpTrack}>
          <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => handleApplyDamageToPlayer(player, 1)}>
            <Text style={styles.smallButtonText}>Dano -1</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]}
            disabled={isEndingSession}
            onPress={() => runMasterAction(
              `heal:${player.id}`,
              () => handleUpdatePlayerDelta(player, 'hpCurrent', 1, `Mestre curou 1 HP de ${player.characterName}.`),
              { mode: 'queue', queueDelayMs: MASTER_REPEATABLE_ACTION_QUEUE_DELAY_MS }
            )}
          >
            <Text style={styles.smallButtonText}>Cura +1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, isEndingSession && { opacity: 0.5 }]} disabled={isEndingSession} onPress={() => openQuickEdit(player, 'PV_TEMP')}>
            <Text style={styles.smallButtonText}>+ PV Temp</Text>
          </TouchableOpacity>
        </View>

        {expanded && (
          <>
            <View style={styles.metricGrid}>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'HP')}>
                <Text style={styles.metricLabel}>HP</Text>
                <Text style={styles.metricValue}>{player.hpCurrent}/{player.hpMax}{player.tempHp > 0 ? ` +${player.tempHp}` : ''}</Text>
                {player.tempHp > 0 && <Text style={styles.mutedText}>PV temporario ativo</Text>}
              </TouchableOpacity>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>CA</Text>
                <Text style={styles.metricValue}>{armorClass}</Text>
              </View>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'XP')}>
                <Text style={styles.metricLabel}>XP</Text>
                <Text style={styles.metricValue}>{player.xp}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'COIN')}>
                <Text style={styles.metricLabel}>Moedas</Text>
                <Text style={styles.metricValue}>{player.gp} PO</Text>
                <Text style={styles.mutedText}>{player.sp} PP - {player.cp} PC</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.smallButton} onPress={() => setDetailPlayer(player)}>
                <Ionicons name="document-text" size={14} color={appColors.primary} />
                <Text style={styles.smallButtonText}>Ver ficha</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger, { marginLeft: 'auto' }]} onPress={() => handleKickPlayer(player)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Kick / Expulsar</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statGrid}>
              {STAT_KEYS.map((stat) => (
                <TouchableOpacity 
                  key={stat} 
                  style={styles.statPill}
                  onPress={() => openQuickEdit(player, 'STAT', stat)}
                >
                  <Text style={styles.statLabel}>{stat}</Text>
                  <Text style={styles.statValue}>{getEffectiveStat(player, stat)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inventoryBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.strongText}>Inventário</Text>
                <TouchableOpacity onPress={() => setInventoryModalPlayer(player)}>
                  <Text style={{ color: appColors.primary, fontSize: 12, fontWeight: 'bold' }}>Ver tudo</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.inventoryText}>{bagPreview || 'Bolsa vazia ou não sincronizada.'}</Text>
            </View>

            <View style={styles.inventoryBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.strongText}>Equipados</Text>
                <Text style={styles.mutedText}>{equippedItems.length} slot(s)</Text>
              </View>
              {equippedItems.length === 0 ? (
                <Text style={styles.inventoryText}>Nenhum equipamento sincronizado como equipado.</Text>
              ) : equippedItems.map((entry) => (
                <View key={entry.slotKey} style={styles.effectRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.effectText}>{entry.slotLabel}: {entry.itemName}</Text>
                    {!!entry.metaText && <Text style={styles.inventoryText}>{entry.metaText}</Text>}
                    <Text style={styles.inventoryText}>
                      {entry.effectText ? `Efeitos: ${entry.effectText}` : 'Sem efeitos mecânicos cadastrados.'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {visibleEffects.length > 0 && (
              <View style={styles.effectBox}>
                <Text style={styles.strongText}>Efeitos ativos</Text>
                {visibleEffects.map((effect) => (
                  <View key={effect.id} style={styles.effectRow}>
                    <Text style={styles.effectText}>{summarizeEffect(effect)}</Text>
                    <TouchableOpacity style={styles.smallButton} onPress={() => handleRemoveEffect(player.id, String(effect.id))}>
                      <Ionicons name="trash" size={14} color={appColors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderEffectForm = () => (
    <View style={styles.effectForm}>
      <Text style={styles.strongText}>Aplicar efeito</Text>
      
      {/* NOVO: Seleção do Alvo da Magia/Efeito */}
      <Text style={[styles.mutedText, { marginTop: 8 }]}>Alvo do efeito:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity 
          style={[styles.filterChip, effectTargetPlayerId === 'ALL' && styles.filterChipActive]} 
          onPress={() => setEffectTargetPlayerId('ALL')}
        >
          <Text style={[styles.filterChipText, effectTargetPlayerId === 'ALL' && styles.filterChipTextActive]}>Toda a Party</Text>
        </TouchableOpacity>
        {sessionState?.players.map((p) => (
          <TouchableOpacity 
            key={p.id}
            style={[styles.filterChip, effectTargetPlayerId === p.id && styles.filterChipActive]} 
            onPress={() => setEffectTargetPlayerId(p.id)}
          >
            <Text style={[styles.filterChipText, effectTargetPlayerId === p.id && styles.filterChipTextActive]}>{p.characterName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TextInput
        style={styles.effectInput}
        value={effectSearch}
        onChangeText={setEffectSearch}
        placeholder="Buscar magia, item, pocao, aura..."
        placeholderTextColor={appColors.placeholderLight}
      />

      {selectedEffectOptions.length > 0 && (
        <View style={styles.inventoryBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.strongText}>{selectedEffectOptions.length} efeito(s) selecionado(s)</Text>
            <TouchableOpacity onPress={clearSelectedEffects}>
              <Text style={{ color: appColors.danger, fontSize: 12, fontWeight: 'bold' }}>Limpar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.inventoryText} numberOfLines={1} ellipsizeMode="tail">
            {formatSelectedEffectOptionsSummary(selectedEffectOptions, 2)}
          </Text>
        </View>
      )}

      <ScrollView 
        style={{ maxHeight: 190 }} 
        nestedScrollEnabled={true} 
        keyboardShouldPersistTaps="handled"
      >
        {filteredEffectOptions.map((option) => {
          const selected = selectedEffectSet.has(option.key);
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.catalogRow, selected && styles.catalogRowActive]}
              onPress={() => handleSelectEffectOption(option)}
            >
              <View style={[styles.catalogCheck, selected && styles.catalogCheckActive]}>
                {selected && <Ionicons name="checkmark" size={15} color={appColors.primaryDark} />}
              </View>
              <View style={styles.catalogTextBox}>
                <Text style={styles.catalogTag}>{option.group}</Text>
                <Text style={styles.catalogName}>{option.name}</Text>
                <Text style={styles.catalogMeta}>{option.detail || 'Sem detalhe cadastrado'}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.inventoryBox}>
        <Text style={styles.strongText}>{selectedEffectOptions.length > 0 ? 'Aplicacao em lote' : effectName}</Text>
        <Text style={styles.inventoryText}>Fonte: {effectSource || 'base'} - ajuste alvo, valor e duração antes de aplicar.</Text>
        {selectedEffectOptions.length > 0 ? (
          <Text style={styles.inventoryText}>Busca filtra; clique em varios itens para selecionar ou remover da selecao.</Text>
        ) : effectSaveInfo ? <Text style={styles.inventoryText}>{effectSaveInfo}</Text> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true}>
        <View style={styles.filterRail}>
          {EFFECT_TARGETS.map((target) => (
            <TouchableOpacity
              key={target}
              style={[styles.filterChip, effectTarget === target && styles.filterChipActive]}
              onPress={() => setEffectTarget(target)}
            >
              <Text style={[styles.filterChipText, effectTarget === target && styles.filterChipTextActive]}>{target}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(effectTarget) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
          <View style={styles.filterRail}>
            {(['add', 'set'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.filterChip, effectMode === mode && styles.filterChipActive]}
                onPress={() => setEffectMode(mode)}
              >
                <Text style={[styles.filterChipText, effectMode === mode && styles.filterChipTextActive]}>{mode === 'set' ? 'Definir valor' : 'Somar bonus'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      <View style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mutedText, { marginBottom: 4, fontSize: 12 }]}>Valor (Ex: 2, -1, 1d8+2)</Text>
          <TextInput
            style={styles.effectInput}
            value={effectValue}
            onChangeText={setEffectValue}
            keyboardType="default"
            placeholder="+2 ou 1d8"
            placeholderTextColor={appColors.placeholderLight}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mutedText, { marginBottom: 4, fontSize: 12 }]}>Tempo</Text>
          <TextInput
            style={styles.effectInput}
            value={effectDuration}
            onChangeText={setEffectDuration}
            keyboardType="numeric"
            placeholder="3"
            placeholderTextColor={appColors.placeholderLight}
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
        <View style={styles.filterRail}>
          {EFFECT_UNITS.map((unit) => (
            <TouchableOpacity
              key={unit.value}
              style={[styles.filterChip, effectUnit === unit.value && styles.filterChipActive]}
              onPress={() => setEffectUnit(unit.value)}
            >
              <Text style={[styles.filterChipText, effectUnit === unit.value && styles.filterChipTextActive]}>{unit.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.primaryButton, styles.fullWidthButton, (isEndingSession || isMasterActionPending('apply_effect')) && { opacity: 0.5 }]}
        disabled={isEndingSession || isMasterActionPending('apply_effect')}
        onPress={handleApplyEffect}
      >
        <Text style={styles.primaryButtonText}>{isMasterActionPending('apply_effect') ? 'APLICANDO...' : 'APLICAR EFEITO'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => {
          traceButton('lan-session', 'LAN_SESSION_BACK', { sessionId: activeSessionId });
          router.replace('/' as any);
        }}>
          <Ionicons name="arrow-back" size={28} color={appColors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Sessão LAN</Text>
          <Text style={styles.topBarSub}>Mestre ou jogador</Text>
        </View>
        <TouchableOpacity onPress={() => {
          traceButton('lan-session', 'OPEN_DEBUG_TRACE', { sessionId: activeSessionId });
          router.push('/debug-trace' as any);
        }}>
          <Text style={{ color: appColors.warning, fontWeight: 'bold' }}>Trace</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!payload ? (
          renderSetup()
        ) : (
          <>
            {renderSessionControls()}
            {renderPlayers()}
            {renderTimelineCard()}
            {renderCatalogCard()}
            {renderQrCard()}
          </>
        )}
      </ScrollView>

      {/* MODAIS AQUI - Eles precisam estar renderizados no topo da árvore */}
      {renderCatalogModal()}
      {renderInventoryModal()}
      {renderPlayerDetailsModal()}
      {renderQuickEditModal()}

      <Modal visible={masterDiceValuePrompt.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{masterDiceValuePrompt.title}</Text>
                <Text style={styles.mutedText}>{masterDiceValuePrompt.message}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => completeMasterDiceValuePrompt(null)}>
                <Ionicons name="close" size={20} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.effectInput}
              value={masterDiceValuePrompt.manualValue}
              onChangeText={(manualValue) => setMasterDiceValuePrompt((current) => ({ ...current, manualValue }))}
              keyboardType="numeric"
              placeholder="Valor final"
              placeholderTextColor={appColors.placeholderLight}
            />
            <View style={styles.toolbar}>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => completeMasterDiceValuePrompt(null)}>
                <Ionicons name="close-circle" size={15} color={appColors.danger} />
                <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallButton, parseInt(masterDiceValuePrompt.manualValue, 10) > 0 ? styles.smallButtonSuccess : { opacity: 0.5 }]}
                disabled={!(parseInt(masterDiceValuePrompt.manualValue, 10) > 0)}
                onPress={submitManualMasterDiceValuePrompt}
              >
                <Ionicons name="checkmark-circle" size={15} color={appColors.success} />
                <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Usar valor</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonActive]} onPress={rollMasterDiceValuePromptVirtually}>
                <Ionicons name="dice" size={15} color={appColors.primary} />
                <Text style={[styles.smallButtonText, styles.smallButtonTextActive]}>Dado virtual</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      {payload && <DiceRoller3D rollRequest={masterDiceRollRequest} onRollComplete={handleMasterDiceRollComplete} />}
    </LinearGradient>
  );
}

// === FUNÇÕES UTILITÁRIAS ===

type LanPlayerEffectForUi = {
  id?: string;
  target?: string;
  value?: number | string | null;
  unit?: string | null;
  isPermanent?: boolean;
  kind?: string | null;
  [key: string]: unknown;
};


function getEffectDisplayName(effect: any): string {
  const raw = String(effect?.name || effect?.status || effect?.statusKey || 'Efeito').trim();
  return raw || 'Efeito';
}

function formatMasterEffectSummary(effects: unknown[] | undefined, limit = 2) {
  const list = Array.isArray(effects) ? effects : [];
  const names = list
    .map((effect) => getEffectDisplayName(effect))
    .filter(Boolean);
  const shown = names.slice(0, Math.max(1, limit));
  const hidden = Math.max(0, names.length - shown.length);
  return {
    total: names.length,
    hasMore: hidden > 0,
    text: hidden > 0 ? `${shown.join(', ')}...` : shown.join(', '),
  };
}

function formatSelectedEffectOptionsSummary(options: EffectOption[] = [], limit = 2) {
  const names = options.map((option) => String(option?.name || '').trim()).filter(Boolean);
  const shown = names.slice(0, Math.max(1, limit));
  return names.length > shown.length ? `${shown.join(', ')}...` : shown.join(', ');
}

function isMasterEffectStillActive(effect: any) {
  if (!effect || effect.active === false) return false;
  const unit = String(effect.unit || '').toLowerCase();
  if (effect.isPermanent === true || unit === 'permanent' || unit === 'manual' || unit === 'while_equipped' || unit === 'concentration') return true;
  return Math.max(0, Math.floor(Number(effect.remaining || 0) || 0)) > 0;
}

function getVisibleMasterEffects<T extends { target?: unknown; unit?: unknown; isPermanent?: unknown; kind?: unknown; active?: unknown; remaining?: unknown }>(effects: T[] = []): T[] {
  return effects.filter((effect) => {
    if (!isMasterEffectStillActive(effect)) return false;
    const target = String(effect.target || '').toUpperCase();
    const permanent = Boolean(effect.isPermanent || String(effect.unit || '').toLowerCase() === 'permanent');
    return !(permanent && PERMANENT_STAT_TARGETS.includes(target as any) && effect.kind !== 'hp' && effect.kind !== 'temp_hp');
  });
}

function getMasterStatBreakdown(player: LanSessionPlayerState, stat: string) {
  const normalized = String(stat || '').toUpperCase();
  const stats = player.stats && typeof player.stats === 'object' ? player.stats : {};
  const baseValue = Number(stats?.[normalized]) || 0;
  const tempMods = stats.temp_mods && typeof stats.temp_mods === 'object' ? stats.temp_mods as Record<string, unknown> : {};
  const equipMods = stats.equip_mods && typeof stats.equip_mods === 'object' ? stats.equip_mods as Record<string, unknown> : {};
  const tempValue = Number(tempMods?.[normalized]) || 0;
  const equipValue = Number(equipMods?.[normalized]) || 0;

  const effects: LanPlayerEffectForUi[] = Array.isArray(player.effects)
    ? (player.effects as LanPlayerEffectForUi[])
    : [];

  const effectValue = effects
    .filter((effect: LanPlayerEffectForUi) => {
      if (!isMasterEffectStillActive(effect)) return false;
      return String(effect.target || '').toUpperCase() === normalized;
    })
    .reduce<number>((total: number, effect: LanPlayerEffectForUi) => {
      return total + (Number(effect.value) || 0);
    }, 0);

  const totalBonus = tempValue + equipValue + effectValue;
  return {
    baseValue,
    tempValue,
    equipValue,
    effectValue,
    totalBonus,
    total: baseValue + totalBonus,
  };
}

function getEffectiveStat(player: LanSessionPlayerState, stat: string) {
  const breakdown = getMasterStatBreakdown(player, stat);
  return breakdown.totalBonus === 0
    ? String(breakdown.total)
    : `${breakdown.total} (${breakdown.totalBonus > 0 ? '+' : ''}${breakdown.totalBonus})`;
}

function buildMasterEffectiveStats(player: LanSessionPlayerState) {
  const result: Record<string, number> = {};
  for (const stat of STAT_KEYS) {
    result[stat] = getMasterStatBreakdown(player, stat).total;
  }
  result.CA = calculateHostArmorClass(player);
  return result;
}

function getMasterStatSourceText(player: LanSessionPlayerState, stat: string) {
  const breakdown = getMasterStatBreakdown(player, stat);
  const parts: string[] = [];
  if (breakdown.equipValue) parts.push(`equip ${breakdown.equipValue > 0 ? '+' : ''}${breakdown.equipValue}`);
  if (breakdown.tempValue) parts.push(`temp ${breakdown.tempValue > 0 ? '+' : ''}${breakdown.tempValue}`);
  if (breakdown.effectValue) parts.push(`efeito ${breakdown.effectValue > 0 ? '+' : ''}${breakdown.effectValue}`);
  if (!parts.length) return `base ${breakdown.baseValue}`;
  return `base ${breakdown.baseValue} | ${parts.join(' | ')}`;
}

function getBagPreview(equipment: Record<string, unknown>) {
  const bag = Array.isArray((equipment as any).bag) ? (equipment as any).bag : [];
  return bag
    .slice(0, 5)
    .map((item: any) => `${item.qty || 1}x ${item.name || 'Item'}`)
    .join(', ');
}

const MASTER_SLOT_LABELS: Record<string, string> = {
  weapon: 'Arma',
  mainHand: 'Mão principal',
  offHand: 'Mão secundária',
  shield: 'Escudo',
  armor: 'Armadura',
  helmet: 'Elmo',
  cloak: 'Capa',
  amulet: 'Amuleto',
  ring: 'Anel',
  boots: 'Botas',
  gloves: 'Luvas',
};

type MasterEquippedItemSummary = {
  slotKey: string;
  slotLabel: string;
  itemName: string;
  metaText: string;
  effectText: string;
};

function getEquippedItemsForMaster(equipment: Record<string, unknown>): MasterEquippedItemSummary[] {
  const normalized = normalizeHostEquipment(equipment);
  const slots = normalized.slots && typeof normalized.slots === 'object' ? normalized.slots : {};

  return Object.entries(slots)
    .map(([slotKey, rawItem]) => {
      const item = normalizeEquippedItem(rawItem);
      if (!item) return null;
      const itemName = String(item.name || item.nome || item.label || '').trim();
      if (!itemName) return null;
      return {
        slotKey,
        slotLabel: MASTER_SLOT_LABELS[slotKey] || formatMasterSlotLabel(slotKey),
        itemName,
        metaText: describeInventoryItem(item),
        effectText: summarizeInventoryItemEffects(item),
      };
    })
    .filter(Boolean) as MasterEquippedItemSummary[];
}

function normalizeEquippedItem(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as Record<string, any>;
  return null;
}

function formatMasterSlotLabel(slotKey: string) {
  return String(slotKey || 'slot')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarizeInventoryItemEffects(item: Record<string, unknown>) {
  const effects = [
    ...parseOptionEffects(item.effect_json),
    ...(Array.isArray((item as any).effects) ? (item as any).effects.map(normalizeCatalogEffect) : []),
  ];

  const unique = new Set<string>();
  const parts = effects
    .map(formatInventoryItemEffect)
    .filter((part) => {
      if (!part || unique.has(part)) return false;
      unique.add(part);
      return true;
    });

  return parts.join('; ');
}

function formatInventoryItemEffect(effect: Record<string, any>) {
  const target = String(effect.target || effect.stat || '').toUpperCase();
  const value = Number(effect.value ?? effect.amount ?? 0) || 0;
  const conditionName = String(effect.conditionName || effect.name || effect.status || effect.statusKey || '').trim();
  const saveInfo = formatEffectSaveInfo(effect);

  let base = '';
  if (target === 'PV_TEMP') base = `PV temp ${value > 0 ? '+' : ''}${value}`;
  else if (target === 'HP') base = `HP ${value > 0 ? '+' : ''}${value}`;
  else if (target && target !== 'CUSTOM' && target !== 'UNDEFINED') base = `${target} ${value > 0 ? '+' : ''}${value}`;
  else if (conditionName) base = conditionName;

  if (!base && saveInfo) base = saveInfo;
  else if (base && saveInfo) base = `${base} (${saveInfo})`;

  return base.trim();
}

function formatLanDurationText(remaining: number, unit: string, isPermanent = false) {
  if (isPermanent || unit === 'permanent') return 'Permanente';
  if (unit === 'manual') return 'Manual';
  if (unit === 'while_equipped') return 'Enquanto equipado';
  if (unit === 'concentration') return 'Concentração';
  const safeRemaining = Math.max(1, Math.floor(Number(remaining) || 1));
  const labels: Record<string, [string, string]> = {
    turn: ['turno', 'turnos'],
    round: ['rodada', 'rodadas'],
    minute: ['minuto', 'minutos'],
    hour: ['hora', 'horas'],
    day: ['dia', 'dias'],
    rest: ['descanso', 'descansos'],
    short_rest: ['descanso curto', 'descansos curtos'],
    long_rest: ['descanso longo', 'descansos longos'],
  };
  const [singular, plural] = labels[unit] || [unit, unit];
  return `${safeRemaining} ${safeRemaining === 1 ? singular : plural}`;
}

function makeEffectDraftFromOption(option: EffectOption): EffectDraft {
  const firstEffect = option.effects[0] || {};
  const save: Record<string, any> = firstEffect.save && typeof firstEffect.save === 'object'
    ? firstEffect.save
    : firstEffect.savingThrow && typeof firstEffect.savingThrow === 'object'
      ? firstEffect.savingThrow
      : firstEffect.saving_throw && typeof firstEffect.saving_throw === 'object'
        ? firstEffect.saving_throw
        : {};
  const target = normalizeEffectTarget(firstEffect.target || firstEffect.stat || firstEffect.type);
  const isConditionOption = option.group === 'Condicao' || Boolean(option.statusKey || firstEffect.statusKey || firstEffect.status);
  const duration = isConditionOption
    ? { value: 0, remaining: 0, unit: 'manual', isPermanent: false }
    : createEffectDurationPayload({
        value: option.durationValue ?? firstEffect.durationValue ?? firstEffect.duration ?? 1,
        unit: option.durationUnit || firstEffect.durationUnit || firstEffect.unit || inferUnitFromText(option.durationText),
      });
  const remaining = duration.remaining;
  const unit = duration.unit as LanEffectUnit;
  const kind = target === 'PV_TEMP'
    ? 'temp_hp'
    : target === 'HP'
      ? 'hp'
      : target === 'custom'
        ? 'status'
        : 'stat';
  const rawSaveAbility = firstEffect.saveAbility ?? save.ability ?? save.saveAbility ?? firstEffect.ability ?? firstEffect.savingThrowAbility ?? firstEffect.saving_throw_ability;
  const rawSaveDc = firstEffect.saveDc ?? save.dc ?? save.dcFixed ?? save.saveDc ?? firstEffect.dc ?? firstEffect.save_dc;
  const saveDc = Number(rawSaveDc || 0) || undefined;
  const saveAbility = String(rawSaveAbility || '').trim().toUpperCase() || undefined;

  return {
    name: String(firstEffect.conditionName || option.name || 'Efeito'),
    target,
    value: Number(firstEffect.value ?? firstEffect.val ?? firstEffect.amount ?? 0) || 0,
    remaining,
    unit,
    durationText: isConditionOption ? 'Manual' : (option.durationText || `${remaining} ${unit}`),
    kind,
    mode: firstEffect.mode === 'set' ? 'set' : 'add',
    source: option.group,
    statusKey: option.statusKey || String(firstEffect.statusKey || firstEffect.status || ''),
    color: option.color || String(firstEffect.color || ''),
    secondaryColor: option.secondaryColor || String(firstEffect.secondaryColor || ''),
    saveAbility,
    saveDc,
    repeatSave: firstEffect.repeatSave ?? save.repeatSave,
    saveOnSuccess: firstEffect.saveOnSuccess ?? save.onSuccess ?? save.saveOnSuccess,
    autoExpire: isConditionOption ? false : undefined,
  };
}

function getInventoryItemCategory(item: Record<string, unknown>): InventoryFilter {
  const text = `${item.name || ''} ${item.properties || ''} ${item.descricao || ''} ${item.damage || ''} ${item.damage_type || ''}`.toLowerCase();
  const effectJson = String(item.effect_json || '').trim();
  if (effectJson && effectJson !== '[]') return 'Efeitos';
  if (text.includes('poção') || text.includes('pocao') || text.includes('pergaminho') || text.includes('consum')) return 'Consumiveis';
  if (text.includes(' ca ') || text.includes('armadura') || text.includes('escudo')) return 'Armaduras';
  if (String(item.damage || '').trim() || text.includes('arma')) return 'Armas';
  return 'Outros';
}

function matchesInventorySearch(item: InventoryItemOption, search: string) {
  return [
    item.name,
    item.damage,
    item.damage_type,
    item.properties,
    item.descricao,
    getInventoryItemCategory(item),
  ].some((value) => String(value || '').toLowerCase().includes(search));
}

function describeInventoryItem(item: Record<string, unknown>) {
  return [item.damage, item.damage_type, item.properties, item.descricao]
    .filter((value) => value && value !== '-')
    .join(' - ');
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function formatReferenceNames(ids: string[], options: ReferenceOption[]) {
  if (!ids.length) return '';
  const byId = new Map(options.map((option) => [String(option.id), option]));
  return ids.map((id) => {
    const option = byId.get(String(id));
    return option ? `${option.name}${option.stat ? ` (${option.stat})` : ''}` : id;
  }).join(', ');
}

function formatCharacterField(field: string) {
  const labels: Record<string, string> = {
    personality_traits: 'Personalidade',
    ideals: 'Ideais',
    bonds: 'Vinculos',
    flaws: 'Defeitos',
    backstory: 'Historia',
    allies_organizations: 'Aliados/organizacoes',
    languages: 'Idiomas',
  };
  return labels[field] || field;
}


function shouldShowSessionEventInMasterTimeline(event: LanSessionEvent) {
  if (event.type === 'send_item_result' || event.type === 'trade_result') return false;
  if (event.type === 'player_patch' && String(event.message || '').startsWith('Mestre aceitou:')) return false;
  if (event.type === 'resource_review' && String(event.message || '').startsWith('Mestre aceitou:')) return true;
  if (event.type === 'inventory_patch' && event.fromKey === 'master') {
    const action = String(event.inventoryPatch?.action || '');
    if (action === 'self_update' || action === 'transfer_in' || action === 'transfer_out') return false;
    // grant/replace do mestre é registro de campanha e deve aparecer no card.
  }
  if (event.type === 'pending_save_patch' && event.fromKey === 'master' && event.pendingSavePatch?.action === 'resolve') {
    return false;
  }
  return true;
}

function formatSessionEvent(event: LanSessionEvent) {
  if (event.type === 'resource_request') return `${event.fromName} pediu: ${formatResourceRequest(event.resourceRequest)}.`;
  if (event.message) return event.message;
  if (event.type === 'player_joined') return `${event.fromName} entrou na sessao.`;
  if (event.type === 'effect_expired') {
    const effectName = event.expiredEffect?.name || 'Efeito';
    return `${event.toName}: ${effectName} acabou.`;
  }
  if (event.type === 'effect_patch') return event.message || `Efeitos oficiais atualizados para ${event.toName}.`;
  if (event.type === 'effect_catalog_patch') return event.message || 'Catalogo de efeitos atualizado.';
  if (event.type === 'pending_save_patch') return event.message || `Teste pendente atualizado para ${event.toName}.`;
  if (event.type === 'spell_effect') {
    if (event.fromKey === event.toKey || event.fromName === event.toName) return `${event.fromName} usou ${event.spellEffect?.spellName || 'efeito'}.`;
    return `${event.fromName} aplicou ${event.spellEffect?.spellName || 'efeito'} em ${event.toName}.`;
  }
  if (event.type === 'spell_hp') return `${event.fromName} usou ${event.spellEffect?.spellName || 'magia'} em ${event.toName}.`;
  if (event.type === 'resource_review') return event.message || `Revisao de pedido: ${event.toName}.`;
  if (event.type === 'inventory_patch') return event.message || `${event.fromName} atualizou o inventario.`;
  if (event.type === 'player_patch') return event.message || `${event.fromName} atualizou recursos proprios.`;
  if (event.type === 'send_item') return `${event.fromName} enviou ${event.item?.qty || 1}x ${event.item?.name || 'item'} para ${event.toName}.`;
  if (event.type === 'trade_offer') return `${event.fromName} ofereceu troca para ${event.toName}.`;
  if (event.type === 'trade_accept') return `${event.fromName} aceitou troca com ${event.toName}.`;
  if (event.type === 'trade_decline') return `${event.fromName} recusou troca com ${event.toName}.`;
  if (event.type === 'timeline_event') return event.message || 'Evento da sessao.';
  return event.type;
}

function normalizeResourceCoinField(value: unknown): 'gp' | 'sp' | 'cp' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gp' || normalized === 'po' || normalized === 'ouro' || normalized === 'gold') return 'gp';
  if (normalized === 'sp' || normalized === 'pp' || normalized === 'prata' || normalized === 'silver') return 'sp';
  if (normalized === 'cp' || normalized === 'pc' || normalized === 'cobre' || normalized === 'bronze' || normalized === 'copper') return 'cp';
  return null;
}

function describeResourceForReview(request?: LanSessionEvent['resourceRequest']) {
  if (!request) return 'pedido';
  if (request.message) return request.message;
  const amount = Number(request.amount ?? request.value ?? 0);
  if (request.kind === 'coin') {
    const field = normalizeResourceCoinField(request.field) || 'gp';
    const label = field === 'gp' ? 'Ouro' : field === 'sp' ? 'Prata' : 'Cobre';
    return `${amount >= 0 ? '+' : ''}${amount} ${label}`;
  }
  if (request.kind === 'xp') return `${amount >= 0 ? '+' : ''}${amount} XP`;
  if (request.kind === 'hp') return `${amount >= 0 ? '+' : ''}${amount} HP`;
  if (request.kind === 'temp_hp') return `${amount >= 0 ? '+' : ''}${amount} PV temporario`;
  if (request.kind === 'stat') return `${request.field || 'atributo'} ${amount >= 0 ? '+' : ''}${amount}`;
  return request.kind;
}

function formatResourceRequest(request?: LanSessionEvent['resourceRequest']) {
  if (!request) return 'ajuste';
  if (request.message) return request.message;
  const amount = Number(request.amount ?? request.value ?? 0);
  const sign = amount >= 0 ? '+' : '';
  if (request.kind === 'xp') return `XP ${sign}${amount}`;
  if (request.kind === 'hp') return `HP ${sign}${amount}`;
  if (request.kind === 'temp_hp') return `PV temporario ${sign}${amount}`;
  if (request.kind === 'coin') return `${formatCoinField(request.field)} ${sign}${amount}`;
  if (request.kind === 'stat' || request.kind === 'buff') return `${request.field || 'atributo'} ${sign}${amount}`;
  if (request.kind === 'condition') return `condicao ${request.field || 'manual'}`;
  if (request.kind === 'inventory') return request.item ? `${request.item.qty}x ${request.item.name}` : 'inventario';
  return 'ajuste';
}

function formatCoinField(field?: string) {
  if (field === 'gp') return 'ouro';
  if (field === 'sp') return 'prata';
  if (field === 'cp') return 'cobre';
  return 'moedas';
}

function formatPlayerField(field: 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp') {
  const labels = {
    hpCurrent: 'vida atual',
    hpMax: 'vida maxima',
    tempHp: 'vida temporaria',
    xp: 'XP',
    gp: 'ouro',
    sp: 'prata',
    cp: 'cobre',
  };
  return labels[field];
}

function formatAdvanceUnit(unit: LanAdvanceUnit) {
  const labels: Record<LanAdvanceUnit, string> = {
    turn: 'um turno',
    minute: 'um minuto',
    hour: 'uma hora',
    shortRest: 'um descanso curto',
    longRest: 'um descanso longo',
  };
  return labels[unit];
}

function parsePayloadJson(value?: string | null): LanSessionPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && parsed.session?.id) {
      return parsed as LanSessionPayload;
    }
  } catch {
    // Payload legado/corrompido cai para refresh como fallback.
  }
  return null;
}

function parseOptionEffects(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeCatalogEffect);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(normalizeCatalogEffect) : [];
  } catch {
    return [];
  }
}

function normalizeCatalogEffect(effect: any) {
  const condition = effect?.condition || {};
  const save = effect?.save || effect?.savingThrow || effect?.saving_throw || {};
  const conditionDuration = condition?.duration || {};
  const kind = String(effect?.kind || effect?.type || '').toLowerCase();
  const target = effect?.target || (kind === 'temp_hp' ? 'PV_TEMP' : kind === 'stat' ? effect?.stat : 'custom');
  const rawSaveAbility = save?.ability ?? save?.saveAbility ?? effect?.saveAbility ?? effect?.ability ?? effect?.savingThrowAbility ?? effect?.saving_throw_ability;
  const rawSaveDc = save?.dc ?? save?.dcFixed ?? save?.saveDc ?? effect?.saveDc ?? effect?.dc ?? effect?.save_dc;

  return {
    ...effect,
    target,
    value: effect?.value ?? effect?.amount ?? 0,
    status: condition?.key || effect?.status,
    conditionName: condition?.name,
    color: condition?.color || effect?.color,
    secondaryColor: condition?.secondaryColor || effect?.secondaryColor,
    saveAbility: String(rawSaveAbility || '').trim().toUpperCase() || undefined,
    saveDc: Number(rawSaveDc || 0) || undefined,
    repeatSave: save?.repeatSave ?? conditionDuration?.repeatSave ?? effect?.repeatSave,
    saveOnSuccess: save?.onSuccess ?? save?.saveOnSuccess ?? effect?.saveOnSuccess,
    durationValue: effect?.durationValue ?? conditionDuration?.value,
    durationUnit: effect?.durationUnit ?? conditionDuration?.unit,
    mode: effect?.mode === 'set' || effect?.operation === 'set' || kind === 'stat_set' ? 'set' : 'add',
  };
}

function formatEffectSaveInfo(effect: any) {
  if (!effect?.saveAbility) return '';
  const successLabels: Record<string, string> = {
    none: 'sucesso sem efeito adicional',
    half: 'sucesso reduz pela metade',
    negates: 'sucesso anula',
  };
  const dc = effect.saveDc ? ` CD ${effect.saveDc}` : '';
  const failure = effect.conditionName ? `; falha aplica ${effect.conditionName}` : '';
  return `Teste ${effect.saveAbility}${dc} (${successLabels[String(effect.saveOnSuccess || 'none')] || 'sucesso definido pelo mestre'}${failure}).`;
}

function getActiveEffectIdFromPendingPayload(pendingPayload: Record<string, any>, targetPlayer: LanSessionPlayerState) {
  const directId = String(pendingPayload?.id || pendingPayload?.sourceId || pendingPayload?.effectId || '').trim();
  const activeEffects = Array.isArray(targetPlayer.effects) ? targetPlayer.effects : [];
  if (directId && activeEffects.some((effect: any) => String(effect?.id || effect?.lanEffectId || '') === directId)) {
    return directId;
  }

  const pendingName = String(pendingPayload?.name || pendingPayload?.sourceName || '').trim().toLowerCase();
  const pendingStatus = String(pendingPayload?.status || pendingPayload?.statusKey || '').trim().toLowerCase();
  const pendingTarget = String(pendingPayload?.target || '').trim().toUpperCase();
  const matched = activeEffects.find((effect: any) => {
    const effectId = String(effect?.id || effect?.lanEffectId || '').trim();
    if (!effectId) return false;
    if (directId && effectId === directId) return true;
    const sameName = pendingName && String(effect?.name || effect?.sourceName || '').trim().toLowerCase() === pendingName;
    const sameStatus = pendingStatus && String(effect?.status || effect?.statusKey || '').trim().toLowerCase() === pendingStatus;
    const sameTarget = pendingTarget && String(effect?.target || '').trim().toUpperCase() === pendingTarget;
    return Boolean((sameName || sameStatus) && (!pendingTarget || sameTarget || sameStatus));
  });
  return String((matched as any)?.id || (matched as any)?.lanEffectId || directId || '').trim();
}

function buildEffectDraftFromPendingSavePayload(
  pendingPayload: Record<string, any>,
  fallback?: { dc?: number | null; sourceName?: string | null },
): EffectDraft {
  const save = pendingPayload?.save && typeof pendingPayload.save === 'object' ? pendingPayload.save : {};
  const unit = normalizeEffectUnit(pendingPayload.unit || pendingPayload.durationUnit) || 'turn';
  const durationText = String(pendingPayload.durationText || '');
  const isPermanent = Boolean(pendingPayload.isPermanent) || unit === 'permanent' || durationText.toLowerCase().includes('permanente');
  const rawRemaining = pendingPayload.remaining ?? pendingPayload.durationRemaining ?? pendingPayload.durationValue ?? pendingPayload.duration_value ?? 1;
  const remaining = isPermanent ? 0 : Math.max(1, Math.floor(Number(rawRemaining) || 1));
  const target = normalizeEffectTarget(pendingPayload.target);
  const rawKind = String(pendingPayload.kind || pendingPayload.type || '').toLowerCase();
  const kind: EffectDraft['kind'] = rawKind === 'temp_hp'
    ? 'temp_hp'
    : rawKind === 'hp'
      ? 'hp'
      : rawKind === 'status' || rawKind === 'condition'
        ? 'status'
        : target === 'custom'
          ? 'status'
          : 'stat';
  const rawSaveDc = save.dc ?? save.saveDc ?? save.dcFixed ?? pendingPayload.saveDc ?? pendingPayload.dc ?? fallback?.dc;
  const saveDc = Number(rawSaveDc);
  const rawSaveAbility = save.ability ?? save.saveAbility ?? pendingPayload.saveAbility ?? pendingPayload.ability;
  const saveAbility = String(rawSaveAbility || '').trim().toUpperCase();
  const repeatSave = String(pendingPayload.repeatSave ?? save.repeatSave ?? '').trim();
  const saveOnSuccess = String(save.onSuccess || save.saveOnSuccess || pendingPayload.saveOnSuccess || '').trim();
  const explicitAutoExpire = typeof pendingPayload.autoExpire === 'boolean'
    ? pendingPayload.autoExpire
    : typeof pendingPayload.auto_expire === 'boolean'
      ? pendingPayload.auto_expire
      : undefined;
  const shouldInferAutoExpire = kind === 'status' &&
    !isPermanent &&
    remaining > 0 &&
    unit !== 'manual' &&
    unit !== 'concentration' &&
    unit !== 'while_equipped';

  return {
    name: String(pendingPayload.name || pendingPayload.sourceName || fallback?.sourceName || 'Efeito'),
    target,
    value: Number(pendingPayload.value ?? pendingPayload.amount ?? 0) || 0,
    remaining,
    unit,
    durationText: durationText || (isPermanent ? 'Permanente' : `${remaining} ${unit}`),
    kind,
    mode: pendingPayload.mode === 'set' ? 'set' : 'add',
    status: pendingPayload.status,
    statusKey: pendingPayload.statusKey || pendingPayload.status,
    color: pendingPayload.color,
    secondaryColor: pendingPayload.secondaryColor,
    source: String(pendingPayload.source || pendingPayload.sourceName || fallback?.sourceName || 'Mestre'),
    saveDc: Number.isFinite(saveDc) && saveDc > 0 ? saveDc : undefined,
    saveAbility: saveAbility || undefined,
    repeatSave: repeatSave || undefined,
    saveOnSuccess: saveOnSuccess || undefined,
    autoExpire: explicitAutoExpire ?? shouldInferAutoExpire,
  };
}

function normalizeEffectUnit(value: unknown): LanEffectUnit | null {
  if (
    value === 'instant' ||
    value === 'turn' ||
    value === 'round' ||
    value === 'minute' ||
    value === 'hour' ||
    value === 'day' ||
    value === 'short_rest' ||
    value === 'long_rest' ||
    value === 'rest' ||
    value === 'concentration' ||
    value === 'while_equipped' ||
    value === 'while_active' ||
    value === 'until_save' ||
    value === 'permanent' ||
    value === 'manual'
  ) return value;
  return null;
}

function inferUnitFromText(value?: string): LanEffectUnit {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('turno') || raw.includes('rodada')) return 'turn';
  if (raw.includes('hora')) return 'hour';
  if (raw.includes('min')) return 'minute';
  return 'rest';
}

function normalizeEffectTarget(value: unknown): LanEffectTarget {
  const target = String(value || '').toUpperCase();
  if (target === 'FOR' || target === 'DES' || target === 'CON' || target === 'INT' || target === 'SAB' || target === 'CAR' || target === 'CA' || target === 'HP' || target === 'PV_TEMP') {
    return target as LanEffectTarget;
  }
  return 'custom';
}

function isPermanentStatEffect(effect: Pick<EffectDraft, 'target' | 'unit' | 'kind'>) {
  const target = String(effect.target || '').toUpperCase();
  return effect.unit === 'permanent' && PERMANENT_STAT_TARGETS.includes(target as any) && effect.kind !== 'hp' && effect.kind !== 'temp_hp';
}

function sanitizePlayerOwnedStatsPatch(
  currentStats: Record<string, unknown>,
  incomingStats: Record<string, unknown>,
  options?: { allowBaseStats?: boolean },
) {
  const nextStats = { ...(currentStats || {}) };

  // Equipar/desequipar deve persistir equip_mods; consumo temporário pode manter
  // temp_mods antigos. Consumo permanente de item, porém, altera o atributo base
  // do jogador. A v57 descartava FOR/DES/CON/etc. vindos do jogador e por isso o
  // mestre via o item consumido, mas a ficha autoritativa continuava com o valor antigo.
  if (options?.allowBaseStats) {
    for (const key of [...STAT_KEYS, 'CA']) {
      if (incomingStats?.[key] == null) continue;
      const numeric = Number(incomingStats[key]);
      if (Number.isFinite(numeric)) nextStats[key] = String(Math.floor(numeric));
    }
  }

  for (const key of ['temp_mods', 'equip_mods']) {
    const value = incomingStats?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      nextStats[key] = value;
    } else {
      delete (nextStats as Record<string, unknown>)[key];
    }
  }
  return nextStats;
}

function normalizeInventoryStackText(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '[]' || raw === '{}' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getInventoryStackKey(item: Record<string, any>) {
  // Nome + campos que diferenciam itens mecanicamente. Assim "Ampulheta" soma,
  // mas duas poções com efeitos ocultos diferentes não são misturadas por acidente.
  return [
    normalizeInventoryStackText(item.name || item.nome || item.label),
    normalizeInventoryStackText(item.damage || item.dano || ''),
    normalizeInventoryStackText(item.damage_type || item.tipo_dano || ''),
    normalizeInventoryStackText(item.properties || item.propriedades || ''),
    normalizeInventoryStackText(item.effect_json || item.effectJson || ''),
    normalizeInventoryStackText(item.duration_unit || ''),
    String(item.duration_value ?? ''),
  ].join('|');
}

function compactInventoryBagStacks(rawBag: unknown[]) {
  const byKey = new Map<string, Record<string, any>>();
  const result: Record<string, any>[] = [];

  for (const rawItem of rawBag) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = { ...(rawItem as Record<string, any>) };
    const key = getInventoryStackKey(item);
    if (!key || key.startsWith('|')) {
      result.push(item);
      continue;
    }

    const current = byKey.get(key);
    if (!current) {
      item.qty = Math.max(1, Number(item.qty) || 1);
      byKey.set(key, item);
      result.push(item);
      continue;
    }

    current.qty = Math.max(1, Number(current.qty) || 1) + Math.max(1, Number(item.qty) || 1);
  }

  return result;
}

function mergeInventoryItemIntoBag(rawBag: unknown[], item: Record<string, any>, qty: number) {
  const bag = compactInventoryBagStacks(Array.isArray(rawBag) ? rawBag : []);
  const nextItem = { ...item, qty: Math.max(1, Number(qty) || 1) };
  const nextKey = getInventoryStackKey(nextItem);
  const existingIndex = bag.findIndex((entry) => getInventoryStackKey(entry) === nextKey);

  if (existingIndex >= 0) {
    bag[existingIndex] = {
      ...bag[existingIndex],
      ...nextItem,
      qty: Math.max(1, Number(bag[existingIndex].qty) || 1) + Math.max(1, Number(qty) || 1),
    };
    return bag;
  }

  return [...bag, nextItem];
}

function removeInventoryItemFromBag(rawBag: unknown[], item: Record<string, any>, qty: number) {
  const bag = compactInventoryBagStacks(Array.isArray(rawBag) ? rawBag : []);
  const nextItem = { ...item, qty: Math.max(1, Number(qty) || 1) };
  const nextKey = getInventoryStackKey(nextItem);
  const existingIndex = bag.findIndex((entry) => getInventoryStackKey(entry) === nextKey);
  if (existingIndex < 0) return bag;

  const currentQty = Math.max(0, Number(bag[existingIndex]?.qty) || 0);
  const nextQty = currentQty - Math.max(1, Number(qty) || 1);
  if (nextQty <= 0) return bag.filter((_, index) => index !== existingIndex);
  bag[existingIndex] = { ...bag[existingIndex], qty: nextQty };
  return bag;
}

function normalizeHostEquipment(value: unknown): Record<string, any> {
  const equipment = parsePayloadJsonValue<Record<string, any>>(value, {});
  if (Array.isArray(equipment)) return { bag: compactInventoryBagStacks(equipment), slots: {} };
  if (!equipment || typeof equipment !== 'object') return { bag: [], slots: {} };
  return {
    ...equipment,
    bag: compactInventoryBagStacks(Array.isArray(equipment.bag) ? [...equipment.bag] : []),
    slots: equipment.slots && typeof equipment.slots === 'object' ? equipment.slots : {},
  };
}

function getHostAbilityModifier(player: LanSessionPlayerState, ability: string) {
  const stats = player.stats || {};
  const normalized = String(ability || '').toUpperCase();
  const tempMods = stats.temp_mods && typeof stats.temp_mods === 'object' ? stats.temp_mods as Record<string, unknown> : {};
  const equipMods = stats.equip_mods && typeof stats.equip_mods === 'object' ? stats.equip_mods as Record<string, unknown> : {};
  const base = parseInt(String(stats[normalized] ?? '10'), 10) || 10;
  const temp = parseInt(String(tempMods[normalized] ?? '0'), 10) || 0;
  const equip = parseInt(String(equipMods[normalized] ?? '0'), 10) || 0;
  return Math.floor(((base + temp + equip) - 10) / 2);
}

function getHostStatModifier(player: LanSessionPlayerState, stat: string) {
  const stats = player.stats || {};
  const normalized = String(stat || '').toUpperCase();
  const tempMods = stats.temp_mods && typeof stats.temp_mods === 'object' ? stats.temp_mods as Record<string, unknown> : {};
  const equipMods = stats.equip_mods && typeof stats.equip_mods === 'object' ? stats.equip_mods as Record<string, unknown> : {};
  const temp = parseInt(String(tempMods[normalized] ?? '0'), 10) || 0;
  const equip = parseInt(String(equipMods[normalized] ?? '0'), 10) || 0;
  const effects = Array.isArray(player.effects) ? player.effects : [];
  const effectBonus = effects.reduce((sum, effect) => {
    const active = (effect as any).active !== false;
    const target = String(effect.target || '').toUpperCase();
    if (!active || target !== normalized) return sum;
    return sum + (Number(effect.value) || 0);
  }, 0);
  return temp + equip + effectBonus;
}

function calculateHostArmorClass(player: LanSessionPlayerState) {
  const equipment = normalizeHostEquipment(player.equipment);
  const armor = equipment.slots?.armor;
  const props = String(armor?.properties || armor?.descricao || armor?.description || '');
  let baseCa = 10;
  let addDes = true;
  const match = props.match(/CA\s*(\d+)/i);
  if (match) baseCa = parseInt(match[1], 10) || baseCa;
  if (props.includes('CA 16') || props.includes('Armadura Completa') || props.includes('Pesada')) addDes = false;
  return baseCa + (addDes ? getHostAbilityModifier(player, 'DES') : 0) + getHostStatModifier(player, 'CA');
}

function removeHostEquipmentItem(equipment: Record<string, any>, itemName: string, qty: number) {
  const name = String(itemName || '').trim().toLowerCase();
  const amount = Math.max(1, Math.floor(Number(qty) || 1));
  const bag = Array.isArray(equipment.bag) ? [...equipment.bag] : [];
  const index = bag.findIndex((entry: any) => String(entry?.name || '').trim().toLowerCase() === name);
  if (index < 0) return false;
  const currentQty = Math.max(0, Number(bag[index]?.qty || 0));
  if (currentQty < amount) return false;
  const nextQty = currentQty - amount;
  if (nextQty <= 0) bag.splice(index, 1);
  else bag[index] = { ...bag[index], qty: nextQty };
  equipment.bag = bag;
  return true;
}

function buildHostEffectDraftFromSpell(spellEffect: NonNullable<LanSessionEvent['spellEffect']>, sourceName: string) {
  const duration = createEffectDurationPayload({ value: spellEffect.durationRemaining ?? 1, unit: spellEffect.durationUnit || 'rest' });
  const unit = duration.unit as LanEffectUnit;
  const isPermanent = duration.isPermanent;
  const remaining = duration.remaining;
  const spellAutoExpire = typeof (spellEffect as any).autoExpire === 'boolean'
    ? (spellEffect as any).autoExpire
    : Boolean(
      (spellEffect.status || spellEffect.target === 'custom') &&
      !isPermanent &&
      remaining > 0 &&
      unit !== 'manual' &&
      unit !== 'permanent' &&
      unit !== 'concentration' &&
      unit !== 'while_equipped'
    );
  return {
    name: spellEffect.spellName || 'Efeito',
    target: spellEffect.target || 'custom',
    value: Number(spellEffect.value || 0),
    remaining,
    unit,
    durationText: spellEffect.durationText || (isPermanent ? 'Permanente' : `${remaining} ${unit}`),
    kind: spellEffect.target === 'PV_TEMP' ? 'temp_hp' : spellEffect.target === 'HP' ? 'hp' : spellEffect.target === 'custom' ? 'custom' : 'stat',
    mode: spellEffect.effectMode || 'add',
    status: spellEffect.status,
    statusKey: spellEffect.status,
    color: spellEffect.color,
    secondaryColor: spellEffect.secondaryColor,
    repeatSave: (spellEffect as any).repeatSave,
    autoExpire: spellAutoExpire,
    source: sourceName,
  };
}

function buildHostEffectDraftFromRaw(rawEffect: Record<string, any>, request: NonNullable<LanSessionEvent['actionRequest']>, sourceName: string) {
  const kind = String(rawEffect.kind || rawEffect.type || '').toLowerCase();
  const needsChosenStat = Boolean(rawEffect.chooseStat) || String(rawEffect.target || '').toUpperCase() === 'CHOOSE_STAT' || String(rawEffect.effectType || '') === 'Escolher Atributo';
  const condition = rawEffect.condition || {};
  const conditionDuration = condition.duration || {};
  const target = String(needsChosenStat ? request.chosenAttr : rawEffect.target || '').toUpperCase();
  const duration = createEffectDurationPayload({
    value: rawEffect.durationValue ?? rawEffect.duration_value ?? conditionDuration.value ?? request.item?.duration_value ?? 1,
    unit: rawEffect.durationUnit || rawEffect.duration_unit || conditionDuration.unit || request.item?.duration_unit || 'rest',
  });
  const unit = duration.unit as LanEffectUnit;
  const isPermanent = duration.isPermanent || String(rawEffect.durationText || '').toLowerCase().includes('permanente');
  const remaining = isPermanent ? 0 : duration.remaining;
  const value = Number(rawEffect.value || rawEffect.amount || 0);
  const explicitAutoExpire = typeof rawEffect.autoExpire === 'boolean'
    ? rawEffect.autoExpire
    : typeof conditionDuration.autoExpire === 'boolean'
      ? conditionDuration.autoExpire
      : undefined;
  const timedAutoExpire = Boolean(
    !isPermanent &&
    remaining > 0 &&
    unit !== 'manual' &&
    unit !== 'permanent' &&
    unit !== 'concentration' &&
    unit !== 'while_equipped'
  );

  if (kind === 'heal') {
    return {
      kind: 'heal',
      name: `${sourceName}: cura`,
      value: Math.max(0, value || Number(String(rawEffect.healDice || rawEffect.dice || '').match(/^\d+$/)?.[0] || 0)),
      target: 'HP',
      remaining: 0,
      unit: 'instant',
    };
  }

  if (condition?.key && condition.key !== 'none') {
    return {
      name: condition.name || sourceName,
      target: target && target !== 'UNDEFINED' ? normalizeEffectTarget(target) : 'custom',
      value,
      remaining,
      unit,
      durationText: rawEffect.durationText || conditionDuration.text || (isPermanent ? 'Permanente' : `${remaining} ${unit}`),
      kind: 'status',
      mode: 'add',
      status: condition.key,
      statusKey: condition.key,
      color: condition.color,
      secondaryColor: condition.secondaryColor,
      repeatSave: rawEffect.repeatSave || rawEffect.save?.repeatSave || conditionDuration.repeatSave,
      autoExpire: explicitAutoExpire ?? timedAutoExpire,
      source: sourceName,
    };
  }

  return {
    name: `${sourceName}: ${target || 'efeito'} ${value > 0 ? '+' : ''}${value}`,
    target: normalizeEffectTarget(target),
    value,
    remaining,
    unit,
    durationText: rawEffect.durationText || (isPermanent ? 'Permanente' : `${remaining} ${unit}`),
    kind: target === 'PV_TEMP' ? 'temp_hp' : target === 'HP' ? 'hp' : target === 'custom' ? 'custom' : 'stat',
    mode: rawEffect.mode === 'set' ? 'set' : 'add',
    status: isPermanent ? 'permanent_item_effect' : 'item_effect',
    statusKey: isPermanent ? 'permanent_item_effect' : 'item_effect',
    color: isPermanent ? '#00fa9a' : '#00bfff',
    secondaryColor: '#8be9fd',
    repeatSave: rawEffect.repeatSave || rawEffect.save?.repeatSave,
    autoExpire: explicitAutoExpire,
    source: sourceName,
  };
}

function getHostSaveConfig(rawEffect: any) {
  const save = rawEffect?.save || {};
  const ability = String(save.ability || save.saveAbility || '').toUpperCase();
  const dc = Number(save.dc ?? save.saveDc ?? save.dcFixed ?? 0);
  if (!ability || ability === 'NENHUM' || ability === 'NONE' || dc <= 0) return null;
  return {
    saveAbility: ability,
    dc,
    saveOnSuccess: String(save.onSuccess || save.saveOnSuccess || 'negates'),
  };
}

function shouldCreateHostSave(rawEffect: any) {
  const save = getHostSaveConfig(rawEffect);
  if (!save) return false;
  const condition = rawEffect?.condition || {};
  if (condition?.key && condition.key !== 'none') return true;
  return Boolean(rawEffect?.save?.enabled === true);
}

function parsePayloadJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
