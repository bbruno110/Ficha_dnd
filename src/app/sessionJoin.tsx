// ================= sessionjoin.tsx =================
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  applyLanSessionStateToCharacter,
  fetchLanSessionPayload,
  getBoundLanCharacter,
  importLanCatalog,
  joinLanSessionWithCharacter,
  notifyMasterJoin,
  resolveLanSessionUrlByInviteCode,
  saveLanSession,
  unlinkCharacterFromLanSession,
  type LanSessionPayload,
} from '@/services/lanSession';
import { appColors, appGradients, lanSessionStyles as styles } from '@/styles/globalStyles';

type CharacterRow = {
  id: number;
  name: string;
  level: number;
  class: string;
  race: string;
};

export default function SessionJoinScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ url?: string; data?: string; code?: string }>();

  const [manualUrl, setManualUrl] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [payload, setPayload] = useState<LanSessionPayload | null>(null);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const getJoinErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');

    if (message.includes('Tempo esgotado') || message.toLowerCase().includes('timeout')) {
      return 'Não consegui conectar ao mestre. Verifique se os dois celulares estão na mesma rede Wi-Fi e se a sessão ainda está aberta no celular do mestre.';
    }

    if (message.includes('SESSION_ID_MISMATCH') || message.includes('JOIN_SESSION_ID_MISMATCH')) {
      return 'Esse QR parece ser de uma sessão antiga. Peça para o mestre mostrar o QR atualizado.';
    }

    if (
      message.includes('react-native-tcp-socket') ||
      message.includes('TcpSockets') ||
      message.includes('Modulo TCP nativo indisponivel')
    ) {
      return 'Este build não tem suporte ao socket TCP. Use um dev build nativo; o Expo Go não suporta TCP local.';
    }

    if (message.includes('Codigo da mesa nao encontrado')) {
      return 'Não encontrei essa mesa na rede local. Confirme se o celular do mestre está na mesma rede Wi-Fi e com a sessão aberta.';
    }

    if (message.includes('URL TCP invalida')) {
      return 'O QR contém uma URL de sessão inválida.';
    }

    return message || 'Não foi possível entrar na sessão LAN.';
  };

  const loadSession = async (url?: string, data?: string) => {
    if (!url && !data) {
      throw new Error('Informe o código da mesa, uma URL LAN ou escaneie o QR da sessão.');
    }

    setLoading(true);

    try {
      const rawInput = (url || '').trim();
      const parsedInput = rawInput && !data ? parseJoinQrCode(rawInput) : null;

      let resolvedUrl = parsedInput?.url ?? rawInput;
      const resolvedData = parsedInput?.data ?? data;
      const inviteCode = (
        parsedInput?.code ||
        (!/^(https?|tcp):\/\//i.test(rawInput) ? rawInput : '')
      ).trim();

      if (resolvedUrl && !resolvedData && !/^(https?|tcp):\/\//i.test(resolvedUrl)) {
        resolvedUrl = await resolveLanSessionUrlByInviteCode(inviteCode || resolvedUrl);

        if (!resolvedUrl) {
          throw new Error('Codigo da mesa nao encontrado na rede local.');
        }
      }

      let nextPayload: LanSessionPayload;

      try {
        nextPayload = resolvedData
          ? (JSON.parse(resolvedData) as LanSessionPayload)
          : await fetchLanSessionPayload(resolvedUrl);
      } catch (error) {
        if (!resolvedData && inviteCode) {
          const codeResolvedUrl = await resolveLanSessionUrlByInviteCode(inviteCode);

          if (codeResolvedUrl && codeResolvedUrl !== resolvedUrl) {
            resolvedUrl = codeResolvedUrl;
            nextPayload = await fetchLanSessionPayload(resolvedUrl);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      if (!nextPayload?.session?.id) {
        throw new Error('Convite LAN inválido ou sessão sem identificador.');
      }

      await importLanCatalog(db, nextPayload);

      // IMPORTANTE:
      // Jogador sempre salva como jogador.
      // Nunca deixe virar mestre por padrão.
      await saveLanSession(db, nextPayload, resolvedUrl, { isMaster: false });

      setPayload(nextPayload);
      setJoinUrl(resolvedUrl || '');
      setImported(true);

      const bound = await getBoundLanCharacter(db, nextPayload.session.id);

      if (bound && isBoundCharacterStillInSession(nextPayload, bound.characterId)) {
        const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(
          `SELECT * FROM characters WHERE id = ?`,
          [bound.characterId]
        );

        await saveLanSession(db, nextPayload, resolvedUrl || bound.joinUrl, { isMaster: false });

        await notifyMasterJoin(
          resolvedUrl || bound.joinUrl,
          nextPayload.session.id,
          currentCharacter,
          '',
          {
            reviewSnapshot: nextPayload.state?.status === 'paused',
          }
        );

        router.replace(
          `/sheet?id=${bound.characterId}&sessionId=${nextPayload.session.id}&joinUrl=${encodeURIComponent(
            resolvedUrl || bound.joinUrl || ''
          )}` as any
        );
        return;
      }

      if (bound && !isBoundCharacterStillInSession(nextPayload, bound.characterId)) {
        await unlinkCharacterFromLanSession(db, bound.characterId, nextPayload.session.id);
      }

      await loadEligibleCharacters(nextPayload);
    } finally {
      setLoading(false);
    }
  };

  const runLoadSessionSafely = async (url?: string, data?: string) => {
    try {
      await loadSession(url, data);
    } catch (error) {
      console.error('[LAN] Falha ao entrar na sessão:', error);

      setPayload(null);
      setImported(false);
      setLoading(false);
      setScanned(false);
      setScannerVisible(false);

      Alert.alert('Falha ao entrar na sessão', getJoinErrorMessage(error), [
        {
          text: 'OK',
          onPress: () => {
            setScanned(false);
          },
        },
      ]);
    }
  };

  useEffect(() => {
    const url = firstParam(params.url);
    const data = firstParam(params.data);
    const code = firstParam(params.code);

    if (url || data || code) {
      void runLoadSessionSafely(url || code, data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url, params.data, params.code]);

  const loadEligibleCharacters = async (nextPayload: LanSessionPayload) => {
    if (!nextPayload.session.allowExisting) {
      setCharacters([]);
      return;
    }

    const rows = await db.getAllAsync<CharacterRow>(
      `SELECT id, name, level, class, race
       FROM characters c
       WHERE c.level = ?
         AND NOT EXISTS (
           SELECT 1
           FROM lan_session_players p
           WHERE p.character_id = c.id
             AND p.session_id != ?
             AND COALESCE(p.is_active, 1) = 1
             AND p.kicked_at IS NULL
         )
       ORDER BY created_at DESC`,
      [nextPayload.session.level, nextPayload.session.id]
    );

    setCharacters(rows);
  };

  const handleChooseCharacter = async (characterId: number) => {
    if (!payload) return;

    try {
      setLoading(true);

      const character = await joinLanSessionWithCharacter(db, payload.session.id, characterId);

      const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM characters WHERE id = ?`,
        [characterId]
      );

      // Garante novamente que esta sessão está salva como jogador.
      await saveLanSession(db, payload, joinUrl, { isMaster: false });

      const masterNotified = await notifyMasterJoin(
        joinUrl,
        payload.session.id,
        currentCharacter || character
      );

      await applyLanSessionStateToCharacter(db, payload, characterId);

      if (!masterNotified) {
        Alert.alert(
          'Sessão local',
          'Sua ficha entrou neste aparelho, mas não consegui avisar o mestre. Para aparecer na tela do mestre, o QR precisa usar uma URL LAN ativa e os dois aparelhos precisam estar na mesma rede.'
        );
      }

      router.replace(
        `/sheet?id=${characterId}&sessionId=${payload.session.id}&joinUrl=${encodeURIComponent(
          joinUrl
        )}` as any
      );
    } catch (error) {
      console.error('[LAN] Falha ao escolher personagem:', error);

      Alert.alert(
        'Falha ao entrar',
        getJoinErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCharacter = () => {
    if (!payload) return;

    router.replace({
      pathname: '/create' as any,
      params: {
        sessionId: payload.session.id,
        sessionLevel: String(payload.session.level),
        joinUrl,
      },
    });
  };

  const handleOpenScanner = async () => {
    if (!cameraPermission?.granted) {
      const nextPermission = await requestCameraPermission();

      if (!nextPermission.granted) {
        Alert.alert('Câmera', 'Permita o acesso à câmera para escanear o QR da sessão.');
        return;
      }
    }

    setScanned(false);
    setScannerVisible(true);
  };

  const handleQrScanned = (result: BarcodeScanningResult) => {
    if (scanned) return;

    setScanned(true);

    try {
      const parsed = parseJoinQrCode(result.data);

      if (!parsed) {
        Alert.alert(
          'QR inválido',
          'Esse QR não parece ser uma sessão LAN deste app.',
          [
            {
              text: 'Tentar novamente',
              onPress: () => setScanned(false),
            },
          ]
        );
        return;
      }

      setScannerVisible(false);
      setManualUrl(parsed.url || parsed.code || '');

      void runLoadSessionSafely(parsed.url || parsed.code, parsed.data);
    } catch (error) {
      console.error('[LAN] Erro ao ler QR:', error);

      setScanned(false);
      setScannerVisible(false);

      Alert.alert(
        'Erro ao ler QR',
        'Não consegui interpretar esse QR da sessão.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleManualJoin = () => {
    try {
      const raw = manualUrl.trim();
      const parsed = parseJoinQrCode(raw);

      if (parsed) {
        void runLoadSessionSafely(parsed.url || parsed.code, parsed.data);
        return;
      }

      void runLoadSessionSafely(raw);
    } catch (error) {
      console.error('[LAN] Erro na entrada manual:', error);

      Alert.alert(
        'Entrada inválida',
        'Não consegui interpretar esse código ou convite da sessão.',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.replace(payload ? '/lan-session' as any : '/' as any)}>
          <Ionicons name="arrow-back" size={28} color={appColors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Entrar na sessão</Text>
          <Text style={styles.topBarSub}>{params.code ? `Código ${params.code}` : 'Jogador'}</Text>
        </View>

        <View style={styles.topBarSpacer} />
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={appColors.primary} size="large" />
          <Text style={styles.hint}>Importando acervo do mestre...</Text>
        </View>
      ) : payload ? (
        <View style={styles.scrollContentFill}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{payload.session.name}</Text>

            <Text style={styles.hint}>
              Nível {payload.session.level}. {imported ? 'Acervo customizado importado.' : ''}
            </Text>

            {payload.state?.status === 'paused' && (
              <Text style={styles.warningText}>
                Esta sessão está pausada. Ao escolher a ficha, o app sincroniza o último estado salvo pelo mestre.
              </Text>
            )}

            {payload.session.allowExisting ? (
              <>
                <Text style={styles.label}>PERSONAGENS DESTE NÍVEL</Text>

                <Text style={styles.hint}>
                  Personagens vinculados a outra sessão ficam ocultos. Para reutilizar, desvincule na tela inicial.
                </Text>

                <FlatList
                  data={characters}
                  keyExtractor={(item) => item.id.toString()}
                  ListEmptyComponent={
                    <Text style={styles.hint}>
                      Nenhum personagem local no nível {payload.session.level}.
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.characterRow}
                      onPress={() => handleChooseCharacter(item.id)}
                    >
                      <Text style={styles.characterName}>{item.name}</Text>
                      <Text style={styles.characterDetails}>
                        {item.race} - {item.class}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </>
            ) : (
              <Text style={styles.hint}>
                O mestre definiu que esta sala exige personagem novo.
              </Text>
            )}

            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateCharacter}>
              <Text style={styles.primaryButtonText}>
                CRIAR PERSONAGEM PARA A SESSÃO
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Escanear QR</Text>

            <Text style={styles.hint}>
              Aponte a câmera para o QR mostrado no celular do mestre.
            </Text>

            {scannerVisible ? (
              <View style={styles.scannerBox}>
                <CameraView
                  style={styles.scannerCamera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleQrScanned}
                />
                <View style={styles.scannerFrame} />
              </View>
            ) : (
              <TouchableOpacity style={styles.primaryButton} onPress={handleOpenScanner}>
                <Text style={styles.primaryButtonText}>ESCANEAR QR</Text>
              </TouchableOpacity>
            )}

            {scannerVisible && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setScannerVisible(false);
                  setScanned(false);
                }}
              >
                <Text style={styles.secondaryButtonText}>CANCELAR SCANNER</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Entrada manual</Text>

            <Text style={styles.hint}>
              Digite o código curto da mesa ou cole o convite/URL LAN mostrado pelo mestre.
            </Text>

            <TextInput
              style={styles.input}
              value={manualUrl}
              onChangeText={setManualUrl}
              placeholder="ABC123 ou tcp://192.168.0.10:43115/lan_..."
              placeholderTextColor={appColors.placeholderLight}
              autoCapitalize="characters"
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleManualJoin}>
              <Text style={styles.primaryButtonText}>ENTRAR</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseJoinQrCode(value: string) {
  const raw = value.trim();

  if (!raw) return null;

  const queryStart = raw.indexOf('?');

  if (queryStart >= 0) {
    const params = new URLSearchParams(raw.slice(queryStart + 1));
    const url = params.get('url') || undefined;
    const data = params.get('data') || undefined;
    const code = params.get('code') || undefined;

    if (url || data || code) {
      return {
        url: url || code,
        data,
        code,
      };
    }
  }

  if (/^(https?|tcp):\/\//i.test(raw)) {
    return {
      url: raw,
      data: undefined,
      code: undefined,
    };
  }

  try {
    const parsedPayload = JSON.parse(raw);

    if (parsedPayload?.type === 'ficha-dnd-lan-session') {
      return {
        url: undefined,
        data: raw,
        code: parsedPayload?.session?.inviteCode,
      };
    }
  } catch {
    // Texto comum/código curto não é JSON.
  }

  // Código curto manual/QR simples.
  if (/^[A-Z0-9_-]{3,32}$/i.test(raw)) {
    return {
      url: raw,
      data: undefined,
      code: raw,
    };
  }

  return null;
}

function isBoundCharacterStillInSession(payload: LanSessionPayload, characterId: number) {
  return Boolean(
    payload.state?.players?.some((player) => (
      player.characterId === characterId ||
      player.sourceCharacterId === characterId
    ))
  );
}