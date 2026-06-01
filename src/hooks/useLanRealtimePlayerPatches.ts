import { useEffect, useRef } from 'react';

import {
  ackLanSessionEvent,
  fetchLanSessionEvents,
  nackLanSessionEvent,
  requestLanSessionResync,
  subscribeLanSessionClientUpdates,
  type LanSessionEvent,
  type LanSessionPlayerState,
} from '@/services/lanSession';
import { traceApp, traceFunctionCall, traceFunctionReturn } from '@/services/debug/appTrace';
import {
  isLanEventTargetedToPlayer,
  isLanLiveCommittedEvent,
  shouldRequestLanResync,
} from '@/services/lan/lanClientEngine';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import { useLanRealtimeStore } from '@/stores/lanRealtimeStore';

type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;

type UseLanRealtimePlayerPatchesParams = {
  joinUrl?: string;
  sessionId?: string;
  selfKey?: string;
  characterName?: string;
  enabled?: boolean;
  onNumberPatch: (patch: NumberPatch, event: LanSessionEvent) => void | Promise<void>;
  onEffectPatch?: (patch: NonNullable<LanSessionEvent['effectPatch']>, event: LanSessionEvent) => void | Promise<void>;
  onInventoryPatch?: (patch: NonNullable<LanSessionEvent['inventoryPatch']>, event: LanSessionEvent) => void | Promise<void>;
  onSessionPatch?: (event: LanSessionEvent) => void | Promise<void>;
  onEvent?: (event: LanSessionEvent) => void | Promise<void>;
  onKicked?: (event: LanSessionEvent) => void | Promise<void>;
};

export function useLanRealtimePlayerPatches({
  joinUrl,
  sessionId,
  selfKey,
  characterName,
  enabled = true,
  onNumberPatch,
  onEffectPatch,
  onInventoryPatch,
  onSessionPatch,
  onEvent,
  onKicked,
}: UseLanRealtimePlayerPatchesParams) {
  const onNumberPatchRef = useRef(onNumberPatch);
  const onEffectPatchRef = useRef(onEffectPatch);
  const onInventoryPatchRef = useRef(onInventoryPatch);
  const onSessionPatchRef = useRef(onSessionPatch);
  const onEventRef = useRef(onEvent);
  const onKickedRef = useRef(onKicked);
  const applyRunningRef = useRef(false);
  const lastResyncRequestAtRef = useRef(0);

  useEffect(() => {
    onNumberPatchRef.current = onNumberPatch;
    onEffectPatchRef.current = onEffectPatch;
    onInventoryPatchRef.current = onInventoryPatch;
    onSessionPatchRef.current = onSessionPatch;
    onEventRef.current = onEvent;
    onKickedRef.current = onKicked;
  }, [onEffectPatch, onEvent, onInventoryPatch, onKicked, onNumberPatch, onSessionPatch]);

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
    const getEventSeq = (event: LanSessionEvent) => Number(event.seq ?? event.serverSeq ?? 0) || 0;

    const isForMe = (event: LanSessionEvent) => {
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
      if (event.toKey === 'master') {
        debugLanFlow('PLAYER_IGNORE_EVENT_TO_MASTER', {
          eventId: event.id,
          type: event.type,
          fromKey: event.fromKey,
          selfKey,
        });
        return false;
      }

      if (isLanEventTargetedToPlayer(event, { sessionId, selfKey, characterName })) return true;

      debugLanFlow('PLAYER_IGNORE_EVENT_WRONG_TARGET', {
        eventId: event.id,
        type: event.type,
        toKey: event.toKey,
        fromKey: event.fromKey,
        selfKey,
        toName: event.toName,
        fromName: event.fromName,
        characterName,
      });
      return false;
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
      const now = Date.now();
      if (now - lastResyncRequestAtRef.current < 2500) return;
      lastResyncRequestAtRef.current = now;

      try {
        const runtime = useLanRealtimeStore.getState();
        const lastAppliedSeq = reason === 'entity_revision_gap' ? 0 : runtime.lastAppliedSeq;
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

    const applyOneEvent = async (event: LanSessionEvent) => {
      const startedAt = Date.now();
      traceFunctionCall('useLanRealtimePlayerPatches.applyOneEvent', { event }, {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches',
        sessionId,
        playerKey: selfKey,
        characterName,
        eventId: event.id,
        eventType: event.type,
        seq: event.seq,
        serverSeq: event.serverSeq,
        entityType: event.entityType,
        entityId: event.entityId,
        entityRevision: event.entityRevision,
        fromKey: event.fromKey,
        toKey: event.toKey,
      });
      const runtime = useLanRealtimeStore.getState();
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
        traceFunctionReturn('useLanRealtimePlayerPatches.applyOneEvent', {
          applied: false,
          decision,
        }, {
          screen: 'sheet',
          source: 'useLanRealtimePlayerPatches',
          sessionId,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          decision,
          reason: decision.reason,
          durationMs: Date.now() - startedAt,
        });
        return;
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
          debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_START', {
            eventId: event.id,
            seq: event.seq,
            toKey: event.toKey,
            selfKey,
            patch: event.numberPatch,
          });
          await onNumberPatchRef.current(event.numberPatch, event);
          debugLanFlow('PLAYER_NUMBER_PATCH_APPLY_DONE', {
            eventId: event.id,
            seq: event.seq,
            toKey: event.toKey,
            selfKey,
          });
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
          await onEffectPatchRef.current?.(event.effectPatch, event);
          debugLanFlow('PLAYER_EFFECT_PATCH_APPLY_DONE', {
            eventId: event.id,
            seq: event.seq,
            toKey: event.toKey,
            selfKey,
          });
        } else if (event.type === 'inventory_patch' && event.inventoryPatch) {
          await onInventoryPatchRef.current?.(event.inventoryPatch, event);
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
        debugLanFlow('PLAYER_RUNTIME_PATCH_APPLIED', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
        });
        debugLanFlow('PLAYER_APPLY_EVENT_OK', {
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        });
        await ackEvent(event);
        traceFunctionReturn('useLanRealtimePlayerPatches.applyOneEvent', {
          applied: true,
          eventId: event.id,
          type: event.type,
        }, {
          screen: 'sheet',
          source: 'useLanRealtimePlayerPatches',
          sessionId,
          playerKey: selfKey,
          eventId: event.id,
          eventType: event.type,
          seq: event.seq,
          entityRevision: event.entityRevision,
          durationMs: Date.now() - startedAt,
        });
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
      }
    };

    const applyEvents = async () => {
      if (applyRunningRef.current) return;
      applyRunningRef.current = true;
      const startedAt = Date.now();
      traceFunctionCall('useLanRealtimePlayerPatches.applyEvents', {
        joinUrl,
        sessionId,
        selfKey,
        characterName,
      }, {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches',
        sessionId,
        playerKey: selfKey,
        characterName,
      });

      try {
        const events = await fetchLanSessionEvents(joinUrl, sessionId);
        const ordered = [...events]
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
            debugLanFlow('PLAYER_EVENT_RECEIVED_IMMEDIATE', {
              eventId: event.id,
              type: event.type,
              seq: event.seq,
              serverSeq: event.serverSeq,
              toKey: event.toKey,
              selfKey,
            });
            return event;
          })
          .filter(isForMe)
          .sort((a, b) => {
            const seqDiff = getEventSeq(a) - getEventSeq(b);
            if (seqDiff !== 0) return seqDiff;
            return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
          });

        for (const event of ordered) {
          if (disposed) return;
          await applyOneEvent(event);
        }
        traceFunctionReturn('useLanRealtimePlayerPatches.applyEvents', {
          fetchedCount: events.length,
          targetedCount: ordered.length,
        }, {
          screen: 'sheet',
          source: 'useLanRealtimePlayerPatches',
          sessionId,
          playerKey: selfKey,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        useLanRealtimeStore.getState().setConnection({
          sessionId,
          playerKey: selfKey,
          connected: false,
        });
        console.warn('[LAN] Não foi possível buscar eventos em tempo real:', error);
        await requestResyncIfNeeded('fetch_error');
      } finally {
        applyRunningRef.current = false;
      }
    };

    void applyEvents();

    const timer = setInterval(() => {
      traceApp('POLLING_TICK', 'PLAYER_EVENT_POLLING_TICK', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches',
        sessionId,
        playerKey: selfKey,
      });
      void applyEvents();
    }, 750);

    const unsubscribe = subscribeLanSessionClientUpdates(joinUrl, () => {
      // O transporte agora trata payload_update como cache estrutural.
      // Aqui buscamos/aplicamos apenas eventos vivos para evitar rollback por snapshot antigo.
      traceApp('SUBSCRIPTION_UPDATE', 'PLAYER_CLIENT_SUBSCRIPTION_UPDATE', {
        screen: 'sheet',
        source: 'useLanRealtimePlayerPatches',
        sessionId,
        playerKey: selfKey,
      });
      void applyEvents();
    });

    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, selfKey, sessionId]);
}
