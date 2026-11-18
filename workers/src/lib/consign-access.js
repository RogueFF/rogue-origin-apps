/**
 * Partner farm link + PIN helpers. Pure, WebCrypto only.
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage4.md, "Access model".
 *
 * The link carries 32 random bytes (base64url). Only sha256(link) is stored, so the
 * database alone cannot open a farm page. The PIN is stored as HMAC-SHA256 keyed by
 * the raw link, so the database alone cannot be used to guess the PIN either.
 */

export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;
/** Locks in a row, with no correct PIN in between, before the link is turned off. */
export const MAX_LOCKOUTS = 3;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A new private link value: 32 random bytes, base64url, no padding (43 characters). */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape check only: 43 base64url characters. */
export const validToken = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);

/** A PIN: a string of exactly four ASCII digits. */
export const validPin = (v) => typeof v === 'string' && /^[0-9]{4}$/.test(v);

/** sha256 of the link, hex. What the database stores and looks up by. */
export async function tokenHash(token) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(token)));
}

/** HMAC-SHA256(key = raw link, message = "<access id>:<pin>"), hex. */
export async function pinHash(token, accessId, pin) {
  const k = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(`${accessId}:${pin}`)));
}

/** A Date as SQLite UTC text ("2026-11-17 08:05:09"), the format datetime('now') writes. */
export const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

const parseSql = (s) => new Date(`${String(s).replace(' ', 'T')}Z`);

/** Is the link locked at `now`? minutes_left is rounded up, so "1" until the lock is gone. */
export function lockState(row, now) {
  if (!row || !row.locked_until) return { locked: false, minutes_left: 0 };
  const ms = parseSql(row.locked_until).getTime() - now.getTime();
  if (!(ms > 0)) return { locked: false, minutes_left: 0 };
  return { locked: true, minutes_left: Math.ceil(ms / 60000) };
}
