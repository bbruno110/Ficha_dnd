import type { LanAggregateType, LanSnapshot, SessionProjection } from './LanTypes';

export function shouldApplyLanSnapshot(current: SessionProjection | null, snapshot: LanSnapshot) {
  if (!current) return true;
  if (snapshot.sessionId !== current.sessionId) return false;
  if (current.tombstones.endedSessionIds.has(snapshot.sessionId)) return false;
  const incomingSeq = Math.max(0, Math.floor(Number(snapshot.serverSeq || 0) || 0));
  if (incomingSeq > 0 && incomingSeq < current.serverSeq) return false;
  if (!snapshot.versions && current.appliedEventIds.size > 0) return false;
  return true;
}

export function getAggregateVersion(projection: SessionProjection, aggregateType: LanAggregateType, aggregateId: string) {
  if (aggregateType === 'session') return projection.versions.session;
  if (aggregateType === 'player') return projection.versions.players[aggregateId] || 0;
  if (aggregateType === 'inventory') return projection.versions.inventories[aggregateId] || 0;
  if (aggregateType === 'effect') return projection.versions.effects[aggregateId] || 0;
  if (aggregateType === 'pending_save') return projection.versions.pendingSaves[aggregateId] || 0;
  if (aggregateType === 'trade') return projection.versions.trades[aggregateId] || 0;
  return Math.max(
    projection.versions.players[aggregateId] || 0,
    projection.versions.inventories[aggregateId] || 0,
    projection.versions.effects[aggregateId] || 0,
  );
}

export function setAggregateVersion(
  projection: SessionProjection,
  aggregateType: LanAggregateType,
  aggregateId: string,
  revision: number,
) {
  const safeRevision = Math.max(0, Math.floor(Number(revision || 0) || 0));
  if (aggregateType === 'session') projection.versions.session = Math.max(projection.versions.session, safeRevision);
  else if (aggregateType === 'player') projection.versions.players[aggregateId] = Math.max(projection.versions.players[aggregateId] || 0, safeRevision);
  else if (aggregateType === 'inventory') projection.versions.inventories[aggregateId] = Math.max(projection.versions.inventories[aggregateId] || 0, safeRevision);
  else if (aggregateType === 'effect') projection.versions.effects[aggregateId] = Math.max(projection.versions.effects[aggregateId] || 0, safeRevision);
  else if (aggregateType === 'pending_save') projection.versions.pendingSaves[aggregateId] = Math.max(projection.versions.pendingSaves[aggregateId] || 0, safeRevision);
  else if (aggregateType === 'trade') projection.versions.trades[aggregateId] = Math.max(projection.versions.trades[aggregateId] || 0, safeRevision);
  else {
    projection.versions.players[aggregateId] = Math.max(projection.versions.players[aggregateId] || 0, safeRevision);
    projection.versions.inventories[aggregateId] = Math.max(projection.versions.inventories[aggregateId] || 0, safeRevision);
    projection.versions.effects[aggregateId] = Math.max(projection.versions.effects[aggregateId] || 0, safeRevision);
  }
}
