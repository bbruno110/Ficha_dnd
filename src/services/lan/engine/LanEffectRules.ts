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
  mode?: 'add' | 'set' | string;
  isPermanent?: boolean;
  visibleToPlayer?: boolean;
  color?: string;
  secondaryColor?: string;
  visualPriority?: number;
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

const STAT_TARGETS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'];

export function normalizeDomainEffect(raw: any, fallback: Partial<LanDomainActiveEffect> = {}): LanDomainActiveEffect {
  const unit = normalizeEffectUnit(raw?.unit || raw?.durationUnit || fallback.unit || 'manual');
  const effectId = String(raw?.effectId || raw?.id || raw?.lanEffectId || fallback.effectId || makeStableEffectId(raw));
  const target = String(raw?.target || fallback.target || 'custom');
  const kind = normalizeEffectKind(raw?.kind || raw?.type || fallback.kind, target);
  const normalizedName = String(raw?.name || fallback.name || 'Efeito');
  const color = normalizeColor(raw?.color || fallback.color || inferConditionColor(normalizedName, kind));
  const secondaryColor = normalizeColor(raw?.secondaryColor || fallback.secondaryColor || raw?.secondary_color || color);
  return {
    effectId,
    sourceId: String(raw?.sourceId || fallback.sourceId || effectId),
    sourceType: normalizeSourceType(raw?.sourceType || fallback.sourceType),
    targetKey: String(raw?.targetKey || fallback.targetKey || ''),
    name: normalizedName,
    kind,
    target,
    value: Math.floor(Number(raw?.value ?? fallback.value ?? 0) || 0),
    mode: String(raw?.mode || fallback.mode || 'add'),
    isPermanent: Boolean(raw?.isPermanent ?? fallback.isPermanent ?? unit === 'permanent'),
    visibleToPlayer: raw?.visibleToPlayer == null ? fallback.visibleToPlayer : raw.visibleToPlayer !== false,
    color,
    secondaryColor,
    visualPriority: Number(raw?.visualPriority ?? fallback.visualPriority ?? (kind === 'status' ? 100 : 0)) || 0,
    createdAtTurn: Math.max(0, Math.floor(Number(raw?.createdAtTurn ?? fallback.createdAtTurn ?? 0) || 0)),
    expiresAtTurn: raw?.expiresAtTurn == null ? fallback.expiresAtTurn : Math.max(0, Math.floor(Number(raw.expiresAtTurn) || 0)),
    remaining: raw?.remaining == null ? fallback.remaining : Math.max(0, Math.floor(Number(raw.remaining) || 0)),
    unit,
    status: normalizeStatus(raw?.status || fallback.status),
    stackPolicy: normalizeStackPolicy(raw?.stackPolicy || fallback.stackPolicy),
  };
}

export function isPermanentStatAdjustment(effectOrCommand: unknown) {
  const effect = effectOrCommand && typeof effectOrCommand === 'object' ? effectOrCommand as Record<string, any> : {};
  const target = String(effect.target || '').toUpperCase();
  const unit = String(effect.unit || effect.durationUnit || '').toLowerCase();
  const kind = normalizeEffectKind(effect.kind || effect.type, target);
  return (
    STAT_TARGETS.includes(target) &&
    !['hp', 'temp_hp', 'status'].includes(kind) &&
    (effect.isPermanent === true || unit === 'permanent')
  );
}

export function isVisibleTemporaryEffect(effectOrCommand: unknown) {
  const effect = effectOrCommand && typeof effectOrCommand === 'object' ? effectOrCommand as Record<string, any> : {};
  if (isPermanentStatAdjustment(effect)) return false;
  if (effect.visibleToPlayer === false) return false;
  const status = String(effect.status || 'active').toLowerCase();
  if (status && status !== 'active') return false;
  const unit = String(effect.unit || effect.durationUnit || '').toLowerCase();
  if (['permanent', 'manual', 'while_equipped'].includes(unit)) return false;
  return true;
}

export function isConditionVisualEffect(effectOrCommand: unknown) {
  const effect = effectOrCommand && typeof effectOrCommand === 'object' ? effectOrCommand as Record<string, any> : {};
  if (!isVisibleTemporaryEffect(effect)) return false;
  const kind = normalizeEffectKind(effect.kind || effect.type, effect.target);
  return kind === 'status' || Boolean(effect.color || effect.secondaryColor);
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

function normalizeEffectKind(value: unknown, targetValue?: unknown): LanDomainActiveEffect['kind'] {
  const raw = String(value || '').toLowerCase();
  if (raw === 'hp') return 'hp';
  if (raw === 'temp_hp' || raw === 'pv_temp') return 'temp_hp';
  if (raw === 'status' || raw === 'condition') return 'status';
  if (raw === 'stat' || STAT_TARGETS.includes(String(targetValue ?? value ?? '').toUpperCase())) return 'stat';
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

function normalizeColor(value: unknown) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return undefined;
}

function inferConditionColor(name: string, kind: LanDomainActiveEffect['kind']) {
  if (kind !== 'status') return undefined;
  const raw = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/queim|fogo|burn/.test(raw)) return '#ff6b35';
  if (/sangr|bleed/.test(raw)) return '#b00020';
  if (/venen|poison/.test(raw)) return '#6a994e';
  if (/paralis|contid|restrain|dorm|sleep/.test(raw)) return '#6c63ff';
  if (/cego|blind|escuro/.test(raw)) return '#444444';
  return '#888888';
}

function makeStableEffectId(raw: any) {
  return [
    raw?.sourceId,
    raw?.sourceType,
    raw?.targetKey,
    raw?.name,
    raw?.target,
    raw?.value,
  ].map((part) => String(part || '').trim()).filter(Boolean).join(':') || 'effect_unknown';
}
