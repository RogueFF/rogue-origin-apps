# Capataz WhatsApp Transport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add a WhatsApp channel to the existing Capataz harvest-hourly crew log, alongside SMS, by reusing `riego-whatsapp-mailbox` (a dormant Cloudflare Worker with a live Meta WhatsApp test number and Graph credentials already configured) instead of building new Meta-facing infrastructure.

**Architecture:** `rogue-origin-api`'s 5-minute tick gains a step that drains `riego-whatsapp-mailbox`'s `GET /poll` (bearer-authed) and feeds each row from a registered WhatsApp foreman through the exact same `processInbound` command-classification path the Twilio webhook already uses. Outbound gets one channel-aware dispatch point that calls either `lib/sms.js` (Twilio, existing) or a new `lib/whatsapp-mailbox.js` (proxies the mailbox's `POST /send`, which itself calls Meta's Graph API — this worker never talks to Meta directly). `capataz-bot`'s relay needs no new transport module: it already only talks to the worker's `sms_poll`/`sms_send` endpoints, so the channel swap is entirely server-side except for one text-safety fix (accent/GSM stripping must become conditional on both the worker and the relay, together).

Full design context: `wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md` (v3 section, farm wiki repo) — read it before starting, it explains *why* each decision below was made (Twilio's rejection, the mailbox's single-consumer queue semantics, the push-to-pull latency tradeoff).

**Tech Stack:** Cloudflare Workers + D1 (SQLite) for `rogue-origin-api`; Python (`claude_relay`) for the FERN-side relay.

**Repos and worktrees (already created, dependencies already installed, baseline tests already green):**
- `C:\Users\Koasm\Desktop\Dev\rogue-origin-apps-harvest-whatsapp` — branch `feat/harvest-hourly-whatsapp`, off `origin/master`. Worker code is in `workers/`. Baseline: `npm test` in `workers/` — 55 passing.
- `C:\Users\Koasm\Desktop\Dev\capataz-bot-whatsapp` — branch `feat/whatsapp-channel`, off `origin/master`. Baseline: `python -m pytest -q` — 72 passing.

Do **not** touch `Desktop\Dev\rogue-origin-apps` (main checkout) or `Desktop\Dev\capataz-bot` (main checkout) — both have unrelated in-progress work. Do **not** touch `Desktop\Dev\riego-whatsapp-mailbox` or `Desktop\Dev\riego-bot` — those are Riego's, not Capataz's, and this plan only ever calls the mailbox's existing public endpoints, never edits its source.

---

### Task 1: Migration 0034 — `channel` column

**Files:**
- Create: `workers/migrations/0034-harvest-channel.sql`

**Step 1: Write the migration**

```sql
-- Capataz v3: WhatsApp transport, reusing riego-whatsapp-mailbox as the Meta
-- broker. channel picks which lib does the outbound send, and (on
-- harvest_sms_inbox) which inbound source a row came from: the Twilio webhook
-- push, or the tick's WhatsApp mailbox drain.
-- Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v3)
ALTER TABLE harvest_foremen ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE harvest_sms_inbox ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
```

No CHECK constraint on the column (matches migration 0033's style — validation for `barn` lives in application code, not a SQL CHECK added via ALTER). `channel` is validated in `setForeman` in Task 3.

**Step 2: Apply locally**

Run: `cd workers && npx wrangler d1 migrations apply rogue-origin-db --local` (use whatever local D1 binding name the existing test setup already uses — check `wrangler.jsonc` for the exact `database_name` before running; every existing test that touches `harvest_foremen`/`harvest_sms_inbox` must still pass afterward).

**Step 3: Commit**

```bash
git add workers/migrations/0034-harvest-channel.sql
git commit -m "feat: add channel column to harvest_foremen and harvest_sms_inbox"
```

---

### Task 2: `lib/whatsapp-mailbox.js` — send + poll, proxied through the mailbox worker

**Files:**
- Create: `workers/src/lib/whatsapp-mailbox.js`
- Test: `workers/test/whatsapp-mailbox.test.mjs` (the test directory is `test/`, singular — confirmed via the project's existing files; `npm test` runs `node --test "test/**/*.test.mjs"`)

Read `workers/src/lib/sms.js` first (55 lines) — this file must match its exact contract: `sendWhatsapp` returns `false` (never throws) when unconfigured or no recipient, returns `true` on success, throws `Error` on a real send failure (so the caller — the cron — sees it and logs it, but a missing secret never wedges the cron). The two new secrets are `WA_MAILBOX_URL` (the mailbox worker's base URL, e.g. `https://riego-whatsapp-mailbox.roguefamilyfarms.workers.dev`) and `WA_MAILBOX_KEY` (the mailbox's own `POLL_KEY` value, reused).

**Step 1: Write the failing tests**

```js
// workers/test/whatsapp-mailbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsapp, pollWhatsappMailbox } from '../src/lib/whatsapp-mailbox.js';

test('sendWhatsapp returns false and does not fetch when secrets are unset', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const ok = await sendWhatsapp({}, { to: '+15415551234', body: 'hi' }, fakeFetch);
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('sendWhatsapp returns false and does not fetch when there is no recipient', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const ok = await sendWhatsapp(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' },
    { to: '', body: 'hi' }, fakeFetch);
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('sendWhatsapp posts bearer-authed JSON to <mailbox>/send with a digits-only "to"', async () => {
  let seenUrl, seenInit;
  const fakeFetch = async (url, init) => {
    seenUrl = url; seenInit = init;
    return new Response(JSON.stringify({ ok: true, wa_message_id: 'wamid.abc' }), { status: 200 });
  };
  const ok = await sendWhatsapp(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'secret-key' },
    { to: '+15415551234', body: 'Ok 9-10 Arriba: C4 WSc2' }, fakeFetch);
  assert.equal(ok, true);
  assert.equal(seenUrl, 'https://mailbox.example/send');
  assert.equal(seenInit.headers.Authorization, 'Bearer secret-key');
  const body = JSON.parse(seenInit.body);
  assert.equal(body.to, '15415551234');   // no '+' — matches the mailbox's own normalizeNumber
  assert.equal(body.text, 'Ok 9-10 Arriba: C4 WSc2');
});

test('sendWhatsapp throws on a mailbox error, naming the status and the recipient', async () => {
  const fakeFetch = async () => new Response('recipient_not_allowlisted', { status: 403 });
  await assert.rejects(
    () => sendWhatsapp(
      { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' },
      { to: '+15415551234', body: 'hi' }, fakeFetch),
    /403.*\+15415551234.*recipient_not_allowlisted/s);
});

test('pollWhatsappMailbox returns [] and does not fetch when unconfigured', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const messages = await pollWhatsappMailbox({}, { limit: 20 }, fakeFetch);
  assert.deepEqual(messages, []);
  assert.equal(called, false);
});

test('pollWhatsappMailbox GETs <mailbox>/poll?limit=N with the bearer and returns .messages', async () => {
  let seenUrl, seenInit;
  const fakeFetch = async (url, init) => {
    seenUrl = url; seenInit = init;
    return new Response(JSON.stringify({ messages: [{ wa_message_id: 'wamid.1', from_number: '15415551234', text_body: 'hola' }] }), { status: 200 });
  };
  const messages = await pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'secret-key' },
    { limit: 5 }, fakeFetch);
  assert.equal(seenUrl, 'https://mailbox.example/poll?limit=5');
  assert.equal(seenInit.headers.Authorization, 'Bearer secret-key');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].wa_message_id, 'wamid.1');
});

test('pollWhatsappMailbox throws on a non-2xx response', async () => {
  const fakeFetch = async () => new Response('unauthorized', { status: 401 });
  await assert.rejects(() => pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'bad' }, {}, fakeFetch), /401.*unauthorized/s);
});

test('pollWhatsappMailbox returns [] when the mailbox omits .messages', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const messages = await pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' }, {}, fakeFetch);
  assert.deepEqual(messages, []);
});
```

**Step 2: Run to verify failure**

Run: `cd workers && node --test test/whatsapp-mailbox.test.mjs`. Expected: FAIL, module not found.

**Step 3: Implement**

```js
// workers/src/lib/whatsapp-mailbox.js
/**
 * WhatsApp send + poll, proxied through riego-whatsapp-mailbox — a separate
 * Cloudflare Worker that holds the Meta Graph credentials and already
 * verifies Meta's webhook signature. This worker never talks to Meta
 * directly: it only calls the mailbox's bearer-authed /send and /poll.
 *
 * Same contract as lib/sms.js: sendWhatsapp returns false (never throws) when
 * unconfigured, so a missing secret can't wedge the cron. It throws on a real
 * send failure so the caller sees it.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v3)
 */

function base(env) {
  return String(env.WA_MAILBOX_URL || '').replace(/\/$/, '');
}

/** E.164 ('+15415551234') -> digits only ('15415551234'), matching the mailbox's own normalizeNumber. */
function digitsOnly(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

export async function sendWhatsapp(env, { to, body }, fetchImpl = fetch) {
  if (!to) {
    console.log(`[whatsapp] no recipient — message would be: ${body}`);
    return false;
  }
  const url = base(env), key = env.WA_MAILBOX_KEY;
  if (!url || !key) {
    console.log(`[whatsapp] not configured — to ${to}: ${body}`);
    return false;
  }
  const res = await fetchImpl(`${url}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: digitsOnly(to), text: body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp mailbox ${res.status} -> ${to}: ${err.slice(0, 200)}`);
  }
  return true;
}

/**
 * Drain the mailbox's inbound queue. The mailbox marks whatever it hands back
 * as processed on ITS side — there is no redelivery once this call returns,
 * so the caller must persist each row before doing anything that can fail.
 */
export async function pollWhatsappMailbox(env, { limit = 20 } = {}, fetchImpl = fetch) {
  const url = base(env), key = env.WA_MAILBOX_KEY;
  if (!url || !key) {
    console.log('[whatsapp] mailbox not configured — skipping poll');
    return [];
  }
  const res = await fetchImpl(`${url}/poll?limit=${limit}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp mailbox poll ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.messages || [];
}
```

**Step 4: Run to verify pass, then commit**

```bash
git add workers/src/lib/whatsapp-mailbox.js workers/test/whatsapp-mailbox.test.mjs
git commit -m "feat: add whatsapp-mailbox client (send + poll, proxied via riego-whatsapp-mailbox)"
```

---

### Task 3: Channel-aware outbound dispatch + `setForeman` gets a `channel` param

**Files:**
- Modify: `workers/src/handlers/harvest-hourly-d1.js`
- Create: `workers/test/harvest-hourly-channel.test.mjs`

This is the single channel-aware dispatch point the whole feature hangs off. Read the full current `harvest-hourly-d1.js` (832 lines) before starting — it is dense and every comment in it explains a real race or bug the reviewers already found once; do not simplify away anything you don't fully understand.

**Important — test harness note, checked ahead of time so you don't have to rediscover it:** `setForeman` and `sendToForeman` are currently NOT exported from `harvest-hourly-d1.js` — only `handleHarvestHourly`, `handleSmsInbound`, `processInbound`, `applyHourlyReport`, and `runHarvestHourlyTick` are. `applyHourlyReport` was made `export`ed specifically so it could be unit tested directly against a fake D1 (see `workers/test/harvest-hourly-apply.test.mjs`'s `fakeDb()` helper — canned per-call responses in call order, `.matching(...needles)` to inspect the SQL a call issued). Add `export` to both `setForeman` and `sendToForeman` for the same reason, and test them the same way — do not route these tests through `handleHarvestHourly`'s HTTP-level auth wrapper, that is not how any sibling function in this file is tested. Copy `fakeDb()` verbatim into the new `harvest-hourly-channel.test.mjs` file (there is no shared test-utils module in this codebase to import it from — every test file that needs it currently defines its own copy).

**Step 1: Add the `sendViaChannel` helper**

Add near the top of the file, after the `sendSms, verifyTwilioSignature` import — add a new import:

```js
import { sendWhatsapp } from '../lib/whatsapp-mailbox.js';
```

Add the helper function (near `isTestMode`/`seasonOf`/`sumRacks`, around line 58-65):

```js
/**
 * The one place outbound text leaves this worker for a foreman's phone.
 * `foreman` must carry `channel` — a lookup that names its columns and forgets
 * it reads undefined here and quietly routes a WhatsApp foreman to Twilio
 * forever, which is the failure nothing errors on.
 */
function sendViaChannel(env, foreman, text) {
  if (foreman.channel === 'whatsapp') return sendWhatsapp(env, { to: foreman.phone, body: text });
  // The column is NOT NULL DEFAULT 'sms', so reaching here with anything else
  // means a SELECT that forgot the column or a caller passing the wrong object
  // shape — and the second one leaves foreman.phone undefined too, so sendSms
  // logs "no recipient" and the send is lost entirely. Both are silent, and
  // both happen at sites whose state write has already committed.
  //
  // A warn, not a throw: the tick commits the row state before it sends, on
  // purpose — that ordering is what makes a text at-most-once. A throw here is
  // caught by the per-row try/catch but cannot undo the committed write, so
  // the row advances, nothing is delivered, and the next tick sees it as done
  // and never retries. A degraded-but-delivering SMS beats that.
  if (foreman.channel !== 'sms') {
    console.warn(`[send] ${foreman.phone}: channel ${JSON.stringify(foreman.channel)} unrecognized — falling back to SMS`);
  }
  return sendSms(env, { to: foreman.phone, body: text });
}
```

**Step 2: Wire it into all 5 existing `sendSms` call sites**

1. Line ~254 (`processInbound`, the `deliver` loop): `for (const t of replies) await sendSms(env, { to: from, body: t });` → `for (const t of replies) await sendViaChannel(env, foreman, t);` (the `foreman` variable is already in scope from the `SELECT *` at line 211, so `foreman.channel` is already populated once Task 1's migration lands — no query change needed here).

2. `sendToForeman` (~line 495-516): the `SELECT phone FROM harvest_foremen WHERE phone = ?` at line 498 must become `SELECT phone, channel FROM harvest_foremen WHERE phone = ?`. This function also needs the channel-aware sanitization from Task 5 — implement both together since they touch the same lines; see Task 5 for the exact replacement.

3. Tick nudge reminder (~line 725): `await sendSms(env, { to: f.phone, body: reminderText(...) });` → `await sendViaChannel(env, f, reminderText(row.barn, row.hour_start));`. The `contacts` map's underlying query (~line 703-704) currently selects `phone, name, active_since` — add `channel`: `SELECT phone, name, active_since, channel FROM harvest_foremen WHERE barn = ? ORDER BY active DESC, active_since DESC LIMIT 1`.

4. Tick hourly prompt (~line 761): `await sendSms(env, { to: f.phone, body: promptText(f.barn, je.hour_start) });` → `await sendViaChannel(env, f, promptText(f.barn, je.hour_start));`. `f` here comes from the `foremen` query at line 746 (`SELECT * FROM harvest_foremen WHERE active = 1`) — already `SELECT *`, no query change needed.

5. Tick auto-stop (~line 776): `await sendSms(env, { to: f.phone, body: 'Paramos por hoy. Escribe EMPEZAR manana.' });` → `await sendViaChannel(env, f, 'Paramos por hoy. Escribe EMPEZAR manana.');` (same `f`, no query change).

**Step 3: `setForeman` gets a `channel` param**

Modify `setForeman` (~lines 128-149) to accept and validate `channel`, defaulting to `'sms'` so every existing/future SMS foreman is unaffected:

```js
async function setForeman(db, body) {
  const phone = String(body.phone || '').trim();
  const name = String(body.name || '').trim();
  const barn = String(body.barn || '').trim();
  const channel = String(body.channel || 'sms').trim();
  if (!/^\+1\d{10}$/.test(phone)) throw createError('VALIDATION_ERROR', 'phone must be E.164, e.g. +15415551234');
  if (!name) throw createError('VALIDATION_ERROR', 'name is required');
  if (!BARN_LABELS[barn]) throw createError('VALIDATION_ERROR', 'barn must be upper or bottom');
  if (channel !== 'sms' && channel !== 'whatsapp') throw createError('VALIDATION_ERROR', 'channel must be sms or whatsapp');
  const active = isTrue(body.active) ? 1 : 0;
  await execute(db, `
    INSERT INTO harvest_foremen (phone, name, barn, active, channel, active_since)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, barn = excluded.barn, active = excluded.active,
      channel = excluded.channel,
      active_since = CASE WHEN excluded.active = 1 AND harvest_foremen.active = 0 THEN datetime('now') ELSE harvest_foremen.active_since END
  `, [phone, name, barn, active, channel, active]);
  if (active) {
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE barn = ? AND phone <> ?`, [barn, phone]);
  }
  return { foreman: await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [phone]) };
}
```

**Step 4: Write tests**

Create `workers/test/harvest-hourly-channel.test.mjs` (copy `fakeDb()` from `harvest-hourly-apply.test.mjs` into it) with:
- `setForeman` with `channel: 'whatsapp'` in the body — assert the INSERT's bound params include `'whatsapp'` (via `db.matching('INSERT INTO harvest_foremen')`); with an invalid channel value (e.g. `'telegram'`) — assert it throws `VALIDATION_ERROR` before any query runs; channel omitted — assert it defaults to `'sms'`.
- `processInbound`'s deliver loop for a `channel: 'whatsapp'` foreman texting `EMPEZAR` — mock the global `fetch` (`t.mock.method(globalThis, 'fetch', ...)`, `node:test`'s built-in mocking) to assert the WhatsApp mailbox's `/send` URL was called and Twilio's `api.twilio.com` endpoint was not, for both this case and the mirror `channel: 'sms'` case.
- `sendToForeman` (now exported) called against a `channel: 'whatsapp'` foreman — same global-`fetch` mock, asserting the mailbox is called.

**Step 5: Run full suite, verify pass, commit**

```bash
cd workers && npm test
git add src/handlers/harvest-hourly-d1.js test/harvest-hourly-channel.test.mjs
git commit -m "feat: channel-aware outbound dispatch (sms or whatsapp per foreman)"
```

---

### Task 4: Tick drains the WhatsApp mailbox

**Files:**
- Modify: `workers/src/handlers/harvest-hourly-d1.js`
- Test: `workers/test/harvest-hourly-channel.test.mjs` (created in Task 3 — add to it, same `fakeDb()`/global-`fetch`-mock harness)

**Step 1: Thread a `channel` param through `processInbound`**

`processInbound`'s signature (~line 190) currently is:
```js
export async function processInbound(env, { from, text, sid, deliver, now = new Date() }) {
```
Change to:
```js
export async function processInbound(env, { from, text, sid, deliver, channel = 'sms', now = new Date() }) {
```

And its dedupe insert (~line 206):
```js
const { changes } = await execute(db,
  `INSERT OR IGNORE INTO harvest_sms_inbox (message_sid, from_phone, body, processed) VALUES (?, ?, ?, 1)`,
  [sid, from, text]);
```
becomes:
```js
const { changes } = await execute(db,
  `INSERT OR IGNORE INTO harvest_sms_inbox (message_sid, from_phone, body, processed, channel) VALUES (?, ?, ?, 1, ?)`,
  [sid, from, text, channel]);
```

Every existing caller (`handleSmsInbound`, `hourly_simulate`) is unaffected — they don't pass `channel`, so it defaults to `'sms'`, matching current behavior exactly. Do not change the internal deliver-loop send (already switched to `sendViaChannel(env, foreman, t)` in Task 3, which reads `foreman.channel` — the authoritative source for *how* to send; the `channel` param here is provenance for the inbox row, for debugging).

**Step 2: Add `drainWhatsappInbound`**

Add near `runHarvestHourlyTick`, above it:

```js
/**
 * Drain riego-whatsapp-mailbox's queue and feed each row from a registered
 * WhatsApp foreman through the same processInbound path the Twilio webhook
 * uses inline — same command handling, same dedupe-by-message-id, same
 * chat-queueing for the relay.
 *
 * Only rows whose sender is a registered `channel = 'whatsapp'` foreman are
 * claimed. Everyone else (Riego's own crew sharing this mailbox, or an
 * unregistered number) is left alone — this worker is not the only consumer
 * of this mailbox's traffic even though it is currently the only ACTIVE one
 * (Riego's WhatsApp poller has been off since 2026-07; see the wiki design
 * doc's v3 section before ever adding a second poller here).
 *
 * The mailbox has already marked whatever it hands back as processed on ITS
 * side — there is no redelivery once /poll responds. Each row is written into
 * harvest_sms_inbox (dedup on the WhatsApp message id, reusing the
 * message_sid column) via processInbound's own INSERT OR IGNORE before it is
 * classified, so the row being processed is persisted before it can fail —
 * the same trade processInbound already makes for the Twilio path between
 * claim and release. Note what that does NOT buy: rows still sitting in
 * `messages` when the worker dies are lost, because the mailbox has already
 * marked them and there is no redelivery.
 */
async function drainWhatsappInbound(env, now) {
  const db = env.DB;
  let messages;
  try {
    messages = await pollWhatsappMailbox(env, { limit: POLL_LIMIT_MAX });
  } catch (e) {
    console.error(`[whatsapp-drain] poll failed: ${e.message}`);
    return 0;
  }
  let acted = 0;
  for (const m of messages) {
    const from = '+' + String(m.from_number || '').replace(/[^\d]/g, '');
    const text = m.text_body || '';
    try {
      const foreman = await queryOne(db,
        `SELECT phone FROM harvest_foremen WHERE phone = ? AND channel = 'whatsapp'`, [from]);
      if (!foreman) continue;   // not a Capataz WhatsApp foreman — not ours to answer
      const r = await processInbound(env, {
        from, text, sid: m.wa_message_id, deliver: true, channel: 'whatsapp', now,
      });
      if (r.replies.length || r.queued) acted++;
    } catch (e) {
      console.error(`[whatsapp-drain] ${m.wa_message_id}: ${e.message}`);
    }
  }
  return acted;
}
```

Add the import: `import { sendWhatsapp, pollWhatsappMailbox } from '../lib/whatsapp-mailbox.js';` (combine with Task 3's import of `sendWhatsapp` into one line).

**Step 3: Call it from `runHarvestHourlyTick`**

At the very start of `runHarvestHourlyTick` (~line 679-685), right after `let acted = 0;`, add:

```js
  try {
    acted += await drainWhatsappInbound(env, now);
  } catch (e) {
    console.error(`[whatsapp-drain] ${e.message}`);
  }
```

This runs before the open-row loop and the ask/auto-stop loop, so an EMPEZAR/PARAR received over WhatsApp this tick takes effect before the same tick's ask/auto-stop decisions — matching how the Twilio webhook already reacts instantly relative to the tick.

**Step 4: Write tests**

- `drainWhatsappInbound` with a mocked `pollWhatsappMailbox` returning one row from a registered `channel='whatsapp'` foreman texting `EMPEZAR` — asserts a reply was sent via `sendWhatsapp` (not `sendSms`), the foreman is now `active=1`, and the row landed in `harvest_sms_inbox` with `channel='whatsapp'`.
- One row from a phone NOT in `harvest_foremen` — asserts it is skipped (no row written, no send attempted, no error thrown).
- One row from a phone registered with `channel='sms'` (not whatsapp) — asserts it is skipped too (a WhatsApp message from an SMS-channel foreman's number is not a case that should exist, but the query's `AND channel = 'whatsapp'` must still gate on it defensively).
- `pollWhatsappMailbox` throwing — asserts `runHarvestHourlyTick` does not throw and the rest of the tick (open-row loop, ask/auto-stop) still runs (mirrors the existing `capatazWatchdog` try/catch wrapper pattern already in the tick).
- A chat (non-command) text from a WhatsApp foreman — asserts it lands in the queue (`kind='chat', processed=0`) exactly like a Twilio chat text does, with `channel='whatsapp'`, so `sms_poll` will hand it to the relay.
- **Ordering**: a foreman texts `EMPEZAR` over WhatsApp in the same batch the tick would otherwise decide to ask for the just-ended hour. Because `drainWhatsappInbound` runs before the ask/auto-stop loop (Step 3 above puts it first, deliberately), the EMPEZAR must land (`active` flips to 1) *before* the ask decision is made, so the same tick both starts the day and sends the hourly prompt — not "starts the day" this tick and "gets asked" only on the next one 5 minutes later. Assert this directly against `runHarvestHourlyTick`'s full fake-DB call sequence, not just `drainWhatsappInbound` in isolation — this ordering is the single most fragile thing in the whole feature.
- **Two messages from one foreman in one drain batch**: `pollWhatsappMailbox` returns two rows from the same `from_number` in one call (e.g. a foreman sending "4 2 3" then, seconds later, "8 1 12" — on the Twilio path these arrive as two separate webhook POSTs; here they arrive together, in one loop iteration, processed sequentially). Assert both are processed in order without either one's claim-then-release step interfering with the other's (`processInbound`'s dedupe-insert-claimed-then-release protocol was written assuming one row at a time from one HTTP request; confirm the sequential `for` loop in `drainWhatsappInbound` doesn't need to await anything differently for this to hold — it shouldn't, since each iteration fully completes before the next starts, but write the test to prove it rather than assume it).

**Step 5: Run full suite, verify pass, commit**

```bash
cd workers && npm test
git add src/handlers/harvest-hourly-d1.js test/harvest-hourly-channel.test.mjs
git commit -m "feat: tick drains the WhatsApp mailbox into the same inbound pipeline"
```

---

### Task 5: `sms_send` skips GSM sanitization for WhatsApp foremen; `buildPollContext` exposes `channel`

**Files:**
- Modify: `workers/src/handlers/harvest-hourly-d1.js` (`sendToForeman`)
- Modify: `workers/src/lib/harvest-hourly.js` (`buildPollContext`)
- Test: `workers/test/harvest-hourly-channel.test.mjs` for the `sendToForeman` changes (add to it — created in Task 3); `workers/test/harvest-hourly-sms.test.mjs` for the `buildPollContext` change (it already has a `buildPollContext` test block, ~line 127 in the current file — add to that block rather than creating a new one).

`gsmSafe`/`smsSegments`/`MAX_SMS_SEGMENTS` exist only to keep an SMS inside GSM-7 160-char segments — meaningless for WhatsApp, which is UTF-8 and where Meta's own `/send` truncates at 4096 chars. Skipping them for `channel='whatsapp'` restores accented Spanish (é, í, ñ, ¿, ¡) for those foremen. This must land together with Task 7 (the relay's own unconditional accent-stripping) — landing only one side is wasted work, since whichever side still strips wins.

**Step 1: Update `sendToForeman`**

Combine with Task 3 Step 2 item 2's query change (`SELECT phone, channel ...`). Replace the body (~lines 495-516):

```js
async function sendToForeman(db, env, body) {
  const to = String(body.to || '').trim();
  if (!to) throw createError('VALIDATION_ERROR', 'to is required');
  const foreman = await queryOne(db, `SELECT phone, channel FROM harvest_foremen WHERE phone = ?`, [to]);
  if (!foreman) throw createError('NOT_FOUND', `No foreman registered for ${to}`);

  let text = String(body.text || '').trim();
  let segments = 1;
  if (foreman.channel === 'whatsapp') {
    // UTF-8, no per-segment billing — Meta's own /send truncates at 4096.
    if (!text) throw createError('VALIDATION_ERROR', 'text is required');
    if (text.length > 4096) {
      throw createError('VALIDATION_ERROR', `text is ${text.length} characters; WhatsApp's limit is 4096`);
    }
  } else {
    text = gsmSafe(text);
    if (!text) throw createError('VALIDATION_ERROR', 'text is required');
    segments = smsSegments(text);
    if (segments > MAX_SMS_SEGMENTS) {
      throw createError('VALIDATION_ERROR',
        `text is ${text.length} characters (${segments} segments); the limit is 3 segments (459 chars)`);
    }
  }

  const sent = await sendViaChannel(env, foreman, text);
  // Only when it actually went out: sendSms and sendWhatsapp both return false
  // WITHOUT throwing on missing secrets, and a replied_at stamped on a reply
  // that never left hides the phone from capatazWatchdog's "delivered, never
  // replied" count — the one alarm that would have caught the outage.
  if (sent) {
    await execute(db, `UPDATE harvest_sms_inbox SET replied_at = ?
      WHERE from_phone = ? AND replied_at IS NULL AND processed = 1`, [sqliteUtc(new Date()), to]);
  }
  return { sent, text, segments };
}
```

**Step 2: `buildPollContext` exposes `channel`**

In `workers/src/lib/harvest-hourly.js`, the `foreman` object returned by `buildPollContext` (~lines 249-255) gains one field:

```js
    foreman: {
      name: foreman.name,
      barn: foreman.barn,
      barn_label: BARN_LABELS[foreman.barn],
      active: !!foreman.active,
      active_since: foreman.active_since ?? null,
      channel: foreman.channel || 'sms',
    },
```

**Step 3: Write tests**

- `sendToForeman` to a `channel='whatsapp'` foreman with accented text (`"Ok 9-10: café"`) — asserts the text is sent unmodified (accents survive), `sendWhatsapp` was called, `sendSms` was not.
- `sendToForeman` to a `channel='whatsapp'` foreman with text over 4096 chars — asserts `VALIDATION_ERROR`.
- `sendToForeman` to a `channel='sms'` (or default) foreman — asserts existing `gsmSafe`/segment-limit behavior is completely unchanged (re-run the existing tests for this function unmodified; they must still pass as-is).
- `buildPollContext` with a foreman row that has `channel: 'whatsapp'` — asserts `context.foreman.channel === 'whatsapp'`; with no `channel` field on the input row at all (defensive) — asserts it defaults to `'sms'`.

**Step 4: Run full suite, verify pass, commit**

```bash
cd workers && npm test
git add src/handlers/harvest-hourly-d1.js src/lib/harvest-hourly.js test/
git commit -m "feat: skip GSM sanitization for whatsapp foremen; expose channel to the relay"
```

---

### Task 6: `capataz-bot` — `text.py` gets a WhatsApp-safe reply path

**Repo:** `capataz-bot-whatsapp` (Python)

**Files:**
- Modify: `claude_relay/text.py`
- Modify: `claude_relay/config.py`
- Test: `tests/test_sms_text.py` (confirmed the existing `sms_safe`/`prepare_sms_reply`/`chunk_reply` tests live there)

Read the full current `claude_relay/text.py` (275 lines) before starting.

**Step 1: Write the failing tests**

Add to the existing test file, matching its existing style (check whether it uses plain `assert` / `pytest` fixtures / a specific test class pattern before writing):

```python
def test_whatsapp_safe_keeps_accents_and_punctuation():
    assert whatsapp_safe("Ok 9-10 Arriba: café, ¿cuántos racks?") == "Ok 9-10 Arriba: café, ¿cuántos racks?"

def test_whatsapp_safe_still_strips_markdown_markers():
    assert whatsapp_safe("**Ok** hanging_water_spiders") == "Ok hanging water spiders"

def test_whatsapp_safe_collapses_whitespace():
    assert whatsapp_safe("linea uno\n\nlinea dos") == "linea uno linea dos"

def test_prepare_whatsapp_reply_still_catches_leaked_tool_errors():
    assert prepare_whatsapp_reply('{"error": "harvest api unreachable"}') == ERROR_FALLBACK

def test_prepare_whatsapp_reply_still_catches_cc_status_strings():
    assert prepare_whatsapp_reply("(no output from claude)") == ERROR_FALLBACK

def test_prepare_whatsapp_reply_preserves_accents_on_a_clean_reply():
    assert prepare_whatsapp_reply("¡Listo! Te pregunto cada hora.") == "¡Listo! Te pregunto cada hora."
```

**Step 2: Run to verify failure**

Run: `python -m pytest tests/test_sms_text.py -v` (or the actual file). Expected: FAIL, `whatsapp_safe`/`prepare_whatsapp_reply` not defined.

**Step 3: Implement**

In `claude_relay/text.py`, add after `sms_safe()` (~line 105):

```python
def whatsapp_safe(text: str) -> str:
    """WhatsApp's outbound pipeline: markdown markers out, whitespace collapsed.

    Unlike sms_safe(), accents and non-ASCII survive — WhatsApp is UTF-8 with
    no per-segment billing. The markdown strip stays: the persona forbids
    markdown on every channel, this is what makes that true regardless of
    which channel a reply happens to leave on.
    """
    out = (text or "").replace("*", "").replace("_", " ")
    return collapse_whitespace(out)
```

And after `prepare_sms_reply()` (~line 158):

```python
def prepare_whatsapp_reply(raw: str) -> str:
    """WhatsApp counterpart to prepare_sms_reply(): same leak/status guards,
    whatsapp_safe() instead of sms_safe() for the sanitize pass.

    Returns "" for an empty reply so the caller can apply its own fallback.
    """
    if looks_like_tool_leak(raw or "") or looks_like_cc_status(raw or ""):
        return ERROR_FALLBACK
    return whatsapp_safe(raw)
```

In `claude_relay/config.py`, add a `wa_reply_chunk_max` field alongside the existing `sms_reply_chunk_max` (~line 116, ~line 166, ~line 225 — three places `sms_reply_chunk_max` appears; add the WhatsApp counterpart at each, default `4000`, matching Meta's ~4096-char cap with headroom for the truncation notice `chunk_reply` may append):

```python
wa_reply_chunk_max: int = 4000
```
(dataclass field, near `sms_reply_chunk_max: int = 150`)
```python
"wa_reply_chunk_max": 4000,
```
(default dict, near `"reply_chunk_max": 150,`)
```python
wa_reply_chunk_max=int(sms.get("wa_reply_chunk_max", 4000)),
```
(loader, near `sms_reply_chunk_max=int(sms.get("reply_chunk_max", 150)),`) — read the exact surrounding code first; the config section this lives under may need its own key rather than reusing the `sms:` block (check whether `channel` needs its own top-level config key or can live under `sms:` since the relay's config file is still named for the SMS transport even though it now serves both channels — match whatever the existing `sms:` block's own doc comment says about scope, and preserve it if it's shared).

**Step 4: Run to verify pass, then commit**

```bash
python -m pytest -q
git add claude_relay/text.py claude_relay/config.py tests/test_sms_text.py
git commit -m "feat: whatsapp-safe reply sanitizer (keeps accents, still strips markdown)"
```

---

### Task 7: `capataz-bot` — `sms.py` threads `channel` through to pick the right sanitizer

**Repo:** `capataz-bot-whatsapp` (Python)

**Files:**
- Modify: `claude_relay/sms.py`
- Test: `tests/test_sms_dispatch.py` (confirmed the existing `SmsWorker`/`dispatch_sms_message` tests live there).

Read the full current `claude_relay/sms.py` (571 lines) before starting — this task touches `SmsWorker.__init__`, `SmsState.worker_for`, `dispatch_sms_message`, and `SmsWorker._process`.

**Step 1: Thread `channel` from the poll context to the worker**

In `dispatch_sms_message` (~line 347-394), extract the channel from context (mirrors how `sender`/`foreman` are already extracted at ~line 366-367):

```python
    context = m.get("context") or {}
    foreman = (context.get("foreman") or {}) if isinstance(context, dict) else {}
    sender = foreman.get("name") or phone
    channel = foreman.get("channel") or "sms"
    session_key = f"sms:{phone}"
```

(Session key stays `sms:{phone}` — deliberately not renamed to be channel-generic; changing it would orphan every existing SMS foreman's session/transcript history and is out of scope for this plan.)

Pass `channel` into `worker_for` (~line 384): `worker = state.worker_for(session_key, phone, channel)`.

**Step 2: `SmsState.worker_for` and `SmsWorker.__init__` carry `channel`**

`SmsWorker.__init__` (~line 112-119) gains a `channel` param, stored as `self.channel`:

```python
    def __init__(self, *, session_key: str, to_number: str, channel: str, state: "SmsState"):
        self.session_key = session_key
        self.to_number = to_number
        self.channel = channel
        self.state = state
        ...
```

`SmsState.worker_for` (~line 312-316):

```python
    def worker_for(self, session_key: str, to_number: str, channel: str = "sms") -> SmsWorker:
        if session_key not in self.workers:
            self.workers[session_key] = SmsWorker(
                session_key=session_key, to_number=to_number, channel=channel, state=self)
        return self.workers[session_key]
```

A worker already constructed on an earlier turn keeps its original `channel` even if a later poll row's `context.foreman.channel` somehow disagreed (it won't in practice — a foreman's channel doesn't change mid-day) — this matches the existing pattern where `to_number` is likewise only set on first construction.

**Step 3: `_process` picks the sanitizer and chunk limits by channel**

In `SmsWorker._process` (~line 152-248), import the new names:

```python
from .text import (
    ERROR_FALLBACK, chunk_reply, prepare_sms_reply, prepare_whatsapp_reply, render_context,
)
```

Replace the reply-preparation block (~line 227-231):

```python
        else:
            # prepare_sms_reply()/prepare_whatsapp_reply() guard (a leaked tool
            # error, a JSON block or a cc_session status string becomes one
            # Spanish sentence) and sanitize for the channel this foreman is on.
            prepare = prepare_whatsapp_reply if self.channel == "whatsapp" else prepare_sms_reply
            reply_text = prepare(result.reply)
```

And the chunking call (~line 247):

```python
        cfg = self.state.cfg
        chunk_max = cfg.wa_reply_chunk_max if self.channel == "whatsapp" else cfg.sms_reply_chunk_max
        chunk_cap = WHATSAPP_CHUNK_CAP if self.channel == "whatsapp" else SMS_CHUNK_CAP
        for chunk in chunk_reply(reply_text, chunk_max, chunk_cap):
            await self.state.sms_send(self.to_number, chunk)
```

(`cfg` is already bound earlier in `_process` at line 159 — reuse that binding rather than rebinding.)

Add the new cap constant near `SMS_CHUNK_CAP` (~line 61):

```python
# WhatsApp isn't billed per segment and Meta's own /send truncates at 4096,
# so one chunk covers any realistic reply; keep a small cap as the same
# rambling-model backstop SMS_CHUNK_CAP is.
WHATSAPP_CHUNK_CAP = 2
```

**Step 4: Write tests**

- `dispatch_sms_message` with a poll row whose `context.foreman.channel` is `"whatsapp"` — asserts the constructed `SmsWorker.channel == "whatsapp"`.
- `dispatch_sms_message` with no `context` at all (defensive, mirrors an existing test for the no-context case if one exists) — asserts `SmsWorker.channel == "sms"`.
- `SmsWorker._process` (however the existing tests currently drive `_process` — likely with a fake `CCSession`/`cc.run_streaming`; match that harness) with `channel="whatsapp"` and a model reply containing an accent — asserts the sent text preserves the accent and `prepare_whatsapp_reply`'s guard logic still fires on a leaked tool error.
- Same with `channel="sms"` — asserts completely unchanged behavior (existing tests for this path must still pass as-is).

**Step 5: Run full suite, verify pass, commit**

```bash
python -m pytest -q
git add claude_relay/sms.py tests/test_sms_dispatch.py
git commit -m "feat: relay picks the whatsapp-safe or sms-safe reply path per foreman channel"
```

---

### Task 8: End-to-end local loop test

**Repo:** primarily `rogue-origin-apps-harvest-whatsapp`, driving `capataz-bot-whatsapp` as a second process — mirrors `docs/plans/2026-09-11-capataz-smoke.md` (read it first for the harness shape: `wrangler dev` + `hourly_simulate` + a live relay process on this PC).

**Files:**
- Create: `docs/plans/2026-09-15-capataz-whatsapp-smoke.md` (the transcript/record of this test, same shape as the SMS smoke doc)

Since this PC has no real Meta webhook pointed at it and cannot receive real WhatsApp messages, this test **fakes `pollWhatsappMailbox`'s return value** rather than standing up a real mailbox round-trip — that is a legitimate substitute because Task 2's tests already prove `pollWhatsappMailbox`/`sendWhatsapp`'s wire contract against the mailbox's real, documented shape (`workers/test/whatsapp-mailbox.test.mjs`), and Task 4's unit tests already cover the ordering and double-message edge cases against the fake DB — so this test only needs to prove the *pipeline* (drain → classify → queue → relay → hourly_set → reply) end to end against a real relay process, which `hourly_simulate` already does for SMS.

**Deploy-day note worth writing into this doc's own runbook section once the test passes:** WhatsApp's 24-hour messaging window means the worker can only text a foreman who has messaged it within the last 24 hours (Meta rejects an outbound send outside that window — error 131047 — unless it's a pre-approved template, which this feature does not use). A foreman texting `EMPEZAR` every morning re-opens the window before any prompt goes out, so this is a non-issue in normal operation — but a newly-registered foreman who has never texted the number first will get no reply to the tick's first attempted prompt. The runbook must say plainly: **the foreman always sends the first message of the day; the bot never initiates cold.**

**Step 1: Register a test WhatsApp foreman**

Via `wrangler dev`'s local `foreman_set` endpoint (password-authed, see `docs/harvest-hourly-sms.md` for the exact curl shape already documented for the SMS path — reuse it, add `"channel": "whatsapp"` to the JSON body), register a foreman with a real-looking but clearly-test phone (e.g. `+15415559999`) on a barn not otherwise in use for testing.

**Step 2: Drive the loop with `hourly_simulate`**

`hourly_simulate` currently only exercises the Twilio path's `classifyInbound` via `processInbound` with `deliver:false` — check whether it needs a `channel` passthrough added to its body-handling in `handleHarvestHourly` (~line 87-103) so a simulated WhatsApp text can be told apart, OR whether it's simpler for this test to call `processInbound` directly with `channel: 'whatsapp'` via a small one-off script in `docs/plans/` rather than modifying the production `hourly_simulate` action — **do not modify `hourly_simulate`'s contract for this** unless a prior task already needed to; prefer a standalone Node script under the scratchpad that imports `processInbound` and `pollSms`/`sendToForeman` directly against a local D1 binding, mirroring what `capataz-smoke.md`'s original harness did.

Run through the same scenarios `capataz-smoke.md` covered for SMS, adapted: EMPEZAR (starts the day, WhatsApp reply), a full-count report with accents surviving to the relay's sent text (this is the one new thing to specifically verify — grep the relay's transcript output for an accented character to confirm it was NOT stripped), a partial/backfill report, PARAR (day total).

**Step 2: Record results**

Follow `capataz-smoke.md`'s exact format (numbered scenarios, pass/fail, timing). All scenarios must pass before this plan is considered done.

**Step 3: Commit**

```bash
git add docs/plans/2026-09-15-capataz-whatsapp-smoke.md
git commit -m "test: local end-to-end loop for the WhatsApp path"
```

---

## After all tasks: final review + finishing

Dispatch a final code-reviewer subagent across both repos' diffs (`git diff origin/master...HEAD` in each worktree) for the entire feature, then use `superpowers:finishing-a-development-branch` in each repo separately (they are independent PRs — Koa may want to review/merge the worker change before the relay change, or vice versa; do not bundle them into one PR).

## Not in this plan (deploy-day, Koa's)

- Getting the two real barn foremen's names and numbers (still outstanding).
- `wrangler secret put WA_MAILBOX_URL` / `WA_MAILBOX_KEY` on `rogue-origin-api` (values: the mailbox's own URL and its existing `POLL_KEY`).
- Adding each new foreman number to `WA_ALLOWED_NUMBERS` on `riego-whatsapp-mailbox` (full-value replace, combine with what's already there).
- Adding each new foreman number to Meta's WhatsApp test-recipient allowlist in the developer dashboard (the step that produced the July 131030 failures — must be done per number, by Koa, in the Meta UI).
- Registering the real foremen via `foreman_set` with `channel: "whatsapp"`.
- Deploying `capataz-bot-whatsapp` to FERN (or updating the existing Capataz install if `RogueFarm-Capataz` already exists on FERN from the SMS build).
