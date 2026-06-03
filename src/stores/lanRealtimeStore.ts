import { create } from 'zustand';

import { traceApp } from '@/services/debug/appTrace';
import type { LanSessionEvent, LanSessionPlayerState } from '@/services/lanSession';

export const LAN_REALTIME_STORE_VERSION = 'gap-checkpoint-v3';

traceApp('EVENT_DECISION', 'LAN_REALTIME_STORE_VERSION', {
  source: 'src/stores/lanRealtimeStore.ts',
  version: LAN_REALTIME_STORE_VERSION,
});

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

export type LanEventApplyDecisionReason =
  | 'duplicate_id'
  | 'old_seq'
  | 'seq_gap'
  | 'old_entity_revision'
  | 'entity_revision_gap'
  | 'missing_id'
  | 'stored_duplicate_but_apply_needed'
  | 'stored_duplicate_and_already_applied'
  | 'new_event'
  | 'revision_checkpoint';

export type LanEventApplyDecision = {
  apply: boolean;
  reason?: LanEventApplyDecisionReason;
  recoverable?: boolean;
  entityKey?: string;
  currentRevision?: number;
  nextRevision?: number;
  lastAppliedSeq?: number;
  lastSeenSeq?: number;
  expectedSeq?: number;
  receivedSeq?: number;
};

export type LanRealtimeState = {
  sessionId?: string;
  clientId?: string;
  playerKey?: string;
  connected: boolean;

  /** Maior seq recebido/observado. Não significa que foi aplicado na ficha. */
  lastSeenSeq: number;

  /** Maior seq aplicado com sucesso na ficha/runtime local. */
  lastAppliedSeq: number;

  seenEventIds: Record<string, true>;
  appliedEventIds: Record<string, true>;
  entityVersions: Record<string, RuntimeEntityState>;
  pendingEvents: Record<string, PendingEvent>;

  setConnection: (state: { sessionId?: string; clientId?: string; playerKey?: string; connected: boolean }) => void;
  getEventApplyDecision: (event: LanSessionEvent) => LanEventApplyDecision;
  shouldApplyEvent: (event: LanSessionEvent) => boolean;
  markEventApplied: (event: LanSessionEvent) => void;
  markEventObserved: (event: LanSessionEvent) => void;
  applyOptimisticEvent: (event: LanSessionEvent) => void;
  ackEvent: (eventId: string) => void;
  nackEvent: (eventId: string, reason?: string) => void;
  resetSession: (sessionId?: string) => void;
};

const inferEntityType = (event: LanSessionEvent) => {
  if (event.type === 'session_patch' || event.type === 'session_ended' || event.type === 'timeline_event') return 'session';
  if (event.type === 'inventory_patch' || event.type === 'send_item' || event.type.startsWith('trade_')) return 'inventory';
  if (event.type === 'effect_patch' || event.type === 'effect_catalog_patch' || event.type === 'effect_expired') return 'effect';
  if (event.type === 'effect_save_request' || event.type === 'effect_save_result') return 'save';
  if (event.type.includes('action') || event.type.includes('skill') || event.type.includes('spell') || event.type.includes('ability')) return 'action';
  if (
    event.type === 'resource_request' ||
    event.type === 'resource_review' ||
    event.type === 'pending_save_patch' ||
    event.type === 'character_update_review'
  ) return 'request';
  return 'player';
};

export const getLanRuntimeEntityKey = (event: LanSessionEvent) => {
  const entityType = event.entityType || inferEntityType(event);
  const entityId = event.entityId || event.toKey || event.fromKey || event.tradeId || event.sessionId;
  return `${event.sessionId}:${entityType}:${entityId}`;
};

const getRevision = (event: LanSessionEvent) => Number(event.entityRevision ?? event.seq ?? 0) || 0;
const getSeq = (event: LanSessionEvent) => Number(event.seq ?? event.serverSeq ?? 0) || 0;

export const useLanRealtimeStore = create<LanRealtimeState>((set, get) => ({
  connected: false,
  lastSeenSeq: 0,
  lastAppliedSeq: 0,
  seenEventIds: {},
  appliedEventIds: {},
  entityVersions: {},
  pendingEvents: {},

  setConnection: (next) => set((state) => ({ ...state, ...next })),

  getEventApplyDecision: (event) => {
    const state = get();
    const traceDecision = (decision: LanEventApplyDecision) => {
      traceApp('EVENT_DECISION', 'LAN_REALTIME_STORE_DECISION_SOURCE', {
        source: 'src/stores/lanRealtimeStore.ts',
        version: LAN_REALTIME_STORE_VERSION,
        eventId: event?.id,
        type: event?.type,
        seq: event?.seq,
        serverSeq: event?.serverSeq,
        entityType: event?.entityType,
        entityId: event?.entityId,
        entityRevision: event?.entityRevision,
        reason: decision.reason,
        apply: decision.apply,
        recoverable: decision.recoverable,
        currentRevision: decision.currentRevision,
        nextRevision: decision.nextRevision,
        lastAppliedSeq: decision.lastAppliedSeq,
        lastSeenSeq: decision.lastSeenSeq,
      });
      return decision;
    };

    if (!event?.id) return traceDecision({ apply: false, reason: 'missing_id' });

    const entityKey = getLanRuntimeEntityKey(event);
    const current = state.entityVersions[entityKey];
    const nextRevision = getRevision(event);
    const eventSeq = getSeq(event);

    // Aplicado de verdade: não reaplique.
    if (state.appliedEventIds[event.id]) {
      return traceDecision({
        apply: false,
        reason: 'duplicate_id',
        entityKey,
        currentRevision: current?.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
        lastSeenSeq: state.lastSeenSeq,
      });
    }

    // Revisão antiga da mesma entidade: evento velho, não precisa resync.
    if (current && nextRevision > 0 && nextRevision <= current.revision) {
      return traceDecision({
        apply: false,
        reason: 'old_entity_revision',
        entityKey,
        currentRevision: current.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
        lastSeenSeq: state.lastSeenSeq,
      });
    }

    // O seq global não pode bloquear evento de entidade mais nova. Isso era a causa
    // do jogador ficar preso no tempo quando lastAppliedSeq/lastSeenSeq avançavam por
    // evento estrutural ou por evento só observado. Só bloqueie seq antigo se também
    // não houver revisão nova para aplicar.
    if (eventSeq > 0 && current?.lastSeq && eventSeq <= current.lastSeq && nextRevision <= (current.revision || 0)) {
      return traceDecision({
        apply: false,
        reason: 'old_seq',
        entityKey,
        currentRevision: current.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
        lastSeenSeq: state.lastSeenSeq,
        receivedSeq: eventSeq,
      });
    }

    // Gap de revisão agora é recuperável e NÃO bloqueia automaticamente.
    // Patches de HP/XP/moedas/tempHP são valores absolutos; aplicar o checkpoint
    // autoritativo é melhor do que entrar em loop infinito de resync.
    if (current && nextRevision > current.revision + 1) {
      return traceDecision({
        apply: true,
        reason: 'entity_revision_gap',
        recoverable: true,
        entityKey,
        currentRevision: current.revision,
        nextRevision,
        lastAppliedSeq: state.lastAppliedSeq,
        lastSeenSeq: state.lastSeenSeq,
      });
    }

    return traceDecision({
      apply: true,
      reason: state.seenEventIds[event.id] ? 'stored_duplicate_but_apply_needed' : 'new_event',
      entityKey,
      currentRevision: current?.revision,
      nextRevision,
      lastAppliedSeq: state.lastAppliedSeq,
      lastSeenSeq: state.lastSeenSeq,
    });
  },

  shouldApplyEvent: (event) => get().getEventApplyDecision(event).apply,

  markEventApplied: (event) => set((state) => {
    if (!event?.id) return state;

    const entityKey = getLanRuntimeEntityKey(event);
    const current = state.entityVersions[entityKey];
    const eventSeq = getSeq(event);
    const nextRevision = Math.max(current?.revision || 0, getRevision(event));
    const nextSeenSeq = Math.max(state.lastSeenSeq, eventSeq);
    const nextAppliedSeq = Math.max(state.lastAppliedSeq, eventSeq);

    return {
      seenEventIds: { ...state.seenEventIds, [event.id]: true },
      appliedEventIds: { ...state.appliedEventIds, [event.id]: true },
      lastSeenSeq: nextSeenSeq,
      lastAppliedSeq: nextAppliedSeq,
      entityVersions: {
        ...state.entityVersions,
        [entityKey]: {
          revision: nextRevision,
          lastSeq: Math.max(current?.lastSeq || 0, eventSeq),
          updatedAt: Date.now(),
        },
      },
    };
  }),

  markEventObserved: (event) => set((state) => {
    if (!event?.id) return state;
    const eventSeq = getSeq(event);
    return {
      seenEventIds: { ...state.seenEventIds, [event.id]: true },
      lastSeenSeq: Math.max(state.lastSeenSeq, eventSeq),
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
    lastSeenSeq: 0,
    lastAppliedSeq: 0,
    seenEventIds: {},
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
  const entries = Object.entries(runtime.entityVersions || {}) as [string, RuntimeEntityState][];

  return Object.fromEntries(
    entries
      .filter(([key]) => !sessionId || key.startsWith(`${sessionId}:`))
      .map(([key, value]) => [key, value.revision])
  ) as Record<string, number>;
};
