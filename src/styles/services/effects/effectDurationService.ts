export type NormalizedEffectDuration = {
  value: number;
  remaining: number;
  unit: string;
  isPermanent: boolean;
};

export function parseEffectDurationValue(input: unknown): number {
  const parsed = Number(input);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 1;
}

export function normalizeEffectDurationUnit(unit: unknown): string {
  const value = String(unit || '').trim().toLowerCase();

  if (['turn', 'turns', 'turno', 'turnos', 'rodada', 'rodadas', 'round', 'rounds'].includes(value)) return 'turn';
  if (['minute', 'minutes', 'minuto', 'minutos', 'min'].includes(value)) return 'minute';
  if (['hour', 'hours', 'hora', 'horas'].includes(value)) return 'hour';
  if (['rest', 'descanso'].includes(value)) return 'rest';
  if (['permanent', 'permanente'].includes(value)) return 'permanent';
  if (['manual'].includes(value)) return 'manual';

  return value || 'turn';
}

export function createEffectDurationPayload(params: { value: unknown; unit: unknown }): NormalizedEffectDuration {
  const unit = normalizeEffectDurationUnit(params.unit);
  if (unit === 'permanent') {
    return { value: 0, remaining: 0, unit, isPermanent: true };
  }

  const value = parseEffectDurationValue(params.value);
  return { value, remaining: value, unit, isPermanent: false };
}
