// Real satori + resvg in Node: each fixture card renders to a 1080x1350 PNG.
// The PNGs land in test/out/ (gitignored) so they can be compared by eye with
// docs/plans/assets/2026-10-19-card-*.png.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nodeRuntime } from '../src/runtime-node.mjs';
import { renderPng } from '../src/render.js';
import { FONT_SPECS, fontsFrom } from '../src/fonts.js';
import { cardTree } from '../src/layout.js';
import { models, lockedModels, pngSize } from './helpers.mjs';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

async function render(model) {
  const rt = await nodeRuntime();
  const styleErrors = [];
  const t0 = Date.now();
  const png = await renderPng(cardTree(model), { fonts: rt.fonts, satori: rt.satori, resvg: rt.Resvg, onStyleError: (e) => styleErrors.push(e.message) });
  return { png, ms: Date.now() - t0, styleErrors };
}

test('fontsFrom loads every spec through the loader', () => {
  const asked = [];
  const fonts = fontsFrom((file) => { asked.push(file); return `bytes:${file}`; });
  assert.deepEqual(asked, ['Outfit-Medium.ttf', 'Outfit-SemiBold.ttf', 'JetBrainsMono-Regular.ttf', 'DMSerifDisplay-Italic.ttf']);
  assert.deepEqual(fonts.map(({ name, weight, style }) => [name, weight, style]), [
    ['Outfit', 500, 'normal'], ['Outfit', 600, 'normal'], ['JetBrains Mono', 400, 'normal'], ['DM Serif Display', 400, 'italic'],
  ]);
  assert.equal(fonts[2].data, 'bytes:JetBrainsMono-Regular.ttf');
  assert.equal(FONT_SPECS.length, 4);
});

test('pngSize rejects bytes that are not a PNG', () => {
  assert.throws(() => pngSize(new Uint8Array(32)), /not a PNG/);
});

for (const [name, model] of Object.entries(models())) {
  test(`renders the ${name} card as a 1080x1350 PNG in under 5 s, with no style errors`, async () => {
    const { png, ms, styleErrors } = await render(model);
    assert.ok(png instanceof Uint8Array);
    assert.deepEqual(pngSize(png), { width: 1080, height: 1350 });
    assert.ok(ms < 5000, `${ms} ms`);
    assert.deepEqual(styleErrors, []);
    fs.writeFileSync(new URL(`${name}.png`, OUT), png);
  });
}

test('renders the locked weekly card', async () => {
  const { png, styleErrors } = await render(lockedModels().weekly);
  assert.deepEqual(pngSize(png), { width: 1080, height: 1350 });
  assert.deepEqual(styleErrors, []);
  fs.writeFileSync(new URL('weekly-locked.png', OUT), png);
});

test('the Node runtime initialises once', async () => {
  const [a, b] = await Promise.all([nodeRuntime(), nodeRuntime()]);
  assert.equal(a, b);
});
