import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { scaleWatch, runScaleWatch, inShift, downText, backText } from '../src/lib/scale-watch.js';

// Monday 2026-11-09, PST (UTC-8): 10:00 am Pacific = 18:00 UTC.
const AT = s => new Date(`2026-11-09T${s}Z`);
const row = (o = {}) => ({ stationId: 'table1', label: 'Cell 1', updatedAt: '2026-11-09 17:55:00', weightKg: 0.0124, downSince: null, ...o });

test('working hours are Mon-Sat 6:00 to 4:20 pm Pacific', () => {
  assert.equal(inShift(AT('18:00:00')), true);            // Mon 10:00
  assert.equal(inShift(AT('13:59:00')), false);           // Mon 5:59
  assert.equal(inShift(new Date('2026-11-10T00:19:00Z')), true); // Mon 4:19 pm
  assert.equal(inShift(new Date('2026-11-10T00:21:00Z')), false); // Mon 4:21 pm
  assert.equal(inShift(new Date('2026-11-08T18:00:00Z')), false); // Sunday
});

test('silent 3 minutes or more mid-shift = down; less = fine', () => {
  assert.equal(scaleWatch([row()], AT('17:57:59')).down.length, 0, '2m59s');
  const { down } = scaleWatch([row()], AT('17:58:00'));
  assert.equal(down.length, 1);
  assert.equal(down[0].silentMin, 3);
  assert.match(downText(down[0]), /Cell 1\* scale disconnected: no reading since 9:55 am \(3 min\)\. Last weight 12\.40 g\./);
});

test('never reported: a scale not used today, a post from before the shift, or after hours', () => {
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-08 23:00:00' })], AT('18:00:00')).down.length, 0, 'last post yesterday');
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-09 13:30:00' })], AT('18:00:00')).down.length, 0, 'last post 5:30 am');
  assert.equal(scaleWatch([row({ updatedAt: null })], AT('18:00:00')).down.length, 0, 'never posted');
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-10 00:10:00' })], new Date('2026-11-10T00:40:00Z')).down.length, 0, '4:40 pm');
});

test('once reported it is not reported again; a newer post is "back" with the minutes down', () => {
  const reported = row({ downSince: '2026-11-09 17:55:00' });
  assert.deepEqual(scaleWatch([reported], AT('18:20:00')), { down: [], back: [] });
  const { back } = scaleWatch([{ ...reported, updatedAt: '2026-11-09 18:02:10' }], AT('18:05:00'));
  assert.equal(back.length, 1);
  assert.equal(back[0].downMin, 7);
  assert.equal(backText(back[0]), '✅ *Cell 1* scale back after 7 min.');
});

// The real tables (0049 + 0050 + 0053) in SQLite, Telegram faked.
function env({ chat = '-100123' } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0053-scale-down-since']) {
    db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  }
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x'), ('table2', 'Cell 2', 'table', 'y');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CELL_ALERT_CHAT_ID: chat, DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
function fakeTelegram(ok = true) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(ok ? '{"ok":true}' : 'nope', { status: ok ? 200 : 500 }); };
  return { sent, restore: () => { globalThis.fetch = real; } };
}

test('the cron sends one alert, then one "back", and marks the station between', async () => {
  const { raw, env: e } = env();
  raw.exec(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.0124, 'kg', '2026-11-09 17:55:00');`);
  const tg = fakeTelegram();
  try {
    assert.deepEqual(await runScaleWatch(e, AT('18:00:00')), { down: ['table1'], back: [] });
    assert.deepEqual(await runScaleWatch(e, AT('18:05:00')), { down: [], back: [] }, 'not twice');
    raw.exec(`UPDATE scale_readings SET updated_at = '2026-11-09 18:06:00' WHERE station_id = 'table1'`);
    assert.deepEqual(await runScaleWatch(e, AT('18:10:00')), { down: [], back: ['table1'] });
    assert.equal(raw.prepare(`SELECT down_since FROM scale_stations WHERE station_id = 'table1'`).get().down_since, null);
    assert.equal(tg.sent.length, 2);
    assert.equal(tg.sent[0].chat_id, '-100123');
    assert.match(tg.sent[0].text, /Cell 1/);
    assert.match(tg.sent[1].text, /back after 11 min/);
  } finally { tg.restore(); }
});

test('no chat set, or Telegram refuses: nothing is marked, so it tries again next run', async () => {
  for (const [opts, ok] of [[{ chat: '' }, true], [{}, false]]) {
    const { raw, env: e } = env(opts);
    raw.exec(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.01, 'kg', '2026-11-09 17:50:00');`);
    const tg = fakeTelegram(ok);
    try {
      assert.deepEqual((await runScaleWatch(e, AT('18:00:00'))).down, []);
      assert.equal(raw.prepare(`SELECT down_since FROM scale_stations WHERE station_id = 'table1'`).get().down_since, null);
    } finally { tg.restore(); }
  }
});

test('breaks (9:00-9:10, 12:00-12:30, 2:30-2:40): a scale switched off for one is not reported until 3 min after it ends', () => {
  const lunch = row({ updatedAt: '2026-11-09 20:01:00' });                              // last post 12:01 pm
  assert.equal(scaleWatch([lunch], AT('20:20:00')).down.length, 0, '12:20, at lunch');
  assert.equal(scaleWatch([lunch], AT('20:32:00')).down.length, 0, '12:32, 2 min after');
  assert.equal(scaleWatch([lunch], AT('20:33:00')).down.length, 1, '12:33, still off: reported');
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-09 17:01:00' })], AT('17:08:00')).down.length, 0, '9:08, morning break');
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-09 22:31:00' })], AT('22:38:00')).down.length, 0, '2:38, afternoon break');
  assert.equal(scaleWatch([row({ updatedAt: '2026-11-09 18:40:00' })], AT('18:45:00')).down.length, 1, '10:45, no break: reported');
  const back = scaleWatch([row({ updatedAt: '2026-11-09 20:10:00', downSince: '2026-11-09 19:50:00' })], AT('20:15:00'));
  assert.equal(back.back.length, 1, 'a scale already reported down still reports back during a break');
});
