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
    try {
      const settings = await getSettingsData();
      const chats = await getChatsData();
      const aiUsage = await getAiUsageData();
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
