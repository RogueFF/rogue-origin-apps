/**
 * Orders — COA (Certificate of Analysis) management
 * getCOAIndex, syncCOAIndex, getCOAsForStrains, count5kgBagsForStrain
 */

import { query, insert, execute } from '../../lib/db.js';
import { readSheet } from '../../lib/sheets.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { COA_FOLDER_ID, DRIVE_API_BASE, driveRequest } from './shared.js';

async function getCOAIndex(env) {
  const coas = await query(env.DB, `SELECT * FROM coa_index ORDER BY strain`);

  return successResponse({
    success: true,
    coas: coas.map(c => ({
      strain: c.strain || '',
      fileName: c.lab_name || '',
      fileID: c.test_date || '',
      url: c.file_url || '',
      downloadURL: c.file_url ? `https://drive.google.com/uc?export=download&id=${c.test_date}` : '',
      lastSynced: c.created_at,
    }))
  });
}

async function syncCOAIndex(env) {
  const listUrl = `${DRIVE_API_BASE}/files?q='${COA_FOLDER_ID}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,webViewLink)&pageSize=1000`;
  const response = await driveRequest(listUrl, env);
  const result = await response.json();

  const files = result.files || [];

  // Clear existing COA index
  await execute(env.DB, 'DELETE FROM coa_index');

  for (const file of files) {
    const strain = file.name.replace(/\.pdf$/i, '').replace(/[\s_-]*COA[\s_-]*/gi, '').replace(/_/g, ' ').trim();

    await insert(env.DB, 'coa_index', {
      strain,
      lab_name: file.name,
      test_date: file.id,
      file_url: file.webViewLink || '',
    });
  }

  return successResponse({ success: true, count: files.length });
}

async function getCOAsForStrains(params, env) {
  const strainsParam = params.strains;
  if (!strainsParam) throw createError('VALIDATION_ERROR', 'Missing strains parameter');

  const strainList = strainsParam.split(',').map(s => s.trim());
  const coaIndex = await query(env.DB, 'SELECT strain, lab_name as fileName, test_date as fileID FROM coa_index');

  const results = [];

  for (const requestedStrain of strainList) {
    const normalized = requestedStrain.toLowerCase().trim();

    let bestMatch = null;
    for (const coa of coaIndex) {
      const coaNormalized = (coa.fileName || '').toLowerCase().trim();
      if (coaNormalized.includes(normalized)) {
        bestMatch = coa;
        break;
      }
    }

    if (bestMatch) {
      try {
        const fileUrl = `${DRIVE_API_BASE}/files/${bestMatch.fileID}?alt=media`;
        const fileResponse = await driveRequest(fileUrl, env);
        const arrayBuffer = await fileResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        results.push({
          strain: requestedStrain,
          matched: true,
          matchedStrain: bestMatch.strain,
          fileName: bestMatch.fileName,
          base64,
        });
      } catch {
        results.push({ strain: requestedStrain, matched: false, error: 'Failed to fetch COA file' });
      }
    } else {
      results.push({ strain: requestedStrain, matched: false, error: 'No matching COA found' });
    }
  }

  return successResponse({ success: true, coas: results });
}

async function count5kgBagsForStrain(strain, startDateTime, env) {
  const productionSheetId = env.PRODUCTION_SHEET_ID;
  if (!productionSheetId) return 0;

  try {
    const trackingData = await readSheet(productionSheetId, "'Rogue Origin Production Tracking'!A1:F2001", env);
    if (!trackingData || trackingData.length < 2) return 0;

    const headers = trackingData[0];
    const timestampCol = headers.indexOf('Timestamp');
    const sizeCol = headers.indexOf('Size');
    if (timestampCol === -1 || sizeCol === -1) return 0;

    let startFilter = startDateTime ? new Date(startDateTime) : null;
    if (startFilter && isNaN(startFilter.getTime())) startFilter = null;

    const now = new Date();
    const pacificOffset = -8 * 60;
    const pacificDate = new Date(now.getTime() + (pacificOffset + now.getTimezoneOffset()) * 60000);
    const year = pacificDate.getFullYear();
    const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
    const monthSheetName = `${year}-${month}`;

    let productionData = [];
    try {
      productionData = await readSheet(productionSheetId, `'${monthSheetName}'!A:L`, env);
    } catch { /* ignore */ }

    // Build cultivar timeline
    let cultivarCol = -1;
    let headerRowIndex = -1;
    for (let i = 0; i < productionData.length; i++) {
      const row = productionData[i];
      const cultivarIndex = row.findIndex(cell => String(cell || '').trim() === 'Cultivar 1');
      if (cultivarIndex !== -1) {
        cultivarCol = cultivarIndex;
        headerRowIndex = i;
        break;
      }
    }

    if (cultivarCol === -1) return 0;

    const cultivarTimeline = [];
    for (let i = headerRowIndex + 1; i < productionData.length; i++) {
      const row = productionData[i];
      if (!row[0] || row[0] === 'Date:') continue;
      const timeSlot = String(row[0] || '');
      const cultivar = String(row[cultivarCol] || '').trim();
      if (timeSlot.includes(':') && cultivar) {
        const timeParts = timeSlot.split(':');
        if (timeParts.length >= 2) {
          const hour = parseInt(timeParts[0]);
          const min = parseInt(timeParts[1]) || 0;
          const timestamp = new Date(pacificDate);
          timestamp.setHours(hour, min, 0, 0);
          cultivarTimeline.push({ timestamp, cultivar });
        }
      }
    }

    let bagCount = 0;
    const normalizedStrain = strain.toLowerCase().trim();
    const todayStr = `${pacificDate.getFullYear()}-${String(pacificDate.getMonth() + 1).padStart(2, '0')}-${String(pacificDate.getDate()).padStart(2, '0')}`;

    for (let i = 1; i < trackingData.length; i++) {
      const row = trackingData[i];
      const size = String(row[sizeCol] || '').toUpperCase();
      if (!size.includes('5KG') && !size.includes('5 KG')) continue;

      let bagTimestamp = row[timestampCol];
      if (!bagTimestamp) continue;

      let bagDate;
      if (typeof bagTimestamp === 'string') {
        let cleanTs = bagTimestamp.trim();
        const usMatch = cleanTs.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (usMatch) {
          const [, m, d, y, h, min, sec, ampm] = usMatch;
          let hours = parseInt(h, 10);
          if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }
          cleanTs = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${min}:${sec || '00'}-08:00`;
        }
        bagDate = new Date(cleanTs);
      } else if (typeof bagTimestamp === 'number') {
        if (bagTimestamp < 1) {
          const hours = Math.floor(bagTimestamp * 24);
          const minutes = Math.floor((bagTimestamp * 24 - hours) * 60);
          bagDate = new Date(`${todayStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-08:00`);
        } else {
          bagDate = new Date((bagTimestamp - 25569) * 86400 * 1000);
        }
      } else {
        bagDate = new Date(bagTimestamp);
      }

      if (!bagDate || isNaN(bagDate.getTime())) continue;

      // Skip blacklisted bags
      const badBagStart = new Date('2026-01-19T20:34:14Z');
      const badBagEnd = new Date('2026-01-19T20:38:05Z');
      if (bagDate >= badBagStart && bagDate <= badBagEnd) continue;

      if (startFilter && bagDate < startFilter) continue;

      let bagCultivar = null;
      for (let j = cultivarTimeline.length - 1; j >= 0; j--) {
        if (bagDate >= cultivarTimeline[j].timestamp) {
          bagCultivar = cultivarTimeline[j].cultivar;
          break;
        }
      }

      if (bagCultivar) {
        const normalizedCultivar = bagCultivar.toLowerCase().trim();
        if (normalizedCultivar.includes(normalizedStrain) || normalizedStrain.includes(normalizedCultivar)) {
          bagCount++;
        }
      }
    }

    return bagCount;
  } catch {
    return 0;
  }
}

export { getCOAIndex, syncCOAIndex, getCOAsForStrains, count5kgBagsForStrain };
