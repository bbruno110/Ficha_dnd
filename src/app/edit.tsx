import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const STEPS = ['Níveis & Vida', 'Atributos', 'Proficiências', 'Resumo & Magias'];

type ClassEntry = { id: string; name: string; subclass: string; level: number };

// Tabela Padrão de Nível de Magia vs Nível de Classe de Conjurador Total (D&D 5e)
const getHighestSpellLevelAllowed = (casterLevel: number) => {
  if (casterLevel < 1) return -1;
  return Math.ceil(casterLevel / 2); // Nv 1-2=Nv 1, Nv 3-4=Nv 2, Nv 5-6=Nv 3...
};

const getSpellLevelNumber = (levelStr: string) => {
  if (levelStr.toLowerCase() === 'truque') return 0;
  const match = levelStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 99;
};

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

  const [targetLevel, setTargetLevel] = useState(1);
  const [hpIncrease, setHpIncrease] = useState('');

  const [classesData, setClassesData] = useState<ClassEntry[]>([]);
  const [originalClassesData, setOriginalClassesData] = useState<ClassEntry[]>([]);
  
  const [originalStatsTotal, setOriginalStatsTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({ FOR: 10, DES: 10, CON: 10, INT: 10, SAB: 10, CAR: 10 });
  const [tempMods, setTempMods] = useState<Record<string, number>>({});
  const [extraPoints, setExtraPoints] = useState(0);
  
  const [activeSaves, setActiveSaves] = useState<string[]>([]);
  // activeSkills agora guarda a ID da Skill. Se aparecer 2x, é Especialidade (Expertise).
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [maxSavesAllowed, setMaxSavesAllowed] = useState(2);
  const [maxSkillsAllowed, setMaxSkillsAllowed] = useState(4);
  const [maxExpertiseAllowed, setMaxExpertiseAllowed] = useState(0);

  const [activeSpells, setActiveSpells] = useState<string[]>([]);

  const [spellsModalVisible, setSpellsModalVisible] = useState(false);
  const [multiClassModalVisible, setMultiClassModalVisible] = useState(false);
  const [spellDetailModalVisible, setSpellDetailModalVisible] = useState(false);
  const [selectedSpellInfo, setSelectedSpellInfo] = useState<any>(null);
  const [spellSearch, setSpellSearch] = useState('');

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
          setActiveSkills(parseArray((char as any).skill_values));
          setActiveSpells(parseArray((char as any).spells).map(String));
        }
      } catch (e) { console.error(e); } finally { setLoading(false); }
    }
    loadData();
  }, [id]);

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

      const hasLoreBard = classesData.some(c => c.name === 'Bardo' && c.subclass === 'Colégio do Conhecimento' && c.level >= 3);
      if (hasLoreBard) calcSkills += 3;
    }

    setMaxSkillsAllowed(calcSkills);
    setMaxExpertiseAllowed(calcExpertise);
  }, [classesData, character]);

  const currentLevelSum = classesData.reduce((acc, c) => acc + c.level, 0);
  const conMod = Math.floor((stats.CON - 10) / 2);
  const profBonus = Math.ceil(targetLevel / 4) + 1; 

  let recommendedHpGain = 0;
  let asisGained = 0;
  let totalCasterLevel = 0;

  classesData.forEach(newClass => {
    const oldClass = originalClassesData.find(c => c.name === newClass.name);
    const oldLevel = oldClass ? oldClass.level : 0;
    const levelsGained = newClass.level - oldLevel;
    
    const dbClassObj = dbClasses.find(c => c.name === newClass.name);
    if (dbClassObj?.is_caster) totalCasterLevel += newClass.level;

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
  });

  if (recommendedHpGain <= 0 && targetLevel > character?.level) recommendedHpGain = Math.max(1, conMod);

  const pointsGained = asisGained * 2;
  const currentTotal = Object.values(stats).reduce((a, b) => Number(a) + Number(b), 0);
  const maxAllowedStats = originalStatsTotal + pointsGained;

  const intMod = Math.floor((stats.INT - 10) / 2);
  const sabMod = Math.floor((stats.SAB - 10) / 2);
  const carMod = Math.floor((stats.CAR - 10) / 2);
  const bestMagicMod = Math.max(intMod, sabMod, carMod, 0);
  const maxSpellsAllowed = Math.max(targetLevel + bestMagicMod + 3, activeSpells.length);
  
  // Nível Máximo de Magia que pode ser escolhida
  const maxSpellLevelAllowedToLearn = totalCasterLevel > 0 ? getHighestSpellLevelAllowed(totalCasterLevel) : 0;

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

  // LOGICA REVISADA: Proficiência (1 click) -> Especialidade/Expertise (2 clicks) -> Desmarcar (3 clicks)
  const toggleSkill = (skillId: string) => {
    const occurrences = activeSkills.filter(i => i === skillId).length;
    const currentExpertiseCount = activeSkills.length - new Set(activeSkills).size; // Conta quantos itens repetidos existem (Especialidades ativas)
    const uniqueSkillsCount = new Set(activeSkills).size; // Conta quantas perícias únicas estão marcadas

    if (occurrences === 0) {
      // Adiciona Proficiência normal
      if (uniqueSkillsCount >= maxSkillsAllowed) {
        Alert.alert("Limite Atingido", `Você só pode ter proficiência em ${maxSkillsAllowed} perícias.`); return;
      }
      setActiveSkills(prev => [...prev, skillId]);
    } 
    else if (occurrences === 1) {
      // Tenta promover para Especialidade (Dobro de Proficiência)
      if (currentExpertiseCount >= maxExpertiseAllowed) {
        Alert.alert("Limite Atingido", `Você só possui direito a ${maxExpertiseAllowed} Especialidade(s) com essa classe/nível.`); return;
      }
      setActiveSkills(prev => [...prev, skillId]); // Fica duplicado no array (2 ocorrências = Expertise)
    } 
    else {
      // Remove totalmente (Remove as duas ocorrências)
      setActiveSkills(prev => prev.filter(i => i !== skillId));
    }
  };

  const toggleSpell = (spellId: string) => {
    if (activeSpells.includes(spellId)) setActiveSpells(prev => prev.filter(i => i !== spellId));
    else {
      if (activeSpells.length >= maxSpellsAllowed) {
        Alert.alert("Limite Atingido", `Seu intelecto atual permite apenas ${maxSpellsAllowed} magias/truques simultâneos.`); return;
      }
      setActiveSpells(prev => [...prev, spellId]);
    }
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
      router.back();
    } catch (e) { console.error("Erro ao salvar:", e); }
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00bfff" /></View>;

  const isLevelUp = character && targetLevel > character.level;
  const activeClassNames = classesData.filter(c => c.level > 0).map(c => c.name);

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
          Clique 1x para <Text style={{color: '#00bfff'}}>Proficiência (+{profBonus})</Text>.{'\n'}
          {maxExpertiseAllowed > 0 && `Clique 2x para Especialidade (+${profBonus * 2}).`}
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
              if (isProficient) finalBonus += profBonus;
              if (isExpertise) finalBonus += (profBonus * 2);

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
              const finalBonus = statMod + (isActive ? profBonus : 0);

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

  const renderStep3 = () => (
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
      </View>

      <Text style={styles.sectionTitle}>GRIMÓRIO DE MAGIAS</Text>
      <View style={styles.cardBlock}>
        <View style={styles.spellHeaderRow}>
          <Text style={{color: '#fff', fontSize: 14}}>
            Conhecidas: <Text style={{fontWeight: 'bold', color: activeSpells.length >= maxSpellsAllowed ? '#ff6666' : '#00fa9a'}}>{activeSpells.length} / {maxSpellsAllowed}</Text>
          </Text>
        </View>
        <Text style={[styles.hpHint, {marginBottom: 15, textAlign: 'left'}]}>
          Magias limitadas a <Text style={{color: '#00fa9a', fontWeight: 'bold'}}>Nível {maxSpellLevelAllowedToLearn}</Text> baseado no nível da sua classe conjuradora.
        </Text>
        
        <TouchableOpacity style={styles.manageSpellsBtn} onPress={() => setSpellsModalVisible(true)}>
          <Text style={styles.manageSpellsBtnText}>Abrir Catálogo de Magias</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

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
        <View style={{height: 100}} />
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navBtn} disabled={currentStep === 0} onPress={() => setCurrentStep(prev => prev - 1)}><Text style={styles.navBtnText}>Voltar</Text></TouchableOpacity>
        {currentStep < 3 ? (
          <TouchableOpacity style={[styles.navBtn, styles.navBtnPrimary]} onPress={goToNextStep}><Text style={styles.navBtnPrimaryText}>Próximo</Text></TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.navBtn, styles.navBtnFinish]} onPress={saveChanges}><Text style={styles.navBtnFinishText}>Salvar Ficha</Text></TouchableOpacity>
        )}
      </View>

      {/* MODAL DETALHE MAGIA */}
      <Modal visible={spellDetailModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSpellDetailModalVisible(false)}>
          <View style={styles.spellDetailCard}>
            <Text style={styles.spellDetailName}>{selectedSpellInfo?.name}</Text>
            <Text style={styles.spellDetailLevel}>{selectedSpellInfo?.level} • {selectedSpellInfo?.classes}</Text>
            <View style={styles.divider} />
            
            <View style={styles.spellDetailInfoGrid}>
              <View style={styles.spellDetailInfoItem}>
                <Text style={styles.spellDetailInfoLabel}>CONJURAÇÃO</Text>
                <Text style={styles.spellDetailInfoValue}>{selectedSpellInfo?.casting_time}</Text>
              </View>
              <View style={styles.spellDetailInfoItem}>
                <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
                <Text style={styles.spellDetailInfoValue}>{selectedSpellInfo?.range}</Text>
              </View>
            </View>

            <Text style={styles.spellDetailInfoLabel}>DANO / EFEITO</Text>
            <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', marginBottom: 15}]}>{selectedSpellInfo?.damage || 'Nenhum'}</Text>

            <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
            <ScrollView style={{maxHeight: 200, marginTop: 5}}>
              <Text style={styles.spellDetailDescription}>{selectedSpellInfo?.description}</Text>
            </ScrollView>

            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSpellDetailModalVisible(false)}>
              <Text style={styles.modalCloseText}>FECHAR</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* MODAL LISTA MAGIAS (CORRIGIDO PARA O TECLADO NÃO ESMAGAR) */}
      <Modal visible={spellsModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.modalOverlay} onPress={() => setSpellsModalVisible(false)}>
            <Pressable style={[styles.modalContentFullScreen, {height: '80%'}]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Catálogo Mágico</Text>
                <TouchableOpacity onPress={() => setSpellsModalVisible(false)}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
              </View>
              <TextInput style={styles.searchInput} placeholder="Buscar magia..." value={spellSearch} onChangeText={setSpellSearch} placeholderTextColor="#666" />
              
              <FlatList
                style={{ flex: 1, width: '100%' }}
                showsVerticalScrollIndicator={false}
                data={dbSpells.filter(s => {
                  const sLvl = getSpellLevelNumber(s.level);
                  const isAllowedByLevel = sLvl <= maxSpellLevelAllowedToLearn;
                  const isCompatibleClass = activeClassNames.some(c => s.classes.includes(c));
                  const matchesSearch = s.name.toLowerCase().includes(spellSearch.toLowerCase());
                  return isAllowedByLevel && isCompatibleClass && matchesSearch;
                })}
                keyExtractor={s => s.id.toString()}
                renderItem={({ item }) => {
                  const isActive = activeSpells.includes(item.id.toString());
                  return (
                    <View style={[styles.spellItemRow, isActive && styles.spellItemRowActive]}>
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => toggleSpell(item.id.toString())}>
                        <Text style={[styles.spellItemName, isActive && {color: '#02112b'}]}>{item.name}</Text>
                        <Text style={[styles.spellItemSub, isActive && {color: 'rgba(2,17,43,0.7)'}]}>{item.level}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{paddingHorizontal: 15}} onPress={() => { setSelectedSpellInfo(item); setSpellDetailModalVisible(true); }}>
                        <Ionicons name="information-circle-outline" size={26} color={isActive ? "#02112b" : "#00bfff"} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => toggleSpell(item.id.toString())}>
                        <Ionicons name={isActive ? "checkmark-circle" : "ellipse-outline"} size={26} color={isActive ? "#02112b" : "rgba(255,255,255,0.3)"} />
                      </TouchableOpacity>
                    </View>
                  )
                }}
                ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma magia compatível encontrada para o seu nível.</Text>}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

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
  
  textInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 15, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 10 },
  
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
  
  bottomNav: { flexDirection: 'row', padding: 20, gap: 10, backgroundColor: '#02112b', borderTopWidth: 1, borderTopColor: '#333' },
  navBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  navBtnPrimary: { backgroundColor: '#00bfff' },
  navBtnFinish: { backgroundColor: '#00fa9a' },
  navBtnText: { color: '#fff', fontWeight: 'bold' },
  navBtnPrimaryText: { color: '#02112b', fontWeight: 'bold' },
  navBtnFinishText: { color: '#02112b', fontWeight: 'bold', fontSize: 16 },

  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContentFullScreen: { backgroundColor: '#102b56', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  searchInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  
  spellItemRow: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 8, justifyContent: 'space-between' },
  spellItemRowActive: { backgroundColor: '#00fa9a' },
  spellItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  spellItemSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  
  spellDetailCard: { backgroundColor: '#102b56', borderRadius: 24, padding: 25, width: '90%', borderWidth: 1, borderColor: '#00bfff', alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  spellDetailName: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
  spellDetailLevel: { color: '#00bfff', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  spellDetailInfoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 12 },
  spellDetailInfoItem: { alignItems: 'center', flex: 1 },
  spellDetailInfoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4 },
  spellDetailInfoValue: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  spellDetailDescription: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 22 },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' }
});