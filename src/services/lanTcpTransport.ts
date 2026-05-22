import * as Network from 'expo-network';
import { NativeModules, Platform } from 'react-native';

import type { LanSessionEvent, LanSessionPayload } from './lanSession';

export const LAN_TCP_PORT = 43115;

type TcpSocketModule = {
  createServer: (listener: (socket: TcpSocket) => void) => TcpServer;
  createConnection: (options: Record<string, unknown>, callback: () => void) => TcpSocket;
};

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
  | { type: 'payload_update'; payload: LanSessionPayload };

let tcpModule: TcpSocketModule | null | undefined;
let hostServer: TcpServer | null = null;
let hostPayload: LanSessionPayload | null = null;
let hostUrl = '';
let hostSockets = new Set<TcpSocket>();
let hostJoinedRows: Record<string, unknown>[] = [];
let hostEvents: LanSessionEvent[] = [];

let clientSocket: TcpSocket | null = null;
let clientUrl = '';
let clientPayload: LanSessionPayload | null = null;
let clientEvents: LanSessionEvent[] = [];
let clientConnectPromise: Promise<LanSessionPayload> | null = null;

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
    sendEnvelope(socket, { type: 'session_snapshot', payload: makeHostPayload() });

    createLineReader(socket, (message) => {
      if (message.type === 'hello') {
        sendEnvelope(socket, { type: 'session_snapshot', payload: makeHostPayload() });
      }

      if (message.type === 'join') {
        upsertByKey(hostJoinedRows, message.entry, 'remoteKey');
        broadcastHostPayload();
      }

      if (message.type === 'event') {
        upsertByKey(hostEvents, message.event, 'id');
        broadcastEnvelope({ type: 'event', event: message.event });
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

export function updateLanTcpHostPayload(payload: LanSessionPayload) {
  if (!hostServer || hostPayload?.session.id !== payload.session.id) return false;
  hostPayload = payload;
  broadcastHostPayload();
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
  const hosts = Array.from(new Set([
    '10.0.2.2',
    '10.0.3.2',
    localIp,
    ...Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`),
  ].filter((host) => host && host !== '0.0.0.0' && host !== '127.0.0.1')));

  let nextIndex = 0;
  let foundUrl = '';
  const workerCount = Math.min(32, hosts.length);

  const scanNext = async () => {
    while (!foundUrl && nextIndex < hosts.length) {
      const host = hosts[nextIndex];
      nextIndex += 1;

      const payload = await fetchLanTcpProbePayload(host, 420);
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
  sendEnvelope(clientSocket, { type: 'join', entry });
  return true;
}

export async function sendLanTcpEvent(url: string | undefined, event: LanSessionEvent) {
  if (!url) throw new Error('Sessao TCP sem URL ativa.');
  if (isCurrentHostUrl(url)) {
    upsertByKey(hostEvents, event, 'id');
    broadcastEnvelope({ type: 'event', event });
    return;
  }
  await connectLanTcpClient(url);
  if (!clientSocket) throw new Error('Socket TCP indisponivel.');
  sendEnvelope(clientSocket, { type: 'event', event });
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
    const socket = TcpSocket.createConnection({
      host: target.host,
      port: target.port,
      interface: Platform.OS === 'android' ? 'wifi' : undefined,
      reuseAddress: true,
      connectTimeout: 5000,
    }, () => {
      configureSocket(socket);
      sendEnvelope(socket, { type: 'hello', sessionId: target.sessionId });
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Tempo esgotado ao conectar no host TCP.'));
    }, 6500);

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on('close', () => {
      if (clientSocket === socket) clientSocket = null;
    });

    createLineReader(socket, (message) => {
      if (message.type === 'session_snapshot' || message.type === 'payload_update') {
        clientPayload = message.payload;
        clientSocket = socket;
        clearTimeout(timeout);
        resolve(message.payload);
      }

      if (message.type === 'event') {
        upsertByKey(clientEvents, message.event, 'id');
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
        interface: Platform.OS === 'android' ? 'wifi' : undefined,
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
    events: hostEvents.slice(-50),
  };
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
  socket.write(`${JSON.stringify(message)}\n`);
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

function closeClientSocket() {
  if (!clientSocket) return;
  try {
    clientSocket.destroy();
  } catch {
    // Socket already closed.
  }
  clientSocket = null;
}

async function getLocalIpAddress() {
  const ipAddress = await Network.getIpAddressAsync();
  if (!ipAddress || ipAddress === '0.0.0.0' || ipAddress === '127.0.0.1') {
    throw new Error('Nao encontrei um IP Wi-Fi valido para hospedar a sessao TCP.');
  }
  return ipAddress;
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
  const index = list.findIndex((entry) => entry?.[key] && entry[key] === itemKey);
  if (index >= 0) list[index] = item;
  else list.push(item);
}
