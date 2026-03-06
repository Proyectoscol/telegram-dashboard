import { ensureSchema, pool } from '@/lib/db/client';
import { getListLimits } from '@/lib/settings';
import { computeCost, formatModelPricing } from '@/lib/ai/model-pricing';
import { getOrFetch } from '@/lib/cache';

/** Returns ai_usage payload: logs, total, summary. Cached for 60 s to avoid hammering the pool. */
export async function getAiUsageData(limit?: number): Promise<{
  logs: unknown[];
  total: number;
  summary: { total_runs: number; total_prompt_tokens: number; total_completion_tokens: number; total_tokens: number; total_cost_usd: number };
}> {
  const defaultLimit = (await getListLimits()).aiUsage;
  const resolvedLimit = limit != null ? Math.min(500, Math.max(1, limit)) : defaultLimit;

  return getOrFetch(`ai-usage:${resolvedLimit}`, async () => {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, entity_type, entity_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate, created_at
     FROM ai_usage_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [resolvedLimit]
  );
  const total = await pool.query('SELECT COUNT(*)::int AS c FROM ai_usage_logs').then((r) => r.rows[0]?.c ?? 0);
  const summaryRows = await pool.query(
    `SELECT COUNT(*)::int AS total_runs,
       COALESCE(SUM(prompt_tokens), 0)::bigint AS total_prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::bigint AS total_completion_tokens,
       COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
     FROM ai_usage_logs`
  ).then((r) => r.rows[0] as { total_runs: number; total_prompt_tokens: string; total_completion_tokens: string; total_tokens: string });
  const costRows = await pool.query(
    'SELECT model, prompt_tokens, completion_tokens, cost_estimate FROM ai_usage_logs'
  );
  let totalCostUsd = 0;
  for (const row of costRows.rows as { model: string; prompt_tokens: number; completion_tokens: number; cost_estimate: number | string | null }[]) {
    const stored = row.cost_estimate != null ? Number(row.cost_estimate) : null;
    const cost = (Number.isNaN(stored as number) ? null : stored) ?? computeCost(row.model, row.prompt_tokens, row.completion_tokens);
    if (cost != null) totalCostUsd += cost;
  }
  totalCostUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;
  type Row = { id: number; entity_type: string; entity_id: number | null; model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_estimate: number | string | null; created_at: string };
  const logs = (rows as Row[]).map((row) => {
    let cost: number | null = row.cost_estimate != null ? Number(row.cost_estimate) : null;
    if (cost == null || Number.isNaN(cost)) {
      cost = computeCost(row.model, row.prompt_tokens, row.completion_tokens);
    }
    return { ...row, cost_estimate: cost, model_pricing_tooltip: formatModelPricing(row.model) };
  });
  return {
    logs,
    total,
    summary: {
      total_runs: Number(summaryRows?.total_runs ?? 0),
      total_prompt_tokens: Number(summaryRows?.total_prompt_tokens ?? 0),
      total_completion_tokens: Number(summaryRows?.total_completion_tokens ?? 0),
      total_tokens: Number(summaryRows?.total_tokens ?? 0),
      total_cost_usd: totalCostUsd,
    },
  };
  }, 60_000);
}
