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
            await onNumberPatch(event.numberPatch, event);
          }

          if (event.type === 'player_kicked') {
            await onKicked?.(event);
          }
        }
      } catch (error) {
        console.warn('[LAN] Não foi possível buscar eventos em tempo real:', error);
      }
    };

    void applyEvents();
    const unsubscribe = subscribeLanSessionClientUpdates(joinUrl, () => {
      void applyEvents();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [characterName, enabled, joinUrl, onKicked, onNumberPatch, selfKey, sessionId]);
}
