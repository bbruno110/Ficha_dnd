import { calculateEffectiveStats, normalizeDomainEffect, type LanDomainActiveEffect } from './lanEffectDomain';
import { normalizeInventoryState, type InventoryState } from './lanInventoryDomain';

type LanProjectionEvent = Record<string, any> & {
  id: string;
  sessionId: string;
  type: string;
  fromKey?: string;
  toKey?: string;
  seq?: number;
  serverSeq?: number;
  entityRevision?: number;
};

type LanProjectionPlayerState = Record<string, any> & {
  id: number;
  remoteKey?: string;
  playerName?: string;
  characterId?: number | null;
  sourceCharacterId?: number | null;
  characterName?: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  xp: number;
  gp: number;
  sp: number;
  cp: number;
  stats: Record<string, unknown>;
  equipment: Record<string, unknown>;
  effects?: any[];
  revisionSeq?: number;
};

type LanProjectionSessionState = {
  status: 'active' | 'paused' | 'ended';
  currentTurn: number;
  elapsedMinutes: number;
  players: LanProjectionPlayerState[];
};

export type LanEntityRevisions = {
  playerRevision: number;
  effectRevision: number;
  inventoryRevision: number;
  sessionRevision: number;
  pendingSaveRevision: number;
  tradeRevision: number;
};

export type CharacterProjection = {
  playerKey: string;
  characterId?: number;
  name: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  xp: number;
  coins: {
    gp: number;
    sp: number;
    cp: number;
  };
  baseStats: Record<string, number>;
  effectiveStats: Record<string, number>;
  inventory: InventoryState;
  equipment: InventoryState;
  activeEffects: LanDomainActiveEffect[];
  derived: Record<string, unknown>;
};

export type SessionProjection = {
  sessionId: string;
  status: 'active' | 'paused' | 'ended';
  currentTurn: number;
  elapsedMinutes: number;
  players: Record<string, CharacterProjection>;
  revisions: Record<string, LanEntityRevisions>;
  appliedEventIds: Set<string>;
};

export type ProjectionApplyResult = {
  projection: SessionProjection;
  applied: boolean;
  reason: 'applied' | 'duplicate_event' | 'old_revision' | 'ignored_snapshot';
};

const ZERO_REVISIONS: LanEntityRevisions = {
  playerRevision: 0,
  effectRevision: 0,
  inventoryRevision: 0,
  sessionRevision: 0,
  pendingSaveRevision: 0,
  tradeRevision: 0,
};

export function createSessionProjection(sessionId: string, state?: LanProjectionSessionState | null): SessionProjection {
  const projection: SessionProjection = {
    sessionId,
    status: state?.status || 'active',
    currentTurn: Math.max(1, Number(state?.currentTurn || 1) || 1),
    elapsedMinutes: Math.max(0, Number(state?.elapsedMinutes || 0) || 0),
    players: {},
    revisions: {},
    appliedEventIds: new Set<string>(),
  };

  for (const player of state?.players || []) {
    const key = getProjectionPlayerKey(sessionId, player);
    projection.players[key] = characterProjectionFromLanPlayer(sessionId, player);
    projection.revisions[key] = {
      ...ZERO_REVISIONS,
      playerRevision: cleanRevision(player.revisionSeq),
      effectRevision: cleanRevision(player.revisionSeq),
      inventoryRevision: cleanRevision(player.revisionSeq),
    };
  }
  projection.revisions[sessionRevisionKey(sessionId)] = {
    ...ZERO_REVISIONS,
    sessionRevision: Math.max(Number(state?.currentTurn || 0), Number(state?.elapsedMinutes || 0)),
  };
  return projection;
}

export function applyEventToProjection(projection: SessionProjection, event: LanProjectionEvent): ProjectionApplyResult {
  if (!event?.id) return { projection, applied: false, reason: 'old_revision' };
  if (projection.appliedEventIds.has(event.id)) {
    return { projection, applied: false, reason: 'duplicate_event' };
  }

  const domain = getEventDomain(event);
  const entityKey = getProjectionEntityKey(projection.sessionId, event, domain);
  const revision = cleanRevision(event.entityRevision ?? event.serverSeq ?? event.seq);
  if (!shouldAcceptRevision(projection, entityKey, domain, revision)) {
    return { projection, applied: false, reason: 'old_revision' };
  }

  const next = cloneProjection(projection);
  next.appliedEventIds.add(event.id);
  bumpRevision(next, entityKey, domain, revision);

  if (event.type === 'session_patch' && event.sessionPatch) {
    next.status = event.sessionPatch.status || next.status;
    next.currentTurn = Math.max(next.currentTurn, Number(event.sessionPatch.currentTurn || next.currentTurn));
    next.elapsedMinutes = Math.max(next.elapsedMinutes, Number(event.sessionPatch.elapsedMinutes || next.elapsedMinutes));
    return { projection: next, applied: true, reason: 'applied' };
  }

  if (event.type === 'session_ended') {
    next.status = 'ended';
    return { projection: next, applied: true, reason: 'applied' };
  }

  const playerKey = getProjectionPlayerTargetKey(event);
  if (!playerKey) return { projection: next, applied: true, reason: 'applied' };
  const current = next.players[playerKey];
  if (!current) return { projection: next, applied: true, reason: 'applied' };

  if (event.type === 'player_patch' && event.numberPatch) {
    next.players[playerKey] = recalculateProjection({
      ...current,
      hpCurrent: event.numberPatch.hpCurrent ?? current.hpCurrent,
      hpMax: event.numberPatch.hpMax ?? current.hpMax,
      tempHp: event.numberPatch.tempHp ?? current.tempHp,
      xp: event.numberPatch.xp ?? current.xp,
      coins: {
        gp: event.numberPatch.gp ?? current.coins.gp,
        sp: event.numberPatch.sp ?? current.coins.sp,
        cp: event.numberPatch.cp ?? current.coins.cp,
      },
    });
  }

  if (event.type === 'inventory_patch' && event.inventoryPatch?.equipment) {
    const equipment = normalizeInventoryState(event.inventoryPatch.equipment);
    next.players[playerKey] = recalculateProjection({ ...current, inventory: equipment, equipment });
  }

  if (event.type === 'effect_patch' && event.effectPatch) {
    const removeSet = new Set<string>((event.effectPatch.remove || []).map(String));
    const updatedById = new Map((current.activeEffects || []).map((effect) => [effect.effectId, effect]));
    for (const id of removeSet) updatedById.delete(id);
    for (const effect of event.effectPatch.update || []) {
      const normalized = normalizeDomainEffect(effect, { targetKey: playerKey });
      if (updatedById.has(normalized.effectId)) updatedById.set(normalized.effectId, normalized);
    }
    for (const effect of event.effectPatch.add || []) {
      const normalized = normalizeDomainEffect(effect, { targetKey: playerKey });
      if (!removeSet.has(normalized.effectId)) updatedById.set(normalized.effectId, normalized);
    }
    next.players[playerKey] = recalculateProjection({
      ...current,
      tempHp: event.numberPatch?.tempHp ?? current.tempHp,
      activeEffects: Array.from(updatedById.values()).filter((effect) => effect.status === 'active'),
    });
  }

  return { projection: next, applied: true, reason: 'applied' };
}

export function applySnapshotToProjection(
  projection: SessionProjection,
  snapshot: LanProjectionSessionState,
  snapshotRevision = 0,
): ProjectionApplyResult {
  const sessionKey = sessionRevisionKey(projection.sessionId);
  const currentRevision = projection.revisions[sessionKey]?.sessionRevision || 0;
  if (snapshotRevision > 0 && snapshotRevision < currentRevision) {
    return { projection, applied: false, reason: 'ignored_snapshot' };
  }

  const next = cloneProjection(projection);
  next.status = snapshot.status || next.status;
  next.currentTurn = Math.max(next.currentTurn, Number(snapshot.currentTurn || 0));
  next.elapsedMinutes = Math.max(next.elapsedMinutes, Number(snapshot.elapsedMinutes || 0));
  bumpRevision(next, sessionKey, 'sessionRevision', snapshotRevision || Math.max(next.currentTurn, next.elapsedMinutes));

  for (const player of snapshot.players || []) {
    const key = getProjectionPlayerKey(projection.sessionId, player);
    const revisions = next.revisions[key] || { ...ZERO_REVISIONS };
    const incomingRevision = cleanRevision(player.revisionSeq);
    const latestLiveRevision = Math.max(revisions.playerRevision, revisions.inventoryRevision, revisions.effectRevision);
    if (
      (incomingRevision <= 0 && latestLiveRevision > 0) ||
      (incomingRevision > 0 && incomingRevision < latestLiveRevision)
    ) {
      continue;
    }
    next.players[key] = characterProjectionFromLanPlayer(projection.sessionId, player);
    next.revisions[key] = {
      ...revisions,
      playerRevision: Math.max(revisions.playerRevision, incomingRevision),
      effectRevision: Math.max(revisions.effectRevision, incomingRevision),
      inventoryRevision: Math.max(revisions.inventoryRevision, incomingRevision),
    };
  }

  return { projection: next, applied: true, reason: 'applied' };
}

function characterProjectionFromLanPlayer(sessionId: string, player: LanProjectionPlayerState): CharacterProjection {
  const playerKey = getProjectionPlayerKey(sessionId, player);
  const baseStats = normalizeStats(player.stats);
  const activeEffects = (player.effects || []).map((effect) => normalizeDomainEffect(effect, { targetKey: playerKey }));
  const equipment = normalizeInventoryState(player.equipment);
  return recalculateProjection({
    playerKey,
    characterId: Number(player.characterId ?? player.sourceCharacterId ?? player.id) || undefined,
    name: player.characterName || player.playerName || 'Personagem',
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

function recalculateProjection(character: CharacterProjection): CharacterProjection {
  const effectiveStats = calculateEffectiveStats(character.baseStats, character.activeEffects);
  return {
    ...character,
    hpCurrent: Math.max(0, Math.min(Math.max(0, character.hpMax), Math.floor(Number(character.hpCurrent || 0)))),
    tempHp: Math.max(0, Math.floor(Number(character.tempHp || 0))),
    effectiveStats,
    derived: {
      acBonus: Number(effectiveStats.CA || 0) - Number(character.baseStats.CA || 0),
      activeEffectCount: character.activeEffects.length,
    },
  };
}

function shouldAcceptRevision(
  projection: SessionProjection,
  entityKey: string,
  domain: keyof LanEntityRevisions,
  incomingRevision: number,
) {
  if (incomingRevision <= 0) return true;
  const current = projection.revisions[entityKey]?.[domain] || 0;
  return incomingRevision > current;
}

function bumpRevision(
  projection: SessionProjection,
  entityKey: string,
  domain: keyof LanEntityRevisions,
  incomingRevision: number,
) {
  const current = projection.revisions[entityKey] || { ...ZERO_REVISIONS };
  projection.revisions[entityKey] = {
    ...current,
    [domain]: Math.max(current[domain] || 0, incomingRevision),
  };
}

function getEventDomain(event: LanProjectionEvent): keyof LanEntityRevisions {
  if (event.type === 'session_patch' || event.type === 'session_ended' || event.type === 'timeline_event') return 'sessionRevision';
  if (event.type === 'effect_patch' || event.type === 'effect_expired' || event.type === 'effect_catalog_patch') return 'effectRevision';
  if (String(event.type).startsWith('trade_')) return 'tradeRevision';
  if (event.type === 'inventory_patch' || String(event.type).includes('send_item')) return 'inventoryRevision';
  if (event.type === 'pending_save_patch' || String(event.type).includes('save')) return 'pendingSaveRevision';
  return 'playerRevision';
}

function getProjectionEntityKey(sessionId: string, event: LanProjectionEvent, domain: keyof LanEntityRevisions) {
  if (domain === 'sessionRevision') return sessionRevisionKey(sessionId);
  return getProjectionPlayerTargetKey(event) || `${sessionId}:unknown`;
}

function getProjectionPlayerTargetKey(event: LanProjectionEvent) {
  const target = event.inventoryPatch?.targetKey || event.effectPatch?.targetKey || event.toKey || event.fromKey;
  if (!target || target === 'master' || target === 'all' || target === 'party' || target === 'session') return '';
  return target;
}

function getProjectionPlayerKey(sessionId: string, player: LanProjectionPlayerState) {
  return player.remoteKey || `${sessionId}:${player.sourceCharacterId || player.characterId || player.id}:${player.characterName}`;
}

function sessionRevisionKey(sessionId: string) {
  return `${sessionId}:session`;
}

function cloneProjection(projection: SessionProjection): SessionProjection {
  return {
    ...projection,
    players: { ...projection.players },
    revisions: Object.fromEntries(Object.entries(projection.revisions).map(([key, value]) => [key, { ...value }])),
    appliedEventIds: new Set(projection.appliedEventIds),
  };
}

function normalizeStats(stats: Record<string, unknown>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA']) {
    next[key] = Math.floor(Number(stats?.[key] ?? (key === 'CA' ? 10 : 10)) || 10);
  }
  return next;
}

function cleanRevision(value: unknown) {
  const revision = Math.max(0, Math.floor(Number(value || 0) || 0));
  return revision > 1000000 ? 0 : revision;
}
