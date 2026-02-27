import { SQLiteDatabase } from 'expo-sqlite';

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA journal_mode = WAL;`);

  // 1. LIMPEZA TOTAL
  await db.execAsync(`
    DROP TABLE IF EXISTS races;
    DROP TABLE IF EXISTS classes;
    DROP TABLE IF EXISTS saving_throws;
    DROP TABLE IF EXISTS skills;
    DROP TABLE IF EXISTS spells;
    DROP TABLE IF EXISTS items;
  `);

  // 2. CRIAÇÃO DAS TABELAS (Atenção à coluna starting_equipment)
  await db.execAsync(`
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, weight REAL NOT NULL);
    CREATE TABLE races (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, stat_bonuses TEXT NOT NULL);
    CREATE TABLE classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, recommended_stats TEXT NOT NULL, starting_equipment TEXT NOT NULL, starting_gold INTEGER NOT NULL);
    CREATE TABLE saving_throws (id TEXT PRIMARY KEY, name TEXT NOT NULL, stat TEXT NOT NULL);
    CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, stat TEXT NOT NULL);
    CREATE TABLE spells (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT NOT NULL, 
    level TEXT NOT NULL, 
    classes TEXT NOT NULL,
    casting_time TEXT,
    range TEXT,
    damage TEXT,
    description TEXT
  );
  `);

  await db.execAsync(`
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

  console.log('Populando banco de dados completo...');

  // 3. INSERÇÃO DE ITENS (Obrigatório para o peso funcionar)
  await db.execAsync(`INSERT INTO items (name, weight) VALUES
    ('Machado Grande', 3.5), ('Machadinha', 1.0), ('Azagaia', 1.0), ('Rapieira', 1.0), 
    ('Alaúde', 1.0), ('Armadura de Couro', 5.0), ('Adaga', 0.5), ('Besta Leve', 2.5), 
    ('Aljava com 20 Virotes', 0.75), ('Foco Arcano', 0.5), ('Maça', 2.0), ('Cota de Malha', 27.5), 
    ('Escudo', 3.0), ('Símbolo Sagrado', 0.0), ('Cimitarra', 1.5), ('Foco Druídico', 0.0), 
    ('Espada Longa', 1.5), ('Arco Curto', 1.0), ('Aljava com 20 Flechas', 0.5), 
    ('Ferramentas de Ladrão', 0.5), ('Bordão', 2.0), ('Livro de Magias', 1.5), 
    ('Espada Curta', 1.0), ('10 Dardos', 1.25), ('Armadura de Couro Batido', 6.5), 
    ('Arco Longo', 1.0), ('Mochila', 2.5), ('Saco de dormir', 3.5), ('Kit de refeição', 0.5), 
    ('Caixa de fogo', 0.5), ('Tocha', 0.5), ('Ração (1 dia)', 1.0), ('Odre (cheio)', 2.5), 
    ('Corda de Cânhamo (15m)', 5.0), ('Roupas Comuns', 1.5), ('Vela', 0.01), 
    ('Kit de Disfarce', 1.5), ('Livro', 2.5), ('Vidro de Tinta', 0.0), ('Caneta-tinteiro', 0.0), 
    ('Pergaminho', 0.0), ('Faca pequena', 0.25), ('Cobertor', 1.5), ('Caixa de Esmolas', 0.5), 
    ('Incensário', 0.5), ('Vestes', 2.0), ('Saco de Esferas de Metal', 1.0), ('Fio (3m)', 0.0), 
    ('Sino', 0.0), ('Pé de cabra', 2.5), ('Martelo', 1.5), ('Pitão', 0.1), ('Peça de Ouro (PO)', 0.01),
    ('Peça de Prata (PP)', 0.01),('Peça de Cobre (PC)', 0.01),
    ('Lanterna Furta-Fogo', 1.0), ('Frasco de Óleo', 0.5);`);

  // 4. RAÇAS
  await db.execAsync(`INSERT INTO races (name, stat_bonuses) VALUES 
    ('Anão', '{"CON": 2}'), ('Draconato', '{"FOR": 2, "CAR": 1}'), ('Elfo', '{"DES": 2}'), 
    ('Gnomo', '{"INT": 2}'), ('Halfling', '{"DES": 2}'), 
    ('Humano', '{"FOR": 1, "DES": 1, "CON": 1, "INT": 1, "SAB": 1, "CAR": 1}'), 
    ('Meio-Elfo', '{"CAR": 2, "DES": 1, "CON": 1}'), ('Meio-Orc', '{"FOR": 2, "CON": 1}'), 
    ('Tiefling', '{"CAR": 2, "INT": 1}');`);

  // 5. CLASSES (Agora com starting_equipment preenchido corretamente)
await db.execAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold) VALUES 
    ('Bárbaro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Machado Grande","qty":1},{"name":"Mochila","qty":1},{"name":"Saco de dormir","qty":1},{"name":"Tocha","qty":5}]', 10),
    ('Bardo', '{"FOR": 8, "DES": 14, "CON": 13, "INT": 12, "SAB": 10, "CAR": 15}', '[{"name":"Rapieira","qty":1},{"name":"Alaúde","qty":1},{"name":"Armadura de Couro","qty":1}]', 15),
    ('Bruxo', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Besta Leve","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Armadura de Couro","qty":1}]', 10),
    ('Clérigo', '{"FOR": 14, "DES": 10, "CON": 13, "INT": 8, "SAB": 15, "CAR": 12}', '[{"name":"Maça","qty":1},{"name":"Cota de Malha","qty":1},{"name":"Escudo","qty":1}]', 15),
    ('Druida', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 12, "SAB": 15, "CAR": 10}', '[{"name":"Cimitarra","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Foco Druídico","qty":1}]', 10),
    ('Feiticeiro', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 10, "SAB": 12, "CAR": 15}', '[{"name":"Adaga","qty":2},{"name":"Foco Arcano","qty":1}]', 10),
    ('Guerreiro', '{"FOR": 15, "DES": 13, "CON": 14, "INT": 8, "SAB": 12, "CAR": 10}', '[{"name":"Cota de Malha","qty":1},{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1}]', 15),
    ('Ladino', '{"FOR": 8, "DES": 15, "CON": 14, "INT": 12, "SAB": 10, "CAR": 13}', '[{"name":"Rapieira","qty":1},{"name":"Armadura de Couro","qty":1},{"name":"Ferramentas de Ladrão","qty":1}]', 15),
    ('Mago', '{"FOR": 8, "DES": 13, "CON": 14, "INT": 15, "SAB": 12, "CAR": 10}', '[{"name":"Bordão","qty":1},{"name":"Foco Arcano","qty":1},{"name":"Livro de Magias","qty":1}]', 10),
    ('Monge', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Espada Curta","qty":1},{"name":"10 Dardos","qty":1}]', 5),
    ('Paladino', '{"FOR": 15, "DES": 10, "CON": 13, "INT": 8, "SAB": 12, "CAR": 14}', '[{"name":"Espada Longa","qty":1},{"name":"Escudo","qty":1},{"name":"Cota de Malha","qty":1}]', 15),
    ('Patrulheiro', '{"FOR": 10, "DES": 15, "CON": 13, "INT": 8, "SAB": 14, "CAR": 12}', '[{"name":"Armadura de Couro Batido","qty":1},{"name":"Arco Longo","qty":1}]', 12);`);

  // 6. OUTROS DADOS (Saves, Skills, Spells)
  await db.execAsync(`INSERT INTO saving_throws (id, name, stat) VALUES ('save_for', 'Força', 'FOR'), ('save_des', 'Destreza', 'DES'), ('save_con', 'Constituição', 'CON'), ('save_int', 'Inteligência', 'INT'), ('save_sab', 'Sabedoria', 'SAB'), ('save_car', 'Carisma', 'CAR');`);
  await db.execAsync(`INSERT INTO skills (id, name, stat) VALUES ('skill_acrobacia', 'Acrobacia', 'DES'), ('skill_arcanismo', 'Arcanismo', 'INT'), ('skill_atletismo', 'Atletismo', 'FOR'), ('skill_atuacao', 'Atuação', 'CAR'), ('skill_blefar', 'Enganação / Blefar', 'CAR'), ('skill_furtividade', 'Furtividade', 'DES'), ('skill_historia', 'História', 'INT'), ('skill_intimidacao', 'Intimidação', 'CAR'), ('skill_intuicao', 'Intuição', 'SAB'), ('skill_investigacao', 'Investigação', 'INT'), ('skill_lidar_animais', 'Lidar com Animais', 'SAB'), ('skill_medicina', 'Medicina', 'SAB'), ('skill_natureza', 'Natureza', 'INT'), ('skill_percepcao', 'Percepção', 'SAB'), ('skill_persuasao', 'Persuasão', 'CAR'), ('skill_prestidigitacao', 'Prestidigitação', 'DES'), ('skill_religiao', 'Religião', 'INT'), ('skill_sobrevivencia', 'Sobrevivência', 'SAB');`);
 await db.execAsync(`INSERT INTO spells (name, level, classes, casting_time, range, damage, description) VALUES 
  ('Amizade', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', 'Pessoal', '-', 'Vantagem em testes de Carisma contra uma criatura não hostil. Após 1 min, o alvo sabe que foi encantado.'),
  ('Bordão Mágico', 'Truque', 'Druida', '1 ação', 'Toque', '1d8 concussão', 'A arma usada torna-se mágica. Você usa sua habilidade de conjuração para ataques e dano.'),
  ('Chama Sagrada', 'Truque', 'Clérigo', '1 ação', '18m', '1d8 radiante', 'O alvo deve passar num teste de Destreza ou sofrer dano. Ignora cobertura.'),
  ('Chicote de Espinhos', 'Truque', 'Druida', '1 ação', '9m', '1d6 perfurante', 'Ataque mágico corpo-a-corpo. Se atingir, puxa o alvo 3 metros para perto de você.'),
  ('Criar Chamas', 'Truque', 'Druida', '1 ação', 'Pessoal (9m)', '1d8 fogo', 'Chama na mão que ilumina 3m. Pode ser arremessada como ataque.'),
  ('Estabilizar', 'Truque', 'Clérigo', '1 ação', 'Toque', '-', 'Uma criatura com 0 PV torna-se estável instantaneamente.'),
  ('Globos de Luz', 'Truque', 'Bardo,Feiticeiro,Mago', '1 ação', '36m', '-', 'Cria quatro luzes do tamanho de tochas que flutuam no ar.'),
  ('Guia', 'Truque', 'Clérigo,Druida', '1 ação', 'Toque', '-', 'O alvo adiciona 1d4 em um teste de habilidade à escolha dele.'),
  ('Ilusão Menor', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', '9m', '-', 'Cria um som ou uma imagem de um objeto por 1 minuto.'),
  ('Luz', 'Truque', 'Bardo,Clérigo,Feiticeiro,Mago', '1 ação', 'Toque', '-', 'O objeto tocado brilha com luz plena em 6m e penumbra por mais 6m.'),
  ('Mãos Mágicas', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', '9m', '-', 'Uma mão espectral flutuante que pode manipular objetos a distância.'),
  ('Mensagem', 'Truque', 'Bardo,Feiticeiro,Mago', '1 ação', '36m', '-', 'Você aponta para uma criatura e sussurra uma mensagem que só ela ouve.'),
  ('Prestidigitação', 'Truque', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', '3m', '-', 'Truques mágicos simples: limpa itens, acende velas, cria odores ou sabores.'),
  ('Raio de Fogo', 'Truque', 'Feiticeiro,Mago', '1 ação', '36m', '1d10 fogo', 'Ataque mágico à distância. Incendeia objetos inflamáveis não usados.'),
  ('Raio de Gelo', 'Truque', 'Feiticeiro,Mago', '1 ação', '18m', '1d8 gelo', 'Ataque mágico à distância. Reduz o deslocamento do alvo em 3m até seu próximo turno.'),
  ('Rajada Mística', 'Truque', 'Bruxo', '1 ação', '36m', '1d10 força', 'Um feixe de energia estalante. No nível 5, cria dois feixes.'),
  ('Resistência', 'Truque', 'Clérigo,Druida', '1 ação', 'Toque', '-', 'O alvo adiciona 1d4 em um teste de resistência à escolha dele.'),
  ('Taumaturgia', 'Truque', 'Clérigo', '1 ação', '9m', '-', 'Manifestações divinas: altera a voz, treme o chão, abre portas ou muda olhos.'),
  ('Toque Arrepiante', 'Truque', 'Bruxo,Feiticeiro,Mago', '1 ação', '36m', '1d8 necrótico', 'Ataque mágico à distância. O alvo não pode recuperar PV até seu próximo turno.'),
  ('Toque Chocante', 'Truque', 'Feiticeiro,Mago', '1 ação', 'Toque', '1d8 elétrico', 'Vantagem se o alvo usar armadura de metal. O alvo perde a Reação.'),
  ('Zombaria Viciosa', 'Truque', 'Bardo', '1 ação', '18m', '1d4 psíquico', 'O alvo deve passar em Sabedoria ou terá desvantagem no próximo ataque.'),
  ('Alarme', 'Nível 1', 'Patrulheiro,Mago', '1 min', '9m', '-', 'Cria um alerta mental ou sonoro se uma criatura entrar na área.'),
  ('Armadura Arcana', 'Nível 1', 'Feiticeiro,Mago', '1 ação', 'Toque', '-', 'A CA base do alvo sem armadura torna-se 13 + Mod. Destreza por 8 horas.'),
  ('Armadura de Agathys', 'Nível 1', 'Bruxo', '1 ação', 'Pessoal', '5 frio', 'Ganha 5 PV temporários. Se atingido corpo-a-corpo, causa 5 de dano ao atacante.'),
  ('Bênção', 'Nível 1', 'Clérigo,Paladino', '1 ação', '9m', '-', 'Até 3 criaturas adicionam 1d4 em ataques e testes de resistência.'),
  ('Bom Fruto', 'Nível 1', 'Druida,Patrulheiro', '1 ação', 'Toque', '-', 'Cria 10 frutos que curam 1 PV cada e alimentam por um dia.'),
  ('Bruxaria', 'Nível 1', 'Bruxo', '1 ação bônus', '27m', '1d6 necrótico', 'Causa dano extra e dá desvantagem em testes de um atributo escolhido.'),
  ('Comando', 'Nível 1', 'Clérigo,Paladino', '1 ação', '18m', '-', 'Dê uma ordem de uma palavra (Fuja, Pare, Caia). Sabedoria anula.'),
  ('Compreender Idiomas', 'Nível 1', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', 'Pessoal', '-', 'Entenda o sentido literal de qualquer idioma falado ou escrito.'),
  ('Curar Ferimentos', 'Nível 1', 'Bardo,Clérigo,Druida,Paladino,Patrulheiro', '1 ação', 'Toque', '1d8 + Mod', 'Cura uma criatura tocada. Não afeta mortos-vivos ou constructos.'),
  ('Destruição Colérica', 'Nível 1', 'Paladino', '1 ação bônus', 'Pessoal', '1d6 psíquico', 'Próximo ataque causa dano extra e pode deixar o alvo amedrontado.'),
  ('Destruição Trovejante', 'Nível 1', 'Paladino', '1 ação bônus', 'Pessoal', '2d6 trovão', 'Próximo ataque empurra o alvo 3m e o derruba.'),
  ('Duelo Compelido', 'Nível 1', 'Paladino', '1 ação bônus', '9m', '-', 'Força o alvo a focar o combate em você. Sabedoria anula.'),
  ('Enfeitiçar Pessoa', 'Nível 1', 'Bardo,Bruxo,Druida,Feiticeiro,Mago', '1 ação', '9m', '-', 'Humanóide fica encantado por 1 hora. Vantagem no teste se você estiver lutando.'),
  ('Escudo Arcano', 'Nível 1', 'Feiticeiro,Mago', '1 reação', 'Pessoal', '-', 'Ganha +5 na CA até o início do seu próximo turno. Inclui Mísseis Mágicos.'),
  ('Escudo da Fé', 'Nível 1', 'Clérigo,Paladino', '1 ação bônus', '18m', '-', 'Um campo cintilante concede +2 na CA do alvo por 10 minutos.'),
  ('Falar com Animais', 'Nível 1', 'Bardo,Druida,Patrulheiro', '1 ação', 'Pessoal', '-', 'Você pode compreender e falar com feras pela duração (10 min).'),
  ('Fogo das Fadas', 'Nível 1', 'Bardo,Druida', '1 ação', '18m', '-', 'Objetos e alvos na área brilham. Ataques contra eles têm Vantagem.'),
  ('Golpe Constritor', 'Nível 1', 'Patrulheiro', '1 ação bônus', 'Pessoal', '1d6 perfurante', 'Alvo fica impedido por vinhas espinhosas e sofre dano por turno.'),
  ('Infligir Ferimentos', 'Nível 1', 'Clérigo', '1 ação', 'Toque', '3d10 necrótico', 'Ataque mágico corpo-a-corpo causa dano massivo de energia negativa.'),
  ('Marca do Caçador', 'Nível 1', 'Patrulheiro', '1 ação bônus', '27m', '1d6 perfurante', 'Dano extra em ataques com arma contra o alvo marcado.'),
  ('Mísseis Mágicos', 'Nível 1', 'Feiticeiro,Mago', '1 ação', '36m', '3x 1d4+1 força', 'Cria três dardos que atingem o alvo automaticamente, sem erro.'),
  ('Onda Trovejante', 'Nível 1', 'Bardo,Druida,Feiticeiro,Mago', '1 ação', 'Pessoal (cubo 4,5m)', '2d8 trovão', 'Empurra criaturas 3 metros. Constituição reduz dano à metade.'),
  ('Orbe Cromática', 'Nível 1', 'Feiticeiro,Mago', '1 ação', '27m', '3d8 variado', 'Você escolhe o tipo de dano: Ácido, Frio, Fogo, Elétrico, Veneno ou Trovão.'),
  ('Palavra Curativa', 'Nível 1', 'Bardo,Clérigo,Druida', '1 ação bônus', '18m', '1d4 + Mod', 'Cura rápida a distância. Ótima para levantar aliados caídos.'),
  ('Passos Longos', 'Nível 1', 'Bardo,Druida,Patrulheiro,Mago', '1 ação', 'Toque', '-', 'Aumenta o deslocamento do alvo em 3 metros por 1 hora.'),
  ('Perdição', 'Nível 1', 'Bardo,Clérigo', '1 ação', '9m', '-', 'Até 3 alvos subtraem 1d4 de ataques e testes de resistência.'),
  ('Queda Suave', 'Nível 1', 'Bardo,Feiticeiro,Mago', '1 reação', '18m', '-', 'Até 5 criaturas caem lentamente e não sofrem dano de queda.'),
  ('Raio Guiador', 'Nível 1', 'Clérigo', '1 ação', '36m', '4d6 radiante', 'Dano massivo. Próximo ataque contra o alvo tem Vantagem.'),
  ('Repreensão Infernal', 'Nível 1', 'Bruxo', '1 reação', '18m', '2d10 fogo', 'Reaja ao sofrer dano. Alvo deve passar em Destreza ou queimar.'),
  ('Santuário', 'Nível 1', 'Clérigo', '1 ação bônus', '9m', '-', 'Criaturas que atacarem o alvo devem passar em Sabedoria ou mudar o ataque.'),
  ('Sono', 'Nível 1', 'Bardo,Feiticeiro,Mago', '1 ação', '27m', '5d8 (PVs)', 'Coloca criaturas em sono profundo baseado no total de PVs rolados.'),
  ('Teia', 'Nível 1', 'Druida', '1 ação', '18m', '-', 'Cria teias pegajosas que impedem o movimento na área.'),
  ('Arma Espiritual', 'Nível 2', 'Clérigo', '1 ação bônus', '18m', '1d8 + Mod', 'Cria arma flutuante que ataca como ação bônus nos turnos seguintes.'),
  ('Crescer Espinhos', 'Nível 2', 'Druida,Patrulheiro', '1 ação', '45m', '2d4 (cada 1,5m)', 'Chão torna-se difícil e causa dano para cada 1,5m percorrido.'),
  ('Invisibilidade', 'Nível 2', 'Bardo,Bruxo,Feiticeiro,Mago', '1 ação', 'Toque', '-', 'Alvo fica invisível por 1 hora ou até atacar ou conjurar.'),
  ('Passos Sem Pegadas', 'Nível 2', 'Druida,Patrulheiro', '1 ação', 'Pessoal', '-', 'Você e aliados em 9m ganham +10 em Furtividade e não deixam rastros.'),
  ('Restauração Menor', 'Nível 2', 'Bardo,Clérigo,Druida,Paladino,Patrulheiro', '1 ação', 'Toque', '-', 'Cura uma condição: cego, surdo, paralisado ou envenenado.'),
  ('Bola de Fogo', 'Nível 3', 'Feiticeiro,Mago', '1 ação', '45m', '8d6 fogo', 'Explosão em esfera de 6m. Destreza reduz dano à metade.'),
  ('Espíritos Guardiões', 'Nível 3', 'Clérigo', '1 ação', 'Pessoal (4,5m)', '3d8 radiante/nec', 'Espíritos flutuam ao seu redor, causando dano e reduzindo o movimento de inimigos.');
`); 
  
}