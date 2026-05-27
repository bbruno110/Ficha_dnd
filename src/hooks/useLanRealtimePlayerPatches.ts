import { useEffect, useRef } from 'react';

import {
  fetchLanSessionEvents,
  subscribeLanSessionClientUpdates,
  type LanSessionEvent,
  type LanSessionPlayerState,
} from '@/services/lanSession';

type NumberPatch = Partial<Pick<LanSessionPlayerState, 'hpCurrent' | 'hpMax' | 'tempHp' | 'xp' | 'gp' | 'sp' | 'cp'>>;

type UseLanRealtimePlayerPatchesParams = {
  joinUrl?: string;
  sessionId?: string;
  selfKey?: string;
  characterName?: string;
  enabled?: boolean;
  onNumberPatch: (patch: NumberPatch, event: LanSessionEvent) => void | Promise<void>;
  onKicked?: (event: LanSessionEvent) => void | Promise<void>;
};

export function useLanRealtimePlayerPatches({
  joinUrl,
  sessionId,
  selfKey,
  characterName,
  enabled = true,
  onNumberPatch,
  onKicked,
}: UseLanRealtimePlayerPatchesParams) {
  const lastSeqRef = useRef(0);
  const seenIdsRef = useRef(new Set<string>());
  const onNumberPatchRef = useRef(onNumberPatch);
  const onKickedRef = useRef(onKicked);
  const applyRunningRef = useRef(false);

  useEffect(() => {
    onNumberPatchRef.current = onNumberPatch;
    onKickedRef.current = onKicked;
  }, [onKicked, onNumberPatch]);

  useEffect(() => {
    lastSeqRef.current = 0;
    seenIdsRef.current.clear();
  }, [joinUrl, selfKey, sessionId]);

  useEffect(() => {
    if (!enabled || !joinUrl || !sessionId) return;
    let disposed = false;

    const isForMe = (event: LanSessionEvent) => {
      if (event.sessionId !== sessionId) return false;
      if (selfKey && (event.toKey === selfKey || event.fromKey === selfKey)) return true;
      if (characterName && (event.toName === characterName || event.fromName === characterName)) return true;
      return false;
    };

    const applyEvents = async () => {
      if (applyRunningRef.current) return;
      applyRunningRef.current = true;
      try {
        const events = await fetchLanSessionEvents(joinUrl, sessionId);
        const ordered = [...events].sort((a, b) => (a.seq || 0) - (b.seq || 0));

        for (const event of ordered) {
          if (disposed) return;
          if (seenIdsRef.current.has(event.id)) continue;
          if (event.seq && event.seq <= lastSeqRef.current) continue;
          if (!isForMe(event)) continue;

          seenIdsRef.current.add(event.id);
          if (event.seq) lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);

          if (event.type === 'player_patch' && event.numberPatch) {
            await onNumberPatchRef.current(event.numberPatch, event);
          }

          if (event.type === 'player_kicked') {
            await onKickedRef.current?.(event);
          }
        }
      } catch (error) {
        console.warn('[LAN] Não foi possível buscar eventos em tempo real:', error);
      } finally {
        applyRunningRef.current = false;
      }
    };

    void applyEvents();

    const timer = setInterval(() => {
      void applyEvents();
    }, 1000);

    const unsubscribe = subscribeLanSessionClientUpdates(joinUrl, () => {
      void applyEvents();
    });

    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, selfKey, sessionId]);
}
