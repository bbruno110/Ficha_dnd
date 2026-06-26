import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CharacterCard, { Character } from '../components/CharacterCard';
import { useLanSession } from '../contexts/LanSessionContext';
import { getCharacterLinkedLanSession, linkCharacterToSession, setLanSessionStatus } from '../network/lanRepository';

export default function HomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const {
    activeSession,
    closeActiveSession,
    linkCharacterToActiveSession,
    refreshSavedSessions,
    sendLanCommand,
  } = useLanSession();
  const [charactersList, setCharactersList] = useState<Character[]>([]);
  const lanNavigationLockRef = useRef(false);
  const sheetNavigationLockRef = useRef(false);

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const loadCharacters = useCallback(async () => {
    try {
      const result = await db.getAllAsync<Character>(
        `SELECT
           c.id, c.name, c.level, c.class, c.race, c.avatar_uri,
           (
             SELECT s.name FROM lan_sessions s
             WHERE s.linked_character_id = c.id AND s.status <> 'closed'
             ORDER BY COALESCE(s.last_connected_at, s.resumed_at, s.paused_at, s.opened_at, s.created_at) DESC
             LIMIT 1
           ) AS linked_session_name,
           (
             SELECT s.id FROM lan_sessions s
             WHERE s.linked_character_id = c.id AND s.status <> 'closed'
             ORDER BY COALESCE(s.last_connected_at, s.resumed_at, s.paused_at, s.opened_at, s.created_at) DESC
             LIMIT 1
           ) AS linked_session_id,
           (
             SELECT s.status FROM lan_sessions s
             WHERE s.linked_character_id = c.id AND s.status <> 'closed'
             ORDER BY COALESCE(s.last_connected_at, s.resumed_at, s.paused_at, s.opened_at, s.created_at) DESC
             LIMIT 1
           ) AS linked_session_status,
           (
             SELECT s.role FROM lan_sessions s
             WHERE s.linked_character_id = c.id AND s.status <> 'closed'
             ORDER BY COALESCE(s.last_connected_at, s.resumed_at, s.paused_at, s.opened_at, s.created_at) DESC
             LIMIT 1
           ) AS linked_session_role
         FROM characters c
         ORDER BY c.created_at DESC`
      );
      setCharactersList(result);
    } catch (error) {
      console.error('Erro ao carregar personagens:', error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadCharacters();
    }, [loadCharacters])
  );

  const handleDeleteCharacter = async (id: number) => {
    try {
      const linkedSession = await getCharacterLinkedLanSession(db, id);
      if (linkedSession) {
        Alert.alert(
          'Ficha vinculada',
          `Esta ficha pertence à sessão "${linkedSession.name}". Ela será liberada quando essa sessão for encerrada.`
        );
        return;
      }
      await db.runAsync(`DELETE FROM characters WHERE id = ?`, [id]);
      await loadCharacters();
    } catch (error) {
      console.error('Erro ao excluir personagem:', error);
      Alert.alert('Erro', 'Não foi possível excluir o personagem.');
    }
  };

  const unlinkCharacterFromSession = async (character: Character) => {
    try {
      const linkedSession = await getCharacterLinkedLanSession(db, character.id);
      const session = linkedSession || (activeSession?.linked_character_id === character.id ? activeSession : null);
      if (!session) {
        await loadCharacters();
        return;
      }

      const isActiveLinkedSession = activeSession?.id === session.id && activeSession.linked_character_id === character.id;
      let commandSent = false;
      if (isActiveLinkedSession && activeSession.role === 'player') {
        try {
          await sendLanCommand('PLAYER_LEAVE_SESSION', {
            characterId: character.id,
            characterName: character.name,
          });
          commandSent = true;
        } catch (error) {
          console.warn('Falha ao avisar mestre sobre saida da sessao:', error);
        }
      }

      if (isActiveLinkedSession) {
        await linkCharacterToActiveSession(null);
        if (activeSession.role === 'player') {
          await closeActiveSession();
          await setLanSessionStatus(db, session.id, 'closed');
          await refreshSavedSessions();
        } else {
          await refreshSavedSessions();
        }
      } else {
        await linkCharacterToSession(db, session.id, null);
        await refreshSavedSessions();
      }

      await loadCharacters();
      Alert.alert(
        'Você saiu da mesa',
        commandSent
          ? `${character.name} foi desvinculado de "${session.name}". O mestre foi avisado no histórico. Para voltar, entre novamente pelo código ou QR da mesa.`
          : `${character.name} foi desvinculado de "${session.name}". Para voltar, entre novamente pelo código ou QR da mesa.`
      );
    } catch (error) {
      console.error('Erro ao desvincular ficha da sessao:', error);
      Alert.alert('Erro', 'Não foi possível desvincular esta ficha da sessão.');
    }
  };

  const handleUnlinkCharacterFromSession = (character: Character) => {
    const sessionName = character.linked_session_name || activeSession?.name || 'sessão LAN';
    Alert.alert(
      'Sair desta mesa?',
      `A ficha "${character.name}" será desvinculada de "${sessionName}". A mesa do mestre continua aberta, mas este aparelho sai dela. Para voltar, entre novamente pelo código ou QR.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair da mesa',
          style: 'destructive',
          onPress: () => {
            void unlinkCharacterFromSession(character);
          },
        },
      ]
    );
  };

  const handleEditCharacter = (id: number) => {
    router.push({
      pathname: '/edit' as any,
      params: { id },
    });
  };

  const handleOpenSheet = (character: Character) => {
    if (sheetNavigationLockRef.current) return;
    sheetNavigationLockRef.current = true;
    router.navigate(`/sheet?id=${character.id}` as any);
    setTimeout(() => {
      sheetNavigationLockRef.current = false;
    }, 700);
  };

  const handleOpenLanSession = () => {
    if (lanNavigationLockRef.current) return;
    lanNavigationLockRef.current = true;
    router.navigate('/lan-session' as any);
    setTimeout(() => {
      lanNavigationLockRef.current = false;
    }, 700);
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>Meus Personagens</Text>
        <Text style={styles.headerSubtitle}>
          {charactersList.length > 0
            ? `${charactersList.length} ${charactersList.length === 1 ? 'ficha criada' : 'fichas criadas'}`
            : 'Sua próxima aventura começa aqui'}
        </Text>
      </View>

      <FlatList
        style={styles.list}
        data={charactersList}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <CharacterCard
            character={item}
            onPress={() => handleOpenSheet(item)}
            onDelete={handleDeleteCharacter}
            onEdit={handleEditCharacter}
            onUnlinkFromSession={handleUnlinkCharacterFromSession}
            isLinkedToSession={Boolean(item.linked_session_name) || activeSession?.linked_character_id === item.id}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBox}>
              <Ionicons name="shield-outline" size={46} color="#7fcfff" />
            </View>
            <Text style={styles.emptyTitle}>Nenhum personagem</Text>
            <Text style={styles.emptyText}>Crie sua primeira ficha para começar a aventura.</Text>
          </View>
        )}
        contentContainerStyle={[styles.listContent, charactersList.length === 0 && styles.emptyListContent]}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.actionPanel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.shortcutRow}>
          <TouchableOpacity style={styles.shortcutButton} activeOpacity={0.8} onPress={() => router.push('/advanced')}>
            <Ionicons name="construct-outline" size={21} color="#7fcfff" />
            <Text style={styles.shortcutText}>Mestre</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.shortcutButton} activeOpacity={0.8} onPress={() => router.push('/grimorio' as any)}>
            <Ionicons name="book-outline" size={21} color="#ffd166" />
            <Text style={styles.shortcutText}>Grimório</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shortcutButton, activeSession && styles.shortcutButtonActive]}
            activeOpacity={0.8}
            onPress={handleOpenLanSession}
          >
            <View>
              <Ionicons name="wifi-outline" size={21} color="#00fa9a" />
              {activeSession && <View style={styles.activeDot} />}
            </View>
            <Text style={styles.shortcutText}>Sessão LAN</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.createButton} activeOpacity={0.85} onPress={() => router.push('/create')}>
          <Ionicons name="add" size={23} color="#02112b" />
          <Text style={styles.createButtonText}>Criar personagem</Text>
        </TouchableOpacity>

        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>v{appVersion}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#ffffff', letterSpacing: 0.3 },
  headerSubtitle: { color: 'rgba(255,255,255,0.48)', fontSize: 12, marginTop: 5 },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  emptyListContent: { flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 34, paddingBottom: 18 },
  emptyIconBox: {
    width: 84,
    height: 84,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.2)',
  },
  emptyTitle: { fontSize: 21, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  emptyText: { maxWidth: 280, fontSize: 14, color: 'rgba(255,255,255,0.52)', textAlign: 'center', lineHeight: 21 },

  actionPanel: {
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(1,12,32,0.72)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  shortcutRow: { flexDirection: 'row', gap: 10, marginBottom: 11 },
  shortcutButton: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  shortcutButtonActive: { borderColor: 'rgba(0,250,154,0.45)', backgroundColor: 'rgba(0,250,154,0.08)' },
  shortcutText: { color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '700' },
  activeDot: {
    position: 'absolute',
    right: -5,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00fa9a',
  },

  createButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00bfff',
    borderRadius: 16,
    shadowColor: '#00bfff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonText: { fontSize: 15, fontWeight: '800', color: '#02112b', letterSpacing: 0.3 },
  versionContainer: { marginTop: 9, alignItems: 'center', opacity: 0.32 },
  versionText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
