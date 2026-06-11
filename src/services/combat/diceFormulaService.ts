export type ParsedDiceFormula = {
  source: string;
  formula: string;
  count: number;
  sides: number;
  modifier: number;
  modifierTerms?: { type: 'number' | 'ability'; raw: string; value: number }[];
};

export type DiceFormulaRoll = {
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
  breakdown: string;
};

const SUPPORTED_VISUAL_DICE = [4, 6, 8, 10, 12, 20, 100];
const ABILITY_KEYS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'] as const;
type AbilityKey = (typeof ABILITY_KEYS)[number];
export type DiceFormulaContext = Partial<Record<AbilityKey, number>>;
type DiceModifierTerm = NonNullable<ParsedDiceFormula['modifierTerms']>[number];

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

  const repeatMatch = source.match(/(?:^|[^\d])(\d+)\s*x\s*\(?\s*(\d*)d(\d+)\s*((?:[+-]\s*(?:\d+|FOR|DES|CON|INT|SAB|CAR))*)/i);
  const diceMatch = repeatMatch || source.match(/(\d*)d(\d+)\s*((?:[+-]\s*(?:\d+|FOR|DES|CON|INT|SAB|CAR))*)/i);
  if (!diceMatch) return null;

  const repeat = repeatMatch ? normalizeInteger(repeatMatch[1], 1) : 1;
  const countRaw = repeatMatch ? repeatMatch[2] : diceMatch[1];
  const sidesRaw = repeatMatch ? repeatMatch[3] : diceMatch[2];
  const modifierRaw = repeatMatch ? repeatMatch[4] : diceMatch[3];

  const safeMultiplier = Math.max(1, normalizeInteger(multiplier, 1));
  const count = Math.max(1, Math.min(100, normalizeInteger(countRaw || 1, 1) * repeat * safeMultiplier));
  const sides = Math.max(2, Math.min(1000, normalizeInteger(sidesRaw, 20)));
  const modifierTerms = parseModifierTerms(modifierRaw, {}) ;
  const modifier = modifierTerms.reduce((sum, term) => sum + term.value, 0) * repeat * safeMultiplier;

  return {
    source,
    formula: `${count}d${sides}${formatModifier(modifier)}`,
    count,
    sides,
    modifier,
    modifierTerms,
  };
}

export function parseUsableDiceFormulaWithContext(
  input: unknown,
  context: DiceFormulaContext = {},
  multiplier = 1,
): ParsedDiceFormula | null {
  const parsed = parseUsableDiceFormula(input, multiplier);
  if (!parsed) return null;

  const diceMatch = parsed.source.match(/(\d*)d(\d+)\s*((?:[+-]\s*(?:\d+|FOR|DES|CON|INT|SAB|CAR))*)/i);
  const modifierRaw = diceMatch?.[3] || '';
  const repeatMatch = parsed.source.match(/(?:^|[^\d])(\d+)\s*x\s*\(?\s*(\d*)d(\d+)\s*((?:[+-]\s*(?:\d+|FOR|DES|CON|INT|SAB|CAR))*)/i);
  const repeat = repeatMatch ? normalizeInteger(repeatMatch[1], 1) : 1;
  const safeMultiplier = Math.max(1, normalizeInteger(multiplier, 1));
  const modifierTerms = parseModifierTerms(modifierRaw, context);
  const modifier = modifierTerms.reduce((sum, term) => sum + term.value, 0) * repeat * safeMultiplier;
  return {
    ...parsed,
    modifier,
    modifierTerms,
    formula: `${parsed.count}d${parsed.sides}${formatModifier(modifier)}`,
  };
}

export function canUseVisualDiceRoll(parsed: ParsedDiceFormula | null | undefined) {
  return Boolean(parsed && parsed.count > 0 && parsed.count <= 6 && SUPPORTED_VISUAL_DICE.includes(parsed.sides));
}

export function rollParsedDiceFormula(parsed: ParsedDiceFormula, rng: () => number = Math.random): DiceFormulaRoll {
  const rolls = Array.from({ length: parsed.count }, () => Math.floor(rng() * parsed.sides) + 1);
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

function parseModifierTerms(raw: unknown, context: DiceFormulaContext): DiceModifierTerm[] {
  const text = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!text) return [];
  const matches = text.matchAll(/([+-])(\d+|FOR|DES|CON|INT|SAB|CAR)/g);
  return Array.from(matches).map((match) => {
    const sign = match[1] === '-' ? -1 : 1;
    const token = match[2];
    const ability = ABILITY_KEYS.includes(token as AbilityKey) ? token as AbilityKey : null;
    const value = sign * (ability ? normalizeInteger(context[ability], 0) : normalizeInteger(token, 0));
    return {
      type: ability ? 'ability' as const : 'number' as const,
      raw: `${match[1]}${token}`,
      value,
    };
  });
}
