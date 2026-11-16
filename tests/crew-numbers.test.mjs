/**
 * "Mis números": each trimmer sees their own numbers through a personal QR card.
 *
 * Koa, 2026-11-16: "a quick app where they can each view their own numbers",
 * own numbers + the target + their rank. What these tests pin:
 *
 *   · the card token unlocks one person: the response never carries another
 *     person's name or numbers, only their rank and the field size
 *   · rank is among that day's full-day cells; a part-day row gets no rank
 *   · loading a day is password-locked and replaces the day (a corrected sheet
 *     re-ranks everyone), and a known name keeps its card token
 *   · a wrong or malformed token is a plain 404
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
const { rankDay } = await import(url('workers/src/handlers/production/crew-numbers.js'));

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

const hrs = (gs, min = 60) => gs.map((g, i) => ({ slot: `h${i}`, g, min }));
const DAY = {
  date: '2026-11-13', target: 0.51, roomRate: 0.44, password: 'pw',
  people: [
    { name: 'Diego Moreno', cell: '5', hours: hrs([366, 286, 233]) },
    { name: 'Lucio', cell: '2', hours: hrs([318, 267, 222]) },
    { name: 'Esmeralda', cell: '13', hours: hrs([126, 98, 76]) },
    { name: 'Adolfo', cell: '26', hours: hrs([131]), fullDay: false },
  ],
};

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('loading a day needs the password', async () => {
  const { env } = freshDb();
  const res = await post(env, 'crewLoadDay', { ...DAY, password: undefined });
  assert.equal(res.status, 401);
  const res2 = await post(env, 'crewLoadDay', { ...DAY, password: 'nope' });
  assert.equal(res2.status, 401);
});

test('a card shows only its owner: own numbers, target, rank, field size', async () => {
  const { env } = freshDb();
  const load = await (await post(env, 'crewLoadDay', DAY)).json();
  assert.equal(load.loaded, 4);
  const tok = Object.fromEntries(load.people.map((p) => [p.name, p.token]));
  assert.match(tok.Lucio, /^[A-Za-z0-9_-]{22}$/);

  const res = await get(env, `action=myNumbers&t=${tok.Lucio}`);
  assert.equal(res.status, 200);
  const raw = await res.text();
  const me = JSON.parse(raw);
  assert.equal(me.name, 'Lucio');
  assert.equal(me.days.length, 1);
  const d = me.days[0];
  assert.equal(d.rank, 2);
  assert.equal(d.of, 3, 'the part-day row is not in the field');
  assert.equal(d.target, 0.51);
  assert.equal(d.topsG, 807);
  assert.equal(d.hourly.length, 3);
  for (const other of ['Diego', 'Esmeralda', 'Adolfo']) assert.ok(!raw.includes(other), `${other} leaked into Lucio's card`);
  assert.ok(!raw.includes('$'));

  const part = await (await get(env, `action=myNumbers&t=${tok.Adolfo}`)).json();
  assert.equal(part.days[0].rank, null);
  assert.equal(part.days[0].fullDay, false);
});

test('reloading a day replaces it, re-ranks, and keeps the card token', async () => {
  const { env, sqlite } = freshDb();
  const first = await (await post(env, 'crewLoadDay', DAY)).json();
  const fixed = structuredClone(DAY);
  fixed.people[2].hours = hrs([600, 600, 600]); // Esmeralda's sheet was misread
  const second = await (await post(env, 'crewLoadDay', fixed)).json();
  assert.deepEqual(second.people.map((p) => p.token), first.people.map((p) => p.token));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crew_days').get().n, 4);
  const tok = second.people.find((p) => p.name === 'Esmeralda').token;
  const me = await (await get(env, `action=myNumbers&t=${tok}`)).json();
  assert.equal(me.days[0].rank, 1);
});

test('a wrong or malformed card is a 404', async () => {
  const { env } = freshDb();
  await post(env, 'crewLoadDay', DAY);
  assert.equal((await get(env, 'action=myNumbers&t=AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
  assert.equal((await get(env, "action=myNumbers&t=x' OR 1=1--")).status, 404);
  assert.equal((await get(env, 'action=myNumbers')).status, 404);
});

test('bad loads are refused, not half-written', async () => {
  const { env, sqlite } = freshDb();
  assert.equal((await post(env, 'crewLoadDay', { ...DAY, date: '11/13/26' })).status, 400);
  const dup = { ...DAY, people: [DAY.people[0], { ...DAY.people[0] }] };
  assert.equal((await post(env, 'crewLoadDay', dup)).status, 400);
  const wild = { ...DAY, people: [{ name: 'X', hours: [{ slot: 'a', g: 99999, min: 60 }] }] };
  assert.equal((await post(env, 'crewLoadDay', wild)).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crew_days').get().n, 0);
});

test('equal rates share a rank', () => {
  const { ranks, of } = rankDay([
    { person_id: 1, tops_g: 600, work_min: 60, full_day: 1 },
    { person_id: 2, tops_g: 600, work_min: 60, full_day: 1 },
    { person_id: 3, tops_g: 300, work_min: 60, full_day: 1 },
    { person_id: 4, tops_g: 900, work_min: 60, full_day: 0 },
  ]);
  assert.equal(of, 3);
  assert.deepEqual([ranks.get(1), ranks.get(2), ranks.get(3), ranks.get(4)], [1, 1, 3, undefined]);
});

test('crewPeople lists tokens for printing cards, behind the password', async () => {
  const { env } = freshDb();
  await post(env, 'crewLoadDay', DAY);
  assert.equal((await post(env, 'crewPeople', {})).status, 401);
  const r = await (await post(env, 'crewPeople', { password: 'pw' })).json();
  assert.equal(r.people.length, 4);
});
