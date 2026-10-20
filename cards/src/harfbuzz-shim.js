/* global WebAssembly */
// satori@0.63 shapes text with HarfBuzz (harfbuzzjs 0.10, an Emscripten build), and
// even its standalone build carries that HarfBuzz as base64 wasm compiled at run
// time. Workers refuse to compile wasm from bytes ("Wasm code generation disallowed
// by embedder"), so this module, imported before satori, hands Emscripten the same
// binaries precompiled by wrangler (CompiledWasm rule) for exactly two byte strings:
//   1. hb.wasm itself (WebAssembly.instantiate(bytes) while satori evaluates);
//   2. the 34-byte 'vi' trampoline Emscripten's addFunction compiles for the one
//      callback hbjs registers at start-up (new WebAssembly.Module(bytes)).
// Anything else falls through to the real WebAssembly API untouched. Workers only:
// Node compiles wasm from bytes natively and must not load this.
import hbModule from 'harfbuzzjs/hb.wasm';
import trampolineViModule from './wasm/hb-trampoline-vi.wasm';
import { HB_WASM_BYTES, TRAMPOLINE_VI } from './harfbuzz-bytes.js';

const bytesOf = (src) => {
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return null;
};
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Emscripten's environment probe reads self.location.href in a worker scope;
// workerd has no location. A file name keeps the probe off that branch.
if (typeof globalThis.__filename === 'undefined') globalThis.__filename = '/satori-harfbuzz.js';

const RealModule = WebAssembly.Module;
const realInstantiate = WebAssembly.instantiate.bind(WebAssembly);

// Satori starts HarfBuzz while its module evaluates (global scope). An async
// instantiate there is never pumped for the request that later awaits it (workerd
// cancels the request as hung), so the Instance is made synchronously and the
// promise resolves in microtasks.
WebAssembly.instantiate = function instantiate(source, imports) {
  const bytes = bytesOf(source);
  if (!bytes || bytes.length !== HB_WASM_BYTES) return realInstantiate(source, imports);
  return Promise.resolve({ module: hbModule, instance: new WebAssembly.Instance(hbModule, imports) });
};

function Module(source) {
  const bytes = bytesOf(source);
  if (bytes && sameBytes(bytes, TRAMPOLINE_VI)) return trampolineViModule;
  return new RealModule(source);
}
Module.prototype = RealModule.prototype; // keeps instanceof WebAssembly.Module true
Module.exports = RealModule.exports;
Module.imports = RealModule.imports;
Module.customSections = RealModule.customSections;
WebAssembly.Module = Module;
