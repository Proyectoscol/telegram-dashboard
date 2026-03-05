import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getChatsData } from '@/lib/data/chats';
import { getOverviewData } from '@/lib/data/overview';
import { getUsersSummaryData } from '@/lib/data/users-summary';
import { withConcurrencyLimit } from '@/lib/concurrency';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BOOTSTRAP_DASHBOARD_CONCURRENCY = 2;

/**
 * GET /api/bootstrap/dashboard
 * Returns chats + overview (default day/all) + usersSummary in one sequential request.
 * Uses one DB connection at a time instead of 3 parallel connections,
 * which prevents pool exhaustion when multiple users open the Dashboard simultaneously.
 */
export async function GET(request: NextRequest) {
  return withConcurrencyLimit('api:bootstrap/dashboard', BOOTSTRAP_DASHBOARD_CONCURRENCY, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const chatIds = parseChatIds(searchParams);
      const fromId = searchParams.get('fromId');
      const groupBy = (searchParams.get('groupBy') as 'day' | 'week' | 'month') || 'day';
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      const chats = await getChatsData();
      const overview = await getOverviewData({ groupBy, chatIds, fromId, start, end });
      const usersSummary = await getUsersSummaryData(chatIds ?? undefined, start, end);
      return NextResponse.json({ chats, overview, usersSummary });
    } catch (err) {
      log.error('bootstrap/dashboard', 'GET bootstrap/dashboard failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to load dashboard bootstrap' },
        { status: 500 }
      );
    }
  });
}
