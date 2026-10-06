/**
 * Serves the vendored jsQR to /salida. Only iPhone Safari (no BarcodeDetector)
 * ever asks for it, so it lives at its own versioned URL: cached for a year,
 * never inlined into a page render, no runtime CDN on the barn's weak signal.
 * Wiring (owned by harvest-d1.js / index.js): route GET SALIDA_DECODER_PATH to
 * salidaDecoderResponse().
 */
import { JSQR_SOURCE, JSQR_VERSION } from '../vendor/jsqr.js';

export const SALIDA_DECODER_PATH = `/salida/jsqr-${JSQR_VERSION}.js`;

export function salidaDecoderResponse() {
  return new Response(JSQR_SOURCE, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
