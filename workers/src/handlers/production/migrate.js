/**
 * Migration and sheet-check handlers.
 */

import { queryOne, insert } from '../../lib/db.js';
import { readSheet, getSheetNames } from '../../lib/sheets.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { ALL_TIME_SLOTS } from '../../lib/production-helpers.js';
import { formatDatePT } from '../../lib/production-utils.js';

// ===== MIGRATION VALIDATION HELPERS =====

function validateMigrationCrewCount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return 0;
  if (num > 50) return 50;
  return num;
}

function validateMigrationLbs(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return 0;
  if (num > 200) return 200;
  return Math.round(num * 10) / 10;
}

function validateMigrationTimeSlot(slot) {
  if (!slot) return null;
  const normalizedSlot = String(slot).trim().replace(/[-–—]/g, '–');
  const validSlots = ALL_TIME_SLOTS.map(s => s.replace(/[-–—]/g, '–'));
  if (!validSlots.includes(normalizedSlot)) return null;
  return normalizedSlot;
}

function validateMigrationDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d > tomorrow) return null;

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  if (d < threeYearsAgo) return null;

  return formatDatePT(d, 'yyyy-MM-dd');
}

// ===== MIGRATION =====

async function migrateFromSheets(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  if (!sheetId) throw createError('INTERNAL_ERROR', 'PRODUCTION_SHEET_ID not configured');

  let trackingMigrated = 0;
  let trackingSkipped = 0;
  let productionMigrated = 0;
  let productionSkipped = 0;
  let pausesMigrated = 0;
  let shiftsMigrated = 0;
  const errors = [];
  const monthsProcessed = [];

  // Migrate production tracking (bag completions)
  try {
    const trackingSheet = 'Rogue Origin Production Tracking';
    const data = await readSheet(sheetId, `'${trackingSheet}'!A:J`, env);

    if (data.length > 1) {
      const headers = data[0];
      const timestampCol = headers.indexOf('Timestamp');
      const sizeCol = headers.indexOf('Size');
      const skuCol = headers.indexOf('SKU');

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const timestamp = row[timestampCol];
        if (!timestamp) {
          trackingSkipped++;
          continue;
        }

        const d = new Date(timestamp);
        if (isNaN(d.getTime())) {
          trackingSkipped++;
          continue;
        }

        const existing = await queryOne(env.DB,
          'SELECT id FROM production_tracking WHERE timestamp = ?',
          [timestamp]
        );
        if (existing) continue;

        await insert(env.DB, 'production_tracking', {
          timestamp: timestamp,
          bag_type: String(row[sizeCol] || '').substring(0, 50),
          sku: String(row[skuCol] || '').substring(0, 50),
          source: 'sheets_migration',
        });
        trackingMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating tracking:', e);
    errors.push(`Tracking: ${e.message || e}`);
  }

  // Migrate monthly production data
  try {
    const sheetNames = await getSheetNames(sheetId, env);
    const monthSheets = sheetNames.filter(name => /^\d{4}-\d{2}$/.test(name)).sort();

    for (const monthSheet of monthSheets) {
      try {
        const vals = await readSheet(sheetId, `'${monthSheet}'!A:Z`, env);
        let currentDate = null;
        let cols = null;
        let monthCount = 0;

        for (let i = 0; i < vals.length; i++) {
          const row = vals[i];

          if (row[0] === 'Date:') {
            const dateStr = row[1];
            currentDate = validateMigrationDate(dateStr);

            const headerRow = vals[i + 1] || [];
            cols = {
              cultivar1: headerRow.indexOf('Cultivar 1'),
              tops1: headerRow.indexOf('Tops 1'),
              smalls1: headerRow.indexOf('Smalls 1'),
              buckers1: headerRow.indexOf('Buckers 1'),
              trimmers1: headerRow.indexOf('Trimmers 1'),
              tzero1: headerRow.indexOf('T-Zero 1'),
              cultivar2: headerRow.indexOf('Cultivar 2'),
              tops2: headerRow.indexOf('Tops 2'),
              smalls2: headerRow.indexOf('Smalls 2'),
              buckers2: headerRow.indexOf('Buckers 2'),
              trimmers2: headerRow.indexOf('Trimmers 2'),
              tzero2: headerRow.indexOf('T-Zero 2'),
              qc: headerRow.indexOf('QC'),
            };
            continue;
          }

          if (!currentDate || !cols) continue;

          const rawTimeSlot = row[0];
          if (!rawTimeSlot || rawTimeSlot === 'Date:' || String(rawTimeSlot).includes('Performance')) continue;

          const timeSlot = validateMigrationTimeSlot(rawTimeSlot);
          if (!timeSlot) {
            productionSkipped++;
            continue;
          }

          const tops1 = validateMigrationLbs(row[cols.tops1]);
          const smalls1 = validateMigrationLbs(row[cols.smalls1]);
          const trimmers1 = validateMigrationCrewCount(row[cols.trimmers1]);
          const buckers1 = validateMigrationCrewCount(row[cols.buckers1]);
          const tzero1 = cols.tzero1 >= 0 ? validateMigrationCrewCount(row[cols.tzero1]) : 0;
          const tops2 = validateMigrationLbs(row[cols.tops2]);
          const smalls2 = validateMigrationLbs(row[cols.smalls2]);
          const trimmers2 = validateMigrationCrewCount(row[cols.trimmers2]);
          const buckers2 = validateMigrationCrewCount(row[cols.buckers2]);
          const tzero2 = cols.tzero2 >= 0 ? validateMigrationCrewCount(row[cols.tzero2]) : 0;

          if (tops1 === 0 && smalls1 === 0 && trimmers1 === 0 && tops2 === 0 && smalls2 === 0 && trimmers2 === 0) {
            continue;
          }

          const existing = await queryOne(env.DB,
            'SELECT id FROM monthly_production WHERE production_date = ? AND time_slot = ?',
            [currentDate, timeSlot]
          );
          if (existing) continue;

          const cultivar1 = String(row[cols.cultivar1] || '').substring(0, 100);
          const cultivar2 = String(row[cols.cultivar2] || '').substring(0, 100);
          const qc = cols.qc >= 0 ? String(row[cols.qc] || '').substring(0, 500) : '';

          await insert(env.DB, 'monthly_production', {
            production_date: currentDate,
            time_slot: timeSlot,
            buckers_line1: buckers1,
            trimmers_line1: trimmers1,
            tzero_line1: tzero1,
            buckers_line2: buckers2,
            trimmers_line2: trimmers2,
            tzero_line2: tzero2,
            cultivar1,
            cultivar2,
            tops_lbs1: tops1,
            smalls_lbs1: smalls1,
            tops_lbs2: tops2,
            smalls_lbs2: smalls2,
            qc,
          });
          productionMigrated++;
          monthCount++;
        }

        monthsProcessed.push(`${monthSheet}: ${monthCount} rows`);
      } catch (monthError) {
        errors.push(`${monthSheet}: ${monthError.message || monthError}`);
      }
    }
  } catch (e) {
    console.error('Error migrating monthly production:', e);
    errors.push(`Monthly: ${e.message || e}`);
  }

  // Migrate pause log
  try {
    const pauseData = await readSheet(sheetId, `'Timer Pause Log'!A:G`, env);
    for (let i = 1; i < pauseData.length; i++) {
      const row = pauseData[i];
      if (!row[0] || !row[1]) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM pause_log WHERE start_time LIKE ?',
        [`${row[1]}%`]
      );
      if (existing) continue;

      await insert(env.DB, 'pause_log', {
        start_time: `${row[1]}T${row[2] || '00:00:00'}`,
        end_time: row[3] ? `${row[1]}T${row[3]}` : null,
        duration_min: parseFloat(row[4]) || null,
        reason: (row[5] || '').substring(0, 200),
        created_by: (row[6] || '').substring(0, 50),
      });
      pausesMigrated++;
    }
  } catch (e) {
    console.error('Error migrating pauses:', e);
    errors.push(`Pauses: ${e.message || e}`);
  }

  // Migrate shift adjustments
  try {
    const shiftData = await readSheet(sheetId, `'Shift Adjustments'!A:F`, env);
    for (let i = 1; i < shiftData.length; i++) {
      const row = shiftData[i];
      if (!row[0]) continue;

      const adjDate = validateMigrationDate(row[0]);
      if (!adjDate) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM shift_adjustments WHERE adjustment_date = ?',
        [adjDate]
      );
      if (existing) continue;

      await insert(env.DB, 'shift_adjustments', {
        adjustment_date: adjDate,
        original_start: '07:00:00',
        new_start: String(row[1] || '').substring(0, 20),
        reason: `Available hours: ${parseFloat(row[3]) || 0}, Scale: ${parseFloat(row[4]) || 1}`,
      });
      shiftsMigrated++;
    }
  } catch (e) {
    console.error('Error migrating shifts:', e);
    errors.push(`Shifts: ${e.message || e}`);
  }

  return successResponse({
    success: errors.length === 0,
    message: `Migration complete. Tracking: ${trackingMigrated} (${trackingSkipped} skipped), Production: ${productionMigrated} (${productionSkipped} skipped), Pauses: ${pausesMigrated}, Shifts: ${shiftsMigrated}`,
    trackingMigrated,
    trackingSkipped,
    productionMigrated,
    productionSkipped,
    pausesMigrated,
    shiftsMigrated,
    monthsProcessed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function checkSheet(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');
  const sheetId = env.PRODUCTION_SHEET_ID;
  const monthSheet = date.substring(0, 7);
  try {
    const data = await readSheet(sheetId, `'${monthSheet}'!A:Z`, env);
    const rows = [];
    let currentDate = null;
    for (const row of data) {
      if (row[0] === 'Date:') {
        currentDate = row[1];
        continue;
      }
      if (currentDate && String(currentDate).includes(date.split('-')[2])) {
        rows.push({ date: currentDate, slot: row[0], data: row.slice(1, 15) });
      }
    }
    return successResponse({ date, monthSheet, rowCount: rows.length, rows: rows.slice(0, 20) });
  } catch (e) {
    return successResponse({ date, monthSheet, error: e.message });
  }
}

export { migrateFromSheets, checkSheet };
