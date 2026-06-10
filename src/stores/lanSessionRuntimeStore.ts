import { create } from 'zustand';

import type {
  LanAdvanceUnit,
  LanSessionPlayerState,
  LanSessionState,
} from '@/services/lanSession';
import type { LanEffectPatch } from '@/services/effects';
import { debugLanFlow } from '@/services/lanRuntimeMode';

type RuntimeSource = 'runtime' | 'event' | 'sqlite' | 'snapshot' | 'public_status';

type RuntimeMeta = {
  revision: number;
  seq: number;
  updatedAt: number;
  source: RuntimeSource;
  removed?: boolean;
};

type RuntimeSession = {
  state: LanSessionState | null;
  entities: Record<string, RuntimeMeta>;
};

type RuntimeStore = {
  sessions: Record<string, RuntimeSession>;
  setSessionState: (sessionId: string, state: LanSessionState | null) => void;
  resetSession: (sessionId?: string) => void;
};

type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;

const LIVE_FIELDS = ['hpCurrent', 'hpMax', 'tempHp', 'xp', 'gp', 'sp', 'cp', 'effects', 'equipment', 'stats'] as const;

export const useLanSessionRuntimeStore = create<RuntimeStore>((set) => ({
  sessions: {},

  setSessionState: (sessionId, state) => set((current) => ({
    sessions: {
      ...current.sessions,
      [sessionId]: {
        ...(current.sessions[sessionId] || { entities: {} }),
        state,
      },
    },
  })),

  resetSession: (sessionId) => set((current) => {
    if (!sessionId) return { sessions: {} };
    const next = { ...current.sessions };
    delete next[sessionId];
    return { sessions: next };
  }),
}));



function parseRuntimeJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function addRuntimeEquipBonus(target: Record<string, number>, attrRaw: unknown, rawValue: unknown) {
  const attr = String(attrRaw || '').toUpperCase();
  if (!['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(attr)) return;
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value) || value === 0) return;
  target[attr] = (target[attr] || 0) + value;
}

function getRuntimeEquipBonusFromItem(item: any) {
  const bonuses: Record<string, number> = {};
  if (!item || typeof item !== 'object') return bonuses;

  const parsed = parseRuntimeJsonValue<any>(item.effect_json || item.effectJson, null);
  const effects = Array.isArray(parsed?.effects) ? parsed.effects : Array.isArray(parsed) ? parsed : [];
  const hasStructuredEquipEffects = effects.some((effect: any) => {
    const target = String(effect?.target || '').toUpperCase();
    if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) return false;
    const kind = String(effect?.kind || effect?.type || '').toLowerCase();
    return ['stat', 'attribute', 'atributo'].includes(kind) || ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(target);
  });

  // v54: se o item veio do editor avançado, o mesmo bônus aparece no texto
  // legível (ex.: "CA 5 + CON 10") e no effect_json. O effect_json é a fonte
  // confiável; o texto só é fallback para itens antigos.
  if (!hasStructuredEquipEffects) {
    const text = String(item.damage || item.effect || '');
    const lower = text.toLowerCase();
    if (!lower.includes('perm') && !lower.includes('temp')) {
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)/gi;
      for (const match of text.matchAll(statRegex)) {
        addRuntimeEquipBonus(bonuses, match[1], parseInt(String(match[2]).replace('+', ''), 10));
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
    // Se tem duração/permanente, é efeito de consumo/buff, não bônus enquanto equipado.
    // Itens equipáveis criados como armadura geralmente vêm sem duração.
    if (durationText.includes('temp') || durationText.includes('perm') || ['turn', 'round', 'minute', 'hour', 'day', 'rest', 'short_rest', 'long_rest', 'permanent'].includes(durationUnit)) continue;
    addRuntimeEquipBonus(bonuses, target, effect?.value ?? effect?.amount);
  }
  return bonuses;
}

function deriveRuntimeEquipModsFromEquipment(equipment: Record<string, any>) {
  const mods: Record<string, number> = {};
  const slots = equipment?.slots && typeof equipment.slots === 'object' ? equipment.slots as Record<string, any> : {};
  for (const item of Object.values(slots)) {
    if (!item) continue;
    const bonuses = getRuntimeEquipBonusFromItem(item);
    for (const [stat, value] of Object.entries(bonuses)) {
      mods[stat] = (mods[stat] || 0) + Number(value || 0);
    }
  }
  Object.keys(mods).forEach((key) => { if (!mods[key]) delete mods[key]; });
  return mods;
}

function buildRuntimeStatsWithDerivedEquipMods(stats: Record<string, unknown>, equipment: Record<string, any>) {
  const nextStats: Record<string, unknown> = { ...(stats || {}) };
  const derived = deriveRuntimeEquipModsFromEquipment(equipment || {});
  if (Object.keys(derived).length > 0) nextStats.equip_mods = derived;
  else delete nextStats.equip_mods;
  return nextStats;
}

export function replaceLanRuntimeStateFromBootstrap(sessionId: string, state: LanSessionState | null) {
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, state);
  return state;
}

export function mergeSessionStatePreservingLiveFields(
  currentState: LanSessionState | null | undefined,
  incomingState: LanSessionState | null | undefined,
  sessionId: string,
  source: RuntimeSource = 'sqlite',
) {
  if (!incomingState) return currentState || null;
  if (!currentState) return replaceLanRuntimeStateFromBootstrap(sessionId, incomingState);

  const runtime = getRuntimeSession(sessionId);
  let preservedLiveField = false;
  const currentByKey = new Map(currentState.players.map((player) => [getPlayerKey(sessionId, player), player]));
  const incomingKeys = new Set<string>();
  const nextPlayers: LanSessionPlayerState[] = [];

  for (const incomingPlayer of incomingState.players || []) {
    const key = getPlayerKey(sessionId, incomingPlayer);
    incomingKeys.add(key);
    const meta = runtime.entities[key];
    const currentPlayer = currentByKey.get(key);

    if (meta?.removed) {
      preservedLiveField = true;
      continue;
    }

    if (currentPlayer && shouldPreserveLive(meta, incomingPlayer)) {
      preservedLiveField = true;
      nextPlayers.push(preserveLivePlayerFields(currentPlayer, incomingPlayer));
    } else {
      nextPlayers.push(incomingPlayer);
    }
  }

  for (const [key, currentPlayer] of currentByKey.entries()) {
    const meta = runtime.entities[key];
    const snapshotIsOlderRoster = (source === 'sqlite' || source === 'snapshot') && currentState.players.length > (incomingState.players || []).length;
    if (!incomingKeys.has(key) && !meta?.removed && (meta || snapshotIsOlderRoster)) {
      // v89: durante join/reconnect/level-up o host pode receber snapshots antigos
      // com menos jogadores. Não remova um jogador vivo do runtime só porque o
      // payload/cache ainda não terminou de reconstruir o roster; isso causava
      // o card piscando ao entrar na sessão. Kicks/encerramento continuam usando
      // meta.removed e não são preservados aqui.
      preservedLiveField = true;
      nextPlayers.push(currentPlayer);
    }
  }

  const sessionMeta = runtime.entities[getSessionKey(sessionId)];
  const incomingSessionRevision = getSessionRevision(incomingState);
  const currentSessionRevision = getSessionRevision(currentState);
  const preserveSession = Boolean(
    (sessionMeta && sessionMeta.revision >= incomingSessionRevision) ||
    ((source === 'sqlite' || source === 'snapshot') && incomingSessionRevision < currentSessionRevision)
  );
  const merged: LanSessionState = {
    ...incomingState,
    status: preserveSession ? currentState.status : incomingState.status,
    currentTurn: preserveSession ? currentState.currentTurn : incomingState.currentTurn,
    elapsedMinutes: preserveSession ? currentState.elapsedMinutes : incomingState.elapsedMinutes,
    players: nextPlayers,
  };

  if (areLanSessionStatesEqual(currentState, merged)) {
    debugLanFlow('MASTER_RELOAD_NO_REAL_CHANGE', {
      sessionId,
      source,
      playerCount: currentState.players.length,
      currentTurn: currentState.currentTurn,
      elapsedMinutes: currentState.elapsedMinutes,
    });
    return currentState;
  }

  if (preservedLiveField || preserveSession) {
    debugLanFlow('MASTER_RELOAD_SKIPPED_DURING_LIVE_STATE', {
      sessionId,
      source,
      preservedLiveField,
      preserveSession,
      playerCount: merged.players.length,
    });
  }

  useLanSessionRuntimeStore.getState().setSessionState(sessionId, merged);
  return merged;
}

function areLanSessionStatesEqual(left: LanSessionState | null | undefined, right: LanSessionState | null | undefined) {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyHostNumberPatchRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  playerId: number,
  patch: NumberPatch,
  source: RuntimeSource = 'runtime',
) {
  if (!currentState) return null;
  const player = currentState.players.find((entry) => entry.id === playerId);
  if (!player) return null;

  const cleanPatch = cleanNumberPatch(patch, player);
  if (Object.keys(cleanPatch).length === 0) return null;

  const revision = nextRuntimeRevision(sessionId, getPlayerKey(sessionId, player), player.revisionSeq);
  const nextEffects = cleanPatch.tempHp != null
    ? syncTempHpRuntimeEffectsWithNumber(player.effects || [], cleanPatch.tempHp)
    : player.effects;
  const updatedPlayer = {
    ...player,
    ...cleanPatch,
    effects: nextEffects,
    revisionSeq: revision,
  };
  const nextState = {
    ...currentState,
    players: currentState.players.map((entry) => entry.id === playerId ? updatedPlayer : entry),
  };

  markRuntimeEntity(sessionId, getPlayerKey(sessionId, updatedPlayer), revision, revision, source);
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, nextState);

  return { state: nextState, player: updatedPlayer, patch: cleanPatch, revision };
}

export function applyHostNumberDeltaRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  playerId: number,
  field: keyof NumberPatch,
  delta: number,
) {
  const player = currentState?.players.find((entry) => entry.id === playerId);
  if (!player) return null;

  const currentValue = Math.max(0, Math.floor(Number(player[field]) || 0));
  const rawNextValue = currentValue + Math.floor(Number(delta) || 0);
  const nextValue = field === 'hpCurrent'
    ? Math.max(0, Math.min(Math.max(0, Number(player.hpMax) || 0), rawNextValue))
    : Math.max(0, rawNextValue);

  return applyHostNumberPatchRuntime(sessionId, currentState, playerId, { [field]: nextValue }, 'runtime');
}

export function applyHostEffectPatchRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  targetKey: string,
  patch: LanEffectPatch,
  source: RuntimeSource = 'runtime',
) {
  if (!currentState) return null;
  const player = currentState.players.find((entry) => entry.remoteKey === targetKey || entry.characterName === targetKey);
  if (!player) return null;

  const removeSet = new Set((patch.remove || []).map(String));
  const byId = new Map<string, any>();
  if (patch.replace === true) {
    for (const effect of patch.add || []) {
      const id = String((effect as any)?.id || '');
      if (id && !removeSet.has(id)) byId.set(id, effect);
    }
  } else {
    for (const effect of player.effects || []) {
      const id = String((effect as any)?.id || '');
      const lanEffectId = String((effect as any)?.lanEffectId || (effect as any)?.lanEffectID || '');
      if (id && !removeSet.has(id) && !removeSet.has(lanEffectId)) byId.set(id, effect);
    }
    for (const effect of patch.update || []) {
      const id = String((effect as any)?.id || '');
      if (id && !removeSet.has(id) && byId.has(id)) byId.set(id, effect);
    }
    for (const effect of patch.add || []) {
      const id = String((effect as any)?.id || '');
      if (id && !removeSet.has(id)) byId.set(id, effect);
    }
  }

  const revision = nextRuntimeRevision(sessionId, getPlayerKey(sessionId, player), player.revisionSeq);
  const nextEffects = Array.from(byId.values());
  const updatedPlayer = {
    ...player,
    effects: nextEffects,
    tempHp: Math.max(0, Math.floor(Number(player.tempHp) || 0)),
    revisionSeq: revision,
  };
  const nextState = {
    ...currentState,
    players: currentState.players.map((entry) => entry.id === player.id ? updatedPlayer : entry),
  };

  markRuntimeEntity(sessionId, getPlayerKey(sessionId, updatedPlayer), revision, revision, source);
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, nextState);
  return { state: nextState, player: updatedPlayer, revision };
}


export function applyHostInventoryPatchRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  targetKey: string | undefined,
  equipment: Record<string, unknown>,
  statsPatch?: Record<string, unknown>,
  source: RuntimeSource = 'runtime',
) {
  if (!currentState || !targetKey) return null;
  const player = currentState.players.find((entry) => (
    entry.remoteKey === targetKey ||
    entry.characterName === targetKey ||
    String(entry.id) === targetKey
  ));
  if (!player) return null;

  const revision = nextRuntimeRevision(sessionId, getPlayerKey(sessionId, player), player.revisionSeq);
  const rawPreviousStats = player.stats && typeof player.stats === 'object' ? player.stats : {};
  const previousEquipment = player.equipment && typeof player.equipment === 'object' ? player.equipment as Record<string, any> : { bag: [], slots: {} };
  const previousStats = buildRuntimeStatsWithDerivedEquipMods(rawPreviousStats, previousEquipment);
  const rawNextStats = statsPatch && typeof statsPatch === 'object' ? { ...previousStats, ...statsPatch } : previousStats;
  const nextStats = buildRuntimeStatsWithDerivedEquipMods(rawNextStats, equipment as Record<string, any>);

  const getConMod = (stats: Record<string, unknown>) => {
    const tempMods = stats.temp_mods && typeof stats.temp_mods === 'object' ? stats.temp_mods as Record<string, unknown> : {};
    const equipMods = stats.equip_mods && typeof stats.equip_mods === 'object' ? stats.equip_mods as Record<string, unknown> : {};
    const base = parseInt(String(stats.CON ?? '10'), 10) || 10;
    const temp = parseInt(String(tempMods.CON ?? '0'), 10) || 0;
    const equip = parseInt(String(equipMods.CON ?? '0'), 10) || 0;
    return Math.floor(((base + temp + equip) - 10) / 2);
  };

  const hpDelta = statsPatch && typeof statsPatch === 'object'
    ? (getConMod(nextStats) - getConMod(previousStats)) * Math.max(1, Number(player.level || 1))
    : 0;

  const updatedPlayer: LanSessionPlayerState = {
    ...player,
    equipment,
    stats: nextStats,
    hpMax: hpDelta ? Math.max(1, Number(player.hpMax || 0) + hpDelta) : player.hpMax,
    hpCurrent: hpDelta ? Math.max(0, Number(player.hpCurrent || 0) + hpDelta) : player.hpCurrent,
    revisionSeq: revision,
  };
  const nextState: LanSessionState = {
    ...currentState,
    players: currentState.players.map((entry) => entry.id === player.id ? updatedPlayer : entry),
  };

  markRuntimeEntity(sessionId, getPlayerKey(sessionId, updatedPlayer), revision, revision, source);
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, nextState);
  return { state: nextState, player: updatedPlayer, revision };
}

export function applyHostTurnRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  unit: LanAdvanceUnit,
) {
  if (!currentState) return null;

  const minuteDelta = unit === 'minute' ? 1 : unit === 'hour' || unit === 'shortRest' ? 60 : unit === 'longRest' ? 480 : 0;
  const sessionRevision = nextRuntimeRevision(sessionId, getSessionKey(sessionId), getSessionRevision(currentState));
  const nextState: LanSessionState = {
    ...currentState,
    currentTurn: unit === 'turn' ? currentState.currentTurn + 1 : currentState.currentTurn,
    elapsedMinutes: currentState.elapsedMinutes + minuteDelta,
    players: currentState.players.map((player) => {
      const effects = tickRuntimeEffects(player.effects || [], unit);
      if (effects === player.effects) return player;
      const revision = nextRuntimeRevision(sessionId, getPlayerKey(sessionId, player), player.revisionSeq);
      const updatedPlayer = { ...player, effects, tempHp: getTempHpAfterRuntimeEffectTick(player, effects), revisionSeq: revision };
      markRuntimeEntity(sessionId, getPlayerKey(sessionId, updatedPlayer), revision, revision, 'runtime');
      return updatedPlayer;
    }),
  };

  markRuntimeEntity(sessionId, getSessionKey(sessionId), sessionRevision, sessionRevision, 'runtime');
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, nextState);
  return { state: nextState, revision: sessionRevision };
}

export function removeHostPlayerRuntime(
  sessionId: string,
  currentState: LanSessionState | null | undefined,
  player: LanSessionPlayerState,
) {
  if (!currentState) return null;
  const key = getPlayerKey(sessionId, player);
  const revision = nextRuntimeRevision(sessionId, key, player.revisionSeq);
  markRuntimeEntity(sessionId, key, revision, revision, 'runtime', true);
  const nextState = {
    ...currentState,
    players: currentState.players.filter((entry) => getPlayerKey(sessionId, entry) !== key),
  };
  useLanSessionRuntimeStore.getState().setSessionState(sessionId, nextState);
  return { state: nextState, revision };
}


function isTempHpRuntimeEffect(effect: any) {
  return String(effect?.target || '').toUpperCase() === 'PV_TEMP' || String(effect?.kind || '').toLowerCase() === 'temp_hp';
}

function getTempHpRuntimeValue(effect: any) {
  return isTempHpRuntimeEffect(effect) ? Math.max(0, Math.floor(Number(effect?.value) || 0)) : 0;
}

function calculateStandardTempHpFromEffects(effects: any[]) {
  return (Array.isArray(effects) ? effects : [])
    .filter((effect) => isTempHpRuntimeEffect(effect) && getTempHpRuntimeValue(effect) > 0)
    .reduce((max, effect) => Math.max(max, getTempHpRuntimeValue(effect)), 0);
}

function getTempHpAfterRuntimeEffectTick(player: LanSessionPlayerState, nextEffects: LanSessionPlayerState['effects']) {
  const currentTempHp = Math.max(0, Math.floor(Number(player.tempHp) || 0));
  if (currentTempHp <= 0) return 0;

  const hadTempHpEffect = (player.effects || []).some((effect) => (
    isTempHpRuntimeEffect(effect) && getTempHpRuntimeValue(effect) > 0
  ));
  if (!hadTempHpEffect) return currentTempHp;

  const nextTempHpFromEffects = calculateStandardTempHpFromEffects(nextEffects || []);
  return nextTempHpFromEffects <= 0 ? 0 : currentTempHp;
}

function syncTempHpRuntimeEffectsWithNumber(effects: LanSessionPlayerState['effects'], tempHp: number) {
  const list = Array.isArray(effects) ? effects : [];
  const cleanTempHp = Math.max(0, Math.floor(Number(tempHp) || 0));
  const tempEffectIndexes = list
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => isTempHpRuntimeEffect(effect));

  if (tempEffectIndexes.length === 0) return effects;
  if (cleanTempHp <= 0) return list.filter((effect) => !isTempHpRuntimeEffect(effect));

  const selected = tempEffectIndexes.reduce((best, entry) => (
    getTempHpRuntimeValue(entry.effect) > getTempHpRuntimeValue(best.effect) ? entry : best
  ));

  return list.flatMap((effect, index) => {
    if (!isTempHpRuntimeEffect(effect)) return [effect];
    if (index !== selected.index) return [];
    return [{ ...effect, value: cleanTempHp }];
  });
}

function preserveLivePlayerFields(currentPlayer: LanSessionPlayerState, incomingPlayer: LanSessionPlayerState) {
  const next: LanSessionPlayerState = { ...incomingPlayer };
  const currentLevel = Math.max(1, Number((currentPlayer as any).level || 1));
  const incomingLevel = Math.max(1, Number((incomingPlayer as any).level || 1));
  const currentHpMax = Math.max(0, Number((currentPlayer as any).hpMax || 0));
  const incomingHpMax = Math.max(0, Number((incomingPlayer as any).hpMax || 0));
  const incomingLooksLikeProgression = incomingLevel > currentLevel || incomingHpMax > currentHpMax;
  const currentIsNewerProgression = currentLevel > incomingLevel || currentHpMax > incomingHpMax;

  // v39: HP máximo e nível não são apenas "campos vivos" de combate.
  // Eles também carregam progressão de nível. Se preservarmos cegamente hpMax
  // do runtime antigo, o mestre continua mandando nível 1/hpMax antigo após o
  // jogador subir. Se o incoming é progressão, aceite hpCurrent/hpMax dele.
  // Se o current é a progressão mais nova, proteja level/class/hpMax contra
  // reload/snapshot antigo.
  if (currentIsNewerProgression) {
    (next as any).level = (currentPlayer as any).level;
    (next as any).className = (currentPlayer as any).className;
    (next as any).race = (currentPlayer as any).race;
  }

  for (const field of LIVE_FIELDS) {
    if (incomingLooksLikeProgression && (field === 'hpMax' || field === 'hpCurrent')) {
      continue;
    }
    if (currentIsNewerProgression && (field === 'hpMax' || field === 'hpCurrent')) {
      (next as any)[field] = (currentPlayer as any)[field];
      continue;
    }
    (next as any)[field] = (currentPlayer as any)[field];
  }
  next.revisionSeq = Math.max(Number(currentPlayer.revisionSeq || 0), Number(incomingPlayer.revisionSeq || 0));
  return next;
}

function shouldPreserveLive(meta: RuntimeMeta | undefined, incomingPlayer: LanSessionPlayerState) {
  if (!meta) return false;

  // Enquanto a mesa esta viva, o estado em memoria do mestre e a fonte de verdade
  // para HP/XP/moedas/PV temporario/efeitos. O SQLite pode receber uma revisao
  // maior por reconstrução de efeitos ou passagem de turno antes de todos os
  // patches numericos assíncronos terminarem de persistir; se aceitarmos esse
  // snapshot bruto, a vida volta. Portanto, qualquer entidade tocada em runtime
  // preserva os campos vivos contra payload/snapshot/reload estrutural.
  if (meta.source === 'runtime' || meta.source === 'event') return true;

  return meta.revision >= Number(incomingPlayer.revisionSeq || 0);
}

function cleanNumberPatch(patch: NumberPatch, player: LanSessionPlayerState) {
  const cleanPatch: NumberPatch = {};
  const hpMax = Math.max(0, Math.floor(Number(patch.hpMax ?? player.hpMax) || 0));

  if (patch.hpMax != null) cleanPatch.hpMax = hpMax;
  if (patch.hpCurrent != null) cleanPatch.hpCurrent = Math.max(0, Math.min(hpMax, Math.floor(Number(patch.hpCurrent) || 0)));
  if (patch.tempHp != null) cleanPatch.tempHp = Math.max(0, Math.floor(Number(patch.tempHp) || 0));
  if (patch.xp != null) cleanPatch.xp = Math.max(0, Math.floor(Number(patch.xp) || 0));
  if (patch.gp != null) cleanPatch.gp = Math.max(0, Math.floor(Number(patch.gp) || 0));
  if (patch.sp != null) cleanPatch.sp = Math.max(0, Math.floor(Number(patch.sp) || 0));
  if (patch.cp != null) cleanPatch.cp = Math.max(0, Math.floor(Number(patch.cp) || 0));

  return cleanPatch;
}

function tickRuntimeEffects(effects: LanSessionPlayerState['effects'], unit: LanAdvanceUnit) {
  let changed = false;
  const next = (effects || []).map((effect) => {
    const delta = getDurationDelta(effect.unit, unit);
    if (delta <= 0) return effect;
    changed = true;
    return { ...effect, remaining: Math.max(0, Number(effect.remaining || 0) - delta) };
  }).filter((effect) => (
    effect.isPermanent ||
    effect.unit === 'permanent' ||
    effect.unit === 'manual' ||
    effect.unit === 'while_equipped' ||
    effect.unit === 'concentration' ||
    Number(effect.remaining || 0) > 0
  ));
  return changed ? next : effects;
}

function getDurationDelta(effectUnit: string | undefined, unit: LanAdvanceUnit) {
  if (effectUnit === 'turn' && unit === 'turn') return 1;
  if (effectUnit === 'minute') {
    if (unit === 'minute') return 1;
    if (unit === 'hour' || unit === 'shortRest') return 60;
    if (unit === 'longRest') return 480;
  }
  if (effectUnit === 'hour') {
    if (unit === 'hour' || unit === 'shortRest') return 1;
    if (unit === 'longRest') return 8;
  }
  if (effectUnit === 'rest' && (unit === 'shortRest' || unit === 'longRest')) return Number.MAX_SAFE_INTEGER;
  return 0;
}

function getRuntimeSession(sessionId: string) {
  return useLanSessionRuntimeStore.getState().sessions[sessionId] || { state: null, entities: {} };
}

function nextRuntimeRevision(sessionId: string, entityKey: string, baseRevision?: number) {
  const meta = getRuntimeSession(sessionId).entities[entityKey];
  return Math.max(Number(baseRevision || 0), Number(meta?.revision || 0)) + 1;
}

function markRuntimeEntity(
  sessionId: string,
  entityKey: string,
  revision: number,
  seq: number,
  source: RuntimeSource,
  removed = false,
) {
  const current = useLanSessionRuntimeStore.getState();
  const session = current.sessions[sessionId] || { state: null, entities: {} };
  useLanSessionRuntimeStore.setState({
    sessions: {
      ...current.sessions,
      [sessionId]: {
        ...session,
        entities: {
          ...session.entities,
          [entityKey]: { revision, seq, updatedAt: Date.now(), source, removed },
        },
      },
    },
  });
}

function getPlayerKey(sessionId: string, player: LanSessionPlayerState) {
  return `${sessionId}:player:${player.remoteKey || player.clientId || player.sourceCharacterId || player.characterId || player.id || player.characterName}`;
}

function getSessionKey(sessionId: string) {
  return `${sessionId}:session`;
}

function getSessionRevision(state: LanSessionState) {
  return Math.max(Number(state.currentTurn || 0), Number(state.elapsedMinutes || 0));
}
