import type { LanSessionEvent, LanSessionEventType } from '../lanSession';

export const LAN_NETWORK_LIMITS = {
  heartbeatActiveMs: 8000,
  heartbeatPausedMs: 15000,
  heartbeatTimeoutMs: 24000,
  fallbackPollActiveMs: 1500,
  reconnectBackoffBaseMs: 1200,
  resyncMinIntervalMs: 10000,
  maxEventsPerResync: 40,
  socketQueueMaxPending: 200,
};

const CRITICAL_SESSION_EVENTS = new Set<LanSessionEventType>([
  'session_patch',
  'session_ended',
  'player_kicked',
]);

const CRITICAL_ACK_EVENTS = new Set<LanSessionEventType>([
  'player_patch',
  'effect_patch',
  'inventory_patch',
  'session_patch',
  'session_ended',
  'player_kicked',
  'trade_result',
  'send_item_result',
  'pending_save_patch',
]);

const LOW_VALUE_TRACE_ENVELOPES = new Set([
  'heartbeat',
  'heartbeat_ack',
  'ack',
]);

export type LanEventAudience = 'master' | 'target' | 'participants' | 'broadcast' | 'none';

export function isCriticalLanSessionEvent(event: Pick<LanSessionEvent, 'type'>) {
  return CRITICAL_SESSION_EVENTS.has(event.type);
}

export function shouldLanEventRequireAck(event: Pick<LanSessionEvent, 'type' | 'toKey'>) {
  if (event.toKey === 'master' || event.toKey === 'session') return false;
  return CRITICAL_ACK_EVENTS.has(event.type);
}

export function getLanEventAudience(event: Pick<LanSessionEvent, 'type' | 'toKey' | 'fromKey'>): LanEventAudience {
  if (event.toKey === 'master') return 'master';
  if (event.toKey === 'party' || event.toKey === 'all' || event.toKey === 'session') return 'broadcast';
  if (event.type === 'session_patch' || event.type === 'session_ended') return 'broadcast';
  if (event.type === 'player_joined' && (event.toKey === 'session' || event.toKey === 'party' || event.toKey === 'all')) return 'broadcast';
  if (event.type === 'timeline_event') return 'broadcast';
  if (event.type.startsWith('trade_')) return 'participants';
  if (event.type === 'send_item' || event.type === 'send_item_request' || event.type === 'send_item_result') return 'participants';
  if (event.toKey) return 'target';
  return 'none';
}

export function getLanEventRoutingKeys(event: Pick<LanSessionEvent, 'fromKey' | 'toKey' | 'type'>) {
  const keys = new Set<string>();
  const audience = getLanEventAudience(event);

  if (audience === 'target' || audience === 'participants') {
    if (event.toKey && event.toKey !== 'master' && event.toKey !== 'party' && event.toKey !== 'session' && event.toKey !== 'all') {
      keys.add(event.toKey);
    }
  }

  if (audience === 'participants') {
    if (event.fromKey && event.fromKey !== 'master' && event.fromKey !== 'party' && event.fromKey !== 'session' && event.fromKey !== 'all') {
      keys.add(event.fromKey);
    }
  }

  return [...keys];
}

export function isBroadcastLanEvent(event: Pick<LanSessionEvent, 'type' | 'toKey' | 'fromKey'>) {
  return getLanEventAudience(event) === 'broadcast';
}

export function shouldTraceLanEnvelope(envelopeType: string, eventType?: string) {
  if (LOW_VALUE_TRACE_ENVELOPES.has(envelopeType)) return false;
  if (eventType === 'timeline_event') return false;
  return true;
}

export function getHeartbeatIntervalForSessionStatus(status?: string) {
  return status === 'paused' ? LAN_NETWORK_LIMITS.heartbeatPausedMs : LAN_NETWORK_LIMITS.heartbeatActiveMs;
}
