export type ApplyDamageWithTempHpInput = {
  hpCurrent: number;
  hpMax?: number;
  tempHp: number;
  damage: number;
};

export type ApplyDamageWithTempHpResult = {
  absorbedTempHp: number;
  remainingDamage: number;
  nextTempHp: number;
  nextHpCurrent: number;
  tempHpWasDepleted: boolean;
};

export function applyDamageWithTempHp(input: ApplyDamageWithTempHpInput): ApplyDamageWithTempHpResult {
  const safeDamage = Math.max(0, Math.floor(Number(input.damage) || 0));
  const safeHp = Math.max(0, Math.floor(Number(input.hpCurrent) || 0));
  const safeTemp = Math.max(0, Math.floor(Number(input.tempHp) || 0));

  const absorbedTempHp = Math.min(safeTemp, safeDamage);
  const remainingDamage = safeDamage - absorbedTempHp;
  const nextTempHp = Math.max(0, safeTemp - absorbedTempHp);
  const nextHpCurrent = Math.max(0, safeHp - remainingDamage);

  return {
    absorbedTempHp,
    remainingDamage,
    nextTempHp,
    nextHpCurrent,
    tempHpWasDepleted: safeTemp > 0 && nextTempHp === 0,
  };
}
