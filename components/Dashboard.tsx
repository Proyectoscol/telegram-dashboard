'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { ChatSelector } from '@/components/ChatSelector';
import { LoadingCard, LoadingOverlay, LoadingSpinner } from '@/components/Loading';
import { Pagination, PAGE_SIZE } from '@/components/Pagination';

interface Kpi {
  totalMessages: number;
  totalReactions: number;
  uniqueContacts: number;
  activeUsers30d: number;
}

interface TimePoint {
  period: string;
  count: number;
}

interface ChatSeries {
  chatId: number;
  chatName: string;
  slug: string;
  data: { period: string; count: number }[];
}

interface OverviewData {
  kpi: Kpi;
  messagesOverTime: TimePoint[];
  reactionsOverTime: TimePoint[];
  messagesOverTimeByChat?: ChatSeries[];
  reactionsOverTimeByChat?: ChatSeries[];
}

interface PeriodDetail {
  periodStart: string;
  periodEnd: string;
  count: number;
  byUser: { from_id: string; display_name: string | null; count: number }[];
  recentMessages: { date: string; from_id: string | null; display_name: string | null; text: string | null }[];
}

interface PeriodReactionsDetail {
  periodStart: string;
  periodEnd: string;
  count: number;
  recentReactions: {
    reacted_at: string | null;
    reactor_from_id: string;
    reactor_name: string | null;
    emoji: string | null;
    message_date: string | null;
    message_author_id: string | null;
    message_author_name: string | null;
    message_text: string | null;
  }[];
}

type QuickRange = 'all' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y';

const QUICK_RANGE_OPTIONS: Array<{ value: QuickRange; label: string }> = [
  { value: '1w', label: 'Week' },
  { value: '1m', label: 'Month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: 'all', label: 'Indefinitely' },
];

function formatPeriod(period: string | null): string {
  if (!period) return '';
  const d = new Date(period);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

/** Compute period start (inclusive) and end (exclusive) as ISO strings for the API */
function periodBounds(period: string, groupBy: 'day' | 'week' | 'month'): { start: string; end: string } {
  const start = new Date(period);
  const end = new Date(start);
  if (groupBy === 'day') {
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (groupBy === 'week') {
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function quickRangeBounds(range: QuickRange): { start: string | null; end: string | null } {
  if (range === 'all') return { start: null, end: null };
  const now = new Date();
  const start = new Date(now);
  if (range === '1w') {
    start.setUTCDate(start.getUTCDate() - 7);
  } else if (range === '1m') {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (range === '3m') {
    start.setUTCMonth(start.getUTCMonth() - 3);
  } else if (range === '6m') {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else if (range === '1y') {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else if (range === '2y') {
    start.setUTCFullYear(start.getUTCFullYear() - 2);
  }
  return { start: start.toISOString(), end: now.toISOString() };
}

export function Dashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [quickRange, setQuickRange] = useState<QuickRange>('all');
  const [selectedChatIds, setSelectedChatIds] = useState<number[]>([]);
  const [fromId, setFromId] = useState<string>('');
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);
  const CHAT_COLORS = ['#00ba7c', '#1d9bf0', '#f91854', '#ffd400', '#7856ff', '#00d4aa', '#7c3aed', '#ea580c', '#0891b2', '#4f46e5'];
  const [usersSummary, setUsersSummary] = useState<
    {
      from_id: string;
      display_name: string | null;
      username?: string | null;
      is_premium: boolean;
      messages_sent: number;
      service_messages: number;
      total_activity: number;
      reactions_received: number;
      reactions_given: number;
      photos: number;
      videos: number;
      files: number;
      audios: number;
      messages_edited: number;
      replies: number;
      total_words: number;
      total_chars: number;
      first_activity: string | null;
      last_activity: string | null;
      active_days: number;
      longest_streak_days: number;
      reactions_ratio: number;
      top_reacted_to_id: string | null;
      top_reacted_to_name: string | null;
    }[]
  >([]);
  const [modalPoint, setModalPoint] = useState<{ period: string; periodLabel: string; count: number; type: 'messages' | 'reactions' } | null>(null);
  const [periodDetail, setPeriodDetail] = useState<PeriodDetail | null>(null);
  const [periodReactionsDetail, setPeriodReactionsDetail] = useState<PeriodReactionsDetail | null>(null);
  const [periodDetailLoading, setPeriodDetailLoading] = useState(false);
  const [periodReactionsLoading, setPeriodReactionsLoading] = useState(false);
  const [dayInsight, setDayInsight] = useState<{ summary: string; prompt_tokens?: number; completion_tokens?: number; run_at?: string; scope?: string } | null>(null);
  const [dayInsightLoading, setDayInsightLoading] = useState(false);
  const [dayInsightGenerating, setDayInsightGenerating] = useState(false);
  const [dayInsightError, setDayInsightError] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  type ActivitySortKey = 'display_name' | 'is_premium' | 'messages_sent' | 'reactions_received' | 'reactions_given' | 'photos' | 'videos' | 'files' | 'audios' | 'messages_edited' | 'replies' | 'total_words' | 'total_chars' | 'first_activity' | 'last_activity' | 'active_days' | 'reactions_ratio' | 'top_reacted_to_name';
  const [activitySortBy, setActivitySortBy] = useState<ActivitySortKey>('messages_sent');
  const [activitySortDir, setActivitySortDir] = useState<'asc' | 'desc'>('desc');
  const [activityPage, setActivityPage] = useState(1);
  const [inactivePage, setInactivePage] = useState(1);
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [hotPage, setHotPage] = useState(1);
  const range = useMemo(() => quickRangeBounds(quickRange), [quickRange]);
  const start = range.start;
  const end = range.end;

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (groupBy) params.set('groupBy', groupBy);
    selectedChatIds.forEach((id) => params.append('chatId', String(id)));
    if (fromId) params.set('fromId', fromId);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    fetch(`/api/bootstrap/dashboard?${params}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load dashboard');
        return r.json();
      })
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        if (Array.isArray(payload.chats)) setChats(payload.chats);
        if (payload.overview) setData(payload.overview);
        if (Array.isArray(payload.usersSummary)) setUsersSummary(payload.usersSummary);
      })
      .catch((e) => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [groupBy, selectedChatIds, fromId, start, end]);

  useEffect(() => {
    if (!modalPoint || modalPoint.type !== 'messages') {
      setPeriodDetail(null);
      return;
    }
    const ctrl = new AbortController();
    const { start, end } = periodBounds(modalPoint.period, groupBy);
    setPeriodDetailLoading(true);
    const params = new URLSearchParams({ start, end });
    selectedChatIds.forEach((id) => params.append('chatId', String(id)));
    if (fromId) params.set('fromId', fromId);
    fetch(`/api/stats/period-detail?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPeriodDetail)
      .catch(() => {})
      .finally(() => setPeriodDetailLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, selectedChatIds, fromId]);

  useEffect(() => {
    if (!modalPoint || modalPoint.type !== 'reactions') {
      setPeriodReactionsDetail(null);
      return;
    }
    const ctrl = new AbortController();
    const { start, end } = periodBounds(modalPoint.period, groupBy);
    setPeriodReactionsLoading(true);
    const params = new URLSearchParams({ start, end });
    selectedChatIds.forEach((id) => params.append('chatId', String(id)));
    if (fromId) params.set('fromId', fromId);
    fetch(`/api/stats/period-reactions?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPeriodReactionsDetail)
      .catch(() => {})
      .finally(() => setPeriodReactionsLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, selectedChatIds, fromId]);

  useEffect(() => {
    if (!modalPoint) {
      setDayInsight(null);
      setDayInsightError(null);
      return;
    }
    const ctrl = new AbortController();
    setDayInsightError(null);
    const { start, end } = periodBounds(modalPoint.period, groupBy);
    setDayInsightLoading(true);
    const params = new URLSearchParams({ start, end });
    selectedChatIds.forEach((id) => params.append('chatId', String(id)));
    if (fromId) params.set('fromId', fromId);
    fetch(`/api/stats/day-insight?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setDayInsightError(data?.error || `Error ${r.status}`);
          setDayInsight(null);
        } else {
          setDayInsightError(null);
          setDayInsight(data.insight ?? null);
        }
      })
      .catch((e) => { if (e?.name !== 'AbortError') { setDayInsightError(null); setDayInsight(null); } })
      .finally(() => setDayInsightLoading(false));
    return () => ctrl.abort();
  }, [modalPoint, groupBy, selectedChatIds, fromId]);

  // Pagination reset: same order every render (no conditional hooks).
  useEffect(() => {
    setActivityPage(1);
  }, [activitySearch, activitySortBy, activitySortDir, selectedChatIds, fromId, start, end]);
  useEffect(() => {
    setInactivePage(1);
  }, [activitySearch, selectedChatIds, fromId, start, end, usersSummary.length]);
  useEffect(() => {
    setAtRiskPage(1);
  }, [activitySearch, selectedChatIds, fromId, start, end, usersSummary.length]);
  useEffect(() => {
    setHotPage(1);
  }, [activitySearch, selectedChatIds, fromId, start, end, usersSummary.length]);

  if (loading && !data) {
    return <LoadingCard message="Loading dashboard…" />;
  }
  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }
  if (!data) {
    return <div className="card">No data. Import a result.json file first.</div>;
  }

  const messagesData = data.messagesOverTime.map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));
  const reactionsData = data.reactionsOverTime.map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));

  const byChatMessages = data.messagesOverTimeByChat ?? [];
  const byChatReactions = data.reactionsOverTimeByChat ?? [];
  const messagesChartData =
    byChatMessages.length > 0
      ? (() => {
          const periods = new Set<string>(messagesData.map((d) => d.period));
          return Array.from(periods)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map((period) => {
              const row: Record<string, string | number> = { period, periodLabel: formatPeriod(period) };
              let total = 0;
              byChatMessages.forEach((c) => {
                const pt = c.data.find((d) => d.period === period);
                const count = pt?.count ?? 0;
                row[c.slug] = count;
                total += count;
              });
              row.count = total;
              return row;
            });
        })()
      : messagesData;
  const reactionsChartData =
    byChatReactions.length > 0
      ? (() => {
          const periods = new Set<string>(reactionsData.map((d) => d.period));
          return Array.from(periods)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map((period) => {
              const row: Record<string, string | number> = { period, periodLabel: formatPeriod(period) };
              byChatReactions.forEach((c) => {
                const pt = c.data.find((d) => d.period === period);
                row[c.slug] = pt?.count ?? 0;
              });
              return row;
            });
        })()
      : reactionsData;

  const matchesActivitySearch = (u: { display_name: string | null; from_id: string; username?: string | null }) => {
    if (activitySearch.length < 3) return true;
    const q = activitySearch.toLowerCase().trim();
    return (u.display_name?.toLowerCase().includes(q)) || (u.from_id?.toLowerCase().includes(q)) || (u.username?.toLowerCase().includes(q));
  };
  const inScopeUsers = usersSummary.filter((u) => !fromId || u.from_id === fromId);
  const activeUsers = inScopeUsers.filter((u) => Number(u.messages_sent) > 0 || Number(u.reactions_given) > 0);
  const inactiveUsers = inScopeUsers.filter((u) => Number(u.messages_sent) === 0 && Number(u.reactions_given) === 0);

  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.getTime();
  })();
  const atRiskUsers = inScopeUsers.filter((u) => {
    const hasActivity = Number(u.messages_sent) > 0 || Number(u.reactions_given) > 0;
    if (!hasActivity) return false;
    const last = u.last_activity ? new Date(u.last_activity).getTime() : null;
    return last == null || last < sevenDaysAgo;
  });
  const atRiskFiltered = atRiskUsers.filter(matchesActivitySearch);
  const atRiskSorted = [...atRiskFiltered].sort((a, b) => {
    const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return ta - tb;
  });
  const atRiskPaged = atRiskSorted.slice((atRiskPage - 1) * PAGE_SIZE, atRiskPage * PAGE_SIZE);

  const fiveDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d.getTime();
  })();
  const hotUsers = inScopeUsers.filter((u) => {
    const streak = Number(u.longest_streak_days) ?? 0;
    if (streak < 5) return false;
    const last = u.last_activity ? new Date(u.last_activity).getTime() : null;
    return last != null && last >= fiveDaysAgo;
  });
  const hotFiltered = hotUsers.filter(matchesActivitySearch);
  const hotSorted = [...hotFiltered].sort((a, b) => {
    const streakA = Number(a.longest_streak_days) ?? 0;
    const streakB = Number(b.longest_streak_days) ?? 0;
    if (streakB !== streakA) return streakB - streakA;
    const ta = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const tb = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return tb - ta;
  });
  const hotPaged = hotSorted.slice((hotPage - 1) * PAGE_SIZE, hotPage * PAGE_SIZE);

  const activityFiltered = activeUsers.filter(matchesActivitySearch);
  const inactiveFiltered = inactiveUsers.filter(matchesActivitySearch);
  const activitySorted = [...activityFiltered].sort((a, b) => {
    const key = activitySortBy;
    if (key === 'display_name' || key === 'top_reacted_to_name') {
      const va = String((a as Record<string, unknown>)[key] ?? (key === 'display_name' ? a.from_id : '')).trim();
      const vb = String((b as Record<string, unknown>)[key] ?? (key === 'display_name' ? b.from_id : '')).trim();
      const n = va.localeCompare(vb, undefined, { sensitivity: 'base' });
      return activitySortDir === 'asc' ? n : -n;
    }
    let va: unknown = (a as Record<string, unknown>)[key];
    let vb: unknown = (b as Record<string, unknown>)[key];
    if (key === 'is_premium') {
      va = va ? 1 : 0;
      vb = vb ? 1 : 0;
    } else if (key === 'first_activity' || key === 'last_activity') {
      va = va ? new Date(va as string).getTime() : 0;
      vb = vb ? new Date(vb as string).getTime() : 0;
    } else {
      va = Number(va) ?? 0;
      vb = Number(vb) ?? 0;
    }
    const n = (va as number) - (vb as number);
    return activitySortDir === 'asc' ? n : -n;
  });
  const activityPaged = activitySorted.slice((activityPage - 1) * PAGE_SIZE, activityPage * PAGE_SIZE);

  const inactiveSorted = [...inactiveFiltered].sort((a, b) =>
    (a.display_name || a.from_id).localeCompare(b.display_name || b.from_id)
  );
  const inactivePaged = inactiveSorted.slice((inactivePage - 1) * PAGE_SIZE, inactivePage * PAGE_SIZE);

  return (
    <>
      <div className="filters">
        <label>
          Group by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.8125rem', color: '#8b98a5' }}>Range</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {QUICK_RANGE_OPTIONS.map((opt) => {
              const active = quickRange === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setQuickRange(opt.value)}
                  className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {chats.length > 0 && (
          <ChatSelector
            chats={chats}
            selectedIds={selectedChatIds}
            onChange={setSelectedChatIds}
            label="Chats"
            allChatsLabel="All chats"
            onlyTheseLabel="Show data from:"
            compact
          />
        )}
        <label>
          Contact
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">All</option>
            {usersSummary.map((u) => (
              <option key={u.from_id} value={u.from_id}>
                {u.display_name || u.from_id}
              </option>
            ))}
          </select>
        </label>
        {fromId ? (
          <a href={`/users/${encodeURIComponent(fromId)}`} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
            Go to contact
          </a>
        ) : null}
      </div>

      <LoadingOverlay active={loading && !!data} message="Updating…">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="value">{data.kpi.totalMessages.toLocaleString()}</div>
          <div className="label">Total messages</div>
        </div>
        <div className="kpi-card">
          <div className="value">{data.kpi.totalReactions.toLocaleString()}</div>
          <div className="label">Total reactions</div>
        </div>
        <div className="kpi-card">
          <div className="value">{data.kpi.uniqueContacts.toLocaleString()}</div>
          <div className="label">Unique contacts</div>
        </div>
        <div className="kpi-card">
          <div className="value">{data.kpi.activeUsers30d.toLocaleString()}</div>
          <div className="label">Active users (last 30 days)</div>
        </div>
      </div>

      <div className="card">
        <h2>Messages over time</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
          Click a point to see details. All dates in range are shown (including days with no messages).
        </p>
        <div className="chart-container">
          {messagesChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messagesChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Messages']}
                  labelFormatter={(label) => label}
                />
                {byChatMessages.length > 0 ? (
                  byChatMessages.map((c, i) => (
                    <Area
                      key={c.chatId}
                      type="monotone"
                      dataKey={c.slug}
                      name={c.chatName}
                      stroke={CHAT_COLORS[i % CHAT_COLORS.length]}
                      fill={CHAT_COLORS[i % CHAT_COLORS.length]}
                      fillOpacity={0.3}
                      dot={{ r: 4, cursor: 'pointer' }}
                      activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, payload: unknown) => {
                        const p = (payload as { payload?: Record<string, unknown> })?.payload ?? (payload as Record<string, unknown>);
                        if (p?.period != null) setModalPoint({
                          period: p.period as string,
                          periodLabel: (p.periodLabel as string) ?? formatPeriod(p.period as string),
                          count: Number(p.count) ?? 0,
                          type: 'messages',
                        });
                      } }}
                    />
                  ))
                ) : (
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#1d9bf0"
                    fill="#1d9bf0"
                    fillOpacity={0.3}
                    dot={{ r: 4, cursor: 'pointer' }}
                    activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, payload: unknown) => {
                      const p = (payload as { payload?: { period?: string; periodLabel?: string; count?: number } })?.payload
                        ?? (payload as { period?: string; periodLabel?: string; count?: number });
                      if (p?.period != null) setModalPoint({
                        period: p.period,
                        periodLabel: p.periodLabel ?? formatPeriod(p.period),
                        count: p.count ?? 0,
                        type: 'messages',
                      });
                    } }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No message data for this range.
            </div>
          )}
        </div>
      </div>

      {modalPoint && (
        <div className="modal-backdrop" onClick={() => setModalPoint(null)} role="presentation">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modalPoint.type === 'reactions' ? 'Reactions' : 'Messages'}: {modalPoint.periodLabel}</h3>
              <button type="button" className="modal-close" onClick={() => setModalPoint(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {modalPoint.type === 'messages' ? (
                periodDetailLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                    <LoadingSpinner size="sm" />
                    <span>Loading…</span>
                  </div>
                ) : periodDetail ? (
                  <>
                    <section>
                      <strong>{periodDetail.count.toLocaleString()}</strong> message{periodDetail.count !== 1 ? 's' : ''} in this period.
                    </section>
                    <section>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>AI insight — why this day?</h4>
                      {dayInsightError && (
                        <p style={{ color: '#f91854', fontSize: '0.875rem', marginBottom: '0.5rem', background: 'rgba(249,24,84,0.1)', padding: '0.5rem', borderRadius: 6 }} role="alert">
                          {dayInsightError}
                        </p>
                      )}
                      {dayInsightLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5', fontSize: '0.875rem' }}>
                          <LoadingSpinner size="sm" />
                          <span>Loading…</span>
                        </div>
                      ) : dayInsight ? (
                        <>
                          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{dayInsight.summary}</p>
                          <p style={{ color: '#8b98a5', fontSize: '0.75rem', margin: 0 }}>
                            {dayInsight.scope === 'contact' ? 'Analysis for this contact on this day.' : 'Analysis for all contacts on this day.'}
                            {(dayInsight.prompt_tokens != null || dayInsight.completion_tokens != null) && (
                              <> · {dayInsight.prompt_tokens ?? 0} in / {dayInsight.completion_tokens ?? 0} out tokens</>
                            )}
                            {dayInsight.run_at && <> · {new Date(dayInsight.run_at).toLocaleString('en-US')}</>}
                          </p>
                        </>
                      ) : (
                        <div>
                          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            {fromId ? 'Generate an AI analysis of why this contact had activity this day.' : 'Generate an AI analysis of why there was activity this day (all contacts).'}
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={dayInsightGenerating}
                            onClick={async () => {
                              if (!modalPoint) return;
                              setDayInsightError(null);
                              setDayInsightGenerating(true);
                              try {
                                const { start, end } = periodBounds(modalPoint.period, groupBy);
                                const params = new URLSearchParams({ start, end });
                                selectedChatIds.forEach((id) => params.append('chatId', String(id)));
                                if (fromId) params.set('fromId', fromId);
                                const res = await fetch(`/api/stats/day-insight?${params}`, { method: 'POST' });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to generate');
                                setDayInsight(data.insight ?? null);
                              } catch (e) {
                                setDayInsight(null);
                                setDayInsightError(e instanceof Error ? e.message : 'Failed to generate');
                              } finally {
                                setDayInsightGenerating(false);
                              }
                            }}
                          >
                            {dayInsightGenerating ? 'Generating…' : 'Generate insight'}
                          </button>
                        </div>
                      )}
                    </section>
                    {periodDetail.byUser.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>By user</h4>
                        <table className="by-user-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Messages</th>
                            </tr>
                          </thead>
                          <tbody>
                            {periodDetail.byUser.map((u) => (
                              <tr key={u.from_id}>
                                <td>{u.display_name || u.from_id}</td>
                                <td>{u.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )}
                    {periodDetail.recentMessages.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Messages (scroll to see all)</h4>
                        {periodDetail.recentMessages.map((m, i) => (
                          <div key={i} className="recent-msg">
                            <div className="meta">
                              {m.date ? new Date(m.date).toLocaleString('en-US') : ''} · {m.display_name || m.from_id || '—'}
                            </div>
                            <div className="text">{(m.text || '').slice(0, 200)}{(m.text && m.text.length > 200) ? '…' : ''}</div>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : (
                  <p style={{ color: '#8b98a5' }}>Could not load period details.</p>
                )
              ) : (
                periodReactionsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5' }}>
                    <LoadingSpinner size="sm" />
                    <span>Loading…</span>
                  </div>
                ) : periodReactionsDetail ? (
                  <>
                    <section>
                      <strong>{periodReactionsDetail.count.toLocaleString()}</strong> reaction{periodReactionsDetail.count !== 1 ? 's' : ''} in this period.
                    </section>
                    <section>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>AI insight — why this day?</h4>
                      {dayInsightError && (
                        <p style={{ color: '#f91854', fontSize: '0.875rem', marginBottom: '0.5rem', background: 'rgba(249,24,84,0.1)', padding: '0.5rem', borderRadius: 6 }} role="alert">
                          {dayInsightError}
                        </p>
                      )}
                      {dayInsightLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b98a5', fontSize: '0.875rem' }}>
                          <LoadingSpinner size="sm" />
                          <span>Loading…</span>
                        </div>
                      ) : dayInsight ? (
                        <>
                          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{dayInsight.summary}</p>
                          <p style={{ color: '#8b98a5', fontSize: '0.75rem', margin: 0 }}>
                            {dayInsight.scope === 'contact' ? 'Analysis for this contact on this day.' : 'Analysis for all contacts on this day.'}
                            {(dayInsight.prompt_tokens != null || dayInsight.completion_tokens != null) && (
                              <> · {dayInsight.prompt_tokens ?? 0} in / {dayInsight.completion_tokens ?? 0} out tokens</>
                            )}
                            {dayInsight.run_at && <> · {new Date(dayInsight.run_at).toLocaleString('en-US')}</>}
                          </p>
                        </>
                      ) : (
                        <div>
                          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            {fromId ? 'Generate an AI analysis of why this contact had activity this day.' : 'Generate an AI analysis of why there was activity this day (all contacts).'}
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={dayInsightGenerating}
                            onClick={async () => {
                              if (!modalPoint) return;
                              setDayInsightError(null);
                              setDayInsightGenerating(true);
                              try {
                                const { start, end } = periodBounds(modalPoint.period, groupBy);
                                const params = new URLSearchParams({ start, end });
                                selectedChatIds.forEach((id) => params.append('chatId', String(id)));
                                if (fromId) params.set('fromId', fromId);
                                const res = await fetch(`/api/stats/day-insight?${params}`, { method: 'POST' });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to generate');
                                setDayInsight(data.insight ?? null);
                              } catch (e) {
                                setDayInsight(null);
                                setDayInsightError(e instanceof Error ? e.message : 'Failed to generate');
                              } finally {
                                setDayInsightGenerating(false);
                              }
                            }}
                          >
                            {dayInsightGenerating ? 'Generating…' : 'Generate insight'}
                          </button>
                        </div>
                      )}
                    </section>
                    {periodReactionsDetail.recentReactions.length > 0 && (
                      <section>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Reactions (scroll to see all)</h4>
                        {periodReactionsDetail.recentReactions.map((r, i) => (
                          <div key={i} className="recent-msg">
                            <div className="meta">
                              {r.reacted_at ? new Date(r.reacted_at).toLocaleString('en-US') : ''} · {r.reactor_name || r.reactor_from_id} reacted {r.emoji ?? '❤️'}
                            </div>
                            <div className="text">
                              {r.message_author_name || r.message_author_id || '—'}: {(r.message_text || '').slice(0, 200)}{(r.message_text && r.message_text.length > 200) ? '…' : ''}
                            </div>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : (
                  <p style={{ color: '#8b98a5' }}>Could not load period reactions.</p>
                )
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Reactions over time</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
          Click a point to see reactions for that day. All dates in range shown (including zero).
        </p>
        <div className="chart-container">
          {reactionsChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={reactionsChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Reactions']}
                  labelFormatter={(label) => label}
                />
                {byChatReactions.length > 0 ? (
                  byChatReactions.map((c, i) => (
                    <Line
                      key={c.chatId}
                      type="monotone"
                      dataKey={c.slug}
                      name={c.chatName}
                      stroke={CHAT_COLORS[i % CHAT_COLORS.length]}
                      strokeWidth={2}
                      dot={{ fill: CHAT_COLORS[i % CHAT_COLORS.length], r: 4, cursor: 'pointer' }}
                      activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, payload: unknown) => {
                        const p = (payload as { payload?: Record<string, unknown> })?.payload ?? (payload as Record<string, unknown>);
                        if (p?.period != null) setModalPoint({
                          period: p.period as string,
                          periodLabel: (p.periodLabel as string) ?? formatPeriod(p.period as string),
                          count: Number(p.count) ?? 0,
                          type: 'reactions',
                        });
                      } }}
                    />
                  ))
                ) : (
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#00ba7c"
                    strokeWidth={2}
                    dot={{ fill: '#00ba7c', r: 4, cursor: 'pointer' }}
                    activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, payload: unknown) => {
                      const p = (payload as { payload?: Record<string, unknown> })?.payload ?? (payload as Record<string, unknown>);
                      if (p?.period != null) setModalPoint({
                        period: p.period as string,
                        periodLabel: (p.periodLabel as string) ?? formatPeriod(p.period as string),
                        count: Number(p.count) ?? 0,
                        type: 'reactions',
                      });
                    } }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No reaction data for this range.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Activity by contact</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Detailed stats for active contacts in the selected range. Click a row or the name to open their profile.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <span style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
            {activitySearch.length >= 3
              ? `Showing ${activityFiltered.length} of ${activeUsers.length} active contacts`
              : `${activeUsers.length} active contact${activeUsers.length === 1 ? '' : 's'}`}
          </span>
          <input
            type="search"
            placeholder="Search by name, username, or user ID (min 3 characters)"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            style={{ maxWidth: 320, padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea' }}
          />
        </div>
        <div className="table-wrap paginated-table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="th-index">#</th>
                {([
                  { key: 'display_name' as const, label: 'Contact' },
                  { key: 'is_premium' as const, label: 'Premium' },
                  { key: 'messages_sent' as const, label: 'Messages' },
                  { key: 'reactions_received' as const, label: 'Reactions rec.' },
                  { key: 'reactions_given' as const, label: 'Reactions given' },
                  { key: 'photos' as const, label: 'Photos' },
                  { key: 'videos' as const, label: 'Videos' },
                  { key: 'files' as const, label: 'Files' },
                  { key: 'audios' as const, label: 'Audios' },
                  { key: 'messages_edited' as const, label: 'Edited' },
                  { key: 'replies' as const, label: 'Replies' },
                  { key: 'total_words' as const, label: 'Words' },
                  { key: 'total_chars' as const, label: 'Chars' },
                  { key: 'first_activity' as const, label: 'First activity' },
                  { key: 'last_activity' as const, label: 'Last activity' },
                  { key: 'active_days' as const, label: 'Active days' },
                  { key: 'reactions_ratio' as const, label: 'React./msg' },
                  { key: 'top_reacted_to_name' as const, label: 'Top reacted to' },
                ] as { key: ActivitySortKey; label: string }[]).map(({ key, label }) => (
                  <th key={key} className="sortable-th">
                    <span className="sortable-th-label">{label}</span>
                    <span className="sortable-th-arrows">
                      <button
                        type="button"
                        className={`sort-arrow ${activitySortBy === key && activitySortDir === 'asc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActivitySortBy(key); setActivitySortDir('asc'); setActivityPage(1); }}
                        aria-label={`Sort by ${label} ascending`}
                        title="Sort ascending"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={`sort-arrow ${activitySortBy === key && activitySortDir === 'desc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActivitySortBy(key); setActivitySortDir('desc'); setActivityPage(1); }}
                        aria-label={`Sort by ${label} descending`}
                        title="Sort descending"
                      >
                        ↓
                      </button>
                    </span>
                  </th>
                ))}
                <th className="th-action"></th>
              </tr>
            </thead>
            <tbody>
              {activityPaged.map((u, index) => (
                <tr
                  key={u.from_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => window.location.assign(`/users/${encodeURIComponent(u.from_id)}`)}
                >
                  <td style={{ color: '#8b98a5' }}>{(activityPage - 1) * PAGE_SIZE + index + 1}</td>
                  <td>
                    <a
                      href={`/users/${encodeURIComponent(u.from_id)}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#1d9bf0', textDecoration: 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                    >
                      {u.display_name || u.from_id}
                    </a>
                    {u.username ? <span style={{ color: '#8b98a5', fontSize: '0.8125rem', marginLeft: '0.35rem' }}>@{u.username}</span> : null}
                  </td>
                  <td>{u.is_premium ? 'Yes' : 'No'}</td>
                  <td>{u.messages_sent}</td>
                  <td>{u.reactions_received}</td>
                  <td>{u.reactions_given}</td>
                  <td>{u.photos}</td>
                  <td>{u.videos}</td>
                  <td>{u.files}</td>
                  <td>{u.audios}</td>
                  <td>{u.messages_edited}</td>
                  <td>{u.replies}</td>
                  <td>{Number(u.total_words).toLocaleString()}</td>
                  <td>{Number(u.total_chars).toLocaleString()}</td>
                  <td>{u.first_activity ? new Date(u.first_activity).toLocaleDateString('en-US') : '—'}</td>
                  <td>{u.last_activity ? new Date(u.last_activity).toLocaleDateString('en-US') : '—'}</td>
                  <td>{u.active_days}</td>
                  <td>{Number(u.reactions_ratio)}</td>
                  <td>{u.top_reacted_to_name || u.top_reacted_to_id || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a href={`/users/${encodeURIComponent(u.from_id)}`}>View profile</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {activeUsers.length === 0 && (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginTop: '0.5rem' }}>No contact data yet. Import a result.json first.</p>
        )}
        {activeUsers.length > 0 && activitySearch.length >= 3 && activityFiltered.length === 0 && (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginTop: '0.5rem' }}>No contacts match your search.</p>
        )}
        {activitySorted.length > 0 && (
          <Pagination
            currentPage={activityPage}
            totalItems={activitySorted.length}
            onPageChange={setActivityPage}
            itemLabel="active contacts"
          />
        )}
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginTop: '0.75rem' }}>
          <a href="/contacts">Full contacts table</a> with CRM and call logging.
        </p>
      </div>

      <div className="card">
        <h2>Hot Users</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Contacts who posted 5 or more days in a row, with their most recent post 5 days old or newer.
        </p>
        <div style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          {activitySearch.length >= 3
            ? `Showing ${hotFiltered.length} of ${hotUsers.length} hot`
            : `${hotUsers.length} hot user${hotUsers.length === 1 ? '' : 's'}`}
        </div>
        {hotFiltered.length > 0 ? (
          <>
            <div className="table-wrap paginated-table-wrap" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Contact</th>
                    <th>Longest streak (days)</th>
                    <th>Last activity</th>
                    <th>Messages</th>
                    <th>Reactions given</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {hotPaged.map((u, index) => (
                    <tr key={u.from_id}>
                      <td style={{ color: '#8b98a5' }}>{(hotPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td>
                        {u.display_name || u.from_id}
                        {u.username ? <span style={{ color: '#8b98a5', fontSize: '0.8125rem', marginLeft: '0.35rem' }}>@{u.username}</span> : null}
                      </td>
                      <td>{u.longest_streak_days ?? 0}</td>
                      <td>{u.last_activity ? new Date(u.last_activity).toLocaleDateString('en-US') : '—'}</td>
                      <td>{u.messages_sent}</td>
                      <td>{u.reactions_given}</td>
                      <td>
                        <a href={`/users/${encodeURIComponent(u.from_id)}`}>View profile</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={hotPage}
              totalItems={hotSorted.length}
              onPageChange={setHotPage}
              itemLabel="hot users"
            />
          </>
        ) : (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
            {activitySearch.length >= 3 ? 'No hot users match your search.' : 'No hot users for this range (no one with a 5+ day streak and activity in the last 5 days).'}
          </p>
        )}
      </div>

      <div className="card">
        <h2>At Risk of going Inactive</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Contacts with no messages or reactions in the last 7 days (they had activity before).
        </p>
        <div style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          {activitySearch.length >= 3
            ? `Showing ${atRiskFiltered.length} of ${atRiskUsers.length} at risk`
            : `${atRiskUsers.length} contact${atRiskUsers.length === 1 ? '' : 's'} at risk`}
        </div>
        {atRiskFiltered.length > 0 ? (
          <>
            <div className="table-wrap paginated-table-wrap" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Contact</th>
                    <th>Last activity</th>
                    <th>Days ago</th>
                    <th>Messages</th>
                    <th>Reactions given</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskPaged.map((u, index) => {
                    const lastDate = u.last_activity ? new Date(u.last_activity) : null;
                    const daysAgo = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86400000) : null;
                    return (
                      <tr key={u.from_id}>
                        <td style={{ color: '#8b98a5' }}>{(atRiskPage - 1) * PAGE_SIZE + index + 1}</td>
                        <td>
                          {u.display_name || u.from_id}
                          {u.username ? <span style={{ color: '#8b98a5', fontSize: '0.8125rem', marginLeft: '0.35rem' }}>@{u.username}</span> : null}
                        </td>
                        <td>{lastDate ? lastDate.toLocaleDateString('en-US') : '—'}</td>
                        <td>{daysAgo != null ? daysAgo : '—'}</td>
                        <td>{u.messages_sent}</td>
                        <td>{u.reactions_given}</td>
                        <td>
                          <a href={`/users/${encodeURIComponent(u.from_id)}`}>View profile</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={atRiskPage}
              totalItems={atRiskSorted.length}
              onPageChange={setAtRiskPage}
              itemLabel="at risk"
            />
          </>
        ) : (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
            {activitySearch.length >= 3 ? 'No at-risk contacts match your search.' : 'No contacts at risk for this range (everyone active in the last 7 days or inactive).'}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Inactive users</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Contacts with 0 messages and 0 reactions given in the selected range.
        </p>
        <div style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          {activitySearch.length >= 3
            ? `Showing ${inactiveFiltered.length} of ${inactiveUsers.length} inactive users`
            : `${inactiveUsers.length} inactive user${inactiveUsers.length === 1 ? '' : 's'}`}
        </div>
        {inactiveFiltered.length > 0 ? (
          <>
            <div className="table-wrap paginated-table-wrap" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Contact</th>
                    <th>Premium</th>
                    <th>Messages</th>
                    <th>Reactions given</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inactivePaged.map((u, index) => (
                    <tr key={u.from_id}>
                      <td style={{ color: '#8b98a5' }}>{(inactivePage - 1) * PAGE_SIZE + index + 1}</td>
                      <td>
                        {u.display_name || u.from_id}
                        {u.username ? <span style={{ color: '#8b98a5', fontSize: '0.8125rem', marginLeft: '0.35rem' }}>@{u.username}</span> : null}
                      </td>
                      <td>{u.is_premium ? 'Yes' : 'No'}</td>
                      <td>{u.messages_sent}</td>
                      <td>{u.reactions_given}</td>
                      <td>
                        <a href={`/users/${encodeURIComponent(u.from_id)}`}>View profile</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={inactivePage}
              totalItems={inactiveSorted.length}
              onPageChange={setInactivePage}
              itemLabel="inactive users"
            />
          </>
        ) : (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
            {activitySearch.length >= 3 ? 'No inactive users match your search.' : 'No inactive users for this range.'}
          </p>
        )}
      </div>
      </LoadingOverlay>
    </>
  );
}
