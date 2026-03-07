'use client';

import { useState, useMemo } from 'react';

export interface ExportColumn {
  key: string;
  label: string;
}

type MemberFilter = 'all' | 'member' | 'former';

function escapeCsvCell(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCellValue(key: string, value: unknown): string {
  if (value == null) return '';
  if (key === 'is_current_member') return value ? 'Member' : 'Former';
  if (key === 'is_premium') return value ? 'Yes' : 'No';
  if (key === 'first_activity' || key === 'last_activity') {
    try {
      return new Date(value as string).toLocaleDateString('en-US');
    } catch {
      return String(value);
    }
  }
  return String(value);
}

interface ExportCsvModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  filenamePrefix: string;
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}

export function ExportCsvModal({
  open,
  onClose,
  title,
  filenamePrefix,
  rows,
  columns,
}: ExportCsvModalProps) {
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(columns.map((c) => c.key)));

  const filteredRows = useMemo(() => {
    if (memberFilter === 'all') return rows;
    const isMember = memberFilter === 'member';
    return rows.filter((r) => {
      const v = r.is_current_member;
      return Boolean(v) === isMember;
    });
  }, [rows, memberFilter]);

  const selectedColumns = useMemo(
    () => columns.filter((c) => selectedKeys.has(c.key)),
    [columns, selectedKeys]
  );

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllColumns = () => setSelectedKeys(new Set(columns.map((c) => c.key)));
  const deselectAllColumns = () => setSelectedKeys(new Set());

  const downloadCsv = () => {
    const header = selectedColumns.map((c) => escapeCsvCell(c.label)).join(',');
    const body = filteredRows.map((row) =>
      selectedColumns
        .map((col) => formatCellValue(col.key, row[col.key]))
        .map(escapeCsvCell)
        .join(',')
    );
    const csv = [header, ...body].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.8125rem' }}>
              Member status
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {(['all', 'member', 'former'] as const).map((value) => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="memberFilter"
                    checked={memberFilter === value}
                    onChange={() => setMemberFilter(value)}
                  />
                  <span>
                    {value === 'all' ? 'All' : value === 'member' ? 'Members only' : 'Former only'}
                  </span>
                </label>
              ))}
            </div>
            <p style={{ color: '#8b98a5', fontSize: '0.75rem', marginTop: '0.35rem', marginBottom: 0 }}>
              {filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''} will be exported.
            </p>
          </section>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Columns to include</label>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={selectAllColumns} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                  All
                </button>
                <button type="button" className="btn btn-secondary" onClick={deselectAllColumns} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                  None
                </button>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', maxHeight: 200, overflowY: 'auto' }}>
              {columns.map((col) => (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </section>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={downloadCsv} disabled={selectedColumns.length === 0 || filteredRows.length === 0}>
              Download CSV
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
