/**
 * Google Sheets API client
 *
 * Provides a clean interface to read/write Google Sheets.
 * Uses service account authentication.
 *
 * Setup:
 * 1. Create service account in Google Cloud Console
 * 2. Download JSON key file
 * 3. Share target sheets with service account email
 * 4. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY env vars
 */

const { google } = require('googleapis');
const { createError } = require('./errors');

// Cache auth client to reuse across requests (warm function)
let cachedAuth = null;
let cachedSheets = null;

/**
 * Get authenticated Sheets API client
 */
async function getSheetsClient() {
  if (cachedSheets) {
    return cachedSheets;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    console.error('[SHEETS] Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
    throw createError('INTERNAL_ERROR', 'Sheets API not configured');
  }

  try {
    // Parse the private key (may have escaped newlines from env var)
    const key = privateKey.replace(/\\n/g, '\n');

    cachedAuth = new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    cachedSheets = google.sheets({ version: 'v4', auth: cachedAuth });
    return cachedSheets;
  } catch (error) {
    console.error('[SHEETS] Failed to initialize client:', error.message);
    throw createError('SHEETS_ERROR', 'Failed to connect to Google Sheets');
  }
}

/**
 * Read data from a sheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID from the URL
 * @param {string} range - A1 notation range (e.g., "Sheet1!A1:D10")
 * @returns {Promise<any[][]>} 2D array of cell values
 */
async function readSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });

    return response.data.values || [];
  } catch (error) {
    handleSheetsError(error, 'read', range);
  }
}

/**
 * Write data to a sheet (overwrite)
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - A1 notation range
 * @param {any[][]} values - 2D array of values to write
 */
async function writeSheet(spreadsheetId, range, values) {
  const sheets = await getSheetsClient();

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } catch (error) {
    handleSheetsError(error, 'write', range);
  }
}

/**
 * Append data to a sheet (add new rows)
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - A1 notation range (table range to append to)
 * @param {any[][]} values - 2D array of rows to append
 * @returns {Promise<{updatedRange: string, updatedRows: number}>}
 */
async function appendSheet(spreadsheetId, range, values) {
  const sheets = await getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    return {
      updatedRange: response.data.updates?.updatedRange,
      updatedRows: response.data.updates?.updatedRows || 0,
    };
  } catch (error) {
    handleSheetsError(error, 'append', range);
  }
}

/**
 * Clear a range in a sheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - A1 notation range to clear
 */
async function clearSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient();

  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });
  } catch (error) {
    handleSheetsError(error, 'clear', range);
  }
}

/**
 * Get all sheet names in a spreadsheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @returns {Promise<string[]>} Array of sheet names
 */
async function getSheetNames(spreadsheetId) {
  const sheets = await getSheetsClient();

  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });

    return response.data.sheets?.map(s => s.properties?.title) || [];
  } catch (error) {
    handleSheetsError(error, 'getSheetNames', spreadsheetId);
  }
}

/**
 * Batch read multiple ranges
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string[]} ranges - Array of A1 notation ranges
 * @returns {Promise<{range: string, values: any[][]}[]>}
 */
async function batchRead(spreadsheetId, ranges) {
  const sheets = await getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    return response.data.valueRanges?.map(vr => ({
      range: vr.range,
      values: vr.values || [],
    })) || [];
  } catch (error) {
    handleSheetsError(error, 'batchRead', ranges.join(', '));
  }
}

/**
 * Find row by value in column
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} sheetName - Name of the sheet
 * @param {number} column - Column index (0-based)
 * @param {any} value - Value to find
 * @returns {Promise<{row: number, data: any[]} | null>} Row index (1-based) and data, or null
 */
async function findRow(spreadsheetId, sheetName, column, value) {
  const data = await readSheet(spreadsheetId, `${sheetName}!A:Z`);

  for (let i = 0; i < data.length; i++) {
    if (data[i][column] === value) {
      return {
        row: i + 1, // 1-based for Sheets
        data: data[i],
      };
    }
  }

  return null;
}

/**
 * Update a single row
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} sheetName - Name of the sheet
 * @param {number} row - Row number (1-based)
 * @param {any[]} values - Values for the row
 */
async function updateRow(spreadsheetId, sheetName, row, values) {
  const range = `${sheetName}!A${row}`;
  await writeSheet(spreadsheetId, range, [values]);
}

/**
 * Delete a row by clearing it (Sheets API doesn't have true delete via values API)
 * Note: This clears the row but doesn't shift rows up
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} sheetName - Name of the sheet
 * @param {number} row - Row number (1-based)
 */
async function deleteRow(spreadsheetId, sheetName, row) {
  await clearSheet(spreadsheetId, `${sheetName}!A${row}:Z${row}`);
}

/**
 * Handle Sheets API errors with appropriate error codes
 */
function handleSheetsError(error, operation, context) {
  const message = error.message || 'Unknown error';
  const code = error.code;

  console.error(`[SHEETS] ${operation} failed for ${context}:`, message);

  // Map Google API errors to our error codes
  if (code === 404) {
    throw createError('NOT_FOUND', `Sheet or range not found: ${context}`);
  }

  if (code === 403) {
    throw createError('UNAUTHORIZED', 'Access denied to spreadsheet');
  }

  if (code === 429) {
    throw createError('RATE_LIMITED', 'Too many requests to Google Sheets');
  }

  throw createError('SHEETS_ERROR', `Sheets API error: ${message}`);
}

module.exports = {
  getSheetsClient,
  readSheet,
  writeSheet,
  appendSheet,
  clearSheet,
  getSheetNames,
  batchRead,
  findRow,
  updateRow,
  deleteRow,
};
