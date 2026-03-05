import { ensureSchema, pool } from '@/lib/db/client';
import { getOrFetch, cacheKey } from '@/lib/cache';
import { log } from '@/lib/logger';

const CHATS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Returns chats array. Uses cache; falls back to one DB query. */
export async function getChatsData(): Promise<unknown[]> {
  const key = cacheKey('chats', {});
  return getOrFetch<unknown[]>(key, async () => {
    // #region agent log
    log.db('[DBG-01a8b2 H4] getChatsData: cache miss — calling ensureSchema');
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'chats.ts:getChatsData',message:'cache miss, calling ensureSchema',data:{},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    const t0 = Date.now();
    await ensureSchema();
    // #region agent log
    log.db(`[DBG-01a8b2 H4] getChatsData: ensureSchema done in ${Date.now()-t0}ms — querying chats`);
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',location:'chats.ts:getChatsData',message:'ensureSchema done',data:{ensureSchemaDurationMs:Date.now()-t0},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    const { rows } = await pool.query(
      'SELECT id, name, type, slug, created_at FROM chats ORDER BY slug'
    );
    return rows;
  }, CHATS_CACHE_TTL_MS);
}
