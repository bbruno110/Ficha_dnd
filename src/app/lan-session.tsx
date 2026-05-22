import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import DiceRoller3D from '@/components/DiceRoller3D';
import QrCodeView from '@/components/QrCodeView';
import {
  addLanPlayerEffect,
  advanceLanSessionTime,
  buildJoinDeepLink,
  buildLanSessionPayload,
  deleteLanSession,
  formatElapsedTime,
  getCustomCatalogOptions,
  getLanSessionEvents,
  getLanSessionState,
  getMasterJoinedPlayers,
  getNativeSessionEvents,
  getSavedLanSessions,
  keysFromSelection,
  kickLanSessionPlayer,
  makeInviteCode,
  makeLanEventId,
  makeSessionId,
  pauseLanSession,
  rebuildLanSessionCatalog,
  refreshLanSessionPayload,
  rememberLanSessionEvent,
  removeLanPlayerEffect,
  resumeLanSession,
  reviewLanPlayerPendingSnapshot,
  saveLanSession,
  selectionFromKeys,
  startLanServer,
  stopLanServer,
  summarizeEffect,
  syncLanSessionPayload,
  updateLanPlayerNumbers,
  upsertLanSessionPlayerFromNetwork,
  type CatalogOption,
  type LanAdvanceUnit,
  type LanEffectTarget,
  type LanEffectUnit,
  type LanSessionEvent,
  type LanSessionPayload,
  type LanSessionPlayerState,
  type LanSessionState,
  type LanSessionSummary,
} from '@/services/lanSession';
import { appColors, appGradients, lanSessionStyles as styles } from '@/styles/globalStyles';

const CATALOG_FILTERS = ['Todos', 'Item', 'Raca', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit'];
const EFFECT_TARGETS: LanEffectTarget[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'HP', 'PV_TEMP', 'custom'];
const EFFECT_UNITS: { label: string; value: LanEffectUnit }[] = [
  { label: 'Turnos', value: 'turn' },
  { label: 'Minutos', value: 'minute' },
  { label: 'Horas', value: 'hour' },
  { label: 'Descanso', value: 'rest' },
];
const STAT_KEYS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];

type EffectOption = {
  key: string;
  name: string;
  group: string;
  detail: string;
  effects: any[];
  durationValue?: number | null;
  durationUnit?: LanEffectUnit | null;
  durationText?: string;
};

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();

  const [sessionName, setSessionName] = useState('Mesa de D&D');
  const [masterName, setMasterName] = useState('Mestre');
  const [level, setLevel] = useState('1');
  const [allowExisting, setAllowExisting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<LanSessionPayload | null>(null);
  const [sessionState, setSessionState] = useState<LanSessionState | null>(null);
  const [sessionEvents, setSessionEvents] = useState<LanSessionEvent[]>([]);
  const [joinUrl, setJoinUrl] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [savedSessions, setSavedSessions] = useState<LanSessionSummary[]>([]);

  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [selectedCatalogKeys, setSelectedCatalogKeys] = useState<string[]>([]);
  const [catalogModalVisible, setCatalogModalVisible] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState('Todos');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [effectTargetPlayerId, setEffectTargetPlayerId] = useState<number | 'ALL'>('ALL'); // NOVO: Controle de alvo do efeito
  const [effectName, setEffectName] = useState('Efeito temporario');
  const [effectTarget, setEffectTarget] = useState<LanEffectTarget>('FOR');
  const [effectValue, setEffectValue] = useState('2');
  const [effectDuration, setEffectDuration] = useState('3');
  const [effectUnit, setEffectUnit] = useState<LanEffectUnit>('turn');
  const [effectSource, setEffectSource] = useState('');
  const [effectSearch, setEffectSearch] = useState('');
  const [effectOptions, setEffectOptions] = useState<EffectOption[]>([]);
  const [expandedPlayerIds, setExpandedPlayerIds] = useState<number[]>([]);
  const [reviewedSpellEventIds, setReviewedSpellEventIds] = useState<string[]>([]);
  const [xpPool, setXpPool] = useState('1000');

  const [inventoryModalPlayer, setInventoryModalPlayer] = useState<LanSessionPlayerState | null>(null);
  
  // NOVO: Estado para o Modal de Edição Rápida (HP, XP, Moedas, Atributos)
  const [quickEdit, setQuickEdit] = useState<{
    player: LanSessionPlayerState;
    type: 'STAT' | 'HP' | 'XP' | 'COIN' | 'PV_TEMP';
    stat?: string;
  } | null>(null);
  const [qeValue, setQeValue] = useState('');
  const [qeDuration, setQeDuration] = useState('1');
  const [qeUnit, setQeUnit] = useState<LanEffectUnit>('hour');
  const [qeIsTemp, setQeIsTemp] = useState(true);
  const [qeGP, setQeGP] = useState('');
  const [qeSP, setQeSP] = useState('');
  const [qeCP, setQeCP] = useState('');

  const activeSessionId = payload?.session.id;
  const selectedPlayer = useMemo(
    () => sessionState?.players.find((player) => player.id === selectedPlayerId) || sessionState?.players[0],
    [selectedPlayerId, sessionState?.players]
  );
  
  const filteredCatalogOptions = useMemo(() => {
    const search = catalogSearch.trim().toLowerCase();
    return catalogOptions.filter((option) => {
      const matchesFilter = catalogFilter === 'Todos' || option.group === catalogFilter;
      const matchesSearch = !search || option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [catalogFilter, catalogOptions, catalogSearch]);
  
  const selectedCatalogSet = useMemo(() => new Set(selectedCatalogKeys), [selectedCatalogKeys]);
  
  const filteredEffectOptions = useMemo(() => {
    const search = effectSearch.trim().toLowerCase();
    return effectOptions.filter((option) => {
      if (!search) return true;
      return option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
    }).slice(0, 12);
  }, [effectOptions, effectSearch]);

  const loadSavedSessions = useCallback(async () => {
    setSavedSessions(await getSavedLanSessions(db));
  }, [db]);

  const loadCatalogOptions = useCallback(async () => {
    const options = await getCustomCatalogOptions(db);
    setCatalogOptions(options);
    setSelectedCatalogKeys((current) => current.length > 0 ? current : options.map((option) => option.key));
  }, [db]);

  const loadEffectOptions = useCallback(async () => {
    const spells = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, name, level, damage_dice, damage_type, duration, effect_json, duration_value, duration_unit
       FROM spells
       ORDER BY name ASC`
    );
    const items = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, name, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit
       FROM items
       ORDER BY name ASC`
    );

    setEffectOptions([
      ...spells.map((row) => ({
        key: `spell:${row.id}`,
        name: String(row.name || 'Magia'),
        group: 'Magia/Skill',
        detail: [row.level, row.damage_dice, row.damage_type, row.duration].filter(Boolean).join(' - '),
        effects: parseOptionEffects(row.effect_json),
        durationValue: Number(row.duration_value) || null,
        durationUnit: normalizeEffectUnit(row.duration_unit),
        durationText: String(row.duration || ''),
      })),
      ...items.map((row) => ({
        key: `item:${row.id}`,
        name: String(row.name || 'Item'),
        group: 'Item',
        detail: [row.damage, row.damage_type, row.properties, row.descricao].filter(Boolean).join(' - '),
        effects: parseOptionEffects(row.effect_json),
        durationValue: Number(row.duration_value) || null,
        durationUnit: normalizeEffectUnit(row.duration_unit),
        durationText: row.duration_value ? `${row.duration_value} ${row.duration_unit || ''}` : '',
      })),
    ]);
  }, [db]);

  const reloadSessionState = useCallback(async (sessionId: string, syncPayload = false) => {
    const nextState = await getLanSessionState(db, sessionId);
    setSessionState(nextState);
    setSessionEvents(await getLanSessionEvents(db, sessionId, 20));

    if (syncPayload) {
      const nextPayload = await syncLanSessionPayload(db, sessionId);
      if (nextPayload) setPayload(nextPayload);
    }
  }, [db]);

  useEffect(() => {
    loadCatalogOptions();
    loadEffectOptions();
    loadSavedSessions();
  }, [loadCatalogOptions, loadEffectOptions, loadSavedSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    const pollJoinedPlayers = async () => {
      const joinedPlayers = await getMasterJoinedPlayers(joinUrl);
      for (const entry of joinedPlayers) {
        if (entry?.sessionId === activeSessionId) {
          await upsertLanSessionPlayerFromNetwork(db, entry);
        }
      }

      const events = await getNativeSessionEvents(joinUrl);
      if (events.length > 0) {
        const currentState = await getLanSessionState(db, activeSessionId);
        for (const event of events) {
          if (event.sessionId !== activeSessionId) continue;
          const player = currentState.players.find((entry) => (
            entry.remoteKey === event.fromKey ||
            entry.remoteKey === event.toKey ||
            entry.characterName === event.fromName ||
            entry.characterName === event.toName
          ));
          if (!player) continue;

          if (event.type === 'public_status' && event.publicState) {
            const statusPatch: Parameters<typeof updateLanPlayerNumbers>[2] = {
              hpCurrent: event.publicState.hpCurrent,
              hpMax: event.publicState.hpMax,
            };
            if (event.publicState.tempHp != null) statusPatch.tempHp = event.publicState.tempHp;
            await updateLanPlayerNumbers(db, player.id, statusPatch);
          }

          if (event.type === 'spell_hp' && event.spellEffect?.amount != null) {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            const targetPlayer = currentState.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
            if (!targetPlayer) continue;
            await updateLanPlayerNumbers(db, targetPlayer.id, {
              hpCurrent: Math.max(0, Math.min(targetPlayer.hpMax, targetPlayer.hpCurrent + event.spellEffect.amount)),
            });
          }

          if (event.type === 'spell_effect' && event.spellEffect) {
            await rememberLanSessionEvent(db, event);
          }
        }
      }

      await reloadSessionState(activeSessionId);
    };

    pollJoinedPlayers();
    const timer = setInterval(pollJoinedPlayers, 2500);
    return () => clearInterval(timer);
  }, [activeSessionId, db, joinUrl, reloadSessionState]);

  const handleStartSession = async () => {
    const parsedLevel = Math.max(1, Math.min(20, parseInt(level, 10) || 1));
    setLoading(true);

    try {
      const nextPayload = await buildLanSessionPayload(db, {
        id: makeSessionId(),
        name: sessionName.trim() || 'Mesa de D&D',
        masterName: masterName.trim() || 'Mestre',
        level: parsedLevel,
        allowExisting,
        inviteCode: makeInviteCode(),
      }, selectionFromKeys(selectedCatalogKeys));

      const nextJoinUrl = await startLanServer(nextPayload);
      await saveLanSession(db, nextPayload, nextJoinUrl);
      setPayload(nextPayload);
      setSessionState(nextPayload.state || null);
      setSessionEvents([]);
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedPlayerId(null);
      await loadSavedSessions();
      if (!nextJoinUrl) {
        Alert.alert(
          'Socket TCP indisponível',
          'A sessão foi criada localmente, mas este build não conseguiu abrir o servidor TCP. Gere/rode um dev build nativo; o Expo Go não suporta socket TCP local.'
        );
      }
    } catch (error) {
      Alert.alert('Sessão LAN', 'Não foi possível iniciar a sessão LAN neste dispositivo.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleResumeSavedSession = async (session: LanSessionSummary) => {
    setLoading(true);
    try {
      await resumeLanSession(db, session.id);
      const nextPayload = await refreshLanSessionPayload(db, session.id);
      if (!nextPayload) throw new Error('Sessão não encontrada.');

      const nextJoinUrl = await startLanServer(nextPayload);
      await saveLanSession(db, nextPayload, nextJoinUrl);
      setPayload(nextPayload);
      setSessionState(nextPayload.state || await getLanSessionState(db, session.id));
      setSessionEvents(await getLanSessionEvents(db, session.id, 20));
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedCatalogKeys(keysFromSelection(nextPayload.selectedCatalog));
      await loadSavedSessions();
      if (!nextJoinUrl) {
        Alert.alert(
          'Socket TCP indisponível',
          'A mesa foi retomada, mas este build não conseguiu abrir o servidor TCP. Sem a URL tcp://, jogadores não conectam em tempo real.'
        );
      }
    } catch (error) {
      Alert.alert('Sessão LAN', 'Não foi possível retomar esta sessão.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleStopSession = async () => {
    if (payload) await pauseLanSession(db, payload.session.id);
    await stopLanServer();
    setPayload(null);
    setSessionState(null);
    setSessionEvents([]);
    setJoinUrl('');
    setJoinLink('');
    setSelectedPlayerId(null);
    await loadSavedSessions();
  };

  const handleDeleteSavedSession = (session: LanSessionSummary) => {
    Alert.alert(
      'Excluir sessão',
      `Excluir "${session.name}" e os jogadores salvos nela?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            if (payload?.session.id === session.id) {
              await stopLanServer();
              setPayload(null);
              setSessionState(null);
              setSessionEvents([]);
              setJoinUrl('');
              setJoinLink('');
              setSelectedPlayerId(null);
            }
            await deleteLanSession(db, session.id);
            await loadSavedSessions();
          },
        },
      ]
    );
  };

  const handleTogglePause = async () => {
    if (!payload || !sessionState) return;
    const nextPayload = sessionState.status === 'paused'
      ? await resumeLanSession(db, payload.session.id)
      : await pauseLanSession(db, payload.session.id);

    if (nextPayload) {
      setPayload(nextPayload);
      setSessionState(nextPayload.state || null);
    }
    await loadSavedSessions();
  };

  const handleAdvanceTime = async (unit: LanAdvanceUnit) => {
    if (!payload) return;
    const nextPayload = await advanceLanSessionTime(db, payload.session.id, unit);
    if (nextPayload) {
      setPayload(nextPayload);
      setSessionState(nextPayload.state || null);
      setSessionEvents(await getLanSessionEvents(db, payload.session.id, 20));
    }
  };

  const handleApplyCatalogSelection = async () => {
    if (!payload) {
      setCatalogModalVisible(false);
      return;
    }

    const nextPayload = await rebuildLanSessionCatalog(db, payload.session.id, selectionFromKeys(selectedCatalogKeys), joinUrl);
    if (nextPayload) {
      setPayload(nextPayload);
      setSessionState(nextPayload.state || sessionState);
    }
    setCatalogModalVisible(false);
  };

  const handleToggleCatalogOption = (key: string) => {
    setSelectedCatalogKeys((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  const handleSetFilteredCatalog = (selected: boolean) => {
    const visibleKeys = filteredCatalogOptions.map((option) => option.key);
    setSelectedCatalogKeys((current) => {
      if (selected) return Array.from(new Set([...current, ...visibleKeys]));
      return current.filter((key) => !visibleKeys.includes(key));
    });
  };

  const handleUpdatePlayer = async (
    player: LanSessionPlayerState,
    field: 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp',
    value: number
  ) => {
    const patch = { [field]: Math.max(0, value) };
    await updateLanPlayerNumbers(db, player.id, patch);
    if (payload) await reloadSessionState(payload.session.id);
  };

  const handleKickPlayer = (player: LanSessionPlayerState) => {
    Alert.alert(
      'Remover jogador',
      `Remover ${player.characterName} desta sessão? Ele poderá escolher ou criar outro personagem ao entrar de novo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            await kickLanSessionPlayer(db, player.id);
            if (payload) await reloadSessionState(payload.session.id, true);
          },
        },
      ]
    );
  };

  const handleReviewPending = async (player: LanSessionPlayerState, accepted: boolean) => {
    await reviewLanPlayerPendingSnapshot(db, player.id, accepted);
    if (payload) await reloadSessionState(payload.session.id, true);
  };

  const handleSelectEffectOption = (option: EffectOption) => {
    const firstEffect = option.effects[0] || {};
    setEffectName(option.name);
    setEffectSource(option.group);
    setEffectSearch(option.name);
    setEffectTarget(normalizeEffectTarget(firstEffect.target || firstEffect.stat || firstEffect.type));
    setEffectValue(String(firstEffect.value ?? firstEffect.val ?? firstEffect.amount ?? 0));
    setEffectDuration(String(option.durationValue || firstEffect.durationValue || firstEffect.duration || 1));
    setEffectUnit(option.durationUnit || normalizeEffectUnit(firstEffect.durationUnit || firstEffect.unit) || inferUnitFromText(option.durationText));
  };

  const handleDistributeXp = async () => {
    if (!payload || !sessionState?.players.length) return;
    const totalXp = Math.max(0, parseInt(xpPool, 10) || 0);
    const baseShare = Math.floor(totalXp / sessionState.players.length);
    const remainder = totalXp % sessionState.players.length;
    for (let index = 0; index < sessionState.players.length; index += 1) {
      const player = sessionState.players[index];
      await updateLanPlayerNumbers(db, player.id, {
        xp: player.xp + baseShare + (index < remainder ? 1 : 0),
      });
    }
    await reloadSessionState(payload.session.id, true);
  };

  const handleAcceptSpellEffect = async (event: LanSessionEvent, accepted: boolean) => {
    if (!payload) return;
    const targetPlayer = sessionState?.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
    if (accepted && targetPlayer && event.spellEffect) {
      await addLanPlayerEffect(db, targetPlayer.id, {
        name: event.spellEffect.spellName,
        target: event.spellEffect.target || 'custom',
        value: event.spellEffect.value || 0,
        remaining: event.spellEffect.durationRemaining || 1,
        unit: event.spellEffect.durationUnit || 'rest',
        durationText: event.spellEffect.durationText,
        kind: event.spellEffect.target === 'PV_TEMP' ? 'temp_hp' : undefined,
        source: event.fromName,
      });
    }
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'character_update_review',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: event.fromKey,
      toName: event.fromName,
      message: accepted
        ? `Mestre aceitou ${event.spellEffect?.spellName || 'efeito'} de ${event.fromName}.`
        : `Mestre recusou ${event.spellEffect?.spellName || 'efeito'} de ${event.fromName}.`,
      createdAt: new Date().toISOString(),
    });
    setReviewedSpellEventIds((current) => Array.from(new Set([...current, event.id])));
    await reloadSessionState(payload.session.id, true);
  };

  const toggleExpandedPlayer = (playerId: number) => {
    setExpandedPlayerIds((current) => (
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    ));
  };

  // NOVO: Função para Aplicar Efeitos considerando o novo seletor (Toda a party ou Específico)
  const handleApplyEffect = async () => {
    if (!sessionState) return;
    
    const targets = effectTargetPlayerId === 'ALL'
      ? sessionState.players
      : sessionState.players.filter(p => p.id === effectTargetPlayerId);

    for (const p of targets) {
      await addLanPlayerEffect(db, p.id, {
        name: effectName.trim() || 'Efeito temporário',
        target: effectTarget,
        value: parseInt(effectValue, 10) || 0,
        remaining: Math.max(1, parseInt(effectDuration, 10) || 1),
        unit: effectUnit,
        durationText: `${Math.max(1, parseInt(effectDuration, 10) || 1)} ${effectUnit}`,
        kind: effectTarget === 'PV_TEMP' ? 'temp_hp' : effectTarget === 'HP' ? 'hp' : effectTarget === 'custom' ? 'custom' : 'stat',
        source: effectSource.trim() || undefined,
      });
    }

    if (payload) await reloadSessionState(payload.session.id);
  };

  const handleRemoveEffect = async (playerId: number, effectId: string) => {
    await removeLanPlayerEffect(db, playerId, effectId);
    if (payload) await reloadSessionState(payload.session.id);
  };

  // NOVO: Funções para o Modal de Edição Rápida
  const openQuickEdit = (player: LanSessionPlayerState, type: 'STAT' | 'HP' | 'XP' | 'COIN' | 'PV_TEMP', stat?: string) => {
    setQeValue('');
    setQeDuration('1');
    setQeUnit('hour');
    setQeIsTemp(true);
    setQeGP('');
    setQeSP('');
    setQeCP('');
    setQuickEdit({ player, type, stat });
  };

  const handleApplyQuickEdit = async () => {
    if (!quickEdit) return;
    const { player, type, stat } = quickEdit;
    const val = parseInt(qeValue, 10) || 0;

    if (type === 'XP') {
       await updateLanPlayerNumbers(db, player.id, { xp: player.xp + val });
       if (payload) await reloadSessionState(payload.session.id);
    } else if (type === 'COIN') {
       const gp = parseInt(qeGP, 10) || 0;
       const sp = parseInt(qeSP, 10) || 0;
       const cp = parseInt(qeCP, 10) || 0;
       
       let newCp = player.cp + cp;
       let newSp = player.sp + sp;
       let newGp = player.gp + gp;
       
       // Conversão automática: 10 Cobre = 1 Prata, 10 Prata = 1 Ouro
       if (newCp >= 10) { newSp += Math.floor(newCp / 10); newCp %= 10; }
       if (newSp >= 10) { newGp += Math.floor(newSp / 10); newSp %= 10; }
       
       await updateLanPlayerNumbers(db, player.id, { gp: newGp, sp: newSp, cp: newCp });
       if (payload) await reloadSessionState(payload.session.id);
    } else if (type === 'HP' && !qeIsTemp) {
       await handleUpdatePlayer(player, 'hpCurrent', val);
    } else {
       // STAT, PV_TEMP, ou HP (Temporário = Max HP buff)
       const effTarget = type === 'PV_TEMP' ? 'PV_TEMP' : type === 'HP' ? 'HP' : (stat as LanEffectTarget);
       const effName = type === 'PV_TEMP' ? 'PV Temporário' : type === 'HP' ? 'HP Máximo Temporário' : `Ajuste de ${stat}`;
       const effKind = type === 'PV_TEMP' ? 'temp_hp' : type === 'HP' ? 'hp' : 'stat';

       await addLanPlayerEffect(db, player.id, {
           name: effName,
           target: effTarget,
           value: val,
           remaining: qeIsTemp ? Math.max(1, parseInt(qeDuration, 10) || 1) : 9999, // 9999 = Permanente infinito
           unit: qeIsTemp ? qeUnit : 'rest',
           durationText: qeIsTemp ? `${Math.max(1, parseInt(qeDuration, 10) || 1)} ${qeUnit}` : 'Permanente',
           kind: effKind,
           source: qeIsTemp ? 'Mestre' : 'Mestre (Permanente)',
       });
       if (payload) await reloadSessionState(payload.session.id);
    }
    setQuickEdit(null);
  };

  const renderQuickEditModal = () => {
    if (!quickEdit) return null;
    const { type, stat, player } = quickEdit;
    
    let title = '';
    if (type === 'HP') title = 'Ajustar Vida (HP)';
    else if (type === 'XP') title = 'Adicionar XP';
    else if (type === 'COIN') title = 'Adicionar Moedas';
    else if (type === 'PV_TEMP') title = 'PV Temporário';
    else if (type === 'STAT') title = `Modificar ${stat}`;

    return (
      <Modal visible={!!quickEdit} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{title}</Text>
                <Text style={styles.mutedText}>{player.characterName}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setQuickEdit(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            {type === 'COIN' ? (
              <View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Ouro (PO)</Text>
                  <TextInput style={styles.input} value={qeGP} onChangeText={setQeGP} keyboardType="numeric" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Prata (PP)</Text>
                  <TextInput style={styles.input} value={qeSP} onChangeText={setQeSP} keyboardType="numeric" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Bronze (PC)</Text>
                  <TextInput style={styles.input} value={qeCP} onChangeText={setQeCP} keyboardType="numeric" placeholder="0" placeholderTextColor={appColors.placeholderLight} />
                </View>
              </View>
            ) : (
              <View style={{ marginVertical: 10 }}>
                <Text style={styles.label}>{type === 'HP' ? 'Novo Valor de HP (Ex: 15)' : type === 'XP' ? 'Quantidade de XP para dar' : 'Valor do buff/dano (Ex: 5, -2)'}</Text>
                <TextInput style={styles.input} value={qeValue} onChangeText={setQeValue} keyboardType="numeric" placeholder="Ex: 5" placeholderTextColor={appColors.placeholderLight} />
              </View>
            )}

            {(type === 'STAT' || type === 'PV_TEMP' || type === 'HP') && (
              <View style={styles.ruleRow}>
                <View style={styles.ruleTextBox}>
                  <Text style={styles.ruleTitle}>Efeito Temporário?</Text>
                  <Text style={styles.ruleDescription}>{qeIsTemp ? 'Desaparece com o tempo.' : 'Permanente (Fica até ser removido).'}</Text>
                </View>
                <Switch value={qeIsTemp} onValueChange={setQeIsTemp} trackColor={{ false: appColors.neutral, true: appColors.primary }} thumbColor={appColors.textPrimary} />
              </View>
            )}

            {(type === 'STAT' || type === 'PV_TEMP' || type === 'HP') && qeIsTemp && (
              <View style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Tempo</Text>
                  <TextInput style={styles.input} value={qeDuration} onChangeText={setQeDuration} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Medida</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {EFFECT_UNITS.map(u => (
                      <TouchableOpacity key={u.value} style={[styles.filterChip, qeUnit === u.value && styles.filterChipActive]} onPress={() => setQeUnit(u.value)}>
                        <Text style={[styles.filterChipText, qeUnit === u.value && styles.filterChipTextActive]}>{u.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}

            <TouchableOpacity style={[styles.primaryButton, { marginTop: 16 }]} onPress={handleApplyQuickEdit}>
              <Text style={styles.primaryButtonText}>SALVAR ALTERAÇÃO</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderCatalogModal = () => (
    <Modal visible={catalogModalVisible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalPanel}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Acervo da sessao</Text>
              <Text style={styles.mutedText}>{selectedCatalogKeys.length} itens customizados selecionados</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setCatalogModalVisible(false)}>
              <Ionicons name="close" size={22} color={appColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={catalogSearch}
            onChangeText={setCatalogSearch}
            placeholder="Buscar classe, raca, magia, item..."
            placeholderTextColor={appColors.placeholderLight}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRail}>
              {CATALOG_FILTERS.map((filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[styles.filterChip, catalogFilter === filter && styles.filterChipActive]}
                  onPress={() => setCatalogFilter(filter)}
                >
                  <Text style={[styles.filterChipText, catalogFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.toolbar}>
            <TouchableOpacity style={styles.smallButton} onPress={() => handleSetFilteredCatalog(true)}>
              <Ionicons name="checkmark" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Selecionar filtro</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={() => handleSetFilteredCatalog(false)}>
              <Ionicons name="remove" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Limpar filtro</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
            {filteredCatalogOptions.length === 0 ? (
              <Text style={styles.hint}>Nenhum item customizado encontrado neste filtro.</Text>
            ) : filteredCatalogOptions.map((option) => {
              const selected = selectedCatalogSet.has(option.key);
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.catalogRow, selected && styles.catalogRowActive]}
                  onPress={() => handleToggleCatalogOption(option.key)}
                >
                  <View style={[styles.catalogCheck, selected && styles.catalogCheckActive]}>
                    {selected && <Ionicons name="checkmark" size={15} color={appColors.primaryDark} />}
                  </View>
                  <View style={styles.catalogTextBox}>
                    <Text style={styles.catalogTag}>{option.group}</Text>
                    <Text style={styles.catalogName}>{option.name}</Text>
                    <Text style={styles.catalogMeta}>{option.detail}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.primaryButton} onPress={handleApplyCatalogSelection}>
            <Text style={styles.primaryButtonText}>{payload ? 'SINCRONIZAR ACERVO' : 'APLICAR ACERVO'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderInventoryModal = () => {
    if (!inventoryModalPlayer) return null;
    const equipment = inventoryModalPlayer.equipment as any;
    const bag = Array.isArray(equipment?.bag) ? equipment.bag : [];

    return (
      <Modal visible={!!inventoryModalPlayer} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Inventário Completo</Text>
                <Text style={styles.mutedText}>{inventoryModalPlayer.characterName}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setInventoryModalPlayer(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {bag.length === 0 ? (
                <Text style={styles.hint}>O inventário está vazio.</Text>
              ) : (
                bag.map((item: any, index: number) => (
                  <View key={index} style={styles.catalogRow}>
                    <View style={styles.catalogTextBox}>
                      <Text style={styles.catalogName}>{item.qty || 1}x {item.name || 'Item'}</Text>
                      {(item.weight || item.type) && (
                        <Text style={styles.catalogMeta}>
                          {[item.type, item.weight ? `${item.weight} kg` : null].filter(Boolean).join(' - ')}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderSetup = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Criar sala</Text>

        <Text style={styles.label}>NOME DA SESSÃO</Text>
        <TextInput style={styles.input} value={sessionName} onChangeText={setSessionName} placeholder="Ex: A mina perdida" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NOME DO MESTRE</Text>
        <TextInput style={styles.input} value={masterName} onChangeText={setMasterName} placeholder="Mestre" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NÍVEL DA MESA</Text>
        <TextInput style={styles.input} value={level} onChangeText={setLevel} keyboardType="numeric" placeholder="1" placeholderTextColor={appColors.placeholderLight} />

        <View style={styles.ruleRow}>
          <View style={styles.ruleTextBox}>
            <Text style={styles.ruleTitle}>Permitir personagem existente</Text>
            <Text style={styles.ruleDescription}>Se desligado, os jogadores precisam criar uma ficha nova para esta sessão.</Text>
          </View>
          <Switch value={allowExisting} onValueChange={setAllowExisting} trackColor={{ false: appColors.neutral, true: appColors.primary }} thumbColor={appColors.textPrimary} />
        </View>

        <View style={styles.catalogSummaryBox}>
          <View style={styles.catalogSummaryRow}>
            <View style={styles.catalogSummaryTextBox}>
              <Text style={styles.catalogSummaryText}>Acervo preparado</Text>
              <Text style={styles.mutedText}>{selectedCatalogKeys.length} customizados serão sincronizados pelo QR.</Text>
            </View>
            <TouchableOpacity style={styles.smallButton} onPress={() => setCatalogModalVisible(true)}>
              <Ionicons name="albums" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleStartSession} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'INICIANDO...' : 'INICIAR SESSÃO LAN'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.joinSessionButton} onPress={() => router.push('/sessionJoin' as any)} disabled={loading}>
          <Ionicons name="qr-code" size={18} color={appColors.success} />
          <Text style={styles.joinSessionButtonText}>ENTRAR EM SESSÃO EXISTENTE</Text>
        </TouchableOpacity>
      </View>

      {savedSessions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Retomar mesa</Text>
          {savedSessions.map((session) => (
            <View key={session.id} style={styles.savedSessionRow}>
              <View style={styles.savedSessionContent}>
                <TouchableOpacity style={styles.savedSessionTextBox} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                  <Text style={styles.savedSessionTitle}>{session.name}</Text>
                  <Text style={styles.savedSessionMeta}>
                    Nivel {session.level} - Turno {session.currentTurn} - {session.playerCount} jogador(es)
                  </Text>
                </TouchableOpacity>
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                    <Ionicons name="play" size={16} color={appColors.success} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleDeleteSavedSession(session)} disabled={loading}>
                    <Ionicons name="trash" size={16} color={appColors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );

  const renderSessionControls = () => {
    if (!payload || !sessionState) return null;
    const paused = sessionState.status === 'paused';

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>{payload.session.name}</Text>
            <Text style={styles.mutedText}>Nível {payload.session.level} - Código {payload.session.inviteCode}</Text>
          </View>
          <View style={[styles.statusPill, paused && styles.statusPillPaused]}>
            <Text style={[styles.statusPillText, paused && styles.statusPillTextPaused]}>{paused ? 'Pausada' : 'Ativa'}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Turno</Text>
            <Text style={styles.metricValue}>{sessionState.currentTurn}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Tempo</Text>
            <Text style={styles.metricValue}>{formatElapsedTime(sessionState.elapsedMinutes)}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Jogadores</Text>
            <Text style={styles.metricValue}>{sessionState.players.length}</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleAdvanceTime('turn')}>
            <Ionicons name="play-forward" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Turno</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleAdvanceTime('minute')}>
            <Ionicons name="time" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Min</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleAdvanceTime('hour')}>
            <Ionicons name="hourglass" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>+ Hora</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleAdvanceTime('shortRest')}>
            <Ionicons name="cafe" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Desc. curto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleAdvanceTime('longRest')}>
            <Ionicons name="moon" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Desc. longo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={[styles.smallButton, paused ? styles.smallButtonSuccess : styles.smallButtonActive]} onPress={handleTogglePause}>
            <Ionicons name={paused ? 'play' : 'pause'} size={15} color={paused ? appColors.success : appColors.primary} />
            <Text style={[styles.smallButtonText, paused ? styles.smallButtonTextSuccess : styles.smallButtonTextActive]}>{paused ? 'Retomar' : 'Pausar'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={handleStopSession}>
            <Ionicons name="stop" size={15} color={appColors.danger} />
            <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Fechar QR</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderQrCard = () => {
    if (!payload) return null;

    return (
      <View style={styles.card}>
        <View style={styles.qrHeader}>
          <View style={styles.qrHeaderTextBox}>
            <Text style={styles.sectionTitle}>Entrada por QR</Text>
            <Text style={styles.mutedText}>O QR serve para entrar ou voltar para a sessão pausada.</Text>
          </View>
          <View style={styles.qrIconBox}>
            <Ionicons name="qr-code" size={22} color={appColors.primary} />
          </View>
        </View>

        <QrCodeView value={joinLink} />

        {!joinUrl && (
          <Text style={styles.warningText}>
            Socket TCP indisponível neste ambiente. Use um dev build/native build; o Expo Go não consegue hospedar TCP local.
          </Text>
        )}

        <View style={styles.linkBox}>
          <Text style={styles.linkText}>{joinLink}</Text>
        </View>
      </View>
    );
  };

  const renderCatalogCard = () => {
    if (!payload) return null;

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>Acervo sincronizado</Text>
            <Text style={styles.mutedText}>{selectedCatalogKeys.length} customizados liberados para jogadores.</Text>
          </View>
          <TouchableOpacity style={styles.smallButton} onPress={() => setCatalogModalVisible(true)}>
            <Ionicons name="refresh" size={16} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Editar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderTimelineCard = () => {
    if (!payload || sessionEvents.length === 0) return null;

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Histórico da sessão</Text>
        <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
          {sessionEvents.map((event) => (
            <View key={event.id} style={styles.sessionEventRow}>
              <Ionicons
                name={event.type === 'effect_expired' ? 'hourglass' : event.type === 'player_joined' ? 'person-add' : 'sparkles'}
                size={16}
                color={event.type === 'effect_expired' ? appColors.warning : appColors.success}
              />
              <Text style={styles.sessionEventText}>{formatSessionEvent(event)}</Text>
              
              {event.type === 'spell_effect' && event.fromKey !== 'master' && !reviewedSpellEventIds.includes(event.id) && (
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleAcceptSpellEffect(event, true)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>OK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleAcceptSpellEffect(event, false)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Não</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderPlayers = () => {
    if (!sessionState) return null;

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>Painel dos jogadores</Text>
            <Text style={styles.mutedText}>HP, XP, moedas, inventário, status e efeitos ativos.</Text>
          </View>
          <Ionicons name="people" size={24} color={appColors.primary} />
        </View>

        {sessionState.players.length === 0 ? (
          <Text style={styles.hint}>Nenhum jogador notificou entrada ainda.</Text>
        ) : sessionState.players.map(renderPlayerCard)}

        {sessionState.players.length > 0 && (
          <View style={styles.effectForm}>
            <Text style={styles.strongText}>Distribuir XP para a party</Text>
            <View style={styles.effectInputRow}>
              <TextInput
                style={styles.effectInput}
                value={xpPool}
                onChangeText={setXpPool}
                keyboardType="numeric"
                placeholder="1000"
                placeholderTextColor={appColors.placeholderLight}
              />
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={handleDistributeXp}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Distribuir</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {sessionState.players.length > 0 && renderEffectForm()}
      </View>
    );
  };

  const renderPlayerCard = (player: LanSessionPlayerState) => {
    const selected = selectedPlayer?.id === player.id;
    const expanded = expandedPlayerIds.includes(player.id);
    const hpPercent = player.hpMax > 0 ? Math.max(0, Math.min(100, (player.hpCurrent / player.hpMax) * 100)) : 0;
    const bagPreview = getBagPreview(player.equipment);

    return (
      <TouchableOpacity
        key={player.id}
        style={[styles.playerCard, selected && styles.playerCardActive]}
        onPress={() => setSelectedPlayerId(player.id)}
      >
        <View style={styles.playerHeader}>
          <View style={styles.playerTitleBox}>
            <Text style={styles.playerName}>{player.characterName}</Text>
            <Text style={styles.playerMeta}>{player.race} - {player.className} - Nível {player.level}</Text>
            <Text style={styles.mutedText}>
              HP {player.hpCurrent}/{player.hpMax} - XP {player.xp} - {player.gp} PO - {player.effects.length} efeito(s)
            </Text>
          </View>
          <TouchableOpacity style={styles.statusPill} onPress={() => toggleExpandedPlayer(player.id)}>
            <Text style={styles.statusPillText}>{expanded ? 'Menos' : 'Mais info'}</Text>
          </TouchableOpacity>
        </View>

        {player.pendingCharacter && (
          <View style={styles.effectBox}>
            <Text style={styles.strongText}>Atualização pendente</Text>
            <Text style={styles.inventoryText}>
              {player.pendingDiff?.length ? player.pendingDiff.join(' | ') : 'A ficha local do jogador mudou desde o ultimo estado da sessao.'}
            </Text>
            <View style={styles.toolbar}>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleReviewPending(player, true)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Aceitar ficha</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleReviewPending(player, false)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Manter sessao</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.hpTrack}>
          <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'hpCurrent', player.hpCurrent - 1)}>
            <Text style={styles.smallButtonText}>-1 HP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'hpCurrent', Math.min(player.hpMax, player.hpCurrent + 1))}>
            <Text style={styles.smallButtonText}>+1 HP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => openQuickEdit(player, 'PV_TEMP')}>
            <Text style={styles.smallButtonText}>+ PV Temp</Text>
          </TouchableOpacity>
        </View>

        {expanded && (
          <>
            <View style={styles.metricGrid}>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'HP')}>
                <Text style={styles.metricLabel}>HP</Text>
                <Text style={styles.metricValue}>{player.hpCurrent}/{player.hpMax}</Text>
                {player.tempHp > 0 && <Text style={styles.mutedText}>+{player.tempHp} PV temp.</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'XP')}>
                <Text style={styles.metricLabel}>XP</Text>
                <Text style={styles.metricValue}>{player.xp}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.metricBox} onPress={() => openQuickEdit(player, 'COIN')}>
                <Text style={styles.metricLabel}>Moedas</Text>
                <Text style={styles.metricValue}>{player.gp} PO</Text>
                <Text style={styles.mutedText}>{player.sp} PP - {player.cp} PC</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toolbar}>
              <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger, { marginLeft: 'auto' }]} onPress={() => handleKickPlayer(player)}>
                <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Kick / Expulsar</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statGrid}>
              {STAT_KEYS.map((stat) => (
                <TouchableOpacity 
                  key={stat} 
                  style={styles.statPill}
                  onPress={() => openQuickEdit(player, 'STAT', stat)}
                >
                  <Text style={styles.statLabel}>{stat}</Text>
                  <Text style={styles.statValue}>{getEffectiveStat(player, stat)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inventoryBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.strongText}>Inventário</Text>
                <TouchableOpacity onPress={() => setInventoryModalPlayer(player)}>
                  <Text style={{ color: appColors.primary, fontSize: 12, fontWeight: 'bold' }}>Ver tudo</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.inventoryText}>{bagPreview || 'Bolsa vazia ou não sincronizada.'}</Text>
            </View>

            {player.effects.length > 0 && (
              <View style={styles.effectBox}>
                <Text style={styles.strongText}>Efeitos ativos</Text>
                {player.effects.map((effect) => (
                  <View key={effect.id} style={styles.effectRow}>
                    <Text style={styles.effectText}>{summarizeEffect(effect)}</Text>
                    <TouchableOpacity style={styles.smallButton} onPress={() => handleRemoveEffect(player.id, effect.id)}>
                      <Ionicons name="trash" size={14} color={appColors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderEffectForm = () => (
    <View style={styles.effectForm}>
      <Text style={styles.strongText}>Aplicar efeito</Text>
      
      {/* NOVO: Seleção do Alvo da Magia/Efeito */}
      <Text style={[styles.mutedText, { marginTop: 8 }]}>Alvo do efeito:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity 
          style={[styles.filterChip, effectTargetPlayerId === 'ALL' && styles.filterChipActive]} 
          onPress={() => setEffectTargetPlayerId('ALL')}
        >
          <Text style={[styles.filterChipText, effectTargetPlayerId === 'ALL' && styles.filterChipTextActive]}>Toda a Party</Text>
        </TouchableOpacity>
        {sessionState?.players.map((p) => (
          <TouchableOpacity 
            key={p.id}
            style={[styles.filterChip, effectTargetPlayerId === p.id && styles.filterChipActive]} 
            onPress={() => setEffectTargetPlayerId(p.id)}
          >
            <Text style={[styles.filterChipText, effectTargetPlayerId === p.id && styles.filterChipTextActive]}>{p.characterName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TextInput
        style={styles.effectInput}
        value={effectSearch}
        onChangeText={setEffectSearch}
        placeholder="Buscar magia, item, pocao, aura..."
        placeholderTextColor={appColors.placeholderLight}
      />

      <ScrollView 
        style={{ maxHeight: 190 }} 
        nestedScrollEnabled={true} 
        keyboardShouldPersistTaps="handled"
      >
        {filteredEffectOptions.map((option) => (
          <TouchableOpacity key={option.key} style={styles.catalogRow} onPress={() => handleSelectEffectOption(option)}>
            <View style={styles.catalogTextBox}>
              <Text style={styles.catalogTag}>{option.group}</Text>
              <Text style={styles.catalogName}>{option.name}</Text>
              <Text style={styles.catalogMeta}>{option.detail || 'Sem detalhe cadastrado'}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.inventoryBox}>
        <Text style={styles.strongText}>{effectName}</Text>
        <Text style={styles.inventoryText}>Fonte: {effectSource || 'base'} - ajuste alvo, valor e duração antes de aplicar.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true}>
        <View style={styles.filterRail}>
          {EFFECT_TARGETS.map((target) => (
            <TouchableOpacity
              key={target}
              style={[styles.filterChip, effectTarget === target && styles.filterChipActive]}
              onPress={() => setEffectTarget(target)}
            >
              <Text style={[styles.filterChipText, effectTarget === target && styles.filterChipTextActive]}>{target}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mutedText, { marginBottom: 4, fontSize: 12 }]}>Valor (Ex: 2, -1)</Text>
          <TextInput
            style={styles.effectInput}
            value={effectValue}
            onChangeText={setEffectValue}
            keyboardType="numeric"
            placeholder="+2"
            placeholderTextColor={appColors.placeholderLight}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mutedText, { marginBottom: 4, fontSize: 12 }]}>Tempo</Text>
          <TextInput
            style={styles.effectInput}
            value={effectDuration}
            onChangeText={setEffectDuration}
            keyboardType="numeric"
            placeholder="3"
            placeholderTextColor={appColors.placeholderLight}
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
        <View style={styles.filterRail}>
          {EFFECT_UNITS.map((unit) => (
            <TouchableOpacity
              key={unit.value}
              style={[styles.filterChip, effectUnit === unit.value && styles.filterChipActive]}
              onPress={() => setEffectUnit(unit.value)}
            >
              <Text style={[styles.filterChipText, effectUnit === unit.value && styles.filterChipTextActive]}>{unit.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={[styles.primaryButton, styles.fullWidthButton]} onPress={handleApplyEffect}>
        <Text style={styles.primaryButtonText}>APLICAR EFEITO</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color={appColors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Sessão LAN</Text>
          <Text style={styles.topBarSub}>Mestre ou jogador</Text>
        </View>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!payload ? (
          renderSetup()
        ) : (
          <>
            {renderSessionControls()}
            {renderTimelineCard()}
            {renderPlayers()}
            {renderCatalogCard()}
            {renderQrCard()}
          </>
        )}
      </ScrollView>

      {/* MODAIS AQUI - Eles precisam estar renderizados no topo da árvore */}
      {renderCatalogModal()}
      {renderInventoryModal()}
      {renderQuickEditModal()}
      
      {payload && <DiceRoller3D />}
    </LinearGradient>
  );
}

// === FUNÇÕES UTILITÁRIAS ===

function getEffectiveStat(player: LanSessionPlayerState, stat: string) {
  const baseValue = Number(player.stats?.[stat]) || 0;
  const effectValue = player.effects
    .filter((effect) => effect.target === stat)
    .reduce((total, effect) => total + effect.value, 0);

  const total = baseValue + effectValue;
  return effectValue === 0 ? String(total) : `${total} (${effectValue > 0 ? '+' : ''}${effectValue})`;
}

function getBagPreview(equipment: Record<string, unknown>) {
  const bag = Array.isArray((equipment as any).bag) ? (equipment as any).bag : [];
  return bag
    .slice(0, 5)
    .map((item: any) => `${item.qty || 1}x ${item.name || 'Item'}`)
    .join(', ');
}

function formatSessionEvent(event: LanSessionEvent) {
  if (event.message) return event.message;
  if (event.type === 'player_joined') return `${event.fromName} entrou na sessao.`;
  if (event.type === 'effect_expired') {
    const effectName = event.expiredEffect?.name || 'Efeito';
    return `${event.toName}: ${effectName} acabou.`;
  }
  if (event.type === 'spell_effect') {
    if (event.fromKey === event.toKey || event.fromName === event.toName) return `${event.fromName} usou ${event.spellEffect?.spellName || 'efeito'}.`;
    return `${event.fromName} quer aplicar ${event.spellEffect?.spellName || 'efeito'} em ${event.toName}.`;
  }
  if (event.type === 'spell_hp') return `${event.fromName} usou ${event.spellEffect?.spellName || 'magia'} em ${event.toName}.`;
  return event.type;
}

function parseOptionEffects(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEffectUnit(value: unknown): LanEffectUnit | null {
  if (value === 'turn' || value === 'minute' || value === 'hour' || value === 'rest') return value;
  return null;
}

function inferUnitFromText(value?: string): LanEffectUnit {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('turno') || raw.includes('rodada')) return 'turn';
  if (raw.includes('hora')) return 'hour';
  if (raw.includes('min')) return 'minute';
  return 'rest';
}

function normalizeEffectTarget(value: unknown): LanEffectTarget {
  const target = String(value || '').toUpperCase();
  if (target === 'FOR' || target === 'DES' || target === 'CON' || target === 'INT' || target === 'SAB' || target === 'CAR' || target === 'CA' || target === 'HP' || target === 'PV_TEMP') {
    return target as LanEffectTarget;
  }
  return 'custom';
}
