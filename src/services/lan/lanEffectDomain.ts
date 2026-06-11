export type LanEffectUnit =
  | 'instant'
  | 'turn'
  | 'round'
  | 'minute'
  | 'hour'
  | 'day'
  | 'short_rest'
  | 'long_rest'
  | 'rest'
  | 'concentration'
  | 'while_equipped'
  | 'while_active'
  | 'until_save'
  | 'permanent'
  | 'manual';

export type LanAdvanceUnit = 'turn' | 'minute' | 'hour' | 'shortRest' | 'longRest';

export type LanDomainActiveEffect = {
  effectId: string;
  sourceId: string;
  sourceType: 'item' | 'spell' | 'condition' | 'manual' | 'session';
  targetKey: string;
  name: string;
  kind: 'stat' | 'hp' | 'temp_hp' | 'status' | 'custom';
  target: string;
  value: number;
  createdAtTurn: number;
  expiresAtTurn?: number;
  remaining?: number;
  unit: LanEffectUnit;
  status: 'active' | 'expired' | 'removed';
  stackPolicy: 'replace_same_source' | 'stack' | 'highest' | 'ignore_duplicate';
};

export type AdvanceEffectsResult = {
  activeEffects: LanDomainActiveEffect[];
  expiredEffects: LanDomainActiveEffect[];
  removedTempHp: number;
};

export function normalizeDomainEffect(raw: any, fallback: Partial<LanDomainActiveEffect> = {}): LanDomainActiveEffect {
  const unit = normalizeEffectUnit(raw?.unit || raw?.durationUnit || fallback.unit || 'manual');
  const effectId = String(raw?.effectId || raw?.id || raw?.lanEffectId || fallback.effectId || makeStableEffectId(raw));
  return {
    effectId,
    sourceId: String(raw?.sourceId || fallback.sourceId || effectId),
    sourceType: normalizeSourceType(raw?.sourceType || fallback.sourceType),
    targetKey: String(raw?.targetKey || fallback.targetKey || ''),
    name: String(raw?.name || fallback.name || 'Efeito'),
    kind: normalizeEffectKind(raw?.kind || fallback.kind || raw?.target),
    target: String(raw?.target || fallback.target || 'custom'),
    value: Math.floor(Number(raw?.value ?? fallback.value ?? 0) || 0),
    createdAtTurn: Math.max(0, Math.floor(Number(raw?.createdAtTurn ?? fallback.createdAtTurn ?? 0) || 0)),
    expiresAtTurn: raw?.expiresAtTurn == null ? fallback.expiresAtTurn : Math.max(0, Math.floor(Number(raw.expiresAtTurn) || 0)),
    remaining: raw?.remaining == null ? fallback.remaining : Math.max(0, Math.floor(Number(raw.remaining) || 0)),
    unit,
    status: normalizeStatus(raw?.status || fallback.status),
    stackPolicy: normalizeStackPolicy(raw?.stackPolicy || fallback.stackPolicy),
  };
}

export function applyEffectStack(current: LanDomainActiveEffect[], incomingRaw: any): LanDomainActiveEffect[] {
  const incoming = normalizeDomainEffect(incomingRaw);
  if (incoming.status !== 'active') return removeEffects(current, [incoming.effectId]);

  const sameSource = (effect: LanDomainActiveEffect) => (
    effect.sourceId === incoming.sourceId &&
    effect.sourceType === incoming.sourceType &&
    effect.targetKey === incoming.targetKey &&
    effect.target === incoming.target
  );

  if (incoming.stackPolicy === 'ignore_duplicate' && current.some(sameSource)) return current;
  if (incoming.stackPolicy === 'replace_same_source') {
    return [...current.filter((effect) => !sameSource(effect)), incoming];
  }
  if (incoming.stackPolicy === 'highest') {
    const others = current.filter((effect) => !sameSource(effect));
    const best = current.filter(sameSource).reduce((selected, effect) => (
      Math.abs(effect.value) > Math.abs(selected.value) ? effect : selected
    ), incoming);
    return [...others, Math.abs(incoming.value) > Math.abs(best.value) ? incoming : best];
  }
  return [...current, incoming];
}

export function removeEffects(current: LanDomainActiveEffect[], effectIds: string[]): LanDomainActiveEffect[] {
  const removeSet = new Set(effectIds.map(String).filter(Boolean));
  return current.filter((effect) => !removeSet.has(effect.effectId) && !removeSet.has(effect.sourceId));
}

export function advanceEffectsByUnit(current: LanDomainActiveEffect[], unit: LanAdvanceUnit): AdvanceEffectsResult {
  const activeEffects: LanDomainActiveEffect[] = [];
  const expiredEffects: LanDomainActiveEffect[] = [];
  let removedTempHp = 0;

  for (const effect of current.map((entry) => normalizeDomainEffect(entry))) {
    if (effect.status !== 'active') continue;
    if (!canEffectTick(effect)) {
      activeEffects.push(effect);
      continue;
    }

    const delta = getDurationDelta(effect.unit, unit);
    if (delta <= 0) {
      activeEffects.push(effect);
      continue;
    }

    const remaining = Math.max(0, Math.floor(Number(effect.remaining || 0) - delta));
    if (remaining <= 0) {
      const expired = { ...effect, remaining: 0, status: 'expired' as const };
      expiredEffects.push(expired);
      if (effect.kind === 'temp_hp' || String(effect.target).toUpperCase() === 'PV_TEMP') {
        removedTempHp = Math.max(removedTempHp, Math.max(0, Number(effect.value || 0) || 0));
      }
    } else {
      activeEffects.push({ ...effect, remaining });
    }
  }

  return { activeEffects, expiredEffects, removedTempHp };
}

export function calculateEffectiveStats(baseStats: Record<string, number>, effects: LanDomainActiveEffect[]): Record<string, number> {
  const next = { ...baseStats };
  for (const effect of effects) {
    if (effect.status !== 'active' || effect.kind !== 'stat') continue;
    const target = String(effect.target || '').toUpperCase();
    if (!target || target === 'CUSTOM') continue;
    next[target] = Math.max(0, Number(next[target] || 0) + Number(effect.value || 0));
  }
  return next;
}

function canEffectTick(effect: LanDomainActiveEffect) {
  if (effect.status !== 'active') return false;
  if (['manual', 'permanent', 'while_equipped', 'concentration'].includes(effect.unit)) return false;
  return Math.max(0, Math.floor(Number(effect.remaining || 0) || 0)) > 0;
}

function getDurationDelta(effectUnit: LanEffectUnit, unit: LanAdvanceUnit) {
  if (effectUnit === 'turn' && unit === 'turn') return 1;
  if (effectUnit === 'round' && unit === 'turn') return 1;
  if (effectUnit === 'minute') {
    if (unit === 'minute') return 1;
    if (unit === 'hour' || unit === 'shortRest') return 60;
    if (unit === 'longRest') return 480;
  }
  if (effectUnit === 'hour') {
    if (unit === 'hour' || unit === 'shortRest') return 1;
    if (unit === 'longRest') return 8;
  }
  if ((effectUnit === 'rest' || effectUnit === 'short_rest') && (unit === 'shortRest' || unit === 'longRest')) return Number.MAX_SAFE_INTEGER;
  if (effectUnit === 'long_rest' && unit === 'longRest') return Number.MAX_SAFE_INTEGER;
  return 0;
}

function normalizeEffectUnit(value: unknown): LanEffectUnit {
  const raw = String(value || 'manual').toLowerCase();
  if (raw === 'shortrest') return 'short_rest';
  if (raw === 'longrest') return 'long_rest';
  if ([
    'instant', 'turn', 'round', 'minute', 'hour', 'day', 'short_rest', 'long_rest',
    'rest', 'concentration', 'while_equipped', 'while_active', 'until_save', 'permanent', 'manual',
  ].includes(raw)) return raw as LanEffectUnit;
  return 'manual';
}

function normalizeEffectKind(value: unknown): LanDomainActiveEffect['kind'] {
  const raw = String(value || '').toLowerCase();
  if (raw === 'stat' || ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(String(value || '').toUpperCase())) return 'stat';
  if (raw === 'hp') return 'hp';
  if (raw === 'temp_hp' || raw === 'pv_temp') return 'temp_hp';
  if (raw === 'status' || raw === 'condition') return 'status';
  return 'custom';
}

function normalizeSourceType(value: unknown): LanDomainActiveEffect['sourceType'] {
  const raw = String(value || '').toLowerCase();
  if (['item', 'spell', 'condition', 'manual', 'session'].includes(raw)) return raw as LanDomainActiveEffect['sourceType'];
  return 'manual';
}

function normalizeStatus(value: unknown): LanDomainActiveEffect['status'] {
  const raw = String(value || 'active').toLowerCase();
  if (raw === 'expired' || raw === 'removed') return raw;
  return 'active';
}

function normalizeStackPolicy(value: unknown): LanDomainActiveEffect['stackPolicy'] {
  const raw = String(value || 'replace_same_source').toLowerCase();
  if (['replace_same_source', 'stack', 'highest', 'ignore_duplicate'].includes(raw)) return raw as LanDomainActiveEffect['stackPolicy'];
  return 'replace_same_source';
}

function makeStableEffectId(raw: any) {
  return [
    raw?.sourceId,
    raw?.sourceType,
    raw?.targetKey,
    raw?.name,
    raw?.target,
    raw?.value,
  ].map((part) => String(part || '').trim()).filter(Boolean).join(':') || `effect_${Date.now()}`;
}
