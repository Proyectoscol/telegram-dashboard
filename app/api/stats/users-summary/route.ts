import { NextRequest, NextResponse } from 'next/server';
import { parseChatIds } from '@/lib/api/chat-params';
import { getUsersSummaryData } from '@/lib/data/users-summary';
import { withConcurrencyLimit } from '@/lib/concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const USERS_SUMMARY_ROUTE_CONCURRENCY = 2;

export async function GET(request: NextRequest) {
  return withConcurrencyLimit('api:stats/users-summary', USERS_SUMMARY_ROUTE_CONCURRENCY, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const chatIds = parseChatIds(searchParams);
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      const rows = await getUsersSummaryData(chatIds ?? undefined, start, end);
      return NextResponse.json(rows);
    } catch (err) {
      const { log } = await import('@/lib/logger');
      log.error('users-summary', 'Users summary failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch users summary' },
        { status: 500 }
      );
    }
  });
}
