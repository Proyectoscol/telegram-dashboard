import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { getListLimits } from '@/lib/settings';
import { parseChatIds } from '@/lib/api/chat-params';
import { generateDayInsight } from '@/lib/ai/day-insight';
import { computeCost } from '@/lib/ai/model-pricing';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Canonical key for chat_ids: sorted comma-separated, or '' for all. */
function chatIdsCanonical(chatIds: number[] | null): string {
  if (!chatIds || chatIds.length === 0) return '';
  return [...chatIds].sort((a, b) => a - b).join(',');
}

/** GET: return cached day insight if any. Query: start, end, chatId(s), fromId (optional). */
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const chatIds = parseChatIds(searchParams);
    const fromId = searchParams.get('fromId')?.trim() || '';

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (ISO) required' }, { status: 400 });
    }

    const periodStart = start.slice(0, 10); // YYYY-MM-DD
    const canonical = chatIdsCanonical(chatIds);
    const scope = fromId ? 'contact' : 'all';
    const fromIdStored = fromId || '';

    const { rows } = await pool.query(
      `SELECT id, period_start, chat_ids_canonical, scope, from_id, summary, model_used, prompt_tokens, completion_tokens, run_at
       FROM day_insights
       WHERE period_start = $1::date AND chat_ids_canonical = $2 AND scope = $3 AND from_id = $4`,
      [periodStart, canonical, scope, fromIdStored]
    );

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ insight: null, cached: false });
    }

    return NextResponse.json({
      insight: {
        id: row.id,
        period_start: row.period_start,
        scope: row.scope,
        from_id: row.from_id || null,
        summary: row.summary,
        model_used: row.model_used,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        run_at: row.run_at,
      },
      cached: true,
    });
  } catch (err) {
    log.error('day-insight', 'GET day-insight failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load day insight' },
      { status: 500 }
    );
  }
}

/** POST: generate day insight (or return existing). Body/query: start, end, chatIds, fromId (optional). */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const chatIds = parseChatIds(searchParams);
    const fromId = searchParams.get('fromId')?.trim() || '';

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (ISO) required' }, { status: 400 });
    }

    const periodStart = start.slice(0, 10);
    const canonical = chatIdsCanonical(chatIds);
    const scope = fromId ? 'contact' : 'all';
    const fromIdStored = fromId || '';

    const limits = await getListLimits();
    const maxMessages = Math.min(limits.periodDetail * 2, 150);
    const params: (string | number | number[])[] = [start, end];
    const chatCond = chatIds && chatIds.length > 0 ? 'AND m.chat_id = ANY($3::bigint[])' : '';
    if (chatIds && chatIds.length > 0) params.push(chatIds);
    const fromCond = fromId ? (chatIds?.length ? 'AND m.from_id = $4' : 'AND m.from_id = $3') : '';
    if (fromId) params.push(fromId);

    // Message count and user count for the period
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM messages m
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond} ${fromCond}`,
      params
    );
    const messageCount = countRes.rows[0]?.c ?? 0;

    const userCountRes = await pool.query(
      `SELECT COUNT(DISTINCT m.from_id)::int AS c FROM messages m
       WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz AND m.from_id IS NOT NULL ${chatCond} ${fromCond}`,
      params
    );
    const userCount = userCountRes.rows[0]?.c ?? 0;

    let messagesBlob: string;
    const periodLabel = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

    if (fromId) {
      // Contact scope: params are [start, end, fromId] or [start, end, fromId, chatIds] so chatIds = $4 when present
      const contactChatCond = chatIds && chatIds.length > 0 ? 'AND m.chat_id = ANY($4::bigint[])' : '';
      const msgsRes = await pool.query(
        `SELECT m.date, m.from_id, u.display_name, m.text, m.reply_to_message_id, m.chat_id, m.message_id
         FROM messages m
         LEFT JOIN users u ON u.from_id = m.from_id
         WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz AND m.from_id = $3 ${contactChatCond}
         ORDER BY m.date ASC
         LIMIT ${maxMessages}`,
        chatIds?.length ? [start, end, fromId, chatIds] : [start, end, fromId]
      );
      const msgs = msgsRes.rows as { date: string; from_id: string; display_name: string | null; text: string | null; reply_to_message_id: number | null; chat_id: number; message_id: number }[];
      const parentTexts: Map<string, string> = new Map();
      const pairs = new Set<string>();
      for (const m of msgs) {
        if (m.reply_to_message_id != null) pairs.add(`${m.chat_id}:${m.reply_to_message_id}`);
      }
      if (pairs.size > 0) {
        // Use unnest with two fixed-length arrays to avoid dynamic parameter counts,
        // which would conflict with PostgreSQL's prepared-statement cache when the
        // following INSERT uses a different (fixed) number of parameters.
        const chatIdArr: string[] = [];
        const msgIdArr: string[] = [];
        for (const s of Array.from(pairs)) {
          const [c, mid] = s.split(':');
          chatIdArr.push(c);
          msgIdArr.push(mid);
        }
        const parentRes = await pool.query(
          `SELECT m.chat_id, m.message_id, LEFT(m.text, 300) AS text
           FROM messages m
           WHERE (m.chat_id, m.message_id) IN (
             SELECT u1::bigint, u2::bigint FROM unnest($1::text[], $2::text[]) AS t(u1, u2)
           )`,
          [chatIdArr, msgIdArr]
        );
        for (const r of parentRes.rows as { chat_id: number; message_id: number; text: string | null }[]) {
          parentTexts.set(`${r.chat_id}:${r.message_id}`, r.text ?? '');
        }
      }
      const lines = msgs.map((m) => {
        const dateStr = m.date ? new Date(m.date).toLocaleString('en-US') : '';
        const name = m.display_name || m.from_id || '—';
        const replyPart = m.reply_to_message_id != null
          ? `[REPLY TO: "${(parentTexts.get(`${m.chat_id}:${m.reply_to_message_id}`) ?? '').replace(/"/g, "'").slice(0, 150)}"]\n`
          : '';
        return `${replyPart}${dateStr} - ${name}: ${(m.text ?? '').slice(0, 400)}`;
      });
      messagesBlob = lines.join('\n\n');
    } else {
      // All scope: all messages in period
      const msgsRes = await pool.query(
        `SELECT m.date, m.from_id, u.display_name, LEFT(m.text, 300) AS text
         FROM messages m
         LEFT JOIN users u ON u.from_id = m.from_id
         WHERE m.type = 'message' AND m.date >= $1::timestamptz AND m.date < $2::timestamptz ${chatCond}
         ORDER BY m.date ASC
         LIMIT ${maxMessages}`,
        params
      );
      const lines = (msgsRes.rows as { date: string; from_id: string | null; display_name: string | null; text: string | null }[]).map(
        (m) => `${m.date ? new Date(m.date).toLocaleString('en-US') : ''} - ${m.display_name || m.from_id || '—'}: ${(m.text ?? '').slice(0, 300)}`
      );
      messagesBlob = lines.join('\n');
    }

    const scopeDetail = scope === 'all' ? 'All contacts in the selected chat(s)' : `Single contact: ${fromId}`;

    const result = await generateDayInsight({
      periodLabel,
      messageCount,
      userCount,
      scope,
      scopeDetail,
      messagesBlob: messagesBlob || '(No messages in this period)',
    });

    await pool.query(
      `INSERT INTO day_insights (period_start, chat_ids_canonical, scope, from_id, summary, model_used, prompt_tokens, completion_tokens, run_at)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (period_start, chat_ids_canonical, scope, from_id)
       DO UPDATE SET summary = EXCLUDED.summary, model_used = EXCLUDED.model_used, prompt_tokens = EXCLUDED.prompt_tokens, completion_tokens = EXCLUDED.completion_tokens, run_at = NOW()`,
      [
        periodStart,
        canonical,
        scope,
        fromIdStored,
        result.summary,
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
      ]
    );

    const costEstimate = computeCost(result.usage.model, result.usage.prompt_tokens, result.usage.completion_tokens);
    await pool.query(
      `INSERT INTO ai_usage_logs (entity_type, entity_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
       VALUES ('day_insight', NULL, $1, $2, $3, $4, $5)`,
      [
        result.usage.model,
        result.usage.prompt_tokens,
        result.usage.completion_tokens,
        result.usage.total_tokens,
        costEstimate ?? null,
      ]
    );

    log.aiUsage('day_insight', {
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      model: result.usage.model,
      entity_type: 'day_insight',
    });

    const { rows } = await pool.query(
      `SELECT id, summary, model_used, prompt_tokens, completion_tokens, run_at
       FROM day_insights
       WHERE period_start = $1::date AND chat_ids_canonical = $2 AND scope = $3 AND from_id = $4`,
      [periodStart, canonical, scope, fromIdStored]
    );
    const insight = rows[0];

    return NextResponse.json({
      insight: insight ? {
        id: insight.id,
        summary: insight.summary,
        model_used: insight.model_used,
        prompt_tokens: insight.prompt_tokens,
        completion_tokens: insight.completion_tokens,
        run_at: insight.run_at,
      } : null,
      usage: result.usage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate day insight';
    if (msg.includes('OpenAI API key not configured')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    log.error('day-insight', 'POST day-insight failed', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
