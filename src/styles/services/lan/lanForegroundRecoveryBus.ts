export type LanForegroundRecoveryReason =
  | 'app_foreground'
  | 'external_share_returned'
  | 'debug_trace_share_returned'
  | 'screen_focus'
  | string;

type LanForegroundRecoveryListener = (reason: LanForegroundRecoveryReason) => void | Promise<void>;

const listeners = new Set<LanForegroundRecoveryListener>();
let lastSignal = { reason: '' as LanForegroundRecoveryReason, at: 0 };
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

// Compartilhar arquivo dispara AppState foreground e retorno do share quase juntos.
// Sem debounce, o cliente resetava/reabria socket duas vezes e podia ficar preso
// em um socket novo sem rebind no host.
const RECOVERY_SIGNAL_DEBOUNCE_MS = 700;

function emitLanForegroundRecovery(reason: LanForegroundRecoveryReason) {
  for (const listener of Array.from(listeners)) {
    try {
      void listener(reason);
    } catch {
      // Listener failures must never break the UI/share flow.
    }
  }
}

export function notifyLanForegroundRecovery(reason: LanForegroundRecoveryReason = 'app_foreground') {
  const now = Date.now();
  const elapsed = now - lastSignal.at;
  lastSignal = { reason, at: now };

  if (elapsed < RECOVERY_SIGNAL_DEBOUNCE_MS) {
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      emitLanForegroundRecovery(lastSignal.reason);
    }, RECOVERY_SIGNAL_DEBOUNCE_MS - elapsed + 100);
    return;
  }

  if (trailingTimer) {
    clearTimeout(trailingTimer);
    trailingTimer = null;
  }
  emitLanForegroundRecovery(reason);
}

export function subscribeLanForegroundRecovery(listener: LanForegroundRecoveryListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLastLanForegroundRecoverySignal() {
  return lastSignal;
}
