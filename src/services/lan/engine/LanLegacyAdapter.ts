import type { LanSessionEvent } from '../../lanSession';
import type { LanAggregateType, LanAuthoritativeEvent, SessionProjection } from './LanTypes';

export function legacyLanEventToAuthoritativeEvent(
  projection: SessionProjection,
  event: LanSessionEvent,
): LanAuthoritativeEvent {
  const aggregateType = getLegacyAggregateType(event);
  const aggregateId = getLegacyAggregateId(projection.sessionId, event, aggregateType);
  return {
    eventId: event.id,
    commandId: event.clientMsgId,
    sessionId: event.sessionId,
    type: normalizeLegacyEventType(event),
    aggregateType,
    aggregateId,
    aggregateRevision: readLegacyAggregateRevision(projection, event, aggregateType, aggregateId),
    serverSeq: Math.max(0, Math.floor(Number(event.serverSeq || event.seq || 0) || 0)),
    createdAt: event.createdAt || new Date(0).toISOString(),
    payload: legacyPayload(event, aggregateId),
  };
}

function legacyPayload(event: LanSessionEvent, aggregateId: string) {
  if (event.type === 'effect_save_request') {
    const savePatch = (event as any).pendingSavePatch;
    if (savePatch) return savePatch;
    const save = (event as any).saveRequest || {};
    return {
      action: 'create',
      save: {
        id: String(save.id || event.id),
        sessionId: event.sessionId,
        targetKey: String(save.targetKey || event.toKey || aggregateId),
        sourceType: 'effect',
        sourceId: String(save.sourceId || event.id),
        sourceName: String(save.sourceName || event.fromName || 'Teste de resistencia'),
        effectPayload: save.effectPayload || {},
        ability: String(save.saveAbility || save.ability || 'CON').toUpperCase(),
        dc: save.dc ?? null,
        status: 'pending',
        result: {},
        createdAt: event.createdAt || new Date(0).toISOString(),
        resolvedAt: null,
      },
    };
  }
  if (event.type === 'player_patch') {
    return { targetKey: aggregateId, patch: event.numberPatch || {} };
  }
  if (event.type === 'inventory_patch') {
    return {
      targetKey: event.inventoryPatch?.targetKey || aggregateId,
      equipment: event.inventoryPatch?.equipment || {},
      stats: event.statsPatch,
      itemDelta: event.inventoryPatch?.itemDelta,
    };
  }
  if (event.type === 'effect_patch') {
    return {
      targetKey: event.effectPatch?.targetKey || aggregateId,
      add: event.effectPatch?.add || [],
      update: event.effectPatch?.update || [],
      remove: event.effectPatch?.remove || [],
      numberPatch: event.numberPatch,
    };
  }
  if (['character_transaction', 'party_transaction', 'spell_transaction', 'reward_transaction'].includes(String(event.type))) {
    const payload = (event as any).characterTransaction || event;
    return {
      ...payload,
      targetKey: payload.targetKey || (event as any).targetKey || aggregateId,
      changes: payload.changes || (event as any).changes,
      rolls: payload.rolls || (event as any).rolls,
    };
  }
  if (event.type === 'pending_save_patch') return event.pendingSavePatch || {};
  if (event.type === 'session_patch') return event.sessionPatch || {};
  if (event.type === 'session_ended') return event.sessionEnded || {};
  return event;
}

function normalizeLegacyEventType(event: LanSessionEvent) {
  if (event.type === 'effect_save_request') return 'pending_save_patch';
  return event.type;
}

function getLegacyAggregateType(event: LanSessionEvent): LanAggregateType {
  if (event.type === 'session_patch' || event.type === 'session_ended') return 'session';
  if (event.type === 'effect_patch' || event.type === 'effect_expired') return 'effect';
  if (event.type === 'inventory_patch' || String(event.type).includes('send_item')) return 'inventory';
  if (['character_transaction', 'party_transaction', 'spell_transaction', 'reward_transaction'].includes(String(event.type))) return 'transaction';
  if (event.type === 'pending_save_patch' || String(event.type).includes('save')) return 'pending_save';
  if (String(event.type).startsWith('trade_')) return 'trade';
  return 'player';
}

function getLegacyAggregateId(sessionId: string, event: LanSessionEvent, aggregateType: LanAggregateType) {
  if (aggregateType === 'session') return sessionId;
  const target = event.inventoryPatch?.targetKey || event.effectPatch?.targetKey || event.toKey || event.fromKey;
  if (!target || ['master', 'all', 'party', 'session'].includes(String(target))) return `${sessionId}:unknown`;
  return String(target);
}

function readLegacyAggregateRevision(
  projection: SessionProjection,
  event: LanSessionEvent,
  aggregateType: LanAggregateType,
  aggregateId: string,
) {
  const explicit = Math.max(0, Math.floor(Number((event as any).aggregateRevision || 0) || 0));
  if (explicit > 0) return explicit;

  const legacy = Math.max(0, Math.floor(Number(event.entityRevision || 0) || 0));
  if (legacy > 0 && legacy < 1000000) return legacy;

  if (aggregateType === 'session') return projection.versions.session + 1;
  if (aggregateType === 'player') return (projection.versions.players[aggregateId] || 0) + 1;
  if (aggregateType === 'inventory') return (projection.versions.inventories[aggregateId] || 0) + 1;
  if (aggregateType === 'effect') return (projection.versions.effects[aggregateId] || 0) + 1;
  if (aggregateType === 'pending_save') return (projection.versions.pendingSaves[aggregateId] || 0) + 1;
  if (aggregateType === 'trade') return (projection.versions.trades[aggregateId] || 0) + 1;
  return 1;
}
