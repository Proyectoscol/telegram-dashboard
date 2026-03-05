/**
 * OpenAI Chat Completions helper for persona generation.
 * Uses getOpenAiApiKey() from settings. Server-only.
 */

import { getOpenAiApiKey, getPersonaOpenAIModel, getPersonaPrompts, getPersonaSchemaDescriptions } from '@/lib/settings';

export interface PersonaOutput {
  summary: string;
  topics: string[];
  inferred_profile: {
    age_range: string | null;
    occupation: string | null;
    goals: string[];
  };
  social_links: {
    instagram: string | null;
    twitter: string | null;
    linkedin: string | null;
    other: string[];
  };
  content_preferences: string;
  pain_points: string[];
  /** Key inferences with references to specific messages or reactions that support them. */
  inference_evidence: string;
}

export interface PersonaCompletionResult {
  data: PersonaOutput;
  usage: { model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function buildPersonaJsonSchema(descriptions: Record<string, string>) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'persona',
      strict: true,
      schema: {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' as const, description: descriptions.summary ?? '' },
          topics: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.topics ?? '' },
          inferred_profile: {
            type: 'object' as const,
            properties: {
              age_range: { type: ['string', 'null'] as const, description: descriptions.age_range ?? '' },
              occupation: { type: ['string', 'null'] as const, description: descriptions.occupation ?? '' },
              goals: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.goals ?? '' },
            },
            required: ['age_range', 'occupation', 'goals'],
            additionalProperties: false,
          },
          social_links: {
            type: 'object' as const,
            properties: {
              instagram: { type: ['string', 'null'] as const },
              twitter: { type: ['string', 'null'] as const },
              linkedin: { type: ['string', 'null'] as const },
              other: { type: 'array' as const, items: { type: 'string' as const } },
            },
            required: ['instagram', 'twitter', 'linkedin', 'other'],
            additionalProperties: false,
          },
          content_preferences: { type: 'string' as const, description: descriptions.content_preferences ?? '' },
          pain_points: { type: 'array' as const, items: { type: 'string' as const }, description: descriptions.pain_points ?? '' },
          inference_evidence: { type: 'string' as const, description: descriptions.inference_evidence ?? '' },
        },
        required: ['summary', 'topics', 'inferred_profile', 'social_links', 'content_preferences', 'pain_points', 'inference_evidence'],
        additionalProperties: false,
      },
    },
  };
}

export async function generatePersona(context: {
  bio: string;
  messagesBlob: string;
  repliesBlob: string;
  reactionsBlob: string;
}): Promise<PersonaCompletionResult> {
  const [apiKey, model, prompts, schemaDescriptions] = await Promise.all([
    getOpenAiApiKey(),
    getPersonaOpenAIModel(),
    getPersonaPrompts(),
    getPersonaSchemaDescriptions(),
  ]);
  if (!apiKey) {
    throw new Error('OpenAI API key not configured in Settings');
  }
  const modelToUse = model?.trim() || 'gpt-4o-mini-2024-07-18';

  const userPrompt = prompts.userPromptTemplate
    .replace(/\{\{bio\}\}/g, context.bio)
    .replace(/\{\{messagesBlob\}\}/g, context.messagesBlob)
    .replace(/\{\{repliesBlob\}\}/g, context.repliesBlob)
    .replace(/\{\{reactionsBlob\}\}/g, context.reactionsBlob);

  const response_format = buildPersonaJsonSchema(schemaDescriptions);
  const body = {
    model: modelToUse,
    messages: [
      { role: 'system' as const, content: prompts.systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
    response_format,
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
  if (!choice?.message?.content) {
    throw new Error('OpenAI returned no content');
  }

  let parsed: PersonaOutput;
  try {
    parsed = JSON.parse(choice.message.content) as PersonaOutput;
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }

  const usage = data.usage ?? {};
  return {
    data: parsed,
    usage: {
      model: data.model ?? modelToUse,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}
