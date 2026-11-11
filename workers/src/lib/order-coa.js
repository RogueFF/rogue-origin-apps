/**
 * Which COA goes in an order's sleeve (order flow slice 4, design doc §2e; Koa
 * 2026-11-10: "Warn, never block").
 *
 * The customer COAs are the 2026 post-harvest potency PDFs (wiki
 * products/coa-library.md), committed under raw/coas/2026/Post-Harvest/ and
 * mirrored into R2 by the wiki's scripts/sync-coas-to-board.py:
 *   harvest-coa/2026/Post-Harvest/Sour-Lifter-PostHarvest-G1395-2026.pdf
 * The file name carries the cultivar, so no table is needed: a new COA mirrored
 * into R2 is picked up on the next read. COAs are the same results the farm
 * shares with retail customers, so serving them needs no password.
 *
 * When one cultivar has more than one post-harvest COA, PREFER names the one for
 * the 2026 Sungrown crop (Rainbow GMO: G1393 is the field round, G4044 the GH1
 * greenhouse house). Anything else ambiguous is reported, never guessed.
 */
import { cultivarKey } from './order-route.js';

export const COA_PREFIX = 'harvest-coa/2026/Post-Harvest/';
const NAME = /^([A-Za-z0-9-]+?)-PostHarvest-(G\d+)-(\d{4})\.pdf$/;
export const PREFER = { 'rainbow gmo': 'G1393' };
const CACHE_MS = 5 * 60 * 1000;
let cache = null;   // { at, files }

/** "Sour-Lifter-PostHarvest-G1395-2026.pdf" -> { key: 'sour lifter', sample: 'G1395', file } */
export function parseCoaName(file) {
  const m = NAME.exec(String(file || ''));
  if (!m) return null;
  return { key: cultivarKey(m[1].replace(/-/g, ' ')), sample: m[2], year: m[3], file };
}

/** cultivar -> { file } | { missing: true } | { ambiguous: [files] } */
export function coaFor(cultivar, files) {
  const key = cultivarKey(cultivar);
  const hits = files.map(parseCoaName).filter(p => p && p.key === key);
  if (!hits.length) return { missing: true };
  if (hits.length === 1) return { file: hits[0].file };
  const pick = PREFER[key] && hits.find(h => h.sample === PREFER[key]);
  return pick ? { file: pick.file } : { ambiguous: hits.map(h => h.file) };
}

/** The COA files mirrored in R2 (names only), cached for CACHE_MS. [] when R2 isn't bound. */
export async function coaFiles(env, now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.files;
  if (!env.MEDIA_BUCKET) return [];
  const files = [];
  let cursor;
  do {
    const page = await env.MEDIA_BUCKET.list({ prefix: COA_PREFIX, limit: 500, cursor });
    for (const o of page.objects || []) files.push(o.key.slice(COA_PREFIX.length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  cache = { at: now, files };
  return files;
}
export function resetCoaCache() { cache = null; }

/** Only a COA name this module would hand out may be served. */
export function safeCoaFile(file) {
  return !!parseCoaName(file) && !String(file).includes('/') && !String(file).includes('..');
}
