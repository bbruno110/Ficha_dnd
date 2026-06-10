import type { SQLiteDatabase } from 'expo-sqlite';

import { applyEffectToPlayer } from './activeEffectService';
import { ensureEffectSchema } from './effectSchema';
import type { ApplyActiveEffectInput, LanPendingSave } from './effectTypes';

export type EffectResolutionContext = {
  sessionId: string;
  playerId: number;
  targetKey: string;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  appliedByKey?: string;
  appliedByName?: string;
};

export async function resolveConditionApplication(
  db: SQLiteDatabase,
  context: EffectResolutionContext,
  effectPayload: Record<string, unknown>,
) {
  const condition = getConditionPayload(effectPayload);
  if (!condition?.statusKey) return null;

  const duration = parseDuration(condition.duration);
  const save = parseSave(effectPayload);
  const input: ApplyActiveEffectInput = {
    statusKey: condition.statusKey,
    name: optionalString(condition.name) || context.sourceName,
    target: normalizeTarget(effectPayload.target),
    value: toNumber(effectPayload.value),
    remaining: duration.value,
    unit: duration.unit,
    durationText: duration.text,
    sourceType: context.sourceType,
    sourceId: context.sourceId,
    sourceName: context.sourceName,
    appliedByKey: context.appliedByKey,
    appliedByName: context.appliedByName,
    saveAbility: save?.ability,
    saveDc: save?.dc,
    repeatSave: duration.repeatSave || save?.repeatSave,
    visibleToPlayer: condition.visibleToPlayer !== false,
  };

  return applyEffectToPlayer(db, context.playerId, input);
}

export async function createPendingSave(
  db: SQLiteDatabase,
  context: EffectResolutionContext,
  effectPayload: Record<string, unknown>,
) {
  await ensureEffectSchema(db);
  const save = parseSave(effectPayload);
  if (!save?.ability) return null;
  const pending: LanPendingSave = {
    id: `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: context.sessionId,
    targetKey: context.targetKey,
    sourceType: context.sourceType || null,
    sourceId: context.sourceId || null,
    sourceName: context.sourceName || null,
    effectPayload,
    ability: save.ability,
    dc: save.dc ?? null,
    dcMode: save.dcMode || 'manual_master',
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
      pending.sessionId,
      pending.targetKey,
      pending.sourceType || null,
      pending.sourceId || null,
      pending.sourceName || null,
      JSON.stringify(effectPayload),
      pending.ability,
      pending.dc ?? null,
      pending.dcMode || null,
    ],
  );
  return pending;
}

export async function resolveSave(
  db: SQLiteDatabase,
  pendingSaveId: string,
  passed: boolean,
  roll?: number,
) {
  await ensureEffectSchema(db);
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_pending_saves WHERE id = ? AND status = 'pending'`,
    [pendingSaveId],
  );
  if (!row) return null;
  const result = { passed, roll: roll ?? null, resolvedAt: new Date().toISOString() };
  await db.runAsync(
    `UPDATE lan_pending_saves
     SET status = ?, result_json = ?, resolved_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [passed ? 'success' : 'failure', JSON.stringify(result), pendingSaveId],
  );
  return {
    id: pendingSaveId,
    passed,
    effectPayload: parseJsonValue<Record<string, unknown>>(row.effect_payload_json, {}),
  };
}

export async function listPendingSaves(db: SQLiteDatabase, sessionId: string) {
  await ensureEffectSchema(db);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT *
     FROM lan_pending_saves
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at DESC`,
    [sessionId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    targetKey: String(row.target_key),
    sourceType: optionalString(row.source_type),
    sourceId: optionalString(row.source_id),
    sourceName: optionalString(row.source_name),
    effectPayload: parseJsonValue<Record<string, unknown>>(row.effect_payload_json, {}),
    ability: String(row.ability || 'CON'),
    dc: row.dc == null ? null : toNumber(row.dc),
    dcMode: optionalString(row.dc_mode),
    status: String(row.status || 'pending') as any,
    result: parseJsonValue<Record<string, unknown>>(row.result_json, {}),
    createdAt: optionalString(row.created_at),
    resolvedAt: optionalString(row.resolved_at) || null,
  }));
}

export function resolveItemEffect(effect: unknown) {
  return normalizeMechanicalEffect(effect);
}

export function resolveSpellEffect(effect: unknown) {
  return normalizeMechanicalEffect(effect);
}

export function normalizeMechanicalEffect(effect: unknown) {
  if (!effect || typeof effect !== 'object') return null;
  const raw = effect as Record<string, unknown>;
  const condition = getConditionPayload(raw);
  const save = parseSave(raw);
  return {
    ...raw,
    type: String(raw.type || raw.kind || (condition ? 'condition' : 'custom')),
    condition,
    save,
    target: normalizeTarget(raw.target),
  };
}

export function validateMechanicalEffect(effect: unknown) {
  const normalized = normalizeMechanicalEffect(effect);
  if (!normalized) return ['Efeito invalido.'];
  const raw = normalized as Record<string, any>;
  const errors: string[] = [];
  if (normalized.type === 'condition' && !normalized.condition?.statusKey) errors.push('Condicao sem statusKey.');
  if ((normalized.type === 'damage' || normalized.type === 'heal') && !raw.damageDice && !raw.healDice && !raw.dice && !raw.value) {
    errors.push('Dano/cura precisa de dado ou valor.');
  }
  if (normalized.save?.enabled !== false && normalized.save?.ability === '') errors.push('Teste de resistencia sem atributo.');
  return errors;
}

function getConditionPayload(effect: Record<string, unknown>) {
  const rawCondition = effect.condition && typeof effect.condition === 'object'
    ? effect.condition as Record<string, unknown>
    : {};
  const key = rawCondition.statusKey || rawCondition.key || effect.statusKey || effect.status;
  const statusKey = optionalString(key);
  if (!statusKey) return null;
  return {
    statusKey,
    name: rawCondition.name,
    applyOn: rawCondition.applyOn || 'always',
    duration: rawCondition.duration,
    visibleToPlayer: rawCondition.visibleToPlayer,
  };
}

function parseDuration(value: unknown) {
  if (!value || typeof value !== 'object') return { value: 1, unit: 'turn' as const, repeatSave: undefined as string | undefined, text: '1 turn' };
  const duration = value as Record<string, unknown>;
  const unit = normalizeDurationUnit(duration.unit) || 'turn';
  const amount = Math.max(1, toNumber(duration.value, 1));
  return {
    value: amount,
    unit,
    repeatSave: optionalString(duration.repeatSave),
    text: `${amount} ${unit}`,
  };
}

function parseSave(effect: Record<string, unknown>) {
  const rawSave = effect.save && typeof effect.save === 'object' ? effect.save as Record<string, unknown> : null;
  if (!rawSave) return null;
  return {
    enabled: rawSave.enabled !== false,
    ability: optionalString(rawSave.ability) || '',
    dc: rawSave.dc == null && rawSave.dcFixed == null ? null : toNumber(rawSave.dc ?? rawSave.dcFixed),
    dcMode: optionalString(rawSave.dcMode || rawSave.dcSource),
    onSuccess: optionalString(rawSave.onSuccess),
    repeatSave: optionalString(rawSave.repeatSave),
  };
}

function normalizeTarget(value: unknown) {
  if (value && typeof value === 'object') {
    const target = value as Record<string, unknown>;
    if (target.mode === 'self') return 'custom';
  }
  const raw = String(value || '').toUpperCase();
  if (raw === 'FOR' || raw === 'DES' || raw === 'CON' || raw === 'INT' || raw === 'SAB' || raw === 'CAR' || raw === 'CA' || raw === 'HP' || raw === 'PV_TEMP') return raw as any;
  return 'custom';
}

function normalizeDurationUnit(value: unknown) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'turn' || raw === 'round' || raw === 'minute' || raw === 'hour' || raw === 'day' || raw === 'rest' || raw === 'short_rest' || raw === 'long_rest' || raw === 'while_equipped' || raw === 'permanent' || raw === 'manual' || raw === 'until_save' || raw === 'concentration' || raw === 'while_active' || raw === 'instant') {
    return raw as any;
  }
  return null;
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
