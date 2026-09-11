import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { twilioSignature, verifyTwilioSignature, sendSms } from '../src/lib/sms.js';

const TOKEN = '12345';
const URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/sms/inbound';
const PARAMS = { To: '+15415550100', From: '+15415550199', Body: '4 2 3 8 1 12', MessageSid: 'SM123' };

function oracle(token, url, params) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

test('twilioSignature matches an independent HMAC-SHA1 over url + sorted params', async () => {
  assert.equal(await twilioSignature(TOKEN, URL, PARAMS), oracle(TOKEN, URL, PARAMS));
});

test('verifyTwilioSignature accepts the right header and rejects a wrong or missing one', async () => {
  const good = oracle(TOKEN, URL, PARAMS);
  assert.equal(await verifyTwilioSignature(TOKEN, URL, PARAMS, good), true);
  assert.equal(await verifyTwilioSignature(TOKEN, URL, PARAMS, good.slice(0, -1) + 'A'), false);
  assert.equal(await verifyTwilioSignature(TOKEN, URL, PARAMS, ''), false);
  assert.equal(await verifyTwilioSignature(TOKEN, URL, { ...PARAMS, Body: 'tampered' }, good), false);
});

test('sendSms returns false and does not fetch when secrets are unset', async () => {
  let called = false;
  const ok = await sendSms({}, { to: '+15415550100', body: 'hi' }, async () => { called = true; });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('sendSms posts Basic-auth form data to the Twilio Messages endpoint', async () => {
  const env = { TWILIO_ACCOUNT_SID: 'ACxxx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15415550100' };
  let seen;
  const fakeFetch = async (url, init) => { seen = { url, init }; return { ok: true, text: async () => '' }; };
  const ok = await sendSms(env, { to: '+15415550199', body: 'hola' }, fakeFetch);
  assert.equal(ok, true);
  assert.equal(seen.url, 'https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json');
  assert.equal(seen.init.headers.Authorization, 'Basic ' + Buffer.from('ACxxx:tok').toString('base64'));
  assert.equal(String(seen.init.body), 'From=%2B15415550100&To=%2B15415550199&Body=hola');
});
