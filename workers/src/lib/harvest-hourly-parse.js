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
  // The positional rule has to name the target list explicitly. Said loosely
  // ("assign them in order"), a lone "12" answering a lone missing "racks"
  // lands in cutters, because position 1 of the reply is position 1 of the
  // original six.
  const positional = missing.length
    ? `- Still unanswered: ${missing.join(', ')}.
- Bare numbers map, in order, onto the unanswered fields listed above. Six bare numbers always mean all six counts in the original order.`
    : `- All six counts are already answered. A bare list of numbers is a correction: map it, in order, onto the six counts in their original order.`;
  return `You extract an hourly harvest crew report sent by a barn foreman over SMS, in Spanish (sometimes English).
Barn: ${BARN_LABELS[barn]}. Hour being reported: ${hourRange(hour_start)} today.

The seven fields, in the order the foreman was asked:
${order}
7. notes (anything that is not a count)

Rules:
- Numbers may be digits or words ("cuatro").
${positional}
- Abbreviations: cort/C = cutters, wsc/WSc = cutter_water_spiders, ch/Ch = drivers, col/Col = hangers, wsg/WSg = hanging_water_spiders, r/R = racks. A bare "ws" is ambiguous: assign it in order to whichever water-spider field is unanswered first.
- Never invent a number. A field the reply does not give is null.
- Everything that is not a count goes into notes verbatim, or null if there is none.
- If the reply names a different hour ("9am", "las 9", "9-10"), put it in hour_override as HH:00 in 24-hour time; otherwise null. The barn works roughly 6 AM to 8 PM; a bare hour below 6 is PM.`;
}

/**
 * @returns the parsed object, or null when the model could not produce one
 *   (refusal, HTTP error, non-JSON) — the caller then asks the foreman again.
 */
export async function parseReply(text, ctx, env, fetchImpl = fetch) {
  const model = env.HARVEST_HOURLY_MODEL || 'claude-opus-5';
  if (!env.ANTHROPIC_API_KEY) {
    console.error('[hourly-parse] ANTHROPIC_API_KEY unset');
    return null;
  }
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      system: systemPrompt(ctx),
      messages: [{ role: 'user', content: text }],
    }),
    // The foreman is waiting on a confirmation text; a hung call must not hold
    // the cron's 5-minute budget open.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error(`[hourly-parse] Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const msg = await res.json();
  // A 2xx that yields nothing usable is the case worth naming in the log: the
  // stop_reason says whether it was a refusal, a truncation, or something new.
  const giveUp = (why) => {
    console.warn(`[hourly-parse] ${why}: stop_reason=${msg.stop_reason} model=${model}`);
    return null;
  };
  if (msg.stop_reason === 'refusal') return giveUp('refused');
  const block = (msg.content || []).find(b => b.type === 'text');
  if (!block) return giveUp('no JSON');
  try { return JSON.parse(block.text); } catch { return giveUp('no JSON'); }
}
