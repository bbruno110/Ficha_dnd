import { LanCommandKind, LanOfficialEventMessage, LanSessionRecord } from '../../types/lan';

export type StartMasterOptions = {
  sessionName: string;
  syncCustomContent: boolean;
  selectedContent: string[];
  allowExistingCharacter: boolean;
  linkedCharacterId?: number | null;
};

export type JoinSessionOptions = {
  code: string;
  playerName: string;
  linkedCharacterId?: number | null;
};

export type LanPlayerSummary = {
  device_id: string;
  player_name: string;
  character_id?: number | null;
  character_name?: string | null;
  connected: number;
  last_seen_at: string;
  snapshot_payload?: string | null;
  snapshot_updated_at?: string | null;
};

export type LanConnectionStatus = 'connected' | 'syncing' | 'reconnecting' | 'disconnected';

export type LanSessionContextValue = {
  activeSession: LanSessionRecord | null;
  savedSessions: LanSessionRecord[];
  isTransportReady: boolean;
  connectionStatus: LanConnectionStatus;
  peerCount: number;
  lastError: string | null;
  lastNotice: string | null;
  lanRevision: number;
  localDeviceId: string;
  players: LanPlayerSummary[];
  refreshActiveSession: () => Promise<void>;
  refreshSavedSessions: () => Promise<void>;
  forceRecoverLanSession: (reason?: string) => Promise<void>;
  startMasterSession: (options: StartMasterOptions) => Promise<LanSessionRecord>;
  joinPlayerSession: (options: JoinSessionOptions) => Promise<LanSessionRecord>;
  resumeLanSession: (sessionId: string) => Promise<void>;
  closeActiveSession: () => Promise<void>;
  linkCharacterToActiveSession: (characterId: number | null) => Promise<void>;
  broadcastCharacter: (characterId: number, reason?: string) => Promise<void>;
  sendLanCommand: (command: LanCommandKind, payload?: Record<string, unknown>) => Promise<void>;
  getHistoryPage: (page?: number, pageSize?: number) => Promise<LanOfficialEventMessage[]>;
  pauseActiveSession: () => Promise<void>;
  resumeActiveSession: () => Promise<void>;
  endActiveSession: () => Promise<void>;
  refreshPlayers: () => Promise<void>;
};
