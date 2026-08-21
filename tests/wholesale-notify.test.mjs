/**
 * Unit tests for the board's Telegram notifications.
 *
 * The thing worth testing here is not the wording. It is that the cron, which
 * recomputes everything from scratch every five minutes, says each thing ONCE.
 * "Berry Bliss has started" stays true for the next fortnight; a bug here does
 * not show up as a wrong number on a screen, it shows up as somebody's phone
 * buzzing 288 times a day.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEvents, orderLabel, shortDate } from '../workers/src/lib/wholesale-notify.js';

const TODAY = '2026-08-21';

const line = (o = {}) => ({ lineId: 'L1', form: 'tops', qtyLbs: 100, doneLbs: 0, pct: 0, ...o });

const pass = (o = {}) => ({
  cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
  lines: [line()], finish: { date: '2026-09-09', minutes: 600 }, ...o,
});

const block = (o = {}) => ({
  orderId: 'MO-1', passes: [pass()], finish: { date: '2026-09-09', minutes: 600 }, ...o,
});

const order = (o = {}) => ({ id: 'MO-1', nickname: null, shopifyOrderName: '#5674', totalLbs: 100, ...o });

/** Every event except the silent bookkeeping one. */
const spoken = (events) => events.filter(e => !e.silent);

/** What the caller would have stored after a run. */
const ledgerFrom = (events) => new Map(events.map(e => [`${e.rule}:${e.key}`, e.meta || {}]));

// --- naming ---------------------------------------------------------------

test('an order is called what the floor calls it', () => {
  assert.equal(orderLabel({ nickname: "Bill's tops", shopifyOrderName: '#5674', id: 'MO-1' }), "Bill's tops");
});

test('without a nickname it falls back to the number, then the key', () => {
  assert.equal(orderLabel({ shopifyOrderName: '#5674', id: 'MO-1' }), '#5674');
  assert.equal(orderLabel({ id: 'MO-1' }), 'MO-1');
  assert.equal(orderLabel(null), 'order');
});

test('dates are formatted from parts, not through local parsing', () => {
  assert.equal(shortDate('2026-09-09'), 'Wed Sep 9');
  assert.equal(shortDate('2026-01-01'), 'Thu Jan 1');
});

// --- THE ONE THAT MATTERS: nothing repeats --------------------------------

test('a started strain is announced once, not on every tick', () => {
  const blocks = [block({ passes: [pass({ lines: [line({ doneLbs: 10, pct: 0.1 })] })] })];
  const first = deriveEvents({ blocks, orders: [order()], today: TODAY });
  assert.equal(spoken(first).filter(e => e.rule === 'strain_started').length, 1);

  // Second tick, same world, with the ledger the first run produced.
  const second = deriveEvents({ blocks, orders: [order()], sent: ledgerFrom(first), today: TODAY });
  assert.deepEqual(spoken(second), []);
});

test('a finished strain is announced once, then never again', () => {
  const blocks = [block({ passes: [pass({ lines: [line({ doneLbs: 100, pct: 1 })] })] })];
  const first = deriveEvents({ blocks, orders: [order()], today: TODAY });
  const rules = spoken(first).map(e => e.rule);
  assert.ok(rules.includes('strain_finished'));

  const second = deriveEvents({ blocks, orders: [order()], sent: ledgerFrom(first), today: TODAY });
  assert.deepEqual(spoken(second), []);
});

test('two runs of the same tick cannot produce a duplicate key', () => {
  // Two passes of the SAME cultivar in one order would collide on the dedup
  // key; the database would reject the second insert rather than ignore it.
  const blocks = [block({
    passes: [
      pass({ lines: [line({ doneLbs: 5, pct: 0.05 })] }),
      pass({ lines: [line({ lineId: 'L2', doneLbs: 5, pct: 0.05 })] }),
    ],
  })];
  const events = deriveEvents({ blocks, orders: [order()], today: TODAY });
  const keys = events.map(e => `${e.rule}:${e.key}`);
  assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.join(', ')}`);
});

// --- what each event says --------------------------------------------------

test('a strain that has not started says nothing', () => {
  const events = deriveEvents({ blocks: [block()], orders: [order()], today: TODAY });
  assert.deepEqual(spoken(events).map(e => e.rule), []);
});

test('a finished strain names what comes next in the same order', () => {
  const blocks = [block({
    passes: [
      pass({ lines: [line({ doneLbs: 100, pct: 1 })] }),
      pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty' }),
    ],
  })];
  const done = spoken(deriveEvents({ blocks, orders: [order()], today: TODAY }))
    .find(e => e.rule === 'strain_finished');
  assert.match(done.text, /Purple Frosty/);
});

test('the last strain of an order looks to the next order for what is next', () => {
  const blocks = [
    block({ passes: [pass({ lines: [line({ doneLbs: 100, pct: 1 })] })] }),
    block({ orderId: 'MO-2', passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] }),
  ];
  const done = spoken(deriveEvents({ blocks, orders: [order(), order({ id: 'MO-2' })], today: TODAY }))
    .find(e => e.rule === 'strain_finished');
  assert.match(done.text, /Lifter/);
});

test('a pass is only finished when EVERY line of it is', () => {
  // Tops filled, smalls still coming off the same lot.
  const blocks = [block({
    passes: [pass({
      lines: [line({ doneLbs: 100, pct: 1 }), line({ lineId: 'L2', form: 'smalls', doneLbs: 20, pct: 0.2 })],
    })],
  })];
  const rules = spoken(deriveEvents({ blocks, orders: [order()], today: TODAY })).map(e => e.rule);
  assert.ok(rules.includes('strain_started'));
  assert.ok(!rules.includes('strain_finished'), 'smalls are not done');
});

test('status changes become order started and order finished', () => {
  const events = spoken(deriveEvents({
    blocks: [],
    orders: [order({ id: 'MO-1' }), order({ id: 'MO-2', totalLbs: 900 })],
    moved: [
      { id: 'MO-1', from: 'in_queue', to: 'in_production' },
      { id: 'MO-2', from: 'in_production', to: 'finished' },
    ],
    today: TODAY,
  }));
  assert.ok(events.find(e => e.rule === 'order_started'));
  const fin = events.find(e => e.rule === 'order_finished');
  assert.match(fin.text, /900 lb/);
});

// --- the slipping date, which is the one that speaks twice ----------------

test('a date says nothing the first time it is seen', () => {
  const events = deriveEvents({ blocks: [block()], orders: [order()], today: TODAY });
  assert.equal(spoken(events).filter(e => e.rule === 'running_behind').length, 0);
  // But it is recorded, so the next slip has something to compare against.
  const rec = events.find(e => e.rule === 'promise_date');
  assert.equal(rec.meta.finish, '2026-09-09');
  assert.equal(rec.silent, true);
});

test('a slip of a day or more is reported, with both dates', () => {
  const sent = new Map([['promise_date:MO-1', { finish: '2026-09-09' }]]);
  const b = [block({ finish: { date: '2026-09-14', minutes: 600 } })];
  const ev = spoken(deriveEvents({ blocks: b, orders: [order()], sent, today: TODAY }))
    .find(e => e.rule === 'running_behind');
  assert.ok(ev, 'a five-day slip should be reported');
  assert.match(ev.text, /Mon Sep 14/);
  assert.match(ev.text, /Wed Sep 9/);
});

test('a date moving EARLIER is not a slip', () => {
  const sent = new Map([['promise_date:MO-1', { finish: '2026-09-14' }]]);
  const b = [block({ finish: { date: '2026-09-09', minutes: 600 } })];
  const ev = spoken(deriveEvents({ blocks: b, orders: [order()], sent, today: TODAY }));
  assert.equal(ev.filter(e => e.rule === 'running_behind').length, 0);
});

test('the same slip is not reported twice, but a further one is', () => {
  const sent = new Map([['promise_date:MO-1', { finish: '2026-09-09' }]]);
  const b = [block({ finish: { date: '2026-09-14', minutes: 600 } })];
  const first = deriveEvents({ blocks: b, orders: [order()], sent, today: TODAY });
  assert.equal(spoken(first).filter(e => e.rule === 'running_behind').length, 1);

  // Ledger now holds both the slip and the new date.
  const ledger = new Map([...sent, ...ledgerFrom(first)]);
  ledger.set('promise_date:MO-1', { finish: '2026-09-14' });
  const again = deriveEvents({ blocks: b, orders: [order()], sent: ledger, today: TODAY });
  assert.equal(spoken(again).filter(e => e.rule === 'running_behind').length, 0, 'same date, no news');

  const worse = deriveEvents({
    blocks: [block({ finish: { date: '2026-09-21', minutes: 600 } })],
    orders: [order()], sent: ledger, today: TODAY,
  });
  assert.equal(spoken(worse).filter(e => e.rule === 'running_behind').length, 1, 'a further slip is news');
});

// --- an empty floor --------------------------------------------------------

test('an empty queue says so, once a day rather than once ever', () => {
  const first = deriveEvents({ blocks: [], orders: [], today: TODAY });
  assert.equal(spoken(first).filter(e => e.rule === 'queue_clear').length, 1);

  const same = deriveEvents({ blocks: [], orders: [], sent: ledgerFrom(first), today: TODAY });
  assert.equal(spoken(same).length, 0);

  // Cleared again another day: worth saying again.
  const later = deriveEvents({ blocks: [], orders: [], sent: ledgerFrom(first), today: '2026-09-30' });
  assert.equal(spoken(later).filter(e => e.rule === 'queue_clear').length, 1);
});

test('a queue with work in it does not announce that it is clear', () => {
  const events = spoken(deriveEvents({ blocks: [block()], orders: [order()], today: TODAY }));
  assert.equal(events.filter(e => e.rule === 'queue_clear').length, 0);
});
