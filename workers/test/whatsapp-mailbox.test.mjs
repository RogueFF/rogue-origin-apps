import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsapp, pollWhatsappMailbox } from '../src/lib/whatsapp-mailbox.js';

test('sendWhatsapp returns false and does not fetch when secrets are unset', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const ok = await sendWhatsapp({}, { to: '+15415551234', body: 'hi' }, fakeFetch);
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('sendWhatsapp returns false and does not fetch when there is no recipient', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const ok = await sendWhatsapp(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' },
    { to: '', body: 'hi' }, fakeFetch);
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('sendWhatsapp posts bearer-authed JSON to <mailbox>/send with a digits-only "to"', async () => {
  let seenUrl, seenInit;
  const fakeFetch = async (url, init) => {
    seenUrl = url; seenInit = init;
    return new Response(JSON.stringify({ ok: true, wa_message_id: 'wamid.abc' }), { status: 200 });
  };
  const ok = await sendWhatsapp(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'secret-key' },
    { to: '+15415551234', body: 'Ok 9-10 Arriba: C4 WSc2' }, fakeFetch);
  assert.equal(ok, true);
  assert.equal(seenUrl, 'https://mailbox.example/send');
  assert.equal(seenInit.headers.Authorization, 'Bearer secret-key');
  const body = JSON.parse(seenInit.body);
  assert.equal(body.to, '15415551234');   // no '+' — matches the mailbox's own normalizeNumber
  assert.equal(body.text, 'Ok 9-10 Arriba: C4 WSc2');
});

test('sendWhatsapp throws on a mailbox error, naming the status and the recipient', async () => {
  const fakeFetch = async () => new Response('recipient_not_allowlisted', { status: 403 });
  await assert.rejects(
    () => sendWhatsapp(
      { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' },
      { to: '+15415551234', body: 'hi' }, fakeFetch),
    /403.*\+15415551234.*recipient_not_allowlisted/s);
});

test('pollWhatsappMailbox returns [] and does not fetch when unconfigured', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; };
  const messages = await pollWhatsappMailbox({}, { limit: 20 }, fakeFetch);
  assert.deepEqual(messages, []);
  assert.equal(called, false);
});

test('pollWhatsappMailbox GETs <mailbox>/poll?limit=N with the bearer and returns .messages', async () => {
  let seenUrl, seenInit;
  const fakeFetch = async (url, init) => {
    seenUrl = url; seenInit = init;
    return new Response(JSON.stringify({ messages: [{ wa_message_id: 'wamid.1', from_number: '15415551234', text_body: 'hola' }] }), { status: 200 });
  };
  const messages = await pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'secret-key' },
    { limit: 5 }, fakeFetch);
  assert.equal(seenUrl, 'https://mailbox.example/poll?limit=5');
  assert.equal(seenInit.headers.Authorization, 'Bearer secret-key');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].wa_message_id, 'wamid.1');
});

test('pollWhatsappMailbox throws on a non-2xx response', async () => {
  const fakeFetch = async () => new Response('unauthorized', { status: 401 });
  await assert.rejects(() => pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'bad' }, {}, fakeFetch), /401.*unauthorized/s);
});

test('pollWhatsappMailbox returns [] when the mailbox omits .messages', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const messages = await pollWhatsappMailbox(
    { WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k' }, {}, fakeFetch);
  assert.deepEqual(messages, []);
});

// Cloudflare blocks one Worker fetch()-ing another Worker's raw *.workers.dev
// URL (error 1042) — confirmed live 2026-09-16, the reason the drain never
// actually worked in production despite every test above passing. The
// WA_MAILBOX service binding routes around it; these two tests pin the
// selection logic between an explicit fetchImpl (every test above), the
// binding, and the plain-fetch fallback.

test('an explicit fetchImpl always wins over a WA_MAILBOX service binding', async () => {
  let bindingCalled = false;
  const env = {
    WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k',
    WA_MAILBOX: { fetch: async () => { bindingCalled = true; return new Response('{}', { status: 200 }); } },
  };
  const fakeFetch = async () => new Response(JSON.stringify({ messages: [] }), { status: 200 });
  await pollWhatsappMailbox(env, {}, fakeFetch);
  assert.equal(bindingCalled, false);
});

test('with no fetchImpl, a WA_MAILBOX service binding is used over global fetch', async () => {
  let seenUrl;
  const env = {
    WA_MAILBOX_URL: 'https://mailbox.example', WA_MAILBOX_KEY: 'k',
    WA_MAILBOX: {
      fetch: async (url) => { seenUrl = url; return new Response(JSON.stringify({ messages: [] }), { status: 200 }); },
    },
  };
  await pollWhatsappMailbox(env, { limit: 5 });
  assert.equal(seenUrl, 'https://mailbox.example/poll?limit=5');
});
