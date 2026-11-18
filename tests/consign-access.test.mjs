import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  newToken, tokenHash, pinHash, validPin, validToken, lockState, sqlTime, MAX_TRIES, LOCK_MINUTES,
} from '../workers/src/lib/consign-access.js';

test('constants: five tries, fifteen minutes', () => {
  assert.equal(MAX_TRIES, 5);
  assert.equal(LOCK_MINUTES, 15);
});

test('newToken: 32 random bytes as base64url, 43 characters, never repeats', () => {
  const a = newToken();
  const b = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.ok(validToken(a));
});

test('validToken refuses anything but 43 base64url characters', () => {
  for (const v of [undefined, null, 12, '', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`, ['x']]) {
    assert.equal(validToken(v), false, String(v));
  }
});

test('tokenHash is hex sha256 of the token (checked against node:crypto)', async () => {
  const tok = newToken();
  assert.equal(await tokenHash(tok), createHash('sha256').update(tok).digest('hex'));
});

test('pinHash is HMAC-SHA256(key = token, "<id>:<pin>") in hex (checked against node:crypto)', async () => {
  const tok = newToken();
  const want = createHmac('sha256', tok).update('7:1234').digest('hex');
  assert.equal(await pinHash(tok, 7, '1234'), want);
  assert.notEqual(await pinHash(tok, 8, '1234'), want, 'bound to the access row');
  assert.notEqual(await pinHash(newToken(), 7, '1234'), want, 'bound to the token');
});

test('validPin: a string of exactly four digits', () => {
  for (const ok of ['0000', '1234', '9999']) assert.equal(validPin(ok), true, ok);
  for (const no of [1234, '123', '12345', ' 1234', '12a4', '１２３４', '', null, undefined, ['1234']]) assert.equal(validPin(no), false, String(no));
});

test('sqlTime writes SQLite UTC text', () => {
  assert.equal(sqlTime(new Date('2026-11-17T08:05:09.500Z')), '2026-11-17 08:05:09');
});

test('lockState: unlocked, locked with minutes left (rounded up), expired', () => {
  const now = new Date('2026-11-17T08:00:00Z');
  assert.deepEqual(lockState({ locked_until: null }, now), { locked: false, minutes_left: 0 });
  assert.deepEqual(lockState({ locked_until: '2026-11-17 08:15:00' }, now), { locked: true, minutes_left: 15 });
  assert.deepEqual(lockState({ locked_until: '2026-11-17 08:00:01' }, now), { locked: true, minutes_left: 1 });
  assert.deepEqual(lockState({ locked_until: '2026-11-17 08:00:00' }, now), { locked: false, minutes_left: 0 });
  assert.deepEqual(lockState({ locked_until: '2026-11-17 07:00:00' }, now), { locked: false, minutes_left: 0 });
});
