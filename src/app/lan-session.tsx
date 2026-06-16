import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLanSession } from '../contexts/LanSessionContext';
import { CUSTOM_CONTENT_DEFINITIONS, getCustomContentRefs } from '../network/lanRepository';
import { LanCustomContentRef } from '../types/lan';

type CharacterOption = {
  id: number;
  name: string;
  race: string;
  class: string;
  level: number;
};

type Mode = 'master' | 'player';

export default function LanSessionScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const {
    activeSession,
    isTransportReady,
    peerCount,
    lastError,
    lastNotice,
    players,
    startMasterSession,
    joinPlayerSession,
    closeActiveSession,
    linkCharacterToActiveSession,
    refreshPlayers,
  } = useLanSession();

  const [mode, setMode] = useState<Mode>('master');
  const [sessionName, setSessionName] = useState('');
  const [syncCustomContent, setSyncCustomContent] = useState(true);
  const [allowExistingCharacter, setAllowExistingCharacter] = useState(true);
  const [selectedContentKeys, setSelectedContentKeys] = useState<string[]>([]);
  const [contentRefs, setContentRefs] = useState<LanCustomContentRef[]>([]);
  const [contentModalVisible, setContentModalVisible] = useState(false);
  const [contentSearch, setContentSearch] = useState('');
  const [contentFilter, setContentFilter] = useState('Todos');

  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const loadLocalData = useCallback(async () => {
    const chars = await db.getAllAsync<CharacterOption>(
      `SELECT id, name, race, class, level FROM characters ORDER BY created_at DESC`
    );
    setCharacters(chars);

    const refs = await getCustomContentRefs(db);
    setContentRefs(refs);
  }, [db]);

  useEffect(() => {
    loadLocalData();
  }, [loadLocalData]);

  useEffect(() => {
    if (activeSession) {
      setSessionName(activeSession.name);
      setSelectedCharacterId(activeSession.linked_character_id || null);
      refreshPlayers();
    }
  }, [activeSession, refreshPlayers]);

  const filteredContent = useMemo(() => {
    const search = contentSearch.trim().toLowerCase();
    return contentRefs.filter(item => {
      if (contentFilter !== 'Todos' && item.type !== contentFilter) return false;
      if (!search) return true;
      return `${item.name} ${item.subtitle || ''} ${item.type}`.toLowerCase().includes(search);
    });
  }, [contentRefs, contentFilter, contentSearch]);

  const selectedCharacter = characters.find(character => character.id === selectedCharacterId);
  const selectedContentCount = selectedContentKeys.length;

  const toggleContent = (key: string) => {
    setSelectedContentKeys(prev => (prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]));
  };

  const handleStartMaster = async () => {
    try {
      const session = await startMasterSession({
        sessionName,
        syncCustomContent,
        selectedContent: selectedContentKeys,
        allowExistingCharacter,
        linkedCharacterId: selectedCharacterId,
      });
      setJoinCode(session.session_code || '');
      Alert.alert('Sessao LAN aberta', 'O mestre esta aceitando jogadores na rede local.');
    } catch (error) {
      Alert.alert('Erro LAN', error instanceof Error ? error.message : 'Nao foi possivel iniciar a sessao.');
    }
  };

  const handleJoin = async () => {
    try {
      await joinPlayerSession({
        code: joinCode,
        playerName,
        linkedCharacterId: selectedCharacterId,
      });
      Alert.alert('Conectado', 'Voce entrou na sessao LAN.');
    } catch (error) {
      Alert.alert('Erro LAN', error instanceof Error ? error.message : 'Nao foi possivel entrar na sessao.');
    }
  };

  const handleActiveCharacterChange = async (characterId: number | null) => {
    setSelectedCharacterId(characterId);
    if (activeSession) {
      await linkCharacterToActiveSession(characterId);
    }
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera bloqueada', 'Permita o acesso a camera para escanear QR Codes.');
        return;
      }
    }

    setScannerVisible(true);
  };

  const renderCharacterPicker = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.label}>PERSONAGEM VINCULADO</Text>
        {selectedCharacterId && (
          <TouchableOpacity onPress={() => handleActiveCharacterChange(null)}>
            <Text style={styles.clearText}>Limpar</Text>
          </TouchableOpacity>
        )}
      </View>

      {characters.length === 0 ? (
        <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/create')}>
          <Ionicons name="person-add-outline" size={20} color="#00bfff" />
          <Text style={styles.emptyActionText}>Criar personagem</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.characterList}>
          {characters.map(character => {
            const selected = selectedCharacterId === character.id;
            return (
              <TouchableOpacity
                key={character.id}
                style={[styles.characterPill, selected && styles.characterPillActive]}
                onPress={() => handleActiveCharacterChange(character.id)}
              >
                <Text style={[styles.characterPillName, selected && styles.characterPillNameActive]} numberOfLines={1}>
                  {character.name}
                </Text>
                <Text style={styles.characterPillSub} numberOfLines={1}>
                  Nv. {character.level} / {character.race}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const renderActiveSession = () => {
    if (!activeSession) return null;

    return (
      <View style={styles.activePanel}>
        <View style={styles.activeHeader}>
          <View>
            <Text style={styles.activeEyebrow}>{activeSession.role === 'master' ? 'MESTRE' : 'JOGADOR'}</Text>
            <Text style={styles.activeTitle}>{activeSession.name}</Text>
          </View>
          <View style={[styles.statusBadge, isTransportReady && styles.statusBadgeReady]}>
            <Text style={[styles.statusBadgeText, isTransportReady && styles.statusBadgeTextReady]}>
              {isTransportReady ? 'TCP ON' : 'TCP OFF'}
            </Text>
          </View>
        </View>

        {activeSession.role === 'master' && activeSession.session_code && (
          <View style={styles.qrRow}>
            <View style={styles.qrBox}>
              <QRCode value={activeSession.session_code} size={132} backgroundColor="#ffffff" color="#02112b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>CODIGO DA SESSAO</Text>
              <Text style={styles.codeText} selectable>
                {activeSession.session_code}
              </Text>
              <Text style={styles.networkText}>
                {activeSession.host_ip}:{activeSession.port}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.sessionStatsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.role === 'master' ? peerCount : 1}</Text>
            <Text style={styles.statLabel}>{activeSession.role === 'master' ? 'JOGADORES' : 'MESTRE'}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.sync_custom_content ? 'SIM' : 'NAO'}</Text>
            <Text style={styles.statLabel}>SYNC CUSTOM</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeSession.allow_existing_character ? 'SIM' : 'NOVO'}</Text>
            <Text style={styles.statLabel}>FICHA</Text>
          </View>
        </View>

        {selectedCharacter && (
          <Text style={styles.linkedText}>
            Vinculado: {selectedCharacter.name} / Nv. {selectedCharacter.level} / {selectedCharacter.class}
          </Text>
        )}

        {lastNotice && <Text style={styles.noticeText}>{lastNotice}</Text>}
        {lastError && <Text style={styles.errorText}>{lastError}</Text>}

        {activeSession.role === 'master' && players.length > 0 && (
          <View style={styles.playersBox}>
            <Text style={styles.playersTitle}>Jogadores conectados</Text>
            {players.map(player => (
              <View key={player.device_id} style={styles.playerRow}>
                <View>
                  <Text style={styles.playerName}>{player.player_name || 'Jogador'}</Text>
                  <Text style={styles.playerSub}>{player.character_name || 'Sem ficha vinculada'}</Text>
                </View>
                <View style={[styles.dot, player.connected ? styles.dotOn : styles.dotOff]} />
              </View>
            ))}
          </View>
        )}

        <View style={styles.activeActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/create')}>
            <Ionicons name="person-add-outline" size={18} color="#00bfff" />
            <Text style={styles.secondaryButtonText}>Nova ficha</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerButton} onPress={closeActiveSession}>
            <Ionicons name="close-circle-outline" size={18} color="#ff6666" />
            <Text style={styles.dangerButtonText}>Encerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>SESSAO LAN</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderActiveSession()}

          <View style={styles.modeTabs}>
            <TouchableOpacity style={[styles.modeTab, mode === 'master' && styles.modeTabActive]} onPress={() => setMode('master')}>
              <Ionicons name="shield-half-outline" size={18} color={mode === 'master' ? '#02112b' : '#00bfff'} />
              <Text style={[styles.modeTabText, mode === 'master' && styles.modeTabTextActive]}>Mestre</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeTab, mode === 'player' && styles.modeTabActive]} onPress={() => setMode('player')}>
              <Ionicons name="people-outline" size={18} color={mode === 'player' ? '#02112b' : '#00bfff'} />
              <Text style={[styles.modeTabText, mode === 'player' && styles.modeTabTextActive]}>Jogador</Text>
            </TouchableOpacity>
          </View>

          {mode === 'master' ? (
            <View style={styles.formPanel}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>NOME DA SESSAO / CAMPANHA</Text>
                <TextInput
                  style={styles.input}
                  value={sessionName}
                  onChangeText={setSessionName}
                  placeholder="Ex: Mina Perdida de Phandelver"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Sincronizar conteudo custom</Text>
                  <Text style={styles.switchSub}>Envia itens, racas, classes, magias e kits escolhidos.</Text>
                </View>
                <Switch value={syncCustomContent} onValueChange={setSyncCustomContent} />
              </View>

              {syncCustomContent && (
                <TouchableOpacity style={styles.selectContentButton} onPress={() => setContentModalVisible(true)}>
                  <Ionicons name="albums-outline" size={20} color="#00fa9a" />
                  <Text style={styles.selectContentText}>Selecionar conteudos ({selectedContentCount})</Text>
                  <Ionicons name="chevron-forward" size={18} color="#00fa9a" />
                </TouchableOpacity>
              )}

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Permitir ficha ja criada</Text>
                  <Text style={styles.switchSub}>Jogadores podem vincular uma ficha local existente.</Text>
                </View>
                <Switch value={allowExistingCharacter} onValueChange={setAllowExistingCharacter} />
              </View>

              {allowExistingCharacter && renderCharacterPicker()}

              <TouchableOpacity style={styles.primaryButton} onPress={handleStartMaster}>
                <Ionicons name="radio-outline" size={20} color="#02112b" />
                <Text style={styles.primaryButtonText}>INICIAR SESSAO</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.formPanel}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>SEU NOME NA MESA</Text>
                <TextInput
                  style={styles.input}
                  value={playerName}
                  onChangeText={setPlayerName}
                  placeholder="Ex: Bruno"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>CODIGO DA SESSAO</Text>
                <View style={styles.codeInputRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={joinCode}
                    onChangeText={setJoinCode}
                    autoCapitalize="characters"
                    placeholder="DNDLAN-..."
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  <TouchableOpacity style={styles.scanButton} onPress={openScanner}>
                    <Ionicons name="qr-code-outline" size={24} color="#02112b" />
                  </TouchableOpacity>
                </View>
              </View>

              {renderCharacterPicker()}

              <TouchableOpacity style={styles.primaryButton} onPress={handleJoin}>
                <Ionicons name="log-in-outline" size={20} color="#02112b" />
                <Text style={styles.primaryButtonText}>ENTRAR EM SESSAO</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={contentModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setContentModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={event => event.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Conteudo custom</Text>
              <TouchableOpacity onPress={() => setContentModalVisible(false)}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.searchInput}
              value={contentSearch}
              onChangeText={setContentSearch}
              placeholder="Buscar por nome, tipo ou detalhe..."
              placeholderTextColor="rgba(255,255,255,0.35)"
            />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {['Todos', ...CUSTOM_CONTENT_DEFINITIONS.map(definition => definition.type)].map(filter => (
                <TouchableOpacity
                  key={filter}
                  style={[styles.filterChip, contentFilter === filter && styles.filterChipActive]}
                  onPress={() => setContentFilter(filter)}
                >
                  <Text style={[styles.filterChipText, contentFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <FlatList
              data={filteredContent}
              keyExtractor={item => item.key}
              style={{ width: '100%' }}
              renderItem={({ item }) => {
                const selected = selectedContentKeys.includes(item.key);
                return (
                  <TouchableOpacity style={[styles.contentItem, selected && styles.contentItemActive]} onPress={() => toggleContent(item.key)}>
                    <View style={[styles.checkbox, selected && styles.checkboxActive]}>
                      {selected && <Ionicons name="checkmark" size={14} color="#02112b" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contentItemName}>{item.name}</Text>
                      <Text style={styles.contentItemSub}>
                        {item.type}
                        {item.subtitle ? ` / ${item.subtitle}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhum conteudo custom encontrado.</Text>}
            />

            <TouchableOpacity style={styles.modalDoneButton} onPress={() => setContentModalVisible(false)}>
              <Text style={styles.modalDoneText}>CONCLUIR ({selectedContentCount})</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={scannerVisible} animationType="slide">
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setJoinCode(data);
              setScannerVisible(false);
            }}
          />
          <View style={styles.scannerTop}>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerVisible(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.scannerFrame} />
          <Text style={styles.scannerText}>Aponte para o QR Code do mestre</Text>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingTop: 50,
    paddingBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  topBarTitle: { color: '#00fa9a', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  activePanel: {
    backgroundColor: 'rgba(0, 250, 154, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 250, 154, 0.35)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  activeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  activeEyebrow: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  activeTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 3 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,100,100,0.12)' },
  statusBadgeReady: { backgroundColor: 'rgba(0,250,154,0.16)' },
  statusBadgeText: { color: '#ff6666', fontSize: 10, fontWeight: 'bold' },
  statusBadgeTextReady: { color: '#00fa9a' },
  qrRow: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 14 },
  qrBox: { backgroundColor: '#fff', borderRadius: 8, padding: 8 },
  codeLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  codeText: { color: '#fff', fontSize: 13, lineHeight: 19, fontWeight: 'bold' },
  networkText: { color: '#00bfff', fontSize: 12, marginTop: 6 },
  sessionStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 'bold', marginTop: 3 },
  linkedText: { color: '#fff', fontSize: 12, marginBottom: 8 },
  noticeText: { color: '#00fa9a', fontSize: 12, marginTop: 4 },
  errorText: { color: '#ff6666', fontSize: 12, marginTop: 4 },
  playersBox: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 12 },
  playersTitle: { color: '#00bfff', fontSize: 11, fontWeight: 'bold', marginBottom: 10 },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  playerName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  playerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: '#00fa9a' },
  dotOff: { backgroundColor: '#ff6666' },
  activeActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modeTabs: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  modeTabActive: { backgroundColor: '#00bfff', borderColor: '#00bfff' },
  modeTabText: { color: '#00bfff', fontWeight: 'bold' },
  modeTabTextActive: { color: '#02112b' },
  formPanel: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 'bold', color: '#00bfff', marginBottom: 8, letterSpacing: 1 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
  },
  switchTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  switchSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 3, lineHeight: 17 },
  selectContentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.35)',
    backgroundColor: 'rgba(0,250,154,0.09)',
    marginBottom: 10,
  },
  selectContentText: { color: '#00fa9a', fontSize: 13, fontWeight: 'bold', flex: 1 },
  section: { marginTop: 12, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clearText: { color: '#ff6666', fontSize: 12, fontWeight: 'bold' },
  characterList: { gap: 10, paddingVertical: 2 },
  characterPill: {
    width: 170,
    minHeight: 72,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.23)',
  },
  characterPillActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.1)' },
  characterPillName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  characterPillNameActive: { color: '#00fa9a' },
  characterPillSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 7 },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
    padding: 14,
    backgroundColor: 'rgba(0,191,255,0.08)',
  },
  emptyActionText: { color: '#00bfff', fontWeight: 'bold' },
  primaryButton: {
    backgroundColor: '#00fa9a',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButtonText: { color: '#02112b', fontWeight: 'bold', fontSize: 15, letterSpacing: 1 },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
  },
  secondaryButtonText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  dangerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,100,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,100,0.25)',
  },
  dangerButtonText: { color: '#ff6666', fontWeight: 'bold', fontSize: 12 },
  codeInputRow: { flexDirection: 'row', gap: 10 },
  scanButton: {
    width: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bfff',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: {
    height: '82%',
    backgroundColor: '#102b56',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.35)',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  searchInput: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    padding: 13,
    marginBottom: 12,
  },
  filterRow: { gap: 8, paddingBottom: 12 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterChipActive: { backgroundColor: '#00bfff', borderColor: '#00bfff' },
  filterChipText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 'bold' },
  filterChipTextActive: { color: '#02112b' },
  contentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 9,
  },
  contentItemActive: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.08)' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxActive: { backgroundColor: '#00fa9a', borderColor: '#00fa9a' },
  contentItemName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  contentItemSub: { color: 'rgba(255,255,255,0.48)', fontSize: 11, marginTop: 4 },
  modalDoneButton: {
    backgroundColor: '#00fa9a',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  modalDoneText: { color: '#02112b', fontWeight: 'bold' },
  emptyText: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginVertical: 30 },
  scannerContainer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  scannerTop: { position: 'absolute', top: 48, left: 20, right: 20, zIndex: 2 },
  scannerClose: {
    alignSelf: 'flex-end',
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#00fa9a',
    backgroundColor: 'transparent',
  },
  scannerText: {
    position: 'absolute',
    bottom: 90,
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
});

