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
const POOL_MAX = 5;
// Acquire timeout must be > STATEMENT_TIMEOUT_MS so waiting requests get a freed connection.
const CONNECTION_TIMEOUT_MS = 40000;
const IDLE_TIMEOUT_MS = 30000;
// Applied via pool.on('connect') for ALL connections (including Supabase pooler).
// pool config statement_timeout is ignored by Supabase pooler, so SET via session is required.
const STATEMENT_TIMEOUT_MS = 25000;

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

  // #region agent log
  const maskedUrl = connectionString.replace(/:([^:@/]+)@/, ':***@');
  log.db(`[DBG-01a8b2 H1] buildPool — url: ${maskedUrl} | pooler: ${isSupabasePooler} | max: ${POOL_MAX} | connectTimeoutMs: ${CONNECTION_TIMEOUT_MS}`);
  fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:buildPool',message:'buildPool called',data:{maskedUrl,isSupabasePooler,max:POOL_MAX,connectTimeoutMs:CONNECTION_TIMEOUT_MS},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion

  const poolOptions: import('pg').PoolConfig = {
    connectionString,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ...(sslOption && { ssl: sslOption }),
  };

  const p = new Pool(poolOptions);

  p.on('error', (err) => {
    log.db('Pool idle-client error (pg.Pool will replace the client automatically).', err);
  });

  // Apply statement_timeout for ALL connections via session SET.
  // For Supabase pooler (Session mode), the pool config statement_timeout is not honoured,
  // so we must SET it on the session after each new physical connection is established.
  // This ensures any query that hangs releases its connection within STATEMENT_TIMEOUT_MS,
  // preventing pool exhaustion under concurrent load.
  p.on('connect', (client) => {
    client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`).catch((err: Error) => {
      log.db('Failed to set statement_timeout on new connection (non-fatal)', err);
    });
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
      return values != null
        ? await pool.query<T>(text as string, values)
        : await pool.query<T>(text as string);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      const isAcquireTimeout =
        msg.includes('timeout exceeded when trying to connect') ||
        msg.includes('Connection terminated due to connection timeout');
      const isRetryable =
        !isAcquireTimeout &&
        (msg.includes('timeout') ||
          msg.includes('Connection terminated') ||
          msg.includes('ECONNRESET') ||
          msg.includes('EPIPE'));
      // #region agent log
      if (isAcquireTimeout) {
        const p = getPool();
        const poolState = { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount };
        log.db(`[DBG-01a8b2 H2/H3] queryWithRetry acquire-timeout — pool state: ${JSON.stringify(poolState)}`);
        fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:queryWithRetry',message:'acquire timeout',data:{poolState,msg:msg.slice(0,120)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      }
      // #endregion
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
  // #region agent log
  const alreadyCached = !!schemaPromise;
  const maskedForLog = (() => { try { const cs = getConnectionString(); return cs.replace(/:([^:@/]+)@/,':***@'); } catch { return 'ERROR_BUILDING'; } })();
  log.db(`[DBG-01a8b2 H6/H7/H8] ensureSchema called — cached: ${alreadyCached} | url: ${maskedForLog} | pool: total=${(pool as unknown as {totalCount:number}).totalCount ?? '?'}, idle=${(pool as unknown as {idleCount:number}).idleCount ?? '?'}, waiting=${(pool as unknown as {waitingCount:number}).waitingCount ?? '?'}`);
  fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:ensureSchema',message:'ensureSchema called',data:{alreadyCached,maskedUrl:maskedForLog,total:(pool as any).totalCount,idle:(pool as any).idleCount,waiting:(pool as any).waitingCount},timestamp:Date.now(),hypothesisId:'H8'})}).catch(()=>{});
  // #endregion
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    // #region agent log
    log.db('[DBG-01a8b2 H6] ensureSchema: running migration SQL now');
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:ensureSchema-inner',message:'running migration SQL',data:{},timestamp:Date.now(),hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    const schemaPath = join(process.cwd(), 'lib', 'db', 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf-8');
    try {
      await pool.query(sql);
      // #region agent log
      log.db('[DBG-01a8b2 H6] ensureSchema: migration SQL done');
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:ensureSchema-inner',message:'migration SQL done',data:{},timestamp:Date.now(),hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
    } catch (schemaErr) {
      // #region agent log
      log.db(`[DBG-01a8b2 H6] ensureSchema: migration SQL FAILED — ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`);
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:ensureSchema-inner',message:'migration SQL FAILED',data:{err:schemaErr instanceof Error?schemaErr.message:String(schemaErr)},timestamp:Date.now(),hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
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
