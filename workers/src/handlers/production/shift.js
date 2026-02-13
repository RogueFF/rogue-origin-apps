/**
 * Shift start/end handlers.
 */

import { queryOne, insert } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { formatDatePT, incrementDataVersion } from '../../lib/production-utils.js';

async function setShiftStart(params, env) {
  const timeParam = params.time;
  const timestamp = timeParam ? new Date(timeParam) : new Date();
  const today = new Date();

  if (formatDatePT(timestamp, 'yyyy-MM-dd') !== formatDatePT(today, 'yyyy-MM-dd')) {
    return errorResponse('Can only set start time for today', 'VALIDATION_ERROR', 400);
  }

  const pstTimeStr = formatDatePT(timestamp, 'HH:mm:ss');
  const [startH, startM] = pstTimeStr.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = 16 * 60 + 30;
  const totalMinutes = endMinutes - startMinutes;

  const breaks = [[9, 0, 9, 10], [12, 0, 12, 30], [14, 30, 14, 40], [16, 20, 16, 30]];
  let breakMinutes = 0;
  for (const brk of breaks) {
    const brkStart = brk[0] * 60 + brk[1];
    const brkEnd = brk[2] * 60 + brk[3];

    if (startMinutes < brkEnd && brkStart < endMinutes) {
      const overlapStart = Math.max(startMinutes, brkStart);
      const overlapEnd = Math.min(endMinutes, brkEnd);
      breakMinutes += overlapEnd - overlapStart;
    }
  }

  const availableHours = (totalMinutes - breakMinutes) / 60;
  const scaleFactor = availableHours / 8.5;
  const adjustedGoal = Math.round(200 * scaleFactor);

  const dateStr = formatDatePT(today, 'yyyy-MM-dd');
  const shiftStartStr = formatDatePT(timestamp, 'HH:mm:ss');

  await insert(env.DB, 'shift_adjustments', {
    adjustment_date: dateStr,
    original_start: '07:00:00',
    new_start: shiftStartStr,
    reason: `Available hours: ${availableHours.toFixed(2)}, Scale: ${scaleFactor.toFixed(3)}`,
  });

  await incrementDataVersion(env);

  return successResponse({
    shiftAdjustment: {
      manualStartTime: timestamp.toISOString(),
      availableHours,
      scaleFactor,
      adjustedDailyGoal: adjustedGoal,
    },
  });
}

async function getShiftStart(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  const row = await queryOne(env.DB, `
    SELECT adjustment_date, new_start, reason
    FROM shift_adjustments
    WHERE adjustment_date = ?
    ORDER BY id DESC
    LIMIT 1
  `, [date]);

  if (!row) {
    return successResponse({ shiftAdjustment: null });
  }

  const hoursMatch = row.reason?.match(/Available hours: ([\d.]+)/);
  const scaleMatch = row.reason?.match(/Scale: ([\d.]+)/);

  return successResponse({
    shiftAdjustment: {
      manualStartTime: `${date}T${row.new_start}`,
      availableHours: hoursMatch ? parseFloat(hoursMatch[1]) : 0,
      scaleFactor: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
    },
  });
}

export { setShiftStart, getShiftStart };
