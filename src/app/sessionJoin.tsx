import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  applyLanSessionStateToCharacter,
  fetchLanSessionPayload,
  importLanCatalog,
  joinLanSessionWithCharacter,
  notifyMasterJoin,
  saveLanSession,
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

  useEffect(() => {
    const url = firstParam(params.url);
    const data = firstParam(params.data);

    if (url || data) {
      loadSession(url, data);
    }
  }, [params.url, params.data]);

  const loadSession = async (url?: string, data?: string) => {
    setLoading(true);
    try {
      const nextPayload = data ? JSON.parse(data) as LanSessionPayload : await fetchLanSessionPayload(url || '');
      await importLanCatalog(db, nextPayload);
      await saveLanSession(db, nextPayload, url);

      setPayload(nextPayload);
      setJoinUrl(url || '');
      setImported(true);
      await loadEligibleCharacters(nextPayload);
    } catch (error) {
      Alert.alert('Sessao LAN', 'Nao foi possivel entrar na sessao. Confira se voce esta na mesma rede do mestre.');
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
      `SELECT id, name, level, class, race FROM characters WHERE level = ? ORDER BY created_at DESC`,
      [nextPayload.session.level]
    );
    setCharacters(rows);
  };

  const handleChooseCharacter = async (characterId: number) => {
    if (!payload) return;
    const character = await joinLanSessionWithCharacter(db, payload.session.id, characterId);
    const synced = await applyLanSessionStateToCharacter(db, payload, characterId);
    const currentCharacter = synced
      ? await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM characters WHERE id = ?`, [characterId])
      : character;
    await notifyMasterJoin(joinUrl, payload.session.id, currentCharacter || character);
    router.replace(`/sheet?id=${characterId}&sessionId=${payload.session.id}&joinUrl=${encodeURIComponent(joinUrl)}` as any);
  };

  const handleCreateCharacter = () => {
    if (!payload) return;
    router.push({
      pathname: '/create' as any,
      params: {
        sessionId: payload.session.id,
        sessionLevel: String(payload.session.level),
        joinUrl,
      },
    });
  };

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
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
            <Text style={styles.sectionTitle}>Entrada manual</Text>
            <Text style={styles.hint}>Se o QR nao abriu automaticamente, cole a URL LAN mostrada pelo mestre.</Text>
            <TextInput style={styles.input} value={manualUrl} onChangeText={setManualUrl} placeholder="http://192.168.0.10:43115/session" placeholderTextColor={appColors.placeholderLight} autoCapitalize="none" />
            <TouchableOpacity style={styles.primaryButton} onPress={() => loadSession(manualUrl.trim())}>
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
