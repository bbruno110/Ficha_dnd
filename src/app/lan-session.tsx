import DiceRoller3D from '@/components/DiceRoller3D';
import QrCodeView from '@/components/QrCodeView';
import { useLanAppLifecycle } from '@/hooks/useLanAppLifecycle';
import {
  traceApp,
  traceButton,
  traceError,
  traceFunctionCall,
  traceFunctionReturn,
  traceScreen,
  traceSqlite,
  traceStateChange,
} from '@/services/debug/appTrace';
import { listEffects } from '@/services/effects/effectCatalogService';
import { listPendingSaves, resolveSave } from '@/services/effects/effectResolver';
import type { LanPendingSave } from '@/services/effects/effectTypes';
import {
  addLanPlayerEffect,
  addLanPlayerEffectsBatch,
  advanceLanSessionTime,
  applyLanInventoryTransferEvent,
  applyLanPlayerInventoryPatch,
  applyLanPlayerNumberPatch,
  applyLanResourceRequest,
  buildJoinDeepLink,
  buildLanSessionPayload,
  consumeLanForegroundStopRequest,
  deleteLanSession,
  endLanSession,
  ensurePendingRemotePlayerFromEvent,
  formatElapsedTime,
  getBoundLanCharacter,
  getCustomCatalogOptions,
  getLanSessionEvents,
  getLanSessionState,
  getMasterJoinedPlayers,
  getNativeSessionEvents,
  getSavedLanSessions,
  isEmulatorOnlyTcpUrl,
  keysFromSelection,
  kickLanSessionPlayer,
  makeInviteCode,
  makeLanEventId,
  makeSessionId,
  pauseLanSession,
  rebuildLanSessionCatalog,
  refreshLanSessionPayload,
  rememberAndSendLanSessionEvent,
  rememberLanSessionEvent,
  removeLanPlayerEffect,
  resetLanClientConnection,
  resumeLanSession,
  reviewLanPlayerPendingSnapshot,
  saveLanSession,
  sendLanSessionEvent,
  selectionFromKeys,
  startLanServer,
  stopLanServer,
  subscribeLanForegroundStop,
  subscribeLanSessionHostUpdates,
  summarizeEffect,
  switchLanRole,
  syncLanSessionPayload,
  updateLanPlayerEquipment,
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
  type LanTradeItem,
} from '@/services/lanSession';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import {
  applyHostEffectPatchRuntime,
  applyHostNumberDeltaRuntime,
  applyHostNumberPatchRuntime,
  applyHostTurnRuntime,
  mergeSessionStatePreservingLiveFields,
  removeHostPlayerRuntime,
  replaceLanRuntimeStateFromBootstrap,
} from '@/stores/lanSessionRuntimeStore';
import { appColors, appGradients, lanSessionStyles as styles } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

const CATALOG_FILTERS = ['Todos', 'Item', 'Raca', 'Classe', 'Subclasse', 'Magia/Skill', 'Kit'];
const EFFECT_TARGETS: LanEffectTarget[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'HP', 'PV_TEMP', 'custom'];
const EFFECT_UNITS: { label: string; value: LanEffectUnit }[] = [
  { label: 'Turnos', value: 'turn' },
  { label: 'Minutos', value: 'minute' },
  { label: 'Horas', value: 'hour' },
  { label: 'Descanso', value: 'rest' },
];
const STAT_KEYS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
const INVENTORY_FILTERS = ['Todos', 'Armas', 'Armaduras', 'Consumiveis', 'Efeitos', 'Outros'] as const;

type InventoryFilter = (typeof INVENTORY_FILTERS)[number];
type ReferenceOption = { id: string; name: string; stat?: string };
type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;
type EffectDraft = {
  name: string;
  target: LanEffectTarget;
  value: number;
  remaining: number;
  unit: LanEffectUnit;
  durationText?: string;
  kind?: 'stat' | 'hp' | 'temp_hp' | 'status' | 'custom';
  mode?: 'add' | 'set';
  source?: string;
  statusKey?: string;
  color?: string;
  secondaryColor?: string;
};

type EffectOption = {
  key: string;
  name: string;
  group: string;
  detail: string;
  effects: any[];
  durationValue?: number | null;
  durationUnit?: LanEffectUnit | null;
  durationText?: string;
  statusKey?: string;
  color?: string;
  secondaryColor?: string;
};

type InventoryItemOption = LanTradeItem & {
  id: number;
  descricao?: string;
  category?: InventoryFilter;
};

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const masterMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const silentPayloadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enqueueMasterMutation = useCallback((task: () => Promise<void>) => {
    const run = masterMutationQueueRef.current
      .catch(() => undefined)
      .then(task);

    masterMutationQueueRef.current = run.catch((error) => {
      console.warn('[LAN MASTER MUTATION FAILED]', error);
    });

    return run;
  }, []);

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
  const [effectMode, setEffectMode] = useState<'add' | 'set'>('add');
  const [effectSource, setEffectSource] = useState('');
  const [effectStatusKey, setEffectStatusKey] = useState('');
  const [effectColor, setEffectColor] = useState('');
  const [effectSecondaryColor, setEffectSecondaryColor] = useState('');
  const [effectSearch, setEffectSearch] = useState('');
  const [selectedEffectKeys, setSelectedEffectKeys] = useState<string[]>([]);
  const [effectSaveInfo, setEffectSaveInfo] = useState('');
  const [effectOptions, setEffectOptions] = useState<EffectOption[]>([]);
  const [expandedPlayerIds, setExpandedPlayerIds] = useState<number[]>([]);
  const [reviewedSpellEventIds, setReviewedSpellEventIds] = useState<string[]>([]);
  const [reviewedRequestEventIds, setReviewedRequestEventIds] = useState<string[]>([]);
  const [pendingSaves, setPendingSaves] = useState<LanPendingSave[]>([]);
  const [xpPool, setXpPool] = useState('1000');

  const [inventoryModalPlayer, setInventoryModalPlayer] = useState<LanSessionPlayerState | null>(null);
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryItemOption[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('Todos');
  const [grantItemQty, setGrantItemQty] = useState('1');
  const [detailPlayer, setDetailPlayer] = useState<LanSessionPlayerState | null>(null);
  const [skillOptions, setSkillOptions] = useState<ReferenceOption[]>([]);
  const [saveOptions, setSaveOptions] = useState<ReferenceOption[]>([]);
  const [spellOptions, setSpellOptions] = useState<ReferenceOption[]>([]);
  
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
  const sessionStateRef = useRef<LanSessionState | null>(null);
  const selectedPlayer = useMemo(
    () => sessionState?.players.find((player) => player.id === selectedPlayerId) || sessionState?.players[0],
    [selectedPlayerId, sessionState?.players]
  );

  useFocusEffect(
    useCallback(() => {
      traceScreen('lan-session', 'LAN_SESSION_SCREEN_FOCUS', {
        source: 'LanSessionScreen',
        sessionId: activeSessionId,
        joinUrl,
        playerCount: sessionStateRef.current?.players.length || 0,
      });
    }, [activeSessionId, joinUrl])
  );

  useEffect(() => {
    sessionStateRef.current = sessionState;
    if (activeSessionId) replaceLanRuntimeStateFromBootstrap(activeSessionId, sessionState);
  }, [activeSessionId, sessionState]);

  const applyExternalSessionState = useCallback((
    sessionId: string,
    incomingState: LanSessionState | null | undefined,
    source: 'sqlite' | 'snapshot' | 'runtime' = 'sqlite',
  ) => {
    if (!incomingState) {
      sessionStateRef.current = null;
      setSessionState(null);
      return null;
    }

    traceStateChange('STATE_VERSION_COMPARE', 'MASTER_EXTERNAL_STATE_MERGE_START', {
      playerCount: sessionStateRef.current?.players.length || 0,
      currentTurn: sessionStateRef.current?.currentTurn,
      elapsedMinutes: sessionStateRef.current?.elapsedMinutes,
    }, {
      playerCount: incomingState.players.length,
      currentTurn: incomingState.currentTurn,
      elapsedMinutes: incomingState.elapsedMinutes,
    }, {
      screen: 'lan-session',
      source,
      sessionId,
      decision: 'merge_preserving_live_fields',
    });
    const merged = mergeSessionStatePreservingLiveFields(sessionStateRef.current, incomingState, sessionId, source);
    sessionStateRef.current = merged;
    setSessionState(merged);
    traceStateChange('STATE_CHANGE', 'MASTER_EXTERNAL_STATE_MERGE_DONE', incomingState, merged, {
      screen: 'lan-session',
      source,
      sessionId,
      decision: 'merged',
    });
    return merged;
  }, []);

  const applyExternalPayload = useCallback((
    nextPayload: LanSessionPayload | null | undefined,
    source: 'sqlite' | 'snapshot' | 'runtime' = 'snapshot',
  ) => {
    if (!nextPayload) return null;
    traceApp(source === 'snapshot' ? 'SNAPSHOT_RECEIVED' : 'PAYLOAD_RECEIVED', 'MASTER_EXTERNAL_PAYLOAD_RECEIVED', {
      screen: 'lan-session',
      source,
      sessionId: nextPayload.session.id,
      payload: {
        playerCount: nextPayload.state?.players.length || 0,
        eventCount: nextPayload.events?.length || 0,
        currentTurn: nextPayload.state?.currentTurn,
        elapsedMinutes: nextPayload.state?.elapsedMinutes,
      },
    });
    const mergedState = applyExternalSessionState(nextPayload.session.id, nextPayload.state || null, source);
    const mergedPayload = mergedState ? { ...nextPayload, state: mergedState } : nextPayload;
    setPayload(mergedPayload);
    traceApp(source === 'snapshot' ? 'SNAPSHOT_APPLIED' : 'PAYLOAD_APPLIED', 'MASTER_EXTERNAL_PAYLOAD_APPLIED', {
      screen: 'lan-session',
      source,
      sessionId: nextPayload.session.id,
      decision: 'structural_merge_preserving_live_fields',
      payload: {
        playerCount: mergedPayload.state?.players.length || 0,
        eventCount: mergedPayload.events?.length || 0,
      },
    });
    return mergedPayload;
  }, [applyExternalSessionState]);

  const scheduleSilentPayloadRefresh = useCallback((sessionId: string) => {
    if (!sessionId) return;
    if (silentPayloadRefreshTimerRef.current) {
      clearTimeout(silentPayloadRefreshTimerRef.current);
    }

    silentPayloadRefreshTimerRef.current = setTimeout(() => {
      silentPayloadRefreshTimerRef.current = null;
      void (async () => {
        try {
          traceApp('POLLING_TICK', 'MASTER_SILENT_PAYLOAD_REFRESH_TICK', {
            screen: 'lan-session',
            source: 'scheduleSilentPayloadRefresh',
            sessionId,
          });
          const nextPayload = await syncLanSessionPayload(db, sessionId, { broadcast: false });
          if (!nextPayload || activeSessionId !== sessionId) return;

          applyExternalPayload(nextPayload, 'sqlite');
        } catch (error) {
          console.warn('[LAN MASTER] Falha ao recalcular payload silencioso:', error);
        }
      })();
    }, 250);
  }, [activeSessionId, applyExternalPayload, db]);

  useEffect(() => () => {
    if (silentPayloadRefreshTimerRef.current) {
      clearTimeout(silentPayloadRefreshTimerRef.current);
      silentPayloadRefreshTimerRef.current = null;
    }
  }, []);

  const getPlayerRevision = useCallback(async (playerId: number) => {
    const row = await db.getFirstAsync<{ revisionSeq?: number }>(
      `SELECT COALESCE(revision_seq, 0) as revisionSeq FROM lan_session_players WHERE id = ?`,
      [playerId]
    );
    return Math.max(0, Math.floor(Number(row?.revisionSeq || 0)));
  }, [db]);

  const sendLiveEventToClients = useCallback(async (event: LanSessionEvent | null | undefined) => {
    if (!event || !joinUrl) return false;

    try {
      await sendLanSessionEvent(joinUrl, event);
      debugLanFlow('MASTER_EVENT_SENT', {
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        toKey: event.toKey,
      });
      setSessionEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20));
      return true;
    } catch (error) {
      console.warn('[LAN MASTER] Falha ao enviar evento vivo:', {
        type: event.type,
        id: event.id,
        toKey: event.toKey,
        error,
      });
      return false;
    }
  }, [joinUrl]);

  const sendLatestLiveEvent = useCallback(async (
    sessionId: string,
    predicate: (event: LanSessionEvent) => boolean,
  ) => {
    const events = await getLanSessionEvents(db, sessionId, 40);
    const event = events.find(predicate);
    if (event) {
      debugLanFlow('MASTER_EVENT_CREATED', {
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
      });
      await sendLiveEventToClients(event);
    }
    return event || null;
  }, [db, sendLiveEventToClients]);

  const sendRecentLiveEvents = useCallback(async (
    sessionId: string,
    predicate: (event: LanSessionEvent) => boolean,
  ) => {
    const events = await getLanSessionEvents(db, sessionId, 40);
    const selected = events.filter(predicate).slice(0, 20).reverse();
    for (const event of selected) {
      await sendLiveEventToClients(event);
    }
  }, [db, sendLiveEventToClients]);
  
  const filteredCatalogOptions = useMemo(() => {
    const search = catalogSearch.trim().toLowerCase();
    return catalogOptions.filter((option) => {
      const matchesFilter = catalogFilter === 'Todos' || option.group === catalogFilter;
      const matchesSearch = !search || option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [catalogFilter, catalogOptions, catalogSearch]);
  
  const selectedCatalogSet = useMemo(() => new Set(selectedCatalogKeys), [selectedCatalogKeys]);
  const selectedEffectSet = useMemo(() => new Set(selectedEffectKeys), [selectedEffectKeys]);
  const selectedEffectOptions = useMemo(
    () => effectOptions.filter((option) => selectedEffectSet.has(option.key)),
    [effectOptions, selectedEffectSet]
  );
  
  const filteredEffectOptions = useMemo(() => {
    const search = effectSearch.trim().toLowerCase();
    return effectOptions.filter((option) => {
      if (!search) return true;
      return option.name.toLowerCase().includes(search) || option.detail.toLowerCase().includes(search);
    }).slice(0, 12);
  }, [effectOptions, effectSearch]);

  const filteredInventoryCatalog = useMemo(() => {
    const search = inventorySearch.trim().toLowerCase();
    return inventoryCatalog.filter((item) => {
      const matchesFilter = inventoryFilter === 'Todos' || getInventoryItemCategory(item) === inventoryFilter;
      const matchesSearch = !search || matchesInventorySearch(item, search);
      return matchesFilter && matchesSearch;
    }).slice(0, 60);
  }, [inventoryCatalog, inventoryFilter, inventorySearch]);

  const reviewedRequestEventSet = useMemo(() => {
    const reviewedIds = sessionEvents
      .filter((event) => event.type === 'resource_review' && event.tradeId)
      .map((event) => String(event.tradeId));
    return new Set([...reviewedRequestEventIds, ...reviewedIds]);
  }, [reviewedRequestEventIds, sessionEvents]);

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
      `SELECT id, name, weight, damage, damage_type, properties, descricao, effect_json, duration_value, duration_unit
       FROM items
       ORDER BY name ASC`
    );
    const conditions = await listEffects(db);
    const saves = await db.getAllAsync<ReferenceOption>(`SELECT id, name, stat FROM saving_throws ORDER BY name ASC`);
    const skills = await db.getAllAsync<ReferenceOption>(`SELECT id, name, stat FROM skills ORDER BY name ASC`);

    setSaveOptions(saves);
    setSkillOptions(skills);
    setSpellOptions(spells.map((spell) => ({
      id: String(spell.id || ''),
      name: String(spell.name || 'Magia'),
    })));

    setInventoryCatalog(items.map((row) => ({
      id: Number(row.id) || 0,
      name: String(row.name || 'Item'),
      qty: 1,
      weight: Number(row.weight) || 0,
      damage: String(row.damage || ''),
      damage_type: String(row.damage_type || ''),
      properties: String(row.properties || ''),
      descricao: String(row.descricao || ''),
      effect_json: String(row.effect_json || '[]'),
      duration_value: row.duration_value == null ? null : Number(row.duration_value),
      duration_unit: row.duration_unit ? String(row.duration_unit) : null,
      category: getInventoryItemCategory(row),
    })));

    setEffectOptions([
      ...conditions.map((row) => ({
        key: `condition:${row.id || row.statusKey}`,
        name: String(row.name || 'Condicao'),
        group: 'Condicao',
        detail: String(row.description || 'Condicao da mesa'),
        effects: [{
          target: row.target || 'custom',
          value: Number(row.value) || 0,
          status: row.statusKey,
          statusKey: row.statusKey,
          color: row.color,
          secondaryColor: row.secondaryColor,
          conditionName: row.name,
          saveAbility: row.saveAbility,
          saveOnSuccess: row.saveOnSuccess,
        }],
        durationValue: Number(row.defaultDurationValue) || 1,
        durationUnit: normalizeEffectUnit(row.defaultDurationUnit),
        durationText: String(row.description || ''),
        statusKey: row.statusKey ? String(row.statusKey) : undefined,
        color: row.color ? String(row.color) : undefined,
        secondaryColor: row.secondaryColor ? String(row.secondaryColor) : undefined,
      })),
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
    const startedAt = Date.now();
    traceFunctionCall('reloadSessionState', { sessionId, syncPayload }, {
      screen: 'lan-session',
      source: 'reloadSessionState',
      sessionId,
    });
    const nextState = await getLanSessionState(db, sessionId);
    applyExternalSessionState(sessionId, nextState, 'sqlite');
    setSessionEvents(await getLanSessionEvents(db, sessionId, 20));
    setPendingSaves(await listPendingSaves(db, sessionId));

    if (syncPayload) {
      const nextPayload = await syncLanSessionPayload(db, sessionId, { broadcast: false });
      if (nextPayload) applyExternalPayload(nextPayload, 'sqlite');
    }
    traceFunctionReturn('reloadSessionState', {
      sessionId,
      playerCount: nextState.players.length,
      currentTurn: nextState.currentTurn,
      elapsedMinutes: nextState.elapsedMinutes,
    }, {
      screen: 'lan-session',
      source: 'reloadSessionState',
      sessionId,
      durationMs: Date.now() - startedAt,
    });
  }, [applyExternalPayload, applyExternalSessionState, db]);

  const resumeMasterHost = useCallback(async () => {
  if (!payload?.session?.id) return;

  try {
    const nextPayload = await refreshLanSessionPayload(db, payload.session.id);
    if (!nextPayload) return;

    const nextJoinUrl = await startLanServer(nextPayload);

    await saveLanSession(db, nextPayload, nextJoinUrl, { isMaster: true });

    applyExternalPayload(nextPayload, 'sqlite');
    setJoinUrl(nextJoinUrl);
    setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));

    await reloadSessionState(nextPayload.session.id, false);
    await loadSavedSessions();
  } catch (error) {
    console.warn('[LAN] Não foi possível retomar o host LAN automaticamente:', error);
  }
}, [applyExternalPayload, buildJoinDeepLink, db, loadSavedSessions, payload?.session?.id, refreshLanSessionPayload, reloadSessionState, saveLanSession, startLanServer]);

useLanAppLifecycle({
  enabled: Boolean(payload?.session?.id && joinUrl),
  onBackground: async () => {
  },
  onForeground: async () => {
    await resumeMasterHost();
  },
});

  useEffect(() => {
    loadCatalogOptions();
    loadEffectOptions();
    loadSavedSessions();
  }, [loadCatalogOptions, loadEffectOptions, loadSavedSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    const pollJoinedPlayers = async () => {
      traceApp('POLLING_TICK', 'MASTER_POLL_JOINED_PLAYERS_TICK', {
        screen: 'lan-session',
        source: 'pollJoinedPlayers',
        sessionId: activeSessionId,
        joinUrl,
      });
      const joinedPlayers = await getMasterJoinedPlayers(joinUrl);
      let changedPlayers = false;

      for (const entry of joinedPlayers) {
        const entrySessionId = String(entry?.sessionId || '');
        if (entrySessionId === activeSessionId) {
          try {
            const playerId = await upsertLanSessionPlayerFromNetwork(db, entry);
            if (playerId) changedPlayers = true;
          } catch (error) {
            const entryCharacter =
              entry?.character && typeof entry.character === 'object'
                ? entry.character as Record<string, unknown>
                : {};

            console.warn('[LAN] Nao foi possivel registrar entrada do jogador:', {
              error,
              activeSessionId,
              entrySessionId,
              remoteKey: entry?.remoteKey,
              clientId: entry?.clientId,
              characterName: String(entryCharacter.name || ''),
            });
          }
        } else if (entrySessionId) {
          console.warn('[LAN] Join ignorado por sessionId diferente:', {
            activeSessionId,
            entrySessionId,
            remoteKey: entry?.remoteKey,
            clientId: entry?.clientId,
          });
        }
      }

      if (changedPlayers) {
        const syncedPayload = await syncLanSessionPayload(db, activeSessionId, { broadcast: false });

        if (syncedPayload) {
          applyExternalPayload(syncedPayload, 'sqlite');
          debugLanFlow('MASTER_PLAYER_STATE_RELOADED', {
            source: 'join_changed',
            sessionId: activeSessionId,
            playerCount: syncedPayload.state?.players?.length || 0,
          });
        }
      }

      const events = await getNativeSessionEvents(joinUrl);
      if (events.length > 0) {
        const currentState = await getLanSessionState(db, activeSessionId);
        for (const event of events) {
          if (event.sessionId !== activeSessionId) continue;

          if (event.type === 'resource_request' && event.resourceRequest) {
            const fresh = await rememberLanSessionEvent(db, event);
            debugLanFlow('MASTER_RESOURCE_REQUEST_RECEIVED_IMMEDIATE', {
              eventId: event.id,
              fromKey: event.fromKey,
              fromName: event.fromName,
              resourceKind: event.resourceRequest.kind,
              fresh,
            });
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            if (fresh) {
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            }
            continue;
          }

          if (event.type === 'player_joined') {
            const fresh = await rememberLanSessionEvent(db, event);
            // O evento de entrada também precisa criar um jogador pendente,
            // porque em algumas redes o evento chega antes do roster do join.
            await ensurePendingRemotePlayerFromEvent(db, activeSessionId, event);
            if (fresh) await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            continue;
          }

          const player = currentState.players.find((entry) => (
            entry.remoteKey === event.fromKey ||
            entry.remoteKey === event.toKey ||
            entry.characterName === event.fromName ||
            entry.characterName === event.toName
          ));

          if (!player) {
            console.warn('[LAN EVENT SKIPPED]', {
              reason: 'PLAYER_NOT_FOUND',
              type: event.type,
              fromKey: event.fromKey,
              fromName: event.fromName,
            });
            await rememberLanSessionEvent(db, {
              ...event,
              message: `[PENDENTE SEM PLAYER] ${event.message || event.type}`,
            });
            continue;
          }

          if (event.type === 'public_status' && event.publicState) {
            continue;
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
              durationText: event.spellEffect.durationText,
              kind: event.spellEffect.target === 'PV_TEMP' ? 'temp_hp' : undefined,
              mode: event.spellEffect.effectMode,
              status: event.spellEffect.status,
              statusKey: event.spellEffect.status,
              color: event.spellEffect.color,
              secondaryColor: event.spellEffect.secondaryColor,
              source: event.fromName,
            });
          }

          if (event.type === 'send_item' || event.type === 'trade_accept') {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;
            await applyLanInventoryTransferEvent(db, event);
          }

          if (event.type === 'trade_offer' || event.type === 'trade_decline') {
            const fresh = await rememberLanSessionEvent(db, event);
            if (fresh) await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
          }

          if (event.type === 'player_patch' && event.numberPatch) {
            const applied = await applyLanPlayerNumberPatch(db, activeSessionId, event.fromKey, event.numberPatch);
            if (applied) {
              await rememberLanSessionEvent(db, event);
              const nextState = await getLanSessionState(db, activeSessionId);
              const targetPlayer = nextState.players.find((entry) => (
                entry.remoteKey === event.fromKey ||
                entry.characterName === event.fromName
              ));

              if (targetPlayer?.remoteKey) {
                const officialPatch: NumberPatch = {};
                if (event.numberPatch.hpCurrent != null) officialPatch.hpCurrent = targetPlayer.hpCurrent;
                if (event.numberPatch.hpMax != null) officialPatch.hpMax = targetPlayer.hpMax;
                if (event.numberPatch.tempHp != null) officialPatch.tempHp = targetPlayer.tempHp;
                if (event.numberPatch.xp != null) officialPatch.xp = targetPlayer.xp;
                if (event.numberPatch.gp != null) officialPatch.gp = targetPlayer.gp;
                if (event.numberPatch.sp != null) officialPatch.sp = targetPlayer.sp;
                if (event.numberPatch.cp != null) officialPatch.cp = targetPlayer.cp;

                const committedEvent = await rememberAndSendLanSessionEvent(db, joinUrl, {
                  id: makeLanEventId(),
                  sessionId: activeSessionId,
                  type: 'player_patch',
                  fromKey: 'master',
                  fromName: 'Mestre',
                  toKey: targetPlayer.remoteKey,
                  toName: targetPlayer.characterName,
                  entityType: 'player',
                  entityId: targetPlayer.remoteKey,
                  entityRevision: Math.max(0, Number(targetPlayer.revisionSeq || 0)),
                  ackRequired: true,
                  originClientId: 'master',
                  numberPatch: officialPatch,
                  message: event.message || `${targetPlayer.characterName} teve recursos atualizados pelo mestre.`,
                  createdAt: new Date().toISOString(),
                });

                if (committedEvent) {
                  setSessionEvents((current) =>
                    [committedEvent, ...current.filter((item) => item.id !== committedEvent.id)].slice(0, 20)
                  );
                }
              }

              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            }
          }


          if (event.type === 'inventory_patch' && event.inventoryPatch) {
            const applied = await applyLanPlayerInventoryPatch(
              db,
              activeSessionId,
              event.fromKey,
              event.inventoryPatch.equipment
            );
            if (applied) {
              await rememberLanSessionEvent(db, event);
              await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
            }
          }


          if (event.type === 'effect_patch' && event.effectPatch) {
            const fresh = await rememberLanSessionEvent(db, event);
            if (!fresh) continue;

            const targetPlayer = currentState.players.find((entry) => (
              entry.remoteKey === event.effectPatch?.targetKey ||
              entry.remoteKey === event.fromKey ||
              entry.characterName === event.fromName
            ));

            if (!targetPlayer) continue;

            for (const effectId of event.effectPatch.remove || []) {
              await removeLanPlayerEffect(db, targetPlayer.id, String(effectId));
            }

            for (const effect of [...(event.effectPatch.add || []), ...(event.effectPatch.update || [])]) {
              await addLanPlayerEffect(db, targetPlayer.id, {
                name: String((effect as any).name || event.message || 'Efeito de item'),
                target: ((effect as any).target || 'custom') as LanEffectTarget,
                value: Number((effect as any).value || 0),
                remaining: Number((effect as any).remaining || 1),
                unit: ((effect as any).unit || 'rest') as LanEffectUnit,
                durationText: (effect as any).durationText,
                kind: (effect as any).kind,
                mode: (effect as any).mode,
                status: (effect as any).status,
                statusKey: (effect as any).statusKey || (effect as any).status,
                color: (effect as any).color,
                secondaryColor: (effect as any).secondaryColor,
                source: (effect as any).source || event.fromName,
              });
            }

            await syncLanSessionPayload(db, activeSessionId, { broadcast: false });
          }
        }
      }

      await reloadSessionState(activeSessionId, false);
      debugLanFlow('MASTER_PLAYER_STATE_RELOADED', {
        source: 'poll_or_realtime',
        sessionId: activeSessionId,
      });
    };

    pollJoinedPlayers();
    const timer = setInterval(pollJoinedPlayers, 2500);
    const unsubscribeRealtime = subscribeLanSessionHostUpdates(joinUrl, () => {
      traceApp('SUBSCRIPTION_UPDATE', 'MASTER_HOST_SUBSCRIPTION_UPDATE', {
        screen: 'lan-session',
        source: 'subscribeLanSessionHostUpdates',
        sessionId: activeSessionId,
        joinUrl,
      });
      void pollJoinedPlayers();
    });
    return () => {
      clearInterval(timer);
      unsubscribeRealtime();
    };
  }, [activeSessionId, applyExternalPayload, db, joinUrl, reloadSessionState]);

  const handleStartSession = async () => {
    const parsedLevel = Math.max(1, Math.min(20, parseInt(level, 10) || 1));
    const startedAt = Date.now();
    traceButton('lan-session', 'START_LAN_SESSION', {
      source: 'master_click',
      args: { sessionName, masterName, level: parsedLevel, allowExisting },
    });
    setLoading(true);

    try {
      // Troca explicitamente para o papel de mestre sem apagar sessões salvas.
      await switchLanRole('master');
      await stopLanServer();

      const nextPayload = await buildLanSessionPayload(db, {
        id: makeSessionId(),
        name: sessionName.trim() || 'Mesa de D&D',
        masterName: masterName.trim() || 'Mestre',
        level: parsedLevel,
        allowExisting,
        inviteCode: makeInviteCode(),
      }, selectionFromKeys(selectedCatalogKeys));

      const nextJoinUrl = await startLanServer(nextPayload);

      if (!nextJoinUrl) {
        throw new Error('Servidor TCP não retornou URL. A sessão não será salva.');
      }

      await saveLanSession(db, nextPayload, nextJoinUrl, { isMaster: true });
      replaceLanRuntimeStateFromBootstrap(nextPayload.session.id, nextPayload.state || null);
      setPayload(nextPayload);
      setSessionState(nextPayload.state || null);
      setSessionEvents([]);
      setPendingSaves([]);
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedPlayerId(null);

      await loadSavedSessions();
      traceFunctionReturn('handleStartSession', {
        sessionId: nextPayload.session.id,
        joinUrl: nextJoinUrl,
      }, {
        screen: 'lan-session',
        source: 'master_click',
        sessionId: nextPayload.session.id,
        durationMs: Date.now() - startedAt,
      });

      if (isEmulatorOnlyTcpUrl(nextJoinUrl)) {
        Alert.alert(
          'IP do emulador detectado',
          'A mesa abriu em IP interno do emulador. Para socket puro, use o celular fisico como mestre ou redirecione a porta TCP do emulador e entre manualmente por tcp://10.0.2.2:43115/... em outro emulador.'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      Alert.alert(
        'Erro ao iniciar sessão LAN',
        message || 'Erro desconhecido ao iniciar a sessão.'
      );

      console.error('[LAN] Erro ao iniciar sessão:', error);
      traceError('LAN_JOIN', 'START_LAN_SESSION_ERROR', error, {
        screen: 'lan-session',
        source: 'master_click',
        durationMs: Date.now() - startedAt,
      });
      } finally {
      setLoading(false);
    }
  };

  const handleResumeSavedSession = async (session: LanSessionSummary) => {
    const startedAt = Date.now();
    traceButton('lan-session', 'RESUME_SAVED_SESSION', {
      source: 'master_click',
      sessionId: session.id,
      args: { isMaster: session.isMaster, status: session.status, joinUrl: session.joinUrl },
    });
    if (!session.isMaster) {
      const bound = await getBoundLanCharacter(db, session.id);
      if (bound?.characterId) {
        router.replace(`/sheet?id=${bound.characterId}&sessionId=${session.id}&joinUrl=${encodeURIComponent(session.joinUrl || bound.joinUrl || '')}` as any);
      } else {
        router.replace(`/sessionJoin?code=${session.inviteCode}&url=${encodeURIComponent(session.joinUrl || '')}` as any);
      }
      return;
    }

    setLoading(true);
    try {
      await switchLanRole('master');
      await resumeLanSession(db, session.id);
      const nextPayload = await refreshLanSessionPayload(db, session.id);
      if (!nextPayload) throw new Error('Sessão não encontrada.');

      const nextJoinUrl = await startLanServer(nextPayload);

      if (!nextJoinUrl) {
        throw new Error('Servidor TCP não retornou URL ao retomar a sessão. A sessão não será salva como ativa.');
      }

      await saveLanSession(db, nextPayload, nextJoinUrl, { isMaster: true });
      applyExternalPayload(
        nextPayload.state ? nextPayload : { ...nextPayload, state: await getLanSessionState(db, session.id) },
        'sqlite'
      );
      setSessionEvents(await getLanSessionEvents(db, session.id, 20));
      setPendingSaves(await listPendingSaves(db, session.id));
      setJoinUrl(nextJoinUrl);
      setJoinLink(buildJoinDeepLink(nextJoinUrl, nextPayload));
      setSelectedCatalogKeys(keysFromSelection(nextPayload.selectedCatalog));
      await loadSavedSessions();
      traceFunctionReturn('handleResumeSavedSession', {
        sessionId: session.id,
        joinUrl: nextJoinUrl,
      }, {
        screen: 'lan-session',
        source: 'master_click',
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
      });
      if (isEmulatorOnlyTcpUrl(nextJoinUrl)) {
        Alert.alert(
          'IP do emulador detectado',
          'A mesa retomou em IP interno do emulador. Para socket puro, use o celular fisico como mestre ou redirecione a porta TCP do emulador e entre manualmente por tcp://10.0.2.2:43115/... em outro emulador.'
        );
      }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        Alert.alert(
          'Erro ao retomar sessão LAN',
          message || 'Erro desconhecido ao retomar a sessão.'
        );

        console.error('[LAN] Erro ao retomar sessão:', error);
      } finally {
      setLoading(false);
    }
  };

  const handleStopSession = useCallback(async () => {
    if (payload) {
      await endLanSession(db, payload.session.id);
      await rememberLanSessionEvent(db, {
        id: makeLanEventId(),
        sessionId: payload.session.id,
        type: 'timeline_event',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: 'party',
        toName: 'Party',
        message: 'Mestre finalizou a sessao LAN.',
        createdAt: new Date().toISOString(),
      });
      await syncLanSessionPayload(db, payload.session.id, { broadcast: false });
    }
    await stopLanServer();
    resetLanClientConnection();
    setPayload(null);
    setSessionState(null);
    setSessionEvents([]);
    setJoinUrl('');
    setJoinLink('');
    setSelectedPlayerId(null);
    await loadSavedSessions();
  }, [db, loadSavedSessions, payload]);

  useEffect(() => {
    if (!payload?.session?.id) return;

    let handlingStopRequest = false;
    const stopFromNotification = async () => {
      if (handlingStopRequest) return;
      handlingStopRequest = true;
      try {
        await handleStopSession();
      } finally {
        handlingStopRequest = false;
      }
    };

    const unsubscribe = subscribeLanForegroundStop(() => {
      void stopFromNotification();
    });

    const timer = setInterval(() => {
      void (async () => {
        if (await consumeLanForegroundStopRequest()) {
          await stopFromNotification();
        }
      })();
    }, 1500);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [handleStopSession, payload?.session?.id]);

  const handleCopyInviteCode = async () => {
    if (!payload) return;
    await Clipboard.setStringAsync(payload.session.inviteCode);
    Alert.alert(
      'Codigo copiado',
      joinUrl
        ? `Codigo ${payload.session.inviteCode} copiado. O jogador pode digitar esse codigo em Entrada manual na mesma rede.`
        : `Codigo ${payload.session.inviteCode} copiado, mas a mesa ainda nao tem socket TCP ativo para entrada por codigo.`
    );
  };

  const handleCopyJoinInvite = async () => {
    if (!payload || !joinLink) return;
    await Clipboard.setStringAsync(joinLink);
    Alert.alert('Convite copiado', 'O jogador pode colar esse convite em Entrada manual para entrar como jogador.');
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
              resetLanClientConnection();
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
    const wasPaused = sessionState.status === 'paused';
    const nextPayload = wasPaused
      ? await resumeLanSession(db, payload.session.id)
      : await pauseLanSession(db, payload.session.id);
    await recordMasterTimelineEvent(wasPaused ? 'Mestre continuou a sessao.' : 'Mestre pausou a sessao.');

    if (nextPayload) {
      const syncedPayload = await syncLanSessionPayload(db, payload.session.id, { broadcast: false });
      applyExternalPayload(syncedPayload || nextPayload, 'sqlite');
    }
    await loadSavedSessions();
  };

  const handleAdvanceTime = async (unit: LanAdvanceUnit) => {
    if (!payload) return;
    const startedAt = Date.now();
    traceButton('lan-session', `ADVANCE_TIME_${unit}`, {
      source: 'master_click',
      sessionId: payload.session.id,
      args: { unit },
      before: {
        currentTurn: sessionStateRef.current?.currentTurn,
        elapsedMinutes: sessionStateRef.current?.elapsedMinutes,
      },
    });
    const runtimeResult = applyHostTurnRuntime(payload.session.id, sessionStateRef.current, unit);
    if (runtimeResult) {
      sessionStateRef.current = runtimeResult.state;
      setSessionState(runtimeResult.state);
      setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
      debugLanFlow('MASTER_TURN_RUNTIME_APPLIED', {
        sessionId: payload.session.id,
        unit,
        currentTurn: runtimeResult.state.currentTurn,
        elapsedMinutes: runtimeResult.state.elapsedMinutes,
        revision: runtimeResult.revision,
      });
      debugLanFlow('MASTER_EFFECT_TICK_RUNTIME_APPLIED', {
        sessionId: payload.session.id,
        unit,
      });
    }
    await advanceLanSessionTime(db, payload.session.id, unit);
    await recordMasterTimelineEvent(`Mestre avancou ${formatAdvanceUnit(unit)}.`);
    await sendRecentLiveEvents(payload.session.id, (event) => (
      ['effect_patch', 'effect_expired', 'pending_save_patch', 'session_patch'].includes(event.type)
    ));
    const nextPayload = await syncLanSessionPayload(db, payload.session.id, { broadcast: false });
    if (nextPayload) {
      applyExternalPayload(nextPayload, 'sqlite');
      setSessionEvents(await getLanSessionEvents(db, payload.session.id, 20));
    }
    traceFunctionReturn('handleAdvanceTime', {
      sessionId: payload.session.id,
      unit,
      currentTurn: nextPayload?.state?.currentTurn,
      elapsedMinutes: nextPayload?.state?.elapsedMinutes,
    }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      durationMs: Date.now() - startedAt,
    });
  };

  const handleApplyCatalogSelection = async () => {
    if (!payload) {
      setCatalogModalVisible(false);
      return;
    }

    const nextPayload = await rebuildLanSessionCatalog(db, payload.session.id, selectionFromKeys(selectedCatalogKeys), joinUrl);
    if (nextPayload) {
      applyExternalPayload(nextPayload, 'sqlite');
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

  const recordMasterTimelineEvent = async (message: string, player?: LanSessionPlayerState) => {
    if (!payload) return;
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'timeline_event',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: player?.remoteKey || 'party',
      toName: player?.characterName || 'Party',
      message,
      createdAt: new Date().toISOString(),
    });
  };

  const persistHostNumberPatch = useCallback((playerId: number, patch: NumberPatch, message: string) => {
    if (!payload?.session?.id) return;
    const sessionId = payload.session.id;
    const targetPlayer = sessionStateRef.current?.players.find((entry) => entry.id === playerId);
    if (!targetPlayer) return;
    traceFunctionCall('persistHostNumberPatch', { playerId, patch, message }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId,
      playerId,
      playerKey: targetPlayer.remoteKey,
      playerName: targetPlayer.characterName,
      before: {
        hpCurrent: targetPlayer.hpCurrent,
        hpMax: targetPlayer.hpMax,
        tempHp: targetPlayer.tempHp,
        xp: targetPlayer.xp,
        gp: targetPlayer.gp,
        sp: targetPlayer.sp,
        cp: targetPlayer.cp,
        revisionSeq: targetPlayer.revisionSeq,
      },
      patch,
    });
    const seq = Date.now();
    const liveEvent: LanSessionEvent = {
      id: makeLanEventId(),
      sessionId,
      seq,
      serverSeq: seq,
      type: 'player_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: targetPlayer.remoteKey || '',
      toName: targetPlayer.characterName,
      entityType: 'player',
      entityId: targetPlayer.remoteKey || String(targetPlayer.id),
      entityRevision: Math.max(1, Number(targetPlayer.revisionSeq || 0)),
      ackRequired: true,
      originClientId: 'master',
      numberPatch: patch,
      message,
      createdAt: new Date().toISOString(),
    };

    debugLanFlow('MASTER_EVENT_CREATED', {
      eventId: liveEvent.id,
      seq: liveEvent.seq,
      entityRevision: liveEvent.entityRevision,
      type: liveEvent.type,
      numberPatch: liveEvent.numberPatch,
    });
    traceApp('EVENT_CREATED', 'MASTER_PLAYER_PATCH_EVENT_CREATED', {
      screen: 'lan-session',
      source: 'persistHostNumberPatch',
      sessionId,
      playerId,
      playerKey: targetPlayer.remoteKey,
      playerName: targetPlayer.characterName,
      eventId: liveEvent.id,
      eventType: liveEvent.type,
      seq: liveEvent.seq,
      serverSeq: liveEvent.serverSeq,
      entityType: liveEvent.entityType,
      entityId: liveEvent.entityId,
      entityRevision: liveEvent.entityRevision,
      fromKey: liveEvent.fromKey,
      toKey: liveEvent.toKey,
      patch: liveEvent.numberPatch,
    });

    void sendLanSessionEvent(joinUrl, liveEvent)
      .then(() => {
        debugLanFlow('MASTER_EVENT_SENT', {
          eventId: liveEvent.id,
          toKey: liveEvent.toKey,
          numberPatch: liveEvent.numberPatch,
        });
        traceFunctionReturn('persistHostNumberPatch', {
          sent: true,
          eventId: liveEvent.id,
        }, {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          eventType: liveEvent.type,
        });
        setSessionEvents((current) =>
          [liveEvent, ...current.filter((item) => item.id !== liveEvent.id)].slice(0, 20)
        );
      })
      .catch((error) => {
        console.warn('[LAN MASTER] Falha ao enviar evento vivo imediato:', error);
      });

    void (async () => {
      try {
        debugLanFlow('MASTER_SQLITE_PERSIST_START', { sessionId, playerId, patch });
        traceSqlite('SQLITE_WRITE_START', {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          table: 'lan_session_events/lan_session_players',
          operation: 'PERSIST_PLAYER_PATCH',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          patch,
        });
        await rememberLanSessionEvent(db, liveEvent);
        await updateLanPlayerNumbers(db, playerId, patch, { syncPayload: false });
        debugLanFlow('MASTER_SQLITE_PERSIST_DONE', { sessionId, playerId, patch });
        traceSqlite('SQLITE_WRITE_DONE', {
          screen: 'lan-session',
          source: 'persistHostNumberPatch',
          functionName: 'persistHostNumberPatch',
          table: 'lan_session_events/lan_session_players',
          operation: 'PERSIST_PLAYER_PATCH',
          sessionId,
          playerId,
          playerKey: targetPlayer.remoteKey,
          playerName: targetPlayer.characterName,
          eventId: liveEvent.id,
          patch,
        });

        scheduleSilentPayloadRefresh(sessionId);
      } catch (error) {
        console.warn('[LAN MASTER] Falha ao persistir patch vivo no SQLite:', error);
      }
    })();
  }, [db, joinUrl, payload?.session?.id, scheduleSilentPayloadRefresh]);

  const applyMasterPlayerPatchInternal = async (
    player: LanSessionPlayerState,
    patch: NumberPatch,
    message: string
  ) => {
    if (!payload) return;
    traceFunctionCall('applyMasterPlayerPatchInternal', { playerId: player.id, patch, message }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      before: {
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        xp: player.xp,
        gp: player.gp,
        sp: player.sp,
        cp: player.cp,
        revisionSeq: player.revisionSeq,
      },
      patch,
    });

    const runtimeResult = applyHostNumberPatchRuntime(payload.session.id, sessionStateRef.current, player.id, patch);
    if (!runtimeResult) return;

    sessionStateRef.current = runtimeResult.state;
    setSessionState(runtimeResult.state);
    setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    traceStateChange('STATE_CHANGE', 'MASTER_RUNTIME_PLAYER_PATCH_APPLIED', player, runtimeResult.player, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      patch: runtimeResult.patch,
      entityRevision: runtimeResult.revision,
    });

    debugLanFlow('MASTER_CLICK_HP_LOCAL_RUNTIME_APPLIED', {
      playerId: player.id,
      remoteKey: player.remoteKey,
      characterName: player.characterName,
      patch: runtimeResult.patch,
      beforeHp: player.hpCurrent,
      afterHp: runtimeResult.player.hpCurrent,
      revision: runtimeResult.revision,
    });

    void persistHostNumberPatch(player.id, runtimeResult.patch, message);
    traceFunctionReturn('applyMasterPlayerPatchInternal', {
      playerId: player.id,
      patch: runtimeResult.patch,
      revision: runtimeResult.revision,
    }, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });
    return;

    /*
    debugLanFlow('MASTER_MUTATION_PLAYER_PATCH_START', {
      playerId: player.id,
      remoteKey: player.remoteKey,
      characterName: player.characterName,
      patch,
      beforeHp: player.hpCurrent,
    });

    const result = await commitHostPlayerNumberPatch(db, {
      sessionId: payload.session.id,
      joinUrl,
      playerId: player.id,
      patch,
      message,
    });

    if (!result) return;

    const { event, patch: cleanPatch, player: updatedPlayer } = result;

    // 1. Atualiza a tela do mestre imediatamente, mas sempre mantendo o patch mais recente.
    setSessionState((current) => {
      if (!current) return current;

      return {
        ...current,
        players: current.players.map((entry) =>
          entry.id === player.id
            ? { ...entry, ...updatedPlayer, ...cleanPatch }
            : entry
        ),
      };
    });

    // 2. Atualiza o payload local em memória também, para evitar voltar para valor antigo.
    setPayload((current) => {
      if (!current?.state) return current;

      return {
        ...current,
        state: {
          ...current.state,
          players: current.state.players.map((entry) =>
            entry.id === player.id
              ? { ...entry, ...updatedPlayer, ...cleanPatch }
              : entry
          ),
        },
      };
    });


    // Não faça broadcast de payload/snapshot aqui. O estado vivo da ficha deve ir por evento.
    if (event) {
      debugLanFlow('MASTER_MUTATION_PLAYER_PATCH_SENT', {
        eventId: event.id,
        seq: event.seq,
        entityType: event.entityType,
        entityId: event.entityId,
        entityRevision: event.entityRevision,
        toKey: event.toKey,
        numberPatch: event.numberPatch,
      });
      setSessionEvents((current) =>
        [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20)
      );
    }

    // 5. Recalcula payload apenas para cache estrutural/futuro join, em debounce,
    // sem mandar payload_update para os jogadores atuais.
    scheduleSilentPayloadRefresh(payload.session.id);
    */
  };

  const handleUpdatePlayerPatch = async (
    player: LanSessionPlayerState,
    patch: NumberPatch,
    message: string
  ) => applyMasterPlayerPatchInternal(player, patch, message);

  const handleUpdatePlayerDelta = async (
    player: LanSessionPlayerState,
    field: 'hpCurrent' | 'xp' | 'gp' | 'sp' | 'cp' | 'tempHp',
    delta: number,
    messagePrefix?: string
  ) => {
    if (!payload) return;
    traceButton('lan-session', `MASTER_CLICK_${field}_${delta}`, {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta, messagePrefix },
      before: {
        hpCurrent: player.hpCurrent,
        hpMax: player.hpMax,
        tempHp: player.tempHp,
        xp: player.xp,
        gp: player.gp,
        sp: player.sp,
        cp: player.cp,
        revisionSeq: player.revisionSeq,
      },
    });
    traceFunctionCall('handleUpdatePlayerDelta', { playerId: player.id, field, delta, messagePrefix }, {
      screen: 'lan-session',
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });

    const runtimeResult = applyHostNumberDeltaRuntime(payload.session.id, sessionStateRef.current, player.id, field, delta);
    if (!runtimeResult) return;

    sessionStateRef.current = runtimeResult.state;
    setSessionState(runtimeResult.state);
    setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
    traceStateChange('STATE_CHANGE', 'MASTER_RUNTIME_PLAYER_DELTA_APPLIED', player, runtimeResult.player, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { field, delta },
      patch: runtimeResult.patch,
      entityRevision: runtimeResult.revision,
    });
    debugLanFlow('MASTER_CLICK_HP_LOCAL_RUNTIME_APPLIED', {
      playerId: player.id,
      remoteKey: player.remoteKey,
      characterName: player.characterName,
      field,
      delta,
      patch: runtimeResult.patch,
      afterHp: runtimeResult.player.hpCurrent,
      revision: runtimeResult.revision,
    });

    void persistHostNumberPatch(
      player.id,
      runtimeResult.patch,
      messagePrefix || `Mestre ajustou ${formatPlayerField(field as any)} de ${runtimeResult.player.characterName}.`
    );
    traceFunctionReturn('handleUpdatePlayerDelta', {
      playerId: player.id,
      field,
      delta,
      patch: runtimeResult.patch,
      revision: runtimeResult.revision,
    }, {
      screen: 'lan-session',
      source: 'runtime/master',
      sessionId: payload.session.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
    });
    return;

    /*
    const result = await commitHostPlayerNumberDelta(db, {
      sessionId: payload.session.id,
      joinUrl,
      playerId: player.id,
      field,
      delta,
      message: messagePrefix,
    });

    if (!result) return;
    const { event, patch: cleanPatch, player: updatedPlayer } = result;

    setSessionState((current) => current
      ? {
        ...current,
        players: current.players.map((entry) => entry.id === player.id ? { ...entry, ...updatedPlayer, ...cleanPatch } : entry),
      }
      : current
    );

    setPayload((current) => current?.state
      ? {
        ...current,
        state: {
          ...current.state,
          players: current.state.players.map((entry) => entry.id === player.id ? { ...entry, ...updatedPlayer, ...cleanPatch } : entry),
        },
      }
      : current
    );

    if (event) {
      setSessionEvents((current) =>
        [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20)
      );
    }

    scheduleSilentPayloadRefresh(payload.session.id);
    */
  };

  const handleUpdatePlayer = async (
    player: LanSessionPlayerState,
    field: 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp',
    value: number
  ) => {
    const cleanValue = Math.max(0, Math.floor(Number(value) || 0));
    await handleUpdatePlayerPatch(
      player,
      { [field]: cleanValue },
      `Mestre ajustou ${formatPlayerField(field)} de ${player.characterName} para ${cleanValue}.`
    );
  };

  const handleKickPlayer = (player: LanSessionPlayerState) => {
    traceButton('lan-session', 'MASTER_OPEN_KICK_PLAYER_CONFIRM', {
      source: 'master_click',
      sessionId: payload?.session?.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      before: player,
    });
    Alert.alert(
      'Remover jogador',
      `Remover ${player.characterName} desta sessão? Ele poderá escolher ou criar outro personagem ao entrar de novo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            traceButton('lan-session', 'MASTER_CONFIRM_KICK_PLAYER', {
              source: 'master_click',
              sessionId: payload?.session?.id,
              playerId: player.id,
              playerKey: player.remoteKey,
              playerName: player.characterName,
              before: player,
            });
            const runtimeResult = payload?.session?.id
              ? removeHostPlayerRuntime(payload.session.id, sessionStateRef.current, player)
              : null;
            if (runtimeResult) {
              sessionStateRef.current = runtimeResult.state;
              setSessionState(runtimeResult.state);
              setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
              debugLanFlow('MASTER_KICK_RUNTIME_APPLIED', {
                playerId: player.id,
                remoteKey: player.remoteKey,
                clientId: player.clientId,
                characterName: player.characterName,
                sessionId: payload?.session?.id,
                revision: runtimeResult.revision,
              });
            }
            debugLanFlow('MASTER_KICK_REMOVED_FROM_ROSTER', {
              playerId: player.id,
              remoteKey: player.remoteKey,
              clientId: player.clientId,
              characterName: player.characterName,
              sessionId: payload?.session?.id,
            });
            if (selectedPlayerId === player.id) setSelectedPlayerId(null);
            setExpandedPlayerIds((current) => current.filter((id) => id !== player.id));
            await kickLanSessionPlayer(db, player.id);
            if (payload?.session?.id) {
              const kickedEvent = await sendLatestLiveEvent(payload.session.id, (event) => (
                event.type === 'player_kicked' &&
                (
                  Boolean(player.remoteKey && event.toKey === player.remoteKey) ||
                  event.toName === player.characterName
                )
              ));
              debugLanFlow('MASTER_KICK_SENT_LIVE', {
                eventId: kickedEvent?.id,
                sessionId: payload.session.id,
                remoteKey: player.remoteKey,
                clientId: player.clientId,
                characterName: player.characterName,
              });
              await reloadSessionState(payload.session.id, false);
            }
          },
        },
      ]
    );
  };

  const handleReviewPending = async (player: LanSessionPlayerState, accepted: boolean) => {
    await reviewLanPlayerPendingSnapshot(db, player.id, accepted);
    if (payload?.session?.id) await reloadSessionState(payload!.session.id, false);
  };

  const handleSelectEffectOption = (option: EffectOption) => {
    setSelectedEffectKeys((current) => (
      current.includes(option.key)
        ? current.filter((key) => key !== option.key)
        : [...current, option.key]
    ));

    const firstEffect = option.effects[0] || {};
    setEffectName(firstEffect.conditionName || option.name);
    setEffectSource(option.group);
    setEffectStatusKey(option.statusKey || String(firstEffect.status || ''));
    setEffectColor(option.color || String(firstEffect.color || ''));
    setEffectSecondaryColor(option.secondaryColor || String(firstEffect.secondaryColor || ''));
    setEffectSaveInfo(formatEffectSaveInfo(firstEffect));
    setEffectTarget(normalizeEffectTarget(firstEffect.target || firstEffect.stat || firstEffect.type));
    setEffectValue(String(firstEffect.value ?? firstEffect.val ?? firstEffect.amount ?? 0));
    setEffectMode(firstEffect.mode === 'set' ? 'set' : 'add');
    setEffectDuration(String(option.durationValue || firstEffect.durationValue || firstEffect.duration || 1));
    setEffectUnit(option.durationUnit || normalizeEffectUnit(firstEffect.durationUnit || firstEffect.unit) || inferUnitFromText(option.durationText));
  };

  const clearSelectedEffects = () => {
    setSelectedEffectKeys([]);
    setEffectSaveInfo('');
    setEffectSource('');
    setEffectName('Efeito temporario');
  };

  const handleDistributeXp = async () => {
    if (!payload || !sessionState?.players.length) return;
    const totalXp = Math.max(0, parseInt(xpPool, 10) || 0);
    traceButton('lan-session', 'MASTER_DISTRIBUTE_XP', {
      source: 'master_click',
      sessionId: payload.session.id,
      args: { totalXp, playerCount: sessionState.players.length },
      before: sessionState.players.map((player) => ({ id: player.id, name: player.characterName, xp: player.xp })),
    });
    const baseShare = Math.floor(totalXp / sessionState.players.length);
    const remainder = totalXp % sessionState.players.length;
    for (let index = 0; index < sessionState.players.length; index += 1) {
      const player = sessionState.players[index];
      await handleUpdatePlayer(player, 'xp', player.xp + baseShare + (index < remainder ? 1 : 0));
    }
    await recordMasterTimelineEvent(`Mestre distribuiu ${totalXp} XP para a party.`);
    await reloadSessionState(payload.session.id, false);
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
        mode: event.spellEffect.effectMode,
        status: event.spellEffect.status,
        statusKey: event.spellEffect.status,
        color: event.spellEffect.color,
        secondaryColor: event.spellEffect.secondaryColor,
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

    if (accepted && targetPlayer?.remoteKey) {
      await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
        latestEvent.type === 'effect_patch' && latestEvent.toKey === targetPlayer.remoteKey
      ));
    }
    await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
      latestEvent.type === 'character_update_review' && latestEvent.toKey === event.fromKey
    ));

    setReviewedSpellEventIds((current) => Array.from(new Set([...current, event.id])));
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const handleReviewResourceRequest = async (event: LanSessionEvent, accepted: boolean) => enqueueMasterMutation(async () => {
    if (!payload?.session?.id) return;
    traceButton('lan-session', accepted ? 'MASTER_ACCEPT_RESOURCE_REQUEST' : 'MASTER_REJECT_RESOURCE_REQUEST', {
      source: 'master_click',
      sessionId: payload.session.id,
      eventId: event.id,
      eventType: event.type,
      fromKey: event.fromKey,
      playerName: event.fromName,
      payload: event.resourceRequest,
    });
    await applyLanResourceRequest(db, event, accepted);

    if (accepted) {
      const nextState = await getLanSessionState(db, payload.session.id);
      const targetPlayer = nextState.players.find((player) => player.remoteKey === event.fromKey || player.characterName === event.fromName);
      const request = event.resourceRequest;

      if (targetPlayer && request) {
        const entityRevision = await getPlayerRevision(targetPlayer.id);

        if (['xp', 'hp', 'temp_hp', 'coin'].includes(request.kind)) {
          await rememberAndSendLanSessionEvent(db, joinUrl, {
            id: makeLanEventId(),
            sessionId: payload.session.id,
            type: 'player_patch',
            fromKey: 'master',
            fromName: 'Mestre',
            toKey: targetPlayer.remoteKey || '',
            toName: targetPlayer.characterName,
            entityType: 'player',
            entityId: targetPlayer.remoteKey || String(targetPlayer.id),
            entityRevision,
            ackRequired: true,
            originClientId: 'master',
            numberPatch: {
              hpCurrent: targetPlayer.hpCurrent,
              hpMax: targetPlayer.hpMax,
              tempHp: targetPlayer.tempHp,
              xp: targetPlayer.xp,
              gp: targetPlayer.gp,
              sp: targetPlayer.sp,
              cp: targetPlayer.cp,
            },
            message: `Mestre aceitou: ${event.message || request.message || request.kind}.`,
            createdAt: new Date().toISOString(),
          });
        }

        if (['stat', 'buff', 'condition'].includes(request.kind)) {
          await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
            latestEvent.type === 'effect_patch' && latestEvent.toKey === targetPlayer.remoteKey
          ));
        }

        if (request.kind === 'inventory') {
          await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
            latestEvent.type === 'inventory_patch' && latestEvent.toKey === targetPlayer.remoteKey
          ));
        }
      }
    }

    await sendLatestLiveEvent(payload.session.id, (latestEvent) => (
      latestEvent.type === 'resource_review' && latestEvent.tradeId === event.id
    ));

    setReviewedRequestEventIds((current) => Array.from(new Set([...current, event.id])));
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  });

  const handleResolvePendingSave = async (save: LanPendingSave, passed: boolean) => {
    if (!payload) return;
    await resolveSave(db, save.id, passed);
    if (passed) {
      const targetPlayer = sessionState?.players.find((entry) => entry.remoteKey === save.targetKey);
      const activeEffectId = String((save.effectPayload as any)?.id || '');
      if (targetPlayer && activeEffectId) {
        await removeLanPlayerEffect(db, targetPlayer.id, activeEffectId);
      }
    }
    await rememberLanSessionEvent(db, {
      id: makeLanEventId(),
      sessionId: payload.session.id,
      type: 'pending_save_patch',
      fromKey: 'master',
      fromName: 'Mestre',
      toKey: save.targetKey,
      toName: save.targetKey,
      pendingSavePatch: {
        action: 'resolve',
        id: save.id,
        result: { passed },
      },
      message: `Mestre marcou ${save.sourceName || 'teste'} como ${passed ? 'sucesso' : 'falha'}.`,
      createdAt: new Date().toISOString(),
    });
    await sendRecentLiveEvents(payload.session.id, (event) => ['effect_patch', 'pending_save_patch'].includes(event.type));
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const handleGrantItemToPlayer = async (item: InventoryItemOption) => {
    if (!inventoryModalPlayer || !payload) return;
    const qty = Math.max(1, parseInt(grantItemQty, 10) || 1);
    traceButton('lan-session', 'MASTER_GRANT_ITEM', {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId: inventoryModalPlayer.id,
      playerKey: inventoryModalPlayer.remoteKey,
      playerName: inventoryModalPlayer.characterName,
      args: { itemName: item.name, qty },
      before: inventoryModalPlayer.equipment,
    });
    const equipment = inventoryModalPlayer.equipment as any;
    const bag = Array.isArray(equipment?.bag) ? [...equipment.bag] : [];
    const existingIndex = bag.findIndex((entry: any) => String(entry.name || '') === item.name);
    const nextItem = {
      name: item.name,
      qty,
      weight: item.weight || 0,
      damage: item.damage || '',
      damage_type: item.damage_type || '',
      properties: item.properties || '',
      descricao: item.descricao || '',
      effect_json: item.effect_json || '[]',
      duration_value: item.duration_value ?? null,
      duration_unit: item.duration_unit || null,
    };

    if (existingIndex >= 0) {
      bag[existingIndex] = { ...bag[existingIndex], qty: (Number(bag[existingIndex].qty) || 0) + qty };
    } else {
      bag.push(nextItem);
    }

    await updateLanPlayerEquipment(
      db,
      inventoryModalPlayer.id,
      { ...equipment, bag },
      `Mestre entregou ${qty}x ${item.name} para ${inventoryModalPlayer.characterName}.`
    );

    await sendLatestLiveEvent(payload.session.id, (event) => (
      event.type === 'inventory_patch' &&
      event.toKey === inventoryModalPlayer.remoteKey
    ));

    await reloadSessionState(payload.session.id, false);
    const nextState = await getLanSessionState(db, payload.session.id);
    const nextPlayer = nextState.players.find((player) => player.id === inventoryModalPlayer.id);
    if (nextPlayer) setInventoryModalPlayer(nextPlayer);
    scheduleSilentPayloadRefresh(payload.session.id);
  };

  const toggleExpandedPlayer = (playerId: number) => {
    setExpandedPlayerIds((current) => (
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    ));
  };

  // NOVO: Função para Aplicar Efeitos considerando o novo seletor (Toda a party ou Específico)
  const handleApplyEffect = async () => enqueueMasterMutation(async () => {
    if (!sessionState || !payload?.session?.id) return;
    traceButton('lan-session', 'MASTER_APPLY_EFFECT', {
      source: 'master_click',
      sessionId: payload.session.id,
      args: {
        effectTargetPlayerId,
        selectedEffectKeys,
        effectName,
        effectTarget,
        effectValue,
        effectDuration,
        effectUnit,
      },
    });

    const targets = effectTargetPlayerId === 'ALL'
      ? sessionState.players
      : sessionState.players.filter((player) => player.id === effectTargetPlayerId);

    if (targets.length === 0) return;

    const manualDuration = Math.max(1, parseInt(effectDuration, 10) || 1);
    const drafts: EffectDraft[] = selectedEffectOptions.length > 0
      ? selectedEffectOptions.map(makeEffectDraftFromOption)
      : [{
        name: effectName.trim() || 'Efeito temporario',
        target: effectTarget,
        value: parseInt(effectValue, 10) || 0,
        remaining: manualDuration,
        unit: effectUnit,
        durationText: `${manualDuration} ${effectUnit}`,
        kind: effectTarget === 'PV_TEMP' ? 'temp_hp' : effectTarget === 'HP' ? 'hp' : effectTarget === 'custom' ? 'custom' : 'stat',
        mode: effectMode,
        source: [effectSource.trim(), effectSaveInfo].filter(Boolean).join(' - ') || undefined,
        statusKey: effectTarget === 'custom' ? effectStatusKey || undefined : undefined,
        color: effectColor || undefined,
        secondaryColor: effectSecondaryColor || undefined,
      }];

    for (const targetPlayer of targets) {
      const effectsToApply = drafts.map((draft) => {
        const usesStatusCatalog = draft.kind === 'status' || draft.target === 'custom';
        return {
          name: draft.name,
          target: draft.target,
          value: draft.value,
          remaining: draft.remaining,
          unit: draft.unit,
          durationText: draft.durationText,
          kind: draft.kind,
          mode: draft.mode,
          source: draft.source || 'Mestre',
          status: usesStatusCatalog ? draft.statusKey : undefined,
          statusKey: usesStatusCatalog ? draft.statusKey : undefined,
          color: draft.color,
          secondaryColor: draft.secondaryColor,
        };
      });
      const result = await addLanPlayerEffectsBatch(
        db,
        targetPlayer.id,
        effectsToApply,
        `Mestre aplicou ${effectsToApply.length} efeito(s) em ${targetPlayer.characterName}.`
      );

      if (result?.targetKey) {
        const runtimeResult = applyHostEffectPatchRuntime(payload.session.id, sessionStateRef.current, result.targetKey, result.patch);
        if (runtimeResult) {
          sessionStateRef.current = runtimeResult.state;
          setSessionState(runtimeResult.state);
          setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
        }
        await sendLatestLiveEvent(payload.session.id, (event) => (
          event.type === 'effect_patch' &&
          event.toKey === result.targetKey
        ));
      }
    }

    await recordMasterTimelineEvent(`Mestre aplicou ${drafts.length} efeito(s) em ${targets.length} alvo(s).`);
    setSelectedEffectKeys([]);
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  });

  const handleRemoveEffect = async (playerId: number, effectId: string) => enqueueMasterMutation(async () => {
    if (!payload?.session?.id) return;
    traceButton('lan-session', 'MASTER_REMOVE_EFFECT', {
      source: 'master_click',
      sessionId: payload.session.id,
      playerId,
      entityId: effectId,
    });
    const result = await removeLanPlayerEffect(db, playerId, effectId);
    if (result?.targetKey) {
      const runtimeResult = applyHostEffectPatchRuntime(payload.session.id, sessionStateRef.current, result.targetKey, result.patch);
      if (runtimeResult) {
        sessionStateRef.current = runtimeResult.state;
        setSessionState(runtimeResult.state);
        setPayload((current) => current ? ({ ...current, state: runtimeResult.state }) : current);
      }
      await sendLatestLiveEvent(payload.session.id, (event) => (
        event.type === 'effect_patch' &&
        event.toKey === result.targetKey
      ));
    }
    await recordMasterTimelineEvent('Mestre removeu um efeito ativo.');
    await reloadSessionState(payload.session.id, false);
    scheduleSilentPayloadRefresh(payload.session.id);
  });

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
    traceButton('lan-session', 'MASTER_APPLY_QUICK_EDIT', {
      source: 'master_click',
      sessionId: payload?.session?.id,
      playerId: player.id,
      playerKey: player.remoteKey,
      playerName: player.characterName,
      args: { type, stat, val, qeValue, qeGP, qeSP, qeCP, qeDuration, qeUnit, qeIsTemp },
      before: player,
    });

    if (type === 'XP') {
       await handleUpdatePlayer(player, 'xp', player.xp + val);
    } else if (type === 'COIN') {
       const gp = parseInt(qeGP, 10) || 0;
       const sp = parseInt(qeSP, 10) || 0;
       const cp = parseInt(qeCP, 10) || 0;
       const currentCopper = player.gp * 100 + player.sp * 10 + player.cp;
       const nextCopper = Math.max(0, currentCopper + gp * 100 + sp * 10 + cp);
       const patchedGp = Math.floor(nextCopper / 100);
       const patchedSp = Math.floor((nextCopper % 100) / 10);
       const patchedCp = nextCopper % 10;

       await handleUpdatePlayerPatch(
         player,
         { gp: patchedGp, sp: patchedSp, cp: patchedCp },
         `Mestre ajustou moedas de ${player.characterName} para ${patchedGp} PO, ${patchedSp} PP, ${patchedCp} PC.`
       );
       setQuickEdit(null);
       if (gp + sp + cp < -999999) {
       
       let newCp = player.cp + cp;
       let newSp = player.sp + sp;
       let newGp = player.gp + gp;
       
       // Conversão automática: 10 Cobre = 1 Prata, 10 Prata = 1 Ouro
       if (newCp >= 10) { newSp += Math.floor(newCp / 10); newCp %= 10; }
       if (newSp >= 10) { newGp += Math.floor(newSp / 10); newSp %= 10; }
       
       await handleUpdatePlayer(player, 'gp', newGp);
       await handleUpdatePlayer(player, 'sp', newSp);
       await handleUpdatePlayer(player, 'cp', newCp);
       }
    } else if (type === 'HP' && !qeIsTemp) {
       await handleUpdatePlayer(player, 'hpCurrent', val);
    } else {
       // STAT, PV_TEMP, ou HP (Temporário = Max HP buff)
       const effTarget = type === 'PV_TEMP' ? 'PV_TEMP' : type === 'HP' ? 'HP' : (stat as LanEffectTarget);
       const effName = type === 'PV_TEMP' ? 'PV Temporário' : type === 'HP' ? 'HP Máximo Temporário' : `Ajuste de ${stat}`;
       const effKind = type === 'PV_TEMP' ? 'temp_hp' : type === 'HP' ? 'hp' : 'stat';

       const result = await addLanPlayerEffect(db, player.id, {
           name: effName,
           target: effTarget,
           value: val,
           remaining: qeIsTemp ? Math.max(1, parseInt(qeDuration, 10) || 1) : 9999, // 9999 = Permanente infinito
           unit: qeIsTemp ? qeUnit : 'rest',
           durationText: qeIsTemp ? `${Math.max(1, parseInt(qeDuration, 10) || 1)} ${qeUnit}` : 'Permanente',
           kind: effKind,
           source: qeIsTemp ? 'Mestre' : 'Mestre (Permanente)',
       });
       if (payload?.session?.id && result?.targetKey) {
         await sendLatestLiveEvent(payload.session.id, (event) => (
           event.type === 'effect_patch' && event.toKey === result.targetKey
         ));
       }
       await recordMasterTimelineEvent(`Mestre aplicou ${effName} em ${player.characterName}.`, player);
       if (payload) {
         await reloadSessionState(payload.session.id, false);
         scheduleSilentPayloadRefresh(payload.session.id);
       }
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

  const renderPlayerDetailsModal = () => {
    if (!detailPlayer) return null;

    const snapshot = detailPlayer.characterSnapshot || {};
    const saveIds = parseStringArray(snapshot.save_values).length
      ? parseStringArray(snapshot.save_values)
      : parseStringArray(snapshot.proficiencies).filter((id) => id.startsWith('save_'));
    const skillIds = parseStringArray(snapshot.skill_values).length
      ? parseStringArray(snapshot.skill_values)
      : parseStringArray(snapshot.proficiencies).filter((id) => id.startsWith('skill_'));
    const spellIds = parseStringArray(snapshot.spells);
    const bag = Array.isArray((detailPlayer.equipment as any)?.bag) ? (detailPlayer.equipment as any).bag : [];

    return (
      <Modal visible={!!detailPlayer} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{detailPlayer.characterName}</Text>
                <Text style={styles.mutedText}>{detailPlayer.race} - {detailPlayer.className} - Nivel {detailPlayer.level}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetailPlayer(null)}>
                <Ionicons name="close" size={22} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
              <View style={styles.metricGrid}>
                {STAT_KEYS.map((stat) => (
                  <View key={stat} style={styles.metricBox}>
                    <Text style={styles.metricLabel}>{stat}</Text>
                    <Text style={styles.metricValue}>{String(detailPlayer.stats?.[stat] ?? '-')}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Recursos</Text>
                <Text style={styles.inventoryText}>
                  HP {detailPlayer.hpCurrent}/{detailPlayer.hpMax} - PV temp {detailPlayer.tempHp} - XP {detailPlayer.xp}
                </Text>
                <Text style={styles.inventoryText}>
                  Moedas: {detailPlayer.gp} PO, {detailPlayer.sp} PP, {detailPlayer.cp} PC
                </Text>
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Testes e pericias</Text>
                <Text style={styles.inventoryText}>Testes: {formatReferenceNames(saveIds, saveOptions) || 'Nenhum registrado.'}</Text>
                <Text style={styles.inventoryText}>Pericias: {formatReferenceNames(skillIds, skillOptions) || 'Nenhuma registrada.'}</Text>
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Habilidades e magias</Text>
                <Text style={styles.inventoryText}>{String(snapshot.features_traits || 'Nenhuma habilidade/historia mecanica registrada.')}</Text>
                {spellIds.length > 0 && (
                  <Text style={styles.inventoryText}>Magias: {formatReferenceNames(spellIds, spellOptions)}</Text>
                )}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Historia</Text>
                {['personality_traits', 'ideals', 'bonds', 'flaws', 'backstory', 'allies_organizations', 'languages'].map((field) => (
                  snapshot[field] ? (
                    <Text key={field} style={styles.inventoryText}>
                      {formatCharacterField(field)}: {String(snapshot[field])}
                    </Text>
                  ) : null
                ))}
              </View>

              <View style={styles.inventoryBox}>
                <Text style={styles.strongText}>Inventario</Text>
                {bag.length === 0 ? (
                  <Text style={styles.inventoryText}>Bolsa vazia.</Text>
                ) : bag.map((item: any, index: number) => (
                  <Text key={`${item?.name || 'item'}-${index}`} style={styles.inventoryText}>
                    {item.qty || 1}x {item.name || 'Item'}{describeInventoryItem(item) ? ` - ${describeInventoryItem(item)}` : ''}
                  </Text>
                ))}
              </View>

              {detailPlayer.effects.length > 0 && (
                <View style={styles.effectBox}>
                  <Text style={styles.strongText}>Efeitos ativos</Text>
                  {detailPlayer.effects.map((effect) => (
                    <Text key={effect.id} style={styles.effectText}>{summarizeEffect(effect)}</Text>
                  ))}
                </View>
              )}
            </ScrollView>
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

            <View style={styles.inventoryBox}>
              <Text style={styles.strongText}>Entregar item</Text>
              <TextInput
                style={styles.searchInput}
                value={inventorySearch}
                onChangeText={setInventorySearch}
                placeholder="Buscar por nome, dano, tipo, propriedade ou descricao..."
                placeholderTextColor={appColors.placeholderLight}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.filterRail}>
                  {INVENTORY_FILTERS.map((filter) => (
                    <TouchableOpacity
                      key={filter}
                      style={[styles.filterChip, inventoryFilter === filter && styles.filterChipActive]}
                      onPress={() => setInventoryFilter(filter)}
                    >
                      <Text style={[styles.filterChipText, inventoryFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.toolbar}>
                <TouchableOpacity style={styles.smallButton} onPress={() => setGrantItemQty(String(Math.max(1, (parseInt(grantItemQty, 10) || 1) - 1)))}>
                  <Ionicons name="remove" size={16} color={appColors.textPrimary} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, { width: 86, textAlign: 'center', marginBottom: 0 }]}
                  value={grantItemQty}
                  onChangeText={setGrantItemQty}
                  keyboardType="numeric"
                  placeholder="Qtd"
                  placeholderTextColor={appColors.placeholderLight}
                />
                <TouchableOpacity style={styles.smallButton} onPress={() => setGrantItemQty(String((parseInt(grantItemQty, 10) || 1) + 1))}>
                  <Ionicons name="add" size={16} color={appColors.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
                {filteredInventoryCatalog.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.catalogRow} onPress={() => handleGrantItemToPlayer(item)}>
                    <View style={styles.catalogTextBox}>
                      <Text style={styles.catalogTag}>{getInventoryItemCategory(item)}</Text>
                      <Text style={styles.catalogName}>{item.name}</Text>
                      <Text style={styles.catalogMeta}>{describeInventoryItem(item)}</Text>
                    </View>
                    <Ionicons name="add-circle" size={20} color={appColors.success} />
                  </TouchableOpacity>
                ))}
                {filteredInventoryCatalog.length === 0 && (
                  <Text style={styles.hint}>Nenhum item encontrado neste filtro.</Text>
                )}
              </ScrollView>
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
            <TouchableOpacity style={styles.smallButton} onPress={() => {
              traceButton('lan-session', 'OPEN_CATALOG_MODAL', { source: 'master_click' });
              setCatalogModalVisible(true);
            }}>
              <Ionicons name="albums" size={16} color={appColors.textPrimary} />
              <Text style={styles.smallButtonText}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleStartSession} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'INICIANDO...' : 'INICIAR SESSÃO LAN'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.joinSessionButton} onPress={() => {
          traceButton('lan-session', 'OPEN_SESSION_JOIN', { source: 'player_click' });
          router.push('/sessionJoin' as any);
        }} disabled={loading}>
          <Ionicons name="qr-code" size={18} color={appColors.success} />
          <Text style={styles.joinSessionButtonText}>ENTRAR EM SESSÃO EXISTENTE</Text>
        </TouchableOpacity>
      </View>

      {savedSessions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sessoes salvas</Text>
          {savedSessions.map((session) => (
            <View key={session.id} style={styles.savedSessionRow}>
              <View style={styles.savedSessionContent}>
                <TouchableOpacity style={styles.savedSessionTextBox} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                  <Text style={styles.savedSessionTitle}>{session.name}</Text>
                  <Text style={styles.savedSessionMeta}>
                    {session.isMaster ? 'Mestre' : 'Jogador'} - Nivel {session.level} - Turno {session.currentTurn} - {session.playerCount} jogador(es)
                  </Text>
                </TouchableOpacity>
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleResumeSavedSession(session)} disabled={loading}>
                    <Ionicons name={session.isMaster ? 'play' : 'person'} size={16} color={appColors.success} />
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
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar código</Text>
          </TouchableOpacity>
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

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar código</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={handleCopyJoinInvite}>
            <Ionicons name="link" size={15} color={appColors.textPrimary} />
            <Text style={styles.smallButtonText}>Copiar convite</Text>
          </TouchableOpacity>
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
              
              {event.type === 'spell_effect' && event.fromKey !== 'master' && reviewedSpellEventIds.includes('__spell_review_disabled__') && !reviewedSpellEventIds.includes(event.id) && (
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleAcceptSpellEffect(event, true)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>OK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleAcceptSpellEffect(event, false)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Não</Text>
                  </TouchableOpacity>
                </View>
              )}

              {event.type === 'resource_request' && event.fromKey !== 'master' && !reviewedRequestEventSet.has(event.id) && (
                <View style={styles.savedSessionActions}>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleReviewResourceRequest(event, true)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Aceitar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleReviewResourceRequest(event, false)}>
                    <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Recusar</Text>
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

        {pendingSaves.length > 0 && (
          <View style={styles.effectForm}>
            <Text style={styles.strongText}>Testes pendentes</Text>
            {pendingSaves.map((save) => {
              const player = sessionState.players.find((entry) => entry.remoteKey === save.targetKey);
              return (
                <View key={save.id} style={styles.catalogRow}>
                  <View style={styles.catalogTextBox}>
                    <Text style={styles.catalogName}>{player?.characterName || save.targetKey}</Text>
                    <Text style={styles.catalogMeta}>
                      {save.sourceName || 'Efeito'} - {save.ability}{save.dc ? ` CD ${save.dc}` : ' CD manual'}
                    </Text>
                  </View>
                  <View style={styles.savedSessionActions}>
                    <TouchableOpacity style={[styles.smallButton, styles.smallButtonSuccess]} onPress={() => handleResolvePendingSave(save, true)}>
                      <Text style={[styles.smallButtonText, styles.smallButtonTextSuccess]}>Passou</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => handleResolvePendingSave(save, false)}>
                      <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Falhou</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

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
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayerDelta(player, 'hpCurrent', -1, `Mestre causou 1 de dano em ${player.characterName}.`)}>
            <Text style={styles.smallButtonText}>-1 HP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallButton} onPress={() => handleUpdatePlayerDelta(player, 'hpCurrent', 1, `Mestre curou 1 HP de ${player.characterName}.`)}>
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
              <TouchableOpacity style={styles.smallButton} onPress={() => setDetailPlayer(player)}>
                <Ionicons name="document-text" size={14} color={appColors.primary} />
                <Text style={styles.smallButtonText}>Ver ficha</Text>
              </TouchableOpacity>
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

      {selectedEffectOptions.length > 0 && (
        <View style={styles.inventoryBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.strongText}>{selectedEffectOptions.length} efeito(s) selecionado(s)</Text>
            <TouchableOpacity onPress={clearSelectedEffects}>
              <Text style={{ color: appColors.danger, fontSize: 12, fontWeight: 'bold' }}>Limpar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.inventoryText}>{selectedEffectOptions.map((option) => option.name).join(', ')}</Text>
        </View>
      )}

      <ScrollView 
        style={{ maxHeight: 190 }} 
        nestedScrollEnabled={true} 
        keyboardShouldPersistTaps="handled"
      >
        {filteredEffectOptions.map((option) => {
          const selected = selectedEffectSet.has(option.key);
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.catalogRow, selected && styles.catalogRowActive]}
              onPress={() => handleSelectEffectOption(option)}
            >
              <View style={[styles.catalogCheck, selected && styles.catalogCheckActive]}>
                {selected && <Ionicons name="checkmark" size={15} color={appColors.primaryDark} />}
              </View>
              <View style={styles.catalogTextBox}>
                <Text style={styles.catalogTag}>{option.group}</Text>
                <Text style={styles.catalogName}>{option.name}</Text>
                <Text style={styles.catalogMeta}>{option.detail || 'Sem detalhe cadastrado'}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.inventoryBox}>
        <Text style={styles.strongText}>{selectedEffectOptions.length > 0 ? 'Aplicacao em lote' : effectName}</Text>
        <Text style={styles.inventoryText}>Fonte: {effectSource || 'base'} - ajuste alvo, valor e duração antes de aplicar.</Text>
        {selectedEffectOptions.length > 0 ? (
          <Text style={styles.inventoryText}>Busca filtra; clique em varios itens para selecionar ou remover da selecao.</Text>
        ) : effectSaveInfo ? <Text style={styles.inventoryText}>{effectSaveInfo}</Text> : null}
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

      {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(effectTarget) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
          <View style={styles.filterRail}>
            {(['add', 'set'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.filterChip, effectMode === mode && styles.filterChipActive]}
                onPress={() => setEffectMode(mode)}
              >
                <Text style={[styles.filterChipText, effectMode === mode && styles.filterChipTextActive]}>{mode === 'set' ? 'Definir valor' : 'Somar bonus'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

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
        <TouchableOpacity onPress={() => {
          traceButton('lan-session', 'LAN_SESSION_BACK', { sessionId: activeSessionId });
          router.back();
        }}>
          <Ionicons name="arrow-back" size={28} color={appColors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Sessão LAN</Text>
          <Text style={styles.topBarSub}>Mestre ou jogador</Text>
        </View>
        <TouchableOpacity onPress={() => {
          traceButton('lan-session', 'OPEN_DEBUG_TRACE', { sessionId: activeSessionId });
          router.push('/debug-trace' as any);
        }}>
          <Text style={{ color: appColors.warning, fontWeight: 'bold' }}>Trace</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!payload ? (
          renderSetup()
        ) : (
          <>
            {renderSessionControls()}
            {renderPlayers()}
            {renderTimelineCard()}
            {renderCatalogCard()}
            {renderQrCard()}
          </>
        )}
      </ScrollView>

      {/* MODAIS AQUI - Eles precisam estar renderizados no topo da árvore */}
      {renderCatalogModal()}
      {renderInventoryModal()}
      {renderPlayerDetailsModal()}
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

function makeEffectDraftFromOption(option: EffectOption): EffectDraft {
  const firstEffect = option.effects[0] || {};
  const target = normalizeEffectTarget(firstEffect.target || firstEffect.stat || firstEffect.type);
  const remaining = Math.max(1, Number(option.durationValue || firstEffect.durationValue || firstEffect.duration || 1) || 1);
  const unit = option.durationUnit || normalizeEffectUnit(firstEffect.durationUnit || firstEffect.unit) || inferUnitFromText(option.durationText);
  const kind = target === 'PV_TEMP'
    ? 'temp_hp'
    : target === 'HP'
      ? 'hp'
      : target === 'custom'
        ? 'status'
        : 'stat';

  return {
    name: String(firstEffect.conditionName || option.name || 'Efeito'),
    target,
    value: Number(firstEffect.value ?? firstEffect.val ?? firstEffect.amount ?? 0) || 0,
    remaining,
    unit,
    durationText: option.durationText || `${remaining} ${unit}`,
    kind,
    mode: firstEffect.mode === 'set' ? 'set' : 'add',
    source: option.group,
    statusKey: option.statusKey || String(firstEffect.statusKey || firstEffect.status || ''),
    color: option.color || String(firstEffect.color || ''),
    secondaryColor: option.secondaryColor || String(firstEffect.secondaryColor || ''),
  };
}

function getInventoryItemCategory(item: Record<string, unknown>): InventoryFilter {
  const text = `${item.name || ''} ${item.properties || ''} ${item.descricao || ''} ${item.damage || ''} ${item.damage_type || ''}`.toLowerCase();
  const effectJson = String(item.effect_json || '').trim();
  if (effectJson && effectJson !== '[]') return 'Efeitos';
  if (text.includes('poção') || text.includes('pocao') || text.includes('pergaminho') || text.includes('consum')) return 'Consumiveis';
  if (text.includes(' ca ') || text.includes('armadura') || text.includes('escudo')) return 'Armaduras';
  if (String(item.damage || '').trim() || text.includes('arma')) return 'Armas';
  return 'Outros';
}

function matchesInventorySearch(item: InventoryItemOption, search: string) {
  return [
    item.name,
    item.damage,
    item.damage_type,
    item.properties,
    item.descricao,
    getInventoryItemCategory(item),
  ].some((value) => String(value || '').toLowerCase().includes(search));
}

function describeInventoryItem(item: Record<string, unknown>) {
  return [item.damage, item.damage_type, item.properties, item.descricao]
    .filter((value) => value && value !== '-')
    .join(' - ');
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function formatReferenceNames(ids: string[], options: ReferenceOption[]) {
  if (!ids.length) return '';
  const byId = new Map(options.map((option) => [String(option.id), option]));
  return ids.map((id) => {
    const option = byId.get(String(id));
    return option ? `${option.name}${option.stat ? ` (${option.stat})` : ''}` : id;
  }).join(', ');
}

function formatCharacterField(field: string) {
  const labels: Record<string, string> = {
    personality_traits: 'Personalidade',
    ideals: 'Ideais',
    bonds: 'Vinculos',
    flaws: 'Defeitos',
    backstory: 'Historia',
    allies_organizations: 'Aliados/organizacoes',
    languages: 'Idiomas',
  };
  return labels[field] || field;
}

function formatSessionEvent(event: LanSessionEvent) {
  if (event.type === 'resource_request') return `${event.fromName} pediu: ${formatResourceRequest(event.resourceRequest)}.`;
  if (event.message) return event.message;
  if (event.type === 'player_joined') return `${event.fromName} entrou na sessao.`;
  if (event.type === 'effect_expired') {
    const effectName = event.expiredEffect?.name || 'Efeito';
    return `${event.toName}: ${effectName} acabou.`;
  }
  if (event.type === 'effect_patch') return event.message || `Efeitos oficiais atualizados para ${event.toName}.`;
  if (event.type === 'effect_catalog_patch') return event.message || 'Catalogo de efeitos atualizado.';
  if (event.type === 'pending_save_patch') return event.message || `Teste pendente atualizado para ${event.toName}.`;
  if (event.type === 'spell_effect') {
    if (event.fromKey === event.toKey || event.fromName === event.toName) return `${event.fromName} usou ${event.spellEffect?.spellName || 'efeito'}.`;
    return `${event.fromName} aplicou ${event.spellEffect?.spellName || 'efeito'} em ${event.toName}.`;
  }
  if (event.type === 'spell_hp') return `${event.fromName} usou ${event.spellEffect?.spellName || 'magia'} em ${event.toName}.`;
  if (event.type === 'resource_review') return event.message || `Revisao de pedido: ${event.toName}.`;
  if (event.type === 'inventory_patch') return event.message || `${event.fromName} atualizou o inventario.`;
  if (event.type === 'player_patch') return event.message || `${event.fromName} atualizou recursos proprios.`;
  if (event.type === 'send_item') return `${event.fromName} enviou ${event.item?.qty || 1}x ${event.item?.name || 'item'} para ${event.toName}.`;
  if (event.type === 'trade_offer') return `${event.fromName} ofereceu troca para ${event.toName}.`;
  if (event.type === 'trade_accept') return `${event.fromName} aceitou troca com ${event.toName}.`;
  if (event.type === 'trade_decline') return `${event.fromName} recusou troca com ${event.toName}.`;
  if (event.type === 'timeline_event') return event.message || 'Evento da sessao.';
  return event.type;
}

function formatResourceRequest(request?: LanSessionEvent['resourceRequest']) {
  if (!request) return 'ajuste';
  if (request.message) return request.message;
  const amount = Number(request.amount ?? request.value ?? 0);
  const sign = amount >= 0 ? '+' : '';
  if (request.kind === 'xp') return `XP ${sign}${amount}`;
  if (request.kind === 'hp') return `HP ${sign}${amount}`;
  if (request.kind === 'temp_hp') return `PV temporario ${sign}${amount}`;
  if (request.kind === 'coin') return `${formatCoinField(request.field)} ${sign}${amount}`;
  if (request.kind === 'stat' || request.kind === 'buff') return `${request.field || 'atributo'} ${sign}${amount}`;
  if (request.kind === 'condition') return `condicao ${request.field || 'manual'}`;
  if (request.kind === 'inventory') return request.item ? `${request.item.qty}x ${request.item.name}` : 'inventario';
  return 'ajuste';
}

function formatCoinField(field?: string) {
  if (field === 'gp') return 'ouro';
  if (field === 'sp') return 'prata';
  if (field === 'cp') return 'cobre';
  return 'moedas';
}

function formatPlayerField(field: 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp') {
  const labels = {
    hpCurrent: 'vida atual',
    hpMax: 'vida maxima',
    tempHp: 'vida temporaria',
    xp: 'XP',
    gp: 'ouro',
    sp: 'prata',
    cp: 'cobre',
  };
  return labels[field];
}

function formatAdvanceUnit(unit: LanAdvanceUnit) {
  const labels: Record<LanAdvanceUnit, string> = {
    turn: 'um turno',
    minute: 'um minuto',
    hour: 'uma hora',
    shortRest: 'um descanso curto',
    longRest: 'um descanso longo',
  };
  return labels[unit];
}

function parseOptionEffects(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeCatalogEffect);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(normalizeCatalogEffect) : [];
  } catch {
    return [];
  }
}

function normalizeCatalogEffect(effect: any) {
  const condition = effect?.condition || {};
  const save = effect?.save || {};
  const conditionDuration = condition?.duration || {};
  const kind = String(effect?.kind || effect?.type || '').toLowerCase();
  const target = effect?.target || (kind === 'temp_hp' ? 'PV_TEMP' : kind === 'stat' ? effect?.stat : 'custom');

  return {
    ...effect,
    target,
    value: effect?.value ?? effect?.amount ?? 0,
    status: condition?.key || effect?.status,
    conditionName: condition?.name,
    color: condition?.color || effect?.color,
    secondaryColor: condition?.secondaryColor || effect?.secondaryColor,
    saveAbility: save?.ability,
    saveDc: save?.dc,
    saveOnSuccess: save?.onSuccess,
    durationValue: effect?.durationValue ?? conditionDuration?.value,
    durationUnit: effect?.durationUnit ?? conditionDuration?.unit,
    mode: effect?.mode === 'set' || effect?.operation === 'set' || kind === 'stat_set' ? 'set' : 'add',
  };
}

function formatEffectSaveInfo(effect: any) {
  if (!effect?.saveAbility) return '';
  const successLabels: Record<string, string> = {
    none: 'sucesso sem efeito adicional',
    half: 'sucesso reduz pela metade',
    negates: 'sucesso anula',
  };
  const dc = effect.saveDc ? ` CD ${effect.saveDc}` : '';
  const failure = effect.conditionName ? `; falha aplica ${effect.conditionName}` : '';
  return `Teste ${effect.saveAbility}${dc} (${successLabels[String(effect.saveOnSuccess || 'none')] || 'sucesso definido pelo mestre'}${failure}).`;
}

function normalizeEffectUnit(value: unknown): LanEffectUnit | null {
  if (
    value === 'instant' ||
    value === 'turn' ||
    value === 'round' ||
    value === 'minute' ||
    value === 'hour' ||
    value === 'day' ||
    value === 'short_rest' ||
    value === 'long_rest' ||
    value === 'rest' ||
    value === 'concentration' ||
    value === 'while_equipped' ||
    value === 'while_active' ||
    value === 'until_save' ||
    value === 'permanent' ||
    value === 'manual'
  ) return value;
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
