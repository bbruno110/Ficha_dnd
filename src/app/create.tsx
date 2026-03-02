import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable,
  ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';

// ================= TIPAGENS =================
type RaceItem = { id: number; name: string; stat_bonuses: string; speed: string; criador?: string };
type ClassItem = { id: number; name: string; recommended_stats: string; starting_equipment: string; starting_gold: number; hit_dice: number; saves: string; subclass_level: number; is_caster: number; criador?: string };
type SkillItem = { id: string; name: string; stat: string };
type SpellItem = { 
  id: number; 
  name: string; 
  level: string; 
  casting_time?: string; 
  range?: string; 
  damage?: string; 
  description?: string;
  classes?: string;
};
type DbItem = { id: number; name: string; weight: number; criador?: string };
type InventoryItem = { name: string; qty: number; weight: number };
type StartingKit = { id: number; name: string; target_name: string; items: string; criador?: string };

export default function CreateCharacterScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const isRandomizing = useRef(false);

  // ----- ESTADOS DO BANCO DE DADOS -----
  const [dbRaces, setDbRaces] = useState<RaceItem[]>([]);
  const [dbClasses, setDbClasses] = useState<ClassItem[]>([]);
  const [dbSavingThrows, setDbSavingThrows] = useState<SkillItem[]>([]);
  const [dbSkills, setDbSkills] = useState<SkillItem[]>([]);
  const [availableSpells, setAvailableSpells] = useState<SpellItem[]>([]);
  const [dbItems, setDbItems] = useState<DbItem[]>([]); 
  const [dbKits, setDbKits] = useState<StartingKit[]>([]);

  // ----- ESTADOS BÁSICOS -----
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [race, setRace] = useState('Selecione uma raça');
  const [charClass, setCharClass] = useState('Selecione uma classe');
  const [stats, setStats] = useState({ FOR: '10', DES: '10', CON: '10', INT: '10', SAB: '10', CAR: '10' });
  const [maxStatsSum, setMaxStatsSum] = useState(72);

  const [profBonus, setProfBonus] = useState('+2');
  const [inspiration, setInspiration] = useState('');
  const [proficiencies, setProficiencies] = useState<string[]>([]);
  const [saveValues, setSaveValues] = useState<Record<string, string>>({});
  const [skillValues, setSkillValues] = useState<Record<string, string>>({});

  const [personalityTraits, setPersonalityTraits] = useState('');
  const [ideals, setIdeals] = useState('');
  const [bonds, setBonds] = useState('');
  const [flaws, setFlaws] = useState('');
  
  const [backstory, setBackstory] = useState('');
  const [alliesOrganizations, setAlliesOrganizations] = useState('');
  const [featuresTraits, setFeaturesTraits] = useState('');
  const [languages, setLanguages] = useState('');

  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [spellSearch, setSpellSearch] = useState('');
  
  const [selectedSpellDetail, setSelectedSpellDetail] = useState<SpellItem | null>(null);
  const [spellDetailModalVisible, setSpellDetailModalVisible] = useState(false);

  // Estados de Inventário e Kit
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [gp, setGp] = useState(0); 
  const [sp, setSp] = useState(0); 
  const [cp, setCp] = useState(0); 
  const [selectedKitName, setSelectedKitName] = useState('Nenhum Kit Selecionado');
  const [kitModalVisible, setKitModalVisible] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'race' | 'class' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ALERTA CUSTOMIZADO
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});

  const showCustomAlert = (title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string, style?: string}[]) => {
    setCustomAlert({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: 'OK', color: '#00bfff' }]
    });
  };

  // ================= CÁLCULOS TÉCNICOS =================
  const selectedClassObj = dbClasses.find(c => c.name === charClass);
  const selectedRaceObj = dbRaces.find(r => r.name === race);

  const getModifier = (statValue: string) => Math.floor(((parseInt(statValue) || 10) - 10) / 2);
  
  const constitutionMod = getModifier(stats.CON);
  const dexterityMod = getModifier(stats.DES);
  const strengthVal = parseInt(stats.FOR) || 10;
  
  const maxCarryingCapacity = strengthVal * 7.5; 
  const weightFromCoins = (gp + sp + cp) * 0.01; 
  const currentWeight = inventory.reduce((sum, item) => sum + (item.weight * item.qty), 0) + weightFromCoins;
  const isOverweight = currentWeight > maxCarryingCapacity;

  const hitDieMax = selectedClassObj?.hit_dice || 8;
  const hpMax = hitDieMax + constitutionMod;
  const armorClass = 10 + dexterityMod;
  const initiative = dexterityMod >= 0 ? `+${dexterityMod}` : `${dexterityMod}`;
  const speed = selectedRaceObj?.speed || '9m';

  const totalSteps = 7;

  let maxSkillsAllowed = 4;
  if (race === 'Meio-Elfo') maxSkillsAllowed += 2;
  if (race === 'Elfo' || race === 'Meio-Orc') maxSkillsAllowed += 1;
  if (charClass === 'Ladino') maxSkillsAllowed += 2;
  else if (charClass === 'Bardo' || charClass === 'Patrulheiro') maxSkillsAllowed += 1;

  const MAX_CANTRIPS = 3;
  const MAX_SPELLS_LVL1 = 4;

  // ================= FUNÇÕES DE APOIO =================
  const openSelectionModal = (type: 'race' | 'class') => { 
    setModalType(type); 
    setSearchQuery(''); 
    setModalVisible(true); 
  };

  const getFilteredData = () => {
    return (modalType === 'race' ? dbRaces : dbClasses).filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // ================= GERAÇÕES ALEATÓRIAS =================
  const generateRandomLore = () => {
    const archetypes = [
      {
        name: "O Malandro das Ruas",
        traits: ['Sempre encontro uma forma de rir, mesmo nas piores situações.', 'Sempre desconfio das intenções de estranhos antes de confiar.', 'Gosto de testar os limites das pessoas só para ver como reagem.', 'Tenho dificuldade em levar qualquer autoridade a sério.', 'Falo o que penso, mesmo quando deveria ficar calado.'],
        ideals: ['Liberdade. Correntes são feitas para serem quebradas.', 'Caos. A ordem excessiva sufoca a vida.', 'Comunidade. Devemos cuidar uns dos outros para sobreviver.'],
        bonds: ['Fui expulso da minha vila e um dia voltarei para provar meu valor.', 'Tenho um rival que jurei superar em tudo.', 'Estou em busca de um ente querido que desapareceu há anos.'],
        flaws: ['Tenho um vício em jogos de cartas que sempre me deixa pobre.', 'Impulsivo, ajo antes de pensar se a emoção falar mais alto.', 'Costumo mentir mesmo quando não há necessidade.', 'Não sei lidar bem com autoridade.'],
        backstory: ['Cresceu nas ruas da capital, aprendendo a sobreviver desde cedo furtando pães e frutas nas feiras.', 'Foi acusado injustamente de um crime e agora vive fugindo.'],
        allies: ['Tem uma dívida eterna com a Taverneira do "Javali Saltitante".', 'Mantém contato obscuro com o sindicato de contrabandistas do cais.', 'Tem um informante nas masmorras da cidade.', 'Possui um contato no mercado negro.'],
        features: ['Consegue dormir profundamente em qualquer lugar, mesmo no chão de pedra.', 'Sua sombra parece se mover um segundo atrasada.', 'Tem uma tolerância absurdamente alta para bebidas fortes.'],
        languages: ['Comum, Goblin e Símbolos Secretos de Ladrões.', 'Comum, Subcomum e Símbolos Secretos de Ladrões.', 'Comum, Orc e Proficiência com Cartas de Baralho.']
      },
      {
        name: "O Devoto Fanático",
        traits: ['Tudo o que faço é em nome da minha fé.', 'Vejo sinais divinos em pequenos acontecimentos.', 'Tenho dificuldade em entender quem não segue uma crença.', 'Costumo citar escrituras em momentos inadequados.'],
        ideals: ['Fé. A verdadeira força vem da devoção absoluta.', 'Sacrifício. Grandes recompensas exigem grandes renúncias.', 'Purificação. O mal deve ser erradicado pela raiz.'],
        bonds: ['Protejo um templo que foi quase destruído.', 'Minha vida pertence à divindade que me salvou.', 'Carrego uma relíquia sagrada que não pode cair em mãos erradas.'],
        flaws: ['Sou intolerante com crenças opostas.', 'Posso ir longe demais ao tentar "corrigir" alguém.', 'Confundo minha vontade com a vontade divina.'],
        backstory: ['Sobreviveu a uma tragédia que acredita ter sido intervenção divina.', 'Foi criado dentro de um templo e nunca conheceu outra vida.', 'Recebeu uma visão profética que mudou seu destino.'],
        allies: ['É respeitado por membros de sua ordem religiosa.', 'Recebe apoio discreto de um sacerdote influente.', 'Possui contato com um inquisidor da fé.'],
        features: ['Sua presença intimida hereges.', 'Sua voz ecoa com autoridade quando fala de fé.', 'Possui marcas sagradas discretas pelo corpo.'],
        languages: ['Comum, Celestial e Proficiência com Kit de Caligrafia.', 'Comum, Infernal e Proficiência com Kit de Investigação.']
      },
      {
        name: "O Alquimista Obcecado",
        traits: ['Anoto tudo em cadernos cheios de fórmulas.', 'Vejo potencial explosivo em objetos comuns.', 'Fico empolgado demais ao testar hipóteses.', 'Perco a noção do tempo quando estou pesquisando.'],
        ideals: ['Descoberta. Sempre há algo novo a ser criado.', 'Transformação. Nada é fixo; tudo pode mudar.', 'Ambição. O impossível é apenas uma questão de tentativa.'],
        bonds: ['Busco aperfeiçoar a fórmula que matou meu antigo mentor.', 'Protejo um manuscrito raro que contém conhecimento proibido.', 'Prometi curar uma doença incurável.'],
        flaws: ['Subestimo riscos de experimentos.', 'Tenho dificuldade em aceitar falhas.', 'Às vezes trato pessoas como cobaias involuntárias.'],
        backstory: ['Aprendiz de um alquimista excêntrico.', 'Expulso de uma academia por práticas perigosas.', 'Descobriu cedo talento para manipular substâncias raras.'],
        allies: ['Tem contato com um fornecedor de ingredientes exóticos.', 'Recebe cartas ocasionais de um antigo colega de estudos.', 'Conhece um médico disposto a testar novas misturas.'],
        features: ['Cheira constantemente a reagentes químicos.', 'Tem pequenas queimaduras antigas nas mãos.', 'Carrega frascos escondidos nas roupas.'],
        languages: ['Comum, Dracônico e Proficiência com Kit de Alquimia.', 'Comum, Élfico e Proficiência com Kit de Herbalismo.']
      },
      {
        name: "O Navegador Errante",
        traits: ['Sempre conto histórias do mar, mesmo quando ninguém pediu.', 'Confio mais em mapas do que em pessoas.', 'Acredito que o horizonte sempre guarda algo melhor.', 'Tenho dificuldade em ficar muito tempo no mesmo lugar.'],
        ideals: ['Liberdade. O mar não pertence a ninguém.', 'Descoberta. Sempre há novas rotas a serem traçadas.', 'Camaradagem. Uma tripulação unida sobrevive a qualquer tempestade.'],
        bonds: ['Procuro um porto lendário que poucos acreditam existir.', 'Minha antiga tripulação foi destruída por piratas.', 'Tenho um mapa incompleto que pode mudar o mundo.'],
        flaws: ['Sou supersticioso quanto a presságios marítimos.', 'Bebo demais quando estou em terra firme.', 'Não resisto a uma aposta envolvendo navegação.'],
        backstory: ['Cresceu em um navio mercante.', 'Único sobrevivente de um naufrágio misterioso.', 'Fugiu de casa para viver aventuras no mar.'],
        allies: ['Tem amizade com um capitão aposentado.', 'É bem-vindo em certos portos costeiros.', 'Mantém contato com cartógrafos independentes.'],
        features: ['Sente mudanças no vento antes que aconteçam.', 'Excelente equilíbrio mesmo em terreno instável.', 'Reconhece constelações com facilidade.'],
        languages: ['Comum, Primordial e Proficiência com Ferramentas de Navegação.', 'Comum, Aquan e Proficiência com Instrumentos de Corda.']
      },
      {
        name: "O Assassino Calculista",
        traits: ['Raramente demonstro emoções.', 'Observo padrões de comportamento antes de agir.', 'Prefiro resolver problemas de forma silenciosa.', 'Nunca faço ameaças vazias.'],
        ideals: ['Eficiência. O método mais limpo é sempre o melhor.', 'Contrato. Um acordo selado deve ser cumprido.', 'Equilíbrio. Às vezes a morte é necessária.'],
        bonds: ['Tenho uma dívida com o mestre que me treinou.', 'Busco vingança contra quem traiu minha antiga guilda.', 'Protejo alguém que não sabe o que faço para mantê-lo seguro.'],
        flaws: ['Tenho dificuldade em confiar em aliados.', 'Subestimo emoções como fator de risco.', 'Vejo pessoas como peças em um tabuleiro.'],
        backstory: ['Treinado desde jovem por uma guilda clandestina.', 'Foi traído por seu contratante e quase morreu.', 'Antigo espião que decidiu trabalhar por conta própria.'],
        allies: ['Tem contato com um informante no submundo.', 'Possui acesso a um falsificador talentoso.', 'É conhecido por um pequeno círculo de mercadores corruptos.'],
        features: ['Passos quase inaudíveis.', 'Nunca esquece a rotina de um alvo.', 'Mantém lâminas escondidas em locais improváveis.'],
        languages: ['Comum, Subcomum e Símbolos Secretos de Ladrões.', 'Comum, Élfico e Proficiência com Kit de Disfarce.']
      },
      {
        name: "O Combatente Disciplinado",
        traits: ['Não tenho tempo para brincadeiras, sou focado no objetivo.', 'Não confio em sorte, apenas em preparação.', 'Prefiro observar em silêncio antes de agir.'],
        ideals: ['Honra. Se eu der minha palavra, eu a cumprirei custe o que custar.', 'Justiça. Os culpados sempre devem pagar.', 'Proteção. Os fracos devem ser defendidos.'],
        bonds: ['Luto para proteger aqueles que não podem se proteger sozinhos.', 'Minha honra está ligada ao nome da minha família.', 'Devo minha vida a um aventureiro que me salvou da morte certa.'],
        flaws: ['Guardo rancor por tempo demais.', 'Sou incapaz de recusar um desafio.', 'Tenho um temperamento explosivo que me mete em confusão.', 'Tenho dificuldade em admitir quando estou errado.'],
        backstory: ['Antigo guarda da cidade que se cansou da corrupção dos nobres, jogou o distintivo fora e pegou a estrada.', 'Serviu no exército durante uma guerra esquecida.', 'Sobrevivente de um ataque de saqueadores; jurou que nunca mais seria fraco diante do perigo.'],
        allies: ['É respeitado por um pequeno clã de mercenários.', 'Tem amizade com um capitão da guarda.', 'Tem um velho companheiro de guerra sempre disposto a ajudar.'],
        features: ['Nunca adoece facilmente.', 'Tem memória fotográfica para mapas.', 'Nunca esquece um rosto ou uma voz que tenha ouvido mais de uma vez.'],
        languages: ['Comum, Gigante e Proficiência com Ferramentas de Pedreiro.', 'Comum, Anão e Proficiência com Ferramentas de Carpinteiro.', 'Comum, Anão e Proficiência com Ferramentas de Ferreiro.']
      },
      {
        name: "O Estudioso Místico",
        traits: ['Fico fascinado com qualquer pedaço de magia antiga ou bugigangas.', 'Tenho curiosidade demais para meu próprio bem.', 'Sempre tento mediar conflitos antes que virem violência.'],
        ideals: ['Conhecimento. A verdade está acima de qualquer poder.', 'Destino. Meu caminho já foi traçado pelos deuses.', 'Equilíbrio. Luz e trevas precisam coexistir.', 'Redenção. Todos merecem uma segunda chance.'],
        bonds: ['Protejo um segredo que poderia iniciar uma guerra.', 'Devo lealdade a uma ordem que já nem existe mais.', 'Fui salvo por uma divindade e sinto que devo algo em troca.'],
        flaws: ['Confio rápido demais em promessas bonitas.', 'Subestimo inimigos que parecem fracos.', 'Fico paranoico quando sinto que estão me observando.', 'Tenho pavor de criaturas que rastejam ou voam no escuro.'],
        backstory: ['Um estudioso de biblioteca que percebeu que a vida lendo livros é muito chata em comparação com vivê-la.', 'Treinado arduamente em um mosteiro isolado nas montanhas, desceu ao vale para ver como é o mundo real.', 'Foi aprendiz de um mago excêntrico que desapareceu sem deixar pistas.', 'Escapou de um culto sombrio que ainda pode estar à sua procura.'],
        allies: ['Recebe favores ocasionais de um sacerdote local.', 'É protegido por uma entidade misteriosa.', 'É membro secreto de uma sociedade arcana.', 'Possui um mentor ancião que envia cartas misteriosas de vez em quando.'],
        features: ['Possui uma cicatriz no rosto que parece formigar perto de magia.', 'Tem mãos sempre frias, mesmo no calor.', 'Seus olhos mudam levemente de cor quando está irritado.'],
        languages: ['Comum, Celestial e Proficiência com Kit de Herbalismo.', 'Comum, Abissal e Proficiência com Kit de Veneno.', 'Comum, Élfico.', 'Comum, Infernal e Proficiência com Kit de Disfarce.']
      },
      {
        name: "O Nobre Vaidoso",
        traits: ['Acredito que o dinheiro resolve qualquer problema.', 'Sou excessivamente educado, até com meus inimigos.', 'Adoro contar histórias exageradas sobre minhas façanhas.'],
        ideals: ['Poder. Eu farei o que for preciso para me tornar o mais forte.', 'Glória. Quero que meu nome seja lembrado por gerações.', 'Tradição. As antigas formas existem por um motivo.'],
        bonds: ['Guardo um mapa incompleto para um tesouro lendário.', 'Prometi destruir a criatura que arruinou minha cidade natal.', 'Carrego comigo um medalhão que pertenceu à minha mãe.'],
        flaws: ['Acho que sou superior a todos que não têm educação ou berço.', 'Sou obcecado por riqueza e conforto.', 'Tenho medo de falhar na frente dos outros.'],
        backstory: ['Filho de camponeses tranquilos, encontrou um artefato enferrujado no campo que despertou seu desejo por aventura.', 'Descobriu recentemente que tem sangue nobre.'],
        allies: ['Membro honorário da Guilda dos Aventureiros Locais.', 'Tem amizade com um capitão da guarda.'],
        features: ['Risada inconfundível e ecoa alto demais.', 'Tem um sotaque marcante de uma região distante.'],
        languages: ['Comum, Dracônico e Proficiência com Instrumentos de Sopro.', 'Comum, Élfico e Proficiência com Kit de Alquimia.']
      },
      {
        name: "O Forasteiro Selvagem",
        traits: ['Sou supersticioso e levo presságios muito a sério.', 'Sempre desconfio das intenções de estranhos antes de confiar.', 'Prefiro observar em silêncio antes de agir.'],
        ideals: ['Exploração. O mundo precisa ter seus cantos descobertos.', 'Autossuficiência. Só posso depender de mim mesmo.', 'Equilíbrio. Luz e trevas precisam coexistir.'],
        bonds: ['Devo minha vida a um aventureiro que me salvou da morte certa.', 'Luto para proteger aqueles que não podem se proteger sozinhos.'],
        flaws: ['Sou viciado em viver a vida.', 'Impulsivo, ajo antes de pensar se a emoção falar mais alto.', 'Tenho pavor de criaturas que rastejam ou voam no escuro.'],
        backstory: ['Sobreviveu sozinho na natureza por anos após se perder.', 'Criado por uma criatura feérica na floresta.', 'Cresceu em um navio mercante e conhece bem os perigos do mar.'],
        allies: ['Nenhum, prefere trabalhar sozinho e confia apenas na própria sombra.'],
        features: ['Tem um senso de direção perfeito; sempre sabe onde fica o norte.', 'Consegue imitar perfeitamente o som de pequenos animais e pássaros.', 'Sente cheiro de chuva antes de tempestades.', 'Animais parecem confiar nele com facilidade.'],
        languages: ['Comum, Silvestre e Proficiência com Instrumentos de Corda.', 'Comum, Primordial e Proficiência com Ferramentas de Navegação.']
      }
    ];

    const chosenArchetype = archetypes[Math.floor(Math.random() * archetypes.length)];

    setPersonalityTraits(chosenArchetype.traits[Math.floor(Math.random() * chosenArchetype.traits.length)]);
    setIdeals(chosenArchetype.ideals[Math.floor(Math.random() * chosenArchetype.ideals.length)]);
    setBonds(chosenArchetype.bonds[Math.floor(Math.random() * chosenArchetype.bonds.length)]);
    setFlaws(chosenArchetype.flaws[Math.floor(Math.random() * chosenArchetype.flaws.length)]);
    
    let generatedBackstory = chosenArchetype.backstory[Math.floor(Math.random() * chosenArchetype.backstory.length)];
    if (charClass && !charClass.includes('Selecione')) {
        generatedBackstory += ` Acabou se tornando um ${charClass} devido às dificuldades que enfrentou no caminho.`;
    }
    setBackstory(generatedBackstory);
    
    setAlliesOrganizations(chosenArchetype.allies[Math.floor(Math.random() * chosenArchetype.allies.length)]);
    setFeaturesTraits(chosenArchetype.features[Math.floor(Math.random() * chosenArchetype.features.length)]);
    setLanguages(chosenArchetype.languages[Math.floor(Math.random() * chosenArchetype.languages.length)]);
  };

  const handleRandomizeClick = () => {
    // Verifica se já existe algo preenchido pelo usuário
    const isDirty = name.trim() !== '' || race !== 'Selecione uma raça' || charClass !== 'Selecione uma classe';

    // Se estiver limpo, gera direto sem perguntar
    if (!isDirty) {
      generateRandomCharacter();
      return;
    }

    // Se estiver sujo, pergunta o que o jogador quer fazer baseado no passo atual
    if (step === 3 || step === 4) {
      showCustomAlert(
        "Gerador Inteligente",
        "Você está na aba de História.\nDeseja gerar APENAS a personalidade e o histórico, mantendo os seus status, raça e classe atuais?",
        [
          { text: "Cancelar", color: "#666" },
          { 
            text: "Gerar Tudo", 
            color: "#ff6666",
            style: "destructive",
            onPress: () => {
              setTimeout(() => {
                showCustomAlert("Atenção", "Isso apagará todas as suas escolhas atuais. Deseja continuar?", [
                  { text: "Não", color: "#666" },
                  { text: "Sim, gerar do zero", color: "#ff6666", style: "destructive", onPress: generateRandomCharacter }
                ]);
              }, 400);
            } 
          },
          { 
            text: "Apenas História", 
            color: "#00fa9a",
            onPress: generateRandomLore 
          }
        ]
      );
    } else {
      showCustomAlert(
        "Novo Personagem Aleatório",
        "Isso substituirá as informações que você já preencheu. Deseja continuar?",
        [
          { text: "Cancelar", color: "#666" },
          { text: "Sim, sortear", color: "#ff6666", style: "destructive", onPress: generateRandomCharacter }
        ]
      );
    }
  };

  const generateRandomCharacter = async () => {
    if (dbRaces.length === 0 || dbClasses.length === 0) {
       showCustomAlert("Aguarde", "Carregando o banco de dados...");
       return;
    }

    isRandomizing.current = true;
    
    const randRace = dbRaces[Math.floor(Math.random() * dbRaces.length)];
    const randClass = dbClasses[Math.floor(Math.random() * dbClasses.length)];
    setRace(randRace.name);
    setCharClass(randClass.name);

    const maleNames = ['Bruno', 'João', 'Pedro', 'Carlos', 'Tiago', 'Rafael', 'Kaelen', 'Thorin', 'Silas', 'Bram', 'Dorian', 'Faelan', 'Gael', 'Orion', 'Beren', 'Nícolas', 'Zoltan', 'Vagner', 'Rurik', 'Luiz', 'Gustavo', 'Leonardo', 'Matheus', 'Felipe', 'Wilker', 'Dante', 'Vítor', 'Enzo', 'Ramon'];
    const femaleNames = ['Karoline', 'Maria', 'Ana', 'Beatriz', 'Mariana', 'Amanda', 'Lyra', 'Elara', 'Ilyana', 'Ayla', 'Morgana', 'Bianca', 'Catarine', 'Fernanda', 'Isabela', 'Sofia', 'Camila', 'Larissa', 'Yanaele', 'Evelyn', 'Alícia', 'Lívia', 'Giovanna', 'Carla', 'Júlia'];

    const isMale = Math.random() > 0.5;
    const randomFirstName = isMale 
      ? maleNames[Math.floor(Math.random() * maleNames.length)] 
      : femaleNames[Math.floor(Math.random() * femaleNames.length)];

    const classTitles: Record<string, string[]> = {
      'Bárbaro': isMale ? ['o Bárbaro', 'o Implacável', 'o Feroz', 'o Quebra-Crânios'] : ['a Bárbara', 'a Implacável', 'a Feroz', 'a Quebra-Crânios'],
      'Bardo': isMale ? ['o Bardo', 'o Cancioneiro', 'o Galante', 'Voz-de-Ouro'] : ['a Barda', 'a Cancioneira', 'a Galante', 'Voz-de-Ouro'],
      'Bruxo': isMale ? ['o Bruxo', 'o Amaldiçoado', 'o Ocultista', 'Corta-Sombras'] : ['a Bruxa', 'a Amaldiçoada', 'a Ocultista', 'Corta-Sombras'],
      'Clérigo': isMale ? ['o Clérigo', 'o Devoto', 'o Curandeiro', 'Luz-Divina'] : ['a Clériga', 'a Devota', 'a Curandeira', 'Luz-Divina'],
      'Druida': isMale ? ['o Druida', 'o Selvagem', 'Fala-com-Feras', 'da Floresta'] : ['a Druida', 'a Selvagem', 'Fala-com-Feras', 'da Floresta'],
      'Feiticeiro': isMale ? ['o Feiticeiro', 'o Nato', 'Sangue-Mágico', 'o Canalizador'] : ['a Feiticeira', 'a Nata', 'Sangue-Mágico', 'a Canalizadora'],
      'Guerreiro': isMale ? ['o Guerreiro', 'o Veterano', 'Braço-de-Ferro', 'o Colosso'] : ['a Guerreira', 'a Veterana', 'Braço-de-Ferro', 'a Colosso'],
      'Ladino': isMale ? ['o Ladino', 'Pé-Ligeiro', 'Mão-Leve', 'o Vigarista', 'das Sombras'] : ['a Ladina', 'Pé-Ligeiro', 'Mão-Leve', 'a Vigarista', 'das Sombras'],
      'Mago': isMale ? ['o Mago', 'o Sábio', 'o Estudioso', 'Tomo-Vivo'] : ['a Maga', 'a Sábia', 'a Estudiosa', 'Tomo-Vivo'],
      'Monge': isMale ? ['o Monge', 'Punho-de-Aço', 'o Calmo', 'Passo-Leve'] : ['a Monge', 'Punho-de-Aço', 'a Calma', 'Passo-Leve'],
      'Paladino': isMale ? ['o Paladino', 'o Justo', 'o Cruzado', 'Escudo-Radiante'] : ['a Paladina', 'a Justa', 'a Cruzada', 'Escudo-Radiante'],
      'Patrulheiro': isMale ? ['o Patrulheiro', 'o Caçador', 'Olho-de-Águia', 'o Errante'] : ['a Patrulheira', 'a Caçadora', 'Olho-de-Águia', 'a Errante'],
    };

    const genericTitles = isMale 
      ? ['de Tal', 'Sem-Teto', 'da Taberna', 'o Azarado', 'o Magnífico'] 
      : ['de Tal', 'Sem-Teto', 'da Taberna', 'a Azarada', 'a Magnífica'];

    const validTitles = [...(classTitles[randClass.name] || []), ...genericTitles];
    const randomTitle = validTitles[Math.floor(Math.random() * validTitles.length)];

    setName(`${randomFirstName} ${randomTitle}`);

    const baseStats = JSON.parse(randClass.recommended_stats || '{}');
    const bonuses = JSON.parse(randRace.stat_bonuses || '{}') as Record<string, number>;
    const totalBonus = Object.values(bonuses).reduce((acc, val) => acc + (val || 0), 0);
    setMaxStatsSum(72 + totalBonus);
    setStats({
      FOR: String((baseStats.FOR || 10) + (bonuses.FOR || 0)),
      DES: String((baseStats.DES || 10) + (bonuses.DES || 0)),
      CON: String((baseStats.CON || 10) + (bonuses.CON || 0)),
      INT: String((baseStats.INT || 10) + (bonuses.INT || 0)),
      SAB: String((baseStats.SAB || 10) + (bonuses.SAB || 0)),
      CAR: String((baseStats.CAR || 10) + (bonuses.CAR || 0)),
    });
    setGp(randClass.starting_gold || 0);

    let calcSkills = 4;
    if (randRace.name === 'Meio-Elfo') calcSkills += 2;
    if (randRace.name === 'Elfo' || randRace.name === 'Meio-Orc') calcSkills += 1;
    if (randClass.name === 'Ladino') calcSkills += 2;
    else if (randClass.name === 'Bardo' || randClass.name === 'Patrulheiro') calcSkills += 1;
    
    const classSaves = JSON.parse(randClass.saves || '[]');
    const shuffledSkills = [...dbSkills].sort(() => 0.5 - Math.random());
    const randomSkills = shuffledSkills.slice(0, calcSkills).map(s => s.id);
    setProficiencies([...classSaves, ...randomSkills]);

    const kits = await db.getAllAsync<StartingKit>(`SELECT * FROM starting_kits WHERE target_name = ?`, [randClass.name]);
    if (kits.length > 0) {
      const randKit = kits[Math.floor(Math.random() * kits.length)];
      setSelectedKitName(randKit.name);
      try {
        const parsedItems = JSON.parse(randKit.items);
        const builtInventory = parsedItems.map((eq: any) => {
          const catalogItem = dbItems.find(i => i.name === eq.name);
          return { name: eq.name, qty: eq.qty, weight: catalogItem ? catalogItem.weight : 0 };
        });
        setInventory(builtInventory);
      } catch(e) {}
    } else {
      setInventory([]);
      setSelectedKitName('Nenhum kit disponível');
    }

    const spells = await db.getAllAsync<SpellItem>(`SELECT * FROM spells WHERE classes LIKE ? AND level IN ('Truque', 'Nível 1', 'Classe')`, [`%${randClass.name}%`]);
    const classFeatures = spells.filter(s => s.level === 'Classe').map(s => s.id.toString());
    
    if (randClass.is_caster === 1) {
      const cantrips = spells.filter(s => s.level === 'Truque').sort(() => 0.5 - Math.random()).slice(0, MAX_CANTRIPS).map(s => s.id.toString());
      const level1 = spells.filter(s => s.level === 'Nível 1').sort(() => 0.5 - Math.random()).slice(0, MAX_SPELLS_LVL1).map(s => s.id.toString());
      setSelectedSpells([...classFeatures, ...cantrips, ...level1]);
    } else {
      setSelectedSpells([...classFeatures]);
    }

    generateRandomLore();

    setStep(7); 

    setTimeout(() => {
      isRandomizing.current = false;
    }, 500);
  };

  // ================= EFEITOS =================
  useEffect(() => {
    async function loadCatalog() {
      try {
        setDbRaces(await db.getAllAsync('SELECT * FROM races ORDER BY name'));
        setDbClasses(await db.getAllAsync('SELECT * FROM classes ORDER BY name'));
        setDbSavingThrows(await db.getAllAsync('SELECT * FROM saving_throws'));
        setDbSkills(await db.getAllAsync('SELECT * FROM skills ORDER BY name'));
        setDbItems(await db.getAllAsync('SELECT * FROM items ORDER BY name'));
      } catch (error) { console.error("Erro ao carregar catálogos:", error); }
    }
    loadCatalog();
  }, []);

  useEffect(() => {
    if (isRandomizing.current) return; 

    if (race !== 'Selecione uma raça' && charClass !== 'Selecione uma classe') {
      const selectedRace = dbRaces.find(r => r.name === race);
      const selectedClass = dbClasses.find(c => c.name === charClass);

      if (selectedRace && selectedClass) {
        try {
          const baseStats = JSON.parse(selectedClass.recommended_stats || '{}');
          const bonuses = JSON.parse(selectedRace.stat_bonuses || '{}') as Record<string, number>;
          const totalBonus = Object.values(bonuses).reduce((acc, val) => acc + (val || 0), 0);
          setMaxStatsSum(72 + totalBonus);

          setStats({
            FOR: String((baseStats.FOR || 10) + (bonuses.FOR || 0)),
            DES: String((baseStats.DES || 10) + (bonuses.DES || 0)),
            CON: String((baseStats.CON || 10) + (bonuses.CON || 0)),
            INT: String((baseStats.INT || 10) + (bonuses.INT || 0)),
            SAB: String((baseStats.SAB || 10) + (bonuses.SAB || 0)),
            CAR: String((baseStats.CAR || 10) + (bonuses.CAR || 0)),
          });
          
          setGp(selectedClass.starting_gold || 0);
          
          const classProfs = JSON.parse(selectedClass.saves || '[]');
          setProficiencies(prev => {
            const semSavesAntigos = prev.filter(p => !p.startsWith('save_'));
            return [...semSavesAntigos, ...classProfs];
          });
        } catch (error) {}
      }
    }
  }, [race, charClass, dbRaces, dbClasses]);

  useEffect(() => {
    async function fetchKits() {
      if (charClass === 'Selecione uma classe') return;
      try {
        const kits = await db.getAllAsync<StartingKit>(
          `SELECT * FROM starting_kits WHERE target_name = ?`, 
          [charClass]
        );
        setDbKits(kits);
        
        if (isRandomizing.current) return; 

        if (kits.length > 0) {
           handleSelectKit(kits[0]);
        } else {
           setInventory([]);
           setSelectedKitName('Nenhum kit disponível');
        }
      } catch (error) { console.error(error); }
    }
    fetchKits();
  }, [charClass, dbItems]);

  useEffect(() => {
    if (dbSavingThrows.length === 0 || dbSkills.length === 0) return;
    const bnsProf = parseInt(profBonus) || 0;
    const newSaves: Record<string, string> = {};
    dbSavingThrows.forEach(save => {
      const score = parseInt(stats[save.stat as keyof typeof stats]) || 10;
      let mod = Math.floor((score - 10) / 2);
      if (proficiencies.includes(save.id)) mod += bnsProf;
      newSaves[save.id] = mod >= 0 ? `+${mod}` : `${mod}`;
    });
    setSaveValues(newSaves);

    const newSkills: Record<string, string> = {};
    dbSkills.forEach(skill => {
      const score = parseInt(stats[skill.stat as keyof typeof stats]) || 10;
      let mod = Math.floor((score - 10) / 2);
      if (proficiencies.includes(skill.id)) mod += bnsProf;
      newSkills[skill.id] = mod >= 0 ? `+${mod}` : `${mod}`;
    });
    setSkillValues(newSkills);
  }, [stats, proficiencies, profBonus, dbSavingThrows, dbSkills]);

  useEffect(() => {
    async function loadSpells() {
      if (charClass === 'Selecione uma classe') return;
      try {
        const result = await db.getAllAsync<SpellItem>(
          `SELECT * FROM spells WHERE classes LIKE ? AND level IN ('Truque', 'Nível 1', 'Classe', 'Manobra') ORDER BY level ASC, name ASC`,
          [`%${charClass}%`]
        );
        
        setAvailableSpells(result);
        
        if (!isRandomizing.current) {
           const classFeatures = result.filter(s => s.level === 'Classe').map(s => s.id.toString());
           setSelectedSpells(prev => Array.from(new Set([...prev, ...classFeatures])));
        }
        
      } catch (error) {}
    }
    loadSpells();
  }, [charClass]);

  // ================= FUNÇÕES DE INTERAÇÃO =================
  
  const handleSelectKit = (kit: StartingKit) => {
    try {
      const parsedItems = JSON.parse(kit.items);
      const builtInventory = parsedItems.map((eq: any) => {
        const catalogItem = dbItems.find(i => i.name === eq.name);
        return { name: eq.name, qty: eq.qty, weight: catalogItem ? catalogItem.weight : 0 };
      });
      setInventory(builtInventory);
      setSelectedKitName(kit.name);
    } catch (error) { 
      showCustomAlert("Erro", "Falha ao ler o kit."); 
    }
    setKitModalVisible(false);
  };

  const updateStat = (key: keyof typeof stats, value: string) => {
    let numStr = value.replace(/[^0-9]/g, '');
    if (numStr === '') { setStats(prev => ({ ...prev, [key]: '' })); return; }
    let num = parseInt(numStr);
    if (num > 20) num = 20;
    const sum = Object.keys(stats).reduce((acc, k) => k === key ? acc : acc + (parseInt(stats[k as keyof typeof stats]) || 0), 0);
    if (sum + num > maxStatsSum) num = maxStatsSum - sum;
    setStats(prev => ({ ...prev, [key]: String(num) }));
  };

  const toggleProficiency = (id: string) => {
    if (id.startsWith('skill_') && !proficiencies.includes(id)) {
      const currentSkills = proficiencies.filter(p => p.startsWith('skill_')).length;
      if (currentSkills >= maxSkillsAllowed) {
        showCustomAlert("Limite de Perícias", `Sua combinação de Raça e Classe permite no máximo ${maxSkillsAllowed} perícias.`); return;
      }
    }
    setProficiencies(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const toggleSpell = (id: string) => {
    const spell = availableSpells.find(s => s.id.toString() === id);
    if (!spell) return;
    
    if (spell.level === 'Classe') {
       showCustomAlert("Habilidade da Classe", "Esta habilidade pertence ao Nível 1 da sua classe e não pode ser removida.");
       return;
    }
    
    const isSelecting = !selectedSpells.includes(id);
    if (isSelecting) {
      const cantripsCount = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length;
      const level1Count = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Nível 1').length;
      
      if (spell.level === 'Truque' && cantripsCount >= MAX_CANTRIPS) { showCustomAlert("Limite de Truques", `A classe permite no máximo ${MAX_CANTRIPS} Truques no Nível 1.`); return; }
      if (spell.level === 'Nível 1' && level1Count >= MAX_SPELLS_LVL1) { showCustomAlert("Limite de Magias", `A classe permite no máximo ${MAX_SPELLS_LVL1} magias de Nível 1.`); return; }
    }
    setSelectedSpells(prev => isSelecting ? [...prev, id] : prev.filter(item => item !== id));
  };

  const updateInventoryQty = (index: number, delta: number) => {
    setInventory(prev => {
      const newInv = [...prev];
      newInv[index].qty += delta;
      if (newInv[index].qty < 0) newInv[index].qty = 0;
      return newInv;
    });
  };

  const handleSave = async () => {
    if (!name || race.includes('Selecione') || charClass.includes('Selecione')) {
      showCustomAlert("Atenção", "Preencha o Nome, Raça e Classe no Passo 1."); return;
    }
    const cleanInventory = inventory.filter(item => item.qty > 0);
    const activeSavesToSave = proficiencies.filter(p => p.startsWith('save_'));
    const activeSkillsToSave = proficiencies.filter(p => p.startsWith('skill_'));

    try {
      await db.runAsync(
        `INSERT INTO characters (
          name, race, class, stats, prof_bonus, inspiration, proficiencies, 
          save_values, skill_values, personality_traits, ideals, bonds, flaws, 
          features_traits, backstory, allies_organizations, languages,
          spells, equipment, gp, sp, cp,
          hp_max, hp_current, level, xp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, race, charClass, JSON.stringify(stats), profBonus, inspiration || '0', 
          JSON.stringify(proficiencies), JSON.stringify(activeSavesToSave), JSON.stringify(activeSkillsToSave), 
          personalityTraits, ideals, bonds, flaws, featuresTraits, backstory, alliesOrganizations, languages, 
          JSON.stringify(selectedSpells), JSON.stringify(cleanInventory), gp, sp, cp, hpMax, hpMax, 1, 0 
        ]
      );
      router.back();
    } catch (error) { console.error("Erro ao inserir:", error); }
  };

  // ================= RENDERIZAÇÕES =================

  const renderKitModal = () => (
    <Modal visible={kitModalVisible} animationType="slide" transparent={true}>
      <Pressable style={styles.modalOverlay} onPress={() => setKitModalVisible(false)}>
        <View style={[styles.modalContent, {maxHeight: '80%'}]}>
          <Text style={styles.modalTitle}>Kits da Classe: {charClass}</Text>
          <FlatList
            data={dbKits}
            keyExtractor={item => item.id.toString()}
            renderItem={({item}) => {
              const itemsList = JSON.parse(item.items).map((i: any) => `${i.qty}x ${i.name}`).join(', ');
              return (
                <TouchableOpacity style={styles.kitCard} onPress={() => handleSelectKit(item)}>
                  <Text style={styles.kitCardTitle}>{item.name}</Text>
                  <Text style={styles.kitCardItems}>{itemsList}</Text>
                  {item.criador !== 'base' && <Text style={styles.customKitBadge}>Customizado</Text>}
                </TouchableOpacity>
              )
            }}
            ListEmptyComponent={<Text style={styles.emptyText}>Nenhum kit encontrado.</Text>}
          />
        </View>
      </Pressable>
    </Modal>
  );

  const renderSpellDetailModal = () => (
    <Modal visible={spellDetailModalVisible} animationType="fade" transparent={true}>
      <Pressable style={styles.modalOverlay} onPress={() => setSpellDetailModalVisible(false)}>
        <View style={styles.spellDetailCard}>
          <Text style={styles.spellDetailName}>{selectedSpellDetail?.name}</Text>
          <Text style={styles.spellDetailLevel}>{selectedSpellDetail?.level} • {selectedSpellDetail?.classes}</Text>
          
          <View style={styles.spellDetailInfoGrid}>
            <View style={styles.spellDetailInfoItem}>
              <Text style={styles.spellDetailInfoLabel}>ATIVAÇÃO</Text>
              <Text style={styles.spellDetailInfoValue}>{selectedSpellDetail?.casting_time}</Text>
            </View>
            <View style={styles.spellDetailInfoItem}>
              <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
              <Text style={styles.spellDetailInfoValue}>{selectedSpellDetail?.range}</Text>
            </View>
          </View>

          <Text style={styles.spellDetailInfoLabel}>DANO / EFEITO</Text>
          <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', marginBottom: 15}]}>{selectedSpellDetail?.damage || '-'}</Text>

          <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
          <ScrollView style={{maxHeight: 200}}>
            <Text style={styles.spellDetailDescription}>{selectedSpellDetail?.description}</Text>
          </ScrollView>

          <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSpellDetailModalVisible(false)}>
            <Text style={styles.modalCloseText}>FECHAR</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  const renderSearchModal = () => (
    <Modal visible={modalVisible} animationType="slide" transparent={true}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Selecione {modalType === 'race' ? 'a Raça' : 'a Classe'}</Text>
          <TextInput style={styles.searchInput} placeholder="Buscar..." placeholderTextColor="rgba(255,255,255,0.4)" value={searchQuery} onChangeText={setSearchQuery} autoFocus />
          <FlatList
            data={getFilteredData()}
            keyExtractor={(item) => item.id.toString()}
            style={{ width: '100%', maxHeight: 300 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.modalListItem} onPress={() => { modalType === 'race' ? setRace(item.name) : setCharClass(item.name); setModalVisible(false); }}>
                <Text style={styles.modalListItemText}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={styles.modalCloseButton} onPress={() => setModalVisible(false)}><Text style={styles.modalCloseText}>CANCELAR</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderStep1 = () => {
    const totalStats = Object.values(stats).reduce((acc, val) => acc + (parseInt(val) || 0), 0);
    return (
      <View style={styles.stepContainer}>
        <View style={styles.formGroup}><Text style={styles.label}>NOME DO PERSONAGEM</Text><TextInput style={styles.input} placeholder="Ex: Kaelen" placeholderTextColor="rgba(255, 255, 255, 0.3)" value={name} onChangeText={setName} /></View>
        <View style={styles.formGroup}><Text style={styles.label}>RAÇA</Text><TouchableOpacity style={styles.selectButton} onPress={() => openSelectionModal('race')}><Text style={[styles.selectButtonText, race.includes('Selecione') && {color:'rgba(255,255,255,0.3)'}]}>{race}</Text><Text style={styles.selectIcon}>▼</Text></TouchableOpacity></View>
        <View style={styles.formGroup}><Text style={styles.label}>CLASSE</Text><TouchableOpacity style={styles.selectButton} onPress={() => openSelectionModal('class')}><Text style={[styles.selectButtonText, charClass.includes('Selecione') && {color:'rgba(255,255,255,0.3)'}]}>{charClass}</Text><Text style={styles.selectIcon}>▼</Text></TouchableOpacity></View>
        <View style={styles.statsSection}>
          <View style={styles.statsHeader}><Text style={styles.sectionTitle}>ATRIBUTOS BÁSICOS</Text><Text style={styles.counterText}>SOMA: {totalStats}/{maxStatsSum}</Text></View>
          <View style={styles.statsGrid}>{Object.keys(stats).map((key) => <View key={key} style={styles.statBox}><Text style={styles.statLabel}>{key}</Text><TextInput style={styles.statInput} keyboardType="numeric" maxLength={2} value={stats[key as keyof typeof stats]} onChangeText={(val) => updateStat(key as keyof typeof stats, val)} /></View>)}</View>
        </View>
      </View>
    );
  };

  const renderStep2 = () => {
    const currentSkills = proficiencies.filter(p => p.startsWith('skill_')).length;
    return (
      <View style={styles.step2Container}>
        <View style={styles.row}>
          <View style={[styles.profBonusHeader, { flex: 1, marginRight: 8 }]}><Text style={[styles.profBonusTitle, {fontSize:12}]}>PROFICIÊNCIA</Text><TextInput style={styles.profBonusInput} value={profBonus} editable={false} /></View>
          <View style={[styles.profBonusHeader, { flex: 1, marginLeft: 8 }]}><Text style={[styles.profBonusTitle, {fontSize:12}]}>INSPIRAÇÃO</Text><TextInput style={styles.profBonusInput} value={inspiration} onChangeText={setInspiration} placeholder="0" placeholderTextColor="rgba(255,255,255,0.3)"/></View>
        </View>
        <Text style={styles.listTitle}>TESTES DE RESISTÊNCIA</Text>
        <View style={styles.skillsCard}>
          {dbSavingThrows.map(s => <View key={s.id} style={styles.skillRow}><TouchableOpacity style={[styles.radioCircle, proficiencies.includes(s.id) && styles.radioCircleSelected]} onPress={() => showCustomAlert("Regra", "Definidos pela Classe.")}>{proficiencies.includes(s.id) && <View style={styles.radioDot} />}</TouchableOpacity><TextInput style={styles.skillInputCalculated} value={saveValues[s.id] || '+0'} editable={false} /><Text style={styles.skillName}>{s.name} <Text style={styles.statHint}>({s.stat})</Text></Text></View>)}
        </View>
        <View style={styles.statsHeader}><Text style={styles.listTitle}>PERÍCIAS</Text><Text style={styles.counterText}>Marcadas: {currentSkills}/{maxSkillsAllowed}</Text></View>
        <View style={styles.skillsCard}>
          {dbSkills.map(s => <View key={s.id} style={styles.skillRow}><TouchableOpacity style={[styles.radioCircle, proficiencies.includes(s.id) && styles.radioCircleSelected]} onPress={() => toggleProficiency(s.id)}>{proficiencies.includes(s.id) && <View style={styles.radioDot} />}</TouchableOpacity><TextInput style={styles.skillInputCalculated} value={skillValues[s.id] || '+0'} editable={false} /><Text style={styles.skillName}>{s.name} <Text style={styles.statHint}>({s.stat})</Text></Text></View>)}
        </View>
      </View>
    );
  };

  const renderStep3 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.listTitle, { marginBottom: 20 }]}>PERSONALIDADE E VÍNCULOS</Text>
      <View style={styles.formGroup}><Text style={styles.label}>TRAÇOS DE PERSONALIDADE</Text><TextInput style={styles.textArea} multiline numberOfLines={3} value={personalityTraits} onChangeText={setPersonalityTraits} placeholder="Descreva seus traços..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>IDEAIS</Text><TextInput style={styles.textArea} multiline numberOfLines={3} value={ideals} onChangeText={setIdeals} placeholder="O que move o seu personagem?" placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>LIGAÇÕES</Text><TextInput style={styles.textArea} multiline numberOfLines={3} value={bonds} onChangeText={setBonds} placeholder="Pessoas, lugares..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>DEFEITOS</Text><TextInput style={styles.textArea} multiline numberOfLines={3} value={flaws} onChangeText={setFlaws} placeholder="Seus medos e fraquezas..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.listTitle, { marginBottom: 20 }]}>HISTÓRICO E DETALHES (OPCIONAL)</Text>
      <View style={styles.formGroup}><Text style={styles.label}>HISTÓRIA DO PERSONAGEM</Text><TextInput style={[styles.textArea, { minHeight: 120 }]} multiline value={backstory} onChangeText={setBackstory} placeholder="De onde você veio? Como adquiriu suas habilidades?" placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>ALIADOS E ORGANIZAÇÕES</Text><TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={alliesOrganizations} onChangeText={setAlliesOrganizations} placeholder="Guildas, facções, deuses..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>CARACTERÍSTICAS E HABILIDADES EXTRAS</Text><TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={featuresTraits} onChangeText={setFeaturesTraits} placeholder="Visão no escuro, resistência anã, talentos..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>IDIOMAS E OUTRAS PROFICIÊNCIAS</Text><TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={languages} onChangeText={setLanguages} placeholder="Comum, Élfico, Ferramentas de ferreiro..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/></View>
    </View>
  );

  const renderStepSpells = () => {
    const filteredSpells = availableSpells.filter(spell => spell.name.toLowerCase().includes(spellSearch.toLowerCase()));
    
    const isCasterClass = selectedClassObj?.is_caster === 1;
    const cantripsCount = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length;
    const level1Count = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Nível 1').length;

    return (
      <View style={styles.stepContainer}>
        <View style={styles.statsHeader}>
          <Text style={styles.listTitle}>MAGIAS & HABILIDADES</Text>
          {isCasterClass && <Text style={styles.counterText}>T: {cantripsCount}/{MAX_CANTRIPS} • N1: {level1Count}/{MAX_SPELLS_LVL1}</Text>}
        </View>
        
        {!isCasterClass && <Text style={styles.hpHint}>Sua classe não conjura magias, mas você recebe as habilidades abaixo automaticamente no nível 1.</Text>}
        
        <TextInput style={[styles.searchInput, { marginBottom: 20, marginTop: 10 }]} placeholder="Buscar por nome ou nível..." placeholderTextColor="rgba(255,255,255,0.4)" value={spellSearch} onChangeText={setSpellSearch} />
        
        <View style={styles.skillsCard}>
          {filteredSpells.map(s => {
            const isPassive = s.level === 'Classe';
            const isSelected = selectedSpells.includes(s.id.toString());
            
            return (
              <View key={s.id} style={styles.skillRow}>
                <TouchableOpacity style={[styles.radioCircle, isSelected && styles.radioCircleSelected, isPassive && {borderColor: '#00fa9a', backgroundColor: isSelected ? 'rgba(0,250,154,0.2)' : 'transparent'}]} onPress={() => toggleSpell(s.id.toString())}>
                  {isSelected && <View style={[styles.radioDot, isPassive && {backgroundColor: '#00fa9a'}]} />}
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSelectedSpellDetail(s); setSpellDetailModalVisible(true); }}>
                  <Text style={styles.skillName}>{s.name} <Ionicons name="information-circle-outline" size={14} color={isPassive ? "#00fa9a" : "#00bfff"} /></Text>
                </TouchableOpacity>
                <Text style={[styles.spellLevelHint, isPassive && {color: '#02112b', backgroundColor: '#00fa9a'}]}>{s.level}</Text>
              </View>
            )
          })}
          {filteredSpells.length === 0 && <Text style={styles.emptyText}>Nenhuma habilidade listada para esta classe.</Text>}
        </View>
      </View>
    );
  };

  const renderStepEquipment = () => (
    <View style={styles.stepContainer}>
      {renderKitModal()}

      <View style={styles.kitSelectionHeader}>
        <Text style={styles.label}>KIT INICIAL DE CLASSE</Text>
        <TouchableOpacity style={styles.kitSelectBtn} onPress={() => setKitModalVisible(true)}>
           <Text style={styles.kitSelectBtnText}>{selectedKitName}</Text>
           <Ionicons name="swap-horizontal" size={18} color="#00bfff" />
        </TouchableOpacity>
      </View>

      <View style={styles.statsHeader}>
        <Text style={styles.listTitle}>INVENTÁRIO ATUAL</Text>
        <Text style={[styles.counterText, isOverweight && { backgroundColor: 'rgba(255, 50, 50, 0.2)', color: '#ff6666' }]}>
          {currentWeight.toFixed(2)} / {maxCarryingCapacity.toFixed(1)} kg
        </Text>
      </View>
      
      <Text style={styles.label}>MOEDAS INICIAIS</Text>
      <View style={styles.coinsRow}>
        {[ {l: 'Ouro (PO)', v: gp, s: setGp, c: '#ffd700'}, {l: 'Prata (PP)', v: sp, s: setSp, c: '#c0c0c0'}, {l: 'Cobre (PC)', v: cp, s: setCp, c: '#cd7f32'} ].map((c, i) => (
          <View key={i} style={styles.coinBox}><Text style={[styles.coinLabel, { color: c.c }]}>{c.l}</Text><TextInput style={styles.coinInput} keyboardType="numeric" value={String(c.v)} onChangeText={t => c.s(parseInt(t) || 0)} /></View>
        ))}
      </View>
      
      <View style={styles.infoBox}><Text style={styles.infoText}>Ajuste as quantidades ou zere para remover da mochila.</Text></View>
      
      <View style={styles.skillsCard}>
        {inventory.map((item, idx) => (
          <View key={idx} style={styles.skillRow}>
            <View style={styles.qtyControl}><TouchableOpacity style={styles.qtyBtn} onPress={() => updateInventoryQty(idx, -1)}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity><Text style={styles.qtyValue}>{item.qty}</Text><TouchableOpacity style={styles.qtyBtn} onPress={() => updateInventoryQty(idx, 1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity></View>
            <Text style={[styles.skillName, { flex: 1, color: item.qty === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)' }]}>{item.name}</Text>
            <Text style={[styles.statHint, item.qty === 0 && {color: 'transparent'}]}>{(item.weight * item.qty).toFixed(1)} kg</Text>
          </View>
        ))}
        {inventory.length === 0 && <Text style={styles.emptyText}>Escolha um Kit ou comece sem itens.</Text>}
      </View>
    </View>
  );

  const renderStepSummary = () => (
    <View style={styles.stepContainer}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryName}>{name || 'Herói Sem Nome'}</Text>
        <Text style={styles.summarySubtitle}>{race} • {charClass} (Nível 1)</Text>
      </View>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryBox}><Text style={styles.summaryBoxValue}>{armorClass}</Text><Text style={styles.summaryBoxLabel}>C.A BASE</Text></View>
        <View style={styles.summaryBox}><Text style={styles.summaryBoxValue}>{initiative}</Text><Text style={styles.summaryBoxLabel}>INICIATIVA</Text></View>
        <View style={styles.summaryBox}><Text style={styles.summaryBoxValue}>{speed}</Text><Text style={styles.summaryBoxLabel}>DESLOCAM.</Text></View>
      </View>
      <View style={styles.hpContainer}>
        <View style={styles.hpBox}><Text style={styles.hpLabel}>PONTOS DE VIDA MÁXIMOS</Text><Text style={styles.hpValue}>{hpMax}</Text></View>
        <View style={styles.hpBox}><Text style={styles.hpLabel}>DADOS DE VIDA</Text><Text style={[styles.hpValue, {color: '#00bfff'}]}>1d{hitDieMax}</Text></View>
      </View>
    </View>
  );

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {renderSearchModal()}
      {renderSpellDetailModal()}

      {/* MODAL DE ALERTA CUSTOMIZADO */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>{customAlert.title}</Text>
            <Text style={styles.customAlertMessage}>{customAlert.message}</Text>
            <View style={styles.customAlertBtnRow}>
              {customAlert.buttons.map((btn, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  style={[
                    styles.customAlertBtn, 
                    { borderColor: btn.color || '#00bfff', backgroundColor: btn.style === 'destructive' ? 'rgba(255,100,100,0.1)' : 'rgba(255,255,255,0.05)' }
                  ]} 
                  onPress={() => { 
                    setCustomAlert(prev => ({...prev, visible: false})); 
                    if(btn.onPress) setTimeout(btn.onPress, 300); 
                  }}
                >
                  <Text style={[styles.customAlertBtnText, {color: btn.color || '#00bfff'}]}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          
          <View style={styles.header}>
            <View style={{flex: 1}}>
              <Text style={styles.headerTitle}>Novo Personagem</Text>
              <Text style={styles.headerSubtitle}>Passo {step} de {totalSteps}</Text>
            </View>
            <TouchableOpacity style={styles.randomDiceBtn} onPress={handleRandomizeClick}>
              <Ionicons name="dice-outline" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
          
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStepSpells()}
          {step === 6 && renderStepEquipment()}
          {step === 7 && renderStepSummary()}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 && (
            <TouchableOpacity style={styles.backButton} onPress={() => setStep(step - 1)}>
              <Text style={styles.backButtonText}>VOLTAR</Text>
            </TouchableOpacity>
          )}

          {step < totalSteps ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => setStep(step + 1)}>
              <Text style={styles.primaryButtonText}>PRÓXIMO PASSO</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.primaryButton, {backgroundColor: '#00fa9a'}]} onPress={handleSave}>
              <Text style={[styles.primaryButtonText, {color: '#02112b'}]}>CONFIRMAR E SALVAR</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingTop: 60, paddingBottom: 100 },
  header: { marginBottom: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 32, fontWeight: 'bold', color: '#ffffff' },
  headerSubtitle: { fontSize: 16, color: '#00bfff', marginTop: 5, fontWeight: 'bold' },
  randomDiceBtn: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)', marginBottom: 8, letterSpacing: 1 },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16, color: '#ffffff' },
  textArea: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 15, fontSize: 14, color: '#ffffff', minHeight: 100, textAlignVertical: 'top' },
  selectButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 16 },
  selectButtonText: { fontSize: 16, color: '#ffffff' },
  selectIcon: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
  modalContent: { backgroundColor: '#102b56', borderRadius: 24, padding: 20, alignItems: 'center', width: '90%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff', marginBottom: 15 },
  searchInput: { width: '100%', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, padding: 12, color: '#ffffff', fontSize: 16, marginBottom: 15 },
  modalListItem: { width: '100%', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)' },
  modalListItemText: { fontSize: 16, color: '#ffffff' },
  emptyText: { color: 'rgba(255, 255, 255, 0.5)', marginTop: 20, textAlign: 'center' },
  modalCloseButton: { marginTop: 20, paddingVertical: 12, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' },
  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff' },
  counterText: { fontSize: 12, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  statBox: { width: '30%', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 14, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)', marginBottom: 5 },
  statInput: { fontSize: 24, fontWeight: 'bold', color: '#ffffff', textAlign: 'center' },
  stepContainer: { marginTop: 10 },
  step2Container: { marginTop: 10 },
  profBonusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(0, 191, 255, 0.3)', borderRadius: 12, padding: 15, marginBottom: 20 },
  profBonusTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff' },
  profBonusInput: { fontSize: 20, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 0, 0, 0.2)', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 8 },
  listTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff' },
  skillsCard: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 16, padding: 15, marginBottom: 20 },
  skillRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)' },
  radioCircle: { height: 24, width: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  radioCircleSelected: { borderColor: '#00bfff' },
  radioDot: { height: 12, width: 12, borderRadius: 6, backgroundColor: '#00bfff' },
  skillInputCalculated: { width: 40, fontSize: 16, fontWeight: 'bold', color: '#00bfff', textAlign: 'center', marginRight: 10 },
  skillName: { fontSize: 16, color: 'rgba(255, 255, 255, 0.8)' },
  spellLevelHint: { fontSize: 10, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statHint: { fontSize: 12, color: 'rgba(255, 255, 255, 0.4)' },
  footer: { position: 'absolute', bottom: 30, left: 20, right: 20, flexDirection: 'row', gap: 10 },
  backButton: { flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  backButtonText: { fontSize: 14, fontWeight: 'bold', color: '#ffffff' },
  primaryButton: { flex: 2, backgroundColor: '#00bfff', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  primaryButtonText: { fontSize: 14, fontWeight: 'bold', color: '#02112b' },
  infoBox: { backgroundColor: 'rgba(0, 191, 255, 0.1)', padding: 15, borderRadius: 12, borderColor: 'rgba(0, 191, 255, 0.3)', borderWidth: 1, marginBottom: 20 },
  hpHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 5, marginBottom: 15, lineHeight: 18 },
  infoText: { color: '#ffffff', fontSize: 14, lineHeight: 20 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', marginRight: 15, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 8 },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  qtyBtnText: { color: '#00bfff', fontSize: 18, fontWeight: 'bold' },
  qtyValue: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', width: 20, textAlign: 'center' },
  coinsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  coinBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 10, alignItems: 'center' },
  coinLabel: { fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  coinInput: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  summaryHeader: { alignItems: 'center', marginBottom: 20, backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: 20, borderRadius: 16 },
  summaryName: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
  summarySubtitle: { fontSize: 16, color: '#00bfff', fontWeight: 'bold' },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  summaryBox: { flex: 1, backgroundColor: 'rgba(0, 191, 255, 0.05)', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  summaryBoxValue: { fontSize: 26, fontWeight: 'bold', color: '#fff' },
  summaryBoxLabel: { fontSize: 10, fontWeight: 'bold', color: '#00bfff' },
  hpContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
  hpBox: { flex: 1, backgroundColor: 'rgba(255, 50, 50, 0.05)', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  hpValue: { fontSize: 26, fontWeight: 'bold', color: '#ff6666' },
  hpLabel: { fontSize: 10, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)' },

  spellDetailCard: { backgroundColor: '#102b56', borderRadius: 24, padding: 25, width: '90%', borderWidth: 1, borderColor: '#00bfff' },
  spellDetailName: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
  spellDetailLevel: { color: '#00bfff', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 20 },
  spellDetailInfoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 12 },
  spellDetailInfoItem: { alignItems: 'center', flex: 1 },
  spellDetailInfoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4 },
  spellDetailInfoValue: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  spellDetailDescription: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 22 },

  kitSelectionHeader: { marginBottom: 25 },
  kitSelectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#00bfff' },
  kitSelectBtnText: { color: '#00bfff', fontWeight: 'bold', fontSize: 14 },
  kitCard: { backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  kitCardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  kitCardItems: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 12, lineHeight: 18 },
  customKitBadge: { position: 'absolute', top: 15, right: 15, color: '#00fa9a', fontSize: 10, fontWeight: 'bold', backgroundColor: 'rgba(0,250,154,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },

  customAlertBox: { backgroundColor: '#102b56', width: '90%', borderRadius: 20, padding: 25, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', alignItems: 'center' },
  customAlertTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  customAlertMessage: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  customAlertBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', justifyContent: 'center' },
  customAlertBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', minWidth: '30%', borderWidth: 1 },
  customAlertBtnText: { fontWeight: 'bold', fontSize: 14 },
});