import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

/** One user from the user-info JSON (id maps to from_id as "user" + id) */
interface UserInfoEntry {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  premium?: boolean;
  verified?: boolean;
  fake?: boolean;
  bot?: boolean;
  last_seen?: string | null;
  last_seen_exact?: string | null;
  status_type?: string | null;
  bio?: string | null;
}

function parseLastSeen(s: string | null | undefined): Date | null {
  if (s == null || typeof s !== 'string' || !s.trim()) return null;
  const trimmed = s.trim();
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

const BATCH_SIZE = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    const text = await file.text();
    const data = JSON.parse(text) as Record<string, UserInfoEntry>;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return NextResponse.json(
        { error: 'Invalid file: expected an object of user entries' },
        { status: 400 }
      );
    }

    const entries = Object.values(data).filter((e): e is UserInfoEntry => e != null && typeof e === 'object' && typeof e.id === 'number');
    log.startup(`[users-update] ▶ Starting — ${entries.length} user entries from ${file.name}`);

    type Row = {
      fromId: string;
      displayName: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      telegramPremium: boolean;
      telegramVerified: boolean;
      telegramFake: boolean;
      telegramBot: boolean;
      telegramStatusType: string | null;
      telegramBio: string | null;
      telegramLastSeen: Date | null;
    };

    const rows: Row[] = [];
    for (const entry of entries) {
      const fromId = 'user' + entry.id;
      const firstName = entry.first_name ?? null;
      const lastName = entry.last_name ?? null;
      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || entry.username || fromId;
      rows.push({
        fromId,
        displayName,
        username: entry.username ?? null,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: entry.phone && String(entry.phone).trim() ? String(entry.phone).trim() : null,
        telegramPremium: !!entry.premium,
        telegramVerified: !!entry.verified,
        telegramFake: !!entry.fake,
        telegramBot: !!entry.bot,
        telegramStatusType: entry.status_type && String(entry.status_type).trim() ? String(entry.status_type).trim() : null,
        telegramBio: entry.bio != null && String(entry.bio).trim() ? String(entry.bio).trim() : null,
        telegramLastSeen: parseLastSeen(entry.last_seen_exact ?? entry.last_seen),
      });
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    const maxErrors = 50;

    const batches = chunks(rows, BATCH_SIZE);
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const t1 = Date.now();
      try {
        const fromIds = batch.map((r) => r.fromId);
        const existing = await pool.query<{ from_id: string }>(
          'SELECT from_id FROM users WHERE from_id = ANY($1::text[])',
          [fromIds]
        );
        const existingSet = new Set(existing.rows.map((r) => r.from_id));

        await pool.query(
          `INSERT INTO users (
            from_id, display_name, username, first_name, last_name, phone,
            telegram_premium, telegram_verified, telegram_fake, telegram_bot,
            telegram_status_type, telegram_bio, telegram_last_seen, updated_at
          )
          SELECT
            unnest($1::text[]),
            unnest($2::text[]),
            unnest($3::text[]),
            unnest($4::text[]),
            unnest($5::text[]),
            unnest($6::text[]),
            unnest($7::boolean[]),
            unnest($8::boolean[]),
            unnest($9::boolean[]),
            unnest($10::boolean[]),
            unnest($11::text[]),
            unnest($12::text[]),
            unnest($13::timestamptz[]),
            NOW()
          ON CONFLICT (from_id) DO UPDATE SET
            display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
            username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
            first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
            last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), users.last_name),
            phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users.phone),
            telegram_premium = EXCLUDED.telegram_premium,
            telegram_verified = EXCLUDED.telegram_verified,
            telegram_fake = EXCLUDED.telegram_fake,
            telegram_bot = EXCLUDED.telegram_bot,
            telegram_status_type = COALESCE(NULLIF(EXCLUDED.telegram_status_type, ''), users.telegram_status_type),
            telegram_bio = COALESCE(NULLIF(EXCLUDED.telegram_bio, ''), users.telegram_bio),
            telegram_last_seen = COALESCE(EXCLUDED.telegram_last_seen, users.telegram_last_seen),
            updated_at = NOW()`,
          [
            batch.map((r) => r.fromId),
            batch.map((r) => r.displayName),
            batch.map((r) => r.username),
            batch.map((r) => r.firstName),
            batch.map((r) => r.lastName),
            batch.map((r) => r.phone),
            batch.map((r) => r.telegramPremium),
            batch.map((r) => r.telegramVerified),
            batch.map((r) => r.telegramFake),
            batch.map((r) => r.telegramBot),
            batch.map((r) => r.telegramStatusType),
            batch.map((r) => r.telegramBio),
            batch.map((r) => r.telegramLastSeen),
          ]
        );

        for (const fromId of fromIds) {
          if (existingSet.has(fromId)) updated++;
          else created++;
        }
        log.startup(`[users-update] Batch ${batchIdx + 1}/${batches.length} — ${batch.length} users in ${Date.now() - t1}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < maxErrors) errors.push(`batch ${batchIdx + 1}: ${msg}`);
        log.error('import-users-update', `Batch ${batchIdx + 1} failed`, err);
      }
    }

    const durationMs = Date.now() - t0;
    log.startup(`[users-update] 🏁 Done — ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s) | created: ${created} | updated: ${updated} | total: ${entries.length}`);

    return NextResponse.json({
      created,
      updated,
      total: entries.length,
      durationMs,
      errors: errors.length > 0 ? errors.slice(0, maxErrors) : undefined,
      errorCount: errors.length,
    });
  } catch (err) {
    const { log: logger } = await import('@/lib/logger');
    logger.error('import-users-update', 'Users update import failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}
