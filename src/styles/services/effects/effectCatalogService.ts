import type { SQLiteDatabase } from 'expo-sqlite';

import { ensureEffectSchema } from './effectSchema';
import type { DurationUnit, EffectKind, EffectTarget, LanEffectCatalogItem } from './effectTypes';

export type SaveCatalogEffectInput = Partial<LanEffectCatalogItem> & {
  name: string;
  statusKey?: string;
};

export async function listEffects(db: SQLiteDatabase, options?: { includeInactive?: boolean }) {
  await ensureEffectSchema(db);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT *
     FROM lan_effect_catalog
     WHERE ? = 1 OR COALESCE(active, 1) = 1
     ORDER BY visual_priority DESC, name ASC`,
    [options?.includeInactive ? 1 : 0],
  );
  return rows.map(mapCatalogRow);
}

export async function getEffectByStatusKey(db: SQLiteDatabase, statusKey: string) {
  await ensureEffectSchema(db);
  const key = normalizeStatusKey(statusKey);
  if (!key) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_effect_catalog WHERE status_key = ? LIMIT 1`,
    [key],
  );
  return row ? mapCatalogRow(row) : null;
}

export async function createEffect(db: SQLiteDatabase, input: SaveCatalogEffectInput) {
  await ensureEffectSchema(db);
  const effect = normalizeCatalogInput(input);
  await db.runAsync(
    `INSERT INTO lan_effect_catalog (
      import_uid, status_key, name, kind, category, description, color,
      secondary_color, icon, target, value, duration_value, duration_unit,
      default_duration_value, default_duration_unit, stackable, removable_by_save,
      repeat_save, save_ability, save_on_success, visual_priority, rules_json,
      active, criador, source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    catalogBindValues(effect),
  );
  return getEffectByStatusKey(db, effect.statusKey);
}

export async function updateEffect(db: SQLiteDatabase, id: number, input: SaveCatalogEffectInput) {
  await ensureEffectSchema(db);
  const effect = normalizeCatalogInput(input);
  await db.runAsync(
    `UPDATE lan_effect_catalog
     SET import_uid = ?, status_key = ?, name = ?, kind = ?, category = ?,
         description = ?, color = ?, secondary_color = ?, icon = ?, target = ?,
         value = ?, duration_value = ?, duration_unit = ?, default_duration_value = ?,
         default_duration_unit = ?, stackable = ?, removable_by_save = ?,
         repeat_save = ?, save_ability = ?, save_on_success = ?, visual_priority = ?,
         rules_json = ?, active = ?, criador = ?, source = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [...catalogBindValues(effect), id],
  );
  return getEffectByStatusKey(db, effect.statusKey);
}

export async function upsertEffect(db: SQLiteDatabase, input: SaveCatalogEffectInput) {
  await ensureEffectSchema(db);
  const statusKey = normalizeStatusKey(input.statusKey || input.name);
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM lan_effect_catalog WHERE status_key = ? OR name = ? LIMIT 1`,
    [statusKey, input.name],
  );
  if (existing?.id) return updateEffect(db, existing.id, { ...input, statusKey });
  return createEffect(db, { ...input, statusKey });
}

export async function duplicateEffect(db: SQLiteDatabase, id: number) {
  await ensureEffectSchema(db);
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM lan_effect_catalog WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  const original = mapCatalogRow(row);
  const copyName = `${original.name} copia`;
  return createEffect(db, {
    ...original,
    id: undefined,
    name: copyName,
    statusKey: makeUniqueStatusKey(`${original.statusKey}_copy_${Date.now().toString(36)}`),
    importUid: undefined,
    category: original.category || 'custom',
    creator: 'user',
  });
}

export async function disableEffect(db: SQLiteDatabase, id: number) {
  await ensureEffectSchema(db);
  await db.runAsync(
    `UPDATE lan_effect_catalog SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id],
  );
}

export async function deleteEffectIfUnused(db: SQLiteDatabase, id: number) {
  await ensureEffectSchema(db);
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT status_key FROM lan_effect_catalog WHERE id = ?`,
    [id],
  );
  if (!row?.status_key) return false;
  const activeUse = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM lan_active_effects
     WHERE status_key = ? AND COALESCE(active, 1) = 1`,
    [String(row.status_key)],
  );
  if (Number(activeUse?.count || 0) > 0) return false;
  await db.runAsync(`DELETE FROM lan_effect_catalog WHERE id = ?`, [id]);
  return true;
}

export function normalizeStatusKey(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function mapCatalogRow(row: Record<string, unknown>): LanEffectCatalogItem {
  return {
    id: toNumber(row.id) || undefined,
    importUid: optionalString(row.import_uid),
    statusKey: normalizeStatusKey(row.status_key || row.name),
    name: String(row.name || 'Efeito'),
    kind: normalizeKind(row.kind),
    category: optionalString(row.category || row.source) || 'custom',
    description: optionalString(row.description),
    color: optionalString(row.color) || '#888888',
    secondaryColor: optionalString(row.secondary_color),
    icon: optionalString(row.icon),
    target: normalizeTarget(row.target),
    value: toNumber(row.value),
    defaultDurationValue: row.default_duration_value == null ? (row.duration_value == null ? null : toNumber(row.duration_value)) : toNumber(row.default_duration_value),
    defaultDurationUnit: normalizeDurationUnit(row.default_duration_unit || row.duration_unit),
    stackable: Boolean(toNumber(row.stackable)),
    removableBySave: Boolean(toNumber(row.removable_by_save)),
    repeatSave: optionalString(row.repeat_save),
    saveAbility: optionalString(row.save_ability),
    saveOnSuccess: optionalString(row.save_on_success),
    visualPriority: toNumber(row.visual_priority),
    rulesJson: parseJsonValue<Record<string, unknown>>(row.rules_json, {}),
    active: row.active == null ? true : Boolean(toNumber(row.active)),
    creator: optionalString(row.criador || row.source) || 'user',
    createdAt: optionalString(row.created_at),
    updatedAt: optionalString(row.updated_at),
  };
}

function normalizeCatalogInput(input: SaveCatalogEffectInput): LanEffectCatalogItem {
  const statusKey = normalizeStatusKey(input.statusKey || input.name);
  return {
    importUid: input.importUid,
    statusKey: statusKey || makeUniqueStatusKey(input.name),
    name: input.name.trim() || 'Efeito',
    kind: normalizeKind(input.kind),
    category: input.category || 'custom',
    description: input.description || '',
    color: input.color || '#888888',
    secondaryColor: input.secondaryColor || undefined,
    icon: input.icon || undefined,
    target: normalizeTarget(input.target),
    value: toNumber(input.value),
    defaultDurationValue: input.defaultDurationValue == null ? null : Math.max(0, Math.floor(Number(input.defaultDurationValue) || 0)),
    defaultDurationUnit: normalizeDurationUnit(input.defaultDurationUnit) || 'turn',
    stackable: Boolean(input.stackable),
    removableBySave: Boolean(input.removableBySave),
    repeatSave: input.repeatSave || 'none',
    saveAbility: input.saveAbility || null,
    saveOnSuccess: input.saveOnSuccess || null,
    visualPriority: toNumber(input.visualPriority),
    rulesJson: input.rulesJson && typeof input.rulesJson === 'object' ? input.rulesJson : {},
    active: input.active !== false,
    creator: input.creator || 'user',
  };
}

function catalogBindValues(effect: LanEffectCatalogItem) {
  return [
    effect.importUid || null,
    effect.statusKey,
    effect.name,
    effect.kind,
    effect.category || 'custom',
    effect.description || '',
    effect.color,
    effect.secondaryColor || null,
    effect.icon || null,
    effect.target || 'custom',
    effect.value || 0,
    effect.defaultDurationValue ?? null,
    effect.defaultDurationUnit || null,
    effect.defaultDurationValue ?? null,
    effect.defaultDurationUnit || null,
    effect.stackable ? 1 : 0,
    effect.removableBySave ? 1 : 0,
    effect.repeatSave || null,
    effect.saveAbility || null,
    effect.saveOnSuccess || null,
    effect.visualPriority || 0,
    JSON.stringify(effect.rulesJson || {}),
    effect.active ? 1 : 0,
    effect.creator || 'user',
    effect.creator || 'user',
  ];
}

function normalizeKind(value: unknown): EffectKind {
  const raw = String(value || '').toLowerCase();
  if (raw === 'buff' || raw === 'debuff' || raw === 'disease' || raw === 'curse' || raw === 'custom' || raw === 'status') return raw;
  return 'condition';
}

function normalizeTarget(value: unknown): EffectTarget {
  const raw = String(value || '').toUpperCase();
  if (raw === 'FOR' || raw === 'DES' || raw === 'CON' || raw === 'INT' || raw === 'SAB' || raw === 'CAR' || raw === 'CA' || raw === 'HP' || raw === 'PV_TEMP') {
    return raw as EffectTarget;
  }
  return 'custom';
}

function normalizeDurationUnit(value: unknown): DurationUnit | null {
  const raw = String(value || '').toLowerCase();
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
  return null;
}

function makeUniqueStatusKey(value: unknown) {
  return normalizeStatusKey(value) || `effect_${Date.now().toString(36)}`;
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

