import { create } from 'zustand';

import { traceApp } from '../services/debug/appTrace';
import { registerLanProjectionSink } from '../services/lan/engine/LanEngineBridge';
import { getLanEventEntityId, getLanEventEntityType } from '../services/lan/lanEntityQueue';
import type { SessionProjection } from '../services/lan/engine/LanTypes';
import type { LanSessionEvent, LanSessionPlayerState } from '../services/lanSession';

export const LAN_REALTIME_STORE_VERSION = 'gap-checkpoint-v4-runtime-events';

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

export type LivePlayerRuntimeState = {
  sessionId: string;
  playerKey?: string;
  characterId?: number;
  characterName?: string;
  hp_current?: number;
  hp_max?: number;
  temp_hp?: number;
  xp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
  level?: number;
  class?: string;
  race?: string;
  stats?: unknown;
  equipment?: unknown;
  active_effects?: unknown[];
  active_effects_json?: string;
  numbersSeq?: number;
  effectsSeq?: number;
  statsSeq?: number;
  equipmentSeq?: number;
  revision?: number;
  seq?: number;
  updatedAt: number;
};

export type LiveLanEventNotice = {
  id: string;
  event: LanSessionEvent;
  seq: number;
  receivedAt: number;
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
  | 'revision_checkpoint'
  | 'legacy_timestamp_checkpoint_ignored';

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
  livePlayerStates: Record<string, LivePlayerRuntimeState>;
  liveEvents: Record<string, LiveLanEventNotice>;
  projections: Record<string, SessionProjection | null>;

  setConnection: (state: { sessionId?: string; clientId?: string; playerKey?: string; connected: boolean }) => void;
  setProjection: (sessionId: string, projection: SessionProjection | null) => void;
  mergeLivePlayerState: (key: string, patch: Partial<LivePlayerRuntimeState>) => void;
  publishLiveEvent: (event: LanSessionEvent) => void;
  getEventApplyDecision: (event: LanSessionEvent) => LanEventApplyDecision;
  shouldApplyEvent: (event: LanSessionEvent) => boolean;
  markEventApplied: (event: LanSessionEvent) => void;
  markEventObserved: (event: LanSessionEvent) => void;
  applyOptimisticEvent: (event: LanSessionEvent) => void;
  ackEvent: (eventId: string) => void;
  nackEvent: (eventId: string, reason?: string) => void;
  resetSession: (sessionId?: string) => void;
};

export const getLanRuntimeEntityKey = (event: LanSessionEvent) => {
  // v84: o tipo da entidade precisa ser derivado do tipo real do evento.
  // Builds anteriores podiam enviar public_status/player_patch e inventory_patch
  // com o mesmo entityId/remoteKey; se a revision de player contaminasse inventário,
  // a troca seguinte chegava no socket mas era ignorada antes do PLAYER_APPLY_EVENT_START.
  const derivedType = getLanEventEntityType(event);
  const entityType = derivedType || event.entityType || 'player';
  const entityId = getLanEventEntityId({ ...event, entityType });
  return `${event.sessionId}:${entityType}:${entityId}`;
};

const isLegacyTimestampCheckpoint = (event: LanSessionEvent) => (
  String(event.id || '').startsWith('checkpoint_') &&
  Number(event.entityRevision || 0) > 1000000 &&
  (event as any).authoritativeCheckpoint !== true
);

// v55: snapshots/checkpoints antigos de player/inventory/effect podiam vir com
// entityRevision baseado em Date.now(). Isso fazia o runtime gravar revision ~1780...
// e ignorar/sobrescrever os patches reais do host (revision 1,2,3...).
// Checkpoint legado não pode avançar a revision de nenhum agregado.
const getRevision = (event: LanSessionEvent) => {
  if (isLegacyTimestampCheckpoint(event)) return 0;
  // v94: o eco de level-up pode ter seq temporal, mas a revision da entidade
  // deve ser a revisionSeq autoritativa do player. Se Date.now() entrar aqui,
  // os danos/curas seguintes com revisionSeq real parecem antigos e a ficha trava.
  if (
    event?.type === 'player_patch' &&
    String((event as any)?.numberPatchIntent || '') === 'level_up_authoritative_echo'
  ) {
    const progressionRevision = Number((event as any)?.progressionPatch?.revisionSeq || 0) || 0;
    if (progressionRevision > 0) return progressionRevision;
  }
  const raw = Number(event.entityRevision ?? event.seq ?? 0) || 0;
  const derivedType = getLanEventEntityType(event);
  // v100: public_status/checkpoints/eco antigos podem carregar Date.now() em
  // entityRevision. Isso nao pode contaminar player/effect/inventory; a ordem real
  // continua vindo pelo seq e pelo id aplicado. Se uma revision temporal entrar aqui,
  // eventos reais seguintes de condicao/HP parecem antigos e a UI pisca/some.
  if (
    raw > 1000000 &&
    (derivedType === 'player' || derivedType === 'effect' || derivedType === 'inventory' || String(event.type || '') === 'public_status')
  ) return 0;
  return raw;
};
const getSeq = (event: LanSessionEvent) => Number(event.seq ?? event.serverSeq ?? 0) || 0;

export const useLanRealtimeStore = create<LanRealtimeState>((set, get) => ({
  connected: false,
  lastSeenSeq: 0,
  lastAppliedSeq: 0,
  seenEventIds: {},
  appliedEventIds: {},
  entityVersions: {},
  pendingEvents: {},
  livePlayerStates: {},
  liveEvents: {},
  projections: {},

  setConnection: (next) => set((state) => ({ ...state, ...next })),

  setProjection: (sessionId, projection) => set((state) => ({
    projections: {
      ...state.projections,
      [sessionId]: projection,
    },
  })),

  mergeLivePlayerState: (key, patch) => {
    traceApp('EVENT_DECISION', 'LAN_REALTIME_MERGE_LIVE_PLAYER_STATE_DEPRECATED_NOOP_CUT6', {
      key,
      patchKeys: Object.keys(patch || {}),
      decision: 'engine_projection_is_authoritative',
    });
    return;
    if (!key) return;
    set((state) => {
      const previous = state.livePlayerStates[key];
      const patchSeq = Math.max(0, Number(patch.seq || 0) || 0);
      const previousSeq = Math.max(0, Number(previous?.seq || 0) || 0);
      const nextRevision = Math.max(Number(previous?.revision || 0) || 0, Number(patch.revision || 0) || 0);
      const nextSeq = Math.max(previousSeq, patchSeq);
      const acceptDomain = (domain: 'numbersSeq' | 'effectsSeq' | 'statsSeq' | 'equipmentSeq') => {
        const patchDomainSeq = Math.max(0, Number((patch as any)?.[domain] || 0) || 0);
        const previousDomainSeq = Math.max(0, Number((previous as any)?.[domain] || 0) || 0);
        if (!previous || patchDomainSeq <= 0 || previousDomainSeq <= 0) return true;
        return patchDomainSeq >= previousDomainSeq;
      };
      const nextState: LivePlayerRuntimeState = {
        ...(previous || { sessionId: String(patch.sessionId || ''), updatedAt: Date.now() }),
        ...patch,
        revision: nextRevision || patch.revision || previous?.revision,
        seq: nextSeq || patch.seq || previous?.seq,
        numbersSeq: Math.max(Number(previous?.numbersSeq || 0) || 0, Number(patch.numbersSeq || 0) || 0) || undefined,
        effectsSeq: Math.max(Number(previous?.effectsSeq || 0) || 0, Number(patch.effectsSeq || 0) || 0) || undefined,
        statsSeq: Math.max(Number(previous?.statsSeq || 0) || 0, Number(patch.statsSeq || 0) || 0) || undefined,
        equipmentSeq: Math.max(Number(previous?.equipmentSeq || 0) || 0, Number(patch.equipmentSeq || 0) || 0) || undefined,
        updatedAt: Date.now(),
      } as LivePlayerRuntimeState;

      // v106: eventos de domínios diferentes chegam fora de ordem em LAN real.
      // Um player_patch novo de HP não pode bloquear uma remoção de efeito, mas um
      // effect_patch antigo/resync também não pode ressuscitar buff/condição já removido.
      if (previous && !acceptDomain('numbersSeq')) {
        nextState.hp_current = previous.hp_current;
        nextState.hp_max = previous.hp_max;
        nextState.temp_hp = previous.temp_hp;
        nextState.xp = previous.xp;
        nextState.gp = previous.gp;
        nextState.sp = previous.sp;
        nextState.cp = previous.cp;
      }
      if (previous && !acceptDomain('effectsSeq')) {
        nextState.active_effects = previous.active_effects;
        nextState.active_effects_json = previous.active_effects_json;
      }
      if (previous && !acceptDomain('statsSeq')) {
        nextState.stats = previous.stats;
      }
      if (previous && !acceptDomain('equipmentSeq')) {
        nextState.equipment = previous.equipment;
      }

      return {
        livePlayerStates: {
          ...state.livePlayerStates,
          [key]: nextState,
        },
      };
    });
  },

  publishLiveEvent: (event) => {
    if (!event?.id || !event.sessionId) return;
    const key = `${event.sessionId}:${event.id || event.clientMsgId}`;
    const notice: LiveLanEventNotice = {
      id: key,
      event,
      seq: getSeq(event),
      receivedAt: Date.now(),
    };
    set((state) => {
      const entries = Object.entries({ ...(state.liveEvents || {}), [key]: notice })
        .sort(([, a], [, b]) => Number(a.receivedAt || 0) - Number(b.receivedAt || 0))
        .slice(-160);
      return { liveEvents: Object.fromEntries(entries) as Record<string, LiveLanEventNotice> };
    });
  },

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

    // v55: checkpoint legado com Date.now() como revision não pode sobrescrever
    // um agregado que já recebeu patch autoritativo do host.
    if (current && isLegacyTimestampCheckpoint(event)) {
      return traceDecision({
        apply: false,
        reason: 'legacy_timestamp_checkpoint_ignored',
        entityKey,
        currentRevision: current.revision,
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

  resetSession: (sessionId) => set((state) => {
    const nextLivePlayerStates = sessionId
      ? Object.fromEntries(Object.entries(state.livePlayerStates || {}).filter(([key, value]) => (
          !key.startsWith(`${sessionId}:`) && value.sessionId !== sessionId
        )))
      : {};
    return {
      sessionId,
      connected: false,
      lastSeenSeq: 0,
      lastAppliedSeq: 0,
      seenEventIds: {},
      appliedEventIds: {},
      entityVersions: {},
      pendingEvents: {},
      livePlayerStates: nextLivePlayerStates,
      liveEvents: sessionId
        ? Object.fromEntries(Object.entries(state.liveEvents || {}).filter(([key, value]) => (
            !key.startsWith(`${sessionId}:`) && value.event?.sessionId !== sessionId
          )))
        : {},
      projections: sessionId
        ? Object.fromEntries(Object.entries(state.projections || {}).filter(([key]) => key !== sessionId))
        : {},
    };
  }),
}));

export function setLanRealtimeProjection(sessionId: string, projection: SessionProjection | null) {
  useLanRealtimeStore.getState().setProjection(sessionId, projection);
}

export function getLanRealtimeProjection(sessionId: string) {
  return useLanRealtimeStore.getState().projections[sessionId] || null;
}

registerLanProjectionSink(setLanRealtimeProjection);

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
