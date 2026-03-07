import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { ensureSchema, pool } from '@/lib/db/client';
import { log } from '@/lib/logger';
import { uploadProfilePhoto } from '@/lib/supabase/upload-profile-photo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  profile_photos?: string[];
}

function parseLastSeen(s: string | null | undefined): Date | null {
  if (s == null || typeof s !== 'string' || !s.trim()) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d;
}

const BATCH_SIZE = 100;

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
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: 'File must be a .zip' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const userIdToEntry = new Map<
      number,
      { entry: UserInfoEntry; photoPaths: Set<string> }
    >();

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      if (!path.toLowerCase().endsWith('.json')) continue;

      const text = await zipEntry.async('string');
      let data: Record<string, UserInfoEntry>;
      try {
        data = JSON.parse(text) as Record<string, UserInfoEntry>;
      } catch {
        continue;
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) continue;

      for (const entry of Object.values(data)) {
        if (entry == null || typeof entry !== 'object' || typeof entry.id !== 'number') continue;

        const existing = userIdToEntry.get(entry.id);
        if (existing) {
          existing.entry = { ...existing.entry, ...entry };
          (entry.profile_photos ?? []).forEach((p) => existing!.photoPaths.add(p));
        } else {
          userIdToEntry.set(entry.id, {
            entry,
            photoPaths: new Set<string>(entry.profile_photos ?? []),
          });
        }
      }
    }

    const entries = Array.from(userIdToEntry.entries()).map(([id, { entry, photoPaths }]) => ({
      ...entry,
      id,
      profile_photos: Array.from(photoPaths),
    } as UserInfoEntry & { id: number; profile_photos: string[] }));

    log.startup(`[user-info-photos] ▶ ${entries.length} users, parsing ZIP for images`);

    const zipFilePaths = new Set<string>();
    zip.forEach((path) => {
      if (!path.endsWith('/')) zipFilePaths.add(path);
    });

    const findInZip = (photoPath: string): string | null => {
      const normalized = photoPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (zipFilePaths.has(normalized)) return normalized;
      if (zipFilePaths.has(photoPath)) return photoPath;
      return null;
    };

    const rows: {
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
      profilePhotoUrls: string[];
    }[] = [];

    let photosUploaded = 0;
    const errors: string[] = [];
    const maxErrors = 50;

    for (const entry of entries) {
      const fromId = 'user' + entry.id;
      const firstName = entry.first_name ?? null;
      const lastName = entry.last_name ?? null;
      const displayName =
        [firstName, lastName].filter(Boolean).join(' ').trim() || entry.username || fromId;

      const urls: string[] = [];
      for (const relPath of entry.profile_photos ?? []) {
        const zipPath = findInZip(relPath);
        if (!zipPath) {
          if (errors.length < maxErrors) errors.push(`ZIP missing: ${relPath} (user ${entry.id})`);
          continue;
        }
        try {
          const zipEntry = zip.files[zipPath];
          if (!zipEntry || zipEntry.dir) continue;
          const buffer = await zipEntry.async('nodebuffer');
          const filename = relPath.split('/').pop() ?? relPath.replace(/.*[/\\]/, '');
          const url = await uploadProfilePhoto(buffer, fromId, filename);
          urls.push(url);
          photosUploaded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (errors.length < maxErrors) errors.push(`Upload ${relPath}: ${msg}`);
        }
      }

      rows.push({
        fromId,
        displayName,
        username: entry.username ?? null,
        firstName: firstName || null,
        lastName: lastName || null,
        phone:
          entry.phone && String(entry.phone).trim() ? String(entry.phone).trim() : null,
        telegramPremium: !!entry.premium,
        telegramVerified: !!entry.verified,
        telegramFake: !!entry.fake,
        telegramBot: !!entry.bot,
        telegramStatusType:
          entry.status_type && String(entry.status_type).trim()
            ? String(entry.status_type).trim()
            : null,
        telegramBio:
          entry.bio != null && String(entry.bio).trim() ? String(entry.bio).trim() : null,
        telegramLastSeen: parseLastSeen(entry.last_seen_exact ?? entry.last_seen),
        profilePhotoUrls: urls,
      });
    }

    let created = 0;
    let updated = 0;

    const batches = chunks(rows, BATCH_SIZE);
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
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
            telegram_status_type, telegram_bio, telegram_last_seen,
            profile_photo_urls, updated_at
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
            unnest($14::text[])::jsonb,
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
            profile_photo_urls = CASE WHEN EXCLUDED.profile_photo_urls IS NOT NULL AND jsonb_array_length(EXCLUDED.profile_photo_urls) > 0
              THEN EXCLUDED.profile_photo_urls ELSE users.profile_photo_urls END,
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
            batch.map((r) => JSON.stringify(r.profilePhotoUrls)),
          ]
        );

        for (const fromId of fromIds) {
          if (existingSet.has(fromId)) updated++;
          else created++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < maxErrors) errors.push(`batch ${batchIdx + 1}: ${msg}`);
        log.error('import-user-info-photos', `Batch ${batchIdx + 1} failed`, err);
      }
    }

    const durationMs = Date.now() - t0;
    log.startup(
      `[user-info-photos] 🏁 ${durationMs}ms | created: ${created} | updated: ${updated} | photos: ${photosUploaded}`
    );

    return NextResponse.json({
      created,
      updated,
      total: rows.length,
      photosUploaded,
      durationMs,
      errors: errors.length > 0 ? errors.slice(0, maxErrors) : undefined,
      errorCount: errors.length,
    });
  } catch (err) {
    log.error('import-user-info-photos', 'Import failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}
