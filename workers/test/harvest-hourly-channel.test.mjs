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
 *
 * For a test whose subject is call ORDER, use `routedDb` below instead —
 * positional canning cannot prove position. Its companion set of canned tail
 * responses is `TICK_ROUTES`; this one's is `WATCHDOG`. Mixing the two gives a
 * confusing failure rather than a clear one.
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

// ─── the tick drains the WhatsApp mailbox ──────────────────────────────

const MAILBOX_POLL = 'https://mailbox.example/poll';
const hitPoll = (urls) => urls.some(u => u.startsWith(MAILBOX_POLL));

/**
 * A fetch mock for the drain, kept separate from mockFetch above rather than
 * folded into it: the tick test Task 3 wrote runs against that harness
 * unchanged, which is how "the drain costs a quiet mailbox nothing" stays an
 * observed fact rather than an assumption.
 *
 * Three URL shapes in one run. <mailbox>/poll is read with res.json() and must
 * carry { messages }; <mailbox>/send and Twilio are read with res.ok alone.
 * Two failure modes, deliberately distinct because the drain logs them
 * differently: 'fail' answers 500, which pollWhatsappMailbox throws on before
 * the mailbox has marked anything (nothing lost); 'garbage' answers 200 with a
 * body res.json() cannot parse, which throws AFTER the mailbox marked the whole
 * batch processed (that batch is gone).
 */
function mockMailboxFetch(t, poll = []) {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.startsWith(MAILBOX_POLL)) {
      if (poll === 'fail') return new Response('mailbox down', { status: 500 });
      if (poll === 'garbage') return new Response('<html>502 Bad Gateway</html>', { status: 200 });
      return new Response(JSON.stringify({ messages: poll }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return urls;
}

/** Replace console.error and record the lines it is handed. */
function mockError(t) {
  const lines = [];
  t.mock.method(console, 'error', (...args) => { lines.push(args.join(' ')); });
  return lines;
}

/** One inbound row in the mailbox's own shape. */
const waRow = (id, text) => ({ wa_message_id: id, from_number: '15415550101', text_body: text });

/** The three canned responses the watchdog costs at the end of every tick — `fakeDb` only. */
const WATCHDOG = [{ changes: 0 }, { n: 0, oldest: null }, { n: 0 }];

/** Index of the first recorded call whose SQL contains `needle`. */
const idxOf = (db, needle) => db.calls.findIndex(c => c.sql.includes(needle));

/**
 * fakeDb's sibling for the two ordering tests: answers by SQL rather than by
 * call order, recording calls identically.
 *
 * fakeDb's canned sequence is positional, which is exactly wrong for a test
 * whose subject is position. Moving the drain to the end of the tick hands the
 * open-row query the gate's canned row, `query()` returns a bare object, and
 * the tick dies on "open is not iterable" before a single ordering assertion
 * runs — a RED that proves nothing. Routed by SQL, no response ever shifts, so
 * the recorded call ORDER is the only thing that can differ and the ordering
 * assertion is what fails. (Measured: with fakeDb the mutation failed on that
 * TypeError; with this it fails on `activated < roster`.)
 *
 * `routes` is [needle, response] pairs, first match wins; its companion set of
 * tail responses is `TICK_ROUTES` (`fakeDb`'s is `WATCHDOG`). A response may
 * be a function of the calls recorded so far, which is how a test can make a
 * query answer differently before and after a write the drain performs. An
 * unrouted statement answers [] / null / changes 1 — the same permissive
 * fallbacks fakeDb has, which is why the assertions below name their call
 * sites, and why "no prompt was sent" is asserted as the absence of the
 * statement rather than as its result.
 */
function routedDb(routes) {
  const calls = [];
  const answer = (sql) => (routes.find(([needle]) => sql.includes(needle)) || [])[1];
  return {
    calls,
    matching(...needles) {
      return calls.filter(c => needles.every(n => c.sql.includes(n)));
    },
    prepare(sql) {
      const clean = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          calls.push({ sql: clean, params });
          const route = answer(clean);
          // Resolved once, here, so all three accessors agree — and resolved
          // at bind time, so a route can see every call made before this one.
          const r = typeof route === 'function' ? route(calls) : route;
          return {
            all: async () => ({ results: Array.isArray(r) ? r : [] }),
            first: async () => r ?? null,
            run: async () => ({ meta: { changes: r?.changes ?? 1, last_row_id: 1 } }),
          };
        },
      };
    },
  };
}

/** The tick's own statements, answered so the drain's ordering is the variable — `routedDb` only. */
const TICK_ROUTES = [
  ["status IN ('pending', 'nudged') ORDER BY barn", []],        // (a) no open rows
  ['SELECT id FROM harvest_hourly', null],                      // (b) no row for the just-ended hour
  ["status IN ('complete', 'missing')", []],                    // (c) nothing finalized yet
  // (d) releaseStrandedChat. Routed explicitly to 0 rather than left to the
  // `changes ?? 1` fallback: unrouted it reports one row released, which the
  // watchdog adds to the tick's `acted` and which then shows up as a phantom
  // count in any test that asserts on it.
  ["SET processed = 0 WHERE kind = 'chat'", { changes: 0 }],
  ['MIN(i.received_at)', { n: 0, oldest: null }],               // (d) watchdog staleness
  ['i.delivered_at IS NOT NULL', { n: 0 }],                     // (d) watchdog unanswered
];

test('the drain feeds a whatsapp foreman EMPEZAR through processInbound', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-1', 'EMPEZAR')]);
  const db = fakeDb([
    { phone: PHONE },                                     // drain's foreman gate
    { changes: 1 },                                       // inbox INSERT OR IGNORE, claimed
    { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 0, channel: 'whatsapp' },
    { changes: 1 },                                       // UPDATE active = 1
    { changes: 1 },                                       // UPDATE active = 0, the barn's others
    { changes: 1 },                                       // markInbox
    [],                                                   // (a) no open rows today
    [],                                                   // (b) nobody on the active roster
    ...WATCHDOG,
  ]);

  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  // The drain's own contribution to the tick's count: one answered command.
  // Nothing else in this tick acts, so this pins the arithmetic — a drain that
  // counted rows polled rather than rows answered would read 1 here too only
  // by coincidence, and the unregistered-phone test below pins the other side.
  assert.equal(r.acted, 1);
  assert.ok(hitPoll(urls), `the mailbox was never polled (urls: ${urls.join(', ')})`);
  // The gate is the tick's very first query: the drain runs before anything else.
  assert.match(db.calls[0].sql, /SELECT phone FROM harvest_foremen WHERE phone = \? AND channel = 'whatsapp'/);
  assert.deepEqual(db.calls[0].params, [PHONE], "the mailbox's digits are read back as E.164");

  const insert = db.matching('INSERT OR IGNORE INTO harvest_sms_inbox')[0];
  assert.ok(insert, 'the row is written before it is classified');
  // Positional: the bound params are [sid, from, text, channel], and a channel
  // in the wrong placeholder would still "include" the string.
  assert.deepEqual(insert.params, ['WA-1', PHONE, 'EMPEZAR', 'whatsapp']);

  assert.ok(db.matching('SET active = 1')[0], 'EMPEZAR started the day');
  assert.ok(hitMailbox(urls), `the reply did not go through the mailbox (urls: ${urls.join(', ')})`);
  assert.ok(!hitTwilio(urls), 'a whatsapp foreman must never cost a Twilio message');
});

test('the drain leaves a row from an unregistered phone alone', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-nobody', 'hola')]);
  const db = fakeDb([
    null,                 // drain's foreman gate: nobody
    [],                   // (a)
    [],                   // (b)
    ...WATCHDOG,
  ]);

  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  // Every assertion below is a negative, so pin the positive first: without
  // this the whole test passes on a tick that never polled at all.
  assert.ok(hitPoll(urls), 'the mailbox was polled');
  assert.equal(r.acted, 0, 'a row that is not ours is not something this tick acted on');
  // Not merely "nothing threw": this mailbox also carries Riego's traffic, and
  // a row claimed into Capataz's inbox would sit there unanswerable forever.
  assert.equal(db.matching('INSERT OR IGNORE INTO harvest_sms_inbox').length, 0,
    'no inbox row may be written for a sender that is not ours');
  assert.ok(db.calls.every(c => !c.params.includes('WA-nobody')),
    `the message id must not appear in any statement: ${JSON.stringify(db.calls.map(c => c.params))}`);
  assert.ok(!hitMailbox(urls), 'nothing was sent back');
  assert.ok(!hitTwilio(urls));
});

test('the drain leaves a row from an sms-channel foreman alone', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-smsguy', 'EMPEZAR')]);
  const db = fakeDb([
    null,                 // the gate finds nothing: the SQL filters on channel
    [],                   // (a)
    [],                   // (b)
    ...WATCHDOG,
  ]);

  await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  // The fake cannot enforce a WHERE clause, so what is pinned here is the
  // clause itself plus the skip it produces. A WhatsApp message from an
  // SMS-channel foreman's number should not exist; the gate is defensive.
  assert.match(db.calls[0].sql, /AND channel = 'whatsapp'/,
    'the gate must filter on the channel, not just on the phone');
  assert.equal(db.matching('INSERT OR IGNORE INTO harvest_sms_inbox').length, 0);
  assert.ok(db.calls.every(c => !c.params.includes('WA-smsguy')));
  assert.ok(!hitMailbox(urls));
  assert.ok(!hitTwilio(urls));
});

test('a poll failure costs the tick nothing else', async (t) => {
  const urls = mockMailboxFetch(t, 'fail');
  const errs = mockError(t);
  const db = fakeDb([
    // (a) one pending hour asked 67 minutes ago, past NUDGE_AFTER_MS.
    [{ id: 7, harvest_date: '2026-10-15', hour_start: '09:00', barn: 'upper',
       status: 'pending', asked_at: '2026-10-15 16:00:00', nudged_at: null, answered_at: null }],
    { phone: PHONE, name: 'Test Arriba', active_since: '2026-10-15 13:00:00', channel: 'whatsapp' },
    { changes: 1 },       // guarded UPDATE ... status = 'nudged'
    [],                   // (b)
    ...WATCHDOG,
  ]);

  // Same shape as the capatazWatchdog wrapper: the mailbox is another machine,
  // and its being down must not cost the barn its prompts and nudges.
  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  assert.ok(hitPoll(urls), 'the poll was attempted');
  assert.equal(db.calls.filter(c => c.sql.includes("AND channel = 'whatsapp'")).length, 0,
    'a failed poll hands back no rows, so nothing is gated');
  assert.ok(db.matching("SET status = 'nudged'")[0], 'the open-row loop still ran');
  assert.ok(hitMailbox(urls), `the reminder was not sent (urls: ${urls.join(', ')})`);
  assert.equal(r.acted, 1);
  // A refusal is the harmless half: the mailbox threw before marking anything,
  // so the same rows come back next tick. The log has to say so, or an operator
  // cannot tell this apart from the data-losing case below.
  assert.equal(errs.length, 1, `expected one error line, got ${JSON.stringify(errs)}`);
  assert.match(errs[0], /poll refused, nothing dequeued/);
});

/**
 * The other half of the same catch, and the one that actually loses data: a 200
 * whose body will not parse (a truncated response, a mailbox deploy mid-flight)
 * throws only after the mailbox has marked the whole batch processed on its
 * side. Those messages are gone — there is no redelivery — and the log is the
 * only place that will ever say so.
 */
test('a poll whose body will not parse says the batch was lost', async (t) => {
  const urls = mockMailboxFetch(t, 'garbage');
  const errs = mockError(t);
  const db = fakeDb([[], [], ...WATCHDOG]);

  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  assert.ok(hitPoll(urls), 'the poll was attempted');
  assert.equal(errs.length, 1, `expected one error line, got ${JSON.stringify(errs)}`);
  assert.match(errs[0], /lost AFTER the mailbox marked the batch/);
  assert.doesNotMatch(errs[0], /nothing dequeued/, 'this case did lose rows — it must not claim otherwise');
  assert.equal(r.acted, 0);
  assert.equal(db.matching('INSERT OR IGNORE INTO harvest_sms_inbox').length, 0);
});

test('a chat text over whatsapp is queued for the relay, not answered here', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-chat', '4 2 3 8 1 12 sin novedad')]);
  const db = fakeDb([
    { phone: PHONE },                                     // gate
    { changes: 1 },                                       // inbox INSERT, claimed processed = 1
    { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, channel: 'whatsapp' },
    { changes: 1 },                                       // release: kind = 'chat', processed = 0
    [],                                                   // (a)
    [],                                                   // (b)
    ...WATCHDOG,
  ]);

  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  // The `|| r.queued` half of the drain's count: a text the worker does not
  // answer is still something this tick acted on.
  assert.equal(r.acted, 1);
  const insert = db.matching('INSERT OR IGNORE INTO harvest_sms_inbox')[0];
  assert.deepEqual(insert.params, ['WA-chat', PHONE, '4 2 3 8 1 12 sin novedad', 'whatsapp']);
  const release = db.matching("SET kind = 'chat', processed = 0")[0];
  assert.ok(release, 'the row was released to the relay, exactly like a Twilio chat text');
  assert.deepEqual(release.params, ['WA-chat']);
  // The worker answers commands and nothing else — sms_poll hands this one to
  // the relay, which is what replies.
  assert.ok(!hitMailbox(urls), 'the worker must not answer a chat text itself');
  assert.ok(!hitTwilio(urls));
});

/**
 * riego-whatsapp-mailbox stores an audio message with text_body NULL — only
 * media_id and media_mime — and /poll hands the row over like any other. Left
 * to fall through, '' classifies as 'answer', the row is released
 * kind = 'chat', processed = 0, and that is exactly the population
 * capatazWatchdog counts as "the relay is not draining": the sender IS a
 * registered foreman, so the watchdog's join passes and Koa is paged every 30
 * minutes about an outage that is not happening. A Spanish-speaking barn crew
 * sending voice notes is a certainty, not an edge case.
 */
test('a voice note from a whatsapp foreman is skipped, not queued as an empty chat', async (t) => {
  const urls = mockMailboxFetch(t, [
    { wa_message_id: 'WA-voice', from_number: '15415550101', text_body: null, msg_type: 'audio',
      media_id: 'MEDIA-1', media_mime: 'audio/ogg' },
  ]);
  // routedDb, not fakeDb: removing the guard adds three statements between the
  // gate and the open-row query, and with positional canning the tick then dies
  // on a shifted response instead of on the assertion below — red, but red for
  // the wrong reason and therefore no evidence that the guard is what is
  // holding. Routed, the guard's removal fails exactly the "no inbox row" line.
  const db = routedDb([
    // The gate finds him: he IS one of ours, which is what makes this dangerous.
    ["AND channel = 'whatsapp'", { phone: PHONE }],
    // Only ever reached with the guard removed.
    ['SELECT * FROM harvest_foremen WHERE phone = ?',
      { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, channel: 'whatsapp' }],
    ...TICK_ROUTES,
  ]);

  const r = await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  assert.ok(hitPoll(urls), 'the mailbox was polled');
  assert.equal(db.matching('INSERT OR IGNORE INTO harvest_sms_inbox').length, 0,
    'no inbox row — an empty one would read as a chat text nobody can answer');
  assert.equal(db.matching("SET kind = 'chat', processed = 0").length, 0,
    'nothing may be released into the relay queue, which is the watchdog population');
  assert.ok(db.calls.every(c => !c.params.includes('WA-voice')));
  assert.equal(r.acted, 0);
  assert.ok(!hitMailbox(urls), 'the worker does not answer a voice note');
  assert.ok(!hitTwilio(urls));
});

/**
 * ORDERING — the single most fragile thing in the feature. The drain is the
 * tick's first step, so a command received over WhatsApp takes effect before
 * the same tick's open-row and ask/auto-stop decisions, matching how the
 * Twilio webhook already reacts instantly relative to the tick.
 *
 * Asserted as call-sequence indices rather than as fake state: fakeDb hands
 * back canned rows and cannot re-read what an UPDATE wrote, so "the roster read
 * saw active = 1" is only provable as "the write happened before the read".
 */
test('an EMPEZAR drained this tick lands before the ask/auto-stop roster read', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-order', 'EMPEZAR')]);
  const ACTIVE_SINCE = '2026-10-15 17:07:00';   // what the EMPEZAR itself stamps
  const db = routedDb([
    ["AND channel = 'whatsapp'", { phone: PHONE }],                     // the drain's gate
    ['SELECT * FROM harvest_foremen WHERE phone = ?', { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 0, channel: 'whatsapp' }],
    // The roster as it stands once the drain's write has landed.
    ['SELECT * FROM harvest_foremen WHERE active = 1',
      [{ phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, active_since: ACTIVE_SINCE, channel: 'whatsapp' }]],
    ...TICK_ROUTES,
  ]);

  await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  const activated = idxOf(db, 'SET active = 1');
  const openRows = idxOf(db, "status IN ('pending', 'nudged') ORDER BY barn");
  const roster = idxOf(db, 'SELECT * FROM harvest_foremen WHERE active = 1');
  assert.ok(activated >= 0, 'the EMPEZAR was processed at all');
  assert.ok(openRows >= 0 && roster >= 0, 'the rest of the tick ran');
  assert.ok(activated < openRows,
    `EMPEZAR must land before the open-row loop (activated ${activated}, open rows ${openRows})`);
  assert.ok(activated < roster,
    `EMPEZAR must land before the ask/auto-stop roster read (activated ${activated}, roster ${roster})`);
  // Deliberately NOT asserted here: that `SELECT id FROM harvest_hourly` comes
  // after the roster read. It is issued inside the loop over that query's own
  // results, so it cannot possibly come first for any drain placement — a
  // tautology dressed as an ordering check. The two comparisons above are the
  // whole proof.
});

/**
 * The behavioural companion to the ordering test above, and the case where the
 * ordering has a consequence a foreman would actually notice: with the drain
 * last, the roster is read while he is still active and this tick prompts a man
 * who has already gone home. The roster route below answers from the calls
 * recorded so far rather than from a fixed [], so the no-prompt assertion is
 * earned by the ordering instead of granted by the canned data.
 */
test('a PARAR drained this tick deactivates before the ask loop reads the roster', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-stop', 'PARAR')]);
  const db = routedDb([
    ["AND channel = 'whatsapp'", { phone: PHONE }],                     // the drain's gate
    ['SELECT * FROM harvest_foremen WHERE phone = ?', { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, channel: 'whatsapp' }],
    ['SELECT racks FROM harvest_hourly', [{ racks: 12 }]],              // today's racks for the goodbye
    // The roster answered the way the real table would: empty once the PARAR's
    // deactivation has landed, still carrying him if it has not. Canning []
    // unconditionally would make the no-prompt assertion below true by
    // construction; this way it is true only because the drain ran first.
    // active_since is 06:00 Pacific, so tickDecision would genuinely ask.
    ['SELECT * FROM harvest_foremen WHERE active = 1', (calls) =>
      calls.some(c => c.sql.includes('SET active = 0 WHERE phone = ?'))
        ? []
        : [{ phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, active_since: '2026-10-15 13:00:00', channel: 'whatsapp' }]],
    ...TICK_ROUTES,
  ]);

  await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  const stopped = idxOf(db, 'SET active = 0 WHERE phone = ?');
  const roster = idxOf(db, 'SELECT * FROM harvest_foremen WHERE active = 1');
  assert.ok(stopped >= 0 && roster >= 0);
  assert.ok(stopped < roster,
    `PARAR must land before the roster read (stopped ${stopped}, roster ${roster})`);
  assert.equal(db.matching('INSERT OR IGNORE INTO harvest_hourly').length, 0,
    'nobody is prompted for an hour after saying PARAR in the same tick');
  assert.ok(hitMailbox(urls), 'the goodbye went out over WhatsApp');
  assert.ok(!hitTwilio(urls));
});

/**
 * Two texts from one foreman arrive together here, where on the Twilio path
 * they would be two separate webhook POSTs. processInbound's
 * claim-then-release protocol was written for one row per HTTP request, so what
 * has to hold is that each loop iteration completes before the next begins —
 * asserted as the interleaving, not as "both rows appear". Under a Promise.all
 * the two INSERTs would both precede the first release and this would fail.
 */
test('two rows from one foreman in one batch are processed one after the other', async (t) => {
  const urls = mockMailboxFetch(t, [waRow('WA-a', '4 2 3'), waRow('WA-b', '8 1 12')]);
  const foreman = { phone: PHONE, name: 'Test Arriba', barn: 'upper', active: 1, channel: 'whatsapp' };
  const db = fakeDb([
    { phone: PHONE }, { changes: 1 }, foreman, { changes: 1 },   // row 1: gate, insert, foreman, release
    { phone: PHONE }, { changes: 1 }, foreman, { changes: 1 },   // row 2: the same four
    [],                   // (a)
    [],                   // (b)
    ...WATCHDOG,
  ]);

  await runHarvestHourlyTick({ ...ENV, DB: db }, NOW);

  const at = (needle, sid) => db.calls.findIndex(c => c.sql.includes(needle) && c.params.includes(sid));
  const insA = at('INSERT OR IGNORE INTO harvest_sms_inbox', 'WA-a');
  const relA = at("SET kind = 'chat', processed = 0", 'WA-a');
  const insB = at('INSERT OR IGNORE INTO harvest_sms_inbox', 'WA-b');
  const relB = at("SET kind = 'chat', processed = 0", 'WA-b');
  assert.ok([insA, relA, insB, relB].every(i => i >= 0),
    `both rows must be claimed and released: ${JSON.stringify({ insA, relA, insB, relB })}`);
  assert.ok(insA < relA, "row 1's claim precedes its own release");
  assert.ok(relA < insB,
    `row 1 must be finished before row 2 is claimed (relA ${relA}, insB ${insB})`);
  assert.ok(insB < relB, "row 2's claim precedes its own release");

  // Provenance on both, in order.
  assert.deepEqual(db.matching('INSERT OR IGNORE INTO harvest_sms_inbox').map(c => c.params),
    [['WA-a', PHONE, '4 2 3', 'whatsapp'], ['WA-b', PHONE, '8 1 12', 'whatsapp']]);
  assert.ok(!hitTwilio(urls));
});
