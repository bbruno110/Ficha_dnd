import { SQLiteDatabase } from 'expo-sqlite';

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA journal_mode = WAL;`);

  // 1. CRIAÇÃO DE TABELAS (Agora protegidas com IF NOT EXISTS)
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
      criador TEXT DEFAULT 'base'
    );
    
    CREATE TABLE IF NOT EXISTS spells (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT NOT NULL, 
      level TEXT NOT NULL, 
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
  `);

  // 2. VERIFICAÇÃO DE SEGURANÇA (Evita recriar dados e dar erro de UNIQUE)
  const checkDb = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM items');
  
  if (checkDb && checkDb.count === 0) {
    console.log('Banco de dados vazio. Populando dados base...');

    // 3. INSERÇÃO DE DADOS (Só roda na primeira vez que o app for aberto após instalado)
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
      ('Sinete', 0.0, '-', '-', 'Ferramenta, Brasão pessoal', 'Anel ou selo com o brasão familiar, usado em cera derretida.');
    `);

    await db.execAsync(`INSERT INTO starting_kits (name, target_name, target_type, items) VALUES
      -- BÁRBARO
      ('Kit de Assalto (Ofensivo)', 'Bárbaro', 'class', '[{"name":"Machado Grande","qty":1},{"name":"Machadinha","qty":2},{"name":"Mochila","qty":1},{"name":"Ração (1 dia)","qty":3}]'),
      ('Kit de Sobrevivência (Prudente)', 'Bárbaro', 'class', '[{"name":"Espada Longa","qty":1},{"name":"Azagaia","qty":4},{"name":"Armadura de Couro","qty":1},{"name":"Mochila","qty":1},{"name":"Corda de Cânhamo (15m)","qty":1}]'),
      
      -- BARDO
      ('Kit do Artista Viajante', 'Bardo', 'class', '[{"name":"Rapieira","qty":1},{"name":"Alaúde","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Roupas Finas","qty":1}]'),
      ('Kit do Espião', 'Bardo', 'class', '[{"name":"Espada Curta","qty":1},{"name":"Kit de Disfarce","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Adaga","qty":2}]'),
      
      -- BRUXO
      ('Kit do Cultista', 'Bruxo', 'class', '[{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Adaga","qty":2}]'),
      ('Kit da Lâmina Sombria', 'Bruxo', 'class', '[{"name":"Espada Curta","qty":2},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Poção de Cura","qty":1}]'),

      -- CLÉRIGO
      ('Kit Linha de Frente', 'Clérigo', 'class', '[{"name":"Maça","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Escudo","qty":1},{"name":"Símbolo Sagrado","qty":1}]'),
      ('Kit Curandeiro Divino', 'Clérigo', 'class', '[{"name":"Maça","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Símbolo Sagrado","qty":1},{"name":"Poção de Cura","qty":2},{"name":"Kit de Primeiros Socorros","qty":1}]'),

      -- DRUIDA
      ('Kit Forma Selvagem', 'Druida', 'class', '[{"name":"Cimitarra","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1},{"name":"Escudo","qty":1}]'),
      ('Kit Xamã Protetor', 'Druida', 'class', '[{"name":"Bordão","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1},{"name":"Kit de Herbalismo","qty":1}]'),

      -- FEITICEIRO
      ('Kit Fogo Cruzado', 'Feiticeiro', 'class', '[{"name":"Adaga","qty":2},{"name":"Foco Arcano","qty":1},{"name":"Poção de Cura","qty":1},{"name":"Tocha","qty":3}]'),
      ('Kit Estudioso', 'Feiticeiro', 'class', '[{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Vidro de Tinta","qty":1},{"name":"Caneta-tinteiro","qty":1}]'),

      -- GUERREIRO
      ('Kit Colosso (Tanque)', 'Guerreiro', 'class', '[{"name":"Cota de Malha","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Besta Leve","qty":1},{"name":"Aljava com 20 Virotes","qty":1}]'),
      ('Kit Franco-Atirador', 'Guerreiro', 'class', '[{"name":"Armadura de Couro","qty":1},{"name":"Arco Longo","qty":1},{"name":"Aljava com 20 Flechas","qty":1},{"name":"Espada Curta","qty":2}]'),

      -- LADINO
      ('Kit Ladrão Clássico', 'Ladino', 'class', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Ferramentas de Ladrão","qty":1},{"name":"Adaga","qty":2}]'),
      ('Kit Assassino Noturno', 'Ladino', 'class', '[{"name":"Espada Curta","qty":2},{"name":"Armadura de Couro","qty":1},{"name":"Kit de Venenos","qty":1},{"name":"Arco Curto","qty":1},{"name":"Aljava com 20 Flechas","qty":1}]'),

      -- MAGO
      ('Kit Arcano Padrão', 'Mago', 'class', '[{"name":"Bordão","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1},{"name":"Mochila","qty":1}]'),
      ('Kit Mago Pesquisador', 'Mago', 'class', '[{"name":"Adaga","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1},{"name":"Pergaminho","qty":5},{"name":"Caneta-tinteiro","qty":1}]'),

      -- MONGE
      ('Kit Monge Marcial', 'Monge', 'class', '[{"name":"Espada Curta","qty":1},{"name":"10 Dardos","qty":1},{"name":"Mochila","qty":1},{"name":"Poção de Cura","qty":1}]'),
      ('Kit Monge Peregrino', 'Monge', 'class', '[{"name":"Bordão","qty":1},{"name":"10 Dardos","qty":1},{"name":"Roupas de Viagem","qty":1},{"name":"Caixa de Esmolas","qty":1}]'),

      -- PALADINO
      ('Kit Cruzado Sagrado', 'Paladino', 'class', '[{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Símbolo Sagrado","qty":1}]'),
      ('Kit Justiceiro Implacável', 'Paladino', 'class', '[{"name":"Alabarda","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Símbolo Sagrado","qty":1},{"name":"Azagaia","qty":4}]'),

      -- PATRULHEIRO
      ('Kit Batedor das Matas', 'Patrulheiro', 'class', '[{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Longo","qty":1},{"name":"Aljava com 20 Flechas","qty":1},{"name":"Espada Curta","qty":2}]'),
      ('Kit Caçador de Monstros', 'Patrulheiro', 'class', '[{"name":"Armadura de Couro","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Corda de Cânhamo (15m)","qty":1},{"name":"Fio (3m)","qty":1}]');
    `);

    await db.execAsync(`INSERT INTO races (name, stat_bonuses, speed) VALUES 
      ('Anão', '{"CON": 2}', '7,5m'), ('Draconato', '{"FOR": 2, "CAR": 1}', '9m'), ('Elfo', '{"DES": 2}', '9m'), 
      ('Gnomo', '{"INT": 2}', '7,5m'), ('Halfling', '{"DES": 2}', '7,5m'), 
      ('Humano', '{"FOR": 1, "DES": 1, "CON": 1, "INT": 1, "SAB": 1, "CAR": 1}', '9m'), 
      ('Meio-Elfo', '{"CAR": 2, "DES": 1, "CON": 1}', '9m'), ('Meio-Orc', '{"FOR": 2, "CON": 1}', '9m'), 
      ('Tiefling', '{"CAR": 2, "INT": 1}', '9m');`);

    await db.execAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster) VALUES 
      ('Bárbaro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Machado Grande","qty":1},{"name":"Mochila","qty":1},{"name":"Saco de dormir","qty":1},{"name":"Tocha","qty":5}]', 10, 12, '["save_for", "save_con"]', 3, 0),
      ('Bardo', '{"FOR": 8, "DES": 14, "CON": 13, "INT": 12, "SAB": 10, "CAR": 15}', '[{"name":"Rapieira","qty":1},{"name":"Alaúde","qty":1},{"name":"Armadura de Couro","qty":1}]', 15, 8, '["save_des", "save_car"]', 3, 1),
      ('Bruxo', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Besta Leve","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1}]', 10, 8, '["save_sab", "save_car"]', 1, 1),
      ('Clérigo', '{"FOR": 14, "DES": 10, "CON": 13, "INT": 8, "SAB": 15, "CAR": 12}', '[{"name":"Maça","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Escudo","qty":1}]', 15, 8, '["save_sab", "save_car"]', 1, 1),
      ('Druida', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 12, "SAB": 15, "CAR": 10}', '[{"name":"Cimitarra","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1}]', 10, 8, '["save_int", "save_sab"]', 2, 1),
      ('Feiticeiro', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Adaga","qty":2},{"name":"Foco Arcano","qty":1}]', 10, 6, '["save_con", "save_car"]', 1, 1),
      ('Guerreiro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Cota de Malha","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1}]', 15, 10, '["save_for", "save_con"]', 3, 0),
      ('Ladino', '{"FOR": 8, "DES": 15, "CON": 14, "INT": 12, "SAB": 10, "CAR": 13}', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Ferramentas de Ladrão","qty":1}]', 15, 8, '["save_des", "save_int"]', 3, 0),
      ('Mago', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 15, "SAB": 12, "CAR": 10}', '[{"name":"Bordão","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1}]', 10, 6, '["save_int", "save_sab"]', 2, 1),
      ('Monge', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Espada Curta","qty":1},{"name":"10 Dardos","qty":1}]', 5, 8, '["save_for", "save_des"]', 3, 0),
      ('Paladino', '{"FOR": 15, "DES": 10, "CON": 13, "INT": 8, "SAB": 12, "CAR": 14}', '[{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1}]', 15, 10, '["save_sab", "save_car"]', 3, 0),
      ('Patrulheiro', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Longo","qty":1}]', 12, 10, '["save_for", "save_des"]', 3, 0);`);

    await db.execAsync(`INSERT INTO saving_throws (id, name, stat) VALUES ('save_for', 'Força', 'FOR'), ('save_des', 'Destreza', 'DES'), ('save_con', 'Constituição', 'CON'), ('save_int', 'Inteligência', 'INT'), ('save_sab', 'Sabedoria', 'SAB'), ('save_car', 'Carisma', 'CAR');`);
    await db.execAsync(`INSERT INTO skills (id, name, stat) VALUES ('skill_acrobacia', 'Acrobacia', 'DES'), ('skill_arcanismo', 'Arcanismo', 'INT'), ('skill_atletismo', 'Atletismo', 'FOR'), ('skill_atuacao', 'Atuação', 'CAR'), ('skill_blefar', 'Enganação / Blefar', 'CAR'), ('skill_furtividade', 'Furtividade', 'DES'), ('skill_historia', 'História', 'INT'), ('skill_intimidacao', 'Intimidação', 'CAR'), ('skill_intuicao', 'Intuição', 'SAB'), ('skill_investigacao', 'Investigação', 'INT'), ('skill_lidar_animais', 'Lidar com Animais', 'SAB'), ('skill_medicina', 'Medicina', 'SAB'), ('skill_natureza', 'Natureza', 'INT'), ('skill_percepcao', 'Percepção', 'SAB'), ('skill_persuasao', 'Persuasão', 'CAR'), ('skill_prestidigitacao', 'Prestidigitação', 'DES'), ('skill_religiao', 'Religião', 'INT'), ('skill_sobrevivencia', 'Sobrevivência', 'SAB');`);
    
    await db.execAsync(`INSERT INTO spells (name, level, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, class_level_required) VALUES 
      -- TRUQUES (Requisito 1 para todos que aprendem Truques)
      ('Amizade', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Pessoal', 'S, M', '1 Minuto', '-', 'Nenhum', 'CAR', 'Vantagem em testes de Carisma contra não hostis. Alvo percebe após 1 min.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Bordão Mágico', 'Truque', 'Druida', '1 Ação Bônus', 'Toque', 'V, S, M', '1 Minuto', '1d8', 'Concussão', 'Nenhum', 'Arma torna-se mágica e usa habilidade de conjuração para ataque/dano.', 'Druida:1'),
      ('Chama Sagrada', 'Truque', 'Clérigo', '1 Ação', '18m', 'V, S', 'Instantânea', '1d8', 'Radiante', 'DES', 'Alvo deve passar em Destreza ou sofrer dano. Ignora cobertura.', 'Clérigo:1'),
      ('Chicote de Espinhos', 'Truque', 'Druida', '1 Ação', '9m', 'V, S, M', 'Instantânea', '1d6', 'Perfurante', 'Nenhum', 'Ataque mágico corpo-a-corpo que puxa o alvo 3 metros para perto.', 'Druida:1'),
      ('Consertar', 'Truque', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Minuto', 'Toque', 'V, S, M', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Repara um único dano ou rachadura em um objeto tocado.', 'Bardo:1, Clérigo:1, Druida:1, Feiticeiro:1, Mago:1'),
      ('Criar Chamas', 'Truque', 'Druida', '1 Ação', 'Pessoal', 'V, S', '10 Minutos', '1d8', 'Fogo', 'Nenhum', 'Chama na mão que ilumina 3m ou pode ser arremessada.', 'Druida:1'),
      ('Estabilizar', 'Truque', 'Clérigo', '1 Ação', 'Toque', 'V, S', 'Instantânea', '-', 'Cura', 'Nenhum', 'Uma criatura com 0 PV torna-se estável instantaneamente.', 'Clérigo:1'),
      ('Globos de Luz', 'Truque', 'Bardo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Cria quatro luzes do tamanho de tochas que flutuam no ar.', 'Bardo:1, Feiticeiro:1, Mago:1'),
      ('Guia', 'Truque', 'Clérigo,Druida', '1 Ação', 'Toque', 'V, S', 'Concentração', '+1d4', 'Força', 'Nenhum', 'O alvo adiciona 1d4 em um teste de habilidade à escolha dele.', 'Clérigo:1, Druida:1'),
      ('Ilusão Menor', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'S, M', '1 Minuto', '-', 'Nenhum', 'INT', 'Cria um som ou uma imagem de um objeto por 1 minuto.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Luz', 'Truque', 'Bardo,Clérigo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, M', '1 Hora', '-', 'Nenhum', 'DES', 'Objeto brilha com luz plena em 6m e penumbra por mais 6m.', 'Bardo:1, Clérigo:1, Feiticeiro:1, Mago:1'),
      ('Mãos Mágicas', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'V, S', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Mão espectral flutuante que manipula objetos a distância.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Mensagem', 'Truque', 'Bardo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', '1 Rodada', '-', 'Nenhum', 'Nenhum', 'Sussurra uma mensagem para uma criatura que só ela ouve.', 'Bardo:1, Feiticeiro:1, Mago:1'),
      ('Prestidigitação', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '3m', 'V, S', '1 Hora', '-', 'Nenhum', 'Nenhum', 'Efeitos mágicos simples: limpar, acender velas, odores ou sabores.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Raio de Fogo', 'Truque', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '1d10', 'Fogo', 'Nenhum', 'Ataque mágico à distância. Incendeia objetos inflamáveis.', 'Feiticeiro:1, Mago:1'),
      ('Raio de Gelo', 'Truque', 'Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '1d8', 'Frio', 'Nenhum', 'Reduz o deslocamento do alvo em 3m até seu próximo turno.', 'Feiticeiro:1, Mago:1'),
      ('Rajada Mística', 'Truque', 'Bruxo', '1 Ação', '36m', 'V, S', 'Instantânea', '1d10', 'Força', 'Nenhum', 'Feixe de energia. No nível 5, cria dois feixes.', 'Bruxo:1'),
      ('Rajada de Veneno', 'Truque', 'Bruxo,Druida,Feiticeiro,Mago', '1 Ação', '3m', 'V, S', 'Instantânea', '1d12', 'Veneno', 'CON', 'Névoa tóxica. Constituição anula o dano.', 'Bruxo:1, Druida:1, Feiticeiro:1, Mago:1'),
      ('Resistência', 'Truque', 'Clérigo,Druida', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '+1d4', 'Força', 'Nenhum', 'O alvo adiciona 1d4 em um teste de resistência.', 'Clérigo:1, Druida:1'),
      ('Taumaturgia', 'Truque', 'Clérigo', '1 Ação', '9m', 'V', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Manifestações: voz alta, tremer chão, abrir portas, mudar olhos.', 'Clérigo:1'),
      ('Toque Arrepiante', 'Truque', 'Bruxo,Feiticeiro,Mago', '1 Ação', '36m', 'V, S', '1 Rodada', '1d8', 'Necrótico', 'Nenhum', 'Alvo não pode recuperar PV até seu próximo turno.', 'Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Toque Chocante', 'Truque', 'Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S', 'Instantânea', '1d8', 'Elétrico', 'Nenhum', 'Vantagem contra metal. Alvo perde a Reação.', 'Feiticeiro:1, Mago:1'),
      ('Zombaria Viciosa', 'Truque', 'Bardo', '1 Ação', '18m', 'V', 'Instantânea', '1d4', 'Psíquico', 'SAB', 'Alvo deve passar em Sabedoria ou terá desvantagem no próximo ataque.', 'Bardo:1'),
      ('Proteção contra Lâminas', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S', '1 Rodada', '-', 'Nenhum', 'Nenhum', 'Você ganha resistência contra dano de concussão, cortante e perfurante causado por ataques com armas.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Espirro Ácido', 'Truque', 'Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '1d6', 'Ácido', 'DES', 'Atira uma bolha de ácido. Você pode escolher um alvo ou dois alvos que estejam a até 1,5m um do outro.', 'Bruxo:1, Feiticeiro:1, Mago:1'),
      ('Golpe Certeiro', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '9m', 'S', 'Concentração', '-', 'Outro', 'Nenhum', 'Você prevê as defesas do alvo. Você tem Vantagem na sua próxima jogada de ataque contra ele.', 'Bardo:1, Bruxo:1, Feiticeiro:1, Mago:1'),

      -- NÍVEL 1
      ('Alarme', 'Nível 1', 'Patrulheiro,Mago', '1 Minuto', '9m', 'V, S, M', '8 Horas', '-', 'Nenhum', 'Nenhum', 'Alerta mental ou sonoro se uma criatura entrar na área.', 'Patrulheiro:2, Mago:1'),
      ('Armadura Arcana', 'Nível 1', 'Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', '8 Horas', '-', 'Nenhum', 'Nenhum', 'CA base torna-se 13 + Mod. Destreza por 8 horas.', 'Feiticeiro:1, Mago:1'),
      ('Armadura de Agathys', 'Nível 1', 'Bruxo', '1 Ação', 'Pessoal', 'V, S, M', '1 Hora', '5', 'Frio', 'Nenhum', 'Ganha 5 PV temporários e causa 5 de dano ao atacante.', 'Bruxo:1'),
      ('Bênção', 'Nível 1', 'Clérigo,Paladino', '1 Ação', '9m', 'V, S, M', 'Concentração', '+1d4', 'Força', 'Nenhum', 'Até 3 criaturas somam 1d4 em ataques e resistências.', 'Clérigo:1, Paladino:2'),
      ('Bom Fruto', 'Nível 1', 'Druida,Patrulheiro', '1 Ação', 'Toque', 'V, S, M', 'Instantânea', '1', 'Cura', 'Nenhum', 'Cria 10 frutos que curam 1 PV e alimentam por um dia.', 'Druida:1, Patrulheiro:2'),
      ('Bruxaria', 'Nível 1', 'Bruxo', '1 Ação Bônus', '27m', 'V, S, M', 'Concentração', '1d6', 'Necrótico', 'Nenhum', 'Dano extra e desvantagem em testes de um atributo escolhido.', 'Bruxo:1'),
      ('Comando', 'Nível 1', 'Clérigo,Paladino', '1 Ação', '18m', 'V', '1 Rodada', '-', 'Nenhum', 'SAB', 'Ordem de uma palavra (Fuja, Pare). Sabedoria anula.', 'Clérigo:1, Paladino:2'),
      ('Curar Ferimentos', 'Nível 1', 'Bardo,Clérigo,Druida,Paladino,Patrulheiro', '1 Ação', 'Toque', 'V, S', 'Instantânea', '1d8', 'Cura', 'Nenhum', 'Cura uma criatura tocada.', 'Bardo:1, Clérigo:1, Druida:1, Paladino:2, Patrulheiro:2'),
      ('Detectar Magia', 'Nível 1', 'Clérigo,Druida,Feiticeiro,Mago,Paladino', '1 Ação', 'Pessoal', 'V, S', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Percebe aura de magias em até 9m por 10 min.', 'Clérigo:1, Druida:1, Feiticeiro:1, Mago:1, Paladino:2'),
      ('Enfeitiçar Pessoa', 'Nível 1', 'Bardo,Bruxo,Druida,Feiticeiro,Mago', '1 Ação', '9m', 'V, S', '1 Hora', '-', 'Nenhum', 'SAB', 'Humanoide fica encantado por 1 hora.', 'Bardo:1, Bruxo:1, Druida:1, Feiticeiro:1, Mago:1'),
      ('Escudo Arcano', 'Nível 1', 'Feiticeiro,Mago', '1 Reação', 'Pessoal', 'V, S', '1 Rodada', '-', 'Nenhum', 'Nenhum', '+5 na CA até o início do seu próximo turno.', 'Feiticeiro:1, Mago:1'),
      ('Fogo das Fadas', 'Nível 1', 'Bardo,Druida', '1 Ação', '18m', 'V', 'Concentração', '-', 'Nenhum', 'DES', 'Alvos na área brilham e ataques contra eles têm Vantagem.', 'Bardo:1, Druida:1'),
      ('Mãos Flamejantes', 'Nível 1', 'Feiticeiro,Mago', '1 Ação', 'Cone', 'V, S', 'Instantânea', '3d6', 'Fogo', 'DES', 'Rajada de chamas. Destreza reduz à metade.', 'Feiticeiro:1, Mago:1'),
      ('Mísseis Mágicos', 'Nível 1', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '3x 1d4+1', 'Força', 'Nenhum', 'Três dardos que atingem o alvo automaticamente.', 'Feiticeiro:1, Mago:1'),
      ('Onda Trovejante', 'Nível 1', 'Bardo,Druida,Feiticeiro,Mago', '1 Ação', 'Cubo', 'V, S', 'Instantânea', '2d8', 'Trovejante', 'CON', 'Empurra criaturas 3m. Constituição reduz dano.', 'Bardo:1, Druida:1, Feiticeiro:1, Mago:1'),
      ('Palavra Curativa', 'Nível 1', 'Bardo,Clérigo,Druida', '1 Ação Bônus', '18m', 'V', 'Instantânea', '1d4', 'Cura', 'Nenhum', 'Cura rápida a distância.', 'Bardo:1, Clérigo:1, Druida:1'),
      ('Riso de Tasha', 'Nível 1', 'Bardo,Mago', '1 Ação', '9m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Alvo cai no chão de rir e fica incapacitado. Sabedoria anula.', 'Bardo:1, Mago:1'),
      ('Sono', 'Nível 1', 'Bardo,Feiticeiro,Mago', '1 Ação', '27m', 'V, S, M', '1 Minuto', '5d8', 'Outro', 'Nenhum', 'Põe criaturas em um sono mágico. Role o dado para ver o total de PV afetados (inimigos com menos PV dormem primeiro).', 'Bardo:1, Feiticeiro:1, Mago:1'),
      ('Escudo da Fé', 'Nível 1', 'Clérigo,Paladino', '1 Ação Bônus', '18m', 'V, S, M', 'Concentração', '+2', 'Outro', 'Nenhum', 'Um campo cintilante envolve o alvo, concedendo +2 na sua Classe de Armadura (CA).', 'Clérigo:1, Paladino:2'),
      ('Passos Longos', 'Nível 1', 'Bardo,Druida,Patrulheiro,Mago', '1 Ação', 'Toque', 'V, S, M', '1 Hora', '+3m', 'Outro', 'Nenhum', 'O deslocamento do alvo aumenta em 3 metros até a magia acabar.', 'Bardo:1, Druida:1, Patrulheiro:2, Mago:1'),
      ('Raio Adoecedor', 'Nível 1', 'Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Instantânea', '2d8', 'Veneno', 'CON', 'Um raio esverdeado atinge o alvo. Se falhar na resistência, fica Envenenado até o fim do seu próximo turno.', 'Bruxo:1, Feiticeiro:1, Mago:1'),

      -- NÍVEL 2
      ('Arma Espiritual', 'Nível 2', 'Clérigo', '1 Ação Bônus', '18m', 'V, S', '1 Minuto', '1d8', 'Força', 'Nenhum', 'Cria arma flutuante que ataca como ação bônus.', 'Clérigo:3'),
      ('Crescer Espinhos', 'Nível 2', 'Druida,Patrulheiro', '1 Ação', '45m', 'V, S, M', 'Concentração', '2d4', 'Perfurante', 'Nenhum', 'Chão difícil que causa dano ao se mover.', 'Druida:3, Patrulheiro:5'),
      ('Imobilizar Pessoa', 'Nível 2', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Paralisa um humanoide. Sabedoria anula.', 'Bardo:3, Clérigo:3, Druida:3, Feiticeiro:3, Mago:3'),
      ('Invisibilidade', 'Nível 2', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Alvo fica invisível por 1 hora ou até atacar/conjurar.', 'Bardo:3, Bruxo:3, Feiticeiro:3, Mago:3'),
      ('Passo Nebuloso', 'Nível 2', 'Bruxo,Feiticeiro,Mago', '1 Ação Bônus', 'Pessoal', 'V', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Teletransporta você por 9m para um local visível.', 'Bruxo:3, Feiticeiro:3, Mago:3'),
      ('Passos Sem Pegadas', 'Nível 2', 'Druida,Patrulheiro', '1 Ação', 'Pessoal', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', '+10 em Furtividade e não deixa rastros.', 'Druida:3, Patrulheiro:5'),
      ('Raio Ardente', 'Nível 2', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '3x 2d6', 'Fogo', 'Nenhum', 'Atira três raios de fogo. Pode atingir alvos diferentes.', 'Feiticeiro:3, Mago:3'),
      ('Reflexos', 'Nível 2', 'Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S', '1 Minuto', '-', 'Nenhum', 'Nenhum', 'Cria 3 duplicatas que distraem ataques inimigos.', 'Feiticeiro:3, Mago:3'),
      ('Teia', 'Nível 2', 'Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'DES', 'Cria uma massa de teias espessas em um cubo de 6m. A área vira terreno difícil e quem falhar no teste fica Impedido.', 'Feiticeiro:3, Mago:3'),
      ('Despedaçar', 'Nível 2', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Instantânea', '3d8', 'Trovejante', 'CON', 'Um som alto e doloroso explode em uma esfera de 3m. Criaturas inorgânicas têm Desvantagem no teste.', 'Bardo:3, Bruxo:3, Feiticeiro:3, Mago:3'),
      ('Cegueira/Surdez', 'Nível 2', 'Bardo,Clérigo,Feiticeiro,Mago', '1 Ação', '9m', 'V', '1 Minuto', '-', 'Outro', 'CON', 'Você cega ou ensurdece um inimigo à sua escolha (sem precisar de concentração).', 'Bardo:3, Clérigo:3, Feiticeiro:3, Mago:3'),
      ('Esquentar Metal', 'Nível 2', 'Bardo,Druida', '1 Ação', '18m', 'V, S, M', 'Concentração', '2d8', 'Fogo', 'CON', 'Você torna um objeto de metal incandescente. Quem segurar o metal sofre dano e tem Desvantagem em ataques.', 'Bardo:3, Druida:3'),
      
      -- NÍVEL 3
      ('Bola de Fogo', 'Nível 3', 'Feiticeiro,Mago', '1 Ação', '45m', 'V, S, M', 'Instantânea', '8d6', 'Fogo', 'DES', 'Explosão em esfera de 6m. Destreza reduz dano.', 'Feiticeiro:5, Mago:5'),
      ('Contrafeitiço', 'Nível 3', 'Bruxo,Feiticeiro,Mago', '1 Reação', '18m', 'S', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Interrompe a conjuração de outra criatura.', 'Bruxo:5, Feiticeiro:5, Mago:5'),
      ('Dissipar Magia', 'Nível 3', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Encerra magias ativas em um objeto ou criatura.', 'Bardo:5, Clérigo:5, Druida:5, Feiticeiro:5, Mago:5'),
      ('Espíritos Guardiões', 'Nível 3', 'Clérigo', '1 Ação', 'Pessoal', 'V, S, M', 'Concentração', '3d8', 'Radiante', 'SAB', 'Espíritos causam dano e reduzem movimento inimigo.', 'Clérigo:5'),
      ('Relâmpago', 'Nível 3', 'Feiticeiro,Mago', '1 Ação', 'Pessoal', 'V, S, M', 'Instantânea', '8d6', 'Elétrico', 'DES', 'Uma linha de eletricidade atinge todos no caminho.', 'Feiticeiro:5, Mago:5'),
      ('Revivificar', 'Nível 3', 'Clérigo,Paladino', '1 Ação', 'Toque', 'V, S, M', 'Instantânea', '-', 'Cura', 'Nenhum', 'Retorna à vida uma criatura que morreu no último minuto.', 'Clérigo:5, Paladino:9'),
      ('Velocidade', 'Nível 3', 'Feiticeiro,Mago', '1 Ação', '9m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Dobra deslocamento, +2 na CA e dá ação extra.', 'Feiticeiro:5, Mago:5'),
      ('Voo', 'Nível 3', 'Bruxo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '18m', 'Outro', 'Nenhum', 'O alvo tocado ganha deslocamento de voo de 18 metros.', 'Bruxo:5, Feiticeiro:5, Mago:5'),
      ('Padrão Hipnótico', 'Nível 3', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '36m', 'S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Cria um padrão de cores cintilantes em um cubo de 9m. Quem olhar fica Encantado e Incapacitado.', 'Bardo:5, Bruxo:5, Feiticeiro:5, Mago:5'),
      ('Animar Mortos', 'Nível 3', 'Clérigo,Mago', '1 Minuto', '3m', 'V, S, M', 'Instantânea', '-', 'Outro', 'Nenhum', 'Cria um servo morto-vivo (esqueleto ou zumbi) a partir de restos mortais, que obedece seus comandos.', 'Clérigo:5, Mago:5'),
      ('Manto do Cruzado', 'Nível 3', 'Paladino', '1 Ação', 'Pessoal', 'V', 'Concentração', '1d4', 'Radiante', 'Nenhum', 'Uma aura sagrada de 9m emana de você. Aliados na área causam +1d4 de dano radiante extra nos ataques.', 'Paladino:9'),

      -- NÍVEL 4
      ('Muralha de Fogo', 'Nível 4', 'Druida,Feiticeiro,Mago', '1 Ação', '36m', 'V, S, M', 'Concentração', '5d8', 'Fogo', 'DES', 'Cria uma cortina de fogo de 18m de comprimento.', 'Druida:7, Feiticeiro:7, Mago:7'),
      ('Polimorfia', 'Nível 4', 'Bardo,Druida,Feiticeiro,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Transforma criatura em besta de ND adequado.', 'Bardo:7, Druida:7, Feiticeiro:7, Mago:7'),
      ('Porta Dimensional', 'Nível 4', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '150m', 'V', 'Instantânea', '-', 'Nenhum', 'Nenhum', 'Teletransporta você e um aliado para local visível.', 'Bardo:7, Bruxo:7, Feiticeiro:7, Mago:7'),
      ('Tempestade de Gelo', 'Nível 4', 'Druida,Feiticeiro,Mago', '1 Ação', '90m', 'V, S, M', 'Instantânea', '2d8+4d6', 'Frio', 'DES', 'Chuva de granizo em área de 6m.', 'Druida:7, Feiticeiro:7, Mago:7'),
      ('Banimento', 'Nível 4', 'Clérigo,Paladino,Feiticeiro,Bruxo,Mago', '1 Ação', '18m', 'V, S, M', 'Concentração', '-', 'Outro', 'CAR', 'Tenta enviar uma criatura para outro plano de existência temporária ou permanentemente.', 'Clérigo:7, Paladino:13, Feiticeiro:7, Bruxo:7, Mago:7'),
      ('Invisibilidade Maior', 'Nível 4', 'Bardo,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S', 'Concentração', '-', 'Nenhum', 'Nenhum', 'Deixa o alvo invisível. Diferente da magia padrão, esta invisibilidade NÃO quebra ao atacar ou lançar magias.', 'Bardo:7, Feiticeiro:7, Mago:7'),
      ('Pele de Pedra', 'Nível 4', 'Druida,Patrulheiro,Feiticeiro,Mago', '1 Ação', 'Toque', 'V, S, M', 'Concentração', '-', 'Outro', 'Nenhum', 'A carne do alvo fica dura como pedra, dando resistência a dano não-mágico de concussão, cortante e perfurante.', 'Druida:7, Patrulheiro:13, Feiticeiro:7, Mago:7'),

      -- NÍVEL 5
      ('Âncora Planar', 'Nível 5', 'Bardo,Clérigo,Druida,Feiticeiro,Mago', '1 Hora', '18m', 'V, S, M', '24 Horas', '-', 'Nenhum', 'CAR', 'Prende um extraplanar ao seu serviço por 24 horas.', 'Bardo:9, Clérigo:9, Druida:9, Feiticeiro:9, Mago:9'),
      ('Coluna de Chamas', 'Nível 5', 'Clérigo', '1 Ação', '18m', 'V, S, M', 'Instantânea', '4d6+4d6', 'Fogo', 'DES', 'Coluna de fogo divino em cilindro de 3m.', 'Clérigo:9'),
      ('Curar Ferimentos em Massa', 'Nível 5', 'Bardo,Clérigo,Druida', '1 Ação', '18m', 'V, S', 'Instantânea', '3d8', 'Cura', 'Nenhum', 'Cura até 6 criaturas na área.', 'Bardo:9, Clérigo:9, Druida:9'),
      ('Imobilizar Monstro', 'Nível 5', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '27m', 'V, S, M', 'Concentração', '-', 'Nenhum', 'SAB', 'Paralisa qualquer tipo de criatura. Sabedoria anula.', 'Bardo:9, Bruxo:9, Feiticeiro:9, Mago:9'),
      ('Cone de Frio', 'Nível 5', 'Feiticeiro,Mago', '1 Ação', 'Cone', 'V, S, M', 'Instantânea', '8d8', 'Frio', 'CON', 'Uma nevasca intensa e dolorosa é expelida de suas mãos, congelando criaturas em um cone de 18 metros.', 'Feiticeiro:9, Mago:9'),
      ('Névoa Mortal', 'Nível 5', 'Feiticeiro,Mago', '1 Ação', '36m', 'V, S', 'Concentração', '5d8', 'Veneno', 'CON', 'Uma névoa tóxica espessa aparece. Ela obscurece a visão e causa dano severo a quem respirar, movendo-se 3m por rodada.', 'Feiticeiro:9, Mago:9'),
      ('Dominar Pessoa', 'Nível 5', 'Bardo,Bruxo,Feiticeiro,Mago', '1 Ação', '18m', 'V, S', 'Concentração', '-', 'Outro', 'SAB', 'Toma o controle mental de um humanoide. Você tem controle telepático sobre as ações dele.', 'Bardo:9, Bruxo:9, Feiticeiro:9, Mago:9'),
      
      -- =========================
      -- GUERREIRO - FEATURES
      -- =========================

      ('Ação Surto', 'Classe', 'Guerreiro', 'Especial', 'Pessoal', '-', 'Instantânea', '-', 'Nenhum', 'Nenhum', 
      'Você pode realizar uma ação adicional no seu turno. Recupera após descanso curto ou longo.', 
      2),

      ('Segundo Fôlego', 'Classe', 'Guerreiro', '1 Ação Bônus', 'Pessoal', '-', 'Instantânea', '1d10 + nível', 'Cura', 'Nenhum', 
      'Você recupera pontos de vida iguais a 1d10 + seu nível de Guerreiro.', 
      1),

      ('Ataque Extra', 'Classe', 'Guerreiro,Paladino,Patrulheiro', 'Passiva', 'Pessoal', '-', 'Permanente', '-', 'Nenhum', 'Nenhum', 
      'Você pode atacar duas vezes, em vez de uma, quando realiza a ação de Ataque no seu turno.', 
      5),

      -- =========================
      -- MESTRE DE BATALHA (MANOBRAS)
      -- =========================

      ('Ataque de Precisão', 'Manobra', 'Guerreiro', 'Reação', 'Arma', '-', 'Instantânea', '+1d8', 'Extra', 'Nenhum', 
      'Você pode adicionar um dado de superioridade à jogada de ataque.', 
      3),

      ('Ataque de Tropeço', 'Manobra', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Concussão', 'FOR', 
      'Se o alvo falhar no teste de Força, ele fica Caído.', 
      3),

      ('Ataque Desarmante', 'Manobra', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Extra', 'FOR', 
      'O alvo deve fazer teste de Força ou derruba um objeto que esteja segurando.', 
      3),

      ('Ataque Ameaçador', 'Manobra', 'Guerreiro', 'Após acertar', 'Arma', '-', 'Instantânea', '+1d8', 'Psíquico', 'SAB', 
      'O alvo deve passar em Sabedoria ou ficará Amedrontado até o fim do seu próximo turno.', 
      3),

      -- =========================
      -- PALADINO - FEATURES
      -- =========================

      ('Imposição das Mãos', 'Classe', 'Paladino', '1 Ação', 'Toque', '-', 'Instantânea', '5 x nível', 'Cura', 'Nenhum', 
      'Você possui uma reserva de cura igual a 5 vezes seu nível de Paladino.', 
      1),

      ('Sentido Divino', 'Classe', 'Paladino', '1 Ação', '18m', '-', '1 Rodada', '-', 'Outro', 'Nenhum', 
      'Você detecta celestiais, infernais e mortos-vivos próximos.', 
      1),

      ('Golpe Divino', 'Classe', 'Paladino', 'Após acertar', 'Arma', '-', 'Instantânea', '2d8+', 'Radiante', 'Nenhum', 
      'Quando você acerta um ataque corpo-a-corpo, pode gastar um espaço de magia para causar dano radiante extra.', 
      2),

      ('Aura de Proteção', 'Classe', 'Paladino', 'Passiva', '3m', '-', 'Permanente', '+CAR', 'Outro', 'Nenhum', 
      'Você e aliados próximos adicionam seu modificador de Carisma em testes de resistência.', 
      6),

      -- =========================
      -- PATRULHEIRO - FEATURES
      -- =========================

      ('Inimigo Favorito', 'Classe', 'Patrulheiro', 'Passiva', 'Pessoal', '-', 'Permanente', '+2', 'Extra', 'Nenhum', 
      'Você causa dano adicional contra um tipo específico de criatura.', 
      1),

      ('Explorador Nato', 'Classe', 'Patrulheiro', 'Passiva', 'Terreno Natural', '-', 'Permanente', '-', 'Outro', 'Nenhum', 
      'Você ignora terreno difícil e não pode se perder em seu terreno favorecido.', 
      1),

      ('Marca do Caçador (Habilidade)', 'Classe', 'Patrulheiro', '1 Ação Bônus', '27m', '-', 'Concentração', '1d6', 'Extra', 'Nenhum', 
      'Você marca um alvo e causa 1d6 de dano adicional sempre que o acerta.', 
      2);`
    );

    await db.execAsync(`INSERT INTO subclasses (name, class_name, level_required) VALUES 
      -- BÁRBARO
      ('Caminho do Berserker', 'Bárbaro', 3),
      ('Caminho do Totem Guerreiro', 'Bárbaro', 3),
      ('Caminho do Guardião Ancestral', 'Bárbaro', 3),

      -- BARDO
      ('Colégio do Conhecimento', 'Bardo', 3),
      ('Colégio da Bravura', 'Bardo', 3),
      ('Colégio das Espadas', 'Bardo', 3),

      -- BRUXO
      ('O Corruptor', 'Bruxo', 1),
      ('O Arquifada', 'Bruxo', 1),
      ('O Grande Antigo', 'Bruxo', 1),
      ('Lâmina Maldita (Hexblade)', 'Bruxo', 1),

      -- CLÉRIGO
      ('Domínio da Vida', 'Clérigo', 1),
      ('Domínio da Luz', 'Clérigo', 1),
      ('Domínio da Guerra', 'Clérigo', 1),
      ('Domínio da Tempestade', 'Clérigo', 1),
      ('Domínio da Trapaça', 'Clérigo', 1),

      -- DRUIDA
      ('Círculo da Lua', 'Druida', 2),
      ('Círculo da Terra', 'Druida', 2),
      ('Círculo dos Esporos', 'Druida', 2),

      -- FEITICEIRO
      ('Linhagem Dracônica', 'Feiticeiro', 1),
      ('Magia Selvagem', 'Feiticeiro', 1),
      ('Alma Divina', 'Feiticeiro', 1),
      ('Mente Aberrante', 'Feiticeiro', 1),

      -- GUERREIRO
      ('Campeão', 'Guerreiro', 3),
      ('Mestre de Batalha', 'Guerreiro', 3),
      ('Cavaleiro Arcano', 'Guerreiro', 3),
      ('Samurai', 'Guerreiro', 3),

      -- LADINO
      ('Assassino', 'Ladino', 3),
      ('Ladrão', 'Ladino', 3),
      ('Trapaceiro Arcano', 'Ladino', 3),
      ('Espadachim', 'Ladino', 3),

      -- MAGO
      ('Abjuração', 'Mago', 2),
      ('Evocação', 'Mago', 2),
      ('Necromancia', 'Mago', 2),
      ('Adivinhação', 'Mago', 2),
      ('Ilusão', 'Mago', 2),

      -- MONGE
      ('Caminho da Mão Aberta', 'Monge', 3),
      ('Caminho das Sombras', 'Monge', 3),
      ('Caminho dos Quatro Elementos', 'Monge', 3),

      -- PALADINO
      ('Devoção', 'Paladino', 3),
      ('Juramento dos Anciões', 'Paladino', 3),
      ('Juramento de Vingança', 'Paladino', 3),
      ('Juramento de Conquista', 'Paladino', 3),

      -- PATRULHEIRO (RANGER)
      ('Caçador', 'Patrulheiro', 3),
      ('Mestre das Bestas', 'Patrulheiro', 3),
      ('Andarilho do Horizonte', 'Patrulheiro', 3);`);
      
    } else {
      console.log('Banco de dados já populado. Pulando inserção.');
    }
}