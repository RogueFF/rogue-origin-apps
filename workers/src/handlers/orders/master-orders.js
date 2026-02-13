/**
 * Orders — Master order management
 * getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority
 */

import { query, queryOne, insert, update, deleteRows } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';

async function getMasterOrders(env) {
  const orders = await query(env.DB, `
    SELECT id, customer_id, order_date, status, strain, type, commitment_kg, commitment_price,
           fulfilled_kg, fulfilled_value, paid_amount, balance_due, ship_date, tracking_number,
           notes, source, shopify_order_id, shopify_order_name, payment_terms, priority, created_at, updated_at
    FROM orders ORDER BY created_at DESC
  `);

  return successResponse({
    success: true,
    orders: orders.map(o => ({
      id: o.id,
      customerID: o.customer_id || '',
      customerName: '',
      commitmentAmount: o.commitment_price || 0,
      currency: 'USD',
      status: o.status || 'pending',
      poNumber: '',
      terms: o.payment_terms || 'DAP',
      createdDate: o.created_at,
      dueDate: o.ship_date,
      notes: o.notes || '',
      priority: o.priority,
    }))
  });
}

async function saveMasterOrder(body, env) {
  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const year = new Date().getFullYear();
    const result = await query(env.DB, `SELECT id FROM orders WHERE id LIKE 'MO-${year}-%' ORDER BY id DESC LIMIT 1`);
    let maxNum = 0;
    if (result.length > 0) {
      const numStr = result[0].id.split('-')[2];
      maxNum = parseInt(numStr, 10) || 0;
    }
    body.id = `MO-${year}-${String(maxNum + 1).padStart(3, '0')}`;
  }

  const data = {
    customer_id: (body.customerID || ''),
    order_date: body.createdDate || new Date().toISOString(),
    status: (body.status || 'pending'),
    commitment_price: body.commitmentAmount || 0,
    payment_terms: (body.terms || 'DAP'),
    ship_date: body.dueDate || '',
    notes: (body.notes || ''),
    priority: body.priority || null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'orders', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'orders', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  return successResponse({ success: true, order: body });
}

async function deleteMasterOrder(body, env) {
  const orderID = body.orderID;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  // Check order exists first
  const order = await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [orderID]);
  if (!order) throw createError('NOT_FOUND', 'Order not found');

  // Delete associated records FIRST (foreign key constraints require this order)
  await deleteRows(env.DB, 'shipments', 'order_id = ?', [orderID]);
  await deleteRows(env.DB, 'payments', 'order_id = ?', [orderID]);

  // Now delete the order
  await deleteRows(env.DB, 'orders', 'id = ?', [orderID]);

  return successResponse({ success: true, message: 'Order and associated records deleted' });
}

async function updateOrderPriority(body, env) {
  const { orderID, newPriority } = body;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const changes = await update(env.DB, 'orders', { priority: newPriority || null }, 'id = ?', [orderID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Order not found');

  return successResponse({ success: true });
}

export { getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority };
