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

/**
 * Zones harvested as one: Z1 and Z2 were cut together in one serpentine pass
 * and their loads were scanned mostly to Z2, so every harvest figure treats
 * them as a single zone, "Z1+Z2" (Koa, 2026-10-05; the harvest dashboard has
 * keyed them that way since 9/28). Planting, acreage and irrigation keep the
 * two zones apart; this is only for what came off the field.
 */
export const HARVEST_ZONE_GROUPS = { Z1: 'Z1+Z2', Z2: 'Z1+Z2' };

/** The zone as harvest figures report it: Z1 and Z2 -> "Z1+Z2", others unchanged. */
export function harvestZone(zone) {
  return HARVEST_ZONE_GROUPS[zone] || zone;
}
