import { SQLiteDatabase } from 'expo-sqlite';

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
      range TEXT,
      components TEXT,
      duration TEXT,
      damage_dice TEXT,
      damage_type TEXT,
      saving_throw TEXT,
      description TEXT,
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
  `);

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

  } else {
    console.log('Banco de dados já populado. Pulando inserção.');
  }
}