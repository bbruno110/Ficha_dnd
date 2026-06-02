import type { SQLiteDatabase } from 'expo-sqlite';

import { traceFunctionCall, traceFunctionReturn, traceLanEvent, traceStateChange } from '../debug/appTrace';
import {
  getLanSessionState,
  makeLanEventId,
  rememberAndSendLanSessionEvent,
  updateLanPlayerNumbers,
  type LanSessionEvent,
  type LanSessionPlayerState,
} from '../lanSession';

export type LanHostNumberField = 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp';
export type LanHostNumberPatch = Partial<Pick<LanSessionPlayerState, LanHostNumberField>>;

export type LanHostPlayerPatchResult = {
  player: LanSessionPlayerState;
  patch: LanHostNumberPatch;
  event: LanSessionEvent | null;
};

const hostMutationQueues = new Map<string, Promise<unknown>>();

export function enqueueLanHostMutation<T>(sessionId: string, task: () => Promise<T>) {
  traceFunctionCall('enqueueLanHostMutation', { sessionId }, {
    source: 'lanHostEngine',
    sessionId,
  });
  const currentQueue = hostMutationQueues.get(sessionId) || Promise.resolve();
  const run = currentQueue.catch(() => undefined).then(task);

  hostMutationQueues.set(
    sessionId,
    run.catch((error) => {
      console.warn('[LAN HOST ENGINE] Mutacao falhou:', error);
    })
  );

  return run;
}

export function commitHostPlayerNumberPatch(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    joinUrl?: string;
    playerId: number;
    patch: LanHostNumberPatch;
    message: string;
  },
) {
  traceFunctionCall('commitHostPlayerNumberPatch', input, {
    source: 'lanHostEngine',
    sessionId: input.sessionId,
    playerId: input.playerId,
    patch: input.patch,
  });
  return enqueueLanHostMutation(input.sessionId, () => applyHostPlayerNumberPatch(db, input));
}

export function commitHostPlayerNumberDelta(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    joinUrl?: string;
    playerId: number;
    field: LanHostNumberField;
    delta: number;
    message?: string;
  },
) {
  traceFunctionCall('commitHostPlayerNumberDelta', input, {
    source: 'lanHostEngine',
    sessionId: input.sessionId,
    playerId: input.playerId,
    args: input,
  });
  return enqueueLanHostMutation(input.sessionId, async () => {
    const latestPlayer = await getLatestHostPlayer(db, input.sessionId, input.playerId);
    if (!latestPlayer) return null;

    const currentValue = Math.max(0, Math.floor(Number(latestPlayer[input.field]) || 0));
    const rawNextValue = currentValue + Math.floor(Number(input.delta) || 0);
    const nextValue = input.field === 'hpCurrent'
      ? Math.max(0, Math.min(Math.max(0, Number(latestPlayer.hpMax) || 0), rawNextValue))
      : Math.max(0, rawNextValue);

    const result = await applyHostPlayerNumberPatch(db, {
      sessionId: input.sessionId,
      joinUrl: input.joinUrl,
      playerId: input.playerId,
      patch: { [input.field]: nextValue },
      message: input.message || `Mestre ajustou ${input.field} de ${latestPlayer.characterName} para ${nextValue}.`,
    });
    traceFunctionReturn('commitHostPlayerNumberDelta', result, {
      source: 'lanHostEngine',
      sessionId: input.sessionId,
      playerId: input.playerId,
      before: { [input.field]: currentValue },
      after: { [input.field]: nextValue },
    });
    return result;
  });
}

async function applyHostPlayerNumberPatch(
  db: SQLiteDatabase,
  input: {
    sessionId: string;
    joinUrl?: string;
    playerId: number;
    patch: LanHostNumberPatch;
    message: string;
  },
) {
  traceFunctionCall('applyHostPlayerNumberPatch', input, {
    source: 'lanHostEngine',
    sessionId: input.sessionId,
    playerId: input.playerId,
    patch: input.patch,
  });
  const latestPlayer = await getLatestHostPlayer(db, input.sessionId, input.playerId);
  if (!latestPlayer) return null;

  const cleanPatch = cleanNumberPatch(input.patch, latestPlayer);
  if (Object.keys(cleanPatch).length === 0) return null;

  await updateLanPlayerNumbers(db, latestPlayer.id, cleanPatch, { syncPayload: false });
  const updatedPlayer = await getLatestHostPlayer(db, input.sessionId, input.playerId);
  const entityRevision = Math.max(0, Math.floor(Number(updatedPlayer?.revisionSeq || 0)));
  traceStateChange('STATE_CHANGE', 'HOST_PLAYER_NUMBER_PATCH_SQLITE_APPLIED', {
    hpCurrent: latestPlayer.hpCurrent,
    hpMax: latestPlayer.hpMax,
    tempHp: latestPlayer.tempHp,
    xp: latestPlayer.xp,
    gp: latestPlayer.gp,
    sp: latestPlayer.sp,
    cp: latestPlayer.cp,
    revisionSeq: latestPlayer.revisionSeq,
  }, {
    hpCurrent: updatedPlayer?.hpCurrent,
    hpMax: updatedPlayer?.hpMax,
    tempHp: updatedPlayer?.tempHp,
    xp: updatedPlayer?.xp,
    gp: updatedPlayer?.gp,
    sp: updatedPlayer?.sp,
    cp: updatedPlayer?.cp,
    revisionSeq: updatedPlayer?.revisionSeq,
  }, {
    source: 'lanHostEngine',
    sessionId: input.sessionId,
    playerId: input.playerId,
    playerKey: latestPlayer.remoteKey,
    playerName: latestPlayer.characterName,
    patch: cleanPatch,
  });

  const authoritativePatch: LanHostNumberPatch = {
    hpCurrent: updatedPlayer?.hpCurrent ?? latestPlayer.hpCurrent,
    hpMax: updatedPlayer?.hpMax ?? latestPlayer.hpMax,
    tempHp: updatedPlayer?.tempHp ?? latestPlayer.tempHp,
    xp: updatedPlayer?.xp ?? latestPlayer.xp,
    gp: updatedPlayer?.gp ?? latestPlayer.gp,
    sp: updatedPlayer?.sp ?? latestPlayer.sp,
    cp: updatedPlayer?.cp ?? latestPlayer.cp,
  };

  const event = await rememberAndSendLanSessionEvent(db, input.joinUrl, {
    id: makeLanEventId(),
    sessionId: input.sessionId,
    type: 'player_patch',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: latestPlayer.remoteKey || '',
    toName: latestPlayer.characterName,
    entityType: 'player',
    entityId: latestPlayer.remoteKey || String(latestPlayer.id),
    entityRevision,
    ackRequired: true,
    originClientId: 'master',
    numberPatch: authoritativePatch,
    message: input.message,
    createdAt: new Date().toISOString(),
  });
  if (event) {
    traceLanEvent('HOST_PLAYER_PATCH_EVENT_SENT', event, {
      source: 'lanHostEngine',
      functionName: 'applyHostPlayerNumberPatch',
      sessionId: input.sessionId,
      playerId: input.playerId,
      patch: authoritativePatch,
      changedPatch: cleanPatch,
    });
  }

  const result = {
    player: updatedPlayer || latestPlayer,
    patch: authoritativePatch,
    event,
  } satisfies LanHostPlayerPatchResult;
  traceFunctionReturn('applyHostPlayerNumberPatch', result, {
    source: 'lanHostEngine',
    sessionId: input.sessionId,
    playerId: input.playerId,
  });
  return result;
}

async function getLatestHostPlayer(db: SQLiteDatabase, sessionId: string, playerId: number) {
  const state = await getLanSessionState(db, sessionId);
  return state.players.find((player) => player.id === playerId) || null;
}

function cleanNumberPatch(patch: LanHostNumberPatch, player: LanSessionPlayerState) {
  const cleanPatch: LanHostNumberPatch = {};
  const hpMax = Math.max(0, Math.floor(Number(patch.hpMax ?? player.hpMax) || 0));

  if (patch.hpMax != null) cleanPatch.hpMax = hpMax;
  if (patch.hpCurrent != null) {
    cleanPatch.hpCurrent = Math.max(0, Math.min(hpMax, Math.floor(Number(patch.hpCurrent) || 0)));
  }
  if (patch.tempHp != null) cleanPatch.tempHp = Math.max(0, Math.floor(Number(patch.tempHp) || 0));
  if (patch.xp != null) cleanPatch.xp = Math.max(0, Math.floor(Number(patch.xp) || 0));
  if (patch.gp != null) cleanPatch.gp = Math.max(0, Math.floor(Number(patch.gp) || 0));
  if (patch.sp != null) cleanPatch.sp = Math.max(0, Math.floor(Number(patch.sp) || 0));
  if (patch.cp != null) cleanPatch.cp = Math.max(0, Math.floor(Number(patch.cp) || 0));

  return cleanPatch;
}
