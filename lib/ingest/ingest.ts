import { pool } from '@/lib/db/client';
import type { TelegramExport, TelegramExportMessage } from './types';
import { getMessageText, getMediaType, parseEditedAt } from './types';

const MAIN_CHAT_SLUG = 'main';

export interface IngestResult {
  chatId: number;
  messagesInserted: number;
  messagesSkipped: number;
  reactionsInserted: number;
  reactionsSkipped: number;
  usersUpserted: number;
  /** Errors encountered (e.g. FK, invalid data); ingest continues and skips failing items */
  errors?: string[];
  messageErrors?: number;
  reactionErrors?: number;
}

export async function ingestExport(data: TelegramExport, filename: string): Promise<IngestResult> {
  const chatId = data.id;
  const messages = data.messages ?? [];
  const chatName = data.name ?? 'Unknown';
  const chatType = data.type ?? '';

  // 1. Ensure chat exists
  await pool.query(
    `INSERT INTO chats (id, name, type, slug, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET name = $2, type = $3, updated_at = NOW()`,
    [chatId, chatName, chatType, MAIN_CHAT_SLUG]
  );

  // 2. Collect all user identifiers and upsert users (include every from_id so FK is satisfied)
  const userMap = new Map<string, string>();
  const addUser = (from_id: string | undefined, display_name: string | undefined) => {
    if (!from_id || !from_id.trim()) return;
    const id = from_id.trim();
    const name = (display_name && display_name.trim()) || id;
    if (!userMap.has(id) || (name !== id && userMap.get(id) === id)) userMap.set(id, name);
  };
  for (const msg of messages) {
    addUser(msg.from_id, msg.from);
    addUser(msg.actor_id, msg.actor);
    for (const reaction of msg.reactions ?? []) {
      for (const r of reaction.recent ?? []) {
        addUser(r.from_id, r.from);
      }
    }
  }
  for (const [from_id, display_name] of Array.from(userMap.entries())) {
    await pool.query(
      `INSERT INTO users (from_id, display_name, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (from_id) DO UPDATE SET display_name = $2, updated_at = NOW()`,
      [from_id, display_name]
    );
  }
  const usersUpserted = userMap.size;

  let messagesInserted = 0;
  let messagesSkipped = 0;
  let reactionsInserted = 0;
  let reactionsSkipped = 0;
  let messageErrors = 0;
  let reactionErrors = 0;
  const errors: string[] = [];
  const maxErrors = 20;

  for (const msg of messages) {
    const messageId = msg.id;
    const type = msg.type ?? 'message';
    const fromId = msg.from_id ?? null;
    const actorId = msg.type === 'service' ? (msg.actor_id ?? null) : null;
    const text = getMessageText(msg);
    const replyToMessageId = msg.reply_to_message_id ?? null;
    const editedAt = parseEditedAt(msg);
    const mediaType = getMediaType(msg);
    let date: Date | null = null;
    if (msg.date) {
      try {
        date = new Date(msg.date.replace('Z', '+00:00'));
      } catch {
        // keep null
      }
    }

    try {
      const res = await pool.query(
        `INSERT INTO messages (chat_id, message_id, type, date, from_id, actor_id, text, reply_to_message_id, edited_at, media_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)
         ON CONFLICT (chat_id, message_id) DO NOTHING`,
        [chatId, messageId, type, date, fromId, actorId, text || null, replyToMessageId, editedAt, mediaType]
      );
      if (res.rowCount && res.rowCount > 0) {
        messagesInserted++;
      } else {
        messagesSkipped++;
      }
    } catch (err) {
      messageErrors++;
      const msgErr = err instanceof Error ? err.message : String(err);
      if (errors.length < maxErrors) errors.push(`Message ${messageId}: ${msgErr}`);
    }

    // Reactions
    for (const reaction of msg.reactions ?? []) {
      const emoji = reaction.emoji ?? '';
      for (const recent of reaction.recent ?? []) {
        const reactorFromId = recent.from_id;
        if (!reactorFromId) continue;
        let reactedAt: Date | null = null;
        if (recent.date) {
          try {
            reactedAt = new Date(recent.date.replace('Z', '+00:00'));
          } catch {
            // keep null
          }
        }
        try {
          const rRes = await pool.query(
            `INSERT INTO reactions (chat_id, message_id, reactor_from_id, emoji, reacted_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (chat_id, message_id, reactor_from_id) DO NOTHING`,
            [chatId, messageId, reactorFromId, emoji, reactedAt]
          );
          if (rRes.rowCount && rRes.rowCount > 0) {
            reactionsInserted++;
          } else {
            reactionsSkipped++;
          }
        } catch (err) {
          reactionErrors++;
          const rErr = err instanceof Error ? err.message : String(err);
          if (errors.length < maxErrors) errors.push(`Reaction msg ${messageId} by ${reactorFromId}: ${rErr}`);
        }
      }
    }
  }

  await pool.query(
    `INSERT INTO import_batches (chat_id, filename, messages_inserted, messages_skipped, reactions_inserted, reactions_skipped)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chatId, filename, messagesInserted, messagesSkipped, reactionsInserted, reactionsSkipped]
  );

  const result: IngestResult = {
    chatId,
    messagesInserted,
    messagesSkipped,
    reactionsInserted,
    reactionsSkipped,
    usersUpserted,
  };
  if (messageErrors > 0 || reactionErrors > 0) {
    result.messageErrors = messageErrors;
    result.reactionErrors = reactionErrors;
    result.errors = errors;
  }
  return result;
}
