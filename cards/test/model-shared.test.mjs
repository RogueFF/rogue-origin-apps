import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { costsLocked, deltaChip, pctChip, hourTarget, fmtInt, fmtMoney, fmt1, fmt2, cultivarShort } from '../src/model.js';

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

test('hourTarget = trimmers × rate × multiplier', () => {
  assert.equal(hourTarget({ trimmers: 8, multiplier: 0.83 }, 1.59), 8 * 1.59 * 0.83);
  const slot = fixture('scoreboard-2026-10-16.json').scoreboard.hourlyRates[0];
  assert.equal(hourTarget(slot, 1.5834653806407168), 8 * 1.5834653806407168 * 1);
});

test('formatters', () => {
  assert.equal(fmtInt(20530.26), '20,530');
  assert.equal(fmtInt(-0.4), '0');
  assert.equal(fmtMoney(20530.26), '$20,530');
  assert.equal(fmt1(5.58), '5.6');
  assert.equal(fmt2(1.3399), '1.34');
});

test('cultivarShort', () => {
  assert.equal(cultivarShort('2026 - Sour Lifter / Sungrown'), "Sour Lifter '26");
  assert.equal(cultivarShort('2025 - Lifter / Sungrown'), "Lifter '25");
  assert.equal(cultivarShort('2025 - Sugar Cookez (Cookies) / Sungrown'), "Sugar Cookez (Cookies) '25");
  assert.equal(cultivarShort('Lifter'), 'Lifter');
  assert.equal(cultivarShort(''), '—');
  assert.equal(cultivarShort(undefined), '—');
});
