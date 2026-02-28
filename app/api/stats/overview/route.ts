import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

type GroupBy = 'day' | 'week' | 'month';

/** Generate all period keys from min to max for filling gaps (count 0) */
function fillPeriods(
  minDate: Date,
  maxDate: Date,
  groupBy: GroupBy
): string[] {
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

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');
    const fromId = searchParams.get('fromId');
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
    const mConds: string[] = ["m.type = 'message'", "m.date >= '2000-01-01'::timestamptz"];
    if (chatId) {
      mParams.push(chatId);
      mConds.push(`m.chat_id = $${mParams.length}`);
    }
    if (fromId) {
      mParams.push(fromId);
      mConds.push(`m.from_id = $${mParams.length}`);
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
    const rangeWhere = mWhere.replace(/m\./g, '');
    // Exclude invalid/epoch dates (e.g. date_unixtime 0 from Telegram export) so range is sane
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
    let messagesOverTime: { period: string; count: number }[] = messagesResult.rows.map((r) => ({
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
    const rParams: (string | number)[] = [];
    const rConds: string[] = ["r.reacted_at >= '2000-01-01'::timestamptz"];
    if (chatId) {
      rParams.push(chatId);
      rConds.push(`r.chat_id = $${rParams.length}`);
    }
    if (fromId) {
      rParams.push(fromId);
      rConds.push(`r.reactor_from_id = $${rParams.length}`);
    }
    if (start) {
      rParams.push(start);
      rConds.push(`r.reacted_at >= $${rParams.length}::timestamptz`);
    }
    if (end) {
      rParams.push(end);
      rConds.push(`r.reacted_at <= $${rParams.length}::timestamptz`);
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
    let reactionsOverTime: { period: string; count: number }[] = reactionsResult.rows.map((r) => ({
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

    const kpiParams: (string | number)[] = [];
    let kpiIdx = 1;
    if (chatId) {
      kpiParams.push(chatId);
      kpiIdx++;
    }
    if (fromId) kpiParams.push(fromId);
    const msgWhereParts: string[] = ["type = 'message'", "date >= '2000-01-01'::timestamptz"];
    if (chatId) msgWhereParts.push(`chat_id = $1`);
    if (fromId) msgWhereParts.push(`from_id = $${kpiParams.length}`);
    const msgWhere = 'WHERE ' + msgWhereParts.join(' AND ');
    const totalMessages = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages ${msgWhere}`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);
    const reactWhereParts: string[] = [];
    if (chatId) reactWhereParts.push('chat_id = $1');
    if (fromId) reactWhereParts.push('reactor_from_id = $' + kpiParams.length);
    const reactWhere = reactWhereParts.length ? 'WHERE ' + reactWhereParts.join(' AND ') : '';
    const totalReactions = await pool.query(
      `SELECT COUNT(*)::int AS c FROM reactions ${reactWhere}`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);
    const contactsWhereParts = ['from_id IS NOT NULL', "date >= '2000-01-01'::timestamptz"];
    if (chatId) contactsWhereParts.push('chat_id = $1');
    const contactsWhere = 'WHERE ' + contactsWhereParts.join(' AND ');
    const uniqueContacts = fromId
      ? 1
      : await pool.query(
          `SELECT COUNT(DISTINCT from_id)::int AS c FROM messages ${contactsWhere}`,
          chatId ? [chatId] : []
        ).then((r) => r.rows[0]?.c ?? 0);
    const active30WhereParts = ["type = 'message'", "date >= '2000-01-01'::timestamptz", "date >= NOW() - INTERVAL '30 days'", 'from_id IS NOT NULL'];
    if (chatId) active30WhereParts.push('chat_id = $1');
    if (fromId) active30WhereParts.push('from_id = $' + kpiParams.length);
    const activeUsers30d = await pool.query(
      `SELECT COUNT(DISTINCT from_id)::int AS c FROM messages WHERE ${active30WhereParts.join(' AND ')}`,
      kpiParams
    ).then((r) => r.rows[0]?.c ?? 0);

    return NextResponse.json({
      kpi: {
        totalMessages,
        totalReactions,
        uniqueContacts,
        activeUsers30d,
      },
      messagesOverTime,
      reactionsOverTime,
    });
  } catch (err) {
    console.error('stats/overview error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
