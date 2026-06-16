import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LanTransport } from '../network/lanTransport';
import { buildSessionCode, makeSessionId, parseSessionCode } from '../network/lanProtocol';
import { addFunctionTraceLog } from '../network/traceRepository';
import {
  closeOpenLanSessions,
  appendLanOfficialEvent,
  getLanEventsSince,
  getLanHistoryPage,
  getLanSessionState,
  getActiveLanSession,
  getCharacterSnapshot,
  getLanPlayers,
  getLocalPlayerName,
  getOrCreateDeviceId,
  getSelectedCustomContentPayloads,
  linkCharacterToSession,
  saveLanOfficialEvent,
  saveCharacterSnapshot,
  saveLanSession,
  selectedContentFromSession,
  setLanSessionStatus,
  updateLanSessionState,
  updateLocalPlayerName,
  upsertCustomContentPayloads,
  upsertLanPlayer,
} from '../network/lanRepository';
import {
  LAN_DEFAULT_PORT,
  LanCharacterMessage,
  LanCommandKind,
  LanCommandMessage,
  LanCustomContentMessage,
  LanHelloMessage,
  LanMessage,
  LanOfficialEventMessage,
  LanSessionConfig,
  LanSessionRecord,
  LanSessionSnapshotMessage,
  LanWelcomeMessage,
} from '../types/lan';

type StartMasterOptions = {
  sessionName: string;
  syncCustomContent: boolean;
  selectedContent: string[];
  allowExistingCharacter: boolean;
  linkedCharacterId?: number | null;
};

type JoinSessionOptions = {
  code: string;
  playerName: string;
  linkedCharacterId?: number | null;
};

type LanPlayerSummary = {
  device_id: string;
  player_name: string;
  character_id?: number | null;
  character_name?: string | null;
  connected: number;
  last_seen_at: string;
  snapshot_payload?: string | null;
  snapshot_updated_at?: string | null;
};

type LanSessionContextValue = {
  activeSession: LanSessionRecord | null;
  isTransportReady: boolean;
  peerCount: number;
  lastError: string | null;
  lastNotice: string | null;
  lanRevision: number;
  players: LanPlayerSummary[];
  refreshActiveSession: () => Promise<void>;
  startMasterSession: (options: StartMasterOptions) => Promise<LanSessionRecord>;
  joinPlayerSession: (options: JoinSessionOptions) => Promise<LanSessionRecord>;
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

const LanSessionContext = createContext<LanSessionContextValue | null>(null);

function makeSessionConfig(session: LanSessionRecord): LanSessionConfig {
  return {
    sessionId: session.id,
    sessionName: session.name,
    allowExistingCharacter: Boolean(session.allow_existing_character),
    syncCustomContent: Boolean(session.sync_custom_content),
    selectedContent: selectedContentFromSession(session),
  };
}

function makeCommandId() {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function numberFromPayload(payload: Record<string, unknown> | undefined, key: string, fallback = 0) {
  const value = Number(payload?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function parseJsonValue<T = any>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeEquipment(value: unknown) {
  const parsed = parseJsonValue<any>(value, {});
  if (Array.isArray(parsed)) return { bag: parsed, slots: {} };
  return {
    bag: Array.isArray(parsed?.bag) ? parsed.bag : [],
    slots: parsed?.slots || {},
  };
}

function addItemToEquipment(equipmentValue: unknown, item: Record<string, unknown>, quantity: number) {
  const equipment = normalizeEquipment(equipmentValue);
  const itemName = String(item.name || item.itemName || 'Item');
  const qty = Math.max(1, quantity);
  const bag = [...equipment.bag];
  const existingIndex = bag.findIndex((entry: any) => String(entry.name || entry.itemName) === itemName);
  if (existingIndex >= 0) {
    bag[existingIndex] = { ...bag[existingIndex], qty: Number(bag[existingIndex].qty || 1) + qty };
  } else {
    bag.push({ ...item, name: itemName, qty });
  }
  return { ...equipment, bag };
}

export function LanSessionProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [activeSession, setActiveSession] = useState<LanSessionRecord | null>(null);
  const [isTransportReady, setIsTransportReady] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [lanRevision, setLanRevision] = useState(0);
  const [players, setPlayers] = useState<LanPlayerSummary[]>([]);

  const transportRef = useRef<LanTransport | null>(null);
  const activeSessionRef = useRef<LanSessionRecord | null>(null);
  const deviceIdRef = useRef<string>('');
  const customContentCacheRef = useRef<LanCustomContentMessage['records']>([]);

  const traceLan = useCallback(
    async (
      action: string,
      functionName: string,
      step: string,
      message: string,
      metadata?: Record<string, unknown>,
      level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
      requestId?: string | null
    ) => {
      try {
        const session = activeSessionRef.current;
        await addFunctionTraceLog(db, {
          level,
          category: 'lan',
          action,
          functionName,
          sourceFile: 'src/contexts/LanSessionContext.tsx',
          step,
          requestId: requestId || null,
          durationMs: typeof metadata?.durationMs === 'number' ? metadata.durationMs : null,
          entityTable: 'lan_sessions',
          entityId: session?.id || null,
          message,
          metadata: {
            role: session?.role || null,
            sessionStatus: session?.status || null,
            deviceId: deviceIdRef.current || null,
            ...metadata,
          },
        });
      } catch {
        // Tracer nunca deve bloquear a sessão LAN.
      }
    },
    [db]
  );

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const refreshPlayers = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) {
      setPlayers([]);
      return;
    }

    const rows = await getLanPlayers(db, session.id);
    setPlayers(rows);
  }, [db]);

  const refreshActiveSession = useCallback(async () => {
    const session = await getActiveLanSession(db);
    setActiveSession(session || null);
    activeSessionRef.current = session || null;
    if (session) await refreshPlayers();
  }, [db, refreshPlayers]);

  const applyOfficialEventLocally = useCallback(
    async (event: LanOfficialEventMessage) => {
      const session = activeSessionRef.current;
      if (!session) return;

      if (
        event.targetCharacterId &&
        session.role === 'player' &&
        session.linked_character_id &&
        event.targetCharacterId !== session.linked_character_id
      ) {
        return;
      }

      if (event.eventType === 'SESSION_PAUSED') {
        await setLanSessionStatus(db, event.sessionId, 'paused');
        await updateLanSessionState(db, event.sessionId, { status: 'paused', paused: true });
        setActiveSession(prev => (prev ? { ...prev, status: 'paused' } : prev));
      }

      if (event.eventType === 'SESSION_RESUMED') {
        await setLanSessionStatus(db, event.sessionId, session.role === 'master' ? 'open' : 'connected');
        await updateLanSessionState(db, event.sessionId, { status: session.role === 'master' ? 'open' : 'connected', paused: false });
        setActiveSession(prev => (prev ? { ...prev, status: session.role === 'master' ? 'open' : 'connected' } : prev));
      }

      if (event.eventType === 'SESSION_CLOSED') {
        await setLanSessionStatus(db, event.sessionId, 'closed');
        transportRef.current?.close();
        transportRef.current = null;
        setIsTransportReady(false);
        setPeerCount(0);
        setPlayers([]);
        setActiveSession(null);
        activeSessionRef.current = null;
      }

      if (!event.targetCharacterId) return;

      let didMutateCharacter = false;

      const patchRemoteSnapshot = async (patch: Record<string, unknown>) => {
        if (!event.targetDeviceId || !event.targetCharacterId) return;
        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [event.sessionId, event.targetDeviceId, String(event.targetCharacterId)]
        );
        if (!snapshotRow?.payload) return;

        try {
          const snapshot = JSON.parse(snapshotRow.payload);
          const nextSnapshot = {
            ...snapshot,
            data: { ...(snapshot?.data || {}), ...patch },
            updatedAt: new Date().toISOString(),
          };
          await db.runAsync(
            `UPDATE lan_character_snapshots
             SET payload = ?, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?`,
            [JSON.stringify(nextSnapshot), event.sessionId, event.targetDeviceId, String(event.targetCharacterId)]
          );
        } catch {
          // Snapshot corrompido nao deve bloquear a aplicacao do evento oficial.
        }
      };
      const shouldUpdateLocalCharacter = !event.targetDeviceId || event.targetDeviceId === deviceIdRef.current;

      if (event.eventType === 'HP_CHANGED') {
        const currentValue = event.currentValue as { hp_current?: number } | undefined;
        if (typeof currentValue?.hp_current === 'number') {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET hp_current = ? WHERE id = ?`, [currentValue.hp_current, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ hp_current: currentValue.hp_current });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'TEMP_HP_CHANGED') {
        const currentValue = event.currentValue as { hp_temp?: number } | undefined;
        if (typeof currentValue?.hp_temp === 'number') {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET hp_temp = ? WHERE id = ?`, [currentValue.hp_temp, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ hp_temp: currentValue.hp_temp });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'XP_CHANGED') {
        const currentValue = event.currentValue as { xp?: number } | undefined;
        if (typeof currentValue?.xp === 'number') {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET xp = ? WHERE id = ?`, [currentValue.xp, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ xp: currentValue.xp });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'COINS_CHANGED') {
        const currentValue = event.currentValue as { gp?: number; sp?: number; cp?: number } | undefined;
        if (currentValue) {
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET gp = ?, sp = ?, cp = ? WHERE id = ?`, [
              Number(currentValue.gp || 0),
              Number(currentValue.sp || 0),
              Number(currentValue.cp || 0),
              event.targetCharacterId,
            ]);
          }
          await patchRemoteSnapshot({
            gp: Number(currentValue.gp || 0),
            sp: Number(currentValue.sp || 0),
            cp: Number(currentValue.cp || 0),
          });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'ATTRIBUTE_CHANGED') {
        const currentValue = event.currentValue as { stats?: Record<string, unknown> } | undefined;
        if (currentValue?.stats) {
          const statsText = JSON.stringify(currentValue.stats);
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET stats = ? WHERE id = ?`, [statsText, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ stats: statsText });
          didMutateCharacter = true;
        }
      }

      if (event.eventType === 'ITEM_ADDED') {
        const currentValue = event.currentValue as { equipment?: Record<string, unknown> } | undefined;
        if (currentValue?.equipment) {
          const equipmentText = JSON.stringify(currentValue.equipment);
          if (shouldUpdateLocalCharacter) {
            await db.runAsync(`UPDATE characters SET equipment = ? WHERE id = ?`, [equipmentText, event.targetCharacterId]);
          }
          await patchRemoteSnapshot({ equipment: equipmentText });
          didMutateCharacter = true;
        }
      }

      if (didMutateCharacter) {
        await refreshPlayers();
        setLanRevision(prev => prev + 1);
      }
    },
    [db, refreshPlayers]
  );

  const emitOfficialEvent = useCallback(
    async (eventInput: Parameters<typeof appendLanOfficialEvent>[1]) => {
      const startedAt = Date.now();
      await traceLan('LAN_EVENT', 'emitOfficialEvent', 'start', `Gerando evento oficial ${eventInput.eventType}.`, {
        used: ['appendLanOfficialEvent', 'applyOfficialEventLocally', 'transport.broadcast'],
        eventInput,
      }, 'debug', eventInput.commandId || null);
      const event = await appendLanOfficialEvent(db, eventInput);
      if (event.eventType === 'SESSION_CLOSED') {
        transportRef.current?.broadcast(event);
        await applyOfficialEventLocally(event);
      } else {
        await applyOfficialEventLocally(event);
        transportRef.current?.broadcast(event);
      }
      setLastNotice(event.description);
      await traceLan('LAN_EVENT', 'emitOfficialEvent', 'success', `Evento oficial ${event.eventType} emitido.`, {
        durationMs: Date.now() - startedAt,
        eventId: event.eventId,
        seq: event.seq,
        targetCharacterId: event.targetCharacterId,
        targetDeviceId: event.targetDeviceId,
        description: event.description,
      }, 'info', event.commandId || null);
      return event;
    },
    [applyOfficialEventLocally, db, traceLan]
  );

  const rejectCommand = useCallback(
    async (sessionId: string, command: LanCommandMessage, reason: string, peerId?: string) => {
      await traceLan('LAN_COMMAND', 'rejectCommand', 'reject', reason, {
        used: ['appendLanOfficialEvent', 'transport.sendToPeer'],
        command: command.command,
        commandId: command.commandId,
        peerId,
        payload: command.payload,
      }, 'warn', command.commandId);
      const event = await appendLanOfficialEvent(db, {
        sessionId,
        eventType: 'COMMAND_REJECTED',
        commandId: command.commandId,
        actorDeviceId: command.deviceId,
        actorName: command.actorName || 'Jogador',
        description: reason,
        payload: { command: command.command, reason },
      });
      if (peerId) transportRef.current?.sendToPeer(peerId, event);
      setLastError(reason);
    },
    [db, traceLan]
  );

  const handleAuthoritativeCommand = useCallback(
    async (command: LanCommandMessage, peerId?: string) => {
      await traceLan('LAN_COMMAND', 'handleAuthoritativeCommand', 'received', `Mestre recebeu comando ${command.command}.`, {
        used: ['getLanSessionState', 'emitOfficialEvent', 'rejectCommand'],
        command: command.command,
        commandId: command.commandId,
        peerId,
        actorName: command.actorName,
        characterId: command.characterId,
        payload: command.payload,
      }, 'debug', command.commandId);
      const session = activeSessionRef.current;
      if (!session || session.role !== 'master') return;

      if (command.sessionId !== session.id) {
        await rejectCommand(session.id, command, 'Comando recebido para outra sessao.', peerId);
        return;
      }

      const state = await getLanSessionState(db, session.id);
      const allowedWhilePaused = ['MASTER_RESUME_SESSION', 'MASTER_END_SESSION', 'REQUEST_RESYNC'];
      if (state.paused && !allowedWhilePaused.includes(command.command)) {
        await rejectCommand(session.id, command, 'Sessao pausada. Aguardando retomada do mestre.', peerId);
        return;
      }

      if (command.command === 'REQUEST_RESYNC') {
        const sinceSeq = Number(command.payload?.sinceSeq || 0);
        const events = await getLanEventsSince(db, session.id, sinceSeq);
        for (const event of events) transportRef.current?.sendToPeer(peerId || '', event);
        await traceLan('LAN_SEND', 'handleAuthoritativeCommand', 'resync_events_sent', `Resync enviado com ${events.length} evento(s).`, {
          used: ['getLanEventsSince', 'transport.sendToPeer'],
          sinceSeq,
          sentEvents: events.length,
          peerId,
        }, 'info', command.commandId);
        return;
      }

      const playerInventoryEvents: Partial<Record<LanCommandKind, LanOfficialEventMessage['eventType']>> = {
        PLAYER_INVENTORY_UPDATE: 'SNAPSHOT_SYNCED',
        PLAYER_ITEM_DONATE: 'ITEM_TRANSFERRED',
        PLAYER_ITEM_DROP: 'ITEM_REMOVED',
        PLAYER_ITEM_THROW: 'ITEM_REMOVED',
        PLAYER_ITEM_CONSUME: 'ITEM_CONSUMED',
        PLAYER_EQUIP_ITEM: 'ITEM_EQUIPPED',
        PLAYER_UNEQUIP_ITEM: 'ITEM_UNEQUIPPED',
      };
      const inventoryEventType = playerInventoryEvents[command.command];
      if (inventoryEventType) {
        const itemName = String(command.payload?.itemName || command.payload?.name || 'item');
        const quantity = Number(command.payload?.quantity || command.payload?.qty || 1);
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: inventoryEventType,
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Jogador',
          targetDeviceId: command.deviceId,
          targetCharacterId: command.characterId || null,
          targetName: String(command.payload?.characterName || command.actorName || 'Personagem'),
          previousValue: command.payload?.previousValue,
          currentValue: command.payload?.currentValue,
          description: `${command.actorName || 'Jogador'} registrou ${quantity}x ${itemName} no inventario.`,
          payload: { command: command.command, ...command.payload },
        });
        return;
      }

      if (command.command.startsWith('PLAYER_REQUEST_')) {
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'PLAYER_REQUESTED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Jogador',
          targetCharacterId: command.characterId || null,
          description: `${command.actorName || 'Jogador'} solicitou ${command.command.replace('PLAYER_REQUEST_', '').toLowerCase()}.`,
          payload: { command: command.command, ...command.payload },
        });
        return;
      }

      if (command.command === 'MASTER_PAUSE_SESSION') {
        await setLanSessionStatus(db, session.id, 'paused');
        await updateLanSessionState(db, session.id, { status: 'paused', paused: true });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'SESSION_PAUSED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre pausou a sessao "${session.name}".`,
        });
        setActiveSession(prev => (prev ? { ...prev, status: 'paused' } : prev));
        return;
      }

      if (command.command === 'MASTER_RESUME_SESSION') {
        await setLanSessionStatus(db, session.id, 'open');
        await updateLanSessionState(db, session.id, { status: 'open', paused: false });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'SESSION_RESUMED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre retomou a sessao "${session.name}".`,
        });
        setActiveSession(prev => (prev ? { ...prev, status: 'open' } : prev));
        return;
      }

      if (command.command === 'MASTER_END_SESSION') {
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'SESSION_CLOSED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          description: `Mestre encerrou a sessao "${session.name}". Personagens desvinculados da campanha.`,
        });
        await setLanSessionStatus(db, session.id, 'closed');
        transportRef.current?.close();
        transportRef.current = null;
        setIsTransportReady(false);
        setPeerCount(0);
        setPlayers([]);
        setActiveSession(null);
        activeSessionRef.current = null;
        return;
      }

      if (command.command === 'MASTER_ADVANCE_TURN') {
        const delta = numberFromPayload(command.payload, 'delta', 1);
        const previous = state.turn;
        const current = Math.max(1, previous + delta);
        await updateLanSessionState(db, session.id, { turn: current });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TURN_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          previousValue: previous,
          currentValue: current,
          description: `Turno alterado de ${previous} para ${current}.`,
        });
        return;
      }

      if (command.command === 'MASTER_ADVANCE_TIME') {
        const minutes = numberFromPayload(command.payload, 'minutes', 0);
        const previous = state.campaignMinutes;
        const current = Math.max(0, previous + minutes);
        await updateLanSessionState(db, session.id, { campaignMinutes: current });
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TIME_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          previousValue: previous,
          currentValue: current,
          description: `Tempo da campanha avancou ${minutes} minuto(s).`,
        });
        return;
      }

      const targetCharacterId = Number(command.payload?.targetCharacterId || command.characterId || 0);
      const targetDeviceId = String(command.payload?.targetDeviceId || '');
      if (!targetCharacterId) {
        await rejectCommand(session.id, command, 'Comando sem personagem alvo.', peerId);
        return;
      }

      let target = await db.getFirstAsync<any>(`SELECT id, name, stats, equipment, hp_current, hp_max, hp_temp, xp, gp, sp, cp FROM characters WHERE id = ?`, [
        targetCharacterId,
      ]);
      if (!target && targetDeviceId) {
        const snapshotRow = await db.getFirstAsync<{ payload: string }>(
          `SELECT payload FROM lan_character_snapshots
           WHERE session_id = ? AND owner_device_id = ? AND remote_character_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          [session.id, targetDeviceId, String(targetCharacterId)]
        );

        if (snapshotRow?.payload) {
          try {
            const snapshot = JSON.parse(snapshotRow.payload);
            target = {
              ...(snapshot?.data || {}),
              name: snapshot?.name || snapshot?.data?.name,
            };
          } catch {
            target = null;
          }
        }
      }
      const targetName = target?.name || String(command.payload?.targetName || 'Personagem');

      if (command.command === 'MASTER_APPLY_HP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const mode = String(command.payload?.mode || 'damage');
        const previous = { hp_current: Number(target?.hp_current || 0), hp_max: Number(target?.hp_max || 0) };
        const nextHp =
          mode === 'heal'
            ? Math.min(previous.hp_max, previous.hp_current + Math.abs(amount))
            : Math.max(0, previous.hp_current - Math.abs(amount));
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'HP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: { ...previous, hp_current: nextHp },
          description: `${command.actorName || 'Mestre'} ${mode === 'heal' ? 'curou' : 'aplicou dano de'} ${Math.abs(amount)} PV em ${targetName}.`,
          payload: { mode, amount: Math.abs(amount) },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_TEMP_HP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const mode = String(command.payload?.mode || 'add');
        const durationUnit = String(command.payload?.durationUnit || 'short_rest');
        const durationValue = numberFromPayload(command.payload, 'durationValue', 1);
        const previous = { hp_temp: Number(target?.hp_temp || 0) };
        const current = {
          hp_temp: mode === 'set' ? Math.max(0, amount) : Math.max(0, previous.hp_temp + amount),
        };
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'TEMP_HP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: current,
          description: `Mestre ajustou vida temporaria de ${targetName}: ${previous.hp_temp} -> ${current.hp_temp}.`,
          payload: { amount, mode, durationUnit, durationValue },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_ATTRIBUTE') {
        const stat = String(command.payload?.stat || '').toUpperCase();
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const durationMode = String(command.payload?.durationMode || 'temporary');
        const durationUnit = String(command.payload?.durationUnit || 'turn');
        const durationValue = numberFromPayload(command.payload, 'durationValue', 1);
        if (!['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].includes(stat)) {
          await rejectCommand(session.id, command, 'Atributo invalido para buff do mestre.', peerId);
          return;
        }

        const previousStats = parseJsonValue<Record<string, any>>(target?.stats, {});
        const nextStats = {
          ...previousStats,
          temp_mods: { ...(previousStats.temp_mods || {}) },
          timed_effects: Array.isArray(previousStats.timed_effects) ? [...previousStats.timed_effects] : [],
        };

        if (durationMode === 'permanent') {
          if (stat === 'CA') {
            nextStats.temp_mods.CA = Number(nextStats.temp_mods.CA || 0) + amount;
          } else {
            nextStats[stat] = String((Number(nextStats[stat] || 10) || 10) + amount);
            nextStats.extra_points = Number(nextStats.extra_points || 0) + amount;
          }
        } else {
          nextStats.temp_mods[stat] = Number(nextStats.temp_mods[stat] || 0) + amount;
          nextStats.timed_effects.push({
            id: command.commandId,
            source: 'master',
            stat,
            amount,
            durationUnit,
            durationValue,
            createdAt: new Date().toISOString(),
          });
        }

        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'ATTRIBUTE_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { stats: previousStats },
          currentValue: { stats: nextStats },
          description: `Mestre aplicou ${amount > 0 ? '+' : ''}${amount} em ${stat} para ${targetName}.`,
          payload: { stat, amount, durationMode, durationUnit, durationValue },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_XP') {
        const amount = numberFromPayload(command.payload, 'amount', 0);
        const previous = Number(target?.xp || 0);
        const current = Math.max(0, previous + amount);
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'XP_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { xp: previous },
          currentValue: { xp: current },
          description: `Mestre alterou XP de ${targetName}: ${previous} -> ${current}.`,
          payload: { amount },
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_COINS') {
        const previous = { gp: Number(target?.gp || 0), sp: Number(target?.sp || 0), cp: Number(target?.cp || 0) };
        const current = {
          gp: Math.max(0, previous.gp + numberFromPayload(command.payload, 'gp', 0)),
          sp: Math.max(0, previous.sp + numberFromPayload(command.payload, 'sp', 0)),
          cp: Math.max(0, previous.cp + numberFromPayload(command.payload, 'cp', 0)),
        };
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'COINS_CHANGED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: previous,
          currentValue: current,
          description: `Mestre alterou moedas de ${targetName}.`,
        });
        return;
      }

      if (command.command === 'MASTER_APPLY_ITEM') {
        const item = (command.payload?.item || {}) as Record<string, unknown>;
        const quantity = numberFromPayload(command.payload, 'quantity', 1);
        const itemName = String(item.name || command.payload?.itemName || 'Item');
        const previousEquipment = normalizeEquipment(target?.equipment);
        const currentEquipment = addItemToEquipment(previousEquipment, { ...item, name: itemName }, quantity);
        await emitOfficialEvent({
          sessionId: session.id,
          eventType: 'ITEM_ADDED',
          commandId: command.commandId,
          actorDeviceId: command.deviceId,
          actorName: command.actorName || 'Mestre',
          targetDeviceId: targetDeviceId || null,
          targetCharacterId,
          targetName,
          previousValue: { equipment: previousEquipment },
          currentValue: { equipment: currentEquipment },
          description: `Mestre enviou ${quantity}x ${itemName} para ${targetName}.`,
          payload: { item: { ...item, name: itemName }, quantity },
        });
      }
    },
    [db, emitOfficialEvent, rejectCommand, traceLan]
  );

  const handleIncomingMessage = useCallback(
    async (message: LanMessage, peerId: string) => {
      await traceLan('LAN_RECEIVE', 'handleIncomingMessage', 'received', `Mensagem LAN recebida: ${message.type}.`, {
        used: ['handleAuthoritativeCommand', 'saveLanOfficialEvent', 'applyOfficialEventLocally', 'saveCharacterSnapshot'],
        peerId,
        messageType: message.type,
        payload: message,
      }, message.type === 'ERROR' ? 'error' : 'debug', (message as any).commandId || (message as any).eventId || null);
      const session = activeSessionRef.current;
      const localDeviceId = deviceIdRef.current;

      if (message.type === 'ERROR') {
        setLastError(message.message || 'Erro LAN desconhecido.');
        return;
      }

      if (!session) return;

      if (message.type === 'HELLO') {
        if (session.role !== 'master') return;
        const hello = message as LanHelloMessage;

        if (hello.sessionId !== session.id) {
          transportRef.current?.sendToPeer(peerId, {
            type: 'ERROR',
            sessionId: hello.sessionId,
            message: 'Codigo de sessao invalido para este mestre.',
          });
          return;
        }

        const existingPlayer = await db.getFirstAsync<{
          character_id?: number | null;
          character_name?: string | null;
          player_name?: string | null;
        }>(
          `SELECT character_id, character_name, player_name
           FROM lan_session_players
           WHERE session_id = ? AND device_id = ?
           LIMIT 1`,
          [session.id, hello.deviceId]
        );
        const previousCharacterId = existingPlayer?.character_id ? Number(existingPlayer.character_id) : null;
        const nextCharacterId = hello.characterId ? Number(hello.characterId) : null;

        await upsertLanPlayer(
          db,
          session.id,
          hello.deviceId,
          hello.playerName,
          hello.characterId,
          hello.characterName,
          true
        );
        await refreshPlayers();

        const shouldEmitJoinEvent = !existingPlayer || previousCharacterId !== nextCharacterId;
        if (shouldEmitJoinEvent) {
          const description = !existingPlayer
            ? `${hello.playerName} entrou na sessao.`
            : nextCharacterId
              ? `${hello.playerName} vinculou a ficha ${hello.characterName || 'Personagem'}.`
              : `${hello.playerName} ficou sem ficha vinculada.`;

          await emitOfficialEvent({
            sessionId: session.id,
            eventType: 'PLAYER_JOINED',
            actorDeviceId: hello.deviceId,
            actorName: hello.playerName,
            targetDeviceId: hello.deviceId,
            targetCharacterId: nextCharacterId,
            targetName: hello.characterName || null,
            description,
          });
        }

        const welcome: LanWelcomeMessage = {
          type: 'WELCOME',
          sessionId: session.id,
          deviceId: localDeviceId,
          masterName: 'Mestre',
          config: makeSessionConfig(session),
        };
        transportRef.current?.sendToPeer(peerId, welcome);

        const snapshotState = await getLanSessionState(db, session.id);
        const snapshotRecentEvents = await getLanHistoryPage(db, session.id, 0, 20);
        const snapshot: LanSessionSnapshotMessage = {
          type: 'SESSION_SNAPSHOT',
          sessionId: session.id,
          seq: snapshotRecentEvents[0]?.seq || 0,
          state: snapshotState,
          players: await getLanPlayers(db, session.id),
          recentEvents: snapshotRecentEvents,
          at: new Date().toISOString(),
        };
        transportRef.current?.sendToPeer(peerId, snapshot);

        if (session.sync_custom_content && customContentCacheRef.current.length > 0) {
          transportRef.current?.sendToPeer(peerId, {
            type: 'CUSTOM_CONTENT',
            sessionId: session.id,
            records: customContentCacheRef.current,
          });
        }

        setLastNotice(`${hello.playerName} entrou na sessao.`);
        return;
      }

      if (message.type === 'WELCOME') {
        const welcome = message as LanWelcomeMessage;
        const nextSession: LanSessionRecord = {
          ...session,
          name: welcome.config.sessionName,
          status: 'connected',
          sync_custom_content: welcome.config.syncCustomContent ? 1 : 0,
          selected_content: JSON.stringify(welcome.config.selectedContent),
          allow_existing_character: welcome.config.allowExistingCharacter ? 1 : 0,
          last_connected_at: new Date().toISOString(),
        };

        setLastNotice(`Conectado em ${welcome.config.sessionName}.`);
        await saveLanSession(db, nextSession);
        setActiveSession(nextSession);
        activeSessionRef.current = nextSession;
        setLanRevision(prev => prev + 1);
        return;
      }

      if (message.type === 'LAN_COMMAND') {
        await handleAuthoritativeCommand(message as LanCommandMessage, peerId);
        return;
      }

      if (message.type === 'LAN_EVENT') {
        const officialEvent = message as LanOfficialEventMessage;
        await saveLanOfficialEvent(db, officialEvent);
        await applyOfficialEventLocally(officialEvent);
        await refreshPlayers();
        setLanRevision(prev => prev + 1);
        setLastNotice(officialEvent.description);
        return;
      }

      if (message.type === 'SESSION_SNAPSHOT') {
        const snapshot = message as LanSessionSnapshotMessage;
        await updateLanSessionState(db, snapshot.sessionId, {
          status: snapshot.state.status,
          turn: snapshot.state.turn,
          campaignMinutes: snapshot.state.campaignMinutes,
          paused: snapshot.state.paused,
        });
        for (const rawPlayer of snapshot.players || []) {
          const player = rawPlayer as any;
          if (player.device_id) {
            await upsertLanPlayer(
              db,
              snapshot.sessionId,
              String(player.device_id),
              String(player.player_name || 'Jogador'),
              player.character_id ? Number(player.character_id) : null,
              player.character_name || null,
              Boolean(player.connected)
            );
          }
        }
        for (const event of snapshot.recentEvents) {
          await saveLanOfficialEvent(db, event);
        }
        await refreshPlayers();
        setLanRevision(prev => prev + 1);
        setLastNotice('Snapshot da sessao LAN sincronizado.');
        return;
      }

      if (message.type === 'SNAPSHOT_REQUEST') {
        if (session.role !== 'master') return;
        const sinceSeq = message.sinceSeq || 0;
        const events = await getLanEventsSince(db, session.id, sinceSeq);
        if (events.length > 0) {
          for (const event of events) transportRef.current?.sendToPeer(peerId, event);
          return;
        }

        const snapshotState = await getLanSessionState(db, session.id);
        const snapshotRecentEvents = await getLanHistoryPage(db, session.id, 0, 20);
        const snapshot: LanSessionSnapshotMessage = {
          type: 'SESSION_SNAPSHOT',
          sessionId: session.id,
          seq: snapshotRecentEvents[0]?.seq || 0,
          state: snapshotState,
          players: await getLanPlayers(db, session.id),
          recentEvents: snapshotRecentEvents,
          at: new Date().toISOString(),
        };
        transportRef.current?.sendToPeer(peerId, snapshot);
        return;
      }

      if (message.type === 'CUSTOM_CONTENT') {
        const contentMessage = message as LanCustomContentMessage;
        if (contentMessage.records.length > 0) {
          await upsertCustomContentPayloads(db, contentMessage.records);
          setLastNotice(`${contentMessage.records.length} conteudos custom sincronizados.`);
        }
        return;
      }

      if (message.type === 'CHARACTER_UPSERT') {
        const characterMessage = message as LanCharacterMessage;
        if (characterMessage.deviceId === localDeviceId) return;

        await saveCharacterSnapshot(db, session.id, characterMessage.deviceId, characterMessage.snapshot);

        if (session.role === 'master') {
          await refreshPlayers();
          setLanRevision(prev => prev + 1);
          transportRef.current?.broadcast(characterMessage, peerId);
        }

        setLastNotice(`Ficha recebida: ${characterMessage.snapshot.name}.`);
      }
    },
    [applyOfficialEventLocally, db, emitOfficialEvent, handleAuthoritativeCommand, refreshPlayers, traceLan]
  );

  const buildTransport = useCallback(() => {
    transportRef.current?.close();
    const transport = new LanTransport({
      onMessage: handleIncomingMessage,
      onPeerChange: () => {
        setPeerCount(transportRef.current?.peerCount || 0);
        void traceLan('FUNCTION', 'buildTransport.onPeerChange', 'peer_count_changed', 'Quantidade de peers LAN alterada.', {
          peerCount: transportRef.current?.peerCount || 0,
        });
      },
      onStatus: status => {
        setIsTransportReady(true);
        setLastNotice(status);
        void traceLan('FUNCTION', 'buildTransport.onStatus', 'transport_status', status, {
          used: ['LanTransport'],
          status,
        }, 'info');
      },
      onError: message => {
        setLastError(message);
        void traceLan('FUNCTION', 'buildTransport.onError', 'transport_error', message, {
          used: ['LanTransport'],
          error: message,
        }, 'error');
      },
    });

    transportRef.current = transport;
    return transport;
  }, [handleIncomingMessage, traceLan]);

  const startMasterSession = useCallback(
    async (options: StartMasterOptions) => {
      const startedAt = Date.now();
      await traceLan('FUNCTION', 'startMasterSession', 'start', 'Iniciando sessao LAN como mestre.', {
        used: ['getOrCreateDeviceId', 'closeOpenLanSessions', 'Network.getIpAddressAsync', 'buildTransport', 'LanTransport.startServer', 'saveLanSession'],
        options: {
          sessionName: options.sessionName,
          syncCustomContent: options.syncCustomContent,
          selectedContentCount: options.selectedContent.length,
          allowExistingCharacter: options.allowExistingCharacter,
          linkedCharacterId: options.linkedCharacterId || null,
        },
      }, 'info');
      setLastError(null);
      const deviceId = await getOrCreateDeviceId(db);
      deviceIdRef.current = deviceId;
      await closeOpenLanSessions(db);

      const sessionId = makeSessionId();
      let hostIp = '0.0.0.0';
      try {
        hostIp = await Network.getIpAddressAsync();
      } catch {
        hostIp = '0.0.0.0';
      }

      const sessionCode = buildSessionCode(sessionId, hostIp, LAN_DEFAULT_PORT);
      const session: LanSessionRecord = {
        id: sessionId,
        name: options.sessionName.trim() || `Sessao ${sessionId}`,
        role: 'master',
        status: 'open',
        session_code: sessionCode,
        host_ip: hostIp,
        port: LAN_DEFAULT_PORT,
        sync_custom_content: options.syncCustomContent ? 1 : 0,
        selected_content: JSON.stringify(options.selectedContent),
        allow_existing_character: options.allowExistingCharacter ? 1 : 0,
        linked_character_id: options.linkedCharacterId || null,
        opened_at: new Date().toISOString(),
      };

      customContentCacheRef.current = options.syncCustomContent
        ? await getSelectedCustomContentPayloads(db, options.selectedContent)
        : [];

      const transport = buildTransport();
      await transport.startServer(LAN_DEFAULT_PORT);
      await saveLanSession(db, session);
      setActiveSession(session);
      activeSessionRef.current = session;
      setIsTransportReady(true);
      setPeerCount(0);
      setPlayers([]);
      setLastNotice('Sessao LAN aberta como mestre.');

      await traceLan('FUNCTION', 'startMasterSession', 'success', 'Sessao LAN aberta como mestre.', {
        durationMs: Date.now() - startedAt,
        sessionId,
        hostIp,
        port: LAN_DEFAULT_PORT,
        sessionCode,
      }, 'info');

      if (session.linked_character_id) {
        await Promise.resolve().then(() => broadcastCharacterRef.current?.(session.linked_character_id as number, 'master-start'));
      }

      return session;
    },
    [buildTransport, db, traceLan]
  );

  const joinPlayerSession = useCallback(
    async (options: JoinSessionOptions) => {
      const startedAt = Date.now();
      await traceLan('FUNCTION', 'joinPlayerSession', 'start', 'Jogador tentando entrar em sessao LAN.', {
        used: ['parseSessionCode', 'updateLocalPlayerName', 'getOrCreateDeviceId', 'closeOpenLanSessions', 'buildTransport', 'LanTransport.connect', 'saveLanSession'],
        hasCode: Boolean(options.code?.trim()),
        playerName: options.playerName,
        linkedCharacterId: options.linkedCharacterId || null,
      }, 'info');
      setLastError(null);
      const parsedCode = parseSessionCode(options.code);
      if (!parsedCode) {
        throw new Error('Codigo de sessao invalido.');
      }

      const playerName = options.playerName.trim() || 'Jogador';
      await updateLocalPlayerName(db, playerName);
      const deviceId = await getOrCreateDeviceId(db);
      deviceIdRef.current = deviceId;
      await closeOpenLanSessions(db);

      const session: LanSessionRecord = {
        id: parsedCode.sessionId,
        name: `Sessao ${parsedCode.sessionId}`,
        role: 'player',
        status: 'connected',
        session_code: options.code.trim(),
        host_ip: parsedCode.hostIp,
        port: parsedCode.port,
        sync_custom_content: 0,
        selected_content: '[]',
        allow_existing_character: 1,
        linked_character_id: options.linkedCharacterId || null,
        opened_at: new Date().toISOString(),
      };

      const transport = buildTransport();
      await transport.connect(parsedCode.hostIp, parsedCode.port);
      await saveLanSession(db, session);
      setActiveSession(session);
      activeSessionRef.current = session;
      setIsTransportReady(true);
      setPeerCount(1);

      let characterName: string | null = null;
      if (options.linkedCharacterId) {
        const snapshot = await getCharacterSnapshot(db, options.linkedCharacterId);
        characterName = snapshot?.name || null;
      }

      transport.sendToServer({
        type: 'HELLO',
        sessionId: parsedCode.sessionId,
        deviceId,
        playerName,
        characterId: options.linkedCharacterId || null,
        characterName,
      });

      setLastNotice('Entrando na sessao LAN.');
      await traceLan('LAN_SEND', 'joinPlayerSession', 'hello_sent', 'HELLO enviado ao mestre.', {
        durationMs: Date.now() - startedAt,
        used: ['transport.sendToServer'],
        sessionId: parsedCode.sessionId,
        hostIp: parsedCode.hostIp,
        port: parsedCode.port,
        characterId: options.linkedCharacterId || null,
        characterName,
      }, 'info');
      return session;
    },
    [buildTransport, db, traceLan]
  );

  const closeActiveSession = useCallback(async () => {
    const session = activeSessionRef.current;
    await traceLan('FUNCTION', 'closeActiveSession', 'start', 'Fechando sessao LAN localmente.', {
      used: ['transport.close', 'setLanSessionStatus'],
      sessionId: session?.id || null,
    }, 'info');
    transportRef.current?.close();
    transportRef.current = null;
    setIsTransportReady(false);
    setPeerCount(0);
    setPlayers([]);

    if (session) {
      await setLanSessionStatus(db, session.id, 'closed');
    }
    setActiveSession(null);
    activeSessionRef.current = null;
    setLastNotice('Sessao LAN encerrada.');
  }, [db, traceLan]);

  const linkCharacterToActiveSession = useCallback(
    async (characterId: number | null) => {
      const session = activeSessionRef.current;
      if (!session) return;

      await linkCharacterToSession(db, session.id, characterId);
      const nextSession = { ...session, linked_character_id: characterId };
      setActiveSession(nextSession);
      activeSessionRef.current = nextSession;

      if (session.role === 'player') {
        const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
        deviceIdRef.current = deviceId;

        let characterName: string | null = null;
        if (characterId) {
          const snapshot = await getCharacterSnapshot(db, characterId);
          characterName = snapshot?.name || null;
        }

        transportRef.current?.sendToServer({
          type: 'HELLO',
          sessionId: session.id,
          deviceId,
          playerName: await getLocalPlayerName(db),
          characterId,
          characterName,
        });

        if (characterId) {
          await Promise.resolve().then(() => broadcastCharacterRef.current?.(characterId, 'character-linked'));
        }
      }
      setLanRevision(prev => prev + 1);
    },
    [db]
  );

  const broadcastCharacter = useCallback(
    async (characterId: number, reason = 'change') => {
      const startedAt = Date.now();
      const session = activeSessionRef.current;
      const transport = transportRef.current;
      if (!session || !transport) return;

      if (session.role === 'player' && session.linked_character_id && session.linked_character_id !== characterId) {
        return;
      }

      const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
      deviceIdRef.current = deviceId;
      const snapshot = await getCharacterSnapshot(db, characterId);
      if (!snapshot) return;

      await saveCharacterSnapshot(db, session.id, deviceId, snapshot);

      const message: LanCharacterMessage = {
        type: 'CHARACTER_UPSERT',
        sessionId: session.id,
        deviceId,
        snapshot: {
          ...snapshot,
          updatedAt: new Date().toISOString(),
        },
      };

      if (session.role === 'master') {
        transport.broadcast(message);
        await refreshPlayers();
      } else {
        transport.sendToServer(message);
      }

      setLanRevision(prev => prev + 1);
      setLastNotice(`Ficha sincronizada (${reason}).`);
      await traceLan(session.role === 'master' ? 'LAN_SEND' : 'LAN_COMMAND', 'broadcastCharacter', 'character_upsert_sent', `Ficha sincronizada (${reason}).`, {
        durationMs: Date.now() - startedAt,
        used: ['getOrCreateDeviceId', 'getCharacterSnapshot', 'saveCharacterSnapshot', session.role === 'master' ? 'transport.broadcast' : 'transport.sendToServer'],
        characterId,
        reason,
        snapshotName: snapshot.name,
      }, 'debug');
    },
    [db, refreshPlayers, traceLan]
  );

  const sendLanCommand = useCallback(
    async (command: LanCommandKind, payload: Record<string, unknown> = {}) => {
      const startedAt = Date.now();
      const session = activeSessionRef.current;
      if (!session) {
        setLastError('Nenhuma sessao LAN ativa.');
        await traceLan('LAN_COMMAND', 'sendLanCommand', 'blocked_no_session', `Comando ${command} bloqueado: nenhuma sessao ativa.`, {
          command,
          payload,
        }, 'warn');
        return;
      }

      const deviceId = deviceIdRef.current || (await getOrCreateDeviceId(db));
      deviceIdRef.current = deviceId;

      const actorName = session.role === 'master' ? 'Mestre' : await getLocalPlayerName(db);
      const message: LanCommandMessage = {
        type: 'LAN_COMMAND',
        sessionId: session.id,
        commandId: makeCommandId(),
        deviceId,
        actorName,
        characterId: session.linked_character_id || null,
        command,
        payload,
        at: new Date().toISOString(),
      };

      if (session.role === 'master') {
        await traceLan('LAN_COMMAND', 'sendLanCommand', 'local_master_command', `Mestre executando comando local ${command}.`, {
          durationMs: Date.now() - startedAt,
          used: ['handleAuthoritativeCommand'],
          command,
          payload,
          commandId: message.commandId,
        }, 'debug', message.commandId);
        await handleAuthoritativeCommand(message);
        return;
      }

      const transport = transportRef.current;
      if (!transport) {
        setLastError('Conexao LAN indisponivel.');
        await traceLan('LAN_COMMAND', 'sendLanCommand', 'blocked_no_transport', `Comando ${command} bloqueado: conexao LAN indisponivel.`, {
          command,
          payload,
          commandId: message.commandId,
        }, 'error', message.commandId);
        return;
      }

      transport.sendToServer(message);
      setLastNotice('Comando enviado ao mestre.');
      await traceLan('LAN_SEND', 'sendLanCommand', 'sent_to_master', `Comando ${command} enviado ao mestre.`, {
        durationMs: Date.now() - startedAt,
        used: ['transport.sendToServer'],
        command,
        payload,
        commandId: message.commandId,
      }, 'info', message.commandId);
    },
    [db, handleAuthoritativeCommand, traceLan]
  );

  const getHistoryPage = useCallback(
    async (page = 0, pageSize = 20) => {
      const session = activeSessionRef.current;
      if (!session) return [];
      return getLanHistoryPage(db, session.id, page, pageSize);
    },
    [db]
  );

  const pauseActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_PAUSE_SESSION');
  }, [sendLanCommand]);

  const resumeActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_RESUME_SESSION');
  }, [sendLanCommand]);

  const endActiveSession = useCallback(async () => {
    await sendLanCommand('MASTER_END_SESSION');
  }, [sendLanCommand]);

  const broadcastCharacterRef = useRef<typeof broadcastCharacter | null>(null);
  useEffect(() => {
    broadcastCharacterRef.current = broadcastCharacter;
  }, [broadcastCharacter]);

  useEffect(() => {
    let mounted = true;

    getOrCreateDeviceId(db).then(deviceId => {
      if (mounted) deviceIdRef.current = deviceId;
    });
    refreshActiveSession();

    return () => {
      mounted = false;
      transportRef.current?.close();
    };
  }, [db, refreshActiveSession]);

  const value = useMemo<LanSessionContextValue>(
    () => ({
      activeSession,
      isTransportReady,
      peerCount,
      lastError,
      lastNotice,
      lanRevision,
      players,
      refreshActiveSession,
      startMasterSession,
      joinPlayerSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
      sendLanCommand,
      getHistoryPage,
      pauseActiveSession,
      resumeActiveSession,
      endActiveSession,
      refreshPlayers,
    }),
    [
      activeSession,
      isTransportReady,
      peerCount,
      lastError,
      lastNotice,
      lanRevision,
      players,
      refreshActiveSession,
      startMasterSession,
      joinPlayerSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
      sendLanCommand,
      getHistoryPage,
      pauseActiveSession,
      resumeActiveSession,
      endActiveSession,
      refreshPlayers,
    ]
  );

  return <LanSessionContext.Provider value={value}>{children}</LanSessionContext.Provider>;
}

export function useLanSession() {
  const context = useContext(LanSessionContext);
  if (!context) {
    throw new Error('useLanSession deve ser usado dentro de LanSessionProvider.');
  }
  return context;
}
