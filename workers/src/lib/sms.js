/**
 * Twilio SMS — send, and verify inbound webhook signatures.
 *
 * Same contract as lib/telegram.js: sendSms returns false (never throws) when
 * the secrets are unset, so a missing secret can't wedge the cron that also
 * moves harvest rows. It throws on a real Twilio error so the caller sees it.
 */
import { constantTimeEqual } from './auth.js';

const enc = (s) => new TextEncoder().encode(s);

export async function sendSms(env, { to, body }, fetchImpl = fetch) {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from || !to) {
    console.log(`[sms] not configured — to ${to}: ${body}`);
    return false;
  }
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio ${res.status} -> ${to}: ${err.slice(0, 200)}`);
  }
  return true;
}

/**
 * Twilio signs POST webhooks: base64(HMAC-SHA1(authToken, url + concat of
 * sorted "keyvalue" pairs)). The url must be exactly what Twilio was given,
 * scheme and host included.
 */
export async function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', enc(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyTwilioSignature(authToken, url, params, header) {
  if (!header) return false;
  const expected = await twilioSignature(authToken, url, params);
  return constantTimeEqual(expected, String(header));
}
