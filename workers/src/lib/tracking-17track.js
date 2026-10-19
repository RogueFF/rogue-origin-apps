/**
 * 17TRACK adapter — the delivery callback behind Grove's auto-receive.
 *
 * Why 17TRACK: Grove ships about 26 times a year. AfterShip puts webhooks and
 * the API on its Pro plan ($119/mo); UPS and FedEx tracking APIs are free but
 * poll-only and need two more developer accounts. 17TRACK gives new accounts
 * 200 free registrations (one per tracking number, nothing for the updates),
 * pushes a signed webhook on every change, and needs one key.
 *
 * Contract (api.17track.net/en/doc, v2.4):
 *   register:  POST https://api.17track.net/track/v2.4/register
 *              header 17token: <security key>; body [{ number, carrier? }]
 *   webhook:   POST <our url> with header `sign` = SHA-256 hex of
 *              `<raw body>/<security key>`; body { event, data: { number,
 *              carrier, track_info: { latest_status: { status, sub_status },
 *              latest_event: { time_iso } } } }
 *
 * Everything here that touches the network is tiny and the parsing is pure, so
 * the pure parts are unit-tested and the fetches are stubbed.
 */

export const REGISTER_URL = 'https://api.17track.net/track/v2.4/register';

/** 17TRACK carrier keys. Optional on register — it auto-detects — but a known one skips the guess. */
export const CARRIER_CODES = { ups: 100002, fedex: 100003, usps: 21051 };

/** 17TRACK's own key → our carrier word, for events. */
const CARRIER_BY_CODE = Object.fromEntries(Object.entries(CARRIER_CODES).map(([k, v]) => [v, k]));

/** "already registered" — a repeat of ours, not a failure. */
const ALREADY_REGISTERED = -18019901;

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (same length first, then every character). */
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `sign` is the SHA-256 hex of `${rawBody}/${key}`. */
export async function verify17Signature(rawBody, sign, key) {
  if (!key || !sign) return false;
  return safeEqual((await sha256Hex(`${rawBody}/${key}`)).toLowerCase(), String(sign).trim().toLowerCase());
}

/**
 * A 17TRACK push → { event, number, carrier, status, subStatus, at }, or null
 * when the body is not one. `at` is the latest checkpoint's ISO time if given.
 */
export function parse17Event(body) {
  const d = body?.data;
  if (!body || typeof body !== 'object' || !d || typeof d !== 'object' || !d.number) return null;
  const ls = d.track_info?.latest_status || {};
  const le = d.track_info?.latest_event || {};
  const t = le.time_iso || le.time_utc || null;
  const at = t && !isNaN(new Date(t)) ? new Date(t).toISOString() : null;
  return {
    event: String(body.event || ''),
    number: String(d.number).trim().toUpperCase(),
    carrier: CARRIER_BY_CODE[d.carrier] || (d.carrier != null ? String(d.carrier) : null),
    status: ls.status || null,
    subStatus: ls.sub_status || null,
    at,
  };
}

/**
 * Register one number so 17TRACK pushes its updates. Resolves { ok, already }
 * and never throws on a 17TRACK "already registered" reply; every other
 * failure throws so the caller can log it against the request.
 */
export async function register17(env, { trackingNo, carrier }) {
  const key = env.TRACK17_KEY;
  if (!key) throw new Error('TRACK17_KEY is not configured');
  const item = { number: String(trackingNo).trim() };
  if (CARRIER_CODES[carrier]) item.carrier = CARRIER_CODES[carrier];
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', '17token': key },
    body: JSON.stringify([item]),
  });
  if (!res.ok) throw new Error(`17TRACK register HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (body?.code !== 0) throw new Error(`17TRACK register code ${body?.code}: ${JSON.stringify(body?.data || body).slice(0, 200)}`);
  if (body.data?.accepted?.length) return { ok: true, already: false };
  const rej = body.data?.rejected?.[0];
  if (rej?.error?.code === ALREADY_REGISTERED) return { ok: true, already: true };
  throw new Error(`17TRACK rejected ${item.number}: ${rej?.error?.message || 'unknown'} (${rej?.error?.code})`);
}
