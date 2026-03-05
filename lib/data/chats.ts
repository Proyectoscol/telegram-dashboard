import { ensureSchema, pool } from '@/lib/db/client';
import { get, set, cacheKey } from '@/lib/cache';

const CHATS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Returns chats array. Uses cache; falls back to one DB query. */
export async function getChatsData(): Promise<unknown[]> {
  const key = cacheKey('chats', {});
  const cached = await get<unknown[]>(key);
  if (cached != null) return cached;
  await ensureSchema();
  const { rows } = await pool.query(
    'SELECT id, name, type, slug, created_at FROM chats ORDER BY slug'
  );
  await set(key, rows, CHATS_CACHE_TTL_MS);
  return rows;
}
