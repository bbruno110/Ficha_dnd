import { SQLiteDatabase } from 'expo-sqlite';

export type TraceLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type TraceLog = {
  id: number;
  level: TraceLogLevel;
  category: string;
  action: string;
  function_name?: string | null;
  source_file?: string | null;
  step?: string | null;
  request_id?: string | null;
  duration_ms?: number | null;
  entity_table?: string | null;
  entity_id?: string | null;
  message: string;
  metadata?: string | null;
  created_at: string;
};

export type TraceSummary = {
  entity_table: string;
  action: string;
  total: number;
};

export type TraceExportAppInfo = {
  version: string;
  build: string;
  platform?: string | null;
  applicationId?: string | null;
};

type TraceInput = {
  level?: TraceLogLevel;
  category?: string;
  action: string;
  functionName?: string | null;
  sourceFile?: string | null;
  step?: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  entityTable?: string | null;
  entityId?: string | number | null;
  message: string;
  metadata?: Record<string, unknown> | unknown[] | null;
};

function safeJson(value: unknown) {
  if (value === undefined || value === null) return null;
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === 'bigint') return currentValue.toString();
        if (typeof currentValue === 'function') return `[Function ${currentValue.name || 'anonymous'}]`;
        if (currentValue instanceof Error) {
          return {
            name: currentValue.name,
            message: currentValue.message,
            stack: currentValue.stack,
          };
        }
        if (typeof currentValue === 'object' && currentValue !== null) {
          if (seen.has(currentValue)) return '[Circular]';
          seen.add(currentValue);
        }
        return currentValue;
      },
      2
    );
  } catch (error) {
    return JSON.stringify({ stringifyError: String(error), rawType: typeof value });
  }
}

function compactText(value?: string | null) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

export async function addTraceLog(db: SQLiteDatabase, input: TraceInput) {
  await db.runAsync(
    `INSERT INTO app_trace_logs (
       level, category, action, function_name, source_file, step, request_id, duration_ms,
       entity_table, entity_id, message, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.level || 'debug',
      input.category || 'app',
      input.action,
      input.functionName || null,
      input.sourceFile || null,
      input.step || null,
      input.requestId || null,
      input.durationMs === undefined || input.durationMs === null ? null : Math.round(Number(input.durationMs)),
      input.entityTable || null,
      input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
      input.message,
      safeJson(input.metadata),
    ]
  );
}

export async function addFunctionTraceLog(
  db: SQLiteDatabase,
  input: Omit<TraceInput, 'category'> & {
    category?: string;
    used?: Record<string, unknown> | unknown[] | null;
    payload?: Record<string, unknown> | unknown[] | null;
    result?: Record<string, unknown> | unknown[] | null;
    error?: unknown;
  }
) {
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
    ...(input.used ? { used: input.used } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.error ? { error: input.error } : {}),
  };

  await addTraceLog(db, {
    ...input,
    category: input.category || 'debug',
    metadata,
  });
}

export async function getTraceLogs(
  db: SQLiteDatabase,
  options: {
    query?: string;
    action?: string;
    entityTable?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.query?.trim()) {
    const search = `%${options.query.trim()}%`;
    where.push(
      `(message LIKE ? OR entity_table LIKE ? OR entity_id LIKE ? OR action LIKE ? OR category LIKE ? OR metadata LIKE ? OR function_name LIKE ? OR source_file LIKE ? OR step LIKE ? OR request_id LIKE ?)`
    );
    params.push(search, search, search, search, search, search, search, search, search, search);
  }

  if (options.action && options.action !== 'Todos') {
    where.push(`action = ?`);
    params.push(options.action);
  }

  if (options.entityTable && options.entityTable !== 'Todas') {
    where.push(`entity_table = ?`);
    params.push(options.entityTable);
  }

  const limitCap = options.limit && options.limit > 200 ? 10000 : 200;
  const limit = Math.min(limitCap, Math.max(1, options.limit || 100));
  const offset = Math.max(0, options.offset || 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db.getAllAsync<TraceLog>(
    `SELECT * FROM app_trace_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function getTraceExportLogs(
  db: SQLiteDatabase,
  options: {
    query?: string;
    action?: string;
    entityTable?: string;
    maxRows?: number;
  } = {}
) {
  return getTraceLogs(db, {
    query: options.query,
    action: options.action,
    entityTable: options.entityTable,
    limit: Math.min(10000, Math.max(1, options.maxRows || 5000)),
    offset: 0,
  });
}

export function formatTraceLogsAsTxt(
  logs: TraceLog[],
  generatedAt = new Date(),
  appInfo?: TraceExportAppInfo
) {
  const lines: string[] = [];
  lines.push('FICHA D&D - TRACER / DEBUG EXPORT');
  lines.push(`Gerado em: ${generatedAt.toLocaleString()}`);
  if (appInfo) {
    lines.push(`Versao do app: ${appInfo.version}`);
    lines.push(`Build: ${appInfo.build}`);
    if (appInfo.platform) lines.push(`Plataforma: ${appInfo.platform}`);
    if (appInfo.applicationId) lines.push(`Pacote: ${appInfo.applicationId}`);
  }
  lines.push(`Total exportado: ${logs.length}`);
  lines.push('='.repeat(90));

  logs.forEach((log, index) => {
    lines.push('');
    lines.push(`#${index + 1} | DB_ID=${log.id} | ${log.created_at}`);
    lines.push(`LEVEL: ${String(log.level || '').toUpperCase()} | CATEGORY: ${log.category || 'app'} | ACTION: ${log.action}`);
    if (log.function_name || log.step) lines.push(`FUNCTION: ${log.function_name || '-'} | STEP: ${log.step || '-'}`);
    if (log.source_file) lines.push(`SOURCE: ${log.source_file}`);
    if (log.request_id) lines.push(`REQUEST_ID: ${log.request_id}`);
    if (log.duration_ms !== undefined && log.duration_ms !== null) lines.push(`DURATION_MS: ${log.duration_ms}`);
    if (log.entity_table || log.entity_id) lines.push(`ENTITY: ${log.entity_table || '-'}${log.entity_id ? ` #${log.entity_id}` : ''}`);
    lines.push(`MESSAGE: ${log.message}`);

    const metadata = compactText(log.metadata);
    if (metadata) {
      lines.push('METADATA:');
      try {
        lines.push(JSON.stringify(JSON.parse(log.metadata || '{}'), null, 2));
      } catch {
        lines.push(log.metadata || '');
      }
    }
    lines.push('-'.repeat(90));
  });

  return lines.join('\n');
}

export async function getTraceSummaries(db: SQLiteDatabase) {
  return db.getAllAsync<TraceSummary>(
    `SELECT IFNULL(entity_table, IFNULL(function_name, 'app')) as entity_table, action, COUNT(*) as total
     FROM app_trace_logs
     GROUP BY IFNULL(entity_table, IFNULL(function_name, 'app')), action
     ORDER BY total DESC, entity_table ASC`
  );
}

export async function getTraceTables(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ entity_table: string }>(
    `SELECT DISTINCT entity_table
     FROM app_trace_logs
     WHERE entity_table IS NOT NULL AND entity_table <> ''
     ORDER BY entity_table ASC`
  );
  return rows.map(row => row.entity_table);
}

export async function clearTraceLogs(db: SQLiteDatabase) {
  await db.runAsync(`DELETE FROM app_trace_logs`);
}
