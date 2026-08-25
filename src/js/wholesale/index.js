/**
 * Wholesale order board — entry point.
 *
 * Replaces the Wholesale Orders app retired in 611da09e. That one could only
 * hold a single strain and one kg total per order, so multi-cultivar orders
 * lived in a notes field; this one stores them as rows and shows them on the
 * card.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { api, state, loadAll, loadCoverage, STATUSES, statusLabel, option } from './state.js';
import { renderOffQueue } from './render.js';
import {
  loadQueue, renderQueue, onOpenOrder, onDeleteOrder, onEditLines, onEditOrder,
} from './queue.js';
import {
  openEditor, closeEditor, saveOrder, deleteOrder, addLine, onBuildStatus,
  patchOrder,
} from './editor.js';
import { registerLabels, t, toggleLang, getLang } from '../shared/i18n.js';
import { initTheme, toggleTheme } from '../shared/theme.js';
import { showToast } from '../shared/toast.js';
import { ensureUnlocked, forgetPassword, hasPassword } from './auth.js';

const $ = (id) => document.getElementById(id);

registerLabels({
  en: {
    page_title: 'Wholesale Orders',
    nav_dashboard: 'Dashboard',
    nav_kanban: 'Supply Kanban',
    nav_scoreboard: 'Scoreboard',
    nav_sop: 'SOP Manager',
    nav_wholesale: 'Wholesale',
    nav_consignment: 'Consignment',
    nav_complaints: 'Complaints',
    nav_floor: 'Floor Manager',
    new_order: 'New order', nickname: 'Nickname',
    nickname_hint: 'First name or short label — no last names',
    status_in_queue: 'In queue', status_in_production: 'In production',
    status_finished: 'Finished',
    no_orders: 'No orders yet. Create the first one.',
    none_match: 'No orders match this filter.',
    no_lines: 'No line items yet',
    status: 'Status', order_date: 'Order date',
    terms: 'Payment terms', notes: 'Notes',
    line_items: 'Line items', add_line: 'Add line', line: 'Line',
    cultivar: 'Cultivar', form: 'Form', quantity: 'Quantity', unit: 'Unit',
    unit_price: 'Price/unit', remove_line: 'Remove line',
    tops: 'Tops', smalls: 'Smalls',
    pick_cultivar: 'Select cultivar…',
    save: 'Save', cancel: 'Cancel', delete: 'Delete',
    saved: 'saved', deleted: 'deleted',
    confirm_delete: 'Delete order',
    edit_order: 'Edit order', order_ref: 'Shopify order #',
    trim_order: 'Order',
    just_now: 'just now', updated: 'updated', forget_password: 'Clear password',
    today: 'today',
    unmatched: 'Production not counted — no cultivar match',
    bell_on: 'Telegram updates on — tap to mute',
    bell_off: 'Telegram updates off — tap to enable',
    bell_enabled: 'Telegram updates on', bell_disabled: 'Telegram updates off',
    move_up: 'Move up, line', move_down: 'Move down, line',
    err_cultivar: 'pick a cultivar.',
    err_qty: 'quantity must be greater than zero.',
    err_last_line: 'An order needs at least one line. Delete the order instead.',
    load_failed: 'Could not load orders',
    view_board: 'Orders', view_queue: 'Production queue',
    crew: 'Crew', crew_use_derived: 'Use derived', recalculate: 'Recalculate',
    crew_override: 'manual override', crew_derived: 'derived from the last', days: 'production days',
    clears: 'queue clears', times: 'times', lot: 'Lot',
    done: 'done', spare: 'spare', none_packed: 'none packed', short: 'short',
    takes: 'Takes', work_days: 'work days', rate: 'Rate', basis: 'Basis',
    measured: 'Measured', stock: 'Stock', details: 'details',
    per_hr: 'lb/trimmer-hr',
    no_history: 'No history', loading: 'Loading…',
    queue_empty: 'Nothing to schedule. Only open and in-production orders are queued.',
    queue_failed: 'Could not load the queue',
    imported: 'imported',
    completed: 'Not in the queue', none_off_queue: 'Every order is in the queue.',
    raw_sacks: 'raw sacks', no_raw: 'no raw sacks',
    unlock_title: 'Password required',
    unlock_help: 'Saving changes needs the operations password — the same one Consignment uses.',
    password: 'Password', unlock: 'Unlock',
    err_password: 'Enter the password.',
    err_password_bad: 'Incorrect password.',
    err_connection: 'Could not reach the server.',
    relock: 'Password cleared',
  },
  es: {
    page_title: 'Pedidos Mayoristas',
    nav_dashboard: 'Panel',
    nav_kanban: 'Kanban',
    nav_scoreboard: 'Marcador',
    nav_sop: 'Gestor SOP',
    nav_wholesale: 'Mayoristas',
    nav_consignment: 'Consignación',
    nav_complaints: 'Quejas',
    nav_floor: 'Gestor de Piso',
    new_order: 'Nuevo pedido', nickname: 'Apodo',
    nickname_hint: 'Nombre de pila o etiqueta corta — sin apellidos',
    status_in_queue: 'En cola', status_in_production: 'En producción',
    status_finished: 'Terminado',
    no_orders: 'Aún no hay pedidos. Cree el primero.',
    none_match: 'Ningún pedido coincide con este filtro.',
    no_lines: 'Sin renglones todavía',
    status: 'Estado', order_date: 'Fecha del pedido',
    terms: 'Términos de pago', notes: 'Notas',
    line_items: 'Renglones', add_line: 'Agregar renglón', line: 'Renglón',
    cultivar: 'Cultivar', form: 'Tipo', quantity: 'Cantidad', unit: 'Unidad',
    unit_price: 'Precio/unidad', remove_line: 'Quitar renglón',
    tops: 'Tops', smalls: 'Smalls',
    pick_cultivar: 'Seleccione cultivar…',
    save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar',
    saved: 'guardado', deleted: 'eliminado',
    confirm_delete: 'Eliminar pedido',
    edit_order: 'Editar pedido', order_ref: 'Pedido Shopify n.º',
    trim_order: 'Orden',
    just_now: 'ahora', updated: 'hace', forget_password: 'Borrar contraseña',
    today: 'hoy',
    unmatched: 'Producción sin contar — sin coincidencia de cultivar',
    bell_on: 'Avisos de Telegram activados — toque para silenciar',
    bell_off: 'Avisos de Telegram desactivados — toque para activar',
    bell_enabled: 'Avisos de Telegram activados', bell_disabled: 'Avisos de Telegram desactivados',
    move_up: 'Subir, línea', move_down: 'Bajar, línea',
    err_cultivar: 'seleccione un cultivar.',
    err_qty: 'la cantidad debe ser mayor que cero.',
    err_last_line: 'Un pedido necesita al menos una línea. Elimine el pedido.',
    load_failed: 'No se pudieron cargar los pedidos',
    view_board: 'Pedidos', view_queue: 'Cola de producción',
    crew: 'Equipo', crew_use_derived: 'Usar calculado', recalculate: 'Recalcular',
    crew_override: 'ajuste manual', crew_derived: 'calculado de los últimos', days: 'días de producción',
    clears: 'la cola termina', times: 'horas', lot: 'Lote',
    done: 'listo', spare: 'sobrante', none_packed: 'nada empacado', short: 'faltante',
    takes: 'Toma', work_days: 'días de trabajo', rate: 'Tasa', basis: 'Base',
    measured: 'Medido', stock: 'Inventario', details: 'detalles',
    per_hr: 'lb/podador-hr',
    no_history: 'Sin historial', loading: 'Cargando…',
    queue_empty: 'Nada que programar. Solo se programan pedidos abiertos y en producción.',
    queue_failed: 'No se pudo cargar la cola',
    imported: 'importado',
    completed: 'Fuera de la cola', none_off_queue: 'Todos los pedidos están en la cola.',
    raw_sacks: 'sacos crudos', no_raw: 'sin sacos crudos',
    unlock_title: 'Se requiere contraseña',
    unlock_help: 'Para guardar cambios se necesita la contraseña de operaciones — la misma que usa Consignación.',
    password: 'Contraseña', unlock: 'Desbloquear',
    err_password: 'Ingrese la contraseña.',
    err_password_bad: 'Contraseña incorrecta.',
    err_connection: 'No se pudo conectar con el servidor.',
    relock: 'Contraseña borrada',
  },
});

function buildStatusOptions(current) {
  const sel = $('f-status');
  sel.textContent = '';
  // A row may hold a status this build does not offer — a mid-deploy front end
  // against a newer worker. Include it when present, so opening that order does
  // not silently rewrite its status on the next save.
  const list = current && !STATUSES.includes(current) ? [current, ...STATUSES] : STATUSES;
  list.forEach(s => sel.append(option(statusLabel(s), s)));
}

/**
 * The crew to ask the queue for, or undefined to let it derive one.
 *
 * The field now holds the number in force rather than sitting empty, so an
 * override has to be recognised by VALUE: typing the derived figure back in is
 * not an override, it is agreeing with the measurement.
 */
function crewOverride() {
  const typed = Number($('q-crew').value);
  if (!(typed > 0)) return undefined;
  const derived = state.queue?.derivedCrew;
  return derived != null && Math.abs(typed - derived) < 0.001 ? undefined : typed;
}

/**
 * When the board last agreed with the server.
 *
 * The queue is not static — burn-down moves as the floor records hours, and the
 * cron advances statuses every five minutes. A board that only updated when
 * somebody pressed a button was quietly wrong most of the day, and the button
 * was the only thing admitting it.
 */
let lastLoaded = 0;

function paintFreshness() {
  const el = $('freshness');
  if (!el) return;
  if (!lastLoaded) { el.textContent = ''; return; }
  const mins = Math.floor((Date.now() - lastLoaded) / 60000);
  el.textContent = mins < 1 ? t('just_now') : `${t('updated')} ${mins}m`;
  // Past a quarter of an hour the number stops being reassuring and starts
  // being a warning, which is worth looking different.
  el.classList.toggle('stale', mins >= 15);
}

/**
 * True while a refresh would destroy something the operator is in the middle of.
 *
 * `renderQueue` rebuilds every row, so an automatic reload during an inline edit
 * would take the half-typed quantity out from under them. This is the whole
 * reason the board did not refresh itself before, and it is a guard rather than
 * a reason not to.
 */
function midEdit() {
  if (!$('modal').hidden || !$('unlock-modal').hidden) return true;
  if ($('fab-wrap').classList.contains('open')) return true;
  const a = document.activeElement;
  return !!(a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
}

async function refresh() {
  try {
    await loadAll();
    // The cards show a promise date, which only the queue knows. Fetched
    // alongside rather than on demand so a card never renders a stale one.
    await Promise.all([
      loadQueue(crewOverride()),
      loadCoverage(),
    ]);
    lastLoaded = Date.now();
    paintFreshness();
    renderQueue();
    renderOffQueue();
  } catch (e) {
    showToast(`${t('load_failed')}: ${e.message || e}`, 'error');
  }
}

/**
 * The only thing the password control ever did that nothing else does is
 * FORGET one. Unlocking happens by itself at the first write that needs it, so
 * a permanent button in the header was offering a step the page already takes.
 * It shows in the settings fan, and only while there is something to clear.
 */
function paintLock() {
  const btn = $('lock-btn');
  btn.hidden = !hasPassword();
  btn.textContent = t('forget_password');
}

function wire() {
  onBuildStatus(buildStatusOptions);
  $('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  $('q-crew').setAttribute('aria-label', t('crew'));
  const paintLang = () => { $('lang-toggle').textContent = getLang() === 'es' ? 'ES' : 'EN'; };
  paintLang();
  $('lang-toggle').onclick = () => { toggleLang(); paintLang(); renderQueue(); renderOffQueue(); };

  $('lock-btn').onclick = () => {
    forgetPassword();
    showToast(t('relock'), 'info');
    paintLock();
  };

  $('dark-mode-toggle').onclick = () => toggleTheme();
  $('freshness').onclick = () => refresh();

  // Recalculate when the crew figure actually changes, rather than behind a
  // separate button — the whole queue is a function of it, so a stale board
  // sitting next to an edited number would be misleading.
  $('q-crew').onchange = () => loadQueue(crewOverride());
  $('q-reset').onclick = () => { $('q-crew').value = state.queue?.derivedCrew ?? ''; loadQueue(); };
  $('q-live').onclick = () => {
    const now = state.queue?.liveCrew;
    if (now == null) return;
    $('q-crew').value = String(now);
    loadQueue(crewOverride());
  };

  $('btn-new').onclick = () => openEditor(null);

  // Orders in the queue are reached from their runs; this covers the ones that
  // have left it.
  onOpenOrder((orderId) => {
    const order = state.orders.find(o => o.id === orderId);
    if (order) openEditor(order);
  });

  onDeleteOrder(async (orderId) => {
    const order = state.orders.find(o => o.id === orderId);
    if (order && await deleteOrder(order)) refresh();
  });

  // Quick edits made on a card. `mutate` returns the order's new line-up; an
  // unchanged list means the arrows hit an end and there is nothing to write.
  onEditLines(async (orderId, mutate) => {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    const items = mutate(order.items);
    if (items === order.items) return;
    if (!items.length) {
      showToast(t('err_last_line'), 'error');
      return;
    }
    if (await patchOrder(order, { items })) {
      paintLock();
      refresh();
    }
  });

  onEditOrder(async (orderId, fields) => {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    if (await patchOrder(order, fields)) {
      paintLock();
      refresh();
    }
  });

  // --- the settings panel -------------------------------------------------
  //
  // The board is read far more often than it is configured, so the crew figure,
  // the Telegram switch and New order live behind one button instead of a strip
  // across the top of every screen.
  const fabOpen = () => $('fab-wrap').classList.contains('open');
  const setFab = (open) => {
    $('fab-wrap').classList.toggle('open', open);
    $('fab').setAttribute('aria-expanded', String(open));
  };
  $('fab').onclick = () => setFab(!fabOpen());

  // The steppers replace the number input's own spinner, which is what used to
  // turn an empty field into a crew of 1. A step commits immediately — there is
  // no blur to wait for when the control is a button.
  const stepCrew = (by) => {
    const input = $('q-crew');
    const next = Math.max(0.5, Math.round(((Number(input.value) || 0) + by) * 2) / 2);
    input.value = String(next);
    loadQueue(crewOverride());
  };
  $('q-up').onclick = () => stepCrew(0.5);
  $('q-down').onclick = () => stepCrew(-0.5);

  // CAPTURE phase, not bubble. A pass row stops propagation so that clicking it
  // pins its detail without disturbing anything else — which also meant a click
  // on one never reached a listener waiting at the document, and the panel
  // stayed open over half the board. Capture runs on the way DOWN, before
  // anything can stop it, so the only thing that has to be excluded is the
  // panel itself and the button that opens it.
  document.addEventListener('click', (e) => {
    if (!fabOpen()) return;
    if (e.target.closest('.fab-wrap')) return;
    setFab(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fabOpen()) { setFab(false); $('fab').focus(); }
  });

  // --- Telegram updates ---------------------------------------------------
  //
  // Reads its own state from the server rather than remembering it locally: the
  // bell controls what a CRON does, so a switch that only existed in this
  // browser would go on claiming to be off while messages kept arriving.
  let bellOn = false;
  const paintBell = () => {
    const btn = $('bell-btn');
    btn.setAttribute('aria-checked', String(bellOn));
    btn.classList.toggle('on', bellOn);
    btn.title = t(bellOn ? 'bell_on' : 'bell_off');
    btn.setAttribute('aria-label', btn.title);
    // The fan is collapsed most of the time, so the state rides on the blob
    // itself — visible the moment the mass splits, at blob size.
    $('fab-wrap').classList.toggle('notifying', bellOn);
    btn.querySelector('i').className = bellOn ? 'ph ph-bell' : 'ph ph-bell-slash';
  };

  api.get('getNotify')
    .then(r => { bellOn = !!r.enabled; paintBell(); })
    .catch(() => paintBell());

  $('bell-btn').onclick = async () => {
    if (!await ensureUnlocked()) return;
    const next = !bellOn;
    try {
      const res = await api.post('setNotify', { enabled: next });
      bellOn = !!res.enabled;
      paintBell();
      paintLock();
      showToast(t(bellOn ? 'bell_enabled' : 'bell_disabled'), 'success');
    } catch (e) {
      showToast(String(e.message || e), 'error');
    }
  };

  document.addEventListener('ro:langchange', paintBell);

  $('done-toggle').onclick = () => {
    const list = $('done-list');
    const open = list.hidden;
    list.hidden = !open;
    $('done-toggle').setAttribute('aria-expanded', String(open));
    $('done-toggle').querySelector('.done-caret').textContent = open ? '▾' : '▸';
  };

  $('done-list').addEventListener('click', (e) => {
    const row = e.target.closest('.done-row');
    if (!row) return;
    const order = state.orders.find(o => o.id === row.dataset.orderId);
    if (order) openEditor(order);
  });

  $('btn-cancel').onclick = () => closeEditor();
  $('modal-close').onclick = () => closeEditor();
  $('btn-save').onclick = async () => { if (await saveOrder()) { paintLock(); refresh(); } };
  $('btn-delete').onclick = async () => { if (await deleteOrder()) refresh(); };
  $('btn-add-line').onclick = () => addLine();

  // Clicking the backdrop or pressing Escape closes whichever modal is open.
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeEditor(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('unlock-modal').hidden) $('u-cancel').click();
    else if (!$('modal').hidden) closeEditor();
  });
}

initTheme('dark');
wire();
paintLock();
refresh();

// Keep the board current without anybody asking. Only while the tab is on
// screen: a board nobody is looking at does not need polling, and a barn tablet
// left open all night should not spend the night calling the API.
setInterval(() => {
  if (document.visibilityState !== 'visible' || midEdit()) return;
  refresh();
}, 60_000);

// Coming back to the tab is exactly the moment the answer is most likely stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !midEdit()) refresh();
});

// The label ages between refreshes, so it has to tick on its own.
setInterval(paintFreshness, 20_000);
