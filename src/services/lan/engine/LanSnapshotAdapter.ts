import type { LanSessionPayload } from '../../lanSession';
import type { LanSnapshot } from './LanTypes';

export function legacyPayloadToLanSnapshot(
  payload: LanSessionPayload,
  options?: {
    source?: 'session_snapshot' | 'payload_update' | 'bootstrap' | 'resync';
    structural?: boolean;
    snapshotSeq?: number;
  },
): LanSnapshot {
  const sessionId = String(payload.session?.id || '');
  const events = Array.isArray(payload.events) ? payload.events : [];
  const maxEventSeq = events.reduce((max, event) => (
    Math.max(max, cleanTransportSeq(event.serverSeq), cleanTransportSeq(event.seq))
  ), 0);
  const snapshotSeq = cleanTransportSeq(options?.snapshotSeq);
  const serverSeq = Math.max(snapshotSeq, maxEventSeq);
  const versions = collectReliableVersions(payload);

  return {
    sessionId,
    serverSeq,
    structural: options?.structural ?? !versions,
    state: {
      status: payload.state?.status || 'active',
      currentTurn: payload.state?.currentTurn || 1,
      elapsedMinutes: payload.state?.elapsedMinutes || 0,
      players: payload.state?.players || [],
    },
    versions,
  };
}

function collectReliableVersions(payload: LanSessionPayload): LanSnapshot['versions'] | undefined {
  const sessionRevision = Math.max(
    cleanDomainRevision((payload.state as any)?.sessionRevisionSeq),
    cleanDomainRevision((payload.state as any)?.revisionSeq),
  );
  const versions: NonNullable<LanSnapshot['versions']> = {
    session: sessionRevision,
    players: {},
    inventories: {},
    effects: {},
    pendingSaves: {},
    trades: {},
  };

  let hasReliableVersion = sessionRevision > 0;
  for (const player of payload.state?.players || []) {
    const key = String(player.remoteKey || `${payload.session?.id}:${player.sourceCharacterId || player.characterId || player.id}:${player.characterName}`);
    const playerRevision = cleanDomainRevision(player.playerRevisionSeq);
    const inventoryRevision = cleanDomainRevision(player.inventoryRevisionSeq);
    const effectRevision = cleanDomainRevision(player.effectRevisionSeq);
    const pendingSaveRevision = cleanDomainRevision(player.pendingSaveRevisionSeq);
    const tradeRevision = cleanDomainRevision(player.tradeRevisionSeq);
    if (playerRevision > 0) {
      versions.players![key] = playerRevision;
      hasReliableVersion = true;
    }
    if (inventoryRevision > 0) {
      versions.inventories![key] = inventoryRevision;
      hasReliableVersion = true;
    }
    if (effectRevision > 0) {
      versions.effects![key] = effectRevision;
      hasReliableVersion = true;
    }
    if (pendingSaveRevision > 0) {
      versions.pendingSaves![key] = pendingSaveRevision;
      hasReliableVersion = true;
    }
    if (tradeRevision > 0) {
      versions.trades![key] = tradeRevision;
      hasReliableVersion = true;
    }
  }

  return hasReliableVersion ? versions : undefined;
}

function cleanTransportSeq(value: unknown) {
  const seq = Math.max(0, Math.floor(Number(value || 0) || 0));
  return Number.isFinite(seq) ? seq : 0;
}

function cleanDomainRevision(value: unknown) {
  const revision = Math.max(0, Math.floor(Number(value || 0) || 0));
  if (!Number.isFinite(revision)) return 0;
  return revision > 1000000 ? 0 : revision;
}
