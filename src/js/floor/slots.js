/**
 * The shift's ten hours, and the arithmetic that hangs off them.
 *
 * These labels are a backend contract, not display strings. `validateTimeSlot`
 * in workers/src/handlers/production/hourly-entry.js accepts the ten canonical
 * labels plus one dynamic form for the first slot ("H:MM AM - 8:00 AM"), and
 * every historical row in `monthly_production` is keyed by one of them. A
 * renamed slot once left data unreachable under the old key (2f31c614), which
 * is why this module is pure, exported, and covered by tests/floor-slots.test.mjs.
 *
 * Ported verbatim in behaviour from src/js/hourly-entry/index.js; the only
 * change is that state arrives as arguments instead of module globals.
 */

/** Hour boundaries, in the order the shift runs. */
export const SLOT_DEFS = [
  { start: 7, startMin: 0, end: 8, endMin: 0 },
  { start: 8, startMin: 0, end: 9, endMin: 0 },
  { start: 9, startMin: 0, end: 10, endMin: 0 },
  { start: 10, startMin: 0, end: 11, endMin: 0 },
  { start: 11, startMin: 0, end: 12, endMin: 0 },
  { start: 12, startMin: 30, end: 13, endMin: 0 },
  { start: 13, startMin: 0, end: 14, endMin: 0 },
  { start: 14, startMin: 0, end: 15, endMin: 0 },
  { start: 15, startMin: 0, end: 16, endMin: 0 },
  { start: 16, startMin: 0, end: 16, endMin: 30 },
];

/**
 * Break-adjusted multipliers, mirroring TIME_SLOT_MULTIPLIERS on the worker:
 * a ten-minute morning break, a ten-minute afternoon break, and cleanup in the
 * closing half hour. The backend can override these through the
 * `schedule.time_slot_multipliers` config — if the two drift, the floor reads
 * "met" while the TV reads "missed".
 */
export const BREAK_ADJUSTED_MULTIPLIERS = {
  '9:00 AM – 10:00 AM': 0.83,
  '2:00 PM – 3:00 PM': 0.83,
  '4:00 PM – 4:30 PM': 0.33,
  '2:30 PM – 3:00 PM': 0.33,
  '3:00 PM – 3:30 PM': 0.5,
};

/** "7:00 AM", "12:30 PM" — the exact spelling the backend matches on. */
export function formatTime(hour, min) {
  const h = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const m = String(min).padStart(2, '0');
  return min === 0 ? `${h}:00 ${ampm}` : `${h}:${m} ${ampm}`;
}

/**
 * Build the day's slot labels and their minute boundaries.
 *
 * Only the first slot may carry a custom start ("7:30 AM – 8:00 AM"): it is the
 * one dynamic form the backend accepts, and the only one present in historical
 * rows. A later start is handled by prorating the multiplier instead — never by
 * renaming a slot.
 *
 * @param {Date|null} shiftStart
 * @returns {{slots: string[], startMinutes: Record<string, number>, endMinutes: Record<string, number>, renamedFrom: string|null}}
 */
export function buildSlots(shiftStart = null) {
  const slots = [];
  const startMinutes = {};
  const endMinutes = {};

  for (const def of SLOT_DEFS) {
    const label = `${formatTime(def.start, def.startMin)} – ${formatTime(def.end, def.endMin)}`;
    slots.push(label);
    startMinutes[label] = def.start * 60 + def.startMin;
    endMinutes[label] = def.end * 60 + def.endMin;
  }

  let renamedFrom = null;

  if (shiftStart) {
    const shiftMinutes = shiftStart.getHours() * 60 + shiftStart.getMinutes();
    const first = SLOT_DEFS[0];
    const firstStart = first.start * 60 + first.startMin;
    const firstEnd = first.end * 60 + first.endMin;

    if (shiftMinutes > firstStart && shiftMinutes < firstEnd) {
      const oldLabel = slots[0];
      const newLabel = `${formatTime(shiftStart.getHours(), shiftStart.getMinutes())} – ${formatTime(first.end, first.endMin)}`;

      delete startMinutes[oldLabel];
      delete endMinutes[oldLabel];

      slots[0] = newLabel;
      startMinutes[newLabel] = shiftMinutes;
      endMinutes[newLabel] = firstEnd;
      renamedFrom = oldLabel;
    }
  }

  return { slots, startMinutes, endMinutes, renamedFrom };
}

/** Did the crew actually record anything against this row? */
export function rowHasRecordedData(row) {
  if (!row) return false;
  return (row.tops1 || 0) > 0 || (row.tops2 || 0) > 0
    || (row.smalls1 || 0) > 0 || (row.smalls2 || 0) > 0
    || (row.trimmers1 || 0) > 0 || (row.trimmers2 || 0) > 0;
}

const endsAtEightAM = (key) => /–\s*8:00\s*AM$/i.test(String(key).replace(/[-—]/g, '–').trim());

/**
 * Fold any stray first-hour key into the label the day is currently using.
 *
 * A row can come back under the canonical "7:00 AM – 8:00 AM" or under a custom
 * "7:30 AM – 8:00 AM", depending on whether it was saved before or after Start
 * Day was pressed, and the two drift apart every time the shift start changes.
 * Without this the hour renders empty while its data sits unreachable.
 *
 * Mutates and returns `dayData`, as the caller owns that object.
 */
export function normalizeFirstSlotKey(dayData, firstSlot) {
  if (!firstSlot || !dayData) return dayData;

  for (const key of Object.keys(dayData)) {
    if (key === firstSlot || !endsAtEightAM(key)) continue;
    const incoming = dayData[key];
    delete dayData[key];
    // If both keys somehow carry a row, keep whichever one actually has data.
    if (!rowHasRecordedData(dayData[firstSlot])) dayData[firstSlot] = incoming;
  }

  return dayData;
}

/**
 * Should this hour appear at all? Recorded data is ground truth and always
 * wins: a late Start Day must never hide an hour the crew worked.
 */
export function isSlotVisible(slot, { startMinutes, shiftStartTime = null, row = null } = {}) {
  if (!shiftStartTime) return true;
  if (rowHasRecordedData(row)) return true;

  const slotStart = startMinutes?.[slot];
  if (slotStart === undefined) return true;

  const shiftMinutes = shiftStartTime.getHours() * 60 + shiftStartTime.getMinutes();

  // 15 minutes of tolerance: starting a few minutes into an hour still counts
  // as working that hour.
  return slotStart >= shiftMinutes - 15;
}

/**
 * The fraction of a full hour this slot is worth, after breaks and after any
 * shift that started partway through it.
 */
export function getSlotMultiplier(slot, {
  startMinutes,
  endMinutes,
  shiftStartTime = null,
  row = null,
  isToday = true,
} = {}) {
  const slotStart = startMinutes?.[slot];
  const slotEnd = endMinutes?.[slot];
  if (slotStart === undefined || slotEnd === undefined) return 1;

  let multiplier = BREAK_ADJUSTED_MULTIPLIERS[slot];
  if (multiplier === undefined) multiplier = (slotEnd - slotStart) / 60;

  if (!isToday || !shiftStartTime) return multiplier;

  // Same rule as isSlotVisible: an hour with data keeps its full target rather
  // than being prorated away.
  if (rowHasRecordedData(row)) return multiplier;

  const shiftMin = shiftStartTime.getHours() * 60 + shiftStartTime.getMinutes();
  if (shiftMin >= slotEnd) return 0;
  if (shiftMin <= slotStart) return multiplier;

  const workable = slotEnd - Math.max(slotStart, shiftMin);
  if (BREAK_ADJUSTED_MULTIPLIERS[slot] !== undefined) {
    return (workable / (slotEnd - slotStart)) * BREAK_ADJUSTED_MULTIPLIERS[slot];
  }
  return workable / 60;
}

/** Which slot is the wall clock in right now? Null outside the shift. */
export function getCurrentSlot(slots, { startMinutes, endMinutes, now = new Date() } = {}) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const slot of slots) {
    const start = startMinutes?.[slot];
    const end = endMinutes?.[slot];
    if (start === undefined || end === undefined) continue;
    if (minutes >= start && minutes < end) return slot;
  }
  return null;
}

/** "7:00 AM – 8:00 AM" → "7-8 AM"; "4:00 PM – 4:30 PM" → "4-4:30 PM". */
export function formatSlotShort(slot) {
  const match = String(slot).match(/(\d+):\d+\s*(AM|PM)\s*[–-]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return slot;
  const [, startHour, , endHour, endMin, period] = match;
  return endMin === '00'
    ? `${startHour}-${endHour} ${period}`
    : `${startHour}-${endHour}:${endMin} ${period}`;
}

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Never use `new Date().toISOString().split('T')[0]` for this: that is the UTC
 * date, and after 5pm Pacific it is tomorrow — which is how cross-computer sync
 * silently stopped every evening on the old page (index.js:4449).
 */
export function formatDateLocal(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
