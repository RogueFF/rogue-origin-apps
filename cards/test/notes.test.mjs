import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyNote, translate, themes } from '../src/notes.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('classifies floor notes', () => {
  assert.deepEqual(classifyNote('las volsas que quedaron a vajo estan muy humedas piensen que se va aser porque se pueden echar a perder'),
    { kind: 'bad', text: 'Bags stored below are very wet, spoilage risk, need a plan' });
  assert.deepEqual(classifyNote('trae un poquito de mold y algunos gusanos'), { kind: 'warn', text: 'A bit of mold and some worms' });
  assert.equal(classifyNote('[Crew change 11:30 AM: Buckers : 11 → 9]'), null);
  assert.equal(classifyNote(''), null);
  assert.equal(classifyNote(null), null);
});

test('classifies the raw API note (double spaces, trailing space) the same way', () => {
  const raw = fixture('scoreboard-2026-10-16.json').scoreboard.hourlyRates.find((h) => h.notes.trim()).notes;
  assert.match(raw, / {2}/, 'the fixture really carries the double spaces');
  assert.deepEqual(classifyNote(raw), { kind: 'bad', text: 'Bags stored below are very wet, spoilage risk, need a plan' });
});

test('crew-change markers are stripped, alone or several, and never make a flag', () => {
  assert.equal(classifyNote('[Crew change 10:06 AM: Buckers : 10 → 3, Podadores : 10 → 4]\n[Crew change 9:35 AM: T-Zero : 1 → 0], \n'), null);
  assert.equal(classifyNote('[Crew change 12:42 PM: Cultivar :  → 2025 - Lifter / Sungrown]'), null);
  assert.equal(classifyNote('\n'), null);
  assert.equal(classifyNote('les estoy ay,Hubo movimiento de personal a ultima hora '), null);
  const flagged = classifyNote('[Crew change 10:06 AM: Buckers : 10 → 3, Podadores : 10 → 4],trae mucho mold y esta mix ');
  assert.equal(flagged.kind, 'warn');
  assert.doesNotMatch(flagged.text, /Crew change|\[|^,/);
  assert.match(flagged.text, /^Has a lot of mold and /);
});

test('translate keeps unknown words and maps the floor vocabulary', () => {
  assert.equal(translate('el producto esta muy humedo y tiene mucha hoja'), 'Product is very wet and has a lot of leaf');
  assert.equal(translate('El producto esta muy humedo y tiene mucha hoja ,Tiene mucho gusano '),
    'Product is very wet and has a lot of leaf, has a lot of worms');
  assert.equal(translate('se yevaron la gente  a colgar   '), 'Se yevaron la gente a hang');
  assert.equal(translate('no se está pasando por el costal'), 'Not going through the sack');
  assert.equal(translate('esta humedo porque'), 'Esta wet');
});

test('themes lists the matched themes in a fixed order', () => {
  assert.deepEqual(themes('trae mold y gusanos, esta humedo'), ['mold', 'worms', 'moisture']);
  assert.deepEqual(themes('mucha hoja y está HÚMEDO'), ['moisture', 'leaf']);
  assert.deepEqual(themes('tenemos la meta un poco alta'), []);
});
