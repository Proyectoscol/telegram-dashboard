'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configMissing, setConfigMissing] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      createClient();
      setConfigMissing(false);
    } catch {
      setConfigMissing(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error signing in');
      setLoading(false);
    }
  }

  if (configMissing === true) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 className="login-title">New Money</h1>
          <p className="login-subtitle login-error">
            Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment and rebuild the app.
          </p>
        </div>
      </div>
    );
  }

  if (configMissing === null) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="login-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-title">New Money</h1>
        <p className="login-subtitle">Sign in to continue</p>
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <label className="login-label">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-input"
              required
            />
          </label>
          <label className="login-label">
            Password
            <div className="login-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <span aria-hidden>🙈</span>
                ) : (
                  <span aria-hidden>👁</span>
                )}
              </button>
            </div>
          </label>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-forgot">
          Forgot your password? Contact the administrator.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><div className="login-card"><p className="login-subtitle">Loading…</p></div></div>}>
      <LoginForm />
    </Suspense>
  );
}
