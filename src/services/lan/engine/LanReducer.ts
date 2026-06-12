import {
  advanceEffectsByUnit,
  applyEffectStack,
  calculateEffectiveStats,
  isPermanentStatAdjustment,
  normalizeDomainEffect,
  removeEffects,
  type LanDomainActiveEffect,
} from './LanEffectRules';
import { buildStatsWithDerivedEquipMods, compactInventoryBag, getInventoryStackKey, normalizeInventoryState, type InventoryItemState, type InventoryState } from './LanInventoryRules';
import { getAggregateVersion, setAggregateVersion, shouldApplyLanSnapshot } from './LanSnapshotPolicy';
import {
  emptyVersions,
  type CharacterProjection,
  type EffectPatch,
  type InventoryPatch,
  type LanAuthoritativeEvent,
  type LanSnapshot,
  type LanPendingSaveProjection,
  type LanTradeProjection,
  type PlayerPatch,
  type SessionProjection,
} from './LanTypes';

type LegacyPlayerState = Record<string, any> & {
  id?: number;
  remoteKey?: string;
  playerName?: string;
  characterId?: number | null;
  sourceCharacterId?: number | null;
  characterName?: string;
  level?: number;
  className?: string;
  race?: string;
  hpCurrent?: number;
  hpMax?: number;
  tempHp?: number;
  xp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
  stats?: Record<string, unknown>;
  equipment?: unknown;
  effects?: any[];
  playerRevisionSeq?: number;
  effectRevisionSeq?: number;
  inventoryRevisionSeq?: number;
};

export function createEmptySessionProjection(sessionId: string): SessionProjection {
  return {
    sessionId,
    status: 'active',
    currentTurn: 1,
    elapsedMinutes: 0,
    players: {},
    pendingSaves: {},
    trades: {},
    versions: emptyVersions(),
    tombstones: {
      removedEffectIds: {},
      removedItemInstanceIds: {},
      endedSessionIds: new Set<string>(),
    },
    appliedEventIds: new Set<string>(),
    appliedCommandIds: new Set<string>(),
    serverSeq: 0,
  };
}

export function createSessionProjectionFromState(
  sessionId: string,
  state?: {
    status?: 'active' | 'paused' | 'ended';
    currentTurn?: number;
    elapsedMinutes?: number;
    players?: LegacyPlayerState[];
  } | null,
): SessionProjection {
  const projection = createEmptySessionProjection(sessionId);
  projection.status = state?.status || 'active';
  projection.currentTurn = Math.max(1, Math.floor(Number(state?.currentTurn || 1) || 1));
  projection.elapsedMinutes = Math.max(0, Math.floor(Number(state?.elapsedMinutes || 0) || 0));

  for (const player of state?.players || []) {
    const key = getPlayerKey(sessionId, player);
    projection.players[key] = characterProjectionFromLanPlayer(sessionId, player);
    projection.versions.players[key] = Math.max(0, Math.floor(Number(player.playerRevisionSeq || 0) || 0));
    projection.versions.effects[key] = Math.max(0, Math.floor(Number(player.effectRevisionSeq || 0) || 0));
    projection.versions.inventories[key] = Math.max(0, Math.floor(Number(player.inventoryRevisionSeq || 0) || 0));
  }

  return projection;
}

export function applyLanAuthoritativeEvent(
  projection: SessionProjection,
  event: LanAuthoritativeEvent,
) {
  if (isVisualOrTransportOnlyEvent(event.type)) {
    return { projection, applied: false, reason: 'ignored_non_gameplay_event' };
  }
  if (!event.eventId) return { projection, applied: false, reason: 'missing_event_id' };
  if (event.sessionId !== projection.sessionId) return { projection, applied: false, reason: 'wrong_session' };
  if (projection.appliedEventIds.has(event.eventId)) return { projection, applied: false, reason: 'duplicate_event' };
  if (event.commandId && projection.appliedCommandIds.has(event.commandId)) {
    return { projection, applied: false, reason: 'duplicate_command' };
  }
  if (projection.tombstones.endedSessionIds.has(event.sessionId) && event.type !== 'session_ended') {
    return { projection, applied: false, reason: 'session_ended' };
  }

  const incomingRevision = Math.max(0, Math.floor(Number(event.aggregateRevision || 0) || 0));
  const currentRevision = getAggregateVersion(projection, event.aggregateType, event.aggregateId);
  if (incomingRevision > 0 && incomingRevision <= currentRevision) {
    return { projection, applied: false, reason: 'old_revision' };
  }

  const next = cloneProjection(projection);
  next.appliedEventIds.add(event.eventId);
  if (event.commandId) next.appliedCommandIds.add(event.commandId);
  next.serverSeq = Math.max(next.serverSeq, Math.max(0, Math.floor(Number(event.serverSeq || 0) || 0)));
  setAggregateVersion(next, event.aggregateType, event.aggregateId, incomingRevision);

  applyEventPayload(next, event);
  return { projection: next, applied: true, reason: 'applied' };
}

function isVisualOrTransportOnlyEvent(type: string) {
  return [
    'public_status',
    'event_ack',
    'event_nack',
    'ack',
    'nack',
  ].includes(String(type || ''));
}

export function applyLanSnapshot(projection: SessionProjection | null, snapshot: LanSnapshot) {
  if (!shouldApplyLanSnapshot(projection, snapshot)) {
    return { projection, applied: false, reason: 'ignored_snapshot' };
  }

  const base = projection ? cloneProjection(projection) : createEmptySessionProjection(snapshot.sessionId);
  const incoming = snapshot.projection ? cloneProjection(snapshot.projection) : createSessionProjectionFromState(snapshot.sessionId, snapshot.state);

  base.status = mergeSessionStatus(base, incoming);
  base.currentTurn = Math.max(base.currentTurn, incoming.currentTurn);
  base.elapsedMinutes = Math.max(base.elapsedMinutes, incoming.elapsedMinutes);
  base.serverSeq = Math.max(base.serverSeq, Math.max(0, Math.floor(Number(snapshot.serverSeq || 0) || 0)));
  base.versions.session = Math.max(base.versions.session, snapshot.versions?.session || incoming.versions.session || 0);

  mergeTombstones(base, snapshot);

  for (const [playerKey, incomingPlayer] of Object.entries(incoming.players)) {
    const currentPlayer = base.players[playerKey];
    const incomingPlayerRevision = snapshot.versions?.players?.[playerKey] ?? incoming.versions.players[playerKey] ?? 0;
    const incomingInventoryRevision = snapshot.versions?.inventories?.[playerKey] ?? incoming.versions.inventories[playerKey] ?? 0;
    const incomingEffectRevision = snapshot.versions?.effects?.[playerKey] ?? incoming.versions.effects[playerKey] ?? 0;

    if (!currentPlayer) {
      base.players[playerKey] = stripTombstonedState(base, playerKey, incomingPlayer);
      base.versions.players[playerKey] = Math.max(base.versions.players[playerKey] || 0, incomingPlayerRevision);
      base.versions.inventories[playerKey] = Math.max(base.versions.inventories[playerKey] || 0, incomingInventoryRevision);
      base.versions.effects[playerKey] = Math.max(base.versions.effects[playerKey] || 0, incomingEffectRevision);
      continue;
    }

    const nextPlayer = { ...currentPlayer };
    if (incomingPlayerRevision > (base.versions.players[playerKey] || 0)) {
      Object.assign(nextPlayer, {
        hpCurrent: incomingPlayer.hpCurrent,
        hpMax: incomingPlayer.hpMax,
        tempHp: incomingPlayer.tempHp,
        xp: incomingPlayer.xp,
        coins: incomingPlayer.coins,
        baseStats: incomingPlayer.baseStats,
      });
      base.versions.players[playerKey] = incomingPlayerRevision;
    }
    if (incomingInventoryRevision > (base.versions.inventories[playerKey] || 0)) {
      nextPlayer.inventory = incomingPlayer.inventory;
      nextPlayer.equipment = incomingPlayer.equipment;
      base.versions.inventories[playerKey] = incomingInventoryRevision;
    }
    if (incomingEffectRevision > (base.versions.effects[playerKey] || 0)) {
      nextPlayer.activeEffects = incomingPlayer.activeEffects;
      base.versions.effects[playerKey] = incomingEffectRevision;
    }
    base.players[playerKey] = recalculateProjection(stripTombstonedState(base, playerKey, nextPlayer));
  }

  return { projection: base, applied: true, reason: 'applied' };
}

function applyEventPayload(projection: SessionProjection, event: LanAuthoritativeEvent) {
  if (event.type === 'session_ended') {
    projection.status = 'ended';
    projection.tombstones.endedSessionIds.add(event.sessionId);
    return;
  }

  if (event.type === 'session_patch') {
    const payload = event.payload as Record<string, any>;
    if (payload.status) projection.status = payload.status;
    if (payload.currentTurn != null) projection.currentTurn = Math.max(projection.currentTurn, Number(payload.currentTurn) || 1);
    if (payload.elapsedMinutes != null) projection.elapsedMinutes = Math.max(projection.elapsedMinutes, Number(payload.elapsedMinutes) || 0);
    for (const [targetKey, effects] of Object.entries(payload.updatedEffectsByTarget || {})) {
      applyEffectPatch(projection, targetKey, { targetKey, update: effects as LanDomainActiveEffect[] });
    }
    applyExpiredEffects(projection, payload.expiredByTarget || {});
    for (const [targetKey, tempHp] of Object.entries(payload.tempHpByTarget || {})) {
      applyPlayerPatch(projection, targetKey, { tempHp: Number(tempHp) || 0 });
    }
    return;
  }

  if (event.type === 'player_patch') {
    const payload = event.payload as { targetKey?: string; patch?: PlayerPatch };
    applyPlayerPatch(projection, payload.targetKey || event.aggregateId, payload.patch || {});
    return;
  }

  if (event.type === 'inventory_patch') {
    const payload = event.payload as InventoryPatch;
    applyInventoryPatch(projection, payload.targetKey || event.aggregateId, payload);
    return;
  }

  if (event.type === 'effect_patch') {
    const payload = event.payload as EffectPatch & { numberPatch?: PlayerPatch };
    applyEffectPatch(projection, payload.targetKey || event.aggregateId, payload, payload.numberPatch);
    return;
  }

  if (['character_transaction', 'party_transaction', 'spell_transaction', 'reward_transaction'].includes(event.type)) {
    const payload = event.payload as {
      targetKey?: string;
      changes?: { player?: PlayerPatch; inventory?: InventoryPatch; effects?: EffectPatch; pendingSave?: any; trade?: LanTradeProjection };
      changesByTarget?: Record<string, { player?: PlayerPatch; inventory?: InventoryPatch; effects?: EffectPatch }>;
      pendingSave?: any;
      trade?: LanTradeProjection;
    };
    const targetKey = payload.targetKey || event.aggregateId;
    if (payload.changes?.player) applyPlayerPatch(projection, targetKey, payload.changes.player);
    if (payload.changes?.inventory) applyInventoryPatch(projection, targetKey, payload.changes.inventory);
    if (payload.changes?.effects) applyEffectPatch(projection, targetKey, payload.changes.effects);
    for (const [key, changes] of Object.entries(payload.changesByTarget || {})) {
      if (changes.player) applyPlayerPatch(projection, key, changes.player);
      if (changes.inventory) applyInventoryPatch(projection, key, changes.inventory);
      if (changes.effects) applyEffectPatch(projection, key, changes.effects);
    }
    if (payload.changes?.pendingSave) applyPendingSavePatch(projection, payload.changes.pendingSave);
    if (payload.pendingSave) applyPendingSavePatch(projection, payload.pendingSave);
    if (payload.changes?.trade) projection.trades[payload.changes.trade.id] = payload.changes.trade;
    if (payload.trade) projection.trades[payload.trade.id] = payload.trade;
    return;
  }

  if (event.type === 'pending_save_patch') {
    applyPendingSavePatch(projection, event.payload as any);
    return;
  }

  if (event.type === 'trade_patch') {
    const trade = event.payload as LanTradeProjection;
    if (trade?.id) projection.trades[trade.id] = trade;
  }
}

function applyPlayerPatch(projection: SessionProjection, targetKey: string, patch: PlayerPatch) {
  const player = projection.players[targetKey];
  if (!player) return;
  projection.players[targetKey] = recalculateProjection({
    ...player,
    hpCurrent: patch.hpCurrent ?? player.hpCurrent,
    hpMax: patch.hpMax ?? player.hpMax,
    tempHp: patch.tempHp ?? player.tempHp,
    xp: patch.xp ?? player.xp,
    coins: {
      gp: patch.gp ?? player.coins.gp,
      sp: patch.sp ?? player.coins.sp,
      cp: patch.cp ?? player.coins.cp,
    },
  });
}

function applyInventoryPatch(projection: SessionProjection, targetKey: string, patch: InventoryPatch) {
  const player = projection.players[targetKey];
  if (!player) return;
  const hasExplicitEquipment = Boolean(patch.equipment);
  let equipment = hasExplicitEquipment ? normalizeInventoryState(patch.equipment) : player.inventory;
  if (!hasExplicitEquipment && patch.itemDelta) equipment = applyInventoryDelta(equipment, patch.itemDelta);
  projection.players[targetKey] = recalculateProjection({
    ...player,
    inventory: equipment,
    equipment,
    baseStats: normalizeStats(patch.stats || player.baseStats),
  });
  if (patch.itemDelta?.mode === 'remove' && patch.itemDelta.removed === true && patch.itemDelta.stackKey) {
    markRemovedItem(projection, targetKey, patch.itemDelta.stackKey);
  }
}

function applyPendingSavePatch(projection: SessionProjection, patch: { action?: string; save?: LanPendingSaveProjection; id?: string; result?: Record<string, unknown> }) {
  if (patch.action === 'create' && patch.save?.id) {
    projection.pendingSaves[patch.save.id] = { ...patch.save, status: patch.save.status || 'pending' };
    return;
  }
  if (patch.action === 'resolve' && patch.id) {
    const current = projection.pendingSaves[patch.id];
    projection.pendingSaves[patch.id] = {
      ...(current || { id: patch.id, sessionId: projection.sessionId, targetKey: '', ability: '', status: 'resolved' as const }),
      status: normalizeSaveResolutionStatus(patch.result),
      result: { ...(current?.result || {}), ...(patch.result || {}) },
      resolvedAt: String((patch.result as any)?.resolvedAt || new Date(0).toISOString()),
    };
  }
}

function normalizeSaveResolutionStatus(result?: Record<string, unknown>): LanPendingSaveProjection['status'] {
  const explicit = String(result?.status || '').toLowerCase();
  if (['success', 'failure', 'ignored', 'resolved'].includes(explicit)) return explicit as LanPendingSaveProjection['status'];
  if (typeof result?.passed === 'boolean') return result.passed ? 'success' : 'failure';
  return 'resolved';
}

function applyInventoryDelta(equipment: InventoryState, delta: NonNullable<InventoryPatch['itemDelta']>): InventoryState {
  const mode = String(delta.mode || '').toLowerCase();
  const item = delta.item ? { ...delta.item } as InventoryItemState : undefined;
  const qty = Math.max(1, Math.floor(Number(delta.qty ?? item?.qty ?? 1) || 1));
  if (!item && !delta.stackKey) return equipment;
  if (mode === 'add' && item) return { ...equipment, bag: compactInventoryBag([...equipment.bag, { ...item, qty }]) };
  if (mode === 'remove') {
    const key = String(delta.stackKey || (item ? getInventoryStackKey(item) : ''));
    const bag = equipment.bag.map((entry) => {
      const matches = getInventoryStackKey(entry) === key || String(entry.id || '') === key || String(entry.inventoryItemId || entry.inventory_item_id || '') === key;
      if (!matches) return entry;
      return { ...entry, qty: Math.max(0, Number(entry.qty || 0) - qty) };
    }).filter((entry) => Math.max(0, Number(entry.qty || 0) || 0) > 0);
    return { ...equipment, bag: compactInventoryBag(bag) };
  }
  return equipment;
}

function applyEffectPatch(projection: SessionProjection, targetKey: string, patch: EffectPatch, numberPatch?: PlayerPatch) {
  const player = projection.players[targetKey];
  if (!player) return;
  const removed = new Set((patch.remove || []).map(String).filter(Boolean));
  let effects = player.activeEffects;
  let baseStats = { ...player.baseStats };
  let hpMax = player.hpMax;
  let hpCurrent = player.hpCurrent;
  if (removed.size > 0) {
    effects = removeEffects(effects, Array.from(removed));
    for (const id of removed) markRemovedEffect(projection, targetKey, id);
  }
  for (const raw of patch.update || []) {
    const normalized = normalizeDomainEffect(raw, { targetKey });
    if (isEffectTombstoned(projection, targetKey, normalized.effectId)) continue;
    effects = effects.map((effect) => effect.effectId === normalized.effectId ? normalized : effect);
  }
  for (const raw of patch.add || []) {
    const normalized = normalizeDomainEffect(raw, { targetKey });
    if (isPermanentStatAdjustment(normalized)) {
      const target = String(normalized.target || '').toUpperCase();
      const beforeValue = Math.floor(Number(baseStats[target] ?? (target === 'CA' ? 10 : 10)) || 10);
      const nextValue = normalized.mode === 'set'
        ? Math.floor(Number(normalized.value || beforeValue) || beforeValue)
        : beforeValue + Math.floor(Number(normalized.value || 0) || 0);
      baseStats[target] = Math.max(0, nextValue);
      if (target === 'CON') {
        const beforeMod = Math.floor((beforeValue - 10) / 2);
        const afterMod = Math.floor((baseStats[target] - 10) / 2);
        const hpDelta = (afterMod - beforeMod) * Math.max(1, Number(player.level || 1));
        if (hpDelta !== 0) {
          hpMax = Math.max(1, hpMax + hpDelta);
          hpCurrent = Math.max(0, hpCurrent + hpDelta);
        }
      }
      continue;
    }
    if (isEffectTombstoned(projection, targetKey, normalized.effectId)) continue;
    effects = applyEffectStack(effects, normalized);
  }
  projection.players[targetKey] = recalculateProjection({
    ...player,
    hpCurrent: numberPatch?.hpCurrent ?? hpCurrent,
    hpMax: numberPatch?.hpMax ?? hpMax,
    tempHp: numberPatch?.tempHp ?? player.tempHp,
    baseStats,
    activeEffects: effects,
  });
}

function applyExpiredEffects(projection: SessionProjection, expiredByTarget: Record<string, string[]>) {
  for (const [targetKey, effectIds] of Object.entries(expiredByTarget)) {
    applyEffectPatch(projection, targetKey, { targetKey, remove: effectIds });
  }
}

export function advanceProjectionTurn(projection: SessionProjection, unit: import('./LanEffectRules').LanAdvanceUnit) {
  const next = cloneProjection(projection);
  next.currentTurn += unit === 'turn' ? 1 : 0;
  if (unit === 'minute') next.elapsedMinutes += 1;
  if (unit === 'hour') next.elapsedMinutes += 60;
  if (unit === 'shortRest') next.elapsedMinutes += 60;
  if (unit === 'longRest') next.elapsedMinutes += 480;

  const expiredByTarget: Record<string, string[]> = {};
  const updatedEffectsByTarget: Record<string, LanDomainActiveEffect[]> = {};
  const tempHpByTarget: Record<string, number> = {};
  for (const [playerKey, player] of Object.entries(next.players)) {
    const advanced = advanceEffectsByUnit(player.activeEffects, unit);
    const changedActive = advanced.activeEffects.filter((effect) => {
      const previous = player.activeEffects.find((entry) => entry.effectId === effect.effectId);
      return previous && previous.remaining !== effect.remaining;
    });
    if (changedActive.length > 0) updatedEffectsByTarget[playerKey] = changedActive;
    if (advanced.expiredEffects.length > 0) {
      expiredByTarget[playerKey] = advanced.expiredEffects.map((effect) => effect.effectId);
      for (const effect of advanced.expiredEffects) markRemovedEffect(next, playerKey, effect.effectId);
    }
    next.players[playerKey] = recalculateProjection({
      ...player,
      tempHp: advanced.removedTempHp > 0 ? 0 : player.tempHp,
      activeEffects: advanced.activeEffects,
    });
    if (advanced.removedTempHp > 0) tempHpByTarget[playerKey] = 0;
  }

  return { projection: next, expiredByTarget, updatedEffectsByTarget, tempHpByTarget };
}

export function cloneProjection(projection: SessionProjection): SessionProjection {
  return {
    ...projection,
    players: Object.fromEntries(Object.entries(projection.players).map(([key, player]) => [key, cloneCharacter(player)])),
    pendingSaves: Object.fromEntries(Object.entries(projection.pendingSaves || {}).map(([key, save]) => [key, { ...save, effectPayload: save.effectPayload ? { ...save.effectPayload } : undefined, result: save.result ? { ...save.result } : undefined }])),
    trades: Object.fromEntries(Object.entries(projection.trades || {}).map(([key, trade]) => [key, { ...trade }])),
    versions: {
      session: projection.versions.session,
      players: { ...projection.versions.players },
      inventories: { ...projection.versions.inventories },
      effects: { ...projection.versions.effects },
      pendingSaves: { ...projection.versions.pendingSaves },
      trades: { ...projection.versions.trades },
    },
    tombstones: {
      removedEffectIds: cloneSetRecord(projection.tombstones.removedEffectIds),
      removedItemInstanceIds: cloneSetRecord(projection.tombstones.removedItemInstanceIds),
      endedSessionIds: new Set(projection.tombstones.endedSessionIds),
    },
    appliedEventIds: new Set(projection.appliedEventIds),
    appliedCommandIds: new Set(projection.appliedCommandIds),
  };
}

export function recalculateProjection(character: CharacterProjection): CharacterProjection {
  const statsWithEquipment = applyEquipModsToStats(buildStatsWithDerivedEquipMods(character.baseStats, character.inventory));
  const effectiveStats = calculateEffectiveStats(statsWithEquipment, character.activeEffects);
  return {
    ...character,
    hpCurrent: Math.max(0, Math.min(Math.max(0, character.hpMax), Math.floor(Number(character.hpCurrent || 0)))),
    hpMax: Math.max(0, Math.floor(Number(character.hpMax || 0))),
    tempHp: Math.max(0, Math.floor(Number(character.tempHp || 0))),
    effectiveStats,
    derived: {
      ...character.derived,
      acBonus: Number(effectiveStats.CA || 0) - Number(character.baseStats.CA || 0),
      ca: Number(effectiveStats.CA || character.baseStats.CA || 10),
      activeEffectCount: character.activeEffects.length,
    },
  };
}

function applyEquipModsToStats(stats: Record<string, any>): Record<string, number> {
  const next = normalizeStats(stats);
  const equipMods = stats?.equip_mods && typeof stats.equip_mods === 'object'
    ? stats.equip_mods as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(equipMods)) {
    const attr = key.toUpperCase();
    if (attr in next) next[attr] = Math.max(0, Number(next[attr] || 0) + Math.floor(Number(value || 0) || 0));
  }
  return next;
}

export function characterProjectionFromLanPlayer(sessionId: string, player: LegacyPlayerState): CharacterProjection {
  const playerKey = getPlayerKey(sessionId, player);
  const baseStats = normalizeStats(player.stats || {});
  const equipment = normalizeInventoryState(player.equipment);
  const activeEffects = (player.effects || [])
    .map((effect) => normalizeDomainEffect(effect, { targetKey: playerKey }))
    .filter((effect) => effect.status === 'active');
  return recalculateProjection({
    playerKey,
    characterId: Number(player.characterId ?? player.sourceCharacterId ?? player.id) || undefined,
    name: player.characterName || player.playerName || 'Personagem',
    level: Math.max(1, Math.floor(Number(player.level || 1) || 1)),
    className: player.className || '',
    race: player.race || '',
    hpCurrent: Math.max(0, Number(player.hpCurrent || 0) || 0),
    hpMax: Math.max(0, Number(player.hpMax || 0) || 0),
    tempHp: Math.max(0, Number(player.tempHp || 0) || 0),
    xp: Math.max(0, Number(player.xp || 0) || 0),
    coins: {
      gp: Math.max(0, Number(player.gp || 0) || 0),
      sp: Math.max(0, Number(player.sp || 0) || 0),
      cp: Math.max(0, Number(player.cp || 0) || 0),
    },
    baseStats,
    effectiveStats: baseStats,
    inventory: equipment,
    equipment,
    activeEffects,
    derived: {},
  });
}

function mergeSessionStatus(current: SessionProjection, incoming: SessionProjection) {
  if (current.status === 'ended') return 'ended';
  if (incoming.status === 'ended') return 'ended';
  return incoming.status || current.status;
}

function mergeTombstones(projection: SessionProjection, snapshot: LanSnapshot) {
  for (const sessionId of snapshot.tombstones?.endedSessionIds || []) projection.tombstones.endedSessionIds.add(sessionId);
  for (const [key, ids] of Object.entries(snapshot.tombstones?.removedEffectIds || {})) {
    for (const id of ids) markRemovedEffect(projection, key, id);
  }
  for (const [key, ids] of Object.entries(snapshot.tombstones?.removedItemInstanceIds || {})) {
    for (const id of ids) markRemovedItem(projection, key, id);
  }
}

function stripTombstonedState(projection: SessionProjection, playerKey: string, player: CharacterProjection) {
  const removedEffects = projection.tombstones.removedEffectIds[playerKey] || new Set<string>();
  const removedItems = projection.tombstones.removedItemInstanceIds[playerKey] || new Set<string>();
  const equipment: InventoryState = {
    bag: player.inventory.bag.filter((item) => (
      !removedItems.has(String(item.id || item.inventoryItemId || item.inventory_item_id || '')) &&
      !removedItems.has(getInventoryStackKey(item))
    )),
    slots: { ...player.inventory.slots },
  };
  return {
    ...player,
    inventory: equipment,
    equipment,
    activeEffects: player.activeEffects.filter((effect) => !removedEffects.has(effect.effectId) && !removedEffects.has(effect.sourceId)),
  };
}

function markRemovedEffect(projection: SessionProjection, targetKey: string, effectId: string) {
  if (!targetKey || !effectId) return;
  projection.tombstones.removedEffectIds[targetKey] ||= new Set<string>();
  projection.tombstones.removedEffectIds[targetKey].add(effectId);
}

function markRemovedItem(projection: SessionProjection, targetKey: string, itemId: string) {
  if (!targetKey || !itemId) return;
  projection.tombstones.removedItemInstanceIds[targetKey] ||= new Set<string>();
  projection.tombstones.removedItemInstanceIds[targetKey].add(itemId);
}

function isEffectTombstoned(projection: SessionProjection, targetKey: string, effectId: string) {
  return Boolean(projection.tombstones.removedEffectIds[targetKey]?.has(effectId));
}

function getPlayerKey(sessionId: string, player: LegacyPlayerState) {
  return player.remoteKey || `${sessionId}:${player.sourceCharacterId || player.characterId || player.id}:${player.characterName || player.playerName || 'player'}`;
}

function cloneCharacter(player: CharacterProjection): CharacterProjection {
  return {
    ...player,
    coins: { ...player.coins },
    baseStats: { ...player.baseStats },
    effectiveStats: { ...player.effectiveStats },
    inventory: {
      bag: player.inventory.bag.map((item) => ({ ...item })),
      slots: Object.fromEntries(Object.entries(player.inventory.slots).map(([slot, item]) => [slot, item ? { ...item } : null])),
    },
    equipment: {
      bag: player.equipment.bag.map((item) => ({ ...item })),
      slots: Object.fromEntries(Object.entries(player.equipment.slots).map(([slot, item]) => [slot, item ? { ...item } : null])),
    },
    activeEffects: player.activeEffects.map((effect) => ({ ...effect })),
    derived: { ...player.derived },
  };
}

function cloneSetRecord(record: Record<string, Set<string>>) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, new Set(value)]));
}

function normalizeStats(stats: Record<string, unknown>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA']) {
    next[key] = Math.floor(Number(stats?.[key] ?? (key === 'CA' ? 10 : 10)) || 10);
  }
  return next;
}
