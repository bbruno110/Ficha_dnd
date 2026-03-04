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
      },
      {
        name: "O Estudioso Místico",
        allowedClasses: ['Mago', 'Bruxo', 'Clérigo', 'Bardo', 'Druida'],
        traits: ['Fico instantaneamente fascinado com qualquer relíquia ou bugiganga arcana.', 'Tenho uma curiosidade perigosa, grande demais para o meu próprio bem.', 'Sempre tento mediar conflitos usando lógica e razão antes que virem violência desenfreada.'],
        ideals: ['Conhecimento. A verdade oculta está acima de qualquer poder temporal.', 'Destino. Meu caminho e minhas descobertas já foram traçados por forças maiores.', 'Equilíbrio. A magia da luz e as artes das trevas precisam coexistir para o mundo não ruir.', 'Iluminação. Todos merecem compartilhar o dom da sabedoria.'],
        bonds: ['Protejo um segredo ancestral que, se revelado, poderia iniciar uma guerra santa.', 'Devo lealdade irrestrita a uma ordem hermética que o povo acha que já não existe mais.', 'Fui salvo de uma maldição por uma entidade misteriosa e sinto que a ela devo a vida.'],
        flaws: ['Confio rápido demais em promessas intelectuais e charadas.', 'Frequentemente subestimo inimigos braçais que me parecem estúpidos ou fracos.', 'Fico incrivelmente paranoico quando sinto perturbações no tecido mágico local.', 'Posso sacrificar minha própria segurança por um livro raro.'],
        backstory: ['Eu era um arquivista de biblioteca que percebeu que ler sobre o mundo não era nada comparado a desvendá-lo pessoalmente.', 'Fui treinado arduamente em um mosteiro místico isolado no topo das montanhas.', 'Era aprendiz de um arquimago excêntrico que desapareceu subitamente sem deixar um único rastro físico.', 'Escapei por pouco de um culto sombrio tentando invocar coisas que não deveriam despertar.'],
        allies: ['Recebo permissões especiais em grandes bibliotecas e academias de magia.', 'Sou observado e ocasionalmente ajudado por um corvo familiar ou criatura feérica.', 'Sou membro de base de uma aliança secreta de arcanistas espalhados pelo continente.', 'Possuo um mestre ancião que envia mensagens mágicas enigmáticas de vez em quando.'],
        features: ['Possuo uma tatuagem mística ou cicatriz rúnica que formiga perto de magia intensa.', 'Minhas mãos são sempre frias ao toque, independentemente do clima escaldante.', 'Meus olhos mudam levemente de tonalidade quando eu conjuro ou concentro energia.'],
        extraLanguages: ['Celestial', 'Silvestre', 'Abissal', 'Proficiência com Ferramentas de Caligrafia']
      },
      {
        name: "O Nobre Vaidoso",
        allowedClasses: ['Bardo', 'Paladino', 'Feiticeiro', 'Guerreiro'],
        traits: ['Acredito veementemente que o dinheiro e a influência resolvem absolutamente qualquer problema.', 'Sou excessivamente educado, de forma condescendente, até com meus piores inimigos.', 'Adoro monopolizar a conversa com histórias exageradas sobre minhas proezas.', 'Detesto sujeira e reclamo frequentemente da falta de conforto.'],
        ideals: ['Poder. Eu farei o que for preciso para elevar o prestígio da minha linhagem.', 'Glória. Quero que meu nome seja eternizado em estátuas de mármore e canções épicas.', 'Noblesse Oblige. É meu dever guiar as massas não instruídas, pois sou superior.', 'Tradição. O sangue nobre e as antigas formas de governar existem por um excelente motivo.'],
        bonds: ['Guardo o anel de sinete da minha casa, a única prova do meu verdadeiro berço.', 'Jurei limpar o nome da minha família após um escândalo político arruinar nosso feudo.', 'Carrego comigo uma joia de valor inestimável que pertenceu à minha falecida mãe.'],
        flaws: ['No fundo, acredito que sou ontologicamente superior a todos que não têm berço de ouro.', 'Sou obcecado por aparências físicas, vestimentas luxuosas e culinária fina.', 'Tenho um medo paralisante de falhar, passar vergonha ou parecer fraco em público.', 'Suborno as pessoas impulsivamente em vez de lidar com os problemas.'],
        backstory: ['Nasci cercado de veludo e servos, mas um golpe de estado tirou tudo de mim, forçando-me a aventurar.', 'Descobri recentemente que sou o filho bastardo de um regente importantíssimo.', 'Entediei-me com a política letárgica da corte e fugi em busca de emoções reais no mundo sujo.', 'Fui deserdado por desonrar minha casa paterna e agora busco glória para esfregar na cara deles.'],
        allies: ['Ainda mantenho o favor de alguns cortesãos leais e servos saudosos do castelo.', 'Tenho amizade com comandantes da guarda real que outrora protegeram minha família.', 'Possuo crédito (e muitas dívidas) nos maiores bancos mercantis da capital central.', 'Sou apadrinhado à distância por um duque de reputação questionável.'],
        features: ['Tenho uma risada polida e inconfundível, acompanhada de um olhar de cima para baixo.', 'Meu sotaque denuncia imediatamente uma criação requintada e anos de tutores particulares.', 'Caminho com uma postura reta tão artificial que pareço carregar uma tábua nas costas.'],
        extraLanguages: ['Dracônico', 'Proficiência com Instrumentos de Sopro', 'Élfico (Alta Sociedade)', 'Proficiência com Ferramentas de Joalheiro']
      },
      {
        name: "O Forasteiro Selvagem",
        allowedClasses: ['Bárbaro', 'Druida', 'Patrulheiro'],
        traits: ['Sou profundamente supersticioso, interpretando o voo dos pássaros e o uivo dos lobos.', 'Sempre desconfio das invenções da "civilização" e durmo com um olho aberto em cidades.', 'Prefiro ficar em silêncio absoluto observando os arredores antes de abrir a boca.', 'Fico tenso em locais fechados ou multidões esmagadoras.'],
        ideals: ['Exploração. O mundo natural precisa ter seus cantos respeitados, não pavimentados.', 'Autossuficiência. Eu sou a minha própria arma; só posso depender do meu suor e sangue.', 'Harmonia Primordial. O ciclo de presa e predador é sagrado e não deve ser corrompido.', 'Liberdade. As paredes das cidades são apenas gaiolas enfeitadas com pedras.'],
        bonds: ['Meu clã foi dizimado por bestas, e jurei caçar até o último responsável na face da terra.', 'Sou o guardião ungido de um bosque ancestral que a civilização tenta invadir.', 'Tenho uma conexão empática inexplicável com um predador que me salvou na juventude.'],
        flaws: ['Tenho o hábito perturbador de guardar troféus macabros de minhas caçadas.', 'Sou impulsivo para a fúria se insultarem meus costumes ou a natureza ao meu redor.', 'Tenho pavor de magia necromântica e abominações que quebram o ciclo natural da vida.', 'Somo péssimo com etiquetas sociais e falo brutalmente o que me vem à cabeça.'],
        backstory: ['Sobrevivi sozinho na selva brutal por dez anos após me separar da minha tribo em uma tempestade.', 'Fui criado e moldado pelas feéricas profundas em uma floresta esquecida pelo tempo.', 'Era um rastreador de recompensas nas estepes congeladas do norte, acostumado ao sangue no gelo.', 'Nasci durante uma tempestade mística e meu povo sempre me viu como um avatar da fúria elemental.'],
        allies: ['Não tenho senhores; minha aliança primária é com a própria terra e as feras locais.', 'Sou respeitado e temido por tribos nômades que conhecem meu nome de caça.', 'Uma cabala de druidas eremitas ocasionalmente me fornece ervas e direção.', 'Tenho passe-livre em territórios controlados por centauros e outros povos silvestres.'],
        features: ['Tenho um senso de direção magnético; quase nunca me perco sob céu aberto.', 'Consigo imitar perfeitamente o som de alarme de pássaros e ganidos de lobos.', 'Sinto o cheiro metálico de chuva e o ozônio de tempestades horas antes delas caírem.', 'A maioria dos animais domésticos parece se intimidar ou reverenciar minha presença física.'],
        extraLanguages: ['Silvestre', 'Primordial', 'Proficiência com Instrumentos de Percussão', 'Proficiência em Kit de Herbalismo']
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
    
    if (Math.random() < 0.12) {
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
          
          // CONVERSÃO DE STRING OBRIGATÓRIA PARA O TEXTINPUT NÃO BUBAR!
          setStats({
            FOR: String(companion.stats.FOR), 
            DES: String(companion.stats.DES), 
            CON: String(companion.stats.CON),
            INT: String(companion.stats.INT), 
            SAB: String(companion.stats.SAB), 
            CAR: String(companion.stats.CAR),
          });

          const totalCompStats = Object.values(companion.stats).reduce((acc: number, val: any) => acc + parseInt(val as string), 0);
          setMaxStatsSum(totalCompStats > 72 ? totalCompStats : 72);

          setPersonalityTraits(companion.personality); setIdeals(companion.ideals); setBonds(companion.bonds);
          setFlaws(companion.flaws); setBackstory(companion.backstory); setAlliesOrganizations(companion.allies);
          
          // --- DICIONÁRIO DE LORE DOS COMPANHEIROS BG3 ---
          const bg3Extras: Record<string, { langs: string, traits: string }> = {
            'Astarion': {
              langs: 'Comum, Élfico, Subcomum.\nProficiência: Ferramentas de Ladrão, Kit de Disfarce.',
              traits: 'Vampiro Gerado: Não envelhece, precisa de sangue para sustento. Resiste ao sol graças ao parasita ilitide. Possui cicatrizes infernais nas costas.'
            },
            'Lae\'zel': {
              langs: 'Comum, Gith.\nProficiência: Navegação Astral.',
              traits: 'Treinamento Militar da Creche K\'liir: Conhecimento tático sobre devoradores de mentes. Foco militar implacável e parasita adormecido.'
            },
            'Gale': {
              langs: 'Comum, Élfico, Dracônico, Celestial.\nProficiência: Tabuleiros de Xadrez de Lança.',
              traits: 'Prodígio de Waterdeep: Carrega um fragmento corrompido da Trama Netheresa no peito (Orbe) que exige consumo de magia. Mantém tara, uma tressym, como familiar.'
            },
            'Shadowheart': {
              langs: 'Comum, Élfico.\nProficiência: Kit de Venenos, Ferramentas de Ladrão.',
              traits: 'Agente de Shar: Memórias seladas voluntariamente para proteger os segredos do claustro. Possui uma marca mágica na mão que ocasionalmente causa intensa dor.'
            },
            'Umbralma': {
              langs: 'Comum, Élfico.\nProficiência: Kit de Venenos, Ferramentas de Ladrão.',
              traits: 'Agente de Shar: Memórias seladas voluntariamente para proteger os segredos do claustro. Possui uma marca mágica na mão que ocasionalmente causa intensa dor.'
            },
            'Karlach': {
              langs: 'Comum, Infernal.\nProficiência: Veículos terrestres (Máquinas de Avernus).',
              traits: 'Motor Infernal: O coração foi substituído por um motor de Zariel que queima com o calor do inferno. Impossibilitada de tocar as pessoas sem queimá-las no plano material.'
            },
            'Wyll': {
              langs: 'Comum, Infernal.\nProficiência: Jogos de Cartas e Dados.',
              traits: 'A Lâmina da Fronteira: Fama como caçador de monstros heroico. Possui um olho de envio de pedra que pertence à sua patrona demônio, Mizora.'
            },
            'Halsin': {
              langs: 'Comum, Élfico, Silvestre, Primordial.\nProficiência: Kit de Herbalismo.',
              traits: 'Ancião do Bosque: Porte físico colossal de urso. Conhecimento ancestral sobre rituais da natureza e sobre a Maldição das Sombras que aflige as terras de Ketheric.'
            },
            'Jaheira': {
              langs: 'Comum, Élfico, Silvestre.\nProficiência: Kit de Venenos, Ferramentas de Navegação.',
              traits: 'Alto Harpista: Lidera uma rede de espiões e informantes. Possui conhecimento tático de séculos atrás e guarda em sua casa relíquias de aventuras passadas.'
            },
            'Minsc': {
              langs: 'Comum.\nProficiência: Nenhuma em especial, mas Boo compensa.',
              traits: 'Herói de Rashemen: Possui uma força de vontade e fúria indomáveis. Sempre acompanhado por Boo, seu fiel Hamster Espacial Gigante em Miniatura, a quem pede conselhos.'
            }
          };

          const extras = bg3Extras[companion.short_name] || bg3Extras[companion.name] || {
            langs: 'Comum e idiomas raciais associados.',
            traits: 'Sobrevivente do Nautiloide Ilitide. Carrega um parasita no cérebro.'
          };

          setFeaturesTraits(extras.traits);
          setLanguages(extras.langs);
          setGp(matchedClass.starting_gold || 100);

          await setupCharacterExtras(matchedRace, matchedClass, companion, companion.stats);
        }
      } catch (error) { console.error("Erro ao buscar companheiros de origem:", error); }
    } else {
      const randRace = dbRaces[Math.floor(Math.random() * dbRaces.length)];
      const randClass = dbClasses[Math.floor(Math.random() * dbClasses.length)];
      setRace(randRace.name); setCharClass(randClass.name); setAllowedOriginFeature(null);

      const maleNames = ['Bruno', 'João', 'Pedro', 'Bentinho', 'Tiago', 'Rafael', 'Kaelen', 'Thorin', 'Silas', 'Bram', 'Dorian', 'Faelan', 'Gael', 'Orion', 'Beren', 'Nícolas', 'Zoltan', 'Vagner', 'Rurik', 'Luiz', 'Gustavo', 'Leonardo', 'Matheus', 'Felipe', 'Wilker', 'Dante', 'Vítor', 'Enzo', 'Ramon', 'Aldric', 'Cedric', 'Theron', 'Kael', 'Edrin', 'Lucan', 'Magnus', 'Hadrian', 'Alaric', 'Tiberius', 'Cassian', 'Rowan', 'Darion', 'Valen', 'Arthos', 'Kieran', 'Ulric', 'Fenris', 'Maelor', 'Talon', 'Aeron', 'Gareth', 'Eamon', 'Soren', 'Draven'];
      const femaleNames = ['Karoline', 'Maria', 'Ana', 'Beatriz', 'Mariana', 'Amanda', 'Lyra', 'Elara', 'Ilyana', 'Ayla', 'Morgana', 'Bianca', 'Catarine', 'Fernanda', 'Isabela', 'Sofia', 'Camila', 'Larissa', 'Yanaele', 'Evelyn', 'Alícia', 'Lívia', 'Giovanna', 'Carla', 'Júlia', 'Seraphine', 'Nyx', 'Thalia', 'Isolde', 'Rhiannon', 'Selene', 'Freya', 'Arwen', 'Kaelis', 'Vespera', 'Aurora', 'Elysia', 'Maeryn', 'Zara', 'Lyanna', 'Ophelia', 'Kallista', 'Ysolda', 'Miriel', 'Aerin', 'Velanna', 'Lunara', 'Sylphie'];
      const isMale = Math.random() > 0.5;
      const randomFirstName = isMale ? maleNames[Math.floor(Math.random() * maleNames.length)] : femaleNames[Math.floor(Math.random() * femaleNames.length)];

      const classTitles: Record<string, string[]> = {
        'Bárbaro': isMale ? ['o Bárbaro', 'o Implacável', 'o Feroz', 'o Quebra-Crânios'] : ['a Bárbara', 'a Implacável', 'a Feroz', 'a Quebra-Crânios'],
        'Bardo': isMale ? ['o Bardo', 'o Cancioneiro', 'o Galante', 'Voz-de-Ouro'] : ['a Barda', 'a Cancioneira', 'a Galante', 'Voz-de-Ouro'],
        'Bruxo': isMale ? ['o Bruxo', 'o Amaldiçoado', 'o Ocultista', 'Corta-Sombras'] : ['a Bruxa', 'a Amaldiçoada', 'a Ocultista', 'Corta-Sombras'],
        'Clérigo': isMale ? ['o Clérigo', 'o Devoto', 'o Curandeiro', 'Luz-Divina', 'Bicuda Santa', 'Bazuca Celestial'] : ['a Clériga', 'a Devota', 'a Curandeira', 'Luz-Divina', 'Bicuda Santa', 'Bazuca Celestial'],
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
        ? [
            'de Tal', 'Sem-Teto', 'da Taberna', 'o Azarado', 'o Magnífico', 
            'meio Tan Tan', 'o Errante', 'o Imortal', 'o Inquebrável', 'o Destemido', 
            'o Caído', 'o Renascido', 'Sangue-de-Ferro', 'Sussurro-da-Noite', 
            'Punho-Sombrio', 'Lâmina-Veloz', 'de Rívia', 'Universitário', 'Pedra de tropeço', 'Batutinha'
          ] 
        : [
            'de Tal', 'Sem-Teto', 'da Taberna', 'a Azarada', 'a Magnífica', 
            'meio Tan Tan', 'a Errante', 'a Imortal', 'a Inquebrável', 'a Destemida', 
            'a Caída', 'a Renascida', 'Sangue-de-Ferro', 'Sussurro-da-Noite', 
            'Punho-Sombrio', 'Lâmina-Veloz', 'de Rívia', 'Universitária', 'Pedra de tropeço', 'Batutinha'
          ];

      const validTitles = [...(classTitles[randClass.name] || []), ...genericTitles];
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
          if (sCat === 'Magia') {
             if (s.level === 'Truque' && maxCantrips <= 0) return false;
             if (s.level === 'Nível 1' && maxSpellsLvl1 <= 0) return false;
             if (s.level !== 'Truque' && s.level !== 'Nível 1') return false;
          }

          // Se for Habilidade ou Passiva extra (ex: Estilo de Luta): Bloqueia se o pré-requisito for maior que 1.
          if (sCat === 'Habilidade' || sCat === 'Passiva') {
             if (maxExtraPassives <= 0) return false;
             if (s.class_level_required) {
                const reqLvl = parseInt(String(s.class_level_required), 10) || 1;
                if (reqLvl > 1) return false;
             }
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