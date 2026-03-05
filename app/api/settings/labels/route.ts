import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db/client';
import { log } from '@/lib/logger';
import { getPersonaLabels } from '@/lib/settings';
import { get, set, cacheKey } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LABELS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** GET /api/settings/labels – returns persona card labels for UI (title, summary, etc.). */
export async function GET() {
  try {
    const key = cacheKey('settings-labels', {});
    const cached = await get<Record<string, string>>(key);
    if (cached != null) {
      return NextResponse.json({ labels: cached }, {
        headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' },
      });
    }

    await ensureSchema();
    const labels = await getPersonaLabels();
    await set(key, labels, LABELS_CACHE_TTL_MS);
    return NextResponse.json({ labels }, {
      headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' },
    });
  } catch (err) {
    log.error('settings', 'GET labels failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load labels' },
      { status: 500 }
    );
  }
}
