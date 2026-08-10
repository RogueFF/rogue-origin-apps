/**
 * Gmail sender — service-account JWT + gmail.send, for transactional mail from
 * the worker (currently the Grove reorder alerts).
 *
 * Mirrors the proven RS256 JWT dance in lib/sheets.js, with two differences it
 * needs and sheets.js can't provide:
 *   1. A parameterised scope, and a `sub` claim — Gmail sending requires
 *      domain-wide delegation, which impersonates a real mailbox.
 *   2. A cache keyed by scope+subject. sheets.js keeps one module-level token
 *      slot keyed to nothing, so a Gmail token would collide with the Sheets
 *      token there.
 *
 * See docs/plans/2026-08-10-grove-reorder-alert-design.md §8 for why this is a
 * separate file rather than a refactor of sheets.js.
 */

import { createError } from './errors.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Access tokens are per (scope, subject) — see header note.
const tokenCache = new Map();

/** base64url without padding, from raw bytes. */
function base64UrlFromBytes(bytes) {
  let binary = '';
  // Chunked to avoid blowing the stack on large messages via spread.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** base64url of a UTF-8 string. btoa() alone throws on non-ASCII. */
function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

/**
 * RFC 2047 encoded-word, so non-ASCII subjects survive transit.
 * ASCII subjects are passed through untouched for readability.
 */
function encodeHeaderValue(value) {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return `=?UTF-8?B?${base64UrlFromString(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/')}?=`;
}

/**
 * Build an RFC 2822 message. Pure — unit-tested in tests/gmail-message.test.mjs.
 *
 * @param {object} opts
 * @param {string} opts.from    - Sender mailbox (the impersonated address)
 * @param {string} opts.to      - Primary recipient
 * @param {string} [opts.cc]    - Optional cc
 * @param {string} opts.subject
 * @param {string} opts.text    - Plain-text body
 * @returns {string} Raw MIME message
 */
export function buildMimeMessage({ from, to, cc, subject, text }) {
  if (!from) throw new Error('buildMimeMessage: from is required');
  if (!to) throw new Error('buildMimeMessage: to is required');

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeaderValue(subject || '')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ].filter(Boolean);

  // CRLF line endings, and a blank line between headers and body.
  return `${headers.join('\r\n')}\r\n\r\n${text || ''}`;
}

/**
 * Service-account JWT carrying a scope and an impersonation subject.
 */
async function createJWT(email, privateKey, scope, subject) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    // Domain-wide delegation: act as this mailbox.
    sub: subject,
  };

  const b64 = (obj) => base64UrlFromString(JSON.stringify(obj));
  const signatureInput = `${b64(header)}.${b64(payload)}`;

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

  return `${signatureInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

async function getAccessToken(env, scope, subject) {
  const cacheKey = `${scope}|${subject}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Google credentials not configured');
  }

  const jwt = await createJWT(email, privateKey, scope, subject);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    // The overwhelmingly likely cause is domain-wide delegation not being
    // granted for this scope — say so, rather than making the next reader
    // guess from "unauthorized_client".
    throw new Error(
      `Google token request failed (${response.status}). ` +
        `Check domain-wide delegation for ${scope} on ${subject}. ` +
        body.slice(0, 300)
    );
  }

  const data = await response.json();
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  });
  return data.access_token;
}

/**
 * Send a plain-text email as the impersonated mailbox.
 *
 * Throws on failure — callers running inside ctx.waitUntil should catch and
 * record the failure (see kanban-d1.js, which writes it to notify_state).
 *
 * @param {object} env
 * @param {object} opts - { to, cc, subject, text }
 */
export async function sendEmail(env, { to, cc, subject, text } = {}) {
  const sendAs = env.GMAIL_SEND_AS;
  if (!sendAs) {
    throw new Error('GMAIL_SEND_AS is not configured');
  }
  if (!to) {
    throw new Error('sendEmail: no recipient configured');
  }

  const token = await getAccessToken(env, GMAIL_SEND_SCOPE, sendAs);
  const raw = base64UrlFromString(
    buildMimeMessage({ from: sendAs, to, cc, subject, text })
  );

  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${body.slice(0, 300)}`);
  }

  return res.json();
}
