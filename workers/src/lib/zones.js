/**
 * Canonical zone identifiers shared across handlers that log per-zone
 * events (irrigation, harvest, ...). Single-sourced here so every handler
 * validates against the same set — see wiki/farm/fields.md.
 * Z1–Z21 + retail R1 + greenhouses GH1/GH2.
 */

export const VALID_ZONES = new Set([
  ...Array.from({ length: 21 }, (_, i) => `Z${i + 1}`),
  'R1', 'GH1', 'GH2',
]);

/**
 * Normalize a raw zone string (possibly typed/spoken/scanned) to its
 * canonical form, e.g. "zona 14" / "ZONE14" / "14" -> "Z14".
 * @param {any} raw
 * @returns {string|null}
 */
export function normalizeZone(raw) {
  if (raw === undefined || raw === null) return null;
  let z = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  z = z.replace(/^ZONA?/, 'Z').replace(/^ZONE/, 'Z'); // "ZONA14"/"ZONE14" → Z14
  if (/^\d+$/.test(z)) z = `Z${z}`;                    // bare number → Z-number
  return z;
}
