import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const { rows } = await pool.query(
      `SELECT m.from_id AS receiver_from_id, u.display_name AS receiver_name, COUNT(*)::int AS count
       FROM reactions r
       JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
       LEFT JOIN users u ON u.from_id = m.from_id
       WHERE r.reactor_from_id = $1
       GROUP BY m.from_id, u.display_name
       ORDER BY count DESC`,
      [fromId]
    );
    return NextResponse.json(rows.map((r) => ({
      receiverFromId: r.receiver_from_id,
      receiverName: r.receiver_name,
      count: r.count,
    })));
  } catch (err) {
    console.error('reactions-given error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch reactions' },
      { status: 500 }
    );
  }
}
