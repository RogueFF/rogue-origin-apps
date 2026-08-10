/**
 * Single entry point for outbound transactional mail.
 *
 * Two transports exist because they trade off differently, and which one is
 * live is a config choice rather than a code change:
 *
 *   relay  (apps-script/mail-relay) — runs as the script owner's Google
 *          account, so it needs no domain-wide delegation and no admin-console
 *          grant. Sends from that person's address.
 *   gmail  (lib/gmail.js) — service account impersonating a mailbox via
 *          domain-wide delegation. Sends from a proper noreply@ address, but
 *          requires a super admin to grant the gmail.send scope.
 *
 * See docs/plans/2026-08-10-grove-reorder-alert-design.md §8.
 */

import { sendViaRelay } from './mail-relay.js';
import { sendEmail as sendViaGmail } from './gmail.js';

/**
 * Which transport the current config selects. Pure — unit-tested.
 * Explicit MAIL_TRANSPORT wins; otherwise infer from which one is configured.
 */
export function selectTransport(env = {}) {
  const explicit = String(env.MAIL_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'relay' || explicit === 'gmail') return explicit;
  if (env.MAIL_RELAY_URL) return 'relay';
  if (env.GMAIL_SEND_AS) return 'gmail';
  return 'none';
}

/**
 * Send a plain-text email via the configured transport.
 * Throws on failure, including when nothing is configured — a silent no-op
 * would let a reorder alert disappear without landing in notify_state.
 */
export async function sendEmail(env, opts) {
  const transport = selectTransport(env);
  if (transport === 'relay') return sendViaRelay(env, opts);
  if (transport === 'gmail') return sendViaGmail(env, opts);
  throw new Error(
    'No mail transport configured — set MAIL_RELAY_URL (Apps Script relay) ' +
      'or GMAIL_SEND_AS (Gmail API + domain-wide delegation)'
  );
}
