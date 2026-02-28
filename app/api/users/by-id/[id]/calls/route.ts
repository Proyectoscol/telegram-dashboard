import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';

/** POST a call for a user identified by internal id (for list-only users). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSchema();
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
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
       ON CONFLICT (user_id, call_number) DO UPDATE SET
         called_at = EXCLUDED.called_at,
         notes = EXCLUDED.notes,
         objections = EXCLUDED.objections,
         plans_discussed = EXCLUDED.plans_discussed,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()
       RETURNING id, user_id, call_number, called_at, notes, objections, plans_discussed, created_by, created_at`,
      [
        id,
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
    console.error('create call by-id error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create call' },
      { status: 500 }
    );
  }
}
