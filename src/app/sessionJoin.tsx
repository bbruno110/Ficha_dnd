import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

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

  useEffect(() => {
    const url = firstParam(params.url);
    const data = firstParam(params.data);
    const code = firstParam(params.code);

    if (url || data || code) {
      loadSession(url || code, data);
    }
  }, [params.url, params.data, params.code]);

  const loadSession = async (url?: string, data?: string) => {
    if (!url && !data) {
      Alert.alert('Sessao LAN', 'Informe o codigo da mesa, uma URL LAN ou escaneie o QR da sessao.');
      return;
    }

    setLoading(true);
    try {
      const rawInput = (url || '').trim();
      const parsedInput = rawInput && !data ? parseJoinQrCode(rawInput) : null;

      let resolvedUrl = parsedInput?.url ?? rawInput;
      const resolvedData = parsedInput?.data ?? data;
      const inviteCode = (parsedInput?.code || (!/^(https?|tcp):\/\//i.test(rawInput) ? rawInput : '')).trim();

      if (resolvedUrl && !resolvedData && !/^(https?|tcp):\/\//i.test(resolvedUrl)) {
        resolvedUrl = await resolveLanSessionUrlByInviteCode(inviteCode || resolvedUrl);
        if (!resolvedUrl) {
          throw new Error('Codigo da mesa nao encontrado na rede local.');
        }
      }

      let nextPayload: LanSessionPayload;
      try {
        nextPayload = resolvedData ? JSON.parse(resolvedData) as LanSessionPayload : await fetchLanSessionPayload(resolvedUrl);
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
      await importLanCatalog(db, nextPayload);
      await saveLanSession(db, nextPayload, resolvedUrl, { isMaster: false });

      setPayload(nextPayload);
      setJoinUrl(resolvedUrl || '');
      setImported(true);

      const bound = await getBoundLanCharacter(db, nextPayload.session.id);
      if (bound && isBoundCharacterStillInSession(nextPayload, bound.characterId)) {
        const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [bound.characterId]);
        await notifyMasterJoin(resolvedUrl || bound.joinUrl, nextPayload.session.id, currentCharacter, '', {
          reviewSnapshot: nextPayload.state?.status === 'paused',
        });
        router.replace(`/sheet?id=${bound.characterId}&sessionId=${nextPayload.session.id}&joinUrl=${encodeURIComponent(resolvedUrl || bound.joinUrl || '')}` as any);
        return;
      }

      if (bound && !isBoundCharacterStillInSession(nextPayload, bound.characterId)) {
        await unlinkCharacterFromLanSession(db, bound.characterId, nextPayload.session.id);
      }

      await loadEligibleCharacters(nextPayload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      const message = errorMessage.includes('Modulo TCP nativo indisponivel')
        ? 'Este build Android nao tem o modulo TCP nativo ativo. Recompile e reinstale o dev build no emulador/celular.'
        : errorMessage.includes('tcp://')
          ? 'Esta entrada nao usa socket TCP. Cole uma URL tcp:// ou digite o codigo de uma mesa TCP na mesma rede.'
          : 'Nao foi possivel entrar na sessao. Confira o codigo/URL e se voce esta na mesma rede do mestre.';
      Alert.alert('Sessao LAN', message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

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
           WHERE p.character_id = c.id AND p.session_id != ?
         )
       ORDER BY created_at DESC`,
      [nextPayload.session.level, nextPayload.session.id]
    );
    setCharacters(rows);
  };

  const handleChooseCharacter = async (characterId: number) => {
    if (!payload) return;
    const character = await joinLanSessionWithCharacter(db, payload.session.id, characterId);
    const currentCharacter = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [characterId]);
    const masterNotified = await notifyMasterJoin(joinUrl, payload.session.id, currentCharacter || character);
    await applyLanSessionStateToCharacter(db, payload, characterId);
    if (!masterNotified) {
      Alert.alert(
        'Sessao local',
        'Sua ficha entrou neste aparelho, mas nao consegui avisar o mestre. Para aparecer na tela do mestre, o QR precisa usar uma URL LAN ativa e os dois aparelhos precisam estar na mesma rede.'
      );
    }
    router.replace(`/sheet?id=${characterId}&sessionId=${payload.session.id}&joinUrl=${encodeURIComponent(joinUrl)}` as any);
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
        Alert.alert('Camera', 'Permita o acesso a camera para escanear o QR da sessao.');
        return;
      }
    }

    setScanned(false);
    setScannerVisible(true);
  };

  const handleQrScanned = (result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parseJoinQrCode(result.data);
    if (!parsed) {
      Alert.alert(
        'QR invalido',
        'Esse QR nao parece ser uma sessao LAN deste app.',
        [{ text: 'Tentar novamente', onPress: () => setScanned(false) }]
      );
      return;
    }

    setScannerVisible(false);
    setManualUrl(parsed.url || '');
    loadSession(parsed.url, parsed.data);
  };

  const handleManualJoin = () => {
    const raw = manualUrl.trim();
    const parsed = parseJoinQrCode(raw);
    if (parsed) {
      loadSession(parsed.url, parsed.data);
      return;
    }
    loadSession(raw);
  };

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.replace(payload ? '/lan-session' as any : '/' as any)}>
          <Ionicons name="arrow-back" size={28} color={appColors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Entrar na sessao</Text>
          <Text style={styles.topBarSub}>{params.code ? `Codigo ${params.code}` : 'Jogador'}</Text>
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
              Nivel {payload.session.level}. {imported ? 'Acervo customizado importado.' : ''}
            </Text>
            {payload.state?.status === 'paused' && (
              <Text style={styles.warningText}>Esta sessao esta pausada. Ao escolher a ficha, o app sincroniza o ultimo estado salvo pelo mestre.</Text>
            )}

            {payload.session.allowExisting ? (
              <>
                <Text style={styles.label}>PERSONAGENS DESTE NIVEL</Text>
                <Text style={styles.hint}>Personagens vinculados a outra sessao ficam ocultos. Para reutilizar, desvincule na tela inicial.</Text>
                <FlatList
                  data={characters}
                  keyExtractor={(item) => item.id.toString()}
                  ListEmptyComponent={<Text style={styles.hint}>Nenhum personagem local no nivel {payload.session.level}.</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.characterRow} onPress={() => handleChooseCharacter(item.id)}>
                      <Text style={styles.characterName}>{item.name}</Text>
                      <Text style={styles.characterDetails}>{item.race} - {item.class}</Text>
                    </TouchableOpacity>
                  )}
                />
              </>
            ) : (
              <Text style={styles.hint}>O mestre definiu que esta sala exige personagem novo.</Text>
            )}

            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateCharacter}>
              <Text style={styles.primaryButtonText}>CRIAR PERSONAGEM PARA A SESSAO</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Escanear QR</Text>
            <Text style={styles.hint}>Aponte a camera para o QR mostrado no celular do mestre.</Text>

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
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setScannerVisible(false)}>
                <Text style={styles.secondaryButtonText}>CANCELAR SCANNER</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Entrada manual</Text>
            <Text style={styles.hint}>Digite o codigo curto da mesa ou cole o convite/URL LAN mostrado pelo mestre.</Text>
            <TextInput style={styles.input} value={manualUrl} onChangeText={setManualUrl} placeholder="ABC123 ou tcp://192.168.0.10:43115/lan_..." placeholderTextColor={appColors.placeholderLight} autoCapitalize="characters" />
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
    if (url || data || code) return { url: url || code, data, code };
  }

  if (/^(https?|tcp):\/\//i.test(raw)) return { url: raw, data: undefined, code: undefined };

  try {
    const payload = JSON.parse(raw);
    if (payload?.type === 'ficha-dnd-lan-session') return { url: undefined, data: raw, code: payload?.session?.inviteCode };
  } catch {
    return null;
  }

  return null;
}

function isBoundCharacterStillInSession(payload: LanSessionPayload, characterId: number) {
  return Boolean(payload.state?.players?.some((player) => (
    player.characterId === characterId ||
    player.sourceCharacterId === characterId
  )));
}
