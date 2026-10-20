// Workers runtime for the card renderer: satori (standalone build) + resvg, both
// initialised from wasm modules wrangler compiles at build time (CompiledWasm rule),
// because Workers refuse to compile wasm from bytes at run time. Fonts arrive as
// ArrayBuffers through the Data rule for **/*.ttf.
// The shim must evaluate before satori does, so it is imported first, and no other
// module in the worker may import satori directly (render.js takes it as a parameter).
import './harfbuzz-shim.js';
import satori, { init as initSatori } from 'satori/standalone';
import layoutWasm from 'satori/layout.wasm';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import outfitMedium from '../fonts/Outfit-Medium.ttf';
import outfitSemiBold from '../fonts/Outfit-SemiBold.ttf';
import jetBrainsMono from '../fonts/JetBrainsMono-Regular.ttf';
import dmSerifItalic from '../fonts/DMSerifDisplay-Italic.ttf';
import { fontsFrom } from './fonts.js';

const FONT_BYTES = {
  'Outfit-Medium.ttf': outfitMedium,
  'Outfit-SemiBold.ttf': outfitSemiBold,
  'JetBrainsMono-Regular.ttf': jetBrainsMono,
  'DMSerifDisplay-Italic.ttf': dmSerifItalic,
};
const FONTS = fontsFrom((file) => FONT_BYTES[file]);

let ready = null;

async function initResvg() {
  try {
    await initWasm(resvgWasm);
  } catch (err) {
    // A second initWasm in the same isolate throws; the first one already won.
    if (!/already initiali[sz]ed/i.test(String(err && err.message))) throw err;
  }
}

/** Initialise satori + resvg once per isolate. */
export function workersRuntime() {
  if (!ready) {
    ready = Promise.all([initSatori(layoutWasm), initResvg()])
      .then(() => ({ satori, Resvg, fonts: FONTS }))
      .catch((err) => {
        ready = null; // let the next request try again instead of caching the failure
        throw err;
      });
  }
  return ready;
}
