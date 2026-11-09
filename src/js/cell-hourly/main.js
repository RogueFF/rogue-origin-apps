/**
 * Cell hourly log: hour-by-hour tops per cell, plus one shared smalls number per
 * hour for the room. Used until every table has a live scale; the rows are keyed
 * (date, slot, station) like the scale rollup will write them (Koa 2026-11-09).
 * Quality is by batch, not by hour: each cell starts the day at batch 1, and
 * once a batch's four checks are scored the next check is the next batch.
 *
 *   cell-hourly.html            today, the current hour
 *   cell-hourly.html?date=...   another day
 *   cell-hourly.html?view=quality   the quality view: scores only, no weights
 *
 * Every field saves on its own as soon as it changes, and the save state shows
 * on screen. A failed save stays queued and retries; nothing is lost silently.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { buildCultivarOptions } from '../hourly-entry/cultivar-options.mjs';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const BAG_NET_LB = 5090.72 / 453.59237; // 5 kg bag, net fill standard (fill-weight-standards)
const CONFIRM_OVER_LB = 5;              // a cell-hour is a few lb; more is probably grams typed as lb
const REFRESH_MS = 30000;
const RETRY_MS = 10000;

registerLabels({
  en: {
    title: 'Cell hourly log', roomCultivar: 'Cultivar this hour', roomSmalls: 'Smalls, whole room (lb)',
    wholesaleToday: 'Wholesale tops today', bagsFull: '5 kg bags', nextBag: 'Next 5 kg bag',
    edit: 'Edit', nameLabel: 'Name or label', wholesale: 'Wholesale', retail: 'Retail', save: 'Save', cancel: 'Cancel',
    removeCell: 'Remove cell', topsLabel: 'Tops this hour', quality: 'Quality checks: score each one 1 to 4',
    chkTrim: 'Trim job', chkStems: 'Stems cut right', chkMold: 'No mold', chkInsects: 'No insects',
    notes: 'Notes', viewWeights: 'Weights', viewQuality: 'Quality', checkedBy: 'Checked by (initials)',
    overallPass: 'Pass: every check 3 or 4', overallRedo: "Redo: this batch's tops go back to the cell",
    stopAlert: 'STOP: mold or insects in the tops. Set the basket aside and call the lead.',
    batch: 'Batch {n}', startBatch: 'Start batch {n}', batchesChecked: '{n} batches checked today',
    cellCultivar: 'Cultivar at this cell', jump: 'All cells this hour', jumpToday: 'All cells today', addCell: '+ Add cell',
    saving: 'Saving…', saved: 'Saved', notSaved: 'Not saved: no connection. It will retry.', perHour: 'lb/hr',
    confirmBig: 'That is {lb} lb in one hour. Keep it?', confirmRemove: 'Remove {name}? Its saved hours stay.',
    entered: 'entered', sameAsRoom: 'Same as the room', none: '—', loadFail: 'Could not load. Check the connection.',
    hourTotal: 'Tops this hour, all cells', scaleAuto: 'From the scale', soFar: 'so far · locks at the end of the hour',
    finalVal: 'final', typedOverride: 'Typed (overrides the scale)', overrideNote: 'Manual override: the typed value counts.',
    differ: 'Typed and scale differ by {pct}%', partsTyped: '{n} typed', partsScale: '{n} from scale',
    tareFlag: "The scale's TARE was pressed mid-job this hour: check it",
  },
  es: {
    title: 'Registro por hora de celdas', roomCultivar: 'Variedad de esta hora', roomSmalls: 'Smalls, todo el cuarto (lb)',
    wholesaleToday: 'Tops de mayoreo hoy', bagsFull: 'Bolsas de 5 kg', nextBag: 'Siguiente bolsa de 5 kg',
    edit: 'Editar', nameLabel: 'Nombre o etiqueta', wholesale: 'Mayoreo', retail: 'Menudeo', save: 'Guardar', cancel: 'Cancelar',
    removeCell: 'Quitar celda', topsLabel: 'Tops de esta hora', quality: 'Revisión de calidad: califique cada una del 1 al 4',
    chkTrim: 'Recorte', chkStems: 'Tallos bien cortados', chkMold: 'Sin moho', chkInsects: 'Sin insectos',
    notes: 'Notas', viewWeights: 'Pesos', viewQuality: 'Calidad', checkedBy: 'Revisó (iniciales)',
    overallPass: 'Pasa: todas en 3 o 4', overallRedo: 'Rehacer: los tops de este lote regresan a la celda',
    stopAlert: 'PARE: moho o insectos en los tops. Aparte la canasta y llame al líder.',
    batch: 'Lote {n}', startBatch: 'Empezar lote {n}', batchesChecked: '{n} lotes revisados hoy',
    cellCultivar: 'Variedad en esta celda', jump: 'Todas las celdas esta hora', jumpToday: 'Todas las celdas hoy', addCell: '+ Agregar celda',
    saving: 'Guardando…', saved: 'Guardado', notSaved: 'No se guardó: sin conexión. Se reintentará.', perHour: 'lb/h',
    confirmBig: 'Son {lb} lb en una hora. ¿Lo deja así?', confirmRemove: '¿Quitar {name}? Sus horas guardadas se quedan.',
    entered: 'llenas', sameAsRoom: 'Igual que el cuarto', none: '—', loadFail: 'No cargó. Revise la conexión.',
    hourTotal: 'Tops esta hora, todas las celdas', scaleAuto: 'De la báscula', soFar: 'hasta ahora · se fija al terminar la hora',
    finalVal: 'final', typedOverride: 'Escrito (reemplaza a la báscula)', overrideNote: 'Reemplazo manual: cuenta el valor escrito.',
    differ: 'Lo escrito y la báscula difieren {pct}%', partsTyped: '{n} escritas', partsScale: '{n} de báscula',
    tareFlag: 'Se presionó TARA en la báscula a mitad del trabajo esta hora: revíselo',
  },
});
const tf = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k]);

const params = new URLSearchParams(location.search);
// Local testing only: ?api=http://localhost:8799/api. Never another host.
const apiParam = params.get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;

function pacificToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const DATE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : pacificToday().day;

async function api(method, action, body, query = {}) {
  const url = new URL(`${ROOT}/production`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, method === 'GET'
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

const $ = id => document.getElementById(id);
const el = {
  date: $('dateText'), lang: $('langToggle'), hours: $('hourBar'),
  roomCultivar: $('roomCultivar'), roomSmalls: $('roomSmalls'), roomStatus: $('roomStatus'),
  wsTotal: $('wsTotal'), wsBags: $('wsBags'), wsBar: $('wsBar'), wsNext: $('wsNext'),
  prev: $('prevBtn'), next: $('nextBtn'), label: $('cellLabel'), cellId: $('cellId'), lane: $('cellLane'),
  editBtn: $('editBtn'), editBox: $('editBox'), editLabel: $('editLabel'), laneW: $('laneWholesale'), laneR: $('laneRetail'),
  editSave: $('editSave'), editCancel: $('editCancel'), remove: $('removeBtn'),
  tops: $('tops'), topsLabel: $('topsLabel'), rate: $('rate'), autoBox: $('autoBox'), autoVal: $('autoVal'), autoState: $('autoState'),
  overrideNote: $('overrideNote'), diffFlag: $('diffFlag'), tareFlag: $('tareFlag'), hourTotal: $('hourTotal'), hourTotalParts: $('hourTotalParts'), checks: $('checks'), qOverall: $('qOverall'), stopAlert: $('stopAlert'), checkedBy: $('checkedBy'),
  batchTitle: $('batchTitle'), batchHistory: $('batchHistory'), nextBatch: $('nextBatchBtn'), gridTitle: $('gridTitle'),
  tabWeights: $('tabWeights'), tabQuality: $('tabQuality'),
  notes: $('notes'), cellCultivar: $('cellCultivar'), cellStatus: $('cellStatus'),
  grid: $('jumpGrid'), doneCount: $('doneCount'), add: $('addBtn'),
};

const state = {
  slots: [], roster: [], rows: new Map(), room: new Map(), auto: new Map(),
  batches: new Map(),   // `${station}|${batch}` -> the batch's scores, notes, initials
  shownBatch: new Map(), // station -> the batch on screen; picked when the cell opens
  slot: null, cellIdx: 0, cultivars: [], editLane: 'wholesale',
  view: ['weights', 'quality'].includes(params.get('view')) ? params.get('view') : (readView() || 'weights'),
};
// Two views on one page: weights, and quality with no pounds on screen (Koa
// 2026-11-09: quality without the crew watching weight). Remembered per tablet.
function readView() { try { return localStorage.getItem('ro-cell-hourly:view'); } catch { return null; } }
function setView(v) {
  state.view = v;
  document.body.dataset.view = v;
  el.tabWeights.classList.toggle('on', v === 'weights');
  el.tabQuality.classList.toggle('on', v === 'quality');
  try { localStorage.setItem('ro-cell-hourly:view', v); } catch { /* per visit only */ }
}
const rowKey = (slot, station) => `${slot}|${station}`;
const cells = () => state.roster.filter(c => c.active);
const cell = () => cells()[Math.min(state.cellIdx, cells().length - 1)];
const row = (station = cell()?.stationId, slot = state.slot) => state.rows.get(rowKey(slot, station)) || {};
const fmtLb = n => `${(Number(n) || 0).toFixed(2)} lb`;
const DIFF_FLAG = 0.10;   // typed vs scale more than 10% apart gets flagged
// Scale value for a cell-hour (computed by the Worker from its readings), if any.
const autoOf = (station = cell()?.stationId, slot = state.slot) => state.auto.get(rowKey(slot, station));
const hasScale = station => [...state.auto.values()].some(a => a.stationId === station);
// What counts: a typed value wins; otherwise the scale's.
function eff(station = cell()?.stationId, slot = state.slot) {
  const typed = row(station, slot).tops;
  if (typed != null) return typed;
  const a = autoOf(station, slot);
  return a ? a.tops : null;
}

// ---- save queue: one entry per (target, field); the newest value wins ----
const queue = new Map();   // key -> { kind, payload, scope }
let flushing = false;
function enqueue(kind, payload, field, scope) {
  queue.set(`${kind}|${payload.slot ?? `b${payload.batch}`}|${payload.stationId || 'room'}|${field}`, { kind, payload, scope });
  renderStatus();
  flush();
}
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (const [key, item] of [...queue]) {
      try {
        await api('POST', item.kind, { date: DATE, ...item.payload });
        if (queue.get(key) === item) queue.delete(key);
        item.failed = false;
      } catch (e) {
        item.failed = true;
        if (e.status === 400) queue.delete(key); // refused input: retrying cannot help
      }
    }
  } finally {
    flushing = false;
    renderStatus();
  }
}
setInterval(() => { if (queue.size) flush(); }, RETRY_MS);
window.addEventListener('online', flush);
function statusFor(scope) {
  const mine = [...queue.values()].filter(i => i.scope === scope);
  if (!mine.length) return { cls: 'ok', text: `✓ ${t('saved')}` };
  if (mine.some(i => i.failed)) return { cls: 'bad', text: `✕ ${t('notSaved')}` };
  return { cls: 'busy', text: t('saving') };
}
function renderStatus() {
  const c = cell();
  const s = c ? statusFor(state.view === 'quality' ? qScope(c.stationId) : `${state.slot}|${c.stationId}`) : null;
  if (s) { el.cellStatus.className = `save-status ${s.cls}`; el.cellStatus.textContent = s.text; }
  const r = statusFor(`${state.slot}|room`);
  el.roomStatus.className = `save-status ${r.cls}`; el.roomStatus.textContent = r.text;
}
const pending = (slot, station, field) => queue.has(`setCellHourly|${slot}|${station}|${field}`);
const qPending = (station, batch, field) => queue.has(`setCellQuality|b${batch}|${station}|${field}`);

// ---- local edits (optimistic) ----
// The four quality checks, each scored 1-4 (Koa 2026-11-09: "3-4 is passing
// quality, 1-2 is needing to be redone"). The overall result follows the same
// rule the Worker applies: any 1 or 2 = redo ('fail'), all four 3 or 4 = pass.
// Wording matches the paper quality sheet (scripts/throughput-test-pdf.py --test q).
const CHECKS = [['qTrim', 'chkTrim'], ['qStems', 'chkStems'], ['qMold', 'chkMold'], ['qInsects', 'chkInsects']];
const SEEN = {
  en: ['', 'In the tops: stop, call the lead', 'Found some: pick through it again', 'Checked a spot, it was fine', 'None seen'],
  es: ['', 'En los tops: pare, llame al líder', 'Encontré algo: revíselo otra vez', 'Revisé un punto, estaba bien', 'No se ve nada'],
};
const SCORE_WORDS = {
  en: {
    qTrim: ['', 'Rough or untrimmed: redo it', 'Lots of leaf or uneven: touch it up', 'A few leaves sticking out', 'Clean and even all the way round'],
    qStems: ['', 'Stems left on most buds', 'Lots of long stems: recut', 'A few stems a little long', 'Every stem cut flush'],
    qMold: SEEN.en, qInsects: SEEN.en,
  },
  es: {
    qTrim: ['', 'Sin recortar o muy mal: repítalo', 'Mucha hoja o disparejo: retóquelo', 'Unas hojitas salidas', 'Limpio y parejo por todos lados'],
    qStems: ['', 'Tallos en casi todos los cogollos', 'Muchos tallos largos: córtelos', 'Unos tallos un poco largos', 'Todos los tallos cortados al ras'],
    qMold: SEEN.es, qInsects: SEEN.es,
  },
};
function overall(checks = {}) {
  const v = CHECKS.map(([k]) => checks[k]);
  if (v.some(x => x != null && x <= 2)) return 'fail';
  return v.every(x => x != null && x >= 3) ? 'pass' : null;
}
const stopFor = (checks = {}) => checks.qMold === 1 || checks.qInsects === 1;
const scoredAll = b => CHECKS.every(([k]) => (b?.checks || {})[k] != null);

// ---- quality batches ----
const batchKey = (station, n) => `${station}|${n}`;
const batchesFor = station => [...state.batches.values()].filter(b => b.stationId === station).sort((a, b) => a.batch - b.batch);
// The batch to show when a cell opens: the latest one still being scored, or
// the next number once the latest has all four scores (batch 1 to start the day).
function pickBatch(station) {
  const list = batchesFor(station);
  const last = list[list.length - 1];
  if (!last) return 1;
  return scoredAll(last) ? last.batch + 1 : last.batch;
}
// Held fixed while the cell stays open (refreshes, edits), so a finished
// batch's result stays on screen until the checker moves on.
function shownBatch(station = cell()?.stationId) {
  if (!state.shownBatch.has(station)) state.shownBatch.set(station, pickBatch(station));
  return state.shownBatch.get(station);
}
const qb = (station = cell()?.stationId) => state.batches.get(batchKey(station, shownBatch(station))) || {};
const qScope = station => `q|${station}|${shownBatch(station)}`;
function openCell(i) {
  state.cellIdx = i;
  const c = cell(); if (c) state.shownBatch.delete(c.stationId);
}
// The checker's initials, remembered on this tablet for the next batch.
function lastInitials() { try { return localStorage.getItem('ro-cell-hourly:initials') || ''; } catch { return ''; } }
function rememberInitials(v) { try { if (v) localStorage.setItem('ro-cell-hourly:initials', v); } catch { /* per visit only */ } }
function nowSlot() { return state.slots.length ? state.slots[currentSlotIndex()].slot : state.slot; }
function setQualityField(field, value) {
  const c = cell(); if (!c) return;
  const n = shownBatch(c.stationId);
  const key = batchKey(c.stationId, n);
  const prev = state.batches.get(key) || { stationId: c.stationId, batch: n, checks: {} };
  const isCheck = CHECKS.some(([k]) => k === field);
  const b = isCheck ? { ...prev, checks: { ...(prev.checks || {}), [field]: value } } : { ...prev, [field]: value };
  b.quality = overall(b.checks);
  const save = (f, v) => enqueue('setCellQuality', { stationId: c.stationId, batch: n, [f]: v }, f, qScope(c.stationId));
  save(field, value);
  // A new batch takes the cultivar at the cell right now, and this tablet's initials.
  if (!prev.updatedAt && !prev.cultivar) {
    const slot = DATE === pacificToday().day ? nowSlot() : state.slot;
    const cv = row(c.stationId, slot).cultivar || roomCultivar(slot);
    if (cv) { b.cultivar = cv; save('cultivar', cv); }
  }
  if (field !== 'checkedBy' && !b.checkedBy && lastInitials()) { b.checkedBy = lastInitials(); save('checkedBy', b.checkedBy); }
  b.updatedAt = b.updatedAt || 'local';
  state.batches.set(key, b);
  renderGrid();
}

function setCellField(field, value) {
  const c = cell(); if (!c) return;
  const key = rowKey(state.slot, c.stationId);
  const prev = state.rows.get(key) || {};
  const r = { ...prev, stationId: c.stationId, slot: state.slot, [field]: value };
  state.rows.set(key, r);
  const payload = { slot: state.slot, stationId: c.stationId, [field]: value };
  // A row's cultivar defaults to the room's: stamp it with the first weight.
  if (field === 'tops' && !r.cultivar && roomCultivar()) {
    r.cultivar = roomCultivar(); payload.cultivar = r.cultivar;
  }
  enqueue('setCellHourly', payload, field, `${state.slot}|${c.stationId}`);
  renderGrid(); renderBag();
}
const roomCultivar = (slot = state.slot) => state.room.get(slot)?.cultivar || '';

// One block per check: four score buttons, 1 to 4; tap the lit one again to
// clear it. What the chosen score means shows under it.
function renderChecks(r) {
  el.checks.innerHTML = '';
  for (const [key, label] of CHECKS) {
    const v = (r.checks || {})[key] ?? null;
    const block = document.createElement('div');
    block.className = 'check';
    const name = document.createElement('span');
    name.className = 'check-name'; name.textContent = t(label);
    const scores = document.createElement('div');
    scores.className = 'scores';
    for (const n of [1, 2, 3, 4]) {
      const b = document.createElement('button');
      b.className = 'btn score' + (v === n ? ` on ${n >= 3 ? 'ok' : 'redo'}` : '');
      b.textContent = String(n);
      b.addEventListener('click', () => { setQualityField(key, v === n ? null : n); renderCell(); });
      scores.appendChild(b);
    }
    const desc = document.createElement('div');
    desc.className = 'score-desc';
    desc.textContent = v ? `${v} · ${SCORE_WORDS[getLang() === 'es' ? 'es' : 'en'][key][v]}` : '';
    block.append(name, scores, desc);
    el.checks.appendChild(block);
  }
  const o = overall(r.checks);
  el.qOverall.className = 'overall' + (o === 'pass' ? ' pass' : o === 'fail' ? ' redo' : '');
  el.qOverall.textContent = o === 'pass' ? t('overallPass') : o === 'fail' ? t('overallRedo') : '';
}

// Batch number, today's batches at this cell (tap one to fix a typo), and a
// button to start the next batch once this one has all four scores.
function renderBatch(station) {
  const n = shownBatch(station);
  const b = qb(station);
  el.batchTitle.textContent = tf('batch', { n });
  el.batchHistory.innerHTML = '';
  const list = batchesFor(station);
  // Today's batches, the one on screen, and the one a new visit would open.
  const nums = [...new Set([...list.map(x => x.batch), n, pickBatch(station)])].sort((a, c) => a - c);
  if (nums.length > 1) {
    for (const k of nums) {
      const x = state.batches.get(batchKey(station, k));
      const chip = document.createElement('button');
      const q = x ? overall(x.checks) : null;
      chip.className = 'bchip' + (q ? ` ${q}` : '') + (k === n ? ' on' : '');
      chip.textContent = `${k} ${q === 'pass' ? '✓' : q === 'fail' ? '✕' : '…'}`;
      chip.addEventListener('click', () => { state.shownBatch.set(station, k); renderCell(); });
      el.batchHistory.appendChild(chip);
    }
  }
  const latest = Math.max(n, ...list.map(x => x.batch));
  el.nextBatch.hidden = !(scoredAll(b) && n === latest);
  el.nextBatch.textContent = tf('startBatch', { n: latest + 1 });
  el.stopAlert.hidden = !stopFor(b.checks);
  if (document.activeElement !== el.notes) el.notes.value = b.notes ?? '';
  if (document.activeElement !== el.checkedBy) el.checkedBy.value = b.checkedBy ?? lastInitials();
}

// ---- rendering ----
function currentSlotIndex() {
  const now = pacificToday().minutes;
  const toMin = s => { const m = s.match(/(\d{1,2}):(\d{2}) (AM|PM)/); let h = +m[1] % 12; if (m[3] === 'PM') h += 12; return h * 60 + +m[2]; };
  let idx = 0;
  state.slots.forEach((s, i) => { if (toMin(s.slot) <= now) idx = i; });
  return idx;
}
function renderHours() {
  el.hours.innerHTML = '';
  const nowIdx = DATE === pacificToday().day ? currentSlotIndex() : -1;
  state.slots.forEach((s, i) => {
    const b = document.createElement('button');
    const done = cells().filter(c => eff(c.stationId, s.slot) != null).length;
    b.className = 'hour-chip' + (s.slot === state.slot ? ' on' : '') + (i === nowIdx ? ' now' : '');
    b.innerHTML = `<span>${s.slot.replace(/:00/g, '').replace(' – ', '–')}</span><small>${done}/${cells().length}</small>`;
    b.addEventListener('click', () => { state.slot = s.slot; renderAll(); });
    el.hours.appendChild(b);
  });
}
function fillCultivars(select, value, withRoomDefault) {
  const opts = [...state.cultivars];
  if (value && !opts.includes(value)) opts.unshift(value);
  select.innerHTML = '';
  const first = document.createElement('option');
  first.value = ''; first.textContent = withRoomDefault ? `${t('sameAsRoom')}${roomCultivar() ? ` (${roomCultivar()})` : ''}` : t('none');
  select.appendChild(first);
  for (const c of opts) { const o = document.createElement('option'); o.value = c; o.textContent = c; select.appendChild(o); }
  select.value = value || '';
}
function renderRoom() {
  const r = state.room.get(state.slot) || {};
  fillCultivars(el.roomCultivar, r.cultivar || '', false);
  if (document.activeElement !== el.roomSmalls) el.roomSmalls.value = r.smalls ?? '';
}
function renderBag() {
  const ws = new Set(state.roster.filter(c => c.lane === 'wholesale').map(c => c.stationId));
  let total = 0;
  for (const c of state.roster) {
    if (!ws.has(c.stationId)) continue;
    for (const s of state.slots) total += Number(eff(c.stationId, s.slot)) || 0;
  }
  // The room's hour: every active cell, typed or from its scale.
  let hour = 0, typedN = 0, scaleN = 0;
  for (const c of cells()) {
    const v = eff(c.stationId); if (v == null) continue;
    hour += Number(v) || 0;
    if (row(c.stationId).tops != null) typedN++; else scaleN++;
  }
  el.hourTotal.textContent = fmtLb(hour);
  el.hourTotalParts.textContent = `(${tf('partsTyped', { n: typedN })}${scaleN ? `, ${tf('partsScale', { n: scaleN })}` : ''})`;
  const bags = Math.floor(total / BAG_NET_LB);
  const into = total - bags * BAG_NET_LB;
  el.wsTotal.textContent = fmtLb(total);
  el.wsBags.textContent = String(bags);
  el.wsBar.style.width = `${Math.round((into / BAG_NET_LB) * 100)}%`;
  el.wsNext.textContent = `${t('nextBag')}: ${fmtLb(into)} / ${fmtLb(BAG_NET_LB)}`;
}
function renderCell() {
  const c = cell();
  if (!c) return;
  const r = row();
  el.label.textContent = c.label;
  el.cellId.textContent = c.stationId;
  el.lane.textContent = t(c.lane);
  el.lane.className = `lane ${c.lane}`;
  if (document.activeElement !== el.tops) el.tops.value = r.tops ?? '';
  const hours = state.slots.find(s => s.slot === state.slot)?.hours || 1;
  const v = eff();
  el.rate.textContent = v != null ? `${(v / hours).toFixed(2)} ${t('perHour')} (${hours} h)` : '';
  const a = autoOf();
  const scaled = hasScale(c.stationId);
  el.topsLabel.textContent = scaled ? t('typedOverride') : t('topsLabel');
  el.autoBox.hidden = !a;
  if (a) {
    el.autoVal.textContent = fmtLb(a.tops);
    el.autoState.textContent = a.final ? t('finalVal') : t('soFar');
    const typed = r.tops;
    el.overrideNote.hidden = typed == null;
    el.overrideNote.textContent = t('overrideNote');
    const off = typed != null && a.tops > 0 ? Math.abs(typed - a.tops) / a.tops : 0;
    el.diffFlag.hidden = !(off > DIFF_FLAG);
    el.diffFlag.textContent = tf('differ', { pct: Math.round(off * 100) });
    el.tareFlag.hidden = a.flag !== 'scaleTared';
  }
  renderChecks(qb(c.stationId));
  renderBatch(c.stationId);
  fillCultivars(el.cellCultivar, r.cultivar && r.cultivar !== roomCultivar() ? r.cultivar : '', true);
  el.editBox.hidden = true;
  renderStatus();
}
function renderGrid() {
  el.grid.innerHTML = '';
  const list = cells();
  let done = 0;
  const quality = state.view === 'quality';
  let checked = 0;
  list.forEach((c, i) => {
    // Weights view: green once tops are in. Quality view: the cell's latest
    // fully scored batch, green = pass, red = redo.
    const scored = batchesFor(c.stationId).filter(scoredAll);
    checked += scored.length;
    const last = scored[scored.length - 1];
    const has = quality ? last?.quality === 'pass' : eff(c.stationId) != null;
    if (has) done++;
    const b = document.createElement('button');
    b.className = 'jump' + (has ? ' done' : '') + (quality && last?.quality === 'fail' ? ' failq' : '')
      + (i === state.cellIdx ? ' current' : '') + (c.lane === 'retail' ? ' retail' : '') + (hasScale(c.stationId) ? ' scale' : '');
    b.innerHTML = `<b>${c.stationId.replace(/^table/, '')}</b>`;
    b.appendChild(document.createTextNode(c.label));
    if (quality && scored.length) { const s = document.createElement('small'); s.textContent = `× ${scored.length}`; b.appendChild(s); }
    b.title = c.label;
    b.addEventListener('click', () => { openCell(i); renderCell(); renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.grid.appendChild(b);
  });
  el.gridTitle.textContent = t(quality ? 'jumpToday' : 'jump');
  el.doneCount.textContent = quality ? tf('batchesChecked', { n: checked }) : `${done}/${list.length} ${t('entered')}`;
  renderHours();
}
function renderAll() { renderRoom(); renderCell(); renderGrid(); renderBag(); }

// ---- load ----
async function load() {
  const d = await api('GET', 'cellHourly', null, { date: DATE });
  state.slots = d.slots; state.roster = d.roster;
  state.auto = new Map((d.auto || []).map(a => [rowKey(a.slot, a.stationId), a]));
  for (const r of d.rows) {
    const key = rowKey(r.slot, r.stationId);
    const local = state.rows.get(key) || {};
    const merged = { ...r };
    // Keep this tablet's unsaved edits over what the server had.
    for (const f of ['tops', 'notes', 'cultivar']) if (pending(r.slot, r.stationId, f)) merged[f] = local[f];
    state.rows.set(key, merged);
  }
  for (const b of d.batches || []) {
    const key = batchKey(b.stationId, b.batch);
    const local = state.batches.get(key) || {};
    const merged = { ...b, checks: { ...(b.checks || {}) } };
    // Keep this tablet's unsaved scores over what the server had.
    for (const f of ['notes', 'checkedBy', 'cultivar']) if (qPending(b.stationId, b.batch, f)) merged[f] = local[f];
    for (const [k] of CHECKS) if (qPending(b.stationId, b.batch, k)) merged.checks[k] = (local.checks || {})[k] ?? null;
    merged.quality = overall(merged.checks);
    state.batches.set(key, merged);
  }
  for (const r of d.room) {
    const local = state.room.get(r.slot) || {};
    state.room.set(r.slot, {
      ...r,
      ...(queue.has(`setRoomSmalls|${r.slot}|room|smalls`) ? { smalls: local.smalls } : {}),
      ...(queue.has(`setRoomSmalls|${r.slot}|room|cultivar`) ? { cultivar: local.cultivar } : {}),
    });
  }
  if (!state.slot) state.slot = state.slots[DATE === pacificToday().day ? currentSlotIndex() : 0].slot;
  if (state.cellIdx >= cells().length) state.cellIdx = 0;
}
async function loadCultivars() {
  let history = [];
  try { history = (await api('GET', 'getCultivars')).cultivars || []; } catch { /* the list just stays short */ }
  state.cultivars = buildCultivarOptions(history, []);
  try {
    const res = await fetch(`${ROOT}/pool?action=get_supersack_variants`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    });
    const v = await res.json();
    state.cultivars = buildCultivarOptions(history, (v.data || v).variants || []);
  } catch { /* history only */ }
  renderRoom(); renderCell();
}

// ---- events ----
el.prev.addEventListener('click', () => { openCell((state.cellIdx - 1 + cells().length) % cells().length); renderCell(); renderGrid(); });
el.next.addEventListener('click', () => { openCell((state.cellIdx + 1) % cells().length); renderCell(); renderGrid(); });
el.nextBatch.addEventListener('click', () => {
  const c = cell(); if (!c) return;
  const latest = Math.max(shownBatch(c.stationId), ...batchesFor(c.stationId).map(x => x.batch));
  state.shownBatch.set(c.stationId, latest + 1);
  renderCell(); window.scrollTo({ top: 0, behavior: 'smooth' });
});

el.tops.addEventListener('change', () => {
  const raw = el.tops.value.trim();
  const v = raw === '' ? null : Math.round(Number(raw) * 100) / 100;
  if (v !== null && (!Number.isFinite(v) || v < 0)) { el.tops.value = row().tops ?? ''; return; }
  if (v !== null && v > CONFIRM_OVER_LB && !window.confirm(tf('confirmBig', { lb: v.toFixed(2) }))) { el.tops.value = row().tops ?? ''; return; }
  setCellField('tops', v);
  renderCell();
});
el.notes.addEventListener('change', () => {
  const v = el.notes.value.trim() || null;
  setQualityField('notes', v);
});
el.checkedBy.addEventListener('change', () => {
  const v = el.checkedBy.value.trim().toUpperCase() || null;
  rememberInitials(v); setQualityField('checkedBy', v); renderCell();
});
el.tabWeights.addEventListener('click', () => { setView('weights'); renderGrid(); });
el.tabQuality.addEventListener('click', () => { setView('quality'); renderGrid(); });
el.cellCultivar.addEventListener('change', () => { setCellField('cultivar', el.cellCultivar.value || roomCultivar() || null); renderCell(); });

el.roomCultivar.addEventListener('change', () => {
  const v = el.roomCultivar.value || null;
  state.room.set(state.slot, { ...(state.room.get(state.slot) || {}), cultivar: v });
  enqueue('setRoomSmalls', { slot: state.slot, cultivar: v }, 'cultivar', `${state.slot}|room`);
  renderCell();
});
el.roomSmalls.addEventListener('change', () => {
  const raw = el.roomSmalls.value.trim();
  const v = raw === '' ? null : Math.round(Number(raw) * 100) / 100;
  if (v !== null && (!Number.isFinite(v) || v < 0)) { el.roomSmalls.value = state.room.get(state.slot)?.smalls ?? ''; return; }
  state.room.set(state.slot, { ...(state.room.get(state.slot) || {}), smalls: v });
  enqueue('setRoomSmalls', { slot: state.slot, smalls: v }, 'smalls', `${state.slot}|room`);
});

function openEdit() {
  const c = cell();
  el.editLabel.value = c.label; state.editLane = c.lane;
  el.laneW.classList.toggle('on', c.lane === 'wholesale'); el.laneR.classList.toggle('on', c.lane === 'retail');
  el.editBox.hidden = false; el.editLabel.focus();
}
el.editBtn.addEventListener('click', openEdit);
el.editCancel.addEventListener('click', () => { el.editBox.hidden = true; });
el.laneW.addEventListener('click', () => { state.editLane = 'wholesale'; el.laneW.classList.add('on'); el.laneR.classList.remove('on'); });
el.laneR.addEventListener('click', () => { state.editLane = 'retail'; el.laneR.classList.add('on'); el.laneW.classList.remove('on'); });
async function saveRoster(payload) {
  try { await api('POST', 'saveCellRoster', payload); await load(); renderAll(); } catch { el.cellStatus.className = 'save-status bad'; el.cellStatus.textContent = `✕ ${t('notSaved')}`; }
}
el.editSave.addEventListener('click', () => {
  const c = cell();
  saveRoster({ stationId: c.stationId, label: el.editLabel.value.trim() || c.label, lane: state.editLane, active: true });
});
el.remove.addEventListener('click', () => {
  const c = cell();
  if (!window.confirm(tf('confirmRemove', { name: c.label }))) return;
  saveRoster({ stationId: c.stationId, label: c.label, lane: c.lane, active: false });
});
el.add.addEventListener('click', async () => {
  await saveRoster({ lane: 'wholesale' });
  state.cellIdx = cells().length - 1; renderAll(); openEdit();
});

el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; if (state.slots.length) renderAll(); });

// ---- start ----
el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
el.date.textContent = DATE;
setView(state.view);
load().then(() => { renderAll(); loadCultivars(); }).catch(() => { el.cellStatus.className = 'save-status bad'; el.cellStatus.textContent = t('loadFail'); });
// Coming back to the tablet counts as a new visit: each cell re-picks its batch.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.slots.length) return;
  state.shownBatch.clear();
  load().then(renderAll).catch(() => {});
});
setInterval(() => { if (!document.hidden) load().then(() => { renderRoom(); renderGrid(); renderBag(); if (!el.editBox.hidden) return; renderCell(); }).catch(() => {}); }, REFRESH_MS);
