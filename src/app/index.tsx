// ================= index.tsx =================
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants'; // 1. Importar o Constants
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import CharacterCard, { Character } from '../components/CharacterCard';

import { traceButton, traceError, traceScreen, traceSqlite } from '@/services/debug/appTrace';
import { prepareLanSessionStorage, unlinkCharacterFromLanSession } from '@/services/lanSession';
import { appColors, appGradients, homeStyles as styles } from '@/styles/globalStyles';

export default function HomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const [charactersList, setCharactersList] = useState<Character[]>([]);

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const loadCharacters = async () => {
    traceSqlite('SQLITE_READ_START', {
      screen: 'home',
      source: 'loadCharacters',
      functionName: 'loadCharacters',
      table: 'characters/lan_sessions/lan_local_character_bindings',
      operation: 'HOME_CHARACTERS_LOAD',
    });
    try {
      await prepareLanSessionStorage(db);
      const result = await db.getAllAsync<Character>(
        `SELECT c.id, c.name, c.level, c.class, c.race,
                s.id as sessionId, s.name as sessionName,
                COALESCE(b.join_url, s.join_url) as joinUrl
         FROM characters c
         LEFT JOIN lan_local_character_bindings b
           ON b.character_id = c.id
          AND COALESCE(b.is_active, 1) = 1
         LEFT JOIN lan_sessions s ON s.id = b.session_id
         GROUP BY c.id
         ORDER BY c.created_at DESC`
      );
      setCharactersList(result);
      traceSqlite('SQLITE_READ_DONE', {
        screen: 'home',
        source: 'loadCharacters',
        functionName: 'loadCharacters',
        table: 'characters/lan_sessions/lan_local_character_bindings',
        operation: 'HOME_CHARACTERS_LOAD',
        result: { count: result.length },
      });
    } catch (error) {
      console.error("Erro ao carregar: ", error);
      traceError('SQLITE_READ_DONE', 'HOME_CHARACTERS_LOAD_ERROR', error, {
        screen: 'home',
        source: 'loadCharacters',
        functionName: 'loadCharacters',
      });
    }
  };

  useFocusEffect(
    useCallback(() => {
      traceScreen('home', 'HOME_SCREEN_FOCUS');
      loadCharacters();
    }, [db])
  );

  const handleDeleteCharacter = async (id: number) => {
    traceButton('home', 'DELETE_CHARACTER', { characterId: id });
    try {
      await db.runAsync(`DELETE FROM characters WHERE id = ?`, [id]);
      loadCharacters();
    } catch (error) {
      Alert.alert("Erro", "Não foi possível excluir o personagem.");
    }
  };

  const handleEditCharacter = (id: number) => {
    traceButton('home', 'EDIT_CHARACTER', { characterId: id });
    router.push({
      pathname: '/edit' as any,
      params: { id: id }
    });
  };

  const handleUnlinkSession = async (id: number) => {
    traceButton('home', 'UNLINK_SESSION', { characterId: id });
    try {
      await unlinkCharacterFromLanSession(db, id);
      await loadCharacters();
    } catch (error) {
      Alert.alert("Erro", "Nao foi possivel desvincular este personagem da sessao.");
    }
  };

  const handleOpenSheet = (character: Character) => {
    traceButton('home', 'OPEN_CHARACTER_SHEET', {
      characterId: character.id,
      characterName: character.name,
      sessionId: character.sessionId,
      source: character.sessionId ? 'lan_binding' : 'offline',
    });
    if (character.sessionId) {
      router.push(`/sheet?id=${character.id}&sessionId=${character.sessionId}&joinUrl=${encodeURIComponent(character.joinUrl || '')}` as any);
      return;
    }
    router.push(`/sheet?id=${character.id}`);
  };

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
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
        <TouchableOpacity style={styles.advancedButton} activeOpacity={0.8} onPress={() => {
          traceButton('home', 'OPEN_MASTER_TOOLS');
          router.push('/advanced');
        }}>
          <Ionicons name="construct-outline" size={20} color={appColors.primary} style={styles.buttonIconGap} />
          <Text style={styles.advancedButtonText}>FERRAMENTAS DO MESTRE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.advancedButton}
          activeOpacity={0.8}
          onPress={() => {
            traceButton('home', 'OPEN_DEBUG_TRACE');
            router.push('/debug-trace' as any);
          }}
        >
          <Ionicons name="bug-outline" size={20} color={appColors.warning} style={styles.buttonIconGap} />
          <Text style={styles.advancedButtonText}>TRACE</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.lanButton} activeOpacity={0.8} onPress={() => {
          traceButton('home', 'OPEN_LAN_SESSION');
          router.push('/lan-session' as any);
        }}>
          <Ionicons name="wifi-outline" size={20} color={appColors.success} style={styles.buttonIconGap} />
          <Text style={styles.lanButtonText}>SESSAO LAN</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.createButton} activeOpacity={0.8} onPress={() => {
          traceButton('home', 'CREATE_CHARACTER');
          router.push('/create');
        }}>
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
