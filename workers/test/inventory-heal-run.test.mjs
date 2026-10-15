// runInventoryHeal end to end: real SQL (node:sqlite behind a D1-shaped
// adapter), a fake Pool Inventory script, and the 2026-10-07 situation —
// 30 tags owed, 18 of them in fact landed, Shopify 12 short.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runInventoryHeal } from '../src/handlers/harvest-d1.js';
import { resetVariantCache } from '../src/lib/supersack-inventory.js';
import { inFlight, DEBT_SQL } from '../src/lib/inventory-debt.js';
import { HEAL_QUIET_MS } from '../src/lib/inventory-heal.js';

function d1(sqlite) {
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a.map(v => (v === undefined ? null : v)); return stmt; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes }, changes: r.changes }; },
      };
      return stmt;
    },
  };
}

const VARIANT = { id: 'gid://shopify/ProductVariant/1', title: '2026 - Sour Lifter / Sungrown / 1st Cut',
  inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1' };

let sqlite, env, shopify, calls, realFetch;

beforeEach(() => {
  resetVariantCache();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE harvest_sacks (sack_id TEXT PRIMARY KEY, season INT, cultivar TEXT, zone TEXT, cut_number INT,
      is_test INT DEFAULT 0, opened_at TEXT, voided_at TEXT, shopify_variant_id TEXT,
      shopify_added_at TEXT, shopify_add_error TEXT, shopify_synced_at TEXT, shopify_sync_error TEXT);
    CREATE TABLE harvest_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT);
    CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE cultivar_aliases (cultivar_id INT, alias TEXT);
  `);
  const ins = sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, cultivar, zone, cut_number,
    shopify_added_at, shopify_add_error) VALUES (?, 2026, 'Sour Lifter', 'Z2', 1, ?, ?)`);
  const old = new Date(Date.now() - 6 * 3600e3).toISOString();
  const marker = `in flight since ${old} (add)`;
  for (let i = 1; i <= 418; i++) ins.run(`26-SLIFT-${i}`, old, null);       // counted
  for (let i = 419; i <= 448; i++) ins.run(`26-SLIFT-${i}`, null, marker);  // 30 owed
  shopify = 436;                                                           // 18 of the 30 landed
  calls = [];
  env = { DB: d1(sqlite), POOL_INVENTORY_API_URL: 'https://pool.test', POOL_INVENTORY_API_KEY: 'k' };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.action === 'get_supersack_variants') {
      return new Response(JSON.stringify({ variants: [{ ...VARIANT, quantity: shopify }] }));
    }
    if (body.action === 'update_supersack_inventory') {
      shopify += body.operation === 'add' ? body.amount : -body.amount;
      return new Response(JSON.stringify({ success: true, newValue: shopify }));
    }
    throw new Error(`unexpected ${body.action}`);
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

const owed = () => sqlite.prepare(`SELECT COUNT(*) n FROM harvest_sacks WHERE ${DEBT_SQL}`).get().n;
const writes = () => calls.filter(c => c.action === 'update_supersack_inventory');

test('sends the 12 Shopify is short, then settles all 30 once it sees 448', async () => {
  const t0 = Date.now();
  const first = await runInventoryHeal(env, { now: t0 });
  assert.equal(first.results[0].action, 'send');
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].amount, 12);
  assert.equal(writes()[0].operation, 'add');
  assert.equal(shopify, 448);
  assert.equal(owed(), 30, 'a send settles nothing — the next quiet tick has to see it');

  const tooSoon = await runInventoryHeal(env, { now: t0 + 5 * 60e3 });
  assert.equal(tooSoon.skipped, 'not quiet', 'the heal itself is a call the quiet window waits out');

  const later = await runInventoryHeal(env, { now: t0 + HEAL_QUIET_MS + 60e3 });
  assert.equal(later.results[0].action, 'settle');
  assert.equal(later.results[0].settled, 30);
  assert.equal(owed(), 0);
  assert.equal(writes().length, 1, 'settling never writes to Shopify');

  const after = await runInventoryHeal(env, { now: t0 + 2 * HEAL_QUIET_MS });
  assert.equal(after.skipped, 'nothing owed');
});

test('a fresh in-flight marker holds the heal off, whatever the stamp says', async () => {
  sqlite.prepare(`UPDATE harvest_sacks SET shopify_add_error = ? WHERE sack_id = '26-SLIFT-448'`).run(inFlight('add'));
  const r = await runInventoryHeal(env, { now: Date.now() });
  assert.equal(r.skipped, 'not quiet');
  assert.equal(calls.length, 0, 'not even a read of Shopify');
});

test('drift the debts cannot explain is reported, never written', async () => {
  shopify = 400; // 48 short, only 30 owed
  const r = await runInventoryHeal(env, { now: Date.now() });
  assert.equal(r.results[0].action, 'report');
  assert.equal(writes().length, 0);
  assert.equal(owed(), 30);
});

test('nothing owed: no call to Google at all', async () => {
  sqlite.exec(`UPDATE harvest_sacks SET shopify_added_at = 'x', shopify_add_error = NULL`);
  const r = await runInventoryHeal(env, { now: Date.now() });
  assert.equal(r.skipped, 'nothing owed');
  assert.equal(calls.length, 0);
});

test('a preview build never heals the shared database', async () => {
  const r = await runInventoryHeal({ ...env, HARVEST_FORCE_TEST: 'true' }, { now: Date.now() });
  assert.equal(r.skipped, 'preview build');
});
