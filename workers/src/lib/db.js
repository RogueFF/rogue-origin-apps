/**
 * D1 Database utilities
 * Replaces sheets.js for database operations
 */

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
  const keys = Object.keys(data);
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
  const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
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
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  const result = await execute(db, sql, whereParams);
  return result.changes;
}
