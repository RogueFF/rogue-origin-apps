#!/usr/bin/env node
/**
 * Generate PNG icons for the Electron app.
 * Uses raw pixel buffer → PNG encoding (no dependencies).
 * Run once: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = (() => {
  // Simple PNG encoder — no canvas needed, write raw PNG
  return { createCanvas: null };
})();

// Minimal PNG encoder from raw RGBA buffer
function encodePNG(width, height, rgba) {
  const crc32Table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(buf, start, len) {
    let c = 0xffffffff;
    for (let i = start; i < start + len; i++) c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  // Build raw scanlines (filter byte 0 = None for each row)
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  // Deflate (store only — no compression, works for small images)
  const blocks = [];
  let offset = 0;
  while (offset < raw.length) {
    const remaining = raw.length - offset;
    const blockSize = Math.min(remaining, 65535);
    const last = offset + blockSize >= raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = last;
    header.writeUInt16LE(blockSize, 1);
    header.writeUInt16LE(blockSize ^ 0xffff, 3);
    blocks.push(header);
    blocks.push(raw.subarray(offset, offset + blockSize));
    offset += blockSize;
  }

  const deflated = Buffer.concat(blocks);
  const adler = adler32(raw);

  // zlib wrapper: CMF + FLG + deflated + adler32
  const zlibHeader = Buffer.from([0x78, 0x01]); // deflate, no dict
  const adlerBuf = Buffer.alloc(4);
  adlerBuf.writeUInt32BE(adler);
  const compressed = Buffer.concat([zlibHeader, deflated, adlerBuf]);

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crcVal = crc32(typeAndData, 0, typeAndData.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal);
    return Buffer.concat([len, typeAndData, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Draw Atlas diamond icon
// ---------------------------------------------------------------------------

function drawDiamond(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx + 0.5);
      const dy = Math.abs(y - cy + 0.5);
      const dist = dx + dy;
      const idx = (y * size + x) * 4;

      if (dist <= r) {
        // Inner diamond — gradient from white-ish to cyan
        const t = dist / r;
        const inner = 1 - t * 0.3;
        buf[idx] = Math.round(240 * inner * (1 - t * 0.2)); // R
        buf[idx + 1] = Math.round(236 * inner);               // G
        buf[idx + 2] = Math.round(228 + (255 - 228) * t);     // B (shifts cyan)
        buf[idx + 3] = 255;
      } else if (dist <= r + 2) {
        // Edge glow
        const edge = 1 - (dist - r) / 2;
        buf[idx] = 0;
        buf[idx + 1] = Math.round(240 * edge);
        buf[idx + 2] = 255;
        buf[idx + 3] = Math.round(180 * edge);
      }
    }
  }

  return buf;
}

function drawTrayIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx + 0.5);
      const dy = Math.abs(y - cy + 0.5);
      const dist = dx + dy;
      const idx = (y * size + x) * 4;

      if (dist <= r) {
        buf[idx] = 240;
        buf[idx + 1] = 236;
        buf[idx + 2] = 228;
        buf[idx + 3] = 255;
      }
    }
  }

  return buf;
}

// Generate
const assetsDir = path.join(__dirname, 'assets');

// 256x256 app icon
const icon256 = drawDiamond(256);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), encodePNG(256, 256, icon256));

// 32x32 tray icon
const tray32 = drawTrayIcon(32);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), encodePNG(32, 32, tray32));

// 16x16 tray icon (fallback)
const tray16 = drawTrayIcon(16);
fs.writeFileSync(path.join(assetsDir, 'tray-icon-16.png'), encodePNG(16, 16, tray16));

console.log('✅ Icons generated in assets/');
