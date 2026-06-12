import { useEffect, useMemo, useState } from 'react';

import {
  getLanProjection,
  subscribeLanProjection,
} from '../services/lan/engine/LanEngineBridge';
import type {
  CharacterProjection,
  SessionProjection,
} from '../services/lan/engine/LanTypes';

export function useLanProjection(
  sessionId?: string | null,
  playerKey?: string | null,
): {
  projection: SessionProjection | null;
  character: CharacterProjection | null;
  isConnected: boolean;
  lastServerSeq: number;
  status: SessionProjection['status'] | null;
} {
  const normalizedSessionId = String(sessionId || '');
  const normalizedPlayerKey = String(playerKey || '');
  const [projection, setProjection] = useState<SessionProjection | null>(() => (
    normalizedSessionId ? getLanProjection(normalizedSessionId) : null
  ));

  useEffect(() => {
    if (!normalizedSessionId) {
      setProjection(null);
      return;
    }

    setProjection(getLanProjection(normalizedSessionId));
    return subscribeLanProjection(normalizedSessionId, setProjection);
  }, [normalizedSessionId]);

  const character = useMemo(() => {
    return selectLanProjectionCharacter(projection, normalizedPlayerKey);
  }, [normalizedPlayerKey, projection]);

  return {
    projection,
    character,
    isConnected: Boolean(projection),
    lastServerSeq: Math.max(0, Number(projection?.serverSeq || 0) || 0),
    status: projection?.status || null,
  };
}

export function selectLanProjectionCharacter(
  projection?: SessionProjection | null,
  playerKey?: string | null,
) {
  const normalizedPlayerKey = String(playerKey || '');
  if (!normalizedPlayerKey) return null;
  return projection?.players?.[normalizedPlayerKey] || null;
}
