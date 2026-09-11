/**
 * Turn a foreman's free-form SMS into the seven hourly fields with one Claude
 * Messages call. The model's only job is extraction; the worker re-validates
 * ranges afterwards (lib/harvest-hourly.js validateCounts) and never trusts a
 * number it did not range-check.
 *
 * Raw fetch, like production/chat.js — the worker carries no npm SDK.
 */
import { BARN_LABELS, FIELD_ES, COUNT_FIELDS, hourRange } from './harvest-hourly.js';

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...COUNT_FIELDS, 'notes', 'hour_override'],
  properties: {
    cutters: nullable('integer'),
    cutter_water_spiders: nullable('integer'),
    drivers: nullable('integer'),
    hangers: nullable('integer'),
    hanging_water_spiders: nullable('integer'),
    racks: nullable('integer'),
    notes: nullable('string'),
    hour_override: nullable('string'),
  },
};

export function systemPrompt({ barn, hour_start, missing }) {
  const order = COUNT_FIELDS.map((f, i) => `${i + 1}. ${f} (${FIELD_ES[f]})`).join('\n');
  return `You extract an hourly harvest crew report sent by a barn foreman over SMS, in Spanish (sometimes English).
Barn: ${BARN_LABELS[barn]}. Hour being reported: ${hourRange(hour_start)} today.

The seven fields, in the order the foreman was asked:
${order}
7. notes (anything that is not a count)

Rules:
- Numbers may be digits or words ("cuatro"), may carry abbreviations (cort, ws, ch, col, wsc, wsg, r), or may be bare and positional ("4 2 3 8 1 12" means the six counts in order).
- Only these fields are still unanswered: ${missing.join(', ')}. If the reply gives fewer bare numbers than that, assign them to the unanswered fields in order.
- Never invent a number. A field the reply does not give is null.
- Everything that is not a count goes into notes verbatim, or null if there is none.
- If the reply names a different hour ("9am", "las 9", "9-10"), put it in hour_override as HH:00 in 24-hour time; otherwise null.
Return only the JSON object.`;
}

/**
 * @returns the parsed object, or null when the model could not produce one
 *   (refusal, HTTP error, non-JSON) — the caller then asks the foreman again.
 */
export async function parseReply(text, ctx, env, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: env.HARVEST_HOURLY_MODEL || 'claude-opus-5',
      max_tokens: 2048,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      system: systemPrompt(ctx),
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) {
    console.error(`[hourly-parse] Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const msg = await res.json();
  if (msg.stop_reason === 'refusal') return null;
  const block = (msg.content || []).find(b => b.type === 'text');
  if (!block) return null;
  try { return JSON.parse(block.text); } catch { return null; }
}
