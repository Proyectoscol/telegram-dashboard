/**
 * OpenAI model pricing (USD per 1M tokens). Used for cost_estimate in ai_usage_logs and UI tooltips.
 * Update when OpenAI changes pricing: https://openai.com/api/pricing/
 */

export interface ModelOption {
  id: string;
  label: string;
  /** Input price in USD per 1M tokens */
  inputPerM: number;
  /** Output price in USD per 1M tokens */
  outputPerM: number;
}

/** Models available for persona generation and their pricing (approximate, as of 2025). */
export const PERSONA_MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-4o-mini-2024-07-18', label: 'GPT-4o mini (2024-07-18)', inputPerM: 0.15, outputPerM: 0.6 },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (latest)', inputPerM: 0.15, outputPerM: 0.6 },
  { id: 'gpt-4o', label: 'GPT-4o', inputPerM: 2.5, outputPerM: 10 },
  { id: 'gpt-4o-2024-08-06', label: 'GPT-4o (2024-08-06)', inputPerM: 2.5, outputPerM: 10 },
];

const PRICE_MAP = new Map<string | null, ModelOption>(
  PERSONA_MODEL_OPTIONS.map((o) => [o.id, o])
);

/** Get pricing for a model; returns null if unknown. */
export function getModelPricing(model: string | null): ModelOption | null {
  if (!model) return null;
  return PRICE_MAP.get(model) ?? null;
}

/** Compute cost in USD for given token counts. Returns null if model pricing unknown. */
export function computeCost(
  model: string | null,
  promptTokens: number,
  completionTokens: number
): number | null {
  const p = getModelPricing(model);
  if (!p) return null;
  const inputCost = (promptTokens / 1_000_000) * p.inputPerM;
  const outputCost = (completionTokens / 1_000_000) * p.outputPerM;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/** Human-readable pricing string for tooltips (e.g. "Input: $0.15/1M · Output: $0.60/1M"). */
export function formatModelPricing(model: string | null): string {
  const p = getModelPricing(model);
  if (!p) return 'Pricing unknown for this model.';
  return `Input: $${p.inputPerM.toFixed(2)}/1M tokens · Output: $${p.outputPerM.toFixed(2)}/1M tokens`;
}
