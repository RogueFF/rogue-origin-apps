/**
 * Cell hourly log: hour-by-hour tops per cell, plus one shared smalls number per
 * hour for the room. Used until every table has a live scale; the rows are keyed
 * (date, slot, station) like the scale rollup will write them (Koa 2026-11-09).
 * Quality sits on each cell card (Koa 2026-11-18): one tap, "Quality OK", scores
 * all four checks; tap one check to give it 1-4. One check per cell per hour.
 *
 *   cell-hourly.html            today, the current hour
 *   cell-hourly.html?date=...   another day
 *
 * Every field saves on its own as soon as it changes, and the save state shows
 * on screen. A failed save stays queued and retries; nothing is lost silently.
 *
 * People on the cells (Koa 2026-11-18): each cell shows who is on it this hour,
 * carried over from the last hour, so the usual entry is type tops, Enter, next
 * cell. Tops are saved per person (crewHourSave, farm password) and the cell's
 * total is derived from them: one number, the same rows Mis números and the crew
 * board read. Tap the name to change the person; 'Someone took over' splits the hour.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { buildCultivarOptions } from '../hourly-entry/cultivar-options.mjs';
import { enhanceSelect } from '../shared/select-search.js';
import { storedPassword } from '../shared/api.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const BAG_NET_LB = 5090.72 / 453.59237; // 5 kg bag, net fill standard (fill-weight-standards)
const CONFIRM_OVER_LB = 5;              // a cell-hour is a few lb; more is probably grams typed as lb
const REFRESH_MS = 30000;
const RETRY_MS = 10000;
// Kept simple for now (Koa 2026-11-18: "take out Quality Check, and Goal. Need it
// very simple for now and easy to use"). Flip either back on to bring it back; the
// Worker side is untouched (the TV, crew board and Mis números still grade on the
// day's goal, the cultivar break-even by default).
const SHOW_QUALITY = false;
const SHOW_GOAL = false;

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
    tareFlag: "The scale's TARE was pressed mid-job this hour: check it", searchCultivar: 'Type to search',
    whoHere: 'Who is on this cell?', cover: 'Someone took over', carried: 'same as last hour',
    waiting: 'not entered yet', removePerson: 'Take off this hour', pickAssign: 'Who is on {c}?', pickReplace: 'Change {n} for…',
    pickCover: '{n} left. Who took over?', leftAfter: '{n} left after (min)', addNew: 'Add new: {n}',
    onCell: 'on {c}', peopleFail: "Couldn't load the crew list. Unlock the page or check the connection.", loadingPeople: 'Loading the crew…',
    searchName: 'Type a name', close: 'Close',
    goalTitle: 'Crew goal today (lb per hour)', goalSave: 'Set goal', goalNone: 'No goal yet: type one and tap Set goal.',
    goalDefault: '{c} break-even rate (the default). Type another and tap Set goal to change it; clear it to go back.',
    goalCarried: 'Carried from {d}. Type one and tap Set goal to change it.', goalSet: 'Set here for today. Clear it and tap Set goal to go back to the default.',
    goalSheet: "From this day's loaded sheets: that goal stands.",
    fillLabel: 'Fill Hourly entry from the cells this day (test)', fillFilled: 'Hourly entry filled from the cells: {lb} lb, {n} trimmers',
    fillHand: 'Hourly entry was typed by hand: {lb} lb (cells: {c} lb). The hand row stays.', fillHandOnly: 'Hourly entry was typed by hand: {lb} lb.',
    fillMixed: 'cultivars this hour: {list}', fillConfirmOn: 'Fill Hourly entry from the cells for this day? Hours typed by hand stay as they are.',
    fillConfirmOff: 'Stop filling Hourly entry for this day? The hours the cells filled are removed; hours typed by hand stay.',
    qOk: 'Quality OK', qOkDone: '✓ Quality OK', qRedo: '✕ Redo · tap when it is fixed', qNote: 'Note', qFailsToday: 'Quality fails today',
    stopPage: 'STOP: mold or insects at {list}. Set the basket aside and call the lead.',
    gQuality: '{c}: quality good? Tap "Quality OK". A problem? Tap the check that fails.',
    gNoQuality: '{list}: no quality check this hour', gRedoQ: '{c}: quality to redo',
    gStart: '▶ Enter this hour, step by step', gExit: 'Exit', gSkip: 'Not used today: skip', gRest: 'No one else today: skip the rest', gNextBtn: 'Next cell to do ›', gDone: 'Done ✓',
    gCount: '{h} · {d} of {n} cells', gWho: '{c}: who is on it? Tap the green button. Not used today? Skip.',
    gType: '{c} · {n}: type the tops in lb, then Enter.', gTypeSub: 'Wrong person? Tap the name. Someone took over? Tap "Someone took over".',
    gTwo: '{c}: type the tops for {a} and for {b}, Enter after each.', gGoNext: 'This cell is done. Go to the next one to do.',
    gReviewTitle: 'Check {h} before moving on', gReviewSub: 'Tap one to fix it. If it is right, leave it.', gAllGood: 'Everything looks right. Done!',
    gMissing: '{c}: no tops yet', gHigh: '{n}: {lb} lb in one hour looks high (grams?)', gZero: '{n}: 0 lb this hour',
    gOff: '{n}: {lb} lb is far from their pace today ({u} lb/h)', gMoved: '{n} moved from {a} to {b}', gNoCultivar: 'The room cultivar for this hour is not set (top of the page)',
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
    tareFlag: 'Se presionó TARA en la báscula a mitad del trabajo esta hora: revíselo', searchCultivar: 'Escriba para buscar',
    whoHere: '¿Quién está en esta celda?', cover: 'Alguien lo cubrió', carried: 'igual que la hora pasada',
    waiting: 'falta anotar', removePerson: 'Quitar de esta hora', pickAssign: '¿Quién está en {c}?', pickReplace: 'Cambiar a {n} por…',
    pickCover: '{n} se fue. ¿Quién lo cubrió?', leftAfter: '{n} se fue a los (min)', addNew: 'Agregar nuevo: {n}',
    onCell: 'en {c}', peopleFail: 'No cargó la lista del equipo. Desbloquee la página o revise la conexión.', loadingPeople: 'Cargando el equipo…',
    searchName: 'Escriba un nombre', close: 'Cerrar',
    goalTitle: 'Meta del equipo hoy (lb por hora)', goalSave: 'Poner meta', goalNone: 'Sin meta todavía: escriba una y toque Poner meta.',
    goalDefault: 'Punto de equilibrio de {c} (la meta normal). Escriba otra y toque Poner meta; bórrela para volver.',
    goalCarried: 'Traída del {d}. Escriba una y toque Poner meta para cambiarla.', goalSet: 'Puesta aquí para hoy. Bórrela y toque Poner meta para volver a la normal.',
    goalSheet: 'De las hojas cargadas de este día: esa meta se queda.',
    fillLabel: 'Llenar la entrada por hora con las celdas este día (prueba)', fillFilled: 'Entrada por hora llenada con las celdas: {lb} lb, {n} trimmers',
    fillHand: 'La entrada por hora se escribió a mano: {lb} lb (celdas: {c} lb). Se queda la de mano.', fillHandOnly: 'La entrada por hora se escribió a mano: {lb} lb.',
    fillMixed: 'variedades esta hora: {list}', fillConfirmOn: '¿Llenar la entrada por hora con las celdas este día? Las horas escritas a mano se quedan igual.',
    fillConfirmOff: '¿Dejar de llenar la entrada por hora este día? Se quitan las horas que llenaron las celdas; las escritas a mano se quedan.',
    qOk: 'Calidad OK', qOkDone: '✓ Calidad OK', qRedo: '✕ Rehacer · toque cuando quede bien', qNote: 'Nota', qFailsToday: 'Fallas de calidad hoy',
    stopPage: 'PARE: moho o insectos en {list}. Aparte la canasta y llame al líder.',
    gQuality: '{c}: ¿calidad bien? Toque «Calidad OK». ¿Algún problema? Toque el punto que falla.',
    gNoQuality: '{list}: sin revisión de calidad esta hora', gRedoQ: '{c}: calidad para rehacer',
    gStart: '▶ Anotar esta hora, paso a paso', gExit: 'Salir', gSkip: 'No se usa hoy: saltar', gRest: 'No hay nadie más hoy: saltar las demás', gNextBtn: 'Siguiente celda por hacer ›', gDone: 'Listo ✓',
    gCount: '{h} · {d} de {n} celdas', gWho: '{c}: ¿quién está? Toque el botón verde. ¿No se usa hoy? Saltar.',
    gType: '{c} · {n}: escriba los tops en lb y presione Enter.', gTypeSub: '¿Persona equivocada? Toque el nombre. ¿Alguien lo cubrió? Toque «Alguien lo cubrió».',
    gTwo: '{c}: escriba los tops de {a} y de {b}, Enter después de cada uno.', gGoNext: 'Esta celda ya está. Vaya a la siguiente por hacer.',
    gReviewTitle: 'Revise {h} antes de seguir', gReviewSub: 'Toque uno para corregirlo. Si está bien, déjelo.', gAllGood: 'Todo se ve bien. ¡Listo!',
    gMissing: '{c}: faltan los tops', gHigh: '{n}: {lb} lb en una hora parece mucho (¿gramos?)', gZero: '{n}: 0 lb esta hora',
    gOff: '{n}: {lb} lb está lejos de su ritmo de hoy ({u} lb/h)', gMoved: '{n} se cambió de {a} a {b}', gNoCultivar: 'Falta la variedad del cuarto de esta hora (arriba)',
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
  // The people actions are behind the farm password (the page gate unlocked it).
  const payload = action.startsWith('crew') || action === 'cellFillSet' ? { ...body, password: storedPassword() } : body;
  const res = await fetch(url, method === 'GET'
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { try { window.ROGate?.relock?.(); } catch { /* gate not loaded */ } }
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
  people: $('people'), picker: $('picker'), pickTitle: $('pickTitle'), pickClose: $('pickClose'), pickLeft: $('pickLeft'),
  pickLeftWrap: $('pickLeftWrap'), pickLeftLabel: $('pickLeftLabel'),
  guide: $('guide'), guideStart: $('guideStart'), guideBar: $('guideBar'), guideCount: $('guideCount'), guideStep: $('guideStep'),
  guideSkip: $('guideSkip'), guideRest: $('guideRest'), guideNext: $('guideNext'), guideDone: $('guideDone'), guideExit: $('guideExit'), pickSearch: $('pickSearch'), pickList: $('pickList'), topsLabel: $('topsLabel'), rate: $('rate'), autoBox: $('autoBox'), autoVal: $('autoVal'), autoState: $('autoState'),
  overrideNote: $('overrideNote'), diffFlag: $('diffFlag'), tareFlag: $('tareFlag'), hourTotal: $('hourTotal'), hourTotalParts: $('hourTotalParts'), 
  gridTitle: $('gridTitle'), fillOn: $('fillOn'), fillState: $('fillState'), goalInput: $('goalInput'), goalSave: $('goalSave'), goalState: $('goalState'), goalRow: $('goalRow'), quality: $('quality'), stopBanner: $('stopBanner'),
  cellCultivar: $('cellCultivar'), cellStatus: $('cellStatus'),
  grid: $('jumpGrid'), doneCount: $('doneCount'), add: $('addBtn'),
};

const state = {
  slots: [], roster: [], rows: new Map(), room: new Map(), auto: new Map(),
  batches: new Map(),   // `${station}|${batch}` -> the batch's scores, notes, initials
  slot: null, cellIdx: 0, cultivars: [], editLane: 'wholesale',
  view: 'weights',   // one view since 2026-11-18: quality is on the cell card
};
function setView(v) { state.view = v; document.body.dataset.view = v; }
const rowKey = (slot, station) => `${slot}|${station}`;
const cells = () => state.roster.filter(c => c.active);
const cell = () => cells()[Math.min(state.cellIdx, cells().length - 1)];
const row = (station = cell()?.stationId, slot = state.slot) => state.rows.get(rowKey(slot, station)) || {};
const fmtLb = n => `${(Number(n) || 0).toFixed(2)} lb`;
const DIFF_FLAG = 0.10;   // typed vs scale more than 10% apart gets flagged
// Scale value for a cell-hour (computed by the Worker from its readings), if any.
const autoOf = (station = cell()?.stationId, slot = state.slot) => state.auto.get(rowKey(slot, station));
const hasScale = station => [...state.auto.values()].some(a => a.stationId === station);
// ---- people on the cells (Koa 2026-11-18) ----
// crew.slots: [{ slot: '7-8', min, long: '7:00 AM – 8:00 AM' }] lines up with state.slots.
// crew.ph: `${personId}|${long}` -> that person's hour { personId, long, short, stationId, cell, lb, min, seq, src }.
const crew = { people: [], slots: [], ph: new Map(), drafts: new Map(), dismissed: new Set(), ok: false, err: null };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shortOf = long => crew.slots.find(s => s.long === long)?.slot ?? null;
const slotMin = (long = state.slot) => crew.slots.find(s => s.long === long)?.min ?? Math.round((state.slots.find(s => s.slot === long)?.hours || 1) * 60);
const pkey = (personId, long) => `${personId}|${long}`;
const nameOf = id => crew.people.find(p => p.id === id)?.name ?? `#${id}`;
const firstName = id => nameOf(id).split(/[\s(]/)[0];
const stationNum = station => String(station || '').replace(/^table/, '');
const labelOf = station => state.roster.find(c => c.stationId === station)?.label ?? station;
// The people saved at a cell this hour (sheet rows carry only a cell number).
function savedAt(station, long = state.slot) {
  return [...crew.ph.values()].filter(h => h.long === long && (h.stationId ? h.stationId === station : h.cell === stationNum(station))
    && ((Number(h.min) || 0) > 0 || (Number(h.lb) || 0) > 0));
}
// The cell's tops this hour: the sum of its people's tops (one number, derived).
function typedTops(station, long = state.slot) {
  const rows = savedAt(station, long);
  return rows.length ? Math.round(rows.reduce((a, h) => a + (Number(h.lb) || 0), 0) * 100) / 100 : null;
}
// Who shows on a cell this hour: saved people, then people picked but not saved yet,
// and if nobody, the person who ended last hour on this cell (carried over).
function shownPeople(station, long = state.slot) {
  const saved = savedAt(station, long).map(h => ({ ...h, saved: true }));
  const drafts = (crew.drafts.get(rowKey(long, station)) || []).filter(d => !saved.some(s => s.personId === d.personId));
  let list = [...saved, ...drafts];
  const i = state.slots.findIndex(s => s.slot === long);
  if (!list.length && i > 0 && !crew.dismissed.has(rowKey(long, station))) {
    const last = savedAt(station, state.slots[i - 1].slot).sort((a, b) => (b.seq || 1) - (a.seq || 1))[0];
    const busy = last && [...crew.ph.values()].some(h => h.personId === last.personId && h.long === long);
    if (last && !busy) list = [{ personId: last.personId, lb: '', min: slotMin(long), seq: 1, carried: true }];
  }
  return list.sort((a, b) => (a.seq || 1) - (b.seq || 1));
}
// The cells in use this hour: someone is on them (saved, picked, or carried over),
// or they have tops. Not every cell runs every day (Koa 2026-11-18: "today we had
// something like 11"), so counts and Enter only go through these.
function usedCells(long = state.slot) {
  return cells().filter(c => shownPeople(c.stationId, long).length || eff(c.stationId, long) != null);
}
// What counts: typed (the people's tops) wins; otherwise the scale's.
function eff(station = cell()?.stationId, slot = state.slot) {
  const typed = typedTops(station, slot);
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
  const worst = (a, z) => (a.cls === 'bad' || z.cls === 'bad' ? (a.cls === 'bad' ? a : z) : a.cls === 'busy' ? a : z);
  const s = c ? worst(statusFor(`${state.slot}|${c.stationId}`), statusFor(qScope(c.stationId))) : null;
  if (s) { el.cellStatus.className = `save-status ${s.cls}`; el.cellStatus.textContent = s.text; }
  const r = statusFor(`${state.slot}|room`);
  el.roomStatus.className = `save-status ${r.cls}`; el.roomStatus.textContent = r.text;
}
const pending = (slot, station, field) => queue.has(`setCellHourly|${slot}|${station}|${field}`);
// A quality save's field part can name several checks at once (Quality OK = all four).
const qPending = (station, batch, field) => [...queue.keys()].some(k => k.startsWith(`setCellQuality|b${batch}|${station}|`) && k.split('|')[3].split('+').includes(field));

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

// ---- quality: one check per cell per hour, on the cell card (Koa 2026-11-18) ----
// Stored as a cell_quality batch so nothing changes on the Worker: batch_no 101
// is 7-8, 102 is 8-9 ... 110 is 4-4:30 (100 + the hour's place in the day).
// Batches 1-99 are the old by-batch checks: still read for fails and STOP.
const HOUR_BATCH_BASE = 100;
const PASS_SCORE = 4;   // "Quality OK": every check at its best score
const batchKey = (station, n) => `${station}|${n}`;
const hourBatch = (long = state.slot) => HOUR_BATCH_BASE + 1 + Math.max(0, state.slots.findIndex(s => s.slot === long));
const batchesFor = station => [...state.batches.values()].filter(b => b.stationId === station);
const qOf = (station, long = state.slot) => state.batches.get(batchKey(station, hourBatch(long))) || null;
// Tops in, no quality check yet, not skipped: Guided walks to Quality OK (only with quality on).
const wantsQuality = (station) => SHOW_QUALITY && eff(station) != null && !qOf(station) && !guided.qSkip.has(station);
const qScope = station => `q|${station}|${hourBatch()}`;
let qPickOpen = null;   // the one check open for a 1-4 pick ('note' = the note box)
function openCell(i) { state.cellIdx = i; qPickOpen = null; }
// The checker's initials, if this tablet ever had them (the old quality view asked).
function lastInitials() { try { return localStorage.getItem('ro-cell-hourly:initials') || ''; } catch { return ''; } }
// Save some of this hour's checks (or the note) for a cell.
function setChecks(station, vals) {
  const n = hourBatch(); const key = batchKey(station, n);
  const prev = state.batches.get(key) || { stationId: station, batch: n, checks: {} };
  const isCheck = k => CHECKS.some(([c]) => c === k);
  const b = { ...prev, checks: { ...(prev.checks || {}) } };
  for (const [k, v] of Object.entries(vals)) { if (isCheck(k)) b.checks[k] = v; else b[k] = v; }
  b.quality = overall(b.checks);
  const payload = { stationId: station, batch: n, ...vals };
  // A new check takes the cell's cultivar this hour, and this tablet's initials.
  if (!prev.updatedAt && !prev.cultivar) { const cv = row(station).cultivar || roomCultivar(); if (cv) { b.cultivar = cv; payload.cultivar = cv; } }
  if (!b.checkedBy && lastInitials()) { b.checkedBy = lastInitials(); payload.checkedBy = b.checkedBy; }
  b.updatedAt = b.updatedAt || 'local';
  state.batches.set(key, b);
  enqueue('setCellQuality', payload, Object.keys(vals).join('+'), qScope(station));
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

// The cell's quality this hour: a big "Quality OK" (all four checks at 4), the
// four checks as chips (tap one for its 1-4 pick), and a note. A 1 or 2 anywhere
// = Redo; a 1 on mold or insects = STOP for the whole page. Never required.
function renderQuality(c) {
  el.quality.hidden = !SHOW_QUALITY;
  if (!SHOW_QUALITY) { el.quality.innerHTML = ''; el.stopBanner.hidden = true; return; }
  const q = qOf(c.stationId);
  const checks = q?.checks || {};
  const o = q ? overall(checks) : null;
  const words = SCORE_WORDS[getLang() === 'es' ? 'es' : 'en'];
  const pick = qPickOpen && qPickOpen !== 'note' ? qPickOpen : null;
  el.quality.innerHTML = `
    <button type="button" class="btn q-ok${o === 'pass' ? ' on' : o === 'fail' ? ' redo' : ''}" data-q="ok">${esc(t(o === 'fail' ? 'qRedo' : o === 'pass' ? 'qOkDone' : 'qOk'))}</button>
    <div class="q-checks">${CHECKS.map(([k, label]) => {
    const v = checks[k];
    return `<button type="button" class="q-chip${v != null ? (v >= 3 ? ' ok' : ' redo') : ''}${qPickOpen === k ? ' open' : ''}" data-qk="${k}">${esc(t(label))}<b>${v ?? '–'}</b></button>`;
  }).join('')}<button type="button" class="q-chip${q?.notes ? ' ok' : ''}${qPickOpen === 'note' ? ' open' : ''}" data-qk="note">${esc(t('qNote'))}${q?.notes ? ' ✎' : ''}</button></div>
    ${pick ? `<div class="q-pick">${[1, 2, 3, 4].map(n => `<button type="button" class="q-score ${n >= 3 ? 'ok' : 'redo'}${checks[pick] === n ? ' on' : ''}" data-qs="${n}"><b>${n}</b><span>${esc(words[pick][n])}</span></button>`).join('')}</div>` : ''}
    ${qPickOpen === 'note' ? `<textarea class="q-note" rows="2" maxlength="500" placeholder="${esc(t('notes'))}">${esc(q?.notes ?? '')}</textarea>` : ''}
    ${o === 'fail' ? `<div class="q-redo">${esc(t('overallRedo'))}</div>` : ''}`;
}
// Cells with a STOP today (a 1 on mold or insects in any of the day's checks).
const stopCells = () => cells().filter(c => batchesFor(c.stationId).some(b => stopFor(b.checks)));
function renderStop() {
  const list = stopCells();
  el.stopBanner.hidden = !list.length;
  el.stopBanner.textContent = list.length ? tf('stopPage', { list: list.map(c => c.label).join(', ') }) : '';
}
el.quality.addEventListener('click', e => {
  const c = cell(); if (!c) return;
  const ok = e.target.closest('[data-q="ok"]');
  const chip = e.target.closest('[data-qk]');
  const score = e.target.closest('[data-qs]');
  if (ok) {
    // Typed tops not saved yet go in first, then the four checks at 4, then the next cell.
    for (const pEl of el.people.querySelectorAll('.person')) {
      const v = pEl.querySelector('.p-lb').value.trim();
      const saved = crew.ph.get(pkey(Number(pEl.dataset.pid), state.slot));
      if (v !== '' && (!saved || Number(saved.lb) !== Number(v))) commitPerson(pEl);
    }
    setChecks(c.stationId, Object.fromEntries(CHECKS.map(([k]) => [k, PASS_SCORE])));
    qPickOpen = null;
    nextCellFocused();
    return;
  }
  if (chip) { qPickOpen = qPickOpen === chip.dataset.qk ? null : chip.dataset.qk; renderQuality(c); if (qPickOpen === 'note') el.quality.querySelector('.q-note')?.focus(); return; }
  if (score && qPickOpen && qPickOpen !== 'note') {
    const n = Number(score.dataset.qs);
    const cur = qOf(c.stationId)?.checks?.[qPickOpen];
    setChecks(c.stationId, { [qPickOpen]: cur === n ? null : n });   // tap the lit score again to clear it
    qPickOpen = null;
    renderQuality(c); renderGrid(); renderStatus();
  }
});
el.quality.addEventListener('change', e => {
  if (!e.target.classList.contains('q-note')) return;
  const c = cell(); if (!c) return;
  setChecks(c.stationId, { notes: e.target.value.trim() || null });
  renderStatus();
});

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
    const used = usedCells(s.slot).length;
    b.className = 'hour-chip' + (s.slot === state.slot ? ' on' : '') + (i === nowIdx ? ' now' : '');
    b.innerHTML = `<span>${s.slot.replace(/:00/g, '').replace(' – ', '–')}</span><small>${done}/${used}</small>`;
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
  renderFill();
  renderGoal();
}
// The Hourly entry fill (Koa 2026-11-18): a per-day switch, off unless turned on,
// and this hour's Hourly entry row against what the cells add up to.
// The day's crew goal (lib/cell-goal.js): the one the TV, crew board and Mis
// números grade on. Set here with the farm password; a loaded sheet's goal stands.
function renderGoal() {
  el.goalRow.hidden = !SHOW_GOAL;
  if (!SHOW_GOAL) return;
  const g = state.goal;
  if (document.activeElement !== el.goalInput) el.goalInput.value = g ? g.lbHr.toFixed(2) : '';
  const sheet = g?.source === 'sheet';
  el.goalInput.disabled = sheet; el.goalSave.disabled = sheet;
  el.goalState.textContent = !g ? t('goalNone')
    : g.source === 'default' ? tf('goalDefault', { c: g.cultivar })
    : g.source === 'carried' ? tf('goalCarried', { d: g.date.slice(5).replace('-', '/') })
    : t(sheet ? 'goalSheet' : 'goalSet');
}
function renderFill() {
  const f = state.fill || { on: false, slots: [] };
  el.fillOn.checked = !!f.on;
  const s = f.slots.find(x => x.slot === state.slot);
  const lb = v => (Number(v) || 0).toFixed(2);
  let text = '';
  if (s && s.state === 'filled') text = tf('fillFilled', { lb: lb(s.hourly?.tops), n: s.hourly?.trimmers ?? 0 });
  else if (s && s.state === 'hand' && s.cells) text = tf('fillHand', { lb: lb(s.hourly?.tops), c: lb(s.cells.tops) });
  else if (s && s.state === 'hand') text = tf('fillHandOnly', { lb: lb(s.hourly?.tops) });
  if (s?.cells?.mixed?.length) text += (text ? ' · ' : '') + tf('fillMixed', { list: s.cells.mixed.join(', ') });
  el.fillState.textContent = text;
  el.fillState.className = 'muted small fill-state' + (s?.state === 'hand' && s.cells && Math.abs((s.hourly?.tops || 0) - (s.cells.tops || 0)) >= 0.05 ? ' differ' : '');
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
    if (typedTops(c.stationId) != null) typedN++; else scaleN++;
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
function renderCell(force = false) {
  const c = cell();
  if (!c) return;
  const r = row();
  el.label.textContent = c.label;
  el.cellId.textContent = c.stationId;
  el.lane.textContent = t(c.lane);
  el.lane.className = `lane ${c.lane}`;
  // A refresh never redraws under a person typing; an entry step (force) always does.
  if (force || !el.people.contains(document.activeElement)) renderPeople(c);
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
    const typed = typedTops(c.stationId);
    el.overrideNote.hidden = typed == null;
    el.overrideNote.textContent = t('overrideNote');
    const off = typed != null && a.tops > 0 ? Math.abs(typed - a.tops) / a.tops : 0;
    el.diffFlag.hidden = !(off > DIFF_FLAG);
    el.diffFlag.textContent = tf('differ', { pct: Math.round(off * 100) });
    el.tareFlag.hidden = a.flag !== 'scaleTared';
  }
  renderQuality(c);
  fillCultivars(el.cellCultivar, r.cultivar && r.cultivar !== roomCultivar() ? r.cultivar : '', true);
  el.editBox.hidden = true;
  renderStatus();
}
function renderGrid() {
  el.grid.innerHTML = '';
  const list = cells();
  let done = 0;
  const usedIds = new Set(usedCells().map(c => c.stationId));
  list.forEach((c, i) => {
    // Green once tops are in. Red marks: the day's quality fails at this cell
    // (a filled red tile = a STOP today).
    const has = eff(c.stationId) != null;
    if (has) done++;
    const day = SHOW_QUALITY ? batchesFor(c.stationId) : [];
    const fails = day.filter(x => overall(x.checks) === 'fail').length;
    const stop = day.some(x => stopFor(x.checks));
    const b = document.createElement('button');
    b.className = 'jump' + (has ? ' done' : '') + (SHOW_QUALITY && qOf(c.stationId)?.quality === 'fail' ? ' failq' : '') + (stop ? ' stopq' : '')
      + (!usedIds.has(c.stationId) ? ' empty' : '')
      + (i === state.cellIdx ? ' current' : '') + (c.lane === 'retail' ? ' retail' : '') + (hasScale(c.stationId) ? ' scale' : '');
    b.innerHTML = `<b>${c.stationId.replace(/^table/, '')}</b>`;
    b.appendChild(document.createTextNode(c.label));
    const who = shownPeople(c.stationId);
    if (who.length) { const s = document.createElement('small'); s.className = 'who' + (who.every(p => !p.saved) ? ' carried' : ''); s.textContent = who.map(p => firstName(p.personId)).join(' / '); b.appendChild(s); }
    if (fails) { const s = document.createElement('small'); s.className = 'qfail'; s.textContent = `✕ ${fails}`; s.title = t('qFailsToday'); b.appendChild(s); }
    b.title = c.label;
    b.addEventListener('click', () => { openCell(i); renderCell(true); renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.grid.appendChild(b);
  });
  el.gridTitle.textContent = t('jump');
  renderStop();
  renderGuided();
  el.doneCount.textContent = `${done}/${usedIds.size} ${t('entered')}`;
  renderHours();
}
function renderAll() { renderRoom(); renderCell(true); renderGrid(); renderBag(); }

// ---- load ----
async function loadCrew() {
  try {
    const d = await api('POST', 'crewHourDay', { date: DATE });
    crew.slots = d.slots; crew.people = d.people;
    const longOf = short => d.slots.find(s => s.slot === short)?.long;
    const fresh = new Map();
    for (const h of d.hours) {
      const long = longOf(h.slot); if (!long) continue;
      fresh.set(pkey(h.personId, long), { ...h, long, short: h.slot });
    }
    // An edit still on its way keeps its local value.
    for (const q of queue.values()) {
      if (q.kind !== 'crewHourSave') continue;
      const long = longOf(q.payload.slot); const k = pkey(q.payload.personId, long);
      if (q.payload.clear) fresh.delete(k);
      else fresh.set(k, { personId: q.payload.personId, long, short: q.payload.slot, stationId: q.payload.stationId, cell: stationNum(q.payload.stationId), lb: q.payload.lb, min: q.payload.min, seq: q.payload.seq, src: 'typed' });
    }
    crew.ph = fresh; crew.ok = true; crew.err = null;
  } catch (e) { crew.err = e; }
}
async function load() {
  const [d] = await Promise.all([api('GET', 'cellHourly', null, { date: DATE }), loadCrew()]);
  state.slots = d.slots; state.roster = d.roster;
  state.auto = new Map((d.auto || []).map(a => [rowKey(a.slot, a.stationId), a]));
  state.fill = d.fill || { on: false, slots: [] };
  state.goal = d.goal || null;
  for (const r of d.rows) {
    const key = rowKey(r.slot, r.stationId);
    const local = state.rows.get(key) || {};
    const merged = { ...r };
    // Keep this tablet's unsaved edits over what the server had.
    for (const f of ['notes', 'cultivar']) if (pending(r.slot, r.stationId, f)) merged[f] = local[f];
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

// ---- people: render, pick, save ----
const gText = lb => (lb === '' || lb == null || !Number.isFinite(Number(lb)) ? '' : `${Math.round(Number(lb) * 453.59237)} g`);
function renderPeople(c) {
  if (!crew.ok) { el.people.innerHTML = `<div class="muted">${esc(t(crew.err ? 'peopleFail' : 'loadingPeople'))}</div>`; return; }
  const list = shownPeople(c.stationId);
  const sm = slotMin();
  // Minutes stay out of sight in the normal case (Koa 2026-11-18: "I don't want this
  // popping up unless absolutely necessary"): only a split hour shows them.
  const split = list.length > 1 || list.some(p => p.min != null && Number(p.min) !== sm);
  el.people.innerHTML = list.map(p => `
    <div class="person${p.saved ? '' : ' waiting'}" data-pid="${p.personId}" data-seq="${p.seq || 1}">
      <div class="person-top">
        <button type="button" class="pname" data-act="replace">${esc(nameOf(p.personId))} <span aria-hidden="true">▾</span></button>
        <span class="muted small">${p.saved ? '' : esc(t(p.carried ? 'carried' : 'waiting'))}</span>
        <button type="button" class="pdel" data-act="remove" title="${esc(t('removePerson'))}" aria-label="${esc(t('removePerson'))}">✕</button>
      </div>
      <div class="person-in${split ? '' : ' solo'}">
        <span class="tops-wrap"><input class="p-lb" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" placeholder="0.00" value="${esc(p.lb === '' || p.lb == null ? '' : p.lb)}"><span class="unit">lb</span></span>
        ${split
    ? `<label class="p-minw"><input class="p-min" type="number" min="0" max="120" inputmode="numeric" value="${esc(p.min ?? sm)}"><span class="muted small">min</span></label>`
    : `<input class="p-min" type="hidden" value="${esc(p.min ?? sm)}">`}
      </div>
      <div class="muted small p-g">${gText(p.lb)}</div>
    </div>`).join('')
    + (list.length
      // One person per cell (Koa 2026-11-18): the only change in an hour is someone taking over.
      ? (list.length < 2 ? `<div class="person-acts"><button type="button" class="btn ghost" data-act="cover">${esc(t('cover'))}</button></div>` : '')
      : `<button type="button" class="btn primary who-btn" data-act="assign">${esc(t('whoHere'))}</button>`);
}
function stampCultivar(station, long) {
  // A cell's first weight of the hour takes the room's cultivar (as before).
  const r = row(station, long);
  const cv = roomCultivar(long);
  if (r.cultivar || !cv) return;
  state.rows.set(rowKey(long, station), { ...r, stationId: station, slot: long, cultivar: cv });
  enqueue('setCellHourly', { slot: long, stationId: station, cultivar: cv }, 'cultivar', `${long}|${station}`);
}
function savePerson(station, personId, vals) {
  const long = state.slot; const short = shortOf(long);
  if (!short) return;
  const rec = { personId, long, short, stationId: station, cell: stationNum(station), lb: vals.lb, min: vals.min, seq: vals.seq || 1, src: 'typed' };
  crew.ph.set(pkey(personId, long), rec);     // also takes them off another cell this hour
  const dk = rowKey(long, station);
  crew.drafts.set(dk, (crew.drafts.get(dk) || []).filter(d => d.personId !== personId));
  enqueue('crewHourSave', { slot: short, stationId: station, personId, lb: vals.lb, min: vals.min, seq: rec.seq }, `p${personId}`, `${long}|${station}`);
  stampCultivar(station, long);
}
function clearPerson(station, personId) {
  const long = state.slot; const short = shortOf(long);
  crew.ph.delete(pkey(personId, long));
  enqueue('crewHourSave', { slot: short, stationId: station, personId, clear: true }, `p${personId}`, `${long}|${station}`);
}
function setDrafts(station, list) { crew.drafts.set(rowKey(state.slot, station), list); }
function refreshCell() { renderCell(true); renderGrid(); renderBag(); }
function focusPerson(id) {
  const i = (id != null && el.people.querySelector(`.person[data-pid="${id}"] .p-lb`)) || el.people.querySelector('.p-lb');
  if (i) i.focus();
}

// Save one person's tops. Returns true when saved.
function commitPerson(pEl) {
  const c = cell(); if (!c) return false;
  const id = Number(pEl.dataset.pid);
  const raw = pEl.querySelector('.p-lb').value.trim();
  if (raw === '') return false;
  const lb = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(lb) || lb < 0) return false;
  if (lb > CONFIRM_OVER_LB && !window.confirm(tf('confirmBig', { lb: lb.toFixed(2) }))) return false;
  const m = pEl.querySelector('.p-min').value.trim();
  const min = m !== '' && Number.isFinite(Number(m)) ? Math.max(0, Math.min(120, Math.round(Number(m)))) : slotMin();
  savePerson(c.stationId, id, { lb, min, seq: Number(pEl.dataset.seq) || 1 });
  return true;
}
// Enter on the last person's tops: save and go to the next cell, keypad still up.
function nextCellFocused() {
  // Guided mode: the next cell still to do; none left = the hour's check.
  if (guided.on) {
    // After tops, the cell's quality (not required: Next skips it).
    const here = cell();
    if (here && wantsQuality(here.stationId)) {
      refreshCell(); el.quality.querySelector('.q-ok')?.focus(); return;
    }
    const j = guidedNext();
    if (j >= 0) { openCell(j); refreshCell(); focusPerson(); } else { refreshCell(); document.activeElement?.blur?.(); }
    return;
  }
  // First hour with people (placing them): walk every cell. After that: the next
  // cell with someone on it, then back to the first one still missing tops.
  const list = cells(); const used = new Set(usedCells().map(c => c.stationId));
  const h = state.slots.findIndex(s => s.slot === state.slot);
  const placing = h <= 0 || !usedCells(state.slots[h - 1].slot).length;
  const after = list.findIndex((c, k) => k > state.cellIdx && used.has(c.stationId));
  let next;
  if (placing) next = (state.cellIdx + 1) % list.length;
  else if (after >= 0) next = after;
  else {
    const open = list.findIndex(c => used.has(c.stationId) && eff(c.stationId) == null);
    next = open >= 0 ? open : Math.max(0, list.findIndex(c => used.has(c.stationId)));
  }
  openCell(next);
  refreshCell();
  focusPerson();
}
el.people.addEventListener('input', e => {
  if (!e.target.classList.contains('p-lb')) return;
  e.target.closest('.person').querySelector('.p-g').textContent = gText(e.target.value);
});
el.people.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('p-lb')) return;
  e.preventDefault();
  const pEl = e.target.closest('.person');
  const all = [...el.people.querySelectorAll('.person')];
  const nextId = all[all.indexOf(pEl) + 1]?.dataset.pid;
  committing = true;
  commitPerson(pEl);
  committing = false;
  if (nextId) { renderCell(true); focusPerson(Number(nextId)); } else nextCellFocused();
});
let committing = false;
el.people.addEventListener('change', e => {
  if (committing) return;
  const pEl = e.target.closest('.person'); if (!pEl) return;
  const c = cell(); const id = Number(pEl.dataset.pid);
  if (e.target.classList.contains('p-lb')) { if (commitPerson(pEl)) { renderGrid(); renderBag(); } return; }
  if (e.target.classList.contains('p-min')) {
    const saved = crew.ph.get(pkey(id, state.slot));
    const min = Math.max(0, Math.min(120, Math.round(Number(e.target.value) || 0)));
    if (saved) savePerson(c.stationId, id, { lb: saved.lb, min, seq: saved.seq });
    else setDrafts(c.stationId, shownPeople(c.stationId).filter(p => !p.saved).map(p => (p.personId === id ? { ...p, min, carried: false } : { ...p, carried: false })));
  }
});
el.people.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const c = cell(); const pEl = b.closest('.person'); const id = pEl ? Number(pEl.dataset.pid) : null;
  const act = b.dataset.act;
  if (act === 'remove') {
    if (crew.ph.has(pkey(id, state.slot))) clearPerson(c.stationId, id);
    const rest = shownPeople(c.stationId).filter(p => !p.saved && p.personId !== id).map(p => ({ ...p, carried: false }));
    setDrafts(c.stationId, rest);
    if (!rest.length) crew.dismissed.add(rowKey(state.slot, c.stationId));
    refreshCell();
  } else if (act === 'replace') openPicker('replace', id);
  else if (act === 'cover') { const list = shownPeople(c.stationId); openPicker('cover', list[list.length - 1]?.personId); }
  else if (act === 'assign') openPicker('assign');
});

// The person picker: search the crew list, or add a new name.
const pick = { mode: null, personId: null };
function defaultLeft() {
  const sm = slotMin();
  if (DATE !== pacificToday().day) return Math.round(sm / 2);
  const m = state.slot.match(/(\d{1,2}):(\d{2}) (AM|PM)/);
  let h = +m[1] % 12; if (m[3] === 'PM') h += 12;
  const into = pacificToday().minutes - (h * 60 + +m[2]);
  return into > 0 && into < sm ? into : Math.round(sm / 2);
}
function openPicker(mode, personId = null) {
  const c = cell(); if (!c || !crew.ok) return;
  pick.mode = mode; pick.personId = personId;
  const n = personId != null ? nameOf(personId) : '';
  el.pickTitle.textContent = tf({ assign: 'pickAssign', replace: 'pickReplace', cover: 'pickCover' }[mode], { c: c.label, n });
  el.pickLeftWrap.hidden = mode !== 'cover';

  if (mode === 'cover') { el.pickLeftLabel.textContent = tf('leftAfter', { n: firstName(personId) }); el.pickLeft.value = String(defaultLeft()); }
  el.pickSearch.value = '';
  renderPick();
  el.picker.hidden = false;
  el.pickSearch.focus();
  if (guided.on) renderGuided();
}
function closePicker() { el.picker.hidden = true; pick.mode = null; if (guided.on) renderGuided(); }
function renderPick() {
  const c = cell();
  const here = new Set(shownPeople(c.stationId).map(p => p.personId));
  const q = fold(el.pickSearch.value.trim());
  const list = crew.people.filter(p => !here.has(p.id) && (!q || fold(p.name).includes(q))).slice(0, 12);
  const elsewhere = id => { const h = crew.ph.get(pkey(id, state.slot)); return h && h.stationId && h.stationId !== c.stationId ? labelOf(h.stationId) : null; };
  const exact = crew.people.some(p => fold(p.name) === q);
  el.pickList.innerHTML = list.map(p => { const w = elsewhere(p.id); return `<button type="button" class="btn ghost" data-pick="${p.id}">${esc(p.name)}${w ? ` <small>${esc(tf('onCell', { c: w }))}</small>` : ''}</button>`; }).join('')
    + (q.length >= 2 && !exact ? `<button type="button" class="btn primary" data-new="1">${esc(tf('addNew', { n: el.pickSearch.value.trim() }))}</button>` : '');
}
function choose(id) {
  const c = cell(); const sm = slotMin();
  const mode = pick.mode;
  const list = shownPeople(c.stationId);
  const old = list.find(p => p.personId === pick.personId);
  const unsaved = list.filter(p => !p.saved).map(p => ({ ...p, carried: false }));
  crew.dismissed.delete(rowKey(state.slot, c.stationId));
  let focusId = id;
  if (mode === 'assign') {
    setDrafts(c.stationId, [...unsaved, { personId: id, lb: '', min: sm, seq: 1 }]);
  } else if (mode === 'replace' && old) {
    // The whole hour goes to the person picked; typed tops move with it.
    if (old.saved) { clearPerson(c.stationId, old.personId); savePerson(c.stationId, id, { lb: old.lb, min: old.min, seq: old.seq || 1 }); setDrafts(c.stationId, unsaved); }
    else setDrafts(c.stationId, unsaved.map(p => (p.personId === old.personId ? { ...p, personId: id } : p)));
  } else if (mode === 'cover' && old) {
    // The one who left keeps their minutes; the cover gets the rest of the hour.
    const left = Math.max(0, Math.min(sm, Math.round(Number(el.pickLeft.value) || 0)));
    let rest = unsaved;
    if (old.saved) savePerson(c.stationId, old.personId, { lb: old.lb, min: left, seq: 1 });
    else { rest = unsaved.map(p => (p.personId === old.personId ? { ...p, min: left, seq: 1 } : p)); focusId = old.personId; }
    setDrafts(c.stationId, [...rest, { personId: id, lb: '', min: sm - left, seq: 2 }]);
  }
  closePicker();
  refreshCell();
  focusPerson(focusId);
}
el.pickSearch.addEventListener('input', renderPick);
el.pickClose.addEventListener('click', closePicker);
el.pickList.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pick) { choose(Number(b.dataset.pick)); return; }
  if (b.dataset.new) {
    b.disabled = true;
    try {
      const r = await api('POST', 'crewPersonAdd', { name: el.pickSearch.value.trim() });
      if (!crew.people.some(p => p.id === r.person.id)) crew.people.push(r.person);
      crew.people.sort((a, c) => a.name.localeCompare(c.name));
      choose(r.person.id);
    } catch { b.disabled = false; }
  }
});

// ---- guided mode (Koa 2026-11-18: "a walkthrough that helps them enter in
// everyone's numbers correctly") ----
// "Start this hour" walks the lead one cell at a time, says what to do on each,
// and ends the hour with a check: cells still missing, numbers that look off,
// and anyone who changed cells. Nothing new is saved here; it drives the same
// entry (tops, Enter) and jumps to cells to fix.
const guided = { on: false, skipped: new Set(), qSkip: new Set(), slot: null };
const LOOKS_HIGH_LB = 3;      // more than this in one hour is probably grams typed as lb
function guidedPlacing() {
  const h = state.slots.findIndex(s => s.slot === state.slot);
  return h <= 0 || !usedCells(state.slots[h - 1].slot).length;
}
// The cells this hour's walk goes through: in the first hour every cell (to place
// people), after that the cells in use.
function guidedTargets() { return guidedPlacing() ? cells() : usedCells(); }
function guidedTodo() {
  return guidedTargets().filter(c => eff(c.stationId) == null && !guided.skipped.has(c.stationId));
}
function guidedStart() {
  guided.on = true; guided.skipped.clear(); guided.qSkip.clear(); guided.slot = state.slot;
  const todo = guidedTodo();
  if (todo.length) openCell(cells().findIndex(c => c.stationId === todo[0].stationId));
  refreshCell();
  focusPerson();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function guidedStop() { guided.on = false; document.body.classList.remove('guide-review'); guidedHighlight(false); renderGuided(); }
// The next cell to do after the current one (wrapping), or -1 when the hour is done.
function guidedNext() {
  const todo = new Set(guidedTodo().map(c => c.stationId));
  const list = cells();
  for (let k = 1; k <= list.length; k++) {
    const j = (state.cellIdx + k) % list.length;
    if (todo.has(list[j].stationId)) return j;
  }
  return -1;
}
// The end-of-hour check: what to look at before moving on.
function guidedReview() {
  const items = [];
  const h = state.slots.findIndex(s => s.slot === state.slot);
  const prev = h > 0 ? state.slots[h - 1].slot : null;
  for (const c of guidedTargets()) {
    if (guided.skipped.has(c.stationId)) continue;
    if (eff(c.stationId) == null) { items.push({ station: c.stationId, text: tf('gMissing', { c: c.label }) }); continue; }
    for (const p of savedAt(c.stationId)) {
      const name = nameOf(p.personId);
      const lb = Number(p.lb) || 0; const min = Number(p.min) || 0;
      if (lb > LOOKS_HIGH_LB) items.push({ station: c.stationId, text: tf('gHigh', { n: name, lb: lb.toFixed(2) }) });
      else if (lb === 0 && min > 0) items.push({ station: c.stationId, text: tf('gZero', { n: name }) });
      else {
        // far from their own pace earlier today
        let g = 0, m = 0;
        for (const x of crew.ph.values()) if (x.personId === p.personId && x.long !== state.slot && (Number(x.min) || 0) > 0) { g += Number(x.lb) || 0; m += Number(x.min) || 0; }
        const usual = m >= 60 ? g / (m / 60) : null;
        const now = min > 0 ? lb / (min / 60) : null;
        if (usual && now !== null && usual > 0.05 && (now > usual * 2 || now < usual * 0.4)) {
          items.push({ station: c.stationId, text: tf('gOff', { n: name, lb: lb.toFixed(2), u: usual.toFixed(2) }) });
        }
      }
      if (prev) {
        const before = crew.ph.get(pkey(p.personId, prev));
        if (before?.stationId && before.stationId !== c.stationId) items.push({ station: c.stationId, text: tf('gMoved', { n: name, a: labelOf(before.stationId), b: c.label }) });
      }
    }
  }
  const noQ = SHOW_QUALITY ? guidedTargets().filter(c => !guided.skipped.has(c.stationId) && eff(c.stationId) != null && !qOf(c.stationId)) : [];
  if (noQ.length) items.push({ station: noQ[0].stationId, text: tf('gNoQuality', { list: noQ.map(c => c.label).join(', ') }) });
  if (SHOW_QUALITY) for (const c of guidedTargets()) if (qOf(c.stationId)?.quality === 'fail') items.push({ station: c.stationId, text: tf('gRedoQ', { c: c.label }) });
  if (!roomCultivar()) items.push({ room: true, text: t('gNoCultivar') });
  return items;
}
// Light up the one thing to do next (Koa 2026-11-18: "maybe it can highlight what
// needs to happen"): the person picker, the who-is-on-it button, or the tops box.
function guidedHighlight(onTodo) {
  document.querySelectorAll('.g-focus').forEach(x => x.classList.remove('g-focus'));
  if (!guided.on || !onTodo) {
    // Tops in, quality not yet: the ring moves to Quality OK.
    const c = cell();
    if (guided.on && c && wantsQuality(c.stationId)) {
      const ok = el.quality.querySelector('.q-ok'); if (ok) ok.classList.add('g-focus');
    }
    return;
  }
  let target = null;
  if (!el.picker.hidden) target = el.pickSearch;
  else target = el.people.querySelector('.who-btn')
    || [...el.people.querySelectorAll('.p-lb')].find(i => i.value.trim() === '')?.closest('.tops-wrap')
    || el.quality.querySelector('.q-ok');
  if (!target) return;
  target.classList.add('g-focus');
  const r = target.getBoundingClientRect();
  const top = el.guide.getBoundingClientRect().bottom;
  if (r.top < top + 8 || r.bottom > window.innerHeight - 8) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderGuided() {
  const box = el.guide;
  document.body.classList.toggle('guided', guided.on);
  el.guideStart.hidden = guided.on || state.view !== 'weights' || !crew.ok;
  if (!guided.on) { box.hidden = true; return; }
  if (guided.slot !== state.slot) { guided.slot = state.slot; guided.skipped.clear(); guided.qSkip.clear(); }
  box.hidden = false;
  const targets = guidedTargets().filter(c => !guided.skipped.has(c.stationId));
  const todo = guidedTodo();
  const done = targets.length - todo.length;
  const hourName = state.slot.replace(/:00/g, '').replace(' – ', '–');
  el.guideBar.style.width = `${targets.length ? Math.round(done / targets.length * 100) : 100}%`;
  el.guideCount.textContent = tf('gCount', { d: done, n: targets.length, h: hourName });
  // The cell on screen still waiting for its quality comes before the hour's check.
  const here = cell();
  const hereNeedsQ = here && wantsQuality(here.stationId);
  if (!todo.length && !hereNeedsQ) {
    const items = guidedReview();
    el.guideStep.innerHTML = `<b>${esc(tf('gReviewTitle', { h: hourName }))}</b>`
      + (items.length
        ? `<p class="g-sub">${esc(t('gReviewSub'))}</p><ul class="g-list">${items.map((it, i) => `<li><button type="button" class="g-item" data-gi="${i}">${esc(it.text)} ›</button></li>`).join('')}</ul>`
        : `<p class="g-ok">✓ ${esc(t('gAllGood'))}</p>`);
    guidedHighlight(false);
    document.body.classList.add('guide-review');
    el.guideSkip.hidden = true;
    el.guideRest.hidden = true;
    el.guideNext.hidden = true;
    el.guideDone.hidden = false;
    guided.items = items;
    return;
  }
  const c = cell();
  const onTodo = todo.some(x => x.stationId === c?.stationId);
  const who = c ? shownPeople(c.stationId) : [];
  let text;
  const needsQ = c && wantsQuality(c.stationId);
  if (!onTodo && needsQ) text = tf('gQuality', { c: c.label });
  else if (!onTodo) text = t('gGoNext');
  else if (!who.length) text = tf('gWho', { c: c.label });
  else if (who.length > 1) text = tf('gTwo', { c: c.label, a: nameOf(who[0].personId), b: nameOf(who[1].personId) });
  else text = tf('gType', { c: c.label, n: nameOf(who[0].personId) });
  el.guideStep.innerHTML = `<b>${esc(text)}</b>${onTodo && who.length ? `<p class="g-sub">${esc(t('gTypeSub'))}</p>` : ''}`;
  document.body.classList.remove('guide-review');
  guidedHighlight(onTodo);
  el.guideSkip.hidden = !onTodo;
  // Placing people in the first hour: the rest of the empty cells can go in one tap.
  el.guideRest.hidden = !(onTodo && !who.length && guidedPlacing());
  el.guideNext.hidden = onTodo;
  el.guideDone.hidden = true;
}
el.guideStart.addEventListener('click', guidedStart);
el.guideExit.addEventListener('click', guidedStop);
el.guideDone.addEventListener('click', guidedStop);
el.guideNext.addEventListener('click', () => {
  const here = cell(); if (here) guided.qSkip.add(here.stationId);   // quality is never required
  const j = guidedNext(); if (j < 0) { renderGuided(); return; }
  openCell(j); refreshCell(); focusPerson();
});
el.guideRest.addEventListener('click', () => {
  for (const c of guidedTodo()) if (!shownPeople(c.stationId).length) guided.skipped.add(c.stationId);
  nextCellFocused();
});
el.guideSkip.addEventListener('click', () => {
  const c = cell(); if (!c) return;
  guided.skipped.add(c.stationId);
  nextCellFocused();
});
el.guideStep.addEventListener('click', e => {
  const b = e.target.closest('[data-gi]'); if (!b) return;
  const it = (guided.items || [])[Number(b.dataset.gi)]; if (!it) return;
  if (it.room) { el.roomCultivar.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  openCell(cells().findIndex(c => c.stationId === it.station));
  refreshCell();
  focusPerson();
  el.people.scrollIntoView({ behavior: 'smooth', block: 'center' });   // below the sticky banner
});

// ---- events ----
el.prev.addEventListener('click', () => { openCell((state.cellIdx - 1 + cells().length) % cells().length); renderCell(true); renderGrid(); });
el.next.addEventListener('click', () => { openCell((state.cellIdx + 1) % cells().length); renderCell(true); renderGrid(); });
el.cellCultivar.addEventListener('change', () => { setCellField('cultivar', el.cellCultivar.value || roomCultivar() || null); renderCell(); });

el.goalSave.addEventListener('click', async () => {
  const v = el.goalInput.value.trim();
  el.goalSave.disabled = true;
  try {
    const r = await api('POST', 'crewGoalSet', { date: DATE, lbHr: v === '' ? null : Number(v) });
    state.goal = (r.data || r).goal || null;
    el.goalInput.blur(); renderGoal();
  } catch { el.goalState.textContent = `✕ ${t('notSaved')}`; }
  finally { el.goalSave.disabled = state.goal?.source === 'sheet'; }
});
el.goalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.goalSave.click(); });
el.fillOn.addEventListener('change', async () => {
  const on = el.fillOn.checked;
  if (!window.confirm(t(on ? 'fillConfirmOn' : 'fillConfirmOff'))) { el.fillOn.checked = !on; return; }
  el.fillOn.disabled = true;
  try { await api('POST', 'cellFillSet', { date: DATE, on }); await load(); renderAll(); }
  catch { el.fillOn.checked = !on; el.roomStatus.className = 'save-status bad'; el.roomStatus.textContent = `✕ ${t('notSaved')}`; }
  finally { el.fillOn.disabled = false; }
});
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
// Type-to-search on both cultivar pickers (Koa 2026-11-09).
for (const s of [el.roomCultivar, el.cellCultivar]) enhanceSelect(s, { placeholder: () => t('searchCultivar') });
load().then(() => { renderAll(); loadCultivars(); }).catch(() => { el.cellStatus.className = 'save-status bad'; el.cellStatus.textContent = t('loadFail'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.slots.length) return;
  load().then(renderAll).catch(() => {});
});
setInterval(() => { if (!document.hidden) load().then(() => { renderRoom(); renderGrid(); renderBag(); if (!el.editBox.hidden) return; renderCell(); }).catch(() => {}); }, REFRESH_MS);
