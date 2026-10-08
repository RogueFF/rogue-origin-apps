/**
 * Un-voiding a tag.
 *
 * Koa, 2026-10-07: "Can we unvoid bag #156, and add a button to unvoid next to
 * each tag." 26-SLIFT-156 was voided by mistake — the tag was on a real sack —
 * and the only way back was raw SQL plus a hand-made +1 in Shopify.
 *
 * The void took the tag's +1 back off Shopify only if that rollback LANDED
 * (shopify_added_at cleared). So un-voiding has to read the row the same way:
 *
 *   marker clear   — Shopify holds 0 for this tag → send +1 back, on the
 *                     variant the tag was counted on
 *   marker set     — the rollback failed or never ran, Shopify still holds the
 *                     +1 → send nothing, just clear the stale error
 *   in flight      — a call is still out → refuse, try again in a minute
 *
 * Run with `node --test`.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb as baseDb, quiet, modUrl, sqliteAvailable, SEASON } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1 } = await import(modUrl('workers/src/handlers/harvest-d1.js'));
const { resetVariantCache } = await import(modUrl('workers/src/lib/supersack-inventory.js'));

before((t) => { if (!sqliteAvailable) t.skip('node:sqlite unavailable (Node < 22.5)'); });
beforeEach(() => resetVariantCache());

const VARIANT = 'gid://shopify/ProductVariant/48893863002304';
const ID = '26-SLIFT-156';

/** Live mode, with the background work captured so it can be awaited. */
function freshDb() {
  const { sqlite, env } = baseDb();
  const pending = [];
  return {
    sqlite,
    env: { ...env, HARVEST_TEST_MODE: 'false', POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k' },
    ctx: { waitUntil(p) { pending.push(p); } },
    settle: async () => { while (pending.length) await pending.shift(); },
  };
}

function poolStub(mode = 'ok') {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.action === 'get_supersack_variants') {
      return Response.json({ variants: [{ id: VARIANT, title: `${SEASON} - Sour Lifter / Sungrown / 1st Cut`,
        inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1' }] });
    }
    if (mode === 'refuse') return Response.json({ error: 'Inventory is locked for stocktake' });
    return Response.json({ ok: true });
  };
  return calls;
}

/** A voided tag. `added` = shopify_added_at still set (the void's rollback did not land). */
function seedVoided(sqlite, { added = null, error = null } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (id, event_type, zone, cultivar, season, cut_number, is_test)
    VALUES (162, 'enter', 'Z2', 'Sour Lifter', ?, 1, 0)
  `).run(SEASON);
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, bay,
      is_test, printed_at, voided_at, shopify_added_at, shopify_add_error, shopify_variant_id)
    VALUES (?, ?, 156, 'Z2', 'Sour Lifter', 1, 162, 9, 0, datetime('now','-1 day'), datetime('now','-1 day'), ?, ?, ?)
  `).run(ID, SEASON, added, error, VARIANT);
}

const row = (sqlite) => sqlite.prepare('SELECT * FROM harvest_sacks WHERE sack_id = ?').get(ID);

// JSON actions throw; the router outside turns the error into { success: false }.
const unvoid = (env, ctx, sackId = ID) => quiet(() => handleHarvestD1(new Request(
  'https://x/api/harvest?action=sack_unvoid',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sack_id: sackId }) },
), env, ctx)).then(r => r.json()).catch(e => ({ success: false, error: e.message }));

test('a tag whose void landed comes back live and puts its +1 back on the same variant', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedVoided(sqlite);
  const calls = poolStub();

  const r = await unvoid(env, ctx);
  await settle();

  assert.equal(r.success, true);
  assert.equal(r.unvoided, ID);
  const s = row(sqlite);
  assert.equal(s.voided_at, null, 'the tag is live again');
  assert.ok(s.shopify_added_at, 'and counted');
  assert.equal(s.shopify_add_error, null);
  const moves = calls.filter(c => c.action === 'update_supersack_inventory');
  assert.deepEqual(moves.map(m => [m.variantId, m.operation, m.amount]), [[VARIANT, 'add', 1]]);
  assert.ok(r.tags.find(t => t.id === ID && !t.voided), 'the tag list comes back with it live');
});

test('a tag whose void rollback never landed sends nothing — Shopify still holds its +1', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedVoided(sqlite, { added: '2026-10-06T17:21:30.000Z', error: 'void rollback failed: Pool API returned non-JSON' });
  const calls = poolStub();

  const r = await unvoid(env, ctx);
  await settle();

  assert.equal(r.success, true);
  const s = row(sqlite);
  assert.equal(s.voided_at, null);
  assert.equal(s.shopify_added_at, '2026-10-06T17:21:30.000Z', 'still counted, as it always was');
  assert.equal(s.shopify_add_error, null, 'the stale rollback error is gone');
  assert.equal(calls.filter(c => c.action === 'update_supersack_inventory').length, 0, 'a second +1 would count it twice');
});

test('a +1 that is refused is recorded, so the tag shows as owed rather than counted', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedVoided(sqlite);
  poolStub('refuse');

  await unvoid(env, ctx);
  await settle();

  const s = row(sqlite);
  assert.equal(s.voided_at, null);
  assert.equal(s.shopify_added_at, null);
  assert.match(s.shopify_add_error, /^unvoid add failed: Inventory is locked/);
});

test('a tag still settling with Shopify is refused, and nothing changes', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedVoided(sqlite, { error: `in flight since ${new Date().toISOString()} (void rollback)` });
  const calls = poolStub();

  const r = await unvoid(env, ctx);

  assert.equal(r.success, false);
  assert.match(r.error, /settling with Shopify/);
  assert.ok(row(sqlite).voided_at, 'still voided');
  assert.equal(calls.length, 0);
});

test('a tag that is not voided is refused', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedVoided(sqlite);
  sqlite.prepare('UPDATE harvest_sacks SET voided_at = NULL').run();
  poolStub();

  const r = await unvoid(env, ctx);

  assert.equal(r.success, false);
  assert.match(r.error, /is not voided/);
});

test('an unknown tag is refused', async () => {
  const { env, ctx } = freshDb();
  poolStub();

  const r = await unvoid(env, ctx, '26-SLIFT-99999');

  assert.equal(r.success, false);
});
