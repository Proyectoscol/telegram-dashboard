'use client';

import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface UserProfileProps {
  fromId: string;
}

interface UserDetail {
  id: number;
  from_id: string;
  display_name: string | null;
  is_premium: boolean;
  assigned_to: string | null;
  notes: string | null;
  stats: {
    messagesSent: number;
    reactionsGiven: number;
    reactionsReceived: number;
  };
  calls: {
    id: number;
    call_number: number;
    called_at: string | null;
    notes: string | null;
    objections: string | null;
    plans_discussed: string | null;
    created_by: string | null;
    created_at: string;
  }[];
}

interface TimeSeries {
  period: string;
  count: number;
}

export function UserProfile({ fromId }: UserProfileProps) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('week');
  const [timeSeries, setTimeSeries] = useState<{ messagesOverTime: TimeSeries[]; reactionsOverTime: TimeSeries[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState({
    call_number: 1,
    notes: '',
    objections: '',
    plans_discussed: '',
    created_by: '',
  });

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(fromId)}`)
      .then((r) => {
        if (!r.ok) throw new Error('User not found');
        return r.json();
      })
      .then(setUser)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fromId]);

  useEffect(() => {
    if (!fromId) return;
    const params = new URLSearchParams({ groupBy });
    fetch(`/api/users/${encodeURIComponent(fromId)}/stats?${params}`)
      .then((r) => r.json())
      .then(setTimeSeries)
      .catch(() => setTimeSeries(null));
  }, [fromId, groupBy]);

  const handlePatch = async (updates: { is_premium?: boolean; assigned_to?: string; notes?: string }) => {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(fromId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Update failed');
      const updated = await res.json();
      setUser((u) => (u ? { ...u, ...updated } : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(fromId)}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...callForm,
          called_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to log call');
      const newCall = await res.json();
      setUser((u) => (u ? { ...u, calls: [...u.calls, newCall].sort((a, b) => a.call_number - b.call_number) } : null));
      setShowCallForm(false);
      setCallForm({ call_number: 1, notes: '', objections: '', plans_discussed: '', created_by: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log call');
    } finally {
      setSaving(false);
    }
  };

  const formatPeriod = (p: string | null) =>
    p ? new Date(p).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  if (loading) return <div className="card">Loading…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!user) return <div className="card">User not found.</div>;

  const messagesData = (timeSeries?.messagesOverTime ?? []).map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));
  const reactionsData = (timeSeries?.reactionsOverTime ?? []).map((p) => ({
    ...p,
    periodLabel: formatPeriod(p.period),
  }));

  const usedCallNumbers = user.calls.map((c) => c.call_number);

  return (
    <div>
      <div className="user-detail-header">
        <h1>{user.display_name || user.from_id}</h1>
        <a href="/contacts" className="btn btn-secondary">Back to contacts</a>
      </div>
      <p style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        <code>{user.from_id}</code>
      </p>

      <div className="stats-row">
        <div className="kpi-card">
          <div className="value">{user.stats.messagesSent.toLocaleString()}</div>
          <div className="label">Messages sent</div>
        </div>
        <div className="kpi-card">
          <div className="value">{user.stats.reactionsGiven.toLocaleString()}</div>
          <div className="label">Reactions given</div>
        </div>
        <div className="kpi-card">
          <div className="value">{user.stats.reactionsReceived.toLocaleString()}</div>
          <div className="label">Reactions received</div>
        </div>
      </div>

      <div className="filters">
        <label>
          Group by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h2>Messages over time (this user)</h2>
        <div className="chart-container">
          {messagesData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messagesData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  formatter={(value: number) => [value, 'Messages']}
                />
                <Area type="monotone" dataKey="count" stroke="#1d9bf0" fill="#1d9bf0" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No message data.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Reactions over time (this user)</h2>
        <div className="chart-container">
          {reactionsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={reactionsData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f3336" />
                <XAxis dataKey="periodLabel" stroke="#8b98a5" fontSize={12} />
                <YAxis stroke="#8b98a5" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#16181c', border: '1px solid #2f3336', borderRadius: 8 }}
                  formatter={(value: number) => [value, 'Reactions']}
                />
                <Area type="monotone" dataKey="count" stroke="#00ba7c" fill="#00ba7c" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b98a5' }}>
              No reaction data.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>CRM &amp; follow-up</h2>
        <div className="form-group">
          <div className="toggle-wrap">
            <input
              type="checkbox"
              id="is_premium"
              checked={user.is_premium}
              onChange={(e) => handlePatch({ is_premium: e.target.checked })}
              disabled={saving}
            />
            <label htmlFor="is_premium">In Premium</label>
          </div>
        </div>
        <div className="form-group">
          <label>Assigned to</label>
          <input
            type="text"
            value={user.assigned_to ?? ''}
            onChange={(e) => setUser((u) => (u ? { ...u, assigned_to: e.target.value || null } : null))}
            onBlur={() => handlePatch({ assigned_to: user.assigned_to ?? '' })}
            placeholder="Operator name"
          />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea
            value={user.notes ?? ''}
            onChange={(e) => setUser((u) => (u ? { ...u, notes: e.target.value || null } : null))}
            onBlur={() => handlePatch({ notes: user.notes ?? '' })}
            placeholder="Free-form notes about this contact"
          />
        </div>
      </div>

      <div className="card">
        <h2>Calls (upsell follow-up)</h2>
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Log calls 1–10 with notes, objections, and plans discussed.
        </p>
        {!showCallForm ? (
          <button type="button" className="btn" onClick={() => setShowCallForm(true)} disabled={user.calls.length >= 10}>
            Log call
          </button>
        ) : (
          <form onSubmit={handleSubmitCall}>
            <div className="form-group">
              <label>Call number (1–10)</label>
              <select
                value={callForm.call_number}
                onChange={(e) => setCallForm((f) => ({ ...f, call_number: Number(e.target.value) }))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n} disabled={usedCallNumbers.includes(n)}>
                    Call {n} {usedCallNumbers.includes(n) ? '(already logged)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Notes (what was discussed)</label>
              <textarea
                value={callForm.notes}
                onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="What was discussed in the call"
              />
            </div>
            <div className="form-group">
              <label>Objections</label>
              <textarea
                value={callForm.objections}
                onChange={(e) => setCallForm((f) => ({ ...f, objections: e.target.value }))}
                placeholder="Why they haven't joined Premium / payment concerns"
              />
            </div>
            <div className="form-group">
              <label>Plans discussed</label>
              <textarea
                value={callForm.plans_discussed}
                onChange={(e) => setCallForm((f) => ({ ...f, plans_discussed: e.target.value }))}
                placeholder="Payment plans, offers, etc."
              />
            </div>
            <div className="form-group">
              <label>Created by</label>
              <input
                type="text"
                value={callForm.created_by}
                onChange={(e) => setCallForm((f) => ({ ...f, created_by: e.target.value }))}
                placeholder="Operator name"
              />
            </div>
            <button type="submit" className="btn" disabled={saving}>Save call</button>
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setShowCallForm(false)}>
              Cancel
            </button>
          </form>
        )}

        <ul className="calls-list" style={{ marginTop: '1.5rem' }}>
          {user.calls.map((c) => (
            <li key={c.id}>
              <div className="call-meta">
                Call {c.call_number} · {formatDate(c.called_at)} · {c.created_by || '—'}
              </div>
              {c.notes && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Notes:</strong> {c.notes}</p>}
              {c.objections && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Objections:</strong> {c.objections}</p>}
              {c.plans_discussed && <p style={{ margin: '0.35rem 0', fontSize: '0.875rem' }}><strong>Plans discussed:</strong> {c.plans_discussed}</p>}
            </li>
          ))}
        </ul>
        {user.calls.length === 0 && !showCallForm && (
          <p style={{ color: '#8b98a5', marginTop: '1rem', fontSize: '0.875rem' }}>No calls logged yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Reactions given (who they react to)</h2>
        <ReactionsGivenList fromId={fromId} />
      </div>

      <div className="card">
        <h2>Recent messages</h2>
        <UserMessagesList fromId={fromId} />
      </div>
    </div>
  );
}

function ReactionsGivenList({ fromId }: { fromId: string }) {
  const [list, setList] = useState<{ receiverFromId: string; receiverName: string | null; count: number }[]>([]);
  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(fromId)}/reactions-given`)
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList([]));
  }, [fromId]);
  if (list.length === 0) return <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>No reactions given.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>User</th><th>Reactions given</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.receiverFromId}>
              <td>{r.receiverName || r.receiverFromId}</td>
              <td>{r.count}</td>
              <td><a href={`/users/${encodeURIComponent(r.receiverFromId)}`}>View profile</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserMessagesList({ fromId }: { fromId: string }) {
  const [data, setData] = useState<{ messages: { date: string; text: string | null }[] } | null>(null);
  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(fromId)}/messages?limit=15`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, [fromId]);
  if (!data) return <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>Loading…</p>;
  if (data.messages.length === 0) return <p style={{ color: '#8b98a5', fontSize: '0.875rem' }}>No messages.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {data.messages.map((m, i) => (
        <li key={i} style={{ borderBottom: '1px solid #2f3336', padding: '0.75rem 0' }}>
          <div style={{ fontSize: '0.8125rem', color: '#8b98a5', marginBottom: '0.25rem' }}>
            {new Date(m.date).toLocaleString('en-US')}
          </div>
          <div style={{ fontSize: '0.875rem' }}>{(m.text || '').slice(0, 300)}{(m.text && m.text.length > 300) ? '…' : ''}</div>
        </li>
      ))}
    </ul>
  );
}
