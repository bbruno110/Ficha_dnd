import { LanRpcRequest, LanRpcResponse, LanRpcServerCallbacks, makeRpcId } from './lanRpcTransport';
import { dataToString, encodeFrame, getTcpSocketModule, readFrames } from './lanTcpFraming';

const MISSED_PINGS_BEFORE_DISCONNECT = 8;

export type LanTcpStreamMethod =
  | 'HELLO'
  | 'PONG'
  | 'SESSION_CLOSED_ACK'
  | 'LEAVE';

export type LanTcpStreamMessage = {
  type: 'LAN_STREAM';
  id: string;
  method: LanTcpStreamMethod;
  sessionId?: string | null;
  deviceId?: string | null;
  payload?: Record<string, unknown>;
  at: string;
};

export type LanTcpServerPushMessage = {
  type: 'LAN_STREAM_PUSH';
  id: string;
  method: 'SYNC' | 'PING' | 'NOTICE' | 'SESSION_CLOSED';
  sessionId?: string | null;
  payload?: Record<string, unknown>;
  at: string;
};

type LanTcpClientEntry = {
  socket: any;
  sessionId: string;
  deviceId: string;
  buffer: string;
  lastPongAt: number;
  missedPings: number;
};

type LanTcpServerOptions = LanRpcServerCallbacks & {
  heartbeatMs?: number;
  onClientHello?: (message: LanTcpStreamMessage) => Promise<Record<string, unknown> | undefined>;
  onClosedAck?: (message: LanTcpStreamMessage) => Promise<void>;
  onClientDisconnected?: (deviceId: string, sessionId: string) => Promise<void>;
};

export class LanTcpServer {
  private server: any = null;
  private callbacks: LanTcpServerOptions;
  private rpcHandler: (request: LanRpcRequest) => Promise<LanRpcResponse>;
  private clients = new Map<string, LanTcpClientEntry>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    rpcHandler: (request: LanRpcRequest) => Promise<LanRpcResponse>,
    callbacks: LanTcpServerOptions = {}
  ) {
    this.rpcHandler = rpcHandler;
    this.callbacks = callbacks;
  }

  async start(port: number) {
    const TcpSocket = getTcpSocketModule();
    await this.close();

    this.server = TcpSocket.createServer((socket: any) => this.handleSocket(socket));

    return new Promise<void>((resolve, reject) => {
      this.server.on?.('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
        reject(error);
      });
      this.server.listen({ port, host: '0.0.0.0' }, () => {
        this.callbacks.onStatus?.('Servidor TCP LAN aberto.');
        this.startHeartbeat();
        resolve();
      });
    });
  }

  async close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.socket.destroy?.();
      } catch {}
    }
    this.clients.clear();

    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(finish, 900);

      try {
        server.close?.(finish);
        if (!server.close) finish();
      } catch {
        finish();
      }
    });
  }

  connectedDeviceIds() {
    return [...this.clients.keys()];
  }

  sendTo(deviceId: string, message: Omit<LanTcpServerPushMessage, 'type' | 'id' | 'at'>) {
    const client = this.clients.get(deviceId);
    if (!client) return false;
    this.write(client.socket, {
      type: 'LAN_STREAM_PUSH',
      id: makeRpcId(),
      at: new Date().toISOString(),
      ...message,
    });
    return true;
  }

  broadcast(message: Omit<LanTcpServerPushMessage, 'type' | 'id' | 'at'>, deviceIds?: string[]) {
    const targets = deviceIds?.length ? deviceIds : this.connectedDeviceIds();
    let sent = 0;
    for (const deviceId of targets) {
      if (this.sendTo(deviceId, message)) sent += 1;
    }
    return sent;
  }

  private handleSocket(socket: any) {
    let buffer = '';
    let streamDeviceId: string | null = null;
    let streamSessionId: string | null = null;
    let rpcHandled = false;

    try {
      socket.setNoDelay?.(true);
      socket.setKeepAlive?.(true, 10000);
    } catch {}

    const closeStream = () => {
      if (!streamDeviceId) return;
      const entry = this.clients.get(streamDeviceId);
      if (entry && entry.socket === socket) {
        this.clients.delete(streamDeviceId);
        void this.callbacks.onClientDisconnected?.(streamDeviceId, streamSessionId || entry.sessionId || '').catch(() => undefined);
      }
      streamDeviceId = null;
      streamSessionId = null;
    };

    socket.on('data', async (data: unknown) => {
      const result = readFrames(buffer, dataToString(data));
      buffer = result.nextBuffer;

      for (const frame of result.frames) {
        if (!frame || typeof frame !== 'object') {
          this.write(socket, this.makeRpcError(makeRpcId(), 'Requisicao TCP LAN invalida.'));
          continue;
        }

        const raw = frame as { type?: string; [key: string]: unknown };
        if (raw.type === 'LAN_RPC') {
          if (rpcHandled) continue;
          rpcHandled = true;
          await this.handleRpcFrame(socket, raw as LanRpcRequest);
          continue;
        }

        if (raw.type === 'LAN_STREAM') {
          const message = raw as LanTcpStreamMessage;
          if (message.method === 'HELLO') {
            streamDeviceId = String(message.deviceId || message.payload?.deviceId || '');
            streamSessionId = String(message.sessionId || message.payload?.sessionId || '');
            if (!streamDeviceId || !streamSessionId) {
              this.write(socket, this.makePush('NOTICE', { error: 'HELLO LAN sem deviceId/sessionId.' }, streamSessionId));
              continue;
            }
            const payload = await this.callbacks.onClientHello?.(message);
            if (payload?.error) {
              this.write(socket, this.makePush('NOTICE', payload, streamSessionId));
              streamDeviceId = null;
              streamSessionId = null;
              this.destroySoon(socket);
              continue;
            }
            this.clients.get(streamDeviceId)?.socket?.destroy?.();
            this.clients.set(streamDeviceId, {
              socket,
              sessionId: streamSessionId,
              deviceId: streamDeviceId,
              buffer,
              lastPongAt: Date.now(),
              missedPings: 0,
            });
            if (payload) {
              this.write(socket, this.makePush('SYNC', payload, streamSessionId));
            }
            continue;
          }

          if (message.method === 'PONG') {
            const deviceId = String(message.deviceId || streamDeviceId || '');
            const client = deviceId ? this.clients.get(deviceId) : null;
            if (client) {
              client.lastPongAt = Date.now();
              client.missedPings = 0;
            }
            continue;
          }

          if (message.method === 'SESSION_CLOSED_ACK') {
            await this.callbacks.onClosedAck?.(message);
            continue;
          }

          if (message.method === 'LEAVE') {
            closeStream();
          }
        }
      }
    });

    socket.on('error', (error: Error) => {
      this.callbacks.onError?.(error.message);
      closeStream();
    });
    socket.on('close', closeStream);
  }

  private async handleRpcFrame(socket: any, request: LanRpcRequest) {
    if (!request.id || !request.method) {
      this.write(socket, this.makeRpcError(String(request.id || makeRpcId()), 'Requisicao LAN invalida.'));
      this.destroySoon(socket);
      return;
    }

    try {
      this.write(socket, await this.rpcHandler(request));
    } catch (error) {
      this.write(socket, this.makeRpcError(request.id, error instanceof Error ? error.message : String(error)));
    } finally {
      this.destroySoon(socket);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const heartbeatMs = this.callbacks.heartbeatMs || 10000;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [deviceId, client] of this.clients.entries()) {
        if (now - client.lastPongAt > heartbeatMs * 2.5) {
          client.missedPings += 1;
        }
        if (client.missedPings >= MISSED_PINGS_BEFORE_DISCONNECT) {
          this.clients.delete(deviceId);
          try {
            client.socket.destroy?.();
          } catch {}
          void this.callbacks.onClientDisconnected?.(deviceId, client.sessionId).catch(() => undefined);
          continue;
        }
        this.write(client.socket, this.makePush('PING', { sentAt: new Date().toISOString() }, client.sessionId));
      }
    }, heartbeatMs);
  }

  private makePush(method: LanTcpServerPushMessage['method'], payload?: Record<string, unknown>, sessionId?: string | null): LanTcpServerPushMessage {
    return {
      type: 'LAN_STREAM_PUSH',
      id: makeRpcId(),
      method,
      sessionId,
      payload,
      at: new Date().toISOString(),
    };
  }

  private makeRpcError(id: string, error: string): LanRpcResponse {
    return {
      type: 'LAN_RPC_RESPONSE',
      id,
      ok: false,
      error,
      at: new Date().toISOString(),
    };
  }

  private write(socket: any, value: unknown) {
    try {
      socket.write(encodeFrame(value));
    } catch {}
  }

  private destroySoon(socket: any) {
    setTimeout(() => {
      try {
        socket.destroy?.();
      } catch {}
    }, 220);
  }
}
