import type { SQLiteDatabase } from 'expo-sqlite';

type ColumnDefinition = [table: string, column: string, definition: string];

export async function ensureEffectSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_effect_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_uid TEXT UNIQUE,
      status_key TEXT UNIQUE,
      name TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL DEFAULT 'condition',
      category TEXT DEFAULT 'custom',
      description TEXT,
      color TEXT NOT NULL DEFAULT '#888888',
      secondary_color TEXT,
      icon TEXT,
      target TEXT NOT NULL DEFAULT 'custom',
      value INTEGER NOT NULL DEFAULT 0,
      duration_value INTEGER,
      duration_unit TEXT,
      default_duration_value INTEGER,
      default_duration_unit TEXT,
      stackable INTEGER NOT NULL DEFAULT 0,
      removable_by_save INTEGER NOT NULL DEFAULT 0,
      repeat_save TEXT,
      save_ability TEXT,
      save_on_success TEXT,
      visual_priority INTEGER NOT NULL DEFAULT 0,
      rules_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      criador TEXT DEFAULT 'user',
      source TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_active_effects (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      target_key TEXT NOT NULL,
      status_key TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      source_name TEXT,
      applied_by_key TEXT,
      applied_by_name TEXT,
      remaining_value INTEGER,
      remaining_unit TEXT,
      started_turn INTEGER,
      expires_at_minutes INTEGER,
      save_dc INTEGER,
      save_ability TEXT,
      repeat_save TEXT,
      visible_to_player INTEGER NOT NULL DEFAULT 1,
      private_note TEXT,
      public_note TEXT,
      stack_count INTEGER NOT NULL DEFAULT 1,
      effect_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_pending_saves (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      target_key TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      source_name TEXT,
      effect_payload_json TEXT NOT NULL,
      ability TEXT NOT NULL,
      dc INTEGER,
      dc_mode TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );
  `);

  await addColumnsIfMissing(db, [
    ['lan_effect_catalog', 'import_uid', 'TEXT'],
    ['lan_effect_catalog', 'status_key', 'TEXT'],
    ['lan_effect_catalog', 'kind', "TEXT NOT NULL DEFAULT 'condition'"],
    ['lan_effect_catalog', 'category', "TEXT DEFAULT 'custom'"],
    ['lan_effect_catalog', 'description', 'TEXT'],
    ['lan_effect_catalog', 'color', "TEXT NOT NULL DEFAULT '#888888'"],
    ['lan_effect_catalog', 'secondary_color', 'TEXT'],
    ['lan_effect_catalog', 'icon', 'TEXT'],
    ['lan_effect_catalog', 'target', "TEXT NOT NULL DEFAULT 'custom'"],
    ['lan_effect_catalog', 'value', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'duration_value', 'INTEGER'],
    ['lan_effect_catalog', 'duration_unit', 'TEXT'],
    ['lan_effect_catalog', 'default_duration_value', 'INTEGER'],
    ['lan_effect_catalog', 'default_duration_unit', 'TEXT'],
    ['lan_effect_catalog', 'stackable', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'removable_by_save', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'repeat_save', 'TEXT'],
    ['lan_effect_catalog', 'save_ability', 'TEXT'],
    ['lan_effect_catalog', 'save_on_success', 'TEXT'],
    ['lan_effect_catalog', 'visual_priority', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'rules_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['lan_effect_catalog', 'active', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_effect_catalog', 'criador', "TEXT DEFAULT 'user'"],
    ['lan_effect_catalog', 'source', "TEXT DEFAULT 'user'"],
    ['lan_effect_catalog', 'created_at', 'DATETIME'],
    ['lan_effect_catalog', 'updated_at', 'DATETIME'],
    ['lan_active_effects', 'source_type', 'TEXT'],
    ['lan_active_effects', 'source_id', 'TEXT'],
    ['lan_active_effects', 'source_name', 'TEXT'],
    ['lan_active_effects', 'applied_by_key', 'TEXT'],
    ['lan_active_effects', 'applied_by_name', 'TEXT'],
    ['lan_active_effects', 'remaining_value', 'INTEGER'],
    ['lan_active_effects', 'remaining_unit', 'TEXT'],
    ['lan_active_effects', 'started_turn', 'INTEGER'],
    ['lan_active_effects', 'expires_at_minutes', 'INTEGER'],
    ['lan_active_effects', 'save_dc', 'INTEGER'],
    ['lan_active_effects', 'save_ability', 'TEXT'],
    ['lan_active_effects', 'repeat_save', 'TEXT'],
    ['lan_active_effects', 'visible_to_player', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_active_effects', 'private_note', 'TEXT'],
    ['lan_active_effects', 'public_note', 'TEXT'],
    ['lan_active_effects', 'stack_count', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_active_effects', 'effect_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['lan_active_effects', 'active', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_active_effects', 'created_at', 'DATETIME'],
    ['lan_active_effects', 'updated_at', 'DATETIME'],
  ]);

  await db.execAsync(`
    UPDATE lan_effect_catalog
    SET
      status_key = COALESCE(status_key, lower(replace(name, ' ', '_'))),
      color = COALESCE(color, '#888888'),
      category = COALESCE(category, source, 'custom'),
      default_duration_value = COALESCE(default_duration_value, duration_value),
      default_duration_unit = COALESCE(default_duration_unit, duration_unit),
      active = COALESCE(active, 1),
      criador = COALESCE(criador, source, 'user'),
      created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
      updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);

    CREATE INDEX IF NOT EXISTS idx_lan_effect_status_key ON lan_effect_catalog(status_key);
    CREATE INDEX IF NOT EXISTS idx_lan_effect_active ON lan_effect_catalog(active, visual_priority, name);
    CREATE INDEX IF NOT EXISTS idx_lan_active_effects_target ON lan_active_effects(session_id, target_key, active);
    CREATE INDEX IF NOT EXISTS idx_lan_active_effects_status ON lan_active_effects(session_id, status_key, active);
    CREATE INDEX IF NOT EXISTS idx_lan_pending_saves_session ON lan_pending_saves(session_id, status);
  `);
}

async function addColumnsIfMissing(db: SQLiteDatabase, columns: ColumnDefinition[]) {
  for (const [table, column, definition] of columns) {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch {
      // Existing columns are expected across upgraded local databases.
    }
  }
}
