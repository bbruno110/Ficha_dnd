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

const LIVE_EVENT_TYPES = new Set<LanSessionEvent['type']>([
  'player_patch',
  'effect_patch',
  'inventory_patch',
  'session_patch',
  'player_kicked',
  'resource_review',
  'send_item',
  'trade_offer',
  'trade_accept',
  'trade_decline',
  'spell_hp',
  'spell_effect',
  'effect_expired',
  'pending_save_patch',
  'public_status',
]);

function isSessionWideEvent(event: LanSessionEvent) {
  return event.toKey === 'session' ||
    event.toKey === 'party' ||
    event.toKey === 'all' ||
    event.type === 'session_patch' ||
    event.type === 'timeline_event' ||
    event.type === 'public_status';
}

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
      if (!LIVE_EVENT_TYPES.has(event.type)) return false;
      if (event.toKey === 'master') {
        debugLanFlow('PLAYER_IGNORE_EVENT_TO_MASTER', {
          eventId: event.id,
          type: event.type,
          fromKey: event.fromKey,
          selfKey,
        });
        return false;
      }
      if (isSessionWideEvent(event)) return true;
      if (selfKey && event.toKey === selfKey) return true;
      if (characterName && event.toName === characterName) return true;

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

    const requestResyncIfNeeded = async () => {
      const now = Date.now();
      if (now - lastResyncRequestAtRef.current < 2500) return;
      lastResyncRequestAtRef.current = now;

      try {
        await requestLanSessionResync(joinUrl, {
          sessionId,
          playerKey: selfKey,
          lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
        });
      } catch (error) {
        console.warn('[LAN] Não foi possível solicitar resync ao host:', error);
      }
    };

    const applyOneEvent = async (event: LanSessionEvent) => {
      const runtime = useLanRealtimeStore.getState();
      const decision = runtime.getEventApplyDecision(event);

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
          await onNumberPatchRef.current(event.numberPatch, event);
        } else if (event.type === 'effect_patch' && event.effectPatch) {
          await onEffectPatchRef.current?.(event.effectPatch, event);
        } else if (event.type === 'inventory_patch' && event.inventoryPatch) {
          await onInventoryPatchRef.current?.(event.inventoryPatch, event);
        } else if (event.type === 'session_patch') {
          await onSessionPatchRef.current?.(event);
        } else if (event.type === 'player_kicked') {
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
        await requestResyncIfNeeded();
      }
    };

    const applyEvents = async () => {
      if (applyRunningRef.current) return;
      applyRunningRef.current = true;

      try {
        const events = await fetchLanSessionEvents(joinUrl, sessionId);
        const ordered = [...events]
          .filter(isForMe)
          .sort((a, b) => {
            const seqDiff = (Number(a.seq || 0) - Number(b.seq || 0));
            if (seqDiff !== 0) return seqDiff;
            return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
          });

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
        await requestResyncIfNeeded();
      } finally {
        applyRunningRef.current = false;
      }
    };

    void applyEvents();

    const timer = setInterval(() => {
      void applyEvents();
    }, 1000);

    const unsubscribe = subscribeLanSessionClientUpdates(joinUrl, () => {
      // O transporte agora trata payload_update como cache estrutural.
      // Aqui buscamos/aplicamos apenas eventos vivos para evitar rollback por snapshot antigo.
      void applyEvents();
    });

    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, selfKey, sessionId]);
}
