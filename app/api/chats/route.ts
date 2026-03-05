import { NextResponse } from 'next/server';
import { getChatsData } from '@/lib/data/chats';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const rows = await getChatsData();
    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('chats', 'Chats failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch chats' },
      { status: 500 }
    );
  }
}
