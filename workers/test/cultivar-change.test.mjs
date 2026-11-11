/**
 * A cultivar change mid-hour (migration 0059), on real SQLite: the schema as it
 * was, plus the migration, written through addProduction and read back through
 * the per-cultivar readers that now use MP_BY_CULTIVAR.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { addProduction, getProduction } from '../src/handlers/production/hourly-entry.js';
import { getStrainSummary } from '../src/handlers/production/strain.js';
import { getExtendedDailyData } from '../src/handlers/production/scoreboard.js';
import { getEffectiveTargetRate, formatDatePT } from '../src/lib/production-utils.js';
import { changeShare, MP_BY_CULTIVAR } from '../src/lib/cultivar-parts.js';

const SL = '2026 - Sour Lifter / Sungrown', SD = '2026 - Strawberry Doughnuts / Sungrown';
const TODAY = formatDatePT(new Date(), 'yyyy-MM-dd');

/** A D1-shaped wrapper over node:sqlite. */
function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a.map(v => (v === undefined ? null : v))),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: sql => stmt(sql), batch: async ss => Promise.all(ss.map(s => s.run())) };
}

function freshEnv() {
  const db = new DatabaseSync(':memory:');
  // monthly_production as it stood before 0059, then the migration itself.
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const create = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS monthly_production'));
  db.exec(create.slice(0, create.indexOf(');') + 2).split('\n').filter(l => !/^\s+change_/.test(l)).join('\n'));
  db.exec(readFileSync(new URL('../migrations/0059-hourly-cultivar-change.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE data_version (key TEXT PRIMARY KEY, version INTEGER DEFAULT 0, updated_at TEXT);
           CREATE TABLE cultivar_aliases (alias TEXT PRIMARY KEY, cultivar_id TEXT NOT NULL, crop_year INTEGER, source TEXT);
           INSERT INTO cultivar_aliases VALUES ('${SL}', 'sour-lifter', 2026, 'production'), ('${SD}', 'strawberry-doughnuts', 2026, 'production');`);
  return { DB: d1(db), raw: db };
}

const save = (env, body) => addProduction({ date: TODAY, trimmers1: 13, tzero1: 1, ...body }, env);
const json = async r => ({ status: r.status, body: await r.json() });

test('the change share is the working minutes after the change (breaks out)', () => {
  assert.equal(changeShare('1:00 PM – 2:00 PM', '13:20').share, 0.667);
  // 9-10 has the 9:00-9:10 break: 50 working minutes, 30 after 9:30
  assert.equal(changeShare('9:00 AM – 10:00 AM', '09:30').share, 0.6);
  assert.equal(changeShare('7:03 AM – 8:00 AM', '07:33').share, 0.474);
  assert.equal(changeShare('1:00 PM – 2:00 PM', '14:00').ok, false);   // the slot's end is not inside it
  assert.equal(changeShare('1:00 PM – 2:00 PM', '12:50').ok, false);
  assert.equal(changeShare('1:00 PM – 2:00 PM', '1:20').ok, false);    // not HH:MM
});

test('a changed hour: totals unchanged, each part under its own cultivar', async () => {
  const env = freshEnv();
  let r = await json(await save(env, { timeSlot: '12:30 PM – 1:00 PM', cultivar1: SL, tops1: 2.7, smalls1: 0 }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await json(await save(env, { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.5, smalls1: 3,
    changeAt: '13:20', changeCultivar: SD, changeTops: 2 }));
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // The raw row: tops_lbs1 is still the hour's total.
  const row = env.raw.prepare(`SELECT * FROM monthly_production WHERE time_slot = '1:00 PM – 2:00 PM'`).get();
  assert.equal(row.tops_lbs1, 3.5);
  assert.deepEqual([row.change_at, row.change_cultivar, row.change_tops_lbs, row.change_share], ['13:20', SD, 2, 0.667]);

  // The parts view.
  const parts = env.raw.prepare(`SELECT cultivar1, tops_lbs1, smalls_lbs1, trimmers_line1, slot_share FROM (${MP_BY_CULTIVAR}) WHERE time_slot = '1:00 PM – 2:00 PM' ORDER BY cultivar1`).all();
  assert.equal(parts.length, 2);
  const [a, b] = parts;   // Sour Lifter, then Strawberry Doughnuts
  assert.equal(a.cultivar1, SL); assert.equal(a.tops_lbs1, 1.5);
  assert.equal(b.cultivar1, SD); assert.equal(b.tops_lbs1, 2);
  assert.ok(Math.abs(a.smalls_lbs1 - 1) < 0.01 && Math.abs(b.smalls_lbs1 - 2) < 0.01);
  assert.ok(Math.abs(a.trimmers_line1 + b.trimmers_line1 - 13) < 1e-9);
  assert.ok(Math.abs(a.slot_share + b.slot_share - 1) < 1e-9);

  // Strain summary: tops per cultivar, and hours never double.
  const strains = await getStrainSummary(env, 7, 5);
  const by = Object.fromEntries(strains.map(s => [s.strain, s]));
  assert.equal(by[SL].tops, 4.2);   // 2.7 + 1.5
  assert.equal(by[SD].tops, 2);

  // Dashboard daily list: per-cultivar split; day totals unchanged.
  const day = (await getExtendedDailyData(7, env)).find(d => formatDatePT(d.date, 'yyyy-MM-dd') === TODAY);
  assert.equal(day.totalTops, 6.2);
  assert.deepEqual(day.cultivars.map(c => [c.cultivar, c.tops, c.smalls]), [[SL, 4.2, 1], [SD, 2, 2]]);

  // Strain target rate: Doughnuts' own 2 lb over its share of the trimmer hour.
  const rate = await getEffectiveTargetRate(env, 2, null, SD);
  assert.ok(Math.abs(rate - 2 / (13 * 0.667)) < 0.01, `rate ${rate}`);

  // getProduction hands the change back, and the current cultivar is the new one.
  const p = (await json(await getProduction({ date: TODAY }, env))).body;
  const data = p.data || p;
  const slot = data.production.find(x => x.timeSlot === '1:00 PM – 2:00 PM');
  assert.deepEqual([slot.tops1, slot.changeAt, slot.changeCultivar, slot.changeTops], [3.5, '13:20', SD, 2]);
});

test('a page from before 0059 never wipes a change; an empty change clears it', async () => {
  const env = freshEnv();
  await save(env, { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.5, changeAt: '13:20', changeCultivar: SD, changeTops: 2 });
  await save(env, { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.6 });   // old tab: no change keys
  let row = env.raw.prepare(`SELECT tops_lbs1, change_cultivar FROM monthly_production`).get();
  assert.deepEqual([row.tops_lbs1, row.change_cultivar], [3.6, SD]);
  await save(env, { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.6, changeAt: '', changeCultivar: '', changeTops: '' });
  row = env.raw.prepare(`SELECT change_at, change_cultivar, change_tops_lbs, change_share FROM monthly_production`).get();
  assert.deepEqual(Object.values(row), [null, null, null, null]);
  // No change: one part, the whole slot.
  const parts = env.raw.prepare(`SELECT tops_lbs1, slot_share FROM (${MP_BY_CULTIVAR})`).all();
  assert.deepEqual(parts.map(p => [p.tops_lbs1, p.slot_share]), [[3.6, 1]]);
});

test('bad changes are refused', async () => {
  const env = freshEnv();
  const base = { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.5 };
  for (const [extra, msg] of [
    [{ changeAt: '14:30', changeCultivar: SD, changeTops: 1 }, /inside/],
    [{ changeAt: '13:20', changeCultivar: SL, changeTops: 1 }, /different cultivar/],
    [{ changeAt: '13:20', changeCultivar: SD, changeTops: 4 }, /more than the hour/],
  ]) {
    const r = await json(await save(env, { ...base, ...extra }));
    assert.equal(r.status, 400);
    assert.match(r.body.error.message || r.body.error || JSON.stringify(r.body), msg);
  }
  assert.equal(env.raw.prepare(`SELECT COUNT(*) n FROM monthly_production`).get().n, 0);
});

test('wholesale-shaped reader: the alias join on the parts view rates each cultivar on its own part', async () => {
  const env = freshEnv();
  await save(env, { timeSlot: '1:00 PM – 2:00 PM', cultivar1: SL, tops1: 3.5, smalls1: 3, changeAt: '13:20', changeCultivar: SD, changeTops: 2 });
  // the same SELECT as wholesale-d1.js getRates / rateTable
  const rows = env.raw.prepare(`
    SELECT a.cultivar_id, SUM(mp.tops_lbs1) AS tops_lbs, SUM(COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1)) AS hours
    FROM (${MP_BY_CULTIVAR}) mp
    JOIN cultivar_aliases a ON a.alias = mp.cultivar1
    WHERE COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1) > 0
      AND (mp.tops_lbs1 + mp.smalls_lbs1) > 0
    GROUP BY a.cultivar_id ORDER BY a.cultivar_id`).all();
  assert.deepEqual(rows.map(r => [r.cultivar_id, r.tops_lbs, Math.round(r.hours * 100) / 100]),
    [['sour-lifter', 1.5, 4.33], ['strawberry-doughnuts', 2, 8.67]]);
});
