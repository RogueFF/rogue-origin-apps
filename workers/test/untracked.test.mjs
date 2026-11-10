// Trimming with no job on the screen (lib/untracked.js + the cron in lib/scale-watch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { riseG, notRecording, recording, RISE_G } from '../src/lib/untracked.js';
import { untrackedWatch, runUntrackedWatch, untrackedText } from '../src/lib/scale-watch.js';

// Monday 2026-11-09, PST: 10:00 am Pacific = 18:00 UTC.
const NOW = Date.parse('2026-11-09T18:00:00Z');
const ev = (min, g) => ({ ts: new Date(NOW - min * 60000).toISOString().replace('T', ' ').slice(0, 19), weight_kg: g / 1000 });
const trimming = [ev(5, 2), ev(4, 6), ev(3, 9.5), ev(1, 14)];   // +12 g in 5 min
const job = (o = {}) => ({ phase: 'running', updated_at: NOW - 20000, ...o });

test('rise = last settled net minus the lowest before it, inside the window; lifts never count', () => {
  assert.equal(riseG(trimming, NOW), 12);
  assert.equal(riseG([ev(4, 400), ev(3, -150), ev(2, 0.1)], NOW), 0, 'a pickup is a fall, not a rise');
  assert.equal(riseG([ev(9, 0), ev(1, 50)], NOW), 0, 'older than the window is ignored');
  assert.equal(riseG([ev(1, 50)], NOW), 0, 'one reading is no trend');
});

test('a running job on a reporting tablet is recording; idle, armed, no report or a silent tablet is not', () => {
  assert.equal(recording(job(), NOW), true);
  assert.equal(recording(job({ phase: 'finished' }), NOW), true);
  assert.equal(recording(job({ phase: 'idle' }), NOW), false);
  assert.equal(recording(job({ phase: 'armed' }), NOW), false);
  assert.equal(recording(job({ updated_at: NOW - 91000 }), NOW), false);
  assert.equal(recording(null, NOW), false);
});

test('not recording = live scale + a real rise + no recorded job, with why', () => {
  assert.deepEqual(notRecording({ scaleLive: true, events: trimming, job: null, now: NOW }), { riseG: 12, why: 'noScreen' });
  assert.deepEqual(notRecording({ scaleLive: true, events: trimming, job: job({ updated_at: NOW - 600000 }), now: NOW }), { riseG: 12, why: 'tabletOff' });
  assert.deepEqual(notRecording({ scaleLive: true, events: trimming, job: job({ phase: 'idle' }), now: NOW }), { riseG: 12, why: 'noJob' });
  assert.equal(notRecording({ scaleLive: true, events: trimming, job: job(), now: NOW }), null, 'recording');
  assert.equal(notRecording({ scaleLive: false, events: trimming, job: null, now: NOW }), null, 'scale off');
  assert.equal(notRecording({ scaleLive: true, events: [ev(3, 1), ev(1, 1 + RISE_G - 0.5)], job: null, now: NOW }), null, 'drift');
});

test('the cron decision: alert in shift, once; clear when it records again', () => {
  const r = (o = {}) => ({ stationId: 'table1', label: 'Cell 1', scaleLive: true, events: trimming, job: job({ phase: 'idle' }), untrackedSince: null, ...o });
  const now = new Date(NOW);
  const { alert } = untrackedWatch([r()], now);
  assert.equal(alert.length, 1);
  assert.equal(untrackedText(alert[0]), '⛔ *Cell 1* is trimming but nothing is being recorded: no job is started on the screen (cultivar, TARE, Start). The scale gained 12 g in the last few minutes.');
  assert.equal(untrackedWatch([r({ untrackedSince: '2026-11-09 17:50:00' })], now).alert.length, 0, 'already sent');
  assert.equal(untrackedWatch([r({ untrackedSince: '2026-11-09 17:50:00', job: job() })], now).clear.length, 1);
  assert.equal(untrackedWatch([r()], new Date('2026-11-09T13:00:00Z')).alert.length, 0, '5 am');
});

function env({ with0056 = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`CREATE TABLE cell_roster (station_id TEXT PRIMARY KEY, label TEXT, lane TEXT, sort INTEGER, active INTEGER DEFAULT 1);`);
  const ms = ['0049-cell-table-stations', '0053-scale-down-since', '0054-cell-screen-state', '0055-scale-node-battery',
    ...(with0056 ? ['0056-scale-untracked-since'] : [])];
  for (const m of ms) db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash, stale_after_s) VALUES ('table1', 'Cell 1', 'table', 'x', 45);`);
  db.exec(`INSERT INTO cell_roster (station_id, label, lane, sort) VALUES ('table1', 'Cell 1', 'wholesale', 1);`);
  db.exec(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.014, 'kg', '2026-11-09 17:59:50');`);
  for (const e of trimming) db.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`).run(e.ts, e.weight_kg);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CELL_ALERT_CHAT_ID: '-100123', DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}

test('the cron: no screen open while the scale gains = one Telegram, marked; a running job clears it', async () => {
  const { raw, env: e } = env();
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}'); };
  try {
    assert.deepEqual(await runUntrackedWatch(e, new Date(NOW)), { alert: ['table1'], clear: [] });
    assert.deepEqual(await runUntrackedWatch(e, new Date(NOW + 60000)), { alert: [], clear: [] }, 'not twice');
    raw.prepare(`INSERT INTO cell_screen_state (station_id, phase, updated_at) VALUES ('table1', 'running', ?)`).run(NOW + 100000);
    assert.deepEqual(await runUntrackedWatch(e, new Date(NOW + 120000)), { alert: [], clear: ['table1'] });
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /no cell screen is open/);
  } finally { globalThis.fetch = real; }
});

test('before 0056 is applied the cron does nothing and never throws', async () => {
  const { env: e } = env({ with0056: false });
  assert.deepEqual(await runUntrackedWatch(e, new Date(NOW)), { alert: [], clear: [] });
});
