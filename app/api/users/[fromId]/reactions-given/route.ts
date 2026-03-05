import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const { searchParams } = new URL(request.url);
    const chatIds = parseChatIds(searchParams);
    const queryParams: (string | number[])[] = [fromId];
    const chatCond = chatIds && chatIds.length > 0 ? ' AND r.chat_id = ANY($2::bigint[])' : '';
    if (chatIds && chatIds.length > 0) queryParams.push(chatIds);
    const { rows } = await pool.query(
      `SELECT r.chat_id, c.name AS chat_name, c.slug AS chat_slug, m.from_id AS receiver_from_id, u.display_name AS receiver_name, COUNT(*)::int AS count
       FROM reactions r
       JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
       LEFT JOIN users u ON u.from_id = m.from_id
       LEFT JOIN chats c ON c.id = r.chat_id
       WHERE r.reactor_from_id = $1${chatCond}
       GROUP BY r.chat_id, c.name, c.slug, m.from_id, u.display_name
       ORDER BY r.chat_id, count DESC`,
      queryParams
    );
    return NextResponse.json(rows.map((r: { chat_id: number; chat_name: string | null; chat_slug: string | null; receiver_from_id: string; receiver_name: string | null; count: number }) => ({
      chatId: r.chat_id,
      chatName: r.chat_name ?? null,
      chatSlug: r.chat_slug ?? null,
      receiverFromId: r.receiver_from_id,
      receiverName: r.receiver_name,
      count: r.count,
    })));
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('reactions-given', 'Reactions given failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch reactions' },
      { status: 500 }
    );
  }
}
