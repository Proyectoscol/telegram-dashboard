import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface MemberRow {
  fromId: string;
  username: string | null;
  displayName: string | null;
  groupId: bigint | null;
}

/**
 * Parse members CSV from Telegram scraper.
 * Expected header: username,user id,access hash,name,group,group id
 * Any BOM, extra spaces, or \r\n are handled.
 */
function parseMembersCSV(text: string): { rows: MemberRow[]; groupId: bigint | null; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length === 0) return { rows: [], groupId: null, errors: ['Empty file'] };

  const rawHeader = lines[0].replace(/^\uFEFF/, '').trim();
  const headerCols = rawHeader.split(',').map((h) => h.trim().toLowerCase());

  const usernameIdx = headerCols.findIndex((h) => h === 'username');
  const userIdIdx = headerCols.findIndex((h) => h === 'user id');
  const nameIdx = headerCols.findIndex((h) => h === 'name');
  const groupIdIdx = headerCols.findIndex((h) => h === 'group id');

  if (userIdIdx === -1) {
    return { rows: [], groupId: null, errors: ['CSV header missing required column "user id"'] };
  }

  const rows: MemberRow[] = [];
  let groupId: bigint | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',');
    const rawUserId = cols[userIdIdx]?.trim();
    if (!rawUserId || rawUserId === '') {
      if (errors.length < 20) errors.push(`Line ${i + 1}: missing user id`);
      continue;
    }

    const parsedUserId = BigInt(rawUserId);
    if (parsedUserId === 0n) {
      if (errors.length < 20) errors.push(`Line ${i + 1}: invalid user id "${rawUserId}"`);
      continue;
    }
    const fromId = `user${rawUserId}`;
    const username = usernameIdx >= 0 && cols[usernameIdx]?.trim() ? cols[usernameIdx].trim() : null;
    const displayName = nameIdx >= 0 && cols[nameIdx]?.trim() ? cols[nameIdx].trim() : null;

    if (groupIdIdx >= 0 && cols[groupIdIdx]?.trim() && groupId === null) {
      try {
        groupId = BigInt(cols[groupIdIdx].trim());
      } catch {
        // ignore invalid group id
      }
    }

    rows.push({ fromId, username, displayName, groupId: null });
  }

  return { rows, groupId, errors };
}

/**
 * POST /api/import/members
 * Accepts multipart/form-data with field "file" (CSV).
 * 1. Resets is_current_member = FALSE for all users in the group (via messages).
 * 2. Upserts each CSV row, setting is_current_member = TRUE.
 * Returns: { added, updated, total, groupId, durationMs, errors? }
 */
export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a .csv' }, { status: 400 });
    }

    const text = await file.text();
    const { rows, groupId, errors: parseErrors } = parseMembersCSV(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in CSV', parseErrors },
        { status: 400 }
      );
    }

    log.startup(`[members-import] ▶ Starting — ${rows.length} members from ${file.name} groupId=${groupId}`);

    let added = 0;
    let updated = 0;
    const errors: string[] = [...parseErrors];
    const maxErrors = 50;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: mark everyone in this group as NOT current member
      // "members of this group" = users who have messages in this chat
      if (groupId !== null) {
        await client.query(
          `UPDATE users SET is_current_member = FALSE, updated_at = NOW()
           WHERE from_id IN (
             SELECT DISTINCT from_id FROM messages WHERE chat_id = $1 AND from_id IS NOT NULL
             UNION
             SELECT DISTINCT reactor_from_id FROM reactions WHERE chat_id = $1
           )`,
          [String(groupId)]
        );
        log.startup(`[members-import] Reset is_current_member=FALSE for group ${groupId}`);
      } else {
        // No group id in CSV — reset all users
        await client.query(
          `UPDATE users SET is_current_member = FALSE, updated_at = NOW()`
        );
        log.startup(`[members-import] Reset is_current_member=FALSE for all users (no groupId in CSV)`);
      }

      // Step 2: upsert each member row
      const fromIds = rows.map((r) => r.fromId);
      const existingRes = await client.query<{ from_id: string }>(
        'SELECT from_id FROM users WHERE from_id = ANY($1::text[])',
        [fromIds]
      );
      const existingSet = new Set(existingRes.rows.map((r) => r.from_id));

      const batches = chunks(rows, BATCH_SIZE);
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const batch = batches[bIdx];
        try {
          await client.query(
            `INSERT INTO users (from_id, display_name, username, is_current_member, member_since, updated_at)
             SELECT
               unnest($1::text[]),
               unnest($2::text[]),
               unnest($3::text[]),
               TRUE,
               NOW(),
               NOW()
             ON CONFLICT (from_id) DO UPDATE SET
               is_current_member = TRUE,
               display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
               username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
               member_since = COALESCE(users.member_since, NOW()),
               updated_at = NOW()`,
            [
              batch.map((r) => r.fromId),
              batch.map((r) => r.displayName ?? r.fromId),
              batch.map((r) => r.username),
            ]
          );
          for (const r of batch) {
            if (existingSet.has(r.fromId)) updated++;
            else added++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (errors.length < maxErrors) errors.push(`batch ${bIdx + 1}: ${msg}`);
          log.error('members-import', `Batch ${bIdx + 1} failed`, err);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - t0;
    log.startup(`[members-import] 🏁 Done — ${durationMs}ms | added=${added} | updated=${updated} | total=${rows.length} | groupId=${groupId}`);

    return NextResponse.json({
      added,
      updated,
      total: rows.length,
      groupId: groupId != null ? String(groupId) : null,
      durationMs,
      errors: errors.length > 0 ? errors.slice(0, maxErrors) : undefined,
      errorCount: errors.length,
    });
  } catch (err) {
    log.error('members-import', 'Members import failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}
