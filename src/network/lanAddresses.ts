import * as Network from 'expo-network';
import { LanAddressInfo, LanForegroundService } from '../services/lan/LanForegroundService';

export type { LanAddressInfo };

function isUsableIpv4(address: string | null | undefined) {
  const value = String(address || '').trim();
  if (!value || value === '0.0.0.0' || value.startsWith('127.')) return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

function uniqueAddresses(values: LanAddressInfo[]) {
  const seen = new Set<string>();
  const result: LanAddressInfo[] = [];
  for (const value of values) {
    if (!isUsableIpv4(value.address) || seen.has(value.address)) continue;
    seen.add(value.address);
    result.push(value);
  }
  return result;
}

export async function getLanAddressInfos() {
  const nativeAddresses = await LanForegroundService.getLanAddresses().catch(() => []);
  const fallbackAddress = await Network.getIpAddressAsync()
    .then(address => [{ address, interfaceName: 'expo-network' }])
    .catch(() => []);

  return uniqueAddresses([...nativeAddresses, ...fallbackAddress]);
}

export async function getLanAddressCandidates() {
  return (await getLanAddressInfos()).map(info => info.address);
}
