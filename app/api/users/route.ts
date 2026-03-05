import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { get, set, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isPremium = searchParams.get('is_premium') ?? '';
    const assignedTo = searchParams.get('assigned_to') ?? '';
    const chatIds = parseChatIds(searchParams);
    const key = cacheKey('users-list', {
      is_premium: isPremium,
      assigned_to: assignedTo,
      chatIds: chatIds?.join(',') ?? 'all',
    });
    const cached = await get<unknown[]>(key);
    if (cached != null) return NextResponse.json(cached);

    await ensureSchema();

    const conditions: string[] = ['1=1'];
    const params: (string | number | number[])[] = [];
    let idx = 1;
    if (isPremium === 'true') {
      conditions.push('u.is_premium = true');
    } else if (isPremium === 'false') {
      conditions.push('u.is_premium = false');
    }
    if (assignedTo != null && assignedTo !== '') {
      params.push(assignedTo);
      conditions.push(`u.assigned_to = $${idx++}`);
    }
    if (chatIds && chatIds.length > 0) {
      params.push(chatIds);
      idx++;
    }

    const where = conditions.join(' AND ');
    const chatParamIdx = params.length; // index of chatIds in params when present
    const mChatFilter = chatIds && chatIds.length > 0 ? ` AND m.chat_id = ANY($${chatParamIdx}::bigint[])` : '';
    const rChatFilter = chatIds && chatIds.length > 0 ? ` AND r.chat_id = ANY($${chatParamIdx}::bigint[])` : '';

    const query = `
      WITH last_activity AS (
        SELECT from_id, MAX(date) AS last_date
        FROM messages m
        WHERE from_id IS NOT NULL ${mChatFilter}
        GROUP BY from_id
      ),
      call_counts AS (
        SELECT user_id, COUNT(*)::int AS call_count, MAX(called_at) AS last_call
        FROM contact_calls
        GROUP BY user_id
      ),
      msg_counts AS (
        SELECT from_id, COUNT(*)::int AS messages_sent
        FROM messages m
        WHERE m.type = 'message' AND m.from_id IS NOT NULL ${mChatFilter}
        GROUP BY from_id
      ),
      reactions_given AS (
        SELECT reactor_from_id AS from_id, COUNT(*)::int AS reactions_given
        FROM reactions r
        WHERE 1=1 ${rChatFilter}
        GROUP BY reactor_from_id
      ),
      reactions_received AS (
        SELECT m.from_id, COUNT(*)::int AS reactions_received
        FROM reactions r
        JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id
        WHERE m.from_id IS NOT NULL ${mChatFilter}
        GROUP BY m.from_id
      )
      SELECT u.id, u.from_id, u.display_name, u.username, u.is_premium, u.assigned_to, u.notes,
             la.last_date AS last_activity,
             COALESCE(cc.call_count, 0) AS call_count,
             cc.last_call AS last_call_at,
             COALESCE(mc.messages_sent, 0) AS messages_sent,
             COALESCE(rr.reactions_received, 0) AS reactions_received,
             COALESCE(rg.reactions_given, 0) AS reactions_given,
             (cp.user_id IS NOT NULL) AS has_persona
      FROM users u
      LEFT JOIN last_activity la ON la.from_id = u.from_id
      LEFT JOIN call_counts cc ON cc.user_id = u.id
      LEFT JOIN msg_counts mc ON mc.from_id = u.from_id
      LEFT JOIN reactions_received rr ON rr.from_id = u.from_id
      LEFT JOIN reactions_given rg ON rg.from_id = u.from_id
      LEFT JOIN contact_personas cp ON cp.user_id = u.id
      WHERE ${where}
      ORDER BY la.last_date DESC NULLS LAST, u.display_name
    `;
    const { rows } = await queryWithRetry(query, params);
    const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
    await set(key, rows, Math.min(cacheTtlMs, USERS_CACHE_TTL_MS));
    return NextResponse.json(rows);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('users', 'Users list failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
