import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import {
    Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';

// ================= TIPAGENS =================
type RaceItem = { id: number; name: string; stat_bonuses: string };
type ClassItem = { id: number; name: string; recommended_stats: string; starting_equipment: string; starting_gold: number };
type SkillItem = { id: string; name: string; stat: string };
type SpellItem = { id: number; name: string; level: string };
type DbItem = { id: number; name: string; weight: number };
type InventoryItem = { name: string; qty: number; weight: number };

// ================= CONSTANTES DO SISTEMA =================
const CLASS_SAVES: Record<string, string[]> = {
  'Bárbaro': ['save_for', 'save_con'], 'Bardo': ['save_des', 'save_car'], 'Bruxo': ['save_sab', 'save_car'],
  'Clérigo': ['save_sab', 'save_car'], 'Druida': ['save_int', 'save_sab'], 'Feiticeiro': ['save_con', 'save_car'],
  'Guerreiro': ['save_for', 'save_con'], 'Ladino': ['save_des', 'save_int'], 'Mago': ['save_int', 'save_sab'],
  'Monge': ['save_for', 'save_des'], 'Paladino': ['save_sab', 'save_car'], 'Patrulheiro': ['save_for', 'save_des'],
};

const CLASS_HIT_DICE: Record<string, number> = {
  'Bárbaro': 12, 'Guerreiro': 10, 'Paladino': 10, 'Patrulheiro': 10,
  'Bardo': 8, 'Clérigo': 8, 'Druida': 8, 'Ladino': 8, 'Monge': 8, 'Bruxo': 8,
  'Feiticeiro': 6, 'Mago': 6
};

const RACE_SPEED: Record<string, string> = {
  'Anão': '7,5m', 'Halfling': '7,5m', 'Gnomo': '7,5m',
  'Elfo': '9m', 'Humano': '9m', 'Meio-Elfo': '9m', 'Meio-Orc': '9m', 'Tiefling': '9m', 'Draconato': '9m'
};

export default function CreateCharacterScreen() {
  const router = useRouter();
  const db = useSQLiteContext();

  // ----- ESTADOS DO BANCO DE DADOS -----
  const [dbRaces, setDbRaces] = useState<RaceItem[]>([]);
  const [dbClasses, setDbClasses] = useState<ClassItem[]>([]);
  const [dbSavingThrows, setDbSavingThrows] = useState<SkillItem[]>([]);
  const [dbSkills, setDbSkills] = useState<SkillItem[]>([]);
  const [availableSpells, setAvailableSpells] = useState<SpellItem[]>([]);
  const [dbItems, setDbItems] = useState<DbItem[]>([]); 

  // ----- ESTADOS BÁSICOS (Passo 1, 2 e 3) -----
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
  
  // ----- ESTADOS DE HISTÓRIA E DETALHES (Passo 4) -----
  const [backstory, setBackstory] = useState('');
  const [alliesOrganizations, setAlliesOrganizations] = useState('');
  const [featuresTraits, setFeaturesTraits] = useState('');
  const [languages, setLanguages] = useState('');

  // ----- MAGIAS, INVENTÁRIO E MOEDAS (Passos 5 e 6) -----
  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [spellSearch, setSpellSearch] = useState('');
  
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [gp, setGp] = useState(0); 
  const [sp, setSp] = useState(0); 
  const [cp, setCp] = useState(0); 

  // ----- UI MODAL -----
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'race' | 'class' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
          setSp(0);
          setCp(0);

          const classProfs = CLASS_SAVES[charClass] || [];
          setProficiencies(prev => {
            const semSavesAntigos = prev.filter(p => !p.startsWith('save_'));
            return [...semSavesAntigos, ...classProfs];
          });
        } catch (error) {}
      }
    }
  }, [race, charClass, dbRaces, dbClasses]);

  useEffect(() => {
    if (charClass !== 'Selecione uma classe' && dbClasses.length > 0 && dbItems.length > 0) {
      const selectedClass = dbClasses.find(c => c.name === charClass);
      
      if (selectedClass && selectedClass.starting_equipment) {
        try {
          const classEquipRaw = JSON.parse(selectedClass.starting_equipment);
          const builtInventory = classEquipRaw.map((eq: any) => {
            const catalogItem = dbItems.find(i => i.name === eq.name);
            return { 
              name: eq.name, 
              qty: eq.qty, 
              weight: catalogItem ? catalogItem.weight : 0 
            };
          });
          setInventory(builtInventory);
        } catch (error) { setInventory([]); }
      }
    } else { setInventory([]); }
  }, [charClass, dbClasses, dbItems]);
  
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
          `SELECT * FROM spells WHERE classes LIKE ? AND level IN ('Truque', 'Nível 1') ORDER BY level ASC, name ASC`,
          [`%${charClass}%`]
        );
        setAvailableSpells(result);
      } catch (error) {}
    }
    loadSpells();
  }, [charClass]);

  // ================= FUNÇÕES DE INTERAÇÃO =================
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
      if (currentSkills >= 4) {
        Alert.alert("Limite de Perícias", "Um personagem de Nível 1 possui no máximo 4 perícias."); return;
      }
    }
    setProficiencies(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const toggleSpell = (id: string) => {
    const spell = availableSpells.find(s => s.id.toString() === id);
    if (!spell) return;

    const isSelecting = !selectedSpells.includes(id);

    if (isSelecting) {
      const cantripsCount = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length;
      const level1Count = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Nível 1').length;

      if (spell.level === 'Truque' && cantripsCount >= 3) { Alert.alert("Limite", "Máximo 3 Truques no Nível 1."); return; }
      if (spell.level === 'Nível 1' && level1Count >= 4) { Alert.alert("Limite", "Máximo 4 magias de Nível 1."); return; }
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

  // ================= MATEMÁTICA E STATUS GERAIS =================
  const getModifier = (statValue: string) => Math.floor(((parseInt(statValue) || 10) - 10) / 2);
  
  const currentStrength = parseInt(stats.FOR) || 10;
  const maxCarryingCapacity = currentStrength * 7.5; 
  const weightFromCoins = (gp + sp + cp) * 0.01; 
  const currentWeight = inventory.reduce((sum, item) => sum + (item.weight * item.qty), 0) + weightFromCoins;
  const isOverweight = currentWeight > maxCarryingCapacity;

  const dexterityMod = getModifier(stats.DES);
  const constitutionMod = getModifier(stats.CON);
  const hitDieMax = CLASS_HIT_DICE[charClass] || 8;
  
  // O HP Máximo é calculado aqui e será salvo no banco logo abaixo.
  const hpMax = hitDieMax + constitutionMod;
  const armorClass = 10 + dexterityMod;
  const initiative = dexterityMod >= 0 ? `+${dexterityMod}` : `${dexterityMod}`;
  const speed = RACE_SPEED[race] || '9m';

  // Lógica de Passos
  const CASTER_CLASSES = ['Bardo', 'Bruxo', 'Clérigo', 'Druida', 'Feiticeiro', 'Mago'];
  const hasSpells = CASTER_CLASSES.includes(charClass);
  const totalSteps = hasSpells ? 7 : 6;

  // ================= O GRANDE SAVE NO BANCO =================
  const handleSave = async () => {
    if (!name || race.includes('Selecione') || charClass.includes('Selecione')) {
      Alert.alert("Atenção", "Preencha o Nome, Raça e Classe no Passo 1."); return;
    }

    const cleanInventory = inventory.filter(item => item.qty > 0);
    // Garante que o HP nunca seja NaN ou menor que 1
    const hpToSave = (hpMax && hpMax > 0) ? hpMax : 1; 

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
          name || '', 
          race || '', 
          charClass || '', 
          JSON.stringify(stats || {}), 
          profBonus || '', 
          inspiration || '0', 
          JSON.stringify(proficiencies || []), 
          JSON.stringify(saveValues || {}), 
          JSON.stringify(skillValues || {}), 
          personalityTraits || '', 
          ideals || '', 
          bonds || '', 
          flaws || '', 
          featuresTraits || '', 
          backstory || '', 
          alliesOrganizations || '', 
          languages || '', 
          JSON.stringify(selectedSpells || []), 
          JSON.stringify(cleanInventory || []), 
          gp || 0, 
          sp || 0, 
          cp || 0,
          hpToSave, // hp_max
          hpToSave, // hp_current
          1,        // level
          0         // xp
        ]
      );
      router.back();
    } catch (error) {
      console.error("Erro ao inserir:", error);
      Alert.alert("Erro de Banco de Dados", "Ocorreu um erro ao salvar. Certifique-se de ter renomeado o banco no _layout.tsx");
    }
  };

  const openSelectionModal = (type: 'race' | 'class') => { setModalType(type); setSearchQuery(''); setModalVisible(true); };
  const getFilteredData = () => (modalType === 'race' ? dbRaces : dbClasses).filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // ================= RENDERIZAÇÕES =================
  const renderSearchModal = () => (
    <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={() => setModalVisible(false)}>
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
            ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma opção encontrada.</Text>}
          />
          <TouchableOpacity style={styles.modalCloseButton} onPress={() => setModalVisible(false)}>
            <Text style={styles.modalCloseText}>CANCELAR</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderStep1 = () => {
    const totalStats = Object.values(stats).reduce((acc, val) => acc + (parseInt(val) || 0), 0);
    return (
      <>
        <View style={styles.formGroup}><Text style={styles.label}>NOME DO PERSONAGEM</Text><TextInput style={styles.input} placeholder="Ex: Kaelen" placeholderTextColor="rgba(255, 255, 255, 0.3)" value={name} onChangeText={setName} /></View>
        <View style={styles.formGroup}><Text style={styles.label}>RAÇA</Text><TouchableOpacity style={styles.selectButton} onPress={() => openSelectionModal('race')}><Text style={[styles.selectButtonText, race.includes('Selecione') && {color:'rgba(255,255,255,0.3)'}]}>{race}</Text><Text style={styles.selectIcon}>▼</Text></TouchableOpacity></View>
        <View style={styles.formGroup}><Text style={styles.label}>CLASSE</Text><TouchableOpacity style={styles.selectButton} onPress={() => openSelectionModal('class')}><Text style={[styles.selectButtonText, charClass.includes('Selecione') && {color:'rgba(255,255,255,0.3)'}]}>{charClass}</Text><Text style={styles.selectIcon}>▼</Text></TouchableOpacity></View>
        <View style={styles.statsSection}>
          <View style={styles.statsHeader}><Text style={styles.sectionTitle}>ATRIBUTOS BÁSICOS</Text><Text style={styles.counterText}>SOMA: {totalStats}/{maxStatsSum}</Text></View>
          <View style={styles.statsGrid}>{Object.keys(stats).map((key) => <View key={key} style={styles.statBox}><Text style={styles.statLabel}>{key}</Text><TextInput style={styles.statInput} keyboardType="numeric" maxLength={2} value={stats[key as keyof typeof stats]} onChangeText={(val) => updateStat(key as keyof typeof stats, val)} /></View>)}</View>
        </View>
      </>
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
          {dbSavingThrows.map(s => <View key={s.id} style={styles.skillRow}><TouchableOpacity style={[styles.radioCircle, proficiencies.includes(s.id) && styles.radioCircleSelected]} onPress={() => Alert.alert("Regra", "Definidos pela Classe.")}>{proficiencies.includes(s.id) && <View style={styles.radioDot} />}</TouchableOpacity><TextInput style={styles.skillInputCalculated} value={saveValues[s.id] || '+0'} editable={false} /><Text style={styles.skillName}>{s.name} <Text style={styles.statHint}>({s.stat})</Text></Text></View>)}
        </View>
        <View style={styles.statsHeader}><Text style={styles.listTitle}>PERÍCIAS</Text><Text style={styles.counterText}>Marcadas: {currentSkills}/4</Text></View>
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
      <View style={styles.formGroup}>
        <Text style={styles.label}>HISTÓRIA DO PERSONAGEM</Text>
        <TextInput style={[styles.textArea, { minHeight: 120 }]} multiline value={backstory} onChangeText={setBackstory} placeholder="De onde você veio? Como adquiriu suas habilidades?" placeholderTextColor="rgba(255, 255, 255, 0.3)"/>
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.label}>ALIADOS E ORGANIZAÇÕES</Text>
        <TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={alliesOrganizations} onChangeText={setAlliesOrganizations} placeholder="Guildas, facções, deuses..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/>
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.label}>CARACTERÍSTICAS E HABILIDADES EXTRAS</Text>
        <TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={featuresTraits} onChangeText={setFeaturesTraits} placeholder="Visão no escuro, resistência anã, talentos..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/>
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.label}>IDIOMAS E OUTRAS PROFICIÊNCIAS</Text>
        <TextInput style={[styles.textArea, { minHeight: 80 }]} multiline value={languages} onChangeText={setLanguages} placeholder="Comum, Élfico, Ferramentas de ferreiro..." placeholderTextColor="rgba(255, 255, 255, 0.3)"/>
      </View>
    </View>
  );

  const renderStepSpells = () => {
    const filteredSpells = availableSpells.filter(spell => spell.name.toLowerCase().includes(spellSearch.toLowerCase()) || spell.level.toLowerCase().includes(spellSearch.toLowerCase()));
    const cantripsCount = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Truque').length;
    const level1Count = selectedSpells.filter(sId => availableSpells.find(s => s.id.toString() === sId)?.level === 'Nível 1').length;

    return (
      <View style={styles.stepContainer}>
        <View style={styles.statsHeader}>
          <Text style={styles.listTitle}>MAGIAS CONHECIDAS</Text>
          <Text style={styles.counterText}>T: {cantripsCount}/3 • N1: {level1Count}/4</Text>
        </View>
        <TextInput style={[styles.searchInput, { marginBottom: 20 }]} placeholder="Buscar por nome ou nível..." placeholderTextColor="rgba(255,255,255,0.4)" value={spellSearch} onChangeText={setSpellSearch} />
        <View style={styles.skillsCard}>
          {filteredSpells.length > 0 ? filteredSpells.map(s => (
            <View key={s.id} style={styles.skillRow}><TouchableOpacity style={[styles.radioCircle, selectedSpells.includes(s.id.toString()) && styles.radioCircleSelected]} onPress={() => toggleSpell(s.id.toString())}>{selectedSpells.includes(s.id.toString()) && <View style={styles.radioDot} />}</TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.skillName}>{s.name}</Text></View><Text style={styles.spellLevelHint}>{s.level}</Text></View>
          )) : <Text style={styles.emptyText}>{charClass.includes('Selecione') ? "Escolha uma Classe." : "Nenhuma magia encontrada."}</Text>}
        </View>
      </View>
    );
  };

  const renderStepEquipment = () => (
    <View style={styles.stepContainer}>
      <View style={styles.statsHeader}>
        <Text style={styles.listTitle}>INVENTÁRIO E CARGA</Text>
        <Text style={[styles.counterText, isOverweight && { backgroundColor: 'rgba(255, 50, 50, 0.2)', color: '#ff6666' }]}>{currentWeight.toFixed(2)} / {maxCarryingCapacity.toFixed(1)} kg</Text>
      </View>

      <Text style={styles.label}>MOEDAS INICIAIS</Text>
      <View style={styles.coinsRow}>
        {[ {l: 'Ouro (PO)', v: gp, s: setGp, c: '#ffd700'}, {l: 'Prata (PP)', v: sp, s: setSp, c: '#c0c0c0'}, {l: 'Cobre (PC)', v: cp, s: setCp, c: '#cd7f32'} ].map((c, i) => (
          <View key={i} style={styles.coinBox}><Text style={[styles.coinLabel, { color: c.c }]}>{c.l}</Text><TextInput style={styles.coinInput} keyboardType="numeric" value={String(c.v)} onChangeText={t => c.s(parseInt(t) || 0)} /></View>
        ))}
      </View>
      
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>Ajuste as quantidades da sua mochila. Itens com quantidade "0" serão removidos ao salvar.</Text>
      </View>

      <View style={styles.skillsCard}>
        {inventory.length > 0 ? inventory.map((item, idx) => (
          <View key={idx} style={styles.skillRow}>
            <View style={styles.qtyControl}><TouchableOpacity style={styles.qtyBtn} onPress={() => updateInventoryQty(idx, -1)}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity><Text style={styles.qtyValue}>{item.qty}</Text><TouchableOpacity style={styles.qtyBtn} onPress={() => updateInventoryQty(idx, 1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity></View>
            <Text style={[styles.skillName, { flex: 1, color: item.qty === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)' }]}>{item.name}</Text>
            <Text style={[styles.statHint, item.qty === 0 && {color: 'transparent'}]}>{(item.weight * item.qty).toFixed(1)} kg</Text>
          </View>
        )) : <Text style={styles.emptyText}>Escolha uma Classe no Passo 1.</Text>}
      </View>
    </View>
  );

  const renderStepSummary = () => (
    <View style={styles.stepContainer}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryName}>{name || 'Herói Sem Nome'}</Text>
        <Text style={styles.summarySubtitle}>{race.includes('Selecione') ? 'Raça não definida' : race} • {charClass.includes('Selecione') ? 'Classe não definida' : charClass} (Nível 1)</Text>
      </View>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryBoxValue}>{armorClass}</Text>
          <Text style={styles.summaryBoxLabel}>C.A BASE</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryBoxValue}>{initiative}</Text>
          <Text style={styles.summaryBoxLabel}>INICIATIVA</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryBoxValue}>{speed}</Text>
          <Text style={styles.summaryBoxLabel}>DESLOCAM.</Text>
        </View>
      </View>

      <View style={styles.hpContainer}>
        <View style={styles.hpBox}>
          <Text style={styles.hpLabel}>PONTOS DE VIDA MÁXIMOS</Text>
          <Text style={styles.hpValue}>{hpMax}</Text>
        </View>
        <View style={styles.hpBox}>
          <Text style={styles.hpLabel}>DADOS DE VIDA</Text>
          <Text style={[styles.hpValue, {color: '#00bfff'}]}>1d{hitDieMax}</Text>
        </View>
      </View>

      <View style={[styles.infoBox, { backgroundColor: 'rgba(0, 250, 154, 0.1)', borderColor: 'rgba(0, 250, 154, 0.3)' }]}>
        <Text style={styles.infoText}>Pronto! Sua ficha está completa. Confirme abaixo para registrar o personagem no banco de dados.</Text>
      </View>
    </View>
  );

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {renderSearchModal()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Novo Personagem</Text>
            <Text style={styles.headerSubtitle}>Passo {step} de {totalSteps}</Text>
          </View>
          
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          
          {/* Fluxo COM Magias */}
          {step === 5 && hasSpells && renderStepSpells()}
          {step === 6 && hasSpells && renderStepEquipment()}
          {step === 7 && hasSpells && renderStepSummary()}

          {/* Fluxo SEM Magias */}
          {step === 5 && !hasSpells && renderStepEquipment()}
          {step === 6 && !hasSpells && renderStepSummary()}

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
            <TouchableOpacity style={[styles.primaryButton, {backgroundColor: '#00fa9a', shadowColor: '#00fa9a'}]} onPress={handleSave}>
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
  header: { marginBottom: 30 },
  headerTitle: { fontSize: 32, fontWeight: 'bold', color: '#ffffff' },
  headerSubtitle: { fontSize: 16, color: '#00bfff', marginTop: 5, fontWeight: 'bold' },
  formGroup: { marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)', marginBottom: 8, letterSpacing: 1 },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16, color: '#ffffff' },
  textArea: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 15, fontSize: 14, color: '#ffffff', minHeight: 100, textAlignVertical: 'top' },
  selectButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 16 },
  selectButtonText: { fontSize: 16, color: '#ffffff' },
  selectIcon: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.7)' },
  modalContent: { backgroundColor: '#102b56', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff', marginBottom: 15 },
  searchInput: { width: '100%', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, padding: 12, color: '#ffffff', fontSize: 16, marginBottom: 15 },
  modalListItem: { width: '100%', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)' },
  modalListItemText: { fontSize: 16, color: '#ffffff' },
  emptyText: { color: 'rgba(255, 255, 255, 0.5)', marginTop: 20, textAlign: 'center' },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold', letterSpacing: 1 },
  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  counterText: { fontSize: 12, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  statBox: { width: '30%', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, padding: 10, alignItems: 'center', marginBottom: 5 },
  statLabel: { fontSize: 14, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)', marginBottom: 5 },
  statInput: { fontSize: 24, fontWeight: 'bold', color: '#ffffff', textAlign: 'center', width: '100%' },
  stepContainer: { marginTop: 10 },
  step2Container: { marginTop: 10 },
  step3Container: { marginTop: 10 },
  step4Container: { marginTop: 10 },
  profBonusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(0, 191, 255, 0.3)', borderRadius: 12, padding: 15, marginBottom: 20 },
  profBonusTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  profBonusInput: { fontSize: 20, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 0, 0, 0.2)', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 8, minWidth: 50, textAlign: 'center' },
  listTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  skillsCard: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 16, padding: 15, marginBottom: 20, marginTop: 10 },
  skillRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)' },
  radioCircle: { height: 24, width: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  radioCircleSelected: { borderColor: '#00bfff' },
  radioDot: { height: 12, width: 12, borderRadius: 6, backgroundColor: '#00bfff' },
  skillInputCalculated: { width: 50, fontSize: 16, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'transparent', paddingVertical: 4, textAlign: 'center', marginRight: 15 },
  skillName: { flex: 1, fontSize: 16, color: 'rgba(255, 255, 255, 0.8)' },
  spellLevelHint: { fontSize: 12, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statHint: { fontSize: 12, color: 'rgba(255, 255, 255, 0.4)' },
  footer: { position: 'absolute', bottom: 30, left: 20, right: 20, flexDirection: 'row', gap: 10 },
  backButton: { flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  backButtonText: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  primaryButton: { flex: 2, backgroundColor: '#00bfff', borderRadius: 16, paddingVertical: 18, alignItems: 'center', shadowColor: '#00bfff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 5, elevation: 5 },
  primaryButtonText: { fontSize: 14, fontWeight: 'bold', color: '#02112b', letterSpacing: 1 },
  infoBox: { backgroundColor: 'rgba(0, 191, 255, 0.1)', padding: 15, borderRadius: 12, borderColor: 'rgba(0, 191, 255, 0.3)', borderWidth: 1, marginBottom: 20 },
  infoText: { color: '#ffffff', fontSize: 14, lineHeight: 20 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', marginRight: 15, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 8 },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  qtyBtnText: { color: '#00bfff', fontSize: 18, fontWeight: 'bold' },
  qtyValue: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', width: 25, textAlign: 'center' },
  coinsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  coinBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  coinLabel: { fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  coinInput: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', width: '100%' },

  // ESTILOS DO RESUMO FINAL
  summaryHeader: { alignItems: 'center', marginBottom: 20, backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  summaryName: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5, textAlign: 'center' },
  summarySubtitle: { fontSize: 16, color: '#00bfff', fontWeight: 'bold', letterSpacing: 1 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  summaryBox: { flex: 1, backgroundColor: 'rgba(0, 191, 255, 0.05)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0, 191, 255, 0.2)' },
  summaryBoxValue: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
  summaryBoxLabel: { fontSize: 10, fontWeight: 'bold', color: '#00bfff', letterSpacing: 1 },
  hpContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
  hpBox: { flex: 1, backgroundColor: 'rgba(255, 50, 50, 0.05)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 50, 50, 0.2)' },
  hpValue: { fontSize: 26, fontWeight: 'bold', color: '#ff6666', marginBottom: 5 },
  hpLabel: { fontSize: 10, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)', letterSpacing: 1 },
});