/**
 * The cells scoreboard (Koa 2026-11-18): the cell look on the cell hourly log.
 *
 *   · the big number counts the cells only; pace is judged on completed hours
 *   · a typed hour wins over the scale's auto value
 *   · only cells in use show; a cell is never red for low output, only as an
 *     andon (quality stop > not recording > basket waiting 15+ min)
 *   · no goal yet: no verdict, no bars
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
  LABELS, WAITING_HELP_MIN, slotBounds, pacificNow, goalFrom, topsGrid, cellsModel, fill,
} from '../src/js/scoreboard-cells/cells-logic.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOTS = ['7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM', '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM', '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM'];
const HOURS = [1, 1, 0.83, 1, 1, 0.5, 1, 0.83, 1, 0.33];
const DAY = '2026-11-19';
// 10:30 AM Pacific (PST = UTC-8)
const AT_1030 = Date.parse(`${DAY}T18:30:00Z`);
const roster = (n) => Array.from({ length: n }, (_, i) => ({ stationId: `table${i + 1}`, label: `Cell ${i + 1}`, lane: 'wholesale', sort: i + 1, active: true }));
const hourly = (over = {}) => ({ date: DAY, slots: SLOTS.map((slot, i) => ({ slot, hours: HOURS[i] })), roster: roster(4), rows: [], batches: [], room: [], auto: [], ...over });
const row = (id, i, tops, cultivar = 'Sour Lifter') => ({ stationId: id, slot: SLOTS[i], cultivar, tops, source: 'manual' });
const GOAL = { lbHr: 0.5, day: '2026-11-18' };

test('slots and the Pacific clock', () => {
  assert.deepEqual(slotBounds('7:00 AM – 8:00 AM'), { startMin: 420, endMin: 480 });
  assert.deepEqual(slotBounds('12:30 PM - 1:00 PM'), { startMin: 750, endMin: 780 });
  assert.deepEqual(slotBounds('4:00 PM — 4:30 PM'), { startMin: 960, endMin: 990 });
  assert.equal(slotBounds('nope'), null);
  assert.deepEqual(pacificNow(AT_1030), { day: DAY, min: 630 });
  // 11:30 PM Pacific is still the same Pacific day, though UTC has rolled over
  assert.equal(pacificNow(Date.parse('2026-11-20T07:30:00Z')).day, '2026-11-19');
});

test('the goal is the latest workday that has one', () => {
  const crew = { byDay: { '2026-11-16': { room: { goal: { lbHr: 0.77 } } }, '2026-11-17': { room: { goal: { lbHr: 0.53 } } }, '2026-11-18': { room: null } } };
  assert.deepEqual(goalFrom(crew), { lbHr: 0.53, day: '2026-11-17' });
  assert.equal(goalFrom(null), null);
  assert.equal(goalFrom({ byDay: {} }), null);
});

test('a typed hour wins over the scale\'s auto value', () => {
  const g = topsGrid(hourly({ rows: [row('table1', 0, 0.6)], auto: [{ stationId: 'table1', slot: SLOTS[0], tops: 0.4 }, { stationId: 'table1', slot: SLOTS[1], tops: 0.3 }] }));
  assert.equal(g.get('table1').get(SLOTS[0]), 0.6);
  assert.equal(g.get('table1').get(SLOTS[1]), 0.3);
});

test('the big number counts the cells; pace is judged on completed hours', () => {
  // two cells, 7-8 and 8-9 and 9-10 done at 10:30; 10-11 is running (auto so far)
  const h = hourly({
    rows: [row('table1', 0, 0.6), row('table1', 1, 0.6), row('table1', 2, 0.5), row('table2', 0, 0.4), row('table2', 1, 0.4), row('table2', 2, 0.4)],
    auto: [{ stationId: 'table1', slot: SLOTS[3], tops: 0.3, final: false }],
  });
  const m = cellsModel({ hourly: h, board: { cells: [], waiting: [] }, goal: GOAL, nowMs: AT_1030, day: DAY });
  assert.equal(m.hero.lb, 3.2);                     // every pound logged, the running hour too
  const hrs = 2 * (1 + 1 + 0.83);
  assert.equal(m.cellHours, Math.round(hrs * 10) / 10);
  assert.equal(m.hero.goalSoFar, Math.round(0.5 * hrs * 10) / 10);
  assert.equal(m.hero.delta, Math.round((2.9 - 0.5 * hrs) * 10) / 10);   // completed hours only (3.2 - 0.3 running)
  assert.equal(m.cells.length, 2);                   // cells 3 and 4 did nothing: not shown
  assert.ok(m.eod.projected > m.hero.lb);
  assert.ok(m.eod.goal > m.hero.goalSoFar);
});

test('only cells in use show, in roster order', () => {
  const h = hourly({ rows: [row('table3', 0, 0.5)] });
  const board = { cells: [{ stationId: 'table2', job: { phase: 'running', cultivar: 'Lifter', rounds: 2, tabletOnline: true } }], waiting: [] };
  const m = cellsModel({ hourly: h, board, goal: GOAL, nowMs: AT_1030, day: DAY });
  assert.deepEqual(m.cells.map((c) => c.no), ['2', '3']);
  assert.equal(m.cells[0].cultivar, 'Lifter');
  assert.equal(m.cells[0].rounds, 2);
});

test('a screen left on overnight or a basket from yesterday is not today', () => {
  const h = hourly();
  const board = {
    cells: [{ stationId: 'table1', job: { phase: 'running', cultivar: 'Lifter', rounds: 0, tabletOnline: false } }],
    // marked at 6:00 PM yesterday (Pacific), never collected
    waiting: [{ stationId: 'table2', label: 'Cell 2', at: Date.parse('2026-11-19T02:00:00Z') }],
  };
  const m = cellsModel({ hourly: h, board, goal: GOAL, nowMs: AT_1030, day: DAY });
  assert.equal(m.cells.length, 0);
  assert.equal(m.waiting.length, 0);
  assert.equal(m.hero.status, 'idle');
  // and a past day never shows today's live screens
  const live = { cells: [{ stationId: 'table1', notRecording: { riseG: 40 }, job: { phase: 'running', tabletOnline: true } }], waiting: [] };
  const past = cellsModel({ hourly: hourly({ rows: [row('table1', 0, 0.5)] }), board: live, goal: GOAL, nowMs: AT_1030, day: '2026-11-18' });
  assert.equal(past.cells[0].state, 'on');
  assert.equal(past.cells[0].flag, null);
});

test('Toyota rule: a slow cell is never red; red is only an andon', () => {
  // cell 1 far below the goal, cell 2 above it
  const h = hourly({ rows: [row('table1', 0, 0.1), row('table1', 1, 0.1), row('table2', 0, 0.9), row('table2', 1, 0.9)] });
  const m = cellsModel({ hourly: h, board: { cells: [], waiting: [] }, goal: GOAL, nowMs: AT_1030, day: DAY });
  const [slow, fast] = m.cells;
  assert.equal(slow.state, 'on');
  assert.equal(slow.flag, null);
  assert.equal(slow.overGoal, false);
  assert.equal(fast.overGoal, true);
  assert.ok(m.cells.every((c) => c.state !== 'help'));
});

test('andon order: quality stop, then not recording, then a basket waiting 15+ min', () => {
  const waitAt = (min) => AT_1030 - min * 60000;
  const h = hourly({
    roster: roster(5),
    rows: [1, 2, 3, 4, 5].map((n) => row(`table${n}`, 0, 0.5)),
    batches: [{ stationId: 'table1', batch: 1, quality: 'fail', alert: 'stop' }],
  });
  const board = {
    cells: [
      { stationId: 'table1', notRecording: { riseG: 50 } },
      { stationId: 'table2', notRecording: { riseG: 50 } },
    ],
    waiting: [
      { stationId: 'table2', label: 'Cell 2', at: waitAt(40) },
      { stationId: 'table3', label: 'Cell 3', at: waitAt(WAITING_HELP_MIN) },
      { stationId: 'table4', label: 'Cell 4', at: waitAt(WAITING_HELP_MIN - 1) },
    ],
  };
  const m = cellsModel({ hourly: h, board, goal: GOAL, nowMs: AT_1030, day: DAY });
  const by = Object.fromEntries(m.cells.map((c) => [c.no, c]));
  assert.equal(by['1'].flag.key, 'clStop');
  assert.equal(by['2'].flag.key, 'clNotRec');
  assert.deepEqual(by['3'].flag, { key: 'clBasket', m: WAITING_HELP_MIN });
  assert.equal(by['4'].state, 'on');                 // 14 min: not yet a call for help
  assert.equal(by['5'].state, 'on');
  assert.equal(m.waiting[0].label, 'Cell 2');        // longest wait first
  assert.equal(m.quality.stop, 1);
});

test('no goal yet: no verdict and no bars, the pounds still count', () => {
  const h = hourly({ rows: [row('table1', 0, 0.6), row('table1', 1, 0.6)] });
  const m = cellsModel({ hourly: h, board: { cells: [], waiting: [] }, goal: null, nowMs: AT_1030, day: DAY });
  assert.equal(m.hero.lb, 1.2);
  assert.equal(m.hero.status, 'nogoal');
  assert.equal(m.hero.delta, null);
  assert.ok(m.cells.every((c) => c.bar === null && c.overGoal === false));
  assert.equal(m.eod.goal, null);
});

test('nothing logged: waiting to start, nothing to project', () => {
  const m = cellsModel({ hourly: hourly(), board: { cells: [], waiting: [] }, goal: GOAL, nowMs: AT_1030, day: DAY });
  assert.equal(m.hero.status, 'idle');
  assert.equal(m.cells.length, 0);
  assert.equal(m.eod, null);
});

test('a past day counts every hour as done', () => {
  const h = hourly({ rows: [row('table1', 9, 0.2)] });
  const m = cellsModel({ hourly: h, board: { cells: [], waiting: [] }, goal: GOAL, nowMs: AT_1030, day: '2026-11-18' });
  assert.equal(m.isToday, false);
  assert.equal(m.cellHours, 0.3);
  assert.equal(m.chart.length, 1);
  assert.equal(m.chart[0].done, true);
});

test('the chart is lb per cell-hour, hour by hour', () => {
  const h = hourly({ rows: [row('table1', 0, 0.6), row('table2', 0, 0.4), row('table1', 2, 0.83)] });
  const m = cellsModel({ hourly: h, board: { cells: [], waiting: [] }, goal: GOAL, nowMs: AT_1030, day: DAY });
  assert.deepEqual(m.chart.map((c) => [c.label, c.rate]), [['7a', 0.5], ['9a', 1]]);
});

test('EN and ES carry the same labels', () => {
  assert.deepEqual(Object.keys(LABELS.en).sort(), Object.keys(LABELS.es).sort());
  for (const k of Object.keys(LABELS.en)) assert.ok(LABELS.en[k] && LABELS.es[k], k);
  assert.equal(fill(LABELS.es.clBasket, { m: 18 }), 'Canasta esperando · 18 min');
});

test('the page reads only public GETs and loads the shared Top 5', () => {
  const html = readFileSync(join(REPO, 'src/pages/scoreboard-cells.html'), 'utf8');
  assert.match(html, /scoreboard-v2\/leaders\.js\?h=[0-9a-f]{8}/);
  assert.match(html, /id="leadersOverlay"/);
  const js = readFileSync(join(REPO, 'src/js/scoreboard-cells/main.js'), 'utf8');
  for (const a of ['cellHourly', 'cellBoard', 'crewBoard']) assert.ok(js.includes(`'${a}'`), a);
  assert.ok(!/method:\s*'POST'/i.test(js));
});
