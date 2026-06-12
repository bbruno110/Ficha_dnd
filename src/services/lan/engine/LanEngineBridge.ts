import type { LanSessionEvent } from '../../lanSession';
import { lanGameEngine } from './LanGameEngine';
import { legacyLanEventToAuthoritativeEvent } from './LanLegacyAdapter';
import type {
  LanAuthoritativeEvent,
  LanCommand,
  LanEngineResult,
  LanSnapshot,
  SessionProjection,
} from './LanTypes';

type ProjectionListener = (projection: SessionProjection | null) => void;
type ProjectionSink = (sessionId: string, projection: SessionProjection | null) => void;

const listeners = new Map<string, Set<ProjectionListener>>();
const projectionSinks = new Set<ProjectionSink>();

export function getLanProjection(sessionId: string): SessionProjection | null {
  return lanGameEngine.getProjection(sessionId);
}

export function dispatchMasterCommand(command: LanCommand): LanEngineResult {
  const result = lanGameEngine.applyCommand(command);
  publishLanProjection(command.sessionId, result.projection);
  return result;
}

export function dispatchPlayerCommand(command: LanCommand): LanEngineResult {
  const result = lanGameEngine.applyCommand(command);
  publishLanProjection(command.sessionId, result.projection);
  return result;
}

export function applyIncomingLanEvent(event: LanAuthoritativeEvent): LanEngineResult {
  const result = lanGameEngine.applyAuthoritativeEvent(event);
  publishLanProjection(event.sessionId, result.projection);
  return result;
}

export function applyIncomingLegacyLanEvent(event: LanSessionEvent): LanEngineResult {
  const projection = lanGameEngine.ensureProjection(event.sessionId);
  const authoritative = legacyLanEventToAuthoritativeEvent(projection, event);
  return applyIncomingLanEvent(authoritative);
}

export function applyIncomingSnapshot(snapshot: LanSnapshot): LanEngineResult {
  const result = lanGameEngine.applySnapshot(snapshot);
  publishLanProjection(snapshot.sessionId, result.projection);
  return result;
}

export function subscribeLanProjection(
  sessionId: string,
  listener: ProjectionListener,
): () => void {
  const set = listeners.get(sessionId) || new Set<ProjectionListener>();
  set.add(listener);
  listeners.set(sessionId, set);
  listener(getLanProjection(sessionId));
  return () => {
    const current = listeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(sessionId);
  };
}

export function publishLanProjection(sessionId: string, projection: SessionProjection | null) {
  for (const sink of projectionSinks) sink(sessionId, projection);
  for (const listener of listeners.get(sessionId) || []) listener(projection);
}

export function registerLanProjectionSink(sink: ProjectionSink): () => void {
  projectionSinks.add(sink);
  return () => {
    projectionSinks.delete(sink);
  };
}

export function resetLanEngineBridgeForTests() {
  lanGameEngine.reset();
  listeners.clear();
  projectionSinks.clear();
}
