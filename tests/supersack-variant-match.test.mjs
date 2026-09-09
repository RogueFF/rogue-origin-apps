/**
 * Matching a sack to its Shopify Super Sack variant.
 *
 * The website does not always carry the farm's name for a cultivar. "Rainbow
 * GMO Quik" is listed as "Rainbow GMO" (Koa, 2026-09-09), so the title built
 * from the cultivar name misses a variant that genuinely is the right one — and
 * the miss is quiet: the tag prints, the sack row saves, and the Super Sack
 * count simply never moves.
 *
 * THE FIX IS A RECORDED MAPPING, NEVER A PARSED ONE. The tempting shortcut is
 * to drop trailing words until something matches. The 2026 field rules it out
 * by itself: **Platinum is a strict prefix of Platinum M A4, and both grow in
 * Z8** — one of the three trial blocks that exist to tell cultivars apart. A
 * loosening rule would post Platinum M A4's bags onto Platinum's count,
 * silently, in the one place it matters most. That case is pinned below.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const { adjustSupersackCount, variantTitle, harvestTypeForZone, findVariant } =
  await import(mod('workers/src/lib/supersack-inventory.js'));
const { ZONE_CULTIVARS } = await import(mod('workers/src/lib/zone-cultivars.js'));

/** The real 2026 Super Sack variants, as the pool API returns them. */
const VARIANTS = [
  { id: 'v1', title: '2026 - Rainbow GMO / Sungrown', inventoryItemId: 'i1', locationId: 'l1' },
  { id: 'v2', title: '2026 - Sour Lifter / Sungrown', inventoryItemId: 'i2', locationId: 'l1' },
  { id: 'v3', title: '2025 - Rainbow GMO / Sungrown', inventoryItemId: 'i3', locationId: 'l1' },
  { id: 'v4', title: '2026 - Platinum / Sungrown', inventoryItemId: 'i4', locationId: 'l1' },
];

/** A pool API that records what it was asked to move. */
function fakeEnv(moves) {
  return {
    POOL_INVENTORY_API_URL: 'https://pool.test',
    POOL_INVENTORY_API_KEY: 'k',
    fetchImpl: null,
  };
}

/** Stub global fetch for the pool calls. */
function withPool(moves) {
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'get_supersack_variants') {
      return new Response(JSON.stringify({ variants: VARIANTS }), { status: 200 });
    }
    if (body.action === 'update_supersack_inventory') {
      moves.push({ variantId: body.variantId, operation: body.operation, amount: body.amount });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected ' + body.action }), { status: 200 });
  };
  return () => { globalThis.fetch = real; };
}

/** A db whose cultivar_aliases table holds exactly these (cultivar, alias) pairs. */
function fakeDb(pairs) {
  return {
    prepare() {
      return {
        bind(cultivar) {
          return {
            all: async () => ({
              results: pairs
                .filter(([name]) => String(name).toLowerCase() === String(cultivar).toLowerCase())
                .map(([, alias]) => ({ alias })),
            }),
          };
        },
      };
    },
  };
}

test('the exact title still wins, and never consults an alias', async () => {
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([]), season: 2026, cultivar: 'Sour Lifter', zone: 'Z4', delta: 1, note: 'n',
    });
    assert.equal(r.ok, true);
    assert.equal(r.matchedBy, 'name');
    assert.deepEqual(moves, [{ variantId: 'v2', operation: 'add', amount: 1 }]);
  } finally { restore(); }
});

test('a cultivar the website shortens still moves its count, via a recorded alias', async () => {
  // THE CASE THIS EXISTS FOR. Without the alias the tag prints and the count
  // stays at zero, which is exactly what Koa would have got on 15 bags.
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([['Rainbow GMO Quik', '2026 - Rainbow GMO / Sungrown']]),
      season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8', delta: 15, note: 'n',
    });
    assert.equal(r.ok, true);
    assert.equal(r.matchedBy, 'alias');
    assert.deepEqual(moves, [{ variantId: 'v1', operation: 'add', amount: 15 }]);
  } finally { restore(); }
});

test('with no alias it refuses and says what to do', async () => {
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([]), season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8', delta: 15, note: 'n',
    });
    assert.equal(r.ok, false);
    assert.equal(moves.length, 0, 'nothing may move on a miss');
    assert.match(r.error, /Rainbow GMO Quik \/ Sungrown/);
    assert.match(r.error, /alias/i);
  } finally { restore(); }
});

test('an alias from another season cannot satisfy this one', async () => {
  // The guard that stops a stale row quietly crediting the wrong year.
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([['Rainbow GMO Quik', '2025 - Rainbow GMO / Sungrown']]),
      season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8', delta: 1, note: 'n',
    });
    assert.equal(r.ok, false);
    assert.equal(moves.length, 0);
  } finally { restore(); }
});

test('a Greenhouse alias cannot satisfy a Sungrown bag', async () => {
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([['Rainbow GMO Quik', '2026 - Rainbow GMO / Greenhouse']]),
      season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8', delta: 1, note: 'n',
    });
    assert.equal(r.ok, false);
    assert.equal(moves.length, 0);
  } finally { restore(); }
});

test('two aliases both hitting real variants is refused, not guessed', async () => {
  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([
        ['Rainbow GMO Quik', '2026 - Rainbow GMO / Sungrown'],
        ['Rainbow GMO Quik', '2026 - Platinum / Sungrown'],
      ]),
      season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8', delta: 1, note: 'n',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /refusing to guess/i);
    assert.equal(moves.length, 0);
  } finally { restore(); }
});

test('Platinum M A4 never lands on Platinum, which is why this is not a parse', async () => {
  // The field's own proof that dropping trailing words is unsafe: both grow in
  // Z8, and Platinum is a strict prefix of Platinum M A4.
  const z8 = ZONE_CULTIVARS.Z8 || [];
  assert.ok(z8.includes('Platinum') && z8.includes('Platinum M A4'),
    'Z8 is expected to hold both — that is what makes a loosening rule dangerous');

  const moves = [];
  const restore = withPool(moves);
  try {
    const r = await adjustSupersackCount(fakeEnv(), {
      db: fakeDb([]),   // no alias recorded for Platinum M A4
      season: 2026, cultivar: 'Platinum M A4', zone: 'Z8', delta: 3, note: 'n',
    });
    assert.equal(r.ok, false, 'must not fall back onto the Platinum variant');
    assert.equal(moves.length, 0);
    assert.ok(!moves.some(m => m.variantId === 'v4'));
  } finally { restore(); }
});

test('the title a bag looks for is built from its own zone', () => {
  assert.equal(variantTitle(2026, 'Rainbow GMO Quik', harvestTypeForZone('Z8')),
    '2026 - Rainbow GMO Quik / Sungrown');
  assert.equal(variantTitle(2026, 'Gravy Train', harvestTypeForZone('GH1')),
    '2026 - Gravy Train / Greenhouse');
  assert.ok(findVariant(VARIANTS, '2026 - sour lifter / sungrown'), 'case tolerant');
});
