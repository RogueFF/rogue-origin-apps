/**
 * Scale node battery (Koa 2026-11-10: "Are we able to see feather battery %
 * somewhere too?"). The Feather ESP32 V2 has no fuel gauge, only a voltage
 * divider on its LiPo, so the percent is read off a typical single-cell LiPo
 * discharge curve. Good for "charge it soon", not for the last few percent.
 * On USB the charger holds the cell near 4.2 V, so a plugged-in node reads 100%.
 */

// [millivolts, percent], resting single-cell LiPo, light load (the node draws ~100 mA).
const CURVE = [
  [3300, 0], [3400, 4], [3500, 8], [3600, 15], [3650, 25], [3700, 35],
  [3750, 45], [3800, 55], [3900, 68], [4000, 80], [4100, 90], [4180, 100],
];
export const LOW_PCT = 15;         // Telegram to Koa below this, in shift
export const CHARGED_PCT = 30;     // the low alert re-arms once it reads this again
export const BATT_FRESH_MS = 10 * 60 * 1000; // older than this: not shown, not alerted
const MV_MIN = 2500, MV_MAX = 5000, RSSI_MIN = -120, RSSI_MAX = 0;

/** Percent (0–100, whole) from millivolts, or null. */
export function battPct(mv) {
  if (mv === null || mv === undefined || !Number.isFinite(Number(mv))) return null;
  const v = Number(mv);
  if (v <= CURVE[0][0]) return 0;
  if (v >= CURVE[CURVE.length - 1][0]) return 100;
  for (let i = 1; i < CURVE.length; i++) {
    const [v1, p1] = CURVE[i];
    if (v <= v1) {
      const [v0, p0] = CURVE[i - 1];
      return Math.round(p0 + ((v - v0) / (v1 - v0)) * (p1 - p0));
    }
  }
  return 100;
}

/** The node's post fields, checked: { battMv, rssi } (each an integer or null). */
export function parseNodeHealth(body) {
  const int = (raw, min, max) => {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  return { battMv: int(body.battMv, MV_MIN, MV_MAX), rssi: int(body.rssi, RSSI_MIN, RSSI_MAX) };
}

const parseUtc = s => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]$/.test(s) ? '' : 'Z')) : null);

/**
 * What a screen shows, from a scale_readings row: { pct, mv, rssi, at } or null
 * when the node has never sent it or the last one is stale.
 */
export function batteryOf(row, now = Date.now()) {
  if (!row || row.batt_mv === null || row.batt_mv === undefined) return null;
  const at = parseUtc(row.batt_at);
  if (at === null || now - at > BATT_FRESH_MS) return null;
  return { pct: battPct(row.batt_mv), mv: row.batt_mv, rssi: row.rssi ?? null, at };
}
