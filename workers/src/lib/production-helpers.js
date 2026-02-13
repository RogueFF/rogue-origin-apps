/**
 * Production helpers — pure logic extracted for testability.
 * The handler in production-d1.js re-exports these (or imports them).
 */

const TIMEZONE = 'America/Los_Angeles';

// Break schedule: [hour, minute, duration_minutes]
const BREAKS = [
  [9, 0, 10],    // 9:00 AM - 10 min
  [12, 0, 30],   // 12:00 PM - 30 min lunch
  [14, 30, 10],  // 2:30 PM - 10 min
  [16, 20, 10],  // 4:20 PM - 10 min cleanup
];

const TIME_SLOT_MULTIPLIERS = {
  '7:00 AM – 8:00 AM': 1.0,
  '8:00 AM – 9:00 AM': 1.0,
  '9:00 AM – 10:00 AM': 0.83,
  '10:00 AM – 11:00 AM': 1.0,
  '11:00 AM – 12:00 PM': 1.0,
  '12:30 PM – 1:00 PM': 0.5,
  '1:00 PM – 2:00 PM': 1.0,
  '2:00 PM – 3:00 PM': 1.0,
  '2:30 PM – 3:00 PM': 0.5,
  '3:00 PM – 4:00 PM': 0.83,
  '4:00 PM – 4:30 PM': 0.33,
  '3:00 PM – 3:30 PM': 0.5,
};

const ALL_TIME_SLOTS = [
  '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
  '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM',
];

/**
 * Parse a time string like '9:00 AM' into total minutes since midnight.
 */
function parseSlotTimeToMinutes(timeStr) {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Get the break-adjusted multiplier for a time slot.
 * Standard slots use the lookup table; dynamic/partial slots compute from duration.
 */
function getTimeSlotMultiplier(timeSlot, multipliers = null) {
  if (!timeSlot) return 1.0;
  const table = multipliers || TIME_SLOT_MULTIPLIERS;
  const slot = String(timeSlot).trim();
  if (table[slot]) return table[slot];
  const normalized = slot.replace(/[-–—]/g, '–');
  if (table[normalized]) return table[normalized];

  // Dynamic: parse slot times for custom slots (e.g., '7:48 AM – 8:00 AM')
  const parts = normalized.split('–').map(s => s.trim());
  if (parts.length === 2) {
    const startMin = parseSlotTimeToMinutes(parts[0]);
    const endMin = parseSlotTimeToMinutes(parts[1]);
    if (startMin !== null && endMin !== null && endMin > startMin) {
      // Subtract any break time within this slot
      let breakMin = 0;
      for (const [bHour, bMin, bDur] of BREAKS) {
        const bStart = bHour * 60 + bMin;
        const bEnd = bStart + bDur;
        const overlapStart = Math.max(startMin, bStart);
        const overlapEnd = Math.min(endMin, bEnd);
        if (overlapEnd > overlapStart) breakMin += (overlapEnd - overlapStart);
      }
      return (endMin - startMin - breakMin) / 60;
    }
  }
  return 1.0;
}

/**
 * Sort time slots chronologically by their start time.
 * Returns a new sorted array (does not mutate input).
 */
function sortSlotsChronologically(slots) {
  const parseSlotStart = (ts) => {
    const m = (ts || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  return [...slots].sort((a, b) => parseSlotStart(a) - parseSlotStart(b));
}

/**
 * Build the sorted rows array from DB rows + standard time slots.
 * Returns { rows, rowsBySlot } where rows is chronologically sorted.
 */
function buildSortedRows(todayRows, targetRate, timeSlotMultipliers = null) {
  const rowsBySlot = {};
  todayRows.forEach(r => {
    const slot = (r.time_slot || '').replace(/[-–—]/g, '–');
    const rawTrimmers = r.trimmers_line1 || 0;
    const effectiveTrimmers = r.effective_trimmers_line1 != null ? r.effective_trimmers_line1 : rawTrimmers;
    rowsBySlot[slot] = {
      timeSlot: r.time_slot || '',
      tops: r.tops_lbs1 || 0,
      smalls: r.smalls_lbs1 || 0,
      trimmers: effectiveTrimmers,
      rawTrimmers,
      buckers: r.buckers_line1 || 0,
      strain: r.cultivar1 || '',
      multiplier: getTimeSlotMultiplier(r.time_slot, timeSlotMultipliers),
      notes: r.qc || '',
    };
  });

  const allSlotsFromDB = todayRows.map(r => (r.time_slot || '').replace(/[-–—]/g, '–'));
  const uniqueSlots = [...new Set([...ALL_TIME_SLOTS.map(s => s.replace(/[-–—]/g, '–')), ...allSlotsFromDB])];
  const sorted = sortSlotsChronologically(uniqueSlots);

  const rows = sorted
    .map(slot => rowsBySlot[slot])
    .filter(r => r !== undefined);

  return { rows, rowsBySlot };
}

/**
 * Find lastCompletedHourIndex (most recent hour with production)
 * and currentHourIndex (hour with trimmers but no production yet).
 */
function findHourIndices(rows) {
  let lastCompletedHourIndex = -1;
  let currentHourIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.tops > 0) {
      lastCompletedHourIndex = i;
    } else if (row.trimmers > 0 && row.tops === 0) {
      currentHourIndex = i;
    }
  }

  return { lastCompletedHourIndex, currentHourIndex };
}

/**
 * Calculate streak: consecutive hours at >= 90% of target (from most recent backwards).
 */
function calculateStreak(rows, lastCompletedHourIndex, targetRate) {
  let streak = 0;
  let currentStreak = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < rows.length; i++) {
    const row = rows[i];
    if (row.trimmers > 0 && row.tops > 0) {
      const hourTarget = row.trimmers * targetRate * row.multiplier;
      const pct = hourTarget > 0 ? (row.tops / hourTarget) * 100 : 0;
      if (pct >= 90) {
        currentStreak++;
        streak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }
  }

  return streak;
}

/**
 * Calculate daily projection: how much total production expected by end of day.
 */
function calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar, timeSlotMultipliers = null) {
  let totalLbs = 0;
  let totalTrimmerEffectiveHours = 0;
  let lastKnownTrimmers = 0;

  const dataSlotsByEnd = {};
  for (const row of todayRows) {
    if (row.timeSlot) {
      const norm = String(row.timeSlot).trim().replace(/[-–—]/g, '–');
      const endPart = norm.split('–')[1]?.trim();
      if (endPart) dataSlotsByEnd[endPart] = norm;
    }
  }

  const allTimeSlots = ALL_TIME_SLOTS.map(std => {
    const norm = std.replace(/[-–—]/g, '–');
    const endPart = norm.split('–')[1]?.trim();
    return (endPart && dataSlotsByEnd[endPart]) ? dataSlotsByEnd[endPart] : std;
  });

  for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    const row = todayRows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      totalTrimmerEffectiveHours += row.trimmers * row.multiplier;
      lastKnownTrimmers = row.trimmers;
    }
  }

  if (currentHourIndex >= 0 && todayRows[currentHourIndex].trimmers > 0) {
    lastKnownTrimmers = todayRows[currentHourIndex].trimmers;
  }

  const currentRate = totalTrimmerEffectiveHours > 0
    ? totalLbs / totalTrimmerEffectiveHours
    : targetRate;

  const workedSlots = {};
  for (let i = 0; i < todayRows.length; i++) {
    if (todayRows[i].timeSlot) {
      const normalizedSlot = String(todayRows[i].timeSlot).trim().replace(/[-–—]/g, '–');
      workedSlots[normalizedSlot] = todayRows[i];
    }
  }

  let dailyGoal = 0;
  let projectedFromRemaining = 0;

  for (const slot of allTimeSlots) {
    const normalizedSlot = slot.replace(/[-–—]/g, '–');
    const multiplier = getTimeSlotMultiplier(slot, timeSlotMultipliers);
    const workedRow = workedSlots[normalizedSlot];

    if (workedRow && workedRow.tops > 0 && workedRow.trimmers > 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
    } else if (workedRow && workedRow.trimmers > 0 && workedRow.tops === 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
      projectedFromRemaining += workedRow.trimmers * currentRate * multiplier;
    } else {
      dailyGoal += lastKnownTrimmers * targetRate * multiplier;
      projectedFromRemaining += lastKnownTrimmers * currentRate * multiplier;
    }
  }

  return {
    projectedTotal: totalLbsSoFar + projectedFromRemaining,
    dailyGoal,
  };
}

export {
  BREAKS,
  TIME_SLOT_MULTIPLIERS,
  ALL_TIME_SLOTS,
  TIMEZONE,
  parseSlotTimeToMinutes,
  getTimeSlotMultiplier,
  sortSlotsChronologically,
  buildSortedRows,
  findHourIndices,
  calculateStreak,
  calculateDailyProjection,
};
