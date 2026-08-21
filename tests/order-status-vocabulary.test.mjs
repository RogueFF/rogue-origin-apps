/**
 * Drift guard for the order status vocabulary.
 *
 * The wholesale feature exists because four status vocabularies had been
 * allowed to coexist: the database only ever held 'pending', the UI badge map
 * said Open|Partial|Fulfilled|Paid|Closed, the scoreboard filtered on
 * completed|cancelled, and the optimistic client wrote 'Open'. Nothing ever
 * agreed, and nothing ever noticed.
 *
 * The words now live in four places by necessity — a CHECK constraint in SQL, a
 * validation Set in the worker, a picker list in the browser, and the queue /
 * off-queue split that must partition them. None of those can import from the
 * others, so this reads the source text and asserts they still say the same
 * thing. It is the only test in the suite that greps rather than calls, which is
 * the point: a normal unit test cannot see a mismatch between a migration and a
 * constant, and that mismatch is precisely the failure this feature was built
 * to end.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The vocabulary, in the order the floor moves through it. */
const EXPECTED = ['in_queue', 'in_production', 'finished'];

/** Statuses whose demand the scheduler is allowed to place on the calendar. */
const EXPECTED_SCHEDULABLE = ['in_queue', 'in_production'];

/**
 * Pull every quoted word out of a bracketed or parenthesised list. Accepts
 * either quote style — the worker's queue section is written in double quotes
 * and the rest of the file in single, and which one a constant happens to use
 * is not something this test should have an opinion about.
 */
const words = (src, re) => {
  const m = src.match(re);
  assert.ok(m, `pattern not found: ${re}`);
  return [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map(x => x[1]);
};

/**
 * The migration that currently owns `orders.status`. Found rather than named so
 * that adding 0020 does not leave this test pinning a superseded constraint.
 */
function latestOrdersMigration() {
  const files = readdirSync(join(ROOT, 'workers/migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort();
  const owning = files.filter(f => {
    const src = read(`workers/migrations/${f}`);
    return /CREATE TABLE orders(_new)?\s*\(/.test(src) && /CHECK \(status IN \(/.test(src);
  });
  assert.ok(owning.length, 'no migration creates orders with a status CHECK');
  return owning[owning.length - 1];
}

test('the database CHECK constraint holds exactly the three statuses', () => {
  const src = read(`workers/migrations/${latestOrdersMigration()}`);
  assert.deepEqual(words(src, /CHECK \(status IN \(([^)]*)\)\)/), EXPECTED);
});

test('the column default is the status a new order starts in', () => {
  const src = read(`workers/migrations/${latestOrdersMigration()}`);
  const m = src.match(/status\s+TEXT NOT NULL DEFAULT '([a-z_]+)'/);
  assert.ok(m, 'no DEFAULT on orders.status');
  assert.equal(m[1], EXPECTED[0]);
});

test('the worker validates against the same three, and defaults to the same one', () => {
  const src = read('workers/src/handlers/wholesale-d1.js');
  assert.deepEqual(words(src, /const ORDER_STATUSES = new Set\(\[([^\]]*)\]\)/), EXPECTED);

  const m = src.match(/const status = body\.status \|\| '([a-z_]+)'/);
  assert.ok(m, 'saveOrder no longer defaults a status');
  assert.equal(m[1], EXPECTED[0]);
});

test('an unattended Shopify import writes a real status, not one of its own', () => {
  const src = read('workers/src/handlers/wholesale-d1.js');
  // Matched on the two literals rather than the placeholder count, which
  // changes whenever a column is added or removed — it lost one when the
  // customer dimension went, and a guard that breaks on unrelated edits is a
  // guard people start ignoring.
  const m = src.match(/'([a-z_]+)',\s*'shopify'/);
  assert.ok(m, 'importOrder no longer inserts a literal status');
  assert.ok(EXPECTED.includes(m[1]), `importOrder writes "${m[1]}", not in the vocabulary`);
});

test('the browser offers exactly the statuses the database will accept', () => {
  const src = read('src/js/wholesale/state.js');
  assert.deepEqual(words(src, /export const STATUSES = \[([^\]]*)\]/), EXPECTED);
});

test('every status has a label in both languages', () => {
  const src = read('src/js/wholesale/index.js');
  for (const s of EXPECTED) {
    const hits = [...src.matchAll(new RegExp(`status_${s}:`, 'g'))].length;
    assert.equal(hits, 2, `status_${s} needs an en and an es label, found ${hits}`);
  }
});

test('the queue and the off-queue list partition the vocabulary, leaving nothing orphaned', () => {
  const server = words(read('workers/src/handlers/wholesale-d1.js'),
    /const SCHEDULABLE = \[([^\]]*)\]/);
  const client = words(read('src/js/wholesale/render.js'), /const QUEUED = \[([^\]]*)\]/);

  assert.deepEqual(server, EXPECTED_SCHEDULABLE);
  assert.deepEqual(client, EXPECTED_SCHEDULABLE,
    'the off-queue list is the complement of the queue; a mismatch hides orders from both');

  // The partition is the load-bearing property: an order reachable from neither
  // the queue nor the archive cannot be found in the app at all.
  const offQueue = EXPECTED.filter(s => !client.includes(s));
  assert.deepEqual([...client, ...offQueue].sort(), [...EXPECTED].sort());
  assert.ok(offQueue.length, 'nothing is off-queue, so a finished order never leaves the board');
});

test('the automatic transition ladder covers exactly the vocabulary', () => {
  // Decision 5: status is fully automatic. The cron walks orders forward along
  // this ladder and never backward. A status missing from it would compare as
  // `undefined` and silently never advance — the failure would look like the
  // floor's work simply not registering.
  const src = read('workers/src/handlers/wholesale-d1.js');
  const m = src.match(/const FORWARD = \{([^}]*)\}/);
  assert.ok(m, 'syncOrderStatuses no longer has a FORWARD ladder');
  const rungs = [...m[1].matchAll(/([a-z_]+):\s*(\d+)/g)].map(x => [x[1], Number(x[2])]);
  assert.deepEqual(rungs.map(r => r[0]), EXPECTED, 'the ladder must be the vocabulary, in order');
  assert.deepEqual(rungs.map(r => r[1]), [0, 1, 2], 'and strictly increasing, or nothing advances');
});

test('the implied statuses the cron can write are all real statuses', () => {
  const src = read('workers/src/lib/burndown.js');
  const implied = [...src.matchAll(/return '([a-z_]+)';/g)].map(x => x[1]);
  assert.ok(implied.length, 'impliedStatus no longer returns any status');
  for (const st of implied) {
    assert.ok(EXPECTED.includes(st), `impliedStatus can return "${st}", which is not a valid status`);
  }
});

test('the retired vocabulary is gone from the wholesale surface', () => {
  const files = [
    'workers/src/handlers/wholesale-d1.js',
    'src/js/wholesale/state.js',
    'src/js/wholesale/render.js',
    'src/js/wholesale/editor.js',
    'src/js/wholesale/queue.js',
    'src/css/wholesale.css',
  ];
  // 'open' alone is excluded: it is a legitimate CSS/DOM class name elsewhere on
  // the page (the sidebar toggles `.open`). The quoted-status forms are not.
  const retired = ["'draft'", '"draft"', "'shipped'", '"shipped"', "'closed'", '"closed"', '.s-shipped'];
  for (const f of files) {
    const src = read(f);
    for (const word of retired) {
      assert.ok(!src.includes(word), `${f} still refers to ${word}`);
    }
  }
});
