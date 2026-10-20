import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eodModel, hourTarget } from '../src/model.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// Cost figures for the two days. The fixtures were captured without the password;
// these were read from the live dashboard with the ops password on 2026-10-19.
const COSTS = {
  '2026-10-16': { laborCost: 4588.5, costPerLb: 21.84, topsCostPerLb: 27.51, smallsCostPerLb: 14.27 },
  '2026-10-15': { laborCost: 5322.66, costPerLb: 22.51, topsCostPerLb: 30.94, smallsCostPerLb: 12.81 },
};
const withCosts = (dashboard) => ({ ...dashboard, daily: dashboard.daily.map((day) => ({ ...day, ...COSTS[day.date] })) });

const args = {
  date: '2026-10-16',
  dashboard: withCosts(fixture('dashboard-2026-10-16.locked.json')),
  priorDay: withCosts(fixture('dashboard-2026-10-15.locked.json')),
  scoreboard: fixture('scoreboard-2026-10-16.json'),
  sacks: fixture('supersack-2026-10-16.json'),
  sackOut: fixture('sack-out-2026-10-20.json'), // the tracker is filled, so the scan-out is not used
  generatedAt: new Date('2026-10-17T00:05:00Z'), // 17:05 PDT on Oct 16
};
const m = eodModel(args);
const rows = args.scoreboard.scoreboard.hourlyRates;

test('end-of-day header', () => {
  assert.equal(m.kind, 'eod');
  assert.equal(m.costsLocked, false);
  assert.equal(m.eyebrow, 'Rogue Origin · End of day');
  assert.equal(m.title, 'Friday');
  assert.equal(m.sub, "Oct 16 · Sour Lifter '26 · 8.5 h logged");
  assert.equal(m.pill, 'Line crew peak 18 · 8 T · 9 B');
});

test('end-of-day hero tiles', () => {
  // todayPercentage 112.53 rounds to 113.
  assert.deepEqual(m.tiles[0], { label: 'Tops', value: '120', unit: 'lb', chips: [{ kind: 'good', text: '▲ 113% of target' }] });
  assert.deepEqual(m.tiles[1], { label: 'Rate', value: '1.62', unit: 'lb/hr', chips: [{ kind: 'good', text: '▲ +0.34 vs Thu' }] });
  assert.deepEqual(m.tiles[2], { label: '$ per lb tops', value: '$27.51', unit: '', chips: [{ kind: 'good', text: '▼ −$3.43 vs Thu' }] });
});

test('end-of-day percent chip turns ▼ and bands below 100', () => {
  const behind = structuredClone(args.scoreboard);
  behind.scoreboard.todayPercentage = 89.4;
  assert.deepEqual(eodModel({ ...args, scoreboard: behind }).tiles[0].chips, [{ kind: 'bad', text: '▼ 89% of target' }]);
  behind.scoreboard.todayPercentage = 95.2;
  assert.deepEqual(eodModel({ ...args, scoreboard: behind }).tiles[0].chips, [{ kind: 'warn', text: '▼ 95% of target' }]);
});

test('end-of-day chart: one bar per hourly row, sorted by slot start, target = the crew-adjusted hour target', () => {
  assert.equal(m.chart.title, 'Tops by hour');
  assert.equal(m.chart.legend, 'target, crew-adjusted');
  assert.equal(m.chart.sub, 'lb · rate under the hour');
  assert.equal(m.chart.cols.length, 10);
  assert.deepEqual(m.chart.cols.map((c) => c.label), ['7', '8', '9', '10', '11', '12½', '1', '2', '3', '4']);
  assert.deepEqual(m.chart.cols.map((c) => c.rate), ['1.65', '1.88', '1.64', '1.81', '1.96', '2.00', '1.85', '1.21', '2.21', '2.30']);
  assert.deepEqual(m.chart.cols.map((c) => c.lbs), [15, 15, 10.9, 15.6, 15.7, 8.1, 14.6, 10.2, 11.2, 3.8]);
  assert.ok(m.chart.cols.every((c) => c.kind === 'bar'));
  m.chart.cols.forEach((c, i) => assert.equal(c.target, hourTarget(rows[i])));
  const total = m.chart.cols.reduce((t, c) => t + c.target, 0);
  assert.ok(Math.abs(total - args.scoreboard.scoreboard.todayTarget) < 0.01);
});

test('end-of-day chart sorts rows that arrive out of order', () => {
  const shuffled = structuredClone(args.scoreboard);
  shuffled.scoreboard.hourlyRates.reverse();
  assert.deepEqual(eodModel({ ...args, scoreboard: shuffled }).chart, m.chart);
});

test('end-of-day mini row', () => {
  assert.deepEqual(m.minis, [
    { label: 'Smalls', value: '90', unit: 'lb', sub: '$14.27/lb' },
    { label: 'Supersacks', value: '20', unit: 'opened', sub: '700 lb raw · 6.0 tops/sack' },
    { label: 'Labor', value: '$4,589', unit: '', sub: 'all-in $38.21/lb' },
  ]);
});

test('end-of-day flags: Act from the note with its hour, crew drop, best full hour', () => {
  assert.deepEqual(m.flags, [
    { kind: 'bad', tag: 'Act', text: '2 PM: Bags stored below are very wet, spoilage risk, need a plan' },
    // Peak 8 trimmers; 70% is 5.6. The 3 PM row still had 6, the 4 PM row 5.
    { kind: 'warn', tag: 'Watch', text: 'Crew fell 8 → 5 trimmers after 4 PM' },
    // 4:00–4:30 (2.30) and 12:30–1:00 (2.00) are half slots, not hours.
    { kind: 'good', tag: 'Good', text: 'Best hour 3–4 at 2.21' },
  ]);
});

test('end-of-day has one Watch line: a warn note takes it over the crew drop, and Good still shows', () => {
  const noted = structuredClone(args.scoreboard);
  noted.scoreboard.hourlyRates[3].notes = 'El producto esta muy humedo y tiene mucha hoja ';
  assert.deepEqual(eodModel({ ...args, scoreboard: noted }).flags, [
    { kind: 'bad', tag: 'Act', text: '2 PM: Bags stored below are very wet, spoilage risk, need a plan' },
    { kind: 'warn', tag: 'Watch', text: '10 AM: Product is very wet and has a lot of leaf' },
    { kind: 'good', tag: 'Good', text: 'Best hour 3–4 at 2.21' },
  ]);
});

test('end-of-day crew line names the drop row note and the hours under target from the drop on', () => {
  const fell = structuredClone(args.scoreboard);
  fell.scoreboard.hourlyRates[7].notes = ''; // no Act note, so the Watch line is the crew drop
  const lastRow = fell.scoreboard.hourlyRates.at(-1);
  lastRow.notes = 'Hubo movimiento de personal a ultima hora ';
  lastRow.lbs = 2; // under its 2.61 lb target
  assert.deepEqual(eodModel({ ...args, scoreboard: fell }).flags, [
    // Generated facts first, the drop row's note last (capped at 40 characters, this one is 30).
    { kind: 'warn', tag: 'Watch', text: 'Crew fell 8 → 5 trimmers after 4 PM, 1 hour under target: Staff moved at the last minute' },
    { kind: 'good', tag: 'Good', text: 'Best hour 3–4 at 2.21' },
  ]);
});

test('end-of-day: no Good line when no slot is a full hour', () => {
  const halves = structuredClone(args.scoreboard);
  halves.scoreboard.hourlyRates = halves.scoreboard.hourlyRates.filter((row) => /^(12:30|4:00) PM/.test(row.timeSlot));
  assert.equal(halves.scoreboard.hourlyRates.length, 2);
  assert.ok(!eodModel({ ...args, scoreboard: halves }).flags.some((f) => f.kind === 'good'));
});

test('end-of-day: a day without cultivars[] names its cultivar field', () => {
  const plain = structuredClone(args.dashboard);
  delete plain.daily[0].cultivars;
  assert.equal(eodModel({ ...args, dashboard: plain }).sub, "Oct 16 · Sour Lifter '26 · 8.5 h logged");
});

test('end-of-day model needs generatedAt', () => {
  assert.throws(() => eodModel({ ...args, generatedAt: undefined }), /generatedAt/);
});

test('end-of-day: no crew line while the last hour keeps 70% of the peak', () => {
  const steady = structuredClone(args.scoreboard);
  steady.scoreboard.hourlyRates.at(-1).trimmers = 6;
  assert.deepEqual(eodModel({ ...args, scoreboard: steady }).flags.map((f) => f.tag), ['Act', 'Good']);
});

test('end-of-day locked costs: money becomes 🔒, nothing else changes', () => {
  const l = eodModel({ ...args, dashboard: fixture('dashboard-2026-10-16.locked.json'), priorDay: fixture('dashboard-2026-10-15.locked.json') });
  assert.equal(l.costsLocked, true);
  assert.deepEqual(l.tiles[2], { label: '$ per lb tops', value: '🔒', unit: '', chips: [] });
  assert.deepEqual(l.minis[0], { label: 'Smalls', value: '90', unit: 'lb', sub: 'locked' });
  assert.deepEqual(l.minis[2], { label: 'Labor', value: '🔒', unit: '', sub: 'locked' });
  assert.deepEqual(l.tiles.slice(0, 2), m.tiles.slice(0, 2));
  assert.deepEqual(l.minis[1], m.minis[1]);
  for (const key of ['kind', 'eyebrow', 'title', 'sub', 'pill', 'chart', 'flags', 'foot']) assert.deepEqual(l[key], m[key], key);
});

test('end-of-day cost chip needs a prior day with costs', () => {
  const l = eodModel({ ...args, priorDay: fixture('dashboard-2026-10-15.locked.json') });
  assert.deepEqual(l.tiles[2], { label: '$ per lb tops', value: '$27.51', unit: '', chips: [] });
  const none = eodModel({ ...args, priorDay: null });
  assert.deepEqual(none.tiles[1].chips, []);
  assert.deepEqual(none.tiles[2].chips, []);
});

test('end-of-day foot', () => {
  assert.deepEqual(m.foot, { left: 'cards/eod · dashboard allocation · $/lb tops', right: 'generated Fri Oct 16 · 17:05 PT' });
});

test('end-of-day model is null without hourly rows or with the API fallback shape', () => {
  const empty = structuredClone(args.scoreboard);
  empty.scoreboard.hourlyRates = [];
  assert.equal(eodModel({ ...args, scoreboard: empty }), null);
  assert.equal(eodModel({ ...args, dashboard: fixture('dashboard-2026-10-10.empty.json') }), null);
});

test('end-of-day model leaves its inputs alone', () => {
  const before = structuredClone(args);
  eodModel(args);
  assert.deepEqual(args, before);
});

test('end-of-day best hour needs at least half the peak crew', () => {
  // Oct 19 with a 3–4 PM hour worked by one trimmer at 2.77: it must not beat 9–10 at 2.14 on eight.
  const sb = fixture('scoreboard-2026-10-19.json');
  const rows = sb.scoreboard.hourlyRates;
  rows.push({ ...rows.at(-1), timeSlot: '3:00 PM – 4:00 PM', trimmers: 1, effectiveTrimmers: 1, buckers: 1, lbs: 2.77, rate: 2.77, notes: '' });
  const oct19 = { ...args, date: '2026-10-19', dashboard: fixture('dashboard-2026-10-19.locked.json'), priorDay: fixture('dashboard-2026-10-16.locked.json'), scoreboard: sb, sacks: fixture('supersack-2026-10-19.json') };
  assert.deepEqual(eodModel(oct19).flags.at(-1), { kind: 'good', tag: 'Good', text: 'Best hour 9–10 at 2.14' });
  // Four of a peak of eight is half: that hour still counts.
  rows.at(-1).trimmers = 4;
  assert.deepEqual(eodModel(oct19).flags.at(-1), { kind: 'good', tag: 'Good', text: 'Best hour 3–4 at 2.77' });
});

test('end-of-day note flags cap the note at 72 characters at a word boundary; the hour prefix is not counted', () => {
  const long = structuredClone(args.scoreboard);
  long.scoreboard.hourlyRates[3].notes = 'El producto esta muy humedo y tiene mucha hoja y los costales vienen mal amarrados desde el campo';
  const watch = eodModel({ ...args, scoreboard: long }).flags.find((f) => f.kind === 'warn');
  assert.equal(watch.text, '10 AM: Product is very wet and has a lot of leaf and los sacks vienen mal…');
  assert.equal(watch.text.slice('10 AM: '.length).length, 67);
});

test('end-of-day crew line: a long drop-row note is capped at 40 characters, the count and hours always whole', () => {
  const fell = structuredClone(args.scoreboard);
  fell.scoreboard.hourlyRates[7].notes = '';
  const lastRow = fell.scoreboard.hourlyRates.at(-1);
  lastRow.notes = 'Hubo movimiento de personal a ultima hora y se fueron a colgar al granero del norte';
  lastRow.lbs = 2;
  const watch = eodModel({ ...args, scoreboard: fell }).flags.find((f) => f.kind === 'warn');
  assert.equal(watch.text, 'Crew fell 8 → 5 trimmers after 4 PM, 1 hour under target: Staff moved at the last minute and se…');
});

test('end-of-day crew line is singular at one trimmer', () => {
  const one = structuredClone(args.scoreboard);
  one.scoreboard.hourlyRates.at(-1).trimmers = 1;
  assert.equal(eodModel({ ...args, scoreboard: one }).flags.find((f) => f.kind === 'warn').text, 'Crew fell 8 → 1 trimmer after 4 PM');
});

test('end-of-day supersacks: the tracker when it has the day, else the scan-out count', () => {
  assert.deepEqual(m.minis[1], { label: 'Supersacks', value: '20', unit: 'opened', sub: '700 lb raw · 6.0 tops/sack' });
  const unfilled = eodModel({ ...args, sacks: fixture('supersack-2026-10-19.json') });
  assert.deepEqual(unfilled.minis[1], { label: 'Supersacks', value: '10', unit: 'scanned', sub: 'tracker not filled yet' });
  const none = eodModel({ ...args, sacks: fixture('supersack-2026-10-19.json'), sackOut: fixture('sack-out-2026-10-18.empty.json') });
  assert.deepEqual(none.minis[1], { label: 'Supersacks', value: '0', unit: 'scanned', sub: 'tracker not filled yet' });
  const blind = eodModel({ ...args, sacks: fixture('supersack-2026-10-19.json'), sackOut: undefined });
  assert.deepEqual(blind.minis[1], { label: 'Supersacks', value: '—', unit: '', sub: 'tracker empty' });
});
