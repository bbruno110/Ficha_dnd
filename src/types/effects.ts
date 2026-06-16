export type EffectSourceTable = 'items' | 'spells';

export type EffectKind = 'damage' | 'healing' | 'condition' | 'stat_modifier' | 'utility';

export type EffectValueMode = 'none' | 'fixed' | 'dice';

export type EffectDurationUnit = 'instant' | 'turn' | 'round' | 'minute' | 'hour' | 'day' | 'permanent';

export type EffectDraft = {
  effect_kind: EffectKind;
  effect_type: string;
  value_mode: EffectValueMode;
  dice_count?: number | null;
  dice_sides?: number | null;
  dice_bonus?: number | null;
  fixed_value?: number | null;
  chance_percent: number;
  duration_value?: number | null;
  duration_unit: EffectDurationUnit;
  condition_name?: string | null;
  target?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function formatEffectSummary(effect: EffectDraft) {
  const chance = effect.chance_percent < 100 ? `${effect.chance_percent}% ` : '';
  const duration =
    effect.duration_unit === 'instant'
      ? ''
      : effect.duration_unit === 'permanent'
        ? ' permanente'
        : ` por ${effect.duration_value || 1} ${effect.duration_unit === 'turn' ? 'turno(s)' : effect.duration_unit}`;

  if (effect.effect_kind === 'healing') {
    return `${chance}Cura ${formatEffectValue(effect)}${duration}`.trim();
  }

  if (effect.effect_kind === 'condition') {
    return `${chance}${effect.condition_name || effect.effect_type}${duration}`.trim();
  }

  if (effect.effect_kind === 'stat_modifier') {
    return `${chance}${effect.effect_type} ${formatEffectValue(effect)}${duration}`.trim();
  }

  if (effect.effect_kind === 'damage') {
    return `${chance}${formatEffectValue(effect)} ${effect.effect_type}${duration}`.trim();
  }

  return `${chance}${effect.effect_type}${duration}`.trim();
}

export function formatEffectValue(effect: EffectDraft) {
  if (effect.value_mode === 'dice') {
    const bonus = effect.dice_bonus || 0;
    return `${effect.dice_count || 1}d${effect.dice_sides || 6}${bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : ''}`;
  }

  if (effect.value_mode === 'fixed') {
    return String(effect.fixed_value ?? 0);
  }

  return '';
}
