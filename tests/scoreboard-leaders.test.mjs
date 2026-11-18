/**
 * Crew Top 5 on the barn scoreboard + the TV rotation to the crew board
 * (Koa 2026-11-17: "both").
 *
 *   · the panel shows at most 5, in rank order, lb to 2 decimals, grams whole
 *   · a failed, empty or malformed reply hides the panel (the TV never shows an error)
 *   · nobody is ever marked below the goal; only "over" is drawn
 *   · only a TV rotates: TV Mode or ?rotate=1, a wide screen, not embedded, visible,
 *     nothing open, nobody touching it, and a crew board worth showing
 *   · EN and ES carry the same labels
 *
 * Run with `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  TOP, REFRESH_MS, ROTATE_EVERY_MS, ROTATE_SHOW_MS, PRELOAD_MS, READY_TIMEOUT_MS, IDLE_AFTER_INPUT_MS,
  MIN_ROTATE_WIDTH, LABELS, panelModel, fmtDay, fill, shouldRotate, localApi, crewBoardUrl,
} from '../src/js/scoreboard-v2/leaders-logic.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (rank, name, gph, lbHr) => ({ rank, name, gph, lbHr });
// the live reply's shape on 2026-11-17 (crew-board.js boardFrom)
const LIVE = {
  success: true,
  day: '2026-11-17',
  rankedCount: 11,
  top: [P(1, 'Ariel', 373, 0.82), P(2, 'Alberto (Junior)', 284, 0.63), P(3, 'José Luis', 278, 0.61), P(4, 'Gandiva (Yair)', 267, 0.59), P(5, 'Antonio', 257, 0.57)],
  room: { date: '2026-11-17', rate: { gph: 254, lbHr: 0.56 }, goal: { gph: 240, lbHr: 0.53 } },
  days: ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'],
};

test('the panel draws the live top 5 in order with the goal', () => {
  const m = panelModel(LIVE);
  assert.equal(m.day, '2026-11-17');
  assert.deepEqual(m.goal, { lbHr: 0.53, lb: '0.53', gph: 240 });
  assert.deepEqual(m.rows.map((r) => r.name), ['Ariel', 'Alberto (Junior)', 'José Luis', 'Gandiva (Yair)', 'Antonio']);
  assert.deepEqual(m.rows.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(m.rows[0], { rank: 1, name: 'Ariel', lb: '0.82', gph: 373, overGoal: true });
});

test('never more than 5, even if the API sends more', () => {
  const more = { ...LIVE, top: [...LIVE.top, P(6, 'Eduardo', 254, 0.56), P(7, 'Leobardo', 233, 0.51)] };
  const m = panelModel(more);
  assert.equal(TOP, 5);
  assert.equal(m.rows.length, 5);
  assert.ok(!m.rows.some((r) => r.name === 'Eduardo' || r.name === 'Leobardo'));
});

test('lb shows 2 decimals and grams whole numbers', () => {
  const m = panelModel({ ...LIVE, top: [P(1, 'A', 372.6, 0.8), P(2, 'B', 100, 0.2049)] });
  assert.equal(m.rows[0].lb, '0.80');
  assert.equal(m.rows[0].gph, 373);
  assert.equal(m.rows[1].lb, '0.20');
});

test('fewer than 5 ranked shows just those', () => {
  const m = panelModel({ ...LIVE, top: LIVE.top.slice(0, 3) });
  assert.equal(m.rows.length, 3);
});

test('no goal: no goal chip and nobody marked', () => {
  for (const room of [null, undefined, { goal: null }, { goal: { gph: null, lbHr: null } }, { goal: { lbHr: 0, gph: 0 } }]) {
    const m = panelModel({ ...LIVE, room });
    assert.equal(m.goal, null);
    assert.ok(m.rows.every((r) => r.overGoal === false));
  }
});

test('Toyota rule: below the goal is never marked, only over it', () => {
  const m = panelModel({ ...LIVE, room: { goal: { gph: 270, lbHr: 0.6 } } });
  assert.deepEqual(m.rows.map((r) => r.overGoal), [true, true, true, false, false]);
  for (const r of m.rows) assert.deepEqual(Object.keys(r).sort(), ['gph', 'lb', 'name', 'overGoal', 'rank']);
});

test('a failed, empty or malformed reply hides the panel', () => {
  for (const bad of [null, undefined, {}, { success: false, top: LIVE.top }, { success: true, top: [] },
    { success: true, day: null, top: [], room: null, days: [] }, { success: true, top: 'x' },
    { success: true, top: [{ name: '', lbHr: 0.5 }, { name: 'X' }, null] }]) {
    assert.equal(panelModel(bad), null, JSON.stringify(bad));
  }
});

test('the date comes from the data, never "yesterday"', () => {
  assert.equal(fmtDay('2026-11-17', 'en'), 'Tue, Nov 17');
  assert.match(fmtDay('2026-11-17', 'es'), /mar.*17.*nov/i);
  assert.equal(fmtDay(null, 'en'), '');
  assert.equal(fmtDay('nope', 'en'), '');
  assert.equal(panelModel({ ...LIVE, day: 'garbage' }).day, null);
  for (const l of Object.values(LABELS)) assert.ok(!/yesterday|ayer/i.test(JSON.stringify(l)));
});

test('timings: every 10 min for 30 s, constants hang together', () => {
  assert.equal(ROTATE_EVERY_MS, 10 * 60 * 1000);
  assert.equal(ROTATE_SHOW_MS, 30 * 1000);
  assert.equal(REFRESH_MS, 5 * 60 * 1000);
  assert.ok(PRELOAD_MS < ROTATE_EVERY_MS - ROTATE_SHOW_MS);
  assert.ok(READY_TIMEOUT_MS < PRELOAD_MS + ROTATE_SHOW_MS);
  assert.ok(IDLE_AFTER_INPUT_MS >= 30 * 1000);
});

const TV = { tvMode: true, rotateParam: null, embedded: false, width: 1920, hidden: false, busy: false, hasLeaders: true, sinceInputMs: 10 * 60 * 1000 };

test('the barn TV rotates', () => {
  assert.equal(shouldRotate(TV), true);
  assert.equal(shouldRotate({ ...TV, width: 3840 }), true);
  assert.equal(shouldRotate({ ...TV, tvMode: false, rotateParam: '1' }), true);   // a bookmark without TV Mode
});

test('nothing else rotates', () => {
  const no = {
    'not TV Mode': { tvMode: false },
    '?rotate=0': { rotateParam: '0' },
    '?rotate=0 beats ?rotate=1 style use': { tvMode: false, rotateParam: '0' },
    'phone in TV Mode': { width: 390 },
    'tablet': { width: 1024 },
    'embedded in the hub': { embedded: true },
    'tab in the background': { hidden: true },
    'a modal or report open': { busy: true },
    'crew board failed or empty': { hasLeaders: false },
    'someone touched it 5 s ago': { sinceInputMs: 5000 },
    'someone touched it 59 s ago': { sinceInputMs: IDLE_AFTER_INPUT_MS - 1000 },
  };
  for (const [why, f] of Object.entries(no)) assert.equal(shouldRotate({ ...TV, ...f }), false, why);
  assert.equal(shouldRotate({ ...TV, width: MIN_ROTATE_WIDTH }), true);
  assert.equal(shouldRotate(null), false);
  assert.equal(shouldRotate({}), false);
});

test('the crew board URL is the last-workday TV view in the scoreboard language', () => {
  assert.equal(crewBoardUrl('en'), 'crew-board.html?tv=1&view=day&lang=en');
  assert.equal(crewBoardUrl('es'), 'crew-board.html?tv=1&view=day&lang=es');
  assert.equal(crewBoardUrl(undefined), 'crew-board.html?tv=1&view=day&lang=es');
  assert.match(crewBoardUrl('en', 'http://localhost:5517/api'), /&api=http%3A%2F%2Flocalhost%3A5517%2Fapi$/);
  assert.equal(crewBoardUrl('en', 'https://evil.example/api'), 'crew-board.html?tv=1&view=day&lang=en');
  assert.equal(localApi('http://127.0.0.1:8787/api'), 'http://127.0.0.1:8787/api');
  assert.equal(localApi('http://localhost/api/x'), null);
});

test('EN and ES carry the same labels, and fill() keeps unknown keys visible', () => {
  assert.deepEqual(Object.keys(LABELS.en).sort(), Object.keys(LABELS.es).sort());
  for (const k of Object.keys(LABELS.en)) assert.ok(LABELS.es[k] && LABELS.en[k], k);
  assert.equal(fill(LABELS.es.ldrGoal, { lb: '0.53' }), 'Meta 0.53 lb/h');
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}');
});

test('the scoreboard page carries the panel, the overlay and the module', () => {
  const html = readFileSync(join(REPO, 'src/pages/scoreboard-v2.html'), 'utf8');
  assert.match(html, /id="leadersPanel"[^>]*hidden/);
  assert.match(html, /id="leadersOverlay"/);
  assert.match(html, /<script type="module" src="\.\.\/js\/scoreboard-v2\/leaders\.js\?h=[0-9a-f]{8}"><\/script>/);
  // the controller reads the public crewBoard action and never posts
  const js = readFileSync(join(REPO, 'src/js/scoreboard-v2/leaders.js'), 'utf8');
  assert.match(js, /action=crewBoard/);
  assert.ok(!/method:\s*'POST'/i.test(js));
});
