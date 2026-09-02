/**
 * Hand-drawn SVG charts. No chart library: two forms, both with a hover
 * layer and a table twin elsewhere on the page.
 */
import { esc, num, niceScale } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/** Column path with a 4px rounded cap and a square baseline. */
export function capPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function ensureTip(host) {
  let tip = host.querySelector(':scope > .tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    host.appendChild(tip);
  }
  return tip;
}

function placeTip(host, tip, px, py) {
  const hw = host.clientWidth;
  const tw = tip.offsetWidth || 160;
  const th = tip.offsetHeight || 60;
  let x = px + 14;
  if (x + tw > hw) x = px - tw - 14;
  let y = py - th / 2;
  if (y < 0) y = 0;
  tip.style.left = `${Math.max(0, x)}px`;
  tip.style.top = `${y}px`;
}

function hostWidth(host, fallback = 640) {
  return Math.max(280, host.clientWidth || fallback);
}

/**
 * Grouped columns: tops (green) beside smalls (gray), optional target hairline.
 * rows: [{ label, sub?, tops, smalls, note?, date? }]
 */
export function columnChart(host, { rows, target = null, height = 220, targetLabel = 'Target', unit = 'lbs' }) {
  host.innerHTML = '';
  host.classList.add('chart-host');
  if (!rows?.length) { host.innerHTML = '<div class="empty">No days with output in this range.</div>'; return; }

  const W = hostWidth(host);
  const H = height;
  const m = { t: 14, r: 12, b: 30, l: 40 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = rows.length;
  const group = pw / n;
  const barW = Math.max(4, Math.min(24, (group - 10) / 2));
  const gap = 2;

  const maxV = Math.max(target || 0, ...rows.map((r) => Math.max(r.tops || 0, r.smalls || 0)));
  const scale = niceScale(maxV, 4);
  const y = (v) => m.t + ph - (v / scale.max) * ph;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Tops and smalls by day' });

  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    svg.appendChild(el('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.appendChild(el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', text: num(v, 0) }));
  }
  svg.appendChild(el('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));

  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(pw / 56)));
  const bgs = [];
  rows.forEach((r, i) => {
    const gx = m.l + i * group;
    const cx = gx + group / 2;
    const bg = el('rect', { class: 'hover-bg', x: gx, y: m.t, width: group, height: ph, opacity: 0 });
    svg.appendChild(bg);
    bgs.push(bg);
    const x1 = cx - barW - gap / 2;
    const x2 = cx + gap / 2;
    const ht = Math.max(0, y(0) - y(r.tops || 0));
    const hs = Math.max(0, y(0) - y(r.smalls || 0));
    if (ht > 0) svg.appendChild(el('path', { class: 'bar-tops', d: capPath(x1, y(r.tops), barW, ht) }));
    if (hs > 0) svg.appendChild(el('path', { class: 'bar-smalls', d: capPath(x2, y(r.smalls), barW, hs) }));
    if (i % labelEvery === 0 || n <= 8) {
      svg.appendChild(el('text', { x: cx, y: H - 10, 'text-anchor': 'middle', text: r.label }));
    }
  });

  if (target) {
    svg.appendChild(el('line', { class: 'tgt', x1: m.l, x2: W - m.r, y1: y(target), y2: y(target) }));
    svg.appendChild(el('text', { x: W - m.r, y: y(target) - 4, 'text-anchor': 'end', text: `${targetLabel} ${num(target, 0)}` }));
  }

  // Hover layer
  const tip = ensureTip(host);
  const hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: ph });
  let active = -1;
  const show = (i, px, py) => {
    if (i !== active) {
      if (active >= 0) bgs[active].setAttribute('opacity', 0);
      active = i;
      bgs[i].setAttribute('opacity', 1);
      const r = rows[i];
      tip.innerHTML = `<div class="t">${esc(r.sub || r.label)}</div>
        <div class="r"><span><i class="tops"></i>Tops</span><b>${num(r.tops)} ${unit}</b></div>
        <div class="r"><span><i class="smalls"></i>Smalls</span><b>${num(r.smalls)} ${unit}</b></div>
        ${target ? `<div class="r"><span><i class="tgt"></i>${esc(targetLabel)}</span><b>${num(target, 0)} ${unit}</b></div>` : ''}
        ${r.note ? `<div class="n">${esc(r.note)}</div>` : ''}`;
      tip.classList.add('on');
    }
    placeTip(host, tip, px, py);
  };
  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const i = Math.min(n - 1, Math.max(0, Math.floor((sx - m.l) / group)));
    show(i, e.clientX - host.getBoundingClientRect().left, e.clientY - host.getBoundingClientRect().top);
  });
  hit.addEventListener('pointerleave', () => { if (active >= 0) bgs[active].setAttribute('opacity', 0); active = -1; tip.classList.remove('on'); });
  svg.appendChild(hit);
  host.appendChild(svg);
}

/**
 * Line with markers, optional moving average and target hairline.
 * rows: [{ label, sub?, value, ma? }]
 */
export function lineChart(host, { rows, target = null, height = 220, unit = '', maLabel = '7-day avg', valueLabel = 'Rate', digits = 2 }) {
  host.innerHTML = '';
  host.classList.add('chart-host');
  const pts = rows?.filter((r) => Number.isFinite(r.value)) || [];
  if (!pts.length) { host.innerHTML = '<div class="empty">No days with output in this range.</div>'; return; }

  const W = hostWidth(host);
  const H = height;
  const m = { t: 14, r: 44, b: 30, l: 40 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = rows.length;
  const step = n > 1 ? pw / (n - 1) : 0;

  const maxV = Math.max(target || 0, ...rows.map((r) => Math.max(r.value || 0, r.ma || 0)));
  const scale = niceScale(maxV * 1.08, 4);
  const y = (v) => m.t + ph - (v / scale.max) * ph;
  const x = (i) => (n > 1 ? m.l + i * step : m.l + pw / 2);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${valueLabel} by day` });
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    svg.appendChild(el('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.appendChild(el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', text: num(v, scale.step < 1 ? 1 : 0) }));
  }
  svg.appendChild(el('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));

  const path = (key) => {
    let d = '';
    let open = false;
    rows.forEach((r, i) => {
      const v = r[key];
      if (!Number.isFinite(v)) { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      open = true;
    });
    return d.trim();
  };

  // area wash under the value line
  const valid = rows.map((r, i) => ({ r, i })).filter(({ r }) => Number.isFinite(r.value));
  if (valid.length > 1) {
    const first = valid[0].i;
    const last = valid[valid.length - 1].i;
    svg.appendChild(el('path', { class: 'area', d: `${path('value')} L${x(last)},${y(0)} L${x(first)},${y(0)} Z` }));
  }
  if (rows.some((r) => Number.isFinite(r.ma))) svg.appendChild(el('path', { class: 'line ma', d: path('ma') }));
  svg.appendChild(el('path', { class: 'line', d: path('value') }));
  if (target) {
    svg.appendChild(el('line', { class: 'tgt', x1: m.l, x2: W - m.r, y1: y(target), y2: y(target) }));
  }
  valid.forEach(({ r, i }) => svg.appendChild(el('circle', { class: 'dot', cx: x(i), cy: y(r.value), r: 4 })));
  // end label
  const end = valid[valid.length - 1];
  svg.appendChild(el('text', { class: 'end-label', x: x(end.i) + 8, y: y(end.r.value) + 4, text: num(end.r.value, digits) }));

  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(pw / 56)));
  rows.forEach((r, i) => {
    if (i % labelEvery === 0 || n <= 8) svg.appendChild(el('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', text: r.label }));
  });

  // Hover: nearest point crosshair
  const tip = ensureTip(host);
  const cross = el('line', { class: 'axis', x1: 0, x2: 0, y1: m.t, y2: m.t + ph, opacity: 0 });
  svg.appendChild(cross);
  const hit = el('rect', { class: 'hit', x: m.l - 10, y: m.t, width: pw + 20, height: ph });
  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0; let bd = Infinity;
    rows.forEach((r, i) => { const d = Math.abs(x(i) - sx); if (d < bd) { bd = d; best = i; } });
    const r = rows[best];
    cross.setAttribute('x1', x(best)); cross.setAttribute('x2', x(best)); cross.setAttribute('opacity', 1);
    tip.innerHTML = `<div class="t">${esc(r.sub || r.label)}</div>
      <div class="r"><span><i class="tops"></i>${esc(valueLabel)}</span><b>${Number.isFinite(r.value) ? `${num(r.value, digits)} ${unit}` : '—'}</b></div>
      ${Number.isFinite(r.ma) ? `<div class="r"><span><i class="smalls"></i>${esc(maLabel)}</span><b>${num(r.ma, digits)} ${unit}</b></div>` : ''}
      ${target ? `<div class="r"><span><i class="tgt"></i>Target</span><b>${num(target, digits)} ${unit}</b></div>` : ''}
      ${r.note ? `<div class="n">${esc(r.note)}</div>` : ''}`;
    tip.classList.add('on');
    const hr = host.getBoundingClientRect();
    placeTip(host, tip, e.clientX - hr.left, e.clientY - hr.top);
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.classList.remove('on'); });
  svg.appendChild(hit);
  host.appendChild(svg);
}
