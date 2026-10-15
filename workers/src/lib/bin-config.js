/**
 * Grove bins — validation for kanban_bin_config writes (design §10).
 *
 * bags_per_bin is a divisor downstream (red tape depth, receive), so nothing
 * reaches the table without passing here. Pure.
 */

/** camelCase body key → column, with the rule each value must meet. */
const FIELDS = {
  bagsPerBox:   { col: 'bags_per_box',   int: true, min: 1 },
  bagsPerBin:   { col: 'bags_per_bin',   int: true, min: 1 },
  leadDays:     { col: 'lead_days',      int: true, min: 0 },
  safetyDays:   { col: 'safety_days',    int: true, min: 0 },
  moq:          { col: 'moq',            int: true, min: 0 },
  seedPerMonth: { col: 'seed_per_month', int: false, min: 0 },
};

/**
 * @param {object} body  any of bagsPerBox, bagsPerBin, leadDays, safetyDays, moq,
 *                       seedPerMonth, colour. undefined/null = not provided; other keys ignored.
 * @returns {{data: object|null, error: string|null}}  data keyed by column name
 */
export function validateBinConfig(body) {
  const data = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    if (!Number.isFinite(n) || (f.int && !Number.isInteger(n)) || n < f.min) {
      return { data: null, error: `${key} must be ${f.int ? 'an integer' : 'a number'} ≥ ${f.min}` };
    }
    data[f.col] = n;
  }
  const colour = body?.colour;
  if (colour !== undefined && colour !== null) {
    const c = typeof colour === 'string' ? colour.trim() : '';
    if (!c || c.length > 20) return { data: null, error: 'colour must be a string of 1–20 characters' };
    data.colour = c;
  }
  if (Object.keys(data).length === 0) return { data: null, error: 'nothing to set' };
  return { data, error: null };
}
