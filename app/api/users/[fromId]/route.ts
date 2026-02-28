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
    const userRes = await pool.query(
      'SELECT id, from_id, display_name, is_premium, assigned_to, notes, created_at, updated_at FROM users WHERE from_id = $1',
      [fromId]
    );
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const statsRes = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND type = 'message') AS messages_sent,
        (SELECT COUNT(*)::int FROM reactions WHERE reactor_from_id = $1) AS reactions_given,
        (SELECT COUNT(*)::int FROM messages m JOIN reactions r ON m.chat_id = r.chat_id AND m.message_id = r.message_id WHERE m.from_id = $1) AS reactions_received
      `,
      [fromId]
    );
    const stats = statsRes.rows[0] || {};

    const callsRes = await pool.query(
      'SELECT id, call_number, called_at, notes, objections, plans_discussed, created_by, created_at FROM contact_calls WHERE user_id = $1 ORDER BY call_number',
      [user.id]
    );

    return NextResponse.json({
      ...user,
      stats: {
        messagesSent: parseInt(String(stats.messages_sent), 10) || 0,
        reactionsGiven: parseInt(String(stats.reactions_given), 10) || 0,
        reactionsReceived: parseInt(String(stats.reactions_received), 10) || 0,
      },
      calls: callsRes.rows,
    });
  } catch (err) {
    console.error('user detail error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const body = await request.json();
    const { is_premium, assigned_to, notes } = body;
    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let idx = 1;
    if (typeof is_premium === 'boolean') {
      updates.push(`is_premium = $${idx++}`);
      values.push(is_premium);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${idx++}`);
      values.push(assigned_to);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(notes);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    updates.push('updated_at = NOW()');
    values.push(fromId);
    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE from_id = $${idx}`,
      values
    );
    const u = await pool.query('SELECT id, from_id, display_name, is_premium, assigned_to, notes FROM users WHERE from_id = $1', [fromId]);
    return NextResponse.json(u.rows[0] || {});
  } catch (err) {
    console.error('user patch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update user' },
      { status: 500 }
    );
  }
}
