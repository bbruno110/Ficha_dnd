import type { LanActiveEffectSnapshot } from './effectTypes';
import {
  isConditionVisualEffect,
  isPermanentStatAdjustment,
  isVisibleTemporaryEffect,
} from '../lan/engine/LanEffectRules';

const FALLBACK_COLOR = '#888888';
const BREATH_MS_PER_EFFECT = 2000; // 2s por efeito visual.
const BREATH_TICK_MS = 50;

function isEffectStillActive(effect: LanActiveEffectSnapshot | any) {
  if (!effect || effect.active === false) return false;
  if (isPermanentStatAdjustment(effect)) return false;
  const unit = String(effect.unit || '').toLowerCase();
  if (effect.isPermanent === true || unit === 'permanent' || unit === 'manual' || unit === 'while_equipped' || unit === 'concentration') return false;
  return Number(effect.remaining || 0) > 0;
}

export function getVisibleEffects(effects: LanActiveEffectSnapshot[] | unknown) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect && effect.status !== 'permanent_item_effect' && isVisibleTemporaryEffect(effect) && isEffectStillActive(effect))
    .sort((a, b) => (Number(b.visualPriority || 0) - Number(a.visualPriority || 0)) || String(a.name).localeCompare(String(b.name)));
}

export function getPrimaryEffect(effects: LanActiveEffectSnapshot[] | unknown) {
  return getVisibleEffects(effects)[0] || null;
}

export function getBorderColorsForPlayer(effects: LanActiveEffectSnapshot[] | unknown, limit = 4) {
  const colors = getVisibleEffects(effects)
    .filter((effect) => isConditionVisualEffect(effect))
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


function hexToRgb(color?: string) {
  const raw = String(color || '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function mixColor(from: string, to: string, amount: number) {
  const a = hexToRgb(from) || hexToRgb(FALLBACK_COLOR)!;
  const b = hexToRgb(to) || hexToRgb(FALLBACK_COLOR)!;
  const t = Math.max(0, Math.min(1, amount));
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const b2 = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${b2})`;
}

function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function getCurrentBreathColor(effects: LanActiveEffectSnapshot[] | unknown, frame: number) {
  return getCurrentBreathFrameStyle(effects, frame)?.borderColor;
}

export function getCurrentBreathFrameStyle(effects: LanActiveEffectSnapshot[] | unknown, frame: number) {
  const colors = getBorderColorsForPlayer(effects);
  if (colors.length === 0) return undefined;

  const elapsedMs = Math.max(0, Math.floor(Math.abs(frame))) * BREATH_TICK_MS;
  const slot = Math.floor(elapsedMs / BREATH_MS_PER_EFFECT) % colors.length;
  const nextSlot = (slot + 1) % colors.length;
  const phaseMs = elapsedMs % BREATH_MS_PER_EFFECT;
  const phase = phaseMs / BREATH_MS_PER_EFFECT;

  // 0..0.45: fade in / 0.45..0.65: segura / 0.65..1: fade para a próxima cor.
  let opacity = 0.58;
  let borderColor = colors[slot] || FALLBACK_COLOR;

  if (colors.length === 1) {
    const pulse = 0.5 - Math.cos(phase * Math.PI * 2) / 2;
    opacity = 0.38 + pulse * 0.42;
  } else if (phase < 0.45) {
    opacity = 0.35 + smoothStep(phase / 0.45) * 0.45;
  } else if (phase < 0.65) {
    opacity = 0.8;
  } else {
    const transition = smoothStep((phase - 0.65) / 0.35);
    borderColor = mixColor(colors[slot] || FALLBACK_COLOR, colors[nextSlot] || FALLBACK_COLOR, transition);
    opacity = 0.8 - transition * 0.25;
  }

  return {
    borderColor,
    shadowColor: borderColor,
    opacity,
  };
}

