// ================= IMPORTAÇÕES DA CAMADA BÁSICA =================
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { EffectDraft, EffectDurationUnit, EffectKind, EffectValueMode, formatEffectSummary } from '../types/effects';

// ================= TIPAGENS =================
type SpellClassReq = { name: string; minLevel: string }; 
type SelectedFeature = { name: string; level: string };
type SpellItem = { id: number; name: string; level: string; category?: string; casting_time?: string; range?: string; damage?: string; description?: string; classes?: string; };
type AdvancedEffectDraft = EffectDraft & { label?: string };
type ConditionCatalogItem = { id: number; name: string; description?: string | null; color: string; criador?: string | null };

const CATEGORIES = ['Item', 'Raça', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit', 'Acervo'];
const ITEM_CATEGORIES = ['Arma', 'Armadura', 'Escudo', 'Anel', 'Amuleto', 'Capacete', 'Capa', 'Bota', 'Luva', 'Consumível', 'Ferramenta', 'Mochila/Saco', 'Outro'];
const ITEM_PROPS = ['Acuidade', 'Leve', 'Pesada', 'Duas mãos', 'Versátil', 'Arremesso', 'Munição', 'Alcance', 'Recarga', 'Especial', 'Foco Arcano', 'Foco Divino', 'Foco Druídico', 'Consumível', 'Mágico'];

const SPELL_COMPONENTS = ['V', 'S', 'M'];
const SPELL_DURATION_TYPES = ['Instantânea', 'Rodada(s)', 'Minuto(s)', 'Hora(s)', 'Dia(s)', 'Concentração', 'Permanente'];
const SPELL_SAVES = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const SPELL_DAMAGE_TYPES = ['Cortante', 'Perfurante', 'Concussão', 'Fogo', 'Frio', 'Veneno', 'Ácido', 'Psíquico', 'Necrótico', 'Radiante', 'Elétrico', 'Trovejante', 'Força', 'Cura', 'Outro'];

const VALID_TABLES = ['items', 'effects', 'races', 'classes', 'subclasses', 'spells', 'starting_kits', 'spellcasting_progression'];
const RANGE_UNITS = ['m', 'km', 'cm'];
const STRUCTURED_RANGES = ['Pessoal', 'Toque', 'Distancia', 'Cubo', 'Cone', 'Linha'];
const EFFECT_KINDS: { value: EffectKind; label: string }[] = [
  { value: 'damage', label: 'Dano' },
  { value: 'healing', label: 'Cura' },
  { value: 'condition', label: 'Condicao' },
  { value: 'stat_modifier', label: 'Atributo/CA' },
  { value: 'utility', label: 'Utilidade' },
];
const DAMAGE_TYPES = ['Cortante', 'Perfurante', 'Concussao', 'Fogo', 'Frio', 'Veneno', 'Acido', 'Psiquico', 'Necrotico', 'Radiante', 'Eletrico', 'Trovejante', 'Forca'];
const CONDITIONS = ['Envenenado', 'Cego', 'Surdo', 'Paralisado', 'Atordoado', 'Caido', 'Agarrado', 'Amedrontado', 'Encantado', 'Inconsciente'];
const STAT_EFFECT_TYPES = ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo'];
const UTILITY_EFFECT_TYPES = ['Luz', 'Empurrao', 'Derrubar', 'Vantagem', 'Desvantagem', 'Teleporte', 'Invocar'];
const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const DURATION_UNITS: { value: EffectDurationUnit; label: string }[] = [
  { value: 'instant', label: 'Instantaneo' },
  { value: 'turn', label: 'Turnos' },
  { value: 'round', label: 'Rodadas' },
  { value: 'minute', label: 'Minutos' },
  { value: 'hour', label: 'Horas' },
  { value: 'day', label: 'Dias' },
  { value: 'permanent', label: 'Permanente' },
];
const MASTER_TOOL_CATEGORIES = [...CATEGORIES.slice(0, -1), 'Efeitos', 'Acervo'];
const IMPORT_VALID_TABLES = [...VALID_TABLES, 'condition_effects'];
const CONDITION_COLOR_PALETTE = ['#7ED957', '#F4A84D', '#8B5CF6', '#EF4444', '#38BDF8', '#FACC15', '#EC4899', '#64748B'];
const CONDITION_EFFECT_PAGE_SIZE = 20;
const CONDITION_GRADIENT_PALETTE = [
  { name: 'Veneno', color: '#7ED957', colors: ['#163B22', '#7ED957', '#D4FF77'] },
  { name: 'Fogo', color: '#F97316', colors: ['#4A1208', '#F97316', '#FACC15'] },
  { name: 'Arcano', color: '#8B5CF6', colors: ['#20134A', '#8B5CF6', '#38BDF8'] },
  { name: 'Sangue', color: '#EF4444', colors: ['#3F0D12', '#EF4444', '#FB7185'] },
  { name: 'Gelo', color: '#38BDF8', colors: ['#082F49', '#38BDF8', '#DDFBFF'] },
  { name: 'Luz', color: '#FACC15', colors: ['#4A3904', '#FACC15', '#FFFFFF'] },
  { name: 'Psiquico', color: '#EC4899', colors: ['#3D0D2B', '#EC4899', '#F0ABFC'] },
  { name: 'Sombra', color: '#64748B', colors: ['#020617', '#475569', '#94A3B8'] },
];
const isValidHexColor = (value: string) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
const normalizeHexColorInput = (value: string) => {
  const cleaned = value.replace(/[^0-9a-fA-F#]/g, '');
  const withoutHash = cleaned.replace(/#/g, '').slice(0, 6);
  return `#${withoutHash}`;
};

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
  const [itemEffects, setItemEffects] = useState<AdvancedEffectDraft[]>([]);
  const [itemDescription, setItemDescription] = useState(''); 
  
  const [tempEffType, setTempEffType] = useState('Cortante');
  const [tempEffectKind, setTempEffectKind] = useState<EffectKind>('damage');
  const [tempValueMode, setTempValueMode] = useState<EffectValueMode>('dice');
  const [tempDiceCount, setTempDiceCount] = useState('1');
  const [tempDiceSides, setTempDiceSides] = useState('8');
  const [tempDiceBonus, setTempDiceBonus] = useState('0');
  const [tempFixedValue, setTempFixedValue] = useState('1');
  const [tempChancePercent, setTempChancePercent] = useState('100');
  const [tempDurationValue, setTempDurationValue] = useState('1');
  const [tempDurationUnit, setTempDurationUnit] = useState<EffectDurationUnit>('instant');

  // Estados de Raça & Classe
  const [stats, setStats] = useState({ FOR: '0', DES: '0', CON: '0', INT: '0', SAB: '0', CAR: '0' });
  const [speed, setSpeed] = useState('9m');
  const [hitDice, setHitDice] = useState('8');
  const [gold, setGold] = useState('10');
  const [subclassLevel, setSubclassLevel] = useState('3');
  const [isCaster, setIsCaster] = useState(false);
  const [saves, setSaves] = useState<string[]>([]);
  
  // Estados de Passivas
  const [selectedFeatures, setSelectedFeatures] = useState<SelectedFeature[]>([]);
  const [featureModalVisible, setFeatureModalVisible] = useState(false);
  const [featureSearch, setFeatureSearch] = useState('');
  const [dbFeatures, setDbFeatures] = useState<{name: string, description: string}[]>([]);
  
  // Estados de Subclasse
  const [subclassParents, setSubclassParents] = useState<SpellClassReq[]>([]);
  const [subclassSearch, setSubclassSearch] = useState('');
  const [tempSubclassParent, setTempSubclassParent] = useState('');
  const [tempSubclassLevel, setTempSubclassLevel] = useState('3');
  const [dbClasses, setDbClasses] = useState<{name: string}[]>([]);
  const [bonusSkills, setBonusSkills] = useState('0');

  // Estados de Magia/Skill
  const [spellCategory, setSpellCategory] = useState('Magia');
  const [spellLevel, setSpellLevel] = useState('Truque');
  const [spellClassesReq, setSpellClassesReq] = useState<SpellClassReq[]>([]);
  const [spellClassSearch, setSpellClassSearch] = useState('');
  const [tempSpellClass, setTempSpellClass] = useState('');
  const [tempSpellClassLvl, setTempSpellClassLvl] = useState('1');
  const [castTimeValue, setCastTimeValue] = useState('1');
  const [castTimeType, setCastTimeType] = useState('Ação');
  const [spellRangeShape, setSpellRangeShape] = useState('Distancia');
  const [spellRangeValue, setSpellRangeValue] = useState('18');
  const [spellRangeUnit, setSpellRangeUnit] = useState('m');
  const [spellComponents, setSpellComponents] = useState<string[]>(['V', 'S']);
  const [spellDurationValue, setSpellDurationValue] = useState('');
  const [spellDurationType, setSpellDurationType] = useState('Instantânea');
  const [spellEffectsList, setSpellEffectsList] = useState<AdvancedEffectDraft[]>([]);
  const [tempSpellDmgType, setTempSpellDmgType] = useState('Fogo');
  const [spellSaves, setSpellSaves] = useState<string[]>([]);
  const [spellDescription, setSpellDescription] = useState('');

  // Estados de Progressão de Magia
  const [casterType, setCasterType] = useState<'total' | 'meio' | 'terco' | 'pacto'>('total');
  const [progressionModalVisible, setProgressionModalVisible] = useState(false);

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
  const [conditionCatalog, setConditionCatalog] = useState<ConditionCatalogItem[]>([]);
  const [conditionDescription, setConditionDescription] = useState('');
  const [conditionColor, setConditionColor] = useState('#F4A84D');
  const [conditionSearch, setConditionSearch] = useState('');
  const [conditionPage, setConditionPage] = useState(0);

  const loadConditionCatalog = async () => {
    try {
      const rows = await db.getAllAsync<ConditionCatalogItem>('SELECT id, name, description, color, criador FROM condition_effects ORDER BY name');
      setConditionCatalog(rows.map(row => ({
        ...row,
        color: isValidHexColor(row.color || '') ? row.color : '#F4A84D',
      })));
    } catch (error) {
      setConditionCatalog([]);
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const classes = await db.getAllAsync<{name: string}>('SELECT name FROM classes ORDER BY name');
        const items = await db.getAllAsync('SELECT * FROM items ORDER BY name');
        const features = await db.getAllAsync<{name: string, description: string}>(
          "SELECT name, description FROM spells WHERE level = 'Passiva' OR casting_time = 'Passiva' ORDER BY name"
        );
        
        setDbClasses(classes);
        setDbItemsCatalog(items);
        setDbFeatures(features);
        await loadConditionCatalog();
        
        if(classes.length > 0) {
          setTempSpellClass(classes[0].name);
          setTempSubclassParent(classes[0].name);
        }
      } catch (e) {}
    }
    fetchData();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'Acervo') loadAcervo();
  }, [activeTab, acervoFilter]);

  const loadAcervo = async () => {
    try {
      const tableMap: Record<string, string> = { 'Item': 'items', 'Raça': 'races', 'Classe': 'classes', 'Subclasse': 'subclasses', 'Magia/Skill': 'spells', 'Kit': 'starting_kits' };
      let data: any[] = [];
      tableMap.Efeitos = 'condition_effects';
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
          if(tableName === 'items' || tableName === 'spells') {
              await db.runAsync(`DELETE FROM effects WHERE source_table = ?AND source_id = ?`, [tableName, id]);
          }
          if(tableName === 'classes' || tableName === 'subclasses' || tableName === 'races') {
              await db.runAsync(`DELETE FROM spellcasting_progression WHERE source_name = ?`, [itemName]);
          }
          loadAcervo();
      }}
    ]);
  };

  const toggleSelection = (uniqueId: string) => setSelectedAcervo(prev => prev.includes(uniqueId) ?prev.filter(i => i !== uniqueId) : [...prev, uniqueId]);
  
  // ================= SISTEMA DE IMPORTAÇÃO E EXPORTAÇÃO =================

  const handleExport = async () => {
    if (selectedAcervo.length === 0) {
      Alert.alert("Aviso", "Selecione pelo menos um item da lista para exportar.");
      return;
    }
    
    try {
      let itemsToExport = myCreations.filter(item => selectedAcervo.includes(`${item.tableName}-${item.id}`));
      const effectsToExport: any[] = [];
      for (const item of itemsToExport) {
        if (item.tableName === 'items' || item.tableName === 'spells') {
          const rows = await db.getAllAsync(`SELECT * FROM effects WHERE source_table = ?AND source_id = ?ORDER BY sort_order ASC`, [item.tableName, item.id]);
          effectsToExport.push(...rows.map((effect: any) => ({ ...effect, type: 'Efeito', tableName: 'effects' })));
        }
      }
      itemsToExport = [...itemsToExport, ...effectsToExport];
      
      const classesToExport = itemsToExport.filter(i => i.tableName === 'classes' || i.tableName === 'subclasses' || i.tableName === 'races').map(i => i.name);
      
      if (classesToExport.length > 0) {
         const placeholders = classesToExport.map(() => '?').join(',');
         const progressions = await db.getAllAsync(`SELECT * FROM spellcasting_progression WHERE source_name IN (${placeholders})`, classesToExport);
         if (progressions.length > 0) {
             const progData = progressions.map((p: any) => ({ ...p, type: 'Progressão Mágica', tableName: 'spellcasting_progression' }));
             itemsToExport = [...itemsToExport, ...progData];
         }
      }

      const jsonData = JSON.stringify(itemsToExport, null, 2);
      const fileUri = documentDirectory + 'acervo_dnd.json';
      await writeAsStringAsync(fileUri, jsonData, { encoding: EncodingType.UTF8 });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("Erro", "O compartilhamento não está disponível neste dispositivo.");
      }
    } catch (error) {
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
        if (!item.tableName || (!item.name && item.tableName !== 'spellcasting_progression')) continue; 
        if (!IMPORT_VALID_TABLES.includes(item.tableName)) continue;
        
        const { tableName, type, id, ...fields } = item;
        fields.criador = 'importado';

        if (tableName === 'effects' && typeof fields.source_table === 'string' && typeof fields.source_name === 'string') {
          if (fields.source_table === 'items' || fields.source_table === 'spells') {
            const source = await db.getFirstAsync<{ id: number }>(
              `SELECT id FROM ${fields.source_table} WHERE name = ?LIMIT 1`,
              [fields.source_name]
            );
            if (source?.id) fields.source_id = source.id;
          }
        }
        
        try{
          const keys = Object.keys(fields);
          const values = Object.values(fields) as any[];
          const placeholders = keys.map(() => '?').join(', ');
          
          const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
          await db.runAsync(query, values);
          importedCount++;
        } catch (dbError) {
          console.warn(`Item ignorado (provável duplicata): ${item.name || item.source_name}`);
        }
      }
      
      Alert.alert("Sucesso!", `${importedCount} conteúdos importados para o seu mundo.`);
      loadAcervo();
    } catch (error) { Alert.alert("Erro", "Falha ao ler ou processar o arquivo."); }
  };

  // ================= FIM DO SISTEMA =================

  const resetForms = () => {
    setName(''); setWeight('1'); setItemCategory('Arma'); setProperties([]); setItemEffects([]); setTempEffType('Cortante'); setItemDescription(''); resetEffectDraft();
    setStats({ FOR: '0', DES: '0', CON: '0', INT: '0', SAB: '0', CAR: '0' }); setSpeed('9m'); setHitDice('8'); setGold('10'); setSubclassLevel('3'); setIsCaster(false); setSaves([]);
    setSubclassParents([]); setSubclassSearch(''); setTempSubclassLevel('3'); setBonusSkills('0');
    if(dbClasses.length > 0) setTempSubclassParent(dbClasses[0].name);
    setSpellCategory('Magia'); setSpellLevel('Truque'); setSpellClassesReq([]); setSpellClassSearch(''); setTempSpellClassLvl('1');
    if(dbClasses.length > 0) setTempSpellClass(dbClasses[0].name);
    setCastTimeValue('1'); setCastTimeType('Ação'); setSpellRangeShape('Distancia'); setSpellRangeValue('18'); setSpellRangeUnit('m'); setSpellComponents(['V', 'S']); setSpellDurationValue(''); setSpellDurationType('Instantânea'); 
    setSpellEffectsList([]); setTempSpellDmgType('Fogo'); setSpellSaves([]); setSpellDescription(''); 
    setKitTargetClasses([]); setTempKitClass(''); setKitClassSearch(''); setKitItems([]);
    setSelectedFeatures([]); setCasterType('total');
    setConditionDescription(''); setConditionColor('#F4A84D');
  };

  const handleTabChange = (tab: string) => { setActiveTab(tab); if (tab !== 'Acervo') resetForms(); };
  const toggleArrayItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, item: string) => setter(prev => prev.includes(item) ?prev.filter(i => i !== item) : [...prev, item]);
  const onlyInt = (value: string) => value.replace(/[^0-9-]/g, '');
  const onlyPositiveInt = (value: string) => value.replace(/[^0-9]/g, '');
  const onlyDecimal = (value: string) => value.replace(/[^0-9.,]/g, '').replace(',', '.');
  const clampNumber = (value: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(value || fallback) || fallback));

  const getEffectTypeOptions = (kind: EffectKind) => {
    if (kind === 'damage') return DAMAGE_TYPES;
    if (kind === 'healing') return ['Cura'];
    if (kind === 'condition') return conditionCatalog.length > 0 ? conditionCatalog.map(effect => effect.name) : CONDITIONS;
    if (kind === 'stat_modifier') return STAT_EFFECT_TYPES;
    return UTILITY_EFFECT_TYPES;
  };

  const makeStructuredEffect = (): AdvancedEffectDraft => {
    const typeOptions = getEffectTypeOptions(tempEffectKind);
    const effectType = typeOptions.includes(tempEffType) ?tempEffType : typeOptions[0];
    const valueMode = tempEffectKind === 'condition' || tempEffectKind === 'utility' ?'none' : tempValueMode;
    const durationUnit = tempDurationUnit;
    const selectedCondition = tempEffectKind === 'condition' ? conditionCatalog.find(effect => effect.name === effectType) : null;

    return {
      effect_kind: tempEffectKind,
      effect_type: tempEffectKind === 'condition' ?'Condicao' : effectType,
      condition_name: tempEffectKind === 'condition' ?effectType : null,
      value_mode: valueMode,
      dice_count: valueMode === 'dice' ?clampNumber(tempDiceCount, 1, 1, 99) : null,
      dice_sides: valueMode === 'dice' ?clampNumber(tempDiceSides, 8, 2, 100) : null,
      dice_bonus: valueMode === 'dice' ?clampNumber(tempDiceBonus, 0, -99, 99) : 0,
      fixed_value: valueMode === 'fixed' ?clampNumber(tempFixedValue, 1, -999, 999) : null,
      chance_percent: clampNumber(tempChancePercent, 100, 0, 100),
      duration_value: durationUnit === 'instant' || durationUnit === 'permanent' ?null : clampNumber(tempDurationValue, 1, 1, 999),
      duration_unit: durationUnit,
      metadata: selectedCondition ? {
        condition_id: selectedCondition.id,
        condition_color: selectedCondition.color,
        condition_description: selectedCondition.description || '',
      } : {},
    };
  };

  const resetEffectDraft = () => {
    setTempEffectKind('damage');
    setTempEffType('Cortante');
    setTempValueMode('dice');
    setTempDiceCount('1');
    setTempDiceSides('8');
    setTempDiceBonus('0');
    setTempFixedValue('1');
    setTempChancePercent('100');
    setTempDurationValue('1');
    setTempDurationUnit('instant');
  };

  const buildRangeData = () => {
    if (spellRangeShape === 'Pessoal' || spellRangeShape === 'Toque') {
      return {
        label: spellRangeShape,
        value: null,
        unit: null,
        shape: spellRangeShape,
      };
    }

    const value = clampNumber(spellRangeValue, 18, 0, 999999);
    return {
      label: spellRangeShape === 'Distancia' ?`${value}${spellRangeUnit}` : `${spellRangeShape} ${value}${spellRangeUnit}`,
      value,
      unit: spellRangeUnit,
      shape: spellRangeShape,
    };
  };

  const buildDurationData = () => {
    const unitMap: Record<string, string> = {
      'Instantânea': 'instant',
      'Rodada(s)': 'round',
      'Minuto(s)': 'minute',
      'Hora(s)': 'hour',
      'Dia(s)': 'day',
      'Concentração': 'concentration',
      'Permanente': 'permanent',
    };
    const unit = unitMap[spellDurationType] || spellDurationType;
    const value = spellDurationValue ?clampNumber(spellDurationValue, 1, 1, 999) : null;

    return {
      label: value ?`${value} ${spellDurationType}` : spellDurationType,
      value,
      unit,
    };
  };

  const insertEffects = async (sourceTable: 'items' | 'spells', sourceId: number, sourceName: string, effects: AdvancedEffectDraft[]) => {
    for (const [index, effect] of effects.entries()) {
      await db.runAsync(
        `INSERT INTO effects (
          source_table, source_id, source_name, trigger, effect_kind, effect_type, condition_name,
          value_mode, dice_count, dice_sides, dice_bonus, fixed_value, chance_percent,
          duration_value, duration_unit, target, stacking, notes, metadata, sort_order, criador
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
        [
          sourceTable,
          sourceId,
          sourceName,
          'on_use',
          effect.effect_kind,
          effect.effect_type,
          effect.condition_name || null,
          effect.value_mode,
          effect.dice_count || null,
          effect.dice_sides || null,
          effect.dice_bonus || 0,
          effect.fixed_value === undefined ? null : effect.fixed_value,
          effect.chance_percent,
          effect.duration_value || null,
          effect.duration_unit,
          effect.target || null,
          null,
          effect.notes || null,
          JSON.stringify(effect.metadata || {}),
          index,
        ]
      );
    }
  };
  
  const updateStat = (key: keyof typeof stats, value: string) => setStats(prev => ({ ...prev, [key]: onlyInt(value) }));
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

  const toggleFeature = (featName: string) => {
    if (selectedFeatures.some(f => f.name === featName)) {
      setSelectedFeatures(selectedFeatures.filter(f => f.name !== featName));
    } else {
      setSelectedFeatures([...selectedFeatures, { name: featName, level: '1' }]);
    }
  };

  const updateSelectedFeatureLevel = (featName: string, level: string) => {
    const safeLevel = onlyPositiveInt(level);
    setSelectedFeatures(prev => prev.map(feature => (
      feature.name === featName ? { ...feature, level: safeLevel } : feature
    )));
  };

  const buildFeatureRequirementsPayload = () => JSON.stringify(
    selectedFeatures.map(feature => ({
      name: feature.name,
      level_required: Math.max(1, parseInt(feature.level || '1', 10) || 1),
    }))
  );


  const renderStructuredEffectBuilder = (
    effects: AdvancedEffectDraft[],
    setEffects: React.Dispatch<React.SetStateAction<AdvancedEffectDraft[]>>
  ) => {
    const typeOptions = getEffectTypeOptions(tempEffectKind);
    const selectedType = typeOptions.includes(tempEffType) ?tempEffType : typeOptions[0];
    const needsValue = tempEffectKind === 'damage' || tempEffectKind === 'healing' || tempEffectKind === 'stat_modifier';
    const usesDuration = tempEffectKind === 'condition' || tempEffectKind === 'stat_modifier' || tempDurationUnit !== 'instant';

    return (
      <>
        <Text style={styles.label}>CONSTRUTOR DE EFEITOS</Text>
        <View style={styles.effectBuilder}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {EFFECT_KINDS.map(kind => (
                <TouchableOpacity
                  key={kind.value}
                  style={[styles.limitBtn, tempEffectKind === kind.value && styles.limitBtnActive]}
                  onPress={() => {
                    setTempEffectKind(kind.value);
                    const nextType = getEffectTypeOptions(kind.value)[0];
                    setTempEffType(nextType);
                    setTempValueMode(kind.value === 'condition' || kind.value === 'utility' ?'none' : 'dice');
                    if (kind.value === 'condition') setTempDurationUnit('turn');
                  }}
                >
                  <Text style={[styles.limitBtnText, tempEffectKind === kind.value && styles.limitBtnTextActive]}>{kind.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {typeOptions.map(option => {
                const condition = tempEffectKind === 'condition' ? conditionCatalog.find(effect => effect.name === option) : null;
                return (
                  <TouchableOpacity key={option} style={[styles.limitBtn, selectedType === option && styles.limitBtnActive]} onPress={() => setTempEffType(option)}>
                    <View style={styles.effectOptionContent}>
                      {condition ? <View style={[styles.effectColorDot, { backgroundColor: condition.color }]} /> : null}
                      <Text style={[styles.limitBtnText, selectedType === option && styles.limitBtnTextActive]}>{option}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {needsValue && (
            <View style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {(['dice', 'fixed'] as EffectValueMode[]).map(mode => (
                  <TouchableOpacity key={mode} style={[styles.limitBtn, tempValueMode === mode && styles.limitBtnActive]} onPress={() => setTempValueMode(mode)}>
                    <Text style={[styles.limitBtnText, tempValueMode === mode && styles.limitBtnTextActive]}>{mode === 'dice' ?'Dado' : 'Valor fixo'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {tempValueMode === 'dice' ?(
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <TextInput style={[styles.input, { flex: 1, textAlign: 'center' }]} keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempDiceCount} onChangeText={v => setTempDiceCount(onlyPositiveInt(v))} placeholder="Qtd" placeholderTextColor="#666" />
                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>d</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 2 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {DICE_SIDES.map(side => (
                          <TouchableOpacity key={side} style={[styles.limitBtn, tempDiceSides === String(side) && styles.limitBtnActive]} onPress={() => setTempDiceSides(String(side))}>
                            <Text style={[styles.limitBtnText, tempDiceSides === String(side) && styles.limitBtnTextActive]}>d{side}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                  <TextInput style={[styles.input, { textAlign: 'center' }]} keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempDiceBonus} onChangeText={v => setTempDiceBonus(onlyInt(v))} placeholder="Bonus do dado (opcional)" placeholderTextColor="#666" />
                </View>
              ) : (
                <TextInput style={[styles.input, { textAlign: 'center' }]} keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempFixedValue} onChangeText={v => setTempFixedValue(onlyInt(v))} placeholder="Valor" placeholderTextColor="#666" />
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { fontSize: 9 }]}>CHANCE (%)</Text>
              <TextInput style={[styles.input, { textAlign: 'center' }]} keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempChancePercent} onChangeText={v => setTempChancePercent(onlyPositiveInt(v))} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { fontSize: 9 }]}>DURACAO</Text>
              <TextInput
                style={[styles.input, { textAlign: 'center', opacity: tempDurationUnit === 'instant' || tempDurationUnit === 'permanent' ?0.45 : 1 }]}
                keyboardType="numeric" selectTextOnFocus textAlign="center"
                editable={tempDurationUnit !== 'instant' && tempDurationUnit !== 'permanent'}
                value={tempDurationUnit === 'instant' || tempDurationUnit === 'permanent' ?'' : tempDurationValue}
                onChangeText={v => setTempDurationValue(onlyPositiveInt(v))}
                placeholder="Qtd"
                placeholderTextColor="#666"
              />
            </View>
          </View>

          {(usesDuration || true) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {DURATION_UNITS.map(unit => (
                  <TouchableOpacity key={unit.value} style={[styles.limitBtn, tempDurationUnit === unit.value && styles.limitBtnActive]} onPress={() => setTempDurationUnit(unit.value)}>
                    <Text style={[styles.limitBtnText, tempDurationUnit === unit.value && styles.limitBtnTextActive]}>{unit.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.addEffectBtn}
            onPress={() => {
              const effect = makeStructuredEffect();
              setEffects([...effects, effect]);
              resetEffectDraft();
            }}
          >
            <Text style={styles.addEffectBtnText}>+ ADICIONAR EFEITO</Text>
          </TouchableOpacity>
        </View>

        {effects.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            {effects.map((effect, index) => (
              <View key={index} style={styles.effectRow}>
                <Text style={styles.effectText}>{formatEffectSummary(effect)}</Text>
                <TouchableOpacity onPress={() => setEffects(effects.filter((_, idx) => idx !== index))}>
                  <Ionicons name="trash" size={20} color="#ff6666" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  const insertMagicProgression = async (sourceType: string, sourceName: string) => {
      let query = `INSERT INTO spellcasting_progression (source_type, source_name, level, cantrips_known, spells_known, slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8, slot_9, criador) VALUES `;
      let values: any[] = [];
      
      for (let level = 1; level <= 20; level++) {
         let cantrips = 0; let known = 0;
         let s1=0, s2=0, s3=0, s4=0, s5=0, s6=0, s7=0, s8=0, s9=0;

         if (casterType === 'total') {
            cantrips = level < 4 ?3 : (level < 10 ?4 : 5);
            s1 = level === 1 ?2 : (level === 2 ?3 : 4);
            s2 = level < 3 ?0 : (level === 3 ?2 : 3);
            s3 = level < 5 ?0 : (level === 5 ?2 : 3);
            s4 = level < 7 ?0 : (level === 7 ?1 : (level === 8 ?2 : 3));
            s5 = level < 9 ?0 : (level === 9 ?1 : (level < 18 ?2 : 3));
            s6 = level < 11 ?0 : (level < 19 ?1 : 2);
            s7 = level < 13 ?0 : (level < 20 ?1 : 2);
            s8 = level < 15 ?0 : 1;
            s9 = level < 17 ?0 : 1;
         } else if (casterType === 'meio') {
            s1 = level < 2 ?0 : (level < 5 ?2 : (level < 9 ?4 : 4));
            s2 = level < 5 ?0 : (level < 9 ?2 : 3);
            s3 = level < 9 ?0 : (level < 13 ?2 : 3);
            s4 = level < 13 ?0 : (level < 17 ?1 : 3);
            s5 = level < 17 ?0 : (level < 19 ?1 : 2);
         } else if (casterType === 'terco') {
            cantrips = level < 10 ?2 : 3;
            s1 = level < 3 ?0 : (level < 4 ?2 : (level < 7 ?3 : 4));
            s2 = level < 7 ?0 : (level < 10 ?2 : 3);
            s3 = level < 13 ?0 : (level < 16 ?2 : 3);
            s4 = level < 19 ?0 : 1;
         } else if (casterType === 'pacto') {
            cantrips = level < 4 ?2 : (level < 10 ?3 : 4);
            known = level < 10 ?level + 1 : (level < 11 ?10 : (level < 13 ?11 : (level < 15 ?12 : (level < 17 ?13 : (level < 19 ?14 : 15)))));
            const slotN = level < 3 ?1 : (level < 5 ?2 : (level < 7 ?3 : (level < 9 ?4 : 5)));
            const slotQtd = level < 2 ?1 : (level < 11 ?2 : (level < 17 ?3 : 4));
            
            if(slotN===1) s1=slotQtd; else if(slotN===2) s2=slotQtd; else if(slotN===3) s3=slotQtd; else if(slotN===4) s4=slotQtd; else if(slotN===5) s5=slotQtd;
         }

         values.push(`('${sourceType}', '${sourceName}', ${level}, ${cantrips}, ${known}, ${s1}, ${s2}, ${s3}, ${s4}, ${s5}, ${s6}, ${s7}, ${s8}, ${s9}, 'proprio')`);
      }
      
      await db.runAsync(query + values.join(', '));
  }

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Erro', 'O nome é obrigatório!'); return; }
    try {
      if (activeTab === 'Efeitos') {
        const safeColor = conditionColor.trim();
        if (!isValidHexColor(safeColor)) {
          Alert.alert('Erro', 'Informe uma cor hexadecimal valida, por exemplo #F4A84D.');
          return;
        }
        await db.runAsync(
          `INSERT INTO condition_effects (name, description, color, criador) VALUES (?, ?, ?, 'proprio')`,
          [name.trim(), conditionDescription.trim(), safeColor.toUpperCase()]
        );
        await loadConditionCatalog();
      }
      else if (activeTab === 'Magia/Skill') {
        let finalCastTime = castTimeType === 'Passiva' ?'Passiva' : `${castTimeValue} ${castTimeType}`.trim();
        const durationData = buildDurationData();
        const rangeData = buildRangeData();
        const finalDuration = durationData.label;
        
        let damageParts: string[] = [];
        let typeParts: string[] = [];
        
        spellEffectsList.forEach(eff => {
          damageParts.push(formatEffectSummary(eff));
          if (eff.effect_kind === 'damage') typeParts.push(eff.effect_type);
          if (eff.effect_kind === 'healing') typeParts.push('Cura');
        });

        const finalDamageDice = damageParts.length > 0 ?damageParts.join(' + ') : '-';
        const finalDamageType = Array.from(new Set(typeParts)).length > 0 ?Array.from(new Set(typeParts)).join(', ') : 'Nenhum';
        const finalSaves = spellSaves.length > 0 ?spellSaves.join(', ') : 'Nenhum';
        const classReqString = spellClassesReq.map(c => `${c.name}:${c.minLevel}`).join(', ') || 'Nenhum';
        const justClassNames = spellClassesReq.map(c => c.name).join(',') || 'Nenhum';

        // SALVA EXATAMENTE A CATEGORIA ESCOLHIDA NA TELA
        const result = await db.runAsync(
          `INSERT INTO spells (
            name, level, category, classes, casting_time, casting_time_value, casting_time_unit,
            range, range_value, range_unit, range_shape, components, duration, duration_value,
            duration_unit, damage_dice, damage_type, saving_throw, description, class_level_required, criador
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
          [
            name,
            spellLevel,
            spellCategory,
            justClassNames,
            finalCastTime,
            castTimeType === 'Passiva' ?null : parseInt(castTimeValue) || 1,
            castTimeType,
            rangeData.label,
            rangeData.value,
            rangeData.unit,
            rangeData.shape,
            spellComponents.join(', '),
            finalDuration,
            durationData.value,
            durationData.unit,
            finalDamageDice,
            finalDamageType,
            finalSaves,
            spellDescription,
            classReqString,
          ]
        );
        const spellId = Number((result as any).lastInsertRowId || 0);
        if (spellId > 0) await insertEffects('spells', spellId, name, spellEffectsList);
      }
      else if (activeTab === 'Item') {
        let damageValueParts: string[] = [];
        let damageTypeParts: string[] = [];
        let extraProps: string[] = [];

        itemEffects.forEach(eff => {
          damageValueParts.push(formatEffectSummary(eff));
          if (eff.effect_kind === 'damage') damageTypeParts.push(eff.effect_type);
        });

        const finalDamage = damageValueParts.length > 0 ?damageValueParts.join(' + ') : '-';
        const finalDamageType = damageTypeParts.length > 0 ?damageTypeParts.join(', ') : '-';
        const finalProps = [itemCategory, ...extraProps, ...properties].filter(Boolean).join(', ');
        const isConsumable = itemCategory.includes('Consum') || properties.some(prop => prop.includes('Consum')) ?1 : 0;

        const result = await db.runAsync(
          `INSERT INTO items (name, weight, damage, damage_type, category, is_consumable, properties, descricao, criador) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
          [name, parseFloat(weight) || 0, finalDamage, finalDamageType, itemCategory, isConsumable, finalProps, itemDescription]
        );
        const itemId = Number((result as any).lastInsertRowId || 0);
        if (itemId > 0) await insertEffects('items', itemId, name, itemEffects);
      } 
      else if (activeTab === 'Raça') {
        const bonificadores = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, parseInt(v) || 0]));
        await db.runAsync(`INSERT INTO races (name, stat_bonuses, speed, features, criador) VALUES (?, ?, ?, ?, 'proprio')`, [name, JSON.stringify(bonificadores), speed, buildFeatureRequirementsPayload()]);
      }
      else if (activeTab === 'Classe') {
        const parsedSaves = saves.map(s => `save_${s.toLowerCase()}`);
        await db.runAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster, features, criador) VALUES (?, '{}', '[]', ?, ?, ?, ?, ?, ?, 'proprio')`, [name, parseInt(gold) || 0, parseInt(hitDice) || 8, JSON.stringify(parsedSaves), parseInt(subclassLevel) || 3, isCaster ?1 : 0, buildFeatureRequirementsPayload()]);
        if(isCaster) await insertMagicProgression('class', name);
      }
      else if (activeTab === 'Subclasse') {
        if (subclassParents.length === 0) { Alert.alert('Erro', 'Adicione ao menos uma classe pai para esta subclasse.'); return; }
        const parentNames = subclassParents.map(c => c.name).join(', ');
        const mainLevelReq = parseInt(subclassParents[0].minLevel) || 3;
        const bnsSkills = parseInt(bonusSkills) || 0;
        
        await db.runAsync(`INSERT INTO subclasses (name, class_name, level_required, bonus_skills, features, criador) VALUES (?, ?, ?, ?, ?, 'proprio')`, [name, parentNames, mainLevelReq, bnsSkills, buildFeatureRequirementsPayload()]);
        if(isCaster) await insertMagicProgression('subclass', name);
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

  // ================= COMPONENTES DE RENDERIZAÇÃO =================

  const renderFeatureSelection = () => (
    <View style={styles.formGroup}>
      <Text style={styles.label}>HABILIDADES PASSIVAS, INATAS E BÔNUS POR NÍVEL</Text>
      <Text style={[styles.catalogItemSub, { marginBottom: 10 }]}>Defina em qual nível a raça, classe ou subclasse libera cada habilidade/bônus.</Text>
      
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10}}>
        {selectedFeatures.map((feat) => (
          <View key={feat.name} style={styles.featureBadge}>
            <Text style={styles.featureBadgeText}>{feat.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6 }}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 'bold' }}>Nv.</Text>
              <TextInput
                style={styles.featureBadgeInput}
                keyboardType="numeric"
                selectTextOnFocus
                value={feat.level || '1'}
                onChangeText={(value) => updateSelectedFeatureLevel(feat.name, value)}
                onBlur={() => {
                  if (!feat.level || feat.level === '0') updateSelectedFeatureLevel(feat.name, '1');
                }}
              />
            </View>
            <TouchableOpacity onPress={() => toggleFeature(feat.name)}>
              <Ionicons name="close-circle" size={16} color="#ff6666" />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      
      <TouchableOpacity style={styles.addEffectBtn} onPress={() => setFeatureModalVisible(true)}>
        <Text style={styles.addEffectBtnText}>+ BUSCAR HABILIDADE / PASSIVA</Text>
      </TouchableOpacity>

      <Modal visible={featureModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setFeatureModalVisible(false)}>
          <Pressable style={[styles.modalContent, {height: '75%'}]} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Adicionar Passiva</Text>
            <TextInput style={styles.searchInput} placeholder="Buscar habilidade passiva..." placeholderTextColor="#666" value={featureSearch} onChangeText={setFeatureSearch} />
            
            <FlatList
              style={{ width: '100%', flex: 1 }}
              data={dbFeatures.filter(f => f.name.toLowerCase().includes(featureSearch.toLowerCase()))}
              keyExtractor={f => f.name}
              renderItem={({item}) => {
                const isSelected = selectedFeatures.some(f => f.name === item.name);
                return (
                  <TouchableOpacity style={styles.catalogItem} onPress={() => { toggleFeature(item.name); setFeatureModalVisible(false); setFeatureSearch(''); }}>
                    <View style={{flex: 1}}>
                      <Text style={styles.catalogItemName}>{item.name}</Text>
                      <Text style={styles.catalogItemSub} numberOfLines={2}>{item.description}</Text>
                    </View>
                    {isSelected ?(
                       <Ionicons name="checkmark-circle" size={28} color="#00fa9a" />
                    ) : (
                       <Ionicons name="add-circle-outline" size={28} color="#00bfff" />
                    )}
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>{'Nenhuma passiva encontrada. Crie uma na aba Magia/Skill marcando o nivel ou tempo como "Passiva".'}</Text>}
            />
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setFeatureModalVisible(false)}>
              <Text style={styles.modalCloseText}>FECHAR</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  const renderConditionEffectForm = () => {
    const safeColor = isValidHexColor(conditionColor) ? conditionColor : '#2A3654';
    const selectedGradient = CONDITION_GRADIENT_PALETTE.find(preset => preset.color.toUpperCase() === safeColor.toUpperCase()) || CONDITION_GRADIENT_PALETTE[0];
    const normalizedSearch = conditionSearch.trim().toLowerCase();
    const filteredEffects = conditionCatalog.filter(effect => {
      if (!normalizedSearch) return true;
      return (
        effect.name.toLowerCase().includes(normalizedSearch) ||
        String(effect.description || '').toLowerCase().includes(normalizedSearch)
      );
    });
    const totalPages = Math.max(1, Math.ceil(filteredEffects.length / CONDITION_EFFECT_PAGE_SIZE));
    const currentPage = Math.min(conditionPage, totalPages - 1);
    const pagedEffects = filteredEffects.slice(
      currentPage * CONDITION_EFFECT_PAGE_SIZE,
      currentPage * CONDITION_EFFECT_PAGE_SIZE + CONDITION_EFFECT_PAGE_SIZE
    );
    return (
      <View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>DESCRICAO DO EFEITO</Text>
          <TextInput
            style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
            multiline
            value={conditionDescription}
            onChangeText={setConditionDescription}
            placeholder="Ex: sofre dano de fogo recorrente ou fica marcado por uma maldicao."
            placeholderTextColor="#666"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>GRADIENTE DO EFEITO</Text>
          <View style={styles.gradientPalette}>
            {CONDITION_GRADIENT_PALETTE.map(preset => {
              const active = safeColor.toUpperCase() === preset.color.toUpperCase();
              return (
                <TouchableOpacity
                  key={preset.name}
                  style={[styles.gradientOption, active && styles.gradientOptionActive]}
                  onPress={() => setConditionColor(preset.color)}
                >
                  <LinearGradient colors={preset.colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientSwatch}>
                    {active && <Ionicons name="checkmark" size={18} color="#02112b" />}
                  </LinearGradient>
                  <Text style={[styles.gradientOptionText, active && styles.gradientOptionTextActive]}>{preset.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>COR HEXADECIMAL</Text>
          <View style={styles.colorInputRow}>
            <View style={[styles.colorPreview, { backgroundColor: safeColor }]} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              autoCapitalize="characters"
              value={conditionColor}
              onChangeText={value => setConditionColor(normalizeHexColorInput(value))}
              placeholder="#F4A84D"
              placeholderTextColor="#666"
            />
          </View>
          <View style={styles.colorPalette}>
            {CONDITION_COLOR_PALETTE.map(color => (
              <TouchableOpacity
                key={color}
                style={[styles.colorSwatch, { backgroundColor: color }, conditionColor.toUpperCase() === color && styles.colorSwatchActive]}
                onPress={() => setConditionColor(color)}
              />
            ))}
          </View>
        </View>

        <Text style={styles.label}>PREVIEW</Text>
        <LinearGradient colors={selectedGradient.colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.conditionPreviewCard, { borderColor: safeColor }]}>
          <View style={[styles.effectColorDot, { backgroundColor: safeColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.conditionPreviewTitle}>{name.trim() || 'Nome do efeito'}</Text>
            <Text style={styles.conditionPreviewSub}>{conditionDescription.trim() || 'Descricao amigavel do efeito.'}</Text>
          </View>
        </LinearGradient>

        <Text style={[styles.label, { marginTop: 20 }]}>EFEITOS CADASTRADOS</Text>
        <TextInput
          style={styles.searchInput}
          value={conditionSearch}
          onChangeText={value => {
            setConditionSearch(value);
            setConditionPage(0);
          }}
          placeholder="Pesquisar por nome ou descricao..."
          placeholderTextColor="#666"
        />
        <View style={styles.conditionListHeader}>
          <Text style={styles.conditionListMeta}>{filteredEffects.length} efeito(s) / pag. {currentPage + 1} de {totalPages}</Text>
          <Text style={styles.conditionListMeta}>{CONDITION_EFFECT_PAGE_SIZE} por pagina</Text>
        </View>
        {filteredEffects.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum efeito cadastrado ainda.</Text>
        ) : (
          pagedEffects.map(effect => (
            <View key={effect.id} style={styles.conditionListItem}>
              <View style={[styles.effectColorDot, { backgroundColor: effect.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.catalogItemName}>{effect.name}</Text>
                <Text style={styles.catalogItemSub} numberOfLines={2}>{effect.description || 'Sem descricao.'}</Text>
              </View>
            </View>
          ))
        )}
        <View style={styles.conditionPager}>
          <TouchableOpacity
            style={[styles.pagerButton, currentPage === 0 && styles.pagerButtonDisabled]}
            disabled={currentPage === 0}
            onPress={() => setConditionPage(page => Math.max(0, page - 1))}
          >
            <Ionicons name="chevron-back" size={16} color="#00bfff" />
            <Text style={styles.pagerButtonText}>Anterior</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pagerButton, currentPage >= totalPages - 1 && styles.pagerButtonDisabled]}
            disabled={currentPage >= totalPages - 1}
            onPress={() => setConditionPage(page => Math.min(totalPages - 1, page + 1))}
          >
            <Text style={styles.pagerButtonText}>Proxima</Text>
            <Ionicons name="chevron-forward" size={16} color="#00bfff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderItemForm = () => (
    <View>
      <View style={styles.formGroup}>
        <Text style={styles.label}>PESO (kg)</Text>
        <TextInput style={styles.input} keyboardType="numeric" selectTextOnFocus textAlign="center" value={weight} onChangeText={value => setWeight(onlyDecimal(value))} />
      </View>

      <Text style={styles.label}>CATEGORIA DO ITEM</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {ITEM_CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.toggleBtn, itemCategory === cat && styles.toggleBtnActive]}
              onPress={() => {
                setItemCategory(cat);
                if (cat === 'Consumivel' || cat.includes('Consum')) {
                  setProperties(prev => (prev.some(prop => prop.includes('Consum')) ?prev : [...prev, 'Consumivel']));
                }
              }}
            >
              <Text style={[styles.toggleBtnText, itemCategory === cat && styles.toggleBtnTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {renderStructuredEffectBuilder(itemEffects, setItemEffects)}

      <Text style={styles.label}>PROPRIEDADES EXTRAS (Opcional)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {ITEM_PROPS.map(prop => (
            <TouchableOpacity key={prop} style={[styles.toggleBtn, properties.includes(prop) && styles.toggleBtnActive]} onPress={() => toggleArrayItem(setProperties, prop)}>
              <Text style={[styles.toggleBtnText, properties.includes(prop) && styles.toggleBtnTextActive]}>{prop}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={styles.formGroup}>
        <Text style={styles.label}>DESCRICAO / HISTORIA (Opcional)</Text>
        <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} multiline value={itemDescription} onChangeText={setItemDescription} placeholder="A lenda do item..." placeholderTextColor="#666" />
      </View>
    </View>
  );

  const getLevelsByCategory = (cat: string) => {
      if (cat === 'Magia') return ['Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
      return ['Passiva', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9', 'Nível 10', 'Nível 11', 'Nível 12', 'Nível 13', 'Nível 14', 'Nível 15', 'Nível 16', 'Nível 17', 'Nível 18', 'Nível 19', 'Nível 20'];
  };

  const getCastingTimesByCategory = (cat: string) => {
      if (cat === 'Passiva') return ['Passiva'];
      return ['Ação', 'Ação Bônus', 'Reação', 'Especial', 'Minuto(s)', 'Hora(s)'];
  };

  const renderSpellForm = () => {
    const availableLevels = getLevelsByCategory(spellCategory);
    const availableCastingTimes = getCastingTimesByCategory(spellCategory);

    return (
      <View>
        <Text style={styles.label}>CATEGORIA</Text>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 20}}>
          {['Magia', 'Habilidade', 'Passiva'].map(cat => (
            <TouchableOpacity key={cat} style={[styles.toggleBtn, spellCategory === cat && styles.toggleBtnActive]} onPress={() => {
              setSpellCategory(cat);
              if (cat === 'Magia') {
                setSpellLevel('Truque');
                setCastTimeType('Ação');
                setSpellComponents(['V', 'S']);
              } else if (cat === 'Passiva') {
                setSpellLevel('Passiva');
                setCastTimeType('Passiva');
                setSpellDurationType('Permanente');
                setSpellComponents([]);
                setSpellRangeShape('Pessoal');
              } else {
                setSpellLevel('Nível 1');
                setCastTimeType('Ação Bônus');
                setSpellComponents([]);
                setSpellRangeShape('Pessoal');
              }
            }}>
              <Text style={[styles.toggleBtnText, spellCategory === cat && styles.toggleBtnTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>NÍVEL</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 20}}>
          <View style={{flexDirection: 'row', gap: 10}}>
            {availableLevels.map(lvl => (
              <TouchableOpacity key={lvl} style={[styles.toggleBtn, spellLevel === lvl && styles.toggleBtnActive]} onPress={() => setSpellLevel(lvl)}>
                <Text style={[styles.toggleBtnText, spellLevel === lvl && styles.toggleBtnTextActive]}>{lvl}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.label}>TEMPO DE CONJURAÇÃO / USO</Text>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, alignItems: 'center'}}>
          {(castTimeType !== 'Passiva' && castTimeType !== 'Especial') && (
            <TextInput 
              style={[styles.input, {flex: 0.25, textAlign: 'center', paddingHorizontal: 5}]} 
              keyboardType="numeric" selectTextOnFocus textAlign="center" 
              value={castTimeValue} 
              onChangeText={value => setCastTimeValue(onlyPositiveInt(value))} 
              placeholder="Qtd" 
              placeholderTextColor="#666"
            />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: (castTimeType === 'Passiva' || castTimeType === 'Especial') ?1 : 0.75}}>
            <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
              {availableCastingTimes.map(ct => (
                <TouchableOpacity key={ct} style={[styles.limitBtn, castTimeType === ct && styles.limitBtnActive]} onPress={() => setCastTimeType(ct)}>
                  <Text style={[styles.limitBtnText, castTimeType === ct && styles.limitBtnTextActive]}>{ct}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>ALCANCE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {STRUCTURED_RANGES.map(range => (
                  <TouchableOpacity key={range} style={[styles.limitBtn, spellRangeShape === range && styles.limitBtnActive, { paddingVertical: 4, paddingHorizontal: 8 }]} onPress={() => setSpellRangeShape(range)}>
                    <Text style={[styles.limitBtnText, spellRangeShape === range && styles.limitBtnTextActive, { fontSize: 9 }]}>{range}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {spellRangeShape !== 'Pessoal' && spellRangeShape !== 'Toque' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[styles.input, { flex: 1, textAlign: 'center' }]} keyboardType="numeric" selectTextOnFocus textAlign="center" value={spellRangeValue} onChangeText={value => setSpellRangeValue(onlyDecimal(value))} placeholder="Valor" placeholderTextColor="#666" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {RANGE_UNITS.map(unit => (
                      <TouchableOpacity key={unit} style={[styles.limitBtn, spellRangeUnit === unit && styles.limitBtnActive]} onPress={() => setSpellRangeUnit(unit)}>
                        <Text style={[styles.limitBtnText, spellRangeUnit === unit && styles.limitBtnTextActive]}>{unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
          
          {spellCategory === 'Magia' && (
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
          )}
        </View>

        <Text style={styles.label}>DURAÇÃO</Text>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 20, alignItems: 'center'}}>
          {(spellDurationType !== 'Instantânea' && spellDurationType !== 'Concentração' && spellDurationType !== 'Permanente') && (
            <TextInput 
              style={[styles.input, {flex: 0.25, textAlign: 'center', paddingHorizontal: 5}]} 
              keyboardType="numeric" selectTextOnFocus textAlign="center" 
              value={spellDurationValue} 
              onChangeText={value => setSpellDurationValue(onlyPositiveInt(value))} 
              placeholder="Qtd" 
              placeholderTextColor="#666"
            />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
            <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
              {SPELL_DURATION_TYPES.map(dur => (
                <TouchableOpacity key={dur} style={[styles.limitBtn, spellDurationType === dur && styles.limitBtnActive]} onPress={() => { setSpellDurationType(dur); if(dur === 'Instantânea' || dur === 'Concentração' || dur === 'Permanente') setSpellDurationValue(''); }}>
                  <Text style={[styles.limitBtnText, spellDurationType === dur && styles.limitBtnTextActive]}>{dur}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {renderStructuredEffectBuilder(spellEffectsList, setSpellEffectsList)}

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

        {spellLevel !== 'Passiva' && (
          <>
            <Text style={styles.label}>QUAIS CLASSES APRENDEM ESSA {spellCategory.toUpperCase()}?</Text>
            <View style={styles.effectBuilder}>
              <View style={{flexDirection: 'row', gap: 10, marginBottom: 15, alignItems: 'center'}}>
                <TextInput style={[styles.input, {flex: 0.7, backgroundColor: 'rgba(0,0,0,0.4)', paddingVertical: 10}]} placeholder="Buscar classe..." placeholderTextColor="#666" value={spellClassSearch} onChangeText={setSpellClassSearch} />
                <TextInput style={[styles.input, {flex: 0.3, backgroundColor: 'rgba(0,0,0,0.4)', textAlign: 'center', paddingVertical: 10}]} placeholder="Nível" placeholderTextColor="#666" keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempSpellClassLvl} onChangeText={value => setTempSpellClassLvl(onlyPositiveInt(value))} />
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
          </>
        )}

        <View style={styles.formGroup}><Text style={styles.label}>DESCRIÇÃO</Text><TextInput style={[styles.input, {minHeight: 120, textAlignVertical: 'top'}]} multiline value={spellDescription} onChangeText={setSpellDescription} placeholder={`Como a ${spellCategory.toLowerCase()} se manifesta no mundo...`} placeholderTextColor="#666"/></View>
      </View>
    );
  }

  const renderRaceForm = () => {
    const totalStats = Object.values(stats).reduce((acc, val) => acc + (parseInt(val) || 0), 0);

    return (
      <View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>DESLOCAMENTO</Text>
          <TextInput style={styles.input} value={speed} onChangeText={setSpeed} placeholder="Ex: 9m" placeholderTextColor="#666"/>
        </View>
        
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10}}>
          <Text style={[styles.sectionTitle, {marginBottom: 0, marginTop: 0}]}>BÔNUS DE ATRIBUTOS</Text>
          <Text style={styles.counterText}>Total Bônus: {totalStats > 0 ?`+${totalStats}` : totalStats}</Text>
        </View>

        <View style={styles.statsGrid}>
          {Object.keys(stats).map((key) => (
            <View key={key} style={styles.statBox}>
              <Text style={styles.statLabel}>{key}</Text>
              <TextInput 
                style={styles.statInput} 
                keyboardType="numeric" 
                maxLength={3} 
                value={stats[key as keyof typeof stats]} 
                onChangeText={(val) => updateStat(key as keyof typeof stats, val)}
                onFocus={() => {
                  if (stats[key as keyof typeof stats] === '0') {
                    updateStat(key as keyof typeof stats, '');
                  }
                }}
                onBlur={() => {
                  if (stats[key as keyof typeof stats] === '' || stats[key as keyof typeof stats] === '-') {
                    updateStat(key as keyof typeof stats, '0');
                  }
                }}
                selectTextOnFocus={true}
              />
            </View>
          ))}
        </View>
        <View style={{marginTop: 20}}>
          {renderFeatureSelection()}
        </View>
      </View>
    );
  };

  const renderClassForm = () => (
    <View>
      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>DADO DE VIDA (d)</Text><TextInput style={styles.input} keyboardType="numeric" selectTextOnFocus textAlign="center" value={hitDice} onChangeText={value => setHitDice(onlyPositiveInt(value))} placeholder="8" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1}]}><Text style={styles.label}>OURO INICIAL</Text><TextInput style={styles.input} keyboardType="numeric" selectTextOnFocus textAlign="center" value={gold} onChangeText={value => setGold(onlyPositiveInt(value))} placeholder="10" placeholderTextColor="#666"/></View>
      </View>
      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>NÍVEL SUBCLASSE</Text><TextInput style={styles.input} keyboardType="numeric" selectTextOnFocus textAlign="center" value={subclassLevel} onChangeText={value => setSubclassLevel(onlyPositiveInt(value))} placeholder="3" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1, alignItems: 'center', justifyContent: 'center'}]}>
          <Text style={styles.label}>USA MAGIA?</Text>
          <Switch value={isCaster} onValueChange={(val) => { setIsCaster(val); if(val) setProgressionModalVisible(true); }} trackColor={{ false: "#767577", true: "#00bfff" }} thumbColor={isCaster ?"#fff" : "#f4f3f4"} />
        </View>
      </View>
      
      {isCaster && (
         <View style={{marginBottom: 20, backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#00bfff'}}>
            <Text style={{color: '#fff', fontWeight: 'bold', marginBottom: 5}}>Modo Mágico: <Text style={{color: '#00fa9a'}}>{casterType.toUpperCase()}</Text></Text>
            <Text style={{color: 'rgba(255,255,255,0.7)', fontSize: 12}}>O sistema irá gerar a tabela de feitiços de nível 1 a 20 automaticamente com base neste perfil na hora de salvar.</Text>
            <TouchableOpacity style={{marginTop: 10}} onPress={() => setProgressionModalVisible(true)}>
               <Text style={{color: '#00bfff', fontWeight: 'bold', fontSize: 12}}>Alterar Modelo de Progressão</Text>
            </TouchableOpacity>
         </View>
      )}

      <Text style={styles.sectionTitle}>RESISTÊNCIAS (Escolha 2)</Text>
      <View style={styles.toggleGrid}>
        {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(s => (
          <TouchableOpacity key={s} style={[styles.toggleBtn, saves.includes(s) && styles.toggleBtnActive]} onPress={() => toggleArrayItem(setSaves, s)}>
            <Text style={[styles.toggleBtnText, saves.includes(s) && styles.toggleBtnTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{marginTop: 20}}>
        {renderFeatureSelection()}
      </View>
    </View>
  );

  const renderSubclassForm = () => (
    <View>
      <Text style={styles.label}>CLASSES PAI DESTA SUBCLASSE</Text>
      <View style={styles.effectBuilder}>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 15, alignItems: 'center'}}>
          <TextInput style={[styles.input, {flex: 0.7, backgroundColor: 'rgba(0,0,0,0.4)', paddingVertical: 10}]} placeholder="Buscar classe..." placeholderTextColor="#666" value={subclassSearch} onChangeText={setSubclassSearch} />
          <TextInput style={[styles.input, {flex: 0.3, backgroundColor: 'rgba(0,0,0,0.4)', textAlign: 'center', paddingVertical: 10}]} placeholder="Nível" placeholderTextColor="#666" keyboardType="numeric" selectTextOnFocus textAlign="center" value={tempSubclassLevel} onChangeText={value => setTempSubclassLevel(onlyPositiveInt(value))} />
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

      <View style={styles.formGroup}>
        <Text style={styles.label}>PERÍCIAS EXTRAS (Opcional)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" selectTextOnFocus textAlign="center" 
          value={bonusSkills} 
          onChangeText={value => setBonusSkills(onlyPositiveInt(value))} 
          placeholder="Quantas perícias o jogador ganha?(Ex: 0, 1, 3...)" 
          placeholderTextColor="#666"
        />
        <Text style={[styles.label, {color: 'rgba(255,255,255,0.4)', fontSize: 9, marginTop: 5}]}>
          *A maioria das subclasses (como Campeão ou Assassino) não concede perícias, digite 0. Subclasses como o Colégio do Conhecimento dão 3.
        </Text>
      </View>

      <View style={styles.formGroup}>
         <Text style={styles.label}>SUBCLASSE DE CONJURADOR?(Ex: Cavaleiro Arcano)</Text>
         <Switch value={isCaster} onValueChange={(val) => { setIsCaster(val); if(val) setProgressionModalVisible(true); }} trackColor={{ false: "#767577", true: "#00bfff" }} thumbColor={isCaster ?"#fff" : "#f4f3f4"} />
      </View>
      {isCaster && (
         <View style={{marginBottom: 20, backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#00bfff'}}>
            <Text style={{color: '#fff', fontWeight: 'bold', marginBottom: 5}}>Modo Mágico: <Text style={{color: '#00fa9a'}}>{casterType.toUpperCase()}</Text></Text>
            <TouchableOpacity style={{marginTop: 10}} onPress={() => setProgressionModalVisible(true)}>
               <Text style={{color: '#00bfff', fontWeight: 'bold', fontSize: 12}}>Alterar Modelo de Progressão</Text>
            </TouchableOpacity>
         </View>
      )}

      <View style={{marginTop: 20}}>
        {renderFeatureSelection()}
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
        {kitItems.length > 0 ?kitItems.map((item, i) => (
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
                                {item.name} {item.criador === 'proprio' || item.criador === 'importado' ?<Text style={{color: '#00bfff', fontSize: 10}}>[Custom]</Text> : null}
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
        {['Todos', 'Item', 'Raça', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit', 'Efeitos'].map(tab => (
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

      {myCreations.length > 0 ?(
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
          {MASTER_TOOL_CATEGORIES.map(tab => (
            <TouchableOpacity key={tab} style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} onPress={() => handleTabChange(tab)}>
              <Text style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* MODAL DE PROGRESSÃO MÁGICA RÁPIDA */}
      <Modal visible={progressionModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setProgressionModalVisible(false)}>
           <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Modelo de Progressão Mágica</Text>
              <Text style={[styles.hpHint, {marginBottom: 20}]}>Escolha o modelo que será aplicado do nível 1 ao 20 para esta classe.</Text>
              
              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'total' ?'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('total'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'total' ?'#00bfff' : '#fff'}]}>Conjurador Total</Text>
                 <Text style={styles.catalogItemSub}>Tem Truques. Chega a magias de Nível 9 (Ex: Mago, Bardo, Clérigo).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'meio' ?'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('meio'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'meio' ?'#00bfff' : '#fff'}]}>Meio-Conjurador</Text>
                 <Text style={styles.catalogItemSub}>Sem Truques. Magias começam Nível 2 e vão até Nível 5 (Ex: Paladino, Patrulheiro).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'terco' ?'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('terco'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'terco' ?'#00bfff' : '#fff'}]}>1/3 Conjurador</Text>
                 <Text style={styles.catalogItemSub}>Tem Truques. Magias começam Nível 3 e vão até Nível 4 (Ex: Cavaleiro Arcano).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'pacto' ?'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('pacto'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'pacto' ?'#00bfff' : '#fff'}]}>Magia de Pacto</Text>
                 <Text style={styles.catalogItemSub}>Poucos espaços, mas sempre no nível máximo possível (Ex: Bruxo).</Text>
              </TouchableOpacity>

           </Pressable>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ?'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeTab !== 'Acervo' ?(
            <>
              <View style={styles.cardBlock}>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>NOME DO(A) {activeTab.toUpperCase()}</Text>
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={`Ex: ${activeTab === 'Magia/Skill' ?'Bola de Fogo' : 'Necromante'}...`} placeholderTextColor="#666" />
                </View>

                {activeTab === 'Item' && renderItemForm()}
                {activeTab === 'Raça' && renderRaceForm()}
                {activeTab === 'Classe' && renderClassForm()}
                {activeTab === 'Subclasse' && renderSubclassForm()}
                {activeTab === 'Magia/Skill' && renderSpellForm()}
                {activeTab === 'Kit' && renderKitForm()}
                {activeTab === 'Efeitos' && renderConditionEffectForm()}
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
  effectOptionContent: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  effectColorDot: { width: 12, height: 12, borderRadius: 6 },
  colorInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorPreview: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  colorPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  colorSwatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  colorSwatchActive: { borderColor: '#fff' },
  gradientPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gradientOption: { width: '47.5%', minWidth: 132, borderRadius: 14, padding: 8, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  gradientOptionActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.08)' },
  gradientSwatch: { height: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  gradientOptionText: { color: 'rgba(255,255,255,0.62)', fontSize: 11, fontWeight: 'bold', textAlign: 'center', marginTop: 6 },
  gradientOptionTextActive: { color: '#00fa9a' },
  conditionPreviewCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, marginBottom: 8 },
  conditionPreviewTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  conditionPreviewSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4, lineHeight: 17 },
  conditionListHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 },
  conditionListMeta: { color: 'rgba(255,255,255,0.46)', fontSize: 11, fontWeight: 'bold' },
  conditionListItem: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  conditionPager: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pagerButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.28)' },
  pagerButtonDisabled: { opacity: 0.42 },
  pagerButtonText: { color: '#00bfff', fontSize: 12, fontWeight: 'bold' },
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
  featureBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,250,154,0.1)', borderWidth: 1, borderColor: '#00fa9a', borderRadius: 8, paddingLeft: 10, paddingRight: 5, paddingVertical: 4 },
  featureBadgeText: { color: '#00fa9a', fontSize: 11, fontWeight: 'bold', marginRight: 5 },
  featureBadgeInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 11, width: 35, height: 35, textAlign: 'center', borderRadius: 4, marginRight: 5 },
  hpHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', marginTop: 15, lineHeight: 18 },
  counterText: { fontSize: 12, fontWeight: 'bold', color: '#00bfff', backgroundColor: 'rgba(0, 191, 255, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }
});
