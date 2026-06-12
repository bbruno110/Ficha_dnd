// ================= sheet.tsx =================
import DiceRoller3D, { type DiceRollRequest, type DiceRollResult } from '@/components/DiceRoller3D';
import { useLanAppLifecycle } from '@/hooks/useLanAppLifecycle';
import { useLanProjection } from '@/hooks/useLanProjection';
import { useLanRealtimePlayerPatches } from '@/hooks/useLanRealtimePlayerPatches';
import {
  canUseVisualDiceRoll,
  formatDiceRollBreakdown,
  parseUsableDiceFormula,
  rollParsedDiceFormula,
  type ParsedDiceFormula,
} from '@/services/combat/diceFormulaService';
import { applyDamageWithTempHp } from '@/services/combat/hpDamageService';
import { resolveSavingThrow } from '@/services/combat/saveResolverService';
import {
  traceApp,
  traceButton,
  traceError,
  traceFunctionCall,
  traceFunctionReturn,
  traceScreen,
  traceSqlite,
  traceStateChange,
} from '@/services/debug/appTrace';
import { getCurrentBreathFrameStyle, getVisibleEffects } from '@/services/effects/effectVisualService';
import { subscribeLanForegroundRecovery } from '@/services/lan/lanForegroundRecoveryBus';
import { LAN_ENGINE_PROJECTION_MODE } from '@/services/lan/lanClientEngine';
import {
  applyIncomingSnapshot,
  dispatchPlayerCommand,
  getLanProjection,
} from '@/services/lan/engine/LanEngineBridge';
import type {
  CharacterProjection,
  LanAuthoritativeEvent,
  LanCommand,
} from '@/services/lan/engine/LanTypes';
import {
  consumeItemAtomically as consumeLanInventoryItemAtomically,
  equipItemAtomically as equipLanInventoryItemAtomically,
  getInventoryStackKey,
} from '@/services/lan/lanInventoryDomain';
import {
  debugLanFlow,
  getSheetRuntimeMode,
  hasLanBlockedUpdates,
  isLanPlayerMode,
  splitLanPlayerAuthoritativeUpdates,
} from '@/services/lanRuntimeMode';
import {
  fetchLanSessionPayload,
  getLocalLanSessionForCharacter,
  getPublicLanPlayers,
  makeLanCharacterKey,
  makeLanEventId,
  notifyMasterJoin,
  rememberLanSessionEvent,
  requestLanSessionResync,
  resetLanClientConnection,
  resolveLanSessionUrlByInviteCode,
  saveLanSession,
  sendLanSessionEvent,
  syncCharacterInventoryForEquipment,
  unlinkCharacterFromLanSession,
  type LanEffectTarget,
  type LanEffectUnit,
  type LanResourceRequest,
  type LanSessionEvent,
  type LanSessionPayload,
  type LanSessionStatus,
  type LanTradeItem,
  type PublicLanPlayer
} from '@/services/lanSession';
import {
  getLanPayloadSnapshotSeq,
  markLanConnectionStatus,
  markLanEventsApplied,
  markLanSnapshotApplied
} from '@/services/lanSyncEngine';
import {
  getExpectedLevelForXp as getExpectedLevelForXpFromDb,
  getXpRequiredForLevel,
  seedDefaultXpProgression,
} from '@/services/xpProgressionService';
import { getKnownLanEntityRevisions, useLanRealtimeStore } from '@/stores/lanRealtimeStore';
import { appColors, appGradients, sheetStyles as styles } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, FlatList, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

const DEFAULT_SLOTS = { 
  helmet: null, cloak: null, amulet: null, armor: null, campClothes: null,
  gloves: null, boots: null, ring1: null, ring2: null, 
  mainHand: null, offHand: null, ranged: null, lightSource: null 
};

const SPELL_LEVELS = ['Todos', 'Passiva', 'Habilidade', 'Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
const SPELL_EFFECTS = ['Todos', 'Dano', 'Cura', 'Suporte/Defesa'];

// Protecao global porque, ao voltar de foreground/rebind, a tela pode ter
// duas assinaturas vivas por alguns milissegundos. Sem isso, o mesmo pause
// gera dois Alert.alert no jogador.
const GLOBAL_SESSION_PAUSE_ALERT_KEYS = new Set<string>();
// Dedupe global do proprio session_patch; evita que hooks duplicados apliquem pause/resume 2-3x antes do estado local atualizar.
const GLOBAL_SESSION_PATCH_EVENT_KEYS = new Set<string>();
const REMOVED_SHEET_EFFECT_TOMBSTONE_TTL_MS = 120000;
const REMOVED_SHEET_EFFECT_IDS = new Map<string, number>();

// Regra da mesa/app: 1 PO = 10 PP = 100 PC.
const COIN_RATES = { gp: 100, sp: 10, cp: 1 };
const COIN_NAMES = { gp: 'Ouro', sp: 'Prata', cp: 'Cobre' };
const COIN_COLORS = { gp: appColors.warning, sp: appColors.silver, cp: appColors.copper };

type DiceValueResolution = {
  total: number;
  mode: 'manual' | 'virtual';
  formula: string;
  breakdown?: string;
};

const ROLLABLE_EFFECT_TARGETS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'HP', 'PV_TEMP'];

function getStructuredEffectDiceFormulaForUse(effect: any) {
  const kind = String(effect?.kind || effect?.type || '').toLowerCase();
  const target = String(effect?.target || '').toUpperCase();
  const valueFormula = [effect?.value, effect?.amount].find((candidate) => parseUsableDiceFormula(candidate));
  if (valueFormula && kind !== 'damage') return String(valueFormula);

  const healFormula = [effect?.healDice, effect?.dice].find((candidate) => parseUsableDiceFormula(candidate));
  if (healFormula && (kind === 'heal' || target === 'HP')) return String(healFormula);

  const tempHpFormula = [effect?.healDice, effect?.damageDice, effect?.dice].find((candidate) => parseUsableDiceFormula(candidate));
  if (tempHpFormula && (kind === 'temp_hp' || target === 'PV_TEMP')) return String(tempHpFormula);

  const genericFormula = [effect?.dice, effect?.damageDice].find((candidate) => parseUsableDiceFormula(candidate));
  if (genericFormula && ROLLABLE_EFFECT_TARGETS.includes(target)) return String(genericFormula);
  return '';
}

function getStructuredEffectDiceKey(index: number, effect: any) {
  return `${index}:${getStructuredEffectDiceFormulaForUse(effect)}`;
}
const getCoinTotalCopperValue = (coins: Partial<Record<'gp' | 'sp' | 'cp', unknown>>) => (
  Math.max(0, Math.floor(Number(coins.gp || 0))) * COIN_RATES.gp +
  Math.max(0, Math.floor(Number(coins.sp || 0))) * COIN_RATES.sp +
  Math.max(0, Math.floor(Number(coins.cp || 0))) * COIN_RATES.cp
);
const sanitizeCoins = (coins: Partial<Record<'gp' | 'sp' | 'cp', unknown>>) => ({
  gp: Math.max(0, Math.floor(Number(coins.gp || 0))),
  sp: Math.max(0, Math.floor(Number(coins.sp || 0))),
  cp: Math.max(0, Math.floor(Number(coins.cp || 0))),
});

function inferTotalLevelFromClassName(value: unknown) {
  const classText = String(value || '').trim();
  if (!classText) return 0;
  return classText
    .split('/')
    .map((segment) => segment.trim().match(/(?:^|\s)(\d{1,2})\s*$/)?.[1])
    .map((value) => Number(value || 0))
    .filter((level) => Number.isFinite(level) && level >= 1 && level <= 20)
    .reduce((sum, level) => sum + level, 0);
}
const LAN_NUMBER_COLUMNS = `
  hp_current,
  hp_max,
  temp_hp,
  xp,
  gp,
  sp,
  cp
`;

const formatSignedModifier = (value: number) => value >= 0 ? `+${value}` : String(value);

// Força a categoria correta para o agrupamento
const getCategory = (spell: any): string => {
  if (spell.category && spell.category !== 'Desconhecido') return spell.category;
  if (spell.level === 'Truque' || spell.level?.includes('Nível')) return 'Magia';
  if (spell.casting_time === 'Passiva' || spell.level === 'Passiva') return 'Passiva';
  return 'Habilidade';
};


const safeJsonParse = <T,>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};


const isTempHpEffectSnapshot = (effect: any) => (
  String(effect?.target || '').toUpperCase() === 'PV_TEMP' ||
  String(effect?.kind || '').toLowerCase() === 'temp_hp'
);

const getTempHpEffectValue = (effect: any) => isTempHpEffectSnapshot(effect)
  ? Math.max(0, Math.floor(Number(effect?.value) || 0))
  : 0;

const calculateStandardTempHpFromEffects = (effects: any[]) => (Array.isArray(effects) ? effects : [])
  .filter((effect) => isTempHpEffectSnapshot(effect) && getTempHpEffectValue(effect) > 0)
  .reduce((max, effect) => Math.max(max, getTempHpEffectValue(effect)), 0);

const removeTempHpEffectsLocally = (effects: any[]) => {
  const safeEffects = Array.isArray(effects) ? effects : [];
  const nextEffects = safeEffects.filter((effect) => !isTempHpEffectSnapshot(effect));
  return { effects: nextEffects, changed: nextEffects.length !== safeEffects.length };
};

const syncTempHpEffectsLocallyWithNumber = (effects: any[], tempHp: number) => {
  const safeEffects = Array.isArray(effects) ? effects : [];
  const cleanTempHp = Math.max(0, Math.floor(Number(tempHp) || 0));
  const tempEntries = safeEffects
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => isTempHpEffectSnapshot(effect));

  if (tempEntries.length === 0) return { effects: safeEffects, changed: false };
  if (cleanTempHp <= 0) return removeTempHpEffectsLocally(safeEffects);

  const selected = tempEntries.reduce((best, entry) => (
    getTempHpEffectValue(entry.effect) > getTempHpEffectValue(best.effect) ? entry : best
  ));
  const nextEffects = safeEffects.flatMap((effect, index) => {
    if (!isTempHpEffectSnapshot(effect)) return [effect];
    if (index !== selected.index) return [];
    return [{ ...effect, value: cleanTempHp }];
  });
  const changed = nextEffects.length !== safeEffects.length || getTempHpEffectValue(selected.effect) !== cleanTempHp;
  return { effects: nextEffects, changed };
};


const isRenderableLanEffectActive = (effect: any) => {
  if (!effect || effect.active === false) return false;
  const unit = String(effect.unit || '').toLowerCase();
  if (effect.isPermanent === true || unit === 'permanent' || unit === 'manual' || unit === 'while_equipped' || unit === 'concentration') return true;
  return Math.max(0, Math.floor(Number(effect.remaining || 0) || 0)) > 0;
};

const filterRenderableLanEffects = (effects: any[]) => (Array.isArray(effects) ? effects : []).filter(isRenderableLanEffectActive);

function pruneRemovedSheetEffectIds() {
  const now = Date.now();
  for (const [key, expiresAt] of REMOVED_SHEET_EFFECT_IDS.entries()) {
    if (expiresAt <= now) REMOVED_SHEET_EFFECT_IDS.delete(key);
  }
}

function getSheetEffectIds(effect: any) {
  return [
    effect?.id,
    effect?.lanEffectId,
    effect?.lanEffectID,
    effect?.sourceId,
  ].map((value) => String(value || '')).filter(Boolean);
}

function getRemovedSheetEffectKey(sessionId: string | undefined | null, effectId: string) {
  return `${sessionId || 'global'}:${effectId}`;
}

function rememberRemovedSheetEffectIds(sessionId: string | undefined | null, ids: string[]) {
  pruneRemovedSheetEffectIds();
  const expiresAt = Date.now() + REMOVED_SHEET_EFFECT_TOMBSTONE_TTL_MS;
  for (const id of ids.map(String).filter(Boolean)) {
    REMOVED_SHEET_EFFECT_IDS.set(getRemovedSheetEffectKey(sessionId, id), expiresAt);
    REMOVED_SHEET_EFFECT_IDS.set(getRemovedSheetEffectKey('global', id), expiresAt);
  }
}

function isSheetEffectTombstoned(sessionId: string | undefined | null, effect: any) {
  pruneRemovedSheetEffectIds();
  return getSheetEffectIds(effect).some((id) => (
    REMOVED_SHEET_EFFECT_IDS.has(getRemovedSheetEffectKey(sessionId, id)) ||
    REMOVED_SHEET_EFFECT_IDS.has(getRemovedSheetEffectKey('global', id))
  ));
}

const mergeSheetEffectUpdatePreservingElapsedDuration = (current: any, incoming: any) => {
  if (!current || !incoming) return incoming;
  const currentRemaining = Number(current.remaining);
  const incomingRemaining = Number(incoming.remaining);
  const currentUnit = String(current.unit || '').toLowerCase();
  const incomingUnit = String(incoming.unit || '').toLowerCase();
  const durationCanTick = currentUnit &&
    currentUnit === incomingUnit &&
    currentUnit !== 'manual' &&
    currentUnit !== 'permanent' &&
    currentUnit !== 'while_equipped' &&
    currentUnit !== 'concentration' &&
    Number.isFinite(currentRemaining) &&
    Number.isFinite(incomingRemaining);

  if (!durationCanTick || incomingRemaining <= currentRemaining) return incoming;
  return {
    ...incoming,
    remaining: currentRemaining,
    durationText: current.durationText || incoming.durationText,
  };
};

const getTempHpUnitWeight = (unit: unknown) => {
  const value = String(unit || '').toLowerCase();
  if (value === 'turn' || value === 'round') return 1;
  if (value === 'minute') return 2;
  if (value === 'hour') return 3;
  if (value === 'day') return 4;
  if (value === 'short_rest' || value === 'rest') return 5;
  if (value === 'long_rest') return 6;
  if (value === 'manual' || value === 'permanent') return 7;
  return 8;
};

const consumeTempHpEffectsLocally = (effects: any[], amount: number) => {
  let remainingDamage = Math.max(0, Math.floor(Number(amount) || 0));
  if (remainingDamage <= 0) return { effects, changed: false };

  const indexedEffects = effects.map((effect, index) => ({ effect, index }));
  const tempHpEntries = indexedEffects
    .filter(({ effect }) => isTempHpEffectSnapshot(effect) && getTempHpEffectValue(effect) > 0)
    .sort((a, b) => {
      const unitDiff = getTempHpUnitWeight(a.effect?.unit) - getTempHpUnitWeight(b.effect?.unit);
      if (unitDiff !== 0) return unitDiff;
      const remainingDiff = Math.max(0, Number(a.effect?.remaining) || 0) - Math.max(0, Number(b.effect?.remaining) || 0);
      if (remainingDiff !== 0) return remainingDiff;
      return String(a.effect?.id || '').localeCompare(String(b.effect?.id || ''));
    });

  if (tempHpEntries.length === 0) return { effects, changed: false };

  const nextEffects = [...effects];
  const removedIndexes = new Set<number>();

  for (const { effect, index } of tempHpEntries) {
    if (remainingDamage <= 0) break;
    const currentValue = getTempHpEffectValue(effect);
    const consumed = Math.min(currentValue, remainingDamage);
    const nextValue = Math.max(0, currentValue - consumed);
    remainingDamage -= consumed;

    if (nextValue <= 0) {
      removedIndexes.add(index);
    } else {
      nextEffects[index] = { ...effect, value: nextValue };
    }
  }

  return {
    effects: nextEffects.filter((_, index) => !removedIndexes.has(index)),
    changed: removedIndexes.size > 0 || remainingDamage !== amount,
  };
};

const normalizeSheetStackText = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '[]' || raw === '{}' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const getSheetInventoryItemId = (item: Record<string, any> | null | undefined) => {
  if (!item || typeof item !== 'object') return '';
  const raw = item.inventoryItemId ?? item.inventory_item_id ?? item.itemId ?? item.item_id ?? item.catalogItemId ?? item.catalog_item_id ?? item.sourceItemId ?? item.source_item_id ?? item.dbId ?? item.id;
  const normalized = normalizeSheetStackText(raw);
  return normalized && normalized !== '0' ? normalized : '';
};

const getSheetInventoryStackKey = (item: Record<string, any>) => [
  normalizeSheetStackText(item.name || item.nome || item.label),
  normalizeSheetStackText(item.damage || item.dano || ''),
  normalizeSheetStackText(item.damage_type || item.tipo_dano || ''),
  normalizeSheetStackText(item.properties || item.propriedades || ''),
  normalizeSheetStackText(item.effect_json || item.effectJson || ''),
  normalizeSheetStackText(item.duration_unit || ''),
  String(item.duration_value ?? ''),
].join('|');

const getSheetInventoryIdentity = (item: Record<string, any> | null | undefined) => {
  if (!item || typeof item !== 'object') return { id: '', stackKey: '', name: '' };
  const stackKey = normalizeSheetStackText(item.stackKey || item.stack_key) || getSheetInventoryStackKey(item);
  return {
    id: getSheetInventoryItemId(item),
    stackKey,
    name: normalizeSheetStackText(item.name || item.nome || item.label),
  };
};

const isSameSheetInventoryItem = (entry: Record<string, any>, rawItem: Record<string, any>) => {
  const entryIdentity = getSheetInventoryIdentity(entry);
  const itemIdentity = getSheetInventoryIdentity(rawItem);
  if (entryIdentity.id && itemIdentity.id && entryIdentity.id === itemIdentity.id) return true;

  // inventoryItemId/id pode vir da pilha original do outro jogador.
  // Se for diferente, ainda comparamos stackKey/nome para somar itens iguais
  // recebidos por troca/doacao em vez de criar pilha duplicada.
  if (entryIdentity.stackKey && itemIdentity.stackKey && entryIdentity.stackKey === itemIdentity.stackKey) return true;
  return Boolean(entryIdentity.name && itemIdentity.name && entryIdentity.name === itemIdentity.name);
};

const compactSheetInventoryBag = (rawBag: unknown[]) => {
  const byKey = new Map<string, Record<string, any>>();
  const result: Record<string, any>[] = [];

  for (const rawItem of rawBag) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = { ...(rawItem as Record<string, any>) };
    const identity = getSheetInventoryIdentity(item);
    const key = identity.stackKey ? `stack:${identity.stackKey}` : (identity.name ? `name:${identity.name}` : `id:${identity.id}`);
    const current = byKey.get(key);
    if (!current) {
      item.qty = Math.max(1, Number(item.qty) || 1);
      byKey.set(key, item);
      result.push(item);
    } else {
      current.qty = Math.max(1, Number(current.qty) || 1) + Math.max(1, Number(item.qty) || 1);
    }
  }

  return result;
};

const findSheetInventoryItemIndex = (bag: Record<string, any>[], rawItem: Record<string, any>) => {
  const item = rawItem || {};
  const byIdentity = bag.findIndex((entry) => isSameSheetInventoryItem(entry, item));
  return byIdentity;
};

const mergeSheetInventoryItemIntoBag = (rawBag: unknown[], rawItem: Record<string, any>, rawQty = 1) => {
  const bag = compactSheetInventoryBag(Array.isArray(rawBag) ? rawBag : []);
  const item: Record<string, any> = { ...(rawItem || {}), qty: Math.max(1, Math.floor(Number(rawQty) || 1)) };
  const existingIndex = findSheetInventoryItemIndex(bag, item);

  if (existingIndex >= 0) {
    bag[existingIndex] = {
      ...item,
      ...bag[existingIndex],
      qty: Math.max(1, Number(bag[existingIndex].qty) || 1) + Math.max(1, Number(item.qty) || 1),
    };
    return bag;
  }

  return [...bag, item];
};

const removeSheetInventoryItemFromBag = (rawBag: unknown[], rawItem: Record<string, any>, rawQty = 1) => {
  const bag = compactSheetInventoryBag(Array.isArray(rawBag) ? rawBag : []);
  const item: Record<string, any> = { ...(rawItem || {}), qty: Math.max(1, Math.floor(Number(rawQty) || 1)) };
  const existingIndex = findSheetInventoryItemIndex(bag, item);

  if (existingIndex < 0) return bag;

  const currentQty = Math.max(0, Number(bag[existingIndex]?.qty) || 0);
  const removeQty = Math.max(1, Number(rawQty) || 1);
  const nextQty = currentQty - removeQty;

  if (nextQty <= 0) {
    return bag.filter((_, index) => index !== existingIndex);
  }

  bag[existingIndex] = { ...bag[existingIndex], qty: nextQty };
  return bag;
};


const removeSheetInventoryItemFromEquipment = (rawEquipment: unknown, rawItem: Record<string, any>, rawQty = 1) => {
  const equipment = normalizeSheetEquipment(rawEquipment);
  const item: Record<string, any> = { ...(rawItem || {}), qty: Math.max(1, Math.floor(Number(rawQty) || 1)) };
  const removeQty = Math.max(1, Number(rawQty) || 1);
  const bag = compactSheetInventoryBag(equipment.bag || []);
  const existingIndex = findSheetInventoryItemIndex(bag, item);
  const slots = equipment.slots && typeof equipment.slots === 'object' ? { ...equipment.slots } : {};

  if (existingIndex >= 0) {
    const currentQty = Math.max(0, Number(bag[existingIndex]?.qty) || 0);
    const nextQty = currentQty - removeQty;
    if (nextQty <= 0) bag.splice(existingIndex, 1);
    else bag[existingIndex] = { ...bag[existingIndex], qty: nextQty };
    return { ...equipment, bag, slots };
  }

  const normalizedName = normalizeSheetStackText(item.name || item.nome || item.label);
  for (const [slotName, rawSlotItem] of Object.entries(slots)) {
    const slotItem = rawSlotItem as any;
    if (!slotItem || normalizeSheetStackText(slotItem.name || slotItem.nome || slotItem.label) !== normalizedName) continue;
    const currentQty = Math.max(1, Number(slotItem.qty) || 1);
    const nextQty = currentQty - removeQty;
    if (nextQty <= 0) (slots as any)[slotName] = null;
    else (slots as any)[slotName] = { ...slotItem, qty: nextQty };
    return { ...equipment, bag, slots };
  }

  return { ...equipment, bag, slots };
};

const applySheetInventoryDeltaToEquipment = (
  rawEquipment: unknown,
  delta: { mode?: string; item?: Record<string, any>; qty?: number } | null | undefined,
) => {
  const equipment = normalizeSheetEquipment(rawEquipment);
  if (!delta?.item || typeof delta.item !== 'object') return equipment;
  const mode = String(delta.mode || '').toLowerCase();
  const qty = Math.max(1, Math.floor(Number(delta.qty ?? (delta.item as any).qty ?? 1) || 1));
  if (mode === 'add' || mode === 'transfer_in') {
    return {
      ...equipment,
      bag: mergeSheetInventoryItemIntoBag(equipment.bag, delta.item, qty),
    };
  }
  if (mode === 'remove' || mode === 'transfer_out') {
    return removeSheetInventoryItemFromEquipment(equipment, delta.item, qty);
  }
  return equipment;
};

const getSheetInventoryItemQtyFromEquipment = (rawEquipment: unknown, rawItem: Record<string, any> | null | undefined) => {
  if (!rawItem || typeof rawItem !== 'object') return 0;
  const equipment = normalizeSheetEquipment(rawEquipment);
  const bag = compactSheetInventoryBag(Array.isArray(equipment.bag) ? equipment.bag : []);
  let total = 0;
  for (const entry of bag) {
    if (isSameSheetInventoryItem(entry, rawItem)) total += Math.max(0, Number(entry.qty) || 0);
  }
  const slots = equipment.slots && typeof equipment.slots === 'object' ? equipment.slots : {};
  for (const rawSlotItem of Object.values(slots)) {
    const slotItem = rawSlotItem as any;
    if (slotItem && isSameSheetInventoryItem(slotItem, rawItem)) total += Math.max(1, Number(slotItem.qty) || 1);
  }
  return total;
};

const getSheetTradeDeltaSignedQty = (delta: { mode?: string; item?: Record<string, any>; qty?: number } | null | undefined) => {
  if (!delta?.item || typeof delta.item !== 'object') return 0;
  const qty = Math.max(1, Math.floor(Number(delta.qty ?? (delta.item as any).qty ?? 1) || 1));
  const mode = String(delta.mode || '').toLowerCase();
  if (mode === 'add' || mode === 'transfer_in') return qty;
  if (mode === 'remove' || mode === 'transfer_out') return -qty;
  return 0;
};

const repairTradeCommitEquipmentFromDeltas = (
  currentEquipment: unknown,
  _incomingEquipment: unknown,
  deltas: Array<{ mode?: string; item?: Record<string, any>; qty?: number }>,
) => {
  const current = normalizeSheetEquipment(currentEquipment);
  if (!Array.isArray(deltas) || deltas.length === 0) return current;

  const validDeltas = deltas.filter((delta) => (
    delta?.item &&
    typeof delta.item === 'object' &&
    getSheetTradeDeltaSignedQty(delta) !== 0
  ));
  if (validDeltas.length === 0) return current;

  // v74: trade_commit/trade_result sao transacoes deterministicas.
  // O snapshot/equipment do evento pode estar atrasado, compactado ou misturado
  // com outro estado. A fonte de verdade da troca sao os deltas oficiais.
  return normalizeSheetEquipment(
    validDeltas.reduce((equipment, delta) => (
      applySheetInventoryDeltaToEquipment(equipment, delta)
    ), current)
  );
};


const resolveSheetInventoryPatchEquipment = (
  currentEquipment: unknown,
  incomingEquipment: unknown,
  deltas: Array<{ mode?: string; item?: Record<string, any>; qty?: number }>,
) => {
  const current = normalizeSheetEquipment(currentEquipment);
  const incoming = normalizeSheetEquipment(incomingEquipment);
  const deltaBased = repairTradeCommitEquipmentFromDeltas(current, incoming, deltas);
  const validDeltas = Array.isArray(deltas)
    ? deltas.filter((delta) => delta?.item && typeof delta.item === 'object' && getSheetTradeDeltaSignedQty(delta) !== 0)
    : [];

  if (validDeltas.length === 0) return incoming;

  const incomingHasAnyState = incoming.bag.length > 0 || Object.values(incoming.slots || {}).some(Boolean);
  if (!incomingHasAnyState) return deltaBased;

  let incomingSatisfiesDeltas = true;
  for (const delta of validDeltas) {
    const item = delta.item as Record<string, any>;
    const signedQty = getSheetTradeDeltaSignedQty(delta);
    const qty = Math.abs(signedQty);
    const currentQty = getSheetInventoryItemQtyFromEquipment(current, item);
    const incomingQty = getSheetInventoryItemQtyFromEquipment(incoming, item);

    if (signedQty > 0) {
      const expectedMin = currentQty > 0 ? currentQty + qty : qty;
      if (incomingQty < expectedMin) {
        incomingSatisfiesDeltas = false;
        break;
      }
    } else if (signedQty < 0) {
      const expectedMax = currentQty >= qty ? currentQty - qty : currentQty;
      if (incomingQty > expectedMax) {
        incomingSatisfiesDeltas = false;
        break;
      }
    }
  }

  return incomingSatisfiesDeltas ? incoming : deltaBased;
};


const findSelfLanPlayerInPayload = (
  payload: LanSessionPayload | null | undefined,
  sessionId: string,
  characterLike: { id?: unknown; name?: unknown } | null | undefined,
) => {
  const players = payload?.state?.players || [];
  if (!payload || !sessionId || !characterLike || players.length <= 0) return null;
  const selfKey = makeLanCharacterKey(sessionId, characterLike as any);
  const characterName = String((characterLike as any)?.name || '').trim();

  // Em cada celular o personagem local frequentemente tem id=1.
  // Portanto, sourceCharacterId/characterId sozinho NÃO identifica o jogador na LAN
  // quando existem 2+ jogadores. A identidade estável é remoteKey; depois nome.
  return (
    players.find((player: any) => player?.remoteKey && player.remoteKey === selfKey) ||
    (characterName ? players.find((player: any) => String(player?.characterName || player?.playerName || '') === characterName) : null) ||
    (players.length === 1
      ? players.find((player: any) => (
          player?.sourceCharacterId === Number((characterLike as any).id) ||
          player?.characterId === Number((characterLike as any).id)
        ))
      : null) ||
    null
  );
};

const inferSheetInventoryItemDelta = (baseEquipment: any, nextEquipment: any) => {
  const base = normalizeSheetEquipment(baseEquipment);
  const next = normalizeSheetEquipment(nextEquipment);
  const nextByKey = new Map(next.bag.map((item: any) => [getSheetInventoryStackKey(item), item]));
  for (const baseItem of base.bag) {
    const key = getSheetInventoryStackKey(baseItem);
    const nextItem = nextByKey.get(key) as any;
    const beforeQty = Math.max(0, Number((baseItem as any)?.qty || 0));
    const afterQty = Math.max(0, Number(nextItem?.qty || 0));
    if (afterQty < beforeQty) {
      return {
        mode: 'remove' as const,
        item: { ...(baseItem as any), qty: beforeQty - afterQty },
        qty: beforeQty - afterQty,
        stackKey: key,
      };
    }
  }
  return null;
};


const normalizeSheetEquipment = (value: unknown) => {
  const parsed = safeJsonParse<any>(value, {});

  if (Array.isArray(parsed)) {
    return { bag: compactSheetInventoryBag(parsed), slots: { ...DEFAULT_SLOTS } };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { bag: [], slots: { ...DEFAULT_SLOTS } };
  }

  return {
    ...parsed,
    bag: compactSheetInventoryBag(Array.isArray(parsed.bag) ? parsed.bag : []),
    slots: { ...DEFAULT_SLOTS, ...(parsed.slots || {}) },
  };
};

const getSheetEquipmentFingerprint = (value: unknown) => JSON.stringify(normalizeSheetEquipment(value));



const addSheetEquipBonus = (target: Record<string, number>, attrRaw: unknown, rawValue: unknown) => {
  const attr = String(attrRaw || '').toUpperCase();
  if (!['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(attr)) return;
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value) || value === 0) return;
  target[attr] = (target[attr] || 0) + value;
};

const getSheetEquipBonusFromItem = (item: any) => {
  const bonuses: Record<string, number> = {};
  if (!item || typeof item !== 'object') return bonuses;

  const parsed = safeJsonParse<any>(item.effect_json || item.effectJson, null);
  const effects = Array.isArray(parsed?.effects) ? parsed.effects : Array.isArray(parsed) ? parsed : [];
  const hasStructuredEquipEffects = effects.some((effect: any) => {
    const target = String(effect?.target || '').toUpperCase();
    if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) return false;
    const kind = String(effect?.kind || effect?.type || '').toLowerCase();
    return ['stat', 'attribute', 'atributo'].includes(kind) || ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(target);
  });

  // v54: itens criados no avançado duplicam o bônus no texto e no effect_json.
  // Para equipamento, effect_json vence; texto é fallback para itens antigos.
  if (!hasStructuredEquipEffects) {
    const text = String(item.damage || item.effect || '');
    const lower = text.toLowerCase();
    if (!lower.includes('perm') && !lower.includes('temp')) {
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)/gi;
      for (const match of text.matchAll(statRegex)) {
        addSheetEquipBonus(bonuses, match[1], parseInt(String(match[2]).replace('+', ''), 10));
      }
    }
  }

  for (const effect of effects) {
    const target = String(effect?.target || '').toUpperCase();
    if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) continue;
    const kind = String(effect?.kind || effect?.type || '').toLowerCase();
    if (!['stat', 'attribute', 'atributo'].includes(kind) && !['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(target)) continue;
    const durationText = String(effect?.durationText || '').toLowerCase();
    const durationUnit = String(effect?.durationUnit || effect?.duration_unit || '').toLowerCase();
    // Equipamento só deriva bônus enquanto equipado quando o efeito não tem duração.
    // Consumíveis permanentes/temporários são tratados no fluxo de consumo.
    if (durationText.includes('temp') || durationText.includes('perm') || ['turn', 'round', 'minute', 'hour', 'day', 'rest', 'short_rest', 'long_rest', 'permanent'].includes(durationUnit)) continue;
    addSheetEquipBonus(bonuses, target, effect?.value ?? effect?.amount);
  }
  return bonuses;
};

const deriveSheetEquipModsFromEquipment = (equipment: any) => {
  const mods: Record<string, number> = {};
  const slots = equipment?.slots && typeof equipment.slots === 'object' ? equipment.slots : {};
  for (const item of Object.values(slots)) {
    if (!item) continue;
    const bonuses = getSheetEquipBonusFromItem(item);
    for (const [stat, value] of Object.entries(bonuses)) {
      mods[stat] = (mods[stat] || 0) + Number(value || 0);
    }
  }
  Object.keys(mods).forEach((key) => { if (!mods[key]) delete mods[key]; });
  return mods;
};

const buildSheetStatsWithDerivedEquipMods = (stats: Record<string, any> | null | undefined, equipment: any) => {
  const nextStats: Record<string, any> = { ...(stats || {}) };
  const derived = deriveSheetEquipModsFromEquipment(normalizeSheetEquipment(equipment));
  if (Object.keys(derived).length > 0) nextStats.equip_mods = derived;
  else delete nextStats.equip_mods;
  return nextStats;
};

function lanDomainEffectToSheetEffect(effect: any) {
  const id = String(effect?.effectId || effect?.id || effect?.sourceId || `lan_fx_${Date.now()}`);
  return {
    id,
    lanEffectId: id,
    name: String(effect?.name || 'Efeito'),
    status: effect?.kind === 'status' ? String(effect?.name || effect?.status || '') : effect?.status,
    statusKey: effect?.statusKey || effect?.status || (effect?.kind === 'status' ? id : undefined),
    target: normalizeLanEffectTarget(effect?.target || 'custom'),
    value: Math.floor(Number(effect?.value || 0)),
    remaining: Math.max(0, Math.floor(Number(effect?.remaining || 0))),
    unit: normalizeLanEffectUnit(effect?.unit || 'manual'),
    durationText: effect?.durationText || '',
    kind: effect?.kind,
    mode: effect?.mode === 'set' ? 'set' : 'add',
    source: effect?.source || effect?.sourceType || 'LAN',
    sourceType: effect?.sourceType || 'lan_session',
    sourceId: String(effect?.sourceId || id),
    color: effect?.color,
    secondaryColor: effect?.secondaryColor,
    visualPriority: effect?.visualPriority,
    origin: 'lan',
    visibleToPlayer: effect?.visibleToPlayer !== false,
  };
}

function lanCharacterToSheetPatch(character: CharacterProjection) {
  const activeEffects = character.activeEffects.map(lanDomainEffectToSheetEffect);
  return {
    name: character.name,
    level: character.level || 1,
    class: character.className || '',
    race: character.race || '',
    hp_current: character.hpCurrent,
    hp_max: character.hpMax,
    temp_hp: character.tempHp,
    xp: character.xp,
    gp: character.coins.gp,
    sp: character.coins.sp,
    cp: character.coins.cp,
    stats: {
      ...character.baseStats,
      temp_mods: {},
    },
    equipment: normalizeSheetEquipment(character.inventory || character.equipment),
    active_effects: activeEffects,
    active_effects_json: JSON.stringify(activeEffects),
  };
}

function authoritativeEventToSheetLanEvent(
  event: LanAuthoritativeEvent | null | undefined,
  input: { selfKey: string; characterName: string },
): LanSessionEvent | null {
  if (!event) return null;
  const payload = (event.payload || {}) as any;
  const seq = Math.max(1, Math.floor(Number(event.serverSeq || 0) || Date.now()));
  const base = {
    id: event.eventId,
    clientMsgId: event.commandId || event.eventId,
    sessionId: event.sessionId,
    seq,
    serverSeq: seq,
    fromKey: input.selfKey,
    fromName: input.characterName,
    toKey: 'master',
    toName: 'Mestre',
    entityType: event.aggregateType,
    entityId: event.aggregateId,
    entityRevision: event.aggregateRevision,
    ackRequired: true,
    originClientId: input.selfKey,
    createdAt: event.createdAt,
  } satisfies Partial<LanSessionEvent>;

  if (['character_transaction', 'party_transaction', 'spell_transaction', 'reward_transaction'].includes(event.type)) {
    return ({
      ...base,
      type: event.type as any,
      targetKey: payload.targetKey || input.selfKey,
      changes: payload.changes,
      rolls: payload.rolls,
      characterTransaction: payload,
      message: payload.message || `${input.characterName} atualizou a ficha.`,
    } as unknown) as LanSessionEvent;
  }

  return null;
}

export default function CharacterSheetScreen() {
  const { id, sessionId, joinUrl } = useLocalSearchParams<{ id?: string; sessionId?: string; joinUrl?: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const routeSessionId = firstParam(sessionId);
  const routeJoinUrl = decodeParam(firstParam(joinUrl));

  const [activeTab, setActiveTab] = useState<'stats' | 'profs' | 'inv' | 'spells'>('stats');
  const [character, setCharacter] = useState<any>(null);
  
  const [spellDetails, setSpellDetails] = useState<any[]>([]);
  const [dbItemsCatalog, setDbItemsCatalog] = useState<any[]>([]);
  const [dbSkills, setDbSkills] = useState<any[]>([]);
  const [dbSaves, setDbSaves] = useState<any[]>([]);
  
  const [charRaceSpeed, setCharRaceSpeed] = useState('9m');
  const [charHasSpells, setCharHasSpells] = useState(false);

  const [loading, setLoading] = useState(true);

  // Estados de Modais e Inventário
  const [xpModalVisible, setXpModalVisible] = useState(false);
  const [hpModalVisible, setHpModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [coinModalVisible, setCoinModalVisible] = useState(false);
  const [activeCoinType, setActiveCoinType] = useState<'gp' | 'sp' | 'cp'>('gp');
  const [inputValue, setInputValue] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  // Sistema de Câmbio de Moedas
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [convertFrom, setConvertFrom] = useState<'gp' | 'sp' | 'cp'>('sp');
  const [convertTo, setConvertTo] = useState<'gp' | 'sp' | 'cp'>('gp');
  const [convertAmount, setConvertAmount] = useState('');

  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<keyof typeof DEFAULT_SLOTS | null>(null);
  const [levelUpModalVisible, setLevelUpModalVisible] = useState(false);
  const [newLevelData, setNewLevelData] = useState(0);
  const [expectedLevelByXp, setExpectedLevelByXp] = useState(1);
  const [nextLevelXpRequired, setNextLevelXpRequired] = useState<number | null>(null);

  // Estados do Menu de Ação
  const [selectedBagItem, setSelectedBagItem] = useState<{item: any, index: number} | null>(null);
  const [actionQty, setActionQty] = useState(1);
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});
  const [lanInfo, setLanInfo] = useState<{ sessionId: string; joinUrl: string; hostInstanceId?: string } | null>(null);
  const [lanSessionStatus, setLanSessionStatus] = useState<LanSessionStatus | null>(null);
  const [lanReconnectEpoch, setLanReconnectEpoch] = useState(0);
  const lanSessionStatusRef = useRef<LanSessionStatus | null>(null);
  const [lanPlayers, setLanPlayers] = useState<PublicLanPlayer[]>([]);
  const [publicEffectsModalPlayer, setPublicEffectsModalPlayer] = useState<PublicLanPlayer | null>(null);
  const sheetRuntimeMode = getSheetRuntimeMode({
    lanInfo,
    routeSessionId,
    routeJoinUrl,
  });
  const isLanPlayerRuntime = isLanPlayerMode(sheetRuntimeMode);
  const activeLanSessionId = isLanPlayerRuntime ? (lanInfo?.sessionId || routeSessionId || '') : '';
  const activeLanPlayerKey = activeLanSessionId && character ? makeLanCharacterKey(activeLanSessionId, character) : '';
  const lanProjectionState = useLanProjection(activeLanSessionId, activeLanPlayerKey);
  const lanProjection = lanProjectionState.projection;
  const lanCharacter = lanProjectionState.character;
  const isLanMode = Boolean(activeLanSessionId && activeLanPlayerKey);
  const visibleCharacterPatch = lanCharacter ? lanCharacterToSheetPatch(lanCharacter) : null;
  const visibleCharacter = visibleCharacterPatch && character ? { ...character, ...visibleCharacterPatch } : character;
  const visibleInventory = visibleCharacterPatch?.equipment || normalizeSheetEquipment(character?.equipment);
  const visibleEquipment = visibleInventory;
  const visibleEffects = visibleCharacterPatch?.active_effects || (
    Array.isArray(character?.active_effects)
      ? character.active_effects
      : safeJsonParse<any[]>(character?.active_effects_json, [])
  );
  const livePlayerStates = useLanRealtimeStore((state) => state.livePlayerStates);
  const liveLanEvents = useLanRealtimeStore((state) => state.liveEvents);
  const characterRef = useRef<any>(null);
  const lanPlayersRef = useRef<PublicLanPlayer[]>([]);
  const lastLanJoinNotifyRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const sessionTerminatedRef = useRef<string | null>(null);
  const handledSessionEventIdsRef = useRef<Set<string>>(new Set());
  const handledRuntimeLiveEventIdsRef = useRef<Set<string>>(new Set());
  const resolvedSaveRequestIdsRef = useRef<Set<string>>(new Set());
  const openedSaveRequestIdsRef = useRef<Set<string>>(new Set());
  const lastPausedAlertKeyRef = useRef<string>('');
  const lastSessionStatusAlertKeyRef = useRef<string>('');
  const lastHostUnavailableAlertKeyRef = useRef<{ sessionId: string; at: number }>({ sessionId: '', at: 0 });
  const lastLevelUpPromptKeyRef = useRef<string>('');
  const pendingLevelUpPromptKeyRef = useRef<string>('');
  const levelUpNavigationLockedRef = useRef(false);
  const pendingOutgoingItemSendsRef = useRef<Set<string>>(new Set());
  const pendingSelfCoinStateRef = useRef<{ gp: number; sp: number; cp: number; totalCopper: number; at: number; clientMsgId?: string; opSeq?: number } | null>(null);
  const coinPatchDebounceRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; event: LanSessionEvent | null; opSeq: number } | null>(null);
  const coinOptimisticSeqRef = useRef(0);
  const pendingSelfInventoryStateRef = useRef<{ equipment: any; statsPatch?: Record<string, unknown>; at: number; clientMsgId?: string } | null>(null);
  const inventoryPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const appliedInventoryTransactionIdsRef = useRef<Set<string>>(new Set());
  const lastAuthoritativeSnapshotInventoryRef = useRef<Record<string, { revision: number; fingerprint: string; at: number }>>({});
  const lastAuthoritativeSnapshotPlayerRef = useRef<Record<string, { revision: number; fingerprint: string; at: number }>>({});
  const pendingLanOutboundEventsRef = useRef<Record<string, LanSessionEvent>>({});
  const pendingLanOutboundFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInventoryPatchSentRef = useRef<{ fingerprint: string; at: number; clientMsgId?: string }>({ fingerprint: '', at: 0 });
  const lanRecoveryGateRef = useRef<{ at: number; reason: string }>({ at: 0, reason: '' });

  useEffect(() => {
    lanPlayersRef.current = lanPlayers;
  }, [lanPlayers]);

  useEffect(() => {
    if (!lanCharacter) return;
    const patch = lanCharacterToSheetPatch(lanCharacter);
    setCharacter((current: any) => {
      if (!current) return current;
      const merged = { ...current, ...patch };
      characterRef.current = merged;
      return merged;
    });
  }, [lanCharacter]);

  useEffect(() => {
    if (!LAN_ENGINE_PROJECTION_MODE || !lanProjection || !activeLanPlayerKey) return;
    const nextPlayers: PublicLanPlayer[] = Object.values(lanProjection.players || {}).map((entry) => ({
      key: entry.playerKey,
      playerName: entry.name || 'Jogador',
      characterName: entry.name || 'Jogador',
      level: Math.max(1, Math.floor(Number(entry.level || 1) || 1)),
      hpCurrent: Math.max(0, Math.floor(Number(entry.hpCurrent || 0) || 0)),
      hpMax: Math.max(0, Math.floor(Number(entry.hpMax || 0) || 0)),
      tempHp: Math.max(0, Math.floor(Number(entry.tempHp || 0) || 0)),
      publicEffects: summarizeEffectsForPublicRoster(entry.activeEffects || []),
      isSelf: entry.playerKey === activeLanPlayerKey,
      publicSeq: lanProjection.serverSeq,
      publicRevision: Math.max(
        lanProjection.versions.players[entry.playerKey] || 0,
        lanProjection.versions.effects[entry.playerKey] || 0,
        lanProjection.versions.inventories[entry.playerKey] || 0,
      ),
    }));
    setLanPlayers((current) => {
      const pick = (player: PublicLanPlayer) => ({
        key: player.key,
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        level: player.level,
        effects: player.publicEffects,
        isSelf: player.isSelf,
      });
      const currentFingerprint = JSON.stringify(current.map(pick));
      const nextFingerprint = JSON.stringify(nextPlayers.map(pick));
      return currentFingerprint === nextFingerprint ? current : nextPlayers;
    });
  }, [activeLanPlayerKey, lanProjection]);

  useEffect(() => {
    if (!publicEffectsModalPlayer) return;
    const latest = lanPlayers.find((player) => (
      player.key === publicEffectsModalPlayer.key ||
      player.characterName === publicEffectsModalPlayer.characterName
    ));
    if (latest && latest !== publicEffectsModalPlayer) {
      setPublicEffectsModalPlayer(latest);
    }
  }, [lanPlayers, publicEffectsModalPlayer]);

  const lastAuthoritativePlayerPatchRef = useRef<{ seq: number; entityRevision: number; appliedAt: number }>({
    seq: 0,
    entityRevision: 0,
    appliedAt: 0,
  });
  const lastAuthoritativeTempHpPatchRef = useRef<{ value: number; seq: number; entityRevision: number; appliedAt: number } | null>(null);
  const normalizeLanPlayerPatchRevision = useCallback((event?: LanSessionEvent) => {
    const raw = Number(event?.entityRevision || 0) || 0;
    const id = String(event?.id || '');
    // v94: eco de level-up usa seq temporal, mas revision autoritativa deve vir
    // de progressionPatch.revisionSeq para nao bloquear danos/curas seguintes.
    if (event?.type === 'player_patch' && String((event as any)?.numberPatchIntent || '') === 'level_up_authoritative_echo') {
      const progressionRevision = Number((event as any)?.progressionPatch?.revisionSeq || 0) || 0;
      if (progressionRevision > 0) return progressionRevision;
    }
    // v33: checkpoints legados podem vir com revision baseada em Date.now().
    // Se essa revision for gravada como última autoritativa, todos os danos revision=1..N são tratados como antigos.
    if (event?.type === 'player_patch' && id.startsWith('checkpoint_player_') && raw > 1000000 && (event as any).authoritativeCheckpoint !== true) {
      return 0;
    }
    return raw;
  }, []);


  useEffect(() => {
    if (LAN_ENGINE_PROJECTION_MODE) return;
    if (!isLanPlayerRuntime || !character?.id || !lanInfo?.sessionId) return;
    const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
    const liveState = livePlayerStates[`${lanInfo.sessionId}:${selfKey}`];
    if (!liveState) return;
    if (liveState.characterId && Number(liveState.characterId) !== Number(character.id)) return;

    const nextPatch: Record<string, unknown> = {};
    if (liveState.hp_current != null) nextPatch.hp_current = liveState.hp_current;
    if (liveState.hp_max != null) nextPatch.hp_max = liveState.hp_max;
    if (liveState.temp_hp != null) nextPatch.temp_hp = liveState.temp_hp;
    if (liveState.xp != null) nextPatch.xp = liveState.xp;
    if (liveState.gp != null) nextPatch.gp = liveState.gp;
    if (liveState.sp != null) nextPatch.sp = liveState.sp;
    if (liveState.cp != null) nextPatch.cp = liveState.cp;
    if (liveState.level != null) nextPatch.level = liveState.level;
    if (liveState.class != null) nextPatch.class = liveState.class;
    if (liveState.race != null) nextPatch.race = liveState.race;
    if (liveState.stats != null) nextPatch.stats = typeof liveState.stats === 'string' ? safeJsonParse<Record<string, any>>(liveState.stats, character.stats || {}) : liveState.stats;
    if ((liveState as any).equipment != null) {
      const pendingInventory = pendingSelfInventoryStateRef.current;
      const pendingIsRecent = Boolean(pendingInventory && Date.now() - pendingInventory.at < 15000);
      const liveEquipment = normalizeSheetEquipment((liveState as any).equipment);
      const pendingFingerprint = pendingInventory ? getSheetEquipmentFingerprint(pendingInventory.equipment) : '';
      const liveFingerprint = getSheetEquipmentFingerprint(liveEquipment);
      if (pendingIsRecent && pendingFingerprint && pendingFingerprint !== liveFingerprint) {
        debugLanFlow('PLAYER_LIVE_EQUIPMENT_SKIPPED_DURING_PENDING_SELF_PATCH', {
          sessionId: lanInfo.sessionId,
          selfKey,
          characterId: character.id,
        });
      } else {
        if (pendingIsRecent && pendingFingerprint === liveFingerprint) pendingSelfInventoryStateRef.current = null;
        nextPatch.equipment = liveEquipment;
      }
    }
    // v100: o runtime global tambem e o dono dos efeitos/condicoes. Na v99 a ficha
    // assinava HP/XP/nivel do store vivo, mas ignorava active_effects; como o hook
    // antigo foi desligado (single writer), condicoes podiam aparecer no card/snapshot
    // e sumir/nao refletir corretamente dentro da ficha.
    let liveEffectsFromRuntime: any[] | null = null;
    if (Array.isArray((liveState as any).active_effects)) {
      liveEffectsFromRuntime = (liveState as any).active_effects;
    } else if ((liveState as any).active_effects_json != null) {
      liveEffectsFromRuntime = safeJsonParse<any[]>((liveState as any).active_effects_json, []);
    }
    if (liveEffectsFromRuntime) {
      const activeRuntimeEffects = filterRenderableLanEffects(liveEffectsFromRuntime);
      const syncedEffects = liveState.temp_hp != null
        ? syncTempHpEffectsLocallyWithNumber(activeRuntimeEffects, Number(liveState.temp_hp || 0)).effects
        : activeRuntimeEffects;
      nextPatch.active_effects = syncedEffects;
      nextPatch.active_effects_json = JSON.stringify(syncedEffects);
    }
    if (Object.keys(nextPatch).length === 0) return;

    const currentRevision = Number(lastAuthoritativePlayerPatchRef.current.entityRevision || 0) || 0;
    const liveRevision = Number(liveState.revision || 0) || 0;
    const liveSeq = Number(liveState.seq || 0) || 0;
    const currentSeq = Number(lastAuthoritativePlayerPatchRef.current.seq || 0) || 0;
    const hasRuntimeEffectsPatch = Object.prototype.hasOwnProperty.call(nextPatch, 'active_effects');
    const hasRuntimeStatsPatch = Object.prototype.hasOwnProperty.call(nextPatch, 'stats');
    // v104: revisoes de player/effect/stats podem caminhar em entidades diferentes,
    // mas a ficha usava um unico lastAuthoritativePlayerPatchRef. Isso podia ignorar
    // remocao de efeito ou statsPatch se um player_patch numerico mais novo ja tivesse
    // elevado a revision local. Seq mais novo vindo do runtime global deve vencer.
    if (liveRevision > 0 && currentRevision > liveRevision && liveSeq <= currentSeq && !hasRuntimeEffectsPatch && !hasRuntimeStatsPatch) return;

    setCharacter((prev: any) => {
      if (!prev) return prev;
      const same = Object.entries(nextPatch).every(([key, value]) => JSON.stringify(prev?.[key]) === JSON.stringify(value));
      if (same) return prev;
      const merged = { ...prev, ...nextPatch };
      characterRef.current = merged;
      return merged;
    });

    if (nextPatch.xp != null && Number(nextPatch.xp || 0) !== Number(character?.xp || 0)) {
      const xpForPrompt = Math.max(0, Math.floor(Number(nextPatch.xp || 0)));
      void (async () => {
        const currentCharacter = characterRef.current || character;
        const currentLevel = Math.max(
          1,
          Number(currentCharacter?.level || 0) || 0,
          inferTotalLevelFromClassName(currentCharacter?.class)
        );
        const expectedLevelAfterXp = await getExpectedLevelForXpFromDb(db, xpForPrompt).catch(() => currentLevel);
        const promptKey = `${Number(currentCharacter?.id || character.id)}:level:${expectedLevelAfterXp}`;
        if (
          expectedLevelAfterXp > currentLevel &&
          !levelUpModalVisible &&
          !levelUpNavigationLockedRef.current &&
          lastLevelUpPromptKeyRef.current !== promptKey &&
          pendingLevelUpPromptKeyRef.current !== promptKey
        ) {
          pendingLevelUpPromptKeyRef.current = promptKey;
          lastLevelUpPromptKeyRef.current = promptKey;
          setNewLevelData(expectedLevelAfterXp);
          setLevelUpModalVisible(true);
          debugLanFlow('PLAYER_LEVEL_UP_PROMPT_OPENED_FROM_GLOBAL_RUNTIME_V105', {
            sessionId: lanInfo.sessionId,
            characterId: character.id,
            xp: xpForPrompt,
            currentLevel,
            expectedLevelAfterXp,
          });
        }
      })();
    }

    lastAuthoritativePlayerPatchRef.current = {
      seq: Math.max(Number(lastAuthoritativePlayerPatchRef.current.seq || 0) || 0, liveSeq),
      entityRevision: Math.max(currentRevision, liveRevision),
      appliedAt: Date.now(),
    };
    debugLanFlow('PLAYER_SHEET_LIVE_GLOBAL_STATE_APPLIED_V98', {
      sessionId: lanInfo.sessionId,
      selfKey,
      characterId: character.id,
      revision: liveRevision,
      seq: liveSeq,
      hpCurrent: nextPatch.hp_current,
      hpMax: nextPatch.hp_max,
      xp: nextPatch.xp,
      activeEffectCount: Array.isArray((nextPatch as any).active_effects) ? (nextPatch as any).active_effects.length : undefined,
    });
  }, [character?.id, character?.name, character?.xp, db, isLanPlayerRuntime, lanInfo?.sessionId, levelUpModalVisible, livePlayerStates]);

  const getAuthoritativeTempHpPatchForEffectEvent = useCallback((event?: LanSessionEvent) => {
    const lastPatch = lastAuthoritativeTempHpPatchRef.current;
    if (!lastPatch) return null;

    const eventRevision = Number(event?.entityRevision || 0) || 0;
    const eventSeq = Number(event?.seq ?? event?.serverSeq ?? 0) || 0;
    if (eventRevision > 0 && lastPatch.entityRevision > 0) {
      return eventRevision <= lastPatch.entityRevision ? lastPatch : null;
    }
    if (eventSeq > 0 && lastPatch.seq > 0) {
      return eventSeq <= lastPatch.seq ? lastPatch : null;
    }
    return null;
  }, []);

  const [incomingTrades, setIncomingTrades] = useState<LanSessionEvent[]>([]);
  const [targetPickerMode, setTargetPickerMode] = useState<'send' | 'trade' | null>(null);
  const [selectedTradeOffer, setSelectedTradeOffer] = useState<LanSessionEvent | null>(null);
  const [tradeCounterItem, setTradeCounterItem] = useState<{item: any, index: number} | null>(null);
  const [tradeCounterQty, setTradeCounterQty] = useState(1);
  const [spellCastVisible, setSpellCastVisible] = useState(false);
  const [spellTargetKeys, setSpellTargetKeys] = useState<string[]>([]);
  const [spellTargetAmounts, setSpellTargetAmounts] = useState<Record<string, string>>({});
  const [spellTargetAttackRolls, setSpellTargetAttackRolls] = useState<Record<string, string>>({});
  const [spellRollResult, setSpellRollResult] = useState('');
  const [spellRollMode, setSpellRollMode] = useState<'virtual' | 'manual'>('manual');
  const [spellAttackRollResult, setSpellAttackRollResult] = useState('');
  const [spellAttackRollMode, setSpellAttackRollMode] = useState<'virtual' | 'manual'>('manual');
  const [spellDicePurpose, setSpellDicePurpose] = useState<'damage' | 'attack'>('damage');
  const [spellEffectTarget, setSpellEffectTarget] = useState<LanEffectTarget>('custom');
  const [spellEffectValue, setSpellEffectValue] = useState('0');
  const [pendingEffectSave, setPendingEffectSave] = useState<NonNullable<LanSessionEvent['saveRequest']> | null>(null);
  const [saveManualValue, setSaveManualValue] = useState('');
  const [submittingSheetActions, setSubmittingSheetActions] = useState<string[]>([]);
  const submittingSheetActionsRef = useRef<Set<string>>(new Set());

  // Sistema de Buffs Temporários
  const [tempBuffModalVisible, setTempBuffModalVisible] = useState(false);
  const [activeBuffStat, setActiveBuffStat] = useState('');
  const [tempBuffValue, setTempBuffValue] = useState('');

  useEffect(() => {
    const tag = 'ficha-dnd-lan-player-active';
    const shouldKeepAwake = Boolean(
      lanInfo?.sessionId &&
      lanSessionStatus !== 'paused' &&
      lanSessionStatus !== 'ended'
    );

    if (!shouldKeepAwake) return;

    void activateKeepAwakeAsync(tag).catch((error) => {
      debugLanFlow('PLAYER_KEEP_AWAKE_ACTIVATE_FAILED', {
        sessionId: lanInfo?.sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    debugLanFlow('PLAYER_KEEP_AWAKE_ACTIVE', {
      sessionId: lanInfo?.sessionId,
      status: lanSessionStatus,
    });

    return () => {
      try {
        deactivateKeepAwake(tag);
      } catch {
        // keep-awake cleanup is best-effort.
      }
    };
  }, [lanInfo?.sessionId, lanSessionStatus]);

  // Filtros de Magia
  const [spellSearch, setSpellSearch] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('Todos');
  const [spellEffectFilter, setSpellEffectFilter] = useState('Todos');
  const [spellSortOrder, setSpellSortOrder] = useState<'A-Z' | 'Z-A'>('A-Z');
  const [diceRollRequest, setDiceRollRequest] = useState<DiceRollRequest | undefined>();
  const [diceValuePrompt, setDiceValuePrompt] = useState<{
    visible: boolean;
    title: string;
    message: string;
    formula: string;
    qty: number;
    manualValue: string;
  }>({ visible: false, title: '', message: '', formula: '', qty: 1, manualValue: '' });
  const pendingDiceValueResolverRef = useRef<((result: DiceValueResolution | null) => void) | null>(null);
  const pendingVisualDiceValueRef = useRef<{
    parsed: ParsedDiceFormula;
    resolve: (result: DiceValueResolution | null) => void;
  } | null>(null);
  const [effectFrame, setEffectFrame] = useState(0);
  
  // Estado para o Detalhe da Magia e Animação
  const [selectedSpell, setSelectedSpell] = useState<any>(null);
  const spellScaleAnim = useRef(new Animated.Value(0.85)).current;
  const spellFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // v108: tick de 50ms para fade real. O service mantém 2s por efeito,
    // mas faz fade in / hold / fade out entre as cores.
    const timer = setInterval(() => setEffectFrame((frame) => frame + 1), 50);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  useEffect(() => {
    lanSessionStatusRef.current = lanSessionStatus;
  }, [lanSessionStatus]);

  useEffect(() => {
    if (!character) return;
    let disposed = false;

    const refreshXpProgression = async () => {
      try {
        await seedDefaultXpProgression(db);
        const xpValue = Number(character.xp) || 0;
        const currentLevel = Number(character.level) || 1;
        const [nextExpectedLevel, nextRequiredXp] = await Promise.all([
          getExpectedLevelForXpFromDb(db, xpValue),
          getXpRequiredForLevel(db, currentLevel + 1),
        ]);

        if (!disposed) {
          setExpectedLevelByXp(nextExpectedLevel);
          setNextLevelXpRequired(nextRequiredXp);
        }
      } catch (error) {
        console.warn('[XP] Nao foi possivel carregar progressao de XP:', error);
      }
    };

    void refreshXpProgression();
    return () => {
      disposed = true;
    };
  }, [db, character?.xp, character?.level]);

  useEffect(() => {
    if (!character?.id) return;
    debugLanFlow('SHEET_RUNTIME_MODE', {
      characterId: character.id,
      characterName: character.name,
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId || routeSessionId || '',
      joinUrl: lanInfo?.joinUrl || routeJoinUrl || '',
    });
  }, [character?.id, character?.name, sheetRuntimeMode, lanInfo?.sessionId, lanInfo?.joinUrl, routeSessionId, routeJoinUrl]);

  // Nao derrube o socket LAN ao desmontar a tela da ficha.
  // O jogador pode voltar para a Home/index e reabrir a ficha vinculada;
  // se fecharmos a conexao aqui, o host perde o bind socket -> playerKey
  // e o tempo real passa a depender de snapshot/reload.
  useEffect(() => () => {
    // limpeza real ocorre apenas em kick/session_ended/troca de papel.
  }, []);

  useEffect(() => {
    if (selectedSpell) {
      spellScaleAnim.setValue(0.9);
      spellFadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(spellFadeAnim, {
          toValue: 1,
          duration: 150, 
          useNativeDriver: true,
        }),
        Animated.spring(spellScaleAnim, {
          toValue: 1,
          friction: 7, 
          tension: 60,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [selectedSpell]);

  const showCustomAlert = useCallback((title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string}[]) => {
    setCustomAlert({ visible: true, title, message, buttons: buttons || [{ text: 'OK', color: appColors.primary }] });
  }, []);

  const terminateLanSessionFastFromLiveEvent = useCallback((sessionValue: string, source: string, event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current || character;
    if (!currentCharacter?.id || !sessionValue) return;
    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);

    sessionTerminatedRef.current = sessionValue;
    setLanSessionStatus(null);
    setLanInfo(null);
    setLanPlayers([]);
    setIncomingTrades([]);
    setPendingEffectSave(null);
    setSaveManualValue('');
    useLanRealtimeStore.getState().resetSession(sessionValue);
    resetLanClientConnection();
    traceApp('LAN_JOIN', 'PLAYER_SESSION_TERMINATED_FROM_LIVE_EVENT_FAST_V109', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event?.id,
      eventType: event?.type,
    });
    router.replace('/' as any);

    void (async () => {
      try {
        if (event) await rememberLanSessionEvent(db, event).catch(() => false);
        const current = await db.getFirstAsync<Record<string, unknown>>(
          `SELECT active_effects_json FROM characters WHERE id = ?`,
          [Number(currentCharacter.id)]
        ).catch(() => null);
        const effects = safeJsonParse<any[]>((current as any)?.active_effects_json, []);
        const nextEffects = effects.filter((effect) => {
          const effectSessionId = String(effect?.sessionId || '');
          const isLanSessionEffect =
            (String(effect?.origin || '') === 'lan' && effectSessionId === sessionValue) ||
            (String(effect?.sourceType || '') === 'lan_session' && effectSessionId === sessionValue) ||
            (Boolean(effect?.lanEventId) && effectSessionId === sessionValue);
          return !isLanSessionEffect;
        });
        const nextTempHp = calculateStandardTempHpFromEffects(nextEffects);
        await db.runAsync(
          `UPDATE characters SET active_effects_json = ?, temp_hp = ? WHERE id = ?`,
          [JSON.stringify(nextEffects), nextTempHp, Number(currentCharacter.id)]
        ).catch(() => undefined);
        await unlinkCharacterFromLanSession(db, Number(currentCharacter.id), sessionValue).catch(() => undefined);
        await db.runAsync(
          `UPDATE lan_local_character_bindings
             SET is_active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`,
          [sessionValue]
        ).catch(() => undefined);
        await db.runAsync(
          `UPDATE lan_sessions
             SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [sessionValue]
        ).catch(() => undefined);
        traceApp('LAN_JOIN', 'PLAYER_SESSION_TERMINATION_PERSISTED_FROM_LIVE_EVENT_V109', {
          screen: 'sheet',
          source,
          sessionId: sessionValue,
          characterId: currentCharacter.id,
          characterName: currentCharacter.name,
          playerKey: selfKey,
        });
      } catch (error) {
        traceError('LAN_JOIN', 'PLAYER_SESSION_TERMINATION_FROM_LIVE_EVENT_FAILED_V109', error, {
          screen: 'sheet',
          source,
          sessionId: sessionValue,
          characterId: currentCharacter.id,
          characterName: currentCharacter.name,
          playerKey: selfKey,
        });
      }
    })();
  }, [character, db, router]);

  useEffect(() => {
    if (!isLanPlayerRuntime || !character?.id || !lanInfo?.sessionId) return;
    const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
    const notices = Object.values(liveLanEvents || {})
      .map((notice: any) => notice?.event as LanSessionEvent | undefined)
      .filter((event): event is LanSessionEvent => Boolean(event?.id && event.sessionId === lanInfo.sessionId))
      .filter((event) => {
        const toKey = String(event.toKey || '');
        const targetKey = String(event.saveRequest?.targetKey || event.pendingSavePatch?.save?.targetKey || event.inventoryPatch?.targetKey || '');
        return toKey === 'all' || toKey === selfKey || targetKey === selfKey || event.type === 'session_patch' || event.type === 'session_ended';
      })
      .sort((a, b) => Number(a.seq || a.serverSeq || 0) - Number(b.seq || b.serverSeq || 0));

    for (const event of notices) {
      const id = String(event.id || event.clientMsgId || '');
      const scopedId = `${lanInfo.sessionId}:${id}`;
      if (!id || handledRuntimeLiveEventIdsRef.current.has(scopedId)) continue;
      handledRuntimeLiveEventIdsRef.current.add(scopedId);

      if (event.type === 'session_ended') {
        debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED_FROM_LIVE_STORE_V109', {
          eventId: event.id,
          sessionId: lanInfo.sessionId,
          selfKey,
          source: 'liveLanEvents_single_writer',
        });
        terminateLanSessionFastFromLiveEvent(lanInfo.sessionId, 'liveLanEvents.session_ended', event);
        continue;
      }

      if (event.type === 'player_kicked' && (event.toKey === selfKey || event.toKey === 'all')) {
        debugLanFlow('PLAYER_KICKED_RECEIVED_FROM_LIVE_STORE_V109', {
          eventId: event.id,
          sessionId: lanInfo.sessionId,
          selfKey,
          source: 'liveLanEvents_single_writer',
        });
        terminateLanSessionFastFromLiveEvent(lanInfo.sessionId, 'liveLanEvents.player_kicked', event);
        continue;
      }

      if (event.type === 'effect_save_request' && event.saveRequest) {
        const saveId = String(event.saveRequest.id || '');
        if (!saveId || resolvedSaveRequestIdsRef.current.has(saveId) || openedSaveRequestIdsRef.current.has(saveId)) {
          debugLanFlow('PLAYER_EFFECT_SAVE_REQUEST_IGNORED_DUP_OR_RESOLVED_V106', { eventId: event.id, saveId });
          continue;
        }
        openedSaveRequestIdsRef.current.add(saveId);
        setPendingEffectSave(event.saveRequest);
        setSaveManualValue('');
        void rememberLanSessionEvent(db, event).catch(() => false);
        debugLanFlow('PLAYER_EFFECT_SAVE_REQUEST_RECEIVED_FROM_RUNTIME_V105', {
          eventId: event.id,
          requestId: event.saveRequest.id,
          sourceEffectName: event.saveRequest.sourceEffectName,
          saveAbility: event.saveRequest.saveAbility,
          dc: event.saveRequest.dc,
        });
        continue;
      }

      if (event.type === 'pending_save_patch' && event.pendingSavePatch) {
        void rememberLanSessionEvent(db, event).catch(() => false);
        const action = String(event.pendingSavePatch.action || '');
        if (action === 'create' && event.pendingSavePatch.save?.targetKey === selfKey) {
          const save = event.pendingSavePatch.save;
          const saveId = String(save.id || '');
          if (!saveId || resolvedSaveRequestIdsRef.current.has(saveId) || openedSaveRequestIdsRef.current.has(saveId)) {
            debugLanFlow('PLAYER_PENDING_SAVE_PATCH_CREATE_IGNORED_DUP_OR_RESOLVED_V106', { eventId: event.id, saveId });
            continue;
          }
          openedSaveRequestIdsRef.current.add(saveId);
          setPendingEffectSave({
            id: save.id,
            sourceEffectId: String(save.sourceId || ''),
            sourceEffectName: save.sourceName || 'Efeito',
            targetKey: save.targetKey,
            saveAbility: save.ability,
            dc: save.dc ?? null,
            rollMode: 'target_choice',
            saveOnSuccess: String((save.effectPayload as any)?.saveOnSuccess || (save.effectPayload as any)?.save?.onSuccess || 'negates'),
            pendingEffectPayload: save.effectPayload,
          });
          setSaveManualValue('');
          debugLanFlow('PLAYER_PENDING_SAVE_PATCH_MODAL_OPENED_FROM_RUNTIME_V105', {
            eventId: event.id,
            saveId: save.id,
            sourceName: save.sourceName,
            ability: save.ability,
            dc: save.dc,
          });
        } else if (action === 'resolve') {
          const resolvedId = String(
            event.pendingSavePatch.id ||
            event.pendingSavePatch.result?.requestId ||
            event.pendingSavePatch.save?.id ||
            ''
          );
          if (resolvedId) resolvedSaveRequestIdsRef.current.add(resolvedId);
          if (resolvedId) openedSaveRequestIdsRef.current.delete(resolvedId);
          setPendingEffectSave((current) => {
            if (!current) return current;
            return !resolvedId || current.id === resolvedId || current.sourceEffectId === resolvedId ? null : current;
          });
          setSaveManualValue('');
          debugLanFlow('PLAYER_PENDING_SAVE_PATCH_RESOLVED_AND_CLOSED_FROM_RUNTIME_V107', {
            eventId: event.id,
            saveId: resolvedId,
          });
        }
        continue;
      }

      if (event.type === 'session_patch') {
        const status = event.sessionPatch?.status;
        if (status === 'paused' || status === 'active') {
          const previousStatus = lanSessionStatusRef.current;
          const alertKey = `${lanInfo.sessionId}:${event.id || event.entityRevision || event.seq}:${status}`;
          setLanSessionStatus(status);
          lanSessionStatusRef.current = status;
          if (lastSessionStatusAlertKeyRef.current !== alertKey) {
            lastSessionStatusAlertKeyRef.current = alertKey;
            if (status === 'paused' && previousStatus !== 'paused') {
              lastPausedAlertKeyRef.current = alertKey;
              showCustomAlert('Sessao pausada', event.message || 'O mestre pausou a sessao.');
            }
            if (status === 'active' && previousStatus === 'paused') {
              lastPausedAlertKeyRef.current = '';
              showCustomAlert('Sessao retomada', event.message || 'O mestre retomou a sessao.');
            }
          }
        }
        continue;
      }

      if ((event.type === 'trade_offer' || event.type === 'trade_counter') && event.toKey === selfKey) {
        void rememberLanSessionEvent(db, event).catch(() => false);
        setIncomingTrades((current) => {
          const byKey = new Map<string, LanSessionEvent>();
          for (const entry of current) byKey.set(entry.tradeId || entry.id, entry);
          byKey.set(event.tradeId || event.id, event);
          return Array.from(byKey.values());
        });
        showCustomAlert(event.type === 'trade_counter' ? 'Resposta de troca' : 'Proposta de troca', event.message || `${event.fromName || 'Jogador'} enviou uma proposta.`);
        continue;
      }

      if (event.type === 'trade_decline') {
        void rememberLanSessionEvent(db, event).catch(() => false);
        setIncomingTrades((current) => current.filter((entry) => (entry.tradeId || entry.id) !== (event.tradeId || event.id)));
        showCustomAlert('Troca recusada', event.message || `${event.fromName || 'Jogador'} recusou a troca.`);
        continue;
      }

      if (event.type === 'trade_result') {
        void rememberLanSessionEvent(db, event).catch(() => false);
        setIncomingTrades((current) => current.filter((entry) => (entry.tradeId || entry.id) !== (event.tradeId || event.id)));
        const accepted = event.tradeResult?.status === 'accepted';
        showCustomAlert(accepted ? 'Troca concluida' : 'Troca nao concluida', event.tradeResult?.reason || event.message || (accepted ? 'Inventarios sincronizados.' : 'A troca nao foi concluida.'));
        continue;
      }

      if (event.type === 'send_item' && event.item) {
        void rememberLanSessionEvent(db, event).catch(() => false);
        showCustomAlert('Item recebido', `${event.fromName || 'Jogador'} enviou ${event.item?.qty || 1}x ${event.item?.name || 'item'}.`);
        continue;
      }
    }
  }, [character?.id, character?.name, db, isLanPlayerRuntime, lanInfo?.sessionId, liveLanEvents, showCustomAlert, terminateLanSessionFastFromLiveEvent]);

  const isLanSessionLocallyPaused = useCallback(async (sessionId: string, fallbackPayloadJson?: string | null) => {
    if (lanSessionStatusRef.current === 'paused') return true;

    const cachedPayload = safeJsonParse<LanSessionPayload | null>(fallbackPayloadJson, null);
    if (cachedPayload?.state?.status === 'paused') return true;

    try {
      const row = await db.getFirstAsync<{ status?: string; payloadJson?: string }>(
        `SELECT COALESCE(status, 'active') as status, payload_json as payloadJson
         FROM lan_sessions
         WHERE id = ?
         LIMIT 1`,
        [sessionId]
      );
      if (row?.status === 'paused') return true;
      const dbPayload = safeJsonParse<LanSessionPayload | null>(row?.payloadJson, null);
      return dbPayload?.state?.status === 'paused';
    } catch {
      return false;
    }
  }, [db]);

  const fetchLanPayloadWithRecovery = useCallback(async (
    info: { sessionId: string; joinUrl: string },
    storedPayloadJson?: string | null
  ) => {
    if (sessionTerminatedRef.current === info.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_PAYLOAD_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'fetchLanPayloadWithRecovery',
        sessionId: info.sessionId,
        characterId: characterRef.current?.id,
        characterName: characterRef.current?.name,
      });
      throw new Error('Sessao LAN encerrada localmente.');
    }
    const startedAt = Date.now();
    traceFunctionCall('fetchLanPayloadWithRecovery', {
      info,
      hasStoredPayload: Boolean(storedPayloadJson),
    }, {
      screen: 'sheet',
      source: 'lan_recovery',
      sessionId: info.sessionId,
      characterId: characterRef.current?.id,
      characterName: characterRef.current?.name,
    });
    let firstError: unknown = null;

    if (info.joinUrl) {
      try {
        const payload = await fetchLanSessionPayload(info.joinUrl);
        if (payload.session.id !== info.sessionId) {
          throw new Error('Sessao LAN retornou outro identificador.');
        }
        traceFunctionReturn('fetchLanPayloadWithRecovery', {
          recovered: true,
          strategy: 'direct_join_url',
          sessionId: payload.session.id,
        }, {
          screen: 'sheet',
          source: 'lan_recovery',
          sessionId: info.sessionId,
          durationMs: Date.now() - startedAt,
        });
        return { payload, info };
      } catch (error) {
        firstError = error;
      }
    }

    const inviteCode = getInviteCodeFromPayloadJson(storedPayloadJson);
    if (inviteCode) {
      const recoveredUrl = await resolveLanSessionUrlByInviteCode(inviteCode);

      if (recoveredUrl) {
        resetLanClientConnection();
        const payload = await fetchLanSessionPayload(recoveredUrl);
        if (payload.session.id !== info.sessionId) {
          throw new Error('Sessao LAN retornou outro identificador.');
        }
        traceFunctionReturn('fetchLanPayloadWithRecovery', {
          recovered: true,
          strategy: 'invite_code',
          sessionId: payload.session.id,
        }, {
          screen: 'sheet',
          source: 'lan_recovery',
          sessionId: info.sessionId,
          durationMs: Date.now() - startedAt,
        });
        return {
          payload,
          info: {
            ...info,
            joinUrl: recoveredUrl,
          },
        };
      }
    }

    if (firstError) throw firstError;
    traceFunctionReturn('fetchLanPayloadWithRecovery', { recovered: false }, {
      screen: 'sheet',
      source: 'lan_recovery',
      sessionId: info.sessionId,
      durationMs: Date.now() - startedAt,
    });
    throw new Error('Sessao LAN sem URL ativa.');
  }, []);


  const mergeLoadedCharacterWithLiveLanState = useCallback((loadedCharacter: any) => {
    if (!loadedCharacter?.id || !routeSessionId) return loadedCharacter;
    const selfKey = makeLanCharacterKey(routeSessionId, loadedCharacter);
    const liveCharacter = characterRef.current;
    const liveSameCharacter = liveCharacter && Number(liveCharacter.id) === Number(loadedCharacter.id)
      ? liveCharacter
      : null;
    const publicSelf = lanPlayersRef.current.find((player) => (
      player.isSelf ||
      player.key === selfKey ||
      player.characterName === loadedCharacter.name
    ));

    const loadedLevel = Math.max(1, Math.floor(Number(loadedCharacter.level || 1) || 1), inferTotalLevelFromClassName(loadedCharacter.class));
    const liveLevel = liveSameCharacter
      ? Math.max(1, Math.floor(Number(liveSameCharacter.level || 1) || 1), inferTotalLevelFromClassName(liveSameCharacter.class))
      : 0;
    const publicLevel = publicSelf ? Math.max(1, Math.floor(Number(publicSelf.level || 1) || 1)) : 0;
    const loadedHpMax = Math.max(0, Math.floor(Number(loadedCharacter.hp_max || loadedCharacter.hpMax || 0) || 0));
    const liveHpMax = liveSameCharacter ? Math.max(0, Math.floor(Number(liveSameCharacter.hp_max || liveSameCharacter.hpMax || 0) || 0)) : 0;
    const publicHpMax = publicSelf ? Math.max(0, Math.floor(Number(publicSelf.hpMax || 0) || 0)) : 0;
    const publicRevision = Math.max(0, Math.floor(Number((publicSelf as any)?.publicRevision || (publicSelf as any)?.publicSeq || 0) || 0));
    const lastLivePatchAgeMs = Date.now() - Math.max(0, Number(lastAuthoritativePlayerPatchRef.current.appliedAt || 0));
    const liveLooksAuthoritative = Boolean(
      liveSameCharacter &&
      lastLivePatchAgeMs < 120000 &&
      (liveLevel >= loadedLevel || liveHpMax >= loadedHpMax)
    );
    const publicLooksAuthoritative = Boolean(
      publicSelf &&
      (publicRevision > 0 || publicLevel >= loadedLevel || publicHpMax >= loadedHpMax)
    );

    if (!liveLooksAuthoritative && !publicLooksAuthoritative) return loadedCharacter;

    const merged: any = { ...loadedCharacter };
    if (liveLooksAuthoritative && liveSameCharacter) {
      const liveStats = liveSameCharacter.stats && typeof liveSameCharacter.stats === 'object'
        ? liveSameCharacter.stats
        : null;
      merged.level = Math.max(loadedLevel, liveLevel || loadedLevel);
      merged.class = liveLevel >= loadedLevel && liveSameCharacter.class ? liveSameCharacter.class : merged.class;
      merged.race = liveSameCharacter.race || merged.race;
      merged.stats = liveStats || merged.stats;
      const pendingInventory = pendingSelfInventoryStateRef.current;
      const pendingIsRecent = Boolean(pendingInventory && Date.now() - pendingInventory.at < 15000);
      const liveEquipmentFingerprint = liveSameCharacter.equipment ? getSheetEquipmentFingerprint(liveSameCharacter.equipment) : '';
      const pendingEquipmentFingerprint = pendingInventory ? getSheetEquipmentFingerprint(pendingInventory.equipment) : '';
      if (pendingInventory && pendingIsRecent && pendingEquipmentFingerprint && pendingEquipmentFingerprint !== liveEquipmentFingerprint) {
        const pendingEquipment = normalizeSheetEquipment(pendingInventory.equipment);
        merged.equipment = pendingEquipment;
        merged.stats = pendingInventory.statsPatch && typeof pendingInventory.statsPatch === 'object'
          ? pendingInventory.statsPatch
          : buildSheetStatsWithDerivedEquipMods(merged.stats, pendingEquipment);
      } else {
        if (pendingIsRecent && pendingEquipmentFingerprint === liveEquipmentFingerprint) pendingSelfInventoryStateRef.current = null;
        merged.equipment = liveSameCharacter.equipment || merged.equipment;
      }
      merged.active_effects = Array.isArray(liveSameCharacter.active_effects) ? liveSameCharacter.active_effects : merged.active_effects;
      merged.active_effects_json = liveSameCharacter.active_effects_json || merged.active_effects_json;
      merged.hp_max = Math.max(loadedHpMax, liveHpMax || loadedHpMax);
      merged.hp_current = Math.max(0, Math.min(Math.max(merged.hp_max, 1), Math.floor(Number(liveSameCharacter.hp_current ?? liveSameCharacter.hpCurrent ?? merged.hp_current ?? 0) || 0)));
      merged.temp_hp = Math.max(0, Math.floor(Number(liveSameCharacter.temp_hp ?? liveSameCharacter.tempHp ?? merged.temp_hp ?? 0) || 0));
      if (Array.isArray(merged.active_effects) || merged.active_effects_json) {
        const mergedEffects = Array.isArray(merged.active_effects)
          ? merged.active_effects
          : safeJsonParse<any[]>(merged.active_effects_json, []);
        const syncedEffects = syncTempHpEffectsLocallyWithNumber(mergedEffects, merged.temp_hp).effects;
        merged.active_effects = syncedEffects;
        merged.active_effects_json = JSON.stringify(syncedEffects);
      }
      merged.xp = Math.max(Math.floor(Number(merged.xp || 0) || 0), Math.floor(Number(liveSameCharacter.xp || 0) || 0));
      merged.gp = liveSameCharacter.gp ?? merged.gp;
      merged.sp = liveSameCharacter.sp ?? merged.sp;
      merged.cp = liveSameCharacter.cp ?? merged.cp;
    }

    if (publicLooksAuthoritative && publicSelf) {
      const nextHpMax = Math.max(Math.max(0, Number(merged.hp_max || 0)), publicHpMax);
      merged.level = Math.max(Math.max(1, Number(merged.level || 1)), publicLevel || 1);
      merged.hp_max = nextHpMax;
      merged.hp_current = Math.max(0, Math.min(Math.max(nextHpMax, 1), Math.floor(Number(publicSelf.hpCurrent ?? merged.hp_current ?? 0) || 0)));
      merged.temp_hp = Math.max(0, Math.floor(Number(publicSelf.tempHp ?? merged.temp_hp ?? 0) || 0));
      if ((publicSelf as any).xp != null) merged.xp = Math.max(0, Math.floor(Number((publicSelf as any).xp || merged.xp || 0) || 0));
      if ((publicSelf as any).gp != null) merged.gp = Math.max(0, Math.floor(Number((publicSelf as any).gp || 0) || 0));
      if ((publicSelf as any).sp != null) merged.sp = Math.max(0, Math.floor(Number((publicSelf as any).sp || 0) || 0));
      if ((publicSelf as any).cp != null) merged.cp = Math.max(0, Math.floor(Number((publicSelf as any).cp || 0) || 0));
    }

    debugLanFlow('PLAYER_SHEET_LOAD_MERGED_LIVE_LAN_STATE_V95', {
      sessionId: routeSessionId,
      characterId: loadedCharacter.id,
      characterName: loadedCharacter.name,
      loadedHp: `${loadedCharacter.hp_current}/${loadedCharacter.hp_max}`,
      mergedHp: `${merged.hp_current}/${merged.hp_max}`,
      loadedLevel,
      mergedLevel: merged.level,
      liveLooksAuthoritative,
      publicLooksAuthoritative,
      publicRevision,
    });
    return merged;
  }, [routeSessionId]);

  useFocusEffect(
    useCallback(() => {
    traceScreen('sheet', 'SHEET_SCREEN_FOCUS', {
      characterId: id,
      sessionId: routeSessionId,
      source: 'CharacterSheetScreen',
    });
    async function loadData() {
      if (!id) return;
      const startedAt = Date.now();
      traceFunctionCall('loadData', { id, routeSessionId, routeJoinUrl }, {
        screen: 'sheet',
        source: 'sheet_focus',
        characterId: id,
        sessionId: routeSessionId,
      });
      try {
        traceSqlite('SQLITE_READ_START', {
          screen: 'sheet',
          source: 'loadData',
          functionName: 'loadData',
          table: 'characters/items/skills/saving_throws',
          operation: 'SHEET_CHARACTER_LOAD',
          characterId: id,
          sessionId: routeSessionId,
        });
        const result = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        if (result) {
          try {
            const quickParsedEquip = normalizeSheetEquipment((result as any).equipment);
            let quickSaves = safeJsonParse<any[]>((result as any).save_values, []);
            let quickSkills = safeJsonParse<any[]>((result as any).skill_values, []);
            const quickBackupProfs = safeJsonParse<string[]>((result as any).proficiencies, []);
            if (!Array.isArray(quickSaves) || (quickSaves.length > 0 && typeof quickSaves[0] !== 'string')) {
              quickSaves = quickBackupProfs.filter((p: string) => p.startsWith('save_'));
            }
            if (!Array.isArray(quickSkills) || (quickSkills.length > 0 && typeof quickSkills[0] !== 'string')) {
              quickSkills = quickBackupProfs.filter((p: string) => p.startsWith('skill_'));
            }
            const quickStats = safeJsonParse<Record<string, any>>((result as any).stats, {});
            if (!quickStats.temp_mods) quickStats.temp_mods = {};
            if (!quickStats.equip_mods) quickStats.equip_mods = {};
            const quickCharData: any = {
              ...(result as any),
              stats: quickStats,
              save_values: quickSaves,
              skill_values: quickSkills,
              equipment: quickParsedEquip,
              spells: safeJsonParse<any[]>((result as any).spells, []),
              active_effects: safeJsonParse<any[]>((result as any).active_effects_json, []),
            };
            const quickMerged = mergeLoadedCharacterWithLiveLanState(quickCharData);
            characterRef.current = quickMerged;
            setCharacter(quickMerged);
            setLoading(false);
            debugLanFlow('PLAYER_SHEET_FAST_CHARACTER_BOOTSTRAP_V98', {
              sessionId: routeSessionId,
              characterId: quickMerged.id,
              characterName: quickMerged.name,
              hpCurrent: quickMerged.hp_current,
              hpMax: quickMerged.hp_max,
              xp: quickMerged.xp,
              durationMs: Date.now() - startedAt,
            });
          } catch (quickError) {
            debugLanFlow('PLAYER_SHEET_FAST_CHARACTER_BOOTSTRAP_FAILED_V98', {
              sessionId: routeSessionId,
              characterId: id,
              reason: quickError instanceof Error ? quickError.message : String(quickError),
            });
          }
        }
        await ensureItemEffectHiddenColumn(db);
        const catalog = await db.getAllAsync(`SELECT * FROM items ORDER BY name ASC`);
        const skillsList = await db.getAllAsync(`SELECT * FROM skills ORDER BY name ASC`);
        const savesList = await db.getAllAsync(`SELECT * FROM saving_throws ORDER BY name ASC`);
        
        setDbItemsCatalog(catalog);
        setDbSkills(skillsList);
        setDbSaves(savesList);

        if (result) {
          const parsedEquip = normalizeSheetEquipment((result as any).equipment);

          let loadedSaves = safeJsonParse<any[]>((result as any).save_values, []);
          let loadedSkills = safeJsonParse<any[]>((result as any).skill_values, []);
          const backupProfs = safeJsonParse<string[]>((result as any).proficiencies, []);

          if (!Array.isArray(loadedSaves) || (loadedSaves.length > 0 && typeof loadedSaves[0] !== 'string')) {
              loadedSaves = backupProfs.filter((p: string) => p.startsWith('save_'));
          }
          if (!Array.isArray(loadedSkills) || (loadedSkills.length > 0 && typeof loadedSkills[0] !== 'string')) {
              loadedSkills = backupProfs.filter((p: string) => p.startsWith('skill_'));
          }

          const parsedStats = safeJsonParse<Record<string, any>>((result as any).stats, {});
          if(!parsedStats.temp_mods) parsedStats.temp_mods = {};
          if(!parsedStats.equip_mods) parsedStats.equip_mods = {};

          const charData: any = {
            ...(result as any),
            stats: parsedStats,
            save_values: loadedSaves,
            skill_values: loadedSkills,
            equipment: parsedEquip,
            spells: safeJsonParse<any[]>((result as any).spells, []),
            active_effects: safeJsonParse<any[]>((result as any).active_effects_json, []),
          };
          const mergedCharData = mergeLoadedCharacterWithLiveLanState(charData);
          characterRef.current = mergedCharData;
          setCharacter(mergedCharData);
          traceSqlite('SQLITE_READ_DONE', {
            screen: 'sheet',
            source: 'loadData',
            functionName: 'loadData',
            table: 'characters',
            operation: 'SHEET_CHARACTER_LOAD',
            characterId: mergedCharData.id,
            characterName: mergedCharData.name,
            sessionId: routeSessionId,
            result: {
              hp_current: mergedCharData.hp_current,
              hp_max: mergedCharData.hp_max,
              temp_hp: mergedCharData.temp_hp,
              xp: mergedCharData.xp,
              gp: mergedCharData.gp,
              sp: mergedCharData.sp,
              cp: mergedCharData.cp,
              activeEffectCount: mergedCharData.active_effects?.length || 0,
            },
            durationMs: Date.now() - startedAt,
          });

          const raceData = await db.getFirstAsync<{speed: string}>(`SELECT speed FROM races WHERE name = ?`, [mergedCharData.race]);
          if (raceData) setCharRaceSpeed(raceData.speed);

          const casterClasses = await db.getAllAsync<{name: string}>(`SELECT name FROM classes WHERE is_caster = 1`);
          const hasSpells = casterClasses.some(c => String(mergedCharData.class || '').includes(c.name));
          setCharHasSpells(true);

          if (mergedCharData.spells.length > 0) {
            const placeholders = mergedCharData.spells.map(() => '?').join(',');
            const spellsFull = await db.getAllAsync(`SELECT * FROM spells WHERE id IN (${placeholders})`, mergedCharData.spells.map((s: string) => Number(s)));
            setSpellDetails(spellsFull);
          }
        }
        traceFunctionReturn('loadData', { loaded: Boolean(result) }, {
          screen: 'sheet',
          characterId: id,
          sessionId: routeSessionId,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error(error);
        traceError('SCREEN', 'SHEET_CHARACTER_LOAD_ERROR', error, {
          screen: 'sheet',
          characterId: id,
          sessionId: routeSessionId,
        });
      } finally { setLoading(false); }
    }
      loadData();
    }, [id])
  );

  const notifyMasterReconnect = useCallback(async (
    nextPayload: LanSessionPayload,
    nextInfo: { sessionId: string; joinUrl: string },
    currentCharacter: Record<string, unknown>,
    options?: { force?: boolean; reviewSnapshot?: boolean }
  ) => {
    if (sessionTerminatedRef.current === nextInfo.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'notifyMasterReconnect',
        sessionId: nextInfo.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
      });
      return;
    }
    const selfKey = makeLanCharacterKey(nextInfo.sessionId, currentCharacter);
    const isAlreadyInSession = Boolean(nextPayload.state?.players?.some((player) => (
      player.remoteKey === selfKey ||
      player.characterName === currentCharacter.name
    )));
    const key = `${nextInfo.sessionId}:${currentCharacter.id || ''}:${nextPayload.session.id}:${isAlreadyInSession ? 'joined' : 'joining'}`;
    const now = Date.now();
    const throttleMs = isAlreadyInSession ? 15000 : 3000;

    if (!options?.force && lastLanJoinNotifyRef.current.key === key && now - lastLanJoinNotifyRef.current.at < throttleMs) {
      return;
    }

    lastLanJoinNotifyRef.current = { key, at: now };

    try {
      await notifyMasterJoin(nextInfo.joinUrl, nextInfo.sessionId, currentCharacter, '', { reviewSnapshot: Boolean(options?.reviewSnapshot) });
    } catch (error) {
      console.warn('[LAN] Nao foi possivel reanunciar jogador ao mestre:', error);
    }
  }, []);

  const updateSelfLanBarFromAuthoritativePatch = useCallback((
    sessionValue: string,
    nextValues: {
      hp_current: unknown;
      hp_max: unknown;
      temp_hp: unknown;
      xp: unknown;
      gp: unknown;
      sp: unknown;
      cp: unknown;
    },
    event: LanSessionEvent,
    options?: { publicEffects?: unknown[] },
  ) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;

    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    const incomingPublicSeq = Number(event.serverSeq ?? event.seq ?? event.entityRevision ?? 0) || Date.now();
    const incomingPublicRevision = Number(event.entityRevision ?? event.serverSeq ?? event.seq ?? 0) || incomingPublicSeq;
    const nextSelfValues = {
      hpCurrent: Math.max(0, Math.floor(Number(nextValues.hp_current) || 0)),
      hpMax: Math.max(0, Math.floor(Number(nextValues.hp_max) || 0)),
      tempHp: Math.max(0, Math.floor(Number(nextValues.temp_hp) || 0)),
      level: Math.max(1, Math.floor(Number(currentCharacter.level) || 1)),
      xp: Math.max(0, Math.floor(Number(nextValues.xp ?? 0) || 0)),
      gp: Math.max(0, Math.floor(Number(nextValues.gp ?? 0) || 0)),
      sp: Math.max(0, Math.floor(Number(nextValues.sp ?? 0) || 0)),
      cp: Math.max(0, Math.floor(Number(nextValues.cp ?? 0) || 0)),
      publicSeq: incomingPublicSeq,
      publicRevision: incomingPublicRevision,
    };
    const hasPublicEffectsOption = Array.isArray(options?.publicEffects);
    const nextPublicEffects = hasPublicEffectsOption
      ? summarizeEffectsForPublicRoster(options?.publicEffects || [])
      : null;

    setLanPlayers((current) => {
      let matched = false;
      const next = current.map((player) => {
        if (!(player.isSelf || player.key === selfKey || player.characterName === currentCharacter.name)) return player;
        matched = true;
        return {
          ...player,
          ...nextSelfValues,
          ...(hasPublicEffectsOption ? { publicEffects: nextPublicEffects || [] } : {}),
          key: player.key || selfKey,
          playerName: player.playerName || String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
          characterName: player.characterName || String(currentCharacter.name || 'Jogador'),
          isSelf: true,
        };
      });

      // Se o roster publico ainda nao nasceu do payload, crie a propria entrada aqui.
      // Sem isso, o primeiro PV temporario pode atualizar a ficha privada, mas nao o
      // card publico ate o proximo snapshot.
      if (!matched) {
        next.push({
          key: selfKey,
          playerName: String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
          characterName: String(currentCharacter.name || 'Jogador'),
          ...nextSelfValues,
          isSelf: true,
          publicEffects: nextPublicEffects || [],
        });
      }
      return next;
    });
    traceApp('UI_UPDATE', 'LAN_PLAYER_BAR_UPDATED_FROM_AUTHORITATIVE_PATCH', {
      screen: 'sheet',
      source: 'updateSelfLanBarFromAuthoritativePatch',
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event.id,
      eventType: event.type,
      seq: event.seq,
      entityRevision: event.entityRevision,
      after: {
        hpCurrent: nextValues.hp_current,
        hpMax: nextValues.hp_max,
        tempHp: nextValues.temp_hp,
      },
    });
    traceApp('UI_UPDATE', 'PLAYER_NUMBER_PATCH_APPLIED_TO_HEADER', {
      screen: 'sheet',
      source: 'updateSelfLanBarFromAuthoritativePatch',
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event.id,
      eventType: event.type,
      seq: event.seq,
      entityRevision: event.entityRevision,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
      gp: nextValues.gp,
      sp: nextValues.sp,
      cp: nextValues.cp,
    });

    debugLanFlow('PLAYER_PATCH_APPLIED_TO_LAN_BAR', {
      eventId: event.id,
      sessionId: sessionValue,
      selfKey,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      seq: event.seq,
      entityRevision: event.entityRevision,
    });
  }, []);


  const updateSelfPublicEffectsFromLocalEffects = useCallback((
    sessionValue: string,
    effects: unknown[],
    tempHp: unknown,
    event?: LanSessionEvent,
  ) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;
    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    const publicEffects = summarizeEffectsForPublicRoster(effects);
    const incomingPublicSeq = Number(event?.serverSeq ?? event?.seq ?? event?.entityRevision ?? 0) || Date.now();
    const incomingPublicRevision = Number(event?.entityRevision ?? event?.serverSeq ?? event?.seq ?? 0) || incomingPublicSeq;
    setLanPlayers((current) => {
      let matched = false;
      const next = current.map((player) => {
        if (!(player.isSelf || player.key === selfKey || player.characterName === currentCharacter.name)) return player;
        matched = true;
        const existingSeq = Number((player as any).publicSeq || (player as any).publicRevision || 0) || 0;
        if (existingSeq > 0 && incomingPublicSeq > 0 && incomingPublicSeq < existingSeq) return player;
        return {
          ...player,
          key: player.key || selfKey,
          playerName: player.playerName || String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
          characterName: player.characterName || String(currentCharacter.name || 'Jogador'),
          level: Math.max(1, Math.floor(Number((characterRef.current as any)?.level || player.level || 1) || 1)),
          hpCurrent: Math.max(0, Math.floor(Number((characterRef.current as any)?.hp_current ?? (characterRef.current as any)?.hpCurrent ?? player.hpCurrent ?? 0) || 0)),
          hpMax: Math.max(0, Math.floor(Number((characterRef.current as any)?.hp_max ?? (characterRef.current as any)?.hpMax ?? player.hpMax ?? 0) || 0)),
          tempHp: Math.max(0, Math.floor(Number(tempHp ?? (characterRef.current as any)?.temp_hp ?? player.tempHp ?? 0) || 0)),
          publicEffects,
          isSelf: true,
          publicSeq: Math.max(existingSeq, incomingPublicSeq),
          publicRevision: incomingPublicRevision,
        };
      });
      if (matched) return next;
      return [...next, {
        key: selfKey,
        playerName: String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
        characterName: String(currentCharacter.name || 'Jogador'),
        level: Math.max(1, Math.floor(Number((characterRef.current as any)?.level || 1) || 1)),
        hpCurrent: Math.max(0, Math.floor(Number((characterRef.current as any)?.hp_current ?? (characterRef.current as any)?.hpCurrent ?? 0) || 0)),
        hpMax: Math.max(0, Math.floor(Number((characterRef.current as any)?.hp_max ?? (characterRef.current as any)?.hpMax ?? 0) || 0)),
        tempHp: Math.max(0, Math.floor(Number(tempHp ?? (characterRef.current as any)?.temp_hp ?? 0) || 0)),
        publicEffects,
        isSelf: true,
        publicSeq: incomingPublicSeq,
        publicRevision: incomingPublicRevision,
      }];
    });
  }, []);



  const syncSelfLanRosterFromCharacter = useCallback((sessionValue: string, source: string) => {
    const currentCharacter = characterRef.current as any;
    if (!currentCharacter?.id || !sessionValue) return;
    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    const currentEffects = Array.isArray(currentCharacter.active_effects)
      ? currentCharacter.active_effects
      : safeJsonParse<any[]>(currentCharacter.active_effects_json, []);
    const publicEffects = summarizeEffectsForPublicRoster(currentEffects);
    const nextSelfValues = {
      level: Math.max(1, Math.floor(Number(currentCharacter.level || 1) || 1), inferTotalLevelFromClassName(currentCharacter.class)),
      hpCurrent: Math.max(0, Math.floor(Number(currentCharacter.hp_current ?? currentCharacter.hpCurrent ?? 0) || 0)),
      hpMax: Math.max(0, Math.floor(Number(currentCharacter.hp_max ?? currentCharacter.hpMax ?? 0) || 0)),
      tempHp: Math.max(0, Math.floor(Number(currentCharacter.temp_hp ?? currentCharacter.tempHp ?? 0) || 0)),
      xp: Math.max(0, Math.floor(Number(currentCharacter.xp || 0) || 0)),
      gp: Math.max(0, Math.floor(Number(currentCharacter.gp || 0) || 0)),
      sp: Math.max(0, Math.floor(Number(currentCharacter.sp || 0) || 0)),
      cp: Math.max(0, Math.floor(Number(currentCharacter.cp || 0) || 0)),
      publicEffects,
    };

    setLanPlayers((current) => {
      let matched = false;
      const next = current.map((player) => {
        if (!(player.isSelf || player.key === selfKey || player.characterName === currentCharacter.name)) return player;
        matched = true;
        return {
          ...player,
          ...nextSelfValues,
          key: player.key || selfKey,
          playerName: player.playerName || String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
          characterName: player.characterName || String(currentCharacter.name || 'Jogador'),
          isSelf: true,
        };
      });
      if (matched) return next;
      return [...next, {
        key: selfKey,
        playerName: String(currentCharacter.playerName || currentCharacter.name || 'Jogador'),
        characterName: String(currentCharacter.name || 'Jogador'),
        ...nextSelfValues,
        isSelf: true,
        publicSeq: 0,
        publicRevision: 0,
      }];
    });

    debugLanFlow('PLAYER_SELF_PUBLIC_ROSTER_PROJECTED_FROM_CHARACTER_V92', {
      source,
      sessionId: sessionValue,
      selfKey,
      level: nextSelfValues.level,
      hpCurrent: nextSelfValues.hpCurrent,
      hpMax: nextSelfValues.hpMax,
      tempHp: nextSelfValues.tempHp,
      effectCount: publicEffects.length,
    });
  }, []);

  const mergeLanPlayersFromPayloadCache = useCallback((incomingPayload: LanSessionPayload, selfKey: string, source: string, options?: { forceNumbers?: boolean }) => {
    const currentCharacter = characterRef.current as any;
    const localLevel = Math.max(1, Math.floor(Number(currentCharacter?.level || 1) || 1));
    const localHpMax = Math.max(0, Math.floor(Number(currentCharacter?.hp_max || currentCharacter?.hpMax || 0) || 0));
    const localHpCurrent = Math.max(0, Math.floor(Number(currentCharacter?.hp_current || currentCharacter?.hpCurrent || 0) || 0));
    const localXp = Math.max(0, Math.floor(Number(currentCharacter?.xp || 0) || 0));
    const incomingPlayers = getPublicLanPlayers(incomingPayload, selfKey).map((player: any) => {
      if (!selfKey || player.key !== selfKey) return player;
      const incomingLevel = Math.max(1, Math.floor(Number(player.level || 1) || 1));
      const incomingHpMax = Math.max(0, Math.floor(Number(player.hpMax || 0) || 0));
      const payloadLooksOlderThanLocalLevelUp = localLevel > incomingLevel || localHpMax > incomingHpMax;
      if (!payloadLooksOlderThanLocalLevelUp) return player;
      debugLanFlow('PLAYER_PUBLIC_PAYLOAD_SELF_PROGRESS_OLDER_SKIPPED_V90', {
        source,
        selfKey,
        incomingLevel,
        localLevel,
        incomingHpMax,
        localHpMax,
      });
      return {
        ...player,
        level: Math.max(incomingLevel, localLevel),
        hpMax: Math.max(incomingHpMax, localHpMax),
        hpCurrent: Math.max(Math.max(0, Number(player.hpCurrent || 0)), Math.min(Math.max(localHpMax, 1), localHpCurrent)),
        xp: Math.max(Math.max(0, Number(player.xp || 0)), localXp),
      };
    });
    setLanPlayers((current) => {
      if (!current.length) {
        return incomingPlayers.map((player) => ({
          ...player,
          publicSeq: 0,
          publicRevision: 0,
        }));
      }

      let changed = false;
      const next = [...current];
      for (const incoming of incomingPlayers) {
        const index = next.findIndex((player) => (
          player.key === incoming.key ||
          (incoming.characterName && player.characterName === incoming.characterName)
        ));

        if (index < 0) {
          next.push({ ...incoming, publicSeq: 0, publicRevision: 0 });
          changed = true;
          continue;
        }

        const existing = next[index] as PublicLanPlayer & { publicSeq?: number; publicRevision?: number };
        // Snapshot/payload é cache estrutural. Durante sessão ativa ele NÃO pode voltar
        // HP público para um valor antigo depois de um public_status/player_patch vivo.
        // v86: durante recuperação pós-background, o payload do host vira reconciliação
        // autoritativa e precisa corrigir o roster completo.
        const preserveLiveNumbers = !options?.forceNumbers && Number(existing.publicSeq || existing.publicRevision || 0) > 0;
        next[index] = {
          ...incoming,
          ...(preserveLiveNumbers ? {
            hpCurrent: existing.hpCurrent,
            hpMax: existing.hpMax,
            tempHp: existing.tempHp,
            xp: existing.xp,
            gp: existing.gp,
            sp: existing.sp,
            cp: existing.cp,
            publicEffects: existing.publicEffects,
          } : {}),
          playerName: incoming.playerName || existing.playerName,
          characterName: incoming.characterName || existing.characterName,
          isSelf: incoming.isSelf,
          publicSeq: existing.publicSeq || 0,
          publicRevision: existing.publicRevision || 0,
        };
        changed = true;
      }

      if (changed) {
        debugLanFlow('PLAYER_PUBLIC_ROSTER_MERGED_FROM_PAYLOAD_CACHE', {
          source,
          playerCount: incomingPlayers.length,
          preservedLiveNumbers: current.some((player: any) => Number(player.publicSeq || player.publicRevision || 0) > 0),
        });
      }
      return changed ? next : current;
    });
  }, []);



  useEffect(() => {
    if (!lanInfo?.sessionId || !character?.id) return;
    syncSelfLanRosterFromCharacter(lanInfo.sessionId, 'character_runtime_projection');
  }, [
    lanInfo?.sessionId,
    character?.id,
    character?.name,
    character?.level,
    character?.class,
    character?.hp_current,
    character?.hp_max,
    character?.temp_hp,
    character?.xp,
    character?.gp,
    character?.sp,
    character?.cp,
    character?.active_effects_json,
    syncSelfLanRosterFromCharacter,
  ]);

  const purgeLocalTempHpEffectsAfterAuthoritativeZero = useCallback((event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id) return;
    const currentEffects = Array.isArray((currentCharacter as any).active_effects)
      ? [...((currentCharacter as any).active_effects || [])]
      : safeJsonParse<any[]>((currentCharacter as any).active_effects_json, []);
    const purgeResult = removeTempHpEffectsLocally(currentEffects);
    if (!purgeResult.changed) return;

    const nextEffectsJson = JSON.stringify(purgeResult.effects);
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = {
        ...prev,
        active_effects: purgeResult.effects,
        active_effects_json: nextEffectsJson,
        temp_hp: 0,
      };
      characterRef.current = merged;
      return merged;
    });

    void db.runAsync(
      `UPDATE characters SET active_effects_json = ?, temp_hp = ? WHERE id = ?`,
      [nextEffectsJson, 0, Number(currentCharacter.id)]
    ).catch((error) => {
      debugLanFlow('PLAYER_TEMP_HP_EFFECT_PURGE_PERSIST_FAILED', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    debugLanFlow('PLAYER_TEMP_HP_EFFECTS_PURGED_BY_AUTHORITATIVE_ZERO', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      removedCount: currentEffects.length - purgeResult.effects.length,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
    });
  }, [db]);

  const applyLanNumberPatchToCharacter = useCallback(async (patch: LanSessionEvent['numberPatch'], event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch) return null;
    const startedAt = Date.now();
    const incomingSeq = Number(event?.seq ?? event?.serverSeq ?? 0) || 0;
    const incomingRevision = normalizeLanPlayerPatchRevision(event);
    const lastPatch = lastAuthoritativePlayerPatchRef.current;
    if (
      incomingRevision > 0 &&
      lastPatch.entityRevision > 0 &&
      (
        incomingRevision < lastPatch.entityRevision ||
        (incomingRevision === lastPatch.entityRevision && incomingSeq > 0 && incomingSeq <= lastPatch.seq)
      )
    ) {
      debugLanFlow('PLAYER_NUMBER_PATCH_STALE_SKIPPED', {
        eventId: event?.id,
        seq: event?.seq,
        serverSeq: event?.serverSeq,
        entityRevision: event?.entityRevision,
        lastSeq: lastPatch.seq,
        lastRevision: lastPatch.entityRevision,
        reason: 'older_absolute_player_patch',
      });
      return null;
    }
    const selfKeyForNumberPatch = event?.sessionId ? makeLanCharacterKey(event.sessionId, currentCharacter) : '';
    let effectivePatch = { ...patch };
    const incomingHasCoinFields = effectivePatch.gp != null || effectivePatch.sp != null || effectivePatch.cp != null;
    const incomingHasNonCoinFields = effectivePatch.hpCurrent != null || effectivePatch.hpMax != null || effectivePatch.tempHp != null || effectivePatch.xp != null;
    if (incomingHasCoinFields) {
      const localCoins = sanitizeCoins({
        gp: currentCharacter.gp,
        sp: currentCharacter.sp,
        cp: currentCharacter.cp,
      });
      const incomingCoins = sanitizeCoins({
        gp: effectivePatch.gp == null ? localCoins.gp : effectivePatch.gp,
        sp: effectivePatch.sp == null ? localCoins.sp : effectivePatch.sp,
        cp: effectivePatch.cp == null ? localCoins.cp : effectivePatch.cp,
      });
      const localTotalCopper = getCoinTotalCopperValue(localCoins);
      const incomingTotalCopper = getCoinTotalCopperValue(incomingCoins);
      const pendingSelfCoins = pendingSelfCoinStateRef.current;
      const isRecentSelfCoinMutation = Boolean(
        pendingSelfCoins &&
        Date.now() - pendingSelfCoins.at < 20000
      );
      const isOwnCoinEcho = Boolean(
        event?.coinPatchRequest?.targetKey &&
        selfKeyForNumberPatch &&
        event.coinPatchRequest.targetKey === selfKeyForNumberPatch
      );
      const intent = String((event as any)?.numberPatchIntent || '');
      const sourceClientMsgId = String((event as any)?.sourceClientMsgId || '');
      const matchesPendingCommand = Boolean(
        pendingSelfCoins?.clientMsgId &&
        sourceClientMsgId &&
        sourceClientMsgId === pendingSelfCoins.clientMsgId
      );
      const matchesPendingValue = Boolean(
        pendingSelfCoins &&
        incomingTotalCopper === pendingSelfCoins.totalCopper
      );
      const isExplicitMasterCoinGrant = intent === 'coins' && !sourceClientMsgId;
      const shouldProtectLocalCoins = Boolean(
        isRecentSelfCoinMutation &&
        !isExplicitMasterCoinGrant &&
        !(matchesPendingCommand && matchesPendingValue) &&
        (intent === 'self_coin' || isOwnCoinEcho || incomingHasNonCoinFields || incomingTotalCopper !== pendingSelfCoins?.totalCopper)
      );

      if (shouldProtectLocalCoins) {
        delete effectivePatch.gp;
        delete effectivePatch.sp;
        delete effectivePatch.cp;
        debugLanFlow('PLAYER_IGNORED_STALE_COIN_ECHO', {
          eventId: event?.id,
          intent,
          sourceClientMsgId,
          isOwnCoinEcho,
          localCoins,
          incomingCoins,
          localTotalCopper,
          incomingTotalCopper,
          pendingTotalCopper: pendingSelfCoins?.totalCopper,
          pendingClientMsgId: pendingSelfCoins?.clientMsgId,
        });
      } else if (isRecentSelfCoinMutation && (matchesPendingCommand || matchesPendingValue)) {
        pendingSelfCoinStateRef.current = null;
      }
    }

    if (Object.keys(effectivePatch).length === 0) {
      debugLanFlow('PLAYER_NUMBER_PATCH_EMPTY_AFTER_SANITIZE_SKIPPED', {
        eventId: event?.id,
        originalPatch: patch,
      });
      return null;
    }

    patch = effectivePatch;

    traceFunctionCall('applyLanNumberPatchToCharacter', { patch, event }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      serverSeq: event?.serverSeq,
      entityType: event?.entityType,
      entityId: event?.entityId,
      entityRevision: event?.entityRevision,
      fromKey: event?.fromKey,
      toKey: event?.toKey,
      patch,
    });

    debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      patch,
    });

    // Caminho rápido: a UI do jogador deve reagir ao socket imediatamente.
    // O SQLite continua sendo persistência, mas não pode segurar HP/XP/moedas/vida temp na tela.
    const optimisticBase = currentCharacter;
    const currentLevelForPatch = Math.max(Number(optimisticBase.level || 1), inferTotalLevelFromClassName(optimisticBase.class), 1);
    const currentHpMaxForPatch = Number(optimisticBase.hp_max || 0);
    const incomingHpMaxForPatch = patch.hpMax == null ? currentHpMaxForPatch : Number(patch.hpMax || 0);
    const incomingXpForPatch = patch.xp == null ? Number(optimisticBase.xp || 0) : Number(patch.xp || 0);
    let expectedLevelForIncomingXp = currentLevelForPatch;
    const needsProgressionHpMaxProtection = Boolean(
      currentLevelForPatch > 1 &&
      incomingHpMaxForPatch > 0 &&
      incomingHpMaxForPatch < currentHpMaxForPatch
    );
    if (needsProgressionHpMaxProtection) {
      try {
        expectedLevelForIncomingXp = await getExpectedLevelForXpFromDb(db, incomingXpForPatch);
      } catch {
        expectedLevelForIncomingXp = currentLevelForPatch;
      }
    }
    const preserveLocalProgressionHpMax =
      needsProgressionHpMaxProtection &&
      expectedLevelForIncomingXp >= currentLevelForPatch;
    const safeIncomingHpMax = preserveLocalProgressionHpMax ? currentHpMaxForPatch : incomingHpMaxForPatch;

    if (preserveLocalProgressionHpMax) {
      debugLanFlow('PLAYER_NUMBER_PATCH_PRESERVED_LEVEL_UP_HP_MAX', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        currentLevel: currentLevelForPatch,
        incomingXp: incomingXpForPatch,
        expectedLevel: expectedLevelForIncomingXp,
        incomingHpMax: incomingHpMaxForPatch,
        keptHpMax: currentHpMaxForPatch,
      });
    }

    const optimisticNextValues = {
      hp_current: patch.hpCurrent ?? optimisticBase.hp_current,
      hp_max: patch.hpMax == null ? optimisticBase.hp_max : safeIncomingHpMax,
      temp_hp: patch.tempHp ?? optimisticBase.temp_hp,
      xp: patch.xp ?? optimisticBase.xp,
      gp: patch.gp ?? optimisticBase.gp,
      sp: patch.sp ?? optimisticBase.sp,
      cp: patch.cp ?? optimisticBase.cp,
    };
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = { ...prev, ...optimisticNextValues };
      characterRef.current = merged;
      return merged;
    });
    debugLanFlow('PLAYER_NUMBER_PATCH_UI_OPTIMISTIC_APPLIED', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      hpCurrent: optimisticNextValues.hp_current,
      hpMax: optimisticNextValues.hp_max,
      tempHp: optimisticNextValues.temp_hp,
      xp: optimisticNextValues.xp,
    });

    // v32: player_patch é absoluto e já foi aplicado de forma otimista na UI.
    // Não leia SQLite aqui: em LAN isso bloqueava o ACK e, quando o banco estava
    // atrasado, a ficha podia receber valor antigo logo após o card da sessão.
    const base = characterRef.current || currentCharacter;
    const nextValues = {
      hp_current: patch.hpCurrent ?? base.hp_current,
      hp_max: patch.hpMax == null ? base.hp_max : safeIncomingHpMax,
      temp_hp: patch.tempHp ?? base.temp_hp,
      xp: patch.xp ?? base.xp,
      gp: patch.gp ?? base.gp,
      sp: patch.sp ?? base.sp,
      cp: patch.cp ?? base.cp,
    };

    traceStateChange('STATE_CHANGE', 'PLAYER_CHARACTER_NUMBER_PATCH_COMPUTED', base, nextValues, {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      patch,
    });
    debugLanFlow('PLAYER_APPLY_NUMBER_PATCH_VALUES', {
      mode: sheetRuntimeMode,
      characterId: currentCharacter.id,
      beforeHp: base.hp_current,
      afterHp: nextValues.hp_current,
      patch,
    });

    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = { ...prev, ...nextValues };
      characterRef.current = merged;
      return merged;
    });
    debugLanFlow('PLAYER_RUNTIME_PATCH_APPLIED', {
      eventId: event?.id,
      type: event?.type,
      characterId: currentCharacter.id,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
    });

    const xpActuallyChanged = patch.xp != null && Number(patch.xp || 0) !== Number(base.xp || currentCharacter.xp || 0);
    if (xpActuallyChanged) {
      try {
        const expectedLevelAfterXp = await getExpectedLevelForXpFromDb(db, Number(nextValues.xp || 0));
        const currentForPrompt = characterRef.current || currentCharacter;
        const currentLevel = Math.max(Number(currentForPrompt.level || 1), inferTotalLevelFromClassName(currentForPrompt.class), 1);
        const promptKey = `${currentCharacter.id}:level:${expectedLevelAfterXp}`;
        if (
          expectedLevelAfterXp > currentLevel &&
          !levelUpModalVisible &&
          !levelUpNavigationLockedRef.current &&
          lastLevelUpPromptKeyRef.current !== promptKey &&
          pendingLevelUpPromptKeyRef.current !== promptKey
        ) {
          pendingLevelUpPromptKeyRef.current = promptKey;
          lastLevelUpPromptKeyRef.current = promptKey;
          debugLanFlow('PLAYER_XP_PATCH_LEVEL_UP_AVAILABLE', {
            eventId: event?.id,
            characterId: currentCharacter.id,
            xp: nextValues.xp,
            currentLevel,
            expectedLevel: expectedLevelAfterXp,
          });
          setNewLevelData(expectedLevelAfterXp);
          setLevelUpModalVisible(true);
        }
      } catch (levelError) {
        debugLanFlow('PLAYER_XP_PATCH_LEVEL_CHECK_FAILED', {
          eventId: event?.id,
          characterId: currentCharacter.id,
          reason: levelError instanceof Error ? levelError.message : String(levelError),
        });
      }
    }

    debugLanFlow('PLAYER_SQLITE_PERSIST_START', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      patch,
    });

    traceSqlite('SQLITE_WRITE_START', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      before: base,
      after: nextValues,
      patch,
    });
    void db.runAsync(
      `UPDATE characters
       SET hp_current = ?,
           hp_max = ?,
           temp_hp = ?,
           xp = ?,
           gp = ?,
           sp = ?,
           cp = ?
       WHERE id = ?`,
      [
        nextValues.hp_current,
        nextValues.hp_max,
        nextValues.temp_hp,
        nextValues.xp,
        nextValues.gp,
        nextValues.sp,
        nextValues.cp,
        Number(currentCharacter.id),
      ]
    ).catch((error) => {
      console.warn('[LAN] Falha ao persistir player_patch em background:', error);
      debugLanFlow('PLAYER_SQLITE_PERSIST_BACKGROUND_ERROR', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
    traceSqlite('SQLITE_WRITE_DONE', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      after: nextValues,
    });
    traceApp('SQLITE_WRITE_DONE', 'PLAYER_NUMBER_PATCH_SQLITE_DONE', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      after: nextValues,
    });
    debugLanFlow('PLAYER_SQLITE_PERSIST_DONE', {
      eventId: event?.id,
      characterId: currentCharacter.id,
    });

    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = { ...prev, ...nextValues };
      characterRef.current = merged;
      return merged;
    });
    debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_DONE', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      nextValues,
    });
    debugLanFlow('PLAYER_PATCH_APPLIED_TO_CHARACTER', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
    });
    if (patch.tempHp != null) {
      const cleanTempHp = Math.max(0, Math.floor(Number(patch.tempHp) || 0));
      lastAuthoritativeTempHpPatchRef.current = {
        value: cleanTempHp,
        seq: Number(event?.seq ?? event?.serverSeq ?? 0) || incomingSeq,
        entityRevision: incomingRevision,
        appliedAt: Date.now(),
      };
      const currentForEffects = characterRef.current || currentCharacter;
      const currentEffects = Array.isArray((currentForEffects as any).active_effects)
        ? [...((currentForEffects as any).active_effects || [])]
        : safeJsonParse<any[]>((currentForEffects as any).active_effects_json, []);
      const syncedEffects = syncTempHpEffectsLocallyWithNumber(currentEffects, cleanTempHp);
      if (syncedEffects.changed) {
        const nextEffectsJson = JSON.stringify(syncedEffects.effects);
        setCharacter((prev: any) => {
          if (!prev) return prev;
          const merged = {
            ...prev,
            active_effects: syncedEffects.effects,
            active_effects_json: nextEffectsJson,
            temp_hp: cleanTempHp,
          };
          characterRef.current = merged;
          return merged;
        });
        void db.runAsync(
          `UPDATE characters SET active_effects_json = ?, temp_hp = ? WHERE id = ?`,
          [nextEffectsJson, cleanTempHp, Number(currentCharacter.id)]
        ).catch((error) => {
          debugLanFlow('PLAYER_TEMP_HP_EFFECT_SYNC_PERSIST_FAILED', {
            eventId: event?.id,
            characterId: currentCharacter.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        });
        debugLanFlow('PLAYER_TEMP_HP_EFFECTS_SYNCED_BY_AUTHORITATIVE_PATCH', {
          eventId: event?.id,
          characterId: currentCharacter.id,
          tempHp: cleanTempHp,
          removedCount: currentEffects.length - syncedEffects.effects.length,
        });
      }
      traceApp('EVENT_RECEIVED', 'PLAYER_TEMP_HP_PATCH_RECEIVED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: patch.tempHp,
      });
      traceApp('UI_UPDATE', 'PLAYER_TEMP_HP_HEADER_UPDATED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: nextValues.temp_hp,
      });
      traceApp('UI_UPDATE', 'PLAYER_TEMP_HP_SHEET_UPDATED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: nextValues.temp_hp,
      });
      debugLanFlow('PLAYER_NUMBER_PATCH_TEMP_HP_APPLIED', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        tempHp: nextValues.temp_hp,
        seq: event?.seq,
        entityRevision: event?.entityRevision,
      });
    }
    if (patch.xp != null) {
      debugLanFlow('PLAYER_NUMBER_PATCH_XP_APPLIED', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        xp: nextValues.xp,
        seq: event?.seq,
        entityRevision: event?.entityRevision,
      });
    }
    traceApp('UI_UPDATE', 'CHARACTER_SHEET_NUMBER_FIELDS_UPDATED', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      before: base,
      after: nextValues,
      patch,
    });
    traceApp('UI_UPDATE', 'PLAYER_NUMBER_PATCH_APPLIED_TO_CHARACTER', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
      gp: nextValues.gp,
      sp: nextValues.sp,
      cp: nextValues.cp,
    });
    traceFunctionReturn('applyLanNumberPatchToCharacter', nextValues, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      durationMs: Date.now() - startedAt,
    });
    return nextValues;
  }, [db, normalizeLanPlayerPatchRevision, levelUpModalVisible, purgeLocalTempHpEffectsAfterAuthoritativeZero]);

  const applyLanEffectPatchToCharacter = useCallback(async (patch: LanSessionEvent['effectPatch'], event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch) return;
    const startedAt = Date.now();
    traceFunctionCall('applyLanEffectPatchToCharacter', { patch, event }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      serverSeq: event?.serverSeq,
      entityType: event?.entityType,
      entityId: event?.entityId,
      entityRevision: event?.entityRevision,
      fromKey: event?.fromKey,
      toKey: event?.toKey,
      patch,
    });

    debugLanFlow('PLAYER_EFFECT_BATCH_RECEIVED', {
      eventId: event?.id,
      sessionId: event?.sessionId,
      fromKey: event?.fromKey,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });
    debugLanFlow('PLAYER_EFFECT_PATCH_APPLY_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });

    // Caminho rápido: aplica visualmente o patch de efeito antes de qualquer leitura SQLite.
    // Isso cobre PV temporário expirando, atributo temporário, condição, cegueira/lentidão etc.
    const bundledTempHpPatch = event?.numberPatch?.tempHp != null
      ? Math.max(0, Math.floor(Number(event.numberPatch.tempHp) || 0))
      : null;
    const authoritativeTempHpPatch = bundledTempHpPatch != null
      ? {
        value: bundledTempHpPatch,
        seq: Number(event?.seq ?? event?.serverSeq ?? 0) || Date.now(),
        entityRevision: Number(event?.entityRevision || 0) || 0,
        appliedAt: Date.now(),
      }
      : getAuthoritativeTempHpPatchForEffectEvent(event);
    const shouldGuardStaleTempHpEffects = Boolean(authoritativeTempHpPatch);
    const shouldProtectExistingTempHpEffect = shouldGuardStaleTempHpEffects && Number(authoritativeTempHpPatch?.value || 0) > 0;
    const shouldSkipStaleTempHpEffect = (effect: any) => (
      shouldGuardStaleTempHpEffects &&
      isTempHpEffectSnapshot(effect) &&
      (
        Number(authoritativeTempHpPatch?.value || 0) <= 0 ||
        getTempHpEffectValue(effect) !== Number(authoritativeTempHpPatch?.value || 0)
      )
    );
    const optimisticCurrentEffects = Array.isArray((currentCharacter as any).active_effects)
      ? [...((currentCharacter as any).active_effects || [])]
      : safeJsonParse<any[]>((currentCharacter as any).active_effects_json, []);
    const optimisticCurrentTempHpIds = new Set(optimisticCurrentEffects
      .filter((effect) => isTempHpEffectSnapshot(effect))
      .flatMap((effect) => [String(effect?.id || ''), String(effect?.lanEffectId || effect?.lanEffectID || '')])
      .filter(Boolean));
    const optimisticRemoveSet = new Set((patch.remove || [])
      .map(String)
      .filter((id) => !(shouldProtectExistingTempHpEffect && optimisticCurrentTempHpIds.has(id))));
    const patchSessionId = event?.sessionId || (currentCharacter as any)?.activeLanSessionId || '';
    if (optimisticRemoveSet.size > 0) {
      rememberRemovedSheetEffectIds(patchSessionId, Array.from(optimisticRemoveSet));
    }
    const optimisticById = new Map<string, any>();
    if (patch.replace === true) {
      for (const effect of patch.add || []) {
        if (shouldSkipStaleTempHpEffect(effect)) continue;
        const id = String((effect as any)?.id || '');
        if (!id || optimisticRemoveSet.has(id) || isSheetEffectTombstoned(patchSessionId, effect)) continue;
        optimisticById.set(id, markLanEffectForLocalCharacter(effect, event));
      }
    } else {
      for (const effect of optimisticCurrentEffects) {
        const id = String(effect?.id || '');
        const lanEffectId = String(effect?.lanEffectId || effect?.lanEffectID || '');
        if (id && !optimisticRemoveSet.has(id) && !optimisticRemoveSet.has(lanEffectId) && !isSheetEffectTombstoned(patchSessionId, effect)) {
          optimisticById.set(id, effect);
        }
      }
      for (const effect of patch.update || []) {
        if (shouldSkipStaleTempHpEffect(effect)) continue;
        const id = String((effect as any)?.id || '');
        if (id && !optimisticRemoveSet.has(id) && optimisticById.has(id) && !isSheetEffectTombstoned(patchSessionId, effect)) {
          optimisticById.set(id, mergeSheetEffectUpdatePreservingElapsedDuration(
            optimisticById.get(id),
            markLanEffectForLocalCharacter(effect, event),
          ));
        }
      }
      for (const effect of patch.add || []) {
        if (shouldSkipStaleTempHpEffect(effect)) continue;
        const id = String((effect as any)?.id || '');
        if (!id || optimisticRemoveSet.has(id) || isSheetEffectTombstoned(patchSessionId, effect)) continue;
        optimisticById.set(id, mergeSheetEffectUpdatePreservingElapsedDuration(
          optimisticById.get(id),
          markLanEffectForLocalCharacter(effect, event),
        ));
      }
    }
    const optimisticNextEffects = filterRenderableLanEffects(Array.from(optimisticById.values()));
    const optimisticTempHp = bundledTempHpPatch != null
      ? bundledTempHpPatch
      : Math.max(
        0,
        Math.floor(Number((characterRef.current as any)?.temp_hp ?? currentCharacter.temp_hp ?? 0) || 0)
      );
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = {
        ...prev,
        active_effects: optimisticNextEffects,
        active_effects_json: JSON.stringify(optimisticNextEffects),
        temp_hp: optimisticTempHp,
      };
      characterRef.current = merged;
      return merged;
    });
    if (event?.sessionId) {
      updateSelfPublicEffectsFromLocalEffects(event.sessionId, optimisticNextEffects, optimisticTempHp, event);
    }
    debugLanFlow('PLAYER_EFFECT_PATCH_UI_OPTIMISTIC_APPLIED', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      effectCount: optimisticNextEffects.length,
      tempHp: optimisticTempHp,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });

    const optimisticEffectsJson = JSON.stringify(optimisticNextEffects);
    void db.runAsync(
      `UPDATE characters SET active_effects_json = ?, temp_hp = ? WHERE id = ?`,
      [optimisticEffectsJson, optimisticTempHp, Number(currentCharacter.id)]
    ).then(() => {
      debugLanFlow('PLAYER_EFFECT_PATCH_SQLITE_BACKGROUND_DONE_V92', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        effectCount: optimisticNextEffects.length,
      });
    }).catch((error) => {
      debugLanFlow('PLAYER_EFFECT_PATCH_SQLITE_BACKGROUND_ERROR_V92', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    traceFunctionReturn('applyLanEffectPatchToCharacter', {
      effectCount: optimisticNextEffects.length,
      persistedInBackground: true,
    }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      durationMs: Date.now() - startedAt,
    });
    return;

    // v103: bloco legado removido. O caminho otimista acima agora e o unico caminho
    // da ficha quando ela recebe effect_patch; o writer global continua sendo o dono
    // principal, e este trecho nao deve reprocessar SQLite novamente.
  }, [db, getAuthoritativeTempHpPatchForEffectEvent, updateSelfPublicEffectsFromLocalEffects]);

  const clearLanSessionEffectsFromCharacter = useCallback(async (sessionValue: string) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;

    debugLanFlow('PLAYER_KICKED_CLEAN_LAN_EFFECTS_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      sessionId: sessionValue,
    });

    const current = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT active_effects_json FROM characters WHERE id = ?`,
      [Number(currentCharacter.id)]
    );
    const effects = safeJsonParse<any[]>((current as any)?.active_effects_json, []);
    const nextEffects = effects.filter((effect) => {
      const effectSessionId = String(effect?.sessionId || '');
      const isLanSessionEffect =
        (String(effect?.origin || '') === 'lan' && effectSessionId === sessionValue) ||
        (String(effect?.sourceType || '') === 'lan_session' && effectSessionId === sessionValue) ||
        (Boolean(effect?.lanEventId) && effectSessionId === sessionValue);
      return !isLanSessionEffect;
    });

    const nextTempHp = calculateStandardTempHpFromEffects(nextEffects);
    await db.runAsync(
      `UPDATE characters SET active_effects_json = ?, temp_hp = ? WHERE id = ?`,
      [JSON.stringify(nextEffects), nextTempHp, Number(currentCharacter.id)]
    );
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = {
        ...prev,
        active_effects: nextEffects,
        active_effects_json: JSON.stringify(nextEffects),
        temp_hp: nextTempHp,
      };
      characterRef.current = merged;
      return merged;
    });

    debugLanFlow('PLAYER_KICKED_CLEAN_LAN_EFFECTS_DONE', {
      characterId: currentCharacter.id,
      sessionId: sessionValue,
      removedCount: effects.length - nextEffects.length,
      remainingCount: nextEffects.length,
    });
  }, [db]);

  const applyLanInventoryPatchToCharacter = useCallback(async (patch: LanSessionEvent['inventoryPatch'], event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch?.equipment) return;

    const incomingEquipment = normalizeSheetEquipment(patch.equipment);
    const itemDelta = patch.itemDelta;
    const rawTradeDeltas = Array.isArray((patch as any).tradeCommit?.itemDeltas)
      ? ((patch as any).tradeCommit.itemDeltas as Array<{ mode?: string; item?: Record<string, any>; qty?: number }>).filter(Boolean)
      : [];
    const itemDeltas = rawTradeDeltas.length > 0
      ? rawTradeDeltas
      : Array.isArray((patch as any).itemDeltas)
        ? ((patch as any).itemDeltas as Array<{ mode?: string; item?: Record<string, any>; qty?: number }>).filter(Boolean)
        : itemDelta
          ? [itemDelta as any]
          : [];
    const currentEquipment = normalizeSheetEquipment(currentCharacter.equipment);
    const action = String(patch.action || 'replace');
    const eventId = String(event?.id || '');
    const isMasterAuthoritativeInventory = Boolean(
      event?.fromKey === 'master' ||
      event?.originClientId === 'master' ||
      event?.fromName === 'Mestre' ||
      event?.fromName === 'Sessao LAN'
    );
    const shouldTrustAuthoritativeSnapshot = Boolean(
      isMasterAuthoritativeInventory &&
      !eventId.startsWith('checkpoint_inventory_') &&
      patch.equipment &&
      ['trade_commit', 'transfer_out', 'transfer_in', 'grant', 'remove', 'consume', 'replace', 'self_update'].includes(action)
    );
    let nextEquipment = incomingEquipment;
    const pendingInventory = pendingSelfInventoryStateRef.current;
    const pendingIsRecent = Boolean(pendingInventory && Date.now() - pendingInventory.at < 15000);
    const sourceClientMsgId = String((event as any)?.sourceClientMsgId || '');
    const matchesPendingCommand = Boolean(
      pendingInventory?.clientMsgId &&
      sourceClientMsgId &&
      sourceClientMsgId === pendingInventory.clientMsgId
    );
    const tradeCommit = (patch as any).tradeCommit && typeof (patch as any).tradeCommit === 'object'
      ? (patch as any).tradeCommit
      : null;
    const inventoryTransactionId = action === 'trade_commit'
      ? [
          event?.sessionId || lanInfo?.sessionId || '',
          tradeCommit?.targetKey || patch.targetKey || '',
          // v84: tradeId pode ser reaproveitado pela UI entre os mesmos jogadores.
          // Use commitId quando o host fornecer; se não existir, use o event.id para
          // permitir várias trocas em sequência sem o dedupe bloquear a segunda.
          tradeCommit?.commitId || event?.id || event?.sourceClientMsgId || event?.clientMsgId || tradeCommit?.tradeId || '',
        ].filter(Boolean).join(':')
      : '';
    if (inventoryTransactionId && appliedInventoryTransactionIdsRef.current.has(inventoryTransactionId)) {
      debugLanFlow('PLAYER_INVENTORY_TRANSACTION_DUPLICATE_SKIPPED', {
        eventId: event?.id,
        sourceClientMsgId,
        action,
        transactionId: inventoryTransactionId,
        tradeId: tradeCommit?.tradeId,
        targetKey: tradeCommit?.targetKey || patch.targetKey,
      });
      return;
    }
    const actionUsesAuthoritativeDeltas = Boolean(
      shouldTrustAuthoritativeSnapshot &&
      itemDeltas.length > 0 &&
      ['transfer_in', 'grant'].includes(action)
    );
    const actionUsesTradeCommitReconciliation = Boolean(
      shouldTrustAuthoritativeSnapshot &&
      action === 'trade_commit' &&
      itemDeltas.length > 0
    );
    const actionUsesSafeRemovalResolution = Boolean(
      shouldTrustAuthoritativeSnapshot &&
      itemDeltas.length > 0 &&
      ['transfer_out', 'remove', 'consume'].includes(action)
    );

    // v71: inventory_patch com itemDeltas deve ser tratado como transacao.
    // O log mostrou transfer_in com delta correto, mas snapshot/equipment sem o item novo;
    // por isso doacao/envio falhava. Para add/trade_commit nao dependemos mais do snapshot.
    if (actionUsesTradeCommitReconciliation) {
      // v81: trade_commit é sempre determinístico por itemDeltas.
      // Não use snapshot para decidir a troca, porque com 5+ jogadores/snapshots
      // simultâneos ele pode estar correto para um lado e stale para o outro.
      nextEquipment = repairTradeCommitEquipmentFromDeltas(currentEquipment, incomingEquipment, itemDeltas);
      debugLanFlow('PLAYER_TRADE_COMMIT_APPLIED_FROM_AUTHORITATIVE_DELTAS', {
        eventId: event?.id,
        sourceClientMsgId,
        action,
        targetKey: (patch as any).tradeCommit?.targetKey || patch.targetKey,
        deltaCount: itemDeltas.length,
        incomingSnapshotQty: itemDeltas.map((delta: any) => ({
          mode: delta?.mode,
          name: delta?.item?.name,
          qty: getSheetInventoryItemQtyFromEquipment(incomingEquipment, delta?.item),
        })),
        finalQty: itemDeltas.map((delta: any) => ({
          mode: delta?.mode,
          name: delta?.item?.name,
          qty: getSheetInventoryItemQtyFromEquipment(nextEquipment, delta?.item),
        })),
      });
    } else if (actionUsesAuthoritativeDeltas) {
      nextEquipment = resolveSheetInventoryPatchEquipment(currentEquipment, incomingEquipment, itemDeltas);
      debugLanFlow('PLAYER_INVENTORY_PATCH_APPLIED_FROM_AUTHORITATIVE_DELTAS', {
        eventId: event?.id,
        sourceClientMsgId,
        action,
        targetKey: (patch as any).tradeCommit?.targetKey || patch.targetKey,
        deltaCount: itemDeltas.length,
        itemDeltas: itemDeltas.map((delta: any) => ({
          mode: delta?.mode,
          name: delta?.item?.name,
          qty: delta?.qty || delta?.item?.qty || 1,
          stackKey: delta?.stackKey || delta?.item?.stackKey,
        })),
      });
    } else if (actionUsesSafeRemovalResolution) {
      // Para saidas/consumo, pode existir remocao otimista local. Se esse patch
      // for o ACK da propria acao, nao reaplicamos o delta para nao subtrair 2x.
      nextEquipment = matchesPendingCommand && pendingInventory?.equipment
        ? normalizeSheetEquipment(pendingInventory.equipment)
        : itemDeltas.reduce((equipment, delta) => (
            applySheetInventoryDeltaToEquipment(equipment, delta)
          ), currentEquipment);
      if (matchesPendingCommand) {
        debugLanFlow('PLAYER_INVENTORY_PATCH_MATCHED_PENDING_REMOVAL_NO_DOUBLE_APPLY', {
          eventId: event?.id,
          sourceClientMsgId,
          action,
          deltaCount: itemDeltas.length,
        });
      }
    } else if (shouldTrustAuthoritativeSnapshot) {
      nextEquipment = incomingEquipment;
    } else if (itemDeltas.length > 0) {
      nextEquipment = itemDeltas.reduce((equipment, delta) => (
        applySheetInventoryDeltaToEquipment(equipment, delta)
      ), currentEquipment);
    } else if (String(patch.action || '') === 'grant' && itemDelta?.mode === 'add' && itemDelta.item && typeof itemDelta.item === 'object') {
      const deltaItem = itemDelta.item as Record<string, any>;
      const deltaQty = Math.max(1, Math.floor(Number(itemDelta.qty) || 1));
      nextEquipment = {
        ...currentEquipment,
        bag: mergeSheetInventoryItemIntoBag(currentEquipment.bag, deltaItem, deltaQty),
      };
    } else if ((String(patch.action || '') === 'remove' || itemDelta?.mode === 'remove') && itemDelta?.item && typeof itemDelta.item === 'object') {
      const deltaItem = itemDelta.item as Record<string, any>;
      const deltaQty = Math.max(1, Math.floor(Number(itemDelta.qty) || 1));
      nextEquipment = removeSheetInventoryItemFromEquipment(currentEquipment, deltaItem, deltaQty);
    }

    const pendingJson = pendingInventory ? JSON.stringify(normalizeSheetEquipment(pendingInventory.equipment)) : '';
    const incomingJson = JSON.stringify(nextEquipment);

    if (
      pendingIsRecent &&
      !matchesPendingCommand &&
      pendingJson &&
      pendingJson !== incomingJson &&
      itemDeltas.length === 0 &&
      (action === 'replace' || action === 'self_update')
    ) {
      debugLanFlow('PLAYER_IGNORED_STALE_SELF_INVENTORY_REPLACE_DURING_PENDING_PATCH', {
        eventId: event?.id,
        action,
        sourceClientMsgId,
        pendingClientMsgId: pendingInventory?.clientMsgId,
        authoritative: shouldTrustAuthoritativeSnapshot,
      });
      return;
    }

    if (
      pendingIsRecent &&
      !matchesPendingCommand &&
      !shouldTrustAuthoritativeSnapshot &&
      pendingJson &&
      pendingJson !== incomingJson &&
      (eventId.startsWith('checkpoint_inventory_') || action === 'replace' || action === 'self_update')
    ) {
      debugLanFlow('PLAYER_IGNORED_STALE_INVENTORY_ECHO', {
        eventId: event?.id,
        action,
        sourceClientMsgId,
        pendingClientMsgId: pendingInventory?.clientMsgId,
        reason: patch.reason,
      });
      return;
    }

    if (matchesPendingCommand || (pendingIsRecent && pendingJson === incomingJson)) {
      pendingSelfInventoryStateRef.current = null;
    }

    const rawStatsPatch = event?.statsPatch && typeof event.statsPatch === 'object'
      ? event.statsPatch as Record<string, any>
      : null;
    const nextStatsPatch = buildSheetStatsWithDerivedEquipMods(
      rawStatsPatch ? { ...(currentCharacter.stats || {}), ...rawStatsPatch } : currentCharacter.stats,
      nextEquipment,
    );
    const previousBaseCon = Math.floor(Number(currentCharacter.stats?.CON || 10)) || 10;
    const nextBaseCon = Math.floor(Number(nextStatsPatch?.CON || previousBaseCon)) || previousBaseCon;
    const baseConHpDelta = (Math.floor((nextBaseCon - 10) / 2) - Math.floor((previousBaseCon - 10) / 2)) * Math.max(1, Number(currentCharacter.level || 1));
    const nextHpMaxFromBaseCon = baseConHpDelta ? Math.max(1, Number(currentCharacter.hp_max || 0) + baseConHpDelta) : Number(currentCharacter.hp_max || 0);
    const nextHpCurrentFromBaseCon = baseConHpDelta ? Math.max(0, Number(currentCharacter.hp_current || 0) + baseConHpDelta) : Number(currentCharacter.hp_current || 0);

    // Multiplayer: inventario/atributos recebidos do host devem aparecer na UI imediatamente.
    // SQLite e persistencia local nao podem bloquear a sensacao de tempo real.
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = { ...prev, equipment: nextEquipment, stats: nextStatsPatch, hp_max: nextHpMaxFromBaseCon, hp_current: nextHpCurrentFromBaseCon };
      characterRef.current = merged;
      return merged;
    });

    if (inventoryTransactionId) {
      appliedInventoryTransactionIdsRef.current.add(inventoryTransactionId);
      debugLanFlow('PLAYER_INVENTORY_TRANSACTION_MARKED_APPLIED', {
        eventId: event?.id,
        action,
        transactionId: inventoryTransactionId,
        tradeId: tradeCommit?.tradeId,
      });
    }

    if (event?.sessionId) {
      const selfKey = makeLanCharacterKey(event.sessionId, currentCharacter);
      const cacheKey = `${event.sessionId}:${selfKey}`;
      const eventRevision = Math.max(0, Math.floor(Number(event.entityRevision || 0) || 0));
      const lastInventorySnapshot = lastAuthoritativeSnapshotInventoryRef.current[cacheKey];
      lastAuthoritativeSnapshotInventoryRef.current[cacheKey] = {
        revision: Math.max(eventRevision, lastInventorySnapshot?.revision || 0),
        fingerprint: getSheetEquipmentFingerprint(nextEquipment),
        at: Date.now(),
      };
    }

    const persistCharacterId = Number(currentCharacter.id);
    const persistEquipment = normalizeSheetEquipment(nextEquipment);
    const persistStats = nextStatsPatch;
    const persistHpMax = nextHpMaxFromBaseCon;
    const persistHpCurrent = nextHpCurrentFromBaseCon;
    const persistEventId = event?.id;
    inventoryPersistenceQueueRef.current = inventoryPersistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await db.runAsync(
          `UPDATE characters SET equipment = ?, stats = ?, hp_max = ?, hp_current = ? WHERE id = ?`,
          [JSON.stringify(persistEquipment), JSON.stringify(persistStats), persistHpMax, persistHpCurrent, persistCharacterId]
        );
        await syncCharacterInventoryForEquipment(db, persistCharacterId, persistEquipment).catch(() => undefined);
        debugLanFlow('PLAYER_INVENTORY_PATCH_PERSISTED_ASYNC', {
          eventId: persistEventId,
          action,
          characterId: persistCharacterId,
        });
      })
      .catch((error) => {
        debugLanFlow('PLAYER_INVENTORY_PATCH_PERSIST_ASYNC_FAILED', {
          eventId: persistEventId,
          action,
          characterId: persistCharacterId,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }, [db, lanInfo?.sessionId]);

  const applyAuthoritativeSelfInventoryFromPayload = useCallback((
    nextPayload: LanSessionPayload | null | undefined,
    sessionValue: string,
    source: string,
  ) => {
    if (LAN_ENGINE_PROJECTION_MODE && getLanProjection(sessionValue)) {
      debugLanFlow('PLAYER_PAYLOAD_INVENTORY_SKIPPED_PROJECTION_SOURCE_CUT6', {
        sessionId: sessionValue,
        source,
        decision: 'projection_is_authoritative',
      });
      return;
    }
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !nextPayload?.state?.players?.length || !sessionValue) return;

    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    const officialSelf: any = findSelfLanPlayerInPayload(nextPayload, sessionValue, currentCharacter);
    if (!officialSelf?.equipment) return;

    const officialEquipment = normalizeSheetEquipment(officialSelf.equipment);
    const currentEquipment = normalizeSheetEquipment(currentCharacter.equipment);
    const officialFingerprint = JSON.stringify(officialEquipment);
    const currentFingerprint = JSON.stringify(currentEquipment);
    if (!officialFingerprint || officialFingerprint === currentFingerprint) return;

    const pendingInventory = pendingSelfInventoryStateRef.current;
    const pendingIsRecent = Boolean(pendingInventory && Date.now() - pendingInventory.at < 15000);
    const pendingFingerprint = pendingInventory ? getSheetEquipmentFingerprint(pendingInventory.equipment) : '';
    if (pendingIsRecent && pendingFingerprint) {
      if (pendingFingerprint === officialFingerprint) {
        pendingSelfInventoryStateRef.current = null;
      } else {
        debugLanFlow('PLAYER_SNAPSHOT_INVENTORY_RECONCILE_SKIPPED_PENDING_SELF_PATCH', {
          sessionId: sessionValue,
          selfKey,
          source,
        });
        return;
      }
    }

    const revision = Math.max(
      0,
      Math.floor(Number(officialSelf.revisionSeq ?? officialSelf.revision_seq ?? officialSelf.revision ?? 0)) || 0
    );
    const cacheKey = `${sessionValue}:${selfKey}`;
    const last = lastAuthoritativeSnapshotInventoryRef.current[cacheKey];
    const payloadLooksGeneral = /payload|snapshot|resync|syncLanFromHost|live_payload|refresh/i.test(String(source || ''));
    if (last && payloadLooksGeneral && Date.now() - last.at < 60000 && last.fingerprint !== officialFingerprint) {
      debugLanFlow('PLAYER_SNAPSHOT_INVENTORY_RECONCILE_SKIPPED_RECENT_DIRECT_PATCH', {
        sessionId: sessionValue,
        selfKey,
        source,
        revision,
        lastRevision: last.revision,
      });
      return;
    }
    if (last && revision > 0 && revision < last.revision) {
      debugLanFlow('PLAYER_SNAPSHOT_INVENTORY_RECONCILE_SKIPPED_OLDER_REVISION', {
        sessionId: sessionValue,
        selfKey,
        source,
        revision,
        lastRevision: last.revision,
      });
      return;
    }
    if (last && revision === last.revision && last.fingerprint === officialFingerprint) return;

    const nextStatsPatch = buildSheetStatsWithDerivedEquipMods(currentCharacter.stats, officialEquipment);
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = { ...prev, equipment: officialEquipment, stats: nextStatsPatch };
      characterRef.current = merged;
      return merged;
    });

    lastAuthoritativeSnapshotInventoryRef.current[cacheKey] = {
      revision: Math.max(revision, last?.revision || 0),
      fingerprint: officialFingerprint,
      at: Date.now(),
    };

    const persistCharacterId = Number(currentCharacter.id);
    inventoryPersistenceQueueRef.current = inventoryPersistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await db.runAsync(
          `UPDATE characters SET equipment = ?, stats = ? WHERE id = ?`,
          [JSON.stringify(officialEquipment), JSON.stringify(nextStatsPatch), persistCharacterId]
        );
        await syncCharacterInventoryForEquipment(db, persistCharacterId, officialEquipment).catch(() => undefined);
        debugLanFlow('PLAYER_SNAPSHOT_INVENTORY_RECONCILED_FROM_HOST', {
          sessionId: sessionValue,
          selfKey,
          source,
          revision,
          characterId: persistCharacterId,
          bagCount: officialEquipment.bag.length,
        });
      })
      .catch((error) => {
        debugLanFlow('PLAYER_SNAPSHOT_INVENTORY_RECONCILE_PERSIST_FAILED', {
          sessionId: sessionValue,
          selfKey,
          source,
          revision,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }, [db]);


  const applyAuthoritativeSelfStateFromPayload = useCallback((
    nextPayload: LanSessionPayload | null | undefined,
    sessionValue: string,
    source: string,
    options?: { force?: boolean },
  ) => {
    if (LAN_ENGINE_PROJECTION_MODE && getLanProjection(sessionValue)) {
      debugLanFlow('PLAYER_PAYLOAD_STATE_SKIPPED_PROJECTION_SOURCE_CUT6', {
        sessionId: sessionValue,
        source,
        force: Boolean(options?.force),
        decision: 'projection_is_authoritative',
      });
      return;
    }
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !nextPayload?.state?.players?.length || !sessionValue) return;

    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    const officialSelf: any = findSelfLanPlayerInPayload(nextPayload, sessionValue, currentCharacter);
    if (!officialSelf) return;

    const revision = Math.max(
      0,
      Math.floor(Number(officialSelf.revisionSeq ?? officialSelf.revision_seq ?? officialSelf.revision ?? 0)) || 0,
    );
    const cacheKey = `${sessionValue}:${selfKey}`;
    const lastSnapshot = lastAuthoritativeSnapshotPlayerRef.current[cacheKey];
    const lastPatch = lastAuthoritativePlayerPatchRef.current;

    if (!options?.force && revision > 0 && lastPatch.entityRevision > 0 && revision < lastPatch.entityRevision) {
      debugLanFlow('PLAYER_SNAPSHOT_STATE_RECONCILE_SKIPPED_OLDER_REVISION', {
        sessionId: sessionValue,
        selfKey,
        source,
        revision,
        lastPatchRevision: lastPatch.entityRevision,
      });
      return;
    }

    const localLevel = Math.max(1, Math.floor(Number((currentCharacter as any).level || 1) || 1));
    const localHpMax = Math.max(0, Math.floor(Number((currentCharacter as any).hp_max || (currentCharacter as any).hpMax || 0) || 0));
    const officialLevel = Math.max(1, Math.floor(Number(officialSelf.level || 1) || 1));
    const officialHpMax = Math.max(0, Math.floor(Number(officialSelf.hpMax || officialSelf.hp_max || 0) || 0));
    if ((localLevel > officialLevel || localHpMax > officialHpMax) && /payload|snapshot|resync/i.test(String(source || ''))) {
      debugLanFlow('PLAYER_SNAPSHOT_STATE_RECONCILE_SKIPPED_OLDER_LEVELUP_V90', {
        sessionId: sessionValue,
        selfKey,
        source,
        force: Boolean(options?.force),
        localLevel,
        officialLevel,
        localHpMax,
        officialHpMax,
        revision,
      });
      return;
    }

    const officialEffects = filterRenderableLanEffects(Array.isArray(officialSelf.effects) ? officialSelf.effects : [])
      .filter((effect) => !isSheetEffectTombstoned(sessionValue, effect));
    const officialSnapshot = officialSelf.characterSnapshot && typeof officialSelf.characterSnapshot === 'object'
      ? officialSelf.characterSnapshot as Record<string, unknown>
      : {};
    const nextProgressionValues = {
      level: Math.max(1, Math.floor(Number(officialSelf.level ?? officialSnapshot.level ?? currentCharacter.level ?? 1) || 1)),
      class: String(officialSelf.className ?? officialSnapshot.class ?? currentCharacter.class ?? '').trim() || currentCharacter.class,
      stats: officialSelf.stats || officialSnapshot.stats || currentCharacter.stats,
    };
    const nextValues = {
      hp_current: Math.max(0, Math.floor(Number(officialSelf.hpCurrent ?? currentCharacter.hp_current ?? 0) || 0)),
      hp_max: Math.max(0, Math.floor(Number(officialSelf.hpMax ?? currentCharacter.hp_max ?? 0) || 0)),
      temp_hp: Math.max(0, Math.floor(Number(officialSelf.tempHp ?? currentCharacter.temp_hp ?? 0) || 0)),
      xp: Math.max(0, Math.floor(Number(officialSelf.xp ?? currentCharacter.xp ?? 0) || 0)),
      gp: Math.max(0, Math.floor(Number(officialSelf.gp ?? currentCharacter.gp ?? 0) || 0)),
      sp: Math.max(0, Math.floor(Number(officialSelf.sp ?? currentCharacter.sp ?? 0) || 0)),
      cp: Math.max(0, Math.floor(Number(officialSelf.cp ?? currentCharacter.cp ?? 0) || 0)),
    };
    const nextEffectsJson = JSON.stringify(officialEffects);
    const fingerprint = JSON.stringify({ nextValues, nextProgressionValues, effects: officialEffects });

    if (lastSnapshot && lastSnapshot.revision === revision && lastSnapshot.fingerprint === fingerprint) {
      return;
    }

    const pseudoEvent: LanSessionEvent = {
      id: `payload_state_${sessionValue}_${revision || Date.now()}`,
      sessionId: sessionValue,
      type: 'player_patch',
      fromKey: 'master',
      toKey: selfKey,
      entityType: 'player',
      entityId: selfKey,
      entityRevision: revision,
      seq: revision || Date.now(),
      serverSeq: revision || Date.now(),
      numberPatch: {
        hpCurrent: nextValues.hp_current,
        hpMax: nextValues.hp_max,
        tempHp: nextValues.temp_hp,
        xp: nextValues.xp,
        gp: nextValues.gp,
        sp: nextValues.sp,
        cp: nextValues.cp,
      },
      message: 'Reconciliacao autoritativa por payload.',
      createdAt: new Date().toISOString(),
    } as LanSessionEvent;

    characterRef.current = {
      ...(characterRef.current || currentCharacter),
      ...nextProgressionValues,
      ...nextValues,
      active_effects: officialEffects,
      active_effects_json: nextEffectsJson,
    };
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = {
        ...prev,
        ...nextProgressionValues,
        ...nextValues,
        active_effects: officialEffects,
        active_effects_json: nextEffectsJson,
      };
      characterRef.current = merged;
      return merged;
    });

    updateSelfLanBarFromAuthoritativePatch(sessionValue, nextValues, pseudoEvent, { publicEffects: officialEffects });

    lastAuthoritativeSnapshotPlayerRef.current[cacheKey] = {
      revision,
      fingerprint,
      at: Date.now(),
    };
    if (revision > 0) {
      lastAuthoritativePlayerPatchRef.current = {
        seq: Math.max(lastAuthoritativePlayerPatchRef.current.seq, Number(pseudoEvent.seq || 0)),
        entityRevision: Math.max(lastAuthoritativePlayerPatchRef.current.entityRevision, revision),
        appliedAt: Date.now(),
      };
    }

    void db.runAsync(
      `UPDATE characters
       SET level = ?, class = ?, stats = ?, hp_current = ?, hp_max = ?, temp_hp = ?, xp = ?, gp = ?, sp = ?, cp = ?, active_effects_json = ?
       WHERE id = ?`,
      [
        nextProgressionValues.level,
        nextProgressionValues.class,
        typeof nextProgressionValues.stats === 'string' ? nextProgressionValues.stats : JSON.stringify(nextProgressionValues.stats || {}),
        nextValues.hp_current,
        nextValues.hp_max,
        nextValues.temp_hp,
        nextValues.xp,
        nextValues.gp,
        nextValues.sp,
        nextValues.cp,
        nextEffectsJson,
        Number(currentCharacter.id),
      ],
    ).catch((error) => {
      debugLanFlow('PLAYER_SNAPSHOT_STATE_RECONCILE_PERSIST_FAILED', {
        sessionId: sessionValue,
        selfKey,
        source,
        revision,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    debugLanFlow('PLAYER_SNAPSHOT_STATE_RECONCILED_FROM_HOST', {
      sessionId: sessionValue,
      selfKey,
      source,
      force: Boolean(options?.force),
      revision,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
      effectCount: officialEffects.length,
    });
  }, [db, updateSelfLanBarFromAuthoritativePatch]);

  const terminateLanSessionFromMaster = useCallback(async (
    sessionValue: string,
    source: string,
    event?: LanSessionEvent,
  ) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;
    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);

    sessionTerminatedRef.current = sessionValue;
    // Evento terminal: a UI deve sair do modo LAN imediatamente. A limpeza SQLite roda em background.
    setLanSessionStatus(null);
    setLanInfo(null);
    setLanPlayers([]);
    setIncomingTrades([]);
    setPendingEffectSave(null);
    setSaveManualValue('');
    useLanRealtimeStore.getState().resetSession(sessionValue);
    resetLanClientConnection();
    traceApp('LAN_JOIN', 'PLAYER_TERMINATION_FLAG_SET', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event?.id,
      eventType: event?.type,
    });
    traceApp('NAVIGATION', 'PLAYER_NAVIGATE_HOME_AFTER_END_FAST_V108', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    router.replace('/' as any);

    if (event) {
      void rememberLanSessionEvent(db, event).catch(() => false);
    }
    await clearLanSessionEffectsFromCharacter(sessionValue);
    debugLanFlow('PLAYER_CLEAR_TEMP_SESSION_EFFECTS', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_PRESERVE_OFFICIAL_REWARDS', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    await unlinkCharacterFromLanSession(db, Number(currentCharacter.id), sessionValue).catch(() => {});
    await db.runAsync(
      `UPDATE lan_local_character_bindings
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`,
      [sessionValue]
    ).catch(() => {});
    debugLanFlow('PLAYER_LAN_BINDING_ENDED', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_CHARACTER_UNLINKED_FROM_SESSION', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_KEEP_CHARACTER_OFFLINE', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    await markLanConnectionStatus(db, {
      sessionId: sessionValue,
      deviceId: selfKey,
      role: 'player',
      playerKey: selfKey,
      status: 'offline',
    }).catch(() => {});
    await db.runAsync(
      `UPDATE lan_sessions
       SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sessionValue]
    ).catch(() => {});

    useLanRealtimeStore.getState().resetSession();
    resetLanClientConnection();
    traceApp('LAN_JOIN', 'PLAYER_STOP_POLLING_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    debugLanFlow('PLAYER_STOP_RESYNC_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    debugLanFlow('PLAYER_STOP_HEARTBEAT_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    setLanInfo(null);
    setLanSessionStatus(null);
    setLanPlayers([]);
    setIncomingTrades([]);
    traceApp('LAN_JOIN', 'PLAYER_LAN_INFO_CLEARED', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
  }, [clearLanSessionEffectsFromCharacter, db, router]);

  const syncLanFromHost = useCallback(async () => {
    if (!lanInfo?.sessionId || !character?.id) return;
    if (LAN_ENGINE_PROJECTION_MODE && lanInfo.joinUrl && getLanProjection(lanInfo.sessionId)) {
      debugLanFlow('PLAYER_SYNC_LAN_FROM_HOST_SKIPPED_PROJECTION_SOURCE_CUT6', {
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        decision: 'request_resync_only_projection_authoritative',
      });
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      await requestLanSessionResync(lanInfo.joinUrl, {
        sessionId: lanInfo.sessionId,
        playerKey: selfKey,
        lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
        includeGlobal: true,
        forceReconnect: true,
      }).catch(() => false);
      return;
    }
    if (sessionTerminatedRef.current === lanInfo.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'syncLanFromHost',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
      });
      return;
    }

    const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
    const startedAt = Date.now();
    traceFunctionCall('syncLanFromHost', {
      lanInfo,
      selfKey,
    }, {
      screen: 'sheet',
      source: 'foreground_resync',
      sessionId: lanInfo.sessionId,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });

    try {
      const localInfo = await getLocalLanSessionForCharacter(db, Number(character.id));
      const recovered = await fetchLanPayloadWithRecovery(lanInfo, localInfo?.payloadJson);
      const nextPayload = recovered.payload;
      const nextInfo = {
        ...recovered.info,
        hostInstanceId: nextPayload.session.hostInstanceId,
      };

      if (lanInfo.hostInstanceId && nextInfo.hostInstanceId && nextInfo.hostInstanceId !== lanInfo.hostInstanceId) {
        traceApp('LAN_JOIN', 'PLAYER_HOST_INSTANCE_CHANGED_BOOTSTRAP', {
          screen: 'sheet',
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          before: { hostInstanceId: lanInfo.hostInstanceId },
          after: { hostInstanceId: nextInfo.hostInstanceId },
        });
        useLanRealtimeStore.getState().resetSession(nextInfo.sessionId);
      }
      if (nextInfo.joinUrl !== lanInfo.joinUrl || nextInfo.hostInstanceId !== lanInfo.hostInstanceId) {
        setLanInfo(nextInfo);
      }

      // Payload completo é cache estrutural. Salva para entrada/resync, mas não aplica
      // HP/XP/moedas/efeitos/inventário por snapshot durante sessão viva.
      await saveLanSession(db, nextPayload, nextInfo.joinUrl, { isMaster: false });
      traceApp('PAYLOAD_RECEIVED', 'PLAYER_SNAPSHOT_LIVE_FIELDS_IGNORED', {
        screen: 'sheet',
        source: 'syncLanFromHost',
        sessionId: nextInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        status: nextPayload.state?.status,
        playerCount: nextPayload.state?.players?.length || 0,
      });

      if (nextPayload.state?.status === 'ended') {
        debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
          source: 'syncLanFromHost_payload_status',
          sessionId: nextInfo.sessionId,
          selfKey,
          status: nextPayload.state.status,
        });
        await terminateLanSessionFromMaster(nextInfo.sessionId, 'syncLanFromHost');
        return;
      }

      if (nextPayload.state?.status === 'paused') {
        setLanSessionStatus('paused');
        mergeLanPlayersFromPayloadCache(nextPayload, selfKey, 'payload_cache');
        debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          selfKey,
        });
        debugLanFlow('PLAYER_KEEP_BINDING_AFTER_PAUSE', {
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          selfKey,
        });
        return;
      }

      const officialSelf = findSelfLanPlayerInPayload(nextPayload, nextInfo.sessionId, character);

      // v34: subir de nivel é autonomia do jogador. O snapshot do mestre pode estar
      // atrasado por alguns segundos; isso não deve abrir solicitação/revisão para o mestre.
      // Só reanunciamos presença quando o jogador ainda não existe no roster oficial.
      if (!officialSelf) {
        await notifyMasterReconnect(nextPayload, nextInfo, character, {
          reviewSnapshot: false,
          force: false,
        });
      }

      setLanSessionStatus(nextPayload.state?.status || null);
      const lastLivePatchAgeMs = lastAuthoritativePlayerPatchRef.current.appliedAt
        ? Date.now() - lastAuthoritativePlayerPatchRef.current.appliedAt
        : Number.POSITIVE_INFINITY;
      const allowPayloadNumberReconcile = lastLivePatchAgeMs > 12000;
      mergeLanPlayersFromPayloadCache(nextPayload, selfKey, 'payload_cache_foreground_recovery', { forceNumbers: allowPayloadNumberReconcile });
      if (allowPayloadNumberReconcile) {
        applyAuthoritativeSelfStateFromPayload(nextPayload, nextInfo.sessionId, 'syncLanFromHost', { force: true });
      } else {
        debugLanFlow('PLAYER_PAYLOAD_NUMBER_RECONCILE_SKIPPED_RECENT_LIVE_PATCH_V92', {
          sessionId: nextInfo.sessionId,
          selfKey,
          source: 'syncLanFromHost',
          lastLivePatchAgeMs,
        });
      }
      syncSelfLanRosterFromCharacter(nextInfo.sessionId, 'syncLanFromHost_after_payload');
      applyAuthoritativeSelfInventoryFromPayload(nextPayload, nextInfo.sessionId, 'syncLanFromHost');

      await markLanConnectionStatus(db, {
        sessionId: nextInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'online',
      }).catch(() => {});

      await requestLanSessionResync(nextInfo.joinUrl, {
        sessionId: nextInfo.sessionId,
        playerKey: selfKey,
        lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        knownRevisions: getKnownLanEntityRevisions(nextInfo.sessionId),
      }).catch(() => {});
      traceFunctionReturn('syncLanFromHost', {
        sessionId: nextInfo.sessionId,
        playerCount: nextPayload.state?.players?.length || 0,
        status: nextPayload.state?.status,
      }, {
        screen: 'sheet',
        source: 'foreground_resync',
        sessionId: nextInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await markLanConnectionStatus(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'offline',
      }).catch(() => {});
      console.warn('[LAN] Não foi possível re-sincronizar com o mestre:', error);
      traceError('RESYNC_REQUEST', 'SYNC_LAN_FROM_HOST_ERROR', error, {
        screen: 'sheet',
        source: 'foreground_resync',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        durationMs: Date.now() - startedAt,
      });
    }
  }, [db, lanInfo, character?.id, character?.name, character?.level, character?.xp, fetchLanPayloadWithRecovery, notifyMasterReconnect, terminateLanSessionFromMaster, applyAuthoritativeSelfInventoryFromPayload, applyAuthoritativeSelfStateFromPayload, syncSelfLanRosterFromCharacter]);

  useLanRealtimePlayerPatches({
    enabled: Boolean(
      character &&
      lanInfo?.sessionId &&
      lanInfo?.joinUrl &&
      sessionTerminatedRef.current !== lanInfo.sessionId
    ),
    joinUrl: lanInfo?.joinUrl,
    sessionId: lanInfo?.sessionId,
    selfKey: lanInfo?.sessionId && character
      ? makeLanCharacterKey(lanInfo.sessionId, character)
      : '',
    characterName: character?.name,
    paused: lanSessionStatus === 'paused',
    reconnectEpoch: lanReconnectEpoch,
    runtimeManagedExternally: Boolean(isLanPlayerRuntime && lanInfo?.sessionId),
    onPayloadUpdate: (payload, reason) => {
      if (!payload || !lanInfo?.sessionId || !character) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      setLanSessionStatus(payload.state?.status || null);
      const forcePayloadReconcile = String(reason || '').includes('resync') || String(reason || '').includes('foreground') || String(reason || '').includes('recovery');
      const lastLivePatchAgeMs = lastAuthoritativePlayerPatchRef.current.appliedAt
        ? Date.now() - lastAuthoritativePlayerPatchRef.current.appliedAt
        : Number.POSITIVE_INFINITY;
      const allowPayloadNumberReconcile = forcePayloadReconcile && lastLivePatchAgeMs > 12000;
      mergeLanPlayersFromPayloadCache(payload, selfKey, `live_payload_${reason || 'update'}`, { forceNumbers: allowPayloadNumberReconcile });
      if (allowPayloadNumberReconcile) {
        applyAuthoritativeSelfStateFromPayload(payload, lanInfo.sessionId, `live_payload_${reason || 'update'}`, { force: true });
      } else if (forcePayloadReconcile) {
        debugLanFlow('PLAYER_LIVE_PAYLOAD_NUMBER_RECONCILE_SKIPPED_RECENT_LIVE_PATCH_V92', {
          sessionId: lanInfo.sessionId,
          selfKey,
          reason,
          lastLivePatchAgeMs,
        });
      }
      syncSelfLanRosterFromCharacter(lanInfo.sessionId, `live_payload_${reason || 'update'}_after_payload`);
      applyAuthoritativeSelfInventoryFromPayload(payload, lanInfo.sessionId, `live_payload_${reason || 'update'}`);
    },
    onNumberPatch: async (patch, event) => {
      traceFunctionCall('useLanRealtimePlayerPatches.onNumberPatch', { patch, event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        eventId: event.id,
        eventType: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch,
      });
      debugLanFlow('PLAYER_PATCH_RECEIVED', {
        eventId: event.id,
        seq: event.seq,
        serverSeq: event.serverSeq,
        entityRevision: event.entityRevision,
        toKey: event.toKey,
        toName: event.toName,
        patch,
      });
      const nextValues = await applyLanNumberPatchToCharacter(patch, event);
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        if (nextValues) {
          const normalizedRevision = normalizeLanPlayerPatchRevision(event);
          lastAuthoritativePlayerPatchRef.current = {
            seq: Number(event.seq ?? event.serverSeq ?? 0) || lastAuthoritativePlayerPatchRef.current.seq,
            entityRevision: normalizedRevision || lastAuthoritativePlayerPatchRef.current.entityRevision,
            appliedAt: Date.now(),
          };
          updateSelfLanBarFromAuthoritativePatch(lanInfo.sessionId, nextValues, event);
        }
        // v82: persistência de evento/aplicação roda depois da UI e nunca segura
        // a fila viva. Com 5-20 jogadores, ACK/SQLite não pode atrasar HP/troca.
        void rememberLanSessionEvent(db, event).catch(() => false);
        void markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        }).catch(() => undefined);
      }
    },
    onEffectPatch: async (patch, event) => {
      if (!patch) {
        debugLanFlow('PLAYER_EFFECT_PATCH_SKIPPED_EMPTY_PATCH', {
          eventId: event.id,
          seq: event.seq,
          entityRevision: event.entityRevision,
          eventType: event.type,
        });
        return;
      }

      const effectPatch = patch;

      traceFunctionCall('useLanRealtimePlayerPatches.onEffectPatch', { patch: effectPatch, event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        eventId: event.id,
        eventType: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch: effectPatch,
      });
      await applyLanEffectPatchToCharacter(effectPatch, event);
      void rememberLanSessionEvent(db, event).catch(() => false);
      debugLanFlow('PLAYER_EFFECT_PATCH_APPLIED', {
        eventId: event.id,
        seq: event.seq,
        entityRevision: event.entityRevision,
        addCount: effectPatch.add?.length || 0,
        updateCount: effectPatch.update?.length || 0,
        removeCount: effectPatch.remove?.length || 0,
      });
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        void markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        }).catch(() => undefined);
      }
    },
    onInventoryPatch: async (patch, event) => {
      debugLanFlow('PLAYER_INVENTORY_PATCH_RECEIVED', {
        eventId: event.id,
        seq: event.seq,
        serverSeq: event.serverSeq,
        entityRevision: event.entityRevision,
        action: patch.action,
        targetKey: patch.targetKey,
        reason: patch.reason,
      });
      await applyLanInventoryPatchToCharacter(patch, event);
      pendingOutgoingItemSendsRef.current.clear();
      debugLanFlow(
        patch.action === 'grant' ? 'PLAYER_GRANTED_ITEM_APPLIED' : 'PLAYER_INVENTORY_PATCH_APPLIED',
        {
          eventId: event.id,
          seq: event.seq,
          entityRevision: event.entityRevision,
          action: patch.action,
          reason: patch.reason,
        }
      );

      // v82: persistência do log/aplicado não pode segurar a fila viva de inventory_patch.
      // Em troca repetida, a UI já foi atualizada por applyLanInventoryPatchToCharacter.
      // SQLite/histórico rodam em background; duplicidade é bloqueada por id/evento/transação.
      void rememberLanSessionEvent(db, event).catch(() => false);
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        void markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        }).catch(() => undefined);
      }
    },
    onStatsPatch: async (statsPatch, event) => {
      if (!character?.id || !lanInfo?.sessionId) return;
      debugLanFlow('PLAYER_STATS_PATCH_APPLY_DIRECT', {
        eventId: event.id,
        seq: event.seq,
        entityRevision: event.entityRevision,
        patch: statsPatch,
      });
      setCharacter((prev: any) => {
        if (!prev) return prev;
        const merged = { ...prev, stats: statsPatch };
        characterRef.current = merged;
        return merged;
      });
      void updateDB(
        { stats: statsPatch },
        { allowLanAuthoritativeCache: true, reason: 'lan_authoritative_stats_patch_direct' }
      );
      await rememberLanSessionEvent(db, event).catch(() => false);
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      await markLanEventsApplied(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        events: [event],
      }).catch(() => undefined);
    },
    onEvent: async (event) => {
      if (!lanInfo?.sessionId) return;
      await handleLanEvents([event], lanInfo.sessionId);
    },
    onSessionPatch: async (event) => {
      if (!character || !lanInfo?.sessionId) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      const sessionEventKey = String(event.id || `${event.type}:${event.sessionId}:${event.entityRevision || event.seq || event.createdAt || ''}`);
      const globalSessionKey = `${lanInfo.sessionId}:${sessionEventKey}`;
      if (GLOBAL_SESSION_PATCH_EVENT_KEYS.has(globalSessionKey) || handledSessionEventIdsRef.current.has(sessionEventKey)) {
        debugLanFlow('PLAYER_SESSION_PATCH_DUPLICATE_GLOBAL_SKIPPED', {
          eventId: event.id,
          sessionId: lanInfo.sessionId,
          eventType: event.type,
          status: event.sessionPatch?.status,
        });
        return;
      }
      GLOBAL_SESSION_PATCH_EVENT_KEYS.add(globalSessionKey);
      if (GLOBAL_SESSION_PATCH_EVENT_KEYS.size > 250) {
        const keep = Array.from(GLOBAL_SESSION_PATCH_EVENT_KEYS).slice(-120);
        GLOBAL_SESSION_PATCH_EVENT_KEYS.clear();
        keep.forEach((key) => GLOBAL_SESSION_PATCH_EVENT_KEYS.add(key));
      }
      handledSessionEventIdsRef.current.add(sessionEventKey);
      if (handledSessionEventIdsRef.current.size > 100) {
        handledSessionEventIdsRef.current = new Set(Array.from(handledSessionEventIdsRef.current).slice(-50));
      }
      debugLanFlow('PLAYER_SESSION_PATCH_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        eventType: event.type,
        selfKey,
        status: event.sessionPatch?.status,
      });
      traceApp('EVENT_RECEIVED', 'PLAYER_SESSION_PATCH_RECEIVED', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onSessionPatch',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        eventId: event.id,
        eventType: event.type,
        status: event.sessionPatch?.status,
      });

      if (!isLanSessionEndedEvent(event)) {
        const status = event.sessionPatch?.status;
        const hasTimePatch = event.sessionPatch?.currentTurn != null || event.sessionPatch?.elapsedMinutes != null;
        if (hasTimePatch) {
          const nextTurn = Math.max(1, Math.floor(Number(event.sessionPatch?.currentTurn || 1)));
          const nextElapsed = Math.max(0, Math.floor(Number(event.sessionPatch?.elapsedMinutes || 0)));
          await rememberLanSessionEvent(db, event).catch(() => false);
          await db.runAsync(
            `UPDATE lan_sessions
             SET current_turn = COALESCE(?, current_turn),
                 elapsed_minutes = COALESCE(?, elapsed_minutes),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND COALESCE(is_master, 0) = 0`,
            [event.sessionPatch?.currentTurn != null ? nextTurn : null, event.sessionPatch?.elapsedMinutes != null ? nextElapsed : null, lanInfo.sessionId]
          ).catch(() => {});
          debugLanFlow('PLAYER_SESSION_TIME_PATCH_APPLIED', {
            eventId: event.id,
            sessionId: lanInfo.sessionId,
            selfKey,
            currentTurn: event.sessionPatch?.currentTurn,
            elapsedMinutes: event.sessionPatch?.elapsedMinutes,
            advanceUnit: event.sessionPatch?.advanceUnit,
          });
          if (!status) return;
        }
        const currentLanStatus = lanSessionStatusRef.current;
        if (status === currentLanStatus && status === 'paused') {
          debugLanFlow('PLAYER_SESSION_PATCH_DUPLICATE_STATUS_SKIPPED', {
            eventId: event.id,
            sessionId: lanInfo.sessionId,
            status,
          });
          return;
        }
        if (status === 'paused' || status === 'active') {
          // Pausar/continuar e um evento de ciclo de vida. Atualize UI primeiro;
          // SQLite/cache nunca pode atrasar o botao/estado da ficha.
          setLanSessionStatus(status);
          lanSessionStatusRef.current = status;
          if (status === 'active') lastPausedAlertKeyRef.current = '';
          await rememberLanSessionEvent(db, event).catch(() => false);
          await db.runAsync(
            `UPDATE lan_sessions
             SET status = ?, active = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND COALESCE(is_master, 0) = 0`,
            [status, lanInfo.sessionId]
          ).catch(() => {});
          if (status === 'paused') {
            debugLanFlow('PLAYER_SESSION_PAUSED_RECEIVED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_SET_READ_ONLY_MODE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_KEEP_BINDING_AFTER_PAUSE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            const pausedAlertKey = `${lanInfo.sessionId}:paused:${event.id || event.entityRevision || ''}`;
            if (lastPausedAlertKeyRef.current !== pausedAlertKey && !GLOBAL_SESSION_PAUSE_ALERT_KEYS.has(pausedAlertKey)) {
              lastPausedAlertKeyRef.current = pausedAlertKey;
              GLOBAL_SESSION_PAUSE_ALERT_KEYS.add(pausedAlertKey);
              if (GLOBAL_SESSION_PAUSE_ALERT_KEYS.size > 80) {
                const keep = Array.from(GLOBAL_SESSION_PAUSE_ALERT_KEYS).slice(-40);
                GLOBAL_SESSION_PAUSE_ALERT_KEYS.clear();
                keep.forEach((key) => GLOBAL_SESSION_PAUSE_ALERT_KEYS.add(key));
              }
              debugLanFlow('PLAYER_SHOW_PAUSED_SESSION_ALERT', {
                eventId: event.id,
                sessionId: lanInfo.sessionId,
                selfKey,
              });
              showCustomAlert(
                'Sessao pausada pelo mestre',
                'A campanha continuara depois. Sua ficha ficara em modo leitura ate o mestre retomar.'
              );
            }
          } else {
            lastPausedAlertKeyRef.current = '';
            debugLanFlow('PLAYER_SESSION_RESUMED_RECEIVED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_RECONNECT_TO_RESUMED_SESSION', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_EXIT_READ_ONLY_MODE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_REUSE_EXISTING_BINDING_AFTER_RESUME', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            if (event.sessionPatch?.hostInstanceId) {
              setLanInfo((current) => current ? ({ ...current, hostInstanceId: event.sessionPatch?.hostInstanceId }) : current);
            }
            await requestLanSessionResync(lanInfo.joinUrl, {
              sessionId: lanInfo.sessionId,
              playerKey: selfKey,
              lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
              knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
            }).catch(() => {});
          }
          debugLanFlow(status === 'paused' ? 'PLAYER_SESSION_PAUSED' : 'PLAYER_SESSION_RESUMED', {
            eventId: event.id,
            sessionId: lanInfo.sessionId,
            selfKey,
          });
          traceApp('STATE_CHANGE', status === 'paused' ? 'PLAYER_SESSION_PAUSED' : 'PLAYER_SESSION_RESUMED', {
            screen: 'sheet',
            source: 'useLanRealtimePlayerPatches.onSessionPatch',
            sessionId: lanInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
            playerKey: selfKey,
            eventId: event.id,
            status,
          });
        }
        return;
      }

      debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        eventType: event.type,
        selfKey,
      });
      await terminateLanSessionFromMaster(lanInfo.sessionId, 'useLanRealtimePlayerPatches.onSessionPatch', event);
    },
    onKicked: async (event) => {
      if (!character || !lanInfo?.sessionId) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      traceFunctionCall('useLanRealtimePlayerPatches.onKicked', { event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });

      debugLanFlow('PLAYER_KICKED_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        selfKey,
        toKey: event.toKey,
        toName: event.toName,
      });

      await rememberLanSessionEvent(db, event).catch(() => false);
      await clearLanSessionEffectsFromCharacter(lanInfo.sessionId);
      await unlinkCharacterFromLanSession(db, Number(character.id), lanInfo.sessionId);
      debugLanFlow('PLAYER_UNLINK_DONE', {
        characterId: character.id,
        sessionId: lanInfo.sessionId,
        selfKey,
      });
      await markLanEventsApplied(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        events: [event],
      });
      debugLanFlow('PLAYER_KICKED_RUNTIME_APPLIED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        selfKey,
      });
      useLanRealtimeStore.getState().resetSession();
      resetLanClientConnection();
      setLanInfo(null);
      setLanSessionStatus(null);
      setLanPlayers([]);
      setIncomingTrades([]);

      showCustomAlert(
        'Removido da sessão',
        event.message || 'O mestre removeu este personagem da sessão LAN.',
        [{ text: 'OK', color: appColors.primary, onPress: () => router.replace(`/sheet?id=${character.id}` as any) }]
      );
    },
    onHostUnreachable: async (reason: string) => {
      if (!character || !lanInfo?.sessionId) return;
      const currentSessionId = lanInfo.sessionId;
      const selfKey = makeLanCharacterKey(currentSessionId, character);
      const localLanInfo = await getLocalLanSessionForCharacter(db, Number(character.id)).catch(() => null);
      const sessionIsPausedLocally = await isLanSessionLocallyPaused(
        currentSessionId,
        localLanInfo?.sessionId === currentSessionId ? localLanInfo?.payloadJson : null
      );

      // Regra v70:
      // host inalcançável NÃO significa fim de sessão. O mestre pode só ter aberto
      // outro app, a tela pode ter apagado por alguns segundos, ou o Android pode
      // suspender temporariamente o socket TCP. Portanto, não desvincule a ficha
      // automaticamente por ENETUNREACH/timeout. Desvincular só é permitido quando
      // vier evento explícito de session_ended, player_kicked ou ação manual.
      resetLanClientConnection();
      await markLanConnectionStatus(db, {
        sessionId: currentSessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'reconnecting',
      }).catch(() => {});

      traceApp('LAN_JOIN', sessionIsPausedLocally ? 'PLAYER_KEEP_BINDING_AFTER_PAUSED_HOST_UNREACHABLE' : 'PLAYER_KEEP_BINDING_AFTER_TRANSIENT_HOST_UNREACHABLE', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onHostUnreachable',
        sessionId: currentSessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        reason,
      });
      debugLanFlow(sessionIsPausedLocally ? 'PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED' : 'PLAYER_HOST_TEMPORARILY_UNREACHABLE_KEEP_BINDING', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onHostUnreachable',
        sessionId: currentSessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        reason,
      });
      debugLanFlow(sessionIsPausedLocally ? 'PLAYER_KEEP_BINDING_AFTER_PAUSE' : 'PLAYER_WAIT_MASTER_RECONNECT_KEEP_BINDING', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onHostUnreachable',
        sessionId: currentSessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        reason,
      });

      if (sessionIsPausedLocally) {
        setLanSessionStatus('paused');
        lanSessionStatusRef.current = 'paused';
      } else {
        // Mantenha status active para o hook continuar tentando reconectar.
        // Não marque como ended e não apague lanInfo/binding.
        setLanSessionStatus((current) => current || 'active');
        if (!lanSessionStatusRef.current) lanSessionStatusRef.current = 'active';
      }

      const now = Date.now();
      const lastAlert = lastHostUnavailableAlertKeyRef.current;
      const shouldShowAlert = lastAlert.sessionId !== currentSessionId || now - lastAlert.at > 60_000;
      if (shouldShowAlert) {
        lastHostUnavailableAlertKeyRef.current = { sessionId: currentSessionId, at: now };
        showCustomAlert(
          sessionIsPausedLocally ? 'Sessao pausada' : 'Aguardando reconexao',
          sessionIsPausedLocally
            ? 'O mestre esta desconectado, mas a sessao estava pausada. Mantive o vinculo para retomar quando o mestre voltar.'
            : 'Perdi contato temporario com o mestre. Mantive o vinculo da ficha e vou tentar reconectar automaticamente quando o app do mestre voltar para a rede.'
        );
      }
    },
  });

  useLanAppLifecycle({
    enabled: Boolean(
      character &&
      lanInfo?.sessionId &&
      lanInfo?.joinUrl &&
      sessionTerminatedRef.current !== lanInfo.sessionId
    ),
    onBackground: async () => {
      // v86: depois de bloqueio de tela/Android suspendendo rede, o socket pode
      // parecer vivo mas estar sem binding real no host. Fechamos o cliente aqui e
      // reabrimos no foreground com resync autoritativo. O vínculo LAN/SQLite NÃO é apagado.
      traceApp('LAN_JOIN', 'PLAYER_RESET_STALE_SOCKET_ON_BACKGROUND_KEEP_BINDING', {
        screen: 'sheet',
        source: 'useLanAppLifecycle.onBackground',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        characterName: character?.name,
      });
      resetLanClientConnection();
      if (lanInfo?.sessionId) {
        useLanRealtimeStore.getState().setConnection({
          sessionId: lanInfo.sessionId,
          playerKey: getSelfLanKey(lanInfo.sessionId),
          connected: false,
        });
      }
    },
    onForeground: async () => {
      if (lanInfo?.sessionId && sessionTerminatedRef.current === lanInfo.sessionId) {
        traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
          screen: 'sheet',
          source: 'useLanAppLifecycle.onForeground',
          sessionId: lanInfo.sessionId,
          characterId: character?.id,
          characterName: character?.name,
        });
        return;
      }
      const selfKey = getSelfLanKey(lanInfo?.sessionId);
      // Foreground apos compartilhar/alternar app deve reamarrar, nao destruir,
      // a conexao. requestLanSessionResync envia hello com playerKey e reconecta
      // se o socket tiver caido.
      setLanReconnectEpoch((current) => current + 1);
      if (lanInfo?.joinUrl && lanInfo?.sessionId && selfKey) {
        void requestLanSessionResync(lanInfo.joinUrl, {
          sessionId: lanInfo.sessionId,
          playerKey: selfKey,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
          knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
          forceReconnect: true,
          includeGlobal: true,
        }).catch(() => false);
        void flushPendingLanOutboundEvents('app_foreground').catch(() => false);
      }
    },
  });

  useFocusEffect(
    useCallback(() => {
      if (!character?.id || !lanInfo?.sessionId || !lanInfo?.joinUrl) return;
      let disposed = false;
      const selfKey = getSelfLanKey(lanInfo.sessionId);

      // Reabrir a ficha pela Home/index NAO deve matar o socket.
      // Apenas reenvia hello/resync com playerKey para reamarrar o socket no host.
      const scheduleRebind = (delayMs: number, reason: string) => {
        setTimeout(() => {
          if (disposed || sessionTerminatedRef.current === lanInfo.sessionId) return;
          traceApp('LAN_JOIN', 'PLAYER_SHEET_FOCUS_REBIND_START', {
            screen: 'sheet',
            source: 'useFocusEffect',
            reason,
            sessionId: lanInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
            playerKey: selfKey,
          });
          // v98: com sync global ativo, foco de tela nao deve pedir checkpoint/resync.
          // Esse era o principal causador da sensacao de ficha travada ao voltar
          // do level-up: o checkpoint competia com player_patch vivo e snapshots.
          if (selfKey) {
            debugLanFlow('PLAYER_SHEET_FOCUS_REBIND_SKIPPED_GLOBAL_RUNTIME_V98', {
              sessionId: lanInfo.sessionId,
              playerKey: selfKey,
              reason,
            });
            void flushPendingLanOutboundEvents(reason).catch(() => false);
          }
        }, delayMs);
      };

      scheduleRebind(80, 'focus_open_or_return');
      scheduleRebind(650, 'focus_confirm_bind');

      return () => {
        disposed = true;
      };
    }, [character?.id, character?.name, lanInfo?.sessionId, lanInfo?.joinUrl])
  );

  useEffect(() => {
    if (!character?.id || !lanInfo?.sessionId || !lanInfo?.joinUrl) return;

    let disposed = false;
    const recover = (reason: string) => {
      if (disposed || sessionTerminatedRef.current === lanInfo.sessionId) return;
      const now = Date.now();
      const elapsedSinceLastRecovery = now - lanRecoveryGateRef.current.at;
      const mustForceRecovery = reason === 'app_foreground' || reason === 'debug_trace_share_returned' || reason === 'focus_open_or_return';
      if (elapsedSinceLastRecovery < 1200 && !mustForceRecovery) {
        traceApp('LAN_JOIN', 'PLAYER_EXTERNAL_FOREGROUND_RECOVERY_DEBOUNCED', {
          screen: 'sheet',
          source: 'subscribeLanForegroundRecovery',
          reason,
          previousReason: lanRecoveryGateRef.current.reason,
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
        });
        return;
      }
      if (elapsedSinceLastRecovery < 1200 && mustForceRecovery) {
        traceApp('LAN_JOIN', 'PLAYER_EXTERNAL_FOREGROUND_RECOVERY_FORCED_AFTER_DEBOUNCE', {
          screen: 'sheet',
          source: 'subscribeLanForegroundRecovery',
          reason,
          previousReason: lanRecoveryGateRef.current.reason,
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
        });
      }
      lanRecoveryGateRef.current = { at: now, reason };
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      traceApp('LAN_JOIN', 'PLAYER_EXTERNAL_FOREGROUND_RECOVERY_START', {
        screen: 'sheet',
        source: 'subscribeLanForegroundRecovery',
        reason,
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
      });
      setLanReconnectEpoch((current) => current + 1);
      setTimeout(() => {
        if (disposed) return;
        if (selfKey) {
          void requestLanSessionResync(lanInfo.joinUrl, {
            sessionId: lanInfo.sessionId,
            playerKey: selfKey,
            lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
            knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
            includeGlobal: true,
            forceReconnect: true,
          }).catch(() => false);
          void flushPendingLanOutboundEvents(`${reason}:recovery_80ms`).catch(() => false);
        }
      }, 80);
      setTimeout(() => {
        if (disposed) return;
        setLanReconnectEpoch((current) => current + 1);
        if (selfKey) {
          void requestLanSessionResync(lanInfo.joinUrl, {
            sessionId: lanInfo.sessionId,
            playerKey: selfKey,
            lastAppliedSeq: 0,
            knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
            includeGlobal: true,
            forceReconnect: false,
          }).catch(() => false);
          void flushPendingLanOutboundEvents(`${reason}:recovery_650ms`).catch(() => false);
        }
      }, 650);
      setTimeout(() => {
        if (disposed) return;
        setLanReconnectEpoch((current) => current + 1);
        if (selfKey) {
          void requestLanSessionResync(lanInfo.joinUrl, {
            sessionId: lanInfo.sessionId,
            playerKey: selfKey,
            lastAppliedSeq: 0,
            knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
            includeGlobal: true,
            forceReconnect: false,
          }).catch(() => false);
          void flushPendingLanOutboundEvents(`${reason}:recovery_1800ms`).catch(() => false);
        }
      }, 1800);
    };

    const unsubscribe = subscribeLanForegroundRecovery(recover);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [character?.id, character?.name, lanInfo?.sessionId, lanInfo?.joinUrl, syncLanFromHost]);

  const getSelfLanKey = (sessionValue?: string) => {
    if (!character || !sessionValue) return '';
    return makeLanCharacterKey(sessionValue, character);
  };

  const schedulePendingLanOutboundFlush = (reason: string, delayMs = 900) => {
    if (pendingLanOutboundFlushTimerRef.current) {
      clearTimeout(pendingLanOutboundFlushTimerRef.current);
    }
    pendingLanOutboundFlushTimerRef.current = setTimeout(() => {
      pendingLanOutboundFlushTimerRef.current = null;
      void flushPendingLanOutboundEvents(reason).catch(() => false);
    }, delayMs);
  };

  const queuePendingLanOutboundEvent = (event: LanSessionEvent, reason: string) => {
    const key = String(event.clientMsgId || event.id || '');
    if (!key) return;
    pendingLanOutboundEventsRef.current = {
      ...pendingLanOutboundEventsRef.current,
      [key]: event,
    };
    debugLanFlow('PLAYER_OUTBOUND_EVENT_QUEUED', {
      sessionId: event.sessionId,
      eventId: event.id,
      clientMsgId: event.clientMsgId,
      type: event.type,
      reason,
      pendingCount: Object.keys(pendingLanOutboundEventsRef.current).length,
    });
    schedulePendingLanOutboundFlush(`queued:${reason}`, 800);
  };

  const sendLanEventWithRetry = async (event: LanSessionEvent, source: string) => {
    // v108: socket primeiro, SQLite em background. Pedidos/testes não podem esperar persistência local.
    void rememberLanSessionEvent(db, event).catch(() => false);
    if (!lanInfo?.joinUrl) {
      queuePendingLanOutboundEvent(event, `${source}:no_join_url`);
      return false;
    }
    try {
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      const key = String(event.clientMsgId || event.id || '');
      if (key && pendingLanOutboundEventsRef.current[key]) {
        const next = { ...pendingLanOutboundEventsRef.current };
        delete next[key];
        pendingLanOutboundEventsRef.current = next;
      }
      debugLanFlow('PLAYER_OUTBOUND_EVENT_SENT', {
        sessionId: event.sessionId,
        eventId: event.id,
        clientMsgId: event.clientMsgId,
        type: event.type,
        source,
      });
      return true;
    } catch (error) {
      queuePendingLanOutboundEvent(event, `${source}:send_failed`);
      debugLanFlow('PLAYER_OUTBOUND_EVENT_SEND_FAILED_QUEUED', {
        sessionId: event.sessionId,
        eventId: event.id,
        clientMsgId: event.clientMsgId,
        type: event.type,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const flushPendingLanOutboundEvents = async (reason: string) => {
    if (!lanInfo?.joinUrl || !lanInfo?.sessionId) return false;
    const entries = Object.values(pendingLanOutboundEventsRef.current)
      .filter((event) => event.sessionId === lanInfo.sessionId)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    if (entries.length === 0) return true;

    debugLanFlow('PLAYER_OUTBOUND_FLUSH_START', {
      sessionId: lanInfo.sessionId,
      reason,
      count: entries.length,
    });

    let sent = 0;
    for (const event of entries) {
      try {
        await sendLanEventWithRetry(event, 'sendItemRequest');
        const key = String(event.clientMsgId || event.id || '');
        if (key) {
          const next = { ...pendingLanOutboundEventsRef.current };
          delete next[key];
          pendingLanOutboundEventsRef.current = next;
        }
        sent += 1;
      } catch (error) {
        debugLanFlow('PLAYER_OUTBOUND_FLUSH_STOPPED_OFFLINE', {
          sessionId: lanInfo.sessionId,
          eventId: event.id,
          type: event.type,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        schedulePendingLanOutboundFlush(`flush_failed:${reason}`, 1800);
        return false;
      }
    }

    const selfKey = getSelfLanKey(lanInfo.sessionId);
    if (selfKey) {
      void requestLanSessionResync(lanInfo.joinUrl, {
        sessionId: lanInfo.sessionId,
        playerKey: selfKey,
        lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
      }).catch(() => false);
    }

    debugLanFlow('PLAYER_OUTBOUND_FLUSH_DONE', {
      sessionId: lanInfo.sessionId,
      reason,
      sent,
      remaining: Object.keys(pendingLanOutboundEventsRef.current).length,
    });
    return true;
  };


  const makeTradeItem = (item: any, qty: number): LanTradeItem => {
    const hydrated = hydrateInventoryItemForEffects(item);
    return {
      id: hydrated.inventoryItemId ?? hydrated.inventory_item_id ?? hydrated.itemId ?? hydrated.item_id ?? hydrated.catalogItemId ?? hydrated.catalog_item_id ?? hydrated.sourceItemId ?? hydrated.source_item_id ?? hydrated.dbId ?? hydrated.id,
      inventoryItemId: hydrated.inventoryItemId ?? hydrated.inventory_item_id ?? hydrated.itemId ?? hydrated.item_id ?? hydrated.catalogItemId ?? hydrated.catalog_item_id ?? hydrated.sourceItemId ?? hydrated.source_item_id ?? hydrated.dbId ?? hydrated.id,
      stackKey: getSheetInventoryStackKey(hydrated),
      name: String(hydrated.name || 'Item'),
      qty: Math.max(1, Math.min(Number(hydrated.qty) || 1, qty)),
      weight: Number(hydrated.weight) || 0,
      damage: hydrated.damage,
      damage_type: hydrated.damage_type,
      properties: hydrated.properties,
      descricao: hydrated.descricao,
      effect_json: hydrated.effect_json,
      duration_value: hydrated.duration_value,
      duration_unit: hydrated.duration_unit,
      effect_hidden: getItemEffectHidden(hydrated) ? 1 : 0,
      effectHidden: getItemEffectHidden(hydrated),
      hiddenEffect: getItemEffectHidden(hydrated),
    } as LanTradeItem & { effect_hidden?: number; effectHidden?: boolean; hiddenEffect?: boolean };
  };

  const updateCharacterEquipmentOnly = async (equipment: any) => {
    if (!character) return false;
    try {
      await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [JSON.stringify(equipment), character.id]);
      await syncCharacterInventoryForEquipment(db, Number(character.id), equipment).catch(() => undefined);
      setCharacter((prev: any) => ({ ...prev, equipment }));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  const addTradeItemToBag = async (tradeItem?: LanTradeItem) => {
    if (!character || !tradeItem) return false;
    const nextBag = [...character.equipment.bag];
    const existingIndex = nextBag.findIndex((item: any) => isSameSheetInventoryItem(item, tradeItem as any));
    if (existingIndex >= 0) {
      const hydratedTradeItem = hydrateInventoryItemForEffects(tradeItem);
      nextBag[existingIndex] = {
        ...hydratedTradeItem,
        ...nextBag[existingIndex],
        qty: (Number(nextBag[existingIndex].qty) || 0) + tradeItem.qty,
        damage: nextBag[existingIndex].damage || hydratedTradeItem.damage,
        damage_type: nextBag[existingIndex].damage_type || hydratedTradeItem.damage_type,
        properties: nextBag[existingIndex].properties || hydratedTradeItem.properties,
        descricao: nextBag[existingIndex].descricao || hydratedTradeItem.descricao,
        effect_json: nextBag[existingIndex].effect_json || hydratedTradeItem.effect_json,
        duration_value: nextBag[existingIndex].duration_value ?? hydratedTradeItem.duration_value,
        duration_unit: nextBag[existingIndex].duration_unit ?? hydratedTradeItem.duration_unit,
        effect_hidden: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem),
        hiddenEffect: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem),
      };
    } else {
      const hydratedTradeItem = hydrateInventoryItemForEffects(tradeItem);
      nextBag.push({
        ...hydratedTradeItem,
        effect_hidden: getItemEffectHidden(hydratedTradeItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(hydratedTradeItem),
        hiddenEffect: getItemEffectHidden(hydratedTradeItem),
      });
    }
    return updateCharacterEquipmentOnly({ ...character.equipment, bag: nextBag });
  };

  const removeTradeItemFromBagByIndex = async (index: number, qty: number) => {
    if (!character) return false;
    const nextBag = [...character.equipment.bag];
    const item = nextBag[index];
    if (!item || (Number(item.qty) || 0) < qty) return false;
    nextBag[index] = { ...item, qty: (Number(item.qty) || 0) - qty };
    const cleanBag = nextBag.filter((entry: any) => (Number(entry.qty) || 0) > 0);
    return updateCharacterEquipmentOnly({ ...character.equipment, bag: cleanBag });
  };

  const removeTradeItemFromBagByName = async (tradeItem?: LanTradeItem) => {
    if (!character || !tradeItem) return false;
    const index = character.equipment.bag.findIndex((item: any) => isSameSheetInventoryItem(item, tradeItem as any));
    if (index < 0) return false;
    return removeTradeItemFromBagByIndex(index, tradeItem.qty);
  };

  const applySpellHpToSelf = async (amount: number) => {
    if (!character) return;
    const nextHp = Math.max(0, Math.min(character.hp_max, Number(character.hp_current || 0) + amount));

    if (isLanPlayerRuntime) {
      debugLanFlow('LAN_PLAYER_BLOCKED_DIRECT_SELF_HP', {
        characterId: character.id,
        amount,
        requestedHp: nextHp,
      });
      void notifyNumberPatch({ hpCurrent: nextHp }, `${character.name} solicitou alterar HP para ${nextHp}.`);
      return;
    }

    await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [nextHp, character.id]);
    setCharacter((prev: any) => ({ ...prev, hp_current: nextHp }));
    notifyOwnLanStatus(nextHp, character.hp_max);
  };

  const applySpellEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.spellEffect) return;
    const target = event.spellEffect.target || 'custom';
    const value = Number(event.spellEffect.value || 0);

    const valueText = target !== 'custom' && value !== 0 ? `: ${target} ${value > 0 ? '+' : ''}${value}` : '';
    showCustomAlert('Efeito recebido', `${event.fromName} aplicou ${event.spellEffect.spellName}${valueText}.`);
  };

  const applyExpiredEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.expiredEffect) return;
    const effect = event.expiredEffect;
    showCustomAlert('Efeito encerrado', event.message || `${effect.name} acabou.`);
  };

  const upsertPublicLanPlayerFromEvent = useCallback((event: LanSessionEvent, sessionValue: string) => {
    const currentCharacter = characterRef.current;
    const selfKey = currentCharacter ? makeLanCharacterKey(sessionValue, currentCharacter) : '';
    const key = String(event.fromKey || event.entityId || event.toKey || '').trim();
    const characterName = String(event.fromName || event.toName || key || 'Jogador').trim();
    if (!key || key === 'master' || key === 'session' || key === 'party' || key === 'all') return;
    const publicState = (event.publicState || {}) as NonNullable<LanSessionEvent['publicState']> & Record<string, unknown>;
    setLanPlayers((current) => {
      const existingIndex = current.findIndex((player) => player.key === key || player.characterName === characterName);
      const existing = existingIndex >= 0 ? current[existingIndex] : null;
      const nextPlayer: PublicLanPlayer = {
        key,
        playerName: existing?.playerName || characterName,
        characterName: existing?.characterName || characterName,
        level: Number(publicState.level ?? existing?.level ?? 1) || 1,
        hpCurrent: Number(publicState.hpCurrent ?? existing?.hpCurrent ?? 0) || 0,
        hpMax: Number(publicState.hpMax ?? existing?.hpMax ?? 0) || 0,
        tempHp: Number(publicState.tempHp ?? existing?.tempHp ?? 0) || 0,
        publicEffects: Array.isArray((publicState as any).effects)
          ? (publicState as any).effects
          : (existing?.publicEffects || []),
        isSelf: Boolean(selfKey && key === selfKey),
      };
      if (existingIndex < 0) return [...current, nextPlayer];
      const next = [...current];
      next[existingIndex] = { ...existing!, ...nextPlayer };
      return next;
    });
  }, []);

  const handleLanEvents = async (events: LanSessionEvent[], sessionValue: string) => {
    if (!character) return;
    const selfKey = getSelfLanKey(sessionValue);
    traceFunctionCall('handleLanEvents', {
      eventCount: events.length,
      sessionValue,
      eventTypes: events.map((event) => event.type),
    }, {
      screen: 'sheet',
      source: 'handleLanEvents',
      sessionId: sessionValue,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });
    const isDirectlyForMe = (event: LanSessionEvent) => event.toKey === selfKey || event.toName === character.name;
    const isInventoryParticipantNoticeForMe = (event: LanSessionEvent) => {
      if (!['send_item_result', 'trade_result'].includes(event.type)) return false;
      return event.fromKey === selfKey ||
        event.toKey === selfKey ||
        event.tradeAccept?.fromKey === selfKey ||
        event.tradeAccept?.toKey === selfKey;
    };
    const isForMe = (event: LanSessionEvent) => isDirectlyForMe(event) || isInventoryParticipantNoticeForMe(event);
    const closedTradeIds = new Set(events
      .filter((event) => (
        ['trade_accept', 'trade_decline', 'trade_result'].includes(event.type) ||
        // Uma counter-proposal fecha a pendencia do destinatario original,
        // mas vira uma nova pendencia para quem recebeu a resposta.
        (event.type === 'trade_counter' && !isDirectlyForMe(event))
      ))
      .map((event) => event.tradeId || event.id));
    const pendingOffers = events.filter((event) =>
      (event.type === 'trade_offer' || event.type === 'trade_counter') &&
      isDirectlyForMe(event) &&
      !closedTradeIds.has(event.tradeId || event.id)
    );

    setIncomingTrades((current) => {
      const byKey = new Map<string, LanSessionEvent>();
      for (const entry of current) {
        const key = entry.tradeId || entry.id;
        if (!closedTradeIds.has(key)) byKey.set(key, entry);
      }
      for (const entry of pendingOffers) byKey.set(entry.tradeId || entry.id, entry);
      return [...byKey.values()];
    });

    for (const event of events) {
      const eventKey = String(event.id || `${event.type}:${event.sessionId}:${event.entityRevision || event.seq || event.createdAt || ''}`);
      if (eventKey && handledSessionEventIdsRef.current.has(eventKey)) {
        debugLanFlow('PLAYER_EVENT_DUPLICATE_SKIPPED', {
          eventId: event.id,
          eventType: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
        });
        continue;
      }
      if (eventKey) {
        handledSessionEventIdsRef.current.add(eventKey);
        if (handledSessionEventIdsRef.current.size > 300) {
          handledSessionEventIdsRef.current = new Set(Array.from(handledSessionEventIdsRef.current).slice(-150));
        }
      }

      if ((event.type === 'player_progression_patch' || (event.type === 'player_patch' && (event as any).progressionPatch)) && (event as any).progressionPatch && isForMe(event)) {
        const progression = (event as any).progressionPatch || {};
        const current = characterRef.current || character;
        if (current?.id) {
          const nextLevel = Math.max(1, Math.floor(Number(progression.level || current.level || 1) || 1));
          const nextClass = String(progression.className || current.class || '').trim() || current.class;
          const nextHpMax = Math.max(1, Math.floor(Number(progression.hpMax ?? current.hp_max ?? 1) || 1));
          const nextHpCurrent = Math.max(0, Math.min(nextHpMax, Math.floor(Number(progression.hpCurrent ?? current.hp_current ?? 0) || 0)));
          const nextStats = progression.stats && typeof progression.stats === 'object' ? progression.stats : current.stats;
          const nextSaveValues = progression.saveValues ?? current.save_values;
          const nextSkillValues = progression.skillValues ?? current.skill_values;
          const nextProficiencies = progression.proficiencies ?? current.proficiencies;
          const nextSpells = progression.spells ?? current.spells;
          const merged = {
            ...current,
            level: nextLevel,
            class: nextClass,
            hp_max: nextHpMax,
            hp_current: nextHpCurrent,
            stats: nextStats,
            save_values: nextSaveValues,
            skill_values: nextSkillValues,
            proficiencies: nextProficiencies,
            spells: nextSpells,
          };
          characterRef.current = { ...(characterRef.current || current), ...merged };
          setCharacter((prev: any) => {
            const base = prev || current;
            const next = { ...base, ...merged };
            characterRef.current = next;
            return next;
          });
          lastAuthoritativePlayerPatchRef.current = {
            seq: Number(event.seq ?? event.serverSeq ?? 0) || lastAuthoritativePlayerPatchRef.current.seq,
            entityRevision: normalizeLanPlayerPatchRevision(event) || lastAuthoritativePlayerPatchRef.current.entityRevision,
            appliedAt: Date.now(),
          };
          updateSelfLanBarFromAuthoritativePatch(sessionValue, {
            hp_current: nextHpCurrent,
            hp_max: nextHpMax,
            temp_hp: Number((current as any).temp_hp || 0) || 0,
            xp: Number((current as any).xp || 0) || 0,
            gp: Number((current as any).gp || 0) || 0,
            sp: Number((current as any).sp || 0) || 0,
            cp: Number((current as any).cp || 0) || 0,
          }, event);
          void db.runAsync(
            `UPDATE characters SET level = ?, class = ?, hp_max = ?, hp_current = ?, stats = ?, save_values = ?, skill_values = ?, proficiencies = ?, spells = ? WHERE id = ?`,
            [
              nextLevel,
              nextClass,
              nextHpMax,
              nextHpCurrent,
              typeof nextStats === 'string' ? nextStats : JSON.stringify(nextStats || {}),
              typeof nextSaveValues === 'string' ? nextSaveValues : JSON.stringify(nextSaveValues || []),
              typeof nextSkillValues === 'string' ? nextSkillValues : JSON.stringify(nextSkillValues || []),
              typeof nextProficiencies === 'string' ? nextProficiencies : JSON.stringify(nextProficiencies || []),
              typeof nextSpells === 'string' ? nextSpells : JSON.stringify(nextSpells || []),
              Number(current.id),
            ]
          ).catch((error) => {
            debugLanFlow('PLAYER_PROGRESSION_PATCH_PERSIST_FAILED_V93', {
              eventId: event.id,
              characterId: current.id,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
          debugLanFlow('PLAYER_PROGRESSION_PATCH_APPLIED_TO_CHARACTER_V93', {
            eventId: event.id,
            characterId: current.id,
            level: nextLevel,
            className: nextClass,
            hpCurrent: nextHpCurrent,
            hpMax: nextHpMax,
          });
        }
        continue;
      }

      if (event.type === 'public_status' && event.publicState) {
        debugLanFlow('PLAYER_PUBLIC_STATUS_IGNORED_VISUAL_ONLY_CUT6', {
          eventId: event.id,
          fromKey: event.fromKey,
          fromName: event.fromName,
          selfKey,
          decision: 'public_status_no_gameplay_no_card_source',
        });
        traceApp('PUBLIC_STATUS_RECEIVED', 'PLAYER_PUBLIC_STATUS_IGNORED_VISUAL_ONLY_CUT6', {
          screen: 'sheet',
          source: 'handleLanEvents',
          sessionId: sessionValue,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          fromKey: event.fromKey,
        });
        continue;
      }

      if (event.type === 'player_joined') {
        await rememberLanSessionEvent(db, event).catch(() => false);
        upsertPublicLanPlayerFromEvent(event, sessionValue);
        traceApp('LAN_JOIN', 'PLAYER_PUBLIC_JOIN_APPLIED_TO_ROSTER', {
          screen: 'sheet',
          source: 'handleLanEvents',
          sessionId: sessionValue,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          eventId: event.id,
          fromKey: event.fromKey,
          fromName: event.fromName,
        });
        continue;
      }

      if (!isForMe(event)) {
        traceApp('EVENT_IGNORED', 'HANDLE_LAN_EVENTS_WRONG_TARGET', {
          screen: 'sheet',
          source: 'handleLanEvents',
          sessionId: sessionValue,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          fromKey: event.fromKey,
          toKey: event.toKey,
          reason: 'wrong_target',
        });
        continue;
      }

      if (event.type === 'player_patch' && event.numberPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        debugLanFlow('PLAYER_PATCH_RECEIVED', {
          eventId: event.id,
          seq: event.seq,
          serverSeq: event.serverSeq,
          entityRevision: event.entityRevision,
          toKey: event.toKey,
          toName: event.toName,
          patch: event.numberPatch,
        });
        const nextValues = await applyLanNumberPatchToCharacter(event.numberPatch, event);
        if (nextValues) {
          const normalizedRevision = normalizeLanPlayerPatchRevision(event);
          lastAuthoritativePlayerPatchRef.current = {
            seq: Number(event.seq ?? event.serverSeq ?? 0) || lastAuthoritativePlayerPatchRef.current.seq,
            entityRevision: normalizedRevision || lastAuthoritativePlayerPatchRef.current.entityRevision,
            appliedAt: Date.now(),
          };
          updateSelfLanBarFromAuthoritativePatch(sessionValue, nextValues, event);
        }

        continue;
      }

      if (event.type === 'player_patch' && event.statsPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        debugLanFlow('PLAYER_STATS_PATCH_RECEIVED', {
          eventId: event.id,
          seq: event.seq,
          serverSeq: event.serverSeq,
          entityRevision: event.entityRevision,
          toKey: event.toKey,
          toName: event.toName,
          patch: event.statsPatch,
        });
        const statsPatch = event.statsPatch as Record<string, unknown>;
        setCharacter((prev: any) => {
          if (!prev) return prev;
          const merged = { ...prev, stats: statsPatch };
          characterRef.current = merged;
          return merged;
        });
        void updateDB(
          { stats: statsPatch },
          { allowLanAuthoritativeCache: true, reason: 'lan_authoritative_stats_patch' }
        );
        continue;
      }

      if (event.type === 'player_kicked') {
        debugLanFlow('PLAYER_KICKED_RECEIVED', {
          eventId: event.id,
          sessionId: sessionValue,
          selfKey,
          toKey: event.toKey,
          toName: event.toName,
        });
        await rememberLanSessionEvent(db, event).catch(() => false);
        await clearLanSessionEffectsFromCharacter(sessionValue);
        await unlinkCharacterFromLanSession(db, Number(character.id), sessionValue);
        debugLanFlow('PLAYER_UNLINK_DONE', {
          characterId: character.id,
          sessionId: sessionValue,
          selfKey,
        });
        debugLanFlow('PLAYER_KICKED_RUNTIME_APPLIED', {
          eventId: event.id,
          sessionId: sessionValue,
          selfKey,
        });
        useLanRealtimeStore.getState().resetSession();
        resetLanClientConnection();
        setLanInfo(null);
        setLanSessionStatus(null);
        setLanPlayers([]);
        setIncomingTrades([]);
        showCustomAlert(
          'Removido da sessao',
          event.message || 'O mestre removeu este personagem da sessao LAN.',
          [{ text: 'OK', color: appColors.primary, onPress: () => router.replace(`/sheet?id=${character.id}` as any) }]
        );
        continue;
      }

      if (event.type === 'resource_review') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          showCustomAlert('Resposta do mestre', event.message || 'O mestre revisou seu pedido.');
        }
        continue;
      }

      if (event.type === 'effect_save_request' && event.saveRequest) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          debugLanFlow('PLAYER_EFFECT_SAVE_REQUEST_RECEIVED', {
            eventId: event.id,
            requestId: event.saveRequest.id,
            sourceEffectName: event.saveRequest.sourceEffectName,
            saveAbility: event.saveRequest.saveAbility,
            dc: event.saveRequest.dc,
          });
          setPendingEffectSave(event.saveRequest);
          setSaveManualValue('');
        }
        continue;
      }

      if (
        event.type === 'action_result' ||
        event.type === 'skill_result' ||
        event.type === 'spell_cast_result' ||
        event.type === 'ability_use_result'
      ) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          const accepted = event.actionResult?.status === 'accepted';
          showCustomAlert(
            accepted ? 'Acao confirmada' : 'Acao recusada',
            event.actionResult?.reason || event.message || (accepted ? 'O mestre confirmou a acao.' : 'O mestre recusou a acao.')
          );
        }
        continue;
      }

      if (event.type === 'trade_offer' || event.type === 'trade_counter') {
        await rememberLanSessionEvent(db, event).catch(() => false);
        const key = event.tradeId || event.id;
        if (isDirectlyForMe(event) && !closedTradeIds.has(key)) {
          setIncomingTrades((current) => {
            const withoutSame = current.filter((entry) => (entry.tradeId || entry.id) !== key);
            return [...withoutSame, event];
          });
        }
        continue;
      }

      if (event.type === 'send_item_result') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          const accepted = event.sendItemResult?.status === 'accepted';
          const senderIsSelf = event.fromKey === selfKey || event.fromName === character.name;
          showCustomAlert(
            accepted ? (senderIsSelf ? 'Envio concluido' : 'Item recebido') : 'Envio nao concluido',
            event.sendItemResult?.reason || event.message || (accepted ? 'Inventario sincronizado.' : 'O envio nao foi concluido.')
          );
        }
        continue;
      }

      if (event.type === 'trade_result') {
        const resultTradeCommit = (event.tradeResult as any)?.tradeCommit;
        const resultDeltas = Array.isArray(resultTradeCommit?.itemDeltas)
          ? resultTradeCommit.itemDeltas.filter(Boolean)
          : [];
        if (event.tradeResult?.status === 'accepted' && resultDeltas.length > 0) {
          const txId = [
            sessionValue,
            resultTradeCommit?.targetKey || event.toKey || selfKey,
            resultTradeCommit?.commitId || event.sourceClientMsgId || event.id || resultTradeCommit?.tradeId || event.tradeId,
          ].filter(Boolean).join(':');
          if (!txId || !appliedInventoryTransactionIdsRef.current.has(txId)) {
            debugLanFlow('PLAYER_TRADE_RESULT_APPLYING_AUTHORITATIVE_DELTAS', {
              eventId: event.id,
              tradeId: event.tradeId,
              targetKey: resultTradeCommit?.targetKey || event.toKey,
              deltaCount: resultDeltas.length,
            });
            await applyLanInventoryPatchToCharacter({
              targetKey: resultTradeCommit?.targetKey || event.toKey || selfKey,
              equipment: normalizeSheetEquipment(characterRef.current?.equipment),
              itemDelta: resultDeltas[0],
              itemDeltas: resultDeltas,
              tradeCommit: {
                tradeId: resultTradeCommit?.tradeId || event.tradeId || event.id,
                commitId: resultTradeCommit?.commitId || event.sourceClientMsgId || event.id,
                offeringKey: resultTradeCommit?.offeringKey,
                acceptingKey: resultTradeCommit?.acceptingKey,
                targetKey: resultTradeCommit?.targetKey || event.toKey || selfKey,
                itemDeltas: resultDeltas,
              } as any,
              reason: event.tradeResult?.reason || event.message || 'Troca concluida.',
              action: 'trade_commit',
            } as any, event);
          } else {
            debugLanFlow('PLAYER_TRADE_RESULT_DELTAS_ALREADY_APPLIED', {
              eventId: event.id,
              tradeId: event.tradeId,
              transactionId: txId,
            });
          }
        }
        const fresh = await rememberLanSessionEvent(db, event);
        setIncomingTrades((current) => current.filter((entry) => (entry.tradeId || entry.id) !== (event.tradeId || event.id)));
        if ((selectedTradeOffer?.tradeId || selectedTradeOffer?.id) === (event.tradeId || event.id)) setSelectedTradeOffer(null);
        if (fresh) {
          const accepted = event.tradeResult?.status === 'accepted';
          showCustomAlert(
            accepted ? 'Troca concluida' : 'Troca nao concluida',
            event.tradeResult?.reason || event.message || (accepted ? 'Inventarios sincronizados.' : 'A troca nao foi concluida.')
          );
        }
        continue;
      }

      if (isLanSessionEndedEvent(event)) {
        debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
          source: 'handleLanEvents',
          eventId: event.id,
          sessionId: sessionValue,
          eventType: event.type,
          selfKey,
        });
        await terminateLanSessionFromMaster(sessionValue, 'handleLanEvents', event);
        continue;
      }

      if (event.type === 'send_item') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          await addTradeItemToBag(event.item);
          showCustomAlert('Item recebido', `${event.fromName} enviou ${event.item?.qty || 1}x ${event.item?.name || 'item'}.`);
        }
      }

      if (event.type === 'trade_accept') {
        await rememberLanSessionEvent(db, event).catch(() => false);
        continue;
      }

      if (event.type === 'trade_decline') {
        const fresh = await rememberLanSessionEvent(db, event);
        setIncomingTrades((current) => current.filter((entry) => (entry.tradeId || entry.id) !== (event.tradeId || event.id)));
        if (fresh) {
          showCustomAlert('Troca recusada', event.message || `${event.fromName} recusou a troca.`);
        }
        continue;
      }

      if (event.type === 'spell_hp' && event.spellEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          await applySpellHpToSelf(Number(event.spellEffect.amount || 0));
          const modeText = event.spellEffect.mode === 'heal' ? 'curou' : 'causou dano em';
          showCustomAlert('Magia recebida', `${event.fromName} usou ${event.spellEffect.spellName} e ${modeText} ${Math.abs(Number(event.spellEffect.amount || 0))} PV.`);
        }
      }

      if (event.type === 'spell_effect' && event.spellEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) await applySpellEffectToSelf(event);
      }

      if (event.type === 'effect_expired' && event.expiredEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) await applyExpiredEffectToSelf(event);
      }

      if (event.type === 'effect_patch' && event.effectPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        if (event.numberPatch) {
          const nextValues = await applyLanNumberPatchToCharacter(event.numberPatch, event);
          if (nextValues) updateSelfLanBarFromAuthoritativePatch(sessionValue, nextValues, event);
        }
        await applyLanEffectPatchToCharacter(event.effectPatch, event);
      }

      if (event.type === 'effect_catalog_patch' && event.effectCatalogPatch) {
        await rememberLanSessionEvent(db, event);
      }

      if (event.type === 'pending_save_patch' && event.pendingSavePatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        const action = String(event.pendingSavePatch.action || '');
        if (action === 'create' && event.pendingSavePatch.save?.targetKey === selfKey) {
          const save = event.pendingSavePatch.save;
          const saveId = String(save.id || '');
          if (!saveId || resolvedSaveRequestIdsRef.current.has(saveId) || openedSaveRequestIdsRef.current.has(saveId)) {
            debugLanFlow('PLAYER_PENDING_SAVE_PATCH_CREATE_IGNORED_DUP_OR_RESOLVED_V106', { eventId: event.id, saveId, source: 'handleLanEvents' });
            continue;
          }
          openedSaveRequestIdsRef.current.add(saveId);
          setPendingEffectSave({
            id: save.id,
            sourceEffectId: String(save.sourceId || ''),
            sourceEffectName: save.sourceName || 'Efeito',
            targetKey: save.targetKey,
            saveAbility: save.ability,
            dc: save.dc ?? null,
            rollMode: 'target_choice',
            saveOnSuccess: String((save.effectPayload as any)?.saveOnSuccess || (save.effectPayload as any)?.save?.onSuccess || 'negates'),
            pendingEffectPayload: save.effectPayload,
          });
          setSaveManualValue('');
          debugLanFlow('PLAYER_PENDING_SAVE_PATCH_MODAL_OPENED', {
            eventId: event.id,
            saveId: save.id,
            sourceName: save.sourceName,
            ability: save.ability,
            dc: save.dc,
          });
        }
        if (action === 'resolve') {
          const resolvedId = String(event.pendingSavePatch.id || event.pendingSavePatch.result?.requestId || event.pendingSavePatch.save?.id || '');
          if (resolvedId) resolvedSaveRequestIdsRef.current.add(resolvedId);
          if (resolvedId) openedSaveRequestIdsRef.current.delete(resolvedId);
          setPendingEffectSave((current) => {
            if (!current) return current;
            return !resolvedId || current.id === resolvedId || current.sourceEffectId === resolvedId ? null : current;
          });
          setSaveManualValue('');
          debugLanFlow('PLAYER_PENDING_SAVE_PATCH_RESOLVED_AND_CLOSED_V106', {
            eventId: event.id,
            saveId: resolvedId,
            source: 'handleLanEvents',
          });
        }
      }
    }

    await markLanEventsApplied(db, {
      sessionId: sessionValue,
      deviceId: selfKey,
      role: 'player',
      playerKey: selfKey,
      events,
    });
    traceFunctionReturn('handleLanEvents', {
      eventCount: events.length,
    }, {
      screen: 'sheet',
      source: 'handleLanEvents',
      sessionId: sessionValue,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });
  };

  useEffect(() => {
    if (!character?.id) return;
    let active = true;

    const refreshLanMetadata = async () => {
      try {
        const localInfo = await getLocalLanSessionForCharacter(db, Number(character.id));

        // Params antigos de rota nao podem ressuscitar uma sessao ja limpa.
        // Depois de host unreachable, a binding local e desativada; se a tela
        // ainda estiver com sessionId na rota, ignore em vez de reconectar.
        if (routeSessionId && localInfo?.sessionId !== routeSessionId) {
          traceApp('LAN_JOIN', 'PLAYER_IGNORE_STALE_ROUTE_SESSION', {
            screen: 'sheet',
            source: 'refreshLanMetadata',
            routeSessionId,
            localSessionId: localInfo?.sessionId,
            characterId: character.id,
            characterName: character.name,
          });
          return;
        }

        const storedInfo = routeSessionId
          ? {
            sessionId: routeSessionId,
            joinUrl: routeJoinUrl || localInfo?.joinUrl || '',
            payloadJson: localInfo?.payloadJson,
            status: (localInfo as any)?.status,
          }
          : localInfo;

        if (!storedInfo?.sessionId) return;
        if ((storedInfo as any)?.status === 'paused') {
          setLanSessionStatus('paused');
          lanSessionStatusRef.current = 'paused';
        }
        if (sessionTerminatedRef.current === storedInfo.sessionId) {
          traceApp('LAN_JOIN', 'PLAYER_STOP_PAYLOAD_RECOVERY_AFTER_END', {
            screen: 'sheet',
            source: 'refreshLanMetadata',
            sessionId: storedInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
          });
          return;
        }

        let nextInfo = {
          sessionId: storedInfo.sessionId,
          joinUrl: decodeParam(storedInfo.joinUrl || ''),
          hostInstanceId: undefined as string | undefined,
        };

        if (active) setLanInfo(nextInfo);

        let nextPayload: LanSessionPayload | null = null;
        let fetchedFreshPayload = false;

        try {
          const recovered = await fetchLanPayloadWithRecovery(nextInfo, (storedInfo as any).payloadJson);
          nextPayload = recovered.payload;
          fetchedFreshPayload = true;
          nextInfo = {
            ...recovered.info,
            hostInstanceId: nextPayload.session.hostInstanceId,
          };

          if (active) {
            setLanInfo((current) => {
              if (current?.hostInstanceId && nextInfo.hostInstanceId && current.hostInstanceId !== nextInfo.hostInstanceId) {
                traceApp('LAN_JOIN', 'PLAYER_HOST_INSTANCE_CHANGED_BOOTSTRAP', {
                  screen: 'sheet',
                  source: 'refreshLanMetadata',
                  sessionId: nextInfo.sessionId,
                  before: { hostInstanceId: current.hostInstanceId },
                  after: { hostInstanceId: nextInfo.hostInstanceId },
                });
                useLanRealtimeStore.getState().resetSession(nextInfo.sessionId);
              }
              return nextInfo;
            });
          }
          await saveLanSession(db, nextPayload, nextInfo.joinUrl, { isMaster: false });
          traceApp('PAYLOAD_RECEIVED', 'PLAYER_SNAPSHOT_LIVE_FIELDS_IGNORED', {
            screen: 'sheet',
            source: 'refreshLanMetadata',
            sessionId: nextInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
            status: nextPayload.state?.status,
            playerCount: nextPayload.state?.players?.length || 0,
          });
        } catch {
          nextPayload = null;
        }

        if (!nextPayload && (storedInfo as any).payloadJson) {
          nextPayload = safeJsonParse<LanSessionPayload | null>((storedInfo as any).payloadJson, null);
        }

        if (!nextPayload || !active) return;

        const selfKey = makeLanCharacterKey(nextInfo.sessionId, character);
        setLanSessionStatus(nextPayload.state?.status || 'active');
        mergeLanPlayersFromPayloadCache(nextPayload, selfKey, 'payload_cache');
        applyAuthoritativeSelfInventoryFromPayload(nextPayload, nextInfo.sessionId, 'refreshLanMetadata');

        const isStillInSession = Boolean(findSelfLanPlayerInPayload(nextPayload, nextInfo.sessionId, character));

        const wasKicked = nextPayload.events?.some((event) => (
          event.type === 'player_kicked' &&
          (event.toKey === selfKey || event.toName === character.name)
        ));

        if (fetchedFreshPayload && (nextPayload.state?.status === 'ended' || (!isStillInSession && wasKicked))) {
          debugLanFlow('PLAYER_KICKED_RECEIVED', {
            source: 'payload_recovery',
            sessionId: nextInfo.sessionId,
            selfKey,
            wasKicked,
            status: nextPayload.state?.status,
          });
          await terminateLanSessionFromMaster(nextInfo.sessionId, 'payload_recovery');
          return;
        }

        // Snapshot/payload completo é apenas estrutural. Não aplique aqui HP/XP/moedas/efeitos/inventário.
        // Eventos vivos são aplicados por useLanRealtimePlayerPatches.
        debugLanFlow('PLAYER_SNAPSHOT_SKIPPED_LIVE_FIELDS', {
          sessionId: nextInfo.sessionId,
          selfKey,
          source: fetchedFreshPayload ? 'fresh_payload' : 'cached_payload',
        });
        const snapshotSeq = getLanPayloadSnapshotSeq(nextPayload);
        await markLanSnapshotApplied(db, {
          sessionId: nextInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          snapshotSeq,
        }).catch(() => {});

        if (fetchedFreshPayload && nextInfo.joinUrl && nextPayload.state?.status !== 'paused') {
          await requestLanSessionResync(nextInfo.joinUrl, {
            sessionId: nextInfo.sessionId,
            playerKey: selfKey,
            lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
            knownRevisions: getKnownLanEntityRevisions(nextInfo.sessionId),
          }).catch(() => {});
        } else if (nextPayload.state?.status === 'paused') {
          debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
            source: 'refreshLanMetadata',
            sessionId: nextInfo.sessionId,
            selfKey,
          });
        }
      } catch (error) {
        console.warn('[LAN] Refresh estrutural da sessão falhou:', error);
      }
    };

    void refreshLanMetadata();
    const timer = setInterval(refreshLanMetadata, 15000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [db, character?.id, character?.name, character?.level, character?.xp, routeSessionId, routeJoinUrl, fetchLanPayloadWithRecovery, terminateLanSessionFromMaster, applyAuthoritativeSelfInventoryFromPayload, applyAuthoritativeSelfStateFromPayload]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      traceApp('NAVIGATION', 'SHEET_HARDWARE_BACK_TO_HOME', {
        screen: 'sheet',
        source: 'BackHandler',
        sessionId: lanInfo?.sessionId || routeSessionId,
        characterId: characterRef.current?.id,
        characterName: characterRef.current?.name,
      });
      router.replace('/' as any);
      return true;
    });

    return () => subscription.remove();
  }, [lanInfo?.sessionId, routeSessionId, router]);

  // Se estiver carregando ou sem personagem, encerra o render aqui
  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={appColors.primary} /></View>;
  if (!character) return <View style={styles.loadingContainer}><Text style={styles.errorText}>Erro ao carregar o personagem.</Text></View>;

  // ==============================================================================
  // 1. CÁLCULO DE VARIÁVEIS DERIVADAS (STATUS, HP, XP, CA) ANTES DAS FUNÇÕES
  // ==============================================================================

  const renderCharacter = visibleCharacter || character;
  const renderEquipment = visibleEquipment;
  const renderEffects = visibleEffects;

  const getMod = (val: string) => Math.floor(((parseInt(val) || 10) - 10) / 2);
  
  const forBase = parseInt(renderCharacter.stats.FOR) || 10;
  const forTemp = (parseInt(renderCharacter.stats.temp_mods?.FOR) || 0) + getLanStatEffectBonus(renderCharacter, 'FOR');
  const forEquip = parseInt(renderCharacter.stats.equip_mods?.FOR) || 0;
  const forMod = Math.floor(((forBase + forTemp + forEquip) - 10) / 2);

  const desBase = parseInt(renderCharacter.stats.DES) || 10;
  const desTemp = (parseInt(renderCharacter.stats.temp_mods?.DES) || 0) + getLanStatEffectBonus(renderCharacter, 'DES');
  const desEquip = parseInt(renderCharacter.stats.equip_mods?.DES) || 0;
  const desMod = Math.floor(((desBase + desTemp + desEquip) - 10) / 2);
  
  const conBase = parseInt(renderCharacter.stats.CON) || 10;
  const conTemp = (parseInt(renderCharacter.stats.temp_mods?.CON) || 0) + getLanStatEffectBonus(renderCharacter, 'CON');
  const conEquip = parseInt(renderCharacter.stats.equip_mods?.CON) || 0;
  const conModBase = Math.floor((conBase - 10) / 2);
  const conModTotal = Math.floor(((conBase + conTemp + conEquip) - 10) / 2);
  
  const profBonusChar = Math.ceil(renderCharacter.level / 4) + 1; 
  
  const hpBonusFromCon = (conModTotal - conModBase) * (renderCharacter.level || 1);
  const displayHpMax = Math.max(1, renderCharacter.hp_max + hpBonusFromCon);
  const displayHpCurrent = Math.max(0, renderCharacter.hp_current + hpBonusFromCon);

  const bagWeight = renderEquipment.bag.reduce((acc: number, item: any) => acc + (item.weight * item.qty), 0);
  const slotsWeight = Object.values(renderEquipment.slots).reduce((acc: number, item: any) => acc + (item ? item.weight : 0), 0);
  const totalWeight = bagWeight + slotsWeight + ((renderCharacter.gp + renderCharacter.sp + renderCharacter.cp) * 0.01);
  const carryCap = (forBase + forTemp + forEquip) * 7.5;

  let baseCa = 10;
  let addDes = true;
  if (renderEquipment.slots.armor) {
    const props = renderEquipment.slots.armor.properties || '';
    const match = props.match(/CA\s*(\d+)/i);
    if (match) baseCa = parseInt(match[1]);
    if (props.includes('CA 16') || props.includes('Armadura Completa') || props.includes('Pesada')) addDes = false; 
  }
  const caTemp = parseInt(renderCharacter.stats.temp_mods?.CA) || 0;
  const caEquip = parseInt(renderCharacter.stats.equip_mods?.CA) || 0;
  const caLanEffect = getLanStatEffectBonus(renderCharacter, 'CA');
  const armorClassTotal = baseCa + (addDes ? desMod : 0) + caTemp + caEquip + caLanEffect;
  const caSumBuffs = caTemp + caEquip + caLanEffect;
  const caColor = caSumBuffs > 0 ? appColors.success : (caSumBuffs < 0 ? appColors.danger : appColors.textPrimary);

  const expectedLevel = expectedLevelByXp;
  const isPendingLevelUp = expectedLevel > renderCharacter.level;
  const xpTargetLabel = nextLevelXpRequired == null ? 'MAX' : String(nextLevelXpRequired);

  const checkProficiency = (idx: string, group: any[]) => group.includes(idx);
  const proficientSaves = dbSaves.filter((save: any) => checkProficiency(save.id, character.save_values));
  const proficientSkills = dbSkills.filter((skill: any) => checkProficiency(skill.id, character.skill_values));
  const getAbilityModifierForAbility = (ability: string) => {
    const normalized = String(ability || '').toUpperCase();
    const base = parseInt(renderCharacter.stats?.[normalized]) || 10;
    const temp = (parseInt(renderCharacter.stats?.temp_mods?.[normalized]) || 0) + getLanStatEffectBonus(renderCharacter, normalized);
    const equip = parseInt(renderCharacter.stats?.equip_mods?.[normalized]) || 0;
    return Math.floor(((base + temp + equip) - 10) / 2);
  };
  const getSaveModifierForAbility = (ability: string) => {
    const normalized = String(ability || '').toUpperCase();
    const abilityMod = getAbilityModifierForAbility(normalized);
    const save = dbSaves.find((entry: any) => String(entry.stat || '').toUpperCase() === normalized);
    const proficient = Boolean(save && checkProficiency(save.id, character.save_values));
    return abilityMod + (proficient ? profBonusChar : 0);
  };
  const isLanReadOnly = Boolean(lanInfo?.sessionId && lanSessionStatus && lanSessionStatus !== 'active');
  const activeVisualEffects = getVisibleEffects(renderEffects);
  const conditionFrameStyle = getCurrentBreathFrameStyle(activeVisualEffects as any, effectFrame) || null;
  const activeConditionColor = conditionFrameStyle?.borderColor;

  const handleSheetBack = () => {
    traceApp('NAVIGATION', 'SHEET_BACK_TO_HOME', {
      screen: 'sheet',
      source: 'top_bar_back',
      sessionId: lanInfo?.sessionId || routeSessionId,
      characterId: characterRef.current?.id,
      characterName: characterRef.current?.name,
    });
    router.replace('/' as any);
  };


  // ==============================================================================
  // 2. FUNÇÕES DE AÇÃO QUE UTILIZAM AS VARIÁVEIS ACIMA
  // ==============================================================================

  const updateDB = async (
    updates: Partial<any>,
    options?: { allowLanAuthoritativeCache?: boolean; reason?: string }
  ) => {
    try {
      if (!character?.id) return false;
      const before = {
        hp_current: character.hp_current,
        hp_max: character.hp_max,
        temp_hp: character.temp_hp,
        xp: character.xp,
        gp: character.gp,
        sp: character.sp,
        cp: character.cp,
        active_effects_json: character.active_effects_json,
        equipment: character.equipment,
      };
      traceFunctionCall('updateDB', { updates, options }, {
        screen: 'sheet',
        source: options?.reason || (isLanPlayerRuntime ? 'lan_player_update' : 'offline_update'),
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        patch: updates,
      });

      let nextUpdates = { ...updates };

      if (isLanPlayerRuntime && !options?.allowLanAuthoritativeCache) {
        const { safeUpdates, blockedUpdates } = splitLanPlayerAuthoritativeUpdates(nextUpdates);

        if (hasLanBlockedUpdates(blockedUpdates)) {
          debugLanFlow('LAN_PLAYER_BLOCKED_OFFLINE_UPDATE', {
            reason: options?.reason || 'offline_mutation_in_lan_player',
            blockedKeys: Object.keys(blockedUpdates),
            safeKeys: Object.keys(safeUpdates),
            characterId: character.id,
            characterName: character.name,
          });
        }

        nextUpdates = safeUpdates;
      }

      const entries = Object.entries(nextUpdates);
      if (entries.length === 0) return false;

      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      traceSqlite('SQLITE_WRITE_START', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        functionName: 'updateDB',
        table: 'characters',
        operation: 'UPDATE_CHARACTER',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        patch: nextUpdates,
      });
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => {
        if (!prev) return prev;
        const merged = { ...prev, ...nextUpdates };
        characterRef.current = merged;
        return merged;
      });
      traceSqlite('SQLITE_WRITE_DONE', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        functionName: 'updateDB',
        table: 'characters',
        operation: 'UPDATE_CHARACTER',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        after: { ...before, ...nextUpdates },
        patch: nextUpdates,
      });
      traceApp('UI_UPDATE', 'CHARACTER_SHEET_SET_CHARACTER_FROM_UPDATE_DB', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        after: { ...before, ...nextUpdates },
      });
      return true;
    } catch (e) {
      console.error(e);
      traceError('SQLITE_WRITE_DONE', 'UPDATE_DB_ERROR', e, {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        patch: updates,
      });
      return false;
    }
  };

  const ensureLanWritable = () => {
    if (!isLanReadOnly) return true;
    showCustomAlert('Sessao em leitura', 'Esta sessao esta pausada ou encerrada. A ficha fica somente para consulta.');
    return false;
  };

  const isSheetActionSubmitting = (actionId: string) => submittingSheetActions.includes(actionId);
  const runSheetAction = async <T,>(actionId: string, task: () => Promise<T>): Promise<T | undefined> => {
    const isFastLocalAction = /^(coin:|inventory:|equip:)/.test(actionId);
    if (!isFastLocalAction && submittingSheetActionsRef.current.has(actionId)) {
      debugLanFlow('ACTION_SUBMIT_IGNORED_ALREADY_PENDING', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
      });
      return;
    }

    if (!isFastLocalAction) {
      submittingSheetActionsRef.current.add(actionId);
      setSubmittingSheetActions((current) => current.includes(actionId) ? current : [...current, actionId]);
    }
    debugLanFlow('ACTION_SUBMIT_STARTED', {
      screen: 'sheet',
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      actionId,
    });
    try {
      const result = await task();
      debugLanFlow('ACTION_SUBMIT_DONE', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
      });
      return result;
    } catch (error) {
      debugLanFlow('ACTION_SUBMIT_FAILED', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (!isFastLocalAction) {
        submittingSheetActionsRef.current.delete(actionId);
        setSubmittingSheetActions((current) => current.filter((id) => id !== actionId));
      }
    }
  };

  const sendResourceRequest = async (request: LanResourceRequest) => {
    if (!character) return false;
    traceFunctionCall('sendResourceRequest', request, {
      screen: 'sheet',
      source: 'player_request',
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character.id,
      characterName: character.name,
      playerKey: lanInfo?.sessionId ? getSelfLanKey(lanInfo.sessionId) : '',
    });
    if (!lanInfo?.sessionId) {
      showCustomAlert('Sessao offline', 'Nao ha sessao LAN ativa para enviar este pedido ao mestre.');
      return false;
    }

    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const clientRequestId = request.clientRequestId || makeLanEventId();
    const event: LanSessionEvent = {
      id: clientRequestId,
      clientMsgId: clientRequestId,
      sessionId: lanInfo.sessionId,
      type: 'resource_request',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'request',
      entityId: selfKey,
      ackRequired: true,
      resourceRequest: { ...request, clientRequestId },
      message: request.message,
      createdAt: new Date().toISOString(),
    };

    try {
      console.log('[LAN REQUEST SEND]', {
        sessionId: lanInfo.sessionId,
        joinUrl: lanInfo.joinUrl,
        fromKey: selfKey,
        type: request.kind,
        message: request.message,
      });

      // v56: se o socket cair brevemente, o pedido entra na fila pendente
      // e sera reenviado no foreground/reconnect sem duplicar pelo clientMsgId.
      const sent = await sendLanEventWithRetry(event, 'sendResourceRequest');
      traceFunctionReturn('sendResourceRequest', {
        sent,
        eventId: event.id,
        request,
      }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });
      showCustomAlert(sent ? 'Pedido enviado' : 'Pedido em fila', sent ? 'O mestre recebeu sua solicitacao para revisar.' : 'Sem resposta imediata do mestre; vou reenviar quando a conexao voltar.');
      return true;
    } catch (error) {
      console.warn('[LAN REQUEST FAILED]', error);
      traceError('EVENT_CREATED', 'SEND_RESOURCE_REQUEST_ERROR', error, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        payload: request,
      });
      showCustomAlert('Pedido falhou', 'Nao consegui enviar o pedido para a sessao LAN. Volte para a tela da ficha quando reconectar e tente novamente.');
      return false;
    }
  };

  /** @deprecated Corte 4: consumo/equipamento LAN usam dispatchPlayerCommand e evento transacional unico. */
  const notifyInventoryPatch = async (
    equipment: any,
    reason: string,
    clientRequestId = makeLanEventId(),
    statsPatch?: Record<string, unknown>,
    baseEquipment?: any
  ) => {
    if (!lanInfo?.sessionId || !character) return;
    try {
      const fingerprint = JSON.stringify({
        equipment: normalizeSheetEquipment(equipment),
        stats: statsPatch ? buildSheetStatsWithDerivedEquipMods(statsPatch as Record<string, any>, equipment) : null,
        reason,
      });
      const now = Date.now();
      if (lastInventoryPatchSentRef.current.fingerprint === fingerprint && now - lastInventoryPatchSentRef.current.at < 2500) {
        debugLanFlow('PLAYER_INVENTORY_DUPLICATE_SEND_SKIPPED', {
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
          reason,
          previousClientMsgId: lastInventoryPatchSentRef.current.clientMsgId,
          nextClientMsgId: clientRequestId,
        });
        return true;
      }
      lastInventoryPatchSentRef.current = { fingerprint, at: now, clientMsgId: clientRequestId };
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const base = baseEquipment || characterRef.current?.equipment || character.equipment;
      const inferredDelta = inferSheetInventoryItemDelta(base, equipment);
      const event: LanSessionEvent = {
        id: clientRequestId,
        clientMsgId: clientRequestId,
        sessionId: lanInfo.sessionId,
        type: 'inventory_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'inventory',
        entityId: selfKey,
        ackRequired: true,
        inventoryPatch: {
          targetKey: selfKey,
          equipment,
          baseEquipment: base,
          itemDelta: inferredDelta || undefined,
          reason,
          action: inferredDelta?.mode === 'remove' ? 'remove' : 'self_update',
        },
        statsPatch,
        message: reason,
        createdAt: new Date().toISOString(),
      };
      traceFunctionCall('notifyInventoryPatch', { equipment, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });
      return await sendLanEventWithRetry(event, 'notifyInventoryPatch');
    } catch {
      // A alteracao local continua valida; o mestre sincroniza quando receber o proximo snapshot aceito.
      return false;
    }
  };

  /** @deprecated Corte 4: consumo LAN nao envia numberPatch separado; manter apenas para fluxos ainda legados. */
  const notifyNumberPatch = async (patch: LanSessionEvent['numberPatch'], reason: string) => {
    if (!lanInfo?.sessionId || !character || !patch) return;
    try {
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const eventId = makeLanEventId();
      const event: LanSessionEvent = {
        id: eventId,
        clientMsgId: eventId,
        sessionId: lanInfo.sessionId,
        type: 'player_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'player',
        entityId: selfKey,
        ackRequired: true,
        numberPatch: patch,
        numberPatchIntent: 'mixed',
        message: reason,
        createdAt: new Date().toISOString(),
      };
      traceFunctionCall('notifyNumberPatch', { patch, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch,
      });
      const sent = await sendLanEventWithRetry(event, 'notifyNumberPatch');
      traceFunctionReturn('notifyNumberPatch', { sent, eventId: event.id }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
      });
    } catch {
      showCustomAlert('Sincronizacao falhou', 'Nao consegui enviar esta alteracao ao mestre.');
    }
  };


  const getCurrentCoinPatch = () => {
    const base = characterRef.current || character;
    return sanitizeCoins({ gp: base?.gp, sp: base?.sp, cp: base?.cp });
  };

  const getCoinTotalCopper = (coins: Partial<Record<'gp' | 'sp' | 'cp', number>>) => getCoinTotalCopperValue(coins);

  const persistFastLocalPatch = async (
    updates: Partial<any>,
    reason: string,
    isStillCurrent?: () => boolean
  ) => {
    const currentCharacter = characterRef.current || character;
    if (!currentCharacter?.id) return false;
    if (isStillCurrent && !isStillCurrent()) {
      debugLanFlow('FAST_LOCAL_PERSIST_SKIPPED_STALE', {
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        reason,
        patch: updates,
      });
      return false;
    }
    const entries = Object.entries(updates);
    if (entries.length === 0) return false;
    const setString = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([_, value]) => (typeof value === 'object' ? JSON.stringify(value) : value));
    try {
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, Number(currentCharacter.id)]);
      debugLanFlow('FAST_LOCAL_PERSIST_DONE', {
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        reason,
        patch: updates,
      });
      return true;
    } catch (error) {
      debugLanFlow('FAST_LOCAL_PERSIST_FAILED', {
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const ensureSheetLanProjection = (sessionValue: string, selfKey: string) => {
    if (!sessionValue || !selfKey || getLanProjection(sessionValue) || !characterRef.current) return;
    const current = characterRef.current;
    applyIncomingSnapshot({
      sessionId: sessionValue,
      serverSeq: Date.now(),
      structural: true,
      state: {
        status: (lanSessionStatusRef.current || 'active') as any,
        currentTurn: 1,
        elapsedMinutes: 0,
        players: [{
          id: current.id,
          sessionId: sessionValue,
          remoteKey: selfKey,
          playerName: current.playerName || current.name,
          characterId: current.id,
          sourceCharacterId: current.id,
          characterName: current.name,
          level: current.level || 1,
          className: current.class || '',
          race: current.race || '',
          hpCurrent: current.hp_current,
          hpMax: current.hp_max,
          tempHp: current.temp_hp,
          xp: current.xp,
          gp: current.gp,
          sp: current.sp,
          cp: current.cp,
          stats: current.stats || {},
          equipment: normalizeSheetEquipment(current.equipment),
          effects: Array.isArray(current.active_effects)
            ? current.active_effects
            : safeJsonParse<any[]>(current.active_effects_json, []),
        }],
      },
    });
  };

  const dispatchSheetLanPlayerCommand = async (
    command: LanCommand,
    actionLabel: string,
  ) => {
    if (!activeLanSessionId || !activeLanPlayerKey || !characterRef.current) return false;
    ensureSheetLanProjection(activeLanSessionId, activeLanPlayerKey);

    const result = dispatchPlayerCommand(command);
    const nextCharacter = result.projection.players[activeLanPlayerKey];
    if (nextCharacter) {
      const patch = lanCharacterToSheetPatch(nextCharacter);
      setCharacter((current: any) => {
        if (!current) return current;
        const merged = { ...current, ...patch };
        characterRef.current = merged;
        return merged;
      });
      void persistFastLocalPatch({
        hp_current: patch.hp_current,
        hp_max: patch.hp_max,
        temp_hp: patch.temp_hp,
        xp: patch.xp,
        gp: patch.gp,
        sp: patch.sp,
        cp: patch.cp,
        stats: patch.stats,
        equipment: patch.equipment,
        active_effects_json: patch.active_effects_json,
      }, `lan_player_engine_${command.type}`);
    }

    const event = authoritativeEventToSheetLanEvent(result.event, {
      selfKey: activeLanPlayerKey,
      characterName: characterRef.current.name || 'Jogador',
    });
    if (event) {
      const sent = await sendLanEventWithRetry(event, `dispatchPlayerCommand:${command.type}`);
      debugLanFlow('PLAYER_ENGINE_COMMAND_DISPATCHED', {
        sessionId: activeLanSessionId,
        playerKey: activeLanPlayerKey,
        commandType: command.type,
        commandId: command.commandId,
        eventId: event.id,
        actionLabel,
        sent,
      });
    }
    return true;
  };

  const sendCoinSelfPatchRequest = async (
    nextCoins: Partial<Record<'gp' | 'sp' | 'cp', number>>,
    reason: string
  ) => {
    const currentCharacter = characterRef.current || character;
    if (!lanInfo?.sessionId || !currentCharacter) return false;
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const current = getCurrentCoinPatch();
    const next = {
      gp: nextCoins.gp == null ? current.gp : Math.max(0, Math.floor(Number(nextCoins.gp) || 0)),
      sp: nextCoins.sp == null ? current.sp : Math.max(0, Math.floor(Number(nextCoins.sp) || 0)),
      cp: nextCoins.cp == null ? current.cp : Math.max(0, Math.floor(Number(nextCoins.cp) || 0)),
    };
    const opSeq = coinOptimisticSeqRef.current + 1;
    const eventId = makeLanEventId();
    const nextTotalCopper = getCoinTotalCopper(next);
    const event: LanSessionEvent = {
      id: eventId,
      clientMsgId: eventId,
      sessionId: lanInfo.sessionId,
      type: 'coin_self_patch_request',
      fromKey: selfKey,
      fromName: currentCharacter.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'player',
      entityId: selfKey,
      ackRequired: true,
      numberPatchIntent: 'self_coin',
      numberPatch: next,
      coinPatchRequest: {
        targetKey: selfKey,
        current,
        next,
        currentTotalCopper: getCoinTotalCopper(current),
        nextTotalCopper,
        opSeq,
        reason,
      },
      message: reason,
      createdAt: new Date().toISOString(),
    };

    // Ação rápida: a UI muda no mesmo frame e o SQLite local é persistido sem
    // setState posterior. Isso impede que timers antigos gravem 9 PO depois que
    // o jogador já clicou para 8/7/6 PO.
    coinOptimisticSeqRef.current = opSeq;
    pendingSelfCoinStateRef.current = null;

    if (coinPatchDebounceRef.current?.timer) {
      clearTimeout(coinPatchDebounceRef.current.timer);
    }
    coinPatchDebounceRef.current = {
      event,
      opSeq,
      timer: setTimeout(() => {
        const queued = coinPatchDebounceRef.current;
        if (!queued || queued.opSeq !== opSeq) return;
        const queuedEvent = queued.event || event;
        coinPatchDebounceRef.current = null;
        void (async () => {
          try {
            await sendLanEventWithRetry(queuedEvent, 'sendCoinSelfPatchRequest');
            debugLanFlow('PLAYER_SELF_COIN_PATCH_SENT_FAST', {
              eventId: queuedEvent.id,
              opSeq,
              next: queuedEvent.coinPatchRequest?.next,
            });
          } catch {
            showCustomAlert('Sincronizacao falhou', 'Nao consegui enviar esta alteracao ao mestre.');
          }
        })();
      }, 30),
    };

    return true;
  };

  /** @deprecated Corte 4: consumo LAN nao envia effectPatch separado; manter apenas para fluxos ainda legados. */
  const notifyEffectPatch = async (addEffects: any[], reason: string) => {
    if (!lanInfo?.sessionId || !character || addEffects.length === 0) return;
    const selfKey = getSelfLanKey(lanInfo.sessionId);

    try {
      const eventId = makeLanEventId();
      const event: LanSessionEvent = {
        id: eventId,
        clientMsgId: eventId,
        sessionId: lanInfo.sessionId,
        type: 'effect_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'character_effects',
        entityId: selfKey,
        entityRevision: Date.now(),
        ackRequired: true,
        effectPatch: {
          targetKey: selfKey,
          add: addEffects as any,
          update: [],
          remove: [],
        },
        message: reason,
        createdAt: new Date().toISOString(),
      };

      traceFunctionCall('notifyEffectPatch', { addEffects, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch: event.effectPatch,
      });
      await sendLanEventWithRetry(event, 'notifyEffectPatch');
    } catch (error) {
      console.warn('[LAN ITEM EFFECT PATCH FAILED]', error);
    }
  };

  const sendEffectSaveResult = async (
    save: NonNullable<LanSessionEvent['saveRequest']>,
    rawRoll: number,
    rollMode: 'virtual' | 'manual',
  ) => {
    return runSheetAction(`save:${save.id}`, async () => {
    if (!lanInfo?.sessionId || !character) return false;
    const modifier = getSaveModifierForAbility(save.saveAbility);
    const baseResolvedSave = resolveSavingThrow({
      ability: save.saveAbility,
      dc: Number(save.dc || 1),
      modifier,
      rollMode,
      manualRoll: rawRoll,
    });
    // v108: o campo manual representa o resultado final informado pelo jogador.
    // Antes ele era travado em 1..20 como dado bruto, então valores totais acima de 20
    // podiam ser marcados como falha mesmo quando passavam da CD.
    const manualTotal = Math.floor(Number(rawRoll) || 0);
    const resolvedSave = rollMode === 'manual'
      ? {
          ...baseResolvedSave,
          rawRoll: Math.max(1, Math.min(20, manualTotal - modifier || manualTotal)),
          manualValue: manualTotal,
          total: manualTotal,
          passed: manualTotal >= baseResolvedSave.dc,
        }
      : baseResolvedSave;
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const eventId = makeLanEventId();
    const event: LanSessionEvent = {
      id: eventId,
      clientMsgId: eventId,
      sessionId: lanInfo.sessionId,
      type: 'effect_save_result',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'save',
      entityId: save.id,
      ackRequired: true,
      saveResult: {
        requestId: save.id,
        rollMode,
        dice: '1d20',
        rawRoll: resolvedSave.rawRoll,
        manualValue: rollMode === 'manual' ? resolvedSave.total : undefined,
        modifier: resolvedSave.modifier,
        total: resolvedSave.total,
        dc: save.dc ?? null,
        passed: resolvedSave.passed,
      },
      message: `${character.name} rolou ${resolvedSave.total} em ${resolvedSave.ability}${save.dc ? ` CD ${save.dc}` : ''}.`,
      createdAt: new Date().toISOString(),
    };

    try {
      debugLanFlow('PLAYER_EFFECT_SAVE_ROLLED', {
        eventId: event.id,
        requestId: save.id,
        saveAbility: resolvedSave.ability,
        rawRoll: resolvedSave.rawRoll,
        modifier: resolvedSave.modifier,
        total: resolvedSave.total,
        dc: resolvedSave.dc,
        passed: resolvedSave.passed,
        rollMode,
      });
      resolvedSaveRequestIdsRef.current.add(save.id);
      openedSaveRequestIdsRef.current.delete(save.id);
      setPendingEffectSave(null);
      setSaveManualValue('');
      await sendLanEventWithRetry(event, 'sendEffectSaveResult');
      showCustomAlert(
        resolvedSave.passed ? 'Salvaguarda passou' : 'Salvaguarda falhou',
        rollMode === 'manual'
          ? `${resolvedSave.ability}: total informado ${resolvedSave.total}. CD ${resolvedSave.dc}.`
          : `${resolvedSave.ability}: d20 ${resolvedSave.rawRoll} ${resolvedSave.modifier >= 0 ? '+' : ''}${resolvedSave.modifier} = ${resolvedSave.total}. CD ${resolvedSave.dc}.`
      );
      return true;
    } catch {
      showCustomAlert('Teste falhou', 'Nao consegui enviar a salvaguarda ao mestre.');
      return false;
    }
    });
  };

  const rollVirtualEffectSave = (save: NonNullable<LanSessionEvent['saveRequest']>) => {
    void sendEffectSaveResult(save, 1, 'virtual');
  };

  const handleXP = async (action: 'add' | 'remove') => {
    await runSheetAction(`xp:${action}`, async () => {
    traceButton('sheet', action === 'add' ? 'REQUEST_OR_APPLY_XP_ADD' : 'REQUEST_OR_APPLY_XP_REMOVE', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { action, inputValue },
      before: character ? { xp: character.xp, level: character.level } : undefined,
    });
    if (!ensureLanWritable()) return;
    const amount = parseInt(inputValue) || 0;
    if (amount <= 0) return;

    const newXp = Math.max(0, action === 'add' ? Number(character.xp || 0) + amount : Number(character.xp || 0) - amount);
    const calcNewLevel = await getExpectedLevelForXpFromDb(db, newXp);

    if (lanInfo?.sessionId) {
      // v35: XP pedido pelo jogador NAO é autônomo. Ele volta a ser uma
      // solicitação para o mestre. Somente depois do aceite o player_patch
      // oficial chega e a ficha aplica o XP. O level up continua sendo
      // autônomo apenas depois que o XP oficial já está na ficha.
      const approved = await sendResourceRequest({
        kind: 'xp',
        action,
        operation: 'master_approval',
        amount: action === 'add' ? amount : -amount,
        message: `${character.name} pediu ${action === 'add' ? '+' : '-'}${amount} XP.`,
      });
      if (approved) {
        setXpModalVisible(false);
        setInputValue('');
      }
      return;
    }

    if (calcNewLevel > character.level && action === 'add') {
      setNewLevelData(calcNewLevel);
      setLevelUpModalVisible(true); 
    }
    
    await updateDB({ xp: newXp });
    setXpModalVisible(false); 
    setInputValue('');
    });
  };

  const handleHP = (action: 'damage' | 'heal') => {
    void runSheetAction(`hp:${action}`, async () => {
    traceButton('sheet', action === 'damage' ? 'REQUEST_OR_APPLY_HP_DAMAGE' : 'REQUEST_OR_APPLY_HP_HEAL', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { action, inputValue },
      before: character ? { hp_current: character.hp_current, hp_max: character.hp_max, temp_hp: character.temp_hp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const amount = parseInt(inputValue) || 0;
    if (lanInfo?.sessionId && amount > 0) {
      await sendResourceRequest({
        kind: 'hp',
        action,
        amount: action === 'heal' ? amount : -amount,
        message: `${action === 'heal' ? '+' : '-'}${amount} HP`,
      });
      setHpModalVisible(false);
      setInputValue('');
      return;
    }

    let newDisplayCurrent = action === 'damage'
      ? Math.max(0, displayHpCurrent - amount)
      : Math.min(displayHpMax, displayHpCurrent + amount);
    let nextTempHp = Number(character.temp_hp || 0);
    let nextActiveEffects: any[] | null = null;

    if (action === 'damage') {
      const damageResult = applyDamageWithTempHp({
        hpCurrent: displayHpCurrent,
        hpMax: displayHpMax,
        tempHp: Number(character.temp_hp || 0),
        damage: amount,
      });
      newDisplayCurrent = damageResult.nextHpCurrent;
      nextTempHp = damageResult.nextTempHp;
      debugLanFlow('DAMAGE_WITH_TEMP_HP_CALCULATED', {
        screen: 'sheet',
        characterId: character.id,
        damage: amount,
        result: damageResult,
      });
      if (damageResult.absorbedTempHp > 0) {
        const currentEffects: any[] = Array.isArray(character.active_effects)
          ? character.active_effects
          : safeJsonParse<any[]>(character.active_effects_json, []);
        const consumedEffects = consumeTempHpEffectsLocally(currentEffects, damageResult.absorbedTempHp);
        if (consumedEffects.changed) {
          nextActiveEffects = consumedEffects.effects;
        }
        debugLanFlow(consumedEffects.changed ? 'PLAYER_TEMP_HP_EFFECTS_CONSUMED_LOCALLY' : 'TEMP_HP_DAMAGE_NO_ACTIVE_EFFECTS', {
          screen: 'sheet',
          characterId: character.id,
          absorbedTempHp: damageResult.absorbedTempHp,
          beforeCount: currentEffects.length,
          afterCount: consumedEffects.effects.length,
        });
      }
    }

    const newDbCurrent = newDisplayCurrent - hpBonusFromCon;
    const dbUpdates: Record<string, unknown> = { hp_current: newDbCurrent, temp_hp: nextTempHp };
    if (nextActiveEffects) dbUpdates.active_effects_json = JSON.stringify(nextActiveEffects);

    await updateDB(dbUpdates, { reason: 'hp_damage_with_temp_hp' });
    if (nextActiveEffects) {
      setCharacter((prev: any) => prev ? ({ ...prev, active_effects: nextActiveEffects }) : prev);
    }
    notifyOwnLanStatus(newDbCurrent, character.hp_max);
    setHpModalVisible(false); 
    setInputValue('');
    });
  };

  const handleTempHP = () => {
    void runSheetAction('temp_hp', async () => {
    if (!ensureLanWritable()) return;
    const amount = Math.max(0, parseInt(inputValue) || 0);
    if (amount <= 0) return;

    if (lanInfo?.sessionId) {
      await sendResourceRequest({
        kind: 'temp_hp',
        action: 'add',
        amount,
        message: `+${amount} PV temporario`,
      });
      setHpModalVisible(false);
      setInputValue('');
      return;
    }

    await updateDB({ temp_hp: Math.max(0, Number(character.temp_hp || 0) + amount) });
    setHpModalVisible(false);
    setInputValue('');
    });
  };

  const handleTempBuffSubmit = () => {
    void runSheetAction('temp_buff', async () => {
    if (!ensureLanWritable()) return;
    let newStats = { ...character.stats };
    const val = parseInt(tempBuffValue) || 0;
    if (lanInfo?.sessionId) {
      await sendResourceRequest({
        kind: 'buff',
        action: 'temp',
        field: activeBuffStat,
        value: val,
        duration: 1,
        unit: 'rest',
        message: `${activeBuffStat} ${val >= 0 ? '+' : ''}${val} temporario`,
      });
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }

    if (val === 0) delete newStats.temp_mods[activeBuffStat];
    else newStats.temp_mods[activeBuffStat] = val;
    await updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
    });
  };

  const clearTempBuff = () => {
    if (!ensureLanWritable()) return;
    if (lanInfo?.sessionId) {
      showCustomAlert('Buff oficial', 'Durante a sessao LAN, peca ao mestre para remover buffs ou debuffs.');
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }
    let newStats = { ...character.stats };
    delete newStats.temp_mods[activeBuffStat];
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const goToEditScreen = () => {
    if (!ensureLanWritable()) return;
    if (levelUpNavigationLockedRef.current) return;
    levelUpNavigationLockedRef.current = true;
    setLevelUpModalVisible(false);
    router.replace(`/edit?id=${character.id}&levelUpTo=${newLevelData}${lanInfo?.sessionId ? `&sessionId=${lanInfo.sessionId}&joinUrl=${encodeURIComponent(lanInfo.joinUrl || '')}` : ''}` as any);
  };

  const handleCoinSubmit = () => {
    void runSheetAction(`coin:set:${activeCoinType}`, async () => {
    traceButton('sheet', 'REQUEST_OR_APPLY_COIN_SET', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { activeCoinType, inputValue },
      before: character ? { gp: character.gp, sp: character.sp, cp: character.cp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const nextValue = Math.max(0, parseInt(inputValue) || 0);
    if (lanInfo?.sessionId) {
      const currentCoins = getCurrentCoinPatch();
      const nextCoins = { ...currentCoins, [activeCoinType]: nextValue };
      if (getCoinTotalCopper(nextCoins) > getCoinTotalCopper(currentCoins)) {
        const amount = nextValue - Number(character[activeCoinType] || 0);
        await sendResourceRequest({
          kind: 'coin',
          action: 'add',
          operation: 'master_approval',
          field: activeCoinType,
          amount,
          message: `+${amount} ${COIN_NAMES[activeCoinType]}`,
        });
      } else {
        await sendCoinSelfPatchRequest(
          nextCoins,
          `${character.name} ajustou ${COIN_NAMES[activeCoinType]} para ${nextValue}.`
        );
      }
      setCoinModalVisible(false);
      setInputValue('');
      return;
    }
    await updateDB({ [activeCoinType]: nextValue });
    setCoinModalVisible(false); setInputValue('');
    });
  };

  const updateCoins = (type: 'gp' | 'sp' | 'cp', delta: number) => {
    void runSheetAction(`coin:delta:${type}`, async () => {
    traceButton('sheet', 'REQUEST_OR_APPLY_COIN_DELTA', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { type, delta },
      before: character ? { gp: character.gp, sp: character.sp, cp: character.cp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const currentChar = characterRef.current || character;
    const nextValue = Math.max(0, Number(currentChar?.[type] || 0) + delta);
    if (lanInfo?.sessionId) {
      const currentCoins = getCurrentCoinPatch();
      const nextCoins = { ...currentCoins, [type]: nextValue };
      if (getCoinTotalCopper(nextCoins) > getCoinTotalCopper(currentCoins)) {
        const amount = nextValue - Number(currentChar?.[type] || 0);
        await sendResourceRequest({
          kind: 'coin',
          action: 'add',
          operation: 'master_approval',
          field: type,
          amount,
          message: `+${amount} ${COIN_NAMES[type]}`,
        });
      } else {
        await sendCoinSelfPatchRequest(nextCoins, `${character.name} reduziu ${COIN_NAMES[type]} para ${nextValue}.`);
      }
      return;
    }
    await updateDB({ [type]: nextValue });
    });
  };

  const executeCoinConversion = (sourceAmount: number, targetAmount: number) => {
    void runSheetAction('coin:convert', async () => {
    if (!ensureLanWritable()) return;
    const currentChar = characterRef.current || character;
    const nextCoins = {
      ...getCurrentCoinPatch(),
      [convertFrom]: Math.max(0, Number(currentChar?.[convertFrom] || 0) - sourceAmount),
      [convertTo]: Math.max(0, Number(currentChar?.[convertTo] || 0) + targetAmount)
    };
    if (lanInfo?.sessionId) {
      await sendCoinSelfPatchRequest(
        nextCoins,
        `${character.name} converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`
      );
      setConvertModalVisible(false);
      setConvertAmount('');
      return;
    }
    await updateDB(nextCoins);
    setConvertModalVisible(false);
    setConvertAmount('');
    showCustomAlert("Câmbio Realizado", `Você converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`);
    });
  };

  const isLanCharacter = () => isLanPlayerRuntime;

  const normalizeInventoryItemFromCatalog = (item: any, qty = 1) => {
    const effectHidden = getItemEffectHidden(item);

    return {
      name: String(item?.name || 'Item'),
      qty,
      weight: Number(item?.weight) || 0,
      damage: item?.damage || '',
      damage_type: item?.damage_type || '',
      properties: item?.properties || '',
      descricao: item?.descricao || '',
      effect_json: item?.effect_json || '',
      duration_value: item?.duration_value ?? null,
      duration_unit: item?.duration_unit ?? null,
      effect_hidden: effectHidden ? 1 : 0,
      effectHidden,
      hiddenEffect: effectHidden,
      criador: item?.criador,
    };
  };

  const hydrateInventoryItemForEffects = (item: any) => {
    const catalogItem = dbItemsCatalog.find((cat: any) => String(cat.name || '') === String(item?.name || ''));
    const effectHidden = getItemEffectHidden(item, catalogItem);
    const hydrated = {
      ...catalogItem,
      ...item,
      name: item?.name || catalogItem?.name || 'Item',
      qty: Number(item?.qty ?? catalogItem?.qty ?? 1) || 1,
      weight: Number(item?.weight ?? catalogItem?.weight ?? 0) || 0,
      damage: item?.damage || catalogItem?.damage || '',
      damage_type: item?.damage_type || catalogItem?.damage_type || '',
      properties: item?.properties || catalogItem?.properties || '',
      descricao: item?.descricao || catalogItem?.descricao || '',
      effect_json: item?.effect_json || catalogItem?.effect_json || '',
      duration_value: item?.duration_value ?? catalogItem?.duration_value ?? null,
      duration_unit: item?.duration_unit ?? catalogItem?.duration_unit ?? null,
      effect_hidden: effectHidden ? 1 : 0,
      effectHidden,
      hiddenEffect: effectHidden,
    };

    return hydrated;
  };

  const updateBagQty = (index: number, delta: number, overrideItem?: any) => {
    if (!ensureLanWritable()) return;
    if (isLanCharacter() && delta > 0) {
      showCustomAlert('Inventario bloqueado', 'Durante a sessao LAN, apenas o mestre pode adicionar itens ao jogador.');
      return;
    }

    let newBag = [...character.equipment.bag];
    const item = overrideItem ? hydrateInventoryItemForEffects(overrideItem) : hydrateInventoryItemForEffects(newBag[index]);
    if (!item) return;

    if (newBag[index]) {
      newBag[index] = {
        ...item,
        qty: (Number(newBag[index].qty) || 0) + delta,
      };
    }

    if (newBag[index]?.qty <= 0) newBag = newBag.filter((_, i) => i !== index);
    const nextEquipment = { ...character.equipment, bag: newBag };

    if (isLanPlayerRuntime) {
      if (delta < 0) {
        const actionId = `inventory:${String(item.name || index)}:${Math.abs(delta)}`;
        debugLanFlow('LAN_PLAYER_REQUEST_INVENTORY_PATCH', {
          characterId: character.id,
          itemName: item.name,
          delta,
          nextQty: newBag.find((entry: any) => entry.name === item.name)?.qty || 0,
        });
        const clientRequestId = makeLanEventId();
        pendingSelfInventoryStateRef.current = { equipment: nextEquipment, at: Date.now(), clientMsgId: clientRequestId };
        setCharacter((current: any) => {
          if (!current) return current;
          const merged = { ...current, equipment: nextEquipment };
          characterRef.current = merged;
          return merged;
        });
        void persistFastLocalPatch({ equipment: nextEquipment }, 'lan_player_self_inventory_optimistic');
        void runSheetAction(actionId, async () => {
          await notifyInventoryPatch(
            nextEquipment,
            `${character.name} consumiu/removeu ${Math.abs(delta)}x ${item.name} da mochila.`,
            clientRequestId,
            undefined,
            character.equipment
          );
        });
      }
      return;
    }

    void updateDB({ equipment: nextEquipment }, { reason: 'offline_inventory_update' });
  };

  const addItemToBag = (item: any) => {
    if (!ensureLanWritable()) return;
    if (isLanCharacter()) {
      showCustomAlert('Inventario bloqueado', 'Durante a sessao LAN, peca ao mestre para entregar itens.');
      setItemModalVisible(false);
      setItemSearch('');
      return;
    }

    let newBag = [...character.equipment.bag];
    const existingIndex = newBag.findIndex((i: any) => i.name === item.name);
    const catalogItem = normalizeInventoryItemFromCatalog(item, 1);

    if (existingIndex > -1) {
      const existing = newBag[existingIndex];
      newBag[existingIndex] = {
        ...catalogItem,
        ...existing,
        qty: (Number(existing.qty) || 0) + 1,
        damage: existing.damage || catalogItem.damage,
        damage_type: existing.damage_type || catalogItem.damage_type,
        properties: existing.properties || catalogItem.properties,
        descricao: existing.descricao || catalogItem.descricao,
        effect_json: existing.effect_json || catalogItem.effect_json,
        duration_value: existing.duration_value ?? catalogItem.duration_value,
        duration_unit: existing.duration_unit ?? catalogItem.duration_unit,
        effect_hidden: getItemEffectHidden(existing, catalogItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(existing, catalogItem),
        hiddenEffect: getItemEffectHidden(existing, catalogItem),
      };
    } else {
      newBag.push(catalogItem);
    }

    updateDB({ equipment: { ...character.equipment, bag: newBag } });
    setItemModalVisible(false); setItemSearch('');
  };

  const handleSendItemToPlayer = async (target: PublicLanPlayer) => {
    await runSheetAction(`send_item:${target.key}`, async () => {
      if (!ensureLanWritable()) return;
      if (!selectedBagItem || !lanInfo || !character) return;

      const tradeItem = makeTradeItem(selectedBagItem.item, actionQty);
      const availableQty = Math.max(0, Number(selectedBagItem.item?.qty || 0));
      if (availableQty < tradeItem.qty) {
        showCustomAlert('Envio cancelado', 'Voce nao tem quantidade suficiente deste item.');
        return;
      }

      const pendingKey = `${lanInfo.sessionId}:${target.key}:${String(tradeItem.name || '').toLowerCase()}:${tradeItem.qty}`;
      if (pendingOutgoingItemSendsRef.current.has(pendingKey)) {
        debugLanFlow('SEND_ITEM_DUPLICATE_TAP_BLOCKED', {
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
          targetKey: target.key,
          itemName: tradeItem.name,
          qty: tradeItem.qty,
        });
        showCustomAlert('Envio em andamento', 'Aguarde a confirmação da mesa antes de enviar este item novamente.');
        return;
      }

      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const requestId = makeLanEventId();
      const itemInstanceId = String(tradeItem.id || tradeItem.inventoryItemId || tradeItem.stackKey || getInventoryStackKey(selectedBagItem.item));
      const engineSent = await dispatchSheetLanPlayerCommand({
        type: 'send_item',
        commandId: requestId,
        sessionId: lanInfo.sessionId,
        actorKey: selfKey,
        fromKey: selfKey,
        toKey: target.key,
        itemInstanceId,
        qty: tradeItem.qty,
        message: `${character.name} enviou ${tradeItem.qty}x ${tradeItem.name} para ${target.characterName}.`,
      }, 'send_item');
      if (engineSent) {
        pendingOutgoingItemSendsRef.current.add(pendingKey);
        setTimeout(() => pendingOutgoingItemSendsRef.current.delete(pendingKey), 8000);
        showCustomAlert('Item enviado', `${target.characterName} recebera ${tradeItem.qty}x ${tradeItem.name}. O inventario sera sincronizado pela projection LAN.`);
        setTargetPickerMode(null);
        setSelectedBagItem(null);
        return;
      }

      try {
        pendingOutgoingItemSendsRef.current.add(pendingKey);
        setTimeout(() => pendingOutgoingItemSendsRef.current.delete(pendingKey), 8000);

        const currentEquipment = characterRef.current?.equipment || character.equipment;
        const nextBag = [...(currentEquipment?.bag || [])];
        const itemIndex = nextBag.findIndex((entry: any, index: number) => (
          index === selectedBagItem.index || String(entry?.name || '') === String(tradeItem.name || '')
        ));
        let sourceEquipmentAfter = currentEquipment;
        if (itemIndex >= 0) {
          const currentItem = nextBag[itemIndex];
          const nextQty = Math.max(0, Number(currentItem?.qty || 0) - tradeItem.qty);
          if (nextQty <= 0) nextBag.splice(itemIndex, 1);
          else nextBag[itemIndex] = { ...currentItem, qty: nextQty };
          sourceEquipmentAfter = { ...currentEquipment, bag: nextBag };
        }
        const event: LanSessionEvent = {
          id: requestId,
          clientMsgId: requestId,
          sessionId: lanInfo.sessionId,
          type: 'send_item_request',
          fromKey: selfKey,
          fromName: character.name,
          toKey: 'master',
          toName: 'Mestre',
          entityType: 'inventory',
          entityId: target.key,
          ackRequired: true,
          sendItemRequest: {
            requestId,
            fromKey: selfKey,
            toKey: target.key,
            item: tradeItem,
            qty: tradeItem.qty,
            sourceEquipmentBefore: currentEquipment,
            sourceEquipmentAfter,
          },
          item: tradeItem,
          message: `${character.name} enviou ${tradeItem.qty}x ${tradeItem.name} para ${target.characterName}.`,
          createdAt: new Date().toISOString(),
        };

        const sent = await sendLanEventWithRetry(event, 'sendItemRequest');

        // Atualizacao otimista: remove imediatamente da mochila local para impedir
        // duplo envio acidental antes do inventory_patch oficial chegar do host.
        // v71: tambem registra a acao pendente para o patch transfer_out oficial
        // nao aplicar a mesma remocao uma segunda vez.
        if (sourceEquipmentAfter !== currentEquipment) {
          pendingSelfInventoryStateRef.current = { equipment: sourceEquipmentAfter, at: Date.now(), clientMsgId: requestId };
          setCharacter((current: any) => {
            if (!current) return current;
            const merged = { ...current, equipment: sourceEquipmentAfter };
            characterRef.current = merged;
            return merged;
          });
          await updateDB(
            { equipment: sourceEquipmentAfter },
            { allowLanAuthoritativeCache: true, reason: 'lan_player_send_item_optimistic_remove' }
          );
        }

        showCustomAlert(sent ? 'Item enviado' : 'Item em fila', sent
          ? `${target.characterName} recebera ${tradeItem.qty}x ${tradeItem.name}. O inventario sera sincronizado automaticamente.`
          : `A conexao oscilou; vou reenviar ${tradeItem.qty}x ${tradeItem.name} quando reconectar.`);
      } catch {
        pendingOutgoingItemSendsRef.current.delete(pendingKey);
        showCustomAlert('Envio falhou', 'Nao consegui avisar a sessao LAN. O inventario local nao foi alterado.');
      } finally {
        setTargetPickerMode(null);
        setSelectedBagItem(null);
      }
    });
  };

  const handleOfferTradeToPlayer = async (target: PublicLanPlayer) => {
    await runSheetAction(`trade_offer:${target.key}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedBagItem || !lanInfo || !character) return;
    const offeredItem = makeTradeItem(selectedBagItem.item, actionQty);

    try {
      const tradeId = makeLanEventId();
      const offerEvent: LanSessionEvent = {
        id: tradeId,
        clientMsgId: tradeId,
        sessionId: lanInfo.sessionId,
        type: 'trade_offer',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: target.key,
        toName: target.characterName,
        entityType: 'inventory',
        entityId: target.key,
        ackRequired: true,
        tradeId,
        offeredItem,
        createdAt: new Date().toISOString(),
      };
      const sent = await sendLanEventWithRetry(offerEvent, 'tradeOffer');
      showCustomAlert(sent ? 'Troca enviada' : 'Troca em fila', sent
        ? `${target.characterName} recebeu sua proposta de troca.`
        : 'A proposta sera reenviada automaticamente quando reconectar.');
    } catch {
      showCustomAlert('Troca falhou', 'Nao consegui enviar a proposta para a sessao LAN.');
    } finally {
      setTargetPickerMode(null);
      setSelectedBagItem(null);
    }
    });
  };

  const handleAcceptTrade = async () => {
    const currentOffer = selectedTradeOffer;
    await runSheetAction(`trade_accept:${currentOffer?.id || ''}`, async () => {
      if (!ensureLanWritable()) return;
      if (!currentOffer || !lanInfo || !character) return;

      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const tradeKey = currentOffer.tradeId || currentOffer.id;
      const requestedItem = tradeCounterItem ? makeTradeItem(tradeCounterItem.item, tradeCounterQty) : undefined;
      const isCounterResponse = currentOffer.type === 'trade_counter';

      if (!isCounterResponse && tradeCounterItem && requestedItem) {
        const availableQty = Math.max(0, Number(tradeCounterItem.item?.qty || 0));
        if (availableQty < requestedItem.qty) {
          showCustomAlert('Troca cancelada', 'Voce nao tem quantidade suficiente do item escolhido.');
          return;
        }
      }

      if (isCounterResponse && currentOffer.offeredItem) {
        const offeredQty = Math.max(1, Number(currentOffer.offeredItem.qty || 1));
        const owned = (character.equipment?.bag || []).find((entry: any) => isSameSheetInventoryItem(entry, currentOffer.offeredItem as any));
        if (!owned || Math.max(0, Number(owned.qty || 0)) < offeredQty) {
          showCustomAlert('Troca cancelada', 'Voce nao tem mais o item/quantidade que ofereceu nessa proposta.');
          return;
        }
      }

      try {
        const eventId = makeLanEventId();

        if (!isCounterResponse) {
          const counterEvent: LanSessionEvent = {
            id: eventId,
            clientMsgId: eventId,
            sessionId: lanInfo.sessionId,
            type: 'trade_counter',
            fromKey: selfKey,
            fromName: character.name,
            toKey: currentOffer.fromKey,
            toName: currentOffer.fromName,
            entityType: 'inventory',
            entityId: tradeKey,
            ackRequired: true,
            tradeId: tradeKey,
            tradeAccept: {
              tradeId: tradeKey,
              fromKey: currentOffer.fromKey,
              toKey: selfKey,
            },
            offeredItem: currentOffer.offeredItem,
            requestedItem,
            message: requestedItem
              ? `${character.name} respondeu oferecendo ${requestedItem.qty}x ${requestedItem.name}.`
              : `${character.name} respondeu sem contraoferta.`,
            createdAt: new Date().toISOString(),
          };

          const sent = await sendLanEventWithRetry(counterEvent, 'tradeCounter');
          setIncomingTrades((current) => current.filter((event) => (event.tradeId || event.id) !== tradeKey));
          setSelectedTradeOffer(null);
          setTradeCounterItem(null);
          showCustomAlert(sent ? 'Resposta enviada' : 'Resposta em fila', sent
            ? `${currentOffer.fromName} recebeu sua resposta. A troca so sera concluida se ele aceitar.`
            : 'A resposta sera reenviada automaticamente quando reconectar.');
          return;
        }

        const finalTradeFromKey = currentOffer.tradeAccept?.fromKey || selfKey;
        const finalTradeToKey = currentOffer.tradeAccept?.toKey || currentOffer.fromKey;
        const finalAcceptEvent: LanSessionEvent = {
          id: eventId,
          clientMsgId: eventId,
          sessionId: lanInfo.sessionId,
          type: 'trade_accept',
          fromKey: selfKey,
          fromName: character.name,
          toKey: 'master',
          toName: 'Mestre',
          entityType: 'inventory',
          entityId: tradeKey,
          ackRequired: true,
          tradeId: tradeKey,
          tradeAccept: {
            tradeId: tradeKey,
            fromKey: finalTradeFromKey,
            toKey: finalTradeToKey,
          },
          offeredItem: currentOffer.offeredItem,
          requestedItem: currentOffer.requestedItem,
          message: currentOffer.requestedItem
            ? `${character.name} aceitou trocar ${currentOffer.offeredItem?.qty || 1}x ${currentOffer.offeredItem?.name || 'item'} por ${currentOffer.requestedItem.qty}x ${currentOffer.requestedItem.name}.`
            : `${character.name} aceitou entregar ${currentOffer.offeredItem?.qty || 1}x ${currentOffer.offeredItem?.name || 'item'} sem contraoferta.`,
          createdAt: new Date().toISOString(),
        };

        const sent = await sendLanEventWithRetry(finalAcceptEvent, 'tradeAccept');
        setIncomingTrades((current) => current.filter((event) => (event.tradeId || event.id) !== tradeKey));
        setSelectedTradeOffer(null);
        setTradeCounterItem(null);
        showCustomAlert(sent ? 'Troca aceita' : 'Troca em fila', sent
          ? 'A troca foi enviada para execucao automatica.'
          : 'A confirmacao sera reenviada automaticamente quando reconectar.');
      } catch {
        showCustomAlert('Troca falhou', 'Nao consegui confirmar a troca na sessao LAN. O inventario local nao foi alterado.');
      }
    });
  };

  const handleDeclineTrade = async (event: LanSessionEvent) => {
    await runSheetAction(`trade_decline:${event.id}`, async () => {
      if (!ensureLanWritable()) return;
      if (!lanInfo || !character) return;
      try {
        const responseId = makeLanEventId();
        const selfKey = getSelfLanKey(lanInfo.sessionId);
        const tradeKey = event.tradeId || event.id;
        const declineEvent: LanSessionEvent = {
          id: responseId,
          clientMsgId: responseId,
          sessionId: lanInfo.sessionId,
          type: 'trade_decline',
          fromKey: selfKey,
          fromName: character.name,
          toKey: event.fromKey,
          toName: event.fromName,
          entityType: 'inventory',
          entityId: tradeKey,
          ackRequired: true,
          tradeId: tradeKey,
          offeredItem: event.offeredItem,
          requestedItem: event.requestedItem,
          tradeAccept: {
            tradeId: tradeKey,
            fromKey: event.tradeAccept?.fromKey || event.fromKey,
            toKey: event.tradeAccept?.toKey || selfKey,
          },
          message: `${character.name} recusou a troca.`,
          createdAt: new Date().toISOString(),
        };
        await sendLanEventWithRetry(declineEvent, 'tradeDecline');
        setIncomingTrades((current) => current.filter((entry) => (entry.tradeId || entry.id) !== tradeKey));
        if ((selectedTradeOffer?.tradeId || selectedTradeOffer?.id) === tradeKey) setSelectedTradeOffer(null);
      } catch {
        showCustomAlert('Resposta falhou', 'Nao consegui recusar a troca na sessao LAN.');
      }
    });
  };

  const notifyOwnLanStatus = async (hpCurrent: number, hpMax: number) => {
    if (!lanInfo?.sessionId || !character) return;
    try {
      const eventId = makeLanEventId();
      await sendLanEventWithRetry({
        id: eventId,
        clientMsgId: eventId,
        sessionId: lanInfo.sessionId,
        type: 'public_status',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: 'session',
        toName: 'session',
        ackRequired: false,
        publicState: {
          hpCurrent,
          hpMax,
          tempHp: Math.max(0, Math.floor(Number((characterRef.current as any)?.temp_hp ?? character.temp_hp ?? 0) || 0)),
          level: character.level,
        },
        createdAt: new Date().toISOString(),
      }, 'notifyOwnLanStatus');
    } catch {
      // A mudanca local de HP continua valida mesmo se a mesa estiver temporariamente offline.
    }
  };

  const notifySelfLanSpellEvent = async (spellEffect: NonNullable<LanSessionEvent['spellEffect']>) => {
    if (!lanInfo?.sessionId || !character) return;
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    if (!selfKey) return;

    try {
      const eventId = makeLanEventId();
      const event: LanSessionEvent = {
        id: eventId,
        clientMsgId: eventId,
        sessionId: lanInfo.sessionId,
        type: spellEffect.mode === 'effect' ? 'spell_effect' : 'spell_hp',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: spellEffect.mode === 'effect' ? 'effect' : 'player',
        entityId: selfKey,
        ackRequired: true,
        spellEffect,
        createdAt: new Date().toISOString(),
      };
      await sendLanEventWithRetry(event, 'notifySelfLanSpellEvent');
    } catch {
      // O item ja foi aplicado localmente; o proximo snapshot oficial corrige caso o host nao receba.
    }
  };

  const getSpellCastMode = (spell: any): 'heal' | 'damage' | 'effect' => {
    const text = `${spell.damage_dice || ''} ${spell.damage || ''} ${spell.damage_type || ''} ${spell.description || ''}`.toLowerCase();
    if ((text.includes('tempor') || text.includes('temp')) && (text.includes('pv') || text.includes('hp') || text.includes('vida'))) return 'effect';
    if (text.includes('cura') || text.includes('curar') || text.includes('recupera')) return 'heal';
    if ((spell.damage_dice && spell.damage_dice !== '-') || (spell.damage && spell.damage !== '-')) return 'damage';
    return 'effect';
  };

  const getSpellDiceText = (spell: any) => {
    const raw = String(spell.damage_dice || spell.damage || '');
    if (!raw || raw === '-') return '';
    return raw.replace(/cura/gi, '').trim();
  };

  const startSpellCast = (spell: any) => {
    const selfKey = lanInfo ? getSelfLanKey(lanInfo.sessionId) : '';
    const defaultKeys = selfKey ? [selfKey] : [];
    setSpellTargetKeys(defaultKeys);
    setSpellTargetAmounts(defaultKeys.reduce((acc, key) => ({ ...acc, [key]: '' }), {}));
    setSpellTargetAttackRolls(defaultKeys.reduce((acc, key) => ({ ...acc, [key]: '' }), {}));
    setSpellRollResult('');
    setSpellAttackRollResult('');
    setSpellRollMode('manual');
    setSpellAttackRollMode('manual');
    setSpellDicePurpose('damage');
    setSpellEffectTarget('custom');
    setSpellEffectValue('0');
    setSpellCastVisible(true);
  };

  const toggleSpellTarget = (key: string) => {
    setSpellTargetKeys((current) => {
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
      setSpellTargetAmounts((amounts) => {
        const copy = { ...amounts };
        if (!copy[key]) copy[key] = '';
        return copy;
      });
      setSpellTargetAttackRolls((rolls) => {
        const copy = { ...rolls };
        if (!copy[key]) copy[key] = '';
        return copy;
      });
      return next;
    });
  };

  const completeDiceValuePrompt = (result: DiceValueResolution | null) => {
    const resolver = pendingDiceValueResolverRef.current;
    pendingDiceValueResolverRef.current = null;
    pendingVisualDiceValueRef.current = null;
    setDiceValuePrompt((current) => ({ ...current, visible: false, manualValue: '' }));
    resolver?.(result);
  };

  const requestDiceValueForUse = (title: string, formula: string, qty = 1) => {
    const parsed = parseUsableDiceFormula(formula, qty);
    if (!parsed) return Promise.resolve<DiceValueResolution | null>(null);

    return new Promise<DiceValueResolution | null>((resolve) => {
      pendingDiceValueResolverRef.current = resolve;
      setDiceValuePrompt({
        visible: true,
        title,
        message: `Informe o valor final de ${parsed.formula} ou use o dado virtual.`,
        formula,
        qty,
        manualValue: '',
      });
    });
  };

  const rollDiceValuePromptVirtually = () => {
    const resolver = pendingDiceValueResolverRef.current;
    if (!resolver) return;

    const parsed = parseUsableDiceFormula(diceValuePrompt.formula, diceValuePrompt.qty);
    if (!parsed) {
      completeDiceValuePrompt(null);
      return;
    }

    setDiceValuePrompt((current) => ({ ...current, visible: false }));
    if (canUseVisualDiceRoll(parsed)) {
      pendingVisualDiceValueRef.current = { parsed, resolve: resolver };
      setDiceRollRequest({ sides: parsed.sides, count: parsed.count, nonce: Date.now() });
      return;
    }

    const rolled = rollParsedDiceFormula(parsed);
    completeDiceValuePrompt({
      total: rolled.total,
      mode: 'virtual',
      formula: parsed.formula,
      breakdown: rolled.breakdown,
    });
  };

  const submitManualDiceValuePrompt = () => {
    const value = Math.max(0, Math.floor(Number(diceValuePrompt.manualValue) || 0));
    if (value <= 0) return;
    const parsed = parseUsableDiceFormula(diceValuePrompt.formula, diceValuePrompt.qty);
    completeDiceValuePrompt({
      total: value,
      mode: 'manual',
      formula: parsed?.formula || diceValuePrompt.formula,
      breakdown: String(value),
    });
  };

  const rollSpellForTargets = () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell) return;
    const diceParts = getDiceParts(getSpellDiceText(selectedSpell));
    if (diceParts[0]) {
      setSpellDicePurpose('damage');
      setSpellRollResult('Rolando...');
      setDiceRollRequest({ ...diceParts[0], nonce: Date.now() });
      return;
    }
    showCustomAlert('Rolagem indisponivel', 'Nao encontrei uma formula de dado nesta magia. Informe o valor manualmente.');
  };

  const handleSpellDiceComplete = (result: DiceRollResult) => {
    const pendingDiceValue = pendingVisualDiceValueRef.current;
    if (pendingDiceValue) {
      const total = Math.max(0, result.total + pendingDiceValue.parsed.modifier);
      completeDiceValuePrompt({
        total,
        mode: 'virtual',
        formula: pendingDiceValue.parsed.formula,
        breakdown: formatDiceRollBreakdown((result.rolls || []).join('+'), pendingDiceValue.parsed.modifier),
      });
      return;
    }

    if (!selectedSpell || !spellCastVisible) return;
    if (spellDicePurpose === 'attack') {
      const attackModifier = getSpellAttackModifier(selectedSpell);
      const attackTotal = result.total + attackModifier;
      const modifierText = formatSignedModifier(attackModifier);
      setSpellAttackRollMode('virtual');
      setSpellAttackRollResult(`${attackTotal} (${result.breakdown} ${modifierText})`);
      setSpellTargetAttackRolls((current) => {
        const next = { ...current };
        for (const key of spellTargetKeys) next[key] = String(result.total);
        return next;
      });
      return;
    }
    setSpellRollMode('virtual');
    setSpellRollResult(`${result.total} (${result.breakdown})`);
    setSpellTargetAmounts((current) => {
      const next = { ...current };
      for (const key of spellTargetKeys) next[key] = String(result.total);
      return next;
    });
  };

  const getSpellSaveConfig = (spell: any) => {
    const effects = parseStructuredEffects(spell?.effect_json);
    const effectSave = effects.map((effect) => effect?.save).find((save) => save?.ability);
    const rawSavingThrow = String(spell?.saving_throw || '').trim();
    const rawAbility = String(effectSave?.ability || rawSavingThrow.match(/\b(FOR|DES|CON|INT|SAB|CAR)\b/i)?.[1] || '').toUpperCase();
    const dc = Number(effectSave?.dc ?? rawSavingThrow.match(/\bCD\s*(\d+)/i)?.[1] ?? 0);
    if (!rawAbility || rawAbility === 'NENHUM' || rawAbility === 'NONE') return null;
    return {
      enabled: true,
      saveAbility: rawAbility,
      dc: dc > 0 ? dc : 8 + profBonusChar + Math.max(forMod, desMod, conModTotal),
      saveOnSuccess: String(effectSave?.onSuccess || effectSave?.saveOnSuccess || 'negates'),
      saveOnFailure: 'apply_full',
      rollMode: 'target_choice' as const,
    };
  };

  const getSpellAttackModifier = (spell: any) => {
    const spellText = `${spell?.name || ''} ${spell?.range || ''} ${spell?.casting_time || ''} ${spell?.description || ''}`.toLowerCase();
    const usesWeapon = spellText.includes('arma') || String(spell?.range || '').toLowerCase().includes('arma');
    const abilityMod = usesWeapon
      ? Math.max(getAbilityModifierForAbility('FOR'), getAbilityModifierForAbility('DES'))
      : Math.max(getAbilityModifierForAbility('INT'), getAbilityModifierForAbility('SAB'), getAbilityModifierForAbility('CAR'));
    return abilityMod + profBonusChar;
  };

  const isSpellAttackRollRequired = (spell: any) => {
    if (!spell || getSpellCastMode(spell) !== 'damage' || getSpellSaveConfig(spell)) return false;
    const raw = `${spell.name || ''} ${spell.range || ''} ${spell.casting_time || ''} ${spell.description || ''}`.toLowerCase();
    return (
      /ataque m[aá]gico/.test(raw) ||
      /ataque de magia/.test(raw) ||
      String(spell.range || '').toLowerCase().includes('arma') ||
      String(spell.name || '').toLowerCase().startsWith('ataque ')
    );
  };

  const rollSpellAttackForTargets = () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell) return;
    setSpellDicePurpose('attack');
    setSpellAttackRollResult('Rolando...');
    setDiceRollRequest({ sides: 20, count: 1, nonce: Date.now() });
  };

  const sendSpellEventToTarget = async (target: PublicLanPlayer, amount: number) => {
    if (!lanInfo || !character || !selectedSpell) return;
    const mode = getSpellCastMode(selectedSpell);
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const requiresAttack = isSpellAttackRollRequired(selectedSpell);
    const attackRoll = requiresAttack ? Math.max(0, parseInt(spellTargetAttackRolls[target.key] || '', 10) || 0) : undefined;
    const attackModifier = requiresAttack ? getSpellAttackModifier(selectedSpell) : undefined;
    const attackTotal = attackRoll != null && attackModifier != null ? attackRoll + attackModifier : undefined;
    const spellEffect: NonNullable<LanSessionEvent['spellEffect']> = mode === 'effect'
      ? {
        spellName: selectedSpell.name,
        mode,
        target: spellEffectTarget,
        value: parseInt(spellEffectValue) || 0,
        durationText: selectedSpell.duration || 'Instantanea',
        ...parseSpellDuration(selectedSpell.duration),
        description: selectedSpell.description,
      }
      : {
        spellName: selectedSpell.name,
        mode,
        amount: mode === 'heal' ? Math.abs(amount) : -Math.abs(amount),
        description: selectedSpell.description,
      };
    const actionId = makeLanEventId();
    const event: LanSessionEvent = {
      id: actionId,
      clientMsgId: actionId,
      sessionId: lanInfo.sessionId,
      type: 'spell_cast_request',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'action',
      entityId: actionId,
      ackRequired: true,
      actionRequest: {
        actionId,
        actionName: selectedSpell.name,
        actionKind: requiresAttack ? 'attack' : mode,
        sourceType: 'spell',
        targetKind: target.isSelf ? 'self' : 'player',
        targetKey: target.key,
        targetName: target.characterName,
        rollMode: spellRollMode,
        declaredValue: amount,
        rolls: [{
          rollMode: spellRollMode,
          formula: getSpellDiceText(selectedSpell) || undefined,
          dice: getSpellDiceText(selectedSpell) || undefined,
          manualValue: spellRollMode === 'manual' ? amount : undefined,
          rawRoll: spellRollMode === 'virtual' ? amount : undefined,
          total: amount,
          rollId: actionId,
          timestamp: new Date().toISOString(),
        }],
        spellEffect,
        save: getSpellSaveConfig(selectedSpell) || undefined,
        attack: requiresAttack ? {
          attackRoll,
          attackModifier,
          attackTotal,
          rollMode: spellAttackRollMode,
        } : undefined,
        createdAt: new Date().toISOString(),
      },
      spellEffect,
      message: `${character.name} pediu para usar ${selectedSpell.name} em ${target.characterName}.`,
      createdAt: new Date().toISOString(),
    };

    await sendLanEventWithRetry(event, 'sendSpellTargetRequest');
  };

  const resolveStructuredItemDiceValues = async (item: any, qty: number, effects: any[]) => {
    const resolutions: Record<string, DiceValueResolution> = {};

    for (const [index, effect] of effects.entries()) {
      const formula = getStructuredEffectDiceFormulaForUse(effect);
      if (!formula) continue;
      const promptQty = effect?.mode === 'set' ? 1 : qty;
      const result = await requestDiceValueForUse(`Usar ${item.name}`, formula, promptQty);
      if (!result) return null;
      resolutions[getStructuredEffectDiceKey(index, effect)] = result;
    }

    return resolutions;
  };

  const getSheetItemInstanceId = (item: any) => String(
    item?.inventoryItemId ||
    item?.inventory_item_id ||
    item?.itemId ||
    item?.item_id ||
    item?.id ||
    getInventoryStackKey(item)
  );

  const consumeLanItemWithEngine = async (item: any, qty: number) => {
    if (!activeLanSessionId || !activeLanPlayerKey || !characterRef.current) return false;
    const hydrated = hydrateInventoryItemForEffects(item);
    const commandId = `player_consume:${activeLanPlayerKey}:${getSheetItemInstanceId(hydrated)}:${Date.now()}`;
    try {
      const applied = await dispatchSheetLanPlayerCommand({
        type: 'consume_item',
        commandId,
        sessionId: activeLanSessionId,
        actorKey: activeLanPlayerKey,
        targetKey: activeLanPlayerKey,
        itemInstanceId: getSheetItemInstanceId(hydrated),
        qty,
      }, `consume:${hydrated.name || 'item'}`);
      if (applied) {
        showCustomAlert('Item usado', `${hydrated.name || 'Item'} foi usado pela engine LAN.`);
      }
      return applied;
    } catch (error) {
      showCustomAlert('Consumo bloqueado', error instanceof Error ? error.message : 'Nao foi possivel consumir este item.');
      return false;
    }
  };

  const confirmAndApplyStructuredItemEffects = async (
    bagIndex: number,
    item: any,
    qty: number,
    effects: any[],
    chosenAttr?: string,
  ) => {
    if (isLanMode) {
      await consumeLanItemWithEngine(item, qty);
      return;
    }
    const diceResolutions = await resolveStructuredItemDiceValues(item, qty, effects);
    if (diceResolutions === null) return;
    await applyStructuredItemEffects(bagIndex, item, qty, effects, chosenAttr, diceResolutions);
  };

  /** @deprecated No modo LAN, consumo estruturado sai antes via consume_item na engine. */
  const applyStructuredItemEffects = async (
    bagIndex: number,
    rawItem: any,
    qty: number,
    effects: any[],
    chosenAttr?: string,
    diceResolutions: Record<string, DiceValueResolution> = {},
  ) => {
    const item = hydrateInventoryItemForEffects(rawItem);
    if (isLanMode) {
      await consumeLanItemWithEngine(item, qty);
      return;
    }

    // v54: consumir/usar item próprio é ação autônoma do jogador.
    // Não vira item_use_request nem pede permissão do mestre; só envia patches vivos
    // de inventário/atributo/efeito para o host validar que a quantidade não aumentou.
    let consumeTx: ReturnType<typeof consumeLanInventoryItemAtomically>;
    try {
      consumeTx = consumeLanInventoryItemAtomically({
        equipment: character.equipment,
        bagIndex,
        qty,
      });
    } catch (error) {
      showCustomAlert('Consumo bloqueado', error instanceof Error ? error.message : 'Nao foi possivel consumir este item.');
      return;
    }
    const equipmentBeforeConsume = consumeTx.equipmentBefore;
    const equipmentAfterConsume = consumeTx.equipmentAfter;

    const nextStats = { ...character.stats, temp_mods: { ...(character.stats?.temp_mods || {}) } };
    const dbUpdates: any = {};
    const numberPatch: NonNullable<LanSessionEvent['numberPatch']> = {};
    const messages: string[] = [];
    let nextActiveEffects = Array.isArray(character.active_effects) ? [...character.active_effects] : [];
    const lanEffectsToNotify: any[] = [];

    const pushLocalEffect = (effectInput: any) => {
      const effect = {
        ...effectInput,
        id: effectInput.id || `pending_item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        source: effectInput.source || item.name,
        sourceType: 'item',
        sourceId: String(item.id || item.name || ''),
        visibleToPlayer: true,
      };

      nextActiveEffects.push(effect);
      lanEffectsToNotify.push(effect);
    };

    for (const [effectIndex, effect] of effects.entries()) {
      const kind = String(effect.kind || effect.type || '').toLowerCase();
      const needsChosenStat = Boolean(effect.chooseStat) || String(effect.target || '').toUpperCase() === 'CHOOSE_STAT' || String(effect.effectType || '') === 'Escolher Atributo';
      const target = String(needsChosenStat ? chosenAttr : effect.target || '').toUpperCase();
      const diceResolution = diceResolutions[getStructuredEffectDiceKey(effectIndex, effect)];
      const rawValue = Number(effect.value ?? effect.amount ?? 0);
      const value = diceResolution ? diceResolution.total : (Number.isFinite(rawValue) ? rawValue : 0);
      const valueIncludesQty = Boolean(diceResolution);
      const valueDetail = diceResolution
        ? ` (${diceResolution.mode === 'virtual' ? 'dado virtual' : 'manual'}${diceResolution.breakdown ? `: ${diceResolution.breakdown}` : ''})`
        : '';
      const dice = effect.healDice || effect.damageDice || effect.dice || '';
      const duration = getItemEffectDuration(item, effect);
      const isPermanent = duration.unit === 'permanent' || String(effect.durationText || '').toLowerCase().includes('permanente');

      if (needsChosenStat && !target) continue;

      if (['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(target) && value) {
        const totalValue = effect.mode === 'set' || valueIncludesQty ? value : value * qty;

        if (effect.mode === 'set') {
          const base = Number(nextStats[target] || 10);
          nextStats.temp_mods[target] = value - base;
          messages.push(`${target} definido como ${value}${valueDetail}.`);
        } else if (isPermanent && target !== 'CA') {
          // Offline mantém o bônus permanente na própria ficha. Em LAN também aplica otimista localmente,
          // mas envia effect_patch para o Host registrar a versão autoritativa sem payload/snapshot.
          nextStats[target] = String((Number(nextStats[target]) || 10) + totalValue);
          nextStats.extra_points = (Number(nextStats.extra_points) || 0) + totalValue;
          messages.push(`${target} ${totalValue > 0 ? '+' : ''}${totalValue} permanente${valueDetail}.`);
        } else {
          // v55: efeito temporario/CA de consumivel fica apenas em active_effects.
          // Antes gravava tambem em temp_mods; a ficha soma temp_mods + active_effects
          // e por isso o bonus aparecia/aplicava 2x no jogador e no mestre.
          messages.push(`${target} ${totalValue > 0 ? '+' : ''}${totalValue}${isPermanent ? ' permanente' : ''}${valueDetail}.`);
        }

        if (!isPermanent || target === 'CA') {
          pushLocalEffect({
            name: `${item.name}: ${target} ${totalValue > 0 ? '+' : ''}${totalValue}`,
            status: 'item_effect',
            statusKey: 'item_effect',
            target: normalizeLanEffectTarget(target),
            value: totalValue,
            remaining: duration.remaining,
            unit: duration.unit,
            durationText: duration.text,
            kind: target === 'CA' ? 'stat' : 'stat',
            mode: effect.mode === 'set' ? 'set' : 'add',
            color: '#00bfff',
            secondaryColor: '#8be9fd',
            visualPriority: 50,
          });
        }
      }

      if ((kind === 'temp_hp' || target === 'PV_TEMP') && value) {
        const totalValue = valueIncludesQty ? value : value * qty;
        const nextTempHp = Math.max(Number(character.temp_hp || 0), totalValue);
        dbUpdates.temp_hp = nextTempHp;
        numberPatch.tempHp = nextTempHp;
        messages.push(`PV temporario +${totalValue}${valueDetail}.`);
        pushLocalEffect({
          name: `${item.name}: PV temporario +${totalValue}`,
          status: 'item_effect',
          statusKey: 'item_effect',
          target: 'PV_TEMP',
          value: totalValue,
          remaining: duration.remaining,
          unit: duration.unit,
          durationText: duration.text,
          kind: 'temp_hp',
          color: '#00bfff',
          secondaryColor: '#8be9fd',
          visualPriority: 50,
        });
      }

      if (kind === 'heal') {
        const fixedHeal = diceResolution
          ? diceResolution.total
          : Number(value || String(dice).match(/^\d+$/)?.[0] || 0) * qty;
        if (fixedHeal > 0) {
          const nextHp = Math.min(Number(character.hp_max || 0), Number(character.hp_current || 0) + fixedHeal);
          dbUpdates.hp_current = nextHp;
          numberPatch.hpCurrent = nextHp;
          messages.push(`Recuperou ${fixedHeal} PV${valueDetail}.`);
        } else if (dice) {
          messages.push(`Role a cura: ${qty}x ${dice}.`);
        }
      }

      const condition = effect.condition;
      if (condition?.key && condition.key !== 'none') {
        if (effect.save?.ability && condition.applyOn === 'failed_save') {
          messages.push(`Teste ${effect.save.ability}${effect.save.dc ? ` CD ${effect.save.dc}` : ''}; se falhar aplica ${condition.name || 'condicao'}.`);
          continue;
        }

        const conditionDuration = condition.duration || {};
        const remaining = Math.max(1, Number(conditionDuration.value || effect.durationValue || 1));
        const unit = normalizeLanEffectUnit(conditionDuration.unit || effect.durationUnit || 'rest');
        pushLocalEffect({
          name: condition.name || item.name,
          status: condition.key,
          statusKey: condition.key,
          target: target && target !== 'UNDEFINED' ? normalizeLanEffectTarget(target) : 'custom',
          value,
          remaining,
          unit,
          durationText: effect.durationText || conditionDuration.text || item.duration_unit || '',
          kind: 'condition',
          color: condition.color,
          secondaryColor: condition.secondaryColor,
          visualPriority: 80,
        });
        messages.push(`${condition.name || 'Condicao'} aplicada.`);
      }
    }

    const previousBaseConForConsume = Math.floor(Number(character.stats?.CON || 10)) || 10;
    const nextBaseConForConsume = Math.floor(Number(nextStats?.CON || previousBaseConForConsume)) || previousBaseConForConsume;
    const consumeConHpDelta = (Math.floor((nextBaseConForConsume - 10) / 2) - Math.floor((previousBaseConForConsume - 10) / 2)) * Math.max(1, Number(character.level || 1));
    if (consumeConHpDelta) {
      dbUpdates.hp_max = Math.max(1, Number(character.hp_max || 0) + consumeConHpDelta);
      dbUpdates.hp_current = Math.max(0, Number(character.hp_current || 0) + consumeConHpDelta);
      numberPatch.hpMax = dbUpdates.hp_max;
      numberPatch.hpCurrent = dbUpdates.hp_current;
    }

    dbUpdates.equipment = equipmentAfterConsume;
    dbUpdates.stats = nextStats;
    if (nextActiveEffects.length !== (Array.isArray(character.active_effects) ? character.active_effects.length : 0)) {
      dbUpdates.active_effects_json = nextActiveEffects;
    }

    // v86: consumo precisa ser visualmente imediato. O SQLite e o envio LAN ficam
    // depois; se o host devolver correção, o inventory_patch/payload autoritativo reconcilia.
    setCharacter((prev: any) => {
      if (!prev) return prev;
      const merged = {
        ...prev,
        ...dbUpdates,
        equipment: equipmentAfterConsume,
        stats: nextStats,
        active_effects: nextActiveEffects,
      };
      characterRef.current = merged;
      return merged;
    });
    void updateDB(dbUpdates, {
      reason: isLanPlayerRuntime ? 'lan_item_consume_runtime_first_async' : 'offline_item_consume',
      allowLanAuthoritativeCache: isLanPlayerRuntime,
    }).catch((error) => {
      debugLanFlow('PLAYER_ITEM_CONSUME_PERSIST_ASYNC_FAILED', {
        itemName: item.name,
        characterId: character.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    if (isLanPlayerRuntime && lanInfo?.sessionId) {
      const clientRequestId = makeLanEventId();
      pendingSelfInventoryStateRef.current = { equipment: equipmentAfterConsume, statsPatch: nextStats, at: Date.now(), clientMsgId: clientRequestId };
      void notifyInventoryPatch(
        equipmentAfterConsume,
        `${character.name} consumiu ${qty}x ${item.name}.`,
        clientRequestId,
        nextStats,
        equipmentBeforeConsume
      );
      if (Object.keys(numberPatch).length > 0) {
        void notifyNumberPatch(numberPatch, `${character.name} atualizou PV por ${item.name}.`);
      }
      const liveEffects = lanEffectsToNotify.filter((effect: any) => !effect?.isPermanent && effect?.unit !== 'permanent');
      if (liveEffects.length > 0) {
        void notifyEffectPatch(liveEffects, `${character.name} aplicou efeito de ${item.name}.`);
      }
    }

    showCustomAlert('Efeito aplicado', messages.length ? messages.join('\n') : `${item.name} foi usado.`);
  };

  const applySpellCast = async () => {
    await runSheetAction(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell || !lanInfo) return;
    const targets = lanPlayers.filter((player) => spellTargetKeys.includes(player.key));
    if (targets.length === 0) {
      showCustomAlert('Sem alvo', 'Escolha pelo menos um personagem da party.');
      return;
    }

    try {
      let sentCount = 0;
      const requiresAttack = isSpellAttackRollRequired(selectedSpell);
      for (const target of targets) {
        const value = parseInt(spellTargetAmounts[target.key]) || 0;
        if (getSpellCastMode(selectedSpell) !== 'effect' && value <= 0) continue;
        if (requiresAttack && (parseInt(spellTargetAttackRolls[target.key] || '', 10) || 0) <= 0) {
          showCustomAlert('Ataque pendente', `Informe ou role o d20 de ataque para ${target.characterName}.`);
          return;
        }
        await sendSpellEventToTarget(target, value);
        sentCount += 1;
      }
      if (sentCount === 0) {
        showCustomAlert('Nada para enviar', 'Informe pelo menos um valor valido para os alvos escolhidos.');
        return;
      }
      setSpellCastVisible(false);
      showCustomAlert('Magia aplicada', `${selectedSpell.name} foi enviada para ${sentCount} alvo(s).`);
    } catch {
      showCustomAlert('Magia falhou', 'Nao consegui sincronizar a magia na sessao LAN.');
    }
    });
  };

  /** @deprecated No modo LAN, este handler apenas confirma e despacha consume_item. */
  const processConsumeItem = (bagIndex: number, item: any, qty: number) => {
    if (!ensureLanWritable()) return;

    // Itens antigos na mochila podem estar sem effect_json/damage/duration.
    // Antes de consumir, reidrata pelo catálogo sem perder metadados customizados já existentes.
    item = hydrateInventoryItemForEffects(item);

    if (isLanMode) {
      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        'Confirmar uso deste item na sessao LAN?',
        [
          { text: 'Cancelar', color: '#666' },
          {
            text: 'Usar',
            color: '#00fa9a',
            onPress: () => void consumeLanItemWithEngine(item, qty),
          },
        ]
      );
      return;
    }

    const structuredEffects = parseStructuredEffects(item.effect_json);
    if (structuredEffects.length > 0) {
      const chooseEffect = structuredEffects.find((effect) => (
        Boolean(effect.chooseStat) ||
        String(effect.target || '').toUpperCase() === 'CHOOSE_STAT' ||
        String(effect.effectType || '') === 'Escolher Atributo'
      ));

      if (chooseEffect) {
        const value = Number(chooseEffect.value || 0);
        const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
          text: attr,
          color: value >= 0 ? '#00fa9a' : '#ff6666',
          onPress: () => void confirmAndApplyStructuredItemEffects(bagIndex, item, qty, structuredEffects, attr),
        }));

        showCustomAlert(
          `Consumir ${qty}x ${item.name}`,
          'Este item afeta um atributo de sua escolha. Qual atributo deseja alterar?',
          [
            { text: 'Cancelar', color: '#666' },
            ...attrButtons,
          ]
        );
        return;
      }

      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        'Confirmar uso deste item?',
        [
          { text: 'Cancelar', color: '#666' },
          {
            text: 'Usar',
            color: '#00fa9a',
            onPress: () => void confirmAndApplyStructuredItemEffects(bagIndex, item, qty, structuredEffects),
          },
        ]
      );
      return;
    }

    const effect = item.damage && item.damage !== '-' ? item.damage : '';

    if (!effect) {
      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        'Este item nao possui efeito estruturado salvo nem efeito textual reconhecivel. Reabra o item no criador avancado e salve o efeito novamente.',
        [{ text: 'OK', color: appColors.primary }]
      );
      return;
    }
    
    // Parse da tag "Escolher"
    const hasEscolher = effect.toLowerCase().includes('escolher');
    let escolherVal = 0;
    let escolherIsPerm = false;
    
    if (hasEscolher) {
      const escolherMatch = effect.match(/escolher\s*([+-]?\d+)/i);
      escolherVal = escolherMatch ? parseInt(escolherMatch[1]) : 1;
      escolherIsPerm = effect.toLowerCase().includes('perm');
    }

    // Função interna que processa TUDO: O status escolhido (se tiver), as penalidades e curas.
    const executeConsumption = async (chosenAttr?: string) => {
      const lowerEffectText = effect.toLowerCase();
      const textHasHealingDice = Boolean(
        parseUsableDiceFormula(effect, qty) &&
        (lowerEffectText.includes('cura') || lowerEffectText.includes('hp') || (item.damage_type || '').toLowerCase().includes('cura'))
      );
      const textDiceResolution = textHasHealingDice
        ? await requestDiceValueForUse(`Consumir ${qty}x ${item.name}`, effect, qty)
        : null;
      if (textHasHealingDice && !textDiceResolution) return;

      let consumeTx: ReturnType<typeof consumeLanInventoryItemAtomically>;
      try {
        consumeTx = consumeLanInventoryItemAtomically({
          equipment: character.equipment,
          bagIndex,
          qty,
        });
      } catch (error) {
        showCustomAlert('Consumo bloqueado', error instanceof Error ? error.message : 'Nao foi possivel consumir este item.');
        return;
      }
      const equipmentBeforeConsume = consumeTx.equipmentBefore;
      const equipmentAfterConsume = consumeTx.equipmentAfter;

      let newStats = { ...character.stats };
      let msgParts = [];
      let showHpModal = false;
      let dbUpdates: any = {};
      const lanEffects: NonNullable<LanSessionEvent['spellEffect']>[] = [];
      const duration = getItemEffectDuration(item, {});

      // 1. Aplica o Atributo Escolhido (caso exista)
      if (chosenAttr) {
        const totalVal = escolherVal * qty;
        if (escolherIsPerm) {
          newStats[chosenAttr] = String((parseInt(newStats[chosenAttr]) || 10) + totalVal);
          newStats.extra_points = (parseInt(newStats.extra_points) || 0) + totalVal;
          lanEffects.push({
            spellName: item.name,
            mode: 'effect',
            target: chosenAttr as LanEffectTarget,
            value: totalVal,
            durationText: 'Permanente',
            durationRemaining: 0,
            durationUnit: 'permanent',
            description: item.descricao || item.properties || '',
          });
          msgParts.push(`✨ Escolha: ${totalVal > 0 ? '+'+totalVal : totalVal} em ${chosenAttr} (Permanente)`);
        } else {
          // v55: no LAN o host devolve effect_patch autoritativo; gravar temp_mods aqui
          // faria o mesmo bonus somar 2x quando o effect_patch chegasse. Offline ainda usa temp_mods.
          if (!isLanPlayerRuntime) {
            if(!newStats.temp_mods) newStats.temp_mods = {};
            newStats.temp_mods[chosenAttr] = (parseInt(newStats.temp_mods[chosenAttr]) || 0) + totalVal;
          }
          lanEffects.push({
            spellName: item.name,
            mode: 'effect',
            target: chosenAttr as LanEffectTarget,
            value: totalVal,
            durationText: duration.text,
            durationRemaining: duration.remaining,
            durationUnit: duration.unit,
            description: item.descricao || item.properties || '',
          });
          msgParts.push(`⏳ Escolha: ${totalVal > 0 ? '+'+totalVal : totalVal} em ${chosenAttr} (Temporário)`);
        }
      }

      // 2. Aplica as outras propriedades fixas na string (ex: CAR -2)
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)\s*(\(?(Perm|Temp).*)?/gi;
      const statMatches = [...effect.matchAll(statRegex)];

      if (statMatches.length > 0) {
        for (const match of statMatches) {
          const attr = match[1].toUpperCase();
          const val = parseInt(match[2].replace('+', '')) * qty;
          const isPerm = match[3] && match[3].toLowerCase().includes('perm');
          
          if (isPerm) {
              if (attr !== 'CA') { 
                  newStats[attr] = String((parseInt(newStats[attr]) || 10) + val);
                  newStats.extra_points = (parseInt(newStats.extra_points) || 0) + val;
              }
              lanEffects.push({
                spellName: item.name,
                mode: 'effect',
                target: attr as LanEffectTarget,
                value: val,
                durationText: 'Permanente',
                durationRemaining: 0,
                durationUnit: 'permanent',
                description: item.descricao || item.properties || '',
              });
              msgParts.push(`💪 Permanente: ${val > 0 ? '+'+val : val} em ${attr}`);
          } else {
              // v55: no LAN o effect_patch autoritativo carrega esse bonus temporario.
              // Offline continua gravando em temp_mods porque nao ha host para reenviar efeito.
              if (!isLanPlayerRuntime) {
                if(!newStats.temp_mods) newStats.temp_mods = {};
                newStats.temp_mods[attr] = (parseInt(newStats.temp_mods[attr]) || 0) + val;
              }
              lanEffects.push({
                spellName: item.name,
                mode: 'effect',
                target: attr as LanEffectTarget,
                value: val,
                durationText: duration.text,
                durationRemaining: duration.remaining,
                durationUnit: duration.unit,
                description: item.descricao || item.properties || '',
              });
              msgParts.push(`⏳ Temporário: ${val > 0 ? '+'+val : val} em ${attr}`);
          }
        }
      }

      // 3. Aplica curas diretas
      const effectStr = lowerEffectText;
      if (effectStr.includes('cura') || effectStr.includes('hp') || (item.damage_type || '').toLowerCase().includes('cura')) {
        const temDado = /d\d+/i.test(effect);
        if (!temDado) {
          const matchFixo = effect.match(/cura\s*([+-]?\d+)/i) || effect.match(/([+-]?\d+)\s*cura/i);
          if (matchFixo) {
            const curaValor = parseInt(matchFixo[1]) * qty;
            if(!isNaN(curaValor)) {
               const novoHp = Math.min(character.hp_max, character.hp_current + Math.abs(curaValor));
               dbUpdates.hp_current = novoHp;
               lanEffects.push({
                 spellName: item.name,
                 mode: 'heal',
                 amount: Math.abs(curaValor),
                 description: item.descricao || item.properties || '',
               });
               msgParts.push(`💖 Recuperou ${Math.abs(curaValor)} Pontos de Vida.`);
            }
          } else {
            const genericNumMatch = effect.match(/\d+/);
            if (genericNumMatch && !chosenAttr && statMatches.length === 0) {
               const curaValor = parseInt(genericNumMatch[0]) * qty;
               const novoHp = Math.min(character.hp_max, character.hp_current + Math.abs(curaValor));
               dbUpdates.hp_current = novoHp;
               lanEffects.push({
                 spellName: item.name,
                 mode: 'heal',
                 amount: Math.abs(curaValor),
                 description: item.descricao || item.properties || '',
               });
               msgParts.push(`💖 Recuperou ${Math.abs(curaValor)} Pontos de Vida.`);
            }
          }
        } else {
          const curaValor = Math.max(0, Number(textDiceResolution?.total || 0));
          if (curaValor > 0) {
            const novoHp = Math.min(character.hp_max, character.hp_current + curaValor);
            dbUpdates.hp_current = novoHp;
            lanEffects.push({
              spellName: item.name,
              mode: 'heal',
              amount: curaValor,
              description: item.descricao || item.properties || '',
            });
            msgParts.push(`Recuperou ${curaValor} Pontos de Vida${textDiceResolution?.breakdown ? ` (${textDiceResolution.breakdown})` : ''}.`);
          } else {
            showHpModal = true;
          msgParts.push(`🎲 Requer Rolagem de Cura:\n${qty}x (${effect})`);
        }
      }
      }

      if (msgParts.length === 0 && !chosenAttr) msgParts.push(`✨ Efeito da ingestão: ${effect}`);

      dbUpdates.stats = newStats;
      dbUpdates.equipment = equipmentAfterConsume;
      setCharacter((current: any) => {
        if (!current) return current;
        const merged = { ...current, ...dbUpdates, equipment: equipmentAfterConsume, stats: newStats };
        characterRef.current = merged;
        return merged;
      });
      if (Object.keys(dbUpdates).length > 0) updateDB(dbUpdates, { allowLanAuthoritativeCache: isLanPlayerRuntime, reason: isLanPlayerRuntime ? 'lan_text_item_consume_runtime_first' : 'offline_text_item_consume' });
      if (isLanPlayerRuntime) {
        const clientRequestId = makeLanEventId();
        pendingSelfInventoryStateRef.current = { equipment: equipmentAfterConsume, statsPatch: newStats, at: Date.now(), clientMsgId: clientRequestId };
        void notifyInventoryPatch(
          equipmentAfterConsume,
          `${character.name} consumiu ${qty}x ${item.name}.`,
          clientRequestId,
          newStats,
          equipmentBeforeConsume
        );
      }
      for (const lanEffect of lanEffects.filter((effect: any) => effect?.durationUnit !== 'permanent')) {
        void notifySelfLanSpellEvent(lanEffect);
      }

      setTimeout(() => {
        showCustomAlert(
          "Efeito Aplicado!", 
          msgParts.join('\n\n'), 
          showHpModal 
            ? [ { text: 'OK', color: '#fff' }, { text: 'Ir para HP', color: '#00fa9a', onPress: () => setHpModalVisible(true) } ] 
            : [{ text: 'OK', color: '#00bfff' }]
        );
      }, 400);
    };

    // Caso possua ESCOLHER, mostramos os botões e passamos o status para executeConsumption.
    if (hasEscolher) {
      const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
        text: attr,
        color: escolherVal > 0 ? '#00fa9a' : '#ff6666',
        onPress: () => void executeConsumption(attr)
      }));

      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        `Este item afeta um atributo de sua escolha. Os outros efeitos (se houver) também serão ativados.\n\nQual atributo deseja alterar?`,
        [
          
          ...attrButtons
        ]
      );
    } 
    else {
      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        `Você tem certeza que deseja ingerir este item? Seus efeitos serão ativados em seu corpo...`,
        [
          { text: "Recusar", color: "#666" },
          { 
            text: "Beber / Comer", 
            color: "#00fa9a",
            onPress: () => void executeConsumption()
          }
        ]
      );
    }
  };

  const processThrowItem = (bagIndex: number, item: any, qty: number) => {
    if (!ensureLanWritable()) return;
    const isThrowableWeapon = item.properties && item.properties.includes('Arremesso');
    
    const itemWeight = parseFloat(item.weight) || 0;
    const totalWeightThrown = itemWeight * qty;
    const weightLimit = forBase * 1.5;

    if (!isThrowableWeapon && totalWeightThrown > weightLimit) {
      showCustomAlert("Muito Pesado!", `Arremessar ${qty}x pesa ${totalWeightThrown}kg. Sua Força (${forBase}) não permite arremessar esse peso todo de uma vez como arma.`);
      return;
    }

    let atkBonus = 0;
    let dmgRoll = '';
    let dmgType = '';
    let rangeText = '';

    if (isThrowableWeapon) {
      const isFinesse = item.properties.includes('Acuidade');
      const activeMod = isFinesse ? Math.max(forMod, desMod) : forMod;
      atkBonus = activeMod + profBonusChar;
      dmgRoll = `${item.damage || '1d4'} ${activeMod !== 0 ? (activeMod > 0 ? `+${activeMod}` : activeMod) : ''}`;
      dmgType = item.damage_type || 'Arma';
      rangeText = 'Alcance da Arma (Ex: 6/18m)';
    } else {
      atkBonus = forMod; 
      dmgRoll = `1d4 ${forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}`;
      dmgType = 'Concussão (Improvisada)';
      rangeText = 'Alcance Curto: 6m / Longo: 18m';
    }

    showCustomAlert(
      `Arremessar: ${qty}x ${item.name}`,
      `📍 ${rangeText}\n🎯 Acerto (D20): ${atkBonus >= 0 ? `+${atkBonus}` : atkBonus}\n⚔️ Dano (cada): ${dmgRoll} [${dmgType}]\n\n⚠️ Você fará ${qty} ataque(s) separado(s). O(s) item(ns) será(ão) consumido(s).`,
      [
        { text: "Cancelar", color: "#666" },
        { 
          text: "Arremessar!", 
          color: "#ff6666",
          onPress: () => {
            updateBagQty(bagIndex, -qty);
            setTimeout(() => showCustomAlert("Fóooosh!", `Você atirou ${qty}x ${item.name} com sucesso. Role seus dados de Acerto e Dano!`), 400);
          }
        }
      ]
    );
  };

  const getEquipBonus = (item: any) => {
    if (!item) return {};
    const bonuses: Record<string, number> = {};

    const addBonus = (attrRaw: unknown, rawValue: unknown) => {
      const attr = String(attrRaw || '').toUpperCase();
      if (!['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(attr)) return;
      const value = Number(rawValue || 0);
      if (!Number.isFinite(value) || value === 0) return;
      bonuses[attr] = (bonuses[attr] || 0) + value;
    };

    // Itens criados no modo avançado salvam os bônus dentro de effect_json.
    // Para item EQUIPADO, efeitos de atributo/CA viram equip_mods enquanto estiver usando.
    const parsedEffectJson = safeJsonParse<any>(item.effect_json || item.effectJson, null);
    const structuredEffects = Array.isArray(parsedEffectJson?.effects)
      ? parsedEffectJson.effects
      : Array.isArray(parsedEffectJson)
        ? parsedEffectJson
        : [];
    const hasStructuredEquipEffects = structuredEffects.some((effect: any) => {
      const target = String(effect?.target || '').toUpperCase();
      if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) return false;
      const kind = String(effect?.kind || effect?.type || '').toLowerCase();
      return ['stat', 'attribute', 'atributo'].includes(kind) || ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(target);
    });

    // v54: se houver effect_json estruturado, não some novamente o texto
    // "CA 5 + CON 10", porque ele é apenas descrição do mesmo bônus.
    if (!hasStructuredEquipEffects) {
      const effectText = String(item.damage || '');
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)(?!\s*\(?(Perm|Temp))/gi;
      for (const match of effectText.matchAll(statRegex)) {
        if (effectText.toLowerCase().includes('perm') || effectText.toLowerCase().includes('temp')) continue;
        addBonus(match[1], parseInt(match[2].replace('+', ''), 10));
      }
    }

    for (const effect of structuredEffects) {
      const target = String(effect?.target || '').toUpperCase();
      const kind = String(effect?.kind || effect?.type || '').toLowerCase();
      if (!['stat', 'attribute', 'atributo'].includes(kind) && !['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(target)) continue;
      if (target === 'CHOOSE_STAT' || effect?.chooseStat) continue;
      addBonus(target, effect?.value ?? effect?.amount);
    }

    return bonuses;
  };

  /** @deprecated No modo LAN, este handler despacha equip_item/unequip_item antes do caminho local. */
  const handleEquipItem = (itemToEquip: any) => {
    if (!ensureLanWritable()) return;
    if (!activeSlot) return;
    if (isLanMode && activeLanSessionId && activeLanPlayerKey) {
      const slot = String(activeSlot);
      const itemInstanceId = itemToEquip ? getSheetItemInstanceId(itemToEquip) : '';
      void runSheetAction(`engine_equip:${slot}:${itemInstanceId || 'empty'}`, async () => {
        try {
          await dispatchSheetLanPlayerCommand(itemToEquip ? {
            type: 'equip_item',
            commandId: `player_equip:${activeLanPlayerKey}:${slot}:${itemInstanceId}:${Date.now()}`,
            sessionId: activeLanSessionId,
            actorKey: activeLanPlayerKey,
            targetKey: activeLanPlayerKey,
            slot,
            itemInstanceId,
          } : {
            type: 'unequip_item',
            commandId: `player_unequip:${activeLanPlayerKey}:${slot}:${Date.now()}`,
            sessionId: activeLanSessionId,
            actorKey: activeLanPlayerKey,
            targetKey: activeLanPlayerKey,
            slot,
          }, itemToEquip ? `equip:${itemToEquip.name || slot}` : `unequip:${slot}`);
          setSlotModalVisible(false);
        } catch (error) {
          showCustomAlert('Acao Bloqueada', error instanceof Error ? error.message : 'Nao foi possivel atualizar este equipamento.');
        }
      });
      return;
    }
    let equipTx: ReturnType<typeof equipLanInventoryItemAtomically>;
    try {
      equipTx = equipLanInventoryItemAtomically({
        equipment: character.equipment,
        stats: character.stats,
        slot: activeSlot,
        itemToEquip,
      });
    } catch (error) {
      showCustomAlert('Acao Bloqueada', error instanceof Error ? error.message : 'Nao foi possivel atualizar este equipamento.');
      return;
    }
    const nextEquipmentAtomic = equipTx.equipmentAfter;
    const nextStatsAtomic = equipTx.statsAfter;
    if (equipTx.unequippedOffHand) {
      showCustomAlert('Aviso de Sistema', 'Sua mao secundaria foi desequipada. Esta arma requer as duas maos livres.');
    }
    if (lanInfo?.sessionId) {
      const clientRequestId = makeLanEventId();
      pendingSelfInventoryStateRef.current = { equipment: nextEquipmentAtomic, statsPatch: nextStatsAtomic, at: Date.now(), clientMsgId: clientRequestId };
      setCharacter((current: any) => {
        if (!current) return current;
        const merged = { ...current, equipment: nextEquipmentAtomic, stats: nextStatsAtomic };
        characterRef.current = merged;
        return merged;
      });
      void persistFastLocalPatch({ equipment: nextEquipmentAtomic, stats: nextStatsAtomic }, 'lan_player_self_equip_optimistic');
      void runSheetAction(`equip:${activeSlot}`, async () => {
        await notifyInventoryPatch(
          nextEquipmentAtomic,
          `${character.name} atualizou equipamentos equipados.`,
          clientRequestId,
          nextStatsAtomic,
          equipTx.equipmentBefore
        );
      });
    } else {
      void updateDB({ equipment: nextEquipmentAtomic, stats: nextStatsAtomic });
    }
    setSlotModalVisible(false);
    if (false) {
    let newBag = [...character.equipment.bag];
    let newSlots = { ...character.equipment.slots };
    let newStats = { ...character.stats };
    if(!newStats.equip_mods) newStats.equip_mods = {};

    const oldItem = newSlots[activeSlot!];
    if (oldItem) {
      const oldBonuses = getEquipBonus(oldItem);
      for (const [stat, val] of Object.entries(oldBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
        if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
      }
    }

    if (itemToEquip) {
      const props = itemToEquip.properties || '';
      if (activeSlot === 'mainHand' && props.includes('Duas mãos')) {
        if (newSlots.offHand) {
          const offIdx = newBag.findIndex((i: any) => i.name === newSlots.offHand.name);
          if (offIdx > -1) newBag[offIdx].qty += 1;
          else newBag.push({ ...newSlots.offHand, qty: 1 });
          
          const offBonuses = getEquipBonus(newSlots.offHand);
          for (const [stat, val] of Object.entries(offBonuses)) {
            newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
            if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
          }

          newSlots.offHand = null;
          showCustomAlert("Aviso de Sistema", "Sua mão secundária foi desequipada. Esta arma requer as duas mãos livres.");
        }
      }
      if (activeSlot === 'offHand') {
        const mainProps = newSlots.mainHand?.properties || '';
        if (mainProps.includes('Duas mãos')) {
          showCustomAlert("Ação Bloqueada", "Sua arma principal ocupa as duas mãos. Desequipe-a primeiro se quiser usar outra coisa.");
          return;
        }
      }
    }

    if (oldItem) {
      const existingIdx = newBag.findIndex((i: any) => i.name === oldItem.name);
      if (existingIdx > -1) newBag[existingIdx].qty += 1;
      else newBag.push({ ...oldItem, qty: 1 });
    }

    if (itemToEquip) {
      const bagIdx = newBag.findIndex((i: any) => i.name === itemToEquip.name);
      if (bagIdx > -1) {
        newBag[bagIdx].qty -= 1;
        if (newBag[bagIdx].qty <= 0) newBag.splice(bagIdx, 1);
      }
      newSlots[activeSlot!] = { ...itemToEquip, qty: 1 };

      const newBonuses = getEquipBonus(itemToEquip);
      for (const [stat, val] of Object.entries(newBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) + (val as number);
      }
    } else {
      newSlots[activeSlot!] = null;
    }

    const nextEquipment = { bag: newBag, slots: newSlots };
    // Idempotência: equip_mods é derivado dos slots finais, nunca somado incrementalmente.
    // Assim, se o mesmo inventory_patch/rebind chegar duas vezes, CON/CA não entram em dobro.
    newStats = buildSheetStatsWithDerivedEquipMods(character.stats, nextEquipment);
    if (lanInfo?.sessionId) {
      const clientRequestId = makeLanEventId();
      pendingSelfInventoryStateRef.current = { equipment: nextEquipment, statsPatch: newStats, at: Date.now(), clientMsgId: clientRequestId };
      setCharacter((current: any) => {
        if (!current) return current;
        const merged = { ...current, equipment: nextEquipment, stats: newStats };
        characterRef.current = merged;
        return merged;
      });
      void persistFastLocalPatch({ equipment: nextEquipment, stats: newStats }, 'lan_player_self_equip_optimistic');
      void runSheetAction(`equip:${activeSlot}`, async () => {
        await notifyInventoryPatch(
          nextEquipment,
          `${character.name} atualizou equipamentos equipados.`,
          clientRequestId,
          newStats,
          character.equipment
        );
      });
    } else {
      void updateDB({ equipment: nextEquipment, stats: newStats });
    }
    setSlotModalVisible(false);
    }
  };

  const getFilteredAndSortedSpells = () => {
    let filtered = spellDetails.filter(spell => {
      if (spellSearch && !spell.name.toLowerCase().includes(spellSearch.toLowerCase())) return false;
      
      const sCat = getCategory(spell);
      
      if (spellLevelFilter !== 'Todos') {
        if (spellLevelFilter === 'Passiva') {
          if (sCat !== 'Passiva') return false;
        } else if (spellLevelFilter === 'Habilidade') {
          if (sCat !== 'Habilidade') return false;
        } else {
          if (spell.level !== spellLevelFilter) return false;
        }
      }
      
      if (spellEffectFilter !== 'Todos') {
        const dmgText = (spell.damage_dice || spell.damage || '').toLowerCase();
        const typeText = (spell.damage_type || '').toLowerCase();
        const isCura = dmgText.includes('cura') || dmgText.includes('hp') || typeText.includes('cura');
        const isSupport = (dmgText === '-' || !dmgText) && !isCura; 
        
        if (spellEffectFilter === 'Cura' && !isCura) return false;
        if (spellEffectFilter === 'Suporte/Defesa' && !isSupport) return false;
        if (spellEffectFilter === 'Dano' && (isCura || isSupport)) return false; 
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (spellSortOrder === 'A-Z') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });

    return filtered;
  };

  const getGroupedSpells = () => {
    const filtered = getFilteredAndSortedSpells();
    const groups: Record<string, any[]> = {};

    filtered.forEach(spell => {
      const cat = getCategory(spell);
      const lvl = spell.level || '';
      
      let groupName = '';
      if (cat === 'Passiva') {
          groupName = 'Passivas Inatas';
      } else if (cat === 'Habilidade') {
          groupName = 'Habilidades de Classe';
      } else if (lvl === 'Truque') {
          groupName = 'Truques (Nível 0)';
      } else {
          groupName = `Magias (${lvl})`; 
      }

      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(spell);
    });

    const order = [
      'Passivas Inatas', 
      'Habilidades de Classe', 
      'Truques (Nível 0)', 
      'Magias (Nível 1)', 'Magias (Nível 2)', 'Magias (Nível 3)', 'Magias (Nível 4)', 'Magias (Nível 5)', 
      'Magias (Nível 6)', 'Magias (Nível 7)', 'Magias (Nível 8)', 'Magias (Nível 9)'
    ];
    
    return Object.entries(groups).sort(([a], [b]) => {
      const indexA = order.indexOf(a);
      const indexB = order.indexOf(b);
      return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
    });
  };

  const getSpellIcon = (groupName: string) => {
      if (groupName.includes('Passiva')) return 'shield-checkmark';
      if (groupName.includes('Habilidade')) return 'fitness';
      if (groupName.includes('Truque')) return 'flash';
      return 'book'; 
  };


  // ==============================================================================
  // 3. COMPONENTES DE RENDERIZAÇÃO
  // ==============================================================================


  const renderPublicEffectsModal = (player: PublicLanPlayer | null, onClose: () => void) => {
    const effects = summarizeEffectsForPublicRoster(player?.publicEffects || []);
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
                <Text style={styles.publicEffectModalSubtitle}>{effects.length} efeito(s) visível(is) para a party</Text>
              </View>
              <TouchableOpacity style={styles.publicEffectModalClose} onPress={onClose}>
                <Ionicons name="close" size={20} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.publicEffectModalList} contentContainerStyle={{ paddingBottom: 6 }} nestedScrollEnabled>
              {effects.length === 0 ? (
                <Text style={styles.publicEffectModalEmpty}>Nenhum efeito público ativo.</Text>
              ) : effects.map((effect: any, index) => (
                <View key={`${effect.id || effect.name || 'effect'}:${index}`} style={styles.publicEffectModalRow}>
                  <View style={[styles.publicEffectDot, effect.color ? { backgroundColor: effect.color } : null]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.publicEffectModalName} numberOfLines={1}>{getPublicEffectName(effect)}</Text>
                    <Text style={styles.publicEffectModalMeta}>{summarizePublicEffectDetail(effect)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderLanPartyCard = () => {
    if (!lanInfo && lanPlayers.length === 0) return null;
    const otherPlayers = lanPlayers.filter((player) => !player.isSelf);

    return (
      <View style={styles.sessionPartyBox}>
        <View style={styles.sessionPartyHeader}>
          <View>
            <Text style={styles.sessionPartyTitle}>SESSAO LAN</Text>
            <Text style={styles.sessionPartyHint}>Jogadores veem apenas vida e nivel do grupo.</Text>
          </View>
          {incomingTrades.length > 0 && (
            <TouchableOpacity style={styles.pendingTradeButton} onPress={() => setSelectedTradeOffer(incomingTrades[0])}>
              <Text style={styles.pendingTradeText}>{incomingTrades.length} TROCA</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLanReadOnly && (
          <Text style={[styles.sessionPartyHint, { color: appColors.warning, marginBottom: 10 }]}>
            Sessao pausada ou encerrada. Modo leitura.
          </Text>
        )}

        {activeVisualEffects.length > 0 && (() => {
          const selfEffectSummary = formatPublicEffectSummary(activeVisualEffects, 2);
          return (
            <TouchableOpacity
              style={[styles.sessionPlayerRow, { alignItems: 'flex-start' }]}
              activeOpacity={0.75}
              onPress={() => {
                const self = lanPlayers.find((player) => player.isSelf) || null;
                if (self) setPublicEffectsModalPlayer({ ...self, publicEffects: summarizeEffectsForPublicRoster(activeVisualEffects) });
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sessionPlayerName}>Voce esta sob efeito de</Text>
                <Text style={styles.sessionPlayerMeta} numberOfLines={1} ellipsizeMode="tail">
                  {selfEffectSummary.text}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })()}

        {lanPlayers.length === 0 ? (
          <Text style={styles.emptyText}>Aguardando sincronizacao da mesa.</Text>
        ) : lanPlayers.map((player) => {
          const hpPercent = player.hpMax > 0 ? Math.max(0, Math.min(100, (player.hpCurrent / player.hpMax) * 100)) : 0;
          const effectSummary = formatPublicEffectSummary(player.publicEffects, 2);
          return (
            <TouchableOpacity
              key={player.key}
              style={styles.sessionPlayerRow}
              activeOpacity={effectSummary.total > 0 ? 0.75 : 1}
              onPress={() => {
                if (effectSummary.total > 0) setPublicEffectsModalPlayer(player);
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sessionPlayerName} numberOfLines={1}>{player.characterName}{player.isSelf ? ' (voce)' : ''}</Text>
                <Text style={styles.sessionPlayerMeta} numberOfLines={1}>Nivel {player.level}{player.playerName ? ` - ${player.playerName}` : ''}</Text>
                {effectSummary.total > 0 && (
                  <Text style={[styles.sessionPlayerMeta, { color: '#00fa9a' }]} numberOfLines={1} ellipsizeMode="tail">
                    {effectSummary.text}
                  </Text>
                )}
              </View>
              <View style={[styles.sessionHpBox, { flexShrink: 0 }]}>
                <Text style={styles.sessionHpText} numberOfLines={1}>
                  {player.hpCurrent}/{player.hpMax}{player.tempHp > 0 ? ` +${player.tempHp}` : ''}
                </Text>
                <View style={styles.sessionHpTrack}>
                  <View style={[styles.sessionHpFill, { width: `${hpPercent}%` }]} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {otherPlayers.length === 0 && <Text style={styles.sessionPartyHint}>Quando outro jogador entrar, ele aparece aqui para envio ou troca.</Text>}

        {renderPublicEffectsModal(publicEffectsModalPlayer, () => setPublicEffectsModalPlayer(null))}
      </View>
    );
  };

  const renderAttackCard = (item: any, slotKey: string, title: string) => {
    if (!item) {
      if (slotKey !== 'mainHand') return null;
      return (
        <View style={styles.atkCard}>
          <Text style={styles.combatLabel}>ATAQUE DESARMADO (Mão Livre)</Text>
          <View style={styles.atkRow}>
            <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{forMod + profBonusChar}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
            <View style={styles.atkSubBox}><Text style={[styles.atkVal, {color: '#00fa9a'}]}>1 {forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}</Text><Text style={styles.atkLab}>DANO (Concussão)</Text></View>
          </View>
        </View>
      );
    }

    const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
    let itemDamage = item.damage || dbItem?.damage;
    if (!itemDamage || itemDamage === '-') itemDamage = '1d4';
    
    let itemDamageType = item.damage_type || dbItem?.damage_type;
    if (!itemDamageType || itemDamageType === '-') itemDamageType = 'Concussão (Improvisada)';

    const props = item.properties || dbItem?.properties || '';
    const isRanged = props.includes('Munição') || props.includes('Arremesso') || slotKey === 'ranged';
    const isFinesse = props.includes('Acuidade');
    
    let activeMod = forMod;
    if (isRanged && !props.includes('Arremesso')) activeMod = desMod;
    else if (isFinesse) activeMod = Math.max(forMod, desMod);
    
    let dmgMod = activeMod;
    if (slotKey === 'offHand' && dmgMod > 0) dmgMod = 0; 

    return (
      <View style={styles.atkCard} key={slotKey}>
        <Text style={styles.combatLabel}>{title.toUpperCase()}: {item.name.toUpperCase()}</Text>
        <View style={styles.atkRow}>
          <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{activeMod + profBonusChar}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
          <View style={styles.atkSubBox}>
            <Text style={[styles.atkVal, {color: '#00fa9a'}]}>{itemDamage} {dmgMod !== 0 ? (dmgMod > 0 ? `+${dmgMod}` : dmgMod) : ''}</Text>
            <Text style={styles.atkLab}>DANO ({itemDamageType})</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEquipSlot = (slotKey: keyof typeof DEFAULT_SLOTS, label: string, icon: string) => {
    const item = renderEquipment.slots[slotKey];
    const dbItem = item ? dbItemsCatalog.find(cat => cat.name === item.name) : null;
    
    const itemDamage = item?.damage || dbItem?.damage;
    const itemDamageType = item?.damage_type || dbItem?.damage_type;
    const itemProps = item?.properties || dbItem?.properties;

    let extraInfo = null;
    if (itemDamage && itemDamage !== '-') {
      extraInfo = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''}`;
    } else if (itemProps && itemProps !== '-') {
      extraInfo = `🛡️ ${itemProps.split(',')[0]}`; 
    }

    return (
      <TouchableOpacity
        style={[styles.equipSlotBox, item && styles.equipSlotBoxFilled, isLanReadOnly && { opacity: 0.65 }]}
        onPress={() => {
          if (!ensureLanWritable()) return;
          setActiveSlot(slotKey);
          setSlotModalVisible(true);
        }}
      >
        <Text style={styles.equipSlotLabel}>{label}</Text>
        {item ? (
          <>
            <Text style={styles.equipSlotItemName} numberOfLines={2} adjustsFontSizeToFit>{item.name}</Text>
            {extraInfo && (<Text style={styles.equipSlotItemDamage} numberOfLines={1} adjustsFontSizeToFit>{extraInfo}</Text>)}
          </>
        ) : (<Text style={styles.equipSlotEmptyIcon}>{icon}</Text>)}
      </TouchableOpacity>
    );
  };

  // ==============================================================================
  // 4. RETORNO PRINCIPAL DA TELA
  // ==============================================================================

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {activeConditionColor ? (
        <View pointerEvents="none" style={[styles.conditionGlowFrame, conditionFrameStyle]} />
      ) : null}

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => {
          traceButton('sheet', 'SHEET_BACK', {
            sessionId: lanInfo?.sessionId || routeSessionId,
            characterId: character.id,
            characterName: character.name,
          });
          handleSheetBack();
        }}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
        <TouchableOpacity onPress={() => {
          traceButton('sheet', 'OPEN_DEBUG_TRACE', {
            sessionId: lanInfo?.sessionId || routeSessionId,
            characterId: character.id,
            characterName: character.name,
          });
          router.push('/debug-trace' as any);
        }}>
          <Text style={{ color: appColors.warning, fontWeight: 'bold' }}>Trace</Text>
        </TouchableOpacity>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContainer}>
          {['stats', 'profs', 'inv', 'spells'].map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t as any)}>
              <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>
                {t === 'stats' ? 'STATUS' : t === 'profs' ? 'PROFS' : t === 'inv' ? 'MOCHILA' : 'HABILIDADES'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderLanPartyCard()}
        
        {/* ABA STATUS */}
        {activeTab === 'stats' && (
          <>
            <View style={styles.headerBlock}>
              <Text style={styles.charClassRace}>{character.race} • {character.class}</Text>
              
              <View style={styles.levelXpRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>Nv. {character.level}</Text></View>
                
                <TouchableOpacity style={[styles.badge, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                  traceButton('sheet', 'OPEN_XP_MODAL', {
                    mode: sheetRuntimeMode,
                    sessionId: lanInfo?.sessionId,
                    characterId: character.id,
                    characterName: character.name,
                    before: { xp: character.xp, level: character.level },
                  });
                  if (ensureLanWritable()) setXpModalVisible(true);
                }}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {xpTargetLabel}</Text>
                </TouchableOpacity>

                {isPendingLevelUp && (
                  <TouchableOpacity style={[styles.levelUpIconBtn, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (!ensureLanWritable()) return; setNewLevelData(expectedLevel); setLevelUpModalVisible(true);}}>
                    <Ionicons name="arrow-up" size={24} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <TouchableOpacity style={[styles.hpBarStyle, hpBonusFromCon !== 0 && {borderColor: hpBonusFromCon > 0 ? '#00fa9a' : '#ff6666', borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]} onPress={() => {
              traceButton('sheet', 'OPEN_HP_MODAL', {
                mode: sheetRuntimeMode,
                sessionId: lanInfo?.sessionId,
                characterId: character.id,
                characterName: character.name,
                before: { hp_current: character.hp_current, hp_max: character.hp_max, temp_hp: character.temp_hp },
              });
              if (ensureLanWritable()) setHpModalVisible(true);
            }}>
              <Text style={styles.hpTextStyle}>
                {displayHpCurrent} <Text style={styles.hpMaxTextStyle}>/ {displayHpMax}</Text>
                {Number(renderCharacter.temp_hp || 0) > 0 && (
                  <Text style={{ color: appColors.success, fontWeight: '900' }}> +{Number(renderCharacter.temp_hp || 0)}</Text>
                )}
              </Text>
              <Text style={styles.combatLabel}>PONTOS DE VIDA {hpBonusFromCon !== 0 && `(CON ${hpBonusFromCon > 0 ? '+' : ''}${hpBonusFromCon})`}</Text>
            </TouchableOpacity>

            <View style={styles.combatStatsRow}>
              <TouchableOpacity style={[styles.combatStatSmall, caSumBuffs !== 0 && {borderColor: caColor, borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]} 
                onPress={() => { if (!ensureLanWritable()) return; setActiveBuffStat('CA'); setTempBuffValue(String(caTemp)); setTempBuffModalVisible(true); }}>
                {caSumBuffs !== 0 && <Text style={{position: 'absolute', top: 8, right: 12, fontSize: 11, fontWeight: 'bold', color: caColor}}>{caSumBuffs > 0 ? `+${caSumBuffs}` : caSumBuffs}</Text>}
                <Text style={[styles.combatStatValue, caSumBuffs !== 0 && {color: caColor}]}>{armorClassTotal}</Text>
                <Text style={styles.combatLabel}>C.A</Text>
              </TouchableOpacity>
              
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{desMod >= 0 ? `+${desMod}` : desMod}</Text><Text style={styles.combatLabel}>INICIATIVA</Text></View>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{charRaceSpeed}</Text><Text style={styles.combatLabel}>DESLOC.</Text></View>
            </View>

            <Text style={styles.sectionTitle}>ATRIBUTOS</Text>
            <View style={styles.attributesGrid}>
              {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map((key) => {
                const baseV = parseInt(character.stats[key]) || 10;
                const tempV = parseInt(character.stats.temp_mods?.[key]) || 0;
                const equipV = parseInt(character.stats.equip_mods?.[key]) || 0;
                const lanEffectV = getLanStatEffectBonus(character, key);
                
                const totalV = baseV + tempV + equipV + lanEffectV;
                const sumBuffs = tempV + equipV + lanEffectV;
                const hasBuffs = sumBuffs !== 0;
                
                const buffColor = sumBuffs > 0 ? '#00fa9a' : '#ff6666';

                return (
                  <TouchableOpacity key={key} 
                    style={[styles.attrBox, hasBuffs && {borderColor: buffColor, borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]}
                    onPress={() => { if (!ensureLanWritable()) return; setActiveBuffStat(key); setTempBuffValue(String(tempV)); setTempBuffModalVisible(true); }}
                  >
                    {hasBuffs && <Text style={{position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 'bold', color: buffColor}}>{sumBuffs > 0 ? `+${sumBuffs}` : sumBuffs}</Text>}
                    <Text style={styles.attrLabel}>{key}</Text>
                    <Text style={[styles.attrValue, hasBuffs && {color: buffColor}]}>{totalV}</Text>
                    <View style={styles.modBadge}><Text style={styles.modText}>{getMod(String(totalV)) >= 0 ? `+${getMod(String(totalV))}` : getMod(String(totalV))}</Text></View>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.sectionTitle}>HISTÓRICO E CARACTERÍSTICAS</Text>
            <View style={styles.cardBlock}>
              {character.features_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>TRAÇOS</Text><Text style={styles.detailText}>{character.features_traits}</Text></View> : null}
              {character.languages ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDIOMAS</Text><Text style={styles.detailText}>{character.languages}</Text></View> : null}
              {character.personality_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>PERSONALIDADE</Text><Text style={styles.detailText}>{character.personality_traits}</Text></View> : null}
              {character.ideals ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDEAIS</Text><Text style={styles.detailText}>{character.ideals}</Text></View> : null}
              {character.bonds ? <View style={styles.detailSection}><Text style={styles.detailLabel}>LIGAÇÕES</Text><Text style={styles.detailText}>{character.bonds}</Text></View> : null}
              {character.flaws ? <View style={styles.detailSection}><Text style={styles.detailLabel}>DEFEITOS</Text><Text style={styles.detailText}>{character.flaws}</Text></View> : null}
              {character.backstory ? <View style={styles.detailSection}><Text style={styles.detailLabel}>HISTÓRIA</Text><Text style={styles.detailText}>{character.backstory}</Text></View> : null}
            </View>
          </>
        )}

        {/* ABA PROFICIÊNCIAS */}
        {activeTab === 'profs' && (
          <>
            <View style={styles.headerSpaceBetween}>
              <Text style={styles.sectionTitle}>TESTES DE RESISTÊNCIA</Text>
              <Text style={{color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold'}}>Bônus Prof: +{profBonusChar}</Text>
            </View>
            <View style={styles.cardBlock}>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'}}>
                {proficientSaves.length > 0 ? proficientSaves.map((save: any) => {
                  const bV = parseInt(character.stats[save.stat]) || 10;
                  const tV = parseInt(character.stats.temp_mods?.[save.stat]) || 0;
                  const eV = parseInt(character.stats.equip_mods?.[save.stat]) || 0;
                  const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                  const total = statMod + profBonusChar;
                  return (
                    <View key={save.id} style={{width: '48%', flexDirection: 'row', alignItems: 'center', marginBottom: 15}}>
                      <View style={styles.profIconActive} />
                      <Text style={styles.profName}>{save.name}</Text>
                      <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                    </View>
                  );
                }) : <Text style={styles.emptyText}>Nenhum teste de resistência marcado.</Text>}
              </View>
            </View>

            <Text style={styles.sectionTitle}>PERÍCIAS (Skills)</Text>
            <View style={styles.cardBlock}>
              {proficientSkills.length > 0 ? proficientSkills.map((skill: any) => {
                const bV = parseInt(character.stats[skill.stat]) || 10;
                const tV = parseInt(character.stats.temp_mods?.[skill.stat]) || 0;
                const eV = parseInt(character.stats.equip_mods?.[skill.stat]) || 0;
                const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                const total = statMod + profBonusChar;
                return (
                  <View key={skill.id} style={styles.profRow}>
                    <View style={styles.profStatBadge}><Text style={{fontSize: 9, fontWeight: 'bold', color: 'rgba(255,255,255,0.5)'}}>{skill.stat}</Text></View>
                    <View style={styles.profIconActive} />
                    <Text style={[styles.profName, {flex: 1}]}>{skill.name}</Text>
                    <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                  </View>
                );
              }) : <Text style={styles.emptyText}>Nenhuma proficiência em perícias.</Text>}
            </View>
          </>
        )}

        {/* ABA INVENTÁRIO */}
        {activeTab === 'inv' && (
          <>
            <View style={styles.weightCard}>
                <Text style={styles.combatLabel}>PESO DA CARGA (Itens + Moedas)</Text>
                <Text style={[styles.weightVal, totalWeight > carryCap && {color: '#ff6666'}]}>{totalWeight.toFixed(1)} / {carryCap.toFixed(1)} kg</Text>
                <View style={styles.weightBarStyle}><View style={[styles.weightFillStyle, {width: `${Math.min((totalWeight/carryCap)*100, 100)}%`, backgroundColor: totalWeight > carryCap ? '#ff6666' : '#00bfff'}]} /></View>
            </View>

            <Text style={styles.sectionTitle}>AÇÕES DE ATAQUE</Text>
            {renderAttackCard(renderEquipment.slots.mainHand, 'mainHand', 'Mão Principal')}
            {renderAttackCard(renderEquipment.slots.offHand, 'offHand', 'Mão Secundária')}
            {renderAttackCard(renderEquipment.slots.ranged, 'ranged', 'Arma à Distância')}

            <View style={styles.headerSpaceBetween}>
              <Text style={styles.sectionTitle}>MOEDAS</Text>
              <TouchableOpacity style={[styles.addBtn, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setConvertModalVisible(true); }}>
                <Text style={styles.addBtnText}>💱 CÂMBIO</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.coinManager}>
              {[ { l: 'PO', k: 'gp', c: '#ffd700' }, { l: 'PP', k: 'sp', c: '#c0c0c0' }, { l: 'PC', k: 'cp', c: '#cd7f32' } ].map(c => (
                <View key={c.k} style={styles.coinControl}>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, -1)} style={[styles.coinBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.coinDisplay, isLanReadOnly && { opacity: 0.65 }]} onPress={() => { if (!ensureLanWritable()) return; setActiveCoinType(c.k as any); setInputValue(character[c.k].toString()); setCoinModalVisible(true); }}>
                    <Text style={[styles.coinLabel, {color: c.c}]}>{c.l}</Text>
                    <Text style={[styles.coinValText, {textDecorationLine: 'underline'}]}>{character[c.k]}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, 1)} style={[styles.coinBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.headerSpaceBetween}>
                <Text style={styles.sectionTitle}>MOCHILA (Bolsos)</Text>
                {!lanInfo?.sessionId && (
                  <TouchableOpacity style={styles.addBtn} onPress={() => setItemModalVisible(true)}><Text style={styles.addBtnText}>+ ITEM</Text></TouchableOpacity>
                )}
            </View>
            
            <View style={styles.cardBlock}>
              {renderEquipment.bag.length > 0 ? renderEquipment.bag.map((item: any, i: number) => {
                  const p = (item.properties || '').toLowerCase();
                  const d = (item.damage || '').toLowerCase();
                  const dt = (item.damage_type || '').toLowerCase();
                  const n = (item.name || '').toLowerCase();
                  const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || n.includes('poção') || n.includes('pocao');

                  return (
                    <View key={i} style={styles.itemRow}>
                        <View style={styles.qtyContainer}>
                            <TouchableOpacity onPress={() => updateBagQty(i, -1)} style={[styles.smallQtyBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.smallQtyBtnText}>-</Text></TouchableOpacity>
                            <Text style={styles.itemQty}>{item.qty}</Text>
                            {!lanInfo?.sessionId && (
                              <TouchableOpacity onPress={() => updateBagQty(i, 1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>+</Text></TouchableOpacity>
                            )}
                        </View>
                        
                        <TouchableOpacity 
                          style={{flex: 1}} 
                          onPress={() => {
                            if (!ensureLanWritable()) return;
                            setActionQty(1);
                            setSelectedBagItem({item, index: i});
                          }}
                        >
                            <Text style={styles.itemName}>{item.name}</Text>
                            <Text style={styles.itemSubDetail}>{item.weight}kg {item.properties ? ` • ${item.properties}` : ''}</Text>
                        </TouchableOpacity>

                    </View>
                  )
              }) : <Text style={styles.emptyText}>Sua mochila está vazia.</Text>}
            </View>

            <Text style={[styles.sectionTitle, {marginTop: 20}]}>SLOTS EQUIPADOS</Text>
            <View style={styles.equipGrid}>
              {renderEquipSlot('helmet', 'Capacete', '🪖')}
              {renderEquipSlot('amulet', 'Colar', '📿')}
              {renderEquipSlot('cloak', 'Capa', '🧥')}
              {renderEquipSlot('armor', 'Armadura', '🛡️')}
              {renderEquipSlot('campClothes', 'Acampamento', '🏕️')}
              {renderEquipSlot('lightSource', 'Fonte de Luz', '🕯️')}
              {renderEquipSlot('gloves', 'Luvas', '🧤')}
              {renderEquipSlot('boots', 'Botas', '👢')}
              {renderEquipSlot('ring1', 'Anel 1', '💍')}
              {renderEquipSlot('ring2', 'Anel 2', '💍')}
              {renderEquipSlot('mainHand', 'Principal', '🗡️')}
              {renderEquipSlot('offHand', 'Secundária', '🔪')}
              {renderEquipSlot('ranged', 'Distância', '🏹')}
            </View>
            <View style={{height: 30}} />
          </>
        )}

        {/* ABA MAGIAS E HABILIDADES */}
        {activeTab === 'spells' && (
          <View style={{paddingBottom: 20}}>
            
            <View style={styles.spellFilterSection}>
              <View style={styles.spellSearchRow}>
                <View style={styles.spellSearchInputBox}>
                  <Ionicons name="search" size={16} color="rgba(255,255,255,0.4)" />
                  <TextInput style={styles.spellSearchInput} placeholder="Buscar na lista..." placeholderTextColor="rgba(255,255,255,0.4)" value={spellSearch} onChangeText={setSpellSearch} />
                </View>
                <TouchableOpacity style={styles.spellSortBtn} onPress={() => setSpellSortOrder(prev => prev === 'A-Z' ? 'Z-A' : 'A-Z')}>
                  <Ionicons name={spellSortOrder === 'A-Z' ? "arrow-down" : "arrow-up"} color="#00bfff" size={18} />
                  <Text style={styles.spellSortText}>{spellSortOrder}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>NÍVEL / CATEGORIA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_LEVELS.map(lvl => (
                    <TouchableOpacity key={lvl} style={[styles.filterPill, spellLevelFilter === lvl && styles.filterPillActive]} onPress={() => setSpellLevelFilter(lvl)}>
                      <Text style={[styles.filterPillText, spellLevelFilter === lvl && styles.filterPillTextActive]}>{lvl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.filterLabel}>TIPO DE EFEITO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_EFFECTS.map(eff => (
                    <TouchableOpacity key={eff} style={[styles.filterPill, spellEffectFilter === eff && styles.filterPillActive]} onPress={() => setSpellEffectFilter(eff)}>
                      <Text style={[styles.filterPillText, spellEffectFilter === eff && styles.filterPillTextActive]}>{eff}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            <View style={{marginTop: 10}}>
              {getGroupedSpells().length > 0 ? getGroupedSpells().map(([groupName, spells]) => (
                <View key={groupName} style={{marginBottom: 20}}>
                   <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', paddingBottom: 5}}>
                      <Ionicons name={getSpellIcon(groupName) as any} size={18} color="#00bfff" />
                      <Text style={styles.spellGroupHeader}>{groupName.toUpperCase()}</Text>
                   </View>
                   
                   <View style={{gap: 12}}>
                      {spells.map((spell: any) => {
                        const effDisplay = spell.damage_dice || spell.damage || '-';
                        const typeDisplay = spell.damage_type && spell.damage_type !== 'Nenhum' ? ` (${spell.damage_type})` : '';

                        return (
                          <TouchableOpacity key={spell.id} style={styles.spellCardCompact} onPress={() => setSelectedSpell(spell)}>
                            <View style={styles.spellIconBox}>
                               <Ionicons name={getSpellIcon(groupName) as any} size={24} color="#00bfff" />
                            </View>
                            
                            <View style={{flex: 1, marginLeft: 15, justifyContent: 'center'}}>
                              <Text style={styles.spellNameCompact}>{spell.name}</Text>
                              <Text style={styles.spellSubCompact}>
                                 {spell.casting_time && spell.casting_time !== 'Passiva' ? `⏱️ ${spell.casting_time}  ` : ''}
                                 {spell.range && spell.range !== 'Pessoal' ? `📍 ${spell.range}` : ''}
                              </Text>
                            </View>
                            
                            <View style={{alignItems: 'flex-end', justifyContent: 'center'}}>
                              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.3)" />
                              {effDisplay !== '-' && (
                                <Text style={{color: '#00fa9a', fontWeight: 'bold', fontSize: 11, marginTop: 4}}>{effDisplay}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )
                      })}
                   </View>
                </View>
              )) : <Text style={[styles.emptyText, {marginTop: 40}]}>Nenhuma habilidade/magia atende aos filtros.</Text>}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ================= MODAIS DE SISTEMA ================= */}

      {/* MODAL DE DETALHES DE MAGIA/HABILIDADE ANIMADO */}
      <Modal visible={!!selectedSpell} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedSpell(null)}>
          <Animated.View style={[
            styles.spellDetailCard, 
            { opacity: spellFadeAnim, transform: [{ scale: spellScaleAnim }] }
          ]}>
            <Pressable onPress={e => e.stopPropagation()}>
              {selectedSpell && (
                <>
                  <View style={styles.spellDetailHeader}>
                    <View style={styles.spellDetailIcon}>
                      <Ionicons name={getSpellIcon(getCategory(selectedSpell)) as any} size={32} color="#02112b" />
                    </View>
                    <View style={{flex: 1, marginLeft: 15}}>
                      <Text style={styles.spellDetailName}>{selectedSpell.name}</Text>
                      <Text style={styles.spellDetailLevel}>
                         {getCategory(selectedSpell).toUpperCase()} {selectedSpell.level !== 'Passiva' && selectedSpell.level !== 'Truque' && !selectedSpell.level.includes('Nível') ? `• Nível ${selectedSpell.level}` : (selectedSpell.level !== 'Passiva' && selectedSpell.level !== 'Truque' ? `• ${selectedSpell.level.replace('Nível ', 'NV ')}` : '')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.divider} />
                  
                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>CONJURAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.casting_time || 'N/A'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.range || 'Pessoal'}</Text>
                    </View>
                  </View>

                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>COMPONENTES</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.components || '-'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>DURAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.duration || 'Permanente'}</Text>
                    </View>
                  </View>

                  {(selectedSpell.damage_dice || selectedSpell.damage || selectedSpell.saving_throw) && (selectedSpell.damage_dice !== '-' || selectedSpell.damage !== '-') && (
                    <View style={{backgroundColor: 'rgba(0,250,154,0.1)', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)'}}>
                      <Text style={[styles.spellDetailInfoLabel, {color: '#00fa9a', textAlign: 'center'}]}>EFEITO PRINCIPAL</Text>
                      <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', fontSize: 16}]}>
                        {selectedSpell.damage_dice || selectedSpell.damage} {selectedSpell.damage_type && selectedSpell.damage_type !== 'Nenhum' ? `(${selectedSpell.damage_type})` : ''}
                        {selectedSpell.saving_throw && selectedSpell.saving_throw !== 'Nenhum' ? ` • CD ${selectedSpell.saving_throw}` : ''}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
                  <ScrollView style={{maxHeight: 250, marginTop: 5, backgroundColor: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 12}}>
                    <Text style={styles.spellDetailDescription}>{selectedSpell.description}</Text>
                  </ScrollView>

                  {lanInfo?.joinUrl && lanPlayers.length > 0 && (
                    <TouchableOpacity style={[styles.tradeActionButton, {marginTop: 14}, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) startSpellCast(selectedSpell); }}>
                      <Ionicons name="sparkles" size={18} color="#00bfff" />
                      <Text style={styles.tradeActionButtonText}>Usar na sessao</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedSpell(null)}>
                    <Text style={styles.modalCloseText}>FECHAR DETALHES</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Modal de Câmbio de Moedas */}
      <Modal visible={spellCastVisible && !!selectedSpell} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSpellCastVisible(false)}>
          <View style={styles.spellCastPanel}>
            {selectedSpell && (
              <>
                <View style={styles.spellCastHeader}>
                  <View>
                    <Text style={styles.spellCastTitle}>{selectedSpell.name}</Text>
                    <Text style={styles.spellCastMeta}>
                      {getSpellCastMode(selectedSpell) === 'heal' ? 'Cura' : getSpellCastMode(selectedSpell) === 'damage' ? 'Dano' : 'Efeito'} - {selectedSpell.duration || 'Instantanea'}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSpellCastVisible(false)}>
                    <Ionicons name="close" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>

                {getSpellCastMode(selectedSpell) !== 'effect' ? (
                  <>
                    <View style={styles.modalRowButtons}>
                      <TouchableOpacity style={styles.tradeActionButton} onPress={rollSpellForTargets}>
                        <Ionicons name="dice" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Rolar virtual</Text>
                      </TouchableOpacity>
                      <View style={styles.tradeActionButton}>
                        <Ionicons name="create" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Valor fisico</Text>
                      </View>
                    </View>

                    <View style={styles.spellResultBox}>
                      <Text style={styles.spellResultText}>
                        {spellRollResult || `Formula: ${getSpellDiceText(selectedSpell) || 'valor manual'}`}
                      </Text>
                    </View>
                    {isSpellAttackRollRequired(selectedSpell) && (
                      <>
                        <View style={styles.modalRowButtons}>
                          <TouchableOpacity style={styles.tradeActionButton} onPress={rollSpellAttackForTargets}>
                            <Ionicons name="flash" size={18} color="#00bfff" />
                            <Text style={styles.tradeActionButtonText}>Rolar ataque</Text>
                          </TouchableOpacity>
                          <View style={styles.tradeActionButton}>
                            <Ionicons name="shield" size={18} color="#00bfff" />
                            <Text style={styles.tradeActionButtonText}>{formatSignedModifier(getSpellAttackModifier(selectedSpell))} ataque</Text>
                          </View>
                        </View>
                        <View style={styles.spellResultBox}>
                          <Text style={styles.spellResultText}>
                            {spellAttackRollResult || `Ataque: 1d20 ${formatSignedModifier(getSpellAttackModifier(selectedSpell))}`}
                          </Text>
                        </View>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.sessionPartyHint}>Para efeitos como enfeiticar, armadura ou buffs, escolha o alvo e opcionalmente um atributo/valor para registrar.</Text>
                    <View style={styles.spellEffectRow}>
                      {(['custom', 'PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'] as LanEffectTarget[]).map((target) => (
                        <TouchableOpacity
                          key={target}
                          style={[styles.filterPill, spellEffectTarget === target && styles.filterPillActive]}
                          onPress={() => setSpellEffectTarget(target)}
                        >
                          <Text style={[styles.filterPillText, spellEffectTarget === target && styles.filterPillTextActive]}>{target}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={styles.modalInput}
                      value={spellEffectValue}
                      onChangeText={setSpellEffectValue}
                      keyboardType="numeric"
                      placeholder="Valor opcional. Ex: +2"
                      placeholderTextColor="#666"
                    />
                  </>
                )}

                <FlatList
                  data={lanPlayers}
                  keyExtractor={(player) => player.key}
                  style={styles.tradeList}
                  renderItem={({ item }) => {
                    const active = spellTargetKeys.includes(item.key);
                    return (
                      <TouchableOpacity
                        style={[styles.spellTargetRow, active && styles.spellTargetRowActive]}
                        onPress={() => toggleSpellTarget(item.key)}
                      >
                        <View style={[styles.spellTargetCheck, active && styles.spellTargetCheckActive]}>
                          {active && <Ionicons name="checkmark" size={15} color="#02112b" />}
                        </View>
                        <View style={{flex: 1}}>
                          <Text style={styles.sessionPlayerName}>{item.characterName}{item.isSelf ? ' (voce)' : ''}</Text>
                          <Text style={styles.sessionPlayerMeta}>
                            Nivel {item.level} - HP {item.hpCurrent}/{item.hpMax}{item.tempHp > 0 ? ` (+${item.tempHp} temp.)` : ''}
                          </Text>
                        </View>
                        {getSpellCastMode(selectedSpell) !== 'effect' && (
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TextInput
                              style={styles.spellAmountInput}
                              value={spellTargetAmounts[item.key] || ''}
                              onChangeText={(value) => {
                                setSpellRollMode('manual');
                                setSpellTargetAmounts((current) => ({ ...current, [item.key]: value }));
                              }}
                              keyboardType="numeric"
                              placeholder={isSpellAttackRollRequired(selectedSpell) ? 'Dano' : '0'}
                              placeholderTextColor="#666"
                            />
                            {isSpellAttackRollRequired(selectedSpell) && (
                              <TextInput
                                style={styles.spellAmountInput}
                                value={spellTargetAttackRolls[item.key] || ''}
                                onChangeText={(value) => {
                                  setSpellAttackRollMode('manual');
                                  setSpellTargetAttackRolls((current) => ({ ...current, [item.key]: value }));
                                }}
                                keyboardType="numeric"
                                placeholder="d20"
                                placeholderTextColor="#666"
                              />
                            )}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />

                {lanPlayers.some((player) => player.isSelf) && (
                  <TouchableOpacity
                    style={styles.tradeActionButton}
                    onPress={() => {
                      const self = lanPlayers.find((player) => player.isSelf);
                      if (!self) return;
                      setSpellTargetKeys([self.key]);
                      setSpellTargetAmounts({ [self.key]: spellTargetAmounts[self.key] || '' });
                      setSpellTargetAttackRolls({ [self.key]: spellTargetAttackRolls[self.key] || '' });
                    }}
                  >
                    <Ionicons name="person" size={18} color="#00bfff" />
                    <Text style={styles.tradeActionButtonText}>Usar em mim</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.lvlUpBtnPrimary, isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`) && { opacity: 0.5 }]}
                  disabled={isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`)}
                  onPress={applySpellCast}
                >
                  <Text style={styles.lvlUpBtnPrimaryText}>
                    {isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`) ? 'Enviando...' : 'Aplicar magia'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={convertModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setConvertModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Casa da Moeda</Text>
            
            <View style={styles.exchangeBox}>
               <View style={styles.exchangeSide}>
                 <Text style={styles.exchangeLabel}>DE (Pagar)</Text>
                 <View style={styles.exchangeCoins}>
                   {(['gp', 'sp', 'cp'] as const).map(c => (
                     <TouchableOpacity key={c} style={[styles.coinMiniBtn, convertFrom === c && {borderColor: COIN_COLORS[c], backgroundColor: 'rgba(255,255,255,0.1)'}]} onPress={() => setConvertFrom(c)}>
                       <Text style={{color: COIN_COLORS[c], fontWeight: 'bold', fontSize: 12}}>{c.toUpperCase()}</Text>
                     </TouchableOpacity>
                   ))}
                 </View>
               </View>

               <Ionicons name="arrow-forward" size={24} color="rgba(255,255,255,0.2)" />

               <View style={styles.exchangeSide}>
                 <Text style={styles.exchangeLabel}>PARA (Receber)</Text>
                 <View style={styles.exchangeCoins}>
                   {(['gp', 'sp', 'cp'] as const).map(c => (
                     <TouchableOpacity key={c} style={[styles.coinMiniBtn, convertTo === c && {borderColor: COIN_COLORS[c], backgroundColor: 'rgba(255,255,255,0.1)'}]} onPress={() => setConvertTo(c)}>
                       <Text style={{color: COIN_COLORS[c], fontWeight: 'bold', fontSize: 12}}>{c.toUpperCase()}</Text>
                     </TouchableOpacity>
                   ))}
                 </View>
               </View>
            </View>

            <View style={{alignItems: 'center', marginBottom: 20}}>
              <TextInput style={[styles.modalInputLarge, {width: '80%', marginBottom: 5}]} keyboardType="numeric" value={convertAmount} onChangeText={setConvertAmount} placeholder="0" placeholderTextColor="#666" autoFocus />
              <Text style={{color: 'rgba(255,255,255,0.5)', fontSize: 12}}>Seu saldo: {character?.[convertFrom]} {COIN_NAMES[convertFrom]}</Text>
            </View>

            {(() => {
                const sourceAmount = parseInt(convertAmount) || 0;
                const copperValue = sourceAmount * COIN_RATES[convertFrom];
                const targetAmount = copperValue / COIN_RATES[convertTo];
                
                let isValid = false;
                let msg = "Aguardando valor...";
                let color = "rgba(255,255,255,0.2)";
                const isConvertingCoins = isSheetActionSubmitting('coin:convert');

                if (sourceAmount > 0) {
                  if (convertFrom === convertTo) {
                    msg = "Selecione moedas diferentes";
                    color = "#ff6666";
                  } else if (sourceAmount > character?.[convertFrom]) {
                    msg = "Saldo insuficiente!";
                    color = "#ff6666";
                  } else if (!Number.isInteger(targetAmount)) {
                    msg = "Conversão gera quebra (valor inexato)";
                    color = "#ff6666";
                  } else {
                    msg = `Receber: ${targetAmount} ${COIN_NAMES[convertTo]}`;
                    color = "#00fa9a";
                    isValid = true;
                  }
                }

                return (
                  <>
                    <Text style={{color: color, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 20}}>
                      {msg}
                    </Text>

                    <View style={styles.modalRowButtons}>
                      <TouchableOpacity style={styles.modalBtn} onPress={() => {setConvertModalVisible(false); setConvertAmount('');}}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Cancelar</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.modalBtn, {opacity: isValid && !isConvertingCoins ? 1 : 0.5}]} disabled={!isValid || isConvertingCoins} onPress={() => executeCoinConversion(sourceAmount, targetAmount)}>
                        <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isConvertingCoins ? 'Convertendo...' : 'Converter'}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de BUFF TEMPORÁRIO */}
      <Modal visible={tempBuffModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTempBuffModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ajuste Temporário: {activeBuffStat}</Text>
            <Text style={{color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 15, fontSize: 13}}>Adicione buffs ou debuffs gerados por feitiços, itens ou fadiga. Ex: +2, -1</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" placeholder="Ex: +2" placeholderTextColor="rgba(255,255,255,0.2)" value={tempBuffValue} onChangeText={setTempBuffValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={clearTempBuff}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Limpar (0)</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting('temp_buff') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting('temp_buff')} onPress={handleTempBuffSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting('temp_buff') ? 'Aplicando...' : 'Aplicar Buff'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Modal de Ações do Item na Mochila */}
      <Modal visible={!!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedBagItem(null)}>
          <View style={styles.actionModalBox}>
            {selectedBagItem && (() => {
              const hydratedSelectedItem = hydrateInventoryItemForEffects(selectedBagItem.item);
              const itemLore = hydratedSelectedItem?.descricao || '';
              const structuredSelectedEffects = parseStructuredEffects(hydratedSelectedItem.effect_json);
              const structuredEffectLabel = summarizeStructuredItemEffects(structuredSelectedEffects);
              const effectHidden = getItemEffectHidden(hydratedSelectedItem);
              const visibleEffectLabel = effectHidden
                ? 'Efeito desconhecido. O efeito será revelado ao consumir.'
                : (structuredEffectLabel || hydratedSelectedItem.damage || 'Efeito nao configurado');
              const p = (hydratedSelectedItem.properties || '').toLowerCase();
              const d = (hydratedSelectedItem.damage || '').toLowerCase();
              const dt = (hydratedSelectedItem.damage_type || '').toLowerCase();
              const n = (hydratedSelectedItem.name || '').toLowerCase();
              const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || structuredSelectedEffects.length > 0 || n.includes('poção') || n.includes('pocao');

              return (
              <>
                <Text style={styles.modalTitle}>{hydratedSelectedItem.name}</Text>
                
                {/* LORE DO ITEM */}
                {itemLore ? (
                  <Text style={{color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 15, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 10}}>
                    {`"${itemLore}"`}
                  </Text>
                ) : (
                  <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 15, fontSize: 12, fontStyle: 'italic'}}>
                    Sem descrição disponível.
                  </Text>
                )}

                {/* STATUS DO ITEM SE NÃO FOR CONSUMÍVEL */}
                <View style={styles.itemStatsBox}>
                  {!isConsumable ? (
                    <>
                      <Text style={styles.itemStatText}>⚔️ Dano/Efeito: <Text style={{color: effectHidden ? '#ffd166' : '#00fa9a'}}>{effectHidden ? 'Efeito desconhecido' : (hydratedSelectedItem.damage || '-')}</Text></Text>
                      <Text style={styles.itemStatText}>🛡️ Propriedades: {selectedBagItem.item.properties || '-'}</Text>
                    </>
                  ) : (
                    <Text style={styles.itemStatText}>🧪 Efeito: <Text style={{color: effectHidden ? '#ffd166' : '#00fa9a'}}>{visibleEffectLabel}</Text></Text>
                  )}
                </View>

                <View style={styles.actionQtyRow}>
                  <TouchableOpacity onPress={() => setActionQty(Math.max(1, actionQty - 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>-</Text></TouchableOpacity>
                  <Text style={styles.actionQtyVal}>{actionQty}</Text>
                  <TouchableOpacity onPress={() => setActionQty(Math.min(selectedBagItem.item.qty, actionQty + 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>+</Text></TouchableOpacity>
                </View>
                <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 20, fontSize: 10}}>Quantidade Selecionada</Text>

                <View style={{gap: 12, width: '100%'}}>
                  {isConsumable && (
                    <TouchableOpacity style={[styles.actionBtnConsume, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                      if (!ensureLanWritable()) return;
                      const {item, index} = selectedBagItem;
                      const qty = actionQty;
                      setSelectedBagItem(null);
                      processConsumeItem(index, item, qty);
                    }}>
                      <Ionicons name="flask" size={20} color="#00fa9a" />
                      <Text style={styles.actionBtnConsumeText}>Consumir</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={[styles.actionBtnThrow, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                    if (!ensureLanWritable()) return;
                    const {item, index} = selectedBagItem;
                    const qty = actionQty;
                    setSelectedBagItem(null);
                    processThrowItem(index, item, qty);
                  }}>
                    <Ionicons name="paper-plane" size={20} color="#ff6666" />
                    <Text style={styles.actionBtnThrowText}>Arremessar</Text>
                  </TouchableOpacity>

                  {lanInfo?.joinUrl && lanPlayers.some(player => !player.isSelf) && (
                    <>
                      <TouchableOpacity style={[styles.tradeActionButton, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setTargetPickerMode('send'); }}>
                        <Ionicons name="send" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Enviar para</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.tradeActionButton, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setTargetPickerMode('trade'); }}>
                        <Ionicons name="swap-horizontal" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Propor troca</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setSelectedBagItem(null)}>
                    <Text style={styles.actionBtnCancelText}>Voltar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )})()}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!targetPickerMode && !!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTargetPickerMode(null)}>
          <View style={styles.tradePanel}>
            <Text style={styles.modalTitle}>{targetPickerMode === 'send' ? 'Enviar para' : 'Propor troca'}</Text>
            <Text style={styles.sessionPartyHint}>
              {selectedBagItem ? `${actionQty}x ${selectedBagItem.item.name}` : ''} - escolha um jogador ativo.
            </Text>

            <FlatList
              data={lanPlayers.filter(player => !player.isSelf)}
              keyExtractor={(player) => player.key}
              style={styles.tradeList}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhum outro jogador ativo na sessao.</Text>}
              renderItem={({ item }) => (
                (() => {
                  const targetActionId = targetPickerMode === 'send' ? `send_item:${item.key}` : `trade_offer:${item.key}`;
                  const isTargetActionPending = isSheetActionSubmitting(targetActionId);
                  return (
                    <TouchableOpacity
                      style={[styles.tradeItemChoice, isTargetActionPending && { opacity: 0.5 }]}
                      disabled={isTargetActionPending}
                      onPress={() => targetPickerMode === 'send' ? handleSendItemToPlayer(item) : handleOfferTradeToPlayer(item)}
                    >
                      <Text style={styles.tradeSlotName}>{item.characterName}</Text>
                      <Text style={styles.tradeSlotMeta}>Nivel {item.level} - HP {item.hpCurrent}/{item.hpMax}{item.tempHp > 0 ? ` +${item.tempHp}` : ''}</Text>
                    </TouchableOpacity>
                  );
                })()
              )}
            />

            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setTargetPickerMode(null)}>
              <Text style={styles.actionBtnCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!selectedTradeOffer} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedTradeOffer(null)}>
          <View style={styles.tradePanel}>
            {selectedTradeOffer && (
              <>
                <Text style={styles.modalTitle}>{selectedTradeOffer.type === 'trade_counter' ? `Resposta de ${selectedTradeOffer.fromName}` : `Troca com ${selectedTradeOffer.fromName}`}</Text>
                <Text style={styles.sessionPartyHint}>{selectedTradeOffer.type === 'trade_counter' ? 'Confira a resposta e aceite para concluir, ou recuse para cancelar.' : 'Escolha um item para oferecer como resposta, ou responda sem contraoferta.'}</Text>

                <View style={styles.tradeBoard}>
                  <View style={styles.tradeColumn}>
                    <Text style={styles.tradeColumnTitle}>{selectedTradeOffer.type === 'trade_counter' ? 'Voce entrega' : 'Ele oferece'}</Text>
                    <View style={[styles.tradeSlot, styles.tradeSlotActive]}>
                      <Text style={styles.tradeSlotName}>{selectedTradeOffer.offeredItem?.name || 'Item'}</Text>
                      <Text style={styles.tradeSlotMeta}>Qtd. {selectedTradeOffer.offeredItem?.qty || 1}</Text>
                    </View>
                  </View>

                  <View style={styles.tradeArrowBox}>
                    <Ionicons name="swap-horizontal" size={22} color="#00bfff" />
                  </View>

                  <View style={styles.tradeColumn}>
                    <Text style={styles.tradeColumnTitle}>{selectedTradeOffer.type === 'trade_counter' ? 'Voce recebe' : 'Sua resposta'}</Text>
                    <View style={[styles.tradeSlot, tradeCounterItem && styles.tradeSlotActive]}>
                      <Text style={styles.tradeSlotName}>{selectedTradeOffer.type === 'trade_counter' ? (selectedTradeOffer.requestedItem?.name || 'Sem item de volta') : (tradeCounterItem?.item?.name || 'Sem contraoferta')}</Text>
                      <Text style={styles.tradeSlotMeta}>{selectedTradeOffer.type === 'trade_counter' ? (selectedTradeOffer.requestedItem ? `Qtd. ${selectedTradeOffer.requestedItem.qty || 1}` : 'Voce nao recebera item de volta') : (tradeCounterItem ? `Qtd. ${tradeCounterQty}` : 'Voce nao enviara item de volta')}</Text>
                    </View>
                    {selectedTradeOffer.type !== 'trade_counter' && tradeCounterItem && (
                      <View style={styles.tradeQtyRow}>
                        <TouchableOpacity onPress={() => setTradeCounterQty(Math.max(1, tradeCounterQty - 1))} style={styles.tradeQtyBtn}><Text style={styles.tradeQtyBtnText}>-</Text></TouchableOpacity>
                        <Text style={styles.tradeQtyVal}>{tradeCounterQty}</Text>
                        <TouchableOpacity onPress={() => setTradeCounterQty(Math.min(tradeCounterItem.item.qty, tradeCounterQty + 1))} style={styles.tradeQtyBtn}><Text style={styles.tradeQtyBtnText}>+</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                {selectedTradeOffer.type !== 'trade_counter' && (
                  <FlatList
                    data={character?.equipment?.bag || []}
                    keyExtractor={(_, index) => index.toString()}
                    style={styles.tradeList}
                    ListEmptyComponent={<Text style={styles.emptyText}>Sua mochila esta vazia.</Text>}
                    renderItem={({ item, index }) => {
                      const active = tradeCounterItem?.index === index;
                      return (
                        <TouchableOpacity
                          style={[styles.tradeItemChoice, active && styles.tradeItemChoiceActive]}
                          onPress={() => {
                            setTradeCounterItem({ item, index });
                            setTradeCounterQty(1);
                          }}
                        >
                          <Text style={styles.tradeSlotName}>{item.name}</Text>
                          <Text style={styles.tradeSlotMeta}>Qtd. {item.qty} - {item.weight || 0}kg</Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}

                <View style={styles.modalRowButtons}>
                  <TouchableOpacity
                    style={[styles.modalBtn, isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`) && { opacity: 0.5 }]}
                    disabled={isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`)}
                    onPress={() => handleDeclineTrade(selectedTradeOffer)}
                  >
                    <Text style={{color:'#ff6666', fontWeight:'bold'}}>{isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`) ? 'Recusando...' : 'Recusar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, {opacity: !isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`) ? 1 : 0.5}]}
                    disabled={isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`)}
                    onPress={handleAcceptTrade}
                  >
                    <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`) ? (selectedTradeOffer.type === 'trade_counter' ? 'Concluindo...' : 'Respondendo...') : (selectedTradeOffer.type === 'trade_counter' ? 'Aceitar troca' : 'Enviar resposta')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={slotModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSlotModalVisible(false)}>
            <View style={[styles.modalContent, {height: '60%'}]}>
                <Text style={styles.modalTitle}>O que deseja equipar?</Text>
                <TouchableOpacity style={styles.unequipBtn} onPress={() => handleEquipItem(null)}><Text style={styles.unequipBtnText}>[ Limpar Espaço ]</Text></TouchableOpacity>
                <FlatList
                    data={character?.equipment?.bag || []}
                    keyExtractor={(i, idx) => idx.toString()}
                    renderItem={({item}) => {
                      const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
                      const itemDamage = item.damage || dbItem?.damage;
                      const itemDamageType = item.damage_type || dbItem?.damage_type;
                      const itemProps = item.properties || dbItem?.properties;
                      
                      let subText = `Peso: ${item.weight}kg`;
                      if (itemDamage && itemDamage !== '-') subText = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''} • ${subText}`;
                      else if (itemProps && itemProps !== '-') subText = `✨ ${itemProps.split(',')[0]} • ${subText}`;

                      return (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => handleEquipItem(item)}>
                            <View style={{flex: 1}}><Text style={styles.catalogItemName}>{item.name}</Text><Text style={styles.catalogItemSub}>{subText}</Text></View>
                            <Text style={styles.addIcon}>›</Text>
                        </TouchableOpacity>
                      )
                    }}
                    ListEmptyComponent={<Text style={styles.emptyText}>Mochila vazia.</Text>}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={itemModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setItemModalVisible(false)}>
            <View style={[styles.modalContent, {height: '75%'}]}>
                <Text style={styles.modalTitle}>Catálogo do Mundo</Text>
                <TextInput style={styles.modalInput} placeholder="Buscar..." placeholderTextColor="#666" value={itemSearch} onChangeText={setItemSearch} />
                <FlatList
                    data={dbItemsCatalog.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()))}
                    keyExtractor={i => i.id.toString()}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => addItemToBag(item)}>
                            <View style={{flex: 1}}>
                              <Text style={styles.catalogItemName}>
                                {item.name} {item.criador === 'proprio' || item.criador === 'importado' ? <Text style={{color: '#00bfff', fontSize: 10}}>[Custom]</Text> : null}
                              </Text>
                              <Text style={styles.catalogItemSub}>{item.weight}kg - Descrição. {item.descricao}</Text>
                            </View>
                            <Text style={styles.addIcon}>+</Text>
                        </TouchableOpacity>
                    )}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={coinModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCoinModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Quantidade de Moedas</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setCoinModalVisible(false)}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(`coin:set:${activeCoinType}`) && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(`coin:set:${activeCoinType}`)} onPress={handleCoinSubmit}>
                <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting(`coin:set:${activeCoinType}`) ? 'Enviando...' : 'Confirmar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={hpModalVisible || xpModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => {setXpModalVisible(false); setHpModalVisible(false);}}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{xpModalVisible ? 'Gerenciar XP' : 'Gerenciar HP'}</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              {!xpModalVisible && (
                <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting('temp_hp') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting('temp_hp')} onPress={handleTempHP}><Text style={{color:'#00bfff', fontWeight:'bold'}}>PV Temp</Text></TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(xpModalVisible ? 'xp:remove' : 'hp:damage') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(xpModalVisible ? 'xp:remove' : 'hp:damage')} onPress={() => xpModalVisible ? handleXP('remove') : handleHP('damage')}><Text style={{color:'#ff6666', fontWeight:'bold'}}>{xpModalVisible ? '- Remover' : '⚔️ Dano'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(xpModalVisible ? 'xp:add' : 'hp:heal') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(xpModalVisible ? 'xp:add' : 'hp:heal')} onPress={() => xpModalVisible ? handleXP('add') : handleHP('heal')}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{xpModalVisible ? '+ Adicionar' : '💖 Cura'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={levelUpModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Nível {newLevelData}</Text>
                <Text style={{color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', marginBottom: 25, marginTop: 10, lineHeight: 22}}>Você ganhou XP suficiente para subir de nível! Deseja atualizar sua ficha agora?</Text>
                <View style={{width: '100%', gap: 15}}>
                  <TouchableOpacity style={styles.lvlUpBtnPrimary} onPress={goToEditScreen}><Text style={styles.lvlUpBtnPrimaryText}>Atualizar Ficha</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.lvlUpBtnSecondary} onPress={() => setLevelUpModalVisible(false)}><Text style={styles.lvlUpBtnSecondaryText}>Mais Tarde</Text></TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

      {/* ================= MODAL DE ALERTAS CUSTOMIZADOS (AÇÕES) ================= */}
      <Modal visible={!!pendingEffectSave} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>Teste de Salvaguarda</Text>
            <Text style={styles.customAlertMessage}>
              {(pendingEffectSave?.sourceEffectName || 'Efeito')} exige {pendingEffectSave?.saveAbility}
              {pendingEffectSave?.dc ? ` CD ${pendingEffectSave.dc}` : ''}.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={saveManualValue}
              onChangeText={setSaveManualValue}
              keyboardType="numeric"
              placeholder="Total final do teste"
              placeholderTextColor="#666"
            />
            <View style={styles.customAlertBtnRow}>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00bfff', borderWidth: 1 }, pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`) && { opacity: 0.5 }]}
                disabled={Boolean(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`))}
                onPress={() => pendingEffectSave && rollVirtualEffectSave(pendingEffectSave)}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00bfff' }]}>Rolar d20</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00fa9a', borderWidth: 1, opacity: parseInt(saveManualValue, 10) > 0 && !(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`)) ? 1 : 0.5 }]}
                disabled={!(parseInt(saveManualValue, 10) > 0) || Boolean(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`))}
                onPress={() => {
                  if (!pendingEffectSave) return;
                  void sendEffectSaveResult(pendingEffectSave, Math.max(1, parseInt(saveManualValue, 10) || 1), 'manual');
                }}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00fa9a' }]}>Enviar manual</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={diceValuePrompt.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>{diceValuePrompt.title}</Text>
            <Text style={styles.customAlertMessage}>{diceValuePrompt.message}</Text>
            <TextInput
              style={styles.modalInput}
              value={diceValuePrompt.manualValue}
              onChangeText={(manualValue) => setDiceValuePrompt((current) => ({ ...current, manualValue }))}
              keyboardType="numeric"
              placeholder="Valor final"
              placeholderTextColor="#666"
            />
            <View style={styles.customAlertBtnRow}>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#ff6666', borderWidth: 1 }]}
                onPress={() => completeDiceValuePrompt(null)}
              >
                <Text style={[styles.customAlertBtnText, { color: '#ff6666' }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00fa9a', borderWidth: 1, opacity: parseInt(diceValuePrompt.manualValue, 10) > 0 ? 1 : 0.5 }]}
                disabled={!(parseInt(diceValuePrompt.manualValue, 10) > 0)}
                onPress={submitManualDiceValuePrompt}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00fa9a' }]}>Usar valor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00bfff', borderWidth: 1 }]}
                onPress={rollDiceValuePromptVirtually}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00bfff' }]}>Dado virtual</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>{customAlert.title}</Text>
            <Text style={styles.customAlertMessage}>{customAlert.message}</Text>
            
            <View style={styles.customAlertBtnRow}>
              {customAlert.buttons.map((btn, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.customAlertBtn, { borderColor: btn.color || '#fff', borderWidth: 1 }]}
                  onPress={() => {
                    // Fecha o modal e então executa a ação, se existir
                    setCustomAlert(prev => ({ ...prev, visible: false }));
                    if (btn.onPress) btn.onPress();
                  }}
                >
                  <Text style={[styles.customAlertBtnText, { color: btn.color || '#fff' }]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
        <DiceRoller3D rollRequest={diceRollRequest} onRollComplete={handleSpellDiceComplete}/>
    </LinearGradient>
  );
}

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getInviteCodeFromPayloadJson(value?: string | null) {
  if (!value) return '';

  try {
    const payload = JSON.parse(value) as LanSessionPayload;
    return String(payload?.session?.inviteCode || '').trim();
  } catch {
    return '';
  }
}

function decodeParam(value?: string) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function markLanEffectForLocalCharacter(effect: any, event?: LanSessionEvent) {
  const id = String(effect?.id || '');
  return {
    ...effect,
    origin: 'lan',
    sessionId: event?.sessionId || effect?.sessionId,
    sourceType: 'lan_session',
    appliedBy: event?.fromKey || effect?.appliedBy || 'master',
    lanEventId: event?.id || effect?.lanEventId,
    lanEffectId: effect?.lanEffectId || id,
  };
}

function parseSpellDuration(duration?: string): { durationRemaining: number; durationUnit: LanEffectUnit } {
  const raw = String(duration || '').toLowerCase();
  const value = Math.max(1, parseInt(raw.match(/\d+/)?.[0] || '1'));

  if (raw.includes('permanent') || raw.includes('permanente')) return { durationRemaining: 0, durationUnit: 'permanent' };
  if (raw.includes('manual')) return { durationRemaining: 0, durationUnit: 'manual' };
  if (raw.includes('concentra') || raw.includes('concentration')) return { durationRemaining: value, durationUnit: 'concentration' };
  if (raw.includes('equip')) return { durationRemaining: 0, durationUnit: 'while_equipped' };
  if (raw.includes('turno') || raw.includes('rodada')) return { durationRemaining: value, durationUnit: 'turn' };
  if (raw.includes('hora')) return { durationRemaining: value, durationUnit: 'hour' };
  if (raw.includes('min')) return { durationRemaining: value, durationUnit: 'minute' };
  return { durationRemaining: 1, durationUnit: 'rest' };
}

function isLanSessionEndedEvent(event: LanSessionEvent) {
  if (event.type === 'session_ended') return true;
  if (event.type !== 'session_patch') return false;
  if (event.sessionPatch?.status === 'ended') return true;
  if (event.sessionEnded?.endedAt || event.sessionEnded?.unlinkPlayers) return true;
  const message = String(event.message || '').toLowerCase();
  return message.includes('encerr') || message.includes('ended') || message.includes('host_closed');
}

type SheetActiveEffect = {
  id?: string;
  name?: string;
  target?: string;
  value?: number | string | null;
  mode?: string | null;
  [key: string]: unknown;
};

const STAT_EFFECT_TARGETS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'] as const;

function isSheetEffectStillActive(effect: SheetActiveEffect | any) {
  if (!effect || effect.active === false) return false;
  const unit = String(effect.unit || '').toLowerCase();
  if (effect.isPermanent === true || unit === 'permanent' || unit === 'manual' || unit === 'while_equipped' || unit === 'concentration') return true;
  return Number(effect.remaining || 0) > 0;
}

function getLanStatEffectBonus(character: any, stat: string): number {
  const normalized = String(stat || '').toUpperCase();
  const effects: SheetActiveEffect[] = Array.isArray(character?.active_effects)
    ? (character.active_effects as SheetActiveEffect[])
    : safeJsonParse<SheetActiveEffect[]>(character?.active_effects_json, []);

  return effects.reduce<number>((sum: number, effect: SheetActiveEffect) => {
    if (!isSheetEffectStillActive(effect)) return sum;
    if (String(effect?.target || '').toUpperCase() !== normalized) return sum;
    const rawValue = Number(effect?.value) || 0;
    if (String(effect?.mode || 'add') === 'set') {
      const base = Number(character?.stats?.[normalized] ?? 10) || 10;
      return sum + (rawValue - base);
    }

    return sum + rawValue;
  }, 0);
}

function summarizeStatEffectBonuses(effects: SheetActiveEffect[] = []): Record<string, number> {
  const result: Record<string, number> = {};

  for (const effect of effects) {
    const target = String(effect?.target || '').toUpperCase();

    if (!isSheetEffectStillActive(effect)) continue;
    if (!STAT_EFFECT_TARGETS.includes(target as (typeof STAT_EFFECT_TARGETS)[number])) continue;
    result[target] = (result[target] || 0) + (Number(effect?.value) || 0);
  }

  return result;
}

function getItemEffectDuration(item: any, effect: any): { text: string; remaining: number; unit: LanEffectUnit; isPermanent?: boolean } {
  const conditionDuration = effect?.condition?.duration || {};
  const durationText = String(effect?.durationText || '').toLowerCase();
  const durationUnit = effect?.durationUnit ?? effect?.duration_unit ?? conditionDuration.unit ?? item?.duration_unit;

  if (durationUnit === 'permanent' || durationText.includes('permanente')) {
    return {
      text: 'Permanente',
      remaining: 0,
      unit: 'permanent',
      isPermanent: true,
    };
  }

  const remaining = Math.max(
    1,
    Number(effect?.durationValue ?? effect?.duration_value ?? conditionDuration.value ?? item?.duration_value ?? 1) || 1
  );
  const unit = normalizeLanEffectUnit(
    durationUnit
  );
  return {
    text: `${remaining} ${unit}`,
    remaining,
    unit,
    isPermanent: unit === 'permanent',
  };
}

function makeLocalItemEffect(
  item: any,
  input: {
    name: string;
    target: string;
    value: number;
    duration: { text: string; remaining: number; unit: LanEffectUnit; isPermanent?: boolean };
    permanent: boolean;
  }
) {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    status: input.permanent ? 'permanent_item_effect' : 'item_effect',
    target: normalizeLanEffectTarget(input.target),
    value: input.value,
    remaining: input.duration.remaining,
    unit: input.duration.unit,
    isPermanent: input.permanent || input.duration.isPermanent || input.duration.unit === 'permanent',
    durationText: input.duration.text,
    color: input.permanent ? '#00fa9a' : '#00bfff',
    secondaryColor: '#8be9fd',
    source: item.name,
    visibleToPlayer: true,
    visualPriority: input.permanent ? 70 : 50,
  };
}

function normalizeLanEffectUnit(value: unknown): LanEffectUnit {
  if (
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
  const raw = String(value || '').toLowerCase();
  if (raw.includes('permanent') || raw.includes('permanente')) return 'permanent';
  if (raw.includes('manual')) return 'manual';
  if (raw.includes('concentra') || raw.includes('concentration')) return 'concentration';
  if (raw.includes('equip')) return 'while_equipped';
  if (raw.includes('turno') || raw.includes('rodada')) return 'turn';
  if (raw.includes('hora')) return 'hour';
  if (raw.includes('min')) return 'minute';
  return 'rest';
}

function normalizeLanEffectTarget(value: unknown): LanEffectTarget {
  const target = String(value || '').toUpperCase();
  if (target === 'FOR' || target === 'DES' || target === 'CON' || target === 'INT' || target === 'SAB' || target === 'CAR' || target === 'CA' || target === 'HP' || target === 'PV_TEMP') {
    return target as LanEffectTarget;
  }
  return 'custom';
}

function summarizeStructuredItemEffects(effects: any[]) {
  if (!effects?.length) return '';

  return effects.map((effect) => {
    const type = String(effect.effectType || effect.type || effect.kind || '').toLowerCase();
    const target = String(effect.target || '').toUpperCase();
    const value = Number(effect.value || 0);
    const condition = effect.condition;
    const duration = String(effect.durationText || effect.durationUnit || '').toLowerCase();
    const suffix = duration ? ` (${effect.durationText || effect.durationUnit})` : '';

    if (effect.chooseStat || target === 'CHOOSE_STAT' || String(effect.effectType || '') === 'Escolher Atributo') {
      return `Escolher atributo ${value >= 0 ? '+' : ''}${value}${suffix}`;
    }

    if (['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'PV_TEMP'].includes(target)) {
      return `${target} ${value >= 0 ? '+' : ''}${value}${suffix}`;
    }

    if (type === 'heal') return `Cura ${value || effect.healDice || effect.dice || ''}`.trim();
    if (condition?.name) return condition.name;
    if (effect.damageType) return `${effect.damageDice || effect.dice || value} ${effect.damageType}`.trim();
    return effect.name || effect.label || 'Efeito configurado';
  }).filter(Boolean).join(' + ');
}


async function ensureItemEffectHiddenColumn(db: any) {
  try {
    await db.execAsync(`ALTER TABLE items ADD COLUMN effect_hidden INTEGER DEFAULT 0;`);
  } catch {
    // Column already exists or the schema is not initialized yet.
  }
}

function toBooleanFlag(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'sim' || normalized === 'yes';
  }
  return false;
}

function getEffectJsonHiddenFlag(value: unknown): boolean {
  if (!value) return false;

  const normalize = (input: unknown, depth = 0): boolean => {
    if (!input || depth > 3) return false;
    if (typeof input === 'string') {
      const raw = input.trim();
      if (!raw || raw === '-' || raw.toLowerCase() === 'null') return false;
      try {
        return normalize(JSON.parse(raw), depth + 1);
      } catch {
        return false;
      }
    }

    if (typeof input === 'object' && !Array.isArray(input)) {
      const obj = input as any;
      if (toBooleanFlag(obj.effectHidden) || toBooleanFlag(obj.hiddenEffect) || toBooleanFlag(obj.effect_hidden)) return true;
      if (obj.meta && normalize(obj.meta, depth + 1)) return true;
      if (obj.effect_json && normalize(obj.effect_json, depth + 1)) return true;
    }

    return false;
  };

  return normalize(value);
}

function getItemEffectHidden(...items: any[]): boolean {
  return items.some((item) => (
    toBooleanFlag(item?.effect_hidden) ||
    toBooleanFlag(item?.effectHidden) ||
    toBooleanFlag(item?.hiddenEffect) ||
    getEffectJsonHiddenFlag(item?.effect_json)
  ));
}

function parseStructuredEffects(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);

  const normalize = (input: unknown): any[] => {
    if (!input) return [];
    if (Array.isArray(input)) return input.filter(Boolean);

    if (typeof input === 'string') {
      const raw = input.trim();
      if (!raw || raw === '-' || raw.toLowerCase() === 'null') return [];
      try {
        return normalize(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    if (typeof input === 'object') {
      const obj = input as any;
      if (Array.isArray(obj.effects)) return normalize(obj.effects);
      if (Array.isArray(obj.effect)) return normalize(obj.effect);
      if (Array.isArray(obj.items)) return normalize(obj.items);
      if (Array.isArray(obj.data)) return normalize(obj.data);
      if (obj.effect_json) return normalize(obj.effect_json);
      if (obj.type || obj.kind || obj.effectType || obj.target || obj.chooseStat || obj.condition) return [obj];
    }

    return [];
  };

  return normalize(value);
}

function getDiceParts(expression: string) {
  const tokens = expression.match(/(?:\d*)d\d+/gi) || [];
  return tokens.map((token) => {
    const [countRaw, sidesRaw] = token.toLowerCase().split('d');
    return {
      count: Math.max(1, parseInt(countRaw || '1') || 1),
      sides: Math.max(1, parseInt(sidesRaw) || 1),
    };
  }).filter((entry) => [4, 6, 8, 10, 12, 20, 100].includes(entry.sides));
}

function getPublicEffectName(effect: any): string {
  const raw = String(effect?.name || effect?.status || effect?.statusKey || 'Efeito').trim();
  return raw || 'Efeito';
}

function summarizeEffectsForPublicRoster(effects: unknown[]): any[] {
  if (!Array.isArray(effects)) return [];
  const byKey = new Map<string, any>();
  for (const raw of effects) {
    const effect = raw && typeof raw === 'object' ? raw as any : {};
    if (effect.visibleToPlayer === false || effect.active === false) continue;
    const id = String(effect.id || effect.lanEffectId || effect.statusKey || `${effect.name || effect.status || 'Efeito'}:${effect.target || ''}:${effect.value || ''}`);
    if (!id) continue;
    byKey.set(id, {
      id,
      name: getPublicEffectName(effect),
      status: effect.status,
      statusKey: effect.statusKey,
      target: effect.target,
      value: effect.value,
      kind: effect.kind,
      remaining: effect.remaining,
      unit: effect.unit,
      color: effect.color,
      secondaryColor: effect.secondaryColor,
      publicNote: effect.publicNote,
    });
  }
  return Array.from(byKey.values());
}

function formatPublicEffectSummary(effects: unknown[] | undefined, limit = 2) {
  const list = summarizeEffectsForPublicRoster(effects || []);
  const names = list.map(getPublicEffectName).filter(Boolean);
  const shown = names.slice(0, Math.max(1, limit));
  const hidden = Math.max(0, names.length - shown.length);
  return {
    total: names.length,
    hasMore: hidden > 0,
    text: hidden > 0 ? `${shown.join(', ')}...` : shown.join(', '),
  };
}

function summarizePublicEffectDetail(effect: any): string {
  const parts: string[] = [];
  const target = String(effect?.target || '').trim();
  const value = Number(effect?.value || 0);
  if (target && target !== 'custom') parts.push(`${target}${value ? ` ${value > 0 ? '+' : ''}${value}` : ''}`);
  if (Number.isFinite(Number(effect?.remaining)) && Number(effect.remaining) > 0) {
    parts.push(`${effect.remaining} ${effect.unit || 'turn'}`);
  }
  if (effect?.publicNote) parts.push(String(effect.publicNote));
  return parts.join(' • ') || 'Efeito público ativo';
}
