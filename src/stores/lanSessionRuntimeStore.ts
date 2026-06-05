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

const LIVE_FIELDS = ['hpCurrent', 'hpMax', 'tempHp', 'xp', 'gp', 'sp', 'cp', 'effects'] as const;

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
    if (!incomingKeys.has(key) && meta && !meta.removed) {
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
  const updatedPlayer = {
    ...player,
    ...cleanPatch,
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
  for (const effect of player.effects || []) {
    const id = String((effect as any)?.id || '');
    if (id && !removeSet.has(id)) byId.set(id, effect);
  }
  for (const effect of [...(patch.update || []), ...(patch.add || [])]) {
    const id = String((effect as any)?.id || '');
    if (id && !removeSet.has(id)) byId.set(id, effect);
  }

  const revision = nextRuntimeRevision(sessionId, getPlayerKey(sessionId, player), player.revisionSeq);
  const nextEffects = Array.from(byId.values());
  const updatedPlayer = {
    ...player,
    effects: nextEffects,
    tempHp: calculateStandardTempHpFromEffects(nextEffects),
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
      const updatedPlayer = { ...player, effects, tempHp: calculateStandardTempHpFromEffects(effects), revisionSeq: revision };
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
