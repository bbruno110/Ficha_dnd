import { LanMessage } from '../types/lan';
import { encodeLanMessage, readLanFrames } from './lanProtocol';

declare const require: (moduleName: string) => any;

type PeerId = string;

type LanTransportCallbacks = {
  onMessage?: (message: LanMessage, peerId: PeerId) => void;
  onPeerChange?: () => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

type SocketEntry = {
  id: PeerId;
  socket: any;
  buffer: string;
};

function getTcpSocketModule() {
  try {
    const module = require('react-native-tcp-socket');
    return module.default || module;
  } catch {
    throw new Error('Modulo TCP nativo indisponivel. Gere um dev build/APK com react-native-tcp-socket.');
  }
}

function dataToString(data: unknown) {
  if (typeof data === 'string') return data;
  if (data && typeof (data as { toString?: () => string }).toString === 'function') {
    return (data as { toString: () => string }).toString();
  }
  return String(data || '');
}

export class LanTransport {
  private callbacks: LanTransportCallbacks;
  private server: any = null;
  private client: SocketEntry | null = null;
  private peers = new Map<PeerId, SocketEntry>();
  private peerCounter = 0;

  constructor(callbacks: LanTransportCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get peerCount() {
    return this.peers.size;
  }

  async startServer(port: number) {
    const TcpSocket = getTcpSocketModule();
    this.close();

    this.server = TcpSocket.createServer((socket: any) => {
      const peerId = `player_${++this.peerCounter}`;
      const entry: SocketEntry = { id: peerId, socket, buffer: '' };
      this.peers.set(peerId, entry);
      this.callbacks.onPeerChange?.();

      socket.on('data', (data: unknown) => this.handleData(entry, data));
      socket.on('error', (error: Error) => this.callbacks.onError?.(error.message));
      socket.on('close', () => {
        this.peers.delete(peerId);
        this.callbacks.onPeerChange?.();
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server.on?.('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
        reject(error);
      });

      this.server.listen({ port, host: '0.0.0.0' }, () => {
        this.callbacks.onStatus?.('Servidor TCP LAN aberto.');
        resolve();
      });
    });
  }

  async connect(host: string, port: number) {
    const TcpSocket = getTcpSocketModule();
    this.close();

    return new Promise<void>((resolve, reject) => {
      const socket = TcpSocket.createConnection({ host, port }, () => {
        this.client = { id: 'master', socket, buffer: '' };
        this.callbacks.onStatus?.('Conectado ao mestre LAN.');
        this.callbacks.onPeerChange?.();
        resolve();
      });

      const entry: SocketEntry = { id: 'master', socket, buffer: '' };
      this.client = entry;

      socket.on('data', (data: unknown) => this.handleData(entry, data));
      socket.on('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
        reject(error);
      });
      socket.on('close', () => {
        this.client = null;
        this.callbacks.onStatus?.('Conexao LAN encerrada.');
        this.callbacks.onPeerChange?.();
      });
    });
  }

  sendToPeer(peerId: PeerId, message: LanMessage) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.socket.write(encodeLanMessage(message));
  }

  sendToServer(message: LanMessage) {
    if (!this.client) return;
    this.client.socket.write(encodeLanMessage(message));
  }

  broadcast(message: LanMessage, exceptPeerId?: PeerId) {
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId === exceptPeerId) continue;
      peer.socket.write(encodeLanMessage(message));
    }
  }

  close() {
    if (this.client) {
      this.client.socket.destroy?.();
      this.client = null;
    }

    for (const peer of this.peers.values()) {
      peer.socket.destroy?.();
    }
    this.peers.clear();

    if (this.server) {
      this.server.close?.();
      this.server = null;
    }
    this.callbacks.onPeerChange?.();
  }

  private handleData(entry: SocketEntry, data: unknown) {
    const { messages, nextBuffer } = readLanFrames(entry.buffer, dataToString(data));
    entry.buffer = nextBuffer;

    for (const message of messages) {
      this.callbacks.onMessage?.(message, entry.id);
    }
  }
}
