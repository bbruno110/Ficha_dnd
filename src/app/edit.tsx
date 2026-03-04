// ================= IMPORTAÇÕES DA CAMADA BÁSICA =================
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// IMPORTAÇÃO DO NOVO COMPONENTE (Ajuste o caminho se necessário)
import SpellSelector from '../components/SpellSelector';

// ADICIONADO O NOVO PASSO DE RESUMO FINAL
const STEPS = ['Níveis & Vida', 'Atributos', 'Proficiências', 'Magias & Hab.', 'Resumo Final'];

type ClassEntry = { id: string; name: string; subclass: string; level: number };
type SpellProgression = { cantrips_known: number, spells_known: number, slot_1: number, slot_2: number, slot_3: number, slot_4: number, slot_5: number, slot_6: number, slot_7: number, slot_8: number, slot_9: number };

// Tabela Padrão de Nível de Magia vs Nível de Classe de Conjurador Total (D&D 5e)
const getHighestSpellLevelAllowed = (casterLevel: number) => {
  if (casterLevel < 1) return -1;
  return Math.ceil(casterLevel / 2);
};

const getSpellLevelNumber = (levelStr: string) => {
  if (levelStr.toLowerCase() === 'truque') return 0;
  if (levelStr === 'Classe' || levelStr === 'Manobra' || levelStr === 'Passiva') return -1; 
  const match = levelStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 99;
};

// Força a categoria para os contadores não quebrarem
const getCategory = (spell: any): string => {
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

// Lista de Habilidades base das Classes para serem tratadas como Passivas (Não gastam limite de feitiços normais)
const BASE_CLASS_FEATURES = [
  "Fúria", "Defesa Sem Armadura", "Segundo Fôlego", "Imposição das Mãos", "Sentido Divino", "Inimigo Favorito", "Explorador Nato", "Ataque Extra", "Ação Surto"
];

export default function EditCharacterScreen() {
  const { id, levelUpTo } = useLocalSearchParams();
  const router = useRouter();
  const db = useSQLiteContext();

  const [loading, setLoading] = useState(true);
  const [character, setCharacter] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(0);
  
  const [dbSkills, setDbSkills] = useState<any[]>([]);
  const [dbSaves, setDbSaves] = useState<any[]>([]);
  const [dbSpells, setDbSpells] = useState<any[]>([]);
  const [dbClasses, setDbClasses] = useState<any[]>([]);
  const [dbSubclasses, setDbSubclasses] = useState<any[]>([]);
  const [dbRaces, setDbRaces] = useState<any[]>([]); 

  const [targetLevel, setTargetLevel] = useState(1);
  const [hpIncrease, setHpIncrease] = useState('');

  const [classesData, setClassesData] = useState<ClassEntry[]>([]);
  const [originalClassesData, setOriginalClassesData] = useState<ClassEntry[]>([]);
  
  const [originalStatsTotal, setOriginalStatsTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({ FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 });
  const [tempMods, setTempMods] = useState<Record<string, number>>({});
  const [extraPoints, setExtraPoints] = useState(0);
  
  const [activeSaves, setActiveSaves] = useState<string[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [originalSkills, setOriginalSkills] = useState<string[]>([]);

  const [maxSavesAllowed, setMaxSavesAllowed] = useState(2);
  const [maxSkillsAllowed, setMaxSkillsAllowed] = useState(4);
  const [maxExpertiseAllowed, setMaxExpertiseAllowed] = useState(0);

  const [activeSpells, setActiveSpells] = useState<string[]>([]);
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([]); 

  // Limites Mágicos
  const [maxCantrips, setMaxCantrips] = useState(0);
  const [maxSpellsAllowed, setMaxSpellsAllowed] = useState(0);
  const [maxSpellLevelAllowed, setMaxSpellLevelAllowed] = useState(0);
  
  const [totalCasterLevel, setTotalCasterLevel] = useState(0);

  const [spellsModalVisible, setSpellsModalVisible] = useState(false);
  const [multiClassModalVisible, setMultiClassModalVisible] = useState(false);

  const parseClassString = (classStr: string, fallbackLevel: number): ClassEntry[] => {
    if (!classStr) return [];
    const parts = classStr.split(' / ');
    const parsed = parts.map(part => {
      let name = part.trim();
      let subclass = '';
      let level = 0;
      const subMatch = name.match(/\((.*?)\)/);
      if (subMatch) {
        subclass = subMatch[1];
        name = name.replace(`(${subclass})`, '').trim();
      }
      const levelMatch = name.match(/\s(\d+)$/);
      if (levelMatch) {
        level = parseInt(levelMatch[1], 10);
        name = name.replace(levelMatch[0], '').trim();
      }
      return { id: Math.random().toString(), name, subclass, level };
    });
    if (parsed.length === 1 && parsed[0].level === 0) parsed[0].level = fallbackLevel;
    return parsed;
  };

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const char = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        setDbSkills(await db.getAllAsync(`SELECT * FROM skills ORDER BY name ASC`));
        setDbSaves(await db.getAllAsync(`SELECT * FROM saving_throws ORDER BY name ASC`));
        setDbSpells(await db.getAllAsync(`SELECT * FROM spells ORDER BY level, name ASC`));
        setDbSubclasses(await db.getAllAsync(`SELECT * FROM subclasses ORDER BY level_required ASC`));
        setDbClasses(await db.getAllAsync(`SELECT * FROM classes ORDER BY name ASC`));
        setDbRaces(await db.getAllAsync(`SELECT * FROM races ORDER BY name ASC`));

        if (char) {
          setCharacter(char);
          const tLevel = levelUpTo ? Number(levelUpTo) : (char as any).level;
          setTargetLevel(tLevel);
          
          const parsedClasses = parseClassString((char as any).class, (char as any).level);
          setClassesData(parsedClasses);
          setOriginalClassesData(JSON.parse(JSON.stringify(parsedClasses)));
          
          const parsedStats = JSON.parse((char as any).stats || '{}');
          const { temp_mods, extra_points, ...baseStats } = parsedStats;
          const safeBaseStats = {
            FOR: Number(baseStats.FOR) || 10, DES: Number(baseStats.DES) || 10,
            CON: Number(baseStats.CON) || 10, INT: Number(baseStats.INT) || 10,
            SAB: Number(baseStats.SAB) || 10, CAR: Number(baseStats.CAR) || 10,
          };
          setStats(safeBaseStats);
          setTempMods(temp_mods || {});
          setExtraPoints(Number(extra_points) || 0);
          setOriginalStatsTotal(Object.values(safeBaseStats).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number);

          const parseArray = (val: string) => { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } };

          setActiveSaves(parseArray((char as any).save_values));
          
          const parsedSkillsArray = parseArray((char as any).skill_values);
          setActiveSkills(parsedSkillsArray);
          setOriginalSkills(parsedSkillsArray);
          
          setActiveSpells(parseArray((char as any).spells).map(String));
        }
      } catch (e) { console.error(e); } finally { setLoading(false); }
    }
    loadData();
  }, [id]);

  useEffect(() => {
    if (!character || dbRaces.length === 0 || dbClasses.length === 0) return;

    let rFeats: string[] = [];
    let cFeats: string[] = [];

    const currentRace = dbRaces.find(r => r.name === character.race);
    try { if (currentRace && currentRace.features) rFeats = JSON.parse(currentRace.features); } catch(e){}

    classesData.forEach(cls => {
      if (cls.level > 0) {
        const currentClass = dbClasses.find(c => c.name === cls.name);
        try { if (currentClass && currentClass.features) cFeats.push(...JSON.parse(currentClass.features)); } catch(e){}
        
        if (cls.subclass) {
          const currentSub = dbSubclasses.find(s => s.name === cls.subclass && s.class_name === cls.name);
          try { if (currentSub && currentSub.features) cFeats.push(...JSON.parse(currentSub.features)); } catch(e){}
        }
      }
    });

    if (character.race === 'Githyanki' && !rFeats.includes('Mãos Mágicas (Githyanki)')) rFeats.push('Mãos Mágicas (Githyanki)');

    setLockedFeatures(Array.from(new Set([...rFeats, ...cFeats])));
  }, [character, classesData, dbRaces, dbClasses, dbSubclasses]);

  useEffect(() => {
    async function updateMagicLimits() {
      if (!character || classesData.length === 0) return;

      let calcCantrips = 0;
      let highestSlot = 0;
      let calcSpellsKnown = 0;

      try {
        const raceProg = await db.getFirstAsync<SpellProgression>(
          `SELECT cantrips_known FROM spellcasting_progression WHERE source_type = 'race' AND source_name = ? AND level = 1`, 
          [character.race]
        );
        if (raceProg) calcCantrips += raceProg.cantrips_known || 0;
      } catch(e) {}

      for (const cls of classesData) {
        if (cls.level <= 0) continue;
        const dbClassObj = dbClasses.find(c => c.name === cls.name);

        try {
          const classProg = await db.getFirstAsync<SpellProgression>(
            `SELECT * FROM spellcasting_progression WHERE source_type = 'class' AND source_name = ? AND level = ?`, 
            [cls.name, cls.level]
          );

          if (classProg) {
            calcCantrips += classProg.cantrips_known || 0;
            
            if (classProg.spells_known > 0) {
              calcSpellsKnown += classProg.spells_known;
            } else if (dbClassObj?.is_caster || cls.name === 'Paladino') {
              const intMod = Math.floor((stats.INT - 10) / 2);
              const sabMod = Math.floor((stats.SAB - 10) / 2);
              const carMod = Math.floor((stats.CAR - 10) / 2);
              
              let mod = 0;
              if (cls.name === 'Mago') mod = intMod;
              else if (cls.name === 'Clérigo' || cls.name === 'Druida') mod = sabMod;
              else if (cls.name === 'Paladino') mod = carMod;

              const prepLevel = cls.name === 'Paladino' ? Math.floor(cls.level / 2) : cls.level;
              calcSpellsKnown += Math.max(prepLevel + mod, 1);
            }

            const slots = [classProg.slot_1, classProg.slot_2, classProg.slot_3, classProg.slot_4, classProg.slot_5, classProg.slot_6, classProg.slot_7, classProg.slot_8, classProg.slot_9];
            for (let i = 0; i < slots.length; i++) {
              if (slots[i] > 0 && (i + 1) > highestSlot) highestSlot = i + 1;
            }
          }

          if (cls.subclass) {
             const subProg = await db.getFirstAsync<SpellProgression>(
              `SELECT * FROM spellcasting_progression WHERE source_type = 'subclass' AND source_name = ? AND level = ?`, 
              [cls.subclass, cls.level]
            );
            if (subProg) {
              calcCantrips += subProg.cantrips_known || 0;
              if (subProg.spells_known > 0) calcSpellsKnown += subProg.spells_known;

              const subSlots = [subProg.slot_1, subProg.slot_2, subProg.slot_3, subProg.slot_4, subProg.slot_5, subProg.slot_6, subProg.slot_7, subProg.slot_8, subProg.slot_9];
              for (let i = 0; i < subSlots.length; i++) {
                if (subSlots[i] > 0 && (i + 1) > highestSlot) highestSlot = i + 1;
              }
            }
          }
        } catch(e) {}
      }

      setMaxCantrips(calcCantrips);
      setMaxSpellLevelAllowed(highestSlot);
      setMaxSpellsAllowed(calcSpellsKnown);
    }
    updateMagicLimits();
  }, [classesData, character, stats, targetLevel]);

  useEffect(() => {
    if (!character) return;
    let calcSkills = 4;
    let calcExpertise = 0;

    if (character.race === 'Meio-Elfo') calcSkills += 2;
    if (character.race === 'Elfo' || character.race === 'Meio-Orc') calcSkills += 1;

    if (classesData.length > 0) {
      const first = classesData[0].name;
      if (first === 'Ladino') { calcSkills += 2; calcExpertise += 2; }
      else if (first === 'Bardo') { calcSkills += 1; calcExpertise += 2; }
      else if (first === 'Patrulheiro') calcSkills += 1;

      for (let i = 1; i < classesData.length; i++) {
        const mc = classesData[i].name;
        if (['Ladino', 'Bardo', 'Patrulheiro'].includes(mc)) calcSkills += 1;
      }

      const ladinoLevel = classesData.find(c => c.name === 'Ladino')?.level || 0;
      if (ladinoLevel >= 6) calcExpertise += 2;

      const bardoLevel = classesData.find(c => c.name === 'Bardo')?.level || 0;
      if (bardoLevel >= 10) calcExpertise += 2;

      classesData.forEach(cData => {
        if (cData.subclass) {
          const subObj = dbSubclasses.find(s => s.name === cData.subclass);
          if (subObj && subObj.bonus_skills) {
            calcSkills += Number(subObj.bonus_skills);
          }
        }
      });
    }

    setMaxSkillsAllowed(calcSkills);
    setMaxExpertiseAllowed(calcExpertise);
  }, [classesData, character, dbSubclasses]);

  const currentLevelSum = classesData.reduce((acc, c) => acc + c.level, 0);
  const conMod = Math.floor((stats.CON - 10) / 2);
  const profBonusNum = Math.ceil(targetLevel / 4) + 1; 

  let recommendedHpGain = 0;
  let asisGained = 0;
  let tCasterLvl = 0;
  let passivesLvlCount = 0;

  let activeClassNames = classesData.filter(c => c.level > 0).map(c => c.name);
  if (classesData.some(c => c.subclass === 'Cavaleiro Arcano' || c.subclass === 'Trapaceiro Arcano')) {
      if (!activeClassNames.includes('Mago')) activeClassNames.push('Mago');
  }

  classesData.forEach(newClass => {
    const oldClass = originalClassesData.find(c => c.name === newClass.name);
    const oldLevel = oldClass ? oldClass.level : 0;
    const levelsGained = newClass.level - oldLevel;
    
    const dbClassObj = dbClasses.find(c => c.name === newClass.name);
    
    if (dbClassObj?.is_caster) {
        tCasterLvl += newClass.level;
    } else if (newClass.subclass === 'Cavaleiro Arcano' || newClass.subclass === 'Trapaceiro Arcano') {
        tCasterLvl += Math.ceil(newClass.level / 3);
    } else if (newClass.name === 'Paladino' || newClass.name === 'Patrulheiro') {
        tCasterLvl += Math.floor(newClass.level / 2);
    }

    if (levelsGained > 0) {
      const hitDie = dbClassObj?.hit_dice || 8;
      const avgHp = Math.floor(hitDie / 2) + 1;
      recommendedHpGain += levelsGained * (avgHp + conMod);
    }

    let thresholds = [4, 8, 12, 16, 19];
    if (newClass.name === 'Guerreiro') thresholds = [4, 6, 8, 12, 14, 16, 19];
    if (newClass.name === 'Ladino') thresholds = [4, 8, 10, 12, 16, 19];

    thresholds.forEach(t => {
      if (oldLevel < t && newClass.level >= t) asisGained++;
    });

    if (newClass.name === 'Guerreiro') passivesLvlCount += 1;
  });

  if (totalCasterLevel !== tCasterLvl) setTotalCasterLevel(tCasterLvl);
  if (recommendedHpGain <= 0 && targetLevel > character?.level) recommendedHpGain = Math.max(1, conMod);

  const pointsGained = asisGained * 2;
  const currentTotal = Object.values(stats).reduce((a, b) => Number(a) + Number(b), 0);
  const maxAllowedStats = originalStatsTotal + pointsGained;

  const MAX_PASSIVES = lockedFeatures.length + passivesLvlCount;

  const isPassiveItem = (s?: any) => {
    if (!s) return false;
    return lockedFeatures.includes(s.name) || 
           s.category === 'Passiva' || 
           s.category === 'Habilidade' || 
           BASE_CLASS_FEATURES.includes(s.name) || 
           BG3_ORIGIN_FEATURES.includes(s.name);
  };

  const changeClassLevel = (id: string, delta: number) => {
    setClassesData(prev => prev.map(c => {
      if (c.id === id) {
        const newLevel = c.level + delta;
        if (newLevel < 0) return c;
        if (currentLevelSum + delta > targetLevel) return c; 
        return { ...c, level: newLevel };
      }
      return c;
    }));
  };

  const setClassSubclass = (id: string, sub: string) => setClassesData(prev => prev.map(c => c.id === id ? { ...c, subclass: sub } : c));
  const removeClass = (id: string) => setClassesData(prev => prev.filter(c => c.id !== id));

  const adjustStat = (name: string, delta: number) => {
    const newVal = Number(stats[name]) + delta;
    if (newVal < 8 || newVal > 20) return;
    if (delta > 0 && currentTotal >= maxAllowedStats) {
      Alert.alert("Limite Atingido", `Seu limite total é ${maxAllowedStats}. Diminua outro atributo para redistribuir.`);
      return;
    }
    setStats(prev => ({ ...prev, [name]: newVal }));
  };

  const toggleSave = (saveId: string) => {
    if (activeSaves.includes(saveId)) setActiveSaves(prev => prev.filter(i => i !== saveId));
    else {
      if (activeSaves.length >= maxSavesAllowed) { Alert.alert("Limite", `Você já marcou ${maxSavesAllowed} resistências.`); return; }
      setActiveSaves(prev => [...prev, saveId]);
    }
  };

  const toggleSkill = (skillId: string) => {
    const occurrences = activeSkills.filter(i => i === skillId).length;
    const uniqueSkillsCount = new Set(activeSkills).size; 
    const currentExpertiseCount = activeSkills.length - uniqueSkillsCount;
    const isOriginalProficiency = originalSkills.includes(skillId); 

    if (occurrences === 0) {
      if (uniqueSkillsCount >= maxSkillsAllowed) {
        Alert.alert("Limite Atingido", `Você só pode ter proficiência em ${maxSkillsAllowed} perícias.`); return;
      }
      setActiveSkills(prev => [...prev, skillId]);
    } 
    else if (occurrences === 1) {
      if (isOriginalProficiency && maxExpertiseAllowed > 0 && currentExpertiseCount < maxExpertiseAllowed) {
        setActiveSkills(prev => [...prev, skillId]); 
      } else {
        setActiveSkills(prev => prev.filter(i => i !== skillId));
      }
    } 
    else {
      setActiveSkills(prev => prev.filter(i => i !== skillId));
    }
  };

  const toggleSpell = (spellId: string) => {
    const spell = dbSpells.find(s => s.id.toString() === spellId);
    if (!spell) return;

    if (lockedFeatures.includes(spell.name)) {
      Alert.alert("Bloqueado", "Esta habilidade é inata da sua Raça/Classe e não pode ser removida.");
      return;
    }

    const cat = getCategory(spell);
    const isSelecting = !activeSpells.includes(spellId);
    
    if (isSelecting) {
      if (cat === 'Passiva' || cat === 'Habilidade') {
        const passivesCount = activeSpells.filter(sId => {
          const sp = dbSpells.find(dbS => dbS.id.toString() === sId);
          return sp && (getCategory(sp) === 'Passiva' || getCategory(sp) === 'Habilidade') && !lockedFeatures.includes(sp.name);
        }).length;

        if (passivesCount >= passivesLvlCount) {
          Alert.alert("Limite de Passivas", `Sua classe te dá direito a ${passivesLvlCount} habilidades extras selecionáveis.`);
          return;
        }
      } else if (spell.level === 'Truque') {
        const currentCantrips = activeSpells.filter(sId => {
          const sp = dbSpells.find(dbS => dbS.id.toString() === sId);
          return sp && getCategory(sp) === 'Magia' && sp.level === 'Truque';
        }).length;

        if (currentCantrips >= maxCantrips) {
          Alert.alert("Limite de Truques", `Você pode escolher no máximo ${maxCantrips} Truques no momento.`);
          return;
        }
      } else {
        const currentSpells = activeSpells.filter(sId => {
          const sp = dbSpells.find(dbS => dbS.id.toString() === sId);
          return sp && getCategory(sp) === 'Magia' && sp.level !== 'Truque';
        }).length;

        if (maxSpellsAllowed <= 0) {
          Alert.alert("Classe não mágica", "Sua classe não permite a escolha de magias ativas, apenas passivas.");
          return;
        }

        if (currentSpells >= maxSpellsAllowed) {
          Alert.alert("Limite Atingido", `Seu intelecto atual permite apenas ${maxSpellsAllowed} magias preparadas.`);
          return;
        }
      }
    }
    setActiveSpells(prev => isSelecting ? [...prev, spellId] : prev.filter(i => i !== spellId));
  };

  const goToNextStep = () => {
    if (currentStep === 0 && currentLevelSum !== targetLevel) {
      Alert.alert("Atenção", `Por favor, distribua exatamente ${targetLevel} níveis entre suas classes. Faltam ${targetLevel - currentLevelSum}.`);
      return;
    }
    setCurrentStep(prev => prev + 1);
  };

  const saveChanges = async () => {
    const finalClassStr = classesData
      .filter(c => c.level > 0)
      .map(c => `${c.name}${c.subclass ? ` (${c.subclass})` : ''} ${c.level}`)
      .join(' / ');

    const addedHp = parseInt(hpIncrease) || 0;
    const statsToSave = { ...stats, temp_mods: tempMods, extra_points: extraPoints };

    try {
      await db.runAsync(
        `UPDATE characters SET level=?, class=?, hp_max=?, hp_current=?, stats=?, save_values=?, skill_values=?, spells=? WHERE id=?`,
        [targetLevel, finalClassStr, character.hp_max + addedHp, character.hp_current + addedHp, JSON.stringify(statsToSave), JSON.stringify(activeSaves), JSON.stringify(activeSkills), JSON.stringify(activeSpells), character.id]
      );
      
      // CORREÇÃO: Em vez de criar uma Ficha nova e empilhar, apenas voltamos (pop) a tela atual!
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/'); // Fallback de segurança
      }
      
    } catch (e) { console.error("Erro ao salvar:", e); }
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00bfff" /></View>;

  const isLevelUp = character && targetLevel > character.level;

  // ================= RENDER PASSOS =================
  const renderStep0 = () => (
    <View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <Text style={styles.sectionTitle}>NÍVEIS DISTRIBUÍDOS</Text>
        <Text style={[styles.counterText, currentLevelSum === targetLevel && {backgroundColor: '#00fa9a', color: '#02112b'}]}>
          {currentLevelSum} / {targetLevel}
        </Text>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.hpHint}>Distribua seus níveis entre as classes com os botões (+) e (-).</Text>
        
        {classesData.map((cls) => {
          const dbClassObj = dbClasses.find(c => c.name === cls.name);
          const reqLvl = dbClassObj?.subclass_level || 3; 
          const classSubclasses = dbSubclasses.filter(sub => sub.class_name === cls.name);

          return (
            <View key={cls.id} style={styles.classManagerBox}>
              <View style={styles.classHeaderRow}>
                <TouchableOpacity onPress={() => removeClass(cls.id)}>
                   <Ionicons name="trash" size={20} color="rgba(255,100,100,0.5)" />
                </TouchableOpacity>
                <Text style={styles.classTitleName}>{cls.name}</Text>
                <View style={styles.qtyControl}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => changeClassLevel(cls.id, -1)}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <Text style={styles.qtyValue}>{cls.level}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => changeClassLevel(cls.id, 1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              </View>

              {cls.level >= reqLvl && classSubclasses.length > 0 && (
                <View style={styles.subclassGrid}>
                  {classSubclasses.map(sub => (
                    <TouchableOpacity key={sub.id} style={[styles.subclassBtn, cls.subclass === sub.name && styles.subclassBtnActive]} onPress={() => setClassSubclass(cls.id, sub.name)}>
                      <Text style={[styles.subclassBtnText, cls.subclass === sub.name && styles.subclassBtnTextActive]}>{sub.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <TouchableOpacity style={styles.multiclassBtn} onPress={() => setMultiClassModalVisible(true)}>
          <Text style={styles.multiclassBtnText}>+ Buscar Nova Classe no Banco</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Aumento de Vida (HP)</Text>
      <View style={styles.cardBlock}>
        <View style={styles.hpRow}>
          <View style={styles.hpInfoBox}><Text style={styles.hpLabel}>HP ATUAL</Text><Text style={styles.hpValue}>{character.hp_max}</Text></View>
          <Text style={styles.hpPlusIcon}>+</Text>
          <View style={styles.hpInputBox}>
            <Text style={styles.hpLabel}>NOVO HP (GANHO)</Text>
            <TextInput style={styles.hpInput} keyboardType="numeric" value={hpIncrease} onChangeText={setHpIncrease} placeholder="0" placeholderTextColor="#666" />
          </View>
        </View>

        {isLevelUp && (
          <View style={{marginTop: 20}}>
            <Text style={styles.hpHint}>Vida automática calculada usando a média dos dados de suas classes e sua Constituição (+{conMod}).</Text>
            <TouchableOpacity style={styles.recommendedBtn} onPress={() => setHpIncrease(Math.max(1, recommendedHpGain).toString())}>
              <Text style={styles.recommendedBtnText}>Usar Média Calculada: +{Math.max(1, recommendedHpGain)}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <Text style={styles.sectionTitle}>Atributos</Text>
        <Text style={[styles.counterText, currentTotal === maxAllowedStats && {backgroundColor: '#00fa9a', color: '#02112b'}]}>
          Usados: {currentTotal} / {maxAllowedStats}
        </Text>
      </View>

      <View style={styles.cardBlock}>
        {extraPoints > 0 && (
          <Text style={{color: '#00fa9a', fontSize: 12, textAlign: 'center', marginBottom: 15}}>
            ✨ Inclui +{extraPoints} ponto(s) de buffs permanentes de itens!
          </Text>
        )}

        {pointsGained > 0 ? (
          <View style={[styles.warningBox, {borderColor: '#00fa9a', backgroundColor: 'rgba(0, 250, 154, 0.1)'}]}>
            <Ionicons name="star" size={24} color="#00fa9a" />
            <Text style={[styles.warningText, {color: '#00fa9a'}]}>Seus níveis de classe te deram direito a <Text style={{fontWeight: 'bold'}}>+{pointsGained} pontos</Text> de atributo!</Text>
          </View>
        ) : (
          <View style={styles.warningBox}>
            <Ionicons name="swap-horizontal" size={24} color="#00bfff" />
            <Text style={styles.warningText}>Distribua seus pontos livremente diminuindo de um lugar para colocar em outro.</Text>
          </View>
        )}

        <View style={styles.statsGrid}>
          {Object.keys(stats).map(key => (
            <View key={key} style={styles.statEditorBox}>
              <Text style={styles.statLabel}>{key}</Text>
              <View style={styles.statControlRow}>
                <TouchableOpacity onPress={() => adjustStat(key, -1)} style={styles.statBtn}><Text style={styles.statBtnText}>-</Text></TouchableOpacity>
                <Text style={styles.statValText}>{stats[key]}</Text>
                <TouchableOpacity onPress={() => adjustStat(key, 1)} style={styles.statBtn}><Text style={styles.statBtnText}>+</Text></TouchableOpacity>
              </View>
              <Text style={styles.statModLabel}>Mod: {Math.floor((stats[key] - 10) / 2) >= 0 ? '+' : ''}{Math.floor((stats[key] - 10) / 2)}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  const renderStep2 = () => {
    const uniqueSkillsCount = new Set(activeSkills).size;
    const currentExpertiseCount = activeSkills.length - uniqueSkillsCount;

    return (
      <View>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
          <Text style={styles.sectionTitle}>PERÍCIAS</Text>
          <Text style={styles.counterText}>Prof: {uniqueSkillsCount}/{maxSkillsAllowed} | Esp: {currentExpertiseCount}/{maxExpertiseAllowed}</Text>
        </View>
        
        <Text style={[styles.hpHint, {marginBottom: 15, textAlign: 'left'}]}>
          1 Toque: <Text style={{color: '#00bfff'}}>Proficiência (+{profBonusNum})</Text>.{'\n'}
          {maxExpertiseAllowed > 0 && `2 Toques (apenas em perícias antigas): Especialidade (+${profBonusNum * 2}).`}
        </Text>
        
        <View style={styles.cardBlock}>
          <View style={styles.toggleGrid}>
            {dbSkills.map(skill => {
              const occurrences = activeSkills.filter(i => i === skill.id).length;
              const isProficient = occurrences === 1;
              const isExpertise = occurrences >= 2;
              
              const bV = stats[skill.stat] || 10;
              const tV = tempMods[skill.stat] || 0;
              const statMod = Math.floor(((bV + tV) - 10) / 2);
              
              let finalBonus = statMod;
              if (isProficient) finalBonus += profBonusNum;
              if (isExpertise) finalBonus += (profBonusNum * 2);

              return (
                <TouchableOpacity key={skill.id} 
                  style={[
                    styles.toggleBtn, 
                    isProficient && {backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff'},
                    isExpertise && {backgroundColor: 'rgba(0,250,154,0.2)', borderColor: '#00fa9a'}
                  ]} 
                  onPress={() => toggleSkill(skill.id)}
                >
                  <Text style={[styles.toggleBtnText, isProficient && {color: '#00bfff'}, isExpertise && {color: '#00fa9a'}]}>
                    {skill.name} <Text style={{fontWeight: 'bold'}}>({finalBonus >= 0 ? `+${finalBonus}` : finalBonus})</Text>
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ height: 20 }} />

        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
          <Text style={styles.sectionTitle}>RESISTÊNCIAS</Text>
          <Text style={styles.counterText}>Automático: {activeSaves.length}/{maxSavesAllowed}</Text>
        </View>
        <View style={styles.cardBlock}>
          <View style={styles.toggleGrid}>
            {dbSaves.map(save => {
              const bV = stats[save.stat] || 10;
              const tV = tempMods[save.stat] || 0;
              const statMod = Math.floor(((bV + tV) - 10) / 2);
              const isActive = activeSaves.includes(save.id);
              const finalBonus = statMod + (isActive ? profBonusNum : 0);

              return (
                <TouchableOpacity key={save.id} style={[styles.toggleBtn, isActive && styles.toggleBtnActive]} onPress={() => toggleSave(save.id)}>
                  <Text style={[styles.toggleBtnText, isActive && styles.toggleBtnTextActive]}>
                    {save.name} <Text style={{fontWeight: 'bold'}}>({finalBonus >= 0 ? `+${finalBonus}` : finalBonus})</Text>
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    );
  }

  const renderStep3 = () => {
    const passivesCount = activeSpells.filter(sId => {
      const sp = dbSpells.find(s => s.id.toString() === sId);
      return sp && (getCategory(sp) === 'Passiva' || getCategory(sp) === 'Habilidade') && !lockedFeatures.includes(sp.name);
    }).length;
    
    const cantripsCount = activeSpells.filter(sId => {
      const sp = dbSpells.find(dbS => dbS.id.toString() === sId);
      return sp && getCategory(sp) === 'Magia' && sp.level === 'Truque';
    }).length;

    const spellsCount = activeSpells.filter(sId => {
      const sp = dbSpells.find(dbS => dbS.id.toString() === sId);
      return sp && getCategory(sp) === 'Magia' && sp.level !== 'Truque';
    }).length;

    return (
      <View>
        <Text style={styles.sectionTitle}>HABILIDADES & MAGIAS</Text>
        <View style={styles.cardBlock}>
          <View style={styles.spellHeaderRow}>
            <Text style={{color: '#fff', fontSize: 13, textAlign: 'center', lineHeight: 22}}>
              {passivesLvlCount > 0 ? `Hab/Passivas: ` : ''}
              {passivesLvlCount > 0 && <Text style={{fontWeight: 'bold', color: passivesCount >= passivesLvlCount ? '#ff6666' : '#00fa9a'}}>{passivesCount}/{passivesLvlCount}</Text>}
              
              {maxCantrips > 0 && passivesLvlCount > 0 ? ' • ' : ''}
              
              {maxCantrips > 0 ? `Truques: ` : ''}
              {maxCantrips > 0 && <Text style={{fontWeight: 'bold', color: cantripsCount >= maxCantrips ? '#ff6666' : '#00fa9a'}}>{cantripsCount}/{maxCantrips}</Text>}
              
              {maxSpellsAllowed > 0 && (maxCantrips > 0 || passivesLvlCount > 0) ? ' • ' : ''}

              {maxSpellsAllowed > 0 ? `Magias: ` : ''}
              {maxSpellsAllowed > 0 && <Text style={{fontWeight: 'bold', color: spellsCount >= maxSpellsAllowed ? '#ff6666' : '#00bfff'}}>{spellsCount}/{maxSpellsAllowed}</Text>}
            </Text>
          </View>
          
          <Text style={[styles.hpHint, {marginBottom: 15, textAlign: 'left'}]}>
            {maxSpellsAllowed > 0 
              ? `Baseado no banco de dados, você pode aprender magias até o Nível ${maxSpellLevelAllowed}. Gerencie também suas passivas.` 
              : `Você pode gerenciar as Habilidades passivas e Manobras da sua classe aqui.`}
          </Text>
          
          <TouchableOpacity style={styles.manageSpellsBtn} onPress={() => setSpellsModalVisible(true)}>
            <Text style={styles.manageSpellsBtnText}>Abrir Catálogo de Classe</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderStep4 = () => {
    // Busca os dados das magias selecionadas para exibir no resumo
    const selectedSpellsData = activeSpells.map(sId => dbSpells.find(s => s.id.toString() === sId)).filter(Boolean);
    
    const passives = selectedSpellsData.filter(sp => getCategory(sp) === 'Passiva' || getCategory(sp) === 'Habilidade');
    const cantrips = selectedSpellsData.filter(sp => getCategory(sp) === 'Magia' && sp.level === 'Truque');
    const magias = selectedSpellsData.filter(sp => getCategory(sp) === 'Magia' && sp.level !== 'Truque');

    return (
      <View>
        <Text style={styles.sectionTitle}>RESUMO FINAL DA FICHA</Text>
        <View style={[styles.cardBlock, { borderColor: '#00fa9a', borderWidth: 1 }]}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Novo Nível:</Text>
            <Text style={styles.summaryValue}>{targetLevel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Nova Vida Máx:</Text>
            <Text style={[styles.summaryValue, {color: '#ff6666'}]}>{character.hp_max + (parseInt(hpIncrease) || 0)} PV</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Soma de Atributos:</Text>
            <Text style={styles.summaryValue}>{currentTotal}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Perícias Marcadas:</Text>
            <Text style={styles.summaryValue}>{activeSkills.length}</Text>
          </View>
        </View>

        {/* LISTA VISUAL DO QUE FOI ESCOLHIDO */}
        <Text style={styles.sectionTitle}>NOVOS PODERES SELECIONADOS</Text>
        <View style={styles.cardBlock}>
          {selectedSpellsData.length === 0 ? (
             <Text style={styles.hpHint}>Nenhuma habilidade ou magia extra selecionada.</Text>
          ) : (
            <ScrollView style={{maxHeight: 250}} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              
              {passives.length > 0 && (
                <View style={{marginBottom: 15}}>
                  <Text style={{color: '#00fa9a', fontSize: 12, fontWeight: 'bold', marginBottom: 5}}>HABILIDADES / PASSIVAS</Text>
                  {passives.map((p: any) => (
                    <View key={p.id} style={styles.summarySpellItem}>
                      <Text style={{color: '#fff', fontSize: 14}}>{p.name}</Text>
                      {lockedFeatures.includes(p.name) && <Ionicons name="lock-closed" size={14} color="#00fa9a" />}
                    </View>
                  ))}
                </View>
              )}

              {cantrips.length > 0 && (
                <View style={{marginBottom: 15}}>
                  <Text style={{color: '#00bfff', fontSize: 12, fontWeight: 'bold', marginBottom: 5}}>TRUQUES (NÍVEL 0)</Text>
                  {cantrips.map((c: any) => (
                    <View key={c.id} style={styles.summarySpellItem}>
                      <Text style={{color: '#fff', fontSize: 14}}>{c.name}</Text>
                    </View>
                  ))}
                </View>
              )}

              {magias.length > 0 && (
                <View>
                  <Text style={{color: '#ffd700', fontSize: 12, fontWeight: 'bold', marginBottom: 5}}>MAGIAS PREPARADAS</Text>
                  {magias.map((m: any) => (
                    <View key={m.id} style={styles.summarySpellItem}>
                      <Text style={{color: '#fff', fontSize: 14}}>{m.name}</Text>
                      <Text style={{color: 'rgba(255,255,255,0.4)', fontSize: 10}}>{m.level}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>

        <Text style={[styles.hpHint, {marginTop: 10}]}>
          Verifique se está tudo certo. Ao clicar em Salvar Ficha, suas escolhas serão aplicadas!
        </Text>
      </View>
    );
  }

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
        <View style={{alignItems: 'center'}}>
          <Text style={styles.topBarTitle}>{isLevelUp ? `EVOLUIR PERSONAGEM` : 'EDITAR FICHA'}</Text>
          <Text style={styles.stepIndicatorText}>{STEPS[currentStep]}</Text>
        </View>
        <View style={{width: 28}} />
      </View>

      <View style={styles.progressBarContainer}>
        {STEPS.map((_, idx) => (
          <View key={idx} style={[styles.progressSegment, idx <= currentStep && styles.progressSegmentActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {currentStep === 0 && renderStep0()}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        <View style={{height: 100}} />
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navBtn} disabled={currentStep === 0} onPress={() => setCurrentStep(prev => prev - 1)}><Text style={styles.navBtnText}>Voltar</Text></TouchableOpacity>
        {currentStep < 4 ? (
          <TouchableOpacity style={[styles.navBtn, styles.navBtnPrimary]} onPress={goToNextStep}><Text style={styles.navBtnPrimaryText}>Próximo</Text></TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.navBtn, styles.navBtnFinish]} onPress={saveChanges}><Text style={styles.navBtnFinishText}>Salvar Ficha</Text></TouchableOpacity>
        )}
      </View>

      {/* COMPONENTE DE SELEÇÃO DE MAGIAS */}
      <SpellSelector 
        visible={spellsModalVisible} 
        onClose={() => setSpellsModalVisible(false)}
        availableSpells={dbSpells.filter(s => {
          const sLvl = getSpellLevelNumber(s.level);
          const sCategory = getCategory(s);
          
          let isAllowedByLevel = false;

          if (sCategory === 'Magia') {
            isAllowedByLevel = s.level === 'Truque' || (maxSpellLevelAllowed > 0 && sLvl <= maxSpellLevelAllowed);
          } else {
            isAllowedByLevel = true;
          }

          const isCompatibleClass = lockedFeatures.includes(s.name) || activeClassNames.some(c => s.classes.includes(c)) || s.classes.includes('Raça');
          
          let reqPassed = true;
          if (s.class_level_required && !lockedFeatures.includes(s.name)) {
            const reqStr = String(s.class_level_required);
            const reqs = reqStr.split(',').map(r => r.trim());
            
            reqs.forEach(req => {
              if (req.includes(':')) {
                const [cName, cLevel] = req.split(':');
                if (cName && cLevel) {
                  const playerClassData = classesData.find(cd => cd.name === cName);
                  if (playerClassData && playerClassData.level < parseInt(cLevel)) {
                    reqPassed = false;
                  }
                }
              } else {
                 if (targetLevel < parseInt(req)) reqPassed = false;
              }
            });
          }

          return isAllowedByLevel && isCompatibleClass && reqPassed;
        })}
        selectedSpellIds={activeSpells}
        lockedFeatureNames={lockedFeatures}
        onToggleSpell={toggleSpell}
        counterText={
          [
            passivesLvlCount > 0 ? `P: ${activeSpells.filter(sId => isPassiveItem(dbSpells.find(s => s.id.toString() === sId)) && !lockedFeatures.includes(dbSpells.find(s => s.id.toString() === sId)?.name || '')).length}/${passivesLvlCount}` : null,
            maxCantrips > 0 ? `T: ${activeSpells.filter(sId => getCategory(dbSpells.find(s => s.id.toString() === sId)) === 'Magia' && dbSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length}/${maxCantrips}` : null,
            maxSpellsAllowed > 0 ? `M: ${activeSpells.filter(sId => getCategory(dbSpells.find(s => s.id.toString() === sId)) === 'Magia' && dbSpells.find(s => s.id.toString() === sId)?.level !== 'Truque').length}/${maxSpellsAllowed}` : null
          ].filter(Boolean).join(' • ')
        }
        hintText={maxSpellsAllowed > 0 
          ? `Você pode aprender magias até o Nível ${maxSpellLevelAllowed}. Gerencie também suas passivas.` 
          : `Você pode gerenciar as Habilidades passivas e Manobras da sua classe aqui.`}
      />

      {/* MODAL MULTICLASSE */}
      <Modal visible={multiClassModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContentFullScreen, {height: '50%'}]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adicionar Multiclasse</Text>
              <TouchableOpacity onPress={() => setMultiClassModalVisible(false)}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
            </View>
            <FlatList
              data={dbClasses.filter(c => !activeClassNames.includes(c.name))}
              keyExtractor={c => c.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.spellItemRow} onPress={() => { 
                  setClassesData([...classesData, { id: Math.random().toString(), name: item.name, subclass: '', level: 1 }]);
                  setMultiClassModalVisible(false); 
                }}>
                  <Text style={styles.spellItemName}>{item.name}</Text>
                  <Ionicons name="add-circle" size={24} color="#00fa9a" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#02112b' },
  topBar: { paddingTop: 50, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topBarTitle: { color: '#ffd700', fontSize: 16, fontWeight: 'bold' },
  stepIndicatorText: { color: '#fff', fontSize: 12 },
  progressBarContainer: { flexDirection: 'row', height: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  progressSegment: { flex: 1, backgroundColor: 'transparent' },
  progressSegmentActive: { backgroundColor: '#00bfff' },
  scrollContent: { padding: 20 },
  sectionTitle: { color: '#00bfff', fontWeight: 'bold', marginBottom: 15, fontSize: 12, textTransform: 'uppercase' },
  cardBlock: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20, marginBottom: 20 },
  
  classManagerBox: { marginBottom: 20, backgroundColor: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  classHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  classTitleName: { color: '#fff', fontSize: 18, fontWeight: 'bold', flex: 1, marginLeft: 10 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 5 },
  qtyBtnText: { color: '#00bfff', fontSize: 20, fontWeight: 'bold' },
  qtyValue: { color: '#fff', fontSize: 16, fontWeight: 'bold', width: 25, textAlign: 'center' },

  subclassGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 15, justifyContent: 'center' },
  subclassBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#444' },
  subclassBtnActive: { borderColor: '#00bfff', backgroundColor: 'rgba(0,191,255,0.1)' },
  subclassBtnText: { color: '#fff', fontSize: 11 },
  subclassBtnTextActive: { color: '#00bfff', fontWeight: 'bold' },
  
  multiclassBtn: { padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#00bfff', borderStyle: 'dashed', alignItems: 'center' },
  multiclassBtnText: { color: '#00bfff', fontSize: 13, fontWeight: 'bold' },

  hpRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  hpInfoBox: { alignItems: 'center' },
  hpInputBox: { alignItems: 'center' },
  hpLabel: { color: '#aaa', fontSize: 10, marginBottom: 5 },
  hpValue: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  hpInput: { backgroundColor: '#000', color: '#00fa9a', fontSize: 28, width: 80, textAlign: 'center', borderRadius: 12, padding: 5, borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)' },
  hpPlusIcon: { color: '#00fa9a', fontSize: 24 },
  hpHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 15, lineHeight: 18 },
  recommendedBtn: { marginTop: 15, padding: 12, backgroundColor: 'rgba(0, 250, 154, 0.1)', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#00fa9a' },
  recommendedBtnText: { color: '#00fa9a', fontSize: 12, fontWeight: 'bold' },
  
  warningBox: { backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  warningText: { color: '#00bfff', flex: 1, fontSize: 12, lineHeight: 18 },

  counterText: { fontSize: 12, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statEditorBox: { width: '48%', backgroundColor: 'rgba(0,0,0,0.3)', padding: 15, borderRadius: 15, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statLabel: { color: '#00bfff', fontSize: 12, fontWeight: 'bold', marginBottom: 10 },
  statControlRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginVertical: 5 },
  statBtn: { padding: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, width: 35, alignItems: 'center' },
  statBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  statValText: { color: '#fff', fontSize: 22, fontWeight: 'bold', width: 35, textAlign: 'center' },
  statModLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold', marginTop: 5 },
  
  toggleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  toggleBtnActive: { backgroundColor: '#00bfff', borderColor: '#00bfff' },
  toggleBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 'bold' },
  toggleBtnTextActive: { color: '#02112b' },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  summaryLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 'bold' },
  summaryValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  spellHeaderRow: { marginBottom: 5, backgroundColor: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8, alignItems: 'center' },
  manageSpellsBtn: { backgroundColor: '#00bfff', padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  manageSpellsBtnText: { color: '#02112b', fontWeight: 'bold', fontSize: 14 },
  
  summarySpellItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, marginBottom: 5 },

  bottomNav: { flexDirection: 'row', padding: 20, gap: 10, backgroundColor: '#02112b', borderTopWidth: 1, borderTopColor: '#333' },
  navBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  navBtnPrimary: { backgroundColor: '#00bfff' },
  navBtnFinish: { backgroundColor: '#00fa9a' },
  navBtnText: { color: '#fff', fontWeight: 'bold' },
  navBtnPrimaryText: { color: '#02112b', fontWeight: 'bold' },
  navBtnFinishText: { color: '#02112b', fontWeight: 'bold', fontSize: 16 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContentFullScreen: { backgroundColor: '#102b56', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  spellItemRow: { flexDirection: 'row', alignItems: 'center', padding: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 8, justifyContent: 'space-between' },
  spellItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});