import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHourlyReport } from '../src/handlers/harvest-hourly-d1.js';

/**
 * A fake D1 that hands back canned results in call order and records the SQL
 * and bound params it was given. The point is not to emulate SQLite — it is to
 * pin the decisions applyHourlyReport makes: which row it targets, what it
 * stamps, and which guard clauses it refuses to write without.
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

const ENV = { HARVEST_TEST_MODE: 'true' };
// 17:07Z on 2026-10-15 is 10:07 Pacific (PDT), so the hour that just ended is 09:00.
const NOW = new Date('2026-10-15T17:07:00Z');
const FOREMAN = { phone: '+15415550101', name: 'Test Arriba', barn: 'upper', active: 1, active_since: '2026-10-15 13:00:00' };

const SIX = {
  cutters: 4, cutter_water_spiders: 2, drivers: 3,
  hangers: 8, hanging_water_spiders: 1, racks: 12,
};
const rowAt = (hour_start, status, extra = {}) => ({
  id: 7, harvest_date: '2026-10-15', hour_start, barn: 'upper', status,
  cutters: null, cutter_water_spiders: null, drivers: null, hangers: null,
  hanging_water_spiders: null, racks: null, notes: null, ...extra,
});

test('a named hour that has not ended is refused before a single query runs', async () => {
  const db = fakeDb([]);
  // 17:00 at 10:07 Pacific: the hour has not happened. Creating the row would
  // give the day a future hour that swallows every later un-prefixed answer.
  const r = await applyHourlyReport(db, ENV, {
    foreman: FOREMAN, hour: '17:00', values: SIX, notes: null, now: NOW,
  });
  assert.equal(r.refused, 'future_hour');
  assert.equal(r.reply, 'Esa hora todavia no termina.');
  assert.equal(r.row, null);
  assert.equal(db.calls.length, 0, 'a refused hour must not touch the database');
});

test('a backfill for a past hour is created with asked_at NULL', async () => {
  const db = fakeDb([
    null,                                   // getOrCreateRow: no existing row
    { changes: 1 },                         // INSERT
    rowAt('08:00', 'pending'),              // re-find
    { changes: 1 },                         // UPDATE counts
    // The fake does not execute SQL, so the re-read is canned as what the
    // merge above would have produced.
    rowAt('08:00', 'pending', { ...SIX, notes: 'se rompio un rack' }),
    { changes: 1 },                         // UPDATE status
  ]);
  const r = await applyHourlyReport(db, ENV, {
    foreman: FOREMAN, hour: '08:00', values: SIX, notes: 'se rompio un rack', now: NOW,
  });

  const insert = db.matching('INSERT OR IGNORE INTO harvest_hourly')[0];
  assert.ok(insert, 'the missing row is created');
  // The bot never asked for this hour — the foreman volunteered it — so there
  // is no prompt clock to stamp. tickDecision falls back to answered_at.
  assert.equal(insert.params[4], null, 'asked_at must be null on a backfill');
  assert.deepEqual(insert.params.slice(1, 4), ['2026-10-15', '08:00', 'upper']);
  assert.equal(r.refused, null);
  assert.deepEqual(r.missing, []);
  assert.equal(r.reply, 'Ok 8-9 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack');
});

test('with no hour named, the newest open row is targeted and bounded by the ended hour', async () => {
  const db = fakeDb([
    rowAt('09:00', 'pending'),              // openRow
    { changes: 1 },                         // UPDATE counts
    rowAt('09:00', 'pending', SIX),         // re-read
    { changes: 1 },                         // UPDATE status
  ]);
  await applyHourlyReport(db, ENV, { foreman: FOREMAN, values: SIX, notes: null, now: NOW });

  const open = db.matching('status IN', 'hour_start <=')[0];
  assert.ok(open, 'the open row is found with a hour_start bound');
  // The bound is the last hour that actually ended: a stray future row would
  // otherwise sort first and swallow every un-prefixed answer after it.
  assert.equal(open.params[3], '09:00');
});

test('a partial answer on a missing row goes back to nudged and restamps nudged_at', async () => {
  const db = fakeDb([
    rowAt('09:00', 'missing', { cutters: 4 }),                 // openRow
    { changes: 1 },                                            // UPDATE counts
    rowAt('09:00', 'missing', { cutters: 4, drivers: 3 }),     // re-read
    { changes: 1 },                                            // UPDATE status
  ]);
  const r = await applyHourlyReport(db, ENV, {
    foreman: FOREMAN, values: { drivers: 3 }, notes: null, now: NOW,
  });

  const status = db.matching('SET status = ?')[0];
  assert.equal(status.params[0], 'nudged');
  // A stale nudged_at would make the very next tick flip the row straight back
  // to missing and alert Telegram a second time.
  assert.equal(status.params[1], '2026-10-15 17:07:00', 'nudged_at is restamped');
  assert.equal(r.row.status, 'nudged');
  assert.equal(r.reply, 'Falta: waterspiders campo, colgadores, waterspiders granero, racks. Cuantos de 9 a 10?');
});

test('a completed row is never demoted — the status write carries its own guard', async () => {
  // The re-read says nudged, but a reply racing this one completed the hour, so
  // the guarded UPDATE matches nothing. The row must come back complete, not
  // nudged, or the relay chases numbers that are already in.
  const db = fakeDb([
    rowAt('09:00', 'pending'),                         // openRow
    { changes: 1 },                                    // UPDATE counts
    rowAt('09:00', 'pending', { cutters: 4 }),         // re-read: still partial
    { changes: 0 },                                    // UPDATE status: guard blocked it
    rowAt('09:00', 'complete', SIX),                   // second re-read
  ]);
  const r = await applyHourlyReport(db, ENV, {
    foreman: FOREMAN, values: { cutters: 4 }, notes: null, now: NOW,
  });

  const status = db.matching('SET status = ?')[0];
  assert.match(status.sql, /status <> 'complete'/, 'a row must never go backwards');
  assert.equal(r.row.status, 'complete', 'the row is re-read when the guard blocks the write');
});

test('an out-of-range count keeps the old value and says so ahead of the confirmation', async () => {
  const db = fakeDb([
    rowAt('09:00', 'pending', SIX),          // openRow: already complete-ish
    { changes: 1 },                          // UPDATE counts
    rowAt('09:00', 'pending', SIX),          // re-read: the old cutters survived
    { changes: 1 },                          // UPDATE status
  ]);
  const r = await applyHourlyReport(db, ENV, {
    foreman: FOREMAN, values: { ...SIX, cutters: 99 }, notes: null, now: NOW,
  });

  const update = db.matching('cutters = COALESCE(?, cutters)')[0];
  // Null, not 99: COALESCE then keeps whatever the column already held.
  assert.equal(update.params[0], null, 'an out-of-range count is never written');
  assert.deepEqual(r.invalid, ['cutters']);
  assert.equal(r.reply,
    'Numero fuera de rango: cortadores. Se mantiene el valor anterior. Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12');
});

test('raw_reply is merged, never erased, and reported_by is the foreman phone', async () => {
  const db = fakeDb([
    rowAt('09:00', 'pending'),
    { changes: 1 },
    rowAt('09:00', 'pending', SIX),
    { changes: 1 },
  ]);
  await applyHourlyReport(db, ENV, { foreman: FOREMAN, values: SIX, notes: null, now: NOW });

  const update = db.matching('raw_reply')[0];
  // raw_text is optional on hourly_set, so a call without it must leave the
  // foreman's earlier words alone rather than blanking the column.
  assert.match(update.sql, /raw_reply = COALESCE\(\?, raw_reply\)/);
  assert.equal(update.params[9], null);
  assert.equal(update.params[10], '+15415550101');
});
