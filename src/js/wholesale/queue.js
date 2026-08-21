/**
 * Wholesale order board — the production queue view.
 *
 * Ranks ORDER BLOCKS. One card per order, dragged to re-rank; inside it, one
 * row per trim pass in the sequence the line items were typed. Dragging a block
 * moves it and every date behind it.
 *
 * Two things inside a block are worth knowing when reading this:
 *
 * - A pass can carry more than one line. Tops and smalls of the same cultivar
 *   come off one lot in one pass, so those two lines share a single time span
 *   and finish together — but each keeps its own progress bar, because the
 *   hourly entry records the two forms separately.
 * - Progress is real. The bars are pounds the floor actually logged, allocated
 *   by burn-down, not a projection.
 *
 * Drag uses native HTML5 DnD rather than a library, for the same reason as
 * before: the repo has two incompatible idioms and this is the one that already
 * persists to a server.
 *
 * Design: docs/plans/2026-08-20-order-blocks-restructure.md
 */

import { state, api, fmtLbs, fmtLbs0 } from './state.js';
import { t } from '../shared/i18n.js';
import { showToast } from '../shared/toast.js';
import { ensureUnlocked } from './auth.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Short lines for a cultivar, worst first. Empty when it is covered. */
function coverageFor(cultivarId) {
  return (state.coverage?.coverage || [])
    .filter(c => c.cultivarId === cultivarId && c.short)
    .sort((a, b) => b.shortfallLbs - a.shortfallLbs);
}

/** Set by index.js so this module does not import the editor and cycle. */
let openOrder = () => {};
export function onOpenOrder(fn) { openOrder = fn; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-05' -> 'Sat Sep 5'. Parsed as parts, never through Date's local parsing. */
export function humanDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${MONTHS[m - 1]} ${d}`;
}

/** Fraction of the whole queue span that a block occupies, for the timeline bar. */
function span(queue) {
  const first = queue.blocks[0]?.start;
  const last = queue.blocks[queue.blocks.length - 1]?.finish;
  if (!first || !last) return () => ({ left: 0, width: 100 });

  const toDays = (p) => {
    const [y, m, d] = p.date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000 + p.minutes / 1440;
  };
  const a = toDays(first);
  const total = Math.max(toDays(last) - a, 0.5);
  return (item) => {
    const s = (toDays(item.start) - a) / total * 100;
    const e = (toDays(item.finish) - a) / total * 100;
    return { left: s, width: Math.max(e - s, 1.5) };
  };
}

const pctText = (p) => `${Math.round(p * 100)}%`;

/**
 * The pass detail that is currently pinned open, if any.
 *
 * Pinning used to be a bare `classList.toggle('open')` with nothing to undo it.
 * A detail therefore stayed open until the same row was clicked a second time:
 * clicking away left it up, clicking a different row left BOTH up, Escape did
 * nothing, and a click that began an abandoned drag pinned one without the
 * operator ever asking for it. Open state needs somewhere to live and a way out.
 */
let pinnedRow = null;

function pin(row) {
  if (pinnedRow) pinnedRow.classList.remove('open');
  pinnedRow = row;
  if (row) row.classList.add('open');
  // Hover-open is suppressed while something is pinned, so a pinned detail and
  // a hovered one can never be on screen together.
  document.body.classList.toggle('detail-pinned', !!row);
}

// Registered once, at module load, rather than per row — there are as many rows
// as the queue is long and they are rebuilt on every render.
document.addEventListener('click', () => pin(null));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  pin(null);
  // Unpinning alone does not close it. The row still holds focus, and pressing
  // a key is exactly what puts the browser into keyboard modality — so
  // `:focus-visible` starts matching on the way out and the detail stays up.
  // Escape has to surrender the focus as well as the pin.
  const active = document.activeElement;
  if (active && active.classList?.contains('pass-row')) active.blur();
});

/**
 * 'PDT' or 'PST', whichever the farm is actually on today.
 *
 * Every time on this board is already Pacific — the scheduler carries a civil
 * date and minutes-since-midnight and never constructs a local Date, and the
 * worker seeds it from America/Los_Angeles. The board simply never said so, and
 * an unlabelled clock time on a figure that gets quoted to a buyer is the kind
 * of ambiguity that costs somebody a day.
 *
 * Derived rather than written down: "PST" is wrong from March to November, and
 * a hardcoded label would be wrong for two thirds of a season.
 */
export function zoneLabel(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', timeZoneName: 'short',
    }).formatToParts(now);
    return parts.find(p => p.type === 'timeZoneName')?.value || 'PT';
  } catch {
    return 'PT';
  }
}

/**
 * '2026-09-07' + 872 -> '9/7 2:32 PM'. The lead time, to the minute.
 *
 * AM/PM, matching how the floor writes the hourly entry. The suffix is what
 * makes the figure safe to read aloud; a bare "2:32" would not be, which was
 * the only argument for 24-hour.
 *
 * Midnight and noon are where a hand-written version of this goes wrong: hour 0
 * is 12 AM and hour 12 is 12 PM, but a plain `% 12` renders both as "0".
 */
export function humanMoment(m) {
  const [, mo, d] = m.date.split('-').map(Number);
  const h24 = Math.floor(m.minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m.minutes % 60).padStart(2, '0');
  return `${mo}/${d} ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Everything a pass knows that is not its burn-down or its lead time.
 *
 * Opened on hover, on keyboard focus, and on tap. Hover alone would put all of
 * this out of reach on a phone, which is where this board is most often read.
 */
function passDetail(pass) {
  const box = el('div', 'pass-detail');
  box.setAttribute('role', 'tooltip');

  const line = (label, value) => {
    const r = el('div', 'pd-row');
    r.append(el('span', 'pd-k', label));
    r.append(el('span', 'pd-v', value));
    box.append(r);
  };

  line(t('lot'), fmtLbs0(pass.lotLbs));

  const spareLbs = pass.binding === 'smalls' ? pass.surplusTops : pass.surplusSmalls;
  const spareForm = pass.binding === 'smalls' ? t('tops') : t('smalls');
  if (spareLbs >= 1) line(`${spareForm} ${t('spare')}`, `+${fmtLbs0(spareLbs)}`);

  line(t('takes'), `${pass.workDays} ${t('work_days')}`);

  // Provenance. A date built on the farm average is a materially weaker claim
  // than one built on this cultivar's own history, and the card should be able
  // to say which without the operator opening the console.
  line(t('rate'), `${pass.ratePerTrimmerHour.toFixed(2)} ${t('per_hr')}`);
  line(t('basis'), pass.estimated ? t('no_history') : t('measured'));

  const cov = coverageFor(pass.cultivarId);
  if (cov.length) {
    const worst = cov[0];
    const gap = worst.packedLbs
      ? `${fmtLbs0(worst.shortfallLbs)} ${t('short')}`
      : t('none_packed');
    const sacks = worst.rawSacks ? `${worst.rawSacks} ${t('raw_sacks')}` : t('no_raw');
    line(t('stock'), `${gap} · ${sacks}`);
  }

  return box;
}

/**
 * One trim pass. The row states only what the operator asked it to: pounds done
 * against pounds ordered with a percentage, and the lead time. Everything the
 * row used to spell out — lot size, byproduct, rate, coverage — moved into the
 * detail, which opens on hover, focus or tap.
 *
 * The one exception is the shortfall marker. A warning that is only reachable by
 * hovering is a warning nobody sees on a phone, so a bare glyph stays on the
 * row and its wording lives in the detail.
 *
 * A pass carries one row per line item, because tops and smalls fill at
 * different speeds. They share a lead time — one lot, one pass — so it is
 * printed once, on the first of them.
 */
function passRow(pass) {
  const row = el('div', `pass-row${pass.estimated ? ' estimated' : ''}`);
  row.tabIndex = 0;
  row.setAttribute('aria-label', `${pass.cultivarName}, ${t('details')}`);

  const short = coverageFor(pass.cultivarId).length > 0;

  pass.lines.forEach((line, i) => {
    const r = el('div', `pass-line${line.pct >= 1 ? ' filled' : ''}`);
    r.append(el('span', 'pl-cv', i === 0 ? pass.cultivarName : ''));
    r.append(el('span', 'pl-form', t(line.form)));

    const track = el('div', 'sl-track');
    const fill = el('div', 'sl-fill');
    fill.style.width = `${Math.min(100, line.pct * 100)}%`;
    track.append(fill);
    r.append(track);

    const done = line.doneLbs.toLocaleString('en-US', { maximumFractionDigits: 1 });
    r.append(el('span', 'pl-num', `${done} / ${fmtLbs(line.qtyLbs)}`));
    r.append(el('span', 'pl-pct', `(${pctText(line.pct)})`));
    r.append(el('span', 'pl-eta', i === 0 ? humanMoment(pass.finish) : ''));

    const warn = el('span', 'pl-warn', i === 0 && short ? '▲' : '');
    if (i === 0 && short) warn.setAttribute('aria-label', t('stock'));
    r.append(warn);

    row.append(r);
  });

  row.append(passDetail(pass));

  // Tap to pin the detail open. The card above is a drag surface, so the press
  // must not reach it or dragging would start under the operator's finger.
  //
  // stopPropagation here is also what keeps the document listener below from
  // treating this very click as a click-away and closing what it just opened.
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    pin(row === pinnedRow ? null : row);
  });
  row.addEventListener('mousedown', (e) => e.stopPropagation());

  return row;
}

function blockCard(block, idx, geom, onDrop, onOrder) {
  // `running` is what the pulse is for. An order the floor has actually started
  // breathes; the ones queued behind it sit still. The effect carries the one
  // piece of state a glance at this board should answer first — what is on the
  // line right now — rather than decorating every card equally.
  const card = el('div', `block-card${block.dependsOnEstimate ? ' estimated' : ''}`
    + (block.running ? ' running' : ''));
  card.draggable = true;
  card.dataset.orderId = block.orderId;

  const head = el('div', 'block-head');
  const handle = el('div', 'run-handle');
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⠿';
  head.append(handle);
  head.append(el('span', 'run-rank', String(idx + 1)));

  // The order id is the route into the editor. It has to stop the click
  // reaching the card, which is a drag surface.
  const link = el('button', 'block-id', block.orderId);
  link.type = 'button';
  link.addEventListener('click', (e) => { e.stopPropagation(); onOrder(block.orderId); });
  link.addEventListener('mousedown', (e) => e.stopPropagation());
  head.append(link);

  head.append(el('span', 'block-customer', block.customerName || ''));
  head.append(el('span', 'qm-spacer'));
  head.append(el('span', 'block-pct', pctText(block.pct)));
  head.append(el('b', 'block-eta', `${t('done')} ${humanDate(block.finish.date)}`));
  card.append(head);

  const track = el('div', 'run-track');
  const { left, width } = geom(block);
  const bar = el('div', `run-bar${block.dependsOnEstimate ? ' est' : ''}`);
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
  const fill = el('div', 'run-bar-fill');
  fill.style.width = `${Math.min(100, block.pct * 100)}%`;
  bar.append(fill);
  bar.append(el('span', null, `${fmtLbs(block.doneLbs)} / ${fmtLbs(block.totalLbs)}`));
  track.append(bar);
  card.append(track);

  const passes = el('div', 'block-passes');
  block.passes.forEach(p => passes.append(passRow(p)));
  card.append(passes);

  // --- drag ---
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', block.orderId);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-target'); });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drop-target');
    const moved = e.dataTransfer.getData('text/plain');
    if (moved && moved !== block.orderId) onDrop(moved, block.orderId);
  });

  return card;
}

/**
 * Keep the crew control telling the truth about the queue below it.
 *
 * This has to run wherever the queue is rendered, not wherever the page is
 * refreshed. Changing the crew box calls loadQueue() directly, so when this
 * lived in the refresh path the two could disagree indefinitely: typing 4
 * rebuilt every date on the board while the bar went on claiming the crew was
 * derived from the last seven production days. The number in the box has to
 * mean the number the dates were built from.
 */
function syncCrewBar() {
  const q = state.queue;
  const override = q?.crewBasis === 'override';
  const crew = $('q-crew');
  const basis = $('q-basis');
  if (!crew || !basis) return;

  crew.placeholder = q?.crew ?? '';
  crew.classList.toggle('overridden', override);
  basis.textContent = q
    ? (override ? t('crew_override') : `${t('crew_derived')} ${q.crewDays} ${t('days')}`)
    : '';
  // Nothing to reset when nothing is overridden.
  $('q-reset').hidden = !override;
}

export function renderQueue() {
  syncCrewBar();
  // Every row below is about to be discarded, so a pinned one would leave this
  // holding a detached node and the body class set forever.
  pin(null);
  const wrap = $('queue');
  wrap.textContent = '';
  const q = state.queue;

  if (!q) { wrap.append(el('div', 'loading', t('loading'))); return; }

  if (!q.blocks?.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('i', 'ph-duotone ph-calendar-blank'));
    empty.append(el('p', null, t('queue_empty')));
    wrap.append(empty);
    return;
  }

  // Crew and its basis moved into the queue bar, next to the control that sets
  // them. What is left here is about the QUEUE rather than the crew: which
  // clock these times are on, and when the whole thing clears.
  const meta = el('div', 'queue-meta');
  meta.append(el('span', 'qm-tz', `${t('times')} ${zoneLabel()}`));
  meta.append(el('span', 'qm-spacer'));
  meta.append(el('span', 'qm-clear', `${t('clears')} ${humanDate(q.blocks[q.blocks.length - 1].finish.date)}`));
  wrap.append(meta);

  // Customer names live on the order, not on the schedule. Joined here so the
  // card can show one without the queue endpoint duplicating the order book.
  const nameOf = new Map(state.orders.map(o => [o.id, o.customerName]));
  const statusOf = new Map(state.orders.map(o => [o.id, o.status]));
  const geom = span(q);
  const list = el('div', 'block-list');
  q.blocks.forEach((b, i) =>
    list.append(blockCard({
      ...b,
      customerName: nameOf.get(b.orderId),
      running: statusOf.get(b.orderId) === 'in_production',
    }, i, geom, reorder, openOrder)));
  wrap.append(list);

  wrap.append(el('p', 'queue-note', t('queue_note')));

  // Pounds the floor recorded that no waiting order could take. Usually
  // ordinary — most trim is not against a wholesale order — but it is the first
  // thing to look at when a block is not moving, so it is not hidden.
  const stray = (q.unallocated || []).reduce((s, u) => s + u.lbs, 0);
  if (stray > 0) {
    wrap.append(el('p', 'queue-note stray',
      `${fmtLbs(stray)} ${t('unallocated_note')}`));
  }
}

/** Move `moved` to sit where `target` currently is, then persist and reload. */
async function reorder(moved, target) {
  const ids = state.queue.blocks.map(b => b.orderId);
  const from = ids.indexOf(moved);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0) return;

  ids.splice(to, 0, ids.splice(from, 1)[0]);

  // Repaint immediately from the new order so the drag feels instant, then
  // reconcile against whatever the server actually schedules.
  state.queue.blocks = ids.map(id => state.queue.blocks.find(b => b.orderId === id));
  renderQueue();

  if (!await ensureUnlocked()) { loadQueue(); return; }
  try {
    await api.post('saveQueueOrder', { order: ids });
    await loadQueue();
  } catch (e) {
    showToast(String(e.message || e), 'error');
    await loadQueue();
  }
}

export async function loadQueue(crewOverride) {
  try {
    const params = crewOverride ? { crew: crewOverride } : {};
    state.queue = await api.get('getQueue', params);
    renderQueue();
  } catch (e) {
    showToast(`${t('queue_failed')}: ${e.message || e}`, 'error');
  }
}
