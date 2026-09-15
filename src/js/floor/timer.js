/**
 * The bag timer tile — the countdown, the log button, and the scale readout
 * that sits under it.
 *
 * Everything here is driven by two inputs pushed in from main.js on its own
 * schedule: `setScoreboard` (piggybacks on the 5s version poll) and
 * `setScale` (the 1s scale poll). `tick()` runs on its own 1s interval and
 * only recomputes the countdown from whatever scoreboard.timer was last
 * pushed in — it never talks to the network itself, so a laggy scale or a
 * slow production fetch can never make the second hand stutter.
 *
 * The weight window (BAG_GATE_*) is advisory only, same as the scoreboard's
 * scale.js and legacy's applyBagGate: on 2026-08-14 the scale's serial link
 * died while the reader kept posting 0 g, and a hard gate on the window would
 * have stopped every bag from being logged for the rest of the shift. logBag
 * sends only the bag SIZE, never the scale reading, so pressing early cannot
 * write a wrong weight anywhere — the window only earns a tooltip.
 *
 * `els` (built by main.js) is id-keyed — each key is the DOM id itself:
 * timerTile, timerValue, timerUnit, timerStats, logBag, logBagText,
 * bagModeSeg, scaleValue, scaleBar.
 *
 * This module wires its own click listener on `#logBag` and `#bagModeSeg` —
 * main.js should not attach a second one to either.
 */
import { timerReading } from './clock.js';
import { mmss, esc, clockTime } from './format.js';

// kind (from clock.js's timerReading) -> the label key shown next to the
// countdown. Position-for-position with the six kinds timerReading returns.
const UNIT_LABEL = {
  remaining: 'left',
  overtime: 'overtime',
  elapsed: 'elapsedWord',
  break: 'onBreak',
  ended: 'shiftEnded',
  waiting: 'notStarted',
};

// Gross-weight windows in grams (product + Grove Bag tare), ported from
// index.js:4028-4038 verbatim.
const GATE_5KG = { min: 5196, max: 5317 };
const GATE_10LB = { min: 4642, max: 4763 };

/** `{g}`/`{min}`/`{max}` substitution for the scaleWindow label — the only
 * label in this file that carries placeholders. */
function fillTemplate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

export function initTimer({ els, api, t, getShiftStart, onLogged }) {
  const controller = new AbortController();
  const { signal } = controller;

  let timer = {}; // last scoreboard.timer payload from setScoreboard
  let lastScale = null; // last scaleWeight payload from setScale, or null
  let bagMode = '5kg'; // synced from the scale poll's bagMode, and optimistically on click
  let logFlashTimer = null; // the "Logging.../Logged/Failed" flash's reset timeout

  function setScoreboard(sb) {
    timer = (sb && sb.timer) || {};
    renderStats();
  }

  function renderStats() {
    const bags = bagMode === '10lb'
      ? (timer.bags10lbToday || 0)
      : (timer.bags5kgToday != null ? timer.bags5kgToday : (timer.bagsToday || 0));
    const avg = Number(timer.avgSecondsToday) || 0;
    const target = Number(timer.targetSeconds) || 0;
    const avgText = avg > 0 ? mmss(avg) : '—';
    const targetText = target > 0 ? mmss(target) : '—';
    els.timerStats.innerHTML = `<span class="num">${bags}</span> ${esc(t('bagsTodayWord'))} · `
      + `${esc(t('averaging'))} <span class="num">${avgText}</span>, `
      + `${esc(t('targetWord'))} <span class="num">${targetText}</span>`;
  }

  function tick() {
    const lastBagTime = timer.lastBagTime ? new Date(timer.lastBagTime) : null;
    // Not the legacy 90-min fallback: the scoreboard endpoint always sends
    // targetSeconds now, so a missing value means "no target" (kind 'elapsed'),
    // not "assume 90 minutes".
    const targetSeconds = Number(timer.targetSeconds) || 0;
    const now = new Date();
    const reading = timerReading({
      lastBagTime, targetSeconds, shiftStart: getShiftStart(), now,
    });

    els.timerTile.dataset.kind = reading.kind;

    // Off shift there is no countdown to show. What the tile can honestly
    // say is when the last bag went — if one went today — and that the day
    // is over (or has not begun). A frozen "22:48" beside "shift ended" read
    // as a live clock that had stopped.
    if (reading.kind === 'ended' || reading.kind === 'waiting') {
      const state = t(UNIT_LABEL[reading.kind]);
      const today = lastBagTime && lastBagTime.toDateString() === now.toDateString();
      els.timerValue.textContent = today ? clockTime(lastBagTime) : '—';
      els.timerUnit.textContent = today ? `${t('lastBag')} · ${state}` : state;
      return;
    }

    els.timerValue.textContent = reading.kind === 'overtime'
      ? `+${mmss(reading.seconds)}`
      : mmss(reading.seconds);
    els.timerUnit.textContent = t(UNIT_LABEL[reading.kind] || 'notStarted');
  }

  function syncBagModeButtons() {
    els.bagModeSeg.querySelectorAll('button[data-mode]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === bagMode));
    });
  }

  function renderScale() {
    const stale = !lastScale || lastScale.isStale !== false;
    // An offline scale has no reading, so it has no bar either: the word
    // stands alone in caption ink rather than beside an empty track.
    els.scaleBar.hidden = stale;
    els.scaleValue.classList.toggle('off', stale);
    if (stale) {
      els.scaleValue.textContent = t('scaleOffline');
      els.scaleBar.firstElementChild.style.width = '0%';
      // Scale offline never blocks logging — flag it, do not disable anything.
      els.logBag.title = t('scaleOfflineNote');
      return;
    }

    const grams = Math.round((lastScale.weight || 0) * 1000);
    els.scaleValue.textContent = `${grams.toLocaleString('en-US')} g`;
    els.scaleBar.firstElementChild.style.width = `${lastScale.percentComplete || 0}%`;

    const gate = bagMode === '10lb' ? GATE_10LB : GATE_5KG;
    els.logBag.title = (grams < gate.min || grams > gate.max)
      ? fillTemplate(t('scaleWindow'), { g: grams, min: gate.min, max: gate.max })
      : '';
  }

  function setScale(scaleData) {
    lastScale = scaleData || null;
    if (lastScale && lastScale.bagMode && lastScale.bagMode !== bagMode) {
      bagMode = lastScale.bagMode;
      syncBagModeButtons();
      renderStats(); // the bags-today figure is keyed off the active mode
    }
    renderScale();
  }

  function onBagModeClick(e) {
    const btn = e.target.closest('button[data-mode]');
    if (!btn || btn.dataset.mode === bagMode) return;
    bagMode = btn.dataset.mode;
    syncBagModeButtons();
    renderStats();
    renderScale(); // the advisory window is keyed off the active mode
    // Optimistic: the next scale poll reaffirms (or reverts) this from the
    // server, same as legacy's pill toggle.
    api.setBagMode(bagMode).catch((err) => console.error('setBagMode failed:', err));
  }

  async function onLogBagClick() {
    if (els.logBag.disabled) return;
    els.logBag.disabled = true;
    els.logBagText.textContent = t('logging');
    try {
      await api.logBag(bagMode === '10lb' ? '10lb' : '5 kg.');
      els.logBagText.textContent = t('logged');
      onLogged?.();
      clearTimeout(logFlashTimer);
      logFlashTimer = setTimeout(() => {
        els.logBagText.textContent = t('logBag');
        els.logBag.disabled = false;
      }, 2000);
    } catch (err) {
      console.error('logBag failed:', err);
      els.logBagText.textContent = t('logFailed');
      // A failed log must always leave the button pressable again — no path
      // through this handler leaves it stuck disabled.
      clearTimeout(logFlashTimer);
      logFlashTimer = setTimeout(() => {
        els.logBagText.textContent = t('logBag');
        els.logBag.disabled = false;
      }, 3000);
    }
  }

  function refreshLabels() {
    tick();
    renderStats();
    renderScale();
    // Don't stomp a "Logging.../Logged/Failed" flash mid-animation — only
    // reset the idle label when the button isn't mid-cycle.
    if (!els.logBag.disabled) els.logBagText.textContent = t('logBag');
  }

  els.bagModeSeg.addEventListener('click', onBagModeClick, { signal });
  els.logBag.addEventListener('click', onLogBagClick, { signal });

  syncBagModeButtons();
  renderScale();
  renderStats();

  function destroy() {
    controller.abort();
    clearTimeout(logFlashTimer);
  }

  return { setScoreboard, setScale, tick, refreshLabels, destroy };
}
