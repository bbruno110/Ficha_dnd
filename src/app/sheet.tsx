// ================= sheet.tsx =================
import DiceRoller3D, { type DiceRollRequest, type DiceRollResult } from '@/components/DiceRoller3D';
import { useLanAppLifecycle } from '@/hooks/useLanAppLifecycle';
import { useLanRealtimePlayerPatches } from '@/hooks/useLanRealtimePlayerPatches';
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
import { applyDamageWithTempHp } from '@/services/combat/hpDamageService';
import { resolveSavingThrow } from '@/services/combat/saveResolverService';
import { getCurrentBreathColor, getVisibleEffects } from '@/services/effects/effectVisualService';
import {
  debugLanFlow,
  getSheetRuntimeMode,
  hasLanBlockedUpdates,
  isLanPlayerMode,
  splitLanPlayerAuthoritativeUpdates,
} from '@/services/lanRuntimeMode';
import {
  fetchLanSessionEvents,
  fetchLanSessionPayload,
  getLocalLanSessionForCharacter,
  getPublicLanPlayers,
  makeLanCharacterKey,
  makeLanEventId,
  notifyMasterJoin,
  rememberLanSessionEvent,
  resetLanClientConnection,
  requestLanSessionResync,
  resolveLanSessionUrlByInviteCode,
  saveLanSession,
  sendLanSessionEvent,
  unlinkCharacterFromLanSession,
  type LanEffectTarget,
  type LanEffectUnit,
  type LanResourceRequest,
  type LanSessionEvent,
  type LanSessionPayload,
  type LanSessionStatus,
  type LanTradeItem,
  type PublicLanPlayer,
} from '@/services/lanSession';
import {
  getLanPayloadSnapshotSeq,
  markLanConnectionStatus,
  markLanEventsApplied,
  markLanSnapshotApplied,
  shouldApplyLanSnapshot,
} from '@/services/lanSyncEngine';
import {
  getExpectedLevelForXp as getExpectedLevelForXpFromDb,
  getXpRequiredForLevel,
  seedDefaultXpProgression,
} from '@/services/xpProgressionService';
import { getKnownLanEntityRevisions, useLanRealtimeStore } from '@/stores/lanRealtimeStore';
import { appColors, appGradients, sheetStyles as styles } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, FlatList, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
const LAN_NUMBER_COLUMNS = `
  hp_current,
  hp_max,
  temp_hp,
  xp,
  gp,
  sp,
  cp
`;

const formatSignedModifier = (value: number) => value >= 0 ? `+${value}` : String(value);

// Força a categoria correta para o agrupamento
const getCategory = (spell: any): string => {
  if (spell.category && spell.category !== 'Desconhecido') return spell.category;
  if (spell.level === 'Truque' || spell.level?.includes('Nível')) return 'Magia';
  if (spell.casting_time === 'Passiva' || spell.level === 'Passiva') return 'Passiva';
  return 'Habilidade';
};


const safeJsonParse = <T,>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};


const normalizeSheetEquipment = (value: unknown) => {
  const parsed = safeJsonParse<any>(value, {});

  if (Array.isArray(parsed)) {
    return { bag: parsed, slots: { ...DEFAULT_SLOTS } };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { bag: [], slots: { ...DEFAULT_SLOTS } };
  }

  return {
    ...parsed,
    bag: Array.isArray(parsed.bag) ? parsed.bag : [],
    slots: { ...DEFAULT_SLOTS, ...(parsed.slots || {}) },
  };
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
  const [expectedLevelByXp, setExpectedLevelByXp] = useState(1);
  const [nextLevelXpRequired, setNextLevelXpRequired] = useState<number | null>(null);

  // Estados do Menu de Ação
  const [selectedBagItem, setSelectedBagItem] = useState<{item: any, index: number} | null>(null);
  const [actionQty, setActionQty] = useState(1);
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});
  const [lanInfo, setLanInfo] = useState<{ sessionId: string; joinUrl: string; hostInstanceId?: string } | null>(null);
  const [lanSessionStatus, setLanSessionStatus] = useState<LanSessionStatus | null>(null);
  const [lanPlayers, setLanPlayers] = useState<PublicLanPlayer[]>([]);
  const sheetRuntimeMode = getSheetRuntimeMode({
    lanInfo,
    routeSessionId,
    routeJoinUrl,
  });
  const isLanPlayerRuntime = isLanPlayerMode(sheetRuntimeMode);
  const characterRef = useRef<any>(null);
  const lastLanJoinNotifyRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const sessionTerminatedRef = useRef<string | null>(null);
  const lastAuthoritativePlayerPatchRef = useRef<{ seq: number; entityRevision: number; appliedAt: number }>({
    seq: 0,
    entityRevision: 0,
    appliedAt: 0,
  });
  const [incomingTrades, setIncomingTrades] = useState<LanSessionEvent[]>([]);
  const [targetPickerMode, setTargetPickerMode] = useState<'send' | 'trade' | null>(null);
  const [selectedTradeOffer, setSelectedTradeOffer] = useState<LanSessionEvent | null>(null);
  const [tradeCounterItem, setTradeCounterItem] = useState<{item: any, index: number} | null>(null);
  const [tradeCounterQty, setTradeCounterQty] = useState(1);
  const [spellCastVisible, setSpellCastVisible] = useState(false);
  const [spellTargetKeys, setSpellTargetKeys] = useState<string[]>([]);
  const [spellTargetAmounts, setSpellTargetAmounts] = useState<Record<string, string>>({});
  const [spellTargetAttackRolls, setSpellTargetAttackRolls] = useState<Record<string, string>>({});
  const [spellRollResult, setSpellRollResult] = useState('');
  const [spellRollMode, setSpellRollMode] = useState<'virtual' | 'manual'>('manual');
  const [spellAttackRollResult, setSpellAttackRollResult] = useState('');
  const [spellAttackRollMode, setSpellAttackRollMode] = useState<'virtual' | 'manual'>('manual');
  const [spellDicePurpose, setSpellDicePurpose] = useState<'damage' | 'attack'>('damage');
  const [spellEffectTarget, setSpellEffectTarget] = useState<LanEffectTarget>('custom');
  const [spellEffectValue, setSpellEffectValue] = useState('0');
  const [pendingEffectSave, setPendingEffectSave] = useState<NonNullable<LanSessionEvent['saveRequest']> | null>(null);
  const [saveManualValue, setSaveManualValue] = useState('');
  const [submittingSheetActions, setSubmittingSheetActions] = useState<string[]>([]);
  const submittingSheetActionsRef = useRef<Set<string>>(new Set());

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
  const [effectFrame, setEffectFrame] = useState(0);
  
  // Estado para o Detalhe da Magia e Animação
  const [selectedSpell, setSelectedSpell] = useState<any>(null);
  const spellScaleAnim = useRef(new Animated.Value(0.85)).current;
  const spellFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => setEffectFrame((frame) => (frame + 1) % 24), 1400);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  useEffect(() => {
    if (!character) return;
    let disposed = false;

    const refreshXpProgression = async () => {
      try {
        await seedDefaultXpProgression(db);
        const xpValue = Number(character.xp) || 0;
        const currentLevel = Number(character.level) || 1;
        const [nextExpectedLevel, nextRequiredXp] = await Promise.all([
          getExpectedLevelForXpFromDb(db, xpValue),
          getXpRequiredForLevel(db, currentLevel + 1),
        ]);

        if (!disposed) {
          setExpectedLevelByXp(nextExpectedLevel);
          setNextLevelXpRequired(nextRequiredXp);
        }
      } catch (error) {
        console.warn('[XP] Nao foi possivel carregar progressao de XP:', error);
      }
    };

    void refreshXpProgression();
    return () => {
      disposed = true;
    };
  }, [db, character?.xp, character?.level]);

  useEffect(() => {
    if (!character?.id) return;
    debugLanFlow('SHEET_RUNTIME_MODE', {
      characterId: character.id,
      characterName: character.name,
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId || routeSessionId || '',
      joinUrl: lanInfo?.joinUrl || routeJoinUrl || '',
    });
  }, [character?.id, character?.name, sheetRuntimeMode, lanInfo?.sessionId, lanInfo?.joinUrl, routeSessionId, routeJoinUrl]);

  useEffect(() => () => {
    resetLanClientConnection();
  }, []);

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

  const fetchLanPayloadWithRecovery = useCallback(async (
    info: { sessionId: string; joinUrl: string },
    storedPayloadJson?: string | null
  ) => {
    if (sessionTerminatedRef.current === info.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_PAYLOAD_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'fetchLanPayloadWithRecovery',
        sessionId: info.sessionId,
        characterId: characterRef.current?.id,
        characterName: characterRef.current?.name,
      });
      throw new Error('Sessao LAN encerrada localmente.');
    }
    const startedAt = Date.now();
    traceFunctionCall('fetchLanPayloadWithRecovery', {
      info,
      hasStoredPayload: Boolean(storedPayloadJson),
    }, {
      screen: 'sheet',
      source: 'lan_recovery',
      sessionId: info.sessionId,
      characterId: characterRef.current?.id,
      characterName: characterRef.current?.name,
    });
    let firstError: unknown = null;

    if (info.joinUrl) {
      try {
        const payload = await fetchLanSessionPayload(info.joinUrl);
        if (payload.session.id !== info.sessionId) {
          throw new Error('Sessao LAN retornou outro identificador.');
        }
        traceFunctionReturn('fetchLanPayloadWithRecovery', {
          recovered: true,
          strategy: 'direct_join_url',
          sessionId: payload.session.id,
        }, {
          screen: 'sheet',
          source: 'lan_recovery',
          sessionId: info.sessionId,
          durationMs: Date.now() - startedAt,
        });
        return { payload, info };
      } catch (error) {
        firstError = error;
      }
    }

    const inviteCode = getInviteCodeFromPayloadJson(storedPayloadJson);
    if (inviteCode) {
      const recoveredUrl = await resolveLanSessionUrlByInviteCode(inviteCode);

      if (recoveredUrl) {
        resetLanClientConnection();
        const payload = await fetchLanSessionPayload(recoveredUrl);
        if (payload.session.id !== info.sessionId) {
          throw new Error('Sessao LAN retornou outro identificador.');
        }
        traceFunctionReturn('fetchLanPayloadWithRecovery', {
          recovered: true,
          strategy: 'invite_code',
          sessionId: payload.session.id,
        }, {
          screen: 'sheet',
          source: 'lan_recovery',
          sessionId: info.sessionId,
          durationMs: Date.now() - startedAt,
        });
        return {
          payload,
          info: {
            ...info,
            joinUrl: recoveredUrl,
          },
        };
      }
    }

    if (firstError) throw firstError;
    traceFunctionReturn('fetchLanPayloadWithRecovery', { recovered: false }, {
      screen: 'sheet',
      source: 'lan_recovery',
      sessionId: info.sessionId,
      durationMs: Date.now() - startedAt,
    });
    throw new Error('Sessao LAN sem URL ativa.');
  }, []);

  useFocusEffect(
    useCallback(() => {
    traceScreen('sheet', 'SHEET_SCREEN_FOCUS', {
      characterId: id,
      sessionId: routeSessionId,
      source: 'CharacterSheetScreen',
    });
    async function loadData() {
      if (!id) return;
      const startedAt = Date.now();
      traceFunctionCall('loadData', { id, routeSessionId, routeJoinUrl }, {
        screen: 'sheet',
        source: 'sheet_focus',
        characterId: id,
        sessionId: routeSessionId,
      });
      try {
        traceSqlite('SQLITE_READ_START', {
          screen: 'sheet',
          source: 'loadData',
          functionName: 'loadData',
          table: 'characters/items/skills/saving_throws',
          operation: 'SHEET_CHARACTER_LOAD',
          characterId: id,
          sessionId: routeSessionId,
        });
        const result = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        await ensureItemEffectHiddenColumn(db);
        const catalog = await db.getAllAsync(`SELECT * FROM items ORDER BY name ASC`);
        const skillsList = await db.getAllAsync(`SELECT * FROM skills ORDER BY name ASC`);
        const savesList = await db.getAllAsync(`SELECT * FROM saving_throws ORDER BY name ASC`);
        
        setDbItemsCatalog(catalog);
        setDbSkills(skillsList);
        setDbSaves(savesList);

        if (result) {
          const parsedEquip = normalizeSheetEquipment((result as any).equipment);

          let loadedSaves = safeJsonParse<any[]>((result as any).save_values, []);
          let loadedSkills = safeJsonParse<any[]>((result as any).skill_values, []);
          const backupProfs = safeJsonParse<string[]>((result as any).proficiencies, []);

          if (!Array.isArray(loadedSaves) || (loadedSaves.length > 0 && typeof loadedSaves[0] !== 'string')) {
              loadedSaves = backupProfs.filter((p: string) => p.startsWith('save_'));
          }
          if (!Array.isArray(loadedSkills) || (loadedSkills.length > 0 && typeof loadedSkills[0] !== 'string')) {
              loadedSkills = backupProfs.filter((p: string) => p.startsWith('skill_'));
          }

          const parsedStats = safeJsonParse<Record<string, any>>((result as any).stats, {});
          if(!parsedStats.temp_mods) parsedStats.temp_mods = {};
          if(!parsedStats.equip_mods) parsedStats.equip_mods = {};

          const charData: any = {
            ...(result as any),
            stats: parsedStats,
            save_values: loadedSaves,
            skill_values: loadedSkills,
            equipment: parsedEquip,
            spells: safeJsonParse<any[]>((result as any).spells, []),
            active_effects: safeJsonParse<any[]>((result as any).active_effects_json, []),
          };
          setCharacter(charData);
          traceSqlite('SQLITE_READ_DONE', {
            screen: 'sheet',
            source: 'loadData',
            functionName: 'loadData',
            table: 'characters',
            operation: 'SHEET_CHARACTER_LOAD',
            characterId: charData.id,
            characterName: charData.name,
            sessionId: routeSessionId,
            result: {
              hp_current: charData.hp_current,
              hp_max: charData.hp_max,
              temp_hp: charData.temp_hp,
              xp: charData.xp,
              gp: charData.gp,
              sp: charData.sp,
              cp: charData.cp,
              activeEffectCount: charData.active_effects?.length || 0,
            },
            durationMs: Date.now() - startedAt,
          });

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
        traceFunctionReturn('loadData', { loaded: Boolean(result) }, {
          screen: 'sheet',
          characterId: id,
          sessionId: routeSessionId,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error(error);
        traceError('SCREEN', 'SHEET_CHARACTER_LOAD_ERROR', error, {
          screen: 'sheet',
          characterId: id,
          sessionId: routeSessionId,
        });
      } finally { setLoading(false); }
    }
      loadData();
    }, [id])
  );

  const notifyMasterReconnect = useCallback(async (
    nextPayload: LanSessionPayload,
    nextInfo: { sessionId: string; joinUrl: string },
    currentCharacter: Record<string, unknown>,
    options?: { force?: boolean; reviewSnapshot?: boolean }
  ) => {
    if (sessionTerminatedRef.current === nextInfo.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'notifyMasterReconnect',
        sessionId: nextInfo.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
      });
      return;
    }
    const selfKey = makeLanCharacterKey(nextInfo.sessionId, currentCharacter);
    const isAlreadyInSession = Boolean(nextPayload.state?.players?.some((player) => (
      player.remoteKey === selfKey ||
      player.characterName === currentCharacter.name
    )));
    const key = `${nextInfo.sessionId}:${currentCharacter.id || ''}:${nextPayload.session.id}:${isAlreadyInSession ? 'joined' : 'joining'}`;
    const now = Date.now();
    const throttleMs = isAlreadyInSession ? 15000 : 3000;

    if (!options?.force && lastLanJoinNotifyRef.current.key === key && now - lastLanJoinNotifyRef.current.at < throttleMs) {
      return;
    }

    lastLanJoinNotifyRef.current = { key, at: now };

    try {
      await notifyMasterJoin(nextInfo.joinUrl, nextInfo.sessionId, currentCharacter, '', { reviewSnapshot: Boolean(options?.reviewSnapshot) });
    } catch (error) {
      console.warn('[LAN] Nao foi possivel reanunciar jogador ao mestre:', error);
    }
  }, []);

  const updateSelfLanBarFromAuthoritativePatch = useCallback((
    sessionValue: string,
    nextValues: {
      hp_current: unknown;
      hp_max: unknown;
      temp_hp: unknown;
      xp: unknown;
      gp: unknown;
      sp: unknown;
      cp: unknown;
    },
    event: LanSessionEvent,
  ) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;

    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);
    setLanPlayers((current) => current.map((player) => (
      player.isSelf || player.key === selfKey || player.characterName === currentCharacter.name
        ? {
          ...player,
          hpCurrent: Number(nextValues.hp_current) || 0,
          hpMax: Number(nextValues.hp_max) || 0,
          tempHp: Number(nextValues.temp_hp) || 0,
          level: Number(currentCharacter.level) || player.level,
        }
        : player
    )));
    traceApp('UI_UPDATE', 'LAN_PLAYER_BAR_UPDATED_FROM_AUTHORITATIVE_PATCH', {
      screen: 'sheet',
      source: 'updateSelfLanBarFromAuthoritativePatch',
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event.id,
      eventType: event.type,
      seq: event.seq,
      entityRevision: event.entityRevision,
      after: {
        hpCurrent: nextValues.hp_current,
        hpMax: nextValues.hp_max,
        tempHp: nextValues.temp_hp,
      },
    });
    traceApp('UI_UPDATE', 'PLAYER_NUMBER_PATCH_APPLIED_TO_HEADER', {
      screen: 'sheet',
      source: 'updateSelfLanBarFromAuthoritativePatch',
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event.id,
      eventType: event.type,
      seq: event.seq,
      entityRevision: event.entityRevision,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
      gp: nextValues.gp,
      sp: nextValues.sp,
      cp: nextValues.cp,
    });

    debugLanFlow('PLAYER_PATCH_APPLIED_TO_LAN_BAR', {
      eventId: event.id,
      sessionId: sessionValue,
      selfKey,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      seq: event.seq,
      entityRevision: event.entityRevision,
    });
  }, []);

  const applyLanNumberPatchToCharacter = useCallback(async (patch: LanSessionEvent['numberPatch'], event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch) return null;
    const startedAt = Date.now();
    traceFunctionCall('applyLanNumberPatchToCharacter', { patch, event }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      serverSeq: event?.serverSeq,
      entityType: event?.entityType,
      entityId: event?.entityId,
      entityRevision: event?.entityRevision,
      fromKey: event?.fromKey,
      toKey: event?.toKey,
      patch,
    });

    debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      patch,
    });

    traceSqlite('SQLITE_READ_START', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'READ_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
    });
    const current = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT ${LAN_NUMBER_COLUMNS} FROM characters WHERE id = ?`,
      [Number(currentCharacter.id)]
    );
    traceSqlite('SQLITE_READ_DONE', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'READ_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      result: current,
    });

    const base = current || currentCharacter;
    const nextValues = {
      hp_current: patch.hpCurrent ?? base.hp_current,
      hp_max: patch.hpMax ?? base.hp_max,
      temp_hp: patch.tempHp ?? base.temp_hp,
      xp: patch.xp ?? base.xp,
      gp: patch.gp ?? base.gp,
      sp: patch.sp ?? base.sp,
      cp: patch.cp ?? base.cp,
    };

    traceStateChange('STATE_CHANGE', 'PLAYER_CHARACTER_NUMBER_PATCH_COMPUTED', base, nextValues, {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      patch,
    });
    debugLanFlow('PLAYER_APPLY_NUMBER_PATCH_VALUES', {
      mode: sheetRuntimeMode,
      characterId: currentCharacter.id,
      beforeHp: base.hp_current,
      afterHp: nextValues.hp_current,
      patch,
    });

    setCharacter((prev: any) => prev ? ({ ...prev, ...nextValues }) : prev);
    debugLanFlow('PLAYER_RUNTIME_PATCH_APPLIED', {
      eventId: event?.id,
      type: event?.type,
      characterId: currentCharacter.id,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
    });
    debugLanFlow('PLAYER_SQLITE_PERSIST_START', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      patch,
    });

    traceSqlite('SQLITE_WRITE_START', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      before: base,
      after: nextValues,
      patch,
    });
    await db.runAsync(
      `UPDATE characters
       SET hp_current = ?,
           hp_max = ?,
           temp_hp = ?,
           xp = ?,
           gp = ?,
           sp = ?,
           cp = ?
       WHERE id = ?`,
      [
        nextValues.hp_current,
        nextValues.hp_max,
        nextValues.temp_hp,
        nextValues.xp,
        nextValues.gp,
        nextValues.sp,
        nextValues.cp,
        Number(currentCharacter.id),
      ]
    );
    traceSqlite('SQLITE_WRITE_DONE', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      functionName: 'applyLanNumberPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_NUMBER_FIELDS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      after: nextValues,
    });
    traceApp('SQLITE_WRITE_DONE', 'PLAYER_NUMBER_PATCH_SQLITE_DONE', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      after: nextValues,
    });
    debugLanFlow('PLAYER_SQLITE_PERSIST_DONE', {
      eventId: event?.id,
      characterId: currentCharacter.id,
    });

    setCharacter((prev: any) => prev ? ({ ...prev, ...nextValues }) : prev);
    debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_DONE', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      nextValues,
    });
    debugLanFlow('PLAYER_PATCH_APPLIED_TO_CHARACTER', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
    });
    if (patch.tempHp != null) {
      traceApp('EVENT_RECEIVED', 'PLAYER_TEMP_HP_PATCH_RECEIVED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: patch.tempHp,
      });
      traceApp('UI_UPDATE', 'PLAYER_TEMP_HP_HEADER_UPDATED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: nextValues.temp_hp,
      });
      traceApp('UI_UPDATE', 'PLAYER_TEMP_HP_SHEET_UPDATED', {
        screen: 'sheet',
        source: 'applyLanNumberPatchToCharacter',
        sessionId: event?.sessionId,
        characterId: currentCharacter.id,
        characterName: currentCharacter.name,
        eventId: event?.id,
        tempHp: nextValues.temp_hp,
      });
      debugLanFlow('PLAYER_NUMBER_PATCH_TEMP_HP_APPLIED', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        tempHp: nextValues.temp_hp,
        seq: event?.seq,
        entityRevision: event?.entityRevision,
      });
    }
    if (patch.xp != null) {
      debugLanFlow('PLAYER_NUMBER_PATCH_XP_APPLIED', {
        eventId: event?.id,
        characterId: currentCharacter.id,
        xp: nextValues.xp,
        seq: event?.seq,
        entityRevision: event?.entityRevision,
      });
    }
    traceApp('UI_UPDATE', 'CHARACTER_SHEET_NUMBER_FIELDS_UPDATED', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      before: base,
      after: nextValues,
      patch,
    });
    traceApp('UI_UPDATE', 'PLAYER_NUMBER_PATCH_APPLIED_TO_CHARACTER', {
      screen: 'sheet',
      source: 'applyLanNumberPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      hpCurrent: nextValues.hp_current,
      hpMax: nextValues.hp_max,
      tempHp: nextValues.temp_hp,
      xp: nextValues.xp,
      gp: nextValues.gp,
      sp: nextValues.sp,
      cp: nextValues.cp,
    });
    traceFunctionReturn('applyLanNumberPatchToCharacter', nextValues, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      durationMs: Date.now() - startedAt,
    });
    return nextValues;
  }, [db]);

  const applyLanEffectPatchToCharacter = useCallback(async (patch: LanSessionEvent['effectPatch'], event?: LanSessionEvent) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch) return;
    const startedAt = Date.now();
    traceFunctionCall('applyLanEffectPatchToCharacter', { patch, event }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      serverSeq: event?.serverSeq,
      entityType: event?.entityType,
      entityId: event?.entityId,
      entityRevision: event?.entityRevision,
      fromKey: event?.fromKey,
      toKey: event?.toKey,
      patch,
    });

    debugLanFlow('PLAYER_EFFECT_BATCH_RECEIVED', {
      eventId: event?.id,
      sessionId: event?.sessionId,
      fromKey: event?.fromKey,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });
    debugLanFlow('PLAYER_EFFECT_PATCH_APPLY_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });

    traceSqlite('SQLITE_READ_START', {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      functionName: 'applyLanEffectPatchToCharacter',
      table: 'characters',
      operation: 'READ_ACTIVE_EFFECTS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
    });
    const current = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT active_effects_json FROM characters WHERE id = ?`,
      [Number(currentCharacter.id)]
    );
    traceSqlite('SQLITE_READ_DONE', {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      functionName: 'applyLanEffectPatchToCharacter',
      table: 'characters',
      operation: 'READ_ACTIVE_EFFECTS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      result: current,
    });

    const currentEffects = safeJsonParse<any[]>((current as any)?.active_effects_json, []);
    const removeSet = new Set((patch.remove || []).map(String));
    const byId = new Map<string, any>();

    for (const effect of currentEffects) {
      const id = String(effect?.id || '');
      const lanEffectId = String(effect?.lanEffectId || effect?.lanEffectID || '');
      if (id && !removeSet.has(id) && !removeSet.has(lanEffectId)) byId.set(id, effect);
    }

    for (const effect of patch.update || []) {
      const id = String((effect as any)?.id || '');
      if (id && !removeSet.has(id)) {
        byId.set(id, markLanEffectForLocalCharacter(effect, event));
      }
    }

    for (const effect of patch.add || []) {
      const id = String((effect as any)?.id || '');
      if (!id || removeSet.has(id)) continue;

      // Se havia um efeito otimista local do mesmo item/alvo, substitui pelo efeito autoritativo do Host.
      for (const [existingId, existing] of Array.from(byId.entries())) {
        const isOptimisticLocal = String(existingId).startsWith('local_') || String(existingId).startsWith('pending_item_');
        const sameEffect =
          String(existing?.source || '') === String((effect as any)?.source || '') &&
          String(existing?.name || '') === String((effect as any)?.name || '') &&
          String(existing?.target || '') === String((effect as any)?.target || '') &&
          Number(existing?.value || 0) === Number((effect as any)?.value || 0);

        if (isOptimisticLocal && sameEffect) byId.delete(existingId);
      }

      byId.set(id, markLanEffectForLocalCharacter(effect, event));
    }

    const nextEffects = Array.from(byId.values());
    traceStateChange('STATE_CHANGE', 'PLAYER_CHARACTER_EFFECT_PATCH_COMPUTED', {
      effectCount: currentEffects.length,
      effects: currentEffects,
    }, {
      effectCount: nextEffects.length,
      effects: nextEffects,
    }, {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      seq: event?.seq,
      entityRevision: event?.entityRevision,
      patch,
    });

    setCharacter((prev: any) => prev ? ({ ...prev, active_effects: nextEffects, active_effects_json: JSON.stringify(nextEffects) }) : prev);
    debugLanFlow('PLAYER_RUNTIME_PATCH_APPLIED', {
      eventId: event?.id,
      type: event?.type,
      characterId: currentCharacter.id,
      effectCount: nextEffects.length,
    });
    debugLanFlow('PLAYER_EFFECT_TICK_APPLIED_ONCE', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      effectCount: nextEffects.length,
      removeCount: patch.remove?.length || 0,
    });
    debugLanFlow('PLAYER_SQLITE_PERSIST_START', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      field: 'active_effects_json',
    });

    traceSqlite('SQLITE_WRITE_START', {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      functionName: 'applyLanEffectPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_ACTIVE_EFFECTS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      before: currentEffects,
      after: nextEffects,
      patch,
    });
    await db.runAsync(
      `UPDATE characters SET active_effects_json = ? WHERE id = ?`,
      [JSON.stringify(nextEffects), Number(currentCharacter.id)]
    );
    traceSqlite('SQLITE_WRITE_DONE', {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      functionName: 'applyLanEffectPatchToCharacter',
      table: 'characters',
      operation: 'UPDATE_ACTIVE_EFFECTS',
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      result: { effectCount: nextEffects.length },
    });
    debugLanFlow('PLAYER_SQLITE_PERSIST_DONE', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      field: 'active_effects_json',
    });

    setCharacter((prev: any) => prev ? ({ ...prev, active_effects: nextEffects, active_effects_json: JSON.stringify(nextEffects) }) : prev);
    debugLanFlow('PLAYER_EFFECT_PATCH_APPLY_DONE', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      effectCount: nextEffects.length,
    });
    debugLanFlow('PLAYER_EFFECT_BATCH_APPLIED', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      effectCount: nextEffects.length,
      addCount: patch.add?.length || 0,
      updateCount: patch.update?.length || 0,
      removeCount: patch.remove?.length || 0,
    });
    debugLanFlow('PLAYER_STAT_EFFECT_UI_RECALCULATED', {
      eventId: event?.id,
      characterId: currentCharacter.id,
      bonuses: summarizeStatEffectBonuses(nextEffects),
    });
    traceApp('UI_UPDATE', 'CHARACTER_SHEET_EFFECTS_UPDATED', {
      screen: 'sheet',
      source: 'applyLanEffectPatchToCharacter',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      eventType: event?.type,
      before: { effectCount: currentEffects.length },
      after: { effectCount: nextEffects.length },
      patch,
    });
    traceFunctionReturn('applyLanEffectPatchToCharacter', {
      effectCount: nextEffects.length,
    }, {
      screen: 'sheet',
      source: 'event_commit',
      sessionId: event?.sessionId,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      eventId: event?.id,
      durationMs: Date.now() - startedAt,
    });
  }, [db]);

  const clearLanSessionEffectsFromCharacter = useCallback(async (sessionValue: string) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;

    debugLanFlow('PLAYER_KICKED_CLEAN_LAN_EFFECTS_START', {
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      sessionId: sessionValue,
    });

    const current = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT active_effects_json FROM characters WHERE id = ?`,
      [Number(currentCharacter.id)]
    );
    const effects = safeJsonParse<any[]>((current as any)?.active_effects_json, []);
    const nextEffects = effects.filter((effect) => {
      const effectSessionId = String(effect?.sessionId || '');
      const isLanSessionEffect =
        (String(effect?.origin || '') === 'lan' && effectSessionId === sessionValue) ||
        (String(effect?.sourceType || '') === 'lan_session' && effectSessionId === sessionValue) ||
        (Boolean(effect?.lanEventId) && effectSessionId === sessionValue);
      return !isLanSessionEffect;
    });

    await db.runAsync(
      `UPDATE characters SET active_effects_json = ? WHERE id = ?`,
      [JSON.stringify(nextEffects), Number(currentCharacter.id)]
    );
    setCharacter((prev: any) => prev ? ({
      ...prev,
      active_effects: nextEffects,
      active_effects_json: JSON.stringify(nextEffects),
    }) : prev);

    debugLanFlow('PLAYER_KICKED_CLEAN_LAN_EFFECTS_DONE', {
      characterId: currentCharacter.id,
      sessionId: sessionValue,
      removedCount: effects.length - nextEffects.length,
      remainingCount: nextEffects.length,
    });
  }, [db]);

  const applyLanInventoryPatchToCharacter = useCallback(async (patch: LanSessionEvent['inventoryPatch']) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !patch?.equipment) return;

    const nextEquipment = normalizeSheetEquipment(patch.equipment);

    await db.runAsync(
      `UPDATE characters SET equipment = ? WHERE id = ?`,
      [JSON.stringify(nextEquipment), Number(currentCharacter.id)]
    );

    setCharacter((prev: any) => prev ? ({ ...prev, equipment: nextEquipment }) : prev);
  }, [db]);

  const terminateLanSessionFromMaster = useCallback(async (
    sessionValue: string,
    source: string,
    event?: LanSessionEvent,
  ) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter?.id || !sessionValue) return;
    const selfKey = makeLanCharacterKey(sessionValue, currentCharacter);

    sessionTerminatedRef.current = sessionValue;
    traceApp('LAN_JOIN', 'PLAYER_TERMINATION_FLAG_SET', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
      eventId: event?.id,
      eventType: event?.type,
    });

    if (event) {
      await rememberLanSessionEvent(db, event).catch(() => false);
    }
    await clearLanSessionEffectsFromCharacter(sessionValue);
    debugLanFlow('PLAYER_CLEAR_TEMP_SESSION_EFFECTS', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_PRESERVE_OFFICIAL_REWARDS', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    await unlinkCharacterFromLanSession(db, Number(currentCharacter.id), sessionValue).catch(() => {});
    debugLanFlow('PLAYER_LAN_BINDING_ENDED', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_CHARACTER_UNLINKED_FROM_SESSION', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    debugLanFlow('PLAYER_KEEP_CHARACTER_OFFLINE', {
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      selfKey,
    });
    await markLanConnectionStatus(db, {
      sessionId: sessionValue,
      deviceId: selfKey,
      role: 'player',
      playerKey: selfKey,
      status: 'offline',
    }).catch(() => {});
    await db.runAsync(
      `UPDATE lan_sessions
       SET status = 'ended', active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND COALESCE(is_master, 0) = 0`,
      [sessionValue]
    ).catch(() => {});

    useLanRealtimeStore.getState().resetSession();
    resetLanClientConnection();
    traceApp('LAN_JOIN', 'PLAYER_STOP_POLLING_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    debugLanFlow('PLAYER_STOP_RESYNC_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    debugLanFlow('PLAYER_STOP_HEARTBEAT_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    setLanInfo(null);
    setLanSessionStatus(null);
    setLanPlayers([]);
    setIncomingTrades([]);
    traceApp('LAN_JOIN', 'PLAYER_LAN_INFO_CLEARED', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    traceApp('NAVIGATION', 'PLAYER_NAVIGATE_HOME_AFTER_END', {
      screen: 'sheet',
      source,
      sessionId: sessionValue,
      characterId: currentCharacter.id,
      characterName: currentCharacter.name,
      playerKey: selfKey,
    });
    router.replace('/' as any);
  }, [clearLanSessionEffectsFromCharacter, db, router]);

  const syncLanFromHost = useCallback(async () => {
    if (!lanInfo?.sessionId || !character?.id) return;
    if (sessionTerminatedRef.current === lanInfo.sessionId) {
      traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
        screen: 'sheet',
        source: 'syncLanFromHost',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
      });
      return;
    }

    const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
    const startedAt = Date.now();
    traceFunctionCall('syncLanFromHost', {
      lanInfo,
      selfKey,
    }, {
      screen: 'sheet',
      source: 'foreground_resync',
      sessionId: lanInfo.sessionId,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });

    try {
      const localInfo = await getLocalLanSessionForCharacter(db, Number(character.id));
      const recovered = await fetchLanPayloadWithRecovery(lanInfo, localInfo?.payloadJson);
      const nextPayload = recovered.payload;
      const nextInfo = {
        ...recovered.info,
        hostInstanceId: nextPayload.session.hostInstanceId,
      };

      if (lanInfo.hostInstanceId && nextInfo.hostInstanceId && nextInfo.hostInstanceId !== lanInfo.hostInstanceId) {
        traceApp('LAN_JOIN', 'PLAYER_HOST_INSTANCE_CHANGED_BOOTSTRAP', {
          screen: 'sheet',
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          before: { hostInstanceId: lanInfo.hostInstanceId },
          after: { hostInstanceId: nextInfo.hostInstanceId },
        });
        useLanRealtimeStore.getState().resetSession(nextInfo.sessionId);
      }
      if (nextInfo.joinUrl !== lanInfo.joinUrl || nextInfo.hostInstanceId !== lanInfo.hostInstanceId) {
        setLanInfo(nextInfo);
      }

      // Payload completo é cache estrutural. Salva para entrada/resync, mas não aplica
      // HP/XP/moedas/efeitos/inventário por snapshot durante sessão viva.
      await saveLanSession(db, nextPayload, nextInfo.joinUrl, { isMaster: false });
      traceApp('PAYLOAD_RECEIVED', 'PLAYER_SNAPSHOT_LIVE_FIELDS_IGNORED', {
        screen: 'sheet',
        source: 'syncLanFromHost',
        sessionId: nextInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        status: nextPayload.state?.status,
        playerCount: nextPayload.state?.players?.length || 0,
      });

      if (nextPayload.state?.status === 'ended') {
        debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
          source: 'syncLanFromHost_payload_status',
          sessionId: nextInfo.sessionId,
          selfKey,
          status: nextPayload.state.status,
        });
        await terminateLanSessionFromMaster(nextInfo.sessionId, 'syncLanFromHost');
        return;
      }

      if (nextPayload.state?.status === 'paused') {
        setLanSessionStatus('paused');
        setLanPlayers(getPublicLanPlayers(nextPayload, selfKey));
        debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          selfKey,
        });
        debugLanFlow('PLAYER_KEEP_BINDING_AFTER_PAUSE', {
          source: 'syncLanFromHost',
          sessionId: nextInfo.sessionId,
          selfKey,
        });
        return;
      }

      const officialSelf = nextPayload.state?.players?.find((player) => (
        player.remoteKey === selfKey ||
        player.sourceCharacterId === Number(character.id) ||
        player.characterName === character.name
      ));

      const localLevel = Number(character.level) || 1;
      const officialLevel = Number(officialSelf?.level || 1);
      const localXp = Number(character.xp) || 0;
      const officialXp = Number(officialSelf?.xp || 0);
      const expectedLocalLevel = await getExpectedLevelForXpFromDb(db, Math.max(localXp, officialXp));
      const needsLevelReview = localLevel > officialLevel && localLevel <= expectedLocalLevel;

      if (!officialSelf || needsLevelReview) {
        await notifyMasterReconnect(nextPayload, nextInfo, character, {
          reviewSnapshot: needsLevelReview,
          force: needsLevelReview,
        });
      }

      setLanSessionStatus(nextPayload.state?.status || null);
      setLanPlayers(getPublicLanPlayers(nextPayload, selfKey));

      await markLanConnectionStatus(db, {
        sessionId: nextInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'online',
      }).catch(() => {});

      await requestLanSessionResync(nextInfo.joinUrl, {
        sessionId: nextInfo.sessionId,
        playerKey: selfKey,
        lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        knownRevisions: getKnownLanEntityRevisions(nextInfo.sessionId),
      }).catch(() => {});
      traceFunctionReturn('syncLanFromHost', {
        sessionId: nextInfo.sessionId,
        playerCount: nextPayload.state?.players?.length || 0,
        status: nextPayload.state?.status,
      }, {
        screen: 'sheet',
        source: 'foreground_resync',
        sessionId: nextInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await markLanConnectionStatus(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'offline',
      }).catch(() => {});
      console.warn('[LAN] Não foi possível re-sincronizar com o mestre:', error);
      traceError('RESYNC_REQUEST', 'SYNC_LAN_FROM_HOST_ERROR', error, {
        screen: 'sheet',
        source: 'foreground_resync',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        durationMs: Date.now() - startedAt,
      });
    }
  }, [db, lanInfo, character?.id, character?.name, character?.level, character?.xp, fetchLanPayloadWithRecovery, notifyMasterReconnect, terminateLanSessionFromMaster]);

  useLanRealtimePlayerPatches({
    enabled: Boolean(
      character &&
      lanInfo?.sessionId &&
      lanInfo?.joinUrl &&
      lanSessionStatus !== 'paused' &&
      sessionTerminatedRef.current !== lanInfo.sessionId
    ),
    joinUrl: lanInfo?.joinUrl,
    sessionId: lanInfo?.sessionId,
    selfKey: lanInfo?.sessionId && character
      ? makeLanCharacterKey(lanInfo.sessionId, character)
      : '',
    characterName: character?.name,
    paused: lanSessionStatus === 'paused',
    onNumberPatch: async (patch, event) => {
      traceFunctionCall('useLanRealtimePlayerPatches.onNumberPatch', { patch, event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        eventId: event.id,
        eventType: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch,
      });
      debugLanFlow('PLAYER_PATCH_RECEIVED', {
        eventId: event.id,
        seq: event.seq,
        serverSeq: event.serverSeq,
        entityRevision: event.entityRevision,
        toKey: event.toKey,
        toName: event.toName,
        patch,
      });
      const stored = await rememberLanSessionEvent(db, event).catch(() => false);
      if (!stored) {
        debugLanFlow('PLAYER_EVENT_DECISION', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          reason: 'stored_duplicate_but_apply_needed',
          apply: true,
        });
      }
      const nextValues = await applyLanNumberPatchToCharacter(patch, event);
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        lastAuthoritativePlayerPatchRef.current = {
          seq: Number(event.seq ?? event.serverSeq ?? 0) || lastAuthoritativePlayerPatchRef.current.seq,
          entityRevision: Number(event.entityRevision || 0) || lastAuthoritativePlayerPatchRef.current.entityRevision,
          appliedAt: Date.now(),
        };
        if (nextValues) {
          updateSelfLanBarFromAuthoritativePatch(lanInfo.sessionId, nextValues, event);
        }
        await markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        });
      }
    },
    onEffectPatch: async (patch, event) => {
      if (!patch) {
        debugLanFlow('PLAYER_EFFECT_PATCH_SKIPPED_EMPTY_PATCH', {
          eventId: event.id,
          seq: event.seq,
          entityRevision: event.entityRevision,
          eventType: event.type,
        });
        return;
      }

      const effectPatch = patch;

      traceFunctionCall('useLanRealtimePlayerPatches.onEffectPatch', { patch: effectPatch, event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        eventId: event.id,
        eventType: event.type,
        seq: event.seq,
        entityRevision: event.entityRevision,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch: effectPatch,
      });
      const stored = await rememberLanSessionEvent(db, event).catch(() => false);
      if (!stored) {
        debugLanFlow('PLAYER_EVENT_DECISION', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          reason: 'stored_duplicate_but_apply_needed',
          apply: true,
        });
      }
      await applyLanEffectPatchToCharacter(effectPatch, event);
      debugLanFlow('PLAYER_EFFECT_PATCH_APPLIED', {
        eventId: event.id,
        seq: event.seq,
        entityRevision: event.entityRevision,
        addCount: effectPatch.add?.length || 0,
        updateCount: effectPatch.update?.length || 0,
        removeCount: effectPatch.remove?.length || 0,
      });
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        await markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        });
      }
    },
    onInventoryPatch: async (patch, event) => {
      debugLanFlow('PLAYER_INVENTORY_PATCH_RECEIVED', {
        eventId: event.id,
        seq: event.seq,
        serverSeq: event.serverSeq,
        entityRevision: event.entityRevision,
        action: patch.action,
        targetKey: patch.targetKey,
        reason: patch.reason,
      });
      const fresh = await rememberLanSessionEvent(db, event);
      if (!fresh) {
        debugLanFlow('PLAYER_INVENTORY_PATCH_DUPLICATE_IGNORED', {
          eventId: event.id,
          seq: event.seq,
          entityRevision: event.entityRevision,
        });
        return;
      }
      await applyLanInventoryPatchToCharacter(patch);
      debugLanFlow(
        patch.action === 'grant' ? 'PLAYER_GRANTED_ITEM_APPLIED' : 'PLAYER_INVENTORY_PATCH_APPLIED',
        {
          eventId: event.id,
          seq: event.seq,
          entityRevision: event.entityRevision,
          action: patch.action,
          reason: patch.reason,
        }
      );
      if (lanInfo?.sessionId && character) {
        const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
        await markLanEventsApplied(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          events: [event],
        });
      }
    },
    onEvent: async (event) => {
      if (!lanInfo?.sessionId) return;
      await handleLanEvents([event], lanInfo.sessionId);
    },
    onSessionPatch: async (event) => {
      if (!character || !lanInfo?.sessionId) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      debugLanFlow('PLAYER_SESSION_PATCH_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        eventType: event.type,
        selfKey,
        status: event.sessionPatch?.status,
      });
      traceApp('EVENT_RECEIVED', 'PLAYER_SESSION_PATCH_RECEIVED', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onSessionPatch',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        eventId: event.id,
        eventType: event.type,
        status: event.sessionPatch?.status,
      });

      if (!isLanSessionEndedEvent(event)) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        const status = event.sessionPatch?.status;
        if (status === 'paused' || status === 'active') {
          setLanSessionStatus(status);
          await db.runAsync(
            `UPDATE lan_sessions
             SET status = ?, active = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND COALESCE(is_master, 0) = 0`,
            [status, lanInfo.sessionId]
          ).catch(() => {});
          if (status === 'paused') {
            debugLanFlow('PLAYER_SESSION_PAUSED_RECEIVED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_SET_READ_ONLY_MODE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_KEEP_BINDING_AFTER_PAUSE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_SHOW_PAUSED_SESSION_ALERT', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            showCustomAlert(
              'Sessao pausada pelo mestre',
              'A campanha continuara depois. Sua ficha ficara em modo leitura ate o mestre retomar.'
            );
          } else {
            debugLanFlow('PLAYER_SESSION_RESUMED_RECEIVED', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_RECONNECT_TO_RESUMED_SESSION', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_EXIT_READ_ONLY_MODE', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            debugLanFlow('PLAYER_REUSE_EXISTING_BINDING_AFTER_RESUME', {
              eventId: event.id,
              sessionId: lanInfo.sessionId,
              selfKey,
            });
            if (event.sessionPatch?.hostInstanceId) {
              setLanInfo((current) => current ? ({ ...current, hostInstanceId: event.sessionPatch?.hostInstanceId }) : current);
            }
            await requestLanSessionResync(lanInfo.joinUrl, {
              sessionId: lanInfo.sessionId,
              playerKey: selfKey,
              lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
              knownRevisions: getKnownLanEntityRevisions(lanInfo.sessionId),
            }).catch(() => {});
          }
          debugLanFlow(status === 'paused' ? 'PLAYER_SESSION_PAUSED' : 'PLAYER_SESSION_RESUMED', {
            eventId: event.id,
            sessionId: lanInfo.sessionId,
            selfKey,
          });
          traceApp('STATE_CHANGE', status === 'paused' ? 'PLAYER_SESSION_PAUSED' : 'PLAYER_SESSION_RESUMED', {
            screen: 'sheet',
            source: 'useLanRealtimePlayerPatches.onSessionPatch',
            sessionId: lanInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
            playerKey: selfKey,
            eventId: event.id,
            status,
          });
        }
        return;
      }

      debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        eventType: event.type,
        selfKey,
      });
      await terminateLanSessionFromMaster(lanInfo.sessionId, 'useLanRealtimePlayerPatches.onSessionPatch', event);
    },
    onKicked: async (event) => {
      if (!character || !lanInfo?.sessionId) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      traceFunctionCall('useLanRealtimePlayerPatches.onKicked', { event }, {
        screen: 'sheet',
        source: 'event_commit',
        sessionId: event.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });

      debugLanFlow('PLAYER_KICKED_RECEIVED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        selfKey,
        toKey: event.toKey,
        toName: event.toName,
      });

      await rememberLanSessionEvent(db, event).catch(() => false);
      await clearLanSessionEffectsFromCharacter(lanInfo.sessionId);
      await unlinkCharacterFromLanSession(db, Number(character.id), lanInfo.sessionId);
      debugLanFlow('PLAYER_UNLINK_DONE', {
        characterId: character.id,
        sessionId: lanInfo.sessionId,
        selfKey,
      });
      await markLanEventsApplied(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        events: [event],
      });
      debugLanFlow('PLAYER_KICKED_RUNTIME_APPLIED', {
        eventId: event.id,
        sessionId: lanInfo.sessionId,
        selfKey,
      });
      useLanRealtimeStore.getState().resetSession();
      resetLanClientConnection();
      setLanInfo(null);
      setLanSessionStatus(null);
      setLanPlayers([]);
      setIncomingTrades([]);

      showCustomAlert(
        'Removido da sessão',
        event.message || 'O mestre removeu este personagem da sessão LAN.',
        [{ text: 'OK', color: appColors.primary, onPress: () => router.replace(`/sheet?id=${character.id}` as any) }]
      );
    },
    onHostUnreachable: async (reason: string) => {
      if (!character || !lanInfo?.sessionId) return;
      const selfKey = makeLanCharacterKey(lanInfo.sessionId, character);
      if (lanSessionStatus === 'paused') {
        await markLanConnectionStatus(db, {
          sessionId: lanInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          status: 'offline',
        }).catch(() => {});
        debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
          screen: 'sheet',
          source: 'useLanRealtimePlayerPatches.onHostUnreachable',
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          reason,
        });
        debugLanFlow('PLAYER_KEEP_BINDING_AFTER_PAUSE', {
          screen: 'sheet',
          source: 'useLanRealtimePlayerPatches.onHostUnreachable',
          sessionId: lanInfo.sessionId,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          reason,
        });
        return;
      }
      traceApp('LAN_JOIN', 'PLAYER_SESSION_ENDED_CLEANUP_START', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onHostUnreachable',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        reason,
      });
      sessionTerminatedRef.current = lanInfo.sessionId;
      await markLanConnectionStatus(db, {
        sessionId: lanInfo.sessionId,
        deviceId: selfKey,
        role: 'player',
        playerKey: selfKey,
        status: 'offline',
      }).catch(() => {});
      useLanRealtimeStore.getState().resetSession();
      resetLanClientConnection();
      setLanInfo(null);
      setLanSessionStatus(null);
      setLanPlayers([]);
      setIncomingTrades([]);
      traceApp('LAN_JOIN', 'PLAYER_SESSION_ENDED_CLEANUP_DONE', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches.onHostUnreachable',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        playerKey: selfKey,
        reason,
      });
      showCustomAlert(
        'Mestre desconectado',
        'Nao consegui reconectar ao mestre. A sessao pode ter sido encerrada.',
        [{ text: 'OK', color: appColors.primary, onPress: () => router.replace(`/sheet?id=${character.id}` as any) }]
      );
    },
  });

  useLanAppLifecycle({
    enabled: Boolean(
      character &&
      lanInfo?.sessionId &&
      lanInfo?.joinUrl &&
      sessionTerminatedRef.current !== lanInfo.sessionId
    ),
    onBackground: async () => {
      resetLanClientConnection();
    },
    onForeground: async () => {
      if (lanInfo?.sessionId && sessionTerminatedRef.current === lanInfo.sessionId) {
        traceApp('LAN_JOIN', 'PLAYER_STOP_FOREGROUND_RECOVERY_AFTER_END', {
          screen: 'sheet',
          source: 'useLanAppLifecycle.onForeground',
          sessionId: lanInfo.sessionId,
          characterId: character?.id,
          characterName: character?.name,
        });
        return;
      }
      resetLanClientConnection();
      await syncLanFromHost();
    },
  });

  const getSelfLanKey = (sessionValue?: string) => {
    if (!character || !sessionValue) return '';
    return makeLanCharacterKey(sessionValue, character);
  };

  const makeTradeItem = (item: any, qty: number): LanTradeItem => {
    const hydrated = hydrateInventoryItemForEffects(item);
    return {
      name: String(hydrated.name || 'Item'),
      qty: Math.max(1, Math.min(Number(hydrated.qty) || 1, qty)),
      weight: Number(hydrated.weight) || 0,
      damage: hydrated.damage,
      damage_type: hydrated.damage_type,
      properties: hydrated.properties,
      descricao: hydrated.descricao,
      effect_json: hydrated.effect_json,
      duration_value: hydrated.duration_value,
      duration_unit: hydrated.duration_unit,
      effect_hidden: getItemEffectHidden(hydrated) ? 1 : 0,
      effectHidden: getItemEffectHidden(hydrated),
      hiddenEffect: getItemEffectHidden(hydrated),
    } as LanTradeItem & { effect_hidden?: number; effectHidden?: boolean; hiddenEffect?: boolean };
  };

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
      const hydratedTradeItem = hydrateInventoryItemForEffects(tradeItem);
      nextBag[existingIndex] = {
        ...hydratedTradeItem,
        ...nextBag[existingIndex],
        qty: (Number(nextBag[existingIndex].qty) || 0) + tradeItem.qty,
        damage: nextBag[existingIndex].damage || hydratedTradeItem.damage,
        damage_type: nextBag[existingIndex].damage_type || hydratedTradeItem.damage_type,
        properties: nextBag[existingIndex].properties || hydratedTradeItem.properties,
        descricao: nextBag[existingIndex].descricao || hydratedTradeItem.descricao,
        effect_json: nextBag[existingIndex].effect_json || hydratedTradeItem.effect_json,
        duration_value: nextBag[existingIndex].duration_value ?? hydratedTradeItem.duration_value,
        duration_unit: nextBag[existingIndex].duration_unit ?? hydratedTradeItem.duration_unit,
        effect_hidden: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem),
        hiddenEffect: getItemEffectHidden(nextBag[existingIndex], hydratedTradeItem),
      };
    } else {
      const hydratedTradeItem = hydrateInventoryItemForEffects(tradeItem);
      nextBag.push({
        ...hydratedTradeItem,
        effect_hidden: getItemEffectHidden(hydratedTradeItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(hydratedTradeItem),
        hiddenEffect: getItemEffectHidden(hydratedTradeItem),
      });
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

    if (isLanPlayerRuntime) {
      debugLanFlow('LAN_PLAYER_BLOCKED_DIRECT_SELF_HP', {
        characterId: character.id,
        amount,
        requestedHp: nextHp,
      });
      void notifyNumberPatch({ hpCurrent: nextHp }, `${character.name} solicitou alterar HP para ${nextHp}.`);
      return;
    }

    await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [nextHp, character.id]);
    setCharacter((prev: any) => ({ ...prev, hp_current: nextHp }));
    notifyOwnLanStatus(nextHp, character.hp_max);
  };

  const applySpellEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.spellEffect) return;
    const target = event.spellEffect.target || 'custom';
    const value = Number(event.spellEffect.value || 0);

    const valueText = target !== 'custom' && value !== 0 ? `: ${target} ${value > 0 ? '+' : ''}${value}` : '';
    showCustomAlert('Efeito recebido', `${event.fromName} aplicou ${event.spellEffect.spellName}${valueText}.`);
  };

  const applyExpiredEffectToSelf = async (event: LanSessionEvent) => {
    if (!character || !event.expiredEffect) return;
    const effect = event.expiredEffect;
    showCustomAlert('Efeito encerrado', event.message || `${effect.name} acabou.`);
  };

  const handleLanEvents = async (events: LanSessionEvent[], sessionValue: string) => {
    if (!character) return;
    const selfKey = getSelfLanKey(sessionValue);
    traceFunctionCall('handleLanEvents', {
      eventCount: events.length,
      sessionValue,
      eventTypes: events.map((event) => event.type),
    }, {
      screen: 'sheet',
      source: 'handleLanEvents',
      sessionId: sessionValue,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });
    const isForMe = (event: LanSessionEvent) => event.toKey === selfKey || event.toName === character.name;
    const responses = new Set(events.filter((event) => ['trade_accept', 'trade_decline', 'trade_result'].includes(event.type)).map((event) => event.tradeId));
    const pendingOffers = events.filter((event) => event.type === 'trade_offer' && isForMe(event) && !responses.has(event.id));

    setIncomingTrades(pendingOffers);

    for (const event of events) {
      if (event.type === 'public_status' && event.publicState) {
        const statusTargetsSelf = event.fromKey === selfKey || event.fromName === character.name;
        if (statusTargetsSelf && isLanPlayerRuntime) {
          const lastPatch = lastAuthoritativePlayerPatchRef.current;
          debugLanFlow('PLAYER_PUBLIC_STATUS_SKIPPED_SELF', {
            eventId: event.id,
            fromKey: event.fromKey,
            fromName: event.fromName,
            selfKey,
          });
          debugLanFlow('PLAYER_PUBLIC_STATUS_IGNORED_STALE', {
            eventId: event.id,
            fromKey: event.fromKey,
            fromName: event.fromName,
            selfKey,
            seq: event.seq,
            serverSeq: event.serverSeq,
            entityRevision: event.entityRevision,
            lastPatchSeq: lastPatch.seq,
            lastPatchRevision: lastPatch.entityRevision,
            lastPatchAgeMs: lastPatch.appliedAt ? Date.now() - lastPatch.appliedAt : null,
          });
          continue;
        }
        setLanPlayers((current) => current.map((player) => (
          player.key === event.fromKey || player.characterName === event.fromName
            ? { ...player, hpCurrent: event.publicState!.hpCurrent, hpMax: event.publicState!.hpMax, tempHp: event.publicState!.tempHp || player.tempHp, level: event.publicState!.level }
            : player
        )));
        traceApp('PUBLIC_STATUS_APPLIED', 'PLAYER_PUBLIC_STATUS_APPLIED_TO_BAR', {
          screen: 'sheet',
          source: 'handleLanEvents',
          sessionId: sessionValue,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          fromKey: event.fromKey,
          payload: event.publicState,
        });
        continue;
      }

      if (!isForMe(event)) {
        traceApp('EVENT_IGNORED', 'HANDLE_LAN_EVENTS_WRONG_TARGET', {
          screen: 'sheet',
          source: 'handleLanEvents',
          sessionId: sessionValue,
          characterId: character.id,
          characterName: character.name,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          fromKey: event.fromKey,
          toKey: event.toKey,
          reason: 'wrong_target',
        });
        continue;
      }

      if (event.type === 'player_patch' && event.numberPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        debugLanFlow('PLAYER_PATCH_RECEIVED', {
          eventId: event.id,
          seq: event.seq,
          serverSeq: event.serverSeq,
          entityRevision: event.entityRevision,
          toKey: event.toKey,
          toName: event.toName,
          patch: event.numberPatch,
        });
        const nextValues = await applyLanNumberPatchToCharacter(event.numberPatch, event);
        lastAuthoritativePlayerPatchRef.current = {
          seq: Number(event.seq ?? event.serverSeq ?? 0) || lastAuthoritativePlayerPatchRef.current.seq,
          entityRevision: Number(event.entityRevision || 0) || lastAuthoritativePlayerPatchRef.current.entityRevision,
          appliedAt: Date.now(),
        };
        if (nextValues) updateSelfLanBarFromAuthoritativePatch(sessionValue, nextValues, event);

        continue;
      }

      if (event.type === 'player_patch' && event.statsPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        debugLanFlow('PLAYER_STATS_PATCH_RECEIVED', {
          eventId: event.id,
          seq: event.seq,
          serverSeq: event.serverSeq,
          entityRevision: event.entityRevision,
          toKey: event.toKey,
          toName: event.toName,
          patch: event.statsPatch,
        });
        await updateDB(
          { stats: event.statsPatch },
          { allowLanAuthoritativeCache: true, reason: 'lan_authoritative_stats_patch' }
        );
        continue;
      }

      if (event.type === 'player_kicked') {
        debugLanFlow('PLAYER_KICKED_RECEIVED', {
          eventId: event.id,
          sessionId: sessionValue,
          selfKey,
          toKey: event.toKey,
          toName: event.toName,
        });
        await rememberLanSessionEvent(db, event).catch(() => false);
        await clearLanSessionEffectsFromCharacter(sessionValue);
        await unlinkCharacterFromLanSession(db, Number(character.id), sessionValue);
        debugLanFlow('PLAYER_UNLINK_DONE', {
          characterId: character.id,
          sessionId: sessionValue,
          selfKey,
        });
        debugLanFlow('PLAYER_KICKED_RUNTIME_APPLIED', {
          eventId: event.id,
          sessionId: sessionValue,
          selfKey,
        });
        useLanRealtimeStore.getState().resetSession();
        resetLanClientConnection();
        setLanInfo(null);
        setLanSessionStatus(null);
        setLanPlayers([]);
        setIncomingTrades([]);
        showCustomAlert(
          'Removido da sessao',
          event.message || 'O mestre removeu este personagem da sessao LAN.',
          [{ text: 'OK', color: appColors.primary, onPress: () => router.replace(`/sheet?id=${character.id}` as any) }]
        );
        continue;
      }

      if (event.type === 'resource_review') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          showCustomAlert('Resposta do mestre', event.message || 'O mestre revisou seu pedido.');
        }
        continue;
      }

      if (event.type === 'effect_save_request' && event.saveRequest) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          debugLanFlow('PLAYER_EFFECT_SAVE_REQUEST_RECEIVED', {
            eventId: event.id,
            requestId: event.saveRequest.id,
            sourceEffectName: event.saveRequest.sourceEffectName,
            saveAbility: event.saveRequest.saveAbility,
            dc: event.saveRequest.dc,
          });
          setPendingEffectSave(event.saveRequest);
          setSaveManualValue('');
        }
        continue;
      }

      if (
        event.type === 'action_result' ||
        event.type === 'skill_result' ||
        event.type === 'spell_cast_result' ||
        event.type === 'ability_use_result'
      ) {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          const accepted = event.actionResult?.status === 'accepted';
          showCustomAlert(
            accepted ? 'Acao confirmada' : 'Acao recusada',
            event.actionResult?.reason || event.message || (accepted ? 'O mestre confirmou a acao.' : 'O mestre recusou a acao.')
          );
        }
        continue;
      }

      if (event.type === 'send_item_result') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          const accepted = event.sendItemResult?.status === 'accepted';
          showCustomAlert(
            accepted ? 'Envio confirmado' : 'Envio recusado',
            event.sendItemResult?.reason || event.message || (accepted ? 'O mestre confirmou o envio.' : 'O mestre recusou o envio.')
          );
        }
        continue;
      }

      if (event.type === 'trade_result') {
        const fresh = await rememberLanSessionEvent(db, event);
        if (fresh) {
          setIncomingTrades((current) => current.filter((entry) => entry.id !== event.tradeId));
          if (selectedTradeOffer?.id === event.tradeId) setSelectedTradeOffer(null);
          const accepted = event.tradeResult?.status === 'accepted';
          showCustomAlert(
            accepted ? 'Troca confirmada' : 'Troca recusada',
            event.tradeResult?.reason || event.message || (accepted ? 'O mestre confirmou a troca.' : 'A troca nao foi concluida.')
          );
        }
        continue;
      }

      if (isLanSessionEndedEvent(event)) {
        debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
          source: 'handleLanEvents',
          eventId: event.id,
          sessionId: sessionValue,
          eventType: event.type,
          selfKey,
        });
        await terminateLanSessionFromMaster(sessionValue, 'handleLanEvents', event);
        continue;
      }

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

      if (event.type === 'effect_patch' && event.effectPatch) {
        await rememberLanSessionEvent(db, event).catch(() => false);
        await applyLanEffectPatchToCharacter(event.effectPatch, event);
      }

      if (event.type === 'effect_catalog_patch' && event.effectCatalogPatch) {
        await rememberLanSessionEvent(db, event);
      }

      if (event.type === 'pending_save_patch' && event.pendingSavePatch) {
        await rememberLanSessionEvent(db, event);
      }
    }

    await markLanEventsApplied(db, {
      sessionId: sessionValue,
      deviceId: selfKey,
      role: 'player',
      playerKey: selfKey,
      events,
    });
    traceFunctionReturn('handleLanEvents', {
      eventCount: events.length,
    }, {
      screen: 'sheet',
      source: 'handleLanEvents',
      sessionId: sessionValue,
      characterId: character.id,
      characterName: character.name,
      playerKey: selfKey,
    });
  };

  useEffect(() => {
    if (!character?.id) return;
    let active = true;

    const refreshLanMetadata = async () => {
      try {
        const localInfo = await getLocalLanSessionForCharacter(db, Number(character.id));
        const storedInfo = routeSessionId
          ? {
            sessionId: routeSessionId,
            joinUrl: routeJoinUrl || localInfo?.joinUrl || '',
            payloadJson: localInfo?.payloadJson,
          }
          : localInfo;

        if (!storedInfo?.sessionId) return;
        if (sessionTerminatedRef.current === storedInfo.sessionId) {
          traceApp('LAN_JOIN', 'PLAYER_STOP_PAYLOAD_RECOVERY_AFTER_END', {
            screen: 'sheet',
            source: 'refreshLanMetadata',
            sessionId: storedInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
          });
          return;
        }

        let nextInfo = {
          sessionId: storedInfo.sessionId,
          joinUrl: decodeParam(storedInfo.joinUrl || ''),
          hostInstanceId: undefined as string | undefined,
        };

        if (active) setLanInfo(nextInfo);

        let nextPayload: LanSessionPayload | null = null;
        let fetchedFreshPayload = false;

        try {
          const recovered = await fetchLanPayloadWithRecovery(nextInfo, (storedInfo as any).payloadJson);
          nextPayload = recovered.payload;
          fetchedFreshPayload = true;
          nextInfo = {
            ...recovered.info,
            hostInstanceId: nextPayload.session.hostInstanceId,
          };

          if (active) {
            setLanInfo((current) => {
              if (current?.hostInstanceId && nextInfo.hostInstanceId && current.hostInstanceId !== nextInfo.hostInstanceId) {
                traceApp('LAN_JOIN', 'PLAYER_HOST_INSTANCE_CHANGED_BOOTSTRAP', {
                  screen: 'sheet',
                  source: 'refreshLanMetadata',
                  sessionId: nextInfo.sessionId,
                  before: { hostInstanceId: current.hostInstanceId },
                  after: { hostInstanceId: nextInfo.hostInstanceId },
                });
                useLanRealtimeStore.getState().resetSession(nextInfo.sessionId);
              }
              return nextInfo;
            });
          }
          await saveLanSession(db, nextPayload, nextInfo.joinUrl, { isMaster: false });
          traceApp('PAYLOAD_RECEIVED', 'PLAYER_SNAPSHOT_LIVE_FIELDS_IGNORED', {
            screen: 'sheet',
            source: 'refreshLanMetadata',
            sessionId: nextInfo.sessionId,
            characterId: character.id,
            characterName: character.name,
            status: nextPayload.state?.status,
            playerCount: nextPayload.state?.players?.length || 0,
          });
        } catch {
          nextPayload = null;
        }

        if (!nextPayload && (storedInfo as any).payloadJson) {
          nextPayload = safeJsonParse<LanSessionPayload | null>((storedInfo as any).payloadJson, null);
        }

        if (!nextPayload || !active) return;

        const selfKey = makeLanCharacterKey(nextInfo.sessionId, character);
        setLanSessionStatus(nextPayload.state?.status || 'active');
        setLanPlayers(getPublicLanPlayers(nextPayload, selfKey));

        const isStillInSession = Boolean(nextPayload.state?.players?.some((player) => (
          player.remoteKey === selfKey ||
          player.sourceCharacterId === Number(character.id) ||
          player.characterId === Number(character.id) ||
          player.characterName === character.name
        )));

        const wasKicked = nextPayload.events?.some((event) => (
          event.type === 'player_kicked' &&
          (event.toKey === selfKey || event.toName === character.name)
        ));

        if (fetchedFreshPayload && (nextPayload.state?.status === 'ended' || (!isStillInSession && wasKicked))) {
          debugLanFlow('PLAYER_KICKED_RECEIVED', {
            source: 'payload_recovery',
            sessionId: nextInfo.sessionId,
            selfKey,
            wasKicked,
            status: nextPayload.state?.status,
          });
          await terminateLanSessionFromMaster(nextInfo.sessionId, 'payload_recovery');
          return;
        }

        // Snapshot/payload completo é apenas estrutural. Não aplique aqui HP/XP/moedas/efeitos/inventário.
        // Eventos vivos são aplicados por useLanRealtimePlayerPatches.
        debugLanFlow('PLAYER_SNAPSHOT_SKIPPED_LIVE_FIELDS', {
          sessionId: nextInfo.sessionId,
          selfKey,
          source: fetchedFreshPayload ? 'fresh_payload' : 'cached_payload',
        });
        const snapshotSeq = getLanPayloadSnapshotSeq(nextPayload);
        await markLanSnapshotApplied(db, {
          sessionId: nextInfo.sessionId,
          deviceId: selfKey,
          role: 'player',
          playerKey: selfKey,
          snapshotSeq,
        }).catch(() => {});

        if (fetchedFreshPayload && nextInfo.joinUrl && nextPayload.state?.status !== 'paused') {
          await requestLanSessionResync(nextInfo.joinUrl, {
            sessionId: nextInfo.sessionId,
            playerKey: selfKey,
            lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
            knownRevisions: getKnownLanEntityRevisions(nextInfo.sessionId),
          }).catch(() => {});
        } else if (nextPayload.state?.status === 'paused') {
          debugLanFlow('PLAYER_STOP_LIVE_SYNC_WHILE_PAUSED', {
            source: 'refreshLanMetadata',
            sessionId: nextInfo.sessionId,
            selfKey,
          });
        }
      } catch (error) {
        console.warn('[LAN] Refresh estrutural da sessão falhou:', error);
      }
    };

    void refreshLanMetadata();
    const timer = setInterval(refreshLanMetadata, 15000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [db, character?.id, character?.name, character?.level, character?.xp, routeSessionId, routeJoinUrl, fetchLanPayloadWithRecovery, terminateLanSessionFromMaster]);

  useEffect(() => {
    if (!routeSessionId) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/' as any);
      return true;
    });
    return () => subscription.remove();
  }, [routeSessionId, router]);

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
  const caLanEffect = getLanStatEffectBonus(character, 'CA');
  const armorClassTotal = baseCa + (addDes ? desMod : 0) + caTemp + caEquip + caLanEffect;
  const caSumBuffs = caTemp + caEquip + caLanEffect;
  const caColor = caSumBuffs > 0 ? appColors.success : (caSumBuffs < 0 ? appColors.danger : appColors.textPrimary);

  const expectedLevel = expectedLevelByXp;
  const isPendingLevelUp = expectedLevel > character.level;
  const xpTargetLabel = nextLevelXpRequired == null ? 'MAX' : String(nextLevelXpRequired);

  const checkProficiency = (idx: string, group: any[]) => group.includes(idx);
  const proficientSaves = dbSaves.filter((save: any) => checkProficiency(save.id, character.save_values));
  const proficientSkills = dbSkills.filter((skill: any) => checkProficiency(skill.id, character.skill_values));
  const getAbilityModifierForAbility = (ability: string) => {
    const normalized = String(ability || '').toUpperCase();
    const base = parseInt(character.stats?.[normalized]) || 10;
    const temp = parseInt(character.stats?.temp_mods?.[normalized]) || 0;
    const equip = parseInt(character.stats?.equip_mods?.[normalized]) || 0;
    return Math.floor(((base + temp + equip) - 10) / 2);
  };
  const getSaveModifierForAbility = (ability: string) => {
    const normalized = String(ability || '').toUpperCase();
    const abilityMod = getAbilityModifierForAbility(normalized);
    const save = dbSaves.find((entry: any) => String(entry.stat || '').toUpperCase() === normalized);
    const proficient = Boolean(save && checkProficiency(save.id, character.save_values));
    return abilityMod + (proficient ? profBonusChar : 0);
  };
  const isLanReadOnly = Boolean(lanInfo?.sessionId && lanSessionStatus && lanSessionStatus !== 'active');
  const activeVisualEffects = getVisibleEffects(character.active_effects);
  const activeConditionColor = getCurrentBreathColor(activeVisualEffects as any, effectFrame);
  const conditionFrameStyle = activeConditionColor
    ? { borderWidth: 3, borderColor: String(activeConditionColor) }
    : null;

  const handleSheetBack = () => {
    if (lanInfo?.sessionId || routeSessionId) {
      router.replace('/' as any);
      return;
    }
    router.back();
  };


  // ==============================================================================
  // 2. FUNÇÕES DE AÇÃO QUE UTILIZAM AS VARIÁVEIS ACIMA
  // ==============================================================================

  const updateDB = async (
    updates: Partial<any>,
    options?: { allowLanAuthoritativeCache?: boolean; reason?: string }
  ) => {
    try {
      if (!character?.id) return false;
      const before = {
        hp_current: character.hp_current,
        hp_max: character.hp_max,
        temp_hp: character.temp_hp,
        xp: character.xp,
        gp: character.gp,
        sp: character.sp,
        cp: character.cp,
        active_effects_json: character.active_effects_json,
        equipment: character.equipment,
      };
      traceFunctionCall('updateDB', { updates, options }, {
        screen: 'sheet',
        source: options?.reason || (isLanPlayerRuntime ? 'lan_player_update' : 'offline_update'),
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        patch: updates,
      });

      let nextUpdates = { ...updates };

      if (isLanPlayerRuntime && !options?.allowLanAuthoritativeCache) {
        const { safeUpdates, blockedUpdates } = splitLanPlayerAuthoritativeUpdates(nextUpdates);

        if (hasLanBlockedUpdates(blockedUpdates)) {
          debugLanFlow('LAN_PLAYER_BLOCKED_OFFLINE_UPDATE', {
            reason: options?.reason || 'offline_mutation_in_lan_player',
            blockedKeys: Object.keys(blockedUpdates),
            safeKeys: Object.keys(safeUpdates),
            characterId: character.id,
            characterName: character.name,
          });
        }

        nextUpdates = safeUpdates;
      }

      const entries = Object.entries(nextUpdates);
      if (entries.length === 0) return false;

      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      traceSqlite('SQLITE_WRITE_START', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        functionName: 'updateDB',
        table: 'characters',
        operation: 'UPDATE_CHARACTER',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        patch: nextUpdates,
      });
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => prev ? ({ ...prev, ...nextUpdates }) : prev);
      traceSqlite('SQLITE_WRITE_DONE', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        functionName: 'updateDB',
        table: 'characters',
        operation: 'UPDATE_CHARACTER',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        after: { ...before, ...nextUpdates },
        patch: nextUpdates,
      });
      traceApp('UI_UPDATE', 'CHARACTER_SHEET_SET_CHARACTER_FROM_UPDATE_DB', {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character.id,
        characterName: character.name,
        before,
        after: { ...before, ...nextUpdates },
      });
      return true;
    } catch (e) {
      console.error(e);
      traceError('SQLITE_WRITE_DONE', 'UPDATE_DB_ERROR', e, {
        screen: 'sheet',
        source: options?.reason || 'updateDB',
        mode: sheetRuntimeMode,
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        characterName: character?.name,
        patch: updates,
      });
      return false;
    }
  };

  const ensureLanWritable = () => {
    if (!isLanReadOnly) return true;
    showCustomAlert('Sessao em leitura', 'Esta sessao esta pausada ou encerrada. A ficha fica somente para consulta.');
    return false;
  };

  const isSheetActionSubmitting = (actionId: string) => submittingSheetActions.includes(actionId);
  const runSheetAction = async <T,>(actionId: string, task: () => Promise<T>): Promise<T | undefined> => {
    if (submittingSheetActionsRef.current.has(actionId)) {
      debugLanFlow('ACTION_SUBMIT_IGNORED_ALREADY_PENDING', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
      });
      return;
    }

    submittingSheetActionsRef.current.add(actionId);
    setSubmittingSheetActions((current) => current.includes(actionId) ? current : [...current, actionId]);
    debugLanFlow('ACTION_SUBMIT_STARTED', {
      screen: 'sheet',
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      actionId,
    });
    try {
      const result = await task();
      debugLanFlow('ACTION_SUBMIT_DONE', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
      });
      return result;
    } catch (error) {
      debugLanFlow('ACTION_SUBMIT_FAILED', {
        screen: 'sheet',
        sessionId: lanInfo?.sessionId,
        characterId: character?.id,
        actionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      submittingSheetActionsRef.current.delete(actionId);
      setSubmittingSheetActions((current) => current.filter((id) => id !== actionId));
    }
  };

  const sendResourceRequest = async (request: LanResourceRequest) => {
    if (!character) return false;
    traceFunctionCall('sendResourceRequest', request, {
      screen: 'sheet',
      source: 'player_request',
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character.id,
      characterName: character.name,
      playerKey: lanInfo?.sessionId ? getSelfLanKey(lanInfo.sessionId) : '',
    });
    if (!lanInfo?.joinUrl) {
      showCustomAlert('Sessao offline', 'Nao ha socket TCP ativo para enviar este pedido ao mestre.');
      return false;
    }

    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const clientRequestId = request.clientRequestId || makeLanEventId();
    const event: LanSessionEvent = {
      id: makeLanEventId(),
      clientMsgId: clientRequestId,
      sessionId: lanInfo.sessionId,
      type: 'resource_request',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      resourceRequest: { ...request, clientRequestId },
      message: request.message,
      createdAt: new Date().toISOString(),
    };

    try {
      console.log('[LAN REQUEST SEND]', {
        sessionId: lanInfo.sessionId,
        joinUrl: lanInfo.joinUrl,
        fromKey: selfKey,
        type: request.kind,
        message: request.message,
      });

      // Antes de enviar o pedido, reanuncia o jogador. Isso corrige o caso em que o
      // cliente recebeu snapshot, mas o roster oficial do mestre ainda não foi persistido.
      await notifyMasterJoin(lanInfo.joinUrl, lanInfo.sessionId, character).catch(() => false);
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      await rememberLanSessionEvent(db, event).catch(() => false);
      traceFunctionReturn('sendResourceRequest', {
        sent: true,
        eventId: event.id,
        request,
      }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });
      showCustomAlert('Pedido enviado', 'O mestre recebeu sua solicitacao para revisar.');
      return true;
    } catch (error) {
      console.warn('[LAN REQUEST FAILED]', error);
      traceError('EVENT_CREATED', 'SEND_RESOURCE_REQUEST_ERROR', error, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        payload: request,
      });
      showCustomAlert('Pedido falhou', 'Nao consegui enviar o pedido para a sessao LAN. Volte para a tela da ficha quando reconectar e tente novamente.');
      return false;
    }
  };

  const notifyInventoryPatch = async (
    equipment: any,
    reason: string,
    clientRequestId = makeLanEventId(),
    statsPatch?: Record<string, unknown>
  ) => {
    if (!lanInfo?.joinUrl || !character) return;
    try {
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const event: LanSessionEvent = {
        id: clientRequestId,
        clientMsgId: clientRequestId,
        sessionId: lanInfo.sessionId,
        type: 'inventory_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'inventory',
        entityId: selfKey,
        ackRequired: true,
        inventoryPatch: { targetKey: selfKey, equipment, reason, action: 'self_update' },
        statsPatch,
        message: reason,
        createdAt: new Date().toISOString(),
      };
      traceFunctionCall('notifyInventoryPatch', { equipment, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      await rememberLanSessionEvent(db, event).catch(() => false);
      return true;
    } catch {
      // A alteracao local continua valida; o mestre sincroniza quando receber o proximo snapshot aceito.
      return false;
    }
  };

  const notifyNumberPatch = async (patch: LanSessionEvent['numberPatch'], reason: string) => {
    if (!lanInfo?.joinUrl || !character) return;
    try {
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const event: LanSessionEvent = {
        id: makeLanEventId(),
        clientMsgId: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'player_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'player',
        entityId: selfKey,
        ackRequired: true,
        numberPatch: patch,
        message: reason,
        createdAt: new Date().toISOString(),
      };
      traceFunctionCall('notifyNumberPatch', { patch, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch,
      });
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      traceFunctionReturn('notifyNumberPatch', { sent: true, eventId: event.id }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
      });
    } catch {
      showCustomAlert('Sincronizacao falhou', 'Nao consegui enviar esta alteracao ao mestre.');
    }
  };

  const getCurrentCoinPatch = () => ({
    gp: Math.max(0, Math.floor(Number(character?.gp || 0))),
    sp: Math.max(0, Math.floor(Number(character?.sp || 0))),
    cp: Math.max(0, Math.floor(Number(character?.cp || 0))),
  });

  const getCoinTotalCopper = (coins: Partial<Record<'gp' | 'sp' | 'cp', number>>) => (
    Math.max(0, Math.floor(Number(coins.gp || 0))) * COIN_RATES.gp +
    Math.max(0, Math.floor(Number(coins.sp || 0))) * COIN_RATES.sp +
    Math.max(0, Math.floor(Number(coins.cp || 0))) * COIN_RATES.cp
  );

  const sendCoinSelfPatchRequest = async (
    nextCoins: Partial<Record<'gp' | 'sp' | 'cp', number>>,
    reason: string
  ) => {
    if (!lanInfo?.joinUrl || !character) return false;
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const current = getCurrentCoinPatch();
    const next = {
      gp: nextCoins.gp == null ? current.gp : Math.max(0, Math.floor(Number(nextCoins.gp) || 0)),
      sp: nextCoins.sp == null ? current.sp : Math.max(0, Math.floor(Number(nextCoins.sp) || 0)),
      cp: nextCoins.cp == null ? current.cp : Math.max(0, Math.floor(Number(nextCoins.cp) || 0)),
    };
    const eventId = makeLanEventId();
    const event: LanSessionEvent = {
      id: eventId,
      clientMsgId: eventId,
      sessionId: lanInfo.sessionId,
      type: 'coin_self_patch_request',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'player',
      entityId: selfKey,
      ackRequired: true,
      coinPatchRequest: {
        targetKey: selfKey,
        current,
        next,
        currentTotalCopper: getCoinTotalCopper(current),
        nextTotalCopper: getCoinTotalCopper(next),
        reason,
      },
      message: reason,
      createdAt: new Date().toISOString(),
    };

    try {
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      await rememberLanSessionEvent(db, event).catch(() => false);
      await updateDB(next, { allowLanAuthoritativeCache: true, reason: 'lan_player_self_coin_patch' });
      showCustomAlert('Pedido enviado', 'O mestre recebeu sua alteracao de moedas para confirmar.');
      return true;
    } catch {
      showCustomAlert('Sincronizacao falhou', 'Nao consegui enviar esta alteracao ao mestre.');
      return false;
    }
  };

  const notifyEffectPatch = async (addEffects: any[], reason: string) => {
    if (!lanInfo?.joinUrl || !character || addEffects.length === 0) return;
    const selfKey = getSelfLanKey(lanInfo.sessionId);

    try {
      const event: LanSessionEvent = {
        id: makeLanEventId(),
        clientMsgId: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'effect_patch',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'character_effects',
        entityId: selfKey,
        entityRevision: Date.now(),
        ackRequired: true,
        effectPatch: {
          targetKey: selfKey,
          add: addEffects as any,
          update: [],
          remove: [],
        },
        message: reason,
        createdAt: new Date().toISOString(),
      };

      await rememberLanSessionEvent(db, event).catch(() => false);
      traceFunctionCall('notifyEffectPatch', { addEffects, reason }, {
        screen: 'sheet',
        source: 'player_request',
        sessionId: lanInfo.sessionId,
        characterId: character.id,
        characterName: character.name,
        eventId: event.id,
        eventType: event.type,
        fromKey: event.fromKey,
        toKey: event.toKey,
        patch: event.effectPatch,
      });
      await sendLanSessionEvent(lanInfo.joinUrl, event);
    } catch (error) {
      console.warn('[LAN ITEM EFFECT PATCH FAILED]', error);
    }
  };

  const sendEffectSaveResult = async (
    save: NonNullable<LanSessionEvent['saveRequest']>,
    rawRoll: number,
    rollMode: 'virtual' | 'manual',
  ) => {
    return runSheetAction(`save:${save.id}`, async () => {
    if (!lanInfo?.joinUrl || !character) return false;
    const modifier = getSaveModifierForAbility(save.saveAbility);
    const resolvedSave = resolveSavingThrow({
      ability: save.saveAbility,
      dc: Number(save.dc || 1),
      modifier,
      rollMode,
      manualRoll: rawRoll,
    });
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const eventId = makeLanEventId();
    const event: LanSessionEvent = {
      id: eventId,
      clientMsgId: eventId,
      sessionId: lanInfo.sessionId,
      type: 'effect_save_result',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'save',
      entityId: save.id,
      ackRequired: true,
      saveResult: {
        requestId: save.id,
        rollMode,
        dice: '1d20',
        rawRoll: resolvedSave.rawRoll,
        manualValue: rollMode === 'manual' ? resolvedSave.rawRoll : undefined,
        modifier: resolvedSave.modifier,
        total: resolvedSave.total,
        dc: save.dc ?? null,
        passed: resolvedSave.passed,
      },
      message: `${character.name} rolou ${resolvedSave.total} em ${resolvedSave.ability}${save.dc ? ` CD ${save.dc}` : ''}.`,
      createdAt: new Date().toISOString(),
    };

    try {
      debugLanFlow('PLAYER_EFFECT_SAVE_ROLLED', {
        eventId: event.id,
        requestId: save.id,
        saveAbility: resolvedSave.ability,
        rawRoll: resolvedSave.rawRoll,
        modifier: resolvedSave.modifier,
        total: resolvedSave.total,
        dc: resolvedSave.dc,
        passed: resolvedSave.passed,
        rollMode,
      });
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      await rememberLanSessionEvent(db, event).catch(() => false);
      setPendingEffectSave(null);
      setSaveManualValue('');
      showCustomAlert(
        resolvedSave.passed ? 'Salvaguarda passou' : 'Salvaguarda falhou',
        `${resolvedSave.ability}: d20 ${resolvedSave.rawRoll} ${resolvedSave.modifier >= 0 ? '+' : ''}${resolvedSave.modifier} = ${resolvedSave.total}. CD ${resolvedSave.dc}.`
      );
      return true;
    } catch {
      showCustomAlert('Teste falhou', 'Nao consegui enviar a salvaguarda ao mestre.');
      return false;
    }
    });
  };

  const rollVirtualEffectSave = (save: NonNullable<LanSessionEvent['saveRequest']>) => {
    void sendEffectSaveResult(save, 1, 'virtual');
  };

  const handleXP = async (action: 'add' | 'remove') => {
    await runSheetAction(`xp:${action}`, async () => {
    traceButton('sheet', action === 'add' ? 'REQUEST_OR_APPLY_XP_ADD' : 'REQUEST_OR_APPLY_XP_REMOVE', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { action, inputValue },
      before: character ? { xp: character.xp, level: character.level } : undefined,
    });
    if (!ensureLanWritable()) return;
    const amount = parseInt(inputValue) || 0;
    if (lanInfo?.sessionId && amount > 0) {
      await sendResourceRequest({
        kind: 'xp',
        action,
        amount: action === 'add' ? amount : -amount,
        message: `${action === 'add' ? '+' : '-'}${amount} XP`,
      });
      setXpModalVisible(false);
      setInputValue('');
      return;
    }

    let newXp = Math.max(0, action === 'add' ? character.xp + amount : character.xp - amount);
    
    const calcNewLevel = await getExpectedLevelForXpFromDb(db, newXp);

    if (calcNewLevel > character.level && action === 'add') {
      setNewLevelData(calcNewLevel);
      setLevelUpModalVisible(true); 
    }
    
    await updateDB({ xp: newXp });
    setXpModalVisible(false); 
    setInputValue('');
    });
  };

  const handleHP = (action: 'damage' | 'heal') => {
    void runSheetAction(`hp:${action}`, async () => {
    traceButton('sheet', action === 'damage' ? 'REQUEST_OR_APPLY_HP_DAMAGE' : 'REQUEST_OR_APPLY_HP_HEAL', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { action, inputValue },
      before: character ? { hp_current: character.hp_current, hp_max: character.hp_max, temp_hp: character.temp_hp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const amount = parseInt(inputValue) || 0;
    if (lanInfo?.sessionId && amount > 0) {
      await sendResourceRequest({
        kind: 'hp',
        action,
        amount: action === 'heal' ? amount : -amount,
        message: `${action === 'heal' ? '+' : '-'}${amount} HP`,
      });
      setHpModalVisible(false);
      setInputValue('');
      return;
    }

    let newDisplayCurrent = action === 'damage'
      ? Math.max(0, displayHpCurrent - amount)
      : Math.min(displayHpMax, displayHpCurrent + amount);
    let nextTempHp = Number(character.temp_hp || 0);
    let nextActiveEffects: any[] | null = null;

    if (action === 'damage') {
      const damageResult = applyDamageWithTempHp({
        hpCurrent: displayHpCurrent,
        hpMax: displayHpMax,
        tempHp: Number(character.temp_hp || 0),
        damage: amount,
      });
      newDisplayCurrent = damageResult.nextHpCurrent;
      nextTempHp = damageResult.nextTempHp;
      debugLanFlow('DAMAGE_WITH_TEMP_HP_CALCULATED', {
        screen: 'sheet',
        characterId: character.id,
        damage: amount,
        result: damageResult,
      });
      if (damageResult.tempHpWasDepleted) {
        const currentEffects: any[] = Array.isArray(character.active_effects)
          ? character.active_effects
          : safeJsonParse<any[]>(character.active_effects_json, []);
        const filteredEffects = currentEffects.filter((effect: any) => (
          String(effect?.target || '').toUpperCase() !== 'PV_TEMP' &&
          String(effect?.kind || '').toLowerCase() !== 'temp_hp'
        ));
        nextActiveEffects = filteredEffects;
        debugLanFlow(filteredEffects.length === currentEffects.length ? 'TEMP_HP_DEPLETED_NO_EFFECT_FOUND' : 'PLAYER_TEMP_HP_EFFECT_REMOVED', {
          screen: 'sheet',
          characterId: character.id,
          removedCount: currentEffects.length - filteredEffects.length,
        });
      }
    }

    const newDbCurrent = newDisplayCurrent - hpBonusFromCon;
    const dbUpdates: Record<string, unknown> = { hp_current: newDbCurrent, temp_hp: nextTempHp };
    if (nextActiveEffects) dbUpdates.active_effects_json = JSON.stringify(nextActiveEffects);

    await updateDB(dbUpdates, { reason: 'hp_damage_with_temp_hp' });
    if (nextActiveEffects) {
      setCharacter((prev: any) => prev ? ({ ...prev, active_effects: nextActiveEffects }) : prev);
    }
    notifyOwnLanStatus(newDbCurrent, character.hp_max);
    setHpModalVisible(false); 
    setInputValue('');
    });
  };

  const handleTempHP = () => {
    void runSheetAction('temp_hp', async () => {
    if (!ensureLanWritable()) return;
    const amount = Math.max(0, parseInt(inputValue) || 0);
    if (amount <= 0) return;

    if (lanInfo?.sessionId) {
      await sendResourceRequest({
        kind: 'temp_hp',
        action: 'add',
        amount,
        message: `+${amount} PV temporario`,
      });
      setHpModalVisible(false);
      setInputValue('');
      return;
    }

    await updateDB({ temp_hp: Math.max(0, Number(character.temp_hp || 0) + amount) });
    setHpModalVisible(false);
    setInputValue('');
    });
  };

  const handleTempBuffSubmit = () => {
    void runSheetAction('temp_buff', async () => {
    if (!ensureLanWritable()) return;
    let newStats = { ...character.stats };
    const val = parseInt(tempBuffValue) || 0;
    if (lanInfo?.sessionId) {
      await sendResourceRequest({
        kind: 'buff',
        action: 'temp',
        field: activeBuffStat,
        value: val,
        duration: 1,
        unit: 'rest',
        message: `${activeBuffStat} ${val >= 0 ? '+' : ''}${val} temporario`,
      });
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }

    if (val === 0) delete newStats.temp_mods[activeBuffStat];
    else newStats.temp_mods[activeBuffStat] = val;
    await updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
    });
  };

  const clearTempBuff = () => {
    if (!ensureLanWritable()) return;
    if (lanInfo?.sessionId) {
      showCustomAlert('Buff oficial', 'Durante a sessao LAN, peca ao mestre para remover buffs ou debuffs.');
      setTempBuffModalVisible(false);
      setTempBuffValue('');
      return;
    }
    let newStats = { ...character.stats };
    delete newStats.temp_mods[activeBuffStat];
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const goToEditScreen = () => {
    if (!ensureLanWritable()) return;
    setLevelUpModalVisible(false);
    router.push(`/edit?id=${character.id}&levelUpTo=${newLevelData}${lanInfo?.sessionId ? `&sessionId=${lanInfo.sessionId}&joinUrl=${encodeURIComponent(lanInfo.joinUrl || '')}` : ''}` as any);
  };

  const handleCoinSubmit = () => {
    void runSheetAction(`coin:set:${activeCoinType}`, async () => {
    traceButton('sheet', 'REQUEST_OR_APPLY_COIN_SET', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { activeCoinType, inputValue },
      before: character ? { gp: character.gp, sp: character.sp, cp: character.cp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const nextValue = Math.max(0, parseInt(inputValue) || 0);
    if (lanInfo?.sessionId) {
      const currentCoins = getCurrentCoinPatch();
      const nextCoins = { ...currentCoins, [activeCoinType]: nextValue };
      if (getCoinTotalCopper(nextCoins) > getCoinTotalCopper(currentCoins)) {
        const amount = nextValue - Number(character[activeCoinType] || 0);
        await sendResourceRequest({
          kind: 'coin',
          action: 'add',
          operation: 'master_approval',
          field: activeCoinType,
          amount,
          message: `+${amount} ${COIN_NAMES[activeCoinType]}`,
        });
      } else {
        await sendCoinSelfPatchRequest(
          nextCoins,
          `${character.name} ajustou ${COIN_NAMES[activeCoinType]} para ${nextValue}.`
        );
      }
      setCoinModalVisible(false);
      setInputValue('');
      return;
    }
    await updateDB({ [activeCoinType]: nextValue });
    setCoinModalVisible(false); setInputValue('');
    });
  };

  const updateCoins = (type: 'gp' | 'sp' | 'cp', delta: number) => {
    void runSheetAction(`coin:delta:${type}`, async () => {
    traceButton('sheet', 'REQUEST_OR_APPLY_COIN_DELTA', {
      mode: sheetRuntimeMode,
      sessionId: lanInfo?.sessionId,
      characterId: character?.id,
      characterName: character?.name,
      args: { type, delta },
      before: character ? { gp: character.gp, sp: character.sp, cp: character.cp } : undefined,
    });
    if (!ensureLanWritable()) return;
    const nextValue = Math.max(0, character[type] + delta);
    if (lanInfo?.sessionId) {
      const currentCoins = getCurrentCoinPatch();
      const nextCoins = { ...currentCoins, [type]: nextValue };
      if (getCoinTotalCopper(nextCoins) > getCoinTotalCopper(currentCoins)) {
        const amount = nextValue - Number(character[type] || 0);
        await sendResourceRequest({
          kind: 'coin',
          action: 'add',
          operation: 'master_approval',
          field: type,
          amount,
          message: `+${amount} ${COIN_NAMES[type]}`,
        });
      } else {
        await sendCoinSelfPatchRequest(nextCoins, `${character.name} reduziu ${COIN_NAMES[type]} para ${nextValue}.`);
      }
      return;
    }
    await updateDB({ [type]: nextValue });
    });
  };

  const executeCoinConversion = (sourceAmount: number, targetAmount: number) => {
    void runSheetAction('coin:convert', async () => {
    if (!ensureLanWritable()) return;
    const nextCoins = {
      ...getCurrentCoinPatch(),
      [convertFrom]: character[convertFrom] - sourceAmount,
      [convertTo]: character[convertTo] + targetAmount
    };
    if (lanInfo?.sessionId) {
      await sendCoinSelfPatchRequest(
        nextCoins,
        `${character.name} converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`
      );
      setConvertModalVisible(false);
      setConvertAmount('');
      return;
    }
    await updateDB(nextCoins);
    setConvertModalVisible(false);
    setConvertAmount('');
    showCustomAlert("Câmbio Realizado", `Você converteu ${sourceAmount} ${COIN_NAMES[convertFrom]} em ${targetAmount} ${COIN_NAMES[convertTo]}.`);
    });
  };

  const isLanCharacter = () => isLanPlayerRuntime;

  const normalizeInventoryItemFromCatalog = (item: any, qty = 1) => {
    const effectHidden = getItemEffectHidden(item);

    return {
      name: String(item?.name || 'Item'),
      qty,
      weight: Number(item?.weight) || 0,
      damage: item?.damage || '',
      damage_type: item?.damage_type || '',
      properties: item?.properties || '',
      descricao: item?.descricao || '',
      effect_json: item?.effect_json || '',
      duration_value: item?.duration_value ?? null,
      duration_unit: item?.duration_unit ?? null,
      effect_hidden: effectHidden ? 1 : 0,
      effectHidden,
      hiddenEffect: effectHidden,
      criador: item?.criador,
    };
  };

  const hydrateInventoryItemForEffects = (item: any) => {
    const catalogItem = dbItemsCatalog.find((cat: any) => String(cat.name || '') === String(item?.name || ''));
    const effectHidden = getItemEffectHidden(item, catalogItem);
    const hydrated = {
      ...catalogItem,
      ...item,
      name: item?.name || catalogItem?.name || 'Item',
      qty: Number(item?.qty ?? catalogItem?.qty ?? 1) || 1,
      weight: Number(item?.weight ?? catalogItem?.weight ?? 0) || 0,
      damage: item?.damage || catalogItem?.damage || '',
      damage_type: item?.damage_type || catalogItem?.damage_type || '',
      properties: item?.properties || catalogItem?.properties || '',
      descricao: item?.descricao || catalogItem?.descricao || '',
      effect_json: item?.effect_json || catalogItem?.effect_json || '',
      duration_value: item?.duration_value ?? catalogItem?.duration_value ?? null,
      duration_unit: item?.duration_unit ?? catalogItem?.duration_unit ?? null,
      effect_hidden: effectHidden ? 1 : 0,
      effectHidden,
      hiddenEffect: effectHidden,
    };

    return hydrated;
  };

  const updateBagQty = (index: number, delta: number, overrideItem?: any) => {
    if (!ensureLanWritable()) return;
    if (isLanCharacter() && delta > 0) {
      showCustomAlert('Inventario bloqueado', 'Durante a sessao LAN, apenas o mestre pode adicionar itens ao jogador.');
      return;
    }

    let newBag = [...character.equipment.bag];
    const item = overrideItem ? hydrateInventoryItemForEffects(overrideItem) : hydrateInventoryItemForEffects(newBag[index]);
    if (!item) return;

    if (newBag[index]) {
      newBag[index] = {
        ...item,
        qty: (Number(newBag[index].qty) || 0) + delta,
      };
    }

    if (newBag[index]?.qty <= 0) newBag = newBag.filter((_, i) => i !== index);
    const nextEquipment = { ...character.equipment, bag: newBag };

    if (isLanPlayerRuntime) {
      if (delta < 0) {
        const actionId = `inventory:${String(item.name || index)}:${Math.abs(delta)}`;
        debugLanFlow('LAN_PLAYER_REQUEST_INVENTORY_PATCH', {
          characterId: character.id,
          itemName: item.name,
          delta,
          nextQty: newBag.find((entry: any) => entry.name === item.name)?.qty || 0,
        });
        void runSheetAction(actionId, async () => {
          const sent = await notifyInventoryPatch(nextEquipment, `${character.name} consumiu/removeu ${Math.abs(delta)}x ${item.name} da mochila.`, makeLanEventId());
          if (sent) {
            await updateDB(
              { equipment: nextEquipment },
              { allowLanAuthoritativeCache: true, reason: 'lan_player_self_inventory_patch' }
            );
          }
        });
      }
      return;
    }

    void updateDB({ equipment: nextEquipment }, { reason: 'offline_inventory_update' });
  };

  const addItemToBag = (item: any) => {
    if (!ensureLanWritable()) return;
    if (isLanCharacter()) {
      showCustomAlert('Inventario bloqueado', 'Durante a sessao LAN, peca ao mestre para entregar itens.');
      setItemModalVisible(false);
      setItemSearch('');
      return;
    }

    let newBag = [...character.equipment.bag];
    const existingIndex = newBag.findIndex((i: any) => i.name === item.name);
    const catalogItem = normalizeInventoryItemFromCatalog(item, 1);

    if (existingIndex > -1) {
      const existing = newBag[existingIndex];
      newBag[existingIndex] = {
        ...catalogItem,
        ...existing,
        qty: (Number(existing.qty) || 0) + 1,
        damage: existing.damage || catalogItem.damage,
        damage_type: existing.damage_type || catalogItem.damage_type,
        properties: existing.properties || catalogItem.properties,
        descricao: existing.descricao || catalogItem.descricao,
        effect_json: existing.effect_json || catalogItem.effect_json,
        duration_value: existing.duration_value ?? catalogItem.duration_value,
        duration_unit: existing.duration_unit ?? catalogItem.duration_unit,
        effect_hidden: getItemEffectHidden(existing, catalogItem) ? 1 : 0,
        effectHidden: getItemEffectHidden(existing, catalogItem),
        hiddenEffect: getItemEffectHidden(existing, catalogItem),
      };
    } else {
      newBag.push(catalogItem);
    }

    updateDB({ equipment: { ...character.equipment, bag: newBag } });
    setItemModalVisible(false); setItemSearch('');
  };

  const handleSendItemToPlayer = async (target: PublicLanPlayer) => {
    await runSheetAction(`send_item:${target.key}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedBagItem || !lanInfo || !character) return;
    const tradeItem = makeTradeItem(selectedBagItem.item, actionQty);
    const availableQty = Math.max(0, Number(selectedBagItem.item?.qty || 0));
    if (availableQty < tradeItem.qty) {
      showCustomAlert('Envio cancelado', 'Voce nao tem quantidade suficiente deste item.');
      return;
    }

    try {
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const requestId = makeLanEventId();
      const event: LanSessionEvent = {
        id: requestId,
        clientMsgId: requestId,
        sessionId: lanInfo.sessionId,
        type: 'send_item_request',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'inventory',
        entityId: selfKey,
        ackRequired: true,
        sendItemRequest: {
          requestId,
          fromKey: selfKey,
          toKey: target.key,
          item: tradeItem,
          qty: tradeItem.qty,
        },
        item: tradeItem,
        message: `${character.name} pediu para enviar ${tradeItem.qty}x ${tradeItem.name} para ${target.characterName}.`,
        createdAt: new Date().toISOString(),
      };
      await sendLanSessionEvent(lanInfo.joinUrl, event);
      await rememberLanSessionEvent(db, event).catch(() => false);
      showCustomAlert('Pedido enviado', `O mestre vai confirmar o envio de ${tradeItem.qty}x ${tradeItem.name}.`);
    } catch {
      showCustomAlert('Envio falhou', 'Nao consegui avisar a sessao LAN. O inventario local nao foi alterado.');
    } finally {
      setTargetPickerMode(null);
      setSelectedBagItem(null);
    }
    });
  };

  const handleOfferTradeToPlayer = async (target: PublicLanPlayer) => {
    await runSheetAction(`trade_offer:${target.key}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedBagItem || !lanInfo || !character) return;
    const offeredItem = makeTradeItem(selectedBagItem.item, actionQty);

    try {
      const tradeId = makeLanEventId();
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: tradeId,
        clientMsgId: tradeId,
        sessionId: lanInfo.sessionId,
        type: 'trade_offer',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: target.key,
        toName: target.characterName,
        entityType: 'inventory',
        entityId: target.key,
        ackRequired: true,
        tradeId,
        offeredItem,
        createdAt: new Date().toISOString(),
      });
      await rememberLanSessionEvent(db, {
        id: tradeId,
        clientMsgId: tradeId,
        sessionId: lanInfo.sessionId,
        type: 'trade_offer',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: target.key,
        toName: target.characterName,
        entityType: 'inventory',
        entityId: target.key,
        ackRequired: true,
        tradeId,
        offeredItem,
        createdAt: new Date().toISOString(),
      }).catch(() => false);
      showCustomAlert('Troca enviada', `${target.characterName} recebeu sua proposta de troca.`);
    } catch {
      showCustomAlert('Troca falhou', 'Nao consegui enviar a proposta para a sessao LAN.');
    } finally {
      setTargetPickerMode(null);
      setSelectedBagItem(null);
    }
    });
  };

  const handleAcceptTrade = async () => {
    await runSheetAction(`trade_accept:${selectedTradeOffer?.id || ''}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedTradeOffer || !tradeCounterItem || !lanInfo || !character) return;
    const requestedItem = makeTradeItem(tradeCounterItem.item, tradeCounterQty);
    const availableQty = Math.max(0, Number(tradeCounterItem.item?.qty || 0));
    if (availableQty < requestedItem.qty) {
      showCustomAlert('Troca cancelada', 'Voce nao tem quantidade suficiente do item escolhido.');
      return;
    }

    try {
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const eventId = makeLanEventId();
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: eventId,
        clientMsgId: eventId,
        sessionId: lanInfo.sessionId,
        type: 'trade_accept',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'inventory',
        entityId: selectedTradeOffer.id,
        ackRequired: true,
        tradeId: selectedTradeOffer.id,
        tradeAccept: {
          tradeId: selectedTradeOffer.id,
          fromKey: selectedTradeOffer.fromKey,
          toKey: selfKey,
        },
        offeredItem: selectedTradeOffer.offeredItem,
        requestedItem,
        message: `${character.name} aceitou a troca com ${selectedTradeOffer.fromName}.`,
        createdAt: new Date().toISOString(),
      });
      setIncomingTrades((current) => current.filter((event) => event.id !== selectedTradeOffer.id));
      setSelectedTradeOffer(null);
      setTradeCounterItem(null);
      showCustomAlert('Troca enviada', 'O mestre vai validar os dois inventarios antes de concluir.');
    } catch {
      showCustomAlert('Troca falhou', 'Nao consegui confirmar a troca na sessao LAN. O inventario local nao foi alterado.');
    }
    });
  };

  const handleDeclineTrade = async (event: LanSessionEvent) => {
    await runSheetAction(`trade_decline:${event.id}`, async () => {
    if (!ensureLanWritable()) return;
    if (!lanInfo || !character) return;
    try {
      await sendLanSessionEvent(lanInfo.joinUrl, {
        id: makeLanEventId(),
        clientMsgId: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: 'trade_decline',
        fromKey: getSelfLanKey(lanInfo.sessionId),
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'inventory',
        entityId: event.id,
        ackRequired: true,
        tradeId: event.id,
        offeredItem: event.offeredItem,
        tradeAccept: {
          tradeId: event.id,
          fromKey: event.fromKey,
          toKey: getSelfLanKey(lanInfo.sessionId),
        },
        createdAt: new Date().toISOString(),
      });
      setIncomingTrades((current) => current.filter((entry) => entry.id !== event.id));
      if (selectedTradeOffer?.id === event.id) setSelectedTradeOffer(null);
    } catch {
      showCustomAlert('Resposta falhou', 'Nao consegui recusar a troca na sessao LAN.');
    }
    });
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

  const notifySelfLanSpellEvent = async (spellEffect: NonNullable<LanSessionEvent['spellEffect']>) => {
    if (!lanInfo?.joinUrl || !character) return;
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    if (!selfKey) return;

    try {
      const event: LanSessionEvent = {
        id: makeLanEventId(),
        sessionId: lanInfo.sessionId,
        type: spellEffect.mode === 'effect' ? 'spell_effect' : 'spell_hp',
        fromKey: selfKey,
        fromName: character.name,
        toKey: selfKey,
        toName: character.name,
        spellEffect,
        createdAt: new Date().toISOString(),
      };
      await rememberLanSessionEvent(db, event);
      await sendLanSessionEvent(lanInfo.joinUrl, event);
    } catch {
      // O item ja foi aplicado localmente; o proximo snapshot oficial corrige caso o host nao receba.
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
    setSpellTargetAttackRolls(defaultKeys.reduce((acc, key) => ({ ...acc, [key]: '' }), {}));
    setSpellRollResult('');
    setSpellAttackRollResult('');
    setSpellRollMode('manual');
    setSpellAttackRollMode('manual');
    setSpellDicePurpose('damage');
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
      setSpellTargetAttackRolls((rolls) => {
        const copy = { ...rolls };
        if (!copy[key]) copy[key] = '';
        return copy;
      });
      return next;
    });
  };

  const rollSpellForTargets = () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell) return;
    const diceParts = getDiceParts(getSpellDiceText(selectedSpell));
    if (diceParts[0]) {
      setSpellDicePurpose('damage');
      setSpellRollResult('Rolando...');
      setDiceRollRequest({ ...diceParts[0], nonce: Date.now() });
      return;
    }
    showCustomAlert('Rolagem indisponivel', 'Nao encontrei uma formula de dado nesta magia. Informe o valor manualmente.');
  };

  const handleSpellDiceComplete = (result: DiceRollResult) => {
    if (!selectedSpell || !spellCastVisible) return;
    if (spellDicePurpose === 'attack') {
      const attackModifier = getSpellAttackModifier(selectedSpell);
      const attackTotal = result.total + attackModifier;
      const modifierText = formatSignedModifier(attackModifier);
      setSpellAttackRollMode('virtual');
      setSpellAttackRollResult(`${attackTotal} (${result.breakdown} ${modifierText})`);
      setSpellTargetAttackRolls((current) => {
        const next = { ...current };
        for (const key of spellTargetKeys) next[key] = String(result.total);
        return next;
      });
      return;
    }
    setSpellRollMode('virtual');
    setSpellRollResult(`${result.total} (${result.breakdown})`);
    setSpellTargetAmounts((current) => {
      const next = { ...current };
      for (const key of spellTargetKeys) next[key] = String(result.total);
      return next;
    });
  };

  const getSpellSaveConfig = (spell: any) => {
    const effects = parseStructuredEffects(spell?.effect_json);
    const effectSave = effects.map((effect) => effect?.save).find((save) => save?.ability);
    const rawSavingThrow = String(spell?.saving_throw || '').trim();
    const rawAbility = String(effectSave?.ability || rawSavingThrow.match(/\b(FOR|DES|CON|INT|SAB|CAR)\b/i)?.[1] || '').toUpperCase();
    const dc = Number(effectSave?.dc ?? rawSavingThrow.match(/\bCD\s*(\d+)/i)?.[1] ?? 0);
    if (!rawAbility || rawAbility === 'NENHUM' || rawAbility === 'NONE') return null;
    return {
      enabled: true,
      saveAbility: rawAbility,
      dc: dc > 0 ? dc : 8 + profBonusChar + Math.max(forMod, desMod, conModTotal),
      saveOnSuccess: String(effectSave?.onSuccess || effectSave?.saveOnSuccess || 'negates'),
      saveOnFailure: 'apply_full',
      rollMode: 'target_choice' as const,
    };
  };

  const getSpellAttackModifier = (spell: any) => {
    const spellText = `${spell?.name || ''} ${spell?.range || ''} ${spell?.casting_time || ''} ${spell?.description || ''}`.toLowerCase();
    const usesWeapon = spellText.includes('arma') || String(spell?.range || '').toLowerCase().includes('arma');
    const abilityMod = usesWeapon
      ? Math.max(getAbilityModifierForAbility('FOR'), getAbilityModifierForAbility('DES'))
      : Math.max(getAbilityModifierForAbility('INT'), getAbilityModifierForAbility('SAB'), getAbilityModifierForAbility('CAR'));
    return abilityMod + profBonusChar;
  };

  const isSpellAttackRollRequired = (spell: any) => {
    if (!spell || getSpellCastMode(spell) !== 'damage' || getSpellSaveConfig(spell)) return false;
    const raw = `${spell.name || ''} ${spell.range || ''} ${spell.casting_time || ''} ${spell.description || ''}`.toLowerCase();
    return (
      /ataque m[aá]gico/.test(raw) ||
      /ataque de magia/.test(raw) ||
      String(spell.range || '').toLowerCase().includes('arma') ||
      String(spell.name || '').toLowerCase().startsWith('ataque ')
    );
  };

  const rollSpellAttackForTargets = () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell) return;
    setSpellDicePurpose('attack');
    setSpellAttackRollResult('Rolando...');
    setDiceRollRequest({ sides: 20, count: 1, nonce: Date.now() });
  };

  const sendSpellEventToTarget = async (target: PublicLanPlayer, amount: number) => {
    if (!lanInfo || !character || !selectedSpell) return;
    const mode = getSpellCastMode(selectedSpell);
    const selfKey = getSelfLanKey(lanInfo.sessionId);
    const requiresAttack = isSpellAttackRollRequired(selectedSpell);
    const attackRoll = requiresAttack ? Math.max(0, parseInt(spellTargetAttackRolls[target.key] || '', 10) || 0) : undefined;
    const attackModifier = requiresAttack ? getSpellAttackModifier(selectedSpell) : undefined;
    const attackTotal = attackRoll != null && attackModifier != null ? attackRoll + attackModifier : undefined;
    const spellEffect: NonNullable<LanSessionEvent['spellEffect']> = mode === 'effect'
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
      };
    const actionId = makeLanEventId();
    const event: LanSessionEvent = {
      id: actionId,
      clientMsgId: actionId,
      sessionId: lanInfo.sessionId,
      type: 'spell_cast_request',
      fromKey: selfKey,
      fromName: character.name,
      toKey: 'master',
      toName: 'Mestre',
      entityType: 'action',
      entityId: actionId,
      ackRequired: true,
      actionRequest: {
        actionId,
        actionName: selectedSpell.name,
        actionKind: requiresAttack ? 'attack' : mode,
        sourceType: 'spell',
        targetKind: target.isSelf ? 'self' : 'player',
        targetKey: target.key,
        targetName: target.characterName,
        rollMode: spellRollMode,
        declaredValue: amount,
        rolls: [{
          rollMode: spellRollMode,
          formula: getSpellDiceText(selectedSpell) || undefined,
          dice: getSpellDiceText(selectedSpell) || undefined,
          manualValue: spellRollMode === 'manual' ? amount : undefined,
          rawRoll: spellRollMode === 'virtual' ? amount : undefined,
          total: amount,
          rollId: actionId,
          timestamp: new Date().toISOString(),
        }],
        spellEffect,
        save: getSpellSaveConfig(selectedSpell) || undefined,
        attack: requiresAttack ? {
          attackRoll,
          attackModifier,
          attackTotal,
          rollMode: spellAttackRollMode,
        } : undefined,
        createdAt: new Date().toISOString(),
      },
      spellEffect,
      message: `${character.name} pediu para usar ${selectedSpell.name} em ${target.characterName}.`,
      createdAt: new Date().toISOString(),
    };

    await sendLanSessionEvent(lanInfo.joinUrl, event);
    await rememberLanSessionEvent(db, event).catch(() => false);
  };

  const applyStructuredItemEffects = async (bagIndex: number, rawItem: any, qty: number, effects: any[], chosenAttr?: string) => {
    const item = hydrateInventoryItemForEffects(rawItem);
    const lanMode = isLanCharacter();

    if (lanMode) {
      if (!lanInfo?.joinUrl || !character) return;
      const selfKey = getSelfLanKey(lanInfo.sessionId);
      const actionId = makeLanEventId();
      const event: LanSessionEvent = {
        id: actionId,
        clientMsgId: actionId,
        sessionId: lanInfo.sessionId,
        type: 'item_use_request',
        fromKey: selfKey,
        fromName: character.name,
        toKey: 'master',
        toName: 'Mestre',
        entityType: 'action',
        entityId: actionId,
        ackRequired: true,
        actionRequest: {
          actionId,
          actionName: item.name,
          actionKind: 'item',
          sourceType: 'item',
          targetKind: 'self',
          targetKey: selfKey,
          targetName: character.name,
          rollMode: 'manual',
          item: makeTradeItem(item, qty),
          itemQty: qty,
          effects,
          chosenAttr,
          createdAt: new Date().toISOString(),
        },
        message: `${character.name} pediu para usar ${qty}x ${item.name}.`,
        createdAt: new Date().toISOString(),
      };
      try {
        await sendLanSessionEvent(lanInfo.joinUrl, event);
        await rememberLanSessionEvent(db, event).catch(() => false);
        showCustomAlert('Pedido enviado ao mestre', `${item.name} sera consumido se o mestre confirmar a acao.`);
      } catch {
        showCustomAlert('Uso falhou', 'Nao consegui enviar o uso do item para o mestre.');
      }
      return;
    }

    updateBagQty(bagIndex, -qty, item);

    const nextStats = { ...character.stats, temp_mods: { ...(character.stats?.temp_mods || {}) } };
    const dbUpdates: any = {};
    const numberPatch: NonNullable<LanSessionEvent['numberPatch']> = {};
    const messages: string[] = [];
    let nextActiveEffects = Array.isArray(character.active_effects) ? [...character.active_effects] : [];
    const lanEffectsToNotify: any[] = [];

    const pushLocalEffect = (effectInput: any) => {
      const effect = {
        ...effectInput,
        id: effectInput.id || `pending_item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        source: effectInput.source || item.name,
        sourceType: 'item',
        sourceId: String(item.id || item.name || ''),
        visibleToPlayer: true,
      };

      nextActiveEffects.push(effect);
      lanEffectsToNotify.push(effect);
    };

    for (const effect of effects) {
      const kind = String(effect.kind || effect.type || '').toLowerCase();
      const needsChosenStat = Boolean(effect.chooseStat) || String(effect.target || '').toUpperCase() === 'CHOOSE_STAT' || String(effect.effectType || '') === 'Escolher Atributo';
      const target = String(needsChosenStat ? chosenAttr : effect.target || '').toUpperCase();
      const value = Number(effect.value || 0);
      const dice = effect.healDice || effect.damageDice || effect.dice || '';
      const duration = getItemEffectDuration(item, effect);
      const isPermanent = duration.unit === 'permanent' || String(effect.durationText || '').toLowerCase().includes('permanente');

      if (needsChosenStat && !target) continue;

      if (['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(target) && value) {
        const totalValue = effect.mode === 'set' ? value : value * qty;

        if (effect.mode === 'set') {
          const base = Number(nextStats[target] || 10);
          nextStats.temp_mods[target] = value - base;
          messages.push(`${target} definido como ${value}.`);
        } else if (isPermanent && target !== 'CA') {
          // Offline mantém o bônus permanente na própria ficha. Em LAN também aplica otimista localmente,
          // mas envia effect_patch para o Host registrar a versão autoritativa sem payload/snapshot.
          nextStats[target] = String((Number(nextStats[target]) || 10) + totalValue);
          nextStats.extra_points = (Number(nextStats.extra_points) || 0) + totalValue;
          messages.push(`${target} ${totalValue > 0 ? '+' : ''}${totalValue} permanente.`);
        } else {
          nextStats.temp_mods[target] = (Number(nextStats.temp_mods[target]) || 0) + totalValue;
          messages.push(`${target} ${totalValue > 0 ? '+' : ''}${totalValue}${isPermanent ? ' permanente' : ''}.`);
        }

        pushLocalEffect({
          name: `${item.name}: ${target} ${totalValue > 0 ? '+' : ''}${totalValue}`,
          status: isPermanent ? 'permanent_item_effect' : 'item_effect',
          statusKey: isPermanent ? 'permanent_item_effect' : 'item_effect',
          target: normalizeLanEffectTarget(target),
          value: totalValue,
          remaining: duration.remaining,
          unit: duration.unit,
          durationText: duration.text,
          kind: target === 'CA' ? 'stat' : 'stat',
          mode: effect.mode === 'set' ? 'set' : 'add',
          color: isPermanent ? '#00fa9a' : '#00bfff',
          secondaryColor: '#8be9fd',
          visualPriority: isPermanent ? 70 : 50,
        });
      }

      if ((kind === 'temp_hp' || target === 'PV_TEMP') && value) {
        const nextTempHp = Math.max(Number(character.temp_hp || 0), Number(character.temp_hp || 0) + value * qty);
        dbUpdates.temp_hp = nextTempHp;
        numberPatch.tempHp = nextTempHp;
        messages.push(`PV temporario +${value * qty}.`);
        pushLocalEffect({
          name: `${item.name}: PV temporario +${value * qty}`,
          status: 'item_effect',
          statusKey: 'item_effect',
          target: 'PV_TEMP',
          value: value * qty,
          remaining: duration.remaining,
          unit: duration.unit,
          durationText: duration.text,
          kind: 'temp_hp',
          color: '#00bfff',
          secondaryColor: '#8be9fd',
          visualPriority: 50,
        });
      }

      if (kind === 'heal') {
        const fixedHeal = Number(value || String(dice).match(/^\d+$/)?.[0] || 0) * qty;
        if (fixedHeal > 0) {
          const nextHp = Math.min(Number(character.hp_max || 0), Number(character.hp_current || 0) + fixedHeal);
          dbUpdates.hp_current = nextHp;
          numberPatch.hpCurrent = nextHp;
          messages.push(`Recuperou ${fixedHeal} PV.`);
        } else if (dice) {
          messages.push(`Role a cura: ${qty}x ${dice}.`);
        }
      }

      const condition = effect.condition;
      if (condition?.key && condition.key !== 'none') {
        if (effect.save?.ability && condition.applyOn === 'failed_save') {
          messages.push(`Teste ${effect.save.ability}${effect.save.dc ? ` CD ${effect.save.dc}` : ''}; se falhar aplica ${condition.name || 'condicao'}.`);
          continue;
        }

        const conditionDuration = condition.duration || {};
        const remaining = Math.max(1, Number(conditionDuration.value || effect.durationValue || 1));
        const unit = normalizeLanEffectUnit(conditionDuration.unit || effect.durationUnit || 'rest');
        pushLocalEffect({
          name: condition.name || item.name,
          status: condition.key,
          statusKey: condition.key,
          target: target && target !== 'UNDEFINED' ? normalizeLanEffectTarget(target) : 'custom',
          value,
          remaining,
          unit,
          durationText: effect.durationText || conditionDuration.text || item.duration_unit || '',
          kind: 'condition',
          color: condition.color,
          secondaryColor: condition.secondaryColor,
          visualPriority: 80,
        });
        messages.push(`${condition.name || 'Condicao'} aplicada.`);
      }
    }

    dbUpdates.stats = nextStats;
    if (nextActiveEffects.length !== (Array.isArray(character.active_effects) ? character.active_effects.length : 0)) {
      dbUpdates.active_effects_json = nextActiveEffects;
    }

    await updateDB(dbUpdates, { reason: 'offline_item_consume' });
    setCharacter((prev: any) => prev ? ({
      ...prev,
      ...dbUpdates,
      stats: nextStats,
      active_effects: nextActiveEffects,
    }) : prev);

    showCustomAlert('Efeito aplicado', messages.length ? messages.join('\n') : `${item.name} foi usado.`);
  };

  const applySpellCast = async () => {
    await runSheetAction(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`, async () => {
    if (!ensureLanWritable()) return;
    if (!selectedSpell || !lanInfo) return;
    const targets = lanPlayers.filter((player) => spellTargetKeys.includes(player.key));
    if (targets.length === 0) {
      showCustomAlert('Sem alvo', 'Escolha pelo menos um personagem da party.');
      return;
    }

    try {
      let sentCount = 0;
      const requiresAttack = isSpellAttackRollRequired(selectedSpell);
      for (const target of targets) {
        const value = parseInt(spellTargetAmounts[target.key]) || 0;
        if (getSpellCastMode(selectedSpell) !== 'effect' && value <= 0) continue;
        if (requiresAttack && (parseInt(spellTargetAttackRolls[target.key] || '', 10) || 0) <= 0) {
          showCustomAlert('Ataque pendente', `Informe ou role o d20 de ataque para ${target.characterName}.`);
          return;
        }
        await sendSpellEventToTarget(target, value);
        sentCount += 1;
      }
      if (sentCount === 0) {
        showCustomAlert('Nada para enviar', 'Informe pelo menos um valor valido para os alvos escolhidos.');
        return;
      }
      setSpellCastVisible(false);
      showCustomAlert('Magia aplicada', `${selectedSpell.name} foi enviada para ${sentCount} alvo(s).`);
    } catch {
      showCustomAlert('Magia falhou', 'Nao consegui sincronizar a magia na sessao LAN.');
    }
    });
  };

  const processConsumeItem = (bagIndex: number, item: any, qty: number) => {
    if (!ensureLanWritable()) return;

    // Itens antigos na mochila podem estar sem effect_json/damage/duration.
    // Antes de consumir, reidrata pelo catálogo sem perder metadados customizados já existentes.
    item = hydrateInventoryItemForEffects(item);

    const structuredEffects = parseStructuredEffects(item.effect_json);
    if (structuredEffects.length > 0) {
      const chooseEffect = structuredEffects.find((effect) => (
        Boolean(effect.chooseStat) ||
        String(effect.target || '').toUpperCase() === 'CHOOSE_STAT' ||
        String(effect.effectType || '') === 'Escolher Atributo'
      ));

      if (chooseEffect) {
        const value = Number(chooseEffect.value || 0);
        const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
          text: attr,
          color: value >= 0 ? '#00fa9a' : '#ff6666',
          onPress: () => void applyStructuredItemEffects(bagIndex, item, qty, structuredEffects, attr),
        }));

        showCustomAlert(
          `Consumir ${qty}x ${item.name}`,
          'Este item afeta um atributo de sua escolha. Qual atributo deseja alterar?',
          [
            { text: 'Cancelar', color: '#666' },
            ...attrButtons,
          ]
        );
        return;
      }

      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        'Confirmar uso deste item?',
        [
          { text: 'Cancelar', color: '#666' },
          {
            text: 'Usar',
            color: '#00fa9a',
            onPress: () => void applyStructuredItemEffects(bagIndex, item, qty, structuredEffects),
          },
        ]
      );
      return;
    }

    const effect = item.damage && item.damage !== '-' ? item.damage : '';

    if (!effect) {
      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        'Este item nao possui efeito estruturado salvo nem efeito textual reconhecivel. Reabra o item no criador avancado e salve o efeito novamente.',
        [{ text: 'OK', color: appColors.primary }]
      );
      return;
    }
    
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
      const lanEffects: NonNullable<LanSessionEvent['spellEffect']>[] = [];
      const duration = getItemEffectDuration(item, {});

      // 1. Aplica o Atributo Escolhido (caso exista)
      if (chosenAttr) {
        const totalVal = escolherVal * qty;
        if (escolherIsPerm) {
          newStats[chosenAttr] = String((parseInt(newStats[chosenAttr]) || 10) + totalVal);
          newStats.extra_points = (parseInt(newStats.extra_points) || 0) + totalVal;
          lanEffects.push({
            spellName: item.name,
            mode: 'effect',
            target: chosenAttr as LanEffectTarget,
            value: totalVal,
            durationText: 'Permanente',
            durationRemaining: 0,
            durationUnit: 'permanent',
            description: item.descricao || item.properties || '',
          });
          msgParts.push(`✨ Escolha: ${totalVal > 0 ? '+'+totalVal : totalVal} em ${chosenAttr} (Permanente)`);
        } else {
          if(!newStats.temp_mods) newStats.temp_mods = {};
          newStats.temp_mods[chosenAttr] = (parseInt(newStats.temp_mods[chosenAttr]) || 0) + totalVal;
          lanEffects.push({
            spellName: item.name,
            mode: 'effect',
            target: chosenAttr as LanEffectTarget,
            value: totalVal,
            durationText: duration.text,
            durationRemaining: duration.remaining,
            durationUnit: duration.unit,
            description: item.descricao || item.properties || '',
          });
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
              lanEffects.push({
                spellName: item.name,
                mode: 'effect',
                target: attr as LanEffectTarget,
                value: val,
                durationText: 'Permanente',
                durationRemaining: 0,
                durationUnit: 'permanent',
                description: item.descricao || item.properties || '',
              });
              msgParts.push(`💪 Permanente: ${val > 0 ? '+'+val : val} em ${attr}`);
          } else {
              if(!newStats.temp_mods) newStats.temp_mods = {};
              newStats.temp_mods[attr] = (parseInt(newStats.temp_mods[attr]) || 0) + val;
              lanEffects.push({
                spellName: item.name,
                mode: 'effect',
                target: attr as LanEffectTarget,
                value: val,
                durationText: duration.text,
                durationRemaining: duration.remaining,
                durationUnit: duration.unit,
                description: item.descricao || item.properties || '',
              });
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
               lanEffects.push({
                 spellName: item.name,
                 mode: 'heal',
                 amount: Math.abs(curaValor),
                 description: item.descricao || item.properties || '',
               });
               msgParts.push(`💖 Recuperou ${Math.abs(curaValor)} Pontos de Vida.`);
            }
          } else {
            const genericNumMatch = effect.match(/\d+/);
            if (genericNumMatch && !chosenAttr && statMatches.length === 0) {
               const curaValor = parseInt(genericNumMatch[0]) * qty;
               const novoHp = Math.min(character.hp_max, character.hp_current + Math.abs(curaValor));
               dbUpdates.hp_current = novoHp;
               lanEffects.push({
                 spellName: item.name,
                 mode: 'heal',
                 amount: Math.abs(curaValor),
                 description: item.descricao || item.properties || '',
               });
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
      for (const lanEffect of lanEffects) {
        void notifySelfLanSpellEvent(lanEffect);
      }

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
    if (!ensureLanWritable()) return;
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
    if (!ensureLanWritable()) return;
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

    const nextEquipment = { bag: newBag, slots: newSlots };
    if (lanInfo?.sessionId) {
      void runSheetAction(`equip:${activeSlot}`, async () => {
        const sent = await notifyInventoryPatch(nextEquipment, `${character.name} atualizou equipamentos equipados.`, makeLanEventId(), newStats);
        if (sent) {
          await updateDB(
            { equipment: nextEquipment, stats: newStats },
            { allowLanAuthoritativeCache: true, reason: 'lan_player_self_equip_patch' }
          );
        }
      });
    } else {
      void updateDB({ equipment: nextEquipment, stats: newStats });
    }
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

        {isLanReadOnly && (
          <Text style={[styles.sessionPartyHint, { color: appColors.warning, marginBottom: 10 }]}>
            Sessao pausada ou encerrada. Modo leitura.
          </Text>
        )}

        {activeVisualEffects.length > 0 && (
          <View style={[styles.sessionPlayerRow, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sessionPlayerName}>Voce esta sob efeito de</Text>
              <Text style={styles.sessionPlayerMeta}>
                {activeVisualEffects.map((effect: any) => effect.name || effect.status || 'Efeito').join(', ')}
              </Text>
            </View>
          </View>
        )}

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
      <TouchableOpacity
        style={[styles.equipSlotBox, item && styles.equipSlotBoxFilled, isLanReadOnly && { opacity: 0.65 }]}
        onPress={() => {
          if (!ensureLanWritable()) return;
          setActiveSlot(slotKey);
          setSlotModalVisible(true);
        }}
      >
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
    <LinearGradient colors={appGradients.main} style={[styles.container, conditionFrameStyle]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => {
          traceButton('sheet', 'SHEET_BACK', {
            sessionId: lanInfo?.sessionId || routeSessionId,
            characterId: character.id,
            characterName: character.name,
          });
          handleSheetBack();
        }}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
        <TouchableOpacity onPress={() => {
          traceButton('sheet', 'OPEN_DEBUG_TRACE', {
            sessionId: lanInfo?.sessionId || routeSessionId,
            characterId: character.id,
            characterName: character.name,
          });
          router.push('/debug-trace' as any);
        }}>
          <Text style={{ color: appColors.warning, fontWeight: 'bold' }}>Trace</Text>
        </TouchableOpacity>
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
                
                <TouchableOpacity style={[styles.badge, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                  traceButton('sheet', 'OPEN_XP_MODAL', {
                    mode: sheetRuntimeMode,
                    sessionId: lanInfo?.sessionId,
                    characterId: character.id,
                    characterName: character.name,
                    before: { xp: character.xp, level: character.level },
                  });
                  if (ensureLanWritable()) setXpModalVisible(true);
                }}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {xpTargetLabel}</Text>
                </TouchableOpacity>

                {isPendingLevelUp && (
                  <TouchableOpacity style={[styles.levelUpIconBtn, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (!ensureLanWritable()) return; setNewLevelData(expectedLevel); setLevelUpModalVisible(true);}}>
                    <Ionicons name="arrow-up" size={24} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <TouchableOpacity style={[styles.hpBarStyle, hpBonusFromCon !== 0 && {borderColor: hpBonusFromCon > 0 ? '#00fa9a' : '#ff6666', borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]} onPress={() => {
              traceButton('sheet', 'OPEN_HP_MODAL', {
                mode: sheetRuntimeMode,
                sessionId: lanInfo?.sessionId,
                characterId: character.id,
                characterName: character.name,
                before: { hp_current: character.hp_current, hp_max: character.hp_max, temp_hp: character.temp_hp },
              });
              if (ensureLanWritable()) setHpModalVisible(true);
            }}>
              <Text style={styles.hpTextStyle}>
                {displayHpCurrent} <Text style={styles.hpMaxTextStyle}>/ {displayHpMax}</Text>
                {Number(character.temp_hp || 0) > 0 && (
                  <Text style={{ color: appColors.success, fontWeight: '900' }}> +{Number(character.temp_hp || 0)}</Text>
                )}
              </Text>
              <Text style={styles.combatLabel}>PONTOS DE VIDA {hpBonusFromCon !== 0 && `(CON ${hpBonusFromCon > 0 ? '+' : ''}${hpBonusFromCon})`}</Text>
            </TouchableOpacity>

            <View style={styles.combatStatsRow}>
              <TouchableOpacity style={[styles.combatStatSmall, caSumBuffs !== 0 && {borderColor: caColor, borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]} 
                onPress={() => { if (!ensureLanWritable()) return; setActiveBuffStat('CA'); setTempBuffValue(String(caTemp)); setTempBuffModalVisible(true); }}>
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
                const lanEffectV = getLanStatEffectBonus(character, key);
                
                const totalV = baseV + tempV + equipV + lanEffectV;
                const sumBuffs = tempV + equipV + lanEffectV;
                const hasBuffs = sumBuffs !== 0;
                
                const buffColor = sumBuffs > 0 ? '#00fa9a' : '#ff6666';

                return (
                  <TouchableOpacity key={key} 
                    style={[styles.attrBox, hasBuffs && {borderColor: buffColor, borderWidth: 1}, isLanReadOnly && { opacity: 0.65 }]}
                    onPress={() => { if (!ensureLanWritable()) return; setActiveBuffStat(key); setTempBuffValue(String(tempV)); setTempBuffModalVisible(true); }}
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
              <TouchableOpacity style={[styles.addBtn, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setConvertModalVisible(true); }}>
                <Text style={styles.addBtnText}>💱 CÂMBIO</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.coinManager}>
              {[ { l: 'PO', k: 'gp', c: '#ffd700' }, { l: 'PP', k: 'sp', c: '#c0c0c0' }, { l: 'PC', k: 'cp', c: '#cd7f32' } ].map(c => (
                <View key={c.k} style={styles.coinControl}>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, -1)} style={[styles.coinBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.coinDisplay, isLanReadOnly && { opacity: 0.65 }]} onPress={() => { if (!ensureLanWritable()) return; setActiveCoinType(c.k as any); setInputValue(character[c.k].toString()); setCoinModalVisible(true); }}>
                    <Text style={[styles.coinLabel, {color: c.c}]}>{c.l}</Text>
                    <Text style={[styles.coinValText, {textDecorationLine: 'underline'}]}>{character[c.k]}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, 1)} style={[styles.coinBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.headerSpaceBetween}>
                <Text style={styles.sectionTitle}>MOCHILA (Bolsos)</Text>
                {!lanInfo?.sessionId && (
                  <TouchableOpacity style={styles.addBtn} onPress={() => setItemModalVisible(true)}><Text style={styles.addBtnText}>+ ITEM</Text></TouchableOpacity>
                )}
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
                            <TouchableOpacity onPress={() => updateBagQty(i, -1)} style={[styles.smallQtyBtn, isLanReadOnly && { opacity: 0.55 }]}><Text style={styles.smallQtyBtnText}>-</Text></TouchableOpacity>
                            <Text style={styles.itemQty}>{item.qty}</Text>
                            {!lanInfo?.sessionId && (
                              <TouchableOpacity onPress={() => updateBagQty(i, 1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>+</Text></TouchableOpacity>
                            )}
                        </View>
                        
                        <TouchableOpacity 
                          style={{flex: 1}} 
                          onPress={() => {
                            if (!ensureLanWritable()) return;
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
                    <TouchableOpacity style={[styles.tradeActionButton, {marginTop: 14}, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) startSpellCast(selectedSpell); }}>
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
                    {isSpellAttackRollRequired(selectedSpell) && (
                      <>
                        <View style={styles.modalRowButtons}>
                          <TouchableOpacity style={styles.tradeActionButton} onPress={rollSpellAttackForTargets}>
                            <Ionicons name="flash" size={18} color="#00bfff" />
                            <Text style={styles.tradeActionButtonText}>Rolar ataque</Text>
                          </TouchableOpacity>
                          <View style={styles.tradeActionButton}>
                            <Ionicons name="shield" size={18} color="#00bfff" />
                            <Text style={styles.tradeActionButtonText}>{formatSignedModifier(getSpellAttackModifier(selectedSpell))} ataque</Text>
                          </View>
                        </View>
                        <View style={styles.spellResultBox}>
                          <Text style={styles.spellResultText}>
                            {spellAttackRollResult || `Ataque: 1d20 ${formatSignedModifier(getSpellAttackModifier(selectedSpell))}`}
                          </Text>
                        </View>
                      </>
                    )}
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
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TextInput
                              style={styles.spellAmountInput}
                              value={spellTargetAmounts[item.key] || ''}
                              onChangeText={(value) => {
                                setSpellRollMode('manual');
                                setSpellTargetAmounts((current) => ({ ...current, [item.key]: value }));
                              }}
                              keyboardType="numeric"
                              placeholder={isSpellAttackRollRequired(selectedSpell) ? 'Dano' : '0'}
                              placeholderTextColor="#666"
                            />
                            {isSpellAttackRollRequired(selectedSpell) && (
                              <TextInput
                                style={styles.spellAmountInput}
                                value={spellTargetAttackRolls[item.key] || ''}
                                onChangeText={(value) => {
                                  setSpellAttackRollMode('manual');
                                  setSpellTargetAttackRolls((current) => ({ ...current, [item.key]: value }));
                                }}
                                keyboardType="numeric"
                                placeholder="d20"
                                placeholderTextColor="#666"
                              />
                            )}
                          </View>
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
                      setSpellTargetAttackRolls({ [self.key]: spellTargetAttackRolls[self.key] || '' });
                    }}
                  >
                    <Ionicons name="person" size={18} color="#00bfff" />
                    <Text style={styles.tradeActionButtonText}>Usar em mim</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.lvlUpBtnPrimary, isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`) && { opacity: 0.5 }]}
                  disabled={isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`)}
                  onPress={applySpellCast}
                >
                  <Text style={styles.lvlUpBtnPrimaryText}>
                    {isSheetActionSubmitting(`spell_cast:${selectedSpell?.id || selectedSpell?.name || 'unknown'}`) ? 'Enviando...' : 'Aplicar magia'}
                  </Text>
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
                const isConvertingCoins = isSheetActionSubmitting('coin:convert');

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
                      <TouchableOpacity style={[styles.modalBtn, {opacity: isValid && !isConvertingCoins ? 1 : 0.5}]} disabled={!isValid || isConvertingCoins} onPress={() => executeCoinConversion(sourceAmount, targetAmount)}>
                        <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isConvertingCoins ? 'Convertendo...' : 'Converter'}</Text>
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
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting('temp_buff') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting('temp_buff')} onPress={handleTempBuffSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting('temp_buff') ? 'Aplicando...' : 'Aplicar Buff'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Modal de Ações do Item na Mochila */}
      <Modal visible={!!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedBagItem(null)}>
          <View style={styles.actionModalBox}>
            {selectedBagItem && (() => {
              const hydratedSelectedItem = hydrateInventoryItemForEffects(selectedBagItem.item);
              const itemLore = hydratedSelectedItem?.descricao || '';
              const structuredSelectedEffects = parseStructuredEffects(hydratedSelectedItem.effect_json);
              const structuredEffectLabel = summarizeStructuredItemEffects(structuredSelectedEffects);
              const effectHidden = getItemEffectHidden(hydratedSelectedItem);
              const visibleEffectLabel = effectHidden
                ? 'Efeito desconhecido. O efeito será revelado ao consumir.'
                : (structuredEffectLabel || hydratedSelectedItem.damage || 'Efeito nao configurado');
              const p = (hydratedSelectedItem.properties || '').toLowerCase();
              const d = (hydratedSelectedItem.damage || '').toLowerCase();
              const dt = (hydratedSelectedItem.damage_type || '').toLowerCase();
              const n = (hydratedSelectedItem.name || '').toLowerCase();
              const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || structuredSelectedEffects.length > 0 || n.includes('poção') || n.includes('pocao');

              return (
              <>
                <Text style={styles.modalTitle}>{hydratedSelectedItem.name}</Text>
                
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
                      <Text style={styles.itemStatText}>⚔️ Dano/Efeito: <Text style={{color: effectHidden ? '#ffd166' : '#00fa9a'}}>{effectHidden ? 'Efeito desconhecido' : (hydratedSelectedItem.damage || '-')}</Text></Text>
                      <Text style={styles.itemStatText}>🛡️ Propriedades: {selectedBagItem.item.properties || '-'}</Text>
                    </>
                  ) : (
                    <Text style={styles.itemStatText}>🧪 Efeito: <Text style={{color: effectHidden ? '#ffd166' : '#00fa9a'}}>{visibleEffectLabel}</Text></Text>
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
                    <TouchableOpacity style={[styles.actionBtnConsume, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                      if (!ensureLanWritable()) return;
                      const {item, index} = selectedBagItem;
                      const qty = actionQty;
                      setSelectedBagItem(null);
                      processConsumeItem(index, item, qty);
                    }}>
                      <Ionicons name="flask" size={20} color="#00fa9a" />
                      <Text style={styles.actionBtnConsumeText}>Consumir</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={[styles.actionBtnThrow, isLanReadOnly && { opacity: 0.55 }]} onPress={() => {
                    if (!ensureLanWritable()) return;
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
                      <TouchableOpacity style={[styles.tradeActionButton, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setTargetPickerMode('send'); }}>
                        <Ionicons name="send" size={18} color="#00bfff" />
                        <Text style={styles.tradeActionButtonText}>Enviar para</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.tradeActionButton, isLanReadOnly && { opacity: 0.55 }]} onPress={() => { if (ensureLanWritable()) setTargetPickerMode('trade'); }}>
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
                (() => {
                  const targetActionId = targetPickerMode === 'send' ? `send_item:${item.key}` : `trade_offer:${item.key}`;
                  const isTargetActionPending = isSheetActionSubmitting(targetActionId);
                  return (
                    <TouchableOpacity
                      style={[styles.tradeItemChoice, isTargetActionPending && { opacity: 0.5 }]}
                      disabled={isTargetActionPending}
                      onPress={() => targetPickerMode === 'send' ? handleSendItemToPlayer(item) : handleOfferTradeToPlayer(item)}
                    >
                      <Text style={styles.tradeSlotName}>{item.characterName}</Text>
                      <Text style={styles.tradeSlotMeta}>Nivel {item.level} - HP {item.hpCurrent}/{item.hpMax}{item.tempHp > 0 ? ` +${item.tempHp}` : ''}</Text>
                    </TouchableOpacity>
                  );
                })()
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
                  <TouchableOpacity
                    style={[styles.modalBtn, isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`) && { opacity: 0.5 }]}
                    disabled={isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`)}
                    onPress={() => handleDeclineTrade(selectedTradeOffer)}
                  >
                    <Text style={{color:'#ff6666', fontWeight:'bold'}}>{isSheetActionSubmitting(`trade_decline:${selectedTradeOffer.id}`) ? 'Recusando...' : 'Recusar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, {opacity: tradeCounterItem && !isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`) ? 1 : 0.5}]}
                    disabled={!tradeCounterItem || isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`)}
                    onPress={handleAcceptTrade}
                  >
                    <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting(`trade_accept:${selectedTradeOffer.id}`) ? 'Aceitando...' : 'Aceitar'}</Text>
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
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(`coin:set:${activeCoinType}`) && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(`coin:set:${activeCoinType}`)} onPress={handleCoinSubmit}>
                <Text style={{color:'#00fa9a', fontWeight:'bold'}}>{isSheetActionSubmitting(`coin:set:${activeCoinType}`) ? 'Enviando...' : 'Confirmar'}</Text>
              </TouchableOpacity>
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
              {!xpModalVisible && (
                <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting('temp_hp') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting('temp_hp')} onPress={handleTempHP}><Text style={{color:'#00bfff', fontWeight:'bold'}}>PV Temp</Text></TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(xpModalVisible ? 'xp:remove' : 'hp:damage') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(xpModalVisible ? 'xp:remove' : 'hp:damage')} onPress={() => xpModalVisible ? handleXP('remove') : handleHP('damage')}><Text style={{color:'#ff6666', fontWeight:'bold'}}>{xpModalVisible ? '- Remover' : '⚔️ Dano'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, isSheetActionSubmitting(xpModalVisible ? 'xp:add' : 'hp:heal') && { opacity: 0.5 }]} disabled={isSheetActionSubmitting(xpModalVisible ? 'xp:add' : 'hp:heal')} onPress={() => xpModalVisible ? handleXP('add') : handleHP('heal')}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{xpModalVisible ? '+ Adicionar' : '💖 Cura'}</Text></TouchableOpacity>
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
      <Modal visible={!!pendingEffectSave} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>Teste de Salvaguarda</Text>
            <Text style={styles.customAlertMessage}>
              {(pendingEffectSave?.sourceEffectName || 'Efeito')} exige {pendingEffectSave?.saveAbility}
              {pendingEffectSave?.dc ? ` CD ${pendingEffectSave.dc}` : ''}.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={saveManualValue}
              onChangeText={setSaveManualValue}
              keyboardType="numeric"
              placeholder="Valor do d20 fisico"
              placeholderTextColor="#666"
            />
            <View style={styles.customAlertBtnRow}>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00bfff', borderWidth: 1 }, pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`) && { opacity: 0.5 }]}
                disabled={Boolean(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`))}
                onPress={() => pendingEffectSave && rollVirtualEffectSave(pendingEffectSave)}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00bfff' }]}>Rolar d20</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customAlertBtn, { borderColor: '#00fa9a', borderWidth: 1, opacity: parseInt(saveManualValue, 10) > 0 && !(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`)) ? 1 : 0.5 }]}
                disabled={!(parseInt(saveManualValue, 10) > 0) || Boolean(pendingEffectSave && isSheetActionSubmitting(`save:${pendingEffectSave.id}`))}
                onPress={() => {
                  if (!pendingEffectSave) return;
                  void sendEffectSaveResult(pendingEffectSave, Math.max(1, Math.min(20, parseInt(saveManualValue, 10) || 1)), 'manual');
                }}
              >
                <Text style={[styles.customAlertBtnText, { color: '#00fa9a' }]}>Enviar manual</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
        <DiceRoller3D rollRequest={diceRollRequest} onRollComplete={handleSpellDiceComplete}/>
    </LinearGradient>
  );
}

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getInviteCodeFromPayloadJson(value?: string | null) {
  if (!value) return '';

  try {
    const payload = JSON.parse(value) as LanSessionPayload;
    return String(payload?.session?.inviteCode || '').trim();
  } catch {
    return '';
  }
}

function decodeParam(value?: string) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function markLanEffectForLocalCharacter(effect: any, event?: LanSessionEvent) {
  const id = String(effect?.id || '');
  return {
    ...effect,
    origin: 'lan',
    sessionId: event?.sessionId || effect?.sessionId,
    sourceType: 'lan_session',
    appliedBy: event?.fromKey || effect?.appliedBy || 'master',
    lanEventId: event?.id || effect?.lanEventId,
    lanEffectId: effect?.lanEffectId || id,
  };
}

function parseSpellDuration(duration?: string): { durationRemaining: number; durationUnit: LanEffectUnit } {
  const raw = String(duration || '').toLowerCase();
  const value = Math.max(1, parseInt(raw.match(/\d+/)?.[0] || '1'));

  if (raw.includes('permanent') || raw.includes('permanente')) return { durationRemaining: 0, durationUnit: 'permanent' };
  if (raw.includes('manual')) return { durationRemaining: 0, durationUnit: 'manual' };
  if (raw.includes('concentra') || raw.includes('concentration')) return { durationRemaining: value, durationUnit: 'concentration' };
  if (raw.includes('equip')) return { durationRemaining: 0, durationUnit: 'while_equipped' };
  if (raw.includes('turno') || raw.includes('rodada')) return { durationRemaining: value, durationUnit: 'turn' };
  if (raw.includes('hora')) return { durationRemaining: value, durationUnit: 'hour' };
  if (raw.includes('min')) return { durationRemaining: value, durationUnit: 'minute' };
  return { durationRemaining: 1, durationUnit: 'rest' };
}

function isLanSessionEndedEvent(event: LanSessionEvent) {
  if (event.type === 'session_ended') return true;
  if (event.type !== 'session_patch') return false;
  if (event.sessionPatch?.status === 'ended') return true;
  if (event.sessionEnded?.endedAt || event.sessionEnded?.unlinkPlayers) return true;
  const message = String(event.message || '').toLowerCase();
  return message.includes('encerr') || message.includes('ended') || message.includes('host_closed');
}

type SheetActiveEffect = {
  id?: string;
  name?: string;
  target?: string;
  value?: number | string | null;
  mode?: string | null;
  [key: string]: unknown;
};

const STAT_EFFECT_TARGETS = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'] as const;

function getLanStatEffectBonus(character: any, stat: string): number {
  const effects: SheetActiveEffect[] = Array.isArray(character?.active_effects)
    ? (character.active_effects as SheetActiveEffect[])
    : safeJsonParse<SheetActiveEffect[]>(character?.active_effects_json, []);

  return effects.reduce<number>((sum: number, effect: SheetActiveEffect) => {
    if (String(effect?.target || '').toUpperCase() !== stat) return sum;
    if (String(effect?.mode || 'add') === 'set') return sum;

    return sum + (Number(effect?.value) || 0);
  }, 0);
}

function summarizeStatEffectBonuses(effects: SheetActiveEffect[] = []): Record<string, number> {
  const result: Record<string, number> = {};

  for (const effect of effects) {
    const target = String(effect?.target || '').toUpperCase();

    if (!STAT_EFFECT_TARGETS.includes(target as (typeof STAT_EFFECT_TARGETS)[number])) continue;
    if (String(effect?.mode || 'add') === 'set') continue;

    result[target] = (result[target] || 0) + (Number(effect?.value) || 0);
  }

  return result;
}

function getItemEffectDuration(item: any, effect: any): { text: string; remaining: number; unit: LanEffectUnit; isPermanent?: boolean } {
  const conditionDuration = effect?.condition?.duration || {};
  const durationText = String(effect?.durationText || '').toLowerCase();
  const durationUnit = effect?.durationUnit ?? effect?.duration_unit ?? conditionDuration.unit ?? item?.duration_unit;

  if (durationUnit === 'permanent' || durationText.includes('permanente')) {
    return {
      text: 'Permanente',
      remaining: 0,
      unit: 'permanent',
      isPermanent: true,
    };
  }

  const remaining = Math.max(
    1,
    Number(effect?.durationValue ?? effect?.duration_value ?? conditionDuration.value ?? item?.duration_value ?? 1) || 1
  );
  const unit = normalizeLanEffectUnit(
    durationUnit
  );
  return {
    text: `${remaining} ${unit}`,
    remaining,
    unit,
    isPermanent: unit === 'permanent',
  };
}

function makeLocalItemEffect(
  item: any,
  input: {
    name: string;
    target: string;
    value: number;
    duration: { text: string; remaining: number; unit: LanEffectUnit; isPermanent?: boolean };
    permanent: boolean;
  }
) {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    status: input.permanent ? 'permanent_item_effect' : 'item_effect',
    target: normalizeLanEffectTarget(input.target),
    value: input.value,
    remaining: input.duration.remaining,
    unit: input.duration.unit,
    isPermanent: input.permanent || input.duration.isPermanent || input.duration.unit === 'permanent',
    durationText: input.duration.text,
    color: input.permanent ? '#00fa9a' : '#00bfff',
    secondaryColor: '#8be9fd',
    source: item.name,
    visibleToPlayer: true,
    visualPriority: input.permanent ? 70 : 50,
  };
}

function normalizeLanEffectUnit(value: unknown): LanEffectUnit {
  if (
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
  const raw = String(value || '').toLowerCase();
  if (raw.includes('permanent') || raw.includes('permanente')) return 'permanent';
  if (raw.includes('manual')) return 'manual';
  if (raw.includes('concentra') || raw.includes('concentration')) return 'concentration';
  if (raw.includes('equip')) return 'while_equipped';
  if (raw.includes('turno') || raw.includes('rodada')) return 'turn';
  if (raw.includes('hora')) return 'hour';
  if (raw.includes('min')) return 'minute';
  return 'rest';
}

function normalizeLanEffectTarget(value: unknown): LanEffectTarget {
  const target = String(value || '').toUpperCase();
  if (target === 'FOR' || target === 'DES' || target === 'CON' || target === 'INT' || target === 'SAB' || target === 'CAR' || target === 'CA' || target === 'HP' || target === 'PV_TEMP') {
    return target as LanEffectTarget;
  }
  return 'custom';
}

function summarizeStructuredItemEffects(effects: any[]) {
  if (!effects?.length) return '';

  return effects.map((effect) => {
    const type = String(effect.effectType || effect.type || effect.kind || '').toLowerCase();
    const target = String(effect.target || '').toUpperCase();
    const value = Number(effect.value || 0);
    const condition = effect.condition;
    const duration = String(effect.durationText || effect.durationUnit || '').toLowerCase();
    const suffix = duration ? ` (${effect.durationText || effect.durationUnit})` : '';

    if (effect.chooseStat || target === 'CHOOSE_STAT' || String(effect.effectType || '') === 'Escolher Atributo') {
      return `Escolher atributo ${value >= 0 ? '+' : ''}${value}${suffix}`;
    }

    if (['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA', 'PV_TEMP'].includes(target)) {
      return `${target} ${value >= 0 ? '+' : ''}${value}${suffix}`;
    }

    if (type === 'heal') return `Cura ${value || effect.healDice || effect.dice || ''}`.trim();
    if (condition?.name) return condition.name;
    if (effect.damageType) return `${effect.damageDice || effect.dice || value} ${effect.damageType}`.trim();
    return effect.name || effect.label || 'Efeito configurado';
  }).filter(Boolean).join(' + ');
}


async function ensureItemEffectHiddenColumn(db: any) {
  try {
    await db.execAsync(`ALTER TABLE items ADD COLUMN effect_hidden INTEGER DEFAULT 0;`);
  } catch {
    // Column already exists or the schema is not initialized yet.
  }
}

function toBooleanFlag(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'sim' || normalized === 'yes';
  }
  return false;
}

function getEffectJsonHiddenFlag(value: unknown): boolean {
  if (!value) return false;

  const normalize = (input: unknown, depth = 0): boolean => {
    if (!input || depth > 3) return false;
    if (typeof input === 'string') {
      const raw = input.trim();
      if (!raw || raw === '-' || raw.toLowerCase() === 'null') return false;
      try {
        return normalize(JSON.parse(raw), depth + 1);
      } catch {
        return false;
      }
    }

    if (typeof input === 'object' && !Array.isArray(input)) {
      const obj = input as any;
      if (toBooleanFlag(obj.effectHidden) || toBooleanFlag(obj.hiddenEffect) || toBooleanFlag(obj.effect_hidden)) return true;
      if (obj.meta && normalize(obj.meta, depth + 1)) return true;
      if (obj.effect_json && normalize(obj.effect_json, depth + 1)) return true;
    }

    return false;
  };

  return normalize(value);
}

function getItemEffectHidden(...items: any[]): boolean {
  return items.some((item) => (
    toBooleanFlag(item?.effect_hidden) ||
    toBooleanFlag(item?.effectHidden) ||
    toBooleanFlag(item?.hiddenEffect) ||
    getEffectJsonHiddenFlag(item?.effect_json)
  ));
}

function parseStructuredEffects(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);

  const normalize = (input: unknown): any[] => {
    if (!input) return [];
    if (Array.isArray(input)) return input.filter(Boolean);

    if (typeof input === 'string') {
      const raw = input.trim();
      if (!raw || raw === '-' || raw.toLowerCase() === 'null') return [];
      try {
        return normalize(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    if (typeof input === 'object') {
      const obj = input as any;
      if (Array.isArray(obj.effects)) return normalize(obj.effects);
      if (Array.isArray(obj.effect)) return normalize(obj.effect);
      if (Array.isArray(obj.items)) return normalize(obj.items);
      if (Array.isArray(obj.data)) return normalize(obj.data);
      if (obj.effect_json) return normalize(obj.effect_json);
      if (obj.type || obj.kind || obj.effectType || obj.target || obj.chooseStat || obj.condition) return [obj];
    }

    return [];
  };

  return normalize(value);
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
