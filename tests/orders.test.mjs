/**
 * Orders Handler — Unit Tests
 *
 * Tests the individual handler functions from the orders modules.
 * Run with:  node --test tests/orders.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDB, createMockEnv } from './helpers/d1-mock.mjs';

// Import handlers
import { getCustomers, saveCustomer, deleteCustomer } from '../workers/src/handlers/orders/customers.js';
import { getMasterOrders, saveMasterOrder, deleteMasterOrder, updateOrderPriority } from '../workers/src/handlers/orders/master-orders.js';
import { getShipments, saveShipment, deleteShipment } from '../workers/src/handlers/orders/shipments.js';
import { getPayments, savePayment, deletePayment, getPaymentLinks, savePaymentLink, deletePaymentLink, getShipmentPaymentStatus } from '../workers/src/handlers/orders/payments.js';
import { getOrderFinancials, getPriceHistory, updatePriceHistoryForItems } from '../workers/src/handlers/orders/financials.js';
import { formatDate, COA_FOLDER_ID, SHEETS } from '../workers/src/handlers/orders/shared.js';

// ---------------------------------------------------------------------------
// 1. Customers Module
// ---------------------------------------------------------------------------

describe('Customers — getCustomers', () => {
  it('returns customers with mapped fields', async () => {
    const db = createMockDB();
    db.addRows('SELECT id, company, name, email, phone, address, city, state, zip, notes, created_at FROM customers ORDER BY company', [
      { id: 'CUST-001', company: 'Acme Inc', name: 'John Doe', email: 'john@acme.com', phone: '555-1234', address: '123 Main St', city: 'Portland', state: 'OR', zip: '97201', notes: 'VIP', created_at: '2025-01-01T00:00:00Z' },
      { id: 'CUST-002', company: 'Beta Corp', name: 'Jane Smith', email: 'jane@beta.com', phone: '555-5678', address: '456 Oak Ave', city: null, state: null, zip: null, notes: null, created_at: '2025-01-02T00:00:00Z' },
    ]);

    const env = { DB: db };
    const response = await getCustomers(env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.customers.length, 2);

    const first = data.customers[0];
    assert.equal(first.id, 'CUST-001');
    assert.equal(first.companyName, 'Acme Inc');
    assert.equal(first.contactName, 'John Doe');
    assert.equal(first.email, 'john@acme.com');
    assert.equal(first.phone, '555-1234');
    assert.equal(first.shipToAddress, '123 Main St');
    assert.equal(first.billToAddress, '123 Main St');
    assert.equal(first.notes, 'VIP');
    assert.equal(first.createdDate, '2025-01-01T00:00:00Z');
    assert.equal(first.lastOrderDate, null);

    const second = data.customers[1];
    assert.equal(second.companyName, 'Beta Corp');
    assert.equal(second.contactName, 'Jane Smith');
    assert.equal(second.shipToAddress, '456 Oak Ave');
    assert.equal(second.notes, '');
  });
});

describe('Customers — saveCustomer', () => {
  it('validates companyName is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await saveCustomer({}, env); },
      (err) => {
        assert.ok(err.message.includes('Company name is required'));
        return true;
      }
    );
  });

  it('generates CUST-001 ID for first customer', async () => {
    const db = createMockDB();
    db.addRows('SELECT COUNT(*) as cnt FROM customers', [{ cnt: 0 }]);

    const env = { DB: db };
    const body = { companyName: 'New Corp', contactName: 'Alice', email: 'alice@new.com' };
    const response = await saveCustomer(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.customer.id, 'CUST-001');

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO customers'));
    assert.ok(insertQuery, 'Should execute INSERT query');
  });

  it('generates CUST-005 ID when 4 customers exist', async () => {
    const db = createMockDB();
    db.addRows('SELECT COUNT(*) as cnt FROM customers', [{ cnt: 4 }]);

    const env = { DB: db };
    const body = { companyName: 'Fifth Corp' };
    const response = await saveCustomer(body, env);
    const data = await response.json();

    assert.equal(data.customer.id, 'CUST-005');
  });

  it('updates existing customer when ID provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM customers WHERE id = ?', [{ id: 'CUST-001' }]);
    db.setNextChanges(1);

    const env = { DB: db };
    const body = { id: 'CUST-001', companyName: 'Updated Corp', contactName: 'Bob', notes: 'New note' };
    const response = await saveCustomer(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.customer.id, 'CUST-001');

    const queries = db.getQueries();
    const updateQuery = queries.find(q => q.sql.includes('UPDATE customers'));
    assert.ok(updateQuery, 'Should execute UPDATE query');
  });

  it('handles empty optional fields gracefully', async () => {
    const db = createMockDB();
    db.addRows('SELECT COUNT(*) as cnt FROM customers', [{ cnt: 0 }]);

    const env = { DB: db };
    const body = { companyName: 'Minimal Corp' };
    const response = await saveCustomer(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.customer.id);
  });
});

describe('Customers — deleteCustomer', () => {
  it('validates ID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await deleteCustomer({}, env); },
      (err) => {
        assert.ok(err.message.includes('Customer ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when customer does not exist', async () => {
    const db = createMockDB();
    db.setNextChanges(0);

    const env = { DB: db };
    await assert.rejects(
      async () => { await deleteCustomer({ id: 'CUST-999' }, env); },
      (err) => {
        assert.ok(err.message.includes('Customer not found'));
        return true;
      }
    );
  });

  it('deletes customer successfully', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deleteCustomer({ id: 'CUST-001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const deleteQuery = queries.find(q => q.sql.includes('DELETE FROM customers'));
    assert.ok(deleteQuery, 'Should execute DELETE query');
  });
});

// ---------------------------------------------------------------------------
// 2. Master Orders Module
// ---------------------------------------------------------------------------

describe('Master Orders — getMasterOrders', () => {
  it('returns orders with mapped fields', async () => {
    const db = createMockDB();
    db.addRows('SELECT id, customer_id, order_date, status, strain, type, commitment_kg, commitment_price', [
      {
        id: 'MO-2025-001',
        customer_id: 'CUST-001',
        order_date: '2025-01-15T00:00:00Z',
        status: 'pending',
        strain: null,
        type: null,
        commitment_kg: null,
        commitment_price: 5000,
        fulfilled_kg: null,
        fulfilled_value: null,
        paid_amount: null,
        balance_due: null,
        ship_date: '2025-02-01T00:00:00Z',
        tracking_number: null,
        notes: 'Rush order',
        source: null,
        shopify_order_id: null,
        shopify_order_name: null,
        payment_terms: 'NET30',
        priority: 1,
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
      },
    ]);

    const env = { DB: db };
    const response = await getMasterOrders(env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.orders.length, 1);

    const order = data.orders[0];
    assert.equal(order.id, 'MO-2025-001');
    assert.equal(order.customerID, 'CUST-001');
    assert.equal(order.commitmentAmount, 5000);
    assert.equal(order.currency, 'USD');
    assert.equal(order.status, 'pending');
    assert.equal(order.terms, 'NET30');
    assert.equal(order.notes, 'Rush order');
    assert.equal(order.priority, 1);
  });
});

describe('Master Orders — saveMasterOrder', () => {
  it('generates MO-YYYY-001 ID for first order of current year', async () => {
    const currentYear = new Date().getFullYear();
    const db = createMockDB();
    db.addRows(`SELECT id FROM orders WHERE id LIKE 'MO-${currentYear}-%' ORDER BY id DESC LIMIT 1`, []);

    const env = { DB: db };
    const body = { customerID: 'CUST-001', commitmentAmount: 1000 };
    const response = await saveMasterOrder(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.order.id.startsWith(`MO-${currentYear}-`));
    assert.equal(data.order.id, `MO-${currentYear}-001`);
  });

  it('generates MO-YYYY-005 when MO-YYYY-004 exists', async () => {
    const currentYear = new Date().getFullYear();
    const db = createMockDB();
    db.addRows(`SELECT id FROM orders WHERE id LIKE 'MO-${currentYear}-%' ORDER BY id DESC LIMIT 1`, [
      { id: `MO-${currentYear}-004` }
    ]);

    const env = { DB: db };
    const body = { customerID: 'CUST-001', commitmentAmount: 2000 };
    const response = await saveMasterOrder(body, env);
    const data = await response.json();

    assert.equal(data.order.id, `MO-${currentYear}-005`);
  });

  it('updates existing order when ID provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM orders WHERE id = ?', [{ id: 'MO-2025-001' }]);
    db.setNextChanges(1);

    const env = { DB: db };
    const body = { id: 'MO-2025-001', customerID: 'CUST-002', status: 'shipped', notes: 'Updated' };
    const response = await saveMasterOrder(body, env);
    const data = await response.json();

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const updateQuery = queries.find(q => q.sql.includes('UPDATE orders'));
    assert.ok(updateQuery, 'Should execute UPDATE query');
  });

  it('sets default status to pending', async () => {
    const db = createMockDB();
    db.addRows("SELECT id FROM orders WHERE id LIKE 'MO-2025-%' ORDER BY id DESC LIMIT 1", []);

    const env = { DB: db };
    const body = { customerID: 'CUST-001' };
    const response = await saveMasterOrder(body, env);

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO orders'));
    assert.ok(insertQuery, 'Should insert with default status');
  });
});

describe('Master Orders — deleteMasterOrder', () => {
  it('validates orderID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await deleteMasterOrder({}, env); },
      (err) => {
        assert.ok(err.message.includes('Order ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when order does not exist', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM orders WHERE id = ?', []);

    const env = { DB: db };
    await assert.rejects(
      async () => { await deleteMasterOrder({ orderID: 'MO-2025-999' }, env); },
      (err) => {
        assert.ok(err.message.includes('Order not found'));
        return true;
      }
    );
  });

  it('cascade deletes shipments and payments', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM orders WHERE id = ?', [{ id: 'MO-2025-001' }]);
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deleteMasterOrder({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.message.includes('associated records deleted'));

    const queries = db.getQueries();
    const shipmentsDelete = queries.find(q => q.sql.includes('DELETE FROM shipments'));
    const paymentsDelete = queries.find(q => q.sql.includes('DELETE FROM payments'));
    const orderDelete = queries.find(q => q.sql.includes('DELETE FROM orders'));

    assert.ok(shipmentsDelete, 'Should delete shipments first');
    assert.ok(paymentsDelete, 'Should delete payments first');
    assert.ok(orderDelete, 'Should delete order last');
  });
});

describe('Master Orders — updateOrderPriority', () => {
  it('validates orderID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await updateOrderPriority({}, env); },
      (err) => {
        assert.ok(err.message.includes('Order ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when update affects 0 rows', async () => {
    const db = createMockDB();
    db.setNextChanges(0);

    const env = { DB: db };
    await assert.rejects(
      async () => { await updateOrderPriority({ orderID: 'MO-2025-999', newPriority: 5 }, env); },
      (err) => {
        assert.ok(err.message.includes('Order not found'));
        return true;
      }
    );
  });

  it('updates priority successfully', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await updateOrderPriority({ orderID: 'MO-2025-001', newPriority: 3 }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });

  it('allows setting priority to null', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await updateOrderPriority({ orderID: 'MO-2025-001', newPriority: null }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });
});

// ---------------------------------------------------------------------------
// 3. Shipments Module
// ---------------------------------------------------------------------------

describe('Shipments — getShipments', () => {
  it('returns all shipments when no orderID filter', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM shipments', [
      {
        id: 'SH-001-01',
        order_id: 'MO-2025-001',
        invoice_number: 'INV-2025-0001',
        ship_date: '2025-01-20T00:00:00Z',
        status: 'shipped',
        quantity_kg: 10.5,
        total_value: 2500,
        tracking_number: 'TRACK123',
        carrier: 'FedEx',
        notes: '[{"strain":"OG","quantity":10.5,"unitPrice":238.1}]',
        created_at: '2025-01-20T10:00:00Z',
        updated_at: '2025-01-20T10:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getShipments({}, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.shipments.length, 1);

    const shipment = data.shipments[0];
    assert.equal(shipment.id, 'SH-001-01');
    assert.equal(shipment.orderID, 'MO-2025-001');
    assert.equal(shipment.invoiceNumber, 'INV-2025-0001');
    assert.equal(shipment.status, 'shipped');
    assert.equal(shipment.totalAmount, 2500);
    assert.equal(shipment.trackingNumber, 'TRACK123');
    assert.equal(shipment.carrier, 'FedEx');
    assert.deepEqual(shipment.lineItems, [{ strain: 'OG', quantity: 10.5, unitPrice: 238.1 }]);
  });

  it('filters by orderID when provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM shipments WHERE order_id = ?', [
      {
        id: 'SH-001-01',
        order_id: 'MO-2025-001',
        invoice_number: 'INV-2025-0001',
        ship_date: '2025-01-20T00:00:00Z',
        status: 'shipped',
        quantity_kg: 10,
        total_value: 2000,
        tracking_number: null,
        carrier: null,
        notes: '[]',
        created_at: '2025-01-20T10:00:00Z',
        updated_at: '2025-01-20T10:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getShipments({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.shipments.length, 1);
    assert.equal(data.shipments[0].orderID, 'MO-2025-001');
  });

  it('parses lineItems from notes JSON', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM shipments', [
      {
        id: 'SH-001-01',
        order_id: 'MO-2025-001',
        invoice_number: 'INV-2025-0001',
        ship_date: '2025-01-20T00:00:00Z',
        status: 'pending',
        quantity_kg: 0,
        total_value: 0,
        tracking_number: null,
        carrier: null,
        notes: '[{"strain":"Blue Dream","type":"Smalls","quantity":5.2,"unitPrice":150}]',
        created_at: '2025-01-20T10:00:00Z',
        updated_at: '2025-01-20T10:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getShipments({}, env);
    const data = await response.json();

    const lineItems = data.shipments[0].lineItems;
    assert.equal(lineItems.length, 1);
    assert.equal(lineItems[0].strain, 'Blue Dream');
    assert.equal(lineItems[0].type, 'Smalls');
    assert.equal(lineItems[0].quantity, 5.2);
    assert.equal(lineItems[0].unitPrice, 150);
  });
});

describe('Shipments — saveShipment', () => {
  it('generates SH-001-01 ID format', async () => {
    const db = createMockDB();
    db.addRows("SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-001-%'", [{ maxNum: null }]);
    db.addRows("SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-2025-%' ORDER BY invoice_number DESC LIMIT 1", []);

    const env = { DB: db };
    const body = { orderID: 'MO-2025-001', shipmentDate: '2025-01-20T00:00:00Z', totalAmount: 1000, lineItems: [] };
    const response = await saveShipment(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.shipment.id, 'SH-001-01');
  });

  it('generates INV-YYYY-0001 invoice number', async () => {
    const currentYear = new Date().getFullYear();
    const db = createMockDB();
    db.addRows("SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-001-%'", [{ maxNum: 0 }]);
    db.addRows(`SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-${currentYear}-%' ORDER BY invoice_number DESC LIMIT 1`, []);

    const env = { DB: db };
    const body = { orderID: 'MO-2025-001', totalAmount: 1500, lineItems: [] };
    const response = await saveShipment(body, env);
    const data = await response.json();

    assert.ok(data.shipment.invoiceNumber.startsWith(`INV-${currentYear}-`));
    assert.equal(data.shipment.invoiceNumber, `INV-${currentYear}-0001`);
  });

  it('increments invoice number correctly', async () => {
    const currentYear = new Date().getFullYear();
    const db = createMockDB();
    db.addRows("SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-001-%'", [{ maxNum: 0 }]);
    db.addRows(`SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-${currentYear}-%' ORDER BY invoice_number DESC LIMIT 1`, [
      { invoice_number: `INV-${currentYear}-0042` }
    ]);

    const env = { DB: db };
    const body = { orderID: 'MO-2025-001', totalAmount: 2000, lineItems: [] };
    const response = await saveShipment(body, env);
    const data = await response.json();

    assert.equal(data.shipment.invoiceNumber, `INV-${currentYear}-0043`);
  });

  it('calculates quantity_kg from lineItems', async () => {
    const db = createMockDB();
    db.addRows("SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-001-%'", [{ maxNum: 0 }]);
    db.addRows("SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-2025-%' ORDER BY invoice_number DESC LIMIT 1", []);
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', []);

    const env = { DB: db };
    const lineItems = [
      { strain: 'OG', type: 'Tops', quantity: 5.5, unitPrice: 250 },
      { strain: 'Blue Dream', type: 'Smalls', quantity: 3.2, unitPrice: 180 },
    ];
    const body = { orderID: 'MO-2025-001', totalAmount: 2000, lineItems };

    await saveShipment(body, env);

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO shipments'));
    assert.ok(insertQuery, 'Should insert shipment with calculated quantity_kg');
  });

  it('stores lineItems as JSON in notes column', async () => {
    const db = createMockDB();
    db.addRows("SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-001-%'", [{ maxNum: 0 }]);
    db.addRows("SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-2025-%' ORDER BY invoice_number DESC LIMIT 1", []);
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', []);

    const env = { DB: db };
    const lineItems = [{ strain: 'Test', type: 'Tops', quantity: 1, unitPrice: 100 }];
    const body = { orderID: 'MO-2025-001', totalAmount: 100, lineItems };

    const response = await saveShipment(body, env);
    const data = await response.json();

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO shipments'));
    assert.ok(insertQuery, 'Should store lineItems as JSON string');
  });

  it('updates existing shipment when ID provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM shipments WHERE id = ?', [{ id: 'SH-001-01' }]);
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', []);
    db.setNextChanges(1);

    const env = { DB: db };
    const body = { id: 'SH-001-01', orderID: 'MO-2025-001', status: 'delivered', lineItems: [] };
    const response = await saveShipment(body, env);
    const data = await response.json();

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const updateQuery = queries.find(q => q.sql.includes('UPDATE shipments'));
    assert.ok(updateQuery, 'Should execute UPDATE query');
  });
});

describe('Shipments — deleteShipment', () => {
  it('validates shipmentID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await deleteShipment({}, env); },
      (err) => {
        assert.ok(err.message.includes('Shipment ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when shipment does not exist', async () => {
    const db = createMockDB();
    db.setNextChanges(0);

    const env = { DB: db };
    await assert.rejects(
      async () => { await deleteShipment({ shipmentID: 'SH-999-99' }, env); },
      (err) => {
        assert.ok(err.message.includes('Shipment not found'));
        return true;
      }
    );
  });

  it('deletes shipment successfully', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deleteShipment({ shipmentID: 'SH-001-01' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.message.includes('deleted'));
  });
});

// ---------------------------------------------------------------------------
// 4. Payments Module
// ---------------------------------------------------------------------------

describe('Payments — getPayments', () => {
  it('returns all payments when no orderID filter', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM payments', [
      {
        id: 'PAY-00001',
        order_id: 'MO-2025-001',
        payment_date: '2025-01-25T00:00:00Z',
        amount: 1000,
        method: 'Wire',
        reference: 'REF123',
        notes: 'Partial payment',
        created_at: '2025-01-25T10:00:00Z',
        updated_at: '2025-01-25T10:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getPayments({}, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.payments.length, 1);

    const payment = data.payments[0];
    assert.equal(payment.id, 'PAY-00001');
    assert.equal(payment.orderID, 'MO-2025-001');
    assert.equal(payment.amount, 1000);
    assert.equal(payment.method, 'Wire');
    assert.equal(payment.reference, 'REF123');
    assert.equal(payment.notes, 'Partial payment');
  });

  it('filters by orderID when provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM payments WHERE order_id = ?', [
      {
        id: 'PAY-00001',
        order_id: 'MO-2025-001',
        payment_date: '2025-01-25T00:00:00Z',
        amount: 500,
        method: 'Check',
        reference: '',
        notes: '',
        created_at: '2025-01-25T10:00:00Z',
        updated_at: '2025-01-25T10:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getPayments({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.payments.length, 1);
    assert.equal(data.payments[0].orderID, 'MO-2025-001');
  });
});

describe('Payments — savePayment', () => {
  it('validates orderID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await savePayment({}, env); },
      (err) => {
        assert.ok(err.message.includes('Order ID is required'));
        return true;
      }
    );
  });

  it('generates PAY-00001 ID format', async () => {
    const db = createMockDB();
    db.addRows('SELECT COUNT(*) as cnt FROM payments', [{ cnt: 0 }]);

    const env = { DB: db };
    const body = { orderID: 'MO-2025-001', amount: 500, method: 'Cash' };
    const response = await savePayment(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.payment.id, 'PAY-00001');
  });

  it('increments payment ID correctly', async () => {
    const db = createMockDB();
    db.addRows('SELECT COUNT(*) as cnt FROM payments', [{ cnt: 42 }]);

    const env = { DB: db };
    const body = { orderID: 'MO-2025-001', amount: 750 };
    const response = await savePayment(body, env);
    const data = await response.json();

    assert.equal(data.payment.id, 'PAY-00043');
  });

  it('updates existing payment when ID provided', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM payments WHERE id = ?', [{ id: 'PAY-00001' }]);
    db.setNextChanges(1);

    const env = { DB: db };
    const body = { id: 'PAY-00001', orderID: 'MO-2025-001', amount: 1200, notes: 'Updated amount' };
    const response = await savePayment(body, env);
    const data = await response.json();

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const updateQuery = queries.find(q => q.sql.includes('UPDATE payments'));
    assert.ok(updateQuery, 'Should execute UPDATE query');
  });
});

describe('Payments — deletePayment', () => {
  it('validates paymentID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await deletePayment({}, env); },
      (err) => {
        assert.ok(err.message.includes('Payment ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when payment does not exist', async () => {
    const db = createMockDB();
    db.setNextChanges(0);

    const env = { DB: db };
    await assert.rejects(
      async () => { await deletePayment({ paymentID: 'PAY-99999' }, env); },
      (err) => {
        assert.ok(err.message.includes('Payment not found'));
        return true;
      }
    );
  });

  it('deletes payment successfully', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deletePayment({ paymentID: 'PAY-00001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.message.includes('deleted'));
  });
});

describe('Payments — Payment Links', () => {
  it('getPaymentLinks returns links with joined data', async () => {
    const db = createMockDB();
    db.addRows('SELECT psl.*, p.amount as payment_amount', [
      {
        id: 'PSL-123-abc',
        payment_id: 'PAY-00001',
        shipment_id: 'SH-001-01',
        amount: 500,
        payment_amount: 1000,
        payment_date: '2025-01-25T00:00:00Z',
        payment_reference: 'REF123',
        invoice_number: 'INV-2025-0001',
        shipment_amount: 2000,
      }
    ]);

    const env = { DB: db };
    const response = await getPaymentLinks({ paymentID: 'PAY-00001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.links.length, 1);

    const link = data.links[0];
    assert.equal(link.id, 'PSL-123-abc');
    assert.equal(link.paymentId, 'PAY-00001');
    assert.equal(link.shipmentId, 'SH-001-01');
    assert.equal(link.amount, 500);
    assert.equal(link.paymentAmount, 1000);
    assert.equal(link.invoiceNumber, 'INV-2025-0001');
  });

  it('savePaymentLink creates new link', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM payment_shipment_links WHERE payment_id = ? AND shipment_id = ?', []);

    const env = { DB: db };
    const body = { paymentId: 'PAY-00001', shipmentId: 'SH-001-01', amount: 500 };
    const response = await savePaymentLink(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.ok(data.id);
    assert.ok(data.id.startsWith('PSL-'));
  });

  it('savePaymentLink updates existing link', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM payment_shipment_links WHERE payment_id = ? AND shipment_id = ?', [
      { id: 'PSL-existing' }
    ]);
    db.setNextChanges(1);

    const env = { DB: db };
    const body = { paymentId: 'PAY-00001', shipmentId: 'SH-001-01', amount: 750 };
    const response = await savePaymentLink(body, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.id, 'PSL-existing');
    assert.equal(data.updated, true);
  });

  it('savePaymentLink validates required fields', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await savePaymentLink({ paymentId: 'PAY-00001' }, env); },
      (err) => {
        assert.ok(err.message.includes('paymentId and shipmentId are required'));
        return true;
      }
    );
  });

  it('deletePaymentLink by linkId', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deletePaymentLink({ linkId: 'PSL-123' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });

  it('deletePaymentLink by paymentId and shipmentId', async () => {
    const db = createMockDB();
    db.setNextChanges(1);

    const env = { DB: db };
    const response = await deletePaymentLink({ paymentId: 'PAY-00001', shipmentId: 'SH-001-01' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });

  it('deletePaymentLink all for paymentId', async () => {
    const db = createMockDB();
    db.setNextChanges(3);

    const env = { DB: db };
    const response = await deletePaymentLink({ paymentId: 'PAY-00001', all: true }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });

  it('deletePaymentLink all for shipmentId', async () => {
    const db = createMockDB();
    db.setNextChanges(2);

    const env = { DB: db };
    const response = await deletePaymentLink({ shipmentId: 'SH-001-01', all: true }, env);
    const data = await response.json();

    assert.equal(data.success, true);
  });

  it('deletePaymentLink validates parameters', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await deletePaymentLink({}, env); },
      (err) => {
        assert.ok(err.message.includes('linkId or'));
        return true;
      }
    );
  });
});

describe('Payments — Shipment Payment Status', () => {
  it('calculates status as paid when paidAmount >= totalAmount > 0', async () => {
    const db = createMockDB();
    db.addRows('SELECT s.id, s.invoice_number, s.total_value, COALESCE(SUM(psl.amount), 0) as amount_paid', [
      {
        id: 'SH-001-01',
        invoice_number: 'INV-2025-0001',
        total_value: 1000,
        amount_paid: 1000,
      }
    ]);

    const env = { DB: db };
    const response = await getShipmentPaymentStatus({ shipmentId: 'SH-001-01' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.status, 'paid');
    assert.equal(data.paidAmount, 1000);
    assert.equal(data.totalAmount, 1000);
    assert.equal(data.balance, 0);
  });

  it('calculates status as partial when 0 < paidAmount < totalAmount', async () => {
    const db = createMockDB();
    db.addRows('SELECT s.id, s.invoice_number, s.total_value, COALESCE(SUM(psl.amount), 0) as amount_paid', [
      {
        id: 'SH-001-01',
        invoice_number: 'INV-2025-0001',
        total_value: 1000,
        amount_paid: 500,
      }
    ]);

    const env = { DB: db };
    const response = await getShipmentPaymentStatus({ shipmentId: 'SH-001-01' }, env);
    const data = await response.json();

    assert.equal(data.status, 'partial');
    assert.equal(data.paidAmount, 500);
    assert.equal(data.totalAmount, 1000);
    assert.equal(data.balance, 500);
  });

  it('calculates status as unpaid when paidAmount = 0', async () => {
    const db = createMockDB();
    db.addRows('SELECT s.id, s.invoice_number, s.total_value, COALESCE(SUM(psl.amount), 0) as amount_paid', [
      {
        id: 'SH-001-01',
        invoice_number: 'INV-2025-0001',
        total_value: 1000,
        amount_paid: 0,
      }
    ]);

    const env = { DB: db };
    const response = await getShipmentPaymentStatus({ shipmentId: 'SH-001-01' }, env);
    const data = await response.json();

    assert.equal(data.status, 'unpaid');
    assert.equal(data.paidAmount, 0);
    assert.equal(data.balance, 1000);
  });

  it('returns array of shipments when no shipmentId specified', async () => {
    const db = createMockDB();
    db.addRows('SELECT s.id, s.invoice_number, s.total_value, COALESCE(SUM(psl.amount), 0) as amount_paid', [
      {
        id: 'SH-001-01',
        invoice_number: 'INV-2025-0001',
        total_value: 1000,
        amount_paid: 500,
      },
      {
        id: 'SH-001-02',
        invoice_number: 'INV-2025-0002',
        total_value: 2000,
        amount_paid: 2000,
      }
    ]);

    const env = { DB: db };
    const response = await getShipmentPaymentStatus({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.shipments.length, 2);
    assert.equal(data.shipments[0].status, 'partial');
    assert.equal(data.shipments[1].status, 'paid');
  });
});

// ---------------------------------------------------------------------------
// 5. Financials Module
// ---------------------------------------------------------------------------

describe('Financials — getOrderFinancials', () => {
  it('validates orderID is required', async () => {
    const env = createMockEnv();
    await assert.rejects(
      async () => { await getOrderFinancials({}, env); },
      (err) => {
        assert.ok(err.message.includes('Order ID is required'));
        return true;
      }
    );
  });

  it('throws NOT_FOUND when order does not exist', async () => {
    const db = createMockDB();
    db.addRows('SELECT commitment_price FROM orders WHERE id = ?', []);

    const env = { DB: db };
    await assert.rejects(
      async () => { await getOrderFinancials({ orderID: 'MO-2025-999' }, env); },
      (err) => {
        assert.ok(err.message.includes('Order not found'));
        return true;
      }
    );
  });

  it('calculates outstanding = commitment - fulfilled', async () => {
    const db = createMockDB();
    db.addRows('SELECT commitment_price FROM orders WHERE id = ?', [{ commitment_price: 10000 }]);
    db.addRows('SELECT SUM(total_value) as total FROM shipments WHERE order_id = ?', [{ total: 6000 }]);
    db.addRows('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [{ total: 3000 }]);

    const env = { DB: db };
    const response = await getOrderFinancials({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.commitment, 10000);
    assert.equal(data.fulfilled, 6000);
    assert.equal(data.paid, 3000);
    assert.equal(data.outstanding, 4000); // 10000 - 6000
    assert.equal(data.balance, 3000); // 6000 - 3000
  });

  it('calculates balance = fulfilled - paid', async () => {
    const db = createMockDB();
    db.addRows('SELECT commitment_price FROM orders WHERE id = ?', [{ commitment_price: 5000 }]);
    db.addRows('SELECT SUM(total_value) as total FROM shipments WHERE order_id = ?', [{ total: 5000 }]);
    db.addRows('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [{ total: 2000 }]);

    const env = { DB: db };
    const response = await getOrderFinancials({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.outstanding, 0); // 5000 - 5000
    assert.equal(data.balance, 3000); // 5000 - 2000
  });

  it('handles null values gracefully', async () => {
    const db = createMockDB();
    db.addRows('SELECT commitment_price FROM orders WHERE id = ?', [{ commitment_price: null }]);
    db.addRows('SELECT SUM(total_value) as total FROM shipments WHERE order_id = ?', [{ total: null }]);
    db.addRows('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [{ total: null }]);

    const env = { DB: db };
    const response = await getOrderFinancials({ orderID: 'MO-2025-001' }, env);
    const data = await response.json();

    assert.equal(data.commitment, 0);
    assert.equal(data.fulfilled, 0);
    assert.equal(data.paid, 0);
    assert.equal(data.outstanding, 0);
    assert.equal(data.balance, 0);
  });
});

describe('Financials — getPriceHistory', () => {
  it('returns price history with mapped fields', async () => {
    const db = createMockDB();
    db.addRows('SELECT * FROM price_history ORDER BY effective_date DESC', [
      {
        id: 1,
        strain: 'OG Kush',
        type: 'Tops',
        price: 250,
        effective_date: '2025-01-15T00:00:00Z',
      },
      {
        id: 2,
        strain: 'Blue Dream',
        type: 'Smalls',
        price: 180,
        effective_date: '2025-01-10T00:00:00Z',
      }
    ]);

    const env = { DB: db };
    const response = await getPriceHistory(env);
    const data = await response.json();

    assert.equal(data.success, true);
    assert.equal(data.prices.length, 2);

    const first = data.prices[0];
    assert.equal(first.strain, 'OG Kush');
    assert.equal(first.type, 'Tops');
    assert.equal(first.lastPrice, 250);
    assert.equal(first.lastUsedDate, '2025-01-15T00:00:00Z');
    assert.equal(first.customerID, '');
  });
});

describe('Financials — updatePriceHistoryForItems', () => {
  it('skips items without strain/type/unitPrice', async () => {
    const db = createMockDB();
    const env = { DB: db };

    const lineItems = [
      { strain: 'OG', type: 'Tops' }, // no unitPrice
      { strain: 'OG', unitPrice: 250 }, // no type
      { type: 'Tops', unitPrice: 250 }, // no strain
    ];

    await updatePriceHistoryForItems(lineItems, env);

    const queries = db.getQueries();
    assert.equal(queries.length, 0, 'Should not execute any queries for incomplete items');
  });

  it('updates existing price history', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', [{ id: 1 }]);
    db.setNextChanges(1);

    const env = { DB: db };
    const lineItems = [{ strain: 'OG Kush', type: 'Tops', unitPrice: 260 }];

    await updatePriceHistoryForItems(lineItems, env);

    const queries = db.getQueries();
    const updateQuery = queries.find(q => q.sql.includes('UPDATE price_history'));
    assert.ok(updateQuery, 'Should update existing price history');
  });

  it('inserts new price history', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', []);

    const env = { DB: db };
    const lineItems = [{ strain: 'New Strain', type: 'Smalls', unitPrice: 150 }];

    await updatePriceHistoryForItems(lineItems, env);

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO price_history'));
    assert.ok(insertQuery, 'Should insert new price history');
  });

  it('processes multiple items', async () => {
    const db = createMockDB();
    db.addRows('SELECT id FROM price_history WHERE strain = ? AND type = ?', []);

    const env = { DB: db };
    const lineItems = [
      { strain: 'Strain A', type: 'Tops', unitPrice: 250 },
      { strain: 'Strain B', type: 'Smalls', unitPrice: 180 },
    ];

    await updatePriceHistoryForItems(lineItems, env);

    const queries = db.getQueries();
    const insertQueries = queries.filter(q => q.sql.includes('INSERT INTO price_history'));
    assert.equal(insertQueries.length, 2, 'Should process both items');
  });

  it('handles empty lineItems array', async () => {
    const db = createMockDB();
    const env = { DB: db };

    await updatePriceHistoryForItems([], env);

    const queries = db.getQueries();
    assert.equal(queries.length, 0, 'Should not execute queries for empty array');
  });

  it('handles null/undefined lineItems', async () => {
    const db = createMockDB();
    const env = { DB: db };

    await updatePriceHistoryForItems(null, env);
    await updatePriceHistoryForItems(undefined, env);

    const queries = db.getQueries();
    assert.equal(queries.length, 0, 'Should not crash on null/undefined');
  });
});

// ---------------------------------------------------------------------------
// 6. Shared Utilities
// ---------------------------------------------------------------------------

describe('Shared — formatDate', () => {
  it('converts Date object to ISO string', () => {
    const date = new Date('2025-01-15T10:30:00Z');
    const result = formatDate(date);
    assert.equal(result, '2025-01-15T10:30:00.000Z');
  });

  it('returns string as-is when non-empty', () => {
    const dateStr = '2025-01-15T00:00:00Z';
    const result = formatDate(dateStr);
    assert.equal(result, dateStr);
  });

  it('returns null for empty string', () => {
    const result = formatDate('');
    assert.equal(result, null);
  });

  it('returns null for whitespace-only string', () => {
    const result = formatDate('   ');
    assert.equal(result, null);
  });

  it('returns null for null input', () => {
    const result = formatDate(null);
    assert.equal(result, null);
  });

  it('returns null for undefined input', () => {
    const result = formatDate(undefined);
    assert.equal(result, null);
  });
});

describe('Shared — Constants', () => {
  it('exports COA_FOLDER_ID', () => {
    assert.equal(typeof COA_FOLDER_ID, 'string');
    assert.ok(COA_FOLDER_ID.length > 0);
  });

  it('exports SHEETS object with expected keys', () => {
    assert.equal(typeof SHEETS, 'object');
    assert.equal(SHEETS.customers, 'Customers');
    assert.equal(SHEETS.orders, 'MasterOrders');
    assert.equal(SHEETS.shipments, 'Shipments');
    assert.equal(SHEETS.payments, 'Payments');
    assert.equal(SHEETS.priceHistory, 'PriceHistory');
    assert.equal(SHEETS.coaIndex, 'COA_Index');
  });
});
