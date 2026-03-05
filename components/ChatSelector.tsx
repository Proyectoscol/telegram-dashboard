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
  /** Shown when "All chats" is selected */
  allChatsLabel?: string;
  /** Shown when "Only these" is selected */
  onlyTheseLabel?: string;
  /** Optional hint below the list */
  hint?: string;
  /** Compact layout (e.g. for filters row) */
  compact?: boolean;
}

/**
 * Chat selection with "All chats" vs "Only these" and a list of checkboxes per chat.
 * selectedIds empty = "All chats". selectedIds non-empty = "Only these" with those checked.
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
}: ChatSelectorProps) {
  const allChats = selectedIds.length === 0;

  if (chats.length === 0) return null;

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
