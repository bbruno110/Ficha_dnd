import { resolveD20Roll } from './rollService';

export type SaveAbility = 'FOR' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR';
export type SaveRollMode = 'virtual' | 'manual';

export type ResolveSaveInput = {
  ability: string;
  dc: number;
  modifier: number;
  rollMode: SaveRollMode;
  manualRoll?: number;
};

export type ResolveSaveResult = {
  ability: SaveAbility;
  dc: number;
  rawRoll: number;
  modifier: number;
  total: number;
  passed: boolean;
  rollMode: SaveRollMode;
};

const SAVE_ABILITIES: SaveAbility[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];

export function normalizeSaveAbility(value: unknown): SaveAbility {
  const normalized = String(value || '').trim().toUpperCase();
  return SAVE_ABILITIES.includes(normalized as SaveAbility) ? normalized as SaveAbility : 'DES';
}

export function resolveSavingThrow(input: ResolveSaveInput): ResolveSaveResult {
  const ability = normalizeSaveAbility(input.ability);
  const dc = Math.max(1, Math.floor(Number(input.dc) || 1));
  const modifier = Math.floor(Number(input.modifier) || 0);
  const roll = resolveD20Roll({
    rollMode: input.rollMode,
    modifier,
    manualRoll: input.manualRoll,
  });

  return {
    ability,
    dc,
    rawRoll: roll.rawRoll,
    modifier,
    total: roll.total,
    passed: roll.total >= dc,
    rollMode: input.rollMode,
  };
}
