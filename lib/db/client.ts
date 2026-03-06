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

// Track whether the current .query() call is coming from queryWithRetry
// (which has its own TIMING log). If so, skip the DIRECT log to avoid noise.
let _inQueryWithRetry = false;

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    if (prop === 'query') {
      const actualPool = getPool();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return function poolQueryProxy(...args: any[]) {
        if (_inQueryWithRetry) {
          // Already logged by queryWithRetry's TIMING log — no double-logging
          return (actualPool as unknown as Record<string, (...a: unknown[]) => unknown>).query(...args);
        }
        // #region agent log
        const t0 = Date.now();
        const preview = (typeof args[0] === 'string' ? args[0] : ((args[0] as QueryConfig)?.text ?? '')).trim().slice(0, 70).replace(/\s+/g, ' ');
        const p2 = actualPool as unknown as { totalCount: number; idleCount: number; waitingCount: number };
        const result = (actualPool as unknown as Record<string, (...a: unknown[]) => unknown>).query(...args) as Promise<import('pg').QueryResult>;
        result.then(() => {
          const dur = Date.now() - t0;
          const state = `total=${p2.totalCount}, idle=${p2.idleCount}, waiting=${p2.waitingCount}`;
          log.db(`[DBG-01a8b2 DIRECT] direct pool.query OK in ${dur}ms | pool: ${state} — ${preview}`);
          fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:pool.query.proxy',message:'direct pool.query OK',data:{durationMs:dur,pool:{total:p2.totalCount,idle:p2.idleCount,waiting:p2.waitingCount},preview},timestamp:Date.now(),runId:'post-fix-v3',hypothesisId:'DIRECT'})}).catch(()=>{});
        }).catch((err: Error) => {
          log.db(`[DBG-01a8b2 DIRECT] direct pool.query FAIL in ${Date.now()-t0}ms — ${preview}: ${err.message?.slice(0,80)}`);
        });
        return result;
        // #endregion
      };
    }
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
    // #region agent log
    const _qt0 = Date.now();
    const _qpreview = (typeof text === 'string' ? text : (text as QueryConfig).text ?? '').trim().slice(0, 60).replace(/\s+/g, ' ');
    // #endregion
    try {
      _inQueryWithRetry = true;
      let result: import('pg').QueryResult<T>;
      try {
        result = values != null
          ? await pool.query<T>(text as string, values)
          : await pool.query<T>(text as string);
      } finally {
        _inQueryWithRetry = false;
      }
      // #region agent log
      const _qDur = Date.now()-_qt0;
      log.db(`[DBG-01a8b2 TIMING] query OK in ${_qDur}ms | pool: total=${getPool().totalCount}, idle=${getPool().idleCount}, waiting=${getPool().waitingCount} — ${_qpreview}`);
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:queryWithRetry',message:'query OK',data:{durationMs:_qDur,pool:{total:getPool().totalCount,idle:getPool().idleCount,waiting:getPool().waitingCount},preview:_qpreview},timestamp:Date.now(),runId:'post-fix-v2',hypothesisId:'TIMING'})}).catch(()=>{});
      // #endregion
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : '';
      const isAcquireTimeout =
        msg.includes('timeout exceeded when trying to connect') ||
        msg.includes('Connection terminated due to connection timeout');
      const isQueryTimeout = msg.includes('Query read timeout');
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
      if (isQueryTimeout) {
        const p = getPool();
        const poolState = { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount };
        log.db(`[DBG-01a8b2 POST-FIX] query_timeout fired (30s) — pool state: ${JSON.stringify(poolState)}`);
        fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'client.ts:queryWithRetry',message:'query_timeout fired',data:{poolState,msg:msg.slice(0,120)},timestamp:Date.now(),hypothesisId:'POST-FIX'})}).catch(()=>{});
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
