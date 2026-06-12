import { useEffect, useRef } from 'react';

import {
  ackLanSessionEvent,
  fetchLanSessionEvents,
  nackLanSessionEvent,
  requestLanSessionResync,
  subscribeLanSessionClientUpdates,
  type LanSessionEvent,
  type LanSessionPayload,
} from '@/services/lanSession';
import {
  isLanSessionGlobalEvent,
  isLanLiveCommittedEvent,
  LAN_ENGINE_PROJECTION_MODE,
  shouldPlayerProcessLanEvent,
  shouldRequestLanResync,
} from '@/services/lan/lanClientEngine';
import {
  applyIncomingLegacyLanEvent,
  applyIncomingSnapshot,
} from '@/services/lan/engine/LanEngineBridge';
import { legacyPayloadToLanSnapshot } from '@/services/lan/engine/LanSnapshotAdapter';
import { LAN_NETWORK_LIMITS, isCriticalLanSessionEvent } from '@/services/lan/lanNetworkPolicy';
import { debugLanFlow } from '@/services/lanRuntimeMode';
import { getKnownLanEntityRevisions, useLanRealtimeStore } from '@/stores/lanRealtimeStore';

type LanNumberPatch = NonNullable<LanSessionEvent['numberPatch']>;
type LanEffectPatch = NonNullable<LanSessionEvent['effectPatch']>;
type LanInventoryPatch = NonNullable<LanSessionEvent['inventoryPatch']>;
type LanStatsPatch = NonNullable<LanSessionEvent['statsPatch']>;

// v56: telas duplicadas/rebind podem receber o mesmo evento no mesmo milissegundo.
// Este lock global impede aplicar o mesmo effect_patch/session_patch duas vezes
// antes que o store consiga marcar o evento como aplicado.
const GLOBAL_LAN_EVENT_APPLY_IN_FLIGHT = new Set<string>();
// Seq no transporte TCP geralmente é Date.now(). Uma pequena janela de overlap
// evita perder patches vivos quando a tela/rebind perde a notificação do socket,
// mas outro evento posterior já avançou o lastAppliedSeq global.
const POLL_OVERLAP_SEQ_WINDOW = 10000;
const PROJECTION_ONLY_EVENT_TYPES = new Set<string>([
  'player_patch',
  'effect_patch',
  'inventory_patch',
]);

function shouldKeepLegacyUiCallback(event: LanSessionEvent) {
  return event.type === 'session_patch' ||
    event.type === 'session_ended' ||
    event.type === 'player_kicked';
}

export type UseLanRealtimePlayerPatchesParams = {
  enabled: boolean;
  joinUrl?: string;
  sessionId?: string;
  selfKey?: string;
  characterName?: string;
  paused?: boolean;
  reconnectEpoch?: number;
  runtimeManagedExternally?: boolean;

  onNumberPatch?: (patch: LanNumberPatch, event: LanSessionEvent) => void | Promise<void>;
  onEffectPatch?: (patch: LanEffectPatch, event: LanSessionEvent) => void | Promise<void>;
  onInventoryPatch?: (patch: LanInventoryPatch, event: LanSessionEvent) => void | Promise<void>;
  onStatsPatch?: (patch: LanStatsPatch, event: LanSessionEvent) => void | Promise<void>;
  onEvent?: (event: LanSessionEvent) => void | Promise<void>;
  onSessionPatch?: (event: LanSessionEvent) => void | Promise<void>;
  onKicked?: (event: LanSessionEvent) => void | Promise<void>;
  onPayloadUpdate?: (payload: LanSessionPayload, reason?: string) => void | Promise<void>;

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
  runtimeManagedExternally = false,
  onNumberPatch,
  onEffectPatch,
  onInventoryPatch,
  onStatsPatch,
  onEvent,
  onSessionPatch,
  onKicked,
  onPayloadUpdate,
  onHostUnreachable,
}: UseLanRealtimePlayerPatchesParams) {
  const onNumberPatchRef = useRef(onNumberPatch);
  const onEffectPatchRef = useRef(onEffectPatch);
  const onInventoryPatchRef = useRef(onInventoryPatch);
  const onStatsPatchRef = useRef(onStatsPatch);
  const onSessionPatchRef = useRef(onSessionPatch);
  const onEventRef = useRef(onEvent);
  const onKickedRef = useRef(onKicked);
  const onPayloadUpdateRef = useRef(onPayloadUpdate);
  const onHostUnreachableRef = useRef(onHostUnreachable);
  const applyRunningRef = useRef(false);
  const processingEventIdsRef = useRef<Set<string>>(new Set());
  // Eventos destinados a outros jogadores não podem ficar reaparecendo a cada
  // polling/forceFullDrain. Sem essa lista, o cliente buscava tudo de novo e o
  // tracer chegava a 2000 logs para uma sequência curta da mesa.
  const ignoredForeignEventIdsRef = useRef<Set<string>>(new Set());
  const applyQueueRef = useRef<LanSessionEvent[]>([]);
  const queueRunningRef = useRef(false);
  const lastResyncRequestAtRef = useRef(0);
  const consecutiveFetchErrorsRef = useRef(0);
  const hostUnreachableNotifiedRef = useRef(false);

  useEffect(() => {
    onNumberPatchRef.current = onNumberPatch;
    onEffectPatchRef.current = onEffectPatch;
    onInventoryPatchRef.current = onInventoryPatch;
    onStatsPatchRef.current = onStatsPatch;
    onSessionPatchRef.current = onSessionPatch;
    onEventRef.current = onEvent;
    onKickedRef.current = onKicked;
    onPayloadUpdateRef.current = onPayloadUpdate;
    onHostUnreachableRef.current = onHostUnreachable;
  }, [onEffectPatch, onEvent, onHostUnreachable, onInventoryPatch, onStatsPatch, onKicked, onPayloadUpdate, onNumberPatch, onSessionPatch]);

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

    // v99: quando o runtime global do _layout esta ativo, esta tela NAO pode
    // abrir outro listener/socket, fazer polling, ACK/NACK ou aplicar patches.
    // A ficha vira somente leitora do store vivo. Isso elimina competicao entre:
    // LanActiveRuntimeSync + useLanRealtimePlayerPatches + loadData ao voltar do level-up.
    if (runtimeManagedExternally) {
      debugLanFlow('PLAYER_SHEET_HOOK_FULLY_DISABLED_EXTERNAL_RUNTIME_V99', {
        sessionId,
        selfKey,
        characterName,
        reconnectEpoch,
      });
      processingEventIdsRef.current.clear();
      ignoredForeignEventIdsRef.current.clear();
      applyQueueRef.current = [];
      queueRunningRef.current = false;
      applyRunningRef.current = false;
      useLanRealtimeStore.getState().setConnection({
        sessionId,
        playerKey: selfKey,
        connected: true,
      });
      return;
    }

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

    const ackEventInBackground = (event: LanSessionEvent) => {
      // v82: ACK nunca pode segurar a fila de aplicação local.
      // O log da v81 mostrou a 1ª troca aplicando, e as próximas inventory_patch
      // chegando no socket sem PLAYER_APPLY_EVENT_START. O ponto mais provável era
      // a fila presa aguardando ACK/reconnect após PLAYER_INVENTORY_PATCH_EVENT_APPLY_OK.
      // A ficha já está atualizada e o evento já foi marcado aplicado localmente;
      // se o ACK falhar, o host pode reenviar e a idempotência local bloqueia duplicidade.
      void ackEvent(event).catch(() => undefined);
    };

    const requestResyncIfNeeded = async (
      reason = 'manual',
      options?: { force?: boolean; forceReconnect?: boolean; coldStart?: boolean; includeGlobal?: boolean },
    ) => {
      if (paused) return;
      const now = Date.now();
      const urgent = /socket_closed|foreground|mount_or_rebind|focus|fetch_error|background|resume|recovery/i.test(reason);
      const minInterval = urgent ? 1200 : LAN_NETWORK_LIMITS.resyncMinIntervalMs;
      if (!options?.force && now - lastResyncRequestAtRef.current < minInterval) return;
      lastResyncRequestAtRef.current = now;

      try {
        const runtime = useLanRealtimeStore.getState();
        const lastAppliedSeq = options?.coldStart ? 0 : runtime.lastAppliedSeq;
        debugLanFlow(options?.coldStart ? 'PLAYER_FOREGROUND_COLD_RESYNC_START' : 'PLAYER_SEQ_GAP_RESYNC_START', {
          reason,
          sessionId,
          selfKey,
          lastAppliedSeq,
          force: Boolean(options?.force),
          forceReconnect: Boolean(options?.forceReconnect),
          coldStart: Boolean(options?.coldStart),
        });
        await requestLanSessionResync(joinUrl, {
          sessionId,
          playerKey: selfKey,
          lastAppliedSeq,
          knownRevisions: getKnownLanEntityRevisions(sessionId),
          includeGlobal: options?.includeGlobal !== false,
          forceReconnect: Boolean(options?.forceReconnect),
        });
        debugLanFlow(options?.coldStart ? 'PLAYER_FOREGROUND_COLD_RESYNC_DONE' : 'PLAYER_SEQ_GAP_RESYNC_DONE', {
          reason,
          sessionId,
          selfKey,
        });
        setTimeout(() => {
          if (!disposed) void applyEvents({ forceFullDrain: Boolean(options?.coldStart), reason: `after_resync:${reason}` });
        }, 300);
      } catch (error) {
        console.warn('[LAN] Não foi possível solicitar resync ao host:', error);
      }
    };

    const applyOneEvent = async (event: LanSessionEvent) => {
      const eventKey = String(event.id || event.clientMsgId || '');
      const globalEventKey = eventKey ? `${sessionId}:${selfKey || characterName || 'player'}:${eventKey}` : '';
      if (eventKey && processingEventIdsRef.current.has(eventKey)) return;
      if (globalEventKey && GLOBAL_LAN_EVENT_APPLY_IN_FLIGHT.has(globalEventKey)) {
        debugLanFlow('PLAYER_EVENT_DUPLICATE_IN_FLIGHT_SKIPPED', {
          eventId: event.id,
          type: event.type,
          sessionId,
          selfKey,
        });
        return;
      }
      const releaseEventKey = () => {
        if (eventKey) processingEventIdsRef.current.delete(eventKey);
        if (globalEventKey) GLOBAL_LAN_EVENT_APPLY_IN_FLIGHT.delete(globalEventKey);
      };
      if (eventKey) processingEventIdsRef.current.add(eventKey);
      if (globalEventKey) GLOBAL_LAN_EVENT_APPLY_IN_FLIGHT.add(globalEventKey);
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

      const isSelfInventoryPatch = Boolean(
        event.type === 'inventory_patch' &&
        event.inventoryPatch &&
        isExplicitlyTargetedToSelf(event)
      );
      const hasInventoryDeltas = Boolean(
        Array.isArray((event.inventoryPatch as any)?.itemDeltas) && (event.inventoryPatch as any).itemDeltas.length > 0 ||
        Array.isArray((event.inventoryPatch as any)?.tradeCommit?.itemDeltas) && (event.inventoryPatch as any).tradeCommit.itemDeltas.length > 0 ||
        (event.inventoryPatch as any)?.itemDelta
      );
      const isTradeLikeInventoryPatch = Boolean(
        isSelfInventoryPatch &&
        (
          String(event.inventoryPatch?.action || '') === 'trade_commit' ||
          Boolean((event.inventoryPatch as any)?.tradeCommit) ||
          /aceitou trocar|troca conclu/i.test(String(event.message || ''))
        )
      );
      const forceSelfInventoryTransaction = Boolean(
        isSelfInventoryPatch &&
        hasInventoryDeltas &&
        decision.reason !== 'duplicate_id' &&
        (isTradeLikeInventoryPatch || decision.reason === 'old_entity_revision' || decision.reason === 'old_seq' || decision.reason === 'seq_gap')
      );

      if (!decision.apply && forceSelfInventoryTransaction) {
        debugLanFlow('PLAYER_FORCE_APPLY_SELF_TRADE_COMMIT_DESPITE_DECISION', {
          reason: decision.reason,
          eventId: event.id,
          type: event.type,
          seq: event.seq,
          entityType: event.entityType,
          entityId: event.entityId,
          entityRevision: event.entityRevision,
          currentRevision: decision.currentRevision,
          inventoryTargetKey: event.inventoryPatch?.targetKey,
          selfKey,
          characterName,
        });
      }

      if (!decision.apply && !forceSelfInventoryTransaction) {
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
          releaseEventKey();
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

        if (LAN_ENGINE_PROJECTION_MODE) {
          const eventType = String(event.type || '');
          const projectionOnly = PROJECTION_ONLY_EVENT_TYPES.has(eventType);
          if (eventType !== 'public_status') {
            applyIncomingLegacyLanEvent(event);
          }
          if (!projectionOnly && eventType !== 'public_status') {
            useLanRealtimeStore.getState().publishLiveEvent(event);
          }

          if (projectionOnly && !shouldKeepLegacyUiCallback(event)) {
            useLanRealtimeStore.getState().markEventApplied(event);
            debugLanFlow('PLAYER_EVENT_FORWARDED_TO_PROJECTION_ONLY_CUT6', {
              eventId: event.id,
              type: event.type,
              sessionId,
              selfKey,
              decision: 'no_legacy_gameplay_callback_no_live_event_store',
            });
            releaseEventKey();
            ackEventInBackground(event);
            return;
          }
        }

        if (event.type === 'session_ended') {
          useLanRealtimeStore.getState().markEventApplied(event);
          debugLanFlow('PLAYER_APPLY_EVENT_OK', {
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityRevision: event.entityRevision,
            lastAppliedSeq: useLanRealtimeStore.getState().lastAppliedSeq,
          });
          releaseEventKey();
          ackEventInBackground(event);
          await onSessionPatchRef.current?.(event);
          return;
        }

        if (event.type === 'player_patch' && event.statsPatch && !event.numberPatch) {
          debugLanFlow('PLAYER_STATS_PATCH_RECEIVED_LIVE', {
            eventId: event.id,
            seq: event.seq,
            serverSeq: event.serverSeq,
            entityRevision: event.entityRevision,
            toKey: event.toKey,
            toName: event.toName,
            patch: event.statsPatch,
          });
          if (onStatsPatchRef.current) {
            await onStatsPatchRef.current(event.statsPatch, event);
          } else {
            await onEventRef.current?.(event);
          }
          useLanRealtimeStore.getState().markEventApplied(event);
          releaseEventKey();
          ackEventInBackground(event);
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
            hasStatsPatch: Boolean(event.statsPatch),
          });
          if (!onNumberPatchRef.current) {
            throw new Error('onNumberPatch handler nao configurado.');
          }
          // HP/XP/moedas/PV temp são absolutos. Eles não podem rodar em paralelo,
          // senão um patch antigo termina depois e faz a vida "voltar".
          await onNumberPatchRef.current?.(event.numberPatch!, event);
          // Um player_patch pode carregar statsPatch/progressionPatch junto com numberPatch
          // (ex.: level-up altera HP maximo, classe e atributos no mesmo commit).
          // Antes o retorno aqui podia ignorar a progressao quando a ficha estava fechada
          // e voltava apenas pelo checkpoint.
          if (event.statsPatch) {
            if (onStatsPatchRef.current) {
              await onStatsPatchRef.current(event.statsPatch, event);
            } else {
              await onEventRef.current?.(event);
            }
          }
          if ((event as any).progressionPatch) {
            await onEventRef.current?.(event);
          }
          useLanRealtimeStore.getState().markEventApplied(event);
          releaseEventKey();
          ackEventInBackground(event);
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
            hasBundledNumberPatch: Boolean(event.numberPatch),
          });
          if (!onEffectPatchRef.current) {
            throw new Error('onEffectPatch handler nao configurado.');
          }
          // v74: efeito de PV temporario pode vir com numberPatch no mesmo evento.
          // Aplique o numero primeiro e o efeito depois, em um unico ACK. Isso evita
          // dois eventos separados competindo/reordenando tempHp e borda/efeito.
          if (event.numberPatch) {
            if (!onNumberPatchRef.current) {
              throw new Error('onNumberPatch handler nao configurado para effect_patch com numberPatch.');
            }
            await onNumberPatchRef.current(event.numberPatch, event);
          }
          // Efeito pode alterar PV temporario/atributos. Nao rode em background:
          // se um dano ou passagem de turno chegar logo depois, o patch antigo
          // poderia terminar por ultimo e fazer HP/PV temp voltar.
          await onEffectPatchRef.current(event.effectPatch!, event);
          useLanRealtimeStore.getState().markEventApplied(event);
          releaseEventKey();
          ackEventInBackground(event);
          return;
        } else if (event.type === 'inventory_patch' && event.inventoryPatch) {
          // Inventário também é snapshot absoluto. Aplique serialmente para não
          // deixar troca/doação chegar fora de ordem quando há 3+ jogadores.
          if (!onInventoryPatchRef.current) {
            throw new Error('onInventoryPatch handler nao configurado.');
          }
          await onInventoryPatchRef.current(event.inventoryPatch!, event);
          useLanRealtimeStore.getState().markEventApplied(event);
          debugLanFlow('PLAYER_INVENTORY_PATCH_EVENT_APPLY_OK', {
            eventId: event.id,
            type: event.type,
            seq: event.seq,
            entityRevision: event.entityRevision,
            action: event.inventoryPatch?.action,
            targetKey: event.inventoryPatch?.targetKey,
          });
          releaseEventKey();
          ackEventInBackground(event);
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
        releaseEventKey();
        ackEventInBackground(event);
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
        releaseEventKey();
      }
    };


    const drainApplyQueue = async () => {
      if (queueRunningRef.current) return;
      queueRunningRef.current = true;
      try {
        while (applyQueueRef.current.length > 0) {
          applyQueueRef.current.sort((a, b) => {
            const seqDiff = getEventSeq(a) - getEventSeq(b);
            if (seqDiff !== 0) return seqDiff;
            const revDiff = Number(a.entityRevision || 0) - Number(b.entityRevision || 0);
            if (revDiff !== 0) return revDiff;
            return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
          });
          const next = applyQueueRef.current.shift();
          if (!next || disposed) continue;
          await applyOneEvent(next);
        }
      } finally {
        queueRunningRef.current = false;
        if (!disposed && applyQueueRef.current.length > 0) {
          void drainApplyQueue();
        }
      }
    };

    const enqueueApplyEvent = (event: LanSessionEvent) => {
      const key = String(event.id || event.clientMsgId || '');
      if (key) {
        const alreadyQueued = applyQueueRef.current.some((queued) => String(queued.id || queued.clientMsgId || '') === key);
        if (alreadyQueued) return;
        if (processingEventIdsRef.current.has(key)) return;
      }
      applyQueueRef.current.push(event);
      void drainApplyQueue();
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
        const pollAfterSeq = options?.forceFullDrain
          ? 0
          : Math.max(0, Number(runtimeBeforeFetch.lastAppliedSeq || 0) - POLL_OVERLAP_SEQ_WINDOW);
        const events = await fetchLanSessionEvents(joinUrl, sessionId, {
          afterSeq: pollAfterSeq,
          playerKey: selfKey,
          includeGlobal: true,
        });
        if (hostUnreachableNotifiedRef.current) {
          debugLanFlow('PLAYER_HOST_REACHABLE_AGAIN', {
            sessionId,
            selfKey,
            previousConsecutiveFetchErrors: consecutiveFetchErrorsRef.current,
          });
        }
        hostUnreachableNotifiedRef.current = false;
        consecutiveFetchErrorsRef.current = 0;
        useLanRealtimeStore.getState().setConnection({
          sessionId,
          playerKey: selfKey,
          connected: true,
        });
        const runtimeAfterFetch = useLanRealtimeStore.getState();
        const freshEvents = events.filter((event) => (
          !runtimeAfterFetch.appliedEventIds[event.id] &&
          !ignoredForeignEventIdsRef.current.has(event.id)
        ));
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
        const acceptedEvents: typeof freshEvents = [];
        for (const event of freshEvents) {
          const accepted = shouldProcessEvent(event);
          const explicitSelfTarget = isExplicitlyTargetedToSelf(event);
          if (!accepted && !explicitSelfTarget) {
            foreignSkippedCount += 1;
            if (selfKey) ignoredForeignEventIdsRef.current.add(event.id);
            continue;
          }
          if (!accepted && explicitSelfTarget) {
            debugLanFlow('PLAYER_FORCE_PROCESS_EXPLICIT_SELF_TARGET_EVENT_FROM_POLL', {
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
          acceptedEvents.push(event);
        }
        if (acceptedEvents.length > 0) {
          const first = acceptedEvents[0];
          const last = acceptedEvents[acceptedEvents.length - 1];
          debugLanFlow('PLAYER_EVENTS_BATCH_RECEIVED', {
            sessionId,
            selfKey,
            characterName,
            count: acceptedEvents.length,
            firstEventId: first?.id,
            firstType: first?.type,
            firstSeq: first?.seq,
            lastEventId: last?.id,
            lastType: last?.type,
            lastSeq: last?.seq,
          });
        }
        const ordered = acceptedEvents
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
          const key = String(event.id || event.clientMsgId || '');
          if (key && (processingEventIdsRef.current.has(key) || applyQueueRef.current.some((queued) => String(queued.id || queued.clientMsgId || '') === key))) {
            continue;
          }
          applyQueueRef.current.push(event);
        }
        await drainApplyQueue();
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
          // Host temporariamente inalcançável não encerra sessão. Notifique a UI
          // uma vez e continue tentando polling/reconnect nas próximas rodadas.
          // Isso cobre mestre/jogador abrindo outro app, hotspot oscilando ou
          // Android suspendendo o socket por alguns segundos.
          if (!hostUnreachableNotifiedRef.current) {
            hostUnreachableNotifiedRef.current = true;
            debugLanFlow('PLAYER_HOST_UNREACHABLE_DETECTED', {
              sessionId,
              selfKey,
              consecutiveFetchErrors: consecutiveFetchErrorsRef.current,
              reason,
            });
            await onHostUnreachableRef.current?.(reason);
          } else {
            debugLanFlow('PLAYER_HOST_STILL_UNREACHABLE_KEEP_RETRYING', {
              sessionId,
              selfKey,
              consecutiveFetchErrors: consecutiveFetchErrorsRef.current,
              reason,
            });
          }
          return;
        }

        if (!paused) {
          await requestResyncIfNeeded('fetch_error', { forceReconnect: consecutiveFetchErrorsRef.current >= 2, includeGlobal: true });
        }
      } finally {
        applyRunningRef.current = false;
      }
    };

    if (!paused) {
      if (runtimeManagedExternally) {
        debugLanFlow('PLAYER_SHEET_HOOK_EXTERNAL_RUNTIME_LIGHT_MODE_V98', {
          sessionId,
          selfKey,
          reconnectEpoch,
        });
        setTimeout(() => { if (!disposed) void applyEvents({ reason: 'external_runtime_light_mount_v98' }); }, 120);
      } else {
        // Ao montar por QR ou pela Home/index, primeiro reenvie hello/resync com
        // playerKey. Depois drene o buffer. Evita enxurrada de snapshots e mantém
        // o socket associado ao jogador no host.
        void requestResyncIfNeeded('mount_or_rebind');
        setTimeout(() => { if (!disposed) void applyEvents({ reason: 'mount_or_reconnect' }); }, 120);
        setTimeout(() => { if (!disposed) void applyEvents({ reason: 'post_mount_buffer_flush_650ms' }); }, 650);
        // v96: sync global mantém a ficha atualizada fora da tela. Ao montar/rebind,
        // nao faça cold drain de toda a sessao, porque isso compete com eventos vivos
        // logo depois do level-up e deixa a ficha parecer travada/lenta.
        setTimeout(() => { if (!disposed) void applyEvents({ reason: 'mount_or_rebind_incremental_confirm_v96' }); }, 900);
      }
      if (reconnectEpoch > 0 && !runtimeManagedExternally) {
        // v86: voltar de outro app/tela bloqueada precisa de recuperacao pesada.
        // O socket pode parecer aberto, mas estar sem binding real no host. Fazemos:
        // 1) reconnect TCP forcado; 2) resync incremental; 3) cold resync/checkpoints;
        // 4) full drain do buffer local. Assim HP, inventario, efeitos e turnos convergem
        // mesmo depois de varios minutos em background.
        setTimeout(() => {
          if (!disposed) void requestResyncIfNeeded('foreground_reconnect_force_socket', {
            force: true,
            forceReconnect: true,
            includeGlobal: true,
          });
        }, 80);
        setTimeout(() => {
          if (!disposed) void applyEvents({ forceFullDrain: true, reason: 'foreground_reconnect_full_drain_450ms' });
        }, 450);
        setTimeout(() => {
          if (!disposed) void requestResyncIfNeeded('foreground_reconnect_cold_checkpoint', {
            force: true,
            forceReconnect: false,
            coldStart: true,
            includeGlobal: true,
          });
        }, 950);
        setTimeout(() => {
          if (!disposed) void applyEvents({ forceFullDrain: true, reason: 'foreground_reconnect_full_drain_1600ms' });
        }, 1600);
        setTimeout(() => {
          if (!disposed) void requestResyncIfNeeded('foreground_reconnect_confirm_checkpoint', {
            force: true,
            forceReconnect: false,
            coldStart: true,
            includeGlobal: true,
          });
        }, 2800);
      }
    } else {
      useLanRealtimeStore.getState().setConnection({ sessionId, playerKey: selfKey, connected: true });
    }

    const timer = paused || runtimeManagedExternally
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
        if (!runtimeManagedExternally) {
          setTimeout(() => {
            if (!disposed) void requestResyncIfNeeded('socket_closed', { force: true, forceReconnect: true, includeGlobal: true });
          }, 150);
          setTimeout(() => {
            if (!disposed) void applyEvents({ forceFullDrain: false, reason: 'socket_closed_recovery_flush' });
          }, 700);
        }
      }
      if (update?.payload) {
        // Snapshot/payload agora também serve como reconciliação autoritativa de roster/inventário.
        // Ele não substitui eventos vivos; apenas corrige a mochila se um inventory_patch/trade_result
        // foi recebido pelo transporte, mas perdeu a janela do listener durante reconnect/rebind.
        if (LAN_ENGINE_PROJECTION_MODE) {
          applyIncomingSnapshot(legacyPayloadToLanSnapshot(update.payload, {
            source: String(update.reason || '').includes('resync') ? 'resync' : 'payload_update',
            structural: true,
          }));
        } else {
          void Promise.resolve(onPayloadUpdateRef.current?.(update.payload, update.reason)).catch(() => undefined);
        }
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
          enqueueApplyEvent(event);
        } else {
          // Evento de outro jogador. Marque como ignorado localmente para não gerar
          // loop de polling/resync nem inundar o tracer do jogador.
          if (selfKey && event?.id) ignoredForeignEventIdsRef.current.add(event.id);
        }
      }
    });

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, paused, reconnectEpoch, runtimeManagedExternally, selfKey, sessionId]);
}
