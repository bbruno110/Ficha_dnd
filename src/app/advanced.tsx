import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

const CATEGORIES = ['Item', 'Raça', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit', 'Acervo'];

const ITEM_CATEGORIES = ['Arma', 'Armadura', 'Escudo', 'Anel', 'Amuleto', 'Capacete', 'Capa', 'Bota', 'Luva', 'Consumível', 'Ferramenta', 'Mochila/Saco', 'Outro'];
const EFFECT_CATEGORIES = ['Cortante', 'Perfurante', 'Concussão', 'Fogo', 'Frio', 'Veneno', 'Ácido', 'Psíquico', 'Necrótico', 'Radiante', 'Elétrico', 'Trovejante', 'Força', 'Cura', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo', 'Outro'];
const ITEM_PROPS = ['Acuidade', 'Leve', 'Pesada', 'Duas mãos', 'Versátil', 'Arremesso', 'Munição', 'Alcance', 'Recarga', 'Especial', 'Foco Arcano', 'Foco Divino', 'Foco Druídico', 'Consumível', 'Mágico'];
const SPELL_LEVELS = ['Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];

const SPELL_CASTING_TIME_TYPES = ['Ação', 'Ação Bônus', 'Reação', 'Minuto(s)', 'Hora(s)'];
const SPELL_RANGES = ['Pessoal', 'Toque', '9m', '18m', '36m', 'Cubo', 'Cone'];
const SPELL_COMPONENTS = ['V', 'S', 'M'];
const SPELL_DURATION_TYPES = ['Instantânea', 'Rodada(s)', 'Minuto(s)', 'Hora(s)', 'Dia(s)', 'Concentração'];
const SPELL_SAVES = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const SPELL_DAMAGE_TYPES = ['Cortante', 'Perfurante', 'Concussão', 'Fogo', 'Frio', 'Veneno', 'Ácido', 'Psíquico', 'Necrótico', 'Radiante', 'Elétrico', 'Trovejante', 'Força', 'Cura', 'Outro'];

const VALID_TABLES = ['items', 'races', 'classes', 'subclasses', 'spells', 'starting_kits'];

type EffectItem = { val: string; type: string; duration?: string; turns?: string };
type SpellEffectItem = { dice: string; type: string };
type SpellClassReq = { name: string; minLevel: string }; 

export default function AdvancedCreatorScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const [activeTab, setActiveTab] = useState('Item');

  // Estados Gerais
  const [name, setName] = useState('');
  
  // Estados de Item
  const [weight, setWeight] = useState('1');
  const [itemCategory, setItemCategory] = useState('Arma');
  const [properties, setProperties] = useState<string[]>([]);
  const [itemEffects, setItemEffects] = useState<EffectItem[]>([]);
  const [itemDescription, setItemDescription] = useState(''); 
  
  const [tempEffVal, setTempEffVal] = useState('');
  const [tempEffType, setTempEffType] = useState('Cortante');
  const [tempEffDuration, setTempEffDuration] = useState(''); 
  const [tempEffTurns, setTempEffTurns] = useState(''); 

  // Estados de Raça & Classe
  const [stats, setStats] = useState({ FOR: '0', DES: '0', CON: '0', INT: '0', SAB: '0', CAR: '0' });
  const [speed, setSpeed] = useState('9m');
  const [hitDice, setHitDice] = useState('8');
  const [gold, setGold] = useState('10');
  const [subclassLevel, setSubclassLevel] = useState('3');
  const [isCaster, setIsCaster] = useState(false);
  const [saves, setSaves] = useState<string[]>([]);
  
  // Estados de Subclasse
  const [subclassParents, setSubclassParents] = useState<SpellClassReq[]>([]);
  const [subclassSearch, setSubclassSearch] = useState('');
  const [tempSubclassParent, setTempSubclassParent] = useState('');
  const [tempSubclassLevel, setTempSubclassLevel] = useState('3');
  const [dbClasses, setDbClasses] = useState<{name: string}[]>([]);
  // NOVO: Estado para a quantidade de perícias extras que a subclasse dá
  const [bonusSkills, setBonusSkills] = useState('0');

  // Estados de Magia
  const [spellLevel, setSpellLevel] = useState('Truque');
  
  const [spellClassesReq, setSpellClassesReq] = useState<SpellClassReq[]>([]);
  const [spellClassSearch, setSpellClassSearch] = useState('');
  const [tempSpellClass, setTempSpellClass] = useState('');
  const [tempSpellClassLvl, setTempSpellClassLvl] = useState('1');

  const [castTimeValue, setCastTimeValue] = useState('1');
  const [castTimeType, setCastTimeType] = useState('Ação');
  
  const [spellRange, setSpellRange] = useState('18m');
  const [spellComponents, setSpellComponents] = useState<string[]>(['V', 'S']);
  
  const [spellDurationValue, setSpellDurationValue] = useState('');
  const [spellDurationType, setSpellDurationType] = useState('Instantânea');
  
  const [spellEffectsList, setSpellEffectsList] = useState<SpellEffectItem[]>([]);
  const [tempSpellDice, setTempSpellDice] = useState('');
  const [tempSpellDmgType, setTempSpellDmgType] = useState('Fogo');
  const [tempSpellCustomType, setTempSpellCustomType] = useState('');

  const [spellSaves, setSpellSaves] = useState<string[]>([]);
  const [spellDescription, setSpellDescription] = useState('');

  // Estados de KIT
  const [kitTargetClasses, setKitTargetClasses] = useState<string[]>([]);
  const [tempKitClass, setTempKitClass] = useState('');
  const [kitClassSearch, setKitClassSearch] = useState('');
  const [kitItems, setKitItems] = useState<{name: string, qty: number}[]>([]);
  const [dbItemsCatalog, setDbItemsCatalog] = useState<any[]>([]);
  const [kitItemModalVisible, setKitItemModalVisible] = useState(false);
  const [kitItemSearch, setKitItemSearch] = useState('');

  // Estados do Acervo
  const [acervoFilter, setAcervoFilter] = useState('Todos');
  const [myCreations, setMyCreations] = useState<any[]>([]);
  const [selectedAcervo, setSelectedAcervo] = useState<string[]>([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const classes = await db.getAllAsync<{name: string}>('SELECT name FROM classes ORDER BY name');
        const items = await db.getAllAsync('SELECT * FROM items ORDER BY name');
        setDbClasses(classes);
        setDbItemsCatalog(items);
        
        if(classes.length > 0) {
          setTempSpellClass(classes[0].name);
          setTempSubclassParent(classes[0].name);
        }
      } catch (e) {}
    }
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'Acervo') loadAcervo();
  }, [activeTab, acervoFilter]);

  const loadAcervo = async () => {
    try {
      const tableMap: Record<string, string> = { 'Item': 'items', 'Raça': 'races', 'Classe': 'classes', 'Subclasse': 'subclasses', 'Magia/Skill': 'spells', 'Kit': 'starting_kits' };
      let data: any[] = [];
      const fetchTable = async (label: string, tableName: string) => {
        const rows = await db.getAllAsync(`SELECT * FROM ${tableName} WHERE criador IN ('proprio', 'importado')`);
        return rows.map((r: any) => ({ ...r, type: label, tableName }));
      };
      if (acervoFilter === 'Todos') {
        for (const [label, tableName] of Object.entries(tableMap)) { data = [...data, ...(await fetchTable(label, tableName))]; }
      } else data = await fetchTable(acervoFilter, tableMap[acervoFilter]);
      
      setMyCreations(data);
      setSelectedAcervo([]); 
    } catch (e) {}
  };

  const deleteCreation = async (id: number, itemName: string, tableName: string) => {
    Alert.alert("Confirmação", `Deseja deletar "${itemName}" permanentemente?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Deletar", style: "destructive", onPress: async () => {
          await db.runAsync(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
          loadAcervo();
      }}
    ]);
  };

  const toggleSelection = (uniqueId: string) => setSelectedAcervo(prev => prev.includes(uniqueId) ? prev.filter(i => i !== uniqueId) : [...prev, uniqueId]);
  
  // ================= SISTEMA DE IMPORTAÇÃO E EXPORTAÇÃO =================

  const handleExport = async () => {
    if (selectedAcervo.length === 0) {
      Alert.alert("Aviso", "Selecione pelo menos um item da lista para exportar.");
      return;
    }
    
    try {
      const itemsToExport = myCreations.filter(item => selectedAcervo.includes(`${item.tableName}-${item.id}`));
      const jsonData = JSON.stringify(itemsToExport, null, 2);
      
      const fileUri = documentDirectory + 'acervo_dnd.json';
      await writeAsStringAsync(fileUri, jsonData, { encoding: EncodingType.UTF8 });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("Erro", "O compartilhamento não está disponível neste dispositivo.");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Erro", "Falha ao gerar arquivo de exportação.");
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ 
        type: ['application/json', '*/*'],
        copyToCacheDirectory: true
      });
      
      if (result.canceled) return;
      
      const fileUri = result.assets[0].uri;
      
      const fileContent = await readAsStringAsync(fileUri, { encoding: EncodingType.UTF8 });
      const importedData = JSON.parse(fileContent);
      
      if (!Array.isArray(importedData)) {
        Alert.alert("Erro", "Formato de arquivo inválido. O arquivo deve ser um JSON válido gerado pelo aplicativo.");
        return;
      }

      let importedCount = 0;

      for (const item of importedData) {
        if (!item.tableName || !item.name) continue; 
        if (!VALID_TABLES.includes(item.tableName)) continue; 
        
        const { tableName, type, id, ...fields } = item;
        fields.criador = 'importado';
        
        // Verifica se a tabela destino possui as mesmas colunas (proteção contra BD antigo)
        try{
          const keys = Object.keys(fields);
          const values = Object.values(fields) as any[];
          const placeholders = keys.map(() => '?').join(', ');
          
          const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
          await db.runAsync(query, values);
          importedCount++;
        } catch (dbError) {
          console.warn(`Item duplicado ou coluna ausente: ${item.name}`);
        }
      }
      
      Alert.alert("Sucesso!", `${importedCount} conteúdos importados para o seu mundo.`);
      loadAcervo();

    } catch (error) {
      console.error(error);
      Alert.alert("Erro", "Falha ao ler ou processar o arquivo.");
    }
  };

  // ================= FIM DO SISTEMA =================

  const resetForms = () => {
    setName(''); setWeight('1'); setItemCategory('Arma'); setProperties([]); setItemEffects([]); setTempEffVal(''); setTempEffType('Cortante'); setTempEffDuration(''); setTempEffTurns(''); setItemDescription('');
    setStats({ FOR: '0', DES: '0', CON: '0', INT: '0', SAB: '0', CAR: '0' }); setSpeed('9m'); setHitDice('8'); setGold('10'); setSubclassLevel('3'); setIsCaster(false); setSaves([]);
    
    // Reseta o estado novo
    setSubclassParents([]); setSubclassSearch(''); setTempSubclassLevel('3'); setBonusSkills('0');
    if(dbClasses.length > 0) setTempSubclassParent(dbClasses[0].name);
    
    setSpellLevel('Truque'); setSpellClassesReq([]); setSpellClassSearch(''); setTempSpellClassLvl('1');
    if(dbClasses.length > 0) setTempSpellClass(dbClasses[0].name);

    setCastTimeValue('1'); setCastTimeType('Ação'); setSpellRange('18m'); setSpellComponents(['V', 'S']); setSpellDurationValue(''); setSpellDurationType('Instantânea'); 
    setSpellEffectsList([]); setTempSpellDice(''); setTempSpellDmgType('Fogo'); setTempSpellCustomType(''); setSpellSaves([]); setSpellDescription(''); 
    
    setKitTargetClasses([]); setTempKitClass(''); setKitClassSearch(''); setKitItems([]);
  };

  const handleTabChange = (tab: string) => { setActiveTab(tab); if (tab !== 'Acervo') resetForms(); };
  const toggleArrayItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, item: string) => setter(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);
  
  const updateStat = (key: keyof typeof stats, value: string) => setStats(prev => ({ ...prev, [key]: value.replace(/[^0-9-]/g, '') }));
  const updateKitQty = (index: number, delta: number) => {
    const newKit = [...kitItems]; newKit[index].qty += delta;
    if(newKit[index].qty <= 0) newKit.splice(index, 1);
    setKitItems(newKit);
  };
  const addItemToKit = (item: any) => {
    const existingIndex = kitItems.findIndex(i => i.name === item.name);
    if (existingIndex > -1) { const newKit = [...kitItems]; newKit[existingIndex].qty += 1; setKitItems(newKit); } 
    else setKitItems([...kitItems, { name: item.name, qty: 1 }]);
    setKitItemModalVisible(false); setKitItemSearch('');
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Erro', 'O nome é obrigatório!'); return; }
    try {
      if (activeTab === 'Magia/Skill') {
        if (spellClassesReq.length === 0) { Alert.alert('Erro', 'Adicione ao menos uma classe na magia.'); return; }
        
        const finalCastTime = `${castTimeValue} ${castTimeType}`.trim();
        const finalDuration = spellDurationValue ? `${spellDurationValue} ${spellDurationType}` : spellDurationType;
        
        let damageParts: string[] = [];
        let typeParts: string[] = [];
        
        spellEffectsList.forEach(eff => {
          if (eff.type === 'Cura') {
             damageParts.push(eff.dice ? `Cura ${eff.dice}` : 'Cura');
          } else if (eff.type === 'Outro') {
             damageParts.push(eff.dice || 'Efeito Especial');
          } else {
             damageParts.push(`${eff.dice}`);
             typeParts.push(eff.type);
          }
        });

        const finalDamageDice = damageParts.length > 0 ? damageParts.join(' + ') : '-';
        const uniqueDamageTypes = Array.from(new Set(typeParts));
        const finalDamageType = uniqueDamageTypes.length > 0 ? uniqueDamageTypes.join(', ') : 'Nenhum';
        const finalSaves = spellSaves.length > 0 ? spellSaves.join(', ') : 'Nenhum';
        
        const classReqString = spellClassesReq.map(c => `${c.name}:${c.minLevel}`).join(', ');
        const justClassNames = spellClassesReq.map(c => c.name).join(',');

        await db.runAsync(
          `INSERT INTO spells (name, level, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, class_level_required, criador) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
          [name, spellLevel, justClassNames, finalCastTime, spellRange, spellComponents.join(', '), finalDuration, finalDamageDice, finalDamageType, finalSaves, spellDescription, classReqString]
        );
      }
      else if (activeTab === 'Item') {
        let damageParts: string[] = [];
        let extraProps: string[] = [];
        itemEffects.forEach(eff => {
          let suffix = eff.duration ? (eff.duration === 'Temp' && eff.turns ? ` (Temp: ${eff.turns} turnos)` : ` (${eff.duration})`) : '';
          if (eff.type === 'Escolher Atributo') damageParts.push(`Escolher ${eff.val}${suffix}`);
          else if (['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(eff.type)) damageParts.push(`${eff.type} ${eff.val}${suffix}`);
          else if (eff.type === 'Cura') damageParts.push(`Cura ${eff.val}`);
          else if (eff.type === 'Outro') damageParts.push(eff.val);
          else damageParts.push(`${eff.val} ${eff.type}`);
        });
        const finalDamage = damageParts.length > 0 ? damageParts.join(' + ') : '-';
        const finalProps = [itemCategory, ...extraProps, ...properties].filter(Boolean).join(', ');
        await db.runAsync(
          `INSERT INTO items (name, weight, damage, damage_type, properties, descricao, criador) VALUES (?, ?, ?, ?, ?, ?, 'proprio')`,
          [name, parseFloat(weight) || 0, finalDamage, '-', finalProps, itemDescription]
        );
      } 
      else if (activeTab === 'Raça') {
        const bonificadores = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, parseInt(v) || 0]));
        await db.runAsync(`INSERT INTO races (name, stat_bonuses, speed, criador) VALUES (?, ?, ?, 'proprio')`, [name, JSON.stringify(bonificadores), speed]);
      }
      else if (activeTab === 'Classe') {
        const parsedSaves = saves.map(s => `save_${s.toLowerCase()}`);
        await db.runAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster, criador) VALUES (?, '{}', '[]', ?, ?, ?, ?, ?, 'proprio')`, [name, parseInt(gold) || 0, parseInt(hitDice) || 8, JSON.stringify(parsedSaves), parseInt(subclassLevel) || 3, isCaster ? 1 : 0]);
      }
      else if (activeTab === 'Subclasse') {
        if (subclassParents.length === 0) { Alert.alert('Erro', 'Adicione ao menos uma classe pai para esta subclasse.'); return; }
        const parentNames = subclassParents.map(c => c.name).join(', ');
        const mainLevelReq = parseInt(subclassParents[0].minLevel) || 3;
        const bnsSkills = parseInt(bonusSkills) || 0;
        
        // CORREÇÃO: Insere com o novo campo 'bonus_skills'
        await db.runAsync(`INSERT INTO subclasses (name, class_name, level_required, bonus_skills, criador) VALUES (?, ?, ?, ?, 'proprio')`, [name, parentNames, mainLevelReq, bnsSkills]);
      }
      else if (activeTab === 'Kit') {
        if (kitTargetClasses.length === 0) { Alert.alert('Erro', 'Selecione pelo menos uma classe alvo para este kit.'); return; }
        if (kitItems.length === 0) { Alert.alert('Erro', 'Adicione pelo menos um item à mochila do kit.'); return; }
        
        for (const targetClass of kitTargetClasses) {
          await db.runAsync(
            `INSERT INTO starting_kits (name, target_name, target_type, items, criador) VALUES (?, ?, ?, ?, 'proprio')`, 
            [name, targetClass, 'class', JSON.stringify(kitItems)]
          );
        }
      }

      Alert.alert('Sucesso!', `${activeTab} "${name}" criado com sucesso!`);
      resetForms();
      if (activeTab === 'Classe') setDbClasses(await db.getAllAsync<{name: string}>('SELECT name FROM classes ORDER BY name'));
    } catch (error: any) { Alert.alert('Erro', 'Ocorreu um problema ao salvar. Já existe um item com esse nome, ou o banco está desatualizado.'); }
  };

  const renderItemForm = () => {
    const isAttribute = ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo'].includes(tempEffType);

    return (
      <View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>PESO (kg)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={weight} onChangeText={setWeight} />
        </View>

        <Text style={styles.label}>CATEGORIA DO ITEM</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 20}}>
          <View style={{flexDirection: 'row', gap: 10}}>
            {ITEM_CATEGORIES.map(cat => (
              <TouchableOpacity key={cat} style={[styles.toggleBtn, itemCategory === cat && styles.toggleBtnActive]} onPress={() => setItemCategory(cat)}>
                <Text style={[styles.toggleBtnText, itemCategory === cat && styles.toggleBtnTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.label}>CONSTRUTOR DE EFEITOS (Dano, Cura, Atributos)</Text>
        <View style={styles.effectBuilder}>
          <TextInput style={[styles.input, {marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.4)'}]} placeholder="Valor (Ex: 1d6, 2, +1)" placeholderTextColor="#888" value={tempEffVal} onChangeText={setTempEffVal} />
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
            <View style={{flexDirection: 'row', gap: 8}}>
              {EFFECT_CATEGORIES.map(cat => (
                <TouchableOpacity key={cat} style={[styles.limitBtn, tempEffType === cat && styles.limitBtnActive]} onPress={() => { setTempEffType(cat); setTempEffDuration(''); }}>
                  <Text style={[styles.limitBtnText, tempEffType === cat && styles.limitBtnTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {isAttribute && (
            <View style={{marginBottom: 15}}>
              <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>DURAÇÃO DO ATRIBUTO</Text>
              <View style={{flexDirection: 'row', gap: 10, alignItems: 'center'}}>
                <TouchableOpacity style={[styles.limitBtn, tempEffDuration === 'Temp' && styles.limitBtnActive]} onPress={() => setTempEffDuration(tempEffDuration === 'Temp' ? '' : 'Temp')}>
                  <Text style={[styles.limitBtnText, tempEffDuration === 'Temp' && styles.limitBtnTextActive]}>Temporário</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.limitBtn, tempEffDuration === 'Perm' && styles.limitBtnActive]} onPress={() => { setTempEffDuration(tempEffDuration === 'Perm' ? '' : 'Perm'); setTempEffTurns(''); }}>
                  <Text style={[styles.limitBtnText, tempEffDuration === 'Perm' && styles.limitBtnTextActive]}>Permanente</Text>
                </TouchableOpacity>
                
                {tempEffDuration === 'Temp' && (
                  <TextInput style={[styles.input, {flex: 1, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.4)', textAlign: 'center'}]} placeholder="Turnos (Op)" placeholderTextColor="#888" keyboardType="numeric" value={tempEffTurns} onChangeText={setTempEffTurns} />
                )}
              </View>
            </View>
          )}
          
          <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
            if(!tempEffVal) return;
            setItemEffects([...itemEffects, {val: tempEffVal, type: tempEffType, duration: isAttribute ? tempEffDuration : '', turns: tempEffTurns}]);
            setTempEffVal(''); setTempEffDuration(''); setTempEffTurns('');
          }}>
            <Text style={styles.addEffectBtnText}>+ ADICIONAR EFEITO</Text>
          </TouchableOpacity>
        </View>

        {itemEffects.length > 0 && (
          <View style={{marginBottom: 20}}>
            {itemEffects.map((eff, i) => {
              let displayText = '';
              const suffix = eff.duration ? (eff.duration === 'Temp' && eff.turns ? ` (Temp: ${eff.turns} turnos)` : ` (${eff.duration})`) : '';
              if (eff.type === 'Cura') displayText = `Cura ${eff.val}`;
              else if (eff.type === 'Outro') displayText = eff.val;
              else if (eff.type === 'Escolher Atributo') displayText = `Escolher ${eff.val}${suffix}`;
              else if (['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(eff.type)) displayText = `${eff.type} ${eff.val}${suffix}`;
              else displayText = `${eff.val} ${eff.type}`;

              return (
                <View key={i} style={styles.effectRow}>
                  <Text style={styles.effectText}>{displayText}</Text>
                  <TouchableOpacity onPress={() => setItemEffects(itemEffects.filter((_, idx) => idx !== i))}><Ionicons name="trash" size={20} color="#ff6666" /></TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.label}>PROPRIEDADES EXTRAS (Opcional)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 20}}>
          <View style={{flexDirection: 'row', gap: 10}}>
            {ITEM_PROPS.map(prop => (
              <TouchableOpacity key={prop} style={[styles.toggleBtn, properties.includes(prop) && styles.toggleBtnActive]} onPress={() => toggleArrayItem(setProperties, prop)}>
                <Text style={[styles.toggleBtnText, properties.includes(prop) && styles.toggleBtnTextActive]}>{prop}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.formGroup}>
          <Text style={styles.label}>DESCRIÇÃO / HISTÓRIA (Opcional)</Text>
          <TextInput style={[styles.input, {minHeight: 100, textAlignVertical: 'top'}]} multiline value={itemDescription} onChangeText={setItemDescription} placeholder="A lenda do item..." placeholderTextColor="#666" />
        </View>
      </View>
    );
  };

  const renderSpellForm = () => (
    <View>
      <Text style={styles.label}>NÍVEL DA MAGIA</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 20}}>
        <View style={{flexDirection: 'row', gap: 10}}>
          {SPELL_LEVELS.map(lvl => (
            <TouchableOpacity key={lvl} style={[styles.toggleBtn, spellLevel === lvl && styles.toggleBtnActive]} onPress={() => setSpellLevel(lvl)}>
              <Text style={[styles.toggleBtnText, spellLevel === lvl && styles.toggleBtnTextActive]}>{lvl}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.label}>TEMPO DE CONJURAÇÃO</Text>
      <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, alignItems: 'center'}}>
        <TextInput 
          style={[styles.input, {flex: 0.25, textAlign: 'center', paddingHorizontal: 5}]} 
          keyboardType="numeric" 
          value={castTimeValue} 
          onChangeText={setCastTimeValue} 
          placeholder="Qtd" 
          placeholderTextColor="#666"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 0.75}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {SPELL_CASTING_TIME_TYPES.map(ct => (
              <TouchableOpacity key={ct} style={[styles.limitBtn, castTimeType === ct && styles.limitBtnActive]} onPress={() => setCastTimeType(ct)}>
                <Text style={[styles.limitBtnText, castTimeType === ct && styles.limitBtnTextActive]}>{ct}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}>
          <Text style={styles.label}>ALCANCE</Text>
          <TextInput style={styles.input} value={spellRange} onChangeText={setSpellRange} placeholder="Ex: 18m, Toque" placeholderTextColor="#666"/>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop: 8}}>
            <View style={{flexDirection: 'row', gap: 5}}>
              {SPELL_RANGES.map(r => (
                <TouchableOpacity key={r} style={[styles.limitBtn, spellRange === r && styles.limitBtnActive, {paddingVertical: 4, paddingHorizontal: 8}]} onPress={() => setSpellRange(r)}>
                  <Text style={[styles.limitBtnText, spellRange === r && styles.limitBtnTextActive, {fontSize: 9}]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={[styles.formGroup, {flex: 1}]}>
          <Text style={styles.label}>COMPONENTES</Text>
          <View style={{flexDirection: 'row', gap: 10, marginTop: 10, justifyContent: 'center'}}>
            {SPELL_COMPONENTS.map(comp => (
              <TouchableOpacity key={comp} style={[styles.radioCircle, spellComponents.includes(comp) && styles.radioCircleSelected]} onPress={() => toggleArrayItem(setSpellComponents, comp)}>
                <Text style={[styles.toggleBtnText, spellComponents.includes(comp) && styles.toggleBtnTextActive]}>{comp}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.label}>DURAÇÃO</Text>
      <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, alignItems: 'center'}}>
        <TextInput 
          style={[styles.input, {flex: 0.25, textAlign: 'center', paddingHorizontal: 5}]} 
          keyboardType="numeric" 
          value={spellDurationValue} 
          onChangeText={setSpellDurationValue} 
          placeholder="Qtd" 
          placeholderTextColor="#666"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 0.75}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {SPELL_DURATION_TYPES.map(dur => (
              <TouchableOpacity key={dur} style={[styles.limitBtn, spellDurationType === dur && styles.limitBtnActive]} onPress={() => { setSpellDurationType(dur); if(dur === 'Instantânea' || dur === 'Concentração') setSpellDurationValue(''); }}>
                <Text style={[styles.limitBtnText, spellDurationType === dur && styles.limitBtnTextActive]}>{dur}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <Text style={styles.label}>CONSTRUTOR DE EFEITOS (Adicione múltiplos)</Text>
      <View style={styles.effectBuilder}>
        <TextInput style={[styles.input, {marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.4)'}]} placeholder="Valor/Dado (Ex: 8d6, +2 ou vazio)" placeholderTextColor="#888" value={tempSpellDice} onChangeText={setTempSpellDice} />
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {SPELL_DAMAGE_TYPES.map(dt => (
              <TouchableOpacity key={dt} style={[styles.limitBtn, tempSpellDmgType === dt && styles.limitBtnActive]} onPress={() => setTempSpellDmgType(dt)}>
                <Text style={[styles.limitBtnText, tempSpellDmgType === dt && styles.limitBtnTextActive]}>{dt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {tempSpellDmgType === 'Outro' && (
          <TextInput style={[styles.input, {marginBottom: 15, backgroundColor: 'rgba(0,0,0,0.4)'}]} placeholder="Qual o efeito? (Ex: Cegueira, Empurrão...)" value={tempSpellCustomType} onChangeText={setTempSpellCustomType} placeholderTextColor="#888" />
        )}
        
        <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
          const finalType = tempSpellDmgType === 'Outro' ? tempSpellCustomType : tempSpellDmgType;
          if (!finalType) { Alert.alert('Aviso', 'Defina o nome do efeito especial.'); return; }
          if (!tempSpellDice && tempSpellDmgType !== 'Outro' && tempSpellDmgType !== 'Cura') {
            Alert.alert('Aviso', 'Adicione um dado/valor para este tipo de dano.'); return; 
          }
          
          setSpellEffectsList([...spellEffectsList, {dice: tempSpellDice, type: finalType}]);
          setTempSpellDice(''); setTempSpellCustomType(''); setTempSpellDmgType('Fogo');
        }}>
          <Text style={styles.addEffectBtnText}>+ ADICIONAR EFEITO NA MAGIA</Text>
        </TouchableOpacity>
      </View>

      {spellEffectsList.length > 0 && (
        <View style={{marginBottom: 20}}>
          {spellEffectsList.map((eff, i) => {
            const displayText = eff.dice ? `${eff.dice} (${eff.type})` : `${eff.type}`;
            return (
              <View key={i} style={styles.effectRow}>
                <Text style={styles.effectText}>{displayText}</Text>
                <TouchableOpacity onPress={() => setSpellEffectsList(spellEffectsList.filter((_, idx) => idx !== i))}><Ionicons name="trash" size={20} color="#ff6666" /></TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.label}>TESTES DE RESISTÊNCIA NECESSÁRIOS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 20}}>
        <View style={{flexDirection: 'row', gap: 10}}>
          {SPELL_SAVES.map(sv => (
            <TouchableOpacity key={sv} style={[styles.toggleBtn, spellSaves.includes(sv) && styles.toggleBtnActive]} onPress={() => toggleArrayItem(setSpellSaves, sv)}>
              <Text style={[styles.toggleBtnText, spellSaves.includes(sv) && styles.toggleBtnTextActive]}>{sv}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.label}>QUAIS CLASSES APRENDEM ESSA MAGIA?</Text>
      <View style={styles.effectBuilder}>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 15, alignItems: 'center'}}>
          <TextInput style={[styles.input, {flex: 0.7, backgroundColor: 'rgba(0,0,0,0.4)', paddingVertical: 10}]} placeholder="Buscar classe..." placeholderTextColor="#666" value={spellClassSearch} onChangeText={setSpellClassSearch} />
          <TextInput style={[styles.input, {flex: 0.3, backgroundColor: 'rgba(0,0,0,0.4)', textAlign: 'center', paddingVertical: 10}]} placeholder="Nível" placeholderTextColor="#666" keyboardType="numeric" value={tempSpellClassLvl} onChangeText={setTempSpellClassLvl} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {dbClasses.filter(c => c.name.toLowerCase().includes(spellClassSearch.toLowerCase())).map(c => (
              <TouchableOpacity key={c.name} style={[styles.limitBtn, tempSpellClass === c.name && styles.limitBtnActive]} onPress={() => setTempSpellClass(c.name)}>
                <Text style={[styles.limitBtnText, tempSpellClass === c.name && styles.limitBtnTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        
        <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
          if(!tempSpellClass) { Alert.alert('Erro', 'Selecione uma classe.'); return; }
          const exists = spellClassesReq.find(c => c.name === tempSpellClass);
          if (exists) { Alert.alert('Erro', 'Essa classe já foi adicionada.'); return; }
          
          setSpellClassesReq([...spellClassesReq, {name: tempSpellClass, minLevel: tempSpellClassLvl || '1'}]);
          setTempSpellClass(''); setTempSpellClassLvl('1'); setSpellClassSearch('');
        }}>
          <Text style={styles.addEffectBtnText}>+ ADICIONAR CLASSE</Text>
        </TouchableOpacity>
      </View>

      {spellClassesReq.length > 0 && (
        <View style={{marginBottom: 20}}>
          {spellClassesReq.map((req, i) => (
            <View key={i} style={[styles.effectRow, {backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.1)'}]}>
              <Text style={styles.effectText}>{req.name} <Text style={{color: '#00bfff', fontSize: 11}}>• Nv. {req.minLevel}</Text></Text>
              <TouchableOpacity onPress={() => setSpellClassesReq(spellClassesReq.filter((_, idx) => idx !== i))}><Ionicons name="trash" size={20} color="#ff6666" /></TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.formGroup}><Text style={styles.label}>DESCRIÇÃO DA MAGIA</Text><TextInput style={[styles.input, {minHeight: 120, textAlignVertical: 'top'}]} multiline value={spellDescription} onChangeText={setSpellDescription} placeholder="Como a magia se manifesta no mundo..." placeholderTextColor="#666"/></View>
    </View>
  );

  const renderRaceForm = () => (
    <View>
      <View style={styles.formGroup}><Text style={styles.label}>DESLOCAMENTO</Text><TextInput style={styles.input} value={speed} onChangeText={setSpeed} placeholder="Ex: 9m" placeholderTextColor="#666"/></View>
      <Text style={styles.sectionTitle}>BÔNUS DE ATRIBUTOS</Text>
      <View style={styles.statsGrid}>
        {Object.keys(stats).map((key) => (
          <View key={key} style={styles.statBox}>
            <Text style={styles.statLabel}>{key}</Text>
            <TextInput style={styles.statInput} keyboardType="numeric" maxLength={2} value={stats[key as keyof typeof stats]} onChangeText={(val) => updateStat(key as keyof typeof stats, val)} />
          </View>
        ))}
      </View>
    </View>
  );

  const renderClassForm = () => (
    <View>
      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>DADO DE VIDA (d)</Text><TextInput style={styles.input} keyboardType="numeric" value={hitDice} onChangeText={setHitDice} placeholder="8" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1}]}><Text style={styles.label}>OURO INICIAL</Text><TextInput style={styles.input} keyboardType="numeric" value={gold} onChangeText={setGold} placeholder="10" placeholderTextColor="#666"/></View>
      </View>
      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>NÍVEL SUBCLASSE</Text><TextInput style={styles.input} keyboardType="numeric" value={subclassLevel} onChangeText={setSubclassLevel} placeholder="3" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1, alignItems: 'center', justifyContent: 'center'}]}>
          <Text style={styles.label}>USA MAGIA?</Text>
          <Switch value={isCaster} onValueChange={setIsCaster} trackColor={{ false: "#767577", true: "#00bfff" }} thumbColor={isCaster ? "#fff" : "#f4f3f4"} />
        </View>
      </View>
      <Text style={styles.sectionTitle}>RESISTÊNCIAS (Escolha 2)</Text>
      <View style={styles.toggleGrid}>
        {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(s => (
          <TouchableOpacity key={s} style={[styles.toggleBtn, saves.includes(s) && styles.toggleBtnActive]} onPress={() => toggleArrayItem(setSaves, s)}>
            <Text style={[styles.toggleBtnText, saves.includes(s) && styles.toggleBtnTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderSubclassForm = () => (
    <View>
      <Text style={styles.label}>CLASSES PAI DESTA SUBCLASSE</Text>
      <View style={styles.effectBuilder}>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 15, alignItems: 'center'}}>
          <TextInput style={[styles.input, {flex: 0.7, backgroundColor: 'rgba(0,0,0,0.4)', paddingVertical: 10}]} placeholder="Buscar classe..." placeholderTextColor="#666" value={subclassSearch} onChangeText={setSubclassSearch} />
          <TextInput style={[styles.input, {flex: 0.3, backgroundColor: 'rgba(0,0,0,0.4)', textAlign: 'center', paddingVertical: 10}]} placeholder="Nível" placeholderTextColor="#666" keyboardType="numeric" value={tempSubclassLevel} onChangeText={setTempSubclassLevel} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {dbClasses.filter(c => c.name.toLowerCase().includes(subclassSearch.toLowerCase())).map(c => (
              <TouchableOpacity key={c.name} style={[styles.limitBtn, tempSubclassParent === c.name && styles.limitBtnActive]} onPress={() => setTempSubclassParent(c.name)}>
                <Text style={[styles.limitBtnText, tempSubclassParent === c.name && styles.limitBtnTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        
        <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
          if(!tempSubclassParent) { Alert.alert('Erro', 'Selecione uma classe.'); return; }
          const exists = subclassParents.find(c => c.name === tempSubclassParent);
          if (exists) { Alert.alert('Erro', 'Essa classe já foi adicionada.'); return; }
          
          setSubclassParents([...subclassParents, {name: tempSubclassParent, minLevel: tempSubclassLevel || '3'}]);
          setTempSubclassParent(''); setTempSubclassLevel('3'); setSubclassSearch('');
        }}>
          <Text style={styles.addEffectBtnText}>+ ADICIONAR CLASSE PAI</Text>
        </TouchableOpacity>
      </View>

      {subclassParents.length > 0 && (
        <View style={{marginBottom: 20}}>
          {subclassParents.map((req, i) => (
            <View key={i} style={[styles.effectRow, {backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.1)'}]}>
              <Text style={styles.effectText}>{req.name} <Text style={{color: '#00bfff', fontSize: 11}}>• Nv. {req.minLevel}</Text></Text>
              <TouchableOpacity onPress={() => setSubclassParents(subclassParents.filter((_, idx) => idx !== i))}><Ionicons name="trash" size={20} color="#ff6666" /></TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* NOVO CAMPO: BÔNUS DE PERÍCIA DA SUBCLASSE */}
      <View style={styles.formGroup}>
        <Text style={styles.label}>PERÍCIAS EXTRAS (Opcional)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" 
          value={bonusSkills} 
          onChangeText={setBonusSkills} 
          placeholder="Quantas perícias o jogador ganha? (Ex: 0, 1, 3...)" 
          placeholderTextColor="#666"
        />
        <Text style={[styles.label, {color: 'rgba(255,255,255,0.4)', fontSize: 9, marginTop: 5}]}>
          *A maioria das subclasses (como Campeão ou Assassino) não concede perícias, digite 0. Subclasses como o Colégio do Conhecimento dão 3.
        </Text>
      </View>
    </View>
  );

  const renderKitForm = () => (
    <View>
      <Text style={styles.label}>CLASSES ALVO DO KIT (Adicione uma ou mais)</Text>
      
      <View style={styles.effectBuilder}>
        <TextInput style={[styles.input, {backgroundColor: 'rgba(0,0,0,0.4)', paddingVertical: 10, marginBottom: 15}]} placeholder="Buscar classe..." placeholderTextColor="#666" value={kitClassSearch} onChangeText={setKitClassSearch} />
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
          <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
            {dbClasses.filter(c => c.name.toLowerCase().includes(kitClassSearch.toLowerCase())).map(c => (
              <TouchableOpacity 
                key={c.name} 
                style={[styles.limitBtn, tempKitClass === c.name && styles.limitBtnActive]} 
                onPress={() => setTempKitClass(c.name)}
              >
                <Text style={[styles.limitBtnText, tempKitClass === c.name && styles.limitBtnTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
          if(!tempKitClass) { Alert.alert('Erro', 'Selecione uma classe na lista acima.'); return; }
          if(kitTargetClasses.includes(tempKitClass)) { Alert.alert('Aviso', 'Esta classe já foi adicionada.'); return; }
          
          setKitTargetClasses([...kitTargetClasses, tempKitClass]);
          setTempKitClass(''); 
          setKitClassSearch('');
        }}>
          <Text style={styles.addEffectBtnText}>+ ADICIONAR CLASSE AO KIT</Text>
        </TouchableOpacity>
      </View>

      {/* LISTA DE CLASSES ADICIONADAS */}
      {kitTargetClasses.length > 0 && (
        <View style={{marginBottom: 20}}>
          {kitTargetClasses.map((cls, i) => (
            <View key={i} style={[styles.effectRow, {backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.1)'}]}>
              <Text style={styles.effectText}>{cls}</Text>
              <TouchableOpacity onPress={() => setKitTargetClasses(kitTargetClasses.filter(c => c !== cls))}>
                <Ionicons name="trash" size={20} color="#ff6666" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 10}}>
        <Text style={styles.label}>ITENS NA MOCHILA</Text>
        <TouchableOpacity style={{backgroundColor: '#00bfff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8}} onPress={() => setKitItemModalVisible(true)}>
          <Text style={{color: '#02112b', fontWeight: 'bold', fontSize: 11}}>+ ADD ITEM</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardBlock}>
        {kitItems.length > 0 ? kitItems.map((item, i) => (
            <View key={i} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)'}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 15, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 8}}>
                    <TouchableOpacity onPress={() => updateKitQty(i, -1)} style={{paddingHorizontal: 12, paddingVertical: 6}}><Text style={{color: '#00bfff', fontSize: 18, fontWeight: 'bold'}}>-</Text></TouchableOpacity>
                    <Text style={{color: '#ffffff', fontSize: 16, fontWeight: 'bold', width: 20, textAlign: 'center'}}>{item.qty}</Text>
                    <TouchableOpacity onPress={() => updateKitQty(i, 1)} style={{paddingHorizontal: 12, paddingVertical: 6}}><Text style={{color: '#00bfff', fontSize: 18, fontWeight: 'bold'}}>+</Text></TouchableOpacity>
                </View>
                <Text style={{color: '#fff', fontSize: 15, fontWeight: '500', flex: 1}}>{item.name}</Text>
            </View>
        )) : <Text style={styles.emptyText}>Nenhum item adicionado ao kit.</Text>}
      </View>

      <Modal visible={kitItemModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setKitItemModalVisible(false)}>
            <Pressable style={[styles.modalContent, {height: '75%'}]} onPress={e => e.stopPropagation()}>
                <Text style={styles.modalTitle}>Catálogo do Mundo</Text>
                <TextInput style={styles.searchInput} placeholder="Buscar..." placeholderTextColor="#666" value={kitItemSearch} onChangeText={setKitItemSearch} />
                
                <FlatList
                    style={{ width: '100%', flex: 1 }}
                    data={dbItemsCatalog.filter(i => i.name.toLowerCase().includes(kitItemSearch.toLowerCase()))}
                    keyExtractor={i => i.id.toString()}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => addItemToKit(item)}>
                            <View style={{flex: 1}}>
                              <Text style={styles.catalogItemName}>
                                {item.name} {item.criador === 'proprio' || item.criador === 'importado' ? <Text style={{color: '#00bfff', fontSize: 10}}>[Custom]</Text> : null}
                              </Text>
                              <Text style={styles.catalogItemSub}>{item.weight}kg {item.damage && item.damage !== '-' && `• ⚔️ ${item.damage}`}</Text>
                            </View>
                            <Ionicons name="add-circle" size={28} color="#00bfff" />
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={<Text style={styles.emptyText}>Nenhum item encontrado.</Text>}
                />

                <TouchableOpacity style={styles.modalCloseButton} onPress={() => setKitItemModalVisible(false)}>
                  <Text style={styles.modalCloseText}>FECHAR</Text>
                </TouchableOpacity>
            </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  const renderAcervo = () => (
    <View style={{ flex: 1, minHeight: 400 }}>
      <View style={styles.acervoTabs}>
        {['Todos', 'Item', 'Raça', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit'].map(tab => (
          <TouchableOpacity key={tab} style={[styles.acervoTabBtn, acervoFilter === tab && styles.acervoTabBtnActive]} onPress={() => setAcervoFilter(tab)}>
            <Text style={[styles.acervoTabBtnText, acervoFilter === tab && styles.acervoTabBtnTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.acervoActions}>
         <TouchableOpacity style={styles.acervoActionBtn} onPress={handleImport}>
           <Ionicons name="download-outline" size={18} color="#00bfff" />
           <Text style={[styles.acervoActionText, {color: '#00bfff'}]}>Importar Ficheiro</Text>
         </TouchableOpacity>
         <TouchableOpacity style={[styles.acervoActionBtn, {borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.1)'}]} onPress={handleExport}>
           <Ionicons name="share-outline" size={18} color="#00fa9a" />
           <Text style={[styles.acervoActionText, {color: '#00fa9a'}]}>Exportar ({selectedAcervo.length})</Text>
         </TouchableOpacity>
      </View>

      {myCreations.length > 0 ? (
        myCreations.map((item) => {
          const uniqueId = `${item.tableName}-${item.id}`;
          const isSelected = selectedAcervo.includes(uniqueId);
          return (
            <TouchableOpacity key={uniqueId} style={[styles.acervoItem, isSelected && styles.acervoItemActive]} onPress={() => toggleSelection(uniqueId)}>
              <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                {isSelected && <Ionicons name="checkmark" size={14} color="#02112b" />}
              </View>
              <View style={{flex: 1}}>
                <Text style={styles.acervoItemTitle}>{item.name}</Text>
                <Text style={styles.acervoItemSub}>{item.type.toUpperCase()} • criador - {item.criador}</Text>
              </View>
              <TouchableOpacity style={styles.acervoDeleteBtn} onPress={() => deleteCreation(item.id, item.name, item.tableName)}>
                <Ionicons name="trash" size={20} color="#ff6666" />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })
      ) : (
        <Text style={styles.emptyText}>Você ainda não possui conteúdos salvos.</Text>
      )}
    </View>
  );

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={28} color="#fff" /></TouchableOpacity>
        <Text style={styles.topBarTitle}>FERRAMENTAS DO MESTRE</Text>
        <View style={{width: 28}} />
      </View>
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>
          {CATEGORIES.map(tab => (
            <TouchableOpacity key={tab} style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} onPress={() => handleTabChange(tab)}>
              <Text style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeTab !== 'Acervo' ? (
            <>
              <View style={styles.cardBlock}>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>NOME DO(A) {activeTab.toUpperCase()}</Text>
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={`Ex: ${activeTab === 'Magia/Skill' ? 'Bola de Fogo' : 'Necromante'}...`} placeholderTextColor="#666" />
                </View>

                {activeTab === 'Item' && renderItemForm()}
                {activeTab === 'Raça' && renderRaceForm()}
                {activeTab === 'Classe' && renderClassForm()}
                {activeTab === 'Subclasse' && renderSubclassForm()}
                {activeTab === 'Magia/Skill' && renderSpellForm()}
                {activeTab === 'Kit' && renderKitForm()}
              </View>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Ionicons name="save-outline" size={20} color="#02112b" />
                <Text style={styles.saveBtnText}>CRIAR E SALVAR</Text>
              </TouchableOpacity>
            </>
          ) : (
            renderAcervo()
          )}
          <View style={{height: 50}}/>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingTop: 50, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topBarTitle: { color: '#00fa9a', fontSize: 16, fontWeight: 'bold' },
  tabsContainer: { paddingVertical: 15, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tabBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)' },
  tabBtnActive: { backgroundColor: '#00bfff' },
  tabBtnText: { color: 'rgba(255,255,255,0.5)', fontWeight: 'bold' },
  tabBtnTextActive: { color: '#02112b' },
  scrollContent: { padding: 20 },
  cardBlock: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20, marginBottom: 20 },
  formGroup: { marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: 'bold', color: '#00bfff', marginBottom: 8, letterSpacing: 1 },
  input: { backgroundColor: 'rgba(0, 0, 0, 0.3)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16, color: '#ffffff' },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', color: '#fff', marginBottom: 15, marginTop: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  statBox: { width: '30%', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 12, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 14, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.5)', marginBottom: 5 },
  statInput: { fontSize: 24, fontWeight: 'bold', color: '#ffffff', textAlign: 'center' },
  toggleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleBtn: { paddingVertical: 10, paddingHorizontal: 15, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  toggleBtnActive: { backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff' },
  toggleBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  toggleBtnTextActive: { color: '#00bfff' },
  limitBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  limitBtnActive: { backgroundColor: 'rgba(0,250,154,0.1)', borderColor: '#00fa9a' },
  limitBtnText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
  limitBtnTextActive: { color: '#00fa9a' },
  effectBuilder: { backgroundColor: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  addEffectBtn: { backgroundColor: 'rgba(0, 191, 255, 0.1)', borderWidth: 1, borderColor: '#00bfff', padding: 12, borderRadius: 8, alignItems: 'center' },
  addEffectBtnText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  effectRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', padding: 15, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  effectText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  saveBtn: { backgroundColor: '#00fa9a', padding: 18, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  saveBtnText: { color: '#02112b', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  acervoTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 15, justifyContent: 'center' },
  acervoTabBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8 },
  acervoTabBtnActive: { backgroundColor: 'rgba(0,250,154,0.2)', borderWidth: 1, borderColor: '#00fa9a' },
  acervoTabBtnText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 'bold' },
  acervoTabBtnTextActive: { color: '#00fa9a' },
  acervoActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  acervoActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(0,191,255,0.1)', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  acervoActionText: { fontSize: 12, fontWeight: 'bold' },
  acervoItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  acervoItemActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.05)' },
  acervoItemTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  acervoItemSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4, textTransform: 'uppercase', fontWeight: 'bold' },
  acervoDeleteBtn: { padding: 10, backgroundColor: 'rgba(255,100,100,0.1)', borderRadius: 8, marginLeft: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginRight: 15, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: '#00fa9a', borderColor: '#00fa9a' },
  emptyText: { color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)' },
  modalContent: { backgroundColor: '#102b56', borderRadius: 24, padding: 20, alignItems: 'center', width: '90%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff', marginBottom: 15 },
  searchInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', width: '100%' },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' },
  catalogItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  catalogItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  catalogItemSub: { color: 'rgba(0,191,255,0.5)', fontSize: 12, marginTop: 2 },
  radioCircle: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  radioCircleSelected: { backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff' },
});