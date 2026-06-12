import type { LanAuthoritativeEvent } from './LanTypes';

export type LanEventLogState = {
  events: LanAuthoritativeEvent[];
  nextServerSeq: number;
};

export function createLanEventLogState(events: LanAuthoritativeEvent[] = []): LanEventLogState {
  const nextServerSeq = events.reduce((max, event) => Math.max(max, Number(event.serverSeq || 0)), 0) + 1;
  return { events: [...events], nextServerSeq };
}

export function appendLanEvent(log: LanEventLogState, event: LanAuthoritativeEvent): LanEventLogState {
  if (log.events.some((entry) => entry.eventId === event.eventId)) return log;
  return {
    events: [...log.events, event],
    nextServerSeq: Math.max(log.nextServerSeq, Number(event.serverSeq || 0) + 1),
  };
}

export function nextLanServerSeq(log: LanEventLogState) {
  return Math.max(1, Math.floor(Number(log.nextServerSeq || 1) || 1));
}
