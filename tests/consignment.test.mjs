/**
 * Comprehensive test suite for consignment-d1.js handler
 * Framework: node:test + node:assert/strict
 *
 * Coverage: 36 tests across 9 test suites
 * - Validation (9 tests): Required fields, type constraints, positive values
 * - Inventory Calculations (6 tests): Balance, on-hand calculation, enrichment
 * - Sale Availability (3 tests): Inventory checking, overflow prevention
 * - Batch Operations (2 tests): Multi-line intake validation, batch_id assignment
 * - Data Transformations (3 tests): Activity feed, partner enrichment, pagination
 * - Delete Operations (5 tests): Cascade deletes, validation, unknown actions
 * - Edge Cases (2 tests): Negative balance clamping, empty partners
 * - Authentication (3 tests): Write auth required, read auth optional, invalid password
 * - Strain Operations (3 tests): List strains, validation, trimming
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDB } from './helpers/d1-mock.mjs';
import { handleConsignmentD1 } from '../workers/src/handlers/consignment-d1.js';

/**
 * Create a mock request for testing
 * @param {string} action - The action query parameter
 * @param {object} options
 * @returns {Request-like object}
 */
function makeRequest(action, { method = 'GET', body = {}, params = {}, auth = true } = {}) {
  const searchParams = new URLSearchParams({ action, ...params });
  const url = `https://test.workers.dev/api/consignment?${searchParams}`;

  const headers = {
    'content-type': method === 'POST' ? 'text/plain' : null,
  };

  // Add auth for write actions
  if (auth && method === 'POST') {
    body.password = 'test-password';
  }

  return {
    url,
    method,
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        return headers[lower] || null;
      },
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

/**
 * Create a mock env with DB and auth configured
 */
function makeEnv(db) {
  return {
    DB: db,
    ORDERS_PASSWORD: 'test-password',
  };
}

/**
 * Parse response from handler
 */
async function parseResponse(response) {
  const text = await response.text();
  return JSON.parse(text);
}

// ─── VALIDATION TESTS ───────────────────────────────────

describe('Consignment API - Validation', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('savePartner: name required', async () => {
    const request = makeRequest('saveConsignmentPartner', {
      method: 'POST',
      body: { name: '' },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /name is required/i }
    );
  });

  test('savePartner: name trimmed on save', async () => {
    db.setNextId(5);

    const request = makeRequest('saveConsignmentPartner', {
      method: 'POST',
      body: { name: '  Test Farm  ', contact_name: 'John' },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.id, 5);

    const queries = db.getQueries();
    const insertQuery = queries.find(q => q.sql.includes('INSERT INTO consignment_partners'));
    assert.ok(insertQuery);
    assert.equal(insertQuery.params[0], 'Test Farm'); // trimmed
  });

  test('saveIntake: all required fields', async () => {
    const request = makeRequest('saveConsignmentIntake', {
      method: 'POST',
      body: { partner_id: 1 }, // missing other fields
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /required/i }
    );
  });

  test('saveIntake: type must be tops or smalls', async () => {
    const request = makeRequest('saveConsignmentIntake', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-15',
        strain: 'OG Kush',
        type: 'invalid',
        weight_lbs: 100,
        price_per_lb: 500,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /must be tops or smalls/i }
    );
  });

  test('saveIntake: weight must be positive', async () => {
    const request = makeRequest('saveConsignmentIntake', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-15',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 0,
        price_per_lb: 500,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /weight must be positive/i }
    );
  });

  test('saveIntake: price must be positive', async () => {
    const request = makeRequest('saveConsignmentIntake', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-15',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 100,
        price_per_lb: -100,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /price.*must be positive/i }
    );
  });

  test('saveSale: weight must be positive', async () => {
    const request = makeRequest('saveConsignmentSale', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-20',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 0,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /weight must be positive/i }
    );
  });

  test('savePayment: amount must be positive', async () => {
    const request = makeRequest('saveConsignmentPayment', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-25',
        amount: -500,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /amount must be positive/i }
    );
  });

  test('saveInventoryCount: counted_lbs must be >= 0', async () => {
    const request = makeRequest('saveConsignmentInventoryCount', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-30',
        strain: 'OG Kush',
        type: 'tops',
        counted_lbs: -5,
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /count must be zero or positive/i }
    );
  });
});

// ─── INVENTORY CALCULATIONS ─────────────────────────────

describe('Consignment API - Inventory Calculations', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('getPartners enriches with balance_owed and inventory_lbs', async () => {
    db.addRows('SELECT * FROM consignment_partners ORDER BY name', [
      { id: 1, name: 'Test Farm' },
    ]);

    // Inventory: 100 lbs intake - 30 lbs sold = 70 lbs on hand
    db.addRows('COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sale_lbs), 0) as on_hand', [
      { on_hand: 70 },
    ]);

    // Balance: 30 lbs * $500/lb = $15,000 owed
    db.addRows('COALESCE(SUM(sub.owed), 0) as total_owed', [
      { total_owed: 15000 },
    ]);

    // Payments: $10,000 paid
    db.addRows('COALESCE(SUM(amount), 0) as total', [
      { total: 10000, last_date: '2026-01-20' },
    ]);

    db.addRows('MAX(date) as last_date FROM consignment_intakes', [
      { last_date: '2026-01-15' },
    ]);

    const request = makeRequest('getConsignmentPartners');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.length, 1);
    assert.equal(data.data[0].balance_owed, 5000); // 15000 - 10000
    assert.equal(data.data[0].inventory_lbs, 70);
    assert.equal(data.data[0].last_intake_date, '2026-01-15');
    assert.equal(data.data[0].last_payment_date, '2026-01-20');
  });

  test('Balance owed = sum(sale_lbs * intake_price) - payments, clamped to 0', async () => {
    db.addRows('SELECT * FROM consignment_partners ORDER BY name', [
      { id: 1, name: 'Paid Farm' },
    ]);

    db.addRows('on_hand', [{ on_hand: 50 }]);

    // Owed: $5,000
    db.addRows('total_owed', [{ total_owed: 5000 }]);

    // Paid: $6,000 (overpaid)
    db.addRows('total', [{ total: 6000, last_date: null }]);
    db.addRows('last_date FROM consignment_intakes', [{ last_date: null }]);

    const request = makeRequest('getConsignmentPartners');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    // Balance should be clamped to 0 (never negative)
    assert.equal(data.data[0].balance_owed, 0);
  });

  test('getPartnerDetail calculates total balance correctly', async () => {
    db.addRows('SELECT * FROM consignment_partners WHERE id = ?', [
      { id: 1, name: 'Test Farm' },
    ]);

    db.addRows('SELECT * FROM consignment_intakes WHERE partner_id = ?', [
      { id: 1, date: '2026-01-10', strain: 'OG Kush', type: 'tops', weight_lbs: 100, price_per_lb: 500 },
    ]);

    db.addRows('SELECT * FROM consignment_sales WHERE partner_id = ?', [
      { id: 1, date: '2026-01-15', strain: 'OG Kush', type: 'tops', weight_lbs: 50 },
    ]);

    db.addRows('SELECT * FROM consignment_payments WHERE partner_id = ?', [
      { id: 1, date: '2026-01-20', amount: 15000 },
    ]);

    // For each sale, mock the intake price lookup
    db.addRows('SELECT price_per_lb FROM consignment_intakes', [
      { price_per_lb: 500 },
    ]);

    // Inventory query
    db.addRows('on_hand_lbs', [
      { strain: 'OG Kush', type: 'tops', on_hand_lbs: 50 },
    ]);

    const request = makeRequest('getConsignmentPartnerDetail', { params: { id: 1 } });
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.partner.id, 1);
    assert.equal(data.data.balance_owed, 10000); // 50 lbs * $500 - $15,000
    assert.equal(data.data.total_paid, 15000);
    assert.equal(data.data.inventory.length, 1);
  });

  test('getInventory returns on_hand = intakes - sales, filtered to > 0', async () => {
    db.addRows('on_hand_lbs', [
      { partner_id: 1, partner_name: 'Test Farm', strain: 'OG Kush', type: 'tops', total_intake: 100, total_sold: 30, on_hand_lbs: 70 },
      { partner_id: 1, partner_name: 'Test Farm', strain: 'Blue Dream', type: 'smalls', total_intake: 50, total_sold: 10, on_hand_lbs: 40 },
    ]);

    const request = makeRequest('getConsignmentInventory', { params: { partner_id: 1 } });
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.length, 2);
    assert.equal(data.data[0].on_hand_lbs, 70);
    assert.equal(data.data[1].on_hand_lbs, 40);
  });

  test('saveInventoryCount auto-creates sale when count < expected', async () => {
    // Expected inventory: 100 lbs intake - 20 lbs sold = 80 lbs
    db.addRows('expected', [{ expected: 80 }]);

    // Price lookup for auto-sale
    db.addRows('SELECT price_per_lb FROM consignment_intakes', [
      { price_per_lb: 500 },
    ]);

    db.setNextId(10);

    const request = makeRequest('saveConsignmentInventoryCount', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-30',
        strain: 'OG Kush',
        type: 'tops',
        counted_lbs: 70, // 10 lbs short
      },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.expected_lbs, 80);
    assert.equal(data.data.counted_lbs, 70);
    assert.equal(data.data.sold_lbs, 10);
    assert.equal(data.data.auto_sale_created, true);

    const queries = db.getQueries();
    const saleInsert = queries.find(q => q.sql.includes('INSERT INTO consignment_sales'));
    assert.ok(saleInsert);
    assert.equal(saleInsert.params[4], 10); // weight_lbs
    assert.ok(saleInsert.sql.includes("'inventory_count'")); // channel is hardcoded in SQL
    assert.ok(saleInsert.params[6].includes('Inventory count')); // notes
  });

  test('saveInventoryCount does NOT create sale when count >= expected', async () => {
    db.addRows('expected', [{ expected: 80 }]);

    const request = makeRequest('saveConsignmentInventoryCount', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-30',
        strain: 'OG Kush',
        type: 'tops',
        counted_lbs: 85, // More than expected (someone added more)
      },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.expected_lbs, 80);
    assert.equal(data.data.counted_lbs, 85);
    assert.equal(data.data.sold_lbs, 0);
    assert.equal(data.data.auto_sale_created, false);

    const queries = db.getQueries();
    const saleInsert = queries.find(q => q.sql.includes('INSERT INTO consignment_sales'));
    assert.ok(!saleInsert); // No sale should be created
  });
});

// ─── SALE AVAILABILITY CHECK ────────────────────────────

describe('Consignment API - Sale Availability', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('saveSale checks available inventory', async () => {
    // Available: 50 lbs
    db.addRows('available', [{ available: 50 }]);
    db.setNextId(1);

    const request = makeRequest('saveConsignmentSale', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-20',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 30,
      },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.id, 1);
  });

  test('saveSale throws when requesting more than available', async () => {
    // Available: 20 lbs
    db.addRows('available', [{ available: 20 }]);

    const request = makeRequest('saveConsignmentSale', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-20',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 50, // Want 50, only 20 available
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /only 20\.0 lbs available.*requested 50/i }
    );
  });

  test('saveSale succeeds when enough inventory exists', async () => {
    db.addRows('available', [{ available: 100 }]);
    db.setNextId(5);

    const request = makeRequest('saveConsignmentSale', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-20',
        strain: 'OG Kush',
        type: 'tops',
        weight_lbs: 100,
        sale_price_per_lb: 600,
        channel: 'wholesale',
      },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.id, 5);

    const queries = db.getQueries();
    const insert = queries.find(q => q.sql.includes('INSERT INTO consignment_sales'));
    assert.equal(insert.params[4], 100); // weight_lbs
    assert.equal(insert.params[5], 600); // sale_price_per_lb
    assert.equal(insert.params[6], 'wholesale'); // channel
  });
});

// ─── BATCH OPERATIONS ───────────────────────────────────

describe('Consignment API - Batch Operations', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('saveBatchIntake validates items array', async () => {
    const request = makeRequest('saveConsignmentBatchIntake', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-15',
        items: [], // Empty array
      },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /at least one item is required/i }
    );
  });

  test('saveBatchIntake assigns shared batch_id', async () => {
    db.setNextId(10);

    const request = makeRequest('saveConsignmentBatchIntake', {
      method: 'POST',
      body: {
        partner_id: 1,
        date: '2026-01-15',
        items: [
          { strain: 'OG Kush', type: 'tops', weight_lbs: 50, price_per_lb: 500 },
          { strain: 'Blue Dream', type: 'smalls', weight_lbs: 30, price_per_lb: 400 },
          { strain: 'Sour Diesel', type: 'tops', weight_lbs: 20, price_per_lb: 550 },
        ],
      },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.count, 3);
    assert.equal(data.data.items.length, 3);
    assert.ok(data.data.batch_id);
    assert.ok(data.data.batch_id.startsWith('batch_'));

    // Check all inserts have the same batch_id
    const queries = db.getQueries();
    const inserts = queries.filter(q => q.sql.includes('INSERT INTO consignment_intakes'));
    assert.equal(inserts.length, 3);

    const batchId = inserts[0].params[7]; // batch_id is 8th param (index 7)
    assert.ok(batchId);
    assert.equal(inserts[1].params[7], batchId);
    assert.equal(inserts[2].params[7], batchId);
  });
});

// ─── DATA TRANSFORMATIONS ───────────────────────────────

describe('Consignment API - Data Transformations', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('getActivity merges intakes, sales, payments into unified feed', async () => {
    db.addRows('activity_type', [
      { activity_type: 'intake', id: 1, partner_id: 1, date: '2026-01-10', strain: 'OG Kush', type: 'tops', weight_lbs: 100, price: 500, amount: null, method: null, batch_id: null, notes: null, created_at: '2026-01-10 08:00' },
      { activity_type: 'sale', id: 1, partner_id: 1, date: '2026-01-15', strain: 'OG Kush', type: 'tops', weight_lbs: 30, price: 600, amount: null, method: 'wholesale', batch_id: null, notes: null, created_at: '2026-01-15 10:00' },
      { activity_type: 'payment', id: 1, partner_id: 1, date: '2026-01-20', strain: null, type: null, weight_lbs: null, price: null, amount: 15000, method: 'check', batch_id: null, notes: null, created_at: '2026-01-20 14:00' },
    ]);

    db.addRows('SELECT name FROM consignment_partners WHERE id = ?', [
      { name: 'Test Farm' },
    ]);

    const request = makeRequest('getConsignmentActivity', { params: { partner_id: 1, limit: 10 } });
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.length, 3);
    assert.equal(data.data[0].activity_type, 'intake');
    assert.equal(data.data[1].activity_type, 'sale');
    assert.equal(data.data[2].activity_type, 'payment');
  });

  test('getActivity enriches with partner_name', async () => {
    db.addRows('activity_type', [
      { activity_type: 'intake', id: 1, partner_id: 1, date: '2026-01-10', strain: 'OG Kush', type: 'tops', weight_lbs: 100, price: 500, amount: null, method: null, batch_id: null, notes: null, created_at: '2026-01-10 08:00' },
      { activity_type: 'sale', id: 1, partner_id: 2, date: '2026-01-15', strain: 'Blue Dream', type: 'smalls', weight_lbs: 20, price: 400, amount: null, method: 'retail', batch_id: null, notes: null, created_at: '2026-01-15 10:00' },
    ]);

    // Mock partner lookups
    db.addRows('SELECT name FROM consignment_partners WHERE id = ?', [
      { name: 'Farm A' },
    ]);

    const request = makeRequest('getConsignmentActivity');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.data[0].partner_name, 'Farm A');
    assert.equal(data.data[1].partner_name, 'Farm A'); // Mock returns same for all
  });

  test('getActivity respects limit/offset', async () => {
    db.addRows('activity_type', [
      { activity_type: 'intake', id: 5, partner_id: 1, date: '2026-01-25', strain: 'OG Kush', type: 'tops', weight_lbs: 40, price: 500, amount: null, method: null, batch_id: null, notes: null, created_at: '2026-01-25 08:00' },
      { activity_type: 'sale', id: 3, partner_id: 1, date: '2026-01-26', strain: 'OG Kush', type: 'tops', weight_lbs: 10, price: 600, amount: null, method: 'retail', batch_id: null, notes: null, created_at: '2026-01-26 10:00' },
    ]);

    db.addRows('SELECT name FROM consignment_partners WHERE id = ?', [
      { name: 'Test Farm' },
    ]);

    const request = makeRequest('getConsignmentActivity', { params: { limit: 2, offset: 5 } });
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.length, 2);

    // Verify SQL includes LIMIT and OFFSET
    const queries = db.getQueries();
    const activityQuery = queries.find(q => q.sql.includes('LIMIT'));
    assert.ok(activityQuery);
    assert.ok(activityQuery.params.includes(2)); // limit
    assert.ok(activityQuery.params.includes(5)); // offset
  });
});

// ─── DELETE OPERATIONS ──────────────────────────────────

describe('Consignment API - Delete Operations', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('deletePartner cascades (deletes intakes, sales, payments first)', async () => {
    const request = makeRequest('deleteConsignmentPartner', {
      method: 'POST',
      body: { id: 1 },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const deletes = queries.filter(q => q.sql.includes('DELETE'));

    assert.equal(deletes.length, 4);
    assert.ok(deletes[0].sql.includes('consignment_intakes'));
    assert.ok(deletes[1].sql.includes('consignment_sales'));
    assert.ok(deletes[2].sql.includes('consignment_payments'));
    assert.ok(deletes[3].sql.includes('consignment_partners'));
  });

  test('deleteIntake validates ID required', async () => {
    const request = makeRequest('deleteConsignmentIntake', {
      method: 'POST',
      body: {},
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /intake id is required/i }
    );
  });

  test('deleteSale validates ID required', async () => {
    const request = makeRequest('deleteConsignmentSale', {
      method: 'POST',
      body: {},
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /sale id is required/i }
    );
  });

  test('deletePayment validates ID required', async () => {
    const request = makeRequest('deleteConsignmentPayment', {
      method: 'POST',
      body: {},
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /payment id is required/i }
    );
  });

  test('Unknown action throws NOT_FOUND', async () => {
    const request = makeRequest('unknownConsignmentAction');

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /unknown consignment action/i }
    );
  });
});

// ─── EDGE CASES ─────────────────────────────────────────

describe('Consignment API - Edge Cases', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('Balance owed clamped to 0 (never negative)', async () => {
    db.addRows('SELECT * FROM consignment_partners ORDER BY name', [
      { id: 1, name: 'Overpaid Farm' },
    ]);

    db.addRows('on_hand', [{ on_hand: 0 }]);
    db.addRows('total_owed', [{ total_owed: 10000 }]);
    db.addRows('total', [{ total: 20000, last_date: '2026-01-20' }]); // Paid $20k, owed $10k
    db.addRows('last_date FROM consignment_intakes', [{ last_date: '2026-01-15' }]);

    const request = makeRequest('getConsignmentPartners');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.data[0].balance_owed, 0); // Should be 0, not -10000
  });

  test('Empty partner with no transactions', async () => {
    db.addRows('SELECT * FROM consignment_partners ORDER BY name', [
      { id: 1, name: 'New Partner' },
    ]);

    db.addRows('on_hand', [{ on_hand: 0 }]);
    db.addRows('total_owed', [{ total_owed: 0 }]);
    db.addRows('total', [{ total: 0, last_date: null }]);
    db.addRows('last_date FROM consignment_intakes', [{ last_date: null }]);

    const request = makeRequest('getConsignmentPartners');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data[0].balance_owed, 0);
    assert.equal(data.data[0].inventory_lbs, 0);
    assert.equal(data.data[0].last_intake_date, null);
    assert.equal(data.data[0].last_payment_date, null);
  });
});

// ─── AUTHENTICATION ─────────────────────────────────────

describe('Consignment API - Authentication', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('Write actions require auth', async () => {
    const request = makeRequest('saveConsignmentPartner', {
      method: 'POST',
      body: { name: 'Test Farm' },
      auth: false, // No password
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /password required/i }
    );
  });

  test('Read actions do not require auth', async () => {
    db.addRows('SELECT * FROM consignment_partners ORDER BY name', []);
    db.addRows('on_hand', []);
    db.addRows('total_owed', []);
    db.addRows('total', []);
    db.addRows('last_date', []);

    const request = makeRequest('getConsignmentPartners', { auth: false });
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
  });

  test('Invalid password throws', async () => {
    const request = makeRequest('saveConsignmentPartner', {
      method: 'POST',
      body: { name: 'Test Farm', password: 'wrong-password' },
      auth: false, // Don't auto-add the correct password
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /invalid password/i }
    );
  });
});

// ─── STRAIN OPERATIONS ──────────────────────────────────

describe('Consignment API - Strain Operations', () => {
  let db, env;

  beforeEach(() => {
    db = createMockDB();
    env = makeEnv(db);
  });

  test('getStrains returns active strains', async () => {
    db.addRows('SELECT * FROM consignment_strains WHERE active = 1 ORDER BY name', [
      { id: 1, name: 'Blue Dream', active: 1 },
      { id: 2, name: 'OG Kush', active: 1 },
    ]);

    const request = makeRequest('getConsignmentStrains');
    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);
    assert.equal(data.data.length, 2);
    assert.equal(data.data[0].name, 'Blue Dream');
  });

  test('saveStrain validates name required', async () => {
    const request = makeRequest('saveConsignmentStrain', {
      method: 'POST',
      body: { name: '' },
    });

    await assert.rejects(
      async () => handleConsignmentD1(request, env, {}),
      { message: /strain name is required/i }
    );
  });

  test('saveStrain trims name', async () => {
    db.setNextId(3);

    const request = makeRequest('saveConsignmentStrain', {
      method: 'POST',
      body: { name: '  Sour Diesel  ' },
    });

    const response = await handleConsignmentD1(request, env, {});
    const data = await parseResponse(response);

    assert.equal(data.success, true);

    const queries = db.getQueries();
    const insert = queries.find(q => q.sql.includes('INSERT'));
    assert.equal(insert.params[0], 'Sour Diesel'); // trimmed
  });
});
