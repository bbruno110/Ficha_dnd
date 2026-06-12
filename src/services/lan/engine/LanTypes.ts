import type { DiceFormulaRoll } from '../../combat/diceFormulaService';
import type { InventoryItemState, InventoryState } from './LanInventoryRules';
import type { LanAdvanceUnit, LanDomainActiveEffect } from './LanEffectRules';

export type LanAggregateType =
  | 'session'
  | 'player'
  | 'inventory'
  | 'effect'
  | 'pending_save'
  | 'trade'
  | 'transaction';

export type LanAggregateVersions = {
  session: number;
  players: Record<string, number>;
  inventories: Record<string, number>;
  effects: Record<string, number>;
  pendingSaves: Record<string, number>;
  trades: Record<string, number>;
};

export type LanCoinState = {
  gp: number;
  sp: number;
  cp: number;
};

export type LanPendingSaveProjection = {
  id: string;
  sessionId: string;
  targetKey: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  effectPayload?: Record<string, unknown>;
  ability: string;
  dc?: number | null;
  rollMode?: string | null;
  status: 'pending' | 'success' | 'failure' | 'ignored' | 'resolved';
  result?: Record<string, unknown>;
  createdAt?: string;
  resolvedAt?: string | null;
};

export type LanTradeProjection = {
  id: string;
  sessionId: string;
  type: 'send_item' | 'donate_item' | 'trade_item' | 'reward';
  status: 'committed' | 'pending' | 'declined' | 'failed';
  fromKey?: string;
  toKey?: string;
  actorKey?: string;
  itemName?: string;
  qty?: number;
  message?: string;
  createdAt?: string;
};

export type CharacterProjection = {
  playerKey: string;
  characterId?: number;
  name: string;
  level?: number;
  className?: string;
  race?: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  xp: number;
  coins: LanCoinState;
  baseStats: Record<string, number>;
  effectiveStats: Record<string, number>;
  inventory: InventoryState;
  equipment: InventoryState;
  activeEffects: LanDomainActiveEffect[];
  derived: Record<string, unknown>;
};

export type SessionProjection = {
  sessionId: string;
  status: 'active' | 'paused' | 'ended';
  currentTurn: number;
  elapsedMinutes: number;
  players: Record<string, CharacterProjection>;
  pendingSaves: Record<string, LanPendingSaveProjection>;
  trades: Record<string, LanTradeProjection>;
  versions: LanAggregateVersions;
  tombstones: {
    removedEffectIds: Record<string, Set<string>>;
    removedItemInstanceIds: Record<string, Set<string>>;
    endedSessionIds: Set<string>;
  };
  appliedEventIds: Set<string>;
  appliedCommandIds: Set<string>;
  serverSeq: number;
};

export type LanAuthoritativeEvent<TPayload = unknown> = {
  eventId: string;
  commandId?: string;
  sessionId: string;
  type: string;
  aggregateType: LanAggregateType;
  aggregateId: string;
  aggregateRevision: number;
  serverSeq: number;
  createdAt: string;
  payload: TPayload;
};

export type LanSnapshot = {
  sessionId: string;
  serverSeq: number;
  structural?: boolean;
  projection?: SessionProjection;
  state?: {
    status?: 'active' | 'paused' | 'ended';
    currentTurn?: number;
    elapsedMinutes?: number;
    players?: Array<Record<string, any>>;
  };
  versions?: Partial<LanAggregateVersions>;
  tombstones?: {
    removedEffectIds?: Record<string, string[]>;
    removedItemInstanceIds?: Record<string, string[]>;
    endedSessionIds?: string[];
  };
};

export type PlayerPatch = Partial<{
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  xp: number;
  gp: number;
  sp: number;
  cp: number;
}>;

export type InventoryPatch = {
  targetKey: string;
  equipment: InventoryState;
  stats?: Record<string, any>;
  itemDelta?: {
    mode: 'add' | 'remove' | 'set' | string;
    item?: InventoryItemState;
    qty?: number;
    stackKey?: string;
    removed?: boolean;
  };
};

export type EffectPatch = {
  targetKey: string;
  add?: LanDomainActiveEffect[];
  update?: LanDomainActiveEffect[];
  remove?: string[];
};

export type DiceRollRecord = DiceFormulaRoll & {
  rollId: string;
  rolledAt: string;
};

export type CharacterTransactionEvent = {
  type: 'character_transaction' | 'party_transaction' | 'spell_transaction' | 'reward_transaction';
  eventId: string;
  commandId: string;
  sessionId: string;
  targetKey: string;
  serverSeq: number;
  changes: {
    player?: PlayerPatch;
    inventory?: InventoryPatch;
    effects?: EffectPatch;
    pendingSave?: { action: 'create' | 'resolve'; save?: LanPendingSaveProjection; id?: string; result?: Record<string, unknown> };
    trade?: LanTradeProjection;
  };
  changesByTarget?: Record<string, {
    player?: PlayerPatch;
    inventory?: InventoryPatch;
    effects?: EffectPatch;
  }>;
  pendingSave?: { action: 'create' | 'resolve'; save?: LanPendingSaveProjection; id?: string; result?: Record<string, unknown> };
  trade?: LanTradeProjection;
  rolls?: DiceRollRecord[];
  message: string;
};

export type LanCommand =
  | {
      type: 'apply_damage';
      commandId: string;
      sessionId: string;
      actorKey: string;
      targetKey: string;
      amount: number;
    }
  | {
      type: 'apply_heal';
      commandId: string;
      sessionId: string;
      actorKey: string;
      targetKey: string;
      amount: number;
    }
  | {
      type: 'apply_temp_hp';
      commandId: string;
      sessionId: string;
      actorKey: string;
      targetKey: string;
      amount: number;
      duration?: {
        value: number;
        unit: LanAdvanceUnit | 'round' | 'minute' | 'hour' | 'day' | 'rest' | 'short_rest' | 'long_rest' | 'manual';
      };
    }
  | {
      type: 'apply_effect';
      commandId: string;
      sessionId: string;
      actorKey: string;
      targetKey: string;
      effect: Record<string, any>;
    }
  | {
      type: 'remove_effect';
      commandId: string;
      sessionId: string;
      actorKey: string;
      targetKey: string;
      effectId: string;
    }
  | {
      type: 'advance_turn';
      commandId: string;
      sessionId: string;
      actorKey: string;
      unit: LanAdvanceUnit;
    }
  | {
      type: 'pause_session' | 'resume_session' | 'end_session';
      commandId: string;
      sessionId: string;
      actorKey: string;
    }
  | ConsumeItemCommand
  | EquipItemCommand
  | UnequipItemCommand
  | XpCommand
  | CoinCommand
  | RewardCommand
  | ItemTransferCommand
  | UseSpellCommand
  | PendingSaveCommand
  | SelfEffectCommand;

export type ConsumeItemCommand = {
  type: 'consume_item';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  itemInstanceId: string;
  qty: number;
};



export type XpCommand = {
  type: 'grant_xp' | 'set_xp';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  amount?: number;
  xp?: number;
  reason?: string;
};

export type CoinCommand = {
  type: 'add_coins' | 'set_coins';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  coins?: Partial<LanCoinState>;
  gp?: number;
  sp?: number;
  cp?: number;
  reason?: string;
};

export type RewardCommand = {
  type: 'request_reward' | 'grant_reward';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  requestId?: string;
  xp?: number;
  coins?: Partial<LanCoinState>;
  items?: InventoryItemState[];
  message?: string;
};

export type ItemTransferCommand = {
  type: 'send_item' | 'donate_item' | 'trade_item';
  commandId: string;
  sessionId: string;
  actorKey: string;
  fromKey: string;
  toKey: string;
  itemInstanceId?: string;
  requestedItemInstanceId?: string;
  qty?: number;
  requestedQty?: number;
  tradeId?: string;
  message?: string;
};

export type UseSpellCommand = {
  type: 'use_spell';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  spellId?: string;
  spellName?: string;
  mode?: 'heal' | 'damage' | 'effect' | 'condition';
  amount?: number;
  formula?: string;
  effects?: Record<string, any>[];
  save?: {
    enabled?: boolean;
    id?: string;
    ability?: string;
    dc?: number | null;
    pendingEffectPayload?: Record<string, unknown>;
  };
  slotLevel?: number;
  resourcePatch?: PlayerPatch;
};

export type PendingSaveCommand = {
  type: 'apply_pending_save' | 'resolve_pending_save';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  saveId?: string;
  ability?: string;
  dc?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  effectPayload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  passed?: boolean;
  removeEffectIds?: string[];
  applyEffectOnFailure?: Record<string, any>;
};

export type SelfEffectCommand = {
  type: 'apply_self_effect';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  effect: Record<string, any>;
};

export type EquipItemCommand = {
  type: 'equip_item';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  slot: string;
  itemInstanceId?: string;
};

export type UnequipItemCommand = {
  type: 'unequip_item';
  commandId: string;
  sessionId: string;
  actorKey: string;
  targetKey: string;
  slot: string;
};

export type LanEngineResult = {
  projection: SessionProjection;
  event?: LanAuthoritativeEvent;
  applied: boolean;
  reason?: string;
};

export function emptyVersions(): LanAggregateVersions {
  return {
    session: 0,
    players: {},
    inventories: {},
    effects: {},
    pendingSaves: {},
    trades: {},
  };
}
