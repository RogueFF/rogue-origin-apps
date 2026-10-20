// Laid-out geometry from satori itself (onNodeDetected gives each box in canvas
// px): sections stack without overlapping, stay inside the card's padding, and
// the foot never leaves the card, even when a floor note is very long. Taffy
// rounds every box to whole px on its own, so edges may disagree by 1 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '../src/runtime-node.mjs';
import { cardTree, CANVAS } from '../src/layout.js';
import { models, lockedModels } from './helpers.mjs';

const PAD = { top: 52, right: 56, bottom: 40, left: 56 };
const INNER = { left: PAD.left, right: CANVAS.width - PAD.right };
const FOOT_LINE = 22;
const FOOT_TOP = CANVAS.height - PAD.bottom - FOOT_LINE; // where the mock has the foot line: 1288
const LOWEST = CANVAS.height - 12; // the foot may slide into the bottom padding down to here

async function boxes(model) {
  const rt = await nodeRuntime();
  const nodes = [];
  await rt.satori(cardTree(model), { width: CANVAS.width, height: CANVAS.height, fonts: rt.fonts, onNodeDetected: (n) => nodes.push(n) });
  const pick = (key, value) => nodes.filter((n) => n.props?.[key] === value).map(({ left, top, width, height }) => ({ left, top, right: left + width, bottom: top + height, height }));
  const section = (name) => pick('data-section', name)[0];
  return { section, role: (name) => pick('data-role', name) };
}

const SECTIONS = ['head', 'tiles', 'chart', 'minis', 'flags', 'foot'];
const near = (a, b) => a <= b + 1;

function assertFits(g, name, { clipped = false } = {}) {
  let prev = PAD.top;
  for (const s of SECTIONS) {
    const box = g.section(s);
    assert.ok(near(prev, box.top), `${name}: ${s} starts at ${box.top}, above ${prev}`);
    assert.ok(near(INNER.left, box.left) && near(box.right, INNER.right), `${name}: ${s} spans ${box.left}–${box.right}`);
    prev = box.bottom;
  }
  const foot = g.section('foot');
  assert.ok(near(foot.bottom, LOWEST) && foot.height >= FOOT_LINE - 1, `${name}: foot ${foot.top}–${foot.bottom}`);
  for (const r of ['tile', 'mini', 'flag']) {
    for (const box of g.role(r)) assert.ok(near(INNER.left, box.left) && near(box.right, INNER.right), `${name}: ${r} spans ${box.left}–${box.right}`);
  }
  if (clipped) return;
  const flags = g.section('flags');
  for (const box of g.role('flag')) assert.ok(near(box.bottom, flags.bottom), `${name}: flag ${box.top}–${box.bottom} clipped at ${flags.bottom}`);
}

const cards = { ...models(), 'weekly-locked': lockedModels().weekly, 'eod-locked': lockedModels().eod };
for (const [name, model] of Object.entries(cards)) {
  test(`${name}: sections stack inside the card without overlapping; the foot sits where the mock has it`, async () => {
    const g = await boxes(model);
    assertFits(g, name);
    assert.ok(Math.abs(g.section('foot').top - FOOT_TOP) <= 1, `foot line at ${g.section('foot').top}`);
  });
}

test('the tile row, minis and flags fill the inner width', async () => {
  const g = await boxes(models().weekly);
  for (const r of ['tile', 'mini']) {
    const row = g.role(r);
    assert.ok(Math.abs(row[0].left - INNER.left) < 0.5 && Math.abs(row.at(-1).right - INNER.right) < 0.5, r);
  }
});

const LONG = 'El producto esta muy humedo y tiene mucha hoja, las volsas que quedaron a vajo estan muy humedas, piensen que se va aser porque se pueden echar a perder y hay que colgar todo otra vez antes de que llegue el camion de la tarde';

test('a very long flag is held to two lines; the foot slides down to make room and nothing is clipped', async () => {
  const base = models().eod;
  const one = await boxes({ ...base, flags: [{ ...base.flags[0], text: LONG }, ...base.flags.slice(1)] });
  const plain = await boxes(base);
  assert.ok(one.role('flag')[0].height <= plain.role('flag')[0].height + 31, `long flag is ${one.role('flag')[0].height} px tall`);
  assertFits(one, 'eod with one long flag');
  assert.ok(one.section('foot').top > FOOT_TOP + 1, 'the foot gave way');
});

test('three very long flags: the foot keeps its line on the card; only the last flag is clipped', async () => {
  const base = models().weekly;
  const g = await boxes({ ...base, flags: base.flags.map((f) => ({ ...f, text: LONG })) });
  assertFits(g, 'weekly with three long flags', { clipped: true });
  const flags = g.section('flags');
  assert.ok(g.role('flag').slice(0, 2).every((box) => near(box.bottom, flags.bottom)), 'Act and Watch stay whole');
});
