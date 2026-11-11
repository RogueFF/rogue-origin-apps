// The "Cell 1 · Phase 1" card: the model from cellDay JSON, its verdicts against
// the exit test, and a real render that fits the 1080x1350 card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cellModel, verdict, stripDates, shiftDays, breakEvenFor, phaseSoFar, dayCultivar } from '../src/cell-model.js';
import { nodeRuntime } from '../src/runtime-node.mjs';
import { renderPng } from '../src/render.js';
import { cardTree, CANVAS } from '../src/layout.js';
import { makeApp } from '../src/app.js';

// Synthetic, shaped like the API's cellDay (workers/src/handlers/production/cell-day.js).
const slot = (a, b) => `${a} – ${b}`;
function cellDay(over = {}) {
  return {
    stationId: 'table1', label: 'Cell 1', date: '2026-11-12',
    tops: {
      lb: 4.02, workedH: 7.67, perHour: 0.52,
      hourly: [
        ['7:00 AM', '8:00 AM', 0.41, 1], ['8:00 AM', '9:00 AM', 0.55, 1], ['9:00 AM', '10:00 AM', 0.48, 0.83],
        ['10:00 AM', '11:00 AM', 0.6, 1], ['11:00 AM', '12:00 PM', 0.57, 1], ['12:30 PM', '1:00 PM', 0.22, 0.5],
        ['1:00 PM', '2:00 PM', 0.58, 1], ['2:00 PM', '3:00 PM', 0.39, 0.83], ['3:00 PM', '4:00 PM', 0.22, 1],
      ].map(([a, b, lb, hours], i) => ({ slot: slot(a, b), hours, lb, scaleLb: lb, typedLb: i === 3 ? lb : null, source: i === 3 ? 'typed' : 'scale', final: true, flag: null, cultivar: null })),
    },
    jobs: Array.from({ length: 8 }, (_, i) => ({ at: 0, g: 227, cultivar: '2026 - Sour Lifter / Sungrown', bag: 'hLb', cycleS: 2400 + i * 60, jobId: null })),
    changeovers: { list: [], count: 7, medianS: 95, maxS: 412, startG: 1 },
    gaps: { offline: { count: 0, minutes: 0, episodes: [] }, notRecording: { count: 0, minutes: 0, episodes: [] } },
    quality: { batches: 8, pass: 7, redo: 1, stop: 0 },
    sacks: { list: [{ sackId: '26-SL-1', cultivar: '2026 - Sour Lifter / Sungrown', lbs: 35, fillLbs: null }], count: 1, lb: 35 },
    eod: { rawG: 6577, toteG: 680, carryInG: 0, carryFrom: null },
    yield: { sacksLb: 35, carryInLb: 0, rawInLb: 35, eodRawLb: 14.5, usedLb: 20.5, toteLb: 1.5, topsPerSack: 6.86, sackLbs: 35 },
    battery: { pct: 64, mv: 3830, at: 0, from: 'eod' },
    ...over,
  };
}
const GEN = new Date('2026-11-13T01:05:00Z');   // Thu 5:05 PM PT

test('Phase 1 days are the 5 shift days from Thu 11/12; outside it, the 5 shift days to the date', () => {
  assert.deepEqual(shiftDays('2026-11-12', 5), ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18']);
  assert.deepEqual(stripDates('2026-11-16'), shiftDays('2026-11-12', 5));
  assert.deepEqual(stripDates('2026-11-24'), ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24']);
});

test('break-even by cultivar: Sour Lifter 6.4/6.8, Lifter 8.8/9.1, others on Sour Lifter until measured', () => {
  assert.deepEqual([breakEvenFor('2026 - Sour Lifter / Sungrown').at, breakEvenFor('2026 - Lifter / Sungrown').both], [6.4, 9.1]);
  assert.equal(breakEvenFor('2026 - Strawberry Doughnuts / Sungrown').measured, false);
  assert.equal(dayCultivar(cellDay()), '2026 - Sour Lifter / Sungrown');
});

test('verdict tiers: both prices, the higher only, under, and no weigh; any gap fails the day', () => {
  const y = (tps) => verdict(cellDay({ yield: { ...cellDay().yield, topsPerSack: tps } }));
  assert.deepEqual([y(6.86).yield, y(6.86).pass], ['both', true]);
  assert.deepEqual([y(6.5).yield, y(6.5).pass], ['at', true]);
  assert.deepEqual([y(6.1).yield, y(6.1).pass], ['under', false]);
  assert.deepEqual([y(null).yield, y(null).pass], ['none', false]);
  const gap = verdict(cellDay({ gaps: { offline: { count: 1, minutes: 6, episodes: [] }, notRecording: { count: 0, minutes: 0, episodes: [] } } }));
  assert.deepEqual([gap.clean, gap.pass, gap.gaps.minutes], [false, false, 6]);
});

test('the card: big numbers, hourly bars with their own caps, the 5-day strip, and phase so far', () => {
  const strip = shiftDays('2026-11-12', 5).map((date, i) => ({ date, day: i === 0 ? cellDay() : null }));
  const m = cellModel({ date: '2026-11-12', day: cellDay(), strip, generatedAt: GEN });
  assert.equal(m.kind, 'cell');
  assert.equal(m.eyebrow, 'Cell 1 · Phase 1 · Day 1 of 5');
  assert.equal(m.pill, 'EXIT TEST: PASS');
  assert.deepEqual(m.tiles.map((t) => t.value), ['4.02', '6.86', '0']);
  assert.equal(m.tiles[1].chips[0].kind, 'good');
  assert.deepEqual(m.chart.cols.slice(0, 3).map((c) => [c.label, c.cap]), [['7', '0.41'], ['8', '0.55'], ['9', '0.48']]);
  assert.equal(m.chart.cols[3].rate, 'typed');
  assert.deepEqual(m.minis.map((x) => x.value), ['1:35', '1', '20.50', '64']);
  assert.deepEqual(m.strip.map((s) => s.value), ['6.9', '—', '—', '—', '—', '6.9']);
  assert.deepEqual([m.strip[5].label, m.strip[5].sub, m.strip[5].kind], ['So far', '1 day', 'good']);
  assert.deepEqual(m.flags, [{ kind: 'good', tag: 'Good', text: 'No recording gaps, and verified tops/sack above break-even' }]);
  assert.equal(phaseSoFar(strip.map((s) => s.day)).topsPerSack, Math.round((4.02 * 35 / 20.5) * 100) / 100);
});

test('no EOD weigh: NOT YET, never a pass; a gap is named with its time', () => {
  const day = cellDay({
    yield: { ...cellDay().yield, eodRawLb: null, usedLb: null, topsPerSack: null },
    gaps: { offline: { count: 1, minutes: 6, episodes: [{ kind: 'offline', fromMs: Date.parse('2026-11-12T19:00:00Z'), toMs: Date.parse('2026-11-12T19:06:00Z'), minutes: 6 }] }, notRecording: { count: 0, minutes: 0, episodes: [] } },
  });
  const m = cellModel({ date: '2026-11-12', day, strip: [], generatedAt: GEN });
  assert.match(m.pill, /NOT YET/);
  assert.equal(m.tiles[1].value, '—');
  assert.deepEqual(m.flags[0], { kind: 'bad', tag: 'Gap', text: 'Scale offline 11:00 AM, 6 min' });
});

test('nothing recorded: no card (the route answers 204)', () => {
  assert.equal(cellModel({ date: '2026-11-14', day: cellDay({ tops: { lb: 0, workedH: 0, perHour: null, hourly: [] }, jobs: [] }), generatedAt: GEN }), null);
  assert.equal(cellModel({ date: '2026-11-14', day: null, generatedAt: GEN }), null);
});

test('route /cell: fetches the day and the strip days before it, never days to come; bad station 400', async () => {
  const asked = [];
  const api = { cellDay: async (station, date) => { asked.push([station, date]); return cellDay({ date }); } };
  const app = makeApp({ api, runtime: async () => { throw new Error('no png in this test'); }, now: () => new Date('2026-11-13T23:00:00Z') });
  const res = await app.fetch(new Request('https://cards.test/cell?format=json'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Card'), 'cell');
  assert.deepEqual(asked.sort(), [['table1', '2026-11-12'], ['table1', '2026-11-13']]);
  assert.equal((await app.fetch(new Request('https://cards.test/cell?station=../x'))).status, 400);
});

test('renders the cell card as a 1080x1350 PNG; sections stack and the foot stays on the card', async () => {
  const rt = await nodeRuntime();
  const strip = shiftDays('2026-11-12', 5).map((date, i) => ({ date, day: i < 3 ? cellDay({ yield: { ...cellDay().yield, topsPerSack: [6.86, 6.5, 6.1][i] } }) : null }));
  const day = cellDay({
    gaps: { offline: { count: 1, minutes: 6, episodes: [{ kind: 'offline', fromMs: Date.parse('2026-11-12T19:00:00Z'), toMs: Date.parse('2026-11-12T19:06:00Z'), minutes: 6 }] }, notRecording: { count: 1, minutes: 4, episodes: [{ kind: 'untracked', fromMs: Date.parse('2026-11-12T22:10:00Z'), toMs: Date.parse('2026-11-12T22:14:00Z'), minutes: 4 }] } },
  });
  const m = cellModel({ date: '2026-11-16', day, strip, generatedAt: GEN });
  const nodes = [];
  await rt.satori(cardTree(m), { width: CANVAS.width, height: CANVAS.height, fonts: rt.fonts, onNodeDetected: (n) => nodes.push(n) });
  const sec = (name) => nodes.find((n) => n.props?.['data-section'] === name);
  let prev = 0;
  for (const name of ['head', 'tiles', 'chart', 'minis', 'strip', 'flags', 'foot']) {
    const s = sec(name);
    assert.ok(s, name);
    assert.ok(s.top >= prev - 1, `${name} starts below the one before`);
    prev = s.top + s.height;
  }
  assert.ok(prev <= CANVAS.height - 12, 'the foot stays on the card');
  const styleErrors = [];
  const png = await renderPng(cardTree(m), { fonts: rt.fonts, satori: rt.satori, resvg: rt.Resvg, onStyleError: (e) => styleErrors.push(e.message) });
  assert.deepEqual(styleErrors, []);
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('./out/cell.png', import.meta.url), png);
  const view = new DataView(png.buffer, png.byteOffset);
  assert.deepEqual([view.getUint32(16), view.getUint32(20)], [CANVAS.width, CANVAS.height]);
});

test('carry-in unknown (the day before had raw, no weigh): NOT YET with the reason', () => {
  const day = cellDay({ yield: { ...cellDay().yield, carryKnown: false, rawInLb: null, usedLb: null, topsPerSack: null } });
  const m = cellModel({ date: '2026-11-13', day, strip: [], generatedAt: GEN });
  assert.equal(m.pill, 'NOT YET: no carry-in weigh');
  assert.equal(m.flags[0].tag, 'Raw');
});
