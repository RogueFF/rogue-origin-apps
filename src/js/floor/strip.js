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
 * What ran this hour, as a name. The stored value carries the grow method and
 * crop year ("2025 - Lifter / Sungrown"); a column this narrow only has room
 * for the name, and a second line running something else is a "+1".
 */
function cultivarText(row) {
  const first = row?.cultivar1 ? cultivarParts(row.cultivar1).name : '';
  if (!first) return '';
  const second = rowHasLine2(row) && row?.cultivar2 ? cultivarParts(row.cultivar2).name : '';
  return second && second !== first ? `${first} +1` : first;
}

/**
 * Where the green fill and the gold target mark sit inside a column's bar.
 *
 * The bar is scaled to whichever is larger, the pounds or the target, so an
 * hour that beat its target shows green running past the gold mark rather
 * than pinned flat at 100%. An hour with pounds but no target (no trimmers
 * logged yet) is full green and carries no mark.
 */
function barGeometry(tops, target) {
  const scale = Math.max(tops, target);
  if (scale <= 0) return { fill: 0, target: null };
  return {
    fill: (tops / scale) * 100,
    target: target > 0 ? (target / scale) * 100 : null,
  };
}

function buildColumn({ slot, index, slots, row, target, isOpen, isSelected, pending, t }) {
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
  btn.appendChild(el('span', 't-cv', cultivarText(row)));

  const geometry = barGeometry(tops, target);
  const bar = el('span', 't-bar');
  const fill = el('span', 't-fill');
  fill.style.width = `${geometry.fill}%`;
  bar.appendChild(fill);
  if (geometry.target != null) {
    const mark = el('span', 't-tgt');
    mark.style.left = `${geometry.target}%`;
    bar.appendChild(mark);
  }
  btn.appendChild(bar);

  // Pounds, then the target it was measured against. Nothing recorded is an
  // em dash, never a zero.
  const topsRow = el('span', 't-tops');
  topsRow.appendChild(el('span', 'num', tops > 0 ? num(tops) : '—'));
  if (target > 0) topsRow.appendChild(el('span', 't-of', `/ ${num(target)}`));
  btn.appendChild(topsRow);

  // Smalls are listed per hour but never added into the day's total, which is
  // tops only — the one number the shift is judged on.
  const smallsRow = el('span', 't-smalls');
  smallsRow.appendChild(document.createTextNode(`${t('smalls')} `));
  smallsRow.appendChild(el('span', 'num', smalls > 0 ? num(smalls) : '—'));
  btn.appendChild(smallsRow);

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
