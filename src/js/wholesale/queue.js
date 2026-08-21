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

/** A progress bar for one line item: pounds recorded against pounds ordered. */
function lineRow(line) {
  const row = el('div', `seg-line${line.pct >= 1 ? ' filled' : ''}`);
  row.append(el('span', 'sl-form', t(line.form)));

  const track = el('div', 'sl-track');
  const fill = el('div', 'sl-fill');
  fill.style.width = `${Math.min(100, line.pct * 100)}%`;
  track.append(fill);
  row.append(track);

  // The unit belongs on the pair, not on each half of it.
  const done = line.doneLbs.toLocaleString('en-US', { maximumFractionDigits: 1 });
  row.append(el('span', 'sl-num', `${done} / ${fmtLbs(line.qtyLbs)}`));
  row.append(el('span', 'sl-pct', pctText(line.pct)));
  return row;
}

/** One trim pass inside a block — a lot, its dates, and the lines it fills. */
function passRow(pass) {
  const row = el('div', `pass-row${pass.estimated ? ' estimated' : ''}`);

  const top = el('div', 'pass-top');
  top.append(el('span', 'pass-cv', pass.cultivarName));
  if (pass.jointPass) {
    // Worth saying on the card, because it is the one place the board's
    // arithmetic will look wrong to someone counting line items: two lines,
    // one stretch of floor time.
    top.append(el('span', 'pass-joint', t('one_pass')));
  }
  if (pass.estimated) top.append(el('span', 'run-flag', t('no_history')));
  // Whole pounds. A lot is a heap of plant material on a line; half a pound of
  // stated precision on 1,682 of them is a claim the number cannot support.
  top.append(el('span', 'pass-lot', `${fmtLbs0(pass.lotLbs)} ${t('lot')}`));
  top.append(el('span', 'pass-eta', `${t('done')} ${humanDate(pass.finish.date)}`));
  row.append(top);

  pass.lines.forEach(l => row.append(lineRow(l)));

  // THE BYPRODUCT, and the only thing this line used to say that was not
  // already said elsewhere.
  //
  // What was here before read: "sized by Tops 891.1 lb · yields T/S 891.1 lb /
  // 790.4 lb". Four numbers, one fact. `891.1` is the outstanding tops, which
  // the bar above already shows as 8.9 of 900; it then appears a second time as
  // the tops yield, because the binding form's yield IS its need — that is what
  // binding means, so printing it is circular. And 891.1 + 790.4 is the lot,
  // already on the line above. Only the smalls that fall out were new.
  //
  // Shown only when there is a byproduct: a pass whose lot is fully spoken for
  // has nothing to say here.
  const spareLbs = pass.binding === 'smalls' ? pass.surplusTops : pass.surplusSmalls;
  const spareForm = pass.binding === 'smalls' ? t('tops') : t('smalls');
  if (spareLbs >= 1) {
    row.append(el('div', 'pass-spare',
      `+${fmtLbs0(spareLbs)} ${spareForm.toLowerCase()} ${t('spare')}`));
  }

  // Coverage is per cultivar and form — which is what a pass is, so it belongs
  // here rather than on the order. Amber, not red: mid-season most stock is
  // raw, so being short on packed goods is the ordinary state.
  //
  // "900 lb over what is packed" was the order's own size whenever nothing was
  // packed, which is most of the season. Say that plainly instead.
  const cov = coverageFor(pass.cultivarId);
  if (cov.length) {
    const worst = cov[0];
    const flag = el('div', 'run-short');
    flag.append(el('span', 'rs-icon', '▲'));
    const sacks = worst.rawSacks ? `${worst.rawSacks} ${t('raw_sacks')}` : t('no_raw');
    const gap = worst.packedLbs
      ? `${fmtLbs0(worst.shortfallLbs)} ${t('short')}`
      : t('none_packed');
    flag.append(el('span', null, `${gap} · ${sacks}`));
    row.append(flag);
  }

  return row;
}

function blockCard(block, idx, geom, onDrop, onOrder) {
  const card = el('div', `block-card${block.dependsOnEstimate ? ' estimated' : ''}`);
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

export function renderQueue() {
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

  const meta = el('div', 'queue-meta');
  meta.append(el('span', 'qm-crew', `${t('crew')}: ${q.crew}`));
  meta.append(el('span', 'qm-basis', q.crewBasis === 'override'
    ? t('crew_override')
    : `${t('crew_derived')} ${q.crewDays} ${t('days')}`));
  meta.append(el('span', 'qm-spacer'));
  meta.append(el('span', 'qm-clear', `${t('clears')} ${humanDate(q.blocks[q.blocks.length - 1].finish.date)}`));
  wrap.append(meta);

  // Customer names live on the order, not on the schedule. Joined here so the
  // card can show one without the queue endpoint duplicating the order book.
  const nameOf = new Map(state.orders.map(o => [o.id, o.customerName]));
  const geom = span(q);
  const list = el('div', 'block-list');
  q.blocks.forEach((b, i) =>
    list.append(blockCard({ ...b, customerName: nameOf.get(b.orderId) }, i, geom, reorder, openOrder)));
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
