// Regression guard for the note rules: every `notes` string in the captured API
// fixtures must classify exactly as recorded in fixtures/notes-expected.json.
// A rule change that moves any of these real floor notes fails here. To accept
// a deliberate change, regenerate the snapshot and review its diff:
//   UPDATE_NOTES_SNAPSHOT=1 node --test test/notes-snapshot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyNote } from '../src/notes.js';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const SNAPSHOT = new URL('./fixtures/notes-expected.json', import.meta.url);

/** Every distinct `notes` string anywhere in the API fixtures, sorted. */
function fixtureNotes() {
  const notes = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'notes' && typeof inner === 'string') notes.add(inner);
        else walk(inner);
      }
    }
  };
  for (const file of fs.readdirSync(FIXTURES)) {
    if (!file.endsWith('.json') || file === 'notes-expected.json') continue;
    walk(JSON.parse(fs.readFileSync(new URL(file, FIXTURES), 'utf8')));
  }
  return [...notes].sort();
}

test('every note in the API fixtures classifies exactly as the committed snapshot', () => {
  const actual = fixtureNotes().map((note) => ({ note, flag: classifyNote(note) }));
  if (process.env.UPDATE_NOTES_SNAPSHOT) fs.writeFileSync(SNAPSHOT, `${JSON.stringify(actual, null, 2)}\n`);
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.ok(expected.filter((e) => e.note.trim()).length >= 15, 'the snapshot holds the real floor notes');
  assert.deepEqual(actual, expected);
});
