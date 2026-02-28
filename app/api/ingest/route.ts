import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db/client';
import { ingestExport } from '@/lib/ingest/ingest';
import type { TelegramExport } from '@/lib/ingest/types';

export const runtime = 'nodejs';

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
    console.error('Ingest error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 }
    );
  }
}
