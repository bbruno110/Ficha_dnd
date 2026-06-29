import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { AppState, AppStateStatus } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LanTcpClient } from '../network/LanTcpClient';
import { LanTcpServer, LanTcpStreamMessage } from '../network/LanTcpServer';
import { getLanAddressCandidates } from '../network/lanAddresses';
import { discoverLanMaster } from '../network/lanDiscovery';
import { LanRpcRequest, LanRpcResponse, makeRpcId, sendLanRpc } from '../network/lanRpcTransport';
import { buildSessionShareCode, makeShortSessionCode, parseSessionCode } from '../network/lanProtocol';
import { addFunctionTraceLog } from '../network/traceRepository';
import { LanForegroundService } from '../services/lan/LanForegroundService';
import {
  appendLanOfficialEvent,
  getLanEventsSince,
  getLanEventByCommandId,
  getLanTradeCounterEvent,
  getLanTradeResolutionEvent,
  getLanHistoryPage,
  getCharacterLinkedLanSession,
  getLanSessionById,
  getLanSessions,
  getLanSessionState,
  getActiveLanSession,
  getCharacterSnapshot,
  getLanPlayers,
  getLocalPlayerName,
  getOrCreateDeviceId,
  getSelectedCustomContentPayloads,
  linkCharacterToSession,
  saveLanOfficialEvent,
  saveCharacterSnapshot,
  saveLanSession,
  selectedContentFromSession,
  setLanSessionStatus,
  updateLanSessionState,
  updateLocalPlayerName,
  upsertCustomContentPayloads,
  upsertLanPlayer,
} from '../network/lanRepository';
import {
  LAN_DEFAULT_PORT,
  LanCharacterMessage,
  LanCommandKind,
  LanCommandMessage,
  LanCustomContentMessage,
  LanOfficialEventMessage,
  LanSessionStatus,
  LanSessionRecord,
  LanSessionSnapshotMessage,
} from '../types/lan';
import {
  LanConnectionStatus,
  LanPlayerSummary,
  LanSessionContextValue,
  JoinSessionOptions,
  StartMasterOptions,
} from './lan/LanSessionTypes';
import {
  addItemToEquipment,
  clearTempHpEffects,
  cloneTransferItem,
  consumeTempHpEffects,
  delay,
  getTradeExpiresAt,
  isTradeEventExpired,
  makeCommandId,
  makeSessionConfig,
  makeTradeExpiresAt,
  normalizeEquipment,
  normalizeItemName,
  normalizeStats,
  numberFromPayload,
  parseJsonValue,
  progressTimedEffects,
  removeItemFromEquipment,
  removeTimedEffect,
  shouldIncludeAvatarInSnapshot,
} from './lan/lanSessionHelpers';

const LanSessionContext = createContext<LanSessionContextValue | null>(null);

function formatCoinsRequestFromPayload(payload: Record<string, any>) {
  const gp = Math.max(0, Number(payload.gp || 0));
  const sp = Math.max(0, Number(payload.sp || 0));
  const cp = Math.max(0, Number(payload.cp || 0));
  const fallbackAmount = Math.max(0, Number(payload.amount || 0));
  const parts = [
    gp > 0 ? `${gp} PO` : '',
    sp > 0 ? `${sp} PP` : '',
    cp > 0 ? `${cp} PC` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' + ') : fallbackAmount > 0 ? `${fallbackAmount} PO` : 'moedas';
}

function formatPlayerRequestDescription(actorName: string, command: LanCommandKind, payload: Record<string, any>) {
  const amount = Math.max(0, Number(payload.amount || 0));
  if (command === 'PLAYER_REQUEST_HP') {
    const mode = String(payload.mode || 'heal');
    return `${actorName} solicitou ${amount} PV${mode === 'damage' ? ' de dano' : ' de cura'}.`;
  }
  if (command === 'PLAYER_REQUEST_XP') {
    return `${actorName} solicitou ${amount} XP.`;
  }
  if (command === 'PLAYER_REQUEST_COINS') {
    return `${actorName} solicitou ${formatCoinsRequestFromPayload(payload)}.`;
  }
  if (command === 'PLAYER_REQUEST_ATTRIBUTE') {
    const stat = String(payload.stat || 'atributo').toUpperCase();
    return `${actorName} solicitou ${amount > 0 ? `+${amount} ` : ''}${stat}.`;
  }
  return `${actorName} enviou uma solicitação ao mestre.`;
}

function estimateJsonBytes(value: unknown) {
  try {
    return JSON.stringify(value)?.length || 0;
  } catch {
    return -1;
  }
}

const LAN_SYNC_DEFAULT_EVENT_LIMIT = 200;
const LAN_SYNC_PUSH_EVENT_WINDOW = 24;
const LAN_SYNC_PUSH_EVENT_LIMIT = 32;
const LAN_SYNC_PUSH_RECENT_LIMIT = 6;
const LAN_HP_BATCH_WINDOW_MS = 90;
const LAN_PLAYER_POLL_CONNECTED_INTERVAL_MS = 3200;
const LAN_PLAYER_POLL_RECONNECTING_INTERVAL_MS = 6500;
const LAN_PLAYER_POLL_PAUSED_INTERVAL_MS = 9000;
const LAN_PLAYER_POLL_TIMEOUT_MS = 2400;
const LAN_PLAYER_POLL_PAUSED_TIMEOUT_MS = 1600;
const LAN_PLAYER_POLL_FAILURES_BEFORE_RECOVERY = 3;
const LAN_DISCOVERY_RETRY_COOLDOWN_MS = 22000;
const LAN_RECOVERY_RETRY_BASE_MS = 8000;
const LAN_RECOVERY_RETRY_MAX_MS = 45000;
const LAN_MASTER_OFFLINE_GRACE_MS = 120000;

type BuildRpcSyncPayloadOptions = {
  sinceSeq?: number;
  eventLimit?: number;
  recentLimit?: number;
  includeRecentEvents?: boolean;
  includePlayerSnapshots?: boolean;
  includeCustomContent?: boolean;
  compact?: boolean;
};

type PendingHpBatchCommand = {
  command: LanCommandMessage;
  peerId?: string;
  queuedAt: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type PendingHpBatch = {
  timer: ReturnType<typeof setTimeout>;
  entries: PendingHpBatchCommand[];
};

function isBatchableMasterHpCommand(command: LanCommandMessage) {
  if (command.command !== 'MASTER_APPLY_HP') return false;
  if (command.payload?.requestCommandId) return false;
  const mode = String(command.payload?.mode || 'damage');
  if (mode !== 'damage' && mode !== 'heal') return false;
  const targetCharacterId = Number(command.payload?.targetCharacterId || 0);
  if (!targetCharacterId) return false;
  return Math.abs(numberFromPayload(command.payload, 'amount', 0)) > 0;
}

function makeHpBatchKey(command: LanCommandMessage) {
  const mode = String(command.payload?.mode || 'damage');
  const targetDeviceId = String(command.payload?.targetDeviceId || 'local');
  const targetCharacterId = String(command.payload?.targetCharacterId || '');
  const targetName = String(command.payload?.targetName || '').trim();
  const actorDeviceId = String(command.deviceId || 'master');
  return [mode, targetDeviceId, targetCharacterId, targetName, actorDeviceId].join('|');
}

function makeBatchedHpCommand(entries: PendingHpBatchCommand[]) {
  const first = entries[0].command;
  if (entries.length <= 1) return first;

  const amount = entries.reduce((total, entry) => (
    total + Math.abs(numberFromPayload(entry.command.payload, 'amount', 0))
  ), 0);

  return {
    ...first,
    payload: {
      ...(first.payload || {}),
      amount,
      batchCount: entries.length,
      batchedCommandIds: entries.map(entry => entry.command.commandId),
    },
  };
}

export function LanSessionProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [activeSession, setActiveSession] = useState<LanSessionRecord | null>(null);
  const [savedSessions, setSavedSessions] = useState<LanSessionRecord[]>([]);
  const [isTransportReady, setIsTransportReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'syncing' | 'reconnecting' | 'disconnected'>('disconnected');
  const [peerCount, setPeerCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [lanRevision, setLanRevision] = useState(0);
  const [localDeviceId, setLocalDeviceId] = useState('');
  const [players, setPlayers] = useState<LanPlayerSummary[]>([]);
  const rpcServerRef = useRef<LanTcpServer | null>(null);
  const tcpClientRef = useRef<LanTcpClient | null>(null);
  const tcpClientKeyRef = useRef('');
  const tcpClientConnectedRef = useRef(false);
  const activeSessionRef = useRef<LanSessionRecord | null>(null);
  const closingSessionRef = useRef<LanSessionRecord | null>(null);
  const closingSessionPendingDevicesRef = useRef<Record<string, Set<string>>>({});
  const closingSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceIdRef = useRef<string>('');
  const customContentCacheRef = useRef<LanCustomContentMessage['records']>([]);
  const reconnectingRef = useRef(false);
  const suppressReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionGenerationRef = useRef(0);
  const reconnectFailureCountRef = useRef<Record<string, number>>({});
  const joinedCharacterEventsRef = useRef<Record<string, boolean>>({});
  const closedAckSentRef = useRef<Record<string, boolean>>({});
  const finalizingClosedSessionsRef = useRef<Set<string>>(new Set());
  const recoverLanSessionRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hpCommandBatchRef = useRef<Record<string, PendingHpBatch>>({});
  const playerPollInFlightRef = useRef(false);
  const playerPollFailureCountRef = useRef<Record<string, number>>({});
  const lastDiscoveryAttemptAtRef = useRef<Record<string, number>>({});
  const delayedOfflineTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pushTcpSyncRef = useRef<((session: LanSessionRecord, reason?: string) => Promise<void>) | null>(null);
  const scheduledPushSyncRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    session: LanSessionRecord;
    reasons: Set<string>;
  } | null>(null);

  const setTransportReadyState = useCallback((ready: boolean) => {
    setIsTransportReady(ready);
  }, []);

  const setLanConnectionStatus = useCallback((status: LanConnectionStatus) => {
    setConnectionStatus(status);
  }, []);

  const scheduleLanReconnect = useCallback(
    (reason = 'transport-closed', delayMs = 650) => {
      const session = activeSessionRef.current;
      if (!session || session.status === 'closed' || session.role !== 'player') return;
      if (suppressReconnectRef.current) return;
      if (reconnectTimerRef.current) return;
      if (reconnectingRef.current && !reason.startsWith('recover-retry')) return;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void recoverLanSessionRef.current?.(reason);
      }, delayMs);
    },
    []
  );

  const traceLan = useCallback(
    async (
      action: string,
      functionName: string,
      step: string,
      message: string,
      metadata?: Record<string, unknown>,
      level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
      requestId?: string | null
    ) => {
      try {
        const session = activeSessionRef.current;
        await addFunctionTraceLog(db, {
          level,
          category: 'lan',
          action,
          functionName,
          sourceFile: 'src/contexts/LanSessionContext.tsx',
          step,
          requestId: requestId || null,
          durationMs: typeof metadata?.durationMs === 'number' ? metadata.durationMs : null,
          entityTable: 'lan_sessions',
          entityId: session?.id || null,
          message,
          metadata: {
            role: session?.role || null,
            sessionStatus: session?.status || null,
            deviceId: deviceIdRef.current || null,
            ...metadata,
          },
        });
      } catch {
        // Tracer nunca deve bloquear a sessão LAN.
      }
    },
    [db, setLanConnectionStatus, setTransportReadyState]
  );

  const makeRpcResponse = useCallback(
    (request: LanRpcRequest, ok: boolean, payload?: Record<string, unknown>, error?: string): LanRpcResponse => ({
      type: 'LAN_RPC_RESPONSE',
      id: request.id,
      ok,
      payload,
      error,
      at: new Date().toISOString(),
    }),
    []
  );

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const refreshPlayers = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) {
      setPlayers([]);
      return;
    }

    const rows = await getLanPlayers(db, session.id);
    setPlayers(rows);
  }, [db]);

  const refreshSavedSessions = useCallback(async () => {
    const sessions = await getLanSessions(db, false);
    setSavedSessions(sessions);
  }, [db]);

  const refreshActiveSession = useCallback(async () => {
    const session = await getActiveLanSession(db);
    setActiveSession(session || null);
    activeSessionRef.current = session || null;
    if (session) await refreshPlayers();
    await refreshSavedSessions();
  }, [db, refreshPlayers, refreshSavedSessions]);

  const deactivateCurrentSessionLocally = useCallback(async (reason = 'switch-session') => {
    const current = activeSessionRef.current;
    sessionGenerationRef.current += 1;
    suppressReconnectRef.current = true;
    tcpClientRef.current?.close();
    tcpClientRef.current = null;
    tcpClientKeyRef.current = '';
    tcpClientConnectedRef.current = false;
    await rpcServerRef.current?.close();
    rpcServerRef.current = null;
    suppressReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    playerPollInFlightRef.current = false;
    if (closingSessionTimerRef.current) {
      clearTimeout(closingSessionTimerRef.current);
      closingSessionTimerRef.current = null;
    }
    closingSessionPendingDevicesRef.current = {};
    closingSessionRef.current = null;
    reconnectFailureCountRef.current = {};
    playerPollFailureCountRef.current = {};
    lastDiscoveryAttemptAtRef.current = {};
    Object.values(delayedOfflineTimersRef.current).forEach(timer => clearTimeout(timer));
    delayedOfflineTimersRef.current = {};
    joinedCharacterEventsRef.current = {};
    closedAckSentRef.current = {};
    await LanForegroundService.stop().catch(() => undefined);
    setTransportReadyState(false);
    setLanConnectionStatus('disconnected');
    setPeerCount(0);
    setPlayers([]);

    if (current && current.status !== 'closed' && current.status !== 'paused') {
      await setLanSessionStatus(db, current.id, 'inactive');
      await traceLan('FUNCTION', 'deactivateCurrentSessionLocally', 'inactive', 'Sessao LAN local ficou inativa, preservando o vinculo da ficha para retomada.', {
        reason,
        sessionId: current.id,
        linkedCharacterId: current.linked_character_id || null,
      }, 'info');
    } else if (current?.status === 'paused') {
      await traceLan('FUNCTION', 'deactivateCurrentSessionLocally', 'paused_kept', 'Sessao pausada mantida na lista para retomada.', {
        reason,
        sessionId: current.id,
      }, 'info');
    }

    setActiveSession(null);
    activeSessionRef.current = null;
    await refreshSavedSessions();
  }, [db, refreshSavedSessions, setLanConnectionStatus, setTransportReadyState, traceLan]);

  const finishClosedSessionHost = useCallback(
    async (sessionId: string, reason = 'closed-delivered') => {
      if (closingSessionRef.current?.id !== sessionId) return;
      if (closingSessionTimerRef.current) {
        clearTimeout(closingSessionTimerRef.current);
        closingSessionTimerRef.current = null;
      }
      closingSessionPendingDevicesRef.current[sessionId]?.clear();
      delete closingSessionPendingDevicesRef.current[sessionId];
      joinedCharacterEventsRef.current = {};
      Object.values(delayedOfflineTimersRef.current).forEach(timer => clearTimeout(timer));
      delayedOfflineTimersRef.current = {};
      await rpcServerRef.current?.close();
      rpcServerRef.current = null;
      closingSessionRef.current = null;
      await LanForegroundService.stop().catch(() => undefined);
      setTransportReadyState(false);
      setLanConnectionStatus('disconnected');
      setPeerCount(0);
      setPlayers([]);
      setActiveSession(null);
      activeSessionRef.current = null;
      await refreshSavedSessions();
      await traceLan('FUNCTION', 'finishClosedSessionHost', 'done', 'Host da sessao encerrada foi fechado apos entrega do encerramento.', {
        sessionId,
        reason,
      }, 'info');
    },
    [refreshSavedSessions, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const sendClosedSessionAck = useCallback(
    async (session: LanSessionRecord, reason = 'session-closed') => {
      if (session.role !== 'player' || !session.host_ip || !session.port) return;
      if (closedAckSentRef.current[session.id]) return;
      closedAckSentRef.current[session.id] = true;

      try {
        const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
        deviceIdRef.current = deviceId;
        await sendLanRpc(session.host_ip, Number(session.port || LAN_DEFAULT_PORT), {
          type: 'LAN_RPC',
          id: makeRpcId(),
          method: 'SESSION_CLOSED_ACK',
          sessionId: session.id,
          deviceId,
          payload: { reason },
          at: new Date().toISOString(),
        }, 900);
        await traceLan('LAN_RPC', 'sendClosedSessionAck', 'sent', 'ACK formal de encerramento enviado ao mestre.', {
          sessionId: session.id,
          reason,
        }, 'info');
      } catch (error) {
        delete closedAckSentRef.current[session.id];
        await traceLan('LAN_RPC', 'sendClosedSessionAck', 'failed', 'Falha ao enviar ACK formal de encerramento.', {
          sessionId: session.id,
          reason,
          error: error instanceof Error ? error.message : String(error),
        }, 'warn');
      }
    },
    [db, traceLan]
  );

  const finalizeClosedPlayerSession = useCallback(
    async (session: LanSessionRecord, reason = 'session-closed', sendAck = true) => {
      if (session.role !== 'player') return;
      if (finalizingClosedSessionsRef.current.has(session.id)) return;
      finalizingClosedSessionsRef.current.add(session.id);

      sessionGenerationRef.current += 1;
      suppressReconnectRef.current = true;
      const closedSession = { ...session, status: 'closed' as const, linked_character_id: null };
      activeSessionRef.current = closedSession;
      setActiveSession(closedSession);

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectingRef.current = false;
      delete reconnectFailureCountRef.current[session.id];
      delete playerPollFailureCountRef.current[session.id];
      delete lastDiscoveryAttemptAtRef.current[session.id];

      await setLanSessionStatus(db, session.id, 'closed');
      await linkCharacterToSession(db, session.id, null);
      await updateLanSessionState(db, session.id, { status: 'closed', paused: false });
      if (sendAck) await sendClosedSessionAck(session, reason);

      tcpClientRef.current?.close();
      tcpClientRef.current = null;
      tcpClientKeyRef.current = '';
      tcpClientConnectedRef.current = false;
      await rpcServerRef.current?.close();
      rpcServerRef.current = null;
      await LanForegroundService.stop().catch(() => undefined);
      setTransportReadyState(false);
      setLanConnectionStatus('disconnected');
      setPeerCount(0);
      setPlayers([]);
      setActiveSession(null);
      activeSessionRef.current = null;
      suppressReconnectRef.current = false;
      setLastError(null);
      setLastNotice('Mesa encerrada pelo mestre. Ficha liberada para outra sessao.');
      await refreshSavedSessions();
      await traceLan('FUNCTION', 'finalizeClosedPlayerSession', 'done', 'Jogador encerrou imediatamente a sessao local e liberou a ficha.', {
        sessionId: session.id,
        reason,
      }, 'info');
    },
    [db, refreshSavedSessions, sendClosedSessionAck, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const applyOfficialEventLocally = useCallback(
    async (event: LanOfficialEventMessage) => {
      const session = activeSessionRef.current || closingSessionRef.current;
      if (!session) return;

      // Jogadores tambem precisam aplicar eventos dos outros personagens nos snapshots
      // para que o quadro da Sessao LAN mostre vida/nivel do grupo em tempo real.
      // A ficha local so e atualizada quando o targetDeviceId for o aparelho atual.

      if (event.eventType === 'SESSION_PAUSED') {
        await setLanSessionStatus(db, event.sessionId, 'paused');
        await updateLanSessionState(db, event.sessionId, { status: 'paused', paused: true });
        setLastNotice('Mesa pausada pelo mestre. Aguardando retomada ou encerramento.');
        setActiveSession(prev => {
          const next = prev ? { ...prev, status: 'paused' as const } : prev;
          activeSessionRef.current = next;
          return next;
        });
        await refreshSavedSessions();
      }

      if (event.eventType === 'SESSION_RESUMED') {
        await setLanSessionStatus(db, event.sessionId, session.role === 'master' ? 'open' : 'connected');
        await updateLanSessionState(db, event.sessionId, { status: session.role === 'master' ? 'open' : 'connected', paused: false });
        setLastNotice('Mesa retomada pelo mestre.');
        setActiveSession(prev => {
          const next = prev ? { ...prev, status: session.role === 'master' ? 'open' as const : 'connected' as const } : prev;
          activeSessionRef.current = next;
          return next;
        });
        await refreshSavedSessions();
      }

      if (event.eventType === 'SESSION_CLOSED') {
        if (session.role === 'master') {
          await setLanSessionStatus(db, event.sessionId, 'closed');
          await linkCharacterToSession(db, event.sessionId, null);
          await updateLanSessionState(db, event.sessionId, { status: 'closed', paused: false });
          await refreshSavedSessions();
          return;
        }
        await finalizeClosedPlayerSession(session, 'official-event');
        return;
      }

      if (!event.targetCharacterId) return;

      let didMutateCharacter = false;

      const patchRemoteSnapshot = async (patch: Record<string, unknown>) => {
        if (!event.targetDeviceId || !event.targetCharacterId) return;
        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [event.sessionId, event.targetDeviceId, String(event.targetCharacterId)]
        );
        if (!snapshotRow?.payload) return;

        try {
          const snapshot = JSON.parse(snapshotRow.payload);
          const nextSnapshot = {
            ...snapshot,
            data: { ...(snapshot?.data || {}), ...patch },
            updatedAt: new Date().toISOString(),
          };
          await db.runAsync(
            `UPDATE lan_character_snapshots
             SET payload = ?, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?`,
            [JSON.stringify(nextSnapshot), event.sessionId, event.targetDeviceId, String(event.targetCharacterId)]
          );
        } catch {
          // Snapshot corrompido nao deve bloquear a aplicacao do evento oficial.
        }
      };
      const shouldUpdateLocalCharacter = !event.targetDeviceId || event.targetDeviceId === deviceIdRef.current;
      const patchCharacterSnapshot = async (deviceId: string | null | undefined, characterId: number | null | undefined, patch: Record<string, unknown>) => {
        if (!deviceId || !characterId) return;
        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [event.sessionId, deviceId, String(characterId)]
        );
        if (!snapshotRow?.payload) return;

        try {
          const snapshot = JSON.parse(snapshotRow.payload);
          const nextSnapshot = {
            ...snapshot,
            data: { ...(snapshot?.data || {}), ...patch },
            updatedAt: new Date().toISOString(),
          };
          await db.runAsync(
            `UPDATE lan_character_snapshots
             SET payload = ?, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?`,
            [JSON.stringify(nextSnapshot), event.sessionId, deviceId, String(characterId)]
          );
        } catch {
          // Snapshot corrompido nao deve bloquear a aplicacao do evento oficial.
        }
      };

      const applyCharacterPatch = async (deviceId: string | null | undefined, characterId: number | null | undefined, patch: Record<string, unknown>) => {
        if (!characterId) return;
        const normalizedPatch = { ...patch };
        if (normalizedPatch.equipment && typeof normalizedPatch.equipment !== 'string') {
          normalizedPatch.equipment = JSON.stringify(normalizedPatch.equipment);
        }
        if (normalizedPatch.stats && typeof normalizedPatch.stats !== 'string') {
          normalizedPatch.stats = JSON.stringify(normalizedPatch.stats);
        }

        if (!deviceId || deviceId === deviceIdRef.current) {
          const allowedColumns = ['equipment', 'gp', 'sp', 'cp', 'hp_current', 'hp_temp', 'xp', 'stats', 'spell_slots_used'];
          const entries = Object.entries(normalizedPatch).filter(([key]) => allowedColumns.includes(key));
          if (entries.length > 0) {
            const values = entries.map(([, value]) => (
              typeof value === 'number' || typeof value === 'string' || value === null ? value : JSON.stringify(value)
            ));
            await db.runAsync(
              `UPDATE characters SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
              [...values, characterId]
            );
          }
        }

        await patchCharacterSnapshot(deviceId, characterId, normalizedPatch);
      };

      if (event.eventType === 'ITEM_TRANSFERRED' || event.eventType === 'TRADE_ACCEPTED') {
        const currentValue = event.currentValue as { updates?: Array<Record<string, unknown>> } | undefined;
        const updates = Array.isArray(currentValue?.updates) ? currentValue.updates : [];
        for (const update of updates) {
          await applyCharacterPatch(
            update.deviceId ? String(update.deviceId) : null,
            update.characterId ? Number(update.characterId) : null,
            {
              ...(update.equipment ? { equipment: update.equipment } : {}),
              ...(typeof update.gp === 'number' ? { gp: update.gp } : {}),
              ...(typeof update.sp === 'number' ? { sp: update.sp } : {}),
              ...(typeof update.cp === 'number' ? { cp: update.cp } : {}),
            }
          );
        }
        if (updates.length > 0) didMutateCharacter = true;
      }

      if (event.eventType === 'HP_CHANGED') {
        const currentValue = event.currentValue as { hp_current?: number; hp_temp?: number; stats?: Record<string, unknown> } | undefined;
        if (typeof currentValue?.hp_current === 'number') {
          if (shouldUpdateLocalCharacter) {
            if (typeof currentValue.hp_temp === 'number' && currentValue.stats) {
              await db.runAsync(`UPDATE characters SET hp_current = ?, hp_temp = ?, stats = ? WHERE id = ?`, [
                currentValue.hp_current,
                currentValue.hp_temp,
                JSON.stringify(currentValue.stats),
                event.targetCharacterId,
              ]);
            } else if (typeof currentValue.hp_temp === 'number') {
              await db.runAsync(`UPDATE characters SET hp_current = ?, hp_temp = ? WHERE id = ?`, [
                currentValue.hp_current,
                currentValue.hp_temp,
                event.targetCharacterId,
              ]);
            } else {
              await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [currentValue.hp_current, event.targetCharacterId]);
            }
          }
          await patchRemoteSnapshot({
            hp_current: currentValue.hp_current,
            ...(typeof currentValue.hp_temp === 'number' ? { hp_temp: currentValue.hp_temp } : {}),
            ...(currentValue.stats ? { stats: JSON.stringify(currentValue.stats) } : {}),
          });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'TEMP_HP_CHANGED') {
        const currentValue = event.currentValue as { hp_temp?: number; stats?: Record<string, unknown> } | undefined;
        if (typeof currentValue?.hp_temp === 'number') {
          if (shouldUpdateLocalCharacter) {
            if (currentValue.stats) {
              await db.runAsync(`UPDATE characters SET hp_temp = ?, stats = ? WHERE id = ?`, [
                currentValue.hp_temp,
                JSON.stringify(currentValue.stats),
                event.targetCharacterId,
              ]);
            } else {
              await db.runAsync(`UPDATE characters SET hp_temp = ? WHERE id = ?`, [currentValue.hp_temp, event.targetCharacterId]);
            }
          }
          await patchRemoteSnapshot({
            hp_temp: currentValue.hp_temp,
            ...(currentValue.stats ? { stats: JSON.stringify(currentValue.stats) } : {}),
          });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'XP_CHANGED') {
        const currentValue = event.currentValue as { xp?: number } | undefined;
        if (typeof currentValue?.xp === 'number') {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET xp = ? WHERE id = ?`, [currentValue.xp, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ xp: currentValue.xp });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'COINS_CHANGED') {
        const currentValue = event.currentValue as { gp?: number; sp?: number; cp?: number } | undefined;
        if (currentValue) {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET gp = ?, sp = ?, cp = ? WHERE id = ?`, [
              Number(currentValue.gp || 0),
              Number(currentValue.sp || 0),
              Number(currentValue.cp || 0),
              event.targetCharacterId,
            ]);
          }
          await patchRemoteSnapshot({
            gp: Number(currentValue.gp || 0),
            sp: Number(currentValue.sp || 0),
            cp: Number(currentValue.cp || 0),
          });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'ATTRIBUTE_CHANGED') {
        const currentValue = event.currentValue as { stats?: Record<string, unknown> } | undefined;
        if (currentValue?.stats) {
          const statsText = JSON.stringify(currentValue.stats);
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [statsText, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ stats: statsText });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'RESOURCE_CHANGED') {
        const currentValue = event.currentValue as { spell_slots_used?: unknown } | undefined;
        if (currentValue && currentValue.spell_slots_used !== undefined) {
          const resourceText = typeof currentValue.spell_slots_used === 'string'
            ? currentValue.spell_slots_used
            : JSON.stringify(currentValue.spell_slots_used || {});
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET spell_slots_used = ? WHERE id = ?`, [resourceText, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ spell_slots_used: resourceText });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'EFFECT_APPLIED') {
        const currentValue = event.currentValue as { stats?: Record<string, unknown>; hp_temp?: number } | undefined;
        if (currentValue?.stats) {
          const statsText = JSON.stringify(currentValue.stats);
          if (shouldUpdateLocalCharacter) {
            if (typeof currentValue.hp_temp === 'number') {
              await db.runAsync(`UPDATE characters SET stats = ?, hp_temp = ? WHERE id = ?`, [
                statsText,
                Math.max(0, Number(currentValue.hp_temp || 0)),
                event.targetCharacterId,
              ]);
            } else {
              await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [statsText, event.targetCharacterId]);
            }
          }
          await patchRemoteSnapshot({
            stats: statsText,
            ...(typeof currentValue.hp_temp === 'number' ? { hp_temp: Math.max(0, Number(currentValue.hp_temp || 0)) } : {}),
          });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'ITEM_ADDED') {
        const currentValue = event.currentValue as { equipment?: Record<string, unknown> } | undefined;
        if (currentValue?.equipment) {
          const equipmentText = JSON.stringify(currentValue.equipment);
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [equipmentText, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ equipment: equipmentText });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'EFFECT_EXPIRED') {
        const currentValue = event.currentValue as { stats?: Record<string, unknown>; hp_temp?: number } | undefined;
        if (currentValue?.stats) {
          const statsText = JSON.stringify(currentValue.stats);
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET stats = ?, hp_temp = ? WHERE id = ?`, [
              statsText,
              Math.max(0, Number(currentValue.hp_temp || 0)),
              event.targetCharacterId,
            ]);
          }
          await patchRemoteSnapshot({ stats: statsText, hp_temp: Math.max(0, Number(currentValue.hp_temp || 0)) });
          didMutateCharacter = true;
        }
      }

      if (didMutateCharacter) {
        await refreshPlayers();
        setLanRevision(prev => prev + 1);
      }
    },
    [db, finalizeClosedPlayerSession, refreshPlayers, refreshSavedSessions]
  );

  const emitOfficialEvent = useCallback(
    async (eventInput: Parameters<typeof appendLanOfficialEvent>[1]) => {
      const startedAt = Date.now();
      await traceLan('LAN_EVENT', 'emitOfficialEvent', 'start', `Gerando evento oficial ${eventInput.eventType}.`, {
        used: ['appendLanOfficialEvent', 'applyOfficialEventLocally', 'rpc_poll_sync'],
        eventInput,
      }, 'debug', eventInput.commandId || null);
      const event = await appendLanOfficialEvent(db, eventInput);
      await applyOfficialEventLocally(event);
      setLastNotice(event.description);
      await traceLan('LAN_EVENT', 'emitOfficialEvent', 'success', `Evento oficial ${event.eventType} emitido.`, {
        durationMs: Date.now() - startedAt,
        eventId: event.eventId,
        seq: event.seq,
        targetCharacterId: event.targetCharacterId,
        targetDeviceId: event.targetDeviceId,
        description: event.description,
      }, 'info', event.commandId || null);
      return event;
    },
    [applyOfficialEventLocally, db, traceLan]
  );

  const rejectCommand = useCallback(
    async (sessionId: string, command: LanCommandMessage, reason: string, peerId?: string) => {
      await traceLan('LAN_COMMAND', 'rejectCommand', 'reject', reason, {
        used: ['appendLanOfficialEvent', 'rpc_response_sync'],
        command: command.command,
        commandId: command.commandId,
        peerId,
        payload: command.payload,
      }, 'warn', command.commandId);
      const event = await appendLanOfficialEvent(db, {
        sessionId,
        eventType: 'COMMAND_REJECTED',
        commandId: command.commandId,
        actorDeviceId: command.deviceId,
        actorName: command.actorName || 'Jogador',
        description: reason,
        payload: { command: command.command, reason },
      });
      setLastError(reason);
    },
    [db, traceLan]
  );

  const emitTradeExpiredEvent = useCallback(
    async (session: LanSessionRecord, tradeEvent: LanOfficialEventMessage, reason: 'timeout' | 'late-response' = 'timeout') => {
      const payload = (tradeEvent.payload || {}) as any;
      const offerCommandId = String(payload.offerCommandId || tradeEvent.commandId || tradeEvent.eventId || '');
      if (!offerCommandId) return null;

      const existingResolution = await getLanTradeResolutionEvent(db, session.id, offerCommandId);
      if (existingResolution) return existingResolution;

      const expiresAt = new Date(getTradeExpiresAt(tradeEvent)).toISOString();
      return emitOfficialEvent({
        sessionId: session.id,
        eventType: 'TRADE_EXPIRED',
        actorDeviceId: deviceIdRef.current || null,
        actorName: 'Mestre',
        targetDeviceId: tradeEvent.actorDeviceId || payload.sourceDeviceId || null,
        targetCharacterId: Number(payload.sourceCharacterId || tradeEvent.targetCharacterId || 0) || null,
        targetName: payload.sourceName || tradeEvent.actorName || null,
        description: 'Proposta de troca expirou por tempo limite.',
        payload: {
          offerCommandId,
          expiredEventId: tradeEvent.eventId,
          expiredCommandId: tradeEvent.commandId || null,
          expiredEventType: tradeEvent.eventType,
          reason,
          expiresAt,
        },
      });
    },
    [db, emitOfficialEvent]
  );

  const expireStaleTrades = useCallback(
    async (session: LanSessionRecord) => {
      const rows = await getLanHistoryPage(db, session.id, 0, 200);
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

      for (const event of rows) {
        if (event.eventType !== 'TRADE_OFFERED' && event.eventType !== 'TRADE_COUNTERED') continue;
        const offerCommandId = String((event.payload as any)?.offerCommandId || event.commandId || event.eventId || '');
        if (!offerCommandId || resolvedTradeOfferIds.has(offerCommandId)) continue;
        if (event.eventType === 'TRADE_OFFERED' && counteredTradeOfferIds.has(offerCommandId)) continue;
        if (!isTradeEventExpired(event)) continue;

        await emitTradeExpiredEvent(session, event, 'timeout');
        resolvedTradeOfferIds.add(offerCommandId);
      }
    },
    [db, emitTradeExpiredEvent]
  );

  const handleAuthoritativeCommand = useCallback(
    async (command: LanCommandMessage, peerId?: string) => {
      await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'received', `Mestre recebeu comando ${command.command}.`, {
        used: ['getLanSessionState', 'emitOfficialEvent', 'rejectCommand'],
        command: command.command,
        commandId: command.commandId,
        peerId,
        actorName: command.actorName,
        characterId: command.characterId,
        payload: command.payload,
      }, 'debug', command.commandId);
      const session = activeSessionRef.current;
      if (!session || session.role !== 'master') return;

      if (command.sessionId !== session.id) {
        await rejectCommand(session.id, command, 'Comando recebido para outra sessao.', peerId);
        return;
      }

      const alreadyHandled = await getLanEventByCommandId(db, session.id, command.commandId);
      if (alreadyHandled) {
        await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'duplicate_ignored', `Comando ${command.command} ja processado; ignorando duplicata.`, {
          command: command.command,
          commandId: command.commandId,
          firstEventId: alreadyHandled.eventId,
          firstSeq: alreadyHandled.seq,
        }, 'info', command.commandId);
        return;
      }

      const state = await getLanSessionState(db, session.id);
      const allowedWhilePaused = ['MASTER_RESUME_SESSION', 'MASTER_END_SESSION'];
      if (state.paused && !allowedWhilePaused.includes(command.command)) {
        await rejectCommand(session.id, command, 'Sessao pausada. Aguardando retomada do mestre.', peerId);
        return;
      }

      const loadLanCharacterState = async (deviceId: string | null | undefined, characterId: number | null | undefined) => {
        const safeCharacterId = Number(characterId || 0);
        if (!safeCharacterId) return null;

        if (!deviceId || deviceId === deviceIdRef.current) {
          const local = await db.getFirstAsync<any>(
            `SELECT id, name, equipment, gp, sp, cp FROM characters WHERE id = ? LIMIT 1`,
            [safeCharacterId]
          );
          if (local) {
            return {
              deviceId: deviceId || deviceIdRef.current,
              characterId: safeCharacterId,
              name: String(local.name || 'Personagem'),
              equipment: normalizeEquipment(local.equipment),
              gp: Number(local.gp || 0),
              sp: Number(local.sp || 0),
              cp: Number(local.cp || 0),
            };
          }
        }

        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [session.id, String(deviceId || ''), String(safeCharacterId)]
        );
        if (!snapshotRow?.payload) return null;

        try {
          const snapshot = JSON.parse(snapshotRow.payload);
          const data = snapshot?.data || {};
          return {
            deviceId: String(deviceId || ''),
            characterId: safeCharacterId,
            name: String(snapshot?.name || data.name || 'Personagem'),
            equipment: normalizeEquipment(data.equipment),
            gp: Number(data.gp || 0),
            sp: Number(data.sp || 0),
            cp: Number(data.cp || 0),
          };
        } catch {
          return null;
        }
      };

      const makeStateUpdate = (stateValue: any) => ({
        deviceId: stateValue.deviceId,
        characterId: stateValue.characterId,
        equipment: stateValue.equipment,
        gp: stateValue.gp,
        sp: stateValue.sp,
        cp: stateValue.cp,
      });

      const moveItemBetweenStates = (
        sourceState: any,
        targetState: any,
        item: Record<string, unknown>,
        quantity: number
      ) => {
        const itemName = String(item.name || item.itemName || 'Item');
        const safeQuantity = Math.max(1, Number(quantity || 1));
        const sourceResult = removeItemFromEquipment(sourceState.equipment, itemName, safeQuantity);
        if (!sourceResult.ok) {
          throw new Error(`${sourceState.name} nao possui ${safeQuantity}x ${itemName}.`);
        }
        sourceState.equipment = sourceResult.equipment;
        targetState.equipment = addItemToEquipment(targetState.equipment, cloneTransferItem(item, safeQuantity), safeQuantity);
      };

      const moveCoinsBetweenStates = (sourceState: any, targetState: any, coins: { gp?: number; sp?: number; cp?: number }) => {
        const gp = Math.max(0, Number(coins.gp || 0));
        const sp = Math.max(0, Number(coins.sp || 0));
        const cp = Math.max(0, Number(coins.cp || 0));
        if (sourceState.gp < gp || sourceState.sp < sp || sourceState.cp < cp) {
          throw new Error(`${sourceState.name} nao possui moedas suficientes para a troca.`);
        }
        sourceState.gp -= gp;
        sourceState.sp -= sp;
        sourceState.cp -= cp;
        targetState.gp += gp;
        targetState.sp += sp;
        targetState.cp += cp;
      };

      const hydrateTransferItem = async (item: Record<string, unknown>, itemNameValue?: string) => {
        const itemName = String(item.name || item.itemName || itemNameValue || 'Item');
        const embeddedEffects = Array.isArray((item as any).effects)
          ? (item as any).effects
          : Array.isArray((item as any).structuredEffects)
            ? (item as any).structuredEffects
            : [];
        if (embeddedEffects.length > 0) return { ...item, name: itemName, effects: embeddedEffects };

        try {
          const sourceId = Number(item.id || 0);
          const rows = await db.getAllAsync<any>(
            `SELECT * FROM effects
             WHERE source_table = 'items'
               AND ((? > 0 AND source_id = ?) OR LOWER(TRIM(source_name)) = ?)
             ORDER BY sort_order ASC, id ASC`,
            [sourceId, sourceId, normalizeItemName(itemName)]
          );
          return rows.length > 0 ? { ...item, name: itemName, effects: rows } : { ...item, name: itemName };
        } catch {
          return { ...item, name: itemName };
        }
      };

      if (command.command === 'PLAYER_ITEM_DONATE') {
        const item = (command.payload?.item || {}) as Record<string, unknown>;
        const itemName = String(item.name || command.payload?.itemName || 'Item');
        const transferItem = await hydrateTransferItem(item, itemName);
        const quantity = Math.max(1, numberFromPayload(command.payload, 'quantity', 1));
        const sourceCharacterId = Number(command.characterId || command.payload?.sourceCharacterId || 0);
        const targetCharacterId = Number(command.payload?.targetCharacterId || 0);
        const targetDeviceId = String(command.payload?.targetDeviceId || '');
        const sourceState = await loadLanCharacterState(command.deviceId, sourceCharacterId);
        const targetState = await loadLanCharacterState(targetDeviceId, targetCharacterId);
        if (!sourceState || !targetState) {
          await rejectCommand(session.id, command, 'Nao foi possivel localizar as fichas para envio de item.', peerId);
          return;
        }

        try {
          moveItemBetweenStates(sourceState, targetState, transferItem, quantity);
        } catch (error) {
          await rejectCommand(session.id, command, error instanceof Error ? error.message : String(error), peerId);
          return;
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'ITEM_TRANSFERRED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || sourceState.name,
          targetDeviceId,
          targetCharacterId,
          targetName: targetState.name,
          currentValue: { updates: [makeStateUpdate(sourceState), makeStateUpdate(targetState)] },
          description: `${sourceState.name} enviou ${quantity}x ${itemName} para ${targetState.name}.`,
          payload: {
            mode: 'send',
            item: transferItem,
            quantity,
            sourceDeviceId: command.deviceId,
            sourceCharacterId,
            sourceName: sourceState.name,
            targetDeviceId,
            targetCharacterId,
            targetName: targetState.name,
          },
        });
        return;
      }

      if (command.command === 'PLAYER_TRADE_OFFER') {
        const item = (command.payload?.item || {}) as Record<string, unknown>;
        const itemName = String(item.name || command.payload?.itemName || 'Item');
        const transferItem = await hydrateTransferItem(item, itemName);
        const quantity = Math.max(1, numberFromPayload(command.payload, 'quantity', 1));
        const sourceCharacterId = Number(command.characterId || command.payload?.sourceCharacterId || 0);
        const targetCharacterId = Number(command.payload?.targetCharacterId || 0);
        const targetDeviceId = String(command.payload?.targetDeviceId || '');
        const sourceState = await loadLanCharacterState(command.deviceId, sourceCharacterId);
        const targetState = await loadLanCharacterState(targetDeviceId, targetCharacterId);
        if (!sourceState || !targetState) {
          await rejectCommand(session.id, command, 'Nao foi possivel localizar as fichas para proposta de troca.', peerId);
          return;
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TRADE_OFFERED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || sourceState.name,
          targetDeviceId,
          targetCharacterId,
          targetName: targetState.name,
          description: `${sourceState.name} propos trocar ${quantity}x ${itemName} com ${targetState.name}.`,
          payload: {
            offerCommandId: command.commandId,
            item: transferItem,
            itemName,
            quantity,
            expiresAt: makeTradeExpiresAt(),
            sourceDeviceId: command.deviceId,
            sourceCharacterId,
            sourceName: sourceState.name,
            targetDeviceId,
            targetCharacterId,
            targetName: targetState.name,
          },
        });
        return;
      }

      if (command.command === 'PLAYER_TRADE_DECLINE') {
        const offerCommandId = String(command.payload?.offerCommandId || '');
        const existingResolution = await getLanTradeResolutionEvent(db, session.id, offerCommandId);
        if (existingResolution) {
          await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'trade_resolution_ignored', `Proposta ${offerCommandId} ja foi resolvida.`, {
            commandId: command.commandId,
            existingEventId: existingResolution.eventId,
            existingEventType: existingResolution.eventType,
          });
          return;
        }
        const offerEvent = await getLanEventByCommandId(db, session.id, offerCommandId);
        if (!offerEvent || offerEvent.eventType !== 'TRADE_OFFERED') {
          await rejectCommand(session.id, command, 'Proposta de troca nao encontrada.', peerId);
          return;
        }
        if (isTradeEventExpired(offerEvent)) {
          await emitTradeExpiredEvent(session, offerEvent, 'late-response');
          return;
        }
        const offerPayload = (offerEvent?.payload || {}) as any;
        const declinedBySource = command.deviceId && offerPayload.sourceDeviceId === command.deviceId;
        const otherDeviceId = declinedBySource ? offerPayload.targetDeviceId : offerPayload.sourceDeviceId;
        const otherCharacterId = declinedBySource ? offerPayload.targetCharacterId : offerPayload.sourceCharacterId;
        const otherName = declinedBySource ? offerPayload.targetName : offerPayload.sourceName;
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TRADE_DECLINED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Jogador',
          targetDeviceId: otherDeviceId || offerEvent?.actorDeviceId || null,
          targetCharacterId: Number(otherCharacterId || 0) || null,
          targetName: otherName || offerEvent?.actorName || null,
          description: `${command.actorName || 'Jogador'} recusou a proposta de troca.`,
          payload: { offerCommandId },
        });
        return;
      }

      if (command.command === 'PLAYER_TRADE_COUNTER' || command.command === 'PLAYER_TRADE_ACCEPT') {
        const offerCommandId = String(command.payload?.offerCommandId || '');
        const existingResolution = await getLanTradeResolutionEvent(db, session.id, offerCommandId);
        if (existingResolution) {
          await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'trade_resolution_ignored', `Proposta ${offerCommandId} ja foi resolvida.`, {
            commandId: command.commandId,
            existingEventId: existingResolution.eventId,
            existingEventType: existingResolution.eventType,
          });
          return;
        }
        const existingCounter = await getLanTradeCounterEvent(db, session.id, offerCommandId);
        if (existingCounter) {
          await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'trade_counter_ignored', `Proposta ${offerCommandId} ja possui contraproposta.`, {
            commandId: command.commandId,
            existingEventId: existingCounter.eventId,
          });
          return;
        }
        const offerEvent = await getLanEventByCommandId(db, session.id, offerCommandId);
        if (!offerEvent || offerEvent.eventType !== 'TRADE_OFFERED') {
          await rejectCommand(session.id, command, 'Proposta de troca nao encontrada.', peerId);
          return;
        }
        if (isTradeEventExpired(offerEvent)) {
          await emitTradeExpiredEvent(session, offerEvent, 'late-response');
          return;
        }

        const offerPayload = (offerEvent.payload || {}) as any;
        if (offerEvent.targetDeviceId && offerEvent.targetDeviceId !== command.deviceId) {
          await rejectCommand(session.id, command, 'Apenas o jogador alvo pode responder esta troca.', peerId);
          return;
        }

        const sourceState = await loadLanCharacterState(offerPayload.sourceDeviceId, Number(offerPayload.sourceCharacterId || 0));
        const targetState = await loadLanCharacterState(offerPayload.targetDeviceId, Number(offerPayload.targetCharacterId || 0));
        if (!sourceState || !targetState) {
          await rejectCommand(session.id, command, 'Nao foi possivel localizar as fichas da troca.', peerId);
          return;
        }

        const counterItemRaw = (command.payload?.counterItem || null) as Record<string, unknown> | null;
        const counterQuantity = Math.max(0, numberFromPayload(command.payload, 'counterQuantity', 0));
        const coins = {
          gp: Math.max(0, numberFromPayload(command.payload, 'gp', 0)),
          sp: Math.max(0, numberFromPayload(command.payload, 'sp', 0)),
          cp: Math.max(0, numberFromPayload(command.payload, 'cp', 0)),
        };
        const counterItem: Record<string, unknown> | null = counterItemRaw && counterQuantity > 0
          ? await hydrateTransferItem(counterItemRaw, String(counterItemRaw.name || counterItemRaw.itemName || 'Item'))
          : null;

        try {
          if (counterItem && counterQuantity > 0) {
            const validation = removeItemFromEquipment(targetState.equipment, String(counterItem.name || counterItem.itemName || 'Item'), counterQuantity);
            if (!validation.ok) throw new Error(`${targetState.name} nao possui ${counterQuantity}x ${String(counterItem.name || counterItem.itemName || 'Item')}.`);
          }
          if (coins.gp > 0 || coins.sp > 0 || coins.cp > 0) {
            if (targetState.gp < coins.gp || targetState.sp < coins.sp || targetState.cp < coins.cp) {
              throw new Error(`${targetState.name} nao possui moedas suficientes para a troca.`);
            }
          }
        } catch (error) {
          await rejectCommand(session.id, command, error instanceof Error ? error.message : String(error), peerId);
          return;
        }

        const counterParts = [
          counterItem && counterQuantity > 0 ? `${counterQuantity}x ${String(counterItem.name || counterItem.itemName || 'Item')}` : '',
          coins.gp > 0 ? `${coins.gp} PO` : '',
          coins.sp > 0 ? `${coins.sp} PP` : '',
          coins.cp > 0 ? `${coins.cp} PC` : '',
        ].filter(Boolean);

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TRADE_COUNTERED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || targetState.name,
          targetDeviceId: offerPayload.sourceDeviceId || null,
          targetCharacterId: Number(offerPayload.sourceCharacterId || 0) || null,
          targetName: sourceState.name,
          description: `${targetState.name} respondeu a troca de ${sourceState.name}${counterParts.length ? ` oferecendo ${counterParts.join(' + ')}` : ' sem retorno'}. Aguardando confirmacao.`,
          payload: {
            offerCommandId,
            offeredItem: offerPayload.item || { name: offerPayload.itemName || 'Item' },
            offeredItemName: offerPayload.itemName || offerPayload.item?.name || 'Item',
            offeredQuantity: Number(offerPayload.quantity || 1),
            counterItem,
            counterQuantity,
            coins,
            expiresAt: makeTradeExpiresAt(),
            sourceDeviceId: offerPayload.sourceDeviceId,
            sourceCharacterId: Number(offerPayload.sourceCharacterId || 0),
            targetDeviceId: offerPayload.targetDeviceId,
            targetCharacterId: Number(offerPayload.targetCharacterId || 0),
          },
        });
        return;
      }

      if (command.command === 'PLAYER_TRADE_CONFIRM') {
        const offerCommandId = String(command.payload?.offerCommandId || '');
        const counterCommandId = String(command.payload?.counterCommandId || '');
        const existingResolution = await getLanTradeResolutionEvent(db, session.id, offerCommandId);
        if (existingResolution) {
          await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'trade_resolution_ignored', `Proposta ${offerCommandId} ja foi resolvida.`, {
            commandId: command.commandId,
            existingEventId: existingResolution.eventId,
            existingEventType: existingResolution.eventType,
          });
          return;
        }
        const offerEvent = await getLanEventByCommandId(db, session.id, offerCommandId);
        if (!offerEvent || offerEvent.eventType !== 'TRADE_OFFERED') {
          await rejectCommand(session.id, command, 'Proposta de troca nao encontrada.', peerId);
          return;
        }
        if (isTradeEventExpired(offerEvent)) {
          await emitTradeExpiredEvent(session, offerEvent, 'late-response');
          return;
        }
        const counterEvent = counterCommandId
          ? await getLanEventByCommandId(db, session.id, counterCommandId)
          : await getLanTradeCounterEvent(db, session.id, offerCommandId);
        if (!counterEvent || counterEvent.eventType !== 'TRADE_COUNTERED') {
          await rejectCommand(session.id, command, 'Contraproposta de troca nao encontrada.', peerId);
          return;
        }
        if (isTradeEventExpired(counterEvent)) {
          await emitTradeExpiredEvent(session, counterEvent, 'late-response');
          return;
        }

        const offerPayload = (offerEvent.payload || {}) as any;
        const counterPayload = (counterEvent.payload || {}) as any;
        if (offerPayload.sourceDeviceId && offerPayload.sourceDeviceId !== command.deviceId) {
          await rejectCommand(session.id, command, 'Apenas quem iniciou a troca pode confirmar a contraproposta.', peerId);
          return;
        }

        const sourceState = await loadLanCharacterState(offerPayload.sourceDeviceId, Number(offerPayload.sourceCharacterId || 0));
        const targetState = await loadLanCharacterState(offerPayload.targetDeviceId, Number(offerPayload.targetCharacterId || 0));
        if (!sourceState || !targetState) {
          await rejectCommand(session.id, command, 'Nao foi possivel localizar as fichas da troca.', peerId);
          return;
        }

        const offeredItem = (counterPayload.offeredItem || offerPayload.item || { name: offerPayload.itemName || 'Item' }) as Record<string, unknown>;
        const offeredQuantity = Math.max(1, Number(counterPayload.offeredQuantity || offerPayload.quantity || 1));
        const counterItem = (counterPayload.counterItem || null) as Record<string, unknown> | null;
        const counterQuantity = Math.max(0, Number(counterPayload.counterQuantity || 0));
        const coins = {
          gp: Math.max(0, Number(counterPayload.coins?.gp || counterPayload.gp || 0)),
          sp: Math.max(0, Number(counterPayload.coins?.sp || counterPayload.sp || 0)),
          cp: Math.max(0, Number(counterPayload.coins?.cp || counterPayload.cp || 0)),
        };

        try {
          moveItemBetweenStates(sourceState, targetState, offeredItem, offeredQuantity);
          if (counterItem && counterQuantity > 0) {
            moveItemBetweenStates(targetState, sourceState, counterItem, counterQuantity);
          }
          if (coins.gp > 0 || coins.sp > 0 || coins.cp > 0) {
            moveCoinsBetweenStates(targetState, sourceState, coins);
          }
        } catch (error) {
          await rejectCommand(session.id, command, error instanceof Error ? error.message : String(error), peerId);
          return;
        }

        const counterParts = [
          counterItem && counterQuantity > 0 ? `${counterQuantity}x ${String(counterItem.name || counterItem.itemName || 'Item')}` : '',
          coins.gp > 0 ? `${coins.gp} PO` : '',
          coins.sp > 0 ? `${coins.sp} PP` : '',
          coins.cp > 0 ? `${coins.cp} PC` : '',
        ].filter(Boolean);

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TRADE_ACCEPTED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || sourceState.name,
          targetDeviceId: offerPayload.targetDeviceId || null,
          targetCharacterId: Number(offerPayload.targetCharacterId || 0) || null,
          targetName: targetState.name,
          currentValue: { updates: [makeStateUpdate(sourceState), makeStateUpdate(targetState)] },
          description: `${sourceState.name} confirmou a troca com ${targetState.name}${counterParts.length ? ` recebendo ${counterParts.join(' + ')}` : ' sem retorno'}.`,
          payload: {
            offerCommandId,
            counterCommandId: counterEvent.commandId || counterEvent.eventId,
            offeredItem,
            offeredQuantity,
            counterItem,
            counterQuantity,
            coins,
            sourceDeviceId: offerPayload.sourceDeviceId,
            sourceCharacterId: Number(offerPayload.sourceCharacterId || 0),
            targetDeviceId: offerPayload.targetDeviceId,
            targetCharacterId: Number(offerPayload.targetCharacterId || 0),
          },
        });
        return;
      }

      const playerInventoryEvents: Partial<Record<LanCommandKind, LanOfficialEventMessage['eventType']>> = {
        PLAYER_INVENTORY_UPDATE: 'SNAPSHOT_SYNCED',
        PLAYER_ITEM_DROP: 'ITEM_REMOVED',
        PLAYER_ITEM_THROW: 'ITEM_REMOVED',
        PLAYER_ITEM_CONSUME: 'ITEM_CONSUMED',
        PLAYER_EQUIP_ITEM: 'ITEM_EQUIPPED',
        PLAYER_UNEQUIP_ITEM: 'ITEM_UNEQUIPPED',
      };
      const inventoryEventType = playerInventoryEvents[command.command];
      if (inventoryEventType) {
        const itemName = String(command.payload?.itemName || command.payload?.name || 'item');
        const quantity = Number(command.payload?.quantity || command.payload?.qty || 1);
        const inventoryAction = String(command.payload?.action || '');
        const isQuantityRequest = inventoryAction === 'REQUEST_ITEM_QUANTITY_INCREASE';
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: isQuantityRequest ? 'PLAYER_REQUESTED' : inventoryEventType,
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Jogador',
          targetDeviceId: command.deviceId,
          targetCharacterId: command.characterId || null,
          targetName: String(command.payload?.characterName || command.actorName || 'Personagem'),
          previousValue: command.payload?.previousValue,
          currentValue: command.payload?.currentValue,
          description: isQuantityRequest
            ? `${command.actorName || 'Jogador'} solicitou +${quantity}x ${itemName} ao mestre.`
            : `${command.actorName || 'Jogador'} registrou ${quantity}x ${itemName} no inventario.`,
          payload: { command: command.command, ...command.payload },
        });
        return;
      }

      if (command.command.startsWith('PLAYER_REQUEST_')) {
        const actorName = command.actorName || 'Jogador';
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'PLAYER_REQUESTED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName,
          targetDeviceId: command.deviceId,
          targetCharacterId: command.characterId || null,
          targetName: String(command.payload?.characterName || actorName || 'Personagem'),
          description: formatPlayerRequestDescription(actorName, command.command, command.payload || {}),
          payload: { command: command.command, ...command.payload },
        });
        return;
      }

      if (command.command === 'PLAYER_LEAVE_SESSION') {
        const leavingCharacterId = Number(command.characterId || command.payload?.characterId || 0) || null;
        const leavingName = String(command.payload?.characterName || command.actorName || 'Jogador');
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'PLAYER_LEFT',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || leavingName,
          targetDeviceId: command.deviceId,
          targetCharacterId: leavingCharacterId,
          targetName: leavingName,
          description: `${leavingName} saiu da sessao e desvinculou a ficha.`,
          payload: { command: command.command, ...command.payload },
        });
        await db.runAsync(
          `UPDATE lan_session_players
           SET connected = 0,
               character_id = NULL,
               character_name = NULL,
               last_seen_at = CURRENT_TIMESTAMP
           WHERE session_id = ? AND device_id = ?`,
          [session.id, command.deviceId]
        );
        await db.runAsync(
          `DELETE FROM lan_character_snapshots WHERE session_id = ? AND owner_device_id = ?`,
          [session.id, command.deviceId]
        );
        await refreshPlayers();
        setLanRevision(prev => prev + 1);
        await pushTcpSyncRef.current?.(session, 'player-left');
        return;
      }

      if (command.command === 'MASTER_PAUSE_SESSION') {
        await setLanSessionStatus(db, session.id, 'paused');
        await updateLanSessionState(db, session.id, { status: 'paused', paused: true });
        const pausedServer = rpcServerRef.current;
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'SESSION_PAUSED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre pausou a sessao "${session.name}".`,
        });
        const pausedSession = { ...session, status: 'paused' as const };
        setActiveSession(pausedSession);
        activeSessionRef.current = pausedSession;
        setLanConnectionStatus('disconnected');
        setTransportReadyState(false);
        setTimeout(() => {
          if (activeSessionRef.current?.id === session.id && activeSessionRef.current.status === 'paused' && rpcServerRef.current === pausedServer) {
            rpcServerRef.current?.close();
            rpcServerRef.current = null;
            void LanForegroundService.stop().catch(() => undefined);
          }
        }, 6500);
        return;
      }

      if (command.command === 'MASTER_RESUME_SESSION') {
        const hostCandidates = await getLanAddressCandidates();
        let hostIp = session.host_ip || hostCandidates[0] || '0.0.0.0';
        try {
          hostIp = hostCandidates[0] || await Network.getIpAddressAsync();
        } catch {
          hostIp = hostCandidates[0] || hostIp;
        }
        const port = Number(session.port || LAN_DEFAULT_PORT);
        const resumedSession = {
          ...session,
          status: 'open' as const,
          host_ip: hostIp,
          port,
          session_code: buildSessionShareCode(session.id, hostIp, port, hostCandidates),
          last_connected_at: new Date().toISOString(),
        };
        await saveLanSession(db, resumedSession);
        await setLanSessionStatus(db, resumedSession.id, 'open');
        await updateLanSessionState(db, resumedSession.id, { status: 'open', paused: false });
        setActiveSession(resumedSession);
        activeSessionRef.current = resumedSession;

        if (!rpcServerRef.current) {
          const rpcServer = makeLanTcpServer(resumedSession.id);
          await rpcServer.start(port);
          rpcServerRef.current = rpcServer;
        }
        await LanForegroundService.start({
          sessionId: resumedSession.id,
          sessionName: resumedSession.name,
          hostIp: resumedSession.host_ip || null,
          port,
          playerCount: players.length,
          role: resumedSession.role,
          status: resumedSession.status,
        }).catch(error => {
          void traceLan('FUNCTION', 'LanForegroundService.start', 'native_unavailable', 'Foreground Service nativo indisponivel ou falhou.', {
            error: error instanceof Error ? error.message : String(error),
          }, 'warn');
        });
        setTransportReadyState(true);
        setLanConnectionStatus('connected');
        await emitOfficialEvent({
          sessionId: resumedSession.id,
          eventType: 'SESSION_RESUMED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre retomou a sessao "${resumedSession.name}".`,
        });
        await refreshSavedSessions();
        return;
      }

      if (command.command === 'MASTER_END_SESSION') {
        sessionGenerationRef.current += 1;
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'SESSION_CLOSED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre encerrou a sessao "${session.name}". Personagens desvinculados da campanha.`,
        });
        await setLanSessionStatus(db, session.id, 'closed');
        await linkCharacterToSession(db, session.id, null);
        await updateLanSessionState(db, session.id, { status: 'closed', paused: false });
        const closedSession = { ...session, status: 'closed' as const, linked_character_id: null };
        const playerRows = await getLanPlayers(db, session.id);
        const pendingDevices = new Set(
          playerRows
            .filter(player => player.connected && player.device_id && player.device_id !== command.deviceId)
            .map(player => player.device_id)
        );
        closingSessionPendingDevicesRef.current[session.id] = pendingDevices;
        closingSessionRef.current = closedSession;
        activeSessionRef.current = null;
        const directCloseSent = rpcServerRef.current?.broadcast({
          method: 'SESSION_CLOSED',
          sessionId: session.id,
          payload: {
            sessionId: session.id,
            status: 'closed',
            message: `Mestre encerrou a sessao "${session.name}".`,
          },
        }) || 0;
        await traceLan('LAN_TCP', 'MASTER_END_SESSION', 'direct_close_sent', 'Status direto de encerramento enviado aos jogadores conectados.', {
          sessionId: session.id,
          sent: directCloseSent,
        }, 'info', command.commandId);
        const port = Number(session.port || LAN_DEFAULT_PORT);
        if (!rpcServerRef.current) {
          try {
            const rpcServer = makeLanTcpServer(session.id, { mode: 'closed-announcement' });
            await rpcServer.start(port);
            rpcServerRef.current = rpcServer;
            await traceLan('LAN_RPC', 'MASTER_END_SESSION', 'closed_host_started', 'Host temporario iniciado para avisar encerramento da sessao.', {
              sessionId: session.id,
              port,
              pendingDevices: pendingDevices.size,
              previousStatus: session.status,
            }, 'info', command.commandId);
          } catch (error) {
            await traceLan('LAN_RPC', 'MASTER_END_SESSION', 'closed_host_failed', 'Nao foi possivel iniciar host temporario de encerramento.', {
              sessionId: session.id,
              port,
              error: error instanceof Error ? error.message : String(error),
            }, 'warn', command.commandId);
          }
        }
        await LanForegroundService.start({
          sessionId: closedSession.id,
          sessionName: closedSession.name,
          hostIp: closedSession.host_ip || null,
          port,
          playerCount: pendingDevices.size,
          role: closedSession.role,
          status: closedSession.status,
        }).catch(error => {
          void traceLan('FUNCTION', 'LanForegroundService.start', 'native_unavailable', 'Foreground Service nativo indisponivel ou falhou ao anunciar encerramento.', {
            error: error instanceof Error ? error.message : String(error),
          }, 'warn', command.commandId);
        });
        if (closingSessionTimerRef.current) {
          clearTimeout(closingSessionTimerRef.current);
          closingSessionTimerRef.current = null;
        }
        closingSessionTimerRef.current = setTimeout(() => {
          void finishClosedSessionHost(session.id, 'timeout-waiting-player-unlink').catch(() => undefined);
        }, pendingDevices.size > 0 ? 6500 : 700);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        setTransportReadyState(true);
        setLanConnectionStatus('connected');
        setPeerCount(pendingDevices.size);
        setActiveSession(closedSession);
        activeSessionRef.current = null;
        setLastNotice(
          pendingDevices.size > 0
            ? `Sessao encerrada. Aguardando ${pendingDevices.size} jogador(es) desvincular(em).`
            : 'Sessao encerrada. Fechando host LAN.'
        );
        await refreshSavedSessions();
        return;
      }

      if (command.command === 'MASTER_DENY_REQUEST') {
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'COMMAND_REJECTED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: String(command.payload?.targetDeviceId || '') || null,
          targetCharacterId: command.payload?.targetCharacterId ? Number(command.payload.targetCharacterId) : null,
          targetName: command.payload?.targetName ? String(command.payload.targetName) : null,
          description: String(command.payload?.reason || 'Mestre recusou a solicitacao.'),
          payload: {
            requestCommandId: command.payload?.requestCommandId || null,
            originalPayload: command.payload?.originalPayload || null,
          },
        });
        return;
      }

      const progressSessionEffects = async (progress: { turns?: number; minutes?: number; restType?: 'short_rest' | 'long_rest' }) => {
        const normalizeResources = (value: unknown) => {
          const parsed = typeof value === 'string'
            ? (() => { try { return JSON.parse(value || '{}'); } catch { return {}; } })()
            : value && typeof value === 'object'
              ? value as any
              : {};
          const slots = Object.fromEntries(Object.entries(parsed?.slots || {}).map(([level, used]) => [String(level), Math.max(0, Math.trunc(Number(used || 0)))]));
          const abilities = Object.fromEntries(Object.entries(parsed?.abilities || {}).map(([id, entry]: [string, any]) => [String(id), {
            used: Math.max(0, Math.trunc(Number(entry?.used || 0))),
            max: Math.max(1, Math.trunc(Number(entry?.max || 1))),
            recharge: ['turn', 'short_rest', 'long_rest'].includes(String(entry?.recharge)) ? String(entry.recharge) : 'long_rest',
          }]));
          return { slots, abilities };
        };
        const resetResources = (value: unknown) => {
          const resources = normalizeResources(value);
          if (progress.restType === 'long_rest') return { slots: {}, abilities: {} };
          if (progress.restType === 'short_rest') {
            return { slots: resources.slots, abilities: Object.fromEntries(Object.entries(resources.abilities).filter(([, entry]: [string, any]) => entry.recharge === 'long_rest')) };
          }
          if (Number(progress.turns || 0) > 0) {
            return { slots: resources.slots, abilities: Object.fromEntries(Object.entries(resources.abilities).filter(([, entry]: [string, any]) => entry.recharge !== 'turn')) };
          }
          return resources;
        };

        const linkedPlayers = await db.getAllAsync<any>(
          `SELECT device_id, character_id, character_name FROM lan_session_players WHERE session_id = ? AND character_id IS NOT NULL`,
          [session.id]
        );

        for (const player of linkedPlayers) {
          const characterId = Number(player.character_id || 0);
          if (!characterId) continue;

          let character = await db.getFirstAsync<any>(`SELECT id, name, stats, hp_temp, spell_slots_used FROM characters WHERE id = ?`, [characterId]);
          if (!character) {
            const snapshotRow = await db.getFirstAsync<{ payload: string }>(
              `SELECT payload FROM lan_character_snapshots
               WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
               ORDER BY updated_at DESC LIMIT 1`,
              [session.id, player.device_id, String(characterId)]
            );
            if (snapshotRow?.payload) {
              try {
                const snapshot = JSON.parse(snapshotRow.payload);
                character = { ...(snapshot?.data || {}), name: snapshot?.name || snapshot?.data?.name || player.character_name };
              } catch {
                character = null;
              }
            }
          }

          if (!character) continue;
          const previousResources = normalizeResources(character.spell_slots_used || '{}');
          const nextResources = resetResources(previousResources);
          if (JSON.stringify(previousResources) !== JSON.stringify(nextResources)) {
            await emitOfficialEvent({
              sessionId: session.id,
              eventType: 'RESOURCE_CHANGED',
              commandId: command.commandId,
              actorDeviceId: command.deviceId,
              actorName: command.actorName || 'Mestre',
              targetDeviceId: player.device_id || null,
              targetCharacterId: characterId,
              targetName: character.name || player.character_name || 'Personagem',
              previousValue: { spell_slots_used: JSON.stringify(previousResources) },
              currentValue: { spell_slots_used: JSON.stringify(nextResources) },
              description: progress.restType === 'long_rest'
                ? `Recursos de ${character.name || player.character_name || 'Personagem'} foram resetados por descanso longo.`
                : progress.restType === 'short_rest'
                  ? `Recursos de descanso curto foram resetados em ${character.name || player.character_name || 'Personagem'}.`
                  : `Recursos de turno foram atualizados em ${character.name || player.character_name || 'Personagem'}.`,
              payload: { progress },
            });
          }

          const previousStats = normalizeStats(character.stats);
          if (previousStats.timed_effects.length === 0) continue;

          const previousHpTemp = Number(character.hp_temp || 0);
          const result = progressTimedEffects(previousStats, previousHpTemp, progress);
          if (!result.changed) continue;

          await emitOfficialEvent({
            sessionId: session.id,
            eventType: result.expired.length > 0 ? 'EFFECT_EXPIRED' : 'EFFECT_APPLIED',
            commandId: command.commandId,
            actorDeviceId: command.deviceId,
            actorName: command.actorName || 'Mestre',
            targetDeviceId: player.device_id || null,
            targetCharacterId: characterId,
            targetName: character.name || player.character_name || 'Personagem',
            previousValue: { stats: previousStats, hp_temp: previousHpTemp },
            currentValue: { stats: result.stats, hp_temp: result.hpTemp },
            description:
              result.expired.length > 0
                ? `${result.expired.length} efeito(s) expiraram em ${character.name || player.character_name || 'Personagem'}.`
                : `Duracao dos efeitos atualizada em ${character.name || player.character_name || 'Personagem'}.`,
            payload: { progress, expiredEffects: result.expired },
          });
        }
      };

      if (command.command === 'MASTER_ADVANCE_TURN') {
        const delta = numberFromPayload(command.payload, 'delta', 1);
        const previous = state.turn;
        const current = Math.max(1, previous + delta);
        await updateLanSessionState(db, session.id, { turn: current });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TURN_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          previousValue: previous,
          currentValue: current,
          description: `Turno alterado de ${previous} para ${current}.`,
        });
        if (delta > 0) await progressSessionEffects({ turns: delta });
        return;
      }

      if (command.command === 'MASTER_UPDATE_INITIATIVE') {
        if (command.deviceId !== deviceIdRef.current) {
          await rejectCommand(session.id, command, 'Apenas o mestre pode alterar a iniciativa.', peerId);
          return;
        }
        const rawOrder = Array.isArray(command.payload?.initiativeOrder) ? command.payload.initiativeOrder : [];
        const rawScores = command.payload?.initiativeScores && typeof command.payload.initiativeScores === 'object'
          ? command.payload.initiativeScores as Record<string, unknown>
          : {};
        const rawVirtualCombatants = Array.isArray(command.payload?.virtualCombatants)
          ? command.payload.virtualCombatants
          : [];
        const virtualCombatants = rawVirtualCombatants
          .map((combatant: any) => {
            const hpMax = Math.max(1, Math.trunc(Number(combatant?.hpMax || 1)));
            return {
              id: String(combatant?.id || ''),
              name: String(combatant?.name || 'Monstro').trim().slice(0, 60) || 'Monstro',
              initiative: Math.trunc(Number(combatant?.initiative || 0)),
              hpCurrent: Math.min(hpMax, Math.max(1, Math.trunc(Number(combatant?.hpCurrent || 1)))),
              hpMax,
              avatarSeed: String(combatant?.avatarSeed || combatant?.name || 'Monstro').slice(0, 80),
            };
          })
          .filter(combatant => combatant.id);
        const validVirtualKeys = new Set(virtualCombatants.map(combatant => `virtual:${combatant.id}`));
        const playerRows = await getLanPlayers(db, session.id);
        const validPlayerKeys = new Set(
          playerRows
            .filter(player => player.character_id)
            .map(player => `${player.device_id}_${player.character_id}`)
        );
        const validKeys = new Set([...validPlayerKeys, ...validVirtualKeys]);
        const initiativeOrder = rawOrder.map(String).filter((key, index, list) => validKeys.has(key) && list.indexOf(key) === index);
        [...validPlayerKeys, ...validVirtualKeys].forEach(key => {
          if (!initiativeOrder.includes(key)) initiativeOrder.push(key);
        });
        const initiativeScores = Object.fromEntries(
          Object.entries(rawScores)
            .filter(([key]) => validKeys.has(key))
            .map(([key, value]) => [key, Math.trunc(Number(value || 0))])
        );
        virtualCombatants.forEach(combatant => {
          initiativeScores[`virtual:${combatant.id}`] = combatant.initiative;
        });

        await updateLanSessionState(db, session.id, {
          initiativeOrder,
          initiativeScores,
          virtualCombatants,
        });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'INITIATIVE_UPDATED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          previousValue: {
            initiativeOrder: state.initiativeOrder,
            initiativeScores: state.initiativeScores,
            virtualCombatants: state.virtualCombatants,
          },
          currentValue: { initiativeOrder, initiativeScores, virtualCombatants },
          description: 'Mestre atualizou a ordem de iniciativa.',
        });
        return;
      }

      if (command.command === 'MASTER_ADVANCE_TIME') {
        const minutes = numberFromPayload(command.payload, 'minutes', 0);
        const previous = state.campaignMinutes;
        const current = Math.max(0, previous + minutes);
        await updateLanSessionState(db, session.id, { campaignMinutes: current });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TIME_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          previousValue: previous,
          currentValue: current,
          description: `Tempo da campanha avancou ${minutes} minuto(s).`,
        });
        if (minutes > 0) await progressSessionEffects({ minutes });
        return;
      }

      if (command.command === 'MASTER_SHORT_REST' || command.command === 'MASTER_LONG_REST') {
        const restType = command.command === 'MASTER_SHORT_REST' ? 'short_rest' : 'long_rest';
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'REST_APPLIED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: restType === 'short_rest' ? 'Mestre aplicou descanso curto.' : 'Mestre aplicou descanso longo.',
          payload: { restType },
        });
        await progressSessionEffects({ restType });
        return;
      }

      const targetCharacterId = Number(command.payload?.targetCharacterId || command.characterId || 0);
      const targetDeviceId = String(command.payload?.targetDeviceId || '');
      if (!targetCharacterId) {
        await rejectCommand(session.id, command, 'Comando sem personagem alvo.', peerId);
        return;
      }

      const localDeviceId = deviceIdRef.current;
      const isLocalTarget = !targetDeviceId || targetDeviceId === localDeviceId;
      let target: any = null;

      if (isLocalTarget) {
        target = await db.getFirstAsync<any>(`SELECT id, name, stats, equipment, hp_current, hp_max, hp_temp, xp, gp, sp, cp, spell_slots_used FROM characters WHERE id = ?`, [
          targetCharacterId,
        ]);
      } else {
        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [session.id, targetDeviceId, String(targetCharacterId)]
        );

        if (snapshotRow?.payload) {
          try {
            const snapshot = JSON.parse(snapshotRow.payload);
            target = {
              ...(snapshot?.data || {}),
              name: snapshot?.name || snapshot?.data?.name,
            };
          } catch {
            target = null;
          }
        }
      }
      if (!target) {
        await rejectCommand(
          session.id,
          command,
          isLocalTarget
            ? 'Ficha alvo nao encontrada no mestre.'
            : 'Snapshot da ficha remota alvo nao encontrado. Aguarde a sincronizacao do jogador e tente novamente.',
          peerId
        );
        return;
      }
      const requestedTargetName = String(command.payload?.targetName || '').trim();
      const targetName = target?.name || requestedTargetName || 'Personagem';
      if (!isLocalTarget && requestedTargetName && requestedTargetName !== 'Personagem' && target?.name && String(target.name).trim() !== requestedTargetName) {
        await rejectCommand(
          session.id,
          command,
          `Snapshot remoto divergente para o alvo. Comando pediu "${requestedTargetName}", mas o snapshot atual aponta "${String(target.name).trim()}". Aguarde a sincronizacao e tente novamente.`,
          peerId
        );
        return;
      }

      if (command.command === 'MASTER_APPLY_HP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const mode = String(command.payload?.mode || 'damage');
        const previousStats = normalizeStats(target?.stats);
        const previous = {
          hp_current: Number(target?.hp_current || 0),
          hp_max: Number(target?.hp_max || 0),
          hp_temp: Number(target?.hp_temp || 0),
          stats: previousStats,
        };
        let nextHp = previous.hp_current;
        let nextTempHp = previous.hp_temp;
        let nextStats = previousStats;
        let absorbedByTemp = 0;

        if (mode === 'heal') {
          nextHp = Math.min(previous.hp_max, previous.hp_current + Math.abs(amount));
        } else {
          let remainingDamage = Math.abs(amount);
          absorbedByTemp = Math.min(previous.hp_temp, remainingDamage);
          nextTempHp = Math.max(0, previous.hp_temp - absorbedByTemp);
          remainingDamage = Math.max(0, remainingDamage - absorbedByTemp);
          nextHp = Math.max(0, previous.hp_current - remainingDamage);
          if (previous.hp_temp > 0 && absorbedByTemp > 0 && nextTempHp === 0) {
            nextStats = clearTempHpEffects(previousStats);
          } else if (absorbedByTemp > 0) {
            nextStats = consumeTempHpEffects(previousStats, absorbedByTemp);
          }
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'HP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: { hp_current: nextHp, hp_max: previous.hp_max, hp_temp: nextTempHp, stats: nextStats },
          description:
            mode === 'heal'
              ? `${command.actorName || 'Mestre'} curou ${Math.abs(amount)} PV em ${targetName}.`
              : `${command.actorName || 'Mestre'} aplicou ${Math.abs(amount)} dano em ${targetName}${absorbedByTemp > 0 ? ` (${absorbedByTemp} absorvido por PV temporario)` : ''}.`,
          payload: {
            mode,
            amount: Math.abs(amount),
            absorbedByTemp,
            requestCommandId: command.payload?.requestCommandId || null,
            batchCount: command.payload?.batchCount || null,
            batchedCommandIds: command.payload?.batchedCommandIds || null,
          },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_TEMP_HP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const mode = String(command.payload?.mode || 'add');
        const durationUnit = String(command.payload?.durationUnit || 'short_rest');
        const durationValue = numberFromPayload(command.payload, 'durationValue', 1);
        const previousStats = normalizeStats(target?.stats);
        const previous = { hp_temp: Number(target?.hp_temp || 0), stats: previousStats };
        const baseStats = mode === 'set' ? clearTempHpEffects(previousStats) : previousStats;
        const current = {
          hp_temp: mode === 'set' ? Math.max(0, amount) : Math.max(0, previous.hp_temp + amount),
          stats: baseStats,
        };
        if (amount > 0) {
          current.stats.timed_effects.push({
            id: command.commandId,
            kind: 'temp_hp',
            label: `PV temporario +${Math.abs(amount)}`,
            source: 'master',
            amount: Math.abs(amount),
            durationUnit,
            durationValue,
            createdAt: new Date().toISOString(),
          });
        }
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TEMP_HP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: current,
          description: `Mestre ajustou vida temporaria de ${targetName}: ${previous.hp_temp} -> ${current.hp_temp}.`,
          payload: { amount, mode, durationUnit, durationValue },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_ATTRIBUTE') {
        const stat = String(command.payload?.stat || '').toUpperCase();
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const durationMode = String(command.payload?.durationMode || 'temporary');
        const durationUnit = String(command.payload?.durationUnit || 'turn');
        const durationValue = numberFromPayload(command.payload, 'durationValue', 1);
        if (!['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(stat)) {
          await rejectCommand(session.id, command, 'Atributo invalido para buff do mestre.', peerId);
          return;
        }

        const previousStats = parseJsonValue<Record<string, any>>(target?.stats, {});
        const nextStats: Record<string, any> = {
          ...previousStats,
          temp_mods: { ...(previousStats.temp_mods || {}) },
          timed_effects: Array.isArray(previousStats.timed_effects) ? [...previousStats.timed_effects] : [],
        };

        if (durationMode === 'permanent') {
          if (stat === 'CA') {
            nextStats.temp_mods.CA = Number(nextStats.temp_mods.CA || 0) + amount;
          } else {
            nextStats[stat] = String((Number(nextStats[stat] || 10) || 10) + amount);
            nextStats.extra_points = Number(nextStats.extra_points || 0) + amount;
          }
        } else {
          nextStats.temp_mods[stat] = Number(nextStats.temp_mods[stat] || 0) + amount;
          nextStats.timed_effects.push({
            id: command.commandId,
            kind: 'attribute',
            label: `${stat} ${amount > 0 ? '+' : ''}${amount}`,
            source: 'master',
            stat,
            amount,
            durationUnit,
            durationValue,
            createdAt: new Date().toISOString(),
          });
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'ATTRIBUTE_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { stats: previousStats },
          currentValue: { stats: nextStats },
          description: `Mestre aplicou ${amount > 0 ? '+' : ''}${amount} em ${stat} para ${targetName}.`,
          payload: {
            stat,
            amount,
            durationMode,
            durationUnit,
            durationValue,
            requestCommandId: command.payload?.requestCommandId || null,
          },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_RESOURCE') {
        const previousText = typeof target?.spell_slots_used === 'string'
          ? target.spell_slots_used
          : JSON.stringify(target?.spell_slots_used || {});
        const nextPayload = command.payload?.spellSlotsUsed ?? command.payload?.spell_slots_used ?? {};
        const nextText = typeof nextPayload === 'string' ? nextPayload : JSON.stringify(nextPayload || {});

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'RESOURCE_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { spell_slots_used: previousText },
          currentValue: { spell_slots_used: nextText },
          description: String(command.payload?.description || `Mestre ajustou recursos de ${targetName}.`),
          payload: {
            requestCommandId: command.payload?.requestCommandId || null,
          },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_EFFECT') {
        const effectName = String(command.payload?.effectName || command.payload?.name || 'Efeito');
        const effectDescription = String(command.payload?.description || '');
        const effectColor = String(command.payload?.color || '#F4A84D');
        const durationUnit = String(command.payload?.durationUnit || 'turn');
        const durationValue = numberFromPayload(command.payload, 'durationValue', 1);
        const previousStats = normalizeStats(target?.stats);
        const nextStats = normalizeStats(previousStats);
        nextStats.timed_effects.push({
          id: command.commandId,
          kind: 'condition',
          label: effectName,
          conditionName: effectName,
          description: effectDescription,
          color: effectColor,
          source: 'master',
          durationUnit,
          durationValue,
          createdAt: new Date().toISOString(),
        });

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'EFFECT_APPLIED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { stats: previousStats, hp_temp: Number(target?.hp_temp || 0) },
          currentValue: { stats: nextStats, hp_temp: Number(target?.hp_temp || 0) },
          description: `Mestre aplicou ${effectName} em ${targetName} por ${durationValue} ${durationUnit}.`,
          payload: { effectName, effectDescription, effectColor, durationUnit, durationValue },
        });
        return;
      }

      if (command.command === 'MASTER_REMOVE_EFFECT') {
        const effectId = String(command.payload?.effectId || '');
        if (!effectId) {
          await rejectCommand(session.id, command, 'Efeito sem identificador para remocao.', peerId);
          return;
        }

        const previousStats = normalizeStats(target?.stats);
        const previousHpTemp = Number(target?.hp_temp || 0);
        const result = removeTimedEffect(previousStats, effectId, previousHpTemp);
        if (!result.removed) {
          await rejectCommand(session.id, command, 'Efeito nao encontrado no personagem.', peerId);
          return;
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'EFFECT_EXPIRED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { stats: previousStats, hp_temp: previousHpTemp },
          currentValue: { stats: result.stats, hp_temp: result.hpTemp },
          description: `Mestre removeu o efeito ${result.removed.label || result.removed.stat || result.removed.kind || effectId} de ${targetName}.`,
          payload: { effectId, removedEffect: result.removed },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_XP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const previous = Number(target?.xp || 0);
        const current = Math.max(0, previous + amount);
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'XP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { xp: previous },
          currentValue: { xp: current },
          description: `Mestre alterou XP de ${targetName}: ${previous} -> ${current}.`,
          payload: {
            amount,
            requestCommandId: command.payload?.requestCommandId || null,
          },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_COINS') {
        const previous = { gp: Number(target?.gp || 0), sp: Number(target?.sp || 0), cp: Number(target?.cp || 0) };
        const current = {
          gp: Math.max(0, previous.gp + numberFromPayload(command.payload, 'gp', 0)),
          sp: Math.max(0, previous.sp + numberFromPayload(command.payload, 'sp', 0)),
          cp: Math.max(0, previous.cp + numberFromPayload(command.payload, 'cp', 0)),
        };
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'COINS_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: current,
          description: `Mestre alterou moedas de ${targetName}.`,
          payload: {
            gp: numberFromPayload(command.payload, 'gp', 0),
            sp: numberFromPayload(command.payload, 'sp', 0),
            cp: numberFromPayload(command.payload, 'cp', 0),
            requestCommandId: command.payload?.requestCommandId || null,
          },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_ITEM') {
        const item = (command.payload?.item || {}) as Record<string, unknown>;
        const quantity = numberFromPayload(command.payload, 'quantity', 1);
        const itemName = String(item.name || command.payload?.itemName || 'Item');
        const transferItem = await hydrateTransferItem(item, itemName);
        const previousEquipment = normalizeEquipment(target?.equipment);
        const currentEquipment = addItemToEquipment(previousEquipment, transferItem, quantity);
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'ITEM_ADDED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { equipment: previousEquipment },
          currentValue: { equipment: currentEquipment },
          description: `Mestre enviou ${quantity}x ${itemName} para ${targetName}.`,
          payload: {
            item: transferItem,
            quantity,
            requestCommandId: command.payload?.requestCommandId || null,
          },
        });
      }
    },
    [db, emitOfficialEvent, emitTradeExpiredEvent, finishClosedSessionHost, refreshPlayers, refreshSavedSessions, rejectCommand, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const runAuthoritativeCommandQueued = useCallback(
    async (command: LanCommandMessage, peerId?: string) => {
      const queuedAt = Date.now();
      const enqueueCommand = async (
        queuedCommand: LanCommandMessage,
        queuedPeerId: string | undefined,
        originalQueuedAt: number,
        batchMetadata?: Record<string, unknown>
      ) => {
        const run = commandQueueRef.current.then(async () => {
          const processStartedAt = Date.now();
          await traceLan('LAN_COMMAND', 'runAuthoritativeCommandQueued', 'process_start', `Processamento autoritativo iniciado: ${queuedCommand.command}.`, {
            command: queuedCommand.command,
            commandId: queuedCommand.commandId,
            peerId: queuedPeerId,
            queueWaitMs: processStartedAt - originalQueuedAt,
            ...batchMetadata,
          }, 'debug', queuedCommand.commandId);
          await handleAuthoritativeCommand(queuedCommand, queuedPeerId);
          const processedAt = Date.now();
          const session = activeSessionRef.current || closingSessionRef.current;
          let syncPushScheduled = false;
          if (session?.role === 'master') {
            const reason = `command:${queuedCommand.command}`;
            const scheduled = scheduledPushSyncRef.current;
            if (scheduled) {
              scheduled.session = session;
              scheduled.reasons.add(reason);
            } else {
              const reasons = new Set<string>([reason]);
              const timer = setTimeout(() => {
                const pending = scheduledPushSyncRef.current;
                scheduledPushSyncRef.current = null;
                if (!pending) return;
                const batchReason = pending.reasons.size > 1
                  ? `batch:${[...pending.reasons].slice(0, 4).join(',')}${pending.reasons.size > 4 ? ',...' : ''}`
                  : [...pending.reasons][0] || 'command-batch';
                void pushTcpSyncRef.current?.(pending.session, batchReason).catch(error => {
                  void traceLan('LAN_TCP', 'pushTcpSync', 'scheduled_failed', 'Falha ao enviar sync LAN agendado.', {
                    sessionId: pending.session.id,
                    reason: batchReason,
                    error: error instanceof Error ? error.message : String(error),
                  }, 'warn');
                });
              }, 80);
              scheduledPushSyncRef.current = { timer, session, reasons };
            }
            syncPushScheduled = true;
          }
          await traceLan('LAN_COMMAND', 'runAuthoritativeCommandQueued', 'process_done', `Processamento autoritativo finalizado: ${queuedCommand.command}.`, {
            durationMs: Date.now() - processStartedAt,
            handlerDurationMs: processedAt - processStartedAt,
            syncPushDurationMs: Date.now() - processedAt,
            syncPushScheduled,
            queueWaitMs: processStartedAt - originalQueuedAt,
            command: queuedCommand.command,
            commandId: queuedCommand.commandId,
            peerId: queuedPeerId,
            ...batchMetadata,
          }, 'debug', queuedCommand.commandId);
        });
        commandQueueRef.current = run.catch(() => undefined);
        await run;
      };

      const flushHpBatch = (batchKey: string, pending: PendingHpBatch) => {
        clearTimeout(pending.timer);
        delete hpCommandBatchRef.current[batchKey];

        const batchedCommand = makeBatchedHpCommand(pending.entries);
        const oldestQueuedAt = Math.min(...pending.entries.map(entry => entry.queuedAt));
        const batchMetadata = pending.entries.length > 1
          ? {
              batchCount: pending.entries.length,
              batchedCommandIds: pending.entries.map(entry => entry.command.commandId),
              batchWindowMs: LAN_HP_BATCH_WINDOW_MS,
            }
          : undefined;

        void enqueueCommand(batchedCommand, pending.entries[0]?.peerId, oldestQueuedAt, batchMetadata)
          .then(() => pending.entries.forEach(entry => entry.resolve()))
          .catch(error => pending.entries.forEach(entry => entry.reject(error)));
      };

      if (isBatchableMasterHpCommand(command)) {
        await new Promise<void>((resolve, reject) => {
          const batchKey = makeHpBatchKey(command);
          const pendingEntry: PendingHpBatchCommand = { command, peerId, queuedAt, resolve, reject };
          const existing = hpCommandBatchRef.current[batchKey];
          if (existing) {
            existing.entries.push(pendingEntry);
            return;
          }

          const timer = setTimeout(() => {
            const pending = hpCommandBatchRef.current[batchKey];
            if (!pending) return;
            flushHpBatch(batchKey, pending);
          }, LAN_HP_BATCH_WINDOW_MS);

          hpCommandBatchRef.current[batchKey] = { timer, entries: [pendingEntry] };
        });
        return;
      }

      Object.entries(hpCommandBatchRef.current)
        .sort(([, left], [, right]) => Math.min(...left.entries.map(entry => entry.queuedAt)) - Math.min(...right.entries.map(entry => entry.queuedAt)))
        .forEach(([batchKey, pending]) => flushHpBatch(batchKey, pending));

      await enqueueCommand(command, peerId, queuedAt);
    },
    [handleAuthoritativeCommand, traceLan]
  );

  const handleCharacterUpsert = useCallback(
    async (characterMessage: LanCharacterMessage) => {
      const session = activeSessionRef.current;
      const localDeviceId = deviceIdRef.current;
      await traceLan('LAN_RPC', 'handleCharacterUpsert', 'received', 'Snapshot de ficha recebido via RPC LAN.', {
        deviceId: characterMessage.deviceId,
        characterId: characterMessage.snapshot?.localId || null,
        characterName: characterMessage.snapshot?.name || null,
        snapshotBytes: estimateJsonBytes(characterMessage.snapshot),
        includesAvatarDataUri: Boolean(characterMessage.snapshot?.data?.avatar_data_uri),
      }, 'debug');

      if (!session || session.role !== 'master') return;
      if (characterMessage.deviceId === localDeviceId) return;

      await saveCharacterSnapshot(db, session.id, characterMessage.deviceId, characterMessage.snapshot);

      const existingPlayer = await db.getFirstAsync<{
        player_name?: string | null;
        character_id?: number | null;
      }>(
        `SELECT player_name, character_id
         FROM lan_session_players
         WHERE session_id = ? AND device_id = ?
         LIMIT 1`,
        [session.id, characterMessage.deviceId]
      );
      const snapshotCharacterId = Number(characterMessage.snapshot.localId || 0) || null;
      const previousCharacterId = existingPlayer?.character_id ? Number(existingPlayer.character_id) : null;
      await upsertLanPlayer(
        db,
        session.id,
        characterMessage.deviceId,
        existingPlayer?.player_name || characterMessage.snapshot.name || 'Jogador',
        snapshotCharacterId,
        characterMessage.snapshot.name,
        true
      );
      await refreshPlayers();
      setLanRevision(prev => prev + 1);

      const joinedEventKey = snapshotCharacterId ? `${session.id}:${characterMessage.deviceId}:${snapshotCharacterId}` : '';
      const joinedEventExists = snapshotCharacterId
        ? await db.getFirstAsync<{ id: number }>(
            `SELECT id FROM lan_event_log
             WHERE session_id = ?
               AND event_type = 'PLAYER_JOINED'
               AND actor_device_id = ?
               AND target_character_id = ?
             LIMIT 1`,
            [session.id, characterMessage.deviceId, snapshotCharacterId]
          )
        : null;
      if (snapshotCharacterId && previousCharacterId !== snapshotCharacterId) {
        if (!joinedEventExists && !joinedCharacterEventsRef.current[joinedEventKey]) {
          joinedCharacterEventsRef.current[joinedEventKey] = true;
          await emitOfficialEvent({
            sessionId: session.id,
            eventType: 'PLAYER_JOINED',
            actorDeviceId: characterMessage.deviceId,
            actorName: existingPlayer?.player_name || 'Jogador',
            targetDeviceId: characterMessage.deviceId,
            targetCharacterId: snapshotCharacterId,
            targetName: characterMessage.snapshot.name,
            description: `${existingPlayer?.player_name || 'Jogador'} vinculou a ficha ${characterMessage.snapshot.name}.`,
          });
        }
      }

      setLastNotice(`Ficha recebida: ${characterMessage.snapshot.name}.`);
      await pushTcpSyncRef.current?.(session, 'character-upsert');
    },
    [db, emitOfficialEvent, refreshPlayers, traceLan]
  );

  const getLocalLastEventSeq = useCallback(
    async (sessionId: string) => {
      const row = await db.getFirstAsync<{ last_event_seq?: number }>(
        `SELECT last_event_seq FROM lan_session_state WHERE session_id = ?`,
        [sessionId]
      );
      return Number(row?.last_event_seq || 0);
    },
    [db, traceLan]
  );

  const buildRpcSyncPayload = useCallback(
    async (session: LanSessionRecord, sinceOrOptions: number | BuildRpcSyncPayloadOptions = 0) => {
      const startedAt = Date.now();
      const options: BuildRpcSyncPayloadOptions = typeof sinceOrOptions === 'number'
        ? { sinceSeq: sinceOrOptions }
        : sinceOrOptions;
      const sinceSeq = Math.max(0, Number(options.sinceSeq || 0));
      const eventLimit = Math.max(1, Number(options.eventLimit || LAN_SYNC_DEFAULT_EVENT_LIMIT));
      const recentLimit = Math.max(0, Number(options.recentLimit ?? 20));
      const includeRecentEvents = options.includeRecentEvents ?? true;
      const includePlayerSnapshots = options.includePlayerSnapshots ?? sinceSeq <= 0;
      const includeCustomContent = options.includeCustomContent ?? (session.sync_custom_content && sinceSeq <= 0);
      if (session.role === 'master' && session.status !== 'closed') {
        await expireStaleTrades(session);
      }
      const selectedContent = selectedContentFromSession(session);
      const [state, playersRows, events, recentEvents, customContent, lastEventSeq] = await Promise.all([
        getLanSessionState(db, session.id),
        getLanPlayers(db, session.id),
        getLanEventsSince(db, session.id, sinceSeq, eventLimit),
        includeRecentEvents && recentLimit > 0 ? getLanHistoryPage(db, session.id, 0, recentLimit) : Promise.resolve([]),
        includeCustomContent ? getSelectedCustomContentPayloads(db, selectedContent) : Promise.resolve([]),
        getLocalLastEventSeq(session.id),
      ]);
      if (includeCustomContent) {
        customContentCacheRef.current = customContent;
      }
      const playersPayload = includePlayerSnapshots
        ? playersRows
        : playersRows.map(player => {
            const compactPlayer = { ...player } as Record<string, unknown>;
            delete compactPlayer.snapshot_payload;
            delete compactPlayer.snapshot_updated_at;
            return compactPlayer;
          });

      const payload = {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          config: makeSessionConfig(session),
        },
        state,
        players: playersPayload,
        events,
        recentEvents,
        seq: Math.max(lastEventSeq, ...events.map(event => event.seq), ...recentEvents.map(event => event.seq)),
        customContent,
      };
      await traceLan('LAN_SYNC', 'buildRpcSyncPayload', 'built', 'Payload de sincronizacao LAN montado.', {
        durationMs: Date.now() - startedAt,
        sinceSeq,
        resultSeq: payload.seq,
        playersCount: playersPayload.length,
        playerSnapshotsIncluded: includePlayerSnapshots,
        eventsCount: events.length,
        recentEventsCount: recentEvents.length,
        customContentCount: customContent.length,
        syncCustomContent: includeCustomContent,
        compact: Boolean(options.compact),
        payloadBytes: estimateJsonBytes(payload),
      }, 'debug');
      return payload;
    },
    [db, expireStaleTrades, getLocalLastEventSeq, traceLan]
  );

  const pushTcpSync = useCallback(
    async (session: LanSessionRecord, reason = 'sync') => {
      const server = rpcServerRef.current;
      if (!server || session.role !== 'master') return;

      const lastEventSeq = await getLocalLastEventSeq(session.id);
      const isCharacterUpsert = reason === 'character-upsert';
      const payload = await buildRpcSyncPayload(session, {
        sinceSeq: isCharacterUpsert ? 0 : Math.max(0, lastEventSeq - LAN_SYNC_PUSH_EVENT_WINDOW),
        eventLimit: isCharacterUpsert ? LAN_SYNC_DEFAULT_EVENT_LIMIT : LAN_SYNC_PUSH_EVENT_LIMIT,
        recentLimit: LAN_SYNC_PUSH_RECENT_LIMIT,
        includeRecentEvents: false,
        includePlayerSnapshots: isCharacterUpsert,
        includeCustomContent: false,
        compact: !isCharacterUpsert,
      });
      const sent = server.broadcast({
        method: 'SYNC',
        sessionId: session.id,
        payload,
      });
      if (sent > 0) {
        setPeerCount(server.connectedDeviceIds().length);
        await traceLan('LAN_TCP', 'pushTcpSync', 'sent', 'Sync LAN enviado por push TCP.', {
          sessionId: session.id,
          reason,
          sent,
          payloadBytes: estimateJsonBytes(payload),
          playersCount: Array.isArray(payload.players) ? payload.players.length : 0,
          eventsCount: Array.isArray(payload.events) ? payload.events.length : 0,
          recentEventsCount: Array.isArray(payload.recentEvents) ? payload.recentEvents.length : 0,
          customContentCount: Array.isArray(payload.customContent) ? payload.customContent.length : 0,
          playerSnapshotsIncluded: isCharacterUpsert,
          compact: !isCharacterUpsert,
          seq: Number(payload.seq || 0),
        }, 'debug');
      }
    },
    [buildRpcSyncPayload, getLocalLastEventSeq, traceLan]
  );

  useEffect(() => {
    pushTcpSyncRef.current = pushTcpSync;
  }, [pushTcpSync]);

  const applyRpcSyncPayload = useCallback(
    async (payload: Record<string, unknown> | undefined) => {
      if (!payload) return;
      const startedAt = Date.now();
      const payloadBytes = estimateJsonBytes(payload);
      let snapshotsSaved = 0;
      let newEventsCount = 0;

      const customContent = payload.customContent as LanCustomContentMessage['records'] | undefined;
      if (Array.isArray(customContent) && customContent.length > 0) {
        await upsertCustomContentPayloads(db, customContent);
      }

      const state = payload.state as LanSessionSnapshotMessage['state'] | undefined;
      if (state?.sessionId) {
        const currentBeforeUpdate = activeSessionRef.current;
        if (state.status === 'closed' && currentBeforeUpdate?.role === 'player' && currentBeforeUpdate.id === state.sessionId) {
          await traceLan('LAN_SYNC', 'applyRpcSyncPayload', 'closed_state_received', 'Payload de sync informou sessao encerrada.', {
            durationMs: Date.now() - startedAt,
            payloadBytes,
            sessionId: state.sessionId,
            stateStatus: state.status,
            customContentCount: Array.isArray(customContent) ? customContent.length : 0,
          }, 'info');
          await finalizeClosedPlayerSession(currentBeforeUpdate, 'sync-state');
          return;
        }
        await updateLanSessionState(db, state.sessionId, {
          status: state.status,
          turn: state.turn,
          campaignMinutes: state.campaignMinutes,
          paused: state.paused,
          initiativeOrder: state.initiativeOrder || [],
          initiativeScores: state.initiativeScores || {},
          virtualCombatants: state.virtualCombatants || [],
        });
        const current = activeSessionRef.current;
        if (current?.id === state.sessionId) {
          if (state.status !== 'closed') {
            const localStatus: LanSessionStatus = state.status === 'paused'
              ? 'paused'
              : current.role === 'master'
                ? 'open'
                : 'connected';
            if (current.status !== localStatus) {
              await setLanSessionStatus(db, state.sessionId, localStatus);
              const nextSession = { ...current, status: localStatus };
              setActiveSession(nextSession);
              activeSessionRef.current = nextSession;
              await refreshSavedSessions();
            }
          }
        }
      }

      const playerRows = Array.isArray(payload.players) ? payload.players : [];
      for (const rawPlayer of playerRows) {
        const player = rawPlayer as any;
        if (!player.device_id) continue;
        let snapshot: LanCharacterMessage['snapshot'] | null = null;
        if (player.snapshot_payload) {
          try {
            snapshot = typeof player.snapshot_payload === 'string' ? JSON.parse(player.snapshot_payload) : player.snapshot_payload;
          } catch {
            snapshot = null;
          }
        }
        if (snapshot?.localId) {
          const snapshotChanged = await saveCharacterSnapshot(db, state?.sessionId || activeSessionRef.current?.id || '', String(player.device_id), snapshot);
          if (snapshotChanged) snapshotsSaved += 1;
        }
        await upsertLanPlayer(
          db,
          state?.sessionId || activeSessionRef.current?.id || '',
          String(player.device_id),
          String(player.player_name || 'Jogador'),
          player.character_id ? Number(player.character_id) : snapshot?.localId ? Number(snapshot.localId) : null,
          player.character_name ? String(player.character_name) : snapshot?.name ? String(snapshot.name) : null,
          Number(player.connected || 0) === 1
        );
      }

      const events = Array.isArray(payload.events) ? payload.events as LanOfficialEventMessage[] : [];
      const syncSessionId = state?.sessionId || activeSessionRef.current?.id || '';
      const localSeqBeforeEvents = syncSessionId ? await getLocalLastEventSeq(syncSessionId) : 0;
      let expectedSeq = localSeqBeforeEvents;
      let skippedEventsDueToGap = 0;
      const orderedEvents = [...events].sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
      const payloadSeq = Number(payload.seq || 0);
      for (const event of orderedEvents) {
        const eventSeq = Number(event.seq || 0);
        if (eventSeq <= expectedSeq) continue;
        if (eventSeq > expectedSeq + 1) {
          skippedEventsDueToGap = orderedEvents.filter(nextEvent => Number(nextEvent.seq || 0) > expectedSeq).length;
          break;
        }
        const isNewEvent = await saveLanOfficialEvent(db, event);
        expectedSeq = Math.max(expectedSeq, eventSeq);
        if (isNewEvent) {
          newEventsCount += 1;
          await applyOfficialEventLocally(event);
        }
      }

      const shouldRequestCatchUp = skippedEventsDueToGap > 0 || (payloadSeq > expectedSeq && events.length >= LAN_SYNC_DEFAULT_EVENT_LIMIT);
      if (shouldRequestCatchUp) {
        const current = activeSessionRef.current;
        const sinceSeq = syncSessionId ? await getLocalLastEventSeq(syncSessionId) : localSeqBeforeEvents;
        tcpClientRef.current?.updatePayload({ sinceSeq });
        await traceLan('LAN_SYNC', 'applyRpcSyncPayload', skippedEventsDueToGap > 0 ? 'event_gap_detected' : 'event_page_pending', skippedEventsDueToGap > 0 ? 'Payload compacto chegou com lacuna de eventos; solicitando catch-up.' : 'Payload de sync ainda tem mais eventos; solicitando proxima pagina.', {
          durationMs: Date.now() - startedAt,
          payloadBytes,
          sessionId: syncSessionId || null,
          stateStatus: state?.status || null,
          localSeqBeforeEvents,
          currentLocalSeq: sinceSeq,
          payloadSeq,
          expectedSeqAfterApply: expectedSeq,
          firstPayloadEventSeq: orderedEvents[0]?.seq || null,
          lastPayloadEventSeq: orderedEvents[orderedEvents.length - 1]?.seq || null,
          skippedEventsDueToGap,
          eventsCount: events.length,
          role: current?.role || null,
        }, 'warn');
      }

      await refreshPlayers();
      setLanRevision(prev => prev + 1);
      await traceLan('LAN_SYNC', 'applyRpcSyncPayload', 'applied', 'Payload de sincronizacao LAN aplicado localmente.', {
        durationMs: Date.now() - startedAt,
        payloadBytes,
        sessionId: state?.sessionId || activeSessionRef.current?.id || null,
        stateStatus: state?.status || null,
        playersCount: playerRows.length,
        snapshotsSaved,
        eventsCount: events.length,
        newEventsCount,
        skippedEventsDueToGap,
        customContentCount: Array.isArray(customContent) ? customContent.length : 0,
        seq: payloadSeq,
      }, 'debug');
    },
    [applyOfficialEventLocally, db, finalizeClosedPlayerSession, getLocalLastEventSeq, refreshPlayers, refreshSavedSessions, traceLan]
  );

  const acknowledgeClosedSessionDelivery = useCallback(
    async (session: LanSessionRecord, deviceId: string, requestId: string, mode: 'explicit' | 'poll') => {
      if (!deviceId || session.status !== 'closed') return;

      const pending = closingSessionPendingDevicesRef.current[session.id];
      if (!pending?.has(deviceId)) return;

      pending.delete(deviceId);
      setPeerCount(pending.size);
      setLastNotice(
        pending.size > 0
          ? `Sessao encerrada. Aguardando ${pending.size} jogador(es) desvincular(em).`
          : 'Todos os jogadores receberam o encerramento. Fechando host LAN.'
      );
      await traceLan('LAN_RPC', 'handleRpcRequest', mode === 'explicit' ? 'closed_ack_explicit' : 'closed_ack_poll', 'Jogador confirmou encerramento da sessao.', {
        sessionId: session.id,
        deviceId,
        pendingDevices: pending.size,
        mode,
      }, 'info', requestId);
      if (pending.size === 0) {
        setTimeout(() => {
          void finishClosedSessionHost(session.id, `all-players-acked-${mode}`).catch(() => undefined);
        }, 350);
      }
    },
    [finishClosedSessionHost, traceLan]
  );

  const handleRpcRequest = useCallback(
    async (request: LanRpcRequest): Promise<LanRpcResponse> => {
      const startedAt = Date.now();
      const session = activeSessionRef.current || closingSessionRef.current;
      await traceLan('LAN_RPC', 'handleRpcRequest', 'received', `RPC LAN recebido: ${request.method}.`, {
        method: request.method,
        requestId: request.id,
        sessionId: request.sessionId || null,
        deviceId: request.deviceId || null,
        payloadBytes: estimateJsonBytes(request.payload || {}),
        command: (request.payload?.commandMessage as LanCommandMessage | undefined)?.command || null,
        commandId: (request.payload?.commandMessage as LanCommandMessage | undefined)?.commandId || null,
        sinceSeq: Number(request.payload?.sinceSeq || 0),
      }, 'debug', request.id);

      if (!session || session.role !== 'master') {
        return makeRpcResponse(request, false, undefined, 'Mestre LAN nao esta ativo.');
      }

      if (session.status === 'closed' && request.method !== 'POLL' && request.method !== 'DISCOVER' && request.method !== 'SESSION_CLOSED_ACK') {
        return makeRpcResponse(request, false, undefined, 'Mesa LAN encerrada.');
      }

      if (request.sessionId && request.sessionId !== session.id) {
        return makeRpcResponse(request, false, undefined, 'Codigo de sessao nao pertence a este mestre.');
      }

      try {
        if (request.method === 'DISCOVER') {
          return makeRpcResponse(request, true, {
            sessionId: session.id,
            code: session.session_code || session.id,
            name: session.name,
            port: Number(session.port || LAN_DEFAULT_PORT),
            config: makeSessionConfig(session),
          });
        }

        if (request.method === 'JOIN') {
          const payload = request.payload || {};
          const deviceId = String(request.deviceId || payload.deviceId || '');
          if (!deviceId) return makeRpcResponse(request, false, undefined, 'Jogador sem deviceId.');
          const offlineTimerKey = `${session.id}:${deviceId}`;
          if (delayedOfflineTimersRef.current[offlineTimerKey]) {
            clearTimeout(delayedOfflineTimersRef.current[offlineTimerKey]);
            delete delayedOfflineTimersRef.current[offlineTimerKey];
          }

          const playerName = String(payload.playerName || 'Jogador');
          const characterId = payload.characterId ? Number(payload.characterId) : null;
          const characterName = payload.characterName ? String(payload.characterName) : null;
          const existingPlayer = await db.getFirstAsync<{
            character_id?: number | null;
            player_name?: string | null;
          }>(
            `SELECT character_id, player_name FROM lan_session_players WHERE session_id = ? AND device_id = ? LIMIT 1`,
            [session.id, deviceId]
          );
          const previousCharacterId = existingPlayer?.character_id ? Number(existingPlayer.character_id) : null;

          await upsertLanPlayer(db, session.id, deviceId, playerName, characterId, characterName, true);

          const snapshot = payload.snapshot as LanCharacterMessage['snapshot'] | undefined;
          if (snapshot?.localId) {
            await saveCharacterSnapshot(db, session.id, deviceId, snapshot);
          }

          const joinedEventKey = `${session.id}:${deviceId}:${characterId || 'no-character'}`;
          const joinedEventExists = characterId
            ? await db.getFirstAsync<{ id: number }>(
                `SELECT id FROM lan_event_log
                 WHERE session_id = ?
                   AND event_type = 'PLAYER_JOINED'
                   AND actor_device_id = ?
                   AND target_character_id = ?
                 LIMIT 1`,
                [session.id, deviceId, characterId]
              )
            : await db.getFirstAsync<{ id: number }>(
                `SELECT id FROM lan_event_log
                 WHERE session_id = ?
                   AND event_type = 'PLAYER_JOINED'
                   AND actor_device_id = ?
                   AND target_character_id IS NULL
                 LIMIT 1`,
                [session.id, deviceId]
              );
          if ((!existingPlayer || previousCharacterId !== characterId) && !joinedEventExists && !joinedCharacterEventsRef.current[joinedEventKey]) {
            joinedCharacterEventsRef.current[joinedEventKey] = true;
            await emitOfficialEvent({
              sessionId: session.id,
              eventType: 'PLAYER_JOINED',
              actorDeviceId: deviceId,
              actorName: playerName,
              targetDeviceId: deviceId,
              targetCharacterId: characterId,
              targetName: characterName,
              description: characterId
                ? `${playerName} vinculou a ficha ${characterName || 'Personagem'}.`
                : `${playerName} entrou na sessao.`,
            });
          }

          await refreshPlayers();
          return makeRpcResponse(request, true, await buildRpcSyncPayload(session, Number(payload.sinceSeq || 0)));
        }

        if (request.method === 'POLL') {
          const payload = request.payload || {};
          const deviceId = String(request.deviceId || payload.deviceId || '');
          if (deviceId) {
            const offlineTimerKey = `${session.id}:${deviceId}`;
            if (delayedOfflineTimersRef.current[offlineTimerKey]) {
              clearTimeout(delayedOfflineTimersRef.current[offlineTimerKey]);
              delete delayedOfflineTimersRef.current[offlineTimerKey];
            }
            const playerName = String(payload.playerName || 'Jogador');
            await upsertLanPlayer(db, session.id, deviceId, playerName, payload.characterId ? Number(payload.characterId) : null, payload.characterName ? String(payload.characterName) : null, true);
          }
          const responsePayload = await buildRpcSyncPayload(session, Number(payload.sinceSeq || 0));
          if (session.status === 'closed' && deviceId) {
            await acknowledgeClosedSessionDelivery(session, deviceId, request.id, 'poll');
          }
          return makeRpcResponse(request, true, responsePayload);
        }

        if (request.method === 'SESSION_CLOSED_ACK') {
          const payload = request.payload || {};
          const deviceId = String(request.deviceId || payload.deviceId || '');
          if (!deviceId) return makeRpcResponse(request, false, undefined, 'ACK de encerramento sem deviceId.');
          await acknowledgeClosedSessionDelivery(session, deviceId, request.id, 'explicit');
          return makeRpcResponse(request, true, {
            sessionId: session.id,
            status: 'closed',
            acknowledged: true,
          });
        }

        if (request.method === 'COMMAND') {
          const command = request.payload?.commandMessage as LanCommandMessage | undefined;
          if (!command) return makeRpcResponse(request, false, undefined, 'Comando LAN vazio.');
          await runAuthoritativeCommandQueued(command, `rpc_${request.deviceId || 'player'}`);
          return makeRpcResponse(request, true, await buildRpcSyncPayload(session, Number(request.payload?.sinceSeq || 0)));
        }

        if (request.method === 'CHARACTER_UPSERT') {
          const message = request.payload?.message as LanCharacterMessage | undefined;
          if (!message?.snapshot) return makeRpcResponse(request, false, undefined, 'Snapshot de ficha vazio.');
          await handleCharacterUpsert(message);
          return makeRpcResponse(request, true, await buildRpcSyncPayload(session, Number(request.payload?.sinceSeq || 0)));
        }

        if (request.method === 'LEAVE') {
          const deviceId = String(request.deviceId || request.payload?.deviceId || '');
          if (deviceId) {
            await db.runAsync(
              `DELETE FROM lan_session_players WHERE session_id = ? AND device_id = ?`,
              [session.id, deviceId]
            );
            await db.runAsync(
              `DELETE FROM lan_character_snapshots WHERE session_id = ? AND owner_device_id = ?`,
              [session.id, deviceId]
            );
            await refreshPlayers();
          }
          return makeRpcResponse(request, true, await buildRpcSyncPayload(session, Number(request.payload?.sinceSeq || 0)));
        }

        return makeRpcResponse(request, false, undefined, 'Metodo LAN nao suportado.');
      } finally {
        await traceLan('LAN_RPC', 'handleRpcRequest', 'finished', `RPC LAN finalizado: ${request.method}.`, {
          durationMs: Date.now() - startedAt,
          method: request.method,
          requestId: request.id,
          payloadBytes: estimateJsonBytes(request.payload || {}),
          command: (request.payload?.commandMessage as LanCommandMessage | undefined)?.command || null,
          commandId: (request.payload?.commandMessage as LanCommandMessage | undefined)?.commandId || null,
        }, 'debug', request.id);
      }
    },
    [acknowledgeClosedSessionDelivery, buildRpcSyncPayload, db, emitOfficialEvent, handleCharacterUpsert, makeRpcResponse, refreshPlayers, runAuthoritativeCommandQueued, traceLan]
  );

  const makeLanTcpServer = useCallback(
    (sessionId: string, errorMetadata: Record<string, unknown> = {}) => new LanTcpServer(handleRpcRequest, {
      heartbeatMs: 15000,
      onStatus: status => setLastNotice(status),
      onError: message => {
        setLastError(message);
        void traceLan('LAN_TCP', 'LanTcpServer', 'error', message, { sessionId, ...errorMetadata }, 'error');
      },
      onClientHello: async (message: LanTcpStreamMessage) => {
        const response = await handleRpcRequest({
          type: 'LAN_RPC',
          id: message.id || makeRpcId(),
          method: 'POLL',
          sessionId: message.sessionId || sessionId,
          deviceId: message.deviceId || null,
          payload: message.payload || {},
          at: message.at || new Date().toISOString(),
        });
        if (!response.ok) {
          return { error: response.error || 'Falha ao entrar na sessao LAN.' };
        }
        const deviceId = String(message.deviceId || message.payload?.deviceId || '');
        const offlineTimerKey = `${sessionId}:${deviceId}`;
        if (delayedOfflineTimersRef.current[offlineTimerKey]) {
          clearTimeout(delayedOfflineTimersRef.current[offlineTimerKey]);
          delete delayedOfflineTimersRef.current[offlineTimerKey];
        }
        setPeerCount(rpcServerRef.current?.connectedDeviceIds().length || 0);
        return response.payload;
      },
      onClosedAck: async (message: LanTcpStreamMessage) => {
        const session = closingSessionRef.current || activeSessionRef.current;
        const deviceId = String(message.deviceId || message.payload?.deviceId || '');
        if (session && deviceId) {
          await acknowledgeClosedSessionDelivery(session, deviceId, message.id, 'explicit');
        }
      },
      onClientDisconnected: async (deviceId, disconnectedSessionId) => {
        const offlineTimerKey = `${disconnectedSessionId}:${deviceId}`;
        if (delayedOfflineTimersRef.current[offlineTimerKey]) {
          clearTimeout(delayedOfflineTimersRef.current[offlineTimerKey]);
        }
        setPeerCount(rpcServerRef.current?.connectedDeviceIds().length || 0);
        await traceLan('LAN_TCP', 'LanTcpServer', 'client_disconnect_pending', 'Socket do jogador caiu; aguardando reconexao antes de marcar offline.', {
          sessionId: disconnectedSessionId,
          deviceId,
          graceMs: LAN_MASTER_OFFLINE_GRACE_MS,
        }, 'warn');
        delayedOfflineTimersRef.current[offlineTimerKey] = setTimeout(() => {
          delete delayedOfflineTimersRef.current[offlineTimerKey];
          const stillDisconnected = !rpcServerRef.current?.connectedDeviceIds().includes(deviceId);
          if (!stillDisconnected) return;
          void (async () => {
            await db.runAsync(
              `UPDATE lan_session_players SET connected = 0, last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ? AND device_id = ?`,
              [disconnectedSessionId, deviceId]
            );
            setPeerCount(rpcServerRef.current?.connectedDeviceIds().length || 0);
            await refreshPlayers();
            await traceLan('LAN_TCP', 'LanTcpServer', 'client_disconnected', 'Jogador marcado offline apos janela de reconexao.', {
              sessionId: disconnectedSessionId,
              deviceId,
              graceMs: LAN_MASTER_OFFLINE_GRACE_MS,
            }, 'warn');
          })().catch(() => undefined);
        }, LAN_MASTER_OFFLINE_GRACE_MS);
      },
    }),
    [acknowledgeClosedSessionDelivery, db, handleRpcRequest, refreshPlayers, traceLan]
  );

  const ensureTcpClient = useCallback(
    async (session: LanSessionRecord, reason = 'active-session') => {
      if (session.role !== 'player' || session.status === 'closed' || session.status === 'inactive' || !session.host_ip || !session.port) return;

      const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
      deviceIdRef.current = deviceId;
      setLocalDeviceId(deviceId);

      const characterId = session.linked_character_id || null;
      const clientKey = `${session.id}:${session.host_ip}:${Number(session.port || LAN_DEFAULT_PORT)}:${deviceId}:${characterId || 'no-character'}`;
      if (tcpClientRef.current && tcpClientKeyRef.current === clientKey) return;

      const characterRow = characterId
        ? await db.getFirstAsync<{ name?: string | null }>(`SELECT name FROM characters WHERE id = ? LIMIT 1`, [characterId])
        : null;
      const sinceSeq = await getLocalLastEventSeq(session.id);
      const payload = {
        deviceId,
        sinceSeq,
        playerName: await getLocalPlayerName(db),
        characterId,
        characterName: characterRow?.name || null,
      };

      tcpClientRef.current?.close();
      tcpClientConnectedRef.current = false;
      tcpClientKeyRef.current = clientKey;
      const client = new LanTcpClient({
        host: session.host_ip,
        port: Number(session.port || LAN_DEFAULT_PORT),
        sessionId: session.id,
        deviceId,
        payload,
        reconnectMs: 4000,
        serverSilenceMs: 50000,
        onStatus: status => {
          tcpClientConnectedRef.current = status === 'connected';
          setTransportReadyState(status === 'connected');
          setLanConnectionStatus(status === 'connected' ? 'connected' : status);
        },
        onMessage: async message => {
          if (message.method === 'SYNC') {
            await applyRpcSyncPayload(message.payload);
            setTransportReadyState(true);
            setLanConnectionStatus('connected');
          }
          if (message.method === 'SESSION_CLOSED') {
            const current = activeSessionRef.current;
            if (current?.role === 'player' && (!message.sessionId || message.sessionId === current.id)) {
              await finalizeClosedPlayerSession(current, 'tcp-direct-close');
              return;
            }
          }
          if (message.method === 'NOTICE' && message.payload?.error) {
            setLastError(String(message.payload.error));
          }
        },
        onError: message => {
          void traceLan('LAN_TCP', 'LanTcpClient', 'error', message, {
            sessionId: session.id,
            reason,
          }, 'warn');
        },
      });
      tcpClientRef.current = client;
      client.start();
      await traceLan('LAN_TCP', 'ensureTcpClient', 'started', 'Cliente TCP persistente iniciado para jogador.', {
        sessionId: session.id,
        hostIp: session.host_ip,
        port: session.port,
        characterId,
        reason,
      }, 'info');
    },
    [applyRpcSyncPayload, db, finalizeClosedPlayerSession, getLocalLastEventSeq, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const recoverLanSession = useCallback(
    async (reason = 'app-active') => {
      if (reconnectingRef.current) return;
      const generationAtStart = sessionGenerationRef.current;
      const isStaleRecovery = () => generationAtStart !== sessionGenerationRef.current;
      reconnectingRef.current = true;
      setLanConnectionStatus('reconnecting');

      try {
        let session = activeSessionRef.current;
        if (!session || session.status === 'closed') {
          session = await getActiveLanSession(db);
          if (isStaleRecovery()) return;
          if (session) {
            setActiveSession(session);
            activeSessionRef.current = session;
          }
        }

        if (!session || session.status === 'closed') {
          setLanConnectionStatus('disconnected');
          return;
        }
        if (session.status === 'paused' && session.role === 'master' && !reason.startsWith('manual-resume:')) {
          setTransportReadyState(false);
          setLanConnectionStatus('disconnected');
          await refreshSavedSessions();
          await traceLan('FUNCTION', 'recoverLanSession', 'paused_master_skipped', 'Sessao pausada do mestre nao retoma conexao automaticamente.', {
            sessionId: session.id,
            role: session.role,
            reason,
          }, 'info');
          return;
        }

        const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
        if (isStaleRecovery()) return;
        deviceIdRef.current = deviceId;
        setLocalDeviceId(deviceId);
        await traceLan('FUNCTION', 'recoverLanSession', 'start', 'Retomando RPC LAN apos background/bloqueio.', {
          used: ['AppState', 'LanRpcServer', 'POLL', 'LanForegroundService'],
          reason,
          role: session.role,
          sessionId: session.id,
        }, 'info');

        if (session.role === 'master') {
          if (session.status === 'inactive') {
            const hostCandidates = await getLanAddressCandidates();
            let hostIp = session.host_ip || hostCandidates[0] || '0.0.0.0';
            try {
              hostIp = hostCandidates[0] || await Network.getIpAddressAsync();
            } catch {
              hostIp = hostCandidates[0] || hostIp;
            }
            const port = Number(session.port || LAN_DEFAULT_PORT);
            session = {
              ...session,
              status: 'open',
              host_ip: hostIp,
              port,
              session_code: buildSessionShareCode(session.id, hostIp, port, hostCandidates),
              last_connected_at: new Date().toISOString(),
            };
            await saveLanSession(db, session);
            await setLanSessionStatus(db, session.id, 'open');
            setActiveSession(session);
            activeSessionRef.current = session;
            await refreshSavedSessions();
          }

          await LanForegroundService.start({
            sessionId: session.id,
            sessionName: session.name,
            hostIp: session.host_ip || null,
            port: Number(session.port || LAN_DEFAULT_PORT),
            playerCount: players.length,
            role: session.role,
            status: session.status,
          }).catch(error => {
            void traceLan('FUNCTION', 'LanForegroundService.start', 'native_unavailable', 'Foreground Service nativo indisponivel ou falhou.', {
              error: error instanceof Error ? error.message : String(error),
            }, 'warn');
          });

          if (!rpcServerRef.current) {
            const sessionId = session.id;
            const rpcServer = makeLanTcpServer(sessionId);
            await rpcServer.start(Number(session.port || LAN_DEFAULT_PORT));
            rpcServerRef.current = rpcServer;
          }
          setTransportReadyState(true);
          setLanConnectionStatus('connected');
          await refreshPlayers();
          setLastNotice('Sessao LAN ativa como mestre.');
        } else {
          const playerSession = session as LanSessionRecord;
          let nextSession = playerSession;
          if (!nextSession.host_ip || !nextSession.port) {
            const parsedCode = parseSessionCode(nextSession.session_code || nextSession.id);
            if (!parsedCode) throw new Error('Sessao do jogador sem codigo para redescobrir mestre.');
            const discovery = await discoverLanMaster(parsedCode);
            if (isStaleRecovery()) return;
            nextSession = { ...nextSession, host_ip: discovery.host, port: discovery.port };
            await saveLanSession(db, nextSession);
            setActiveSession(nextSession);
            activeSessionRef.current = nextSession;
            session = nextSession;
          }
          const pollMaster = async (host: string, port: number, timeoutMs = 1800) => {
            const sinceSeq = await getLocalLastEventSeq(nextSession.id);
            return sendLanRpc(host, port, {
              type: 'LAN_RPC',
              id: makeRpcId(),
              method: 'POLL',
              sessionId: nextSession.id,
              deviceId,
              payload: {
                sinceSeq,
                playerName: await getLocalPlayerName(db),
                characterId: nextSession.linked_character_id || null,
              },
              at: new Date().toISOString(),
            }, timeoutMs);
          };

          let response: LanRpcResponse;
          try {
            response = await pollMaster(nextSession.host_ip || '', Number(nextSession.port || LAN_DEFAULT_PORT));
          } catch (error) {
            const parsedCode = parseSessionCode(nextSession.session_code || nextSession.id);
            if (!parsedCode) throw error;
            const now = Date.now();
            const lastDiscoveryAttemptAt = lastDiscoveryAttemptAtRef.current[nextSession.id] || 0;
            const canRediscoverNow = reason.startsWith('manual-') || now - lastDiscoveryAttemptAt >= LAN_DISCOVERY_RETRY_COOLDOWN_MS;
            if (!canRediscoverNow) {
              const retryInMs = Math.max(1000, LAN_DISCOVERY_RETRY_COOLDOWN_MS - (now - lastDiscoveryAttemptAt));
              throw new Error(`Mestre LAN temporariamente sem resposta. Nova redescoberta em ${Math.ceil(retryInMs / 1000)}s.`);
            }
            lastDiscoveryAttemptAtRef.current[nextSession.id] = now;
            await traceLan('LAN_DISCOVERY', 'recoverLanSession', 'rediscover_after_poll_failed', 'Polling falhou; redescobrindo mestre LAN.', {
              sessionId: nextSession.id,
              previousHostIp: nextSession.host_ip || null,
              previousPort: nextSession.port || null,
              error: error instanceof Error ? error.message : String(error),
            }, 'warn');
            const discovery = await discoverLanMaster(parsedCode, async (step, metadata) => {
              await traceLan('LAN_DISCOVERY', 'recoverLanSession', step, `Redescoberta LAN: ${step}.`, {
                sessionId: nextSession.id,
                ...metadata,
              }, step === 'discovered' ? 'info' : step === 'priority_failed' ? 'warn' : 'debug');
            });
            if (isStaleRecovery()) return;
            nextSession = { ...nextSession, host_ip: discovery.host, port: discovery.port };
            await saveLanSession(db, nextSession);
            setActiveSession(nextSession);
            activeSessionRef.current = nextSession;
            session = nextSession;
            response = await pollMaster(discovery.host, discovery.port, 2400);
          }
          if (isStaleRecovery()) return;
          if (!response.ok) throw new Error(response.error || 'Falha ao retomar polling LAN.');
          await applyRpcSyncPayload(response.payload);
          if (nextSession.status === 'inactive') {
            nextSession = { ...nextSession, status: 'connected' };
            await setLanSessionStatus(db, nextSession.id, 'connected');
            await saveLanSession(db, nextSession);
            setActiveSession(nextSession);
            activeSessionRef.current = nextSession;
            await refreshSavedSessions();
          }
          setTransportReadyState(true);
          setLanConnectionStatus('connected');
          await ensureTcpClient(nextSession, 'recover-success');
          setLastNotice('Sincronizando com o mestre.');
        }

        setLanRevision(prev => prev + 1);
        delete reconnectFailureCountRef.current[(session as LanSessionRecord).id];
        delete playerPollFailureCountRef.current[(session as LanSessionRecord).id];
        await traceLan('FUNCTION', 'recoverLanSession', 'success', 'Retomada LAN concluida.', {
          sessionId: (session as LanSessionRecord).id,
          role: (session as LanSessionRecord).role,
          reason,
        }, 'info');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const currentSession = activeSessionRef.current;
        const masterClosedExplicitly = /(mesa|sessao|sessão).*(encerrada|encerrado|closed)|session[_ -]?closed/i.test(message);
        const masterNotFound = /nao encontrada|não encontrada|not found/i.test(message);
        if (currentSession?.role === 'player' && masterNotFound) {
          reconnectFailureCountRef.current[currentSession.id] = (reconnectFailureCountRef.current[currentSession.id] || 0) + 1;
        }
        if (currentSession?.role === 'player' && masterClosedExplicitly) {
          await finalizeClosedPlayerSession(
            currentSession,
            'master-closed-error',
            true
          );
          await traceLan('FUNCTION', 'recoverLanSession', 'closed_after_master_closed', 'Sessao local do jogador foi finalizada por encerramento explicito do mestre.', {
            sessionId: currentSession.id,
            error: message,
            reason,
            masterClosedExplicitly,
            masterNotFound,
          }, 'info');
          return;
        }
        if (currentSession?.role === 'player') {
          const failureCount = reconnectFailureCountRef.current[currentSession.id] || 1;
          const retryDelayMs = Math.min(LAN_RECOVERY_RETRY_MAX_MS, LAN_RECOVERY_RETRY_BASE_MS * failureCount);
          setTransportReadyState(false);
          setLanConnectionStatus('reconnecting');
          setLastError(`Conexao LAN instavel. Tentando reconectar sem liberar sua ficha. (${message})`);
          scheduleLanReconnect('recover-retry-preserved-session', retryDelayMs);
          await traceLan('FUNCTION', 'recoverLanSession', masterNotFound ? 'missing_master_preserved' : 'transient_error_preserved', 'Falha ao retomar LAN preservou sessao/ficha para nova tentativa.', {
            sessionId: currentSession.id,
            error: message,
            reason,
            masterNotFound,
            failureCount,
            retryDelayMs,
          }, masterNotFound ? 'warn' : 'error');
          return;
        }
        setTransportReadyState(false);
        setLanConnectionStatus('disconnected');
        setLastError(`Falha ao retomar sessao LAN: ${message}`);
        await traceLan('FUNCTION', 'recoverLanSession', 'error', 'Falha ao retomar sessao LAN.', {
          error: message,
          reason,
        }, 'error');
      } finally {
        reconnectingRef.current = false;
      }
    },
    [applyRpcSyncPayload, db, ensureTcpClient, finalizeClosedPlayerSession, getLocalLastEventSeq, handleRpcRequest, makeLanTcpServer, players.length, refreshPlayers, refreshSavedSessions, scheduleLanReconnect, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  useEffect(() => {
    recoverLanSessionRef.current = recoverLanSession;
  }, [recoverLanSession]);

  const forceRecoverLanSession = useCallback(
    async (reason = 'manual-force-sync') => {
      const session = activeSessionRef.current;
      if (!session || session.status === 'closed' || session.status === 'inactive') {
        setTransportReadyState(false);
        setLanConnectionStatus('disconnected');
        return;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (session.role === 'player') {
        tcpClientRef.current?.close();
        tcpClientRef.current = null;
        tcpClientKeyRef.current = '';
        tcpClientConnectedRef.current = false;
      }

      setLastError(null);
      setTransportReadyState(false);
      setLanConnectionStatus('syncing');
      await traceLan('FUNCTION', 'forceRecoverLanSession', 'start', 'Ressincronizacao LAN manual solicitada pela ficha.', {
        sessionId: session.id,
        role: session.role,
        reason,
      }, 'info');

      await recoverLanSession(reason);
      await refreshPlayers();
      await refreshSavedSessions();
    },
    [recoverLanSession, refreshPlayers, refreshSavedSessions, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const resumeLanSession = useCallback(
    async (sessionId: string) => {
      const stored = await getLanSessionById(db, sessionId);
      if (!stored || stored.status === 'closed') {
        throw new Error('Mesa LAN nao encontrada ou ja encerrada.');
      }

      if (activeSessionRef.current?.id !== stored.id) {
        await deactivateCurrentSessionLocally('resume-other-session');
      }

      setLastError(null);
      setActiveSession(stored);
      activeSessionRef.current = stored;
      await refreshPlayers();
      await recoverLanSession(`manual-resume:${stored.id}`);
      if (stored.linked_character_id && activeSessionRef.current?.id === stored.id) {
        await broadcastCharacterRef.current?.(stored.linked_character_id, 'session-resumed');
      }
      await refreshSavedSessions();
    },
    [db, deactivateCurrentSessionLocally, recoverLanSession, refreshPlayers, refreshSavedSessions]
  );

  const startMasterSession = useCallback(
    async (options: StartMasterOptions) => {
      const startedAt = Date.now();
      await traceLan('FUNCTION', 'startMasterSession', 'start', 'Iniciando sessao LAN como mestre.', {
        used: ['getOrCreateDeviceId', 'deactivateCurrentSessionLocally', 'Network.getIpAddressAsync', 'getLanAddressCandidates', 'LanRpcServer.start', 'saveLanSession'],
        options: {
          sessionName: options.sessionName,
          syncCustomContent: options.syncCustomContent,
          selectedContentCount: options.selectedContent.length,
          allowExistingCharacter: options.allowExistingCharacter,
          linkedCharacterId: options.linkedCharacterId || null,
        },
      }, 'info');
      setLastError(null);
      const deviceId = await getOrCreateDeviceId(db);
      deviceIdRef.current = deviceId;
      setLocalDeviceId(deviceId);
      const closingSessionId = closingSessionRef.current?.id;
      if (closingSessionId) {
        await finishClosedSessionHost(closingSessionId, 'replaced-by-new-session');
      }
      await deactivateCurrentSessionLocally('start-master-session');

      const sessionId = makeShortSessionCode();
      const hostCandidates = await getLanAddressCandidates();
      let hostIp = '0.0.0.0';
      try {
        hostIp = hostCandidates[0] || await Network.getIpAddressAsync();
      } catch {
        hostIp = hostCandidates[0] || '0.0.0.0';
      }

      const sessionCode = buildSessionShareCode(sessionId, hostIp, LAN_DEFAULT_PORT, hostCandidates);
      const session: LanSessionRecord = {
        id: sessionId,
        name: options.sessionName.trim() || `Sessao ${sessionId}`,
        role: 'master',
        status: 'open',
        session_code: sessionCode,
        host_ip: hostIp,
        port: LAN_DEFAULT_PORT,
        sync_custom_content: options.syncCustomContent ? 1 : 0,
        selected_content: JSON.stringify(options.selectedContent),
        allow_existing_character: options.allowExistingCharacter ? 1 : 0,
        linked_character_id: options.linkedCharacterId || null,
        opened_at: new Date().toISOString(),
      };

      customContentCacheRef.current = options.syncCustomContent
        ? await getSelectedCustomContentPayloads(db, options.selectedContent)
        : [];

      await rpcServerRef.current?.close();
      rpcServerRef.current = null;
      await delay(220);

      let verifiedServer: LanTcpServer | null = null;
      let serverStartError: unknown = null;
      setActiveSession(session);
      activeSessionRef.current = session;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const rpcServer = makeLanTcpServer(sessionId, { attempt, mode: 'new-session' });
        try {
          await rpcServer.start(LAN_DEFAULT_PORT);
          rpcServerRef.current = rpcServer;
          const probe = await sendLanRpc('127.0.0.1', LAN_DEFAULT_PORT, {
            type: 'LAN_RPC',
            id: makeRpcId(),
            method: 'DISCOVER',
            sessionId,
            deviceId,
            payload: { probe: true },
            at: new Date().toISOString(),
          }, 1400);
          if (!probe.ok) throw new Error(probe.error || 'Servidor local recusou verificacao.');
          verifiedServer = rpcServer;
          await traceLan('LAN_TCP', 'startMasterSession', 'server_verified', 'Servidor da nova sessao abriu e respondeu ao teste local.', {
            sessionId,
            port: LAN_DEFAULT_PORT,
            attempt,
          }, 'info');
          break;
        } catch (error) {
          serverStartError = error;
          await rpcServer.close();
          if (rpcServerRef.current === rpcServer) rpcServerRef.current = null;
          await traceLan('LAN_TCP', 'startMasterSession', 'server_attempt_failed', 'Falha ao abrir ou verificar servidor da nova sessao.', {
            sessionId,
            port: LAN_DEFAULT_PORT,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          }, attempt >= 3 ? 'error' : 'warn');
          if (attempt < 3) await delay(300 * attempt);
        }
      }

      if (!verifiedServer) {
        setActiveSession(null);
        activeSessionRef.current = null;
        throw serverStartError instanceof Error
          ? serverStartError
          : new Error('Nao foi possivel abrir o servidor LAN da nova sessao.');
      }
      await LanForegroundService.start({
        sessionId,
        sessionName: session.name,
        hostIp,
        port: LAN_DEFAULT_PORT,
        playerCount: 0,
        role: session.role,
        status: session.status,
      }).catch(error => {
        void traceLan('FUNCTION', 'LanForegroundService.start', 'native_unavailable', 'Foreground Service nativo indisponivel ou falhou.', {
          error: error instanceof Error ? error.message : String(error),
        }, 'warn');
      });
      await saveLanSession(db, session);
      await refreshSavedSessions();
      setActiveSession(session);
      activeSessionRef.current = session;
      setTransportReadyState(true);
      setLanConnectionStatus('connected');
      setPeerCount(0);
      setPlayers([]);
      setLastNotice('Sessao LAN aberta como mestre.');

      await traceLan('FUNCTION', 'startMasterSession', 'success', 'Sessao LAN aberta como mestre.', {
        durationMs: Date.now() - startedAt,
        sessionId,
        hostIp,
        hostCandidates,
        port: LAN_DEFAULT_PORT,
        sessionCode,
      }, 'info');

      if (session.linked_character_id) {
        await Promise.resolve().then(() => broadcastCharacterRef.current?.(session.linked_character_id as number, 'master-start'));
      }

      return session;
    },
    [db, deactivateCurrentSessionLocally, finishClosedSessionHost, handleRpcRequest, makeLanTcpServer, refreshSavedSessions, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const joinPlayerSession = useCallback(
    async (options: JoinSessionOptions) => {
      const startedAt = Date.now();
      await traceLan('FUNCTION', 'joinPlayerSession', 'start', 'Jogador tentando entrar em sessao LAN.', {
        used: ['parseSessionCode', 'discoverLanMaster', 'sendLanRpc', 'saveLanSession'],
        hasCode: Boolean(options.code?.trim()),
        playerName: options.playerName,
        linkedCharacterId: options.linkedCharacterId || null,
      }, 'info');
      setLastError(null);
      const parsedCode = parseSessionCode(options.code);
      if (!parsedCode) {
        throw new Error('Codigo de sessao invalido.');
      }

      let discovery: Awaited<ReturnType<typeof discoverLanMaster>> | null = null;

      try {
        const playerName = options.playerName.trim() || 'Jogador';
        await updateLocalPlayerName(db, playerName);
        const deviceId = await getOrCreateDeviceId(db);
        deviceIdRef.current = deviceId;
        setLocalDeviceId(deviceId);
        await deactivateCurrentSessionLocally('join-player-session');

        let characterName: string | null = null;
        let linkedSnapshot: Awaited<ReturnType<typeof getCharacterSnapshot>> = null;
        if (options.linkedCharacterId) {
          const linkedElsewhere = await getCharacterLinkedLanSession(db, options.linkedCharacterId, parsedCode.sessionId);
          if (linkedElsewhere) {
            throw new Error(`Esta ficha ja esta vinculada a sessao "${linkedElsewhere.name}".`);
          }
          linkedSnapshot = await getCharacterSnapshot(db, options.linkedCharacterId, { includeAvatarDataUri: true });
          characterName = linkedSnapshot?.name || null;
        }

        const discover = async (reason: string) => discoverLanMaster(parsedCode, async (step, metadata) => {
          await traceLan('LAN_DISCOVERY', 'discoverLanMaster', step, `Descoberta LAN: ${step}.`, {
            sessionId: parsedCode.sessionId,
            reason,
            ...metadata,
          }, step === 'discovered' ? 'info' : step === 'priority_failed' ? 'warn' : 'debug');
        });

        const makeJoinRequest = () => ({
          type: 'LAN_RPC' as const,
          id: makeRpcId(),
          method: 'JOIN' as const,
          sessionId: parsedCode.sessionId,
          deviceId,
          payload: {
            deviceId,
            playerName,
            characterId: options.linkedCharacterId || null,
            characterName,
            snapshot: linkedSnapshot || null,
            sinceSeq: 0,
          },
          at: new Date().toISOString(),
        });

        const sendJoinWithRetry = async (host: string, port: number, phase: string) => {
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            const request = makeJoinRequest();
            await traceLan('LAN_RPC', 'joinPlayerSession', 'join_attempt', 'Tentando enviar JOIN LAN ao mestre.', {
              sessionId: parsedCode.sessionId,
              hostIp: host,
              port,
              attempt,
              phase,
              requestId: request.id,
            }, 'debug', request.id);

            try {
              const response = await sendLanRpc(host, port, request, 3500);
              if (!response.ok) {
                await traceLan('LAN_RPC', 'joinPlayerSession', 'join_refused', 'Mestre recusou JOIN LAN.', {
                  sessionId: parsedCode.sessionId,
                  hostIp: host,
                  port,
                  attempt,
                  phase,
                  error: response.error || null,
                }, 'warn', request.id);
                throw new Error(response.error || 'Mestre recusou entrada LAN.');
              }
              return response;
            } catch (error) {
              lastError = error;
              await traceLan('LAN_RPC', 'joinPlayerSession', 'join_attempt_failed', 'Tentativa de JOIN LAN falhou.', {
                sessionId: parsedCode.sessionId,
                hostIp: host,
                port,
                attempt,
                phase,
                error: error instanceof Error ? error.message : String(error),
              }, attempt >= 3 ? 'error' : 'warn', request.id);

              if (attempt < 3) await delay(300 * attempt);
            }
          }

          throw lastError instanceof Error ? lastError : new Error(String(lastError || 'JOIN LAN falhou.'));
        };

        discovery = await discover('initial');
        let joinResponse: LanRpcResponse;

        try {
          joinResponse = await sendJoinWithRetry(discovery.host, discovery.port, 'initial');
        } catch (error) {
          await traceLan('LAN_RPC', 'joinPlayerSession', 'rediscover_after_join_failed', 'JOIN falhou; tentando redescobrir mestre LAN.', {
            sessionId: parsedCode.sessionId,
            previousHostIp: discovery.host,
            previousPort: discovery.port,
            error: error instanceof Error ? error.message : String(error),
          }, 'warn');
          discovery = await discover('after-join-failed');
          joinResponse = await sendJoinWithRetry(discovery.host, discovery.port, 'rediscovered');
        }

        const config = (joinResponse.payload?.session as any)?.config || (joinResponse.payload as any)?.config || {};
        const session: LanSessionRecord = {
          id: parsedCode.sessionId,
          name: String(config.sessionName || `Sessao ${parsedCode.sessionId}`),
          role: 'player',
          status: 'connected',
          session_code: options.code.trim() || parsedCode.sessionId,
          host_ip: discovery.host,
          port: discovery.port,
          sync_custom_content: config.syncCustomContent ? 1 : 0,
          selected_content: JSON.stringify(Array.isArray(config.selectedContent) ? config.selectedContent : []),
          allow_existing_character: config.allowExistingCharacter ? 1 : 0,
          linked_character_id: options.linkedCharacterId || null,
          opened_at: new Date().toISOString(),
          last_connected_at: new Date().toISOString(),
        };

        await saveLanSession(db, session);
        await refreshSavedSessions();
        setActiveSession(session);
        activeSessionRef.current = session;
        setTransportReadyState(true);
        setLanConnectionStatus('connected');
        setPeerCount(1);
        await applyRpcSyncPayload(joinResponse.payload);
        await ensureTcpClient(session, 'join-success');
        setLastNotice('Entrada LAN confirmada pelo mestre.');

        await traceLan('LAN_RPC', 'joinPlayerSession', 'success', 'Jogador entrou via RPC LAN.', {
          durationMs: Date.now() - startedAt,
          sessionId: parsedCode.sessionId,
          hostIp: discovery.host,
          port: discovery.port,
          candidates: discovery.candidates.length,
          characterId: options.linkedCharacterId || null,
        }, 'info');

        return session;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message);
        setTransportReadyState(false);
        setLanConnectionStatus('disconnected');
        await traceLan('LAN_RPC', 'joinPlayerSession', 'failed', 'Jogador nao conseguiu entrar na sessao LAN.', {
          durationMs: Date.now() - startedAt,
          sessionId: parsedCode.sessionId,
          hostIp: discovery?.host || null,
          port: discovery?.port || null,
          candidates: discovery?.candidates.length || 0,
          error: message,
        }, 'error');
        throw error;
      }
    },
    [applyRpcSyncPayload, db, deactivateCurrentSessionLocally, ensureTcpClient, refreshSavedSessions, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const closeActiveSession = useCallback(async () => {
    const session = activeSessionRef.current;
    await traceLan('FUNCTION', 'closeActiveSession', 'start', 'Fechando sessao LAN localmente.', {
      used: ['LEAVE', 'LanRpcServer.close', 'setLanSessionStatus'],
      sessionId: session?.id || null,
    }, 'info');

    if (session?.role === 'player' && session.host_ip && session.port) {
      try {
        const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
        await sendLanRpc(session.host_ip, Number(session.port || LAN_DEFAULT_PORT), {
          type: 'LAN_RPC',
          id: makeRpcId(),
          method: 'LEAVE',
          sessionId: session.id,
          deviceId,
          payload: { deviceId },
          at: new Date().toISOString(),
        }, 900);
      } catch (error) {
        await traceLan('LAN_RPC', 'closeActiveSession', 'leave_failed', 'Aviso de saida ao mestre falhou.', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        }, 'warn');
      }
    }

    if (session) {
      await deactivateCurrentSessionLocally('close-active-session');
      if (session.role === 'player') {
        await linkCharacterToSession(db, session.id, null);
        await refreshSavedSessions();
      }
    }
    setLastNotice(
      session?.role === 'player'
        ? 'Voce saiu da mesa. A ficha foi liberada para entrar em outra sessao.'
        : 'Sessao LAN ficou inativa. Voce pode retomar pela lista de mesas.'
    );
  }, [db, deactivateCurrentSessionLocally, refreshSavedSessions, traceLan]);

  const linkCharacterToActiveSession = useCallback(
    async (characterId: number | null) => {
      const session = activeSessionRef.current;
      if (!session) return;

      if (characterId) {
        const linkedElsewhere = await getCharacterLinkedLanSession(db, characterId, session.id);
        if (linkedElsewhere) {
          throw new Error(`Esta ficha ja esta vinculada a sessao "${linkedElsewhere.name}". Encerre essa sessao antes de reutiliza-la.`);
        }
      }

      await linkCharacterToSession(db, session.id, characterId);
      const nextSession = { ...session, linked_character_id: characterId };
      setActiveSession(nextSession);
      activeSessionRef.current = nextSession;

      if (session.role === 'player') {
        if (characterId) {
          await Promise.resolve()
            .then(() => broadcastCharacterRef.current?.(characterId, 'character-linked'))
            .catch(async error => {
              await traceLan('LAN_SEND', 'linkCharacterToActiveSession', 'broadcast_failed', 'Ficha vinculada localmente, mas sincronizacao LAN falhou.', {
                sessionId: session.id,
                characterId,
                error: error instanceof Error ? error.message : String(error),
              }, 'warn');
            });
        }
      }
      setLanRevision(prev => prev + 1);
    },
    [db]
  );

  const broadcastCharacter = useCallback(
    async (characterId: number, reason = 'change') => {
      const startedAt = Date.now();
      const session = activeSessionRef.current;
      if (!session) return;

      if (session.role === 'player' && session.linked_character_id && session.linked_character_id !== characterId) {
        return;
      }

      const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
      deviceIdRef.current = deviceId;
      setLocalDeviceId(deviceId);
      const snapshot = await getCharacterSnapshot(db, characterId, {
        includeAvatarDataUri: shouldIncludeAvatarInSnapshot(reason),
      });
      if (!snapshot) return;
      const snapshotBytes = estimateJsonBytes(snapshot);
      const includesAvatarDataUri = Boolean(snapshot.data?.avatar_data_uri);

      await saveCharacterSnapshot(db, session.id, deviceId, snapshot);

      const message: LanCharacterMessage = {
        type: 'CHARACTER_UPSERT',
        sessionId: session.id,
        deviceId,
        snapshot: {
          ...snapshot,
          updatedAt: new Date().toISOString(),
        },
      };

      let sent = false;
      let sentCount = 0;
      if (session.role === 'master') {
        sent = true;
        await refreshPlayers();
      } else {
        if (!session.host_ip || !session.port) {
          setLastError('Sessao LAN sem host do mestre.');
          return;
        }
        const sinceSeq = await getLocalLastEventSeq(session.id);
        let response = await sendLanRpc(session.host_ip, Number(session.port || LAN_DEFAULT_PORT), {
          type: 'LAN_RPC',
          id: makeRpcId(),
          method: 'CHARACTER_UPSERT',
          sessionId: session.id,
          deviceId,
          payload: { message, sinceSeq },
          at: new Date().toISOString(),
        }, 2200).catch(async error => {
          const parsedCode = parseSessionCode(session.session_code || session.id);
          if (!parsedCode) throw error;
          const discovery = await discoverLanMaster(parsedCode);
          const nextSession = { ...session, host_ip: discovery.host, port: discovery.port };
          await saveLanSession(db, nextSession);
          setActiveSession(nextSession);
          activeSessionRef.current = nextSession;
          return sendLanRpc(discovery.host, discovery.port, {
            type: 'LAN_RPC',
            id: makeRpcId(),
            method: 'CHARACTER_UPSERT',
            sessionId: session.id,
            deviceId,
            payload: { message, sinceSeq },
            at: new Date().toISOString(),
          }, 2200);
        });
        if (!response.ok) {
          throw new Error(response.error || 'Mestre recusou sincronizacao da ficha.');
        }
        await traceLan('LAN_SEND', 'broadcastCharacter', 'character_upsert_response', `Resposta de sincronizacao da ficha recebida (${reason}).`, {
          durationMs: Date.now() - startedAt,
          characterId,
          reason,
          snapshotBytes,
          includesAvatarDataUri,
          responsePayloadBytes: estimateJsonBytes(response.payload),
          responseSeq: Number(response.payload?.seq || 0),
        }, 'debug');
        await applyRpcSyncPayload(response.payload);
        sent = true;
      }

      if (!sent && session.role === 'player') {
        setLastError('Ficha nao enviada: conexao LAN indisponivel.');
        setTransportReadyState(false);
        setLanConnectionStatus('disconnected');
        scheduleLanReconnect('character-send-failed');
        await traceLan('LAN_SEND', 'broadcastCharacter', 'send_failed', `Falha ao sincronizar ficha (${reason}).`, {
          durationMs: Date.now() - startedAt,
          used: ['sendLanRpc'],
          characterId,
          reason,
          snapshotName: snapshot.name,
          snapshotBytes,
          includesAvatarDataUri,
        }, 'warn');
        return;
      }

      setLanRevision(prev => prev + 1);
      setLastNotice(`Ficha sincronizada (${reason}).`);
      await traceLan(session.role === 'master' ? 'LAN_SEND' : 'LAN_COMMAND', 'broadcastCharacter', 'character_upsert_sent', `Ficha sincronizada (${reason}).`, {
        durationMs: Date.now() - startedAt,
        used: ['getOrCreateDeviceId', 'getCharacterSnapshot', 'saveCharacterSnapshot', session.role === 'master' ? 'local-master' : 'sendLanRpc'],
        characterId,
        reason,
        snapshotName: snapshot.name,
        snapshotBytes,
        includesAvatarDataUri,
        sentCount: session.role === 'master' ? sentCount : 1,
      }, 'debug');
    },
    [applyRpcSyncPayload, db, getLocalLastEventSeq, refreshPlayers, scheduleLanReconnect, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const sendLanCommand = useCallback(
    async (command: LanCommandKind, payload: Record<string, unknown> = {}) => {
      const startedAt = Date.now();
      const session = activeSessionRef.current;
      if (!session) {
        setLastError('Nenhuma sessao LAN ativa.');
        await traceLan('LAN_COMMAND', 'sendLanCommand', 'blocked_no_session', `Comando ${command} bloqueado: nenhuma sessao ativa.`, {
          command,
          payload,
        }, 'warn');
        return;
      }

      const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
      deviceIdRef.current = deviceId;
      setLocalDeviceId(deviceId);

      let actorName = session.role === 'master' ? 'Mestre' : String(payload.characterName || payload.sourceName || '');
      if (!actorName && session.role === 'player' && session.linked_character_id) {
        const character = await db.getFirstAsync<{ name?: string }>(
          `SELECT name FROM characters WHERE id = ? LIMIT 1`,
          [session.linked_character_id]
        );
        actorName = String(character?.name || '');
      }
      if (!actorName) actorName = await getLocalPlayerName(db);
      const message: LanCommandMessage = {
        type: 'LAN_COMMAND',
        sessionId: session.id,
        commandId: makeCommandId(),
        deviceId,
        actorName,
        characterId: session.linked_character_id || null,
        command,
        payload,
        at: new Date().toISOString(),
      };

      if (session.role === 'master') {
        await traceLan('LAN_COMMAND', 'sendLanCommand', 'local_master_command', `Mestre executando comando local ${command}.`, {
          durationMs: Date.now() - startedAt,
          used: ['runAuthoritativeCommandQueued'],
          command,
          payload,
          commandId: message.commandId,
        }, 'debug', message.commandId);
        await runAuthoritativeCommandQueued(message);
        return;
      }

      if (!session.host_ip || !session.port) {
        setLastError('Sessao LAN sem host do mestre.');
        return;
      }

      try {
        const sinceSeq = await getLocalLastEventSeq(session.id);
        const rpcStartedAt = Date.now();
        await traceLan('LAN_RPC', 'sendLanCommand', 'rpc_send_start', `Enviando comando ${command} ao mestre.`, {
          command,
          commandId: message.commandId,
          sinceSeq,
          payloadBytes: estimateJsonBytes(payload),
        }, 'debug', message.commandId);
        const response = await sendLanRpc(session.host_ip, Number(session.port || LAN_DEFAULT_PORT), {
          type: 'LAN_RPC',
          id: makeRpcId(),
          method: 'COMMAND',
          sessionId: session.id,
          deviceId,
          payload: {
            commandMessage: message,
            sinceSeq,
          },
          at: new Date().toISOString(),
        }, 1800);

        if (!response.ok) {
          throw new Error(response.error || 'Mestre recusou o comando.');
        }

        await traceLan('LAN_RPC', 'sendLanCommand', 'rpc_response_received', `Resposta RPC recebida para ${command}.`, {
          durationMs: Date.now() - rpcStartedAt,
          command,
          commandId: message.commandId,
          responsePayloadBytes: estimateJsonBytes(response.payload),
          responseSeq: Number(response.payload?.seq || 0),
        }, 'debug', message.commandId);
        const applyStartedAt = Date.now();
        await applyRpcSyncPayload(response.payload);
        await traceLan('LAN_SYNC', 'sendLanCommand', 'response_sync_applied', `Sync da resposta aplicado para ${command}.`, {
          durationMs: Date.now() - applyStartedAt,
          totalDurationMs: Date.now() - startedAt,
          command,
          commandId: message.commandId,
        }, 'debug', message.commandId);
      } catch (error) {
        const parsedCode = parseSessionCode(session.session_code || session.id);
        try {
          if (!parsedCode) throw error;
          const rediscoverStartedAt = Date.now();
          const discovery = await discoverLanMaster(parsedCode);
          const rediscoverDurationMs = Date.now() - rediscoverStartedAt;
          const nextSession = { ...session, host_ip: discovery.host, port: discovery.port };
          await saveLanSession(db, nextSession);
          setActiveSession(nextSession);
          activeSessionRef.current = nextSession;
          const sinceSeq = await getLocalLastEventSeq(session.id);
          const retryRpcStartedAt = Date.now();
          await traceLan('LAN_RPC', 'sendLanCommand', 'retry_rpc_send_start', `Reenviando comando ${command} apos redescoberta.`, {
            command,
            commandId: message.commandId,
            sinceSeq,
            rediscoverDurationMs,
            host: discovery.host,
            port: discovery.port,
            payloadBytes: estimateJsonBytes(payload),
          }, 'debug', message.commandId);
          const response = await sendLanRpc(discovery.host, discovery.port, {
            type: 'LAN_RPC',
            id: makeRpcId(),
            method: 'COMMAND',
            sessionId: session.id,
            deviceId,
            payload: {
              commandMessage: message,
              sinceSeq,
            },
            at: new Date().toISOString(),
          }, 1800);
          if (!response.ok) {
            throw new Error(response.error || 'Mestre recusou o comando.');
          }
          await traceLan('LAN_RPC', 'sendLanCommand', 'retry_rpc_response_received', `Resposta RPC recebida no retry para ${command}.`, {
            durationMs: Date.now() - retryRpcStartedAt,
            command,
            commandId: message.commandId,
            rediscoverDurationMs,
            responsePayloadBytes: estimateJsonBytes(response.payload),
            responseSeq: Number(response.payload?.seq || 0),
          }, 'debug', message.commandId);
          const retryApplyStartedAt = Date.now();
          await applyRpcSyncPayload(response.payload);
          await traceLan('LAN_SYNC', 'sendLanCommand', 'retry_response_sync_applied', `Sync da resposta retry aplicado para ${command}.`, {
            durationMs: Date.now() - retryApplyStartedAt,
            totalDurationMs: Date.now() - startedAt,
            command,
            commandId: message.commandId,
            rediscoverDurationMs,
          }, 'debug', message.commandId);
        } catch (retryError) {
          setTransportReadyState(false);
          setLanConnectionStatus('reconnecting');
          scheduleLanReconnect('command-send-failed', 900);
          await traceLan('LAN_COMMAND', 'sendLanCommand', 'send_failed', `Falha ao enviar comando ${command}.`, {
            durationMs: Date.now() - startedAt,
            command,
            payload,
            commandId: message.commandId,
            error: retryError instanceof Error ? retryError.message : String(retryError),
          }, 'warn', message.commandId);
          throw retryError;
        }
      }

      setTransportReadyState(true);
      setLanConnectionStatus('connected');
      setLastNotice('Comando enviado ao mestre.');
      await traceLan('LAN_RPC', 'sendLanCommand', 'sent_to_master', `Comando ${command} enviado ao mestre via RPC.`, {
        durationMs: Date.now() - startedAt,
        used: ['sendLanRpc'],
        command,
        payload,
        commandId: message.commandId,
      }, 'info', message.commandId);
    },
    [applyRpcSyncPayload, db, getLocalLastEventSeq, runAuthoritativeCommandQueued, scheduleLanReconnect, setLanConnectionStatus, setTransportReadyState, traceLan]
  );

  const getHistoryPage = useCallback(
    async (page = 0, pageSize = 20) => {
      const session = activeSessionRef.current;
      if (!session) return [];
      return getLanHistoryPage(db, session.id, page, pageSize);
    },
    [db]
  );

  const pauseActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_PAUSE_SESSION');
  }, [sendLanCommand]);

  const resumeActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_RESUME_SESSION');
  }, [sendLanCommand]);

  const endActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_END_SESSION');
  }, [sendLanCommand]);

  const broadcastCharacterRef = useRef<typeof broadcastCharacter | null>(null);
  useEffect(() => {
    broadcastCharacterRef.current = broadcastCharacter;
  }, [broadcastCharacter]);

  useEffect(() => {
    let mounted = true;

    getOrCreateDeviceId(db).then(deviceId => {
      if (mounted) {
        deviceIdRef.current = deviceId;
        setLocalDeviceId(deviceId);
      }
    });
    refreshActiveSession().then(() => {
      if (mounted) void recoverLanSession('provider-mounted');
    });

    return () => {
      mounted = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (closingSessionTimerRef.current) {
        clearTimeout(closingSessionTimerRef.current);
        closingSessionTimerRef.current = null;
      }
      suppressReconnectRef.current = true;
      rpcServerRef.current?.close();
      rpcServerRef.current = null;
      suppressReconnectRef.current = false;
    };
  }, [db, recoverLanSession, refreshActiveSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if ((previousState === 'background' || previousState === 'inactive') && nextState === 'active') {
        void recoverLanSession('app-returned-active');
      }
    });

    return () => subscription.remove();
  }, [recoverLanSession]);

  useEffect(() => {
    if (!activeSession || activeSession.role !== 'player' || activeSession.status === 'closed' || activeSession.status === 'inactive') {
      tcpClientRef.current?.close();
      tcpClientRef.current = null;
      tcpClientKeyRef.current = '';
      tcpClientConnectedRef.current = false;
      return undefined;
    }
    if (!activeSession.host_ip || !activeSession.port) return undefined;

    void ensureTcpClient(activeSession, 'active-session-effect');
    return undefined;
  }, [activeSession, ensureTcpClient]);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed' || activeSession.status === 'inactive' || activeSession.role !== 'player') return undefined;

    const pollIntervalMs = activeSession.status === 'paused'
      ? LAN_PLAYER_POLL_PAUSED_INTERVAL_MS
      : connectionStatus === 'reconnecting'
        ? LAN_PLAYER_POLL_RECONNECTING_INTERVAL_MS
        : LAN_PLAYER_POLL_CONNECTED_INTERVAL_MS;
    const pollTimeoutMs = activeSession.status === 'paused' ? LAN_PLAYER_POLL_PAUSED_TIMEOUT_MS : LAN_PLAYER_POLL_TIMEOUT_MS;

    const interval = setInterval(() => {
      const session = activeSessionRef.current;
      if (!session || session.role !== 'player' || session.status === 'closed' || session.status === 'inactive' || !session.host_ip || !session.port) return;
      if (playerPollInFlightRef.current || tcpClientConnectedRef.current) return;
      playerPollInFlightRef.current = true;

      void (async () => {
        try {
          const sinceSeq = await getLocalLastEventSeq(session.id);
          const response = await sendLanRpc(session.host_ip || '', Number(session.port || LAN_DEFAULT_PORT), {
            type: 'LAN_RPC',
            id: makeRpcId(),
            method: 'POLL',
            sessionId: session.id,
            deviceId: deviceIdRef.current || (await getOrCreateDeviceId(db)),
            payload: {
              sinceSeq,
              playerName: await getLocalPlayerName(db),
              characterId: session.linked_character_id || null,
            },
            at: new Date().toISOString(),
          }, pollTimeoutMs);

          if (!response.ok) throw new Error(response.error || 'Falha no polling LAN.');
          await applyRpcSyncPayload(response.payload);
          setTransportReadyState(true);
          setLanConnectionStatus('connected');
          playerPollFailureCountRef.current[session.id] = 0;
        } catch (error) {
          const failureCount = (playerPollFailureCountRef.current[session.id] || 0) + 1;
          playerPollFailureCountRef.current[session.id] = failureCount;
          setTransportReadyState(false);
          setLanConnectionStatus('reconnecting');
          if (failureCount >= LAN_PLAYER_POLL_FAILURES_BEFORE_RECOVERY) {
            const recoverDelayMs = session.status === 'paused'
              ? LAN_PLAYER_POLL_PAUSED_INTERVAL_MS
              : Math.min(LAN_RECOVERY_RETRY_MAX_MS, LAN_RECOVERY_RETRY_BASE_MS + (failureCount - LAN_PLAYER_POLL_FAILURES_BEFORE_RECOVERY) * 4000);
            scheduleLanReconnect(
              session.status === 'paused' ? 'paused-player-poll-failed' : 'player-poll-failed',
              recoverDelayMs
            );
          }
          await traceLan('LAN_RPC', 'playerPoll', 'failed', 'Polling LAN do jogador falhou.', {
            sessionId: session.id,
            hostIp: session.host_ip,
            sessionStatus: session.status,
            failureCount,
            recoveryAfterFailures: LAN_PLAYER_POLL_FAILURES_BEFORE_RECOVERY,
            error: error instanceof Error ? error.message : String(error),
          }, 'warn');
        } finally {
          playerPollInFlightRef.current = false;
        }
      })();
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [activeSession, applyRpcSyncPayload, connectionStatus, db, getLocalLastEventSeq, scheduleLanReconnect, setLanConnectionStatus, setTransportReadyState, traceLan]);

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.status === 'closed') return;
    if (activeSession.status === 'paused' || activeSession.status === 'inactive') {
      void LanForegroundService.stop().catch(() => undefined);
      return;
    }

    void LanForegroundService.start({
      sessionId: activeSession.id,
      sessionName: activeSession.name,
      hostIp: activeSession.host_ip || null,
      port: Number(activeSession.port || LAN_DEFAULT_PORT),
      playerCount: activeSession.role === 'master' ? players.length : 1,
      role: activeSession.role,
      status: activeSession.status,
    }).catch(() => undefined);
  }, [activeSession, players.length]);

  const value = useMemo<LanSessionContextValue>(
    () => ({
      activeSession,
      savedSessions,
      isTransportReady,
      connectionStatus,
      peerCount,
      lastError,
      lastNotice,
      lanRevision,
      localDeviceId,
      players,
      refreshActiveSession,
      refreshSavedSessions,
      forceRecoverLanSession,
      startMasterSession,
      joinPlayerSession,
      resumeLanSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
      sendLanCommand,
      getHistoryPage,
      pauseActiveSession,
      resumeActiveSession,
      endActiveSession,
      refreshPlayers,
    }),
    [
      activeSession,
      savedSessions,
      isTransportReady,
      connectionStatus,
      peerCount,
      lastError,
      lastNotice,
      lanRevision,
      localDeviceId,
      players,
      refreshActiveSession,
      refreshSavedSessions,
      forceRecoverLanSession,
      startMasterSession,
      joinPlayerSession,
      resumeLanSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
      sendLanCommand,
      getHistoryPage,
      pauseActiveSession,
      resumeActiveSession,
      endActiveSession,
      refreshPlayers,
    ]
  );

  return <LanSessionContext.Provider value={value}>{children}</LanSessionContext.Provider>;
}

export function useLanSession() {
  const context = useContext(LanSessionContext);
  if (!context) {
    throw new Error('useLanSession deve ser usado dentro de LanSessionProvider.');
  }
  return context;
}
