import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, REPLY_SCHEMA, systemPrompt } from '../src/lib/harvest-hourly-parse.js';

const CTX = { barn: 'upper', hour_start: '09:00', missing: ['cutters', 'cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders', 'racks'] };
const ENV = { ANTHROPIC_API_KEY: 'k' };

function fakeFetch(payload, capture) {
  return async (url, init) => {
    if (capture) { capture.url = url; capture.body = JSON.parse(init.body); capture.headers = init.headers; }
    return { ok: true, status: 200, json: async () => payload };
  };
}

test('sends exactly the structured-output request — no stray fields or headers', async () => {
  const cap = {};
  const good = { cutters: 4, cutter_water_spiders: 2, drivers: 3, hangers: 8, hanging_water_spiders: 1, racks: 12, notes: null, hour_override: null };
  await parseReply('4 2 3 8 1 12', CTX, ENV, fakeFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }] }, cap));
  assert.equal(cap.url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(cap.headers, {
    'Content-Type': 'application/json',
    'x-api-key': 'k',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  });
  assert.deepEqual(cap.body, {
    model: 'claude-opus-5',
    max_tokens: 8192,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
    system: systemPrompt(CTX),
    messages: [{ role: 'user', content: '4 2 3 8 1 12' }],
  });
});

test('returns the parsed object from the text block, skipping thinking blocks', async () => {
  const good = { cutters: 4, cutter_water_spiders: 2, drivers: 3, hangers: 8, hanging_water_spiders: 1, racks: 12, notes: 'se rompio un rack', hour_override: null };
  const out = await parseReply('x', CTX, ENV, fakeFetch({ stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(good) }] }));
  assert.deepEqual(out, good);
});

test('returns null on refusal, on a non-2xx, and on non-JSON text', async () => {
  assert.equal(await parseReply('x', CTX, ENV, fakeFetch({ stop_reason: 'refusal', content: [] })), null);
  assert.equal(await parseReply('x', CTX, ENV, async () => ({ ok: false, status: 500, text: async () => 'boom' })), null);
  assert.equal(await parseReply('x', CTX, ENV, fakeFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })), null);
});

test('returns null when a truncated answer left only a thinking block', async () => {
  assert.equal(await parseReply('x', CTX, ENV, fakeFetch({ stop_reason: 'max_tokens',
    content: [{ type: 'thinking', thinking: 'counting' }] })), null);
});

test('returns null without fetching when ANTHROPIC_API_KEY is unset', async () => {
  let called = false;
  const out = await parseReply('x', CTX, {}, async () => { called = true; });
  assert.equal(out, null);
  assert.equal(called, false);
});

test('model override via env', async () => {
  const cap = {};
  await parseReply('x', CTX, { ...ENV, HARVEST_HOURLY_MODEL: 'claude-sonnet-5' },
    fakeFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }, cap));
  assert.equal(cap.body.model, 'claude-sonnet-5');
});

test('systemPrompt names the barn, the hour, and only the still-missing fields', () => {
  const p = systemPrompt({ barn: 'bottom', hour_start: '13:00', missing: ['racks'] });
  assert.match(p, /Granero Abajo/);
  assert.match(p, /1-2/);
  assert.match(p, /racks/);
  // The bug this wording fixes: a lone "12" against a lone missing "racks"
  // must not land in cutters.
  assert.match(p, /onto the unanswered fields listed above/);
});

test('systemPrompt: with nothing missing, a bare list is a correction', () => {
  const p = systemPrompt({ barn: 'upper', hour_start: '09:00', missing: [] });
  assert.match(p, /already answered/);
  assert.match(p, /correction/);
  assert.doesNotMatch(p, /Still unanswered/);
});
