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

    const key = cacheKey('period-reactions', {
      start,
      end,
      chatIds: chatIds?.join(',') ?? 'all',
      fromId,
    });
    const cached = await get<{ periodStart: string; periodEnd: string; count: number; recentReactions: unknown[] }>(key);
    if (cached != null) return NextResponse.json(cached);

    await ensureSchema();
    const limits = await getListLimits();
    const params: (string | number | number[])[] = [start, end];
    if (chatIds && chatIds.length > 0) params.push(chatIds);
    if (fromId) params.push(fromId);
    const chatCond = chatIds && chatIds.length > 0 ? 'AND r.chat_id = ANY($3::bigint[])' : '';
    const fromCond = fromId ? (chatIds && chatIds.length > 0 ? 'AND r.reactor_from_id = $4' : 'AND r.reactor_from_id = $3') : '';

    const countRes = await queryWithRetry(
      `SELECT COUNT(*)::int AS c FROM reactions r
       WHERE r.reacted_at IS NOT NULL AND r.reacted_at >= $1::timestamptz AND r.reacted_at < $2::timestamptz ${chatCond} ${fromCond}`,
      params
    );
    const count = countRes.rows[0]?.c ?? 0;

    const listRes = await queryWithRetry(
      `SELECT r.reacted_at, r.reactor_from_id, u.display_name AS reactor_name, r.emoji,
              m.date AS message_date, m.from_id AS message_author_id, mu.display_name AS message_author_name, LEFT(m.text, 300) AS message_text
       FROM reactions r
       JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id AND m.type = 'message'
       LEFT JOIN users u ON u.from_id = r.reactor_from_id
       LEFT JOIN users mu ON mu.from_id = m.from_id
       WHERE r.reacted_at IS NOT NULL AND r.reacted_at >= $1::timestamptz AND r.reacted_at < $2::timestamptz ${chatCond} ${fromCond}
       ORDER BY r.reacted_at ASC
       LIMIT ${Math.min(limits.periodDetail * 2, 500)}`,
      params
    );

    const body = {
      periodStart: start,
      periodEnd: end,
      count,
      recentReactions: listRes.rows.map((r) => ({
        reacted_at: r.reacted_at,
        reactor_from_id: r.reactor_from_id,
        reactor_name: r.reactor_name,
        emoji: r.emoji,
        message_date: r.message_date,
        message_author_id: r.message_author_id,
        message_author_name: r.message_author_name,
        message_text: r.message_text,
      })),
    };
    const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
    await set(key, body, cacheTtlMs);
    return NextResponse.json(body);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('period-reactions', 'Period reactions failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch period reactions' },
      { status: 500 }
    );
  }
}
