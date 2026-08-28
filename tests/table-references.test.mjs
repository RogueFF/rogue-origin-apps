/**
 * Drift guard: the worker must not query a table the migrations have removed.
 *
 * Written after a live failure. Migration 0019 dropped `production_runs`, but
 * `deleteOrder` went on issuing `DELETE FROM production_runs`. Its statements
 * run as one batch, so "no such table" aborted all of them and deleting ANY
 * order failed outright — the operator seeing only
 * "wholesale/deleteOrder: An unexpected error occurred".
 *
 * Nothing caught it. The unit tests cover the pure libs, which hold no SQL, and
 * the handlers are never exercised against a database. This closes that gap
 * cheaply: replay the schema and every migration in order to work out which
 * tables exist at the end, then read the SQL in the worker source and assert
 * every table it names is one of them.
 *
 * Deliberately about DROPPED TABLES rather than schema correctness. A column
 * that no longer exists still slips through; catching that needs a real
 * database and is worth doing separately.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Remove SQL and JS comments so their prose is never read as code. */
function decomment(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // /* … */ and /** … */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // // … , but not the // in a URL
    .replace(/--[^\n]*/g, ' ');             // SQL line comments
}

/**
 * Replay schema.sql then every migration in filename order to get the tables
 * that exist once everything is applied.
 *
 * Statements are applied IN ORDER. A first version collected every CREATE and
 * then every DROP, which meant 0019's `DROP TABLE orders` undid the
 * `CREATE TABLE orders` sitting eight lines below it in the same file — and the
 * guard then reported the orders table itself as missing.
 */
function liveTables() {
  const files = [
    'schema.sql',
    ...readdirSync(join(ROOT, 'workers/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(f => `migrations/${f}`),
  ];

  const CREATE = /CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?(\w+)/i;
  const DROP = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`[]?(\w+)/i;
  const RENAME = /ALTER\s+TABLE\s+["'`[]?(\w+)["'`\]]?\s+RENAME\s+TO\s+["'`[]?(\w+)/i;
  const ANY = new RegExp(`(?:${CREATE.source})|(?:${DROP.source})|(?:${RENAME.source})`, 'gi');

  const tables = new Set();
  for (const f of files) {
    const sql = decomment(read(`workers/${f}`));
    for (const m of sql.matchAll(ANY)) {
      const [, created, dropped, renamedFrom, renamedTo] = m;
      if (created) tables.add(created);
      else if (dropped) tables.delete(dropped);
      else if (renamedFrom) { tables.delete(renamedFrom); tables.add(renamedTo); }
    }
  }
  return tables;
}

/**
 * Table-valued functions and internal tables SQLite provides itself. They are
 * legitimately queryable and will never appear in a migration.
 */
const BUILT_IN = /^(?:json_each|json_tree|pragma_\w+|sqlite_master|sqlite_sequence|sqlite_temp_master)$/i;

/** Words that can follow FROM in valid SQL without naming a table. */
const NOT_A_TABLE = new Set(['select', 'values', 'set', 'where', 'as', 'dual']);

/**
 * Every table the worker's SQL reads from or writes to.
 *
 * Two rounds of false positives shaped this. Scanning whole files reported
 * forty missing tables, every one of them English — a comment reading "pour
 * each pound into the highest-ranked order" matches `INTO the` perfectly well.
 * Scanning any literal CONTAINING a SQL verb still let through
 * 'Failed to update bag mode', duly reported as a missing table called `bag`.
 * So: string literals only, and only ones that READ AS A STATEMENT.
 */
function referencedTables() {
  const refs = new Map();   // table -> Set(file)

  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!entry.name.endsWith('.js')) continue;

      const src = decomment(read(rel));
      const literals = [
        ...src.matchAll(/`([^`]*)`/g),
        ...src.matchAll(/'([^'\n]*)'/g),
        ...src.matchAll(/"([^"\n]*)"/g),
      ].map(m => m[1]);

      for (const lit of literals) {
        if (!/^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(lit)) continue;

        // A LEADING VERB IS NOT ENOUGH. The label "Update when it changes — not
        // on a schedule" in lib/i18n.js begins with UPDATE, and the extractor
        // below then read "when" as a table name and reported the worker
        // querying something the migrations never created — a false alarm on
        // the one test whose whole job is to be believed.
        //
        // Every statement that can name a table carries a second keyword:
        // UPDATE...SET, DELETE...FROM, INSERT...INTO, SELECT...FROM,
        // REPLACE...INTO. A SELECT with no FROM ("SELECT 1") names no table
        // either way, so requiring one loses nothing real.
        if (!/^\s*WITH\b/i.test(lit) && !/\b(?:FROM|INTO|SET|VALUES)\b/i.test(lit)) continue;

        // Common table expressions are named like tables and are not tables.
        const cte = new Set(
          [...lit.matchAll(/(?:WITH(?:\s+RECURSIVE)?|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)]
            .map(x => x[1].toLowerCase()));

        for (const m of lit.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/gi)) {
          const name = m[1];
          if (NOT_A_TABLE.has(name.toLowerCase())) continue;
          if (BUILT_IN.test(name)) continue;
          if (cte.has(name.toLowerCase())) continue;
          if (!refs.has(name)) refs.set(name, new Set());
          refs.get(name).add(rel);
        }
      }
    }
  };

  walk('workers/src');
  return refs;
}

test('the schema replay resolves a plausible set of tables', () => {
  const live = liveTables();
  // If the replay is broken, every assertion below passes vacuously.
  assert.ok(live.size > 25, `only ${live.size} tables resolved — the replay is wrong`);
  for (const t of ['orders', 'order_items', 'cultivars', 'cultivar_aliases', 'monthly_production']) {
    assert.ok(live.has(t), `${t} should exist after all migrations`);
  }
});

test('a table dropped by a migration is really gone from the replay', () => {
  const live = liveTables();
  assert.ok(!live.has('production_runs'), 'production_runs was dropped by 0019');
  // 0019's park tables are created and dropped inside the same file.
  assert.ok(!live.has('_park_orders'), 'temp park tables must not survive');
  assert.ok(!live.has('_park_order_items'), 'temp park tables must not survive');
});

test('the scanner finds the SQL that is actually there', () => {
  const refs = referencedTables();
  // Guards the opposite failure: a scanner matching nothing would make the real
  // assertion below pass no matter what the handlers do.
  assert.ok(refs.size > 10, `only ${refs.size} tables referenced — the scanner is broken`);
  assert.ok(refs.has('orders'), 'the wholesale handler queries orders');
  assert.ok(refs.has('monthly_production'), 'the rate table queries monthly_production');
});

test('THE GUARD: the worker never queries a table the migrations removed', () => {
  const live = liveTables();
  const missing = [...referencedTables().entries()]
    .filter(([name]) => !live.has(name))
    .map(([name, files]) => `${name} (in ${[...files].join(', ')})`)
    .sort();

  assert.deepEqual(missing, []);
});

test('production_runs specifically is gone from the worker', () => {
  // The regression that prompted this file, pinned by name so a revert is loud.
  assert.ok(!referencedTables().has('production_runs'),
    'deleteOrder used to DELETE FROM production_runs after 0019 dropped it, '
    + 'which made deleting any order fail');
});
