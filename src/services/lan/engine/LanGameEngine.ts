import { appendLanEvent, createLanEventLogState, nextLanServerSeq, type LanEventLogState } from './LanEventLog';
import { commandToAuthoritativeEvent } from './LanCommandHandler';
import {
  applyLanAuthoritativeEvent,
  applyLanSnapshot,
  createEmptySessionProjection,
  createSessionProjectionFromState,
} from './LanReducer';
import type {
  LanAuthoritativeEvent,
  LanCommand,
  LanEngineResult,
  LanSnapshot,
  SessionProjection,
} from './LanTypes';

export class LanGameEngine {
  private projections = new Map<string, SessionProjection>();
  private eventLogs = new Map<string, LanEventLogState>();
  private rng?: () => number;

  constructor(initial?: { projections?: SessionProjection[]; events?: LanAuthoritativeEvent[]; rng?: () => number }) {
    this.rng = initial?.rng;
    for (const projection of initial?.projections || []) this.projections.set(projection.sessionId, projection);
    if (initial?.events?.length) {
      for (const event of initial.events) this.applyAuthoritativeEvent(event);
    }
  }

  ensureProjection(sessionId: string, state?: Parameters<typeof createSessionProjectionFromState>[1]) {
    const current = this.projections.get(sessionId);
    if (current) return current;
    const projection = state ? createSessionProjectionFromState(sessionId, state) : createEmptySessionProjection(sessionId);
    this.projections.set(sessionId, projection);
    return projection;
  }

  applyCommand(command: LanCommand): LanEngineResult {
    const projection = this.ensureProjection(command.sessionId);
    if (projection.appliedCommandIds.has(command.commandId)) {
      return { projection, applied: false, reason: 'duplicate_command' };
    }
    const log = this.getEventLog(command.sessionId);
    const event = commandToAuthoritativeEvent(projection, command, {
      nextServerSeq: () => nextLanServerSeq(log),
      rng: this.rng,
    });
    const result = applyLanAuthoritativeEvent(projection, event);
    if (result.applied) {
      this.projections.set(command.sessionId, result.projection);
      this.eventLogs.set(command.sessionId, appendLanEvent(log, event));
    }
    return { ...result, event };
  }

  applyAuthoritativeEvent(event: LanAuthoritativeEvent): LanEngineResult {
    const projection = this.ensureProjection(event.sessionId);
    const result = applyLanAuthoritativeEvent(projection, event);
    if (result.applied) {
      this.projections.set(event.sessionId, result.projection);
      this.eventLogs.set(event.sessionId, appendLanEvent(this.getEventLog(event.sessionId), event));
    }
    return { ...result, event };
  }

  applySnapshot(snapshot: LanSnapshot): LanEngineResult {
    const result = applyLanSnapshot(this.projections.get(snapshot.sessionId) || null, snapshot);
    const projection = result.projection || this.ensureProjection(snapshot.sessionId);
    if (result.applied) this.projections.set(snapshot.sessionId, projection);
    return { projection, applied: result.applied, reason: result.reason };
  }

  rebuildFromEvents(events: LanAuthoritativeEvent[]): SessionProjection {
    if (events.length === 0) throw new Error('Nao ha eventos para reconstruir projection.');
    const sessionId = events[0].sessionId;
    let current: SessionProjection = createEmptySessionProjection(sessionId);
    for (const event of events.sort((a, b) => a.serverSeq - b.serverSeq)) {
      const result = applyLanAuthoritativeEvent(current, event);
      current = result.projection;
    }
    this.projections.set(sessionId, current);
    this.eventLogs.set(sessionId, createLanEventLogState(events));
    return current;
  }

  getProjection(sessionId: string): SessionProjection | null {
    return this.projections.get(sessionId) || null;
  }

  reset() {
    this.projections.clear();
    this.eventLogs.clear();
  }

  private getEventLog(sessionId: string) {
    const current = this.eventLogs.get(sessionId);
    if (current) return current;
    const next = createLanEventLogState();
    this.eventLogs.set(sessionId, next);
    return next;
  }
}

export const lanGameEngine = new LanGameEngine();
