export const LAN_DEFAULT_PORT = 45555;

export type LanRole = 'master' | 'player';
export type LanSessionStatus = 'open' | 'connected' | 'paused' | 'closed';

export type LanSessionRecord = {
  id: string;
  name: string;
  role: LanRole;
  status: LanSessionStatus;
  session_code?: string | null;
  host_ip?: string | null;
  port?: number | null;
  sync_custom_content: number;
  selected_content: string;
  allow_existing_character: number;
  linked_character_id?: number | null;
  created_at?: string;
  opened_at?: string | null;
  closed_at?: string | null;
  paused_at?: string | null;
  resumed_at?: string | null;
  last_connected_at?: string | null;
};

export type LanCampaignState = {
  sessionId: string;
  status: LanSessionStatus;
  turn: number;
  campaignMinutes: number;
  paused: boolean;
  updatedAt: string;
};

export type LanCustomContentType =
  | 'Item'
  | 'Efeito'
  | 'Raca'
  | 'Classe'
  | 'Subclasse'
  | 'Magia/Skill'
  | 'Kit'
  | 'Progressao Magica';

export type LanContentTable =
  | 'items'
  | 'effects'
  | 'races'
  | 'classes'
  | 'subclasses'
  | 'spells'
  | 'starting_kits'
  | 'spellcasting_progression';

export type LanCustomContentRef = {
  key: string;
  id: number;
  name: string;
  type: LanCustomContentType;
  tableName: LanContentTable;
  subtitle?: string;
  criador?: string;
};

export type LanCustomContentPayload = {
  type: LanCustomContentType;
  tableName: LanContentTable;
  data: Record<string, unknown>;
};

export type LanCharacterSnapshot = {
  localId: number;
  name: string;
  race: string;
  class: string;
  level: number;
  updatedAt: string;
  data: Record<string, unknown>;
};

export type LanSessionConfig = {
  sessionId: string;
  sessionName: string;
  allowExistingCharacter: boolean;
  syncCustomContent: boolean;
  selectedContent: string[];
};

export type LanHelloMessage = {
  type: 'HELLO';
  sessionId: string;
  deviceId: string;
  playerName: string;
  characterId?: number | null;
  characterName?: string | null;
};

export type LanWelcomeMessage = {
  type: 'WELCOME';
  sessionId: string;
  deviceId: string;
  masterName: string;
  config: LanSessionConfig;
};

export type LanCustomContentMessage = {
  type: 'CUSTOM_CONTENT';
  sessionId: string;
  records: LanCustomContentPayload[];
};

export type LanCharacterMessage = {
  type: 'CHARACTER_UPSERT';
  sessionId: string;
  deviceId: string;
  snapshot: LanCharacterSnapshot;
};

export type LanCommandKind =
  | 'PLAYER_INVENTORY_UPDATE'
  | 'PLAYER_ITEM_DONATE'
  | 'PLAYER_ITEM_DROP'
  | 'PLAYER_ITEM_THROW'
  | 'PLAYER_ITEM_CONSUME'
  | 'PLAYER_EQUIP_ITEM'
  | 'PLAYER_UNEQUIP_ITEM'
  | 'PLAYER_REQUEST_HP'
  | 'PLAYER_REQUEST_XP'
  | 'PLAYER_REQUEST_COINS'
  | 'PLAYER_REQUEST_ATTRIBUTE'
  | 'MASTER_APPLY_HP'
  | 'MASTER_APPLY_TEMP_HP'
  | 'MASTER_APPLY_ATTRIBUTE'
  | 'MASTER_APPLY_XP'
  | 'MASTER_APPLY_COINS'
  | 'MASTER_APPLY_ITEM'
  | 'MASTER_REMOVE_ITEM'
  | 'MASTER_APPLY_EFFECT'
  | 'MASTER_REMOVE_EFFECT'
  | 'MASTER_ADVANCE_TURN'
  | 'MASTER_ADVANCE_TIME'
  | 'MASTER_SHORT_REST'
  | 'MASTER_LONG_REST'
  | 'MASTER_PAUSE_SESSION'
  | 'MASTER_RESUME_SESSION'
  | 'MASTER_END_SESSION'
  | 'MASTER_DENY_REQUEST'
  | 'REQUEST_RESYNC';

export type LanCommandMessage = {
  type: 'LAN_COMMAND';
  sessionId: string;
  commandId: string;
  deviceId: string;
  actorName?: string;
  characterId?: number | null;
  command: LanCommandKind;
  payload?: Record<string, unknown>;
  clientSeq?: number;
  at: string;
};

export type LanOfficialEventType =
  | 'SESSION_STARTED'
  | 'SESSION_PAUSED'
  | 'SESSION_RESUMED'
  | 'SESSION_CLOSED'
  | 'TURN_CHANGED'
  | 'TIME_CHANGED'
  | 'REST_APPLIED'
  | 'HP_CHANGED'
  | 'TEMP_HP_CHANGED'
  | 'XP_CHANGED'
  | 'COINS_CHANGED'
  | 'ATTRIBUTE_CHANGED'
  | 'ITEM_ADDED'
  | 'ITEM_REMOVED'
  | 'ITEM_TRANSFERRED'
  | 'ITEM_CONSUMED'
  | 'ITEM_EQUIPPED'
  | 'ITEM_UNEQUIPPED'
  | 'EFFECT_APPLIED'
  | 'EFFECT_EXPIRED'
  | 'PLAYER_REQUESTED'
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'SNAPSHOT_SYNCED'
  | 'COMMAND_REJECTED';

export type LanOfficialEventMessage = {
  type: 'LAN_EVENT';
  sessionId: string;
  eventId: string;
  seq: number;
  commandId?: string | null;
  eventType: LanOfficialEventType;
  actorDeviceId?: string | null;
  actorName?: string | null;
  targetDeviceId?: string | null;
  targetCharacterId?: number | null;
  targetName?: string | null;
  previousValue?: unknown;
  currentValue?: unknown;
  description: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type LanSessionSnapshotMessage = {
  type: 'SESSION_SNAPSHOT';
  sessionId: string;
  seq: number;
  state: LanCampaignState;
  players: Record<string, unknown>[];
  recentEvents: LanOfficialEventMessage[];
  at: string;
};

export type LanNoticeMessage = {
  type: 'NOTICE' | 'ERROR' | 'PING' | 'SNAPSHOT_REQUEST';
  sessionId?: string;
  message?: string;
  at?: string;
  sinceSeq?: number;
};

export type LanMessage =
  | LanHelloMessage
  | LanWelcomeMessage
  | LanCustomContentMessage
  | LanCharacterMessage
  | LanCommandMessage
  | LanOfficialEventMessage
  | LanSessionSnapshotMessage
  | LanNoticeMessage;

export type ParsedSessionCode = {
  sessionId: string;
  hostIp: string;
  port: number;
};

