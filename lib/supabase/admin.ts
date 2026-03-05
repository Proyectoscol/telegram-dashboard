import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client with service role key. Server-only; never expose to the client.
 * Bypasses RLS; use for admin operations if needed.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the Supabase admin client.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
