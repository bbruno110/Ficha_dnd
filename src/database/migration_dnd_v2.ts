import { SQLiteDatabase } from 'expo-sqlite';

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

  await db.runAsync(
    `INSERT OR IGNORE INTO items (name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit, criador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
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
  );

  for (const [name, effectJson] of itemUpdates) {
    await updateEmptyEffectJson(db, 'items', name, effectJson);
  }
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
