import type { SQLiteDatabase } from 'expo-sqlite';

import { traceFunctionCall, traceFunctionReturn, traceSqlite, traceStateChange } from '../debug/appTrace';
import { debugLanFlow } from '../lanRuntimeMode';
import { getEffectByStatusKey, normalizeStatusKey } from './effectCatalogService';
import { normalizeEffectDurationUnit } from './effectDurationService';
import { ensureEffectSchema } from './effectSchema';
import type {
  ApplyActiveEffectInput,
  DurationUnit,
  EffectTarget,
  LanActiveEffectSnapshot,
  LanEffectCatalogItem,
  LanEffectPatch,
  LanPendingSave,
} from './effectTypes';

export type ApplyEffectResult = {
  playerId: number;
  sessionId: string;
  targetKey: string;
  targetName: string;
  snapshot: LanActiveEffectSnapshot;
  removed: LanActiveEffectSnapshot[];
  patch: LanEffectPatch;
};

export type RemoveEffectResult = {
  playerId: number;
  sessionId: string;
  targetKey: string;
  targetName: string;
  removed: LanActiveEffectSnapshot;
  patch: LanEffectPatch;
};

export type TickEffectsResult = {
  patches: LanEffectPatch[];
  expired: Array<{
    playerId: number;
    targetKey: string;
    targetName: string;
    effect: LanActiveEffectSnapshot;
  }>;
  pendingSaves: LanPendingSave[];
  restored: Array<{
    playerId: number;
    targetKey: string;
    targetName: string;
    hp: number;
  }>;
};

type PlayerRow = Record<string, unknown> & {
  id: number;
  session_id: string;
  target_key: string;
  target_name: string;
};

export async function applyEffectToPlayer(
  db: SQLiteDatabase,
  playerId: number,
  input: ApplyActiveEffectInput,
): Promise<ApplyEffectResult | null> {
  const startedAt = Date.now();
  traceFunctionCall('applyEffectToPlayer', { playerId, input }, {
    source: 'activeEffectService',
    playerId,
  });
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const session = await getSessionTiming(db, player.session_id);
  const statusKey = normalizeStatusKey(input.statusKey || input.name || 'custom_effect');
  const catalog = input.useCatalogDefaults === false
    ? null
    : statusKey ? await getEffectByStatusKey(db, statusKey) : null;
  const snapshot = buildInputSnapshot(input, catalog, session.currentTurn);
  const normalizedStatusKey = snapshot.statusKey || statusKey || normalizeStatusKey(snapshot.name);
  const removed: LanActiveEffectSnapshot[] = [];
  const isTempHpEffect = isTempHpSnapshot(snapshot);
  const incomingTempHp = getTempHpValue(snapshot);
  const currentRowsForTarget = isTempHpEffect
    ? await getActiveRowsForTarget(db, player.session_id, player.target_key)
    : [];
  const currentTempHpEffects = currentRowsForTarget
    .map(mapActiveEffectRow)
    .filter(isTempHpSnapshot);

  // Regra padrão de D&D: PV temporário NÃO acumula.
  // Se o novo valor for menor/igual ao PV temporário ativo, mantém o atual.
  // Se for maior, substitui todas as fontes antigas por esta nova fonte.
  if (isTempHpEffect) {
    const currentTempHp = currentTempHpEffects.reduce((max, effect) => Math.max(max, getTempHpValue(effect)), 0);

    if (input.sourceId) {
      const duplicatedSource = currentTempHpEffects.find((effect) => effect.sourceId === input.sourceId);
      if (duplicatedSource) {
        debugLanFlow('TEMP_HP_EFFECT_IGNORED_DUPLICATE_SOURCE', {
          sessionId: player.session_id,
          playerId,
          targetKey: player.target_key,
          sourceId: input.sourceId,
          existingEffectId: duplicatedSource.id,
          incomingTempHp,
        });
        return null;
      }
    }

    if (incomingTempHp <= 0) {
      debugLanFlow('TEMP_HP_EFFECT_IGNORED_INVALID_VALUE', {
        sessionId: player.session_id,
        playerId,
        targetKey: player.target_key,
        incomingTempHp,
      });
      return null;
    }

    if (currentTempHpEffects.length > 0 && incomingTempHp <= currentTempHp) {
      debugLanFlow('TEMP_HP_EFFECT_IGNORED_LOWER_OR_EQUAL_STANDARD_DND', {
        sessionId: player.session_id,
        playerId,
        targetKey: player.target_key,
        currentTempHp,
        incomingTempHp,
      });
      return null;
    }

    for (const effect of currentTempHpEffects) {
      removed.push(effect);
      await db.runAsync(
        `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [effect.id],
      );
    }
  }

  if (catalog && !catalog.stackable && !isTempHpEffect) {
    const current = await getActiveRowsForTarget(db, player.session_id, player.target_key, normalizedStatusKey);
    for (const row of current) {
      const existingSnapshot = mapActiveEffectRow(row);
      removed.push(existingSnapshot);
      await db.runAsync(
        `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existingSnapshot.id],
      );
    }
  }

  const id = String((input as any).id || '') || makeActiveEffectId();
  const finalSnapshot: LanActiveEffectSnapshot = {
    ...snapshot,
    id,
    statusKey: normalizedStatusKey,
    status: normalizedStatusKey,
  };

  if (finalSnapshot.unit === 'concentration') {
    const concentrationRows = await getActiveRowsForTarget(db, player.session_id, player.target_key);
    for (const row of concentrationRows) {
      const existingSnapshot = mapActiveEffectRow(row);
      if (existingSnapshot.unit !== 'concentration') continue;
      removed.push(existingSnapshot);
      await db.runAsync(
        `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existingSnapshot.id],
      );
    }
  }

  traceSqlite('SQLITE_WRITE_START', {
    source: 'activeEffectService',
    functionName: 'applyEffectToPlayer',
    table: 'lan_active_effects',
    operation: 'INSERT_EFFECT',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    payload: finalSnapshot,
  });
  await db.runAsync(
    `INSERT INTO lan_active_effects (
      id, session_id, target_key, status_key, source_type, source_id, source_name,
      applied_by_key, applied_by_name, remaining_value, remaining_unit, started_turn,
      expires_at_minutes, save_dc, save_ability, repeat_save, visible_to_player,
      private_note, public_note, stack_count, effect_json, active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      id,
      player.session_id,
      player.target_key,
      finalSnapshot.statusKey || normalizedStatusKey,
      input.sourceType || null,
      input.sourceId || null,
      input.sourceName || finalSnapshot.source || null,
      input.appliedByKey || null,
      input.appliedByName || null,
      finalSnapshot.remaining,
      finalSnapshot.unit,
      session.currentTurn,
      getExpiresAtMinutes(session.elapsedMinutes, finalSnapshot.remaining, finalSnapshot.unit),
      finalSnapshot.saveDc ?? null,
      finalSnapshot.saveAbility || null,
      finalSnapshot.repeatSave || null,
      finalSnapshot.visibleToPlayer === false ? 0 : 1,
      finalSnapshot.privateNote || null,
      finalSnapshot.publicNote || null,
      finalSnapshot.stackCount || 1,
      JSON.stringify(finalSnapshot),
    ],
  );
  traceSqlite('SQLITE_WRITE_DONE', {
    source: 'activeEffectService',
    functionName: 'applyEffectToPlayer',
    table: 'lan_active_effects',
    operation: 'INSERT_EFFECT',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    entityId: id,
  });

  const tempDelta = isTempHpSnapshot(finalSnapshot)
    ? 0
    : getTempHpValue(finalSnapshot) - removed.reduce((sum, effect) => sum + getTempHpValue(effect), 0);
  await rebuildPlayerEffectsCache(db, player, tempDelta, {
    tempHpMode: isTempHpSnapshot(finalSnapshot) ? 'sum_active' : 'delta',
  });

  const result = {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    snapshot: finalSnapshot,
    removed,
    patch: {
      targetKey: player.target_key,
      add: [finalSnapshot],
      update: [],
      remove: removed.map((effect) => effect.id),
    },
  };
  traceFunctionReturn('applyEffectToPlayer', result, {
    source: 'activeEffectService',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    entityId: id,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

export async function removeEffectFromPlayer(
  db: SQLiteDatabase,
  playerId: number,
  effectId: string,
): Promise<RemoveEffectResult | null> {
  const startedAt = Date.now();
  traceFunctionCall('removeEffectFromPlayer', { playerId, effectId }, {
    source: 'activeEffectService',
    playerId,
    entityId: effectId,
  });
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const row = await getActiveRowById(db, effectId);
  if (!row || String(row.session_id) !== player.session_id || String(row.target_key) !== player.target_key) return null;
  const removed = mapActiveEffectRow(row);

  traceSqlite('SQLITE_WRITE_START', {
    source: 'activeEffectService',
    functionName: 'removeEffectFromPlayer',
    table: 'lan_active_effects',
    operation: 'DEACTIVATE_EFFECT',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    entityId: effectId,
    before: removed,
  });
  await db.runAsync(
    `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [effectId],
  );
  await rebuildPlayerEffectsCache(db, player, -getTempHpValue(removed));

  const result = {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    removed,
    patch: {
      targetKey: player.target_key,
      add: [],
      update: [],
      remove: [removed.id],
    },
  };
  traceFunctionReturn('removeEffectFromPlayer', result, {
    source: 'activeEffectService',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    entityId: effectId,
    durationMs: Date.now() - startedAt,
  });
  return result;
}


export async function consumeTempHpFromPlayer(
  db: SQLiteDatabase,
  playerId: number,
  amount: number,
): Promise<{
  playerId: number;
  sessionId: string;
  targetKey: string;
  targetName: string;
  absorbed: number;
  patch: LanEffectPatch;
} | null> {
  const startedAt = Date.now();
  const damageToAbsorb = Math.max(0, Math.floor(Number(amount) || 0));
  traceFunctionCall('consumeTempHpFromPlayer', { playerId, amount: damageToAbsorb }, {
    source: 'activeEffectService',
    playerId,
  });
  if (damageToAbsorb <= 0) return null;

  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const rows = await getActiveRowsForTarget(db, player.session_id, player.target_key);
  const tempHpEffects = rows
    .map(mapActiveEffectRow)
    .filter(isTempHpSnapshot)
    .sort(compareTempHpAbsorptionOrder);

  if (tempHpEffects.length === 0) {
    debugLanFlow('TEMP_HP_DAMAGE_NO_ACTIVE_EFFECTS', {
      sessionId: player.session_id,
      playerId,
      targetKey: player.target_key,
      amount: damageToAbsorb,
    });
    return null;
  }

  let remainingDamage = damageToAbsorb;
  let absorbed = 0;
  const update: LanActiveEffectSnapshot[] = [];
  const remove: string[] = [];

  for (const effect of tempHpEffects) {
    if (remainingDamage <= 0) break;
    const currentValue = getTempHpValue(effect);
    if (currentValue <= 0) continue;

    const consumed = Math.min(currentValue, remainingDamage);
    const nextValue = Math.max(0, currentValue - consumed);
    remainingDamage -= consumed;
    absorbed += consumed;

    if (nextValue <= 0) {
      await db.runAsync(
        `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [effect.id],
      );
      remove.push(effect.id);
    } else {
      const nextSnapshot = { ...effect, value: nextValue };
      await db.runAsync(
        `UPDATE lan_active_effects
         SET effect_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [JSON.stringify(nextSnapshot), effect.id],
      );
      update.push(nextSnapshot);
    }
  }

  if (absorbed <= 0) return null;

  await rebuildPlayerEffectsCache(db, player, 0, { tempHpMode: 'sum_active' });
  const result = {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    absorbed,
    patch: {
      targetKey: player.target_key,
      add: [],
      update,
      remove,
    },
  };

  debugLanFlow('TEMP_HP_EFFECTS_CONSUMED_BY_DAMAGE', {
    sessionId: player.session_id,
    playerId,
    targetKey: player.target_key,
    absorbed,
    updated: update.map((effect) => ({ id: effect.id, value: effect.value, remaining: effect.remaining, unit: effect.unit })),
    removed: remove,
  });
  traceFunctionReturn('consumeTempHpFromPlayer', result, {
    source: 'activeEffectService',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

export async function removeTempHpEffectsFromPlayer(
  db: SQLiteDatabase,
  playerId: number,
): Promise<RemoveEffectResult | null> {
  const startedAt = Date.now();
  traceFunctionCall('removeTempHpEffectsFromPlayer', { playerId }, {
    source: 'activeEffectService',
    playerId,
  });
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const rows = await getActiveRowsForTarget(db, player.session_id, player.target_key);
  const tempHpEffects = rows
    .map(mapActiveEffectRow)
    .filter(isTempHpSnapshot);

  if (tempHpEffects.length === 0) {
    debugLanFlow('TEMP_HP_DEPLETED_NO_EFFECT_FOUND', {
      sessionId: player.session_id,
      playerId,
      targetKey: player.target_key,
    });
    return null;
  }

  debugLanFlow('TEMP_HP_EFFECT_FOUND', {
    sessionId: player.session_id,
    playerId,
    targetKey: player.target_key,
    effectIds: tempHpEffects.map((effect) => effect.id),
  });

  for (const effect of tempHpEffects) {
    await db.runAsync(
      `UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [effect.id],
    );
  }

  await rebuildPlayerEffectsCache(db, player, 0, { tempHpMode: 'sum_active' });
  const removed = tempHpEffects[0];
  const result = {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    removed,
    patch: {
      targetKey: player.target_key,
      add: [],
      update: [],
      remove: tempHpEffects.map((effect) => effect.id),
    },
  };

  debugLanFlow('TEMP_HP_EFFECT_EXPIRED', {
    sessionId: player.session_id,
    playerId,
    targetKey: player.target_key,
    removedCount: tempHpEffects.length,
  });
  traceFunctionReturn('removeTempHpEffectsFromPlayer', result, {
    source: 'activeEffectService',
    sessionId: player.session_id,
    playerId,
    playerKey: player.target_key,
    playerName: player.target_name,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

export async function reduceEffectDuration(
  db: SQLiteDatabase,
  playerId: number,
  effectId: string,
  delta: number,
): Promise<RemoveEffectResult | ApplyEffectResult | null> {
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const row = await getActiveRowById(db, effectId);
  if (!row) return null;
  const snapshot = mapActiveEffectRow(row);
  const nextRemaining = Math.max(0, snapshot.remaining - Math.max(1, Math.floor(delta)));
  if (nextRemaining <= 0) return removeEffectFromPlayer(db, playerId, effectId);

  const nextSnapshot = { ...snapshot, remaining: nextRemaining };
  await db.runAsync(
    `UPDATE lan_active_effects
     SET remaining_value = ?, effect_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextRemaining, JSON.stringify(nextSnapshot), effectId],
  );
  await rebuildPlayerEffectsCache(db, player, 0);

  return {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    snapshot: nextSnapshot,
    removed: [],
    patch: {
      targetKey: player.target_key,
      add: [],
      update: [nextSnapshot],
      remove: [],
    },
  };
}

export async function extendEffectDuration(
  db: SQLiteDatabase,
  playerId: number,
  effectId: string,
  delta: number,
) {
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return null;
  await backfillPlayerActiveEffectsFromCache(db, player);

  const row = await getActiveRowById(db, effectId);
  if (!row) return null;
  const snapshot = mapActiveEffectRow(row);
  const nextSnapshot = {
    ...snapshot,
    remaining: snapshot.remaining + Math.max(1, Math.floor(delta)),
  };
  await db.runAsync(
    `UPDATE lan_active_effects
     SET remaining_value = ?, effect_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextSnapshot.remaining, JSON.stringify(nextSnapshot), effectId],
  );
  await rebuildPlayerEffectsCache(db, player, 0);
  return {
    playerId,
    sessionId: player.session_id,
    targetKey: player.target_key,
    targetName: player.target_name,
    snapshot: nextSnapshot,
    removed: [],
    patch: { targetKey: player.target_key, add: [], update: [nextSnapshot], remove: [] },
  };
}

export async function tickTurnEffects(
  db: SQLiteDatabase,
  sessionId: string,
  unit: 'turn' | 'minute' | 'hour' | 'shortRest' | 'longRest',
): Promise<TickEffectsResult> {
  const startedAt = Date.now();
  traceFunctionCall('tickTurnEffects', { sessionId, unit }, {
    source: 'activeEffectService',
    sessionId,
  });
  await ensureEffectSchema(db);
  const players = await db.getAllAsync<PlayerRow>(
    `SELECT *,
            COALESCE(remote_key, 'player_' || id) as target_key,
            COALESCE(character_name, player_name, 'Personagem') as target_name
     FROM lan_session_players
     WHERE session_id = ? AND COALESCE(is_active, 1) = 1 AND kicked_at IS NULL`,
    [sessionId],
  );

  const result: TickEffectsResult = { patches: [], expired: [], pendingSaves: [], restored: [] };

  for (const player of players) {
    await backfillPlayerActiveEffectsFromCache(db, player);
    const rows = await getActiveRowsForTarget(db, sessionId, player.target_key);
    const patch: LanEffectPatch = { targetKey: player.target_key, add: [], update: [], remove: [] };
    let tempDelta = 0;

    for (const row of rows) {
      const snapshot = mapActiveEffectRow(row);
      const save = await maybeCreateRepeatSave(db, sessionId, player.target_key, snapshot, unit);
      if (save) result.pendingSaves.push(save);
      if (snapshot.isPermanent || snapshot.unit === 'permanent') continue;

      const delta = getDurationDelta(snapshot.unit, unit);
      if (delta <= 0) continue;
      const nextRemaining = Math.max(0, snapshot.remaining - delta);
      if (nextRemaining <= 0) {
        await db.runAsync(`UPDATE lan_active_effects SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [snapshot.id]);
        patch.remove.push(snapshot.id);
        tempDelta -= getTempHpValue(snapshot);
        result.expired.push({
          playerId: Number(player.id),
          targetKey: player.target_key,
          targetName: player.target_name,
          effect: snapshot,
        });
      } else {
        const nextSnapshot = { ...snapshot, remaining: nextRemaining };
        await db.runAsync(
          `UPDATE lan_active_effects
           SET remaining_value = ?, effect_json = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [nextRemaining, JSON.stringify(nextSnapshot), snapshot.id],
        );
        patch.update.push(nextSnapshot);
      }
    }

    if (unit === 'longRest') {
      const nextHp = Math.max(0, toNumber(player.hp_max));
      await db.runAsync(
        `UPDATE lan_session_players
         SET hp_current = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
             last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextHp, Number(player.id)],
      );
      if (player.character_id) {
        await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [nextHp, Number(player.character_id)]);
      }
      result.restored.push({
        playerId: Number(player.id),
        targetKey: player.target_key,
        targetName: player.target_name,
        hp: nextHp,
      });
    }

    if (patch.remove.length || patch.update.length) result.patches.push(patch);
    await rebuildPlayerEffectsCache(db, player, tempDelta, { tempHpMode: 'sum_active' });
  }

  traceFunctionReturn('tickTurnEffects', {
    patchCount: result.patches.length,
    expiredCount: result.expired.length,
    pendingSaveCount: result.pendingSaves.length,
    restoredCount: result.restored.length,
  }, {
    source: 'activeEffectService',
    sessionId,
    args: { unit },
    durationMs: Date.now() - startedAt,
  });
  return result;
}

export async function getActiveEffectsByPlayer(db: SQLiteDatabase, playerId: number) {
  await ensureEffectSchema(db);
  const player = await getPlayerRow(db, playerId);
  if (!player) return [];
  await backfillPlayerActiveEffectsFromCache(db, player);
  const rows = await getActiveRowsForTarget(db, player.session_id, player.target_key);
  return rows.map(mapActiveEffectRow);
}

export async function rebuildPlayerEffectsCache(
  db: SQLiteDatabase,
  player: PlayerRow,
  tempHpDelta = 0,
  options?: { tempHpMode?: 'delta' | 'sum_active' },
) {
  const before = {
    tempHp: player.temp_hp,
    effectsJson: player.effects_json,
  };
  const rows = await getActiveRowsForTarget(db, player.session_id, player.target_key);
  const effects = rows
    .map(mapActiveEffectRow)
    .sort((a, b) => (b.visualPriority || 0) - (a.visualPriority || 0) || a.name.localeCompare(b.name));
  const activeTempHpTotal = effects
    .filter(isTempHpSnapshot)
    .reduce((max, effect) => Math.max(max, getTempHpValue(effect)), 0);
  const nextTempHp = options?.tempHpMode === 'sum_active'
    ? activeTempHpTotal
    : Math.max(0, toNumber(player.temp_hp) + tempHpDelta);

  traceSqlite('SQLITE_WRITE_START', {
    source: 'activeEffectService',
    functionName: 'rebuildPlayerEffectsCache',
    table: 'lan_session_players/characters',
    operation: 'REBUILD_EFFECTS_CACHE',
    sessionId: player.session_id,
    playerId: player.id,
    playerKey: player.target_key,
    playerName: player.target_name,
    before,
    after: { tempHp: nextTempHp, effectCount: effects.length },
  });
  await db.runAsync(
    `UPDATE lan_session_players
     SET effects_json = ?, temp_hp = ?, revision_seq = COALESCE(revision_seq, 0) + 1,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(effects), nextTempHp, Number(player.id)],
  );

  if (player.character_id) {
    await db.runAsync(
      `UPDATE characters
       SET temp_hp = ?, active_effects_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextTempHp, JSON.stringify(effects), Number(player.character_id)],
    );
  }

  player.temp_hp = nextTempHp;
  player.effects_json = JSON.stringify(effects);
  traceStateChange('STATE_CHANGE', 'PLAYER_EFFECTS_CACHE_REBUILT', before, {
    tempHp: nextTempHp,
    effectsJson: player.effects_json,
    effectCount: effects.length,
  }, {
    source: 'activeEffectService',
    sessionId: player.session_id,
    playerId: player.id,
    playerKey: player.target_key,
    playerName: player.target_name,
  });
  return effects;
}

async function maybeCreateRepeatSave(
  db: SQLiteDatabase,
  sessionId: string,
  targetKey: string,
  snapshot: LanActiveEffectSnapshot,
  unit: 'turn' | 'minute' | 'hour' | 'shortRest' | 'longRest',
) {
  if (unit !== 'turn') return null;
  const repeatSave = String(snapshot.repeatSave || '').toLowerCase();
  const hasRepeatSave = repeatSave === 'start_of_turn' || repeatSave === 'end_of_turn';
  const hasSaveAbility = Boolean(String(snapshot.saveAbility || '').trim());
  const hasSaveDc = Number(snapshot.saveDc || 0) > 0;
  const canRequestSave = snapshot.removableBySave === true || hasRepeatSave;

  if (!canRequestSave || !hasSaveAbility || !hasSaveDc || !hasRepeatSave) {
    debugLanFlow('MASTER_PENDING_SAVE_SKIPPED_NO_SAVE_CONFIG', {
      sessionId,
      targetKey,
      effectId: snapshot.id,
      effectName: snapshot.name,
      removableBySave: snapshot.removableBySave,
      repeatSave: snapshot.repeatSave,
      saveAbility: snapshot.saveAbility,
      saveDc: snapshot.saveDc,
    });
    return null;
  }

  const existingPending = await db.getFirstAsync<{ id: string }>(
    `SELECT id
     FROM lan_pending_saves
     WHERE session_id = ?
       AND target_key = ?
       AND source_id = ?
       AND status = 'pending'
     LIMIT 1`,
    [sessionId, targetKey, snapshot.id],
  );
  if (existingPending?.id) {
    debugLanFlow('MASTER_PENDING_SAVE_SKIPPED_ALREADY_PENDING', {
      sessionId,
      targetKey,
      effectId: snapshot.id,
      pendingSaveId: existingPending.id,
    });
    return null;
  }

  const pending: LanPendingSave = {
    id: `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    targetKey,
    sourceType: snapshot.sourceType || 'active_effect',
    sourceId: snapshot.id,
    sourceName: snapshot.name,
    effectPayload: snapshot as unknown as Record<string, unknown>,
    ability: String(snapshot.saveAbility),
    dc: snapshot.saveDc ?? null,
    dcMode: 'fixed',
    status: 'pending',
    result: {},
  };

  await db.runAsync(
    `INSERT INTO lan_pending_saves (
      id, session_id, target_key, source_type, source_id, source_name,
      effect_payload_json, ability, dc, dc_mode, status, result_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '{}', CURRENT_TIMESTAMP)`,
    [
      pending.id,
      sessionId,
      targetKey,
      pending.sourceType || null,
      pending.sourceId || null,
      pending.sourceName || null,
      JSON.stringify(pending.effectPayload),
      pending.ability,
      pending.dc ?? null,
      pending.dcMode || null,
    ],
  );

  return pending;
}

async function backfillPlayerActiveEffectsFromCache(db: SQLiteDatabase, player: PlayerRow) {
  const totalCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM lan_active_effects
     WHERE session_id = ? AND target_key = ?`,
    [player.session_id, player.target_key],
  );
  // Se ja existe qualquer registro (ativo ou expirado/removido), o cache JSON nao deve
  // recriar efeitos. Isso evita efeito expirado voltar depois de troca de tela/resync.
  if (Number(totalCount?.count || 0) > 0) return;

  const cached = parseJsonValue<LanActiveEffectSnapshot[]>(player.effects_json, []);
  if (!Array.isArray(cached) || cached.length === 0) return;
  const session = await getSessionTiming(db, player.session_id);

  for (const effect of cached) {
    const id = effect.id || makeActiveEffectId();
    const statusKey = normalizeStatusKey(effect.statusKey || effect.status || effect.name || id);
    const snapshot: LanActiveEffectSnapshot = {
      ...effect,
      id,
      name: effect.name || 'Efeito',
      target: normalizeTarget(effect.target),
      value: toNumber(effect.value),
      unit: normalizeDurationUnit(effect.unit) || 'rest',
      remaining: effect.isPermanent || effect.unit === 'permanent'
        ? 0
        : Math.max(1, toNumber(effect.remaining, 1)),
      isPermanent: Boolean(effect.isPermanent || effect.unit === 'permanent'),
      status: statusKey,
      statusKey,
    };
    await db.runAsync(
      `INSERT OR IGNORE INTO lan_active_effects (
        id, session_id, target_key, status_key, source_type, source_id, source_name,
        applied_by_key, applied_by_name, remaining_value, remaining_unit, started_turn,
        save_dc, save_ability, repeat_save, visible_to_player, private_note,
        public_note, stack_count, effect_json, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        player.session_id,
        player.target_key,
        statusKey,
        snapshot.sourceType || 'legacy_cache',
        snapshot.sourceId || null,
        snapshot.source || null,
        null,
        null,
        snapshot.remaining,
        snapshot.unit,
        session.currentTurn,
        snapshot.saveDc ?? null,
        snapshot.saveAbility || null,
        snapshot.repeatSave || null,
        snapshot.visibleToPlayer === false ? 0 : 1,
        snapshot.privateNote || null,
        snapshot.publicNote || null,
        snapshot.stackCount || 1,
        JSON.stringify(snapshot),
      ],
    );
  }
}

async function getPlayerRow(db: SQLiteDatabase, playerId: number): Promise<PlayerRow | null> {
  const row = await db.getFirstAsync<PlayerRow>(
    `SELECT *,
            COALESCE(remote_key, 'player_' || id) as target_key,
            COALESCE(character_name, player_name, 'Personagem') as target_name
     FROM lan_session_players
     WHERE id = ? AND COALESCE(is_active, 1) = 1`,
    [playerId],
  );
  return row || null;
}

async function getActiveRowsForTarget(db: SQLiteDatabase, sessionId: string, targetKey: string, statusKey?: string) {
  const values = [sessionId, targetKey];
  const statusSql = statusKey ? `AND ae.status_key = ?` : '';
  if (statusKey) values.push(statusKey);
  return db.getAllAsync<Record<string, unknown>>(
    `SELECT ae.*,
            c.name as catalog_name,
            c.kind as catalog_kind,
            c.category as catalog_category,
            c.description as catalog_description,
            c.color as catalog_color,
            c.secondary_color as catalog_secondary_color,
            c.icon as catalog_icon,
            c.target as catalog_target,
            c.value as catalog_value,
            c.stackable as catalog_stackable,
            c.removable_by_save as catalog_removable_by_save,
            c.repeat_save as catalog_repeat_save,
            c.save_ability as catalog_save_ability,
            c.save_on_success as catalog_save_on_success,
            c.visual_priority as catalog_visual_priority
     FROM lan_active_effects ae
     LEFT JOIN lan_effect_catalog c ON c.status_key = ae.status_key
     WHERE ae.session_id = ? AND ae.target_key = ? AND COALESCE(ae.active, 1) = 1 ${statusSql}
     ORDER BY COALESCE(c.visual_priority, 0) DESC, ae.created_at ASC`,
    values,
  );
}

async function getActiveRowById(db: SQLiteDatabase, effectId: string) {
  return db.getFirstAsync<Record<string, unknown>>(
    `SELECT ae.*,
            c.name as catalog_name,
            c.kind as catalog_kind,
            c.category as catalog_category,
            c.description as catalog_description,
            c.color as catalog_color,
            c.secondary_color as catalog_secondary_color,
            c.icon as catalog_icon,
            c.target as catalog_target,
            c.value as catalog_value,
            c.stackable as catalog_stackable,
            c.removable_by_save as catalog_removable_by_save,
            c.repeat_save as catalog_repeat_save,
            c.save_ability as catalog_save_ability,
            c.save_on_success as catalog_save_on_success,
            c.visual_priority as catalog_visual_priority
     FROM lan_active_effects ae
     LEFT JOIN lan_effect_catalog c ON c.status_key = ae.status_key
     WHERE ae.id = ? AND COALESCE(ae.active, 1) = 1
     LIMIT 1`,
    [effectId],
  );
}

function buildInputSnapshot(
  input: ApplyActiveEffectInput,
  catalog: LanEffectCatalogItem | null,
  currentTurn: number,
): LanActiveEffectSnapshot {
  const unit = normalizeDurationUnit(input.unit || catalog?.defaultDurationUnit) || 'rest';
  const isPermanent = unit === 'permanent';
  const remaining = isPermanent
    ? 0
    : input.remaining == null
      ? Math.max(1, Number(catalog?.defaultDurationValue || 1))
      : Math.max(1, Math.floor(Number(input.remaining) || 1));
  const target = normalizeTarget(input.target || catalog?.target);
  const value = Math.floor(Number(input.value ?? catalog?.value ?? 0) || 0);
  const name = input.name || catalog?.name || 'Efeito';

  return {
    id: '',
    name,
    target,
    value,
    remaining,
    unit,
    isPermanent,
    kind: (input.kind || catalog?.kind || inferKindFromTarget(target)) as LanActiveEffectSnapshot['kind'],
    mode: input.mode || 'add',
    durationText: input.durationText || formatDurationText(remaining, unit),
    status: catalog?.statusKey || normalizeStatusKey(input.statusKey || name),
    statusKey: catalog?.statusKey || normalizeStatusKey(input.statusKey || name),
    source: input.sourceName,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    color: input.color || catalog?.color,
    secondaryColor: input.secondaryColor || catalog?.secondaryColor,
    icon: input.icon || catalog?.icon,
    visibleToPlayer: input.visibleToPlayer !== false,
    publicNote: input.publicNote,
    privateNote: input.privateNote,
    stackCount: 1,
    saveDc: input.saveDc ?? null,
    saveAbility: input.saveAbility || catalog?.saveAbility || null,
    repeatSave: input.repeatSave || catalog?.repeatSave || null,
    removableBySave: Boolean(catalog?.removableBySave || input.repeatSave || input.saveAbility),
    visualPriority: catalog?.visualPriority || 0,
  };
}

function mapActiveEffectRow(row: Record<string, unknown>): LanActiveEffectSnapshot {
  const stored = parseJsonValue<Partial<LanActiveEffectSnapshot>>(row.effect_json, {});
  const statusKey = normalizeStatusKey(row.status_key || stored.statusKey || stored.status || row.catalog_name);
  const target = normalizeTarget(stored.target || row.catalog_target);
  const unit = normalizeDurationUnit(row.remaining_unit || stored.unit) || 'rest';
  const isPermanent = Boolean(stored.isPermanent || unit === 'permanent');
  const remaining = isPermanent ? 0 : Math.max(0, toNumber(row.remaining_value ?? stored.remaining, 1));

  return {
    id: String(row.id || stored.id || ''),
    name: String(stored.name || row.catalog_name || row.source_name || 'Efeito'),
    target,
    value: toNumber(stored.value ?? row.catalog_value),
    remaining,
    unit,
    isPermanent,
    kind: (stored.kind || row.catalog_kind || inferKindFromTarget(target)) as LanActiveEffectSnapshot['kind'],
    mode: stored.mode === 'set' ? 'set' : 'add',
    durationText: stored.durationText || formatDurationText(remaining, unit),
    status: statusKey,
    statusKey,
    source: stored.source || optionalString(row.source_name),
    sourceType: stored.sourceType || optionalString(row.source_type),
    sourceId: stored.sourceId || optionalString(row.source_id),
    color: stored.color || optionalString(row.catalog_color),
    secondaryColor: stored.secondaryColor || optionalString(row.catalog_secondary_color),
    icon: stored.icon || optionalString(row.catalog_icon),
    visibleToPlayer: row.visible_to_player == null ? stored.visibleToPlayer !== false : Boolean(toNumber(row.visible_to_player)),
    publicNote: stored.publicNote || optionalString(row.public_note),
    privateNote: stored.privateNote || optionalString(row.private_note),
    stackCount: Math.max(1, toNumber(row.stack_count ?? stored.stackCount, 1)),
    saveDc: row.save_dc == null ? stored.saveDc ?? null : toNumber(row.save_dc),
    saveAbility: optionalString(row.save_ability) || stored.saveAbility || optionalString(row.catalog_save_ability),
    repeatSave: optionalString(row.repeat_save) || stored.repeatSave || optionalString(row.catalog_repeat_save),
    removableBySave: Boolean(toNumber(row.catalog_removable_by_save) || stored.removableBySave),
    visualPriority: toNumber(row.catalog_visual_priority ?? stored.visualPriority),
  };
}

async function getSessionTiming(db: SQLiteDatabase, sessionId: string) {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT current_turn, elapsed_minutes FROM lan_sessions WHERE id = ?`,
    [sessionId],
  );
  return {
    currentTurn: toNumber(row?.current_turn, 1),
    elapsedMinutes: toNumber(row?.elapsed_minutes),
  };
}

function getDurationDelta(unit: DurationUnit | 'rest', advanceUnit: 'turn' | 'minute' | 'hour' | 'shortRest' | 'longRest') {
  if (unit === 'turn' || unit === 'round') return advanceUnit === 'turn' ? 1 : 0;
  if (unit === 'minute') {
    if (advanceUnit === 'minute') return 1;
    if (advanceUnit === 'hour' || advanceUnit === 'shortRest') return 60;
    if (advanceUnit === 'longRest') return 480;
  }
  if (unit === 'hour') {
    if (advanceUnit === 'hour' || advanceUnit === 'shortRest') return 1;
    if (advanceUnit === 'longRest') return 8;
  }
  if (unit === 'day') return advanceUnit === 'longRest' ? 1 : 0;
  if (unit === 'short_rest' || unit === 'rest') return advanceUnit === 'shortRest' || advanceUnit === 'longRest' ? Number.MAX_SAFE_INTEGER : 0;
  if (unit === 'long_rest') return advanceUnit === 'longRest' ? Number.MAX_SAFE_INTEGER : 0;
  if (unit === 'instant') return Number.MAX_SAFE_INTEGER;
  return 0;
}

function getExpiresAtMinutes(elapsedMinutes: number, remaining: number, unit: DurationUnit | 'rest') {
  if (unit === 'minute') return elapsedMinutes + remaining;
  if (unit === 'hour') return elapsedMinutes + remaining * 60;
  if (unit === 'day') return elapsedMinutes + remaining * 1440;
  return null;
}

function isTempHpSnapshot(effect: Pick<LanActiveEffectSnapshot, 'target' | 'kind'> | null | undefined) {
  if (!effect) return false;
  return effect.target === 'PV_TEMP' || String(effect.kind || '').toLowerCase() === 'temp_hp';
}

function getTempHpValue(effect: LanActiveEffectSnapshot) {
  return isTempHpSnapshot(effect) ? Math.max(0, toNumber(effect.value)) : 0;
}

function compareTempHpAbsorptionOrder(a: LanActiveEffectSnapshot, b: LanActiveEffectSnapshot) {
  const unitWeight = (unit: string | null | undefined) => {
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

  const unitDiff = unitWeight(a.unit) - unitWeight(b.unit);
  if (unitDiff !== 0) return unitDiff;

  const remainingDiff = Math.max(0, toNumber(a.remaining)) - Math.max(0, toNumber(b.remaining));
  if (remainingDiff !== 0) return remainingDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function normalizeTarget(value: unknown): EffectTarget {
  const raw = String(value || '').toUpperCase();
  if (raw === 'FOR' || raw === 'DES' || raw === 'CON' || raw === 'INT' || raw === 'SAB' || raw === 'CAR' || raw === 'CA' || raw === 'HP' || raw === 'PV_TEMP') {
    return raw as EffectTarget;
  }
  return 'custom';
}

function normalizeDurationUnit(value: unknown): DurationUnit | 'rest' | null {
  const raw = normalizeEffectDurationUnit(value);
  if (
    raw === 'instant' ||
    raw === 'turn' ||
    raw === 'round' ||
    raw === 'minute' ||
    raw === 'hour' ||
    raw === 'day' ||
    raw === 'short_rest' ||
    raw === 'long_rest' ||
    raw === 'rest' ||
    raw === 'concentration' ||
    raw === 'while_equipped' ||
    raw === 'while_active' ||
    raw === 'until_save' ||
    raw === 'permanent' ||
    raw === 'manual'
  ) {
    return raw;
  }
  if (raw === 'shortrest') return 'short_rest';
  if (raw === 'longrest') return 'long_rest';
  return null;
}

function inferKindFromTarget(target: EffectTarget) {
  if (target === 'PV_TEMP') return 'temp_hp';
  if (target === 'HP') return 'hp';
  if (target === 'custom') return 'custom';
  return 'stat';
}

function formatDurationText(value: number, unit: DurationUnit | 'rest') {
  if (unit === 'permanent') return 'Permanente';
  if (unit === 'manual') return 'Manual';
  if (unit === 'while_equipped') return 'Enquanto equipado';
  if (unit === 'concentration') return 'Concentracao';
  return `${value} ${unit}`;
}

function makeActiveEffectId() {
  return `active_fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function optionalString(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
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

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
