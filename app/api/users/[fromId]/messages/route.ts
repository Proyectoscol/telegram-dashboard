import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { getListLimits } from '@/lib/settings';
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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limitParam = searchParams.get('limit');
    const chatIds = parseChatIds(searchParams);
    const defaultLimit = (await getListLimits()).messagesPage;
    const limit = limitParam != null
      ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || defaultLimit))
      : defaultLimit;
    const offset = (page - 1) * limit;

    const countParams: (string | number[])[] = [fromId];
    const countCond = chatIds && chatIds.length > 0 ? ' AND chat_id = ANY($2::bigint[])' : '';
    if (chatIds && chatIds.length > 0) countParams.push(chatIds);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages WHERE from_id = $1 AND type = 'message'${countCond}`,
      countParams
    );
    const total = countRes.rows[0]?.c ?? 0;

    const queryParams: (string | number | number[])[] = [fromId, limit, offset];
    if (chatIds && chatIds.length > 0) queryParams.push(chatIds);
    const queryCond = chatIds && chatIds.length > 0 ? ' AND m.chat_id = ANY($4::bigint[])' : '';
    const { rows } = await pool.query(
      `SELECT m.id, m.chat_id, c.name AS chat_name, c.slug AS chat_slug, m.message_id, m.date, m.text, m.reply_to_message_id, m.edited_at, m.media_type, m.created_at
       FROM messages m
       LEFT JOIN chats c ON c.id = m.chat_id
       WHERE m.from_id = $1 AND m.type = 'message'${queryCond}
       ORDER BY m.date DESC
       LIMIT $2 OFFSET $3`,
      queryParams
    );
    const messages = rows.map((r: { chat_name?: string; chat_slug?: string; [k: string]: unknown }) => ({
      id: r.id,
      chat_id: r.chat_id,
      chat_name: r.chat_name ?? null,
      chat_slug: r.chat_slug ?? null,
      message_id: r.message_id,
      date: r.date,
      text: r.text,
      reply_to_message_id: r.reply_to_message_id,
      edited_at: r.edited_at,
      media_type: r.media_type,
      created_at: r.created_at,
    }));
    return NextResponse.json({
      messages,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-messages', 'User messages failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
