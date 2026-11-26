/**
 * The trim line from above, for the Cells board (Koa 2026-11-25: "a top down view
 * of what the actual floor plan looks like"). 16 trim tables in a staggered
 * zigzag (Koa's sketch): 1 top-left, 2 below it half a step right, 3 top, 4
 * below, and so on. Each table is drawn in the shape of the real one (overhead
 * photos, raw/trim-room/2026-10-20-trim-table-top*.jpg): rounded far end, the
 * trimmer's flat side with the round cutting pan. Narrow ends point to the
 * middle of the line, trimmer sides out. The pan is the progress ring: this
 * hour's tops toward the hour goal, gold while working, green once met.
 * Pure (no DOM), so it is unit-tested (tests/cells-floor.test.mjs).
 */
import { stationAt } from '../cell/seats.mjs';

export const SEATS = 16;
export const G_PER_LB = 453.59237;
const PITCH = 132;          // one table to the next in the same row
const TOP_Y = 46, BOTTOM_Y = 196, X0 = 70;
const W = 104, H = 124;     // a table's footprint
export const VIEW = { w: X0 * 2 + PITCH * (SEATS / 2 - 0.5) + 10, h: 400 };
// Working minutes per hour (breaks out), as the seat screen's goal.
const SLOT_MIN = { '7-8': 60, '8-9': 60, '9-10': 50, '10-11': 60, '11-12': 60, '12-1': 30, '1-2': 60, '2-3': 50, '3-4': 60, '4-4:30': 30 };

/** Where seat n sits: odd seats on the top row, even ones below, half a step right. */
export function seatXY(n) {
  const top = n % 2 === 1;
  return { x: X0 + (n - 1) * (PITCH / 2), y: top ? TOP_Y : BOTTOM_Y, top };
}

// The table, outline in a 104 x 124 box with the trimmer's side at the bottom (y = 124).
const TABLE = 'M12 122 C4 122 0 112 3 102 L15 42 C19 18 33 4 52 4 C71 4 85 18 89 42 L101 102 C104 112 100 122 92 122'
  + ' C80 124 72 115 62 117 C57 119 47 119 42 117 C32 115 24 124 12 122 Z';
const PAN = { cx: 52, cy: 94, r: 17 };

/**
 * One model per seat.
 * @param {Array} cells        cellBoard cells (stationId, job, scale)
 * @param {Array} slotRows     lineScaleHours rows for the current hour: [{ stationId, personId, name, g, min }]
 * @param {Object} lastNames   stationId -> the name seen most recently today (for a seat idle this hour)
 * @param {number|null} rate   lb per trimmer-hour
 * @param {string} slot        the current hour key
 */
export function floorModel(cells = [], slotRows = [], lastNames = {}, rate = null, slot = '') {
  const goalG = rate > 0 && SLOT_MIN[slot] ? rate * G_PER_LB * SLOT_MIN[slot] / 60 : null;
  const seats = [];
  for (let n = 1; n <= SEATS; n++) {
    const id = stationAt(n);   // the scale station at this seat (seats.mjs: table1 is at seat 2)
    const c = cells.find((x) => x.stationId === id) || null;
    const mine = slotRows.filter((r) => r.stationId === id);
    const g = mine.reduce((a, r) => a + Math.max(0, Number(r.g) || 0), 0);
    const who = mine.filter((r) => r.personId > 0).sort((a, b) => (b.min || 0) - (a.min || 0))[0];
    const j = c && c.job;
    const scale = c && c.scale;
    let state = 'empty';
    if (scale && j && j.tabletOnline) {
      if (!scale.live && j.phase !== 'finished') state = 'down';
      else if (j.phase === 'finished') state = 'ready';
      else if (j.phase === 'running') state = 'filling';
      else state = 'waiting';
    } else if (scale) state = scale.live ? 'noTablet' : 'down';
    seats.push({
      n, stationId: id, ...seatXY(n), state,
      name: who ? who.name || null : (lastNames[id] || null),
      hourLb: g / G_PER_LB,
      frac: goalG ? Math.min(1, g / goalG) : 0,
      met: !!goalG && g >= goalG,
      weightG: scale && scale.live && scale.weightG != null ? scale.weightG : null,
    });
  }
  return { seats, goalLb: goalG ? goalG / G_PER_LB : null };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = {
  en: { seat: 'Seat', noScale: 'no scale', ready: 'Ready for pickup', down: 'Scale down', line: 'Trim line', goal: 'Goal this hour {lb} lb' },
  es: { seat: 'Puesto', noScale: 'sin báscula', ready: 'Lista para recoger', down: 'Báscula caída', line: 'Línea de trimeo', goal: 'Meta esta hora {lb} lb' },
};

/** The floor as one SVG. Each table is a <g data-station> the board makes tappable. */
export function floorSvg(model, { lang = 'en' } = {}) {
  const l = L[lang === 'es' ? 'es' : 'en'];
  const ringLen = 2 * Math.PI * PAN.r;
  const parts = model.seats.map((s) => {
    // Top-row tables are flipped: narrow end down to the middle of the line, trimmer side up.
    const tx = s.x - W / 2, ty = s.top ? s.y + H : s.y;
    const flip = s.top ? `translate(${tx} ${ty}) scale(1 -1)` : `translate(${tx} ${ty})`;
    const pan = s.top ? { x: s.x, y: s.y + H - PAN.cy } : { x: s.x, y: s.y + PAN.cy };
    const numY = s.top ? s.y + 80 : s.y + 66;
    const textY = s.top ? s.y - 14 : s.y + H + 26;
    const sub = s.state === 'ready' ? l.ready : s.state === 'down' ? l.down : s.state === 'empty' ? l.noScale : `${s.hourLb.toFixed(2)} lb`;
    const name = s.name ? esc(s.name.split(' ')[0]) : '';
    return `<g class="seat ${s.state}${s.met ? ' met' : ''}" data-station="${s.stationId}" data-n="${s.n}" tabindex="0" role="button" aria-label="${esc(l.seat)} ${s.n}">
      <path class="tbl" d="${TABLE}" transform="${flip}"/>
      <circle class="pan-bg" cx="${pan.x}" cy="${pan.y}" r="${PAN.r}"/>
      <circle class="pan" cx="${pan.x}" cy="${pan.y}" r="${PAN.r}" stroke-dasharray="${ringLen.toFixed(1)}"
        stroke-dashoffset="${(ringLen * (1 - s.frac)).toFixed(1)}" transform="rotate(-90 ${pan.x} ${pan.y})"/>
      <text class="num" x="${s.x}" y="${numY}">${s.n}</text>
      <text class="who" x="${s.x}" y="${s.top ? textY - 18 : textY}">${name}</text>
      <text class="sub" x="${s.x}" y="${s.top ? textY : textY + 18}">${esc(sub)}</text>
    </g>`;
  }).join('');
  const mid = (TOP_Y + H + BOTTOM_Y) / 2;
  const goal = model.goalLb ? `<text class="goal" x="${VIEW.w - 12}" y="${VIEW.h - 10}">${esc(l.goal.replace('{lb}', model.goalLb.toFixed(2)))}</text>` : '';
  return `<svg class="floor-svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" role="img" aria-label="${esc(l.line)}">
    <line class="aisle" x1="20" y1="${mid}" x2="${VIEW.w - 20}" y2="${mid}"/>
    ${parts}${goal}
  </svg>`;
}
