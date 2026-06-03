import type { LanEventApplyDecision } from '@/stores/lanRealtimeStore';

import type { LanSessionEvent } from '../lanSession';

const LIVE_EVENT_TYPES = new Set<LanSessionEvent['type']>([
  'action_result',
  'skill_result',
  'spell_cast_result',
  'ability_use_result',
  'public_action_result',
  'effect_save_request',
  'player_patch',
  'effect_patch',
  'inventory_patch',
  'effect_catalog_patch',
  'session_patch',
  'session_ended',
  'timeline_event',
  'player_kicked',
  'character_update_review',
  'resource_review',
  'send_item',
  'send_item_result',
  'trade_offer',
  'trade_accept',
  'trade_decline',
  'trade_result',
  'spell_hp',
  'spell_effect',
  'effect_expired',
  'pending_save_patch',
  'public_status',
]);

type PlayerRoutingInput = {
  sessionId: string;
  selfKey?: string;
  characterName?: string;
  includeGlobal?: boolean;
};

export function isLanLiveCommittedEvent(event: LanSessionEvent) {
  return LIVE_EVENT_TYPES.has(event.type);
}

export function isLanSessionGlobalEvent(event: LanSessionEvent) {
  if (event.type === 'session_ended') return true;
  if (event.type === 'timeline_event') {
    const visibility = String((event as any).visibility || '').toLowerCase();
    return visibility === 'public' ||
      visibility === 'party' ||
      event.toKey === 'all' ||
      event.toKey === 'party';
  }
  if (
    event.type === 'session_patch' &&
    event.entityType === 'session' &&
    (event.toKey === 'all' || event.toKey === 'party' || !event.toKey)
  ) return true;
  if (event.toKey === 'all' || event.toKey === 'party' || event.toKey === 'session') return true;
  if (event.entityType === 'session') return true;
  if (event.type === 'effect_catalog_patch' || event.type === 'public_status') return true;
  return false;
}

export function isLanEventForPlayer(
  event: LanSessionEvent,
  selfKey?: string,
  characterName?: string,
) {
  if (!selfKey && !characterName) return false;
  const anyEvent = event as any;
  if (selfKey) {
    if (event.toKey === selfKey) return true;
    if (event.entityId === selfKey) return true;
    if (anyEvent.playerPatch?.targetKey === selfKey) return true;
    if (event.effectPatch?.targetKey === selfKey) return true;
    if (event.inventoryPatch?.targetKey === selfKey) return true;
    if (anyEvent.saveRequest?.targetKey === selfKey) return true;
    if (anyEvent.saveResult?.targetKey === selfKey) return true;
    if (anyEvent.resourceReview?.targetKey === selfKey) return true;
    if (event.pendingSavePatch?.save?.targetKey === selfKey) return true;
  }
  if (characterName && event.toName === characterName) return true;
  return false;
}

export function isLanParticipantEvent(
  event: LanSessionEvent,
  selfKey?: string,
  characterName?: string,
) {
  if (!selfKey && !characterName) return false;
  const anyEvent = event as any;
  const participantKeys = [
    event.fromKey,
    event.toKey,
    anyEvent.sourceKey,
    anyEvent.targetKey,
    anyEvent.fromPlayerKey,
    anyEvent.toPlayerKey,
    ...(Array.isArray(anyEvent.participants) ? anyEvent.participants : []),
    ...(Array.isArray(anyEvent.participantKeys) ? anyEvent.participantKeys : []),
  ].filter(Boolean).map(String);
  if (selfKey && participantKeys.includes(selfKey)) return true;

  const participantNames = [
    event.fromName,
    event.toName,
    anyEvent.sourceName,
    anyEvent.targetName,
    ...(Array.isArray(anyEvent.participantNames) ? anyEvent.participantNames : []),
  ].filter(Boolean).map(String);
  if (characterName && participantNames.includes(characterName)) return true;

  return false;
}

export function shouldPlayerProcessLanEvent(
  event: LanSessionEvent,
  input: PlayerRoutingInput,
) {
  if (event.sessionId !== input.sessionId) return false;
  if (!isLanLiveCommittedEvent(event)) return false;
  if (input.includeGlobal !== false && isLanSessionGlobalEvent(event)) return true;
  if (event.toKey === 'master') return false;
  if (isLanEventForPlayer(event, input.selfKey, input.characterName)) return true;
  if (isLanParticipantEvent(event, input.selfKey, input.characterName)) return true;
  return false;
}

export function isLanSessionWideEvent(event: LanSessionEvent) {
  return isLanSessionGlobalEvent(event);
}

export function isLanEventTargetedToPlayer(
  event: LanSessionEvent,
  input: {
    sessionId: string;
    selfKey?: string;
    characterName?: string;
  },
) {
  return shouldPlayerProcessLanEvent(event, input);
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
  return decision.reason === 'seq_gap';
}
