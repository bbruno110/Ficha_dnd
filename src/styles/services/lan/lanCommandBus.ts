import type { SQLiteDatabase } from 'expo-sqlite';

import { debugLanFlow } from '../lanRuntimeMode';
import type { LanSessionEvent } from '../lanSession';
import {
  enqueueLanEntityMutation,
  getLanEventQueueKeys,
  getLanInventoryParticipantKeys,
  getLanInventoryQueueKey,
  getLanPlayerQueueKey,
  getLanRequestQueueKey,
  getLanSessionQueueKey,
  uniqueSortedLanQueueKeys,
} from './lanEntityQueue';

export type LanCommandType =
  | 'PLAYER_NUMBER_DELTA'
  | 'PLAYER_NUMBER_SET'
  | 'INVENTORY_SEND_ITEM'
  | 'TRADE_PROPOSE'
  | 'TRADE_COUNTER'
  | 'TRADE_ACCEPT'
  | 'TRADE_DECLINE'
  | 'RESOURCE_REQUEST'
  | 'ITEM_EQUIP'
  | 'ITEM_CONSUME'
  | 'SESSION_ADVANCE_TURN'
  | 'SESSION_PATCH'
  | 'EFFECT_PATCH'
  | 'UNKNOWN';

export type LanCommand = {
  id: string;
  sessionId: string;
  type: LanCommandType;
  sourceEventId?: string;
  sourceClientMsgId?: string;
  fromKey?: string;
  toKey?: string;
  aggregateKeys: string[];
  createdAt: string;
  payload: LanSessionEvent;
};

export type LanCommandExecutionResult<T> = {
  status: 'accepted' | 'rejected' | 'duplicate';
  result?: T;
  reason?: string;
};

/**
 * Host Command Bus persistente.
 *
 * Regra central da v31:
 * - jogador envia COMMAND/request;
 * - host grava command_log de forma idempotente;
 * - host valida e aplica em filas por agregado;
 * - host emite somente EVENTOS oficiais depois do commit.
 *
 * Isso evita que reconexão, ACK duplicado, clique rápido ou replay de socket
 * executem envio/troca/HP/efeito duas vezes.
 */
export async function ensureLanCommandBusSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lan_command_log (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source_event_id TEXT,
      source_client_msg_id TEXT,
      from_key TEXT,
      to_key TEXT,
      aggregate_keys_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      reason TEXT,
      result_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_lan_command_session_created ON lan_command_log(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lan_command_session_source_event ON lan_command_log(session_id, source_event_id);
    CREATE INDEX IF NOT EXISTS idx_lan_command_session_client_msg ON lan_command_log(session_id, source_client_msg_id);
    CREATE INDEX IF NOT EXISTS idx_lan_command_status ON lan_command_log(session_id, status);
  `);
}

export function lanCommandFromEvent(event: LanSessionEvent): LanCommand {
  const type = resolveCommandType(event);
  const id = resolveCommandId(event, type);
  return {
    id,
    sessionId: event.sessionId,
    type,
    sourceEventId: event.id,
    sourceClientMsgId: event.clientMsgId,
    fromKey: event.fromKey,
    toKey: event.toKey,
    aggregateKeys: resolveCommandAggregateKeys(event, type),
    createdAt: new Date().toISOString(),
    payload: event,
  };
}

export function isLanHostCommandEvent(event: LanSessionEvent) {
  return [
    'send_item_request',
    'trade_offer',
    'trade_counter',
    'trade_accept',
    'trade_decline',
    'resource_request',
    'item_use_request',
    'ability_use_request',
    'spell_cast_request',
    'skill_cast_request',
    'coin_self_patch_request',
  ].includes(event.type);
}

export async function executeLanHostCommandOnce<T>(
  db: SQLiteDatabase,
  event: LanSessionEvent,
  executor: (command: LanCommand) => Promise<T>,
): Promise<LanCommandExecutionResult<T>> {
  await ensureLanCommandBusSchema(db);
  const command = lanCommandFromEvent(event);

  const previous = await db.getFirstAsync<{ status?: string; result_json?: string; reason?: string }>(
    `SELECT status, result_json, reason FROM lan_command_log WHERE id = ? LIMIT 1`,
    [command.id]
  );
  if (previous) {
    debugLanFlow('LAN_COMMAND_DUPLICATE_IGNORED', {
      commandId: command.id,
      commandType: command.type,
      status: previous.status,
      sourceEventId: command.sourceEventId,
      clientMsgId: command.sourceClientMsgId,
    });
    return {
      status: 'duplicate',
      result: parseJson(previous.result_json) as T | undefined,
      reason: previous.reason,
    };
  }

  await db.runAsync(
    `INSERT INTO lan_command_log (
       id, session_id, type, source_event_id, source_client_msg_id, from_key, to_key,
       aggregate_keys_json, payload_json, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
    [
      command.id,
      command.sessionId,
      command.type,
      command.sourceEventId || null,
      command.sourceClientMsgId || null,
      command.fromKey || null,
      command.toKey || null,
      JSON.stringify(command.aggregateKeys),
      JSON.stringify(command.payload),
      command.createdAt,
    ]
  );

  return enqueueLanEntityMutation(command.aggregateKeys, async () => {
    debugLanFlow('LAN_COMMAND_EXECUTE_START', {
      commandId: command.id,
      commandType: command.type,
      keys: command.aggregateKeys,
      sourceEventId: command.sourceEventId,
    });
    try {
      const result = await executor(command);
      await db.runAsync(
        `UPDATE lan_command_log
         SET status = 'accepted', result_json = ?, processed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [JSON.stringify(result ?? null), command.id]
      );
      debugLanFlow('LAN_COMMAND_EXECUTE_DONE', {
        commandId: command.id,
        commandType: command.type,
        status: 'accepted',
      });
      return { status: 'accepted', result } satisfies LanCommandExecutionResult<T>;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'Erro desconhecido.');
      await db.runAsync(
        `UPDATE lan_command_log
         SET status = 'rejected', reason = ?, processed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reason, command.id]
      );
      debugLanFlow('LAN_COMMAND_EXECUTE_REJECTED', {
        commandId: command.id,
        commandType: command.type,
        reason,
      });
      return { status: 'rejected', reason } satisfies LanCommandExecutionResult<T>;
    }
  }, {
    source: 'lanCommandBus',
    commandId: command.id,
    commandType: command.type,
    sessionId: command.sessionId,
  });
}

function resolveCommandType(event: LanSessionEvent): LanCommandType {
  if (event.type === 'send_item_request' || event.type === 'send_item') return 'INVENTORY_SEND_ITEM';
  if (event.type === 'trade_offer') return 'TRADE_PROPOSE';
  if (event.type === 'trade_counter') return 'TRADE_COUNTER';
  if (event.type === 'trade_accept') return 'TRADE_ACCEPT';
  if (event.type === 'trade_decline') return 'TRADE_DECLINE';
  if (event.type === 'resource_request') return 'RESOURCE_REQUEST';
  if (event.type === 'item_use_request') return 'ITEM_CONSUME';
  if (event.type === 'ability_use_request' || event.type === 'spell_cast_request' || event.type === 'skill_cast_request') return 'PLAYER_NUMBER_DELTA';
  if (event.type === 'coin_self_patch_request') return 'PLAYER_NUMBER_SET';
  if (event.type === 'session_patch') return event.sessionPatch?.currentTurn != null ? 'SESSION_ADVANCE_TURN' : 'SESSION_PATCH';
  if (event.type === 'effect_patch') return 'EFFECT_PATCH';
  if (event.type === 'player_patch') return 'PLAYER_NUMBER_SET';
  return 'UNKNOWN';
}

function resolveCommandId(event: LanSessionEvent, type: LanCommandType) {
  const requestId =
    event.sendItemRequest?.requestId ||
    event.tradeId ||
    event.tradeAccept?.tradeId ||
    event.resourceRequest?.clientRequestId ||
    event.actionRequest?.actionId ||
    event.clientMsgId ||
    event.id;
  return `${event.sessionId}:${type}:${requestId}`;
}

function resolveCommandAggregateKeys(event: LanSessionEvent, type: LanCommandType) {
  if (type === 'INVENTORY_SEND_ITEM' || type === 'TRADE_ACCEPT' || type === 'TRADE_DECLINE' || type === 'TRADE_PROPOSE' || type === 'TRADE_COUNTER') {
    const participants = getLanInventoryParticipantKeys(event);
    const inventoryKeys = participants.map((key) => getLanInventoryQueueKey(event.sessionId, key));
    const requestKey = getLanRequestQueueKey(event.sessionId, event.tradeId || event.sendItemRequest?.requestId || event.clientMsgId || event.id);
    return uniqueSortedLanQueueKeys([...inventoryKeys, requestKey]);
  }

  if (type === 'SESSION_ADVANCE_TURN' || type === 'SESSION_PATCH') {
    return [getLanSessionQueueKey(event.sessionId)];
  }

  if (type === 'ITEM_CONSUME' || type === 'ITEM_EQUIP') {
    const targetKey = event.actionRequest?.targetKey || event.fromKey || event.toKey;
    return uniqueSortedLanQueueKeys([
      getLanPlayerQueueKey(event.sessionId, targetKey),
      getLanInventoryQueueKey(event.sessionId, targetKey),
    ]);
  }

  if (type === 'RESOURCE_REQUEST' || type === 'PLAYER_NUMBER_DELTA' || type === 'PLAYER_NUMBER_SET' || type === 'EFFECT_PATCH') {
    const keys = getLanEventQueueKeys(event);
    return keys.length > 0 ? keys : [getLanPlayerQueueKey(event.sessionId, event.toKey || event.fromKey)];
  }

  return getLanEventQueueKeys(event);
}

function parseJson<T = unknown>(value: unknown): T | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
