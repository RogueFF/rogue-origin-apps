/**
 * Orders — Shared utilities
 * Drive API helpers, date formatting, constants
 */

import { createError } from '../../lib/errors.js';

export const COA_FOLDER_ID = '1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO';
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Sheet names for migration
export const SHEETS = {
  customers: 'Customers',
  orders: 'MasterOrders',
  shipments: 'Shipments',
  payments: 'Payments',
  priceHistory: 'PriceHistory',
  coaIndex: 'COA_Index',
};

// Drive token cache
let driveTokenCache = { token: null, expiresAt: 0 };

async function getDriveAccessToken(env) {
  if (driveTokenCache.token && Date.now() < driveTokenCache.expiresAt) {
    return driveTokenCache.token;
  }

  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Drive API not configured');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: DRIVE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const base64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signatureInput = `${headerB64}.${payloadB64}`;

  const key = privateKey.replace(/\\n/g, '\n').replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signatureInput));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signatureInput}.${signatureB64}`;

  const response = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });

  if (!response.ok) throw createError('INTERNAL_ERROR', 'Failed to authenticate with Google Drive');

  const data = await response.json();
  driveTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return driveTokenCache.token;
}

export async function driveRequest(url, env) {
  const token = await getDriveAccessToken(env);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw createError('INTERNAL_ERROR', `Drive API error: ${response.status}`);
  return response;
}

export function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}
