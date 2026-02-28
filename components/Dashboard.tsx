'use client';

import { useEffect, useState } from 'react';
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
  BarChart,
  Bar,
} from 'recharts';

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

interface OverviewData {
  kpi: Kpi;
  messagesOverTime: TimePoint[];
  reactionsOverTime: TimePoint[];
}

interface PeriodDetail {
  periodStart: string;
  periodEnd: string;
  count: number;
  byUser: { from_id: string; display_name: string | null; count: number }[];
  recentMessages: { date: string; from_id: string | null; display_name: string | null; text: string | null }[];
}

function formatPeriod(period: string | null): string {
  if (!period) return '';
  const d = new Date(period);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatPeriodLong(period: string | null): string {
  if (!period) return '';
  const d = new Date(period);
  return d.toLocaleDateString('en-US', { dateStyle: 'long' });
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

export function Dashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [chatId, setChatId] = useState<string>('');
  const [fromId, setFromId] = useState<string>('');
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [usersSummary, setUsersSummary] = useState<
    {
      from_id: string;
      display_name: string | null;
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
      reactions_ratio: number;
      top_reacted_to_id: string | null;
      top_reacted_to_name: string | null;
    }[]
  >([]);
  const [modalPoint, setModalPoint] = useState<{ period: string; periodLabel: string; count: number } | null>(null);
  const [periodDetail, setPeriodDetail] = useState<PeriodDetail | null>(null);
  const [periodDetailLoading, setPeriodDetailLoading] = useState(false);

  useEffect(() => {
    fetch('/api/chats')
      .then((r) => r.json())
      .then(setChats)
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (groupBy) params.set('groupBy', groupBy);
    if (chatId) params.set('chatId', chatId);
    if (fromId) params.set('fromId', fromId);
    fetch(`/api/stats/overview?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [groupBy, chatId, fromId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (chatId) params.set('chatId', chatId);
    fetch(`/api/stats/users-summary?${params}`)
      .then((r) => r.json())
      .then(setUsersSummary)
      .catch(() => setUsersSummary([]));
  }, [chatId]);

  useEffect(() => {
    if (!modalPoint) {
      setPeriodDetail(null);
      return;
    }
    const { start, end } = periodBounds(modalPoint.period, groupBy);
    setPeriodDetailLoading(true);
    const params = new URLSearchParams({ start, end });
    if (chatId) params.set('chatId', chatId);
    if (fromId) params.set('fromId', fromId);
    fetch(`/api/stats/period-detail?${params}`)
      .then((r) => r.json())
      .then(setPeriodDetail)
      .catch(() => setPeriodDetail(null))
      .finally(() => setPeriodDetailLoading(false));
  }, [modalPoint, groupBy, chatId, fromId]);

  if (loading && !data) {
    return <div className="card">Loading…</div>;
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

  const firstPeriod = data.messagesOverTime[0]?.period;
  const lastPeriod = data.messagesOverTime[data.messagesOverTime.length - 1]?.period;
  const dateRangeLabel =
    firstPeriod && lastPeriod
      ? `Data from ${formatPeriodLong(firstPeriod)} to ${formatPeriodLong(lastPeriod)} (all periods shown, including zero activity)`
      : null;

  return (
    <>
      {dateRangeLabel && (
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>{dateRangeLabel}</p>
      )}
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
        {chats.length > 0 && (
          <label>
            Chat
            <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
              <option value="">All</option>
              {chats.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name || c.slug}
                </option>
              ))}
            </select>
          </label>
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
      </div>

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
          Click a bar to see details for that period. All dates in range are shown (including days/weeks with no messages).
        </p>
        <div className="chart-container">
          {messagesData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={messagesData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Messages']}
                  labelFormatter={(label) => label}
                  cursor={{ fill: 'rgba(29, 155, 240, 0.2)' }}
                />
                <Bar
                  dataKey="count"
                  fill="#1d9bf0"
                  cursor="pointer"
                  name="Messages"
                  onClick={(data: { period: string; periodLabel: string; count: number }) =>
                    setModalPoint({ period: data.period, periodLabel: data.periodLabel, count: data.count })
                  }
                />
              </BarChart>
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
              <h3>Messages: {modalPoint.periodLabel}</h3>
              <button type="button" className="modal-close" onClick={() => setModalPoint(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {periodDetailLoading ? (
                <p style={{ color: '#8b98a5' }}>Loading…</p>
              ) : periodDetail ? (
                <>
                  <section>
                    <strong>{periodDetail.count.toLocaleString()}</strong> message{periodDetail.count !== 1 ? 's' : ''} in this period.
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
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>Recent messages (up to 50)</h4>
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
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Reactions over time</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
          All dates in range are shown (including periods with no reactions).
        </p>
        <div className="chart-container">
          {reactionsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={reactionsData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Reactions']}
                  labelFormatter={(label) => label}
                />
                <Line type="monotone" dataKey="count" stroke="#00ba7c" strokeWidth={2} dot={{ fill: '#00ba7c' }} />
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
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Detailed stats per contact. Click a row to open their profile.
        </p>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Premium</th>
                <th>Messages</th>
                <th>Reactions rec.</th>
                <th>Reactions given</th>
                <th>Photos</th>
                <th>Videos</th>
                <th>Files</th>
                <th>Audios</th>
                <th>Edited</th>
                <th>Replies</th>
                <th>Words</th>
                <th>Chars</th>
                <th>First activity</th>
                <th>Last activity</th>
                <th>Active days</th>
                <th>React./msg</th>
                <th>Top reacted to</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usersSummary.map((u) => (
                <tr
                  key={u.from_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => window.location.assign(`/users/${encodeURIComponent(u.from_id)}`)}
                >
                  <td>{u.display_name || u.from_id}</td>
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
        {usersSummary.length === 0 && (
          <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginTop: '0.5rem' }}>No contact data yet. Import a result.json first.</p>
        )}
        <p style={{ color: '#8b98a5', fontSize: '0.8125rem', marginTop: '0.75rem' }}>
          <a href="/contacts">Full contacts table</a> with CRM and call logging.
        </p>
      </div>
    </>
  );
}
