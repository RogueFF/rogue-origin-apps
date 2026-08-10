/**
 * Unit tests for the pure pieces of the Grove reorder alert.
 *
 * Covers the two things that are pure and load-bearing: which vendors divert
 * out of the Friday cart, and the RFC 2822 message we hand to Gmail. The D1 and
 * Gmail round-trips are integration surface — see the design doc §9.
 *
 * Run with `node --test` (matches .github/workflows/test.yml).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMimeMessage } from '../workers/src/lib/gmail.js';
import { isReorderAlertVendor } from '../workers/src/handlers/kanban-d1.js';

// --- routing -------------------------------------------------------------

test('Grove routes to a reorder alert', () => {
  assert.equal(isReorderAlertVendor('Grove'), true);
});

test('other vendors stay on the Friday cart', () => {
  for (const v of ['Amazon', 'Uline', 'Walmart', 'Sticker Mule', 'McMaster', 'AmeriVacS']) {
    assert.equal(isReorderAlertVendor(v), false, `${v} should use the cart`);
  }
});

test('routing tolerates whitespace and missing suppliers', () => {
  assert.equal(isReorderAlertVendor(' Grove '), true);
  assert.equal(isReorderAlertVendor(''), false);
  assert.equal(isReorderAlertVendor(null), false);
  assert.equal(isReorderAlertVendor(undefined), false);
});

test('routing is case-sensitive to match the stored supplier value exactly', () => {
  // Cards store 'Grove'. If a card is ever saved as 'grove' this returns false
  // and the item silently goes to the Friday cart — documented on purpose so
  // the failure mode is a known one rather than a surprise.
  assert.equal(isReorderAlertVendor('grove'), false);
});

// --- MIME ----------------------------------------------------------------

const BASE = {
  from: 'noreply@rogueorigin.com',
  to: 'damon@example.com',
  subject: 'Reorder needed: 10 LB GROVE BAGS',
  text: 'body text',
};

test('builds headers and separates the body with a blank line', () => {
  const msg = buildMimeMessage(BASE);
  assert.match(msg, /^From: noreply@rogueorigin\.com\r\n/);
  assert.match(msg, /\r\nTo: damon@example\.com\r\n/);
  assert.match(msg, /\r\nSubject: Reorder needed: 10 LB GROVE BAGS\r\n/);
  assert.ok(msg.includes('\r\n\r\nbody text'), 'blank line must separate headers from body');
});

test('omits Cc entirely when not supplied', () => {
  assert.ok(!buildMimeMessage(BASE).includes('Cc:'));
  assert.match(buildMimeMessage({ ...BASE, cc: 'koa@example.com' }), /\r\nCc: koa@example\.com\r\n/);
});

test('uses CRLF line endings throughout the header block', () => {
  const headerBlock = buildMimeMessage(BASE).split('\r\n\r\n')[0];
  assert.ok(!/(?<!\r)\n/.test(headerBlock), 'bare LF would violate RFC 2822');
});

test('non-ASCII subjects are RFC 2047 encoded rather than sent raw', () => {
  const msg = buildMimeMessage({ ...BASE, subject: 'Reorder: café ☕' });
  const subject = msg.split('\r\n').find((l) => l.startsWith('Subject:'));
  assert.match(subject, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/]+=*\?=$/);
  // Round-trips back to the original.
  const b64 = subject.match(/\?B\?([^?]+)\?=/)[1];
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'Reorder: café ☕');
});

test('ASCII subjects are left readable, not needlessly encoded', () => {
  assert.ok(!buildMimeMessage(BASE).includes('=?UTF-8?B?'));
});

test('a UTF-8 body survives intact', () => {
  const msg = buildMimeMessage({ ...BASE, text: 'naïve — ordered ✓' });
  assert.ok(msg.endsWith('naïve — ordered ✓'));
  assert.match(msg, /Content-Type: text\/plain; charset="UTF-8"/);
});

test('missing from/to is a programming error, not a silent empty header', () => {
  assert.throws(() => buildMimeMessage({ ...BASE, from: '' }), /from is required/);
  assert.throws(() => buildMimeMessage({ ...BASE, to: '' }), /to is required/);
});

test('an empty body still produces a well-formed message', () => {
  const msg = buildMimeMessage({ ...BASE, text: '' });
  assert.ok(msg.includes('\r\n\r\n'));
  assert.ok(msg.endsWith('\r\n\r\n'));
});
