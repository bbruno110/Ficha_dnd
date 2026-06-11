import { SQLiteDatabase } from 'expo-sqlite';

import { traceApp, traceSqlite } from '@/services/debug/appTrace';
import { ensureEffectSchema } from '../services/effects/effectSchema';
import { seedDefaultXpProgression } from '../services/xpProgressionService';

export async function initializeDatabase(db: SQLiteDatabase) {
  const startedAt = Date.now();
  traceApp('APP', 'DATABASE_INIT_START', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
  });
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await db.execAsync(`PRAGMA foreign_keys = ON;`);

  // 1. CRIAÇÃO DE TABELAS
  traceSqlite('SQLITE_WRITE_START', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
    table: 'base_schema',
    operation: 'CREATE_TABLES',
  });
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT UNIQUE NOT NULL, 
      weight REAL NOT NULL,
      damage TEXT,
      damage_type TEXT,
      properties TEXT,
      descricao TEXT,
      effect_json TEXT DEFAULT '[]',
      duration_value INTEGER,
      duration_unit TEXT,
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
      range TEXT,
      components TEXT,
      duration TEXT,
      damage_dice TEXT,
      damage_type TEXT,
      saving_throw TEXT,
      description TEXT,
      effect_json TEXT DEFAULT '[]',
      duration_value INTEGER,
      duration_unit TEXT,
      class_level_required INTEGER DEFAULT 1,
      criador TEXT DEFAULT 'base'
    );

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
      spells TEXT,
      spell_slots_used TEXT DEFAULT '{}',
      equipment TEXT,
      gp INTEGER DEFAULT 0,
      sp INTEGER DEFAULT 0,
      cp INTEGER DEFAULT 0,
      hp_max INTEGER DEFAULT 0,
      hp_current INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS lan_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      master_name TEXT,
      level INTEGER NOT NULL,
      allow_existing INTEGER NOT NULL DEFAULT 1,
      invite_code TEXT NOT NULL,
      join_url TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      current_turn INTEGER NOT NULL DEFAULT 1,
      elapsed_minutes INTEGER NOT NULL DEFAULT 0,
      selected_catalog_json TEXT DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lan_session_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      remote_key TEXT,
      player_name TEXT,
      character_id INTEGER,
      character_snapshot TEXT,
      hp_current INTEGER DEFAULT 0,
      hp_max INTEGER DEFAULT 0,
      temp_hp INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      gp INTEGER DEFAULT 0,
      sp INTEGER DEFAULT 0,
      cp INTEGER DEFAULT 0,
      stats_json TEXT DEFAULT '{}',
      equipment_json TEXT DEFAULT '{}',
      effects_json TEXT DEFAULT '[]',
      notes TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, character_id)
    );

    CREATE TABLE IF NOT EXISTS lan_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  traceSqlite('SQLITE_WRITE_DONE', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
    table: 'base_schema',
    operation: 'CREATE_TABLES',
  });

  await migrateLanTables(db);

  traceSqlite('SQLITE_READ_START', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
    table: 'items',
    operation: 'COUNT_BASE_DATA',
  });
  const checkDb = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM items');
  traceSqlite('SQLITE_READ_DONE', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
    table: 'items',
    operation: 'COUNT_BASE_DATA',
    result: checkDb,
  });
  
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
  traceApp('APP', 'DATABASE_MIGRATION_START', {
    source: 'initializeDatabase',
    functionName: 'migrateDatabaseV2',
  });
  await migrateDatabaseV2(db);
  traceApp('APP', 'DATABASE_MIGRATION_DONE', {
    source: 'initializeDatabase',
    functionName: 'migrateDatabaseV2',
  });
  traceApp('APP', 'DATABASE_INIT_DONE', {
    source: 'initializeDatabase',
    functionName: 'initializeDatabase',
    durationMs: Date.now() - startedAt,
  });
}

async function migrateLanTables(db: SQLiteDatabase) {
  traceApp('APP', 'DATABASE_MIGRATION_START', {
    source: 'migrateLanTables',
    functionName: 'migrateLanTables',
  });
  const columns: [string, string, string][] = [
    ['lan_sessions', 'status', "TEXT NOT NULL DEFAULT 'active'"],
    ['lan_sessions', 'current_turn', 'INTEGER NOT NULL DEFAULT 1'],
    ['lan_sessions', 'elapsed_minutes', 'INTEGER NOT NULL DEFAULT 0'],
    ['lan_sessions', 'selected_catalog_json', "TEXT DEFAULT '{}'"],
    ['lan_sessions', 'updated_at', 'DATETIME'],
    ['lan_session_players', 'remote_key', 'TEXT'],
    ['lan_session_players', 'hp_current', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'hp_max', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'temp_hp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'xp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'gp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'sp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'cp', 'INTEGER DEFAULT 0'],
    ['lan_session_players', 'stats_json', "TEXT DEFAULT '{}'"],
    ['lan_session_players', 'equipment_json', "TEXT DEFAULT '{}'"],
    ['lan_session_players', 'effects_json', "TEXT DEFAULT '[]'"],
    ['lan_session_players', 'notes', 'TEXT'],
    ['lan_session_players', 'last_seen_at', 'DATETIME'],
    ['items', 'effect_json', "TEXT DEFAULT '[]'"],
    ['items', 'duration_value', 'INTEGER'],
    ['items', 'duration_unit', 'TEXT'],
    ['spells', 'effect_json', "TEXT DEFAULT '[]'"],
    ['spells', 'duration_value', 'INTEGER'],
    ['spells', 'duration_unit', 'TEXT'],
  ];

  for (const [table, column, definition] of columns) {
    try {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    } catch {
      // Coluna ja existe em bancos criados por versoes anteriores.
    }
  }

  try {
    await db.execAsync(`UPDATE lan_sessions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);`);
  } catch {
    // Bancos muito antigos podem ainda estar criando a tabela na primeira abertura.
  }

  try {
    await db.execAsync(`UPDATE lan_session_players SET last_seen_at = COALESCE(last_seen_at, joined_at, CURRENT_TIMESTAMP);`);
  } catch {
    // Bancos muito antigos podem ainda estar criando a tabela na primeira abertura.
  }
  traceApp('APP', 'DATABASE_MIGRATION_DONE', {
    source: 'migrateLanTables',
    functionName: 'migrateLanTables',
  });
}

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
