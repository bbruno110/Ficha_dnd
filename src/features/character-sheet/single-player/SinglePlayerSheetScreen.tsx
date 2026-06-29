// ================= IMPORTAÇÕES DA CAMADA BÁSICA =================
import DiceRoller3D from '@/components/DiceRoller3D';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLanSession } from '@/contexts/LanSessionContext';
import { isTradeEventExpired } from '@/contexts/lan/lanSessionHelpers';
import { addTraceLog } from '@/network/traceRepository';
import { EffectDraft, formatEffectSummary } from '@/types/effects';
import { LanOfficialEventMessage } from '@/types/lan';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

function getExpectedLevelFromXp(xp: number) {
  let expectedLevel = 1;
  for (let i = XP_TABLE.length - 1; i >= 0; i--) {
    if (xp >= XP_TABLE[i]) {
      expectedLevel = i + 1;
      break;
    }
  }
  return expectedLevel;
}

const DEFAULT_SLOTS = { 
  helmet: null, cloak: null, amulet: null, armor: null, campClothes: null,
  gloves: null, boots: null, ring1: null, ring2: null, 
  mainHand: null, offHand: null, ranged: null, lightSource: null 
};

type EquipmentSlotKey = keyof typeof DEFAULT_SLOTS;

const normalizeItemText = (value: unknown) => String(value || '').toLowerCase();

const itemRulesText = (item?: any) => [
  item?.name,
  item?.category,
  item?.properties,
  item?.descricao,
].map(normalizeItemText).join(' ');

const isShieldItem = (item?: any) => {
  const category = normalizeItemText(item?.category);
  const properties = normalizeItemText(item?.properties);
  const name = normalizeItemText(item?.name);
  return category === 'escudo' || /^escudo\b/.test(properties) || (name === 'escudo' && properties.includes('ca'));
};

const isArmorItem = (item?: any) => {
  const category = normalizeItemText(item?.category);
  const properties = String(item?.properties || '');
  return !isShieldItem(item) && (category === 'armadura' || /^armadura\b/i.test(properties) || /ca\s*\d+/i.test(properties));
};

const isWeaponItem = (item?: any) => {
  const category = normalizeItemText(item?.category);
  if (category && category !== 'arma') return false;
  if (category === 'arma') return true;

  const damage = String(item?.damage || '').trim();
  const text = itemRulesText(item);
  return damage !== '' && damage !== '-' && /(arma|espada|machado|arco|besta|adaga|bordao|bordão|rapieira|maca|maça|dardo|cimitarra)/.test(text);
};

const acBonusFromItem = (item?: any) => {
  const props = String(item?.properties || '');
  const plusAfter = props.match(/\bCA\s*([+-]\d+)/i);
  const plusBefore = props.match(/([+-]\d+)\s*CA\b/i);
  return Number(plusAfter?.[1] || plusBefore?.[1] || 0) || 0;
};

const armorRuleFromItem = (item?: any) => {
  const props = String(item?.properties || '');
  const baseMatch = props.match(/\bCA\s*(\d+)/i);
  if (!item || !baseMatch) return { base: 10, dexCap: null as number | null, addDex: true };

  const base = Number(baseMatch[1]) || 10;
  const addDex = /mod\s*des/i.test(props);
  const capMatch = props.match(/m[aá]x\.?\s*(\d+)/i);
  return {
    base,
    dexCap: capMatch ? Number(capMatch[1]) : null,
    addDex,
  };
};

const SPELL_LEVELS = ['Todos', 'Passiva', 'Habilidade', 'Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
const SPELL_EFFECTS = ['Todos', 'Dano', 'Cura', 'Suporte/Defesa'];

const COIN_RATES = { gp: 100, sp: 10, cp: 1 };
const COIN_NAMES = { gp: 'Ouro', sp: 'Prata', cp: 'Cobre' };
const COIN_COLORS = { gp: '#ffd700', sp: '#c0c0c0', cp: '#cd7f32' };

type SheetSyncAdapter = {
  enabled: boolean;
  onCharacterChanged: (characterId: number, reason: string) => Promise<void>;
};

type SinglePlayerSheetScreenProps = {
  characterId?: string | string[] | number;
  syncAdapter?: SheetSyncAdapter;
  onOpenSyncSession?: () => void;
  externalRevision?: number;
};

type ItemEffect = EffectDraft & {
  id?: number;
  source_id?: number;
  source_name?: string;
  sort_order?: number;
};

type PendingRollEffect = {
  effect: ItemEffect;
  item: any;
  qty: number;
  rolledValue: string;
};

type MagicResourceState = {
  slots: Record<string, number>;
  abilities: Record<string, { used: number; max: number; recharge: 'turn' | 'short_rest' | 'long_rest' }>;
};

type SpellSlotMaxes = Record<string, number>;

type FeatureRequirement = string | { name?: string; level?: string | number; level_required?: string | number; minLevel?: string | number };

const getFeatureRequirementLevel = (feature: FeatureRequirement) => {
  if (typeof feature === 'string') return 1;
  const rawLevel = feature.level_required ?? feature.level ?? feature.minLevel ?? 1;
  const parsed = parseInt(String(rawLevel), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseFeatureNamesForLevel = (featuresJson?: string, characterLevel = 1) => {
  try {
    const parsed = JSON.parse(featuresJson || '[]') as FeatureRequirement[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(feature => getFeatureRequirementLevel(feature) <= characterLevel)
      .map(feature => typeof feature === 'string' ? feature : feature.name)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
};

const splitNameList = (value?: string | null) => String(value || '')
  .split(',')
  .map(token => token.trim())
  .filter(Boolean);

const dedupeSpellsByName = <T extends { name?: string | null; id?: string | number | null }>(spells: T[]) => {
  const seen = new Map<string, T>();
  spells.forEach(spell => {
    const key = String(spell.name || spell.id || '').trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, spell);
  });
  return Array.from(seen.values());
};

const parseCharacterClassSummary = (classSummary: string, fallbackLevel = 1) => {
  const entries: { name: string; subclass: string; level: number }[] = [];
  const pattern = /([^/()]+?)(?:\s*\(([^)]*)\))?\s+(\d+)(?=\s*\/|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(classSummary))) {
    entries.push({
      name: match[1].trim(),
      subclass: (match[2] || '').trim(),
      level: Math.max(1, parseInt(match[3], 10) || 1),
    });
  }

  if (entries.length > 0) return entries;

  const fallbackMatch = classSummary.match(/^([^()]+?)(?:\s*\(([^)]*)\))?$/);
  const fallbackName = (fallbackMatch?.[1] || classSummary).trim();
  if (!fallbackName) return [];
  return [{
    name: fallbackName,
    subclass: (fallbackMatch?.[2] || '').trim(),
    level: Math.max(1, fallbackLevel),
  }];
};

const emptyMagicResourceState = (): MagicResourceState => ({ slots: {}, abilities: {} });

const normalizeMagicResourceState = (value: unknown): MagicResourceState => {
  const parsed = typeof value === 'string'
    ? (() => { try { return JSON.parse(value || '{}'); } catch { return {}; } })()
    : value && typeof value === 'object'
      ? value as any
      : {};
  const legacySlots = parsed?.slots || Object.fromEntries(
    Object.entries(parsed || {}).filter(([key, val]) => /^\d+$/.test(key) && Number.isFinite(Number(val)))
  );
  const slots = Object.fromEntries(
    Object.entries(legacySlots || {}).map(([level, used]) => [String(level), Math.max(0, Math.trunc(Number(used || 0)))])
  );
  const abilities = Object.fromEntries(
    Object.entries(parsed?.abilities || {}).map(([id, entry]: [string, any]) => [String(id), {
      used: Math.max(0, Math.trunc(Number(entry?.used || 0))),
      max: Math.max(1, Math.trunc(Number(entry?.max || 1))),
      recharge: ['turn', 'short_rest', 'long_rest'].includes(String(entry?.recharge)) ? String(entry.recharge) : 'long_rest',
    }])
  ) as MagicResourceState['abilities'];
  return { slots, abilities };
};

const getSpellLevelNumber = (levelValue?: string | number | null) => {
  const text = String(levelValue || '');
  if (text.toLowerCase() === 'truque') return 0;
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

const spellUsesSlot = (spell: any) => {
  const category = getCategory(spell);
  const text = [spell?.name, spell?.description, spell?.damage_dice, spell?.duration].map(value => String(value || '').toLowerCase()).join(' ');
  return (category === 'Magia' && getSpellLevelNumber(spell?.level) > 0) || text.includes('espaço') || text.includes('espaco');
};

const getAbilityRecharge = (spell: any): MagicResourceState['abilities'][string]['recharge'] => {
  const text = [spell?.name, spell?.description, spell?.duration, spell?.casting_time].map(value => String(value || '').toLowerCase()).join(' ');
  if (text.includes('turno') || text.includes('rodada')) return 'turn';
  if (text.includes('descanso curto')) return 'short_rest';
  return 'long_rest';
};

const resetMagicResourceState = (state: MagicResourceState, mode: 'all' | 'turn' | 'short_rest' | 'long_rest') => {
  const next = normalizeMagicResourceState(state);
  if (mode === 'all' || mode === 'long_rest') {
    return emptyMagicResourceState();
  }
  const abilities = Object.fromEntries(
    Object.entries(next.abilities).filter(([, entry]) => {
      if (mode === 'turn') return entry.recharge !== 'turn';
      if (mode === 'short_rest') return entry.recharge === 'long_rest';
      return true;
    })
  );
  return { slots: next.slots, abilities };
};

// Força a categoria correta para o agrupamento
const getCategory = (spell: any): string => {
  if (spell.category && spell.category !== 'Desconhecido') return spell.category;
  if (spell.level === 'Truque' || spell.level?.includes('Nível')) return 'Magia';
  if (spell.casting_time === 'Passiva' || spell.level === 'Passiva') return 'Passiva';
  return 'Habilidade';
};

export default function SinglePlayerSheetScreen({ characterId, syncAdapter, onOpenSyncSession, externalRevision = 0 }: SinglePlayerSheetScreenProps) {
  const id = Array.isArray(characterId) ? characterId[0] : characterId;
  const router = useRouter();
  const db = useSQLiteContext();
  const { activeSession, sendLanCommand, players, getHistoryPage, localDeviceId, connectionStatus, isTransportReady, forceRecoverLanSession } = useLanSession();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<'stats' | 'profs' | 'inv' | 'spells'>('stats');
  const [character, setCharacter] = useState<any>(null);
  
  const [spellDetails, setSpellDetails] = useState<any[]>([]);
  const [spellSlotMaxes, setSpellSlotMaxes] = useState<SpellSlotMaxes>({});
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
  const [lanTargetPicker, setLanTargetPicker] = useState<{ mode: 'send' | 'trade'; item: any; qty: number } | null>(null);
  const [actionQty, setActionQty] = useState(1);
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});
  const [tradeAlertEvent, setTradeAlertEvent] = useState<LanOfficialEventMessage | null>(null);
  const [sheetTradeOffers, setSheetTradeOffers] = useState<LanOfficialEventMessage[]>([]);
  const [sheetTradeModal, setSheetTradeModal] = useState<LanOfficialEventMessage | null>(null);
  const [sheetTradeCounterItems, setSheetTradeCounterItems] = useState<any[]>([]);
  const [sheetTradeCounterItemIndex, setSheetTradeCounterItemIndex] = useState<number | null>(null);
  const [sheetTradeCounterQty, setSheetTradeCounterQty] = useState('1');
  const [sheetTradeCoins, setSheetTradeCoins] = useState({ gp: '', sp: '', cp: '' });
  const alertedTradeIdsRef = useRef<Record<string, boolean>>({});
  const promptedLevelUpRef = useRef('');
  const [rollEffectsModalVisible, setRollEffectsModalVisible] = useState(false);
  const [pendingRollEffects, setPendingRollEffects] = useState<PendingRollEffect[]>([]);
  const [pendingRollSummary, setPendingRollSummary] = useState('');

  // Sistema de Buffs Temporários
  const [tempBuffModalVisible, setTempBuffModalVisible] = useState(false);
  const [activeBuffStat, setActiveBuffStat] = useState('');
  const [tempBuffValue, setTempBuffValue] = useState('');

  // Filtros de Magia
  const [spellSearch, setSpellSearch] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('Todos');
  const [spellEffectFilter, setSpellEffectFilter] = useState('Todos');
  const [spellSortOrder, setSpellSortOrder] = useState<'A-Z' | 'Z-A'>('A-Z');
  
  // Estado para o Detalhe da Magia e Animação
  const [selectedSpell, setSelectedSpell] = useState<any>(null);
  const spellScaleAnim = useRef(new Animated.Value(0.85)).current;
  const spellFadeAnim = useRef(new Animated.Value(0)).current;
  const effectPulseAnim = useRef(new Animated.Value(0)).current;
  const [effectPulseIndex, setEffectPulseIndex] = useState(0);

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

  const activeVisualEffects = Array.isArray(character?.stats?.timed_effects) ? character.stats.timed_effects : [];
  const coloredVisualEffects = activeVisualEffects.filter((effect: any) => (effect?.kind !== 'temp_hp' || Number(character?.hp_temp || 0) > 0) && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(effect?.color || '')));
  const currentPulseEffect = coloredVisualEffects.length > 0 ? coloredVisualEffects[effectPulseIndex % coloredVisualEffects.length] : null;

  useEffect(() => {
    if (coloredVisualEffects.length === 0) {
      effectPulseAnim.stopAnimation();
      effectPulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(effectPulseAnim, { toValue: 0.22, duration: 1000, useNativeDriver: true }),
        Animated.timing(effectPulseAnim, { toValue: 0.06, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [coloredVisualEffects.length, effectPulseAnim]);

  useEffect(() => {
    if (coloredVisualEffects.length <= 1) return;
    const timer = setInterval(() => {
      setEffectPulseIndex(prev => prev + 1);
    }, 2000);
    return () => clearInterval(timer);
  }, [coloredVisualEffects.length]);

  const showCustomAlert = (title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string}[]) => {
    setCustomAlert({ visible: true, title, message, buttons: buttons || [{ text: 'OK', color: '#00bfff' }] });
  };

  const tradeNumberValue = (value: string | number | undefined | null, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const tradePartsLabel = (item: any, quantity: number, coins?: { gp?: number; sp?: number; cp?: number }) => {
    const parts = [
      item && quantity > 0 ? `${quantity}x ${String(item.name || item.itemName || 'Item')}` : '',
      Number(coins?.gp || 0) > 0 ? `${Number(coins?.gp || 0)} PO` : '',
      Number(coins?.sp || 0) > 0 ? `${Number(coins?.sp || 0)} PP` : '',
      Number(coins?.cp || 0) > 0 ? `${Number(coins?.cp || 0)} PC` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' + ') : 'Nada';
  };

  const removeSheetTradeOffer = (event: LanOfficialEventMessage) => {
    const eventKey = event.commandId || event.eventId;
    const offerKey = String((event.payload as any)?.offerCommandId || eventKey || '');
    setSheetTradeOffers(prev => prev.filter(offer => {
      const candidateKey = offer.commandId || offer.eventId;
      const candidateOfferKey = String((offer.payload as any)?.offerCommandId || candidateKey || '');
      return candidateKey !== eventKey && candidateKey !== offerKey && candidateOfferKey !== offerKey;
    }));
  };

  const openSheetTradeModal = (event: LanOfficialEventMessage) => {
    const isCounter = event.eventType === 'TRADE_COUNTERED';
    const bag = Array.isArray(character?.equipment?.bag) ? character.equipment.bag : [];
    setSheetTradeCounterItems(isCounter ? [] : bag);
    setSheetTradeCounterItemIndex(null);
    setSheetTradeCounterQty('1');
    setSheetTradeCoins({ gp: '', sp: '', cp: '' });
    setSheetTradeModal(event);
  };

  const declineSheetTrade = async (event: LanOfficialEventMessage) => {
    const payload = (event.payload || {}) as any;
    await sendLanCommand('PLAYER_TRADE_DECLINE', {
      offerCommandId: payload.offerCommandId || event.commandId || event.eventId,
    });
    setSheetTradeModal(current => ((current?.commandId || current?.eventId) === (event.commandId || event.eventId) ? null : current));
    removeSheetTradeOffer(event);
    showCustomAlert('Troca recusada', 'A proposta foi recusada.');
  };

  const submitSheetTrade = async () => {
    if (!sheetTradeModal) return;
    if (isLanPausedReadOnly) {
      showCustomAlert('Mesa pausada', 'A ficha fica em modo de leitura ate o mestre retomar a sessao.');
      return;
    }

    if (sheetTradeModal.eventType === 'TRADE_COUNTERED') {
      await sendLanCommand('PLAYER_TRADE_CONFIRM', {
        offerCommandId: String((sheetTradeModal.payload as any)?.offerCommandId || ''),
        counterCommandId: sheetTradeModal.commandId || sheetTradeModal.eventId,
      });
      removeSheetTradeOffer(sheetTradeModal);
      setSheetTradeModal(null);
      showCustomAlert('Troca confirmada', 'A troca foi confirmada na mesa.');
      await loadData();
      return;
    }

    const selectedItem = sheetTradeCounterItemIndex !== null ? sheetTradeCounterItems[sheetTradeCounterItemIndex] : null;
    const qty = selectedItem ? Math.max(1, Math.min(Number(selectedItem.qty || 1), tradeNumberValue(sheetTradeCounterQty, 1))) : 0;
    const coins = {
      gp: Math.max(0, tradeNumberValue(sheetTradeCoins.gp, 0)),
      sp: Math.max(0, tradeNumberValue(sheetTradeCoins.sp, 0)),
      cp: Math.max(0, tradeNumberValue(sheetTradeCoins.cp, 0)),
    };
    const hasReturn = Boolean(selectedItem && qty > 0) || coins.gp > 0 || coins.sp > 0 || coins.cp > 0;
    await sendLanCommand(hasReturn ? 'PLAYER_TRADE_COUNTER' : 'PLAYER_TRADE_ACCEPT', {
      offerCommandId: sheetTradeModal.commandId || sheetTradeModal.eventId,
      counterItem: selectedItem || null,
      counterQuantity: selectedItem ? qty : 0,
      ...coins,
    });
    removeSheetTradeOffer(sheetTradeModal);
    setSheetTradeModal(null);
    setSheetTradeCounterItems([]);
    showCustomAlert(hasReturn ? 'Resposta enviada' : 'Troca aceita', hasReturn ? 'Sua contraproposta foi enviada.' : 'Voce aceitou a proposta sem retorno.');
    await loadData();
  };

  const respondToSheetTradeOffer = async (event: LanOfficialEventMessage, action: 'accept' | 'decline') => {
    const payload = (event.payload || {}) as any;
    const offerCommandId = payload.offerCommandId || event.commandId || event.eventId;
    if (!offerCommandId) return;
    if (action === 'accept') {
      openSheetTradeModal(event);
      return;
    }
    await declineSheetTrade(event);
  };

  useEffect(() => {
    if (!activeSession || activeSession.role !== 'player' || !activeSession.linked_character_id || !character?.id) {
      setSheetTradeOffers([]);
      return;
    }

    let cancelled = false;
    const loadTradeOffers = async () => {
      const rows = await getHistoryPage(0, 50);
      const resolvedTradeOfferIds = new Set<string>();
      const counteredTradeOfferIds = new Set<string>();
      for (const event of rows) {
        const offerCommandId = String((event.payload as any)?.offerCommandId || '');
        if (offerCommandId && (event.eventType === 'TRADE_ACCEPTED' || event.eventType === 'TRADE_DECLINED' || event.eventType === 'TRADE_EXPIRED')) {
          resolvedTradeOfferIds.add(offerCommandId);
        }
        if (offerCommandId && event.eventType === 'TRADE_COUNTERED') {
          counteredTradeOfferIds.add(offerCommandId);
        }
      }

      const pending = rows.filter(event => {
        const offerCommandId = event.commandId || event.eventId;
        const payload = (event.payload || {}) as any;
        const targetDeviceId = String(event.targetDeviceId || payload.targetDeviceId || '');
        const belongsToThisDevice = localDeviceId ? targetDeviceId === localDeviceId : !targetDeviceId;
        const pendingOffer = (
          event.eventType === 'TRADE_OFFERED' &&
          Number(event.targetCharacterId || 0) === Number(activeSession.linked_character_id || 0) &&
          belongsToThisDevice &&
          !resolvedTradeOfferIds.has(offerCommandId) &&
          !counteredTradeOfferIds.has(offerCommandId) &&
          !isTradeEventExpired(event)
        );
        const counterOfferCommandId = String(payload.offerCommandId || '');
        const pendingCounter = (
          event.eventType === 'TRADE_COUNTERED' &&
          Number(event.targetCharacterId || 0) === Number(activeSession.linked_character_id || 0) &&
          belongsToThisDevice &&
          !!counterOfferCommandId &&
          !resolvedTradeOfferIds.has(counterOfferCommandId) &&
          !isTradeEventExpired(event)
        );
        return pendingOffer || pendingCounter;
      });

      if (cancelled) return;
      setSheetTradeOffers(pending);

      const unseen = pending.find(event => {
        const key = event.commandId || event.eventId;
        return key && !alertedTradeIdsRef.current[key];
      });
      if (!unseen) return;

      const key = unseen.commandId || unseen.eventId;
      alertedTradeIdsRef.current[key] = true;
      setTradeAlertEvent(unseen);
    };

    void loadTradeOffers();
    const timer = setInterval(() => void loadTradeOffers(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeSession?.id, activeSession?.role, activeSession?.linked_character_id, character?.id, externalRevision, getHistoryPage, localDeviceId, onOpenSyncSession, router]);

  const onlySignedIntegerText = (value: string) => value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
  const onlyPositiveIntegerText = (value: string) => value.replace(/[^\d]/g, '');

  const openHpManager = () => {
    setInputValue('0');
    setHpModalVisible(true);
  };

  const openXpManager = () => {
    setInputValue('0');
    setXpModalVisible(true);
  };

  const loadData = useCallback(async () => {
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
        parsedStats.timed_effects = Array.isArray(parsedStats.timed_effects) ? parsedStats.timed_effects : [];
        if (Number((result as any).hp_temp || 0) <= 0) {
          parsedStats.timed_effects = parsedStats.timed_effects.filter((effect: any) => effect?.kind !== 'temp_hp');
        }

        const charData: any = {
          ...(result as any),
          stats: parsedStats,
          save_values: loadedSaves,
          skill_values: loadedSkills,
          equipment: parsedEquip,
          spells: JSON.parse((result as any).spells || '[]'),
          spell_slots_used: normalizeMagicResourceState((result as any).spell_slots_used || '{}'),
        };
        setCharacter(charData);

        const expectedLevelFromXp = getExpectedLevelFromXp(Number(charData.xp || 0));
        const currentLevel = Number(charData.level || 1);
        const promptKey = `${charData.id}:${currentLevel}:${expectedLevelFromXp}`;
        if (expectedLevelFromXp > currentLevel && promptedLevelUpRef.current !== promptKey) {
          promptedLevelUpRef.current = promptKey;
          setNewLevelData(expectedLevelFromXp);
          setLevelUpModalVisible(true);
        }

        const raceData = await db.getFirstAsync<{speed: string; features?: string}>(`SELECT speed, features FROM races WHERE name = ?`, [charData.race]);
        if (raceData) setCharRaceSpeed(raceData.speed);

        const casterClasses = await db.getAllAsync<{name: string}>(`SELECT name FROM classes WHERE is_caster = 1`);
        const hasSpells = casterClasses.some(c => charData.class.includes(c.name));
        setCharHasSpells(true);

        const guaranteedFeatureNames = new Set<string>(parseFeatureNamesForLevel(raceData?.features, currentLevel));
        const classEntries = parseCharacterClassSummary(String(charData.class || ''), currentLevel);
        const nextSlotMaxes: SpellSlotMaxes = {};

        for (const entry of classEntries) {
          const classData = await db.getFirstAsync<{ features?: string }>(`SELECT features FROM classes WHERE name = ? LIMIT 1`, [entry.name]);
          parseFeatureNamesForLevel(classData?.features, entry.level).forEach(feature => guaranteedFeatureNames.add(feature));

          const progression = await db.getFirstAsync<any>(
            `SELECT slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8, slot_9
             FROM spellcasting_progression
             WHERE source_type = 'class' AND source_name = ? AND level = ?
             LIMIT 1`,
            [entry.name, entry.level]
          );
          for (let slotLevel = 1; slotLevel <= 9; slotLevel++) {
            const amount = Number(progression?.[`slot_${slotLevel}`] || 0);
            if (amount > 0) nextSlotMaxes[String(slotLevel)] = Number(nextSlotMaxes[String(slotLevel)] || 0) + amount;
          }

          if (entry.subclass) {
            const subclassRows = await db.getAllAsync<{ features?: string; class_name?: string }>(
              `SELECT features, class_name FROM subclasses WHERE name = ?`,
              [entry.subclass]
            );
            const subclassData = subclassRows.find(row => splitNameList(row.class_name).includes(entry.name));
            parseFeatureNamesForLevel(subclassData?.features, entry.level).forEach(feature => guaranteedFeatureNames.add(feature));

            const subclassProgression = await db.getFirstAsync<any>(
              `SELECT slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8, slot_9
               FROM spellcasting_progression
               WHERE source_type = 'subclass' AND source_name = ? AND level = ?
               LIMIT 1`,
              [entry.subclass, entry.level]
            );
            for (let slotLevel = 1; slotLevel <= 9; slotLevel++) {
              const amount = Number(subclassProgression?.[`slot_${slotLevel}`] || 0);
              if (amount > 0) nextSlotMaxes[String(slotLevel)] = Number(nextSlotMaxes[String(slotLevel)] || 0) + amount;
            }
          }
        }
        setSpellSlotMaxes(nextSlotMaxes);

        const savedSpellIds = Array.from(new Set<number>((Array.isArray(charData.spells) ? charData.spells : [])
          .map((sp: string | number) => Number(sp))
          .filter((spellId: number) => Number.isFinite(spellId))));
        const guaranteedFeatures = Array.from(guaranteedFeatureNames);
        const spellConditions: string[] = [];
        const spellParams: (string | number)[] = [];

        if (savedSpellIds.length > 0) {
          spellConditions.push(`id IN (${savedSpellIds.map(() => '?').join(',')})`);
          spellParams.push(...savedSpellIds);
        }
        if (guaranteedFeatures.length > 0) {
          spellConditions.push(`name IN (${guaranteedFeatures.map(() => '?').join(',')})`);
          spellParams.push(...guaranteedFeatures);
        }

        if (spellConditions.length > 0) {
          const spellsFull = await db.getAllAsync(`SELECT * FROM spells WHERE ${spellConditions.join(' OR ')}`, spellParams);
          setSpellDetails(dedupeSpellsByName(spellsFull as any[]));
        } else {
          setSpellDetails([]);
        }
      }
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (externalRevision > 0) {
      loadData();
    }
  }, [externalRevision, loadData]);

  // Se estiver carregando ou sem personagem, encerra o render aqui
  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00bfff" /></View>;
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
  const activeEffects = activeVisualEffects;
  const tempHpValue = Math.max(0, Number(character.hp_temp || 0));
  const effectLabel = (effect: any) => {
    const base = effect?.label || (effect?.kind === 'temp_hp' ? `PV temp +${effect.amount || 0}` : `${effect?.stat || 'Efeito'} ${Number(effect?.amount || 0) >= 0 ? '+' : ''}${effect?.amount || 0}`);
    if (effect?.durationUnit === 'short_rest') return `${base} / descanso curto`;
    if (effect?.durationUnit === 'long_rest') return `${base} / descanso longo`;
    if (effect?.durationUnit) return `${base} / ${effect.durationValue || 1} ${effect.durationUnit}`;
    return String(base);
  };

  const consumeVisualTempHpEffects = (statsValue: any, absorbedDamage: number) => {
    const nextStats = {
      ...statsValue,
      temp_mods: { ...(statsValue?.temp_mods || {}) },
      equip_mods: { ...(statsValue?.equip_mods || {}) },
      timed_effects: Array.isArray(statsValue?.timed_effects) ? [...statsValue.timed_effects] : [],
    };
    let remainingDamage = Math.max(0, Number(absorbedDamage || 0));
    if (remainingDamage <= 0) return nextStats;

    const remainingEffects: any[] = [];
    for (const effect of nextStats.timed_effects) {
      if (effect?.kind !== 'temp_hp' || remainingDamage <= 0) {
        remainingEffects.push(effect);
        continue;
      }

      const effectAmount = Math.max(0, Number(effect.amount || 0));
      if (effectAmount <= remainingDamage) {
        remainingDamage -= effectAmount;
        continue;
      }

      const nextAmount = effectAmount - remainingDamage;
      remainingDamage = 0;
      remainingEffects.push({
        ...effect,
        amount: nextAmount,
        label: `PV temporario +${nextAmount}`,
      });
    }

    nextStats.timed_effects = remainingEffects;
    return nextStats;
  };

  const bagWeight = character.equipment.bag.reduce((acc: number, item: any) => acc + (item.weight * item.qty), 0);
  const slotsWeight = Object.values(character.equipment.slots).reduce((acc: number, item: any) => acc + (item ? item.weight : 0), 0);
  const totalWeight = bagWeight + slotsWeight + ((character.gp + character.sp + character.cp) * 0.01);
  const carryCap = (forBase + forTemp + forEquip) * 7.5;

  const hydrateEquippedItem = (item: any) => item ? { ...(dbItemsCatalog.find((cat: any) => cat.name === item.name) || {}), ...item } : item;
  const equippedSlotsForRules = Object.fromEntries(
    Object.entries(character.equipment.slots).map(([slot, item]) => [slot, hydrateEquippedItem(item)])
  ) as Record<EquipmentSlotKey, any>;
  const armorRule = armorRuleFromItem(equippedSlotsForRules.armor);
  const dexBonusForArmor = armorRule.addDex
    ? armorRule.dexCap === null ? desMod : Math.min(desMod, armorRule.dexCap)
    : 0;
  const equippedAcBonus = Object.values(equippedSlotsForRules).reduce(
    (acc: number, item: any) => acc + acBonusFromItem(item),
    0
  );
  const caTemp = parseInt(character.stats.temp_mods?.CA) || 0;
  const caEquip = parseInt(character.stats.equip_mods?.CA) || 0;
  const armorClassTotal = armorRule.base + dexBonusForArmor + equippedAcBonus + caTemp + caEquip;
  const caSumBuffs = equippedAcBonus + caTemp + caEquip;
  const caColor = caSumBuffs > 0 ? '#00fa9a' : (caSumBuffs < 0 ? '#ff6666' : '#fff');

  const expectedLevel = getExpectedLevelFromXp(Number(character.xp || 0));
  const isPendingLevelUp = expectedLevel > character.level;
  const isLanPlayerControlledSheet = activeSession?.role === 'player' && Number(activeSession.linked_character_id || 0) === Number(character.id);
  const isLanPausedReadOnly = isLanPlayerControlledSheet && activeSession?.status === 'paused';
  const isDeadInLan = isLanPlayerControlledSheet && displayHpCurrent <= 0;
  const isLanBadgeBusy = Boolean(syncAdapter?.enabled && (connectionStatus === 'syncing' || connectionStatus === 'reconnecting'));
  const isLanBadgeHealthy = Boolean(syncAdapter?.enabled && isTransportReady && connectionStatus === 'connected');
  const isLanBadgeWarning = Boolean(syncAdapter?.enabled && !isLanBadgeHealthy);
  const magicResources = normalizeMagicResourceState(character.spell_slots_used);
  const spellSlotLevels = Object.keys(spellSlotMaxes)
    .filter(level => Number(spellSlotMaxes[level] || 0) > 0)
    .sort((a, b) => Number(a) - Number(b));

  const handleTopLanBadgePress = async () => {
    if (isLanPausedReadOnly || !syncAdapter?.enabled) {
      onOpenSyncSession?.();
      return;
    }

    try {
      await forceRecoverLanSession('sheet-top-badge');
      await loadData();
      showCustomAlert('LAN sincronizada', 'A ficha tentou recuperar a conexao e recarregou os dados da mesa.');
    } catch (error) {
      showCustomAlert('Falha ao sincronizar LAN', error instanceof Error ? error.message : 'Nao foi possivel recuperar a conexao agora.');
    }
  };

  const avatarSourceForName = (name: string, size = 120) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Jogador')}&background=102b56&color=00bfff&size=${size}&bold=true`;

  const parseLanSnapshot = (player: any) => {
    try {
      const snapshot = typeof player?.snapshot_payload === 'string' ? JSON.parse(player.snapshot_payload) : player?.snapshot_payload;
      if (!snapshot?.data) {
        return {
          name: player?.character_name || player?.player_name || 'Personagem',
          level: 1,
          hpCurrent: 0,
          hpMax: 1,
          hpTemp: 0,
          hpUnknown: true,
          race: '',
          className: '',
          avatarUri: avatarSourceForName(player?.character_name || player?.player_name || 'Jogador'),
        };
      }
      const data = snapshot?.data || {};
      const name = snapshot?.name || data.name || player?.character_name || player?.player_name || 'Personagem';
      return {
        name,
        level: Number(data.level ?? snapshot?.level ?? 1),
        hpCurrent: Math.max(0, Number(data.hp_current ?? 0)),
        hpMax: Math.max(1, Number(data.hp_max ?? 1)),
        hpTemp: Math.max(0, Number(data.hp_temp ?? 0)),
        hpUnknown: false,
        race: String(data.race ?? snapshot?.race ?? ''),
        className: String(data.class ?? snapshot?.class ?? ''),
        avatarUri: String(data.avatar_data_uri || snapshot?.avatar_data_uri || '') || avatarSourceForName(name),
      };
    } catch {
      const name = player?.character_name || player?.player_name || 'Personagem';
      return {
        name,
        level: 1,
        hpCurrent: 0,
        hpMax: 1,
        hpTemp: 0,
        hpUnknown: true,
        race: '',
        className: '',
        avatarUri: avatarSourceForName(name),
      };
    }
  };

  const tradeParticipantInfo = (event: LanOfficialEventMessage, side: 'source' | 'target' = 'source') => {
    const payload = (event.payload || {}) as any;
    const deviceId = String(side === 'source' ? payload.sourceDeviceId || event.actorDeviceId || '' : payload.targetDeviceId || event.targetDeviceId || '');
    const characterId = Number(side === 'source' ? payload.sourceCharacterId || event.targetCharacterId || 0 : payload.targetCharacterId || event.targetCharacterId || 0);
    const fallbackName = String(side === 'source' ? payload.sourceName || event.actorName || 'Personagem' : payload.targetName || event.targetName || 'Personagem');
    const player = players.find((candidate: any) => (
      String(candidate.device_id || '') === deviceId &&
      (!characterId || Number(candidate.character_id || 0) === characterId)
    )) || players.find((candidate: any) => String(candidate.device_id || '') === deviceId);
    const snapshot = player ? parseLanSnapshot(player) : null;
    const name = String(snapshot?.name || fallbackName);
    return {
      name,
      race: String(snapshot?.race || ''),
      className: String(snapshot?.className || ''),
      level: Number(snapshot?.level || 0),
      avatarUri: snapshot?.avatarUri || avatarSourceForName(name),
    };
  };

  const lanPlayersWithCharacters = players.filter((player: any) => player.character_id);
  const isOwnLanPlayer = (player: any) => {
    const playerDeviceId = String(player?.device_id || '');
    const ownDeviceMatches = localDeviceId ? playerDeviceId === localDeviceId : playerDeviceId === 'local';
    return ownDeviceMatches && Number(player?.character_id || 0) === Number(character.id);
  };
  const lanTradeTargets = isLanPlayerControlledSheet
    ? lanPlayersWithCharacters.filter((player: any) => !isOwnLanPlayer(player))
    : [];
  const lanPanelPlayers = isLanPlayerControlledSheet
    ? [
        ...lanPlayersWithCharacters.filter((player: any) => isOwnLanPlayer(player)),
        ...lanPlayersWithCharacters.filter((player: any) => !isOwnLanPlayer(player)),
      ]
    : [];

  const requestMasterApproval = async (command: 'PLAYER_REQUEST_HP' | 'PLAYER_REQUEST_XP' | 'PLAYER_REQUEST_COINS' | 'PLAYER_REQUEST_ATTRIBUTE', payload: Record<string, unknown>, notice = 'Solicitacao enviada ao mestre.') => {
    if (isLanPausedReadOnly) {
      showCustomAlert('Mesa pausada', 'A ficha fica em modo de leitura ate o mestre retomar a sessao.');
      return;
    }
    await sendLanCommand(command, {
      characterName: character.name,
      targetCharacterId: character.id,
      targetDeviceId: localDeviceId || undefined,
      ...payload,
    });
    showCustomAlert('Solicitacao enviada', notice);
  };

  const lanTargetName = (target: any) => target?.character_name || target?.player_name || 'Jogador';

  const sendItemToLanPlayer = async (target: any, item: any, qty: number) => {
    if (isLanPausedReadOnly) {
      showCustomAlert('Mesa pausada', 'A ficha fica em modo de leitura ate o mestre retomar a sessao.');
      return;
    }
    try {
      await sendLanCommand('PLAYER_ITEM_DONATE', {
        sourceCharacterId: character.id,
        sourceName: character.name,
        itemName: item?.name || 'Item',
        item,
        quantity: qty,
        targetDeviceId: target.device_id,
        targetCharacterId: Number(target.character_id || 0),
        targetName: lanTargetName(target),
      });
      showCustomAlert('Envio registrado', `Voce enviou ${qty}x ${item?.name || 'item'} para ${lanTargetName(target)}.`);
    } catch (error) {
      showCustomAlert('LAN sem sincronismo', error instanceof Error ? error.message : 'Nao foi possivel enviar o item agora. Toque no LAN do topo para forcar a ressincronizacao.');
    }
  };

  const offerTradeToLanPlayer = async (target: any, item: any, qty: number) => {
    if (isLanPausedReadOnly) {
      showCustomAlert('Mesa pausada', 'A ficha fica em modo de leitura ate o mestre retomar a sessao.');
      return;
    }
    try {
      await sendLanCommand('PLAYER_TRADE_OFFER', {
        sourceCharacterId: character.id,
        sourceName: character.name,
        itemName: item?.name || 'Item',
        item,
        quantity: qty,
        targetDeviceId: target.device_id,
        targetCharacterId: Number(target.character_id || 0),
        targetName: lanTargetName(target),
      });
      showCustomAlert('Troca enviada', `${lanTargetName(target)} recebeu sua proposta de ${qty}x ${item?.name || 'item'}.`);
    } catch (error) {
      showCustomAlert('LAN sem sincronismo', error instanceof Error ? error.message : 'Nao foi possivel enviar a troca agora. Toque no LAN do topo para forcar a ressincronizacao.');
    }
  };

  const showLanItemTargetPicker = (mode: 'send' | 'trade', item: any, qty: number) => {
    if (!lanTradeTargets.length) {
      showCustomAlert('Sem jogadores', 'Nao ha outro jogador com ficha vinculada nesta mesa.');
      return;
    }
    setLanTargetPicker({ mode, item, qty });
  };

  const isConsumableItem = (item: any, catalogItem?: any) => {
    const p = String(item?.properties || catalogItem?.properties || '').toLowerCase();
    const d = String(item?.damage || catalogItem?.damage || '').toLowerCase();
    const dt = String(item?.damage_type || catalogItem?.damage_type || '').toLowerCase();
    const n = String(item?.name || catalogItem?.name || '').toLowerCase();
    return (
      Number(item?.is_consumable ?? catalogItem?.is_consumable ?? 0) === 1 ||
      p.includes('consumivel') ||
      p.includes('consumível') ||
      d.includes('cura') ||
      dt.includes('cura') ||
      d.includes('escolher') ||
      n.includes('pocao') ||
      n.includes('poção')
    );
  };

  const checkProficiency = (idx: string, group: any[]) => group.includes(idx);
  const proficientSaves = dbSaves.filter((save: any) => checkProficiency(save.id, character.save_values));
  const proficientSkills = dbSkills.filter((skill: any) => checkProficiency(skill.id, character.skill_values));


  // ==============================================================================
  // 2. FUNÇÕES DE AÇÃO QUE UTILIZAM AS VARIÁVEIS ACIMA
  // ==============================================================================

  const updateDB = async (updates: Partial<any>) => {
    try {
      if (isLanPausedReadOnly) {
        showCustomAlert('Mesa pausada', 'A ficha fica em modo de leitura ate o mestre retomar a sessao.');
        return;
      }
      const entries = Object.entries(updates);
      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => ({ ...prev, ...updates }));
      if (syncAdapter?.enabled) {
        await syncAdapter.onCharacterChanged(character.id, 'sheet-update').catch(error => {
          console.warn('Ficha salva localmente, mas a sincronizacao LAN falhou:', error);
        });
      }
    } catch (e) { console.error(e); }
  };

  const saveMagicResources = async (nextState: MagicResourceState, reason = 'resource-update') => {
    const normalized = normalizeMagicResourceState(nextState);
    if (isLanPlayerControlledSheet) {
      try {
        await sendLanCommand('MASTER_APPLY_RESOURCE', {
          targetCharacterId: Number(character.id),
          targetDeviceId: localDeviceId,
          targetName: character.name || 'Personagem',
          characterName: character.name || 'Personagem',
          spellSlotsUsed: normalized,
          description: `${character.name || 'Jogador'} atualizou recursos: ${reason}.`,
        });
        setCharacter((prev: any) => ({ ...prev, spell_slots_used: normalized }));
      } catch (error) {
        console.warn('Nao foi possivel sincronizar recurso LAN:', error);
      }
      return;
    }

    await updateDB({ spell_slots_used: normalized });
    console.log(`[MAGIC_RESOURCE] ${reason}`, nextState);
  };

  const handleRestoreSpellSlot = async (slotLevel: string, amount = 1) => {
    if (false && isLanPlayerControlledSheet) {
      showCustomAlert('Controle do mestre', 'Na mesa LAN, os espaços e usos são ajustados pelo mestre.');
      return;
    }
    const next = normalizeMagicResourceState(magicResources);
    next.slots[slotLevel] = Math.max(0, Number(next.slots[slotLevel] || 0) - amount);
    await saveMagicResources(next, `Restaurou espaço de magia ${slotLevel}`);
  };

  const handleResetMagicResources = async (mode: 'all' | 'turn' | 'short_rest' | 'long_rest' = 'all') => {
    if (false && isLanPlayerControlledSheet) {
      showCustomAlert('Controle do mestre', 'Na mesa LAN, descansos e recursos são controlados pelo mestre.');
      return;
    }
    await saveMagicResources(resetMagicResourceState(magicResources, mode), `Resetou recursos: ${mode}`);
  };

  const handleUseSpellResource = async (spell: any, slotLevel?: number) => {
    if (false && isLanPlayerControlledSheet) {
      showCustomAlert('Controle do mestre', 'Na mesa LAN, avise o mestre que você usou este recurso para ele registrar na mesa.');
      return;
    }

    const next = normalizeMagicResourceState(magicResources);
    const consumesSlot = spellUsesSlot(spell);
    const minimumSlotLevel = Math.max(1, getSpellLevelNumber(spell?.level));

    if (consumesSlot) {
      const chosenSlot = String(slotLevel || minimumSlotLevel);
      const maxSlots = Number(spellSlotMaxes[chosenSlot] || 0);
      if (maxSlots <= 0) {
        showCustomAlert('Sem espaço disponível', `Você não possui espaços de magia de nível ${chosenSlot}.`);
        return;
      }
      const used = Number(next.slots[chosenSlot] || 0);
      if (used >= maxSlots) {
        showCustomAlert('Espaço esgotado', `Todos os espaços de nível ${chosenSlot} já foram usados.`);
        return;
      }
      next.slots[chosenSlot] = used + 1;
      await saveMagicResources(next, `Usou ${spell?.name || 'magia'} com espaço ${chosenSlot}`);
      setSelectedSpell(null);
      return;
    }

    if (getCategory(spell) === 'Passiva') {
      showCustomAlert('Passiva', 'Esta habilidade é passiva e não consome recurso.');
      return;
    }

    const abilityKey = String(spell?.id || spell?.name || 'habilidade');
    const current = next.abilities[abilityKey] || { used: 0, max: 1, recharge: getAbilityRecharge(spell) };
    if (current.used >= current.max) {
      showCustomAlert('Uso esgotado', 'Esta habilidade já foi usada até a próxima recarga.');
      return;
    }
    next.abilities[abilityKey] = { ...current, used: current.used + 1, recharge: getAbilityRecharge(spell) };
    await saveMagicResources(next, `Usou habilidade ${spell?.name || abilityKey}`);
    setSelectedSpell(null);
  };

  const handleRestoreAbilityUse = async (spell: any) => {
    if (false && isLanPlayerControlledSheet) {
      showCustomAlert('Controle do mestre', 'Na mesa LAN, os usos de habilidade são ajustados pelo mestre.');
      return;
    }
    const abilityKey = String(spell?.id || spell?.name || 'habilidade');
    const next = normalizeMagicResourceState(magicResources);
    const current = next.abilities[abilityKey] || { used: 0, max: 1, recharge: getAbilityRecharge(spell) };
    next.abilities[abilityKey] = { ...current, used: Math.max(0, current.used - 1) };
    await saveMagicResources(next, `Restaurou habilidade ${spell?.name || abilityKey}`);
  };

  const handleXP = async (action: 'add' | 'remove') => {
    const amount = parseInt(inputValue) || 0;

    if (isLanPlayerControlledSheet) {
      await requestMasterApproval('PLAYER_REQUEST_XP', {
        amount: action === 'add' ? amount : -amount,
        action,
      }, `${action === 'add' ? 'Adicionar' : 'Remover'} ${amount} XP foi solicitado ao mestre.`);
      setXpModalVisible(false);
      setInputValue('');
      return;
    }

    let newXp = Math.max(0, action === 'add' ? character.xp + amount : character.xp - amount);
    
    const calcNewLevel = getExpectedLevelFromXp(newXp);

    if (calcNewLevel > character.level && action === 'add') {
      promptedLevelUpRef.current = `${character.id}:${character.level}:${calcNewLevel}`;
      setNewLevelData(calcNewLevel);
      setLevelUpModalVisible(true); 
    }
    
    updateDB({ xp: newXp });
    setXpModalVisible(false); 
    setInputValue('');
  };

  const handleHP = async (action: 'damage' | 'heal') => {
    const amount = parseInt(inputValue) || 0;

    if (isLanPlayerControlledSheet) {
      await requestMasterApproval('PLAYER_REQUEST_HP', {
        mode: action,
        amount,
      }, `${action === 'heal' ? 'Cura' : 'Dano'} de ${amount} PV foi solicitado ao mestre.`);
      setHpModalVisible(false);
      setInputValue('');
      return;
    }
    
    let newDisplayCurrent = action === 'damage' 
      ? Math.max(0, displayHpCurrent - amount) 
      : Math.min(displayHpMax, displayHpCurrent + amount);
      
    let newDbCurrent = newDisplayCurrent - hpBonusFromCon;
    
    updateDB({ hp_current: newDbCurrent });
    setHpModalVisible(false); 
    setInputValue('');
  };

  const handleTempBuffSubmit = async () => {
    let newStats = { ...character.stats };
    const val = parseInt(tempBuffValue) || 0;

    if (isLanPlayerControlledSheet) {
      await requestMasterApproval('PLAYER_REQUEST_ATTRIBUTE', {
        stat: activeBuffStat,
        amount: val,
        durationMode: 'temporary',
        durationUnit: 'turn',
        durationValue: 1,
      }, `Buff ${activeBuffStat} ${val >= 0 ? '+' : ''}${val} foi solicitado ao mestre.`);
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }

    if (val === 0) delete newStats.temp_mods[activeBuffStat];
    else newStats.temp_mods[activeBuffStat] = val;
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const clearTempBuff = async () => {
    let newStats = { ...character.stats };

    if (isLanPlayerControlledSheet) {
      const currentBuff = parseInt(newStats.temp_mods?.[activeBuffStat]) || 0;
      await requestMasterApproval('PLAYER_REQUEST_ATTRIBUTE', {
        stat: activeBuffStat,
        amount: -currentBuff,
        durationMode: 'temporary',
        durationUnit: 'turn',
        durationValue: 1,
      }, `Remover buff ${activeBuffStat} foi solicitado ao mestre.`);
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }

    delete newStats.temp_mods[activeBuffStat];
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const goToEditScreen = () => {
    setLevelUpModalVisible(false);
    router.push(`/edit?id=${character.id}&levelUpTo=${newLevelData}`);
  };

  const handleCoinSubmit = async () => {
    const nextValue = Math.max(0, parseInt(inputValue) || 0);
    const currentValue = Number(character[activeCoinType] || 0);
    const delta = nextValue - currentValue;

    if (isLanPlayerControlledSheet) {
      if (delta > 0) {
        await requestMasterApproval('PLAYER_REQUEST_COINS', {
          gp: activeCoinType === 'gp' ? delta : 0,
          sp: activeCoinType === 'sp' ? delta : 0,
          cp: activeCoinType === 'cp' ? delta : 0,
          coinType: activeCoinType,
          amount: delta,
        }, `Alteracao de moedas (${activeCoinType.toUpperCase()} ${delta >= 0 ? '+' : ''}${delta}) foi solicitada ao mestre.`);
      } else if (delta < 0) {
        await updateDB({ [activeCoinType]: nextValue });
      }
      setCoinModalVisible(false);
      setInputValue('');
      return;
    }

    updateDB({ [activeCoinType]: nextValue });
    setCoinModalVisible(false); setInputValue('');
  };

  const updateCoins = async (type: 'gp' | 'sp' | 'cp', delta: number) => {
    if (isLanPlayerControlledSheet && delta > 0) {
      await requestMasterApproval('PLAYER_REQUEST_COINS', {
        gp: type === 'gp' ? delta : 0,
        sp: type === 'sp' ? delta : 0,
        cp: type === 'cp' ? delta : 0,
        coinType: type,
        amount: delta,
      }, `Alteracao de moedas (${type.toUpperCase()} ${delta >= 0 ? '+' : ''}${delta}) foi solicitada ao mestre.`);
      return;
    }
    await updateDB({ [type]: Math.max(0, character[type] + delta) });
  };

  const executeCoinConversion = async (sourceAmount: number, targetAmount: number) => {
    if (isLanPlayerControlledSheet) {
      if (Number(character[convertFrom] || 0) >= sourceAmount) {
        await updateDB({
          [convertFrom]: character[convertFrom] - sourceAmount,
          [convertTo]: character[convertTo] + targetAmount
        });
        showCustomAlert("Cambio Realizado", `Voce converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`);
      } else {
        await requestMasterApproval('PLAYER_REQUEST_COINS', {
          gp: (convertFrom === 'gp' ? -sourceAmount : 0) + (convertTo === 'gp' ? targetAmount : 0),
          sp: (convertFrom === 'sp' ? -sourceAmount : 0) + (convertTo === 'sp' ? targetAmount : 0),
          cp: (convertFrom === 'cp' ? -sourceAmount : 0) + (convertTo === 'cp' ? targetAmount : 0),
          conversion: { from: convertFrom, to: convertTo, sourceAmount, targetAmount },
        }, 'Conversao de moedas solicitada ao mestre.');
      }
      setConvertModalVisible(false);
      setConvertAmount('');
      return;
    }

    updateDB({
      [convertFrom]: character[convertFrom] - sourceAmount,
      [convertTo]: character[convertTo] + targetAmount
    });
    setConvertModalVisible(false);
    setConvertAmount('');
    showCustomAlert("Câmbio Realizado", `Você converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`);
  };

  const buildEquipmentWithBagQtyDelta = (index: number, delta: number, baseEquipment = character.equipment) => {
    if (index < 0 || !baseEquipment?.bag?.[index]) return baseEquipment;
    const newBag = baseEquipment.bag.map((bagItem: any) => ({ ...bagItem }));
    newBag[index].qty = (Number(newBag[index].qty) || 0) + delta;
    const normalizedBag = newBag.filter((bagItem: any) => (Number(bagItem.qty) || 0) > 0);
    return { ...baseEquipment, bag: normalizedBag };
  };

  const isLanPlayerLockedInventory = () => activeSession?.role === 'player' && Boolean(activeSession.linked_character_id);

  const requestItemQuantityFromMaster = async (item: any, requestedDelta: number, currentQty = 0) => {
    await sendLanCommand('PLAYER_INVENTORY_UPDATE', {
      action: 'REQUEST_ITEM_QUANTITY_INCREASE',
      itemName: item?.name || 'Item',
      item,
      quantity: Math.abs(requestedDelta),
      requestedDelta,
      currentQty,
      requestedQty: currentQty + requestedDelta,
      characterName: character?.name || null,
      previousValue: { qty: currentQty },
      currentValue: { qty: currentQty + requestedDelta },
    });
    showCustomAlert(
      'Solicitacao enviada',
      `Voce pediu ao mestre +${Math.abs(requestedDelta)}x ${item?.name || 'item'}. A quantidade nao muda ate o mestre aprovar.`
    );
  };

  const updateBagQty = async (index: number, delta: number) => {
    const item = character.equipment?.bag?.[index];
    if (!item) return;

    if (delta > 0 && isLanPlayerLockedInventory()) {
      await requestItemQuantityFromMaster(item, delta, Number(item.qty) || 0);
      return;
    }

    updateDB({ equipment: buildEquipmentWithBagQtyDelta(index, delta) });
  };

  const addItemToBag = async (item: any) => {
    if (isLanPlayerLockedInventory()) {
      await requestItemQuantityFromMaster(item, 1, 0);
      setItemModalVisible(false);
      setItemSearch('');
      return;
    }

    let newBag = [...character.equipment.bag];
    const existingIndex = newBag.findIndex((i: any) => i.name === item.name);
    if (existingIndex > -1) newBag[existingIndex].qty += 1;
    else newBag.push({
      name: item.name,
      qty: 1,
      weight: item.weight,
      damage: item.damage,
      damage_type: item.damage_type,
      properties: item.properties,
      category: item.category,
      is_consumable: item.is_consumable,
      descricao: item.descricao,
    });
    updateDB({ equipment: { ...character.equipment, bag: newBag } });
    setItemModalVisible(false); setItemSearch('');
  };

  const getCatalogItem = (item: any) => dbItemsCatalog.find(cat => cat.name === item.name);
  const hydrateItem = (item: any) => ({ ...(getCatalogItem(item) || {}), ...(item || {}) });
  const isItemCompatibleWithSlot = (item: any, slot: EquipmentSlotKey | null) => {
    if (!slot) return false;
    const hydrated = hydrateItem(item);
    if (slot === 'armor') return isArmorItem(hydrated);
    if (slot === 'offHand') return isShieldItem(hydrated) || isWeaponItem(hydrated);
    if (slot === 'mainHand' || slot === 'ranged') return isWeaponItem(hydrated);
    return !isArmorItem(hydrated) && !isShieldItem(hydrated) && !isWeaponItem(hydrated);
  };

  const toEffectNumber = (value: unknown, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const traceSheetProcess = async (action: string, message: string, metadata?: Record<string, unknown>, functionName = 'SinglePlayerSheetScreen') => {
    try {
      await addTraceLog(db, {
        level: 'debug',
        category: 'sheet',
        action,
        functionName,
        sourceFile: 'src/features/character-sheet/single-player/SinglePlayerSheetScreen.tsx',
        step: action.toLowerCase(),
        entityTable: 'characters',
        entityId: character?.id,
        message,
        metadata,
      });
    } catch {
      // O tracer nao pode bloquear a ficha.
    }
  };

  const getStructuredItemEffects = async (item: any): Promise<ItemEffect[]> => {
    const catalogItem = getCatalogItem(item);
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM effects
       WHERE source_table = 'items'
         AND ((? > 0 AND source_id = ?) OR LOWER(TRIM(source_name)) = ?)
       ORDER BY sort_order ASC, id ASC`,
      [catalogItem?.id || Number(item?.id || 0) || 0, catalogItem?.id || Number(item?.id || 0) || 0, String(item?.name || '').trim().toLowerCase()]
    );
    const embeddedRows = Array.isArray(item?.effects)
      ? item.effects
      : Array.isArray(item?.structuredEffects)
        ? item.structuredEffects
        : [];
    const sourceRows = rows.length > 0 ? rows : embeddedRows;

    return sourceRows.map((row: any) => ({
      ...row,
      effect_kind: row.effect_kind,
      effect_type: row.effect_type,
      value_mode: row.value_mode || 'none',
      dice_count: row.dice_count === null || row.dice_count === undefined ? null : Number(row.dice_count),
      dice_sides: row.dice_sides === null || row.dice_sides === undefined ? null : Number(row.dice_sides),
      dice_bonus: Number(row.dice_bonus || 0),
      fixed_value: row.fixed_value === null || row.fixed_value === undefined ? null : Number(row.fixed_value),
      chance_percent: Number(row.chance_percent ?? 100),
      duration_value: row.duration_value === null || row.duration_value === undefined ? null : Number(row.duration_value),
      duration_unit: row.duration_unit || 'instant',
      condition_name: row.condition_name || null,
      target: row.target || null,
      notes: row.notes || null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
    })) as ItemEffect[];
  };

  const fixedAmount = (effect: ItemEffect, qty: number) =>
    effect.value_mode === 'fixed' ? toEffectNumber(effect.fixed_value, 0) * qty : 0;

  const applyStructuredItemEffects = async (
    item: any,
    qty: number,
    effects: ItemEffect[],
    chosenAttr?: string,
    rolledEffects: PendingRollEffect[] = [],
    consumeItem = true
  ) => {
    const newStats = { ...character.stats };
    if (!newStats.temp_mods) newStats.temp_mods = {};
    if (!newStats.equip_mods) newStats.equip_mods = {};
    if (!Array.isArray(newStats.timed_effects)) newStats.timed_effects = [];

    const dbUpdates: any = {};
    const msgParts: string[] = [];
    const rolledById = new Map(rolledEffects.map(entry => [entry.effect.id, Math.max(0, parseInt(entry.rolledValue) || 0)]));
    let workingDisplayHpCurrent = displayHpCurrent;
    let workingTempHp = tempHpValue;

    for (const effect of effects) {
      const chanceText = effect.chance_percent < 100 ? ` (${effect.chance_percent}% de chance)` : '';
      const isChooseAttr = effect.effect_kind === 'stat_modifier' && effect.effect_type === 'Escolher Atributo';
      const statKey = isChooseAttr ? chosenAttr : effect.effect_type;

      if (effect.effect_kind === 'stat_modifier' && statKey) {
        const totalVal = effect.value_mode === 'dice' ? (rolledById.get(effect.id) || 0) * qty : fixedAmount(effect, qty);
        if (totalVal !== 0) {
          if (effect.duration_unit === 'permanent') {
            if (statKey === 'CA') {
              newStats.temp_mods.CA = (parseInt(newStats.temp_mods.CA) || 0) + totalVal;
            } else {
              newStats[statKey] = String((parseInt(newStats[statKey]) || 10) + totalVal);
              newStats.extra_points = (parseInt(newStats.extra_points) || 0) + totalVal;
            }
            msgParts.push(`Atributo permanente: ${totalVal > 0 ? '+' + totalVal : totalVal} em ${statKey}.`);
          } else {
            newStats.temp_mods[statKey] = (parseInt(newStats.temp_mods[statKey]) || 0) + totalVal;
            msgParts.push(`Atributo temporario: ${totalVal > 0 ? '+' + totalVal : totalVal} em ${statKey}.`);
          }
        }
      }

      if (effect.effect_kind === 'healing') {
        const totalHeal = effect.value_mode === 'dice' ? (rolledById.get(effect.id) || 0) * qty : Math.abs(fixedAmount(effect, qty));
        if (totalHeal > 0) {
          workingDisplayHpCurrent = Math.min(displayHpMax, workingDisplayHpCurrent + totalHeal);
          dbUpdates.hp_current = workingDisplayHpCurrent - hpBonusFromCon;
          msgParts.push(`Cura aplicada: +${totalHeal} PV.`);
        }
      }

      if (effect.effect_kind === 'damage') {
        const totalDamage = effect.value_mode === 'dice' ? (rolledById.get(effect.id) || 0) * qty : Math.abs(fixedAmount(effect, qty));
        let remainingDamage = totalDamage;
        if (workingTempHp > 0 && remainingDamage > 0) {
          const absorbed = Math.min(workingTempHp, remainingDamage);
          workingTempHp -= absorbed;
          remainingDamage -= absorbed;
          newStats.timed_effects = workingTempHp <= 0
            ? newStats.timed_effects.filter((entry: any) => entry?.kind !== 'temp_hp')
            : consumeVisualTempHpEffects(newStats, absorbed).timed_effects;
        }
        if (remainingDamage > 0) {
          workingDisplayHpCurrent = Math.max(0, workingDisplayHpCurrent - remainingDamage);
          dbUpdates.hp_current = workingDisplayHpCurrent - hpBonusFromCon;
        }
        dbUpdates.hp_temp = workingTempHp;
        msgParts.push(`Dano aplicado: -${totalDamage} ${effect.effect_type}${chanceText}.`);
      }

      if (effect.effect_kind === 'condition') {
        const chance = Math.max(0, Math.min(100, Number(effect.chance_percent ?? 100)));
        const applied = chance >= 100 || Math.random() * 100 < chance;
        const metadata = effect.metadata || {};
        const conditionName = effect.condition_name || effect.effect_type;
        const duration = effect.duration_unit === 'instant' ? '' : ` por ${effect.duration_value || 1} ${effect.duration_unit}`;
        if (applied) {
          newStats.timed_effects.push({
            id: `item_${effect.id || conditionName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            kind: 'condition',
            label: conditionName,
            conditionName,
            description: String(metadata.condition_description || ''),
            color: String(metadata.condition_color || '#F4A84D'),
            source: item.name,
            durationUnit: effect.duration_unit,
            durationValue: effect.duration_value || 1,
            createdAt: new Date().toISOString(),
          });
          msgParts.push(`Efeito aplicado: ${conditionName}${duration}${chanceText}.`);
        } else {
          msgParts.push(`Efeito nao aplicado: ${conditionName}${chanceText}.`);
        }
      }
    }

    if (consumeItem) {
      const bagIndex = character.equipment.bag.findIndex((bagItem: any) => bagItem.name === item.name);
      dbUpdates.equipment = buildEquipmentWithBagQtyDelta(bagIndex, -qty);
    }
    dbUpdates.stats = newStats;
    await updateDB(dbUpdates);

    await traceSheetProcess(consumeItem ? 'ITEM_CONSUME' : 'ITEM_USE', `${consumeItem ? 'Consumiu' : 'Usou'} ${qty}x ${item.name}`, {
      item: item.name,
      qty,
      chosenAttr,
      effects: effects.map(effect => formatEffectSummary(effect)),
      rolledEffects,
      updates: dbUpdates,
    });

    setTimeout(() => {
      showCustomAlert('Efeito aplicado', msgParts.length > 0 ? msgParts.join('\n\n') : `Item usado: ${item.name}.`, [
        { text: 'OK', color: '#00bfff' },
      ]);
    }, 300);
  };

  const openRollValueModal = (effects: ItemEffect[], item: any, qty: number, chosenAttr?: string, consumeItem = true) => {
    setPendingRollEffects(effects.map(effect => ({ effect, item, qty, rolledValue: '' })));
    setPendingRollSummary(JSON.stringify({ item, qty, chosenAttr: chosenAttr || null, consumeItem }));
    setRollEffectsModalVisible(true);
  };

  const processConsumeItem = async (bagIndex: number, item: any, qty: number) => {
    const structuredEffects = await getStructuredItemEffects(item);
    if (structuredEffects.length > 0) {
      const chooseAttrEffect = structuredEffects.find(effect => effect.effect_kind === 'stat_modifier' && effect.effect_type === 'Escolher Atributo');
      const diceEffects = structuredEffects.filter(
        effect =>
          effect.value_mode === 'dice' &&
          (effect.effect_kind === 'damage' || effect.effect_kind === 'healing' || effect.effect_kind === 'stat_modifier')
      );
      const runStructured = (chosenAttr?: string) => {
        if (diceEffects.length > 0) {
          openRollValueModal(diceEffects, item, qty, chosenAttr);
          return;
        }
        applyStructuredItemEffects(item, qty, structuredEffects, chosenAttr);
      };

      if (chooseAttrEffect) {
        const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
          text: attr,
          color: '#00fa9a',
          onPress: () => runStructured(attr),
        }));

        showCustomAlert(
          `Consumir ${qty}x ${item.name}`,
          `Este item altera um atributo de sua escolha.\n\nValor: ${formatEffectSummary(chooseAttrEffect)}\n\nQual atributo deseja alterar?`,
          attrButtons
        );
        return;
      }

      showCustomAlert(`Consumir ${qty}x ${item.name}`, 'Confirmar consumo deste item e aplicar seus efeitos estruturados?', [
        { text: 'Cancelar', color: '#666' },
        { text: 'Consumir', color: '#00fa9a', onPress: () => runStructured() },
      ]);
      return;
    }

    const effect = item.damage && item.damage !== '-' ? item.damage : 'Efeito oculto';
    
    // Parse da tag "Escolher"
    const hasEscolher = effect.toLowerCase().includes('escolher');
    let escolherVal = 0;
    let escolherIsPerm = false;
    
    if (hasEscolher) {
      const escolherMatch = effect.match(/escolher\s*([+-]?\d+)/i);
      escolherVal = escolherMatch ? parseInt(escolherMatch[1]) : 1;
      escolherIsPerm = !/temp|tempor/i.test(effect) || effect.toLowerCase().includes('perm');
    }

    // Função interna que processa TUDO: O status escolhido (se tiver), as penalidades e curas.
    const executeConsumption = async (chosenAttr?: string) => {
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

      dbUpdates.equipment = buildEquipmentWithBagQtyDelta(bagIndex, -qty);
      dbUpdates.stats = newStats;
      if (Object.keys(dbUpdates).length > 0) await updateDB(dbUpdates);

      setTimeout(() => {
        showCustomAlert(
          "Efeito Aplicado!", 
          msgParts.join('\n\n'), 
          showHpModal 
            ? [ { text: 'OK', color: '#fff' }, { text: 'Ir para HP', color: '#00fa9a', onPress: openHpManager } ] 
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

  const handleRollEffectsSubmit = async () => {
    const first = pendingRollEffects[0];
    if (!first) {
      setRollEffectsModalVisible(false);
      return;
    }

    let chosenAttr: string | undefined;
    let consumeItem = true;
    try {
      const parsed = JSON.parse(pendingRollSummary || '{}');
      chosenAttr = parsed.chosenAttr || undefined;
      consumeItem = parsed.consumeItem !== false;
    } catch {
      chosenAttr = undefined;
    }

    const effects = await getStructuredItemEffects(first.item);
    await applyStructuredItemEffects(first.item, first.qty, effects, chosenAttr, pendingRollEffects, consumeItem);
    setRollEffectsModalVisible(false);
    setPendingRollEffects([]);
    setPendingRollSummary('');
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

  const handleEquipItem = async (itemToEquip: any) => {
    if (!activeSlot) return;
    const itemToEquipFull = itemToEquip ? hydrateItem(itemToEquip) : null;
    if (itemToEquipFull && !isItemCompatibleWithSlot(itemToEquipFull, activeSlot)) {
      showCustomAlert("Espaço incompatível", "Este item não combina com o espaço escolhido. Armaduras devem ir em Armadura, escudos na mão secundária e armas nos espaços de ataque.");
      return;
    }
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

    if (itemToEquipFull) {
      const props = itemToEquipFull.properties || '';
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

    if (itemToEquipFull) {
      const bagIdx = newBag.findIndex((i: any) => i.name === itemToEquipFull.name);
      if (bagIdx > -1) {
        newBag[bagIdx].qty -= 1;
        if (newBag[bagIdx].qty <= 0) newBag.splice(bagIdx, 1);
      }
      newSlots[activeSlot] = { ...itemToEquipFull, qty: 1 };

      const newBonuses = getEquipBonus(itemToEquipFull);
      for (const [stat, val] of Object.entries(newBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) + (val as number);
      }
    } else {
      newSlots[activeSlot] = null;
    }

    updateDB({ equipment: { bag: newBag, slots: newSlots }, stats: newStats });
    setSlotModalVisible(false);

    if (itemToEquipFull) {
      await traceSheetProcess('ITEM_EQUIP', `Equipou ${itemToEquipFull.name}`, { item: itemToEquipFull.name, slot: activeSlot });
      const effects = await getStructuredItemEffects(itemToEquipFull);
      const damageDiceEffects = effects.filter(effect => effect.effect_kind === 'damage' && effect.value_mode === 'dice');
      if (damageDiceEffects.length > 0) {
        openRollValueModal(damageDiceEffects, itemToEquipFull, 1, undefined, false);
      }
    }
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

  const renderLanSessionPanel = () => {
    if (!isLanPlayerControlledSheet) return null;

    const ownEffects = activeEffects.filter((effect: any) => effect?.kind !== 'temp_hp' || tempHpValue > 0);
    const rows = lanPanelPlayers.length > 0
      ? lanPanelPlayers
      : [{
          device_id: localDeviceId || 'local',
          player_name: character.name,
          character_id: character.id,
          character_name: character.name,
          connected: 1,
          snapshot_payload: JSON.stringify({
            localId: character.id,
            name: character.name,
            level: character.level,
            data: { hp_current: character.hp_current, hp_max: character.hp_max, hp_temp: character.hp_temp, level: character.level, avatar_uri: character.avatar_uri },
          }),
        }];

    return (
      <View style={styles.lanSessionBox}>
        <View style={styles.lanSessionHeader}>
          <View>
            <Text style={styles.lanSessionTitle}>SESSÃO LAN</Text>
            <Text style={styles.lanSessionHint}>Jogadores veem apenas vida e nível do grupo.</Text>
          </View>
          <Ionicons name="people-outline" size={22} color="#00bfff" />
        </View>

        <ScrollView style={styles.lanPlayersList} nestedScrollEnabled showsVerticalScrollIndicator={rows.length > 4}>
        {rows.map((player: any) => {
          const isSelf = isOwnLanPlayer(player);
          const snapshot = isSelf
            ? { name: character.name, level: character.level, hpCurrent: displayHpCurrent, hpMax: displayHpMax, hpTemp: tempHpValue, hpUnknown: false, avatarUri: String(character.avatar_uri || '') || avatarSourceForName(character.name) }
            : parseLanSnapshot(player);
          const percent = !snapshot.hpUnknown && snapshot.hpMax > 0 ? Math.max(0, Math.min(100, (snapshot.hpCurrent / snapshot.hpMax) * 100)) : 0;
          const dead = !snapshot.hpUnknown && snapshot.hpCurrent <= 0;
          return (
            <View key={`${player.device_id}-${player.character_id}`} style={styles.lanPlayerRow}>
              <Image source={{ uri: snapshot.avatarUri }} style={[styles.lanPlayerAvatar, !player.connected && styles.lanPlayerAvatarOffline]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.lanPlayerName} numberOfLines={1}>
                  {snapshot.name}{isSelf ? ' (você)' : ''}
                </Text>
                <Text style={styles.lanPlayerSub}>
                  {player.connected ? 'Ativo' : 'Offline'} • {snapshot.hpUnknown ? 'Sincronizando ficha' : `Nível ${snapshot.level}`}
                </Text>
              </View>
              <View style={styles.lanHpSide}>
                <Text style={[styles.lanHpText, dead && styles.lanHpDeadText]}>
                  {snapshot.hpUnknown ? '--/--' : dead ? '☠️' : `${snapshot.hpCurrent}/${snapshot.hpMax}${snapshot.hpTemp > 0 ? ` +${snapshot.hpTemp}` : ''}`}
                </Text>
                <View style={styles.lanHpTrack}>
                  <View style={[styles.lanHpFill, dead ? styles.lanHpFillDead : null, { width: `${dead ? 100 : percent}%` }]} />
                </View>
              </View>
            </View>
          );
        })}
        </ScrollView>

        {sheetTradeOffers.length > 0 && (
          <View style={styles.lanTradePendingList}>
            <Text style={styles.lanEffectsTitle}>TROCAS PENDENTES</Text>
            {sheetTradeOffers.map((event) => {
              const payload = (event.payload || {}) as any;
              const isCounter = event.eventType === 'TRADE_COUNTERED';
              const itemName = isCounter ? payload.offeredItemName || payload.offeredItem?.name || 'item' : payload.itemName || payload.item?.name || 'item';
              const qty = Math.max(1, Number(isCounter ? payload.offeredQuantity || 1 : payload.quantity || 1));
              const sourceName = isCounter ? payload.targetName || event.actorName || 'Personagem' : payload.sourceName || event.actorName || 'Personagem';
              return (
                <View key={event.commandId || event.eventId} style={styles.lanTradePendingCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lanTradePendingName} numberOfLines={1}>{sourceName}</Text>
                    <Text style={styles.lanEffectText} numberOfLines={2}>
                      {isCounter ? `Respondeu sua troca de ${qty}x ${itemName}.` : `Ofereceu ${qty}x ${itemName}.`}
                    </Text>
                  </View>
                  <View style={styles.lanTradeIconActions}>
                    <TouchableOpacity style={[styles.lanTradeIconButton, styles.lanTradeDeclineButton]} onPress={() => void respondToSheetTradeOffer(event, 'decline')}>
                      <Ionicons name="close" size={18} color="#ff6666" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.lanTradeIconButton, styles.lanTradeAcceptButton]} onPress={() => void respondToSheetTradeOffer(event, 'accept')}>
                      <Ionicons name="checkmark" size={18} color="#02112b" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.lanEffectsBox}>
          <Text style={styles.lanEffectsTitle}>SEUS EFEITOS</Text>
          {ownEffects.length > 0 ? (
            ownEffects.map((effect: any, index: number) => (
              <Text key={String(effect.id || index)} style={styles.lanEffectText}>• {effectLabel(effect)}</Text>
            ))
          ) : (
            <Text style={styles.lanEffectMuted}>Nenhum efeito ativo em você.</Text>
          )}
        </View>
      </View>
    );
  };

  const renderSheetTradeModal = () => {
    if (!sheetTradeModal) return null;
    const payload = (sheetTradeModal.payload || {}) as any;
    const isConfirmingCounter = sheetTradeModal.eventType === 'TRADE_COUNTERED';
    const offeredItemName = isConfirmingCounter
      ? payload.offeredItemName || payload.offeredItem?.name || 'item'
      : payload.itemName || payload.item?.name || 'item';
    const offeredQty = Math.max(1, tradeNumberValue(isConfirmingCounter ? payload.offeredQuantity || 1 : payload.quantity || 1, 1));
    const sourceName = payload.sourceName || sheetTradeModal.actorName || 'Personagem';
    const counterName = payload.targetName || sheetTradeModal.actorName || 'Personagem';
    const counterLabel = tradePartsLabel(payload.counterItem, Number(payload.counterQuantity || 0), payload.coins);
    const selectedItem = sheetTradeCounterItemIndex !== null ? sheetTradeCounterItems[sheetTradeCounterItemIndex] : null;
    const selectedMaxQty = Math.max(1, Number(selectedItem?.qty || 1));
    const selectedCounterLabel = tradePartsLabel(selectedItem, selectedItem ? Math.max(1, Math.min(Number(selectedItem.qty || 1), tradeNumberValue(sheetTradeCounterQty, 1))) : 0, {
      gp: tradeNumberValue(sheetTradeCoins.gp, 0),
      sp: tradeNumberValue(sheetTradeCoins.sp, 0),
      cp: tradeNumberValue(sheetTradeCoins.cp, 0),
    });

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setSheetTradeModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSheetTradeModal(null)}>
          <Pressable style={styles.sheetTradeBox} onPress={event => event.stopPropagation()}>
            <View style={styles.sheetTradeHeader}>
              <View style={styles.sheetTradeTitleWrap}>
                <Text style={styles.sheetTradeStepNumber}>{isConfirmingCounter ? '04' : '02'}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sheetTradeTitle}>{isConfirmingCounter ? 'Revisar contraproposta' : 'Proposta recebida'}</Text>
                  <Text style={styles.sheetTradeSubTitle}>
                    {isConfirmingCounter ? `${counterName} respondeu sua solicitação.` : `${sourceName} quer trocar com você.`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.sheetTradeClose} onPress={() => setSheetTradeModal(null)}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetTradeScroll} contentContainerStyle={styles.sheetTradeContent} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetTradeDividerRow}>
                <View style={styles.sheetTradeDividerLine} />
                <Ionicons name="swap-horizontal-outline" size={15} color="#c48a44" />
                <View style={styles.sheetTradeDividerLine} />
              </View>

              <View style={styles.sheetTradeBoard}>
                <View style={styles.sheetTradeSide}>
                  <Text style={styles.sheetTradeSideLabel}>{isConfirmingCounter ? 'VOCÊ ENVIA' : 'VOCÊ RECEBE'}</Text>
                  <View style={styles.sheetTradeSlotFilled}>
                    <Text style={styles.sheetTradeSlotItemName}>{offeredItemName}</Text>
                    <Text style={styles.sheetTradeSlotItemQty}>x{offeredQty}</Text>
                  </View>
                </View>

                <View style={styles.sheetTradeSide}>
                  <Text style={styles.sheetTradeSideLabel}>{isConfirmingCounter ? 'VOCÊ RECEBE' : 'VOCÊ ENVIA'}</Text>
                  <View style={isConfirmingCounter && counterLabel !== 'Nada' ? styles.sheetTradeSlotFilled : styles.sheetTradeSlotEmpty}>
                    <Text style={[styles.sheetTradeSlotItemName, !isConfirmingCounter && selectedCounterLabel === 'Nada' && styles.sheetTradeSlotMuted]}>
                      {isConfirmingCounter ? counterLabel : selectedCounterLabel}
                    </Text>
                  </View>
                </View>
              </View>

              {!isConfirmingCounter && (
                <>
                  <View style={styles.sheetTradeDividerRow}>
                    <View style={styles.sheetTradeDividerLine} />
                    <Text style={styles.sheetTradeDividerLabel}>ESCOLHA UM ITEM DA SUA MOCHILA</Text>
                    <View style={styles.sheetTradeDividerLine} />
                  </View>
                  <View style={styles.sheetTradeItemList}>
                    <TouchableOpacity
                      style={[styles.sheetTradeItemRow, sheetTradeCounterItemIndex === null && styles.sheetTradeItemRowActive]}
                      onPress={() => {
                        setSheetTradeCounterItemIndex(null);
                        setSheetTradeCounterQty('1');
                      }}
                    >
                      <View style={[styles.sheetTradeChoiceBullet, sheetTradeCounterItemIndex === null && styles.sheetTradeChoiceBulletActive]} />
                      <Text style={styles.sheetTradeItemName}>Nada</Text>
                      <Text style={styles.sheetTradeItemQty}>aceitar sem retorno</Text>
                    </TouchableOpacity>
                    {sheetTradeCounterItems.length === 0 ? (
                      <Text style={styles.lanEffectMuted}>Nenhum item disponivel.</Text>
                    ) : (
                      sheetTradeCounterItems.map((item, index) => (
                        <TouchableOpacity
                          key={`${item?.name || 'item'}-${index}`}
                          style={[styles.sheetTradeItemRow, sheetTradeCounterItemIndex === index && styles.sheetTradeItemRowActive]}
                          onPress={() => {
                            setSheetTradeCounterItemIndex(index);
                            setSheetTradeCounterQty('1');
                          }}
                        >
                          <View style={[styles.sheetTradeChoiceBullet, sheetTradeCounterItemIndex === index && styles.sheetTradeChoiceBulletActive]} />
                          <Text style={styles.sheetTradeItemName}>{item?.name || 'Item'}</Text>
                          <Text style={styles.sheetTradeItemQty}>x{Number(item?.qty || 1)}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>

                  {selectedItem && (
                    <>
                      <Text style={styles.sheetTradeLabel}>QUANTIDADE</Text>
                      <TextInput
                        style={styles.sheetTradeInput}
                        value={sheetTradeCounterQty}
                        onChangeText={value => setSheetTradeCounterQty(onlyPositiveIntegerText(value))}
                        onFocus={() => sheetTradeCounterQty === '1' && setSheetTradeCounterQty('')}
                        keyboardType="numeric"
                        placeholder={`1 a ${selectedMaxQty}`}
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        selectTextOnFocus
                      />
                    </>
                  )}

                  <View style={styles.sheetTradeDividerRow}>
                    <View style={styles.sheetTradeDividerLine} />
                    <Text style={styles.sheetTradeDividerLabel}>MOEDAS OPCIONAIS</Text>
                    <View style={styles.sheetTradeDividerLine} />
                  </View>
                  <View style={styles.sheetTradeCoinsRow}>
                    {(['gp', 'sp', 'cp'] as const).map(type => (
                      <View key={type} style={styles.sheetTradeCoinBox}>
                        <Text style={styles.sheetTradeCoinLabel}>{type.toUpperCase()}</Text>
                        <TextInput
                          style={styles.sheetTradeInput}
                          value={sheetTradeCoins[type]}
                          onChangeText={value => setSheetTradeCoins(prev => ({ ...prev, [type]: onlyPositiveIntegerText(value) }))}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="rgba(255,255,255,0.35)"
                          selectTextOnFocus
                        />
                      </View>
                    ))}
                  </View>
                </>
              )}

              <TouchableOpacity style={styles.sheetTradePrimaryButton} onPress={submitSheetTrade}>
                <Text style={styles.sheetTradePrimaryText}>{isConfirmingCounter ? 'ACEITAR TROCA' : 'ENVIAR CONTRAPROPOSTA'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetTradeDangerButton} onPress={() => void declineSheetTrade(sheetTradeModal)}>
                <Text style={styles.sheetTradeDangerText}>{isConfirmingCounter ? 'RECUSAR CONTRAPROPOSTA' : 'RECUSAR'}</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTradeFooterHint}>Toque fora do card ou no X para responder depois.</Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderTradeAlertModal = () => {
    if (!tradeAlertEvent) return null;
    const payload = (tradeAlertEvent.payload || {}) as any;
    const isCounter = tradeAlertEvent.eventType === 'TRADE_COUNTERED';
    const offeredItemName = isCounter
      ? payload.offeredItemName || payload.offeredItem?.name || 'item'
      : payload.itemName || payload.item?.name || 'item';
    const offeredQty = Math.max(1, tradeNumberValue(isCounter ? payload.offeredQuantity || 1 : payload.quantity || 1, 1));
    const sourceInfo = tradeParticipantInfo(tradeAlertEvent, isCounter ? 'target' : 'source');

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setTradeAlertEvent(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setTradeAlertEvent(null)}>
          <Pressable style={styles.sheetTradeAlertBox} onPress={event => event.stopPropagation()}>
            <View style={styles.sheetTradeAlertSender}>
              <Image source={{ uri: sourceInfo.avatarUri }} style={styles.sheetTradeAlertAvatar} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sheetTradeAlertOverline}>{isCounter ? 'CONTRAPROPOSTA DE' : 'PROPOSTA RECEBIDA DE'}</Text>
                <Text style={styles.sheetTradeAlertName} numberOfLines={1}>{sourceInfo.name}</Text>
                <Text style={styles.sheetTradeAlertMeta} numberOfLines={1}>
                  {[sourceInfo.race, sourceInfo.className, sourceInfo.level ? `Nível ${sourceInfo.level}` : ''].filter(Boolean).join(' • ')}
                </Text>
              </View>
            </View>

            <View style={styles.sheetTradeDividerRow}>
              <View style={styles.sheetTradeDividerLine} />
              <Ionicons name="swap-horizontal-outline" size={15} color="#c48a44" />
              <View style={styles.sheetTradeDividerLine} />
            </View>

            <Text style={styles.sheetTradeAlertNarrative}>
              {isCounter ? `${sourceInfo.name} respondeu sua solicitação.` : `${sourceInfo.name} quer trocar com você.`}
            </Text>

            <Text style={styles.sheetTradeSideLabel}>VOCÊ RECEBERÁ</Text>
            <View style={styles.sheetTradeAlertItemBox}>
              <Text style={styles.sheetTradeAlertItemName}>{offeredItemName}</Text>
              <Text style={styles.sheetTradeAlertItemQty}>x{offeredQty}</Text>
            </View>

            <View style={styles.sheetTradeAlertHint}>
              <Ionicons name="information-circle-outline" size={18} color="#fff" />
              <Text style={styles.sheetTradeAlertHintText}>Revise os itens e escolha como deseja responder.</Text>
            </View>

            <TouchableOpacity
              style={styles.sheetTradePrimaryButton}
              onPress={() => {
                setTradeAlertEvent(null);
                void openSheetTradeModal(tradeAlertEvent);
              }}
            >
              <Text style={styles.sheetTradePrimaryText}>{isCounter ? 'REVISAR CONTRAPROPOSTA' : 'ACEITAR E RESPONDER'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetTradeDangerButton}
              onPress={() => {
                const event = tradeAlertEvent;
                setTradeAlertEvent(null);
                void declineSheetTrade(event);
              }}
            >
              <Text style={styles.sheetTradeDangerText}>RECUSAR</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTradeFooterHint}>Toque fora do card para responder depois.</Text>
          </Pressable>
        </Pressable>
      </Modal>
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
    if (isShieldItem({ ...(dbItem || {}), ...item, properties: props })) return null;
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
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      {currentPulseEffect ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeEffectAura,
            {
              backgroundColor: String(currentPulseEffect.color),
              borderColor: String(currentPulseEffect.color),
              opacity: effectPulseAnim,
            },
          ]}
        />
      ) : null}
      {isDeadInLan ? (
        <View pointerEvents="none" style={styles.deathOverlay}>
          <Text style={styles.deathSkull}>☠️</Text>
          <Text style={styles.deathText}>você morreu</Text>
        </View>
      ) : null}
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => router.back()}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
        {(syncAdapter?.enabled || isLanPausedReadOnly) && (
          <TouchableOpacity
            style={[
              styles.topBarLanBadge,
              isLanBadgeWarning && styles.topBarLanBadgeWarning,
              isLanPausedReadOnly && styles.topBarLanBadgePaused,
            ]}
            onPress={handleTopLanBadgePress}
          >
            {isLanBadgeBusy ? (
              <ActivityIndicator size="small" color={isLanBadgeWarning ? '#ff6666' : '#00fa9a'} />
            ) : (
              <Ionicons
                name={isLanPausedReadOnly ? 'lock-closed-outline' : isLanBadgeWarning ? 'cloud-offline-outline' : 'wifi-outline'}
                size={14}
                color={isLanPausedReadOnly ? '#ffd166' : isLanBadgeWarning ? '#ff6666' : '#00fa9a'}
              />
            )}
            <Text style={[
              styles.topBarLanText,
              isLanBadgeWarning && styles.topBarLanTextWarning,
              isLanPausedReadOnly && styles.topBarLanTextPaused,
            ]}>
              {isLanPausedReadOnly ? 'PAUSADA' : 'LAN'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {isLanPausedReadOnly && (
        <View style={styles.readOnlyBanner}>
          <Ionicons name="lock-closed-outline" size={16} color="#ffd166" />
          <Text style={styles.readOnlyBannerText}>Mesa pausada pelo mestre. Ficha em modo leitura.</Text>
        </View>
      )}

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

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 44, 64) }]}>
        
        {/* ABA STATUS */}
        {activeTab === 'stats' && (
          <>
            {renderLanSessionPanel()}

            <View style={styles.headerBlock}>
              <View style={styles.sheetHeroRow}>
                <View style={styles.sheetAvatarFrame}>
                  <Image
                    source={{ uri: String(character.avatar_uri || '') || avatarSourceForName(character.name, 180) }}
                    style={styles.sheetAvatar}
                  />
                </View>

                <View style={styles.sheetHeroInfo}>
              <Text style={styles.charClassRace}>{character.race} • {character.class}</Text>
              
              <View style={styles.levelXpRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>Nv. {character.level}</Text></View>
                
                <TouchableOpacity style={styles.badge} onPress={openXpManager}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {XP_TABLE[character.level] || 'MAX'}</Text>
                </TouchableOpacity>

                {isPendingLevelUp && (
                  <TouchableOpacity style={styles.levelUpIconBtn} onPress={() => {setNewLevelData(expectedLevel); setLevelUpModalVisible(true);}}>
                    <Ionicons name="arrow-up" size={24} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
                </View>
              </View>
            </View>

            <TouchableOpacity style={[styles.combatBoxHp, hpBonusFromCon !== 0 && {borderColor: hpBonusFromCon > 0 ? '#00fa9a' : '#ff6666', borderWidth: 1}]} onPress={openHpManager}>
              <Text style={styles.hpValue}>
                {displayHpCurrent <= 0 ? '☠️' : `${displayHpCurrent}/${displayHpMax}${tempHpValue > 0 ? ` +${tempHpValue}` : ''}`}
              </Text>
              <Text style={styles.combatLabel}>
                PONTOS DE VIDA {hpBonusFromCon !== 0 && `(CON ${hpBonusFromCon > 0 ? '+' : ''}${hpBonusFromCon})`}
              </Text>
            </TouchableOpacity>

            {!isLanPlayerControlledSheet && activeEffects.length > 0 && (
              <View style={styles.activeEffectsBox}>
                <Text style={styles.activeEffectsTitle}>EFEITOS ATIVOS</Text>
                <View style={styles.activeEffectsWrap}>
                  {activeEffects.map((effect: any, index: number) => {
                    const effectColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(effect?.color || '')) ? String(effect.color) : '';
                    return (
                      <View key={String(effect.id || index)} style={[styles.activeEffectChip, effect.kind === 'temp_hp' && styles.activeEffectChipTempHp, effectColor ? { borderColor: effectColor } : null]}>
                        <Ionicons name={effect.kind === 'temp_hp' ? 'heart-circle-outline' : 'sparkles-outline'} size={13} color={effect.kind === 'temp_hp' ? '#00fa9a' : effectColor || '#ffd166'} />
                        <Text style={styles.activeEffectText} numberOfLines={1}>{effectLabel(effect)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

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
                <View style={styles.weightBar}><View style={[styles.weightFill, {width: `${Math.min((totalWeight/carryCap)*100, 100)}%`, backgroundColor: totalWeight > carryCap ? '#ff6666' : '#00bfff'}]} /></View>
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
                  const catItem = dbItemsCatalog.find(cat => cat.name === item.name);
                  const isConsumable = isConsumableItem(item, catItem);

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

            {(spellSlotLevels.length > 0 || Object.keys(magicResources.abilities).length > 0) && (
              <View style={styles.magicResourcePanel}>
                <View style={styles.magicResourceHeader}>
                  <Text style={styles.magicResourceTitle}>ESPAÇOS E RECURSOS</Text>
                  <TouchableOpacity style={styles.magicResetButton} onPress={() => handleResetMagicResources('all')}>
                    <Ionicons name="refresh-outline" size={14} color="#02112b" />
                    <Text style={styles.magicResetButtonText}>Resetar</Text>
                  </TouchableOpacity>
                </View>
                {spellSlotLevels.length > 0 && (
                  <View style={styles.magicSlotWrap}>
                    {spellSlotLevels.map(level => {
                      const max = Number(spellSlotMaxes[level] || 0);
                      const used = Math.min(max, Number(magicResources.slots[level] || 0));
                      return (
                        <View key={level} style={styles.magicSlotChip}>
                          <Text style={styles.magicSlotLabel}>NV {level}</Text>
                          <Text style={styles.magicSlotValue}>{max - used}/{max}</Text>
                          <TouchableOpacity style={styles.magicSlotAddButton} onPress={() => handleRestoreSpellSlot(level)}>
                            <Text style={styles.magicSlotAddText}>+1</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}
                {Object.entries(magicResources.abilities).length > 0 && (
                  <View style={styles.abilityUseSummary}>
                    {Object.entries(magicResources.abilities).map(([id, entry]) => {
                      const spell = spellDetails.find(candidate => String(candidate.id) === id);
                      return (
                        <Text key={id} style={styles.abilityUseSummaryText} numberOfLines={1}>
                          {spell?.name || 'Habilidade'}: {Math.max(0, entry.max - entry.used)}/{entry.max}
                        </Text>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

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

                  {getCategory(selectedSpell) !== 'Passiva' && (
                    <View style={styles.spellUsePanel}>
                      <View style={styles.magicResourceHeader}>
                        <Text style={styles.magicResourceTitle}>USO DO RECURSO</Text>
                        <TouchableOpacity style={styles.magicResetButton} onPress={() => handleResetMagicResources('all')}>
                          <Ionicons name="refresh-outline" size={14} color="#02112b" />
                          <Text style={styles.magicResetButtonText}>Resetar</Text>
                        </TouchableOpacity>
                      </View>

                      {spellUsesSlot(selectedSpell) ? (
                        <View style={styles.spellCastButtonGrid}>
                          {spellSlotLevels
                            .filter(level => Number(level) >= Math.max(1, getSpellLevelNumber(selectedSpell.level)))
                            .map(level => {
                              const max = Number(spellSlotMaxes[level] || 0);
                              const used = Math.min(max, Number(magicResources.slots[level] || 0));
                              const remaining = max - used;
                              return (
                                <TouchableOpacity
                                  key={level}
                                  style={[styles.spellCastButton, remaining <= 0 && styles.spellCastButtonDisabled]}
                                  disabled={remaining <= 0}
                                  onPress={() => handleUseSpellResource(selectedSpell, Number(level))}
                                >
                                  <Text style={styles.spellCastButtonText}>USAR NV {level}</Text>
                                  <Text style={styles.spellCastButtonSub}>{remaining}/{max}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          {spellSlotLevels.filter(level => Number(level) >= Math.max(1, getSpellLevelNumber(selectedSpell.level))).length === 0 && (
                            <Text style={styles.emptyText}>Nenhum espaço compatível disponível.</Text>
                          )}
                        </View>
                      ) : (
                        (() => {
                          const abilityKey = String(selectedSpell?.id || selectedSpell?.name || 'habilidade');
                          const entry = magicResources.abilities[abilityKey] || { used: 0, max: 1, recharge: getAbilityRecharge(selectedSpell) };
                          const remaining = Math.max(0, entry.max - entry.used);
                          return (
                            <View>
                              <Text style={styles.spellResourceHint}>
                                Usos: {remaining}/{entry.max} / recarga: {entry.recharge === 'turn' ? 'turno' : entry.recharge === 'short_rest' ? 'descanso curto' : 'descanso longo'}
                              </Text>
                              <View style={styles.spellCastButtonGrid}>
                                <TouchableOpacity
                                  style={[styles.spellCastButton, remaining <= 0 && styles.spellCastButtonDisabled]}
                                  disabled={remaining <= 0}
                                  onPress={() => handleUseSpellResource(selectedSpell)}
                                >
                                  <Text style={styles.spellCastButtonText}>USAR</Text>
                                  <Text style={styles.spellCastButtonSub}>{remaining}/{entry.max}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.spellCastButtonSecondary} onPress={() => handleRestoreAbilityUse(selectedSpell)}>
                                  <Text style={styles.spellCastButtonText}>+1 USO</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })()
                      )}
                    </View>
                  )}

                  <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
                  <ScrollView style={{maxHeight: 250, marginTop: 5, backgroundColor: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 12}}>
                    <Text style={styles.spellDetailDescription}>{selectedSpell.description}</Text>
                  </ScrollView>

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
              <TextInput style={[styles.modalInputLarge, {width: '80%', marginBottom: 5}]} keyboardType="numeric" value={convertAmount} onChangeText={value => setConvertAmount(onlyPositiveIntegerText(value))} placeholder="0" placeholderTextColor="#666" autoFocus selectTextOnFocus textAlign="center" />
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
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" placeholder="Ex: +2" placeholderTextColor="rgba(255,255,255,0.2)" value={tempBuffValue} onChangeText={value => setTempBuffValue(onlySignedIntegerText(value))} autoFocus selectTextOnFocus textAlign="center" />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={clearTempBuff}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Limpar (0)</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleTempBuffSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>Aplicar Buff</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={rollEffectsModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setRollEffectsModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Informar valor do dado</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 15, fontSize: 13 }}>
              Digite o resultado final rolado para cada efeito. O valor será aplicado ao consumir o item.
            </Text>

            {pendingRollEffects.map((entry, index) => (
              <View key={`${entry.effect.id || index}`} style={{ marginBottom: 12 }}>
                <Text style={styles.rollEffectLabel}>{formatEffectSummary(entry.effect)}</Text>
                <TextInput
                  style={styles.modalInputLarge}
                  keyboardType="numeric"
                  placeholder="Resultado rolado"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={entry.rolledValue}
                  onChangeText={value => {
                    const next = [...pendingRollEffects];
                    next[index] = { ...next[index], rolledValue: onlySignedIntegerText(value) };
                    setPendingRollEffects(next);
                  }}
                  selectTextOnFocus
                  textAlign="center"
                />
              </View>
            ))}

            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setRollEffectsModalVisible(false)}>
                <Text style={{ color: '#ff6666', fontWeight: 'bold' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleRollEffectsSubmit}>
                <Text style={{ color: '#00fa9a', fontWeight: 'bold' }}>Aplicar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Modal de Acoes do Item na Mochila */}
      <Modal visible={!!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedBagItem(null)}>
          <View style={styles.actionModalBox}>
            {selectedBagItem && (() => {
              const catItem = dbItemsCatalog.find(i => i.name === selectedBagItem.item.name);
              const itemLore = catItem?.descricao || '';
              const isConsumable = isConsumableItem(selectedBagItem.item, catItem);

              return (
              <>
                <ScrollView style={styles.actionModalScroll} contentContainerStyle={styles.actionModalContent} showsVerticalScrollIndicator={false}>
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

                  {isLanPlayerControlledSheet && (
                    <>
                      <TouchableOpacity style={styles.actionBtnSend} onPress={() => {
                        const {item} = selectedBagItem;
                        const qty = actionQty;
                        setSelectedBagItem(null);
                        showLanItemTargetPicker('send', item, qty);
                      }}>
                        <Ionicons name="arrow-redo-outline" size={20} color="#00bfff" />
                        <Text style={styles.actionBtnSendText}>Enviar para jogador</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.actionBtnTrade} onPress={() => {
                        const {item} = selectedBagItem;
                        const qty = actionQty;
                        setSelectedBagItem(null);
                        showLanItemTargetPicker('trade', item, qty);
                      }}>
                        <Ionicons name="swap-horizontal" size={20} color="#ffd166" />
                        <Text style={styles.actionBtnTradeText}>Propor troca</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setSelectedBagItem(null)}>
                    <Text style={styles.actionBtnCancelText}>Voltar</Text>
                  </TouchableOpacity>
                </View>
                </ScrollView>
              </>
            )})()}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!lanTargetPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setLanTargetPicker(null)}>
          <View style={styles.lanTargetPickerBox}>
            <Text style={styles.modalTitle}>{lanTargetPicker?.mode === 'send' ? 'Enviar para quem?' : 'Trocar com quem?'}</Text>
            <Text style={styles.lanTargetPickerSub}>{lanTargetPicker?.qty || 1}x {lanTargetPicker?.item?.name || 'item'}</Text>
            <ScrollView style={styles.lanTargetPickerList} showsVerticalScrollIndicator={false}>
              {lanTradeTargets.map((target: any) => {
                const snapshot = parseLanSnapshot(target);
                const targetName = snapshot.name || lanTargetName(target);
                return (
                  <TouchableOpacity
                    key={`${target.device_id}-${target.character_id}`}
                    style={styles.lanTargetRow}
                    onPress={() => {
                      const current = lanTargetPicker;
                      setLanTargetPicker(null);
                      if (!current) return;
                      void (current.mode === 'send'
                        ? sendItemToLanPlayer(target, current.item, current.qty)
                        : offerTradeToLanPlayer(target, current.item, current.qty));
                    }}
                  >
                    <Image source={{ uri: snapshot.avatarUri }} style={[styles.lanTargetAvatar, !target.connected && styles.lanPlayerAvatarOffline]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lanTargetName} numberOfLines={1}>{targetName}</Text>
                      <Text style={styles.lanTargetSub} numberOfLines={1}>
                        Nv. {snapshot.hpUnknown ? '?' : snapshot.level} / {target.connected ? 'Ativo' : 'Offline'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setLanTargetPicker(null)}>
              <Text style={styles.actionBtnCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={slotModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSlotModalVisible(false)}>
            <View style={[styles.modalContent, {height: '60%'}]}>
                <Text style={styles.modalTitle}>O que deseja equipar?</Text>
                <TouchableOpacity style={styles.unequipBtn} onPress={() => handleEquipItem(null)}><Text style={styles.unequipBtnText}>[ Limpar Espaço ]</Text></TouchableOpacity>
                <FlatList
                    data={(character?.equipment?.bag || []).filter((item: any) => isItemCompatibleWithSlot(item, activeSlot))}
                    keyExtractor={(i, idx) => idx.toString()}
                    renderItem={({item}) => {
                      const hydratedItem = hydrateItem(item);
                      const itemDamage = hydratedItem.damage;
                      const itemDamageType = hydratedItem.damage_type;
                      const itemProps = hydratedItem.properties;
                      
                      let subText = `Peso: ${hydratedItem.weight || item.weight}kg`;
                      if (itemDamage && itemDamage !== '-') subText = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''} • ${subText}`;
                      else if (itemProps && itemProps !== '-') subText = `✨ ${itemProps.split(',')[0]} • ${subText}`;

                      return (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => handleEquipItem(item)}>
                            <View style={{flex: 1}}><Text style={styles.catalogItemName}>{item.name}</Text><Text style={styles.catalogItemSub}>{subText}</Text></View>
                            <Text style={styles.addIcon}>›</Text>
                        </TouchableOpacity>
                      )
                    }}
                    ListEmptyComponent={<Text style={styles.emptyText}>Nenhum item compatível na mochila.</Text>}
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
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={value => setInputValue(onlyPositiveIntegerText(value))} autoFocus selectTextOnFocus textAlign="center" />
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
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={value => setInputValue(onlyPositiveIntegerText(value))} autoFocus selectTextOnFocus textAlign="center" />
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
      {renderTradeAlertModal()}
      {renderSheetTradeModal()}

      <Modal visible={customAlert.visible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}>
          <Pressable style={styles.customAlertBox} onPress={event => event.stopPropagation()}>
            <Text style={styles.customAlertTitle}>{customAlert.title}</Text>
            <Text style={styles.customAlertMessage}>{customAlert.message}</Text>
            
            <ScrollView style={styles.customAlertScroll} contentContainerStyle={styles.customAlertBtnRow} showsVerticalScrollIndicator={false}>
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
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
        <DiceRoller3D/>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  activeEffectAura: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    borderWidth: 4,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#02112b' },
  errorText: { color: '#ff6666', fontWeight: 'bold' },
  topBar: { paddingTop: 60, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)', position: 'relative' },
  topBarBack: { position: 'absolute', left: 20, bottom: 12, padding: 5, zIndex: 10 },
  topBarBackText: { color: '#00bfff', fontSize: 16, fontWeight: 'bold' },
  topBarLanBadge: { position: 'absolute', right: 20, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,250,154,0.12)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.35)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  topBarLanBadgeWarning: { backgroundColor: 'rgba(255,102,102,0.13)', borderColor: 'rgba(255,102,102,0.42)' },
  topBarLanBadgePaused: { backgroundColor: 'rgba(255,209,102,0.13)', borderColor: 'rgba(255,209,102,0.4)' },
  topBarLanText: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold' },
  topBarLanTextWarning: { color: '#ff6666' },
  topBarLanTextPaused: { color: '#ffd166' },
  topBarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: 'rgba(255,209,102,0.1)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,209,102,0.22)' },
  readOnlyBannerText: { color: '#ffd166', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  
  tabContainer: { paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tab: { paddingVertical: 12, paddingHorizontal: 15, alignItems: 'center', marginRight: 10 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#00bfff' },
  tabText: { color: 'rgba(255,255,255,0.4)', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 },
  activeTabText: { color: '#00bfff' },
  
  scrollContent: { padding: 20 },
  
  headerBlock: { marginBottom: 20 },
  sheetHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  sheetHeroInfo: { flex: 1, minWidth: 0 },
  sheetAvatarFrame: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 3,
    backgroundColor: 'rgba(0,191,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.45)',
    shadowColor: '#00bfff',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  sheetAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 36,
    backgroundColor: '#102b56',
  },
  charClassRace: { fontSize: 14, color: '#00bfff' },
  levelXpRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10, alignItems: 'center' },
  badge: { backgroundColor: 'rgba(0,191,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  badgeText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
  
  levelUpIconBtn: { paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center' },

  combatBoxHp: { backgroundColor: 'rgba(255,50,50,0.1)', padding: 20, borderRadius: 20, alignItems: 'center', marginBottom: 15 },
  hpValue: { fontSize: 36, fontWeight: 'bold', color: '#ff6666' },
  hpMax: { fontSize: 20, color: 'rgba(255,102,102,0.4)' },
  combatLabel: { fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 5, letterSpacing: 1, fontWeight: 'bold' },
  activeEffectsBox: { borderRadius: 16, padding: 12, marginBottom: 15, backgroundColor: 'rgba(255,209,102,0.08)', borderWidth: 1, borderColor: 'rgba(255,209,102,0.24)' },
  activeEffectsTitle: { color: '#ffd166', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8 },
  activeEffectsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  activeEffectChip: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(255,209,102,0.1)', borderWidth: 1, borderColor: 'rgba(255,209,102,0.25)' },
  activeEffectChipTempHp: { backgroundColor: 'rgba(0,250,154,0.1)', borderColor: 'rgba(0,250,154,0.28)' },
  activeEffectText: { color: '#fff', fontSize: 11, fontWeight: 'bold', flexShrink: 1 },
  combatStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  combatStatSmall: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 15, alignItems: 'center' },
  combatStatValue: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
  
  sectionTitle: { color: '#00bfff', fontWeight: 'bold', marginTop: 10, marginBottom: 10, fontSize: 12 },
  attributesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  attrBox: { width: '31%', backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 15, alignItems: 'center', marginBottom: 15 },
  attrLabel: { fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 5 },
  attrValue: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  modBadge: { backgroundColor: '#00bfff', paddingHorizontal: 8, borderRadius: 6, marginTop: 5 },
  modText: { fontSize: 12, fontWeight: 'bold', color: '#02112b' },
  
  cardBlock: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 15, marginTop: 5, marginBottom: 15 },
  detailSection: { marginBottom: 15 },
  detailLabel: { fontSize: 10, color: 'rgba(0,191,255,0.5)', fontWeight: 'bold', marginBottom: 5 },
  detailText: { color: '#fff', fontSize: 14, lineHeight: 20 },

  profRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  profStatBadge: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, marginRight: 10, width: 35, alignItems: 'center' },
  profIconActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00bfff', marginRight: 10 },
  profName: { color: '#fff', fontSize: 13 },
  profValue: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  weightCard: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 15, marginBottom: 15, alignItems: 'center' },
  weightVal: { fontSize: 18, color: '#fff', fontWeight: 'bold', marginTop: 5 },
  weightBar: { width: '100%', height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 5 },
  weightFill: { height: '100%', borderRadius: 2 },
  atkCard: { backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 16, alignItems: 'center', marginBottom: 10 },
  atkRow: { flexDirection: 'row', marginTop: 10, gap: 40 },
  atkSubBox: { alignItems: 'center' },
  atkVal: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  atkLab: { fontSize: 8, color: '#00bfff', fontWeight: 'bold', marginTop: 3 },
  
  equipGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
  equipSlotBox: { width: '48%', backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 15, alignItems: 'center', justifyContent: 'center', height: 95 },
  equipSlotBoxFilled: { borderColor: '#00bfff', backgroundColor: 'rgba(0,191,255,0.05)' },
  equipSlotLabel: { fontSize: 8, color: 'rgba(255,255,255,0.5)', position: 'absolute', top: 8, left: 8, fontWeight: 'bold' },
  equipSlotEmptyIcon: { fontSize: 30, opacity: 0.2 },
  equipSlotItemName: { color: '#fff', fontWeight: 'bold', textAlign: 'center', fontSize: 13, marginTop: 5 },
  equipSlotItemDamage: { color: '#00fa9a', fontSize: 10, marginTop: 5, fontWeight: 'bold' },

  coinManager: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'stretch' },
  coinControl: { flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, alignItems: 'center', justifyContent: 'space-between' },
  coinDisplay: { alignItems: 'center', justifyContent: 'center', minHeight: 56, marginVertical: 5, width: '100%' },
  coinLabel: { fontSize: 10, fontWeight: 'bold' },
  coinValText: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  coinBtn: { width: '100%', paddingVertical: 5, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  qtyBtnText: { color: '#00bfff', fontSize: 20, fontWeight: 'bold' },
  headerSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn: { backgroundColor: '#00bfff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#02112b', fontWeight: 'bold', fontSize: 11 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 15 },
  itemQty: { color: '#fff', fontWeight: 'bold', width: 15, textAlign: 'center', fontSize: 14 },
  smallQtyBtn: { width: 28, height: 28, backgroundColor: 'rgba(0,191,255,0.1)', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  smallQtyBtnText: { color: '#00bfff', fontSize: 16, fontWeight: 'bold' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  itemSubDetail: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 },
  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginVertical: 20, fontSize: 12 },

  // BOTÕES DA MOCHILA E AÇÕES
  iconActionBtn: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(0,250,154,0.1)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)', justifyContent: 'center', alignItems: 'center' },

  itemStatsBox: { backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  itemStatText: { color: '#00fa9a', fontSize: 13, marginBottom: 5, fontWeight: 'bold' },

  spellFilterSection: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 20, marginBottom: 15 },
  spellSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  spellSearchInputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12, paddingHorizontal: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  spellSearchInput: { flex: 1, color: '#fff', paddingVertical: 10, marginLeft: 10, fontSize: 14 },
  spellSortBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,191,255,0.1)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', gap: 5 },
  spellSortText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  filterLabel: { fontSize: 10, color: '#00bfff', fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 },
  filterPill: { paddingVertical: 6, paddingHorizontal: 15, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterPillActive: { backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff' },
  filterPillText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold' },
  filterPillTextActive: { color: '#00bfff' },

  // NOVOS ESTILOS COMPACTOS PARA MAGIAS E MODAL
  spellGroupHeader: { color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', fontSize: 14, letterSpacing: 1 },
  spellCardCompact: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', flex: 1 },
  spellIconBox: { width: 45, height: 45, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  spellNameCompact: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  spellSubCompact: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  
  spellDetailCard: { backgroundColor: '#102b56', borderRadius: 24, padding: 25, width: '90%', borderWidth: 1, borderColor: '#00bfff', alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  spellDetailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  spellDetailIcon: { width: 50, height: 50, borderRadius: 15, backgroundColor: '#00bfff', justifyContent: 'center', alignItems: 'center' },
  spellDetailName: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 2 },
  spellDetailLevel: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  spellDetailInfoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 12 },
  spellDetailInfoItem: { alignItems: 'center', flex: 1 },
  spellDetailInfoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4 },
  spellDetailInfoValue: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  spellDetailDescription: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 22 },
  magicResourcePanel: { backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.25)', borderRadius: 14, padding: 12, marginTop: 10, marginBottom: 8 },
  magicResourceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  magicResourceTitle: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  magicResetButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#00bfff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  magicResetButtonText: { color: '#02112b', fontSize: 11, fontWeight: 'bold' },
  magicSlotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  magicSlotChip: { minWidth: 74, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  magicSlotLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 'bold' },
  magicSlotValue: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  magicSlotAddButton: { marginTop: 6, alignItems: 'center', backgroundColor: 'rgba(0,250,154,0.16)', borderRadius: 7, paddingVertical: 4 },
  magicSlotAddText: { color: '#00fa9a', fontSize: 11, fontWeight: 'bold' },
  abilityUseSummary: { marginTop: 10, gap: 4 },
  abilityUseSummaryText: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  spellUsePanel: { backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.22)', borderRadius: 12, padding: 12, marginBottom: 15 },
  spellCastButtonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spellCastButton: { flexGrow: 1, minWidth: 92, alignItems: 'center', backgroundColor: '#00fa9a', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  spellCastButtonSecondary: { flexGrow: 1, minWidth: 92, alignItems: 'center', backgroundColor: 'rgba(0,191,255,0.2)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(0,191,255,0.4)' },
  spellCastButtonDisabled: { opacity: 0.45 },
  spellCastButtonText: { color: '#02112b', fontSize: 12, fontWeight: 'bold' },
  spellCastButtonSub: { color: 'rgba(2,17,43,0.7)', fontSize: 11, marginTop: 2, fontWeight: 'bold' },
  spellResourceHint: { color: 'rgba(255,255,255,0.72)', fontSize: 12, marginBottom: 10 },

  // NOVOS ESTILOS PARA CÂMBIO DE MOEDAS
  exchangeBox: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', padding: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  exchangeSide: { alignItems: 'center', flex: 1 },
  exchangeLabel: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 },
  exchangeCoins: { flexDirection: 'row', gap: 5 },
  coinMiniBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.02)' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#102b56', width: '100%', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  rollEffectLabel: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8 },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, color: '#fff', fontSize: 16, marginBottom: 15 },
  modalInputLarge: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, color: '#fff', fontSize: 24, textAlign: 'center', marginBottom: 15, fontWeight: 'bold' },
  modalRowButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 15 },
  
  lvlUpBtnPrimary: { backgroundColor: '#00bfff', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lvlUpBtnPrimaryText: { color: '#000000', fontWeight: 'bold', fontSize: 16 }, 
  lvlUpBtnSecondary: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  lvlUpBtnSecondaryText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },

  catalogItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  catalogItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  catalogItemSub: { color: 'rgba(0,191,255,0.5)', fontSize: 12, marginTop: 2 },
  addIcon: { color: '#00bfff', fontSize: 24, fontWeight: 'bold' },
  unequipBtn: { backgroundColor: 'rgba(255,50,50,0.1)', padding: 10, borderRadius: 10, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,50,50,0.3)' },
  unequipBtnText: { color: '#ff6666', fontWeight: 'bold', fontSize: 12 },

  actionModalBox: { backgroundColor: '#02112b', width: '85%', maxHeight: '86%', borderRadius: 25, padding: 0, borderWidth: 1, borderColor: '#00bfff', overflow: 'hidden' },
  actionModalScroll: { width: '100%' },
  actionModalContent: { padding: 25 },
  actionQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 10 },
  actionQtyBtn: { backgroundColor: 'rgba(255,255,255,0.1)', width: 45, height: 45, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionQtyBtnText: { color: '#00bfff', fontSize: 26, fontWeight: 'bold' },
  actionQtyVal: { color: '#fff', fontSize: 28, fontWeight: 'bold', width: 50, textAlign: 'center' },
  
  actionBtnConsume: { flexDirection: 'row', backgroundColor: 'rgba(0,250,154,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)', gap: 10 },
  actionBtnConsumeText: { color: '#00fa9a', fontWeight: 'bold', fontSize: 16 },
  actionBtnThrow: { flexDirection: 'row', backgroundColor: 'rgba(255,100,100,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,100,100,0.3)', gap: 10 },
  actionBtnThrowText: { color: '#ff6666', fontWeight: 'bold', fontSize: 16 },
  actionBtnSend: { flexDirection: 'row', backgroundColor: 'rgba(0,191,255,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', gap: 10 },
  actionBtnSendText: { color: '#00bfff', fontWeight: 'bold', fontSize: 16 },
  actionBtnTrade: { flexDirection: 'row', backgroundColor: 'rgba(255,209,102,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,209,102,0.35)', gap: 10 },
  actionBtnTradeText: { color: '#ffd166', fontWeight: 'bold', fontSize: 16 },
  actionBtnCancel: { paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionBtnCancelText: { color: 'rgba(255,255,255,0.5)', fontWeight: 'bold', fontSize: 14 },

  sheetTradeBox: { backgroundColor: '#06182f', width: '92%', maxHeight: '86%', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(196,138,68,0.58)', overflow: 'hidden', shadowColor: '#00d7ff', shadowOpacity: 0.22, shadowRadius: 18, elevation: 10 },
  sheetTradeHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(196,138,68,0.18)' },
  sheetTradeTitleWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetTradeStepNumber: { color: '#66e8ff', fontSize: 22, fontWeight: 'bold', textShadowColor: 'rgba(102,232,255,0.75)', textShadowRadius: 8 },
  sheetTradeTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold', letterSpacing: 0.2 },
  sheetTradeSubTitle: { color: 'rgba(255,255,255,0.66)', fontSize: 12, lineHeight: 17, marginTop: 3 },
  sheetTradeClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sheetTradeScroll: { width: '100%' },
  sheetTradeContent: { padding: 16 },
  sheetTradeHint: { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
  sheetTradeDividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  sheetTradeDividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(196,138,68,0.38)' },
  sheetTradeDividerLabel: { color: '#c48a44', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.7, textAlign: 'center' },
  sheetTradeBoard: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  sheetTradeSide: { flex: 1, minWidth: 0, gap: 8, borderRadius: 12, padding: 10, backgroundColor: 'rgba(3,15,31,0.82)', borderWidth: 1, borderColor: 'rgba(196,138,68,0.28)' },
  sheetTradeSideLabel: { color: '#8df5b2', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.7, textAlign: 'center' },
  sheetTradeSlotFilled: { minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: 'rgba(0,191,255,0.06)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.28)' },
  sheetTradeSlotEmpty: { minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  sheetTradeSlotItemName: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center', lineHeight: 18 },
  sheetTradeSlotItemQty: { color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  sheetTradeSlotMuted: { color: 'rgba(255,255,255,0.52)' },
  sheetTradeLabel: { color: '#c48a44', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8, marginTop: 8 },
  sheetTradeItemList: { gap: 8, marginBottom: 10 },
  sheetTradeItemRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.20)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  sheetTradeItemRowActive: { backgroundColor: 'rgba(0,191,255,0.14)', borderColor: 'rgba(0,191,255,0.55)' },
  sheetTradeChoiceBullet: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.38)', backgroundColor: 'transparent' },
  sheetTradeChoiceBulletActive: { borderColor: '#66e8ff', backgroundColor: '#00bfff', shadowColor: '#00d7ff', shadowOpacity: 0.45, shadowRadius: 6 },
  sheetTradeItemName: { flex: 1, color: '#fff', fontSize: 13, fontWeight: 'bold' },
  sheetTradeItemQty: { color: 'rgba(255,255,255,0.58)', fontSize: 12, fontWeight: 'bold' },
  sheetTradeInput: { backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15, textAlign: 'center' },
  sheetTradeCoinsRow: { flexDirection: 'row', gap: 8 },
  sheetTradeCoinBox: { flex: 1, minWidth: 0 },
  sheetTradeCoinLabel: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
  sheetTradePrimaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#00fa9a', marginTop: 14 },
  sheetTradePrimaryText: { color: '#02112b', fontSize: 14, fontWeight: 'bold' },
  sheetTradeDangerButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,102,102,0.1)', borderWidth: 1, borderColor: 'rgba(255,102,102,0.35)', marginTop: 10 },
  sheetTradeDangerText: { color: '#ff6666', fontSize: 13, fontWeight: 'bold' },
  sheetTradeFooterHint: { color: '#8bdcff', fontSize: 12, textAlign: 'center', marginTop: 14, fontWeight: 'bold', letterSpacing: 0.3 },
  sheetTradeAlertBox: { backgroundColor: '#06182f', width: '90%', maxHeight: '86%', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: 'rgba(196,138,68,0.58)', shadowColor: '#00d7ff', shadowOpacity: 0.22, shadowRadius: 18, elevation: 10 },
  sheetTradeAlertSender: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sheetTradeAlertAvatar: { width: 66, height: 66, borderRadius: 33, borderWidth: 1, borderColor: 'rgba(196,138,68,0.55)', backgroundColor: 'rgba(0,0,0,0.25)' },
  sheetTradeAlertOverline: { color: '#c48a44', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.9, marginBottom: 5 },
  sheetTradeAlertName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sheetTradeAlertMeta: { color: 'rgba(255,255,255,0.66)', fontSize: 12, marginTop: 3 },
  sheetTradeAlertNarrative: { color: 'rgba(255,255,255,0.84)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
  sheetTradeAlertItemBox: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderRadius: 10, paddingHorizontal: 14, backgroundColor: 'rgba(0,191,255,0.06)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.28)', marginTop: 8, marginBottom: 12 },
  sheetTradeAlertItemName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: 'bold' },
  sheetTradeAlertItemQty: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  sheetTradeAlertHint: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 12 },
  sheetTradeAlertHintText: { flex: 1, color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 17 },

  customAlertBox: { backgroundColor: '#102b56', width: '90%', maxHeight: '86%', borderRadius: 20, padding: 25, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', alignItems: 'center' },
  customAlertTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  customAlertMessage: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  customAlertScroll: { width: '100%' },
  customAlertBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', justifyContent: 'center' },
  customAlertBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', minWidth: '30%' },
  customAlertBtnText: { fontWeight: 'bold', fontSize: 14 },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' },

  lanSessionBox: {
    backgroundColor: 'rgba(0, 191, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.28)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  lanSessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  lanSessionTitle: { color: '#00bfff', fontSize: 15, fontWeight: 'bold', letterSpacing: 1.5 },
  lanSessionHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4 },
  lanPlayersList: { maxHeight: 248 },
  lanPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  lanPlayerAvatar: { width: 42, height: 42, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(0,191,255,0.38)', backgroundColor: 'rgba(255,255,255,0.06)' },
  lanPlayerAvatarOffline: { opacity: 0.48 },
  lanPlayerName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  lanPlayerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  lanHpSide: { width: 122, alignItems: 'flex-end' },
  lanHpText: { color: '#ff7d7d', fontSize: 14, fontWeight: 'bold', marginBottom: 7 },
  lanHpDeadText: { fontSize: 20 },
  lanHpTrack: { width: '100%', height: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  lanHpFill: { height: '100%', borderRadius: 10, backgroundColor: '#ff7474' },
  lanHpFillDead: { backgroundColor: '#5f1220' },
  lanEffectsBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  lanEffectsTitle: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, marginBottom: 6 },
  lanEffectText: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 18 },
  lanEffectMuted: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  lanTradePendingList: { marginTop: 12, gap: 8, backgroundColor: 'rgba(255,209,102,0.08)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,209,102,0.25)' },
  lanTradePendingCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: 10 },
  lanTradePendingName: { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 3 },
  lanTradeIconActions: { flexDirection: 'row', gap: 8 },
  lanTradeIconButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  lanTradeDeclineButton: { backgroundColor: 'rgba(255,102,102,0.1)', borderColor: 'rgba(255,102,102,0.35)' },
  lanTradeAcceptButton: { backgroundColor: '#00fa9a', borderColor: '#00fa9a' },
  lanTargetPickerBox: { backgroundColor: '#102b56', width: '90%', maxHeight: '78%', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: 'rgba(0,191,255,0.35)' },
  lanTargetPickerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 16, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  lanTargetPickerList: { maxHeight: 360, width: '100%' },
  lanTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12, marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.22)' },
  lanTargetAvatar: { width: 48, height: 48, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(0,250,154,0.35)', backgroundColor: 'rgba(0,250,154,0.08)' },
  lanTargetName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  lanTargetSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 3 },
  deathOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  deathSkull: { fontSize: 76, marginBottom: 10 },
  deathText: { color: '#fff', fontSize: 24, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
});
