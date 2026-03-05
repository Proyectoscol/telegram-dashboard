/**
 * Parse chatId or chatIds from URL search params for multi-chat filtering.
 * Returns null = "all chats", or array of chat IDs (no hard limit).
 */
const MAX_CHAT_IDS = 500;

export function parseChatIds(searchParams: URLSearchParams): number[] | null {
  const fromSingle = searchParams.getAll('chatId').filter(Boolean);
  const fromMulti = searchParams.getAll('chatIds').flatMap((s) => s.split(',').map((c) => c.trim()).filter(Boolean));
  const ids = [...fromSingle, ...fromMulti];
  if (ids.length === 0) return null;
  const parsed = ids
    .map((id) => parseInt(id, 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const unique = Array.from(new Set(parsed)).slice(0, MAX_CHAT_IDS);
  return unique.length === 0 ? null : unique;
}
