/**
 * The line trimmer seat (Koa 2026-11-24: the cells are over, the room is back on
 * buckers -> T-Zero -> trimmers, and every trimmer seat keeps a scale). Pure, so
 * the rules are unit-tested (tests/line-seat.test.mjs); main.js wires them to the
 * scale and the screen.
 *
 *   · A batch is one clock hour of the line (Koa 2026-11-24: "1 hour batch, not
 *     a 1lb batch"): the hours of Hourly entry, 7-8 .. 12:30-1 .. 4-4:30. Two
 *     baskets per trimmer: at the hour mark basket A goes aside for pickup, B goes
 *     on and is tared, and the next batch starts itself.
 *   · Tops per hour are the weight gained in each clock hour, not pickups: the
 *     basket's net is credited to the hour it was read in, so a basket half full
 *     at 9:00 splits across 8-9 and 9-10. A pickup closes the basket at what the
 *     basket held; a shake (lift.mjs) takes back what fell out.
 *   · The cultivar comes from Hourly entry (line 1). A change mid-basket waits:
 *     the basket on the scale finishes on the old cultivar, the next one takes the new.
 *   · The trimmer taps their name; it holds for the day only.
 */
export const G_PER_LB = 453.59237;
// The basket holds 1 lb (Koa 2026-11-25: "whatever is sooner 1 lb or 1 hour"):
// a batch ends at 1 lb NET or at the hour mark, whichever comes first.
export const BASKET_G = 453.6;
export const CREDIT_MIN_G = 0.1;      // smaller moves are scale noise: left for the next reading
export const MAX_TICK_GAP_MS = 120 * 1000;   // a longer gap is a tablet that slept: no minutes for it

// The line's hours, Pacific minutes since midnight. Keys are crew_hours' (Hourly
// entry's ten rows, same order). 12-1 is 12:30-1:00: lunch is 12:00-12:30.
export const LINE_SLOTS = [
  { key: '7-8', start: 420, end: 480 }, { key: '8-9', start: 480, end: 540 }, { key: '9-10', start: 540, end: 600 },
  { key: '10-11', start: 600, end: 660 }, { key: '11-12', start: 660, end: 720 }, { key: '12-1', start: 750, end: 780 },
  { key: '1-2', start: 780, end: 840 }, { key: '2-3', start: 840, end: 900 }, { key: '3-4', start: 900, end: 960 },
  { key: '4-4:30', start: 960, end: 990 },
];
const slotIndex = (key) => LINE_SLOTS.findIndex((s) => s.key === key);
// Working minutes in each hour (the 9:00 and 2:30 breaks come out), the same as crew_hours' SLOTS.
export const SLOT_WORK_MIN = { '7-8': 60, '8-9': 60, '9-10': 50, '10-11': 60, '11-12': 60, '12-1': 30, '1-2': 60, '2-3': 50, '3-4': 60, '4-4:30': 30 };

/**
 * One trimmer's goal for an hour, in grams (Koa 2026-11-24: the seat's circle
 * fills toward it). rate = the line's lb per trimmer-hour for the cultivar on the
 * line (getProduction targetRate, the same number Hourly entry's hour target
 * uses), times the hour's working minutes. null without a rate.
 */
export function hourGoalG(rate, key) {
  const r = Number(rate);
  const min = SLOT_WORK_MIN[key];
  return r > 0 && min ? r * G_PER_LB * (min / 60) : null;
}

/**
 * The hour a moment's tops belong to. Before 7:00: 7-8. Lunch (a gap): the next
 * hour, the same rule as the Worker's cell hourly tops (cell-auto.js slotFor).
 * After 4:30: 4-4:30.
 */
export function slotAt(minutes) {
  for (const s of LINE_SLOTS) if (minutes >= s.start && minutes < s.end) return s.key;
  const next = LINE_SLOTS.find((s) => s.start >= minutes);
  return next ? next.key : LINE_SLOTS[LINE_SLOTS.length - 1].key;
}

/** The hour a batch belongs to has ended (its slot's end; lunch ends 11-12 at 12:00). */
export function batchOver(minutes, key) {
  const s = LINE_SLOTS[slotIndex(key)];
  return !!s && minutes >= s.end;
}

/** How far through its hour a batch is, 0..1, for the ring. */
export function hourFraction(minutes, key) {
  const s = LINE_SLOTS[slotIndex(key)];
  if (!s) return 0;
  return Math.min(1, Math.max(0, (minutes - s.start) / (s.end - s.start)));
}

/** When an hour ends, Pacific minutes. */
export function slotEnd(key) {
  const s = LINE_SLOTS[slotIndex(key)];
  return s ? s.end : null;
}

/** A minute that counts toward time seated: inside an hour of the line, and not a break. */
export function workingMinute(minutes, breakAt = () => null) {
  return LINE_SLOTS.some((s) => minutes >= s.start && minutes < s.end) && !breakAt(minutes);
}

const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/**
 * The line's cultivar now, from Hourly entry's rows for today (lineState hours:
 * [{ slot, cultivar, changeAt, changeCultivar }]). The current hour's, after its
 * change time if it has one; an hour not typed yet keeps the last typed hour's
 * cultivar (after its change). '' when nothing is typed today.
 */
export function lineCultivarAt(hours, minutes) {
  const now = slotIndex(slotAt(minutes));
  const h = (hours || []).filter((x) => x && x.cultivar && slotIndex(x.slot) >= 0 && slotIndex(x.slot) <= now)
    .sort((a, b) => slotIndex(b.slot) - slotIndex(a.slot))[0];
  if (!h) return '';
  if (!h.changeCultivar) return h.cultivar;
  if (slotIndex(h.slot) < now) return h.changeCultivar;
  const at = hhmm(h.changeAt);
  return at === null || minutes >= at ? h.changeCultivar : h.cultivar;
}

const busy = (state) => state.phase === 'running' || state.phase === 'finished';

/**
 * Hourly entry's cultivar reached the screen. A basket with tops in it keeps the
 * cultivar it started on and the new one waits (state.nextCultivar, "New
 * cultivar next basket"); an empty or blank basket takes it now.
 * Returns true when anything changed.
 */
export function applyLineCultivar(state, lineCv) {
  const cv = String(lineCv || '');
  const before = `${state.cultivar}|${state.nextCultivar}`;
  if (!busy(state) || !state.cultivar) { state.cultivar = cv; state.nextCultivar = ''; }
  else state.nextCultivar = cv && cv !== state.cultivar ? cv : '';
  return before !== `${state.cultivar}|${state.nextCultivar}`;
}

/** The basket closed (a pickup): the next basket starts on the line's cultivar. */
export function nextBasketCultivar(state, lineCv) {
  state.cultivar = String(lineCv || state.nextCultivar || state.cultivar || '');
  state.nextCultivar = '';
}

/** The name holds for the day: tapped yesterday, the seat asks again. */
export function personToday(state, day) {
  if (state.person && state.person.day !== day) state.person = null;
  return state.person || null;
}

/**
 * The basket's net moved: what to credit to the current hour. Returns 0 for
 * scale noise under CREDIT_MIN_G (it stays owed, so nothing is ever lost).
 */
export function creditBasket(state, netG) {
  const d = netG - (state.basketG || 0);
  if (Math.abs(d) < CREDIT_MIN_G) return 0;
  state.basketG = netG;
  return d;
}

/** A pickup: the rest of what the basket held, to the current hour. The next basket starts at 0. */
export function closeBasket(state, pickupG) {
  const d = (Number(pickupG) || 0) - (state.basketG || 0);
  state.basketG = 0;
  return d;
}

/**
 * Minutes seated for one screen tick. None for a gap longer than
 * MAX_TICK_GAP_MS (the tablet slept or the page was closed), before 7:00, at
 * lunch or a break, or after 4:30.
 */
export function tickMinutes(prevMs, nowMs, minutesAt, breakAt) {
  const gap = nowMs - prevMs;
  if (!(gap > 0) || gap > MAX_TICK_GAP_MS) return 0;
  return workingMinute(minutesAt(nowMs), breakAt) ? gap / 60000 : 0;
}

const key = (slot, personId, cultivar) => `${slot}|${Number(personId) || 0}|${cultivar || ''}`;
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * This seat's hours for one Pacific day: grams and minutes per hour, person and
 * cultivar, and pickups per person. data is plain JSON (kept in the tablet's
 * storage); a new day starts empty.
 */
export function createTally(saved, day) {
  const t = saved && saved.day === day && saved.b ? saved : { day, b: {}, dirty: [], picks: {} };
  if (!t.picks) t.picks = {};
  if (!Array.isArray(t.dirty)) t.dirty = [];
  const touch = (k) => { if (!t.dirty.includes(k)) t.dirty.push(k); };
  const bucket = (slot, personId, cultivar) => {
    const k = key(slot, personId, cultivar);
    if (!t.b[k]) t.b[k] = { g: 0, min: 0 };
    return [k, t.b[k]];
  };
  const each = (fn) => Object.entries(t.b).forEach(([k, v]) => { const [slot, p, ...cv] = k.split('|'); fn({ slot, personId: Number(p), cultivar: cv.join('|') }, v); });
  const sum = (pred, field) => { let s = 0; each((k, v) => { if (pred(k)) s += v[field]; }); return s; };
  return {
    data: t,
    get empty() { return !Object.keys(t.b).length; },
    credit(slot, personId, cultivar, g) {
      if (!g) return;
      const [k, b] = bucket(slot, personId, cultivar);
      b.g += g;
      touch(k);
    },
    addMin(slot, personId, cultivar, min) {
      if (!(min > 0) || !(Number(personId) > 0)) return;
      const [k, b] = bucket(slot, personId, cultivar);
      b.min += min;
      touch(k);
    },
    pickup(personId) { const p = String(Number(personId) || 0); t.picks[p] = (t.picks[p] || 0) + 1; },
    picks(personId) { return t.picks[String(Number(personId) || 0)] || 0; },
    hourG(slot, personId) { return Math.max(0, sum((k) => k.slot === slot && k.personId === (Number(personId) || 0), 'g')); },
    dayG(personId) { return Math.max(0, sum((k) => k.personId === (Number(personId) || 0), 'g')); },
    dayMin(personId) { return sum((k) => k.personId === (Number(personId) || 0), 'min'); },
    /** The rows to send (absolute totals) and clears them; markDirty puts them back if the send fails. */
    takeDirty() {
      const rows = t.dirty.filter((k) => t.b[k]).map((k) => {
        const [slot, p, ...cv] = k.split('|');
        return { slot, personId: Number(p), cultivar: cv.join('|'), g: r1(Math.max(0, t.b[k].g)), min: r1(t.b[k].min) };
      });
      const keys = t.dirty;
      t.dirty = [];
      return { rows, keys };
    },
    markDirty(keys) { for (const k of keys || []) touch(k); },
    /** The Worker's totals for this seat (a tablet that lost its storage): taken as they are, nothing to send. */
    seed(rows) {
      for (const r of rows || []) {
        const [, b] = bucket(r.slot, r.personId, r.cultivar);
        b.g = Number(r.g) || 0;
        b.min = Number(r.min) || 0;
      }
    },
  };
}

/** lb per hour seated, or null before 5 minutes. */
export function paceLbHr(g, min) {
  return min >= 5 ? (g / G_PER_LB) / (min / 60) : null;
}
