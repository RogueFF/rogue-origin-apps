/**
 * D1 Database utilities
 * Replaces sheets.js for database operations
 */

// Whitelist of valid table names to prevent SQL injection via dynamic table references
const VALID_TABLES = new Set([
  'customers', 'orders', 'shipments', 'payments', 'price_history',
  'coa_index', 'products', 'monthly_production', 'production_tracking',
  'inventory_adjustments', 'pause_log', 'shift_adjustments', 'data_version',
  'scale_readings', 'payment_shipment_links', 'system_config',
  'kanban_cards', 'kanban_columns', 'sop_documents', 'sop_sections',
]);

/**
 * Validate identifier (table name or column name) is safe for SQL interpolation
 * @param {string} name - Identifier to validate
 * @param {string} type - Type label for error messages
 * @returns {string} The validated name
 */
function validateIdentifier(name, type = 'identifier') {
  if (!name || typeof name !== 'string') {
    throw new Error(`Invalid ${type}: must be a non-empty string`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${type} "${name}": contains disallowed characters`);
  }
  return name;
}

/**
 * Validate table name against whitelist
 * @param {string} table - Table name to validate
 * @returns {string} The validated table name
 */
function validateTable(table) {
  validateIdentifier(table, 'table name');
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Unknown table "${table}". Add it to VALID_TABLES in db.js if this is a new table.`);
  }
  return table;
}

/**
 * Execute a SELECT query
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<any[]>}
 */
export async function query(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results || [];
}

/**
 * Execute a SELECT query returning first row only
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<any|null>}
 */
export async function queryOne(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).first();
  return result || null;
}

/**
 * Execute INSERT/UPDATE/DELETE
 * @param {D1Database} db
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<{changes: number, lastRowId: number}>}
 */
export async function execute(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).run();
  return {
    changes: result.meta?.changes || 0,
    lastRowId: result.meta?.last_row_id || 0,
  };
}

/**
 * Execute multiple statements in a transaction
 * @param {D1Database} db
 * @param {Array<{sql: string, params: any[]}>} statements
 * @returns {Promise<any[]>}
 */
export async function transaction(db, statements) {
  const prepared = statements.map(s => db.prepare(s.sql).bind(...(s.params || [])));
  return db.batch(prepared);
}

/**
 * Insert a row and return the ID
 * @param {D1Database} db
 * @param {string} table
 * @param {object} data
 * @returns {Promise<number|string>}
 */
export async function insert(db, table, data) {
  validateTable(table);
  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const result = await execute(db, sql, Object.values(data));
  return result.lastRowId;
}

/**
 * Update rows
 * @param {D1Database} db
 * @param {string} table
 * @param {object} data
 * @param {string} whereClause
 * @param {any[]} whereParams
 * @returns {Promise<number>} rows affected
 */
export async function update(db, table, data, whereClause, whereParams = []) {
  validateTable(table);
  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${sets} WHERE ${whereClause}`;
  const result = await execute(db, sql, [...Object.values(data), ...whereParams]);
  return result.changes;
}

/**
 * Delete rows
 * @param {D1Database} db
 * @param {string} table
 * @param {string} whereClause
 * @param {any[]} whereParams
 * @returns {Promise<number>} rows affected
 */
export async function deleteRows(db, table, whereClause, whereParams = []) {
  validateTable(table);
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  const result = await execute(db, sql, whereParams);
  return result.changes;
}
