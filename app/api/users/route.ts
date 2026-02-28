import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const isPremium = searchParams.get('is_premium');
    const assignedTo = searchParams.get('assigned_to');
    const chatId = searchParams.get('chatId');

    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];
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
    if (chatId) {
      params.push(chatId);
      idx++;
    }

    const where = conditions.join(' AND ');
    const chatFilter = chatId ? ` AND m.chat_id = $${params.length}` : '';

    const query = `
      WITH last_activity AS (
        SELECT from_id, MAX(date) AS last_date
        FROM messages m
        WHERE from_id IS NOT NULL ${chatFilter}
        GROUP BY from_id
      ),
      call_counts AS (
        SELECT user_id, COUNT(*)::int AS call_count, MAX(called_at) AS last_call
        FROM contact_calls
        GROUP BY user_id
      )
      SELECT u.id, u.from_id, u.display_name, u.username, u.is_premium, u.assigned_to, u.notes,
             la.last_date AS last_activity,
             COALESCE(cc.call_count, 0) AS call_count,
             cc.last_call AS last_call_at
      FROM users u
      LEFT JOIN last_activity la ON la.from_id = u.from_id
      LEFT JOIN call_counts cc ON cc.user_id = u.id
      WHERE ${where}
      ORDER BY la.last_date DESC NULLS LAST, u.display_name
    `;
    const { rows } = await pool.query(query, params);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('users list error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
