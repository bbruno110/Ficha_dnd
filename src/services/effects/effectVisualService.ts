import type { LanActiveEffectSnapshot } from './effectTypes';

const FALLBACK_COLOR = '#888888';

export function getVisibleEffects(effects: LanActiveEffectSnapshot[] | unknown) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect && effect.visibleToPlayer !== false)
    .sort((a, b) => (Number(b.visualPriority || 0) - Number(a.visualPriority || 0)) || String(a.name).localeCompare(String(b.name)));
}

export function getPrimaryEffect(effects: LanActiveEffectSnapshot[] | unknown) {
  return getVisibleEffects(effects)[0] || null;
}

export function getBorderColorsForPlayer(effects: LanActiveEffectSnapshot[] | unknown, limit = 4) {
  const colors = getVisibleEffects(effects)
    .map((effect) => effect.color || effect.secondaryColor)
    .filter((color): color is string => Boolean(color));
  return Array.from(new Set(colors)).slice(0, limit);
}

export function buildBreathAnimationColors(effects: LanActiveEffectSnapshot[] | unknown) {
  const colors = getBorderColorsForPlayer(effects);
  if (colors.length === 0) return [];
  if (colors.length === 1) return [colors[0]];
  return [...colors, colors[0]];
}

export function getCurrentBreathColor(effects: LanActiveEffectSnapshot[] | unknown, frame: number) {
  const colors = getBorderColorsForPlayer(effects);
  if (colors.length === 0) return undefined;
  return colors[Math.abs(frame) % colors.length] || FALLBACK_COLOR;
}

