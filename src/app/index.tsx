import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants'; // 1. Importar o Constants
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import CharacterCard, { Character } from '../components/CharacterCard';
import { useLanSession } from '../contexts/LanSessionContext';

export default function HomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { activeSession, closeActiveSession, linkCharacterToActiveSession } = useLanSession();
  const [charactersList, setCharactersList] = useState<Character[]>([]);
  const lanNavigationLockRef = useRef(false);
  const sheetNavigationLockRef = useRef(false);

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const loadCharacters = async () => {
    try {
      const result = await db.getAllAsync<Character>(
        `SELECT id, name, level, class, race, avatar_uri FROM characters ORDER BY created_at DESC`
      );
      setCharactersList(result);
    } catch (error) {
      console.error("Erro ao carregar: ", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadCharacters();
    }, [db])
  );

  const handleDeleteCharacter = async (id: number) => {
    try {
      if (activeSession?.linked_character_id === id) {
        await linkCharacterToActiveSession(null);
        await closeActiveSession();
      }
      await db.runAsync(`DELETE FROM characters WHERE id = ?`, [id]);
      loadCharacters();
    } catch (error) {
      Alert.alert("Erro", "Não foi possível excluir o personagem.");
    }
  };

  const handleEditCharacter = (id: number) => {
    router.push({
      pathname: '/edit' as any,
      params: { id: id }
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

  const handleUnlinkSession = async (id: number) => {
    if (activeSession?.linked_character_id !== id) return;
    await linkCharacterToActiveSession(null);
    await closeActiveSession();
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meus Personagens</Text>
      </View>

      {charactersList.length > 0 ? (
        <FlatList
          data={charactersList}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <CharacterCard 
              character={item} 
              onPress={() => handleOpenSheet(item)}
              onDelete={handleDeleteCharacter}
              onEdit={handleEditCharacter}
              onUnlinkSession={handleUnlinkSession}
              isLinkedToSession={activeSession?.linked_character_id === item.id}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>Nenhum tav encontrado</Text>
          <Text style={styles.emptyText}>Sua jornada ainda não começou. Crie seu primeiro personagem para iniciar a aventura!</Text>
        </View>
      )}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.advancedButton} activeOpacity={0.8} onPress={() => router.push('/advanced')}>
          <Ionicons name="construct-outline" size={20} color="#00bfff" style={{ marginRight: 10 }} />
          <Text style={styles.advancedButtonText}>FERRAMENTAS DO MESTRE</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.lanButton} activeOpacity={0.8} onPress={handleOpenLanSession}>
          <Ionicons name="wifi-outline" size={20} color="#00fa9a" style={{ marginRight: 10 }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.lanButtonText}>SESSÃO LAN</Text>
            {activeSession && <Text style={styles.lanButtonSub}>{activeSession.role === 'master' ? 'Mestre' : 'Jogador'} / {activeSession.name}</Text>}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tracerButton} activeOpacity={0.8} onPress={() => router.push('/tracer' as any)}>
          <Ionicons name="bug-outline" size={20} color="#ffd166" style={{ marginRight: 10 }} />
          <Text style={styles.tracerButtonText}>TRACER / DEBUG</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.createButton} activeOpacity={0.8} onPress={() => router.push('/create')}>
          <Text style={styles.createButtonIcon}>+</Text>
          <Text style={styles.createButtonText}>NOVO PERSONAGEM</Text>
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
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  
  listContent: { paddingHorizontal: 20, paddingBottom: 300 },
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, marginTop: -50 },
  emptyIcon: { fontSize: 60, marginBottom: 20, opacity: 0.8 },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: '#ffffff', marginBottom: 10 },
  emptyText: { fontSize: 14, color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', lineHeight: 22 },
  
  footer: { position: 'absolute', bottom: 20, left: 20, right: 20 },
  
  advancedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', borderWidth: 1, borderColor: '#00bfff', borderRadius: 16, paddingVertical: 14, marginBottom: 15 },
  advancedButtonText: { fontSize: 14, fontWeight: 'bold', color: '#00bfff', letterSpacing: 1 },

  lanButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 250, 154, 0.1)', borderWidth: 1, borderColor: '#00fa9a', borderRadius: 16, paddingVertical: 14, marginBottom: 15 },
  lanButtonText: { fontSize: 14, fontWeight: 'bold', color: '#00fa9a', letterSpacing: 1 },
  lanButtonSub: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 3, fontWeight: 'bold' },

  tracerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 209, 102, 0.1)', borderWidth: 1, borderColor: '#ffd166', borderRadius: 16, paddingVertical: 14, marginBottom: 15 },
  tracerButtonText: { fontSize: 14, fontWeight: 'bold', color: '#ffd166', letterSpacing: 1 },
  
  createButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#102b56', borderWidth: 1, borderColor: '#00bfff', borderRadius: 16, paddingVertical: 16, shadowColor: '#00bfff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 5, elevation: 5 },
  createButtonIcon: { fontSize: 24, color: '#00bfff', marginRight: 10, fontWeight: '300' },
  createButtonText: { fontSize: 16, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },

  versionContainer: {
    marginTop: 15,
    alignItems: 'center',
    opacity: 0.4,
  },
  versionText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase'
  }
});
