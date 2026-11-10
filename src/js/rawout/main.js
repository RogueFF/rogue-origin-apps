/**
 * Raw hand-out: the water spider's screen at the WIP bench (Koa 2026-11-10:
 * "Build the screen entry now"; design doc §2d, SOP-028). He weighs raw on the
 * bench scale (manual, no scale feed) and types the grams here, against the cell:
 *
 *   1. Pick the cell.
 *   2-4. No raw at the cell: pick the cultivar, bag size and number of bags; the
 *        screen shows what to weigh (rates.mjs, the SOP-028 chart).
 *   5. Type the grams weighed. Hand out.
 *   Raw already at the cell: "Add more raw" tops the lot up; "Weigh back" types
 *   what came back and closes it (0 g when nothing is left).
 *
 * Each cell holds one lot of raw at a time: a different cultivar is refused until
 * the last one is weighed back. Yield per lot and per cultivar is worked out by
 * the Worker (rawBoard) from the cell's scale pickups or its hourly log.
 *
 *   rawout.html                                          the screen
 *   rawout.html?api=http://localhost:8799/api/production local testing only
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { enhanceSelect } from '../shared/select-search.js';
import { buildCultivarOptions } from '../hourly-entry/cultivar-options.mjs';
import { BAGS, suggestRaw, rawPerBag, rateFor } from './rates.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const POLL_MS = 15000;
const WAY_OFF = [0.5, 2];   // typed grams outside half to double the chart: tap again to save
const MAX_BAGS = 50;

registerLabels({
  en: {
    title: 'Raw hand-out', board: 'Cells board', pickCell: 'Pick the cell', cultivar: 'Cultivar', chooseCultivar: 'Choose the cultivar',
    bagSize: 'Bag size', bags: 'How many bags', weighThis: 'Weigh this much raw', addMore: 'Add more raw', weighBack: 'Weigh back',
    noneLeft: 'Nothing left: 0 g', undo: 'Undo the last entry', today: 'Today', byCultivar: 'Yield by cultivar',
    noLots: 'No raw handed out today yet.', noRollup: 'No weighed lots yet: a lot counts once its raw is weighed back and the cell\'s tops are in.',
    gramsOut: 'Grams on the bench scale', gramsMore: 'Grams of extra raw', gramsBack: 'Grams that came back',
    handOut: 'Hand out {g}', saveMore: 'Add {g}', saveBack: 'Weigh back {g}', typeGrams: 'Type the grams first',
    pickAll: 'Pick the cultivar and the bag size first', fromScreen: 'From the cell screen: {c}',
    rawOut: 'Raw out', at: 'at', since: 'since {t}', handouts: '{n} hand-out(s)', noRaw: 'no raw out',
    wayOff: '{g} is far from the chart ({s}). Check the scale, then tap again to save.',
    rateWhy: '{n} × {one} · {basis} rate ×{f}', saved: 'Saved', undone: 'Undone: {k} {g}', out: 'out', back: 'back',
    weighBackFirst: '{cell} still has {c} raw out. Weigh it back first.', noOpen: 'This cell has no raw out.',
    loadFail: 'Can\'t reach the server. Retrying…', notReady: 'Raw hand-out is not set up on the server yet.',
    tooMuchBack: 'More than was handed out ({g}).',
    hCell: 'Cell', hCultivar: 'Cultivar', hOrder: 'Order', hOut: 'Out', hBack: 'Back', hUsed: 'Used', hTops: 'Tops', hYield: 'Yield',
    hLots: 'Lots', hRawPer: 'Raw per 1 g tops', hRate: 'Chart rate', stillOut: 'raw out', srcScale: 'scale', srcHourly: 'hourly log, cell-day',
    rollupSub: 'Last {n} days. Tops ÷ raw used. Scale cells: per lot. Other cells: per cell-day from the hourly log.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
  es: {
    title: 'Entrega de crudo', board: 'Tablero de celdas', pickCell: 'Elija la celda', cultivar: 'Variedad', chooseCultivar: 'Elija la variedad',
    bagSize: 'Tamaño de bolsa', bags: 'Cuántas bolsas', weighThis: 'Pese esta cantidad de crudo', addMore: 'Agregar más crudo', weighBack: 'Pesar lo que regresó',
    noneLeft: 'No sobró nada: 0 g', undo: 'Deshacer lo último', today: 'Hoy', byCultivar: 'Rendimiento por variedad',
    noLots: 'Todavía no se ha entregado crudo hoy.', noRollup: 'Todavía no hay lotes pesados: un lote cuenta cuando se pesa lo que regresó y están los tops de la celda.',
    gramsOut: 'Gramos en la báscula de mesa', gramsMore: 'Gramos de crudo extra', gramsBack: 'Gramos que regresaron',
    handOut: 'Entregar {g}', saveMore: 'Agregar {g}', saveBack: 'Regresó {g}', typeGrams: 'Escriba primero los gramos',
    pickAll: 'Elija primero la variedad y el tamaño de bolsa', fromScreen: 'De la pantalla de la celda: {c}',
    rawOut: 'Crudo entregado', at: 'en', since: 'desde {t}', handouts: '{n} entrega(s)', noRaw: 'sin crudo',
    wayOff: '{g} está lejos de la tabla ({s}). Revise la báscula y toque otra vez para guardar.',
    rateWhy: '{n} × {one} · tasa {basis} ×{f}', saved: 'Guardado', undone: 'Deshecho: {k} {g}', out: 'entrega', back: 'regreso',
    weighBackFirst: '{cell} todavía tiene crudo de {c}. Primero pese lo que regresó.', noOpen: 'Esta celda no tiene crudo.',
    loadFail: 'No hay conexión con el servidor. Reintentando…', notReady: 'La entrega de crudo todavía no está lista en el servidor.',
    tooMuchBack: 'Más de lo que se entregó ({g}).',
    hCell: 'Celda', hCultivar: 'Variedad', hOrder: 'Orden', hOut: 'Entregado', hBack: 'Regresó', hUsed: 'Usado', hTops: 'Tops', hYield: 'Rendimiento',
    hLots: 'Lotes', hRawPer: 'Crudo por 1 g de tops', hRate: 'Tasa de la tabla', stillOut: 'crudo afuera', srcScale: 'báscula', srcHourly: 'registro por hora, día de la celda',
    rollupSub: 'Últimos {n} días. Tops ÷ crudo usado. Celdas con báscula: por lote. Otras: por día de la celda, del registro por hora.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
const API_ROOT = API.replace(/\/production$/, '');
if (API !== PROD_API) document.getElementById('boardLink').href = `cells.html?api=${encodeURIComponent(API)}`;

const $ = id => document.getElementById(id);
const el = {
  sub: $('sub'), lang: $('langToggle'), notice: $('notice'), cells: $('cells'), panel: $('panel'), panelTitle: $('panelTitle'),
  newLot: $('newLot'), cultivar: $('cultivar'), fromScreen: $('fromScreen'), bagChips: $('bagChips'),
  bagsMinus: $('bagsMinus'), bagsPlus: $('bagsPlus'), bagsVal: $('bagsVal'), suggest: $('suggest'), suggestWhy: $('suggestWhy'),
  openLot: $('openLot'), lotSummary: $('lotSummary'), tabMore: $('tabMore'), tabBack: $('tabBack'),
  entry: $('entry'), gramsStep: $('gramsStep'), gramsLabel: $('gramsLabel'), grams: $('grams'), noneLeft: $('noneLeft'),
  warn: $('warn'), save: $('save'), undo: $('undo'), saved: $('saved'),
  lots: $('lots'), lotsEmpty: $('lotsEmpty'), rollup: $('rollup'), rollupSub: $('rollupSub'), rollupEmpty: $('rollupEmpty'),
};

let board = null;       // last rawBoard
let cultivars = [];
let sel = null;         // selected stationId
// The form for the selected cell. mode: 'new' | 'more' | 'back'
const form = { cultivar: '', bag: '', bags: 1, mode: 'new', confirmFor: null };
let busy = false;

const fmtG = g => (g === null || g === undefined ? '—' : `${Number(g).toLocaleString('en-US', { maximumFractionDigits: 1 })} g`);
const fmtTops = g => (g ? fmtG(g) : '—');   // no tops yet reads as a dash, not 0 g
const fmtPct = p => (p === null || p === undefined ? '—' : `${p.toFixed(1)}%`);
const bagText = key => { const b = BAGS.find(x => x.key === key); return b ? t(key) : (key || '—'); };
const clockText = ts => new Date(String(ts).replace(' ', 'T') + 'Z').toLocaleTimeString(getLang() === 'es' ? 'es-MX' : 'en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const cellOf = id => board && board.cells.find(c => c.stationId === id);
const typedGrams = () => {
  const n = Number(String(el.grams.value).replace(',', '.').trim());
  return el.grams.value.trim() !== '' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

function notice(text, ok = false) {
  el.notice.hidden = !text;
  el.notice.textContent = text || '';
  el.notice.className = `notice${ok ? ' ok' : ''}`;
}

// ---- 1. cells ----
function renderCells() {
  el.cells.innerHTML = '';
  for (const c of board.cells) {
    const b = document.createElement('button');
    b.className = `cell-btn ${c.lane}${c.open ? ' out' : ''}${c.stationId === sel ? ' sel' : ''}`;
    const name = document.createElement('b'); name.textContent = c.label;
    const what = document.createElement('small');
    what.textContent = c.open ? `${shortName(c.open.cultivar)} · ${fmtG(c.open.outG)}` : t('noRaw');
    b.append(name, what);
    b.addEventListener('click', () => pickCell(c.stationId));
    el.cells.appendChild(b);
  }
}
const shortName = c => String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '');

function pickCell(id) {
  sel = id;
  const c = cellOf(id);
  form.confirmFor = null;
  el.grams.value = '';
  if (c.open) form.mode = 'more';
  else {
    form.mode = 'new';
    // The cell's screen order, when it has one (only scale cells have screens today).
    form.cultivar = c.screen?.cultivar || '';
    form.bag = c.screen?.bag || '';
    form.bags = 1;
  }
  notice('');
  render();
  el.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 2-5. the panel ----
let cultivarBox = null;
function renderCultivars() {
  const opts = [...cultivars];
  if (form.cultivar && !opts.includes(form.cultivar)) opts.unshift(form.cultivar);
  el.cultivar.innerHTML = '';
  const first = document.createElement('option'); first.value = ''; first.textContent = t('chooseCultivar');
  el.cultivar.appendChild(first);
  for (const c of opts) { const o = document.createElement('option'); o.value = c; o.textContent = c; el.cultivar.appendChild(o); }
  el.cultivar.value = form.cultivar;
  cultivarBox && cultivarBox.refresh();
}

function renderBags() {
  el.bagChips.innerHTML = '';
  for (const b of BAGS) {
    const chip = document.createElement('button');
    chip.className = `chip${form.bag === b.key ? ' on' : ''}`;
    chip.innerHTML = `${t(b.key)}<small>${b.g} g</small>`;
    chip.addEventListener('click', () => { form.bag = b.key; form.confirmFor = null; renderPanel(); });
    el.bagChips.appendChild(chip);
  }
}

function suggestion() {
  if (form.mode !== 'new' || !form.cultivar || !form.bag) return null;
  return suggestRaw(form.cultivar, form.bag, form.bags);
}

function renderPanel() {
  const c = cellOf(sel);
  el.panel.hidden = !c;
  if (!c) return;
  el.panelTitle.textContent = c.label;
  const isNew = !c.open;
  el.newLot.hidden = !isNew;
  el.openLot.hidden = isNew;
  el.entry.hidden = false;
  if (isNew) {
    renderBags();
    el.bagsVal.textContent = String(form.bags);
    el.fromScreen.hidden = !(c.screen && c.screen.cultivar);
    el.fromScreen.textContent = c.screen ? tf('fromScreen', { c: `${c.screen.cultivar} · ${bagText(c.screen.bag)}` }) : '';
    const s = suggestion();
    el.suggest.textContent = s === null ? '—' : fmtG(s);
    const r = form.cultivar ? rateFor(form.cultivar) : null;
    el.suggestWhy.textContent = s === null ? t('pickAll')
      : tf('rateWhy', { n: form.bags, one: fmtG(rawPerBag(form.cultivar, form.bag)), basis: r.basis, f: r.factor.toFixed(2) });
    el.gramsStep.hidden = false;
    el.gramsLabel.textContent = t('gramsOut');
  } else {
    const l = c.open;
    el.lotSummary.innerHTML = '';
    const top = document.createElement('div'); top.className = 'big';
    top.textContent = `${shortName(l.cultivar)} · ${l.bags} × ${bagText(l.bag)}`;
    const out = document.createElement('div'); out.className = 'out'; out.textContent = `${t('rawOut')}: ${fmtG(l.outG)}`;
    const when = document.createElement('div'); when.className = 'muted';
    when.textContent = `${tf('handouts', { n: l.outs })} · ${tf('since', { t: clockText(l.openedAt) })}`;
    el.lotSummary.append(top, out, when);
    el.tabMore.classList.toggle('on', form.mode === 'more');
    el.tabBack.classList.toggle('on', form.mode === 'back');
    el.gramsStep.hidden = true;
    el.gramsLabel.textContent = t(form.mode === 'back' ? 'gramsBack' : 'gramsMore');
  }
  el.noneLeft.hidden = !(c.open && form.mode === 'back');
  renderSave();
}

function renderSave() {
  const c = cellOf(sel);
  if (!c) return;
  const g = typedGrams();
  const key = c.open ? (form.mode === 'back' ? 'saveBack' : 'saveMore') : 'handOut';
  el.save.textContent = tf(key, { g: g === null ? '' : fmtG(g) }).trim();
  const ready = g !== null && (c.open || (form.cultivar && form.bag)) && (form.mode === 'back' ? g >= 0 : g > 0);
  el.save.disabled = busy || !ready;
  const s = suggestion();
  const off = s && g !== null && (g < s * WAY_OFF[0] || g > s * WAY_OFF[1]);
  el.warn.hidden = !(off && form.confirmFor === g);
  el.warn.textContent = off ? tf('wayOff', { g: fmtG(g), s: fmtG(s) }) : '';
  el.save.classList.toggle('confirm', !!(off && form.confirmFor === g));
}

// ---- today and the roll-up ----
function th(row, keys) { const tr = document.createElement('tr'); for (const k of keys) { const h = document.createElement('th'); h.textContent = t(k); tr.appendChild(h); } row.appendChild(tr); }
function td(tr, text, cls = '') { const d = document.createElement('td'); d.textContent = text; if (cls) d.className = cls; tr.appendChild(d); return d; }

function renderLots() {
  const lots = board.lots.slice().sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  const groups = new Map((board.groups || []).map(g => [g.key, g]));
  el.lots.innerHTML = '';
  el.lotsEmpty.hidden = lots.length > 0;
  if (!lots.length) return;
  const head = document.createElement('thead'); th(head, ['hCell', 'hCultivar', 'hOrder', 'hOut', 'hBack', 'hUsed', 'hTops', 'hYield']);
  const body = document.createElement('tbody');
  for (const l of lots) {
    const tr = document.createElement('tr');
    if (!l.closed) tr.className = 'open';
    const g = l.group ? groups.get(l.group) : null;
    td(tr, cellOf(l.stationId)?.label || l.stationId);
    td(tr, shortName(l.cultivar));
    td(tr, `${l.bags} × ${bagText(l.bag)}`);
    td(tr, fmtG(l.outG), 'num');
    td(tr, l.closed ? fmtG(l.backG) : t('stillOut'), 'num');
    td(tr, fmtG(l.usedG), 'num');
    td(tr, fmtTops(g ? g.topsG : l.topsG), 'num');
    const y = td(tr, fmtPct(g ? g.yieldPct : l.yieldPct), 'yield');
    const src = document.createElement('div'); src.className = 'src'; src.textContent = t(l.source === 'scale' ? 'srcScale' : 'srcHourly');
    y.appendChild(src);
    body.appendChild(tr);
  }
  el.lots.append(head, body);
}

function renderRollup() {
  const rows = board.byCultivar || [];
  el.rollupSub.textContent = tf('rollupSub', { n: 30 });
  el.rollup.innerHTML = '';
  el.rollupEmpty.hidden = rows.length > 0;
  if (!rows.length) return;
  const head = document.createElement('thead'); th(head, ['hCultivar', 'hLots', 'hUsed', 'hTops', 'hYield', 'hRawPer', 'hRate']);
  const body = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    td(tr, shortName(r.cultivar));
    td(tr, String(r.lots), 'num');
    td(tr, fmtG(r.usedG), 'num');
    td(tr, fmtG(r.topsG), 'num');
    td(tr, fmtPct(r.yieldPct), 'yield');
    td(tr, r.rawPerTops === null ? '—' : `${r.rawPerTops.toFixed(2)} g`, 'num');
    const rate = rateFor(r.cultivar);
    const rc = td(tr, `×${rate.factor.toFixed(2)}`, 'num');
    const basis = document.createElement('div'); basis.className = 'src'; basis.textContent = rate.basis; rc.appendChild(basis);
    body.appendChild(tr);
  }
  el.rollup.append(head, body);
}

function render() {
  if (!board) return;
  el.sub.textContent = board.date;
  renderCells();
  renderPanel();
  renderLots();
  renderRollup();
}

// ---- server ----
async function call(action, body) {
  const r = await fetch(`${API}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  return { ok: r.ok && data.success !== false, data };
}

let timer = null;
async function poll() {
  clearTimeout(timer);
  try {
    const r = await fetch(`${API}?action=rawBoard`, { cache: 'no-store' });
    const data = await r.json();
    if (!r.ok || data.success === false) throw new Error(data.error || r.status);
    board = data;
    if (board.ready === false) notice(t('notReady'));
    else if (el.notice.textContent === t('loadFail') || el.notice.textContent === t('notReady')) notice('');
    // A lot that closed or opened elsewhere moves the selected cell's mode along.
    const c = cellOf(sel);
    if (c && c.open && form.mode === 'new') form.mode = 'more';
    if (c && !c.open && form.mode !== 'new') { form.mode = 'new'; form.cultivar = c.screen?.cultivar || ''; form.bag = c.screen?.bag || ''; form.bags = 1; }
    render();
    if (form.mode === 'new') renderCultivars();
  } catch {
    notice(t('loadFail'));
  }
  timer = setTimeout(poll, POLL_MS);
}

function errorText(res) {
  const c = cellOf(sel);
  if (res.data.code === 'WEIGH_BACK_FIRST') return tf('weighBackFirst', { cell: c?.label || sel, c: shortName(c?.open?.cultivar) || '' });
  if (res.data.code === 'NO_OPEN_LOT') return t('noOpen');
  if (res.data.code === 'NOT_READY') return t('notReady');
  return res.data.error || t('loadFail');
}

async function save() {
  const c = cellOf(sel);
  const g = typedGrams();
  if (!c || g === null) { notice(t('typeGrams')); return; }
  const s = suggestion();
  if (s && (g < s * WAY_OFF[0] || g > s * WAY_OFF[1]) && form.confirmFor !== g) {
    form.confirmFor = g; renderSave(); return;   // way off the chart: the next tap saves
  }
  if (c.open && form.mode === 'back' && g > c.open.outG) { notice(tf('tooMuchBack', { g: fmtG(c.open.outG) })); return; }
  busy = true; renderSave();
  let res;
  try {
    res = c.open && form.mode === 'back' ? await call('rawBack', { stationId: sel, grams: g })
      : c.open ? await call('rawOut', { stationId: sel, cultivar: c.open.cultivar, grams: g })
        : await call('rawOut', { stationId: sel, cultivar: form.cultivar, bag: form.bag, bags: form.bags, grams: g, suggestedG: s });
  } catch { res = { ok: false, data: {} }; }
  busy = false;
  if (!res.ok) { notice(errorText(res)); renderSave(); return; }
  notice('');
  el.saved.textContent = `${t('saved')} · ${c.label} · ${fmtG(g)}`;
  el.grams.value = ''; form.confirmFor = null;
  await poll();
}

// ---- events ----
el.cultivar.addEventListener('change', () => { form.cultivar = el.cultivar.value; form.confirmFor = null; renderPanel(); });
el.bagsMinus.addEventListener('click', () => { form.bags = Math.max(1, form.bags - 1); form.confirmFor = null; renderPanel(); });
el.bagsPlus.addEventListener('click', () => { form.bags = Math.min(MAX_BAGS, form.bags + 1); form.confirmFor = null; renderPanel(); });
el.tabMore.addEventListener('click', () => { form.mode = 'more'; form.confirmFor = null; el.grams.value = ''; renderPanel(); el.grams.focus(); });
el.tabBack.addEventListener('click', () => { form.mode = 'back'; form.confirmFor = null; el.grams.value = ''; renderPanel(); el.grams.focus(); });
el.grams.addEventListener('input', () => { el.grams.value = el.grams.value.replace(/[^0-9.,]/g, ''); renderSave(); });
el.grams.addEventListener('keydown', e => { if (e.key === 'Enter' && !el.save.disabled) save(); });
el.noneLeft.addEventListener('click', () => { el.grams.value = '0'; renderSave(); });
el.save.addEventListener('click', save);
el.undo.addEventListener('click', async () => {
  if (!sel) return;
  const res = await call('rawUndo', { stationId: sel }).catch(() => ({ ok: false, data: {} }));
  if (!res.ok) { notice(res.data.error || t('loadFail')); return; }
  notice('');
  el.saved.textContent = tf('undone', { k: t(res.data.undone.kind), g: fmtG(res.data.undone.grams) });
  await poll();
});
el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; render(); renderCultivars(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

async function loadCultivars() {
  let history = [];
  try { history = (await (await fetch(`${API}?action=getCultivars`, { cache: 'no-store' })).json()).cultivars || []; } catch { /* stays short */ }
  cultivars = buildCultivarOptions(history, []);
  renderCultivars();
  try {
    const r = await fetch(`${API_ROOT}/pool?action=get_supersack_variants`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    const v = await r.json();
    cultivars = buildCultivarOptions(history, (v.data || v).variants || []);
    renderCultivars();
  } catch { /* history only */ }
}

el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
setLang(getLang());
cultivarBox = enhanceSelect(el.cultivar, { placeholder: () => t('chooseCultivar') });
poll();
loadCultivars();
