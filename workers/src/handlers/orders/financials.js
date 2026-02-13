/**
 * Orders — Financial data
 * getOrderFinancials, getPriceHistory, updatePriceHistoryForItems
 */

import { query, queryOne, insert, update } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';

async function getOrderFinancials(params, env) {
  const orderID = params.orderID;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const order = await queryOne(env.DB, 'SELECT commitment_price FROM orders WHERE id = ?', [orderID]);
  if (!order) throw createError('NOT_FOUND', 'Order not found');

  const commitment = order.commitment_price || 0;

  const shipmentResult = await query(env.DB, 'SELECT SUM(total_value) as total FROM shipments WHERE order_id = ?', [orderID]);
  const fulfilled = shipmentResult[0]?.total || 0;

  const paymentResult = await query(env.DB, 'SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [orderID]);
  const paid = paymentResult[0]?.total || 0;

  return successResponse({
    success: true,
    commitment,
    fulfilled,
    paid,
    outstanding: commitment - fulfilled,
    balance: fulfilled - paid,
  });
}

async function getPriceHistory(env) {
  const prices = await query(env.DB, `SELECT * FROM price_history ORDER BY effective_date DESC`);

  return successResponse({
    success: true,
    prices: prices.map(p => ({
      strain: p.strain || '',
      type: p.type || '',
      lastPrice: p.price || 0,
      lastUsedDate: p.effective_date,
      customerID: '',
    }))
  });
}

async function updatePriceHistoryForItems(lineItems, env) {
  if (!lineItems?.length) return;

  for (const item of lineItems) {
    if (!item.strain || !item.type || !item.unitPrice) continue;

    const existing = await queryOne(env.DB,
      'SELECT id FROM price_history WHERE strain = ? AND type = ?',
      [item.strain, item.type]
    );

    if (existing) {
      await update(env.DB, 'price_history', {
        price: item.unitPrice,
        effective_date: new Date().toISOString(),
      }, 'id = ?', [existing.id]);
    } else {
      await insert(env.DB, 'price_history', {
        strain: item.strain,
        type: item.type,
        price: item.unitPrice,
        effective_date: new Date().toISOString(),
      });
    }
  }
}

export { getOrderFinancials, getPriceHistory, updatePriceHistoryForItems };
