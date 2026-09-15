/**
 * WhatsApp send + poll, proxied through riego-whatsapp-mailbox — a separate
 * Cloudflare Worker that holds the Meta Graph credentials and already
 * verifies Meta's webhook signature. This worker never talks to Meta
 * directly: it only calls the mailbox's bearer-authed /send and /poll.
 *
 * Same contract as lib/sms.js: sendWhatsapp returns false (never throws) when
 * unconfigured, so a missing secret can't wedge the cron. It throws on a real
 * send failure so the caller sees it.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v3)
 */

function base(env) {
  return String(env.WA_MAILBOX_URL || '').replace(/\/$/, '');
}

/** E.164 ('+15415551234') -> digits only ('15415551234'), matching the mailbox's own normalizeNumber. */
function digitsOnly(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

export async function sendWhatsapp(env, { to, body }, fetchImpl = fetch) {
  if (!to) {
    console.log(`[whatsapp] no recipient — message would be: ${body}`);
    return false;
  }
  const url = base(env), key = env.WA_MAILBOX_KEY;
  if (!url || !key) {
    console.log(`[whatsapp] not configured — to ${to}: ${body}`);
    return false;
  }
  const res = await fetchImpl(`${url}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: digitsOnly(to), text: body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp mailbox ${res.status} -> ${to}: ${err.slice(0, 200)}`);
  }
  return true;
}

/**
 * Drain the mailbox's inbound queue. The mailbox marks whatever it hands back
 * as processed on ITS side — there is no redelivery once this call returns,
 * so the caller must persist each row before doing anything that can fail.
 */
export async function pollWhatsappMailbox(env, { limit = 20 } = {}, fetchImpl = fetch) {
  const url = base(env), key = env.WA_MAILBOX_KEY;
  if (!url || !key) {
    console.log('[whatsapp] mailbox not configured — skipping poll');
    return [];
  }
  const res = await fetchImpl(`${url}/poll?limit=${limit}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp mailbox poll ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.messages || [];
}
