'use client';

export interface ChatOption {
  id: number;
  name: string;
  slug: string;
}

interface ChatSelectorProps {
  chats: ChatOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Label above the control (e.g. "Chats" or "Chats for persona context") */
  label: string;
  /** Shown when "All chats" is selected (checkbox variant only) */
  allChatsLabel?: string;
  /** Shown when "Only these" is selected (checkbox variant only) */
  onlyTheseLabel?: string;
  /** Optional hint below the list */
  hint?: string;
  /** Compact layout (e.g. for filters row) */
  compact?: boolean;
  /** 'toggles' = list of chats with Apple-style switch each, no "All chats". 'checkboxes' = original All chats + per-chat checkboxes */
  variant?: 'checkboxes' | 'toggles';
}

/**
 * Chat selection: either toggles (Dashboard) or checkboxes (Settings, etc.).
 * - toggles: always show each chat with a switch; all selected by default in parent.
 * - checkboxes: "All chats" + "Only these" with checkboxes per chat.
 */
export function ChatSelector({
  chats,
  selectedIds,
  onChange,
  label,
  allChatsLabel = 'All chats',
  onlyTheseLabel = 'Only these chats',
  hint,
  compact = false,
  variant = 'checkboxes',
}: ChatSelectorProps) {
  if (chats.length === 0) return null;

  if (variant === 'toggles') {
    return (
      <div style={{ marginBottom: compact ? '0' : '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
            onClick={() => onChange(chats.map((c) => c.id))}
          >
            Select all
          </button>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.5rem' }}>
          {chats.map((c) => {
            const isOn = selectedIds.includes(c.id);
            return (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.5rem 0.6rem',
                  background: '#16181c',
                  border: '1px solid #2f3336',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: '0.875rem', color: '#e7e9ea' }}>{c.name || c.slug || String(c.id)}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-label={`${isOn ? 'Exclude' : 'Include'} ${c.name || c.slug || String(c.id)}`}
                  className="toggle-switch"
                  data-on={isOn ? 'true' : 'false'}
                  onClick={() => {
                    if (isOn) onChange(selectedIds.filter((id) => id !== c.id));
                    else onChange([...selectedIds, c.id]);
                  }}
                >
                  <span className="toggle-switch-thumb" />
                </button>
              </li>
            );
          })}
        </ul>
        <span style={{ fontSize: '0.75rem', color: '#8b98a5', marginTop: '0.35rem', display: 'block' }}>
          {selectedIds.length} of {chats.length} selected
        </span>
        {hint && <p style={{ fontSize: '0.75rem', color: '#8b98a5', marginTop: '0.35rem', marginBottom: 0 }}>{hint}</p>}
      </div>
    );
  }

  const allChats = selectedIds.length === 0;

  return (
    <div style={{ marginBottom: compact ? '0' : '1rem' }}>
      <span style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.35rem' }}>{label}</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={allChats}
          onChange={(e) => {
            if (e.target.checked) onChange([]);
            else onChange(chats.map((c) => c.id));
          }}
        />
        <span style={{ fontSize: '0.875rem' }}>{allChatsLabel}</span>
      </label>
      {!allChats && (
        <div style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.8125rem', color: '#8b98a5', width: '100%' }}>{onlyTheseLabel}</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              onClick={() => onChange(chats.map((c) => c.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
            {chats.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selectedIds, c.id]);
                    else onChange(selectedIds.filter((id) => id !== c.id));
                  }}
                />
                <span>{c.name || c.slug || String(c.id)}</span>
              </label>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: '#8b98a5' }}>{selectedIds.length} selected</span>
          )}
        </div>
      )}
      {hint && <p style={{ fontSize: '0.75rem', color: '#8b98a5', marginTop: '0.35rem', marginBottom: 0 }}>{hint}</p>}
    </div>
  );
}
