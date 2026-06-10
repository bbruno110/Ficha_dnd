import type { SQLiteDatabase } from 'expo-sqlite';

import { getEffectByStatusKey, upsertEffect } from './effectCatalogService';
import type { LanEffectCatalogItem } from './effectTypes';

export type EffectConditionExport = {
  schemaVersion: 1;
  entityType: 'effect_condition';
  importUid: string;
  statusKey: string;
  name: string;
  kind: string;
  category?: string;
  color: string;
  secondaryColor?: string;
  icon?: string;
  description?: string;
  stackable: boolean;
  removableBySave: boolean;
  repeatSave?: string | null;
  saveAbility?: string | null;
  saveOnSuccess?: string | null;
  defaultDurationValue?: number | null;
  defaultDurationUnit?: string | null;
  visualPriority: number;
  rulesJson: Record<string, unknown>;
};

export function exportEffectCondition(effect: LanEffectCatalogItem): EffectConditionExport {
  return {
    schemaVersion: 1,
    entityType: 'effect_condition',
    importUid: effect.importUid || `effect_${effect.statusKey}_v1`,
    statusKey: effect.statusKey,
    name: effect.name,
    kind: effect.kind,
    category: effect.category,
    color: effect.color,
    secondaryColor: effect.secondaryColor,
    icon: effect.icon,
    description: effect.description,
    stackable: effect.stackable,
    removableBySave: effect.removableBySave,
    repeatSave: effect.repeatSave || null,
    saveAbility: effect.saveAbility || null,
    saveOnSuccess: effect.saveOnSuccess || null,
    defaultDurationValue: effect.defaultDurationValue ?? null,
    defaultDurationUnit: effect.defaultDurationUnit || null,
    visualPriority: effect.visualPriority,
    rulesJson: effect.rulesJson || {},
  };
}

export async function importEffectCondition(db: SQLiteDatabase, payload: EffectConditionExport) {
  if (payload.schemaVersion !== 1 || payload.entityType !== 'effect_condition') {
    throw new Error('Arquivo de condicao incompativel.');
  }
  return upsertEffect(db, {
    importUid: payload.importUid,
    statusKey: payload.statusKey,
    name: payload.name,
    kind: payload.kind as any,
    category: payload.category || 'imported',
    color: payload.color,
    secondaryColor: payload.secondaryColor,
    icon: payload.icon,
    description: payload.description,
    stackable: payload.stackable,
    removableBySave: payload.removableBySave,
    repeatSave: payload.repeatSave,
    saveAbility: payload.saveAbility,
    saveOnSuccess: payload.saveOnSuccess,
    defaultDurationValue: payload.defaultDurationValue,
    defaultDurationUnit: payload.defaultDurationUnit as any,
    visualPriority: payload.visualPriority,
    rulesJson: payload.rulesJson || {},
    creator: 'importado',
  });
}

export async function resolveEffectDependencies(db: SQLiteDatabase, dependencies?: { effects?: string[] }) {
  const missing: string[] = [];
  for (const uid of dependencies?.effects || []) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM lan_effect_catalog WHERE import_uid = ? LIMIT 1`,
      [uid],
    );
    if (!existing) missing.push(uid);
  }
  return missing;
}

export async function assertReferencedEffectsExist(db: SQLiteDatabase, effectJson: unknown) {
  const effects = Array.isArray(effectJson) ? effectJson : parseJsonArray(effectJson);
  const missing: string[] = [];

  for (const effect of effects) {
    const condition = effect?.condition || {};
    const statusKey = condition.statusKey || condition.key || effect?.statusKey || effect?.status;
    if (!statusKey) continue;
    const existing = await getEffectByStatusKey(db, String(statusKey));
    if (!existing) missing.push(String(statusKey));
  }

  return Array.from(new Set(missing));
}

function parseJsonArray(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

