import type { LanEventApplyDecision } from '@/stores/lanRealtimeStore';

import type { LanSessionEvent } from '../lanSession';

const LIVE_EVENT_TYPES = new Set<LanSessionEvent['type']>([
  'player_patch',
  'effect_patch',
  'inventory_patch',
  'session_patch',
  'player_kicked',
  'resource_review',
  'send_item',
  'trade_offer',
  'trade_accept',
  'trade_decline',
  'spell_hp',
  'spell_effect',
  'effect_expired',
  'pending_save_patch',
  'public_status',
]);

export function isLanLiveCommittedEvent(event: LanSessionEvent) {
  return LIVE_EVENT_TYPES.has(event.type);
}

export function isLanSessionWideEvent(event: LanSessionEvent) {
  return event.toKey === 'session' ||
    event.toKey === 'party' ||
    event.toKey === 'all' ||
    event.type === 'session_patch' ||
    event.type === 'timeline_event' ||
    event.type === 'public_status';
}

export function isLanEventTargetedToPlayer(
  event: LanSessionEvent,
  input: {
    sessionId: string;
    selfKey?: string;
    characterName?: string;
  },
) {
  if (event.sessionId !== input.sessionId) return false;
  if (!isLanLiveCommittedEvent(event)) return false;
  if (event.toKey === 'master') return false;
  if (isLanSessionWideEvent(event)) return true;
  if (input.selfKey && event.toKey === input.selfKey) return true;
  if (input.characterName && event.toName === input.characterName) return true;
  return false;
}

export function shouldObserveLanEventSeq(
  event: LanSessionEvent,
  sessionId: string,
) {
  return event.sessionId === sessionId &&
    isLanLiveCommittedEvent(event) &&
    Number(event.seq || event.serverSeq || 0) > 0;
}

export function shouldRequestLanResync(decision: LanEventApplyDecision) {
  return decision.reason === 'entity_revision_gap';
}
