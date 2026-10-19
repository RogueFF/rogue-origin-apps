import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { middayModel } from '../src/model.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const args = {
  date: '2026-10-19',
  scoreboard: fixture('scoreboard-2026-10-19.json'),
  dashboardToday: fixture('dashboard-2026-10-19.locked.json'),
  priorDay: fixture('dashboard-2026-10-16.locked.json'),
  sacks: fixture('supersack-2026-10-19.json'),
  generatedAt: new Date('2026-10-19T22:55:00Z'), // 15:55 PDT
};
const m = middayModel(args);
const withRows = (edit) => {
  const scoreboard = structuredClone(args.scoreboard);
  edit(scoreboard.scoreboard);
  return middayModel({ ...args, scoreboard });
};

test('midday header', () => {
  assert.equal(m.kind, 'midday');
  assert.equal(m.costsLocked, true);
  assert.equal(m.eyebrow, 'Rogue Origin · Midday check');
  assert.equal(m.title, 'Monday');
  assert.equal(m.sub, "Oct 19 · Sour Lifter '26 · through 15:00");
  assert.equal(m.pill, 'Line crew 3 T · 2 B · 1 TZ');
});

test('midday hero tiles', () => {
  assert.deepEqual(m.tiles, [
    // Σ lbs = 86.5, which fmtInt rounds half up.
    { label: 'Tops so far', value: '87', unit: 'lb', chips: [{ kind: 'good', text: '▲ 114% of target' }] },
    // 86.5 ÷ Σ(effectiveTrimmers × multiplier) 48.04 = 1.80; targetRate 1.5835.
    { label: 'Rate', value: '1.80', unit: 'lb/hr', chips: [{ kind: 'good', text: '▲ target 1.58' }] },
    { label: 'Projected end of day', value: '93', unit: 'lb', chips: [{ kind: 'neutral', text: 'Fri closed at 120' }] },
  ]);
});

test('midday rate chip is bad under the target rate', () => {
  const slow = withRows((sb) => { sb.targetRate = 1.95; });
  assert.deepEqual(slow.tiles[1].chips, [{ kind: 'bad', text: '▼ target 1.95' }]);
});

test('midday chart: the logged hours plus a "now" column at the current hour target', () => {
  assert.equal(m.chart.title, 'Tops by hour');
  assert.equal(m.chart.legend, 'target, crew-adjusted');
  assert.equal(m.chart.sub, 'lb · rate under the hour');
  assert.equal(m.chart.cols.length, 9);
  assert.deepEqual(m.chart.cols.map((c) => c.label), ['7', '8', '9', '10', '11', '12½', '1', '2', '3']);
  assert.deepEqual(m.chart.cols.map((c) => c.rate), ['1.77', '1.81', '2.14', '1.99', '1.89', '1.20', '1.35', '1.33', '—']);
  assert.deepEqual(m.chart.cols.map((c) => c.lbs), [15.6, 14.5, 14.2, 15.9, 15.1, 3, 4.2, 4, 0]);
  assert.deepEqual(m.chart.cols.map((c) => c.kind), ['bar', 'bar', 'bar', 'bar', 'bar', 'bar', 'bar', 'bar', 'now']);
  const { target, ...now } = m.chart.cols[8];
  assert.deepEqual(now, { label: '3', rate: '—', lbs: 0, kind: 'now' });
  assert.ok(Math.abs(target - 3.94) < 0.01, `now target ${target}`);
});

test('midday chart has no "now" column when the current hour has no target', () => {
  const closed = withRows((sb) => { sb.currentHourTarget = 0; });
  assert.equal(closed.chart.cols.length, 8);
  assert.ok(closed.chart.cols.every((c) => c.kind === 'bar'));
});

test('midday mini row', () => {
  assert.deepEqual(m.minis, [
    { label: 'Smalls so far', value: '80', unit: 'lb', sub: '' },
    // Last hour: 2 buckers for 3 trimmers.
    { label: 'Buckers per trimmer', value: '0.67', unit: '', sub: 'band 0.70–0.75, fed' },
    { label: 'Hours logged', value: '7.3', unit: 'of 8.5', sub: 'sacks logged: 0' },
  ]);
});

test('midday buckers per trimmer: short below 0.65, idle above 0.85', () => {
  const short = withRows((sb) => { sb.hourlyRates.at(-1).buckers = 1; });
  assert.deepEqual(short.minis[1], { label: 'Buckers per trimmer', value: '0.33', unit: '', sub: 'band 0.70–0.75, short' });
  const idle = withRows((sb) => { sb.hourlyRates.at(-1).buckers = 3; });
  assert.deepEqual(idle.minis[1], { label: 'Buckers per trimmer', value: '1.00', unit: '', sub: 'band 0.70–0.75, idle' });
});

test('midday flags: crew drop with its floor note, no sacks yet, a morning above target', () => {
  assert.deepEqual(m.flags, [
    // Peak 8 → 3 trimmers; the 12:30 row (5) is the first under 5.6 and carries the note; 12½, 1 and 2 are under target.
    { kind: 'warn', tag: 'Watch', text: 'Crew fell 8 → 3 trimmers after 12½: Staff moved at the last minute, 3 hours under target' },
    { kind: 'warn', tag: 'Watch', text: 'No supersacks logged on the tracker yet today' },
    { kind: 'good', tag: 'Good', text: 'Morning above target every hour, best 2.14 at 9' },
  ]);
});

test('midday crew drop without an explaining note', () => {
  const quiet = withRows((sb) => { for (const row of sb.hourlyRates) row.notes = ''; });
  assert.equal(quiet.flags[0].text, 'Crew fell 8 → 3 trimmers after 12½, 3 hours under target');
});

test('midday Good: every hour above target so far', () => {
  const morning = withRows((sb) => { sb.hourlyRates = sb.hourlyRates.slice(0, 5); });
  assert.deepEqual(morning.flags, [
    { kind: 'warn', tag: 'Watch', text: 'No supersacks logged on the tracker yet today' },
    { kind: 'good', tag: 'Good', text: 'Every hour above target so far, best 2.14 at 9' },
  ]);
});

test('midday: no Good when the line fell under target before the fourth hour', () => {
  const early = withRows((sb) => { sb.hourlyRates[1].lbs = 5; });
  assert.ok(!early.flags.some((f) => f.kind === 'good'));
});

test('midday: no "no supersacks" line once sacks are logged, or before 10:00', () => {
  const sacked = middayModel({ ...args, sacks: fixture('supersack-2026-10-16.json') });
  assert.equal(sacked.minis[2].sub, 'sacks logged: 20');
  assert.ok(!sacked.flags.some((f) => /supersacks/.test(f.text)));
  const early = withRows((sb) => { sb.hourlyRates = sb.hourlyRates.slice(0, 2); }); // through 9:00
  assert.ok(!early.flags.some((f) => /supersacks/.test(f.text)));
});

test('midday: floor notes flag with their hour, Act and Watch ahead of Good', () => {
  const noted = withRows((sb) => {
    sb.hourlyRates[2].notes = 'trae un poquito de mold  y algunos gusanos ';
    sb.hourlyRates[3].notes = 'se pueden echar a perder';
  });
  assert.deepEqual(noted.flags, [
    { kind: 'bad', tag: 'Act', text: '10 AM: Spoilage risk' },
    { kind: 'warn', tag: 'Watch', text: '9 AM: A bit of mold and some worms' },
    { kind: 'warn', tag: 'Watch', text: 'Crew fell 8 → 3 trimmers after 12½: Staff moved at the last minute, 3 hours under target' },
  ]);
});

test('midday foot', () => {
  assert.deepEqual(m.foot, { left: 'cards/midday · scoreboard target · $/lb at close', right: 'generated Mon Oct 19 · 15:55 PT' });
});

test('midday model is null without hourly rows', () => {
  assert.equal(withRows((sb) => { sb.hourlyRates = []; }), null);
});

test('midday model leaves its inputs alone', () => {
  const before = structuredClone(args);
  middayModel(args);
  assert.deepEqual(args, before);
});
