// Supersack analytics: scan-out x tracker x hourly merge. All data synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// package.json is "type": "commonjs" and the page loads this .js as an ES
// module, so load the same file's source as an ES module here (no copy).
const SRC = readFileSync(new URL('../src/js/shared/supersack-days.js', import.meta.url), 'utf8');
const D = await import('data:text/javascript,' + encodeURIComponent(SRC));
const W = await import('data:text/javascript,' + encodeURIComponent(
  readFileSync(new URL('../workers/src/lib/sack-weight.js', import.meta.url), 'utf8')));

const scan = (date, groups) => ({ date, total: groups.reduce((n, g) => n + g[2], 0),
  groups: groups.map(([season, cultivar, sacks_today]) => ({ season, cultivar, sacks_today })) });
const row = (date, strain, sacks, o = {}) => ({ date, strain, sacks_opened: sacks, raw_lbs: o.raw ?? sacks * 35,
  tops_lbs: o.tops ?? 0, smalls_lbs: o.smalls ?? 0, biomass_lbs: o.bio ?? 0, trim_lbs: o.trim ?? 0, waste_lbs: 0 });
const hour = (c1, t1, s1, c2, t2, s2) => ({ cultivar1: c1, tops1: t1, smalls1: s1, cultivar2: c2 || '', tops2: t2 || 0, smalls2: s2 || 0 });

test('fullSackLbs mirrors the worker lib', () => {
  for (const y of [2023, 2024, 2025, 2026, 2027, 'x', null]) assert.equal(D.fullSackLbs(y), W.fullSackLbs(y), String(y));
});

test('parseTitle reads year and cultivar', () => {
  assert.deepEqual(D.parseTitle('2026 - Sour Lifter / Sungrown / 1st Cut'), { season: 2026, cultivar: 'Sour Lifter' });
  assert.deepEqual(D.parseTitle('2025 - Lifter / Sungrown'), { season: 2025, cultivar: 'Lifter' });
  assert.deepEqual(D.parseTitle('Lifter'), { season: null, cultivar: 'Lifter' });
});

test('scan-only day (tracker not closed): sacks from scans, tops from hourly, raw estimated, not weighed', () => {
  const d = D.mergeDay({
    date: '2030-01-07',
    scan: scan('2030-01-07', [[2026, 'Alpha', 8], [2026, 'Beta', 14]]),
    hourly: [hour('2026 - Alpha / Sungrown', 30, 20), hour('2026 - Beta / Sungrown', 40, 10, '2026 - Alpha / Sungrown', 5, 0)],
  });
  assert.equal(d.sacks, 22);
  assert.equal(d.raw, 22 * 35);
  assert.equal(d.rawEstimated, true);
  assert.equal(d.weighed, false);
  assert.equal(d.waste, null);
  assert.equal(d.trackerFilled, false);
  const a = d.cultivars.find(c => c.cultivar === 'Alpha');
  assert.deepEqual([a.sacks, a.sacksFrom, a.tops, a.smalls], [8, 'scan', 35, 20]);
  assert.equal(d.cultivars[0].cultivar, 'Beta'); // most sacks first
});

test('closed day: scan count, tracker raw + bio/trim, hourly tops; waste is the remainder', () => {
  const d = D.mergeDay({
    date: '2030-01-08',
    scan: scan('2030-01-08', [[2026, 'Alpha', 10]]),
    tracker: [row('2030-01-08', '2026 - Alpha / Sungrown / 1st Cut', 10, { tops: 99, smalls: 20, bio: 150, trim: 20 })],
    hourly: [hour('2026 - Alpha / Sungrown', 40, 20)],
  });
  assert.equal(d.sacks, 10);
  assert.equal(d.raw, 350);
  assert.equal(d.rawEstimated, false);
  assert.equal(d.tops, 40); // hourly, not the tracker's 99
  assert.equal(d.weighed, true);
  assert.equal(d.waste, 350 - 40 - 20 - 150 - 20);
});

test('tracker-only day (before scan-out) and no hourly read: tracker sacks and tops', () => {
  const d = D.mergeDay({ date: '2030-01-02', tracker: [row('2030-01-02', '2025 - Gamma / Sungrown', 5, { raw: 185, tops: 25, smalls: 9, bio: 80, trim: 9 })] });
  assert.equal(d.sacks, 5);
  assert.equal(d.raw, 185);
  assert.equal(d.tops, 25);
  assert.equal(d.topsFrom, 'tracker');
  assert.equal(d.cultivars[0].sacksFrom, 'tracker');
});

test('scan count wins over a disagreeing tracker count, and raw follows the scanned sacks', () => {
  const d = D.mergeDay({
    date: '2030-01-09',
    scan: scan('2030-01-09', [[2026, 'Alpha', 12]]),
    tracker: [row('2030-01-09', '2026 - Alpha / Sungrown / 1st Cut', 10, { bio: 100, trim: 10 })],
    hourly: [],
  });
  assert.equal(d.sacks, 12);
  assert.equal(d.raw, 12 * 35);
  assert.equal(d.rawEstimated, true);
});

test('a 2025 strain typed on a scan day keeps its tracker count beside the 2026 scans', () => {
  const d = D.mergeDay({
    date: '2030-01-10',
    scan: scan('2030-01-10', [[2026, 'Alpha', 6]]),
    tracker: [row('2030-01-10', '2025 - Alpha / Sungrown', 3, { raw: 111 })],
    hourly: [hour('2025 - Alpha / Sungrown', 9, 0), hour('2026 - Alpha / Sungrown', 20, 5)],
  });
  assert.equal(d.sacks, 9);
  const y25 = d.cultivars.find(c => c.season === 2025), y26 = d.cultivars.find(c => c.season === 2026);
  assert.deepEqual([y25.sacks, y25.tops, y25.seasonFallback], [3, 9, false]);
  assert.deepEqual([y26.sacks, y26.tops, y26.seasonFallback], [6, 20, false]);
});

test('hourly logged under the wrong year lands on the only cultivar of that name with sacks (the 10/30 shape), flagged', () => {
  const d = D.mergeDay({
    date: '2030-01-11',
    scan: scan('2030-01-11', [[2026, 'Alpha', 6], [2026, 'Beta', 27]]),
    hourly: [hour('2025 - Alpha / Sungrown', 43, 27), hour('2026 - Beta / Sungrown', 35, 33)],
  });
  const a = d.cultivars.find(c => c.cultivar === 'Alpha');
  assert.deepEqual([a.season, a.sacks, a.tops, a.seasonFallback], [2026, 6, 43, true]);
  assert.equal(d.unmatched.length, 0);
  assert.equal(d.cultivars.length, 2);
});

test('hourly pounds with no sacks anywhere still count toward the day and are listed', () => {
  const d = D.mergeDay({
    date: '2030-01-12',
    scan: scan('2030-01-12', [[2026, 'Alpha', 4]]),
    hourly: [hour('2026 - Alpha / Sungrown', 10, 0), hour('2026 - Delta / Sungrown', 7, 3)],
  });
  assert.equal(d.tops, 17);
  assert.deepEqual(d.unmatched.map(u => u.title), ['2026 - Delta / Sungrown']);
  assert.equal(d.cultivars.find(c => c.cultivar === 'Delta').sacks, 0);
});

test('an outlier tracker row counts its sacks but not its weights', () => {
  const d = D.mergeDay({ date: '2030-01-03', tracker: [row('2030-01-03', '2025 - Gamma / Sungrown', 2, { raw: 74, tops: 60, smalls: 30, bio: 40, trim: 10 })] });
  assert.equal(d.sacks, 2);
  assert.equal(d.weighed, false);
  assert.equal(d.biomass, 0);
});

test('buildDays: tracker and scan dates union, oldest first, empty scan days dropped', () => {
  const days = D.buildDays({
    entries: [row('2030-01-05', '2025 - Gamma / Sungrown', 5)],
    scansByDate: { '2030-01-06': scan('2030-01-06', [[2026, 'Alpha', 3]]), '2030-01-07': scan('2030-01-07', []) },
    hourlyByDate: { '2030-01-06': [] },
  });
  assert.deepEqual(days.map(d => [d.date, d.sacks, d.topsFrom]), [['2030-01-05', 5, 'tracker'], ['2030-01-06', 3, 'hourly']]);
});

test('unclosedDays skips weighed days and today', () => {
  const days = [{ date: 'a', sacks: 3, weighed: false }, { date: 'b', sacks: 3, weighed: true }, { date: 'c', sacks: 2, weighed: false }, { date: 'd', sacks: 0, weighed: false }];
  assert.deepEqual(D.unclosedDays(days, 'c'), ['a']);
});

test('scanDays never asks before scan-out began', () => {
  assert.deepEqual(D.scanDays('2026-10-11', '2026-10-14'), ['2026-10-13', '2026-10-14']);
  assert.deepEqual(D.scanDays('2026-11-01', '2026-10-01'), []);
  assert.equal(D.daysBetween('2025-01-01', '2025-12-31').length, 365);
});

test('cultivarTotals: effective days weight by share of the day; tops per sack from hourly', () => {
  const days = D.buildDays({
    scansByDate: {
      '2030-02-02': scan('2030-02-02', [[2026, 'Alpha', 10], [2026, 'Beta', 10]]),
      '2030-02-03': scan('2030-02-03', [[2026, 'Alpha', 20]]),
    },
    hourlyByDate: {
      '2030-02-02': [hour('2026 - Alpha / Sungrown', 50, 0), hour('2026 - Beta / Sungrown', 40, 0)],
      '2030-02-03': [hour('2026 - Alpha / Sungrown', 100, 30)],
    },
  });
  const t = D.cultivarTotals(days);
  const a = t.find(x => x.cultivar === 'Alpha');
  assert.equal(a.sacks, 30);
  assert.equal(a.effectiveDays, 1.5);
  assert.equal(a.sacksPerDay, 20);
  assert.equal(a.topsPerSack, 5);
  assert.equal(a.thin, false);
  assert.equal(t.find(x => x.cultivar === 'Beta').thin, false);
});

test('projectVariant: a thin sample gets no days supply (no "0 days, depletes today")', () => {
  const totals = [{ season: 2026, cultivar: 'Tiny', sacks: 1, effectiveDays: 1 / 30, sacksPerDay: 30, topsPerSack: 0, smallsPerSack: 0, thin: true }];
  const p = D.projectVariant('2026 - Tiny / Sungrown / 1st Cut', 13, totals);
  assert.equal(p.daysLeft, null);
  assert.equal(p.topsLbs, null);
});

test('projectVariant: matches by year and cultivar across cuts; under a day is never 0', () => {
  const totals = [{ season: 2026, cultivar: 'Alpha', sacks: 40, sacksPerDay: 20, topsPerSack: 5, smallsPerSack: 2, thin: false }];
  const p = D.projectVariant('2026 - Alpha / Sungrown / 2nd Cut', 100, totals);
  assert.deepEqual([p.daysLeft, p.topsLbs, p.smallsLbs], [5, 500, 200]);
  assert.equal(D.projectVariant('2026 - Alpha / Sungrown / 1st Cut', 3, totals).daysLeft, 0.5);
  assert.equal(D.projectVariant('2025 - Alpha / Sungrown', 100, totals).daysLeft, null);
});

test('mapLimit keeps order and caps concurrency', async () => {
  let live = 0, peak = 0;
  const out = await D.mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--; return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3);
});
