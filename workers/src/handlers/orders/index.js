/**
 * Orders — Router/Dispatcher
 *
 * Modules:
 *   shared.js          — Drive API helpers, date formatting, constants
 *   customers.js       — getCustomers, saveCustomer, deleteCustomer
 *   master-orders.js   — getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority
 *   shipments.js       — getShipments, saveShipment, deleteShipment
 *   payments.js        — getPayments, savePayment, deletePayment, getPaymentLinks, savePaymentLink, deletePaymentLink, getShipmentPaymentStatus
 *   financials.js      — getOrderFinancials, getPriceHistory, updatePriceHistoryForItems
 *   coa.js             — getCOAIndex, syncCOAIndex, getCOAsForStrains, count5kgBagsForStrain
 *   scoreboard-queue.js — getScoreboardOrderQueue
 *   migrate.js         — migrateFromSheets, migratePaymentLinks
 */

import { successResponse, parseBody, getAction, getQueryParams } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { validatePassword as authValidatePassword, requireAuth } from '../../lib/auth.js';

import { getCustomers, saveCustomer, deleteCustomer } from './customers.js';
import { getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority } from './master-orders.js';
import { getShipments, saveShipment, deleteShipment } from './shipments.js';
import { getPayments, savePayment, deletePayment, getPaymentLinks, savePaymentLink, deletePaymentLink, getShipmentPaymentStatus } from './payments.js';
import { getOrderFinancials, getPriceHistory } from './financials.js';
import { getCOAIndex, syncCOAIndex, getCOAsForStrains } from './coa.js';
import { getScoreboardOrderQueue } from './scoreboard-queue.js';
import { migrateFromSheets, migratePaymentLinks } from './migrate.js';

// ===== AUTHENTICATION =====

async function validatePassword(params, env) {
  const password = params.password || '';

  // Use constant-time comparison from auth.js
  authValidatePassword(password, env, 'orders-validatePassword');

  // Generate cryptographically secure session token
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const sessionToken = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return successResponse({ success: true, sessionToken, expiresIn: 30 * 24 * 60 * 60 * 1000 });
}

// ===== TEST =====

async function test() {
  return successResponse({
    ok: true,
    message: 'Wholesale Orders API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

// ===== MAIN HANDLER =====

// Actions that require authentication (write operations)
const ORDERS_WRITE_ACTIONS = new Set([
  'saveCustomer', 'deleteCustomer',
  'saveMasterOrder', 'deleteMasterOrder', 'updateOrderPriority',
  'saveShipment', 'deleteShipment',
  'savePayment', 'deletePayment',
  'syncCOAIndex', 'migrate', 'migratePaymentLinks',
  'savePaymentLink', 'deletePaymentLink',
]);

export async function handleOrdersD1(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  // Require auth for write actions
  if (ORDERS_WRITE_ACTIONS.has(action)) {
    requireAuth(request, body, env, `orders-${action}`);
  }

  const actions = {
    validatePassword: () => validatePassword(params, env),
    getCustomers: () => getCustomers(env),
    saveCustomer: () => saveCustomer(body, env),
    deleteCustomer: () => deleteCustomer(body, env),
    getMasterOrders: () => getMasterOrders(env),
    saveMasterOrder: () => saveMasterOrder(body, env),
    deleteMasterOrder: () => deleteMasterOrder(body, env),
    updateOrderPriority: () => updateOrderPriority(body, env),
    getShipments: () => getShipments(params, env),
    saveShipment: () => saveShipment(body, env),
    deleteShipment: () => deleteShipment(body, env),
    getPayments: () => getPayments(params, env),
    savePayment: () => savePayment(body, env),
    deletePayment: () => deletePayment(body, env),
    getPriceHistory: () => getPriceHistory(env),
    getOrderFinancials: () => getOrderFinancials(params, env),
    getCOAIndex: () => getCOAIndex(env),
    syncCOAIndex: () => syncCOAIndex(env),
    getCOAsForStrains: () => getCOAsForStrains(params, env),
    getScoreboardOrderQueue: () => getScoreboardOrderQueue(env),
    test: () => test(),
    migrate: () => migrateFromSheets(env),
    migratePaymentLinks: () => migratePaymentLinks(env),
    getPaymentLinks: () => getPaymentLinks(params, env),
    savePaymentLink: () => savePaymentLink(body, env),
    deletePaymentLink: () => deletePaymentLink(body, env),
    getShipmentPaymentStatus: () => getShipmentPaymentStatus(params, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
