import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS c FROM messages WHERE from_id = $1 AND type = \'message\'',
      [fromId]
    );
    const total = countRes.rows[0]?.c ?? 0;

    const { rows } = await pool.query(
      `SELECT id, chat_id, message_id, date, text, reply_to_message_id, edited_at, media_type, created_at
       FROM messages
       WHERE from_id = $1 AND type = 'message'
       ORDER BY date DESC
       LIMIT $2 OFFSET $3`,
      [fromId, limit, offset]
    );
    return NextResponse.json({
      messages: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('user messages error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
