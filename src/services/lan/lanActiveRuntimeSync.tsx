import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';

import {
  ackLanSessionEvent,
  applyLanPlayerInventoryPatch,
  fetchLanSessionEvents,
  nackLanSessionEvent,
  requestLanSessionResync,
  subscribeLanSessionClientUpdates,
  type LanSessionEvent,
} from '@/services/lanSession';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import { LAN_ENGINE_PROJECTION_MODE, shouldPlayerProcessLanEvent } from '@/services/lan/lanClientEngine';
import { applyIncomingLegacyLanEvent } from '@/services/lan/engine/LanEngineBridge';
import { LAN_NETWORK_LIMITS } from '@/services/lan/lanNetworkPolicy';
import { getKnownLanEntityRevisions, useLanRealtimeStore } from '@/stores/lanRealtimeStore';

type LanEffectPatch = NonNullable<LanSessionEvent['effectPatch']>;

type ActiveLanBinding = {
  role: 'player' | 'master';
  sessionId: string;
  joinUrl: string;
  characterId?: number;
  characterName?: string;
  remoteKey?: string;
  status: string;
  updatedAt?: string;
};

const ACTIVE_BINDING_POLL_MS = 1200;
const BACKGROUND_POLL_MS = 3000;
const EVENT_POLL_OVERLAP_MS = 8000;
const PLAYER_REVISION_TIMESTAMP_THRESHOLD = 1_000_000;
const REMOVED_LIVE_EFFECT_TOMBSTONE_TTL_MS = 120000;
const removedLiveEffectIds = new Map<string, number>();

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toSafeEntityRevision = (value: unknown) => {
  const revision = Math.max(0, toInt(value, 0));
  return revision > PLAYER_REVISION_TIMESTAMP_THRESHOLD ? 0 : revision;
};

const safeJsonParse = <T,>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function isTempHpEffectSnapshot(effect: any) {
  return String(effect?.target || '').toUpperCase() === 'PV_TEMP' ||
    String(effect?.kind || '').toLowerCase() === 'temp_hp';
}

function isLiveEffectSnapshot(effect: any) {
  if (!effect || effect.active === false) return false;
  const unit = String(effect?.unit || '').toLowerCase();
  if (effect?.isPermanent === true || unit === 'permanent' || unit === 'manual' || unit === 'while_equipped' || unit === 'concentration') return true;
  return Math.max(0, toInt(effect?.remaining, 0)) > 0;
}

function filterLiveEffectSnapshots(effects: any[]) {
  return (Array.isArray(effects) ? effects : []).filter(isLiveEffectSnapshot);
}

function pruneRemovedLiveEffectIds() {
  const now = Date.now();
  for (const [id, expiresAt] of removedLiveEffectIds.entries()) {
    if (expiresAt <= now) removedLiveEffectIds.delete(id);
  }
}

function getLiveEffectIds(effect: any) {
  return [
    effect?.id,
    effect?.lanEffectId,
    effect?.lanEffectID,
    effect?.sourceId,
  ].map((value) => String(value || '')).filter(Boolean);
}

function rememberRemovedLiveEffectIds(ids: string[]) {
  pruneRemovedLiveEffectIds();
  const expiresAt = Date.now() + REMOVED_LIVE_EFFECT_TOMBSTONE_TTL_MS;
  for (const id of ids.map(String).filter(Boolean)) removedLiveEffectIds.set(id, expiresAt);
}

function isLiveEffectTombstoned(effect: any) {
  pruneRemovedLiveEffectIds();
  return getLiveEffectIds(effect).some((id) => removedLiveEffectIds.has(id));
}

function syncTempHpEffectsWithNumber(effects: any[], tempHp: unknown) {
  const safeEffects = Array.isArray(effects) ? effects : [];
  const cleanTempHp = Math.max(0, toInt(tempHp, 0));
  if (cleanTempHp <= 0) return safeEffects.filter((effect) => !isTempHpEffectSnapshot(effect));

  const tempEffects = safeEffects
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => isTempHpEffectSnapshot(effect));
  if (tempEffects.length === 0) return safeEffects;

  const selected = tempEffects.reduce((best, entry) => {
    const bestValue = Math.max(0, toInt(best.effect?.value, 0));
    const entryValue = Math.max(0, toInt(entry.effect?.value, 0));
    return entryValue > bestValue ? entry : best;
  });

  return safeEffects.flatMap((effect, index) => {
    if (!isTempHpEffectSnapshot(effect)) return [effect];
    if (index !== selected.index) return [];
    return [{ ...effect, value: cleanTempHp }];
  });
}

function getEventSeq(event: LanSessionEvent) {
  return Number(event.seq ?? event.serverSeq ?? 0) || 0;
}

function getEventRevision(event: LanSessionEvent) {
  if (event.type === 'player_patch' && String((event as any).numberPatchIntent || '') === 'level_up_authoritative_echo') {
    const progressionRevision = Number((event as any).progressionPatch?.revisionSeq || 0) || 0;
    if (progressionRevision > 0 && progressionRevision < 1_000_000) return progressionRevision;
  }
  const raw = Number(event.entityRevision || 0) || 0;
  // Revisoes temporais sao seq, nao revision de entidade. Mantemos como seq e
  // nao deixamos contaminar comparacoes locais do sync global.
  if (raw > PLAYER_REVISION_TIMESTAMP_THRESHOLD) return 0;
  return raw;
}

function isCriticalActiveRuntimeEvent(event: LanSessionEvent) {
  return event.type === 'session_ended' ||
    event.type === 'player_kicked' ||
    event.type === 'session_patch';
}

function getActiveRuntimeEventKey(binding: ActiveLanBinding, event: LanSessionEvent) {
  return `${binding.sessionId}:${binding.remoteKey || binding.characterId || binding.characterName || 'player'}:${String(event.id || event.clientMsgId || '')}`;
}

function getLivePlayerRuntimeKey(binding: ActiveLanBinding) {
  return `${binding.sessionId}:${binding.remoteKey || binding.characterId || binding.characterName || 'self'}`;
}

function publishLivePlayerRuntimeState(binding: ActiveLanBinding, event: LanSessionEvent) {
  if (binding.role !== 'player') return;
  const numberPatch = event.numberPatch || {};
  const progressionPatch: any = (event as any).progressionPatch || {};
  const eventSeq = getEventSeq(event);
  const patch: Record<string, unknown> = {
    sessionId: binding.sessionId,
    playerKey: binding.remoteKey,
    characterId: binding.characterId,
    characterName: binding.characterName,
    revision: getEventRevision(event),
    seq: eventSeq,
  };

  if (numberPatch.hpCurrent != null) patch.hp_current = Math.max(0, toInt(numberPatch.hpCurrent));
  if (numberPatch.hpMax != null) patch.hp_max = Math.max(0, toInt(numberPatch.hpMax));
  if (numberPatch.tempHp != null) patch.temp_hp = Math.max(0, toInt(numberPatch.tempHp));
  if (numberPatch.xp != null) patch.xp = Math.max(0, toInt(numberPatch.xp));
  if (numberPatch.gp != null) patch.gp = Math.max(0, toInt(numberPatch.gp));
  if (numberPatch.sp != null) patch.sp = Math.max(0, toInt(numberPatch.sp));
  if (numberPatch.cp != null) patch.cp = Math.max(0, toInt(numberPatch.cp));
  if (Object.values(numberPatch || {}).some((value) => value !== undefined)) patch.numbersSeq = eventSeq;

  if (progressionPatch.level != null) patch.level = Math.max(1, toInt(progressionPatch.level, 1));
  if (progressionPatch.className != null) patch.class = String(progressionPatch.className || '');
  if (progressionPatch.race != null) patch.race = String(progressionPatch.race || '');
  if (progressionPatch.stats != null) { patch.stats = progressionPatch.stats; patch.statsSeq = eventSeq; }
  if ((event as any).statsPatch && typeof (event as any).statsPatch === 'object') {
    // v104: ajuste permanente de atributo via mestre chega como statsPatch em
    // player_patch. Com single-writer global, a ficha nao aplica mais o hook local;
    // entao o runtime global precisa publicar stats imediatamente.
    patch.stats = (event as any).statsPatch;
    patch.statsSeq = eventSeq;
  }
  if ((event as any).inventoryPatch?.equipment) {
    // v105: item/doacao/troca precisa entrar na ficha pelo runtime vivo, sem
    // esperar SQLite/snapshot. O equipment e estado final autoritativo.
    patch.equipment = (event as any).inventoryPatch.equipment;
    patch.equipmentSeq = eventSeq;
  }

  const hasEffectPatch = Boolean(event.effectPatch);
  const hasTempHpNumberPatch = event.numberPatch?.tempHp != null;
  if (hasEffectPatch || hasTempHpNumberPatch) {
    const runtimeKey = getLivePlayerRuntimeKey(binding);
    const currentLive = useLanRealtimeStore.getState().livePlayerStates[runtimeKey];
    const currentEffects = Array.isArray(currentLive?.active_effects)
      ? currentLive?.active_effects as any[]
      : safeJsonParse<any[]>(currentLive?.active_effects_json, []);
    let nextEffects = hasEffectPatch ? applyEffectPatch(currentEffects, event.effectPatch as LanEffectPatch) : currentEffects;
    // v102: PV temporário é número autoritativo. Se tempHp chegou 0, nenhum
    // efeito temp_hp/PV_TEMP pode continuar aparecendo na ficha, mesmo se o remove
    // por id falhar ou o evento vier só como numberPatch.
    if (hasTempHpNumberPatch) nextEffects = syncTempHpEffectsWithNumber(nextEffects, event.numberPatch?.tempHp);
    nextEffects = filterLiveEffectSnapshots(nextEffects);
    patch.active_effects = nextEffects;
    patch.active_effects_json = JSON.stringify(nextEffects);
    patch.effectsSeq = eventSeq;
  }

  useLanRealtimeStore.getState().mergeLivePlayerState(getLivePlayerRuntimeKey(binding), patch as any);
  debugLanFlow('LAN_ACTIVE_RUNTIME_LIVE_STATE_PUBLISHED_V98', {
    sessionId: binding.sessionId,
    characterId: binding.characterId,
    playerKey: binding.remoteKey,
    eventId: event.id,
    type: event.type,
    revision: patch.revision,
    seq: patch.seq,
    hpCurrent: patch.hp_current,
    hpMax: patch.hp_max,
    xp: patch.xp,
  });
}

async function getActiveLanBinding(db: SQLiteDatabase): Promise<ActiveLanBinding | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM (
        SELECT 'player' as role,
               b.session_id as sessionId,
               COALESCE(b.join_url, s.join_url) as joinUrl,
               b.character_id as characterId,
               b.remote_key as remoteKey,
               c.name as characterName,
               COALESCE(s.status, 'active') as status,
               COALESCE(b.updated_at, b.joined_at, s.updated_at, s.created_at) as updatedAt
          FROM lan_local_character_bindings b
          JOIN lan_sessions s ON s.id = b.session_id
          JOIN characters c ON c.id = b.character_id
         WHERE COALESCE(b.is_active, 1) = 1
           AND COALESCE(s.active, 1) = 1
           AND COALESCE(s.status, 'active') = 'active'
        UNION ALL
        SELECT 'master' as role,
               id as sessionId,
               join_url as joinUrl,
               NULL as characterId,
               NULL as remoteKey,
               NULL as characterName,
               COALESCE(status, 'active') as status,
               COALESCE(updated_at, created_at) as updatedAt
          FROM lan_sessions
         WHERE COALESCE(is_master, 0) = 1
           AND COALESCE(active, 1) = 1
           AND COALESCE(status, 'active') = 'active'
      ) active_lan
      ORDER BY updatedAt DESC
      LIMIT 1`
  ).catch(() => null);

  if (!row?.sessionId || !row?.joinUrl) return null;

  return {
    role: String(row.role || 'player') === 'master' ? 'master' : 'player',
    sessionId: String(row.sessionId),
    joinUrl: String(row.joinUrl),
    characterId: row.characterId == null ? undefined : Number(row.characterId || 0) || undefined,
    characterName: row.characterName ? String(row.characterName) : undefined,
    remoteKey: row.remoteKey ? String(row.remoteKey) : undefined,
    status: String(row.status || 'active'),
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
  };
}

function sameBinding(left: ActiveLanBinding | null, right: ActiveLanBinding | null) {
  return String(left?.role || '') === String(right?.role || '') &&
    String(left?.sessionId || '') === String(right?.sessionId || '') &&
    String(left?.joinUrl || '') === String(right?.joinUrl || '') &&
    String(left?.remoteKey || '') === String(right?.remoteKey || '') &&
    Number(left?.characterId || 0) === Number(right?.characterId || 0) &&
    String(left?.status || '') === String(right?.status || '');
}

function shouldProcessForBinding(event: LanSessionEvent, binding: ActiveLanBinding) {
  if (binding.role !== 'player') return false;
  if (event.sessionId !== binding.sessionId) return false;
  return shouldPlayerProcessLanEvent(event, {
    sessionId: binding.sessionId,
    selfKey: binding.remoteKey,
    characterName: binding.characterName,
    includeGlobal: true,
  });
}

async function getLocalPlayerRow(db: SQLiteDatabase, binding: ActiveLanBinding) {
  if (!binding.remoteKey) return null;
  return db.getFirstAsync<Record<string, unknown>>(
    `SELECT *
       FROM lan_session_players
      WHERE session_id = ?
        AND remote_key = ?
        AND COALESCE(is_active, 1) = 1
      ORDER BY id DESC
      LIMIT 1`,
    [binding.sessionId, binding.remoteKey]
  ).catch(() => null);
}

async function persistNumberPatchGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.characterId || !event.numberPatch) return;
  const patch = event.numberPatch;
  const revision = getEventRevision(event);
  const currentPlayer = event.type === 'player_patch' ? await getLocalPlayerRow(db, binding) : null;
  const currentRevision = toSafeEntityRevision(currentPlayer?.revision_seq);
  // v105: somente player_patch numerico usa revision_seq do jogador como guarda.
  // effect_patch com tempHp=0 nao pode ser bloqueado por HP/XP/stats mais novos.
  if (event.type === 'player_patch' && revision > 0 && currentRevision > revision) {
    debugLanFlow('LAN_ACTIVE_RUNTIME_SKIP_OLDER_NUMBER_PATCH_V105', {
      sessionId: binding.sessionId,
      playerKey: binding.remoteKey,
      eventId: event.id,
      revision,
      currentRevision,
    });
    return;
  }
  const entries = Object.entries({
    hpCurrent: patch.hpCurrent,
    hpMax: patch.hpMax,
    tempHp: patch.tempHp,
    xp: patch.xp,
    gp: patch.gp,
    sp: patch.sp,
    cp: patch.cp,
  }).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;

  const characterColumnMap: Record<string, string> = {
    hpCurrent: 'hp_current',
    hpMax: 'hp_max',
    tempHp: 'temp_hp',
    xp: 'xp',
    gp: 'gp',
    sp: 'sp',
    cp: 'cp',
  };
  const playerColumnMap: Record<string, string> = {
    hpCurrent: 'hp_current',
    hpMax: 'hp_max',
    tempHp: 'temp_hp',
    xp: 'xp',
    gp: 'gp',
    sp: 'sp',
    cp: 'cp',
  };

  const setCharacterSqlParts = entries.map(([key]) => `${characterColumnMap[key]} = ?`);
  const values = entries.map(([, value]) => Math.max(0, toInt(value)));
  let nextEffectsJson: string | null = null;
  if (patch.tempHp != null) {
    const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT active_effects_json FROM characters WHERE id = ? LIMIT 1`,
      [binding.characterId]
    ).catch(() => null);
    const currentEffects = filterLiveEffectSnapshots(safeJsonParse<any[]>(currentCharacter?.active_effects_json, []));
    nextEffectsJson = JSON.stringify(syncTempHpEffectsWithNumber(currentEffects, patch.tempHp));
    setCharacterSqlParts.push('active_effects_json = ?');
  }
  const characterValues = nextEffectsJson == null ? values : [...values, nextEffectsJson];
  await db.runAsync(
    `UPDATE characters
        SET ${setCharacterSqlParts.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [...characterValues, binding.characterId]
  ).catch(() => undefined);

  if (binding.remoteKey) {
    const setPlayerSqlParts = entries.map(([key]) => `${playerColumnMap[key]} = ?`);
    const playerValues: any[] = [...values];
    if (nextEffectsJson != null) {
      setPlayerSqlParts.push('effects_json = ?');
      playerValues.push(nextEffectsJson);
    }
    await db.runAsync(
      `UPDATE lan_session_players
          SET ${setPlayerSqlParts.join(', ')},
              revision_seq = CASE
                WHEN ? > COALESCE(revision_seq, 0) THEN ?
                ELSE COALESCE(revision_seq, 0)
              END,
              last_seen_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
          AND remote_key = ?
          AND COALESCE(is_active, 1) = 1`,
      ([...playerValues, Number(revision) || 0, Number(revision) || 0, String(binding.sessionId), String(binding.remoteKey)] as any)
    ).catch(() => undefined);
  }
}

async function persistProgressionGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.characterId || !(event as any).progressionPatch) return;
  const patch = (event as any).progressionPatch || {};
  const current = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM characters WHERE id = ? LIMIT 1`,
    [binding.characterId]
  ).catch(() => null);
  if (!current) return;
  const revision = getEventRevision(event);
  const currentPlayer = await getLocalPlayerRow(db, binding);
  const currentRevision = toSafeEntityRevision(currentPlayer?.revision_seq);
  if (revision > 0 && currentRevision > revision) {
    debugLanFlow('LAN_ACTIVE_RUNTIME_SKIP_OLDER_PROGRESSION_PATCH_V96', {
      sessionId: binding.sessionId,
      playerKey: binding.remoteKey,
      eventId: event.id,
      revision,
      currentRevision,
    });
    return;
  }

  const nextLevel = Math.max(1, toInt(patch.level ?? current.level, 1));
  const nextClass = String(patch.className ?? current.class ?? '').trim() || String(current.class || '');
  const nextRace = String(patch.race ?? current.race ?? '').trim() || String(current.race || '');
  const nextHpMax = Math.max(1, toInt(patch.hpMax ?? event.numberPatch?.hpMax ?? current.hp_max, 1));
  const nextHpCurrent = Math.max(0, Math.min(nextHpMax, toInt(patch.hpCurrent ?? event.numberPatch?.hpCurrent ?? current.hp_current, 0)));
  const nextStats = patch.stats && typeof patch.stats === 'object'
    ? JSON.stringify(patch.stats)
    : typeof patch.stats === 'string'
      ? patch.stats
      : String(current.stats || '{}');

  await db.runAsync(
    `UPDATE characters
        SET level = ?, class = ?, race = ?, hp_current = ?, hp_max = ?, stats = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [nextLevel, nextClass, nextRace, nextHpCurrent, nextHpMax, nextStats, binding.characterId]
  ).catch(() => undefined);

  if (binding.remoteKey) {
    await db.runAsync(
      `UPDATE lan_session_players
          SET level = ?, class_name = ?, race = ?, hp_current = ?, hp_max = ?, stats_json = ?,
              revision_seq = CASE
                WHEN ? > COALESCE(revision_seq, 0) THEN ?
                ELSE COALESCE(revision_seq, 0)
              END,
              last_seen_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
          AND remote_key = ?
          AND COALESCE(is_active, 1) = 1`,
      [nextLevel, nextClass, nextRace, nextHpCurrent, nextHpMax, nextStats, revision, revision, binding.sessionId, binding.remoteKey]
    ).catch(() => undefined);
  }
}

function applyEffectPatch(currentEffects: any[], patch: LanEffectPatch) {
  const removeSet = new Set((patch.remove || []).map(String));
  if (removeSet.size > 0) rememberRemovedLiveEffectIds(Array.from(removeSet));
  const byId = new Map<string, any>();
  if (patch.replace === true) {
    for (const effect of patch.add || []) {
      const id = String((effect as any)?.id || '');
      if (id && !removeSet.has(id) && !isLiveEffectTombstoned(effect)) byId.set(id, effect);
    }
    return filterLiveEffectSnapshots(Array.from(byId.values()));
  }
  for (const effect of currentEffects || []) {
    const id = String(effect?.id || '');
    const lanEffectId = String(effect?.lanEffectId || effect?.lanEffectID || '');
    const sourceId = String(effect?.sourceId || '');
    if (id && !removeSet.has(id) && !removeSet.has(lanEffectId) && !removeSet.has(sourceId) && !isLiveEffectTombstoned(effect)) byId.set(id, effect);
  }
  for (const effect of patch.update || []) {
    const id = String((effect as any)?.id || '');
    const lanEffectId = String((effect as any)?.lanEffectId || (effect as any)?.lanEffectID || '');
    const sourceId = String((effect as any)?.sourceId || '');
    if (id && !removeSet.has(id) && !removeSet.has(lanEffectId) && !removeSet.has(sourceId) && !isLiveEffectTombstoned(effect)) {
      byId.set(id, mergeEffectUpdatePreservingElapsedDuration(byId.get(id), effect));
    }
  }
  for (const effect of patch.add || []) {
    const id = String((effect as any)?.id || '');
    const lanEffectId = String((effect as any)?.lanEffectId || (effect as any)?.lanEffectID || '');
    const sourceId = String((effect as any)?.sourceId || '');
    if (id && !removeSet.has(id) && !removeSet.has(lanEffectId) && !removeSet.has(sourceId) && !isLiveEffectTombstoned(effect)) {
      byId.set(id, mergeEffectUpdatePreservingElapsedDuration(byId.get(id), effect));
    }
  }
  return filterLiveEffectSnapshots(Array.from(byId.values()));
}

function mergeEffectUpdatePreservingElapsedDuration(current: any, incoming: any) {
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
}

async function persistEffectPatchGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.characterId || !event.effectPatch) return;
  const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT active_effects_json, temp_hp FROM characters WHERE id = ? LIMIT 1`,
    [binding.characterId]
  ).catch(() => null);
  const runtimeKey = getLivePlayerRuntimeKey(binding);
  const currentLive = useLanRealtimeStore.getState().livePlayerStates[runtimeKey];
  const currentLiveEffects = Array.isArray((currentLive as any)?.active_effects)
    ? ((currentLive as any).active_effects as any[])
    : safeJsonParse<any[]>((currentLive as any)?.active_effects_json, []);
  // v107: a base do patch de efeitos deve ser o runtime vivo quando existir.
  // Se usarmos SQLite antigo como base, um remove/add pode ressuscitar efeitos
  // que ja tinham expirado/removido no store em tempo real.
  const currentEffects = filterLiveEffectSnapshots(
    (currentLiveEffects.length > 0 || Number((currentLive as any)?.effectsSeq || 0) > 0)
      ? currentLiveEffects
      : safeJsonParse<any[]>(currentCharacter?.active_effects_json, [])
  );
  const tempHp = event.numberPatch?.tempHp == null
    ? Math.max(0, toInt(currentCharacter?.temp_hp, 0))
    : Math.max(0, toInt(event.numberPatch.tempHp, 0));
  let nextEffects = applyEffectPatch(currentEffects, event.effectPatch);
  if (event.numberPatch?.tempHp != null) {
    nextEffects = syncTempHpEffectsWithNumber(nextEffects, tempHp);
  }
  nextEffects = filterLiveEffectSnapshots(nextEffects);
  await db.runAsync(
    `UPDATE characters
        SET active_effects_json = ?, temp_hp = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [JSON.stringify(nextEffects), tempHp, binding.characterId]
  ).catch(() => undefined);

  if (binding.remoteKey) {
    await db.runAsync(
      `UPDATE lan_session_players
          SET effects_json = ?, temp_hp = ?,
              last_seen_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
          AND remote_key = ?
          AND COALESCE(is_active, 1) = 1`,
      [JSON.stringify(nextEffects), tempHp, binding.sessionId, binding.remoteKey]
    ).catch(() => undefined);
  }
}

async function persistStatsPatchGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.characterId || !(event as any).statsPatch || typeof (event as any).statsPatch !== 'object') return;
  const statsPatch = (event as any).statsPatch as Record<string, unknown>;
  const revision = getEventRevision(event);

  const statsJson = JSON.stringify(statsPatch);
  await db.runAsync(
    `UPDATE characters
        SET stats = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [statsJson, binding.characterId]
  ).catch(() => undefined);

  if (binding.remoteKey) {
    await db.runAsync(
      `UPDATE lan_session_players
          SET stats_json = ?,
              revision_seq = CASE
                WHEN ? > COALESCE(revision_seq, 0) THEN ?
                ELSE COALESCE(revision_seq, 0)
              END,
              last_seen_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
          AND remote_key = ?
          AND COALESCE(is_active, 1) = 1`,
      [statsJson, revision, revision, binding.sessionId, binding.remoteKey]
    ).catch(() => undefined);
  }
}

async function persistInventoryPatchGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.remoteKey || !event.inventoryPatch?.equipment) return;
  const revision = getEventRevision(event);
  void revision;
  await applyLanPlayerInventoryPatch(
    db,
    binding.sessionId,
    event.inventoryPatch.targetKey || binding.remoteKey,
    event.inventoryPatch.equipment,
    true,
    event.inventoryPatch.baseEquipment
  ).catch(() => false);
}

async function persistSessionPatchGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  const status = event.sessionPatch?.status;
  if (status !== 'paused' && status !== 'active') return;
  await db.runAsync(
    `UPDATE lan_sessions
        SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [status, binding.sessionId]
  ).catch(() => undefined);
}

async function persistSessionEndGlobally(db: SQLiteDatabase, binding: ActiveLanBinding) {
  await db.runAsync(
    `UPDATE lan_local_character_bindings
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?`,
    [binding.sessionId]
  ).catch(() => undefined);
  await db.runAsync(
    `UPDATE lan_sessions
        SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [binding.sessionId]
  ).catch(() => undefined);
}

async function persistPlayerEventGlobally(db: SQLiteDatabase, binding: ActiveLanBinding, event: LanSessionEvent) {
  if (event.type === 'session_ended' || event.type === 'player_kicked') {
    await persistSessionEndGlobally(db, binding);
    return;
  }
  if (event.type === 'session_patch') {
    await persistSessionPatchGlobally(db, binding, event);
    return;
  }
  if (event.type === 'player_patch') {
    if ((event as any).progressionPatch) await persistProgressionGlobally(db, binding, event);
    if ((event as any).statsPatch) await persistStatsPatchGlobally(db, binding, event);
    if (event.numberPatch) await persistNumberPatchGlobally(db, binding, event);
    return;
  }
  if (event.type === 'effect_patch') {
    if (event.numberPatch) await persistNumberPatchGlobally(db, binding, event);
    await persistEffectPatchGlobally(db, binding, event);
    return;
  }
  if (event.type === 'inventory_patch') {
    await persistInventoryPatchGlobally(db, binding, event);
  }
}

async function ackActiveRuntimeEvent(binding: ActiveLanBinding, event: LanSessionEvent) {
  if (!binding.joinUrl || !binding.sessionId) return;
  await ackLanSessionEvent(binding.joinUrl, {
    sessionId: binding.sessionId,
    eventId: event.id,
    clientMsgId: event.clientMsgId,
    playerKey: binding.remoteKey,
    lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
    entityId: event.entityId,
    entityRevision: event.entityRevision,
  }).catch((error) => {
    debugLanFlow('LAN_ACTIVE_RUNTIME_ACK_FAILED_V99', {
      sessionId: binding.sessionId,
      playerKey: binding.remoteKey,
      eventId: event.id,
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function nackActiveRuntimeEvent(binding: ActiveLanBinding, event: LanSessionEvent, reason: string) {
  if (!binding.joinUrl || !binding.sessionId) return;
  await nackLanSessionEvent(binding.joinUrl, {
    sessionId: binding.sessionId,
    eventId: event.id,
    clientMsgId: event.clientMsgId,
    playerKey: binding.remoteKey,
    reason,
  }).catch(() => false);
}

export function LanActiveRuntimeSync() {
  const db = useSQLiteContext();
  const [binding, setBinding] = useState<ActiveLanBinding | null>(null);
  const bindingRef = useRef<ActiveLanBinding | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const lastSeqRef = useRef(0);
  const pollRunningRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const next = await getActiveLanBinding(db);
      if (disposed) return;
      setBinding((current) => {
        if (sameBinding(current, next)) return current;
        bindingRef.current = next;
        seenEventIdsRef.current.clear();
        lastSeqRef.current = 0;
        if (next) {
          debugLanFlow('LAN_ACTIVE_RUNTIME_BINDING_CHANGED_V96', {
            role: next.role,
            sessionId: next.sessionId,
            characterId: next.characterId,
            characterName: next.characterName,
            remoteKey: next.remoteKey,
            status: next.status,
          });
        }
        return next;
      });
    };
    void refresh();
    const timer = setInterval(refresh, ACTIVE_BINDING_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [db]);

  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      const current = bindingRef.current;
      if (state === 'active' && current?.role === 'player' && current.status !== 'ended') {
        void requestLanSessionResync(current.joinUrl, {
          sessionId: current.sessionId,
          playerKey: current.remoteKey,
          lastAppliedSeq: 0,
          knownRevisions: getKnownLanEntityRevisions(current.sessionId),
          includeGlobal: true,
          forceReconnect: true,
        }).catch(() => false);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!binding || binding.role !== 'player' || binding.status === 'ended' || !binding.joinUrl || !binding.sessionId) return;
    let disposed = false;

    const processEvent = async (event: LanSessionEvent, source: string) => {
      if (disposed || !shouldProcessForBinding(event, binding)) return;
      const key = String(event.id || event.clientMsgId || '');
      if (!key) return;
      const scopedKey = getActiveRuntimeEventKey(binding, event);
      if (seenEventIdsRef.current.has(scopedKey)) return;

      const runtime = useLanRealtimeStore.getState();
      const decision = runtime.getEventApplyDecision(event);
      const forceCritical = isCriticalActiveRuntimeEvent(event) && decision.reason !== 'duplicate_id';
      if (!decision.apply && !forceCritical) {
        seenEventIdsRef.current.add(scopedKey);
        lastSeqRef.current = Math.max(lastSeqRef.current, getEventSeq(event));
        debugLanFlow('LAN_ACTIVE_RUNTIME_EVENT_SKIPPED_BY_STORE_V99', {
          sessionId: binding.sessionId,
          characterId: binding.characterId,
          playerKey: binding.remoteKey,
          source,
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          reason: decision.reason,
          currentRevision: decision.currentRevision,
          nextRevision: decision.nextRevision,
        });
        void ackActiveRuntimeEvent(binding, event);
        return;
      }

      seenEventIdsRef.current.add(scopedKey);
      lastSeqRef.current = Math.max(lastSeqRef.current, getEventSeq(event));

      if (LAN_ENGINE_PROJECTION_MODE) {
        const eventType = String(event.type || '');
        const projectionOnly = ['player_patch', 'effect_patch', 'inventory_patch', 'session_patch', 'session_ended'].includes(eventType);
        if (eventType !== 'public_status') {
          applyIncomingLegacyLanEvent(event);
        }
        if (!projectionOnly && eventType !== 'public_status') {
          useLanRealtimeStore.getState().publishLiveEvent(event);
        }
        useLanRealtimeStore.getState().markEventApplied(event);
        debugLanFlow('LAN_ACTIVE_RUNTIME_EVENT_FORWARDED_TO_PROJECTION_ONLY_CUT6', {
          sessionId: binding.sessionId,
          characterId: binding.characterId,
          playerKey: binding.remoteKey,
          source,
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
          decision: projectionOnly ? 'projection_only_no_live_event_store' : 'visual_event_published',
        });
        void ackActiveRuntimeEvent(binding, event);
        return;
      }

      // v99/v105: single writer. O runtime global publica estado vivo e tambem
      // publica eventos de UI (save request, pause, troca, item) para a ficha,
      // sem reabrir socket/hook na tela.
      useLanRealtimeStore.getState().publishLiveEvent(event);
      publishLivePlayerRuntimeState(binding, event);
      useLanRealtimeStore.getState().markEventApplied(event);
      debugLanFlow('LAN_ACTIVE_RUNTIME_EVENT_MARKED_SINGLE_WRITER_V99', {
        sessionId: binding.sessionId,
        characterId: binding.characterId,
        playerKey: binding.remoteKey,
        source,
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
      });

      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await persistPlayerEventGlobally(db, binding, event);
          debugLanFlow('LAN_ACTIVE_RUNTIME_EVENT_PERSISTED_V99', {
            sessionId: binding.sessionId,
            characterId: binding.characterId,
            playerKey: binding.remoteKey,
            source,
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityRevision: event.entityRevision,
          });
          await ackActiveRuntimeEvent(binding, event);
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          debugLanFlow('LAN_ACTIVE_RUNTIME_EVENT_PERSIST_FAILED_V99', {
            sessionId: binding.sessionId,
            characterId: binding.characterId,
            playerKey: binding.remoteKey,
            source,
            eventId: event.id,
            type: event.type,
            reason,
          });
          void nackActiveRuntimeEvent(binding, event, reason);
        });
    };

    const poll = async (reason = 'interval') => {
      if (pollRunningRef.current) return;
      pollRunningRef.current = true;
      try {
        const afterSeq = Math.max(0, lastSeqRef.current - EVENT_POLL_OVERLAP_MS);
        const events = await fetchLanSessionEvents(binding.joinUrl, binding.sessionId, {
          afterSeq,
          playerKey: binding.remoteKey,
          includeGlobal: true,
        });
        const ordered = events.sort((a, b) => getEventSeq(a) - getEventSeq(b));
        for (const event of ordered) {
          await processEvent(event, `poll:${reason}`);
        }
      } catch (error) {
        debugLanFlow('LAN_ACTIVE_RUNTIME_POLL_FAILED_V96', {
          sessionId: binding.sessionId,
          playerKey: binding.remoteKey,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pollRunningRef.current = false;
      }
    };

    void requestLanSessionResync(binding.joinUrl, {
      sessionId: binding.sessionId,
      playerKey: binding.remoteKey,
      lastAppliedSeq: 0,
      knownRevisions: getKnownLanEntityRevisions(binding.sessionId),
      includeGlobal: true,
      forceReconnect: true,
    }).catch(() => false);
    setTimeout(() => { if (!disposed) void poll('mount_250ms'); }, 250);
    setTimeout(() => { if (!disposed) void poll('mount_1200ms'); }, 1200);

    const interval = setInterval(() => {
      const background = appStateRef.current !== 'active';
      void poll(background ? 'background' : 'active');
    }, appStateRef.current === 'active' ? LAN_NETWORK_LIMITS.fallbackPollActiveMs : BACKGROUND_POLL_MS);

    const unsubscribe = subscribeLanSessionClientUpdates(binding.joinUrl, (update) => {
      if (disposed) return;
      if (update?.event) void processEvent(update.event, update.reason || 'socket');
      if (update?.reason === 'socket_closed') {
        void requestLanSessionResync(binding.joinUrl, {
          sessionId: binding.sessionId,
          playerKey: binding.remoteKey,
          lastAppliedSeq: lastSeqRef.current,
          knownRevisions: getKnownLanEntityRevisions(binding.sessionId),
          includeGlobal: true,
          forceReconnect: true,
        }).catch(() => false);
      }
    });

    return () => {
      disposed = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [binding, db]);

  return null;
}
