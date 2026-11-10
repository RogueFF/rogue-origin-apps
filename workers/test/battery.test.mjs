// Scale node battery (lib/battery.js + the low-battery Telegram in lib/scale-watch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { battPct, parseNodeHealth, batteryOf, LOW_PCT, BATT_FRESH_MS } from '../src/lib/battery.js';
import { batteryWatch, runBatteryWatch, lowText } from '../src/lib/scale-watch.js';

// Monday 2026-11-09, PST: 10:00 am Pacific = 18:00 UTC.
const AT = s => new Date(`2026-11-09T${s}Z`);

test('percent follows the LiPo curve, clamped 0-100', () => {
  assert.equal(battPct(4200), 100);
  assert.equal(battPct(4180), 100);
  assert.equal(battPct(3700), 35);
  assert.equal(battPct(3600), 15);
  assert.equal(battPct(3300), 0);
  assert.equal(battPct(3000), 0);
  assert.equal(battPct(3850), 62);   // between 3800 (55) and 3900 (68)
  assert.equal(battPct(null), null);
  assert.equal(battPct('x'), null);
});

test('node fields are checked: millivolts 2500-5000, RSSI -120..0, else null', () => {
  assert.deepEqual(parseNodeHealth({ battMv: '3912.4', rssi: -58 }), { battMv: 3912, rssi: -58 });
  assert.deepEqual(parseNodeHealth({}), { battMv: null, rssi: null });
  assert.deepEqual(parseNodeHealth({ battMv: 120, rssi: 12 }), { battMv: null, rssi: null });
});

test('a stale or missing battery reading shows nothing', () => {
  const now = AT('18:00:00').getTime();
  assert.equal(batteryOf(null, now), null);
  assert.equal(batteryOf({ batt_mv: null }, now), null);
  assert.deepEqual(batteryOf({ batt_mv: 3700, rssi: -60, batt_at: '2026-11-09 17:58:00' }, now),
    { pct: 35, mv: 3700, rssi: -60, at: Date.parse('2026-11-09T17:58:00Z') });
  assert.equal(batteryOf({ batt_mv: 3700, batt_at: '2026-11-09 17:49:00' }, now), null, 'older than 10 min');
  assert.equal(BATT_FRESH_MS, 600000);
});

const row = (o = {}) => ({ stationId: 'table1', label: 'Cell 1', battMv: 3580, battAt: '2026-11-09 17:59:00', battLowAt: null, ...o });

test('low in shift = one alert; out of shift, stale, or already sent = none', () => {
  const { low } = batteryWatch([row()], AT('18:00:00'));
  assert.equal(low.length, 1);
  assert.ok(low[0].pct < LOW_PCT);
  assert.equal(lowText(low[0]), '🔋 *Cell 1* scale node battery 14% (3.58 V). Charge it at the end of the shift.');
  assert.equal(batteryWatch([row()], new Date('2026-11-09T13:00:00Z')).low.length, 0, '5 am');
  assert.equal(batteryWatch([row({ battAt: '2026-11-09 17:30:00' })], AT('18:00:00')).low.length, 0, 'stale');
  assert.equal(batteryWatch([row({ battLowAt: '2026-11-09 17:00:00' })], AT('18:00:00')).low.length, 0, 'already sent');
  assert.equal(batteryWatch([row({ battMv: 3700 })], AT('18:00:00')).low.length, 0, '35%');
});

test('the alert re-arms once the node reads charged again', () => {
  assert.equal(batteryWatch([row({ battMv: 4150, battLowAt: '2026-11-09 17:00:00' })], AT('18:00:00')).rearm.length, 1);
  assert.equal(batteryWatch([row({ battMv: 3650, battLowAt: '2026-11-09 17:00:00' })], AT('18:00:00')).rearm.length, 0);
});

function env({ with0055 = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  const ms = ['0049-cell-table-stations', '0050-cell-hourly', '0053-scale-down-since', ...(with0055 ? ['0055-scale-node-battery'] : [])];
  for (const m of ms) db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CELL_ALERT_CHAT_ID: '-100123', DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}

test('the cron sends one low-battery Telegram, marks it, and re-arms after a charge', async () => {
  const { raw, env: e } = env();
  raw.exec(`INSERT INTO scale_readings (station_id, weight, unit, updated_at, batt_mv, rssi, batt_at) VALUES ('table1', 0.01, 'kg', '2026-11-09 17:59:00', 3580, -60, '2026-11-09 17:59:00');`);
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}'); };
  try {
    assert.deepEqual(await runBatteryWatch(e, AT('18:00:00')), { low: ['table1'], rearm: [] });
    assert.deepEqual(await runBatteryWatch(e, AT('18:05:00')), { low: [], rearm: [] }, 'not twice');
    raw.exec(`UPDATE scale_readings SET batt_mv = 4170, batt_at = '2026-11-09 18:09:00'`);
    assert.deepEqual(await runBatteryWatch(e, AT('18:10:00')), { low: [], rearm: ['table1'] });
    assert.equal(raw.prepare(`SELECT batt_low_at FROM scale_stations`).get().batt_low_at, null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Cell 1\* scale node battery 14%/);
  } finally { globalThis.fetch = real; }
});

test('before 0055 is applied the battery watch does nothing and never throws', async () => {
  const { env: e } = env({ with0055: false });
  assert.deepEqual(await runBatteryWatch(e, AT('18:00:00')), { low: [], rearm: [] });
});
