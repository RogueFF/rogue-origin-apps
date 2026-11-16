/**
 * Crew leaderboard (barn TV + QR page), Koa 2026-11-16: name only the top 5,
 * show the room against the goal and a "most improved" slot, never shame the
 * bottom. Rate = all of a person's full days to date.
 *
 *   · ranking is over all full days (sum g / sum minutes), not the best day
 *   · nobody is ranked before MIN_DAYS (2) full days; part days never count
 *   · most improved = biggest rise first → latest full day, outside the top 5
 *   · the response never names rank 6+ (except the most-improved slot) and
 *     never carries a card token
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleProductionD1 } = await import(url('workers/src/handlers/production/index.js'));
const { boardFrom, MIN_DAYS } = await import(url('workers/src/handlers/production/crew-board.js'));

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  const sql = readFileSync(join(REPO, 'workers/migrations/0065-crew-numbers.sql'), 'utf8')
    .split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
  for (const st of sql.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
  const DB = {
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    prepare(q) {
      const bound = (...args) => ({
        all: async () => ({ results: sqlite.prepare(q).all(...args) }),
        first: async () => sqlite.prepare(q).get(...args) ?? null,
        run: async () => { const r = sqlite.prepare(q).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      });
      return { bind: bound, ...bound() };
    },
  };
  return { sqlite, env: { DB, ORDERS_PASSWORD: 'pw' } };
}
const quiet = async (fn) => {
  const l = console.log, e = console.error, w = console.warn;
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; }
};
const post = (env, action, body) => quiet(() => handleProductionD1(new Request(`https://x/api/production?action=${action}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env));
const get = (env, qs) => quiet(() => handleProductionD1(new Request(`https://x/api/production?${qs}`), env));

// one 60-minute hour per person per day: grams in that hour = their rate in g/hr
const day = (date, people, target = 0.5, roomRate = 0.4) => ({
  date, target, roomRate, password: 'pw',
  people: people.map(([name, g, fullDay = true]) => ({ name, cell: '1', fullDay, hours: [{ slot: '7–8', g, min: 60 }] })),
});
// 8 people; P8 climbs the most but is not in the top 5
const D1 = [['P1', 400], ['P2', 380], ['P3', 360], ['P4', 340], ['P5', 320], ['P6', 300], ['P7', 290], ['P8', 100], ['Solo', 900]];
const D2 = [['P1', 400], ['P2', 380], ['P3', 360], ['P4', 340], ['P5', 320], ['P6', 290], ['P7', 300], ['P8', 240], ['Part', 950, false]];

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('top 5 over all full days; one-day people and part days are not ranked', async () => {
  const { env } = freshDb();
  await post(env, 'crewLoadDay', day('2026-11-12', D1));
  await post(env, 'crewLoadDay', day('2026-11-13', D2, 0.51, 0.45));
  const b = await (await get(env, 'action=crewBoard')).json();
  assert.equal(b.minDays, MIN_DAYS);
  assert.deepEqual(b.top.map((p) => p.name), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.equal(b.top[0].gph, 400);
  assert.equal(b.top[0].days, 2);
  assert.equal(b.rankedCount, 8, 'Solo (1 day) and Part (part day only) are not ranked');
  assert.equal(b.room.date, '2026-11-13');
  assert.equal(b.room.goal.lbHr, 0.51);
  assert.equal(b.room.rate.lbHr, 0.45);
  assert.ok(b.top.every((p) => typeof p.lbHr === 'number' && typeof p.gph === 'number'));
});

test('most improved: biggest first → latest rise, outside the top 5', async () => {
  const { env } = freshDb();
  await post(env, 'crewLoadDay', day('2026-11-12', D1));
  await post(env, 'crewLoadDay', day('2026-11-13', D2));
  const b = await (await get(env, 'action=crewBoard')).json();
  assert.equal(b.mostImproved.name, 'P8');
  assert.equal(b.mostImproved.from.gph, 100);
  assert.equal(b.mostImproved.to.gph, 240);
  assert.equal(b.mostImproved.rise.gph, 140);
});

test('the response names only the top 5 + most improved, and carries no token', async () => {
  const { env, sqlite } = freshDb();
  await post(env, 'crewLoadDay', day('2026-11-12', D1));
  await post(env, 'crewLoadDay', day('2026-11-13', D2));
  const raw = await (await get(env, 'action=crewBoard')).text();
  for (const hidden of ['P6', 'P7', 'Solo', 'Part']) assert.ok(!raw.includes(`"${hidden}"`), `${hidden} leaked`);
  for (const { token } of sqlite.prepare('SELECT token FROM crew_people').all()) assert.ok(!raw.includes(token), 'a card token leaked');
  assert.ok(!/"rank":\s*[6-9]/.test(raw));
  assert.ok(!raw.includes('$'));
});

test('nobody ranked yet: empty board, no most improved, no crash', () => {
  const b = boardFrom([{ person_id: 1, name: 'A', work_date: '2026-11-12', tops_g: 300, work_min: 60 }], null);
  assert.deepEqual(b.top, []);
  assert.equal(b.mostImproved, null);
  assert.equal(b.room, null);
});

test('no one improved: the slot stays empty rather than naming a decline', () => {
  const rows = [];
  for (const [i, g1, g2] of [[1, 500, 500], [2, 400, 400], [3, 300, 300], [4, 290, 290], [5, 280, 280], [6, 270, 200], [7, 260, 260]]) {
    rows.push({ person_id: i, name: `N${i}`, work_date: '2026-11-12', tops_g: g1, work_min: 60 });
    rows.push({ person_id: i, name: `N${i}`, work_date: '2026-11-13', tops_g: g2, work_min: 60 });
  }
  assert.equal(boardFrom(rows, null).mostImproved, null);
});

test('rate is total grams over total minutes, not the average of daily rates', () => {
  const rows = [
    { person_id: 1, name: 'A', work_date: '2026-11-12', tops_g: 600, work_min: 60 },   // 600 g/hr for 1 hr
    { person_id: 1, name: 'A', work_date: '2026-11-13', tops_g: 600, work_min: 300 },  // 120 g/hr for 5 hr
  ];
  assert.equal(boardFrom(rows, null).top[0].gph, 200); // 1200 g / 6 hr, not (600+120)/2
});
