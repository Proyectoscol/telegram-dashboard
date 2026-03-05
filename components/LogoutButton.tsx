'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  if (!hasSupabase) return null;

  async function doSignOut() {
    setShowConfirm(false);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className={className ?? 'nav-logout'}
      >
        Sign out
      </button>
      {showConfirm && (
        <div className="logout-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
          <div className="logout-confirm-card">
            <h3 id="logout-confirm-title" style={{ margin: '0 0 1rem', fontSize: '1.125rem' }}>
              Sign out
            </h3>
            <p style={{ color: '#8b98a5', margin: '0 0 1.25rem', fontSize: '0.9375rem' }}>
              Are you sure you want to sign out?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => doSignOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
