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
 * THE CUT SPLIT (Koa, 2026-09-16). Every 2026 variant became "/ 1st Cut" and
 * "/ 2nd Cut" — the old variant renamed in place, the 2nd Cut newly created.
 * The fixtures are the real titles and variant ids from that export, and the
 * aliases are the six rows in production, which were all recorded before the
 * split and must keep working.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const { adjustSupersackCount, checkSupersackVariant, variantTitle, cutLabel, harvestTypeForZone, findVariant } =
  await import(mod('workers/src/lib/supersack-inventory.js'));
const { ZONE_CULTIVARS } = await import(mod('workers/src/lib/zone-cultivars.js'));

const gid = (n) => `gid://shopify/ProductVariant/${n}`;
const RG1 = gid(48979052200128);   // was "2026 - Rainbow GMO / Sungrown", renamed in place
const RG2 = gid(49030271664320);
const SL1 = gid(48893863002304);
const SL2 = gid(49030271697088);
const PL1 = gid(49030526697664);
const GTGH1 = gid(48864076169408);
const GTSG1 = gid(49030525714624);

/** Real 2026 Super Sack variants from the 2026-09-16 export, plus one 2025 variant. */
const VARIANTS = [
  { id: RG1, title: '2026 - Rainbow GMO / Sungrown / 1st Cut' },
  { id: RG2, title: '2026 - Rainbow GMO / Sungrown / 2nd Cut' },
  { id: SL1, title: '2026 - Sour Lifter / Sungrown / 1st Cut' },
  { id: SL2, title: '2026 - Sour Lifter / Sungrown / 2nd Cut' },
  { id: PL1, title: '2026 - Platinum / Sungrown / 1st Cut' },
  { id: gid(49030526730432), title: '2026 - Platinum / Sungrown / 2nd Cut' },
  { id: GTGH1, title: '2026 - Gravy Train / Greenhouse / 1st Cut' },
  { id: GTSG1, title: '2026 - Gravy Train / Sungrown / 1st Cut' },
  { id: 'v2025', title: '2025 - Rainbow GMO / Sungrown' },
].map((v, i) => ({ ...v, inventoryItemId: `i${i}`, locationId: 'l1' }));

/** The 2026 alias rows in production, as recorded before the split. */
const PROD_ALIASES = [
  ['Gravy Train', '2026 - Gravy Train / Greenhouse'],
  ['Legendary Banana Mac', '2026 - Legendary Banana Mac / Greenhouse'],
  ['Lifter', '2026 - Lifter / Sungrown'],
  ['Rainbow GMO Quik', '2026 - Rainbow GMO / Sungrown'],
  ['Sour Lifter', '2026 - Sour Lifter / Sungrown'],
  ['Strawberry Doughnuts', '2026 - Strawberry Doughnuts / Greenhouse'],
];

const env = () => ({ POOL_INVENTORY_API_URL: 'https://pool.test', POOL_INVENTORY_API_KEY: 'k' });

/** Stub global fetch for the pool calls; `down` makes the variant list fail. */
function withPool(moves, { down = false } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'get_supersack_variants') {
      if (down) return new Response(JSON.stringify({ error: 'Apps Script timed out' }), { status: 200 });
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

async function move(args, opts) {
  const moves = [];
  const restore = withPool(moves, opts);
  try {
    const r = await adjustSupersackCount(env(), { season: 2026, note: 'n', delta: 1, db: fakeDb([]), ...args });
    return { r, moves };
  } finally { restore(); }
}

// ─── the cut ─────────────────────────────────────────────────────────────────

test('a sack counts on its own cut — first cut on 1st Cut, second cut on 2nd Cut', async () => {
  const one = await move({ cultivar: 'Sour Lifter', zone: 'Z4', cut: 1 });
  assert.equal(one.r.ok, true);
  assert.equal(one.r.matchedBy, 'name');
  assert.deepEqual(one.moves, [{ variantId: SL1, operation: 'add', amount: 1 }]);

  const two = await move({ cultivar: 'Sour Lifter', zone: 'Z4', cut: 2 });
  assert.equal(two.r.ok, true);
  assert.deepEqual(two.moves, [{ variantId: SL2, operation: 'add', amount: 1 }],
    'whole plant and side branches are different stock');
});

test('a third cut has no variant, so it is refused and names what exists', async () => {
  for (const cut of [3, null, undefined, 0]) {
    const { r, moves } = await move({ cultivar: 'Sour Lifter', zone: 'Z4', cut });
    assert.equal(r.ok, false, `cut ${cut}`);
    assert.equal(moves.length, 0, 'nothing may move on a miss');
    assert.match(r.error, /1st Cut and 2nd Cut/);
  }
});

test('the old two-part title no longer exists for 2026, and nothing falls back to it', async () => {
  const { r, moves } = await move({ cultivar: 'Platinum M A4', zone: 'Z8', cut: 1 });
  assert.equal(r.ok, false);
  assert.equal(moves.length, 0);
  assert.match(r.error, /"2026 - Platinum M A4 \/ Sungrown \/ 1st Cut"/, 'the error names the full title to create');
});

// ─── aliases ─────────────────────────────────────────────────────────────────

test('the real Rainbow GMO Quik alias, recorded before the split, reaches both cuts', async () => {
  // THE CASE THIS EXISTS FOR, against the production row: without it the 15
  // first-cut bags and the 5 second-cut bags would print and never count.
  const db = fakeDb(PROD_ALIASES);
  const one = await move({ db, cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1, delta: 15 });
  assert.equal(one.r.matchedBy, 'alias');
  assert.deepEqual(one.moves, [{ variantId: RG1, operation: 'add', amount: 15 }]);
  const two = await move({ db, cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 2, delta: 5 });
  assert.deepEqual(two.moves, [{ variantId: RG2, operation: 'add', amount: 5 }]);
});

test('an alias recorded with a cut serves only that cut', async () => {
  const db = fakeDb([['Rainbow GMO Quik', '2026 - Rainbow GMO / Sungrown / 2nd Cut']]);
  const two = await move({ db, cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 2 });
  assert.deepEqual(two.moves, [{ variantId: RG2, operation: 'add', amount: 1 }]);
  const one = await move({ db, cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1 });
  assert.equal(one.r.ok, false, 'a 2nd Cut alias must never credit a first-cut bag');
  assert.equal(one.moves.length, 0);
});

test('with no alias it refuses and says what to do', async () => {
  const { r, moves } = await move({ cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1 });
  assert.equal(r.ok, false);
  assert.equal(moves.length, 0, 'nothing may move on a miss');
  assert.match(r.error, /Rainbow GMO Quik \/ Sungrown \/ 1st Cut/);
  assert.match(r.error, /alias/i);
});

test('an alias from another season cannot satisfy this one', async () => {
  const { r, moves } = await move({
    db: fakeDb([['Rainbow GMO Quik', '2025 - Rainbow GMO / Sungrown']]),
    cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1,
  });
  assert.equal(r.ok, false);
  assert.equal(moves.length, 0);
});

test('a Greenhouse alias cannot satisfy a Sungrown bag, and the real Gravy Train row stays under glass', async () => {
  const gh = await move({
    db: fakeDb([['Rainbow GMO Quik', '2026 - Rainbow GMO / Greenhouse']]),
    cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1,
  });
  assert.equal(gh.r.ok, false);
  assert.equal(gh.moves.length, 0);

  const db = fakeDb(PROD_ALIASES);
  const glass = await move({ db, cultivar: 'Gravy Train', zone: 'GH1', cut: 1 });
  assert.deepEqual(glass.moves, [{ variantId: GTGH1, operation: 'add', amount: 1 }]);
  const field = await move({ db, cultivar: 'Gravy Train', zone: 'Z3', cut: 1 });
  assert.deepEqual(field.moves, [{ variantId: GTSG1, operation: 'add', amount: 1 }]);
});

test('two aliases both hitting real variants is refused, not guessed', async () => {
  const { r, moves } = await move({
    db: fakeDb([
      ['Rainbow GMO Quik', '2026 - Rainbow GMO / Sungrown'],
      ['Rainbow GMO Quik', '2026 - Platinum / Sungrown'],
    ]),
    cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /refusing to guess/i);
  assert.equal(moves.length, 0);
});

test('Platinum M A4 never lands on Platinum, which is why this is not a parse', async () => {
  // The field's own proof that dropping trailing words is unsafe: both grow in
  // Z8, and Platinum is a strict prefix of Platinum M A4.
  const z8 = ZONE_CULTIVARS.Z8 || [];
  assert.ok(z8.includes('Platinum') && z8.includes('Platinum M A4'),
    'Z8 is expected to hold both — that is what makes a loosening rule dangerous');

  const { r, moves } = await move({ cultivar: 'Platinum M A4', zone: 'Z8', cut: 1, delta: 3 });
  assert.equal(r.ok, false, 'must not fall back onto the Platinum variant');
  assert.ok(!moves.some(m => m.variantId === PL1));
});

// ─── undoing a move ──────────────────────────────────────────────────────────

test('a void or an opening takes the sack off the variant it was counted on, not a re-match', async () => {
  // Rainbow GMO second-cut bags were counted before the split, on the variant
  // that is now titled 1st Cut. Re-matching by title would take them off 2nd
  // Cut, which never received them.
  const { r, moves } = await move({
    db: fakeDb(PROD_ALIASES), cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 2, delta: -1, variantId: RG1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.matchedBy, 'id');
  assert.deepEqual(moves, [{ variantId: RG1, operation: 'subtract', amount: 1 }]);
});

test('if the variant a sack was counted on is gone, the move is refused rather than re-matched', async () => {
  const { r, moves } = await move({
    db: fakeDb(PROD_ALIASES), cultivar: 'Rainbow GMO Quik', zone: 'Z8', cut: 1, delta: -1,
    variantId: gid(1),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /no longer exists/);
  assert.equal(moves.length, 0);
});

// ─── the takedown check ──────────────────────────────────────────────────────

test('the Start-takedown check says whether a tag will count, and stays quiet about an outage', async () => {
  const db = fakeDb(PROD_ALIASES);
  const lot = { season: 2026, cultivar: 'Rainbow GMO Quik', zone: 'Z8' };
  let restore = withPool([]);
  try {
    assert.deepEqual(await checkSupersackVariant(env(), db, { ...lot, cut: 2 }),
      { ok: true, title: '2026 - Rainbow GMO / Sungrown / 2nd Cut', error: null });
    const miss = await checkSupersackVariant(env(), db, { ...lot, cultivar: 'Purple Snowman', cut: 1 });
    assert.equal(miss.ok, false);
    assert.match(miss.error, /Purple Snowman \/ Sungrown \/ 1st Cut/);
    assert.equal((await checkSupersackVariant(env(), db, { ...lot, cut: 3 })).ok, false);
  } finally { restore(); }

  restore = withPool([], { down: true });
  try {
    const down = await checkSupersackVariant(env(), db, { ...lot, cut: 1 });
    assert.equal(down.ok, null, 'a check that could not run is not a missing variant');
  } finally { restore(); }
});

test('titles and cut labels', () => {
  assert.equal(cutLabel(1), '1st Cut');
  assert.equal(cutLabel('2'), '2nd Cut');
  assert.equal(cutLabel(3), null);
  assert.equal(variantTitle(2026, 'Rainbow GMO Quik', harvestTypeForZone('Z8'), 2),
    '2026 - Rainbow GMO Quik / Sungrown / 2nd Cut');
  assert.equal(variantTitle(2026, 'Gravy Train', harvestTypeForZone('GH1'), 1),
    '2026 - Gravy Train / Greenhouse / 1st Cut');
  assert.equal(variantTitle(2025, 'Lifter'), '2025 - Lifter / Sungrown', 'no cut, the pre-split title');
  assert.ok(findVariant(VARIANTS, '2026 - sour lifter / sungrown / 1ST CUT'), 'case tolerant');
});
