import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { get, set, cacheKey } from '@/lib/cache';
import { getListLimits, getCacheTtlStatsMinutes } from '@/lib/settings';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const chatIds = parseChatIds(searchParams);
    const fromId = searchParams.get('fromId') ?? '';
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (ISO date) required' }, { status: 400 });
    }

    const key = cacheKey('period-detail', {
      start,
      end,
      chatIds: chatIds?.join(',') ?? 'all',
      fromId,
    });
    const cached = await get<{ periodStart: string; periodEnd: string; count: number; byUser: unknown[]; recentMessages: unknown[] }>(key);
    if (cached != null) return NextResponse.json(cached);

    await ensureSchema();
    const limits = await getListLimits();
    const params: (string | number | number[])[] = [start, end];
    if (chatIds && chatIds.length > 0) params.push(chatIds);
    if (fromId) params.push(fromId);
    const chatCond = chatIds && chatIds.length > 0 ? 'AND m.chat_id = ANY($3::bigint[])' : '';
    const fromCond = fromId ? (chatIds && chatIds.length > 0 ? 'AND m.from_id = $4' : 'AND m.from_id = $3') : '';

    const countRes = await queryWithRetry(
      `SELECT COUNT(*)::int AS c FROM messages m
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${fromCond}`,
      params
    );
    const count = countRes.rows[0]?.c ?? 0;

    const byUserRes = await queryWithRetry(
      `SELECT m.from_id, u.display_name, COUNT(*)::int AS count
       FROM messages m
       LEFT JOIN users u ON u.from_id = m.from_id
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz AND m.from_id IS NOT NULL ${chatCond} ${fromCond}
       GROUP BY m.from_id, u.display_name ORDER BY count DESC LIMIT ${limits.periodDetail}`,
      params
    );

    const recentRes = await queryWithRetry(
      `SELECT m.date, m.from_id, u.display_name, LEFT(m.text, 200) AS text
       FROM messages m
       LEFT JOIN users u ON u.from_id = m.from_id
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${fromCond}
       ORDER BY m.date DESC LIMIT ${limits.periodDetail}`,
      params
    );

    const body = {
      periodStart: start,
      periodEnd: end,
      count,
      byUser: byUserRes.rows.map((r) => ({
        from_id: r.from_id,
        display_name: r.display_name,
        count: r.count,
      })),
      recentMessages: recentRes.rows.map((r) => ({
        date: r.date,
        from_id: r.from_id,
        display_name: r.display_name,
        text: r.text,
      })),
    };
    const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
    await set(key, body, cacheTtlMs);
    return NextResponse.json(body);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('period-detail', 'Period detail failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch period detail' },
      { status: 500 }
    );
  }
}
