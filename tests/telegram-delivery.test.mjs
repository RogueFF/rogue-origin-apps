/**
 * Whether a Telegram message actually went out.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: the wholesale cron records every event
 * it "sends" into `alerts_sent` so the board never says the same thing twice.
 * sendTelegramMessage returns quietly when the chat id is unset — deliberately,
 * so a missing secret cannot break a caller — and the cron read that quiet
 * return as success and burned the event.
 *
 * Measured on 2026-08-26: TELEGRAM_CASEY_CHAT_ID was never set, and
 * `alerts_sent` held 30 rows, the newest eight minutes old. Thirty notifications
 * were generated, marked delivered, and never sent to anybody. A misconfigured
 * chat id was indistinguishable from a working one.
 *
 * So the sender now says whether it delivered, and the caller records only what
 * did. It still does not throw: a missing secret must not wedge a cron that
 * also advances order statuses.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage } from '../workers/src/lib/telegram.js';

/** Swap in a fetch that records calls, and always put the real one back. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return impl(...args); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}

const ok = async () => new Response('{"ok":true}', { status: 200 });

test('a missing chat id reports NOT delivered, and never calls Telegram', async () => {
  await withFetch(ok, async (calls) => {
    const delivered = await sendTelegramMessage(
      { TELEGRAM_BOT_TOKEN: 'tok' }, { chatId: undefined, text: 'hi' });
    assert.equal(delivered, false);
    assert.equal(calls.length, 0, 'nothing should be sent without a destination');
  });
});

test('a missing bot token reports NOT delivered', async () => {
  await withFetch(ok, async (calls) => {
    const delivered = await sendTelegramMessage({}, { chatId: '123', text: 'hi' });
    assert.equal(delivered, false);
    assert.equal(calls.length, 0);
  });
});

test('a real send reports delivered', async () => {
  await withFetch(ok, async (calls) => {
    const delivered = await sendTelegramMessage(
      { TELEGRAM_BOT_TOKEN: 'tok' }, { chatId: '123', text: 'hi' });
    assert.equal(delivered, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /^https:\/\/api\.telegram\.org\/bottok\/sendMessage$/);
    assert.equal(JSON.parse(calls[0][1].body).chat_id, '123');
  });
});

test('an API refusal still throws rather than reporting a quiet failure', async () => {
  // A chat id that Telegram rejects is a different problem from one that was
  // never configured, and the caller already catches this one per-event.
  const bad = async () => new Response('forbidden', { status: 403 });
  await withFetch(bad, async () => {
    await assert.rejects(
      () => sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'tok' }, { chatId: '123', text: 'hi' }),
      /403/);
  });
});
