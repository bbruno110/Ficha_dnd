import type { CombatRollMode } from './rollService';

export type ResolveAttackInput = {
  rawRoll: number;
  modifier: number;
  targetArmorClass: number;
  rollMode?: CombatRollMode;
  damageTotal?: number;
  damageType?: string;
  criticalAlwaysHits?: boolean;
  fumbleAlwaysMisses?: boolean;
};

export type ResolveAttackResult = {
  attackRoll: number;
  attackModifier: number;
  attackTotal: number;
  targetAC: number;
  rollMode?: CombatRollMode;
  isCritical: boolean;
  isFumble: boolean;
  hit: boolean;
  damageTotal?: number;
  damageType?: string;
};

export function resolveAttackAgainstArmorClass(input: ResolveAttackInput): ResolveAttackResult {
  const attackRoll = Math.max(1, Math.min(20, Math.floor(Number(input.rawRoll) || 1)));
  const attackModifier = Math.floor(Number(input.modifier) || 0);
  const attackTotal = attackRoll + attackModifier;
  const targetAC = Math.max(1, Math.floor(Number(input.targetArmorClass) || 10));
  const isCritical = attackRoll === 20;
  const isFumble = attackRoll === 1;
  const hit = input.fumbleAlwaysMisses && isFumble
    ? false
    : input.criticalAlwaysHits && isCritical
      ? true
      : attackTotal >= targetAC;

  return {
    attackRoll,
    attackModifier,
    attackTotal,
    targetAC,
    rollMode: input.rollMode,
    isCritical,
    isFumble,
    hit,
    damageTotal: input.damageTotal,
    damageType: input.damageType,
  };
}
