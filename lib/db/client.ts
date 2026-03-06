import { Pool, QueryResultRow, QueryConfig } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from '@/lib/logger';

let _pool: Pool | null = null;

/**
 * Fixed pool sizing for Supabase Session Pooler: 5 connections, 15s connect timeout.
 * Use Session Pooler (port 5432) for persistent Docker containers — Transaction
 * Pooler (port 6543) is often blocked by hosting providers on outbound traffic.
 * No env overrides — avoids configuration drift and connection exhaustion.
 */
// Keep pool small: Supabase free tier slows sharply with > 3-5 concurrent queries.
// With fast queries (86-756ms observed) and pg-pool queuing, 5 connections serve
// concurrent bursts well within the 40s acquire timeout.
const POOL_MAX = 5;
// CONNECTION_TIMEOUT_MS must be > QUERY_TIMEOUT_MS so a waiting request outlives a hung query.
const CONNECTION_TIMEOUT_MS = 40000;
const IDLE_TIMEOUT_MS = 30000;
// Client-side timeout applied per-query by the pg driver (no race with pool.on('connect')).
// When this fires, the pg client terminates the TCP connection so the connection is removed
// from the pool and a new one is created, preventing indefinite pool exhaustion.
const QUERY_TIMEOUT_MS = 30000;

function isPoolerConnection(host: string, port: string): boolean {
  return host.includes('pooler.supabase.com') || port === '6543';
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT ?? '5432';
  const db = process.env.POSTGRES_DB ?? 'postgres';
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  if (host && user && password != null) {
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    const pooler = isPoolerConnection(host, port);
    const params = pooler
      ? 'pgbouncer=true&connect_timeout=30'
      : 'connect_timeout=30';
    return `postgres://${encodedUser}:${encodedPassword}@${host}:${port}/${db}?${params}`;
  }
  throw new Error('DATABASE_URL or (POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD) required');
}

function detectIsSupabasePooler(): boolean {
  if (process.env.DATABASE_URL) {
    const u = process.env.DATABASE_URL;
    return u.includes('pgbouncer=true') || u.includes('pooler.supabase.com');
  }
  const host = process.env.POSTGRES_HOST ?? '';
  const port = process.env.POSTGRES_PORT ?? '5432';
  return !!host && isPoolerConnection(host, port);
}

function buildPool(): Pool {
  const connectionString = getConnectionString();
  const isSupabasePooler = detectIsSupabasePooler();
  const sslOption = isSupabasePooler
    ? { rejectUnauthorized: false }
    : undefined;

  const poolOptions: import('pg').PoolConfig = {
    connectionString,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // Client-side per-query timeout. When it fires, pg terminates the TCP connection so
    // the hung connection is removed from the pool (pg-pool opens a replacement).
    // This is the only reliable way to enforce a query limit on Supabase Session Pooler —
    // pool.on('connect') SET commands race with the first query and are ignored (pg deprecation).
    query_timeout: QUERY_TIMEOUT_MS,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // Recycle connections after 10 minutes to prevent stale accumulation.
    // Without this, connections established during peak load are never removed
    // since periodic usage (e.g. settings queries every 2 min) keeps resetting
    // the 30s idle timer, letting the pool stay at max indefinitely.
    maxLifetimeSeconds: 600,
    ...(sslOption && { ssl: sslOption }),
  };

  const p = new Pool(poolOptions);

  p.on('error', (err) => {
    log.db('Pool idle-client error (pg.Pool will replace the client automatically).', err);
  });

  return p;
}

function getPool(): Pool {
  if (_pool) return _pool;
  _pool = buildPool();
  return _pool;
}

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return (getPool() as unknown as Record<string, unknown>)[prop as string];
  },
});

/**
 * Run a query with one retry on transient connection errors.
 * Does not retry on acquire timeout (fail fast).
 */
export async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  text: string | QueryConfig,
  values?: unknown[],
  maxRetries = 1
): Promise<import('pg').QueryResult<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = values != null
        ? await pool.query<T>(text as string, values)
        : await pool.query<T>(text as string);
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      const isAcquireTimeout =
        msg.includes('timeout exceeded when trying to connect') ||
        msg.includes('Connection terminated due to connection timeout');
      if (isAcquireTimeout) {
        const p = getPool();
        const textPreview =
          typeof text === 'string'
            ? text.replace(/\s+/g, ' ').slice(0, 120)
            : String(text?.text ?? '').replace(/\s+/g, ' ').slice(0, 120);
        // #region agent log
        fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId:'db-acquire-timeout',hypothesisId:'H2',location:'lib/db/client.ts:131',message:'queryWithRetry acquire timeout',data:{poolTotal:p.totalCount,poolIdle:p.idleCount,poolWaiting:p.waitingCount,attempt,textPreview},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      const isRetryable =
        !isAcquireTimeout &&
        (msg.includes('timeout') ||
          msg.includes('Connection terminated') ||
          msg.includes('ECONNRESET') ||
          msg.includes('EPIPE'));
      if (isRetryable && attempt < maxRetries) {
        const delayMs = 400 * (attempt + 1);
        log.db(`queryWithRetry: attempt ${attempt + 1} failed (${msg.slice(0, 80)}), retrying in ${delayMs}ms…`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const EXPECTED_TABLES = [
  'chats',
  'users',
  'messages',
  'reactions',
  'import_batches',
  'contact_calls',
  'settings',
  'contact_personas',
  'ai_usage_logs',
  'day_insights',
] as const;

export async function validateSchema(): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [[...EXPECTED_TABLES]]
  );
  const found = new Set(result.rows.map((r) => r.tablename));
  return [...EXPECTED_TABLES].filter((t) => !found.has(t));
}

let schemaPromise: Promise<void> | null = null;
let rlsPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const schemaPath = join(process.cwd(), 'lib', 'db', 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf-8');
    try {
      await pool.query(sql);
    } catch (schemaErr) {
      throw schemaErr;
    }
    if (process.env.SUPABASE_URL) {
      await ensureSupabaseRLS();
    }
  })();
  return schemaPromise;
}

export async function ensureSupabaseRLS(): Promise<void> {
  if (rlsPromise) return rlsPromise;
  rlsPromise = (async () => {
    const rlsPath = join(process.cwd(), 'lib', 'db', 'schema-supabase-rls.sql');
    const sql = readFileSync(rlsPath, 'utf-8');
    await pool.query(sql);
  })();
  return rlsPromise;
}
