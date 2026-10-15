/**
 * How many times a tag talks to the Pool Inventory Apps Script, and what is
 * kept when the script fails.
 *
 * 2026-10-06, first full Sour Lifter takedown: 11 of 100 tag calls never
 * answered inside the ~30 s a Worker's waitUntil gets after the response
 * ("in flight"), and 7 came back as Google's HTML error page. Every tag made TWO
 * script calls — the whole variant list, then the +1 — so the list call alone
 * spent a third of the budget on every tag. Print-to-count latency ran median
 * ~7 s, p90 up to 30 s.
 *
 * The list is the same 114 variants all morning, so it is kept for a few
 * minutes and a tag makes one call. A miss in the kept list is never trusted:
 * it is fetched fresh once before a tag is refused, so a variant Nathan creates
 * mid-takedown is found on the next tag rather than five minutes later.
 *
 * And the failure text: the stored error was the first 160 characters of the
 * page — `<!doctype html><script nonce=…>window['ppConfig']…` — so the actual
 * Apps Script exception was thrown away every time. It is now read out of the
 * page.
 *
 * Run with `node --test`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const { adjustSupersackCount, checkSupersackVariant, resetVariantCache } =
  await import(mod('workers/src/lib/supersack-inventory.js'));

const SL1 = 'gid://shopify/ProductVariant/48893863002304';
const RC1 = 'gid://shopify/ProductVariant/50000000000001';
const v = (id, title) => ({ id, title, inventoryItemId: `i-${id}`, locationId: 'l1' });

const env = () => ({ POOL_INVENTORY_API_URL: 'https://pool.test', POOL_INVENTORY_API_KEY: 'k' });
const db = { prepare() { return { bind() { return { all: async () => ({ results: [] }) }; } }; } };

/** A fake pool. `variants` may be swapped between calls; `updateReply` overrides the +1's answer. */
function pool({ variants, updateReply = null }) {
  const calls = [];
  const state = { variants };
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.action);
    if (body.action === 'get_supersack_variants') {
      return new Response(JSON.stringify({ variants: state.variants }), { status: 200 });
    }
    if (updateReply) return updateReply();
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { calls, state, restore: () => { globalThis.fetch = real; } };
}

const add = (cultivar) => adjustSupersackCount(env(), {
  season: 2026, cultivar, zone: 'Z4', cut: 1, delta: 1, note: 'n', db,
});

beforeEach(() => resetVariantCache());

test('a run of tags makes one script call each, not two', async () => {
  const p = pool({ variants: [v(SL1, '2026 - Sour Lifter / Sungrown / 1st Cut')] });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await add('Sour Lifter')).ok, true);
  } finally { p.restore(); }

  assert.deepEqual(p.calls.filter(c => c === 'get_supersack_variants').length, 1,
    'the variant list is fetched once and kept');
  assert.equal(p.calls.filter(c => c === 'update_supersack_inventory').length, 5);
});

test('the Start-takedown check warms the list, so the first tag is one call too', async () => {
  const p = pool({ variants: [v(SL1, '2026 - Sour Lifter / Sungrown / 1st Cut')] });
  try {
    assert.equal((await checkSupersackVariant(env(), db, { season: 2026, cultivar: 'Sour Lifter', zone: 'Z4', cut: 1 })).ok, true);
    assert.equal((await add('Sour Lifter')).ok, true);
  } finally { p.restore(); }

  assert.deepEqual(p.calls, ['get_supersack_variants', 'update_supersack_inventory']);
});

test('a variant created after the list was kept is found on the next tag, not refused', async () => {
  const p = pool({ variants: [v(SL1, '2026 - Sour Lifter / Sungrown / 1st Cut')] });
  try {
    await add('Sour Lifter');                                   // keeps a list without Rainbow Cake
    p.state.variants = [...p.state.variants, v(RC1, '2026 - Rainbow Cake / Sungrown / 1st Cut')];
    const r = await add('Rainbow Cake');
    assert.equal(r.ok, true, 'a miss in the kept list is checked against a fresh one');
    assert.equal(r.variantId, RC1);
  } finally { p.restore(); }
});

test('a cultivar with no variant at all is still refused, after one fresh look', async () => {
  const p = pool({ variants: [v(SL1, '2026 - Sour Lifter / Sungrown / 1st Cut')] });
  try {
    await add('Sour Lifter');
    const r = await add('Nonesuch');
    assert.equal(r.ok, false);
    assert.match(r.error, /No Super Sack Inventory variant titled/);
  } finally { p.restore(); }
  assert.equal(p.calls.filter(c => c === 'update_supersack_inventory').length, 1, 'nothing moved for the miss');
});

test("Google's error page is reduced to the exception it reports, not the page's first bytes", async () => {
  const page = `<!doctype html><html><head><script nonce="x">window['ppConfig'] = {productName: '26981ed', deleteIsEnforced: false};</script>
    <style>body{margin:0}</style><title>Error</title></head><body>
    <div style="margin:20px">Exception: Service invoked too many times for one day: urlfetch. (line 212, file "Code")</div></body></html>`;
  const p = pool({
    variants: [v(SL1, '2026 - Sour Lifter / Sungrown / 1st Cut')],
    updateReply: () => new Response(page, { status: 200 }),
  });
  let r;
  try { r = await add('Sour Lifter'); } finally { p.restore(); }

  assert.equal(r.ok, false);
  assert.match(r.error, /^Pool API returned non-JSON/, 'still recognisable as a pool failure');
  assert.match(r.error, /Exception: Service invoked too many times for one day: urlfetch\. \(line 212, file "Code"\)/);
  assert.doesNotMatch(r.error, /ppConfig|nonce/, 'the script and style noise is gone');
});
