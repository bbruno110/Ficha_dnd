import { LAN_DEFAULT_PORT, ParsedSessionCode } from '../types/lan';
import { getLanAddressInfos } from './lanAddresses';
import type { LanAddressInfo } from './lanAddresses';
import { LanRpcResponse, makeRpcId, sendLanRpc } from './lanRpcTransport';

const HOTSPOT_HOSTS = [
  '192.168.43.1',
  '192.168.49.1',
  '172.20.10.1',
  '192.168.137.1',
  '192.168.0.1',
  '192.168.1.1',
];

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || value === '0.0.0.0' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function subnetCandidates(localIp: string | null | undefined) {
  const parts = String(localIp || '').trim().split('.');
  if (parts.length !== 4) return [];
  if (!parts.every(part => Number(part) >= 0 && Number(part) <= 255)) return [];
  const subnet = parts.slice(0, 3).join('.');
  const result = [`${subnet}.1`, `${subnet}.254`];
  for (let index = 2; index <= 253; index += 1) {
    const host = `${subnet}.${index}`;
    if (host !== localIp) result.push(host);
  }
  return result;
}

export async function getLanHostCandidates(parsedCode: ParsedSessionCode) {
  const localAddresses = await getLanAddressInfos();
  return getLanHostCandidatesFromAddresses(parsedCode, localAddresses);
}

function getPriorityCandidates(parsedCode: ParsedSessionCode) {
  return unique([
    parsedCode.hostIp,
    ...(parsedCode.hostCandidates || []),
  ]);
}

function getLanHostCandidatesFromAddresses(parsedCode: ParsedSessionCode, localAddresses: LanAddressInfo[]) {
  const localIps = localAddresses.map(info => info.address);
  const parsedIps = [parsedCode.hostIp, ...(parsedCode.hostCandidates || [])];
  return unique([
    parsedCode.hostIp,
    ...(parsedCode.hostCandidates || []),
    ...HOTSPOT_HOSTS,
    ...parsedIps.flatMap(subnetCandidates),
    ...localIps.flatMap(subnetCandidates),
  ]);
}

export async function discoverLanMaster(
  parsedCode: ParsedSessionCode,
  trace?: (step: string, metadata: Record<string, unknown>) => Promise<void>
) {
  const localAddresses = await getLanAddressInfos();
  const priorityCandidates = getPriorityCandidates(parsedCode);
  const candidates = getLanHostCandidatesFromAddresses(parsedCode, localAddresses);
  const port = Number(parsedCode.port || LAN_DEFAULT_PORT);
  const batchSize = 18;
  let lastError: string | null = null;

  await trace?.('start', {
    sessionId: parsedCode.sessionId,
    port,
    localAddresses,
    parsedHostIp: parsedCode.hostIp || null,
    parsedHostCandidates: parsedCode.hostCandidates || [],
    priorityCandidates,
    totalCandidates: candidates.length,
    candidateSample: candidates.slice(0, 16),
  });

  for (let index = 0; index < priorityCandidates.length; index += 1) {
    const host = priorityCandidates[index];
    try {
      const response = await sendLanRpc(host, port, {
        type: 'LAN_RPC',
        id: makeRpcId(),
        method: 'DISCOVER',
        sessionId: parsedCode.sessionId,
        payload: { code: parsedCode.sessionId },
        at: new Date().toISOString(),
      }, 1800);

      if (response.ok) {
        await trace?.('discovered', {
          stage: 'priority',
          host,
          port,
          tested: index + 1,
          totalCandidates: candidates.length,
        });
        return {
          host,
          port,
          response,
          candidates,
        };
      }

      lastError = response.error || 'Resposta DISCOVER recusada.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await trace?.('priority_failed', {
      host,
      port,
      tested: index + 1,
      totalPriorityCandidates: priorityCandidates.length,
      lastError,
    });
  }

  const prioritySet = new Set(priorityCandidates);
  const scanCandidates = candidates.filter(host => !prioritySet.has(host));

  for (let index = 0; index < scanCandidates.length; index += batchSize) {
    const batch = scanCandidates.slice(index, index + batchSize);
    const attempts = await Promise.all(
      batch.map(async host => {
        try {
          const response = await sendLanRpc(host, port, {
            type: 'LAN_RPC',
            id: makeRpcId(),
            method: 'DISCOVER',
            sessionId: parsedCode.sessionId,
            payload: { code: parsedCode.sessionId },
            at: new Date().toISOString(),
          }, 850);
          return { host, response };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          return null;
        }
      })
    );

    const found = attempts.find((attempt): attempt is { host: string; response: LanRpcResponse } => Boolean(attempt?.response?.ok));
    if (found) {
      await trace?.('discovered', {
        stage: 'scan',
        host: found.host,
        port,
        tested: priorityCandidates.length + index + batch.length,
        totalCandidates: candidates.length,
      });
      return {
        host: found.host,
        port,
        response: found.response,
        candidates,
      };
    }

    await trace?.('batch_failed', {
      batchStart: index,
      batchSize: batch.length,
      totalCandidates: candidates.length,
      candidateSample: batch.slice(0, 8),
      lastError,
    });
  }

  throw new Error(`Mesa LAN ${parsedCode.sessionId} nao encontrada nesta rede.`);
}
