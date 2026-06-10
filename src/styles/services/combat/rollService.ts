export type CombatRollMode = 'virtual' | 'manual';

export type D20RollResult = {
  rollId: string;
  rollMode: CombatRollMode;
  dice: '1d20';
  rawRoll: number;
  manualValue?: number;
  modifier: number;
  total: number;
  timestamp: string;
};

export type DiceFormulaRollResult = {
  rollId: string;
  rollMode: CombatRollMode;
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
  timestamp: string;
};

function makeRollId(prefix = 'roll') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeModifier(value: unknown) {
  return Math.floor(Number(value) || 0);
}

function clampD20(value: unknown) {
  return Math.max(1, Math.min(20, Math.floor(Number(value) || 1)));
}

export function rollD20(modifier = 0, rollId = makeRollId('d20')): D20RollResult {
  const rawRoll = Math.floor(Math.random() * 20) + 1;
  const safeModifier = normalizeModifier(modifier);
  return {
    rollId,
    rollMode: 'virtual',
    dice: '1d20',
    rawRoll,
    modifier: safeModifier,
    total: rawRoll + safeModifier,
    timestamp: new Date().toISOString(),
  };
}

export function resolveD20Manual(manualRoll: unknown, modifier = 0, rollId = makeRollId('d20')): D20RollResult {
  const rawRoll = clampD20(manualRoll);
  const safeModifier = normalizeModifier(modifier);
  return {
    rollId,
    rollMode: 'manual',
    dice: '1d20',
    rawRoll,
    manualValue: rawRoll,
    modifier: safeModifier,
    total: rawRoll + safeModifier,
    timestamp: new Date().toISOString(),
  };
}

export function resolveD20Roll(params: {
  rollMode: CombatRollMode;
  modifier?: number;
  manualRoll?: number;
  rollId?: string;
}) {
  return params.rollMode === 'virtual'
    ? rollD20(params.modifier || 0, params.rollId)
    : resolveD20Manual(params.manualRoll, params.modifier || 0, params.rollId);
}

export function rollDiceFormula(formula: string, rollId = makeRollId('dice')): DiceFormulaRollResult {
  const parsed = parseDiceFormula(formula);
  const rolls = Array.from({ length: parsed.count }, () => Math.floor(Math.random() * parsed.sides) + 1);
  const total = rolls.reduce((sum, value) => sum + value, 0) + parsed.modifier;
  return {
    rollId,
    rollMode: 'virtual',
    formula: parsed.formula,
    rolls,
    modifier: parsed.modifier,
    total,
    timestamp: new Date().toISOString(),
  };
}

export function resolveManualValue(value: unknown, modifier = 0, rollId = makeRollId('manual')): DiceFormulaRollResult {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  const safeModifier = normalizeModifier(modifier);
  return {
    rollId,
    rollMode: 'manual',
    formula: 'manual',
    rolls: [safeValue],
    modifier: safeModifier,
    total: safeValue + safeModifier,
    timestamp: new Date().toISOString(),
  };
}

function parseDiceFormula(formula: string) {
  const clean = String(formula || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = clean.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) {
    return { formula: '1d20', count: 1, sides: 20, modifier: 0 };
  }
  return {
    formula: clean,
    count: Math.max(1, Math.min(100, Math.floor(Number(match[1] || 1) || 1))),
    sides: Math.max(2, Math.min(1000, Math.floor(Number(match[2]) || 20))),
    modifier: normalizeModifier(match[3] || 0),
  };
}
