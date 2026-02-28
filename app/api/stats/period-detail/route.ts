import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const chatId = searchParams.get('chatId');
    const fromId = searchParams.get('fromId');
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (ISO date) required' }, { status: 400 });
    }

    const params: (string | number)[] = [start, end];
    if (chatId) params.push(chatId);
    if (fromId) params.push(fromId);
    const chatCond = chatId ? 'AND m.chat_id = $3' : '';
    const fromCond = fromId ? (chatId ? 'AND m.from_id = $4' : 'AND m.from_id = $3') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages m
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${fromCond}`,
      params
    );
    const count = countRes.rows[0]?.c ?? 0;

    const byUserRes = await pool.query(
      `SELECT m.from_id, u.display_name, COUNT(*)::int AS count
       FROM messages m
       LEFT JOIN users u ON u.from_id = m.from_id
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz AND m.from_id IS NOT NULL ${chatCond} ${fromCond}
       GROUP BY m.from_id, u.display_name ORDER BY count DESC LIMIT 20`,
      params
    );

    const recentRes = await pool.query(
      `SELECT m.date, m.from_id, u.display_name, LEFT(m.text, 200) AS text
       FROM messages m
       LEFT JOIN users u ON u.from_id = m.from_id
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${fromCond}
       ORDER BY m.date DESC LIMIT 50`,
      params
    );

    return NextResponse.json({
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
    });
  } catch (err) {
    console.error('period-detail error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch period detail' },
      { status: 500 }
    );
  }
}
