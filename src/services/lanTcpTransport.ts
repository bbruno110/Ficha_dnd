import * as Network from 'expo-network';
import { NativeModules } from 'react-native';

declare const require: any;

import type { LanSessionEvent, LanSessionPayload, LanSessionPlayerState } from './lanSession';

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
  | { type: 'hello'; sessionId?: string }
  | { type: 'session_snapshot'; payload: LanSessionPayload }
  | { type: 'join'; entry: Record<string, unknown> }
  | { type: 'join_ack'; sessionId: string; remoteKey?: string; clientId?: string; accepted: true }
  | { type: 'join_rejected'; sessionId?: string; reason: string }
  | { type: 'event'; event: LanSessionEvent }
  | { type: 'payload_update'; payload: LanSessionPayload }
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
let hostUpdateListeners = new Set<() => void>();

let clientSocket: TcpSocket | null = null;
let clientUrl = '';
let clientPayload: LanSessionPayload | null = null;
let clientEvents: LanSessionEvent[] = [];
let clientConnectPromise: Promise<LanSessionPayload> | null = null;
let clientUpdateListeners = new Set<() => void>();
let clientPayloadWaiters = new Set<ClientPayloadWaiter>();
let clientJoinAckWaiters = new Set<ClientJoinAckWaiter>();
let clientHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
  const TcpSocket = loadTcpSocket();

  if (hostServer && hostPayload?.session.id === payload.session.id && hostUrl) {
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
    return hostUrl;
  }

  const preservePendingState = hostPayload?.session.id === payload.session.id;
  const pendingJoinedRows = preservePendingState ? [...hostJoinedRows] : [];
  const pendingEvents = preservePendingState ? [...hostEvents] : [];

  await stopLanTcpHost();

  hostPayload = payload;
  hostJoinedRows = pendingJoinedRows;
  hostEvents = pendingEvents;
  hostSockets = new Set();

  const server = TcpSocket.createServer((socket) => {
    configureSocket(socket);
    hostSockets.add(socket);

    createLineReader(socket, (message) => {
      if (message.type === 'heartbeat') {
        sendEnvelope(socket, {
          type: 'heartbeat_ack',
          sessionId: hostPayload?.session.id,
          sentAt: new Date().toISOString(),
        });
        return;
      }

      if (message.type === 'ack' || message.type === 'heartbeat_ack') {
        return;
      }

      if (message.type === 'hello') {
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

        upsertByKey(hostJoinedRows, normalizedEntry, remoteKey ? 'remoteKey' : 'clientId');

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
        upsertByKey(hostEvents, joinedEvent, 'id');

        sendEnvelope(socket, {
          type: 'join_ack',
          sessionId: hostPayload?.session.id || entrySessionId,
          remoteKey: remoteKey || undefined,
          clientId: clientId || undefined,
          accepted: true,
        });
        broadcastHostPayload();
        updateHostForegroundSession();
        notifyHostUpdates();
        return;
      }

      if (message.type === 'event') {
        if (!isEnvelopeForCurrentSession(message.event?.sessionId)) return;
        upsertByKey(hostEvents, message.event, 'id');
        broadcastEnvelope({ type: 'event', event: message.event });
        notifyHostUpdates();
      }
    });

    socket.on('close', () => {
      hostSockets.delete(socket);
    });
    socket.on('error', () => {
      hostSockets.delete(socket);
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
  return hostUrl;
}

export async function stopLanTcpHost() {
  for (const socket of hostSockets) {
    try {
      socket.destroy();
    } catch {
      // Socket already closed.
    }
  }
  hostSockets.clear();

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
  return [...hostJoinedRows];
}

export function getLanTcpHostEvents() {
  return [...hostEvents];
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
    return await sendJoinAndWaitAck();
  } catch {
    await connectLanTcpClient(url, { forceReconnect: true });
    return await sendJoinAndWaitAck();
  }
}

export async function sendLanTcpEvent(url: string | undefined, event: LanSessionEvent) {
  if (!url) throw new Error('Sessao TCP sem URL ativa.');
  if (isCurrentHostUrl(url)) {
    upsertByKey(hostEvents, event, 'id');
    broadcastEnvelope({ type: 'event', event });
    notifyHostUpdates();
    return;
  }
  await connectLanTcpClient(url);
  if (!clientSocket) throw new Error('Socket TCP indisponivel.');
  if (sendEnvelope(clientSocket, { type: 'event', event })) return;

  await connectLanTcpClient(url);
  if (!clientSocket || !sendEnvelope(clientSocket, { type: 'event', event })) {
    throw new Error('Socket TCP indisponivel.');
  }
}

export async function getLanTcpClientEvents(url: string, sessionId?: string) {
  if (isCurrentHostUrl(url)) return getLanTcpHostEvents().filter((event) => !sessionId || event.sessionId === sessionId);
  await connectLanTcpClient(url);
  return clientEvents.filter((event) => !sessionId || event.sessionId === sessionId);
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

async function connectLanTcpClient(url: string, options?: { requestFresh?: boolean; forceReconnect?: boolean }) {
  if (!isTcpLanUrl(url)) throw new Error('URL TCP invalida.');

  if (clientSocket && clientUrl === url && clientPayload && !options?.forceReconnect) {
    if (!options?.requestFresh) return clientPayload;

    const target = parseTcpUrl(url);
    const freshPayload = await requestClientSnapshot(target.sessionId);
    if (freshPayload) return freshPayload;

    closeClientSocket();
    clientPayload = null;
    clientEvents = [];
  }

  if (clientConnectPromise && clientUrl === url) return clientConnectPromise;

  closeClientSocket();
  clientUrl = url;
  clientPayload = null;
  clientEvents = [];

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
      sendEnvelope(socket, { type: 'hello', sessionId: target.sessionId });
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
      if (target.sessionId && payload.session.id !== target.sessionId) return false;
      clientPayload = payload;
      clientSocket = socket;
      mergeClientPayloadEvents(payload, target.sessionId);
      resolveClientPayloadWaiters(payload);
      if (updateOptions?.notify !== false) {
        notifyClientUpdates();
      }
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
          applyPayloadUpdate(message.payload, { notify: message.type === 'payload_update' });
        }
        return;
      }

      if (message.type === 'event') {
        if (target.sessionId && message.event.sessionId !== target.sessionId) return;
        upsertByKey(clientEvents, message.event, 'id');
        notifyClientUpdates();
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

    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

export function subscribeLanTcpHostUpdates(listener: () => void) {
  hostUpdateListeners.add(listener);
  return () => {
    hostUpdateListeners.delete(listener);
  };
}

export function subscribeLanTcpClientUpdates(listener: () => void) {
  clientUpdateListeners.add(listener);
  return () => {
    clientUpdateListeners.delete(listener);
  };
}

function notifyHostUpdates() {
  for (const listener of hostUpdateListeners) {
    listener();
  }
}

function notifyClientUpdates() {
  for (const listener of clientUpdateListeners) {
    listener();
  }
}

function broadcastHostPayload() {
  if (!hostPayload) return;
  broadcastEnvelope({ type: 'payload_update', payload: makeHostPayload() });
}

function updateHostForegroundSession() {
  if (!hostPayload || !hostUrl || !LanNative?.updateForegroundSession) return;

  try {
    const payload = makeHostPayload();
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
  for (const socket of hostSockets) {
    sendEnvelope(socket, message);
  }
}

function sendEnvelope(socket: TcpSocket, message: TcpEnvelope) {
  try {
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  } catch {
    try {
      socket.destroy();
    } catch {
      // socket já estava morto
    }

    hostSockets.delete(socket);

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
        onMessage(JSON.parse(trimmed));
      } catch {
        // Ignore malformed LAN frames instead of killing the session.
      }
    }
  });
}

function configureSocket(socket: TcpSocket) {
  socket.setNoDelay?.(true);
  socket.setKeepAlive?.(true, 1000);
}

function mergeClientPayloadEvents(payload: LanSessionPayload, sessionId?: string) {
  for (const event of payload.events || []) {
    if (sessionId && event.sessionId !== sessionId) continue;
    upsertByKey(clientEvents, event, 'id');
  }
}

function mergeJoinedPlayersIntoPayload(payload: LanSessionPayload): LanSessionPayload {
  const state = payload.state || {
    status: 'active' as const,
    currentTurn: 1,
    elapsedMinutes: 0,
    players: [],
  };
  const players = [...(state.players || [])];

  for (const entry of hostJoinedRows) {
    const player = makeProvisionalPlayerFromJoin(entry, payload.session.id, players.length + 1);
    if (!player) continue;

    const index = players.findIndex((current) => (
      Boolean(player.remoteKey && current.remoteKey === player.remoteKey) ||
      Boolean(player.clientId && current.clientId === player.clientId) ||
      (
        current.characterName === player.characterName &&
        current.playerName === player.playerName
      )
    ));

    if (index >= 0) {
      players[index] = {
        ...player,
        ...players[index],
        remoteKey: players[index].remoteKey || player.remoteKey,
        clientId: players[index].clientId || player.clientId,
      };
    } else {
      players.push(player);
    }
  }

  return {
    ...payload,
    state: {
      ...state,
      players,
    },
  };
}

function makeProvisionalPlayerFromJoin(
  entry: Record<string, unknown>,
  sessionId: string,
  fallbackIndex: number
): LanSessionPlayerState | null {
  const character = normalizeJoinCharacter(entry.character);
  const characterName = String(character.name || entry.playerName || 'Personagem');
  const remoteKey = String(
    entry.remoteKey ||
    `${sessionId}:${character.id || entry.clientId || characterName}:${characterName}`
  );
  const stats = parseJsonValue<Record<string, unknown>>(character.stats, {});

  return {
    id: -Math.abs(hashString(remoteKey || characterName || String(fallbackIndex))),
    sessionId,
    remoteKey,
    clientId: entry.clientId ? String(entry.clientId) : undefined,
    playerName: String(entry.playerName || characterName),
    characterId: null,
    sourceCharacterId: character.id == null ? null : toNumber(character.id),
    characterName,
    level: toNumber(character.level, 1),
    className: String(character.class || '-'),
    race: String(character.race || '-'),
    hpCurrent: toNumber(character.hp_current),
    hpMax: toNumber(character.hp_max),
    tempHp: toNumber(character.temp_hp),
    xp: toNumber(character.xp),
    gp: toNumber(character.gp),
    sp: toNumber(character.sp),
    cp: toNumber(character.cp),
    stats,
    equipment: normalizeEquipment(character.equipment),
    effects: [],
    characterSnapshot: character,
  };
}

function normalizeJoinCharacter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeEquipment(value: unknown): Record<string, unknown> {
  const equipment = parseJsonValue<any>(value, {});
  if (Array.isArray(equipment)) return { bag: equipment, slots: {} };
  if (!equipment || typeof equipment !== 'object') return { bag: [], slots: {} };
  return {
    ...equipment,
    bag: Array.isArray(equipment.bag) ? equipment.bag : [],
    slots: equipment.slots || {},
  };
}

function mergeRecentEvents(...eventLists: LanSessionEvent[][]) {
  const eventsById = new Map<string, LanSessionEvent>();

  for (const events of eventLists) {
    for (const event of events) {
      if (!event?.id) continue;
      eventsById.set(event.id, event);
    }
  }

  return [...eventsById.values()]
    .sort((a, b) => getEventTimestamp(b) - getEventTimestamp(a))
    .slice(0, 50);
}

function getEventTimestamp(event: LanSessionEvent) {
  const timestamp = Date.parse(event.createdAt || '');
  if (Number.isFinite(timestamp)) return timestamp;
  return Number.isFinite(event.seq) ? Number(event.seq) : 0;
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
  clientSocket = null;
  clearClientPayloadWaiters();
  stopClientHeartbeat();
}

function startClientHeartbeat(socket: TcpSocket, sessionId?: string) {
  stopClientHeartbeat();
  clientHeartbeatTimer = setInterval(() => {
    if (clientSocket !== socket) {
      stopClientHeartbeat();
      return;
    }

    sendEnvelope(socket, {
      type: 'heartbeat',
      sessionId,
      sentAt: new Date().toISOString(),
    });
  }, 5000);
}

function stopClientHeartbeat() {
  if (!clientHeartbeatTimer) return;
  clearInterval(clientHeartbeatTimer);
  clientHeartbeatTimer = null;
}

export function resetLanTcpClient() {
  closeClientSocket();
  clientUrl = '';
  clientPayload = null;
  clientEvents = [];
  clientConnectPromise = null;
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

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash || 1;
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
