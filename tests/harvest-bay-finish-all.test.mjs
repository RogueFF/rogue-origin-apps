/**
 * "Whole bay down" (Koa, 2026-10-12): a retail bay can hold 17 cultivars, so
 * POST ?action=bay_finish with all=1 and just the bay finishes every active
 * cultivar card in that bay's current fill in one tap.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshDb, seedLot, seedLoad, sqliteAvailable } from './helpers/harvest-bay-seed.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const { handleHarvestD1 } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

// bay_finish is an HTML form action: it renders the picker (or an error page)
// itself and never throws to index.js, so no catch is needed here.
const post = (env, ctx, fields) => handleHarvestD1(
  new Request('https://x/api/harvest?action=bay_finish&lang=en', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));

test('bay_finish all=1 finishes every cultivar card in the bay fill', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const b = seedLot(sqlite, { zone: 'R1', cultivar: 'Sauciere' });
  seedLoad(sqlite, a, 3, { minutesAgo: 5 * 1440, bins: 24 });
  seedLoad(sqlite, b, 3, { minutesAgo: 5 * 1440, bins: 24 });
  const res = await post(env, ctx, { bay: '3', all: '1' });
  assert.equal(res.status, 200);
  assert.match(res.html, /Bay 3 down — 2 cultivars finished/);
  const done = sqlite.prepare(`SELECT cultivar FROM harvest_bay_done WHERE bay = 3 ORDER BY cultivar`).all().map(r => r.cultivar);
  assert.deepEqual(done, ['Puff Pastries', 'Sauciere']);
  // Both lots were only in bay 3, so both close.
  const lots = sqlite.prepare(`SELECT takedown_done_at FROM harvest_scan_log WHERE id IN (?, ?)`).all(a, b);
  assert.equal(lots.length, 2);
  assert.ok(lots.every(l => l.takedown_done_at));
});

test('bay_finish all=1 leaves other bays and already-finished cards alone', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const c = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 3, { minutesAgo: 5 * 1440, bins: 24 });
  seedLoad(sqlite, c, 4, { minutesAgo: 5 * 1440, bins: 48 });
  await post(env, ctx, { bay: '3', all: '1' });
  const again = await post(env, ctx, { bay: '3', all: '1' });   // second press is a no-op, not an error
  assert.equal(again.status, 200);
  assert.match(again.html, /Bay 3 down — 0 cultivars finished/);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM harvest_bay_done`).get().n, 1);
  assert.equal(sqlite.prepare(`SELECT takedown_done_at FROM harvest_scan_log WHERE id = ?`).get(c).takedown_done_at, null);
});

test('bay_finish all=1 without a bay is a validation error', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const res = await post(env, ctx, { all: '1' });
  assert.equal(res.status, 400);
  assert.match(res.html, /Pick which lot is coming down/);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM harvest_bay_done`).get().n, 0);
});
