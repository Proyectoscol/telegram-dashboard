/**
 * Cache layer: Redis when REDIS_URL is set, otherwise in-memory.
 * Key = string, value = JSON-serializable. Entries expire after ttlMs.
 */
import { getRedis } from '@/lib/redis';

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_ENTRIES = 500;

// In-memory fallback when Redis is not configured
const memoryStore = new Map<string, { value: unknown; expiresAt: number }>();

function memoryGet<T>(key: string): T | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value as T;
}

function memoryEvictIfNeeded(): void {
  if (memoryStore.size < MAX_ENTRIES) return;
  const now = Date.now();
  Array.from(memoryStore.entries()).forEach(([k, v]) => {
    if (now > v.expiresAt) memoryStore.delete(k);
  });
  if (memoryStore.size >= MAX_ENTRIES) {
    const toDelete = memoryStore.size - Math.floor(MAX_ENTRIES * 0.8);
    const keys = Array.from(memoryStore.keys());
    for (let i = 0; i < toDelete && i < keys.length; i++) {
      memoryStore.delete(keys[i]);
    }
  }
}

function memorySet(key: string, value: unknown, ttlMs: number): void {
  memoryEvictIfNeeded();
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function get<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return memoryGet<T>(key);
    }
  }
  return memoryGet<T>(key);
}

export async function set(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const ttlSec = Math.max(1, Math.floor(ttlMs / 1000));
      await redis.setex(key, ttlSec, JSON.stringify(value));
      return;
    } catch {
      memorySet(key, value, ttlMs);
      return;
    }
  }
  memorySet(key, value, ttlMs);
}

// ---------------------------------------------------------------------------
// Single-flight request coalescing: prevents thundering-herd on simultaneous
// cache misses. When N callers request the same key at the same time, only
// ONE DB query runs; the others wait for the shared Promise and get the same
// result. Process-local (fine for single-container Next.js deployments).
// ---------------------------------------------------------------------------
const _inflight = new Map<string, Promise<unknown>>();

/**
 * Check cache first; if missing, run fetcher() exactly once even when
 * multiple callers request the same key concurrently (single-flight).
 */
export async function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const cached = await get<T>(key);
  if (cached != null) return cached;

  // Return the in-flight promise if another request is already fetching this key
  const pending = _inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  // First caller: start the fetch and register it so concurrent callers share it
  const p = (async () => {
    const result = await fetcher();
    // Add ±20% jitter so different keys don't all expire at the same clock tick,
    // which would cause a synchronised cache-miss thundering herd after ~2 minutes.
    const effective = ttlMs ?? DEFAULT_TTL_MS;
    const jittered = effective * (0.85 + Math.random() * 0.3);
    await set(key, result, jittered);
    return result;
  })().finally(() => _inflight.delete(key)) as Promise<T>;

  _inflight.set(key, p);
  return p;
}

export function cacheKey(prefix: string, params: Record<string, string | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return `${prefix}:${parts.join('&')}`;
}
