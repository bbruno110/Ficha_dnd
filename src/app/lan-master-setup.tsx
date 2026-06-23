import { Ionicons } from '@expo/vector-icons';
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
import { useLanSession } from '../contexts/LanSessionContext';
import { CUSTOM_CONTENT_DEFINITIONS, LAN_ALL_CUSTOM_CONTENT_KEY, getCustomContentRefs } from '../network/lanRepository';
import { LanCustomContentRef } from '../types/lan';

export default function LanMasterSetupScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { activeSession, startMasterSession } = useLanSession();

  const [sessionName, setSessionName] = useState(activeSession?.role === 'master' ? activeSession.name : '');
  const [syncCustomContent, setSyncCustomContent] = useState(true);
  const [allowExistingCharacter, setAllowExistingCharacter] = useState(true);
  const [selectedContentKeys, setSelectedContentKeys] = useState<string[]>([LAN_ALL_CUSTOM_CONTENT_KEY]);
  const [contentRefs, setContentRefs] = useState<LanCustomContentRef[]>([]);
  const [contentModalVisible, setContentModalVisible] = useState(false);
  const [contentSearch, setContentSearch] = useState('');
  const [contentFilter, setContentFilter] = useState('Todos');
  const [starting, setStarting] = useState(false);

  const returnToLanSession = () => {
    const routerWithDismiss = router as any;
    if (typeof routerWithDismiss.dismissTo === 'function') {
      routerWithDismiss.dismissTo('/lan-session');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/lan-session');
  };

  const loadContent = useCallback(async () => {
    const refs = await getCustomContentRefs(db);
    setContentRefs(refs);
  }, [db]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const filteredContent = useMemo(() => {
    const search = contentSearch.trim().toLowerCase();
    return contentRefs.filter(item => {
      if (contentFilter !== 'Todos' && item.type !== contentFilter) return false;
      if (!search) return true;
      return `${item.name} ${item.subtitle || ''} ${item.type}`.toLowerCase().includes(search);
    });
  }, [contentRefs, contentFilter, contentSearch]);

  const isAllCustomContentSelected = selectedContentKeys.includes(LAN_ALL_CUSTOM_CONTENT_KEY);
  const selectedContentCount = isAllCustomContentSelected ? contentRefs.length : selectedContentKeys.length;

  const toggleContent = (key: string) => {
    setSelectedContentKeys(prev => {
      const withoutAll = prev.filter(item => item !== LAN_ALL_CUSTOM_CONTENT_KEY);
      return withoutAll.includes(key) ? withoutAll.filter(item => item !== key) : [...withoutAll, key];
    });
  };

  const toggleAllCustomContent = () => {
    setSelectedContentKeys(prev => (prev.includes(LAN_ALL_CUSTOM_CONTENT_KEY) ? [] : [LAN_ALL_CUSTOM_CONTENT_KEY]));
  };

  const handleStartMaster = async () => {
    if (starting) return;

    try {
      setStarting(true);
      await startMasterSession({
        sessionName,
        syncCustomContent,
        selectedContent: selectedContentKeys,
        allowExistingCharacter,
        linkedCharacterId: null,
      });
      returnToLanSession();
    } catch (error) {
      Alert.alert('Erro LAN', error instanceof Error ? error.message : 'Não foi possível iniciar a sessão.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>CRIAR MESA LAN</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroBox}>
            <Ionicons name="shield-half-outline" size={32} color="#00fa9a" />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Configuração do Mestre</Text>
              <Text style={styles.heroSub}>Configure a campanha, escolha as regras de ficha e inicie a mesa LAN local.</Text>
            </View>
          </View>

          {activeSession && (
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={20} color="#ffd166" />
              <Text style={styles.warningText}>Existe uma sessão LAN ativa. Ao iniciar outra mesa, a sessão atual pode ser substituída neste aparelho.</Text>
            </View>
          )}

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
                <Text style={styles.switchSub}>Envia itens, racas, classes, magias e kits escolhidos para os jogadores.</Text>
              </View>
              <Switch value={syncCustomContent} onValueChange={setSyncCustomContent} />
            </View>

            {syncCustomContent && (
              <TouchableOpacity style={styles.selectContentButton} onPress={() => setContentModalVisible(true)}>
                <Ionicons name="albums-outline" size={20} color="#00fa9a" />
                <Text style={styles.selectContentText}>Selecionar conteudos ({isAllCustomContentSelected ? 'Todos' : selectedContentCount})</Text>
                <Ionicons name="chevron-forward" size={18} color="#00fa9a" />
              </TouchableOpacity>
            )}

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Permitir ficha ja criada</Text>
                <Text style={styles.switchSub}>Jogadores podem vincular uma ficha local existente. Se desligado, cada jogador cria uma ficha nova para a mesa.</Text>
              </View>
              <Switch value={allowExistingCharacter} onValueChange={setAllowExistingCharacter} />
            </View>

            <TouchableOpacity style={[styles.primaryButton, starting && styles.disabledButton]} disabled={starting} onPress={handleStartMaster}>
              <Ionicons name="radio-outline" size={20} color="#02112b" />
              <Text style={styles.primaryButtonText}>{starting ? 'INICIANDO...' : 'INICIAR SESSAO COMO MESTRE'}</Text>
            </TouchableOpacity>
          </View>
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

            <TouchableOpacity
              style={[styles.selectAllButton, isAllCustomContentSelected && styles.selectAllButtonActive]}
              onPress={toggleAllCustomContent}
            >
              <Ionicons name={isAllCustomContentSelected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isAllCustomContentSelected ? '#02112b' : '#00fa9a'} />
              <Text style={[styles.selectAllText, isAllCustomContentSelected && styles.selectAllTextActive]}>
                Sincronizar todos, incluindo novos
              </Text>
            </TouchableOpacity>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
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
              style={styles.contentList}
              contentContainerStyle={filteredContent.length === 0 ? styles.contentListEmpty : styles.contentListContent}
              renderItem={({ item }) => {
                const selected = isAllCustomContentSelected || selectedContentKeys.includes(item.key);
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
              <Text style={styles.modalDoneText}>CONCLUIR ({isAllCustomContentSelected ? 'TODOS' : selectedContentCount})</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
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
  heroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(0,250,154,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.25)',
    marginBottom: 14,
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  heroSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, marginTop: 4 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,209,102,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.25)',
    marginBottom: 14,
  },
  warningText: { color: '#ffd166', flex: 1, fontSize: 12, lineHeight: 18 },
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
  disabledButton: { opacity: 0.45 },
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
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.35)',
    backgroundColor: 'rgba(0,250,154,0.08)',
    marginBottom: 12,
  },
  selectAllButtonActive: {
    backgroundColor: '#00fa9a',
    borderColor: '#00fa9a',
  },
  selectAllText: { color: '#00fa9a', fontSize: 13, fontWeight: 'bold', flex: 1 },
  selectAllTextActive: { color: '#02112b' },
  filterScroll: { maxHeight: 44, flexGrow: 0, flexShrink: 0, marginBottom: 12 },
  filterRow: { gap: 8, alignItems: 'center', paddingRight: 8 },
  filterChip: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
  contentList: { width: '100%', flex: 1 },
  contentListContent: { paddingBottom: 8 },
  contentListEmpty: { flexGrow: 1, justifyContent: 'center' },
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
});
