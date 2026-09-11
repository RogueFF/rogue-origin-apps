# Harvest Hourly SMS Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One Spanish text per barn per hour to its foreman, one free-form reply parsed into cutters / field waterspiders / drivers / hangers / barn waterspiders / racks / notes, stored as one D1 row per barn-hour, echoed back to confirm.

**Architecture:** Everything lives in the existing `rogue-origin-api` Cloudflare Worker (`workers/`). Twilio posts inbound texts to `/sms/inbound`; the existing every-5-minute cron drives a row-state machine (`pending` → `nudged` → `missing` / `complete`) in a new `harvest_hourly` table; replies are parsed by one Claude Messages call with a JSON schema; the harvest dashboard gets an hourly panel. Pure logic (hour labeling, command classification, validation, state decisions, message text) lives in `src/lib/` so it is unit-tested with `node --test` and the D1 handler stays thin.

**Tech Stack:** Cloudflare Workers (plain JS, no npm runtime deps), D1 (SQLite), Twilio Messages REST API (raw `fetch`), Anthropic Messages API (raw `fetch`, `claude-opus-5`, structured output, server-side fallback), `node --test` (Node 24).

**Design record:** `C:\Users\Koasm\Documents\RogueFamilyFarms\wiki\operations\plans\2026-09-11-harvest-hourly-sms-bot-design.md` — read it first; every decision below is justified there.

**Worktree:** `C:\Users\Koasm\Desktop\Dev\rogue-origin-apps-harvest-hourly` on branch `feat/harvest-hourly-sms`. All paths below are relative to `workers/` inside it unless stated. `orders-auth.js` is gitignored and was already copied in; if a build complains it is missing, copy it from the main clone.

**Run tests with:** `npm test` (from `workers/`). Baseline before Task 1: 6 passing.

**Conventions you must follow (from the codebase):**
- Errors: `throw createError('VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND', message)` from `src/lib/errors.js`.
- JSON responses: `successResponse(data)` from `src/lib/response.js`.
- D1: `query(db, sql, params)`, `queryOne(...)`, `execute(...)` from `src/lib/db.js`. Timestamps are stored as SQLite UTC text `YYYY-MM-DD HH:MM:SS`.
- Password gate: `requireAuth(request, body, env, 'label')` from `src/lib/auth.js` (farm password as `Authorization: Bearer <pw>` or `body.password`).
- Test rows: `is_test` is `1` unless `env.HARVEST_TEST_MODE === 'false'`.
- Telegram: `sendTelegramMessage(env, { chatId, text })` from `src/lib/telegram.js` returns `false` when unconfigured.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Migration — three tables

**Files:**
- Create: `migrations/0032-harvest-hourly.sql`

**Step 1: Write the migration**

```sql
-- Harvest hourly crew log — one row per barn per hour, reported by the barn
-- foreman over SMS. Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
--
-- The row IS the state machine: it is inserted when the prompt goes out
-- (pending), moves to nudged after one reminder, and ends complete or missing.
-- Every cron tick decides what to do from status + timestamps, so a late or
-- doubled tick never sends twice.
--
-- barn is stored directly. harvest_scan_log derives barn from bay to keep two
-- columns from disagreeing; there is no bay here, so the rule is not broken.

CREATE TABLE IF NOT EXISTS harvest_hourly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  harvest_date TEXT NOT NULL,                  -- Pacific civil date YYYY-MM-DD
  hour_start TEXT NOT NULL,                    -- 'HH:00' Pacific, the hour being reported
  barn TEXT NOT NULL CHECK (barn IN ('upper', 'bottom')),
  cutters INTEGER,
  cutter_water_spiders INTEGER,                -- field side
  drivers INTEGER,
  hangers INTEGER,
  hanging_water_spiders INTEGER,               -- barn side
  racks INTEGER,
  notes TEXT,
  raw_reply TEXT,                              -- latest inbound text, verbatim
  reported_by TEXT,                            -- E.164 phone
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'nudged', 'complete', 'missing')),
  asked_at TEXT,
  nudged_at TEXT,
  answered_at TEXT,
  is_test INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (harvest_date, hour_start, barn, is_test)
);

CREATE INDEX IF NOT EXISTS idx_harvest_hourly_day
  ON harvest_hourly(harvest_date, barn, is_test);

-- Who gets texted. EMPEZAR sets active=1, PARAR (or the auto-stop) clears it.
CREATE TABLE IF NOT EXISTS harvest_foremen (
  phone TEXT PRIMARY KEY,                      -- E.164, e.g. +15415551234
  name TEXT NOT NULL,
  barn TEXT NOT NULL CHECK (barn IN ('upper', 'bottom')),
  active INTEGER NOT NULL DEFAULT 0,
  active_since TEXT,
  lang TEXT NOT NULL DEFAULT 'es',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Twilio retries deliveries; the MessageSid makes a redelivery a no-op.
CREATE TABLE IF NOT EXISTS harvest_sms_inbox (
  message_sid TEXT PRIMARY KEY,
  from_phone TEXT NOT NULL,
  body TEXT,
  received_at TEXT DEFAULT (datetime('now'))
);
```

**Step 2: Apply it to the local D1 and confirm the tables exist**

Run (from `workers/`):
```bash
npx wrangler d1 execute rogue-origin-db --local --file=migrations/0032-harvest-hourly.sql
npx wrangler d1 execute rogue-origin-db --local --command="SELECT name FROM sqlite_master WHERE name LIKE 'harvest_%' ORDER BY name"
```
Expected: the second command lists `harvest_foremen`, `harvest_hourly`, `harvest_sms_inbox` (plus the existing harvest tables if the local DB has them).

**Step 3: Commit**

```bash
git add migrations/0032-harvest-hourly.sql
git commit -m "feat(harvest): hourly crew log tables (harvest_hourly, harvest_foremen, harvest_sms_inbox)"
```

---

### Task 2: Pacific time helpers

The existing helpers in `harvest-d1.js` are not exported. Rather than reach into a 4,800-line file, put four tiny functions in their own lib. Do not modify `harvest-d1.js`.

**Files:**
- Create: `src/lib/pacific.js`
- Test: `test/pacific.test.mjs`

**Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc, parseSqliteUtc } from '../src/lib/pacific.js';

test('pacificDay: 2am UTC is still the previous Pacific day', () => {
  assert.equal(pacificDay(new Date('2026-10-15T02:00:00Z')), '2026-10-14');
});

test('pacificParts across the November DST change', () => {
  // 2026-11-01 09:30 UTC = 02:30 PDT? No: clocks fell back at 2am, so it is 01:30 PST.
  assert.deepEqual(pacificParts(new Date('2026-11-01T09:30:00Z')), { day: '2026-11-01', hour: 1, minute: 30 });
  // PDT in October: 17:07 UTC = 10:07 PDT
  assert.deepEqual(pacificParts(new Date('2026-10-15T17:07:00Z')), { day: '2026-10-15', hour: 10, minute: 7 });
  // PST in November: 17:07 UTC = 09:07 PST
  assert.deepEqual(pacificParts(new Date('2026-11-15T17:07:00Z')), { day: '2026-11-15', hour: 9, minute: 7 });
});

test('justEndedHour: at 10:07 the hour that just ended is 09:00', () => {
  assert.deepEqual(justEndedHour(new Date('2026-10-15T17:07:00Z')), { harvest_date: '2026-10-15', hour_start: '09:00' });
});

test('justEndedHour: at 00:xx nothing ended today', () => {
  assert.equal(justEndedHour(new Date('2026-10-15T07:20:00Z')), null); // 00:20 PDT
});

test('sqliteUtc round-trips through parseSqliteUtc', () => {
  const d = new Date('2026-10-15T17:07:09Z');
  assert.equal(sqliteUtc(d), '2026-10-15 17:07:09');
  assert.equal(parseSqliteUtc('2026-10-15 17:07:09').getTime(), d.getTime());
});
```

**Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/pacific.js'`.

**Step 3: Implement**

```js
/**
 * Pacific-time helpers for the harvest hourly log.
 *
 * Same approach as harvest-d1.js: let Intl carry the DST rules rather than an
 * offset that is right for half of harvest and wrong for the other half — the
 * season runs across the November change. Duplicated here (four lines) rather
 * than exported from the 4,800-line handler, so the pure libs stay importable
 * in tests without dragging Shopify and R2 code along.
 */
export const HARVEST_TZ = 'America/Los_Angeles';

/** The civil date in Pacific, 'YYYY-MM-DD'. */
export function pacificDay(date) {
  return date.toLocaleDateString('en-CA', { timeZone: HARVEST_TZ });
}

/** { day, hour, minute } of the Pacific wall clock at the given instant. */
export function pacificParts(date) {
  // 'sv-SE' formats as "YYYY-MM-DD HH:MM:SS"
  const s = date.toLocaleString('sv-SE', { timeZone: HARVEST_TZ });
  return { day: s.slice(0, 10), hour: Number(s.slice(11, 13)), minute: Number(s.slice(14, 16)) };
}

/**
 * The hour that just ended, as the barn labels it. At 10:07 Pacific that is
 * { harvest_date: today, hour_start: '09:00' }. Null during the 00:xx hour —
 * the hour that ended belongs to yesterday and nobody is hanging at midnight.
 */
export function justEndedHour(date) {
  const p = pacificParts(date);
  if (p.hour === 0) return null;
  return { harvest_date: p.day, hour_start: String(p.hour - 1).padStart(2, '0') + ':00' };
}

/** SQLite's own timestamp text, "YYYY-MM-DD HH:MM:SS", always UTC. */
export function sqliteUtc(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function parseSqliteUtc(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z');
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: all passing, 0 failing.

**Step 5: Commit**

```bash
git add src/lib/pacific.js test/pacific.test.mjs
git commit -m "feat(harvest): Pacific hour helpers for the hourly log"
```

---

### Task 3: Pure hourly logic — constants, validation, commands, message text, state decisions

**Files:**
- Create: `src/lib/harvest-hourly.js`
- Test: `test/harvest-hourly.test.mjs`

**Step 1: Write the failing tests**

```
See the committed files — the canonical version lives in the repo (workers/src/lib/harvest-hourly.js, workers/test/harvest-hourly.test.mjs).
```

**Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

**Step 3: Implement**

```
See the committed files — the canonical version lives in the repo (workers/src/lib/harvest-hourly.js, workers/test/harvest-hourly.test.mjs).
```

**Step 4: Run tests**

Run: `npm test`
Expected: all passing, 0 failing. If `promptText` is over 160 characters, shorten the wording, not the field list.

**Step 5: Commit**

```bash
git add src/lib/harvest-hourly.js test/harvest-hourly.test.mjs
git commit -m "feat(harvest): pure hourly-log logic — validation, commands, texts, tick decisions"
```

---

### Task 4: Twilio send and signature verification

**Files:**
- Create: `src/lib/sms.js`
- Test: `test/sms.test.mjs`

**Step 1: Write the failing tests**

The signature test uses Node's own `crypto` as an independent oracle for the WebCrypto implementation.

```
See the committed files — the canonical version lives in the repo (workers/src/lib/sms.js, workers/test/sms.test.mjs).
```

**Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

**Step 3: Implement**

```
See the committed files — the canonical version lives in the repo (workers/src/lib/sms.js, workers/test/sms.test.mjs).
```

**Step 4: Run tests**

Run: `npm test`
Expected: all passing, 0 failing.

**Step 5: Commit**

```bash
git add src/lib/sms.js test/sms.test.mjs
git commit -m "feat(harvest): Twilio send + webhook signature verification"
```

---

### Task 5: Reply parsing with Claude (structured output)

**Files:**
- Create: `src/lib/harvest-hourly-parse.js`
- Test: `test/harvest-hourly-parse.test.mjs`

Model per the design: `claude-opus-5`, `output_config.effort: 'low'`, JSON-schema structured output, server-side refusal fallback. Raw `fetch` like `production/chat.js` — the worker has no npm SDK dependency; keep it that way. `env.HARVEST_HOURLY_MODEL` overrides the model without a code change.

**Step 1: Write the failing tests**

```
See the committed files — the canonical version lives in the repo (workers/src/lib/harvest-hourly-parse.js, workers/test/harvest-hourly-parse.test.mjs).
```

**Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

**Step 3: Implement**

```
See the committed files — the canonical version lives in the repo (workers/src/lib/harvest-hourly-parse.js, workers/test/harvest-hourly-parse.test.mjs).
```

**Step 4: Run tests**

Run: `npm test`
Expected: all passing, 0 failing.

**Step 5: Commit**

```bash
git add src/lib/harvest-hourly-parse.js test/harvest-hourly-parse.test.mjs
git commit -m "feat(harvest): parse foreman SMS replies with Claude structured output"
```

---

### Task 6: The D1 handler — inbound, tick, read, admin, simulate

This is the only file that touches D1 and the network. Keep it thin: every rule is already in the libs.

**Files:**
- Create: `src/handlers/harvest-hourly-d1.js`

No unit test for this file (there is no D1 test harness in the repo). It is exercised end to end in Task 7 through `hourly_simulate` on `wrangler dev`.

**Step 1: Write the handler**

```js
/**
 * Harvest hourly crew log — SMS bot handler (D1).
 *
 * One Spanish text per barn per hour to its foreman; one free-form reply,
 * parsed by Claude, stored as one harvest_hourly row per barn-hour.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
 *
 * Endpoints (dispatched from index.js):
 * - POST /sms/inbound                              Twilio webhook (signature-verified)
 * - GET  /api/harvest?action=hourly&date=YYYY-MM-DD   rows + day summary   [password]
 * - GET  /api/harvest?action=foremen               registry                 [password]
 * - POST /api/harvest?action=foreman_set           {phone,name,barn,active} [password]
 * - POST /api/harvest?action=hourly_simulate       {from, body} -> replies  [password]
 * - GET  /api/harvest?action=hourly_test           health
 * - cron: runHarvestHourlyTick(env) from the */5 branch
 */
import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendSms, verifyTwilioSignature } from '../lib/sms.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc } from '../lib/pacific.js';
import {
  COUNT_FIELDS, BARN_LABELS, validateCounts, missingFields, classifyInbound,
  promptText, reminderText, helpText, confirmText, askMissingText, notUnderstoodText,
  normalizeNotes, tickDecision, shouldAutoStop,
} from '../lib/harvest-hourly.js';
import { parseReply } from '../lib/harvest-hourly-parse.js';

export const HOURLY_ACTIONS = new Set(['hourly', 'foremen', 'foreman_set', 'hourly_simulate', 'hourly_test']);

const isTestMode = (env) => env.HARVEST_TEST_MODE !== 'false';
// The season is the harvest date's own year, not the wall-clock year: a row
// written just after midnight UTC still belongs to the Pacific day it reports.
const seasonOf = (day) => Number(day.slice(0, 4));

// ─── HTTP: /api/harvest?action=hourly* ─────────────────────────────────

export async function handleHarvestHourly(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  switch (action) {
    case 'hourly_test':
      return successResponse({ success: true, message: 'Harvest hourly API operational' });
    case 'hourly':
      requireAuth(request, body, env, 'harvest-hourly');
      return successResponse(await readDay(db, env, params.date || pacificDay(new Date())));
    case 'foremen':
      requireAuth(request, body, env, 'harvest-foremen');
      return successResponse({ foremen: await query(db, `SELECT * FROM harvest_foremen ORDER BY barn, name`) });
    case 'foreman_set':
      requireAuth(request, body, env, 'harvest-foreman-set');
      return successResponse(await setForeman(db, body));
    case 'hourly_simulate': {
      requireAuth(request, body, env, 'harvest-hourly-simulate');
      if (!body.from || !body.body) throw createError('VALIDATION_ERROR', 'from and body are required');
      const replies = await processInbound(env, {
        from: String(body.from), text: String(body.body), sid: `SIM-${Date.now()}`, deliver: false,
      });
      return successResponse({ replies });
    }
    default:
      throw createError('NOT_FOUND', `Unknown hourly action: ${action}`);
  }
}

async function setForeman(db, body) {
  const phone = String(body.phone || '').trim();
  const name = String(body.name || '').trim();
  const barn = String(body.barn || '').trim();
  if (!/^\+1\d{10}$/.test(phone)) throw createError('VALIDATION_ERROR', 'phone must be E.164, e.g. +15415551234');
  if (!name) throw createError('VALIDATION_ERROR', 'name is required');
  if (!BARN_LABELS[barn]) throw createError('VALIDATION_ERROR', 'barn must be upper or bottom');
  const active = body.active ? 1 : 0;
  await execute(db, `
    INSERT INTO harvest_foremen (phone, name, barn, active, active_since)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, barn = excluded.barn, active = excluded.active,
      active_since = CASE WHEN excluded.active = 1 AND harvest_foremen.active = 0 THEN datetime('now') ELSE harvest_foremen.active_since END
  `, [phone, name, barn, active, active]);
  return { foreman: await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [phone]) };
}

// ─── HTTP: POST /sms/inbound (Twilio) ──────────────────────────────────

export async function handleSmsInbound(request, env, ctx) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const form = await parseBody(request);            // application/x-www-form-urlencoded

  if (env.TWILIO_AUTH_TOKEN) {
    // Twilio signs the URL it was configured with. Behind a custom domain or a
    // proxy, request.url is the worker's own URL and every signature fails —
    // TWILIO_WEBHOOK_URL pins the string Twilio actually signed.
    const signedUrl = env.TWILIO_WEBHOOK_URL || request.url;
    const ok = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, signedUrl, form,
      request.headers.get('x-twilio-signature'));
    if (!ok) {
      console.warn(`[sms] bad Twilio signature (verified against ${signedUrl})`);
      return new Response('Forbidden', { status: 403 });
    }
  } else {
    console.warn('[sms] TWILIO_AUTH_TOKEN unset — inbound is unauthenticated');
  }

  // Reply over the REST API, not TwiML, so the simulate path and the real path
  // share one code path. Twilio just needs a 200 with an empty <Response/>.
  ctx.waitUntil(processInbound(env, {
    from: String(form.From || ''), text: String(form.Body || ''), sid: String(form.MessageSid || ''), deliver: true,
  }).catch(e => console.error(`[sms] inbound failed: ${e.message}`)));

  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

// ─── CORE: one inbound text ────────────────────────────────────────────

/**
 * @returns string[] the texts sent (or, with deliver=false, that would be sent)
 */
export async function processInbound(env, { from, text, sid, deliver, now = new Date() }) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;

  // Dedupe on Twilio's message id: a redelivery must not write twice.
  if (sid) {
    const { changes } = await execute(db,
      `INSERT OR IGNORE INTO harvest_sms_inbox (message_sid, from_phone, body) VALUES (?, ?, ?)`, [sid, from, text]);
    if (changes === 0) return [];
  }

  const foreman = await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [from]);
  if (!foreman) {
    console.log(`[sms] ignored text from unregistered ${from}: ${text.slice(0, 80)}`);
    return [];
  }

  const replies = [];
  const say = (t) => replies.push(t);
  const c = classifyInbound(text);

  if (c.kind === 'start') {
    await execute(db, `UPDATE harvest_foremen SET active = 1, active_since = ? WHERE phone = ?`, [sqliteUtc(now), from]);
    // One active foreman per barn — the last EMPEZAR wins, so a handover does
    // not leave two phones being texted for the same hour.
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE barn = ? AND phone <> ?`, [foreman.barn, from]);
    say('Listo. Te pregunto cada hora en punto. PARAR para terminar el dia.');
  } else if (c.kind === 'stop') {
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE phone = ?`, [from]);
    const day = pacificDay(now);
    const tot = await queryOne(db, `SELECT COALESCE(SUM(racks), 0) AS racks FROM harvest_hourly
      WHERE harvest_date = ? AND barn = ? AND is_test = ?`, [day, foreman.barn, isTest]);
    say(`Ok, paramos. Hoy ${BARN_LABELS[foreman.barn]}: ${tot.racks} racks. Gracias.`);
  } else if (c.kind === 'help') {
    say(helpText(foreman.barn));
  } else {
    await answer(db, env, { foreman, hour: c.hour, text: c.text, from, isTest, now, say });
  }

  if (deliver) {
    for (const t of replies) await sendSms(env, { to: from, body: t });
  }
  return replies;
}

async function answer(db, env, { foreman, hour, text, from, isTest, now, say }) {
  const day = pacificDay(now);
  const barn = foreman.barn;

  let row;
  if (hour) {
    row = await getOrCreateRow(db, { day, hour, barn, isTest, season: seasonOf(day) });
  } else {
    if (!foreman.active) { say('Escribe EMPEZAR para comenzar el dia.'); return; }
    row = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
      AND status IN ('pending', 'nudged') ORDER BY hour_start DESC LIMIT 1`, [day, barn, isTest]);
    if (!row) {
      const je = justEndedHour(now);
      if (!je) { say('Todavia no hay hora que reportar.'); return; }
      row = await getOrCreateRow(db, { day: je.harvest_date, hour: je.hour_start, barn, isTest, season: seasonOf(je.harvest_date) });
    }
  }

  const parsed = await parseReply(text, { barn, hour_start: row.hour_start, missing: missingFields(row) }, env);
  if (!parsed) { say(notUnderstoodText()); return; }

  // A model-detected hour ("las 9") retargets only when the text had no prefix.
  if (!hour && parsed.hour_override && /^\d{2}:00$/.test(parsed.hour_override) && parsed.hour_override !== row.hour_start) {
    row = await getOrCreateRow(db, { day, hour: parsed.hour_override, barn, isTest, season: seasonOf(day) });
  }

  const { values, invalid } = validateCounts(parsed);
  const merged = { ...row };
  for (const f of COUNT_FIELDS) if (values[f] !== null) merged[f] = values[f];
  // "Sin novedad" is not a note — normalizeNotes drops it, so a day summary is
  // not padded with six copies of "nothing to report".
  const note = normalizeNotes(parsed.notes);
  if (note) merged.notes = row.notes ? `${row.notes}; ${note}` : note;

  const still = missingFields(merged);
  const status = still.length ? (row.status === 'missing' ? 'nudged' : row.status === 'complete' ? 'complete' : row.status) : 'complete';
  await execute(db, `
    UPDATE harvest_hourly SET cutters = ?, cutter_water_spiders = ?, drivers = ?, hangers = ?, hanging_water_spiders = ?,
      racks = ?, notes = ?, raw_reply = ?, reported_by = ?, answered_at = ?, status = ?
    WHERE id = ?
  `, [merged.cutters, merged.cutter_water_spiders, merged.drivers, merged.hangers, merged.hanging_water_spiders,
      merged.racks, merged.notes ?? null, text, from, sqliteUtc(now), status, row.id]);

  if (still.length) {
    const why = invalid.length ? `Numero fuera de rango: ${invalid.join(', ')}. ` : '';
    say(why + askMissingText({ ...merged, hour_start: row.hour_start }));
  } else {
    say(confirmText({ ...merged, hour_start: row.hour_start, barn }));
  }
}

async function getOrCreateRow(db, { day, hour, barn, isTest, season }) {
  const existing = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
    [day, hour, barn, isTest]);
  if (existing) return existing;
  await execute(db, `INSERT INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'), ?)`, [season, day, hour, barn, isTest]);
  return await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
    [day, hour, barn, isTest]);
}

// ─── CRON: every 5 minutes ─────────────────────────────────────────────

export async function runHarvestHourlyTick(env, now = new Date()) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;
  const foremen = await query(db, `SELECT * FROM harvest_foremen WHERE active = 1`);
  if (!foremen.length) return { acted: 0 };

  const { hour: hourNow } = pacificParts(now);
  const je = justEndedHour(now);
  const day = pacificDay(now);
  let acted = 0;

  for (const f of foremen) {
    // One barn's bad phone number must not stop the other barn's hour. Each
    // foreman is isolated; the write still lands before the send, so a failed
    // text leaves a row that the next tick can move forward.
    try {
      const recent = await query(db, `SELECT status, asked_at FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
        AND status IN ('complete', 'missing') ORDER BY hour_start DESC LIMIT 3`, [day, f.barn, isTest]);
      // active_since scopes the three-missed rule to the current run, so a
      // foreman who texts EMPEZAR again is not stopped by the run before it.
      if (shouldAutoStop({ hourNow, recent, activeSince: f.active_since })) {
        await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE phone = ?`, [f.phone]);
        await sendSms(env, { to: f.phone, body: 'Paramos por hoy. Escribe EMPEZAR manana.' });
        acted++;
        continue;
      }
      if (!je) continue;

      const row = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
        [je.harvest_date, je.hour_start, f.barn, isTest]);
      const d = tickDecision(row, now, { activeSince: f.active_since });
      if (!d) continue;
      acted++;

      if (d.type === 'ask') {
        await execute(db, `INSERT OR IGNORE INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`, [seasonOf(je.harvest_date), je.harvest_date, je.hour_start, f.barn, sqliteUtc(now), isTest]);
        await sendSms(env, { to: f.phone, body: promptText(f.barn, je.hour_start) });
      } else if (d.type === 'nudge') {
        await execute(db, `UPDATE harvest_hourly SET status = 'nudged', nudged_at = ? WHERE id = ? AND status = 'pending'`, [sqliteUtc(now), row.id]);
        await sendSms(env, { to: f.phone, body: reminderText(f.barn, je.hour_start) });
      } else if (d.type === 'missing') {
        await execute(db, `UPDATE harvest_hourly SET status = 'missing' WHERE id = ? AND status = 'nudged'`, [row.id]);
        await sendTelegramMessage(env, {
          chatId: env.TELEGRAM_HARVEST_HOURLY_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID,
          text: `⏰ Sin respuesta: ${BARN_LABELS[f.barn]} ${je.hour_start} (${f.name})`,
        });
      }
    } catch (e) {
      console.error(`[hourly-tick] ${f.phone}: ${e.message}`);
    }
  }
  return { acted };
}

// ─── READ ──────────────────────────────────────────────────────────────

async function readDay(db, env, date) {
  const isTest = isTestMode(env) ? 1 : 0;
  const rows = await query(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND is_test = ? ORDER BY barn, hour_start`, [date, isTest]);
  const roster = await queryOne(db, `SELECT * FROM harvest_crew_roster WHERE effective_to IS NULL AND is_test = ? ORDER BY effective_from DESC LIMIT 1`, [isTest]);

  const barns = {};
  for (const barn of Object.keys(BARN_LABELS)) {
    const mine = rows.filter(r => r.barn === barn);
    const done = mine.filter(r => r.status === 'complete');
    const sum = (f) => done.reduce((s, r) => s + (r[f] || 0), 0);
    const personHours = ['cutters', 'cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders'].reduce((s, f) => s + sum(f), 0);
    const hangerHours = sum('hangers');
    barns[barn] = {
      label: BARN_LABELS[barn],
      rows: mine,
      total_racks: sum('racks'),
      person_hours: personHours,
      racks_per_hanger_hour: hangerHours ? Math.round((sum('racks') / hangerHours) * 100) / 100 : null,
      missing_hours: mine.filter(r => r.status === 'missing').map(r => r.hour_start),
      latest: mine.filter(r => r.status === 'complete').slice(-1)[0] || null,
    };
  }
  return { date, is_test: isTest, roster, barns };
}
```

**Step 2: Syntax check**

Run: `node --check src/handlers/harvest-hourly-d1.js`
Expected: no output (exit 0).

**Step 3: Commit**

```bash
git add src/handlers/harvest-hourly-d1.js
git commit -m "feat(harvest): hourly SMS handler — inbound, tick, read, foreman admin, simulate"
```

---

### Task 7: Wire it into index.js and smoke-test on wrangler dev

**Files:**
- Modify: `src/index.js` — imports (top), the `isFiveMinCron` block, the `/api/harvest` route, a new `/sms/inbound` route, the health-check endpoint list.

**Step 1: Add the import** next to the other handler imports:

```js
import { handleHarvestHourly, handleSmsInbound, HOURLY_ACTIONS } from './handlers/harvest-hourly-d1.js';
```

**Step 2: Add the tick to the every-5-minutes block**, after the wholesale cron `try/catch` inside `if (isFiveMinCron) { ... }`:

```js
      // Harvest hourly SMS log: ask / nudge / flag, driven by row state so a
      // late or doubled tick never texts twice. No top-of-hour cron on purpose:
      // the dispatcher above reads "0 * * * *" as the daily job.
      try {
        const { runHarvestHourlyTick } = await import('./handlers/harvest-hourly-d1.js');
        const { acted } = await runHarvestHourlyTick(env);
        if (acted) console.log(`[Cron] Harvest hourly: ${acted} action(s)`);
      } catch (e) {
        console.error(`[Cron] Harvest hourly tick failed: ${e.message}`);
      }
```

**Step 3: Route.** Replace

```js
      } else if (path.startsWith('/api/harvest')) {
        response = await handleHarvestD1(request, env, ctx);
```
with
```js
      } else if (path === '/sms/inbound') {
        // Twilio webhook for the harvest hourly log. Not under /api so the
        // client-log and CORS assumptions for browser callers don't apply.
        response = await handleSmsInbound(request, env, ctx);
      } else if (path.startsWith('/api/harvest')) {
        response = HOURLY_ACTIONS.has(url.searchParams.get('action'))
          ? await handleHarvestHourly(request, env, ctx)
          : await handleHarvestD1(request, env, ctx);
```

Also add `'/sms/inbound'` is NOT needed in the health-check `endpoints` list (that list is `/api/*` only). Leave it.

**Step 4: Local secrets.** Create `workers/.dev.vars` (confirm it is ignored first: `git check-ignore -q .dev.vars && echo ignored`; if not, add `.dev.vars` to `.gitignore` and commit that alone). Contents:

```
ORDERS_PASSWORD=devpass
ANTHROPIC_API_KEY=<your real key, needed for the parse step>
HARVEST_TEST_MODE=true
```
Leave the Twilio secrets unset: `sendSms` then logs the text instead of sending, which is exactly what the smoke test reads.

**Step 5: Start the dev server** (Browser pane, not Bash): `preview_start` with a `.claude/launch.json` entry `{ "name": "api", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 8787 }` created in the worktree root if missing. Apply the migration locally if Task 1 Step 2 was run in another checkout: `npx wrangler d1 execute rogue-origin-db --local --file=migrations/0032-harvest-hourly.sql`.

**Step 6: Smoke script.** Run each and compare (`-H "Authorization: Bearer devpass"` on every call):

```bash
curl -s "http://localhost:8787/api/harvest?action=hourly_test"
```
Expected: `{"success":true,"message":"Harvest hourly API operational"}`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=foreman_set" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"phone":"+15415550101","name":"Test Arriba","barn":"upper"}'
```
Expected: `foreman` object with `active: 0`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"4 2 3 8 1 12"}'
```
Expected: `replies: ["Escribe EMPEZAR para comenzar el dia."]`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"empezar"}'
```
Expected: `replies: ["Listo. Te pregunto cada hora en punto. PARAR para terminar el dia."]`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"9am: 4 2 3 8 1 12 se rompio un rack"}'
```
Expected: `replies: ["Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack"]` (this one calls Claude for real).

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"10am: cuatro cortadores, 2 ws, 3 choferes"}'
```
Expected: `replies: ["Falta: colgadores, waterspiders granero, racks. Cuantos de 10 a 11?"]`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"10am: 8 1 15"}'
```
Expected: `replies: ["Ok 10-11 Arriba: C4 WSc2 Ch3 Col8 WSg1 R15"]` — the three bare numbers filled the three missing fields in order.

```bash
curl -s "http://localhost:8787/api/harvest?action=hourly" -H "Authorization: Bearer devpass"
```
Expected: `barns.upper.rows` has two complete rows (09:00, 10:00), `total_racks: 27`, `person_hours: 36`, `racks_per_hanger_hour: 1.69`.

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550101","body":"parar"}'
```
Expected: `replies: ["Ok, paramos. Hoy Granero Arriba: 27 racks. Gracias."]`.

Unregistered number:
```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '{"from":"+15415550999","body":"hola"}'
```
Expected: `replies: []`.

**Step 7: Tick smoke.** Trigger the cron locally: `curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` (wrangler dev exposes scheduled handlers on `/__scheduled` when started with `--test-scheduled`; add that flag to `runtimeArgs` for this step: `["run","dev","--","--test-scheduled"]`). With the test foreman set active (`foreman_set` with `"active": true`) and the clock past the top of an hour, the dev server log shows `[sms] not configured — to +15415550101: <prompt>` and `hourly` shows a `pending` row for the just-ended hour. Reset with `parar` afterwards.

**Step 8: Run the unit tests once more, then commit**

```bash
npm test
git add src/index.js
git commit -m "feat(harvest): route /sms/inbound, hourly actions, and the 5-min hourly tick"
```
(Do not commit `.dev.vars` or `.claude/launch.json` unless `launch.json` is already tracked in the repo — check with `git ls-files .claude`.)

---

### Task 8: Dashboard panel

**Files:**
- Modify: `src/handlers/harvest-dash-page.js` — `load()` around line 232, `render()` around line 355, and a new `cardHourly()` next to the other `card*` functions.

The dashboard fetches everything after the password is typed. Add a second fetch for `?action=hourly` and one card.

**Step 1: In `load(pw)`**, after `render(j, false);` inside the `.then(function (j) { ... })`, add:

```js
        loadHourly(pw);
```
and add this function after `load`:

```js
  function loadHourly(pw) {
    return fetch(API + '?action=hourly', { headers: { authorization: pw } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) {
        var host = $('hourly'); if (!host) return;
        host.innerHTML = h ? cardHourly(h) : '';
      })
      .catch(function () {});
  }
```

**Step 2: In `render()`**, change the final cards line to leave a slot for the hourly card first:

```js
    $('cards').innerHTML = ['<div id="hourly"></div>',
      cardRacks(d), cardDry(d), cardCadence(d), cardCrew(d), cardAfterTag(d), cardFeed(d)
    ].join('');
```

**Step 3: Add the card** (next to `cardCrew`). One line per hour per barn, a day summary, and the roster beside the latest hourly counts:

```js
  // 0 ── hourly crew log (SMS bot)
  function cardHourly(h) {
    var barns = ['upper', 'bottom'];
    var any = barns.some(function (b) { return h.barns[b].rows.length; });
    if (!any) {
      return '<section class="card"><h2>Hourly crew log</h2><p class="lede">No hourly texts yet today (' + esc(h.date) + ').</p></section>';
    }
    var head = '<tr><th>Hour</th><th>Cut</th><th>WS field</th><th>Drv</th><th>Hang</th><th>WS barn</th><th>Racks</th><th>Notes</th></tr>';
    var blocks = barns.map(function (b) {
      var x = h.barns[b];
      var rows = x.rows.map(function (r) {
        var st = r.status === 'complete' ? '' : ' <span class="muted">(' + esc(r.status) + ')</span>';
        return '<tr><td>' + esc(r.hour_start) + st + '</td><td>' + num(r.cutters) + '</td><td>' + num(r.cutter_water_spiders) +
          '</td><td>' + num(r.drivers) + '</td><td>' + num(r.hangers) + '</td><td>' + num(r.hanging_water_spiders) +
          '</td><td>' + num(r.racks) + '</td><td>' + esc(r.notes || '') + '</td></tr>';
      }).join('');
      var mismatch = '';
      if (h.roster && x.latest) {
        var diff = ['drivers', 'cutter_water_spiders', 'hangers', 'hanging_water_spiders'].filter(function (f) {
          return h.roster[f] != null && x.latest[f] != null && h.roster[f] !== x.latest[f];
        });
        if (diff.length) mismatch = '<p class="lede">Roster differs on: ' + esc(diff.join(', ')) + '</p>';
      }
      return '<h3>' + esc(x.label) + ' — ' + x.total_racks + ' racks · ' + x.person_hours + ' person-hrs · ' +
        (x.racks_per_hanger_hour == null ? '—' : x.racks_per_hanger_hour) + ' racks/hanger-hr' +
        (x.missing_hours.length ? ' · missing ' + esc(x.missing_hours.join(', ')) : '') + '</h3>' +
        mismatch + '<div style="overflow-x:auto"><table>' + head + rows + '</table></div>';
    }).join('');
    return '<section class="card"><h2>Hourly crew log</h2>' + blocks + '</section>';
  }
```

If the page has no `table` / `th` / `td` / `.muted` styles, add minimal ones to its `<style>` block (borders off, `td { padding: 2px 8px }`, `.muted { opacity: .6 }`). Do not restyle anything else.

**Step 4: Verify in the browser.** With the dev server up and the smoke rows from Task 7 in the local DB, open `http://localhost:8787/api/harvest?action=harvest_dash`, enter `devpass`, and confirm the "Hourly crew log" card shows the 09:00 and 10:00 rows for Granero Arriba with `27 racks`. Take a screenshot for the PR.

**Step 5: Commit**

```bash
git add src/handlers/harvest-dash-page.js
git commit -m "feat(harvest): hourly crew log panel on the harvest dashboard"
```

---

### Task 9: Handler docs and deploy checklist

**Files:**
- Modify: `src/index.js` header comment — add `/sms/inbound` to the Routes list.
- Modify: `wrangler.toml` — add the new secrets to the "Required secrets" comment block:
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TELEGRAM_HARVEST_HOURLY_CHAT_ID` (optional, falls back to `TELEGRAM_TEST_CHAT_ID`), and the optional vars:
  - `TWILIO_WEBHOOK_URL` — set only if the worker moves behind a custom domain or a proxy. Twilio signs the URL it was configured with; when that is not the URL the worker sees, `request.url` no longer matches and every inbound signature fails. Leave unset on `*.workers.dev`.
  - `HARVEST_HOURLY_MODEL` — overrides the parse model. It must be a model that accepts `output_config.effort` and `fallbacks`: Sonnet 5 does, Haiku 4.5 does not. A model that rejects them makes every parse a 400, and every reply comes back "No entendi".
- Create: `docs/harvest-hourly-sms.md` — the runbook below.

**Step 1: Write the runbook**

```markdown
# Harvest hourly SMS bot — runbook

Design: RogueFamilyFarms/wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md

## Deploy (first time)
1. Check drift: `git rev-list --left-right --count master...origin/master` must be `0 0` on master before merging.
2. Migration (remote, by hand — wrangler.toml has no migrations_dir):
   `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0032-harvest-hourly.sql`
   If it fails with `D1_RESET_DO`, run each CREATE statement separately with `--command`.
3. Secrets: `npx wrangler secret put TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (E.164), optionally `TELEGRAM_HARVEST_HOURLY_CHAT_ID`.
4. Deploy: `cd workers && npx wrangler deploy` (never the root `npm run deploy`).
5. Twilio console → the toll-free number → Messaging → "A message comes in": Webhook, HTTP POST,
   `https://rogue-origin-api.roguefamilyfarms.workers.dev/sms/inbound`.
6. Register foremen (farm password):
   `curl -X POST "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=foreman_set" -H "Authorization: Bearer <pw>" -H "Content-Type: application/json" -d '{"phone":"+1...","name":"...","barn":"upper"}'`
7. Live test while HARVEST_TEST_MODE is still "true": text EMPEZAR from a registered phone, wait for the next top of hour, answer, check `?action=hourly`.

## Daily
- Foreman texts EMPEZAR at the start, PARAR at the end. Auto-stop after three missed hours or at 8 PM Pacific.
- Missed hours arrive in the Telegram harvest chat as `⏰ Sin respuesta: <barn> <hour>`.
- Backfill: text `9am: 4 2 3 8 1 12`.

## Costs
- SMS ~$0.0083/segment, 2–4 texts per barn-hour. Model: one Opus 5 low-effort call per reply.
```

**Step 2: Run the full test suite one last time**

Run: `npm test`
Expected: all passing, 0 failing.

**Step 3: Commit**

```bash
git add src/index.js wrangler.toml docs/harvest-hourly-sms.md
git commit -m "docs(harvest): hourly SMS bot runbook + secret list"
```

---

### Task 10: Finish the branch

Use `superpowers:finishing-a-development-branch`. Summary for the PR: the design record link, the smoke-test transcript from Task 7, the dashboard screenshot from Task 8, and the three things Koa must do before the first real ping (Twilio number verified, foremen registered, secrets set). Do not deploy from the worktree; merge to `master` first and deploy from the main clone per the runbook.
