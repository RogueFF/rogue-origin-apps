/**
 * Print queue — the barn-PC print agent's half of tag printing.
 *
 * Why this exists: tag printing today is `window.print()` in the crew's
 * browser, which needs a print dialog, a paper size and a margins setting.
 * Chrome on the barn PC has all three. **iOS does not** — WebKit ignores
 * `@page`, so an iPhone cannot print the edge-to-edge 4x2 tag at all, and the
 * crew runs a mixed iPhone/Android fleet. See
 * `wiki/operations/plans/2026-09-18-wireless-tag-printer.md`.
 *
 * So the phone stops printing. It asks the server to print, the server queues a
 * job, and an agent on the barn PC drains the queue and drives the printer. The
 * phone only ever makes a web request — something every handset does
 * identically — which is the whole point.
 *
 * The queue rows are written in the SAME transaction as the sack rows
 * (`enqueueStatements` returns statements for the caller's batch, it does not
 * write). That mirrors the rule the sack note already follows: a job can never
 * exist for a tag that was not allocated, and cannot survive an allocation that
 * failed.
 *
 * SINGLE-AGENT ASSUMPTION: `pullJobs` selects then claims, which is not atomic
 * against a second agent racing it. The deployment is one barn PC. If a second
 * agent is ever added, move the claim to a single `UPDATE ... RETURNING`.
 */

import { query, queryOne, execute } from './db.js';
import { constantTimeEqual } from './auth.js';
import { createError } from './errors.js';

/**
 * How long an agent's check-in stays good. The agent heartbeats far more often
 * than this; the window is generous so a slow poll or a brief network blip does
 * not read as "offline" and bounce printing back to the browser mid-rack.
 */
export const AGENT_STALE_SECONDS = 90;

/** Jobs handed to the agent in one pull. A rack is rarely more than this. */
export const PULL_LIMIT = 20;

/**
 * Statements that enqueue one print job per sack, for the caller to append to
 * the transaction that creates the sacks. Returns statements rather than
 * writing, so the job and the tag commit together or not at all.
 *
 * @param {object}   opts
 * @param {string[]} opts.sackIds  Sack ids, in print order.
 * @param {0|1}      opts.isTest   Mirrors the sack's is_test: a test tag must
 *                                 never spend a real print job.
 * @param {string}  [opts.reason]  'print' (a new tag) or 'reprint' (a jam —
 *                                 same serial, no new sack row).
 * @returns {{sql: string, params: any[]}[]}
 */
export function enqueueStatements({ sackIds, isTest, reason = 'print' }) {
  if (!Array.isArray(sackIds) || sackIds.length === 0) return [];
  return sackIds.map(sackId => ({
    sql: `INSERT INTO harvest_print_queue (sack_id, reason, status, is_test)
          VALUES (?, ?, 'pending', ?)`,
    params: [sackId, reason, isTest ? 1 : 0],
  }));
}

/**
 * Claim the next pending jobs for one agent.
 *
 * @param {D1Database} db
 * @param {object} opts
 * @param {string} opts.agentId  Stamped on the rows so the Activity trail shows
 *                               which machine printed a tag.
 * @param {number} [opts.limit]
 * @param {0|1}    [opts.isTest] Keeps a test-mode queue and a real one apart.
 * @returns {Promise<object[]>}
 */
export async function pullJobs(db, { agentId, limit = PULL_LIMIT, isTest = 0 }) {
  const jobs = await query(db, `
    SELECT id, sack_id, reason, created_at
    FROM harvest_print_queue
    WHERE status = 'pending' AND is_test = ?
    ORDER BY id
    LIMIT ?
  `, [isTest ? 1 : 0, limit]);

  if (!jobs || jobs.length === 0) return [];

  const ph = jobs.map(() => '?').join(',');
  await execute(db, `
    UPDATE harvest_print_queue
    SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP, claimed_by = ?
    WHERE id IN (${ph})
  `, [agentId, ...jobs.map(j => j.id)]);

  return jobs;
}

/**
 * Record what physically happened to a job.
 *
 * The crew's confirmation used to be a tag appearing. With a queue in the
 * middle it has to be this ack instead — otherwise a dead agent spends serials
 * and moves Shopify counts while nothing ever prints, and it is discovered at
 * reconcile.
 *
 * @param {D1Database} db
 * @param {object} opts
 * @param {number} opts.jobId
 * @param {boolean} opts.ok
 * @param {string} [opts.error]
 */
export async function ackJob(db, { jobId, ok, error = null }) {
  return execute(db, `
    UPDATE harvest_print_queue
    SET status = ?, done_at = CURRENT_TIMESTAMP, error = ?
    WHERE id = ?
  `, [ok ? 'done' : 'failed', ok ? null : String(error || '').substring(0, 500), jobId]);
}

/**
 * The agent says it is alive. Upserted, so a restarted agent updates its row
 * rather than growing a new one each time it comes back.
 */
export async function recordHeartbeat(db, agentId, printer = null) {
  return execute(db, `
    INSERT INTO harvest_print_agents (agent_id, printer, last_seen)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP, printer = excluded.printer
  `, [agentId, printer]);
}

/** Has any agent checked in recently enough to be trusted with a tag? */
export async function agentOnline(db) {
  const row = await queryOne(db, `
    SELECT MAX(last_seen) AS last_seen FROM harvest_print_agents
  `);
  if (!row || !row.last_seen) return false;
  const seen = Date.parse(String(row.last_seen).replace(' ', 'T') + (
    /[Zz]|[+-]\d\d:?\d\d$/.test(String(row.last_seen)) ? '' : 'Z'
  ));
  if (!Number.isFinite(seen)) return false;
  return (Date.now() - seen) <= AGENT_STALE_SECONDS * 1000;
}

/**
 * Who prints this allocation — the browser, or the agent?
 *
 * Resolved per allocation and returned to the client in the `sack_alloc`
 * response, NOT baked into the page at render time. A phone can sit on a loaded
 * takedown screen for an hour; if the mode flipped underneath it, a page-baked
 * decision would have the browser print via its iframe while the agent printed
 * the same job — two physical tags, one serial, mid-rack.
 *
 * Falls back to 'browser' whenever no agent is online. A dead agent must never
 * silently swallow tags: the crew is standing at the printer waiting.
 */
export async function resolvePrintVia(db) {
  const row = await queryOne(db, `
    SELECT value FROM harvest_settings WHERE key = 'print_mode'
  `);
  if (!row || row.value !== 'agent') return 'browser';
  return (await agentOnline(db)) ? 'agent' : 'browser';
}

/**
 * Gate the agent endpoints.
 *
 * These are machine-to-machine, so they carry their own shared secret rather
 * than the crew password: the agent runs unattended on the barn PC, and a
 * leaked crew password should not also hand someone the print queue.
 *
 * AN UNSET SECRET CLOSES THE DOOR. If `HARVEST_PRINT_AGENT_TOKEN` is not
 * configured this throws rather than waving everyone through — the failure mode
 * of a forgotten secret must be "the agent cannot print", which is loud and
 * caught in setup, not "anyone can drain the queue", which is silent.
 */
export function requireAgentAuth(env, body = {}) {
  const expected = env?.HARVEST_PRINT_AGENT_TOKEN;
  if (!expected) {
    throw createError('UNAUTHORIZED', 'Print agent is not configured (HARVEST_PRINT_AGENT_TOKEN unset).');
  }
  const given = String(body.token || '');
  if (!constantTimeEqual(given, String(expected))) {
    throw createError('UNAUTHORIZED', 'Unauthorized print agent.');
  }
  return true;
}
