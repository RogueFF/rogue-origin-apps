/**
 * Orders — Payment management & payment-shipment linking
 * getPayments, savePayment, deletePayment,
 * getPaymentLinks, savePaymentLink, deletePaymentLink, getShipmentPaymentStatus
 */

import { query, queryOne, insert, update, deleteRows } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';

async function getPayments(params, env) {
  const orderID = params.orderID;
  let sql = `SELECT * FROM payments`;
  const sqlParams = [];

  if (orderID) {
    sql += ` WHERE order_id = ?`;
    sqlParams.push(orderID);
  }
  sql += ` ORDER BY created_at DESC`;

  const payments = await query(env.DB, sql, sqlParams);

  return successResponse({
    success: true,
    payments: payments.map(p => ({
      id: p.id,
      orderID: p.order_id || '',
      paymentDate: p.payment_date,
      amount: p.amount || 0,
      method: p.method || '',
      reference: p.reference || '',
      notes: p.notes || '',
      recordedBy: '',
      recordedDate: p.created_at,
    }))
  });
}

async function savePayment(body, env) {
  if (!body.orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM payments WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const count = await query(env.DB, 'SELECT COUNT(*) as cnt FROM payments');
    body.id = `PAY-${String((count[0]?.cnt || 0) + 1).padStart(5, '0')}`;
  }

  const data = {
    order_id: (body.orderID || ''),
    payment_date: body.paymentDate || new Date().toISOString(),
    amount: body.amount || 0,
    method: (body.method || ''),
    reference: (body.reference || ''),
    notes: (body.notes || ''),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'payments', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'payments', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  return successResponse({ success: true, payment: body });
}

async function deletePayment(body, env) {
  if (!body.paymentID) throw createError('VALIDATION_ERROR', 'Payment ID is required');
  const changes = await deleteRows(env.DB, 'payments', 'id = ?', [body.paymentID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Payment not found');
  return successResponse({ success: true, message: 'Payment deleted' });
}

async function getPaymentLinks(params, env) {
  const { paymentID, shipmentID } = params;

  let sql = `
    SELECT psl.*,
           p.amount as payment_amount, p.payment_date, p.reference as payment_reference,
           s.invoice_number, s.total_value as shipment_amount
    FROM payment_shipment_links psl
    LEFT JOIN payments p ON psl.payment_id = p.id
    LEFT JOIN shipments s ON psl.shipment_id = s.id
  `;
  const sqlParams = [];

  if (paymentID) {
    sql += ' WHERE psl.payment_id = ?';
    sqlParams.push(paymentID);
  } else if (shipmentID) {
    sql += ' WHERE psl.shipment_id = ?';
    sqlParams.push(shipmentID);
  }

  const links = await query(env.DB, sql, sqlParams);

  return successResponse({
    success: true,
    links: links.map(l => ({
      id: l.id,
      paymentId: l.payment_id,
      shipmentId: l.shipment_id,
      amount: l.amount,
      paymentAmount: l.payment_amount,
      paymentDate: l.payment_date,
      paymentReference: l.payment_reference,
      invoiceNumber: l.invoice_number,
      shipmentAmount: l.shipment_amount
    }))
  });
}

async function savePaymentLink(body, env) {
  const { paymentId, shipmentId, amount } = body;

  if (!paymentId || !shipmentId) {
    throw createError('VALIDATION_ERROR', 'paymentId and shipmentId are required');
  }

  // Check if link already exists
  const existing = await queryOne(env.DB,
    'SELECT id FROM payment_shipment_links WHERE payment_id = ? AND shipment_id = ?',
    [paymentId, shipmentId]
  );

  if (existing) {
    // Update existing link
    await update(env.DB, 'payment_shipment_links', { amount }, 'id = ?', [existing.id]);
    return successResponse({ success: true, id: existing.id, updated: true });
  }

  const linkId = `PSL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  await insert(env.DB, 'payment_shipment_links', {
    id: linkId,
    payment_id: paymentId,
    shipment_id: shipmentId,
    amount: amount || null,
    created_at: new Date().toISOString()
  });

  return successResponse({ success: true, id: linkId });
}

async function deletePaymentLink(body, env) {
  const { linkId, paymentId, shipmentId, all } = body;

  if (linkId) {
    await deleteRows(env.DB, 'payment_shipment_links', 'id = ?', [linkId]);
  } else if (paymentId && all) {
    // Delete all links for a payment
    await deleteRows(env.DB, 'payment_shipment_links', 'payment_id = ?', [paymentId]);
  } else if (paymentId && shipmentId) {
    await deleteRows(env.DB, 'payment_shipment_links', 'payment_id = ? AND shipment_id = ?', [paymentId, shipmentId]);
  } else if (shipmentId && all) {
    // Delete all links for a shipment
    await deleteRows(env.DB, 'payment_shipment_links', 'shipment_id = ?', [shipmentId]);
  } else {
    throw createError('VALIDATION_ERROR', 'linkId or (paymentId and shipmentId) or (paymentId/shipmentId with all=true) required');
  }

  return successResponse({ success: true });
}

async function getShipmentPaymentStatus(params, env) {
  const { orderID, shipmentId } = params;

  let sql = `
    SELECT s.id, s.invoice_number, s.total_value,
           COALESCE(SUM(psl.amount), 0) as amount_paid
    FROM shipments s
    LEFT JOIN payment_shipment_links psl ON s.id = psl.shipment_id
  `;
  const sqlParams = [];
  const conditions = [];

  if (shipmentId) {
    conditions.push('s.id = ?');
    sqlParams.push(shipmentId);
  }

  if (orderID) {
    conditions.push('s.order_id = ?');
    sqlParams.push(orderID);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' GROUP BY s.id';

  const results = await query(env.DB, sql, sqlParams);

  // If single shipment requested, return simplified response
  if (shipmentId && results.length === 1) {
    const r = results[0];
    const totalAmount = r.total_value || 0;
    const paidAmount = r.amount_paid || 0;
    let status = 'unpaid';
    if (paidAmount >= totalAmount && totalAmount > 0) {
      status = 'paid';
    } else if (paidAmount > 0) {
      status = 'partial';
    }
    return successResponse({
      success: true,
      status,
      paidAmount,
      totalAmount,
      balance: totalAmount - paidAmount
    });
  }

  return successResponse({
    success: true,
    shipments: results.map(r => {
      const totalAmount = r.total_value || 0;
      const paidAmount = r.amount_paid || 0;
      let status = 'unpaid';
      if (paidAmount >= totalAmount && totalAmount > 0) {
        status = 'paid';
      } else if (paidAmount > 0) {
        status = 'partial';
      }
      return {
        id: r.id,
        invoiceNumber: r.invoice_number,
        totalAmount,
        paidAmount,
        balance: totalAmount - paidAmount,
        status
      };
    })
  });
}

export {
  getPayments, savePayment, deletePayment,
  getPaymentLinks, savePaymentLink, deletePaymentLink,
  getShipmentPaymentStatus,
};
