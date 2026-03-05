import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health – liveness probe only.
 * Do not touch DB here; otherwise temporary DB saturation can mark the app as
 * unhealthy and trigger restart loops.
 */
export async function GET() {
  log.api('Health check OK (liveness)');
  return NextResponse.json({
    ok: true,
    probe: 'liveness',
  });
}
