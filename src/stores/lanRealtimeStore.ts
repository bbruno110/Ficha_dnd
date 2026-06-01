import { create } from 'zustand';

import { traceApp } from '@/services/debug/appTrace';
import type { LanSessionEvent, LanSessionPlayerState } from '@/services/lanSession';

export type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;

export type RuntimeEntityState = {
  revision: number;
  lastSeq: number;
  updatedAt: number;
};

export type PendingEvent = {
  event: LanSessionEvent;
  createdAt: number;
  status: 'pending' | 'acked' | 'nacked';
  reason?: string;
};

export type LanEventApplyDecision = {
  apply: boolean;
  reason?: 'duplicate_id' | 'old_seq' | 'old_entity_revision' | 'entity_revision_gap' | 'missing_id';
  entityKey?: string;
  currentRevision?: number;
  nextRevision?: number;
  lastAppliedSeq?: number;
  expectedSeq?: number;
  receivedSeq?: number;
};

export type LanRealtimeState = {
  sessionId?: string;
  clientId?: string;
  playerKey?: string;
  connected: boolean;
  lastAppliedSeq: number;
  appliedEventIds: Record<string, true>;
  entityVersions: Record<string, RuntimeEntityState>;
  pendingEvents: Record<string, PendingEvent>;

  setConnection: (state: { sessionId?: string; clientId?: string; playerKey?: string; connected: boolean }) => void;
  getEventApplyDecision: (event: LanSessionEvent) => LanEventApplyDecision;
  shouldApplyEvent: (event: LanSessionEvent) => boolean;
  markEventApplied: (event: LanSessionEvent) => void;
  applyOptimisticEvent: (event: LanSessionEvent) => void;
  ackEvent: (eventId: string) => void;
  nackEvent: (eventId: string, reason?: string) => void;
  resetSession: (sessionId?: string) => void;
};

const inferEntityType = (event: LanSessionEvent) => {
  if (event.type === 'session_patch' || event.type === 'timeline_event') return 'session';
  if (event.type === 'inventory_patch' || event.type === 'send_item' || event.type.startsWith('trade_')) return 'inventory';
  if (event.type === 'effect_patch' || event.type === 'effect_catalog_patch' || event.type === 'effect_expired') return 'effect';
  if (event.type === 'resource_request' || event.type === 'resource_review' || event.type === 'pending_save_patch') return 'request';
  return 'player';
};

const getEntityKey = (event: LanSessionEvent) => {
  const entityType = event.entityType || inferEntityType(event);
  const entityId = event.entityId || event.toKey || event.fromKey || event.tradeId || event.sessionId;
  return `${event.sessionId}:${entityType}:${entityId}`;
};

const getRevision = (event: LanSessionEvent) => Number(event.entityRevision ?? event.seq ?? 0) || 0;

export const useLanRealtimeStore = create<LanRealtimeState>((set, get) => ({
  connected: false,
  lastAppliedSeq: 0,
  appliedEventIds: {},
  entityVersions: {},
  pendingEvents: {},

  setConnection: (next) => {
    traceApp('STATE_CHANGE', 'LAN_REALTIME_CONNECTION_SET', {
      source: 'lanRealtimeStore',
      sessionId: next.sessionId,
      playerKey: next.playerKey,
      after: next,
    });
    set((state) => ({ ...state, ...next }));
  },

  getEventApplyDecision: (event) => {
    const state = get();
    if (!event?.id) return { apply: false, reason: 'missing_id' };
    if (state.appliedEventIds[event.id]) return { apply: false, reason: 'duplicate_id' };

    const entityKey = getEntityKey(event);
    const current = state.entityVersions[entityKey];
    const nextRevision = getRevision(event);
    const eventSeq = Number(event.seq || event.serverSeq || 0);

    if (current && nextRevision > 0 && nextRevision <= current.revision) {
      return {
        apply: false,
        reason: 'old_entity_revision',
        entityKey,
        currentRevision: current.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
      };
    }

    if (current && nextRevision > 0 && nextRevision > current.revision + 1) {
      return {
        apply: false,
        reason: 'entity_revision_gap',
        entityKey,
        currentRevision: current.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
      };
    }

    if (current && eventSeq > 0 && eventSeq <= current.lastSeq) {
      return {
        apply: false,
        reason: 'old_seq',
        entityKey,
        currentRevision: current?.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
      };
    }

    return {
      apply: true,
      entityKey,
      currentRevision: current?.revision,
      nextRevision,
      lastAppliedSeq: state.lastAppliedSeq,
    };
  },

  shouldApplyEvent: (event) => get().getEventApplyDecision(event).apply,

  markEventApplied: (event) => set((state) => {
    const entityKey = getEntityKey(event);
    const current = state.entityVersions[entityKey];
    const nextRevision = Math.max(current?.revision || 0, getRevision(event));
    const eventSeq = Number(event.seq || event.serverSeq || 0);
    const nextAppliedSeq = Math.max(state.lastAppliedSeq, eventSeq);
    const nextEntitySeq = Math.max(current?.lastSeq || 0, eventSeq);

    const nextState: Pick<LanRealtimeState, 'appliedEventIds' | 'lastAppliedSeq' | 'entityVersions'> = {
      appliedEventIds: { ...state.appliedEventIds, [event.id]: true as true },
      lastAppliedSeq: nextAppliedSeq,
      entityVersions: {
        ...state.entityVersions,
        [entityKey]: {
          revision: nextRevision,
          lastSeq: nextEntitySeq,
          updatedAt: Date.now(),
        },
      },
    };
    traceApp('EVENT_APPLIED', 'LAN_REALTIME_EVENT_MARKED_APPLIED', {
      source: 'lanRealtimeStore',
      sessionId: event.sessionId,
      eventId: event.id,
      eventType: event.type,
      seq: event.seq,
      serverSeq: event.serverSeq,
      entityType: event.entityType,
      entityId: event.entityId,
      entityRevision: event.entityRevision,
      before: {
        lastAppliedSeq: state.lastAppliedSeq,
        entity: current,
      },
      after: {
        lastAppliedSeq: nextAppliedSeq,
        entity: nextState.entityVersions[entityKey],
      },
    });
    return nextState;
  }),

  applyOptimisticEvent: (event) => set((state) => ({
    pendingEvents: {
      ...state.pendingEvents,
      [event.clientMsgId || event.id]: {
        event,
        createdAt: Date.now(),
        status: 'pending',
      },
    },
  })),

  ackEvent: (eventId) => set((state) => {
    const pending = state.pendingEvents[eventId];
    if (!pending) return state;
    return {
      pendingEvents: {
        ...state.pendingEvents,
        [eventId]: { ...pending, status: 'acked' },
      },
    };
  }),

  nackEvent: (eventId, reason) => set((state) => {
    const pending = state.pendingEvents[eventId];
    if (!pending) return state;
    return {
      pendingEvents: {
        ...state.pendingEvents,
        [eventId]: { ...pending, status: 'nacked', reason },
      },
    };
  }),

  resetSession: (sessionId) => {
    traceApp('STATE_CHANGE', 'LAN_REALTIME_SESSION_RESET', {
      source: 'lanRealtimeStore',
      sessionId,
    });
    set({
      sessionId,
      connected: false,
      lastAppliedSeq: 0,
      appliedEventIds: {},
      entityVersions: {},
      pendingEvents: {},
    });
  },
}));

export const applyNumberPatchToCharacter = <T extends Record<string, unknown>>(character: T, patch: NumberPatch): T => ({
  ...character,
  hp_current: patch.hpCurrent ?? character.hp_current,
  hp_max: patch.hpMax ?? character.hp_max,
  temp_hp: patch.tempHp ?? character.temp_hp,
  xp: patch.xp ?? character.xp,
  gp: patch.gp ?? character.gp,
  sp: patch.sp ?? character.sp,
  cp: patch.cp ?? character.cp,
});

export const getKnownLanEntityRevisions = (sessionId?: string) => {
  const runtime = useLanRealtimeStore.getState();
  const entries = Object.entries(runtime.entityVersions || {}) as Array<[string, RuntimeEntityState]>;

  return Object.fromEntries(
    entries
      .filter(([key]) => !sessionId || key.startsWith(`${sessionId}:`))
      .map(([key, value]) => [key, value.revision])
  ) as Record<string, number>;
};
