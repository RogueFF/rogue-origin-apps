/**
 * Horas por persona (crew-hourly.html): the hourly log by PERSON, not by cell
 * (Koa 2026-11-17, via the hub). A cover or a cell swap never mixes two people:
 * each person gets their own row each hour with their cell, tops (lb, grams
 * small) and minutes worked.
 *
 *   · the people from the previous hour carry over with their cell, waiting for
 *     this hour's tops; nothing is saved until a number is typed
 *   · Cover: the one who left keeps their minutes, the cover person gets the rest
 *     of the hour on the same cell
 *   · saves each row as it is typed (Saving / Saved / Not saved, retried)
 *   · floor grid: hour by cell, with flags for an over-full cell and a missing hour
 *
 * Writes go to crewHourSave (farm password, behind the page gate); Mis números and
 * the crew board read the same rows. A typed hour replaces the paper sheet for that
 * person and hour.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { storedPassword } from '../shared/api.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const G_PER_LB = 453.59237;
const RETRY_MS = 15000;
const REFRESH_MS = 60000;
const params = new URLSearchParams(location.search);
// Local testing only: ?api=http://localhost:8765/api. Never another host.
const apiParam = params.get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;
const $ = (id) => document.getElementById(id);

registerLabels({
  es: {
    title: 'Horas por persona', day: 'Día', addLabel: 'Agregar a alguien a esta hora', searchName: 'Escriba un nombre',
    floor: 'Quién estuvo dónde', floorSub: 'Hora por celda. Los minutos salen cuando alguien no trabajó la hora completa.',
    howFull: 'Día completo = trabajó cada hora de 7 a 4 que trabajó el equipo. Si alguien se va o llega a cubrir, es día parcial (sin lugar).',
    howSheet: 'Lo que se escribe aquí reemplaza la hoja de papel para esa persona y esa hora.',
    cell: 'Celda', tops: 'Tops (lb)', min: 'Minutos', cover: 'Cubrir', remove: 'Quitar', addNew: 'Agregar nuevo: {n}',
    workMin: '{m} min de trabajo', entered: '{n} anotados', waiting: 'Falta anotar', fromSheet: 'de la hoja',
    dayRate: 'Hoy: {lb} lb/h', saving: 'Guardando…', saved: 'Guardado', notSaved: 'No se guardó: sin conexión. Se reintentará.',
    coverWho: '¿Quién cubrió?', coverLeft: 'Se fue a los (min)', coverOk: 'Listo', cancel: 'Cancelar',
    flagOver: 'Celda {c}, {s}: {n} personas suman {m} min (la hora tiene {h})', flagGap: '{n}: no tiene la hora {s} (trabajó antes y después)',
    noFlags: 'Nada raro.', empty: 'Nadie anotado esta hora todavía. Agregue a alguien abajo.', loadFail: 'No se pudo cargar. Revise la conexión.',
    badInput: 'No se guardó: {e}', hour: 'Hora',
  },
  en: {
    title: 'Hours by person', day: 'Day', addLabel: 'Add someone to this hour', searchName: 'Type a name',
    floor: 'Who was where', floorSub: "Hour by cell. Minutes show when someone didn't work the full hour.",
    howFull: 'Full day = worked every hour from 7 to 4 that the crew worked. Leaving early or covering is a part day (not ranked).',
    howSheet: 'What you type here replaces the paper sheet for that person and hour.',
    cell: 'Cell', tops: 'Tops (lb)', min: 'Minutes', cover: 'Cover', remove: 'Remove', addNew: 'Add new: {n}',
    workMin: '{m} working min', entered: '{n} entered', waiting: 'Not entered yet', fromSheet: 'from the sheet',
    dayRate: 'Today: {lb} lb/h', saving: 'Saving…', saved: 'Saved', notSaved: 'Not saved: no connection. It will retry.',
    coverWho: 'Who covered?', coverLeft: 'Left after (min)', coverOk: 'Done', cancel: 'Cancel',
    flagOver: 'Cell {c}, {s}: {n} people add up to {m} min (the hour has {h})', flagGap: '{n}: no row for {s} (worked before and after)',
    noFlags: 'Nothing odd.', empty: 'No one entered for this hour yet. Add someone below.', loadFail: "Couldn't load. Check the connection.",
    badInput: 'Not saved: {e}', hour: 'Hour',
  },
});
let stored = null;
try { stored = localStorage.getItem('ro-lang'); } catch { /* private mode */ }
setLang(stored === 'en' ? 'en' : 'es');

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

function pacificNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const DATE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : pacificNow().day;

async function api(action, body) {
  const url = new URL(`${ROOT}/production`);
  url.searchParams.set('action', action);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, password: storedPassword() }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { try { window.ROGate?.relock?.(); } catch { /* gate not loaded */ } }
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

// ---- state ----
const state = {
  slots: [], people: [], loaded: false,
  hours: new Map(),        // `${personId}|${slot}` -> { personId, slot, cell, lb, min, src }
  drafts: new Map(),       // shown but not saved yet (carried over, added, or a cover)
  dismissed: new Set(),    // carried-over rows the lead removed before saving
  sel: null, coverFor: null,
};
const key = (id, slot) => `${id}|${slot}`;
const slotMin = (slot) => state.slots.find((s) => s.slot === slot)?.min ?? 60;
const nameOf = (id) => state.people.find((p) => p.id === id)?.name ?? `#${id}`;
const slotIdx = (slot) => state.slots.findIndex((s) => s.slot === slot);

// ---- save queue: one entry per person and hour; the newest value wins ----
const queue = new Map();
const justSaved = new Map();
const errors = new Map();
let flushing = false;
function enqueue(payload) {
  const k = key(payload.personId, payload.slot);
  queue.set(k, { payload, failed: false });
  errors.delete(k);
  renderStatuses();
  flush();
}
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (const [k, item] of [...queue]) {
      try {
        await api('crewHourSave', { date: DATE, ...item.payload });
        if (queue.get(k) === item) queue.delete(k);
        justSaved.set(k, Date.now());
      } catch (e) {
        item.failed = true;
        if (e.status === 400) { queue.delete(k); errors.set(k, e.message); }
      }
    }
  } finally {
    flushing = false;
    renderStatuses();
  }
}
setInterval(() => { if (queue.size) flush(); }, RETRY_MS);
window.addEventListener('online', flush);

function statusHtml(k) {
  const q = queue.get(k);
  if (q) return q.failed ? `<span class="bad">✕ ${esc(t('notSaved'))}</span>` : `<span class="busy">${esc(t('saving'))}</span>`;
  if (errors.has(k)) return `<span class="bad">✕ ${esc(fill(t('badInput'), { e: errors.get(k) }))}</span>`;
  if (justSaved.has(k)) return `<span class="ok">✓ ${esc(t('saved'))}</span>`;
  return '';
}
function renderStatuses() {
  document.querySelectorAll('[data-status]').forEach((elm) => { elm.innerHTML = statusHtml(elm.dataset.status); });
}

// ---- what shows for an hour ----
function rowsFor(slot) {
  const out = new Map();
  for (const h of state.hours.values()) if (h.slot === slot) out.set(h.personId, { ...h, saved: true });
  for (const d of state.drafts.values()) if (d.slot === slot && !out.has(d.personId)) out.set(d.personId, { ...d, saved: false });
  // carry over: last hour's people, on the same cell, waiting for this hour's tops
  const i = slotIdx(slot);
  if (i > 0) {
    const prev = state.slots[i - 1].slot;
    for (const h of state.hours.values()) {
      if (h.slot !== prev || out.has(h.personId) || state.dismissed.has(key(h.personId, slot))) continue;
      if (!(h.min > 0)) continue;
      out.set(h.personId, { personId: h.personId, slot, cell: h.cell, lb: '', min: slotMin(slot), saved: false, carried: true });
    }
  }
  return [...out.values()].sort((a, b) => (Number(a.cell) || 999) - (Number(b.cell) || 999) || nameOf(a.personId).localeCompare(nameOf(b.personId)));
}
function prevCell(id, slot) {
  for (let i = slotIdx(slot) - 1; i >= 0; i--) {
    const h = state.hours.get(key(id, state.slots[i].slot));
    if (h?.cell) return h.cell;
  }
  return '';
}
function dayRate(id) {
  let lb = 0, min = 0;
  for (const h of state.hours.values()) if (h.personId === id) { lb += Number(h.lb) || 0; min += Number(h.min) || 0; }
  return min > 0 ? lb / (min / 60) : null;
}

// ---- render ----
function renderHours() {
  const now = DATE === pacificNow().day ? pacificNow().minutes : -1;
  const startMin = (slot) => { const h = Number(slot.split('-')[0]); return (h < 7 ? h + 12 : h) * 60 + (slot === '12-1' ? 30 : 0); };
  $('hourBar').innerHTML = state.slots.map((s) => {
    const n = [...state.hours.values()].filter((h) => h.slot === s.slot && h.min > 0).length;
    const isNow = now >= startMin(s.slot) && now < startMin(s.slot) + 60;
    return `<button type="button" class="hour-chip${s.slot === state.sel ? ' on' : ''}${isNow ? ' now' : ''}" data-slot="${s.slot}"><span>${esc(s.slot)}</span><small>${n}</small></button>`;
  }).join('');
}

function rowHtml(r) {
  const k = key(r.personId, r.slot);
  const g = num(r.lb) !== null ? Math.round(Number(r.lb) * G_PER_LB) : null;
  const rate = dayRate(r.personId);
  const cover = state.coverFor === r.personId ? `
    <div class="hp-cover" data-cover="${r.personId}">
      <label class="field"><span class="eyebrow">${esc(t('coverWho'))}</span><input type="search" class="cv-who" autocomplete="off" placeholder="${esc(t('searchName'))}"></label>
      <div class="hp-pick cv-pick"></div>
      <label class="field"><span class="eyebrow">${esc(t('coverLeft'))}</span><input type="number" class="cv-left" inputmode="numeric" min="0" max="${slotMin(r.slot)}" value="${Math.round(slotMin(r.slot) / 2)}"></label>
      <div class="hp-actions"><button type="button" class="btn ghost cv-cancel">${esc(t('cancel'))}</button></div>
    </div>` : '';
  return `<div class="hp-row${r.saved ? '' : ' draft'}" data-id="${r.personId}">
    <div class="hp-name"><b>${esc(nameOf(r.personId))}</b>
      <span class="muted small">${r.saved ? (r.src === 'sheet' ? esc(t('fromSheet')) : '') : esc(t('waiting'))}${rate !== null ? ` · ${esc(fill(t('dayRate'), { lb: rate.toFixed(2) }))}` : ''}</span></div>
    <div class="hp-fields">
      <label class="field f-cell"><span class="eyebrow">${esc(t('cell'))}</span><input class="in-cell" inputmode="numeric" value="${esc(r.cell ?? '')}"></label>
      <label class="field f-lb"><span class="eyebrow">${esc(t('tops'))}</span><input class="in-lb" type="number" inputmode="decimal" step="0.01" min="0" max="11" value="${esc(r.lb ?? '')}" placeholder="0.00"><small class="g">${g !== null ? `${g} g` : ''}</small></label>
      <label class="field f-min"><span class="eyebrow">${esc(t('min'))}</span><input class="in-min" type="number" inputmode="numeric" min="0" max="120" value="${esc(r.min ?? slotMin(r.slot))}"></label>
    </div>
    <div class="hp-actions"><span class="hp-status" data-status="${k}">${statusHtml(k)}</span>
      <button type="button" class="btn ghost act-cover">${esc(t('cover'))}</button>
      <button type="button" class="btn ghost act-remove">${esc(t('remove'))}</button></div>
    ${cover}
  </div>`;
}

function renderRows() {
  const s = state.sel;
  $('hourTitle').textContent = `${t('hour')} ${s}`;
  const rows = rowsFor(s);
  const saved = rows.filter((r) => r.saved).length;
  $('hourSub').textContent = `${fill(t('workMin'), { m: slotMin(s) })} · ${fill(t('entered'), { n: saved })}`;
  $('rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : `<p class="muted">${esc(t('empty'))}</p>`;
}

function flagsFor() {
  const flags = [];
  const byCell = new Map();
  for (const h of state.hours.values()) {
    if (!(h.min > 0) || !h.cell) continue;
    const k = `${h.slot}|${h.cell}`;
    const c = byCell.get(k) || { slot: h.slot, cell: h.cell, people: [], min: 0 };
    c.people.push(h.personId); c.min += Number(h.min) || 0;
    byCell.set(k, c);
  }
  const over = new Set();
  for (const [k, c] of byCell) {
    if (c.people.length > 1 && c.min > slotMin(c.slot)) {
      over.add(k);
      flags.push(fill(t('flagOver'), { c: c.cell, s: c.slot, n: c.people.length, m: c.min, h: slotMin(c.slot) }));
    }
  }
  // a missing hour only counts when the room worked it (not a meeting everyone sat out)
  const roomWorked = new Set([...state.hours.values()].filter((h) => h.min > 0).map((h) => h.slot));
  const ids = new Set([...state.hours.values()].map((h) => h.personId));
  for (const id of ids) {
    const idx = state.slots.map((s, i) => ((state.hours.get(key(id, s.slot))?.min || 0) > 0 ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    for (let i = idx[0] + 1; i < idx[idx.length - 1]; i++) {
      if (!idx.includes(i) && roomWorked.has(state.slots[i].slot)) flags.push(fill(t('flagGap'), { n: nameOf(id), s: state.slots[i].slot }));
    }
  }
  return { flags, over, byCell };
}

function renderGrid() {
  const { flags, over, byCell } = flagsFor();
  $('flags').innerHTML = flags.length ? `<ul>${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p class="ok small">✓ ${esc(t('noFlags'))}</p>`;
  const cells = [...new Set([...state.hours.values()].filter((h) => h.cell && h.min > 0).map((h) => h.cell))]
    .sort((a, b) => (Number(a) || 999) - (Number(b) || 999) || a.localeCompare(b));
  const used = state.slots.filter((s) => [...byCell.values()].some((c) => c.slot === s.slot));
  if (!cells.length) { $('grid').innerHTML = ''; return; }
  $('grid').innerHTML = `<thead><tr><th>${esc(t('hour'))}</th>${cells.map((c) => `<th>${esc(t('cell'))} ${esc(c)}</th>`).join('')}</tr></thead><tbody>${used.map((s) => `
    <tr data-slot="${s.slot}" class="${s.slot === state.sel ? 'on' : ''}"><th>${esc(s.slot)}</th>${cells.map((c) => {
      const b = byCell.get(`${s.slot}|${c}`);
      if (!b) return '<td></td>';
      return `<td class="${over.has(`${s.slot}|${c}`) ? 'over' : ''}">${b.people.map((id) => {
        const h = state.hours.get(key(id, s.slot));
        return `<span>${esc(nameOf(id))}${h.min < s.min ? ` <small>${h.min}m</small>` : ''}</span>`;
      }).join('')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
}

function renderAll() { renderHours(); renderRows(); renderGrid(); }

// ---- edits ----
function rowValues(rowEl) {
  return {
    cell: rowEl.querySelector('.in-cell').value.trim(),
    lb: rowEl.querySelector('.in-lb').value.trim(),
    min: rowEl.querySelector('.in-min').value.trim(),
  };
}
function saveRow(rowEl) {
  const id = Number(rowEl.dataset.id);
  const slot = state.sel;
  const v = rowValues(rowEl);
  const k = key(id, slot);
  const wasSaved = state.hours.has(k);
  if (!wasSaved && v.lb === '') return;          // a waiting row saves once its tops are typed
  const lb = num(v.lb) ?? 0, min = num(v.min) ?? slotMin(slot);
  state.hours.set(k, { personId: id, slot, cell: v.cell || null, lb, min, src: 'typed' });
  state.drafts.delete(k);
  enqueue({ personId: id, slot, cell: v.cell || null, lb, min });
  if (!wasSaved) { renderAll(); return; }
  renderHours(); renderGrid();
}

$('rows').addEventListener('input', (e) => {
  const rowEl = e.target.closest('.hp-row');
  if (!rowEl) return;
  if (e.target.classList.contains('in-lb')) {
    const v = num(e.target.value);
    rowEl.querySelector('.g').textContent = v !== null ? `${Math.round(v * G_PER_LB)} g` : '';
  }
  if (e.target.classList.contains('cv-who')) renderCoverPick(rowEl, e.target.value);
});
$('rows').addEventListener('change', (e) => {
  const rowEl = e.target.closest('.hp-row');
  if (rowEl && e.target.matches('.in-cell, .in-lb, .in-min')) saveRow(rowEl);
});
$('rows').addEventListener('click', (e) => {
  const rowEl = e.target.closest('.hp-row');
  if (!rowEl) return;
  const id = Number(rowEl.dataset.id);
  const k = key(id, state.sel);
  if (e.target.closest('.act-remove')) {
    if (state.hours.has(k)) {
      state.hours.delete(k);
      enqueue({ personId: id, slot: state.sel, cell: rowValues(rowEl).cell || null, lb: 0, min: 0 });
    }
    state.drafts.delete(k);
    state.dismissed.add(k);
    renderAll();
  } else if (e.target.closest('.act-cover')) {
    state.coverFor = state.coverFor === id ? null : id;
    renderRows();
    rowEl.ownerDocument.querySelector(`.hp-row[data-id="${id}"] .cv-who`)?.focus();
  } else if (e.target.closest('.cv-cancel')) {
    state.coverFor = null; renderRows();
  } else if (e.target.closest('[data-cover-pick]')) {
    const coverId = Number(e.target.closest('[data-cover-pick]').dataset.coverPick);
    const left = Math.max(0, Math.min(slotMin(state.sel), num(rowEl.querySelector('.cv-left').value) ?? 0));
    const v = rowValues(rowEl);
    // the one who left keeps their minutes; the cover gets the rest of the hour on the same cell
    rowEl.querySelector('.in-min').value = String(left);
    if (v.lb === '' && !state.hours.has(k)) rowEl.querySelector('.in-lb').value = '0';
    saveRow(rowEl);
    state.drafts.set(key(coverId, state.sel), { personId: coverId, slot: state.sel, cell: v.cell || null, lb: '', min: slotMin(state.sel) - left });
    state.dismissed.delete(key(coverId, state.sel));
    state.coverFor = null;
    renderAll();
  }
});

function pickList(q, exclude) {
  const f = fold(q.trim());
  const shown = state.people.filter((p) => !exclude.has(p.id) && (!f || fold(p.name).includes(f))).slice(0, 8);
  const exact = state.people.some((p) => fold(p.name) === f);
  return { shown, canAdd: f.length >= 2 && !exact };
}
function renderCoverPick(rowEl, q) {
  const here = new Set(rowsFor(state.sel).map((r) => r.personId));
  const { shown } = pickList(q, here);
  rowEl.querySelector('.cv-pick').innerHTML = shown.map((p) => `<button type="button" class="btn ghost" data-cover-pick="${p.id}">${esc(p.name)}</button>`).join('');
}

function renderAddList() {
  const q = $('addSearch').value;
  const box = $('addList');
  if (!q.trim()) { box.hidden = true; box.innerHTML = ''; return; }
  const here = new Set(rowsFor(state.sel).map((r) => r.personId));
  const { shown, canAdd } = pickList(q, here);
  box.innerHTML = shown.map((p) => `<button type="button" class="btn ghost" data-add="${p.id}">${esc(p.name)}</button>`).join('')
    + (canAdd ? `<button type="button" class="btn primary" data-new="1">${esc(fill(t('addNew'), { n: q.trim() }))}</button>` : '');
  box.hidden = false;
}
function addDraft(id) {
  const k = key(id, state.sel);
  state.dismissed.delete(k);
  if (!state.hours.has(k)) state.drafts.set(k, { personId: id, slot: state.sel, cell: prevCell(id, state.sel), lb: '', min: slotMin(state.sel) });
  $('addSearch').value = '';
  renderAddList();
  renderAll();
  document.querySelector(`.hp-row[data-id="${id}"] .in-lb`)?.focus();
}
$('addSearch').addEventListener('input', renderAddList);
$('addList').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) return addDraft(Number(b.dataset.add));
  if (b.dataset.new) {
    b.disabled = true;
    try {
      const r = await api('crewPersonAdd', { name: $('addSearch').value.trim() });
      if (!state.people.some((p) => p.id === r.person.id)) state.people.push(r.person);
      state.people.sort((a, c) => a.name.localeCompare(c.name));
      addDraft(r.person.id);
    } catch { b.disabled = false; }
  }
});

$('hourBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  state.sel = b.dataset.slot; state.coverFor = null; renderAll();
});
$('grid').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slot]');
  if (!tr) return;
  state.sel = tr.dataset.slot; state.coverFor = null; renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---- load ----
async function load() {
  try {
    const d = await api('crewHourDay', { date: DATE });
    state.slots = d.slots;
    state.people = d.people;
    const fresh = new Map();
    for (const h of d.hours) fresh.set(key(h.personId, h.slot), { personId: h.personId, slot: h.slot, cell: h.cell, lb: h.lb, min: h.min, src: h.src });
    // an edit still on its way keeps its local value
    for (const [k, q] of queue) {
      if (q.payload.min > 0 || q.payload.lb > 0) fresh.set(k, { ...q.payload, src: 'typed' });
      else fresh.delete(k);
    }
    state.hours = fresh;
    if (!state.sel) {
      const now = DATE === pacificNow().day ? pacificNow().minutes : -1;
      const idx = state.slots.findLastIndex((s) => { const h = Number(s.slot.split('-')[0]); return now >= (h < 7 ? h + 12 : h) * 60; });
      state.sel = (idx >= 0 ? state.slots[idx] : state.slots[0]).slot;
    }
    state.loaded = true;
    $('msg').hidden = true;
    const active = document.activeElement;
    if (!active || !active.closest('.hp-row, .hp-add')) renderAll(); else { renderHours(); renderGrid(); }
  } catch {
    if (!state.loaded) { $('msg').textContent = t('loadFail'); $('msg').hidden = false; }
  }
}

$('dateIn').value = DATE;
$('dateIn').addEventListener('change', () => {
  const v = $('dateIn').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  const u = new URL(location.href);
  u.searchParams.set('date', v);
  location.href = u.toString();
});
const langLabel = () => { $('langToggle').textContent = getLang() === 'es' ? 'EN' : 'ES'; };
langLabel();
$('langToggle').addEventListener('click', () => {
  setLang(getLang() === 'es' ? 'en' : 'es');
  try { localStorage.setItem('ro-lang', getLang()); } catch { /* private mode */ }
  langLabel();
  if (state.loaded) renderAll();
});
window.addEventListener('ro:authchange', (e) => { if (e.detail?.unlocked) load(); });
load();
setInterval(() => { if (!queue.size) load(); }, REFRESH_MS);
