import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { parseChatIds } from '@/lib/api/chat-params';
import { getOverviewData } from '@/lib/data/overview';
import { withConcurrencyLimit } from '@/lib/concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const OVERVIEW_ROUTE_CONCURRENCY = 2;

export async function GET(request: NextRequest) {
  return withConcurrencyLimit('api:stats/overview', OVERVIEW_ROUTE_CONCURRENCY, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const chatIds = parseChatIds(searchParams);
      const fromId = searchParams.get('fromId');
      const groupBy = (searchParams.get('groupBy') as 'day' | 'week' | 'month') || 'day';
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      const byChat = searchParams.get('byChat') === '1';
      const body = await getOverviewData({ groupBy, chatIds, fromId, start, end, byChat });
      return NextResponse.json(body);
    } catch (err) {
      log.error('stats/overview', 'Overview stats failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch stats' },
        { status: 500 }
      );
    }
  });
}
