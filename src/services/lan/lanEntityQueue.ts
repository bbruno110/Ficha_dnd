import { debugLanFlow } from '../lanRuntimeMode';
import type { LanSessionEvent } from '../lanSession';

/**
 * Fila concorrente por entidade LAN.
 *
 * Objetivo:
 * - operações que mexem no mesmo jogador/inventário/sessão rodam em ordem;
 * - operações independentes rodam em paralelo;
 * - ações com dois jogadores (envio/troca) travam os dois inventários ao mesmo tempo.
 */
const entityQueues = new Map<string, Promise<unknown>>();
const activeCounts = new Map<string, number>();

export function normalizeLanQueueKey(value: unknown) {
  return String(value || '').trim();
}

export function uniqueSortedLanQueueKeys(keys: Array<string | undefined | null>) {
  return Array.from(new Set(
    keys.map(normalizeLanQueueKey).filter(Boolean)
  )).sort();
}

export function enqueueLanEntityMutation<T>(
  keys: Array<string | undefined | null>,
  task: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const queueKeys = uniqueSortedLanQueueKeys(keys);
  if (queueKeys.length === 0) return task();

  const previous = Promise.all(queueKeys.map((key) => entityQueues.get(key)?.catch(() => undefined)));
  const startedAt = Date.now();

  const run = previous.then(async () => {
    for (const key of queueKeys) activeCounts.set(key, (activeCounts.get(key) || 0) + 1);
    debugLanFlow('LAN_ENTITY_QUEUE_START', {
      keys: queueKeys,
      waitMs: Date.now() - startedAt,
      ...meta,
    });
    try {
      return await task();
    } finally {
      debugLanFlow('LAN_ENTITY_QUEUE_DONE', {
        keys: queueKeys,
        durationMs: Date.now() - startedAt,
        ...meta,
      });
      for (const key of queueKeys) {
        const nextCount = Math.max(0, (activeCounts.get(key) || 1) - 1);
        if (nextCount <= 0) activeCounts.delete(key);
        else activeCounts.set(key, nextCount);
      }
    }
  });

  for (const key of queueKeys) {
    entityQueues.set(
      key,
      run.catch((error) => {
        debugLanFlow('LAN_ENTITY_QUEUE_ERROR', {
          key,
          reason: error instanceof Error ? error.message : String(error),
          ...meta,
        });
      }).finally(() => {
        if (entityQueues.get(key) === run) entityQueues.delete(key);
      })
    );
  }

  return run;
}

export function getLanPlayerQueueKey(sessionId: string, playerKeyOrId: unknown) {
  return `${sessionId}:player:${normalizeLanQueueKey(playerKeyOrId)}`;
}

export function getLanInventoryQueueKey(sessionId: string, playerKeyOrId: unknown) {
  return `${sessionId}:inventory:${normalizeLanQueueKey(playerKeyOrId)}`;
}

export function getLanSessionQueueKey(sessionId: string) {
  return `${sessionId}:session`;
}

export function getLanRequestQueueKey(sessionId: string, requestId: unknown) {
  return `${sessionId}:request:${normalizeLanQueueKey(requestId)}`;
}

export function getLanInventoryParticipantKeys(event: LanSessionEvent) {
  const anyEvent = event as any;
  if (event.type === 'send_item_request' || event.type === 'send_item' || event.type === 'send_item_result') {
    return uniqueSortedLanQueueKeys([
      event.sendItemRequest?.fromKey,
      event.sendItemRequest?.toKey,
      anyEvent.fromPlayerKey,
      anyEvent.toPlayerKey,
      event.fromKey !== 'master' ? event.fromKey : undefined,
      event.toKey !== 'master' ? event.toKey : undefined,
    ]);
  }

  if (String(event.type || '').startsWith('trade_')) {
    return uniqueSortedLanQueueKeys([
      event.tradeAccept?.fromKey,
      event.tradeAccept?.toKey,
      anyEvent.offeringKey,
      anyEvent.acceptingKey,
      anyEvent.fromPlayerKey,
      anyEvent.toPlayerKey,
      event.fromKey !== 'master' ? event.fromKey : undefined,
      event.toKey !== 'master' ? event.toKey : undefined,
    ]);
  }

  if (event.type === 'inventory_patch') {
    return uniqueSortedLanQueueKeys([
      event.inventoryPatch?.targetKey,
      event.toKey !== 'master' ? event.toKey : undefined,
      event.fromKey !== 'master' ? event.fromKey : undefined,
    ]);
  }

  return uniqueSortedLanQueueKeys([
    event.toKey !== 'master' ? event.toKey : undefined,
    event.fromKey !== 'master' ? event.fromKey : undefined,
  ]);
}

export function getLanEventEntityType(event: LanSessionEvent) {
  if (event.type === 'session_patch' || event.type === 'session_ended' || event.type === 'timeline_event') return 'session';
  if (
    event.type === 'inventory_patch' ||
    event.type === 'send_item' ||
    event.type === 'send_item_request' ||
    event.type === 'send_item_result' ||
    String(event.type || '').startsWith('trade_')
  ) return 'inventory';
  if (event.type === 'effect_patch' || event.type === 'effect_catalog_patch' || event.type === 'effect_expired') return 'effect';
  if (event.type === 'effect_save_request' || event.type === 'effect_save_result' || event.type === 'pending_save_patch') return 'save';
  if (event.type.includes('action') || event.type.includes('skill') || event.type.includes('spell') || event.type.includes('ability')) return 'action';
  if (event.type === 'resource_request' || event.type === 'resource_review' || event.type === 'character_update_review') return 'request';
  return 'player';
}

export function getLanEventEntityId(event: LanSessionEvent) {
  const entityType = event.entityType || getLanEventEntityType(event);
  if (entityType === 'session') return event.sessionId;
  if (entityType === 'inventory') {
    const participants = getLanInventoryParticipantKeys(event);
    if (participants.length > 0) return participants.join('|');
    return event.inventoryPatch?.targetKey || event.toKey || event.fromKey || event.tradeId || event.sessionId;
  }
  if (entityType === 'player') {
    return event.toKey && event.toKey !== 'master' ? event.toKey : event.fromKey || event.entityId || event.sessionId;
  }
  if (entityType === 'effect') return event.effectPatch?.targetKey || event.toKey || event.fromKey || event.entityId || event.sessionId;
  if (entityType === 'request') return event.tradeId || event.clientMsgId || event.id || event.fromKey || event.sessionId;
  return event.entityId || event.toKey || event.fromKey || event.tradeId || event.sessionId;
}

export function getLanEventQueueKeys(event: LanSessionEvent) {
  const entityType = event.entityType || getLanEventEntityType(event);
  if (entityType === 'inventory') {
    const participants = getLanInventoryParticipantKeys(event);
    return participants.length > 0
      ? participants.map((key) => getLanInventoryQueueKey(event.sessionId, key))
      : [getLanInventoryQueueKey(event.sessionId, getLanEventEntityId(event))];
  }
  if (entityType === 'session') return [getLanSessionQueueKey(event.sessionId)];
  if (entityType === 'request') return [getLanRequestQueueKey(event.sessionId, event.clientMsgId || event.id)];
  return [getLanPlayerQueueKey(event.sessionId, getLanEventEntityId(event))];
}

export function isLanEntityQueueBusy(key: string) {
  return (activeCounts.get(key) || 0) > 0;
}
