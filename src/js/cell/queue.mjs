/**
 * NOW / NEXT on the cell screen (order flow slice 2, design doc §2e; Koa
 * 2026-11-11: "automatic order assignment"). The Worker assigns orders to cells
 * (cellQueue); the screen takes its NOW job as the order instead of the two
 * dropdowns. Pure, so it's unit-tested (tests/cell-queue.test.mjs).
 */

/** "2026 - Sour Lifter / Sungrown" -> "Sour Lifter". */
export function shortCultivar(c) {
  return String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim();
}

/**
 * Put the queue's NOW job on the screen's state, when the order may change.
 * A running or finished job is never changed under the trimmer (it closes with a
 * pickup first). A job this tablet just closed is ignored until the Worker has
 * moved on, so a slow reply can't bring it back.
 *
 * @param {object} state  the screen's job state (cultivar, bag, targetG, jobId, ...)
 * @param {object|null} now  cellQueue's NOW job, or null
 * @param {{locked:boolean, closed:Set<number>, bagOk:(key:string)=>boolean}} o
 * @returns {'set'|'cleared'|null} what changed
 */
export function applyQueue(state, now, { locked, closed = new Set(), bagOk = () => true }) {
  if (locked) return null;
  const job = now && !closed.has(now.id) && bagOk(now.bag) && now.targetG > 0 ? now : null;
  if (job) {
    if (state.jobId === job.id) return null;
    state.jobId = job.id;
    state.orderName = job.orderName || '';
    state.cultivar = job.cultivar;
    state.bag = job.bag;
    state.targetG = job.targetG;
    state.jobTargetG = job.targetG;
    return 'set';
  }
  if (state.jobId) {
    // The job left this cell (moved, held or cancelled) before anything was trimmed.
    state.jobId = null; state.orderName = ''; state.cultivar = ''; state.bag = ''; state.targetG = 0; state.jobTargetG = 0;
    return 'cleared';
  }
  return null;
}
