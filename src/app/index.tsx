import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { copyAsync, documentDirectory, EncodingType, makeDirectoryAsync, readAsStringAsync, StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CharacterCard, { Character } from '../components/CharacterCard';
import { useLanSession } from '../contexts/LanSessionContext';
import { getCharacterLinkedLanSession, linkCharacterToSession, setLanSessionStatus } from '../network/lanRepository';

const CHARACTER_DATA_COLUMNS = [
  'name',
  'race',
  'class',
  'stats',
  'prof_bonus',
  'inspiration',
  'proficiencies',
  'save_values',
  'skill_values',
  'personality_traits',
  'ideals',
  'bonds',
  'flaws',
  'features_traits',
  'backstory',
  'allies_organizations',
  'languages',
  'avatar_uri',
  'spells',
  'spell_slots_used',
  'equipment',
  'gp',
  'sp',
  'cp',
  'hp_max',
  'hp_current',
  'hp_temp',
  'level',
  'xp',
] as const;

type CharacterDataColumn = typeof CHARACTER_DATA_COLUMNS[number];
type CharacterRecord = Partial<Record<CharacterDataColumn, any>> & {
  id?: number;
  created_at?: string;
};

type CharacterBackupFile = {
  type?: string;
  version?: number;
  exported_at?: string;
  character?: CharacterRecord;
  avatar_backup?: {
    encoding?: string;
    extension?: string;
    data?: string;
  } | null;
};

const CHARACTER_BACKUP_TYPE = 'ficha-dnd-character';

function sanitizeFileName(value: string) {
  return (value || 'personagem')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'personagem';
}

function getFileExtension(uri?: string | null) {
  const match = String(uri || '').match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return 'jpg';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) return extension;
  return 'jpg';
}

function isLocalFileUri(uri?: string | null) {
  return Boolean(uri && uri.startsWith('file://'));
}

function shouldCopyAvatarUri(uri?: string | null) {
  return Boolean(isLocalFileUri(uri) || uri?.includes('/character-avatars/'));
}

function getCopyName(name?: string | null) {
  const baseName = String(name || 'Personagem').trim() || 'Personagem';
  return `${baseName} (Copia)`;
}

function normalizeImportedCharacter(raw: any): CharacterRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw.character && typeof raw.character === 'object' ? raw.character : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  if (!source.name || !source.race || !source.class || !source.stats) return null;

  const normalized: CharacterRecord = {};
  for (const column of CHARACTER_DATA_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(source, column)) {
      normalized[column] = source[column];
    }
  }
  return normalized;
}


async function saveJsonToAndroidPublicFolder(fileName: string, content: string) {
  const initialUri = StorageAccessFramework.getUriForDirectoryInRoot('Download');

  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);

  if (!permissions.granted) {
    return null;
  }

  const fileBaseName = fileName.replace(/\.json$/i, '');

  const fileUri = await StorageAccessFramework.createFileAsync(
    permissions.directoryUri,
    fileBaseName,
    'application/json'
  );

  await writeAsStringAsync(fileUri, content, {
    encoding: EncodingType.UTF8,
  });

  return fileUri;
}

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
  const [homeMenuVisible, setHomeMenuVisible] = useState(false);
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

  const getFullCharacter = async (id: number) => {
    return db.getFirstAsync<CharacterRecord>(`SELECT * FROM characters WHERE id = ? LIMIT 1`, [id]);
  };

  const insertCharacterRecord = async (record: CharacterRecord) => {
    const columns = CHARACTER_DATA_COLUMNS;
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(column => record[column] ?? null);
    const result = await db.runAsync(
      `INSERT INTO characters (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return Number((result as any).lastInsertRowId || 0);
  };

  const copyAvatarForCharacter = async (avatarUri: string | null | undefined, characterId: number) => {
    if (!avatarUri || !isLocalFileUri(avatarUri) || !documentDirectory) return null;
    const extension = getFileExtension(avatarUri);
    const avatarDir = `${documentDirectory}character-avatars/`;
    const destination = `${avatarDir}${characterId}_${Date.now()}.${extension}`;
    await makeDirectoryAsync(avatarDir, { intermediates: true });
    await copyAsync({ from: avatarUri, to: destination });
    return destination;
  };

  const buildAvatarBackup = async (avatarUri?: string | null) => {
    if (!avatarUri || !isLocalFileUri(avatarUri)) return null;
    try {
      const data = await readAsStringAsync(avatarUri, { encoding: EncodingType.Base64 });
      return {
        encoding: 'base64',
        extension: getFileExtension(avatarUri),
        data,
      };
    } catch (error) {
      console.warn('Nao foi possivel incluir avatar no backup:', error);
      return null;
    }
  };

  const restoreAvatarBackup = async (backup: CharacterBackupFile['avatar_backup'], characterId: number) => {
    if (!backup?.data || backup.encoding !== 'base64' || !documentDirectory) return null;
    const extension = getFileExtension(`avatar.${backup.extension || 'jpg'}`);
    const avatarDir = `${documentDirectory}character-avatars/`;
    const destination = `${avatarDir}${characterId}_${Date.now()}.${extension}`;
    await makeDirectoryAsync(avatarDir, { intermediates: true });
    await writeAsStringAsync(destination, backup.data, { encoding: EncodingType.Base64 });
    return destination;
  };

  const handleExportCharacter = async (character: Character) => {
  try {
    const fullCharacter = await getFullCharacter(character.id);

    if (!fullCharacter) {
      Alert.alert('Erro', 'Nao foi possivel preparar o backup desta ficha.');
      return;
    }

    const avatarBackup = await buildAvatarBackup(fullCharacter.avatar_uri);

    const exportPayload: CharacterBackupFile = {
      type: CHARACTER_BACKUP_TYPE,
      version: 1,
      exported_at: new Date().toISOString(),
      character: fullCharacter,
      avatar_backup: avatarBackup,
    };

    const fileName = `ficha_${sanitizeFileName(fullCharacter.name)}_${Date.now()}.json`;
    const fileContent = JSON.stringify(exportPayload, null, 2);

    if (Platform.OS === 'android') {
      const publicFileUri = await saveJsonToAndroidPublicFolder(fileName, fileContent);

      if (publicFileUri) {
        Alert.alert(
          'Backup exportado',
          'O personagem foi salvo na pasta escolhida. Ele deve aparecer em Arquivos > Recentes.'
        );
        return;
      }
    }

    if (!documentDirectory) {
      Alert.alert('Erro', 'Nao foi possivel acessar o diretorio interno do app.');
      return;
    }

    const fileUri = `${documentDirectory}${fileName}`;

    await writeAsStringAsync(fileUri, fileContent, {
      encoding: EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri);
    } else {
      Alert.alert(
        'Backup criado',
        'O arquivo JSON foi criado, mas o compartilhamento nao esta disponivel neste dispositivo.'
      );
    }
  } catch (error) {
    console.error('Erro ao exportar ficha:', error);
    Alert.alert('Erro', 'Nao foi possivel exportar esta ficha.');
  }
};

  const handleDuplicateCharacter = async (character: Character) => {
    try {
      const fullCharacter = await getFullCharacter(character.id);
      if (!fullCharacter) {
        Alert.alert('Erro', 'Nao foi possivel encontrar esta ficha.');
        return;
      }

      const duplicate: CharacterRecord = { ...fullCharacter, name: getCopyName(fullCharacter.name) };
      delete duplicate.id;
      delete duplicate.created_at;

      if (shouldCopyAvatarUri(fullCharacter.avatar_uri)) {
        duplicate.avatar_uri = null;
      }

      const newCharacterId = await insertCharacterRecord(duplicate);
      if (newCharacterId > 0 && shouldCopyAvatarUri(fullCharacter.avatar_uri)) {
        const copiedAvatarUri = await copyAvatarForCharacter(fullCharacter.avatar_uri, newCharacterId).catch(error => {
          console.warn('Nao foi possivel duplicar avatar:', error);
          return null;
        });
        if (copiedAvatarUri) {
          await db.runAsync(`UPDATE characters SET avatar_uri = ? WHERE id = ?`, [copiedAvatarUri, newCharacterId]);
        }
      }

      await loadCharacters();
      Alert.alert('Ficha duplicada', `${fullCharacter.name} foi duplicado como ${duplicate.name}.`);
    } catch (error) {
      console.error('Erro ao duplicar ficha:', error);
      Alert.alert('Erro', 'Nao foi possivel duplicar esta ficha.');
    }
  };

  const handleImportCharacter = async () => {
    setHomeMenuVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const fileContent = await readAsStringAsync(result.assets[0].uri, { encoding: EncodingType.UTF8 });
      const parsed = JSON.parse(fileContent) as CharacterBackupFile | CharacterRecord;
      const normalized = normalizeImportedCharacter(parsed);

      if (!normalized) {
        Alert.alert('Arquivo invalido', 'Escolha um backup de ficha exportado por este app.');
        return;
      }

      const backup = (parsed as CharacterBackupFile)?.avatar_backup || null;
      const imported: CharacterRecord = {
        ...normalized,
        name: `${String(normalized.name || 'Personagem').trim() || 'Personagem'}`,
      };
      delete imported.id;
      delete imported.created_at;

      if (backup?.data) {
        imported.avatar_uri = null;
      } else if (shouldCopyAvatarUri(imported.avatar_uri)) {
        imported.avatar_uri = null;
      }

      const newCharacterId = await insertCharacterRecord(imported);
      if (newCharacterId > 0) {
        const restoredAvatarUri = backup?.data
          ? await restoreAvatarBackup(backup, newCharacterId).catch(error => {
              console.warn('Nao foi possivel restaurar avatar importado:', error);
              return null;
            })
          : null;
        if (restoredAvatarUri) {
          await db.runAsync(`UPDATE characters SET avatar_uri = ? WHERE id = ?`, [restoredAvatarUri, newCharacterId]);
        }
      }

      await loadCharacters();
      Alert.alert('Personagem importado', `${imported.name} foi adicionado a sua lista.`);
    } catch (error) {
      console.error('Erro ao importar ficha:', error);
      Alert.alert('Erro', 'Nao foi possivel importar este personagem.');
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
      <Modal
        visible={homeMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setHomeMenuVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setHomeMenuVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>Personagens</Text>
            <TouchableOpacity style={styles.optionButton} onPress={handleImportCharacter}>
              <Ionicons name="download-outline" size={20} color="#00bfff" />
              <Text style={styles.optionText}>Importar personagem</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setHomeMenuVisible(false)}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.listWrapper}>
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
            onExport={handleExportCharacter}
            onDuplicate={handleDuplicateCharacter}
            onUnlinkFromSession={handleUnlinkCharacterFromSession}
            isLinkedToSession={Boolean(item.linked_session_name) || activeSession?.linked_character_id === item.id}
          />
        )}
        ListEmptyComponent={(
          <Pressable style={styles.emptyContainer} onLongPress={() => setHomeMenuVisible(true)} delayLongPress={450}>
            <View style={styles.emptyIconBox}>
              <Ionicons name="shield-outline" size={46} color="#7fcfff" />
            </View>
            <Text style={styles.emptyTitle}>Nenhum personagem</Text>
            <Text style={styles.emptyText}>Crie sua primeira ficha para começar a aventura.</Text>
          </Pressable>
        )}
        ListFooterComponent={charactersList.length > 0 ? (
          <Pressable style={styles.importFooterHitArea} onLongPress={() => setHomeMenuVisible(true)} delayLongPress={450} />
        ) : null}
        contentContainerStyle={[styles.listContent, charactersList.length === 0 && styles.emptyListContent]}
        showsVerticalScrollIndicator={false}
      />
      </View>
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

  listWrapper: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  importFooterHitArea: { minHeight: 96 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0a1930',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  optionButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  optionText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 15,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: 'bold',
  },
});
