/**
 * Tags by bay (Koa, 2026-10-12): GET ?action=bay_tags is one screen with every
 * bay as a drawer and a PRINT per cultivar hanging in it, so switching
 * cultivar in a 17-cultivar retail bay is one tap, not a round trip through
 * the picker. This suite covers the server render only.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshDb, seedLot, seedLoad, sqliteAvailable } from './helpers/harvest-bay-seed.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleHarvestD1 } = await import(mod('workers/src/handlers/harvest-d1.js'));

const API = 'https://x/api/harvest';
const post = (env, ctx, action, body) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
const postForm = (env, ctx, action, fields) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString() }), env, ctx);
const page = async (env, ctx, lang = 'en') =>
  handleHarvestD1(new Request(`${API}?action=bay_tags&lang=${lang}`), env, ctx);
const drawerBays = (html) => [...html.matchAll(/<details class="baydrawer[^"]*" data-bay="(\d+)"/g)].map(m => m[1]);

test('bay_tags renders one drawer per bay with a PRINT button per cultivar', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const b = seedLot(sqlite, { zone: 'Z8', cultivar: 'Rainbow Cake' });
  const c = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  seedLoad(sqlite, b, 3, { minutesAgo: 8 * 1440, bins: 240 });
  seedLoad(sqlite, c, 4, { minutesAgo: 6 * 1440, bins: 480 });
  const res = await page(env, ctx);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.deepEqual(drawerBays(html), ['3', '4']);
  assert.ok(html.indexOf('PRINT · Rainbow Cake') > -1, 'a PRINT per cultivar');
  assert.ok(html.indexOf('PRINT · Rainbow Cake') < html.indexOf('PRINT · Puff Pastries'), 'rows by bins');
  assert.ok(html.includes('PRINT · Sour Lifter'));
  assert.match(html, new RegExp(`data-session="${b}" data-cultivar="Rainbow Cake" data-cut="1" data-bay="3"`));
  assert.equal((html.match(/class="btn alt addcv"/g) || []).length, 2);
  assert.equal((html.match(/name="all" value="1"/g) || []).length, 2);
  assert.match(html, /"Critical Berries"/, 'McLoughlin list rides the page for the add sheet');
  assert.match(html, /"Angel Cake":\["MZ1","MZ2"\]/);
  // Per-cultivar Finished form carries what bay_finish needs.
  assert.match(html, /name="fill_start" value="\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
});

test('bay_tags: a hand-added lot shows "no loads scanned"; a finished bay sorts last with Reopen', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB')`);
  const added = await post(env, ctx, 'lot_add', { bay: 1, cultivar: 'Critical Berries' });
  assert.equal(added.status, 200);
  const fin = await postForm(env, ctx, 'bay_finish', { bay: '3', all: '1' });
  assert.equal(fin.status, 200);
  const html = await (await page(env, ctx)).text();
  assert.deepEqual(drawerBays(html), ['1', '3'], 'active bay 1 before finished bay 3');
  assert.match(html, /no loads scanned/);
  assert.match(html, /name="reopen" value="1"/);
  // A finished bay offers no PRINT.
  const bay3 = html.slice(html.indexOf('<details class="baydrawer finished" data-bay="3"'));
  const end = bay3.indexOf('<dialog');
  const drawer = bay3.slice(0, end > -1 ? end : undefined);
  assert.match(drawer, /class="bigbtn printbtn" type="button" disabled/);
  assert.doesNotMatch(drawer, /name="all" value="1"/, 'no Whole bay down on a finished bay');
});

test('bay_tags shows the Spanish strings with lang=es', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { env, ctx } = freshDb();
  const res = await page(env, ctx, 'es');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Etiquetas por bahía/);
});
