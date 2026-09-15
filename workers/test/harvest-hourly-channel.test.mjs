import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setForeman, sendToForeman, processInbound, runHarvestHourlyTick,
} from '../src/handlers/harvest-hourly-d1.js';

/**
 * A fake D1 that hands back canned results in call order and records the SQL
 * and bound params it was given. The point is not to emulate SQLite — it is to
 * pin the decisions the handler makes: which row it targets, what it stamps,
 * and which guard clauses it refuses to write without.
 *
 * Canned entries: an object/array for first()/all(), { changes: N } for run().
 */
function fakeDb(responses) {
  const calls = [];
  let i = 0;
  const take = () => responses[i++];
  return {
    calls,
    /** Calls whose SQL contains every one of `needles`. */
    matching(...needles) {
      return calls.filter(c => needles.every(n => c.sql.includes(n)));
    },
    prepare(sql) {
      return {
        bind(...params) {
          const call = { sql: String(sql).replace(/\s+/g, ' ').trim(), params };
          calls.push(call);
          return {
            all: async () => ({ results: take() ?? [] }),
            first: async () => take() ?? null,
            run: async () => ({ meta: { changes: take()?.changes ?? 1, last_row_id: 1 } }),
          };
        },
      };
    },
  };
}

/**
 * Every secret set, on purpose. sendSms returns false WITHOUT calling fetch
 * when the Twilio trio is unset, and sendWhatsapp does the same without the
 * mailbox pair — so a half-configured env turns every "the mailbox was called"
 * assertion below into "nothing was called", which passes while proving
 * nothing.
 */
const ENV = {
  HARVEST_TEST_MODE: 'true',
  TWILIO_ACCOUNT_SID: 'ACxxx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15415550100',
  WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k',
};

const MAILBOX_SEND = 'https://mailbox.example/send';
const TWILIO_HOST = 'api.twilio.com';

// 17:07Z on 2026-10-15 is 10:07 Pacific (PDT), so the hour that just ended is
// 09:00 and the Pacific hour is 10 — below STOP_HOUR, so a nudge still texts.
const NOW = new Date('2026-10-15T17:07:00Z');
const PHONE = '+15415550101';

/**
 * Replace global fetch and record every URL it is handed.
 *
 * sendViaChannel calls sendSms/sendWhatsapp without a fetchImpl, so they fall
 * through to the global binding — there is no injection seam at the handler
 * layer, and threading one through processInbound / sendToForeman /
 * runHarvestHourlyTick would be a far larger change than mocking the global.
 *
 * The same canned Response has to satisfy both shapes: a send reads res.ok
 * (and res.text() on failure), a poll additionally calls res.json().
 */
function mockFetch(t) {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return urls;
}

const hitMailbox = (urls) => urls.some(u => u.startsWith(MAILBOX_SEND));
const hitTwilio = (urls) => urls.some(u => u.includes(TWILIO_HOST));

/** Replace console.warn and record the lines it is handed. */
function mockWarn(t) {
  const lines = [];
  t.mock.method(console, 'warn', (...args) => { lines.push(args.join(' ')); });
  return lines;
}

// ─── setForeman: the channel param ─────────────────────────────────────

test('setForeman writes the channel it was given', async () => {
  const db = fakeDb([{ changes: 1 }, { changes: 1 }, { phone: PHONE, channel: 'whatsapp' }]);
  const r = await setForeman(db, {
    phone: PHONE, name: 'Test Arriba', barn: 'upper', active: true, channel: 'whatsapp',
  });

  const insert = db.matching('INSERT INTO harvest_foremen')[0];
  assert.ok(insert, 'the upsert runs');
  // Positional, not .includes(): the bound params are
  // [phone, name, barn, active, channel, active], and a channel that landed in
  // the wrong placeholder would still "include" the string.
  assert.equal(insert.params[4], 'whatsapp');
  assert.match(insert.sql, /channel = excluded\.channel/, 'an existing foreman is switched too');
  assert.equal(r.foreman.channel, 'whatsapp');
});

test('setForeman defaults an omitted channel to sms', async () => {
  const db = fakeDb([{ changes: 1 }, { changes: 1 }, { phone: PHONE, channel: 'sms' }]);
  await setForeman(db, { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: true });

  // Every foreman on the roster today predates the column, and must keep
  // getting SMS without anyone re-registering them.
  assert.equal(db.matching('INSERT INTO harvest_foremen')[0].params[4], 'sms');
});

test('setForeman refuses an unknown channel before a single query runs', async () => {
  const db = fakeDb([]);
  await assert.rejects(
    () => setForeman(db, { phone: PHONE, name: 'Test Arriba', barn: 'upper', channel: 'telegram' }),
    (e) => {
      assert.equal(e.code, 'VALIDATION_ERROR');
      assert.match(e.message, /channel must be sms or whatsapp/);
      return true;
    },
  );
  // There is no SQL CHECK on the column — this validation IS the constraint,
  // so it has to fire ahead of the write.
  assert.equal(db.calls.length, 0, 'a rejected channel must not touch the database');
});

// ─── processInbound: the deliver loop ──────────────────────────────────

/** The five canned responses one EMPEZAR costs: insert, foreman, two activity writes, markInbox. */
const empezarResponses = (foreman) => [
  { changes: 1 },   // INSERT OR IGNORE into the inbox, claimed processed = 1
  foreman,          // SELECT * FROM harvest_foremen WHERE phone = ?
  { changes: 1 },   // UPDATE active = 1
  { changes: 1 },   // UPDATE active = 0 for the barn's other phones
  { changes: 1 },   // markInbox
];

test('processInbound texts a whatsapp foreman through the mailbox, never Twilio', async (t) => {
  const urls = mockFetch(t);
  const db = fakeDb(empezarResponses({ phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 0, channel: 'whatsapp' }));

  const r = await processInbound({ ...ENV, DB: db }, {
    from: PHONE, text: 'EMPEZAR', sid: 'SM-wa-1', deliver: true, now: NOW,
  });

  assert.deepEqual(r.replies, ['Listo. Te pregunto cada hora en punto. PARAR para terminar el dia.']);
  assert.ok(hitMailbox(urls), `the mailbox was not called (urls: ${urls.join(', ')})`);
  assert.ok(!hitTwilio(urls), 'a whatsapp foreman must never cost a Twilio message');
});

test('processInbound still texts an sms foreman through Twilio', async (t) => {
  const urls = mockFetch(t);
  const db = fakeDb(empezarResponses({ phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 0, channel: 'sms' }));

  await processInbound({ ...ENV, DB: db }, {
    from: PHONE, text: 'EMPEZAR', sid: 'SM-sms-1', deliver: true, now: NOW,
  });

  assert.ok(hitTwilio(urls), `Twilio was not called (urls: ${urls.join(', ')})`);
  assert.ok(!hitMailbox(urls), 'an sms foreman must not be routed to the mailbox');
});

// ─── sendToForeman: the relay's outbound ───────────────────────────────

test('sendToForeman reaches a whatsapp foreman through the mailbox', async (t) => {
  const urls = mockFetch(t);
  const db = fakeDb([{ phone: PHONE, channel: 'whatsapp' }, { changes: 1 }]);

  const r = await sendToForeman(db, ENV, { to: PHONE, text: 'Ok 9-10 Arriba: R12' });

  // The lookup has to carry the column, or the ternary reads undefined and
  // every whatsapp foreman silently falls back to SMS.
  assert.match(db.calls[0].sql, /SELECT phone, channel FROM harvest_foremen/);
  assert.equal(r.sent, true);
  assert.ok(hitMailbox(urls), `the mailbox was not called (urls: ${urls.join(', ')})`);
  assert.ok(!hitTwilio(urls), 'a whatsapp foreman must never cost a Twilio message');
});

test('sendToForeman still reaches an sms foreman through Twilio', async (t) => {
  const urls = mockFetch(t);
  const warns = mockWarn(t);
  const db = fakeDb([{ phone: PHONE, channel: 'sms' }, { changes: 1 }]);

  await sendToForeman(db, ENV, { to: PHONE, text: 'Ok 9-10 Arriba: R12' });

  assert.ok(hitTwilio(urls), `Twilio was not called (urls: ${urls.join(', ')})`);
  assert.ok(!hitMailbox(urls), 'an sms foreman must not be routed to the mailbox');
  // 'sms' is the default and by far the common path — it must not warn, or the
  // log fills with noise and the real warning below stops being findable.
  assert.deepEqual(warns, [], 'the default channel must not warn');
});

// ─── the unrecognized-channel fallback ─────────────────────────────────

/**
 * The column is NOT NULL DEFAULT 'sms', so this fires only when a SELECT
 * forgot the column or a caller passed the wrong object shape — the second of
 * which also loses foreman.phone and so sends nothing at all. Both are silent
 * at sites whose state write has already committed, which is what the warn is
 * there to surface.
 */
test('an unrecognized channel falls back to SMS and says so in the log', async (t) => {
  const urls = mockFetch(t);
  const warns = mockWarn(t);
  // No channel key at all: exactly what a SELECT that forgot the column yields.
  const db = fakeDb([{ phone: PHONE }, { changes: 1 }]);

  await sendToForeman(db, ENV, { to: PHONE, text: 'Ok 9-10 Arriba: R12' });

  assert.ok(hitTwilio(urls), 'the fallback still delivers — a warn, never a throw');
  assert.ok(!hitMailbox(urls));
  assert.equal(warns.length, 1, `expected exactly one warning, got ${JSON.stringify(warns)}`);
  assert.match(warns[0], /channel undefined unrecognized — falling back to SMS/);
  assert.match(warns[0], /\+15415550101/, 'the warning must name the phone it happened to');
});

// ─── the tick's nudge ──────────────────────────────────────────────────

/**
 * The nudge is the one call site where forgetting the query change fails
 * silently: the contacts lookup names its columns, so a missing `channel`
 * leaves f.channel undefined and a whatsapp foreman receives SMS forever
 * without anything erroring.
 */
test('the tick nudges a whatsapp foreman through the mailbox', async (t) => {
  const urls = mockFetch(t);
  const db = fakeDb([
    // (a) open rows today: one pending hour asked 67 minutes ago, past NUDGE_AFTER_MS.
    [{ id: 7, harvest_date: '2026-10-15', hour_start: '09:00', barn: 'upper',
       status: 'pending', asked_at: '2026-10-15 16:00:00', nudged_at: null, answered_at: null }],
    // the barn's contact
    { phone: PHONE, name: 'Test Arriba', active_since: '2026-10-15 13:00:00', channel: 'whatsapp' },
    { changes: 1 },                 // guarded UPDATE ... status = 'nudged'
    [],                             // (b)/(c) active roster: nobody, so the nudge is the only send
    { changes: 0 },                 // (d) releaseStrandedChat
    { n: 0, oldest: null },         // (d) staleness count
    { n: 0 },                       // (d) delivered-but-unanswered count
  ]);

  await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  // Pin which call site sent: run() defaults to changes: 1 when the canned
  // list runs out, so an off-by-one in the ordering above would not fail loudly.
  assert.ok(db.matching("SET status = 'nudged'")[0], 'the row was actually nudged');
  assert.match(db.matching('FROM harvest_foremen', 'ORDER BY active DESC')[0].sql, /channel/,
    'the contacts lookup must select channel');
  assert.ok(hitMailbox(urls), `the mailbox was not called (urls: ${urls.join(', ')})`);
  assert.ok(!hitTwilio(urls), 'a whatsapp foreman must never cost a Twilio message');
});
