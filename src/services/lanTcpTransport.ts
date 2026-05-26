import * as Network from 'expo-network';
import { NativeModules } from 'react-native';

import type { LanSessionEvent, LanSessionPayload } from './lanSession';

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
  | { type: 'event'; event: LanSessionEvent }
  | { type: 'payload_update'; payload: LanSessionPayload }
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

export function isTcpLanUrl(url?: string) {
  return /^tcp:\/\//i.test(String(url || '').trim());
}

export async function startLanTcpHost(payload: LanSessionPayload) {
  const TcpSocket = loadTcpSocket();
  await stopLanTcpHost();

  hostPayload = payload;
  hostJoinedRows = [];
  hostEvents = [];
  hostSockets = new Set();

  const server = TcpSocket.createServer((socket) => {
    configureSocket(socket);
    hostSockets.add(socket);

    createLineReader(socket, (message) => {
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
            type: 'session_rejected',
            reason: 'JOIN_SESSION_ID_MISMATCH',
            currentSessionId: hostPayload?.session.id,
          });
          socket.destroy();
          return;
        }

        upsertByKey(hostJoinedRows, message.entry, String(message.entry?.clientId || '') ? 'clientId' : 'remoteKey');
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
  try {
    const hostIp = await getLocalIpAddress();
    hostUrl = `tcp://${hostIp}:${LAN_TCP_PORT}/${encodeURIComponent(payload.session.id)}`;
    return hostUrl;
  } catch (error) {
    await stopLanTcpHost();
    throw error;
  }
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
  return connectLanTcpClient(url);
}

export async function resolveLanTcpUrlByInviteCode(inviteCode: string) {
  const normalizedCode = inviteCode.trim().toUpperCase();
  if (!normalizedCode) return '';

  const localIp = await getLocalIpAddress();
  const parts = localIp.split('.');
  if (parts.length !== 4) return '';

  const subnet = parts.slice(0, 3).join('.');
  const emulatorHosts = /^10\.0\.[23]\.\d+$/.test(localIp) ? ['10.0.2.2', '10.0.3.2'] : [];
  const hosts = Array.from(new Set([
    ...emulatorHosts,
    localIp,
    ...Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`),
  ].filter((host) => host && host !== '0.0.0.0' && host !== '127.0.0.1')));

  let nextIndex = 0;
  let foundUrl = '';
  const workerCount = Math.min(8, hosts.length);

  const scanNext = async () => {
    while (!foundUrl && nextIndex < hosts.length) {
      const host = hosts[nextIndex];
      nextIndex += 1;

      const payload = await fetchLanTcpProbePayload(host, 300);
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
  await connectLanTcpClient(url);
  if (!clientSocket) return false;
  if (sendEnvelope(clientSocket, { type: 'join', entry })) return true;

  await connectLanTcpClient(url);
  return Boolean(clientSocket && sendEnvelope(clientSocket, { type: 'join', entry }));
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

async function connectLanTcpClient(url: string) {
  if (!isTcpLanUrl(url)) throw new Error('URL TCP invalida.');

  if (clientSocket && clientUrl === url && clientPayload) return clientPayload;
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

      if (resetUrl) {
        clientUrl = '';
      }
    };

    const applyPayloadUpdate = (payload: LanSessionPayload) => {
      if (target.sessionId && payload.session.id !== target.sessionId) return false;
      clientPayload = payload;
      clientSocket = socket;
      mergeClientPayloadEvents(payload, target.sessionId);
      notifyClientUpdates();
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

      applyPayloadUpdate(payload);
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
        notifyClientUpdates();
      }

      if (!settled) {
        rejectOnce(new Error('Conexao TCP fechada antes de receber a sessao.'));
      }
    });

    createLineReader(socket, (message) => {
      if (message.type === 'session_rejected') {
        rejectOnce(new Error(`Sessao rejeitada pelo host: ${message.reason}`));
        return;
      }

      if (message.type === 'session_snapshot' || message.type === 'payload_update') {
        if (!settled) {
          resolveOnce(message.payload);
        } else {
          applyPayloadUpdate(message.payload);
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
  return {
    ...hostPayload,
    state: hostPayload.state,
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
  if (!clientSocket) return;
  try {
    clientSocket.destroy();
  } catch {
    // Socket already closed.
  }
  clientSocket = null;
}

export function resetLanTcpClient() {
  closeClientSocket();
  clientUrl = '';
  clientPayload = null;
  clientEvents = [];
  clientConnectPromise = null;
}

async function getLocalIpAddress() {
  const expoIp = await Network.getIpAddressAsync().catch(() => '');

  if (isUsableLanIp(expoIp)) {
    return expoIp;
  }

  const nativeIps = await LanNative?.getLocalIpv4Addresses?.().catch(() => []);

  const selectedNativeIp = selectBestLanIp(nativeIps || []);

  if (selectedNativeIp) {
    return selectedNativeIp;
  }

  throw new Error(
    'Não encontrei um IP local válido. Conecte-se a um Wi-Fi ou ligue o roteador/hotspot antes de iniciar a sessão.'
  );
}

function selectBestLanIp(ips: string[]) {
  const validIps = ips.filter(isUsableLanIp);

  return (
    validIps.find((ip) => ip.startsWith('192.168.')) ||
    validIps.find((ip) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) ||
    validIps.find((ip) => ip.startsWith('10.')) ||
    validIps[0] ||
    ''
  );
}

type TcpSocketModule = {
  createServer: (listener: (socket: TcpSocket) => void) => TcpServer;
  createConnection: (options: Record<string, unknown>, callback: () => void) => TcpSocket;
};

type LanNativeModule = {
  getLocalIpv4Addresses?: () => Promise<string[]>;
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
