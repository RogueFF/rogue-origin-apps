/**
 * Wholesale order board — the production queue view.
 *
 * Ranks cultivar RUNS, not orders. The floor trims a lot, and both tops and
 * smalls come off the same pass, so one run serves every open order needing
 * that cultivar. Dragging a run re-ranks it and every date behind it moves.
 *
 * Drag uses native HTML5 DnD rather than a library. The repo already has two
 * incompatible idioms (Muuri on the dashboard, persisting only to localStorage;
 * native DnD in mc-v2, persisting to a server) and this is the one that already
 * writes through to a backend.
 */

import { state, api, fmtLbs } from './state.js';
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-05' -> 'Sat Sep 5'. Parsed as parts, never through Date's local parsing. */
export function humanDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${MONTHS[m - 1]} ${d}`;
}

/** Fraction of the whole queue span that a run occupies, for the timeline bar. */
function span(queue) {
  const first = queue.runs[0]?.start;
  const last = queue.runs[queue.runs.length - 1]?.finish;
  if (!first || !last) return () => ({ left: 0, width: 100 });

  const toDays = (p) => {
    const [y, m, d] = p.date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000 + p.minutes / 1440;
  };
  const a = toDays(first);
  const total = Math.max(toDays(last) - a, 0.5);
  return (run) => {
    const s = (toDays(run.start) - a) / total * 100;
    const e = (toDays(run.finish) - a) / total * 100;
    return { left: s, width: Math.max(e - s, 1.5) };
  };
}

function runRow(run, idx, geom, onDrop) {
  const row = el('div', `run-row${run.estimated ? ' estimated' : ''}`);
  row.draggable = true;
  row.dataset.cultivarId = run.cultivarId;
  row.dataset.index = String(idx);

  const handle = el('div', 'run-handle');
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⠿';
  row.append(handle);

  const main = el('div', 'run-main');
  const top = el('div', 'run-top');
  top.append(el('span', 'run-rank', String(idx + 1)));
  top.append(el('span', 'run-cv', run.cultivarName));
  if (run.estimated) top.append(el('span', 'run-flag', t('no_history')));
  top.append(el('span', 'run-lot', `${fmtLbs(run.lotLbs)} ${t('lot')}`));
  main.append(top);

  const feeds = el('div', 'run-feeds');
  feeds.append(el('span', 'run-pool', t('pooled')));
  feeds.append(document.createTextNode(run.orderIds.join(', ')));
  main.append(feeds);

  const bind = run.binding === 'smalls' ? t('smalls') : t('tops');
  const need = run.binding === 'smalls' ? run.smallsLbs : run.topsLbs;
  const sized = el('div', 'run-sized');
  sized.append(document.createTextNode(`${t('sized_by')} `));
  sized.append(el('em', null, `${bind} ${fmtLbs(need)}`));
  sized.append(document.createTextNode(
    ` · ${t('yields')} ${fmtLbs(run.yieldTops)} / ${fmtLbs(run.yieldSmalls)}`));
  main.append(sized);
  row.append(main);

  const tl = el('div', 'run-tl');
  const track = el('div', 'run-track');
  const { left, width } = geom(run);
  const bar = el('div', `run-bar${run.estimated ? ' est' : ''}`);
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
  bar.append(el('span', null, `${run.workDays}d`));
  track.append(bar);
  tl.append(track);

  const eta = el('div', 'run-eta');
  eta.append(el('b', null, `${t('done')} ${humanDate(run.finish.date)}`));
  eta.append(el('span', null, `· ${run.ratePerTrimmerHour.toFixed(2)} ${t('per_hr')}`));
  tl.append(eta);
  row.append(tl);

  // --- drag ---
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', run.cultivarId);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    const moved = e.dataTransfer.getData('text/plain');
    if (moved && moved !== run.cultivarId) onDrop(moved, run.cultivarId);
  });

  return row;
}

export function renderQueue() {
  const wrap = $('queue');
  wrap.textContent = '';
  const q = state.queue;

  if (!q) { wrap.append(el('div', 'loading', t('loading'))); return; }

  if (!q.runs.length) {
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
  meta.append(el('span', 'qm-clear', `${t('clears')} ${humanDate(q.runs[q.runs.length - 1].finish.date)}`));
  wrap.append(meta);

  const geom = span(q);
  const list = el('div', 'run-list');
  q.runs.forEach((run, i) => list.append(runRow(run, i, geom, reorder)));
  wrap.append(list);

  const note = el('p', 'queue-note', t('queue_note'));
  wrap.append(note);
}

/** Move `moved` to sit where `target` currently is, then persist and reload. */
async function reorder(moved, target) {
  const ids = state.queue.runs.map(r => r.cultivarId);
  const from = ids.indexOf(moved);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0) return;

  ids.splice(to, 0, ids.splice(from, 1)[0]);

  // Repaint immediately from the new order so the drag feels instant, then
  // reconcile against whatever the server actually schedules.
  state.queue.runs = ids.map(id => state.queue.runs.find(r => r.cultivarId === id));
  renderQueue();

  if (!await ensureUnlocked()) { loadQueue(); return; }
  try {
    await api.post('saveRunOrder', { order: ids });
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
