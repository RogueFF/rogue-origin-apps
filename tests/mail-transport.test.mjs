/**
 * Unit tests for mail transport selection and the Apps Script relay payload.
 *
 * Run with `node --test` (matches .github/workflows/test.yml).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTransport, sendEmail } from '../workers/src/lib/mailer.js';
import { buildRelayPayload, sendViaRelay } from '../workers/src/lib/mail-relay.js';

// --- transport selection -------------------------------------------------

test('MAIL_RELAY_URL selects the relay', () => {
  assert.equal(selectTransport({ MAIL_RELAY_URL: 'https://script.google.com/x/exec' }), 'relay');
});

test('GMAIL_SEND_AS alone selects the Gmail API', () => {
  assert.equal(selectTransport({ GMAIL_SEND_AS: 'noreply@rogueorigin.com' }), 'gmail');
});

test('relay wins when both are configured', () => {
  // Otherwise a leftover GMAIL_SEND_AS would silently keep routing through a
  // transport that needs delegation nobody granted.
  assert.equal(
    selectTransport({ MAIL_RELAY_URL: 'https://x/exec', GMAIL_SEND_AS: 'a@b.com' }),
    'relay'
  );
});

test('MAIL_TRANSPORT overrides inference in both directions', () => {
  assert.equal(
    selectTransport({ MAIL_TRANSPORT: 'gmail', MAIL_RELAY_URL: 'https://x/exec', GMAIL_SEND_AS: 'a@b.com' }),
    'gmail'
  );
  assert.equal(
    selectTransport({ MAIL_TRANSPORT: 'RELAY', MAIL_RELAY_URL: 'https://x/exec' }),
    'relay'
  );
});

test('nothing configured reports none', () => {
  assert.equal(selectTransport({}), 'none');
  assert.equal(selectTransport(), 'none');
});

test('an unconfigured send throws rather than silently dropping the mail', async () => {
  // A silent no-op would let a reorder alert vanish without reaching
  // notify_state, which is the exact failure this feature exists to prevent.
  await assert.rejects(
    () => sendEmail({}, { to: 'a@b.com', subject: 's', text: 't' }),
    /No mail transport configured/
  );
});

// --- relay payload -------------------------------------------------------

test('payload carries the message and omits cc when absent', () => {
  const p = buildRelayPayload({ to: 'damon@example.com', subject: 'Reorder', text: 'body' });
  assert.deepEqual(p, { to: 'damon@example.com', subject: 'Reorder', body: 'body' });
  assert.ok(!('cc' in p));
});

test('cc is included when supplied', () => {
  assert.equal(buildRelayPayload({ to: 'a@b.com', cc: 'k@x.com', subject: 's', text: 't' }).cc, 'k@x.com');
});

test('payload never contains the secret (so it stays safe to log)', () => {
  const p = buildRelayPayload({ to: 'a@b.com', subject: 's', text: 't' });
  assert.ok(!('secret' in p));
});

test('a missing recipient is an error, not an empty send', () => {
  assert.throws(() => buildRelayPayload({ subject: 's', text: 't' }), /no recipient/);
});

// --- relay transport behaviour -------------------------------------------

const ENV = { MAIL_RELAY_URL: 'https://script.google.com/macros/s/x/exec', MAIL_RELAY_SECRET: 'shh' };
const MSG = { to: 'damon@example.com', subject: 'Reorder needed', text: 'body' };

const withFetch = async (impl, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
};

test('posts to ?action=send with the secret attached', async () => {
  let seen;
  await withFetch(
    async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, text: async () => '{"success":true}' }; },
    () => sendViaRelay(ENV, MSG)
  );
  assert.match(seen.url, /\?action=send$/);
  assert.equal(seen.body.secret, 'shh');
  assert.equal(seen.body.to, 'damon@example.com');
});

test('a JSON error body is surfaced even though the HTTP status is 200', async () => {
  // Apps Script answers 200 with {success:false} on failure, so status alone
  // proves nothing.
  await assert.rejects(
    () => withFetch(
      async () => ({ ok: true, text: async () => '{"success":false,"error":"Unauthorized"}' }),
      () => sendViaRelay(ENV, MSG)
    ),
    /Unauthorized/
  );
});

test('an HTML response is diagnosed as a deployment problem', async () => {
  await assert.rejects(
    () => withFetch(
      async () => ({ ok: true, text: async () => '<!DOCTYPE html><html>Sign in</html>' }),
      () => sendViaRelay(ENV, MSG)
    ),
    /non-JSON/
  );
});

test('missing relay config throws with the specific variable named', async () => {
  await assert.rejects(() => sendViaRelay({ MAIL_RELAY_SECRET: 's' }, MSG), /MAIL_RELAY_URL/);
  await assert.rejects(() => sendViaRelay({ MAIL_RELAY_URL: 'https://x' }, MSG), /MAIL_RELAY_SECRET/);
});
