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

export function cacheKey(prefix: string, params: Record<string, string | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return `${prefix}:${parts.join('&')}`;
}
