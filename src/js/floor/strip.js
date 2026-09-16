/**
 * The day's ledger — one column per visible hour, read left to right.
 *
 * A column is a ledger row turned on its side: when it ran, what was on the
 * line, how the pounds landed against target, and what came off as smalls.
 * Clicking one opens that hour in the editor below, so the ledger is also the
 * page's navigation.
 *
 * A full teardown-and-rebuild on every render is deliberate: ten columns is
 * nothing to reconstruct, and a diffing renderer here would just be a second
 * place for column state to drift from entry.js's tickState(). The only piece
 * of state worth carrying across a rebuild is keyboard focus, so that is the
 * one thing this module tracks by hand.
 */
import { tickState, rowTops, rowHasLine2 } from './entry.js';
import { hourTitle, tickLabel, num, cultivarParts } from './format.js';
import { SLOT_DEFS } from './slots.js';

/**
 * Minutes per canonical slot, by index. The two thirty-minute slots (the
 * lunch-return half hour and the 4-4:30 closeout) get the narrower `.half`
 * column; every other hour is a full sixty. Read straight off SLOT_DEFS
 * rather than re-parsing the slot label text, so a change to the shift shape
 * has one place to update, not two.
 */
const SLOT_DURATIONS = SLOT_DEFS.map((d) => (d.end * 60 + d.endMin) - (d.start * 60 + d.startMin));
const isHalfSlot = (index) => (SLOT_DURATIONS[index] ?? 60) < 60;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** Total smalls on the hour, both lines. */
function rowSmalls(row) {
  return (Number(row?.smalls1) || 0) + (Number(row?.smalls2) || 0);
}

/**
 * What ran this hour, on two lines: the cultivar, and how it was grown. The
 * stored value carries both plus the crop year ("2025 - Lifter / Sungrown"),
 * and the year is the one part a manager reading the day does not need. A
 * second line running something else is a "+1".
 */
function cultivarLines(row) {
  if (!row?.cultivar1) return ['—', ''];
  const first = cultivarParts(row.cultivar1);
  const second = rowHasLine2(row) && row?.cultivar2 ? cultivarParts(row.cultivar2).name : '';
  const name = second && second !== first.name ? `${first.name} +1` : first.name;
  return [name, first.grow];
}

/**
 * Where the green fill and the gold target mark sit inside a column's bar.
 *
 * `scale` is the day's, not the hour's: every column is drawn against the
 * largest number anywhere on the day, so the columns read as one chart and a
 * tall hour looks tall. Scaling each bar to its own target instead would make
 * a 5 lb hour that met target look identical to a 15 lb one.
 */
function barGeometry(tops, target, scale) {
  if (scale <= 0) return { fill: 0, target: null };
  return {
    fill: Math.min(100, (tops / scale) * 100),
    target: target > 0 ? Math.min(100, (target / scale) * 100) : null,
  };
}

function buildColumn({ slot, index, slots, row, target, scale, isOpen, isSelected, pending, t }) {
  const tops = rowTops(row);
  const smalls = rowSmalls(row);
  const state = tickState({ row, target, isOpen });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = ['tick', state, isHalfSlot(index) ? 'half' : ''].filter(Boolean).join(' ');
  btn.dataset.index = String(index);
  if (isSelected) btn.setAttribute('aria-current', 'true');

  // Taste call: the tooltip appends the raw qcNotes string verbatim (bracket
  // syntax and all) rather than running it through reasons.js — a manager
  // hovering a column wants everything that's on the hour, not a cleaned-up
  // version of it.
  const titleBits = [`${hourTitle(slot)} · ${num(tops)} of ${num(target)} lb`];
  if (row?.qcNotes) titleBits.push(row.qcNotes);
  btn.title = titleBits.join(' · ');

  if (pending) {
    const dot = el('span', 't-unsaved');
    dot.title = t('notSaved');
    btn.appendChild(dot);
  }

  btn.appendChild(el('span', 't-hour', tickLabel(slot, index, slots)));

  const [name, grow] = cultivarLines(row);
  const cv = el('span', 't-cv');
  cv.appendChild(el('span', 't-cv-name', name));
  if (grow) cv.appendChild(el('span', 't-cv-grow', grow));
  btn.appendChild(cv);

  // The bar is the column: pounds rising from the floor, and the target as a
  // line across it. Where the green stops against that line is the hour.
  const geometry = barGeometry(tops, target, scale);
  const bar = el('span', 't-bar');
  const fill = el('span', 't-fill');
  fill.style.height = `${geometry.fill}%`;
  bar.appendChild(fill);
  if (geometry.target != null) {
    const mark = el('span', 't-tgt');
    mark.style.bottom = `${geometry.target}%`;
    bar.appendChild(mark);
  }
  btn.appendChild(bar);

  // Pounds, then the target it was measured against. Nothing recorded is an
  // em dash, never a zero.
  const topsRow = el('span', 't-tops');
  topsRow.appendChild(el('span', 'num', tops > 0 ? num(tops) : '—'));
  btn.appendChild(topsRow);
  btn.appendChild(el('span', 't-of', target > 0 ? `/ ${num(target)}` : ''));

  // Smalls are listed per hour but never added into the day's total, which is
  // tops only — the one number the shift is judged on. The line keeps its
  // height when the hour has none, so the columns stay on one baseline.
  btn.appendChild(el('span', 't-smalls', smalls > 0 ? `+${num(smalls)} ${t('smallsShort')}` : ''));

  return btn;
}

/**
 * @param {HTMLElement} host - `#ribbon`, emptied and rebuilt each call.
 * @param {{
 *   slots: string[],
 *   dayData: Record<string, object>,
 *   selectedIndex: number,
 *   currentSlot: string|null,
 *   targetFor: (slot: string) => number,
 *   isVisible: (slot: string) => boolean,
 *   pendingKeys: string[],
 *   dateKey: string,
 *   t: (key: string) => string,
 *   onSelect: (index: number) => void,
 * }} opts
 */
export function renderStrip(host, {
  slots = [],
  dayData = {},
  selectedIndex = -1,
  currentSlot = null,
  targetFor = () => 0,
  isVisible = () => true,
  pendingKeys = [],
  dateKey = '',
  t = (k) => k,
  onSelect = () => {},
} = {}) {
  const pending = new Set(pendingKeys);

  // One scale for the whole day, so the columns read as a single chart: the
  // tallest thing anywhere on the day, whether that is pounds or a target.
  let scale = 0;
  for (const slot of slots) {
    if (!isVisible(slot)) continue;
    scale = Math.max(scale, rowTops(dayData[slot]), targetFor(slot) || 0);
  }

  // The rebuild below throws away every node, focus included. Remember which
  // column had it by index (not by node, which is about to be gone) so a
  // manager mid-arrow-key-navigation doesn't get bounced back to the start of
  // the ledger on the next render.
  const focused = document.activeElement;
  const focusedIndex = (focused && host.contains(focused) && focused.classList?.contains('tick'))
    ? focused.dataset.index
    : null;

  host.textContent = '';

  slots.forEach((slot, index) => {
    if (!isVisible(slot)) return;

    // The lunch gap sits between the fixed morning/afternoon halves of the
    // shift, not between whatever two columns happen to render next to each
    // other — it only appears when both of its real neighbours are visible.
    if (index === 5 && isVisible(slots[4]) && isVisible(slots[5])) {
      const lunch = el('span', 'lunch');
      lunch.setAttribute('aria-hidden', 'true');
      host.appendChild(lunch);
    }

    const row = dayData[slot];
    const target = targetFor(slot) || 0;
    const isOpen = index === selectedIndex || slot === currentSlot;

    const column = buildColumn({
      slot,
      index,
      slots,
      row,
      target,
      scale,
      isOpen,
      isSelected: index === selectedIndex,
      pending: pending.has(`${dateKey}|${slot}`),
      t,
    });
    column.addEventListener('click', () => onSelect(index));
    host.appendChild(column);
  });

  if (focusedIndex != null) {
    host.querySelector(`.tick[data-index="${focusedIndex}"]`)?.focus();
  }

  // Roving arrow-key focus between columns. Wired once per host, not once per
  // render — the buttons are torn down and rebuilt every call, but the host
  // itself persists, so a listener added on every renderStrip() call would
  // stack duplicates.
  if (!host.dataset.stripWired) {
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const current = e.target.closest?.('.tick');
      if (!current) return;
      e.preventDefault();
      const columns = Array.from(host.querySelectorAll('.tick'));
      const i = columns.indexOf(current);
      const next = columns[e.key === 'ArrowLeft' ? i - 1 : i + 1];
      next?.focus();
    });
    host.dataset.stripWired = '1';
  }
}
