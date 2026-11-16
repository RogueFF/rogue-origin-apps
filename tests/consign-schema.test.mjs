import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, sqliteOk } from './helpers/consign-sqlite.mjs';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

test('migration creates the eight cl_ tables', () => {
  const { sqlite } = freshConsignDb();
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cl_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, ['cl_dropoffs', 'cl_farms', 'cl_history', 'cl_lots', 'cl_payments', 'cl_price_points', 'cl_screen_runs', 'cl_sold']);
});

test('batch is all-or-nothing', async () => {
  const { DB, sqlite } = freshConsignDb();
  await assert.rejects(DB.batch([
    DB.prepare("INSERT INTO cl_farms (name) VALUES (?)").bind('Farm A'),
    DB.prepare("INSERT INTO cl_farms (name, default_term) VALUES (?, ?)").bind('Farm B', 'bogus'),
  ]));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_farms').get().n, 0);
});
