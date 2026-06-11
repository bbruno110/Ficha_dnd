export type ParsedDiceFormula = {
  source: string;
  formula: string;
  count: number;
  sides: number;
  modifier: number;
};

export type DiceFormulaRoll = {
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
  breakdown: string;
};

const SUPPORTED_VISUAL_DICE = [4, 6, 8, 10, 12, 20, 100];

function normalizeInteger(value: unknown, fallback = 0) {
  const parsed = Math.floor(Number(value) || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatModifier(value: number) {
  if (!value) return '';
  return value > 0 ? `+${value}` : String(value);
}

export function parseUsableDiceFormula(input: unknown, multiplier = 1): ParsedDiceFormula | null {
  const source = String(input || '').trim();
  if (!source) return null;

  const repeatMatch = source.match(/(?:^|[^\d])(\d+)\s*x\s*\(?\s*(\d*)d(\d+)\s*([+-]\s*\d+)?/i);
  const diceMatch = repeatMatch || source.match(/(\d*)d(\d+)\s*([+-]\s*\d+)?/i);
  if (!diceMatch) return null;

  const repeat = repeatMatch ? normalizeInteger(repeatMatch[1], 1) : 1;
  const countRaw = repeatMatch ? repeatMatch[2] : diceMatch[1];
  const sidesRaw = repeatMatch ? repeatMatch[3] : diceMatch[2];
  const modifierRaw = repeatMatch ? repeatMatch[4] : diceMatch[3];

  const safeMultiplier = Math.max(1, normalizeInteger(multiplier, 1));
  const count = Math.max(1, Math.min(100, normalizeInteger(countRaw || 1, 1) * repeat * safeMultiplier));
  const sides = Math.max(2, Math.min(1000, normalizeInteger(sidesRaw, 20)));
  const modifier = normalizeInteger(String(modifierRaw || '').replace(/\s+/g, ''), 0) * repeat * safeMultiplier;

  return {
    source,
    formula: `${count}d${sides}${formatModifier(modifier)}`,
    count,
    sides,
    modifier,
  };
}

export function canUseVisualDiceRoll(parsed: ParsedDiceFormula | null | undefined) {
  return Boolean(parsed && parsed.count > 0 && parsed.count <= 6 && SUPPORTED_VISUAL_DICE.includes(parsed.sides));
}

export function rollParsedDiceFormula(parsed: ParsedDiceFormula): DiceFormulaRoll {
  const rolls = Array.from({ length: parsed.count }, () => Math.floor(Math.random() * parsed.sides) + 1);
  const diceTotal = rolls.reduce((sum, value) => sum + value, 0);
  const total = Math.max(0, diceTotal + parsed.modifier);
  const modifierText = formatModifier(parsed.modifier);
  return {
    formula: parsed.formula,
    rolls,
    modifier: parsed.modifier,
    total,
    breakdown: `${rolls.join('+')}${modifierText}`,
  };
}

export function formatDiceRollBreakdown(rollsText: string, modifier = 0) {
  return `${rollsText}${formatModifier(modifier)}`;
}
