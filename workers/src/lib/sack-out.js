/**
 * Sack scan-out — the pure half. No DB, no fetch, so the decisions a scan
 * makes can be tested without a worker. See
 * docs/plans/2026-10-06-sack-scan-out-design.md.
 */

const ID_SHAPE = /^\d{2}-[A-Z]+\d*(-C\d{1,2})?-\d{1,6}$/;

/**
 * What a scan or a typed entry names.
 *   { id }            one sack id
 *   { ambiguous: n }  a bare number — several cultivars can own it
 *   { notATag: true } a QR that is not one of ours (a URL without /s/, a word)
 *
 * `normalize` is harvest-d1's normalizeSackId, passed in so there is exactly one
 * reading of a tag id in the codebase.
 */
export function parseSackPayload({ q, code, number } = {}, normalize, season) {
  if (code && number !== undefined && number !== null && String(number).trim() !== '') {
    q = `${String(code).trim()}-${String(number).trim()}`;
  }
  const raw = String(q ?? '').trim();
  if (!raw) return { notATag: true };
  // A URL that is not a tag URL is some other QR (a menu, a COA link): it
  // must say so rather than be read as a sack id made of its path.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/\/s\/[^/?#\s]+/i.test(raw)) return { notATag: true };
  const n = normalize(raw, season);
  if (n && typeof n === 'object' && n.ambiguous !== undefined) return { ambiguous: n.ambiguous };
  if (typeof n !== 'string' || !ID_SHAPE.test(n)) return { notATag: true };
  return { id: n };
}

/**
 * Which open order this cultivar should go to: the queue is already ranked, so
 * the first block with a pass for the cultivar that still wants tops wins.
 * `options` is every such order in queue order, for the one-tap change.
 */
export function proposeOrder(cultivarIds, queue) {
  // Cultivar ids are text slugs ('sour-lifter'). Compared as strings: Number()
  // turns every slug into NaN, and a Set of NaN matches every other NaN — which
  // sent each sack to the top order whatever cultivar that order wanted.
  const want = new Set((cultivarIds || []).map(String));
  const options = [];
  for (const b of (queue?.blocks || [])) {
    const pass = (b.passes || []).find(p => want.has(String(p.cultivarId)) && Number(p.remainingTopsLbs) > 0);
    if (!pass) continue;
    const id = b.orderId;
    if (id == null) continue;
    if (options.some(o => o.id === id)) continue;
    options.push({ id, sacks_needed: pass.sacksNeeded ?? null });
  }
  return { proposed: options[0] || null, options };
}
