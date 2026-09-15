/**
 * Tests for src/js/floor/reasons.js — the qcNotes grammar (reason line,
 * free text, other bracket lines) and its round trip through parseNotes /
 * composeNotes.
 *
 * Run with `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REASONS, parseNotes, composeNotes } from '../src/js/floor/reasons.js';

test('empty qcNotes parses to all-empty', () => {
  assert.deepEqual(parseNotes(''), { reasons: [], text: '', brackets: [] });
  assert.deepEqual(parseNotes(undefined), { reasons: [], text: '', brackets: [] });
  assert.deepEqual(parseNotes(null), { reasons: [], text: '', brackets: [] });
});

test('round trip is stable: compose then parse gives back the same shape', () => {
  const original = {
    reasons: ['machine', 'wet'],
    text: 'Ran the second bucket dry after lunch.',
    brackets: ['[Crew change 9:58 AM: Trimmers : 12 → 10]'],
  };
  const composed = composeNotes(original);
  const parsed = parseNotes(composed);
  assert.deepEqual(parsed, original);
  // and composing what we just parsed reproduces the same string
  assert.equal(composeNotes(parsed), composed);
});

test('the reason line is always English, in REASONS order, regardless of input order', () => {
  const composed = composeNotes({ reasons: ['crew', 'machine'], text: '', brackets: [] });
  assert.equal(composed, '[Reason: machine down, short crew]');
});

test('a crew-change bracket line survives verbatim and is not mistaken for the reason line', () => {
  const note = '[Crew change 9:58 AM: Trimmers : 12 → 10]';
  const parsed = parseNotes(note);
  assert.deepEqual(parsed, { reasons: [], text: '', brackets: [note] });
  assert.equal(composeNotes(parsed), note);
});

test('a reason line mixed with free text and a crew-change note parses into all three parts', () => {
  const qcNotes = [
    '[Reason: machine down, wet material]',
    'Called maintenance at 9:40.',
    '[Crew change 9:58 AM: Trimmers : 12 → 10]',
  ].join('\n');
  const parsed = parseNotes(qcNotes);
  assert.deepEqual(parsed.reasons, ['machine', 'wet']);
  assert.equal(parsed.text, 'Called maintenance at 9:40.');
  assert.deepEqual(parsed.brackets, ['[Crew change 9:58 AM: Trimmers : 12 → 10]']);
  assert.equal(composeNotes(parsed), qcNotes);
});

test('reason labels parse case-insensitively in Spanish', () => {
  const parsed = parseNotes('[reason: Máquina Parada, Falta Personal]');
  assert.deepEqual(parsed.reasons, ['machine', 'crew']);
});

test('reason labels parse case-insensitively in English', () => {
  const parsed = parseNotes('[REASON: WET MATERIAL]');
  assert.deepEqual(parsed.reasons, ['wet']);
});

test('unknown labels inside the reason bracket are dropped, not left dangling', () => {
  const parsed = parseNotes('[Reason: machine down, some made-up thing]');
  assert.deepEqual(parsed.reasons, ['machine']);
});

test('every REASONS id is unique and has both an en and an es label', () => {
  const ids = REASONS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of REASONS) {
    assert.ok(r.en, `${r.id} missing en label`);
    assert.ok(r.es, `${r.id} missing es label`);
  }
});
