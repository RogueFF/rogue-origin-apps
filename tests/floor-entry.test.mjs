/**
 * The hour form, pinned.
 *
 * `formToPayload` is the definition of done for phase 1: it is the addProduction
 * body, and the worker replaces the whole row for (date, timeSlot), so a key
 * that goes missing here is a column silently zeroed on the server. That test
 * asserts the key SET, not key presence — a presence check passes happily with
 * an extra key the backend will ignore and a reader will later trust.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIELD_ORDER,
  LINE2_FIELDS,
  CREW_FIELDS,
  rowToForm,
  formToPayload,
  hasCrew,
  hasProduction,
  rowTops,
  rowHasLine2,
  startCrewLog,
  recordCrewChange,
  effectiveTrimmers,
  hourTarget,
  tickState,
  crewChanges,
  crewChangeNote,
  isDirty,
  nextField,
  dayTotals,
  paceSummary,
} from '../src/js/floor/entry.js';

// Labels are passed in rather than imported: labels.js belongs to another
// builder and this module must not depend on it.
const LABELS = {
  buckers: 'Buckers',
  trimmers: 'Trimmers',
  tzero: 'T-Zero',
  qcperson: 'QC',
  cultivar: 'Cultivar',
  line1: '',
  line2: 'Line 2',
};

// ---------------------------------------------------------------- rowToForm

test('rowToForm defaults an empty hour to zero crew and one T-Zero, one QC', () => {
  const form = rowToForm(null);
  assert.deepEqual(form, {
    buckers1: 0, trimmers1: 0, tzero1: 1, qcperson: 1, cultivar1: '',
    tops1: 0, smalls1: 0,
    buckers2: 0, trimmers2: 0, tzero2: 1, cultivar2: '',
    tops2: 0, smalls2: 0,
    qcNotes: '',
  });
});

test('rowToForm keeps an explicit zero T-Zero rather than replacing it with 1', () => {
  const form = rowToForm({ tzero1: 0, tzero2: 0, qcperson: 0 });
  assert.equal(form.tzero1, 0);
  assert.equal(form.tzero2, 0);
  assert.equal(form.qcperson, 0);
});

test('rowToForm carries saved values through', () => {
  const form = rowToForm({
    buckers1: 4, trimmers1: 12, tzero1: 1, qcperson: 2, cultivar1: '2025 Lifter',
    tops1: 17.1, smalls1: 3.4, trimmers2: 3, tops2: 2.5, cultivar2: '2025 Cherry',
    qcNotes: '[Reason: wet material]',
  });
  assert.equal(form.trimmers1, 12);
  assert.equal(form.tops1, 17.1);
  assert.equal(form.cultivar2, '2025 Cherry');
  assert.equal(form.qcNotes, '[Reason: wet material]');
});

// ------------------------------------------------------------ formToPayload

const PAYLOAD_KEYS = [
  'date', 'timeSlot',
  'buckers1', 'trimmers1', 'tzero1', 'cultivar1', 'tops1', 'smalls1',
  'buckers2', 'trimmers2', 'tzero2', 'cultivar2', 'tops2', 'smalls2',
  'qcperson', 'qcNotes',
  'effectiveTrimmers1', 'effectiveTrimmers2',
];

test('formToPayload sends exactly the eighteen contract keys, no more', () => {
  const payload = formToPayload(rowToForm(null), {
    date: '2026-09-02',
    slot: '7:00 AM – 8:00 AM',
    effective: { effectiveTrimmers1: 0, effectiveTrimmers2: 0 },
  });
  assert.deepEqual(Object.keys(payload).sort(), [...PAYLOAD_KEYS].sort());
});

test('formToPayload types every key: ints for crew, floats for pounds, strings for text', () => {
  // Values arrive as strings from DOM inputs; the wire must carry numbers.
  const form = {
    buckers1: '4', trimmers1: '12', tzero1: '1', qcperson: '2',
    cultivar1: '2025 Lifter', tops1: '17.1', smalls1: '3.4',
    buckers2: '1', trimmers2: '3', tzero2: '0',
    cultivar2: '2025 Cherry', tops2: '2.5', smalls2: '0.5',
    qcNotes: 'ran long',
  };
  const payload = formToPayload(form, {
    date: '2026-09-02',
    slot: '9:00 AM – 10:00 AM',
    effective: { effectiveTrimmers1: 11, effectiveTrimmers2: 3 },
  });

  assert.deepEqual(payload, {
    date: '2026-09-02',
    timeSlot: '9:00 AM – 10:00 AM',
    buckers1: 4,
    trimmers1: 12,
    tzero1: 1,
    cultivar1: '2025 Lifter',
    tops1: 17.1,
    smalls1: 3.4,
    buckers2: 1,
    trimmers2: 3,
    tzero2: 0,
    cultivar2: '2025 Cherry',
    tops2: 2.5,
    smalls2: 0.5,
    qcperson: 2,
    qcNotes: 'ran long',
    effectiveTrimmers1: 11,
    effectiveTrimmers2: 3,
  });

  for (const key of ['buckers1', 'trimmers1', 'tzero1', 'buckers2', 'trimmers2', 'tzero2', 'qcperson']) {
    assert.equal(Number.isInteger(payload[key]), true, `${key} must be an integer`);
  }
  for (const key of ['tops1', 'smalls1', 'tops2', 'smalls2', 'effectiveTrimmers1', 'effectiveTrimmers2']) {
    assert.equal(typeof payload[key], 'number', `${key} must be a number`);
  }
  for (const key of ['date', 'timeSlot', 'cultivar1', 'cultivar2', 'qcNotes']) {
    assert.equal(typeof payload[key], 'string', `${key} must be a string`);
  }
});

test('formToPayload sends 0 for a blank field even though the form loads T-Zero as 1', () => {
  // The ?? 1 in rowToForm is a load-time UI default; the wire default stays
  // || 0 so an emptied field never invents a person on the server.
  const payload = formToPayload({ tzero1: '', qcperson: '', trimmers1: '' }, {
    date: '2026-09-02',
    slot: '7:00 AM – 8:00 AM',
  });
  assert.equal(payload.tzero1, 0);
  assert.equal(payload.qcperson, 0);
  assert.equal(payload.trimmers1, 0);
  assert.equal(payload.cultivar1, '');
  assert.equal(payload.qcNotes, '');
  assert.equal(payload.effectiveTrimmers1, 0);
  assert.equal(payload.effectiveTrimmers2, 0);
});

// -------------------------------------------------------------- predicates

test('crew and production predicates read trimmers and tops only', () => {
  assert.equal(hasCrew({ trimmers1: '0', trimmers2: '3' }), true);
  assert.equal(hasCrew({ trimmers1: 0, trimmers2: 0, buckers1: 4 }), false);
  assert.equal(hasProduction({ tops1: '0', tops2: '2.5' }), true);
  assert.equal(hasProduction({ tops1: 0, tops2: 0, smalls1: 9 }), false, 'smalls are a byproduct');
  assert.equal(rowTops({ tops1: 10, tops2: 2.5 }), 12.5);
  assert.equal(rowTops(null), 0);
  assert.equal(rowHasLine2({ trimmers2: 3 }), true);
  assert.equal(rowHasLine2({ tops2: 1 }), true);
  assert.equal(rowHasLine2({ trimmers1: 12, tops1: 17 }), false);
});

// ---------------------------------------------------- crew log / effective

test('startCrewLog seeds at the top of the hour, and stays empty with no crew', () => {
  assert.deepEqual(startCrewLog({ trimmers1: 12, trimmers2: 0 }, 420, 437), [
    { minutesMark: 420, trimmers1: 12, trimmers2: 0 },
  ]);
  assert.deepEqual(startCrewLog({ trimmers1: 0, trimmers2: 0 }, 420, 437), []);
  // A missing slot start falls back to now, so crew added at :20 is not
  // credited with the first twenty minutes.
  assert.deepEqual(startCrewLog({ trimmers1: 5 }, undefined, 437), [
    { minutesMark: 437, trimmers1: 5, trimmers2: 0 },
  ]);
});

test('recordCrewChange appends on a trimmer move and returns the same array otherwise', () => {
  const log = [{ minutesMark: 420, trimmers1: 12, trimmers2: 0 }];
  const same = recordCrewChange(log, { trimmers1: '12', trimmers2: '0' }, 450);
  assert.equal(same, log, 'unchanged crew must not churn the log');

  const next = recordCrewChange(log, { trimmers1: '10', trimmers2: '0' }, 450);
  assert.notEqual(next, log);
  assert.deepEqual(next, [
    { minutesMark: 420, trimmers1: 12, trimmers2: 0 },
    { minutesMark: 450, trimmers1: 10, trimmers2: 0 },
  ]);

  // A bucker move is not a crew change for target purposes.
  assert.equal(recordCrewChange(next, { trimmers1: 10, trimmers2: 0 }, 455), next);
});

test('effectiveTrimmers weights the hour: 12 until :30 then 10 is 11.0', () => {
  const log = [
    { minutesMark: 420, trimmers1: 12, trimmers2: 0 },
    { minutesMark: 450, trimmers1: 10, trimmers2: 0 },
  ];
  const eff = effectiveTrimmers({
    row: null,
    form: { trimmers1: '10', trimmers2: '0' },
    log,
    slotStart: 420,
    slotEnd: 480,
    nowMinutes: 480,
    isOpen: true,
  });
  assert.deepEqual(eff, { effectiveTrimmers1: 11, effectiveTrimmers2: 0 });
});

test('effectiveTrimmers only weights up to now, not to the end of the hour', () => {
  const log = [
    { minutesMark: 420, trimmers1: 12, trimmers2: 0 },
    { minutesMark: 450, trimmers1: 0, trimmers2: 0 },
  ];
  const eff = effectiveTrimmers({
    log, slotStart: 420, slotEnd: 480, nowMinutes: 450, isOpen: true,
    form: { trimmers1: 0 },
  });
  assert.equal(eff.effectiveTrimmers1, 12, 'the unworked half hour must not dilute the average');
});

test('a server-computed effectiveTrimmers1 wins for any hour not being edited', () => {
  const row = { effectiveTrimmers1: 8.5, effectiveTrimmers2: 2, trimmers1: 12, trimmers2: 3 };
  assert.deepEqual(
    effectiveTrimmers({ row }),
    { effectiveTrimmers1: 8.5, effectiveTrimmers2: 2 },
  );
  // The ribbon reads a past hour with no form of its own.
  assert.deepEqual(
    effectiveTrimmers({ row, form: null, isOpen: true }),
    { effectiveTrimmers1: 8.5, effectiveTrimmers2: 2 },
  );
});

test('the hour being edited weights live, even once its row carries an effective value', () => {
  // main.js writes the sent payload back into dayData, so the open hour's row
  // holds an effectiveTrimmers1 from its own first autosave. Honouring it would
  // freeze the hour on that number and make the weighting below unreachable in
  // the one case it exists for.
  const row = { effectiveTrimmers1: 12, effectiveTrimmers2: 3, trimmers1: 12, trimmers2: 3 };
  const eff = effectiveTrimmers({
    row,
    form: { trimmers1: '10', trimmers2: '3' },
    log: [
      { minutesMark: 420, trimmers1: 12, trimmers2: 3 },
      { minutesMark: 450, trimmers1: 10, trimmers2: 3 },
    ],
    slotStart: 420, slotEnd: 480, nowMinutes: 480, isOpen: true,
  });
  assert.deepEqual(eff, { effectiveTrimmers1: 11, effectiveTrimmers2: 3 });
});

test('effectiveTrimmers falls back to raw form when open, raw row when closed, zero otherwise', () => {
  assert.deepEqual(
    effectiveTrimmers({ form: { trimmers1: '9', trimmers2: '2' }, isOpen: true, log: [] }),
    { effectiveTrimmers1: 9, effectiveTrimmers2: 2 },
  );
  assert.deepEqual(
    effectiveTrimmers({ row: { trimmers1: 7, trimmers2: 1 }, isOpen: false }),
    { effectiveTrimmers1: 7, effectiveTrimmers2: 1 },
  );
  assert.deepEqual(
    effectiveTrimmers({}),
    { effectiveTrimmers1: 0, effectiveTrimmers2: 0 },
  );
});

test('a log with one entry is not a mid-hour change, so raw form values are used', () => {
  const eff = effectiveTrimmers({
    log: [{ minutesMark: 420, trimmers1: 12, trimmers2: 0 }],
    form: { trimmers1: '12' },
    slotStart: 420, slotEnd: 480, nowMinutes: 430, isOpen: true,
  });
  assert.deepEqual(eff, { effectiveTrimmers1: 12, effectiveTrimmers2: 0 });
});

// -------------------------------------------------------- target and ticks

test('hourTarget is trimmers by rate by the slot multiplier', () => {
  assert.equal(hourTarget({ trimmers: 16, targetRate: 0.9, multiplier: 1 }), 14.4);
  assert.equal(hourTarget({ trimmers: 16, targetRate: 0.9, multiplier: 0.33 }), 16 * 0.9 * 0.33);
  assert.equal(hourTarget({}), 0);
});

test('tickState: met at target, near from 90 percent, short below', () => {
  assert.equal(tickState({ row: { tops1: 10 }, target: 10 }), 'met');
  assert.equal(tickState({ row: { tops1: 12 }, target: 10 }), 'met');
  assert.equal(tickState({ row: { tops1: 9 }, target: 10 }), 'near');
  assert.equal(tickState({ row: { tops1: 8.99 }, target: 10 }), 'short');
  assert.equal(tickState({ row: { tops1: 5, tops2: 5 }, target: 10 }), 'met', 'both lines count');
});

test('tickState: production with no target still counts as met', () => {
  assert.equal(tickState({ row: { tops1: 4 }, target: 0 }), 'met');
});

test('tickState: the open hour reads open, not short, until pounds are entered', () => {
  // Pounds are entered at the END of the hour (index.js:2050), so the live hour
  // sits with crew and no tops for most of its life.
  assert.equal(tickState({ row: { trimmers1: 12 }, target: 10, isOpen: true }), 'open');
  assert.equal(tickState({ row: null, target: 0, isOpen: true }), 'open');
});

test('tickState: an untouched past hour is none, a worked one with no pounds is short', () => {
  assert.equal(tickState({ row: null, target: 10 }), 'none');
  assert.equal(tickState({ row: {}, target: 10 }), 'none');
  assert.equal(tickState({ row: { trimmers1: 12 }, target: 10 }), 'short');
});

// ------------------------------------------------------------ crew changes

test('crewChanges writes the exact strings the digest parses back out', () => {
  const original = rowToForm({ trimmers1: 12, buckers1: 4, qcperson: 1, trimmers2: 3 });
  const current = { ...original, trimmers1: '10', qcperson: '2', trimmers2: '4' };
  const changes = crewChanges(original, current, LABELS);

  // Line 1's label is the empty string, so the string carries a space before
  // the colon; hub/format.js noteLines() splits on /\s*:\s*/ and depends on it.
  assert.deepEqual(changes, [
    'Trimmers : 12 → 10',
    'QC: 1 → 2',
    'Trimmers Line 2: 3 → 4',
  ]);
});

test('crewChanges reports in CREW_FIELDS order and ignores string-vs-number noise', () => {
  const original = rowToForm({ buckers1: 4, trimmers1: 12, cultivar1: '2025 Lifter' });
  const current = { ...original, buckers1: '4', trimmers1: 12, cultivar1: '2025 Cherry' };
  assert.deepEqual(crewChanges(original, current, LABELS), ['Cultivar : 2025 Lifter → 2025 Cherry']);
  assert.deepEqual(crewChanges(original, original, LABELS), []);
  // No snapshot means the hour was never loaded; every field would otherwise
  // read as a change from zero and write a note nobody caused.
  assert.deepEqual(crewChanges(null, current, LABELS), []);
});

test('crewChangeNote wraps the changes in the bracket the digest looks for', () => {
  assert.equal(
    crewChangeNote(['Trimmers : 12 → 10', 'QC: 1 → 2'], '9:58 AM'),
    '[Crew change 9:58 AM: Trimmers : 12 → 10, QC: 1 → 2]',
  );
});

// ----------------------------------------------------------------- isDirty

test('isDirty compares numerically, so a freshly loaded form is clean', () => {
  const snapshot = rowToForm({ trimmers1: 12, tops1: 17.1, cultivar1: '2025 Lifter' });
  const form = { ...snapshot, trimmers1: '12', tops1: '17.1', smalls1: '0' };
  assert.equal(isDirty(form, snapshot), false, 'string form values must not read as dirty');
});

test('isDirty catches a real edit on every kind of field', () => {
  const snapshot = rowToForm({ trimmers1: 12, tops1: 17.1, cultivar1: '2025 Lifter' });
  assert.equal(isDirty({ ...snapshot, trimmers1: '11' }, snapshot), true);
  assert.equal(isDirty({ ...snapshot, tops1: '17.2' }, snapshot), true);
  assert.equal(isDirty({ ...snapshot, cultivar1: '2025 Cherry' }, snapshot), true);
  assert.equal(isDirty({ ...snapshot, qcNotes: '[Reason: wet material]' }, snapshot), true);
});

// --------------------------------------------------------------- nextField

test('nextField walks the visible fields and stops at the end of the hour', () => {
  assert.equal(nextField('buckers1', { line2: false }), 'trimmers1');
  assert.equal(nextField('cultivar1', { line2: false }), 'tops1');
  assert.equal(nextField('smalls1', { line2: false }), 'note', 'line 2 is skipped when collapsed');
  assert.equal(nextField('smalls1', { line2: true }), 'buckers2');
  assert.equal(nextField('smalls2', { line2: true }), 'note');
  assert.equal(nextField('note', { line2: true }), null);
  assert.equal(nextField('nope', {}), null);
});

test('FIELD_ORDER covers every crew field and both lines of production', () => {
  for (const field of CREW_FIELDS) assert.ok(FIELD_ORDER.includes(field), field);
  for (const field of LINE2_FIELDS) assert.ok(FIELD_ORDER.includes(field), field);
  assert.equal(FIELD_ORDER[FIELD_ORDER.length - 1], 'note');
});

// -------------------------------------------------------- day totals, pace

const SLOTS = ['7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM'];

test('dayTotals counts only hours with pounds, and excludes the live hour', () => {
  const dayData = {
    [SLOTS[0]]: { tops1: 10 },
    [SLOTS[1]]: { trimmers1: 12 },
    [SLOTS[2]]: { tops1: 8, tops2: 2 },
  };
  assert.deepEqual(dayTotals({ slots: SLOTS, dayData }), { tops: 20, hoursLogged: 2 });
  assert.deepEqual(
    dayTotals({ slots: SLOTS, dayData, excludeSlot: SLOTS[2] }),
    { tops: 10, hoursLogged: 1 },
  );
});

test('paceSummary charges every visible hour up to the last one with production', () => {
  // The gap hour still owes its target: a skipped hour is a real miss.
  const dayData = { [SLOTS[0]]: { tops1: 10 }, [SLOTS[2]]: { tops1: 10 } };
  const pace = paceSummary({ slots: SLOTS, dayData, targetFor: () => 10 });
  assert.deepEqual(pace, { actual: 20, target: 30, diff: -10 });
});

test('paceSummary stops at the last hour with production, not at the end of the day', () => {
  const dayData = { [SLOTS[0]]: { tops1: 12 } };
  assert.deepEqual(
    paceSummary({ slots: SLOTS, dayData, targetFor: () => 10 }),
    { actual: 12, target: 10, diff: 2 },
  );
});

test('paceSummary counts the live hour once its pounds are typed', () => {
  const dayData = { [SLOTS[0]]: { tops1: 10 } };
  const args = { slots: SLOTS, dayData, targetFor: () => 10, liveSlot: SLOTS[1] };
  assert.deepEqual(
    paceSummary({ ...args, liveTops: 0 }),
    { actual: 10, target: 10, diff: 0 },
    'an empty live hour must not be charged its target yet',
  );
  assert.deepEqual(
    paceSummary({ ...args, liveTops: 7 }),
    { actual: 17, target: 20, diff: -3 },
  );
});

test('paceSummary skips hidden hours and is all zeros before the day starts', () => {
  const dayData = { [SLOTS[1]]: { tops1: 9 } };
  const pace = paceSummary({
    slots: SLOTS,
    dayData,
    targetFor: () => 10,
    isVisible: (slot) => slot !== SLOTS[0],
  });
  assert.deepEqual(pace, { actual: 9, target: 10, diff: -1 });

  assert.deepEqual(
    paceSummary({ slots: SLOTS, dayData: {}, targetFor: () => 10 }),
    { actual: 0, target: 0, diff: 0 },
  );
});
