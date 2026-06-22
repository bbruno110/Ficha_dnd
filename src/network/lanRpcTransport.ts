import { dataToString, encodeFrame, getTcpSocketModule, readFrames } from './lanTcpFraming';

export type LanRpcMethod =
  | 'DISCOVER'
  | 'JOIN'
  | 'POLL'
  | 'SESSION_CLOSED_ACK'
  | 'COMMAND'
  | 'CHARACTER_UPSERT'
  | 'LEAVE';

export type LanRpcRequest = {
  type: 'LAN_RPC';
  id: string;
  method: LanRpcMethod;
  sessionId?: string | null;
  deviceId?: string | null;
  payload?: Record<string, unknown>;
  at: string;
};

export type LanRpcResponse = {
  type: 'LAN_RPC_RESPONSE';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
  at: string;
};

export type LanRpcServerCallbacks = {
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

export function makeRpcId() {
  return `rpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class LanRpcServer {
  private server: any = null;
  private callbacks: LanRpcServerCallbacks;
  private handler: (request: LanRpcRequest) => Promise<LanRpcResponse>;

  constructor(
    handler: (request: LanRpcRequest) => Promise<LanRpcResponse>,
    callbacks: LanRpcServerCallbacks = {}
  ) {
    this.handler = handler;
    this.callbacks = callbacks;
  }

  async start(port: number) {
    const TcpSocket = getTcpSocketModule();
    this.close();

    this.server = TcpSocket.createServer((socket: any) => {
      let buffer = '';
      let handled = false;
      try {
        socket.setNoDelay?.(true);
      } catch {}

      const finish = (response: LanRpcResponse) => {
        try {
          socket.write(encodeFrame(response));
        } finally {
          setTimeout(() => {
            try {
              socket.destroy?.();
            } catch {}
          }, 220);
        }
      };

      socket.on('data', async (data: unknown) => {
        const result = readFrames(buffer, dataToString(data));
        buffer = result.nextBuffer;
        if (handled) return;

        const raw = result.frames.find(Boolean) as Partial<LanRpcRequest> | undefined;
        if (!raw || raw.type !== 'LAN_RPC' || !raw.id || !raw.method) {
          handled = true;
          finish({
            type: 'LAN_RPC_RESPONSE',
            id: String(raw?.id || makeRpcId()),
            ok: false,
            error: 'Requisicao LAN invalida.',
            at: new Date().toISOString(),
          });
          return;
        }

        handled = true;
        try {
          finish(await this.handler(raw as LanRpcRequest));
        } catch (error) {
          finish({
            type: 'LAN_RPC_RESPONSE',
            id: raw.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          });
        }
      });

      socket.on('error', (error: Error) => this.callbacks.onError?.(error.message));
    });

    return new Promise<void>((resolve, reject) => {
      this.server.on?.('error', (error: Error) => {
        this.callbacks.onError?.(error.message);
        reject(error);
      });
      this.server.listen({ port, host: '0.0.0.0' }, () => {
        this.callbacks.onStatus?.('Servidor RPC LAN aberto.');
        resolve();
      });
    });
  }

  close() {
    if (!this.server) return;
    try {
      this.server.close?.();
    } finally {
      this.server = null;
    }
  }
}

export async function sendLanRpc(host: string, port: number, request: LanRpcRequest, timeoutMs = 900) {
  const TcpSocket = getTcpSocketModule();

  return new Promise<LanRpcResponse>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    let socket: any = null;

    const finish = (error?: Error, response?: LanRpcResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy?.();
      } catch {}
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new Error('Resposta LAN vazia.'));
    };

    const timer = setTimeout(() => finish(new Error(`Tempo esgotado ao conectar em ${host}:${port}.`)), timeoutMs);
    socket = TcpSocket.createConnection({ host, port }, () => {
      try {
        socket.setNoDelay?.(true);
        socket.write(encodeFrame(request));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on('data', (data: unknown) => {
      const result = readFrames(buffer, dataToString(data));
      buffer = result.nextBuffer;
      const raw = result.frames.find(Boolean) as LanRpcResponse | undefined;
      if (!raw) return;
      if (raw.type !== 'LAN_RPC_RESPONSE' || raw.id !== request.id) {
        finish(new Error('Resposta LAN invalida.'));
        return;
      }
      finish(undefined, raw);
    });

    socket.on('error', (error: Error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('Conexao LAN fechada sem resposta.'));
    });
  });
}
