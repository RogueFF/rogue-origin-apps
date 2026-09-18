import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueStatements, pullJobs, ackJob, recordHeartbeat, agentOnline, resolvePrintVia,
  AGENT_STALE_SECONDS, requireAgentAuth, enqueueReprint, jobStatusFor, requeueStale,
  resolvePrinter,
} from '../src/lib/print-queue.js';

/**
 * Same shape as the fake D1 in harvest-hourly-channel.test.mjs: canned results
 * in call order, recording the SQL and params it was handed. The subject here
 * is which rows the queue claims and what it stamps on them — not SQLite.
 */
function fakeDb(responses = []) {
  const calls = [];
  let i = 0;
  const take = () => responses[i++];
  return {
    calls,
    matching(...needles) {
      return calls.filter(c => needles.every(n => c.sql.includes(n)));
    },
    prepare(sql) {
      return {
        bind(...params) {
          const call = { sql: String(sql).replace(/\s+/g, ' ').trim(), params };
          calls.push(call);
          return {
            all: async () => ({ results: take() ?? [] }),
            first: async () => take() ?? null,
            run: async () => ({ meta: { changes: take()?.changes ?? 1, last_row_id: 1 } }),
          };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// enqueueStatements — rides the same transaction as the sack insert
// ---------------------------------------------------------------------------

test('enqueueStatements returns one statement per sack id', () => {
  const sts = enqueueStatements({ sackIds: ['26-SLIFT-1', '26-SLIFT-2'], isTest: 0 });
  assert.equal(sts.length, 2);
  assert.match(sts[0].sql, /INSERT INTO harvest_print_queue/);
  assert.ok(sts[0].params.includes('26-SLIFT-1'));
  assert.ok(sts[1].params.includes('26-SLIFT-2'));
});

test('enqueueStatements mirrors is_test so a test tag never spends a real print job', () => {
  const real = enqueueStatements({ sackIds: ['26-SLIFT-1'], isTest: 0 });
  const testy = enqueueStatements({ sackIds: ['26-SLIFT-1'], isTest: 1 });
  assert.ok(real[0].params.includes(0));
  assert.ok(testy[0].params.includes(1));
});

test('enqueueStatements records why the job exists, so a reprint is distinguishable', () => {
  const [st] = enqueueStatements({ sackIds: ['26-SLIFT-9'], isTest: 0, reason: 'reprint' });
  assert.ok(st.params.includes('reprint'));
});

test('enqueueStatements defaults the reason to print', () => {
  const [st] = enqueueStatements({ sackIds: ['26-SLIFT-9'], isTest: 0 });
  assert.ok(st.params.includes('print'));
});

test('enqueueStatements on no ids is empty, never a malformed statement', () => {
  assert.deepEqual(enqueueStatements({ sackIds: [], isTest: 0 }), []);
});

// ---------------------------------------------------------------------------
// pullJobs — the agent claims work
// ---------------------------------------------------------------------------

test('pullJobs claims only pending jobs and stamps the agent that took them', async () => {
  const db = fakeDb([[{ id: 1, sack_id: '26-SLIFT-1' }], { changes: 1 }]);
  const jobs = await pullJobs(db, { agentId: 'barn-pc', limit: 5 });

  const select = db.matching('SELECT', 'harvest_print_queue')[0];
  assert.match(select.sql, /status = 'pending'/);
  assert.equal(jobs.length, 1);

  const claim = db.matching('UPDATE harvest_print_queue', "status = 'claimed'")[0];
  assert.ok(claim, 'claims the rows it returned');
  assert.ok(claim.params.includes('barn-pc'));
});

test('pullJobs returns nothing and claims nothing when the queue is empty', async () => {
  const db = fakeDb([[]]);
  const jobs = await pullJobs(db, { agentId: 'barn-pc', limit: 5 });
  assert.deepEqual(jobs, []);
  assert.equal(db.matching('UPDATE harvest_print_queue').length, 0);
});

test('pullJobs never hands the agent test-mode jobs alongside real ones', async () => {
  const db = fakeDb([[{ id: 1, sack_id: '26-SLIFT-1' }], { changes: 1 }]);
  await pullJobs(db, { agentId: 'barn-pc', limit: 5, isTest: 0 });
  const select = db.matching('SELECT', 'harvest_print_queue')[0];
  assert.ok(select.params.includes(0), 'filters on is_test');
});

// ---------------------------------------------------------------------------
// ackJob — the agent reports what physically happened
// ---------------------------------------------------------------------------

test('ackJob marks a printed job done', async () => {
  const db = fakeDb([{ changes: 1 }]);
  await ackJob(db, { jobId: 7, ok: true });
  const up = db.matching('UPDATE harvest_print_queue')[0];
  assert.ok(up.params.includes('done'));
});

test('ackJob records the failure text so the screen can show why', async () => {
  const db = fakeDb([{ changes: 1 }]);
  await ackJob(db, { jobId: 7, ok: false, error: 'printer offline' });
  const up = db.matching('UPDATE harvest_print_queue')[0];
  assert.ok(up.params.includes('failed'));
  assert.ok(up.params.includes('printer offline'));
});

// ---------------------------------------------------------------------------
// Heartbeat — the gate that runs BEFORE a serial is spent
// ---------------------------------------------------------------------------

test('agentOnline is true when the agent checked in inside the stale window', async () => {
  const fresh = new Date(Date.now() - 5000).toISOString();
  const db = fakeDb([{ last_seen: fresh }]);
  assert.equal(await agentOnline(db), true);
});

test('agentOnline is false when the last check-in is older than the stale window', async () => {
  const old = new Date(Date.now() - (AGENT_STALE_SECONDS + 60) * 1000).toISOString();
  const db = fakeDb([{ last_seen: old }]);
  assert.equal(await agentOnline(db), false);
});

test('agentOnline is false when no agent has ever checked in', async () => {
  const db = fakeDb([null]);
  assert.equal(await agentOnline(db), false);
});

test('recordHeartbeat upserts so a restarted agent does not duplicate rows', async () => {
  const db = fakeDb([{ changes: 1 }]);
  await recordHeartbeat(db, 'barn-pc');
  const up = db.matching('harvest_print_agents')[0];
  assert.match(up.sql, /ON CONFLICT/);
  assert.ok(up.params.includes('barn-pc'));
});

// ---------------------------------------------------------------------------
// resolvePrintVia — authoritative per allocation, so a stale page cannot
// double-print (browser iframe AND agent) mid-takedown
// ---------------------------------------------------------------------------

test('resolvePrintVia is browser when the mode is unset', async () => {
  const db = fakeDb([null]);
  assert.equal(await resolvePrintVia(db), 'browser');
});

test('resolvePrintVia is agent when the mode says agent and an agent is online', async () => {
  const fresh = new Date().toISOString();
  const db = fakeDb([{ value: 'agent' }, { last_seen: fresh }]);
  assert.equal(await resolvePrintVia(db), 'agent');
});

test('resolvePrintVia falls back to browser when the mode says agent but none is online', async () => {
  const old = new Date(Date.now() - (AGENT_STALE_SECONDS + 60) * 1000).toISOString();
  const db = fakeDb([{ value: 'agent' }, { last_seen: old }]);
  assert.equal(
    await resolvePrintVia(db), 'browser',
    'a dead agent must not silently swallow tags — the browser still prints',
  );
});

// ---------------------------------------------------------------------------
// requireAgentAuth — the agent endpoints are machine-to-machine, so they carry
// their own shared secret rather than the crew's password
// ---------------------------------------------------------------------------

test('requireAgentAuth accepts the configured token', () => {
  assert.equal(
    requireAgentAuth({ HARVEST_PRINT_AGENT_TOKEN: 's3cret' }, { token: 's3cret' }),
    true,
  );
});

test('requireAgentAuth rejects a wrong token', () => {
  assert.throws(
    () => requireAgentAuth({ HARVEST_PRINT_AGENT_TOKEN: 's3cret' }, { token: 'nope' }),
    /unauthorized/i,
  );
});

test('requireAgentAuth rejects a missing token', () => {
  assert.throws(
    () => requireAgentAuth({ HARVEST_PRINT_AGENT_TOKEN: 's3cret' }, {}),
    /unauthorized/i,
  );
});

test('requireAgentAuth refuses to run at all when no secret is configured', () => {
  assert.throws(
    () => requireAgentAuth({}, { token: 'anything' }),
    /not configured/i,
    'an unset secret must close the door, never open it to everyone',
  );
});

// ---------------------------------------------------------------------------
// enqueueReprint — the jam path. Same serial, NO new sack row.
// A reprint that still went through the browser would be broken on iPhone in
// agent mode, which is the crew's most time-critical failure path.
// ---------------------------------------------------------------------------

test('enqueueReprint queues a job marked reprint', async () => {
  const db = fakeDb([{ changes: 1 }]);
  await enqueueReprint(db, { sackId: '26-SLIFT-142', isTest: 0 });
  const ins = db.matching('INSERT INTO harvest_print_queue')[0];
  assert.ok(ins.params.includes('reprint'));
  assert.ok(ins.params.includes('26-SLIFT-142'));
});

test('enqueueReprint never touches harvest_sacks — a jam is not a new bag', async () => {
  const db = fakeDb([{ changes: 1 }]);
  await enqueueReprint(db, { sackId: '26-SLIFT-142', isTest: 0 });
  assert.equal(db.matching('harvest_sacks').length, 0);
});

// ---------------------------------------------------------------------------
// jobStatusFor — what the crew screen polls before it shows a tick.
// Without this the screen says "printed" on the strength of a queue insert.
// ---------------------------------------------------------------------------

test('jobStatusFor reports the latest job state per sack', async () => {
  const db = fakeDb([[{ sack_id: '26-SLIFT-1', status: 'done', error: null }]]);
  const st = await jobStatusFor(db, ['26-SLIFT-1']);
  assert.equal(st['26-SLIFT-1'].status, 'done');
});

test('jobStatusFor carries the failure reason through to the screen', async () => {
  const db = fakeDb([[{ sack_id: '26-SLIFT-1', status: 'failed', error: 'out of labels' }]]);
  const st = await jobStatusFor(db, ['26-SLIFT-1']);
  assert.equal(st['26-SLIFT-1'].error, 'out of labels');
});

test('jobStatusFor on no ids queries nothing', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await jobStatusFor(db, []), {});
  assert.equal(db.calls.length, 0);
});

// ---------------------------------------------------------------------------
// requeueStale — an agent that crashed mid-job leaves rows claimed forever
// ---------------------------------------------------------------------------

test('requeueStale returns claimed jobs to pending so they print after a crash', async () => {
  const db = fakeDb([{ changes: 2 }]);
  await requeueStale(db);
  const up = db.matching('UPDATE harvest_print_queue')[0];
  assert.match(up.sql, /status = 'pending'/);
  assert.match(up.sql, /'claimed'/);
});

// ---------------------------------------------------------------------------
// resolvePrinter — which physical queue the agent should print to.
// Lives in the DB so a dead printer can be swapped for the spare with one
// line, instead of walking to the barn PC to edit env vars and restart.
// ---------------------------------------------------------------------------

test('resolvePrinter returns the configured printer', async () => {
  const db = fakeDb([{ value: 'Zebra  ZP 450-200 dpi' }]);
  assert.equal(await resolvePrinter(db), 'Zebra  ZP 450-200 dpi');
});

test('resolvePrinter returns null when unset, so the agent keeps its own default', async () => {
  const db = fakeDb([null]);
  assert.equal(await resolvePrinter(db), null);
});

test('resolvePrinter preserves the exact queue name including double spaces', async () => {
  const db = fakeDb([{ value: 'Zebra  ZP 450-200 dpi' }]);
  const name = await resolvePrinter(db);
  assert.ok(name.includes('Zebra  ZP'), 'the Zebra driver really does install with two spaces');
});
