# Database connection timeout — fixes and debugging guide

This document describes the fixes applied to resolve **"timeout exceeded when trying to connect"** errors when the Next.js app talks to PostgreSQL (Supabase). Use it for later debugging if the issue reappears or when deploying to other platforms.

---

## Symptom

- **Error:** `timeout exceeded when trying to connect` (from `pg-pool`)
- **Stack:** Fails in `pool.query()` / `queryWithRetry()` when acquiring a connection (e.g. in `/api/bootstrap/dashboard`, `/api/users`, `/api/chats`, user-full, etc.)
- **When:** After some time of use, or when opening the dashboard / changing filters / loading a contact profile. Often after the pool had grown to `max` connections and stayed there.

---

## Root cause (summary)

1. **Uncached settings queries** — Several functions (`getCacheTtlStatsMinutes`, `getListLimits`, `getPersonaLabels`, `getPersonaPrompts`, `getDayInsightPrompts`, and uncached `getAiUsageData`) were calling `pool.query()` directly on **every** request. Those calls were not going through `queryWithRetry`, so they were invisible in normal “query timing” logs.
2. **Connections never released in practice** — Those frequent, unlogged queries kept connections “in use” or reset the idle timer so often that pg-pool’s **idle timeout** (30s) almost never fired. The pool stayed at `total = max` (e.g. 5 or 10) and never shrank.
3. **Pool exhaustion** — When a new burst of requests arrived (e.g. dashboard + users + chats), all connections were busy; the next request waited for a free connection until the **connection acquire timeout** (40s) fired → "timeout exceeded when trying to connect".

So the fix was: **stop hammering the DB with uncached settings/utility reads** and **let the pool shrink when idle**, plus minor pool/config tweaks.

---

## Fixes applied

### 1. Process-level caches (60s) in `lib/settings.ts`

These functions now use in-memory, 60-second TTL caches so they hit the DB at most once per minute instead of on every request:

| Function | Purpose | Before | After |
|----------|---------|--------|--------|
| `getCacheTtlStatsMinutes()` | Stats cache TTL (minutes) | 1 `pool.query()` per stats request | Cached 60s |
| `getListLimits()` | AI usage / messages / period limits | 1 `pool.query()` per call | Cached 60s |
| `getPersonaLabels()` | Persona card labels (UI) | 1 `pool.query()` per user profile load | Cached 60s |
| `getPersonaPrompts()` | Persona system/user prompts | Multiple `pool.query()` per settings load | Cached 60s |
| `getDayInsightPrompts()` | Day insight prompts | Multiple `pool.query()` per settings load | Cached 60s |

Cache variables: `_cacheTtlCache`, `_listLimitsCache`, `_personaLabelsCache`, `_personaPromptsCache`, `_dayInsightPromptsCache`. TTL is 60 seconds so settings changes propagate within a minute.

### 2. Overview and chats: single-flight + retry

- **`lib/data/overview.ts`** — `getOverviewData()` now uses `getOrFetch()` (from `lib/cache.ts`) so concurrent requests for the same overview key share one DB round-trip instead of each running the heavy CTE.
- **`lib/data/chats.ts`** — Chats fetch uses `queryWithRetry()` instead of raw `pool.query()`, and is already behind `getOrFetch()` for single-flight.

### 3. AI usage cached with `getOrFetch` (`lib/data/ai-usage.ts`)

- **Before:** Every bootstrap/settings load ran 4+ `pool.query()` calls (including full table scan on `ai_usage_logs`) with no cache.
- **After:** Wrapped in `getOrFetch('ai-usage:' + limit, fetcher, 60_000)` so result is cached 60s and concurrent requests share one fetch.

### 4. Pool configuration (`lib/db/client.ts`)

- **POOL_MAX = 5** — Keeps concurrent DB load low; with fast queries (~100–700 ms) and single-flight/caching, 5 connections are enough and the pool can drain when idle.
- **maxLifetimeSeconds = 600** — Connections are recycled after 10 minutes so long-lived connections don’t accumulate indefinitely.
- **idleTimeoutMillis = 30000** — Idle connections are removed after 30s so the pool can shrink to 0 when there’s no traffic.
- **connectionTimeoutMillis = 40000** — Time allowed to acquire a connection from the pool before failing (must be &gt; query duration).
- **query_timeout** (pg client) — 30s per-query timeout so a stuck query doesn’t hold a connection forever.

### 5. Cache TTL jitter (`lib/cache.ts`)

In `getOrFetch()`, the TTL passed to `set()` is varied with ±20% jitter so different cache keys don’t all expire at the same time and cause a thundering herd of DB queries.

### 6. Supabase: Session Pooler (port 5432)

The app is intended to use **Session Pooler** (e.g. `aws-0-eu-central-1.pooler.supabase.com:5432`), not Direct or Transaction Pooler on 6543, for Docker/persistent containers. See `.env.example` for recommended `POSTGRES_HOST` / `POSTGRES_PORT`.

---

## If the issue reappears

1. **Check pool usage**  
   Add temporary logs in `queryWithRetry` and/or a pool proxy: on each `pool.query()` (and on acquire timeout), log `totalCount`, `idleCount`, `waitingCount`. If you see `idle=0` and `total=max` for long periods, the pool is not draining.

2. **Find uncached DB callers**  
   Search for `pool.query` outside `lib/db/client.ts`. Any hot path that calls `pool.query()` on every request (or very often) without going through a cache or `getOrFetch` can keep connections busy and prevent the pool from shrinking.

3. **Verify settings caches**  
   Ensure the five functions above still use their 60s process-level caches and that no new callers bypass them (e.g. new “get settings” helpers that call `pool.query` on every request).

4. **Check for new single-flight needs**  
   If a new endpoint runs the same heavy query for the same key from many concurrent requests, wrap it in `getOrFetch(key, fetcher, ttlMs)` so only one request hits the DB and the rest share the result.

5. **Supabase / platform limits**  
   On Supabase free tier, high concurrency or long-running queries can throttle the DB. Keeping POOL_MAX low (5), queries short (and cached), and using Session Pooler reduces the chance of timeouts.

---

## Other platforms

- **Different DB host** — Same fixes apply: avoid uncached per-request `pool.query()` on settings/utility data; use `getOrFetch` for heavy, cacheable reads; keep pool size modest and allow idle timeout to shrink the pool.
- **Serverless (e.g. Vercel)** — Pool is short-lived per invocation; timeouts are more often from cold starts or DB connection limits. Caching (e.g. Redis) and single-flight still help; you may need to rely more on connection pooler (e.g. Supabase Transaction Pooler with port 6543) and lower `POOL_MAX` (e.g. 2).
- **Docker / long-running process** — Current setup (Session Pooler, POOL_MAX=5, idle timeout, maxLifetimeSeconds) is aimed at this. If timeouts come back, re-check that no new code path does uncached `pool.query()` on every request.

---

## Files touched (reference)

| File | Change |
|------|--------|
| `lib/settings.ts` | 60s caches for getCacheTtlStatsMinutes, getListLimits, getPersonaLabels, getPersonaPrompts, getDayInsightPrompts |
| `lib/cache.ts` | TTL jitter in getOrFetch |
| `lib/data/overview.ts` | getOverviewData uses getOrFetch; single-flight for overview |
| `lib/data/chats.ts` | pool.query → queryWithRetry; already uses getOrFetch |
| `lib/data/ai-usage.ts` | getOrFetch wrapper, 60s cache; getListLimits cached in settings |
| `lib/db/client.ts` | POOL_MAX=5, maxLifetimeSeconds=600, connectionTimeoutMillis=40000, idleTimeoutMillis=30000, query_timeout 30s |

No environment variables are required for these fixes; pool limits and timeouts are fixed in code. Optional: `DATABASE_URL` or `POSTGRES_*` for connection; use Session Pooler host/port for Supabase in Docker.
