/**
 * Shared DB helpers for the /api/users/.../full aggregated endpoint.
 * Bundles user data, KPI stats, time series, chats, and persona labels
 * into a single server-side pass to avoid multiple parallel HTTP requests
 * from the UserProfile frontend.
 */
import { pool, queryWithRetry } from '@/lib/db/client';
import { get, set, cacheKey } from '@/lib/cache';
import { getPersonaLabels } from '@/lib/settings';

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
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    d.setUTCHours(0, 0, 0, 0);
    const endDay = end.getUTCDay();
    end.setUTCDate(end.getUTCDate() - (endDay === 0 ? 6 : endDay - 1));
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
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getUserTimeSeries(
  fromId: string,
  chatIds: number[] | null,
  groupBy: GroupBy,
  start?: string | null,
  end?: string | null
) {
  const periodExpr =
    groupBy === 'month'
      ? "date_trunc('month', m.date)"
      : groupBy === 'week'
        ? "date_trunc('week', m.date)"
        : "date_trunc('day', m.date)";

  const mParams: (string | number | number[])[] = [fromId];
  const mConds = ["m.from_id = $1", "m.type = 'message'", "m.date >= '2000-01-01'::timestamptz"];
  if (chatIds && chatIds.length > 0) {
    mParams.push(chatIds);
    mConds.push(`m.chat_id = ANY($${mParams.length}::bigint[])`);
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

  const rangeResult = await queryWithRetry(
    `SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM messages WHERE ${rangeWhere}`,
    mParams
  );
  const minDate = rangeResult.rows[0]?.min_date;
  const maxDate = rangeResult.rows[0]?.max_date;

  const messagesResult = await queryWithRetry(
    `SELECT ${periodExpr} AS period, COUNT(*)::int AS count FROM messages m WHERE ${mWhere} GROUP BY 1 ORDER BY 1`,
    mParams
  );
  const messagesByPeriod = new Map<string, number>();
  for (const r of Array.from(messagesResult.rows)) {
    messagesByPeriod.set(normalizePeriodKey(r.period, groupBy), Number(r.count));
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

  const rParams: (string | number | number[])[] = [fromId];
  const rConds = ['r.reactor_from_id = $1', "r.reacted_at >= '2000-01-01'::timestamptz"];
  if (chatIds && chatIds.length > 0) {
    rParams.push(chatIds);
    rConds.push(`r.chat_id = ANY($${rParams.length}::bigint[])`);
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

  const rRangeResult = await queryWithRetry(
    `SELECT MIN(reacted_at) AS min_date, MAX(reacted_at) AS max_date FROM reactions WHERE ${rRangeWhere}`,
    rParams
  );
  const rMinDate = rRangeResult.rows[0]?.min_date;
  const rMaxDate = rRangeResult.rows[0]?.max_date;

  const reactionsResult = await queryWithRetry(
    `SELECT ${rPeriodExpr} AS period, COUNT(*)::int AS count FROM reactions r WHERE ${rWhere} GROUP BY 1 ORDER BY 1`,
    rParams
  );
  const reactionsByPeriod = new Map<string, number>();
  for (const r of Array.from(reactionsResult.rows)) {
    reactionsByPeriod.set(normalizePeriodKey(r.period, groupBy), Number(r.count));
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

  return { messagesOverTime, reactionsOverTime };
}

const CHATS_TTL_MS = 5 * 60 * 1000;

export async function getChatsCached(): Promise<{ id: number; name: string | null; type: string | null; slug: string; created_at: string }[]> {
  const key = cacheKey('chats', {});
  const cached = await get<{ id: number; name: string | null; type: string | null; slug: string; created_at: string }[]>(key);
  if (cached != null) return cached;
  const { rows } = await queryWithRetry<{ id: number; name: string | null; type: string | null; slug: string; created_at: string }>(
    'SELECT id, name, type, slug, created_at FROM chats ORDER BY slug'
  );
  await set(key, rows, CHATS_TTL_MS);
  return rows;
}

const LABELS_TTL_MS = 10 * 60 * 1000;

export async function getLabelsCached(): Promise<Record<string, string>> {
  const key = cacheKey('settings-labels', {});
  const cached = await get<Record<string, string>>(key);
  if (cached != null) return cached;
  const labels = await getPersonaLabels();
  await set(key, labels, LABELS_TTL_MS);
  return labels;
}
