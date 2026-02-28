'use client';

import { useEffect, useState } from 'react';

interface UserRow {
  id: number;
  from_id: string | null;
  display_name: string | null;
  username: string | null;
  is_premium: boolean;
  assigned_to: string | null;
  notes: string | null;
  last_activity: string | null;
  call_count: number;
  last_call_at: string | null;
}

export default function ContactsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPremium, setFilterPremium] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (filterPremium === 'true') params.set('is_premium', 'true');
    if (filterPremium === 'false') params.set('is_premium', 'false');
    fetch(`/api/users?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load contacts');
        return r.json();
      })
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filterPremium]);

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  if (loading) return <div className="card">Loading…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h1>Contacts</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.9375rem' }}>
        All users from the Main Chat. Use filters and open a profile for CRM and call logging.
      </p>

      <div className="filters">
        <label>
          Premium status
          <select value={filterPremium} onChange={(e) => setFilterPremium(e.target.value)}>
            <option value="">All</option>
            <option value="true">Premium only</option>
            <option value="false">Not in Premium (upsell list)</option>
          </select>
        </label>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>User ID</th>
                <th>Premium</th>
                <th>Assigned to</th>
                <th>Last activity</th>
                <th>Calls</th>
                <th>Last call</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.display_name || '—'}</td>
                  <td>{u.username ? `@${u.username}` : '—'}</td>
                  <td><code style={{ fontSize: '0.8rem' }}>{u.from_id ?? '—'}</code></td>
                  <td>
                    <span className={u.is_premium ? 'badge badge-premium' : 'badge badge-default'}>
                      {u.is_premium ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{u.assigned_to || '—'}</td>
                  <td>{formatDate(u.last_activity)}</td>
                  <td>{u.call_count}</td>
                  <td>{formatDate(u.last_call_at)}</td>
                  <td>
                    <a href={u.from_id ? `/users/${encodeURIComponent(u.from_id)}` : `/users/by-id/${u.id}`}>View profile</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && (
          <p style={{ color: '#8b98a5', padding: '1rem 0' }}>No contacts yet. Import a result.json file first.</p>
        )}
      </div>
    </div>
  );
}
