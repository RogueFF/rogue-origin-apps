// The two wasm byte strings src/harfbuzz-shim.js swaps for precompiled modules.
// Kept apart from the shim (which imports .wasm and only loads under wrangler) so a
// Node test can pin them against the installed satori and harfbuzzjs.

// Byte length of harfbuzzjs@0.10.0 hb.wasm, the exact binary satori@0.63.0 embeds.
export const HB_WASM_BYTES = 381964;

// Emscripten's convertJsFunctionToWasm output for signature 'vi': the trampoline
// hbjs's start-up addFunction compiles (src/wasm/hb-trampoline-vi.wasm is this file).
export const TRAMPOLINE_VI = Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0, 1, 135, 0, 1, 96, 129, 0, 127, 128, 0, 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0,
);
