// Node runtime for the card renderer (tests, local renders): the same satori
// standalone build the worker uses, with layout.wasm and resvg's wasm read from
// node_modules, and the fonts from cards/fonts/. Node compiles wasm from bytes,
// so the Workers HarfBuzz shim is not needed (and must not be loaded) here.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import satori, { init as initSatori } from 'satori/standalone';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { fontsFrom } from './fonts.js';

const require = createRequire(import.meta.url);
let ready = null;

/** `{ satori, Resvg, fonts }`, initialised once per process. */
export function nodeRuntime() {
  if (!ready) {
    ready = (async () => {
      await initSatori(fs.readFileSync(require.resolve('satori/layout.wasm')));
      await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      const fonts = fontsFrom((file) => fs.readFileSync(new URL(`../fonts/${file}`, import.meta.url)));
      return { satori, Resvg, fonts };
    })();
  }
  return ready;
}
