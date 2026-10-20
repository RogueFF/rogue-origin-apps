/* global Response */
// Render spike (Task A8 step 0): proves satori standalone + resvg-wasm + the font
// Data imports work in the Workers runtime. Replaced by the real router in A10.
import { workersRuntime } from './runtime-workers.js';

const W = 1080;
const H = 1350;

const line = (text, style) => ({ type: 'div', props: { style: { color: 'rgba(255,255,255,0.9)', marginTop: 24, ...style }, children: text } });

function spikeTree() {
  return {
    type: 'div',
    props: {
      style: { width: W, height: H, display: 'flex', flexDirection: 'column', padding: 56, backgroundColor: '#1a1f1c' },
      children: [
        line('Week 42', { fontFamily: 'DM Serif Display', fontStyle: 'italic', fontSize: 84 }),
        line('497 lb tops · Outfit 600', { fontFamily: 'Outfit', fontWeight: 600, fontSize: 64 }),
        line('Oct 12–16, 2026 · Outfit 500', { fontFamily: 'Outfit', fontWeight: 500, fontSize: 32 }),
        line('LINE CREW 18–27 · JETBRAINS MONO', { fontFamily: 'JetBrains Mono', fontSize: 24 }),
      ],
    },
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname !== '/') return new Response('not found', { status: 404 });
    try {
      const t0 = Date.now();
      const { satori, Resvg, fonts } = await workersRuntime();
      const t1 = Date.now();
      const svg = await satori(spikeTree(), { width: W, height: H, fonts });
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: '#1a1f1c' }).render().asPng();
      const t2 = Date.now();
      return new Response(png, {
        headers: { 'content-type': 'image/png', 'x-init-ms': String(t1 - t0), 'x-render-ms': String(t2 - t1) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err && err.stack || err) }), {
        status: 500, headers: { 'content-type': 'application/json' },
      });
    }
  },
};
