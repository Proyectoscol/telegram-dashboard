/**
 * OpenAI Chat Completions for day insight ("why was there activity this day?").
 * Uses getDayInsightPrompts() from settings. Server-only.
 */

import { getOpenAiApiKey } from '@/lib/settings';
import { getPersonaOpenAIModel, getDayInsightPrompts } from '@/lib/settings';

export interface DayInsightContext {
  periodLabel: string;
  messageCount: number;
  userCount: number;
  scope: 'all' | 'contact';
  scopeDetail: string;
  messagesBlob: string;
}

export interface DayInsightResult {
  summary: string;
  usage: { model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function generateDayInsight(context: DayInsightContext): Promise<DayInsightResult> {
  const [apiKey, model, prompts] = await Promise.all([
    getOpenAiApiKey(),
    getPersonaOpenAIModel(),
    getDayInsightPrompts(),
  ]);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured in Settings');
  }
  const modelToUse = model?.trim() || 'gpt-4o-mini-2024-07-18';

  const userPrompt = prompts.userPromptTemplate
    .replace(/\{\{periodLabel\}\}/g, context.periodLabel)
    .replace(/\{\{messageCount\}\}/g, String(context.messageCount))
    .replace(/\{\{userCount\}\}/g, String(context.userCount))
    .replace(/\{\{scope\}\}/g, context.scope)
    .replace(/\{\{scopeDetail\}\}/g, context.scopeDetail)
    .replace(/\{\{messagesBlob\}\}/g, context.messagesBlob);

  const body = {
    model: modelToUse,
    messages: [
      { role: 'system' as const, content: prompts.systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    let message = `OpenAI API error ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      if (j.error?.message) message = j.error.message;
    } catch {
      if (errBody) message = errBody.slice(0, 200);
    }
    throw new Error(message);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const summary = choice?.message?.content?.trim() ?? '';

  const usage = data.usage ?? {};
  return {
    summary: summary || 'No analysis generated.',
    usage: {
      model: data.model ?? modelToUse,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}
