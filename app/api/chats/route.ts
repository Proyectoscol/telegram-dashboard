import { NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      'SELECT id, name, type, slug, created_at FROM chats ORDER BY slug'
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('chats error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch chats' },
      { status: 500 }
    );
  }
}
