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

import { state, loadAll, loadCoverage, STATUSES, statusLabel, option } from './state.js';
import { renderOffQueue } from './render.js';
import { loadQueue, renderQueue, onOpenOrder } from './queue.js';
import {
  openEditor, closeEditor, saveOrder, deleteOrder, addLine, onBuildStatus,
  fillCustomerSelect, openCustomerModal, closeCustomerModal, saveCustomer,
} from './editor.js';
import { registerLabels, t, toggleLang } from '../shared/i18n.js';
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
    new_order: 'New order', new_customer: 'New customer',
    status_in_queue: 'In queue', status_in_production: 'In production',
    status_finished: 'Finished',
    no_orders: 'No orders yet. Create the first one.',
    none_match: 'No orders match this filter.',
    no_lines: 'No line items yet',
    customer: 'Customer', status: 'Status', order_date: 'Order date',
    terms: 'Payment terms', notes: 'Notes',
    line_items: 'Line items', add_line: 'Add line', line: 'Line',
    cultivar: 'Cultivar', form: 'Form', quantity: 'Quantity', unit: 'Unit',
    unit_price: 'Price/unit', remove_line: 'Remove line',
    tops: 'Tops', smalls: 'Smalls',
    pick_cultivar: 'Select cultivar…', pick_customer: 'Select customer…',
    save: 'Save', cancel: 'Cancel', delete: 'Delete',
    saved: 'saved', deleted: 'deleted',
    confirm_delete: 'Delete order',
    name: 'Contact name', company: 'Company', city: 'City', region: 'State / country',
    err_customer: 'Pick a customer first.',
    err_cultivar: 'pick a cultivar.',
    err_qty: 'quantity must be greater than zero.',
    err_cust_name: 'Enter a contact name or company.',
    load_failed: 'Could not load orders',
    view_board: 'Orders', view_queue: 'Production queue',
    crew: 'Crew', crew_use_derived: 'Use derived', recalculate: 'Recalculate',
    crew_override: 'manual override', crew_derived: 'derived from the last', days: 'production days',
    clears: 'queue clears', lot: 'lot', one_pass: 'one pass',
    unallocated_note: 'trimmed with no order waiting for it.',
    done: 'done', spare: 'spare', none_packed: 'none packed', short: 'short',
    no_history: 'No history', loading: 'Loading…',
    queue_empty: 'Nothing to schedule. Only open and in-production orders are queued.',
    queue_failed: 'Could not load the queue',
    queue_note: 'Estimates, not commitments. Built from measured trim rates and the real work calendar — weekends off, breaks removed. It cannot see future crew changes or holidays, and does not model drying, packaging or freight.',
    imported: 'imported',
    completed: 'Not in the queue', none_off_queue: 'Every order is in the queue.',
    raw_sacks: 'raw sacks', no_raw: 'no raw sacks',
    unlock_title: 'Password required',
    unlock_help: 'Saving changes needs the operations password — the same one Consignment uses.',
    password: 'Password', unlock: 'Unlock',
    err_password: 'Enter the password.',
    err_password_bad: 'Incorrect password.',
    err_connection: 'Could not reach the server.',
    unlocked: 'Unlocked — changes can be saved',
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
    new_order: 'Nuevo pedido', new_customer: 'Nuevo cliente',
    status_in_queue: 'En cola', status_in_production: 'En producción',
    status_finished: 'Terminado',
    no_orders: 'Aún no hay pedidos. Cree el primero.',
    none_match: 'Ningún pedido coincide con este filtro.',
    no_lines: 'Sin renglones todavía',
    customer: 'Cliente', status: 'Estado', order_date: 'Fecha del pedido',
    terms: 'Términos de pago', notes: 'Notas',
    line_items: 'Renglones', add_line: 'Agregar renglón', line: 'Renglón',
    cultivar: 'Cultivar', form: 'Tipo', quantity: 'Cantidad', unit: 'Unidad',
    unit_price: 'Precio/unidad', remove_line: 'Quitar renglón',
    tops: 'Tops', smalls: 'Smalls',
    pick_cultivar: 'Seleccione cultivar…', pick_customer: 'Seleccione cliente…',
    save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar',
    saved: 'guardado', deleted: 'eliminado',
    confirm_delete: 'Eliminar pedido',
    name: 'Nombre de contacto', company: 'Empresa', city: 'Ciudad', region: 'Estado / país',
    err_customer: 'Seleccione un cliente primero.',
    err_cultivar: 'seleccione un cultivar.',
    err_qty: 'la cantidad debe ser mayor que cero.',
    err_cust_name: 'Ingrese un nombre de contacto o empresa.',
    load_failed: 'No se pudieron cargar los pedidos',
    view_board: 'Pedidos', view_queue: 'Cola de producción',
    crew: 'Equipo', crew_use_derived: 'Usar calculado', recalculate: 'Recalcular',
    crew_override: 'ajuste manual', crew_derived: 'calculado de los últimos', days: 'días de producción',
    clears: 'la cola termina', lot: 'lote', one_pass: 'una pasada',
    unallocated_note: 'podado sin pedido que lo espere.',
    done: 'listo', spare: 'sobrante', none_packed: 'nada empacado', short: 'faltante',
    no_history: 'Sin historial', loading: 'Cargando…',
    queue_empty: 'Nada que programar. Solo se programan pedidos abiertos y en producción.',
    queue_failed: 'No se pudo cargar la cola',
    queue_note: 'Estimaciones, no compromisos. Calculado con tasas de poda medidas y el calendario real — fines de semana libres, descansos descontados. No prevé cambios de equipo ni feriados, y no modela secado, empaque ni flete.',
    imported: 'importado',
    completed: 'Fuera de la cola', none_off_queue: 'Todos los pedidos están en la cola.',
    raw_sacks: 'sacos crudos', no_raw: 'sin sacos crudos',
    unlock_title: 'Se requiere contraseña',
    unlock_help: 'Para guardar cambios se necesita la contraseña de operaciones — la misma que usa Consignación.',
    password: 'Contraseña', unlock: 'Desbloquear',
    err_password: 'Ingrese la contraseña.',
    err_password_bad: 'Contraseña incorrecta.',
    err_connection: 'No se pudo conectar con el servidor.',
    unlocked: 'Desbloqueado — se pueden guardar cambios',
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

async function refresh() {
  try {
    await loadAll();
    fillCustomerSelect();
    // The cards show a promise date, which only the queue knows. Fetched
    // alongside rather than on demand so a card never renders a stale one.
    await Promise.all([
      loadQueue(Number($('q-crew').value) || undefined),
      loadCoverage(),
    ]);
    // The crew box is empty until somebody types an override, which on a glass
    // surface reads as a broken field rather than an optional one. Showing the
    // derived figure as a placeholder says what the queue is actually using.
    $('q-crew').placeholder = state.queue?.crew ?? '';
    renderQueue();
    renderOffQueue();
  } catch (e) {
    showToast(`${t('load_failed')}: ${e.message || e}`, 'error');
  }
}

/** Reflect whether writes are currently possible, so the state is not a guess. */
function paintLock() {
  const btn = $('lock-btn');
  const open = hasPassword();
  btn.querySelector('i').className = open ? 'ph-duotone ph-lock-key-open' : 'ph-duotone ph-lock-key';
  btn.classList.toggle('primary', !open);
  btn.title = open ? t('relock') : t('unlock');
}

function wire() {
  onBuildStatus(buildStatusOptions);
  $('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  $('lang-toggle').onclick = () => { toggleLang(); renderQueue(); renderOffQueue(); };
  $('lock-btn').onclick = async () => {
    if (hasPassword()) {
      forgetPassword();
      showToast(t('relock'), 'info');
    } else if (await ensureUnlocked()) {
      showToast(t('unlocked'), 'success');
    }
    paintLock();
  };
  $('dark-mode-toggle').onclick = () => toggleTheme();
  $('refresh-btn').onclick = () => refresh();

  // Recalculate when the crew figure actually changes, rather than behind a
  // separate button — the whole queue is a function of it, so a stale board
  // sitting next to an edited number would be misleading.
  $('q-crew').onchange = () => loadQueue(Number($('q-crew').value) || undefined);
  $('q-reset').onclick = () => { $('q-crew').value = ''; loadQueue(); };

  $('btn-new').onclick = () => openEditor(null);
  $('btn-new-customer').onclick = () => openCustomerModal();

  // Orders in the queue are reached from their runs; this covers the ones that
  // have left it.
  onOpenOrder((orderId) => {
    const order = state.orders.find(o => o.id === orderId);
    if (order) openEditor(order);
  });

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

  $('c-cancel').onclick = () => closeCustomerModal();
  $('c-save').onclick = async () => {
    const id = await saveCustomer();
    if (!id) return;
    paintLock();
    await refresh();
    $('f-customer').value = id;   // select what was just created
  };

  // Clicking the backdrop or pressing Escape closes whichever modal is open.
  for (const [backdrop, close] of [['modal', closeEditor], ['customer-modal', closeCustomerModal]]) {
    $(backdrop).addEventListener('click', (e) => { if (e.target.id === backdrop) close(); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('unlock-modal').hidden) $('u-cancel').click();
    else if (!$('customer-modal').hidden) closeCustomerModal();
    else if (!$('modal').hidden) closeEditor();
  });
}

initTheme('dark');
wire();
paintLock();
refresh();
