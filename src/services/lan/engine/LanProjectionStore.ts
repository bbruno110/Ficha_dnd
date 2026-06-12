import {
  applyLanAuthoritativeEvent,
  applyLanSnapshot,
  createSessionProjectionFromState,
} from './LanReducer';
import { legacyLanEventToAuthoritativeEvent } from './LanLegacyAdapter';
import type {
  CharacterProjection,
  SessionProjection,
} from './LanTypes';

export type { CharacterProjection, SessionProjection };

export type LanEntityRevisions = {
  playerRevision: number;
  effectRevision: number;
  inventoryRevision: number;
  sessionRevision: number;
  pendingSaveRevision: number;
  tradeRevision: number;
};

export type ProjectionApplyResult = {
  projection: SessionProjection;
  applied: boolean;
  reason: 'applied' | 'duplicate_event' | 'old_revision' | 'ignored_snapshot' | string;
};

type LegacyProjectionEvent = Record<string, any> & {
  id: string;
  sessionId: string;
  type: string;
  fromKey?: string;
  toKey?: string;
  seq?: number;
  serverSeq?: number;
  entityRevision?: number;
};

type LegacyProjectionSessionState = {
  status?: 'active' | 'paused' | 'ended';
  currentTurn?: number;
  elapsedMinutes?: number;
  players?: Array<Record<string, any>>;
};

export function createSessionProjection(sessionId: string, state?: LegacyProjectionSessionState | null): SessionProjection {
  return createSessionProjectionFromState(sessionId, state);
}

export function applyEventToProjection(
  projection: SessionProjection,
  event: LegacyProjectionEvent,
): ProjectionApplyResult {
  const authoritative = legacyLanEventToAuthoritativeEvent(projection, event as any);
  const result = applyLanAuthoritativeEvent(projection, authoritative);
  return {
    projection: result.projection,
    applied: result.applied,
    reason: normalizeReason(result.reason),
  };
}

export function applySnapshotToProjection(
  projection: SessionProjection,
  snapshot: LegacyProjectionSessionState,
  snapshotRevision = 0,
): ProjectionApplyResult {
  const result = applyLanSnapshot(projection, {
    sessionId: projection.sessionId,
    serverSeq: Math.max(0, Math.floor(Number(snapshotRevision || 0) || 0)),
    structural: snapshotRevision <= 0,
    state: snapshot,
    versions: snapshotRevision > 0 ? { session: snapshotRevision } : undefined,
  });
  return {
    projection: result.projection || projection,
    applied: result.applied,
    reason: normalizeReason(result.reason),
  };
}

function normalizeReason(reason?: string): ProjectionApplyResult['reason'] {
  if (reason === 'duplicate_command') return 'duplicate_event';
  if (reason === 'old_revision') return 'old_revision';
  if (reason === 'ignored_snapshot') return 'ignored_snapshot';
  if (reason === 'duplicate_event') return 'duplicate_event';
  return 'applied';
}
