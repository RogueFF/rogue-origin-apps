import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, sqliteOk } from './helpers/consign-sqlite.mjs';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

test('migrations create the nine cl_ tables', () => {
  const { sqlite } = freshConsignDb();
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cl_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, ['cl_dropoffs', 'cl_farm_access', 'cl_farms', 'cl_history', 'cl_lots', 'cl_payments', 'cl_price_points', 'cl_screen_runs', 'cl_sold']);
});

test('batch is all-or-nothing', async () => {
  const { DB, sqlite } = freshConsignDb();
  await assert.rejects(DB.batch([
    DB.prepare("INSERT INTO cl_farms (name) VALUES (?)").bind('Farm A'),
    DB.prepare("INSERT INTO cl_farms (name, default_term) VALUES (?, ?)").bind('Farm B', 'bogus'),
  ]));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_farms').get().n, 0);
});

test('cl_farm_access: token_hash is unique, failed_tries starts at 0', () => {
  const { sqlite } = freshConsignDb();
  sqlite.exec("INSERT INTO cl_farms (name) VALUES ('Farm A')");
  sqlite.exec("INSERT INTO cl_farm_access (farm_id, token_hash) VALUES (1, 'h1')");
  assert.equal(sqlite.prepare('SELECT failed_tries, pin_hash, revoked_at FROM cl_farm_access').get().failed_tries, 0);
  assert.throws(() => sqlite.exec("INSERT INTO cl_farm_access (farm_id, token_hash) VALUES (1, 'h1')"), /UNIQUE/);
});
