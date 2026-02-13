/**
 * Orders — Shipment management
 * getShipments, saveShipment, deleteShipment
 */

import { query, queryOne, insert, update, deleteRows } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { updatePriceHistoryForItems } from './financials.js';

async function getShipments(params, env) {
  const orderID = params.orderID;
  let sql = `SELECT * FROM shipments`;
  const sqlParams = [];

  if (orderID) {
    sql += ` WHERE order_id = ?`;
    sqlParams.push(orderID);
  }
  sql += ` ORDER BY created_at DESC`;

  const shipments = await query(env.DB, sql, sqlParams);

  return successResponse({
    success: true,
    shipments: shipments.map(s => ({
      id: s.id,
      orderID: s.order_id || '',
      invoiceNumber: s.invoice_number || '',
      shipmentDate: s.ship_date,
      startDateTime: s.ship_date,
      status: s.status || 'pending',
      dimensionsJSON: '{}',
      lineItemsJSON: s.notes || '[]',
      subTotal: s.total_value || 0,
      discount: 0,
      freightCost: 0,
      totalAmount: s.total_value || 0,
      trackingNumber: s.tracking_number || '',
      carrier: s.carrier || '',
      notes: '',
      dimensions: {},
      lineItems: s.notes ? JSON.parse(s.notes) : [],
    }))
  });
}

async function saveShipment(body, env) {
  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM shipments WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const orderNum = body.orderID ? body.orderID.split('-').pop() : '000';
    // Use MAX to find highest existing shipment number, not COUNT (which fails after deletions)
    const maxResult = await query(env.DB, `SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-${orderNum}-%'`);
    const maxNum = maxResult[0]?.maxNum || 0;
    body.id = `SH-${orderNum}-${String(maxNum + 1).padStart(2, '0')}`;
  }

  if (!body.invoiceNumber) {
    const year = new Date().getFullYear();
    const result = await query(env.DB, `SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-${year}-%' ORDER BY invoice_number DESC LIMIT 1`);
    let maxNum = 0;
    if (result.length > 0 && result[0].invoice_number) {
      const numStr = result[0].invoice_number.split('-').pop();
      maxNum = parseInt(numStr, 10) || 0;
    }
    body.invoiceNumber = `INV-${year}-${String(maxNum + 1).padStart(4, '0')}`;
  }

  const data = {
    order_id: (body.orderID || ''),
    invoice_number: body.invoiceNumber,
    ship_date: body.shipmentDate || new Date().toISOString(),
    status: (body.status || 'pending'),
    quantity_kg: body.lineItems?.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0) || 0,
    total_value: body.totalAmount || 0,
    tracking_number: (body.trackingNumber || ''),
    carrier: (body.carrier || ''),
    notes: JSON.stringify(body.lineItems || []),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'shipments', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'shipments', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  // Update price history
  if (body.lineItems?.length > 0) {
    await updatePriceHistoryForItems(body.lineItems, env);
  }

  return successResponse({ success: true, shipment: body });
}

async function deleteShipment(body, env) {
  if (!body.shipmentID) throw createError('VALIDATION_ERROR', 'Shipment ID is required');
  const changes = await deleteRows(env.DB, 'shipments', 'id = ?', [body.shipmentID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Shipment not found');
  return successResponse({ success: true, message: 'Shipment deleted' });
}

export { getShipments, saveShipment, deleteShipment };
