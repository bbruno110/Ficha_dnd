import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LanTransport } from '../network/lanTransport';
import { buildSessionCode, makeSessionId, parseSessionCode } from '../network/lanProtocol';
import {
  closeOpenLanSessions,
  getActiveLanSession,
  getCharacterSnapshot,
  getLanPlayers,
  getOrCreateDeviceId,
  getSelectedCustomContentPayloads,
  linkCharacterToSession,
  saveCharacterSnapshot,
  saveLanSession,
  selectedContentFromSession,
  setLanSessionStatus,
  updateLocalPlayerName,
  upsertCustomContentPayloads,
  upsertLanPlayer,
} from '../network/lanRepository';
import {
  LAN_DEFAULT_PORT,
  LanCharacterMessage,
  LanCustomContentMessage,
  LanHelloMessage,
  LanMessage,
  LanSessionConfig,
  LanSessionRecord,
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
  character_name?: string | null;
  connected: number;
  last_seen_at: string;
};

type LanSessionContextValue = {
  activeSession: LanSessionRecord | null;
  isTransportReady: boolean;
  peerCount: number;
  lastError: string | null;
  lastNotice: string | null;
  players: LanPlayerSummary[];
  refreshActiveSession: () => Promise<void>;
  startMasterSession: (options: StartMasterOptions) => Promise<LanSessionRecord>;
  joinPlayerSession: (options: JoinSessionOptions) => Promise<LanSessionRecord>;
  closeActiveSession: () => Promise<void>;
  linkCharacterToActiveSession: (characterId: number | null) => Promise<void>;
  broadcastCharacter: (characterId: number, reason?: string) => Promise<void>;
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

export function LanSessionProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [activeSession, setActiveSession] = useState<LanSessionRecord | null>(null);
  const [isTransportReady, setIsTransportReady] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [players, setPlayers] = useState<LanPlayerSummary[]>([]);

  const transportRef = useRef<LanTransport | null>(null);
  const activeSessionRef = useRef<LanSessionRecord | null>(null);
  const deviceIdRef = useRef<string>('');
  const customContentCacheRef = useRef<LanCustomContentMessage['records']>([]);

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

  const handleIncomingMessage = useCallback(
    async (message: LanMessage, peerId: string) => {
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

        const welcome: LanWelcomeMessage = {
          type: 'WELCOME',
          sessionId: session.id,
          deviceId: localDeviceId,
          masterName: 'Mestre',
          config: makeSessionConfig(session),
        };
        transportRef.current?.sendToPeer(peerId, welcome);

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
          transportRef.current?.broadcast(characterMessage, peerId);
        }

        setLastNotice(`Ficha recebida: ${characterMessage.snapshot.name}.`);
      }
    },
    [db, refreshPlayers]
  );

  const buildTransport = useCallback(() => {
    transportRef.current?.close();
    const transport = new LanTransport({
      onMessage: handleIncomingMessage,
      onPeerChange: () => {
        setPeerCount(transportRef.current?.peerCount || 0);
      },
      onStatus: status => {
        setIsTransportReady(true);
        setLastNotice(status);
      },
      onError: message => {
        setLastError(message);
      },
    });

    transportRef.current = transport;
    return transport;
  }, [handleIncomingMessage]);

  const startMasterSession = useCallback(
    async (options: StartMasterOptions) => {
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

      if (session.linked_character_id) {
        await Promise.resolve().then(() => broadcastCharacterRef.current?.(session.linked_character_id as number, 'master-start'));
      }

      return session;
    },
    [buildTransport, db]
  );

  const joinPlayerSession = useCallback(
    async (options: JoinSessionOptions) => {
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
      return session;
    },
    [buildTransport, db]
  );

  const closeActiveSession = useCallback(async () => {
    const session = activeSessionRef.current;
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
  }, [db]);

  const linkCharacterToActiveSession = useCallback(
    async (characterId: number | null) => {
      const session = activeSessionRef.current;
      if (!session) return;

      await linkCharacterToSession(db, session.id, characterId);
      const nextSession = { ...session, linked_character_id: characterId };
      setActiveSession(nextSession);
      activeSessionRef.current = nextSession;
    },
    [db]
  );

  const broadcastCharacter = useCallback(
    async (characterId: number, reason = 'change') => {
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
      } else {
        transport.sendToServer(message);
      }

      setLastNotice(`Ficha sincronizada (${reason}).`);
    },
    [db]
  );

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
      players,
      refreshActiveSession,
      startMasterSession,
      joinPlayerSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
      refreshPlayers,
    }),
    [
      activeSession,
      isTransportReady,
      peerCount,
      lastError,
      lastNotice,
      players,
      refreshActiveSession,
      startMasterSession,
      joinPlayerSession,
      closeActiveSession,
      linkCharacterToActiveSession,
      broadcastCharacter,
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
