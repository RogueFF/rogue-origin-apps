/**
 * Wholesale Orders API Handler - D1 Version
 * Refactored into modular architecture (9 modules):
 *
 *   orders/shared.js          — Drive API helpers, date formatting, constants
 *   orders/customers.js       — getCustomers, saveCustomer, deleteCustomer
 *   orders/master-orders.js   — getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority
 *   orders/shipments.js       — getShipments, saveShipment, deleteShipment
 *   orders/payments.js        — getPayments, savePayment, deletePayment, getPaymentLinks, savePaymentLink, deletePaymentLink, getShipmentPaymentStatus
 *   orders/financials.js      — getOrderFinancials, getPriceHistory, updatePriceHistoryForItems
 *   orders/coa.js             — getCOAIndex, syncCOAIndex, getCOAsForStrains, count5kgBagsForStrain
 *   orders/scoreboard-queue.js — getScoreboardOrderQueue
 *   orders/migrate.js         — migrateFromSheets, migratePaymentLinks
 */

export { handleOrdersD1 } from './orders/index.js';
