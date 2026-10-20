// Satori element tree → SVG → PNG. Runtime-agnostic: the caller passes satori
// (already initialised) and the Resvg class (wasm already initialised), from
// runtime-node.mjs in tests or runtime-workers.js in the worker.
import { CANVAS } from './layout.js';

const BACKGROUND = '#1a1f1c';

/** PNG bytes (Uint8Array) for a card tree. `onStyleError` sees each style Satori ignores. */
export async function renderPng(tree, { fonts, satori, resvg, onStyleError }) {
  const svg = await satori(tree, { width: CANVAS.width, height: CANVAS.height, fonts, ...(onStyleError ? { onStyleError } : {}) });
  const renderer = new resvg(svg, { fitTo: { mode: 'width', value: CANVAS.width }, background: BACKGROUND });
  try {
    const image = renderer.render();
    try {
      return image.asPng();
    } finally {
      image.free(); // wasm memory: a Workers isolate lives across many renders
    }
  } finally {
    renderer.free();
  }
}
