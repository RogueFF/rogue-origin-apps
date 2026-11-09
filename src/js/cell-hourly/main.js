/**
 * Cell hourly log: hour-by-hour tops, quality and notes per cell, plus one
 * shared smalls number per hour for the room. Used until every table has a
 * live scale; the rows are keyed (date, slot, station) like the scale rollup
 * will write them (Koa 2026-11-09).
 *
 *   cell-hourly.html            today, the current hour
 *   cell-hourly.html?date=...   another day
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
    removeCell: 'Remove cell', topsLabel: 'Tops this hour', quality: 'Quality', notChecked: 'Not checked',
    pass: 'Pass', fail: 'Fail', failNeedsNote: 'Write what failed in the notes first', notes: 'Notes',
    cellCultivar: 'Cultivar at this cell', jump: 'All cells this hour', addCell: '+ Add cell',
    saving: 'Saving…', saved: 'Saved', notSaved: 'Not saved: no connection. It will retry.', perHour: 'lb/hr',
    confirmBig: 'That is {lb} lb in one hour. Keep it?', confirmRemove: 'Remove {name}? Its saved hours stay.',
    entered: 'entered', sameAsRoom: 'Same as the room', none: '—', loadFail: 'Could not load. Check the connection.',
  },
  es: {
    title: 'Registro por hora de celdas', roomCultivar: 'Variedad de esta hora', roomSmalls: 'Smalls, todo el cuarto (lb)',
    wholesaleToday: 'Tops de mayoreo hoy', bagsFull: 'Bolsas de 5 kg', nextBag: 'Siguiente bolsa de 5 kg',
    edit: 'Editar', nameLabel: 'Nombre o etiqueta', wholesale: 'Mayoreo', retail: 'Menudeo', save: 'Guardar', cancel: 'Cancelar',
    removeCell: 'Quitar celda', topsLabel: 'Tops de esta hora', quality: 'Calidad', notChecked: 'Sin revisar',
    pass: 'Pasa', fail: 'No pasa', failNeedsNote: 'Escriba primero en notas qué falló', notes: 'Notas',
    cellCultivar: 'Variedad en esta celda', jump: 'Todas las celdas esta hora', addCell: '+ Agregar celda',
    saving: 'Guardando…', saved: 'Guardado', notSaved: 'No se guardó: sin conexión. Se reintentará.', perHour: 'lb/h',
    confirmBig: 'Son {lb} lb en una hora. ¿Lo deja así?', confirmRemove: '¿Quitar {name}? Sus horas guardadas se quedan.',
    entered: 'llenas', sameAsRoom: 'Igual que el cuarto', none: '—', loadFail: 'No cargó. Revise la conexión.',
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
  tops: $('tops'), rate: $('rate'), qNone: $('qNone'), qPass: $('qPass'), qFail: $('qFail'), failNote: $('failNeedsNote'),
  notes: $('notes'), cellCultivar: $('cellCultivar'), cellStatus: $('cellStatus'),
  grid: $('jumpGrid'), doneCount: $('doneCount'), add: $('addBtn'),
};

const state = {
  slots: [], roster: [], rows: new Map(), room: new Map(),
  slot: null, cellIdx: 0, cultivars: [], editLane: 'wholesale',
};
const rowKey = (slot, station) => `${slot}|${station}`;
const cells = () => state.roster.filter(c => c.active);
const cell = () => cells()[Math.min(state.cellIdx, cells().length - 1)];
const row = (station = cell()?.stationId, slot = state.slot) => state.rows.get(rowKey(slot, station)) || {};
const fmtLb = n => `${(Number(n) || 0).toFixed(2)} lb`;

// ---- save queue: one entry per (target, field); the newest value wins ----
const queue = new Map();   // key -> { kind, payload, scope }
let flushing = false;
function enqueue(kind, payload, field, scope) {
  queue.set(`${kind}|${payload.slot}|${payload.stationId || 'room'}|${field}`, { kind, payload, scope });
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
  const s = c ? statusFor(`${state.slot}|${c.stationId}`) : null;
  if (s) { el.cellStatus.className = `save-status ${s.cls}`; el.cellStatus.textContent = s.text; }
  const r = statusFor(`${state.slot}|room`);
  el.roomStatus.className = `save-status ${r.cls}`; el.roomStatus.textContent = r.text;
}
const pending = (slot, station, field) => queue.has(`setCellHourly|${slot}|${station}|${field}`);

// ---- local edits (optimistic) ----
function setCellField(field, value) {
  const c = cell(); if (!c) return;
  const key = rowKey(state.slot, c.stationId);
  const r = { ...(state.rows.get(key) || {}), stationId: c.stationId, slot: state.slot, [field]: value };
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
    const done = cells().filter(c => row(c.stationId, s.slot).tops != null).length;
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
  for (const r of state.rows.values()) if (ws.has(r.stationId) && r.quality !== 'fail') total += Number(r.tops) || 0;
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
  if (document.activeElement !== el.notes) el.notes.value = r.notes ?? '';
  const hours = state.slots.find(s => s.slot === state.slot)?.hours || 1;
  el.rate.textContent = r.tops != null ? `${(r.tops / hours).toFixed(2)} ${t('perHour')} (${hours} h)` : '';
  el.qNone.classList.toggle('on', !r.quality);
  el.qPass.classList.toggle('on', r.quality === 'pass');
  el.qFail.classList.toggle('on', r.quality === 'fail');
  fillCultivars(el.cellCultivar, r.cultivar && r.cultivar !== roomCultivar() ? r.cultivar : '', true);
  el.failNote.hidden = true;
  el.editBox.hidden = true;
  renderStatus();
}
function renderGrid() {
  el.grid.innerHTML = '';
  const list = cells();
  let done = 0;
  list.forEach((c, i) => {
    const r = row(c.stationId);
    if (r.tops != null) done++;
    const b = document.createElement('button');
    b.className = 'jump' + (r.tops != null ? ' done' : '') + (r.quality === 'fail' ? ' failq' : '')
      + (i === state.cellIdx ? ' current' : '') + (c.lane === 'retail' ? ' retail' : '');
    b.innerHTML = `<b>${c.stationId.replace(/^table/, '')}</b>`;
    b.appendChild(document.createTextNode(c.label));
    b.title = c.label;
    b.addEventListener('click', () => { state.cellIdx = i; renderCell(); renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.grid.appendChild(b);
  });
  el.doneCount.textContent = `${done}/${list.length} ${t('entered')}`;
  renderHours();
}
function renderAll() { renderRoom(); renderCell(); renderGrid(); renderBag(); }

// ---- load ----
async function load() {
  const d = await api('GET', 'cellHourly', null, { date: DATE });
  state.slots = d.slots; state.roster = d.roster;
  for (const r of d.rows) {
    const key = rowKey(r.slot, r.stationId);
    const local = state.rows.get(key) || {};
    const merged = { ...r };
    // Keep this tablet's unsaved edits over what the server had.
    for (const f of ['tops', 'quality', 'notes', 'cultivar']) if (pending(r.slot, r.stationId, f)) merged[f] = local[f];
    state.rows.set(key, merged);
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
el.prev.addEventListener('click', () => { state.cellIdx = (state.cellIdx - 1 + cells().length) % cells().length; renderCell(); renderGrid(); });
el.next.addEventListener('click', () => { state.cellIdx = (state.cellIdx + 1) % cells().length; renderCell(); renderGrid(); });

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
  setCellField('notes', v);
  if (v && el.failNote.dataset.waiting === '1') { el.failNote.dataset.waiting = ''; setCellField('quality', 'fail'); renderCell(); }
});
el.qNone.addEventListener('click', () => { setCellField('quality', null); renderCell(); });
el.qPass.addEventListener('click', () => { setCellField('quality', 'pass'); renderCell(); });
el.qFail.addEventListener('click', () => {
  // A fail needs a reason, same rule as a paused job.
  if (!(el.notes.value.trim() || row().notes)) {
    el.failNote.hidden = false; el.failNote.dataset.waiting = '1'; el.notes.focus(); return;
  }
  setCellField('quality', 'fail'); renderCell();
});
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
load().then(() => { renderAll(); loadCultivars(); }).catch(() => { el.cellStatus.className = 'save-status bad'; el.cellStatus.textContent = t('loadFail'); });
setInterval(() => { if (!document.hidden) load().then(() => { renderRoom(); renderGrid(); renderBag(); if (!el.editBox.hidden) return; renderCell(); }).catch(() => {}); }, REFRESH_MS);
