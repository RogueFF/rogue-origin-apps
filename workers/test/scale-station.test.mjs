import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getScaleWeight, setScaleWeight } from '../src/handlers/production/scale.js';
import { stationSql, stationSqlFromHash } from '../scripts/scale-station-sql.mjs';

/**
 * A small in-memory D1 for the scale handlers. It routes on the SQL text, so it
 * pins what the handlers decide (token check, which columns are written, when a
 * settled weight is logged), not SQLite itself. `migrated: false` mimics prod
 * before 0049 is applied: no scale_stations / scale_events, no stable column.
 */
function fakeDb({ migrated = true, stations = [], readings = {}, battery = true } = {}) {
  const db = {
    stations: new Map(stations.map(s => [s.station_id, s])),
    readings: new Map(Object.entries(readings)),
    events: [],
    writes: [],
  };
  const noTable = name => { throw new Error(`D1_ERROR: no such table: ${name}: SQLITE_ERROR`); };
  db.prepare = sql => ({
    bind: (...p) => ({
      async first() {
        if (sql.includes('FROM scale_stations')) {
          if (!migrated) noTable('scale_stations');
          return db.stations.get(p[0]) || null;
        }
        if (sql.includes('FROM scale_readings')) return db.readings.get(p[0]) || null;
        if (sql.includes('FROM scale_events')) {
          const mine = db.events.filter(e => e.station_id === p[0]);
          return mine.length ? mine[mine.length - 1] : null;
        }
        if (sql.includes('FROM system_config')) return null;
        throw new Error(`unexpected first(): ${sql}`);
      },
      async run() {
        db.writes.push(sql.replace(/\s+/g, ' ').trim());
        if (sql.includes('INSERT INTO scale_readings')) {
          const withStable = sql.includes('stable');
          if (withStable && !migrated) throw new Error('D1_ERROR: table scale_readings has no column named stable');
          const [station_id, weight, unit, stable] = p;
          db.readings.set(station_id, {
            station_id, weight, unit, target_weight: 5.0,
            ...(withStable ? { stable } : {}),
            updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE scale_readings SET batt_mv')) {
          if (!battery) throw new Error('D1_ERROR: no such column: batt_mv: SQLITE_ERROR');
          Object.assign(db.readings.get(p[2]), {
            batt_mv: p[0], rssi: p[1], batt_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO scale_events')) {
          if (!migrated) noTable('scale_events');
          db.events.push({ station_id: p[0], weight_kg: p[1] });
          return { meta: { changes: 1 } };
        }
        throw new Error(`unexpected run(): ${sql}`);
      },
    }),
  });
  return db;
}

const TOKEN = 'cell-one-test-token-0123456789';
const hashOf = t => createHash('sha256').update(t, 'utf8').digest('hex');
const TABLE1 = { station_id: 'table1', kind: 'table', token_hash: hashOf(TOKEN), stale_after_s: 45, active: 1 };

const req = token => new Request('https://example.test/api/production?action=scaleWeight', {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const post = async (env, body, token) => {
  const r = await setScaleWeight(body, env, req(token));
  return { status: r.status, json: await r.json() };
};
const get = async (env, stationId) => {
  const r = await getScaleWeight({ stationId }, env);
  return { status: r.status, json: await r.json() };
};

test('before 0049 is applied, line1 posts and reads exactly as before (never a 500)', async () => {
  const DB = fakeDb({ migrated: false });
  const env = { DB };
  const w = await post(env, { stationId: 'line1', weight: 4.2, unit: 'kg' });
  assert.equal(w.status, 200);
  assert.deepEqual(w.json, { success: true });
  assert.ok(!DB.writes[0].includes('stable'), 'must not write a column that does not exist yet');

  const r = await get(env, 'line1');
  assert.equal(r.status, 200);
  assert.equal(r.json.weight, 4.2);
  assert.equal(r.json.staleAfterS, 3);
  assert.equal(r.json.stable, null);
});

test('after 0049, line1 still needs no token and logs no events', async () => {
  const DB = fakeDb();
  const w = await post({ DB }, { stationId: 'line1', weight: 1.5, unit: 'kg' });
  assert.equal(w.status, 200);
  assert.equal(DB.events.length, 0);
  const r = await get({ DB }, 'line1');
  assert.equal(r.json.staleAfterS, 3);
});

test('an unregistered id (cell1, the 10-27 bench id) keeps legacy behaviour and logs nothing, even when it claims stable', async () => {
  const DB = fakeDb();
  const w = await post({ DB }, { stationId: 'cell1', weight: 0.5, unit: 'kg', stable: true });
  assert.equal(w.status, 200);
  assert.equal(DB.events.length, 0);
});

test('a registered table with no token, or the wrong one, is refused and writes nothing', async () => {
  for (const token of [null, 'not-the-token-at-all-000000']) {
    const DB = fakeDb({ stations: [TABLE1] });
    const w = await post({ DB }, { stationId: 'table1', weight: 0.3, unit: 'kg', stable: true }, token);
    assert.equal(w.status, 401);
    assert.equal(w.json.code, 'UNAUTHORIZED');
    assert.equal(DB.writes.length, 0);
  }
});

test('a registered table with no token_hash set refuses every post', async () => {
  const DB = fakeDb({ stations: [{ ...TABLE1, token_hash: null }] });
  const w = await post({ DB }, { stationId: 'table1', weight: 0.3, unit: 'kg' }, TOKEN);
  assert.equal(w.status, 401);
});

test('an inactive table is refused even with the right token', async () => {
  const DB = fakeDb({ stations: [{ ...TABLE1, active: 0 }] });
  const w = await post({ DB }, { stationId: 'table1', weight: 0.3, unit: 'kg' }, TOKEN);
  assert.equal(w.status, 401);
});

test('the right token stores the reading with its stable flag', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  const moving = await post({ DB }, { stationId: 'table1', weight: 0.31234, unit: 'kg', stable: false }, TOKEN);
  assert.equal(moving.status, 200);
  assert.equal(DB.readings.get('table1').stable, 0);
  assert.equal(moving.json.logged, false, 'a moving reading is never logged');

  const settled = await post({ DB }, { stationId: 'table1', weight: 0.31234, unit: 'kg', stable: true }, TOKEN);
  assert.equal(DB.readings.get('table1').stable, 1);
  assert.equal(settled.json.logged, true);
});

test('settled weights are logged only when they moved 0.2 g or more, so heartbeats are skipped', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  const send = kg => post({ DB }, { stationId: 'table1', weight: kg, unit: 'kg', stable: true }, TOKEN);
  await send(0.10000);   // first settle: logged
  await send(0.10000);   // heartbeat, same value: skipped
  await send(0.10010);   // 0.1 g: skipped
  await send(0.10020);   // 0.2 g from the last logged: logged
  await send(0.10500);   // a nugget: logged
  assert.deepEqual(DB.events.map(e => e.weight_kg), [0.1, 0.1002, 0.105]);
});

test('weight is kg by convention: unit is only a tag, so it never rescales the log', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  await post({ DB }, { stationId: 'table1', weight: 0.25, unit: 'g', stable: true }, TOKEN);
  assert.equal(DB.events[0].weight_kg, 0.25);
});

test('line1 keeps its 10 kg cap with no unit, before and after the migration', async () => {
  for (const migrated of [false, true]) {
    const DB = fakeDb({ migrated });
    await post({ DB }, { stationId: 'line1', weight: 12 });
    assert.equal(DB.readings.get('line1').weight, 10);
  }
});

test('GET uses the station\'s own stale time and reports stable', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  await post({ DB }, { stationId: 'table1', weight: 0.2, unit: 'kg', stable: true }, TOKEN);
  const r = await get({ DB }, 'table1');
  assert.equal(r.json.staleAfterS, 45);
  assert.equal(r.json.stable, true);
  assert.equal(r.json.isStale, false);
});

test('reading a table needs no token (screens poll it)', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  const r = await get({ DB }, 'table1');
  assert.equal(r.status, 200);
  assert.equal(r.json.isStale, true);
});

test('the registration script stores the same hash the Worker checks, never the token', () => {
  const sql = stationSql('table1', "Cell 1 (Koa's)", TOKEN);
  assert.ok(sql.includes(hashOf(TOKEN)));
  assert.ok(!sql.includes(TOKEN));
  assert.ok(sql.includes("'Cell 1 (Koa''s)'"), 'quotes in the label are escaped');
  assert.throws(() => stationSql('table1; DROP', 'x', TOKEN));
  assert.throws(() => stationSql('table1', 'x', 'short'));
});

test('registering from a shared hash gives the same row as registering from the token', () => {
  assert.equal(stationSqlFromHash('table1', 'Cell 1', hashOf(TOKEN)), stationSql('table1', 'Cell 1', TOKEN));
  assert.throws(() => stationSqlFromHash('table1', 'x', 'not-a-hash'));
  assert.throws(() => stationSqlFromHash('table1', 'x', hashOf(TOKEN).toUpperCase()));
});

test('a tared table scale may post a negative weight (basket lifted); it is stored and logged', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  const w = await post({ DB }, { stationId: 'table1', weight: -0.0525, unit: 'kg', stable: true }, TOKEN);
  assert.equal(w.status, 200);
  assert.equal(DB.readings.get('table1').weight, -0.0525);
  assert.deepEqual(DB.events.map(e => e.weight_kg), [-0.0525]);
  const r = await get({ DB }, 'table1');
  assert.equal(r.json.percentComplete, 0, 'never a negative percent');
});

test('negative weights stay refused for line1, unregistered ids, and below -10 kg', async () => {
  for (const [stationId, weight, token] of [['line1', -0.1, null], ['cell1', -0.1, null], ['table1', -10.5, TOKEN]]) {
    const DB = fakeDb({ stations: [TABLE1] });
    const w = await post({ DB }, { stationId, weight, unit: 'kg', stable: true }, token);
    assert.equal(w.status, 400, `${stationId} ${weight}`);
    assert.equal(DB.writes.length, 0);
  }
});

test('a negative weight from a table without its token is a 401, never written', async () => {
  const DB = fakeDb({ stations: [TABLE1] });
  const w = await post({ DB }, { stationId: 'table1', weight: -0.05, unit: 'kg', stable: true }, null);
  assert.equal(w.status, 401);
  assert.equal(DB.writes.length, 0);
});

test('a table node\'s battery and Wi-Fi ride along: stored, and read back as a percent', async () => {
  const env = { DB: fakeDb({ stations: [TABLE1] }) };
  const r = await post(env, { stationId: 'table1', weight: 0.0123, unit: 'kg', stable: true, battMv: 3870, rssi: -61 }, TOKEN);
  assert.equal(r.status, 200);
  const g = await get(env, 'table1');
  assert.equal(g.json.battery.mv, 3870);
  assert.equal(g.json.battery.rssi, -61);
  assert.equal(g.json.battery.pct, 64);
});

test('no battery fields, nonsense values, or a database before 0055: posts exactly as before', async () => {
  const env = { DB: fakeDb({ stations: [TABLE1] }) };
  await post(env, { stationId: 'table1', weight: 0.01, unit: 'kg', stable: true }, TOKEN);
  assert.equal((await get(env, 'table1')).json.battery, null);
  await post(env, { stationId: 'table1', weight: 0.01, unit: 'kg', stable: true, battMv: 99999, rssi: 5 }, TOKEN);
  assert.equal((await get(env, 'table1')).json.battery, null, 'out of range is ignored');
  assert.ok(!env.DB.writes.some(w => w.includes('batt_mv')));
  const old = { DB: fakeDb({ stations: [TABLE1], battery: false }) };
  const r = await post(old, { stationId: 'table1', weight: 0.01, unit: 'kg', stable: true, battMv: 3900 }, TOKEN);
  assert.equal(r.status, 200, 'before 0055 the battery is dropped, the weight still lands');
  assert.equal(old.DB.readings.get('table1').weight, 0.01);
});

test('line1 and unregistered ids never write battery fields', async () => {
  const env = { DB: fakeDb({ stations: [TABLE1] }) };
  await post(env, { stationId: 'line1', weight: 1, battMv: 3900 });
  await post(env, { stationId: 'cell1', weight: 1, battMv: 3900 });
  assert.ok(!env.DB.writes.some(w => w.includes('batt_mv')));
});
