import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLanSession } from '../contexts/LanSessionContext';
import { getLanSessionState } from '../network/lanRepository';
import { LanOfficialEventMessage } from '../types/lan';

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

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const navigationLockRef = useRef(false);
  const {
    activeSession,
    isTransportReady,
    peerCount,
    lastError,
    lastNotice,
    players,
    closeActiveSession,
    endActiveSession,
    linkCharacterToActiveSession,
    broadcastCharacter,
    sendLanCommand,
    getHistoryPage,
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
  const [masterAmount, setMasterAmount] = useState('1');
  const [coinGp, setCoinGp] = useState('0');
  const [coinSp, setCoinSp] = useState('0');
  const [coinCp, setCoinCp] = useState('0');
  const [playerRequestAmount, setPlayerRequestAmount] = useState('1');
  const [cardAmounts, setCardAmounts] = useState<Record<string, string>>({});
  const [cardCoins, setCardCoins] = useState<Record<string, { gp: string; sp: string; cp: string }>>({});
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [cardBuffs, setCardBuffs] = useState<Record<string, { stat: string; amount: string; mode: 'temporary' | 'permanent'; durationUnit: string; durationValue: string }>>({});
  const [cardTempHp, setCardTempHp] = useState<Record<string, { amount: string; durationUnit: string; durationValue: string }>>({});
  const [cardItemSearch, setCardItemSearch] = useState<Record<string, string>>({});
  const [itemCatalog, setItemCatalog] = useState<ItemOption[]>([]);
  const [globalXp, setGlobalXp] = useState('0');
  const [globalCoins, setGlobalCoins] = useState({ gp: '0', sp: '0', cp: '0' });
  const [campaignTurn, setCampaignTurn] = useState(1);

  const loadLocalData = useCallback(async () => {
    const chars = await db.getAllAsync<CharacterOption>(
      `SELECT id, name, race, class, level FROM characters ORDER BY created_at DESC`
    );
    setCharacters(chars);
    const items = await db.getAllAsync<ItemOption>(
      `SELECT id, name, weight, damage, damage_type, properties, category, is_consumable, descricao FROM items ORDER BY name ASC`
    );
    setItemCatalog(items);
  }, [db]);

  const loadHistory = useCallback(
    async (page = 0) => {
      const rows = await getHistoryPage(page, 20);
      setHistory(rows);
      setHistoryPage(page);
    },
    [getHistoryPage]
  );

  const loadSessionState = useCallback(async () => {
    if (!activeSession) return;
    const state = await getLanSessionState(db, activeSession.id);
    setCampaignTurn(state.turn);
  }, [activeSession, db]);

  useEffect(() => {
    loadLocalData();
  }, [loadLocalData]);

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
    }
  }, [activeSession, loadHistory, refreshPlayers]);

  useEffect(() => {
    if (activeSession && lastNotice) {
      loadHistory(0);
    }
  }, [activeSession, lastNotice, loadHistory]);

  useEffect(() => {
    if (activeSession) {
      refreshPlayers();
      loadHistory(0);
      loadSessionState();
    }
  }, [activeSession, lanRevision, refreshPlayers, loadHistory, loadSessionState]);

  useEffect(() => {
    const firstTarget = players.find(player => player.character_id);
    if (!selectedTargetCharacterId && firstTarget?.character_id) {
      setSelectedTargetCharacterId(Number(firstTarget.character_id));
    }
  }, [players, selectedTargetCharacterId]);

  const selectedCharacter = characters.find(character => character.id === selectedCharacterId);
  const targetPlayers = players.filter(player => player.character_id);
  const selectedTargetPlayer = players.find(player => Number(player.character_id) === selectedTargetCharacterId);

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

  const playerActionKey = (player: typeof players[number]) => `${player.device_id}_${player.character_id || 'none'}`;

  const getCardAmount = (player: typeof players[number]) => cardAmounts[playerActionKey(player)] ?? '1';
  const setCardAmount = (player: typeof players[number], value: string) => {
    const key = playerActionKey(player);
    setCardAmounts(prev => ({ ...prev, [key]: onlyNumberText(value) }));
  };

  const getCardCoins = (player: typeof players[number]) => cardCoins[playerActionKey(player)] ?? { gp: '0', sp: '0', cp: '0' };
  const setCardCoinValue = (player: typeof players[number], coin: 'gp' | 'sp' | 'cp', value: string) => {
    const key = playerActionKey(player);
    setCardCoins(prev => {
      const current = prev[key] ?? { gp: '0', sp: '0', cp: '0' };
      return { ...prev, [key]: { ...current, [coin]: onlyNumberText(value) } };
    });
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
    if (!selectedTargetCharacterId) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }

    await sendLanCommand('MASTER_APPLY_HP', {
      targetCharacterId: selectedTargetCharacterId,
      targetDeviceId: selectedTargetPlayer?.device_id || null,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      mode,
      amount: Math.max(0, numericValue(masterAmount, 0)),
    });
    loadHistory(0);
  };

  const handleMasterXp = async () => {
    if (!selectedTargetCharacterId) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }

    await sendLanCommand('MASTER_APPLY_XP', {
      targetCharacterId: selectedTargetCharacterId,
      targetDeviceId: selectedTargetPlayer?.device_id || null,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      amount: numericValue(masterAmount, 0),
    });
    loadHistory(0);
  };

  const handleMasterCoins = async () => {
    if (!selectedTargetCharacterId) {
      Alert.alert('Escolha um alvo', 'Selecione um jogador com ficha vinculada.');
      return;
    }

    await sendLanCommand('MASTER_APPLY_COINS', {
      targetCharacterId: selectedTargetCharacterId,
      targetDeviceId: selectedTargetPlayer?.device_id || null,
      targetName: selectedTargetPlayer?.character_name || 'Personagem',
      gp: numericValue(coinGp, 0),
      sp: numericValue(coinSp, 0),
      cp: numericValue(coinCp, 0),
    });
    loadHistory(0);
  };

  const handleMasterHpForPlayer = async (player: typeof players[number], mode: 'damage' | 'heal') => {
    if (!player.character_id) return;
    await sendLanCommand('MASTER_APPLY_HP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      mode,
      amount: Math.max(0, numericValue(getCardAmount(player), 0)),
    });
    loadHistory(0);
  };

  const handleMasterXpForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    await sendLanCommand('MASTER_APPLY_XP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      amount: numericValue(getCardAmount(player), 0),
    });
    loadHistory(0);
  };

  const handleMasterCoinsForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const coins = getCardCoins(player);
    await sendLanCommand('MASTER_APPLY_COINS', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      gp: numericValue(coins.gp, 0),
      sp: numericValue(coins.sp, 0),
      cp: numericValue(coins.cp, 0),
    });
    loadHistory(0);
  };

  const handleMasterTempHpForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const tempHp = getCardTempHp(player);
    await sendLanCommand('MASTER_APPLY_TEMP_HP', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      amount: Math.max(0, numericValue(tempHp.amount, 0)),
      mode: 'add',
      durationUnit: tempHp.durationUnit,
      durationValue: numericValue(tempHp.durationValue, 1),
    });
    loadHistory(0);
  };

  const handleMasterAttributeForPlayer = async (player: typeof players[number]) => {
    if (!player.character_id) return;
    const buff = getCardBuff(player);
    await sendLanCommand('MASTER_APPLY_ATTRIBUTE', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      stat: buff.stat,
      amount: numericValue(buff.amount, 0),
      durationMode: buff.mode,
      durationUnit: buff.durationUnit,
      durationValue: numericValue(buff.durationValue, 1),
    });
    loadHistory(0);
  };

  const handleMasterGiveItem = async (player: typeof players[number], item: ItemOption) => {
    if (!player.character_id) return;
    await sendLanCommand('MASTER_APPLY_ITEM', {
      targetCharacterId: Number(player.character_id),
      targetDeviceId: player.device_id,
      targetName: player.character_name || 'Personagem',
      quantity: 1,
      item,
    });
    loadHistory(0);
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
    loadHistory(0);
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
    loadHistory(0);
  };

  const handleAdvanceTurn = async (delta = 1) => {
    await sendLanCommand('MASTER_ADVANCE_TURN', { delta });
    await loadSessionState();
    loadHistory(0);
  };

  const openPlayerSheetFromMaster = (player: typeof players[number]) => {
    if (!player.character_id) return;
    router.push(`/sheet?id=${Number(player.character_id)}`);
  };

  const handlePlayerRequest = async (command: 'PLAYER_REQUEST_HP' | 'PLAYER_REQUEST_XP' | 'PLAYER_REQUEST_COINS') => {
    await sendLanCommand(command, {
      amount: Math.max(0, numericValue(playerRequestAmount, 0)),
      characterName: selectedCharacter?.name || null,
    });
    loadHistory(0);
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

    if (!activeSession.last_connected_at) {
      return (
        <View style={styles.section}>
          <Text style={styles.label}>FICHA DA MESA</Text>
          <View style={styles.createRequiredBox}>
            <Ionicons name="hourglass-outline" size={24} color="#00bfff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.createRequiredTitle}>Aguardando regras da mesa</Text>
              <Text style={styles.createRequiredSub}>A escolha/criação da ficha aparece depois da resposta do mestre.</Text>
            </View>
          </View>
        </View>
      );
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
            <Text style={styles.dangerButtonText}>Sair da mesa</Text>
          </TouchableOpacity>
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

  const renderMasterTools = () => {
    if (!activeSession || activeSession.role !== 'master') return null;

    return (
      <View style={styles.toolsBox}>
        <View style={styles.sectionHeader}>
          <Text style={styles.playersTitle}>Cards dos jogadores</Text>
          <TouchableOpacity onPress={() => refreshPlayers()}>
            <Text style={styles.refreshText}>Atualizar</Text>
          </TouchableOpacity>
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

              return (
                <View key={player.device_id} style={[styles.playerSheetCard, !hasCharacter && styles.playerSheetCardDisabled]}>
                  <View style={styles.playerSheetHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.playerIdentityRow}>
                        <Text style={styles.playerSheetName} numberOfLines={1}>{player.character_name || player.player_name || 'Jogador'}</Text>
                        <View style={[styles.dot, player.connected ? styles.dotOn : styles.dotOff]} />
                      </View>
                      <Text style={styles.playerSheetSub} numberOfLines={1}>
                        {hasCharacter
                          ? `${player.player_name || 'Jogador'} / Nv. ${snapshot.level} / ${snapshot.race || 'Raça'} / ${snapshot.className || 'Classe'}`
                          : 'Aguardando vínculo/criação da ficha'}
                      </Text>
                    </View>
                    {hasCharacter && (
                      <View style={styles.cardHeaderActions}>
                        <TouchableOpacity style={styles.viewSheetButton} onPress={() => openPlayerSheetFromMaster(player)}>
                          <Ionicons name="document-text-outline" size={16} color="#00bfff" />
                          <Text style={styles.viewSheetText}>Ficha</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.iconPillButton} onPress={() => toggleExpanded(player)}>
                          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#00fa9a" />
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
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => handleMasterXpForPlayer(player)}>
                          <Text style={styles.quickMetricLabel}>XP</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.xp}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => handleMasterCoinsForPlayer(player)}>
                          <Text style={styles.quickMetricLabel}>PO</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.gp}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => handleMasterCoinsForPlayer(player)}>
                          <Text style={styles.quickMetricLabel}>PP</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.sp}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.quickMetricBox} onPress={() => handleMasterCoinsForPlayer(player)}>
                          <Text style={styles.quickMetricLabel}>PC</Text>
                          <Text style={styles.quickMetricValue}>{snapshot.cp}</Text>
                        </TouchableOpacity>
                      </View>

                      {expanded && (
                        <>
                      <Text style={styles.cardSectionLabel}>Atributos</Text>
                      <View style={styles.statsChipGrid}>
                        {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(stat => (
                          <TouchableOpacity key={stat} style={[styles.statChip, buff.stat === stat && styles.statChipActive]} onPress={() => setCardBuffValue(player, { stat, mode: 'temporary' })}>
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

                        </>
                      )}

                      <View style={styles.cardActionBlock}>
                        <Text style={styles.cardSectionLabel}>Ações rápidas</Text>
                        <View style={styles.compactInputRow}>
                          <TextInput
                            style={[styles.input, styles.compactInput]}
                            value={amountValue}
                            onChangeText={value => setCardAmount(player, value)}
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
      <View style={styles.toolsBox}>
        <Text style={styles.playersTitle}>Solicitar ao mestre</Text>
        <View style={styles.compactInputRow}>
          <TextInput
            style={[styles.input, styles.compactInput]}
            value={playerRequestAmount}
            onChangeText={value => setPlayerRequestAmount(onlyNumberText(value))}
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
            disabled={history.length < 20}
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

    return (
      <View style={styles.activePanel}>
        <View style={styles.activeHeader}>
          <View>
            <Text style={styles.activeEyebrow}>SESSÃO ATIVA / {activeSession.role === 'master' ? 'MESTRE' : 'JOGADOR'}</Text>
            <Text style={styles.activeTitle}>{activeSession.name}</Text>
          </View>
          <View style={[styles.statusBadge, isTransportReady && styles.statusBadgeReady]}>
            <Text style={[styles.statusBadgeText, isTransportReady && styles.statusBadgeTextReady]}>
              {isTransportReady ? 'TCP ON' : 'TCP OFF'}
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
                {activeSession.session_code}
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

  const renderAdminMenu = () => (
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
          {(!activeSession || activeSession.status === 'paused') && renderAdminMenu()}
        </ScrollView>
      </KeyboardAvoidingView>
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
  scrollContent: { padding: 20, paddingBottom: 60 },
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
  activePanel: {
    backgroundColor: 'rgba(0, 250, 154, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 250, 154, 0.35)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  activeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  activeEyebrow: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  activeTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 3 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,100,100,0.12)' },
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
  playersBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 },
  toolsBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 },
  historyBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: 12 },
  playersTitle: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', marginBottom: 10 },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  playerName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  playerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  compactInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  compactInput: { width: 86, paddingVertical: 10, textAlign: 'center' },
  coinInput: { width: '100%', minWidth: 0, paddingVertical: 10, textAlign: 'center' },
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
  playerCardsList: { gap: 14 },
  playerSheetCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  playerSheetCardDisabled: { opacity: 0.72, borderColor: 'rgba(255,209,102,0.22)' },
  playerSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  playerIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerSheetName: { color: '#fff', fontSize: 17, fontWeight: 'bold', flex: 1 },
  playerSheetSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  viewSheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.3)',
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  viewSheetText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
  hpBlock: { marginTop: 2, marginBottom: 12 },
  metricHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metricLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  metricValue: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  hpTrack: { height: 9, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  hpFill: { height: '100%', borderRadius: 999, backgroundColor: '#00fa9a' },
  quickMetricGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickMetricBox: { flex: 1, borderRadius: 12, padding: 9, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  quickMetricLabel: { color: 'rgba(255,255,255,0.44)', fontSize: 9, fontWeight: 'bold' },
  quickMetricValue: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 3 },
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
});
