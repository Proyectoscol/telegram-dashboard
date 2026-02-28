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

function formatPeriod(period: string | null): string {
  if (!period) return '';
  const d = new Date(period);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function Dashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('week');
  const [chatId, setChatId] = useState<string>('');
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);

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
    fetch(`/api/stats/overview?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [groupBy, chatId]);

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
        <div className="chart-container">
          {messagesData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messagesData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  labelStyle={{ color: '#e7e9ea' }}
                  formatter={(value: number) => [value, 'Messages']}
                  labelFormatter={(label) => label}
                />
                <Area type="monotone" dataKey="count" stroke="#1d9bf0" fill="#1d9bf0" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No message data for this range.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Reactions over time</h2>
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
        <h2>Contacts</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          <a href="/contacts">View full contacts table</a> with filters and user profiles.
        </p>
      </div>
    </>
  );
}
