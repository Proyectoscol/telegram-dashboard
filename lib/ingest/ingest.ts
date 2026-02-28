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

  // 2. Collect all user identifiers and upsert users
  const userSet = new Set<{ from_id: string; display_name: string }>();
  for (const msg of messages) {
    if (msg.from_id && msg.from) {
      userSet.add({ from_id: msg.from_id, display_name: msg.from });
    }
    if (msg.actor_id && msg.actor) {
      userSet.add({ from_id: msg.actor_id, display_name: msg.actor });
    }
    for (const reaction of msg.reactions ?? []) {
      for (const r of reaction.recent ?? []) {
        if (r.from_id && r.from != null) {
          userSet.add({ from_id: r.from_id, display_name: r.from });
        }
      }
    }
  }
  for (const u of Array.from(userSet)) {
    await pool.query(
      `INSERT INTO users (from_id, display_name, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (from_id) DO UPDATE SET display_name = $2, updated_at = NOW()`,
      [u.from_id, u.display_name]
    );
  }
  const usersUpserted = userSet.size;

  let messagesInserted = 0;
  let messagesSkipped = 0;
  let reactionsInserted = 0;
  let reactionsSkipped = 0;

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
      }
    }
  }

  await pool.query(
    `INSERT INTO import_batches (chat_id, filename, messages_inserted, messages_skipped, reactions_inserted, reactions_skipped)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chatId, filename, messagesInserted, messagesSkipped, reactionsInserted, reactionsSkipped]
  );

  return {
    chatId,
    messagesInserted,
    messagesSkipped,
    reactionsInserted,
    reactionsSkipped,
    usersUpserted,
  };
}
