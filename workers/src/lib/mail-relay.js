/**
 * Mail transport that posts to the Apps Script relay
 * (apps-script/mail-relay/Code.gs).
 *
 * Apps Script runs as the Google account that owns the script, so it can send
 * mail with no domain-wide delegation and no admin-console grant — which is why
 * this exists alongside lib/gmail.js. See
 * docs/plans/2026-08-10-grove-reorder-alert-design.md §8.
 */

/**
 * Build the relay payload. Pure — unit-tested.
 * The secret is added by the caller so this stays loggable.
 */
export function buildRelayPayload({ to, cc, subject, text }) {
  if (!to) throw new Error('mail-relay: no recipient configured');
  const payload = { to, subject: subject || '', body: text || '' };
  if (cc) payload.cc = cc;
  return payload;
}

/**
 * Send via the relay. Throws on any failure — callers inside ctx.waitUntil
 * catch and record it (kanban-d1.js writes it to notify_state).
 *
 * @param {object} env - needs MAIL_RELAY_URL and MAIL_RELAY_SECRET
 * @param {object} opts - { to, cc, subject, text }
 */
export async function sendViaRelay(env, { to, cc, subject, text } = {}) {
  const url = env.MAIL_RELAY_URL;
  const secret = env.MAIL_RELAY_SECRET;
  if (!url) throw new Error('MAIL_RELAY_URL is not configured');
  if (!secret) throw new Error('MAIL_RELAY_SECRET is not configured');

  const payload = buildRelayPayload({ to, cc, subject, text });

  const res = await fetch(`${url}?action=send`, {
    method: 'POST',
    // text/plain avoids the CORS preflight Apps Script handles poorly, and
    // matches how the rest of this codebase talks to Apps Script endpoints.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    // Apps Script /exec bounces through a redirect before running the script.
    redirect: 'follow',
    body: JSON.stringify({ ...payload, secret }),
  });

  if (!res.ok) {
    throw new Error(`Mail relay HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Apps Script returns 200 with a JSON error body on failure, so the status
  // alone proves nothing — an unparseable body means we got the HTML login or
  // error page instead of the script, which is its own diagnosis.
  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(
      'Mail relay returned non-JSON — check the deployment is "Anyone" access ' +
        `and the /exec URL is current. Got: ${raw.slice(0, 150)}`
    );
  }

  if (!body.success) throw new Error(`Mail relay: ${body.error || 'unknown error'}`);
  return body;
}
