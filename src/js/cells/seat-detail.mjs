/**
 * A seat's day on the Cells board (Koa 2026-11-25: "click on each cell card and
 * view their hour-by-hour and key metrics"). Pure: the summary and the panel's
 * HTML from lineScaleSeat&detail=1 (the seat's hours, pickups and names) and the
 * line's lb per trimmer-hour (getProduction targetRate). Tested in
 * tests/cells-seat-detail.test.mjs.
 */
export const G_PER_LB = 453.59237;
export const SLOTS = [
  ['7-8', '7–8'], ['8-9', '8–9'], ['9-10', '9–10'], ['10-11', '10–11'], ['11-12', '11–12'],
  ['12-1', '12:30–1'], ['1-2', '1–2'], ['2-3', '2–3'], ['3-4', '3–4'], ['4-4:30', '4–4:30'],
];
const MIN_FOR_RATE = 5;   // fewer minutes seated than this: no lb/hr for the hour

const L = {
  en: {
    today: 'Today', pace: 'Pace', batches: 'Batches', best: 'Best hour', atGoal: 'Hours at goal',
    lb: 'lb', lbHr: 'lb/hr', hour: 'Hour', trimmer: 'Trimmer', cultivar: 'Cultivar', min: 'min', vsGoal: 'vs goal',
    avgBatch: 'avg {lb} lb · {m} min', noBatches: 'none yet', none: 'Nothing weighed at this seat today yet.',
    noName: '(no name)', goal: 'Goal {r} lb/hr', close: 'Close', of: '{a} of {b}', title: '{seat} · today',
  },
  es: {
    today: 'Hoy', pace: 'Ritmo', batches: 'Lotes', best: 'Mejor hora', atGoal: 'Horas en meta',
    lb: 'lb', lbHr: 'lb/h', hour: 'Hora', trimmer: 'Trimmer', cultivar: 'Variedad', min: 'min', vsGoal: 'vs meta',
    avgBatch: 'prom. {lb} lb · {m} min', noBatches: 'ninguno todavía', none: 'Todavía no se pesa nada en este puesto hoy.',
    noName: '(sin nombre)', goal: 'Meta {r} lb/h', close: 'Cerrar', of: '{a} de {b}', title: '{seat} · hoy',
  },
};
export const detailLabels = (lang) => L[lang === 'es' ? 'es' : 'en'];
const tf = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortCv = (c) => String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim();
const lbOf = (g) => Math.max(0, Number(g) || 0) / G_PER_LB;

/**
 * @param {Array<{slot,personId,cultivar,g,min}>} rows
 * @param {Array<{ts,g,cycleS,personId}>} pickups
 * @param {Object<string,string>} names
 * @param {number|null} rate  lb per trimmer-hour
 */
export function seatSummary(rows = [], pickups = [], names = {}, rate = null) {
  const hours = [];
  for (const [key, label] of SLOTS) {
    const mine = rows.filter((r) => r.slot === key);
    if (!mine.length) continue;
    const g = mine.reduce((a, r) => a + Math.max(0, Number(r.g) || 0), 0);
    const min = mine.reduce((a, r) => a + (Number(r.min) || 0), 0);
    if (!(g > 0) && !(min > 0)) continue;
    const people = [...new Set(mine.map((r) => (r.personId > 0 ? names[r.personId] || `#${r.personId}` : null)))];
    const cultivars = [...new Set(mine.filter((r) => (Number(r.g) || 0) > 0 || (Number(r.min) || 0) > 0).map((r) => shortCv(r.cultivar)).filter(Boolean))];
    const lbHr = min >= MIN_FOR_RATE ? lbOf(g) / (min / 60) : null;
    hours.push({ key, label, lb: lbOf(g), min, lbHr, pct: lbHr !== null && rate > 0 ? lbHr / rate : null, people, cultivars });
  }
  const totalLb = hours.reduce((a, h) => a + h.lb, 0);
  const named = rows.filter((r) => r.personId > 0);
  const namedMin = named.reduce((a, r) => a + (Number(r.min) || 0), 0);
  const pace = namedMin >= MIN_FOR_RATE ? named.reduce((a, r) => a + lbOf(r.g), 0) / (namedMin / 60) : null;
  const rated = hours.filter((h) => h.lbHr !== null);
  const best = rated.length ? rated.reduce((a, h) => (h.lbHr > a.lbHr ? h : a)) : null;
  const timed = pickups.filter((p) => p.cycleS > 0);
  return {
    hours,
    totalLb,
    pace,
    best,
    atGoal: rate > 0 ? { n: rated.filter((h) => h.pct >= 1).length, of: rated.length } : null,
    batches: {
      n: pickups.length,
      avgLb: pickups.length ? pickups.reduce((a, p) => a + lbOf(p.g), 0) / pickups.length : null,
      avgMin: timed.length ? timed.reduce((a, p) => a + p.cycleS, 0) / timed.length / 60 : null,
    },
    rate: rate > 0 ? rate : null,
  };
}

/** The panel's body. */
export function detailHtml(s, { lang, seat, current = null }) {
  const l = detailLabels(lang);
  const n2 = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
  const tiles = [
    [l.today, `${n2(s.totalLb)} ${l.lb}`, ''],
    [l.pace, s.pace === null ? '—' : `${n2(s.pace)} ${l.lbHr}`, s.rate ? tf(l.goal, { r: n2(s.rate) }) : ''],
    [l.batches, String(s.batches.n), s.batches.n ? tf(l.avgBatch, { lb: n2(s.batches.avgLb), m: s.batches.avgMin === null ? '—' : Math.round(s.batches.avgMin) }) : l.noBatches],
    [l.best, s.best ? `${n2(s.best.lbHr)} ${l.lbHr}` : '—', s.best ? s.best.label : ''],
    [l.atGoal, s.atGoal ? tf(l.of, { a: s.atGoal.n, b: s.atGoal.of }) : '—', ''],
  ];
  const head = `<div class="sd-tiles">${tiles.map(([k, v, sub]) => `<div class="sd-tile"><span>${esc(k)}</span><b>${esc(v)}</b><small>${esc(sub)}</small></div>`).join('')}</div>`;
  if (!s.hours.length) return `${head}<p class="sd-none">${esc(l.none)}</p>`;
  const rows = s.hours.map((h) => {
    const pct = h.pct === null ? 0 : Math.min(1, h.pct);
    const cls = h.pct === null ? '' : h.pct >= 1 ? 'met' : 'short';
    return `<tr class="${h.key === current ? 'now' : ''}">
      <td class="h">${esc(h.label)}</td>
      <td>${h.people.map((p) => (p === null ? `<i>${esc(l.noName)}</i>` : esc(p))).join(', ')}</td>
      <td>${esc(h.cultivars.join(', ')) || '—'}</td>
      <td class="n">${n2(h.lb)}</td>
      <td class="n">${Math.round(h.min)}</td>
      <td class="n">${h.lbHr === null ? '—' : n2(h.lbHr)}</td>
      <td class="g"><div class="sd-bar ${cls}"><i style="width:${Math.round(pct * 100)}%"></i></div><small>${h.pct === null ? '' : `${Math.round(h.pct * 100)}%`}</small></td>
    </tr>`;
  }).join('');
  return `${head}
    <table class="sd-table"><thead><tr><th>${esc(l.hour)}</th><th>${esc(l.trimmer)}</th><th>${esc(l.cultivar)}</th>
      <th class="n">${esc(l.lb)}</th><th class="n">${esc(l.min)}</th><th class="n">${esc(l.lbHr)}</th><th>${esc(l.vsGoal)}</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
