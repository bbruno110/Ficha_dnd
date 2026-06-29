import { NativeModules, Platform } from 'react-native';

export type LanForegroundServiceOptions = {
  sessionId: string;
  sessionName: string;
  port: number;
  hostIp?: string | null;
  playerCount?: number;
  role?: 'master' | 'player';
  status?: string;
};

export type LanAddressInfo = {
  address: string;
  interfaceName?: string;
  isLoopback?: boolean;
};

type NativeLanForegroundService = {
  start?: (options: LanForegroundServiceOptions) => Promise<void>;
  stop?: () => Promise<void>;
  update?: (options: Partial<LanForegroundServiceOptions>) => Promise<void>;
  getLanAddresses?: () => Promise<LanAddressInfo[]>;
};

function getNativeService(): NativeLanForegroundService | null {
  const module = (NativeModules as any)?.LanForegroundService;
  return module || null;
}

export const LanForegroundService = {
  isAvailable() {
    return Platform.OS === 'android' && Boolean(getNativeService()?.start);
  },

  async start(options: LanForegroundServiceOptions) {
    if (Platform.OS !== 'android') return;
    const service = getNativeService();
    if (!service?.start) return;
    await service.start(options);
  },

  async update(options: Partial<LanForegroundServiceOptions>) {
    if (Platform.OS !== 'android') return;
    const service = getNativeService();
    if (!service?.update) return;
    await service.update(options);
  },

  async stop() {
    if (Platform.OS !== 'android') return;
    const service = getNativeService();
    if (!service?.stop) return;
    await service.stop();
  },

  async getLanAddresses(): Promise<LanAddressInfo[]> {
    if (Platform.OS !== 'android') return [];
    const service = getNativeService();
    if (!service?.getLanAddresses) return [];
    const addresses = await service.getLanAddresses();
    return Array.isArray(addresses) ? addresses : [];
  },
};
