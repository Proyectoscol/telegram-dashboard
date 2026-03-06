'use client';

import { useEffect, useState } from 'react';
import { ChatSelector } from '@/components/ChatSelector';
import { LoadingCard } from '@/components/Loading';
import { Pagination, PAGE_SIZE } from '@/components/Pagination';

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
  messages_sent: number;
  reactions_received: number;
  reactions_given: number;
  has_persona?: boolean;
}

export default function ContactsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPremium, setFilterPremium] = useState<string>('');
  const [selectedChatIds, setSelectedChatIds] = useState<number[]>([]);
  const [chats, setChats] = useState<{ id: number; name: string; slug: string }[]>([]);
  const [contactsSearch, setContactsSearch] = useState('');
  type ContactsSortKey = 'display_name' | 'username' | 'from_id' | 'is_premium' | 'assigned_to' | 'last_activity' | 'call_count' | 'last_call_at' | 'messages_sent' | 'reactions_received' | 'reactions_given' | 'has_persona';
  const [contactsSortBy, setContactsSortBy] = useState<ContactsSortKey>('last_activity');
  const [contactsSortDir, setContactsSortDir] = useState<'asc' | 'desc'>('desc');
  const [contactsPage, setContactsPage] = useState(1);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/chats', { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => setChats(Array.isArray(data) ? data : []))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (filterPremium === 'true') params.set('is_premium', 'true');
    if (filterPremium === 'false') params.set('is_premium', 'false');
    selectedChatIds.forEach((id) => params.append('chatId', String(id)));
    fetch(`/api/users?${params}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load contacts');
        return r.json();
      })
      .then(setUsers)
      .catch((e) => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [filterPremium, selectedChatIds]);

  // Reset to page 1 when filters, sort, or search change
  useEffect(() => {
    setContactsPage(1);
  }, [contactsSearch, contactsSortBy, contactsSortDir, filterPremium, selectedChatIds, users.length]);

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const filteredUsers = users.filter((u) => {
    if (contactsSearch.length < 3) return true;
    const q = contactsSearch.toLowerCase().trim();
    return (
      (u.display_name?.toLowerCase().includes(q)) ||
      (u.username?.toLowerCase().includes(q)) ||
      (u.from_id?.toLowerCase().includes(q))
    );
  });

  const contactsSorted = [...filteredUsers].sort((a, b) => {
    const key = contactsSortBy;
    let va: unknown = (a as unknown as Record<string, unknown>)[key];
    let vb: unknown = (b as unknown as Record<string, unknown>)[key];
    if (key === 'last_activity' || key === 'last_call_at') {
      va = va ? new Date(va as string).getTime() : 0;
      vb = vb ? new Date(vb as string).getTime() : 0;
    } else if (key === 'is_premium' || key === 'has_persona') {
      va = va ? 1 : 0;
      vb = vb ? 1 : 0;
    } else if (key === 'display_name' || key === 'username' || key === 'from_id' || key === 'assigned_to') {
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      return contactsSortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    } else {
      va = Number(va) ?? 0;
      vb = Number(vb) ?? 0;
    }
    const n = (va as number) - (vb as number);
    return contactsSortDir === 'asc' ? n : -n;
  });

  const contactsPaged = contactsSorted.slice((contactsPage - 1) * PAGE_SIZE, contactsPage * PAGE_SIZE);

  const profileHref = (u: UserRow) => {
    const base = u.from_id ? `/users/${encodeURIComponent(u.from_id)}` : `/users/by-id/${u.id}`;
    return selectedChatIds.length > 0 ? `${base}?chatIds=${selectedChatIds.join(',')}` : base;
  };

  if (loading) return <LoadingCard message="Loading contacts…" />;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h1>Contacts</h1>
      <p style={{ color: '#8b98a5', marginBottom: '1rem', fontSize: '0.9375rem' }}>
        Users from selected chats. Use filters and open a profile for CRM and call logging.
      </p>

      <div className="filters">
        {chats.length > 0 && (
          <ChatSelector
            chats={chats}
            selectedIds={selectedChatIds}
            onChange={setSelectedChatIds}
            label="Chats"
            allChatsLabel="All chats"
            onlyTheseLabel="Show contacts from:"
            compact
          />
        )}
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
        <p style={{ color: '#8b98a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          Click a row or the name/username to open the contact profile.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <span style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
            {contactsSearch.length >= 3
              ? `Showing ${filteredUsers.length} of ${users.length} contacts`
              : `${users.length} contact${users.length === 1 ? '' : 's'}`}
          </span>
          <input
            type="search"
            placeholder="Search by name, username, or user ID (min 3 characters)"
            value={contactsSearch}
            onChange={(e) => setContactsSearch(e.target.value)}
            style={{ maxWidth: 320, padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid #2f3336', background: '#16181c', color: '#e7e9ea' }}
          />
          {(contactsSortBy !== 'last_activity' || contactsSortDir !== 'desc') && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setContactsSortBy('last_activity'); setContactsSortDir('desc'); setContactsPage(1); }}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
              title="Reset sort to default (Last activity, descending)"
            >
              Reset sort
            </button>
          )}
        </div>
        <div className="table-wrap paginated-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="th-index">#</th>
                {([
                  { key: 'display_name' as const, label: 'Name' },
                  { key: 'username' as const, label: 'Username' },
                  { key: 'from_id' as const, label: 'User ID' },
                  { key: 'is_premium' as const, label: 'Premium' },
                  { key: 'messages_sent' as const, label: 'Messages' },
                  { key: 'reactions_received' as const, label: 'Reactions rec.' },
                  { key: 'reactions_given' as const, label: 'Reactions given' },
                  { key: 'assigned_to' as const, label: 'Assigned to' },
                  { key: 'last_activity' as const, label: 'Last activity' },
                  { key: 'call_count' as const, label: 'Calls' },
                  { key: 'last_call_at' as const, label: 'Last call' },
                  { key: 'has_persona' as const, label: 'Persona' },
                ] as { key: ContactsSortKey; label: string }[]).map(({ key, label }) => (
                  <th key={key} className="sortable-th">
                    <span className="sortable-th-label">{label}</span>
                    <span className="sortable-th-arrows">
                      <button
                        type="button"
                        className={`sort-arrow ${contactsSortBy === key && contactsSortDir === 'asc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setContactsSortBy(key); setContactsSortDir('asc'); setContactsPage(1); }}
                        aria-label={`Sort by ${label} ascending`}
                        title="Sort ascending"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><path d="M5 2L2 6h6L5 2z"/></svg>
                      </button>
                      <button
                        type="button"
                        className={`sort-arrow ${contactsSortBy === key && contactsSortDir === 'desc' ? 'sort-arrow-active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setContactsSortBy(key); setContactsSortDir('desc'); setContactsPage(1); }}
                        aria-label={`Sort by ${label} descending`}
                        title="Sort descending"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><path d="M5 8L2 4h6L5 8z"/></svg>
                      </button>
                    </span>
                  </th>
                ))}
                <th className="th-action"></th>
              </tr>
            </thead>
            <tbody>
              {contactsPaged.map((u, index) => (
                <tr
                  key={u.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => window.location.assign(profileHref(u))}
                >
                  <td style={{ color: '#8b98a5' }}>{(contactsPage - 1) * PAGE_SIZE + index + 1}</td>
                  <td>
                    <a
                      href={profileHref(u)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#1d9bf0', textDecoration: 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                    >
                      {u.display_name || '—'}
                    </a>
                  </td>
                  <td>
                    {u.username ? (
                      <a
                        href={profileHref(u)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#1d9bf0', textDecoration: 'none' }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                      >
                        @{u.username}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td><code style={{ fontSize: '0.8rem' }}>{u.from_id ?? '—'}</code></td>
                  <td>
                    <span className={u.is_premium ? 'badge badge-premium' : 'badge badge-default'}>
                      {u.is_premium ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{u.messages_sent ?? 0}</td>
                  <td>{u.reactions_received ?? 0}</td>
                  <td>{u.reactions_given ?? 0}</td>
                  <td>{u.assigned_to || '—'}</td>
                  <td>{formatDate(u.last_activity)}</td>
                  <td>{u.call_count}</td>
                  <td>{formatDate(u.last_call_at)}</td>
                  <td>
                    {u.has_persona ? (
                      <a
                        href={profileHref(u)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#1d9bf0', textDecoration: 'none' }}
                      >
                        Yes
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a href={profileHref(u)}>View profile</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && (
          <p style={{ color: '#8b98a5', padding: '1rem 0' }}>No contacts yet. Import a result.json file first.</p>
        )}
        {users.length > 0 && contactsSearch.length >= 3 && filteredUsers.length === 0 && (
          <p style={{ color: '#8b98a5', padding: '1rem 0' }}>No contacts match your search.</p>
        )}
        {contactsSorted.length > 0 && (
          <Pagination
            currentPage={contactsPage}
            totalItems={contactsSorted.length}
            onPageChange={setContactsPage}
            itemLabel="contacts"
          />
        )}
      </div>
    </div>
  );
}
