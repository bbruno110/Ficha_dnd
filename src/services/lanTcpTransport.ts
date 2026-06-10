import * as Network from 'expo-network';
import { NativeModules } from 'react-native';

import { traceApp, traceError, traceFunctionCall, traceFunctionReturn, traceSocket } from './debug/appTrace';
import { shouldPlayerProcessLanEvent } from './lan/lanClientEngine';
import { getLanEventEntityId, getLanEventEntityType } from './lan/lanEntityQueue';
import {
  getHeartbeatIntervalForSessionStatus,
  getLanEventAudience,
  getLanEventRoutingKeys,
  isBroadcastLanEvent,
  LAN_NETWORK_LIMITS,
  shouldLanEventRequireAck,
  shouldTraceLanEnvelope,
} from './lan/lanNetworkPolicy';
import { debugLanFlow } from './lanRuntimeMode';
import type { LanSessionEvent, LanSessionPayload } from './lanSession';

declare const require: any;

export const LAN_TCP_PORT = 43115;

type TcpServer = {
  listen: (options: Record<string, unknown>, callback?: () => void) => TcpServer;
  close: (callback?: () => void) => void;
  on: (event: 'error' | 'close' | 'listening', listener: (...args: any[]) => void) => TcpServer;
};

type TcpSocket = {
  write: (data: string) => void;
  destroy: () => void;
  on: (event: 'data' | 'error' | 'close' | 'connect' | 'timeout', listener: (...args: any[]) => void) => TcpSocket;
  setNoDelay?: (enabled?: boolean) => void;
  setKeepAlive?: (enabled?: boolean, initialDelay?: number) => void;
  remoteAddress?: string;
};

type TcpEnvelope =
  | { type: 'hello'; sessionId?: string; playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number> }
  | { type: 'session_snapshot'; payload: LanSessionPayload; snapshotSeq?: number; structural?: boolean }
  | { type: 'join'; entry: Record<string, unknown> }
  | { type: 'join_ack'; sessionId: string; remoteKey?: string; clientId?: string; accepted: true }
  | { type: 'join_rejected'; sessionId?: string; reason: string }
  | { type: 'event'; event: LanSessionEvent }
  | { type: 'event_propose'; event: LanSessionEvent }
  | { type: 'event_commit'; event: LanSessionEvent }
  | { type: 'payload_update'; payload: LanSessionPayload; structural?: boolean; snapshotSeq?: number }
  | { type: 'event_ack'; sessionId: string; eventId: string; clientMsgId?: string; playerKey?: string; lastAppliedSeq?: number; entityId?: string; entityRevision?: number }
  | { type: 'event_nack'; sessionId: string; eventId?: string; clientMsgId?: string; playerKey?: string; reason: string }
  | { type: 'resync_request'; sessionId: string; playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number>; includeGlobal?: boolean }
  | { type: 'resync_events'; sessionId: string; events: LanSessionEvent[]; payload?: LanSessionPayload }
  | { type: 'ack'; sessionId: string; playerKey?: string; lastAppliedSeq?: number; receivedEventIds?: string[] }
  | { type: 'heartbeat'; sessionId?: string; sentAt: string }
  | { type: 'heartbeat_ack'; sessionId?: string; sentAt: string }
  | { type: 'session_rejected'; reason: string; currentSessionId?: string };

let tcpModule: TcpSocketModule | null | undefined;
let hostServer: TcpServer | null = null;
let hostPayload: LanSessionPayload | null = null;
let hostUrl = '';
let hostSockets = new Set<TcpSocket>();
let hostJoinedRows: Record<string, unknown>[] = [];
let hostEvents: LanSessionEvent[] = [];
let hostEventAcks: Record<string, unknown>[] = [];

type HostConnection = {
  socket: TcpSocket;
  playerKey?: string;
  clientId?: string;
  playerName?: string;
  connectedAt: number;
  lastSeenAt: number;
  lastAckSeq: number;
  queue: TcpEnvelope[];
  sending: boolean;
};

let hostConnections = new Map<TcpSocket, HostConnection>();
let hostSocketsByPlayerKey = new Map<string, Set<TcpSocket>>();
let hostSocketsByClientId = new Map<string, Set<TcpSocket>>();
export type HostUpdate = {
  reason?: string;
  event?: LanSessionEvent;
  envelopeType?: string;
  joinEntry?: Record<string, unknown>;
  completeJoin?: (payload?: LanSessionPayload | null) => void;
  rejectJoin?: (reason: string) => void;
};
let hostUpdateListeners = new Set<(update?: HostUpdate) => void>();
let hostKickedJoinKeys = new Set<string>();
let lastHostPayloadBroadcastAt = 0;
let lastHostPayloadBroadcastSignature = '';
const semanticTraceThrottle = new Map<string, { at: number; signature: string }>();
const SEMANTIC_TRACE_THROTTLE_MS = 1500;

let clientSocket: TcpSocket | null = null;
let clientUrl = '';
let clientPayload: LanSessionPayload | null = null;
let clientEvents: LanSessionEvent[] = [];
let clientLastPayloadStatus = '';
let clientSyntheticStatusEventIds = new Set<string>();
let clientConnectPromise: Promise<LanSessionPayload> | null = null;
export type ClientUpdate = { reason?: string; event?: LanSessionEvent; envelopeType?: string; payload?: LanSessionPayload };
let clientUpdateListeners = new Set<(update?: ClientUpdate) => void>();
const clientCriticalEventReplayKeys = new Map<string, number>();

function shouldReplayCriticalClientEvent(event?: LanSessionEvent | null) {
  if (!event?.id) return false;
  return (
    event.type === 'inventory_patch' ||
    event.type === 'trade_result' ||
    event.type === 'send_item_result' ||
    event.type === 'public_status' ||
    event.type === 'player_patch' ||
    event.type === 'effect_patch' ||
    event.type === 'pending_save_patch' ||
    event.type === 'player_progression_patch' ||
    event.type === 'session_patch' ||
    event.type === 'session_ended' ||
    event.type === 'player_kicked'
  );
}

function scheduleCriticalClientEventReplay(event: LanSessionEvent, envelopeType?: string) {
  if (!shouldReplayCriticalClientEvent(event)) return;
  const key = `${event.sessionId}:${event.id}:${event.type}`;
  const now = Date.now();
  const last = clientCriticalEventReplayKeys.get(key) || 0;
  if (now - last < 7000) return;
  clientCriticalEventReplayKeys.set(key, now);
  if (clientCriticalEventReplayKeys.size > 600) {
    const keep = Array.from(clientCriticalEventReplayKeys.entries()).slice(-300);
    clientCriticalEventReplayKeys.clear();
    keep.forEach(([entryKey, at]) => clientCriticalEventReplayKeys.set(entryKey, at));
  }
  [60, 220, 700].forEach((delayMs) => {
    setTimeout(() => {
      notifyClientUpdates({ reason: 'critical_event_replay', event, envelopeType });
    }, delayMs);
  });
}

let clientPayloadWaiters = new Set<ClientPayloadWaiter>();
let clientJoinAckWaiters = new Set<ClientJoinAckWaiter>();
let clientHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let clientBoundPlayerKey = '';
let clientBoundLastAppliedSeq = 0;
let clientBoundKnownRevisions: Record<string, number> | undefined;
let clientHelloBindingSignature = '';
const closedSockets = new WeakSet<TcpSocket>();

type ClientPayloadWaiter = {
  sessionId?: string;
  resolve: (payload: LanSessionPayload | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ClientJoinAckWaiter = {
  sessionId: string;
  remoteKey?: string;
  clientId?: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function isTcpLanUrl(url?: string) {
  return /^tcp:\/\//i.test(String(url || '').trim());
}

export async function startLanTcpHost(payload: LanSessionPayload) {
  const startedAt = Date.now();
  traceFunctionCall('startLanTcpHost', {
    sessionId: payload.session.id,
    sessionName: payload.session.name,
    playerCount: payload.state?.players?.length || 0,
  }, {
    source: 'lanTcpTransport',
    sessionId: payload.session.id,
  });
  const TcpSocket = loadTcpSocket();

  if (
    hostServer &&
    hostPayload?.session.id === payload.session.id &&
    hostPayload?.session.hostInstanceId === payload.session.hostInstanceId &&
    hostUrl
  ) {
    hostPayload = payload;
    try {
      const hostIp = await getLocalIpAddress({ allowHotspotFallback: true });
      hostUrl = `tcp://${hostIp}:${LAN_TCP_PORT}/${encodeURIComponent(payload.session.id)}`;
    } catch {
      // Keep the previous URL if the network is temporarily unavailable.
    }
    broadcastHostPayload();
    updateHostForegroundSession();
    notifyHostUpdates();
    traceFunctionReturn('startLanTcpHost', {
      reused: true,
      hostUrl,
    }, {
      source: 'lanTcpTransport',
      sessionId: payload.session.id,
      durationMs: Date.now() - startedAt,
    });
    return hostUrl;
  }

  const preservePendingState = hostPayload?.session.id === payload.session.id;
  const pendingJoinedRows = preservePendingState ? [...hostJoinedRows] : [];
  const pendingEvents = preservePendingState ? [...hostEvents] : [];
  const pendingKickedJoinKeys = preservePendingState ? new Set(hostKickedJoinKeys) : new Set<string>();

  await stopLanTcpHost();

  hostPayload = payload;
  hostJoinedRows = pendingJoinedRows;
  hostEvents = pendingEvents;
  hostKickedJoinKeys = pendingKickedJoinKeys;
  hostSockets = new Set();

  const server = TcpSocket.createServer((socket) => {
    configureSocket(socket);
    hostSockets.add(socket);
    registerHostConnection(socket);

    createLineReader(socket, (message) => {
      if (message.type === 'heartbeat') {
        touchHostConnection(socket);
        sendEnvelope(socket, {
          type: 'heartbeat_ack',
          sessionId: hostPayload?.session.id,
          sentAt: new Date().toISOString(),
        });
        return;
      }

      if (message.type === 'heartbeat_ack') {
        return;
      }

      if (message.type === 'ack') {
        bindHostConnection(socket, { playerKey: message.playerKey });
        const sessionId = String(message.sessionId || hostPayload?.session.id || '');
        rememberHostAck({
          sessionId,
          playerKey: message.playerKey,
          lastAppliedSeq: message.lastAppliedSeq,
          receivedEventIds: message.receivedEventIds || [],
          receivedAt: new Date().toISOString(),
        });
        // ACK e heartbeat sao caminho quente. Nao acorde a UI do mestre para cada ACK,
        // senao um jogador que reabre a ficha e confirma dezenas de eventos congela a mesa.
        return;
      }

      if (message.type === 'event_ack') {
        bindHostConnection(socket, { playerKey: message.playerKey });
        rememberHostAck({ ...message, receivedAt: new Date().toISOString() });
        // ACK por evento nao muda estado de mesa; manter apenas em memoria para debug/retry.
        return;
      }

      if (message.type === 'event_nack') {
        bindHostConnection(socket, { playerKey: message.playerKey });
        rememberHostAck({ ...message, receivedAt: new Date().toISOString() });
        notifyHostUpdates({ reason: 'event_nack' });
        return;
      }

      if (message.type === 'resync_request') {
        bindHostConnection(socket, { playerKey: message.playerKey });
        if (!isEnvelopeForCurrentSession(message.sessionId)) return;
        const lastAppliedSeq = Number(message.lastAppliedSeq || 0);
        const replayEvents = lastAppliedSeq > 0
          ? getEventsAfterSeq(lastAppliedSeq, message.sessionId)
          : getColdStartResyncEvents(message.sessionId);
        const events = filterEventsForPlayer(
          mergeEventsById(
            replayEvents,
            getEventsForRevisionGaps(message.sessionId, message.knownRevisions || {})
          ),
          {
            sessionId: message.sessionId,
            playerKey: message.playerKey,
            includeGlobal: message.includeGlobal !== false,
          }
        );
        const limitedEvents = events.slice(-LAN_NETWORK_LIMITS.maxEventsPerResync);
        traceApp('RESYNC_RECEIVED', 'RESYNC_RESPONSE_PREPARED', {
          source: 'lanTcpTransport.resync_request',
          sessionId: message.sessionId,
          playerKey: message.playerKey,
          lastAppliedSeq,
          replayCount: replayEvents.length,
          totalCount: events.length,
          sentCount: limitedEvents.length,
          coldStart: lastAppliedSeq <= 0,
        });
        sendEnvelope(socket, {
          type: 'resync_events',
          sessionId: message.sessionId,
          events: limitedEvents,
          payload: makeHostPayload(),
        });
        return;
      }

      if (message.type === 'hello') {
        bindHostConnection(socket, { playerKey: message.playerKey });
        if (!isEnvelopeForCurrentSession(message.sessionId)) {
          sendEnvelope(socket, {
            type: 'session_rejected',
            reason: 'SESSION_ID_MISMATCH',
            currentSessionId: hostPayload?.session.id,
          });
          socket.destroy();
          return;
        }

        sendEnvelope(socket, { type: 'session_snapshot', payload: makeHostPayload() });
        return;
      }

      if (message.type === 'join') {
        const entrySessionId = String(message.entry?.sessionId || '');
        if (!isEnvelopeForCurrentSession(entrySessionId)) {
          sendEnvelope(socket, {
            type: 'join_rejected',
            sessionId: entrySessionId,
            reason: 'JOIN_SESSION_ID_MISMATCH',
          });
          sendEnvelope(socket, {
            type: 'session_rejected',
            reason: 'JOIN_SESSION_ID_MISMATCH',
            currentSessionId: hostPayload?.session.id,
          });
          socket.destroy();
          return;
        }

        const now = new Date().toISOString();
        const incomingEntry = message.entry as Record<string, unknown>;
        const remoteKey = String(incomingEntry.remoteKey || '');
        const clientId = String(incomingEntry.clientId || '');
        bindHostConnection(socket, { playerKey: remoteKey || undefined, clientId: clientId || undefined, playerName: String(incomingEntry.playerName || '') || undefined });
        if (isHostJoinBlocked(entrySessionId, remoteKey, clientId)) {
          debugLanFlow('MASTER_JOIN_ROW_IGNORED_KICKED', {
            sessionId: entrySessionId,
            remoteKey,
            clientId,
            source: 'transport_join',
          });
          sendEnvelope(socket, {
            type: 'join_rejected',
            sessionId: entrySessionId,
            reason: 'PLAYER_KICKED',
          });
          return;
        }
        const normalizedEntry: Record<string, unknown> & {
          sessionId: string;
          remoteKey?: string;
          clientId?: string;
          receivedAt: string;
        } = {
          ...incomingEntry,
          sessionId: entrySessionId,
          remoteKey: remoteKey || undefined,
          clientId: clientId || undefined,
          receivedAt: now,
        };

        const character = normalizeJoinCharacter(incomingEntry.character);
        const playerName = String(incomingEntry.playerName || character.name || 'Jogador');
        const joinedEvent: LanSessionEvent = {
          id: `join_${entrySessionId}_${remoteKey || clientId || Date.now()}`,
          sessionId: entrySessionId,
          type: 'player_joined',
          fromKey: remoteKey || clientId || `join:${entrySessionId}`,
          fromName: playerName,
          toKey: 'master',
          toName: 'Mestre',
          message: `${playerName} entrou na sessao.`,
          createdAt: now,
        };
        upsertByKey(hostJoinedRows, normalizedEntry, remoteKey ? 'remoteKey' : 'clientId');
        upsertByKey(hostEvents, joinedEvent, 'id');

        traceApp('LAN_JOIN', 'MASTER_JOIN_UPSERT_START', {
          source: 'lanTcpTransport.join',
          sessionId: entrySessionId,
          remoteKey,
          clientId,
          playerName,
        });

        let joinAckSent = false;
        let joinFinalized = false;
        const joinSlowTimer = setTimeout(() => {
          if (joinFinalized) return;
          traceApp('LAN_JOIN', 'MASTER_JOIN_UPSERT_SLOW_BACKGROUND', {
            source: 'lanTcpTransport.join',
            sessionId: entrySessionId,
            remoteKey,
            clientId,
            playerName,
            decision: 'waiting_for_sqlite_upsert_before_join_ack',
          });
        }, 8000);

        const sendJoinAck = (reason: string) => {
          if (joinAckSent) return;
          joinAckSent = true;
          const currentPayload = makeHostPayload();
          traceApp('LAN_JOIN', 'MASTER_JOIN_ACK_SENT_READY', {
            source: 'lanTcpTransport.join',
            sessionId: entrySessionId,
            remoteKey,
            clientId,
            playerName,
            playerCount: currentPayload.state?.players?.length || 0,
            reason,
          });
          sendEnvelope(socket, {
            type: 'join_ack',
            sessionId: hostPayload?.session.id || entrySessionId,
            remoteKey: remoteKey || undefined,
            clientId: clientId || undefined,
            accepted: true,
          });
          sendEnvelope(socket, {
            type: 'session_snapshot',
            payload: currentPayload,
            structural: true,
          });
        };

        const finishJoin = (payload?: LanSessionPayload | null) => {
          if (payload?.session?.id === entrySessionId) {
            hostPayload = payload;
          }
          sendJoinAck('upsert_done_ready_payload');
          if (joinFinalized) return;
          joinFinalized = true;
          clearTimeout(joinSlowTimer);

          const bootstrapPayload = makeHostPayload();
          broadcastEnvelope({
            type: 'payload_update',
            payload: bootstrapPayload,
            structural: true,
          });
          const publicJoinedEvent = makePublicPlayerJoinedEvent(joinedEvent, bootstrapPayload);
          upsertByKey(hostEvents, publicJoinedEvent, 'id');
          broadcastEnvelope({ type: 'event_commit', event: publicJoinedEvent });
          notifyHostUpdates({ reason: 'player_joined_public', event: publicJoinedEvent, envelopeType: 'event_commit' });
          traceApp('LAN_JOIN', 'MASTER_JOIN_PUBLIC_EVENT_BROADCAST', {
            source: 'lanTcpTransport.join',
            sessionId: entrySessionId,
            remoteKey,
            clientId,
            playerName,
            playerCount: bootstrapPayload.state?.players?.length || 0,
          });
          traceApp('LAN_JOIN', 'MASTER_JOIN_BOOTSTRAP_PAYLOAD_WITH_PLAYER', {
            source: 'lanTcpTransport.join',
            sessionId: entrySessionId,
            remoteKey,
            clientId,
            playerName,
            playerCount: bootstrapPayload.state?.players?.length || 0,
            hasOfficialPlayer: Boolean((bootstrapPayload.state?.players || []).some((player) => (
              player.remoteKey === remoteKey ||
              (clientId && player.clientId === clientId) ||
              player.characterName === playerName
            ))),
          });
          updateHostForegroundSession();
        };

        const rejectJoin = (reason: string) => {
          if (joinAckSent) {
            joinFinalized = true;
            clearTimeout(joinSlowTimer);
            traceApp('LAN_JOIN', 'MASTER_JOIN_REJECT_IGNORED_AFTER_FAST_ACK', {
              source: 'lanTcpTransport.join',
              sessionId: entrySessionId,
              remoteKey,
              clientId,
              playerName,
              reason,
            });
            return;
          }
          joinAckSent = true;
          joinFinalized = true;
          clearTimeout(joinSlowTimer);
          sendEnvelope(socket, {
            type: 'join_rejected',
            sessionId: entrySessionId,
            reason,
          });
        };

        // v80: não confirme o join antes do upsert SQLite/runtime do mestre.
        // ACK com snapshot vazio fazia o jogador entrar piscando e sem enxergar o roster completo.
        notifyHostUpdates({
          reason: 'join',
          event: joinedEvent,
          envelopeType: 'join',
          joinEntry: normalizedEntry,
          completeJoin: finishJoin,
          rejectJoin,
        });
        return;
      }

      if (message.type === 'event_propose') {
        if (!isEnvelopeForCurrentSession(message.event?.sessionId)) return;
        const event = normalizeWireEvent(message.event);
        bindHostConnection(socket, { playerKey: event.fromKey, clientId: (message.event as any)?.clientId });
        // Propostas/comandos do jogador são entrada para o host, não estado oficial.
        // Não faça broadcast para os jogadores e não use isso como confirmação viva.
        // A tela do mestre processa o comando e só então emite um event_commit autoritativo.
        upsertByKey(hostEvents, event, 'id');
        notifyHostUpdates({ reason: 'event_propose', event, envelopeType: message.type });
        return;
      }

      if (message.type === 'event' || message.type === 'event_commit') {
        if (!isEnvelopeForCurrentSession(message.event?.sessionId)) return;
        const event = normalizeWireEvent(message.event);
        bindHostConnection(socket, { playerKey: event.fromKey, clientId: (message.event as any)?.clientId });
        upsertByKey(hostEvents, event, 'id');
        broadcastEnvelope({ type: 'event_commit', event });
        notifyHostUpdates({ reason: 'event_commit', event, envelopeType: message.type });
      }
    });

    socket.on('close', () => {
      unregisterHostConnection(socket);
    });
    socket.on('error', () => {
      unregisterHostConnection(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao abrir socket TCP.')), 5000);
    server.on('error', (error) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    server.listen({ port: LAN_TCP_PORT, host: '0.0.0.0', reuseAddress: true }, () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  hostServer = server;
  const hostIp = await getLocalIpAddress({ allowHotspotFallback: true, throwIfMissing: false });
  if (!hostIp) {
    await stopLanTcpHost();
    throw new Error(
      'Não encontrei um IP local válido. Ative o Wi-Fi ou ligue o roteador/hotspot antes de iniciar a sessão.'
    );
  }

  hostUrl = `tcp://${hostIp}:${LAN_TCP_PORT}/${encodeURIComponent(payload.session.id)}`;
  traceFunctionReturn('startLanTcpHost', {
    reused: false,
    hostUrl,
  }, {
    source: 'lanTcpTransport',
    sessionId: payload.session.id,
    durationMs: Date.now() - startedAt,
  });
  return hostUrl;
}

export async function stopLanTcpHost() {
  const startedAt = Date.now();
  traceFunctionCall('stopLanTcpHost', {
    socketCount: hostSockets.size,
    sessionId: hostPayload?.session.id,
  }, {
    source: 'lanTcpTransport',
    sessionId: hostPayload?.session.id,
  });
  for (const socket of hostSockets) {
    try {
      socket.destroy();
    } catch {
      // Socket already closed.
    }
    closedSockets.add(socket);
  }
  hostSockets.clear();
  hostConnections = new Map();
  hostSocketsByPlayerKey = new Map();
  hostSocketsByClientId = new Map();

  if (hostServer) {
    await new Promise<void>((resolve) => {
      try {
        hostServer?.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  hostServer = null;
  hostPayload = null;
  hostUrl = '';
  hostJoinedRows = [];
  hostEvents = [];
  hostEventAcks = [];
  hostKickedJoinKeys = new Set();
  lastHostPayloadBroadcastAt = 0;
  lastHostPayloadBroadcastSignature = '';
  traceFunctionReturn('stopLanTcpHost', {
    stopped: true,
  }, {
    source: 'lanTcpTransport',
    durationMs: Date.now() - startedAt,
  });
}

export function updateLanTcpHostPayload(payload: LanSessionPayload, options?: { broadcast?: boolean }) {
  if (!hostServer || hostPayload?.session.id !== payload.session.id) return false;
  hostPayload = payload;
  if (options?.broadcast !== false) {
    broadcastHostPayload();
  }
  updateHostForegroundSession();
  notifyHostUpdates();
  return true;
}

export function getLanTcpHostJoinedRows() {
  return hostJoinedRows.filter((row) => !isHostJoinBlocked(
    String(row.sessionId || hostPayload?.session.id || ''),
    String(row.remoteKey || ''),
    String(row.clientId || ''),
  ));
}

export function kickLanTcpHostJoinedPlayer(sessionId: string, remoteKey?: string, clientId?: string) {
  rememberHostKickedJoinKeys(sessionId, remoteKey, clientId);
  const beforeCount = hostJoinedRows.length;
  hostJoinedRows = hostJoinedRows.filter((row) => !(
    String(row.sessionId || '') === sessionId &&
    (
      Boolean(remoteKey && row.remoteKey === remoteKey) ||
      Boolean(clientId && row.clientId === clientId)
    )
  ));
  debugLanFlow('MASTER_KICK_REMOVED_FROM_ROSTER', {
    source: 'transport',
    sessionId,
    remoteKey,
    clientId,
    removedJoinRows: beforeCount - hostJoinedRows.length,
  });
  notifyHostUpdates();
}

export function getLanTcpHostEvents() {
  return [...hostEvents];
}

export function getLanTcpHostAcks() {
  return [...hostEventAcks];
}

export async function fetchLanTcpPayload(url: string) {
  if (isCurrentHostUrl(url)) return makeHostPayload();
  return connectLanTcpClient(url, { requestFresh: true });
}

export async function resolveLanTcpUrlByInviteCode(inviteCode: string) {
  const normalizedCode = inviteCode.trim().toUpperCase();
  if (!normalizedCode) return '';

  const hosts = await buildLanProbeHosts();
  let nextIndex = 0;
  let foundUrl = '';
  const workerCount = Math.min(10, hosts.length);

  const scanNext = async () => {
    while (!foundUrl && nextIndex < hosts.length) {
      const host = hosts[nextIndex];
      nextIndex += 1;

      const payload = await fetchLanTcpProbePayload(host, 350);
      if (payload?.session?.inviteCode?.toUpperCase() === normalizedCode) {
        foundUrl = `tcp://${host}:${LAN_TCP_PORT}/${encodeURIComponent(payload.session.id)}`;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, scanNext));
  return foundUrl;
}

export async function sendLanTcpJoin(url: string | undefined, entry: Record<string, unknown>) {
  if (!url) return false;
  const startedAt = Date.now();
  traceFunctionCall('sendLanTcpJoin', entry, {
    source: 'lanTcpTransport',
    sessionId: String(entry.sessionId || ''),
    playerKey: String(entry.remoteKey || ''),
    playerName: String(entry.playerName || ''),
  });
  const sendJoinAndWaitAck = async () => {
    await connectLanTcpClient(url, { requestFresh: true });
    if (!clientSocket) return false;
    const sessionId = String(entry.sessionId || parseTcpUrl(url).sessionId || '');
    const remoteKey = entry.remoteKey ? String(entry.remoteKey) : undefined;
    const clientId = entry.clientId ? String(entry.clientId) : undefined;
    const ackPromise = waitForJoinAck(sessionId, remoteKey, clientId);
    if (!sendEnvelope(clientSocket, { type: 'join', entry })) {
      cancelJoinAckWaiter(ackPromise);
      return false;
    }
    await ackPromise;
    return true;
  };

  try {
    const result = await sendJoinAndWaitAck();
    traceFunctionReturn('sendLanTcpJoin', { result }, {
      source: 'lanTcpTransport',
      sessionId: String(entry.sessionId || ''),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch {
    await connectLanTcpClient(url, { forceReconnect: true });
    const result = await sendJoinAndWaitAck();
    traceFunctionReturn('sendLanTcpJoin', { result, retried: true }, {
      source: 'lanTcpTransport',
      sessionId: String(entry.sessionId || ''),
      durationMs: Date.now() - startedAt,
    });
    return result;
  }
}

export async function sendLanTcpEvent(url: string | undefined, event: LanSessionEvent) {
  if (!url) throw new Error('Sessao TCP sem URL ativa.');
  const startedAt = Date.now();
  const wireEvent = normalizeWireEvent(event);
  traceFunctionCall('sendLanTcpEvent', {
    url,
    event: wireEvent,
  }, {
    source: 'lanTcpTransport',
    sessionId: wireEvent.sessionId,
    eventId: wireEvent.id,
    eventType: wireEvent.type,
    seq: wireEvent.seq,
    serverSeq: wireEvent.serverSeq,
    entityType: wireEvent.entityType,
    entityId: wireEvent.entityId,
    entityRevision: wireEvent.entityRevision,
    fromKey: wireEvent.fromKey,
    toKey: wireEvent.toKey,
  });

  if (isCurrentHostUrl(url)) {
    upsertByKey(hostEvents, wireEvent, 'id');
    broadcastEnvelope({ type: 'event_commit', event: wireEvent });
    notifyHostUpdates({ reason: 'event_commit', event: wireEvent, envelopeType: 'event_commit' });
    traceFunctionReturn('sendLanTcpEvent', { result: true, mode: 'host_routed_event' }, {
      source: 'lanTcpTransport',
      sessionId: wireEvent.sessionId,
      eventId: wireEvent.id,
      durationMs: Date.now() - startedAt,
    });
    return true;
  }

  await connectLanTcpClient(url, { playerKey: wireEvent.fromKey && wireEvent.fromKey !== 'master' ? wireEvent.fromKey : undefined });
  if (!clientSocket) throw new Error('Socket TCP indisponivel.');
  const envelopeType = wireEvent.toKey === 'master' ? 'event_propose' : 'event';
  if (sendEnvelope(clientSocket, { type: envelopeType, event: wireEvent })) {
    traceFunctionReturn('sendLanTcpEvent', { result: true, envelopeType }, {
      source: 'lanTcpTransport',
      sessionId: wireEvent.sessionId,
      eventId: wireEvent.id,
      durationMs: Date.now() - startedAt,
    });
    return true;
  }

  await connectLanTcpClient(url, { forceReconnect: true, playerKey: wireEvent.fromKey && wireEvent.fromKey !== 'master' ? wireEvent.fromKey : undefined });
  if (!clientSocket || !sendEnvelope(clientSocket, { type: envelopeType, event: wireEvent })) {
    throw new Error('Socket TCP indisponivel.');
  }
  traceFunctionReturn('sendLanTcpEvent', { result: true, envelopeType, retried: true }, {
    source: 'lanTcpTransport',
    sessionId: wireEvent.sessionId,
    eventId: wireEvent.id,
    durationMs: Date.now() - startedAt,
  });
  return true;
}

export async function sendLanTcpAck(url: string | undefined, ack: { sessionId: string; eventId: string; clientMsgId?: string; playerKey?: string; lastAppliedSeq?: number; entityId?: string; entityRevision?: number }) {
  if (!url) return false;
  traceFunctionCall('sendLanTcpAck', ack, {
    source: 'lanTcpTransport',
    sessionId: ack.sessionId,
    eventId: ack.eventId,
    playerKey: ack.playerKey,
  });

  if (isCurrentHostUrl(url)) {
    rememberHostAck({ ...ack, type: 'event_ack', receivedAt: new Date().toISOString() });
    traceFunctionReturn('sendLanTcpAck', { result: true, mode: 'host_memory' }, {
      source: 'lanTcpTransport',
      sessionId: ack.sessionId,
      eventId: ack.eventId,
      playerKey: ack.playerKey,
    });
    return true;
  }

  if (clientSocket && clientUrl === url) {
    // Nao envie hello junto com ACK. O host responde hello com session_snapshot;
    // em resyncs grandes isso causava dezenas de snapshots e travava todos.
    const result = sendEnvelope(clientSocket, { type: 'event_ack', ...ack });
    traceFunctionReturn('sendLanTcpAck', { result }, {
      source: 'lanTcpTransport',
      sessionId: ack.sessionId,
      eventId: ack.eventId,
      playerKey: ack.playerKey,
    });
    return result;
  }

  await connectLanTcpClient(url, { forceReconnect: true, playerKey: ack.playerKey, lastAppliedSeq: ack.lastAppliedSeq });
  if (!clientSocket) return false;
  const result = sendEnvelope(clientSocket, { type: 'event_ack', ...ack });
  traceFunctionReturn('sendLanTcpAck', { result, reconnected: true }, {
    source: 'lanTcpTransport',
    sessionId: ack.sessionId,
    eventId: ack.eventId,
    playerKey: ack.playerKey,
  });
  return result;
}


export async function sendLanTcpNack(url: string | undefined, nack: { sessionId: string; eventId?: string; clientMsgId?: string; playerKey?: string; reason: string }) {
  if (!url) return false;
  traceFunctionCall('sendLanTcpNack', nack, {
    source: 'lanTcpTransport',
    sessionId: nack.sessionId,
    eventId: nack.eventId,
    playerKey: nack.playerKey,
    reason: nack.reason,
  });

  if (isCurrentHostUrl(url)) {
    rememberHostAck({ ...nack, type: 'event_nack', receivedAt: new Date().toISOString() });
    notifyHostUpdates();
    traceFunctionReturn('sendLanTcpNack', { result: true, mode: 'host_memory' }, {
      source: 'lanTcpTransport',
      sessionId: nack.sessionId,
      eventId: nack.eventId,
      playerKey: nack.playerKey,
      reason: nack.reason,
    });
    return true;
  }

  if (clientSocket && clientUrl === url) {
    // NACK tambem nao precisa de hello; a propria mensagem carrega playerKey.
    const result = sendEnvelope(clientSocket, { type: 'event_nack', ...nack });
    traceFunctionReturn('sendLanTcpNack', { result }, {
      source: 'lanTcpTransport',
      sessionId: nack.sessionId,
      eventId: nack.eventId,
      playerKey: nack.playerKey,
      reason: nack.reason,
    });
    return result;
  }

  await connectLanTcpClient(url, { forceReconnect: true, playerKey: nack.playerKey });
  if (!clientSocket) return false;
  const result = sendEnvelope(clientSocket, { type: 'event_nack', ...nack });
  traceFunctionReturn('sendLanTcpNack', { result, reconnected: true }, {
    source: 'lanTcpTransport',
    sessionId: nack.sessionId,
    eventId: nack.eventId,
    playerKey: nack.playerKey,
    reason: nack.reason,
  });
  return result;
}

export async function requestLanTcpResync(url: string | undefined, request: { sessionId: string; playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number>; includeGlobal?: boolean; forceReconnect?: boolean }) {
  if (!url) return false;
  traceFunctionCall('requestLanTcpResync', request, {
    source: 'lanTcpTransport',
    sessionId: request.sessionId,
    playerKey: request.playerKey,
  });

  const resyncEnvelope: Extract<TcpEnvelope, { type: 'resync_request' }> = {
    type: 'resync_request',
    sessionId: request.sessionId,
    playerKey: request.playerKey,
    lastAppliedSeq: request.lastAppliedSeq,
    knownRevisions: request.knownRevisions,
    includeGlobal: request.includeGlobal,
  };

  if (request.forceReconnect && clientSocket && clientUrl === url) {
    closeClientSocket();
    clientPayload = null;
  }

  if (clientSocket && clientUrl === url) {
    // O resync_request ja carrega playerKey/knownRevisions e o host faz bind por ele.
    // Evita hello extra, que geraria session_snapshot desnecessario.
    const result = sendEnvelope(clientSocket, resyncEnvelope);
    if (result) {
      traceFunctionReturn('requestLanTcpResync', { result }, {
        source: 'lanTcpTransport',
        sessionId: request.sessionId,
        playerKey: request.playerKey,
      });
      return true;
    }

    // Socket aparentemente existe, mas nao aceitou escrita. Recria e reenvia
    // para evitar voltar da Home/index ou de outro app preso em snapshot.
    closeClientSocket();
    clientPayload = null;
  }

  await connectLanTcpClient(url, {
    forceReconnect: true,
    playerKey: request.playerKey,
    lastAppliedSeq: request.lastAppliedSeq,
    knownRevisions: request.knownRevisions,
  });
  if (!clientSocket) return false;
  // connectLanTcpClient ja enviou hello na abertura da conexao; envie apenas o pedido real.
  const result = sendEnvelope(clientSocket, resyncEnvelope);
  traceFunctionReturn('requestLanTcpResync', { result, reconnected: true }, {
    source: 'lanTcpTransport',
    sessionId: request.sessionId,
    playerKey: request.playerKey,
  });
  return result;
}

export async function getLanTcpClientEvents(
  url: string,
  sessionId?: string,
  options?: number | { afterSeq?: number; playerKey?: string; includeGlobal?: boolean },
) {
  const minSeq = Math.max(0, Math.floor(Number(typeof options === 'number' ? options : options?.afterSeq || 0)) || 0);
  const playerKey = typeof options === 'number' ? undefined : options?.playerKey;
  const includeGlobal = typeof options === 'number' ? true : options?.includeGlobal !== false;
  const filterOptions = { sessionId, playerKey, includeGlobal };
  const capClientEventFetch = (events: LanSessionEvent[]) => events
    .sort(compareEventsAscending)
    .slice(-(LAN_NETWORK_LIMITS.maxEventsPerResync * 2));

  if (isCurrentHostUrl(url)) {
    return capClientEventFetch(getLanTcpHostEvents()
      .filter((event) => (!sessionId || event.sessionId === sessionId) && shouldReturnEventAfterClientSeq(event, minSeq))
      .filter((event) => shouldReturnEventToClient(event, filterOptions)));
  }
  await connectLanTcpClient(url, { playerKey, lastAppliedSeq: minSeq });
  return capClientEventFetch(clientEvents
    .filter((event) => (!sessionId || event.sessionId === sessionId) && shouldReturnEventAfterClientSeq(event, minSeq))
    .filter((event) => shouldReturnEventToClient(event, filterOptions)));
}

function shouldReturnEventAfterClientSeq(event: LanSessionEvent, minSeq: number) {
  if (minSeq <= 0) return true;
  const seq = getEventSeq(event);
  return seq <= 0 || seq > minSeq;
}

function isCurrentHostUrl(url?: string) {
  if (!hostServer || !hostUrl || !url) return false;
  try {
    const current = parseTcpUrl(hostUrl);
    const incoming = parseTcpUrl(url);
    return current.sessionId === incoming.sessionId && current.port === incoming.port;
  } catch {
    return false;
  }
}

function rememberClientBinding(options?: { playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number> }) {
  if (options?.playerKey) clientBoundPlayerKey = options.playerKey;
  if (options?.lastAppliedSeq != null) clientBoundLastAppliedSeq = Math.max(0, Math.floor(Number(options.lastAppliedSeq) || 0));
  if (options?.knownRevisions) clientBoundKnownRevisions = options.knownRevisions;
}

function getClientHelloBindingSignature(url: string) {
  const target = parseTcpUrl(url);
  return `${target.sessionId}:${clientBoundPlayerKey || ''}`;
}

function sendClientHello(url: string, socket: TcpSocket, options?: { playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number> }) {
  rememberClientBinding(options);
  const target = parseTcpUrl(url);
  const result = sendEnvelope(socket, {
    type: 'hello',
    sessionId: target.sessionId,
    playerKey: clientBoundPlayerKey || undefined,
    lastAppliedSeq: clientBoundLastAppliedSeq || undefined,
    knownRevisions: clientBoundKnownRevisions,
  });
  if (result) clientHelloBindingSignature = getClientHelloBindingSignature(url);
  return result;
}

async function connectLanTcpClient(url: string, options?: { requestFresh?: boolean; forceReconnect?: boolean; playerKey?: string; lastAppliedSeq?: number; knownRevisions?: Record<string, number> }) {
  if (!isTcpLanUrl(url)) throw new Error('URL TCP invalida.');
  const previousPlayerKey = clientBoundPlayerKey;
  const nextPlayerKey = String(options?.playerKey || previousPlayerKey || '');
  const playerBindingChanged = Boolean(
    clientSocket &&
    clientUrl === url &&
    nextPlayerKey &&
    previousPlayerKey &&
    nextPlayerKey !== previousPlayerKey
  );
  rememberClientBinding(options);

  if (clientSocket && clientUrl === url && clientPayload && !options?.forceReconnect) {
    if (playerBindingChanged) {
      clientEvents = [];
      clientBoundLastAppliedSeq = Math.max(0, Math.floor(Number(options?.lastAppliedSeq || 0)));
      clientBoundKnownRevisions = options?.knownRevisions;
      traceApp('LAN_JOIN', 'TCP_CLIENT_PLAYER_BINDING_CHANGED_BUFFER_RESET', {
        source: 'lanTcpTransport.connectLanTcpClient',
        sessionId: parseTcpUrl(url).sessionId,
        previousPlayerKey,
        nextPlayerKey,
      });
    }
    if (options?.playerKey && getClientHelloBindingSignature(url) !== clientHelloBindingSignature) {
      sendClientHello(url, clientSocket, options);
    }
    if (!options?.requestFresh) return clientPayload;

    const target = parseTcpUrl(url);
    const freshPayload = await requestClientSnapshot(target.sessionId);
    if (freshPayload) return freshPayload;

    closeClientSocket();
    clientPayload = null;
    clientEvents = [];
    clientLastPayloadStatus = '';
  }

  if (clientConnectPromise && clientUrl === url) return clientConnectPromise;

  closeClientSocket();
  clientUrl = url;
  clientPayload = null;
  clientEvents = [];
  clientLastPayloadStatus = '';

  const TcpSocket = loadTcpSocket();
  const target = parseTcpUrl(url);

  clientConnectPromise = new Promise<LanSessionPayload>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const socket = TcpSocket.createConnection({
      host: target.host,
      port: target.port,
      reuseAddress: true,
      connectTimeout: 5000,
    }, () => {
      configureSocket(socket);
      sendClientHello(url, socket, options);
    });

    const cleanupClientSocket = (resetUrl = false) => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      try {
        socket.destroy();
      } catch {
        // socket ja fechado
      }

      if (clientSocket === socket) {
        clientSocket = null;
        clientHelloBindingSignature = '';
      }

      clientPayload = null;
      clientEvents = [];
      clearClientPayloadWaiters();
      clearClientJoinAckWaiters(new Error('Conexao TCP fechada antes do join_ack.'));
      stopClientHeartbeat();

      if (resetUrl) {
        clientUrl = '';
      }
    };

    const applyPayloadUpdate = (payload: LanSessionPayload, updateOptions?: { notify?: boolean }) => {
      if (target.sessionId && payload.session.id !== target.sessionId) {
        traceApp('PAYLOAD_IGNORED', 'PAYLOAD_IGNORED_SESSION_MISMATCH', {
          source: 'lanTcpTransport.applyPayloadUpdate',
          sessionId: payload.session.id,
          reason: 'session_mismatch',
          args: { expectedSessionId: target.sessionId },
        });
        return false;
      }
      const previousStatus = clientLastPayloadStatus || String(clientPayload?.state?.status || '');
      clientPayload = payload;
      clientSocket = socket;
      mergeClientPayloadEvents(payload, target.sessionId);
      resolveClientPayloadWaiters(payload);
      const nextStatus = String(payload.state?.status || 'active');
      clientLastPayloadStatus = nextStatus;
      if (updateOptions?.notify !== false) {
        notifyClientUpdates({ reason: 'payload_update', payload });
      }
      // Snapshot/payload nao deve atualizar HP/efeitos/inventario, mas status de
      // ciclo de vida e critico. Se o evento direto perdeu, cria evento sintetico
      // estavel para a UI entrar em pausa/encerrar sem esperar polling.
      if (previousStatus && nextStatus && previousStatus !== nextStatus) {
        const synthetic = makeSyntheticSessionStatusEvent(payload, nextStatus);
        if (synthetic && !clientSyntheticStatusEventIds.has(synthetic.id)) {
          clientSyntheticStatusEventIds.add(synthetic.id);
          upsertByKey(clientEvents, synthetic, 'id');
          notifyClientUpdates({ reason: 'payload_status', event: synthetic, envelopeType: 'payload_update', payload });
        }
      }
      traceApp('PAYLOAD_APPLIED', 'PAYLOAD_STRUCTURAL_CACHE_APPLIED', {
        source: 'lanTcpTransport.applyPayloadUpdate',
        sessionId: payload.session.id,
        payload: summarizeEnvelopePayload({ type: 'payload_update', payload }, undefined, payload),
        decision: 'structural_cache_only',
        reason: updateOptions?.notify === false ? 'live_fields_not_notified' : 'client_payload_refreshed',
      });
      return true;
    };

    const rejectOnce = (error: Error, resetUrl = true) => {
      if (settled) return;
      settled = true;
      cleanupClientSocket(resetUrl);
      reject(error);
    };

    const resolveOnce = (payload: LanSessionPayload) => {
      if (settled) return;
      if (target.sessionId && payload.session.id !== target.sessionId) {
        rejectOnce(new Error('Sessao rejeitada pelo host: SESSION_ID_MISMATCH'));
        return;
      }

      settled = true;

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      applyPayloadUpdate(payload, { notify: false });
      startClientHeartbeat(socket, target.sessionId);
      resolve(payload);
    };

    timeout = setTimeout(() => {
      rejectOnce(new Error('Tempo esgotado ao conectar no host TCP.'));
    }, 6500);

    socket.on('error', (error) => {
      if (!settled) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (clientSocket === socket) {
        clientSocket = null;
        clearClientPayloadWaiters();
        stopClientHeartbeat();
        notifyClientUpdates();
      }

      try {
        socket.destroy();
      } catch {
        // Socket already closed.
      }
    });

    socket.on('close', () => {
      if (clientSocket === socket) {
        clientSocket = null;
        clearClientPayloadWaiters();
        stopClientHeartbeat();
        notifyClientUpdates();
      }

      if (!settled) {
        rejectOnce(new Error('Conexao TCP fechada antes de receber a sessao.'));
      }
    });

    createLineReader(socket, (message) => {
      if (message.type === 'heartbeat') {
        touchHostConnection(socket);
        sendEnvelope(socket, {
          type: 'heartbeat_ack',
          sessionId: target.sessionId,
          sentAt: new Date().toISOString(),
        });
        return;
      }

      if (message.type === 'heartbeat_ack' || message.type === 'ack') {
        return;
      }

      if (message.type === 'join_ack') {
        resolveJoinAckWaiters(message.sessionId, message.remoteKey, message.clientId);
        return;
      }

      if (message.type === 'join_rejected') {
        rejectJoinAckWaiters(message.sessionId || target.sessionId, message.reason);
        return;
      }

      if (message.type === 'session_rejected') {
        rejectJoinAckWaiters(target.sessionId, message.reason);
        rejectOnce(new Error(`Sessao rejeitada pelo host: ${message.reason}`));
        return;
      }

      if (message.type === 'session_snapshot' || message.type === 'payload_update') {
        if (!settled) {
          resolveOnce(message.payload);
        } else {
          // v84: payload/snapshot também notifica a ficha como reconciliação autoritativa.
          // Eventos vivos continuam sendo o caminho rápido; o payload só corrige roster/inventário
          // quando o socket recebeu o frame, mas o listener da tela perdeu a janela durante rebind/reconnect.
          applyPayloadUpdate(message.payload, { notify: true });
        }
        return;
      }

      if (message.type === 'resync_events') {
        if (target.sessionId && message.sessionId !== target.sessionId) return;
        const orderedEvents = [...(message.events || [])].sort(compareEventsAscending);
        let notifiedCount = 0;
        let duplicateCount = 0;
        let renotifiedCount = 0;
        for (const event of orderedEvents) {
          if (target.sessionId && event.sessionId !== target.sessionId) continue;
          const normalizedEvent = normalizeWireEvent(event);
          const alreadyKnown = Boolean(normalizedEvent.id && clientEvents.some((entry) => entry.id === normalizedEvent.id));
          upsertByKey(clientEvents, normalizedEvent, 'id');
          if (clientEvents.length > LAN_NETWORK_LIMITS.socketQueueMaxPending * 2) {
            clientEvents = clientEvents.slice(-LAN_NETWORK_LIMITS.socketQueueMaxPending * 2);
          }
          if (alreadyKnown) {
            duplicateCount += 1;
            if (!shouldRenotifyKnownClientEvent(normalizedEvent)) continue;
            renotifiedCount += 1;
          }
          notifiedCount += 1;
          notifyClientUpdates({ reason: 'resync_events', event: normalizedEvent, envelopeType: 'resync_events' });
          scheduleCriticalClientEventReplay(normalizedEvent, 'resync_events');
        }
        if (notifiedCount > 0 || duplicateCount > 0) {
          traceApp('RESYNC_RECEIVED', 'RESYNC_EVENTS_BUFFERED_BATCH', {
            source: 'lanTcpTransport.resync_events',
            sessionId: message.sessionId,
            receivedCount: orderedEvents.length,
            notifiedCount,
            duplicateCount,
            renotifiedCount,
          });
        }
        if (message.payload) {
          applyPayloadUpdate(message.payload, { notify: true });
        }
        return;
      }

      if (message.type === 'event' || message.type === 'event_commit') {
        if (target.sessionId && message.event.sessionId !== target.sessionId) return;
        const normalizedEvent = normalizeWireEvent(message.event);
        const alreadyKnown = Boolean(normalizedEvent.id && clientEvents.some((entry) => entry.id === normalizedEvent.id));
        upsertByKey(clientEvents, normalizedEvent, 'id');
        if (clientEvents.length > LAN_NETWORK_LIMITS.socketQueueMaxPending * 2) {
          clientEvents = clientEvents.slice(-LAN_NETWORK_LIMITS.socketQueueMaxPending * 2);
        }
        const shouldNotify = !alreadyKnown || shouldRenotifyKnownClientEvent(normalizedEvent);
        if (shouldNotify) {
          if (alreadyKnown) {
            traceApp('SOCKET_RECEIVE', 'TCP_CLIENT_KNOWN_EVENT_RENOTIFY', {
              source: 'lanTcpTransport.event_commit',
              sessionId: normalizedEvent.sessionId,
              eventType: normalizedEvent.type,
              eventId: normalizedEvent.id,
              envelopeType: message.type,
              seq: normalizedEvent.seq,
              entityId: getLanEventEntityId(normalizedEvent),
              entityType: getLanEventEntityType(normalizedEvent),
            });
          }
          notifyClientUpdates({ reason: 'event_commit', event: normalizedEvent, envelopeType: message.type });
          scheduleCriticalClientEventReplay(normalizedEvent, message.type);
        }
      }
    });
  }).finally(() => {
    clientConnectPromise = null;
  });

  return clientConnectPromise;
}

function loadTcpSocket() {
  if (tcpModule !== undefined) {
    if (!tcpModule) throw new Error('react-native-tcp-socket nao esta disponivel neste build.');
    return tcpModule;
  }

  try {
    if (!NativeModules.TcpSockets) {
      throw new Error('Modulo TCP nativo indisponivel. Recompile e reinstale o dev build Android.');
    }

    const loaded = require('react-native-tcp-socket');
    tcpModule = (loaded.default || loaded) as TcpSocketModule;
    if (!tcpModule?.createServer || !tcpModule?.createConnection) {
      throw new Error('Modulo TCP sem API esperada.');
    }
    return tcpModule;
  } catch (error) {
    tcpModule = null;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function fetchLanTcpProbePayload(host: string, timeoutMs: number) {
  const TcpSocket = loadTcpSocket();

  return new Promise<LanSessionPayload | null>((resolve) => {
    let settled = false;
    let socket: TcpSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (payload: LanSessionPayload | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // Probe connection already closed.
      }
      resolve(payload);
    };

    try {
      socket = TcpSocket.createConnection({
        host,
        port: LAN_TCP_PORT,
        reuseAddress: true,
        connectTimeout: timeoutMs,
      }, () => {
        if (!socket) return;
        configureSocket(socket);
        sendEnvelope(socket, { type: 'hello' });
      });

      timer = setTimeout(() => finish(null), timeoutMs);
      socket.on('error', () => finish(null));
      socket.on('close', () => finish(null));

      createLineReader(socket, (message) => {
        if (message.type === 'session_snapshot' || message.type === 'payload_update') {
          finish(message.payload);
        }
        if (message.type === 'session_rejected') {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}


function makeSyntheticSessionStatusEvent(payload: LanSessionPayload, status: string): LanSessionEvent | null {
  const sessionId = String(payload.session?.id || '');
  if (!sessionId) return null;
  const now = new Date().toISOString();
  const seq = Date.now();
  if (status === 'ended') {
    return normalizeWireEvent({
      id: `synthetic_session_ended_${sessionId}`,
      sessionId,
      type: 'session_ended',
      fromKey: 'master',
      fromName: payload.session?.masterName || 'Mestre',
      toKey: 'all',
      toName: 'Todos',
      entityType: 'session',
      entityId: sessionId,
      entityRevision: seq,
      seq,
      serverSeq: seq,
      ackRequired: true,
      sessionEnded: {
        endedAt: now,
        reason: 'payload_status_ended',
        unlinkPlayers: true,
        allowOfflineAfterEnd: true,
      },
      message: 'Sessao encerrada pelo mestre.',
      createdAt: now,
    });
  }
  // v39: pausa/continuação não podem nascer de payload/snapshot sintético.
  // O payload é cache estrutural e pode chegar atrasado; se ele gerar session_patch,
  // o jogador alterna entre active/paused mesmo depois do evento real.
  // Somente eventos session_patch oficiais do mestre mudam active/paused.
  return null;
}

function makeHostPayload() {
  if (!hostPayload) throw new Error('Host TCP sem payload.');

  // IMPORTANTE:
  // Nao misture hostJoinedRows no payload oficial.
  // hostJoinedRows e apenas uma fila/memoria de JOIN recebido pelo TCP.
  // O jogador so deve entrar em payload.state.players depois que a tela do mestre
  // consumir essa fila, gravar em lan_session_players no SQLite e chamar
  // syncLanSessionPayload/updateLanTcpHostPayload.
  //
  // Se o JOIN provisório for injetado aqui, todos os clientes recebem um player
  // incompleto, muitas vezes com HP 0/0, XP 0 e moedas 0. Isso causa piscada,
  // overwrite de ficha boa por snapshot ruim e pode derrubar o app do jogador.
  return {
    ...hostPayload,
    events: mergeRecentEvents(hostPayload.events || [], hostEvents),
  };
}

export function subscribeLanTcpHostUpdates(listener: (update?: HostUpdate) => void) {
  hostUpdateListeners.add(listener);
  return () => {
    hostUpdateListeners.delete(listener);
  };
}

export function subscribeLanTcpClientUpdates(listener: (update?: ClientUpdate) => void) {
  clientUpdateListeners.add(listener);
  return () => {
    clientUpdateListeners.delete(listener);
  };
}

function notifyHostUpdates(update?: HostUpdate) {
  for (const listener of hostUpdateListeners) {
    listener(update);
  }
}

function notifyClientUpdates(update?: ClientUpdate) {
  for (const listener of clientUpdateListeners) {
    listener(update);
  }
}

function broadcastHostPayload() {
  if (!hostPayload) return;
  const payload = makeHostPayload();
  const signature = [
    payload.session.id,
    payload.state?.status || 'active',
    payload.state?.players?.length || 0,
    payload.state?.currentTurn || 0,
    payload.state?.elapsedMinutes || 0,
  ].join(':');
  const now = Date.now();
  const lifecycleChanged = signature !== lastHostPayloadBroadcastSignature;
  if (!lifecycleChanged && now - lastHostPayloadBroadcastAt < 3000) return;
  lastHostPayloadBroadcastAt = now;
  lastHostPayloadBroadcastSignature = signature;
  broadcastEnvelope({ type: 'payload_update', payload });
}

function updateHostForegroundSession() {
  if (!hostPayload || !hostUrl) return;

  try {
    const payload = makeHostPayload();
    const status = payload.state?.status || 'active';
    if (status !== 'active') {
      void LanNative?.stopForegroundSession?.().catch(() => {});
      return;
    }

    if (!LanNative?.updateForegroundSession) return;
    void LanNative.updateForegroundSession(
      payload.session.name || 'Mesa LAN',
      payload.session.inviteCode || '',
      hostUrl,
      payload.state?.players?.length || 0
    ).catch(() => {});
  } catch {
    // Foreground notification is best-effort; payload sync keeps running.
  }
}

function broadcastEnvelope(message: TcpEnvelope) {
  const sockets = getHostSocketsForEnvelope(message);
  for (const socket of sockets) {
    enqueueHostEnvelope(socket, message);
  }
}


function registerHostConnection(socket: TcpSocket) {
  if (hostConnections.has(socket)) return hostConnections.get(socket)!;
  const connection: HostConnection = {
    socket,
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    lastAckSeq: 0,
    queue: [],
    sending: false,
  };
  hostConnections.set(socket, connection);
  return connection;
}

function touchHostConnection(socket: TcpSocket) {
  const connection = registerHostConnection(socket);
  connection.lastSeenAt = Date.now();
  return connection;
}

function bindHostConnection(socket: TcpSocket, info?: { playerKey?: string; clientId?: string; playerName?: string }) {
  const connection = touchHostConnection(socket);
  if (info?.playerName) connection.playerName = info.playerName;

  if (info?.playerKey && info.playerKey !== 'master' && info.playerKey !== 'party' && info.playerKey !== 'session' && info.playerKey !== 'all') {
    if (connection.playerKey && connection.playerKey !== info.playerKey) {
      removeSocketFromIndex(hostSocketsByPlayerKey, connection.playerKey, socket);
    }
    connection.playerKey = info.playerKey;
    addSocketToIndex(hostSocketsByPlayerKey, info.playerKey, socket);
  }

  if (info?.clientId) {
    if (connection.clientId && connection.clientId !== info.clientId) {
      removeSocketFromIndex(hostSocketsByClientId, connection.clientId, socket);
    }
    connection.clientId = info.clientId;
    addSocketToIndex(hostSocketsByClientId, info.clientId, socket);
  }

  return connection;
}

function unregisterHostConnection(socket: TcpSocket) {
  const connection = hostConnections.get(socket);
  if (!connection) return;
  if (connection.playerKey) removeSocketFromIndex(hostSocketsByPlayerKey, connection.playerKey, socket);
  if (connection.clientId) removeSocketFromIndex(hostSocketsByClientId, connection.clientId, socket);
  hostConnections.delete(socket);
  hostSockets.delete(socket);
}

function addSocketToIndex(index: Map<string, Set<TcpSocket>>, key: string, socket: TcpSocket) {
  const existing = index.get(key) || new Set<TcpSocket>();
  existing.add(socket);
  index.set(key, existing);
}

function removeSocketFromIndex(index: Map<string, Set<TcpSocket>>, key: string, socket: TcpSocket) {
  const existing = index.get(key);
  if (!existing) return;
  existing.delete(socket);
  if (existing.size <= 0) index.delete(key);
}

function getHostSocketsForEnvelope(message: TcpEnvelope) {
  if (message.type !== 'event_commit' && message.type !== 'event') {
    return [...hostSockets];
  }

  const event = message.event;
  if (!event) return [...hostSockets];
  const audience = getLanEventAudience(event);
  if (audience === 'none' || audience === 'master') return [];
  if (isBroadcastLanEvent(event)) return [...hostSockets];

  const targets = new Set<TcpSocket>();
  for (const key of getLanEventRoutingKeys(event)) {
    for (const socket of hostSocketsByPlayerKey.get(key) || []) targets.add(socket);
  }

  if (targets.size <= 0 && audience === 'participants') {
    // Safety net for trade/send-item during reconnect: do not leak private patches,
    // but allow participant events to be picked up by the right client on resync.
    return [];
  }

  return [...targets];
}


function getEnvelopePriority(message: TcpEnvelope) {
  if (message.type === 'event_commit' || message.type === 'event') {
    const eventType = message.event?.type;
    if (eventType === 'session_ended') return 100;
    if (eventType === 'session_patch' || eventType === 'player_kicked') return 98;
    if (eventType === 'player_patch' || eventType === 'effect_patch' || eventType === 'inventory_patch' || eventType === 'pending_save_patch') return 97;
    if (eventType === 'player_progression_patch') return 96;
    if (eventType === 'send_item_result' || eventType === 'trade_result' || eventType === 'send_item_request' || String(eventType || '').startsWith('trade_')) return 95;
    if (eventType === 'public_status') return 92;
    return 40;
  }
  if (message.type === 'resync_events') return 30;
  if (message.type === 'session_snapshot' || message.type === 'payload_update') return 10;
  return 0;
}

function shouldRenotifyKnownClientEvent(event: LanSessionEvent) {
  const eventType = event.type;
  return (
    eventType === 'inventory_patch' ||
    eventType === 'player_patch' ||
    eventType === 'player_progression_patch' ||
    eventType === 'effect_patch' ||
    eventType === 'pending_save_patch' ||
    eventType === 'session_patch' ||
    eventType === 'session_ended' ||
    eventType === 'player_kicked' ||
    eventType === 'send_item_result' ||
    eventType === 'trade_result' ||
    eventType === 'public_status'
  );
}

function enqueueHostEnvelope(socket: TcpSocket, message: TcpEnvelope) {
  const connection = registerHostConnection(socket);
  if (message.type === 'session_snapshot' || message.type === 'payload_update') {
    connection.queue = connection.queue.filter((queued) => queued.type !== 'session_snapshot' && queued.type !== 'payload_update');
  }
  if (connection.queue.length >= LAN_NETWORK_LIMITS.socketQueueMaxPending) {
    connection.queue.shift();
    traceSocket('SOCKET_QUEUE_DROPPED_OLDEST', {
      source: 'lanTcpTransport.enqueueHostEnvelope',
      decision: 'queue_limit',
      queueSize: connection.queue.length,
      ...getEnvelopeTraceFields(message),
      connectionPlayerKey: connection.playerKey,
    });
  }
  const priority = getEnvelopePriority(message);
  if (priority > 0) {
    const insertAt = connection.queue.findIndex((queued) => getEnvelopePriority(queued) < priority);
    if (insertAt >= 0) connection.queue.splice(insertAt, 0, message);
    else connection.queue.push(message);
  } else {
    connection.queue.push(message);
  }
  flushHostConnectionQueue(connection);
}

function flushHostConnectionQueue(connection: HostConnection) {
  if (connection.sending) return;
  connection.sending = true;

  const flushNext = () => {
    if (!hostConnections.has(connection.socket) || closedSockets.has(connection.socket)) {
      connection.queue = [];
      connection.sending = false;
      return;
    }

    const next = connection.queue.shift();
    if (!next) {
      connection.sending = false;
      return;
    }

    sendEnvelope(connection.socket, next);
    setTimeout(flushNext, 0);
  };

  flushNext();
}

function sendEnvelope(socket: TcpSocket, message: TcpEnvelope) {
  const startedAt = Date.now();
  const traceFields = getEnvelopeTraceFields(message);
  const traceThisEnvelope = shouldTraceLanEnvelope(message.type, 'event' in message ? message.event?.type : undefined);

  if (closedSockets.has(socket)) {
    if (traceThisEnvelope) {
      traceSocket('SOCKET_SEND_SKIPPED_CLOSED', {
        source: 'lanTcpTransport.sendEnvelope',
        decision: 'socket_already_closed',
        ...traceFields,
      });
    }
    return false;
  }

  if (traceThisEnvelope) {
    traceSocket('SOCKET_SEND_START', {
      source: 'lanTcpTransport.sendEnvelope',
      ...traceFields,
    });
  }

  try {
    socket.write(`${JSON.stringify(message)}\n`);
    if (traceThisEnvelope) {
      traceSocket('SOCKET_SEND_DONE', {
        source: 'lanTcpTransport.sendEnvelope',
        durationMs: Date.now() - startedAt,
        ...traceFields,
      });
    }
    return true;
  } catch (error) {
    if (traceThisEnvelope) {
      traceError('SOCKET_SEND_START', 'SOCKET_SEND_ERROR', error, {
        source: 'lanTcpTransport.sendEnvelope',
        durationMs: Date.now() - startedAt,
        ...traceFields,
      });
    }
    try {
      socket.destroy();
    } catch {
      // socket já estava morto
    }

    closedSockets.add(socket);
    unregisterHostConnection(socket);

    if (clientSocket === socket) {
      clientSocket = null;
    }

    return false;
  }
}

function createLineReader(socket: TcpSocket, onMessage: (message: TcpEnvelope) => void) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed) as TcpEnvelope;
        const traceThisEnvelope = shouldTraceLanEnvelope(message.type, 'event' in message ? message.event?.type : undefined);
        if (traceThisEnvelope) {
          traceSocket('SOCKET_RECEIVE', {
            source: 'lanTcpTransport.createLineReader',
            ...getEnvelopeTraceFields(message),
          });
        }
        traceSemanticEnvelopeReceive(message);
        onMessage(message);
      } catch (error) {
        traceError('SOCKET_RECEIVE', 'SOCKET_RECEIVE_PARSE_ERROR', error, {
          source: 'lanTcpTransport.createLineReader',
          payload: { rawLength: trimmed.length, rawStart: trimmed.slice(0, 180) },
        });
        // Ignore malformed LAN frames instead of killing the session.
      }
    }
  });
}

function traceSemanticEnvelopeReceive(message: TcpEnvelope) {
  if (!shouldTraceLanEnvelope(message.type, 'event' in message ? message.event?.type : undefined)) return;
  const fields = getEnvelopeTraceFields(message);
  if (message.type === 'session_snapshot') {
    if (!shouldTraceRepeatedStructuralEnvelope(message, fields)) return;
    traceApp('SNAPSHOT_RECEIVED', 'SESSION_SNAPSHOT_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
    });
    return;
  }
  if (message.type === 'payload_update') {
    if (!shouldTraceRepeatedStructuralEnvelope(message, fields)) return;
    traceApp('PAYLOAD_RECEIVED', 'PAYLOAD_UPDATE_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
    });
    return;
  }
  if (message.type === 'resync_request') {
    traceApp('RESYNC_REQUEST', 'RESYNC_REQUEST_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
    });
    return;
  }
  if (message.type === 'resync_events') {
    traceApp('RESYNC_RECEIVED', 'RESYNC_EVENTS_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
      result: {
        eventCount: message.events?.length || 0,
        orderedSeqs: [...(message.events || [])].sort(compareEventsAscending).map((event) => event.seq ?? event.serverSeq).slice(0, 40),
      },
    });
    return;
  }
  if (message.type === 'event_ack' || message.type === 'event_nack' || message.type === 'ack') {
    traceApp('EVENT_RECEIVED', 'ACK_OR_NACK_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
    });
    return;
  }
  if (message.type === 'event' || message.type === 'event_commit' || message.type === 'event_propose') {
    if (message.event?.type === 'public_status') {
      traceApp('PUBLIC_STATUS_RECEIVED', 'PUBLIC_STATUS_RECEIVED', {
        source: 'lanTcpTransport.createLineReader',
        ...fields,
      });
      return;
    }
    traceApp('EVENT_RECEIVED', 'LAN_EVENT_ENVELOPE_RECEIVED', {
      source: 'lanTcpTransport.createLineReader',
      ...fields,
    });
  }
}

function shouldTraceRepeatedStructuralEnvelope(message: TcpEnvelope, fields: Record<string, any>) {
  if (message.type !== 'session_snapshot' && message.type !== 'payload_update') return true;
  const payload = 'payload' in message ? message.payload : undefined;
  const signature = [
    message.type,
    fields.sessionId || '',
    payload?.state?.players?.length || 0,
    payload?.events?.length || 0,
    payload?.state?.status || '',
    payload?.state?.currentTurn || 0,
    payload?.state?.elapsedMinutes || 0,
  ].join(':');
  const key = `${message.type}:${fields.sessionId || ''}`;
  const now = Date.now();
  const previous = semanticTraceThrottle.get(key);
  if (previous && previous.signature === signature && now - previous.at < SEMANTIC_TRACE_THROTTLE_MS) {
    return false;
  }
  semanticTraceThrottle.set(key, { at: now, signature });
  if (semanticTraceThrottle.size > 40) {
    const cutoff = now - SEMANTIC_TRACE_THROTTLE_MS * 4;
    for (const [entryKey, entry] of semanticTraceThrottle) {
      if (entry.at < cutoff) semanticTraceThrottle.delete(entryKey);
    }
  }
  return true;
}

function getEnvelopeTraceFields(message: TcpEnvelope) {
  const event = 'event' in message ? message.event : undefined;
  const payload = 'payload' in message ? message.payload : undefined;

  return {
    envelopeType: message.type,
    sessionId: getEnvelopeSessionId(message, event, payload),
    eventId: event?.id,
    eventType: event?.type,
    seq: event?.seq,
    serverSeq: event?.serverSeq,
    entityType: event?.entityType,
    entityId: event?.entityId,
    entityRevision: event?.entityRevision,
    fromKey: event?.fromKey,
    toKey: event?.toKey,
    playerKey: 'playerKey' in message ? message.playerKey : undefined,
    reason: 'reason' in message ? message.reason : undefined,
    payload: summarizeEnvelopePayload(message, event, payload),
    patch: event?.numberPatch || event?.effectPatch || event?.inventoryPatch,
  };
}

function getEnvelopeSessionId(message: TcpEnvelope, event?: LanSessionEvent, payload?: LanSessionPayload) {
  if (event?.sessionId) return event.sessionId;
  if (payload?.session?.id) return payload.session.id;
  if ('sessionId' in message && message.sessionId) return String(message.sessionId);
  return hostPayload?.session.id || '';
}

function summarizeEnvelopePayload(message: TcpEnvelope, event?: LanSessionEvent, payload?: LanSessionPayload) {
  if (event) {
    return {
      id: event.id,
      type: event.type,
      message: event.message,
      numberPatch: event.numberPatch,
      effectPatch: event.effectPatch
        ? {
          targetKey: event.effectPatch.targetKey,
          addCount: event.effectPatch.add?.length || 0,
          updateCount: event.effectPatch.update?.length || 0,
          removeCount: event.effectPatch.remove?.length || 0,
        }
        : undefined,
      publicState: event.publicState,
      resourceKind: event.resourceRequest?.kind,
    };
  }

  if (payload) {
    return {
      sessionId: payload.session.id,
      sessionName: payload.session.name,
      playerCount: payload.state?.players?.length || 0,
      eventCount: payload.events?.length || 0,
      status: payload.state?.status,
      currentTurn: payload.state?.currentTurn,
      elapsedMinutes: payload.state?.elapsedMinutes,
    };
  }

  if (message.type === 'resync_events') {
    return {
      eventCount: message.events?.length || 0,
      eventSeqs: (message.events || []).map((item) => item.seq ?? item.serverSeq).slice(0, 20),
      hasPayload: Boolean(message.payload),
    };
  }

  if (message.type === 'join') {
    return {
      sessionId: String(message.entry?.sessionId || ''),
      remoteKey: String(message.entry?.remoteKey || ''),
      clientId: String(message.entry?.clientId || ''),
      playerName: String(message.entry?.playerName || ''),
    };
  }

  return message;
}


function summarizePlayerForPublicStatus(player: any) {
  const effects = Array.isArray(player?.effects) ? player.effects : [];
  return {
    hpCurrent: Math.max(0, Math.floor(Number(player?.hpCurrent ?? player?.hp_current ?? 0) || 0)),
    hpMax: Math.max(0, Math.floor(Number(player?.hpMax ?? player?.hp_max ?? 0) || 0)),
    tempHp: Math.max(0, Math.floor(Number(player?.tempHp ?? player?.temp_hp ?? 0) || 0)),
    level: Math.max(1, Math.floor(Number(player?.level ?? 1) || 1)),
    effects: effects
      .filter((effect: any) => effect?.visibleToPlayer !== false)
      .filter((effect: any) => {
        const kind = String(effect?.kind || '').toLowerCase();
        const status = String(effect?.status || effect?.statusKey || '').trim();
        const target = String(effect?.target || '').toUpperCase();
        return Boolean(status) || kind === 'status' || kind === 'temp_hp' || target === 'PV_TEMP';
      })
      .map((effect: any) => ({
        id: effect.id,
        name: effect.name || effect.status || effect.statusKey || 'Efeito',
        status: effect.status,
        statusKey: effect.statusKey,
        remaining: effect.remaining,
        unit: effect.unit,
        color: effect.color,
        secondaryColor: effect.secondaryColor,
        publicNote: effect.publicNote,
      })),
  };
}

function makePublicPlayerJoinedEvent(base: LanSessionEvent, payload: LanSessionPayload): LanSessionEvent {
  const player = (payload.state?.players || []).find((entry: any) => (
    (base.fromKey && entry.remoteKey === base.fromKey) ||
    (base.fromName && entry.characterName === base.fromName)
  ));
  const now = new Date().toISOString();
  const seq = Date.now();
  return normalizeWireEvent({
    ...base,
    id: `${base.id}_public`,
    seq,
    serverSeq: seq,
    toKey: 'session',
    toName: 'Sessao',
    entityType: 'session',
    entityId: base.sessionId,
    entityRevision: seq,
    ackRequired: false,
    publicState: summarizePlayerForPublicStatus(player || {}),
    message: base.message || `${base.fromName} entrou na sessao.`,
    createdAt: base.createdAt || now,
  });
}

function configureSocket(socket: TcpSocket) {
  socket.setNoDelay?.(true);
  socket.setKeepAlive?.(true, 1000);
  socket.on('close', () => {
    closedSockets.add(socket);
    unregisterHostConnection(socket);
    if (clientSocket === socket) {
      clientSocket = null;
      clearClientPayloadWaiters();
      stopClientHeartbeat();
      traceApp('SOCKET_RECEIVE', 'TCP_CLIENT_SOCKET_CLOSED_CLEANUP', {
        source: 'lanTcpTransport.configureSocket',
        sessionId: clientPayload?.session.id || '',
        decision: 'client_socket_closed',
      });
      notifyClientUpdates({ reason: 'socket_closed' });
    }
  });
  socket.on('error', () => {
    closedSockets.add(socket);
    unregisterHostConnection(socket);
  });
}

function mergeClientPayloadEvents(payload: LanSessionPayload, sessionId?: string) {
  for (const event of payload.events || []) {
    if (sessionId && event.sessionId !== sessionId) continue;
    // Payload events are history. Stateful patches are represented by the
    // payload snapshot/checkpoints and must not pre-mark the live socket event
    // as alreadyKnown before the event_commit notification reaches the hook.
    if (isStateReplayCoveredByCheckpoint(event)) continue;
    upsertByKey(clientEvents, event, 'id');
  }
}

function normalizeJoinCharacter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function mergeRecentEvents(...eventLists: LanSessionEvent[][]) {
  const eventsById = new Map<string, LanSessionEvent>();

  for (const events of eventLists) {
    for (const event of events) {
      if (!event?.id) continue;
      eventsById.set(event.id, normalizeWireEvent(event));
    }
  }

  return [...eventsById.values()]
    .sort((a, b) => getEventTimestamp(b) - getEventTimestamp(a))
    .slice(0, 80);
}

function normalizeWireEvent(event: LanSessionEvent): LanSessionEvent {
  const entityType = (event as any).entityType || inferWireEventEntityType(event);
  const entityId = String((event as any).entityId || inferWireEventEntityId(event) || event.sessionId);
  const seq = Number.isFinite(Number(event.seq)) && Number(event.seq) > 0
    ? Number(event.seq)
    : Number.isFinite(Number(event.serverSeq)) && Number(event.serverSeq) > 0
      ? Number(event.serverSeq)
      : Math.max(1, getEventTimestamp(event));
  const entityRevision = Number.isFinite(Number((event as any).entityRevision)) && Number((event as any).entityRevision) > 0
    ? Number((event as any).entityRevision)
    : seq;

  return {
    ...event,
    seq,
    serverSeq: event.serverSeq ?? seq,
    entityType,
    entityId,
    entityRevision,
    ackRequired: (event as any).ackRequired ?? shouldWireEventRequireAck(event),
  } as LanSessionEvent;
}

function inferWireEventEntityType(event: LanSessionEvent) {
  return getLanEventEntityType(event);
}

function inferWireEventEntityId(event: LanSessionEvent) {
  return getLanEventEntityId(event);
}

function shouldWireEventRequireAck(event: LanSessionEvent) {
  return shouldLanEventRequireAck(event);
}

function rememberHostKickedJoinKeys(sessionId: string, remoteKey?: string, clientId?: string) {
  for (const key of makeHostJoinBlockKeys(sessionId, remoteKey, clientId)) {
    hostKickedJoinKeys.add(key);
  }
}

function isHostJoinBlocked(sessionId: string, remoteKey?: string, clientId?: string) {
  return makeHostJoinBlockKeys(sessionId, remoteKey, clientId).some((key) => hostKickedJoinKeys.has(key));
}

function makeHostJoinBlockKeys(sessionId: string, remoteKey?: string, clientId?: string) {
  const keys: string[] = [];
  if (sessionId && remoteKey) keys.push(`${sessionId}:remote:${remoteKey}`);
  if (sessionId && clientId) keys.push(`${sessionId}:client:${clientId}`);
  return keys;
}

function getEventsAfterSeq(seq: number, sessionId?: string) {
  // Resync não deve despejar todo histórico de patches vivos no jogador.
  // HP/moeda/inventário/efeitos são estados autoritativos e voltam por checkpoint.
  // Reenviar todos os inventory_patch antigos foi a causa de 900/2000 logs e itens piscando.
  return mergeRecentEvents(hostPayload?.events || [], hostEvents)
    .filter((event) => (!sessionId || event.sessionId === sessionId) && (getEventSeq(event) <= 0 || getEventSeq(event) > seq))
    .filter((event) => !isStateReplayCoveredByCheckpoint(event))
    .sort(compareEventsAscending);
}

function getColdStartResyncEvents(sessionId?: string) {
  // Quando um jogador reabre a ficha ou entra tarde na mesa, nao faça replay de
  // todo historico vivo (HP, efeito e inventario). Esses estados sao cobertos por
  // checkpoints autoritativos em getEventsForRevisionGaps. Mantemos apenas eventos
  // de fluxo que ainda podem precisar aparecer na UI, como propostas de troca.
  return mergeRecentEvents(hostPayload?.events || [], hostEvents)
    .filter((event) => !sessionId || event.sessionId === sessionId)
    .filter((event) => !isStateReplayCoveredByCheckpoint(event))
    .slice(-20)
    .sort(compareEventsAscending);
}

function isStateReplayCoveredByCheckpoint(event: LanSessionEvent) {
  if (event.type === 'session_patch') return true;
  if (event.type === 'player_patch') return true;
  if (event.type === 'coin_self_patch_request') return true;
  if (event.type === 'effect_patch' || event.type === 'effect_expired') return true;
  if (event.type === 'inventory_patch') return true;
  if (event.type === 'pending_save_patch') return true;
  if (event.type === 'public_status') return true;
  if (event.type === 'timeline_event') return true;
  return false;
}

function getEventsForRevisionGaps(sessionId: string | undefined, knownRevisions: Record<string, number>) {
  const events = mergeRecentEvents(hostPayload?.events || [], hostEvents)
    .filter((event) => !sessionId || event.sessionId === sessionId);

  // IMPORTANTE:
  // Resync por divergência de entityRevision NÃO pode fazer replay de eventos antigos.
  // Eventos antigos de effect_patch/effect_save_result/inventory_patch são ações, não checkpoints.
  // Reaplicá-los foi a causa de efeitos expirados voltarem, PV temporário persistir e histórico duplicar.
  const latestRevisionByEntity = new Map<string, number>();
  for (const event of events) {
    // v55: propostas/eventos nativos do jogador usam Date.now() como entityRevision.
    // Se isso entrar no checkpoint, um inventario antigo vira revision gigante e
    // sobrescreve o patch autoritativo do mestre (troca/doacao parece acontecer, mas volta).
    const isAuthoritativeRevision = event.fromKey === 'master'
      || event.originClientId === 'master'
      || event.fromKey === 'session';
    if (!isAuthoritativeRevision) continue;
    const revision = Number(event.entityRevision || 0);
    if (revision <= 0 || revision > 1000000) continue;
    const entityKey = getRuntimeEntityKey(event);
    latestRevisionByEntity.set(entityKey, Math.max(latestRevisionByEntity.get(entityKey) || 0, revision));
  }

  const checkpointEvents: LanSessionEvent[] = [];
  const now = Date.now();
  let syntheticSeq = Math.max(now, ...events.map((event) => getEventSeq(event)), 0) + 1;

  const currentPlayers = hostPayload?.state?.players || [];
  for (const player of currentPlayers) {
    const targetKey = String(player.remoteKey || player.characterName || player.id || '');
    if (!targetKey) continue;

    const effectEntityKey = `${player.sessionId || sessionId}:effect:${targetKey}`;
    // v32: efeito tem revisão própria. Não use player.revisionSeq como fallback,
    // senão qualquer dano/XP gera checkpoint de efeito novamente no resync.
    const rawLatestEffectRevision = Math.max(
      latestRevisionByEntity.get(effectEntityKey) || 0,
      0,
    );
    const latestEffectRevision = rawLatestEffectRevision > 1000000 ? 0 : rawLatestEffectRevision;
    const knownEffectRevision = Number(knownRevisions[effectEntityKey] || 0);
    if (latestEffectRevision > 0 && knownEffectRevision < latestEffectRevision) {
      const seq = syntheticSeq++;
      const checkpoint: LanSessionEvent = {
        id: `checkpoint_effect_${targetKey}_${latestEffectRevision}_${seq}`,
        sessionId: String(player.sessionId || sessionId || ''),
        type: 'effect_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: targetKey,
        toName: String(player.characterName || player.playerName || targetKey),
        entityType: 'effect',
        entityId: targetKey,
        entityRevision: latestEffectRevision,
        seq,
        serverSeq: seq,
        ackRequired: false,
        originClientId: 'master',
        effectPatch: {
          targetKey,
          replace: true,
          add: Array.isArray(player.effects) ? player.effects as any : [],
          update: [],
          remove: [],
        },
        message: 'Checkpoint de efeitos ativos.',
        createdAt: new Date().toISOString(),
      };
      traceApp('RESYNC_RECEIVED', 'RESYNC_EFFECT_CHECKPOINT_CREATED', {
        source: 'lanTcpTransport.getEventsForRevisionGaps',
        sessionId: checkpoint.sessionId,
        player: targetKey,
        entityRevision: latestEffectRevision,
        before: { knownRevision: knownEffectRevision },
        effectCount: checkpoint.effectPatch?.add?.length || 0,
        decision: 'send_checkpoint_replace',
      });
      checkpointEvents.push(checkpoint);
    }

    const playerEntityKey = `${player.sessionId || sessionId}:player:${targetKey}`;
    // v33: NUNCA use player.revisionSeq como revision de player_patch.
    // revision_seq da tabela também sobe em join/equip/inventário e pode ser Date.now() em runtime,
    // fazendo checkpoints com revisão gigantesca bloquearem danos reais revision=1..N no jogador.
    // Para HP/XP/moedas/PV temp, a revision confiável é a maior revision dos eventos player_patch já criados.
    const rawLatestPlayerRevision = latestRevisionByEntity.get(playerEntityKey) || 0;
    // v34: if an old build stored a Date.now() value as player revision, never create
    // a player checkpoint from it. It would poison the client again and make XP/HP/level
    // events with normal revisions look stale.
    const latestPlayerRevision = rawLatestPlayerRevision > 1000000 ? 0 : rawLatestPlayerRevision;
    const knownPlayerRevision = Number(knownRevisions[playerEntityKey] || 0);
    if (latestPlayerRevision > 0 && knownPlayerRevision < latestPlayerRevision) {
      const seq = syntheticSeq++;
      checkpointEvents.push({
        id: `checkpoint_player_${targetKey}_${latestPlayerRevision}_${seq}`,
        sessionId: String(player.sessionId || sessionId || ''),
        type: 'player_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: targetKey,
        toName: String(player.characterName || player.playerName || targetKey),
        entityType: 'player',
        entityId: targetKey,
        entityRevision: latestPlayerRevision,
        seq,
        serverSeq: seq,
        ackRequired: false,
        originClientId: 'master',
        numberPatch: {
          hpCurrent: Number(player.hpCurrent || 0),
          hpMax: Number(player.hpMax || 0),
          tempHp: Number(player.tempHp || 0),
          xp: Number(player.xp || 0),
          gp: Number(player.gp || 0),
          sp: Number(player.sp || 0),
          cp: Number(player.cp || 0),
        },
        message: 'Checkpoint de recursos do jogador.',
        createdAt: new Date().toISOString(),
      });
    }

    const inventoryEntityKey = `${player.sessionId || sessionId}:inventory:${targetKey}`;
    // v32: inventário tem revisão própria. Não use player.revisionSeq como fallback,
    // senão todo patch de HP vira checkpoint de inventário e congestiona envio/troca.
    const rawLatestInventoryRevision = Math.max(
      latestRevisionByEntity.get(inventoryEntityKey) || 0,
      0,
    );
    const latestInventoryRevision = rawLatestInventoryRevision > 1000000 ? 0 : rawLatestInventoryRevision;
    const knownInventoryRevision = Number(knownRevisions[inventoryEntityKey] || 0);
    if (latestInventoryRevision > 0 && knownInventoryRevision < latestInventoryRevision) {
      const seq = syntheticSeq++;
      checkpointEvents.push({
        id: `checkpoint_inventory_${targetKey}_${latestInventoryRevision}_${seq}`,
        sessionId: String(player.sessionId || sessionId || ''),
        type: 'inventory_patch',
        fromKey: 'master',
        fromName: 'Mestre',
        toKey: targetKey,
        toName: String(player.characterName || player.playerName || targetKey),
        entityType: 'inventory',
        entityId: targetKey,
        entityRevision: latestInventoryRevision,
        seq,
        serverSeq: seq,
        ackRequired: false,
        originClientId: 'master',
        inventoryPatch: {
          targetKey,
          equipment: (player as any).equipment || { bag: [], slots: {} },
          reason: 'Checkpoint de inventario.',
          action: 'replace',
        },
        message: 'Checkpoint de inventario.',
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (checkpointEvents.length === 0) {
    traceApp('RESYNC_RECEIVED', 'RESYNC_REVISION_GAP_NO_REPLAY', {
      source: 'lanTcpTransport.getEventsForRevisionGaps',
      sessionId,
      knownRevisionCount: Object.keys(knownRevisions || {}).length,
      decision: 'no_history_replay',
    });
  }

  return checkpointEvents.sort(compareEventsAscending);
}

function mergeEventsById(...groups: LanSessionEvent[][]) {
  const byId = new Map<string, LanSessionEvent>();
  for (const event of groups.flat()) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort(compareEventsAscending);
}

function filterEventsForPlayer(
  events: LanSessionEvent[],
  options: { sessionId?: string; playerKey?: string; includeGlobal?: boolean },
) {
  return events.filter((event) => shouldReturnEventToClient(event, options));
}

function shouldReturnEventToClient(
  event: LanSessionEvent,
  options: { sessionId?: string; playerKey?: string; includeGlobal?: boolean },
) {
  if (options.sessionId && event.sessionId !== options.sessionId) return false;
  if (!options.playerKey) return true;
  return shouldPlayerProcessLanEvent(event, {
    sessionId: event.sessionId,
    selfKey: options.playerKey,
    includeGlobal: options.includeGlobal !== false,
  });
}

function getRuntimeEntityKey(event: LanSessionEvent) {
  const entityType = event.entityType || getLanEventEntityType(event);
  const entityId = event.entityId || getLanEventEntityId({ ...event, entityType });
  return `${event.sessionId}:${entityType}:${entityId}`;
}

function rememberHostAck(ack: Record<string, unknown>) {
  const eventId = String(ack.eventId || ack.clientMsgId || '');
  const playerKey = String(ack.playerKey || '');
  const key = `${String(ack.sessionId || '')}:${playerKey}:${eventId}:${String(ack.type || 'ack')}`;
  const existingIndex = hostEventAcks.findIndex((item) => String(item.__key || '') === key);
  const next = { ...ack, __key: key };
  if (existingIndex >= 0) hostEventAcks[existingIndex] = next;
  else hostEventAcks.unshift(next);
  hostEventAcks = hostEventAcks.slice(0, 300);
}

function getEventTimestamp(event: LanSessionEvent) {
  const timestamp = Date.parse(event.createdAt || '');
  if (Number.isFinite(timestamp)) return timestamp;
  return getEventSeq(event);
}

function getEventSeq(event: LanSessionEvent) {
  return Number(event.seq ?? event.serverSeq ?? 0) || 0;
}

function compareEventsAscending(a: LanSessionEvent, b: LanSessionEvent) {
  const seqDiff = getEventSeq(a) - getEventSeq(b);
  if (seqDiff !== 0) return seqDiff;
  return getEventTimestamp(a) - getEventTimestamp(b);
}

function closeClientSocket() {
  if (!clientSocket) {
    clearClientPayloadWaiters();
    stopClientHeartbeat();
    return;
  }
  try {
    clientSocket.destroy();
  } catch {
    // Socket already closed.
  }
  closedSockets.add(clientSocket);
  clientSocket = null;
  clientHelloBindingSignature = '';
  clearClientPayloadWaiters();
  stopClientHeartbeat();
}

function startClientHeartbeat(socket: TcpSocket, sessionId?: string) {
  stopClientHeartbeat();
  const tick = () => {
    if (clientSocket !== socket) {
      stopClientHeartbeat();
      return;
    }

    sendEnvelope(socket, {
      type: 'heartbeat',
      sessionId,
      sentAt: new Date().toISOString(),
    });

    const status = clientPayload?.state?.status;
    clientHeartbeatTimer = setTimeout(tick, getHeartbeatIntervalForSessionStatus(status));
  };

  clientHeartbeatTimer = setTimeout(tick, getHeartbeatIntervalForSessionStatus(clientPayload?.state?.status));
}

function stopClientHeartbeat() {
  if (!clientHeartbeatTimer) return;
  clearTimeout(clientHeartbeatTimer);
  clientHeartbeatTimer = null;
}

export function resetLanTcpClient() {
  closeClientSocket();
  clientUrl = '';
  clientPayload = null;
  clientEvents = [];
  clientConnectPromise = null;
  clientBoundPlayerKey = '';
  clientBoundLastAppliedSeq = 0;
  clientBoundKnownRevisions = undefined;
  clientHelloBindingSignature = '';
  clearClientPayloadWaiters();
  clearClientJoinAckWaiters(new Error('Cliente LAN resetado.'));
}

function requestClientSnapshot(sessionId?: string) {
  if (!clientSocket) return Promise.resolve<LanSessionPayload | null>(null);

  const socket = clientSocket;

  return new Promise<LanSessionPayload | null>((resolve) => {
    let settled = false;
    let waiter: ClientPayloadWaiter | null = null;

    const finish = (payload: LanSessionPayload | null) => {
      if (settled) return;
      settled = true;

      if (waiter) {
        clearTimeout(waiter.timer);
        clientPayloadWaiters.delete(waiter);
      }

      resolve(payload);
    };

    waiter = {
      sessionId,
      resolve: finish,
      timer: setTimeout(() => finish(null), 1800),
    };
    clientPayloadWaiters.add(waiter);

    if (!sendEnvelope(socket, { type: 'hello', sessionId })) {
      finish(null);
    }
  });
}

function resolveClientPayloadWaiters(payload: LanSessionPayload) {
  for (const waiter of [...clientPayloadWaiters]) {
    if (waiter.sessionId && waiter.sessionId !== payload.session.id) continue;

    clearTimeout(waiter.timer);
    clientPayloadWaiters.delete(waiter);
    waiter.resolve(payload);
  }
}

function clearClientPayloadWaiters() {
  for (const waiter of [...clientPayloadWaiters]) {
    clearTimeout(waiter.timer);
    clientPayloadWaiters.delete(waiter);
    waiter.resolve(null);
  }
}

function waitForJoinAck(sessionId: string, remoteKey?: string, clientId?: string) {
  let waiterRef: ClientJoinAckWaiter | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    waiterRef = {
      sessionId,
      remoteKey,
      clientId,
      resolve,
      reject,
      timer: setTimeout(() => {
        if (waiterRef) {
          clientJoinAckWaiters.delete(waiterRef);
        }
        reject(new Error('Tempo esgotado aguardando confirmação do mestre.'));
      }, 3500),
    };
    clientJoinAckWaiters.add(waiterRef);
  }) as Promise<void> & { __waiter?: ClientJoinAckWaiter };

  promise.__waiter = waiterRef || undefined;
  return promise;
}

function cancelJoinAckWaiter(promise: Promise<void> & { __waiter?: ClientJoinAckWaiter }) {
  if (!promise.__waiter) return;
  clearTimeout(promise.__waiter.timer);
  clientJoinAckWaiters.delete(promise.__waiter);
}

function resolveJoinAckWaiters(sessionId: string, remoteKey?: string, clientId?: string) {
  for (const waiter of [...clientJoinAckWaiters]) {
    if (waiter.sessionId !== sessionId) continue;
    if (waiter.remoteKey && remoteKey && waiter.remoteKey !== remoteKey) continue;
    if (waiter.clientId && clientId && waiter.clientId !== clientId) continue;
    clearTimeout(waiter.timer);
    clientJoinAckWaiters.delete(waiter);
    waiter.resolve();
  }
}

function rejectJoinAckWaiters(sessionId: string, reason: string) {
  for (const waiter of [...clientJoinAckWaiters]) {
    if (waiter.sessionId !== sessionId) continue;
    clearTimeout(waiter.timer);
    clientJoinAckWaiters.delete(waiter);
    waiter.reject(new Error(reason || 'Join rejeitado pelo mestre.'));
  }
}

function clearClientJoinAckWaiters(error = new Error('Conexao TCP fechada.')) {
  for (const waiter of [...clientJoinAckWaiters]) {
    clearTimeout(waiter.timer);
    clientJoinAckWaiters.delete(waiter);
    waiter.reject(error);
  }
}

async function getLocalIpAddress(options?: { allowHotspotFallback?: boolean; throwIfMissing?: boolean }) {
  const detectedIps = await getDetectedLanIps();
  const selectedIp = selectBestLanIp(detectedIps);

  if (selectedIp) {
    return selectedIp;
  }

  if (options?.allowHotspotFallback) {
    const fallbackIp = getLikelyHotspotHostIp();
    if (fallbackIp) {
      return fallbackIp;
    }
  }

  if (options?.throwIfMissing === false) {
    return '';
  }

  throw new Error(
    'Não encontrei um IP local válido. Conecte-se a um Wi-Fi ou ligue o roteador/hotspot antes de iniciar a sessão.'
  );
}

async function getDetectedLanIps() {
  const ips: string[] = [];

  const nativeIps = await LanNative?.getLocalIpv4Addresses?.().catch(() => []);
  if (Array.isArray(nativeIps)) {
    ips.push(...nativeIps);
  }

  const expoIp = await Network.getIpAddressAsync().catch(() => '');
  if (expoIp) {
    ips.push(expoIp);
  }

  return Array.from(new Set(ips.map((ip) => String(ip || '').trim()).filter(Boolean)));
}

function selectBestLanIp(ips: string[]) {
  const validIps = ips.filter(isUsableLanIp);
  const preferredPrefixes = [
    '192.168.',
    '10.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.20.',
    '172.21.',
    '172.22.',
    '172.23.',
    '172.24.',
    '172.25.',
    '172.26.',
    '172.27.',
    '172.28.',
    '172.29.',
    '172.30.',
    '172.31.',
  ];

  return (
    preferredPrefixes
      .map((prefix) => validIps.find((ip) => ip.startsWith(prefix)))
      .find(Boolean) ||
    validIps[0] ||
    ''
  );
}

function getCommonHotspotHostCandidates() {
  return [
    '192.168.43.1',   // Android hotspot comum
    '192.168.49.1',   // Wi-Fi Direct / alguns Androids
    '192.168.137.1',  // hotspot/compartilhamento comum no Windows
    '172.20.10.1',    // iPhone hotspot
    '192.168.0.1',
    '192.168.1.1',
  ];
}

function getLikelyHotspotHostIp() {
  return getCommonHotspotHostCandidates()[0] || '';
}

async function buildLanProbeHosts() {
  const detectedIps = await getDetectedLanIps();
  const localIp = selectBestLanIp(detectedIps);
  const hosts: string[] = [];

  const addHost = (host?: string) => {
    const normalized = String(host || '').trim();
    if (!normalized || normalized === '0.0.0.0' || normalized === '127.0.0.1') return;
    if (!hosts.includes(normalized)) hosts.push(normalized);
  };

  for (const host of getCommonHotspotHostCandidates()) {
    addHost(host);
  }

  if (localIp) {
    const parts = localIp.split('.');
    const emulatorHosts = /^10\.0\.[23]\.\d+$/.test(localIp) ? ['10.0.2.2', '10.0.3.2'] : [];

    for (const host of emulatorHosts) {
      addHost(host);
    }

    addHost(localIp);

    if (parts.length === 4) {
      const subnet = parts.slice(0, 3).join('.');
      for (let index = 1; index <= 254; index += 1) {
        addHost(`${subnet}.${index}`);
      }
    }
  }

  return hosts;
}

type TcpSocketModule = {
  createServer: (listener: (socket: TcpSocket) => void) => TcpServer;
  createConnection: (options: Record<string, unknown>, callback: () => void) => TcpSocket;
};

type LanNativeModule = {
  getLocalIpv4Addresses?: () => Promise<string[]>;
  updateForegroundSession?: (sessionName: string, inviteCode: string, joinUrl: string, playerCount: number) => Promise<boolean>;
  stopForegroundSession?: () => Promise<boolean>;
};

const LanNative = NativeModules.LanSessionModule as LanNativeModule | undefined;

function isUsableLanIp(ip?: string | null) {
  if (!ip) return false;
  if (ip === '0.0.0.0') return false;
  if (ip === '127.0.0.1') return false;
  if (ip.startsWith('169.254.')) return false;
  return true;
}

function isEnvelopeForCurrentSession(sessionId?: string) {
  if (!sessionId) return true;
  return Boolean(hostPayload?.session.id && sessionId === hostPayload.session.id);
}

function parseTcpUrl(url: string) {
  const parsed = new URL(url);
  const sessionId = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : LAN_TCP_PORT,
    sessionId,
  };
}

function upsertByKey<T extends Record<string, any>>(list: T[], item: T, key: string) {
  const itemKey = item?.[key];
  if (!itemKey) {
    list.push(item);
    return;
  }

  const index = list.findIndex((entry) => entry?.[key] && entry[key] === itemKey);
  if (index >= 0) list[index] = item;
  else list.push(item);
}
