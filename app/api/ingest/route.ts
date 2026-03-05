import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db/client';
import { ingestExport } from '@/lib/ingest/ingest';
import type { TelegramExport } from '@/lib/ingest/types';

export const runtime = 'nodejs';
/** Allow long-running uploads (e.g. 5MB+ Telegram export). If you get 502, increase the reverse-proxy timeout (e.g. Easy Panel / Traefik) to at least 300s. */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    const text = await file.text();
    const data = JSON.parse(text) as TelegramExport;
    if (typeof data.id !== 'number' || !Array.isArray(data.messages)) {
      return NextResponse.json(
        { error: 'Invalid export: expected id and messages array' },
        { status: 400 }
      );
    }
    const result = await ingestExport(data, file.name);
    return NextResponse.json(result);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('ingest', 'Ingest failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 }
    );
  }
}
