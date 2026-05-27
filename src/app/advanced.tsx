// ================= advanced.tsx =================
import {
  createEffect,
  deleteEffectIfUnused,
  disableEffect,
  duplicateEffect,
  listEffects,
  normalizeStatusKey,
  updateEffect,
} from '@/services/effects/effectCatalogService';
import type { LanEffectCatalogItem } from '@/services/effects/effectTypes';
import { makeLanEventId, rememberLanSessionEvent, syncLanSessionPayload } from '@/services/lanSession';
import { appGradients, advancedStyles as styles } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

// ================= TIPAGENS =================
type SpellClassReq = { name: string; minLevel: string }; 
type SelectedFeature = { name: string; level: string };
type SpellItem = { id: number; name: string; level: string; category?: string; casting_time?: string; range?: string; damage?: string; description?: string; classes?: string; };

const CATEGORIES = ['Item', 'Raça', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit', 'Condicoes/Efeitos', 'Acervo'];
const ITEM_CATEGORIES = ['Arma', 'Armadura', 'Escudo', 'Anel', 'Amuleto', 'Capacete', 'Capa', 'Bota', 'Luva', 'Consumível', 'Ferramenta', 'Mochila/Saco', 'Outro'];
const EFFECT_CATEGORIES = ['Cortante', 'Perfurante', 'Concussão', 'Fogo', 'Frio', 'Veneno', 'Ácido', 'Psíquico', 'Necrótico', 'Radiante', 'Elétrico', 'Trovejante', 'Força', 'Cura', 'PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo', 'Outro'];
const ITEM_PROPS = ['Acuidade', 'Leve', 'Pesada', 'Duas mãos', 'Versátil', 'Arremesso', 'Munição', 'Alcance', 'Recarga', 'Especial', 'Foco Arcano', 'Foco Divino', 'Foco Druídico', 'Consumível', 'Mágico'];

const SPELL_RANGES = ['Pessoal', 'Toque', '9m', '18m', '36m', 'Cubo', 'Cone'];
const SPELL_COMPONENTS = ['V', 'S', 'M'];
const SPELL_DURATION_TYPES = ['Instantânea', 'Rodada(s)', 'Minuto(s)', 'Hora(s)', 'Dia(s)', 'Concentração', 'Permanente'];
const SPELL_SAVES = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const SPELL_DAMAGE_TYPES = ['Cortante', 'Perfurante', 'Concussão', 'Fogo', 'Frio', 'Veneno', 'Ácido', 'Psíquico', 'Necrótico', 'Radiante', 'Elétrico', 'Trovejante', 'Força', 'Cura', 'Outro'];

const VALID_TABLES = ['items', 'races', 'classes', 'subclasses', 'spells', 'starting_kits', 'spellcasting_progression'];
const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const RANGE_MODES = ['Pessoal', 'Toque', 'Distancia', 'Cubo', 'Cone', 'Esfera', 'Linha'];
const RANGE_UNITS = ['m', 'cm'];
const SAVE_CHOICES = ['Nenhum', ...SPELL_SAVES];
const SAVE_SUCCESS_CHOICES = [
  { key: 'none', label: 'Nada' },
  { key: 'half', label: 'Metade' },
  { key: 'negates', label: 'Anula' },
];
const CONDITION_OPTIONS = [
  { key: 'none', name: 'Nenhuma', color: '' },
  { key: 'poisoned', name: 'Envenenado', color: '#69d56f' },
  { key: 'stunned', name: 'Tonto', color: '#ffd166' },
  { key: 'paralyzed', name: 'Paralisado', color: '#b388ff' },
  { key: 'blinded', name: 'Cego', color: '#8ecae6' },
  { key: 'deafened', name: 'Surdo', color: '#a0a0a0' },
  { key: 'frightened', name: 'Amedrontado', color: '#ff8fa3' },
  { key: 'restrained', name: 'Contido', color: '#f4a261' },
  { key: 'prone', name: 'Caido', color: '#cdb4db' },
];

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
  const [itemEffects, setItemEffects] = useState<any[]>([]);
  const [itemDescription, setItemDescription] = useState(''); 
  
  const [tempEffVal, setTempEffVal] = useState('');
  const [tempEffType, setTempEffType] = useState('Cortante');
  const [tempEffDuration, setTempEffDuration] = useState(''); 
  const [tempEffTurns, setTempEffTurns] = useState(''); 
  const [itemEffectAmountMode, setItemEffectAmountMode] = useState<'dice' | 'value' | 'none'>('dice');
  const [itemDiceCount, setItemDiceCount] = useState('1');
  const [itemDiceSides, setItemDiceSides] = useState('6');
  const [itemFlatBonus, setItemFlatBonus] = useState('0');
  const [itemSaveAbility, setItemSaveAbility] = useState('Nenhum');
  const [itemSaveDc, setItemSaveDc] = useState('10');
  const [itemSaveOnSuccess, setItemSaveOnSuccess] = useState('none');
  const [itemConditionKey, setItemConditionKey] = useState('none');

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
  const [spellRange, setSpellRange] = useState('18m');
  const [spellRangeMode, setSpellRangeMode] = useState('Distancia');
  const [spellRangeValue, setSpellRangeValue] = useState('18');
  const [spellRangeUnit, setSpellRangeUnit] = useState('m');
  const [spellComponents, setSpellComponents] = useState<string[]>(['V', 'S']);
  const [spellDurationValue, setSpellDurationValue] = useState('');
  const [spellDurationType, setSpellDurationType] = useState('Instantânea');
  const [spellEffectsList, setSpellEffectsList] = useState<any[]>([]);
  const [tempSpellDice, setTempSpellDice] = useState('');
  const [tempSpellDmgType, setTempSpellDmgType] = useState('Fogo');
  const [tempSpellCustomType, setTempSpellCustomType] = useState('');
  const [spellEffectAmountMode, setSpellEffectAmountMode] = useState<'dice' | 'value' | 'none'>('dice');
  const [spellDiceCount, setSpellDiceCount] = useState('1');
  const [spellDiceSides, setSpellDiceSides] = useState('8');
  const [spellFlatBonus, setSpellFlatBonus] = useState('0');
  const [spellSaveAbility, setSpellSaveAbility] = useState('Nenhum');
  const [spellSaveDc, setSpellSaveDc] = useState('');
  const [spellSaveOnSuccess, setSpellSaveOnSuccess] = useState('negates');
  const [spellConditionKey, setSpellConditionKey] = useState('none');
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

  // Estados de Condicoes / Efeitos
  const [effectCatalog, setEffectCatalog] = useState<LanEffectCatalogItem[]>([]);
  const [editingEffectId, setEditingEffectId] = useState<number | null>(null);
  const [effectStatusKey, setEffectStatusKey] = useState('');
  const [effectKind, setEffectKind] = useState('condition');
  const [effectCategory, setEffectCategory] = useState('custom');
  const [effectColor, setEffectColor] = useState('#8E44AD');
  const [effectSecondaryColor, setEffectSecondaryColor] = useState('#D2B4DE');
  const [effectIcon, setEffectIcon] = useState('sparkles');
  const [effectDescription, setEffectDescription] = useState('');
  const [effectPriority, setEffectPriority] = useState('40');
  const [effectStackable, setEffectStackable] = useState(false);
  const [effectRemovableBySave, setEffectRemovableBySave] = useState(false);
  const [effectRepeatSave, setEffectRepeatSave] = useState('none');
  const [effectSaveAbility, setEffectSaveAbility] = useState('Nenhum');
  const [effectSaveOnSuccess, setEffectSaveOnSuccess] = useState('remove');
  const [effectDurationValue, setEffectDurationValue] = useState('1');
  const [effectDurationUnit, setEffectDurationUnit] = useState('turn');
  const [effectRulesNote, setEffectRulesNote] = useState('');

  const conditionOptions = [
    { key: 'none', name: 'Nenhuma', color: '' },
    ...effectCatalog.filter((effect) => effect.active !== false).map((effect) => ({
      key: effect.statusKey,
      name: effect.name,
      color: effect.color,
      secondaryColor: effect.secondaryColor,
    })),
  ];

  useEffect(() => {
    async function fetchData() {
      try {
        const classes = await db.getAllAsync<{name: string}>('SELECT name FROM classes ORDER BY name');
        const items = await db.getAllAsync('SELECT * FROM items ORDER BY name');
        const features = await db.getAllAsync<{name: string, description: string}>(
          "SELECT name, description FROM spells WHERE level = 'Passiva' OR casting_time = 'Passiva' ORDER BY name"
        );
        const effects = await listEffects(db, { includeInactive: true });
        
        setDbClasses(classes);
        setDbItemsCatalog(items);
        setDbFeatures(features);
        setEffectCatalog(effects);
        
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
          if(tableName === 'classes' || tableName === 'subclasses' || tableName === 'races') {
              await db.runAsync(`DELETE FROM spellcasting_progression WHERE source_name = ?`, [itemName]);
          }
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
      let itemsToExport = myCreations.filter(item => selectedAcervo.includes(`${item.tableName}-${item.id}`));
      
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
        if (!VALID_TABLES.includes(item.tableName)) continue; 
        
        const { tableName, type, id, ...fields } = item;
        fields.criador = 'importado';
        
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
    setName(''); setWeight('1'); setItemCategory('Arma'); setProperties([]); setItemEffects([]); setTempEffVal(''); setTempEffType('Cortante'); setTempEffDuration(''); setTempEffTurns(''); setItemDescription('');
    setItemEffectAmountMode('dice'); setItemDiceCount('1'); setItemDiceSides('6'); setItemFlatBonus('0'); setItemSaveAbility('Nenhum'); setItemSaveDc('10'); setItemSaveOnSuccess('none'); setItemConditionKey('none');
    setStats({ FOR: '0', DES: '0', CON: '0', INT: '0', SAB: '0', CAR: '0' }); setSpeed('9m'); setHitDice('8'); setGold('10'); setSubclassLevel('3'); setIsCaster(false); setSaves([]);
    setSubclassParents([]); setSubclassSearch(''); setTempSubclassLevel('3'); setBonusSkills('0');
    if(dbClasses.length > 0) setTempSubclassParent(dbClasses[0].name);
    setSpellCategory('Magia'); setSpellLevel('Truque'); setSpellClassesReq([]); setSpellClassSearch(''); setTempSpellClassLvl('1');
    if(dbClasses.length > 0) setTempSpellClass(dbClasses[0].name);
    setCastTimeValue('1'); setCastTimeType('Ação'); setSpellRange('18m'); setSpellRangeMode('Distancia'); setSpellRangeValue('18'); setSpellRangeUnit('m'); setSpellComponents(['V', 'S']); setSpellDurationValue(''); setSpellDurationType('Instantânea'); 
    setSpellEffectsList([]); setTempSpellDice(''); setTempSpellDmgType('Fogo'); setTempSpellCustomType(''); setSpellEffectAmountMode('dice'); setSpellDiceCount('1'); setSpellDiceSides('8'); setSpellFlatBonus('0'); setSpellSaveAbility('Nenhum'); setSpellSaveDc(''); setSpellSaveOnSuccess('negates'); setSpellConditionKey('none'); setSpellSaves([]); setSpellDescription(''); 
    setKitTargetClasses([]); setTempKitClass(''); setKitClassSearch(''); setKitItems([]);
    setSelectedFeatures([]); setCasterType('total');
    setEditingEffectId(null); setEffectStatusKey(''); setEffectKind('condition'); setEffectCategory('custom'); setEffectColor('#8E44AD'); setEffectSecondaryColor('#D2B4DE'); setEffectIcon('sparkles'); setEffectDescription(''); setEffectPriority('40'); setEffectStackable(false); setEffectRemovableBySave(false); setEffectRepeatSave('none'); setEffectSaveAbility('Nenhum'); setEffectSaveOnSuccess('remove'); setEffectDurationValue('1'); setEffectDurationUnit('turn'); setEffectRulesNote('');
  };

  const loadEffectCatalog = async () => {
    setEffectCatalog(await listEffects(db, { includeInactive: true }));
  };

  const publishEffectCatalogPatchToActiveSessions = async (
    action: 'upsert' | 'disable' | 'delete',
    effect?: LanEffectCatalogItem | null,
    statusKey?: string,
  ) => {
    const sessions = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id FROM lan_sessions
       WHERE status = 'active' AND COALESCE(is_master, 1) = 1`
    );
    for (const session of sessions) {
      const sessionId = String(session.id || '');
      if (!sessionId) continue;
      await rememberLanSessionEvent(db, {
        id: makeLanEventId(),
        sessionId,
        type: 'effect_catalog_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: 'party',
        toName: 'Party',
        effectCatalogPatch: {
          action,
          effect: effect ? {
            statusKey: effect.statusKey,
            name: effect.name,
            kind: effect.kind,
            color: effect.color,
            secondaryColor: effect.secondaryColor,
            icon: effect.icon,
            description: effect.description,
            visualPriority: effect.visualPriority,
            active: effect.active,
          } : undefined,
          statusKey: statusKey || effect?.statusKey,
        },
        message: `Catalogo de efeitos atualizado: ${effect?.name || statusKey || action}.`,
        createdAt: new Date().toISOString(),
      });
      await syncLanSessionPayload(db, sessionId);
    }
  };

  const startEditEffect = (effect: LanEffectCatalogItem) => {
    setEditingEffectId(effect.id || null);
    setName(effect.name);
    setEffectStatusKey(effect.statusKey);
    setEffectKind(effect.kind || 'condition');
    setEffectCategory(effect.category || 'custom');
    setEffectColor(effect.color || '#888888');
    setEffectSecondaryColor(effect.secondaryColor || '');
    setEffectIcon(effect.icon || 'sparkles');
    setEffectDescription(effect.description || '');
    setEffectPriority(String(effect.visualPriority || 0));
    setEffectStackable(Boolean(effect.stackable));
    setEffectRemovableBySave(Boolean(effect.removableBySave));
    setEffectRepeatSave(String(effect.repeatSave || 'none'));
    setEffectSaveAbility(effect.saveAbility ? String(effect.saveAbility) : 'Nenhum');
    setEffectSaveOnSuccess(String(effect.saveOnSuccess || 'remove'));
    setEffectDurationValue(String(effect.defaultDurationValue || 1));
    setEffectDurationUnit(String(effect.defaultDurationUnit || 'turn'));
    setEffectRulesNote(String((effect.rulesJson as any)?.mechanicalNote || ''));
  };

  const handleDuplicateEffect = async (effect: LanEffectCatalogItem) => {
    if (!effect.id) return;
    const copy = await duplicateEffect(db, effect.id);
    await loadEffectCatalog();
    await publishEffectCatalogPatchToActiveSessions('upsert', copy);
  };

  const handleDisableEffect = async (effect: LanEffectCatalogItem) => {
    if (!effect.id) return;
    await disableEffect(db, effect.id);
    await loadEffectCatalog();
    await publishEffectCatalogPatchToActiveSessions('disable', effect, effect.statusKey);
  };

  const handleDeleteEffect = async (effect: LanEffectCatalogItem) => {
    if (!effect.id) return;
    const deleted = await deleteEffectIfUnused(db, effect.id);
    if (!deleted) Alert.alert('Em uso', 'Esse efeito esta ativo em alguma sessao. Ele foi mantido.');
    if (deleted) await publishEffectCatalogPatchToActiveSessions('delete', effect, effect.statusKey);
    await loadEffectCatalog();
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

  const toggleFeature = (featName: string) => {
    if (selectedFeatures.some(f => f.name === featName)) {
      setSelectedFeatures(selectedFeatures.filter(f => f.name !== featName));
    } else {
      setSelectedFeatures([...selectedFeatures, { name: featName, level: '1' }]);
    }
  };

  const insertMagicProgression = async (sourceType: string, sourceName: string) => {
      let query = `INSERT INTO spellcasting_progression (source_type, source_name, level, cantrips_known, spells_known, slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8, slot_9, criador) VALUES `;
      let values: any[] = [];
      
      for (let level = 1; level <= 20; level++) {
         let cantrips = 0; let known = 0;
         let s1=0, s2=0, s3=0, s4=0, s5=0, s6=0, s7=0, s8=0, s9=0;

         if (casterType === 'total') {
            cantrips = level < 4 ? 3 : (level < 10 ? 4 : 5);
            s1 = level === 1 ? 2 : (level === 2 ? 3 : 4);
            s2 = level < 3 ? 0 : (level === 3 ? 2 : 3);
            s3 = level < 5 ? 0 : (level === 5 ? 2 : 3);
            s4 = level < 7 ? 0 : (level === 7 ? 1 : (level === 8 ? 2 : 3));
            s5 = level < 9 ? 0 : (level === 9 ? 1 : (level < 18 ? 2 : 3));
            s6 = level < 11 ? 0 : (level < 19 ? 1 : 2);
            s7 = level < 13 ? 0 : (level < 20 ? 1 : 2);
            s8 = level < 15 ? 0 : 1;
            s9 = level < 17 ? 0 : 1;
         } else if (casterType === 'meio') {
            s1 = level < 2 ? 0 : (level < 5 ? 2 : (level < 9 ? 4 : 4));
            s2 = level < 5 ? 0 : (level < 9 ? 2 : 3);
            s3 = level < 9 ? 0 : (level < 13 ? 2 : 3);
            s4 = level < 13 ? 0 : (level < 17 ? 1 : 3);
            s5 = level < 17 ? 0 : (level < 19 ? 1 : 2);
         } else if (casterType === 'terco') {
            cantrips = level < 10 ? 2 : 3;
            s1 = level < 3 ? 0 : (level < 4 ? 2 : (level < 7 ? 3 : 4));
            s2 = level < 7 ? 0 : (level < 10 ? 2 : 3);
            s3 = level < 13 ? 0 : (level < 16 ? 2 : 3);
            s4 = level < 19 ? 0 : 1;
         } else if (casterType === 'pacto') {
            cantrips = level < 4 ? 2 : (level < 10 ? 3 : 4);
            known = level < 10 ? level + 1 : (level < 11 ? 10 : (level < 13 ? 11 : (level < 15 ? 12 : (level < 17 ? 13 : (level < 19 ? 14 : 15)))));
            const slotN = level < 3 ? 1 : (level < 5 ? 2 : (level < 7 ? 3 : (level < 9 ? 4 : 5)));
            const slotQtd = level < 2 ? 1 : (level < 11 ? 2 : (level < 17 ? 3 : 4));
            
            if(slotN===1) s1=slotQtd; else if(slotN===2) s2=slotQtd; else if(slotN===3) s3=slotQtd; else if(slotN===4) s4=slotQtd; else if(slotN===5) s5=slotQtd;
         }

         values.push(`('${sourceType}', '${sourceName}', ${level}, ${cantrips}, ${known}, ${s1}, ${s2}, ${s3}, ${s4}, ${s5}, ${s6}, ${s7}, ${s8}, ${s9}, 'proprio')`);
      }
      
      await db.runAsync(query + values.join(', '));
  }

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Erro', 'O nome é obrigatório!'); return; }
    try {
      if (activeTab === 'Condicoes/Efeitos') {
        const payload = {
          name: name.trim(),
          statusKey: normalizeStatusKey(effectStatusKey || name),
          kind: effectKind as any,
          category: effectCategory || 'custom',
          description: effectDescription,
          color: effectColor || '#888888',
          secondaryColor: effectSecondaryColor || undefined,
          icon: effectIcon || undefined,
          stackable: effectStackable,
          removableBySave: effectRemovableBySave,
          repeatSave: effectRepeatSave,
          saveAbility: effectSaveAbility === 'Nenhum' ? null : effectSaveAbility,
          saveOnSuccess: effectSaveOnSuccess,
          defaultDurationValue: Math.max(0, parseInt(effectDurationValue, 10) || 0),
          defaultDurationUnit: effectDurationUnit as any,
          visualPriority: parseInt(effectPriority, 10) || 0,
          rulesJson: effectRulesNote ? { mechanicalNote: effectRulesNote } : {},
          active: true,
          creator: 'proprio',
        };
        const savedEffect = editingEffectId
          ? await updateEffect(db, editingEffectId, payload)
          : await createEffect(db, payload);
        await loadEffectCatalog();
        await publishEffectCatalogPatchToActiveSessions('upsert', savedEffect);
      }
      else if (activeTab === 'Magia/Skill') {
        let finalCastTime = castTimeType === 'Passiva' ? 'Passiva' : `${castTimeValue} ${castTimeType}`.trim();
        const finalRange = formatStructuredRange(spellRangeMode, spellRangeValue, spellRangeUnit);
        const finalDuration = spellDurationValue ? `${spellDurationValue} ${spellDurationType}` : spellDurationType;
        const spellDurationMeta = parseDurationMetadata(finalDuration);
        const spellEffectJson = JSON.stringify(spellEffectsList.map((eff) => toStructuredSpellEffect(eff, finalDuration, spellDurationMeta)));
        
        let damageParts: string[] = [];
        let typeParts: string[] = [];
        
        spellEffectsList.forEach(eff => {
          if (eff.type === 'Cura') {
            if (eff.dice) damageParts.push(`Cura ${eff.dice}`);
          }
          else if (eff.type === 'Outro') {
            if (eff.dice) damageParts.push(eff.dice);
          }
          else {
            if (eff.dice) {
              damageParts.push(`${eff.dice}`);
              typeParts.push(eff.type);
            }
          }
        });

        const finalDamageDice = damageParts.length > 0 ? damageParts.join(' + ') : '-';
        const finalDamageType = Array.from(new Set(typeParts)).length > 0 ? Array.from(new Set(typeParts)).join(', ') : 'Nenhum';
        const structuredSaves = spellEffectsList.map((eff) => eff.saveAbility).filter((save) => save && save !== 'Nenhum');
        const finalSaves = structuredSaves.length > 0 ? Array.from(new Set(structuredSaves)).join(', ') : 'Nenhum';
        const classReqString = spellClassesReq.map(c => `${c.name}:${c.minLevel}`).join(', ') || 'Nenhum';
        const justClassNames = spellClassesReq.map(c => c.name).join(',') || 'Nenhum';

        // SALVA EXATAMENTE A CATEGORIA ESCOLHIDA NA TELA
        await db.runAsync(
          `INSERT INTO spells (name, level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description, effect_json, duration_value, duration_unit, class_level_required, criador) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
          [name, spellLevel, spellCategory, justClassNames, finalCastTime, finalRange, spellComponents.join(', '), finalDuration, finalDamageDice, finalDamageType, finalSaves, spellDescription, spellEffectJson, spellDurationMeta.value, spellDurationMeta.unit, classReqString]
        );
      }
      else if (activeTab === 'Item') {
        let damageValueParts: string[] = [];
        let damageTypeParts: string[] = [];
        let extraProps: string[] = [];
        const itemEffectJson = itemEffects.map((eff) => toStructuredItemEffect(eff));
        const itemDurationMeta = itemEffectJson.find((eff) => eff.durationValue && eff.durationUnit);

        itemEffects.forEach(eff => {
          let suffix = eff.duration ? (eff.duration === 'Temp' && eff.turns ? ` (Temp: ${eff.turns} turnos)` : ` (${eff.duration})`) : '';
          
          // Se for atributo, Cura ou efeito especial de "Outro", o tipo vai no valor da string
          if (['PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo', 'Cura'].includes(eff.type)) {
              if (eff.type === 'Escolher Atributo') damageValueParts.push(`Escolher ${eff.val}${suffix}`);
              else if (eff.type === 'Cura') damageValueParts.push(`Cura ${eff.val}`);
              else damageValueParts.push(`${eff.type} ${eff.val}${suffix}`);
          } 
          else if (eff.type === 'Outro') {
              if (eff.val) damageValueParts.push(eff.val);
          }
          // Se for um tipo de dano (Fogo, Cortante, etc), separamos o dado (1d6) do tipo (Fogo)
          else {
              if (eff.val) {
                damageValueParts.push(eff.val);
                damageTypeParts.push(eff.type);
              }
          }
        });

        const finalDamage = damageValueParts.length > 0 ? damageValueParts.join(' + ') : '-';
        const finalDamageType = damageTypeParts.length > 0 ? damageTypeParts.join(', ') : '-';
        const finalProps = [itemCategory, ...extraProps, ...properties].filter(Boolean).join(', ');

        await db.runAsync(
          `INSERT INTO items (name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit, criador) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proprio')`,
          [name, parseFloat(weight) || 0, finalDamage, finalDamageType, finalProps, itemDescription, JSON.stringify(itemEffectJson), itemDurationMeta?.durationValue || null, itemDurationMeta?.durationUnit || null]
        );
      } 
      else if (activeTab === 'Raça') {
        const bonificadores = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, parseInt(v) || 0]));
        await db.runAsync(`INSERT INTO races (name, stat_bonuses, speed, features, criador) VALUES (?, ?, ?, ?, 'proprio')`, [name, JSON.stringify(bonificadores), speed, JSON.stringify(selectedFeatures.map(f=>f.name))]);
      }
      else if (activeTab === 'Classe') {
        const parsedSaves = saves.map(s => `save_${s.toLowerCase()}`);
        await db.runAsync(`INSERT INTO classes (name, recommended_stats, starting_equipment, starting_gold, hit_dice, saves, subclass_level, is_caster, features, criador) VALUES (?, '{}', '[]', ?, ?, ?, ?, ?, ?, 'proprio')`, [name, parseInt(gold) || 0, parseInt(hitDice) || 8, JSON.stringify(parsedSaves), parseInt(subclassLevel) || 3, isCaster ? 1 : 0, JSON.stringify(selectedFeatures.map(f=>f.name))]);
        if(isCaster) await insertMagicProgression('class', name);
      }
      else if (activeTab === 'Subclasse') {
        if (subclassParents.length === 0) { Alert.alert('Erro', 'Adicione ao menos uma classe pai para esta subclasse.'); return; }
        const parentNames = subclassParents.map(c => c.name).join(', ');
        const mainLevelReq = parseInt(subclassParents[0].minLevel) || 3;
        const bnsSkills = parseInt(bonusSkills) || 0;
        
        await db.runAsync(`INSERT INTO subclasses (name, class_name, level_required, bonus_skills, features, criador) VALUES (?, ?, ?, ?, ?, 'proprio')`, [name, parentNames, mainLevelReq, bnsSkills, JSON.stringify(selectedFeatures.map(f=>f.name))]);
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
      <Text style={styles.label}>HABILIDADES PASSIVAS E INATAS</Text>
      
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10}}>
        {selectedFeatures.map((feat, index) => (
          <View key={feat.name} style={styles.featureBadge}>
            <Text style={styles.featureBadgeText}>{feat.name}</Text>
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
                    {isSelected ? (
                       <Ionicons name="checkmark-circle" size={28} color="#00fa9a" />
                    ) : (
                       <Ionicons name="add-circle-outline" size={28} color="#00bfff" />
                    )}
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma passiva encontrada. Crie uma na aba Magia/Skill marcando o nível ou tempo como &quot;Passiva&quot;.</Text>}
            />
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setFeatureModalVisible(false)}>
              <Text style={styles.modalCloseText}>FECHAR</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  const renderDiceSelector = (
    count: string,
    setCount: React.Dispatch<React.SetStateAction<string>>,
    sides: string,
    setSides: React.Dispatch<React.SetStateAction<string>>,
    bonus: string,
    setBonus: React.Dispatch<React.SetStateAction<string>>
  ) => (
    <View style={{ marginBottom: 15 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <TextInput
          style={[styles.input, { flex: 0.35, textAlign: 'center', paddingVertical: 8 }]}
          keyboardType="numeric"
          value={count}
          onChangeText={(value) => setCount(value.replace(/[^0-9]/g, ''))}
          placeholder="Qtd"
          placeholderTextColor="#666"
        />
        <Text style={styles.label}>d</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DICE_SIDES.map((side) => (
              <TouchableOpacity key={side} style={[styles.limitBtn, sides === String(side) && styles.limitBtnActive]} onPress={() => setSides(String(side))}>
                <Text style={[styles.limitBtnText, sides === String(side) && styles.limitBtnTextActive]}>{side}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
      <TextInput
        style={[styles.input, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
        keyboardType="numeric"
        value={bonus}
        onChangeText={(value) => setBonus(value.replace(/[^0-9-]/g, ''))}
        placeholder="Bonus fixo opcional"
        placeholderTextColor="#666"
      />
    </View>
  );

  const renderItemForm = () => {
    const isAttribute = ['PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'Escolher Atributo'].includes(tempEffType);

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
          <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>VALOR DO EFEITO</Text>
          <View style={{flexDirection: 'row', gap: 8, marginBottom: 12}}>
            {(['dice', 'value', 'none'] as const).map(mode => (
              <TouchableOpacity key={mode} style={[styles.limitBtn, itemEffectAmountMode === mode && styles.limitBtnActive]} onPress={() => setItemEffectAmountMode(mode)}>
                <Text style={[styles.limitBtnText, itemEffectAmountMode === mode && styles.limitBtnTextActive]}>{mode === 'dice' ? 'Dado' : mode === 'value' ? 'Valor' : 'Sem valor'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {itemEffectAmountMode === 'dice' && renderDiceSelector(itemDiceCount, setItemDiceCount, itemDiceSides, setItemDiceSides, itemFlatBonus, setItemFlatBonus)}
          {itemEffectAmountMode === 'value' && (
            <TextInput style={[styles.input, {marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.4)'}]} keyboardType="numeric" placeholder="Valor fixo (Ex: +2, -1, 21)" placeholderTextColor="#888" value={tempEffVal} onChangeText={(value) => setTempEffVal(value.replace(/[^0-9+-]/g, ''))} />
          )}
          
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

          <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>TESTE DE RESISTENCIA DO ITEM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
            <View style={{flexDirection: 'row', gap: 8}}>
              {SAVE_CHOICES.map(save => (
                <TouchableOpacity key={save} style={[styles.limitBtn, itemSaveAbility === save && styles.limitBtnActive]} onPress={() => setItemSaveAbility(save)}>
                  <Text style={[styles.limitBtnText, itemSaveAbility === save && styles.limitBtnTextActive]}>{save}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {itemSaveAbility !== 'Nenhum' && (
            <>
              <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
                <TextInput style={[styles.input, {flex: 0.35, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.4)'}]} keyboardType="numeric" value={itemSaveDc} onChangeText={(value) => setItemSaveDc(value.replace(/[^0-9]/g, ''))} placeholder="CD" placeholderTextColor="#888" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    {SAVE_SUCCESS_CHOICES.map(result => (
                      <TouchableOpacity key={result.key} style={[styles.limitBtn, itemSaveOnSuccess === result.key && styles.limitBtnActive]} onPress={() => setItemSaveOnSuccess(result.key)}>
                        <Text style={[styles.limitBtnText, itemSaveOnSuccess === result.key && styles.limitBtnTextActive]}>{result.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>SE FALHAR, APLICA CONDICAO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {conditionOptions.map(condition => (
                    <TouchableOpacity key={condition.key} style={[styles.limitBtn, itemConditionKey === condition.key && styles.limitBtnActive]} onPress={() => setItemConditionKey(condition.key)}>
                      <Text style={[styles.limitBtnText, itemConditionKey === condition.key && styles.limitBtnTextActive]}>{condition.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </>
          )}
          
          <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
            const amount = buildEffectAmount(itemEffectAmountMode, itemDiceCount, itemDiceSides, itemFlatBonus, tempEffVal);
            if(!amount && tempEffType !== 'Outro' && itemConditionKey === 'none') {
                Alert.alert("Aviso", "Insira um valor ou dado para o efeito.");
                return;
            }
            setItemEffects([...itemEffects, {
              val: amount,
              type: tempEffType,
              duration: isAttribute ? tempEffDuration : '',
              turns: tempEffTurns,
              saveAbility: itemSaveAbility,
              saveDc: itemSaveDc,
              saveOnSuccess: itemSaveOnSuccess,
              conditionKey: itemConditionKey,
              conditionName: getConditionOption(itemConditionKey, conditionOptions).name,
              conditionColor: getConditionOption(itemConditionKey, conditionOptions).color,
              conditionSecondaryColor: (getConditionOption(itemConditionKey, conditionOptions) as any).secondaryColor,
            }]);
            setTempEffVal(''); setTempEffDuration(''); setTempEffTurns(''); setItemConditionKey('none'); setItemSaveAbility('Nenhum');
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
              else if (['PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(eff.type)) displayText = `${eff.type} ${eff.val}${suffix}`;
              else displayText = `${eff.val} ${eff.type}`;
              const condition = getConditionOption(eff.conditionKey, conditionOptions);
              if (eff.saveAbility && eff.saveAbility !== 'Nenhum') displayText += ` | Teste ${eff.saveAbility} CD ${eff.saveDc || '?'}`;
              if (condition && condition.key !== 'none') displayText += ` | Falha: ${condition.name}`;

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
                setSpellRange('Pessoal');
                setSpellRangeMode('Pessoal');
              } else {
                setSpellLevel('Nível 1');
                setCastTimeType('Ação Bônus');
                setSpellComponents([]);
                setSpellRange('Pessoal');
                setSpellRangeMode('Pessoal');
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
              keyboardType="numeric" 
              value={castTimeValue} 
              onChangeText={setCastTimeValue} 
              placeholder="Qtd" 
              placeholderTextColor="#666"
            />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: (castTimeType === 'Passiva' || castTimeType === 'Especial') ? 1 : 0.75}}>
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
          <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}>
            <Text style={styles.label}>ALCANCE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 8}}>
              <View style={{flexDirection: 'row', gap: 5}}>
                {RANGE_MODES.map(r => (
                  <TouchableOpacity key={r} style={[styles.limitBtn, spellRangeMode === r && styles.limitBtnActive, {paddingVertical: 4, paddingHorizontal: 8}]} onPress={() => setSpellRangeMode(r)}>
                    <Text style={[styles.limitBtnText, spellRangeMode === r && styles.limitBtnTextActive, {fontSize: 9}]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {!['Pessoal', 'Toque'].includes(spellRangeMode) && (
              <View style={{flexDirection: 'row', gap: 8}}>
                <TextInput
                  style={[styles.input, {flex: 0.45, textAlign: 'center'}]}
                  value={spellRangeValue}
                  onChangeText={(value) => setSpellRangeValue(value.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="Valor"
                  placeholderTextColor="#666"
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 0.55}}>
                  <View style={{flexDirection: 'row', gap: 5}}>
                    {RANGE_UNITS.map(unit => (
                      <TouchableOpacity key={unit} style={[styles.limitBtn, spellRangeUnit === unit && styles.limitBtnActive, {paddingVertical: 4, paddingHorizontal: 8}]} onPress={() => setSpellRangeUnit(unit)}>
                        <Text style={[styles.limitBtnText, spellRangeUnit === unit && styles.limitBtnTextActive, {fontSize: 9}]}>{unit}</Text>
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
              keyboardType="numeric" 
              value={spellDurationValue} 
              onChangeText={setSpellDurationValue} 
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

        <Text style={styles.label}>CONSTRUTOR DE EFEITOS (Adicione múltiplos)</Text>
        <View style={styles.effectBuilder}>
          <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>VALOR / DADO</Text>
          <View style={{flexDirection: 'row', gap: 8, marginBottom: 12}}>
            {(['dice', 'value', 'none'] as const).map(mode => (
              <TouchableOpacity key={mode} style={[styles.limitBtn, spellEffectAmountMode === mode && styles.limitBtnActive]} onPress={() => setSpellEffectAmountMode(mode)}>
                <Text style={[styles.limitBtnText, spellEffectAmountMode === mode && styles.limitBtnTextActive]}>{mode === 'dice' ? 'Dado' : mode === 'value' ? 'Valor' : 'Sem valor'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {spellEffectAmountMode === 'dice' && renderDiceSelector(spellDiceCount, setSpellDiceCount, spellDiceSides, setSpellDiceSides, spellFlatBonus, setSpellFlatBonus)}
          {spellEffectAmountMode === 'value' && (
            <TextInput style={[styles.input, {marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.4)'}]} keyboardType="numeric" placeholder="Valor fixo (Ex: +2, -1)" placeholderTextColor="#888" value={tempSpellDice} onChangeText={(value) => setTempSpellDice(value.replace(/[^0-9+-]/g, ''))} />
          )}
          
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

          <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>TESTE DE RESISTENCIA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
            <View style={{flexDirection: 'row', gap: 8}}>
              {SAVE_CHOICES.map(save => (
                <TouchableOpacity key={save} style={[styles.limitBtn, spellSaveAbility === save && styles.limitBtnActive]} onPress={() => setSpellSaveAbility(save)}>
                  <Text style={[styles.limitBtnText, spellSaveAbility === save && styles.limitBtnTextActive]}>{save}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {spellSaveAbility !== 'Nenhum' && (
            <>
              <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
                <TextInput style={[styles.input, {flex: 0.35, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.4)'}]} keyboardType="numeric" value={spellSaveDc} onChangeText={(value) => setSpellSaveDc(value.replace(/[^0-9]/g, ''))} placeholder="CD" placeholderTextColor="#888" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    {SAVE_SUCCESS_CHOICES.map(result => (
                      <TouchableOpacity key={result.key} style={[styles.limitBtn, spellSaveOnSuccess === result.key && styles.limitBtnActive]} onPress={() => setSpellSaveOnSuccess(result.key)}>
                        <Text style={[styles.limitBtnText, spellSaveOnSuccess === result.key && styles.limitBtnTextActive]}>{result.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <Text style={[styles.label, {fontSize: 9, color: 'rgba(255,255,255,0.5)'}]}>SE FALHAR, APLICA CONDICAO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {conditionOptions.map(condition => (
                    <TouchableOpacity key={condition.key} style={[styles.limitBtn, spellConditionKey === condition.key && styles.limitBtnActive]} onPress={() => setSpellConditionKey(condition.key)}>
                      <Text style={[styles.limitBtnText, spellConditionKey === condition.key && styles.limitBtnTextActive]}>{condition.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </>
          )}
          
          <TouchableOpacity style={styles.addEffectBtn} onPress={() => {
            const finalType = tempSpellDmgType === 'Outro' ? tempSpellCustomType : tempSpellDmgType;
            const amount = buildEffectAmount(spellEffectAmountMode, spellDiceCount, spellDiceSides, spellFlatBonus, tempSpellDice);
            if (!finalType) { Alert.alert('Aviso', 'Defina o nome do efeito especial.'); return; }
            if (!amount && tempSpellDmgType !== 'Outro' && tempSpellDmgType !== 'Cura' && spellConditionKey === 'none') {
              Alert.alert('Aviso', 'Adicione um dado/valor para este tipo de dano.'); return; 
            }
            
            setSpellEffectsList([...spellEffectsList, {
              dice: amount,
              type: finalType,
              saveAbility: spellSaveAbility,
              saveDc: spellSaveDc,
              saveOnSuccess: spellSaveOnSuccess,
              conditionKey: spellConditionKey,
              conditionName: getConditionOption(spellConditionKey, conditionOptions).name,
              conditionColor: getConditionOption(spellConditionKey, conditionOptions).color,
              conditionSecondaryColor: (getConditionOption(spellConditionKey, conditionOptions) as any).secondaryColor,
            }]);
            setTempSpellDice(''); setTempSpellCustomType(''); setTempSpellDmgType('Fogo'); setSpellConditionKey('none'); setSpellSaveAbility('Nenhum');
          }}>
            <Text style={styles.addEffectBtnText}>+ ADICIONAR EFEITO</Text>
          </TouchableOpacity>
        </View>

        {spellEffectsList.length > 0 && (
          <View style={{marginBottom: 20}}>
            {spellEffectsList.map((eff, i) => {
              const condition = getConditionOption(eff.conditionKey, conditionOptions);
              let displayText = eff.dice ? `${eff.dice} (${eff.type})` : `${eff.type}`;
              if (eff.saveAbility && eff.saveAbility !== 'Nenhum') displayText += ` | Teste ${eff.saveAbility}${eff.saveDc ? ` CD ${eff.saveDc}` : ''}`;
              if (condition && condition.key !== 'none') displayText += ` | Falha: ${condition.name}`;
              return (
                <View key={i} style={styles.effectRow}>
                  <Text style={styles.effectText}>{displayText}</Text>
                  <TouchableOpacity onPress={() => setSpellEffectsList(spellEffectsList.filter((_, idx) => idx !== i))}><Ionicons name="trash" size={20} color="#ff6666" /></TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {spellLevel !== 'Passiva' && (
          <>
            <Text style={styles.label}>QUAIS CLASSES APRENDEM ESSA {spellCategory.toUpperCase()}?</Text>
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
          <Text style={styles.counterText}>Total Bônus: {totalStats > 0 ? `+${totalStats}` : totalStats}</Text>
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
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>DADO DE VIDA (d)</Text><TextInput style={styles.input} keyboardType="numeric" value={hitDice} onChangeText={setHitDice} placeholder="8" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1}]}><Text style={styles.label}>OURO INICIAL</Text><TextInput style={styles.input} keyboardType="numeric" value={gold} onChangeText={setGold} placeholder="10" placeholderTextColor="#666"/></View>
      </View>
      <View style={styles.row}>
        <View style={[styles.formGroup, {flex: 1, marginRight: 10}]}><Text style={styles.label}>NÍVEL SUBCLASSE</Text><TextInput style={styles.input} keyboardType="numeric" value={subclassLevel} onChangeText={setSubclassLevel} placeholder="3" placeholderTextColor="#666"/></View>
        <View style={[styles.formGroup, {flex: 1, alignItems: 'center', justifyContent: 'center'}]}>
          <Text style={styles.label}>USA MAGIA?</Text>
          <Switch value={isCaster} onValueChange={(val) => { setIsCaster(val); if(val) setProgressionModalVisible(true); }} trackColor={{ false: "#767577", true: "#00bfff" }} thumbColor={isCaster ? "#fff" : "#f4f3f4"} />
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

      <View style={styles.formGroup}>
         <Text style={styles.label}>SUBCLASSE DE CONJURADOR? (Ex: Cavaleiro Arcano)</Text>
         <Switch value={isCaster} onValueChange={(val) => { setIsCaster(val); if(val) setProgressionModalVisible(true); }} trackColor={{ false: "#767577", true: "#00bfff" }} thumbColor={isCaster ? "#fff" : "#f4f3f4"} />
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

  const renderEffectCatalogForm = () => (
    <>
      <View style={styles.formGroup}>
        <Text style={styles.label}>CHAVE DO SISTEMA</Text>
        <TextInput
          style={styles.input}
          value={effectStatusKey}
          onChangeText={(value) => setEffectStatusKey(normalizeStatusKey(value))}
          placeholder={normalizeStatusKey(name || 'dor_de_cabeca')}
          placeholderTextColor="#666"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>TIPO MECANICO</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{flexDirection: 'row', gap: 8}}>
            {['condition', 'buff', 'debuff', 'disease', 'curse', 'custom'].map((kind) => (
              <TouchableOpacity key={kind} style={[styles.limitBtn, effectKind === kind && styles.limitBtnActive]} onPress={() => setEffectKind(kind)}>
                <Text style={[styles.limitBtnText, effectKind === kind && styles.limitBtnTextActive]}>{kind}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>VISUAL</Text>
        <View style={{flexDirection: 'row', gap: 10}}>
          <TextInput style={[styles.input, {flex: 1}]} value={effectColor} onChangeText={setEffectColor} placeholder="#8E44AD" placeholderTextColor="#666" />
          <TextInput style={[styles.input, {flex: 1}]} value={effectSecondaryColor} onChangeText={setEffectSecondaryColor} placeholder="#D2B4DE" placeholderTextColor="#666" />
        </View>
        <View style={{flexDirection: 'row', gap: 10, marginTop: 8}}>
          <TextInput style={[styles.input, {flex: 1}]} value={effectIcon} onChangeText={setEffectIcon} placeholder="brain" placeholderTextColor="#666" />
          <TextInput style={[styles.input, {flex: 1}]} value={effectPriority} onChangeText={(value) => setEffectPriority(value.replace(/[^0-9-]/g, ''))} keyboardType="numeric" placeholder="40" placeholderTextColor="#666" />
        </View>
        <View style={{height: 10}} />
        <View style={{height: 12, borderRadius: 6, backgroundColor: effectColor || '#888', borderWidth: 1, borderColor: effectSecondaryColor || 'rgba(255,255,255,0.2)'}} />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>DURACAO PADRAO</Text>
        <View style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
          <TextInput style={[styles.input, {flex: 0.35}]} value={effectDurationValue} onChangeText={(value) => setEffectDurationValue(value.replace(/[^0-9]/g, ''))} keyboardType="numeric" placeholder="1" placeholderTextColor="#666" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
            <View style={{flexDirection: 'row', gap: 8}}>
              {['turn', 'minute', 'hour', 'day', 'rest', 'while_equipped', 'until_save', 'permanent', 'manual'].map((unit) => (
                <TouchableOpacity key={unit} style={[styles.limitBtn, effectDurationUnit === unit && styles.limitBtnActive]} onPress={() => setEffectDurationUnit(unit)}>
                  <Text style={[styles.limitBtnText, effectDurationUnit === unit && styles.limitBtnTextActive]}>{unit}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <View style={styles.effectBuilder}>
        <View style={styles.ruleRow}>
          <View style={styles.ruleTextBox}>
            <Text style={styles.ruleTitle}>Pode empilhar</Text>
            <Text style={styles.ruleDescription}>Permite mais de uma instancia do mesmo status no alvo.</Text>
          </View>
          <Switch value={effectStackable} onValueChange={setEffectStackable} />
        </View>
        <View style={styles.ruleRow}>
          <View style={styles.ruleTextBox}>
            <Text style={styles.ruleTitle}>Remove por teste</Text>
            <Text style={styles.ruleDescription}>Cria saves pendentes durante a passagem de turno.</Text>
          </View>
          <Switch value={effectRemovableBySave} onValueChange={setEffectRemovableBySave} />
        </View>

        {effectRemovableBySave && (
          <>
            <Text style={styles.label}>TESTE PADRAO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
              <View style={{flexDirection: 'row', gap: 8}}>
                {SAVE_CHOICES.map((save) => (
                  <TouchableOpacity key={save} style={[styles.limitBtn, effectSaveAbility === save && styles.limitBtnActive]} onPress={() => setEffectSaveAbility(save)}>
                    <Text style={[styles.limitBtnText, effectSaveAbility === save && styles.limitBtnTextActive]}>{save}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
              <View style={{flexDirection: 'row', gap: 8}}>
                {['none', 'start_of_turn', 'end_of_turn', 'action', 'manual'].map((repeat) => (
                  <TouchableOpacity key={repeat} style={[styles.limitBtn, effectRepeatSave === repeat && styles.limitBtnActive]} onPress={() => setEffectRepeatSave(repeat)}>
                    <Text style={[styles.limitBtnText, effectRepeatSave === repeat && styles.limitBtnTextActive]}>{repeat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{flexDirection: 'row', gap: 8}}>
                {['remove', 'reduce_duration', 'ignore', 'half_damage', 'negates'].map((result) => (
                  <TouchableOpacity key={result} style={[styles.limitBtn, effectSaveOnSuccess === result && styles.limitBtnActive]} onPress={() => setEffectSaveOnSuccess(result)}>
                    <Text style={[styles.limitBtnText, effectSaveOnSuccess === result && styles.limitBtnTextActive]}>{result}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>DESCRICAO PUBLICA</Text>
        <TextInput style={[styles.input, {minHeight: 80, textAlignVertical: 'top'}]} multiline value={effectDescription} onChangeText={setEffectDescription} placeholder="O personagem esta sob um efeito..." placeholderTextColor="#666" />
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.label}>NOTA MECANICA</Text>
        <TextInput style={[styles.input, {minHeight: 70, textAlignVertical: 'top'}]} multiline value={effectRulesNote} onChangeText={setEffectRulesNote} placeholder="Regra opcional da mesa" placeholderTextColor="#666" />
      </View>

      <View style={{marginTop: 14}}>
        <Text style={styles.label}>CATALOGO</Text>
        {effectCatalog.map((effect) => (
          <View key={effect.id || effect.statusKey} style={styles.effectRow}>
            <View style={{flex: 1}}>
              <Text style={styles.effectText}>{effect.name} <Text style={{color: effect.color}}>{effect.statusKey}</Text></Text>
              <Text style={styles.hpHint}>{effect.kind} - prioridade {effect.visualPriority} {effect.active ? '' : '- inativo'}</Text>
            </View>
            <TouchableOpacity onPress={() => startEditEffect(effect)}><Ionicons name="create-outline" size={19} color="#00bfff" /></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDuplicateEffect(effect)}><Ionicons name="copy-outline" size={19} color="#00fa9a" /></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDisableEffect(effect)}><Ionicons name="pause-circle-outline" size={19} color="#ffd166" /></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteEffect(effect)}><Ionicons name="trash" size={19} color="#ff6666" /></TouchableOpacity>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
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

      {/* MODAL DE PROGRESSÃO MÁGICA RÁPIDA */}
      <Modal visible={progressionModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setProgressionModalVisible(false)}>
           <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Modelo de Progressão Mágica</Text>
              <Text style={[styles.hpHint, {marginBottom: 20}]}>Escolha o modelo que será aplicado do nível 1 ao 20 para esta classe.</Text>
              
              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'total' ? 'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('total'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'total' ? '#00bfff' : '#fff'}]}>Conjurador Total</Text>
                 <Text style={styles.catalogItemSub}>Tem Truques. Chega a magias de Nível 9 (Ex: Mago, Bardo, Clérigo).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'meio' ? 'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('meio'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'meio' ? '#00bfff' : '#fff'}]}>Meio-Conjurador</Text>
                 <Text style={styles.catalogItemSub}>Sem Truques. Magias começam Nível 2 e vão até Nível 5 (Ex: Paladino, Patrulheiro).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'terco' ? 'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('terco'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'terco' ? '#00bfff' : '#fff'}]}>1/3 Conjurador</Text>
                 <Text style={styles.catalogItemSub}>Tem Truques. Magias começam Nível 3 e vão até Nível 4 (Ex: Cavaleiro Arcano).</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.catalogItem, {flexDirection: 'column', alignItems: 'flex-start', backgroundColor: casterType === 'pacto' ? 'rgba(0,191,255,0.2)' : 'transparent', padding: 15, borderRadius: 12}]} onPress={() => { setCasterType('pacto'); setProgressionModalVisible(false); }}>
                 <Text style={[styles.catalogItemName, {color: casterType === 'pacto' ? '#00bfff' : '#fff'}]}>Magia de Pacto</Text>
                 <Text style={styles.catalogItemSub}>Poucos espaços, mas sempre no nível máximo possível (Ex: Bruxo).</Text>
              </TouchableOpacity>

           </Pressable>
        </Pressable>
      </Modal>

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
                {activeTab === 'Condicoes/Efeitos' && renderEffectCatalogForm()}
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

function parseDurationMetadata(duration: string) {
  const raw = String(duration || '').toLowerCase();
  if (!raw || raw.includes('instant') || raw.includes('permanente')) {
    return { value: null as number | null, unit: null as string | null };
  }

  const value = Math.max(1, parseInt(raw.match(/\d+/)?.[0] || '1') || 1);
  if (raw.includes('rodada') || raw.includes('turno')) return { value, unit: 'turn' };
  if (raw.includes('min')) return { value, unit: 'minute' };
  if (raw.includes('hora')) return { value, unit: 'hour' };
  if (raw.includes('dia')) return { value: value * 24, unit: 'hour' };
  if (raw.includes('concentra')) return { value: 1, unit: 'rest' };
  return { value: 1, unit: 'rest' };
}

function buildEffectAmount(mode: 'dice' | 'value' | 'none', count: string, sides: string, bonus: string, fixedValue: string) {
  if (mode === 'none') return '';
  if (mode === 'value') return String(fixedValue || '').trim();

  const diceCount = Math.max(1, parseInt(count, 10) || 1);
  const diceSides = DICE_SIDES.includes(parseInt(sides, 10)) ? parseInt(sides, 10) : 6;
  const flat = parseInt(bonus, 10) || 0;
  return `${diceCount}d${diceSides}${flat === 0 ? '' : flat > 0 ? `+${flat}` : flat}`;
}

function formatStructuredRange(mode: string, value: string, unit: string) {
  if (mode === 'Pessoal' || mode === 'Toque') return mode;
  const amount = Math.max(1, parseInt(value, 10) || 1);
  if (mode === 'Distancia') return `${amount}${unit || 'm'}`;
  return `${mode} ${amount}${unit || 'm'}`;
}

function getConditionOption(key?: string, options = CONDITION_OPTIONS) {
  if (!key || key === 'none') return options[0] || CONDITION_OPTIONS[0];
  return options.find((condition) => condition.key === key) || CONDITION_OPTIONS.find((condition) => condition.key === key) || { key, name: key, color: '' };
}

function buildSavePayload(ability?: string, dc?: string, onSuccess?: string) {
  if (!ability || ability === 'Nenhum') return undefined;
  const parsedDc = parseInt(String(dc || ''), 10);
  return {
    ability,
    dc: Number.isFinite(parsedDc) && parsedDc > 0 ? parsedDc : undefined,
    dcSource: Number.isFinite(parsedDc) && parsedDc > 0 ? 'manual' : 'caster',
    onSuccess: onSuccess || 'none',
  };
}

function buildConditionPayload(effect: any, hasSave: boolean, durationValue?: number | null, durationUnit?: string | null) {
  const condition = getConditionOption(effect.conditionKey);
  if (!condition || condition.key === 'none') return undefined;
  return {
    key: condition.key,
    statusKey: condition.key,
    name: effect.conditionName || condition.name,
    applyOn: hasSave ? 'failed_save' : 'always',
    color: effect.conditionColor || condition.color,
    secondaryColor: effect.conditionSecondaryColor,
    duration: {
      value: durationValue || 1,
      unit: durationUnit || 'turn',
      untilSave: hasSave,
      repeatSave: hasSave ? 'end_of_turn' : 'none',
    },
  };
}

function toStructuredSpellEffect(effect: any, durationText: string, durationMeta: { value: number | null; unit: string | null }) {
  const save = buildSavePayload(effect.saveAbility, effect.saveDc, effect.saveOnSuccess);
  const condition = buildConditionPayload(effect, Boolean(save), durationMeta.value, durationMeta.unit);
  const isHeal = effect.type === 'Cura';
  const isCustom = effect.type === 'Outro' || (!isHeal && !SPELL_DAMAGE_TYPES.includes(effect.type));

  return {
    type: condition && !effect.dice ? 'condition' : isHeal ? 'heal' : isCustom ? 'custom' : 'damage',
    kind: condition && !effect.dice ? 'condition' : isHeal ? 'heal' : isCustom ? 'custom' : 'damage',
    dice: effect.dice || '',
    damageDice: !isHeal && !isCustom ? effect.dice || '' : undefined,
    healDice: isHeal ? effect.dice || '' : undefined,
    damageType: !isHeal && !isCustom ? effect.type : undefined,
    customType: isCustom ? effect.type : undefined,
    durationText,
    durationValue: durationMeta.value,
    durationUnit: durationMeta.unit,
    save,
    condition,
  };
}

function toStructuredItemEffect(effect: any) {
  const durationValue = effect.duration === 'Temp' && effect.turns ? Math.max(1, parseInt(effect.turns) || 1) : null;
  const durationUnit = effect.duration === 'Perm' ? 'permanent' : durationValue ? 'turn' : null;
  const isStat = ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(effect.type);
  const isTempHp = effect.type === 'PV_TEMP';
  const isChooseStat = effect.type === 'Escolher Atributo';
  const isDamage = !isStat && !isTempHp && effect.type !== 'Cura' && effect.type !== 'Outro' && effect.type !== 'Escolher Atributo';
  const save = buildSavePayload(effect.saveAbility, effect.saveDc, effect.saveOnSuccess);
  const condition = buildConditionPayload(effect, Boolean(save), durationValue, durationUnit);

  return {
    type: condition && !effect.val ? 'condition' : isTempHp ? 'temp_hp' : (isStat || isChooseStat) ? 'stat' : effect.type === 'Cura' ? 'heal' : isDamage ? 'damage' : 'custom',
    kind: condition && !effect.val ? 'condition' : isTempHp ? 'temp_hp' : (isStat || isChooseStat) ? 'stat' : effect.type === 'Cura' ? 'heal' : isDamage ? 'damage' : 'custom',
    target: isTempHp ? 'PV_TEMP' : isChooseStat ? 'CHOOSE_STAT' : isStat ? effect.type : undefined,
    chooseStat: isChooseStat,
    value: parseInt(String(effect.val).replace('+', '')) || 0,
    dice: /d\d+/i.test(String(effect.val)) ? String(effect.val) : '',
    damageDice: /d\d+/i.test(String(effect.val)) && isDamage ? String(effect.val) : undefined,
    healDice: effect.type === 'Cura' ? String(effect.val || '') : undefined,
    damageType: isDamage ? effect.type : undefined,
    effectType: effect.type,
    durationText: effect.duration === 'Temp'
      ? durationValue ? `${durationValue} turno(s)` : 'Temporario'
      : effect.duration === 'Perm' ? 'Permanente' : '',
    durationValue,
    durationUnit,
    save,
    condition,
  };
}
