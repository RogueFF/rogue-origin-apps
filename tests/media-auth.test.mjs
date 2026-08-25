/**
 * Every write action on /api/media must require the operator password.
 *
 * WHY THIS TEST EXISTS: on 2026-08-25 a plain curl with no credentials and no
 * Origin header could enumerate the whole bucket AND push up to 250 MB into it,
 * getting back a URL served from our own workers.dev domain. `media-r2.js` was
 * the only handler in the tree that never imported `requireAuth`.
 *
 * The bucket is a THROWING STUB on purpose. R2 is the thing being protected, so
 * the test asserts the request never reaches it — a handler that authenticates
 * after touching storage would pass a status-code check and still have written
 * the object. Refusing before the bucket is the actual requirement.
 *
 * Reads (`serve`, `list`) are deliberately NOT covered here: 142 SOP images
 * render from them today and gating them is a separate decision.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMediaR2 } from '../workers/src/handlers/media-r2.js';
import { formatError } from '../workers/src/lib/errors.js';

const PASSWORD = 'correct-horse';

/** R2 that fails the test if the handler reaches it. */
const bucket = () => new Proxy({}, {
  get(_t, prop) {
    return () => { throw new Error(`R2 was reached: MEDIA_BUCKET.${String(prop)}() called before auth`); };
  },
});

const env = () => ({ ORDERS_PASSWORD: PASSWORD, MEDIA_BUCKET: bucket() });

const API = 'https://api.test/api/media';

/** The four write actions, each with the method and body its route expects. */
const WRITES = [
  {
    action: 'upload',
    request: (headers = {}) => {
      const form = new FormData();
      form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));
      return new Request(`${API}?action=upload`, { method: 'POST', headers, body: form });
    },
  },
  {
    action: 'create-upload-url',
    request: (headers = {}) => new Request(`${API}?action=create-upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ contentType: 'image/png', fileSize: 1024, fileName: 'a.png' }),
    }),
  },
  {
    action: 'upload-part',
    request: (headers = {}) => new Request(`${API}?action=upload-part&key=sop/x.png&uploadId=u1&partNumber=1`, {
      method: 'PUT', headers, body: 'bytes',
    }),
  },
  {
    action: 'confirm-upload',
    request: (headers = {}) => new Request(`${API}?action=confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ key: 'sop/x.png', uploadId: 'u1', parts: [] }),
    }),
  },
];

/**
 * Assert on the status the CLIENT sees. index.js turns a thrown ApiError into a
 * response through formatError, so that is the contract worth pinning — not the
 * internal field name the error happens to use.
 */
const refuses = async (promiseFn) => {
  await assert.rejects(promiseFn, (err) => {
    const { status, code } = formatError(err);
    assert.equal(status, 401, `expected 401, got ${status}`);
    assert.equal(code, 'UNAUTHORIZED');
    return true;
  });
};

for (const { action, request } of WRITES) {
  test(`${action} refuses an unauthenticated request`, async () => {
    await refuses(() => handleMediaR2(request(), env()));
  });

  test(`${action} refuses a wrong password`, async () => {
    await refuses(() => handleMediaR2(request({ Authorization: 'Bearer wrong' }), env()));
  });
}

test('the correct password gets past the gate and reaches R2', async () => {
  // Proves the gate is a gate and not a wall: the throwing stub standing in for
  // R2 is what this request now hits, which is the failure we WANT to see.
  await assert.rejects(
    () => handleMediaR2(
      WRITES[0].request({ Authorization: `Bearer ${PASSWORD}` }),
      env(),
    ),
    /R2 was reached/,
  );
});
