// ================= IMPORTAÇÕES DA CAMADA BÁSICA =================
import DiceRoller3D, { type DiceRollRequest } from '@/components/DiceRoller3D';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appColors, appGradients, sheetStyles as styles } from '@/styles/globalStyles';
import {
  applyLanSessionStateToCharacter,
  fetchLanSessionEvents,
  fetchLanSessionPayload,
  getLocalLanSessionForCharacter,
  getPublicLanPlayers,
  makeLanCharacterKey,
  makeLanEventId,
  rememberLanSessionEvent,
  sendLanSessionEvent,
  type LanSessionEvent,
  type LanSessionPayload,
  type LanTradeItem,
  type LanEffectTarget,
  type LanEffectUnit,
  type PublicLanPlayer,
} from '@/services/lanSession';

const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

const DEFAULT_SLOTS = { 
  helmet: null, cloak: null, amulet: null, armor: null, campClothes: null,
  gloves: null, boots: null, ring1: null, ring2: null, 
  mainHand: null, offHand: null, ranged: null, lightSource: null 
};

const SPELL_LEVELS = ['Todos', 'Passiva', 'Habilidade', 'Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
const SPELL_EFFECTS = ['Todos', 'Dano', 'Cura', 'Suporte/Defesa'];

const COIN_RATES = { gp: 100, sp: 10, cp: 1 };
const COIN_NAMES = { gp: 'Ouro', sp: 'Prata', cp: 'Cobre' };
const COIN_COLORS = { gp: appColors.warning, sp: appColors.silver, cp: appColors.copper };

// Força a categoria correta para o agrupamento
const getCategory = (spell: any): string => {
  if (spell.category && spell.category !== 'Desconhecido') return spell.category;
  if (spell.level === 'Truque' || spell.level?.includes('Nível')) return 'Magia';
  if (spell.casting_time === 'Passiva' || spell.level === 'Passiva') return 'Passiva';
  return 'Habilidade';
};

export default function CharacterSheetScreen() {
  const { id, sessionId, joinUrl } = useLocalSearchParams<{ id?: string; sessionId?: string; joinUrl?: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const routeSessionId = firstParam(sessionId);
  const routeJoinUrl = decodeParam(firstParam(joinUrl));

  const [activeTab, setActiveTab] = useState<'stats' | 'profs' | 'inv' | 'spells'>('stats');
  const [character, setCharacter] = useState<any>(null);
  
  const [spellDetails, setSpellDetails] = useState<any[]>([]);
  const [dbItemsCatalog, setDbItemsCatalog] = useState<any[]>([]);
  const [dbSkills, setDbSkills] = useState<any[]>([]);
  const [dbSaves, setDbSaves] = useState<any[]>([]);
  
  const [charRaceSpeed, setCharRaceSpeed] = useState('9m');
  const [charHasSpells, setCharHasSpells] = useState(false);

  const [loading, setLoading] = useState(true);

  // Estados de Modais e Inventário
  const [xpModalVisible, setXpModalVisible] = useState(false);
  const [hpModalVisible, setHpModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [coinModalVisible, setCoinModalVisible] = useState(false);
  const [activeCoinType, setActiveCoinType] = useState<'gp' | 'sp' | 'cp'>('gp');
  const [inputValue, setInputValue] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  // Sistema de Câmbio de Moedas
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [convertFrom, setConvertFrom] = useState<'gp' | 'sp' | 'cp'>('sp');
  const [convertTo, setConvertTo] = useState<'gp' | 'sp' | 'cp'>('gp');
  const [convertAmount, setConvertAmount] = useState('');

  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<keyof typeof DEFAULT_SLOTS | null>(null);
  const [levelUpModalVisible, setLevelUpModalVisible] = useState(false);
  const [newLevelData, setNewLevelData] = useState(0);

  // Estados do Menu de Ação
  const [selectedBagItem, setSelectedBagItem] = useState<{item: any, index: number} | null>(null);
  const [actionQty, setActionQty] = useState(1);
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});
  const [lanInfo, setLanInfo] = useState<{ sessionId: string; joinUrl: string } | null>(null);
  const [lanPlayers, setLanPlayers] = useState<PublicLanPlayer[]>([]);
  const [incomingTrades, setIncomingTrades] = useState<LanSessionEvent[]>([]);
  const [targetPickerMode, setTargetPickerMode] = useState<'send' | 'trade' | null>(null);
  const [selectedTradeOffer, setSelectedTradeOffer] = useState<LanSessionEvent | null>(null);
  const [tradeCounterItem, setTradeCounterItem] = useState<{item: any, index: number} | null>(null);
  const [tradeCounterQty, setTradeCounterQty] = useState(1);
  const [spellCastVisible, setSpellCastVisible] = useState(false);
  const [spellTargetKeys, setSpellTargetKeys] = useState<string[]>([]);
  const [spellTargetAmounts, setSpellTargetAmounts] = useState<Record<string, string>>({});
  const [spellRollResult, setSpellRollResult] = useState('');
  const [spellEffectTarget, setSpellEffectTarget] = useState<LanEffectTarget>('custom');
  const [spellEffectValue, setSpellEffectValue] = useState('0');

  // Sistema de Buffs Temporários
  const [tempBuffModalVisible, setTempBuffModalVisible] = useState(false);
  const [activeBuffStat, setActiveBuffStat] = useState('');
  const [tempBuffValue, setTempBuffValue] = useState('');

  // Filtros de Magia
  const [spellSearch, setSpellSearch] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('Todos');
  const [spellEffectFilter, setSpellEffectFilter] = useState('Todos');
  const [spellSortOrder, setSpellSortOrder] = useState<'A-Z' | 'Z-A'>('A-Z');
  const [diceRollRequest, setDiceRollRequest] = useState<DiceRollRequest | undefined>();
  
  // Estado para o Detalhe da Magia e Animação
  const [selectedSpell, setSelectedSpell] = useState<any>(null);
  const spellScaleAnim = useRef(new Animated.Value(0.85)).current;
  const spellFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (selectedSpell) {
      spellScaleAnim.setValue(0.9);
      spellFadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(spellFadeAnim, {
          toValue: 1,
          duration: 150, 
          useNativeDriver: true,
        }),
        Animated.spring(spellScaleAnim, {
          toValue: 1,
          friction: 7, 
          tension: 60,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [selectedSpell]);

  const showCustomAlert = (title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string}[]) => {
    setCustomAlert({ visible: true, title, message, buttons: buttons || [{ text: 'OK', color: appColors.primary }] });
  };

  useFocusEffect(
    useCallback(() => {
    async function loadData() {
      if (!id) return;
      try {
        const result = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        const catalog = await db.getAllAsync(`SELECT * FROM items ORDER BY name ASC`);
        const skillsList = await db.getAllAsync(`SELECT * FROM skills ORDER BY name ASC`);
        const savesList = await db.getAllAsync(`SELECT * FROM saving_throws ORDER BY name ASC`);
        
        setDbItemsCatalog(catalog);
        setDbSkills(skillsList);
        setDbSaves(savesList);

        if (result) {
          let parsedEquip = JSON.parse((result as any).equipment || '{}');
          if (Array.isArray(parsedEquip)) {
             parsedEquip = { bag: parsedEquip, slots: { ...DEFAULT_SLOTS } };
          } else {
             parsedEquip.slots = { ...DEFAULT_SLOTS, ...(parsedEquip.slots || {}) };
          }

          let loadedSaves = JSON.parse((result as any).save_values || '[]');
          let loadedSkills = JSON.parse((result as any).skill_values || '[]');
          const backupProfs = JSON.parse((result as any).proficiencies || '[]');

          if (!Array.isArray(loadedSaves) || (loadedSaves.length > 0 && typeof loadedSaves[0] !== 'string')) {
              loadedSaves = backupProfs.filter((p: string) => p.startsWith('save_'));
          }
          if (!Array.isArray(loadedSkills) || (loadedSkills.length > 0 && typeof loadedSkills[0] !== 'string')) {
              loadedSkills = backupProfs.filter((p: string) => p.startsWith('skill_'));
          }

          const parsedStats = JSON.parse((result as any).stats || '{}');
          if(!parsedStats.temp_mods) parsedStats.temp_mods = {};
          if(!parsedStats.equip_mods) parsedStats.equip_mods = {};

          const charData: any = {
            ...(result as any),
            stats: parsedStats,
            save_values: loadedSaves,
            skill_values: loadedSkills,
            equipment: parsedEquip,
            spells: JSON.parse((result as any).spells || '[]'),
          };
          setCharacter(charData);

          const raceData = await db.getFirstAsync<{speed: string}>(`SELECT speed FROM races WHERE name = ?`, [charData.race]);
          if (raceData) setCharRaceSpeed(raceData.speed);

          const casterClasses = await db.getAllAsync<{name: string}>(`SELECT name FROM classes WHERE is_caster = 1`);
          const hasSpells = casterClasses.some(c => charData.class.includes(c.name));
          setCharHasSpells(true);

          if (charData.spells.length > 0) {
            const placeholders = charData.spells.map(() => '?').join(',');
            const spellsFull = await db.getAllAsync(`SELECT * FROM spells WHERE id IN (${placeholders})`, charData.spells.map((s: string) => Number(s)));
            setSpellDetails(spellsFull);
          }
        }
      } catch (error) { console.error(error); } finally { setLoading(false); }
    }
      loadData();
    }, [id])
  );

  const getSelfLanKey = (sessionValue?: string) => {
    if (!character || !sessionValue) return '';
    return makeLanCharacterKey(sessionValue, character);
  };

  const makeTradeItem = (item: any, qty: number): LanTradeItem => ({
    name: String(item.name || 'Item'),
    qty: Math.max(1, Math.min(Number(item.qty) || 1, qty)),
    weight: Number(item.weight) || 0,
    damage: item.damage,
    damage_type: item.damage_type,
    properties: item.properties,
  });

  const updateCharacterEquipmentOnly = async (equipment: any) => {
    if (!character) return false;
    try {
      await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [JSON.stringify(equipment), character.id]);
      setCharacter((prev: any) => ({ ...prev, equipment }));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  const addTradeItemToBag = async (tradeItem?: LanTradeItem) => {
    if (!character || !tradeItem) return false;
    const nextBag = [...character.equipment.bag];
    const existingIndex = nextBag.findIndex((item: any) => item.name === tradeItem.name);
    if (existingIndex >= 0) {
      nextBag[existingIndex].qty = (Number(nextBag[existingIndex].qty) || 0) + tradeItem.qty;
    } else {
      nextBag.push({ ...tradeItem });
    }
    return updateCharacterEquipmentOnly({ ...character.equipment, bag: nextBag });
  };

  const removeTradeItemFromBagByIndex = async (index: number, qty: number) => {
    if (!character) return false;
    const nextBag = [...character.equipment.bag];
    const item = nextBag[index];
    if (!item || (Number(item.qty) || 0) < qty) return false;
    nextBag[index] = { ...item, qty: (Number(item.qty) || 0) - qty };
    const cleanBag = nextBag.filter((entry: any) => (Number(entry.qty) || 0) > 0);
    return updateCharacterEquipmentOnly({ ...character.equipment, bag: cleanBag });
  };

  const removeTradeItemFromBagByName = async (tradeItem?: LanTradeItem) => {
    if (!character || !tradeItem) return false;
    const index = character.equipment.bag.findIndex((item: any) => item.name === tradeItem.name);
    if (index < 0) return false;
    return removeTradeItemFromBagByIndex(index, tradeItem.qty);
  };

  const applySpellHpToSelf = async (amount: number) => {
    if (!character) return;
    const nextHp = Math.max(0, Math.min(character.hp_max, Number(character.hp_current || 0) + amount));
    await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [nextHp, character.id]);
    setCharacter((prev: any) => ({ ...prev, hp_current: nextHp }));
    notifyOwnLanStatus(nextHp, character.hp_max);
  };

  const applySpellEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.spellEffect) return;
    const target = event.spellEffect.target || 'custom';
    const value = Number(event.spellEffect.value || 0);

    if (target === 'custom' || value === 0) {
      showCustomAlert('Efeito recebido', `${event.fromName} aplicou ${event.spellEffect.spellName}.`);
      return;
    }

    if (target === 'PV_TEMP') {
      showCustomAlert('PV temporario', `${event.fromName} aplicou ${event.spellEffect.spellName}: +${Math.max(0, value)} PV temporarios registrados na mesa.`);
      return;
    }

    const newStats = { ...character.stats, temp_mods: { ...(character.stats.temp_mods || {}) } };
    newStats.temp_mods[target] = (parseInt(newStats.temp_mods[target]) || 0) + value;
    await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [JSON.stringify(newStats), character.id]);
    setCharacter((prev: any) => ({ ...prev, stats: newStats }));
    showCustomAlert('Efeito recebido', `${event.fromName} aplicou ${event.spellEffect.spellName}: ${target} ${value > 0 ? '+' : ''}${value}.`);
  };

  const applyExpiredEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.expiredEffect) return;
    const effect = event.expiredEffect;
    const target = effect.target;

    if (['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(target)) {
      const newStats = { ...character.stats, temp_mods: { ...(character.stats.temp_mods || {}) } };
      const nextValue = (parseInt(newStats.temp_mods[target]) || 0) - Number(effect.value || 0);
      if (nextValue === 0) delete newStats.temp_mods[target];
      else newStats.temp_mods[target] = nextValue;
      await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [JSON.stringify(newStats), character.id]);
      setCharacter((prev: any) => ({ ...prev, stats: newStats }));
    }

    showCustomAlert('Efeito encerrado', event.message || `${effect.name} acabou.`);
  };

  const handleLanEvents = async (events: LanSessionEvent[], sessionValue: string) => {
    if (!character) return;
    const selfKey = getSelfLanKey(sessionValue);
    const isForMe = (event: LanSessionEvent) => event.toKey === selfKey || event.toName === character.name;
    const responses = new Set(events.filter((event) => ['trade_accept', 'trade_decline'].includes(event.type)).map((event) => event.tradeId));
    const pendingOffers = events.filter((event) => event.type === 'trade_offer' && isForMe(event) && !responses.has(event.id));

    setIncomingTrades(pendingOffers);

    for (const event of events) {
      if (event.type === 'public_status' && event.publicState) {
        setLanPlayers((current) => current.map((player) => (
          player.key === event.fromKey || player.characterName === event.fromName
            ? { ...player, hpCurrent: event.publicState!.hpCurrent, hpMax: event.publicState!.hpMax, tempHp: event.publicState!.tempHp || player.tempHp, level: event.publicState!.level }
            : player
        )));
        continue;
      }

      if (!isForMe(event)) continue;

      if (event.type === 'send_item') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          await addTradeItemToBag(event.item);
          showCustomAlert('Item recebido', `${event.fromName} enviou ${event.item?.qty || 1}x ${event.item?.name || 'item'}.`);
        }
      }

      if (event.type === 'trade_accept') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          const removed = await removeTradeItemFromBagByName(event.offeredItem);
          if (removed) await addTradeItemToBag(event.requestedItem);
          showCustomAlert('Troca aceita', `${event.fromName} aceitou a troca.`);
        }
      }

      if (event.type === 'trade_decline') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) showCustomAlert('Troca recusada', `${event.fromName} recusou a troca.`);
      }

      if (event.type === 'spell_hp' && event.spellEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          await applySpellHpToSelf(Number(event.spellEffect.amount || 0));
          const modeText = event.spellEffect.mode === 'heal' ? 'curou' : 'causou dano em';
          showCustomAlert('Magia recebida', `${event.fromName} usou ${event.spellEffect.spellName} e ${modeText} ${Math.abs(Number(event.spellEffect.amount || 0))} PV.`);
        }
      }

      if (event.type === 'spell_effect' && event.spellEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) await applySpellEffectToSelf(event);
      }

      if (event.type === 'effect_expired' && event.expiredEffect) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) await applyExpiredEffectToSelf(event);
      }
    }
  };

  useEffect(() => {
    if (!character) return;
    let active = true;

    const refreshLan = async () => {
      const storedInfo = routeSessionId
        ? { sessionId: routeSessionId, joinUrl: routeJoinUrl || '' }
        : await getLocalLanSessionForCharacter(db, Number(character.id));

      if (!storedInfo?.sessionId) return;

      const nextInfo = {
        sessionId: storedInfo.sessionId,
        joinUrl: decodeParam(storedInfo.joinUrl || ''),
      };
      if (active) setLanInfo(nextInfo);

      let nextPayload: LanSessionPayload | null = null;
      if (nextInfo.joinUrl) {
        try {
          nextPayload = await fetchLanSessionPayload(nextInfo.joinUrl);
        } catch {
          nextPayload = null;
        }
      } else if ((storedInfo as any).payloadJson) {
        try {
          nextPayload = JSON.parse((storedInfo as any).payloadJson);
        } catch {
          nextPayload = null;
        }
      }

      if (nextPayload && active) {
        const selfKey = makeLanCharacterKey(nextInfo.sessionId, character);
        const changedBySession = await applyLanSessionStateToCharacter(db, nextPayload, Number(character.id));
        if (changedBySession) {
          const updated = await db.getFirstAsync<Record<string, unknown>>(`SELECT hp_current, hp_max, xp, gp, sp, cp, stats, equipment FROM characters WHERE id = ?`, [Number(character.id)]);
          if (updated && active) {
            setCharacter((prev: any) => ({
              ...prev,
              hp_current: updated.hp_current,
              hp_max: updated.hp_max,
              xp: updated.xp,
              gp: updated.gp,
              sp: updated.sp,
              cp: updated.cp,
              stats: JSON.parse(String(updated.stats || '{}')),
              equipment: JSON.parse(String(updated.equipment || '{}')),
            }));
          }
        }
        setLanPlayers(getPublicLanPlayers(nextPayload, selfKey));
        if (nextPayload.events?.length) {
          await handleLanEvents(nextPayload.events.filter((event) => event.sessionId === nextInfo.sessionId), nextInfo.sessionId);
        }
      }

      if (nextInfo.joinUrl) {
        try {
          const events = await fetchLanSessionEvents(nextInfo.joinUrl, nextInfo.sessionId);
          if (active) await handleLanEvents(events.filter((event) => event.sessionId === nextInfo.sessionId), nextInfo.sessionId);
        } catch {
          // A mesa pode estar pausada/offline; a ficha continua utilizavel localmente.
        }
      }
    };

    refreshLan();
    const timer = setInterval(refreshLan, 3500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [character, routeSessionId, routeJoinUrl]);

  // Se estiver carregando ou sem personagem, encerra o render aqui
  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={appColors.primary} /></View>;
  if (!character) return <View style={styles.loadingContainer}><Text style={styles.errorText}>Erro ao carregar o personagem.</Text></View>;

  // ==============================================================================
  // 1. CÁLCULO DE VARIÁVEIS DERIVADAS (STATUS, HP, XP, CA) ANTES DAS FUNÇÕES
  // ==============================================================================

  const getMod = (val: string) => Math.floor(((parseInt(val) || 10) - 10) / 2);
  
  const forBase = parseInt(character.stats.FOR) || 10;
  const forTemp = parseInt(character.stats.temp_mods?.FOR) || 0;
  const forEquip = parseInt(character.stats.equip_mods?.FOR) || 0;
  const forMod = Math.floor(((forBase + forTemp + forEquip) - 10) / 2);

  const desBase = parseInt(character.stats.DES) || 10;
  const desTemp = parseInt(character.stats.temp_mods?.DES) || 0;
  const desEquip = parseInt(character.stats.equip_mods?.DES) || 0;
  const desMod = Math.floor(((desBase + desTemp + desEquip) - 10) / 2);
  
  const conBase = parseInt(character.stats.CON) || 10;
  const conTemp = parseInt(character.stats.temp_mods?.CON) || 0;
  const conEquip = parseInt(character.stats.equip_mods?.CON) || 0;
  const conModBase = Math.floor((conBase - 10) / 2);
  const conModTotal = Math.floor(((conBase + conTemp + conEquip) - 10) / 2);
  
  const profBonusChar = Math.ceil(character.level / 4) + 1; 
  
  const hpBonusFromCon = (conModTotal - conModBase) * (character.level || 1);
  const displayHpMax = Math.max(1, character.hp_max + hpBonusFromCon);
  const displayHpCurrent = Math.max(0, character.hp_current + hpBonusFromCon);

  const bagWeight = character.equipment.bag.reduce((acc: number, item: any) => acc + (item.weight * item.qty), 0);
  const slotsWeight = Object.values(character.equipment.slots).reduce((acc: number, item: any) => acc + (item ? item.weight : 0), 0);
  const totalWeight = bagWeight + slotsWeight + ((character.gp + character.sp + character.cp) * 0.01);
  const carryCap = (forBase + forTemp + forEquip) * 7.5;

  let baseCa = 10;
  let addDes = true;
  if (character.equipment.slots.armor) {
    const props = character.equipment.slots.armor.properties || '';
    const match = props.match(/CA\s*(\d+)/i);
    if (match) baseCa = parseInt(match[1]);
    if (props.includes('CA 16') || props.includes('Armadura Completa') || props.includes('Pesada')) addDes = false; 
  }
  const caTemp = parseInt(character.stats.temp_mods?.CA) || 0;
  const caEquip = parseInt(character.stats.equip_mods?.CA) || 0;
  const armorClassTotal = baseCa + (addDes ? desMod : 0) + caTemp + caEquip;
  const caSumBuffs = caTemp + caEquip;
  const caColor = caSumBuffs > 0 ? appColors.success : (caSumBuffs < 0 ? appColors.danger : appColors.textPrimary);

  let expectedLevel = 1;
  for (let i = XP_TABLE.length - 1; i >= 0; i--) { 
    if (character.xp >= XP_TABLE[i]) { expectedLevel = i + 1; break; } 
  }
  const isPendingLevelUp = expectedLevel > character.level;

  const checkProficiency = (idx: string, group: any[]) => group.includes(idx);
  const proficientSaves = dbSaves.filter((save: any) => checkProficiency(save.id, character.save_values));
  const proficientSkills = dbSkills.filter((skill: any) => checkProficiency(skill.id, character.skill_values));


  // ==============================================================================
  // 2. FUNÇÕES DE AÇÃO QUE UTILIZAM AS VARIÁVEIS ACIMA
  // ==============================================================================

  const updateDB = async (updates: Partial<any>) => {
    try {
      const entries = Object.entries(updates);
      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => ({ ...prev, ...updates }));
    } catch (e) { console.error(e); }
  };

  const handleXP = (action: 'add' | 'remove') => {
    const amount = parseInt(inputValue) || 0;
    let newXp = Math.max(0, action === 'add' ? character.xp + amount : character.xp - amount);
    
    let calcNewLevel = 1;
    for (let i = XP_TABLE.length - 1; i >= 0; i--) { 
      if (newXp >= XP_TABLE[i]) { calcNewLevel = i + 1; break; } 
    }

    if (calcNewLevel > character.level && action === 'add') {
      setNewLevelData(calcNewLevel);
      setLevelUpModalVisible(true); 
    }
    
    updateDB({ xp: newXp });
    setXpModalVisible(false); 
    setInputValue('');
  };

  const handleHP = (action: 'damage' | 'heal') => {
    const amount = parseInt(inputValue) || 0;
    
    let newDisplayCurrent = action === 'damage' 
      ? Math.max(0, displayHpCurrent - amount) 
      : Math.min(displayHpMax, displayHpCurrent + amount);
      
    let newDbCurrent = newDisplayCurrent - hpBonusFromCon;
    
    updateDB({ hp_current: newDbCurrent });
    notifyOwnLanStatus(newDbCurrent, character.hp_max);
    setHpModalVisible(false); 
    setInputValue('');
  };

  const handleTempBuffSubmit = () => {
    let newStats = { ...character.stats };
    const val = parseInt(tempBuffValue) || 0;
    if (val === 0) delete newStats.temp_mods[activeBuffStat];
    else newStats.temp_mods[activeBuffStat] = val;
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const clearTempBuff = () => {
    let newStats = { ...character.stats };
    delete newStats.temp_mods[activeBuffStat];
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const goToEditScreen = () => {
    setLevelUpModalVisible(false);
    router.push(`/edit?id=${character.id}&levelUpTo=${newLevelData}`);
  };

  const handleCoinSubmit = () => {
    updateDB({ [activeCoinType]: Math.max(0, parseInt(inputValue) || 0) });
    setCoinModalVisible(false); setInputValue('');
  };

  const updateCoins = (type: 'gp' | 'sp' | 'cp', delta: number) => updateDB({ [type]: Math.max(0, character[type] + delta) });

  const executeCoinConversion = (sourceAmount: number, targetAmount: number) => {
    updateDB({
      [convertFrom]: character[convertFrom] - sourceAmount,
      [convertTo]: character[convertTo] + targetAmount
    });
    setConvertModalVisible(false);
    setConvertAmount('');
    showCustomAlert("Câmbio Realizado", `Você converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`);
  };

  const updateBagQty = (index: number, delta: number) => {
    let newBag = [...character.equipment.bag];
    newBag[index].qty += delta;
    if (newBag[index].qty <= 0) newBag = newBag.filter((_, i) => i !== index);
    updateDB({ equipment: { ...character.equipment, bag: newBag } });
  };

  const addItemToBag = (item: any) => {
    let newBag = [...character.equipment.bag];
    const existingIndex = newBag.findIndex((i: any) => i.name === item.name);
    if (existingIndex > -1) newBag[existingIndex].qty += 1;
    else newBag.push({ name: item.name, qty: 1, weight: item.weight, damage: item.damage, damage_type: item.damage_type, properties: item.properties });
    updateDB({ equipment: { ...character.equipment, bag: newBag } });
    setItemModalVisible(false); setItemSearch('');
  };

  const handleSendItemToPlayer = async (target: PublicLanPlayer) => {
    if (!selectedBagItem || !lanInfo || !character) return;
    const tradeItem = makeTradeItem(selectedBagItem.item, actionQty);
    const removed = await removeTradeItemFromBagByIndex(selectedBagItem.index, tradeItem.qty);
    if (!removed) {
      showCustomAlert('Envio cancelado', 'Voce nao tem quantidade suficiente deste item.');
      return;
    }

    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'send_item',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: target.key,
        toName: target.characterName,
        item: tradeItem,
        createdAt: new Date().toISOString(),
      });
      showCustomAlert('Item enviado', `${tradeItem.qty}x ${tradeItem.name} foi enviado para ${target.characterName}.`);
    } catch {
      await addTradeItemToBag(tradeItem);
      showCustomAlert('Envio falhou', 'Nao consegui avisar a sessao LAN. O item voltou para sua mochila.');
    } finally {
      setTargetPickerMode(null);
      setSelectedBagItem(null);
    }
  };

  const handleOfferTradeToPlayer = async (target: PublicLanPlayer) => {
    if (!selectedBagItem || !lanInfo || !character) return;
    const offeredItem = makeTradeItem(selectedBagItem.item, actionQty);

    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'trade_offer',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: target.key,
        toName: target.characterName,
        offeredItem,
        createdAt: new Date().toISOString(),
      });
      showCustomAlert('Troca enviada', `${target.characterName} recebeu sua proposta de troca.`);
    } catch {
      showCustomAlert('Troca falhou', 'Nao consegui enviar a proposta para a sessao LAN.');
    } finally {
      setTargetPickerMode(null);
      setSelectedBagItem(null);
    }
  };

  const handleAcceptTrade = async () => {
    if (!selectedTradeOffer || !tradeCounterItem || !lanInfo || !character) return;
    const requestedItem = makeTradeItem(tradeCounterItem.item, tradeCounterQty);
    const removed = await removeTradeItemFromBagByIndex(tradeCounterItem.index, requestedItem.qty);
    if (!removed) {
      showCustomAlert('Troca cancelada', 'Voce nao tem quantidade suficiente do item escolhido.');
      return;
    }

    await addTradeItemToBag(selectedTradeOffer.offeredItem);

    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'trade_accept',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: selectedTradeOffer.fromKey,
        toName: selectedTradeOffer.fromName,
        tradeId: selectedTradeOffer.id,
        offeredItem: selectedTradeOffer.offeredItem,
        requestedItem,
        createdAt: new Date().toISOString(),
      });
      setIncomingTrades((current) => current.filter((event) => event.id !== selectedTradeOffer.id));
      setSelectedTradeOffer(null);
      setTradeCounterItem(null);
      showCustomAlert('Troca aceita', 'A troca foi confirmada.');
    } catch {
      await addTradeItemToBag(requestedItem);
      await removeTradeItemFromBagByName(selectedTradeOffer.offeredItem);
      showCustomAlert('Troca falhou', 'Nao consegui confirmar a troca na sessao LAN.');
    }
  };

  const handleDeclineTrade = async (event: LanSessionEvent) => {
    if (!lanInfo || !character) return;
    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'trade_decline',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: event.fromKey,
        toName: event.fromName,
        tradeId: event.id,
        offeredItem: event.offeredItem,
        createdAt: new Date().toISOString(),
      });
      setIncomingTrades((current) => current.filter((entry) => entry.id !== event.id));
      if (selectedTradeOffer?.id === event.id) setSelectedTradeOffer(null);
    } catch {
      showCustomAlert('Resposta falhou', 'Nao consegui recusar a troca na sessao LAN.');
    }
  };

  const notifyOwnLanStatus = async (hpCurrent: number, hpMax: number) => {
    if (!lanInfo?.joinUrl || !character) return;
    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'public_status',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: 'session',
        toName: 'session',
        publicState: {
          hpCurrent,
          hpMax,
          level: character.level,
        },
        createdAt: new Date().toISOString(),
      });
    } catch {
      // A mudanca local de HP continua valida mesmo se a mesa estiver temporariamente offline.
    }
  };

  const getSpellCastMode = (spell: any): 'heal' | 'damage' | 'effect' => {
    const text = `${spell.damage_dice || ''} ${spell.damage || ''} ${spell.damage_type || ''} ${spell.description || ''}`.toLowerCase();
    if ((text.includes('tempor') || text.includes('temp')) && (text.includes('pv') || text.includes('hp') || text.includes('vida'))) return 'effect';
    if (text.includes('cura') || text.includes('curar') || text.includes('recupera')) return 'heal';
    if ((spell.damage_dice && spell.damage_dice !== '-') || (spell.damage && spell.damage !== '-')) return 'damage';
    return 'effect';
  };

  const getSpellDiceText = (spell: any) => {
    const raw = String(spell.damage_dice || spell.damage || '');
    if (!raw || raw === '-') return '';
    return raw.replace(/cura/gi, '').trim();
  };

  const startSpellCast = (spell: any) => {
    const selfKey = lanInfo ? getSelfLanKey(lanInfo.sessionId) : '';
    const defaultKeys = selfKey ? [selfKey] : [];
    setSpellTargetKeys(defaultKeys);
    setSpellTargetAmounts(defaultKeys.reduce((acc, key) => ({ ...acc, [key]: '' }), {}));
    setSpellRollResult('');
    setSpellEffectTarget('custom');
    setSpellEffectValue('0');
    setSpellCastVisible(true);
  };

  const toggleSpellTarget = (key: string) => {
    setSpellTargetKeys((current) => {
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
      setSpellTargetAmounts((amounts) => {
        const copy = { ...amounts };
        if (!copy[key]) copy[key] = '';
        return copy;
      });
      return next;
    });
  };

  const rollSpellForTargets = () => {
    if (!selectedSpell) return;
    const diceParts = getDiceParts(getSpellDiceText(selectedSpell));
    if (diceParts[0]) {
      setDiceRollRequest({ ...diceParts[0], nonce: Date.now() });
    }
    const result = rollDiceExpression(getSpellDiceText(selectedSpell));
    if (!result) {
      showCustomAlert('Rolagem indisponivel', 'Nao encontrei uma formula de dado nesta magia. Informe o valor manualmente.');
      return;
    }

    setSpellRollResult(`${result.total} (${result.breakdown})`);
    setSpellTargetAmounts((current) => {
      const next = { ...current };
      for (const key of spellTargetKeys) next[key] = String(result.total);
      return next;
    });
  };

  const sendSpellEventToTarget = async (target: PublicLanPlayer, amount: number) => {
    if (!lanInfo || !character || !selectedSpell) return;
    const mode = getSpellCastMode(selectedSpell);
    const event: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId: lanInfo.sessionId,
      type: mode === 'effect' ? 'spell_effect' : 'spell_hp',
      fromKey: getSelfLanKey(lanInfo.sessionId),
      fromName: character.name,
      toKey: target.key,
      toName: target.characterName,
      spellEffect: mode === 'effect'
        ? {
          spellName: selectedSpell.name,
          mode,
          target: spellEffectTarget,
          value: parseInt(spellEffectValue) || 0,
          durationText: selectedSpell.duration || 'Instantanea',
          ...parseSpellDuration(selectedSpell.duration),
          description: selectedSpell.description,
        }
        : {
          spellName: selectedSpell.name,
          mode,
          amount: mode === 'heal' ? Math.abs(amount) : -Math.abs(amount),
          description: selectedSpell.description,
        },
      createdAt: new Date().toISOString(),
    };

    if (target.isSelf) {
      await rememberLanSessionEvent(db, event);
      if (event.type === 'spell_hp') await applySpellHpToSelf(Number(event.spellEffect?.amount || 0));
    }

    await sendLanSessionEvent(lanInfo.joinUrl, event);
  };

  const applySpellCast = async () => {
    if (!selectedSpell || !lanInfo) return;
    const targets = lanPlayers.filter((player) => spellTargetKeys.includes(player.key));
    if (targets.length === 0) {
      showCustomAlert('Sem alvo', 'Escolha pelo menos um personagem da party.');
      return;
    }

    try {
      for (const target of targets) {
        const value = parseInt(spellTargetAmounts[target.key]) || 0;
        if (getSpellCastMode(selectedSpell) !== 'effect' && value <= 0) continue;
        await sendSpellEventToTarget(target, value);
      }
      setSpellCastVisible(false);
      showCustomAlert('Magia aplicada', `${selectedSpell.name} foi enviada para ${targets.length} alvo(s).`);
    } catch {
      showCustomAlert('Magia falhou', 'Nao consegui sincronizar a magia na sessao LAN.');
    }
  };

  const processConsumeItem = (bagIndex: number, item: any, qty: number) => {
    const effect = item.damage && item.damage !== '-' ? item.damage : 'Efeito oculto';
    
    // Parse da tag "Escolher"
    const hasEscolher = effect.toLowerCase().includes('escolher');
    let escolherVal = 0;
    let escolherIsPerm = false;
    
    if (hasEscolher) {
      const escolherMatch = effect.match(/escolher\s*([+-]?\d+)/i);
      escolherVal = escolherMatch ? parseInt(escolherMatch[1]) : 1;
      escolherIsPerm = effect.toLowerCase().includes('perm');
    }

    // Função interna que processa TUDO: O status escolhido (se tiver), as penalidades e curas.
    const executeConsumption = (chosenAttr?: string) => {
      updateBagQty(bagIndex, -qty);

      let newStats = { ...character.stats };
      let msgParts = [];
      let showHpModal = false;
      let dbUpdates: any = {};

      // 1. Aplica o Atributo Escolhido (caso exista)
      if (chosenAttr) {
        const totalVal = escolherVal * qty;
        if (escolherIsPerm) {
          newStats[chosenAttr] = String((parseInt(newStats[chosenAttr]) || 10) + totalVal);
          newStats.extra_points = (parseInt(newStats.extra_points) || 0) + totalVal;
          msgParts.push(`✨ Escolha: ${totalVal > 0 ? '+'+totalVal : totalVal} em ${chosenAttr} (Permanente)`);
        } else {
          if(!newStats.temp_mods) newStats.temp_mods = {};
          newStats.temp_mods[chosenAttr] = (parseInt(newStats.temp_mods[chosenAttr]) || 0) + totalVal;
          msgParts.push(`⏳ Escolha: ${totalVal > 0 ? '+'+totalVal : totalVal} em ${chosenAttr} (Temporário)`);
        }
      }

      // 2. Aplica as outras propriedades fixas na string (ex: CAR -2)
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)\s*(\(?(Perm|Temp).*)?/gi;
      const statMatches = [...effect.matchAll(statRegex)];

      if (statMatches.length > 0) {
        for (const match of statMatches) {
          const attr = match[1].toUpperCase();
          const val = parseInt(match[2].replace('+', '')) * qty;
          const isPerm = match[3] && match[3].toLowerCase().includes('perm');
          
          if (isPerm) {
              if (attr !== 'CA') { 
                  newStats[attr] = String((parseInt(newStats[attr]) || 10) + val);
                  newStats.extra_points = (parseInt(newStats.extra_points) || 0) + val;
              }
              msgParts.push(`💪 Permanente: ${val > 0 ? '+'+val : val} em ${attr}`);
          } else {
              if(!newStats.temp_mods) newStats.temp_mods = {};
              newStats.temp_mods[attr] = (parseInt(newStats.temp_mods[attr]) || 0) + val;
              msgParts.push(`⏳ Temporário: ${val > 0 ? '+'+val : val} em ${attr}`);
          }
        }
      }

      // 3. Aplica curas diretas
      const effectStr = effect.toLowerCase();
      if (effectStr.includes('cura') || effectStr.includes('hp') || (item.damage_type || '').toLowerCase().includes('cura')) {
        const temDado = /d\d+/i.test(effect);
        if (!temDado) {
          const matchFixo = effect.match(/cura\s*([+-]?\d+)/i) || effect.match(/([+-]?\d+)\s*cura/i);
          if (matchFixo) {
            const curaValor = parseInt(matchFixo[1]) * qty;
            if(!isNaN(curaValor)) {
               const novoHp = Math.min(character.hp_max, character.hp_current + Math.abs(curaValor));
               dbUpdates.hp_current = novoHp;
               msgParts.push(`💖 Recuperou ${Math.abs(curaValor)} Pontos de Vida.`);
            }
          } else {
            const genericNumMatch = effect.match(/\d+/);
            if (genericNumMatch && !chosenAttr && statMatches.length === 0) {
               const curaValor = parseInt(genericNumMatch[0]) * qty;
               const novoHp = Math.min(character.hp_max, character.hp_current + Math.abs(curaValor));
               dbUpdates.hp_current = novoHp;
               msgParts.push(`💖 Recuperou ${Math.abs(curaValor)} Pontos de Vida.`);
            }
          }
        } else {
          showHpModal = true;
          msgParts.push(`🎲 Requer Rolagem de Cura:\n${qty}x (${effect})`);
        }
      }

      if (msgParts.length === 0 && !chosenAttr) msgParts.push(`✨ Efeito da ingestão: ${effect}`);

      dbUpdates.stats = newStats;
      if (Object.keys(dbUpdates).length > 0) updateDB(dbUpdates);

      setTimeout(() => {
        showCustomAlert(
          "Efeito Aplicado!", 
          msgParts.join('\n\n'), 
          showHpModal 
            ? [ { text: 'OK', color: '#fff' }, { text: 'Ir para HP', color: '#00fa9a', onPress: () => setHpModalVisible(true) } ] 
            : [{ text: 'OK', color: '#00bfff' }]
        );
      }, 400);
    };

    // Caso possua ESCOLHER, mostramos os botões e passamos o status para executeConsumption.
    if (hasEscolher) {
      const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
        text: attr,
        color: escolherVal > 0 ? '#00fa9a' : '#ff6666',
        onPress: () => executeConsumption(attr)
      }));

      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        `Este item afeta um atributo de sua escolha. Os outros efeitos (se houver) também serão ativados.\n\nQual atributo deseja alterar?`,
        [
          
          ...attrButtons
        ]
      );
    } 
    else {
      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        `Você tem certeza que deseja ingerir este item? Seus efeitos serão ativados em seu corpo...`,
        [
          { text: "Recusar", color: "#666" },
          { 
            text: "Beber / Comer", 
            color: "#00fa9a",
            onPress: () => executeConsumption()
          }
        ]
      );
    }
  };

  const processThrowItem = (bagIndex: number, item: any, qty: number) => {
    const isThrowableWeapon = item.properties && item.properties.includes('Arremesso');
    
    const itemWeight = parseFloat(item.weight) || 0;
    const totalWeightThrown = itemWeight * qty;
    const weightLimit = forBase * 1.5;

    if (!isThrowableWeapon && totalWeightThrown > weightLimit) {
      showCustomAlert("Muito Pesado!", `Arremessar ${qty}x pesa ${totalWeightThrown}kg. Sua Força (${forBase}) não permite arremessar esse peso todo de uma vez como arma.`);
      return;
    }

    let atkBonus = 0;
    let dmgRoll = '';
    let dmgType = '';
    let rangeText = '';

    if (isThrowableWeapon) {
      const isFinesse = item.properties.includes('Acuidade');
      const activeMod = isFinesse ? Math.max(forMod, desMod) : forMod;
      atkBonus = activeMod + profBonusChar;
      dmgRoll = `${item.damage || '1d4'} ${activeMod !== 0 ? (activeMod > 0 ? `+${activeMod}` : activeMod) : ''}`;
      dmgType = item.damage_type || 'Arma';
      rangeText = 'Alcance da Arma (Ex: 6/18m)';
    } else {
      atkBonus = forMod; 
      dmgRoll = `1d4 ${forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}`;
      dmgType = 'Concussão (Improvisada)';
      rangeText = 'Alcance Curto: 6m / Longo: 18m';
    }

    showCustomAlert(
      `Arremessar: ${qty}x ${item.name}`,
      `📍 ${rangeText}\n🎯 Acerto (D20): ${atkBonus >= 0 ? `+${atkBonus}` : atkBonus}\n⚔️ Dano (cada): ${dmgRoll} [${dmgType}]\n\n⚠️ Você fará ${qty} ataque(s) separado(s). O(s) item(ns) será(ão) consumido(s).`,
      [
        { text: "Cancelar", color: "#666" },
        { 
          text: "Arremessar!", 
          color: "#ff6666",
          onPress: () => {
            updateBagQty(bagIndex, -qty);
            setTimeout(() => showCustomAlert("Fóooosh!", `Você atirou ${qty}x ${item.name} com sucesso. Role seus dados de Acerto e Dano!`), 400);
          }
        }
      ]
    );
  };

  const getEquipBonus = (item: any) => {
    if (!item) return {};
    const effect = item.damage || '';
    const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)(?!\s*\(?(Perm|Temp))/gi; 
    const matches = [...effect.matchAll(statRegex)];
    let bonuses: Record<string, number> = {};
    matches.forEach(match => {
      const attr = match[1].toUpperCase();
      const val = parseInt(match[2].replace('+', ''));
      if (!effect.toLowerCase().includes('perm') && !effect.toLowerCase().includes('temp')) {
          bonuses[attr] = val;
      }
    });
    return bonuses;
  };

  const handleEquipItem = (itemToEquip: any) => {
    if (!activeSlot) return;
    let newBag = [...character.equipment.bag];
    let newSlots = { ...character.equipment.slots };
    let newStats = { ...character.stats };
    if(!newStats.equip_mods) newStats.equip_mods = {};

    const oldItem = newSlots[activeSlot];
    if (oldItem) {
      const oldBonuses = getEquipBonus(oldItem);
      for (const [stat, val] of Object.entries(oldBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
        if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
      }
    }

    if (itemToEquip) {
      const props = itemToEquip.properties || '';
      if (activeSlot === 'mainHand' && props.includes('Duas mãos')) {
        if (newSlots.offHand) {
          const offIdx = newBag.findIndex((i: any) => i.name === newSlots.offHand.name);
          if (offIdx > -1) newBag[offIdx].qty += 1;
          else newBag.push({ ...newSlots.offHand, qty: 1 });
          
          const offBonuses = getEquipBonus(newSlots.offHand);
          for (const [stat, val] of Object.entries(offBonuses)) {
            newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
            if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
          }

          newSlots.offHand = null;
          showCustomAlert("Aviso de Sistema", "Sua mão secundária foi desequipada. Esta arma requer as duas mãos livres.");
        }
      }
      if (activeSlot === 'offHand') {
        const mainProps = newSlots.mainHand?.properties || '';
        if (mainProps.includes('Duas mãos')) {
          showCustomAlert("Ação Bloqueada", "Sua arma principal ocupa as duas mãos. Desequipe-a primeiro se quiser usar outra coisa.");
          return;
        }
      }
    }

    if (oldItem) {
      const existingIdx = newBag.findIndex((i: any) => i.name === oldItem.name);
      if (existingIdx > -1) newBag[existingIdx].qty += 1;
      else newBag.push({ ...oldItem, qty: 1 });
    }

    if (itemToEquip) {
      const bagIdx = newBag.findIndex((i: any) => i.name === itemToEquip.name);
      if (bagIdx > -1) {
        newBag[bagIdx].qty -= 1;
        if (newBag[bagIdx].qty <= 0) newBag.splice(bagIdx, 1);
      }
      newSlots[activeSlot] = { ...itemToEquip, qty: 1 };

      const newBonuses = getEquipBonus(itemToEquip);
      for (const [stat, val] of Object.entries(newBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) + (val as number);
      }
    } else {
      newSlots[activeSlot] = null;
    }

    updateDB({ equipment: { bag: newBag, slots: newSlots }, stats: newStats });
    setSlotModalVisible(false);
  };

  const getFilteredAndSortedSpells = () => {
    let filtered = spellDetails.filter(spell => {
      if (spellSearch && !spell.name.toLowerCase().includes(spellSearch.toLowerCase())) return false;
      
      const sCat = getCategory(spell);
      
      if (spellLevelFilter !== 'Todos') {
        if (spellLevelFilter === 'Passiva') {
          if (sCat !== 'Passiva') return false;
        } else if (spellLevelFilter === 'Habilidade') {
          if (sCat !== 'Habilidade') return false;
        } else {
          if (spell.level !== spellLevelFilter) return false;
        }
      }
      
      if (spellEffectFilter !== 'Todos') {
        const dmgText = (spell.damage_dice || spell.damage || '').toLowerCase();
        const typeText = (spell.damage_type || '').toLowerCase();
        const isCura = dmgText.includes('cura') || dmgText.includes('hp') || typeText.includes('cura');
        const isSupport = (dmgText === '-' || !dmgText) && !isCura; 
        
        if (spellEffectFilter === 'Cura' && !isCura) return false;
        if (spellEffectFilter === 'Suporte/Defesa' && !isSupport) return false;
        if (spellEffectFilter === 'Dano' && (isCura || isSupport)) return false; 
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (spellSortOrder === 'A-Z') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });

    return filtered;
  };

  const getGroupedSpells = () => {
    const filtered = getFilteredAndSortedSpells();
    const groups: Record<string, any[]> = {};

    filtered.forEach(spell => {
      const cat = getCategory(spell);
      const lvl = spell.level || '';
      
      let groupName = '';
      if (cat === 'Passiva') {
          groupName = 'Passivas Inatas';
      } else if (cat === 'Habilidade') {
          groupName = 'Habilidades de Classe';
      } else if (lvl === 'Truque') {
          groupName = 'Truques (Nível 0)';
      } else {
          groupName = `Magias (${lvl})`; 
      }

      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(spell);
    });

    const order = [
      'Passivas Inatas', 
      'Habilidades de Classe', 
      'Truques (Nível 0)', 
      'Magias (Nível 1)', 'Magias (Nível 2)', 'Magias (Nível 3)', 'Magias (Nível 4)', 'Magias (Nível 5)', 
      'Magias (Nível 6)', 'Magias (Nível 7)', 'Magias (Nível 8)', 'Magias (Nível 9)'
    ];
    
    return Object.entries(groups).sort(([a], [b]) => {
      const indexA = order.indexOf(a);
      const indexB = order.indexOf(b);
      return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
    });
  };

  const getSpellIcon = (groupName: string) => {
      if (groupName.includes('Passiva')) return 'shield-checkmark';
      if (groupName.includes('Habilidade')) return 'fitness';
      if (groupName.includes('Truque')) return 'flash';
      return 'book'; 
  };


  // ==============================================================================
  // 3. COMPONENTES DE RENDERIZAÇÃO
  // ==============================================================================

  const renderLanPartyCard = () => {
    if (!lanInfo && lanPlayers.length === 0) return null;
    const otherPlayers = lanPlayers.filter((player) => !player.isSelf);

    return (
      <View style={styles.sessionPartyBox}>
        <View style={styles.sessionPartyHeader}>
          <View>
            <Text style={styles.sessionPartyTitle}>SESSAO LAN</Text>
            <Text style={styles.sessionPartyHint}>Jogadores veem apenas vida e nivel do grupo.</Text>
          </View>
          {incomingTrades.length > 0 && (
            <TouchableOpacity style={styles.pendingTradeButton} onPress={() => setSelectedTradeOffer(incomingTrades[0])}>
              <Text style={styles.pendingTradeText}>{incomingTrades.length} TROCA</Text>
            </TouchableOpacity>
          )}
        </View>

        {lanPlayers.length === 0 ? (
          <Text style={styles.emptyText}>Aguardando sincronizacao da mesa.</Text>
        ) : lanPlayers.map((player) => {
          const hpPercent = player.hpMax > 0 ? Math.max(0, Math.min(100, (player.hpCurrent / player.hpMax) * 100)) : 0;
          return (
            <View key={player.key} style={styles.sessionPlayerRow}>
              <View>
                <Text style={styles.sessionPlayerName}>{player.characterName}{player.isSelf ? ' (voce)' : ''}</Text>
                <Text style={styles.sessionPlayerMeta}>Nivel {player.level}{player.playerName ? ` - ${player.playerName}` : ''}</Text>
              </View>
              <View style={styles.sessionHpBox}>
                <Text style={styles.sessionHpText}>{player.hpCurrent}/{player.hpMax}{player.tempHp > 0 ? ` +${player.tempHp}` : ''}</Text>
                <View style={styles.sessionHpTrack}>
                  <View style={[styles.sessionHpFill, { width: `${hpPercent}%` }]} />
                </View>
              </View>
            </View>
          );
        })}

        {otherPlayers.length === 0 && <Text style={styles.sessionPartyHint}>Quando outro jogador entrar, ele aparece aqui para envio ou troca.</Text>}
      </View>
    );
  };

  const renderAttackCard = (item: any, slotKey: string, title: string) => {
    if (!item) {
      if (slotKey !== 'mainHand') return null;
      return (
        <View style={styles.atkCard}>
          <Text style={styles.combatLabel}>ATAQUE DESARMADO (Mão Livre)</Text>
          <View style={styles.atkRow}>
            <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{forMod + profBonusChar}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
            <View style={styles.atkSubBox}><Text style={[styles.atkVal, {color: '#00fa9a'}]}>1 {forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}</Text><Text style={styles.atkLab}>DANO (Concussão)</Text></View>
          </View>
        </View>
      );
    }

    const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
    let itemDamage = item.damage || dbItem?.damage;
    if (!itemDamage || itemDamage === '-') itemDamage = '1d4';
    
    let itemDamageType = item.damage_type || dbItem?.damage_type;
    if (!itemDamageType || itemDamageType === '-') itemDamageType = 'Concussão (Improvisada)';

    const props = item.properties || dbItem?.properties || '';
    const isRanged = props.includes('Munição') || props.includes('Arremesso') || slotKey === 'ranged';
    const isFinesse = props.includes('Acuidade');
    
    let activeMod = forMod;
    if (isRanged && !props.includes('Arremesso')) activeMod = desMod;
    else if (isFinesse) activeMod = Math.max(forMod, desMod);
    
    let dmgMod = activeMod;
    if (slotKey === 'offHand' && dmgMod > 0) dmgMod = 0; 

    return (
      <View style={styles.atkCard} key={slotKey}>
        <Text style={styles.combatLabel}>{title.toUpperCase()}: {item.name.toUpperCase()}</Text>
        <View style={styles.atkRow}>
          <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{activeMod + profBonusChar}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
          <View style={styles.atkSubBox}>
            <Text style={[styles.atkVal, {color: '#00fa9a'}]}>{itemDamage} {dmgMod !== 0 ? (dmgMod > 0 ? `+${dmgMod}` : dmgMod) : ''}</Text>
            <Text style={styles.atkLab}>DANO ({itemDamageType})</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEquipSlot = (slotKey: keyof typeof DEFAULT_SLOTS, label: string, icon: string) => {
    const item = character.equipment.slots[slotKey];
    const dbItem = item ? dbItemsCatalog.find(cat => cat.name === item.name) : null;
    
    const itemDamage = item?.damage || dbItem?.damage;
    const itemDamageType = item?.damage_type || dbItem?.damage_type;
    const itemProps = item?.properties || dbItem?.properties;

    let extraInfo = null;
    if (itemDamage && itemDamage !== '-') {
      extraInfo = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''}`;
    } else if (itemProps && itemProps !== '-') {
      extraInfo = `🛡️ ${itemProps.split(',')[0]}`; 
    }

    return (
      <TouchableOpacity style={[styles.equipSlotBox, item && styles.equipSlotBoxFilled]} onPress={() => { setActiveSlot(slotKey); setSlotModalVisible(true); }}>
        <Text style={styles.equipSlotLabel}>{label}</Text>
        {item ? (
          <>
            <Text style={styles.equipSlotItemName} numberOfLines={2} adjustsFontSizeToFit>{item.name}</Text>
            {extraInfo && (<Text style={styles.equipSlotItemDamage} numberOfLines={1} adjustsFontSizeToFit>{extraInfo}</Text>)}
          </>
        ) : (<Text style={styles.equipSlotEmptyIcon}>{icon}</Text>)}
      </TouchableOpacity>
    );
  };

  // ==============================================================================
  // 4. RETORNO PRINCIPAL DA TELA
  // ==============================================================================

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => router.back()}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContainer}>
          {['stats', 'profs', 'inv', 'spells'].map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t as any)}>
              <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>
                {t === 'stats' ? 'STATUS' : t === 'profs' ? 'PROFS' : t === 'inv' ? 'MOCHILA' : 'HABILIDADES'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderLanPartyCard()}
        
        {/* ABA STATUS */}
        {activeTab === 'stats' && (
          <>
            <View style={styles.headerBlock}>
              <Text style={styles.charClassRace}>{character.race} • {character.class}</Text>
              
              <View style={styles.levelXpRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>Nv. {character.level}</Text></View>
                
                <TouchableOpacity style={styles.badge} onPress={() => setXpModalVisible(true)}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {XP_TABLE[character.level] || 'MAX'}</Text>
                </TouchableOpacity>

                {isPendingLevelUp && (
                  <TouchableOpacity style={styles.levelUpIconBtn} onPress={() => {setNewLevelData(expectedLevel); setLevelUpModalVisible(true);}}>
                    <Ionicons name="arrow-up" size={24} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <TouchableOpacity style={[styles.hpBarStyle, hpBonusFromCon !== 0 && {borderColor: hpBonusFromCon > 0 ? '#00fa9a' : '#ff6666', borderWidth: 1}]} onPress={() => setHpModalVisible(true)}>
              <Text style={styles.hpTextStyle}>{displayHpCurrent} <Text style={styles.hpMaxTextStyle}>/ {displayHpMax}</Text></Text>
              <Text style={styles.combatLabel}>PONTOS DE VIDA {hpBonusFromCon !== 0 && `(CON ${hpBonusFromCon > 0 ? '+' : ''}${hpBonusFromCon})`}</Text>
            </TouchableOpacity>

            <View style={styles.combatStatsRow}>
              <TouchableOpacity style={[styles.combatStatSmall, caSumBuffs !== 0 && {borderColor: caColor, borderWidth: 1}]} 
                onPress={() => { setActiveBuffStat('CA'); setTempBuffValue(String(caTemp)); setTempBuffModalVisible(true); }}>
                {caSumBuffs !== 0 && <Text style={{position: 'absolute', top: 8, right: 12, fontSize: 11, fontWeight: 'bold', color: caColor}}>{caSumBuffs > 0 ? `+${caSumBuffs}` : caSumBuffs}</Text>}
                <Text style={[styles.combatStatValue, caSumBuffs !== 0 && {color: caColor}]}>{armorClassTotal}</Text>
                <Text style={styles.combatLabel}>C.A</Text>
              </TouchableOpacity>
              
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{desMod >= 0 ? `+${desMod}` : desMod}</Text><Text style={styles.combatLabel}>INICIATIVA</Text></View>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{charRaceSpeed}</Text><Text style={styles.combatLabel}>DESLOC.</Text></View>
            </View>

            <Text style={styles.sectionTitle}>ATRIBUTOS</Text>
            <View style={styles.attributesGrid}>
              {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map((key) => {
                const baseV = parseInt(character.stats[key]) || 10;
                const tempV = parseInt(character.stats.temp_mods?.[key]) || 0;
                const equipV = parseInt(character.stats.equip_mods?.[key]) || 0;
                
                const totalV = baseV + tempV + equipV;
                const sumBuffs = tempV + equipV;
                const hasBuffs = sumBuffs !== 0;
                
                const buffColor = sumBuffs > 0 ? '#00fa9a' : '#ff6666';

                return (
                  <TouchableOpacity key={key} 
                    style={[styles.attrBox, hasBuffs && {borderColor: buffColor, borderWidth: 1}]}
                    onPress={() => { setActiveBuffStat(key); setTempBuffValue(String(tempV)); setTempBuffModalVisible(true); }}
                  >
                    {hasBuffs && <Text style={{position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 'bold', color: buffColor}}>{sumBuffs > 0 ? `+${sumBuffs}` : sumBuffs}</Text>}
                    <Text style={styles.attrLabel}>{key}</Text>
                    <Text style={[styles.attrValue, hasBuffs && {color: buffColor}]}>{totalV}</Text>
                    <View style={styles.modBadge}><Text style={styles.modText}>{getMod(String(totalV)) >= 0 ? `+${getMod(String(totalV))}` : getMod(String(totalV))}</Text></View>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.sectionTitle}>HISTÓRICO E CARACTERÍSTICAS</Text>
            <View style={styles.cardBlock}>
              {character.features_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>TRAÇOS</Text><Text style={styles.detailText}>{character.features_traits}</Text></View> : null}
              {character.languages ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDIOMAS</Text><Text style={styles.detailText}>{character.languages}</Text></View> : null}
              {character.personality_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>PERSONALIDADE</Text><Text style={styles.detailText}>{character.personality_traits}</Text></View> : null}
              {character.ideals ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDEAIS</Text><Text style={styles.detailText}>{character.ideals}</Text></View> : null}
              {character.bonds ? <View style={styles.detailSection}><Text style={styles.detailLabel}>LIGAÇÕES</Text><Text style={styles.detailText}>{character.bonds}</Text></View> : null}
              {character.flaws ? <View style={styles.detailSection}><Text style={styles.detailLabel}>DEFEITOS</Text><Text style={styles.detailText}>{character.flaws}</Text></View> : null}
              {character.backstory ? <View style={styles.detailSection}><Text style={styles.detailLabel}>HISTÓRIA</Text><Text style={styles.detailText}>{character.backstory}</Text></View> : null}
            </View>
          </>
        )}

        {/* ABA PROFICIÊNCIAS */}
        {activeTab === 'profs' && (
          <>
            <View style={styles.headerSpaceBetween}>
              <Text style={styles.sectionTitle}>TESTES DE RESISTÊNCIA</Text>
              <Text style={{color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold'}}>Bônus Prof: +{profBonusChar}</Text>
            </View>
            <View style={styles.cardBlock}>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'}}>
                {proficientSaves.length > 0 ? proficientSaves.map((save: any) => {
                  const bV = parseInt(character.stats[save.stat]) || 10;
                  const tV = parseInt(character.stats.temp_mods?.[save.stat]) || 0;
                  const eV = parseInt(character.stats.equip_mods?.[save.stat]) || 0;
                  const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                  const total = statMod + profBonusChar;
                  return (
                    <View key={save.id} style={{width: '48%', flexDirection: 'row', alignItems: 'center', marginBottom: 15}}>
                      <View style={styles.profIconActive} />
                      <Text style={styles.profName}>{save.name}</Text>
                      <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                    </View>
                  );
                }) : <Text style={styles.emptyText}>Nenhum teste de resistência marcado.</Text>}
              </View>
            </View>

            <Text style={styles.sectionTitle}>PERÍCIAS (Skills)</Text>
            <View style={styles.cardBlock}>
              {proficientSkills.length > 0 ? proficientSkills.map((skill: any) => {
                const bV = parseInt(character.stats[skill.stat]) || 10;
                const tV = parseInt(character.stats.temp_mods?.[skill.stat]) || 0;
                const eV = parseInt(character.stats.equip_mods?.[skill.stat]) || 0;
                const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                const total = statMod + profBonusChar;
                return (
                  <View key={skill.id} style={styles.profRow}>
                    <View style={styles.profStatBadge}><Text style={{fontSize: 9, fontWeight: 'bold', color: 'rgba(255,255,255,0.5)'}}>{skill.stat}</Text></View>
                    <View style={styles.profIconActive} />
                    <Text style={[styles.profName, {flex: 1}]}>{skill.name}</Text>
                    <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                  </View>
                );
              }) : <Text style={styles.emptyText}>Nenhuma proficiência em perícias.</Text>}
            </View>
          </>
        )}

        {/* ABA INVENTÁRIO */}
        {activeTab === 'inv' && (
          <>
            <View style={styles.weightCard}>
                <Text style={styles.combatLabel}>PESO DA CARGA (Itens + Moedas)</Text>
                <Text style={[styles.weightVal, totalWeight > carryCap && {color: '#ff6666'}]}>{totalWeight.toFixed(1)} / {carryCap.toFixed(1)} kg</Text>
                <View style={styles.weightBarStyle}><View style={[styles.weightFillStyle, {width: `${Math.min((totalWeight/carryCap)*100, 100)}%`, backgroundColor: totalWeight > carryCap ? '#ff6666' : '#00bfff'}]} /></View>
            </View>

            <Text style={styles.sectionTitle}>AÇÕES DE ATAQUE</Text>
            {renderAttackCard(character.equipment.slots.mainHand, 'mainHand', 'Mão Principal')}
            {renderAttackCard(character.equipment.slots.offHand, 'offHand', 'Mão Secundária')}
            {renderAttackCard(character.equipment.slots.ranged, 'ranged', 'Arma à Distância')}

            <View style={styles.headerSpaceBetween}>
              <Text style={styles.sectionTitle}>MOEDAS</Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setConvertModalVisible(true)}>
                <Text style={styles.addBtnText}>💱 CÂMBIO</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.coinManager}>
              {[ { l: 'PO', k: 'gp', c: '#ffd700' }, { l: 'PP', k: 'sp', c: '#c0c0c0' }, { l: 'PC', k: 'cp', c: '#cd7f32' } ].map(c => (
                <View key={c.k} style={styles.coinControl}>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, -1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.coinDisplay} onPress={() => { setActiveCoinType(c.k as any); setInputValue(character[c.k].toString()); setCoinModalVisible(true); }}>
                    <Text style={[styles.coinLabel, {color: c.c}]}>{c.l}</Text>
                    <Text style={[styles.coinValText, {textDecorationLine: 'underline'}]}>{character[c.k]}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, 1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.headerSpaceBetween}>
                <Text style={styles.sectionTitle}>MOCHILA (Bolsos)</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setItemModalVisible(true)}><Text style={styles.addBtnText}>+ ITEM</Text></TouchableOpacity>
            </View>
            
            <View style={styles.cardBlock}>
              {character.equipment.bag.length > 0 ? character.equipment.bag.map((item: any, i: number) => {
                  const p = (item.properties || '').toLowerCase();
                  const d = (item.damage || '').toLowerCase();
                  const dt = (item.damage_type || '').toLowerCase();
                  const n = (item.name || '').toLowerCase();
                  const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || n.includes('poção') || n.includes('pocao');

                  return (
                    <View key={i} style={styles.itemRow}>
                        <View style={styles.qtyContainer}>
                            <TouchableOpacity onPress={() => updateBagQty(i, -1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>-</Text></TouchableOpacity>
                            <Text style={styles.itemQty}>{item.qty}</Text>
                            <TouchableOpacity onPress={() => updateBagQty(i, 1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>+</Text></TouchableOpacity>
                        </View>
                        
                        <TouchableOpacity 
                          style={{flex: 1}} 
                          onPress={() => {
                            setActionQty(1);
                            setSelectedBagItem({item, index: i});
                          }}
                        >
                            <Text style={styles.itemName}>{item.name}</Text>
                            <Text style={styles.itemSubDetail}>{item.weight}kg {item.properties ? ` • ${item.properties}` : ''}</Text>
                        </TouchableOpacity>

                    </View>
                  )
              }) : <Text style={styles.emptyText}>Sua mochila está vazia.</Text>}
            </View>

            <Text style={[styles.sectionTitle, {marginTop: 20}]}>SLOTS EQUIPADOS</Text>
            <View style={styles.equipGrid}>
              {renderEquipSlot('helmet', 'Capacete', '🪖')}
              {renderEquipSlot('amulet', 'Colar', '📿')}
              {renderEquipSlot('cloak', 'Capa', '🧥')}
              {renderEquipSlot('armor', 'Armadura', '🛡️')}
              {renderEquipSlot('campClothes', 'Acampamento', '🏕️')}
              {renderEquipSlot('lightSource', 'Fonte de Luz', '🕯️')}
              {renderEquipSlot('gloves', 'Luvas', '🧤')}
              {renderEquipSlot('boots', 'Botas', '👢')}
              {renderEquipSlot('ring1', 'Anel 1', '💍')}
              {renderEquipSlot('ring2', 'Anel 2', '💍')}
              {renderEquipSlot('mainHand', 'Principal', '🗡️')}
              {renderEquipSlot('offHand', 'Secundária', '🔪')}
              {renderEquipSlot('ranged', 'Distância', '🏹')}
            </View>
            <View style={{height: 30}} />
          </>
        )}

        {/* ABA MAGIAS E HABILIDADES */}
        {activeTab === 'spells' && (
          <View style={{paddingBottom: 20}}>
            
            <View style={styles.spellFilterSection}>
              <View style={styles.spellSearchRow}>
                <View style={styles.spellSearchInputBox}>
                  <Ionicons name="search" size={16} color="rgba(255,255,255,0.4)" />
                  <TextInput style={styles.spellSearchInput} placeholder="Buscar na lista..." placeholderTextColor="rgba(255,255,255,0.4)" value={spellSearch} onChangeText={setSpellSearch} />
                </View>
                <TouchableOpacity style={styles.spellSortBtn} onPress={() => setSpellSortOrder(prev => prev === 'A-Z' ? 'Z-A' : 'A-Z')}>
                  <Ionicons name={spellSortOrder === 'A-Z' ? "arrow-down" : "arrow-up"} color="#00bfff" size={18} />
                  <Text style={styles.spellSortText}>{spellSortOrder}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>NÍVEL / CATEGORIA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_LEVELS.map(lvl => (
                    <TouchableOpacity key={lvl} style={[styles.filterPill, spellLevelFilter === lvl && styles.filterPillActive]} onPress={() => setSpellLevelFilter(lvl)}>
                      <Text style={[styles.filterPillText, spellLevelFilter === lvl && styles.filterPillTextActive]}>{lvl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.filterLabel}>TIPO DE EFEITO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_EFFECTS.map(eff => (
                    <TouchableOpacity key={eff} style={[styles.filterPill, spellEffectFilter === eff && styles.filterPillActive]} onPress={() => setSpellEffectFilter(eff)}>
                      <Text style={[styles.filterPillText, spellEffectFilter === eff && styles.filterPillTextActive]}>{eff}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            <View style={{marginTop: 10}}>
              {getGroupedSpells().length > 0 ? getGroupedSpells().map(([groupName, spells]) => (
                <View key={groupName} style={{marginBottom: 20}}>
                   <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', paddingBottom: 5}}>
                      <Ionicons name={getSpellIcon(groupName) as any} size={18} color="#00bfff" />
                      <Text style={styles.spellGroupHeader}>{groupName.toUpperCase()}</Text>
                   </View>
                   
                   <View style={{gap: 12}}>
                      {spells.map((spell: any) => {
                        const effDisplay = spell.damage_dice || spell.damage || '-';
                        const typeDisplay = spell.damage_type && spell.damage_type !== 'Nenhum' ? ` (${spell.damage_type})` : '';

                        return (
                          <TouchableOpacity key={spell.id} style={styles.spellCardCompact} onPress={() => setSelectedSpell(spell)}>
                            <View style={styles.spellIconBox}>
                               <Ionicons name={getSpellIcon(groupName) as any} size={24} color="#00bfff" />
                            </View>
                            
                            <View style={{flex: 1, marginLeft: 15, justifyContent: 'center'}}>
                              <Text style={styles.spellNameCompact}>{spell.name}</Text>
                              <Text style={styles.spellSubCompact}>
                                 {spell.casting_time && spell.casting_time !== 'Passiva' ? `⏱️ ${spell.casting_time}  ` : ''}
                                 {spell.range && spell.range !== 'Pessoal' ? `📍 ${spell.range}` : ''}
                              </Text>
                            </View>
                            
                            <View style={{alignItems: 'flex-end', justifyContent: 'center'}}>
                              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.3)" />
                              {effDisplay !== '-' && (
                                <Text style={{color: '#00fa9a', fontWeight: 'bold', fontSize: 11, marginTop: 4}}>{effDisplay}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )
                      })}
                   </View>
                </View>
              )) : <Text style={[styles.emptyText, {marginTop: 40}]}>Nenhuma habilidade/magia atende aos filtros.</Text>}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ================= MODAIS DE SISTEMA ================= */}

      {/* MODAL DE DETALHES DE MAGIA/HABILIDADE ANIMADO */}
      <Modal visible={!!selectedSpell} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedSpell(null)}>
          <Animated.View style={[
            styles.spellDetailCard, 
            { opacity: spellFadeAnim, transform: [{ scale: spellScaleAnim }] }
          ]}>
            <Pressable onPress={e => e.stopPropagation()}>
              {selectedSpell && (
                <>
                  <View style={styles.spellDetailHeader}>
                    <View style={styles.spellDetailIcon}>
                      <Ionicons name={getSpellIcon(getCategory(selectedSpell)) as any} size={32} color="#02112b" />
                    </View>
                    <View style={{flex: 1, marginLeft: 15}}>
                      <Text style={styles.spellDetailName}>{selectedSpell.name}</Text>
                      <Text style={styles.spellDetailLevel}>
                         {getCategory(selectedSpell).toUpperCase()} {selectedSpell.level !== 'Passiva' && selectedSpell.level !== 'Truque' && !selectedSpell.level.includes('Nível') ? `• Nível ${selectedSpell.level}` : (selectedSpell.level !== 'Passiva' && selectedSpell.level !== 'Truque' ? `• ${selectedSpell.level.replace('Nível ', 'NV ')}` : '')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.divider} />
                  
                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>CONJURAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.casting_time || 'N/A'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.range || 'Pessoal'}</Text>
                    </View>
                  </View>

                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>COMPONENTES</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.components || '-'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>DURAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{selectedSpell.duration || 'Permanente'}</Text>
                    </View>
                  </View>

                  {(selectedSpell.damage_dice || selectedSpell.damage || selectedSpell.saving_throw) && (selectedSpell.damage_dice !== '-' || selectedSpell.damage !== '-') && (
                    <View style={{backgroundColor: 'rgba(0,250,154,0.1)', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)'}}>
                      <Text style={[styles.spellDetailInfoLabel, {color: '#00fa9a', textAlign: 'center'}]}>EFEITO PRINCIPAL</Text>
                      <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', fontSize: 16}]}>
                        {selectedSpell.damage_dice || selectedSpell.damage} {selectedSpell.damage_type && selectedSpell.damage_type !== 'Nenhum' ? `(${selectedSpell.damage_type})` : ''}
                        {selectedSpell.saving_throw && selectedSpell.saving_throw !== 'Nenhum' ? ` • CD ${selectedSpell.saving_throw}` : ''}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
                  <ScrollView style={{maxHeight: 250, marginTop: 5, backgroundColor: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 12}}>
                    <Text style={styles.spellDetailDescription}>{selectedSpell.description}</Text>
                  </ScrollView>

                  {lanInfo?.joinUrl && lanPlayers.length > 0 && (
                    <TouchableOpacity style={[styles.tradeActionButton, {marginTop: 14}]} onPress={() => startSpellCast(selectedSpell)}>
                      <Ionicons name="sparkles" size={18} color="#00bfff" />
                      <Text style={styles.tradeActionButtonText}>Usar na sessao</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedSpell(null)}>
                    <Text style={styles.modalCloseText}>FECHAR DETALHES</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Modal de Câmbio de Moedas */}
      <Modal visible={spellCastVisible && !!selectedSpell} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSpellCastVisible(false)}>
          <View style={styles.spellCastPanel}>
            {selectedSpell && (
              <>
                <View style={styles.spellCastHeader}>
                  <View>
                    <Text style={styles.spellCastTitle}>{selectedSpell.name}</Text>
                    <Text style={styles.spellCastMeta}>
                      {getSpellCastMode(selectedSpell) === 'heal' ? 'Cura' : getSpellCastMode(selectedSpell) === 'damage' ? 'Dano' : 'Efeito'} - {selectedSpell.duration || 'Instantanea'}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSpellCastVisible(false)}>
                    <Ionicons name="close" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>

                {getSpellCastMode(selectedSpell) !== 'effect' ? (
                  <>
                    <View style={styles.modalRowButtons}>
                      <TouchableOpacity style={styles.tradeActionButton} onPress={rollSpellForTargets}>
                        <Ionicons name="dice" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Rolar virtual</Text>
                      </TouchableOpacity>
                      <View style={styles.tradeActionButton}>
                        <Ionicons name="create" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Valor fisico</Text>
                      </View>
                    </View>

                    <View style={styles.spellResultBox}>
                      <Text style={styles.spellResultText}>
                        {spellRollResult || `Formula: ${getSpellDiceText(selectedSpell) || 'valor manual'}`}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.sessionPartyHint}>Para efeitos como enfeiticar, armadura ou buffs, escolha o alvo e opcionalmente um atributo/valor para registrar.</Text>
                    <View style={styles.spellEffectRow}>
                      {(['custom', 'PV_TEMP', 'CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'] as LanEffectTarget[]).map((target) => (
                        <TouchableOpacity
                          key={target}
                          style={[styles.filterPill, spellEffectTarget === target && styles.filterPillActive]}
                          onPress={() => setSpellEffectTarget(target)}
                        >
                          <Text style={[styles.filterPillText, spellEffectTarget === target && styles.filterPillTextActive]}>{target}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={styles.modalInput}
                      value={spellEffectValue}
                      onChangeText={setSpellEffectValue}
                      keyboardType="numeric"
                      placeholder="Valor opcional. Ex: +2"
                      placeholderTextColor="#666"
                    />
                  </>
                )}

                <FlatList
                  data={lanPlayers}
                  keyExtractor={(player) => player.key}
                  style={styles.tradeList}
                  renderItem={({ item }) => {
                    const active = spellTargetKeys.includes(item.key);
                    return (
                      <TouchableOpacity
                        style={[styles.spellTargetRow, active && styles.spellTargetRowActive]}
                        onPress={() => toggleSpellTarget(item.key)}
                      >
                        <View style={[styles.spellTargetCheck, active && styles.spellTargetCheckActive]}>
                          {active && <Ionicons name="checkmark" size={15} color="#02112b" />}
                        </View>
                        <View style={{flex: 1}}>
                          <Text style={styles.sessionPlayerName}>{item.characterName}{item.isSelf ? ' (voce)' : ''}</Text>
                          <Text style={styles.sessionPlayerMeta}>
                            Nivel {item.level} - HP {item.hpCurrent}/{item.hpMax}{item.tempHp > 0 ? ` (+${item.tempHp} temp.)` : ''}
                          </Text>
                        </View>
                        {getSpellCastMode(selectedSpell) !== 'effect' && (
                          <TextInput
                            style={styles.spellAmountInput}
                            value={spellTargetAmounts[item.key] || ''}
                            onChangeText={(value) => setSpellTargetAmounts((current) => ({ ...current, [item.key]: value }))}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor="#666"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />

                {lanPlayers.some((player) => player.isSelf) && (
                  <TouchableOpacity
                    style={styles.tradeActionButton}
                    onPress={() => {
                      const self = lanPlayers.find((player) => player.isSelf);
                      if (!self) return;
                      setSpellTargetKeys([self.key]);
                      setSpellTargetAmounts({ [self.key]: spellTargetAmounts[self.key] || '' });
                    }}
                  >
                    <Ionicons name="person" size={18} color="#00bfff" />
                    <Text style={styles.tradeActionButtonText}>Usar em mim</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.lvlUpBtnPrimary} onPress={applySpellCast}>
                  <Text style={styles.lvlUpBtnPrimaryText}>Aplicar magia</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={convertModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setConvertModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Casa da Moeda</Text>
            
            <View style={styles.exchangeBox}>
               <View style={styles.exchangeSide}>
                 <Text style={styles.exchangeLabel}>DE (Pagar)</Text>
                 <View style={styles.exchangeCoins}>
                   {(['gp', 'sp', 'cp'] as const).map(c => (
                     <TouchableOpacity key={c} style={[styles.coinMiniBtn, convertFrom === c && {borderColor: COIN_COLORS[c], backgroundColor: 'rgba(255,255,255,0.1)'}]} onPress={() => setConvertFrom(c)}>
                       <Text style={{color: COIN_COLORS[c], fontWeight: 'bold', fontSize: 12}}>{c.toUpperCase()}</Text>
                     </TouchableOpacity>
                   ))}
                 </View>
               </View>

               <Ionicons name="arrow-forward" size={24} color="rgba(255,255,255,0.2)" />

               <View style={styles.exchangeSide}>
                 <Text style={styles.exchangeLabel}>PARA (Receber)</Text>
                 <View style={styles.exchangeCoins}>
                   {(['gp', 'sp', 'cp'] as const).map(c => (
                     <TouchableOpacity key={c} style={[styles.coinMiniBtn, convertTo === c && {borderColor: COIN_COLORS[c], backgroundColor: 'rgba(255,255,255,0.1)'}]} onPress={() => setConvertTo(c)}>
                       <Text style={{color: COIN_COLORS[c], fontWeight: 'bold', fontSize: 12}}>{c.toUpperCase()}</Text>
                     </TouchableOpacity>
                   ))}
                 </View>
               </View>
            </View>

            <View style={{alignItems: 'center', marginBottom: 20}}>
              <TextInput style={[styles.modalInputLarge, {width: '80%', marginBottom: 5}]} keyboardType="numeric" value={convertAmount} onChangeText={setConvertAmount} placeholder="0" placeholderTextColor="#666" autoFocus />
              <Text style={{color: 'rgba(255,255,255,0.5)', fontSize: 12}}>Seu saldo: {character?.[convertFrom]} {COIN_NAMES[convertFrom]}</Text>
            </View>

            {(() => {
                const sourceAmount = parseInt(convertAmount) || 0;
                const copperValue = sourceAmount * COIN_RATES[convertFrom];
                const targetAmount = copperValue / COIN_RATES[convertTo];
                
                let isValid = false;
                let msg = "Aguardando valor...";
                let color = "rgba(255,255,255,0.2)";

                if (sourceAmount > 0) {
                  if (convertFrom === convertTo) {
                    msg = "Selecione moedas diferentes";
                    color = "#ff6666";
                  } else if (sourceAmount > character?.[convertFrom]) {
                    msg = "Saldo insuficiente!";
                    color = "#ff6666";
                  } else if (!Number.isInteger(targetAmount)) {
                    msg = "Conversão gera quebra (valor inexato)";
                    color = "#ff6666";
                  } else {
                    msg = `Receber: ${targetAmount} ${COIN_NAMES[convertTo]}`;
                    color = "#00fa9a";
                    isValid = true;
                  }
                }

                return (
                  <>
                    <Text style={{color: color, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 20}}>
                      {msg}
                    </Text>

                    <View style={styles.modalRowButtons}>
                      <TouchableOpacity style={styles.modalBtn} onPress={() => {setConvertModalVisible(false); setConvertAmount('');}}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Cancelar</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.modalBtn, {opacity: isValid ? 1 : 0.5}]} disabled={!isValid} onPress={() => executeCoinConversion(sourceAmount, targetAmount)}>
                        <Text style={{color:'#00fa9a', fontWeight:'bold'}}>Converter</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de BUFF TEMPORÁRIO */}
      <Modal visible={tempBuffModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTempBuffModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ajuste Temporário: {activeBuffStat}</Text>
            <Text style={{color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 15, fontSize: 13}}>Adicione buffs ou debuffs gerados por feitiços, itens ou fadiga. Ex: +2, -1</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" placeholder="Ex: +2" placeholderTextColor="rgba(255,255,255,0.2)" value={tempBuffValue} onChangeText={setTempBuffValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={clearTempBuff}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Limpar (0)</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleTempBuffSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>Aplicar Buff</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Modal de Ações do Item na Mochila */}
      <Modal visible={!!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedBagItem(null)}>
          <View style={styles.actionModalBox}>
            {selectedBagItem && (() => {
              const catItem = dbItemsCatalog.find(i => i.name === selectedBagItem.item.name);
              const itemLore = catItem?.descricao || '';
              const p = (selectedBagItem.item.properties || '').toLowerCase();
              const d = (selectedBagItem.item.damage || '').toLowerCase();
              const dt = (selectedBagItem.item.damage_type || '').toLowerCase();
              const n = (selectedBagItem.item.name || '').toLowerCase();
              const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || n.includes('poção') || n.includes('pocao');

              return (
              <>
                <Text style={styles.modalTitle}>{selectedBagItem.item.name}</Text>
                
                {/* LORE DO ITEM */}
                {itemLore ? (
                  <Text style={{color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 15, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 10}}>
                    {`"${itemLore}"`}
                  </Text>
                ) : (
                  <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 15, fontSize: 12, fontStyle: 'italic'}}>
                    Sem descrição disponível.
                  </Text>
                )}

                {/* STATUS DO ITEM SE NÃO FOR CONSUMÍVEL */}
                <View style={styles.itemStatsBox}>
                  {!isConsumable ? (
                    <>
                      <Text style={styles.itemStatText}>⚔️ Dano/Efeito: <Text style={{color: '#00fa9a'}}>{selectedBagItem.item.damage || '-'}</Text></Text>
                      <Text style={styles.itemStatText}>🛡️ Propriedades: {selectedBagItem.item.properties || '-'}</Text>
                    </>
                  ) : (
                    <Text style={styles.itemStatText}>🧪 Efeito: <Text style={{color: '#ff6666'}}>??? (Oculto até o consumo)</Text></Text>
                  )}
                </View>

                <View style={styles.actionQtyRow}>
                  <TouchableOpacity onPress={() => setActionQty(Math.max(1, actionQty - 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>-</Text></TouchableOpacity>
                  <Text style={styles.actionQtyVal}>{actionQty}</Text>
                  <TouchableOpacity onPress={() => setActionQty(Math.min(selectedBagItem.item.qty, actionQty + 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>+</Text></TouchableOpacity>
                </View>
                <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 20, fontSize: 10}}>Quantidade Selecionada</Text>

                <View style={{gap: 12, width: '100%'}}>
                  {isConsumable && (
                    <TouchableOpacity style={styles.actionBtnConsume} onPress={() => {
                      const {item, index} = selectedBagItem;
                      const qty = actionQty;
                      setSelectedBagItem(null);
                      processConsumeItem(index, item, qty);
                    }}>
                      <Ionicons name="flask" size={20} color="#00fa9a" />
                      <Text style={styles.actionBtnConsumeText}>Consumir</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={styles.actionBtnThrow} onPress={() => {
                    const {item, index} = selectedBagItem;
                    const qty = actionQty;
                    setSelectedBagItem(null);
                    processThrowItem(index, item, qty);
                  }}>
                    <Ionicons name="paper-plane" size={20} color="#ff6666" />
                    <Text style={styles.actionBtnThrowText}>Arremessar</Text>
                  </TouchableOpacity>

                  {lanInfo?.joinUrl && lanPlayers.some(player => !player.isSelf) && (
                    <>
                      <TouchableOpacity style={styles.tradeActionButton} onPress={() => setTargetPickerMode('send')}>
                        <Ionicons name="send" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Enviar para</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.tradeActionButton} onPress={() => setTargetPickerMode('trade')}>
                        <Ionicons name="swap-horizontal" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Propor troca</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setSelectedBagItem(null)}>
                    <Text style={styles.actionBtnCancelText}>Voltar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )})()}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!targetPickerMode && !!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTargetPickerMode(null)}>
          <View style={styles.tradePanel}>
            <Text style={styles.modalTitle}>{targetPickerMode === 'send' ? 'Enviar para' : 'Propor troca'}</Text>
            <Text style={styles.sessionPartyHint}>
              {selectedBagItem ? `${actionQty}x ${selectedBagItem.item.name}` : ''} - escolha um jogador ativo.
            </Text>

            <FlatList
              data={lanPlayers.filter(player => !player.isSelf)}
              keyExtractor={(player) => player.key}
              style={styles.tradeList}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhum outro jogador ativo na sessao.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.tradeItemChoice}
                  onPress={() => targetPickerMode === 'send' ? handleSendItemToPlayer(item) : handleOfferTradeToPlayer(item)}
                >
                  <Text style={styles.tradeSlotName}>{item.characterName}</Text>
                  <Text style={styles.tradeSlotMeta}>Nivel {item.level} - HP {item.hpCurrent}/{item.hpMax}{item.tempHp > 0 ? ` +${item.tempHp}` : ''}</Text>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setTargetPickerMode(null)}>
              <Text style={styles.actionBtnCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!selectedTradeOffer} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedTradeOffer(null)}>
          <View style={styles.tradePanel}>
            {selectedTradeOffer && (
              <>
                <Text style={styles.modalTitle}>Troca com {selectedTradeOffer.fromName}</Text>
                <Text style={styles.sessionPartyHint}>Escolha um item da sua mochila para colocar na troca.</Text>

                <View style={styles.tradeBoard}>
                  <View style={styles.tradeColumn}>
                    <Text style={styles.tradeColumnTitle}>Ele oferece</Text>
                    <View style={[styles.tradeSlot, styles.tradeSlotActive]}>
                      <Text style={styles.tradeSlotName}>{selectedTradeOffer.offeredItem?.name || 'Item'}</Text>
                      <Text style={styles.tradeSlotMeta}>Qtd. {selectedTradeOffer.offeredItem?.qty || 1}</Text>
                    </View>
                  </View>

                  <View style={styles.tradeArrowBox}>
                    <Ionicons name="swap-horizontal" size={22} color="#00bfff" />
                  </View>

                  <View style={styles.tradeColumn}>
                    <Text style={styles.tradeColumnTitle}>Sua oferta</Text>
                    <View style={[styles.tradeSlot, tradeCounterItem && styles.tradeSlotActive]}>
                      <Text style={styles.tradeSlotName}>{tradeCounterItem?.item?.name || 'Selecione abaixo'}</Text>
                      <Text style={styles.tradeSlotMeta}>Qtd. {tradeCounterItem ? tradeCounterQty : '-'}</Text>
                    </View>
                    {tradeCounterItem && (
                      <View style={styles.actionQtyRow}>
                        <TouchableOpacity onPress={() => setTradeCounterQty(Math.max(1, tradeCounterQty - 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>-</Text></TouchableOpacity>
                        <Text style={styles.actionQtyVal}>{tradeCounterQty}</Text>
                        <TouchableOpacity onPress={() => setTradeCounterQty(Math.min(tradeCounterItem.item.qty, tradeCounterQty + 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>+</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                <FlatList
                  data={character?.equipment?.bag || []}
                  keyExtractor={(_, index) => index.toString()}
                  style={styles.tradeList}
                  ListEmptyComponent={<Text style={styles.emptyText}>Sua mochila esta vazia.</Text>}
                  renderItem={({ item, index }) => {
                    const active = tradeCounterItem?.index === index;
                    return (
                      <TouchableOpacity
                        style={[styles.tradeItemChoice, active && styles.tradeItemChoiceActive]}
                        onPress={() => {
                          setTradeCounterItem({ item, index });
                          setTradeCounterQty(1);
                        }}
                      >
                        <Text style={styles.tradeSlotName}>{item.name}</Text>
                        <Text style={styles.tradeSlotMeta}>Qtd. {item.qty} - {item.weight || 0}kg</Text>
                      </TouchableOpacity>
                    );
                  }}
                />

                <View style={styles.modalRowButtons}>
                  <TouchableOpacity style={styles.modalBtn} onPress={() => handleDeclineTrade(selectedTradeOffer)}>
                    <Text style={{color:'#ff6666', fontWeight:'bold'}}>Recusar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, {opacity: tradeCounterItem ? 1 : 0.5}]} disabled={!tradeCounterItem} onPress={handleAcceptTrade}>
                    <Text style={{color:'#00fa9a', fontWeight:'bold'}}>Aceitar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={slotModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSlotModalVisible(false)}>
            <View style={[styles.modalContent, {height: '60%'}]}>
                <Text style={styles.modalTitle}>O que deseja equipar?</Text>
                <TouchableOpacity style={styles.unequipBtn} onPress={() => handleEquipItem(null)}><Text style={styles.unequipBtnText}>[ Limpar Espaço ]</Text></TouchableOpacity>
                <FlatList
                    data={character?.equipment?.bag || []}
                    keyExtractor={(i, idx) => idx.toString()}
                    renderItem={({item}) => {
                      const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
                      const itemDamage = item.damage || dbItem?.damage;
                      const itemDamageType = item.damage_type || dbItem?.damage_type;
                      const itemProps = item.properties || dbItem?.properties;
                      
                      let subText = `Peso: ${item.weight}kg`;
                      if (itemDamage && itemDamage !== '-') subText = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''} • ${subText}`;
                      else if (itemProps && itemProps !== '-') subText = `✨ ${itemProps.split(',')[0]} • ${subText}`;

                      return (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => handleEquipItem(item)}>
                            <View style={{flex: 1}}><Text style={styles.catalogItemName}>{item.name}</Text><Text style={styles.catalogItemSub}>{subText}</Text></View>
                            <Text style={styles.addIcon}>›</Text>
                        </TouchableOpacity>
                      )
                    }}
                    ListEmptyComponent={<Text style={styles.emptyText}>Mochila vazia.</Text>}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={itemModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setItemModalVisible(false)}>
            <View style={[styles.modalContent, {height: '75%'}]}>
                <Text style={styles.modalTitle}>Catálogo do Mundo</Text>
                <TextInput style={styles.modalInput} placeholder="Buscar..." placeholderTextColor="#666" value={itemSearch} onChangeText={setItemSearch} />
                <FlatList
                    data={dbItemsCatalog.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()))}
                    keyExtractor={i => i.id.toString()}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => addItemToBag(item)}>
                            <View style={{flex: 1}}>
                              <Text style={styles.catalogItemName}>
                                {item.name} {item.criador === 'proprio' || item.criador === 'importado' ? <Text style={{color: '#00bfff', fontSize: 10}}>[Custom]</Text> : null}
                              </Text>
                              <Text style={styles.catalogItemSub}>{item.weight}kg - Descrição. {item.descricao}</Text>
                            </View>
                            <Text style={styles.addIcon}>+</Text>
                        </TouchableOpacity>
                    )}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={coinModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCoinModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Quantidade de Moedas</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setCoinModalVisible(false)}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleCoinSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>Confirmar</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={hpModalVisible || xpModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => {setXpModalVisible(false); setHpModalVisible(false);}}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{xpModalVisible ? 'Gerenciar XP' : 'Gerenciar HP'}</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('remove') : handleHP('damage')}><Text style={{color:'#ff6666', fontWeight:'bold'}}>{xpModalVisible ? '- Remover' : '⚔️ Dano'}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('add') : handleHP('heal')}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{xpModalVisible ? '+ Adicionar' : '💖 Cura'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={levelUpModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Nível {newLevelData}</Text>
                <Text style={{color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', marginBottom: 25, marginTop: 10, lineHeight: 22}}>Você ganhou XP suficiente para subir de nível! Deseja atualizar sua ficha agora?</Text>
                <View style={{width: '100%', gap: 15}}>
                  <TouchableOpacity style={styles.lvlUpBtnPrimary} onPress={goToEditScreen}><Text style={styles.lvlUpBtnPrimaryText}>Atualizar Ficha</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.lvlUpBtnSecondary} onPress={() => setLevelUpModalVisible(false)}><Text style={styles.lvlUpBtnSecondaryText}>Mais Tarde</Text></TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

      {/* ================= MODAL DE ALERTAS CUSTOMIZADOS (AÇÕES) ================= */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>{customAlert.title}</Text>
            <Text style={styles.customAlertMessage}>{customAlert.message}</Text>
            
            <View style={styles.customAlertBtnRow}>
              {customAlert.buttons.map((btn, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.customAlertBtn, { borderColor: btn.color || '#fff', borderWidth: 1 }]}
                  onPress={() => {
                    // Fecha o modal e então executa a ação, se existir
                    setCustomAlert(prev => ({ ...prev, visible: false }));
                    if (btn.onPress) btn.onPress();
                  }}
                >
                  <Text style={[styles.customAlertBtnText, { color: btn.color || '#fff' }]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
        <DiceRoller3D rollRequest={diceRollRequest}/>
    </LinearGradient>
  );
}

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function decodeParam(value?: string) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseSpellDuration(duration?: string): { durationRemaining: number; durationUnit: LanEffectUnit } {
  const raw = String(duration || '').toLowerCase();
  const value = Math.max(1, parseInt(raw.match(/\d+/)?.[0] || '1'));

  if (raw.includes('turno') || raw.includes('rodada')) return { durationRemaining: value, durationUnit: 'turn' };
  if (raw.includes('hora')) return { durationRemaining: value, durationUnit: 'hour' };
  if (raw.includes('min')) return { durationRemaining: value, durationUnit: 'minute' };
  return { durationRemaining: 1, durationUnit: 'rest' };
}

function rollDiceExpression(expression: string) {
  const tokens = expression.match(/[+-]?\s*(?:\d*)d\d+|[+-]?\s*\d+/gi);
  if (!tokens?.length) return null;

  let total = 0;
  const parts: string[] = [];

  for (const token of tokens) {
    const clean = token.replace(/\s/g, '');
    const sign = clean.startsWith('-') ? -1 : 1;
    const unsigned = clean.replace(/^[+-]/, '');

    if (unsigned.toLowerCase().includes('d')) {
      const [countRaw, sidesRaw] = unsigned.toLowerCase().split('d');
      const count = Math.max(1, parseInt(countRaw || '1') || 1);
      const sides = Math.max(1, parseInt(sidesRaw) || 1);
      const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
      const subtotal = rolls.reduce((sum, roll) => sum + roll, 0) * sign;
      total += subtotal;
      parts.push(`${sign < 0 ? '-' : ''}${count}d${sides}[${rolls.join(',')}]`);
    } else {
      const value = (parseInt(unsigned) || 0) * sign;
      total += value;
      parts.push(`${value >= 0 ? '+' : ''}${value}`);
    }
  }

  return { total: Math.max(0, total), breakdown: parts.join(' ') };
}

function getDiceParts(expression: string) {
  const tokens = expression.match(/(?:\d*)d\d+/gi) || [];
  return tokens.map((token) => {
    const [countRaw, sidesRaw] = token.toLowerCase().split('d');
    return {
      count: Math.max(1, parseInt(countRaw || '1') || 1),
      sides: Math.max(1, parseInt(sidesRaw) || 1),
    };
  }).filter((entry) => [4, 6, 8, 10, 12, 20, 100].includes(entry.sides));
}
