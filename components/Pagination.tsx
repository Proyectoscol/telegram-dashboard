'use client';

const PAGE_SIZE = 10;

export { PAGE_SIZE };

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Optional label e.g. "contacts" for "Showing 1–10 of 45 contacts" */
  itemLabel?: string;
}

export function Pagination({ currentPage, totalItems, onPageChange, itemLabel = 'items' }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const start = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalItems);

  if (totalPages <= 1 && totalItems <= PAGE_SIZE) {
    return (
      <div className="pagination" style={{ marginTop: '0.75rem', color: '#8b98a5', fontSize: '0.875rem' }}>
        {totalItems > 0
          ? `Showing ${totalItems} ${itemLabel}`
          : `No ${itemLabel}`}
      </div>
    );
  }

  return (
    <div className="pagination" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
      <span style={{ color: '#8b98a5', fontSize: '0.875rem' }}>
        Showing {start}–{end} of {totalItems} {itemLabel}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          style={{ padding: '0.35rem 0.6rem', fontSize: '0.8125rem' }}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span style={{ color: '#8b98a5', fontSize: '0.875rem', padding: '0 0.5rem' }}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          style={{ padding: '0.35rem 0.6rem', fontSize: '0.8125rem' }}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}
