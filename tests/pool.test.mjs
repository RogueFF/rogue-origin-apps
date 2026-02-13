/**
 * Test suite for workers/src/handlers/pool-d1.js
 * Framework: node:test + node:assert/strict
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDB } from './helpers/d1-mock.mjs';
import { handlePoolD1 } from '../workers/src/handlers/pool-d1.js';

/**
 * Helper: Create a mock request for pool handler
 */
function makeRequest(action, { method = 'GET', body = {}, params = {} } = {}) {
  const searchParams = new URLSearchParams({ action, ...params });
  const url = `https://test.workers.dev/api/pool-bins?${searchParams}`;
  return {
    url,
    method,
    headers: {
      get(name) { return null; },
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

/**
 * Helper: Parse response from handler
 */
async function parseResponse(response) {
  return JSON.parse(await response.text());
}

describe('Pool Inventory Handler', () => {
  let db;
  let env;

  beforeEach(() => {
    db = createMockDB();
    env = { DB: db };
  });

  // ==========================================
  // 1. BIN CREATION VALIDATION (6 tests)
  // ==========================================

  describe('createBin - validation', () => {
    it('should require all fields (bin_number, cultivar, type, source)', async () => {
      const req = makeRequest('createBin', {
        method: 'POST',
        body: { bin_number: 'B001' } // missing cultivar, type, source
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Missing required fields/ }
      );
    });

    it('should reject invalid type (must be tops or smalls)', async () => {
      const req = makeRequest('createBin', {
        method: 'POST',
        body: {
          bin_number: 'B001',
          cultivar: 'Test Strain',
          type: 'invalid',
          source: 'in-house'
        }
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Invalid type. Must be: tops, smalls/ }
      );
    });

    it('should reject invalid source (must be in-house or consignment)', async () => {
      const req = makeRequest('createBin', {
        method: 'POST',
        body: {
          bin_number: 'B001',
          cultivar: 'Test Strain',
          type: 'tops',
          source: 'unknown'
        }
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Invalid source. Must be: in-house, consignment/ }
      );
    });

    it('should create bin successfully and return binId', async () => {
      db.setNextId(42);

      const req = makeRequest('createBin', {
        method: 'POST',
        body: {
          bin_number: 'B001',
          cultivar: 'Cherry Gelato',
          type: 'tops',
          source: 'in-house'
        }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.equal(data.success, true);
      assert.equal(data.binId, 42);
      assert.equal(data.message, 'Bin created successfully');

      // Verify INSERT bin was executed
      const queries = db.getQueries();
      const binInsert = queries.find(q => q.sql.includes('INSERT INTO bins'));
      assert.ok(binInsert, 'Should insert into bins table');
      assert.deepEqual(binInsert.params, ['B001', 'Cherry Gelato', 'tops', 'in-house', 12.5]);
    });

    it('should initialize bin_balances with 0/0/0', async () => {
      db.setNextId(10);

      const req = makeRequest('createBin', {
        method: 'POST',
        body: {
          bin_number: 'B002',
          cultivar: 'Lemon Haze',
          type: 'smalls',
          source: 'consignment'
        }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balanceInsert = queries.find(q => q.sql.includes('INSERT INTO bin_balances'));
      assert.ok(balanceInsert, 'Should initialize bin_balances');
      // Handler uses literal 0 values in SQL, only binId is a parameter
      assert.deepEqual(balanceInsert.params, [10]);
      assert.ok(balanceInsert.sql.includes('VALUES (?, 0, 0, 0)'), 'Should insert 0/0/0 for balances');
    });

    it('should use default capacity_lbs of 12.5 if not provided', async () => {
      const req = makeRequest('createBin', {
        method: 'POST',
        body: {
          bin_number: 'B003',
          cultivar: 'OG Kush',
          type: 'tops',
          source: 'in-house'
          // capacity_lbs not specified
        }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const binInsert = queries.find(q => q.sql.includes('INSERT INTO bins'));
      assert.equal(binInsert.params[4], 12.5, 'Should default capacity to 12.5 lbs');
    });
  });

  // ==========================================
  // 2. BIN UPDATE VALIDATION (4 tests)
  // ==========================================

  describe('updateBin - validation', () => {
    it('should require binId', async () => {
      const req = makeRequest('updateBin', {
        method: 'POST',
        body: { cultivar: 'Updated Strain' } // missing binId
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Missing binId/ }
      );
    });

    it('should reject empty update (no fields to update)', async () => {
      const req = makeRequest('updateBin', {
        method: 'POST',
        body: { binId: 5 } // no update fields
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /No fields to update/ }
      );
    });

    it('should reject invalid type in update', async () => {
      const req = makeRequest('updateBin', {
        method: 'POST',
        body: { binId: 5, type: 'invalid-type' }
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Invalid type. Must be: tops, smalls/ }
      );
    });

    it('should allow partial update (only cultivar)', async () => {
      const req = makeRequest('updateBin', {
        method: 'POST',
        body: { binId: 5, cultivar: 'New Strain Name' }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.equal(data.success, true);
      assert.equal(data.message, 'Bin updated successfully');

      const queries = db.getQueries();
      const updateQuery = queries.find(q => q.sql.includes('UPDATE bins'));
      assert.ok(updateQuery, 'Should execute UPDATE query');
      assert.ok(updateQuery.sql.includes('cultivar = ?'), 'Should set cultivar');
      assert.ok(updateQuery.sql.includes("updated_at = datetime('now')"), 'Should set updated_at');
      assert.deepEqual(updateQuery.params, ['New Strain Name', 5]);
    });

    it('should allow partial update (only active flag)', async () => {
      const req = makeRequest('updateBin', {
        method: 'POST',
        body: { binId: 7, active: false }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.equal(data.success, true);

      const queries = db.getQueries();
      const updateQuery = queries.find(q => q.sql.includes('UPDATE bins'));
      assert.ok(updateQuery.sql.includes('active = ?'), 'Should set active flag');
      assert.deepEqual(updateQuery.params, [0, 7]);
    });
  });

  // ==========================================
  // 3. TRANSACTION RECORDING (7 tests)
  // ==========================================

  describe('recordTransaction - validation & balance updates', () => {
    it('should require binId, type, and weight_lbs', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: { type: 'intake' } // missing binId and weight_lbs
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Missing required fields: binId, type, weight_lbs/ }
      );
    });

    it('should reject invalid transaction type', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: { binId: 1, type: 'invalid-type', weight_lbs: 5 }
      });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Invalid type. Must be: intake, dispense, adjustment, waste/ }
      );
    });

    it('should record intake and add to balance (positive delta)', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: {
          binId: 1,
          type: 'intake',
          weight_lbs: 10.5,
          source_ref: 'Batch-001',
          notes: 'Initial intake'
        }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.equal(data.success, true);
      assert.equal(data.message, 'Transaction recorded successfully');

      const queries = db.getQueries();

      // Verify transaction insert
      const txInsert = queries.find(q => q.sql.includes('INSERT INTO pool_transactions'));
      assert.ok(txInsert, 'Should insert transaction');
      assert.deepEqual(txInsert.params, [1, 'intake', 10.5, 'Batch-001', null, null, 'Initial intake']);

      // Verify balance update with positive delta
      const balanceUpdate = queries.find(q => q.sql.includes('UPDATE bin_balances'));
      assert.ok(balanceUpdate, 'Should update balance');
      // Delta should be +10.5 for intake
      assert.equal(balanceUpdate.params[0], 10.5, 'Delta should be positive for intake');
    });

    it('should record dispense and subtract from balance (negative delta)', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: {
          binId: 2,
          type: 'dispense',
          weight_lbs: 3.5,
          package_size: '1lb',
          package_count: 3
        }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balanceUpdate = queries.find(q => q.sql.includes('UPDATE bin_balances'));
      assert.ok(balanceUpdate, 'Should update balance');
      // Delta should be -3.5 for dispense
      assert.equal(balanceUpdate.params[0], -3.5, 'Delta should be negative for dispense');
    });

    it('should record adjustment and add to balance (positive delta)', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: {
          binId: 3,
          type: 'adjustment',
          weight_lbs: 2.0,
          notes: 'Recount correction'
        }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balanceUpdate = queries.find(q => q.sql.includes('UPDATE bin_balances'));
      // Delta should be +2.0 for adjustment
      assert.equal(balanceUpdate.params[0], 2.0, 'Delta should be positive for adjustment');
    });

    it('should record waste and subtract from balance (negative delta)', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: {
          binId: 4,
          type: 'waste',
          weight_lbs: 0.8,
          notes: 'Damaged product'
        }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balanceUpdate = queries.find(q => q.sql.includes('UPDATE bin_balances'));
      // Delta should be -0.8 for waste
      assert.equal(balanceUpdate.params[0], -0.8, 'Delta should be negative for waste');
    });

    it('should verify balance update query uses correct delta sign', async () => {
      const req = makeRequest('recordTransaction', {
        method: 'POST',
        body: { binId: 5, type: 'intake', weight_lbs: 15.0 }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balanceUpdate = queries.find(q => q.sql.includes('UPDATE bin_balances'));

      // Verify the update query structure
      assert.ok(balanceUpdate.sql.includes('current_lbs = current_lbs + ?'), 'Should use parameterized delta');
      assert.ok(balanceUpdate.sql.includes('total_intakes_lbs = total_intakes_lbs + CASE'), 'Should conditionally update intakes');
      assert.ok(balanceUpdate.sql.includes('total_dispenses_lbs = total_dispenses_lbs + CASE'), 'Should conditionally update dispenses');

      // First param is delta (+15.0), followed by type checks
      assert.equal(balanceUpdate.params[0], 15.0);
      assert.equal(balanceUpdate.params[1], 'intake'); // type for intake check
      assert.equal(balanceUpdate.params[2], 15.0); // weight for intake accumulation
    });
  });

  // ==========================================
  // 4. QUERY OPERATIONS (7 tests)
  // ==========================================

  describe('Query operations', () => {
    it('getBin - should require binId parameter', async () => {
      const req = makeRequest('getBin', { params: {} }); // no binId

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Missing binId parameter/ }
      );
    });

    it('getBin - should return 404 when bin not found', async () => {
      db.addRows('SELECT b.*, bb.current_lbs', []); // empty results

      const req = makeRequest('getBin', { params: { binId: '999' } });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Bin not found/ }
      );
    });

    it('getBin - should return bin with balance data', async () => {
      db.addRows('SELECT b.*, bb.current_lbs', [{
        id: 1,
        bin_number: 'B001',
        cultivar: 'Cherry Gelato',
        type: 'tops',
        source: 'in-house',
        current_lbs: 8.5,
        total_intakes_lbs: 20.0,
        total_dispenses_lbs: 11.5
      }]);

      const req = makeRequest('getBin', { params: { binId: '1' } });
      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.ok(data.bin, 'Should return bin object');
      assert.equal(data.bin.bin_number, 'B001');
      assert.equal(data.bin.current_lbs, 8.5);
    });

    it('listBins - should filter active=1 by default', async () => {
      db.addRows('SELECT * FROM bins WHERE active = ?', [
        { id: 1, bin_number: 'B001', active: 1 },
        { id: 2, bin_number: 'B002', active: 1 }
      ]);

      const req = makeRequest('listBins');
      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.ok(Array.isArray(data.bins), 'Should return bins array');
      assert.equal(data.bins.length, 2);

      const queries = db.getQueries();
      const listQuery = queries.find(q => q.sql.includes('SELECT * FROM bins'));
      assert.equal(listQuery.params[0], 1, 'Should filter by active=1 by default');
    });

    it('listBins - should apply source/type/cultivar filters', async () => {
      db.addRows('SELECT * FROM bins', [
        { id: 3, bin_number: 'B003', source: 'consignment', type: 'smalls', cultivar: 'Lemon' }
      ]);

      const req = makeRequest('listBins', {
        params: { source: 'consignment', type: 'smalls', cultivar: 'Lemon' }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const listQuery = queries.find(q => q.sql.includes('SELECT * FROM bins'));

      assert.ok(listQuery.sql.includes('AND source = ?'), 'Should filter by source');
      assert.ok(listQuery.sql.includes('AND type = ?'), 'Should filter by type');
      assert.ok(listQuery.sql.includes('AND cultivar LIKE ?'), 'Should filter by cultivar with LIKE');

      assert.deepEqual(listQuery.params, [1, 'consignment', 'smalls', '%Lemon%']);
    });

    it('getTransactions - should support pagination (limit/offset)', async () => {
      db.addRows('SELECT * FROM pool_transactions', [
        { id: 1, type: 'intake', weight_lbs: 10 },
        { id: 2, type: 'dispense', weight_lbs: 5 }
      ]);

      const req = makeRequest('getTransactions', {
        params: { limit: '10', offset: '20' }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.ok(Array.isArray(data.transactions), 'Should return transactions array');

      const queries = db.getQueries();
      const txQuery = queries.find(q => q.sql.includes('SELECT * FROM pool_transactions'));

      assert.ok(txQuery.sql.includes('LIMIT ? OFFSET ?'), 'Should apply pagination');
      // Params: [limit, offset]
      assert.equal(txQuery.params[0], 10);
      assert.equal(txQuery.params[1], 20);
    });

    it('getBinBalance - should return 404 when not found', async () => {
      db.addRows('SELECT bb.*, b.bin_number', []); // no results

      const req = makeRequest('getBinBalance', { params: { binId: '999' } });

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Bin not found/ }
      );
    });
  });

  // ==========================================
  // 5. DASHBOARD (3 tests)
  // ==========================================

  describe('Dashboard', () => {
    it('should return summary, lowStock, and recentTransactions', async () => {
      // Mock stats query
      db.addRows('SELECT COUNT(DISTINCT b.id) as total_bins', [{
        total_bins: 15,
        total_weight_lbs: 150.5,
        total_intakes_lbs: 300.0,
        total_dispenses_lbs: 149.5,
        low_stock_count: 2
      }]);

      // Mock low stock query
      db.addRows('SELECT b.bin_number, b.cultivar, b.type, b.source, bb.current_lbs', [
        { bin_number: 'B005', cultivar: 'Low Stock A', current_lbs: 1.2 },
        { bin_number: 'B008', cultivar: 'Low Stock B', current_lbs: 2.8 }
      ]);

      // Mock recent transactions query
      db.addRows('SELECT pt.*, b.bin_number, b.cultivar, b.type', [
        { id: 100, bin_number: 'B001', type: 'intake', weight_lbs: 10 },
        { id: 99, bin_number: 'B002', type: 'dispense', weight_lbs: 5 }
      ]);

      const req = makeRequest('getDashboard');
      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.ok(data.summary, 'Should return summary');
      assert.ok(Array.isArray(data.lowStock), 'Should return lowStock array');
      assert.ok(Array.isArray(data.recentTransactions), 'Should return recentTransactions array');

      assert.equal(data.summary.total_bins, 15);
      assert.equal(data.lowStock.length, 2);
      assert.equal(data.recentTransactions.length, 2);
    });

    it('should identify low stock as < 3 lbs', async () => {
      db.addRows('SELECT COUNT(DISTINCT b.id)', [{ total_bins: 5, low_stock_count: 1 }]);
      db.addRows('SELECT b.bin_number, b.cultivar, b.type, b.source, bb.current_lbs', [
        { bin_number: 'B010', current_lbs: 2.9 }
      ]);
      db.addRows('SELECT pt.*, b.bin_number', []);

      const req = makeRequest('getDashboard');
      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const lowStockQuery = queries.find(q => q.sql.includes('bb.current_lbs < 3'));
      assert.ok(lowStockQuery, 'Low stock query should check for < 3 lbs');
    });

    it('should limit recent transactions to 20', async () => {
      db.addRows('SELECT COUNT(DISTINCT b.id)', [{ total_bins: 5 }]);
      db.addRows('SELECT b.bin_number, b.cultivar', []);
      db.addRows('SELECT pt.*, b.bin_number', []);

      const req = makeRequest('getDashboard');
      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const recentQuery = queries.find(q => q.sql.includes('LIMIT 20'));
      assert.ok(recentQuery, 'Recent transactions should be limited to 20');
    });
  });

  // ==========================================
  // 6. EDGE CASES (4 tests)
  // ==========================================

  describe('Edge cases', () => {
    it('should throw error for unknown action', async () => {
      const req = makeRequest('unknownAction');

      await assert.rejects(
        async () => handlePoolD1(req, env),
        { message: /Unknown action: unknownAction/ }
      );
    });

    it('deleteBin - should soft delete (set active=0)', async () => {
      const req = makeRequest('deleteBin', {
        method: 'POST',
        body: { binId: 7 }
      });

      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.equal(data.success, true);
      assert.equal(data.message, 'Bin archived successfully');

      const queries = db.getQueries();
      const deleteQuery = queries.find(q => q.sql.includes('UPDATE bins SET active = 0'));
      assert.ok(deleteQuery, 'Should use UPDATE not DELETE (soft delete)');
      assert.deepEqual(deleteQuery.params, [7]);
    });

    it('getAllBalances - should filter by active bins only', async () => {
      db.addRows('SELECT bb.*, b.bin_number', [
        { bin_id: 1, bin_number: 'B001', active: 1, current_lbs: 10 },
        { bin_id: 2, bin_number: 'B002', active: 1, current_lbs: 5 }
      ]);

      const req = makeRequest('getAllBalances');
      const response = await handlePoolD1(req, env);
      const data = await parseResponse(response);

      assert.ok(Array.isArray(data.balances), 'Should return balances array');

      const queries = db.getQueries();
      const balancesQuery = queries.find(q => q.sql.includes('WHERE b.active = 1'));
      assert.ok(balancesQuery, 'Should filter by active=1 only');
    });

    it('getAllBalances - should apply source and type filters', async () => {
      db.addRows('SELECT bb.*, b.bin_number', [
        { bin_id: 5, source: 'in-house', type: 'tops', current_lbs: 12 }
      ]);

      const req = makeRequest('getAllBalances', {
        params: { source: 'in-house', type: 'tops' }
      });

      await handlePoolD1(req, env);

      const queries = db.getQueries();
      const balancesQuery = queries.find(q => q.sql.includes('SELECT bb.*, b.bin_number'));

      assert.ok(balancesQuery.sql.includes('AND b.source = ?'), 'Should filter by source');
      assert.ok(balancesQuery.sql.includes('AND b.type = ?'), 'Should filter by type');
      assert.deepEqual(balancesQuery.params, ['in-house', 'tops']);
    });
  });
});
