import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getSettingsData } from '@/lib/data/settings';
import { getChatsData } from '@/lib/data/chats';
import { getAiUsageData } from '@/lib/data/ai-usage';
import { withConcurrencyLimit } from '@/lib/concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BOOTSTRAP_SETTINGS_CONCURRENCY = 2;

/**
 * GET /api/bootstrap/settings
 * Returns settings + chats + ai-usage in one sequential request.
 * Uses one DB connection at a time instead of 3 parallel connections,
 * which prevents pool exhaustion when multiple users open Settings simultaneously.
 */
export async function GET() {
  return withConcurrencyLimit('api:bootstrap/settings', BOOTSTRAP_SETTINGS_CONCURRENCY, async () => {
    const runId = `bootstrap-settings-${Math.random().toString(36).slice(2, 8)}`;
    try {
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H5',location:'app/api/bootstrap/settings/route.ts:21',message:'bootstrap/settings start',data:{},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H5] ${runId} settings start`);
      const settings = await getSettingsData();
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H5',location:'app/api/bootstrap/settings/route.ts:24',message:'bootstrap/settings settings done',data:{keys:settings && typeof settings === 'object' ? Object.keys(settings).length : null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H5] ${runId} settings data done keys=${settings && typeof settings === 'object' ? Object.keys(settings).length : 'na'}`);
      const chats = await getChatsData();
      const aiUsage = await getAiUsageData();
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H5',location:'app/api/bootstrap/settings/route.ts:27',message:'bootstrap/settings complete',data:{chatRows:Array.isArray(chats)?chats.length:null,aiUsageRows:aiUsage && typeof aiUsage === 'object' && 'rows' in aiUsage ? Array.isArray((aiUsage as { rows?: unknown[] }).rows) ? (aiUsage as { rows?: unknown[] }).rows?.length ?? null : null : null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H5] ${runId} settings complete chats=${Array.isArray(chats) ? chats.length : 'na'}`);
      return NextResponse.json({ settings, chats, aiUsage });
    } catch (err) {
      log.error('bootstrap/settings', 'GET bootstrap/settings failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to load settings bootstrap' },
        { status: 500 }
      );
    }
  });
}
