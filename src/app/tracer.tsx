import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { cacheDirectory, documentDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  addTraceLog,
  clearTraceLogs,
  formatTraceLogsAsTxt,
  getTraceExportLogs,
  getTraceLogs,
  getTraceSummaries,
  getTraceTables,
  TraceLog,
  TraceSummary,
} from '../network/traceRepository';

const PAGE_SIZE = 100;
const expoConfig = Constants.expoConfig as any;
const TRACE_APP_INFO = {
  version: String(Constants.nativeApplicationVersion || expoConfig?.version || 'dev'),
  build: String(Constants.nativeBuildVersion || expoConfig?.android?.versionCode || 'local'),
  platform: Platform.OS,
  applicationId: String(expoConfig?.android?.package || expoConfig?.ios?.bundleIdentifier || ''),
};
const ACTION_FILTERS = [
  'Todos',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MANUAL',
  'FUNCTION',
  'LAN_SEND',
  'LAN_RECEIVE',
  'LAN_EVENT',
  'LAN_COMMAND',
  'EXPORT_TXT',
];

export default function TracerScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const [logs, setLogs] = useState<TraceLog[]>([]);
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('Todos');
  const [tableFilter, setTableFilter] = useState('Todas');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalOnPage = logs.length;
  const summaryTotal = useMemo(() => summaries.reduce((sum, item) => sum + Number(item.total || 0), 0), [summaries]);

  const loadTracer = useCallback(
    async (nextPage = 0) => {
      setLoading(true);
      try {
        const [nextLogs, nextSummaries, nextTables] = await Promise.all([
          getTraceLogs(db, {
            query,
            action: actionFilter,
            entityTable: tableFilter,
            limit: PAGE_SIZE,
            offset: nextPage * PAGE_SIZE,
          }),
          getTraceSummaries(db),
          getTraceTables(db),
        ]);
        setLogs(nextLogs);
        setSummaries(nextSummaries);
        setTables(nextTables);
        setPage(nextPage);
      } finally {
        setLoading(false);
      }
    },
    [actionFilter, db, query, tableFilter]
  );

  useFocusEffect(
    useCallback(() => {
      loadTracer(0);
    }, [loadTracer])
  );

  useEffect(() => {
    loadTracer(0);
  }, [actionFilter, loadTracer, tableFilter]);

  const applySearch = () => {
    loadTracer(0);
  };

  const handleClear = () => {
    Alert.alert('Limpar tracer', 'Isso remove todos os logs de debug registrados ate agora.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: async () => {
          await clearTraceLogs(db);
          await loadTracer(0);
        },
      },
    ]);
  };

  const handleManualLog = async () => {
    await addTraceLog(db, {
      level: 'info',
      category: 'debug',
      action: 'MANUAL',
      functionName: 'handleManualLog',
      sourceFile: 'src/app/tracer.tsx',
      step: 'manual_marker',
      entityTable: 'tracer',
      message: 'Log manual criado pela tela Tracer.',
      metadata: { page, actionFilter, tableFilter, query },
    });
    await loadTracer(0);
  };

  const handleExportTxt = async () => {
    setExporting(true);
    try {
      const exportLogs = await getTraceExportLogs(db, {
        query,
        action: actionFilter,
        entityTable: tableFilter,
        maxRows: 10000,
      });

      const txt = formatTraceLogsAsTxt(exportLogs, new Date(), TRACE_APP_INFO);
      const safeDate = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ficha-dnd-tracer-${safeDate}.txt`;
      const targetDir = documentDirectory || cacheDirectory;

      if (!targetDir) {
        throw new Error('Diretorio de arquivo indisponivel neste dispositivo.');
      }

      const fileUri = `${targetDir}${filename}`;
      await writeAsStringAsync(fileUri, txt, { encoding: EncodingType.UTF8 });

      await addTraceLog(db, {
        level: 'info',
        category: 'debug',
        action: 'EXPORT_TXT',
        functionName: 'handleExportTxt',
        sourceFile: 'src/app/tracer.tsx',
        step: 'write_and_share_txt',
        entityTable: 'tracer',
        message: `Tracer exportado em TXT com ${exportLogs.length} registro(s).`,
        metadata: {
          fileUri,
          app: TRACE_APP_INFO,
          filters: { query, actionFilter, tableFilter },
          exportedRows: exportLogs.length,
        },
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/plain',
          dialogTitle: 'Exportar logs do Tracer',
          UTI: 'public.plain-text',
        });
      } else {
        Alert.alert('TXT gerado', `Arquivo salvo em:\n${fileUri}`);
      }

      await loadTracer(0);
    } catch (error: any) {
      await addTraceLog(db, {
        level: 'error',
        category: 'debug',
        action: 'EXPORT_TXT',
        functionName: 'handleExportTxt',
        sourceFile: 'src/app/tracer.tsx',
        step: 'error',
        entityTable: 'tracer',
        message: 'Falha ao exportar TXT do tracer.',
        metadata: { error: String(error?.message || error) },
      });
      Alert.alert('Erro ao exportar', String(error?.message || error));
    } finally {
      setExporting(false);
    }
  };

  const renderFilterChip = (label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} style={[styles.filterChip, selected && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View>
      <View style={styles.summaryRow}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryValue}>{summaryTotal}</Text>
          <Text style={styles.summaryLabel}>TOTAL</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryValue}>{totalOnPage}</Text>
          <Text style={styles.summaryLabel}>NA PAGINA</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryValue}>{page + 1}</Text>
          <Text style={styles.summaryLabel}>PAGINA</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar tabela, id, acao, funcao, payload ou mensagem"
          placeholderTextColor="rgba(255,255,255,0.35)"
          returnKeyType="search"
          onSubmitEditing={applySearch}
        />
        <TouchableOpacity style={styles.iconButton} onPress={applySearch}>
          <Ionicons name="search" size={20} color="#02112b" />
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>ACAO</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {ACTION_FILTERS.map(filter => renderFilterChip(filter, actionFilter === filter, () => setActionFilter(filter)))}
      </ScrollView>

      <Text style={styles.sectionLabel}>TABELA</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {['Todas', ...tables].map(table => renderFilterChip(table, tableFilter === table, () => setTableFilter(table)))}
      </ScrollView>

      {summaries.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
          {summaries.slice(0, 12).map(item => (
            <View key={`${item.entity_table}-${item.action}`} style={styles.statPill}>
              <Text style={styles.statPillTitle}>{item.entity_table}</Text>
              <Text style={styles.statPillSub}>
                {item.action}: {item.total}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleManualLog}>
          <Ionicons name="radio-button-on-outline" size={18} color="#00bfff" />
          <Text style={styles.secondaryButtonText}>Marcar teste</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => loadTracer(page)}>
          <Ionicons name="refresh" size={18} color="#00bfff" />
          <Text style={styles.secondaryButtonText}>Atualizar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleExportTxt} disabled={exporting}>
          <Ionicons name="download-outline" size={18} color="#00bfff" />
          <Text style={styles.secondaryButtonText}>{exporting ? 'Exportando...' : 'Exportar TXT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerButton} onPress={handleClear}>
          <Ionicons name="trash-outline" size={18} color="#ff6666" />
          <Text style={styles.dangerButtonText}>Limpar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderLog = ({ item }: { item: TraceLog }) => (
    <View style={styles.logCard}>
      <View style={styles.logTop}>
        <View style={styles.logTitleWrap}>
          <Text style={styles.logAction}>{item.action}</Text>
          <Text style={styles.logEntity}>
            {item.entity_table || 'app'}{item.entity_id ? ` #${item.entity_id}` : ''}
          </Text>
        </View>
        <Text style={styles.logTime}>{new Date(item.created_at).toLocaleString()}</Text>
      </View>
      <Text style={styles.logMessage}>{item.message}</Text>
      {(item.function_name || item.source_file || item.step || item.request_id) && (
        <View style={styles.debugBox}>
          {item.function_name ? <Text style={styles.debugText}>funcao: {item.function_name}</Text> : null}
          {item.step ? <Text style={styles.debugText}>etapa: {item.step}</Text> : null}
          {item.source_file ? <Text style={styles.debugText}>arquivo: {item.source_file}</Text> : null}
          {item.request_id ? <Text style={styles.debugText}>requestId: {item.request_id}</Text> : null}
          {item.duration_ms !== undefined && item.duration_ms !== null ? <Text style={styles.debugText}>duracao: {item.duration_ms}ms</Text> : null}
        </View>
      )}
      <Text style={styles.logMeta}>
        {item.level.toUpperCase()} / {item.category}
      </Text>
      {item.metadata ? <Text style={styles.metadataText} numberOfLines={8}>{item.metadata}</Text> : null}
    </View>
  );

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>TRACER</Text>
        <View style={{ width: 28 }} />
      </View>

      <FlatList
        data={logs}
        keyExtractor={item => String(item.id)}
        renderItem={renderLog}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={<Text style={styles.emptyText}>{loading ? 'Carregando logs...' : 'Nenhum log encontrado.'}</Text>}
        contentContainerStyle={styles.content}
      />

      <View style={styles.pagination}>
        <TouchableOpacity
          style={[styles.pageButton, page === 0 && styles.disabledButton]}
          disabled={page === 0}
          onPress={() => loadTracer(Math.max(0, page - 1))}
        >
          <Ionicons name="chevron-back" size={18} color="#00bfff" />
          <Text style={styles.pageButtonText}>Anterior</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pageButton, logs.length < PAGE_SIZE && styles.disabledButton]}
          disabled={logs.length < PAGE_SIZE}
          onPress={() => loadTracer(page + 1)}
        >
          <Text style={styles.pageButtonText}>Proxima</Text>
          <Ionicons name="chevron-forward" size={18} color="#00bfff" />
        </TouchableOpacity>
      </View>
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
  content: { padding: 16, paddingBottom: 105 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryBox: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.2)',
  },
  summaryValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  summaryLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 'bold', marginTop: 4 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  iconButton: {
    width: 48,
    borderRadius: 12,
    backgroundColor: '#00fa9a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8 },
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
  statsRow: { gap: 8, paddingBottom: 12 },
  statPill: {
    minWidth: 118,
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(0,250,154,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,250,154,0.18)',
  },
  statPillTitle: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  statPillSub: { color: '#00fa9a', fontSize: 10, marginTop: 4, fontWeight: 'bold' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  secondaryButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
  },
  secondaryButtonText: { color: '#00bfff', fontWeight: 'bold', fontSize: 11 },
  dangerButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,100,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,100,0.25)',
  },
  dangerButtonText: { color: '#ff6666', fontWeight: 'bold', fontSize: 11 },
  logCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  logTitleWrap: { flex: 1 },
  logAction: { color: '#00fa9a', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  logEntity: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 3 },
  logTime: { color: 'rgba(255,255,255,0.45)', fontSize: 10, textAlign: 'right' },
  logMessage: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 18 },
  logMeta: { color: '#00bfff', fontSize: 10, marginTop: 8, fontWeight: 'bold' },
  debugBox: { marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.18)' },
  debugText: { color: 'rgba(255,255,255,0.62)', fontSize: 10, lineHeight: 15 },
  metadataText: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 6, lineHeight: 15 },
  emptyText: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', paddingVertical: 30 },
  pagination: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    flexDirection: 'row',
    gap: 10,
  },
  pageButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#102b56',
    borderWidth: 1,
    borderColor: '#00bfff',
  },
  pageButtonText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  disabledButton: { opacity: 0.4 },
});
