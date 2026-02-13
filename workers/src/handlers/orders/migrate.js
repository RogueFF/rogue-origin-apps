/**
 * Orders — Migration from Google Sheets
 * migrateFromSheets, migratePaymentLinks
 */

import { query, queryOne, insert, update, execute } from '../../lib/db.js';
import { readSheet } from '../../lib/sheets.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { SHEETS } from './shared.js';

async function migrateFromSheets(env) {
  const sheetId = env.ORDERS_SHEET_ID;
  if (!sheetId) throw createError('INTERNAL_ERROR', 'ORDERS_SHEET_ID not configured');

  let customersMigrated = 0, ordersMigrated = 0, shipmentsMigrated = 0, paymentsMigrated = 0;

  // Migrate Customers
  try {
    const data = await readSheet(sheetId, `${SHEETS.customers}!A:K`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM customers WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'customers', {
        id: row[0],
        company: (row[1] || ''),
        name: (row[2] || ''),
        email: (row[3] || ''),
        phone: (row[4] || ''),
        address: (row[5] || ''),
        notes: (row[8] || ''),
        created_at: row[9] || new Date().toISOString(),
      });
      customersMigrated++;
    }
  } catch (e) { console.error('Error migrating customers:', e); }

  // Migrate Orders
  try {
    const data = await readSheet(sheetId, `${SHEETS.orders}!A:V`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'orders', {
        id: row[0],
        customer_id: (row[1] || ''),
        status: (row[5] || 'pending'),
        commitment_price: parseFloat(row[3]) || 0,
        payment_terms: (row[7] || 'DAP'),
        ship_date: row[9] || '',
        notes: (row[20] || ''),
        priority: parseInt(row[21]) || null,
        created_at: row[8] || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      ordersMigrated++;
    }
  } catch (e) { console.error('Error migrating orders:', e); }

  // Migrate Shipments
  try {
    const data = await readSheet(sheetId, `${SHEETS.shipments}!A:O`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM shipments WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'shipments', {
        id: row[0],
        order_id: (row[1] || ''),
        invoice_number: row[2] || '',
        ship_date: row[3] || new Date().toISOString(),
        status: (row[5] || 'pending'),
        quantity_kg: 0,
        total_value: parseFloat(row[11]) || 0,
        tracking_number: (row[12] || ''),
        carrier: (row[13] || ''),
        notes: row[7] || '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      shipmentsMigrated++;
    }
  } catch (e) { console.error('Error migrating shipments:', e); }

  // Migrate Payments
  try {
    const data = await readSheet(sheetId, `${SHEETS.payments}!A:I`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM payments WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'payments', {
        id: row[0],
        order_id: (row[1] || ''),
        payment_date: row[2] || new Date().toISOString(),
        amount: parseFloat(row[3]) || 0,
        method: (row[4] || ''),
        reference: (row[5] || ''),
        notes: (row[6] || ''),
        created_at: row[8] || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      paymentsMigrated++;
    }
  } catch (e) { console.error('Error migrating payments:', e); }

  return successResponse({
    success: true,
    message: `Migration complete. Customers: ${customersMigrated}, Orders: ${ordersMigrated}, Shipments: ${shipmentsMigrated}, Payments: ${paymentsMigrated}`,
    customersMigrated,
    ordersMigrated,
    shipmentsMigrated,
    paymentsMigrated,
  });
}

async function migratePaymentLinks(env) {
  // Create the table if it doesn't exist
  await execute(env.DB, `
    CREATE TABLE IF NOT EXISTS payment_shipment_links (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      shipment_id TEXT NOT NULL,
      amount REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    )
  `);

  await execute(env.DB, `CREATE INDEX IF NOT EXISTS idx_psl_payment ON payment_shipment_links(payment_id)`);
  await execute(env.DB, `CREATE INDEX IF NOT EXISTS idx_psl_shipment ON payment_shipment_links(shipment_id)`);

  // Get all payments and shipments
  const payments = await query(env.DB, 'SELECT * FROM payments');
  const shipments = await query(env.DB, 'SELECT * FROM shipments');

  let linked = 0;

  for (const payment of payments) {
    // Extract invoice number from payment reference (e.g., "D6806 #25682" -> "D6806")
    const ref = payment.reference || '';
    const invoiceMatch = ref.match(/^([A-Za-z]?\d+)/);
    if (!invoiceMatch) continue;

    const invoicePrefix = invoiceMatch[1];

    // Find matching shipment(s)
    const matchingShipments = shipments.filter(s => {
      const shipInvoice = s.invoice_number || '';
      return shipInvoice.startsWith(invoicePrefix) || shipInvoice.includes(invoicePrefix);
    });

    for (const shipment of matchingShipments) {
      // Check if link already exists
      const existing = await queryOne(env.DB,
        'SELECT id FROM payment_shipment_links WHERE payment_id = ? AND shipment_id = ?',
        [payment.id, shipment.id]
      );

      if (!existing) {
        const linkId = `PSL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        await insert(env.DB, 'payment_shipment_links', {
          id: linkId,
          payment_id: payment.id,
          shipment_id: shipment.id,
          amount: payment.amount, // Full amount for now; can be adjusted
          created_at: new Date().toISOString()
        });
        linked++;
      }
    }
  }

  return successResponse({
    success: true,
    message: `Created payment_shipment_links table and linked ${linked} payment-shipment pairs`
  });
}

export { migrateFromSheets, migratePaymentLinks };
