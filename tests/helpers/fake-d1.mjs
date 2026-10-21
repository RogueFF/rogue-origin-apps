/**
 * In-memory SQLite wrapped to look like D1, for driving the kanban router in
 * tests (migration 0046 + 0013 + the columns of kanban_cards /
 * inventory_adjustments the Grove lane reads touch).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleKanbanD1 } from '../../workers/src/handlers/kanban-d1.js';

const mig = (f) => readFileSync(new URL(`../../workers/migrations/${f}`, import.meta.url), 'utf8');

export function fakeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE kanban_cards (id INTEGER PRIMARY KEY, item TEXT, crumbtrail TEXT, supplier TEXT, order_qty TEXT);
    CREATE TABLE inventory_adjustments (id INTEGER PRIMARY KEY, timestamp TEXT, size TEXT, sku TEXT, adjustment_source TEXT, product_name TEXT, variant_title TEXT, new_total_available INTEGER);
    INSERT INTO kanban_cards (id, item, supplier) VALUES (21,'1 oz','Grove'),(54,'1 lb','Grove'),(56,'1/4','Grove'),(69,'blank','Grove'),(99,'10 lb','Grove'),(7,'tape','Uline');`);
  db.exec(mig('0005-kanban-cart-orders.sql'));
  db.exec(mig('0013-kanban-reorder-requests.sql'));
  db.exec(mig('0046-kanban-bins.sql'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
  });
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } } };
}

/** Call the kanban router: POST with a JSON body when `body` is given, else GET. */
export async function call(env, action, body) {
  const url = `https://x.test/api/kanban?action=${action}`;
  const req = body ? new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : new Request(url);
  return (await handleKanbanD1(req, env)).json();
}
