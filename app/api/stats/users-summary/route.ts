import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');

    const chatCond = chatId ? 'AND chat_id = $1' : '';
    const chatCondM = chatId ? 'AND m.chat_id = $1' : '';
    const chatCondR = chatId ? 'AND r.chat_id = $1' : '';
    const params: (string | number)[] = [];
    if (chatId) params.push(chatId);

    const summaryQuery = `
      WITH unified AS (
        SELECT from_id AS uid, type, media_type, edited_at, reply_to_message_id, text, date FROM messages WHERE from_id IS NOT NULL AND type = 'message' ${chatCond}
        UNION ALL
        SELECT actor_id AS uid, type, media_type, edited_at, reply_to_message_id, text, date FROM messages WHERE actor_id IS NOT NULL AND type = 'service' ${chatCond}
      ),
      msg_agg AS (
        SELECT
          uid AS from_id,
          COUNT(*) FILTER (WHERE type = 'message') AS messages_sent,
          COUNT(*) FILTER (WHERE type = 'service') AS service_messages,
          COUNT(*) FILTER (WHERE media_type = 'photo') AS photos,
          COUNT(*) FILTER (WHERE media_type = 'video_file' OR media_type = 'video_message') AS videos,
          COUNT(*) FILTER (WHERE media_type = 'file' OR (media_type IS NOT NULL AND media_type NOT IN ('photo', 'video_file', 'video_message', 'audio_file'))) AS files,
          COUNT(*) FILTER (WHERE media_type = 'audio_file') AS audios,
          COUNT(*) FILTER (WHERE edited_at IS NOT NULL) AS messages_edited,
          COUNT(*) FILTER (WHERE reply_to_message_id IS NOT NULL) AS replies,
          COALESCE(SUM(LENGTH(COALESCE(text, ''))), 0)::bigint AS total_chars,
          COALESCE(SUM(GREATEST(0, LENGTH(TRIM(COALESCE(text, '')))::int - LENGTH(REPLACE(TRIM(COALESCE(text, '')), ' ', '')) + 1)), 0)::bigint AS total_words,
          MIN(date) AS first_activity,
          MAX(date) AS last_activity,
          COUNT(DISTINCT DATE(date))::int AS active_days
        FROM unified
        GROUP BY uid
      ),
      reactions_received AS (
        SELECT m.from_id, COUNT(*)::int AS reactions_received
        FROM reactions r
        JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
        WHERE m.from_id IS NOT NULL ${chatCondM}
        GROUP BY m.from_id
      ),
      reactions_given AS (
        SELECT r.reactor_from_id AS from_id, COUNT(*)::int AS reactions_given
        FROM reactions r
        WHERE 1=1 ${chatCondR}
        GROUP BY r.reactor_from_id
      ),
      top_reacted AS (
        SELECT DISTINCT ON (r.reactor_from_id) r.reactor_from_id AS from_id, m.from_id AS reacted_to_id
        FROM reactions r
        JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
        WHERE m.from_id IS NOT NULL ${chatCondM}
        GROUP BY r.reactor_from_id, m.from_id
        ORDER BY r.reactor_from_id, COUNT(*) DESC
      )
      SELECT
        u.from_id,
        u.display_name,
        u.is_premium,
        COALESCE(ma.messages_sent, 0)::int AS messages_sent,
        COALESCE(ma.service_messages, 0)::int AS service_messages,
        (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0))::int AS total_activity,
        COALESCE(rr.reactions_received, 0) AS reactions_received,
        COALESCE(rg.reactions_given, 0) AS reactions_given,
        COALESCE(ma.photos, 0)::int AS photos,
        COALESCE(ma.videos, 0)::int AS videos,
        COALESCE(ma.files, 0)::int AS files,
        COALESCE(ma.audios, 0)::int AS audios,
        COALESCE(ma.messages_edited, 0)::int AS messages_edited,
        COALESCE(ma.replies, 0)::int AS replies,
        COALESCE(ma.total_words, 0)::bigint AS total_words,
        COALESCE(ma.total_chars, 0)::bigint AS total_chars,
        ma.first_activity,
        ma.last_activity,
        COALESCE(ma.active_days, 0)::int AS active_days,
        CASE WHEN (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0)) > 0
          THEN ROUND(COALESCE(rr.reactions_received, 0)::numeric / (COALESCE(ma.messages_sent, 0) + COALESCE(ma.service_messages, 0)), 2)
          ELSE 0 END AS reactions_ratio,
        tr.reacted_to_id AS top_reacted_to_id
      FROM users u
      LEFT JOIN msg_agg ma ON ma.from_id = u.from_id
      LEFT JOIN reactions_received rr ON rr.from_id = u.from_id
      LEFT JOIN reactions_given rg ON rg.from_id = u.from_id
      LEFT JOIN top_reacted tr ON tr.from_id = u.from_id
      WHERE ma.from_id IS NOT NULL OR rr.from_id IS NOT NULL OR rg.from_id IS NOT NULL
      ORDER BY total_activity DESC NULLS LAST
    `;

    const summaryResult = await pool.query(summaryQuery, params);
    const fromIds = Array.from(summaryResult.rows)
      .map((r: { top_reacted_to_id?: string }) => r.top_reacted_to_id)
      .filter(Boolean) as string[];
    const namesQuery =
      fromIds.length > 0
        ? await pool.query(
            'SELECT from_id, display_name FROM users WHERE from_id = ANY($1)',
            [Array.from(new Set(fromIds))]
          )
        : { rows: [] };
    const nameMap = new Map<string, string>();
    for (const r of Array.from(namesQuery.rows)) {
      nameMap.set((r as { from_id: string; display_name: string }).from_id, (r as { display_name: string }).display_name);
    }

    const rows = Array.from(summaryResult.rows).map((r: Record<string, unknown>) => ({
      ...r,
      top_reacted_to_name: r.top_reacted_to_id ? nameMap.get(r.top_reacted_to_id as string) ?? r.top_reacted_to_id : null,
    }));

    return NextResponse.json(rows);
  } catch (err) {
    console.error('users-summary error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch users summary' },
      { status: 500 }
    );
  }
}
