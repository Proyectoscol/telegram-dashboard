import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userRes = await pool.query('SELECT id FROM users WHERE from_id = $1', [fromId]);
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await request.json();
    const {
      call_number,
      called_at,
      notes,
      objections,
      plans_discussed,
      created_by,
    } = body;
    if (call_number == null || call_number < 1 || call_number > 10) {
      return NextResponse.json(
        { error: 'call_number must be between 1 and 10' },
        { status: 400 }
      );
    }
    const { rows } = await pool.query(
      `INSERT INTO contact_calls (user_id, call_number, called_at, notes, objections, plans_discussed, created_by)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7)
       RETURNING id, user_id, call_number, called_at, notes, objections, plans_discussed, created_by, created_at`,
      [
        user.id,
        call_number,
        called_at || new Date().toISOString(),
        notes ?? null,
        objections ?? null,
        plans_discussed ?? null,
        created_by ?? null,
      ]
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('create call error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create call' },
      { status: 500 }
    );
  }
}
