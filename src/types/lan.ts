export const LAN_DEFAULT_PORT = 45555;

export type LanRole = 'master' | 'player';
export type LanSessionStatus = 'open' | 'connected' | 'closed';

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
  last_connected_at?: string | null;
};

export type LanCustomContentType =
  | 'Item'
  | 'Raca'
  | 'Classe'
  | 'Subclasse'
  | 'Magia/Skill'
  | 'Kit'
  | 'Progressao Magica';

export type LanContentTable =
  | 'items'
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

export type LanNoticeMessage = {
  type: 'NOTICE' | 'ERROR' | 'PING';
  sessionId?: string;
  message?: string;
  at?: string;
};

export type LanMessage =
  | LanHelloMessage
  | LanWelcomeMessage
  | LanCustomContentMessage
  | LanCharacterMessage
  | LanNoticeMessage;

export type ParsedSessionCode = {
  sessionId: string;
  hostIp: string;
  port: number;
};

