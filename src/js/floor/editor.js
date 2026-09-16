/**
 * The hour editor — the one form the floor manager actually types into.
 *
 * Everything here is DOM. The arithmetic it needs lives in entry.js, the note
 * grammar in reasons.js, the wording in labels.js; this module's whole job is
 * to move values between fourteen inputs and those pure modules, and to make
 * the keyboard behave. A manager entering ten hours a day touches Enter far
 * more than the mouse, so the Enter walk (save, then the next field with its
 * text selected) is the feature, not a convenience.
 *
 * Three baselines are kept, and they answer three different questions. Mixing
 * them is how the legacy page grew both its zero-row bug and its stale-flag
 * bug (index.js:1607), so each is named for its question:
 *   - `loadedSnapshot` — what the server had when this hour opened. Read-only,
 *     exported as snapshot() for main.
 *   - `dirtyBaseline`  — what the server has now (or is being sent). Gates the
 *     autosave, so an untouched hour never posts a row of zeros.
 *   - `crewBaseline`   — what the last crew-change note measured from.
 *
 * REQUEST TO main.js (H): getContext() should also return the `startMinutes`
 * and `endMinutes` maps buildSlots() produced — main already holds them for
 * targetFor(). Without them a mid-hour crew change cannot be time-weighted for
 * a custom first slot; the canonical fallback below covers the other nine.
 */
import {
  LINE2_FIELDS,
  rowToForm,
  formToPayload,
  hasProduction,
  hasCrew,
  rowHasLine2,
  startCrewLog,
  recordCrewChange,
  effectiveTrimmers,
  crewChanges,
  crewChangeNote,
  isDirty,
  nextField,
} from './entry.js';
import { REASONS, parseNotes, composeNotes } from './reasons.js';
import {
  hourTitle, clockTime, num, lbsText, esc, cultivarParts, cultivarLabel, fieldText,
} from './format.js';
import { buildSlots } from './slots.js';
import { LABELS, getLang } from './labels.js';

/** The inputs that carry a form value, by element id. `note` holds free text only. */
const FORM_INPUT_IDS = [
  'buckers1', 'trimmers1', 'tzero1', 'qcperson', 'cultivar1', 'tops1', 'smalls1',
  'buckers2', 'trimmers2', 'tzero2', 'cultivar2', 'tops2', 'smalls2',
];

/** The pounds fields: shown with one decimal, empty when nothing is recorded (format.js fieldText). */
const WEIGHT_INPUT_IDS = ['tops1', 'smalls1', 'tops2', 'smalls2'];

/** The typeset face laid over each cultivar select, by the select's id. */
const CULTIVAR_FACE = { cultivar1: 'cultivarFace1', cultivar2: 'cultivarFace2' };

/** Crew counts clamp to the same 0..50 window the legacy steppers used (index.js:822). */
const CREW_MIN = 0;
const CREW_MAX = 50;

/**
 * Slot minute maps for the ten canonical labels, used only when getContext()
 * does not carry its own. A custom first slot ("7:30 AM – 8:00 AM") is absent
 * here by construction, and effectiveTrimmers() degrades to the raw count
 * rather than mis-weighting it.
 */
const CANONICAL = buildSlots();

/**
 * Crew-change labels are ALWAYS English, whatever language the page is in.
 * The strings they build land inside `[Crew change …]`, which hub/format.js
 * noteLines() and the weekly digest parse back out — same rule reasons.js
 * states for its `[Reason: …]` line, and for the same reason: those readers
 * only know the English words. `line1` is the empty string on purpose; it is
 * what puts the space before the colon the parser splits on.
 */
const CREW_LABELS = {
  buckers: LABELS.en.buckers,
  trimmers: LABELS.en.trimmers,
  tzero: LABELS.en.tzero,
  qcperson: LABELS.en.qcperson,
  cultivar: LABELS.en.cultivar,
  line1: LABELS.en.line1,
  line2: LABELS.en.line2,
};

/**
 * @param {object} opts
 * @param {Record<string, HTMLElement>} opts.els elements keyed by their DOM id
 * @param {(key: string) => string} opts.t label lookup in the active language
 * @param {{schedule: Function, flush: Function, retry: Function, isPending: Function, pendingKeys: Function}} opts.saver
 * @param {(delta: number) => void} opts.onNavigate move to another hour
 * @param {(slot: string) => number} opts.targetFor pounds this hour should make
 * @param {() => {date, slots, slotIndex, dayData, isToday, currentSlot, nowMinutes, startMinutes?, endMinutes?}} opts.getContext
 */
export function initEditor({ els, t, saver, onNavigate, targetFor, getContext } = {}) {
  const controller = new AbortController();
  const { signal } = controller;

  let slot = null;
  let dateKey = '';
  let saveKey = '';
  let loadedSnapshot = rowToForm(null);
  let dirtyBaseline = rowToForm(null);
  let crewBaseline = rowToForm(null);
  /** Did this hour already have pounds on it when the last note was weighed? */
  let hadProduction = false;
  /** Bracketed system notes carried through untouched, plus any note we add. */
  let brackets = [];
  let crewLog = [];
  let line2 = false;
  let cultivars = [];
  let aliases = [];
  /** Selected reason ids. Held here rather than read off the chips so a language flip can re-render them. */
  const selected = new Set();
  let lastSaveState = null;

  // ---------------------------------------------------------------- reading

  const reasonIds = () => REASONS.filter((r) => selected.has(r.id)).map((r) => r.id);

  const noteText = () => (els.note ? els.note.value : '');

  const composeQcNotes = () => composeNotes({ reasons: reasonIds(), text: noteText(), brackets });

  /** The form as entry.js wants it: raw input strings plus the composed qcNotes. */
  function form() {
    const out = {};
    for (const id of FORM_INPUT_IDS) out[id] = els[id] ? els[id].value : '';
    out.qcNotes = composeQcNotes();
    return out;
  }

  const snapshot = () => loadedSnapshot;

  /** Only today's in-progress hour can have a crew change happen mid-hour. */
  const isLiveSlot = (ctx) => Boolean(ctx && ctx.isToday) && slot === ctx?.currentSlot;

  const slotMinutes = (ctx) => ({
    start: ctx?.startMinutes?.[slot] ?? CANONICAL.startMinutes[slot],
    end: ctx?.endMinutes?.[slot] ?? CANONICAL.endMinutes[slot],
  });

  /**
   * Effective trimmers for the hour being edited.
   *
   * `isOpen: true` always, because the manager is typing into this hour right
   * now: entry.js gates its "a saved effectiveTrimmers1 wins" clause on
   * `isOpen && form`, so passing true is what lets the typed count reach the
   * payload instead of the value a previous autosave wrote back into the row.
   * For a past hour the crew log is a single segment, so this falls through to
   * the raw typed counts, which is what legacy's collectFormData sent.
   */
  function liveEffective(currentForm, ctx) {
    const { start, end } = slotMinutes(ctx);
    return effectiveTrimmers({
      row: ctx?.dayData?.[slot] || null,
      form: currentForm,
      log: crewLog,
      slotStart: start,
      slotEnd: end,
      nowMinutes: ctx?.nowMinutes ?? 0,
      isOpen: true,
    });
  }

  // ---------------------------------------------------------------- payload

  /**
   * The addProduction body, built at SEND time — this is what main hands the
   * saver as getPayload, not a getter. It mutates on purpose:
   *
   *   - a warranted crew-change note is pushed into `brackets`, so the next
   *     save re-emits it instead of dropping it (the row is replaced whole on
   *     the server, and the editor only re-parses qcNotes on load — legacy
   *     wrote the same note back into its textarea, index.js:1571);
   *   - `crewBaseline` and `hadProduction` advance afterwards, so the next note
   *     reads "10 → 8" rather than restating "0 → 8" (index.js:1594-1610);
   *   - `dirtyBaseline` advances to the values going out, which is what stops
   *     the blur that follows an Enter from posting the same row twice.
   *
   * Order matters: build the note against the OLD baselines, then advance.
   */
  function payload() {
    const ctx = getContext ? getContext() : null;

    const before = form();
    const changes = crewChanges(crewBaseline, before, CREW_LABELS);
    if (changes.length && hadProduction) {
      const note = crewChangeNote(changes, clockTime(new Date()));
      // Same minute plus the same diff is the same note; exact-string matching
      // is the whole dedupe, as in legacy (index.js:1569).
      if (!brackets.includes(note)) brackets.push(note);
    }

    const current = form();
    const body = formToPayload(current, {
      date: dateKey,
      slot,
      effective: liveEffective(current, ctx),
    });

    if (changes.length) crewBaseline = { ...current };
    hadProduction = hasProduction(current);
    dirtyBaseline = { ...current };

    return body;
  }

  // --------------------------------------------------------------- autosave

  /** A stepper press or a chip toggle is always an edit; no dirty gate on those. */
  function scheduleSave() {
    if (!slot || !saver) return;
    // Passing the same function reference every time is safe: save.js tracks
    // mid-flight edits with a sequence token, not with getPayload's identity.
    saver.schedule(saveKey, payload);
  }

  /**
   * Schedule only if something actually moved. The legacy page posted on every
   * blur whether or not a value changed, which is how hours nobody touched
   * ended up on the server as rows of zeros.
   */
  function maybeSchedule() {
    if (!slot) return;
    if (!isDirty(form(), dirtyBaseline)) return;
    scheduleSave();
  }

  // ----------------------------------------------------------------- render

  /**
   * "target 19.0 lb · 16 trimmers × 0.9".
   *
   * The rate and the slot multiplier are not passed in — main owns both — but
   * target = trimmers × rate × multiplier, so the per-trimmer figure is just
   * target / trimmers. Deriving it keeps this module off main's internals.
   */
  function setTarget() {
    const el = els.topsTarget;
    if (!el || !slot) return;

    const target = Number(targetFor ? targetFor(slot) : 0) || 0;
    if (target <= 0) {
      el.hidden = true;
      el.textContent = '';
      return;
    }

    const ctx = getContext ? getContext() : null;
    const eff = liveEffective(form(), ctx);
    const trimmers = (eff.effectiveTrimmers1 || 0) + (eff.effectiveTrimmers2 || 0);
    // lbsText, not num: a crew of 16 should read "16 trimmers", not "16.0",
    // while a weighted 11.5 keeps its decimal.
    const perTrimmer = trimmers > 0 ? Math.round((target / trimmers) * 100) / 100 : 0;

    el.hidden = false;
    el.innerHTML = `${esc(t('targetWord'))} <span class="num">${num(target, 1)} ${esc(t('lbs'))}</span>`
      + (trimmers > 0 ? ` · ${esc(lbsText(trimmers))} ${esc(t('trimmersShort'))} × ${perTrimmer}` : '');
  }

  function renderChips() {
    if (!els.chips) return;
    const lang = getLang() === 'es' ? 'es' : 'en';
    els.chips.innerHTML = REASONS.map((r) => (
      `<button class="rchip" type="button" data-reason="${r.id}" aria-pressed="${selected.has(r.id) ? 'true' : 'false'}">`
      + '<svg class="i"><use href="#i-check"/></svg>'
      + `${esc(r[lang])}</button>`
    )).join('');
  }

  /**
   * Keep a stored value the option list does not offer.
   *
   * getCultivars only returns the current crop year, so an hour saved against
   * an older cultivar would otherwise blank its select and the next autosave
   * would write that blank back over real data.
   */
  function setSelectValue(select, value) {
    if (!select) return;
    select.value = value || '';
    if (value && select.value !== value) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = cultivarLabel(value);
      select.appendChild(opt);
      select.value = value;
    }
  }

  /**
   * The face over a cultivar select: the chosen value typeset as a name with
   * its method and year subordinate ("Godfather OG  SUNGROWN · 2025"), or the
   * placeholder when nothing is chosen. The select's own text is transparent
   * (floor.css .cv); this is what the manager sees.
   */
  function renderCultivarFace(id) {
    const select = els[id];
    const face = els[CULTIVAR_FACE[id]];
    if (!select || !face) return;
    const value = select.value;
    if (!value) {
      face.classList.add('empty');
      face.innerHTML = `<i>${esc(t('selectCultivar'))}</i>`;
      return;
    }
    const p = cultivarParts(value);
    const meta = [p.grow, p.year].filter(Boolean).join(' · ');
    face.classList.remove('empty');
    face.innerHTML = `<i>${esc(p.name)}</i>${meta ? `<small>${esc(meta)}</small>` : ''}`;
  }

  const renderCultivarFaces = () => { for (const id of Object.keys(CULTIVAR_FACE)) renderCultivarFace(id); };

  /**
   * Cultivar options, queued ones floated to the top (port of
   * populateCultivarSelects, index.js:1713). REORDER ONLY: an alias with no
   * matching option is dropped, because offering a string the production API
   * does not accept would only produce a 400 on save. The group labels are
   * load-bearing — nothing else on this screen says the list was reordered.
   */
  function renderCultivars() {
    const queued = aliases.filter((a) => cultivars.includes(a));
    const rest = cultivars.filter((c) => !queued.includes(c));

    // Labels are typeset (name · method · year); values stay the raw catalogue
    // string, which is what the production API accepts.
    const optionsHtml = (list) => list.map((c) => `<option value="${esc(c)}">${esc(cultivarLabel(c))}</option>`).join('');

    for (const id of ['cultivar1', 'cultivar2']) {
      const select = els[id];
      if (!select) continue;

      const currentValue = select.value;
      let html = `<option value="" data-i18n="selectCultivar">${esc(t('selectCultivar'))}</option>`;
      if (queued.length) {
        html += `<optgroup label="— ${esc(t('queueInQueue'))} —">${optionsHtml(queued)}</optgroup>`;
        html += `<optgroup label="— ${esc(t('queueAll'))} —">${optionsHtml(rest)}</optgroup>`;
      } else {
        html += optionsHtml(rest);
      }
      select.innerHTML = html;

      // Never write a value the manager did not pick: the queue is a
      // prediction, and the burn-down reads these entries back.
      setSelectValue(select, currentValue);
    }
    renderCultivarFaces();
  }

  function renderSaveState() {
    const s = lastSaveState;
    const state = s && s.state;
    const pendingCount = (s && Number.isFinite(s.pendingCount))
      ? s.pendingCount
      : (saver && saver.pendingKeys ? saver.pendingKeys().length : 0);

    // The line always says where this hour stands; `shown` is what floor.css
    // colours it by (saved green, anything not yet on the server gold,
    // failed red, an untouched hour in plain ink).
    let main = '';
    let shown = state;
    if (state === 'saving') {
      main = esc(t('saving'));
    } else if (state === 'saved') {
      const at = (s.at instanceof Date) ? s.at : new Date();
      main = `${esc(t('saved'))} <span class="num">${esc(clockTime(at))}</span>`;
    } else if (state === 'error') {
      main = esc(t('saveFailed'));
    } else if (state === 'dirty') {
      // Typed, not yet sent: Enter, Tab or a click away sends it.
      main = esc(t('notSaved'));
    } else if (saveKey && saver && saver.isPending && saver.isPending(saveKey)) {
      // No transition reported yet but the hour is still queued — say so
      // rather than showing a stale "Saved" from the hour just left.
      main = esc(t('notSaved'));
      shown = 'pending';
    } else if (hasProduction(loadedSnapshot) || hasCrew(loadedSnapshot)) {
      // Loaded from the server and untouched since: it is saved, whenever
      // that was. Silence here read as "not sure".
      main = esc(t('saved'));
      shown = 'saved';
    } else {
      main = esc(t('emptyHour'));
      shown = 'empty';
    }

    // More than one hour outstanding is a different problem from this hour
    // failing, and it outranks the per-save message: the manager needs to know
    // the day is drifting off the server, not which field the worker rejected.
    let warn = '';
    if (state === 'error' && s.message) warn = String(s.message);
    if (pendingCount > 1) warn = t('unsavedHours').replace('{n}', String(pendingCount));

    if (els.saveState) {
      els.saveState.innerHTML = main;
      els.saveState.dataset.state = shown || '';
    }
    if (els.saveWarn) {
      els.saveWarn.textContent = warn;
      els.saveWarn.hidden = !warn;
    }
    if (els.saveSep) els.saveSep.hidden = !(main && warn);
    if (els.retrySave) els.retrySave.hidden = state !== 'error';
  }

  function setSaveState(s) {
    lastSaveState = s || null;
    renderSaveState();
  }

  function setLine2(on) {
    line2 = Boolean(on);
    if (els.crew2) els.crew2.hidden = !line2;
    if (els.lbs2) els.lbs2.hidden = !line2;
    // The class shortens the big inputs so two stacked lines still fit without
    // scrolling the page (floor.css `.lbs.two-lines`).
    if (els.lbs) els.lbs.classList.toggle('two-lines', line2);
    if (els.line2Toggle) els.line2Toggle.setAttribute('aria-pressed', line2 ? 'true' : 'false');
  }

  function refreshLabels() {
    renderChips();
    renderCultivars(); // re-renders the cultivar faces too
    setTarget();
    renderSaveState();
  }

  /**
   * The save line while typing: the moment the form differs from what the
   * server has, it says "Not saved" — and goes back to the loaded state if
   * the edit is undone before it is sent. The saver's own transitions
   * (saving / saved / error) overwrite this as soon as a send begins.
   */
  function reflectDirty() {
    if (!slot) return;
    const dirty = isDirty(form(), dirtyBaseline);
    const wasDirty = lastSaveState && lastSaveState.state === 'dirty';
    if (dirty && !wasDirty) setSaveState({ state: 'dirty' });
    else if (!dirty && wasDirty) setSaveState(null);
  }

  /** Blur on a pounds field: settle what was typed into the page's one numeral form. */
  function settleWeight(el) {
    const shown = fieldText(parseFloat(el.value));
    if (el.value !== shown) el.value = shown;
  }

  // ------------------------------------------------------------------- load

  function load(slotIndex) {
    const ctx = getContext ? getContext() : null;
    const nextSlot = ctx?.slots?.[slotIndex];
    if (!nextSlot) return;

    slot = nextSlot;
    dateKey = ctx.date;
    // The key is a cross-module contract: strip.js badges unsaved hours by it.
    saveKey = `${dateKey}|${slot}`;

    const row = ctx.dayData?.[slot] || null;
    loadedSnapshot = rowToForm(row);

    const parts = parseNotes(loadedSnapshot.qcNotes);
    brackets = parts.brackets.slice();
    selected.clear();
    for (const id of parts.reasons) selected.add(id);
    if (els.note) els.note.value = parts.text;
    renderChips();

    // The baseline has to be what form() will produce, not the row's raw
    // string: parseNotes trims, drops blank lines and reorders reason ids, so a
    // note the server stored unnormalised would read as dirty on load and the
    // first blur would post an edit nobody made.
    loadedSnapshot.qcNotes = composeQcNotes();
    dirtyBaseline = { ...loadedSnapshot };
    crewBaseline = { ...loadedSnapshot };
    hadProduction = hasProduction(loadedSnapshot);

    for (const id of FORM_INPUT_IDS) {
      const el = els[id];
      if (!el) continue;
      if (el.tagName === 'SELECT') setSelectValue(el, loadedSnapshot[id]);
      else if (WEIGHT_INPUT_IDS.includes(id)) el.value = fieldText(loadedSnapshot[id]);
      else el.value = loadedSnapshot[id];
    }
    renderCultivarFaces();

    crewLog = startCrewLog(row, slotMinutes(ctx).start, ctx.nowMinutes ?? 0);

    setLine2(rowHasLine2(row));

    if (els.hourTitle) els.hourTitle.textContent = hourTitle(slot);
    if (els.nowBadge) els.nowBadge.hidden = !isLiveSlot(ctx);

    lastSaveState = null;
    renderSaveState();
    setTarget();
  }

  function focusFirst() {
    const el = els.buckers1;
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') el.select();
  }

  // ---------------------------------------------------------------- editing

  /**
   * After anything that can move the crew: extend the log so a mid-hour change
   * gets time-weighted, and redraw the target that hangs off it.
   *
   * The log is only extended for the hour actually in progress. An hour that
   * has already ended cannot have a change happen inside it, and appending a
   * segment stamped with the current minute would give it zero duration —
   * which would leave the whole hour weighted on the OLD count and silently
   * discard the correction being typed.
   */
  function afterCrewEdit() {
    const ctx = getContext ? getContext() : null;
    if (isLiveSlot(ctx)) crewLog = recordCrewChange(crewLog, form(), ctx.nowMinutes ?? 0);
    setTarget();
  }

  function onStep(e) {
    const btn = e.target.closest && e.target.closest('button[data-step]');
    if (!btn) return;
    const input = els[btn.dataset.field];
    if (!input) return;

    const delta = Number(btn.dataset.step) || 0;
    const value = (parseInt(input.value, 10) || 0) + delta;
    input.value = String(Math.min(CREW_MAX, Math.max(CREW_MIN, value)));

    afterCrewEdit();
    scheduleSave();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (e.target && typeof e.target.blur === 'function') e.target.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();

    // Schedule BEFORE flushing. flush() only sends keys already pending, and
    // typing into a field fires `input`, not `change` — so without this the
    // Enter that is supposed to save immediately would send nothing and the
    // save would not happen until focus left the field.
    maybeSchedule();
    if (saver) saver.flush();

    const next = nextField(e.target.id, { line2 });
    if (!next) {
      // End of the hour: the next thing the manager wants is the next hour.
      if (onNavigate) onNavigate(1);
      focusFirst();
      return;
    }

    const el = els[next];
    if (!el) return;
    el.focus();
    // Selecting the text means the next number typed replaces rather than
    // appends — the difference between 12 and 1216 at speed.
    if (typeof el.select === 'function' && (el.type === 'number' || el.type === 'text')) el.select();
  }

  // ------------------------------------------------------------------ wiring

  if (els.editor) els.editor.addEventListener('click', onStep, { signal });

  for (const id of FORM_INPUT_IDS) {
    const el = els[id];
    if (!el) continue;
    el.addEventListener('input', reflectDirty, { signal });
    el.addEventListener('change', () => {
      if (el.tagName === 'SELECT') renderCultivarFace(id);
      afterCrewEdit();
      maybeSchedule();
    }, { signal });
    el.addEventListener('blur', () => {
      if (WEIGHT_INPUT_IDS.includes(id)) settleWeight(el);
      maybeSchedule();
    }, { signal });
    el.addEventListener('keydown', onKeydown, { signal });
  }

  if (els.note) {
    els.note.addEventListener('input', () => { reflectDirty(); maybeSchedule(); }, { signal });
    els.note.addEventListener('keydown', onKeydown, { signal });
  }

  if (els.chips) {
    els.chips.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.rchip[data-reason]');
      if (!btn) return;
      const id = btn.dataset.reason;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      btn.setAttribute('aria-pressed', selected.has(id) ? 'true' : 'false');
      maybeSchedule();
    }, { signal });
  }

  if (els.line2Toggle) {
    els.line2Toggle.addEventListener('click', () => {
      setLine2(true);
      // Opening line 2 is a request to fill it in, so put the cursor there.
      if (els.buckers2) els.buckers2.focus();
    }, { signal });
  }

  if (els.line2Remove) {
    els.line2Remove.addEventListener('click', () => {
      for (const id of LINE2_FIELDS) {
        const el = els[id];
        if (!el) continue;
        // T-Zero goes back to the staffing default, not to zero (entry.js
        // rowToForm keeps the same rule).
        if (id === 'tzero2') el.value = '1';
        else if (el.tagName === 'SELECT') el.value = '';
        else el.value = '0';
      }
      setLine2(false);
      // Dropping line 2 removes its trimmers, so the hour's target moves too.
      afterCrewEdit();
      scheduleSave();
    }, { signal });
  }

  if (els.retrySave) {
    els.retrySave.addEventListener('click', () => { if (saver) saver.retry(); }, { signal });
  }

  renderChips();
  renderCultivarFaces();

  return {
    load,
    form,
    /** Send this hour now: what Enter does, for the button that says so. */
    save() {
      maybeSchedule();
      if (saver) saver.flush();
    },
    snapshot,
    payload,
    setTarget,
    refreshLabels,
    setSaveState,
    focusFirst,
    setCultivars(list, queueAliases) {
      cultivars = Array.isArray(list) ? list.slice() : [];
      aliases = Array.isArray(queueAliases) ? queueAliases.slice() : [];
      renderCultivars();
    },
    destroy() {
      controller.abort();
    },
  };
}
