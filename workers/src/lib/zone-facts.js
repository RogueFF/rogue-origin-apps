/**
 * Per-zone field facts for the 2026 harvest rollup: acreage and plant date.
 *
 * Needed to turn captured harvest events into the metrics that matter -
 * grow time (cut date - plant date), yield/acre and yield/plant. Capture
 * data lives in D1; this is the field side of that join.
 *
 * GENERATED from wiki/seasons/2026/planting-progress.md (the operator-confirmed
 * source of truth for what is actually in the ground). Re-generate rather than
 * hand-editing.
 *
 * multiDay: planting spanned more than one date, so grow time from the first
 * date is approximate for part of the zone.
 */

export const ZONE_FACTS = {
  'Z1': { acres: 0.999, plantDate: '2026-05-12' },
  'Z2': { acres: 0.992, plantDate: '2026-05-11' },
  'Z3': { acres: 1.04, plantDate: '2026-05-08' },
  'Z4': { acres: 1.045, plantDate: '2026-05-07' },
  'Z5': { acres: 0.984, plantDate: '2026-05-13' },
  'Z6': { acres: 0.988, plantDate: '2026-05-14' },
  'Z7': { acres: 0.995, plantDate: '2026-05-15' },
  'Z8': { acres: 0.468, plantDate: '2026-05-29', multiDay: true },
  'Z9': { acres: 1.012, plantDate: '2026-05-20' },
  'Z10': { acres: 0.999, plantDate: '2026-05-15', multiDay: true },
  'Z11': { acres: 1.028, plantDate: '2026-05-21' },
  'Z12': { acres: 1.074, plantDate: '2026-05-21' },
  'Z13': { acres: 1.068, plantDate: '2026-05-19' },
  'Z14': { acres: 1.283, plantDate: '2026-05-25' },
  'Z15': { acres: 1.283, plantDate: '2026-05-25' },
  'Z16': { acres: 1.154, plantDate: '2026-05-22' },
  'Z17': { acres: 1.161, plantDate: '2026-05-22' },
  'Z18': { acres: 1.276, plantDate: '2026-05-25' },
  'Z19': { acres: 1.274, plantDate: '2026-06-01' },
  'Z20': { acres: 1.604, plantDate: '2026-06-03' },
  'Z21': { acres: 2.17, plantDate: '2026-06-04' },
  'R1': { acres: 0.705, plantDate: '2026-05-07', multiDay: true },
};

/**
 * Plants per acre, DERIVED from the standing 4.5 ft (in-row) x 5 ft (bed)
 * spacing rather than picked from the conflicting figures floating around the
 * wiki (1,750 / 2,000 / 2,350). 43,560 sq ft per acre / 22.5 sq ft per plant.
 *
 * Caveat: R1 was hand-planted at ~4.6 ft row spacing, tighter than the tractor
 * standard, so its true density is somewhat higher. Refine if R1 yield/plant
 * starts carrying weight.
 */
export const PLANT_SPACING_FT = { inRow: 4.5, bed: 5 };
export const PLANTS_PER_ACRE = Math.round(43560 / (PLANT_SPACING_FT.inRow * PLANT_SPACING_FT.bed));

export function zoneFacts(zone) { return ZONE_FACTS[zone] || null; }

export function plantCountFor(zone) {
  const f = ZONE_FACTS[zone];
  return f ? Math.round(f.acres * PLANTS_PER_ACRE) : null;
}
