import { get, set, cacheKey, getOrFetch } from '@/lib/cache';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getCacheTtlStatsMinutes } from '@/lib/settings';

export type GroupBy = 'day' | 'week' | 'month';

export interface GetOverviewDataOpts {
  groupBy?: GroupBy;
  chatIds?: number[] | null;
  fromId?: string | null;
  start?: string | null;
  end?: string | null;
  byChat?: boolean;
}

export interface OverviewKpi {
  totalMessages: number;
  totalReactions: number;
  uniqueContacts: number;
  activeUsers30d: number;
}

export interface PeriodPoint {
  period: string;
  count: number;
}

export interface ChatSeries {
  chatId: number;
  chatName: string;
  slug: string;
  data: PeriodPoint[];
}

export interface OverviewBody {
  kpi: OverviewKpi;
  messagesOverTime: PeriodPoint[];
  reactionsOverTime: PeriodPoint[];
  messagesOverTimeByChat: ChatSeries[];
  reactionsOverTimeByChat: ChatSeries[];
}

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

/**
 * Single-query overview: one DB round-trip for KPIs + messages/reactions over time.
 * Replaces 6+ sequential queries to avoid connection pool exhaustion.
 */
export async function getOverviewData(opts: GetOverviewDataOpts = {}): Promise<OverviewBody> {
  const {
    groupBy = 'day',
    chatIds = null,
    fromId = null,
    start = null,
    end = null,
    byChat = false,
  } = opts;

  const key = cacheKey('overview', {
    chatIds: chatIds?.join(',') ?? 'all',
    fromId: fromId ?? '',
    groupBy,
    start: start ?? '',
    end: end ?? '',
    byChat: byChat ? '1' : '0',
  });

  // getCacheTtlStatsMinutes is now cached in-process (free call); read it once before
  // entering getOrFetch so we can pass the TTL to the cache-write without a second call.
  const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;

  return getOrFetch<OverviewBody>(key, async () => {
  await ensureSchema();

  const periodExpr =
    groupBy === 'month'
      ? "date_trunc('month', fm.date)"
      : groupBy === 'week'
        ? "date_trunc('week', fm.date)"
        : "date_trunc('day', fm.date)";
  const rPeriodExpr =
    groupBy === 'month'
      ? "date_trunc('month', fr.reacted_at)"
      : groupBy === 'week'
        ? "date_trunc('week', fr.reacted_at)"
        : "date_trunc('day', fr.reacted_at)";

  const params: (string | number | number[])[] = [];
  let p = 0;
  const mConds: string[] = ["fm.type = 'message'", "fm.date >= '2000-01-01'::timestamptz"];
  if (chatIds && chatIds.length > 0) {
    params.push(chatIds);
    p++;
    mConds.push(`fm.chat_id = ANY($${p}::bigint[])`);
  }
  if (fromId) {
    params.push(fromId);
    p++;
    mConds.push(`fm.from_id = $${p}`);
  }
  if (start) {
    params.push(start);
    p++;
    mConds.push(`fm.date >= $${p}::timestamptz`);
  }
  if (end) {
    params.push(end);
    p++;
    mConds.push(`fm.date <= $${p}::timestamptz`);
  }
  const mWhere = mConds.join(' AND ');

  p = 0;
  const rConds: string[] = ["fr.reacted_at >= '2000-01-01'::timestamptz"];
  if (chatIds && chatIds.length > 0) {
    p++;
    rConds.push(`fr.chat_id = ANY($${p}::bigint[])`);
  }
  if (fromId) {
    p++;
    rConds.push(`fr.reactor_from_id = $${p}`);
  }
  if (start) {
    p++;
    rConds.push(`fr.reacted_at >= $${p}::timestamptz`);
  }
  if (end) {
    p++;
    rConds.push(`fr.reacted_at <= $${p}::timestamptz`);
  }
  const rWhere = rConds.join(' AND ');

  p = 0;
  const active30Conds = ["type = 'message'", "date >= NOW() - INTERVAL '30 days'", 'from_id IS NOT NULL'];
  if (chatIds && chatIds.length > 0) {
    p++;
    active30Conds.push(`chat_id = ANY($${p}::bigint[])`);
  }
  if (fromId) {
    p++;
    active30Conds.push(`from_id = $${p}`);
  }
  if (start) {
    p++;
    active30Conds.push(`date >= $${p}::timestamptz`);
  }
  if (end) {
    p++;
    active30Conds.push(`date <= $${p}::timestamptz`);
  }
  const active30Where = active30Conds.join(' AND ');

  const sql = `
WITH
  filtered_msgs AS (
    SELECT fm.date, fm.from_id FROM messages fm WHERE ${mWhere}
  ),
  filtered_rxns AS (
    SELECT fr.reacted_at, fr.chat_id, fr.reactor_from_id FROM reactions fr WHERE ${rWhere}
  ),
  msg_by_period AS (
    SELECT (${periodExpr})::timestamptz AS period, COUNT(*)::int AS cnt FROM filtered_msgs fm GROUP BY 1
  ),
  rxn_by_period AS (
    SELECT (${rPeriodExpr})::timestamptz AS period, COUNT(*)::int AS cnt FROM filtered_rxns fr GROUP BY 1
  ),
  kpi_msg AS (
    SELECT COUNT(*)::int AS total_messages, COUNT(DISTINCT from_id)::int AS unique_contacts FROM filtered_msgs
  ),
  kpi_rxn AS (
    SELECT COUNT(*)::int AS total_reactions FROM filtered_rxns
  ),
  active30 AS (
    SELECT COUNT(DISTINCT from_id)::int AS n FROM messages WHERE ${active30Where}
  )
SELECT
  (SELECT total_messages FROM kpi_msg) AS total_messages,
  (SELECT unique_contacts FROM kpi_msg) AS unique_contacts,
  (SELECT total_reactions FROM kpi_rxn) AS total_reactions,
  (SELECT n FROM active30) AS active_users_30d,
  (SELECT MIN(date) FROM filtered_msgs) AS min_date,
  (SELECT MAX(date) FROM filtered_msgs) AS max_date,
  (SELECT MIN(reacted_at) FROM filtered_rxns) AS r_min_date,
  (SELECT MAX(reacted_at) FROM filtered_rxns) AS r_max_date,
  (SELECT COALESCE(json_agg(json_build_object('period', period, 'count', cnt) ORDER BY period), '[]'::json) FROM msg_by_period) AS messages_over_time,
  (SELECT COALESCE(json_agg(json_build_object('period', period, 'count', cnt) ORDER BY period), '[]'::json) FROM rxn_by_period) AS reactions_over_time
`;

  const result = await queryWithRetry<{
    total_messages: number;
    unique_contacts: number;
    total_reactions: number;
    active_users_30d: number;
    min_date: string | null;
    max_date: string | null;
    r_min_date: string | null;
    r_max_date: string | null;
    messages_over_time: { period: string; count: number }[];
    reactions_over_time: { period: string; count: number }[];
  }>(sql, params.length > 0 ? params : undefined);

  const row = result.rows[0];
  if (!row) {
    const empty: OverviewBody = {
      kpi: { totalMessages: 0, totalReactions: 0, uniqueContacts: fromId ? 1 : 0, activeUsers30d: 0 },
      messagesOverTime: [],
      reactionsOverTime: [],
      messagesOverTimeByChat: [],
      reactionsOverTimeByChat: [],
    };
    return empty;
  }

  const totalMessages = Number(row.total_messages) ?? 0;
  const uniqueContacts = fromId ? 1 : (Number(row.unique_contacts) ?? 0);
  const totalReactions = Number(row.total_reactions) ?? 0;
  const activeUsers30d = Number(row.active_users_30d) ?? 0;
  const minDate = row.min_date ? new Date(row.min_date) : null;
  const maxDate = row.max_date ? new Date(row.max_date) : null;
  const rMinDate = row.r_min_date ? new Date(row.r_min_date) : null;
  const rMaxDate = row.r_max_date ? new Date(row.r_max_date) : null;

  const rawMsg = Array.isArray(row.messages_over_time) ? row.messages_over_time : [];
  const messagesByPeriod = new Map<string, number>();
  for (const r of rawMsg) {
    const k = normalizePeriodKey(r.period, groupBy);
    messagesByPeriod.set(k, Number(r.count) ?? 0);
  }
  let messagesOverTime: PeriodPoint[] = rawMsg.map((r: { period: string; count: number }) => ({
    period: r.period,
    count: Number(r.count) ?? 0,
  }));
  if (minDate && maxDate) {
    const allPeriods = fillPeriods(minDate, maxDate, groupBy);
    messagesOverTime = allPeriods.map((p) => ({
      period: p,
      count: messagesByPeriod.get(normalizePeriodKey(p, groupBy)) ?? 0,
    }));
  }

  const rawRxn = Array.isArray(row.reactions_over_time) ? row.reactions_over_time : [];
  const reactionsByPeriod = new Map<string, number>();
  for (const r of rawRxn) {
    const k = normalizePeriodKey(r.period, groupBy);
    reactionsByPeriod.set(k, Number(r.count) ?? 0);
  }
  let reactionsOverTime: PeriodPoint[] = rawRxn.map((r: { period: string; count: number }) => ({
    period: r.period,
    count: Number(r.count) ?? 0,
  }));
  if (rMinDate && rMaxDate) {
    const allRPeriods = fillPeriods(rMinDate, rMaxDate, groupBy);
    reactionsOverTime = allRPeriods.map((p) => ({
      period: p,
      count: reactionsByPeriod.get(normalizePeriodKey(p, groupBy)) ?? 0,
    }));
  }

  let messagesOverTimeByChat: ChatSeries[] = [];
  let reactionsOverTimeByChat: ChatSeries[] = [];
  const wantByChat = (chatIds && chatIds.length > 1) || byChat;
  if (wantByChat) {
    const periodExprM = groupBy === 'month' ? "date_trunc('month', m.date)" : groupBy === 'week' ? "date_trunc('week', m.date)" : "date_trunc('day', m.date)";
    const periodExprR = groupBy === 'month' ? "date_trunc('month', r.reacted_at)" : groupBy === 'week' ? "date_trunc('week', r.reacted_at)" : "date_trunc('day', r.reacted_at)";
    const mWhereM = mWhere.replace(/fm\./g, 'm.');
    const rWhereR = rWhere.replace(/fr\./g, 'r.');
    const mByChatResult = await queryWithRetry<{ period: string; chat_id: string; count: number }>(
      `SELECT ${periodExprM} AS period, m.chat_id, COUNT(*)::int AS count FROM messages m WHERE ${mWhereM} GROUP BY 1, 2 ORDER BY 1, 2`,
      params.length > 0 ? params : undefined
    );
    const rByChatResult = await queryWithRetry<{ period: string; chat_id: string; count: number }>(
      `SELECT ${periodExprR} AS period, r.chat_id, COUNT(*)::int AS count FROM reactions r WHERE ${rWhereR} GROUP BY 1, 2 ORDER BY 1, 2`,
      params.length > 0 ? params : undefined
    );
    const chatIdsInData = Array.from(
      new Set([
        ...(mByChatResult.rows as { chat_id: string }[]).map((r) => Number(r.chat_id)),
        ...(rByChatResult.rows as { chat_id: string }[]).map((r) => Number(r.chat_id)),
      ])
    );
    const chatNames =
      chatIdsInData.length > 0
        ? await queryWithRetry<{ id: number; name: string | null; slug: string }>(
            'SELECT id, name, slug FROM chats WHERE id = ANY($1::bigint[])',
            [chatIdsInData]
          ).then((r) => new Map(r.rows.map((row) => [row.id, { name: row.name ?? String(row.id), slug: row.slug }])))
        : new Map<number, { name: string; slug: string }>();
    const allPeriodsM = minDate && maxDate ? fillPeriods(minDate, maxDate, groupBy) : [];
    const allPeriodsR = rMinDate && rMaxDate ? fillPeriods(rMinDate, rMaxDate, groupBy) : [];
    for (const cid of chatIdsInData) {
      const info = chatNames.get(cid) ?? { name: String(cid), slug: `chat_${cid}` };
      const byPeriodM = new Map<string, number>();
      for (const r of mByChatResult.rows as { period: string; chat_id: string; count: number }[]) {
        if (Number(r.chat_id) === cid) byPeriodM.set(normalizePeriodKey(r.period, groupBy), r.count);
      }
      messagesOverTimeByChat.push({
        chatId: cid,
        chatName: info.name,
        slug: info.slug,
        data: allPeriodsM.map((p) => ({ period: p, count: byPeriodM.get(normalizePeriodKey(p, groupBy)) ?? 0 })),
      });
      const byPeriodR = new Map<string, number>();
      for (const r of rByChatResult.rows as { period: string; chat_id: string; count: number }[]) {
        if (Number(r.chat_id) === cid) byPeriodR.set(normalizePeriodKey(r.period, groupBy), r.count);
      }
      reactionsOverTimeByChat.push({
        chatId: cid,
        chatName: info.name,
        slug: info.slug,
        data: allPeriodsR.map((p) => ({ period: p, count: byPeriodR.get(normalizePeriodKey(p, groupBy)) ?? 0 })),
      });
    }
  }

  const body: OverviewBody = {
    kpi: {
      totalMessages,
      totalReactions,
      uniqueContacts,
      activeUsers30d,
    },
    messagesOverTime,
    reactionsOverTime,
    messagesOverTimeByChat,
    reactionsOverTimeByChat,
  };
  return body;
  }, cacheTtlMs);
}
