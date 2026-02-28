import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

type GroupBy = 'day' | 'week' | 'month';

function fillPeriods(minDate: Date, maxDate: Date, groupBy: GroupBy): string[] {
  const out: string[] = [];
  const d = new Date(minDate);
  const end = new Date(maxDate);
  if (groupBy === 'day') {
    d.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(0, 0, 0, 0);
    while (d.getTime() <= end.getTime()) {
      out.push(d.toISOString());
      d.setUTCDate(d.getUTCDate() + 1);
    }
  } else if (groupBy === 'week') {
    const day = d.getUTCDay();
    const mon = d.getUTCDate() - (day === 0 ? 6 : day - 1);
    d.setUTCDate(mon);
    d.setUTCHours(0, 0, 0, 0);
    const endDay = end.getUTCDay();
    const endMon = end.getUTCDate() - (endDay === 0 ? 6 : endDay - 1);
    end.setUTCDate(endMon);
    end.setUTCHours(0, 0, 0, 0);
    while (d.getTime() <= end.getTime()) {
      out.push(d.toISOString());
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else {
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(1);
    end.setUTCHours(0, 0, 0, 0);
    while (d.getTime() <= end.getTime()) {
      out.push(d.toISOString());
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  return out;
}

function normalizePeriodKey(period: string | Date, groupBy: GroupBy): string {
  const d = new Date(period);
  if (groupBy === 'day') {
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (groupBy === 'week') {
    const day = d.getUTCDay();
    const mon = d.getUTCDate() - (day === 0 ? 6 : day - 1);
    d.setUTCDate(mon);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

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
    const mConds = ["m.from_id = $1", "m.type = 'message'", "m.date >= '2000-01-01'::timestamptz"];
    if (chatId) {
      mParams.push(chatId);
      mConds.push(`m.chat_id = $${mParams.length}`);
    }
    const mWhere = mConds.join(' AND ');
    const rangeWhere = mWhere.replace(/m\./g, '');

    const rangeResult = await pool.query(
      `SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM messages WHERE ${rangeWhere} AND date >= '2000-01-01'::timestamptz`,
      mParams
    );
    const minDate = rangeResult.rows[0]?.min_date;
    const maxDate = rangeResult.rows[0]?.max_date;

    const messagesResult = await pool.query(
      `SELECT ${periodExpr} AS period, COUNT(*)::int AS count FROM messages m WHERE ${mWhere} GROUP BY 1 ORDER BY 1`,
      mParams
    );
    const messagesByPeriod = new Map<string, number>();
    for (const r of Array.from(messagesResult.rows)) {
      const key = normalizePeriodKey(r.period, groupBy);
      messagesByPeriod.set(key, Number(r.count));
    }
    let messagesOverTime: { period: string; count: number }[] = Array.from(messagesResult.rows).map((r) => ({
      period: r.period,
      count: Number(r.count),
    }));
    if (minDate && maxDate) {
      const allPeriods = fillPeriods(new Date(minDate), new Date(maxDate), groupBy);
      messagesOverTime = allPeriods.map((p) => ({
        period: p,
        count: messagesByPeriod.get(normalizePeriodKey(p, groupBy)) ?? 0,
      }));
    }

    const rPeriodExpr =
      groupBy === 'month'
        ? "date_trunc('month', r.reacted_at)"
        : groupBy === 'week'
          ? "date_trunc('week', r.reacted_at)"
          : "date_trunc('day', r.reacted_at)";
    const rParams: (string | number)[] = [fromId];
    const rConds = ['r.reactor_from_id = $1', "r.reacted_at >= '2000-01-01'::timestamptz"];
    if (chatId) {
      rParams.push(chatId);
      rConds.push(`r.chat_id = $${rParams.length}`);
    }
    const rWhere = rConds.join(' AND ');
    const rRangeWhere = rWhere.replace(/r\./g, '');
    const rRangeResult = await pool.query(
      `SELECT MIN(reacted_at) AS min_date, MAX(reacted_at) AS max_date FROM reactions WHERE ${rRangeWhere}`,
      rParams
    );
    const rMinDate = rRangeResult.rows[0]?.min_date;
    const rMaxDate = rRangeResult.rows[0]?.max_date;

    const reactionsResult = await pool.query(
      `SELECT ${rPeriodExpr} AS period, COUNT(*)::int AS count FROM reactions r WHERE ${rWhere} GROUP BY 1 ORDER BY 1`,
      rParams
    );
    const reactionsByPeriod = new Map<string, number>();
    for (const r of Array.from(reactionsResult.rows)) {
      const key = normalizePeriodKey(r.period, groupBy);
      reactionsByPeriod.set(key, Number(r.count));
    }
    let reactionsOverTime: { period: string; count: number }[] = Array.from(reactionsResult.rows).map((r) => ({
      period: r.period,
      count: Number(r.count),
    }));
    if (rMinDate && rMaxDate) {
      const allRPeriods = fillPeriods(new Date(rMinDate), new Date(rMaxDate), groupBy);
      reactionsOverTime = allRPeriods.map((p) => ({
        period: p,
        count: reactionsByPeriod.get(normalizePeriodKey(p, groupBy)) ?? 0,
      }));
    }

    return NextResponse.json({
      messagesOverTime,
      reactionsOverTime,
    });
  } catch (err) {
    console.error('user stats error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch user stats' },
      { status: 500 }
    );
  }
}
