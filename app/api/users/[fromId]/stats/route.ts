import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

type GroupBy = 'day' | 'week' | 'month';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const { searchParams } = new URL(request.url);
    const groupBy: GroupBy = (searchParams.get('groupBy') as GroupBy) || 'day';
    const chatId = searchParams.get('chatId');

    const periodExpr =
      groupBy === 'month'
        ? "date_trunc('month', m.date)"
        : groupBy === 'week'
          ? "date_trunc('week', m.date)"
          : "date_trunc('day', m.date)";
    const mParams: (string | number)[] = [fromId];
    const mConds = ["m.from_id = $1", "m.type = 'message'"];
    if (chatId) {
      mParams.push(chatId);
      mConds.push(`m.chat_id = $${mParams.length}`);
    }
    const messagesResult = await pool.query(
      `SELECT ${periodExpr} AS period, COUNT(*)::int AS count FROM messages m WHERE ${mConds.join(' AND ')} GROUP BY 1 ORDER BY 1`,
      mParams
    );

    const rPeriodExpr =
      groupBy === 'month'
        ? "date_trunc('month', r.reacted_at)"
        : groupBy === 'week'
          ? "date_trunc('week', r.reacted_at)"
          : "date_trunc('day', r.reacted_at)";
    const rParams: (string | number)[] = [fromId];
    const rConds = ['r.reactor_from_id = $1'];
    if (chatId) {
      rParams.push(chatId);
      rConds.push(`r.chat_id = $${rParams.length}`);
    }
    const reactionsResult = await pool.query(
      `SELECT ${rPeriodExpr} AS period, COUNT(*)::int AS count FROM reactions r WHERE ${rConds.join(' AND ')} GROUP BY 1 ORDER BY 1`,
      rParams
    );

    return NextResponse.json({
      messagesOverTime: messagesResult.rows.map((r) => ({ period: r.period, count: r.count })),
      reactionsOverTime: reactionsResult.rows.map((r) => ({ period: r.period, count: r.count })),
    });
  } catch (err) {
    console.error('user stats error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch user stats' },
      { status: 500 }
    );
  }
}
