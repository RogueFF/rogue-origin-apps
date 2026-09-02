/**
 * The Shift Ledger — the hub's signature element.
 *
 * One column per hour (or per day on a multi-day range). Each column stacks:
 *   1. tops and smalls as two thin columns on a shared baseline,
 *   2. the rate marker against that hour's target tick,
 *   3. the figures themselves, aligned under the marks like a clipboard.
 * A flag on the column means the hour carries a note (crew change, QC remark).
 */
import { el, capPath } from './svg.js';
import { esc, num, niceScale } from './format.js';

const ROWS = [
  { key: 'tops', label: 'tops lb', cls: 'v-tops', fmt: (v) => num(v, 1) },
  { key: 'smalls', label: 'smalls', cls: 'v-dim', fmt: (v) => num(v, 0) },
  { key: 'rate', label: 'lb/tr/hr', cls: '', fmt: (v) => num(v, 2) },
  { key: 'crew', label: 'crew', cls: 'v-dim', fmt: (v, c) => (Number.isFinite(c.trimmers) ? `${c.trimmers}${Number.isFinite(c.buckers) ? `·${c.buckers}` : ''}` : v ?? '—') },
];

/**
 * @param {HTMLElement} host
 * @param {{ columns: Array<{label, sub?, tops, smalls, rate, target?, trimmers?, buckers?, crew?, notes?, current?}>, mode: 'hour'|'day' }} opts
 */
export function renderLedger(host, { columns, mode = 'hour' }) {
  host.innerHTML = '';
  if (!columns?.length) {
    host.innerHTML = `<div class="empty">${mode === 'hour' ? 'No hours logged yet. The ledger fills in as the floor manager enters each hour.' : 'No days with output in this range.'}</div>`;
    return;
  }

  const n = columns.length;
  const gutter = 64;
  const avail = Math.max(640, host.clientWidth || 800) - gutter - 8;
  const colW = Math.max(60, Math.min(120, Math.floor(avail / n)));
  const W = gutter + colW * n + 8;

  const labelH = 34;
  const barH = 118;
  const rateH = 54;
  const rowH = 22;
  const padTop = 10;
  const tableTop = padTop + labelH + barH + 12 + rateH + 8;
  const H = tableTop + ROWS.length * rowH + 6;

  const maxLb = Math.max(1, ...columns.map((c) => Math.max(c.tops || 0, c.smalls || 0)));
  const lbScale = niceScale(maxLb, 3);
  const barTop = padTop + labelH;
  const base = barTop + barH;
  const yLb = (v) => base - ((v || 0) / lbScale.max) * barH;

  const rateTop = base + 12;
  const rateBase = rateTop + rateH;
  const maxRate = Math.max(0.5, ...columns.map((c) => Math.max(c.rate || 0, c.target || 0)));
  const yRate = (v) => rateBase - 6 - ((v || 0) / (maxRate * 1.1)) * (rateH - 12);

  const svg = el('svg', { class: 'ledger', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': mode === 'hour' ? 'Shift ledger, hour by hour' : 'Ledger, day by day' });

  // Row labels in the gutter
  svg.appendChild(el('text', { class: 'row-label', x: gutter - 8, y: barTop + 10, 'text-anchor': 'end', text: 'lbs' }));
  svg.appendChild(el('text', { class: 'row-label', x: gutter - 8, y: rateTop + 12, 'text-anchor': 'end', text: 'rate' }));
  ROWS.forEach((r, i) => {
    svg.appendChild(el('text', { class: 'row-label', x: gutter - 8, y: tableTop + i * rowH + 15, 'text-anchor': 'end', text: r.label }));
  });

  // grid for the lbs band
  for (let v = lbScale.step; v <= lbScale.max + 1e-9; v += lbScale.step) {
    svg.appendChild(el('line', { class: 'grid', x1: gutter, x2: W - 8, y1: yLb(v), y2: yLb(v) }));
  }
  svg.appendChild(el('line', { class: 'base', x1: gutter, x2: W - 8, y1: base, y2: base }));
  svg.appendChild(el('line', { class: 'grid', x1: gutter, x2: W - 8, y1: tableTop - 4, y2: tableTop - 4 }));

  const barW = Math.min(18, (colW - 16) / 2);
  const gap = 2;
  const bgs = [];
  const tip = ensureTip(host);

  columns.forEach((c, i) => {
    const x0 = gutter + i * colW;
    const cx = x0 + colW / 2;
    const bg = el('rect', { class: `col-bg${c.current ? ' current' : ''}`, x: x0 + 1, y: padTop, width: colW - 2, height: H - padTop - 4, rx: 6 });
    svg.appendChild(bg);
    bgs.push(bg);

    // column label
    svg.appendChild(el('text', { class: 'col-label', x: cx, y: padTop + 14, 'text-anchor': 'middle', text: c.label }));
    if (c.sub) svg.appendChild(el('text', { class: 'col-sub', x: cx, y: padTop + 27, 'text-anchor': 'middle', text: c.sub }));

    // bars
    const ht = base - yLb(c.tops);
    const hs = base - yLb(c.smalls);
    const xt = cx - barW - gap / 2;
    const xs = cx + gap / 2;
    if (ht > 0) svg.appendChild(el('path', { class: 'bar-tops', d: capPath(xt, yLb(c.tops), barW, ht) }));
    if (hs > 0) svg.appendChild(el('path', { class: 'bar-smalls', d: capPath(xs, yLb(c.smalls), barW, hs) }));
    // The pounds ride inside the bar, running up it. A bar too short to hold
    // the text gets the figure just above its cap instead — never clipped.
    barLabel(svg, xt, yLb(c.tops), barW, ht, num(c.tops, 1), 'tops');
    barLabel(svg, xs, yLb(c.smalls), barW, hs, num(c.smalls, 0), 'smalls');

    // rate marker vs target tick
    if (Number.isFinite(c.target) && c.target > 0) {
      svg.appendChild(el('line', { class: 'tgt', x1: cx - colW / 2 + 10, x2: cx + colW / 2 - 10, y1: yRate(c.target), y2: yRate(c.target) }));
    }
    if (Number.isFinite(c.rate)) {
      const status = Number.isFinite(c.target) && c.target > 0 ? (c.rate >= c.target ? 'good' : 'warn') : 'plain';
      svg.appendChild(el('circle', { class: `dot ${status}`, cx, cy: yRate(c.rate), r: 4.5 }));
    }

    // note flag
    if (c.notes) {
      svg.appendChild(el('path', { class: 'flag', d: `M${x0 + colW - 16},${padTop + 4} l10,0 l-5,9 z` }));
    }

    // figures
    ROWS.forEach((r, j) => {
      const v = c[r.key];
      svg.appendChild(el('text', { class: r.cls, x: cx, y: tableTop + j * rowH + 15, 'text-anchor': 'middle', text: r.fmt(v, c) }));
    });

    // hit area
    const hit = el('rect', { class: 'col-hit', x: x0, y: padTop, width: colW, height: H - padTop });
    hit.addEventListener('pointerenter', () => bg.classList.add('hover'));
    hit.addEventListener('pointerleave', () => { bg.classList.remove('hover'); tip.classList.remove('on'); });
    hit.addEventListener('pointermove', (e) => {
      tip.innerHTML = `<div class="t">${esc(c.tipTitle || c.label)}${c.sub ? ` <span class="muted">${esc(c.sub)}</span>` : ''}</div>
        <div class="r"><span><i class="tops"></i>Tops</span><b>${num(c.tops)} lbs</b></div>
        <div class="r"><span><i class="smalls"></i>Smalls</span><b>${num(c.smalls, 0)} lbs</b></div>
        <div class="r"><span>Rate</span><b>${num(c.rate, 2)}${Number.isFinite(c.target) ? ` <span class="muted">/ ${num(c.target, 2)}</span>` : ''}</b></div>
        ${Number.isFinite(c.trimmers) ? `<div class="r"><span>Crew</span><b>${c.trimmers} trim${Number.isFinite(c.buckers) ? ` · ${c.buckers} buck` : ''}</b></div>` : Number.isFinite(c.crew) ? `<div class="r"><span>Crew</span><b>${c.crew}</b></div>` : ''}
        ${c.cultivar ? `<div class="r"><span>Cultivar</span><b>${esc(c.cultivar)}</b></div>` : ''}
        ${c.notes ? `<div class="n">${esc(c.notes)}</div>` : ''}`;
      tip.classList.add('on');
      const hr = host.getBoundingClientRect();
      const px = e.clientX - hr.left + host.scrollLeft;
      const py = e.clientY - hr.top;
      const tw = tip.offsetWidth || 180;
      tip.style.left = `${px + 14 + tw > host.scrollWidth ? px - tw - 14 : px + 14}px`;
      tip.style.top = `${Math.max(0, py - 30)}px`;
    });
    svg.appendChild(hit);
  });

  host.appendChild(svg);
}

const MIN_INSIDE = 30; // px of bar needed before a rotated label fits with padding

function barLabel(svg, x, top, w, h, text, kind) {
  if (!(h > 0) || text === '—') return;
  const cx = x + w / 2;
  if (h >= MIN_INSIDE) {
    const cy = top + h / 2;
    svg.appendChild(el('text', {
      class: `bar-val ${kind}`, x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      transform: `rotate(-90 ${cx} ${cy})`, text,
    }));
  } else {
    svg.appendChild(el('text', { class: 'bar-val above', x: cx, y: top - 4, 'text-anchor': 'middle', text }));
  }
}

function ensureTip(host) {
  let tip = host.parentElement?.querySelector(':scope > .tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    host.parentElement?.appendChild(tip);
  }
  return tip;
}
