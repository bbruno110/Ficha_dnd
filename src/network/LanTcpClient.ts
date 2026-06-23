import { LanTcpServerPushMessage, LanTcpStreamMessage } from './LanTcpServer';
import { encodeFrame, dataToString, getTcpSocketModule, readFrames } from './lanTcpFraming';
import { makeRpcId } from './lanRpcTransport';

type LanTcpClientOptions = {
  host: string;
  port: number;
  sessionId: string;
  deviceId: string;
  payload?: Record<string, unknown>;
  reconnectMs?: number;
  serverSilenceMs?: number;
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  onMessage?: (message: LanTcpServerPushMessage) => Promise<void> | void;
  onError?: (message: string) => void;
};

export class LanTcpClient {
  private options: LanTcpClientOptions;
  private socket: any = null;
  private buffer = '';
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastServerMessageAt = 0;
  private connected = false;

  constructor(options: LanTcpClientOptions) {
    this.options = options;
  }

  start() {
    this.closedByUser = false;
    this.connect();
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopWatchdog();
    this.destroySocket();
    this.options.onStatus?.('disconnected');
  }

  updatePayload(payload: Record<string, unknown>) {
    this.options = { ...this.options, payload: { ...(this.options.payload || {}), ...payload } };
    if (this.connected) this.sendHello();
  }

  private connect() {
    if (this.closedByUser) return;
    const TcpSocket = getTcpSocketModule();
    this.destroySocket();
    this.options.onStatus?.('reconnecting');

    const socket = TcpSocket.createConnection({ host: this.options.host, port: this.options.port }, () => {
      this.connected = true;
      this.lastServerMessageAt = Date.now();
      this.options.onStatus?.('connected');
      try {
        socket.setNoDelay?.(true);
        socket.setKeepAlive?.(true, 10000);
      } catch {}
      this.startWatchdog();
      this.sendHello();
    });

    this.socket = socket;
    socket.on('data', (data: unknown) => this.handleData(data));
    socket.on('error', (error: Error) => {
      this.options.onError?.(error.message);
      this.scheduleReconnect();
    });
    socket.on('close', () => this.scheduleReconnect());
  }

  private handleData(data: unknown) {
    this.lastServerMessageAt = Date.now();
    const result = readFrames(this.buffer, dataToString(data));
    this.buffer = result.nextBuffer;

    for (const frame of result.frames) {
      if (!frame || typeof frame !== 'object') continue;
      const message = frame as LanTcpServerPushMessage;
      if (message.type !== 'LAN_STREAM_PUSH') continue;

      if (message.method === 'PING') {
        this.send('PONG', { pingId: message.id });
        continue;
      }

      void this.options.onMessage?.(message);
    }
  }

  private sendHello() {
    this.send('HELLO', this.options.payload || {});
  }

  private send(method: LanTcpStreamMessage['method'], payload?: Record<string, unknown>) {
    if (!this.socket) return;
    const message: LanTcpStreamMessage = {
      type: 'LAN_STREAM',
      id: makeRpcId(),
      method,
      sessionId: this.options.sessionId,
      deviceId: this.options.deviceId,
      payload,
      at: new Date().toISOString(),
    };
    try {
      this.socket.write(encodeFrame(message));
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    this.connected = false;
    this.stopWatchdog();
    this.destroySocket();
    if (this.reconnectTimer) return;
    this.options.onStatus?.('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectMs || 3000);
  }

  private destroySocket() {
    const socket = this.socket;
    this.socket = null;
    this.buffer = '';
    if (!socket) return;
    try {
      socket.destroy?.();
    } catch {}
  }

  private startWatchdog() {
    this.stopWatchdog();
    const silenceMs = this.options.serverSilenceMs || 30000;
    const tickMs = Math.max(5000, Math.floor(silenceMs / 3));
    this.watchdogTimer = setInterval(() => {
      if (this.closedByUser || !this.connected) return;
      if (Date.now() - this.lastServerMessageAt <= silenceMs) return;
      this.options.onError?.(`Servidor LAN sem resposta ha ${Math.round(silenceMs / 1000)}s. Reconectando.`);
      this.scheduleReconnect();
    }, tickMs);
  }

  private stopWatchdog() {
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }
}
