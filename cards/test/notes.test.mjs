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

test('standalone mucho/mucha/muchos/muchas → "a lot of", while longer phrases still win', () => {
  assert.equal(translate('tiene mucha humedad'), 'Has a lot of humedad');
  assert.equal(translate('mucho trabajo'), 'A lot of trabajo');
  assert.equal(translate('muchos tallos y muchas ramas'), 'A lot of tallos and a lot of ramas');
  assert.equal(translate('tiene mucha hoja'), 'Has a lot of leaf');
  assert.equal(translate('muchos gusanos'), 'A lot of worms');
  assert.equal(translate('mucho mold'), 'A lot of mold');
});

test('spoilage is any form of "ech… a perder" or "se va(n) a perder"', () => {
  for (const note of ['se echan a perder las bolsas', 'se va a perder el producto', 'las bolsas se van a perder', 'se pueden echar a perder']) {
    const flag = classifyNote(note);
    assert.equal(flag?.kind, 'bad', note);
    assert.match(flag.text, /spoil/i, note);
  }
});

test('theme markers are whole words and a negation in the same clause cancels them', () => {
  for (const note of ['moldura', 'deshojando', 'la humedad del cuarto esta bien', 'no hay mold', 'sin gusanos', 'no tiene gusanos', 'no trae hoja']) {
    assert.equal(classifyNote(note), null, note);
    assert.deepEqual(themes(note), [], note);
  }
  // the negation reaches only to the end of its own clause
  assert.deepEqual(themes('no hay mold, pero trae gusanos'), ['worms']);
  assert.deepEqual(themes('trae gusanos, no hay mold'), ['worms']);
  assert.deepEqual(themes('gusanos y hoja; sin mold'), ['worms', 'leaf']);
});

test('humedad is moisture unless its clause says it is fine or negates it', () => {
  assert.deepEqual(classifyNote('tiene mucha humedad'), { kind: 'warn', text: 'Has a lot of humedad' });
  assert.deepEqual(themes('tiene mucha humedad'), ['moisture']);
  for (const note of ['la humedad del cuarto esta bien', 'la humedad del cuarto está bien', 'humedad normal', 'humedad ok', 'el cuarto esta seco', 'ya no trae mold', 'ya no hay humedad']) {
    assert.equal(classifyNote(note), null, note);
    assert.deepEqual(themes(note), [], note);
  }
  // a reassurance that is itself negated is a complaint
  assert.deepEqual(themes('la humedad no esta bien'), ['moisture']);
  assert.deepEqual(themes('la humedad no es normal'), ['moisture']);
});

test('y / pero / e split clauses, so a negation or reassurance stays in its own clause', () => {
  assert.deepEqual(classifyNote('no hay mold y tiene gusanos'), { kind: 'warn', text: 'No hay mold and has worms' });
  assert.deepEqual(themes('no hay mold y tiene gusanos'), ['worms']);
  assert.deepEqual(themes('trae mold y gusanos'), ['mold', 'worms']);
  assert.deepEqual(themes('sin mold pero mucha humedad'), ['moisture']);
  assert.deepEqual(themes('la humedad esta bien e hojas'), ['leaf']);
  assert.deepEqual(themes('mucha humedad, el cuarto esta bien'), ['moisture']);
});

/** Asserts a note's flag kind and its themes. */
function flags(note, kind, expectedThemes) {
  assert.equal(classifyNote(note)?.kind ?? null, kind, note);
  assert.deepEqual(themes(note), expectedThemes, note);
}

test('a reassurance cancels only the markers before it; bien before a word is "very"', () => {
  flags('el producto viene bien humedo', 'warn', ['moisture']);
  flags('bien humedas las volsas', 'warn', ['moisture']);
  flags('viene bien feo el mold', 'warn', ['mold']);
  flags('mold bien feo', 'warn', ['mold']);
  flags('la humedad del cuarto esta bien', null, []);
  flags('humedad normal', null, []);
  flags('ok, humedad', 'warn', ['moisture']);
  flags('normal la mañana pero humedo', 'warn', ['moisture']);
});

test('seco/seca/secos/secas cancels only an earlier moisture marker', () => {
  flags('hojas secas', 'warn', ['leaf']);
  flags('medio seco con mold', 'warn', ['mold']);
  flags('las volsas humedas ya estan secas', null, []);
  flags('seco ahora pero humedo', 'warn', ['moisture']);
});

test('a negation reaches at most two words to its marker, and ni chains it', () => {
  flags('no hay suficiente gente trae mucho mold', 'warn', ['mold']);
  flags('sin embargo trae mucho mold', 'warn', ['mold']);
  flags('ya no trae mold', null, []);
  flags('no hay mold y tiene gusanos', 'warn', ['worms']);
  flags('no hay mold ni gusanos', null, []);
  flags('no tiene nada de mold', null, []);
  flags('no hay mold ni gusanos ni hoja', null, []);
});

test('spoilage needs the reflexive se (or pueden echar), and a negation cancels it', () => {
  assert.equal(classifyNote('la gente va a perder tiempo'), null);
  assert.equal(classifyNote('no se va a perder'), null);
  assert.equal(classifyNote('no se van a echar a perder'), null);
  for (const note of ['se echan a perder las bolsas', 'se van a echar a perder', 'pueden echar a perder el producto', 'se le va a perder']) {
    assert.equal(classifyNote(note)?.kind, 'bad', note);
  }
  assert.deepEqual(
    classifyNote('las volsas  que quedaron a vajo estan muy humedas  piensen que se va aser  porque se pueden echar a perder '),
    { kind: 'bad', text: 'Bags stored below are very wet, spoilage risk, need a plan' },
  );
});

test('mojado, a dropped h (umedo) and moho are markers too', () => {
  for (const note of ['mojado', 'mojada', 'mojados', 'las volsas mojadas', 'umedo', 'umeda']) flags(note, 'warn', ['moisture']);
  flags('trae moho', 'warn', ['mold']);
  assert.equal(translate('trae moho'), 'Has mold');
  assert.equal(translate('producto mojado'), 'Product wet');
  assert.equal(translate('esta umedo'), 'Esta wet');
});

test('accents: composed and decomposed forms match the same unaccented table row', () => {
  assert.equal(translate('está muy húmedo'), 'Is very wet');
  assert.equal(translate('esta muy humedo'), 'Is very wet');
  assert.equal(translate('húmedo'), 'Wet');
  assert.equal(translate('ESTÁN MUY HÚMEDAS'), 'Are very wet');
  assert.deepEqual(themes('está muy húmedo'), ['moisture']);
  assert.deepEqual(themes('húmedo'), ['moisture']);
  assert.equal(classifyNote('húmedo').kind, 'warn');
});

test('words the table does not know keep their accents', () => {
  assert.equal(translate('año húmedo'), 'Año wet');
  assert.equal(translate('ya está mucho mejor'), 'Ya está a lot of mejor');
});

test('themes lists the matched themes in a fixed order', () => {
  assert.deepEqual(themes('trae mold y gusanos, esta humedo'), ['mold', 'worms', 'moisture']);
  assert.deepEqual(themes('mucha hoja y está HÚMEDO'), ['moisture', 'leaf']);
  assert.deepEqual(themes('tenemos la meta un poco alta'), []);
});

test('a staff move note translates (the midday crew-drop line quotes it)', () => {
  assert.equal(translate('Hubo movimiento de personal a ultima hora '), 'Staff moved at the last minute');
  assert.equal(translate('hubo movimiento de personal a última hora'), 'Staff moved at the last minute');
  assert.equal(classifyNote('Hubo movimiento de personal a ultima hora '), null);
});
