/**
 * Floor Manager — boot, state, and the wiring between the modules.
 *
 * Nothing in this file computes anything. The slot arithmetic is slots.js, the
 * form arithmetic entry.js, the note grammar reasons.js, the wording labels.js,
 * and every network call api.js; the rendering modules own their own markup.
 * What lives here is the state those modules all need to agree on — which date
 * is open, which hour is selected, what the server last said — and the events
 * that change it.
 *
 * One `els` object, built once from every id in floor.html, is handed to every
 * module. The page's ids ARE the contract between them (editor.js, strip.js,
 * timer.js, queue.js and drawer.js all document which keys they read), so
 * building it by query instead of by hand means a renamed id fails loudly in
 * one place rather than silently in five.
 *
 * The polling diet is deliberate. The legacy page ran six independent timers
 * and refetched the whole day on each; here one 5s version poll decides whether
 * anything changed at all, and only then reloads production, scoreboard and
 * shift start. The scale and the bag countdown are the only other clocks, and
 * every one of them stops while the tab is hidden.
 */
import { mountShell, setStatus } from '../../shell/shell.js';
import { t, getLang } from './labels.js';
import * as api from './api.js';
import {
  buildSlots,
  normalizeFirstSlotKey,
  isSlotVisible,
  getSlotMultiplier,
  getCurrentSlot,
  rowHasRecordedData,
  formatDateLocal,
} from './slots.js';
import {
  effectiveTrimmers,
  hourTarget,
  dayTotals,
  paceSummary,
  isDirty,
} from './entry.js';
import { createSaver } from './save.js';
import { initEditor } from './editor.js';
import { renderStrip } from './strip.js';
import { renderPace } from './pace.js';
import { initTimer } from './timer.js';
import { renderQueueTile } from './queue.js';
import { initDrawer } from './drawer.js';
import { dateHeading, clockTime } from './format.js';

/** One 5s poll drives every cross-computer refresh; the other two are clocks. */
const VERSION_MS = 5000;
const SCALE_MS = 1000;
const TICK_MS = 1000;

/** `?date=` is only honoured in this exact shape — anything else is today. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The rail and topbar are built first: mountShell moves this page's date,
// shift and drawer controls into the shared topbar and adds the shell's own
// ids (statusDot, themeBtn, langBtn, the rail), so `els` below has to be built
// after it or it would miss them.
mountShell({
  start: [document.getElementById('topbarStart')],
  end: [document.getElementById('topbarEnd')],
  lang: true,
});

/** Every id on the page, keyed by that id. See the header. */
const els = {};
for (const el of document.querySelectorAll('[id]')) els[el.id] = el;

const state = {
  date: '',
  isToday: true,
  shiftStartTime: null,
  slots: [],
  startMinutes: {},
  endMinutes: {},
  dayData: {},
  targetRate: 0.9,
  sb: null,
  projected: 0,
  brief: null,
  selectedIndex: 0,
};

// `editor` is assigned below but referenced from the saver's callbacks, which
// only ever run after a schedule — and only the editor schedules.
let editor = null;

// ------------------------------------------------------------------ reading

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const currentSlot = () => (state.isToday
  ? getCurrentSlot(state.slots, {
    startMinutes: state.startMinutes,
    endMinutes: state.endMinutes,
  })
  : null);

/**
 * Should this hour appear? Only today hides hours: a past day is a record, and
 * hiding part of it because the shift started late would just make the day look
 * shorter than it was.
 */
const isVisible = (slot) => !state.isToday || isSlotVisible(slot, {
  startMinutes: state.startMinutes,
  shiftStartTime: state.shiftStartTime,
  row: state.dayData[slot] || null,
});

/**
 * Effective trimmers for one hour.
 *
 * The selected hour is the one being typed into, so it passes the live form and
 * `isOpen: true` — which is what stops entry.js honouring the
 * `effectiveTrimmers1` our own last autosave wrote back into the row. The crew
 * log stays with the editor (it is the only thing that can observe a mid-hour
 * change), so the log passed here is empty and the open hour falls through to
 * the raw typed counts; the editor's own target line uses its log.
 */
function slotEffective(slot) {
  const selected = state.slots[state.selectedIndex];
  const isSelected = slot === selected;
  return effectiveTrimmers({
    row: state.dayData[slot] || null,
    form: isSelected && editor ? editor.form() : null,
    log: [],
    slotStart: state.startMinutes[slot],
    slotEnd: state.endMinutes[slot],
    nowMinutes: nowMinutes(),
    isOpen: isSelected,
  });
}

function targetFor(slot) {
  const eff = slotEffective(slot);
  return hourTarget({
    trimmers: (eff.effectiveTrimmers1 || 0) + (eff.effectiveTrimmers2 || 0),
    targetRate: state.targetRate,
    multiplier: getSlotMultiplier(slot, {
      startMinutes: state.startMinutes,
      endMinutes: state.endMinutes,
      shiftStartTime: state.shiftStartTime,
      row: state.dayData[slot] || null,
      isToday: state.isToday,
    }),
  });
}

/**
 * The day's goal for the pace meter. The scoreboard's `todayTarget` is what the
 * TV on the wall shows, so it wins whenever it exists; summing the hours is the
 * fallback for a day the scoreboard has no figure for (a past date, or a day
 * with no crew logged yet).
 */
function dayGoal() {
  const fromScoreboard = Number(state.sb?.scoreboard?.todayTarget) || 0;
  if (fromScoreboard > 0) return fromScoreboard;
  return state.slots.reduce((sum, slot) => (isVisible(slot) ? sum + (targetFor(slot) || 0) : sum), 0);
}

/** Tops the manager has typed into the open hour but not yet saved. */
function liveTops() {
  if (!editor) return 0;
  const form = editor.form();
  return (parseFloat(form.tops1) || 0) + (parseFloat(form.tops2) || 0);
}

function getContext() {
  return {
    date: state.date,
    slots: state.slots,
    startMinutes: state.startMinutes,
    endMinutes: state.endMinutes,
    slotIndex: state.selectedIndex,
    dayData: state.dayData,
    isToday: state.isToday,
    currentSlot: currentSlot(),
    nowMinutes: nowMinutes(),
  };
}

// -------------------------------------------------------------------- saving

const saver = createSaver({
  send: async (payload) => {
    const res = await api.addProduction(payload);
    // shared/api.js only throws on a non-2xx; an explicit `success:false` body
    // is still a refusal, and the save line has to be able to say so.
    if (!res || res.success === false) throw new Error(res?.message || t('saveFailed'));
    // The sent object IS the row now — the worker replaces (date, timeSlot)
    // whole — so mirroring it locally keeps the ribbon and the pace tile in
    // step without a refetch. Written here rather than in onState because the
    // payload is only in scope on this side of the transport.
    if (payload.date === state.date) state.dayData[payload.timeSlot] = payload;
    return res;
  },
  onState: (s) => {
    if (editor) editor.setSaveState({ ...s, pendingCount: saver.pendingKeys().length });
    renderStripView();
    if (s.state === 'saved') renderPaceView();
  },
});

// ----------------------------------------------------------------- rendering

function renderHeader() {
  const heading = dateHeading(state.date, getLang());
  els.dateWeekday.textContent = heading.weekday;
  els.dateText.textContent = heading.date;
  els.datePicker.value = state.date;
  renderShiftButton();
}

function renderShiftButton() {
  const started = Boolean(state.shiftStartTime);
  els.shiftLabel.textContent = started ? t('started') : t('startDay');
  els.shiftTime.textContent = started ? clockTime(state.shiftStartTime) : '';
  // Only today's shift start can be written (the worker rejects any other
  // date), so on a past day the control is a dead end rather than a trap.
  els.shiftBtn.disabled = !state.isToday;
}

function renderStripView() {
  renderStrip(els.ribbon, {
    slots: state.slots,
    dayData: state.dayData,
    selectedIndex: state.selectedIndex,
    currentSlot: currentSlot(),
    targetFor,
    isVisible,
    pendingKeys: saver.pendingKeys(),
    dateKey: state.date,
    t,
    onSelect: (index) => { goToSlot(index); },
  });
}

function renderPaceView() {
  const selected = state.slots[state.selectedIndex];
  const live = liveTops();
  // The open hour's pounds live in the form, not in dayData, until the save
  // lands — so they are excluded from the totals and added back by hand.
  const totals = dayTotals({ slots: state.slots, dayData: state.dayData, excludeSlot: selected });
  const summary = paceSummary({
    slots: state.slots,
    dayData: state.dayData,
    targetFor,
    liveSlot: selected,
    liveTops: live,
    isVisible,
  });

  renderPace(els, {
    actual: totals.tops + live,
    goal: dayGoal(),
    cumulativeTarget: summary.target,
    projected: state.projected,
    t,
  });
}

function renderAll() {
  renderHeader();
  renderStripView();
  renderPaceView();
  renderQueueTile(els, state.brief, t);
  if (editor) editor.setTarget();
}

// ------------------------------------------------------------------- loading

/** The shift start as a Date, but only when it belongs to the day on screen. */
function shiftDateFrom(response) {
  const iso = response?.shiftAdjustment?.manualStartTime;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateLocal(date) === state.date ? date : null;
}

function rebuildSlots() {
  const built = buildSlots(state.isToday ? state.shiftStartTime : null);
  state.slots = built.slots;
  state.startMinutes = built.startMinutes;
  state.endMinutes = built.endMinutes;
}

function applyProduction(prod) {
  const dayData = {};
  for (const row of (prod?.production || [])) {
    if (row && row.timeSlot) dayData[row.timeSlot] = row;
  }
  // A row saved before Start Day was pressed comes back under the canonical
  // first-hour label; fold it onto whichever label the day is using now.
  normalizeFirstSlotKey(dayData, state.slots[0]);
  state.dayData = dayData;
  // 0.9 lb per trimmer per hour is the historical default the floor ran on
  // before targetRate became a server value (index.js:357).
  state.targetRate = Number(prod?.targetRate) || 0.9;
}

function applyScoreboard(sb) {
  state.sb = sb || null;
  state.projected = Number(sb?.scoreboard?.projectedTotal) || 0;
  timer.setScoreboard(sb || {});
}

/**
 * Which hour to open on. Today wants the hour the clock is in; before the shift
 * starts that is the first hour, and after it ends the last hour that has
 * anything on it — the one a manager arriving late is coming to finish.
 */
function initialSlotIndex() {
  const visible = [];
  state.slots.forEach((slot, index) => { if (isVisible(slot)) visible.push(index); });
  if (!visible.length) return 0;

  let lastWithData = -1;
  for (const index of visible) {
    if (rowHasRecordedData(state.dayData[state.slots[index]])) lastWithData = index;
  }

  if (!state.isToday) return lastWithData >= 0 ? lastWithData : 0;

  const current = currentSlot();
  if (current && isVisible(current)) {
    const index = state.slots.indexOf(current);
    if (index >= 0) return index;
  }

  const first = visible[0];
  if (nowMinutes() < (state.startMinutes[state.slots[first]] ?? 0)) return first;

  return lastWithData >= 0 ? lastWithData : visible[visible.length - 1];
}

/** A full load: the day changed, or the shift start did. Resets the selection. */
async function loadDay() {
  state.isToday = state.date === formatDateLocal();

  let shift = null;
  if (state.isToday) {
    try { shift = await api.getShiftStart(state.date); } catch { shift = null; }
  }
  state.shiftStartTime = shiftDateFrom(shift);
  rebuildSlots();

  const r = await api.settle({
    prod: api.getProduction(state.date),
    sb: api.getScoreboard(state.date),
    cultivars: api.getCultivars(),
    brief: api.getQueueBrief(),
  });

  applyProduction(r.prod);
  applyScoreboard(r.sb);
  state.brief = r.brief;

  editor.setCultivars(r.cultivars || [], r.brief?.queueAliases || []);
  drawer.setBrief(r.brief);

  state.selectedIndex = initialSlotIndex();
  editor.load(state.selectedIndex);
  renderAll();
}

/**
 * A poll found new data. Refresh in place: the selection stays put, and the
 * form is only reloaded when the manager has nothing in flight there — a poll
 * must never take back a number being typed.
 */
async function refreshDay() {
  let shift = null;
  if (state.isToday) {
    try { shift = await api.getShiftStart(state.date); } catch { shift = null; }
  }
  const nextShift = shiftDateFrom(shift);
  if (String(nextShift) !== String(state.shiftStartTime)) {
    state.shiftStartTime = nextShift;
    rebuildSlots();
  }

  const r = await api.settle({
    prod: api.getProduction(state.date),
    sb: api.getScoreboard(state.date),
    brief: api.getQueueBrief(),
  });

  if (r.prod) applyProduction(r.prod);
  if (r.sb) applyScoreboard(r.sb);
  if (r.brief) {
    state.brief = r.brief;
    drawer.setBrief(r.brief);
  }

  reloadEditorIfClean();
  renderAll();
}

function reloadEditorIfClean() {
  const slot = state.slots[state.selectedIndex];
  if (!slot || !editor) return;
  if (saver.isPending(`${state.date}|${slot}`)) return;
  if (isDirty(editor.form(), editor.snapshot())) return;
  editor.load(state.selectedIndex);
}

async function refreshScoreboard() {
  try {
    applyScoreboard(await api.getScoreboard(state.date));
    renderPaceView();
  } catch (err) {
    console.error('Could not refresh the scoreboard:', err);
  }
}

// ---------------------------------------------------------------- navigation

/**
 * Open another hour. The flush first is what makes the ribbon honest: the hour
 * being left is on the server (or pending and badged) before its tick is
 * repainted from dayData.
 */
async function goToSlot(index, { focus = false } = {}) {
  if (index < 0 || index >= state.slots.length) return;
  await saver.flush();
  state.selectedIndex = index;
  editor.load(index);
  renderStripView();
  renderPaceView();
  if (focus) editor.focusFirst();
}

function nextVisibleIndex(from, step) {
  for (let i = from + step; i >= 0 && i < state.slots.length; i += step) {
    if (isVisible(state.slots[i])) return i;
  }
  return -1;
}

async function moveSlot(delta, opts) {
  const index = nextVisibleIndex(state.selectedIndex, delta > 0 ? 1 : -1);
  if (index < 0) return;
  await goToSlot(index, opts);
}

// -------------------------------------------------------------------- wiring

editor = initEditor({
  els,
  t,
  saver,
  onNavigate: (delta) => { moveSlot(delta, { focus: true }); },
  targetFor,
  getContext,
});

const timer = initTimer({
  els,
  api,
  t,
  getShiftStart: () => state.shiftStartTime,
  onLogged: refreshScoreboard,
});

const drawer = initDrawer({ els, api, t });

els.prevHour.addEventListener('click', () => moveSlot(-1));
els.nextHour.addEventListener('click', () => moveSlot(1));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const delta = e.key === 'ArrowRight' ? 1 : -1;

  if (e.altKey) { e.preventDefault(); moveSlot(delta); return; }
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;

  // Arrows belong to whatever is being typed into first; the ribbon only gets
  // them when nothing is.
  const active = document.activeElement;
  const tag = active ? active.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // The drawer is a separate surface with its own fields; moving the hour
  // underneath it while it is open would be invisible to the manager.
  if (els.drawer.classList.contains('open')) return;

  e.preventDefault();
  moveSlot(delta);
});

// ---- header: date -------------------------------------------------------

els.dateBtn.addEventListener('click', () => {
  // showPicker() is the only way to open the native calendar from a styled
  // button; it throws where it is unsupported or not user-activated, and the
  // bare click on the input is the fallback.
  try {
    if (typeof els.datePicker.showPicker === 'function') els.datePicker.showPicker();
    else els.datePicker.click();
  } catch {
    els.datePicker.click();
  }
});

els.datePicker.addEventListener('change', () => {
  const value = els.datePicker.value;
  if (!DATE_RE.test(value)) return;
  state.date = value;
  history.replaceState(null, '', `?date=${value}`);
  loadDay();
});

// ---- header: shift start -------------------------------------------------

function hideShiftPop() {
  els.shiftPop.hidden = true;
}

function showShiftPop() {
  if (state.shiftStartTime) {
    const h = String(state.shiftStartTime.getHours()).padStart(2, '0');
    const m = String(state.shiftStartTime.getMinutes()).padStart(2, '0');
    els.shiftTimeInput.value = `${h}:${m}`;
  }
  els.shiftPop.hidden = false;
  els.shiftTimeInput.focus();
}

/**
 * Write the shift start, then reload the day around it. The server's answer is
 * adopted rather than the value sent: the scoreboard can set the same field,
 * and two screens disagreeing about when the day began is worse than either
 * value being a minute off.
 */
async function startShift(timeIso) {
  hideShiftPop();
  try {
    const response = await api.setShiftStart(timeIso);
    const adopted = shiftDateFrom(response);
    if (adopted) state.shiftStartTime = adopted;
  } catch (err) {
    console.error('Could not set the shift start:', err);
  }
  await loadDay();
}

els.shiftBtn.addEventListener('click', () => {
  if (!state.isToday) return;
  // No start time yet means the button is "Start Day", and the day starts now.
  if (!state.shiftStartTime) { startShift(null); return; }
  if (els.shiftPop.hidden) showShiftPop(); else hideShiftPop();
});

els.shiftTimeSet.addEventListener('click', () => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(els.shiftTimeInput.value || '');
  if (!match) return;
  const when = new Date();
  when.setHours(Number(match[1]), Number(match[2]), 0, 0);
  startShift(when.toISOString());
});

els.shiftTimeInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  els.shiftTimeSet.click();
});

document.addEventListener('click', (e) => {
  if (els.shiftPop.hidden) return;
  if (els.shiftPop.contains(e.target) || els.shiftBtn.contains(e.target)) return;
  hideShiftPop();
});

// ---- language -------------------------------------------------------------

// The shell owns the EN/ES button and the theme button; both announce
// themselves on the document. setLang walks every [data-i18n*] attribute
// itself, so what this listener redraws is only the text the page builds in
// JS, which those attributes cannot reach.
document.addEventListener('ro:langchange', () => {
  if (!editor) return;
  editor.refreshLabels();
  timer.refreshLabels();
  drawer.refreshLabels();
  renderAll();
});

// -------------------------------------------------------------------- clocks

let lastVersion = null;
let versionBusy = false;

/**
 * The only refresh trigger. `version` is one integer; asking for it every five
 * seconds costs nothing, and nothing else is refetched until it moves.
 */
async function pollVersion() {
  if (document.visibilityState !== 'visible' || versionBusy) return;
  versionBusy = true;
  try {
    const response = await api.getVersion();
    setStatus('live', t('statusLive'));
    const stamp = response?.version ?? response?.updatedAt ?? null;
    if (stamp === null) return;
    if (lastVersion !== null && stamp === lastVersion) return;
    lastVersion = stamp;
    if (state.isToday) await refreshDay();
  } catch {
    // A dropped poll is not news - the next one is five seconds away - but the
    // pill has to say so, because a floor that cannot reach the API is typing
    // into a page that will not keep it.
    setStatus('off', t('statusOffline'));
  } finally {
    versionBusy = false;
  }
}

async function pollScale() {
  if (document.visibilityState !== 'visible') return;
  try {
    timer.setScale(await api.getScaleWeight());
  } catch {
    // The scale reader drops off the network routinely and the tile already
    // says "offline"; logging it once a second would bury real errors.
    timer.setScale(null);
  }
}

setInterval(pollVersion, VERSION_MS);
setInterval(pollScale, SCALE_MS);
setInterval(() => timer.tick(), TICK_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pollVersion();
});

window.addEventListener('beforeunload', () => { saver.flush(); });

// ---------------------------------------------------------------------- boot

function readDateParam() {
  const value = new URLSearchParams(location.search).get('date');
  return value && DATE_RE.test(value) ? value : formatDateLocal();
}

state.date = readDateParam();
setStatus('idle', t('statusLoading'));
loadDay().then(() => pollVersion());
