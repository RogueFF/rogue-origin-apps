/**
 * Google Sheets API client using direct REST API
 *
 * Replaces the 15MB googleapis package with ~100 lines of fetch() calls.
 * Uses JWT service account authentication.
 */

import { createError } from './errors.js';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Cache access token (expires in 1 hour)
let tokenCache = {
  token: null,
  expiresAt: 0,
};

/**
 * Create JWT for service account authentication
 * @param {string} email - Service account email
 * @param {string} privateKey - Private key (PEM format)
 * @returns {Promise<string>} JWT token
 */
async function createJWT(email, privateKey) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600, // 1 hour
  };

  // Base64url encode
  const base64url = (obj) => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signatureInput = `${headerB64}.${payloadB64}`;

  // Parse PEM private key and sign
  const key = privateKey
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${signatureInput}.${signatureB64}`;
}

/**
 * Get access token using service account credentials
 * @param {object} env - Environment variables
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(env) {
  // Check cache
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Google credentials not configured');
  }

  const jwt = await createJWT(email, privateKey);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token fetch failed:', error);
    throw createError('SHEETS_ERROR', 'Failed to authenticate with Google');
  }

  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // Refresh 60s early
  };

  return tokenCache.token;
}

/**
 * Make authenticated request to Sheets API
 * @param {string} url - Full URL
 * @param {object} env - Environment variables
 * @param {object} options - Fetch options
 * @returns {Promise<any>}
 */
async function sheetsRequest(url, env, options = {}) {
  const token = await getAccessToken(env);

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Sheets API error (${response.status}):`, errorText);

    if (response.status === 404) {
      throw createError('NOT_FOUND', 'Sheet or range not found');
    }
    if (response.status === 403) {
      throw createError('UNAUTHORIZED', 'Access denied to spreadsheet');
    }
    if (response.status === 429) {
      throw createError('RATE_LIMITED', 'Google Sheets rate limit exceeded');
    }

    throw createError('SHEETS_ERROR', `Sheets API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Read data from a sheet
 * @param {string} spreadsheetId
 * @param {string} range - A1 notation (e.g., "Sheet1!A1:D10")
 * @param {object} env
 * @returns {Promise<any[][]>}
 */
export async function readSheet(spreadsheetId, range, env) {
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = await sheetsRequest(url, env);
  return data.values || [];
}

/**
 * Write data to a sheet (overwrite)
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {any[][]} values
 * @param {object} env
 */
export async function writeSheet(spreadsheetId, range, values, env) {
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await sheetsRequest(url, env, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
}

/**
 * Append data to a sheet
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {any[][]} values
 * @param {object} env
 * @returns {Promise<{updatedRange: string, updatedRows: number}>}
 */
export async function appendSheet(spreadsheetId, range, values, env) {
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const data = await sheetsRequest(url, env, {
    method: 'POST',
    body: JSON.stringify({ values }),
  });

  return {
    updatedRange: data.updates?.updatedRange,
    updatedRows: data.updates?.updatedRows || 0,
  };
}

/**
 * Clear a range
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {object} env
 */
export async function clearSheet(spreadsheetId, range, env) {
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  await sheetsRequest(url, env, { method: 'POST' });
}

/**
 * Get all sheet names
 * @param {string} spreadsheetId
 * @param {object} env
 * @returns {Promise<string[]>}
 */
export async function getSheetNames(spreadsheetId, env) {
  const url = `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`;
  const data = await sheetsRequest(url, env);
  return data.sheets?.map((s) => s.properties?.title) || [];
}

/**
 * Batch read multiple ranges
 * @param {string} spreadsheetId
 * @param {string[]} ranges
 * @param {object} env
 * @returns {Promise<{range: string, values: any[][]}[]>}
 */
export async function batchRead(spreadsheetId, ranges, env) {
  const rangeParams = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${rangeParams}&valueRenderOption=UNFORMATTED_VALUE`;
  const data = await sheetsRequest(url, env);

  return data.valueRanges?.map((vr) => ({
    range: vr.range,
    values: vr.values || [],
  })) || [];
}

/**
 * Find row by value in column
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {number} column - 0-based index
 * @param {any} value
 * @param {object} env
 * @returns {Promise<{row: number, data: any[]} | null>}
 */
export async function findRow(spreadsheetId, sheetName, column, value, env) {
  const data = await readSheet(spreadsheetId, `${sheetName}!A:Z`, env);

  for (let i = 0; i < data.length; i++) {
    if (data[i][column] === value) {
      return { row: i + 1, data: data[i] };
    }
  }

  return null;
}

/**
 * Update a single row
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {number} row - 1-based
 * @param {any[]} values
 * @param {object} env
 */
export async function updateRow(spreadsheetId, sheetName, row, values, env) {
  await writeSheet(spreadsheetId, `${sheetName}!A${row}`, [values], env);
}

/**
 * Delete (clear) a row
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {number} row - 1-based
 * @param {object} env
 */
export async function deleteRow(spreadsheetId, sheetName, row, env) {
  await clearSheet(spreadsheetId, `${sheetName}!A${row}:Z${row}`, env);
}
