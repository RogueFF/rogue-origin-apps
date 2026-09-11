import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNT_FIELDS, BARN_LABELS, validateCounts, missingFields, classifyInbound,
  hourEnd, hourRange, promptText, reminderText, confirmText, askMissingText,
  tickDecision, shouldAutoStop,
} from '../src/lib/harvest-hourly.js';

test('validateCounts: ints in range pass, out of range and junk are flagged, null is allowed', () => {
  const { values, invalid } = validateCounts({
    cutters: 4, cutter_water_spiders: '2', drivers: 99, hangers: null, hanging_water_spiders: 'x', racks: 12,
  });
  assert.deepEqual(values, { cutters: 4, cutter_water_spiders: 2, drivers: null, hangers: null, hanging_water_spiders: null, racks: 12 });
  assert.deepEqual(invalid, ['drivers', 'hanging_water_spiders']);
});

test('missingFields lists the null counts in question order', () => {
  assert.deepEqual(missingFields({ cutters: 4, drivers: 3 }),
    ['cutter_water_spiders', 'hangers', 'hanging_water_spiders', 'racks']);
});

test('classifyInbound: commands in either language, any case', () => {
  assert.equal(classifyInbound(' empezar ').kind, 'start');
  assert.equal(classifyInbound('START').kind, 'start');
  assert.equal(classifyInbound('Parar').kind, 'stop');
  assert.equal(classifyInbound('stop').kind, 'stop');
  assert.equal(classifyInbound('ayuda').kind, 'help');
  assert.equal(classifyInbound('HELP').kind, 'help');
});

test('classifyInbound: hour prefix targets a specific hour, rest is the answer', () => {
  assert.deepEqual(classifyInbound('9am: 4 2 3 8 1 12'), { kind: 'answer', hour: '09:00', text: '4 2 3 8 1 12' });
  assert.deepEqual(classifyInbound('1pm - 4 2 3 8 1 12'), { kind: 'answer', hour: '13:00', text: '4 2 3 8 1 12' });
  // bare "1:" in a barn day means 1pm; bare "9:" means 9am
  assert.equal(classifyInbound('1: 4 2 3 8 1 12').hour, '13:00');
  assert.equal(classifyInbound('9: 4 2 3 8 1 12').hour, '09:00');
});

test('classifyInbound: anything else is an answer for the open hour', () => {
  assert.deepEqual(classifyInbound('4 2 3 8 1 12 se rompio un rack'),
    { kind: 'answer', hour: null, text: '4 2 3 8 1 12 se rompio un rack' });
});

test('hour labels', () => {
  assert.equal(hourEnd('09:00'), '10:00');
  assert.equal(hourRange('09:00'), '9-10');
  assert.equal(hourRange('12:00'), '12-1');
});

test('promptText fits one GSM segment and has no accents', () => {
  const t = promptText('upper', '09:00');
  assert.ok(t.startsWith('10:00 Granero Arriba.'));
  assert.ok(t.length <= 160, `too long: ${t.length}`);
  assert.doesNotMatch(t, /[áéíóúñ¿¡]/i);
});

test('confirmText echoes the six counts and the note', () => {
  const row = { barn: 'bottom', hour_start: '09:00', cutters: 4, cutter_water_spiders: 2, drivers: 3,
    hangers: 8, hanging_water_spiders: 1, racks: 12, notes: 'se rompio un rack' };
  assert.equal(confirmText(row), 'Ok 9-10 Abajo: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack');
});

test('askMissingText names only the missing fields in Spanish', () => {
  const row = { barn: 'upper', hour_start: '09:00', cutters: 4, cutter_water_spiders: 2, drivers: 3, hangers: 8, hanging_water_spiders: 1 };
  assert.equal(askMissingText(row), 'Falta: racks. Cuantos de 9 a 10?');
});

test('tickDecision: ask when no row, nudge after 15 min, missing after 15 more, else nothing', () => {
  const t0 = new Date('2026-10-15T17:00:00Z'); // 10:00 PDT
  assert.deepEqual(tickDecision(null, t0), { type: 'ask' });
  const pending = { status: 'pending', asked_at: '2026-10-15 17:00:00' };
  assert.equal(tickDecision(pending, new Date('2026-10-15T17:10:00Z')), null);
  assert.deepEqual(tickDecision(pending, new Date('2026-10-15T17:15:00Z')), { type: 'nudge' });
  const nudged = { status: 'nudged', asked_at: '2026-10-15 17:00:00', nudged_at: '2026-10-15 17:15:00' };
  assert.equal(tickDecision(nudged, new Date('2026-10-15T17:25:00Z')), null);
  assert.deepEqual(tickDecision(nudged, new Date('2026-10-15T17:30:00Z')), { type: 'missing' });
  assert.equal(tickDecision({ status: 'complete' }, t0), null);
  assert.equal(tickDecision({ status: 'missing' }, t0), null);
});

test('shouldAutoStop: 8 PM or three finalized hours all missing', () => {
  assert.equal(shouldAutoStop({ hourNow: 20, recentStatuses: [] }), true);
  assert.equal(shouldAutoStop({ hourNow: 14, recentStatuses: ['missing', 'missing', 'missing'] }), true);
  assert.equal(shouldAutoStop({ hourNow: 14, recentStatuses: ['missing', 'complete', 'missing'] }), false);
  assert.equal(shouldAutoStop({ hourNow: 14, recentStatuses: ['missing', 'missing'] }), false);
});
