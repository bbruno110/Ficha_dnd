import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLanSession } from '../contexts/LanSessionContext';
import { isTradeEventExpired } from '../contexts/lan/lanSessionHelpers';
import { getLanSessionState } from '../network/lanRepository';
import { LanOfficialEventMessage, LanSessionRecord } from '../types/lan';

type CharacterOption = {
  id: number;
  name: string;
  race: string;
  class: string;
  level: number;
};

type ItemOption = {
  id: number;
  name: string;
  weight?: number;
  damage?: string | null;
  damage_type?: string | null;
  properties?: string | null;
  category?: string | null;
  is_consumable?: number | null;
  descricao?: string | null;
};

type ConditionEffectOption = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
};

type MasterModalKind = 'attribute' | 'tempHp' | 'xp' | 'item' | 'sheet' | 'time' | 'effects' | 'applyEffect';
type MasterModalState = {
  kind: MasterModalKind;
  player?: any;
  stat?: string;
};

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const navigationLockRef = useRef(false);
  const {
    activeSession,
    savedSessions,
    isTransportReady,
    connectionStatus,
    peerCount,
    lastError,
    lastNotice,
    players,
    localDeviceId,
    closeActiveSession,
    endActiveSession,
    linkCharacterToActiveSession,
    broadcastCharacter,
    sendLanCommand,
    getHistoryPage,
    resumeLanSession,
    refreshSavedSessions,
    pauseActiveSession,
    resumeActiveSession,
    refreshPlayers,
    lanRevision,
  } = useLanSession();

  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [history, setHistory] = useState<LanOfficialEventMessage[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [selectedTargetCharacterId, setSelectedTargetCharacterId] = useState<number | null>(null);
  const [selectedTargetDeviceId, setSelectedTargetDeviceId] = useState<string | null>(null);
  const [masterAmount, setMasterAmount] = useState('');
  const [coinGp, setCoinGp] = useState('');
  const [coinSp, setCoinSp] = useState('');
  const [coinCp, setCoinCp] = useState('');
  const [playerRequestAmount, setPlayerRequestAmount] = useState('');
  const [cardAmounts, setCardAmounts] = useState<Record<string, string>>({});
  const [cardCoins, setCardCoins] = useState<Record<string, { gp: string; sp: string; cp: string }>>({});
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [cardBuffs, setCardBuffs] = useState<Record<string, { stat: string; amount: string; mode: 'temporary' | 'permanent'; durationUnit: string; durationValue: string }>>({});
  const [cardTempHp, setCardTempHp] = useState<Record<string, { amount: string; durationUnit: string; durationValue: string }>>({});
  const [cardItemSearch, setCardItemSearch] = useState<Record<string, string>>({});
  const [itemCatalog, setItemCatalog] = useState<ItemOption[]>([]);
  const [effectCatalog, setEffectCatalog] = useState<ConditionEffectOption[]>([]);
  const [effectSearch, setEffectSearch] = useState('');
  const [selectedEffectIds, setSelectedEffectIds] = useState<number[]>([]);
  const [effectDurationValue, setEffectDurationValue] = useState('3');
  const [effectDurationUnit, setEffectDurationUnit] = useState<'turn' | 'minute' | 'hour' | 'short_rest' | 'long_rest'>('turn');
  const [globalXp, setGlobalXp] = useState('100');
  const [globalHp, setGlobalHp] = useState('1');
  const [globalCoins, setGlobalCoins] = useState({ gp: '', sp: '', cp: '' });
  const [campaignTurn, setCampaignTurn] = useState(1);
  const [campaignMinutes, setCampaignMinutes] = useState(0);
  const [timeAmount, setTimeAmount] = useState('');
  const [timeUnit, setTimeUnit] = useState<'turn' | 'minute' | 'hour' | 'short_rest' | 'long_rest'>('turn');
  const [masterModal, setMasterModal] = useState<MasterModalState | null>(null);
  const [handledRequestIds, setHandledRequestIds] = useState<Record<string, boolean>>({});
  const [tradeModal, setTradeModal] = useState<LanOfficialEventMessage | null>(null);
  const [tradeCounterItems, setTradeCounterItems] = useState<any[]>([]);
  const [tradeCounterItemIndex, setTradeCounterItemIndex] = useState<number | null>(null);
  const [tradeCounterQty, setTradeCounterQty] = useState('1');
  const [tradeCoins, setTradeCoins] = useState({ gp: '', sp: '', cp: '' });

  const loadLocalData = useCallback(async () => {
    const chars = await db.getAllAsync<CharacterOption>(
      `SELECT id, name, race, class, level FROM characters ORDER BY created_at DESC`
    );
    setCharacters(chars);
    const items = await db.getAllAsync<ItemOption>(
      `SELECT id, name, weight, damage, damage_type, properties, category, is_consumable, descricao FROM items ORDER BY name ASC`
    );
    setItemCatalog(items);
    const effects = await db.getAllAsync<ConditionEffectOption>(
      `SELECT id, name, description, color FROM condition_effects ORDER BY name ASC`
    );
    setEffectCatalog(effects.map(effect => ({ ...effect, color: effect.color || '#F4A84D' })));
  }, [db]);

  const loadHistory = useCallback(
    async (page = 0) => {
      const rows = await getHistoryPage(page, 50);
      setHistory(rows);
      setHistoryPage(page);
    },
    [getHistoryPage]
  );

  const loadSessionState = useCallback(async () => {
    if (!activeSession) return;
    const state = await getLanSessionState(db, activeSession.id);
    setCampaignTurn(state.turn);
    setCampaignMinutes(state.campaignMinutes);
  }, [activeSession, db]);

  const refreshSessionViews = useCallback(
    async (includeState = false) => {
      await Promise.all([
        refreshPlayers(),
        loadHistory(0),
        includeState ? loadSessionState() : Promise.resolve(),
      ]);
    },
    [loadHistory, loadSessionState, refreshPlayers]
  );

  useEffect(() => {
    loadLocalData();
    refreshSavedSessions();
  }, [loadLocalData, refreshSavedSessions]);

  useEffect(() => {
    if (activeSession) {
      setSelectedCharacterId(activeSession.linked_character_id || null);
      refreshPlayers();
      loadHistory(0);
      loadSessionState();
    } else {
      setHistory([]);
      setHistoryPage(0);
      setSelectedCharacterId(null);
      setSelectedTargetCharacterId(null);
      setSelectedTargetDeviceId(null);
    }
  }, [activeSession, loadHistory, refreshPlayers]);

  useEffect(() => {
    if (activeSession && lastNotice) {
      loadHistory(0);
      refreshSavedSessions();
    }
  }, [activeSession, lastNotice, loadHistory, refreshSavedSessions]);

  useEffect(() => {
    if (activeSession) {
      refreshPlayers();
      loadHistory(0);
      loadSessionState();
    }
  }, [activeSession, lanRevision, refreshPlayers, loadHistory, loadSessionState]);

  useEffect(() => {
    const targetStillPresent = selectedTargetCharacterId
      ? players.some(player =>
          player.character_id &&
          Number(player.character_id) === selectedTargetCharacterId &&
          (!selectedTargetDeviceId || player.device_id === selectedTargetDeviceId)
        )
      : false;
    if (targetStillPresent) return;

    const firstTarget = players.find(player => player.character_id);
    if (firstTarget?.character_id) {
      setSelectedTargetCharacterId(Number(firstTarget.character_id));
      setSelectedTargetDeviceId(firstTarget.device_id);
    } else {
      setSelectedTargetCharacterId(null);
      setSelectedTargetDeviceId(null);
    }
  }, [players, selectedTargetCharacterId, selectedTargetDeviceId]);

  const selectedCharacter = characters.find(character => character.id === selectedCharacterId);
  const targetPlayers = players.filter(player => player.character_id);
  const selectedTargetPlayer = players.find(player =>
    Number(player.character_id) === selectedTargetCharacterId &&
    (!selectedTargetDeviceId || player.device_id === selectedTargetDeviceId)
  );
  const visibleSavedSessions = savedSessions.filter(session => session.status !== 'inactive' && session.status !== 'closed');

  const safeJson = (value: unknown, fallback: any = null) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const playerSnapshot = (player: typeof players[number]) => {
    const parsed = safeJson(player.snapshot_payload, null);
    const data = parsed?.data || {};
    const stats = safeJson(data.stats, data.stats || {});
    const equipment = safeJson(data.equipment, data.equipment || {});
    const bag = Array.isArray(equipment) ? equipment : Array.isArray(equipment?.bag) ? equipment.bag : [];
    const slots = Array.isArray(equipment) ? {} : equipment?.slots || {};
    const equipped = Object.values(slots || {}).filter(Boolean) as any[];

    return {
      raw: parsed,
      data,
      stats: stats || {},
      activeEffects: Array.isArray(stats?.timed_effects) ? stats.timed_effects : [],
      equipment: { bag, slots },
      equipped,
      hpCurrent: Number(data.hp_current ?? 0),
      hpMax: Number(data.hp_max ?? 0),
      hpTemp: Number(data.hp_temp ?? 0),
      xp: Number(data.xp ?? 0),
      gp: Number(data.gp ?? 0),
      sp: Number(data.sp ?? 0),
      cp: Number(data.cp ?? 0),
      level: Number(data.level ?? parsed?.level ?? 1),
      race: String(data.race ?? parsed?.race ?? ''),
      className: String(data.class ?? parsed?.class ?? ''),
    };
  };

  const avatarSourceForName = (name: string, size = 120) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Jogador')}&background=102b56&color=00bfff&size=${size}&bold=true`;

  const playerAvatarSource = (snapshot: ReturnType<typeof playerSnapshot>, fallbackName: string) =>
    String(snapshot.data?.avatar_data_uri || snapshot.data?.avatar_uri || snapshot.raw?.avatar_data_uri || snapshot.raw?.avatar_uri || '') || avatarSourceForName(fallbackName);

  const playerActionKey = (player: typeof players[number]) => `${player.device_id}_${player.character_id || 'none'}`;

  const getCardAmount = (player: typeof players[number]) => cardAmounts[playerActionKey(player)] ?? '';
  const setCardAmount = (player: typeof players[number], value: string) => {
    const key = playerActionKey(player);
    setCardAmounts(prev => ({ ...prev, [key]: onlyNumberText(value) }));
  };

  const getCardCoins = (player: typeof players[number]) => cardCoins[playerActionKey(player)] ?? { gp: '', sp: '', cp: '' };
  const setCardCoinValue = (player: typeof players[number], coin: 'gp' | 'sp' | 'cp', value: string) => {
    const key = playerActionKey(player);
    setCardCoins(prev => {
      const current = prev[key] ?? { gp: '', sp: '', cp: '' };
      return { ...prev, [key]: { ...current, [coin]: onlyNumberText(value) } };
    });
  };

  const resetCardCoins = (player: typeof players[number]) => {
    const key = playerActionKey(player);
    setCardCoins(prev => ({ ...prev, [key]: { gp: '', sp: '', cp: '' } }));
  };

  const statValue = (stats: any, key: string) => {
    const base = Number(stats?.[key] ?? 10);
    const temp = Number(stats?.temp_mods?.[key] ?? 0);
    const equip = Number(stats?.equip_mods?.[key] ?? 0);
    return base + temp + equip;
  };

  const itemLabel = (item: any) => {
    if (!item) return '';
    const name = item.name || item.itemName || item.label || 'Item';
    const qty = Number(item.qty || item.quantity || 1);
    return qty > 1 ? `${qty}x ${name}` : String(name);
  };

  const effectLabel = (effect: any) => {
    const base = effect?.label || (effect?.kind === 'temp_hp' ? `PV temp +${effect.amount || 0}` : `${effect?.stat || 'Efeito'} ${Number(effect?.amount || 0) >= 0 ? '+' : ''}${effect?.amount || 0}`);
    if (effect?.durationUnit === 'short_rest') return `${base} / descanso curto`;
    if (effect?.durationUnit === 'long_rest') return `${base} / descanso longo`;
    if (effect?.durationUnit) return `${base} / ${effect.durationValue || 1} ${durationLabel(effect.durationUnit).toLowerCase()}`;
    return String(base);
  };
  const effectColor = (effect: any, fallback = '#ffd166') =>
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(effect?.color || '')) ? String(effect.color) : fallback;

  const getExpanded = (player: typeof players[number]) => expandedCards[playerActionKey(player)] ?? false;
  const toggleExpanded = (player: typeof players[number]) => {
    const key = playerActionKey(player);
    setExpandedCards(prev => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const getCardBuff = (player: typeof players[number]) =>
    cardBuffs[playerActionKey(player)] ?? { stat: 'FOR', amount: '1', mode: 'temporary' as const, durationUnit: 'turn', durationValue: '1' };
  const setCardBuffValue = (player: typeof players[number], patch: Partial<ReturnType<typeof getCardBuff>>) => {
    const key = playerActionKey(player);
    setCardBuffs(prev => ({ ...prev, [key]: { ...getCardBuff(player), ...patch } }));
  };

  const getCardTempHp = (player: typeof players[number]) =>
    cardTempHp[playerActionKey(player)] ?? { amount: '1', durationUnit: 'short_rest', durationValue: '1' };
  const setCardTempHpValue = (player: typeof players[number], patch: Partial<ReturnType<typeof getCardTempHp>>) => {
    const key = playerActionKey(player);
    setCardTempHp(prev => ({ ...prev, [key]: { ...getCardTempHp(player), ...patch } }));
  };

  const durationLabel = (unit: string) => {
    const labels: Record<string, string> = {
      turn: 'Turno',
      minute: 'Minuto',
      hour: 'Hora',
      short_rest: 'Descanso curto',
      long_rest: 'Descanso longo',
    };
    return labels[unit] || unit;
  };

  const numericValue = (value: string, fallback = 0) => {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const onlyNumberText = (value: string) => value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');

  const navigateOnce = (path: string) => {
    if (navigationLockRef.current) return;
    navigationLockRef.current = true;
    router.navigate(path as any);
    setTimeout(() => {
      navigationLockRef.current = false;
    }, 700);
  };

  const sessionStatusLabel = (session: LanSessionRecord) => {
    if (activeSession?.id === session.id && isTransportReady) return 'ATIVA';
    if (session.status === 'paused') return 'PAUSADA';
    if (session.status === 'inactive') return 'INATIVA';
    if (session.status === 'open' || session.status === 'connected') return 'RETOMAVEL';
    return 'ENCERRADA';
  };

  const sessionStatusColor = (session: LanSessionRecord) => {
    const label = sessionStatusLabel(session);
    if (label === 'ATIVA') return '#00fa9a';
    if (label === 'PAUSADA') return '#ffd166';
    if (label === 'INATIVA') return '#9aa7b7';
    return '#00bfff';
  };

  const handleResumeSavedSession = async (session: LanSessionRecord) => {
    try {
      await resumeLanSession(session.id);
      await refreshSavedSessions();
    } catch (error) {
      Alert.alert('Nao foi possivel retomar', error instanceof Error ? error.message : String(error));
    }
  };

  const handleActiveCharacterChange = async (characterId: number | null) => {
    setSelectedCharacterId(characterId);
    if (activeSession) {
      await linkCharacterToActiveSession(characterId);
      if (activeSession.role === 'player' && characterId) {
        await broadcastCharacter(characterId, 'character-linked');
        router.replace(`/sheet?id=${characterId}`);
      }
    }
  };

  const handleMasterHp = async (mode: 'damage' | 'heal') => {
    if (!selectedTargetPlayer?.character_id) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }
    const amount = Math.max(0, numericValue(masterAmount, 0));
    if (amount <= 0) return;

    await sendLanCommand('MASTER_APPLY_HP', {
      targetCharacterId: Number(selectedTargetPlayer.character_id),
      targetDeviceId: selectedTargetPlayer.device_id,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      mode,
      amount,
    });
    setMasterAmount('');
    await refreshSessionViews();
  };

  const handleMasterXp = async () => {
    if (!selectedTargetPlayer?.character_id) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }
    const amount = numericValue(masterAmount, 0);
    if (amount === 0) return;

    await sendLanCommand('MASTER_APPLY_XP', {
      targetCharacterId: Number(selectedTargetPlayer.character_id),
      targetDeviceId: selectedTargetPlayer.device_id,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      amount,
    });
    setMasterAmount('');
    await refreshSessionViews();
  };

  const handleMasterCoins = async () => {
    if (!selectedTargetPlayer?.character_id) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }
    const coins = {
      gp: numericValue(coinGp, 0),
      sp: numericValue(coinSp, 0),
      cp: numericValue(coinCp, 0),
    };
    if (coins.gp === 0 && coins.sp === 0 && coins.cp === 0) return;

    await sendLanCommand('MASTER_APPLY_COINS', {
      targetCharacterId: Number(selectedTargetPlayer.character_id),
      targetDeviceId: selectedTargetPlayer.device_id,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      ...coins,
    });
    setCoinGp('');
    setCoinSp('');
    setCoinCp('');
    await refreshSessionViews();
  };

  const handleMasterHpForPlayer = async (player: typeof players[number], mode: 'damage' | 'heal') => {
    if (!player.character_id) return;
    const amount = Math.max(0, numericValue(getCardAmount(player), 0));
    if (amount <= 0) return;
    await sendLanCommand('MASTER_APPLY_HP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      mode,
      amount,
    });
    setCardAmount(player, '1');
    await refreshSessionViews();
  };

  const handleMasterXpForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const amount = numericValue(getCardAmount(player), 0);
    if (amount === 0) return;
    await sendLanCommand('MASTER_APPLY_XP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      amount,
    });
    setCardAmount(player, '');
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleMasterCoinsForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const coins = getCardCoins(player);
    const coinDelta = {
      gp: numericValue(coins.gp, 0),
      sp: numericValue(coins.sp, 0),
      cp: numericValue(coins.cp, 0),
    };
    if (coinDelta.gp === 0 && coinDelta.sp === 0 && coinDelta.cp === 0) return;
    await sendLanCommand('MASTER_APPLY_COINS', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      ...coinDelta,
    });
    resetCardCoins(player);
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleMasterTempHpForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const tempHp = getCardTempHp(player);
    const amount = Math.max(0, numericValue(tempHp.amount, 0));
    if (amount <= 0) return;
    await sendLanCommand('MASTER_APPLY_TEMP_HP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      amount,
      mode: 'add',
      durationUnit: tempHp.durationUnit,
      durationValue: numericValue(tempHp.durationValue, 1),
    });
    setCardTempHpValue(player, { amount: '', durationValue: '1' });
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleMasterAttributeForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const buff = getCardBuff(player);
    const amount = numericValue(buff.amount, 0);
    if (amount === 0) return;
    await sendLanCommand('MASTER_APPLY_ATTRIBUTE', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      stat: buff.stat,
      amount,
      durationMode: buff.mode,
      durationUnit: buff.durationUnit,
      durationValue: numericValue(buff.durationValue, 1),
    });
    setCardBuffValue(player, { amount: '', durationValue: '1' });
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleMasterRemoveEffect = async (player: typeof players[number], effectId: string) => {
    if (!player.character_id || !effectId) return;
    await sendLanCommand('MASTER_REMOVE_EFFECT', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      effectId,
    });
    await refreshSessionViews();
  };

  const toggleSelectedEffect = (effectId: number) => {
    setSelectedEffectIds(prev => (prev.includes(effectId) ? prev.filter(id => id !== effectId) : [...prev, effectId]));
  };

  const handleMasterApplySelectedEffects = async (player?: typeof players[number]) => {
    const selectedEffects = effectCatalog.filter(effect => selectedEffectIds.includes(effect.id));
    const targetList = player ? [player] : targetPlayers;
    const durationValue = Math.max(1, numericValue(effectDurationValue, 1));
    if (selectedEffects.length === 0 || targetList.length === 0) return;

    for (const targetPlayer of targetList) {
      for (const effect of selectedEffects) {
        await sendLanCommand('MASTER_APPLY_EFFECT', {
          targetCharacterId: Number(targetPlayer.character_id),
          targetDeviceId: targetPlayer.device_id,
          targetName: targetPlayer.character_name || 'Personagem',
          effectName: effect.name,
          description: effect.description || '',
          color: effect.color || '#F4A84D',
          durationUnit: effectDurationUnit,
          durationValue,
        });
      }
    }

    setSelectedEffectIds([]);
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleMasterGiveItem = async (player: typeof players[number], item: ItemOption, quantity = 1) => {
    if (!player.character_id) return;
    await sendLanCommand('MASTER_APPLY_ITEM', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      quantity: Math.max(1, quantity),
      item,
    });
    setCardAmount(player, '');
    setCardItemSearch(prev => ({ ...prev, [playerActionKey(player)]: '' }));
    setMasterModal(null);
    await refreshSessionViews();
  };

  const handleGlobalXp = async () => {
    const targets = targetPlayers;
    const total = Math.max(0, numericValue(globalXp, 0));
    if (targets.length === 0 || total <= 0) return;
    const base = Math.floor(total / targets.length);
    let remainder = total % targets.length;
    for (const player of targets) {
      const share = base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      await sendLanCommand('MASTER_APPLY_XP', {
        targetCharacterId: Number(player.character_id),
        targetDeviceId: player.device_id,
        targetName: player.character_name || 'Personagem',
        amount: share,
      });
    }
    setGlobalXp('100');
    await refreshSessionViews();
  };

  const handleGlobalHp = async (mode: 'damage' | 'heal') => {
    const targets = targetPlayers;
    const amount = Math.max(0, numericValue(globalHp, 0));
    if (targets.length === 0 || amount <= 0) return;
    for (const player of targets) {
      await sendLanCommand('MASTER_APPLY_HP', {
        targetCharacterId: Number(player.character_id),
        targetDeviceId: player.device_id,
        targetName: player.character_name || 'Personagem',
        mode,
        amount,
      });
    }
    setGlobalHp('1');
    await refreshSessionViews();
  };

  const handleGlobalCoins = async () => {
    const targets = targetPlayers;
    if (targets.length === 0) return;
    const totals = {
      gp: Math.max(0, numericValue(globalCoins.gp, 0)),
      sp: Math.max(0, numericValue(globalCoins.sp, 0)),
      cp: Math.max(0, numericValue(globalCoins.cp, 0)),
    };
    for (const [index, player] of targets.entries()) {
      const share = {
        gp: Math.floor(totals.gp / targets.length) + (index < totals.gp % targets.length ? 1 : 0),
        sp: Math.floor(totals.sp / targets.length) + (index < totals.sp % targets.length ? 1 : 0),
        cp: Math.floor(totals.cp / targets.length) + (index < totals.cp % targets.length ? 1 : 0),
      };
      await sendLanCommand('MASTER_APPLY_COINS', {
        targetCharacterId: Number(player.character_id),
        targetDeviceId: player.device_id,
        targetName: player.character_name || 'Personagem',
        ...share,
      });
    }
    setGlobalCoins({ gp: '', sp: '', cp: '' });
    await refreshSessionViews();
  };

  const handleAdvanceTurn = async (delta = 1) => {
    await sendLanCommand('MASTER_ADVANCE_TURN', { delta });
    await refreshSessionViews(true);
  };

  const handleAdvanceMinutes = async (minutes: number) => {
    await sendLanCommand('MASTER_ADVANCE_TIME', { minutes });
    await refreshSessionViews(true);
  };

  const handleApplyRest = async (kind: 'short_rest' | 'long_rest') => {
    await sendLanCommand(kind === 'short_rest' ? 'MASTER_SHORT_REST' : 'MASTER_LONG_REST', {});
    await refreshSessionViews(true);
  };

  const handleAdvanceTime = async () => {
    const amount = Math.max(1, numericValue(timeAmount, 1));
    if (timeUnit === 'turn') {
      await handleAdvanceTurn(amount);
    } else if (timeUnit === 'minute') {
      await sendLanCommand('MASTER_ADVANCE_TIME', { minutes: amount });
    } else if (timeUnit === 'hour') {
      await sendLanCommand('MASTER_ADVANCE_TIME', { minutes: amount * 60 });
    } else {
      await sendLanCommand(timeUnit === 'short_rest' ? 'MASTER_SHORT_REST' : 'MASTER_LONG_REST', {});
    }
    setTimeAmount('');
    setMasterModal(null);
    await refreshSessionViews(true);
  };

  const openPlayerSheetFromMaster = (player: typeof players[number]) => {
    if (!player.character_id) return;
    setMasterModal({ kind: 'sheet', player });
  };

  const handlePlayerRequest = async (command: 'PLAYER_REQUEST_HP' | 'PLAYER_REQUEST_XP' | 'PLAYER_REQUEST_COINS') => {
    const amount = Math.max(0, numericValue(playerRequestAmount, 0));
    if (amount <= 0) return;
    await sendLanCommand(command, {
      amount,
      characterName: selectedCharacter?.name || null,
    });
    setPlayerRequestAmount('');
    await refreshSessionViews();
  };

  const markRequestHandled = (event: LanOfficialEventMessage) => {
    const key = event.commandId || event.eventId;
    if (key) setHandledRequestIds(prev => ({ ...prev, [key]: true }));
  };

  const resolvedRequestIds = new Set(
    Object.entries(handledRequestIds)
      .filter(([, handled]) => handled)
      .map(([requestId]) => requestId)
  );
  for (const event of history) {
    const requestCommandId = String((event.payload as any)?.requestCommandId || '');
    if (requestCommandId && event.eventType !== 'PLAYER_REQUESTED') {
      resolvedRequestIds.add(requestCommandId);
    }
  }
  const pendingMasterRequests = history.filter(event => {
    const requestId = event.commandId || event.eventId;
    return event.eventType === 'PLAYER_REQUESTED' && !resolvedRequestIds.has(requestId);
  });

  const resolvedTradeOfferIds = new Set<string>();
  const counteredTradeOfferIds = new Set<string>();
  for (const event of history) {
    const offerCommandId = String((event.payload as any)?.offerCommandId || '');
    if (offerCommandId && (event.eventType === 'TRADE_ACCEPTED' || event.eventType === 'TRADE_DECLINED' || event.eventType === 'TRADE_EXPIRED')) {
      resolvedTradeOfferIds.add(offerCommandId);
    }
    if (offerCommandId && event.eventType === 'TRADE_COUNTERED') {
      counteredTradeOfferIds.add(offerCommandId);
    }
  }
  const pendingTradeOffers = history.filter(event => {
    const offerCommandId = event.commandId || event.eventId;
    const payload = (event.payload || {}) as any;
    const targetDeviceId = String(event.targetDeviceId || payload.targetDeviceId || '');
    const belongsToThisDevice = localDeviceId ? targetDeviceId === localDeviceId : !targetDeviceId;
    return (
      activeSession?.role === 'player' &&
      event.eventType === 'TRADE_OFFERED' &&
      Number(event.targetCharacterId || 0) === Number(activeSession.linked_character_id || 0) &&
      belongsToThisDevice &&
      !resolvedTradeOfferIds.has(offerCommandId) &&
      !counteredTradeOfferIds.has(offerCommandId) &&
      !isTradeEventExpired(event)
    );
  });
  const pendingTradeCounters = history.filter(event => {
    const offerCommandId = String((event.payload as any)?.offerCommandId || '');
    const payload = (event.payload || {}) as any;
    const targetDeviceId = String(event.targetDeviceId || payload.sourceDeviceId || '');
    const belongsToThisDevice = localDeviceId ? targetDeviceId === localDeviceId : !targetDeviceId;
    return (
      activeSession?.role === 'player' &&
      event.eventType === 'TRADE_COUNTERED' &&
      Number(event.targetCharacterId || 0) === Number(activeSession.linked_character_id || 0) &&
      belongsToThisDevice &&
      !!offerCommandId &&
      !resolvedTradeOfferIds.has(offerCommandId) &&
      !isTradeEventExpired(event)
    );
  });

  const tradePartsLabel = (item: any, quantity: number, coins?: { gp?: number; sp?: number; cp?: number }) => {
    const parts = [
      item && quantity > 0 ? `${quantity}x ${String(item.name || item.itemName || 'Item')}` : '',
      Number(coins?.gp || 0) > 0 ? `${Number(coins?.gp || 0)} PO` : '',
      Number(coins?.sp || 0) > 0 ? `${Number(coins?.sp || 0)} PP` : '',
      Number(coins?.cp || 0) > 0 ? `${Number(coins?.cp || 0)} PC` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' + ') : 'Nada';
  };

  const openTradeModal = async (event: LanOfficialEventMessage) => {
    if (!activeSession?.linked_character_id) return;
    const row = await db.getFirstAsync<any>(
      `SELECT equipment FROM characters WHERE id = ? LIMIT 1`,
      [activeSession.linked_character_id]
    );
    const parsedEquipment = safeJson(row?.equipment, {});
    const bag = Array.isArray(parsedEquipment) ? parsedEquipment : Array.isArray(parsedEquipment?.bag) ? parsedEquipment.bag : [];
    setTradeCounterItems(bag);
    setTradeCounterItemIndex(null);
    setTradeCounterQty('1');
    setTradeCoins({ gp: '', sp: '', cp: '' });
    setTradeModal(event);
  };

  const openTradeConfirmModal = (event: LanOfficialEventMessage) => {
    setTradeCounterItems([]);
    setTradeCounterItemIndex(null);
    setTradeCounterQty('1');
    setTradeCoins({ gp: '', sp: '', cp: '' });
    setTradeModal(event);
  };

  const handleDeclineTrade = async (event: LanOfficialEventMessage) => {
    const payload = (event.payload || {}) as any;
    await sendLanCommand('PLAYER_TRADE_DECLINE', {
      offerCommandId: payload.offerCommandId || event.commandId || event.eventId,
    });
    setTradeModal(current => ((current?.commandId || current?.eventId) === (event.commandId || event.eventId) ? null : current));
    await refreshSessionViews();
  };

  const handleAcceptTrade = async () => {
    if (!tradeModal) return;
    if (tradeModal.eventType === 'TRADE_COUNTERED') {
      await sendLanCommand('PLAYER_TRADE_CONFIRM', {
        offerCommandId: String((tradeModal.payload as any)?.offerCommandId || ''),
        counterCommandId: tradeModal.commandId || tradeModal.eventId,
      });
      setTradeModal(null);
      await refreshSessionViews();
      return;
    }

    const selectedItem = tradeCounterItemIndex !== null ? tradeCounterItems[tradeCounterItemIndex] : null;
    const qty = selectedItem ? Math.max(1, Math.min(Number(selectedItem.qty || 1), numericValue(tradeCounterQty, 1))) : 0;
    const coins = {
      gp: Math.max(0, numericValue(tradeCoins.gp, 0)),
      sp: Math.max(0, numericValue(tradeCoins.sp, 0)),
      cp: Math.max(0, numericValue(tradeCoins.cp, 0)),
    };
    await sendLanCommand('PLAYER_TRADE_COUNTER', {
      offerCommandId: tradeModal.commandId || tradeModal.eventId,
      counterItem: selectedItem || null,
      counterQuantity: selectedItem ? qty : 0,
      ...coins,
    });
    setTradeModal(null);
    setTradeCounterItems([]);
    await refreshSessionViews();
  };

  const handleApproveRequest = async (event: LanOfficialEventMessage) => {
    const payload = (event.payload || {}) as any;
    const requestCommand = String(payload.command || '');
    const requestCommandId = event.commandId || event.eventId;
    const targetCharacterId = Number(event.targetCharacterId || payload.targetCharacterId || 0);
    const targetDeviceId = String(event.targetDeviceId || event.actorDeviceId || payload.targetDeviceId || '');
    const targetName = event.targetName || payload.characterName || event.actorName || 'Personagem';

    if (!targetCharacterId) {
      Alert.alert('Solicitação inválida', 'Não foi possível identificar a ficha alvo desta solicitação.');
      return;
    }

    if (requestCommand === 'PLAYER_INVENTORY_UPDATE' && payload.action === 'REQUEST_ITEM_QUANTITY_INCREASE') {
      await sendLanCommand('MASTER_APPLY_ITEM', {
        targetCharacterId,
        targetDeviceId,
        targetName,
        item: payload.item || { name: payload.itemName || 'Item' },
        quantity: Math.max(1, numericValue(String(payload.quantity || payload.requestedDelta || 1), 1)),
        requestCommandId,
      });
      markRequestHandled(event);
      await refreshSessionViews();
      return;
    }

    if (requestCommand === 'PLAYER_REQUEST_HP') {
      await sendLanCommand('MASTER_APPLY_HP', {
        targetCharacterId,
        targetDeviceId,
        targetName,
        mode: payload.mode || 'heal',
        amount: Math.max(0, Number(payload.amount || 0)),
        requestCommandId,
      });
      markRequestHandled(event);
      await refreshSessionViews();
      return;
    }

    if (requestCommand === 'PLAYER_REQUEST_XP') {
      await sendLanCommand('MASTER_APPLY_XP', {
        targetCharacterId,
        targetDeviceId,
        targetName,
        amount: Number(payload.amount || 0),
        requestCommandId,
      });
      markRequestHandled(event);
      await refreshSessionViews();
      return;
    }

    if (requestCommand === 'PLAYER_REQUEST_COINS') {
      await sendLanCommand('MASTER_APPLY_COINS', {
        targetCharacterId,
        targetDeviceId,
        targetName,
        gp: Number(payload.gp || 0),
        sp: Number(payload.sp || 0),
        cp: Number(payload.cp || 0),
        requestCommandId,
      });
      markRequestHandled(event);
      await refreshSessionViews();
      return;
    }

    if (requestCommand === 'PLAYER_REQUEST_ATTRIBUTE') {
      await sendLanCommand('MASTER_APPLY_ATTRIBUTE', {
        targetCharacterId,
        targetDeviceId,
        targetName,
        stat: String(payload.stat || '').toUpperCase(),
        amount: Number(payload.amount || 0),
        durationMode: payload.durationMode || 'temporary',
        durationUnit: payload.durationUnit || 'turn',
        durationValue: Number(payload.durationValue || 1),
        requestCommandId,
      });
      markRequestHandled(event);
      await refreshSessionViews();
      return;
    }

    Alert.alert('Solicitação não suportada', 'Este tipo de solicitação ainda não possui aprovação automática.');
  };

  const handleDenyRequest = async (event: LanOfficialEventMessage) => {
    await sendLanCommand('MASTER_DENY_REQUEST', {
      requestCommandId: event.commandId || event.eventId,
      targetCharacterId: event.targetCharacterId || null,
      targetDeviceId: event.targetDeviceId || event.actorDeviceId || null,
      targetName: event.targetName || event.actorName || 'Personagem',
      reason: `Mestre recusou: ${event.description}`,
      originalPayload: event.payload || {},
    });
    markRequestHandled(event);
    await refreshSessionViews();
  };

  const goToCreateCharacter = () => {
    router.push('/create');
  };

  const renderCharacterPicker = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.label}>PERSONAGEM VINCULADO</Text>
        {selectedCharacterId && (
          <TouchableOpacity onPress={() => handleActiveCharacterChange(null)}>
            <Text style={styles.clearText}>Limpar</Text>
          </TouchableOpacity>
        )}
      </View>

      {characters.length === 0 ? (
        <TouchableOpacity style={styles.emptyAction} onPress={goToCreateCharacter}>
          <Ionicons name="person-add-outline" size={20} color="#00bfff" />
          <Text style={styles.emptyActionText}>Criar personagem</Text>
        </TouchableOpacity>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.characterList}>
            {characters.map(character => {
              const selected = selectedCharacterId === character.id;
              return (
                <TouchableOpacity
                  key={character.id}
                  style={[styles.characterPill, selected && styles.characterPillActive]}
                  onPress={() => handleActiveCharacterChange(character.id)}
                >
                  <Text style={[styles.characterPillName, selected && styles.characterPillNameActive]} numberOfLines={1}>
                    {character.name}
                  </Text>
                  <Text style={styles.characterPillSub} numberOfLines={1}>
                    Nv. {character.level} / {character.race}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.emptyAction} onPress={goToCreateCharacter}>
            <Ionicons name="person-add-outline" size={20} color="#00bfff" />
            <Text style={styles.emptyActionText}>Criar nova ficha</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderPlayerLinkedCharacterCard = () => {
    if (!activeSession || activeSession.role !== 'player' || !activeSession.linked_character_id) return null;

    const linked = selectedCharacter || characters.find(character => character.id === activeSession.linked_character_id);
    const title = linked?.name || 'Ficha vinculada';
    const subtitle = linked ? `Nv. ${linked.level} / ${linked.race} / ${linked.class}` : `ID ${activeSession.linked_character_id}`;

    return (
      <View style={styles.section}>
        <Text style={styles.label}>MINHA FICHA NA SESSÃO</Text>
        <View style={styles.createRequiredBox}>
          <Ionicons name="person-circle-outline" size={28} color="#00fa9a" />
          <View style={{ flex: 1 }}>
            <Text style={styles.createRequiredTitle}>{title}</Text>
            <Text style={styles.createRequiredSub}>{subtitle}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace(`/sheet?id=${activeSession.linked_character_id}`)}>
          <Ionicons name="document-text-outline" size={20} color="#02112b" />
          <Text style={styles.primaryButtonText}>ABRIR MINHA FICHA</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCharacterLinkPicker = () => (
    <View style={styles.section}>
      <Text style={styles.label}>ESCOLHA A FICHA DESTA SESSÃO</Text>
      <Text style={styles.gateHint}>
        Depois de vinculada, esta será a ficha usada por este aparelho enquanto jogar nesta mesa.
      </Text>

      {characters.length === 0 ? (
        <TouchableOpacity style={styles.emptyAction} onPress={goToCreateCharacter}>
          <Ionicons name="person-add-outline" size={20} color="#00bfff" />
          <Text style={styles.emptyActionText}>Criar personagem</Text>
        </TouchableOpacity>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.characterList}>
            {characters.map(character => (
              <TouchableOpacity
                key={character.id}
                style={styles.characterPill}
                onPress={() => handleActiveCharacterChange(character.id)}
              >
                <Text style={styles.characterPillName} numberOfLines={1}>
                  {character.name}
                </Text>
                <Text style={styles.characterPillSub} numberOfLines={1}>
                  Nv. {character.level} / {character.race}
                </Text>
                <Text style={styles.characterPillHint}>Vincular e abrir</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.emptyAction} onPress={goToCreateCharacter}>
            <Ionicons name="person-add-outline" size={20} color="#00bfff" />
            <Text style={styles.emptyActionText}>Criar nova ficha para esta mesa</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderPlayerCharacterGate = () => {
    if (!activeSession || activeSession.role !== 'player') return null;

    if (activeSession.linked_character_id) {
      return renderPlayerLinkedCharacterCard();
    }


    if (activeSession.allow_existing_character) {
      return renderCharacterLinkPicker();
    }

    return (
      <View style={styles.section}>
        <Text style={styles.label}>FICHA DA MESA</Text>
        <View style={styles.createRequiredBox}>
          <Ionicons name="person-add-outline" size={24} color="#00fa9a" />
          <View style={{ flex: 1 }}>
            <Text style={styles.createRequiredTitle}>Crie uma ficha nova para esta mesa</Text>
            <Text style={styles.createRequiredSub}>O mestre não permitiu vincular fichas já existentes.</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={goToCreateCharacter}>
          <Ionicons name="person-add-outline" size={20} color="#02112b" />
          <Text style={styles.primaryButtonText}>CRIAR FICHA DA SESSÃO</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderSessionControls = () => {
    if (!activeSession) return null;

    if (activeSession.role !== 'master') {
      return (
        <View style={styles.activeActions}>
          <TouchableOpacity style={styles.dangerButton} onPress={closeActiveSession}>
            <Ionicons name="exit-outline" size={18} color="#ff6666" />
            <Text style={styles.dangerButtonText}>Desconectar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeSession.status === 'closed') {
      return (
        <View style={styles.activeActions}>
          <Text style={styles.mutedSmallText}>Encerrando sessao e aguardando jogadores desvincularem.</Text>
        </View>
      );
    }

    const isPaused = activeSession.status === 'paused';
    return (
      <View style={styles.activeActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={isPaused ? resumeActiveSession : pauseActiveSession}>
          <Ionicons name={isPaused ? 'play-outline' : 'pause-outline'} size={18} color="#00bfff" />
          <Text style={styles.secondaryButtonText}>{isPaused ? 'Retomar' : 'Pausar'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerButton} onPress={endActiveSession}>
          <Ionicons name="close-circle-outline" size={18} color="#ff6666" />
          <Text style={styles.dangerButtonText}>Encerrar</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderMasterPendingRequests = () => {
    if (!pendingMasterRequests.length) return null;

    return (
      <View style={styles.pendingRequestsBox}>
        <View style={styles.sectionHeader}>
          <Text style={styles.playersTitle}>Solicitações pendentes</Text>
          <Text style={styles.pendingCount}>{pendingMasterRequests.length}</Text>
        </View>
        {pendingMasterRequests.map(event => {
          const payload = (event.payload || {}) as any;
          const itemName = payload.itemName || payload.item?.name;
          const detail = itemName
            ? `${event.actorName || 'Jogador'} pediu +${payload.quantity || payload.requestedDelta || 1}x ${itemName}`
            : event.description;
          return (
            <View key={event.commandId || event.eventId} style={styles.pendingRequestCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingRequestTitle}>{event.targetName || event.actorName || 'Jogador'}</Text>
                <Text style={styles.pendingRequestText}>{detail}</Text>
              </View>
              <View style={styles.pendingRequestActions}>
                <TouchableOpacity style={styles.approveRequestButton} onPress={() => handleApproveRequest(event)}>
                  <Ionicons name="checkmark" size={16} color="#02112b" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.denyRequestButton} onPress={() => handleDenyRequest(event)}>
                  <Ionicons name="close" size={16} color="#ff6666" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderMasterTools = () => {
    if (!activeSession || activeSession.role !== 'master') return null;
    if (activeSession.status === 'closed') return null;

    return (
      <View style={styles.toolsBox}>
        {renderMasterPendingRequests()}

        <View style={styles.sectionHeader}>
          <Text style={styles.playersTitle}>Cards dos jogadores</Text>
          <TouchableOpacity onPress={() => refreshPlayers()}>
            <Text style={styles.refreshText}>Atualizar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.masterBoardPanel}>
          <View style={styles.sessionBoardHeader}>
            <View style={styles.sessionBoardTitleBlock}>
              <Text style={styles.sessionBoardTitle} numberOfLines={1}>{activeSession.name || 'Mesa de D&D'}</Text>
              <Text style={styles.turnSubValue} numberOfLines={1}>Codigo {activeSession.id || '-'}</Text>
            </View>
            <View style={[styles.statusBadge, styles.statusBadgeReady]}>
              <Text style={styles.statusBadgeTextReady}>{activeSession.status === 'paused' ? 'PAUSADA' : 'ATIVA'}</Text>
            </View>
          </View>

          <View style={styles.sessionOverviewGrid}>
            <View style={styles.sessionMetricBox}>
              <Text style={styles.quickMetricLabel}>TURNO</Text>
              <Text style={styles.sessionMetricValue}>{campaignTurn}</Text>
            </View>
            <View style={styles.sessionMetricBox}>
              <Text style={styles.quickMetricLabel}>TEMPO</Text>
              <Text style={styles.sessionMetricValue}>{campaignMinutes < 60 ? `${campaignMinutes} min` : `${Math.floor(campaignMinutes / 60)}h ${campaignMinutes % 60}m`}</Text>
            </View>
            <View style={styles.sessionMetricBox}>
              <Text style={styles.quickMetricLabel}>JOGADORES</Text>
              <Text style={styles.sessionMetricValue}>{players.length}</Text>
              <Text style={styles.turnSubValue}>{targetPlayers.length} ficha(s)</Text>
            </View>
          </View>

          <View style={styles.sessionActionGrid}>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => handleAdvanceTurn(1)}>
              <Ionicons name="play-forward-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>+ Turno</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => handleAdvanceMinutes(1)}>
              <Ionicons name="time-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>+ Min</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => handleAdvanceMinutes(60)}>
              <Ionicons name="hourglass-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>+ Hora</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => handleApplyRest('short_rest')}>
              <Ionicons name="cafe-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>Desc. curto</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => handleApplyRest('long_rest')}>
              <Ionicons name="moon-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>Desc. longo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => setMasterModal({ kind: 'time' })}>
              <Ionicons name="options-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>Avancado</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sessionActionButton} onPress={() => setMasterModal({ kind: 'applyEffect' })}>
              <Ionicons name="color-wand-outline" size={17} color="#fff" />
              <Text style={styles.sessionActionText}>Efeito</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.globalRewardBox}>
            <Text style={styles.coinApplyLabel}>XP GLOBAL</Text>
            <View style={styles.compactInputRow}>
              <TextInput
                style={[styles.input, styles.compactInput]}
                value={globalXp}
                onChangeText={value => setGlobalXp(onlyNumberText(value))}
                onFocus={() => globalXp === '0' && setGlobalXp('')}
                onBlur={() => !globalXp && setGlobalXp('100')}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.35)"
                selectTextOnFocus
                textAlign="center"
              />
              <TouchableOpacity style={styles.secondaryButton} onPress={handleGlobalXp}>
                <Ionicons name="git-branch-outline" size={18} color="#00bfff" />
                <Text style={styles.secondaryButtonText}>Dividir XP</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.mutedSmallText}>
              {targetPlayers.length > 0 ? `Divide entre ${targetPlayers.length} jogador(es).` : 'Sem jogadores vinculados.'}
            </Text>
          </View>

          <View style={styles.globalRewardBox}>
            <Text style={styles.coinApplyLabel}>VIDA GLOBAL</Text>
            <View style={styles.compactInputRow}>
              <TextInput
                style={[styles.input, styles.compactInput]}
                value={globalHp}
                onChangeText={value => setGlobalHp(onlyNumberText(value))}
                onFocus={() => globalHp === '0' && setGlobalHp('')}
                onBlur={() => !globalHp && setGlobalHp('1')}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.35)"
                selectTextOnFocus
                textAlign="center"
              />
              <TouchableOpacity style={styles.secondaryButton} onPress={() => handleGlobalHp('damage')}>
                <Ionicons name="flash-outline" size={18} color="#00bfff" />
                <Text style={styles.secondaryButtonText}>Dano global</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => handleGlobalHp('heal')}>
                <Ionicons name="medkit-outline" size={18} color="#00bfff" />
                <Text style={styles.secondaryButtonText}>Cura global</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.mutedSmallText}>
              {targetPlayers.length > 0 ? `Aplica em ${targetPlayers.length} ficha(s).` : 'Sem jogadores vinculados.'}
            </Text>
          </View>

          <View style={styles.globalRewardBox}>
            <Text style={styles.coinApplyLabel}>MOEDAS GLOBAIS</Text>
            <View style={styles.coinInputGrid}>
              {(['gp', 'sp', 'cp'] as const).map(coin => (
                <View key={coin} style={styles.coinInputBox}>
                  <Text style={styles.coinMiniLabel}>{coin === 'gp' ? 'PO' : coin === 'sp' ? 'PP' : 'PC'}</Text>
                  <TextInput
                    style={[styles.input, styles.coinInput]}
                    value={globalCoins[coin]}
                    onChangeText={value => setGlobalCoins(prev => ({ ...prev, [coin]: onlyNumberText(value) }))}
                    onFocus={() => globalCoins[coin] === '0' && setGlobalCoins(prev => ({ ...prev, [coin]: '' }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    selectTextOnFocus
                    textAlign="center"
                  />
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.secondaryWideButton} onPress={handleGlobalCoins}>
              <Ionicons name="git-branch-outline" size={18} color="#00bfff" />
              <Text style={styles.secondaryButtonText}>Dividir moedas</Text>
            </TouchableOpacity>
          </View>
        </View>

        {players.length === 0 ? (
          <Text style={styles.emptyText}>Jogadores conectados aparecem aqui. Cada jogador deve vincular ou criar uma ficha para liberar o card completo.</Text>
        ) : (
          <View style={styles.playerCardsList}>
            {players.map(player => {
              const hasCharacter = Boolean(player.character_id);
              const snapshot = playerSnapshot(player);
              const hpPercent = snapshot.hpMax > 0 ? Math.max(0, Math.min(100, (snapshot.hpCurrent / snapshot.hpMax) * 100)) : 0;
              const amountValue = getCardAmount(player);
              const coinsValue = getCardCoins(player);
              const expanded = getExpanded(player);
              const buff = getCardBuff(player);
              const tempHp = getCardTempHp(player);
              const itemSearch = cardItemSearch[playerActionKey(player)] || '';
              const itemMatches = itemCatalog
                .filter(item => item.name.toLowerCase().includes(itemSearch.toLowerCase()))
                .slice(0, 8);
              const equippedPreview = snapshot.equipped.map(itemLabel).filter(Boolean);
              const bagPreview = snapshot.equipment.bag.map(itemLabel).filter(Boolean);
              const displayName = snapshot.raw?.name || snapshot.data?.name || player.character_name || (hasCharacter ? 'Personagem sem nome' : player.player_name || 'Jogador');
              const playerLabel = player.player_name && player.player_name !== displayName ? player.player_name : 'Jogador';
              const avatarUri = playerAvatarSource(snapshot, displayName);

              return (
                <View key={playerActionKey(player)} style={[styles.playerSheetCard, !hasCharacter && styles.playerSheetCardDisabled]}>
                  <View style={styles.playerSheetHeader}>
                    <View style={styles.playerSheetIdentityBlock}>
                      <Image source={{ uri: avatarUri }} style={[styles.playerSheetAvatar, !hasCharacter && styles.playerSheetAvatarMuted]} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.playerIdentityRow}>
                        <Text style={styles.playerSheetName} numberOfLines={1}>{displayName}</Text>
                        <View style={[styles.dot, player.connected ? styles.dotOn : styles.dotOff]} />
                      </View>
                      <Text style={styles.playerSheetSub} numberOfLines={1}>
                        {hasCharacter
                          ? `${playerLabel} / Nv. ${snapshot.level} / ${snapshot.race || 'Raça'} / ${snapshot.className || 'Classe'}`
                          : 'Aguardando vínculo/criação da ficha'}
                      </Text>
                      </View>
                    </View>
                    {hasCharacter && (
                      <View style={styles.cardHeaderActions}>
                        <TouchableOpacity style={styles.viewSheetButton} onPress={() => openPlayerSheetFromMaster(player)}>
                          <Ionicons name="document-text-outline" size={16} color="#00bfff" />
                          <Text style={styles.viewSheetText}>Ficha</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.expandToggleButton} onPress={() => toggleExpanded(player)} activeOpacity={0.75}>
                          <Ionicons name={expanded ? 'chevron-up-circle' : 'chevron-down-circle'} size={19} color="#02112b" />
                          <Text style={styles.expandToggleText}>{expanded ? 'Recuar' : 'Expandir'}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {!hasCharacter ? (
                    <Text style={styles.playerToolWarning}>Este jogador ainda não vinculou uma ficha. As ações do mestre ficam bloqueadas até o vínculo.</Text>
                  ) : (
                    <>
                      <View style={styles.hpBlock}>
                        <View style={styles.metricHeaderRow}>
                          <Text style={styles.metricLabel}>VIDA</Text>
                          <Text style={styles.metricValue}>{snapshot.hpCurrent}/{snapshot.hpMax} PV</Text>
                        </View>
                        <View style={styles.hpTrack}>
                          <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
                        </View>
                      </View>

                      <View style={styles.quickMetricGrid}>
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => setMasterModal({ kind: 'xp', player })}>
                          <Text style={styles.quickMetricLabel}>XP</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.xp}</Text>
                        </TouchableOpacity>
                        <View style={styles.quickMetricBox}>
                          <Text style={styles.quickMetricLabel}>NIVEL</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.level}</Text>
                        </View>
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => setMasterModal({ kind: 'tempHp', player })}>
                          <Text style={styles.quickMetricLabel}>PV TEMP</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.hpTemp}</Text>
                        </TouchableOpacity>
                      </View>

                      {expanded && (
                      <View style={styles.quickMetricGrid}>
                        <View style={styles.quickMetricBox}>
                          <Text style={styles.quickMetricLabel}>PO</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.gp}</Text>
                        </View>
                        <View style={styles.quickMetricBox}>
                          <Text style={styles.quickMetricLabel}>PP</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.sp}</Text>
                        </View>
                        <View style={styles.quickMetricBox}>
                          <Text style={styles.quickMetricLabel}>PC</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.cp}</Text>
                        </View>
                      </View>
                      )}

                      {expanded && snapshot.activeEffects.length > 0 && (
                        <TouchableOpacity style={[styles.effectPreviewBox, { borderColor: effectColor(snapshot.activeEffects[0], 'rgba(255,209,102,0.25)') }]} onPress={() => setMasterModal({ kind: 'effects', player })}>
                          <Ionicons name="sparkles-outline" size={14} color={effectColor(snapshot.activeEffects[0])} />
                          <Text style={styles.effectPreviewText} numberOfLines={1}>
                            {snapshot.activeEffects.map(effectLabel).join(' / ')}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {expanded && (
                        <>
                      <Text style={styles.cardSectionLabel}>Atributos</Text>
                      <View style={styles.statsChipGrid}>
                        {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(stat => (
                          <TouchableOpacity key={stat} style={[styles.statChip, buff.stat === stat && styles.statChipActive]} onPress={() => {
                            setCardBuffValue(player, { stat });
                            setMasterModal({ kind: 'attribute', player, stat });
                          }}>
                            <Text style={styles.statChipLabel}>{stat}</Text>
                            <Text style={styles.statChipValue}>{statValue(snapshot.stats, stat)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={styles.cardSectionLabel}>Equipado no momento</Text>
                      {equippedPreview.length > 0 ? (
                        <View style={styles.itemChipWrap}>
                          {equippedPreview.slice(0, 8).map((label, index) => (
                            <View key={`${label}-${index}`} style={styles.equippedChip}>
                              <Ionicons name="shield-checkmark-outline" size={13} color="#00fa9a" />
                              <Text style={styles.equippedChipText} numberOfLines={1}>{label}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.mutedSmallText}>Nenhum item equipado.</Text>
                      )}

                      <Text style={styles.cardSectionLabel}>Itens na mochila</Text>
                      {bagPreview.length > 0 ? (
                        <Text style={styles.bagPreviewText} numberOfLines={2}>
                          {bagPreview.slice(0, 8).join(' • ')}{bagPreview.length > 8 ? ` • +${bagPreview.length - 8}` : ''}
                        </Text>
                      ) : (
                        <Text style={styles.mutedSmallText}>Mochila vazia.</Text>
                      )}

                      <View style={styles.masterCardActionGrid}>
                        <TouchableOpacity style={styles.masterCardActionButton} onPress={() => setMasterModal({ kind: 'tempHp', player })}>
                          <Ionicons name="heart-circle-outline" size={16} color="#00bfff" />
                          <Text style={styles.masterCardActionText}>PV temp.</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.masterCardActionButton} onPress={() => setMasterModal({ kind: 'item', player })}>
                          <Ionicons name="bag-add-outline" size={16} color="#00bfff" />
                          <Text style={styles.masterCardActionText}>Enviar item</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.masterCardActionButton} onPress={() => setMasterModal({ kind: 'xp', player })}>
                          <Ionicons name="sparkles-outline" size={16} color="#00bfff" />
                          <Text style={styles.masterCardActionText}>XP</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.masterCardActionButton} onPress={() => setMasterModal({ kind: 'effects', player })}>
                          <Ionicons name="close-circle-outline" size={16} color="#00bfff" />
                          <Text style={styles.masterCardActionText}>Efeitos</Text>
                        </TouchableOpacity>
                      </View>

                        </>
                      )}

                      <View style={styles.cardActionBlock}>
                        <Text style={styles.cardSectionLabel}>Ações rápidas</Text>
                        <View style={styles.compactInputRow}>
                          <TextInput
                            style={[styles.input, styles.compactInput]}
                            value={amountValue}
                            onChangeText={value => setCardAmount(player, value)}
                            onFocus={() => amountValue === '1' && setCardAmount(player, '')}
                            keyboardType="numeric"
                            placeholder="Valor"
                            placeholderTextColor="rgba(255,255,255,0.35)"
                            selectTextOnFocus
                            textAlign="center"
                          />
                          <TouchableOpacity style={styles.secondaryButton} onPress={() => handleMasterHpForPlayer(player, 'damage')}>
                            <Ionicons name="flash-outline" size={18} color="#00bfff" />
                            <Text style={styles.secondaryButtonText}>Dano</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.secondaryButton} onPress={() => handleMasterHpForPlayer(player, 'heal')}>
                            <Ionicons name="medkit-outline" size={18} color="#00bfff" />
                            <Text style={styles.secondaryButtonText}>Cura</Text>
                          </TouchableOpacity>
                        </View>
                        {expanded && (
                          <>
                        <TouchableOpacity style={styles.secondaryWideButton} onPress={() => handleMasterXpForPlayer(player)}>
                          <Ionicons name="sparkles-outline" size={18} color="#00bfff" />
                          <Text style={styles.secondaryButtonText}>Aplicar XP pelo valor acima</Text>
                        </TouchableOpacity>

                        <View style={styles.coinApplyBox}>
                          <Text style={styles.coinApplyLabel}>MOEDAS DO JOGADOR</Text>
                          <View style={styles.coinInputGrid}>
                            {(['gp', 'sp', 'cp'] as const).map(coin => (
                              <View key={coin} style={styles.coinInputBox}>
                                <Text style={styles.coinMiniLabel}>{coin === 'gp' ? 'PO' : coin === 'sp' ? 'PP' : 'PC'}</Text>
                                <TextInput
                                  style={[styles.input, styles.coinInput]}
                                  value={coinsValue[coin]}
                                  onChangeText={value => setCardCoinValue(player, coin, value)}
                                  onFocus={() => coinsValue[coin] === '0' && setCardCoinValue(player, coin, '')}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="rgba(255,255,255,0.35)"
                                  selectTextOnFocus
                                  textAlign="center"
                                />
                              </View>
                            ))}
                          </View>
                          <TouchableOpacity style={styles.secondaryWideButton} onPress={() => handleMasterCoinsForPlayer(player)}>
                            <Ionicons name="cash-outline" size={18} color="#00bfff" />
                            <Text style={styles.secondaryButtonText}>Aplicar moedas neste jogador</Text>
                          </TouchableOpacity>
                        </View>
                          </>
                        )}
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const renderPlayerRequests = () => {
    if (!activeSession || activeSession.role !== 'player' || !activeSession.linked_character_id) return null;

    return (
      <>
        {pendingTradeOffers.length > 0 && (
          <View style={styles.pendingRequestsBox}>
            <View style={styles.sectionHeader}>
              <Text style={styles.playersTitle}>Propostas recebidas</Text>
              <Text style={styles.pendingCount}>{pendingTradeOffers.length}</Text>
            </View>
            {pendingTradeOffers.map(event => {
              const payload = (event.payload || {}) as any;
              const itemName = payload.itemName || payload.item?.name || 'item';
              const qty = Math.max(1, numericValue(String(payload.quantity || 1), 1));
              const sourceName = payload.sourceName || event.actorName || 'Personagem';
              return (
                <View key={event.commandId || event.eventId} style={styles.pendingRequestCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendingRequestTitle}>{sourceName}</Text>
                    <Text style={styles.pendingRequestText}>
                      Ofereceu {qty}x {itemName}. Responda com item, moedas ou nada.
                    </Text>
                  </View>
                  <View style={styles.pendingRequestActions}>
                    <TouchableOpacity style={styles.approveRequestButton} onPress={() => openTradeModal(event)}>
                      <Ionicons name="swap-horizontal" size={16} color="#02112b" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.denyRequestButton} onPress={() => handleDeclineTrade(event)}>
                      <Ionicons name="close" size={16} color="#ff6666" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {pendingTradeCounters.length > 0 && (
          <View style={styles.pendingRequestsBox}>
            <View style={styles.sectionHeader}>
              <Text style={styles.playersTitle}>Contrapropostas</Text>
              <Text style={styles.pendingCount}>{pendingTradeCounters.length}</Text>
            </View>
            {pendingTradeCounters.map(event => {
              const payload = (event.payload || {}) as any;
              const targetName = payload.targetName || event.actorName || 'Personagem';
              const offeredName = payload.offeredItemName || payload.offeredItem?.name || 'item';
              const offeredQty = Math.max(1, numericValue(String(payload.offeredQuantity || 1), 1));
              const counterLabel = tradePartsLabel(payload.counterItem, Number(payload.counterQuantity || 0), payload.coins);
              return (
                <View key={event.commandId || event.eventId} style={styles.pendingRequestCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendingRequestTitle}>{targetName}</Text>
                    <Text style={styles.pendingRequestText}>
                      Aceitou receber {offeredQty}x {offeredName} e oferecer {counterLabel}. Confirme para executar.
                    </Text>
                  </View>
                  <View style={styles.pendingRequestActions}>
                    <TouchableOpacity style={styles.approveRequestButton} onPress={() => openTradeConfirmModal(event)}>
                      <Ionicons name="checkmark" size={16} color="#02112b" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.denyRequestButton} onPress={() => handleDeclineTrade(event)}>
                      <Ionicons name="close" size={16} color="#ff6666" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.toolsBox}>
          <Text style={styles.playersTitle}>Solicitar ao mestre</Text>
          <View style={styles.compactInputRow}>
            <TextInput
              style={[styles.input, styles.compactInput]}
              value={playerRequestAmount}
              onChangeText={value => setPlayerRequestAmount(onlyNumberText(value))}
              onFocus={() => playerRequestAmount === '1' && setPlayerRequestAmount('')}
              keyboardType="numeric"
              placeholder="Valor"
              placeholderTextColor="rgba(255,255,255,0.35)"
              selectTextOnFocus
              textAlign="center"
            />
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handlePlayerRequest('PLAYER_REQUEST_HP')}>
              <Ionicons name="heart-outline" size={18} color="#00bfff" />
              <Text style={styles.secondaryButtonText}>PV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handlePlayerRequest('PLAYER_REQUEST_XP')}>
              <Ionicons name="sparkles-outline" size={18} color="#00bfff" />
              <Text style={styles.secondaryButtonText}>XP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handlePlayerRequest('PLAYER_REQUEST_COINS')}>
              <Ionicons name="cash-outline" size={18} color="#00bfff" />
              <Text style={styles.secondaryButtonText}>Moedas</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  };

  const renderTradeModal = () => {
    if (!tradeModal) return null;
    const payload = (tradeModal.payload || {}) as any;
    const isConfirmingCounter = tradeModal.eventType === 'TRADE_COUNTERED';
    const offeredItemName = isConfirmingCounter
      ? payload.offeredItemName || payload.offeredItem?.name || 'item'
      : payload.itemName || payload.item?.name || 'item';
    const offeredQty = Math.max(1, numericValue(String(isConfirmingCounter ? payload.offeredQuantity || 1 : payload.quantity || 1), 1));
    const sourceName = payload.sourceName || tradeModal.actorName || 'Personagem';
    const counterName = payload.targetName || tradeModal.actorName || 'Personagem';
    const counterLabel = tradePartsLabel(payload.counterItem, Number(payload.counterQuantity || 0), payload.coins);
    const selectedItem = tradeCounterItemIndex !== null ? tradeCounterItems[tradeCounterItemIndex] : null;
    const selectedMaxQty = Math.max(1, Number(selectedItem?.qty || 1));
    const selectedCounterLabel = tradePartsLabel(selectedItem, selectedItem ? Math.max(1, Math.min(Number(selectedItem.qty || 1), numericValue(tradeCounterQty, 1))) : 0, {
      gp: numericValue(tradeCoins.gp, 0),
      sp: numericValue(tradeCoins.sp, 0),
      cp: numericValue(tradeCoins.cp, 0),
    });

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setTradeModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setTradeModal(null)}>
          <Pressable style={styles.masterModalContent} onPress={event => event.stopPropagation()}>
            <View style={styles.masterModalHeader}>
              <Text style={styles.masterModalTitle}>{isConfirmingCounter ? 'Confirmar troca' : 'Responder troca'}</Text>
              <TouchableOpacity style={styles.modalIconButton} onPress={() => setTradeModal(null)}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalHint}>
                {isConfirmingCounter
                  ? `${counterName} respondeu oferecendo ${counterLabel}. Confirme para executar a troca.`
                  : `${sourceName} ofereceu ${offeredQty}x ${offeredItemName}.`}
              </Text>

              <View style={styles.tradeBoard}>
                <View style={styles.tradeSidePanel}>
                  <Text style={styles.tradeSideLabel}>{isConfirmingCounter ? 'ENVIAR' : 'RECEBER'}</Text>
                  <View style={styles.tradeSlotFilled}>
                    <Ionicons name="cube-outline" size={18} color="#00fa9a" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tradeItemName}>{offeredItemName}</Text>
                      <Text style={styles.tradeItemQty}>x{offeredQty}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.tradeSidePanel}>
                  <Text style={styles.tradeSideLabel}>{isConfirmingCounter ? 'RECEBER' : 'ENVIAR'}</Text>
                  <View style={isConfirmingCounter && counterLabel !== 'Nada' ? styles.tradeSlotFilled : styles.tradeSlotEmpty}>
                    <Ionicons name={isConfirmingCounter && counterLabel !== 'Nada' ? 'cube-outline' : 'swap-horizontal-outline'} size={18} color={isConfirmingCounter && counterLabel !== 'Nada' ? '#00fa9a' : 'rgba(255,255,255,0.5)'} />
                    <Text style={styles.tradeItemQty}>{isConfirmingCounter ? counterLabel : selectedCounterLabel}</Text>
                  </View>
                </View>
              </View>

              {!isConfirmingCounter && (
                <>
                  <Text style={styles.modalFieldLabel}>SUA MOCHILA</Text>
                  <View style={styles.tradeItemList}>
                    <TouchableOpacity
                      style={[styles.tradeItemRow, tradeCounterItemIndex === null && styles.tradeItemRowActive]}
                      onPress={() => {
                        setTradeCounterItemIndex(null);
                        setTradeCounterQty('1');
                      }}
                    >
                      <Text style={styles.tradeItemName}>Nada</Text>
                      <Text style={styles.tradeItemQty}>sem item</Text>
                    </TouchableOpacity>
                    {tradeCounterItems.length === 0 ? (
                      <Text style={styles.emptyText}>Nenhum item disponivel.</Text>
                    ) : (
                      tradeCounterItems.map((item, index) => (
                        <TouchableOpacity
                          key={`${item?.name || 'item'}-${index}`}
                          style={[styles.tradeItemRow, tradeCounterItemIndex === index && styles.tradeItemRowActive]}
                          onPress={() => {
                            setTradeCounterItemIndex(index);
                            setTradeCounterQty('1');
                          }}
                        >
                          <Text style={styles.tradeItemName}>{item?.name || 'Item'}</Text>
                          <Text style={styles.tradeItemQty}>x{Number(item?.qty || 1)}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>

                  {selectedItem && (
                    <>
                      <Text style={styles.modalFieldLabel}>QUANTIDADE</Text>
                      <TextInput
                        style={[styles.input, styles.modalNumberInput]}
                        value={tradeCounterQty}
                        onChangeText={value => setTradeCounterQty(onlyNumberText(value))}
                        onFocus={() => tradeCounterQty === '1' && setTradeCounterQty('')}
                        keyboardType="numeric"
                        placeholder={`1 a ${selectedMaxQty}`}
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        selectTextOnFocus
                      />
                    </>
                  )}

                  <Text style={styles.modalFieldLabel}>MOEDAS EM TROCA</Text>
                  <View style={styles.coinInputGrid}>
                    {(['gp', 'sp', 'cp'] as const).map(type => (
                      <View key={type} style={styles.coinInputBox}>
                        <Text style={styles.coinMiniLabel}>{type.toUpperCase()}</Text>
                        <TextInput
                          style={[styles.input, styles.coinInput]}
                          value={tradeCoins[type]}
                          onChangeText={value => setTradeCoins(prev => ({ ...prev, [type]: onlyNumberText(value) }))}
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

              <TouchableOpacity style={styles.primaryWideButton} onPress={handleAcceptTrade}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#02112b" />
                <Text style={styles.primaryWideButtonText}>{isConfirmingCounter ? 'Confirmar e trocar' : 'Enviar resposta'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerWideButton} onPress={() => handleDeclineTrade(tradeModal)}>
                <Ionicons name="close-circle-outline" size={18} color="#ff6666" />
                <Text style={styles.dangerButtonText}>Recusar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryWideButton} onPress={() => setTradeModal(null)}>
                <Ionicons name="time-outline" size={18} color="#00bfff" />
                <Text style={styles.secondaryButtonText}>Ignorar por enquanto</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderMasterModal = () => {
    if (!masterModal) return null;
    const player = masterModal.player;
    const hasPlayer = Boolean(player?.character_id);
    const snapshot = hasPlayer ? playerSnapshot(player) : null;
    const buff = hasPlayer ? getCardBuff(player) : null;
    const tempHp = hasPlayer ? getCardTempHp(player) : null;
    const amountValue = hasPlayer ? getCardAmount(player) : '';
    const itemSearch = hasPlayer ? cardItemSearch[playerActionKey(player)] || '' : '';
    const itemMatches = itemCatalog
      .filter(item => item.name.toLowerCase().includes(itemSearch.toLowerCase()))
      .slice(0, 12);
    const effectMatches = effectCatalog
      .filter(effect => effect.name.toLowerCase().includes(effectSearch.toLowerCase()) || String(effect.description || '').toLowerCase().includes(effectSearch.toLowerCase()))
      .slice(0, 20);
    const titleByKind: Record<MasterModalKind, string> = {
      attribute: `Buff em ${masterModal.stat || buff?.stat || 'atributo'}`,
      tempHp: 'Vida temporaria',
      xp: 'Adicionar XP',
      item: 'Enviar item',
      sheet: player?.character_name || 'Ficha do jogador',
      time: 'Tempo da mesa',
      effects: 'Efeitos ativos',
      applyEffect: hasPlayer ? `Aplicar efeito em ${player.character_name || 'Personagem'}` : 'Aplicar efeito na party',
    };

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setMasterModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMasterModal(null)}>
          <Pressable style={styles.masterModalContent} onPress={event => event.stopPropagation()}>
            <View style={styles.masterModalHeader}>
              <Text style={styles.masterModalTitle}>{titleByKind[masterModal.kind]}</Text>
              <TouchableOpacity style={styles.modalIconButton} onPress={() => setMasterModal(null)}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {masterModal.kind === 'attribute' && hasPlayer && buff && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalHint}>Aplicar em {player.character_name || 'Personagem'}</Text>
                <Text style={styles.modalFieldLabel}>Valor do buff</Text>
                <TextInput
                  style={[styles.input, styles.fullInput]}
                  value={buff.amount}
                  onChangeText={value => setCardBuffValue(player, { amount: onlyNumberText(value) })}
                  onFocus={() => buff.amount === '1' && setCardBuffValue(player, { amount: '' })}
                  keyboardType="numeric"
                  placeholder="+0"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  selectTextOnFocus
                />
                <View style={styles.compactInputRow}>
                  <TouchableOpacity style={[styles.modeChip, buff.mode === 'temporary' && styles.modeChipActive]} onPress={() => setCardBuffValue(player, { mode: 'temporary' })}>
                    <Text style={[styles.modeChipText, buff.mode === 'temporary' && styles.modeChipTextActive]}>Temporario</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modeChip, buff.mode === 'permanent' && styles.modeChipPermanent]} onPress={() => setCardBuffValue(player, { mode: 'permanent' })}>
                    <Text style={[styles.modeChipText, buff.mode === 'permanent' && styles.modeChipPermanentText]}>Permanente</Text>
                  </TouchableOpacity>
                </View>
                {buff.mode === 'temporary' && (
                  <>
                    <Text style={styles.modalFieldLabel}>Duracao</Text>
                    <View style={styles.durationChipWrap}>
                      {['turn', 'minute', 'hour', 'short_rest', 'long_rest'].map(unit => (
                        <TouchableOpacity key={unit} style={[styles.durationChip, buff.durationUnit === unit && styles.durationChipActive]} onPress={() => setCardBuffValue(player, { durationUnit: unit })}>
                          <Text style={[styles.durationChipText, buff.durationUnit === unit && styles.durationChipTextActive]}>{durationLabel(unit)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {['turn', 'minute', 'hour'].includes(buff.durationUnit) && (
                      <TextInput
                        style={[styles.input, styles.fullInput]}
                        value={buff.durationValue}
                        onChangeText={value => setCardBuffValue(player, { durationValue: onlyNumberText(value) })}
                        onFocus={() => buff.durationValue === '1' && setCardBuffValue(player, { durationValue: '' })}
                        keyboardType="numeric"
                        placeholder="Duracao"
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        selectTextOnFocus
                      />
                    )}
                  </>
                )}
                <TouchableOpacity style={styles.secondaryWideButton} onPress={() => handleMasterAttributeForPlayer(player)}>
                  <Ionicons name="analytics-outline" size={18} color="#00bfff" />
                  <Text style={styles.secondaryButtonText}>Aplicar em {buff.stat}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {masterModal.kind === 'tempHp' && hasPlayer && tempHp && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalHint}>Aplicar em {player.character_name || 'Personagem'}</Text>
                <View style={styles.modalInputGrid}>
                  <View style={styles.modalInputBox}>
                    <Text style={styles.modalFieldLabel}>PV temporario</Text>
                    <TextInput style={[styles.input, styles.modalNumberInput]} value={tempHp.amount} onChangeText={value => setCardTempHpValue(player, { amount: onlyNumberText(value) })} onFocus={() => tempHp.amount === '1' && setCardTempHpValue(player, { amount: '' })} keyboardType="numeric" placeholder="PV" placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus textAlign="center" />
                  </View>
                  <View style={styles.modalInputBox}>
                    <Text style={styles.modalFieldLabel}>Quantidade</Text>
                    <TextInput style={[styles.input, styles.modalNumberInput]} value={tempHp.durationValue} onChangeText={value => setCardTempHpValue(player, { durationValue: onlyNumberText(value) })} onFocus={() => tempHp.durationValue === '1' && setCardTempHpValue(player, { durationValue: '' })} keyboardType="numeric" placeholder="Dur." placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus textAlign="center" />
                  </View>
                </View>
                <Text style={styles.modalFieldLabel}>Tipo de duracao</Text>
                <View style={styles.durationChipWrap}>
                  {['turn', 'minute', 'hour', 'short_rest', 'long_rest'].map(unit => (
                    <TouchableOpacity key={unit} style={[styles.durationChip, tempHp.durationUnit === unit && styles.durationChipActive]} onPress={() => setCardTempHpValue(player, { durationUnit: unit })}>
                      <Text style={[styles.durationChipText, tempHp.durationUnit === unit && styles.durationChipTextActive]}>{durationLabel(unit)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.secondaryWideButton} onPress={() => handleMasterTempHpForPlayer(player)}>
                  <Ionicons name="heart-circle-outline" size={18} color="#00bfff" />
                  <Text style={styles.secondaryButtonText}>Aplicar PV temporario</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {masterModal.kind === 'xp' && hasPlayer && (
              <View>
                <Text style={styles.modalHint}>XP atual: {snapshot?.xp || 0}</Text>
                <Text style={styles.modalFieldLabel}>XP a adicionar</Text>
                <TextInput style={[styles.input, styles.fullInput]} value={amountValue} onChangeText={value => setCardAmount(player, value)} onFocus={() => amountValue === '1' && setCardAmount(player, '')} keyboardType="numeric" placeholder="XP" placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus />
                <TouchableOpacity style={styles.secondaryWideButton} onPress={() => handleMasterXpForPlayer(player)}>
                  <Ionicons name="sparkles-outline" size={18} color="#00bfff" />
                  <Text style={styles.secondaryButtonText}>Adicionar XP</Text>
                </TouchableOpacity>
              </View>
            )}

            {masterModal.kind === 'item' && hasPlayer && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalFieldLabel}>Quantidade</Text>
                <TextInput style={[styles.input, styles.fullInput]} value={amountValue} onChangeText={value => setCardAmount(player, value)} onFocus={() => amountValue === '1' && setCardAmount(player, '')} keyboardType="numeric" placeholder="1" placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus />
                <Text style={styles.modalFieldLabel}>Buscar item</Text>
                <TextInput style={[styles.input, styles.fullInput]} value={itemSearch} onChangeText={value => setCardItemSearch(prev => ({ ...prev, [playerActionKey(player)]: value }))} placeholder="Buscar item" placeholderTextColor="rgba(255,255,255,0.35)" />
                <View style={styles.itemSendList}>
                  {itemMatches.map(item => (
                    <TouchableOpacity key={item.id} style={styles.itemSendRow} onPress={() => handleMasterGiveItem(player, item, Math.max(1, numericValue(amountValue, 1)))}>
                      <Text style={styles.itemSendName} numberOfLines={1}>{item.name}</Text>
                      <Ionicons name="send-outline" size={16} color="#00fa9a" />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            {masterModal.kind === 'sheet' && snapshot && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetModalName}>{player.character_name || 'Personagem'}</Text>
                <Text style={styles.modalHint}>Nv. {snapshot.level} / {snapshot.race || 'Raca'} / {snapshot.className || 'Classe'}</Text>
                <Text style={styles.cardSectionLabel}>Vida</Text>
                <Text style={styles.sheetModalText}>{snapshot.hpCurrent}/{snapshot.hpMax} PV / {snapshot.hpTemp} temp.</Text>
                <Text style={styles.cardSectionLabel}>Atributos</Text>
                <View style={styles.statsChipGrid}>
                  {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(stat => (
                    <View key={stat} style={styles.statChip}>
                      <Text style={styles.statChipLabel}>{stat}</Text>
                      <Text style={styles.statChipValue}>{statValue(snapshot.stats, stat)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.cardSectionLabel}>Historia</Text>
                <Text style={styles.sheetModalText}>{String(snapshot.data?.backstory || snapshot.data?.personalityTraits || 'Sem historia preenchida.')}</Text>
                <Text style={styles.cardSectionLabel}>Pericias / idiomas</Text>
                <Text style={styles.sheetModalText}>{String(snapshot.data?.languages || 'Sem idiomas registrados.')}</Text>
              </ScrollView>
            )}

            {masterModal.kind === 'effects' && snapshot && hasPlayer && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <TouchableOpacity style={[styles.secondaryWideButton, { marginBottom: 12 }]} onPress={() => setMasterModal({ kind: 'applyEffect', player })}>
                  <Ionicons name="color-wand-outline" size={18} color="#00bfff" />
                  <Text style={styles.secondaryButtonText}>Aplicar novo efeito</Text>
                </TouchableOpacity>
                {snapshot.activeEffects.length === 0 ? (
                  <Text style={styles.modalHint}>Este jogador nao possui efeitos ativos.</Text>
                ) : (
                  snapshot.activeEffects.map((effect: any) => (
                    <View key={String(effect.id)} style={[styles.effectManageRow, { borderColor: effectColor(effect, 'rgba(255,209,102,0.2)') }]}>
                      <View style={[styles.effectColorDot, { backgroundColor: effectColor(effect) }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.effectManageTitle}>{effectLabel(effect)}</Text>
                        <Text style={styles.effectManageSub}>{effect.kind === 'temp_hp' ? 'PV temporario' : effect.kind === 'attribute' ? 'Buff de atributo' : 'Efeito'}</Text>
                      </View>
                      <TouchableOpacity style={styles.effectRemoveButton} onPress={() => handleMasterRemoveEffect(player, String(effect.id))}>
                        <Ionicons name="trash-outline" size={17} color="#ff6666" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            {masterModal.kind === 'applyEffect' && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalHint}>
                  {hasPlayer ? `Alvo: ${player.character_name || 'Personagem'}` : `Alvo: toda a party (${targetPlayers.length})`}
                </Text>
                <Text style={styles.modalFieldLabel}>Buscar efeito</Text>
                <TextInput
                  style={[styles.input, styles.fullInput]}
                  value={effectSearch}
                  onChangeText={setEffectSearch}
                  placeholder="Buscar condicao, aura, veneno..."
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />

                {selectedEffectIds.length > 0 && (
                  <View style={styles.selectedEffectsBox}>
                    <Text style={styles.selectedEffectsTitle}>{selectedEffectIds.length} efeito(s) selecionado(s)</Text>
                    <TouchableOpacity onPress={() => setSelectedEffectIds([])}>
                      <Text style={styles.clearSelectionText}>Limpar</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.effectCatalogList}>
                  {effectMatches.map(effect => {
                    const selected = selectedEffectIds.includes(effect.id);
                    return (
                      <TouchableOpacity key={effect.id} style={[styles.effectCatalogRow, selected && styles.effectCatalogRowActive, { borderColor: selected ? effect.color : 'rgba(255,255,255,0.08)' }]} onPress={() => toggleSelectedEffect(effect.id)}>
                        <View style={[styles.effectCatalogCheck, { backgroundColor: selected ? effect.color : 'rgba(255,255,255,0.08)' }]}>
                          {selected ? <Ionicons name="checkmark" size={17} color="#02112b" /> : <View style={[styles.effectColorDot, { backgroundColor: effect.color }]} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.effectCatalogKind, { color: effect.color }]}>CONDICAO</Text>
                          <Text style={styles.effectCatalogName}>{effect.name}</Text>
                          <Text style={styles.effectCatalogDescription} numberOfLines={3}>{effect.description || 'Sem descricao cadastrada.'}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {effectMatches.length === 0 && <Text style={styles.modalHint}>Nenhum efeito encontrado no catalogo.</Text>}
                </View>

                <View style={styles.selectedEffectsBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedEffectsTitle}>Aplicacao</Text>
                    <Text style={styles.effectCatalogDescription}>Ajuste a duracao antes de aplicar.</Text>
                  </View>
                </View>

                <View style={styles.modalInputGrid}>
                  <View style={styles.modalInputBox}>
                    <Text style={styles.modalFieldLabel}>Tempo</Text>
                    <TextInput style={[styles.input, styles.modalNumberInput]} value={effectDurationValue} onChangeText={value => setEffectDurationValue(onlyNumberText(value))} keyboardType="numeric" placeholder="3" placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus textAlign="center" />
                  </View>
                </View>
                <View style={styles.durationChipWrap}>
                  {(['turn', 'minute', 'hour', 'short_rest', 'long_rest'] as const).map(unit => (
                    <TouchableOpacity key={unit} style={[styles.durationChip, effectDurationUnit === unit && styles.durationChipActive]} onPress={() => setEffectDurationUnit(unit)}>
                      <Text style={[styles.durationChipText, effectDurationUnit === unit && styles.durationChipTextActive]}>{durationLabel(unit)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.primaryWideButton, (selectedEffectIds.length === 0 || (!hasPlayer && targetPlayers.length === 0)) && styles.disabledButton]}
                  disabled={selectedEffectIds.length === 0 || (!hasPlayer && targetPlayers.length === 0)}
                  onPress={() => handleMasterApplySelectedEffects(hasPlayer ? player : undefined)}
                >
                  <Ionicons name="color-wand-outline" size={18} color="#02112b" />
                  <Text style={styles.primaryWideButtonText}>APLICAR EFEITO</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {masterModal.kind === 'time' && (
              <View>
                <Text style={styles.modalHint}>Turno {campaignTurn} / {Math.floor(campaignMinutes / 60)}h {campaignMinutes % 60}min</Text>
                <Text style={styles.modalFieldLabel}>Quantidade</Text>
                <TextInput style={[styles.input, styles.fullInput]} value={timeAmount} onChangeText={value => setTimeAmount(onlyNumberText(value))} onFocus={() => timeAmount === '10' && setTimeAmount('')} keyboardType="numeric" placeholder="Quantidade" placeholderTextColor="rgba(255,255,255,0.35)" selectTextOnFocus />
                <Text style={styles.modalFieldLabel}>Tipo de passagem</Text>
                <View style={styles.durationChipWrap}>
                  {['turn', 'minute', 'hour', 'short_rest', 'long_rest'].map(unit => (
                    <TouchableOpacity key={unit} style={[styles.durationChip, timeUnit === unit && styles.durationChipActive]} onPress={() => setTimeUnit(unit as any)}>
                      <Text style={[styles.durationChipText, timeUnit === unit && styles.durationChipTextActive]}>{durationLabel(unit)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.secondaryWideButton} onPress={handleAdvanceTime}>
                  <Ionicons name="time-outline" size={18} color="#00bfff" />
                  <Text style={styles.secondaryButtonText}>Aplicar passagem</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderHistory = () => {
    if (!activeSession) return null;

    return (
      <View style={styles.historyBox}>
        <View style={styles.sectionHeader}>
          <Text style={styles.playersTitle}>Histórico da sessão</Text>
          <Text style={styles.historyPageText}>Pag. {historyPage + 1}</Text>
        </View>

        {history.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum evento registrado ainda.</Text>
        ) : (
          history.map(event => (
            <View key={event.eventId} style={styles.historyRow}>
              <Text style={styles.historyTitle}>{event.description}</Text>
              <Text style={styles.historyMeta}>
                #{event.seq} / {event.actorName || 'Sistema'}{event.targetName ? ` -> ${event.targetName}` : ''} / {new Date(event.at).toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}

        <View style={styles.activeActions}>
          <TouchableOpacity
            style={[styles.secondaryButton, historyPage === 0 && styles.disabledButton]}
            disabled={historyPage === 0}
            onPress={() => loadHistory(Math.max(0, historyPage - 1))}
          >
            <Ionicons name="chevron-back" size={18} color="#00bfff" />
            <Text style={styles.secondaryButtonText}>Anterior</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, history.length < 20 && styles.disabledButton]}
            disabled={history.length < 50}
            onPress={() => loadHistory(historyPage + 1)}
          >
            <Text style={styles.secondaryButtonText}>Próxima</Text>
            <Ionicons name="chevron-forward" size={18} color="#00bfff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderActiveSession = () => {
    if (!activeSession) return null;

    if (activeSession.role === 'player') {
      return (
        <View style={styles.activePanel}>
          <View style={styles.activeHeader}>
            <View>
              <Text style={styles.activeEyebrow}>SESSAO LAN / JOGADOR</Text>
              <Text style={styles.activeTitle}>{activeSession.name}</Text>
            </View>
            <View style={[styles.statusBadge, isTransportReady && styles.statusBadgeReady]}>
              <Text style={[styles.statusBadgeText, isTransportReady && styles.statusBadgeTextReady]}>
                {connectionStatus === 'syncing' ? 'SYNC' : connectionStatus === 'reconnecting' ? 'RECONECTANDO' : isTransportReady ? 'LAN ON' : 'LAN OFF'}
              </Text>
            </View>
          </View>

          {activeSession.linked_character_id && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace(`/sheet?id=${activeSession.linked_character_id}`)}>
              <Ionicons name="document-text-outline" size={20} color="#02112b" />
              <Text style={styles.primaryButtonText}>ABRIR MINHA FICHA</Text>
            </TouchableOpacity>
          )}
          {!activeSession.linked_character_id && renderPlayerCharacterGate()}

          {renderHistory()}
          {lastNotice && <Text style={styles.noticeText}>{lastNotice}</Text>}
          {lastError && <Text style={styles.errorText}>{lastError}</Text>}
          {renderSessionControls()}
        </View>
      );
    }

    if (activeSession.status === 'closed') {
      return (
        <View style={styles.activePanel}>
          <View style={styles.activeHeader}>
            <View>
              <Text style={styles.activeEyebrow}>SESSAO ENCERRADA / MESTRE</Text>
              <Text style={styles.activeTitle}>{activeSession.name}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>FECHANDO</Text>
            </View>
          </View>

          <View style={styles.closedSessionBox}>
            <Ionicons name="close-circle-outline" size={34} color="#ff6666" />
            <View style={{ flex: 1 }}>
              <Text style={styles.closedSessionTitle}>Mesa encerrada</Text>
              <Text style={styles.closedSessionText}>
                O host fica aberto apenas por alguns instantes para avisar os jogadores e desvincular as fichas.
              </Text>
            </View>
          </View>

          {lastNotice && <Text style={styles.noticeText}>{lastNotice}</Text>}
          {lastError && <Text style={styles.errorText}>{lastError}</Text>}
          {renderSessionControls()}
        </View>
      );
    }

    return (
      <View style={[styles.activePanel, activeSession.role === 'master' && activeSession.status !== 'paused' && styles.activePanelFull]}>
        <View style={styles.activeHeader}>
          <View>
            <Text style={styles.activeEyebrow}>SESSÃO ATIVA / {activeSession.role === 'master' ? 'MESTRE' : 'JOGADOR'}</Text>
            <Text style={styles.activeTitle}>{activeSession.name}</Text>
          </View>
          <View style={[styles.statusBadge, isTransportReady && styles.statusBadgeReady]}>
            <Text style={[styles.statusBadgeText, isTransportReady && styles.statusBadgeTextReady]}>
              {connectionStatus === 'syncing' ? 'SYNC' : connectionStatus === 'reconnecting' ? 'RECONECTANDO' : isTransportReady ? 'LAN ON' : 'LAN OFF'}
            </Text>
          </View>
        </View>

        {activeSession.role === 'master' && activeSession.session_code && (
          <View style={styles.qrRow}>
            <View style={styles.qrBox}>
              <QRCode value={activeSession.session_code} size={132} backgroundColor="#ffffff" color="#02112b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>CÓDIGO DA SESSÃO</Text>
              <Text style={styles.codeText} selectable>
                {activeSession.id}
              </Text>
              <Text style={styles.networkText}>
                {activeSession.host_ip}:{activeSession.port}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.sessionStatsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.role === 'master' ? peerCount : 1}</Text>
            <Text style={styles.statLabel}>{activeSession.role === 'master' ? 'JOGADORES' : 'MESTRE'}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.sync_custom_content ? 'SIM' : 'NÃO'}</Text>
            <Text style={styles.statLabel}>SYNC CUSTOM</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.allow_existing_character ? 'SIM' : 'NOVO'}</Text>
            <Text style={styles.statLabel}>FICHA</Text>
          </View>
        </View>

        {selectedCharacter && (
          <Text style={styles.linkedText}>
            Vinculado: {selectedCharacter.name} / Nv. {selectedCharacter.level} / {selectedCharacter.class}
          </Text>
        )}

        {renderPlayerCharacterGate()}
        {renderMasterTools()}
        {renderPlayerRequests()}
        {renderHistory()}

        {lastNotice && <Text style={styles.noticeText}>{lastNotice}</Text>}
        {lastError && <Text style={styles.errorText}>{lastError}</Text>}


        {renderSessionControls()}
      </View>
    );
  };

  const renderAdminMenu = () => {
    const hasRunningSession = activeSession && activeSession.status !== 'inactive' && activeSession.status !== 'closed';
    if (hasRunningSession) return null;

    return (
    <View style={styles.adminPanel}>
      <Text style={styles.adminTitle}>Sessão LAN</Text>
      <Text style={styles.adminDescription}>
        Use esta área como central da rede local. Aqui você cria uma mesa como mestre, entra como jogador, acompanha a sessão ativa e acessa o debug.
      </Text>

      <TouchableOpacity style={styles.adminCard} activeOpacity={0.86} onPress={() => navigateOnce('/lan-master-setup')}>
        <View style={styles.adminIconBox}>
          <Ionicons name="shield-half-outline" size={26} color="#00fa9a" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.adminCardTitle}>Criar mesa LAN</Text>
          <Text style={styles.adminCardSub}>Abre uma nova sessão como Mestre/Host e gera código/QR Code para os jogadores.</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.55)" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.adminCard} activeOpacity={0.86} onPress={() => navigateOnce('/lan-player-join')}>
        <View style={styles.adminIconBoxBlue}>
          <Ionicons name="log-in-outline" size={26} color="#00bfff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.adminCardTitle}>Entrar em mesa existente</Text>
          <Text style={styles.adminCardSub}>Conecta este aparelho como jogador usando código da sessão ou QR Code do mestre.</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.55)" />
      </TouchableOpacity>

      {visibleSavedSessions.length > 0 && (
        <View style={styles.savedSessionsBox}>
          <View style={styles.sectionHeader}>
            <Text style={styles.playersTitle}>Mesas salvas</Text>
            <TouchableOpacity onPress={refreshSavedSessions}>
              <Text style={styles.refreshText}>Atualizar</Text>
            </TouchableOpacity>
          </View>
          {visibleSavedSessions.map(session => {
            const color = sessionStatusColor(session);
            const isCurrent = activeSession?.id === session.id;
            const canResume = !isCurrent || !isTransportReady;
            return (
              <View key={session.id} style={styles.savedSessionRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.savedSessionTitleRow}>
                    <Text style={styles.savedSessionTitle} numberOfLines={1}>{session.name || `Mesa ${session.id}`}</Text>
                    <Text style={[styles.savedSessionBadge, { color, borderColor: color }]}>{sessionStatusLabel(session)}</Text>
                  </View>
                  <Text style={styles.savedSessionSub} numberOfLines={1}>
                    {session.role === 'master' ? 'Mestre' : 'Jogador'} / {session.id}{session.linked_character_id ? ` / Ficha #${session.linked_character_id}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.resumeSessionButton, !canResume && styles.disabledButton]}
                  disabled={!canResume}
                  onPress={() => handleResumeSavedSession(session)}
                >
                  <Ionicons name="play-outline" size={16} color="#02112b" />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.adminCard} activeOpacity={0.86} onPress={() => navigateOnce('/tracer')}>
        <View style={styles.adminIconBoxYellow}>
          <Ionicons name="bug-outline" size={26} color="#ffd166" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.adminCardTitle}>Tracer / Debug LAN</Text>
          <Text style={styles.adminCardSub}>Exporta TXT dos logs com função, origem, payload, transporte, banco e erros.</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.55)" />
      </TouchableOpacity>

      {activeSession && (
        <Text style={styles.adminWarning}>
          Atenção: iniciar uma nova mesa pode substituir a sessão LAN ativa neste aparelho.
        </Text>
      )}
    </View>
    );
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>SESSÃO LAN</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderActiveSession()}
          {renderAdminMenu()}
        </ScrollView>
      </KeyboardAvoidingView>
      {renderMasterModal()}
      {renderTradeModal()}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingTop: 50,
    paddingBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  topBarTitle: { color: '#00fa9a', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-start', padding: 20, paddingBottom: 60 },
  adminPanel: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 18, padding: 16 },
  adminTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  adminDescription: { color: 'rgba(255,255,255,0.58)', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    marginBottom: 12,
  },
  adminIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,250,154,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.25)',
  },
  adminIconBoxBlue: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,191,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
  },
  adminIconBoxYellow: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.25)',
  },
  adminCardTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  adminCardSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  adminWarning: { color: '#ffd166', fontSize: 12, lineHeight: 18, marginTop: 2 },
  savedSessionsBox: {
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  savedSessionRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  savedSessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedSessionTitle: { flex: 1, color: '#fff', fontSize: 14, fontWeight: 'bold' },
  savedSessionBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 9, fontWeight: 'bold' },
  savedSessionSub: { color: 'rgba(255,255,255,0.48)', fontSize: 11, marginTop: 4 },
  resumeSessionButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00fa9a' },
  activePanel: {
    backgroundColor: 'rgba(0, 250, 154, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 250, 154, 0.35)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  activePanelFull: {
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: -60,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 70,
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    minHeight: '100%',
  },
  activeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  activeEyebrow: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  activeTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 3 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,100,100,0.12)', flexShrink: 0 },
  statusBadgeReady: { backgroundColor: 'rgba(0,250,154,0.16)' },
  statusBadgeText: { color: '#ff6666', fontSize: 10, fontWeight: 'bold' },
  statusBadgeTextReady: { color: '#00fa9a' },
  qrRow: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 14 },
  qrBox: { backgroundColor: '#fff', borderRadius: 8, padding: 8 },
  codeLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  codeText: { color: '#fff', fontSize: 13, lineHeight: 19, fontWeight: 'bold' },
  networkText: { color: '#00bfff', fontSize: 12, marginTop: 6 },
  sessionStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 'bold', marginTop: 3 },
  linkedText: { color: '#fff', fontSize: 12, marginBottom: 8 },
  noticeText: { color: '#00fa9a', fontSize: 12, marginTop: 4 },
  errorText: { color: '#ff6666', fontSize: 12, marginTop: 4 },
  closedSessionBox: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(255,102,102,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,102,102,0.24)',
  },
  closedSessionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  closedSessionText: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 18 },
  playersBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 },
  toolsBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 },
  historyBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: 12 },
  playersTitle: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', marginBottom: 10 },
  masterBoardPanel: {
    gap: 10,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    backgroundColor: 'rgba(0,191,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.18)',
  },
  sessionBoardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sessionBoardTitleBlock: { flex: 1, minWidth: 0 },
  sessionBoardTitle: { color: '#00bfff', fontSize: 18, fontWeight: 'bold', letterSpacing: 0 },
  sessionOverviewGrid: { flexDirection: 'row', gap: 8 },
  sessionMetricBox: { flex: 1, minHeight: 72, borderRadius: 12, padding: 10, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center' },
  sessionMetricValue: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginTop: 5 },
  sessionActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 4 },
  sessionActionButton: {
    minHeight: 48,
    width: '47.5%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sessionActionText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  turnHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  turnValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  turnSubValue: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 3 },
  turnButtons: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  turnButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(0,191,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.3)',
  },
  globalRewardBox: {
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  playerName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  playerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  compactInputRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  compactInput: { width: 86, minHeight: 44, paddingVertical: 10, textAlign: 'center' },
  coinInput: { width: '100%', minWidth: 0, minHeight: 44, paddingVertical: 10, textAlign: 'center' },
  secondaryWideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
    marginTop: 10,
  },
  primaryWideButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: '#56C3FF',
    marginTop: 14,
  },
  primaryWideButtonText: { color: '#02112b', fontSize: 13, fontWeight: 'bold' },
  dangerWideButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,100,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,100,0.25)',
    marginTop: 10,
  },
  coinApplyBox: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  coinApplyLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 },
  coinInputGrid: { flexDirection: 'row', gap: 8 },
  coinInputBox: { flex: 1, minWidth: 0 },
  coinMiniLabel: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
  tradeItemList: { gap: 8, marginBottom: 10 },
  tradeBoard: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tradeSidePanel: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    borderRadius: 14,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tradeSideLabel: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, textAlign: 'center' },
  tradeSlotFilled: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,250,154,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.32)',
  },
  tradeSlotEmpty: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tradeItemRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  tradeItemRowActive: { backgroundColor: 'rgba(0,250,154,0.12)', borderColor: 'rgba(0,250,154,0.35)' },
  tradeItemName: { flex: 1, color: '#fff', fontSize: 13, fontWeight: 'bold' },
  tradeItemQty: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 'bold' },
  historyRow: {
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  historyTitle: { color: '#fff', fontSize: 12, lineHeight: 17 },
  historyMeta: { color: 'rgba(255,255,255,0.42)', fontSize: 10, marginTop: 4 },
  historyPageText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: '#00fa9a' },
  dotOff: { backgroundColor: '#ff6666' },
  activeActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  section: { marginTop: 12, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 11, fontWeight: 'bold', color: '#00bfff', marginBottom: 8, letterSpacing: 1 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  clearText: { color: '#ff6666', fontSize: 12, fontWeight: 'bold' },
  characterList: { gap: 10, paddingVertical: 2 },
  characterPill: {
    width: 170,
    minHeight: 72,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.23)',
  },
  characterPillActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.1)' },
  characterPillName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  characterPillNameActive: { color: '#00fa9a' },
  characterPillSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 7 },
  characterPillHint: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', marginTop: 10 },
  gateHint: { color: 'rgba(255,255,255,0.52)', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  playerToolCard: {
    width: 210,
    minHeight: 96,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.23)',
  },
  playerToolCardActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.1)' },
  playerToolCardDisabled: { opacity: 0.72 },
  playerToolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  playerToolHint: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', marginTop: 10 },
  playerToolWarning: { color: '#ffd166', fontSize: 10, fontWeight: 'bold', marginTop: 10 },
  refreshText: { color: '#00fa9a', fontSize: 11, fontWeight: 'bold' },
  playerCardsList: { gap: 10 },
  playerSheetCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  playerSheetCardDisabled: { opacity: 0.72, borderColor: 'rgba(255,209,102,0.22)' },
  playerSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  playerSheetIdentityBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  playerSheetAvatar: { width: 54, height: 54, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(0,191,255,0.42)', backgroundColor: 'rgba(255,255,255,0.06)' },
  playerSheetAvatarMuted: { opacity: 0.58, borderColor: 'rgba(255,209,102,0.25)' },
  playerIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerSheetName: { color: '#fff', fontSize: 17, fontWeight: 'bold', flex: 1, minWidth: 0 },
  playerSheetSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  cardHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  viewSheetButton: {
    flex: 0,
    minWidth: 70,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.3)',
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  viewSheetText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
  expandToggleButton: {
    minHeight: 38,
    flex: 0,
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#00fa9a',
    borderWidth: 1,
    borderColor: '#89ffd0',
  },
  expandToggleText: { color: '#02112b', fontSize: 11, fontWeight: 'bold' },
  hpBlock: { marginTop: 0, marginBottom: 9 },
  metricHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metricLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  metricValue: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  hpTrack: { height: 9, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  hpFill: { height: '100%', borderRadius: 999, backgroundColor: '#00fa9a' },
  quickMetricGrid: { flexDirection: 'row', gap: 7, marginBottom: 9 },
  quickMetricBox: { flex: 1, borderRadius: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  quickMetricLabel: { color: 'rgba(255,255,255,0.44)', fontSize: 9, fontWeight: 'bold' },
  quickMetricValue: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 3 },
  effectPreviewBox: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    backgroundColor: 'rgba(255,209,102,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.25)',
  },
  effectPreviewText: { color: '#ffd166', fontSize: 11, fontWeight: 'bold', flex: 1 },
  cardSectionLabel: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', marginTop: 10, marginBottom: 7, letterSpacing: 1 },
  statsChipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  statChip: {
    minWidth: 47,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.18)',
  },
  statChipLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 'bold' },
  statChipValue: { color: '#fff', fontSize: 13, fontWeight: 'bold', marginTop: 2 },
  statChipActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.14)' },
  itemChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  equippedChip: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,250,154,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.22)',
  },
  equippedChipText: { color: '#dfffe9', fontSize: 11, fontWeight: 'bold' },
  mutedSmallText: { color: 'rgba(255,255,255,0.42)', fontSize: 11, lineHeight: 16 },
  bagPreviewText: { color: 'rgba(255,255,255,0.6)', fontSize: 11, lineHeight: 17 },
  masterCardActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  masterCardActionButton: {
    flex: 1,
    minWidth: '47%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
    paddingHorizontal: 6,
  },
  masterCardActionText: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  buffPanel: {
    marginTop: 12,
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modeChip: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  modeChipActive: { backgroundColor: 'rgba(0,191,255,0.16)', borderColor: '#00bfff' },
  modeChipPermanent: { backgroundColor: 'rgba(0,250,154,0.16)', borderColor: '#00fa9a' },
  modeChipText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 'bold' },
  modeChipTextActive: { color: '#00bfff' },
  modeChipPermanentText: { color: '#00fa9a' },
  durationChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  durationChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  durationChipActive: { backgroundColor: 'rgba(0,191,255,0.16)', borderColor: '#00bfff' },
  durationChipText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' },
  durationChipTextActive: { color: '#00bfff' },
  fullInput: { width: '100%', marginTop: 10 },
  itemSendList: { gap: 7, marginTop: 10 },
  itemSendRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,250,154,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.18)',
  },
  itemSendName: { color: '#fff', fontSize: 12, fontWeight: 'bold', flex: 1 },
  selectedEffectsBox: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  selectedEffectsTitle: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  clearSelectionText: { color: '#ff8a8a', fontSize: 12, fontWeight: 'bold' },
  effectCatalogList: { gap: 9, marginBottom: 12 },
  effectCatalogRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
  },
  effectCatalogRowActive: { backgroundColor: 'rgba(86,195,255,0.12)' },
  effectCatalogCheck: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  effectCatalogKind: { fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  effectCatalogName: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  effectCatalogDescription: { color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 17, marginTop: 3 },
  effectColorDot: { width: 12, height: 12, borderRadius: 6 },
  effectManageRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(255,209,102,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.2)',
  },
  effectManageTitle: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  effectManageSub: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2 },
  effectRemoveButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,100,100,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,100,0.28)',
  },
  cardActionBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 2,
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
    padding: 14,
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  emptyActionText: { color: '#00bfff', fontWeight: 'bold' },
  createRequiredBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.25)',
    padding: 14,
    backgroundColor: 'rgba(0,250,154,0.08)',
    marginBottom: 12,
  },
  createRequiredTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  createRequiredSub: { color: 'rgba(255,255,255,0.48)', fontSize: 12, marginTop: 3, lineHeight: 17 },
  primaryButton: {
    backgroundColor: '#00fa9a',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButtonText: { color: '#02112b', fontWeight: 'bold', fontSize: 15, letterSpacing: 1 },
  secondaryButton: {
    flex: 1,
    minWidth: 96,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
  },
  secondaryButtonText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  disabledButton: { opacity: 0.4 },
  dangerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,100,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,100,0.25)',
  },
  dangerButtonText: { color: '#ff6666', fontWeight: 'bold', fontSize: 12 },
  emptyText: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginVertical: 30 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  masterModalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#102b56',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
  },
  masterModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  masterModalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', flex: 1 },
  modalIconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  modalFieldLabel: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  modalInputGrid: { flexDirection: 'row', gap: 10 },
  modalInputBox: { flex: 1, minWidth: 0 },
  modalNumberInput: { width: '100%', textAlign: 'center' },
  sheetModalName: { color: '#00fa9a', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  sheetModalText: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 20 },

  pendingRequestsBox: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
    backgroundColor: 'rgba(255,209,102,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.25)',
  },
  pendingCount: { color: '#ffd166', fontWeight: 'bold', fontSize: 12 },
  pendingRequestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.24)',
    marginTop: 8,
  },
  pendingRequestTitle: { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 3 },
  pendingRequestText: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 17 },
  pendingRequestActions: { flexDirection: 'row', gap: 8 },
  approveRequestButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00fa9a' },
  denyRequestButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,100,100,0.1)', borderWidth: 1, borderColor: 'rgba(255,100,100,0.3)' },
});
