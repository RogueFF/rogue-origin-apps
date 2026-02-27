/**
 * Hourly production data entry handlers.
 */

import { query, queryOne, insert, execute } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { ALL_TIME_SLOTS, TIME_SLOT_MULTIPLIERS } from '../../lib/production-helpers.js';
import {
  formatDatePT,
  getConfig,
  getEffectiveTargetRate,
  incrementDataVersion,
} from '../../lib/production-utils.js';

// ===== VALIDATION HELPERS =====

function validateCrewCount(value, fieldName) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 50) {
    return { valid: false, error: `${fieldName} must be between 0 and 50` };
  }
  return { valid: true, value: num };
}

function validateLbs(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0 || num > 200) {
    return { valid: false, error: `${fieldName} must be between 0 and 200 lbs` };
  }
  return { valid: true, value: Math.round(num * 10) / 10 };
}

function validateTimeSlot(slot) {
  const input = String(slot || '').trim();

  const normalizedInput = input
    .replace(/[\u002D\u2013\u2014\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, ' ');

  for (const validSlot of ALL_TIME_SLOTS) {
    const normalizedValid = validSlot
      .replace(/[\u002D\u2013\u2014\uFE58\uFE63\uFF0D]/g, '-')
      .replace(/\s+/g, ' ');

    if (normalizedInput === normalizedValid) {
      return { valid: true, value: validSlot };
    }
  }

  const dynamicSlotPattern = /^(\d{1,2}):(\d{2}) (AM|PM) - 8:00 (AM|PM)$/;
  const match = normalizedInput.match(dynamicSlotPattern);

  if (match) {
    const [, hours, minutes, period1, period2] = match;
    const hour = parseInt(hours, 10);
    const min = parseInt(minutes, 10);

    if (hour >= 1 && hour <= 12 && min >= 0 && min <= 59 && period1 === 'AM' && period2 === 'AM') {
      return { valid: true, value: input };
    }
  }

  return { valid: false, error: `Invalid time slot: ${slot}` };
}

function validateProductionDate(dateStr) {
  if (!dateStr) return { valid: false, error: 'Date is required' };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: 'Date must be in YYYY-MM-DD format' };
  }

  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Invalid date' };
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d > today) {
    return { valid: false, error: 'Date cannot be in the future' };
  }

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  if (d < twoYearsAgo) {
    return { valid: false, error: 'Date cannot be more than 2 years in the past' };
  }

  return { valid: true, value: dateStr };
}

// ===== ACTION HANDLERS =====

async function addProduction(body, env) {
  try {
    const { date, timeSlot, trimmers1, buckers1, tzero1, cultivar1, tops1, smalls1,
            trimmers2, buckers2, tzero2, cultivar2, tops2, smalls2,
            qcNotes, qc: qcLegacy, effectiveTrimmers1, effectiveTrimmers2 } = body;
    const qc = qcNotes ?? qcLegacy;

    const dateValidation = validateProductionDate(date);
    if (!dateValidation.valid) {
      return errorResponse(dateValidation.error, 'VALIDATION_ERROR', 400);
    }

    const slotValidation = validateTimeSlot(timeSlot);
    if (!slotValidation.valid) {
      return errorResponse(slotValidation.error, 'VALIDATION_ERROR', 400);
    }

  const validations = [];
  const crew1 = { trimmers: 0, buckers: 0, tzero: 0 };
  const crew2 = { trimmers: 0, buckers: 0, tzero: 0 };

  if (trimmers1 !== undefined && trimmers1 !== '') {
    const v = validateCrewCount(trimmers1, 'Trimmers Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.trimmers = v.value;
  }
  if (buckers1 !== undefined && buckers1 !== '') {
    const v = validateCrewCount(buckers1, 'Buckers Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.buckers = v.value;
  }
  if (tzero1 !== undefined && tzero1 !== '') {
    const v = validateCrewCount(tzero1, 'T-Zero Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.tzero = v.value;
  }
  if (trimmers2 !== undefined && trimmers2 !== '') {
    const v = validateCrewCount(trimmers2, 'Trimmers Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.trimmers = v.value;
  }
  if (buckers2 !== undefined && buckers2 !== '') {
    const v = validateCrewCount(buckers2, 'Buckers Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.buckers = v.value;
  }
  if (tzero2 !== undefined && tzero2 !== '') {
    const v = validateCrewCount(tzero2, 'T-Zero Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.tzero = v.value;
  }

  const lbs1 = { tops: 0, smalls: 0 };
  const lbs2 = { tops: 0, smalls: 0 };

  if (tops1 !== undefined && tops1 !== '') {
    const v = validateLbs(tops1, 'Tops Line 1');
    if (!v.valid) validations.push(v.error);
    else lbs1.tops = v.value;
  }
  if (smalls1 !== undefined && smalls1 !== '') {
    const v = validateLbs(smalls1, 'Smalls Line 1');
    if (!v.valid) validations.push(v.error);
    else lbs1.smalls = v.value;
  }
  if (tops2 !== undefined && tops2 !== '') {
    const v = validateLbs(tops2, 'Tops Line 2');
    if (!v.valid) validations.push(v.error);
    else lbs2.tops = v.value;
  }
  if (smalls2 !== undefined && smalls2 !== '') {
    const v = validateLbs(smalls2, 'Smalls Line 2');
    if (!v.valid) validations.push(v.error);
    else lbs2.smalls = v.value;
  }

  if (validations.length > 0) {
    return errorResponse(validations.join('; '), 'VALIDATION_ERROR', 400);
  }

  const safeCultivar1 = (cultivar1 || '').substring(0, 100);
  const safeCultivar2 = (cultivar2 || '').substring(0, 100);
  const safeQc = (qc || '').substring(0, 500);

  const effTrim1 = (effectiveTrimmers1 !== undefined && effectiveTrimmers1 !== null)
    ? Math.max(0, Math.min(50, parseFloat(effectiveTrimmers1) || 0))
    : null;
  const effTrim2 = (effectiveTrimmers2 !== undefined && effectiveTrimmers2 !== null)
    ? Math.max(0, Math.min(50, parseFloat(effectiveTrimmers2) || 0))
    : null;

  const existing = await queryOne(env.DB,
    'SELECT id FROM monthly_production WHERE production_date = ? AND time_slot = ?',
    [dateValidation.value, slotValidation.value]
  );

  if (existing) {
    await execute(env.DB, `
      UPDATE monthly_production SET
        trimmers_line1 = ?, buckers_line1 = ?, tzero_line1 = ?, cultivar1 = ?, tops_lbs1 = ?, smalls_lbs1 = ?,
        trimmers_line2 = ?, buckers_line2 = ?, tzero_line2 = ?, cultivar2 = ?, tops_lbs2 = ?, smalls_lbs2 = ?,
        qc = ?, effective_trimmers_line1 = ?, effective_trimmers_line2 = ?
      WHERE id = ?
    `, [
      crew1.trimmers, crew1.buckers, crew1.tzero, safeCultivar1, lbs1.tops, lbs1.smalls,
      crew2.trimmers, crew2.buckers, crew2.tzero, safeCultivar2, lbs2.tops, lbs2.smalls,
      safeQc, effTrim1, effTrim2, existing.id
    ]);

    await incrementDataVersion(env);

    return successResponse({ success: true, message: 'Production data updated', id: existing.id });
  } else {
    const id = await insert(env.DB, 'monthly_production', {
      production_date: dateValidation.value,
      time_slot: slotValidation.value,
      trimmers_line1: crew1.trimmers,
      buckers_line1: crew1.buckers,
      tzero_line1: crew1.tzero,
      cultivar1: safeCultivar1,
      tops_lbs1: lbs1.tops,
      smalls_lbs1: lbs1.smalls,
      trimmers_line2: crew2.trimmers,
      buckers_line2: crew2.buckers,
      tzero_line2: crew2.tzero,
      cultivar2: safeCultivar2,
      tops_lbs2: lbs2.tops,
      smalls_lbs2: lbs2.smalls,
      qc: safeQc,
      effective_trimmers_line1: effTrim1,
      effective_trimmers_line2: effTrim2,
    });

    await incrementDataVersion(env);

    return successResponse({ success: true, message: 'Production data added', id });
  }
  } catch (error) {
    console.error('addProduction error:', error);
    return errorResponse(`Failed to add production: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

async function getProduction(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }

  const timeSlotMultipliers = (await getConfig(env, 'schedule.time_slot_multipliers')) ?? TIME_SLOT_MULTIPLIERS;
  // targetRate determined after fetching rows

  const rows = await query(env.DB, `
    SELECT * FROM monthly_production
    WHERE production_date = ?
    ORDER BY time_slot
  `, [date]);

  // Determine active strain for target rate
  const cultivarRows = await query(env.DB, `
    SELECT cultivar1 FROM monthly_production
    WHERE production_date = ? AND cultivar1 IS NOT NULL AND cultivar1 != ''
    ORDER BY time_slot DESC LIMIT 1
  `, [date]);
  const activeStrain = cultivarRows.length > 0 ? cultivarRows[0].cultivar1 : '';
  const targetRate = await getEffectiveTargetRate(env, 2, timeSlotMultipliers, activeStrain);

  return successResponse({
    success: true,
    date,
    targetRate,
    timeSlots: ALL_TIME_SLOTS,
    production: rows.map(r => ({
      timeSlot: r.time_slot,
      trimmers1: r.trimmers_line1 || 0,
      buckers1: r.buckers_line1 || 0,
      tzero1: r.tzero_line1 || 0,
      cultivar1: r.cultivar1 || '',
      tops1: r.tops_lbs1 || 0,
      smalls1: r.smalls_lbs1 || 0,
      trimmers2: r.trimmers_line2 || 0,
      buckers2: r.buckers_line2 || 0,
      tzero2: r.tzero_line2 || 0,
      cultivar2: r.cultivar2 || '',
      tops2: r.tops_lbs2 || 0,
      smalls2: r.smalls_lbs2 || 0,
      qcNotes: r.qc || '',
      effectiveTrimmers1: r.effective_trimmers_line1 || null,
      effectiveTrimmers2: r.effective_trimmers_line2 || null,
    })),
  });
}

async function getCultivars(env) {
  const rows = await query(env.DB, `
    SELECT DISTINCT cultivar FROM (
      SELECT cultivar1 as cultivar FROM monthly_production WHERE cultivar1 IS NOT NULL AND cultivar1 != ''
      UNION
      SELECT cultivar2 FROM monthly_production WHERE cultivar2 IS NOT NULL AND cultivar2 != ''
    )
    ORDER BY cultivar
  `);

  return successResponse({
    success: true,
    cultivars: rows.map(r => r.cultivar),
  });
}

export {
  addProduction,
  getProduction,
  getCultivars,
};
