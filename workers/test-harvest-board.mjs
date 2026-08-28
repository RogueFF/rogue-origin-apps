/**
 * Throwaway harness for the harvest board handler — run with `node test-harvest-board.mjs`.
 * Stubs D1 with an in-memory table so the interesting logic (lot resolution,
 * stage validation, auth gating, partial updates) is exercised without a deploy.
 */
import { handleHarvestBoard } from './src/handlers/harvest-board-d1.js';

const ROWS = [
  { lot_id: 'gary-z16-sour-lifter', farm: 'Gary', zone: 'Z16', cultivar: 'Sour Lifter', cultivar_slug: 'sour-lifter', map: 'gary-z16-sour-lifter.png', stage: 'scheduled', test_date: null, thc: null, sacks: null, notes: null, docs: '[]', updated_at: null, updated_by: 'migration' },
  { lot_id: 'gary-z14-lifter', farm: 'Gary', zone: 'Z14', cultivar: 'Lifter', cultivar_slug: 'lifter', map: null, stage: 'untested', test_date: null, thc: null, sacks: null, notes: null, docs: '[]', updated_at: null, updated_by: 'migration' },
  { lot_id: 'gary-z14-sour-lifter', farm: 'Gary', zone: 'Z14', cultivar: 'Sour Lifter', cultivar_slug: 'sour-lifter', map: null, stage: 'untested', test_date: null, thc: null, sacks: null, notes: null, docs: '[]', updated_at: null, updated_by: 'migration' },
  { lot_id: 'rogue-z8-lemon', farm: 'Rogue', zone: 'Z8', cultivar: 'Lemon', cultivar_slug: 'lemon', map: null, stage: 'untested', test_date: null, thc: null, sacks: null, notes: null, docs: '[]', updated_at: null, updated_by: 'migration' },
  { lot_id: 'rogue-gh1c-animal-muffins', farm: 'Rogue', zone: 'GH1C', cultivar: 'Animal Muffins', cultivar_slug: 'animal-muffins', map: null, stage: 'failed', test_date: '2026-08-11', thc: 0.7, sacks: null, notes: 'FAILED', docs: '[{"label":"CWD","ref":"raw/x.pdf"}]', updated_at: null, updated_by: 'migration' },
];

let rows = ROWS.map((r) => ({ ...r }));

// Minimal D1 shim: enough SQL shape-matching for this handler's four statements.
const DB = {
  prepare(sql) {
    let bound = [];
    const api = {
      bind(...a) { bound = a; return api; },
      async all() { return { results: run(sql, bound) }; },
      async first() { return run(sql, bound)[0] || null; },
      async run() { return { meta: { changes: run(sql, bound).length } }; },
    };
    return api;
  },
};

function run(sql, args) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('UPDATE harvest_lots SET')) {
    const cols = s.slice(s.indexOf('SET') + 4, s.indexOf(' WHERE')).split(',').map((c) => c.trim().split(' =')[0]);
    const id = args[args.length - 1];
    const row = rows.find((r) => r.lot_id === id);
    cols.forEach((c, i) => { row[c] = args[i]; });
    return [row];
  }
  let out = rows;
  if (s.includes('WHERE lot_id = ?')) out = rows.filter((r) => r.lot_id === args[0]);
  else if (s.includes('WHERE stage = ?')) out = rows.filter((r) => r.stage === args[0]);
  else if (s.includes('WHERE farm = ?')) out = rows.filter((r) => r.farm === args[0]);
  return out.map((r) => ({ ...r }));
}

const env = { DB, API_PASSWORD: 'sekrit' };
const req = (pw = 'sekrit') => new Request('https://x/api/harvest', {
  headers: pw ? { authorization: `Bearer ${pw}` } : {},
});

let pass = 0; let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + ' -> ' + e.message);
    fail++;
  }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const body = async (r) => JSON.parse(await r.text());

async function call(action, b = {}, pw = 'sekrit') {
  return handleHarvestBoard(req(pw), env, {}, { action, params: {}, body: b });
}
async function expectThrow(fn, needle) {
  try { await fn(); } catch (e) {
    if (!String(e.message || '').toLowerCase().includes(needle.toLowerCase())
        && !String(e.code || '').toLowerCase().includes(needle.toLowerCase())) {
      throw new Error(`wrong error: ${e.message || e.code}`);
    }
    return;
  }
  throw new Error('expected a throw');
}

console.log('harvest board handler');

await check('board_page needs no password and ships no lot data', async () => {
  const r = await handleHarvestBoard(req(''), env, {}, { action: 'board_page', params: {}, body: {} });
  const html = await r.text();
  eq(r.headers.get('content-type').includes('text/html'), true, 'html');
  eq(html.includes('Sour Lifter'), false, 'must not embed lot data');
  eq(html.includes('gate-card'), true, 'gate present');
});

await check('board rejects a missing password', () => expectThrow(() => call('board', {}, ''), 'password'));
await check('board rejects a wrong password', () => expectThrow(() => call('board', {}, 'nope'), 'Invalid'));

await check('board returns all lots, ordered by stage', async () => {
  const d = (await body(await call('board')));
  eq(d.total, 5, 'total');
  eq(d.lots[0].stage, 'untested', 'untested first');
  eq(d.lots[d.lots.length - 1].stage, 'failed', 'failed last');
  eq(d.counts.untested, 3, 'untested count');
});

await check('board filters by stage', async () => {
  const d = (await body(await call('board', { stage: 'failed' })));
  eq(d.total, 1, 'one failed');
});

await check('board rejects an unknown stage filter', () => expectThrow(() => call('board', { stage: 'nope' }), 'Unknown stage'));

await check('board_set moves a lot by exact id', async () => {
  const d = (await body(await call('board_set', { lot: 'rogue-z8-lemon', stage: 'drying' })));
  eq(d.lot.stage, 'drying', 'stage');
  eq(d.was.stage, 'untested', 'previous stage reported');
  eq(d.lot.updated_by, 'board', 'actor');
  if (!d.lot.updated_at) throw new Error('updated_at not stamped');
});

await check('board_set resolves a human phrase (Timber path)', async () => {
  const d = (await body(await call('board_set', { lot: 'Z16 sour lifter', stage: 'harvesting', actor: 'timber' })));
  eq(d.lot.lot_id, 'gary-z16-sour-lifter', 'resolved');
  eq(d.lot.updated_by, 'timber', 'actor recorded');
});

await check('an ambiguous phrase errors instead of guessing', () =>
  expectThrow(() => call('board_set', { lot: 'sour lifter', stage: 'drying' }), 'matches 2 lots'));

await check('an unmatched phrase 404s', () =>
  expectThrow(() => call('board_set', { lot: 'purple zebra', stage: 'drying' }), 'No lot matches'));

await check('an unknown stage is refused', () =>
  expectThrow(() => call('board_set', { lot: 'gary-z14-lifter', stage: 'dryng' }), 'Unknown stage'));

await check('a bad test_date is refused', () =>
  expectThrow(() => call('board_set', { lot: 'gary-z14-lifter', test_date: '9/15/26' }), 'YYYY-MM-DD'));

await check('a negative thc is refused', () =>
  expectThrow(() => call('board_set', { lot: 'gary-z14-lifter', thc: -1 }), 'non-negative'));

await check('an empty update is refused', () =>
  expectThrow(() => call('board_set', { lot: 'gary-z14-lifter' }), 'Nothing to change'));

await check('partial update leaves other fields alone', async () => {
  await call('board_set', { lot: 'gary-z14-lifter', thc: 0.24, test_date: '2026-09-15' });
  const d = (await body(await call('board_set', { lot: 'gary-z14-lifter', notes: 'hi' })));
  eq(d.lot.thc, 0.24, 'thc kept');
  eq(d.lot.test_date, '2026-09-15', 'date kept');
  eq(d.lot.stage, 'untested', 'stage kept');
});

await check('docs round-trip and a doc without a ref is refused', async () => {
  const d = (await body(await call('board_set', {
    lot: 'gary-z14-lifter',
    docs: [{ label: 'COA', ref: 'https://drive/x' }],
  })));
  eq(JSON.parse(d.lot.docs)[0].ref, 'https://drive/x', 'doc stored');
  await expectThrow(() => call('board_set', { lot: 'gary-z14-lifter', docs: [{ label: 'x' }] }), 'needs a ref');
});

await check('clearing a field with null works', async () => {
  const d = (await body(await call('board_set', { lot: 'gary-z14-lifter', thc: null })));
  eq(d.lot.thc, null, 'thc cleared');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
