import { create } from 'zustand';

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
  reason?: 'duplicate_id' | 'old_seq' | 'old_entity_revision' | 'missing_id';
  entityKey?: string;
  currentRevision?: number;
  nextRevision?: number;
  lastAppliedSeq?: number;
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

  setConnection: (next) => set((state) => ({ ...state, ...next })),

  getEventApplyDecision: (event) => {
    const state = get();
    if (!event?.id) return { apply: false, reason: 'missing_id' };
    if (state.appliedEventIds[event.id]) return { apply: false, reason: 'duplicate_id' };

    const entityKey = getEntityKey(event);
    const current = state.entityVersions[entityKey];
    const nextRevision = getRevision(event);
    const eventSeq = Number(event.seq || 0);

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

    // Seq global antigo sozinho nao deve bloquear um evento vivo se a revisao da entidade e nova.
    // Isso evita perder patches validos quando um evento de outra entidade/sessao-wide chegou antes.
    if (eventSeq > 0 && eventSeq <= state.lastAppliedSeq && (!nextRevision || !current || nextRevision <= current.revision)) {
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
    const nextSeq = Math.max(state.lastAppliedSeq, Number(event.seq || 0));

    return {
      appliedEventIds: { ...state.appliedEventIds, [event.id]: true },
      lastAppliedSeq: nextSeq,
      entityVersions: {
        ...state.entityVersions,
        [entityKey]: {
          revision: nextRevision,
          lastSeq: nextSeq,
          updatedAt: Date.now(),
        },
      },
    };
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

  resetSession: (sessionId) => set({
    sessionId,
    connected: false,
    lastAppliedSeq: 0,
    appliedEventIds: {},
    entityVersions: {},
    pendingEvents: {},
  }),
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
