import { SQLiteDatabase } from 'expo-sqlite';

import { ensureEffectSchema } from '../services/effects/effectSchema';
import { seedDefaultXpProgression } from '../services/xpProgressionService';

type ColumnDefinition = [table: string, column: string, definition: string];

type LanEffectCatalogSeed = {
  name: string;
  statusKey: string;
  target?: string;
  value?: number;
  durationValue?: number;
  durationUnit?: string;
  kind?: string;
  description: string;
  source?: string;
  color: string;
  secondaryColor: string;
  icon: string;
  stackable?: number;
  removableBySave?: number;
  repeatSave?: string | null;
  saveAbility?: string | null;
  saveOnSuccess?: string | null;
  visualPriority?: number;
  rulesJson?: string;
};

async function addColumnIfMissing(
  db: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  } catch {
    // Idempotent migration: the column may already exist or the base table may be older.
  }
}

async function addColumnsIfMissing(db: SQLiteDatabase, columns: ColumnDefinition[]) {
  for (const [table, column, definition] of columns) {
    await addColumnIfMissing(db, table, column, definition);
  }
}

export async function migrateDatabaseV2(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA foreign_keys = ON;`);
  await seedDefaultXpProgression(db);

  await addColumnsIfMissing(db, [
    ['races', 'effect_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['classes', 'effect_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['subclasses', 'effect_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['characters', 'temp_hp', 'INTEGER NOT NULL DEFAULT 0'],
    ['characters', 'active_effects_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['characters', 'updated_at', 'DATETIME'],
    ['items', 'created_at', 'DATETIME'],
    ['items', 'updated_at', 'DATETIME'],
    ['races', 'created_at', 'DATETIME'],
    ['races', 'updated_at', 'DATETIME'],
    ['classes', 'created_at', 'DATETIME'],
    ['classes', 'updated_at', 'DATETIME'],
    ['subclasses', 'created_at', 'DATETIME'],
    ['subclasses', 'updated_at', 'DATETIME'],
    ['spells', 'created_at', 'DATETIME'],
    ['spells', 'updated_at', 'DATETIME'],
    ['spellcasting_progression', 'created_at', 'DATETIME'],
    ['spellcasting_progression', 'updated_at', 'DATETIME'],
  ]);

  await createLanEffectCatalog(db);
  await ensureEffectSchema(db);
  await addColumnsIfMissing(db, [
    ['lan_effect_catalog', 'status_key', 'TEXT'],
    ['lan_effect_catalog', 'color', 'TEXT'],
    ['lan_effect_catalog', 'secondary_color', 'TEXT'],
    ['lan_effect_catalog', 'icon', 'TEXT'],
    ['lan_effect_catalog', 'stackable', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'removable_by_save', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'repeat_save', 'TEXT'],
    ['lan_effect_catalog', 'save_ability', 'TEXT'],
    ['lan_effect_catalog', 'save_on_success', 'TEXT'],
    ['lan_effect_catalog', 'visual_priority', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_effect_catalog', 'rules_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['lan_effect_catalog', 'created_at', 'DATETIME'],
    ['lan_effect_catalog', 'updated_at', 'DATETIME'],
  ]);

  await addColumnsIfMissing(db, [
    ['lan_sessions', 'transport_mode', "TEXT NOT NULL DEFAULT 'tcp'"],
    ['lan_sessions', 'host_ip', 'TEXT'],
    ['lan_sessions', 'host_port', 'INTEGER'],
    ['lan_sessions', 'protocol_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_sessions', 'current_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_sessions', 'is_master', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_session_players', 'character_name', 'TEXT'],
    ['lan_session_players', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_session_players', 'is_connected', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'last_ack_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'revision_seq', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_session_players', 'kicked_at', 'DATETIME'],
    ['lan_session_events', 'seq', 'INTEGER'],
    ['lan_session_events', 'from_key', 'TEXT'],
    ['lan_session_events', 'to_key', 'TEXT'],
    ['lan_session_events', 'client_msg_id', 'TEXT'],
    ['lan_session_events', 'processed', 'INTEGER NOT NULL DEFAULT 0'],
  ]);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_session_pending_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      player_key TEXT NOT NULL,
      player_name TEXT,
      kind TEXT NOT NULL,
      amount INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES lan_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lan_session_trades (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      offer_json TEXT NOT NULL DEFAULT '{}',
      request_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES lan_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lan_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      player_key TEXT NOT NULL,
      player_id INTEGER,
      catalog_item_id INTEGER,
      inventory_item_id TEXT,
      stack_key TEXT NOT NULL,
      name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      equipped_slot TEXT,
      item_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_inventory_movements (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source_event_id TEXT,
      trade_id TEXT,
      from_key TEXT,
      to_key TEXT,
      item_stack_key TEXT,
      item_name TEXT,
      qty INTEGER NOT NULL DEFAULT 1,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS character_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      catalog_item_id INTEGER,
      inventory_item_id TEXT,
      stack_key TEXT NOT NULL,
      name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      equipped_slot TEXT,
      item_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS character_inventory_movements (
      id TEXT PRIMARY KEY,
      character_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      source_event_id TEXT,
      trade_id TEXT,
      from_key TEXT,
      to_key TEXT,
      item_stack_key TEXT,
      item_name TEXT,
      qty INTEGER NOT NULL DEFAULT 1,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await backfillTimestamps(db);
  await createV2Indexes(db);
  await seedImprovedLanEffectCatalog(db);
  await seedCoreEffectJsonExamples(db);
}

async function createLanEffectCatalog(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_effect_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      status_key TEXT UNIQUE,
      target TEXT NOT NULL DEFAULT 'custom',
      value INTEGER NOT NULL DEFAULT 0,
      duration_value INTEGER NOT NULL DEFAULT 1,
      duration_unit TEXT NOT NULL DEFAULT 'turn',
      kind TEXT NOT NULL DEFAULT 'status',
      description TEXT,
      source TEXT NOT NULL DEFAULT 'base',
      color TEXT,
      secondary_color TEXT,
      icon TEXT,
      visual_priority INTEGER NOT NULL DEFAULT 0,
      stackable INTEGER NOT NULL DEFAULT 0,
      removable_by_save INTEGER NOT NULL DEFAULT 0,
      repeat_save TEXT,
      save_ability TEXT,
      save_on_success TEXT,
      rules_json TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function backfillTimestamps(db: SQLiteDatabase) {
  const timestampTables = [
    'items',
    'races',
    'classes',
    'subclasses',
    'spells',
    'spellcasting_progression',
    'lan_effect_catalog',
  ];

  for (const table of timestampTables) {
    try {
      await db.execAsync(`
        UPDATE ${table}
        SET
          created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
      `);
    } catch {
      // Some installations may not have every optional table yet.
    }
  }

  try {
    await db.execAsync(`UPDATE characters SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);`);
  } catch {
    // Older databases are migrated progressively.
  }
}

async function createV2Indexes(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE INDEX IF NOT EXISTS idx_spells_name ON spells(name);
    CREATE INDEX IF NOT EXISTS idx_spells_category ON spells(category);
    CREATE INDEX IF NOT EXISTS idx_spells_classes ON spells(classes);
    CREATE INDEX IF NOT EXISTS idx_lan_effect_status_key ON lan_effect_catalog(status_key);
    CREATE INDEX IF NOT EXISTS idx_lan_players_session ON lan_session_players(session_id);
    CREATE INDEX IF NOT EXISTS idx_lan_players_remote_key ON lan_session_players(session_id, remote_key);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_seq ON lan_session_events(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_lan_events_session_created ON lan_session_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lan_requests_session_status ON lan_session_pending_requests(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_lan_trades_session_status ON lan_session_trades(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_lan_inventory_items_owner ON lan_inventory_items(session_id, player_key);
    CREATE INDEX IF NOT EXISTS idx_lan_inventory_items_stack ON lan_inventory_items(session_id, player_key, stack_key);
    CREATE INDEX IF NOT EXISTS idx_lan_inventory_movements_session ON lan_inventory_movements(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_character_inventory_items_owner ON character_inventory_items(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_inventory_items_stack ON character_inventory_items(character_id, stack_key);
    CREATE INDEX IF NOT EXISTS idx_character_inventory_items_slot ON character_inventory_items(character_id, equipped_slot);
    CREATE INDEX IF NOT EXISTS idx_character_inventory_movements_character ON character_inventory_movements(character_id, created_at);
  `);
}

export async function seedImprovedLanEffectCatalog(db: SQLiteDatabase) {
  const seeds: LanEffectCatalogSeed[] = [
    {
      name: 'Cego',
      statusKey: 'blinded',
      description: 'Não pode ver; ataques contra o alvo têm vantagem e ataques do alvo têm desvantagem.',
      color: '#111827',
      secondaryColor: '#F9FAFB',
      icon: 'eye-off',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 90,
      rulesJson: '{"attackPenalty":"disadvantage","incomingAttack":"advantage"}',
    },
    {
      name: 'Surdo',
      statusKey: 'deafened',
      description: 'Não pode ouvir e falha automaticamente em testes que dependem de audição.',
      color: '#6B7280',
      secondaryColor: '#D1D5DB',
      icon: 'volume-x',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 40,
    },
    {
      name: 'Envenenado',
      statusKey: 'poisoned',
      durationUnit: 'hour',
      description: 'Desvantagem em jogadas de ataque e testes de habilidade.',
      color: '#22C55E',
      secondaryColor: '#14532D',
      icon: 'skull',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 80,
      rulesJson: '{"attackPenalty":"disadvantage","abilityCheckPenalty":"disadvantage"}',
    },
    {
      name: 'Queimando',
      statusKey: 'burning',
      description: 'Sofre dano de fogo recorrente até apagar ou terminar a duração.',
      color: '#EF4444',
      secondaryColor: '#F97316',
      icon: 'flame',
      stackable: 1,
      repeatSave: 'manual',
      saveAbility: 'DES',
      saveOnSuccess: 'special',
      visualPriority: 85,
      rulesJson: '{"tickDamage":"1d4","tickTiming":"start_of_turn","removeWith":"action_or_water"}',
    },
    {
      name: 'Congelado',
      statusKey: 'frozen',
      description: 'Movimento reduzido ou impedido por gelo.',
      color: '#BAE6FD',
      secondaryColor: '#38BDF8',
      icon: 'snowflake',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 75,
      rulesJson: '{"movement":"reduced","speedMultiplier":0.5}',
    },
    {
      name: 'Molhado',
      statusKey: 'wet',
      durationUnit: 'minute',
      description: 'Pode interagir com frio e eletricidade.',
      color: '#2563EB',
      secondaryColor: '#60A5FA',
      icon: 'water',
      repeatSave: 'none',
      visualPriority: 30,
      rulesJson: '{"tags":["water"],"fireModifier":"resist","lightningModifier":"vulnerable","coldModifier":"vulnerable"}',
    },
    {
      name: 'Paralisado',
      statusKey: 'paralyzed',
      description: 'Incapacitado, não pode se mover ou falar; ataques próximos são críticos se acertarem.',
      color: '#F97316',
      secondaryColor: '#FDBA74',
      icon: 'pause-circle',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 100,
      rulesJson: '{"incapacitated":true,"autoFailSaves":["FOR","DES"],"meleeCritOnHit":true}',
    },
    {
      name: 'Atordoado',
      statusKey: 'stunned',
      description: 'Incapacitado, não pode se mover e fala de forma vacilante.',
      color: '#A855F7',
      secondaryColor: '#E9D5FF',
      icon: 'zap-off',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 95,
      rulesJson: '{"incapacitated":true,"autoFailSaves":["FOR","DES"]}',
    },
    {
      name: 'Amedrontado',
      statusKey: 'frightened',
      durationUnit: 'minute',
      description: 'Desvantagem em testes e ataques enquanto a fonte do medo estiver à vista.',
      color: '#7C2D12',
      secondaryColor: '#FACC15',
      icon: 'alert-triangle',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 70,
      rulesJson: '{"attackPenalty":"conditional_disadvantage","abilityCheckPenalty":"conditional_disadvantage"}',
    },
    {
      name: 'Encantado',
      statusKey: 'charmed',
      durationUnit: 'hour',
      description: 'Não pode atacar o encantador e o encantador tem vantagem em interações sociais.',
      color: '#EC4899',
      secondaryColor: '#FBCFE8',
      icon: 'heart',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 60,
    },
    {
      name: 'Invisível',
      statusKey: 'invisible',
      durationUnit: 'hour',
      description: 'Não pode ser visto normalmente; ataques contra o alvo têm desvantagem.',
      color: '#64748B',
      secondaryColor: '#CBD5E1',
      icon: 'eye-off',
      repeatSave: 'none',
      visualPriority: 65,
      rulesJson: '{"outgoingAttack":"advantage","incomingAttack":"disadvantage"}',
    },
    {
      name: 'Contido',
      statusKey: 'restrained',
      durationUnit: 'minute',
      description: 'Deslocamento 0; ataques contra o alvo têm vantagem e ataques do alvo têm desvantagem.',
      color: '#92400E',
      secondaryColor: '#FCD34D',
      icon: 'link',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'FOR',
      saveOnSuccess: 'negates',
      visualPriority: 88,
      rulesJson: '{"speed":0,"attackPenalty":"disadvantage","incomingAttack":"advantage"}',
    },
    {
      name: 'Caído',
      statusKey: 'prone',
      description: 'No chão; ataques corpo a corpo contra o alvo têm vantagem.',
      color: '#78716C',
      secondaryColor: '#D6D3D1',
      icon: 'arrow-down',
      repeatSave: 'none',
      visualPriority: 35,
      rulesJson: '{"meleeIncomingAttack":"advantage","rangedIncomingAttack":"disadvantage"}',
    },
    {
      name: 'Amaldiçoado',
      statusKey: 'cursed',
      durationUnit: 'hour',
      description: 'Maldição genérica controlada pela mesa.',
      color: '#581C87',
      secondaryColor: '#C084FC',
      icon: 'sparkles',
      stackable: 1,
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 78,
      rulesJson: '{"tag":"curse"}',
    },
    {
      name: 'Abençoado',
      statusKey: 'blessed',
      durationUnit: 'minute',
      description: 'Soma 1d4 em ataques e testes de resistência.',
      color: '#FACC15',
      secondaryColor: '#FEF3C7',
      icon: 'star',
      repeatSave: 'none',
      visualPriority: 55,
      rulesJson: '{"attackBonusDice":"1d4","saveBonusDice":"1d4"}',
    },
    {
      name: 'Bruxaria',
      statusKey: 'hexed',
      durationUnit: 'hour',
      description: 'Sofre dano extra do conjurador e penalidade no atributo escolhido.',
      color: '#4C1D95',
      secondaryColor: '#A78BFA',
      icon: 'moon',
      stackable: 1,
      repeatSave: 'none',
      visualPriority: 75,
      rulesJson: '{"extraDamage":"1d6","extraDamageType":"Necrótico","chooseAbilityPenalty":true}',
    },
    {
      name: 'Lento',
      statusKey: 'slowed',
      durationUnit: 'minute',
      description: 'Deslocamento reduzido e ações limitadas conforme regra da mesa.',
      color: '#0F766E',
      secondaryColor: '#5EEAD4',
      icon: 'hourglass',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 72,
      rulesJson: '{"speedMultiplier":0.5}',
    },
    {
      name: 'Acelerado',
      statusKey: 'hasted',
      durationUnit: 'minute',
      description: 'Deslocamento dobrado, +2 CA e ação extra limitada.',
      color: '#F59E0B',
      secondaryColor: '#FDE68A',
      icon: 'fast-forward',
      repeatSave: 'none',
      visualPriority: 68,
      rulesJson: '{"speedMultiplier":2,"acBonus":2,"extraAction":true}',
    },
    {
      name: 'Silenciado',
      statusKey: 'silenced',
      durationUnit: 'minute',
      description: 'Não pode conjurar magias com componente verbal.',
      color: '#334155',
      secondaryColor: '#94A3B8',
      icon: 'mic-off',
      repeatSave: 'none',
      visualPriority: 62,
      rulesJson: '{"blocksComponents":["V"]}',
    },
    {
      name: 'Dormindo',
      statusKey: 'sleeping',
      durationUnit: 'minute',
      description: 'Inconsciente até acordar, sofrer dano ou ser sacudido.',
      color: '#312E81',
      secondaryColor: '#A5B4FC',
      icon: 'moon',
      repeatSave: 'on_damage',
      visualPriority: 82,
      rulesJson: '{"unconscious":true,"wakeOnDamage":true}',
    },
    {
      name: 'Confuso',
      statusKey: 'confused',
      durationUnit: 'minute',
      description: 'Age de forma imprevisivel conforme decisao do mestre.',
      color: '#06B6D4',
      secondaryColor: '#A5F3FC',
      icon: 'shuffle',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'SAB',
      saveOnSuccess: 'negates',
      visualPriority: 64,
      rulesJson: '{"control":"master_table"}',
    },
    {
      name: 'Fraqueza',
      statusKey: 'weakness',
      durationUnit: 'hour',
      description: 'Penalidade fisica temporaria definida pela mesa.',
      color: '#A16207',
      secondaryColor: '#FEF08A',
      icon: 'battery-low',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'negates',
      visualPriority: 50,
      rulesJson: '{"suggestedPenalty":"FOR or damage reduction"}',
    },
    {
      name: 'Embriaguez',
      statusKey: 'drunk',
      durationUnit: 'hour',
      description: 'Coordenacao e julgamento prejudicados.',
      color: '#BE123C',
      secondaryColor: '#FDA4AF',
      icon: 'wine',
      repeatSave: 'none',
      visualPriority: 38,
      rulesJson: '{"suggestedPenalty":"DES checks disadvantage"}',
    },
    {
      name: 'Sangramento',
      statusKey: 'bleeding',
      durationUnit: 'turn',
      description: 'Perde sangue e pode sofrer dano recorrente.',
      color: '#DC2626',
      secondaryColor: '#7F1D1D',
      icon: 'droplet',
      stackable: 1,
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'remove',
      visualPriority: 86,
      rulesJson: '{"tickDamage":"1d4","tickTiming":"end_of_turn"}',
    },
    {
      name: 'Dor de Cabeca',
      statusKey: 'dor_de_cabeca',
      durationUnit: 'hour',
      description: 'O personagem esta com forte dor de cabeca.',
      color: '#8E44AD',
      secondaryColor: '#D2B4DE',
      icon: 'brain',
      repeatSave: 'none',
      visualPriority: 40,
      rulesJson: '{"mechanicalNote":"Pode impor desvantagem em concentracao, se o mestre desejar."}',
    },
    {
      name: 'Forca do Gigante da Colina',
      statusKey: 'hill_giant_strength',
      target: 'FOR',
      value: 21,
      durationValue: 1,
      durationUnit: 'long_rest',
      kind: 'buff',
      description: 'Forca definida como 21 ate o proximo descanso longo.',
      color: '#B45309',
      secondaryColor: '#FDE68A',
      icon: 'dumbbell',
      repeatSave: 'none',
      visualPriority: 66,
      rulesJson: '{"mode":"set","stat":"FOR","value":21}',
    },
    {
      name: 'Forca do Gigante de Pedra',
      statusKey: 'stone_giant_strength',
      target: 'FOR',
      value: 23,
      durationValue: 1,
      durationUnit: 'long_rest',
      kind: 'buff',
      description: 'Forca definida como 23 ate o proximo descanso longo.',
      color: '#78716C',
      secondaryColor: '#D6D3D1',
      icon: 'mountain',
      repeatSave: 'none',
      visualPriority: 67,
      rulesJson: '{"mode":"set","stat":"FOR","value":23}',
    },
    {
      name: 'Forca do Gigante de Fogo',
      statusKey: 'fire_giant_strength',
      target: 'FOR',
      value: 25,
      durationValue: 1,
      durationUnit: 'long_rest',
      kind: 'buff',
      description: 'Forca definida como 25 ate o proximo descanso longo.',
      color: '#DC2626',
      secondaryColor: '#FDBA74',
      icon: 'flame',
      repeatSave: 'none',
      visualPriority: 69,
      rulesJson: '{"mode":"set","stat":"FOR","value":25}',
    },
    {
      name: 'Forca do Gigante das Nuvens',
      statusKey: 'cloud_giant_strength',
      target: 'FOR',
      value: 27,
      durationValue: 1,
      durationUnit: 'long_rest',
      kind: 'buff',
      description: 'Forca definida como 27 ate o proximo descanso longo.',
      color: '#38BDF8',
      secondaryColor: '#E0F2FE',
      icon: 'cloud',
      repeatSave: 'none',
      visualPriority: 70,
      rulesJson: '{"mode":"set","stat":"FOR","value":27}',
    },
    {
      name: 'Forca do Gigante da Tempestade',
      statusKey: 'storm_giant_strength',
      target: 'FOR',
      value: 29,
      durationValue: 1,
      durationUnit: 'long_rest',
      kind: 'buff',
      description: 'Forca definida como 29 ate o proximo descanso longo.',
      color: '#7C3AED',
      secondaryColor: '#C4B5FD',
      icon: 'bolt',
      repeatSave: 'none',
      visualPriority: 72,
      rulesJson: '{"mode":"set","stat":"FOR","value":29}',
    },
    {
      name: 'Heroismo',
      statusKey: 'heroism',
      target: 'PV_TEMP',
      value: 5,
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Imune a amedrontado e recebe PV temporarios recorrentes conforme a mesa.',
      color: '#F59E0B',
      secondaryColor: '#FEF3C7',
      icon: 'shield',
      repeatSave: 'none',
      visualPriority: 61,
      rulesJson: '{"fearImmune":true,"tempHpRefresh":"caster_ability"}',
    },
    {
      name: 'Armadura Arcana',
      statusKey: 'mage_armor',
      target: 'CA',
      value: 0,
      durationValue: 8,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'CA base 13 + DES enquanto a criatura nao usar armadura.',
      color: '#0EA5E9',
      secondaryColor: '#BAE6FD',
      icon: 'shield',
      repeatSave: 'none',
      visualPriority: 58,
      rulesJson: '{"armorFormula":"13+DES","requiresNoArmor":true}',
    },
    {
      name: 'Escudo Arcano',
      statusKey: 'shield_spell',
      target: 'CA',
      value: 5,
      durationValue: 1,
      durationUnit: 'turn',
      kind: 'buff',
      description: '+5 CA ate o inicio do proximo turno.',
      color: '#2563EB',
      secondaryColor: '#BFDBFE',
      icon: 'shield',
      repeatSave: 'none',
      visualPriority: 76,
      rulesJson: '{"acBonus":5}',
    },
    {
      name: 'Resistencia ao Fogo',
      statusKey: 'fire_resistance',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Resistencia contra dano de fogo.',
      color: '#EA580C',
      secondaryColor: '#FED7AA',
      icon: 'flame',
      repeatSave: 'none',
      visualPriority: 54,
      rulesJson: '{"resistance":["Fogo"]}',
    },
    {
      name: 'Resistencia ao Frio',
      statusKey: 'cold_resistance',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Resistencia contra dano de frio.',
      color: '#0284C7',
      secondaryColor: '#BAE6FD',
      icon: 'snowflake',
      repeatSave: 'none',
      visualPriority: 54,
      rulesJson: '{"resistance":["Frio"]}',
    },
    {
      name: 'Resistencia a Veneno',
      statusKey: 'poison_resistance',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Resistencia contra veneno e vantagem conforme a mesa.',
      color: '#16A34A',
      secondaryColor: '#BBF7D0',
      icon: 'skull',
      repeatSave: 'none',
      visualPriority: 54,
      rulesJson: '{"resistance":["Veneno"],"saveAdvantageAgainst":["Veneno","poisoned"]}',
    },
    {
      name: 'Auxilio',
      statusKey: 'aid',
      target: 'HP',
      value: 5,
      durationValue: 8,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Aumenta PV maximo e PV atual em 5.',
      color: '#22C55E',
      secondaryColor: '#BBF7D0',
      icon: 'heart-plus',
      repeatSave: 'none',
      visualPriority: 57,
      rulesJson: '{"hpMaxBonus":5,"hpCurrentBonus":5}',
    },
    {
      name: 'Fogo das Fadas',
      statusKey: 'faerie_fire',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'debuff',
      description: 'Alvo iluminado; ataques contra ele tem vantagem e invisibilidade e anulada.',
      color: '#D946EF',
      secondaryColor: '#F5D0FE',
      icon: 'sparkles',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'DES',
      saveOnSuccess: 'negates',
      visualPriority: 63,
      rulesJson: '{"incomingAttack":"advantage","revealsInvisible":true}',
    },
    {
      name: 'Marcado',
      statusKey: 'hunters_mark',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'debuff',
      description: 'O atacante marcado causa 1d6 extra no alvo.',
      color: '#65A30D',
      secondaryColor: '#D9F99D',
      icon: 'crosshair',
      repeatSave: 'none',
      visualPriority: 59,
      rulesJson: '{"extraDamage":"1d6","extraDamageType":"Extra","source":"caster_weapon_hit"}',
    },
    {
      name: 'Agarrado',
      statusKey: 'grappled',
      durationUnit: 'until_save',
      kind: 'condition',
      description: 'Deslocamento 0 ate escapar ou ser solto.',
      color: '#92400E',
      secondaryColor: '#FDBA74',
      icon: 'hand',
      removableBySave: 1,
      repeatSave: 'action',
      saveAbility: 'FOR',
      saveOnSuccess: 'remove',
      visualPriority: 74,
      rulesJson: '{"speed":0,"escapeCheck":["FOR","DES"]}',
    },
    {
      name: 'Incapacitado',
      statusKey: 'incapacitated',
      durationUnit: 'turn',
      kind: 'condition',
      description: 'Nao pode realizar acoes ou reacoes.',
      color: '#7F1D1D',
      secondaryColor: '#FCA5A5',
      icon: 'ban',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'remove',
      visualPriority: 94,
      rulesJson: '{"actions":false,"reactions":false}',
    },
    {
      name: 'Inconsciente',
      statusKey: 'unconscious',
      durationUnit: 'manual',
      kind: 'condition',
      description: 'Cai, fica incapacitado, falha em testes de FOR/DES e ataques proximos podem critar.',
      color: '#111827',
      secondaryColor: '#9CA3AF',
      icon: 'moon',
      repeatSave: 'manual',
      visualPriority: 98,
      rulesJson: '{"prone":true,"incapacitated":true,"autoFailSaves":["FOR","DES"],"meleeCritOnHit":true}',
    },
    {
      name: 'Petrificado',
      statusKey: 'petrified',
      durationUnit: 'manual',
      kind: 'condition',
      description: 'Transformado em pedra; fica incapacitado e resistente a dano conforme a mesa.',
      color: '#57534E',
      secondaryColor: '#D6D3D1',
      icon: 'gem',
      removableBySave: 1,
      repeatSave: 'end_of_turn',
      saveAbility: 'CON',
      saveOnSuccess: 'remove',
      visualPriority: 97,
      rulesJson: '{"incapacitated":true,"speed":0,"resistance":["all"],"autoFailSaves":["FOR","DES"]}',
    },
    {
      name: 'Exaustao',
      statusKey: 'exhaustion',
      durationUnit: 'manual',
      kind: 'debuff',
      description: 'Nivel de exaustao controlado pelo mestre.',
      color: '#A16207',
      secondaryColor: '#FEF08A',
      icon: 'battery-low',
      stackable: 1,
      repeatSave: 'none',
      visualPriority: 73,
      rulesJson: '{"stackableLevel":true,"mechanicalNote":"Use stack_count como nivel de exaustao."}',
    },
    {
      name: 'Concentrando',
      statusKey: 'concentrating',
      durationUnit: 'concentration',
      kind: 'status',
      description: 'Marca que a criatura esta mantendo concentracao.',
      color: '#0EA5E9',
      secondaryColor: '#BAE6FD',
      icon: 'focus',
      repeatSave: 'on_damage',
      saveAbility: 'CON',
      saveOnSuccess: 'special',
      visualPriority: 52,
      rulesJson: '{"concentration":true}',
    },
    {
      name: 'Escudo da Fe',
      statusKey: 'shield_of_faith',
      target: 'CA',
      value: 2,
      durationValue: 10,
      durationUnit: 'minute',
      kind: 'buff',
      description: '+2 CA enquanto durar.',
      color: '#FACC15',
      secondaryColor: '#FEF3C7',
      icon: 'shield',
      repeatSave: 'none',
      visualPriority: 64,
      rulesJson: '{"acBonus":2}',
    },
    {
      name: 'Santuario',
      statusKey: 'sanctuary',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Atacantes devem passar em teste de SAB antes de atingir o alvo.',
      color: '#FDE047',
      secondaryColor: '#FEF9C3',
      icon: 'shield-check',
      repeatSave: 'none',
      visualPriority: 62,
      rulesJson: '{"incomingAttackRequiresSave":"SAB"}',
    },
    {
      name: 'Pele de Arvore',
      statusKey: 'barkskin',
      target: 'CA',
      value: 16,
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'CA minima 16 enquanto durar.',
      color: '#15803D',
      secondaryColor: '#BBF7D0',
      icon: 'tree-pine',
      repeatSave: 'none',
      visualPriority: 56,
      rulesJson: '{"mode":"min","acMinimum":16}',
    },
    {
      name: 'Desfocado',
      statusKey: 'blurred',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Ataques contra o alvo tem desvantagem.',
      color: '#06B6D4',
      secondaryColor: '#A5F3FC',
      icon: 'waves',
      repeatSave: 'none',
      visualPriority: 61,
      rulesJson: '{"incomingAttack":"disadvantage"}',
    },
    {
      name: 'Passos Sem Rastros',
      statusKey: 'pass_without_trace',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: '+10 em Furtividade para o grupo enquanto permanecer na aura.',
      color: '#14532D',
      secondaryColor: '#86EFAC',
      icon: 'footprints',
      repeatSave: 'none',
      visualPriority: 50,
      rulesJson: '{"skillBonus":{"Furtividade":10}}',
    },
    {
      name: 'Protecao Contra Mal e Bem',
      statusKey: 'protection_from_evil_good',
      durationValue: 10,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Protecao contra certos tipos de criatura conforme a mesa.',
      color: '#E0E7FF',
      secondaryColor: '#818CF8',
      icon: 'shield-alert',
      repeatSave: 'none',
      visualPriority: 58,
      rulesJson: '{"incomingAttackDisadvantageFrom":["celestial","elemental","fey","fiend","undead"],"charmedFrightenedPossessedProtection":true}',
    },
    {
      name: 'Aumentado',
      statusKey: 'enlarged',
      target: 'FOR',
      value: 0,
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Tamanho aumenta; vantagem em FOR e +1d4 dano de arma.',
      color: '#B45309',
      secondaryColor: '#FED7AA',
      icon: 'maximize',
      repeatSave: 'none',
      visualPriority: 60,
      rulesJson: '{"size":"larger","strengthChecks":"advantage","weaponDamageBonus":"1d4"}',
    },
    {
      name: 'Reduzido',
      statusKey: 'reduced',
      target: 'FOR',
      value: 0,
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'debuff',
      description: 'Tamanho diminui; desvantagem em FOR e -1d4 dano de arma.',
      color: '#7C3AED',
      secondaryColor: '#DDD6FE',
      icon: 'minimize',
      repeatSave: 'none',
      visualPriority: 60,
      rulesJson: '{"size":"smaller","strengthChecks":"disadvantage","weaponDamagePenalty":"1d4"}',
    },
    {
      name: 'Arma Abençoada',
      statusKey: 'blessed_weapon',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Arma causa dano radiante extra conforme a mesa.',
      color: '#FACC15',
      secondaryColor: '#FEF3C7',
      icon: 'sword',
      repeatSave: 'none',
      visualPriority: 57,
      rulesJson: '{"weaponDamageBonus":"1d4","damageType":"Radiante"}',
    },
    {
      name: 'Vulneravel a Fogo',
      statusKey: 'fire_vulnerability',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'debuff',
      description: 'Recebe vulnerabilidade a dano de fogo.',
      color: '#B91C1C',
      secondaryColor: '#FCA5A5',
      icon: 'flame',
      repeatSave: 'none',
      visualPriority: 55,
      rulesJson: '{"vulnerability":["Fogo"]}',
    },
    {
      name: 'Vulneravel a Frio',
      statusKey: 'cold_vulnerability',
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'debuff',
      description: 'Recebe vulnerabilidade a dano de frio.',
      color: '#0369A1',
      secondaryColor: '#BAE6FD',
      icon: 'snowflake',
      repeatSave: 'none',
      visualPriority: 55,
      rulesJson: '{"vulnerability":["Frio"]}',
    },
    {
      name: 'Resistencia a Eletrico',
      statusKey: 'lightning_resistance',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Resistencia contra dano eletrico.',
      color: '#FDE047',
      secondaryColor: '#FEF9C3',
      icon: 'zap',
      repeatSave: 'none',
      visualPriority: 54,
      rulesJson: '{"resistance":["Eletrico"]}',
    },
    {
      name: 'Resistencia a Necrotico',
      statusKey: 'necrotic_resistance',
      durationValue: 1,
      durationUnit: 'hour',
      kind: 'buff',
      description: 'Resistencia contra dano necrotico.',
      color: '#581C87',
      secondaryColor: '#D8B4FE',
      icon: 'skull',
      repeatSave: 'none',
      visualPriority: 54,
      rulesJson: '{"resistance":["Necrotico"]}',
    },
    {
      name: 'Regeneracao',
      statusKey: 'regeneration',
      target: 'HP',
      value: 5,
      durationValue: 1,
      durationUnit: 'minute',
      kind: 'buff',
      description: 'Recupera PV recorrente conforme a mesa.',
      color: '#16A34A',
      secondaryColor: '#BBF7D0',
      icon: 'heart-pulse',
      repeatSave: 'none',
      visualPriority: 60,
      rulesJson: '{"tickHeal":5,"tickTiming":"start_of_turn"}',
    },
  ];

  for (const seed of seeds) {
    await upsertLanEffectCatalogSeed(db, seed);
  }
}

async function upsertLanEffectCatalogSeed(db: SQLiteDatabase, seed: LanEffectCatalogSeed) {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM lan_effect_catalog WHERE name = ? OR status_key = ? LIMIT 1`,
    [seed.name, seed.statusKey],
  );
  const values = [
    seed.name,
    seed.statusKey,
    seed.target || 'custom',
    seed.value ?? 0,
    seed.durationValue ?? 1,
    seed.durationUnit || 'turn',
    seed.kind || 'status',
    seed.description,
    seed.source || 'base',
    seed.color,
    seed.secondaryColor,
    seed.icon,
    seed.stackable ?? 0,
    seed.removableBySave ?? 0,
    seed.repeatSave ?? null,
    seed.saveAbility ?? null,
    seed.saveOnSuccess ?? null,
    seed.visualPriority ?? 0,
    seed.rulesJson || '{}',
  ];

  if (existing) {
    await db.runAsync(
      `UPDATE lan_effect_catalog
       SET name = ?, status_key = ?, target = ?, value = ?, duration_value = ?,
           duration_unit = ?, kind = ?, description = ?, source = ?, color = ?,
           secondary_color = ?, icon = ?, stackable = ?, removable_by_save = ?,
           repeat_save = ?, save_ability = ?, save_on_success = ?,
           visual_priority = ?, rules_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...values, existing.id],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO lan_effect_catalog (
      name, status_key, target, value, duration_value, duration_unit, kind,
      description, source, color, secondary_color, icon, stackable,
      removable_by_save, repeat_save, save_ability, save_on_success,
      visual_priority, rules_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  );
}

export async function seedCoreEffectJsonExamples(db: SQLiteDatabase) {
  const spellUpdates: [name: string, effectJson: string][] = [
    [
      'Curar Ferimentos',
      '[{"type":"heal","healDice":"1d8","target":{"mode":"creature","count":1},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d8"}}}]',
    ],
    [
      'Palavra Curativa',
      '[{"type":"heal","healDice":"1d4","target":{"mode":"ally","count":1},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d4"}}}]',
    ],
    [
      'Chama Sagrada',
      '[{"type":"damage","damageDice":"1d8","damageType":"Radiante","target":{"mode":"creature","count":1},"save":{"ability":"DES","onSuccess":"none","dcSource":"caster"},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d8","5":"2d8","11":"3d8","17":"4d8"}}}]',
    ],
    [
      'Bola de Fogo',
      '[{"type":"damage","damageDice":"8d6","damageType":"Fogo","target":{"mode":"area","count":"unlimited","area":{"shape":"sphere","radius":"6m"}},"save":{"ability":"DES","onSuccess":"half","dcSource":"caster"},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d6"}}}]',
    ],
    [
      'Raio Adoecedor',
      '[{"type":"damage","damageDice":"2d8","damageType":"Veneno","target":{"mode":"creature","count":1},"save":{"ability":"CON","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"poisoned","name":"Envenenado","applyOn":"failed_save","duration":{"value":1,"unit":"turn","untilSave":true,"repeatSave":"end_of_turn"}}}]',
    ],
    [
      'Cegueira/Surdez',
      '[{"type":"condition","target":{"mode":"creature","count":1,"countScaling":{"perSpellSlotAbove":1}},"save":{"ability":"CON","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"blinded","name":"Cego","applyOn":"failed_save","chooseOne":["blinded","deafened"],"duration":{"value":1,"unit":"minute","untilSave":true,"repeatSave":"end_of_turn"}}}]',
    ],
    [
      'Imobilizar Pessoa',
      '[{"type":"condition","target":{"mode":"creature","count":1,"countScaling":{"perSpellSlotAbove":1}},"save":{"ability":"SAB","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"paralyzed","name":"Paralisado","applyOn":"failed_save","duration":{"value":1,"unit":"minute","untilSave":true,"repeatSave":"end_of_turn"}}}]',
    ],
    [
      'Bênção',
      '[{"type":"buff","target":{"mode":"ally","count":3,"countScaling":{"perSpellSlotAbove":1}},"condition":{"key":"blessed","name":"Abençoado","applyOn":"always","duration":{"value":1,"unit":"minute","untilSave":false,"repeatSave":"none"}},"bonus":{"attackDice":"1d4","saveDice":"1d4"}}]',
    ],
    [
      'Bruxaria',
      '[{"type":"debuff","target":{"mode":"creature","count":1},"condition":{"key":"hexed","name":"Bruxaria","applyOn":"always","duration":{"value":1,"unit":"hour","untilSave":false,"repeatSave":"none"}},"extraDamage":{"dice":"1d6","type":"Necrótico","source":"caster_hit"},"chooseAbilityPenalty":true}]',
    ],
    [
      'Sono',
      '[{"type":"condition_pool","poolDice":"5d8","target":{"mode":"area","count":"by_hp_pool","area":{"shape":"sphere","radius":"6m"}},"condition":{"key":"sleeping","name":"Dormindo","applyOn":"hp_pool","duration":{"value":1,"unit":"minute","untilSave":false,"repeatSave":"on_damage"}},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+2d8"}}}]',
    ],
    [
      'Passo Nebuloso',
      '[{"type":"movement","movement":"teleport","distance":"9m","target":{"mode":"self","count":1}}]',
    ],
    [
      'Ataque Furtivo',
      '[{"type":"extra","damageDice":"1d6","damageType":"Extra","target":{"mode":"weapon","count":1},"trigger":"hit_with_advantage_or_adjacent_ally","scaling":{"mode":"class_level","class":"Ladino","diceByClassLevel":{"1":"1d6","3":"2d6","5":"3d6","7":"4d6","9":"5d6","11":"6d6","13":"7d6","15":"8d6","17":"9d6","19":"10d6"}}}]',
    ],
  ];

  for (const [name, effectJson] of spellUpdates) {
    await updateEmptyEffectJson(db, 'spells', name, effectJson);
  }

  const itemUpdates: [name: string, effectJson: string][] = [
    [
      'Poção de Cura',
      '[{"type":"heal","healDice":"2d4+2","target":{"mode":"self","count":1},"consumeOnUse":true}]',
    ],
    [
      'Poção de Força do Gigante da Colina',
      '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":21,"targeting":{"mode":"self","count":1},"condition":{"key":"hill_giant_strength","name":"Força do Gigante da Colina","applyOn":"always","duration":{"value":1,"unit":"hour","untilSave":false,"repeatSave":"none"},"color":"#f4a261"},"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]',
    ],
    [
      'Poção de Força do Gigante de Pedra',
      '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":23,"targeting":{"mode":"self","count":1},"condition":{"key":"stone_giant_strength","name":"Força do Gigante de Pedra","applyOn":"always","duration":{"value":1,"unit":"hour","untilSave":false,"repeatSave":"none"}},"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]',
    ],
    [
      'Poção de Velocidade',
      '[{"type":"buff","kind":"condition","target":"self","condition":{"key":"haste","name":"Acelerado","applyOn":"always","duration":{"value":1,"unit":"minute","untilSave":false,"repeatSave":"none"}},"bonus":{"ca":2,"speedMultiplier":2,"dexSaveAdvantage":true,"extraAction":1},"durationText":"1 Minuto","durationValue":1,"durationUnit":"minute","consumeOnUse":true}]',
    ],
    [
      'Poção de Invisibilidade',
      '[{"type":"condition","kind":"condition","target":"self","condition":{"key":"invisible","name":"Invisível","applyOn":"always","duration":{"value":1,"unit":"hour","untilSave":false,"repeatSave":"none"}},"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]',
    ],
    [
      'Elixir de Resistência ao Fogo',
      '[{"type":"resistance","kind":"buff","target":"self","condition":{"key":"fire_resistance","name":"Resistência ao Fogo","applyOn":"always","duration":{"value":1,"unit":"hour","untilSave":false,"repeatSave":"none"}},"resistance":["Fogo"],"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]',
    ],
    [
      'Antitoxina',
      '[{"type":"buff","target":{"mode":"self","count":1},"condition":{"key":"antitoxin","name":"Antitoxina","applyOn":"always","duration":{"value":1,"unit":"hour"}},"bonus":{"saveAdvantageAgainst":["poisoned","Veneno"]},"consumeOnUse":true}]',
    ],
    [
      'Veneno Básico (Frasco)',
      '[{"type":"weapon_coating","target":{"mode":"weapon","count":1},"duration":{"value":1,"unit":"minute"},"onHit":{"damageDice":"1d4","damageType":"Veneno","save":{"ability":"CON","onSuccess":"none","dc":10}},"consumeOnUse":true}]',
    ],
    [
      'Ácido (Frasco)',
      '[{"type":"damage","damageDice":"2d6","damageType":"Ácido","target":{"mode":"creature","count":1},"consumeOnUse":true}]',
    ],
  ];

  const coreItemSeeds: Array<[string, number, string, string, string, string, string, number | null, string | null]> = [
    [
      'Poção de Força do Gigante da Colina',
      0.25,
      'FOR 21 (1 Hora)',
      '-',
      'Consumível, Mágico, Poção',
      'Ao beber, sua Força se torna 21 por 1 hora.',
      '[]',
      1,
      'hour',
    ],
    [
      'Poção de Força do Gigante de Pedra',
      0.25,
      'FOR 23 (1 Hora)',
      '-',
      'Consumível, Mágico, Poção',
      'Ao beber, sua Força se torna 23 por 1 hora.',
      '[]',
      1,
      'hour',
    ],
    [
      'Poção de Velocidade',
      0.25,
      'Acelerado (1 Minuto)',
      '-',
      'Consumível, Mágico, Poção',
      'Concede aceleração temporária: mais mobilidade, defesa e uma ação extra simples enquanto durar.',
      '[]',
      1,
      'minute',
    ],
    [
      'Poção de Invisibilidade',
      0.25,
      'Invisível (1 Hora)',
      '-',
      'Consumível, Mágico, Poção',
      'Torna o usuário invisível até o efeito terminar ou até o mestre encerrar a condição.',
      '[]',
      1,
      'hour',
    ],
    [
      'Elixir de Resistência ao Fogo',
      0.25,
      'Resistência Fogo (1 Hora)',
      '-',
      'Consumível, Mágico, Elixir',
      'Concede resistência a dano de fogo por 1 hora.',
      '[]',
      1,
      'hour',
    ],
  ];

  for (const item of coreItemSeeds) {
    await db.runAsync(
      `INSERT OR IGNORE INTO items (name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      item,
    );
  }

  const coreActionSeeds: Array<[string, string, string, string, string, string, string, string, string, string | null, string | null, string, string, number]> = [
    ['Míssil Mágico', '1', 'Magia', '["Mago","Feiticeiro"]', '1 ação', '36m', 'V,S', 'Instantânea', '3x(1d4+1)', 'Energia', null, 'Cria projéteis arcanos que atingem automaticamente alvos escolhidos.', '[{"type":"damage_multi","damageDice":"1d4+1","damageType":"Energia","missiles":3,"target":{"mode":"creature","count":3},"scaling":{"mode":"spell_slot","extraMissilesPerSlotAbove":1}}]', 1],
    ['Escudo Arcano', '1', 'Magia', '["Mago","Feiticeiro"]', '1 reação', 'Pessoal', 'V,S', 'Até o início do próximo turno', '-', null, null, 'Barreira defensiva emergencial.', '[{"type":"buff","target":{"mode":"self","count":1},"condition":{"key":"shield_spell","name":"Escudo Arcano","duration":{"value":1,"unit":"turn"}},"bonus":{"ca":5}}]', 1],
    ['Armadura Arcana', '1', 'Magia', '["Mago","Feiticeiro"]', '1 ação', 'Toque', 'V,S,M', '8 horas', '-', null, null, 'Proteção mágica para criatura sem armadura.', '[{"type":"armor_formula","target":{"mode":"creature","count":1},"condition":{"key":"mage_armor","name":"Armadura Arcana","duration":{"value":8,"unit":"hour"}},"formula":"13+DES"}]', 1],
    ['Orientação', '0', 'Magia', '["Clérigo","Druida"]', '1 ação', 'Toque', 'V,S', '1 minuto', '1d4', 'Bônus', null, 'Ajuda em um teste de habilidade.', '[{"type":"buff","target":{"mode":"creature","count":1},"condition":{"key":"guidance","name":"Orientação","duration":{"value":1,"unit":"minute"}},"bonus":{"abilityCheckDice":"1d4"}}]', 1],
    ['Fúria', '1', 'Habilidade', '["Bárbaro"]', 'Ação bônus', 'Pessoal', '-', '1 minuto', '-', null, null, 'Estado de combate do bárbaro.', '[{"type":"buff","target":{"mode":"self","count":1},"condition":{"key":"rage","name":"Fúria","duration":{"value":1,"unit":"minute"}},"bonus":{"strengthChecks":"advantage","meleeDamage":2},"resistance":["Cortante","Perfurante","Concussão"]}]', 1],
    ['Segundo Fôlego', '1', 'Habilidade', '["Guerreiro"]', 'Ação bônus', 'Pessoal', '-', 'Instantânea', '1d10 + nível', 'Cura', null, 'Recuperação rápida do guerreiro.', '[{"type":"heal","healDice":"1d10","target":{"mode":"self","count":1},"bonus":{"addCharacterLevel":true}}]', 1],
    ['Surto de Ação', '2', 'Habilidade', '["Guerreiro"]', 'Livre', 'Pessoal', '-', 'Turno atual', '-', null, null, 'Permite uma ação adicional no turno.', '[{"type":"action_economy","target":{"mode":"self","count":1},"bonus":{"extraAction":1},"duration":{"value":1,"unit":"turn"}}]', 2],
  ];

  for (const spell of coreActionSeeds) {
    const existingSpell = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM spells WHERE name = ? LIMIT 1`,
      [spell[0]],
    );
    if (!existingSpell) {
      await db.runAsync(
        `INSERT INTO spells (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, effect_json, class_level_required, criador)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
        spell,
      );
    }
  }

  for (const [name, effectJson] of itemUpdates) {
    await updateEmptyEffectJson(db, 'items', name, effectJson);
  }

  await seedExpandedCatalogOptions(db);
}

async function updateEmptyEffectJson(
  db: SQLiteDatabase,
  table: 'items' | 'spells',
  name: string,
  effectJson: string,
) {
  await db.runAsync(
    `UPDATE ${table}
     SET effect_json = ?, updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
     WHERE name = ?
       AND (effect_json IS NULL OR effect_json = '' OR effect_json = '[]')`,
    [effectJson, name],
  );
}

type ExpandedItemSeed = [
  name: string,
  weight: number,
  damage: string,
  damageType: string,
  properties: string,
  descricao: string,
  effectJson: string,
  durationValue: number | null,
  durationUnit: string | null,
];

type ExpandedSpellSeed = [
  name: string,
  level: string,
  category: string,
  classes: string,
  castingTime: string,
  range: string,
  components: string,
  duration: string,
  damageDice: string,
  damageType: string | null,
  savingThrow: string | null,
  description: string,
  effectJson: string,
  classLevelRequired: number,
];

async function seedExpandedCatalogOptions(db: SQLiteDatabase) {
  const hillGiantStrengthLongRest = '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":21,"targeting":{"mode":"self","count":1},"durationText":"Ate descanso longo","durationValue":1,"durationUnit":"long_rest","consumeOnUse":true}]';

  const expandedItems: ExpandedItemSeed[] = [
    ['Pocao de Forca do Gigante da Colina', 0.25, 'FOR 21', '-', 'Consumivel, Magico, Pocao', 'Ao beber, sua Forca se torna 21 ate o proximo descanso longo.', hillGiantStrengthLongRest, 1, 'long_rest'],
    ['Pocao de Forca do Gigante de Pedra', 0.25, 'FOR 23', '-', 'Consumivel, Magico, Pocao', 'Ao beber, sua Forca se torna 23 ate o proximo descanso longo.', '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":23,"targeting":{"mode":"self","count":1},"durationText":"Ate descanso longo","durationValue":1,"durationUnit":"long_rest","consumeOnUse":true}]', 1, 'long_rest'],
    ['Pocao de Forca do Gigante de Fogo', 0.25, 'FOR 25', '-', 'Consumivel, Magico, Pocao', 'Ao beber, sua Forca se torna 25 ate o proximo descanso longo.', '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":25,"targeting":{"mode":"self","count":1},"durationText":"Ate descanso longo","durationValue":1,"durationUnit":"long_rest","consumeOnUse":true}]', 1, 'long_rest'],
    ['Pocao de Forca do Gigante das Nuvens', 0.25, 'FOR 27', '-', 'Consumivel, Magico, Pocao', 'Ao beber, sua Forca se torna 27 ate o proximo descanso longo.', '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":27,"targeting":{"mode":"self","count":1},"durationText":"Ate descanso longo","durationValue":1,"durationUnit":"long_rest","consumeOnUse":true}]', 1, 'long_rest'],
    ['Pocao de Forca do Gigante da Tempestade', 0.25, 'FOR 29', '-', 'Consumivel, Magico, Pocao', 'Ao beber, sua Forca se torna 29 ate o proximo descanso longo.', '[{"type":"stat","kind":"stat","target":"FOR","mode":"set","value":29,"targeting":{"mode":"self","count":1},"durationText":"Ate descanso longo","durationValue":1,"durationUnit":"long_rest","consumeOnUse":true}]', 1, 'long_rest'],
    ['Pocao de Cura Maior', 0.25, 'Cura 4d4+4', '-', 'Consumivel, Magico, Pocao', 'Recupera 4d4+4 pontos de vida.', '[{"type":"heal","healDice":"4d4+4","target":{"mode":"self","count":1},"consumeOnUse":true}]', null, 'instant'],
    ['Pocao de Cura Superior', 0.25, 'Cura 8d4+8', '-', 'Consumivel, Magico, Pocao', 'Recupera 8d4+8 pontos de vida.', '[{"type":"heal","healDice":"8d4+8","target":{"mode":"self","count":1},"consumeOnUse":true}]', null, 'instant'],
    ['Pocao de Cura Suprema', 0.25, 'Cura 10d4+20', '-', 'Consumivel, Magico, Pocao', 'Recupera 10d4+20 pontos de vida.', '[{"type":"heal","healDice":"10d4+20","target":{"mode":"self","count":1},"consumeOnUse":true}]', null, 'instant'],
    ['Pocao de Heroismo', 0.25, 'PV_TEMP +5', '-', 'Consumivel, Magico, Pocao', 'Concede 5 PV temporarios e o estado Heroismo por 1 minuto.', '[{"type":"temp_hp","kind":"temp_hp","target":"PV_TEMP","value":5,"durationText":"1 Minuto","durationValue":1,"durationUnit":"minute","consumeOnUse":true},{"type":"buff","target":"custom","condition":{"key":"heroism","name":"Heroismo","duration":{"value":1,"unit":"minute","repeatSave":"none"}},"durationText":"1 Minuto","durationValue":1,"durationUnit":"minute","consumeOnUse":true}]', 1, 'minute'],
    ['Pocao de Escalada', 0.25, 'Vantagem Atletismo', '-', 'Consumivel, Magico, Pocao', 'Concede deslocamento de escalada e vantagem em testes para escalar por 1 hora.', '[{"type":"buff","target":"custom","condition":{"key":"climbing","name":"Escalada","duration":{"value":1,"unit":"hour","repeatSave":"none"}},"bonus":{"climbSpeed":true,"athleticsClimbAdvantage":true},"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]', 1, 'hour'],
    ['Pocao de Respiracao Aquatica', 0.25, 'Respirar agua', '-', 'Consumivel, Magico, Pocao', 'Permite respirar debaixo d agua por 1 hora.', '[{"type":"buff","target":"custom","condition":{"key":"water_breathing","name":"Respiracao Aquatica","duration":{"value":1,"unit":"hour","repeatSave":"none"}},"bonus":{"waterBreathing":true},"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]', 1, 'hour'],
    ['Elixir de Resistencia ao Frio', 0.25, 'Resistencia Frio', '-', 'Consumivel, Magico, Elixir', 'Concede resistencia a dano de frio por 1 hora.', '[{"type":"resistance","kind":"buff","target":"custom","condition":{"key":"cold_resistance","name":"Resistencia ao Frio","duration":{"value":1,"unit":"hour","repeatSave":"none"}},"resistance":["Frio"],"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]', 1, 'hour'],
    ['Elixir de Resistencia a Veneno', 0.25, 'Resistencia Veneno', '-', 'Consumivel, Magico, Elixir', 'Concede resistencia contra veneno por 1 hora.', '[{"type":"resistance","kind":"buff","target":"custom","condition":{"key":"poison_resistance","name":"Resistencia a Veneno","duration":{"value":1,"unit":"hour","repeatSave":"none"}},"resistance":["Veneno"],"durationText":"1 Hora","durationValue":1,"durationUnit":"hour","consumeOnUse":true}]', 1, 'hour'],
    ['Pergaminho de Bola de Fogo', 0.0, '8d6', 'Fogo', 'Consumivel, Magico, Pergaminho', 'Conjura Bola de Fogo a partir do pergaminho.', '[{"type":"damage","damageDice":"8d6","damageType":"Fogo","target":{"mode":"area","count":"unlimited","area":{"shape":"sphere","radius":"6m"}},"save":{"ability":"DES","onSuccess":"half","dcSource":"scroll"},"consumeOnUse":true}]', null, 'instant'],
    ['Pergaminho de Revivificar', 0.0, 'Revive', '-', 'Consumivel, Magico, Pergaminho', 'Traz uma criatura morta recentemente de volta com 1 PV, se a mesa permitir.', '[{"type":"revive","target":{"mode":"creature","count":1},"hp":1,"consumeOnUse":true}]', null, 'instant'],
    ['Bomba de Fogo Alquimico', 0.5, '2d6', 'Fogo', 'Consumivel, Arremesso', 'Explode em chamas e pode deixar o alvo queimando.', '[{"type":"damage","damageDice":"2d6","damageType":"Fogo","target":{"mode":"area","count":"unlimited","area":{"shape":"sphere","radius":"3m"}},"save":{"ability":"DES","onSuccess":"half","dc":12},"condition":{"key":"burning","name":"Queimando","applyOn":"failed_save","duration":{"value":2,"unit":"turn","repeatSave":"end_of_turn"}},"consumeOnUse":true}]', 2, 'turn'],
    ['Frasco de Gelo Alquimico', 0.5, '2d6', 'Frio', 'Consumivel, Arremesso', 'Estoura em frio intenso e pode reduzir o movimento.', '[{"type":"damage","damageDice":"2d6","damageType":"Frio","target":{"mode":"area","count":"unlimited","area":{"shape":"sphere","radius":"3m"}},"save":{"ability":"CON","onSuccess":"half","dc":12},"condition":{"key":"frozen","name":"Congelado","applyOn":"failed_save","duration":{"value":1,"unit":"turn","repeatSave":"end_of_turn"}},"consumeOnUse":true}]', 1, 'turn'],
    ['Escudo +1', 3.0, '-', '-', 'Escudo, CA +3, Magico', 'Escudo encantado que concede +3 CA total enquanto equipado.', '[{"type":"stat","kind":"stat","target":"CA","mode":"add","value":3,"durationText":"Enquanto equipado","durationValue":0,"durationUnit":"while_equipped"}]', 0, 'while_equipped'],
    ['Armadura de Couro +1', 5.0, '-', '-', 'Armadura, CA 12 + Mod Des, Magico', 'Armadura de couro encantada com +1 CA embutido.', '[{"type":"stat","kind":"stat","target":"CA","mode":"add","value":1,"durationText":"Enquanto equipado","durationValue":0,"durationUnit":"while_equipped"}]', 0, 'while_equipped'],
    ['Cota de Malha +1', 27.5, '-', '-', 'Armadura, CA 17, Desv. Furtividade, Forca Min. 13, Magico', 'Cota de malha encantada com protecao adicional.', '[{"type":"stat","kind":"stat","target":"CA","mode":"add","value":1,"durationText":"Enquanto equipado","durationValue":0,"durationUnit":"while_equipped"}]', 0, 'while_equipped'],
    ['Espada Longa +1', 1.5, '1d8+1', 'Cortante', 'Arma, Versatil (1d10), Magico, +1 ataque/dano', 'Espada confiavel com encantamento simples de precisao e dano.', '[{"type":"weapon_bonus","target":{"mode":"weapon","count":1},"bonus":{"attack":1,"damage":1},"duration":{"value":0,"unit":"while_equipped"}}]', 0, 'while_equipped'],
    ['Arco Longo +1', 1.0, '1d8+1', 'Perfurante', 'Arma, Municao (45/180m), Pesada, Duas maos, Magico, +1 ataque/dano', 'Arco encantado para tiros mais precisos.', '[{"type":"weapon_bonus","target":{"mode":"weapon","count":1},"bonus":{"attack":1,"damage":1},"duration":{"value":0,"unit":"while_equipped"}}]', 0, 'while_equipped'],
    ['Martelo Leve', 1.0, '1d4', 'Concussao', 'Arma, Leve, Arremesso (6/18m)', 'Martelo pequeno equilibrado para arremesso.', '[]', null, null],
    ['Foice Curta', 1.0, '1d4', 'Cortante', 'Arma, Leve', 'Foice simples usada como ferramenta e arma.', '[]', null, null],
    ['Lanca', 1.5, '1d6', 'Perfurante', 'Arma, Arremesso (6/18m), Versatil (1d8)', 'Lanca simples para linha de frente ou arremesso.', '[]', null, null],
    ['Porrete', 1.0, '1d4', 'Concussao', 'Arma, Leve', 'Clava curta e facil de improvisar.', '[]', null, null],
    ['Clava Grande', 5.0, '1d8', 'Concussao', 'Arma, Duas maos', 'Pau pesado capaz de derrubar com impacto bruto.', '[]', null, null],
    ['Besta de Mao', 1.5, '1d6', 'Perfurante', 'Arma, Municao (9/36m), Leve, Recarga', 'Besta compacta muito usada por duelistas e ladinos.', '[]', null, null],
    ['Besta Pesada', 9.0, '1d10', 'Perfurante', 'Arma, Municao (30/120m), Pesada, Recarga, Duas maos', 'Besta potente de campo aberto.', '[]', null, null],
    ['Armadura Acolchoada', 4.0, '-', '-', 'Armadura, CA 11 + Mod Des, Desv. Furtividade', 'Camadas de tecido acolchoado que abafam golpes leves.', '[]', null, null],
    ['Camisa de Malha', 10.0, '-', '-', 'Armadura, CA 13 + Mod Des (Max 2)', 'Malha leve usada sob roupas ou couro.', '[]', null, null],
    ['Cota de Escamas', 22.5, '-', '-', 'Armadura, CA 14 + Mod Des (Max 2), Desv. Furtividade', 'Escamas metalicas costuradas sobre couro grosso.', '[]', null, null],
    ['Peitoral', 10.0, '-', '-', 'Armadura, CA 14 + Mod Des (Max 2)', 'Placa peitoral rigida com mobilidade razoavel.', '[]', null, null],
    ['Meia Placa', 20.0, '-', '-', 'Armadura, CA 15 + Mod Des (Max 2), Desv. Furtividade', 'Armadura parcial de placas sobre couro e malha.', '[]', null, null],
    ['Cota de Aneis', 20.0, '-', '-', 'Armadura, CA 14, Desv. Furtividade', 'Couro pesado coberto por aneis de metal.', '[]', null, null],
    ['Talabarte', 30.0, '-', '-', 'Armadura, CA 17, Desv. Furtividade, Forca Min. 15', 'Armadura pesada de placas encaixadas.', '[]', null, null],
  ];

  for (const item of expandedItems) {
    await upsertBaseItem(db, item);
  }

  await forceBaseItemEffectJson(db, 'Poção de Força do Gigante da Colina', 'FOR 21', 'Ao beber, sua Força se torna 21 até o próximo descanso longo.', hillGiantStrengthLongRest, 1, 'long_rest');
  await forceBaseItemEffectJson(db, 'PoÃ§Ã£o de ForÃ§a do Gigante da Colina', 'FOR 21', 'Ao beber, sua Forca se torna 21 ate o proximo descanso longo.', hillGiantStrengthLongRest, 1, 'long_rest');

  const expandedSpells: ExpandedSpellSeed[] = [
    ['Raio de Fogo', '0', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '36m', 'V,S', 'Instantanea', '1d10', 'Fogo', null, 'Ataque magico a distancia que causa fogo.', '[{"type":"damage","damageDice":"1d10","damageType":"Fogo","target":{"mode":"creature","count":1},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d10","5":"2d10","11":"3d10","17":"4d10"}}}]', 1],
    ['Rajada Mistica', '0', 'Magia', '["Bruxo"]', '1 acao', '36m', 'V,S', 'Instantanea', '1d10', 'Energia', null, 'Feixe de energia de pacto contra uma criatura.', '[{"type":"damage","damageDice":"1d10","damageType":"Energia","target":{"mode":"creature","count":1},"scaling":{"mode":"cantrip_beams","beamsByCharacterLevel":{"1":1,"5":2,"11":3,"17":4}}}]', 1],
    ['Raio de Gelo', '0', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '18m', 'V,S', '1 turno', '1d8', 'Frio', null, 'Dano de frio e reducao de deslocamento.', '[{"type":"damage","damageDice":"1d8","damageType":"Frio","target":{"mode":"creature","count":1},"condition":{"key":"slowed","name":"Lento","applyOn":"always","duration":{"value":1,"unit":"turn","repeatSave":"none"}},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d8","5":"2d8","11":"3d8","17":"4d8"}}}]', 1],
    ['Toque Chocante', '0', 'Magia', '["Mago","Feiticeiro"]', '1 acao', 'Toque', 'V,S', 'Instantanea', '1d8', 'Eletrico', null, 'Ataque magico corpo a corpo; alvo perde reacao conforme a mesa.', '[{"type":"damage","damageDice":"1d8","damageType":"Eletrico","target":{"mode":"creature","count":1},"condition":{"key":"shocked","name":"Sem Reacao","applyOn":"always","duration":{"value":1,"unit":"turn","repeatSave":"none"}},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d8","5":"2d8","11":"3d8","17":"4d8"}}}]', 1],
    ['Respingo Acido', '0', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '18m', 'V,S', 'Instantanea', '1d6', 'Acido', 'DES', 'Bolha acida contra uma ou duas criaturas proximas.', '[{"type":"damage","damageDice":"1d6","damageType":"Acido","target":{"mode":"creature","count":2},"save":{"ability":"DES","onSuccess":"negates","dcSource":"caster"},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d6","5":"2d6","11":"3d6","17":"4d6"}}}]', 1],
    ['Spray Venenoso', '0', 'Magia', '["Druida","Bruxo","Mago","Feiticeiro"]', '1 acao', '3m', 'V,S', 'Instantanea', '1d12', 'Veneno', 'CON', 'Nuvem curta de veneno.', '[{"type":"damage","damageDice":"1d12","damageType":"Veneno","target":{"mode":"creature","count":1},"save":{"ability":"CON","onSuccess":"negates","dcSource":"caster"},"scaling":{"mode":"cantrip","diceByCharacterLevel":{"1":"1d12","5":"2d12","11":"3d12","17":"4d12"}}}]', 1],
    ['Taumaturgia', '0', 'Magia', '["Clérigo"]', '1 acao', '9m', 'V', '1 minuto', '-', 'Outro', null, 'Pequeno prodigio divino util para interpretacao.', '[{"type":"utility","target":{"mode":"self","count":1},"tags":["roleplay","divine"]}]', 1],
    ['Ilusao Menor', '0', 'Magia', '["Bardo","Bruxo","Mago","Feiticeiro"]', '1 acao', '9m', 'S,M', '1 minuto', '-', 'Outro', null, 'Cria som ou imagem pequena.', '[{"type":"utility","target":{"mode":"area","count":1},"condition":{"key":"minor_illusion","name":"Ilusao Menor","duration":{"value":1,"unit":"minute","repeatSave":"none"}}}]', 1],
    ['Mãos Mágicas', '0', 'Magia', '["Bardo","Bruxo","Mago","Feiticeiro"]', '1 acao', '9m', 'V,S', '1 minuto', '-', 'Outro', null, 'Cria uma mao espectral para manipular objetos leves.', '[{"type":"utility","target":{"mode":"area","count":1},"condition":{"key":"mage_hand","name":"Maos Magicas","duration":{"value":1,"unit":"minute","repeatSave":"none"}}}]', 1],
    ['Benção', '1', 'Magia', '["Clérigo","Paladino"]', '1 acao', '9m', 'V,S,M', 'Concentracao, 1 minuto', '1d4', 'Bonus', null, 'Ate tres aliados somam 1d4 em ataques e testes de resistencia.', '[{"type":"buff","target":{"mode":"ally","count":3,"countScaling":{"perSpellSlotAbove":1}},"condition":{"key":"blessed","name":"Abencoado","duration":{"value":1,"unit":"concentration","repeatSave":"none"}},"bonus":{"attackDice":"1d4","saveDice":"1d4"}}]', 1],
    ['Perdição', '1', 'Magia', '["Bardo","Clérigo"]', '1 acao', '9m', 'V,S,M', 'Concentracao, 1 minuto', '1d4', 'Penalidade', 'CAR', 'Alvos subtraem 1d4 de ataques e testes de resistencia.', '[{"type":"debuff","target":{"mode":"creature","count":3,"countScaling":{"perSpellSlotAbove":1}},"save":{"ability":"CAR","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"baned","name":"Perdicao","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"none"}},"penalty":{"attackDice":"1d4","saveDice":"1d4"}}]', 1],
    ['Raio Guia', '1', 'Magia', '["Clérigo"]', '1 acao', '36m', 'V,S', '1 turno', '4d6', 'Radiante', null, 'Dano radiante; proximo ataque contra o alvo tem vantagem.', '[{"type":"damage","damageDice":"4d6","damageType":"Radiante","target":{"mode":"creature","count":1},"condition":{"key":"guided_bolt","name":"Marcado por Luz","duration":{"value":1,"unit":"turn","repeatSave":"none"}},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d6"}}}]', 1],
    ['Maos Flamejantes', '1', 'Magia', '["Mago","Feiticeiro"]', '1 acao', 'Cone 4,5m', 'V,S', 'Instantanea', '3d6', 'Fogo', 'DES', 'Cone de chamas a partir das maos.', '[{"type":"damage","damageDice":"3d6","damageType":"Fogo","target":{"mode":"area","count":"unlimited","area":{"shape":"cone","radius":"4.5m"}},"save":{"ability":"DES","onSuccess":"half","dcSource":"caster"},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d6"}}}]', 1],
    ['Onda Trovejante', '1', 'Magia', '["Bardo","Druida","Mago","Feiticeiro"]', '1 acao', 'Cubo 4,5m', 'V,S', 'Instantanea', '2d8', 'Trovejante', 'CON', 'Explosao sonora que empurra criaturas.', '[{"type":"damage","damageDice":"2d8","damageType":"Trovejante","target":{"mode":"area","count":"unlimited","area":{"shape":"cube","radius":"4.5m"}},"save":{"ability":"CON","onSuccess":"half","dcSource":"caster"},"forcedMovement":{"push":"3m"},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d8"}}}]', 1],
    ['Orbe Cromatico', '1', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '27m', 'V,S,M', 'Instantanea', '3d8', 'Escolher', null, 'Ataque magico com tipo elemental escolhido.', '[{"type":"damage","damageDice":"3d8","damageType":"Escolher","chooseDamageType":["Acido","Frio","Fogo","Eletrico","Veneno","Trovejante"],"target":{"mode":"creature","count":1},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d8"}}}]', 1],
    ['Fogo das Fadas', '1', 'Magia', '["Bardo","Druida"]', '1 acao', '18m', 'V', 'Concentracao, 1 minuto', '-', 'Outro', 'DES', 'Revela criaturas e concede vantagem contra alvos afetados.', '[{"type":"condition","target":{"mode":"area","count":"unlimited","area":{"shape":"cube","radius":"6m"}},"save":{"ability":"DES","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"faerie_fire","name":"Fogo das Fadas","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"none"}}}]', 1],
    ['Enredar', '1', 'Magia', '["Druida"]', '1 acao', '27m', 'V,S', 'Concentracao, 1 minuto', '-', 'Outro', 'FOR', 'Plantas prendem criaturas em area.', '[{"type":"condition","target":{"mode":"area","count":"unlimited","area":{"shape":"square","radius":"6m"}},"save":{"ability":"FOR","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"restrained","name":"Contido","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"end_of_turn"}}}]', 1],
    ['Auxilio', '2', 'Magia', '["Clérigo","Paladino"]', '1 acao', '9m', 'V,S,M', '8 horas', 'HP +5', 'Cura', null, 'Aumenta PV maximo e atual de ate tres criaturas.', '[{"type":"buff","kind":"hp","target":"HP","value":5,"targeting":{"mode":"ally","count":3},"condition":{"key":"aid","name":"Auxilio","duration":{"value":8,"unit":"hour","repeatSave":"none"}},"scaling":{"mode":"spell_slot","perSlotAbove":{"value":"+5"}}}]', 3],
    ['Imagem Espelhada', '2', 'Magia', '["Mago","Feiticeiro","Bruxo"]', '1 acao', 'Pessoal', 'V,S', '1 minuto', '-', 'Outro', null, 'Cria duplicatas ilusorias defensivas.', '[{"type":"buff","target":{"mode":"self","count":1},"condition":{"key":"mirror_image","name":"Imagem Espelhada","duration":{"value":1,"unit":"minute","repeatSave":"none"}},"bonus":{"mirrorImages":3}}]', 3],
    ['Raio Ardente', '2', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '36m', 'V,S', 'Instantanea', '3x2d6', 'Fogo', null, 'Tres raios de fogo contra um ou mais alvos.', '[{"type":"damage_multi","damageDice":"2d6","damageType":"Fogo","missiles":3,"target":{"mode":"creature","count":3},"scaling":{"mode":"spell_slot","extraMissilesPerSlotAbove":1}}]', 3],
    ['Teia', '2', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '18m', 'V,S,M', 'Concentracao, 1 hora', '-', 'Outro', 'DES', 'Teias grossas restringem uma area.', '[{"type":"condition","target":{"mode":"area","count":"unlimited","area":{"shape":"cube","radius":"6m"}},"save":{"ability":"DES","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"restrained","name":"Contido","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"end_of_turn"}}}]', 3],
    ['Invisibilidade', '2', 'Magia', '["Bardo","Bruxo","Mago","Feiticeiro"]', '1 acao', 'Toque', 'V,S,M', 'Concentracao, 1 hora', '-', 'Outro', null, 'Torna uma criatura invisivel.', '[{"type":"condition","target":{"mode":"creature","count":1,"countScaling":{"perSpellSlotAbove":1}},"condition":{"key":"invisible","name":"Invisivel","duration":{"value":1,"unit":"concentration","repeatSave":"none"}}}]', 3],
    ['Arma Espiritual', '2', 'Magia', '["Clérigo"]', '1 acao bonus', '18m', 'V,S', '1 minuto', '1d8', 'Energia', null, 'Cria arma espectral que ataca com acao bonus.', '[{"type":"summon_attack","damageDice":"1d8","damageType":"Energia","target":{"mode":"creature","count":1},"bonus":{"addCasterAbility":true},"duration":{"value":1,"unit":"minute"},"scaling":{"mode":"spell_slot","perTwoSlotsAbove":{"dice":"+1d8"}}}]', 3],
    ['Relampago', '3', 'Magia', '["Mago","Feiticeiro"]', '1 acao', 'Linha 30m', 'V,S,M', 'Instantanea', '8d6', 'Eletrico', 'DES', 'Linha de energia eletrica.', '[{"type":"damage","damageDice":"8d6","damageType":"Eletrico","target":{"mode":"area","count":"unlimited","area":{"shape":"line","length":"30m","width":"1.5m"}},"save":{"ability":"DES","onSuccess":"half","dcSource":"caster"},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d6"}}}]', 5],
    ['Lentidão', '3', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '36m', 'V,S,M', 'Concentracao, 1 minuto', '-', 'Outro', 'SAB', 'Diminui movimento, CA e acoes de varios alvos.', '[{"type":"condition","target":{"mode":"creature","count":6},"save":{"ability":"SAB","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"slowed","name":"Lento","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"end_of_turn"}}}]', 5],
    ['Acelerar', '3', 'Magia', '["Mago","Feiticeiro"]', '1 acao', '9m', 'V,S,M', 'Concentracao, 1 minuto', '+2 CA', 'Outro', null, 'Dobra deslocamento, +2 CA e concede acao extra limitada.', '[{"type":"buff","target":{"mode":"creature","count":1},"condition":{"key":"hasted","name":"Acelerado","duration":{"value":1,"unit":"concentration","repeatSave":"none"}},"bonus":{"ca":2,"speedMultiplier":2,"extraAction":1}}]', 5],
    ['Padrao Hipnotico', '3', 'Magia', '["Bardo","Bruxo","Mago","Feiticeiro"]', '1 acao', '36m', 'S,M', 'Concentracao, 1 minuto', '-', 'Outro', 'SAB', 'Padrao de cores que encanta e incapacita.', '[{"type":"condition","target":{"mode":"area","count":"unlimited","area":{"shape":"cube","radius":"9m"}},"save":{"ability":"SAB","onSuccess":"negates","dcSource":"caster"},"condition":{"key":"charmed","name":"Encantado","applyOn":"failed_save","duration":{"value":1,"unit":"concentration","repeatSave":"on_damage"}}}]', 5],
    ['Revivificar', '3', 'Magia', '["Clérigo","Paladino"]', '1 acao', 'Toque', 'V,S,M', 'Instantanea', '1 PV', 'Cura', null, 'Retorna uma criatura morta recentemente a vida com 1 PV.', '[{"type":"revive","target":{"mode":"creature","count":1},"hp":1}]', 5],
    ['Guardioes Espirituais', '3', 'Magia', '["Clérigo"]', '1 acao', 'Pessoal 4,5m', 'V,S,M', 'Concentracao, 10 minutos', '3d8', 'Radiante/Necrotico', 'SAB', 'Espiritos causam dano e reduzem movimento ao redor do conjurador.', '[{"type":"aura_damage","damageDice":"3d8","damageType":"Escolher","target":{"mode":"aura","count":"unlimited","radius":"4.5m"},"save":{"ability":"SAB","onSuccess":"half","dcSource":"caster"},"condition":{"key":"spirit_guardians","name":"Guardioes Espirituais","duration":{"value":10,"unit":"minute","repeatSave":"none"}},"scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d8"}}}]', 5],
    ['Ataque Imprudente', '2', 'Habilidade', '["Bárbaro"]', 'Livre', 'Pessoal', '-', '1 turno', 'Vantagem', 'Outro', null, 'Vantagem em ataques com FOR; ataques contra voce tem vantagem ate seu proximo turno.', '[{"type":"buff","target":{"mode":"self","count":1},"condition":{"key":"reckless_attack","name":"Ataque Imprudente","duration":{"value":1,"unit":"turn","repeatSave":"none"}},"bonus":{"meleeAttackAdvantage":"FOR"},"penalty":{"incomingAttack":"advantage"}}]', 2],
    ['Inspiracao Bardica', '1', 'Habilidade', '["Bardo"]', '1 acao bonus', '18m', '-', '10 minutos', '1d6', 'Bonus', null, 'Aliado soma dado em ataque, teste ou resistencia.', '[{"type":"buff","target":{"mode":"ally","count":1},"condition":{"key":"bardic_inspiration","name":"Inspiracao Bardica","duration":{"value":10,"unit":"minute","repeatSave":"none"}},"bonus":{"diceByClassLevel":{"1":"1d6","5":"1d8","10":"1d10","15":"1d12"}}}]', 1],
    ['Ataque Atordoante', '5', 'Habilidade', '["Monge"]', 'Ao acertar', 'Arma', '-', '1 turno', '-', 'Outro', 'CON', 'Gasta 1 Ki para tentar atordoar o alvo.', '[{"type":"condition","target":{"mode":"creature","count":1},"save":{"ability":"CON","onSuccess":"negates","dcSource":"ki"},"condition":{"key":"stunned","name":"Atordoado","applyOn":"failed_save","duration":{"value":1,"unit":"turn","repeatSave":"none"}}}]', 5],
    ['Desengajar Astuto', '2', 'Habilidade', '["Ladino"]', '1 acao bonus', 'Pessoal', '-', 'Instantanea', '-', 'Outro', null, 'Usa acao bonus para desengajar.', '[{"type":"action_economy","target":{"mode":"self","count":1},"bonus":{"disengageAsBonusAction":true}}]', 2],
    ['Esquiva Sobrenatural', '5', 'Habilidade', '["Ladino"]', '1 reacao', 'Pessoal', '-', 'Instantanea', 'Metade', 'Reducao', null, 'Reduz pela metade o dano de um ataque recebido.', '[{"type":"damage_reduction","target":{"mode":"self","count":1},"reaction":true,"multiplier":0.5}]', 5],
    ['Golpe Divino', '2', 'Habilidade', '["Paladino"]', 'Ao acertar', 'Arma', '-', 'Instantanea', '+2d8', 'Radiante', null, 'Gasta espaco de magia para dano radiante extra.', '[{"type":"extra","damageDice":"2d8","damageType":"Radiante","target":{"mode":"weapon","count":1},"trigger":"weapon_hit","scaling":{"mode":"spell_slot","perSlotAbove":{"dice":"+1d8"},"bonusVs":["Morto-vivo","Infernal"]}}]', 2],
    ['Maos Curativas', '1', 'Habilidade', '["Paladino"]', '1 acao', 'Toque', '-', 'Instantanea', 'Reserva', 'Cura', null, 'Cura usando a reserva de Cura Pelas Maos.', '[{"type":"heal_pool","target":{"mode":"creature","count":1},"pool":{"mode":"class_level","class":"Paladino","multiplier":5}}]', 1],
    ['Marca do Cacador', '1', 'Magia', '["Patrulheiro"]', '1 acao bonus', '27m', 'V', 'Concentracao, 1 hora', '+1d6', 'Extra', null, 'Marca o alvo para dano extra de arma.', '[{"type":"debuff","target":{"mode":"creature","count":1},"condition":{"key":"hunters_mark","name":"Marcado","duration":{"value":1,"unit":"concentration","repeatSave":"none"}},"extraDamage":{"dice":"1d6","type":"Extra","source":"caster_weapon_hit"}}]', 2],
    ['Metamagia: Magia Acelerada', '3', 'Habilidade', '["Feiticeiro"]', 'Livre', 'Pessoal', '-', 'Turno atual', '-', 'Outro', null, 'Conjura uma magia de acao como acao bonus ao gastar pontos de feiticaria.', '[{"type":"action_economy","target":{"mode":"self","count":1},"bonus":{"castActionSpellAsBonusAction":true},"duration":{"value":1,"unit":"turn"}}]', 3],
  ];

  for (const spell of expandedSpells) {
    await upsertBaseSpell(db, spell);
  }
}

async function upsertBaseItem(db: SQLiteDatabase, item: ExpandedItemSeed) {
  const existing = await db.getFirstAsync<{ id: number; criador?: string | null }>(
    `SELECT id, criador FROM items WHERE name = ? LIMIT 1`,
    [item[0]],
  );

  if (!existing) {
    await db.runAsync(
      `INSERT INTO items (name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      item,
    );
    return;
  }

  if (String(existing.criador || 'base') !== 'base') return;
  await db.runAsync(
    `UPDATE items
     SET weight = ?, damage = ?, damage_type = ?, properties = ?, descricao = ?,
         effect_json = ?, duration_value = ?, duration_unit = ?,
         updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
     WHERE id = ?`,
    [item[1], item[2], item[3], item[4], item[5], item[6], item[7], item[8], existing.id],
  );
}

async function forceBaseItemEffectJson(
  db: SQLiteDatabase,
  name: string,
  damage: string,
  descricao: string,
  effectJson: string,
  durationValue: number | null,
  durationUnit: string | null,
) {
  await db.runAsync(
    `UPDATE items
     SET damage = ?, descricao = ?, effect_json = ?, duration_value = ?, duration_unit = ?,
         updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
     WHERE name = ? AND COALESCE(criador, 'base') = 'base'`,
    [damage, descricao, effectJson, durationValue, durationUnit, name],
  );
}

async function upsertBaseSpell(db: SQLiteDatabase, spell: ExpandedSpellSeed) {
  const existing = await db.getFirstAsync<{ id: number; criador?: string | null }>(
    `SELECT id, criador FROM spells WHERE name = ? AND COALESCE(criador, 'base') = 'base' LIMIT 1`,
    [spell[0]],
  );

  if (!existing) {
    await db.runAsync(
      `INSERT INTO spells (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, effect_json, class_level_required, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      spell,
    );
    return;
  }

  await db.runAsync(
    `UPDATE spells
     SET level = ?, category = ?, classes = ?, casting_time = ?, range = ?,
         components = ?, duration = ?, damage_dice = ?, damage_type = ?,
         saving_throw = ?, description = ?, effect_json = ?, class_level_required = ?,
         updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
     WHERE id = ?`,
    [
      spell[1],
      spell[2],
      spell[3],
      spell[4],
      spell[5],
      spell[6],
      spell[7],
      spell[8],
      spell[9],
      spell[10],
      spell[11],
      spell[12],
      spell[13],
      existing.id,
    ],
  );
}
