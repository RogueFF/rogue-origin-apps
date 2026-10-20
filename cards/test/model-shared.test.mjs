import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { costsLocked, deltaChip, pctChip, pctKind, hourTarget, fmtInt, fmtMoney, fmt1, fmt2, cultivarShort } from '../src/model.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fmtMoney2 = (v) => '$' + fmt2(v);

test('costsLocked reads the day keys, for one day or a whole dashboard', () => {
  const locked = fixture('dashboard-2026-W42.locked.json');
  const unlocked = fixture('dashboard-2026-W42.unlocked.json');
  assert.equal(costsLocked(locked.daily[0]), true);
  assert.equal(costsLocked(unlocked.daily[0]), false);
  assert.equal(costsLocked(locked), true);
  // The day keys decide, whatever the top-level flag says.
  assert.equal(unlocked.costsLocked, false);
  assert.equal(costsLocked(unlocked), false);
  assert.equal(costsLocked({ daily: [] }), true);
  assert.equal(costsLocked(null), true);
});

test('delta chip: direction, sign, good/bad polarity', () => {
  assert.deepEqual(deltaChip(1.34, 1.20, { fmt: fmt2, upIsGood: true, vs: 'W41' }), { kind: 'good', text: '▲ +0.14 vs W41' });
  assert.deepEqual(deltaChip(30.28, 35.12, { fmt: fmtMoney2, upIsGood: false, vs: 'W41' }), { kind: 'good', text: '▼ −$4.84 vs W41' });
  assert.deepEqual(deltaChip(1.20, 1.34, { fmt: fmt2, upIsGood: true, vs: 'W41' }), { kind: 'bad', text: '▼ −0.14 vs W41' });
  assert.deepEqual(deltaChip(35.12, 30.28, { fmt: fmtMoney2, upIsGood: false, vs: 'W41' }), { kind: 'bad', text: '▲ +$4.84 vs W41' });
  assert.deepEqual(deltaChip(100, 100, { fmt: String, upIsGood: true, vs: 'Thu' }), { kind: 'neutral', text: '= vs Thu' });
  assert.equal(deltaChip(5, null, { fmt: String, upIsGood: true, vs: 'x' }), null);
  assert.equal(deltaChip(undefined, 5, { fmt: String, upIsGood: true, vs: 'x' }), null);
  assert.deepEqual(deltaChip(497.2, 137.7, { pct: true, upIsGood: true, vs: 'W41' }), { kind: 'good', text: '▲ +261% vs W41' });
  assert.deepEqual(deltaChip(137.7, 497.2, { pct: true, upIsGood: true, vs: 'W41' }), { kind: 'bad', text: '▼ −72% vs W41' });
  assert.equal(deltaChip(5, 0, { pct: true, upIsGood: true, vs: 'x' }), null);
});

test('delta chip is neutral when the change rounds to nothing on screen', () => {
  assert.deepEqual(deltaChip(1.3401, 1.34, { fmt: fmt2, upIsGood: true, vs: 'W41' }), { kind: 'neutral', text: '= vs W41' });
  assert.deepEqual(deltaChip(100.2, 100, { pct: true, upIsGood: true, vs: 'W41' }), { kind: 'neutral', text: '= vs W41' });
});

test('pctChip bands', () => {
  assert.deepEqual(pctChip(497.2, 508.3), { kind: 'warn', text: '98% target' });
  assert.deepEqual(pctChip(120.1, 107.2), { kind: 'good', text: '112% target' });
  assert.deepEqual(pctChip(80, 100), { kind: 'bad', text: '80% target' });
  assert.deepEqual(pctChip(90, 100), { kind: 'warn', text: '90% target' });
  assert.deepEqual(pctChip(100, 100), { kind: 'good', text: '100% target' });
  assert.equal(pctChip(10, 0), null);
  assert.equal(pctChip(10, null), null);
  assert.equal(pctChip(null, 100), null);
});

test('hourTarget is the scoreboard method: the hourly targets add up to todayTarget in every fixture', () => {
  const files = fs.readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => /^scoreboard-.*\.json$/.test(f));
  assert.equal(files.length, 5);
  for (const file of files) {
    const { scoreboard } = fixture(file);
    const sum = scoreboard.hourlyRates.reduce((total, row) => total + hourTarget(row), 0);
    assert.ok(Math.abs(sum - scoreboard.todayTarget) < 0.01, `${file}: ${sum} vs todayTarget ${scoreboard.todayTarget}`);
  }
});

test('hourTarget = effective trimmers × the row target rate × multiplier, falling back to trimmers', () => {
  assert.equal(hourTarget({ trimmers: 8, effectiveTrimmers: 9.1, target: 1.59, multiplier: 0.83 }), 9.1 * 1.59 * 0.83);
  assert.equal(hourTarget({ trimmers: 8, target: 1.59, multiplier: 0.83 }), 8 * 1.59 * 0.83);
  assert.equal(hourTarget({ trimmers: 8, target: 0.85 }), 8 * 0.85 * 1);
  assert.equal(hourTarget({ trimmers: 8 }), 0);
  assert.equal(hourTarget(null), 0);
});

test('formatters', () => {
  assert.equal(fmtInt(20530.26), '20,530');
  assert.equal(fmtInt(-0.4), '0');
  assert.equal(fmtMoney(20530.26), '$20,530');
  assert.equal(fmt1(5.58), '5.6');
  assert.equal(fmt2(1.3399), '1.34');
});

test('formatters never print a negative zero', () => {
  assert.equal(fmt1(-0.04), '0.0');
  assert.equal(fmt1(-0), '0.0');
  assert.equal(fmt2(-0.004), '0.00');
  assert.equal(fmtInt(-0.4), '0');
  assert.equal(fmtMoney(-0.4), '$0');
});

test('negative numbers use the U+2212 minus in every formatter', () => {
  assert.equal(fmtInt(-20530.26), '−20,530');
  assert.equal(fmtMoney(-5), '−$5');
  assert.equal(fmtMoney(-1234.6), '−$1,235');
  assert.equal(fmt1(-5.58), '−5.6');
  assert.equal(fmt2(-1.3399), '−1.34');
  for (const s of [fmtInt(-3), fmtMoney(-3), fmt1(-3), fmt2(-3)]) assert.doesNotMatch(s, /-/);
});

test('formatters print — for a missing value', () => {
  for (const f of [fmtInt, fmtMoney, fmt1, fmt2]) {
    assert.equal(f(null), '—');
    assert.equal(f(undefined), '—');
    assert.equal(f(NaN), '—');
  }
});

test('deltaChip needs a fmt unless pct is set', () => {
  assert.throws(() => deltaChip(1.34, 1.2, { upIsGood: true, vs: 'W41' }), /fmt/);
  assert.throws(() => deltaChip(1.34, null, {}), /fmt/);
  assert.throws(() => deltaChip(1.34, 1.2), /fmt/);
  assert.deepEqual(deltaChip(1.34, 1.2, { pct: true, vs: 'W41' }), { kind: 'good', text: '▲ +12% vs W41' });
});

test('pctKind bands: good ≥100, warn ≥90, else bad', () => {
  assert.equal(pctKind(112), 'good');
  assert.equal(pctKind(100), 'good');
  assert.equal(pctKind(99.9), 'warn');
  assert.equal(pctKind(90), 'warn');
  assert.equal(pctKind(89.9), 'bad');
  assert.equal(pctKind(0), 'bad');
  assert.equal(pctKind(null), null);
  assert.equal(pctKind(NaN), null);
});

test('cultivarShort', () => {
  assert.equal(cultivarShort('2026 - Sour Lifter / Sungrown'), "Sour Lifter '26");
  assert.equal(cultivarShort('2025 - Lifter / Sungrown'), "Lifter '25");
  assert.equal(cultivarShort('2025 - Sugar Cookez (Cookies) / Sungrown'), "Sugar Cookez (Cookies) '25");
  assert.equal(cultivarShort('Lifter'), 'Lifter');
  assert.equal(cultivarShort(''), '—');
  assert.equal(cultivarShort(undefined), '—');
});

test('capText: one line of at most 72 characters, cut at a clause break near the end, else a space, else hard', async () => {
  const { capText } = await import('../src/model.js');
  assert.equal(capText('short stays'), 'short stays');
  const exact = 'x'.repeat(72);
  assert.equal(capText(exact), exact);
  // A comma within the last 24 characters of the window wins over a later space.
  assert.equal(capText('Crew fell 8 → 5 trimmers after 4 PM: Staff moved at the last minute, 1 hour under target'),
    'Crew fell 8 → 5 trimmers after 4 PM: Staff moved at the last minute…');
  // No clause break near the end: the last space, trailing punctuation dropped.
  assert.equal(capText('aaaa '.repeat(20)).length <= 72, true);
  assert.ok(/a…$/.test(capText('aaaa '.repeat(20))));
  // One unbroken word: a hard cut.
  assert.equal(capText('y'.repeat(100)), 'y'.repeat(71) + '…');
  for (const n of [73, 80, 150]) assert.ok(capText('word '.repeat(n)).length <= 72);
});

test('capText takes a shorter limit', async () => {
  const { capText } = await import('../src/model.js');
  assert.equal(capText('Staff moved at the last minute and se fueron a hang al granero', 40), 'Staff moved at the last minute and se…');
  assert.equal(capText('Staff moved at the last minute', 40), 'Staff moved at the last minute');
});
