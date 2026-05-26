import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

type UseLanAppLifecycleParams = {
  enabled: boolean;
  onForeground: () => Promise<void> | void;
  onBackground?: () => Promise<void> | void;
};

export function useLanAppLifecycle({
  enabled,
  onForeground,
  onBackground,
}: UseLanAppLifecycleParams) {
  const lastStateRef = useRef<AppStateStatus>(AppState.currentState);
  const runningRef = useRef(false);

  const safeForeground = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      await onForeground();
    } finally {
      runningRef.current = false;
    }
  }, [onForeground]);

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', async (nextState) => {
      const previousState = lastStateRef.current;
      lastStateRef.current = nextState;

      const cameToForeground =
        previousState.match(/inactive|background/) &&
        nextState === 'active';

      const wentToBackground =
        previousState === 'active' &&
        nextState.match(/inactive|background/);

      if (wentToBackground) {
        try {
          await onBackground?.();
        } catch (error) {
          console.warn('[LAN] Erro ao pausar ciclo de vida LAN:', error);
        }
      }

      if (cameToForeground) {
        try {
          await safeForeground();
        } catch (error) {
          console.warn('[LAN] Erro ao retomar ciclo de vida LAN:', error);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, onBackground, safeForeground]);

  return {
    forceForegroundSync: safeForeground,
  };
}
