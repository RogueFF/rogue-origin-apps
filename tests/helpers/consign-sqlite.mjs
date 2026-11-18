import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* skip in tests */ }
export const sqliteOk = !!DatabaseSync;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = ['workers/migrations/0066-consign-lots.sql', 'workers/migrations/0067-consign-farm-access.sql',
  'workers/migrations/0068-consign-farm-access-lockouts.sql', 'workers/migrations/0072-consign-absorb-loss.sql'];

export function freshConsignDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(REPO, file), 'utf8')
      .split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
    for (const st of sql.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
  }

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

// New dropoff lots absorb the screening loss by default (paid on the dropoff weight). A test
// file about the other rule, lots paid on their after-loss numbers, calls payOnFinalWeight()
// once: its saveDropoff lines then say absorb_loss: false unless a line sets it itself.
let lineDefaults = null;
export function payOnFinalWeight() { lineDefaults = { absorb_loss: false }; }

export function post(action, body = {}, { auth = true } = {}) {
  if (lineDefaults && action === 'saveDropoff' && Array.isArray(body.lines)) {
    body = { ...body, lines: body.lines.map((ln) => (ln && typeof ln === 'object' ? { ...lineDefaults, ...ln } : ln)) };
  }
  return new Request(`https://x/api/consign?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(auth ? { password: 'pw', ...body } : body),
  });
}
