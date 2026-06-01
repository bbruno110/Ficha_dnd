import type { SQLiteDatabase } from 'expo-sqlite';

export type XpProgressionRow = {
  level: number;
  xpRequired: number;
  proficiencyBonus?: number | null;
  source: string;
  active: boolean;
};

const DEFAULT_XP_PROGRESSION: Pick<XpProgressionRow, 'level' | 'xpRequired' | 'proficiencyBonus'>[] = [
  { level: 1, xpRequired: 0, proficiencyBonus: 2 },
  { level: 2, xpRequired: 300, proficiencyBonus: 2 },
  { level: 3, xpRequired: 900, proficiencyBonus: 2 },
  { level: 4, xpRequired: 2700, proficiencyBonus: 2 },
  { level: 5, xpRequired: 6500, proficiencyBonus: 3 },
  { level: 6, xpRequired: 14000, proficiencyBonus: 3 },
  { level: 7, xpRequired: 23000, proficiencyBonus: 3 },
  { level: 8, xpRequired: 34000, proficiencyBonus: 3 },
  { level: 9, xpRequired: 48000, proficiencyBonus: 4 },
  { level: 10, xpRequired: 64000, proficiencyBonus: 4 },
  { level: 11, xpRequired: 85000, proficiencyBonus: 4 },
  { level: 12, xpRequired: 100000, proficiencyBonus: 4 },
  { level: 13, xpRequired: 120000, proficiencyBonus: 5 },
  { level: 14, xpRequired: 140000, proficiencyBonus: 5 },
  { level: 15, xpRequired: 165000, proficiencyBonus: 5 },
  { level: 16, xpRequired: 195000, proficiencyBonus: 5 },
  { level: 17, xpRequired: 225000, proficiencyBonus: 6 },
  { level: 18, xpRequired: 265000, proficiencyBonus: 6 },
  { level: 19, xpRequired: 305000, proficiencyBonus: 6 },
  { level: 20, xpRequired: 355000, proficiencyBonus: 6 },
];

export async function ensureXpProgressionSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS xp_progression (
      level INTEGER PRIMARY KEY,
      xp_required INTEGER NOT NULL,
      proficiency_bonus INTEGER,
      source TEXT NOT NULL DEFAULT 'dnd5e',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function seedDefaultXpProgression(db: SQLiteDatabase) {
  await ensureXpProgressionSchema(db);

  for (const row of DEFAULT_XP_PROGRESSION) {
    await db.runAsync(
      `INSERT INTO xp_progression (
         level, xp_required, proficiency_bonus, source, active, created_at, updated_at
       )
       VALUES (?, ?, ?, 'dnd5e', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(level) DO UPDATE SET
         xp_required = CASE
           WHEN xp_progression.source = 'dnd5e' THEN excluded.xp_required
           ELSE xp_progression.xp_required
         END,
         proficiency_bonus = CASE
           WHEN xp_progression.source = 'dnd5e' THEN excluded.proficiency_bonus
           ELSE xp_progression.proficiency_bonus
         END,
         active = COALESCE(xp_progression.active, 1),
         updated_at = CURRENT_TIMESTAMP`,
      [row.level, row.xpRequired, row.proficiencyBonus ?? null]
    );
  }
}

export async function getXpProgression(db: SQLiteDatabase): Promise<XpProgressionRow[]> {
  await seedDefaultXpProgression(db);

  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT level, xp_required, proficiency_bonus, source, active
     FROM xp_progression
     WHERE active = 1
     ORDER BY level ASC`
  );

  return rows.map(normalizeXpProgressionRow);
}

export async function getExpectedLevelForXp(db: SQLiteDatabase, xp: number) {
  const progression = await getXpProgression(db);
  return getExpectedLevelForXpFromRows(progression, xp);
}

export async function getXpRequiredForLevel(db: SQLiteDatabase, level: number) {
  await seedDefaultXpProgression(db);
  const boundedLevel = Math.max(1, Math.floor(Number(level) || 1));
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT xp_required FROM xp_progression WHERE level = ? AND active = 1 LIMIT 1`,
    [boundedLevel]
  );

  return row ? toNumber(row.xp_required) : null;
}

export async function canLevelUp(db: SQLiteDatabase, currentLevel: number, xp: number) {
  const expectedLevel = await getExpectedLevelForXp(db, xp);
  return expectedLevel > Math.max(1, Math.floor(Number(currentLevel) || 1));
}

export function getExpectedLevelForXpFromRows(rows: XpProgressionRow[], xp: number) {
  const xpValue = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;

  for (const row of rows) {
    if (xpValue >= row.xpRequired) {
      level = Math.max(level, row.level);
    }
  }

  return level;
}

function normalizeXpProgressionRow(row: Record<string, unknown>): XpProgressionRow {
  return {
    level: Math.max(1, toNumber(row.level, 1)),
    xpRequired: Math.max(0, toNumber(row.xp_required)),
    proficiencyBonus: row.proficiency_bonus == null ? null : toNumber(row.proficiency_bonus),
    source: String(row.source || 'dnd5e'),
    active: toNumber(row.active, 1) === 1,
  };
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
