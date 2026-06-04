import { useEffect, useRef } from 'react';

import {
  ackLanSessionEvent,
  fetchLanSessionEvents,
  nackLanSessionEvent,
  requestLanSessionResync,
  subscribeLanSessionClientUpdates,
  type LanSessionEvent,
} from '@/services/lanSession';
import {
  isLanSessionGlobalEvent,
  isLanLiveCommittedEvent,
  shouldPlayerProcessLanEvent,
  shouldRequestLanResync,
} from '@/services/lan/lanClientEngine';
import { LAN_NETWORK_LIMITS, isCriticalLanSessionEvent } from '@/services/lan/lanNetworkPolicy';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import { getKnownLanEntityRevisions, useLanRealtimeStore } from '@/stores/lanRealtimeStore';

type LanNumberPatch = NonNullable<LanSessionEvent['numberPatch']>;
type LanEffectPatch = NonNullable<LanSessionEvent['effectPatch']>;
type LanInventoryPatch = NonNullable<LanSessionEvent['inventoryPatch']>;

export type UseLanRealtimePlayerPatchesParams = {
  enabled: boolean;
  joinUrl?: string;
  sessionId?: string;
  selfKey?: string;
  characterName?: string;
  paused?: boolean;
  reconnectEpoch?: number;

  onNumberPatch?: (patch: LanNumberPatch, event: LanSessionEvent) => void | Promise<void>;
  onEffectPatch?: (patch: LanEffectPatch, event: LanSessionEvent) => void | Promise<void>;
  onInventoryPatch?: (patch: LanInventoryPatch, event: LanSessionEvent) => void | Promise<void>;
  onEvent?: (event: LanSessionEvent) => void | Promise<void>;
  onSessionPatch?: (event: LanSessionEvent) => void | Promise<void>;
  onKicked?: (event: LanSessionEvent) => void | Promise<void>;

  onHostUnreachable?: (reason: string) => void | Promise<void>;
};

export function useLanRealtimePlayerPatches({
  enabled,
  joinUrl,
  sessionId,
  selfKey,
  characterName,
  paused = false,
  reconnectEpoch = 0,
  onNumberPatch,
  onEffectPatch,
  onInventoryPatch,
  onEvent,
  onSessionPatch,
  onKicked,
  onHostUnreachable,
}: UseLanRealtimePlayerPatchesParams) {
  const onNumberPatchRef = useRef(onNumberPatch);
  const onEffectPatchRef = useRef(onEffectPatch);
  const onInventoryPatchRef = useRef(onInventoryPatch);
  const onSessionPatchRef = useRef(onSessionPatch);
  const onEventRef = useRef(onEvent);
  const onKickedRef = useRef(onKicked);
  const onHostUnreachableRef = useRef(onHostUnreachable);
  const applyRunningRef = useRef(false);
  const processingEventIdsRef = useRef<Set<string>>(new Set());
  const lastResyncRequestAtRef = useRef(0);
  const consecutiveFetchErrorsRef = useRef(0);

  useEffect(() => {
    onNumberPatchRef.current = onNumberPatch;
    onEffectPatchRef.current = onEffectPatch;
    onInventoryPatchRef.current = onInventoryPatch;
    onSessionPatchRef.current = onSessionPatch;
    onEventRef.current = onEvent;
    onKickedRef.current = onKicked;
    onHostUnreachableRef.current = onHostUnreachable;
  }, [onEffectPatch, onEvent, onHostUnreachable, onInventoryPatch, onKicked, onNumberPatch, onSessionPatch]);

  useEffect(() => {
    if (!enabled || !joinUrl || !sessionId) return;

    useLanRealtimeStore.getState().setConnection({
      sessionId,
      playerKey: selfKey,
      connected: true,
    });

    return () => {
      useLanRealtimeStore.getState().setConnection({
        sessionId,
        playerKey: selfKey,
        connected: false,
      });
    };
  }, [enabled, joinUrl, selfKey, sessionId]);

  useEffect(() => {
    if (!enabled || !joinUrl || !sessionId) return;
    let disposed = false;
    processingEventIdsRef.current.clear();
    const getEventSeq = (event: LanSessionEvent) => Number(event.seq ?? event.serverSeq ?? 0) || 0;
    const isCriticalSessionEvent = (event: LanSessionEvent) => isCriticalLanSessionEvent(event);
    const isExplicitlyTargetedToSelf = (event: LanSessionEvent) => {
      if (!selfKey && !characterName) return false;
      const anyEvent = event as any;
      if (selfKey) {
        if (event.toKey === selfKey || event.entityId === selfKey) return true;
        if (event.effectPatch?.targetKey === selfKey) return true;
        if (event.inventoryPatch?.targetKey === selfKey) return true;
        if (event.pendingSavePatch?.save?.targetKey === selfKey) return true;
        if (anyEvent.saveRequest?.targetKey === selfKey) return true;
        if (anyEvent.saveResult?.targetKey === selfKey) return true;
        if (anyEvent.resourceReview?.targetKey === selfKey) return true;
      }
      if (characterName && event.toName === characterName) return true;
      return false;
    };

    const shouldProcessEvent = (event: LanSessionEvent) => {
      if (event.sessionId !== sessionId) {
        debugLanFlow('PLAYER_IGNORE_EVENT_WRONG_SESSION', {
          expectedSessionId: sessionId,
          eventSessionId: event.sessionId,
          eventId: event.id,
          type: event.type,
        });
        return false;
      }
      if (!isLanLiveCommittedEvent(event)) return false;
      if (paused && !isCriticalSessionEvent(event)) {
        return false;
      }
      if (isLanSessionGlobalEvent(event)) {
        debugLanFlow('PLAYER_GLOBAL_EVENT_ACCEPTED', {
          eventId: event.id,
          type: event.type,
          toKey: event.toKey,
          entityType: event.entityType,
          selfKey,
        });
        if (event.type === 'session_ended') {
          debugLanFlow('PLAYER_SESSION_ENDED_RECEIVED', {
            eventId: event.id,
            sessionId,
            selfKey,
          });
        }
        if (event.type === 'session_patch') {
          debugLanFlow('PLAYER_SESSION_PATCH_RECEIVED', {
            eventId: event.id,
            sessionId,
            selfKey,
            status: event.sessionPatch?.status,
          });
        }
        return true;
      }
      if (event.toKey === 'master') {
        debugLanFlow('PLAYER_IGNORE_EVENT_TO_MASTER', {
          eventId: event.id,
          type: event.type,
          fromKey: event.fromKey,
          selfKey,
        });
        return false;
      }

      const accepted = shouldPlayerProcessLanEvent(event, { sessionId, selfKey, characterName });
      if (!accepted) {
        debugLanFlow('PLAYER_EVENT_NOT_FOR_SELF_SKIPPED', {
          sessionId,
          eventId: event.id,
          type: event.type,
          toKey: event.toKey,
          toName: event.toName,
          entityType: event.entityType,
          entityId: event.entityId,
          effectTargetKey: event.effectPatch?.targetKey,
          inventoryTargetKey: event.inventoryPatch?.targetKey,
          selfKey,
          characterName,
        });
      }
      return accepted;
    };

    const ackEvent = async (event: LanSessionEvent) => {
      if (!joinUrl || !sessionId) return;
      try {
        await ackLanSessionEvent(joinUrl, {
          sessionId,
          eventId: event.id,
          clientMsgId: event.clientMsgId,
          playerKey: selfKey,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
          entityId: event.entityId,
          entityRevision: event.entityRevision,
        });
      } catch (error) {
        console.warn('[LAN] ACK falhou; evento foi aplicado localmente, mas o host pode reenviar.', {
          eventId: event.id,
          type: event.type,
          error,
        });
      }
    };

    const requestResyncIfNeeded = async (reason = 'manual') => {
      if (paused) return;
      const now = Date.now();
      if (now - lastResyncRequestAtRef.current < LAN_NETWORK_LIMITS.resyncMinIntervalMs) return;
      lastResyncRequestAtRef.current = now;

      try {
        const runtime = useLanRealtimeStore.getState();
        const lastAppliedSeq = runtime.lastAppliedSeq;
        debugLanFlow('PLAYER_SEQ_GAP_RESYNC_START', {
          reason,
          sessionId,
          selfKey,
          lastAppliedSeq,
        });
        await requestLanSessionResync(joinUrl, {
          sessionId,
          playerKey: selfKey,
          lastAppliedSeq,
          knownRevisions: getKnownLanEntityRevisions(sessionId),
        });
        debugLanFlow('PLAYER_SEQ_GAP_RESYNC_DONE', {
          reason,
          sessionId,
          selfKey,
        });
        setTimeout(() => {
          if (!disposed) void applyEvents();
        }, 300);
      } catch (error) {
        console.warn('[LAN] Não foi possível solicitar resync ao host:', error);
      }
    };

    const runSideEffectInBackground = (label: string, event: LanSessionEvent, task: () => void | Promise<void>) => {
      let result: void | Promise<void>;
      try {
        // Chama o handler imediatamente. Funções async executam até o primeiro await,
        // permitindo que a UI aplique o patch antes do SQLite/resync.
        result = task();
      } catch (error) {
        result = Promise.reject(error);
      }
      Promise.resolve(result)
        .catch(async (error) => {
          const reason = error instanceof Error ? error.message : String(error);
          useLanRealtimeStore.getState().nackEvent(event.clientMsgId || event.id, reason);
          debugLanFlow('PLAYER_BACKGROUND_EVENT_HANDLER_ERROR', {
            label,
            reason,
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityType: event.entityType,
            entityId: event.entityId,
            entityRevision: event.entityRevision,
          });
          await nackLanSessionEvent(joinUrl, {
            sessionId,
            eventId: event.id,
            clientMsgId: event.clientMsgId,
            playerKey: selfKey,
            reason,
          }).catch(() => false);
          if (!paused) await requestResyncIfNeeded(`background_${label}_error`);
        });
    };

    const applyOneEvent = async (event: LanSessionEvent) => {
      const eventKey = String(event.id || event.clientMsgId || '');
      if (eventKey && processingEventIdsRef.current.has(eventKey)) return;
      if (eventKey) processingEventIdsRef.current.add(eventKey);
      const runtime = useLanRealtimeStore.getState();
      const criticalSessionEvent = isCriticalSessionEvent(event);
      const decision = runtime.getEventApplyDecision(event);

      debugLanFlow('PLAYER_EVENT_DECISION', {
        eventId: event.id,
        type: event.type,
        seq: event.seq,
        serverSeq: event.serverSeq,
        toKey: event.toKey,
        toName: event.toName,
        selfKey,
        characterName,
        apply: decision.apply,
        reason: decision.reason,
        entityType: event.entityType,
        entityId: event.entityId,
        entityRevision: event.entityRevision,
        currentRevision: decision.currentRevision,
        lastAppliedSeq: decision.lastAppliedSeq,
      });

      if (!decision.apply) {
        if (criticalSessionEvent && decision.reason !== 'duplicate_id') {
          debugLanFlow('PLAYER_FORCE_APPLY_CRITICAL_SESSION_EVENT', {
            reason: decision.reason,
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityType: event.entityType,
            entityId: event.entityId,
            entityRevision: event.entityRevision,
            currentRevision: decision.currentRevision,
            lastAppliedSeq: decision.lastAppliedSeq,
          });
        } else {
          debugLanFlow('PLAYER_IGNORE_EVENT_DECISION', {
            reason: decision.reason,
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityType: event.entityType,
            entityId: event.entityId,
            entityRevision: event.entityRevision,
            currentRevision: decision.currentRevision,
            lastAppliedSeq: decision.lastAppliedSeq,
            expectedSeq: decision.expectedSeq,
            receivedSeq: decision.receivedSeq,
          });
          if (shouldRequestLanResync(decision)) {
            await requestResyncIfNeeded(decision.reason);
          }
          if (eventKey) processingEventIdsRef.current.delete(eventKey);
          return;
        }
      }

      try {
        debugLanFlow('PLAYER_APPLY_EVENT_START', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityType: event.entityType,
          entityId: event.entityId,
          entityRevision: event.entityRevision,
          numberPatch: event.numberPatch,
        });

        if (event.type === 'session_ended') {
          useLanRealtimeStore.getState().markEventApplied(event);
          debugLanFlow('PLAYER_APPLY_EVENT_OK', {
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityRevision: event.entityRevision,
            lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
          });
          await ackEvent(event);
          await onSessionPatchRef.current?.(event);
          if (eventKey) processingEventIdsRef.current.delete(eventKey);
          return;
        }

        if (event.type === 'player_patch' && event.numberPatch) {
          debugLanFlow('PLAYER_PATCH_RECEIVED', {
            eventId: event.id,
            seq: event.seq,
            serverSeq: event.serverSeq,
            entityRevision: event.entityRevision,
            toKey: event.toKey,
            toName: event.toName,
            patch: event.numberPatch,
          });
          if (!onNumberPatchRef.current) {
            throw new Error('onNumberPatch handler nao configurado.');
          }
          // Caminho zero-latência: a UI é atualizada dentro do handler antes do SQLite.
          // Não bloqueie a fila de socket esperando persistência local.
          runSideEffectInBackground('number_patch', event, () => onNumberPatchRef.current?.(event.numberPatch!, event));
          useLanRealtimeStore.getState().markEventApplied(event);
          await ackEvent(event);
          if (eventKey) processingEventIdsRef.current.delete(eventKey);
          return;
        } else if (event.type === 'effect_patch' && event.effectPatch) {
          debugLanFlow('PLAYER_EFFECT_PATCH_APPLY_START', {
            eventId: event.id,
            seq: event.seq,
            toKey: event.toKey,
            selfKey,
            addCount: event.effectPatch.add?.length || 0,
            updateCount: event.effectPatch.update?.length || 0,
            removeCount: event.effectPatch.remove?.length || 0,
          });
          runSideEffectInBackground('effect_patch', event, () => onEffectPatchRef.current?.(event.effectPatch!, event));
          useLanRealtimeStore.getState().markEventApplied(event);
          await ackEvent(event);
          if (eventKey) processingEventIdsRef.current.delete(eventKey);
          return;
        } else if (event.type === 'inventory_patch' && event.inventoryPatch) {
          runSideEffectInBackground('inventory_patch', event, () => onInventoryPatchRef.current?.(event.inventoryPatch!, event));
          useLanRealtimeStore.getState().markEventApplied(event);
          await ackEvent(event);
          if (eventKey) processingEventIdsRef.current.delete(eventKey);
          return;
        } else if (event.type === 'session_patch') {
          await onSessionPatchRef.current?.(event);
        } else if (event.type === 'player_kicked') {
          debugLanFlow('PLAYER_KICKED_RECEIVED', {
            eventId: event.id,
            seq: event.seq,
            serverSeq: event.serverSeq,
            toKey: event.toKey,
            toName: event.toName,
            selfKey,
            characterName,
          });
          await onKickedRef.current?.(event);
        } else {
          await onEventRef.current?.(event);
        }

        useLanRealtimeStore.getState().markEventApplied(event);
        debugLanFlow('PLAYER_APPLY_EVENT_OK', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        });
        await ackEvent(event);
        if (eventKey) processingEventIdsRef.current.delete(eventKey);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        useLanRealtimeStore.getState().nackEvent(event.clientMsgId || event.id, reason);
        await nackLanSessionEvent(joinUrl, {
          sessionId,
          eventId: event.id,
          clientMsgId: event.clientMsgId,
          playerKey: selfKey,
          reason,
        }).catch(() => false);
        console.warn('[LAN] NACK local/remoto: evento não foi aplicado; solicitando resync.', {
          eventId: event.id,
          type: event.type,
          entityId: event.entityId,
          entityRevision: event.entityRevision,
          error,
        });
        await requestResyncIfNeeded('apply_error');
        if (eventKey) processingEventIdsRef.current.delete(eventKey);
      }
    };

    const resetConnectionWhilePaused = () => {
      useLanRealtimeStore.getState().setConnection({
        sessionId,
        playerKey: selfKey,
        connected: false,
      });
    };

    const applyEvents = async (options?: { forceFullDrain?: boolean; reason?: string }) => {
      if (applyRunningRef.current) return;
      applyRunningRef.current = true;

      try {
        const runtimeBeforeFetch = useLanRealtimeStore.getState();
        const events = await fetchLanSessionEvents(joinUrl, sessionId, {
          afterSeq: options?.forceFullDrain ? 0 : runtimeBeforeFetch.lastAppliedSeq,
          playerKey: selfKey,
          includeGlobal: true,
        });
        consecutiveFetchErrorsRef.current = 0;
        useLanRealtimeStore.getState().setConnection({
          sessionId,
          playerKey: selfKey,
          connected: true,
        });
        const runtimeAfterFetch = useLanRealtimeStore.getState();
        const freshEvents = events.filter((event) => !runtimeAfterFetch.appliedEventIds[event.id]);
        const duplicateCount = events.length - freshEvents.length;
        if (duplicateCount > 0) {
          debugLanFlow('PLAYER_EVENT_POLL_DUPLICATES_SKIPPED_COUNT', {
            sessionId,
            selfKey,
            duplicateCount,
            totalCount: events.length,
            lastAppliedSeq: runtimeAfterFetch.lastAppliedSeq,
          });
        }
        let foreignSkippedCount = 0;
        const ordered = [...freshEvents]
          .map((event) => {
            debugLanFlow('PLAYER_EVENT_RECEIVED', {
              eventId: event.id,
              type: event.type,
              seq: event.seq,
              serverSeq: event.serverSeq,
              toKey: event.toKey,
              toName: event.toName,
              fromKey: event.fromKey,
              selfKey,
              characterName,
              entityType: event.entityType,
              entityId: event.entityId,
              entityRevision: event.entityRevision,
            });
            return event;
          })
          .filter((event) => {
            const accepted = shouldProcessEvent(event);
            if (!accepted) foreignSkippedCount += 1;
            return accepted;
          })
          .sort((a, b) => {
            const seqDiff = getEventSeq(a) - getEventSeq(b);
            if (seqDiff !== 0) return seqDiff;
            return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
          });
        if (foreignSkippedCount > 0) {
          debugLanFlow('PLAYER_WRONG_TARGET_FILTERED_BEFORE_PROCESSING', {
            sessionId,
            selfKey,
            characterName,
            count: foreignSkippedCount,
            totalCount: freshEvents.length,
          });
          debugLanFlow('PLAYER_FOREIGN_EVENTS_SKIPPED_COUNT', {
            sessionId,
            selfKey,
            count: foreignSkippedCount,
          });
        }

        for (const event of ordered) {
          if (disposed) return;
          await applyOneEvent(event);
        }
      } catch (error) {
        useLanRealtimeStore.getState().setConnection({
          sessionId,
          playerKey: selfKey,
          connected: false,
        });
        console.warn('[LAN] Não foi possível buscar eventos em tempo real:', error);
        consecutiveFetchErrorsRef.current += 1;
        const reason = error instanceof Error ? error.message : String(error);

        debugLanFlow('PLAYER_EVENT_FETCH_ERROR', {
          sessionId,
          selfKey,
          consecutiveFetchErrors: consecutiveFetchErrorsRef.current,
          reason,
        });

        if (consecutiveFetchErrorsRef.current >= 4) {
          if (paused) {
            resetConnectionWhilePaused();
            return;
          }
          debugLanFlow('PLAYER_HOST_UNREACHABLE_DETECTED', {
            sessionId,
            selfKey,
            consecutiveFetchErrors: consecutiveFetchErrorsRef.current,
            reason,
          });
          await onHostUnreachableRef.current?.(reason);
          return;
        }

        if (!paused) {
          await requestResyncIfNeeded('fetch_error');
        }
      } finally {
        applyRunningRef.current = false;
      }
    };

    if (!paused) {
      // Ao montar por QR ou pela Home/index, primeiro reenvie hello/resync com
      // playerKey. Depois drene o buffer. Evita enxurrada de snapshots e mantém
      // o socket associado ao jogador no host.
      void requestResyncIfNeeded('mount_or_rebind');
      setTimeout(() => { if (!disposed) void applyEvents({ reason: 'mount_or_reconnect' }); }, 120);
      setTimeout(() => { if (!disposed) void applyEvents({ reason: 'post_mount_buffer_flush_650ms' }); }, 650);
      if (reconnectEpoch > 0) {
        setTimeout(() => { if (!disposed) void requestResyncIfNeeded('foreground_reconnect'); }, 120);
        setTimeout(() => { if (!disposed) void applyEvents({ reason: 'foreground_reconnect_buffer_flush' }); }, 450);
      }
    } else {
      useLanRealtimeStore.getState().setConnection({ sessionId, playerKey: selfKey, connected: true });
    }

    const timer = paused
      ? null
      : setInterval(() => {
          void applyEvents();
        }, LAN_NETWORK_LIMITS.fallbackPollActiveMs);

    const unsubscribe = subscribeLanSessionClientUpdates(joinUrl, (update) => {
      // Caminho principal: event_commit direto do socket.
      // Payload/snapshot nao dispara reload de ficha viva; resync_events ja sao
      // reemitidos pelo transporte como eventos individuais.
      if (update?.reason === 'socket_closed' && !paused) {
        useLanRealtimeStore.getState().setConnection({ sessionId, playerKey: selfKey, connected: false });
        setTimeout(() => {
          if (!disposed) void requestResyncIfNeeded('socket_closed');
        }, 150);
        setTimeout(() => {
          if (!disposed) void applyEvents({ forceFullDrain: true, reason: 'socket_closed_recovery_flush' });
        }, 700);
      }
      if (update?.event) {
        const event = update.event;
        const accepted = shouldProcessEvent(event);
        const explicitSelfTarget = isExplicitlyTargetedToSelf(event);
        if (accepted || explicitSelfTarget) {
          if (!accepted && explicitSelfTarget) {
            debugLanFlow('PLAYER_FORCE_PROCESS_EXPLICIT_SELF_TARGET_EVENT', {
              sessionId,
              eventId: event.id,
              type: event.type,
              toKey: event.toKey,
              toName: event.toName,
              entityType: event.entityType,
              entityId: event.entityId,
              effectTargetKey: event.effectPatch?.targetKey,
              inventoryTargetKey: event.inventoryPatch?.targetKey,
              selfKey,
              characterName,
            });
          }
          void applyOneEvent(event);
        } else {
          // O evento permanece no buffer do transporte. Um flush curto evita que
          // efeito/condicao fique esperando o polling de fallback quando a tela
          // acabou de remontar ou o selfKey ainda estava inicializando.
          setTimeout(() => { if (!disposed) void applyEvents({ forceFullDrain: true, reason: 'socket_event_not_accepted_retry' }); }, 200);
        }
      }
    });

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, paused, reconnectEpoch, selfKey, sessionId]);
}
