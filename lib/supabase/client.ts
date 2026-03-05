import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components (browser).
 * Uses NEXT_PUBLIC_ vars so they are available in the client bundle.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY) are required for the Supabase browser client.');
  }
  return createBrowserClient(url, key);
}
