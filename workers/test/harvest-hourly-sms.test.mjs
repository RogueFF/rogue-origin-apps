import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gsmSafe, smsSegments, buildPollContext } from '../src/lib/harvest-hourly.js';

// 2026-10-15 is PDT (UTC-7): 17:07Z is 10:07 Pacific, so the hour that just
// ended is 09:00. Every time-dependent assertion below hangs off this instant.
const NOW = new Date('2026-10-15T17:07:00Z');
const FOREMAN = { phone: '+15415550101', name: 'Test Arriba', barn: 'upper', active: 1, active_since: '2026-10-15 13:00:00' };

const row = (hour_start, status, extra = {}) => ({
  hour_start, status, barn: 'upper', cutters: null, cutter_water_spiders: null, drivers: null,
  hangers: null, hanging_water_spiders: null, racks: null, notes: null, ...extra,
});

// ─── gsmSafe ───────────────────────────────────────────────────────────

test('gsmSafe: plain ASCII passes through untouched', () => {
  assert.equal(gsmSafe('Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12'), 'Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12');
});

test('gsmSafe: accents lose their marks, the letter survives', () => {
  assert.equal(gsmSafe('se rompió un rack'), 'se rompio un rack');
  assert.equal(gsmSafe('Cuántos están áéíóúÁÉÍÓÚ'), 'Cuantos estan aeiouAEIOU');
  // NFD decomposes n-tilde too, so the letter is kept rather than deleted by
  // the non-ASCII sweep — the whole reason the mark strip runs first.
  assert.equal(gsmSafe('mañana señor Ñ'), 'manana senor N');
});

test('gsmSafe: inverted punctuation is dropped, not replaced', () => {
  assert.equal(gsmSafe('¿Cuantos racks?'), 'Cuantos racks?');
  assert.equal(gsmSafe('¡Listo!'), 'Listo!');
});

test('gsmSafe: anything still outside printable ASCII is removed', () => {
  // An emoji would push Twilio to UCS-2 and 70-char segments, which would make
  // smsSegments' 160/153 arithmetic a lie. It never leaves the worker.
  assert.equal(gsmSafe('Listo 👍'), 'Listo');
  assert.equal(gsmSafe('don’t — ok'), 'dont ok');
  assert.match(gsmSafe('Ok 9-10 ✅ mañana ¿si?'), /^[\x20-\x7E]*$/);
});

test('gsmSafe: whitespace collapses to single spaces and the ends are trimmed', () => {
  assert.equal(gsmSafe('  Ok   9-10\nArriba\t: R12  '), 'Ok 9-10 Arriba : R12');
});

// The GSM-7 BASIC table, minus the non-ASCII letters gsmSafe strips anyway.
// Everything outside this costs two septets (the extension table) or forces
// UCS-2, and either one makes smsSegments' plain length math wrong.
const GSM7_BASIC = ' !"#$%&\'()*+,-./0123456789:;<=>?@'
  + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

test('gsmSafe: the nine GSM-7 extension characters fold into the basic table', () => {
  assert.equal(gsmSafe('`x`'), "'x'");
  assert.equal(gsmSafe('a[b]c'), 'a(b)c');
  assert.equal(gsmSafe('a{b}c'), 'a(b)c');
  assert.equal(gsmSafe('a\\b|c'), 'a/b/c');
  assert.equal(gsmSafe('a~b'), 'a-b');
  assert.equal(gsmSafe('a^b'), 'ab');
  // Dropping the caret must not leave a double space behind.
  assert.equal(gsmSafe('a ^ b'), 'a b');
});

test('gsmSafe: every output character is in the GSM-7 basic table', () => {
  const inputs = [
    'Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack',
    '¿Cuántos racks? ¡Listo! ñÑ áéíóú 👍 don’t — ok',
    'a[b]{c}\\d|e~f^g`h',
    'Falta: colgadores, waterspiders granero, racks. Cuantos de 9 a 10?',
  ];
  for (const raw of inputs) {
    for (const ch of gsmSafe(raw)) {
      assert.ok(GSM7_BASIC.includes(ch),
        `gsmSafe(${JSON.stringify(raw)}) leaked ${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16)})`);
    }
  }
});

test('gsmSafe: non-strings become an empty string rather than "null"', () => {
  assert.equal(gsmSafe(null), '');
  assert.equal(gsmSafe(undefined), '');
  assert.equal(gsmSafe(''), '');
});

// ─── smsSegments ───────────────────────────────────────────────────────

test('smsSegments: one segment up to 160 GSM-7 characters', () => {
  assert.equal(smsSegments(''), 1);
  assert.equal(smsSegments('Ok'), 1);
  assert.equal(smsSegments('x'.repeat(160)), 1);
});

test('smsSegments: past 160 the whole message pays the 153-char concatenation header', () => {
  assert.equal(smsSegments('x'.repeat(161)), 2);
  assert.equal(smsSegments('x'.repeat(306)), 2);
  assert.equal(smsSegments('x'.repeat(307)), 3);
  assert.equal(smsSegments('x'.repeat(459)), 3);
  assert.equal(smsSegments('x'.repeat(460)), 4);
});

// ─── buildPollContext ──────────────────────────────────────────────────

test('buildPollContext: the open row is the newest unanswered hour that has ended', () => {
  const rows = [
    row('07:00', 'missing', { racks: 5 }),
    row('08:00', 'complete', { cutters: 4, cutter_water_spiders: 2, drivers: 3, hangers: 8, hanging_water_spiders: 1, racks: 10 }),
    row('09:00', 'nudged', { cutters: 4, notes: 'se rompio un rack' }),
    // A stray future row must never be handed to the relay as "the open hour".
    row('17:00', 'pending'),
  ];
  const ctx = buildPollContext(rows, FOREMAN, NOW);

  assert.deepEqual(ctx.open_row, {
    hour_start: '09:00',
    hour_range: '9-10',
    status: 'nudged',
    missing: ['cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders', 'racks'],
    values: {
      cutters: 4, cutter_water_spiders: null, drivers: null,
      hangers: null, hanging_water_spiders: null, racks: null,
    },
    notes: 'se rompio un rack',
  });
  assert.equal(ctx.just_ended_hour, '09:00');
  assert.equal(ctx.now_pacific, '10:07');
});

test('buildPollContext: the foreman block names the barn in Spanish and active is a boolean', () => {
  const ctx = buildPollContext([], FOREMAN, NOW);
  assert.deepEqual(ctx.foreman, {
    name: 'Test Arriba', barn: 'upper', barn_label: 'Granero Arriba',
    active: true, active_since: '2026-10-15 13:00:00',
  });
  assert.equal(buildPollContext([], { ...FOREMAN, active: 0 }, NOW).foreman.active, false);
});

test('buildPollContext: today counts racks from every row whatever its status', () => {
  const rows = [
    row('08:00', 'complete', { cutters: 4, cutter_water_spiders: 2, drivers: 3, hangers: 8, hanging_water_spiders: 1, racks: 10 }),
    row('07:00', 'missing', { racks: 5 }),
    row('09:00', 'nudged', { cutters: 4 }),
  ];
  const ctx = buildPollContext(rows, FOREMAN, NOW);
  assert.equal(ctx.today.date, '2026-10-15');
  assert.equal(ctx.today.total_racks, 15);
  assert.equal(ctx.today.complete_hours, 1);
  assert.deepEqual(ctx.today.missing_hours, ['07:00']);
  // Ordered by hour, whatever order the rows arrived in.
  assert.deepEqual(ctx.today.rows, [
    { hour_start: '07:00', status: 'missing', racks: 5 },
    { hour_start: '08:00', status: 'complete', racks: 10 },
    { hour_start: '09:00', status: 'nudged', racks: null },
  ]);
});

test('buildPollContext: an empty day is a valid context, not a null one', () => {
  const ctx = buildPollContext([], FOREMAN, NOW);
  assert.equal(ctx.open_row, null);
  assert.deepEqual(ctx.today, { date: '2026-10-15', total_racks: 0, complete_hours: 0, missing_hours: [], rows: [] });
});

test('buildPollContext: during the 00:xx hour nothing has ended, so there is no open hour', () => {
  // 07:30Z on 2026-10-15 is 00:30 Pacific — the hour that ended belongs to
  // yesterday, and openRow's maxHour bound means nothing today is answerable.
  const midnight = new Date('2026-10-15T07:30:00Z');
  const ctx = buildPollContext([row('00:00', 'pending')], FOREMAN, midnight);
  assert.equal(ctx.just_ended_hour, null);
  assert.equal(ctx.open_row, null);
  assert.equal(ctx.now_pacific, '00:30');
});
