import {
  clearTraceLogs,
  getTraceState,
  isTracePaused,
  pauseTrace,
  resumeTrace,
  subscribeTraceLogs,
  type AppTraceRecord,
  type AppTraceState,
} from '@/services/debug/appTrace';
import { appColors, appGradients } from '@/styles/globalStyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const;
const TRACE_BORDER = 'rgba(255,255,255,0.18)';
const TRACE_TEXT_SECONDARY = appColors.textMuted;

type TraceExportFormat = 'txt' | 'json' | 'jsonl';

type TraceExportOptions = {
  title?: string;
  format: TraceExportFormat;
  compact?: boolean;
};

const CRITICAL_SEARCH_TERMS = [
  'HP',
  'XP',
  'PATCH',
  'STATE',
  'EVENT',
  'SOCKET',
  'SQLITE',
  'SNAPSHOT',
  'PAYLOAD',
  'PUBLIC_STATUS',
  'RESYNC',
  'RELOAD',
  'KICK',
  'EFFECT',
  'TURN',
];

export default function DebugTraceScreen() {
  const router = useRouter();
  const [traceState, setTraceState] = useState<AppTraceState>(() => getTraceState());
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState<(typeof LEVELS)[number]>('all');
  const [selectedLog, setSelectedLog] = useState<AppTraceRecord | null>(null);

  useEffect(() => {
    const refresh = () => setTraceState(getTraceState());
    const unsubscribe = subscribeTraceLogs(refresh);
    refresh();
    return unsubscribe;
  }, []);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(traceState.logs.map((entry) => entry.category))).filter(Boolean);
    return ['all', ...unique.sort()];
  }, [traceState.logs]);

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return traceState.logs
      .filter((entry) => categoryFilter === 'all' || entry.category === categoryFilter)
      .filter((entry) => levelFilter === 'all' || entry.level === levelFilter)
      .filter((entry) => {
        if (!query) return true;

        const text = [
          entry.level,
          entry.category,
          entry.action,
          entry.screen,
          entry.functionName,
          entry.message,
          entry.eventType,
          entry.eventId,
          entry.sessionId,
          entry.characterName,
          entry.playerName,
          entry.reason,
          JSON.stringify(entry.before || ''),
          JSON.stringify(entry.after || ''),
          JSON.stringify(entry.patch || ''),
        ].filter(Boolean).join(' ').toLowerCase();

        return text.includes(query);
      })
      .slice()
      .reverse();
  }, [categoryFilter, levelFilter, search, traceState.logs]);

  const criticalLogs = useMemo(() => {
    return traceState.logs.filter((entry) => {
      const text = [
        entry.category,
        entry.action,
        entry.functionName,
        entry.message,
        entry.eventType,
        entry.reason,
        JSON.stringify(entry.before || ''),
        JSON.stringify(entry.after || ''),
        JSON.stringify(entry.patch || ''),
      ].filter(Boolean).join(' ').toUpperCase();

      return CRITICAL_SEARCH_TERMS.some((term) => text.includes(term));
    });
  }, [traceState.logs]);

  const copyLogs = async (
    logs: AppTraceRecord[],
    format: TraceExportFormat,
    title: string,
    compact = false,
  ) => {
    try {
      if (!logs.length) {
        Alert.alert('Debug Trace', 'Nenhum log para copiar.');
        return;
      }

      const text = serializeTraceLogs(logs, { title, format, compact });
      await Clipboard.setStringAsync(text);

      Alert.alert(
        'Debug Trace',
        `${logs.length} log(s) copiado(s) em ${format.toUpperCase()}${compact ? ' compacto' : ''}.`
      );
    } catch (error) {
      Alert.alert(
        'Debug Trace',
        error instanceof Error ? error.message : 'Nao consegui copiar os logs.'
      );
    }
  };

  const copyAll = (format: TraceExportFormat, compact = false) => {
    void copyLogs(traceState.logs, format, `Todos os logs do Debug Trace`, compact);
  };

  const copyFiltered = (format: TraceExportFormat, compact = false) => {
    void copyLogs(filteredLogs, format, `Logs filtrados do Debug Trace`, compact);
  };

  const copyLast200 = (format: TraceExportFormat, compact = false) => {
    void copyLogs(traceState.logs.slice(-200), format, `Ultimos 200 logs do Debug Trace`, compact);
  };

  const copyCritical = (format: TraceExportFormat, compact = true) => {
    void copyLogs(criticalLogs, format, `Logs criticos LAN/estado/socket/sqlite`, compact);
  };

  const copySelected = (format: TraceExportFormat, compact = false) => {
    if (!selectedLog) return;
    void copyLogs([selectedLog], format, `Log selecionado`, compact);
  };

  const copySummary = async () => {
    try {
      const summary = serializeTraceSummary(traceState.logs);
      await Clipboard.setStringAsync(summary);
      Alert.alert('Debug Trace', 'Resumo copiado.');
    } catch (error) {
      Alert.alert(
        'Debug Trace',
        error instanceof Error ? error.message : 'Nao consegui copiar o resumo.'
      );
    }
  };

  const togglePaused = () => {
    if (isTracePaused()) resumeTrace();
    else pauseTrace();
    setTraceState(getTraceState());
  };

  const clearLogs = () => {
    Alert.alert('Limpar trace', 'Apagar todos os logs em memoria?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: () => {
          clearTraceLogs();
          setTraceState(getTraceState());
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={appGradients.main} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={appColors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerTextBlock}>
          <Text style={styles.title}>Debug Trace</Text>
          <Text style={styles.subtitle}>
            {traceState.logs.length} logs - {traceState.paused ? 'pausado' : 'gravando'} - {filteredLogs.length} filtrado(s)
          </Text>
        </View>
      </View>

      <ScrollView style={styles.controlsScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Exportar tudo</Text>
        <View style={styles.toolbar}>
          <TraceButton label="Tudo TXT" onPress={() => copyAll('txt')} />
          <TraceButton label="Tudo JSON" onPress={() => copyAll('json')} />
          <TraceButton label="Tudo JSONL" onPress={() => copyAll('jsonl')} />
          <TraceButton label="Tudo TXT compacto" onPress={() => copyAll('txt', true)} />
        </View>

        <Text style={styles.sectionTitle}>Exportar filtrados</Text>
        <View style={styles.toolbar}>
          <TraceButton label="Filtrados TXT" onPress={() => copyFiltered('txt')} />
          <TraceButton label="Filtrados JSON" onPress={() => copyFiltered('json')} />
          <TraceButton label="Filtrados JSONL" onPress={() => copyFiltered('jsonl')} />
          <TraceButton label="Filtrados compacto" onPress={() => copyFiltered('txt', true)} />
        </View>

        <Text style={styles.sectionTitle}>Recortes rápidos</Text>
        <View style={styles.toolbar}>
          <TraceButton label="Últimos 200 TXT" onPress={() => copyLast200('txt')} />
          <TraceButton label="Últimos 200 JSON" onPress={() => copyLast200('json')} />
          <TraceButton label="Críticos TXT" onPress={() => copyCritical('txt', true)} />
          <TraceButton label="Resumo" onPress={copySummary} />
        </View>

        <Text style={styles.sectionTitle}>Controle</Text>
        <View style={styles.toolbar}>
          <TraceButton label={traceState.paused ? 'Continuar' : 'Pausar'} onPress={togglePaused} />
          <TraceButton label="Limpar" danger onPress={clearLogs} />
        </View>
      </ScrollView>

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Buscar por acao, tela, evento, HP, XP, snapshot..."
        placeholderTextColor={appColors.placeholderLight}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {categories.map((category) => (
          <TouchableOpacity
            key={category}
            style={[styles.filterChip, categoryFilter === category && styles.filterChipActive]}
            onPress={() => setCategoryFilter(category)}
          >
            <Text style={[styles.filterChipText, categoryFilter === category && styles.filterChipTextActive]}>
              {category}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {LEVELS.map((level) => (
          <TouchableOpacity
            key={level}
            style={[styles.filterChip, levelFilter === level && styles.filterChipActive]}
            onPress={() => setLevelFilter(level)}
          >
            <Text style={[styles.filterChipText, levelFilter === level && styles.filterChipTextActive]}>
              {level}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filteredLogs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.logItem} onPress={() => setSelectedLog(item)}>
            <View style={styles.logHeader}>
              <Text style={[styles.levelText, levelStyle(item.level)]}>{String(item.level || 'info').toUpperCase()}</Text>
              <Text style={styles.timeText}>{formatTime(item.timestampMs)}</Text>
              <Text style={styles.seqText}>{formatSeq(item)}</Text>
            </View>

            <Text style={styles.logTitle} numberOfLines={1}>
              {item.category} / {item.action}
            </Text>

            <Text style={styles.logMeta} numberOfLines={2}>
              {[item.screen, item.functionName, item.eventType, item.message].filter(Boolean).join(' - ')}
            </Text>

            {formatBeforeAfter(item) ? (
              <Text style={styles.beforeAfter} numberOfLines={2}>{formatBeforeAfter(item)}</Text>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Nenhum log para os filtros atuais.</Text>}
      />

      <Modal visible={Boolean(selectedLog)} transparent animationType="fade" onRequestClose={() => setSelectedLog(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log completo</Text>
              <TouchableOpacity onPress={() => setSelectedLog(null)}>
                <Ionicons name="close" size={26} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalToolbar}>
              <TraceButton label="Copiar TXT" onPress={() => copySelected('txt')} />
              <TraceButton label="Copiar JSON" onPress={() => copySelected('json')} />
              <TraceButton label="Copiar JSONL" onPress={() => copySelected('jsonl')} />
            </View>

            <ScrollView style={styles.modalBody}>
              <Text selectable style={styles.jsonText}>
                {selectedLog ? JSON.stringify(selectedLog, null, 2) : ''}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

function TraceButton({
  label,
  danger,
  onPress,
}: {
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.toolbarButton, danger && styles.toolbarButtonDanger]} onPress={onPress}>
      <Text style={[styles.toolbarButtonText, danger && styles.toolbarButtonTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function serializeTraceLogs(
  logs: AppTraceRecord[],
  options: TraceExportOptions,
) {
  const exportedAt = new Date().toISOString();
  const compactLogs = options.compact ? logs.map(compactTraceRecord) : logs.map((log) => safeClone(log));

  if (options.format === 'json') {
    return JSON.stringify({
      exportedAt,
      format: 'json',
      compact: Boolean(options.compact),
      title: options.title || 'Debug Trace',
      totalLogs: compactLogs.length,
      logs: compactLogs,
    }, null, 2);
  }

  if (options.format === 'jsonl') {
    const header = {
      type: 'APP_TRACE_EXPORT_HEADER',
      exportedAt,
      format: 'jsonl',
      compact: Boolean(options.compact),
      title: options.title || 'Debug Trace',
      totalLogs: compactLogs.length,
    };

    return [
      JSON.stringify(header),
      ...compactLogs.map((log) => JSON.stringify(log)),
    ].join('\n');
  }

  return serializeTraceLogsTxt(compactLogs, {
    exportedAt,
    title: options.title || 'Debug Trace',
    compact: Boolean(options.compact),
  });
}

function serializeTraceLogsTxt(
  logs: Array<Partial<AppTraceRecord>>,
  options: {
    exportedAt: string;
    title: string;
    compact: boolean;
  },
) {
  const lines: string[] = [
    '=== APP TRACE EXPORT ===',
    `ExportedAt: ${options.exportedAt}`,
    `Format: TXT`,
    `Compact: ${options.compact ? 'true' : 'false'}`,
    `Title: ${options.title}`,
    `TotalLogs: ${logs.length}`,
    '========================',
    '',
  ];

  logs.forEach((log, index) => {
    lines.push(`--- LOG ${index + 1}/${logs.length} ---`);
    lines.push(`[${formatTime(Number(log.timestampMs || Date.now()))}] ${String(log.level || 'info').toUpperCase()} ${log.category || ''} / ${log.action || ''}`);

    appendLine(lines, 'screen', log.screen);
    appendLine(lines, 'source', log.source);
    appendLine(lines, 'function', log.functionName);
    appendLine(lines, 'message', log.message);
    appendLine(lines, 'sessionId', log.sessionId);
    appendLine(lines, 'character', joinLabel(log.characterId, log.characterName));
    appendLine(lines, 'player', joinLabel(log.playerId, log.playerName || log.playerKey));
    appendLine(lines, 'eventType', log.eventType);
    appendLine(lines, 'eventId', log.eventId);
    appendLine(lines, 'envelopeType', log.envelopeType);
    appendLine(lines, 'seq', log.seq ?? log.serverSeq);
    appendLine(lines, 'entityRevision', log.entityRevision);
    appendLine(lines, 'fromKey', log.fromKey);
    appendLine(lines, 'toKey', log.toKey);
    appendLine(lines, 'decision', log.decision);
    appendLine(lines, 'reason', log.reason);
    appendLine(lines, 'durationMs', log.durationMs);

    if (log.before != null) lines.push(`before: ${toInlineJson(log.before)}`);
    if (log.after != null) lines.push(`after: ${toInlineJson(log.after)}`);
    if (log.args != null) lines.push(`args: ${toInlineJson(log.args)}`);
    if (log.result != null) lines.push(`result: ${toInlineJson(log.result)}`);
    if (log.patch != null) lines.push(`patch: ${toInlineJson(log.patch)}`);
    if (log.payload != null) lines.push(`payload: ${toInlineJson(log.payload)}`);

    lines.push('');
  });

  return lines.join('\n');
}

function serializeTraceSummary(logs: AppTraceRecord[]) {
  const compactLogs = logs.map(compactTraceRecord);
  const byCategory = countBy(compactLogs, 'category');
  const byEventType = countBy(compactLogs, 'eventType');
  const errors = compactLogs.filter((log) => log.level === 'error' || log.category === 'ERROR');
  const ignored = compactLogs.filter((log) => String(log.category || '').includes('IGNORED') || log.decision === 'ignored');

  const hpChanges = compactLogs
    .filter((log) => JSON.stringify([log.before, log.after, log.patch]).toLowerCase().includes('hp'))
    .slice(-40);

  const lines = [
    '=== APP TRACE SUMMARY ===',
    `ExportedAt: ${new Date().toISOString()}`,
    `TotalLogs: ${logs.length}`,
    '',
    '--- By Category ---',
    JSON.stringify(byCategory, null, 2),
    '',
    '--- By EventType ---',
    JSON.stringify(byEventType, null, 2),
    '',
    `Errors: ${errors.length}`,
    `Ignored/Skipped: ${ignored.length}`,
    '',
    '--- Last HP related logs ---',
    ...hpChanges.map((log) => (
      `[${formatTime(Number(log.timestampMs || Date.now()))}] ${log.category}/${log.action} ${log.message || ''} before=${toInlineJson(log.before)} after=${toInlineJson(log.after)} patch=${toInlineJson(log.patch)} reason=${log.reason || ''}`
    )),
    '',
    '--- Errors ---',
    ...errors.slice(-30).map((log) => toInlineJson(log)),
    '',
    '--- Ignored/Skipped ---',
    ...ignored.slice(-30).map((log) => toInlineJson(log)),
  ];

  return lines.join('\n');
}

function compactTraceRecord(record: AppTraceRecord): Partial<AppTraceRecord> {
  const compact: Partial<AppTraceRecord> = {
    id: record.id,
    timestamp: record.timestamp,
    timestampMs: record.timestampMs,
    level: record.level,
    category: record.category,
    action: record.action,
    screen: record.screen,
    source: record.source,
    functionName: record.functionName,
    message: record.message,
    sessionId: record.sessionId,
    characterId: record.characterId,
    characterName: record.characterName,
    playerId: record.playerId,
    playerName: record.playerName,
    playerKey: record.playerKey,
    eventId: record.eventId,
    eventType: record.eventType,
    envelopeType: record.envelopeType,
    seq: record.seq,
    serverSeq: record.serverSeq,
    entityType: record.entityType,
    entityId: record.entityId,
    entityRevision: record.entityRevision,
    fromKey: record.fromKey,
    toKey: record.toKey,
    before: simplifyValue(record.before),
    after: simplifyValue(record.after),
    args: simplifyValue(record.args),
    result: simplifyValue(record.result),
    patch: simplifyValue(record.patch),
    payload: simplifyValue(record.payload, 0, true),
    decision: record.decision,
    reason: record.reason,
    durationMs: record.durationMs,
    tags: record.tags,
  };

  Object.keys(compact).forEach((key) => {
    if ((compact as Record<string, unknown>)[key] == null) {
      delete (compact as Record<string, unknown>)[key];
    }
  });

  return compact;
}

function simplifyValue(value: unknown, depth = 0, aggressive = false): unknown {
  if (value == null) return value;

  if (typeof value === 'string') {
    const limit = aggressive ? 500 : 1800;
    return value.length > limit ? `${value.slice(0, limit)}... [truncated ${value.length - limit} chars]` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const limit = aggressive ? 8 : 25;
    const sliced = value.slice(0, limit).map((item) => simplifyValue(item, depth + 1, aggressive));
    if (value.length > limit) {
      sliced.push(`[truncated ${value.length - limit} items]`);
    }
    return sliced;
  }

  if (typeof value === 'object') {
    if (depth >= (aggressive ? 2 : 4)) return '[object truncated]';

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys = Object.keys(source);
    const limit = aggressive ? 25 : 60;

    keys.slice(0, limit).forEach((key) => {
      if (aggressive && ['catalog', 'state', 'payload', 'events'].includes(key)) {
        result[key] = `[${key} truncated]`;
        return;
      }

      result[key] = simplifyValue(source[key], depth + 1, aggressive);
    });

    if (keys.length > limit) {
      result.__truncatedKeys = keys.length - limit;
    }

    return result;
  }

  return String(value);
}

function safeClone<T>(value: T): T {
  return simplifyValue(value, 0, false) as T;
}

function countBy(logs: Array<Partial<AppTraceRecord>>, key: keyof AppTraceRecord) {
  return logs.reduce<Record<string, number>>((acc, log) => {
    const value = String(log[key] || 'empty');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value == null || value === '') return;
  lines.push(`${label}: ${String(value)}`);
}

function joinLabel(id: unknown, name: unknown) {
  if (id == null && !name) return '';
  return [id, name].filter(Boolean).join(' - ');
}

function toInlineJson(value: unknown) {
  if (value == null) return '';
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(simplifyValue(value));
    return json.length > 900 ? `${json.slice(0, 900)}...` : json;
  } catch {
    return String(value);
  }
}

function formatTime(timestampMs: number) {
  const date = new Date(timestampMs || Date.now());
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatSeq(item: AppTraceRecord) {
  const seq = item.seq ?? item.serverSeq;
  const revision = item.entityRevision;
  if (seq == null && revision == null) return '';
  return [`seq ${seq ?? '-'}`, `rev ${revision ?? '-'}`].join(' / ');
}

function formatBeforeAfter(item: AppTraceRecord) {
  if (item.before == null && item.after == null) return '';
  return `${shortJson(item.before)} -> ${shortJson(item.after)}`;
}

function shortJson(value: unknown) {
  if (value == null) return 'null';
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return json.length > 180 ? `${json.slice(0, 180)}...` : json;
}

function levelStyle(level: AppTraceRecord['level']) {
  if (level === 'error') return styles.levelError;
  if (level === 'warn') return styles.levelWarn;
  if (level === 'debug') return styles.levelDebug;
  return styles.levelInfo;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 46,
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: {
    flex: 1,
  },
  title: {
    color: appColors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: TRACE_TEXT_SECONDARY,
    marginTop: 2,
  },
  controlsScroll: {
    maxHeight: 205,
    marginBottom: 10,
  },
  sectionTitle: {
    color: appColors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 6,
    marginBottom: 6,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  toolbarButton: {
    borderWidth: 1,
    borderColor: TRACE_BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  toolbarButtonDanger: {
    borderColor: appColors.danger,
  },
  toolbarButtonText: {
    color: appColors.textPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  toolbarButtonTextDanger: {
    color: appColors.danger,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: TRACE_BORDER,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: appColors.textPrimary,
    backgroundColor: 'rgba(0,0,0,0.22)',
    marginBottom: 8,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: TRACE_BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  filterChipActive: {
    borderColor: appColors.primary,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  filterChipText: {
    color: TRACE_TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: appColors.textPrimary,
  },
  listContent: {
    paddingBottom: 28,
  },
  logItem: {
    borderWidth: 1,
    borderColor: TRACE_BORDER,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  levelText: {
    fontSize: 11,
    fontWeight: '900',
  },
  levelInfo: {
    color: appColors.success,
  },
  levelDebug: {
    color: appColors.primary,
  },
  levelWarn: {
    color: appColors.warning,
  },
  levelError: {
    color: appColors.danger,
  },
  timeText: {
    color: TRACE_TEXT_SECONDARY,
    fontSize: 11,
  },
  seqText: {
    marginLeft: 'auto',
    color: TRACE_TEXT_SECONDARY,
    fontSize: 11,
  },
  logTitle: {
    color: appColors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  logMeta: {
    color: TRACE_TEXT_SECONDARY,
    marginTop: 3,
    fontSize: 12,
  },
  beforeAfter: {
    color: appColors.warning,
    marginTop: 4,
    fontSize: 11,
  },
  emptyText: {
    color: TRACE_TEXT_SECONDARY,
    textAlign: 'center',
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    maxHeight: '86%',
    borderWidth: 1,
    borderColor: TRACE_BORDER,
    borderRadius: 8,
    backgroundColor: '#111827',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: TRACE_BORDER,
  },
  modalToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: TRACE_BORDER,
  },
  modalTitle: {
    color: appColors.textPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  modalBody: {
    padding: 12,
  },
  jsonText: {
    color: appColors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
});