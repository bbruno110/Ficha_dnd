// ================= IMPORTAÇÕES DA CAMADA BÁSICA =================
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

// IMPORTAÇÃO DO NOVO COMPONENTE
import SpellSelector, { SpellItem } from '../components/SpellSelector';

// ================= TIPAGENS =================
type RaceItem = { id: number; name: string; stat_bonuses: string; speed: string; features: string; criador?: string };
type ClassItem = { id: number; name: string; recommended_stats: string; starting_equipment: string; starting_gold: number; hit_dice: number; saves: string; subclass_level: number; is_caster: number; features: string; criador?: string };
type SkillItem = { id: string; name: string; stat: string };
type DbItem = { id: number; name: string; weight: number; criador?: string };
type InventoryItem = { name: string; qty: number; weight: number };
type StartingKit = { id: number; name: string; target_name: string; target_type?: string; items: string; criador?: string };
type SpellProgression = { cantrips_known: number, spells_known: number, slot_1: number };

// Força a categoria para os contadores não quebrarem
const getCategory = (spell?: SpellItem): string => {
  if (!spell) return 'Desconhecido';
  if (spell.category && spell.category !== 'Desconhecido') return spell.category;
  if (spell.level === 'Truque' || spell.level?.includes('Nível')) return 'Magia';
  if (spell.casting_time === 'Passiva' || spell.level === 'Passiva') return 'Passiva';
  return 'Habilidade';
};

// Lista de magias/features que pertencem EXCLUSIVAMENTE aos personagens de BG3
const BG3_ORIGIN_FEATURES = [
  "Mãos Mágicas (Githyanki)", 
  "Mordida Vampírica", 
  "Fúria do Motor Infernal", 
  "Orbe de Netheril", 
  "Bênção da Divindade Sombria", 
  "Golpe Destruidor de Almas"
];

// Lista de Habilidades base das Classes para serem tratadas como Passivas
const BASE_CLASS_FEATURES = [
  "Fúria", "Defesa Sem Armadura", "Segundo Fôlego", "Imposição das Mãos", "Sentido Divino", "Inimigo Favorito", "Explorador Nato", "Ataque Extra", "Ação Surto"
];

export default function CreateCharacterScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const isRandomizing = useRef(false);

  const hasConfirmedRandomize = useRef(false);

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

  // ----- ESTADOS DE MAGIAS E HABILIDADES -----
  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [spellsModalVisible, setSpellsModalVisible] = useState(false);
  const [maxCantrips, setMaxCantrips] = useState(0);
  const [maxSpellsLvl1, setMaxSpellsLvl1] = useState(0);

  // Estado para blindar magias de origem e passivas inatas
  const [allowedOriginFeature, setAllowedOriginFeature] = useState<string | null>(null);
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([]);

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

  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});

  const showCustomAlert = (title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string, style?: string}[]) => {
    setCustomAlert({ visible: true, title, message, buttons: buttons || [{ text: 'OK', color: '#00bfff' }] });
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

  // CÁLCULO DE PASSIVAS EXTRAS (Ex: Estilo de Luta do Guerreiro)
  let maxExtraPassives = 0;
  if (charClass === 'Guerreiro') maxExtraPassives = 1; 

  const isCasterClass = maxCantrips > 0 || maxSpellsLvl1 > 0;

  // ================= FUNÇÕES DE PROGRESSÃO DE MAGIA =================
  const fetchSpellLimits = async (cName: string, rName: string, currentStats: any = stats) => {
    if (cName === 'Selecione uma classe') return { cantrips: 0, lvl1: 0 };
    
    let calcCantrips = 0;
    let calcLvl1 = 0;

    let dbCantrips: number | null = null;
    let dbLvl1: number | null = null;
    let dbRaceCantrips: number | null = null;

    try {
      const classProg = await db.getFirstAsync<SpellProgression>(
        `SELECT * FROM spellcasting_progression WHERE source_type = 'class' AND source_name = ? AND level = 1`, 
        [cName]
      );

      if (classProg) {
        dbCantrips = classProg.cantrips_known || 0;
        
        // Magias fixas conhecidas vs Magias preparadas diariamente
        if (classProg.spells_known > 0) {
           dbLvl1 = classProg.spells_known;
        } else {
           const intMod = Math.floor((parseInt(currentStats.INT) - 10) / 2);
           const sabMod = Math.floor((parseInt(currentStats.SAB) - 10) / 2);
           const carMod = Math.floor((parseInt(currentStats.CAR) - 10) / 2);

           if (cName === 'Mago') dbLvl1 = Math.max(1 + intMod, 1);
           else if (cName === 'Clérigo' || cName === 'Druida') dbLvl1 = Math.max(1 + sabMod, 1);
           else if (cName === 'Paladino' || cName === 'Patrulheiro') dbLvl1 = 0;
           else if (classProg.slot_1 > 0) dbLvl1 = classProg.slot_1 + (classProg.cantrips_known > 0 ? 2 : 0);
           else dbLvl1 = 0;
        }
      }

      const raceProg = await db.getFirstAsync<SpellProgression>(
        `SELECT cantrips_known FROM spellcasting_progression WHERE source_type = 'race' AND source_name = ? AND level = 1`, 
        [rName]
      );

      if (raceProg) { dbRaceCantrips = raceProg.cantrips_known || 0; }
    } catch (e) {}

    // Fallbacks caso banco falhe
    if (dbCantrips !== null && dbLvl1 !== null) {
      calcCantrips = dbCantrips;
      calcLvl1 = dbLvl1;
    } else {
      if (['Mago', 'Feiticeiro'].includes(cName)) { calcCantrips = 3; calcLvl1 = 4; }
      else if (['Bardo', 'Bruxo', 'Clérigo', 'Druida'].includes(cName)) { calcCantrips = 2; calcLvl1 = 3; }
      else if (['Paladino', 'Patrulheiro'].includes(cName)) { calcCantrips = 0; calcLvl1 = 0; }
    }

    if (dbRaceCantrips !== null) { calcCantrips += dbRaceCantrips; } 
    else { if (['Alto Elfo', 'Drow', 'Tiefling', 'Githyanki'].includes(rName)) { calcCantrips += 1; } }

    return { cantrips: calcCantrips, lvl1: calcLvl1 };
  };

  // ================= FUNÇÕES DE APOIO =================
  const openSelectionModal = (type: 'race' | 'class') => { 
    setModalType(type); setSearchQuery(''); setModalVisible(true); 
  };

  const getFilteredData = () => {
    return (modalType === 'race' ? dbRaces : dbClasses).filter(item => 
      item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const generateRandomLore = () => {
    const archetypes = [
      {
        name: "O Malandro das Ruas",
        allowedClasses: ['Ladino', 'Bardo', 'Guerreiro', 'Bruxo', 'Monge'],
        traits: ['Sempre encontro uma forma de rir, mesmo nas piores situações.', 'Sempre desconfio das intenções de estranhos antes de confiar.', 'Gosto de testar os limites das pessoas só para ver como reagem.', 'Tenho dificuldade em levar qualquer autoridade a sério.', 'Falo o que penso, mesmo quando deveria ficar calado.'],
        ideals: ['Liberdade. Correntes são feitas para serem quebradas.', 'Caos. A ordem excessiva sufoca a vida.', 'Comunidade. Devemos cuidar uns dos outros para sobreviver.'],
        bonds: ['Fui expulso da minha vila e um dia voltarei para provar meu valor.', 'Tenho um rival que jurei superar em tudo.', 'Estou em busca de um ente querido que desapareceu há anos.'],
        flaws: ['Tenho um vício em jogos de cartas que sempre me deixa pobre.', 'Impulsivo, ajo antes de pensar se a emoção falar mais alto.', 'Costumo mentir mesmo quando não há necessidade.', 'Não sei lidar bem com autoridade.'],
        backstory: ['Cresci nas ruas da capital, aprendendo a sobreviver desde cedo furtando pães e frutas nas feiras.', 'Fui acusado injustamente de um crime e agora vivo fugindo.', 'Trabalhava como capanga de um agiota, até o dia em que decidi roubar dele e fugir.'],
        allies: ['Tenho uma dívida eterna com a Taverneira do "Javali Saltitante".', 'Mantenho contato obscuro com o sindicato de contrabandistas do cais.', 'Tenho um informante nas masmorras da cidade.', 'Possuo um contato no mercado negro.'],
        features: ['Consigo dormir profundamente em qualquer lugar, mesmo no chão de pedra.', 'Minha sombra parece se mover um segundo atrasada.', 'Tenho uma tolerância absurdamente alta para bebidas fortes.'],
        extraLanguages: ['Goblin', 'Subcomum', 'Símbolos Secretos de Ladrões', 'Proficiência com Cartas de Baralho']
      },
      {
        name: "O Devoto Fanático",
        allowedClasses: ['Clérigo', 'Paladino', 'Monge'],
        traits: ['Tudo o que faço é em nome da minha fé.', 'Vejo sinais divinos em pequenos acontecimentos.', 'Tenho dificuldade em entender quem não segue uma crença.', 'Costumo citar escrituras em momentos inadequados.'],
        ideals: ['Fé. A verdadeira força vem da devoção absoluta.', 'Sacrifício. Grandes recompensas exigem grandes renúncias.', 'Purificação. O mal deve ser erradicado pela raiz.'],
        bonds: ['Protejo um templo que foi quase destruído.', 'Minha vida pertence à divindade que me salvou.', 'Carrego uma relíquia sagrada que não pode cair em mãos erradas.'],
        flaws: ['Sou intolerante com crenças opostas.', 'Posso ir longe demais ao tentar "corrigir" alguém.', 'Confundo minha vontade com a vontade divina.'],
        backstory: ['Sobrevivi a uma tragédia que acredito ter sido intervenção divina.', 'Fui criado dentro de um templo e nunca conheci outra vida.', 'Recebi uma visão profética que mudou meu destino de uma hora para a outra.'],
        allies: ['Sou respeitado por membros de minha ordem religiosa.', 'Recebo apoio discreto de um sacerdote influente.', 'Possuo contato com um inquisidor da fé.'],
        features: ['Minha presença intimida hereges e cultistas.', 'Minha voz ecoa com autoridade quando falo de fé.', 'Possuo marcas sagradas discretas pelo corpo.'],
        extraLanguages: ['Celestial', 'Infernal', 'Proficiência com Kit de Caligrafia', 'Abissal']
      },
      {
        name: "O Alquimista/Estudioso Obcecado",
        allowedClasses: ['Mago', 'Feiticeiro', 'Ladino', 'Bruxo', 'Artífice'],
        traits: ['Anoto tudo em cadernos cheios de fórmulas e desenhos.', 'Vejo potencial explosivo em objetos comuns.', 'Fico empolgado demais ao testar hipóteses perigosas.', 'Perco a noção do tempo quando estou pesquisando algo novo.'],
        ideals: ['Descoberta. Sempre há algo novo a ser criado ou entendido.', 'Transformação. Nada é fixo; tudo pode mudar.', 'Ambição. O impossível é apenas uma questão de tentativa e erro.'],
        bonds: ['Busco aperfeiçoar a fórmula mágica que matou meu antigo mentor.', 'Protejo um manuscrito raro que contém conhecimento proibido.', 'Prometi achar a cura para uma praga que assola minha região.'],
        flaws: ['Subestimo riscos de experimentos e feitiços instáveis.', 'Tenho dificuldade extrema em aceitar falhas.', 'Às vezes trato pessoas como cobaias involuntárias.'],
        backstory: ['Fui aprendiz de um mestre excêntrico, até que o laboratório explodiu e tive que fugir.', 'Acabei expulso de uma academia mágica por práticas perigosas.', 'Descobri cedo meu talento para manipular substâncias raras e energias voláteis.'],
        allies: ['Tenho contato com um fornecedor de ingredientes exóticos.', 'Recebo cartas criptografadas de um antigo colega de estudos.', 'Conheço um médico disposto a testar novas misturas sem fazer perguntas.'],
        features: ['Cheiro constantemente a reagentes químicos e pergaminho velho.', 'Tenho pequenas queimaduras antigas nas pontas dos dedos.', 'Carrego frascos escondidos em bolsos secretos nas roupas.'],
        extraLanguages: ['Dracônico', 'Proficiência com Kit de Alquimia', 'Proficiência com Kit de Herbalismo', 'Primordial']
      },
      {
        name: "O Navegador Errante",
        allowedClasses: ['Bardo', 'Guerreiro', 'Ladino', 'Patrulheiro'],
        traits: ['Sempre conto histórias do mar, mesmo quando ninguém pediu.', 'Confio mais em mapas antigos do que em pessoas novas.', 'Acredito que o horizonte sempre guarda algo melhor do que o porto seguro.', 'Tenho extrema dificuldade em ficar muito tempo no mesmo lugar.'],
        ideals: ['Liberdade. O mar e as estradas não pertencem a ninguém.', 'Descoberta. Sempre há novas rotas a serem traçadas.', 'Camaradagem. Uma tripulação unida sobrevive a qualquer tempestade.'],
        bonds: ['Procuro um porto lendário que poucos acreditam existir.', 'Minha antiga tripulação foi destruída por piratas sanguinolentos.', 'Tenho um mapa incompleto que pode mudar a geografia do mundo conhecido.'],
        flaws: ['Sou extremamente supersticioso quanto a presságios marítimos e climáticos.', 'Bebo além da conta quando estou muito tempo em terra firme.', 'Não resisto a uma aposta perigosa se envolver navegação ou rotas.'],
        backstory: ['Cresci esfregando o convés de um navio mercante.', 'Sou o único sobrevivente de um naufrágio provocado por uma fera misteriosa.', 'Fugi de uma família abusiva para viver aventuras no mar sem fim.'],
        allies: ['Tenho amizade fiel com um capitão aposentado e rabugento.', 'Sou bem-vindo em certos portos costeiros barra-pesada.', 'Mantenho contato com cartógrafos independentes.'],
        features: ['Sinto mudanças no vento antes mesmo que aconteçam.', 'Tenho um equilíbrio excelente, mesmo em terreno muito instável.', 'Reconheço rotas e constelações com uma batida de olho.'],
        extraLanguages: ['Primordial', 'Proficiência com Ferramentas de Navegação', 'Aquan', 'Proficiência com Veículos Aquáticos']
      },
      {
        name: "O Assassino Calculista",
        allowedClasses: ['Ladino', 'Patrulheiro', 'Monge', 'Guerreiro'],
        traits: ['Raramente demonstro emoções ou levanto a voz.', 'Observo padrões de comportamento antes de agir ou falar com alguém.', 'Prefiro resolver problemas da forma mais rápida e silenciosa possível.', 'Nunca faço ameaças vazias.'],
        ideals: ['Eficiência. O método mais limpo e letal é sempre o melhor.', 'Contrato. Um acordo selado deve ser cumprido, independente do alvo.', 'Equilíbrio. Às vezes, a morte de um é necessária para a sobrevivência de muitos.'],
        bonds: ['Tenho uma dívida impagável com o mestre que me ensinou a lutar e desaparecer.', 'Busco vingança implacável contra quem traiu minha antiga guilda.', 'Protejo alguém importante que não faz a menor ideia da minha real profissão.'],
        flaws: ['Tenho dificuldade gigantesca em confiar em aliados recém-chegados.', 'Subestimo o afeto e a compaixão como um fator de risco.', 'Vejo a maioria das pessoas apenas como peças em um tabuleiro.'],
        backstory: ['Fui treinado desde jovem por uma guilda clandestina que não tolerava falhas.', 'Fui traído e deixado para morrer por meu antigo contratante.', 'Era um espião a serviço de um lorde corrupto, mas decidi trabalhar por conta própria.'],
        allies: ['Tenho contato direto com um informante do submundo.', 'Possuo acesso a um falsificador talentosíssimo.', 'Sou conhecido - e temido - por um pequeno círculo de mercadores ilegais.'],
        features: ['Meus passos são quase inaudíveis, não importa o calçado.', 'Nunca esqueço a rotina de um alvo após observá-lo por um dia.', 'Mantenho lâminas minúsculas escondidas em locais improváveis do corpo.'],
        extraLanguages: ['Símbolos Secretos de Ladrões', 'Proficiência com Kit de Disfarce', 'Proficiência com Kit de Veneno', 'Subcomum']
      },
      {
        name: "O Combatente Disciplinado",
        allowedClasses: ['Guerreiro', 'Paladino', 'Bárbaro', 'Monge'],
        traits: ['Não tenho tempo para brincadeiras, sou completamente focado no objetivo.', 'Não confio em sorte mágica, apenas no meu treino e preparação física.', 'Prefiro observar o campo de batalha em silêncio antes de desferir o primeiro golpe.'],
        ideals: ['Honra. Se eu der minha palavra, eu a cumprirei, custe o que custar.', 'Justiça. Os culpados sempre devem pagar na mesma moeda.', 'Proteção. Os fracos e inocentes devem ser defendidos por aqueles que são fortes.'],
        bonds: ['Luto para proteger aqueles que não conseguem empunhar uma arma.', 'Minha honra está eternamente ligada ao nome manchado da minha família.', 'Devo minha vida a um aventureiro veterano que me salvou da morte certa no passado.'],
        flaws: ['Guardo rancor por tempo demais, às vezes anos.', 'Sou praticamente incapaz de recusar um desafio direto às minhas habilidades.', 'Tenho um temperamento rígido que muitas vezes aliena meus aliados.', 'Tenho extrema dificuldade em admitir quando meu plano tático está errado.'],
        backstory: ['Fui um antigo guarda da cidade que se cansou da corrupção dos nobres, jogou o distintivo fora e pegou a estrada.', 'Servi bravamente no exército durante uma guerra violenta que o reino preferiu esquecer.', 'Sou sobrevivente de um ataque de saqueadores; jurei treinar até que nunca mais fosse fraco.'],
        allies: ['Sou bastante respeitado por um pequeno clã de mercenários independentes.', 'Tenho amizade velada com um capitão da guarda local.', 'Tenho um velho companheiro de batalhões sempre disposto a ajudar por uma caneca de cerveja.'],
        features: ['Possuo dezenas de cicatrizes de batalha, cada uma com uma história militar.', 'Tenho memória afiada para terrenos e posições táticas.', 'Nunca esqueço o rosto de quem já lutou ao meu lado - ou contra mim.'],
        extraLanguages: ['Gigante', 'Orc', 'Proficiência com Ferramentas de Ferreiro', 'Proficiência com Ferramentas de Carpinteiro']
      }
    ];

    let validArchetypes = archetypes;
    if (charClass && charClass !== 'Selecione uma classe') {
      validArchetypes = archetypes.filter(a => a.allowedClasses.includes(charClass));
      if (validArchetypes.length === 0) validArchetypes = archetypes; 
    }

    const chosenArchetype = validArchetypes[Math.floor(Math.random() * validArchetypes.length)];
    setPersonalityTraits(chosenArchetype.traits[Math.floor(Math.random() * chosenArchetype.traits.length)]);
    setIdeals(chosenArchetype.ideals[Math.floor(Math.random() * chosenArchetype.ideals.length)]);
    setBonds(chosenArchetype.bonds[Math.floor(Math.random() * chosenArchetype.bonds.length)]);
    setFlaws(chosenArchetype.flaws[Math.floor(Math.random() * chosenArchetype.flaws.length)]);
    
    let generatedBackstory = chosenArchetype.backstory[Math.floor(Math.random() * chosenArchetype.backstory.length)];
    if (charClass && charClass !== 'Selecione uma classe') {
        const connectors = [
          ` O destino e a dureza da vida acabaram forjando minhas habilidades como ${charClass}.`,
          ` Abraçar o caminho de ${charClass} foi a única maneira que encontrei para sobreviver a esse passado.`,
          ` Essa história me deixou marcas profundas e despertou minha vocação como ${charClass}.`
        ];
        generatedBackstory += connectors[Math.floor(Math.random() * connectors.length)];
    }
    setBackstory(generatedBackstory);

    setAlliesOrganizations(chosenArchetype.allies[Math.floor(Math.random() * chosenArchetype.allies.length)]);
    setFeaturesTraits(chosenArchetype.features[Math.floor(Math.random() * chosenArchetype.features.length)]);
    
    let baseLangs = "Comum";
    if (race.includes('Elfo')) baseLangs += ", Élfico";
    else if (race.includes('Anão')) baseLangs += ", Anão";
    else if (race.includes('Halfling')) baseLangs += ", Halfling";
    else if (race.includes('Draconato')) baseLangs += ", Dracônico";
    else if (race.includes('Gnomo')) baseLangs += ", Gnômico";
    else if (race.includes('Orc')) baseLangs += ", Orc";
    else if (race.includes('Tiefling')) baseLangs += ", Infernal";
    else if (race.includes('Githyanki')) baseLangs += ", Gith (Subcomum)";
    else baseLangs += " e mais um idioma racial à escolha";

    const extraLang = chosenArchetype.extraLanguages[Math.floor(Math.random() * chosenArchetype.extraLanguages.length)];
    setLanguages(`Idiomas: ${baseLangs}.\nHerança do Passado: ${extraLang}.`);
  };

  const handleRandomizeClick = () => {
    const isDirty = name.trim() !== '' || race !== 'Selecione uma raça' || charClass !== 'Selecione uma classe';
    
    if (!isDirty || hasConfirmedRandomize.current) {
      generateRandomCharacter();
      return;
    }

    if (step === 3 || step === 4) {
      showCustomAlert(
        "Gerador Inteligente",
        "Você está na aba de História.\nDeseja gerar APENAS a personalidade genérica e o histórico, mantendo os seus status atuais?",
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
                  { text: "Sim, gerar do zero", color: "#ff6666", style: "destructive", onPress: () => {
                      hasConfirmedRandomize.current = true;
                      generateRandomCharacter();
                    } 
                  }
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
          { text: "Sim, sortear", color: "#ff6666", style: "destructive", onPress: () => {
              hasConfirmedRandomize.current = true;
              generateRandomCharacter();
            } 
          }
        ]
      );
    }
  };

  const generateRandomCharacter = async () => {
    if (dbRaces.length === 0 || dbClasses.length === 0) { showCustomAlert("Aguarde", "Carregando o banco de dados..."); return; }
    isRandomizing.current = true;
    
    if (Math.random() < 0.0001) {
      try {
        const companionsDB = await db.getAllAsync('SELECT * FROM bg3_companions ORDER BY RANDOM() LIMIT 1');
        if (companionsDB.length > 0) {
          const companion: any = companionsDB[0];
          companion.skills = JSON.parse(companion.skills);
          companion.stats = JSON.parse(companion.stats);
          companion.originSpell = companion.origin_spell;
          companion.class = companion.class_name;

          const matchedRace = dbRaces.find(r => r.name.toLowerCase().includes(companion.race.toLowerCase())) || dbRaces[0];
          const matchedClass = dbClasses.find(c => c.name.toLowerCase().includes(companion.class.toLowerCase())) || dbClasses[0];

          setName(companion.name); setRace(matchedRace.name); setCharClass(matchedClass.name); setAllowedOriginFeature(companion.originSpell || null);
          
          setStats({
            FOR: companion.stats.FOR, DES: companion.stats.DES, CON: companion.stats.CON,
            INT: companion.stats.INT, SAB: companion.stats.SAB, CAR: companion.stats.CAR,
          });
          const totalCompStats = Object.values(companion.stats).reduce((acc: number, val: any) => acc + parseInt(val as string), 0);
          setMaxStatsSum(totalCompStats > 72 ? totalCompStats : 72);

          setPersonalityTraits(companion.personality); setIdeals(companion.ideals); setBonds(companion.bonds);
          setFlaws(companion.flaws); setBackstory(companion.backstory); setAlliesOrganizations(companion.allies);
          setFeaturesTraits(companion.features); setLanguages("Comum e idiomas raciais associados.");
          setGp(matchedClass.starting_gold || 100);

          await setupCharacterExtras(matchedRace, matchedClass, companion, companion.stats);
        }
      } catch (error) {}
    } else {
      const randRace = dbRaces[Math.floor(Math.random() * dbRaces.length)];
      const randClass = dbClasses[Math.floor(Math.random() * dbClasses.length)];
      setRace(randRace.name); setCharClass(randClass.name); setAllowedOriginFeature(null);

      const maleNames = ['Bruno', 'João', 'Pedro', 'Bentinho', 'Wilker'];
      const femaleNames = ['Karoline', 'Maria', 'Ana', 'Beatriz', 'Mariana'];
      const isMale = Math.random() > 0.5;
      const randomFirstName = isMale ? maleNames[Math.floor(Math.random() * maleNames.length)] : femaleNames[Math.floor(Math.random() * femaleNames.length)];

      const validTitles = ['o Aventureiro', 'de Tal', 'o Desconhecido'];
      const randomTitle = validTitles[Math.floor(Math.random() * validTitles.length)];

      setName(`${randomFirstName} ${randomTitle}`);

      const baseStats = JSON.parse(randClass.recommended_stats || '{}');
      const bonuses = JSON.parse(randRace.stat_bonuses || '{}') as Record<string, number>;
      const totalBonus = Object.values(bonuses).reduce((acc, val) => acc + (val || 0), 0);
      setMaxStatsSum(72 + totalBonus);
      
      const calculatedStats = {
        FOR: String((baseStats.FOR || 10) + (bonuses.FOR || 0)), DES: String((baseStats.DES || 10) + (bonuses.DES || 0)), CON: String((baseStats.CON || 10) + (bonuses.CON || 0)),
        INT: String((baseStats.INT || 10) + (bonuses.INT || 0)), SAB: String((baseStats.SAB || 10) + (bonuses.SAB || 0)), CAR: String((baseStats.CAR || 10) + (bonuses.CAR || 0)),
      };
      setStats(calculatedStats);
      setGp(randClass.starting_gold || 0);

      generateRandomLore();
      await setupCharacterExtras(randRace, randClass, null, calculatedStats);
    }
    
    setStep(7); 
    setTimeout(() => { isRandomizing.current = false; }, 500);
  };

  const setupCharacterExtras = async (r: RaceItem, c: ClassItem, companion?: any, generatedStats?: any) => {
    const classSaves = JSON.parse(c.saves || '[]');
    let finalSkills: string[] = [];

    if (companion && companion.skills) {
       finalSkills = companion.skills;
    } else {
       let calcSkills = 4;
       if (r.name === 'Meio-Elfo') calcSkills += 2;
       if (r.name === 'Elfo' || r.name === 'Meio-Orc') calcSkills += 1;
       if (c.name === 'Ladino') calcSkills += 2;
       else if (c.name === 'Bardo' || c.name === 'Patrulheiro') calcSkills += 1;
       
       const shuffledSkills = [...dbSkills].sort(() => 0.5 - Math.random());
       finalSkills = shuffledSkills.slice(0, calcSkills).map(s => s.id);
    }
    setProficiencies([...classSaves, ...finalSkills]);

    let kits: StartingKit[] = [];
    if (companion) { kits = await db.getAllAsync<StartingKit>(`SELECT * FROM starting_kits WHERE name LIKE ?`, [`%${companion.shortName || companion.name}%`]); } 
    if (!kits || kits.length === 0) { kits = await db.getAllAsync<StartingKit>(`SELECT * FROM starting_kits WHERE target_name = ? AND target_type != 'bg3'`, [c.name]); }

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
      setInventory([]); setSelectedKitName('Nenhum kit disponível');
    }

    let raceFeatures: string[] = [];
    let classFeaturesListed: string[] = [];
    try {
      if (r.features) raceFeatures = JSON.parse(r.features).map((f:any) => typeof f === 'string' ? f : f.name);
      if (c.features) classFeaturesListed = JSON.parse(c.features).map((f:any) => typeof f === 'string' ? f : f.name);
    } catch(e) {}

    if (companion && companion.originSpell) { raceFeatures.push(companion.originSpell); }
    if (r.name === 'Githyanki' && !raceFeatures.includes('Mãos Mágicas (Githyanki)')) { raceFeatures.push('Mãos Mágicas (Githyanki)'); }

    const allLockedFeatures = Array.from(new Set([...raceFeatures, ...classFeaturesListed]));
    setLockedFeatures(allLockedFeatures);

    const spells = await db.getAllAsync<SpellItem>(`SELECT * FROM spells WHERE classes LIKE ? OR name IN (${allLockedFeatures.length > 0 ? allLockedFeatures.map(() => '?').join(',') : '""'}) ORDER BY level ASC, name ASC`, [`%${c.name}%`, ...allLockedFeatures]);
    
    const lockedFeatureIds: string[] = [];
    allLockedFeatures.forEach(featName => {
       const found = spells.find(s => s.name === featName);
       if (found) lockedFeatureIds.push(found.id.toString());
    });

    const limits = await fetchSpellLimits(c.name, r.name, generatedStats || stats);
    setMaxCantrips(limits.cantrips);
    setMaxSpellsLvl1(limits.lvl1);

    let cantrips: string[] = [];
    let level1: string[] = [];
    
    if (limits.cantrips > 0) {
      cantrips = spells.filter(s => s.level === 'Truque' && getCategory(s) === 'Magia').sort(() => 0.5 - Math.random()).slice(0, limits.cantrips).map(s => s.id.toString());
    }
    if (limits.lvl1 > 0) {
      level1 = spells.filter(s => s.level === 'Nível 1' && getCategory(s) === 'Magia').sort(() => 0.5 - Math.random()).slice(0, limits.lvl1).map(s => s.id.toString());
    }
    
    setSelectedSpells([...lockedFeatureIds, ...cantrips, ...level1]);
  }

  // ================= FUNÇÕES DE INTERAÇÃO DO USUÁRIO =================
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

  // Effect Initial Load
  useEffect(() => {
    async function loadCatalog() {
      try {
        setDbRaces(await db.getAllAsync('SELECT * FROM races ORDER BY name'));
        setDbClasses(await db.getAllAsync('SELECT * FROM classes ORDER BY name'));
        setDbSavingThrows(await db.getAllAsync('SELECT * FROM saving_throws'));
        setDbSkills(await db.getAllAsync('SELECT * FROM skills ORDER BY name'));
        setDbItems(await db.getAllAsync('SELECT * FROM items ORDER BY name'));
      } catch (error) {}
    }
    loadCatalog();
  }, []);

  // Effect Limites de Magia (Manual Selection)
  useEffect(() => {
    if (isRandomizing.current) return;
    async function updateSpellLimits() {
      const limits = await fetchSpellLimits(charClass, race, stats);
      setMaxCantrips(limits.cantrips);
      setMaxSpellsLvl1(limits.lvl1);
    }
    updateSpellLimits();
  }, [charClass, race, stats]);

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
            FOR: String((baseStats.FOR || 10) + (bonuses.FOR || 0)), DES: String((baseStats.DES || 10) + (bonuses.DES || 0)), CON: String((baseStats.CON || 10) + (bonuses.CON || 0)),
            INT: String((baseStats.INT || 10) + (bonuses.INT || 0)), SAB: String((baseStats.SAB || 10) + (bonuses.SAB || 0)), CAR: String((baseStats.CAR || 10) + (bonuses.CAR || 0)),
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
        const kits = await db.getAllAsync<StartingKit>(`SELECT * FROM starting_kits WHERE target_name = ? AND target_type != 'bg3'`, [charClass]);
        setDbKits(kits);
        if (isRandomizing.current) return; 
        if (kits.length > 0) { handleSelectKit(kits[0]); } 
        else { setInventory([]); setSelectedKitName('Nenhum kit disponível'); }
      } catch (error) {}
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
     if (isRandomizing.current) return;
     const currentRace = dbRaces.find(r => r.name === race);
     const currentClass = dbClasses.find(c => c.name === charClass);
     
     let rFeats: string[] = [];
     let cFeats: string[] = [];
     
     try { if (currentRace && currentRace.features) rFeats = JSON.parse(currentRace.features).map((f:any) => typeof f === 'string' ? f : f.name); } catch(e){}
     try { if (currentClass && currentClass.features) cFeats = JSON.parse(currentClass.features).map((f:any) => typeof f === 'string' ? f : f.name); } catch(e){}
     
     if (race === 'Githyanki' && !rFeats.includes('Mãos Mágicas (Githyanki)')) rFeats.push('Mãos Mágicas (Githyanki)');
     
     setLockedFeatures(Array.from(new Set([...rFeats, ...cFeats])));
  }, [race, charClass, dbRaces, dbClasses]);

  useEffect(() => {
    async function loadSpells() {
      if (charClass === 'Selecione uma classe') return;
      try {
        const result = await db.getAllAsync<SpellItem>(
          `SELECT * FROM spells WHERE classes LIKE ? OR name IN (${lockedFeatures.length > 0 ? lockedFeatures.map(() => '?').join(',') : '""'}) ORDER BY level ASC, name ASC`,
          [`%${charClass}%`, ...lockedFeatures]
        );
        
        const safeSpells = result.filter(s => {
          if (BG3_ORIGIN_FEATURES.includes(s.name) && s.name !== allowedOriginFeature) return false;
          
          const sCat = getCategory(s);

          // As inatas e passivas bloqueadas SEMPRE aparecem, independentemente do nível.
          // Elas precisam aparecer para o jogador ver as skills garantidas dele com o cadeado.
          if (lockedFeatures.includes(s.name)) return true;

          // Se for Magia: Bloqueia magias que não são de Nível 1 ou Truque (o personagem está no Nível 1)
          if (sCat === 'Magia' && s.level !== 'Truque' && s.level !== 'Nível 1') return false;

          // Se for Habilidade ou Passiva extra (ex: Estilo de Luta): Bloqueia se o pré-requisito for maior que 1.
          if ((sCat === 'Habilidade' || sCat === 'Passiva') && s.class_level_required) {
             const reqLvl = parseInt(String(s.class_level_required), 10) || 1;
             if (reqLvl > 1) return false;
          }

          return true;
        });

        setAvailableSpells(safeSpells);
        
        if (!isRandomizing.current) {
           // Trava automaticamente as passivas obrigatórias da classe atual na array de 'selectedSpells'
           const classFeatures = safeSpells.filter(s => lockedFeatures.includes(s.name)).map(s => s.id.toString());
           setSelectedSpells(prev => Array.from(new Set([...prev, ...classFeatures])));
        }
      } catch (error) {}
    }
    loadSpells();
  }, [charClass, race, allowedOriginFeature, lockedFeatures, maxCantrips, maxSpellsLvl1, maxExtraPassives]);

  const toggleSpell = (id: string) => {
    const spell = availableSpells.find(s => s.id.toString() === id);
    if (!spell) return;

    if (lockedFeatures.includes(spell.name)) {
      showCustomAlert("Bloqueado", "Esta habilidade é inata da sua Raça/Classe e não pode ser removida.");
      return;
    }
    
    const sCat = getCategory(spell);
    const isSelecting = !selectedSpells.includes(id);
    
    if (isSelecting) {
      if (sCat === 'Passiva' || sCat === 'Habilidade') {
        const passivesCount = selectedSpells.filter(sId => {
          const sp = availableSpells.find(s => s.id.toString() === sId);
          return sp && (getCategory(sp) === 'Passiva' || getCategory(sp) === 'Habilidade') && !lockedFeatures.includes(sp.name);
        }).length;
        
        if (passivesCount >= maxExtraPassives) {
          showCustomAlert("Limite de Passivas", `Sua classe te dá direito a selecionar ${maxExtraPassives} habilidade(s) extra(s) no Nível 1.`);
          return;
        }
      } else if (spell.level === 'Truque') {
        const cantripsCount = selectedSpells.filter(sId => {
          const sp = availableSpells.find(s => s.id.toString() === sId);
          return sp && getCategory(sp) === 'Magia' && sp.level === 'Truque';
        }).length;
        
        if (cantripsCount >= maxCantrips) {
          showCustomAlert("Limite de Truques", `Você pode escolher no máximo ${maxCantrips} Truques.`);
          return;
        }
      } else if (spell.level === 'Nível 1') {
        const level1Count = selectedSpells.filter(sId => {
          const sp = availableSpells.find(s => s.id.toString() === sId);
          return sp && getCategory(sp) === 'Magia' && sp.level === 'Nível 1';
        }).length;
        
        if (level1Count >= maxSpellsLvl1) {
          showCustomAlert("Limite de Magias", `Seu atributo permite apenas ${maxSpellsLvl1} magias de Nível 1.`);
          return;
        }
      }
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
          spells, spell_slots_used, equipment, gp, sp, cp,
          hp_max, hp_current, level, xp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, race, charClass, JSON.stringify(stats), profBonus, inspiration || '0', 
          JSON.stringify(proficiencies), JSON.stringify(activeSavesToSave), JSON.stringify(activeSkillsToSave), 
          personalityTraits, ideals, bonds, flaws, featuresTraits, backstory, alliesOrganizations, languages, 
          JSON.stringify(selectedSpells), '{}', JSON.stringify(cleanInventory), gp, sp, cp, hpMax, hpMax, 1, 0 
        ]
      );
      router.back();
    } catch (error) {}
  };

  // ================= RENDERIZAÇÕES =================

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
    return (
      <View style={styles.stepContainer}>
        <SpellSelector 
          visible={spellsModalVisible} 
          onClose={() => setSpellsModalVisible(false)}
          availableSpells={availableSpells}
          selectedSpellIds={selectedSpells}
          lockedFeatureNames={lockedFeatures}
          onToggleSpell={toggleSpell}
          counterText={
            [
              maxExtraPassives > 0 ? `Habilidades: ${selectedSpells.filter(sId => ['Passiva', 'Habilidade'].includes(getCategory(availableSpells.find(s => s.id.toString() === sId))) && !lockedFeatures.includes(availableSpells.find(s => s.id.toString() === sId)?.name || '')).length}/${maxExtraPassives}` : null,
              maxCantrips > 0 ? `Truques: ${selectedSpells.filter(sId => getCategory(availableSpells.find(s => s.id.toString() === sId)) === 'Magia' && availableSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length}/${maxCantrips}` : null,
              maxSpellsLvl1 > 0 ? `Magias: ${selectedSpells.filter(sId => getCategory(availableSpells.find(s => s.id.toString() === sId)) === 'Magia' && availableSpells.find(s => s.id.toString() === sId)?.level === 'Nível 1').length}/${maxSpellsLvl1}` : null
            ].filter(Boolean).join(' • ')
          }
          hintText={isCasterClass 
            ? `Sua classe permite a escolha de magias ativas e habilidades.` 
            : `Sua classe permite escolher habilidades e estilos de combate.`}
        />

        <View style={styles.statsHeader}>
          <Text style={styles.listTitle}>MAGIAS & HABILIDADES</Text>
        </View>
        <Text style={styles.hpHint}>Clique no botão abaixo para abrir o catálogo completo da sua classe e gerenciar suas magias e habilidades passivas.</Text>
        
        {availableSpells.length > 0 ? (
          <TouchableOpacity style={styles.manageSpellsBtn} onPress={() => setSpellsModalVisible(true)}>
            <Text style={styles.manageSpellsBtnText}>Abrir Catálogo de Classe</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.manageSpellsBtn, {backgroundColor: 'rgba(255,255,255,0.05)'}]}>
            <Text style={[styles.manageSpellsBtnText, {color: 'rgba(255,255,255,0.4)'}]}>Nenhuma habilidade adicional no Nível 1</Text>
          </View>
        )}
      </View>
    );
  };

  const renderStepEquipment = () => (
    <View style={styles.stepContainer}>
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
                    {item.target_type === 'bg3' && <Text style={[styles.customKitBadge, {color: '#ffd700', backgroundColor: 'rgba(255,215,0,0.1)'}]}>BG3 Origem</Text>}
                    {item.criador !== 'base' && item.target_type !== 'bg3' && <Text style={styles.customKitBadge}>Customizado</Text>}
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhum kit encontrado.</Text>}
            />
          </View>
        </Pressable>
      </Modal>

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

      {/* MODAL DE ALERTA CUSTOMIZADO */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={styles.modalOverlayCenter}>
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
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
  modalOverlayCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)', padding: 20 },
  modalContent: { backgroundColor: '#102b56', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: '#00bfff' },
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
  manageSpellsBtn: { backgroundColor: '#00bfff', padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  manageSpellsBtnText: { color: '#02112b', fontWeight: 'bold', fontSize: 14 },

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