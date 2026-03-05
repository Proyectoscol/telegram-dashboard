import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getListLimits } from '@/lib/settings';
import { getAiUsageData } from '@/lib/data/ai-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ai-usage – list recent ai_usage_logs for token/cost visibility. Uses settings list limit when limit param missing. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const defaultLimit = (await getListLimits()).aiUsage;
    const limit = limitParam != null
      ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || defaultLimit))
      : defaultLimit;
    const data = await getAiUsageData(limit);
    return NextResponse.json(data);
  } catch (err) {
    log.error('ai-usage', 'GET ai-usage failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load AI usage' },
      { status: 500 }
    );
  }
}
