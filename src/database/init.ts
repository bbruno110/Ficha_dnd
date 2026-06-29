import Constants from 'expo-constants';
import { SQLiteDatabase } from 'expo-sqlite';
import { seedRandomCreatorContent } from './randomContentSeed';

async function ensureColumn(db: SQLiteDatabase, tableName: string, columnName: string, definition: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  if (!columns.some(column => column.name === columnName)) {
    await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

const TRACE_TABLES = [
  { table: 'items', idColumn: 'id' },
  { table: 'effects', idColumn: 'id' },
  { table: 'condition_effects', idColumn: 'id' },
  { table: 'races', idColumn: 'id' },
  { table: 'classes', idColumn: 'id' },
  { table: 'subclasses', idColumn: 'id' },
  { table: 'spells', idColumn: 'id' },
  { table: 'starting_kits', idColumn: 'id' },
  { table: 'bg3_companions', idColumn: 'id' },
  { table: 'random_lore_archetypes', idColumn: 'id' },
  { table: 'random_lore_entries', idColumn: 'id' },
  { table: 'random_name_parts', idColumn: 'id' },
  { table: 'random_lore_connectors', idColumn: 'id' },
  { table: 'random_race_language_rules', idColumn: 'id' },
  { table: 'characters', idColumn: 'id' },
  { table: 'spellcasting_progression', idColumn: 'id' },
  { table: 'lan_device_identity', idColumn: 'id' },
  { table: 'lan_sessions', idColumn: 'id' },
  { table: 'lan_session_state', idColumn: 'session_id' },
  { table: 'lan_session_players', idColumn: 'id' },
  { table: 'lan_character_snapshots', idColumn: 'id' },
  { table: 'lan_event_log', idColumn: 'id' },
];

async function ensureTraceTriggers(db: SQLiteDatabase) {
  for (const config of TRACE_TABLES) {
    const triggerBase = `trace_${config.table}`;
    await db.execAsync(`
      CREATE TRIGGER IF NOT EXISTS ${triggerBase}_insert
      AFTER INSERT ON ${config.table}
      BEGIN
        INSERT INTO app_trace_logs (level, category, action, entity_table, entity_id, message)
        VALUES ('debug', 'database', 'INSERT', '${config.table}', CAST(NEW.${config.idColumn} AS TEXT), 'Registro criado em ${config.table}');
      END;

      CREATE TRIGGER IF NOT EXISTS ${triggerBase}_update
      AFTER UPDATE ON ${config.table}
      BEGIN
        INSERT INTO app_trace_logs (level, category, action, entity_table, entity_id, message)
        VALUES ('debug', 'database', 'UPDATE', '${config.table}', CAST(NEW.${config.idColumn} AS TEXT), 'Registro atualizado em ${config.table}');
      END;

      CREATE TRIGGER IF NOT EXISTS ${triggerBase}_delete
      AFTER DELETE ON ${config.table}
      BEGIN
        INSERT INTO app_trace_logs (level, category, action, entity_table, entity_id, message)
        VALUES ('debug', 'database', 'DELETE', '${config.table}', CAST(OLD.${config.idColumn} AS TEXT), 'Registro removido de ${config.table}');
      END;
    `);
  }
}

function getInstallTraceKey() {
  const expoConfig = Constants.expoConfig as any;
  const version = Constants.nativeApplicationVersion || expoConfig?.version || 'dev';
  const build = Constants.nativeBuildVersion || expoConfig?.android?.versionCode || 'local';
  return `${version}:${build}`;
}

async function resetTransientDebugStateOnBuildChange(db: SQLiteDatabase) {
  const installKey = getInstallTraceKey();
  const previous = await db.getFirstAsync<{ value?: string }>(
    `SELECT value FROM app_meta WHERE key = 'install_trace_key' LIMIT 1`
  );

  if (previous?.value !== installKey) {
    await db.execAsync(`
      DELETE FROM app_trace_logs;
    `);
    await db.runAsync(
      `INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('install_trace_key', ?, CURRENT_TIMESTAMP)`,
      [installKey]
    );
    return true;
  }
  return false;
}

async function seedEffectIfMissing(
  db: SQLiteDatabase,
  sourceTable: 'items' | 'spells',
  sourceName: string,
  effect: {
    effect_kind: string;
    effect_type: string;
    condition_name?: string | null;
    value_mode: string;
    dice_count?: number | null;
    dice_sides?: number | null;
    dice_bonus?: number | null;
    fixed_value?: number | null;
    chance_percent?: number;
    duration_value?: number | null;
    duration_unit?: string;
    sort_order?: number;
    metadata?: Record<string, unknown>;
  }
) {
  const source = await db.getFirstAsync<{ id: number }>(`SELECT id FROM ${sourceTable} WHERE name = ? LIMIT 1`, [sourceName]);
  if (!source?.id) return;

  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM effects
     WHERE source_table = ? AND source_name = ? AND effect_kind = ? AND effect_type = ?
       AND IFNULL(condition_name, '') = IFNULL(?, '') AND sort_order = ? AND criador = 'base'
     LIMIT 1`,
    [sourceTable, sourceName, effect.effect_kind, effect.effect_type, effect.condition_name || null, effect.sort_order || 0]
  );
  if (existing?.id) return;

  await db.runAsync(
    `INSERT INTO effects (
      source_table, source_id, source_name, trigger, effect_kind, effect_type, condition_name,
      value_mode, dice_count, dice_sides, dice_bonus, fixed_value, chance_percent,
      duration_value, duration_unit, metadata, sort_order, criador
    ) VALUES (?, ?, ?, 'on_use', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
    [
      sourceTable,
      source.id,
      sourceName,
      effect.effect_kind,
      effect.effect_type,
      effect.condition_name || null,
      effect.value_mode,
      effect.dice_count || null,
      effect.dice_sides || null,
      effect.dice_bonus || 0,
      effect.fixed_value === undefined ? null : effect.fixed_value,
      effect.chance_percent === undefined ? 100 : effect.chance_percent,
      effect.duration_value || null,
      effect.duration_unit || 'instant',
      JSON.stringify(effect.metadata || {}),
      effect.sort_order || 0,
    ]
  );
}

async function seedStructuredBaseEffects(db: SQLiteDatabase) {
  await db.runAsync(
    `UPDATE items
     SET category = COALESCE(category, CASE
       WHEN properties LIKE '%Consum%' THEN 'Consumivel'
       WHEN properties LIKE '%Armadura%' THEN 'Armadura'
       WHEN properties LIKE '%Escudo%' THEN 'Escudo'
       WHEN properties LIKE '%Ferramenta%' THEN 'Ferramenta'
       ELSE 'Outro'
     END),
     is_consumable = CASE WHEN properties LIKE '%Consum%' THEN 1 ELSE COALESCE(is_consumable, 0) END`
  );

  await db.runAsync(
    `INSERT OR IGNORE INTO items (name, weight, damage, damage_type, category, is_consumable, properties, descricao, criador)
     VALUES (
       'Dardo Venenoso',
       0.25,
       '1d4 Perfurante + 10% Envenenado por 10 turnos',
       'Perfurante, Veneno',
       'Consumivel',
       1,
       'Arma, Arremesso, Consumivel',
       'Dardo preparado com toxina instavel. Ao atingir, pode envenenar o alvo.',
       'base'
     )`
  );

  await seedEffectIfMissing(db, 'items', 'Poção de Cura', {
    effect_kind: 'healing',
    effect_type: 'Cura',
    value_mode: 'dice',
    dice_count: 1,
    dice_sides: 8,
    duration_unit: 'instant',
  });

  await seedEffectIfMissing(db, 'items', 'Dardo Venenoso', {
    effect_kind: 'damage',
    effect_type: 'Perfurante',
    value_mode: 'dice',
    dice_count: 1,
    dice_sides: 4,
    duration_unit: 'instant',
    sort_order: 0,
  });

  await seedEffectIfMissing(db, 'items', 'Dardo Venenoso', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Envenenado',
    value_mode: 'none',
    chance_percent: 10,
    duration_value: 10,
    duration_unit: 'turn',
    sort_order: 1,
    metadata: {
      condition_color: '#7ED957',
      condition_description: 'Sofre uma toxina ativa. Use a regra da mesa para penalidades, testes ou dano recorrente.',
    },
  });
}

async function seedConditionEffectCatalog(db: SQLiteDatabase) {
  const baseEffects = [
    { name: 'Envenenado', description: 'Sofre uma toxina ativa. Use a regra da mesa para penalidades, testes ou dano recorrente.', color: '#7ED957' },
    { name: 'Cego', description: 'Nao enxerga normalmente e pode sofrer desvantagem em ataques e testes visuais.', color: '#9CA3AF' },
    { name: 'Surdo', description: 'Nao escuta sons comuns e pode falhar em sinais ou percepcoes auditivas.', color: '#38BDF8' },
    { name: 'Paralisado', description: 'Movimento bloqueado ou severamente limitado ate o efeito terminar.', color: '#A78BFA' },
    { name: 'Atordoado', description: 'Reage mal e perde controle fino de acoes durante a duracao.', color: '#FACC15' },
    { name: 'Caido', description: 'Esta no chao ou fora de postura de combate.', color: '#94A3B8' },
    { name: 'Agarrado', description: 'Esta preso por criatura, magia, objeto ou terreno.', color: '#FB7185' },
    { name: 'Amedrontado', description: 'Medo ativo contra uma fonte definida pelo mestre.', color: '#C084FC' },
    { name: 'Encantado', description: 'Influenciado por magia, carisma ou compulsao sobrenatural.', color: '#F472B6' },
    { name: 'Inconsciente', description: 'Nao age normalmente ate acordar, estabilizar ou ser removido do estado.', color: '#64748B' },
    { name: 'Queimadura', description: 'Chamas, calor ou acido deixam um efeito persistente.', color: '#F4A84D' },
    { name: 'Amaldicoado', description: 'Uma maldicao ativa altera sorte, corpo, mente ou destino do alvo.', color: '#8B5CF6' },
    { name: 'Invisivel', description: 'Nao pode ser visto normalmente. Ataques contra a criatura podem sofrer desvantagem, e ataques dela podem ter vantagem conforme regra da mesa.', color: '#94A3B8' },
    { name: 'Voando', description: 'Pode se mover pelo ar durante a duracao do efeito.', color: '#38BDF8' },
    { name: 'Aumentado', description: 'Tamanho ou massa aumentados por magia, podendo alterar dano, alcance, peso carregado ou testes de Forca.', color: '#F59E0B' },
    { name: 'Heroismo', description: 'Coragem sobrenatural, resistencia a medo e vigor temporario.', color: '#FACC15' },
    { name: 'Velocidade', description: 'Movimento acelerado e reflexos ampliados durante a duracao.', color: '#22C55E' },
    { name: 'Resistencia Elemental', description: 'Reduz dano de um tipo elemental definido pelo efeito.', color: '#60A5FA' },
    { name: 'Obscurecido', description: 'Fumaca, neblina, sombra ou cobertura visual dificulta enxergar ou mirar dentro da area.', color: '#64748B' },
  ];

  for (const effect of baseEffects) {
    await db.runAsync(
      `INSERT OR IGNORE INTO condition_effects (name, description, color, criador) VALUES (?, ?, ?, 'base')`,
      [effect.name, effect.description, effect.color]
    );
  }
}

async function organizeBaseCatalog(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_items_catalog_name
      ON items (name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_items_catalog_category_name
      ON items (category COLLATE NOCASE, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_spells_catalog_name
      ON spells (name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_spells_catalog_category_level_name
      ON spells (category COLLATE NOCASE, level COLLATE NOCASE, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_spells_catalog_classes_name
      ON spells (classes COLLATE NOCASE, name COLLATE NOCASE);
  `);

  await db.runAsync(`
    UPDATE items
    SET
      category = CASE
        WHEN LOWER(properties) LIKE '%consum%' THEN 'Consumivel'
        WHEN LOWER(properties) LIKE '%armadura%' THEN 'Armadura'
        WHEN LOWER(properties) LIKE '%escudo%' THEN 'Escudo'
        WHEN LOWER(properties) LIKE '%muni%' THEN 'Municao'
        WHEN LOWER(properties) LIKE '%ferramenta%' THEN 'Ferramenta'
        WHEN LOWER(properties) LIKE '%instrumento%' THEN 'Ferramenta'
        WHEN LOWER(properties) LIKE '%arma%' THEN 'Arma'
        WHEN LOWER(properties) LIKE '%mochila%' OR LOWER(properties) LIKE '%saco%' THEN 'Carga'
        WHEN LOWER(properties) LIKE '%capa%' OR LOWER(properties) LIKE '%roupa%' OR LOWER(properties) LIKE '%veste%' THEN 'Vestuario'
        ELSE 'Outro'
      END,
      is_consumable = CASE
        WHEN LOWER(properties) LIKE '%consum%' THEN 1
        ELSE COALESCE(is_consumable, 0)
      END
    WHERE criador = 'base'
      AND (category IS NULL OR TRIM(category) = '' OR LOWER(category) = 'outro')
  `);

  await db.runAsync(`
    UPDATE items
    SET is_consumable = 1
    WHERE criador = 'base'
      AND is_consumable <> 1
      AND LOWER(properties) LIKE '%consum%'
  `);

  await db.runAsync(`
    UPDATE spells
    SET category = CASE
      WHEN LOWER(level) = 'passiva' OR LOWER(casting_time) = 'passiva' THEN 'Passiva'
      WHEN components = '-' AND LOWER(category) <> 'passiva' THEN 'Habilidade'
      WHEN LOWER(category) IN ('magia', 'habilidade', 'passiva') THEN category
      ELSE 'Magia'
    END
    WHERE criador = 'base'
      AND (
        category IS NULL
        OR TRIM(category) = ''
        OR LOWER(category) NOT IN ('magia', 'habilidade', 'passiva')
        OR LOWER(level) = 'passiva'
        OR LOWER(casting_time) = 'passiva'
        OR (components = '-' AND LOWER(category) <> 'passiva')
      )
  `);

  await db.runAsync(`
    UPDATE spells
    SET class_level_required = CASE
      WHEN LOWER(level) = 'truque' THEN 1
      WHEN LOWER(level) = 'passiva' THEN 1
      WHEN LOWER(category) = 'magia' AND level LIKE '%1' THEN 1
      WHEN LOWER(category) = 'magia' AND level LIKE '%2' THEN 3
      WHEN LOWER(category) = 'magia' AND level LIKE '%3' THEN 5
      WHEN LOWER(category) = 'magia' AND level LIKE '%4' THEN 7
      WHEN LOWER(category) = 'magia' AND level LIKE '%5' THEN 9
      WHEN LOWER(category) = 'magia' AND level LIKE '%6' THEN 11
      WHEN LOWER(category) = 'magia' AND level LIKE '%7' THEN 13
      WHEN LOWER(category) = 'magia' AND level LIKE '%8' THEN 15
      WHEN LOWER(category) = 'magia' AND level LIKE '%9' THEN 17
      WHEN level LIKE '%20' THEN 20
      WHEN level LIKE '%19' THEN 19
      WHEN level LIKE '%18' THEN 18
      WHEN level LIKE '%17' THEN 17
      WHEN level LIKE '%16' THEN 16
      WHEN level LIKE '%15' THEN 15
      WHEN level LIKE '%14' THEN 14
      WHEN level LIKE '%13' THEN 13
      WHEN level LIKE '%12' THEN 12
      WHEN level LIKE '%11' THEN 11
      WHEN level LIKE '%10' THEN 10
      WHEN level LIKE '%9' THEN 9
      WHEN level LIKE '%8' THEN 8
      WHEN level LIKE '%7' THEN 7
      WHEN level LIKE '%6' THEN 6
      WHEN level LIKE '%5' THEN 5
      WHEN level LIKE '%4' THEN 4
      WHEN level LIKE '%3' THEN 3
      WHEN level LIKE '%2' THEN 2
      WHEN level LIKE '%1' THEN 1
      ELSE 1
    END
    WHERE criador = 'base'
      AND (class_level_required IS NULL OR TRIM(CAST(class_level_required AS TEXT)) = '' OR CAST(class_level_required AS INTEGER) <= 0)
  `);
}

type ExpandedItemSeed = {
  name: string;
  weight: number;
  damage: string;
  damageType: string;
  category: string;
  isConsumable: number;
  properties: string;
  descricao: string;
};

type ExpandedSpellSeed = {
  name: string;
  level: string;
  category: string;
  classes: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  damageDice: string;
  damageType: string;
  savingThrow: string;
  description: string;
  classLevelRequired: number;
};

type SpellcastingProgressionSeed = {
  sourceType: 'class' | 'subclass' | 'race';
  sourceName: string;
  level: number;
  cantripsKnown: number;
  spellsKnown: number;
  slots: number[];
};

type FeatureRequirementSeed = string | { name: string; level?: number; spellLevel?: string };

type BaseRaceFeatureRepair = {
  name: string;
  features: FeatureRequirementSeed[];
};

type BaseClassFeatureRepair = {
  name: string;
  features: FeatureRequirementSeed[];
};

type BaseSubclassFeatureRepair = {
  name: string;
  className: string;
  levelRequired: number;
  features: FeatureRequirementSeed[];
};

type BaseFeatureSpellRepair = {
  name: string;
  level: string;
  category: 'Magia' | 'Habilidade' | 'Passiva';
  classes: string;
  castingTime?: string;
  range?: string;
  components?: string;
  duration?: string;
  damageDice?: string;
  damageType?: string;
  savingThrow?: string;
  description: string;
  classLevelRequired: number;
  forceUpdate?: boolean;
};

function normalizeFeatureRequirements(features: FeatureRequirementSeed[]) {
  return JSON.stringify(features.map(feature => {
    if (typeof feature === 'string') return { name: feature, level: 1 };
    return { name: feature.name, level: feature.level || 1 };
  }));
}

const BASE_RACE_FEATURE_REPAIRS: BaseRaceFeatureRepair[] = [
  { name: 'Anão', features: ['Visão no Escuro', 'Resiliência Anã', 'Treinamento Anão em Combate', 'Proficiência com Ferramentas Anãs', 'Conhecimento de Pedras'] },
  { name: 'Draconato', features: ['Ancestral Dracônico', 'Sopro Dracônico', 'Resistência Dracônica'] },
  { name: 'Elfo', features: ['Visão no Escuro', 'Ancestral Feérico', 'Transe', 'Sentidos Aguçados'] },
  { name: 'Gnomo', features: ['Visão no Escuro', 'Astúcia Gnômica'] },
  { name: 'Halfling', features: ['Sortudo', 'Bravura', 'Agilidade Halfling'] },
  { name: 'Humano', features: ['Idioma Extra'] },
  { name: 'Meio-Elfo', features: ['Visão no Escuro', 'Ancestral Feérico', 'Versatilidade em Perícias'] },
  { name: 'Meio-Orc', features: ['Visão no Escuro', 'Ameaçador', 'Resistência Implacável', 'Ataques Selvagens'] },
  { name: 'Tiefling', features: ['Visão no Escuro', 'Resistência Infernal', 'Taumaturgia', { name: 'Legado Infernal: Repreensão Infernal', level: 3, spellLevel: 'Nível 1' }, { name: 'Legado Infernal: Escuridão', level: 5, spellLevel: 'Nível 2' }] },
  { name: 'Githyanki', features: ['Conhecimento Astral', 'Mãos Mágicas (Githyanki)', { name: 'Legado Githyanki: Aprimorar Salto', level: 3, spellLevel: 'Nível 1' }, { name: 'Legado Githyanki: Passo Nebuloso', level: 5, spellLevel: 'Nível 2' }] },
  { name: 'Alto Elfo', features: ['Visão no Escuro', 'Ancestral Feérico', 'Transe', 'Truque de Alto Elfo'] },
  { name: 'Drow', features: ['Visão no Escuro Superior', 'Ancestral Feérico', 'Sensibilidade à Luz Solar', 'Treinamento com Armas Drow', 'Magia Drow: Globos de Luz', { name: 'Magia Drow: Fogo das Fadas', level: 3, spellLevel: 'Nível 1' }, { name: 'Magia Drow: Escuridão', level: 5, spellLevel: 'Nível 2' }] },
  { name: 'Elfo da Floresta', features: ['Visão no Escuro', 'Ancestral Feérico', 'Pés Ligeiros', 'Máscara da Natureza'] },
  { name: 'Aasimar', features: ['Visão no Escuro', 'Resistência Celestial', 'Mãos Curativas'] },
  { name: 'Genasi do Fogo', features: ['Visão no Escuro', 'Resistência a Fogo', 'Chama Inata'] },
  { name: 'Tabaxi', features: ['Agilidade Felina', 'Garras', 'Talento Felino'] },
  { name: 'Firbolg', features: ['Magia Firbolg', 'Passo Oculto', 'Fala com Feras e Plantas'] },
  { name: 'Kenku', features: ['Mimetismo', 'Treinamento Kenku', 'Memória de Perito'] },
  { name: 'Kobold', features: ['Tática de Matilha', 'Grito Dracônico', 'Visão no Escuro'] },
  { name: 'Tritão', features: ['Anfíbio', 'Controle do Ar e Água', 'Guardião das Profundezas'] },
  { name: 'Shadar-kai', features: ['Resistência Necrótica', 'Benção da Rainha Corvo', 'Visão no Escuro'] },
];

const BASE_CLASS_FEATURE_REPAIRS: BaseClassFeatureRepair[] = [
  {
    name: 'Bárbaro',
    features: ['Fúria', 'Defesa Sem Armadura', { name: 'Ataque Imprudente', level: 2 }, { name: 'Sentido de Perigo', level: 2 }, { name: 'Ataque Extra', level: 5 }, { name: 'Movimento Rápido', level: 5 }],
  },
  {
    name: 'Bardo',
    features: ['Inspiração Bárdica', 'Conjuração de Bardo', { name: 'Pau para Toda Obra', level: 2 }, { name: 'Canção de Descanso', level: 2 }, { name: 'Especialização', level: 3 }, { name: 'Fonte de Inspiração', level: 5 }],
  },
  {
    name: 'Bruxo',
    features: ['Patrono Sobrenatural', 'Magia de Pacto', { name: 'Invocações Místicas', level: 2 }, { name: 'Dádiva do Pacto', level: 3 }],
  },
  {
    name: 'Clérigo',
    features: ['Conjuração de Clérigo', 'Domínio Divino', { name: 'Canalizar Divindade', level: 2 }, { name: 'Destruir Mortos-Vivos', level: 5 }],
  },
  {
    name: 'Druida',
    features: ['Conjuração de Druida', 'Druídico', { name: 'Forma Selvagem', level: 2 }, { name: 'Círculo Druídico', level: 2 }, { name: 'Forma Selvagem Aprimorada', level: 4 }],
  },
  {
    name: 'Feiticeiro',
    features: ['Conjuração de Feiticeiro', 'Origem Feiticeira', { name: 'Fonte de Magia', level: 2 }, { name: 'Metamagia', level: 3 }],
  },
  {
    name: 'Guerreiro',
    features: ['Estilo de Luta', 'Segundo Fôlego', { name: 'Surto de Ação', level: 2 }, { name: 'Arquétipo Marcial', level: 3 }, { name: 'Ataque Extra', level: 5 }],
  },
  {
    name: 'Ladino',
    features: ['Especialização (Ladino)', 'Ataque Furtivo', 'Gíria de Ladrão', { name: 'Ação Ardilosa', level: 2 }, { name: 'Arquétipo Ladino', level: 3 }, { name: 'Esquiva Sobrenatural', level: 5 }],
  },
  {
    name: 'Mago',
    features: ['Conjuração de Mago', 'Recuperação Arcana', { name: 'Tradição Arcana', level: 2 }],
  },
  {
    name: 'Monge',
    features: ['Artes Marciais', 'Defesa Sem Armadura (Monge)', { name: 'Ki', level: 2 }, { name: 'Movimento Sem Armadura', level: 2 }, { name: 'Tradição Monástica', level: 3 }, { name: 'Queda Lenta', level: 4 }, { name: 'Ataque Extra', level: 5 }, { name: 'Ataque Atordoante', level: 5 }],
  },
  {
    name: 'Paladino',
    features: ['Sentido Divino', 'Imposição das Mãos', { name: 'Estilo de Luta', level: 2 }, { name: 'Conjuração de Paladino', level: 2 }, { name: 'Golpe Divino', level: 2 }, { name: 'Juramento Sagrado', level: 3 }, { name: 'Ataque Extra', level: 5 }, { name: 'Aura de Proteção', level: 6 }, { name: 'Aura de Coragem', level: 10 }, { name: 'Golpe Divino Aprimorado', level: 11 }, { name: 'Toque Purificador', level: 14 }],
  },
  {
    name: 'Patrulheiro',
    features: ['Inimigo Favorito', 'Explorador Nato', { name: 'Estilo de Luta', level: 2 }, { name: 'Conjuração de Patrulheiro', level: 2 }, { name: 'Arquétipo de Patrulheiro', level: 3 }, { name: 'Ataque Extra', level: 5 }],
  },
  {
    name: 'Artifice',
    features: ['Infusões Mágicas', 'Conjuração por Ferramentas', { name: 'Especialista em Ferramentas', level: 3 }, { name: 'Item Infundido Aprimorado', level: 5 }],
  },
  {
    name: 'Mistico',
    features: ['Talento Psiônico', 'Disciplina Mental', { name: 'Ordem Mística', level: 3 }, { name: 'Mente Fortificada', level: 5 }],
  },
];

const BASE_SUBCLASS_FEATURE_REPAIRS: BaseSubclassFeatureRepair[] = [
  { name: 'Caminho do Berserker', className: 'Bárbaro', levelRequired: 3, features: [{ name: 'Frenesi', level: 3 }, { name: 'Fúria sem Mente', level: 6 }] },
  { name: 'Caminho do Totem Guerreiro', className: 'Bárbaro', levelRequired: 3, features: [{ name: 'Buscador Espiritual', level: 3 }, { name: 'Espírito Totêmico', level: 3 }, { name: 'Aspecto da Besta', level: 6 }] },
  { name: 'Caminho do Guardião Ancestral', className: 'Bárbaro', levelRequired: 3, features: [{ name: 'Protetores Ancestrais', level: 3 }, { name: 'Escudo Espiritual', level: 6 }] },
  { name: 'Colégio do Conhecimento', className: 'Bardo', levelRequired: 3, features: [{ name: 'Proficiência Bônus', level: 3 }, { name: 'Palavras Cortantes', level: 3 }, { name: 'Segredos Mágicos Adicionais', level: 6 }] },
  { name: 'Colégio da Bravura', className: 'Bardo', levelRequired: 3, features: [{ name: 'Inspiração de Combate', level: 3 }, { name: 'Proficiências de Bravura', level: 3 }, { name: 'Ataque Extra', level: 6 }] },
  { name: 'Colégio das Espadas', className: 'Bardo', levelRequired: 3, features: [{ name: 'Proficiências de Espadas', level: 3 }, { name: 'Estilo de Luta: Espadas', level: 3 }, { name: 'Floreio de Lâmina', level: 3 }, { name: 'Ataque Extra', level: 6 }] },
  { name: 'O Corruptor', className: 'Bruxo', levelRequired: 1, features: ['Benção do Obscuro', { name: 'Sorte do Próprio Obscuro', level: 6 }] },
  { name: 'O Arquifada', className: 'Bruxo', levelRequired: 1, features: ['Presença Feérica', { name: 'Fuga Enevoada', level: 6 }] },
  { name: 'O Grande Antigo', className: 'Bruxo', levelRequired: 1, features: ['Mente Desperta', { name: 'Proteção Entrópica', level: 6 }] },
  { name: 'Lâmina Maldita (Hexblade)', className: 'Bruxo', levelRequired: 1, features: ['Maldição da Lâmina Maldita', 'Guerreiro Maldito', { name: 'Espectro Amaldiçoado', level: 6 }] },
  { name: 'Domínio da Vida', className: 'Clérigo', levelRequired: 1, features: ['Discípulo da Vida', 'Proficiência com Armadura Pesada', { name: 'Preservar Vida', level: 2 }] },
  { name: 'Domínio da Luz', className: 'Clérigo', levelRequired: 1, features: ['Clarão Protetor', 'Truque de Luz', { name: 'Radiância do Amanhecer', level: 2 }] },
  { name: 'Domínio da Guerra', className: 'Clérigo', levelRequired: 1, features: ['Sacerdote da Guerra', 'Proficiências de Guerra', { name: 'Ataque Guiado', level: 2 }] },
  { name: 'Domínio da Tempestade', className: 'Clérigo', levelRequired: 1, features: ['Ira da Tempestade', 'Proficiências da Tempestade', { name: 'Ira Destrutiva', level: 2 }] },
  { name: 'Domínio da Trapaça', className: 'Clérigo', levelRequired: 1, features: ['Benção do Trapaceiro', { name: 'Invocar Duplicidade', level: 2 }] },
  { name: 'Círculo da Lua', className: 'Druida', levelRequired: 2, features: [{ name: 'Forma Selvagem de Combate', level: 2 }, { name: 'Formas do Círculo', level: 2 }, { name: 'Golpe Primal', level: 6 }] },
  { name: 'Círculo da Terra', className: 'Druida', levelRequired: 2, features: [{ name: 'Truque Bônus', level: 2 }, { name: 'Recuperação Natural', level: 2 }, { name: 'Magias do Círculo', level: 3 }, { name: 'Passo da Terra', level: 6 }] },
  { name: 'Círculo dos Esporos', className: 'Druida', levelRequired: 2, features: [{ name: 'Halo de Esporos', level: 2 }, { name: 'Entidade Simbiótica', level: 2 }, { name: 'Infestação Fúngica', level: 6 }] },
  { name: 'Linhagem Dracônica', className: 'Feiticeiro', levelRequired: 1, features: ['Ancestral Dracônico', 'Resiliência Dracônica', { name: 'Afinidade Elemental', level: 6 }] },
  { name: 'Magia Selvagem', className: 'Feiticeiro', levelRequired: 1, features: ['Surto de Magia Selvagem', 'Marés do Caos', { name: 'Dobrar Sorte', level: 6 }] },
  { name: 'Alma Divina', className: 'Feiticeiro', levelRequired: 1, features: ['Magia Divina', 'Favorecido pelos Deuses', { name: 'Cura Potencializada', level: 6 }] },
  { name: 'Mente Aberrante', className: 'Feiticeiro', levelRequired: 1, features: ['Magias Psiônicas', 'Discurso Telepático', { name: 'Defesas Psíquicas', level: 6 }] },
  { name: 'Campeão', className: 'Guerreiro', levelRequired: 3, features: [{ name: 'Crítico Aprimorado', level: 3 }, { name: 'Atleta Notável', level: 7 }] },
  { name: 'Mestre de Batalha', className: 'Guerreiro', levelRequired: 3, features: [{ name: 'Dados de Superioridade', level: 3 }, { name: 'Estudioso da Guerra', level: 3 }, { name: 'Ataque de Precisão', level: 3 }, { name: 'Ataque de Tropeço', level: 3 }, { name: 'Ataque Desarmante', level: 3 }, { name: 'Ataque Ameaçador', level: 3 }, { name: 'Ripostar', level: 3 }, { name: 'Ataque Empurrão', level: 3 }] },
  { name: 'Cavaleiro Arcano', className: 'Guerreiro', levelRequired: 3, features: [{ name: 'Conjuração de Cavaleiro Arcano', level: 3 }, { name: 'Arma Vinculada', level: 3 }, { name: 'Magia de Guerra', level: 7 }] },
  { name: 'Samurai', className: 'Guerreiro', levelRequired: 3, features: [{ name: 'Proficiência Bônus de Samurai', level: 3 }, { name: 'Espírito de Luta', level: 3 }, { name: 'Elegância Cortesã', level: 7 }] },
  { name: 'Assassino', className: 'Ladino', levelRequired: 3, features: [{ name: 'Assassinar', level: 3 }, { name: 'Proficiência com Disfarce e Veneno', level: 3 }] },
  { name: 'Ladrão', className: 'Ladino', levelRequired: 3, features: [{ name: 'Mãos Rápidas', level: 3 }, { name: 'Andarilho de Telhados', level: 3 }] },
  { name: 'Trapaceiro Arcano', className: 'Ladino', levelRequired: 3, features: [{ name: 'Conjuração de Trapaceiro Arcano', level: 3 }, { name: 'Mãos Mágicas Ardilosas', level: 3 }, { name: 'Emboscada Mágica', level: 9 }] },
  { name: 'Espadachim', className: 'Ladino', levelRequired: 3, features: [{ name: 'Jogo de Pés Elegante', level: 3 }, { name: 'Audácia Insolente', level: 3 }] },
  { name: 'Abjuração', className: 'Mago', levelRequired: 2, features: [{ name: 'Sábio em Abjuração', level: 2 }, { name: 'Proteção Arcana', level: 2 }, { name: 'Proteção Projetada', level: 6 }] },
  { name: 'Evocação', className: 'Mago', levelRequired: 2, features: [{ name: 'Sábio em Evocação', level: 2 }, { name: 'Esculpir Magias', level: 2 }, { name: 'Truque Potente', level: 6 }] },
  { name: 'Necromancia', className: 'Mago', levelRequired: 2, features: [{ name: 'Sábio em Necromancia', level: 2 }, { name: 'Colheita Sombria', level: 2 }, { name: 'Servos Mortos-Vivos', level: 6 }] },
  { name: 'Adivinhação', className: 'Mago', levelRequired: 2, features: [{ name: 'Sábio em Adivinhação', level: 2 }, { name: 'Presságio', level: 2 }, { name: 'Especialista em Adivinhação', level: 6 }] },
  { name: 'Ilusão', className: 'Mago', levelRequired: 2, features: [{ name: 'Sábio em Ilusão', level: 2 }, { name: 'Ilusão Menor Aprimorada', level: 2 }, { name: 'Ilusões Maleáveis', level: 6 }] },
  { name: 'Caminho da Mão Aberta', className: 'Monge', levelRequired: 3, features: [{ name: 'Técnica da Mão Aberta', level: 3 }, { name: 'Integridade Corporal', level: 6 }] },
  { name: 'Caminho das Sombras', className: 'Monge', levelRequired: 3, features: [{ name: 'Artes das Sombras', level: 3 }, { name: 'Passo das Sombras', level: 6 }] },
  { name: 'Caminho dos Quatro Elementos', className: 'Monge', levelRequired: 3, features: [{ name: 'Discípulo dos Elementos', level: 3 }, { name: 'Disciplinas Elementais', level: 3 }] },
  { name: 'Devoção', className: 'Paladino', levelRequired: 3, features: [{ name: 'Arma Sagrada', level: 3 }, { name: 'Expulsar Profano', level: 3 }, { name: 'Aura de Devoção', level: 7 }] },
  { name: 'Juramento dos Anciões', className: 'Paladino', levelRequired: 3, features: [{ name: 'Ira da Natureza', level: 3 }, { name: 'Expulsar Infiéis', level: 3 }, { name: 'Aura de Proteção Antiga', level: 7 }] },
  { name: 'Juramento de Vingança', className: 'Paladino', levelRequired: 3, features: [{ name: 'Inimigo Abjurado', level: 3 }, { name: 'Voto de Inimizade', level: 3 }, { name: 'Vingador Implacável', level: 7 }] },
  { name: 'Juramento de Conquista', className: 'Paladino', levelRequired: 3, features: [{ name: 'Presença Conquistadora', level: 3 }, { name: 'Golpe Guiado', level: 3 }, { name: 'Aura da Conquista', level: 7 }] },
  { name: 'Caçador', className: 'Patrulheiro', levelRequired: 3, features: [{ name: 'Presa do Caçador', level: 3 }, { name: 'Tática Defensiva', level: 7 }] },
  { name: 'Mestre das Bestas', className: 'Patrulheiro', levelRequired: 3, features: [{ name: 'Companheiro Animal', level: 3 }, { name: 'Treinamento Excepcional', level: 7 }] },
  { name: 'Andarilho do Horizonte', className: 'Patrulheiro', levelRequired: 3, features: [{ name: 'Detectar Portal', level: 3 }, { name: 'Guerreiro Planar', level: 3 }, { name: 'Passo Etéreo', level: 7 }] },
  { name: 'Alquimista', className: 'Artifice', levelRequired: 3, features: [{ name: 'Elixir Experimental', level: 3 }, { name: 'Savant Alquímico', level: 5 }] },
  { name: 'Armeiro', className: 'Artifice', levelRequired: 3, features: [{ name: 'Armadura Arcana (Armeiro)', level: 3 }, { name: 'Modelo Guardião', level: 3 }, { name: 'Ataque Extra', level: 5 }] },
  { name: 'Artilheiro', className: 'Artifice', levelRequired: 3, features: [{ name: 'Canhão Eldritch', level: 3 }, { name: 'Arma de Fogo Arcana', level: 5 }] },
  { name: 'Ferreiro de Batalha', className: 'Artifice', levelRequired: 3, features: [{ name: 'Pronto para Batalha', level: 3 }, { name: 'Defensor de Aço', level: 3 }, { name: 'Ataque Extra', level: 5 }] },
  { name: 'Ordem do Despertar', className: 'Mistico', levelRequired: 3, features: [{ name: 'Olho Psíquico', level: 3 }, { name: 'Mente Expandida', level: 3 }] },
  { name: 'Lamina Psiquica', className: 'Mistico', levelRequired: 3, features: [{ name: 'Lâmina Mental', level: 3 }, { name: 'Passo Imaterial', level: 3 }] },
  { name: 'Nomade Astral', className: 'Mistico', levelRequired: 3, features: [{ name: 'Salto Nômade', level: 3 }, { name: 'Memória de Mil Caminhos', level: 3 }] },
  { name: 'Cavaleiro Runico', className: 'Guerreiro', levelRequired: 3, features: [{ name: 'Runas de Gigante', level: 3 }, { name: 'Poder dos Gigantes', level: 3 }] },
  { name: 'Colegio do Glamour', className: 'Bardo', levelRequired: 3, features: [{ name: 'Manto de Inspiração', level: 3 }, { name: 'Performance Encantadora', level: 3 }] },
  { name: 'Batedor', className: 'Ladino', levelRequired: 3, features: [{ name: 'Escaramuça', level: 3 }, { name: 'Sobrevivente Nato', level: 3 }] },
  { name: 'Alma Solar', className: 'Monge', levelRequired: 3, features: [{ name: 'Raio Solar Radiante', level: 3 }, { name: 'Arcos Solares', level: 6 }] },
  { name: 'Perseguidor Sombrio', className: 'Patrulheiro', levelRequired: 3, features: [{ name: 'Emboscador Sombrio', level: 3 }, { name: 'Visão Umbral', level: 3 }] },
  { name: 'Juramento da Redencao', className: 'Paladino', levelRequired: 3, features: [{ name: 'Emissário da Paz', level: 3 }, { name: 'Repreender Violento', level: 3 }] },
];

const FEATURE_CATEGORY_OVERRIDES: Record<string, BaseFeatureSpellRepair['category']> = {
  'Fúria': 'Habilidade',
  'Sopro Dracônico': 'Habilidade',
  'Mãos Curativas': 'Habilidade',
  'Taumaturgia': 'Magia',
  'Mãos Mágicas (Githyanki)': 'Magia',
  'Truque de Alto Elfo': 'Magia',
  'Magia Drow: Globos de Luz': 'Magia',
  'Magia Drow: Fogo das Fadas': 'Magia',
  'Magia Drow: Escuridão': 'Magia',
  'Legado Infernal: Repreensão Infernal': 'Magia',
  'Legado Infernal: Escuridão': 'Magia',
  'Legado Githyanki: Aprimorar Salto': 'Magia',
  'Legado Githyanki: Passo Nebuloso': 'Magia',
  'Inspiração Bárdica': 'Habilidade',
  'Forma Selvagem': 'Habilidade',
  'Forma Selvagem Aprimorada': 'Habilidade',
  'Segundo Fôlego': 'Habilidade',
  'Surto de Ação': 'Habilidade',
  'Imposição das Mãos': 'Habilidade',
  'Sentido Divino': 'Habilidade',
  'Golpe Divino': 'Habilidade',
  'Canalizar Divindade': 'Habilidade',
  'Ki': 'Habilidade',
  'Ataque Atordoante': 'Habilidade',
  'Frenesi': 'Habilidade',
  'Palavras Cortantes': 'Habilidade',
  'Presença Feérica': 'Habilidade',
  'Clarão Protetor': 'Habilidade',
  'Ira da Tempestade': 'Habilidade',
  'Forma Selvagem de Combate': 'Habilidade',
  'Surto de Magia Selvagem': 'Habilidade',
  'Ataque de Precisão': 'Habilidade',
  'Ataque de Tropeço': 'Habilidade',
  'Ataque Desarmante': 'Habilidade',
  'Ataque Ameaçador': 'Habilidade',
  'Espírito de Luta': 'Habilidade',
  'Assassinar': 'Habilidade',
  'Mãos Rápidas': 'Habilidade',
  'Presságio': 'Habilidade',
  'Arma Sagrada': 'Habilidade',
  'Inimigo Abjurado': 'Habilidade',
  'Voto de Inimizade': 'Habilidade',
  'Companheiro Animal': 'Habilidade',
  'Guerreiro Planar': 'Habilidade',
  'Elixir Experimental': 'Habilidade',
  'Canhão Eldritch': 'Habilidade',
  'Passo Imaterial': 'Habilidade',
};

const BASE_SPELL_NAME_REPAIRS = [
  { from: 'Ataque Descuidado', to: 'Ataque Imprudente' },
  { from: 'Ação Surto', to: 'Surto de Ação' },
  { from: 'Ver o Futuro', to: 'Presságio' },
  { from: 'Cavaleiro Arcano: Arma Vinculada', to: 'Arma Vinculada' },
  { from: 'Juramento de Devoção: Arma Sagrada', to: 'Arma Sagrada' },
  { from: 'Juramento de Vingança: Inimigo Abjurado', to: 'Inimigo Abjurado' },
  { from: 'Mestre de Batalha: Ripostar', to: 'Ripostar' },
  { from: 'Mestre de Batalha: Ataque Empurrão', to: 'Ataque Empurrão' },
  { from: 'Aura de Protecao', to: 'Aura de Proteção' },
];

const BASE_FEATURE_SPELL_DETAILS: Record<string, Partial<BaseFeatureSpellRepair>> = {
  'Fúria': {
    category: 'Habilidade',
    castingTime: '1 Ação Bônus',
    range: 'Pessoal',
    duration: '1 Minuto',
    damageDice: '+2 Dano',
    damageType: 'Extra',
    description: 'Entra em fúria, ganhando bônus de dano corpo a corpo com Força e resistência a dano físico comum.',
    forceUpdate: true,
  },
  'Inspiração Bárdica': {
    category: 'Habilidade',
    castingTime: '1 Ação Bônus',
    range: '18m',
    duration: '10 Minutos',
    damageDice: '1d6',
    damageType: 'Suporte',
    description: 'Concede um dado de inspiração para aliado somar a teste, ataque ou resistência.',
    forceUpdate: true,
  },
  'Ataque Furtivo': {
    category: 'Habilidade',
    castingTime: 'Ao acertar',
    range: 'Arma',
    duration: 'Instantânea',
    damageDice: '1d6+',
    damageType: 'Extra',
    description: 'Uma vez por turno, causa dano extra se tiver vantagem ou aliado adjacente ao alvo.',
    forceUpdate: true,
  },
  'Forma Selvagem': {
    category: 'Habilidade',
    castingTime: '1 Ação',
    range: 'Pessoal',
    duration: 'Horas',
    damageDice: '-',
    damageType: 'Transformação',
    description: 'Assume a forma de uma fera conhecida, usando usos da Forma Selvagem.',
    forceUpdate: true,
  },
  'Segundo Fôlego': {
    category: 'Habilidade',
    castingTime: '1 Ação Bônus',
    range: 'Pessoal',
    duration: 'Instantânea',
    damageDice: '1d10 + nível',
    damageType: 'Cura',
    description: 'Recupera pontos de vida uma vez por descanso curto ou longo.',
    forceUpdate: true,
  },
  'Surto de Ação': {
    category: 'Habilidade',
    castingTime: 'Livre',
    range: 'Pessoal',
    duration: 'Turno atual',
    damageDice: '+1 Ação',
    damageType: 'Ação',
    description: 'Ganha uma ação adicional no turno uma vez por descanso curto ou longo.',
    forceUpdate: true,
  },
  'Ki': {
    category: 'Habilidade',
    castingTime: 'Especial',
    range: 'Pessoal',
    duration: 'Variável',
    damageDice: 'Pontos de Ki',
    damageType: 'Recurso',
    description: 'Usa pontos de Ki para técnicas como Rajada de Golpes, Defesa Paciente e Passo do Vento.',
    forceUpdate: true,
  },
  'Ataque Atordoante': {
    category: 'Habilidade',
    castingTime: 'Ao acertar',
    range: 'Corpo a corpo',
    duration: '1 Rodada',
    damageDice: '1 Ki',
    damageType: 'Controle',
    savingThrow: 'CON',
    description: 'Ao acertar ataque corpo a corpo com arma, gasta Ki para tentar atordoar o alvo.',
    forceUpdate: true,
  },
  'Sentido Divino': {
    category: 'Habilidade',
    castingTime: '1 Ação',
    range: '18m',
    duration: 'Até fim do próximo turno',
    damageDice: '-',
    damageType: 'Detecção',
    description: 'Detecta celestiais, corruptores, mortos-vivos e locais/objetos consagrados ou profanados próximos.',
    forceUpdate: true,
  },
  'Imposição das Mãos': {
    category: 'Habilidade',
    castingTime: '1 Ação',
    range: 'Toque',
    duration: 'Instantânea',
    damageDice: '5 x nível',
    damageType: 'Cura',
    description: 'Reserva de cura igual a 5 vezes o nível de Paladino; também pode remover doença ou veneno.',
    forceUpdate: true,
  },
  'Conjuração de Paladino': {
    category: 'Passiva',
    castingTime: 'Passiva',
    range: 'Pessoal',
    duration: 'Permanente',
    damageDice: 'Espaços',
    damageType: 'Magia',
    description: 'Permite preparar e conjurar magias de Paladino usando Carisma.',
    forceUpdate: true,
  },
  'Golpe Divino': {
    level: 'Nível 2',
    category: 'Habilidade',
    castingTime: 'Após acertar',
    range: 'Arma',
    duration: 'Instantânea',
    damageDice: '2d8 + 1d8/nível',
    damageType: 'Radiante',
    description: 'Ao acertar com arma corpo a corpo, gasta um espaço de magia para causar dano radiante extra. +1d8 por nível do espaço acima do 1º.',
    forceUpdate: true,
  },
  'Juramento Sagrado': {
    category: 'Passiva',
    castingTime: 'Passiva',
    range: 'Pessoal',
    duration: 'Permanente',
    damageDice: 'Subclasse',
    damageType: 'Juramento',
    description: 'Escolhe um juramento de Paladino e desbloqueia poderes de Canalizar Divindade e magias de juramento.',
    forceUpdate: true,
  },
  'Aura de Proteção': {
    level: 'Nível 6',
    category: 'Passiva',
    castingTime: 'Passiva',
    range: '3m',
    duration: 'Permanente',
    damageDice: '+CAR',
    damageType: 'Defesa',
    savingThrow: 'Todos',
    description: 'Você e aliados próximos somam seu modificador de Carisma aos testes de resistência.',
    forceUpdate: true,
  },
  'Aura de Coragem': {
    level: 'Nível 10',
    category: 'Passiva',
    castingTime: 'Passiva',
    range: '3m',
    duration: 'Permanente',
    damageDice: '-',
    damageType: 'Defesa',
    description: 'Você e aliados próximos não podem ficar amedrontados enquanto você estiver consciente.',
    forceUpdate: true,
  },
  'Golpe Divino Aprimorado': {
    level: 'Nível 11',
    category: 'Passiva',
    castingTime: 'Passiva',
    range: 'Arma',
    duration: 'Permanente',
    damageDice: '+1d8',
    damageType: 'Radiante',
    description: 'Seus ataques corpo a corpo com arma causam 1d8 de dano radiante extra.',
    forceUpdate: true,
  },
  'Toque Purificador': {
    level: 'Nível 14',
    category: 'Habilidade',
    castingTime: '1 Ação',
    range: 'Toque',
    duration: 'Instantânea',
    damageDice: 'Encerrar magia',
    damageType: 'Suporte',
    description: 'Encerra uma magia em você ou em uma criatura voluntária tocada.',
    forceUpdate: true,
  },
};

function featureLevelToSpellLevel(level: number) {
  if (level <= 0) return 'Passiva';
  return level === 1 ? 'Nível 1' : `Nível ${level}`;
}

function featureSourceClasses(sourceType: 'race' | 'class' | 'subclass', sourceName: string, className?: string) {
  if (sourceType === 'race') return `Raça,${sourceName}`;
  if (sourceType === 'subclass') return [className, sourceName].filter(Boolean).join(',');
  return sourceName;
}

function mergeCommaList(...values: (string | null | undefined)[]) {
  const merged = new Set<string>();
  values.forEach(value => {
    String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => merged.add(item));
  });
  return Array.from(merged).join(',');
}

function parsePositiveLevel(value: unknown, fallback = 1) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseBaseFeatureDetail(existing: unknown, replacement: unknown, genericValues: string[] = []) {
  const existingText = String(existing ?? '').trim();
  const replacementText = String(replacement ?? '').trim();
  if (!replacementText) return existingText;
  if (!existingText || genericValues.includes(existingText)) return replacementText;
  return existingText;
}

function isGenericFeatureDescription(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || text.includes('concedida por');
}

function makeFeatureSpellRepair(
  feature: FeatureRequirementSeed,
  sourceType: 'race' | 'class' | 'subclass',
  sourceName: string,
  className?: string
): BaseFeatureSpellRepair {
  const normalizedFeature = typeof feature === 'string'
    ? { name: feature, level: 1, spellLevel: undefined as string | undefined }
    : { name: feature.name, level: feature.level || 1, spellLevel: feature.spellLevel };
  const details = BASE_FEATURE_SPELL_DETAILS[normalizedFeature.name] || {};
  const category = details.category || FEATURE_CATEGORY_OVERRIDES[normalizedFeature.name] || 'Passiva';
  return {
    name: normalizedFeature.name,
    level: details.level || normalizedFeature.spellLevel || (category === 'Magia' && normalizedFeature.level === 1 ? 'Truque' : featureLevelToSpellLevel(normalizedFeature.level)),
    category,
    classes: featureSourceClasses(sourceType, sourceName, className),
    castingTime: details.castingTime || (category === 'Passiva' ? 'Passiva' : 'Especial'),
    range: details.range || (category === 'Passiva' ? 'Pessoal' : 'Variável'),
    components: details.components || (category === 'Magia' ? 'V, S' : '-'),
    duration: details.duration || (category === 'Passiva' ? 'Permanente' : 'Variável'),
    damageDice: details.damageDice || '-',
    damageType: details.damageType || 'Outro',
    savingThrow: details.savingThrow || 'Nenhum',
    description: details.description || `${category} concedida por ${sourceName}.`,
    classLevelRequired: normalizedFeature.level,
    forceUpdate: details.forceUpdate,
  };
}

async function repairLegacyBaseSpellNames(db: SQLiteDatabase) {
  for (const repair of BASE_SPELL_NAME_REPAIRS) {
    const oldSpell = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM spells WHERE name = ? AND IFNULL(criador, 'base') = 'base' LIMIT 1`,
      [repair.from]
    );
    if (!oldSpell?.id) continue;

    const targetSpell = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM spells WHERE name = ? AND IFNULL(criador, 'base') = 'base' LIMIT 1`,
      [repair.to]
    );

    if (targetSpell?.id) {
      await db.runAsync(
        `DELETE FROM spells WHERE name = ? AND IFNULL(criador, 'base') = 'base'`,
        [repair.from]
      );
    } else {
      await db.runAsync(
        `UPDATE spells SET name = ? WHERE name = ? AND IFNULL(criador, 'base') = 'base'`,
        [repair.to, repair.from]
      );
    }
  }
}

async function upsertBaseFeatureSpell(db: SQLiteDatabase, spell: BaseFeatureSpellRepair) {
  const existing = await db.getFirstAsync<{
    id: number;
    level?: string | null;
    category?: string | null;
    classes?: string | null;
    casting_time?: string | null;
    range?: string | null;
    components?: string | null;
    duration?: string | null;
    damage_dice?: string | null;
    damage_type?: string | null;
    saving_throw?: string | null;
    description?: string | null;
    class_level_required?: string | number | null;
  }>(
    `SELECT id, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type,
            saving_throw, description, class_level_required
     FROM spells
     WHERE name = ? AND IFNULL(criador, 'base') = 'base'
     LIMIT 1`,
    [spell.name]
  );

  if (existing?.id) {
    const existingCategory = existing.category || spell.category;
    const finalCategory = existingCategory === 'Magia' || spell.category === 'Magia' ? 'Magia' : existingCategory === 'Habilidade' || spell.category === 'Habilidade' ? 'Habilidade' : 'Passiva';
    const finalRequiredLevel = Math.min(parsePositiveLevel(existing.class_level_required, spell.classLevelRequired), spell.classLevelRequired);
    const useDetail = Boolean(spell.forceUpdate);

    await db.runAsync(
      `UPDATE spells
       SET level = ?, category = ?, classes = ?, casting_time = ?, range = ?, components = ?, duration = ?,
           damage_dice = ?, damage_type = ?, saving_throw = ?, description = ?, class_level_required = ?,
           criador = 'base'
       WHERE name = ? AND IFNULL(criador, 'base') = 'base'`,
      [
        useDetail ? spell.level : shouldUseBaseFeatureDetail(existing.level, spell.level),
        finalCategory,
        mergeCommaList(existing.classes, spell.classes),
        useDetail ? (spell.castingTime || 'Especial') : shouldUseBaseFeatureDetail(existing.casting_time, spell.castingTime || 'Especial', ['Especial']),
        useDetail ? (spell.range || 'Pessoal') : shouldUseBaseFeatureDetail(existing.range, spell.range || 'Pessoal', ['Variável']),
        useDetail ? (spell.components || '-') : shouldUseBaseFeatureDetail(existing.components, spell.components || '-'),
        useDetail ? (spell.duration || 'Variável') : shouldUseBaseFeatureDetail(existing.duration, spell.duration || 'Variável', ['Variável']),
        useDetail ? (spell.damageDice || '-') : shouldUseBaseFeatureDetail(existing.damage_dice, spell.damageDice || '-', ['-', '2d8+']),
        useDetail ? (spell.damageType || 'Outro') : shouldUseBaseFeatureDetail(existing.damage_type, spell.damageType || 'Outro', ['Outro']),
        useDetail ? (spell.savingThrow || 'Nenhum') : shouldUseBaseFeatureDetail(existing.saving_throw, spell.savingThrow || 'Nenhum', ['Nenhum']),
        useDetail || isGenericFeatureDescription(existing.description) ? spell.description : (existing.description || spell.description),
        String(finalRequiredLevel),
        spell.name,
      ]
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO spells
     (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, class_level_required, criador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
    [
      spell.name,
      spell.level,
      spell.category,
      spell.classes,
      spell.castingTime || 'Especial',
      spell.range || 'Pessoal',
      spell.components || '-',
      spell.duration || 'Variável',
      spell.damageDice || '-',
      spell.damageType || 'Outro',
      spell.savingThrow || 'Nenhum',
      spell.description,
      String(spell.classLevelRequired),
    ]
  );
}

async function repairBaseRulesCatalog(db: SQLiteDatabase) {
  await repairLegacyBaseSpellNames(db);

  for (const race of BASE_RACE_FEATURE_REPAIRS) {
    await db.runAsync(
      `UPDATE races SET features = ?, criador = 'base' WHERE name = ? AND IFNULL(criador, 'base') = 'base'`,
      [normalizeFeatureRequirements(race.features), race.name]
    );

    for (const feature of race.features) {
      await upsertBaseFeatureSpell(db, makeFeatureSpellRepair(feature, 'race', race.name));
    }
  }

  for (const charClass of BASE_CLASS_FEATURE_REPAIRS) {
    await db.runAsync(
      `UPDATE classes SET features = ?, criador = 'base' WHERE name = ? AND IFNULL(criador, 'base') = 'base'`,
      [normalizeFeatureRequirements(charClass.features), charClass.name]
    );

    for (const feature of charClass.features) {
      await upsertBaseFeatureSpell(db, makeFeatureSpellRepair(feature, 'class', charClass.name));
    }
  }

  for (const subclass of BASE_SUBCLASS_FEATURE_REPAIRS) {
    const payload = normalizeFeatureRequirements(subclass.features);
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM subclasses WHERE name = ? AND class_name = ? AND IFNULL(criador, 'base') = 'base' LIMIT 1`,
      [subclass.name, subclass.className]
    );

    if (existing?.id) {
      await db.runAsync(
        `UPDATE subclasses
         SET level_required = ?, features = ?, criador = 'base'
         WHERE name = ? AND class_name = ? AND IFNULL(criador, 'base') = 'base'`,
        [subclass.levelRequired, payload, subclass.name, subclass.className]
      );
    } else {
      await db.runAsync(
        `INSERT INTO subclasses (name, class_name, level_required, features, criador) VALUES (?, ?, ?, ?, 'base')`,
        [subclass.name, subclass.className, subclass.levelRequired, payload]
      );
    }

    for (const feature of subclass.features) {
      await upsertBaseFeatureSpell(db, makeFeatureSpellRepair(feature, 'subclass', subclass.name, subclass.className));
    }
  }
}

const EXPANDED_RACES = [
  { name: 'Aasimar', statBonuses: '{"CAR": 2, "SAB": 1}', speed: '9m', features: ['Visao no Escuro', 'Resistencia Celestial', 'Maos Curativas'] },
  { name: 'Genasi do Fogo', statBonuses: '{"CON": 2, "INT": 1}', speed: '9m', features: ['Visao no Escuro', 'Resistencia a Fogo', 'Chama Inata'] },
  { name: 'Tabaxi', statBonuses: '{"DES": 2, "CAR": 1}', speed: '9m', features: ['Agilidade Felina', 'Garras', 'Talento Felino'] },
  { name: 'Firbolg', statBonuses: '{"SAB": 2, "FOR": 1}', speed: '9m', features: ['Magia Firbolg', 'Passo Oculto', 'Fala com Feras e Plantas'] },
  { name: 'Kenku', statBonuses: '{"DES": 2, "SAB": 1}', speed: '9m', features: ['Mimetismo', 'Treinamento Kenku', 'Memoria de Perito'] },
  { name: 'Kobold', statBonuses: '{"DES": 2}', speed: '9m', features: ['Tatica de Matilha', 'Grito Draconico', 'Visao no Escuro'] },
  { name: 'Tritao', statBonuses: '{"FOR": 1, "CON": 1, "CAR": 1}', speed: '9m / nado 9m', features: ['Anfibio', 'Controle do Ar e Agua', 'Guardiao das Profundezas'] },
  { name: 'Shadar-kai', statBonuses: '{"DES": 2, "CON": 1}', speed: '9m', features: ['Resistencia Necrotica', 'Bencao da Rainha Corvo', 'Visao no Escuro'] },
];

const EXPANDED_CLASSES = [
  {
    name: 'Artifice',
    recommendedStats: '{"INT": 15, "CON": 14, "DES": 13, "SAB": 12, "FOR": 10, "CAR": 8}',
    startingEquipment: '[{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1},{"name":"Ferramentas de Ferreiro","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1}]',
    startingGold: 15,
    hitDice: 8,
    saves: '["save_con", "save_int"]',
    subclassLevel: 3,
    isCaster: 1,
    features: ['Infusoes Magicas', 'Conjuracao por Ferramentas'],
  },
  {
    name: 'Mistico',
    recommendedStats: '{"INT": 15, "DES": 14, "CON": 13, "SAB": 12, "CAR": 10, "FOR": 8}',
    startingEquipment: '[{"name":"Adaga","qty":2},{"name":"Cristal Psiquico","qty":1},{"name":"Roupas de Viagem","qty":1},{"name":"Livro","qty":1}]',
    startingGold: 10,
    hitDice: 8,
    saves: '["save_int", "save_sab"]',
    subclassLevel: 3,
    isCaster: 1,
    features: ['Talento Psionico', 'Disciplina Mental'],
  },
];

const EXPANDED_SUBCLASSES = [
  { name: 'Alquimista', className: 'Artifice', levelRequired: 3, features: ['Elixir Experimental', 'Savant Alquimico'] },
  { name: 'Armeiro', className: 'Artifice', levelRequired: 3, features: ['Armadura Arcana', 'Modelo Guardiao'] },
  { name: 'Artilheiro', className: 'Artifice', levelRequired: 3, features: ['Canhao Eldritch', 'Arma de Fogo Arcana'] },
  { name: 'Ferreiro de Batalha', className: 'Artifice', levelRequired: 3, features: ['Defensor de Aco', 'Pronto para Batalha'] },
  { name: 'Ordem do Despertar', className: 'Mistico', levelRequired: 3, features: ['Olho Psiquico', 'Mente Expandida'] },
  { name: 'Lamina Psiquica', className: 'Mistico', levelRequired: 3, features: ['Lamina Mental', 'Passo Imaterial'] },
  { name: 'Nomade Astral', className: 'Mistico', levelRequired: 3, features: ['Salto Nomade', 'Memoria de Mil Caminhos'] },
  { name: 'Cavaleiro Runico', className: 'Guerreiro', levelRequired: 3, features: ['Runas de Gigante', 'Poder dos Gigantes'] },
  { name: 'Colegio do Glamour', className: 'Bardo', levelRequired: 3, features: ['Manto de Inspiracao', 'Performance Encantadora'] },
  { name: 'Batedor', className: 'Ladino', levelRequired: 3, features: ['Escaramuca', 'Sobrevivente Nato'] },
  { name: 'Alma Solar', className: 'Monge', levelRequired: 3, features: ['Raio Solar Radiante', 'Arcos Solares'] },
  { name: 'Perseguidor Sombrio', className: 'Patrulheiro', levelRequired: 3, features: ['Emboscador Sombrio', 'Visao Umbral'] },
  { name: 'Juramento da Redencao', className: 'Paladino', levelRequired: 3, features: ['Emissario da Paz', 'Repreender Violento'] },
];

const EXPANDED_ITEMS: ExpandedItemSeed[] = [
  { name: 'Cristal Psiquico', weight: 0.1, damage: '-', damageType: '-', category: 'Foco', isConsumable: 0, properties: 'Foco Psiquico', descricao: 'Cristal que vibra com pensamentos intensos e serve como foco para disciplinas mentais.' },
  { name: 'Ferramentas de Inventor', weight: 2.0, damage: '-', damageType: '-', category: 'Ferramenta', isConsumable: 0, properties: 'Ferramenta, Prototipos', descricao: 'Pequeno estojo com molas, lentes, pincoes, fios e chaves finas.' },
  { name: 'Kit de Alquimia', weight: 4.0, damage: '-', damageType: '-', category: 'Ferramenta', isConsumable: 0, properties: 'Ferramenta, Alquimia', descricao: 'Conjunto de frascos, queimadores e reagentes para preparar misturas instaveis.' },
  { name: 'Repetidor Leve', weight: 2.5, damage: '1d8', damageType: 'Perfurante', category: 'Arma', isConsumable: 0, properties: 'Arma, Municao (24/96m), Recarga, Duas maos', descricao: 'Besta refinada com mecanismo de recarga rapida.' },
  { name: 'Martelo Runico', weight: 2.0, damage: '1d8', damageType: 'Concussao', category: 'Arma', isConsumable: 0, properties: 'Arma, Versatil (1d10), Runico', descricao: 'Martelo gravado com runas antigas, comum entre ferreiros arcanos.' },
  { name: 'Lamina Psiquica', weight: 0.0, damage: '1d6', damageType: 'Psiquico', category: 'Arma', isConsumable: 0, properties: 'Arma, Acuidade, Manifestada', descricao: 'Arma mental que surge na mao do usuario e some apos o golpe.' },
  { name: 'Escudo Dobraveloz', weight: 2.5, damage: '-', damageType: '-', category: 'Escudo', isConsumable: 0, properties: 'Escudo, CA +2, Dobraveloz', descricao: 'Escudo articulado que se prende ao antebraco e abre com um estalo.' },
  { name: 'Armadura de Malha Reforcada', weight: 18.0, damage: '-', damageType: '-', category: 'Armadura', isConsumable: 0, properties: 'Armadura, CA 15, Desv. Furtividade', descricao: 'Malha reforcada com placas pequenas, criada para exploradores resistentes.' },
  { name: 'Oculos de Precisao', weight: 0.1, damage: '-', damageType: '-', category: 'Ferramenta', isConsumable: 0, properties: 'Ferramenta, Investigacao, Percepcao', descricao: 'Lentes ajustaveis que ajudam a examinar detalhes minusculos.' },
  { name: 'Granada de Fumaca', weight: 0.5, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Arremesso, Nuvem', descricao: 'Capsula que cria uma nuvem densa de fumaca por alguns turnos.' },
  { name: 'Bomba de Trovao', weight: 0.5, damage: '2d6', damageType: 'Trovejante', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Arremesso, Area', descricao: 'Explosivo pequeno que estoura com som ensurdecedor.' },
  { name: 'Tonica de Foco', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Concentração', descricao: 'Mistura amarga que ajuda a manter a mente firme por alguns minutos.' },
  { name: 'Pocao de Escalada', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Movimento', descricao: 'Liquido viscoso que facilita escalar paredes e rochas.' },
  { name: 'Pocao de Respiracao Aquatica', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Aquatico', descricao: 'Permite respirar embaixo da agua por tempo limitado.' },
  { name: 'Poção de Invisibilidade', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Furtividade', descricao: 'Torna quem bebe invisivel por ate 1 hora, ou ate atacar/conjurar conforme regra da mesa.' },
  { name: 'Poção de Força do Gigante da Colina', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Forca', descricao: 'Define a Forca de quem bebe como 21 por 1 hora.' },
  { name: 'Poção de Velocidade', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Movimento', descricao: 'Acelera quem bebe por 1 minuto, aumentando defesa, movimento e ritmo de acoes conforme regra da mesa.' },
  { name: 'Poção de Voo', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Movimento', descricao: 'Concede deslocamento de voo por 1 hora.' },
  { name: 'Poção de Heroísmo', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Coragem', descricao: 'Concede heroismo por 1 hora: vigor temporario e resistencia a medo conforme regra da mesa.' },
  { name: 'Poção de Resistência ao Fogo', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Resistencia', descricao: 'Concede resistencia contra dano de fogo por 1 hora.' },
  { name: 'Poção de Resistência ao Frio', weight: 0.25, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Resistencia', descricao: 'Concede resistencia contra dano de frio por 1 hora.' },
  { name: 'Poção de Crescimento', weight: 0.25, damage: '+1d4', damageType: 'Extra', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magico, Tamanho', descricao: 'Aumenta o tamanho por 1 hora e adiciona 1d4 ao dano com arma enquanto durar.' },
  { name: 'Pergaminho de Reparar', weight: 0.0, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho', descricao: 'Pergaminho simples que repara um objeto pequeno danificado.' },
  { name: 'Pergaminho de Sono', weight: 0.0, damage: '5d8', damageType: 'Outro', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho', descricao: 'Pergaminho que libera uma onda sonolenta sobre criaturas proximas.' },
  { name: 'Pergaminho de Misseis Magicos', weight: 0.0, damage: '3d4+3', damageType: 'Forca', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Nivel 1', descricao: 'Permite conjurar Misseis Magicos uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Bola de Fogo', weight: 0.0, damage: '8d6', damageType: 'Fogo', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Nivel 3, Area', descricao: 'Permite conjurar Bola de Fogo uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Curar Ferimentos', weight: 0.0, damage: 'Cura 1d8', damageType: 'Cura', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Cura, Nivel 1', descricao: 'Permite conjurar Curar Ferimentos uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Armadura Arcana', weight: 0.0, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, CA, Nivel 1', descricao: 'Permite conjurar Armadura Arcana uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Invisibilidade', weight: 0.0, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Invisibilidade, Nivel 2', descricao: 'Permite conjurar Invisibilidade uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Escudo Arcano', weight: 0.0, damage: '-', damageType: '-', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Reacao, CA, Nivel 1', descricao: 'Permite conjurar Escudo Arcano uma vez, consumindo o pergaminho.' },
  { name: 'Pergaminho de Relampago', weight: 0.0, damage: '8d6', damageType: 'Eletrico', category: 'Consumivel', isConsumable: 1, properties: 'Consumivel, Magia, Pergaminho, Linha, Nivel 3', descricao: 'Permite conjurar Relampago uma vez, consumindo o pergaminho.' },
  { name: 'Talismã Celestial', weight: 0.1, damage: '-', damageType: '-', category: 'Foco', isConsumable: 0, properties: 'Amuleto, Foco Divino', descricao: 'Pequeno simbolo banhado em prata usado por devotos celestiais.' },
  { name: 'Manto Umbral', weight: 1.0, damage: '-', damageType: '-', category: 'Vestuario', isConsumable: 0, properties: 'Capa, Furtividade, Sombras', descricao: 'Manto escuro que parece absorver parte da luz ao redor.' },
  { name: 'Anzol de Adamante', weight: 0.2, damage: '-', damageType: '-', category: 'Ferramenta', isConsumable: 0, properties: 'Ferramenta, Escalada, Pesca', descricao: 'Anzol robusto usado tanto para pesca perigosa quanto para escalada improvisada.' },
  { name: 'Bolsa Dimensional Pequena', weight: 0.5, damage: '-', damageType: '-', category: 'Carga', isConsumable: 0, properties: 'Mochila/Saco, Magico, Capacidade extra', descricao: 'Bolsa modesta com interior maior do que aparenta.' },
];

const EXPANDED_SPELLS: ExpandedSpellSeed[] = [
  { name: 'Lamina Estrondosa', level: 'Truque', category: 'Magia', classes: 'Artifice,Bruxo,Feiticeiro,Mago', castingTime: '1 Acao', range: 'Arma', components: 'S, M', duration: '1 Rodada', damageDice: '1d8', damageType: 'Trovejante', savingThrow: 'Nenhum', description: 'Ataque com arma envolto em energia sonora; se o alvo se mover, sofre dano.', classLevelRequired: 1 },
  { name: 'Lamina de Chamas Verdes', level: 'Truque', category: 'Magia', classes: 'Artifice,Bruxo,Feiticeiro,Mago', castingTime: '1 Acao', range: 'Arma', components: 'S, M', duration: 'Instantanea', damageDice: '1d8', damageType: 'Fogo', savingThrow: 'Nenhum', description: 'Ataque com arma espalha chama para um inimigo proximo.', classLevelRequired: 1 },
  { name: 'Moldar Terra', level: 'Truque', category: 'Magia', classes: 'Druida,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: '9m', components: 'S', duration: 'Instantanea', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Move ou molda terra solta em uma area pequena.', classLevelRequired: 1 },
  { name: 'Controlar Chamas', level: 'Truque', category: 'Magia', classes: 'Druida,Feiticeiro,Mago,Genasi do Fogo', castingTime: '1 Acao', range: '18m', components: 'S', duration: '1 Hora', damageDice: '-', damageType: 'Fogo', savingThrow: 'Nenhum', description: 'Expande, apaga ou altera chamas pequenas.', classLevelRequired: 1 },
  { name: 'Criar Fogueira', level: 'Truque', category: 'Magia', classes: 'Druida,Bruxo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Concentracao', damageDice: '1d8', damageType: 'Fogo', savingThrow: 'DES', description: 'Cria uma fogueira magica que queima quem ocupa o espaco.', classLevelRequired: 1 },
  { name: 'Fragmento Mental', level: 'Truque', category: 'Magia', classes: 'Bruxo,Feiticeiro,Mago,Mistico', castingTime: '1 Acao', range: '18m', components: 'V', duration: '1 Rodada', damageDice: '1d6', damageType: 'Psiquico', savingThrow: 'INT', description: 'Estilhaço psiquico causa dano e atrapalha o proximo teste do alvo.', classLevelRequired: 1 },
  { name: 'Pulso Magnetico', level: 'Truque', category: 'Magia', classes: 'Artifice,Mago', castingTime: '1 Acao', range: '9m', components: 'S, M', duration: 'Instantanea', damageDice: '1d6', damageType: 'Forca', savingThrow: 'FOR', description: 'Empurra ou puxa um objeto metalico leve ou criatura pequena.', classLevelRequired: 1 },
  { name: 'Visao no Escuro', level: 'Passiva', category: 'Passiva', classes: 'Raça', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Enxerga melhor em penumbra e escuridao conforme regra da mesa.', classLevelRequired: 1 },
  { name: 'Resistencia Celestial', level: 'Passiva', category: 'Passiva', classes: 'Aasimar', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Resistencia a dano radiante e necrotico.', classLevelRequired: 1 },
  { name: 'Maos Curativas', level: 'Nível 1', category: 'Habilidade', classes: 'Aasimar', castingTime: '1 Acao', range: 'Toque', components: '-', duration: 'Instantanea', damageDice: 'Nivel', damageType: 'Cura', savingThrow: 'Nenhum', description: 'Toca uma criatura e cura uma pequena quantidade baseada no nivel.', classLevelRequired: 1 },
  { name: 'Chama Inata', level: 'Truque', category: 'Magia', classes: 'Genasi do Fogo', castingTime: '1 Acao', range: '18m', components: 'S', duration: 'Instantanea', damageDice: '1d8', damageType: 'Fogo', savingThrow: 'DES', description: 'Manipula chama elemental herdada da linhagem genasi.', classLevelRequired: 1 },
  { name: 'Agilidade Felina', level: 'Passiva', category: 'Passiva', classes: 'Tabaxi', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: 'Movimento', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Pode dobrar deslocamento por um turno antes de precisar recuperar o folego.', classLevelRequired: 1 },
  { name: 'Mimetismo', level: 'Passiva', category: 'Passiva', classes: 'Kenku', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Imita sons e vozes que ja ouviu.', classLevelRequired: 1 },
  { name: 'Tatica de Matilha', level: 'Passiva', category: 'Passiva', classes: 'Kobold', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: 'Vantagem', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Recebe vantagem quando um aliado ameaca o mesmo alvo.', classLevelRequired: 1 },
  { name: 'Passo Oculto', level: 'Nível 1', category: 'Habilidade', classes: 'Firbolg', castingTime: '1 Acao Bonus', range: 'Pessoal', components: '-', duration: '1 Turno', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Fica invisivel brevemente ate atacar, conjurar ou forcar um teste.', classLevelRequired: 1 },
  { name: 'Controle do Ar e Agua', level: 'Nível 1', category: 'Magia', classes: 'Tritao', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Instantanea', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Manifesta magia menor ligada ao mar, vento e correntes.', classLevelRequired: 1 },
  { name: 'Bencao da Rainha Corvo', level: 'Nível 1', category: 'Habilidade', classes: 'Shadar-kai', castingTime: '1 Acao Bonus', range: 'Pessoal', components: '-', duration: 'Instantanea', damageDice: 'Teleporte', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Teleporta-se por uma curta distancia envolto em sombras.', classLevelRequired: 1 },
  { name: 'Impulso Telecinetico', level: 'Nível 1', category: 'Magia', classes: 'Mistico,Feiticeiro,Mago', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Instantanea', damageDice: '2d6', damageType: 'Forca', savingThrow: 'FOR', description: 'Uma forca invisivel arremessa ou empurra uma criatura ou objeto.', classLevelRequired: 1 },
  { name: 'Leitura de Aura', level: 'Nível 1', category: 'Magia', classes: 'Mistico,Bardo,Clérigo', castingTime: '1 Acao', range: '9m', components: 'V, S', duration: 'Concentracao', damageDice: '-', damageType: 'Outro', savingThrow: 'SAB', description: 'Percebe ecos emocionais e rastros magicos superficiais de uma criatura.', classLevelRequired: 1 },
  { name: 'Absorver Elementos', level: 'Nível 1', category: 'Magia', classes: 'Artifice,Druida,Feiticeiro,Mago,Patrulheiro', castingTime: 'Reacao', range: 'Pessoal', components: 'S', duration: '1 Rodada', damageDice: '+1d6', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Reduz dano elemental recebido e carrega o proximo ataque.', classLevelRequired: 1 },
  { name: 'Catapulta', level: 'Nível 1', category: 'Magia', classes: 'Artifice,Feiticeiro,Mago', castingTime: '1 Acao', range: '18m', components: 'S', duration: 'Instantanea', damageDice: '3d8', damageType: 'Concussao', savingThrow: 'DES', description: 'Arremessa um objeto solto contra uma criatura.', classLevelRequired: 1 },
  { name: 'Graxa', level: 'Nível 1', category: 'Magia', classes: 'Artifice,Mago', castingTime: '1 Acao', range: '18m', components: 'V, S, M', duration: '1 Minuto', damageDice: '-', damageType: 'Outro', savingThrow: 'DES', description: 'Cobre o chao com gordura escorregadia.', classLevelRequired: 1 },
  { name: 'Disfarcar-se', level: 'Nível 1', category: 'Magia', classes: 'Bardo,Bruxo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: 'Pessoal', components: 'V, S', duration: '1 Hora', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Altera sua aparencia com ilusao.', classLevelRequired: 1 },
  { name: 'Recuo Acelerado', level: 'Nível 1', category: 'Magia', classes: 'Bruxo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao Bonus', range: 'Pessoal', components: 'V, S', duration: 'Concentracao', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Permite disparar como acao bonus durante a duracao.', classLevelRequired: 1 },
  { name: 'Sinalizador de Alvo', level: 'Nível 1', category: 'Magia', classes: 'Artifice,Patrulheiro', castingTime: '1 Acao Bonus', range: '27m', components: 'V, S, M', duration: 'Concentracao', damageDice: '+1d4', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Marca um alvo para facilitar ataques coordenados.', classLevelRequired: 1 },
  { name: 'Passo Trovejante', level: 'Nível 3', category: 'Magia', classes: 'Bruxo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: '27m', components: 'V', duration: 'Instantanea', damageDice: '3d10', damageType: 'Trovejante', savingThrow: 'CON', description: 'Teletransporta em um estouro que fere criaturas adjacentes.', classLevelRequired: 5 },
  { name: 'Servo Mecanico', level: 'Nível 2', category: 'Magia', classes: 'Artifice,Mago', castingTime: '1 Acao', range: '9m', components: 'V, S, M', duration: '1 Hora', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Anima um pequeno construto simples para tarefas basicas.', classLevelRequired: 3 },
  { name: 'Vortice Temporal', level: 'Nível 2', category: 'Magia', classes: 'Mago,Mistico', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Instantanea', damageDice: '2d8', damageType: 'Psiquico', savingThrow: 'SAB', description: 'Desorienta o alvo com ecos de futuros possiveis.', classLevelRequired: 3 },
  { name: 'Infusao: Arma Aprimorada', level: 'Nível 2', category: 'Passiva', classes: 'Artifice', castingTime: 'Passiva', range: 'Arma', components: '-', duration: 'Permanente', damageDice: '+1', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Arma infundida recebe bonus magico de ataque e dano.', classLevelRequired: 2 },
  { name: 'Infusao: Defesa Aprimorada', level: 'Nível 2', category: 'Passiva', classes: 'Artifice', castingTime: 'Passiva', range: 'Armadura', components: '-', duration: 'Permanente', damageDice: '+1 CA', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Armadura ou escudo infundido recebe bonus defensivo.', classLevelRequired: 2 },
  { name: 'Infusoes Magicas', level: 'Nível 1', category: 'Passiva', classes: 'Artifice', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Aprende a imbuir objetos comuns com propriedades arcanas temporarias.', classLevelRequired: 1 },
  { name: 'Conjuracao por Ferramentas', level: 'Nível 1', category: 'Passiva', classes: 'Artifice', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Pode usar ferramentas como foco para canalizar magias de artifice.', classLevelRequired: 1 },
  { name: 'Ferramenta Certa', level: 'Nível 3', category: 'Habilidade', classes: 'Artifice', castingTime: '1 Hora', range: 'Pessoal', components: '-', duration: 'Ate descanso', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Cria ou adapta ferramentas comuns com sucata e magia.', classLevelRequired: 3 },
  { name: 'Elixir Experimental', level: 'Nível 3', category: 'Habilidade', classes: 'Artifice', castingTime: '1 Acao', range: 'Toque', components: '-', duration: 'Variavel', damageDice: '1d6', damageType: 'Cura', savingThrow: 'Nenhum', description: 'Prepara um elixir de cura, velocidade, voo curto ou resistencia.', classLevelRequired: 3 },
  { name: 'Canhao Eldritch', level: 'Nível 3', category: 'Habilidade', classes: 'Artifice', castingTime: '1 Acao', range: '18m', components: '-', duration: '1 Hora', damageDice: '2d8', damageType: 'Forca', savingThrow: 'DES', description: 'Invoca um pequeno canhao arcano portatil.', classLevelRequired: 3 },
  { name: 'Defensor de Aco', level: 'Nível 3', category: 'Habilidade', classes: 'Artifice', castingTime: '1 Acao Bonus', range: '9m', components: '-', duration: 'Permanente', damageDice: '1d8', damageType: 'Forca', savingThrow: 'Nenhum', description: 'Construto aliado protege e ataca sob comando.', classLevelRequired: 3 },
  { name: 'Talento Psionico', level: 'Nível 1', category: 'Passiva', classes: 'Mistico', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '1d6', damageType: 'Psiquico', savingThrow: 'Nenhum', description: 'Recebe um dado psionico para ampliar poderes mentais.', classLevelRequired: 1 },
  { name: 'Disciplina Mental', level: 'Nível 1', category: 'Passiva', classes: 'Mistico', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Treinamento para manter foco psionico e resistir a intrusoes mentais.', classLevelRequired: 1 },
  { name: 'Pulso Psiquico', level: 'Nível 1', category: 'Habilidade', classes: 'Mistico', castingTime: '1 Acao', range: '18m', components: '-', duration: 'Instantanea', damageDice: '1d8', damageType: 'Psiquico', savingThrow: 'INT', description: 'Onda mental fere e empurra a consciencia do alvo.', classLevelRequired: 1 },
  { name: 'Escudo Mental', level: 'Nível 2', category: 'Habilidade', classes: 'Mistico', castingTime: 'Reacao', range: 'Pessoal', components: '-', duration: '1 Turno', damageDice: '+2 CA', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Barreira psiquica protege contra ataque ou magia mental.', classLevelRequired: 2 },
  { name: 'Mente Telepatica', level: 'Nível 3', category: 'Passiva', classes: 'Mistico', castingTime: 'Passiva', range: '18m', components: '-', duration: 'Permanente', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Comunica ideias simples diretamente na mente de criaturas conhecidas.', classLevelRequired: 3 },
  { name: 'Lamina Mental', level: 'Nível 3', category: 'Habilidade', classes: 'Mistico', castingTime: '1 Acao Bonus', range: 'Pessoal', components: '-', duration: '1 Minuto', damageDice: '1d8', damageType: 'Psiquico', savingThrow: 'Nenhum', description: 'Forma uma lamina de energia mental para ataques rapidos.', classLevelRequired: 3 },
  { name: 'Poder dos Gigantes', level: 'Nível 3', category: 'Habilidade', classes: 'Guerreiro', castingTime: '1 Acao Bonus', range: 'Pessoal', components: '-', duration: '1 Minuto', damageDice: '+1d6', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Aumenta tamanho, forca e dano enquanto runas brilham.', classLevelRequired: 3 },
  { name: 'Manto de Inspiracao', level: 'Nível 3', category: 'Habilidade', classes: 'Bardo', castingTime: '1 Acao Bonus', range: '18m', components: '-', duration: 'Instantanea', damageDice: 'PV Temp', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Aliados recebem pontos temporarios e podem se mover sem provocar ataques.', classLevelRequired: 3 },
  { name: 'Emboscador Sombrio', level: 'Nível 3', category: 'Passiva', classes: 'Patrulheiro', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '+1d8', damageType: 'Extra', savingThrow: 'Nenhum', description: 'No inicio do combate, move-se mais e causa dano extra.', classLevelRequired: 3 },
  { name: 'Palavra Radiante', level: 'Truque', category: 'Magia', classes: 'Clérigo', castingTime: '1 Acao', range: '1,5m', components: 'V, M', duration: 'Instantanea', damageDice: '1d6', damageType: 'Radiante', savingThrow: 'CON', description: 'Luz divina fere inimigos proximos que falham no teste.', classLevelRequired: 1 },
  { name: 'Lufada', level: 'Truque', category: 'Magia', classes: 'Druida,Feiticeiro,Mago', castingTime: '1 Acao', range: '9m', components: 'V, S', duration: 'Instantanea', damageDice: '-', damageType: 'Outro', savingThrow: 'FOR', description: 'Empurra uma criatura ou objeto leve com uma lufada de vento.', classLevelRequired: 1 },
  { name: 'Moldar Agua', level: 'Truque', category: 'Magia', classes: 'Druida,Feiticeiro,Mago', castingTime: '1 Acao', range: '9m', components: 'S', duration: '1 Hora', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Move, congela ou colore uma pequena porcao de agua.', classLevelRequired: 1 },
  { name: 'Toque Gelido', level: 'Truque', category: 'Magia', classes: 'Bruxo,Feiticeiro,Mago', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: '1 Rodada', damageDice: '1d8', damageType: 'Frio', savingThrow: 'CON', description: 'Frio necromantico reduz vigor e dificulta recuperacao.', classLevelRequired: 1 },
  { name: 'Badalar dos Mortos', level: 'Truque', category: 'Magia', classes: 'Bruxo,Clérigo,Mago', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Instantanea', damageDice: '1d8/1d12', damageType: 'Necrótico', savingThrow: 'SAB', description: 'Sino funebre causa mais dano em alvo ja ferido.', classLevelRequired: 1 },
  { name: 'Rajada de Ar', level: 'Truque', category: 'Magia', classes: 'Druida,Mistico,Feiticeiro', castingTime: '1 Acao', range: '9m', components: 'S', duration: 'Instantanea', damageDice: '1d6', damageType: 'Concussao', savingThrow: 'FOR', description: 'Compressao de ar golpeia e desloca o alvo.', classLevelRequired: 1 },
  { name: 'Raio Guia', level: 'Nível 1', category: 'Magia', classes: 'Clérigo', castingTime: '1 Acao', range: '36m', components: 'V, S', duration: '1 Rodada', damageDice: '4d6', damageType: 'Radiante', savingThrow: 'Nenhum', description: 'Raio luminoso causa dano e concede vantagem ao proximo ataque contra o alvo.', classLevelRequired: 1 },
  { name: 'Heroismo', level: 'Nível 1', category: 'Magia', classes: 'Bardo,Paladino', castingTime: '1 Acao', range: 'Toque', components: 'V, S', duration: 'Concentracao', damageDice: 'PV Temp', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Alvo fica imune a medo e recebe pontos temporarios a cada turno.', classLevelRequired: 1 },
  { name: 'Santuário', level: 'Nível 1', category: 'Magia', classes: 'Clérigo,Paladino', castingTime: '1 Acao Bonus', range: '9m', components: 'V, S, M', duration: '1 Minuto', damageDice: '-', damageType: 'Outro', savingThrow: 'SAB', description: 'Inimigos precisam vencer teste para atacar o alvo protegido.', classLevelRequired: 1 },
  { name: 'Orbe Cromatico', level: 'Nível 1', category: 'Magia', classes: 'Feiticeiro,Mago', castingTime: '1 Acao', range: '27m', components: 'V, S, M', duration: 'Instantanea', damageDice: '3d8', damageType: 'Variavel', savingThrow: 'Nenhum', description: 'Arremessa esfera elemental de tipo escolhido.', classLevelRequired: 1 },
  { name: 'Faca de Gelo', level: 'Nível 1', category: 'Magia', classes: 'Druida,Feiticeiro,Mago', castingTime: '1 Acao', range: '18m', components: 'S, M', duration: 'Instantanea', damageDice: '1d10+2d6', damageType: 'Perfurante, Frio', savingThrow: 'DES', description: 'Estilhaço de gelo perfura e explode em frio.', classLevelRequired: 1 },
  { name: 'Queda Suave', level: 'Nível 1', category: 'Magia', classes: 'Bardo,Feiticeiro,Mago,Artifice', castingTime: 'Reacao', range: '18m', components: 'V, M', duration: '1 Minuto', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Reduz dano de queda de criaturas escolhidas.', classLevelRequired: 1 },
  { name: 'Aprimorar Salto', level: 'Nível 1', category: 'Magia', classes: 'Druida,Feiticeiro,Mago,Patrulheiro,Artifice', castingTime: '1 Acao', range: 'Toque', components: 'V, S, M', duration: '1 Minuto', damageDice: 'Movimento', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Triplica a distancia de salto do alvo.', classLevelRequired: 1 },
  { name: 'Ajuda', level: 'Nível 2', category: 'Magia', classes: 'Clérigo,Paladino,Artifice', castingTime: '1 Acao', range: '9m', components: 'V, S, M', duration: '8 Horas', damageDice: '+5 PV Max', damageType: 'Cura', savingThrow: 'Nenhum', description: 'Aumenta pontos de vida maximos e atuais de aliados.', classLevelRequired: 3 },
  { name: 'Restauracao Menor', level: 'Nível 2', category: 'Magia', classes: 'Bardo,Clérigo,Druida,Paladino,Patrulheiro,Artifice', castingTime: '1 Acao', range: 'Toque', components: 'V, S', duration: 'Instantanea', damageDice: '-', damageType: 'Cura', savingThrow: 'Nenhum', description: 'Remove uma condicao simples como cego, surdo, paralisado ou envenenado.', classLevelRequired: 3 },
  { name: 'Silencio', level: 'Nível 2', category: 'Magia', classes: 'Bardo,Clérigo,Patrulheiro', castingTime: '1 Acao', range: '36m', components: 'V, S', duration: 'Concentracao', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Cria area onde nenhum som existe ou atravessa.', classLevelRequired: 3 },
  { name: 'Ver Invisibilidade', level: 'Nível 2', category: 'Magia', classes: 'Bardo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: 'Pessoal', components: 'V, S, M', duration: '1 Hora', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Permite enxergar criaturas e objetos invisiveis.', classLevelRequired: 3 },
  { name: 'Escalada de Aranha', level: 'Nível 2', category: 'Magia', classes: 'Bruxo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: 'Toque', components: 'V, S, M', duration: 'Concentracao', damageDice: 'Movimento', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Alvo escala paredes e tetos como uma aranha.', classLevelRequired: 3 },
  { name: 'Forca Fantasmagorica', level: 'Nível 2', category: 'Magia', classes: 'Bardo,Feiticeiro,Mago,Mistico', castingTime: '1 Acao', range: '18m', components: 'V, S, M', duration: 'Concentracao', damageDice: '1d6', damageType: 'Psiquico', savingThrow: 'INT', description: 'Cria ilusao mental que o alvo racionaliza como real.', classLevelRequired: 3 },
  { name: 'Medo', level: 'Nível 3', category: 'Magia', classes: 'Bardo,Bruxo,Feiticeiro,Mago', castingTime: '1 Acao', range: 'Cone', components: 'V, S, M', duration: 'Concentracao', damageDice: '-', damageType: 'Psiquico', savingThrow: 'SAB', description: 'Projeta imagem aterradora que amedronta criaturas.', classLevelRequired: 5 },
  { name: 'Lentidao', level: 'Nível 3', category: 'Magia', classes: 'Feiticeiro,Mago,Mistico', castingTime: '1 Acao', range: '36m', components: 'V, S, M', duration: 'Concentracao', damageDice: '-', damageType: 'Outro', savingThrow: 'SAB', description: 'Distorce o tempo e reduz acoes, velocidade e defesa de alvos.', classLevelRequired: 5 },
  { name: 'Protecao contra Energia', level: 'Nível 3', category: 'Magia', classes: 'Clérigo,Druida,Feiticeiro,Mago,Patrulheiro,Artifice', castingTime: '1 Acao', range: 'Toque', components: 'V, S', duration: 'Concentracao', damageDice: 'Resistencia', damageType: 'Variavel', savingThrow: 'Nenhum', description: 'Concede resistencia a um tipo de dano elemental.', classLevelRequired: 5 },
  { name: 'Toque Vampirico', level: 'Nível 3', category: 'Magia', classes: 'Bruxo,Mago', castingTime: '1 Acao', range: 'Toque', components: 'V, S', duration: 'Concentracao', damageDice: '3d6', damageType: 'Necrótico', savingThrow: 'Nenhum', description: 'Drena vida do alvo e cura metade do dano causado.', classLevelRequired: 5 },
  { name: 'Crescimento de Plantas', level: 'Nível 3', category: 'Magia', classes: 'Bardo,Druida,Patrulheiro', castingTime: '1 Acao', range: '45m', components: 'V, S', duration: 'Instantanea', damageDice: 'Terreno', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Vegetacao cresce e transforma area em terreno dificil extremo.', classLevelRequired: 5 },
  { name: 'Confusao', level: 'Nível 4', category: 'Magia', classes: 'Bardo,Druida,Feiticeiro,Mago', castingTime: '1 Acao', range: '27m', components: 'V, S, M', duration: 'Concentracao', damageDice: '-', damageType: 'Psiquico', savingThrow: 'SAB', description: 'Embaralha a mente de criaturas em area.', classLevelRequired: 7 },
  { name: 'Tentaculos Negros', level: 'Nível 4', category: 'Magia', classes: 'Mago,Bruxo', castingTime: '1 Acao', range: '27m', components: 'V, S, M', duration: 'Concentracao', damageDice: '3d6', damageType: 'Concussao', savingThrow: 'DES', description: 'Tentaculos sombrios agarram e esmagam criaturas na area.', classLevelRequired: 7 },
  { name: 'Localizar Criatura', level: 'Nível 4', category: 'Magia', classes: 'Bardo,Clérigo,Druida,Mago,Paladino,Patrulheiro', castingTime: '1 Acao', range: 'Pessoal', components: 'V, S, M', duration: 'Concentracao', damageDice: '-', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Sente a direcao de uma criatura conhecida dentro do alcance narrativo.', classLevelRequired: 7 },
  { name: 'Animar Objetos', level: 'Nível 5', category: 'Magia', classes: 'Bardo,Feiticeiro,Mago,Artifice', castingTime: '1 Acao', range: '36m', components: 'V, S', duration: 'Concentracao', damageDice: 'Variavel', damageType: 'Concussao', savingThrow: 'Nenhum', description: 'Objetos proximos ganham vida e atacam sob comando.', classLevelRequired: 9 },
  { name: 'Telecinese', level: 'Nível 5', category: 'Magia', classes: 'Feiticeiro,Mago,Mistico', castingTime: '1 Acao', range: '18m', components: 'V, S', duration: 'Concentracao', damageDice: 'Controle', damageType: 'Outro', savingThrow: 'FOR', description: 'Move criaturas ou objetos com forca mental sustentada.', classLevelRequired: 9 },
  { name: 'Restauracao Maior', level: 'Nível 5', category: 'Magia', classes: 'Bardo,Clérigo,Druida,Artifice', castingTime: '1 Acao', range: 'Toque', components: 'V, S, M', duration: 'Instantanea', damageDice: '-', damageType: 'Cura', savingThrow: 'Nenhum', description: 'Remove efeitos severos como maldicao, reducao de atributo ou exaustao.', classLevelRequired: 9 },
  { name: 'Missao', level: 'Nível 5', category: 'Magia', classes: 'Bardo,Clérigo,Paladino', castingTime: '1 Minuto', range: '18m', components: 'V', duration: '30 Dias', damageDice: '5d10', damageType: 'Psiquico', savingThrow: 'SAB', description: 'Impõe uma ordem magica prolongada a uma criatura.', classLevelRequired: 9 },
  { name: 'Estilo de Luta: Arquearia', level: 'Nível 1', category: 'Passiva', classes: 'Guerreiro,Patrulheiro', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '+2 Ataque', damageType: 'Outro', savingThrow: 'Nenhum', description: '+2 em jogadas de ataque com armas a distancia.', classLevelRequired: 1 },
  { name: 'Estilo de Luta: Duas Armas', level: 'Nível 1', category: 'Passiva', classes: 'Guerreiro,Patrulheiro', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '+Mod Dano', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Adiciona modificador de atributo ao dano da segunda arma.', classLevelRequired: 1 },
  { name: 'Estilo de Luta: Protecao', level: 'Nível 1', category: 'Habilidade', classes: 'Guerreiro,Paladino', castingTime: 'Reacao', range: '1,5m', components: '-', duration: 'Instantanea', damageDice: 'Desvantagem', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Impõe desvantagem em ataque contra aliado proximo enquanto usa escudo.', classLevelRequired: 1 },
  { name: 'Ataque Extra', level: 'Nível 5', category: 'Passiva', classes: 'Guerreiro,Paladino,Patrulheiro,Monge,Artifice', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: '+1 Ataque', damageType: 'Extra', savingThrow: 'Nenhum', description: 'Pode atacar duas vezes ao usar a acao Atacar.', classLevelRequired: 5 },
  { name: 'Evasao', level: 'Nível 7', category: 'Passiva', classes: 'Ladino,Monge', castingTime: 'Passiva', range: 'Pessoal', components: '-', duration: 'Permanente', damageDice: 'Reducao', damageType: 'Outro', savingThrow: 'DES', description: 'Sofre menos dano em efeitos de Destreza bem-sucedidos.', classLevelRequired: 7 },
  { name: 'Esquiva Sobrenatural', level: 'Nível 5', category: 'Habilidade', classes: 'Ladino', castingTime: 'Reacao', range: 'Pessoal', components: '-', duration: 'Instantanea', damageDice: 'Metade', damageType: 'Outro', savingThrow: 'Nenhum', description: 'Reduz pela metade o dano de um ataque que o acertou.', classLevelRequired: 5 },
  { name: 'Aura de Protecao', level: 'Nível 6', category: 'Passiva', classes: 'Paladino', castingTime: 'Passiva', range: '3m', components: '-', duration: 'Permanente', damageDice: '+CAR', damageType: 'Outro', savingThrow: 'Todos', description: 'Aliados proximos somam seu Carisma em testes de resistencia.', classLevelRequired: 6 },
  { name: 'Canalizar Divindade: Expulsar Mortos-Vivos', level: 'Nível 2', category: 'Habilidade', classes: 'Clérigo,Paladino', castingTime: '1 Acao', range: '9m', components: '-', duration: '1 Minuto', damageDice: 'Amedrontado', damageType: 'Radiante', savingThrow: 'SAB', description: 'Mortos-vivos falham e precisam se afastar da fonte divina.', classLevelRequired: 2 },
];

const EXPANDED_STARTING_KITS = [
  { name: 'Kit Artifice de Campo', targetName: 'Artifice', targetType: 'class', items: [{ name: 'Repetidor Leve', qty: 1 }, { name: 'Aljava com 20 Virotes', qty: 1 }, { name: 'Ferramentas de Inventor', qty: 1 }, { name: 'Granada de Fumaca', qty: 2 }] },
  { name: 'Kit Artifice Alquimico', targetName: 'Artifice', targetType: 'class', items: [{ name: 'Adaga', qty: 1 }, { name: 'Kit de Alquimia', qty: 1 }, { name: 'Tonica de Foco', qty: 1 }, { name: 'Poção de Cura', qty: 1 }] },
  { name: 'Kit Mistico Errante', targetName: 'Mistico', targetType: 'class', items: [{ name: 'Cristal Psiquico', qty: 1 }, { name: 'Lamina Psiquica', qty: 1 }, { name: 'Roupas de Viagem', qty: 1 }, { name: 'Livro', qty: 1 }] },
  { name: 'Kit Mistico Umbral', targetName: 'Mistico', targetType: 'class', items: [{ name: 'Cristal Psiquico', qty: 1 }, { name: 'Manto Umbral', qty: 1 }, { name: 'Adaga', qty: 2 }, { name: 'Tonica de Foco', qty: 1 }] },
];

const EXPANDED_SPELLCASTING_PROGRESSIONS = [
  ['class', 'Artifice', 1, 2, 0, 2, 0, 0],
  ['class', 'Artifice', 2, 2, 0, 2, 0, 0],
  ['class', 'Artifice', 3, 2, 0, 3, 0, 0],
  ['class', 'Artifice', 4, 2, 0, 3, 0, 0],
  ['class', 'Artifice', 5, 2, 0, 4, 2, 0],
  ['class', 'Mistico', 1, 2, 2, 0, 0, 0],
  ['class', 'Mistico', 2, 2, 3, 0, 0, 0],
  ['class', 'Mistico', 3, 2, 4, 0, 0, 0],
  ['class', 'Mistico', 4, 3, 4, 0, 0, 0],
  ['class', 'Mistico', 5, 3, 5, 0, 0, 0],
  ['race', 'Aasimar', 1, 0, 1, 0, 0, 0],
  ['race', 'Genasi do Fogo', 1, 1, 0, 0, 0, 0],
  ['race', 'Tritao', 1, 0, 1, 0, 0, 0],
  ['race', 'Firbolg', 1, 0, 1, 0, 0, 0],
];

const FULL_CASTER_SLOTS = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const HALF_CASTER_SLOTS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
];

const ARTIFICE_SLOTS = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  ...HALF_CASTER_SLOTS.slice(1),
];

const THIRD_CASTER_SLOTS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
];

const WARLOCK_SLOTS = Array.from({ length: 20 }, (_, index) => {
  const level = index + 1;
  const slots = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pactLevel = level >= 9 ? 5 : level >= 7 ? 4 : level >= 5 ? 3 : level >= 3 ? 2 : 1;
  slots[pactLevel - 1] = level >= 11 ? 3 : level >= 2 ? 2 : 1;
  return slots;
});

const spellsKnownByClass: Record<string, number[]> = {
  Bardo: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  Bruxo: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  Feiticeiro: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  Patrulheiro: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  Mistico: [2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12],
  'Cavaleiro Arcano': [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13],
  'Trapaceiro Arcano': [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13],
};

function fullCasterCantrips(sourceName: string, level: number) {
  if (sourceName === 'Bardo') return level >= 10 ? 4 : level >= 4 ? 3 : 2;
  if (sourceName === 'Feiticeiro') return level >= 10 ? 6 : level >= 4 ? 5 : 4;
  if (sourceName === 'Clérigo' || sourceName === 'Druida' || sourceName === 'Mago') return level >= 10 ? 5 : level >= 4 ? 4 : 3;
  return 0;
}

function halfCasterCantrips(sourceName: string, level: number) {
  if (sourceName !== 'Artifice') return 0;
  if (level >= 14) return 4;
  if (level >= 10) return 3;
  return 2;
}

function buildClassProgressions(): SpellcastingProgressionSeed[] {
  const seeds: SpellcastingProgressionSeed[] = [];
  const fullCasters = ['Bardo', 'Clérigo', 'Druida', 'Feiticeiro', 'Mago'];
  const halfCasters = ['Paladino', 'Patrulheiro', 'Artifice'];

  for (const sourceName of fullCasters) {
    for (let level = 1; level <= 20; level++) {
      seeds.push({
        sourceType: 'class',
        sourceName,
        level,
        cantripsKnown: fullCasterCantrips(sourceName, level),
        spellsKnown: spellsKnownByClass[sourceName]?.[level - 1] || 0,
        slots: FULL_CASTER_SLOTS[level - 1],
      });
    }
  }

  for (const sourceName of halfCasters) {
    for (let level = 1; level <= 20; level++) {
      seeds.push({
        sourceType: 'class',
        sourceName,
        level,
        cantripsKnown: halfCasterCantrips(sourceName, level),
        spellsKnown: spellsKnownByClass[sourceName]?.[level - 1] || 0,
        slots: sourceName === 'Artifice' ? ARTIFICE_SLOTS[level - 1] : HALF_CASTER_SLOTS[level - 1],
      });
    }
  }

  for (let level = 1; level <= 20; level++) {
    seeds.push({
      sourceType: 'class',
      sourceName: 'Bruxo',
      level,
      cantripsKnown: level >= 10 ? 4 : level >= 4 ? 3 : 2,
      spellsKnown: spellsKnownByClass.Bruxo[level - 1],
      slots: WARLOCK_SLOTS[level - 1],
    });
    seeds.push({
      sourceType: 'class',
      sourceName: 'Mistico',
      level,
      cantripsKnown: level >= 10 ? 4 : level >= 4 ? 3 : 2,
      spellsKnown: spellsKnownByClass.Mistico[level - 1],
      slots: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  }

  for (const sourceName of ['Cavaleiro Arcano', 'Trapaceiro Arcano']) {
    for (let level = 1; level <= 20; level++) {
      seeds.push({
        sourceType: 'subclass',
        sourceName,
        level,
        cantripsKnown: level >= 10 ? 3 : level >= 3 ? 2 : 0,
        spellsKnown: spellsKnownByClass[sourceName][level - 1],
        slots: THIRD_CASTER_SLOTS[level - 1],
      });
    }
  }

  return seeds;
}

async function seedExpandedBaseCatalog(db: SQLiteDatabase) {
  for (const race of EXPANDED_RACES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO races (name, stat_bonuses, speed, features, criador) VALUES (?, ?, ?, ?, 'base')`,
      [race.name, race.statBonuses, race.speed, JSON.stringify(race.features)]
    );
  }

  for (const item of EXPANDED_ITEMS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO items (name, weight, damage, damage_type, category, is_consumable, properties, descricao, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      [item.name, item.weight, item.damage, item.damageType, item.category, item.isConsumable, item.properties, item.descricao]
    );
  }

  for (const charClass of EXPANDED_CLASSES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster, features, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      [
        charClass.name,
        charClass.recommendedStats,
        charClass.startingEquipment,
        charClass.startingGold,
        charClass.hitDice,
        charClass.saves,
        charClass.subclassLevel,
        charClass.isCaster,
        JSON.stringify(charClass.features),
      ]
    );
  }

  for (const subclass of EXPANDED_SUBCLASSES) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM subclasses WHERE name = ? AND class_name = ? LIMIT 1`,
      [subclass.name, subclass.className]
    );
    if (existing?.id) continue;
    await db.runAsync(
      `INSERT INTO subclasses (name, class_name, level_required, features, criador) VALUES (?, ?, ?, ?, 'base')`,
      [subclass.name, subclass.className, subclass.levelRequired, JSON.stringify(subclass.features)]
    );
  }

  for (const spell of EXPANDED_SPELLS) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM spells WHERE name = ? AND classes = ? LIMIT 1`,
      [spell.name, spell.classes]
    );
    if (existing?.id) continue;
    await db.runAsync(
      `INSERT INTO spells (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, class_level_required, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      [
        spell.name,
        spell.level,
        spell.category,
        spell.classes,
        spell.castingTime,
        spell.range,
        spell.components,
        spell.duration,
        spell.damageDice,
        spell.damageType,
        spell.savingThrow,
        spell.description,
        spell.classLevelRequired,
      ]
    );
  }

  for (const kit of EXPANDED_STARTING_KITS) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM starting_kits WHERE name = ? LIMIT 1`,
      [kit.name]
    );
    if (existing?.id) continue;
    await db.runAsync(
      `INSERT INTO starting_kits (name, target_name, target_type, items, criador) VALUES (?, ?, ?, ?, 'base')`,
      [kit.name, kit.targetName, kit.targetType, JSON.stringify(kit.items)]
    );
  }

  for (const progression of EXPANDED_SPELLCASTING_PROGRESSIONS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO spellcasting_progression
       (source_type, source_name, level, cantrips_known, spells_known, slot_1, slot_2, slot_3, criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      progression
    );
  }
}

async function seedFullSpellcastingProgression(db: SQLiteDatabase) {
  for (const progression of buildClassProgressions()) {
    const [slot1 = 0, slot2 = 0, slot3 = 0, slot4 = 0, slot5 = 0, slot6 = 0, slot7 = 0, slot8 = 0, slot9 = 0] = progression.slots;
    await db.runAsync(
      `INSERT OR REPLACE INTO spellcasting_progression (
        source_type, source_name, level, cantrips_known, spells_known,
        slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8, slot_9, criador
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'base')`,
      [
        progression.sourceType,
        progression.sourceName,
        progression.level,
        progression.cantripsKnown,
        progression.spellsKnown,
        slot1,
        slot2,
        slot3,
        slot4,
        slot5,
        slot6,
        slot7,
        slot8,
        slot9,
      ]
    );
  }
}

async function seedStructuredItemEffects(db: SQLiteDatabase) {
  await seedEffectIfMissing(db, 'items', 'Poção de Invisibilidade', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Invisivel',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      condition_color: '#94A3B8',
      condition_description: 'Torna-se invisivel ate a duracao acabar ou ate atacar/conjurar, conforme regra da mesa.',
      ends_on_attack_or_spell: true,
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Força do Gigante da Colina', {
    effect_kind: 'stat_modifier',
    effect_type: 'FOR',
    value_mode: 'fixed',
    fixed_value: 21,
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      modifier_mode: 'set_minimum',
      description: 'FOR vira 21 enquanto durar, a menos que ja seja maior.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Velocidade', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Velocidade',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'minute',
    sort_order: 0,
    metadata: {
      condition_color: '#22C55E',
      condition_description: 'Movimento acelerado: bonus defensivo, deslocamento ampliado e acao extra conforme regra da mesa.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Velocidade', {
    effect_kind: 'stat_modifier',
    effect_type: 'CA',
    value_mode: 'fixed',
    fixed_value: 2,
    duration_value: 1,
    duration_unit: 'minute',
    sort_order: 1,
    metadata: {
      modifier_mode: 'bonus',
      description: '+2 CA enquanto durar.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Voo', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Voando',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      condition_color: '#38BDF8',
      condition_description: 'Recebe deslocamento de voo enquanto durar.',
      fly_speed: 'igual ao deslocamento ou 18m, conforme regra da mesa',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Heroísmo', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Heroismo',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    sort_order: 0,
    metadata: {
      condition_color: '#FACC15',
      condition_description: 'Nao pode ser amedrontado enquanto durar.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Heroísmo', {
    effect_kind: 'stat_modifier',
    effect_type: 'PV Temp',
    value_mode: 'fixed',
    fixed_value: 10,
    duration_value: 1,
    duration_unit: 'hour',
    sort_order: 1,
    metadata: {
      modifier_mode: 'temporary_hp',
      description: 'Ganha 10 PV temporarios ao beber.',
    },
  });

  for (const resistance of [
    { item: 'Poção de Resistência ao Fogo', damageType: 'Fogo', color: '#F97316' },
    { item: 'Poção de Resistência ao Frio', damageType: 'Frio', color: '#38BDF8' },
  ]) {
    await seedEffectIfMissing(db, 'items', resistance.item, {
      effect_kind: 'condition',
      effect_type: 'Condicao',
      condition_name: 'Resistencia Elemental',
      value_mode: 'none',
      duration_value: 1,
      duration_unit: 'hour',
      metadata: {
        condition_color: resistance.color,
        condition_description: `Resistencia contra dano de ${resistance.damageType}.`,
        resistance_type: resistance.damageType,
      },
    });
  }

  await seedEffectIfMissing(db, 'items', 'Poção de Crescimento', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Aumentado',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    sort_order: 0,
    metadata: {
      condition_color: '#F59E0B',
      condition_description: 'Tamanho aumentado enquanto durar.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Poção de Crescimento', {
    effect_kind: 'damage',
    effect_type: 'Extra',
    value_mode: 'dice',
    dice_count: 1,
    dice_sides: 4,
    duration_value: 1,
    duration_unit: 'hour',
    sort_order: 1,
    metadata: {
      applies_to: 'weapon_damage',
      description: '+1d4 de dano com arma enquanto durar.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Água Benta (Frasco)', {
    effect_kind: 'damage',
    effect_type: 'Radiante',
    value_mode: 'dice',
    dice_count: 2,
    dice_sides: 6,
    duration_unit: 'instant',
    metadata: {
      applies_to: 'fiend_or_undead',
      description: 'Causa dano radiante contra mortos-vivos e demonios conforme regra da mesa.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Ácido (Frasco)', {
    effect_kind: 'damage',
    effect_type: 'Acido',
    value_mode: 'dice',
    dice_count: 2,
    dice_sides: 6,
    duration_unit: 'instant',
    metadata: {
      delivery: 'arremesso',
      description: 'Frasco arremessado que causa dano acido no impacto.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Veneno Básico (Frasco)', {
    effect_kind: 'damage',
    effect_type: 'Veneno',
    value_mode: 'dice',
    dice_count: 1,
    dice_sides: 4,
    duration_value: 1,
    duration_unit: 'minute',
    metadata: {
      applies_to: 'weapon_coating',
      description: 'Aplica veneno em arma por 1 minuto; o proximo alvo atingido sofre dano extra conforme regra da mesa.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Antitoxina', {
    effect_kind: 'utility',
    effect_type: 'Vantagem contra Veneno',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      applies_to: 'saving_throw_poison',
      description: 'Concede vantagem contra venenos por 1 hora.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Kit de Primeiros Socorros', {
    effect_kind: 'utility',
    effect_type: 'Estabilizar',
    value_mode: 'none',
    duration_unit: 'instant',
    metadata: {
      consumes_charge: true,
      description: 'Estabiliza uma criatura a 0 PV sem teste, consumindo um uso do kit.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Granada de Fumaca', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Obscurecido',
    value_mode: 'none',
    duration_value: 3,
    duration_unit: 'turn',
    metadata: {
      condition_color: '#64748B',
      condition_description: 'Area fica obscurecida por fumaca densa.',
      area_shape: 'nuvem',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Bomba de Trovao', {
    effect_kind: 'damage',
    effect_type: 'Trovejante',
    value_mode: 'dice',
    dice_count: 2,
    dice_sides: 6,
    duration_unit: 'instant',
    sort_order: 0,
    metadata: {
      area_shape: 'explosao',
      description: 'Explosao sonora em area pequena.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Bomba de Trovao', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Surdo',
    value_mode: 'none',
    chance_percent: 50,
    duration_value: 1,
    duration_unit: 'turn',
    sort_order: 1,
    metadata: {
      condition_color: '#38BDF8',
      condition_description: 'Pode deixar o alvo surdo por 1 turno.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Tonica de Foco', {
    effect_kind: 'utility',
    effect_type: 'Vantagem',
    value_mode: 'none',
    duration_value: 10,
    duration_unit: 'minute',
    metadata: {
      applies_to: 'concentration_or_mental_focus',
      description: 'Ajuda em testes de concentracao ou foco mental por 10 minutos.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pocao de Escalada', {
    effect_kind: 'utility',
    effect_type: 'Escalada',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      climb_speed: 'igual ao deslocamento',
      description: 'Concede deslocamento de escalada por 1 hora.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pocao de Respiracao Aquatica', {
    effect_kind: 'utility',
    effect_type: 'Respiracao Aquatica',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      description: 'Permite respirar embaixo da agua por 1 hora.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Reparar', {
    effect_kind: 'utility',
    effect_type: 'Reparar Objeto',
    value_mode: 'none',
    duration_unit: 'instant',
    metadata: {
      spell_name: 'Consertar',
      spell_level: 'Truque',
      consumes_item: true,
      description: 'Repara um objeto pequeno danificado, reproduzindo a magia Consertar.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Sono', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Inconsciente',
    value_mode: 'dice',
    dice_count: 5,
    dice_sides: 8,
    duration_value: 1,
    duration_unit: 'minute',
    metadata: {
      spell_name: 'Sono',
      spell_level: 'Nivel 1',
      consumes_item: true,
      condition_color: '#64748B',
      condition_description: 'Criaturas afetadas caem em sono magico por ate 1 minuto ou ate acordarem.',
      hp_pool: '5d8',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Misseis Magicos', {
    effect_kind: 'damage',
    effect_type: 'Forca',
    value_mode: 'dice',
    dice_count: 3,
    dice_sides: 4,
    dice_bonus: 3,
    duration_unit: 'instant',
    metadata: {
      spell_name: 'Misseis Magicos',
      spell_level: 'Nivel 1',
      consumes_item: true,
      auto_hit: true,
      projectile_count: 3,
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Bola de Fogo', {
    effect_kind: 'damage',
    effect_type: 'Fogo',
    value_mode: 'dice',
    dice_count: 8,
    dice_sides: 6,
    duration_unit: 'instant',
    metadata: {
      spell_name: 'Bola de Fogo',
      spell_level: 'Nivel 3',
      consumes_item: true,
      saving_throw: 'DES',
      area: 'esfera',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Curar Ferimentos', {
    effect_kind: 'healing',
    effect_type: 'Cura',
    value_mode: 'dice',
    dice_count: 1,
    dice_sides: 8,
    duration_unit: 'instant',
    metadata: {
      spell_name: 'Curar Ferimentos',
      spell_level: 'Nivel 1',
      consumes_item: true,
      range: 'Toque',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Armadura Arcana', {
    effect_kind: 'stat_modifier',
    effect_type: 'CA',
    value_mode: 'fixed',
    fixed_value: 13,
    duration_value: 8,
    duration_unit: 'hour',
    metadata: {
      spell_name: 'Armadura Arcana',
      spell_level: 'Nivel 1',
      consumes_item: true,
      modifier_mode: 'base_ac_plus_dex',
      description: 'CA base vira 13 + modificador de DES por 8 horas.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Invisibilidade', {
    effect_kind: 'condition',
    effect_type: 'Condicao',
    condition_name: 'Invisivel',
    value_mode: 'none',
    duration_value: 1,
    duration_unit: 'hour',
    metadata: {
      spell_name: 'Invisibilidade',
      spell_level: 'Nivel 2',
      consumes_item: true,
      condition_color: '#94A3B8',
      condition_description: 'Torna-se invisivel ate atacar, conjurar ou a duracao acabar.',
      ends_on_attack_or_spell: true,
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Escudo Arcano', {
    effect_kind: 'stat_modifier',
    effect_type: 'CA',
    value_mode: 'fixed',
    fixed_value: 5,
    duration_value: 1,
    duration_unit: 'round',
    metadata: {
      spell_name: 'Escudo Arcano',
      spell_level: 'Nivel 1',
      consumes_item: true,
      modifier_mode: 'bonus',
      trigger: 'reaction',
      description: '+5 CA ate o inicio do proximo turno.',
    },
  });

  await seedEffectIfMissing(db, 'items', 'Pergaminho de Relampago', {
    effect_kind: 'damage',
    effect_type: 'Eletrico',
    value_mode: 'dice',
    dice_count: 8,
    dice_sides: 6,
    duration_unit: 'instant',
    metadata: {
      spell_name: 'Relampago',
      spell_level: 'Nivel 3',
      consumes_item: true,
      saving_throw: 'DES',
      area: 'linha',
    },
  });
}

async function repairStartingKitsAgainstCatalog(db: SQLiteDatabase) {
  const catalogItems = await db.getAllAsync<{ name: string }>(`SELECT name FROM items`);
  const itemNames = new Set(catalogItems.map(item => item.name));
  const aliases: Record<string, string> = {
    'Pocao de Cura': 'Poção de Cura',
    'Poção Cura': 'Poção de Cura',
    'Kit Alquimia': 'Kit de Alquimia',
    'Ferramentas Inventor': 'Ferramentas de Inventor',
  };

  const kits = await db.getAllAsync<{ id: number; items: string }>(`SELECT id, items FROM starting_kits`);
  for (const kit of kits) {
    let parsed: { name: string; qty: number }[];
    try {
      parsed = JSON.parse(kit.items);
    } catch {
      continue;
    }

    let changed = false;
    const repaired = parsed
      .map(item => {
        const alias = aliases[item.name];
        if (alias && itemNames.has(alias)) {
          changed = true;
          return { ...item, name: alias };
        }
        return item;
      })
      .filter(item => {
        const exists = itemNames.has(item.name);
        if (!exists) changed = true;
        return exists;
      });

    if (changed) {
      await db.runAsync(`UPDATE starting_kits SET items = ? WHERE id = ?`, [JSON.stringify(repaired), kit.id]);
    }
  }
}

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA journal_mode = WAL;`);

  // 1. CRIAÇÃO DE TABELAS
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT UNIQUE NOT NULL, 
      weight REAL NOT NULL,
      damage TEXT,
      damage_type TEXT,
      category TEXT,
      is_consumable INTEGER DEFAULT 0,
      properties TEXT,
      descricao TEXT,
      criador TEXT DEFAULT 'base'
    );
    
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT UNIQUE NOT NULL, 
      stat_bonuses TEXT NOT NULL,
      speed TEXT NOT NULL,
      features TEXT DEFAULT '[]',
      criador TEXT DEFAULT 'base'
    );
    
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT UNIQUE NOT NULL, 
      recommended_stats TEXT NOT NULL, 
      starting_equipment TEXT NOT NULL, 
      starting_gold INTEGER NOT NULL,
      hit_dice INTEGER NOT NULL,
      saves TEXT NOT NULL,
      subclass_level INTEGER NOT NULL,
      is_caster INTEGER NOT NULL DEFAULT 0,
      features TEXT DEFAULT '[]',
      criador TEXT DEFAULT 'base'
    );

    CREATE TABLE IF NOT EXISTS starting_kits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_name TEXT NOT NULL,
      target_type TEXT NOT NULL, 
      items TEXT NOT NULL,
      criador TEXT DEFAULT 'base'
    );    

    CREATE TABLE IF NOT EXISTS saving_throws (id TEXT PRIMARY KEY, name TEXT NOT NULL, stat TEXT NOT NULL);
    
    CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, stat TEXT NOT NULL);
    
    CREATE TABLE IF NOT EXISTS subclasses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      level_required INTEGER NOT NULL,
      bonus_skills INTEGER DEFAULT 0,
      features TEXT DEFAULT '[]',
      criador TEXT DEFAULT 'base'
    );
    
    -- TABELA SPELLS ATUALIZADA COM 'category'
    CREATE TABLE IF NOT EXISTS spells (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT NOT NULL, 
      level TEXT NOT NULL, 
      category TEXT DEFAULT 'Magia', -- NOVA COLUNA: 'Magia', 'Habilidade' ou 'Passiva'
      classes TEXT NOT NULL,
      casting_time TEXT,
      casting_time_value INTEGER,
      casting_time_unit TEXT,
      range TEXT,
      range_value REAL,
      range_unit TEXT,
      range_shape TEXT,
      components TEXT,
      duration TEXT,
      duration_value INTEGER,
      duration_unit TEXT,
      damage_dice TEXT,
      damage_type TEXT,
      saving_throw TEXT,
      description TEXT,
      class_level_required TEXT DEFAULT '1',
      criador TEXT DEFAULT 'base'
    );

    CREATE TABLE IF NOT EXISTS effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      source_name TEXT,
      trigger TEXT NOT NULL DEFAULT 'on_use',
      effect_kind TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      condition_name TEXT,
      value_mode TEXT NOT NULL DEFAULT 'none',
      dice_count INTEGER,
      dice_sides INTEGER,
      dice_bonus INTEGER DEFAULT 0,
      fixed_value REAL,
      chance_percent REAL NOT NULL DEFAULT 100,
      duration_value INTEGER,
      duration_unit TEXT NOT NULL DEFAULT 'instant',
      target TEXT,
      stacking TEXT,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      criador TEXT DEFAULT 'base',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK(source_table IN ('items', 'spells')),
      CHECK(value_mode IN ('none', 'fixed', 'dice')),
      CHECK(chance_percent >= 0 AND chance_percent <= 100)
    );

    CREATE INDEX IF NOT EXISTS idx_effects_source ON effects(source_table, source_id);

    CREATE TABLE IF NOT EXISTS condition_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#F4A84D',
      criador TEXT DEFAULT 'base',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK(color LIKE '#%')
    );

    CREATE INDEX IF NOT EXISTS idx_condition_effects_name ON condition_effects(name);

    CREATE TABLE IF NOT EXISTS bg3_companions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      race TEXT NOT NULL,
      class_name TEXT NOT NULL,
      origin_spell TEXT,
      skills TEXT NOT NULL,
      stats TEXT NOT NULL,
      personality TEXT NOT NULL,
      ideals TEXT NOT NULL,
      bonds TEXT NOT NULL,
      flaws TEXT NOT NULL,
      backstory TEXT NOT NULL,
      allies TEXT NOT NULL,
      features TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS random_lore_archetypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      allowed_classes TEXT DEFAULT '[]',
      criador TEXT DEFAULT 'base'
    );

    CREATE TABLE IF NOT EXISTS random_lore_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archetype_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      criador TEXT DEFAULT 'base',
      UNIQUE(archetype_id, field, value)
    );

    CREATE TABLE IF NOT EXISTS random_name_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gender TEXT NOT NULL DEFAULT 'any',
      kind TEXT NOT NULL,
      class_name TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL,
      criador TEXT DEFAULT 'base',
      UNIQUE(gender, kind, class_name, value)
    );


    CREATE TABLE IF NOT EXISTS random_lore_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL,
      criador TEXT DEFAULT 'base',
      UNIQUE(class_name, value)
    );

    CREATE TABLE IF NOT EXISTS random_race_language_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_contains TEXT NOT NULL UNIQUE,
      base_languages TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      criador TEXT DEFAULT 'base'
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      race TEXT NOT NULL,
      class TEXT NOT NULL,
      stats TEXT NOT NULL,
      prof_bonus TEXT,
      inspiration TEXT,
      proficiencies TEXT,
      save_values TEXT,
      skill_values TEXT,
      personality_traits TEXT,
      ideals TEXT,
      bonds TEXT,
      flaws TEXT,
      features_traits TEXT,
      backstory TEXT,
      allies_organizations TEXT,
      languages TEXT,
      avatar_uri TEXT,
      spells TEXT,
      spell_slots_used TEXT DEFAULT '{}',
      equipment TEXT,
      gp INTEGER DEFAULT 0,
      sp INTEGER DEFAULT 0,
      cp INTEGER DEFAULT 0,
      hp_max INTEGER DEFAULT 0,
      hp_current INTEGER DEFAULT 0,
      hp_temp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spellcasting_progression (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL, 
      level INTEGER NOT NULL,
      cantrips_known INTEGER DEFAULT 0,
      spells_known INTEGER DEFAULT 0,
      slot_1 INTEGER DEFAULT 0,
      slot_2 INTEGER DEFAULT 0,
      slot_3 INTEGER DEFAULT 0,
      slot_4 INTEGER DEFAULT 0,
      slot_5 INTEGER DEFAULT 0,
      slot_6 INTEGER DEFAULT 0,
      slot_7 INTEGER DEFAULT 0,
      slot_8 INTEGER DEFAULT 0,
      slot_9 INTEGER DEFAULT 0,
      criador TEXT DEFAULT 'base',
      UNIQUE(source_type, source_name, level)
    );

    CREATE TABLE IF NOT EXISTS lan_device_identity (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      player_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'closed',
      session_code TEXT UNIQUE,
      host_ip TEXT,
      port INTEGER,
      sync_custom_content INTEGER DEFAULT 0,
      selected_content TEXT DEFAULT '[]',
      allow_existing_character INTEGER DEFAULT 1,
      linked_character_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      opened_at DATETIME,
      closed_at DATETIME,
      last_connected_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS lan_session_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      turn INTEGER DEFAULT 1,
      campaign_minutes INTEGER DEFAULT 0,
      paused INTEGER DEFAULT 0,
      initiative_order TEXT DEFAULT '[]',
      initiative_scores TEXT DEFAULT '{}',
      virtual_combatants TEXT DEFAULT '[]',
      last_event_seq INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_session_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      player_name TEXT,
      character_id INTEGER,
      character_name TEXT,
      connected INTEGER DEFAULT 0,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS lan_character_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      owner_device_id TEXT NOT NULL,
      remote_character_id TEXT,
      character_name TEXT,
      payload TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, owner_device_id, remote_character_id)
    );

    CREATE TABLE IF NOT EXISTS lan_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      seq INTEGER,
      event_id TEXT,
      command_id TEXT,
      event_type TEXT NOT NULL,
      actor_device_id TEXT,
      actor_name TEXT,
      target_device_id TEXT,
      target_character_id INTEGER,
      target_name TEXT,
      previous_value TEXT,
      current_value TEXT,
      description TEXT,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_trace_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'debug',
      category TEXT NOT NULL DEFAULT 'app',
      action TEXT NOT NULL,
      function_name TEXT,
      source_file TEXT,
      step TEXT,
      request_id TEXT,
      duration_ms INTEGER,
      entity_table TEXT,
      entity_id TEXT,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lan_event_log_event_id ON lan_event_log(event_id);
    CREATE INDEX IF NOT EXISTS idx_lan_event_log_session_seq ON lan_event_log(session_id, seq DESC);
    CREATE INDEX IF NOT EXISTS idx_app_trace_logs_created_at ON app_trace_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_app_trace_logs_entity ON app_trace_logs(entity_table, entity_id);
    CREATE INDEX IF NOT EXISTS idx_app_trace_logs_function ON app_trace_logs(function_name, step);
  `);

  await ensureColumn(db, 'bg3_companions', 'languages', 'TEXT');
  await ensureColumn(db, 'bg3_companions', 'origin_traits', 'TEXT');
  await ensureColumn(db, 'characters', 'hp_temp', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'characters', 'avatar_uri', 'TEXT');
  await ensureColumn(db, 'characters', 'spell_slots_used', `TEXT DEFAULT '{}'`);
  await ensureColumn(db, 'items', 'category', 'TEXT');
  await ensureColumn(db, 'items', 'is_consumable', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'effects', 'source_name', 'TEXT');
  await ensureColumn(db, 'spells', 'casting_time_value', 'INTEGER');
  await ensureColumn(db, 'spells', 'casting_time_unit', 'TEXT');
  await ensureColumn(db, 'spells', 'range_value', 'REAL');
  await ensureColumn(db, 'spells', 'range_unit', 'TEXT');
  await ensureColumn(db, 'spells', 'range_shape', 'TEXT');
  await ensureColumn(db, 'spells', 'duration_value', 'INTEGER');
  await ensureColumn(db, 'spells', 'duration_unit', 'TEXT');
  await ensureColumn(db, 'spellcasting_progression', 'slot_4', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'spellcasting_progression', 'slot_5', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'spellcasting_progression', 'slot_6', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'spellcasting_progression', 'slot_7', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'spellcasting_progression', 'slot_8', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'spellcasting_progression', 'slot_9', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'lan_sessions', 'paused_at', 'DATETIME');
  await ensureColumn(db, 'lan_sessions', 'resumed_at', 'DATETIME');
  await ensureColumn(db, 'lan_session_state', 'initiative_order', `TEXT DEFAULT '[]'`);
  await ensureColumn(db, 'lan_session_state', 'initiative_scores', `TEXT DEFAULT '{}'`);
  await ensureColumn(db, 'lan_session_state', 'virtual_combatants', `TEXT DEFAULT '[]'`);
  await ensureColumn(db, 'lan_event_log', 'seq', 'INTEGER');
  await ensureColumn(db, 'lan_event_log', 'event_id', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'command_id', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'actor_device_id', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'actor_name', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'target_device_id', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'target_character_id', 'INTEGER');
  await ensureColumn(db, 'lan_event_log', 'target_name', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'previous_value', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'current_value', 'TEXT');
  await ensureColumn(db, 'lan_event_log', 'description', 'TEXT');
  await ensureColumn(db, 'app_trace_logs', 'function_name', 'TEXT');
  await ensureColumn(db, 'app_trace_logs', 'source_file', 'TEXT');
  await ensureColumn(db, 'app_trace_logs', 'step', 'TEXT');
  await ensureColumn(db, 'app_trace_logs', 'request_id', 'TEXT');
  await ensureColumn(db, 'app_trace_logs', 'duration_ms', 'INTEGER');
  await ensureColumn(db, 'app_trace_logs', 'metadata', 'TEXT');
  const didResetTransientDebugState = await resetTransientDebugStateOnBuildChange(db);
  await ensureTraceTriggers(db);

  const checkDb = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM items');
  
  if (checkDb && checkDb.count === 0) {
    console.log('Banco de dados vazio. Populando dados base com integração de features e magia categorizada...');

    await db.execAsync(`INSERT INTO items (name, weight, damage, damage_type, properties, descricao) VALUES
      ('Machado Grande', 3.5, '1d12', 'Cortante', 'Arma, Pesada, Duas mãos', 'Um machado de duas mãos formidável, favorecido por guerreiros bárbaros.'), 
      ('Machadinha', 1.0, '1d6', 'Cortante', 'Arma, Leve, Arremesso (6/18m)', 'Pequena e equilibrada, perfeita para o combate corpo a corpo ou para arremessar.'), 
      ('Azagaia', 1.0, '1d6', 'Perfurante', 'Arma, Arremesso (9/36m)', 'Uma lança leve de arremesso, excelente para manter inimigos à distância.'), 
      ('Rapieira', 1.0, '1d8', 'Perfurante', 'Arma, Acuidade', 'Uma espada ágil, projetada para estocadas precisas usando destreza.'), 
      ('Alaúde', 1.0, '-', '-', 'Ferramenta, Instrumento musical', 'Um instrumento de cordas muito apreciado por bardos viajantes.'), 
      ('Armadura de Couro', 5.0, '-', '-', 'Armadura, CA 11 + Mod Des', 'A proteção básica e flexível, preferida por patrulheiros e ladinos.'), 
      ('Adaga', 0.5, '1d4', 'Perfurante', 'Arma, Acuidade, Leve, Arremesso (6/18m)', 'Pequena, mortal e fácil de esconder.'), 
      ('Besta Leve', 2.5, '1d8', 'Perfurante', 'Arma, Munição (24/96m), Recarga, Duas mãos', 'Atira virotes com força letal, mas exige tempo para recarregar.'), 
      ('Aljava com 20 Virotes', 0.75, '-', '-', 'Munição para Besta', 'Munição essencial para balestras e bestas.'), 
      ('Foco Arcano', 0.5, '-', '-', 'Amuleto, Foco Arcano', 'Um cristal, orbe ou varinha que canaliza a magia de magos e bruxos.'), 
      ('Maça', 2.0, '1d6', 'Concussão', 'Arma', 'Uma arma pesada de contusão, frequentemente usada por clérigos.'), 
      ('Cota de Malha', 27.5, '-', '-', 'Armadura, CA 16, Desv. Furtividade, Força Mín. 13', 'Anéis de metal entrelaçados que oferecem grande proteção, mas são barulhentos.'), 
      ('Escudo', 3.0, '-', '-', 'Escudo, CA +2', 'Proteção adicional empunhada na mão secundária.'), 
      ('Símbolo Sagrado', 0.0, '-', '-', 'Amuleto, Foco Divino', 'A representação da fé de um clérigo ou paladino, usada para conjurar milagres.'), 
      ('Cimitarra', 1.5, '1d6', 'Cortante', 'Arma, Acuidade, Leve', 'Uma espada de lâmina curva, muito usada por elfos e druidas marciais.'), 
      ('Foco Druídico', 0.0, '-', '-', 'Amuleto, Foco Druídico', 'Um ramo de azevinho ou um totem de madeira que canaliza a magia da natureza.'), 
      ('Espada Longa', 1.5, '1d8', 'Cortante', 'Arma, Versátil (1d10)', 'A arma padrão dos guerreiros e cavaleiros, confiável e letal.'), 
      ('Arco Curto', 1.0, '1d6', 'Perfurante', 'Arma, Munição (24/96m), Duas mãos', 'Um arco compacto, excelente para caçadores em florestas densas.'), 
      ('Aljava com 20 Flechas', 0.5, '-', '-', 'Munição para Arcos', 'Munição padrão para arcos curtos e longos.'), 
      ('Ferramentas de Ladrão', 0.5, '-', '-', 'Ferramenta, Proficiência em Fechaduras', 'Um estojo de couro contendo gazuas, pinças e outras ferramentas suspeitas.'), 
      ('Bordão', 2.0, '1d6', 'Concussão', 'Arma, Versátil (1d8)', 'Um simples cajado de madeira, usado para caminhadas e auto-defesa.'), 
      ('Livro de Magias', 1.5, '-', '-', 'Outro, Grimório de Mago', 'Um grimório contendo anotações arcanas e feitiços estudados.'), 
      ('Espada Curta', 1.0, '1d6', 'Perfurante', 'Arma, Acuidade, Leve', 'Mais longa que uma adaga, mortal nas mãos de quem sabe usar a agilidade.'), 
      ('10 Dardos', 1.25, '1d4', 'Perfurante', 'Arma, Acuidade, Arremesso (6/18m)', 'Pequenos projéteis de arremesso, perfeitos para monges.'), 
      ('Armadura de Couro Batido', 6.5, '-', '-', 'Armadura, CA 12 + Mod Des', 'Couro reforçado com rebites de metal, excelente equilíbrio de proteção e mobilidade.'), 
      ('Arco Longo', 1.0, '1d8', 'Perfurante', 'Arma, Munição (45/180m), Pesada, Duas mãos', 'Uma arma poderosa que exige as duas mãos e boa postura para atirar longe.'), 
      ('Mochila', 2.5, '-', '-', 'Mochila/Saco, Cap. 15kg', 'Mochila padrão de aventureiro com vários compartimentos.'), 
      ('Saco de dormir', 3.5, '-', '-', 'Outro, Descansos longos', 'Um rolo de tecido grosso, essencial para descansar em viagens longas.'), 
      ('Kit de refeição', 0.5, '-', '-', 'Ferramenta, Copo, Talheres', 'Uma caixa de latão contendo um copo e talheres simples.'), 
      ('Caixa de fogo', 0.5, '-', '-', 'Ferramenta, Isqueiro', 'Uma pequena caixa contendo pederneira e isca para acender fogueiras.'), 
      ('Tocha', 0.5, '1 de Fogo', '-', 'Outro, Luz 6m (1 hora)', 'Um pedaço de madeira com tecido embebido em óleo na ponta.'), 
      ('Ração (1 dia)', 1.0, '-', '-', 'Consumível, Alimento', 'Alimentos secos e compactos, suficientes para um dia inteiro de caminhada.'), 
      ('Odre (cheio)', 2.5, '-', '-', 'Consumível, 2 Litros', 'Um recipiente de couro costurado, essencial para carregar água.'), 
      ('Corda de Cânhamo (15m)', 5.0, '-', '-', 'Ferramenta, 2 PV (CD 17)', 'Corda rústica, mas forte, capaz de aguentar o peso de um anão adulto.'), 
      ('Roupas Comuns', 1.5, '-', '-', 'Capa, Camponês', 'Vestimentas simples, sem adornos.'), 
      ('Vela', 0.01, '-', '-', 'Outro, Luz 1,5m (1 hora)', 'Oferece uma luz fraca, mas essencial para leitura noturna.'), 
      ('Kit de Disfarce', 1.5, '-', '-', 'Ferramenta, Cosméticos', 'Cosméticos, tintas de cabelo e adereços falsos para mudar a aparência.'), 
      ('Livro', 2.5, '-', '-', 'Outro, Contos', 'Um livro de contos, fábulas ou estudos variados.'), 
      ('Vidro de Tinta', 0.0, '-', '-', 'Outro, 30g', 'Um frasquinho pequeno de tinta negra.'), 
      ('Caneta-tinteiro', 0.0, '-', '-', 'Ferramenta', 'Uma pena afiada pronta para uso.'), 
      ('Pergaminho', 0.0, '-', '-', 'Outro', 'Folha parda de pergaminho em branco.'), 
      ('Faca pequena', 0.25, '1d4', 'Cortante', 'Ferramenta', 'Uma faca de utilidade geral, usada mais para cortar cordas do que inimigos.'), 
      ('Cobertor', 1.5, '-', '-', 'Outro, Proteção de frio', 'Manta de lã grossa.'), 
      ('Caixa de Esmolas', 0.5, '-', '-', 'Outro', 'Usada por monges e clérigos para coletar donativos.'), 
      ('Incensário', 0.5, '-', '-', 'Outro', 'Para queimar incenso em cerimônias e limpezas astrais.'), 
      ('Vestes', 2.0, '-', '-', 'Capa, Ritualísticas', 'Vestimentas cerimonias usadas pelo clero e magos.'), 
      ('Saco de Esferas de Metal', 1.0, '-', '-', 'Outro, Criaturas caem (Des CD10)', 'Ao serem espalhadas pelo chão, transformam a área num perigo escorregadio.'), 
      ('Fio (3m)', 0.0, '-', '-', 'Ferramenta, Armadilhas', 'Um fio quase invisível, muito usado por patrulheiros e assassinos.'), 
      ('Sino', 0.0, '-', '-', 'Ferramenta, Alarme', 'Um sininho de latão.'), 
      ('Pé de cabra', 2.5, '-', '-', 'Ferramenta, Vantagem Força', 'Ajuda muito na hora de arrombar portas ou quebrar baús.'), 
      ('Martelo', 1.5, '-', '-', 'Ferramenta', 'Um martelo de utilidade comum, usado com pitões.'), 
      ('Pitão', 0.1, '-', '-', 'Ferramenta, Ancorar cordas', 'Estacas de ferro para fixar cordas em paredes ou desfiladeiros.'), 
      ('Lanterna Furta-Fogo', 1.0, '-', '-', 'Ferramenta, Cone 18m', 'Possui abas que permitem direcionar a luz, focando-a num ponto específico.'), 
      ('Frasco de Óleo', 0.5, '5 Fogo', '-', 'Consumível, Combustível', 'Serve de combustível para lanternas ou pode ser arremessado e incendiado.'),
      ('Alabarda', 3.0, '1d10', 'Cortante', 'Arma, Pesada, Alcance, Duas mãos', 'Uma haste longa terminando numa lâmina de machado mortífera.'),
      ('Glaive', 3.0, '1d10', 'Cortante', 'Arma, Pesada, Alcance, Duas mãos', 'Uma haste longa com uma lâmina de espada na ponta.'),
      ('Lança de Montaria', 3.0, '1d12', 'Perfurante', 'Arma, Alcance, Especial', 'Usada por cavaleiros em disparada. É pesada e difícil de usar a pé.'),
      ('Tridente', 2.0, '1d6', 'Perfurante', 'Arma, Arremesso (6/18m), Versátil (1d8)', 'Arma favorita de caçadores de feras marinhas e gladiadores.'),
      ('Chicote', 1.5, '1d4', 'Cortante', 'Arma, Acuidade, Alcance', 'Ataques ágeis a longas distâncias.'),
      ('Rede', 1.5, '-', '-', 'Arma, Arremesso (1,5/4,5m), Especial (Contenção)', 'Permite imobilizar criaturas ao jogá-la sobre elas.'),
      ('Escaleta', 0.5, '-', '-', 'Ferramenta, Instrumento musical', 'Pequeno instrumento de sopro com teclas.'),
      ('Flauta', 0.5, '-', '-', 'Ferramenta, Instrumento musical', 'Instrumento leve e doce, amado por bardos na natureza.'),
      ('Tambor', 1.5, '-', '-', 'Ferramenta, Instrumento musical', 'Instrumento de percussão, excelente para ditar ritmos de marcha.'),
      ('Gibão de Peles', 6.0, '-', '-', 'Armadura, CA 12 + Mod Des (Máx 2)', 'Uma armadura pesada de couro e pele, típica de tribos bárbaras.'),
      ('Brunida', 22.5, '-', '-', 'Armadura, CA 14 + Mod Des (Máx 2), Desv. Furtividade', 'Placas de metal costuradas sobre o couro.'),
      ('Placas (Armadura Completa)', 32.5, '-', '-', 'Armadura, CA 18, Desv. Furtividade, Força Mín. 15', 'O ápice da proteção medieval. Cara, pesada, e impenetrável.'),
      ('Poção de Cura', 0.25, 'Cura 2d4+2', '-', 'Consumível', 'Um frasco contendo um líquido vermelho brilhante que cura ferimentos mágicamente.'),
      ('Antitoxina', 0.0, '-', '-', 'Consumível, Vantagem contra veneno (1 hora)', 'Soro alquímico que purifica o sangue.'),
      ('Água Benta (Frasco)', 0.5, '2d6 Radiante', '-', 'Consumível, Arremesso', 'Água abençoada, mortal contra mortos-vivos e demônios.'),
      ('Ácido (Frasco)', 0.5, '2d6 Ácido', '-', 'Consumível, Arremesso', 'Um frasco de vidro contendo uma substância que corrói tudo o que toca.'),
      ('Veneno Básico (Frasco)', 0.0, '1d4 Veneno', '-', 'Consumível, Dura 1 minuto', 'Pode ser aplicado na lâmina de uma arma por um tempo determinado.'),
      ('Algemas', 1.0, '-', '-', 'Ferramenta, Prende criaturas', 'Feitas de ferro sólido com trancas difíceis de quebrar.'),
      ('Arpéu', 2.0, '-', '-', 'Ferramenta, Escalada', 'Um gancho de ferro para atirar com cordas e subir muros altos.'),
      ('Luneta', 0.5, '-', '-', 'Ferramenta, Observação', 'Tubo óptico caro que permite enxergar a grandes distâncias.'),
      ('Ampulheta', 0.5, '-', '-', 'Ferramenta, Mede 1 hora', 'Mede exatamente uma hora ao deixar a areia cair.'),
      ('Lupa', 0.0, '-', '-', 'Ferramenta, Ver detalhes', 'Lente que dá vantagem para investigar documentos e pequenos vestígios.'),
      ('Kit de Primeiros Socorros', 1.5, '-', '-', 'Ferramenta, Consumível (10 usos)', 'Contém ataduras e bálsamos, necessários para estabilizar os caídos.'),
      ('Kit de Herbalismo', 1.5, '-', '-', 'Ferramenta, Proficiência poções', 'Kit especializado para identificar plantas e fabricar poções.'),
      ('Kit de Venenos', 1.0, '-', '-', 'Ferramenta, Proficiência venenos', 'Pequenos frascos e funis para extrair e criar venenos letais.'),
      ('Ferramentas de Navegador', 1.0, '-', '-', 'Ferramenta, Marítima', 'Compassos, esquadros e cartas náuticas.'),
      ('Ferramentas de Ferreiro', 4.0, '-', '-', 'Ferramenta, Metalurgia', 'Pinças, pequenos martelos e itens para reparos rápidos em armaduras.'),
      ('Roupas Finas', 3.0, '-', '-', 'Capa, Nobreza', 'Roupas de seda, cetim e veludo com bordados.'),
      ('Roupas de Viagem', 2.0, '-', '-', 'Capa, Climas variados', 'Botas resistentes e capas enceradas, duráveis para o clima duro.'),
      ('Roupas de Frio', 2.0, '-', '-', 'Capa, Temperaturas congelantes', 'Peles e casacos projetados para regiões polares.'),
      ('Tenda (2 pessoas)', 10.0, '-', '-', 'Outro, Abrigo', 'Fácil de montar, protege das chuvas moderadas.'),
      ('Pá', 2.5, '-', '-', 'Ferramenta, Escavação', 'Ferramenta simples, mas excelente para encontrar tesouros escondidos.'),
      ('Picareta de Mineração', 5.0, '1d8', 'Perfurante', 'Ferramenta, Trabalho', 'Eficaz para quebrar pedras ou crânios desprevenidos.'),
      ('Balde', 1.0, '-', '-', 'Mochila/Saco, 10 litros', 'Um balde comum de madeira e anéis de ferro.'),
      ('Cesto', 1.0, '-', '-', 'Mochila/Saco, 10kg de carga', 'Cesto trançado feito de junco.'),
      ('Frasco de Vidro', 0.0, '-', '-', 'Outro', 'Capacidade: 120ml de líquido. Usado para guardar tintas, poções não identificadas ou amostras.'),
      ('Espelho de Aço', 0.25, '-', '-', 'Ferramenta, Polido', 'Útil para sinalizar a distância usando o sol ou olhar ao redor de esquinas.'),
      ('Sabão', 0.0, '-', '-', 'Outro, Higiene', 'Um pequeno bloco de banha e cinzas, com perfume rústico.'),
      ('Giz (1 pedaço)', 0.0, '-', '-', 'Outro, Marcar superfícies', 'Muito usado para marcar mapas de labirintos e portas testadas.'),
      ('Cadeado', 0.5, '-', '-', 'Ferramenta, Com chave', 'Acompanha a chave. Bom para trancar baús de espólio.'),
      ('Corrente (3m)', 5.0, '-', '-', 'Ferramenta, 10 PV', 'Forte corrente de aço.'),
      ('Arame (15m)', 0.5, '-', '-', 'Ferramenta, Metal fino', 'Rolo de arame flexível.'),
      ('Pena de Escrita', 0.0, '-', '-', 'Ferramenta, Caligrafia', 'Uma pena de ave resistente, boa para escrever tomos e cartas.'),
      ('Lacre (Cera)', 0.0, '-', '-', 'Consumível, Selar cartas', 'Um pequeno bastão de cera vermelha.'),
      ('Sinete', 0.0, '-', '-', 'Ferramenta, Brasão pessoal', 'Anel ou selo com o brasão familiar, usado em cera derretida.'),
      ('Meia-Placa Githyanki', 20.0, '-', '-', 'Armadura, CA 15 + Mod Des (Máx 2)', 'Uma armadura formidável e ornamentada, forjada no plano astral.'),
      ('Vestes de Mago', 2.0, '-', '-', 'Capa, Arcano', 'Vestimentas reforçadas magicamente para estudiosos de Waterdeep.');
    `);

    await db.execAsync(`INSERT INTO starting_kits (name, target_name, target_type, items) VALUES
      ('Kit de Assalto (Ofensivo)', 'Bárbaro', 'class', '[{"name":"Machado Grande","qty":1},{"name":"Machadinha","qty":2},{"name":"Mochila","qty":1},{"name":"Ração (1 dia)","qty":3}]'),
      ('Kit de Sobrevivência (Prudente)', 'Bárbaro', 'class', '[{"name":"Espada Longa","qty":1},{"name":"Azagaia","qty":4},{"name":"Armadura de Couro","qty":1},{"name":"Mochila","qty":1},{"name":"Corda de Cânhamo (15m)","qty":1}]'),
      ('Kit do Artista Viajante', 'Bardo', 'class', '[{"name":"Rapieira","qty":1},{"name":"Alaúde","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Roupas Finas","qty":1}]'),
      ('Kit do Espião', 'Bardo', 'class', '[{"name":"Espada Curta","qty":1},{"name":"Kit de Disfarce","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Adaga","qty":2}]'),
      ('Kit do Cultista', 'Bruxo', 'class', '[{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Adaga","qty":2}]'),
      ('Kit da Lâmina Sombria', 'Bruxo', 'class', '[{"name":"Espada Curta","qty":2},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Poção de Cura","qty":1}]'),
      ('Kit Linha de Frente', 'Clérigo', 'class', '[{"name":"Maça","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Escudo","qty":1},{"name":"Símbolo Sagrado","qty":1}]'),
      ('Kit Curandeiro Divino', 'Clérigo', 'class', '[{"name":"Maça","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Símbolo Sagrado","qty":1},{"name":"Poção de Cura","qty":2},{"name":"Kit de Primeiros Socorros","qty":1}]'),
      ('Kit Forma Selvagem', 'Druida', 'class', '[{"name":"Cimitarra","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1},{"name":"Escudo","qty":1}]'),
      ('Kit Xamã Protetor', 'Druida', 'class', '[{"name":"Bordão","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1},{"name":"Kit de Herbalismo","qty":1}]'),
      ('Kit Fogo Cruzado', 'Feiticeiro', 'class', '[{"name":"Adaga","qty":2},{"name":"Foco Arcano","qty":1},{"name":"Poção de Cura","qty":1},{"name":"Tocha","qty":3}]'),
      ('Kit Estudioso', 'Feiticeiro', 'class', '[{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Vidro de Tinta","qty":1},{"name":"Caneta-tinteiro","qty":1}]'),
      ('Kit Colosso (Tanque)', 'Guerreiro', 'class', '[{"name":"Cota de Malha","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1}]'),
      ('Kit Franco-Atirador', 'Guerreiro', 'class', '[{"name":"Armadura de Couro","qty":1},{"name":"Arco Longo","qty":1},{"name":"Aljava com 20 Flechas","qty":1},{"name":"Espada Curta","qty":2}]'),
      ('Kit Ladrão Clássico', 'Ladino', 'class', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Ferramentas de Ladrão","qty":1},{"name":"Adaga","qty":2}]'),
      ('Kit Assassino Noturno', 'Ladino', 'class', '[{"name":"Espada Curta","qty":2},{"name":"Armadura de Couro","qty":1},{"name":"Kit de Venenos","qty":1},{"name":"Arco Curto","qty":1},{"name":"Aljava com 20 Flechas","qty":1}]'),
      ('Kit Arcano Padrão', 'Mago', 'class', '[{"name":"Bordão","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1},{"name":"Mochila","qty":1}]'),
      ('Kit Mago Pesquisador', 'Mago', 'class', '[{"name":"Adaga","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1},{"name":"Pergaminho","qty":5},{"name":"Caneta-tinteiro","qty":1}]'),
      ('Kit Monge Marcial', 'Monge', 'class', '[{"name":"Espada Curta","qty":1},{"name":"10 Dardos","qty":1},{"name":"Mochila","qty":1},{"name":"Poção de Cura","qty":1}]'),
      ('Kit Monge Peregrino', 'Monge', 'class', '[{"name":"Bordão","qty":1},{"name":"10 Dardos","qty":1},{"name":"Roupas de Viagem","qty":1},{"name":"Caixa de Esmolas","qty":1}]'),
      ('Kit Cruzado Sagrado', 'Paladino', 'class', '[{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Símbolo Sagrado","qty":1}]'),
      ('Kit Justiceiro Implacável', 'Paladino', 'class', '[{"name":"Alabarda","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Símbolo Sagrado","qty":1},{"name":"Azagaia","qty":4}]'),
      ('Kit Batedor das Matas', 'Patrulheiro', 'class', '[{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Longo","qty":1},{"name":"Aljava com 20 Flechas","qty":1},{"name":"Espada Curta","qty":2}]'),
      ('Kit Caçador de Monstros', 'Patrulheiro', 'class', '[{"name":"Armadura de Couro","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Corda de Cânhamo (15m)","qty":1},{"name":"Fio (3m)","qty":1}]'),
      ('Origem: Lae''zel', 'Guerreiro', 'bg3', '[{"name":"Espada Longa","qty":1},{"name":"Meia-Placa Githyanki","qty":1},{"name":"Arco Curto","qty":1},{"name":"Aljava com 20 Flechas","qty":1}]'),
      ('Origem: Gale', 'Mago', 'bg3', '[{"name":"Bordão","qty":1},{"name":"Vestes de Mago","qty":1},{"name":"Poção de Cura","qty":2},{"name":"Livro de Magias","qty":1}]'),
      ('Origem: Astarion', 'Ladino', 'bg3', '[{"name":"Rapieira","qty":1},{"name":"Adaga","qty":2},{"name":"Armadura de Couro Batido","qty":1},{"name":"Kit de Disfarce","qty":1}]'),
      ('Origem: Karlach', 'Bárbaro', 'bg3', '[{"name":"Machado Grande","qty":1},{"name":"Machadinha","qty":2},{"name":"Roupas de Viagem","qty":1}]'),
      ('Origem: Wyll', 'Bruxo', 'bg3', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Poção de Cura","qty":2}]'),
      ('Origem: Shadowheart', 'Clérigo', 'bg3', '[{"name":"Maça","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Símbolo Sagrado","qty":1}]'),
      ('Origem: Minthara', 'Paladino', 'bg3', '[{"name":"Maça","qty":1},{"name":"Escudo","qty":1},{"name":"Meia-Placa Githyanki","qty":1}]'),
      ('Origem: Halsin', 'Druida', 'bg3', '[{"name":"Bordão","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Poção de Cura","qty":3}]'),
      ('Origem: Minsc', 'Patrulheiro', 'bg3', '[{"name":"Espada Longa","qty":1},{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Curto","qty":1}]');
    `);

    await db.execAsync(`INSERT INTO races (name, stat_bonuses, speed, features) VALUES 
      ('Anão', '{"CON": 2}', '7,5m', '[]'), 
      ('Draconato', '{"FOR": 2, "CAR": 1}', '9m', '[]'), 
      ('Elfo', '{"DES": 2}', '9m', '["Visão no Escuro"]'), 
      ('Gnomo', '{"INT": 2}', '7,5m', '[]'), 
      ('Halfling', '{"DES": 2}', '7,5m', '[]'), 
      ('Humano', '{"FOR": 1, "DES": 1, "CON": 1, "INT": 1, "SAB": 1, "CAR": 1}', '9m', '[]'), 
      ('Meio-Elfo', '{"CAR": 2, "DES": 1, "CON": 1}', '9m', '[]'), 
      ('Meio-Orc', '{"FOR": 2, "CON": 1}', '9m', '[]'), 
      ('Tiefling', '{"CAR": 2, "INT": 1}', '9m', '[]'),
      ('Githyanki', '{"FOR": 2, "INT": 1}', '9m', '["Mãos Mágicas (Githyanki)"]'), 
      ('Alto Elfo', '{"DES": 2, "INT": 1}', '9m', '["Visão no Escuro"]'), 
      ('Drow', '{"DES": 2, "CAR": 1}', '9m', '["Visão no Escuro"]'), 
      ('Elfo da Floresta', '{"DES": 2, "SAB": 1}', '10,5m', '["Visão no Escuro"]');
    `);

    // ** ATENÇÃO: As classes Bardo, Ladino e Monge agora possuem suas passivas básicas vinculadas! **
    await db.execAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster, features) VALUES 
      ('Bárbaro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Machado Grande","qty":1},{"name":"Mochila","qty":1},{"name":"Saco de dormir","qty":1},{"name":"Tocha","qty":5}]', 10, 12, '["save_for", "save_con"]', 3, 0, '["Fúria", "Defesa Sem Armadura"]'),
      ('Bardo', '{"FOR": 8, "DES": 14, "CON": 13, "INT": 12, "SAB": 10, "CAR": 15}', '[{"name":"Rapieira","qty":1},{"name":"Alaúde","qty":1},{"name":"Armadura de Couro","qty":1}]', 15, 8, '["save_des", "save_car"]', 3, 1, '["Inspiração Bárdica"]'),
      ('Bruxo', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Besta Leve","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1}]', 10, 8, '["save_sab", "save_car"]', 1, 1, '[]'),
      ('Clérigo', '{"FOR": 14, "DES": 10, "CON": 13, "INT": 8, "SAB": 15, "CAR": 12}', '[{"name":"Maça","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Escudo","qty":1}]', 15, 8, '["save_sab", "save_car"]', 1, 1, '[]'),
      ('Druida', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 12, "SAB": 15, "CAR": 10}', '[{"name":"Cimitarra","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1}]', 10, 8, '["save_int", "save_sab"]', 2, 1, '[]'),
      ('Feiticeiro', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Adaga","qty":2},{"name":"Foco Arcano","qty":1}]', 10, 6, '["save_con", "save_car"]', 1, 1, '[]'),
      ('Guerreiro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Cota de Malha","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1}]', 15, 10, '["save_for", "save_con"]', 3, 0, '["Segundo Fôlego"]'),
      ('Ladino', '{"FOR": 8, "DES": 15, "CON": 14, "INT": 12, "SAB": 10, "CAR": 13}', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Ferramentas de Ladrão","qty":1}]', 15, 8, '["save_des", "save_int"]', 3, 0, '["Ataque Furtivo", "Especialização (Ladino)"]'),
      ('Mago', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 15, "SAB": 12, "CAR": 10}', '[{"name":"Bordão","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1}]', 10, 6, '["save_int", "save_sab"]', 2, 1, '[]'),
      ('Monge', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Espada Curta","qty":1},{"name":"10 Dardos","qty":1}]', 5, 8, '["save_for", "save_des"]', 3, 0, '["Artes Marciais", "Defesa Sem Armadura (Monge)"]'),
      ('Paladino', '{"FOR": 15, "DES": 10, "CON": 13, "INT": 8, "SAB": 12, "CAR": 14}', '[{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1}]', 15, 10, '["save_sab", "save_car"]', 3, 0, '["Imposição das Mãos", "Sentido Divino"]'),
      ('Patrulheiro', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Longo","qty":1}]', 12, 10, '["save_for", "save_des"]', 3, 0, '["Inimigo Favorito", "Explorador Nato"]');
    `);

    await db.execAsync(`INSERT INTO saving_throws (id, name, stat) VALUES ('save_for', 'Força', 'FOR'), ('save_des', 'Destreza', 'DES'), ('save_con', 'Constituição', 'CON'), ('save_int', 'Inteligência', 'INT'), ('save_sab', 'Sabedoria', 'SAB'), ('save_car', 'Carisma', 'CAR');`);
    await db.execAsync(`INSERT INTO skills (id, name, stat) VALUES ('skill_acrobacia', 'Acrobacia', 'DES'), ('skill_arcanismo', 'Arcanismo', 'INT'), ('skill_atletismo', 'Atletismo', 'FOR'), ('skill_atuacao', 'Atuação', 'CAR'), ('skill_blefar', 'Enganação / Blefar', 'CAR'), ('skill_furtividade', 'Furtividade', 'DES'), ('skill_historia', 'História', 'INT'), ('skill_intimidacao', 'Intimidação', 'CAR'), ('skill_intuicao', 'Intuição', 'SAB'), ('skill_investigacao', 'Investigação', 'INT'), ('skill_lidar_animais', 'Lidar com Animais', 'SAB'), ('skill_medicina', 'Medicina', 'SAB'), ('skill_natureza', 'Natureza', 'INT'), ('skill_percepcao', 'Percepção', 'SAB'), ('skill_persuasao', 'Persuasão', 'CAR'), ('skill_prestidigitacao', 'Prestidigitação', 'DES'), ('skill_religiao', 'Religião', 'INT'), ('skill_sobrevivencia', 'Sobrevivência', 'SAB');`);
    
    // MAGIAS E HABILIDADES ATUALIZADAS COM A CATEGORIA CORRETA E NOVAS HABILIDADES
    await db.execAsync(`INSERT INTO spells (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, class_level_required) VALUES 
      -- TRUQUES (Todos são 'Magia')
      ('Amizade', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Pessoal', 'S, M', '1 Minuto', '-', 'Nenhum', 'CAR', 'Vantagem em testes de Carisma contra não hostis.', 1),
      ('Bordão Mágico', 'Truque', 'Magia', 'Druida', '1 Ação Bônus', 'Toque', 'V, S, M', '1 Minuto', '1d8', 'Concussão', 'Nenhum', 'Arma torna-se mágica e usa habilidade de conjuração.', 1),
      ('Chama Sagrada', 'Truque', 'Magia', 'Clérigo', '1 Ação', '18m', 'V, S', 'Instantânea', '1d8', 'Radiante', 'DES', 'Alvo deve passar em Destreza ou sofrer dano.', 1),
      ('Chicote de Espinhos', 'Truque', 'Magia', 'Druida', '1 Ação', '9m', 'V, S, M', 'Instantânea', '1d6', 'Perfurante', 'Nenhum', 'Ataque mágico que puxa o alvo.', 1),
      ('Consertar', 'Truque', 'Magia', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Minuto', 'Toque', 'V, S, M', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Repara um único dano.', 1),
      ('Criar Chamas', 'Truque', 'Magia', 'Druida', '1 Ação', 'Pessoal', 'V, S', '10 Minutos', '1d8', 'Fogo', 'Nenhum', 'Chama na mão.', 1),
      ('Estabilizar', 'Truque', 'Magia', 'Clérigo', '1 Ação', 'Toque', 'V, S', 'Instantânea', '-', 'Cura', 'Nenhum', 'Criatura a 0 PV torna-se estável.', 1),
      ('Globos de Luz', 'Truque', 'Magia', 'Bardo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Luzes flutuantes.', 1),
      ('Guia', 'Truque', 'Magia', 'Clérigo,Druida', '1 Ação', 'Toque', 'V, S', 'Concentração', '+1d4', 'Força', 'Nenhum', 'Alvo adiciona 1d4 em teste.', 1),
      ('Ilusão Menor', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'S, M', '1 Minuto', '-', 'Nenhum', 'INT', 'Cria som ou imagem.', 1),
      ('Luz', 'Truque', 'Magia', 'Bardo,Clérigo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, M', '1 Hora', '-', 'Nenhum', 'DES', 'Objeto brilha.', 1),
      ('Mãos Mágicas', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'V, S', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Mão espectral.', 1),
      ('Mensagem', 'Truque', 'Magia', 'Bardo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', '1 Rodada', '-', 'Nenhum', 'Nenhum', 'Sussurra mensagem.', 1),
      ('Prestidigitação', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '3m', 'V, S', '1 Hora', '-', 'Nenhum', 'Nenhum', 'Efeitos simples.', 1),
      ('Raio de Fogo', 'Truque', 'Magia', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '1d10', 'Fogo', 'Nenhum', 'Rajada mágica.', 1),
      ('Raio de Gelo', 'Truque', 'Magia', 'Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '1d8', 'Frio', 'Nenhum', 'Reduz deslocamento.', 1),
      ('Rajada Mística', 'Truque', 'Magia', 'Bruxo', '1 Ação', '36m', 'V, S', 'Instantânea', '1d10', 'Força', 'Nenhum', 'Feixe de energia.', 1),
      ('Rajada de Veneno', 'Truque', 'Magia', 'Bruxo,Druida,Feiticeiro,Mago', '1 Ação', '3m', 'V, S', 'Instantânea', '1d12', 'Veneno', 'CON', 'Névoa tóxica.', 1),
      ('Resistência', 'Truque', 'Magia', 'Clérigo,Druida', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '+1d4', 'Força', 'Nenhum', 'Soma 1d4 em resistência.', 1),
      ('Taumaturgia', 'Truque', 'Magia', 'Clérigo', '1 Ação', '9m', 'V', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Manifestações divinas.', 1),
      ('Toque Arrepiante', 'Truque', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S', '1 Rodada', '1d8', 'Necrótico', 'Nenhum', 'Alvo não cura.', 1),
      ('Toque Chocante', 'Truque', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S', 'Instantânea', '1d8', 'Elétrico', 'Nenhum', 'Alvo perde Reação.', 1),
      ('Zombaria Viciosa', 'Truque', 'Magia', 'Bardo', '1 Ação', '18m', 'V', 'Instantânea', '1d4', 'Psíquico', 'SAB', 'Desvantagem no ataque.', 1),
      ('Proteção contra Lâminas', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S', '1 Rodada', '-', 'Nenhum', 'Nenhum', 'Resistência a dano físico.', 1),
      ('Espirro Ácido', 'Truque', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '1d6', 'Ácido', 'DES', 'Bolha ácida.', 1),
      ('Golpe Certeiro', 'Truque', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'S', 'Concentração', '-', 'Outro', 'Nenhum', 'Vantagem no ataque.', 1),

      -- NÍVEL 1
      ('Alarme', 'Nível 1', 'Magia', 'Patrulheiro,Mago', '1 Minuto', '9m', 'V, S, M', '8 Horas', '-', 'Nenhum', 'Nenhum', 'Alerta se criatura entrar na área.', 2),
      ('Armadura Arcana', 'Nível 1', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', '8 Horas', '-', 'Nenhum', 'Nenhum', 'CA base = 13 + Mod Des.', 1),
      ('Armadura de Agathys', 'Nível 1', 'Magia', 'Bruxo', '1 Ação', 'Pessoal', 'V, S, M', '1 Hora', '5', 'Frio', 'Nenhum', 'Ganha 5 PV temporários e causa 5 dano.', 1),
      ('Bênção', 'Nível 1', 'Magia', 'Clérigo,Paladino', '1 Ação', '9m', 'V, S, M', 'Concentração', '+1d4', 'Força', 'Nenhum', 'Soma 1d4 em ataques.', 1),
      ('Bom Fruto', 'Nível 1', 'Magia', 'Druida,Patrulheiro', '1 Ação', 'Toque', 'V, S, M', 'Instantânea', '1', 'Cura', 'Nenhum', 'Cria 10 frutos curativos.', 1),
      ('Bruxaria', 'Nível 1', 'Magia', 'Bruxo', '1 Ação Bônus', '27m', 'V, S, M', 'Concentração', '1d6', 'Necrótico', 'Nenhum', 'Dano extra e desvantagem.', 1),
      ('Comando', 'Nível 1', 'Magia', 'Clérigo,Paladino', '1 Ação', '18m', 'V', '1 Rodada', '-', 'Nenhum', 'SAB', 'Ordem de uma palavra.', 1),
      ('Curar Ferimentos', 'Nível 1', 'Magia', 'Bardo,Clérigo,Druida,Paladino,Patrulheiro', '1 Ação', 'Toque', 'V, S', 'Instantânea', '1d8', 'Cura', 'Nenhum', 'Cura criatura tocada.', 1),
      ('Detectar Magia', 'Nível 1', 'Magia', 'Clérigo,Druida,Feiticeiro,Mago,Paladino', '1 Ação', 'Pessoal', 'V, S', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Percebe aura de magias.', 1),
      ('Enfeitiçar Pessoa', 'Nível 1', 'Magia', 'Bardo,Bruxo,Druida,Feiticeiro,Mago', '1 Ação', '9m', 'V, S', '1 Hora', '-', 'Nenhum', 'SAB', 'Humanoide encantado.', 1),
      ('Escudo Arcano', 'Nível 1', 'Magia', 'Feiticeiro,Mago', '1 Reação', 'Pessoal', 'V, S', '1 Rodada', '-', 'Nenhum', 'Nenhum', '+5 na CA.', 1),
      ('Fogo das Fadas', 'Nível 1', 'Magia', 'Bardo,Druida', '1 Ação', '18m', 'V', 'Concentração', '-', 'Nenhum', 'DES', 'Alvos brilham, vantagem.', 1),
      ('Mãos Flamejantes', 'Nível 1', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Cone', 'V, S', 'Instantânea', '3d6', 'Fogo', 'DES', 'Rajada de chamas.', 1),
      ('Mísseis Mágicos', 'Nível 1', 'Magia', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '3x 1d4+1', 'Força', 'Nenhum', 'Três dardos que atingem.', 1),
      ('Onda Trovejante', 'Nível 1', 'Magia', 'Bardo,Druida,Feiticeiro,Mago', '1 Ação', 'Cubo', 'V, S', 'Instantânea', '2d8', 'Trovejante', 'CON', 'Empurra criaturas 3m.', 1),
      ('Palavra Curativa', 'Nível 1', 'Magia', 'Bardo,Clérigo,Druida', '1 Ação Bônus', '18m', 'V', 'Instantânea', '1d4', 'Cura', 'Nenhum', 'Cura rápida a distância.', 1),
      ('Riso de Tasha', 'Nível 1', 'Magia', 'Bardo,Mago', '1 Ação', '9m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Alvo ri incontrolavelmente.', 1),
      ('Sono', 'Nível 1', 'Magia', 'Bardo,Feiticeiro,Mago', '1 Ação', '27m', 'V, S, M', '1 Minuto', '5d8', 'Outro', 'Nenhum', 'Põe criaturas em sono mágico.', 1),
      ('Escudo da Fé', 'Nível 1', 'Magia', 'Clérigo,Paladino', '1 Ação Bônus', '18m', 'V, S, M', 'Concentração', '+2', 'Outro', 'Nenhum', '+2 na CA de um aliado.', 1),
      ('Passos Longos', 'Nível 1', 'Magia', 'Bardo,Druida,Patrulheiro,Mago', '1 Ação', 'Toque', 'V, S, M', '1 Hora', '+3m', 'Outro', 'Nenhum', 'Deslocamento aumenta 3m.', 1),
      ('Raio Adoecedor', 'Nível 1', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '2d8', 'Veneno', 'CON', 'Alvo Envenenado.', 1),

      -- NÍVEL 2
      ('Arma Espiritual', 'Nível 2', 'Magia', 'Clérigo', '1 Ação Bônus', '18m', 'V, S', '1 Minuto', '1d8', 'Força', 'Nenhum', 'Arma flutuante ataca.', 3),
      ('Crescer Espinhos', 'Nível 2', 'Magia', 'Druida,Patrulheiro', '1 Ação', '45m', 'V, S, M', 'Concentração', '2d4', 'Perfurante', 'Nenhum', 'Chão vira espinhos.', 3),
      ('Imobilizar Pessoa', 'Nível 2', 'Magia', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Paralisa humanoide.', 3),
      ('Invisibilidade', 'Nível 2', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Alvo invisível.', 3),
      ('Passo Nebuloso', 'Nível 2', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Ação Bônus', 'Pessoal', 'V', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Teletransporte 9m.', 3),
      ('Passos Sem Pegadas', 'Nível 2', 'Magia', 'Druida,Patrulheiro', '1 Ação', 'Pessoal', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', '+10 Furtividade.', 3),
      ('Raio Ardente', 'Nível 2', 'Magia', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '3x 2d6', 'Fogo', 'Nenhum', 'Três raios de fogo.', 3),
      ('Reflexos', 'Nível 2', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Duplicatas ilusórias.', 3),
      ('Teia', 'Nível 2', 'Magia', 'Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'DES', 'Teias prendem.', 3),
      ('Despedaçar', 'Nível 2', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Instantânea', '3d8', 'Trovejante', 'CON', 'Som doloroso.', 3),
      ('Cegueira/Surdez', 'Nível 2', 'Magia', 'Bardo,Clérigo,Feiticeiro,Mago', '1 Ação', '9m', 'V', '1 Minuto', '-', 'Outro', 'CON', 'Cega ou ensurdece.', 3),
      ('Esquentar Metal', 'Nível 2', 'Magia', 'Bardo,Druida', '1 Ação', '18m', 'V, S, M', 'Concentração', '2d8', 'Fogo', 'CON', 'Aquece armaduras.', 3),
      
      -- NÍVEL 3
      ('Bola de Fogo', 'Nível 3', 'Magia', 'Feiticeiro,Mago', '1 Ação', '45m', 'V, S, M', 'Instantânea', '8d6', 'Fogo', 'DES', 'Explosão esférica.', 5),
      ('Contrafeitiço', 'Nível 3', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Reação', '18m', 'S', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Interrompe magia.', 5),
      ('Dissipar Magia', 'Nível 3', 'Magia', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Encerra magias.', 5),
      ('Espíritos Guardiões', 'Nível 3', 'Magia', 'Clérigo', '1 Ação', 'Pessoal', 'V, S, M', 'Concentração', '3d8', 'Radiante', 'SAB', 'Espíritos atacam.', 5),
      ('Relâmpago', 'Nível 3', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S, M', 'Instantânea', '8d6', 'Elétrico', 'DES', 'Linha letal.', 5),
      ('Revivificar', 'Nível 3', 'Magia', 'Clérigo,Paladino', '1 Ação', 'Toque', 'V, S, M', 'Instantânea', '-', 'Cura', 'Nenhum', 'Retorna à vida.', 5),
      ('Velocidade', 'Nível 3', 'Magia', 'Feiticeiro,Mago', '1 Ação', '9m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Dobra deslocamento.', 5),
      ('Voo', 'Nível 3', 'Magia', 'Bruxo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '18m', 'Outro', 'Nenhum', 'Dá voo.', 5),
      ('Padrão Hipnótico', 'Nível 3', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '36m', 'S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Padrão encanta e paralisa.', 5),
      ('Animar Mortos', 'Nível 3', 'Magia', 'Clérigo,Mago', '1 Minuto', '3m', 'V, S, M', 'Instantânea', '-', 'Outro', 'Nenhum', 'Cria zumbis.', 5),

      -- NÍVEL 4 e 5
      ('Muralha de Fogo', 'Nível 4', 'Magia', 'Druida,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', 'Concentração', '5d8', 'Fogo', 'DES', 'Cortina de fogo.', 7),
      ('Polimorfia', 'Nível 4', 'Magia', 'Bardo,Druida,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Transforma em besta.', 7),
      ('Porta Dimensional', 'Nível 4', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '150m', 'V', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Teletransporte vasto.', 7),
      ('Tempestade de Gelo', 'Nível 4', 'Magia', 'Druida,Feiticeiro,Mago', '1 Ação', '90m', 'V, S, M', 'Instantânea', '2d8+4d6', 'Frio', 'DES', 'Nevasca pesada.', 7),
      ('Banimento', 'Nível 4', 'Magia', 'Clérigo,Paladino,Feiticeiro,Bruxo,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Outro', 'CAR', 'Envia ao outro plano.', 7),
      ('Invisibilidade Maior', 'Nível 4', 'Magia', 'Bardo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Não quebra ao atacar.', 7),
      ('Pele de Pedra', 'Nível 4', 'Magia', 'Druida,Patrulheiro,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '-', 'Outro', 'Nenhum', 'Resistência a ataques normais.', 7),

      ('Âncora Planar', 'Nível 5', 'Magia', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Hora', '18m', 'V, S, M', '24 Horas', '-', 'Nenhum', 'CAR', 'Prende um extraplanar.', 9),
      ('Coluna de Chamas', 'Nível 5', 'Magia', 'Clérigo', '1 Ação', '18m', 'V, S, M', 'Instantânea', '4d6+4d6', 'Fogo', 'DES', 'Fogo sagrado descendo.', 9),
      ('Curar Ferimentos em Massa', 'Nível 5', 'Magia', 'Bardo,Clérigo,Druida', '1 Ação', '18m', 'V, S', 'Instantânea', '3d8', 'Cura', 'Nenhum', 'Cura 6 aliados.', 9),
      ('Imobilizar Monstro', 'Nível 5', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '27m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Paralisa qualquer monstro.', 9),
      ('Cone de Frio', 'Nível 5', 'Magia', 'Feiticeiro,Mago', '1 Ação', 'Cone', 'V, S, M', 'Instantânea', '8d8', 'Frio', 'CON', 'Cone congelante de 18m.', 9),
      ('Névoa Mortal', 'Nível 5', 'Magia', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Concentração', '5d8', 'Veneno', 'CON', 'Névoa ácida gigante.', 9),
      ('Dominar Pessoa', 'Nível 5', 'Magia', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Concentração', '-', 'Outro', 'SAB', 'Controla a mente do alvo.', 9),

      -- =========================
      -- HABILIDADES DE CLASSE
      -- =========================
      ('Fúria', 'Nível 1', 'Habilidade', 'Bárbaro', '1 Ação Bônus', 'Pessoal', '-', '1 Minuto', '+2', 'Extra', 'Nenhum', 'Ganha resistência e bônus de dano.', 1),
      ('Defesa Sem Armadura', 'Nível 1', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'CA = 10 + Des + Con.', 1),
      ('Ataque Descuidado', 'Nível 2', 'Habilidade', 'Bárbaro', 'Especial', 'Pessoal', '-', '1 Turno', 'Vantagem', 'Extra', 'Nenhum', 'Ganha vantagem em ataques e concede.', 2),
      ('Sentido de Perigo', 'Nível 2', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Vantagem em resistência Des.', 2),
      ('Movimento Rápido', 'Nível 5', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '+3m', 'Outro', 'Nenhum', 'Mais movimento sem armadura pesada.', 5),
      ('Instinto Selvagem', 'Nível 7', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', 'Vantagem', 'Outro', 'Nenhum', 'Vantagem na Iniciativa.', 7),
      ('Crítico Brutal', 'Nível 9', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '+1 dado', 'Extra', 'Nenhum', 'Dado extra no crítico.', 9),
      ('Fúria Implacável', 'Nível 11', 'Habilidade', 'Bárbaro', 'Reação', 'Pessoal', '-', 'Instantânea', '-', 'Outro', 'CON', 'Fica com 1 PV se cair.', 11),
      ('Presença Intimidante', 'Nível 10', 'Habilidade', 'Bárbaro', '1 Ação', '9m', '-', '1 Rodada', '-', 'Psíquico', 'SAB', 'Amedronta um alvo.', 10),
      ('Campeão Primal', 'Nível 20', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '+4 FOR/CON', 'Outro', 'Nenhum', '+4 Força e Constituição.', 20),

      ('Segundo Fôlego', 'Nível 1', 'Habilidade', 'Guerreiro', '1 Ação Bônus', 'Pessoal', '-', 'Instantânea', '1d10 + nível', 'Cura', 'Nenhum', 'Cura 1d10 + nível.', 1),
      ('Ação Surto', 'Nível 2', 'Habilidade', 'Guerreiro', 'Especial', 'Pessoal', '-', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Ação extra no turno.', 2),
      ('Ataque Extra', 'Nível 5', 'Passiva', 'Guerreiro,Paladino,Patrulheiro', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Nenhum', 'Nenhum', 'Ataca duas vezes.', 5),

      ('Imposição das Mãos', 'Nível 1', 'Habilidade', 'Paladino', '1 Ação', 'Toque', '-', 'Instantânea', '5 x nível', 'Cura', 'Nenhum', 'Reserva de cura.', 1),
      ('Sentido Divino', 'Nível 1', 'Habilidade', 'Paladino', '1 Ação', '18m', '-', '1 Rodada', '-', 'Outro', 'Nenhum', 'Detecta o mal/bem.', 1),
      ('Golpe Divino', 'Nível 2', 'Habilidade', 'Paladino', 'Após acertar', 'Arma', '-', 'Instantânea', '2d8+', 'Radiante', 'Nenhum', 'Gasta espaço para dano.', 2),
      ('Aura de Proteção', 'Nível 6', 'Passiva', 'Paladino', 'Passiva', '3m', '-', 'Permanente', '+CAR', 'Outro', 'Nenhum', 'Bônus em resistências na área.', 6),
      ('Manto do Cruzado', 'Nível 9', 'Magia', 'Paladino', '1 Ação', 'Pessoal', 'V', 'Concentração', '1d4', 'Radiante', 'Nenhum', 'Aura de dano radiante extra.', 9),

      ('Inimigo Favorito', 'Nível 1', 'Passiva', 'Patrulheiro', 'Passiva', 'Pessoal', '-', 'Permanente', '+2', 'Extra', 'Nenhum', 'Dano extra contra alvo.', 1),
      ('Explorador Nato', 'Nível 1', 'Passiva', 'Patrulheiro', 'Passiva', 'Terreno Natural', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Vantagens no terreno.', 1),
      ('Marca do Caçador (Habilidade)', 'Nível 2', 'Habilidade', 'Patrulheiro', '1 Ação Bônus', '27m', '-', 'Concentração', '1d6', 'Extra', 'Nenhum', '1d6 dano no marcado.', 2),

      -- NOVO: HABILIDADES DE LADINO E MONGE E BARDO
      ('Inspiração Bárdica', 'Nível 1', 'Habilidade', 'Bardo', '1 Ação Bônus', '18m', 'V', '10 Minutos', '1d6', 'Extra', 'Nenhum', 'Concede um dado extra para testes, ataques ou resistências.', 1),
      
      ('Ataque Furtivo', 'Nível 1', 'Passiva', 'Ladino', 'Passiva', 'Arma', '-', 'Permanente', '1d6', 'Extra', 'Nenhum', 'Dano extra se tiver vantagem ou aliado adjacente ao alvo.', 1),
      ('Especialização (Ladino)', 'Nível 1', 'Passiva', 'Ladino', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Dobra proficiência em duas perícias.', 1),
      ('Ação Astuta', 'Nível 2', 'Habilidade', 'Ladino', '1 Ação Bônus', 'Pessoal', '-', 'Instantânea', '-', 'Outro', 'Nenhum', 'Pode Esconder, Disparar ou Desengajar como Bônus.', 2),

      ('Artes Marciais', 'Nível 1', 'Passiva', 'Monge', 'Passiva', 'Arma', '-', 'Permanente', '1d4', 'Concussão', 'Nenhum', 'Pode usar DES e bater desarmado com Ação Bônus.', 1),
      ('Defesa Sem Armadura (Monge)', 'Nível 1', 'Passiva', 'Monge', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'CA = 10 + DES + SAB sem armadura.', 1),
      ('Ki: Rajada de Golpes', 'Nível 2', 'Habilidade', 'Monge', '1 Ação Bônus', 'Toque', '-', 'Instantânea', '1d4', 'Concussão', 'Nenhum', 'Gasta 1 Ki para 2 ataques desarmados.', 2),
      ('Ki: Defesa Paciente', 'Nível 2', 'Habilidade', 'Monge', '1 Ação Bônus', 'Pessoal', '-', '1 Turno', '-', 'Outro', 'Nenhum', 'Gasta 1 Ki para Esquivar como Bônus.', 2),
      ('Ki: Passo do Vento', 'Nível 2', 'Habilidade', 'Monge', '1 Ação Bônus', 'Pessoal', '-', '1 Turno', '-', 'Outro', 'Nenhum', 'Gasta 1 Ki para Disparar/Desengajar.', 2),

      -- =========================
      -- HABILIDADES DE SUBCLASSE
      -- =========================
      ('Ataque de Precisão', 'Nível 3', 'Habilidade', 'Guerreiro', 'Reação', 'Arma', '-', 'Instantânea', '+1d8', 'Extra', 'Nenhum', 'Dado superioridade no ataque.', 3),
      ('Ataque de Tropeço', 'Nível 3', 'Habilidade', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Concussão', 'FOR', 'Tenta derrubar alvo.', 3),
      ('Ataque Desarmante', 'Nível 3', 'Habilidade', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Extra', 'FOR', 'Tenta desarmar alvo.', 3),
      ('Ataque Ameaçador', 'Nível 3', 'Habilidade', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Psíquico', 'SAB', 'Tenta amedrontar.', 3),
      ('Ver o Futuro', 'Nível 2', 'Habilidade', 'Mago', 'Reação', 'Pessoal', '-', 'Instantânea', '-', 'Outro', 'Nenhum', 'Substitui dado com presságio.', 2),

      -- =========================
      -- HABILIDADES DE RAÇA E ORIGENS
      -- =========================
      ('Visão no Escuro', 'Passiva', 'Passiva', 'Raça', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Enxerga 18m na penumbra.', 1),

      ('Mãos Mágicas (Githyanki)', 'Truque', 'Magia', 'Guerreiro,Mago', '1 Ação', '9m', 'S', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Legado Githyanki: Mão invisível.', 1),
      ('Mordida Vampírica', 'Nível 1', 'Habilidade', 'Ladino', '1 Ação Bônus', 'Toque', '-', 'Instantânea', '1d4', 'Necrótico', 'Nenhum', 'Drena vida.', 1),
      ('Fúria do Motor Infernal', 'Nível 1', 'Passiva', 'Bárbaro', 'Passiva', 'Pessoal', '-', 'Permanente', '+1d4', 'Fogo', 'Nenhum', 'Dano de fogo extra.', 1),
      ('Orbe de Netheril', 'Nível 1', 'Passiva', 'Mago', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Bomba latente que pede magia.', 1),
      ('Bênção da Divindade Sombria', 'Nível 1', 'Passiva', 'Clérigo', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Vantagem Furtividade nas sombras.', 1),
      ('Golpe Destruidor de Almas', 'Nível 1', 'Habilidade', 'Paladino', '1 Ação', 'Arma', 'S', 'Instantânea', '+1d6', 'Psíquico', 'Nenhum', 'Golpe Drow letal.', 1),
      
      -- =========================
      -- HABILIDADES ADICIONAIS MARCIAIS
      -- =========================
      ('Estilo de Luta: Defesa', 'Nível 1', 'Passiva', 'Guerreiro,Paladino', 'Passiva', 'Pessoal', '-', 'Permanente', '+1 CA', 'Outro', 'Nenhum', '+1 CA com armadura.', 1),
      ('Estilo de Luta: Duelo', 'Nível 1', 'Passiva', 'Guerreiro,Paladino', 'Passiva', 'Pessoal', '-', 'Permanente', '+2', 'Extra', 'Nenhum', '+2 no dano com arma de uma mão.', 1),
      ('Estilo de Luta: Combate com Armas Grandes', 'Nível 1', 'Passiva', 'Guerreiro,Paladino', 'Passiva', 'Pessoal', '-', 'Permanente', 'Rerrolar 1/2', 'Outro', 'Nenhum', 'Rerrola 1 ou 2 no dano.', 1),

      ('Indomável', 'Nível 9', 'Habilidade', 'Guerreiro', 'Reação', 'Pessoal', '-', 'Instantânea', '-', 'Outro', 'Nenhum', 'Rerrola teste de resistência.', 9),
      ('Mestre de Batalha: Ripostar', 'Nível 3', 'Habilidade', 'Guerreiro', 'Reação', 'Arma', '-', 'Instantânea', '+1d8', 'Extra', 'Nenhum', 'Contra-ataque após erro do alvo.', 3),
      ('Mestre de Batalha: Ataque Empurrão', 'Nível 3', 'Habilidade', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Concussão', 'FOR', 'Tenta empurrar o alvo.', 3),

      ('Cavaleiro Arcano: Arma Vinculada', 'Nível 3', 'Passiva', 'Guerreiro', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Arma inseparável e invocável.', 3),

      ('Juramento de Devoção: Arma Sagrada', 'Nível 3', 'Habilidade', 'Paladino', '1 Ação', 'Arma', '-', '1 Minuto', '+CAR', 'Radiante', 'Nenhum', 'Arma divina adiciona Carisma.', 3),
      ('Juramento de Vingança: Inimigo Abjurado', 'Nível 3', 'Habilidade', 'Paladino', '1 Ação Bônus', '9m', '-', '1 Minuto', 'Vantagem', 'Outro', 'Nenhum', 'Vantagem de ataque focada.', 3),

      ('Golpe Divino Aprimorado', 'Nível 11', 'Passiva', 'Paladino', 'Passiva', 'Arma', '-', 'Permanente', '1d8', 'Radiante', 'Nenhum', '+1d8 radiante fixo.', 11),
      ('Coragem Inabalável', 'Nível 10', 'Passiva', 'Paladino', 'Passiva', '3m', '-', 'Permanente', '-', 'Outro', 'Nenhum', 'Imune a amedrontado.', 10),
      ('Vingador Implacável', 'Nível 7', 'Habilidade', 'Paladino', 'Reação', 'Pessoal', '-', 'Instantânea', 'Movimento', 'Outro', 'Nenhum', 'Move-se ao causar dano.', 7),

      ('Esquiva Ágil', 'Nível 2', 'Habilidade', 'Guerreiro,Patrulheiro', 'Reação', 'Pessoal', '-', '1 Turno', '-', 'Outro', 'Nenhum', 'Corta o dano pela metade.', 2),
      ('Postura Defensiva', 'Nível 3', 'Habilidade', 'Guerreiro,Paladino', '1 Ação Bônus', 'Pessoal', '-', '1 Minuto', '+2 CA', 'Outro', 'Nenhum', '+2 de CA reativo.', 3),
      ('Determinação de Ferro', 'Nível 6', 'Passiva', 'Guerreiro', 'Passiva', 'Pessoal', '-', 'Permanente', 'Vantagem', 'Outro', 'Nenhum', 'Vantagem contra mente alterada.', 6),
      ('Golpe Devastador', 'Nível 8', 'Habilidade', 'Guerreiro,Paladino', 'Após acertar', 'Arma', '-', 'Instantânea', '+2d6', 'Extra', 'Nenhum', 'Soma +2d6 no acerto pesado.', 8),
      ('Guardião Implacável', 'Nível 12', 'Habilidade', 'Paladino', 'Reação', '3m', '-', 'Instantânea', '-', 'Outro', 'Nenhum', 'Toma dano pelo aliado.', 12)
      
      ;
    `);

    // 8. SUBCLASSES COM FEATURES
    await db.execAsync(`INSERT INTO subclasses (name, class_name, level_required, features) VALUES 
      ('Caminho do Berserker', 'Bárbaro', 3, '[]'),
      ('Caminho do Totem Guerreiro', 'Bárbaro', 3, '[]'),
      ('Caminho do Guardião Ancestral', 'Bárbaro', 3, '[]'),
      ('Colégio do Conhecimento', 'Bardo', 3, '[]'),
      ('Colégio da Bravura', 'Bardo', 3, '[]'),
      ('Colégio das Espadas', 'Bardo', 3, '[]'),
      ('O Corruptor', 'Bruxo', 1, '[]'),
      ('O Arquifada', 'Bruxo', 1, '[]'),
      ('O Grande Antigo', 'Bruxo', 1, '[]'),
      ('Lâmina Maldita (Hexblade)', 'Bruxo', 1, '[]'),
      ('Domínio da Vida', 'Clérigo', 1, '[]'),
      ('Domínio da Luz', 'Clérigo', 1, '[]'),
      ('Domínio da Guerra', 'Clérigo', 1, '[]'),
      ('Domínio da Tempestade', 'Clérigo', 1, '[]'),
      ('Domínio da Trapaça', 'Clérigo', 1, '[]'),
      ('Círculo da Lua', 'Druida', 2, '[]'),
      ('Círculo da Terra', 'Druida', 2, '[]'),
      ('Círculo dos Esporos', 'Druida', 2, '[]'),
      ('Linhagem Dracônica', 'Feiticeiro', 1, '[]'),
      ('Magia Selvagem', 'Feiticeiro', 1, '[]'),
      ('Alma Divina', 'Feiticeiro', 1, '[]'),
      ('Mente Aberrante', 'Feiticeiro', 1, '[]'),
      ('Campeão', 'Guerreiro', 3, '[]'),
      ('Mestre de Batalha', 'Guerreiro', 3, '["Ataque de Precisão", "Ataque de Tropeço", "Ataque Desarmante", "Ataque Ameaçador"]'),
      ('Cavaleiro Arcano', 'Guerreiro', 3, '[]'),
      ('Samurai', 'Guerreiro', 3, '[]'),
      ('Assassino', 'Ladino', 3, '[]'),
      ('Ladrão', 'Ladino', 3, '[]'),
      ('Trapaceiro Arcano', 'Ladino', 3, '[]'),
      ('Espadachim', 'Ladino', 3, '[]'),
      ('Abjuração', 'Mago', 2, '[]'),
      ('Evocação', 'Mago', 2, '[]'),
      ('Necromancia', 'Mago', 2, '[]'),
      ('Adivinhação', 'Mago', 2, '["Ver o Futuro"]'),
      ('Ilusão', 'Mago', 2, '[]'),
      ('Caminho da Mão Aberta', 'Monge', 3, '[]'),
      ('Caminho das Sombras', 'Monge', 3, '[]'),
      ('Caminho dos Quatro Elementos', 'Monge', 3, '[]'),
      ('Devoção', 'Paladino', 3, '[]'),
      ('Juramento dos Anciões', 'Paladino', 3, '[]'),
      ('Juramento de Vingança', 'Paladino', 3, '[]'),
      ('Juramento de Conquista', 'Paladino', 3, '[]'),
      ('Caçador', 'Patrulheiro', 3, '[]'),
      ('Mestre das Bestas', 'Patrulheiro', 3, '[]'),
      ('Andarilho do Horizonte', 'Patrulheiro', 3, '[]');
    `);

    // 10. PROGRESSÃO DE MAGIAS
    await db.execAsync(`INSERT INTO spellcasting_progression (source_type, source_name, level, cantrips_known, spells_known, slot_1, slot_2, slot_3) VALUES 
      -- Bardo (Usa Magias Conhecidas fixas)
      ('class', 'Bardo', 1, 2, 4, 2, 0, 0), ('class', 'Bardo', 2, 2, 5, 3, 0, 0), ('class', 'Bardo', 3, 2, 6, 4, 2, 0), ('class', 'Bardo', 4, 3, 7, 4, 3, 0), ('class', 'Bardo', 5, 3, 8, 4, 3, 2),
      
      -- Feiticeiro (Usa Magias Conhecidas fixas)
      ('class', 'Feiticeiro', 1, 4, 2, 2, 0, 0), ('class', 'Feiticeiro', 2, 4, 3, 3, 0, 0), ('class', 'Feiticeiro', 3, 4, 4, 4, 2, 0), ('class', 'Feiticeiro', 4, 5, 5, 4, 3, 0), ('class', 'Feiticeiro', 5, 5, 6, 4, 3, 2),
      
      -- Bruxo (Magia de Pacto - Magias Conhecidas fixas)
      ('class', 'Bruxo', 1, 2, 2, 1, 0, 0), ('class', 'Bruxo', 2, 2, 3, 2, 0, 0), ('class', 'Bruxo', 3, 2, 4, 0, 2, 0), ('class', 'Bruxo', 4, 3, 5, 0, 2, 0), ('class', 'Bruxo', 5, 3, 6, 0, 0, 2),

      -- Patrulheiro (Magias Conhecidas fixas - Começa no nível 2)
      ('class', 'Patrulheiro', 1, 0, 0, 0, 0, 0), ('class', 'Patrulheiro', 2, 0, 2, 2, 0, 0), ('class', 'Patrulheiro', 3, 0, 3, 3, 0, 0), ('class', 'Patrulheiro', 4, 0, 3, 3, 0, 0), ('class', 'Patrulheiro', 5, 0, 4, 4, 2, 0),

      -- Mago, Clérigo, Druida, Paladino (Preparam magias diariamente: Nível + Modificador. Então o banco fica 0)
      ('class', 'Clérigo', 1, 3, 0, 2, 0, 0), ('class', 'Clérigo', 2, 3, 0, 3, 0, 0), ('class', 'Clérigo', 3, 3, 0, 4, 2, 0), ('class', 'Clérigo', 4, 4, 0, 4, 3, 0), ('class', 'Clérigo', 5, 4, 0, 4, 3, 2),
      ('class', 'Druida', 1, 2, 0, 2, 0, 0), ('class', 'Druida', 2, 2, 0, 3, 0, 0), ('class', 'Druida', 3, 2, 0, 4, 2, 0), ('class', 'Druida', 4, 3, 0, 4, 3, 0), ('class', 'Druida', 5, 3, 0, 4, 3, 2),
      ('class', 'Mago', 1, 3, 0, 2, 0, 0), ('class', 'Mago', 2, 3, 0, 3, 0, 0), ('class', 'Mago', 3, 3, 0, 4, 2, 0), ('class', 'Mago', 4, 4, 0, 4, 3, 0), ('class', 'Mago', 5, 4, 0, 4, 3, 2),
      ('class', 'Paladino', 1, 0, 0, 0, 0, 0), ('class', 'Paladino', 2, 0, 0, 2, 0, 0), ('class', 'Paladino', 3, 0, 0, 3, 0, 0), ('class', 'Paladino', 4, 0, 0, 3, 0, 0), ('class', 'Paladino', 5, 0, 0, 4, 2, 0),
      
      -- 1/3 Casters (Subclasses)
      ('subclass', 'Cavaleiro Arcano', 3, 2, 3, 2, 0, 0), ('subclass', 'Cavaleiro Arcano', 4, 2, 4, 3, 0, 0), ('subclass', 'Cavaleiro Arcano', 5, 2, 4, 3, 0, 0),
      ('subclass', 'Trapaceiro Arcano', 3, 2, 3, 2, 0, 0), ('subclass', 'Trapaceiro Arcano', 4, 2, 4, 3, 0, 0), ('subclass', 'Trapaceiro Arcano', 5, 2, 4, 3, 0, 0),

      -- Raças com magia inata
      ('race', 'Alto Elfo', 1, 1, 0, 0, 0, 0),
      ('race', 'Drow', 1, 1, 0, 0, 0, 0),
      ('race', 'Tiefling', 1, 1, 0, 0, 0, 0),
      ('race', 'Githyanki', 1, 1, 0, 0, 0, 0);
    `);
    // ==========================================
    // INSERÇÃO DOS PERSONAGENS DE BALDUR'S GATE 3
    // ==========================================
    await db.execAsync(`INSERT INTO bg3_companions (name, short_name, race, class_name, origin_spell, skills, stats, personality, ideals, bonds, flaws, backstory, allies, features) VALUES 
      (
        'Lae''zel de K''liir', 'Lae''zel', 'Githyanki', 'Guerreiro', 'Mãos Mágicas (Githyanki)', 
        '["skill_atletismo", "skill_acrobacia", "skill_intimidacao", "skill_sobrevivencia"]', 
        '{"FOR": 17, "DES": 13, "CON": 15, "INT": 10, "SAB": 12, "CAR": 8}', 
        'Feroz, impaciente e estritamente focada no dever militar.', 
        'Dever. Minha vida pertence à Rainha Lich Vlaakith e ao meu povo.', 
        'A purificação. Devo encontrar a Creche Githyanki para me livrar deste parasita ilitide.', 
        'Arrogância. Considero as outras raças do Plano Material fracas e inferiores.', 
        'Treinada no Plano Astral para ser uma guerreira implacável, fui capturada por Devoradores de Mentes. Agora, preciso provar meu valor para minha rainha e evitar a transformação (ceremorfose).', 
        'Lealdade apenas ao Império Githyanki e a Vlaakith.', 
        '["Segundo Fôlego", "Estilo de Luta: Combate com Armas Grandes"]'
      ),
      (
        'Karlach Cliffgate', 'Karlach', 'Tiefling', 'Bárbaro', 'Fúria do Motor Infernal', 
        '["skill_atletismo", "skill_intimidacao", "skill_sobrevivencia", "skill_percepcao"]', 
        '{"FOR": 17, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', 
        'Extremamente enérgica, protetora e animada com as coisas simples da vida.', 
        'Vida. Fiquei no inferno tempo demais, agora quero viver, amar e aproveitar cada segundo.', 
        'Desejo encontrar o ferreiro mecânico que consertará o motor que substitui meu coração.', 
        'Coração em chamas. Meu motor infernal queima tão quente que eu não posso tocar as pessoas que amo sem machucá-las.', 
        'Fui vendida como escrava para o arquidiabo Zariel e forçada a lutar na Guerra Sangrenta em Avernus por uma década. Escapei no nautiloide, mas meu coração mecânico está superaquecendo neste plano.', 
        'Velhos amigos das docas de Baldur''s Gate e ferreiros mecânicos.', 
        '["Fúria", "Defesa Sem Armadura"]'
      ),
      (
        'Astarion Ancunín', 'Astarion', 'Alto Elfo', 'Ladino', 'Mordida Vampírica', 
        '["skill_furtividade", "skill_blefar", "skill_percepcao", "skill_prestidigitacao"]', 
        '{"FOR": 8, "DES": 17, "CON": 14, "INT": 13, "SAB": 13, "CAR": 10}', 
        'Elegante, sarcástico e sempre em busca de prazeres pessoais ou sangue fresco.', 
        'Liberdade. Nunca mais serei escravo ou marionete de ninguém.', 
        'Minha liberdade recém-descoberta e a sede de vingança contra Cazador, meu antigo mestre.', 
        'Fome insaciável e extrema dificuldade em confiar nas intenções de qualquer pessoa.', 
        'Fui um magistrado de Baldur''s Gate, transformado em vampiro gerado há séculos. Agora livre do controle do meu mestre devido ao girino em minha mente, busco poder para nunca mais ser subjugado.', 
        'Nenhum aliado confiável, apenas "associados" temporários que me sejam úteis.', 
        '["Ataque Furtivo", "Especialização (Ladino)", "Visão no Escuro"]'
      ),
      (
        'Gale Dekarios', 'Gale', 'Humano', 'Mago', 'Orbe de Netheril', 
        '["skill_arcanismo", "skill_historia", "skill_investigacao", "skill_intuicao"]', 
        '{"FOR": 8, "DES": 13, "CON": 15, "INT": 17, "SAB": 10, "CAR": 12}', 
        'Educado, romântico, excessivamente falante e apaixonado pela Trama.', 
        'Conhecimento. A magia é a linguagem do universo, e eu serei fluente nela.', 
        'Meu amor por Mystra, a Deusa da Magia, é a força motriz e a ruína da minha vida.', 
        'Ambição desmedida. Minha arrogância em buscar o poder me amaldiçoou com uma bomba no peito.', 
        'Um prodígio mágico de Waterdeep. Em uma tentativa de provar meu amor à Deusa Mystra, absorvi um fragmento de magia Netheresa corrompida, que agora ameaça destruir tudo ao meu redor se não for alimentada com itens mágicos.', 
        'Tara, minha familiar tressym voadora, e os estudiosos de Waterdeep.', 
        '[]'
      ),
      (
        'Halsin', 'Halsin', 'Elfo da Floresta', 'Druida', '', 
        '["skill_natureza", "skill_medicina", "skill_sobrevivencia", "skill_lidar_animais"]', 
        '{"FOR": 16, "DES": 10, "CON": 16, "INT": 10, "SAB": 16, "CAR": 10}', 
        'Sereno, sábio e paciente. Prefere a companhia dos ursos à política das cidades.', 
        'Equilíbrio. A natureza deve ser preservada e curada das corrupções que a ameaçam.', 
        'O Bosque Esmeralda. Dediquei minha vida a protegê-lo como Primeiro Druida.', 
        'Muitas vezes assumo fardos pesados demais sozinho, sentindo-me culpado pelos erros do passado.', 
        'Atuei como o Primeiro Druida do Bosque Esmeralda. Há mais de um século, lutei contra a maldição das sombras de Ketheric Thorm e falhei em impedir que a terra fosse consumida. Hoje busco redenção.', 
        'Círculo dos Druidas e os espíritos da floresta.', 
        '["Visão no Escuro"]'
      ),
      (
        'Jaheira', 'Jaheira', 'Meio-Elfo', 'Druida', '', 
        '["skill_natureza", "skill_percepcao", "skill_intuicao", "skill_sobrevivencia", "skill_intimidacao"]', 
        '{"FOR": 10, "DES": 16, "CON": 14, "INT": 10, "SAB": 16, "CAR": 12}', 
        'Pragmática, direta, de humor seco e com pouca paciência para tolos.', 
        'Responsabilidade. Alguém precisa limpar a bagunça que os "heróis" deixam para trás.', 
        'Meus Harpistas e a cidade de Baldur''s Gate, que jurei proteger das sombras.', 
        'Desconfio de todos por natureza, o que me impede de criar laços profundos facilmente.', 
        'Sou uma lenda viva, ex-companheira de Gorion e heroína da crise da Prole de Bhaal. Lidero os Harpistas para manter o equilíbrio no mundo, operando a partir da Estalagem da Última Luz.', 
        'A facção dos Harpistas e os heróis do passado.', 
        '[]'
      ),
      (
        'Minsc (e Boo)', 'Minsc', 'Humano', 'Patrulheiro', '', 
        '["skill_atletismo", "skill_sobrevivencia", "skill_lidar_animais", "skill_intimidacao"]', 
        '{"FOR": 20, "DES": 12, "CON": 16, "INT": 8, "SAB": 10, "CAR": 10}', 
        'Inabalavelmente otimista, heróico, fala com seu hamster de estimação e resolve as coisas na base da força.', 
        'Justiça! O mal deve ser esmagado pela bota pesada da bondade!', 
        'Boo, meu hamster espacial gigante em miniatura, e minha bússola moral inseparável.', 
        'Não entendo metáforas e costumo atacar primeiro quando vejo o que considero "mal".', 
        'Um herói lendário de Rashemen que viajou por Faerûn há um século. Passei mais de cem anos transformado em estátua de pedra, até ser libertado acidentalmente em uma Baldur''s Gate moderna e confusa.', 
        'Boo, Jaheira e qualquer um que lute pelo bem.', 
        '["Inimigo Favorito", "Explorador Nato"]'
      ),
      (
        'Wyll Ravengard', 'Wyll', 'Humano', 'Bruxo', '', 
        '["skill_persuasao", "skill_intimidacao", "skill_arcanismo", "skill_historia"]', 
        '{"FOR": 8, "DES": 13, "CON": 14, "INT": 13, "SAB": 10, "CAR": 17}', 
        'Heroico, fanfarrão, cortês, sempre se apresenta como o "Lâmina da Fronteira".', 
        'Heroísmo. A lenda de um herói deve sempre proteger o povo e inspirar os fracos.', 
        'Meu pai, o Grão-Duque Ravengard, que me exilou sem saber a verdade do meu sacrifício.', 
        'Fiz um pacto com a diaba Mizora e agora minha alma está atrelada à vontade de um demônio.', 
        'Filho de um nobre poderoso. Quando a cidade esteve sob ameaça de um culto draconiano, fiz um pacto sombrio para salvá-la. Fui deserdado por usar magias profanas. Agora caço monstros como o Lâmina da Fronteira.', 
        'Os camponeses que salvei, refugiados e os Tieflings.', 
        '[]'
      ),
      (
        'Umbralma', 'ShadowHeart', 'Meio-Elfo', 'Clérigo', 'Bênção da Divindade Sombria', 
        '["skill_religiao", "skill_medicina", "skill_furtividade", "skill_blefar"]', 
        '{"FOR": 10, "DES": 13, "CON": 15, "INT": 10, "SAB": 17, "CAR": 10}', 
        'Secreta, devota, cautelosa, mas com um coração mole que tenta esconder.', 
        'Fé. A escuridão abriga segredos e verdades que a luz ofusca.', 
        'Minha missão. Fui encarregada de recuperar um artefato sagrado vital para minha Deusa.', 
        'Minha memória foi apagada. Não sei quem sou de verdade, e tenho um pavor irracional de lobos.', 
        'Sou uma clériga e agente de elite do claustro de Shar em Baldur''s Gate. Minhas memórias foram seladas como parte do meu treinamento para uma missão suicida de roubar o Artefato Prismático.', 
        'A Igreja de Shar (Nossa Senhora da Perda).', 
        '[]'
      )
    ;`);

  } else {
    console.log('Banco de dados já populado. Pulando inserção.');
  }
  await seedRandomCreatorContent(db);
  await seedConditionEffectCatalog(db);
  await seedStructuredBaseEffects(db);
  await seedExpandedBaseCatalog(db);
  await seedStructuredItemEffects(db);
  await seedFullSpellcastingProgression(db);
  await repairBaseRulesCatalog(db);
  await repairStartingKitsAgainstCatalog(db);
  await organizeBaseCatalog(db);
  if (didResetTransientDebugState) {
    await db.runAsync(`DELETE FROM app_trace_logs`);
  }
}
