/**
 * Parse members CSV from Telegram scraper.
 * Expected header: username, user id, access hash, name, group, group id
 * Used by Group Members (weekly snapshot) and Group Members Premium (weekly snapshot).
 */

export interface MemberRow {
  fromId: string;
  username: string | null;
  displayName: string | null;
  groupId: bigint | null;
}

export function parseMembersCSV(
  text: string
): { rows: MemberRow[]; groupId: bigint | null; errors: string[] } {
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
    if (parsedUserId === BigInt(0)) {
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
