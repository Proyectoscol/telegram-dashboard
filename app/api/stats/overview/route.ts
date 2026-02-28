import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

type GroupBy = 'day' | 'week' | 'month';

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');
    const groupBy: GroupBy = (searchParams.get('groupBy') as GroupBy) || 'day';
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    const periodExpr =
      groupBy === 'month'
        ? "date_trunc('month', m.date)"
        : groupBy === 'week'
          ? "date_trunc('week', m.date)"
          : "date_trunc('day', m.date)";

    const mParams: (string | number)[] = [];
    const mConds: string[] = ["m.type = 'message'"];
    if (chatId) {
      mParams.push(chatId);
      mConds.push(`m.chat_id = $${mParams.length}`);
    }
    if (start) {
      mParams.push(start);
      mConds.push(`m.date >= $${mParams.length}::timestamptz`);
    }
    if (end) {
      mParams.push(end);
      mConds.push(`m.date <= $${mParams.length}::timestamptz`);
    }
    const mWhere = mConds.join(' AND ');
    const messagesResult = await pool.query(
      `SELECT ${periodExpr} AS period, COUNT(*)::int AS count FROM messages m WHERE ${mWhere} GROUP BY 1 ORDER BY 1`,
      mParams
    );

    const rPeriodExpr =
      groupBy === 'month'
        ? "date_trunc('month', r.reacted_at)"
        : groupBy === 'week'
          ? "date_trunc('week', r.reacted_at)"
          : "date_trunc('day', r.reacted_at)";
    const rParams: (string | number)[] = [];
    const rConds: string[] = [];
    if (chatId) {
      rParams.push(chatId);
      rConds.push(`r.chat_id = $${rParams.length}`);
    }
    if (start) {
      rParams.push(start);
      rConds.push(`r.reacted_at >= $${rParams.length}::timestamptz`);
    }
    if (end) {
      rParams.push(end);
      rConds.push(`r.reacted_at <= $${rParams.length}::timestamptz`);
    }
    const rWhere = rConds.length ? rConds.join(' AND ') : '1=1';
    const reactionsResult = await pool.query(
      `SELECT ${rPeriodExpr} AS period, COUNT(*)::int AS count FROM reactions r WHERE ${rWhere} GROUP BY 1 ORDER BY 1`,
      rParams
    );

    const kpiParams = chatId ? [chatId] : [];
    const msgWhere = chatId ? 'WHERE chat_id = $1 AND type = \'message\'' : "WHERE type = 'message'";
    const totalMessages = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages ${msgWhere}`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);
    const totalReactions = await pool.query(
      chatId ? 'SELECT COUNT(*)::int AS c FROM reactions WHERE chat_id = $1' : 'SELECT COUNT(*)::int AS c FROM reactions',
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);
    const contactsWhere = chatId ? 'WHERE chat_id = $1 AND from_id IS NOT NULL' : 'WHERE from_id IS NOT NULL';
    const uniqueContacts = await pool.query(
      `SELECT COUNT(DISTINCT from_id)::int AS c FROM messages ${contactsWhere}`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);
    const activeUsers30d = await pool.query(
      chatId
        ? `SELECT COUNT(DISTINCT from_id)::int AS c FROM messages WHERE chat_id = $1 AND type = 'message' AND date >= NOW() - INTERVAL '30 days' AND from_id IS NOT NULL`
        : `SELECT COUNT(DISTINCT from_id)::int AS c FROM messages WHERE type = 'message' AND date >= NOW() - INTERVAL '30 days' AND from_id IS NOT NULL`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);

    return NextResponse.json({
      kpi: {
        totalMessages,
        totalReactions,
        uniqueContacts,
        activeUsers30d,
      },
      messagesOverTime: messagesResult.rows.map((r) => ({ period: r.period, count: r.count })),
      reactionsOverTime: reactionsResult.rows.map((r) => ({ period: r.period, count: r.count })),
    });
  } catch (err) {
    console.error('stats/overview error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
