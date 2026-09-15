/**
 * The bag timer's break-and-shift arithmetic, with the wall clock as an argument.
 *
 * Every function here takes `now` instead of reading `new Date()` off the
 * global clock. The legacy bag timer (src/js/hourly-entry/index.js:4118-4702)
 * read the clock inline at a dozen call sites, which is exactly what makes a
 * timer untestable — you cannot pin "4:31 PM" and assert the freeze without
 * mocking Date globally. Here the caller supplies `now`; production code
 * defaults it to `new Date()` and tests pin it with `new Date(2026, 8, 2, h, m)`.
 *
 * Ported verbatim in behaviour from the legacy functions named below. The one
 * deliberate omission is the `timerIsPaused` branch at the top of
 * updateBagTimerTick (index.js:4579-4597): the backend has no `pause` key in
 * the scoreboard `timer` object (see the Backend contract in the phase 1
 * spec), so that branch was already dead code reading a value the server
 * never sends. It is left out here rather than ported as unreachable code.
 */

/** The four scheduled breaks, as [startHour, startMin, endHour, endMin]. */
export const TIMER_BREAKS = [
  [9, 0, 9, 10],      // 9:00-9:10 AM morning break
  [12, 0, 12, 30],    // 12:00-12:30 PM lunch
  [14, 30, 14, 40],   // 2:30-2:40 PM afternoon break
  [16, 20, 16, 30],   // 4:20-4:30 PM cleanup
];

export const WORKDAY_START_MINUTES = 7 * 60; // 7:00 AM
export const WORKDAY_END_MINUTES = 16 * 60 + 30; // 4:30 PM

/**
 * Shift end time for whatever calendar day `date` falls on. Not exported: the
 * legacy getShiftEndTime() is a one-line helper private to the carryover
 * calculation below, and nothing else in this module's export list needs it.
 */
function shiftEndTimeFor(date) {
  const end = new Date(date);
  end.setHours(16, 30, 0, 0);
  return end;
}

/** Is `now` on a scheduled break, or outside the 7:00-4:30 workday? */
export function isOnBreakOrAfterHours(now = new Date()) {
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (nowMins < WORKDAY_START_MINUTES) return { onBreak: true, afterHours: true };
  if (nowMins >= WORKDAY_END_MINUTES) return { onBreak: true, afterHours: true };

  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];
    if (nowMins >= bStart && nowMins < bEnd) return { onBreak: true, afterHours: false };
  }

  return { onBreak: false, afterHours: false };
}

/**
 * Working seconds between `startTime` and `now`, same calendar day only —
 * zero across a day boundary (getWorkingSecondsCarryOver handles that case).
 * Freezes at 4:20 PM after hours and at the current break's start while on
 * break, then subtracts any other completed break that falls inside the span.
 */
export function getWorkingSecondsSinceInternal(startTime, now = new Date()) {
  if (!startTime) return 0;
  if (startTime.toDateString() !== now.toDateString()) return 0;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isAfterHours = nowMins >= WORKDAY_END_MINUTES || nowMins < WORKDAY_START_MINUTES;
  const lastBreakStartMins = WORKDAY_END_MINUTES - 10; // 4:20 PM

  let currentlyOnBreak = false;
  let currentBreakStart = 0;
  if (!isAfterHours) {
    for (const brk of TIMER_BREAKS) {
      const bStart = brk[0] * 60 + brk[1];
      const bEnd = brk[2] * 60 + brk[3];
      if (nowMins >= bStart && nowMins < bEnd) {
        currentlyOnBreak = true;
        currentBreakStart = bStart;
        break;
      }
    }
  }

  let endTime;
  if (isAfterHours) {
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(lastBreakStartMins / 60), lastBreakStartMins % 60, 0);
  } else if (currentlyOnBreak) {
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(currentBreakStart / 60), currentBreakStart % 60, 0);
  } else {
    endTime = now;
  }

  let totalSecs = Math.floor((endTime - startTime) / 1000);
  const startMins = startTime.getHours() * 60 + startTime.getMinutes();
  const endMins = endTime.getHours() * 60 + endTime.getMinutes();

  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];
    if (currentlyOnBreak && bStart === currentBreakStart) continue; // handled by the endTime freeze above
    if (startMins < bEnd && endMins > bStart) {
      const overlapStart = Math.max(startMins, bStart);
      const overlapEnd = Math.min(endMins, bEnd);
      if (overlapEnd > overlapStart) totalSecs -= (overlapEnd - overlapStart) * 60;
    }
  }

  return Math.max(0, totalSecs);
}

/**
 * Working seconds when `startTime` was yesterday (or earlier): whatever was
 * left of yesterday's shift from `startTime` to 4:30 PM, minus any breaks in
 * that span, plus everything worked today since 7:00 AM.
 */
export function getWorkingSecondsCarryOver(startTime, now = new Date()) {
  if (!startTime) return 0;

  const startDate = new Date(startTime);
  const yesterdayShiftEnd = shiftEndTimeFor(startDate);

  let yesterdayRemaining = 0;
  if (startTime < yesterdayShiftEnd) {
    const startMins = startDate.getHours() * 60 + startDate.getMinutes();
    const endMins = WORKDAY_END_MINUTES;
    yesterdayRemaining = (endMins - startMins) * 60;

    for (const brk of TIMER_BREAKS) {
      const bStart = brk[0] * 60 + brk[1];
      const bEnd = brk[2] * 60 + brk[3];
      if (startMins < bEnd && endMins > bStart) {
        const overlapStart = Math.max(startMins, bStart);
        const overlapEnd = Math.min(endMins, bEnd);
        if (overlapEnd > overlapStart) yesterdayRemaining -= (overlapEnd - overlapStart) * 60;
      }
    }
  }

  const todayShiftStart = new Date(now);
  todayShiftStart.setHours(Math.floor(WORKDAY_START_MINUTES / 60), WORKDAY_START_MINUTES % 60, 0, 0);
  const todayElapsed = getWorkingSecondsSinceInternal(todayShiftStart, now);

  return Math.max(0, yesterdayRemaining + todayElapsed);
}

/**
 * Working seconds since `startTime`, whichever day it fell on. This is the
 * function the scoreboard and the floor timer both call; the two must stay
 * identical or the floor reads a different countdown than the TV.
 *
 * Legacy carried two copies of the same-day arithmetic (index.js:4247-4316
 * and 4325-4395, byte-for-byte identical past the carryover check) — a taste
 * call folds that duplication into one call to getWorkingSecondsSinceInternal
 * rather than porting the copy a second time.
 */
export function getWorkingSecondsSince(startTime, now = new Date()) {
  if (!startTime) return 0;
  if (startTime.toDateString() !== now.toDateString()) {
    return getWorkingSecondsCarryOver(startTime, now);
  }
  return getWorkingSecondsSinceInternal(startTime, now);
}

/**
 * The bag timer's full decision tree, pure: given what's known about the
 * shift right now, what should the tile show?
 *
 * Ports the non-DOM logic of updateBagTimerTick (index.js:4568-4702), in the
 * same branch order: break/after-hours first (frozen off the last bag, or
 * '--:--'-equivalent — kind 'break'/'ended' with zero seconds — if no bag has
 * been logged yet), then "nothing to show" (kind 'waiting'), then the live
 * countdown against lastBagTime or shiftStart, with carryover across midnight.
 */
export function timerReading({ lastBagTime = null, targetSeconds = 0, shiftStart = null, now = new Date() } = {}) {
  const breakStatus = isOnBreakOrAfterHours(now);
  if (breakStatus.onBreak) {
    const kind = breakStatus.afterHours ? 'ended' : 'break';
    if (!lastBagTime) return { kind, seconds: 0, progress: 0, elapsedSeconds: 0 };

    const elapsedSeconds = getWorkingSecondsSince(lastBagTime, now);
    const seconds = Math.max(0, targetSeconds - elapsedSeconds); // frozen remaining, legacy's break/after-hours display
    const progress = targetSeconds > 0 ? Math.min(1, elapsedSeconds / targetSeconds) : 0;
    return { kind, seconds, progress, elapsedSeconds };
  }

  const hasShiftStarted = shiftStart != null;
  if (!lastBagTime && !hasShiftStarted) {
    return { kind: 'waiting', seconds: 0, progress: 0, elapsedSeconds: 0 };
  }

  const referenceTime = lastBagTime || shiftStart;
  const isToday = referenceTime.toDateString() === now.toDateString();
  const isPreviousDay = !isToday && referenceTime < now;

  let elapsedSeconds;
  if (isToday) {
    elapsedSeconds = getWorkingSecondsSinceInternal(referenceTime, now);
  } else if (isPreviousDay) {
    elapsedSeconds = getWorkingSecondsCarryOver(referenceTime, now);
  } else {
    // referenceTime is in the future (clock skew, a bad timestamp): legacy's
    // own fallback here re-read getShiftStartTime(), which this module does
    // not port (shiftStart now arrives as an argument, per the phase 1
    // spec). Falling back to elapsed-since-shiftStart is the closest match;
    // with no shiftStart either, there is nothing sane to measure from.
    elapsedSeconds = shiftStart ? getWorkingSecondsSinceInternal(shiftStart, now) : 0;
  }

  const hasTarget = targetSeconds > 0;
  if (!hasTarget) {
    return { kind: 'elapsed', seconds: elapsedSeconds, progress: 0, elapsedSeconds };
  }

  const remainingSeconds = targetSeconds - elapsedSeconds;
  if (remainingSeconds < 0) {
    return { kind: 'overtime', seconds: Math.abs(remainingSeconds), progress: 1, elapsedSeconds };
  }
  return {
    kind: 'remaining',
    seconds: remainingSeconds,
    progress: Math.min(1, elapsedSeconds / targetSeconds),
    elapsedSeconds,
  };
}
