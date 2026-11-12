/**
 * Continuous (wholesale) jobs on the cell screen (Koa 2026-11-11: "it won't be a
 * 1lb batch, it will be however much is trimmed by the time the Bagging person
 * makes their round"). The bag size "Continuous" has no target: no ring to a
 * target, no chime, no finished state. A pickup ends the ROUND (the bag/tag
 * lift back empty, a basket swap, or the un-tared lift: lift.mjs rules, same as
 * any job), the round saves as a job (a pickup mark with its cultivar), and the
 * next round is ready on the same basket with the same cultivar, no taps.
 *
 * Kept out of main.js so the rules are tested (tests/cell-rounds.test.mjs).
 * Round numbers count the cell's continuous rounds per Pacific day, the same
 * count the Worker gives the Cells board (cell-board.js, from the pickup marks).
 */
export const CONT = 'cont';
export const CONT_BAG = { key: CONT, g: 0, continuous: true };

export const isContinuous = (bag) => bag === CONT;

/** Can this reading finish the job? Never in continuous: only a pickup ends a round. */
export function canFinish(state, netG) {
  return !isContinuous(state.bag) && state.targetG > 0 && netG >= state.targetG;
}

/** Rounds closed today (0 on a new day). */
export function roundsToday(state, day) {
  return state.roundDay === day ? state.round || 0 : 0;
}

/** The round in progress or about to start: 1 for the day's first. */
export const roundNo = (state, day) => roundsToday(state, day) + 1;

/**
 * A pickup closed the job. In continuous the order stays (the next round is the
 * same cultivar) and the day's round count goes up; otherwise the order clears
 * when every job is entered fresh (perJob, main.js ORDER_PER_JOB).
 * Mutates state; returns 'round' | 'cleared' | 'kept'.
 */
export function afterPickup(state, { day, perJob }) {
  if (isContinuous(state.bag)) {
    state.round = roundsToday(state, day) + 1;
    state.roundDay = day;
    state.targetG = 0;
    return 'round';
  }
  if (perJob) { state.cultivar = ''; state.bag = ''; state.targetG = 0; return 'cleared'; }
  return 'kept';
}

/**
 * Continuous is set for one day: picked yesterday and not trimming now (idle or
 * armed), it clears so the morning starts with a fresh pick, never yesterday's
 * cultivar. A round in progress is never touched. Returns true when it cleared.
 */
export function expireContinuous(state, day) {
  if (!isContinuous(state.bag) || state.phase === 'running' || state.phase === 'finished') return false;
  if (!state.contDay || state.contDay === day) { if (!state.contDay) state.contDay = day; return false; }
  endContinuous(state);
  return true;
}

/** Leave continuous between rounds: the order clears and the screen asks for a new pick. */
export function endContinuous(state) {
  state.bag = ''; state.cultivar = ''; state.targetG = 0; state.contDay = '';
  // Armed between rounds: the empty basket is still on the tared scale, so the
  // next pick arms again with no Start (main.js armIfReady).
  if (state.phase === 'armed') { state.phase = 'idle'; state.basketBack = true; }
}

/** The queue never replaces a continuous order (auto-assign is a stand-in, off live). */
export const queueMayApply = (state) => !isContinuous(state.bag);
