import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* skip in tests */ }
export const sqliteOk = !!DatabaseSync;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = 'workers/migrations/0066-consign-lots.sql';

export function freshConsignDb() {
  const sqlite = new DatabaseSync(':memory:');
  const sql = readFileSync(join(REPO, MIGRATION), 'utf8')
    .split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
  for (const st of sql.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }

  const runSync = (q, args) => {
    const r = sqlite.prepare(q).run(...args);
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    all: async () => ({ results: sqlite.prepare(q).all(...args) }),
    first: async () => sqlite.prepare(q).get(...args) ?? null,
    run: async () => runSync(q, args),
    _sync: () => runSync(q, args),
  });
  const DB = {
    prepare: (q) => stmt(q),
    // D1 batches are transactions. Mirror that so rollback tests mean something.
    // Synchronous inside, like D1 running the whole batch on the server: two
    // concurrent batches can never interleave.
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(s._sync());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { DB, sqlite, env: { DB, ORDERS_PASSWORD: 'pw', CONSIGN_OWNER_PASSWORD: 'owner-pw' } };
}

export function post(action, body = {}, { auth = true } = {}) {
  return new Request(`https://x/api/consign?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(auth ? { password: 'pw', ...body } : body),
  });
}
