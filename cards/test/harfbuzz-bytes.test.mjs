// Guards the Workers HarfBuzz shim (src/harfbuzz-shim.js): it swaps exactly these
// byte strings for precompiled modules, so a satori or harfbuzzjs bump that changes
// them must fail here, not as a request workerd cancels as hung.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { HB_WASM_BYTES, TRAMPOLINE_VI } from '../src/harfbuzz-bytes.js';

const require = createRequire(import.meta.url);
const read = (spec) => fs.readFileSync(require.resolve(spec));

test('satori standalone embeds exactly harfbuzzjs hb.wasm, HB_WASM_BYTES long', () => {
  const standalone = fs.readFileSync(new URL('../node_modules/satori/dist/standalone.js', import.meta.url), 'utf8');
  const embedded = [...standalone.matchAll(/"(AGFzbQ[A-Za-z0-9+/=]+)"/g)].map((m) => Buffer.from(m[1], 'base64'));
  assert.equal(embedded.length, 1, 'one embedded wasm binary (HarfBuzz) in satori/standalone');
  const hb = read('harfbuzzjs/hb.wasm');
  assert.equal(hb.length, HB_WASM_BYTES);
  assert.ok(embedded[0].equals(hb), 'embedded HarfBuzz differs from harfbuzzjs/hb.wasm');
});

test('the committed trampoline is the vi module Emscripten builds, and the only addFunction at start-up', () => {
  const file = fs.readFileSync(new URL('../src/wasm/hb-trampoline-vi.wasm', import.meta.url));
  assert.ok(file.equals(Buffer.from(TRAMPOLINE_VI)));
  assert.ok(new WebAssembly.Module(TRAMPOLINE_VI) instanceof WebAssembly.Module);
  const hbjs = fs.readFileSync(require.resolve('harfbuzzjs/hbjs.js'), 'utf8');
  const startup = hbjs.slice(0, hbjs.indexOf('const TRACE_PHASE_DONT_STOP'));
  assert.deepEqual([...startup.matchAll(/addFunction\([^]*?'(\w+)'\)/g)].map((m) => m[1]), ['vi']);
});
