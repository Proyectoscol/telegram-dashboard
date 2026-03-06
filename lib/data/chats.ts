import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getOrFetch, cacheKey } from '@/lib/cache';

const CHATS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Returns chats array. Uses cache; falls back to one DB query. */
export async function getChatsData(): Promise<unknown[]> {
  const key = cacheKey('chats', {});
  return getOrFetch<unknown[]>(key, async () => {
    await ensureSchema();
    const { rows } = await queryWithRetry(
      'SELECT id, name, type, slug, created_at FROM chats ORDER BY slug'
    );
    return rows;
  }, CHATS_CACHE_TTL_MS);
}
