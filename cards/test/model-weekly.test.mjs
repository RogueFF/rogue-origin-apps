import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weeklyModel } from '../src/model.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// W41 cost figures. The W41 fixture was captured without the password; these
// were read from the live dashboard with the ops password on 2026-10-19.
const W41_COSTS = {
  '2026-10-05': { laborCost: 1730.52, costPerLb: 28.14, topsCostPerLb: 35.33, smallsCostPerLb: 20.59 },
  '2026-10-06': { laborCost: 2307.36, costPerLb: 20.29, topsCostPerLb: 30.99, smallsCostPerLb: 10.72 },
  '2026-10-08': { laborCost: 1179.9, costPerLb: 20.77, topsCostPerLb: 28.43, smallsCostPerLb: 14.08 },
  '2026-10-09': { laborCost: 1546.98, costPerLb: 42.97, topsCostPerLb: 50.2, smallsCostPerLb: 24.18 },
};
const withCosts = (dashboard, costs) => ({
  ...dashboard,
  daily: dashboard.daily.map((day) => ({ ...day, ...costs[day.date] })),
});

const scoreboards = Object.fromEntries(
  ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((ymd) => [ymd, fixture(`scoreboard-${ymd}.json`)]),
);
const args = {
  week: '2026-W42',
  dashboard: fixture('dashboard-2026-W42.unlocked.json'),
  prior: withCosts(fixture('dashboard-2026-W41.locked.json'), W41_COSTS),
  scoreboards,
  sacks: fixture('supersack-2026-W42.json'),
  generatedAt: new Date('2026-10-19T13:05:00Z'),
};
const m = weeklyModel(args);

test('weekly header', () => {
  assert.equal(m.kind, 'weekly');
  assert.equal(m.costsLocked, false);
  assert.equal(m.eyebrow, 'Rogue Origin · Weekly production');
  assert.equal(m.title, 'Week 42');
  assert.equal(m.sub, "Oct 12–16, 2026 · Sour Lifter '26 · 4 days");
  assert.equal(m.pill, 'Line crew 18–27 · avg 22');
});

test('weekly hero tiles: weighted week figures, deltas vs the prior week, % of the scoreboard targets', () => {
  // 497.2 lb of tops vs W41's 137.7; 497.2 ÷ 506.17 summed todayTarget = 98%.
  assert.deepEqual(m.tiles[0], {
    label: 'Tops', value: '497', unit: 'lb',
    chips: [{ kind: 'good', text: '▲ +261% vs W41' }, { kind: 'warn', text: '98% target' }],
  });
  // 497.2 ÷ 377 trimmer hours = 1.319; W41 137.7 ÷ 119 = 1.157.
  assert.deepEqual(m.tiles[1], { label: 'Rate', value: '1.32', unit: 'lb/hr', chips: [{ kind: 'good', text: '▲ +0.16 vs W41' }] });
  // Σ(topsCostPerLb × tops) ÷ Σ tops: 30.2828 vs 35.1173. The chip is the change between the two
  // numbers as shown ($30.28 vs $35.12), so it reads 4.84, not the raw 4.8345 → 4.83.
  assert.deepEqual(m.tiles[2], { label: '$ per lb tops', value: '$30.28', unit: '', chips: [{ kind: 'good', text: '▼ −$4.84 vs W41' }] });
});

test('weekly cost chip needs a prior with costs; the value stays', () => {
  const noPriorCosts = weeklyModel({ ...args, prior: fixture('dashboard-2026-W41.locked.json') });
  assert.deepEqual(noPriorCosts.tiles[2], { label: '$ per lb tops', value: '$30.28', unit: '', chips: [] });
  assert.deepEqual(noPriorCosts.tiles[1].chips, [{ kind: 'good', text: '▲ +0.16 vs W41' }]);
  const noPrior = weeklyModel({ ...args, prior: null });
  assert.deepEqual(noPrior.tiles[0].chips, [{ kind: 'warn', text: '98% target' }]);
  assert.deepEqual(noPrior.tiles[1].chips, []);
  assert.deepEqual(noPrior.tiles[2].chips, []);
});

test('weekly chart: five weekday columns, Monday off, ticks from the scoreboard targets', () => {
  assert.equal(m.chart.title, 'Tops by day');
  assert.equal(m.chart.legend, 'target, crew-adjusted');
  assert.equal(m.chart.sub, 'lb · rate under the day');
  assert.equal(m.chart.cols.length, 5);
  assert.deepEqual(m.chart.cols[0], { label: 'Mon', rate: '—', lbs: 0, target: 0, kind: 'off' });
  const { target, ...tue } = m.chart.cols[1];
  assert.deepEqual(tue, { label: 'Tue', rate: '1.08', lbs: 110.8, kind: 'bar' });
  assert.ok(Math.abs(target - 124.1788853484901) < 0.01, `Tue target ${target}`);
  assert.deepEqual(m.chart.cols.map((c) => c.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual(m.chart.cols.map((c) => c.rate), ['—', '1.08', '1.38', '1.28', '1.62']);
  assert.deepEqual(m.chart.cols.map((c) => c.lbs), [0, 110.8, 139.8, 126.5, 120.1]);
  assert.deepEqual(m.chart.cols.map((c) => c.kind), ['off', 'bar', 'bar', 'bar', 'bar']);
});

test('weekly mini row', () => {
  assert.deepEqual(m.minis, [
    { label: 'Smalls', value: '429', unit: 'lb', sub: '$12.76/lb' },
    { label: 'Supersacks', value: '88', unit: 'opened', sub: '3,080 lb raw · 5.6 tops/sack' },
    { label: 'Labor', value: '$20,530', unit: '', sub: 'all-in $41.29/lb' },
  ]);
});

test('weekly flags: latest Act, one Watch summarising the warn themes, best day as Good', () => {
  assert.deepEqual(m.flags, [
    { kind: 'bad', tag: 'Act', text: 'Fri: Bags stored below are very wet, spoilage risk, need a plan' },
    // Tue's note has mold + worms; Thu's has moisture + leaf + worms. Fri's wet bags are the Act note.
    { kind: 'warn', tag: 'Watch', text: 'Mold, worms, moisture and leaf flagged Tue–Thu' },
    // Rates 1.08 → 1.38 → 1.28 → 1.62 did not rise all week; Wed had the most tops.
    { kind: 'good', tag: 'Good', text: 'Best day Wed, 140 lb at 1.38' },
  ]);
});

test('weekly Good says "Rate rose all week" only when every worked day is at or above the one before', () => {
  const rising = structuredClone(args.dashboard);
  rising.daily.find((d) => d.date === '2026-10-15').trimmerHours = 90; // Thu 126.5 ÷ 90 = 1.41 > Wed 1.38
  assert.deepEqual(weeklyModel({ ...args, dashboard: rising }).flags.at(-1), { kind: 'good', tag: 'Good', text: 'Rate rose all week' });
});

/** The scoreboards with every hourly note cleared, then `notes` ({ ymd: { rowIndex: text } }) written in. */
const scoreboardsWithNotes = (notes) => {
  const copy = structuredClone(scoreboards);
  for (const [ymd, { scoreboard }] of Object.entries(copy)) {
    scoreboard.hourlyRates.forEach((row, i) => { row.notes = notes[ymd]?.[i] ?? ''; });
  }
  return copy;
};

test('weekly notes come from the scoreboard rows, one note per hour, not the dashboard blob', () => {
  const blank = structuredClone(args.dashboard);
  for (const day of blank.daily) day.notes = '';
  assert.deepEqual(weeklyModel({ ...args, dashboard: blank }).flags, m.flags);
  const quiet = weeklyModel({ ...args, scoreboards: scoreboardsWithNotes({}) });
  assert.deepEqual(quiet.flags, [{ kind: 'good', tag: 'Good', text: 'Best day Wed, 140 lb at 1.38' }]);
});

test('weekly Watch: one theme on one day prints without a list or a range', () => {
  const one = scoreboardsWithNotes({ '2026-10-14': { 3: '[Crew change 9:35 AM: T-Zero : 1 → 0],Tiene mucho gusano ' } });
  assert.deepEqual(weeklyModel({ ...args, scoreboards: one }).flags, [
    { kind: 'warn', tag: 'Watch', text: 'Worms flagged Wed' },
    { kind: 'good', tag: 'Good', text: 'Best day Wed, 140 lb at 1.38' },
  ]);
});

test('weekly: a day without a scoreboard falls back to the comma-joined dashboard notes', () => {
  // The API joins a day's notes with bare commas (GROUP_CONCAT), and a crew-change
  // marker carries commas of its own, so markers come out before the split.
  const dashboard = structuredClone(args.dashboard);
  dashboard.daily.find((d) => d.date === '2026-10-16').notes = '[Crew change 10:06 AM: Buckers : 10 → 3, Podadores : 10 → 4]'
    + ',trae mucho mold y esta mix ,las volsas  que quedaron a vajo estan muy humedas  piensen que se va aser  porque se pueden echar a perder ';
  const { '2026-10-16': fri, ...others } = scoreboards;
  assert.ok(fri);
  const flags = weeklyModel({ ...args, dashboard, scoreboards: others }).flags;
  assert.deepEqual(flags.slice(0, 2), [
    { kind: 'bad', tag: 'Act', text: 'Fri: Bags stored below are very wet, spoilage risk, need a plan' },
    { kind: 'warn', tag: 'Watch', text: 'Mold, worms, moisture and leaf flagged Tue–Fri' },
  ]);
});

test('weekly with no scoreboards reads every day from the dashboard blobs and flags the same', () => {
  assert.deepEqual(weeklyModel({ ...args, scoreboards: {} }).flags, m.flags);
});

test('weekly rate skips a day with no trimmer hours from both sums', () => {
  const dashboard = structuredClone(args.dashboard);
  dashboard.daily.find((d) => d.date === '2026-10-13').trimmerHours = 0;
  const z = weeklyModel({ ...args, dashboard });
  // (497.2 − 110.8) ÷ (377 − 103) = 1.41; W41 1.16.
  assert.deepEqual(z.tiles[1], { label: 'Rate', value: '1.41', unit: 'lb/hr', chips: [{ kind: 'good', text: '▲ +0.25 vs W41' }] });
  assert.equal(z.chart.cols[1].rate, '—');
  assert.equal(z.chart.cols[1].lbs, 110.8);
  assert.equal(z.tiles[0].value, '497');
});

test('weekly model needs generatedAt', () => {
  assert.throws(() => weeklyModel({ ...args, generatedAt: undefined }), /generatedAt/);
});

test('weekly cultivar: the one with the most tops, +1 per other cultivar that logged tops', () => {
  const mixed = structuredClone(args.dashboard);
  mixed.daily[0].cultivars.push({ cultivar: '2025 - Lifter / Sungrown', tops: 9.1, smalls: 0 });
  mixed.daily[1].cultivars.push({ cultivar: '2025 - Sour Suver Haze / Sungrown', tops: 0, smalls: 4 });
  assert.equal(weeklyModel({ ...args, dashboard: mixed }).sub, "Oct 12–16, 2026 · Sour Lifter '26 +1 · 4 days");
});

test('weekly supersacks: an empty tracker says so', () => {
  assert.deepEqual(weeklyModel({ ...args, sacks: { periods: [], strains: [] } }).minis[1],
    { label: 'Supersacks', value: '—', unit: '', sub: 'tracker empty' });
});

test('weekly locked costs: money becomes 🔒, nothing else changes', () => {
  const l = weeklyModel({ ...args, dashboard: fixture('dashboard-2026-W42.locked.json'), prior: fixture('dashboard-2026-W41.locked.json') });
  assert.equal(l.costsLocked, true);
  assert.deepEqual(l.tiles[2], { label: '$ per lb tops', value: '🔒', unit: '', chips: [] });
  assert.deepEqual(l.minis[0], { label: 'Smalls', value: '429', unit: 'lb', sub: 'locked' });
  assert.deepEqual(l.minis[2], { label: 'Labor', value: '🔒', unit: '', sub: 'locked' });
  assert.deepEqual(l.tiles.slice(0, 2), m.tiles.slice(0, 2));
  assert.deepEqual(l.minis[1], m.minis[1]);
  for (const key of ['kind', 'eyebrow', 'title', 'sub', 'pill', 'chart', 'flags', 'foot']) assert.deepEqual(l[key], m[key], key);
});

test('weekly foot names the card and the Pacific generation time', () => {
  assert.deepEqual(m.foot, { left: 'cards/weekly · dashboard allocation · $/lb tops', right: 'generated Mon Oct 19 · 06:05 PT' });
});

test('weekly model is null with no worked day in the week (the API fallback shape)', () => {
  assert.equal(weeklyModel({ ...args, week: '2026-W41', dashboard: fixture('dashboard-2026-10-10.empty.json') }), null);
  assert.equal(weeklyModel({ ...args, dashboard: { ...args.dashboard, fallback: { active: true } } }), null);
  assert.equal(weeklyModel({ ...args, dashboard: { ...args.dashboard, daily: [] } }), null);
});

test('weekly model leaves its inputs alone', () => {
  const before = structuredClone(args);
  weeklyModel(args);
  assert.deepEqual(args, before);
});
