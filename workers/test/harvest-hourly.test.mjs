import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNT_FIELDS, BARN_LABELS, validateCounts, missingFields, classifyInbound,
  hourEnd, hourRange, promptText, reminderText, helpText, confirmText, askMissingText,
  futureHourText, normalizeNotes, tickDecision, shouldAutoStop,
} from '../src/lib/harvest-hourly.js';

const COMPLETE_ROW = { barn: 'bottom', hour_start: '09:00', cutters: 4, cutter_water_spiders: 2,
  drivers: 3, hangers: 8, hanging_water_spiders: 1, racks: 12, notes: 'se rompio un rack' };

test('validateCounts: ints in range pass, out of range and junk are flagged, null is allowed', () => {
  const { values, invalid } = validateCounts({
    cutters: 4, cutter_water_spiders: '2', drivers: 99, hangers: null, hanging_water_spiders: 'x', racks: 12,
  });
  assert.deepEqual(values, { cutters: 4, cutter_water_spiders: 2, drivers: null, hangers: null, hanging_water_spiders: null, racks: 12 });
  assert.deepEqual(invalid, ['drivers', 'hanging_water_spiders']);

  // Only a real integer or an all-digit string counts. Number() would turn
  // true into 1, [4] into 4 and '1e1' into 10 — all of them parse failures.
  const bad = validateCounts({
    cutters: true, cutter_water_spiders: [4], drivers: '4.5', hangers: '4.0',
    hanging_water_spiders: '0x10', racks: '1e1',
  });
  assert.deepEqual(bad.values, { cutters: null, cutter_water_spiders: null, drivers: null,
    hangers: null, hanging_water_spiders: null, racks: null });
  assert.deepEqual(bad.invalid, COUNT_FIELDS);
  // Negatives are integers, but out of range.
  assert.deepEqual(validateCounts({ cutters: -1 }).invalid, ['cutters']);
  // The forms that must still pass.
  assert.equal(validateCounts({ cutters: 0 }).values.cutters, 0);
  assert.equal(validateCounts({ cutters: ' 7 ' }).values.cutters, 7);
  assert.deepEqual(validateCounts({ cutters: ' 7 ' }).invalid, []);
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
  // The bare-hour PM boundary sits at 6: below it rolls to PM, at it and above stands.
  assert.equal(classifyInbound('5: 4 2 3 8 1 12').hour, '17:00');
  assert.equal(classifyInbound('6: 4 2 3 8 1 12').hour, '06:00');
  assert.equal(classifyInbound('12: 4 2 3 8 1 12').hour, '12:00');
  // Noon and midnight are the two am/pm cases that are not a plain +12.
  assert.equal(classifyInbound('12am: 4 2 3 8 1 12').hour, '00:00');
  assert.equal(classifyInbound('12pm: 4 2 3 8 1 12').hour, '12:00');
});

test('classifyInbound: a leading number is not an hour prefix unless the separator says so', () => {
  // Dash-run counts, a written hour range, and a clock time in a note all stay whole.
  for (const text of ['4-2-3-8-1-12', '9-10 4 2 3 8 1 12', '10:30 se paro la maquina']) {
    assert.deepEqual(classifyInbound(text), { kind: 'answer', hour: null, text },
      `should not have been split: ${text}`);
  }
  // The real prefixes still parse.
  assert.equal(classifyInbound('1pm - 4 2 3 8 1 12').hour, '13:00');
  assert.equal(classifyInbound('9am: 4 2 3 8 1 12').hour, '09:00');
});

test('classifyInbound: anything else is an answer for the open hour', () => {
  assert.deepEqual(classifyInbound('4 2 3 8 1 12 se rompio un rack'),
    { kind: 'answer', hour: null, text: '4 2 3 8 1 12 se rompio un rack' });
});

test('hour labels', () => {
  assert.equal(hourEnd('09:00'), '10:00');
  assert.equal(hourEnd('23:00'), '00:00');   // wraps, never '24:00'
  assert.equal(hourRange('09:00'), '9-10');
  assert.equal(hourRange('12:00'), '12-1');
});

test('promptText fits one GSM segment and has no accents', () => {
  const t = promptText('upper', '09:00');
  assert.ok(t.startsWith('10:00 Granero Arriba.'));
  assert.ok(t.length <= 160, `too long: ${t.length}`);
  assert.doesNotMatch(t, /[^\x20-\x7E]/);
});

test('every outbound text is GSM-safe ASCII, and the per-hour ones fit one segment', () => {
  const texts = {
    promptText: promptText('upper', '09:00'),
    reminderText: reminderText('bottom', '09:00'),
    helpText: helpText('upper'),
    confirmText: confirmText(COMPLETE_ROW),
    askMissingText: askMissingText({ ...COMPLETE_ROW, racks: null }),
    futureHourText: futureHourText(),
  };
  for (const [name, t] of Object.entries(texts)) {
    assert.match(t, /^[\x20-\x7E]+$/, `${name} has a non-GSM character: ${JSON.stringify(t)}`);
  }
  // helpText is allowed two segments — it is only ever sent when asked for.
  for (const name of ['reminderText', 'futureHourText']) {
    assert.ok(texts[name].length <= 160, `${name} too long: ${texts[name].length}`);
  }
});

test('confirmText echoes the six counts and the note', () => {
  assert.equal(confirmText(COMPLETE_ROW), 'Ok 9-10 Abajo: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack');
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

  // An unreadable timestamp must not freeze the row: move it on, and the write
  // that moves it stamps a fresh one.
  assert.deepEqual(tickDecision({ status: 'pending', asked_at: null }, t0), { type: 'nudge' });
  assert.deepEqual(tickDecision({ status: 'pending', asked_at: 'garbage' }, t0), { type: 'nudge' });
  assert.deepEqual(tickDecision({ status: 'nudged', nudged_at: null }, t0), { type: 'missing' });
  assert.deepEqual(tickDecision({ status: 'nudged', nudged_at: 'garbage' }, t0), { type: 'missing' });
});

test('tickDecision: a backfill row is timed from answered_at, not from its missing asked_at', () => {
  // The foreman volunteered "9am: 4 2 3" at 21:02 UTC — no prompt was ever
  // sent for that hour, so asked_at is null and answered_at is its clock.
  const backfill = { status: 'pending', asked_at: null, answered_at: '2026-10-15 21:02:00' };
  assert.equal(tickDecision(backfill, new Date('2026-10-15T21:05:00Z')), null);
  assert.deepEqual(tickDecision(backfill, new Date('2026-10-15T21:17:00Z')), { type: 'nudge' });
  // With neither timestamp the row still moves forward rather than freezing.
  assert.deepEqual(tickDecision({ status: 'pending', asked_at: null, answered_at: null },
    new Date('2026-10-15T21:05:00Z')), { type: 'nudge' });
});

test('tickDecision: with no row, only ask about hours that ended after EMPEZAR', () => {
  const activeSince = '2026-10-15 17:30:00';            // EMPEZAR at 10:30 PDT
  // 10:35 PDT — the hour that just ended (9-10) was over before he started.
  assert.equal(tickDecision(null, new Date('2026-10-15T17:35:00Z'), { activeSince }), null);
  // 11:02 PDT — the 10-11 hour ended after he started, so it is his to report.
  assert.deepEqual(tickDecision(null, new Date('2026-10-15T18:02:00Z'), { activeSince }), { type: 'ask' });
  // Still active from yesterday: today's hours are all fair game.
  assert.deepEqual(tickDecision(null, new Date('2026-10-15T17:35:00Z'), { activeSince: '2026-10-14 17:30:00' }),
    { type: 'ask' });
  assert.deepEqual(tickDecision(null, new Date('2026-10-15T17:35:00Z'), { activeSince: null }), { type: 'ask' });
});

test('shouldAutoStop: 8 PM or three finalized hours all missing', () => {
  const miss = (asked_at) => ({ status: 'missing', asked_at });
  assert.equal(shouldAutoStop({ hourNow: 20, recent: [] }), true);
  assert.equal(shouldAutoStop({ hourNow: 14, recent: [miss('2026-10-15 19:00:00'),
    miss('2026-10-15 18:00:00'), miss('2026-10-15 17:00:00')] }), true);
  assert.equal(shouldAutoStop({ hourNow: 14, recent: [miss('2026-10-15 19:00:00'),
    { status: 'complete', asked_at: '2026-10-15 18:00:00' }, miss('2026-10-15 17:00:00')] }), false);
  assert.equal(shouldAutoStop({ hourNow: 14, recent: [miss('2026-10-15 19:00:00'),
    miss('2026-10-15 18:00:00')] }), false);

  // A same-day restart: the three misses belong to the previous run, so the
  // foreman who just texted EMPEZAR again must not be stopped on their account.
  assert.equal(shouldAutoStop({
    hourNow: 14,
    recent: [miss('2026-10-15 19:00:00'), miss('2026-10-15 18:00:00'), miss('2026-10-15 17:00:00')],
    activeSince: '2026-10-15 20:00:00',
  }), false);
});

test('normalizeNotes: a real note survives, no-news phrases and blanks become null', () => {
  assert.equal(normalizeNotes('se rompio un rack'), 'se rompio un rack');
  assert.equal(normalizeNotes('  falto un chofer  '), 'falto un chofer');
  assert.equal(normalizeNotes('sin novedad'), null);
  assert.equal(normalizeNotes('Sin Novedades.'), null);
  assert.equal(normalizeNotes('NADA!'), null);
  // Trailing punctuation of any kind is stripped before the no-news match.
  assert.equal(normalizeNotes('sin novedad,'), null);
  assert.equal(normalizeNotes('nada;'), null);
  assert.equal(normalizeNotes('ok...'), null);
  assert.equal(normalizeNotes('todo bien !'), null);
  assert.equal(normalizeNotes('todo bien'), null);
  assert.equal(normalizeNotes('ok'), null);
  assert.equal(normalizeNotes('nothing'), null);
  assert.equal(normalizeNotes('none'), null);
  assert.equal(normalizeNotes('no notes'), null);
  assert.equal(normalizeNotes('   '), null);
  assert.equal(normalizeNotes(null), null);
  assert.equal(normalizeNotes(undefined), null);
  // Only a whole-string match is no-news: these carry real information.
  assert.equal(normalizeNotes('nada de agua en el granero'), 'nada de agua en el granero');
  assert.equal(normalizeNotes('todo bien menos el rack 3'), 'todo bien menos el rack 3');
});
