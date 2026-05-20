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
  getLanSessionState,
  getMasterJoinedPlayers,
  getNativeSessionEvents,
  getSavedLanSessions,
  keysFromSelection,
  makeInviteCode,
  makeSessionId,
  pauseLanSession,
  rebuildLanSessionCatalog,
  rememberLanSessionEvent,
  refreshLanSessionPayload,
  removeLanPlayerEffect,
  resumeLanSession,
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
  type LanSessionPayload,
  type LanSessionPlayerState,
  type LanSessionState,
  type LanSessionSummary,
} from '@/services/lanSession';
import { appColors, appGradients, lanSessionStyles as styles } from '@/styles/globalStyles';

const CATALOG_FILTERS = ['Todos', 'Item', 'Raca', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit'];
const EFFECT_TARGETS: LanEffectTarget[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'HP', 'custom'];
const EFFECT_UNITS: { label: string; value: LanEffectUnit }[] = [
  { label: 'Turnos', value: 'turn' },
  { label: 'Minutos', value: 'minute' },
  { label: 'Horas', value: 'hour' },
  { label: 'Descanso', value: 'rest' },
];
const STAT_KEYS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];

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
  const [joinUrl, setJoinUrl] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [savedSessions, setSavedSessions] = useState<LanSessionSummary[]>([]);

  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [selectedCatalogKeys, setSelectedCatalogKeys] = useState<string[]>([]);
  const [catalogModalVisible, setCatalogModalVisible] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState('Todos');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [effectName, setEffectName] = useState('Efeito temporario');
  const [effectTarget, setEffectTarget] = useState<LanEffectTarget>('FOR');
  const [effectValue, setEffectValue] = useState('2');
  const [effectDuration, setEffectDuration] = useState('3');
  const [effectUnit, setEffectUnit] = useState<LanEffectUnit>('turn');
  const [effectSource, setEffectSource] = useState('');

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

  const loadSavedSessions = useCallback(async () => {
    setSavedSessions(await getSavedLanSessions(db));
  }, [db]);

  const loadCatalogOptions = useCallback(async () => {
    const options = await getCustomCatalogOptions(db);
    setCatalogOptions(options);
    setSelectedCatalogKeys((current) => current.length > 0 ? current : options.map((option) => option.key));
  }, [db]);

  const reloadSessionState = useCallback(async (sessionId: string, syncPayload = false) => {
    const nextState = await getLanSessionState(db, sessionId);
    setSessionState(nextState);

    if (syncPayload) {
      const nextPayload = await syncLanSessionPayload(db, sessionId);
      if (nextPayload) setPayload(nextPayload);
    }
  }, [db]);

  useEffect(() => {
    loadCatalogOptions();
    loadSavedSessions();
  }, [loadCatalogOptions, loadSavedSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    const pollJoinedPlayers = async () => {
      const joinedPlayers = await getMasterJoinedPlayers();
      for (const entry of joinedPlayers) {
        if (entry?.sessionId === activeSessionId) {
          await upsertLanSessionPlayerFromNetwork(db, entry);
        }
      }

      const events = await getNativeSessionEvents();
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
            await updateLanPlayerNumbers(db, player.id, {
              hpCurrent: event.publicState.hpCurrent,
              hpMax: event.publicState.hpMax,
            });
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
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            const targetPlayer = currentState.players.find((entry) => entry.remoteKey === event.toKey || entry.characterName === event.toName);
            if (!targetPlayer) continue;
            await addLanPlayerEffect(db, targetPlayer.id, {
              name: event.spellEffect.spellName,
              target: event.spellEffect.target || 'custom',
              value: event.spellEffect.value || 0,
              remaining: event.spellEffect.durationRemaining || 1,
              unit: event.spellEffect.durationUnit || 'rest',
              source: event.fromName,
            });
          }
        }
      }

      await reloadSessionState(activeSessionId);
    };

    pollJoinedPlayers();
    const timer = setInterval(pollJoinedPlayers, 2500);
    return () => clearInterval(timer);
  }, [activeSessionId, db, reloadSessionState]);

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
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedPlayerId(null);
      await loadSavedSessions();
    } catch (error) {
      Alert.alert('Sessao LAN', 'Nao foi possivel iniciar a sessao LAN neste dispositivo.');
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
      if (!nextPayload) throw new Error('Sessao nao encontrada.');

      const nextJoinUrl = await startLanServer(nextPayload);
      await saveLanSession(db, nextPayload, nextJoinUrl);
      setPayload(nextPayload);
      setSessionState(nextPayload.state || await getLanSessionState(db, session.id));
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedCatalogKeys(keysFromSelection(nextPayload.selectedCatalog));
      await loadSavedSessions();
    } catch (error) {
      Alert.alert('Sessao LAN', 'Nao foi possivel retomar esta sessao.');
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
    setJoinUrl('');
    setJoinLink('');
    setSelectedPlayerId(null);
    await loadSavedSessions();
  };

  const handleDeleteSavedSession = (session: LanSessionSummary) => {
    Alert.alert(
      'Excluir sessao',
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
    field: 'hpCurrent' | 'hpMax' | 'xp' | 'gp' | 'sp' | 'cp',
    value: number
  ) => {
    const patch = { [field]: Math.max(0, value) };
    await updateLanPlayerNumbers(db, player.id, patch);
    if (payload) await reloadSessionState(payload.session.id);
  };

  const handleApplyEffect = async () => {
    const player = selectedPlayer;
    if (!player) return;

    await addLanPlayerEffect(db, player.id, {
      name: effectName.trim() || 'Efeito temporario',
      target: effectTarget,
      value: parseInt(effectValue, 10) || 0,
      remaining: Math.max(1, parseInt(effectDuration, 10) || 1),
      unit: effectUnit,
      source: effectSource.trim() || undefined,
    });

    if (payload) await reloadSessionState(payload.session.id);
  };

  const handleRemoveEffect = async (playerId: number, effectId: string) => {
    await removeLanPlayerEffect(db, playerId, effectId);
    if (payload) await reloadSessionState(payload.session.id);
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

  const renderSetup = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Criar sala</Text>

        <Text style={styles.label}>NOME DA SESSAO</Text>
        <TextInput style={styles.input} value={sessionName} onChangeText={setSessionName} placeholder="Ex: A mina perdida" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NOME DO MESTRE</Text>
        <TextInput style={styles.input} value={masterName} onChangeText={setMasterName} placeholder="Mestre" placeholderTextColor={appColors.placeholderLight} />

        <Text style={styles.label}>NIVEL DA MESA</Text>
        <TextInput style={styles.input} value={level} onChangeText={setLevel} keyboardType="numeric" placeholder="1" placeholderTextColor={appColors.placeholderLight} />

        <View style={styles.ruleRow}>
          <View style={styles.ruleTextBox}>
            <Text style={styles.ruleTitle}>Permitir personagem existente</Text>
            <Text style={styles.ruleDescription}>Se desligado, os jogadores precisam criar uma ficha nova para esta sessao.</Text>
          </View>
          <Switch value={allowExisting} onValueChange={setAllowExisting} trackColor={{ false: appColors.neutral, true: appColors.primary }} thumbColor={appColors.textPrimary} />
        </View>

        <View style={styles.catalogSummaryBox}>
          <View style={styles.catalogSummaryRow}>
            <View style={styles.catalogSummaryTextBox}>
              <Text style={styles.catalogSummaryText}>Acervo preparado</Text>
              <Text style={styles.mutedText}>{selectedCatalogKeys.length} customizados serao sincronizados pelo QR.</Text>
            </View>
            <TouchableOpacity style={styles.smallButton} onPress={() => setCatalogModalVisible(true)}>
              <Ionicons name="albums" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleStartSession} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'INICIANDO...' : 'INICIAR SESSAO LAN'}</Text>
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
            <Text style={styles.mutedText}>Nivel {payload.session.level} - Codigo {payload.session.inviteCode}</Text>
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
            <Text style={styles.mutedText}>O QR serve para entrar ou voltar para a sessao pausada.</Text>
          </View>
          <View style={styles.qrIconBox}>
            <Ionicons name="qr-code" size={22} color={appColors.primary} />
          </View>
        </View>

        <QrCodeView value={joinLink} />

        {!joinUrl && (
          <Text style={styles.warningText}>
            Servidor LAN nativo indisponivel neste ambiente. O QR usa fallback local e pode ficar grande se houver muito acervo.
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

  const renderPlayers = () => {
    if (!sessionState) return null;

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.sectionTitle}>Painel dos jogadores</Text>
            <Text style={styles.mutedText}>HP, XP, moedas, inventario, status e efeitos ativos.</Text>
          </View>
          <Ionicons name="people" size={24} color={appColors.primary} />
        </View>

        {sessionState.players.length === 0 ? (
          <Text style={styles.hint}>Nenhum jogador notificou entrada ainda.</Text>
        ) : sessionState.players.map(renderPlayerCard)}

        {sessionState.players.length > 0 && renderEffectForm()}
      </View>
    );
  };

  const renderPlayerCard = (player: LanSessionPlayerState) => {
    const selected = selectedPlayer?.id === player.id;
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
            <Text style={styles.playerMeta}>{player.race} - {player.className} - Nivel {player.level}</Text>
            <Text style={styles.mutedText}>Jogador: {player.playerName || 'Sem nome'}</Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>Selecionar</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>HP</Text>
            <Text style={styles.metricValue}>{player.hpCurrent}/{player.hpMax}</Text>
            <View style={styles.hpTrack}>
              <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
            </View>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>XP</Text>
            <Text style={styles.metricValue}>{player.xp}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Moedas</Text>
            <Text style={styles.metricValue}>{player.gp} PO</Text>
            <Text style={styles.mutedText}>{player.sp} PP - {player.cp} PC</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'hpCurrent', player.hpCurrent - 1)}>
            <Text style={styles.smallButtonText}>-1 HP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'hpCurrent', Math.min(player.hpMax, player.hpCurrent + 1))}>
            <Text style={styles.smallButtonText}>+1 HP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'xp', player.xp + 100)}>
            <Text style={styles.smallButtonText}>+100 XP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayer(player, 'gp', player.gp + 10)}>
            <Text style={styles.smallButtonText}>+10 PO</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statGrid}>
          {STAT_KEYS.map((stat) => (
            <View key={stat} style={styles.statPill}>
              <Text style={styles.statLabel}>{stat}</Text>
              <Text style={styles.statValue}>{getEffectiveStat(player, stat)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.inventoryBox}>
          <Text style={styles.strongText}>Inventario</Text>
          <Text style={styles.inventoryText}>{bagPreview || 'Bolsa vazia ou nao sincronizada.'}</Text>
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
      </TouchableOpacity>
    );
  };

  const renderEffectForm = () => (
    <View style={styles.effectForm}>
      <Text style={styles.strongText}>Aplicar efeito temporario</Text>
      <Text style={styles.mutedText}>
        Alvo: {selectedPlayer?.characterName || 'selecione um personagem'}.
      </Text>

      <TextInput
        style={styles.effectInput}
        value={effectName}
        onChangeText={setEffectName}
        placeholder="Nome do item, magia ou efeito"
        placeholderTextColor={appColors.placeholderLight}
      />
      <TextInput
        style={styles.effectInput}
        value={effectSource}
        onChangeText={setEffectSource}
        placeholder="Fonte opcional: Armadura Arcana, pocao, aura..."
        placeholderTextColor={appColors.placeholderLight}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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

      <View style={styles.effectInputRow}>
        <TextInput
          style={styles.effectInput}
          value={effectValue}
          onChangeText={setEffectValue}
          keyboardType="numeric"
          placeholder="+2"
          placeholderTextColor={appColors.placeholderLight}
        />
        <TextInput
          style={styles.effectInput}
          value={effectDuration}
          onChangeText={setEffectDuration}
          keyboardType="numeric"
          placeholder="3"
          placeholderTextColor={appColors.placeholderLight}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
          <Text style={styles.topBarTitle}>Sessao LAN</Text>
          <Text style={styles.topBarSub}>Mestre da mesa</Text>
        </View>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!payload ? (
          renderSetup()
        ) : (
          <>
            {renderSessionControls()}
            {renderPlayers()}
            {renderCatalogCard()}
            {renderQrCard()}
          </>
        )}
      </ScrollView>

      {renderCatalogModal()}
      {payload && <DiceRoller3D />}
    </LinearGradient>
  );
}

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
