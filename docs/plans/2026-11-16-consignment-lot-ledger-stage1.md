# Consignment Lot Ledger, Stage 1 (Staff App) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A gated tablet page where barn staff record consignment dropoffs (cultivar rows, tops + smalls), weigh later, enter screening before/after numbers and payments, with every balance computed from a new lot ledger.

**Architecture:** New D1 tables prefixed `cl_` beside the untouched `consignment_*` tables. One new worker handler at `/api/consign` holds thin SQL; all money maths lives in a pure module (`lib/consign-ledger.js`) tested on its own. One new no-build page (`src/pages/consign.html`) with ES modules, EN/ES through the shared `i18n.js`, password through the shared page gate.

**Tech Stack:** Cloudflare Workers + D1 (SQLite), plain ES modules, `node:test` with `node:sqlite` for handler tests, Playwright for one browser spec, `tools/stamp-modules.mjs` for asset hashes.

**Design:** `docs/plans/2026-11-16-consignment-lot-ledger-design.md`. Read it first. Stage 1 covers sections 2 to 9. Sections 10 to 12 (printout, photo, Telegram, vendor page) are later stages and are out of scope here.

**Worktree:** `C:\Users\Koasm\Desktop\Dev\roa-consignment`, branch `docs/consignment-lot-ledger`. Rename the branch before the first code commit: `git branch -m feat/consign-lot-ledger`.

---

## Rules that apply to every task

- **No farm names, buyer names or real prices** anywhere in this repo: not in code, tests, fixtures, seeds or commit messages. The repo is client-facing. Tests use `Farm A`, `Farm B`, cultivar `Alpha`, `Beta`, and round made-up prices (10, 4).
- **Do not push, deploy or apply the migration.** Stop at ready-to-ship (Task 17). Koa approves shipping in the hub session; Task 18 is run only on that yes.
- Commit format: `feat(consign): ...` / `test(consign): ...`, ending with the `Co-Authored-By` trailer. The pre-commit hook stamps asset hashes; if it is not installed in this worktree, run `npm run stamp` before committing page files. After stamping on Windows, `git status` shows many pages as modified from CRLF noise; trust `git diff --stat`.
- Run commands from the worktree root unless a step says `cd workers`.
- Route trap: `'/api/consignment'.startsWith('/api/consign')` is true. The new route must match exactly (Task 3).
- The old app (`consignment.html`, `consignment-d1.js`, `consignment_*` tables, `tests/consignment.test.mjs`) is not touched by any task.
- Dates: use `pacificDay()` from `workers/src/lib/pacific.js` for "today". Timestamps are stored as SQLite UTC (`datetime('now')`).

### API contract (reference for all tasks)

All calls go to `/api/consign?action=<name>`, POST, body JSON sent as `text/plain`. Every action needs the shared password (`requireAuth`). Owner actions also need `owner_password` in the body.

| Action | Body | Returns `data` |
|---|---|---|
| `farms` | none | `[{id, name, default_term, lang, active, balance, credit, owed, paid, estimate, needs_price}]` |
| `farm` | `{farm_id}` | `{farm, price_points, dropoffs:[{..., lots:[{..., runs, sold, money}]}], payments, totals}` |
| `open` | none | `{to_weigh:[lot], to_screen:[lot], needs_price:[lot]}` (each lot carries `farm_name`, `dropped_at`) |
| `dropoff` | `{dropoff_id}` | `{dropoff, lots:[...]}` |
| `saveDropoff` | `{farm_id, dropped_by, note, client_key, lines:[{cultivar, type, term?, intake_lbs?, note?}]}` | same as `dropoff`, plus `duplicate: true` on a resend |
| `setWeight` | `{lot_id, intake_lbs, actor}` | `{lot}` |
| `saveScreenRun` | `{lot_id, pulled_lbs, final_lbs, to_smalls_lbs, biomass_lbs, mold_lbs, finishes_lot, note, client_key, actor}` | `{lot}` |
| `saveSold` | `{lot_id, lbs, kind, sold_on?, note, client_key}` | `{lot}` |
| `savePayment` | `{farm_id, amount, paid_on?, method, reference, note, client_key}` | `{payment, totals}` |
| `voidRow` | `{table, id, reason, actor}` where table is `dropoff`, `lot`, `run`, `sold` or `payment` | `{ok: true}` |
| `saveFarm` (owner) | `{id?, name, contact, default_term, lang, active}` | `{farm}` |
| `savePricePoint` (owner) | `{farm_id, cultivar, type, price_per_lb, effective_from?, apply_to_unpriced?}` | `{price_point, lots_priced}` |
| `setLotTerms` (owner) | `{lot_id, term?, price_per_lb?, smalls_price_per_lb?, actor}` | `{lot}` |

`money` on a lot is the output of `lotMoney()` (Task 2).

---

### Task 0: Baseline

**Step 1:** `cd C:\Users\Koasm\Desktop\Dev\roa-consignment && git branch -m feat/consign-lot-ledger && npm ci`

**Step 2:** Run `npm test` and `npm run lint`.
Expected: both pass. If anything fails before you have changed a file, stop and report it; do not fix unrelated failures.

**Step 3:** Run `node -e "import('node:sqlite').then(()=>console.log('ok'))"`.
Expected: `ok` (Node 22+). The handler tests need it.

---

### Task 1: Migration and test database helper

**Files:**
- Create: `workers/migrations/0066-consign-lots.sql`
- Create: `tests/helpers/consign-sqlite.mjs`
- Create: `tests/consign-schema.test.mjs`

Before creating the migration, list `workers/migrations/` and confirm `0066` is still free. If not, take the next free number and use it everywhere below.

**Step 1: Write the failing test** (`tests/consign-schema.test.mjs`)

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, sqliteOk } from './helpers/consign-sqlite.mjs';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

test('migration creates the eight cl_ tables', () => {
  const { sqlite } = freshConsignDb();
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cl_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, ['cl_dropoffs', 'cl_farms', 'cl_history', 'cl_lots', 'cl_payments', 'cl_price_points', 'cl_screen_runs', 'cl_sold']);
});

test('batch is all-or-nothing', async () => {
  const { DB, sqlite } = freshConsignDb();
  await assert.rejects(DB.batch([
    DB.prepare("INSERT INTO cl_farms (name) VALUES (?)").bind('Farm A'),
    DB.prepare("INSERT INTO cl_farms (name, default_term) VALUES (?, ?)").bind('Farm B', 'bogus'),
  ]));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_farms').get().n, 0);
});
```

**Step 2:** Run `node --test tests/consign-schema.test.mjs`. Expected: FAIL, cannot find `consign-sqlite.mjs`.

**Step 3: Write the helper** (`tests/helpers/consign-sqlite.mjs`)

First read `tests/helpers/harvest-sqlite.mjs` and `tests/crew-numbers.test.mjs`. If `freshDb` there already takes a migration path and gives an atomic `batch`, re-export from it. Otherwise:

```js
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

  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    all: async () => ({ results: sqlite.prepare(q).all(...args) }),
    first: async () => sqlite.prepare(q).get(...args) ?? null,
    run: async () => {
      const r = sqlite.prepare(q).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  const DB = {
    prepare: (q) => stmt(q),
    // D1 batches are transactions. Mirror that so rollback tests mean something.
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
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
```

**Step 4: Write the migration** (`workers/migrations/0066-consign-lots.sql`)

The test loader strips `--` comments and splits on `;`, so never put a semicolon inside a comment or a string in this file.

```sql
-- Consignment lot ledger (stage 1). Sits beside the old consignment_* tables.

CREATE TABLE IF NOT EXISTS cl_farms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT,
  default_term TEXT NOT NULL DEFAULT 'dropoff' CHECK (default_term IN ('dropoff', 'sold')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cl_price_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tops', 'smalls')),
  price_per_lb REAL NOT NULL CHECK (price_per_lb > 0),
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_price_lookup ON cl_price_points (farm_id, cultivar, type, effective_from);

CREATE TABLE IF NOT EXISTS cl_dropoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  dropped_at TEXT NOT NULL DEFAULT (datetime('now')),
  dropped_by TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'paper', 'telegram')),
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_dropoffs_farm ON cl_dropoffs (farm_id, dropped_at);

CREATE TABLE IF NOT EXISTS cl_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dropoff_id INTEGER NOT NULL REFERENCES cl_dropoffs(id),
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  cultivar TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tops', 'smalls')),
  term TEXT NOT NULL CHECK (term IN ('dropoff', 'sold')),
  intake_lbs REAL CHECK (intake_lbs IS NULL OR intake_lbs > 0),
  weighed_at TEXT,
  price_per_lb REAL,
  smalls_price_per_lb REAL,
  closed_at TEXT,
  note TEXT,
  note_visible INTEGER NOT NULL DEFAULT 0,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_lots_farm ON cl_lots (farm_id);
CREATE INDEX IF NOT EXISTS idx_cl_lots_dropoff ON cl_lots (dropoff_id);

CREATE TABLE IF NOT EXISTS cl_screen_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES cl_lots(id),
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  pulled_lbs REAL NOT NULL CHECK (pulled_lbs > 0),
  final_lbs REAL NOT NULL DEFAULT 0 CHECK (final_lbs >= 0),
  to_smalls_lbs REAL NOT NULL DEFAULT 0 CHECK (to_smalls_lbs >= 0),
  biomass_lbs REAL NOT NULL DEFAULT 0 CHECK (biomass_lbs >= 0),
  mold_lbs REAL NOT NULL DEFAULT 0 CHECK (mold_lbs >= 0),
  diff_lbs REAL NOT NULL DEFAULT 0,
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_runs_lot ON cl_screen_runs (lot_id);

CREATE TABLE IF NOT EXISTS cl_sold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES cl_lots(id),
  sold_on TEXT NOT NULL,
  lbs REAL NOT NULL CHECK (lbs > 0),
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'smalls')),
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_sold_lot ON cl_sold (lot_id);

CREATE TABLE IF NOT EXISTS cl_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  paid_on TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT,
  reference TEXT,
  note TEXT,
  client_key TEXT UNIQUE,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_payments_farm ON cl_payments (farm_id);

CREATE TABLE IF NOT EXISTS cl_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cl_history_row ON cl_history (tbl, row_id);
```

`cl_farm_access` from the design is stage 4; do not create it now.

**Step 5:** Run `node --test tests/consign-schema.test.mjs`. Expected: 2 pass.

**Step 6: Commit**

```bash
git add workers/migrations/0066-consign-lots.sql tests/helpers/consign-sqlite.mjs tests/consign-schema.test.mjs
git commit -m "feat(consign): lot ledger tables and sqlite test helper"
```

---

### Task 2: Ledger maths (pure module)

**Files:**
- Create: `workers/src/lib/consign-ledger.js`
- Create: `tests/consign-ledger.test.mjs`

This module has no imports and no database. Every money rule in design section 6 lives here and nowhere else.

**Step 1: Write the failing tests** (`tests/consign-ledger.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTolerance, checkRun, lotMoney, farmTotals } from '../workers/src/lib/consign-ledger.js';

const lot = (o = {}) => ({ type: 'tops', term: 'dropoff', intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: 4, closed_at: null, voided_at: null, ...o });
const run = (o = {}) => ({ pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, voided_at: null, ...o });

test('tolerance is 0.5 lb or 1 percent, whichever is larger', () => {
  assert.equal(screenTolerance(10), 0.5);
  assert.equal(screenTolerance(200), 2);
});

test('checkRun accepts outputs that add up and reports the difference', () => {
  assert.deepEqual(checkRun(run(), 'tops'), { ok: true, diff: 0, tolerance: 1 });
  const off = checkRun(run({ final_lbs: 70 }), 'tops');
  assert.equal(off.ok, false);
  assert.equal(off.diff, 10);
});

test('checkRun rejects to_smalls on a smalls lot', () => {
  assert.equal(checkRun(run({ final_lbs: 90, to_smalls_lbs: 0 }), 'smalls').ok, true);
  assert.equal(checkRun(run(), 'smalls').ok, false);
});

test('unweighed lot owes nothing and is an estimate', () => {
  const m = lotMoney(lot({ intake_lbs: null }));
  assert.equal(m.status, 'dropped');
  assert.equal(m.owed, 0);
  assert.equal(m.estimate, true);
});

test('weighed, unscreened lot is estimated at intake weight', () => {
  const m = lotMoney(lot());
  assert.equal(m.status, 'weighed');
  assert.equal(m.owed, 1000);
  assert.equal(m.estimate, true);
});

test('closed lot pays final tops plus turned-to-smalls, nothing for biomass or mold', () => {
  const m = lotMoney(lot({ closed_at: 'x' }), [run()]);
  assert.equal(m.status, 'closed');
  assert.equal(m.owed, 80 * 10 + 10 * 4);
  assert.equal(m.estimate, false);
  assert.equal(m.biomass_lbs, 8);
  assert.equal(m.mold_lbs, 2);
});

test('partly screened lot pays outputs plus the unscreened remainder', () => {
  const m = lotMoney(lot(), [run({ pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 })]);
  assert.equal(m.status, 'screening');
  assert.equal(m.remainder_lbs, 60);
  assert.equal(m.owed, 30 * 10 + 5 * 4 + 60 * 10);
  assert.equal(m.estimate, true);
});

test('a closed lot pays no remainder even when pulled is under intake', () => {
  const m = lotMoney(lot({ closed_at: 'x' }), [run({ pulled_lbs: 99, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 7, mold_lbs: 2 })]);
  assert.equal(m.remainder_lbs, 0);
  assert.equal(m.owed, 840);
});

test('voided runs are ignored', () => {
  const m = lotMoney(lot(), [run({ voided_at: 'x' })]);
  assert.equal(m.status, 'weighed');
});

test('missing price flags needs_price and owes zero', () => {
  const m = lotMoney(lot({ price_per_lb: null }));
  assert.equal(m.needs_price, true);
  assert.equal(m.owed, 0);
});

test('missing smalls price is flagged only when tops turned to smalls', () => {
  assert.equal(lotMoney(lot({ smalls_price_per_lb: null, closed_at: 'x' }), [run({ final_lbs: 90, to_smalls_lbs: 0 })]).needs_price, false);
  assert.equal(lotMoney(lot({ smalls_price_per_lb: null, closed_at: 'x' }), [run()]).needs_price, true);
});

test('sold-term lot owes only for sold pounds and shows on hand', () => {
  const sold = [{ lbs: 20, kind: 'main', voided_at: null }, { lbs: 4, kind: 'smalls', voided_at: null }];
  const m = lotMoney(lot({ term: 'sold', closed_at: 'x' }), [run()], sold);
  assert.equal(m.owed, 20 * 10 + 4 * 4);
  assert.equal(m.on_hand_lbs, 60 + 6);
});

test('farm totals show a credit when payments exceed owed', () => {
  const t = farmTotals([lotMoney(lot({ closed_at: 'x' }), [run()])], [{ amount: 1000, voided_at: null }, { amount: 50, voided_at: 'x' }]);
  assert.equal(t.owed, 840);
  assert.equal(t.paid, 1000);
  assert.equal(t.balance, -160);
  assert.equal(t.credit, 160);
});

test('money is rounded to cents', () => {
  const m = lotMoney(lot({ intake_lbs: 33.33, price_per_lb: 3.33 }));
  assert.equal(m.owed, 110.99);
});
```

**Step 2:** Run `node --test tests/consign-ledger.test.mjs`. Expected: FAIL, module not found.

**Step 3: Implement** (`workers/src/lib/consign-ledger.js`)

```js
/**
 * Consignment lot ledger maths. Pure functions, no I/O.
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md section 6.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const n0 = (v) => Number(v) || 0;
const live = (rows) => (rows || []).filter((r) => !r.voided_at);
const sum = (rows, key) => rows.reduce((a, r) => a + n0(r[key]), 0);

/** Allowed gap between pounds pulled and the outputs: 0.5 lb or 1%, whichever is larger. */
export function screenTolerance(pulledLbs) {
  return Math.max(0.5, 0.01 * n0(pulledLbs));
}

/** Does a screening run add up? diff = pulled - outputs. */
export function checkRun(run, lotType) {
  const pulled = n0(run.pulled_lbs);
  const toSmalls = n0(run.to_smalls_lbs);
  const diff = round2(pulled - (n0(run.final_lbs) + toSmalls + n0(run.biomass_lbs) + n0(run.mold_lbs)));
  const tolerance = round2(screenTolerance(pulled));
  const ok = pulled > 0 && Math.abs(diff) <= tolerance && !(lotType === 'smalls' && toSmalls > 0);
  return { ok, diff, tolerance };
}

/**
 * Everything the screens need to know about one lot.
 * status: voided | dropped | weighed | screening | closed
 */
export function lotMoney(lot, runs = [], sold = []) {
  const rs = live(runs);
  const ss = live(sold);
  const intake = lot.intake_lbs == null ? null : n0(lot.intake_lbs);
  const pulled = sum(rs, 'pulled_lbs');
  const finalLbs = sum(rs, 'final_lbs');
  const toSmalls = lot.type === 'tops' ? sum(rs, 'to_smalls_lbs') : 0;
  const closed = !!lot.closed_at;

  let status = 'weighed';
  if (lot.voided_at) status = 'voided';
  else if (intake == null) status = 'dropped';
  else if (closed) status = 'closed';
  else if (pulled > 0) status = 'screening';

  const remainder = intake == null || closed ? 0 : Math.max(intake - pulled, 0);
  const price = lot.price_per_lb == null ? null : n0(lot.price_per_lb);
  const smallsPrice = lot.smalls_price_per_lb == null ? null : n0(lot.smalls_price_per_lb);
  const needsPrice = price == null || (toSmalls > 0 && smallsPrice == null);

  const mainLbs = finalLbs + remainder;
  const value = mainLbs * n0(price) + toSmalls * n0(smallsPrice);

  const soldMain = sum(ss.filter((s) => s.kind !== 'smalls'), 'lbs');
  const soldSmalls = sum(ss.filter((s) => s.kind === 'smalls'), 'lbs');

  let owed = 0;
  if (status !== 'voided') {
    owed = lot.term === 'sold' ? soldMain * n0(price) + soldSmalls * n0(smallsPrice) : value;
  }

  return {
    status,
    estimate: status !== 'closed' && status !== 'voided',
    needs_price: status !== 'voided' && needsPrice,
    intake_lbs: intake,
    pulled_lbs: round2(pulled),
    final_lbs: round2(finalLbs),
    to_smalls_lbs: round2(toSmalls),
    biomass_lbs: round2(sum(rs, 'biomass_lbs')),
    mold_lbs: round2(sum(rs, 'mold_lbs')),
    remainder_lbs: round2(remainder),
    payable_main_lbs: round2(mainLbs),
    payable_smalls_lbs: round2(toSmalls),
    sold_main_lbs: round2(soldMain),
    sold_smalls_lbs: round2(soldSmalls),
    on_hand_lbs: lot.term === 'sold' ? round2(mainLbs - soldMain + toSmalls - soldSmalls) : null,
    value: round2(value),
    owed: round2(owed),
  };
}

/** Farm totals. balance below zero = credit owed back to us. Never clamped. */
export function farmTotals(lotMoneys, payments = []) {
  const owed = round2(lotMoneys.reduce((a, m) => a + m.owed, 0));
  const paid = round2(sum(live(payments), 'amount'));
  const balance = round2(owed - paid);
  return {
    owed,
    paid,
    balance,
    credit: balance < 0 ? round2(-balance) : 0,
    estimate: lotMoneys.some((m) => m.estimate && m.owed > 0),
    needs_price: lotMoneys.some((m) => m.needs_price),
  };
}
```

**Step 4:** Run `node --test tests/consign-ledger.test.mjs`. Expected: 14 pass.

**Step 5: Commit**

```bash
git add workers/src/lib/consign-ledger.js tests/consign-ledger.test.mjs
git commit -m "feat(consign): pure ledger maths for lots and farm totals"
```

---

### Task 3: Handler skeleton, route and auth

**Files:**
- Create: `workers/src/handlers/consign-d1.js`
- Modify: `workers/src/index.js` (imports near lines 20-39, route chain near 227-322, `endpoints` array near 321)
- Create: `tests/consign-handler.test.mjs`

**Step 1: Write the failing tests** (`tests/consign-handler.test.mjs`; later tasks append to this file)

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const call = async (env, action, body, opts) => {
  const res = await handleConsignD1(post(action, body, opts), env, {});
  return (await res.json()).data;
};
const OWNER = { owner_password: 'owner-pw' };

test('every action needs the shared password', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('farms', {}, { auth: false }), env, {}), /auth|password|unauthor/i);
});

test('unknown action is NOT_FOUND', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('nope'), env, {}), /Unknown consign action/);
});

test('owner actions refuse without the owner secret, and when it is not configured', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A' }), env, {}), /owner/i);
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', owner_password: 'wrong' }), env, {}), /owner/i);
  delete env.CONSIGN_OWNER_PASSWORD;
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', ...OWNER }), env, {}), /owner/i);
});

test('router matches /api/consign exactly, after /api/consignment', () => {
  const src = readFileSync(new URL('../workers/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/api\/consign' \|\| path\.startsWith\('\/api\/consign\/'\)/);
  assert.ok(src.indexOf("startsWith('/api/consignment')") < src.indexOf("path === '/api/consign'"));
});

export { call, OWNER };
```

Note: check how the error thrown by `requireAuth` reads (`workers/src/lib/errors.js`) and tighten the first regex to its real message.

**Step 2:** Run `node --test tests/consign-handler.test.mjs`. Expected: FAIL, handler not found.

**Step 3: Implement the skeleton** (`workers/src/handlers/consign-d1.js`)

Open `workers/src/lib/auth.js` first. If `constantTimeEqual` is not exported, export it (one word change) so it is not re-implemented.

```js
/**
 * Consignment lot ledger handler. Route: /api/consign
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md
 * Money rules live in ../lib/consign-ledger.js, not here.
 */
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth, constantTimeEqual } from '../lib/auth.js';
import { pacificDay } from '../lib/pacific.js';
import { checkRun, lotMoney, farmTotals, screenTolerance, round2 } from '../lib/consign-ledger.js';

const OWNER_ACTIONS = new Set(['saveFarm', 'savePricePoint', 'setLotTerms']);

function requireOwner(body, env) {
  const secret = env.CONSIGN_OWNER_PASSWORD;
  const given = typeof body.owner_password === 'string' ? body.owner_password : '';
  // Refuse when the secret is unset. Never fall open.
  if (!secret || !given || !constantTimeEqual(given, secret)) {
    throw createError('UNAUTHORIZED', 'Owner password required');
  }
}

const ok = (data) => successResponse({ success: true, data });
const bad = (msg) => createError('VALIDATION_ERROR', msg);

export async function handleConsignD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  requireAuth(request, body, env, `consign-${action}`);
  if (OWNER_ACTIONS.has(action)) requireOwner(body, env);

  switch (action) {
    default:
      throw createError('NOT_FOUND', `Unknown consign action: ${action}`);
  }
}
```

**Step 4: Register the route** in `workers/src/index.js`:

- Add `import { handleConsignD1 } from './handlers/consign-d1.js';` after the `handleConsignmentD1` import.
- Directly after the `/api/consignment` branch add:

```js
    } else if (path === '/api/consign' || path.startsWith('/api/consign/')) {
      response = await handleConsignD1(request, env, ctx);
```

- Add `'/api/consign'` to the health-check `endpoints` array.

**Step 5:** Run `node --test tests/consign-handler.test.mjs`. Expected: 4 pass. Then `npm test`. Expected: all pass (the old consignment tests still pass untouched).

**Step 6: Commit**

```bash
git add workers/src/handlers/consign-d1.js workers/src/index.js workers/src/lib/auth.js tests/consign-handler.test.mjs
git commit -m "feat(consign): handler skeleton, exact route, owner secret"
```

---

### Task 4: Owner actions: farms and price points

**Files:**
- Modify: `workers/src/handlers/consign-d1.js`
- Modify: `tests/consign-handler.test.mjs`

**Step 1: Append failing tests**

```js
async function seedFarm(env, o = {}) {
  const { farm } = await call(env, 'saveFarm', { name: 'Farm A', default_term: 'dropoff', ...o, ...OWNER });
  return farm;
}
async function price(env, farmId, cultivar, type, p, extra = {}) {
  return call(env, 'savePricePoint', { farm_id: farmId, cultivar, type, price_per_lb: p, ...extra, ...OWNER });
}

test('saveFarm inserts, then updates by id', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  assert.equal(farm.default_term, 'dropoff');
  const { farm: again } = await call(env, 'saveFarm', { id: farm.id, name: 'Farm A', default_term: 'sold', ...OWNER });
  assert.equal(again.id, farm.id);
  assert.equal(again.default_term, 'sold');
});

test('saveFarm rejects an empty name and a bad term', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveFarm', { name: ' ', ...OWNER }), env, {}), /name/i);
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', default_term: 'x', ...OWNER }), env, {}), /term/i);
});

test('savePricePoint rejects zero and negative prices', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await assert.rejects(handleConsignD1(post('savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 0, ...OWNER }), env, {}), /price/i);
});

export { seedFarm, price };
```

**Step 2:** Run the file. Expected: the three new tests FAIL with "Unknown consign action".

**Step 3: Implement.** Add cases `saveFarm` and `savePricePoint` to the switch, and these functions:

```js
const TERMS = new Set(['dropoff', 'sold']);
const TYPES = new Set(['tops', 'smalls']);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const posNum = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${label} must be a positive number`);
  return n;
};

async function saveFarm(body, env) {
  const name = clean(body.name);
  if (!name) throw bad('Farm name is required');
  const term = body.default_term || 'dropoff';
  if (!TERMS.has(term)) throw bad('default_term must be dropoff or sold');
  const lang = body.lang === 'es' ? 'es' : 'en';
  const active = body.active === false || body.active === 0 ? 0 : 1;
  let id = Number(body.id) || null;
  if (id) {
    await env.DB.prepare('UPDATE cl_farms SET name = ?, contact = ?, default_term = ?, lang = ?, active = ? WHERE id = ?')
      .bind(name, clean(body.contact) || null, term, lang, active, id).run();
  } else {
    const r = await env.DB.prepare('INSERT INTO cl_farms (name, contact, default_term, lang, active) VALUES (?, ?, ?, ?, ?)')
      .bind(name, clean(body.contact) || null, term, lang, active).run();
    id = r.meta.last_row_id;
  }
  const farm = await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ?').bind(id).first();
  if (!farm) throw createError('NOT_FOUND', 'Farm not found');
  return ok({ farm });
}

/** Latest price point on or before a day. Returns null when none. */
async function priceFor(env, farmId, cultivar, type, day) {
  const row = await env.DB.prepare(
    'SELECT price_per_lb FROM cl_price_points WHERE farm_id = ? AND cultivar = ? AND type = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1'
  ).bind(farmId, cultivar, type, day).first();
  return row ? row.price_per_lb : null;
}

async function savePricePoint(body, env) {
  const farmId = Number(body.farm_id);
  const cultivar = clean(body.cultivar);
  if (!farmId || !cultivar) throw bad('farm_id and cultivar are required');
  if (!TYPES.has(body.type)) throw bad('type must be tops or smalls');
  const p = posNum(body.price_per_lb, 'Price per lb');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body.effective_from || '') ? body.effective_from : pacificDay(new Date());
  const r = await env.DB.prepare(
    'INSERT INTO cl_price_points (farm_id, cultivar, type, price_per_lb, effective_from) VALUES (?, ?, ?, ?, ?)'
  ).bind(farmId, cultivar, body.type, p, from).run();

  // Optional: fill lots that were dropped off before a price existed. Never overwrites a price.
  let lotsPriced = 0;
  if (body.apply_to_unpriced) {
    const a = await env.DB.prepare(
      'UPDATE cl_lots SET price_per_lb = ? WHERE farm_id = ? AND cultivar = ? AND type = ? AND price_per_lb IS NULL AND voided_at IS NULL'
    ).bind(p, farmId, cultivar, body.type).run();
    lotsPriced += a.meta.changes;
    if (body.type === 'smalls') {
      const b = await env.DB.prepare(
        "UPDATE cl_lots SET smalls_price_per_lb = ? WHERE farm_id = ? AND cultivar = ? AND type = 'tops' AND smalls_price_per_lb IS NULL AND voided_at IS NULL"
      ).bind(p, farmId, cultivar).run();
      lotsPriced += b.meta.changes;
    }
  }
  const price_point = await env.DB.prepare('SELECT * FROM cl_price_points WHERE id = ?').bind(r.meta.last_row_id).first();
  return ok({ price_point, lots_priced: lotsPriced });
}
```

**Step 4:** Run the file. Expected: all pass.

**Step 5: Commit** `git commit -am "feat(consign): owner actions for farms and price points"`

---

### Task 5: saveDropoff

**Files:** same two files.

**Step 1: Append failing tests**

```js
const lines2 = [
  { cultivar: 'Alpha', type: 'tops', intake_lbs: 100 },
  { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 },
  { cultivar: 'Beta', type: 'tops' },
];

test('saveDropoff writes one dropoff and a lot per line, copying prices', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10);
  await price(env, farm.id, 'Alpha', 'smalls', 4);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, dropped_by: 'T', lines: lines2, client_key: 'k1' });
  assert.equal(d.lots.length, 3);
  const [aTops, aSmalls, bTops] = d.lots;
  assert.equal(aTops.price_per_lb, 10);
  assert.equal(aTops.smalls_price_per_lb, 4);
  assert.equal(aSmalls.price_per_lb, 4);
  assert.equal(aTops.term, 'dropoff');
  assert.ok(aTops.weighed_at);
  assert.equal(bTops.intake_lbs, null);
  assert.equal(bTops.weighed_at, null);
  assert.equal(bTops.money.needs_price, true);
  assert.equal(bTops.money.status, 'dropped');
  assert.ok(d.dropoff.dropped_at);
});

test('a later price change does not touch an existing lot', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10, { effective_from: '2026-01-01' });
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, lines: [lines2[0]], client_key: 'k1' });
  await price(env, farm.id, 'Alpha', 'tops', 12);
  const again = await call(env, 'dropoff', { dropoff_id: d.dropoff.id });
  assert.equal(again.lots[0].price_per_lb, 10);
  const d2 = await call(env, 'saveDropoff', { farm_id: farm.id, lines: [lines2[0]], client_key: 'k2' });
  assert.equal(d2.lots[0].price_per_lb, 12);
});

test('resending the same client_key does not create a second dropoff', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seedFarm(env);
  await call(env, 'saveDropoff', { farm_id: farm.id, lines: lines2, client_key: 'k1' });
  const again = await call(env, 'saveDropoff', { farm_id: farm.id, lines: lines2, client_key: 'k1' });
  assert.equal(again.duplicate, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_lots').get().n, 3);
});

test('a bad line saves nothing', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seedFarm(env);
  const linesBad = [lines2[0], { cultivar: 'Beta', type: 'tops', intake_lbs: -5 }];
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: linesBad, client_key: 'k1' }), env, {}), /weight|positive/i);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 0);
});

test('one cultivar line can be split across terms, but not duplicated', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  const split = [{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 30 }, { cultivar: 'Alpha', type: 'tops', term: 'sold', intake_lbs: 70 }];
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, lines: split, client_key: 'k1' });
  assert.deepEqual(d.lots.map((l) => l.term), ['dropoff', 'sold']);
  const dup = [split[0], split[0]];
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: dup, client_key: 'k2' }), env, {}), /twice|duplicate/i);
});

test('saveDropoff rejects an unknown farm and an empty line list', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: 99, lines: lines2 }), env, {}), /farm/i);
  const farm = await seedFarm(env);
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: [] }), env, {}), /line/i);
});
```

**Step 2:** Run. Expected: new tests FAIL.

**Step 3: Implement.** Add cases `saveDropoff` and `dropoff`. Add a shared loader that every read uses, so there is one place that attaches `money`:

```js
/** Load lots (with runs, sold, money) for a WHERE clause on cl_lots aliased l. */
async function loadLots(env, where, args) {
  const lots = (await env.DB.prepare(
    `SELECT l.*, f.name AS farm_name, d.dropped_at FROM cl_lots l
     JOIN cl_farms f ON f.id = l.farm_id JOIN cl_dropoffs d ON d.id = l.dropoff_id
     WHERE ${where} ORDER BY l.id`
  ).bind(...args).all()).results;
  if (!lots.length) return [];
  const runs = (await env.DB.prepare(
    `SELECT r.* FROM cl_screen_runs r JOIN cl_lots l ON l.id = r.lot_id WHERE ${where} ORDER BY r.id`
  ).bind(...args).all()).results;
  const sold = (await env.DB.prepare(
    `SELECT s.* FROM cl_sold s JOIN cl_lots l ON l.id = s.lot_id WHERE ${where} ORDER BY s.id`
  ).bind(...args).all()).results;
  return lots.map((lot) => {
    const r = runs.filter((x) => x.lot_id === lot.id);
    const s = sold.filter((x) => x.lot_id === lot.id);
    return { ...lot, runs: r, sold: s, money: lotMoney(lot, r, s) };
  });
}

async function dropoffDetail(env, dropoffId, extra = {}) {
  const dropoff = await env.DB.prepare(
    'SELECT d.*, f.name AS farm_name FROM cl_dropoffs d JOIN cl_farms f ON f.id = d.farm_id WHERE d.id = ?'
  ).bind(dropoffId).first();
  if (!dropoff) throw createError('NOT_FOUND', 'Dropoff not found');
  const lots = await loadLots(env, 'l.dropoff_id = ?', [dropoffId]);
  return ok({ dropoff, lots, ...extra });
}

async function saveDropoff(body, env) {
  const farmId = Number(body.farm_id);
  const farm = farmId ? await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ? AND active = 1').bind(farmId).first() : null;
  if (!farm) throw bad('Unknown farm');
  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) throw bad('A dropoff needs at least one line');

  const key = clean(body.client_key) || crypto.randomUUID();
  const existing = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  if (existing) return dropoffDetail(env, existing.id, { duplicate: true });

  // Validate every line before anything is written.
  const seen = new Set();
  const lines = raw.map((ln, i) => {
    const cultivar = clean(ln.cultivar);
    if (!cultivar) throw bad(`Line ${i + 1}: cultivar is required`);
    if (!TYPES.has(ln.type)) throw bad(`Line ${i + 1}: type must be tops or smalls`);
    const term = ln.term || farm.default_term;
    if (!TERMS.has(term)) throw bad(`Line ${i + 1}: term must be dropoff or sold`);
    const intake = ln.intake_lbs === '' || ln.intake_lbs == null ? null : posNum(ln.intake_lbs, `Line ${i + 1}: weight`);
    const k = `${cultivar.toLowerCase()}|${ln.type}|${term}`;
    if (seen.has(k)) throw bad(`Line ${i + 1}: ${cultivar} ${ln.type} is listed twice`);
    seen.add(k);
    return { cultivar, type: ln.type, term, intake, note: clean(ln.note) || null };
  });

  const today = pacificDay(new Date());
  for (const ln of lines) {
    ln.price = await priceFor(env, farmId, ln.cultivar, ln.type, today);
    ln.smallsPrice = ln.type === 'tops' ? await priceFor(env, farmId, ln.cultivar, 'smalls', today) : null;
  }

  const source = ['paper', 'telegram'].includes(body.source) ? body.source : 'app';
  const stmts = [
    env.DB.prepare('INSERT INTO cl_dropoffs (farm_id, dropped_by, note, source, client_key) VALUES (?, ?, ?, ?, ?)')
      .bind(farmId, clean(body.dropped_by) || null, clean(body.note) || null, source, key),
    ...lines.map((ln) => env.DB.prepare(
      `INSERT INTO cl_lots (dropoff_id, farm_id, cultivar, type, term, intake_lbs, weighed_at, price_per_lb, smalls_price_per_lb, note)
       VALUES ((SELECT id FROM cl_dropoffs WHERE client_key = ?), ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?, ?, ?)`
    ).bind(key, farmId, ln.cultivar, ln.type, ln.term, ln.intake, ln.intake, ln.price, ln.smallsPrice, ln.note)),
  ];
  await env.DB.batch(stmts);
  const row = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  return dropoffDetail(env, row.id);
}
```

Switch cases: `case 'saveDropoff': return saveDropoff(body, env);` and `case 'dropoff': return dropoffDetail(env, Number(body.dropoff_id));`.

**Step 4:** Run the file. Expected: all pass.

**Step 5: Commit** `git commit -am "feat(consign): save a dropoff as one atomic batch with copied prices"`

---

### Task 6: setWeight and saveScreenRun

**Files:** same two files.

**Step 1: Append failing tests**

```js
async function dropTwo(env) {
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10);
  await price(env, farm.id, 'Alpha', 'smalls', 4);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops' }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 }] });
  return { farm, tops: d.lots[0], smalls: d.lots[1] };
}
const goodRun = { pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true };

test('setWeight fills a late weight and stamps weighed_at', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  const { lot } = await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100, actor: 'T' });
  assert.equal(lot.intake_lbs, 100);
  assert.ok(lot.weighed_at);
  assert.equal(lot.money.status, 'weighed');
});

test('a lot cannot be screened before it is weighed', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun }), env, {}), /weigh/i);
});

test('a whole-lot run closes the lot and sets the money', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const { lot } = await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  assert.equal(lot.money.status, 'closed');
  assert.equal(lot.money.owed, 840);
  assert.equal(lot.runs[0].diff_lbs, 0);
});

test('outputs that do not add up are refused, and the message says by how much', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun, final_lbs: 70 }), env, {}), /10/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_screen_runs').get().n, 0);
});

test('a small difference inside the tolerance is saved and recorded', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const { lot } = await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, final_lbs: 79.4 });
  assert.equal(lot.runs[0].diff_lbs, 0.6);
});

test('split screening: two runs, the second closes the lot', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const a = await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: false });
  assert.equal(a.lot.money.status, 'screening');
  assert.equal(a.lot.money.remainder_lbs, 60);
  const b = await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: true });
  assert.equal(b.lot.money.status, 'closed');
  assert.equal(b.lot.money.owed, 80 * 10 + 10 * 4);
});

test('cannot pull more than is left, screen a closed lot, or turn smalls to smalls', async () => {
  const { env } = freshConsignDb();
  const { tops, smalls } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun, pulled_lbs: 150, final_lbs: 130 }), env, {}), /left|more than/i);
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun }), env, {}), /closed/i);
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: smalls.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 }), env, {}), /smalls/i);
});

test('resending a run with the same client_key does not double it', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_screen_runs').get().n, 1);
});

test('setWeight correction is refused below what was already pulled, and is logged', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 });
  await assert.rejects(handleConsignD1(post('setWeight', { lot_id: tops.id, intake_lbs: 20 }), env, {}), /pulled/i);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 90, actor: 'T' });
  const h = sqlite.prepare("SELECT * FROM cl_history WHERE tbl = 'cl_lots' AND action = 'setWeight' ORDER BY id DESC").get();
  assert.match(h.before_json, /100/);
  assert.match(h.after_json, /90/);
  assert.equal(h.actor, 'T');
});

export { dropTwo, goodRun };
```

**Step 2:** Run. Expected: new tests FAIL.

**Step 3: Implement**

```js
const nonNeg = (v, label) => {
  const n = v === '' || v == null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`${label} cannot be negative`);
  return n;
};
const history = (env, tbl, rowId, action, before, after, actor) => env.DB.prepare(
  'INSERT INTO cl_history (tbl, row_id, action, before_json, after_json, actor) VALUES (?, ?, ?, ?, ?, ?)'
).bind(tbl, rowId, action, JSON.stringify(before ?? null), JSON.stringify(after ?? null), clean(actor) || 'staff');

async function oneLot(env, lotId) {
  const [lot] = await loadLots(env, 'l.id = ?', [Number(lotId)]);
  if (!lot) throw createError('NOT_FOUND', 'Lot not found');
  return lot;
}
const liveLot = (lot) => { if (lot.voided_at) throw bad('This lot was voided'); return lot; };

async function setWeight(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const intake = posNum(body.intake_lbs, 'Weight');
  if (lot.closed_at) throw bad('This lot is closed');
  if (intake + screenTolerance(intake) < lot.money.pulled_lbs) {
    throw bad(`Weight cannot be below the ${lot.money.pulled_lbs} lb already pulled for screening`);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE cl_lots SET intake_lbs = ?, weighed_at = COALESCE(weighed_at, datetime('now')) WHERE id = ?").bind(intake, lot.id),
    history(env, 'cl_lots', lot.id, 'setWeight', { intake_lbs: lot.intake_lbs }, { intake_lbs: intake }, body.actor),
  ]);
  return ok({ lot: await oneLot(env, lot.id) });
}

async function saveScreenRun(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const key = clean(body.client_key) || crypto.randomUUID();
  const dup = await env.DB.prepare('SELECT id FROM cl_screen_runs WHERE client_key = ?').bind(key).first();
  if (dup) return ok({ lot, duplicate: true });

  if (lot.intake_lbs == null) throw bad('Weigh this lot before screening it');
  if (lot.closed_at) throw bad('This lot is closed');
  const run = {
    pulled_lbs: posNum(body.pulled_lbs, 'Pounds pulled'),
    final_lbs: nonNeg(body.final_lbs, 'Final weight'),
    to_smalls_lbs: nonNeg(body.to_smalls_lbs, 'Turned to smalls'),
    biomass_lbs: nonNeg(body.biomass_lbs, 'Biomass'),
    mold_lbs: nonNeg(body.mold_lbs, 'Mold'),
  };
  if (lot.type === 'smalls' && run.to_smalls_lbs > 0) throw bad('A smalls lot cannot turn into smalls');
  const left = lot.money.remainder_lbs;
  if (run.pulled_lbs > left + screenTolerance(lot.intake_lbs)) {
    throw bad(`Only ${left} lb is left to screen, cannot pull more than that`);
  }
  const chk = checkRun(run, lot.type);
  if (!chk.ok) throw bad(`Outputs are off by ${chk.diff} lb (allowed ${chk.tolerance} lb)`);

  const stmts = [env.DB.prepare(
    'INSERT INTO cl_screen_runs (lot_id, pulled_lbs, final_lbs, to_smalls_lbs, biomass_lbs, mold_lbs, diff_lbs, note, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(lot.id, run.pulled_lbs, run.final_lbs, run.to_smalls_lbs, run.biomass_lbs, run.mold_lbs, chk.diff, clean(body.note) || null, key)];
  if (body.finishes_lot) stmts.push(env.DB.prepare("UPDATE cl_lots SET closed_at = datetime('now') WHERE id = ?").bind(lot.id));
  await env.DB.batch(stmts);
  return ok({ lot: await oneLot(env, lot.id) });
}
```

Add both cases to the switch.

**Step 4:** Run the file. Expected: all pass.

**Step 5: Commit** `git commit -am "feat(consign): late weights and screening runs with add-up check"`

---

### Task 7: saveSold, savePayment, voidRow, setLotTerms

**Files:** same two files.

**Step 1: Append failing tests**

```js
test('sold pounds only on sold-term lots, never above what is payable', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env, { default_term: 'sold' });
  await price(env, farm.id, 'Alpha', 'tops', 10);
  await price(env, farm.id, 'Alpha', 'smalls', 4);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', term: 'dropoff', intake_lbs: 10 }] });
  const [tops, smalls] = d.lots;
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun });
  const a = await call(env, 'saveSold', { lot_id: tops.id, lbs: 20, kind: 'main', client_key: 's1' });
  assert.equal(a.lot.money.owed, 200);
  assert.equal(a.lot.money.on_hand_lbs, 70);
  await assert.rejects(handleConsignD1(post('saveSold', { lot_id: tops.id, lbs: 61, kind: 'main' }), env, {}), /on hand|left/i);
  await assert.rejects(handleConsignD1(post('saveSold', { lot_id: tops.id, lbs: 11, kind: 'smalls' }), env, {}), /on hand|left/i);
  await assert.rejects(handleConsignD1(post('saveSold', { lot_id: smalls.id, lbs: 1 }), env, {}), /consignment|sold/i);
});

test('payment is saved once per client_key and returns farm totals', async () => {
  const { env } = freshConsignDb();
  const { farm, tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const p = await call(env, 'savePayment', { farm_id: farm.id, amount: 1160, method: 'check', reference: '1001', client_key: 'p1' });
  assert.equal(p.totals.owed, 1160);
  assert.equal(p.totals.balance, 0);
  await call(env, 'savePayment', { farm_id: farm.id, amount: 1160, method: 'check', reference: '1001', client_key: 'p1' });
  const f = await call(env, 'farm', { farm_id: farm.id });
  assert.equal(f.payments.length, 1);
});

test('voidRow needs a reason, keeps the row, and logs it', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await assert.rejects(handleConsignD1(post('voidRow', { table: 'lot', id: tops.id }), env, {}), /reason/i);
  await call(env, 'voidRow', { table: 'lot', id: tops.id, reason: 'entered twice', actor: 'T' });
  const row = sqlite.prepare('SELECT * FROM cl_lots WHERE id = ?').get(tops.id);
  assert.ok(row.voided_at);
  assert.equal(row.void_reason, 'entered twice');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cl_history WHERE action = 'void'").get().n, 1);
});

test('voiding a run reopens its lot, voiding a dropoff voids its lots', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const { lot } = await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun });
  await call(env, 'voidRow', { table: 'run', id: lot.runs[0].id, reason: 'wrong lot' });
  assert.equal(sqlite.prepare('SELECT closed_at FROM cl_lots WHERE id = ?').get(tops.id).closed_at, null);
  await call(env, 'voidRow', { table: 'dropoff', id: tops.dropoff_id, reason: 'test entry' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_lots WHERE voided_at IS NULL').get().n, 0);
});

test('setLotTerms is owner-only, changes term and price, and is logged', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await assert.rejects(handleConsignD1(post('setLotTerms', { lot_id: tops.id, term: 'sold' }), env, {}), /owner/i);
  const { lot } = await call(env, 'setLotTerms', { lot_id: tops.id, term: 'sold', price_per_lb: 11, ...OWNER });
  assert.equal(lot.term, 'sold');
  assert.equal(lot.price_per_lb, 11);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cl_history WHERE action = 'setLotTerms'").get().n, 1);
});
```

**Step 2:** Run. Expected: new tests FAIL (`farm` read arrives in Task 8; the payment test stays red until then, which is expected).

**Step 3: Implement**

```js
async function saveSold(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const key = clean(body.client_key) || crypto.randomUUID();
  if (await env.DB.prepare('SELECT id FROM cl_sold WHERE client_key = ?').bind(key).first()) return ok({ lot, duplicate: true });
  if (lot.term !== 'sold') throw bad('Sold pounds are only tracked on consignment (owed as sold) lots');
  const lbs = posNum(body.lbs, 'Pounds sold');
  const kind = body.kind === 'smalls' ? 'smalls' : 'main';
  const m = lot.money;
  const left = kind === 'smalls' ? round2(m.payable_smalls_lbs - m.sold_smalls_lbs) : round2(m.payable_main_lbs - m.sold_main_lbs);
  if (lbs > left + 0.005) throw bad(`Only ${left} lb is left on hand for this lot`);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.sold_on || '') ? body.sold_on : pacificDay(new Date());
  await env.DB.prepare('INSERT INTO cl_sold (lot_id, sold_on, lbs, kind, note, client_key) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(lot.id, day, lbs, kind, clean(body.note) || null, key).run();
  return ok({ lot: await oneLot(env, lot.id) });
}

async function farmTotalsFor(env, farmId) {
  const lots = await loadLots(env, 'l.farm_id = ? AND l.voided_at IS NULL', [farmId]);
  const payments = (await env.DB.prepare('SELECT * FROM cl_payments WHERE farm_id = ? ORDER BY paid_on DESC, id DESC').bind(farmId).all()).results;
  return { lots, payments, totals: farmTotals(lots.map((l) => l.money), payments) };
}

async function savePayment(body, env) {
  const farmId = Number(body.farm_id);
  if (!farmId || !(await env.DB.prepare('SELECT id FROM cl_farms WHERE id = ?').bind(farmId).first())) throw bad('Unknown farm');
  const key = clean(body.client_key) || crypto.randomUUID();
  let row = await env.DB.prepare('SELECT * FROM cl_payments WHERE client_key = ?').bind(key).first();
  if (!row) {
    const amount = posNum(body.amount, 'Amount');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(body.paid_on || '') ? body.paid_on : pacificDay(new Date());
    await env.DB.prepare('INSERT INTO cl_payments (farm_id, paid_on, amount, method, reference, note, client_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(farmId, day, amount, clean(body.method) || null, clean(body.reference) || null, clean(body.note) || null, key).run();
    row = await env.DB.prepare('SELECT * FROM cl_payments WHERE client_key = ?').bind(key).first();
  }
  const { totals } = await farmTotalsFor(env, farmId);
  return ok({ payment: row, totals });
}

const VOID_TABLES = { dropoff: 'cl_dropoffs', lot: 'cl_lots', run: 'cl_screen_runs', sold: 'cl_sold', payment: 'cl_payments' };

async function voidRow(body, env) {
  const tbl = VOID_TABLES[body.table];
  if (!tbl) throw bad('Unknown table');
  const reason = clean(body.reason);
  if (!reason) throw bad('A reason is required to void an entry');
  const id = Number(body.id);
  const row = await env.DB.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).bind(id).first();
  if (!row) throw createError('NOT_FOUND', 'Entry not found');
  if (row.voided_at) return ok({ ok: true, already: true });
  const stmts = [
    env.DB.prepare(`UPDATE ${tbl} SET voided_at = datetime('now'), void_reason = ? WHERE id = ?`).bind(reason, id),
    history(env, tbl, id, 'void', row, { void_reason: reason }, body.actor),
  ];
  if (body.table === 'dropoff') {
    stmts.push(env.DB.prepare("UPDATE cl_lots SET voided_at = datetime('now'), void_reason = ? WHERE dropoff_id = ? AND voided_at IS NULL").bind(reason, id));
  }
  if (body.table === 'run') {
    stmts.push(env.DB.prepare('UPDATE cl_lots SET closed_at = NULL WHERE id = ?').bind(row.lot_id));
  }
  await env.DB.batch(stmts);
  return ok({ ok: true });
}

async function setLotTerms(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const next = {
    term: body.term == null ? lot.term : body.term,
    price_per_lb: body.price_per_lb == null ? lot.price_per_lb : posNum(body.price_per_lb, 'Price per lb'),
    smalls_price_per_lb: body.smalls_price_per_lb == null ? lot.smalls_price_per_lb : posNum(body.smalls_price_per_lb, 'Smalls price per lb'),
  };
  if (!TERMS.has(next.term)) throw bad('term must be dropoff or sold');
  if (next.term === 'dropoff' && lot.sold.some((s) => !s.voided_at)) throw bad('Void the sold entries before changing this lot to owed on dropoff');
  const before = { term: lot.term, price_per_lb: lot.price_per_lb, smalls_price_per_lb: lot.smalls_price_per_lb };
  await env.DB.batch([
    env.DB.prepare('UPDATE cl_lots SET term = ?, price_per_lb = ?, smalls_price_per_lb = ? WHERE id = ?').bind(next.term, next.price_per_lb, next.smalls_price_per_lb, lot.id),
    history(env, 'cl_lots', lot.id, 'setLotTerms', before, next, body.actor || 'owner'),
  ]);
  return ok({ lot: await oneLot(env, lot.id) });
}
```

`tbl` in `voidRow` comes only from the fixed `VOID_TABLES` map, never from the request, so the interpolation is safe. Keep it that way.

Add the four cases to the switch.

**Step 4:** Run. Expected: all pass except the payment test (needs `farm`).

**Step 5: Commit** `git commit -am "feat(consign): sold entries, payments, voids with history, owner lot terms"`

---

### Task 8: Reads: farms, farm, open

**Files:** same two files.

**Step 1: Append failing tests**

```js
test('farms lists every farm with its balance', async () => {
  const { env } = freshConsignDb();
  const { farm, tops } = await dropTwo(env);
  await seedFarm(env, { name: 'Farm B' });
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const list = await call(env, 'farms');
  assert.equal(list.length, 2);
  const a = list.find((f) => f.id === farm.id);
  assert.equal(a.owed, 1000 + 160);
  assert.equal(a.estimate, true);
  assert.equal(list.find((f) => f.name === 'Farm B').balance, 0);
});

test('farm returns current price points, dropoffs with lots, payments and totals', async () => {
  const { env } = freshConsignDb();
  const { farm } = await dropTwo(env);
  await price(env, farm.id, 'Alpha', 'tops', 12);
  const f = await call(env, 'farm', { farm_id: farm.id });
  assert.equal(f.farm.name, 'Farm A');
  assert.equal(f.price_points.length, 2);
  assert.equal(f.price_points.find((p) => p.type === 'tops').price_per_lb, 12);
  assert.equal(f.dropoffs.length, 1);
  assert.equal(f.dropoffs[0].lots.length, 2);
  assert.ok('balance' in f.totals);
});

test('open groups live lots by the work they need', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [
    { cultivar: 'Alpha', type: 'tops' },
    { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 },
    { cultivar: 'Beta', type: 'tops', intake_lbs: 10 },
  ] });
  const o = await call(env, 'open');
  assert.deepEqual(o.to_weigh.map((l) => l.id), [d.lots[0].id]);
  assert.deepEqual(o.to_screen.map((l) => l.id), [d.lots[1].id, d.lots[2].id]);
  assert.deepEqual(o.needs_price.map((l) => l.id).sort(), [d.lots[1].id, d.lots[2].id].sort());
  assert.equal(o.to_weigh[0].farm_name, 'Farm A');
  await call(env, 'voidRow', { table: 'lot', id: d.lots[0].id, reason: 'x' });
  assert.equal((await call(env, 'open')).to_weigh.length, 0);
});
```

**Step 2:** Run. Expected: new tests FAIL.

**Step 3: Implement**

```js
async function listFarms(env) {
  const farms = (await env.DB.prepare('SELECT * FROM cl_farms ORDER BY active DESC, name').all()).results;
  const lots = await loadLots(env, 'l.voided_at IS NULL', []);
  const payments = (await env.DB.prepare('SELECT * FROM cl_payments').all()).results;
  return ok(farms.map((f) => ({
    ...f,
    ...farmTotals(lots.filter((l) => l.farm_id === f.id).map((l) => l.money), payments.filter((p) => p.farm_id === f.id)),
  })));
}

async function farmDetail(body, env) {
  const farmId = Number(body.farm_id);
  const farm = await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ?').bind(farmId).first();
  if (!farm) throw createError('NOT_FOUND', 'Farm not found');
  const today = pacificDay(new Date());
  // Current price per cultivar and type: newest effective row on or before today.
  const price_points = (await env.DB.prepare(
    `SELECT p.* FROM cl_price_points p WHERE p.farm_id = ? AND p.effective_from <= ?
       AND p.id = (SELECT q.id FROM cl_price_points q WHERE q.farm_id = p.farm_id AND q.cultivar = p.cultivar AND q.type = p.type
                   AND q.effective_from <= ? ORDER BY q.effective_from DESC, q.id DESC LIMIT 1)
     ORDER BY p.cultivar, p.type DESC`
  ).bind(farmId, today, today).all()).results;
  const { lots, payments, totals } = await farmTotalsFor(env, farmId);
  const dropoffs = (await env.DB.prepare('SELECT * FROM cl_dropoffs WHERE farm_id = ? AND voided_at IS NULL ORDER BY dropped_at DESC, id DESC').bind(farmId).all()).results
    .map((d) => ({ ...d, lots: lots.filter((l) => l.dropoff_id === d.id) }));
  return ok({ farm, price_points, dropoffs, payments: payments.filter((p) => !p.voided_at), totals });
}

async function openWork(env) {
  const lots = await loadLots(env, 'l.voided_at IS NULL AND l.closed_at IS NULL', []);
  return ok({
    to_weigh: lots.filter((l) => l.money.status === 'dropped'),
    to_screen: lots.filter((l) => l.money.status === 'weighed' || l.money.status === 'screening'),
    needs_price: (await loadLots(env, 'l.voided_at IS NULL', [])).filter((l) => l.money.needs_price),
  });
}
```

`loadLots` with an empty `args` array calls `.bind()` with no arguments; confirm the D1 stub and real D1 both accept that (the helper's `bind` does). If real D1 complains, skip `.bind` when `args.length === 0`.

Add cases `farms`, `farm`, `open`.

**Step 4:** Run the whole file. Expected: every test passes, including the payment test from Task 7.

**Step 5: Commit** `git commit -am "feat(consign): farm list, farm detail and open-work reads"`

---

### Task 9: End-to-end money scenarios

**Files:**
- Create: `tests/consign-scenarios.test.mjs`

These are the cases Koa described. They go through the handler only, no direct SQL. Import `handleConsignD1`, `freshConsignDb`, `post`, and re-declare the tiny `call`, `OWNER` helpers (do not import from the other test file; node:test would run its tests twice).

Write one test per scenario, each asserting `farm.totals` after each step:

1. **Paid on dropoff, screened lower, credit to us.** Farm term `dropoff`. Alpha tops 100 lb at 10, smalls price 4. After dropoff: owed 1000, estimate true. Pay 1000: balance 0. Screen whole lot 80 / 10 / 8 / 2: owed 840, balance -160, credit 160, estimate false. Next dropoff of 50 lb: owed 1340, balance 340 (the credit carried).
2. **Dropped, weighed three days later.** Dropoff with no weights: owed 0, `open.to_weigh` has the lots. `setWeight` on each: owed appears, lots move to `to_screen`.
3. **Split screening.** 100 lb, run of 40 then a finishing run of 60. Assert owed after each run and status `screening` then `closed`.
4. **Price change mid-season.** Dropoff at 10, new price point 12, second dropoff. First lot still owes at 10, second at 12.
5. **Partly on consignment.** One dropoff: Alpha tops 30 lb `dropoff` + 70 lb `sold`. Owed is 300 until a sold entry of 20 lb on the consignment lot makes it 500; on hand shows 50.
6. **Needs price.** Beta dropped with no price point: owed 0, `needs_price` true on totals. `savePricePoint` with `apply_to_unpriced: true`: `lots_priced` is 1 and owed appears.
7. **Void corrects the balance.** A payment voided with a reason comes back out of `paid`; a voided lot leaves `owed`.

**Steps:** write the tests, run `node --test tests/consign-scenarios.test.mjs`, expect all pass (the code already exists). If one fails, the handler or ledger has a bug: fix the code, not the expectation, unless the expectation contradicts design section 6. Commit: `git commit -am "test(consign): end-to-end money scenarios"`.

---

### Task 10: Page shell, labels, API module, gate

**Files:**
- Create: `src/pages/consign.html`
- Create: `src/css/consign.css`
- Create: `src/js/consign/main.js`, `src/js/consign/api.js`, `src/js/consign/labels.js`
- Modify: `tests/page-gate.test.mjs` (add `consign.html` to `GATED`; it has its own language toggle, so do not add it to `FIXED_LANG` and do not put `data-lang` on the gate script)

**Read first:** `src/pages/wholesale.html` (gated page head), `src/js/shared/api.js` (`makeApi`, `apiPost`), `src/js/shared/i18n.js`, `src/js/crew-board/main.js` (language toggle and localhost API override), `src/css/shared-base.css` (theme variables), `CLAUDE.md` UI rules.

**Step 1:** Add `consign.html` to `GATED` in `tests/page-gate.test.mjs`. Run `node --test tests/page-gate.test.mjs`. Expected: FAIL (page does not exist or has no gate).

**Step 2: `consign.html`.** Requirements:

- `<head>`: the page gate as the first synchronous classic script, exactly as in `wholesale.html` (`<script src="../js/shared/page-gate.js"></script>`; the stamper adds `?h=`). Then the theme pre-paint script used by other pages, `shared-base.css`, `consign.css`, viewport meta, `<title>Consignment</title>`.
- The `<!-- module-hashes:start -->` / `<!-- module-hashes:end -->` markers, copied from `wholesale.html`, then `<script type="module" src="../js/consign/main.js"></script>`.
- Body: a top bar (`#homeBtn`, title with `data-i18n="title"`, `#heldChip` hidden by default, `#langToggle`, `#ownerBtn`), one `<main id="view">` that views render into, and a `#toast` live region (`role="status"`).

**Step 3: `labels.js`.** Export one call to `registerLabels({ en: {...}, es: {...} })`. Keys (both languages, every key in both):

`title, home, newDropoff, recordPayment, toWeigh, toScreen, needsPrice, nothingWaiting, farms, farm, cultivar, addCultivar, tops, smalls, lbs, notWeighedYet, price, perLb, noPrice, term, termDropoff, termSold, splitLine, note, dropoffNote, droppedBy, save, saving, saved, savedHeld, cancel, back, weigh, intakeWeight, screening, before, pulled, wholeLot, finalTops, finalSmalls, toSmalls, biomass, mold, addsUp, offBy, allowed, finishesLot, leftToScreen, owed, creditToUs, estimate, paid, payments, amount, method, check, cash, transfer, reference, date, onHand, sold, addSold, void, voidReason, voided, owner, ownerPassword, editPrice, addPricePoint, addFarm, applyToUnpriced, statusDropped, statusWeighed, statusScreening, statusClosed, held, heldSend, errGeneric, errOffline, confirmDropoff, lotsCount`

Spanish is for barn staff: plain words (`Entrega nueva`, `Pesar`, `Cribado`, `Moho`, `Biomasa`, `Pasó a smalls`, `Cuadra`, `No cuadra por`). Keep `tops` and `smalls` untranslated; the crew uses those words.

**Step 4: `api.js`.**

```js
import { makeApi } from '../shared/api.js';

// Follow makeApi's real signature in shared/api.js. Honour the localhost override
// (?api=http://localhost:8787/api) the same way crew-board/main.js does.
const api = makeApi('consign', { auth: true });

const OWNER_KEY = 'consign_owner_pw';
export const ownerPw = () => { try { return sessionStorage.getItem(OWNER_KEY) || ''; } catch { return ''; } };
export const setOwnerPw = (v) => { try { v ? sessionStorage.setItem(OWNER_KEY, v) : sessionStorage.removeItem(OWNER_KEY); } catch { /* private mode */ } };

/** POST one action. Resolves with data, rejects with an Error carrying the server message. */
export async function call(action, body = {}, { owner = false } = {}) {
  const payload = owner ? { ...body, owner_password: ownerPw() } : body;
  const res = await api.post(action, payload);
  if (!res || res.success === false) throw new Error((res && (res.error || res.message)) || 'Request failed');
  return res.data;
}
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
```

Adapt `api.post` and the error shape to what `makeApi` really returns; keep the exported `call`, `newKey`, `ownerPw`, `setOwnerPw` names because later tasks use them. The owner password lives in `sessionStorage` only (gone when the tab closes), never `localStorage`.

**Step 5: `main.js`.** A tiny hash router: `#/` home, `#/dropoff`, `#/weigh/<lotId>`, `#/screen/<lotId>`, `#/farm/<farmId>`, `#/pay/<farmId?>`. Each view is a module exporting `render(root, params)`. For this task register only a placeholder home that renders the title. Wire the language toggle exactly like `crew-board/main.js` lines 105-111 and re-render on `ro:langchange`. Import `./labels.js` for its side effect first.

**Step 6: `consign.css`.** Only layout for the shell in this task. Rules for all consign CSS: variables from `shared-base.css` for every colour (works in both themes), minimum 44px touch targets, body text 18px or larger on tablets, number inputs 24px, one column under 600px, no horizontal scroll at 375px.

Step colours (define once as custom properties on `.consign`, with a dark-theme override, and reuse everywhere):
`--st-dropped` (amber), `--st-weighed` (blue), `--st-screening` (violet), `--st-closed` (green), `--st-price` (red). A status is always shown with its word as well as its colour.

**Step 7:** Run `npm run stamp`, then `node --test tests/page-gate.test.mjs` and `npm run stamp:check`. Expected: pass.

**Step 8:** Serve and look: `python -m http.server 8123` from the repo root, open `http://localhost:8123/src/pages/consign.html`. Expected: the gate asks for the password, then the shell shows, the toggle switches the title between languages.

**Step 9: Commit** `git add src/pages/consign.html src/css/consign.css src/js/consign tests/page-gate.test.mjs && git commit -m "feat(consign): gated page shell with EN/ES labels"`

---

### Task 11: Home view

**Files:**
- Create: `src/js/consign/views/home.js`
- Create: `src/js/consign/format.js`
- Modify: `src/js/consign/main.js`, `src/css/consign.css`

`format.js` exports `lbs(n)` (one decimal, `—` for null), `money(n)` (`$1,234.50`; negative shown as a credit by the caller, never as `-$`), `when(sqliteUtc)` (local date and time in the current language), `statusLabel(status)`.

Home calls `open` and `farms` in parallel and renders, top to bottom:

1. Two large buttons side by side: **New dropoff** (`#/dropoff`) and **Record payment** (`#/pay`).
2. Three work cards, each a coloured header with a count, then one large row per lot (`farm · cultivar · tops/smalls · lbs · dropped date`):
   - **Waiting to be weighed** (amber) → row opens `#/weigh/<id>`.
   - **Waiting on screening** (blue) → row opens `#/screen/<id>`; a lot in `screening` status shows "X lb left".
   - **Needs a price** (red) → rows are not links for staff; in owner mode they open the farm page.
   A card with no rows shows the `nothingWaiting` text, not an empty box.
3. **Farms**: one card per active farm with the big number (owed, or "credit to us" in green wording), an `estimate` tag when `estimate` is true, and a tap target to `#/farm/<id>`.

Errors: if either call fails, show a retry card with the server message; never a blank page.

Check at both extremes before committing (stub the API with `page.route` or a temporary local fixture): zero lots and zero farms; and 40 waiting lots plus 12 farms. Nothing overflows at 375px or at 1024px.

Commit: `feat(consign): home with work cards and farm balances`.

---

### Task 12: Dropoff view

**Files:**
- Create: `src/js/consign/views/dropoff.js`
- Modify: `src/js/consign/main.js`, `src/css/consign.css`

Flow, in explicit numbered steps on screen:

1. **Farm.** Large buttons, one per active farm (from `farms`). Picking one loads `farm` to get its price points and default term.
2. **Cultivars.** One card per cultivar row. Add a row from chips of that farm's priced cultivars, or "other" with a text box. Each row has:
   - Two big number boxes side by side: **Tops lb** and **Smalls lb** (`inputmode="decimal"`). Empty means "not weighed yet" if the type's checkbox is ticked, or "not brought" if not. Use a small tick box per type labelled `tops` / `smalls`; typing a weight ticks it.
   - Under each box: the locked price (`$X / lb`) or a red `No price yet` tag. Staff cannot edit it.
   - A term chip per box showing the farm default (`Owed on dropoff` / `Owed as sold`). Tapping it opens **Split**: enter pounds for each term; the row then shows two boxes for that type. Changing the term without a split is also allowed.
   - A note field, and a remove-row button (44px).
3. **Notes.** Dropped-by name (remembered in `localStorage` under `consign_actor`, try/catch) and a dropoff note.
4. **Confirm.** A summary card: farm, each line with pounds or "not weighed yet", term, price. Button **Save dropoff**.

Saving:
- Build `lines` from ticked boxes only. Generate `client_key` once when the form opens, and reuse it on every retry of this form.
- Disable the button and show `saving`. Show `saved` only after `call('saveDropoff')` resolves, then go home.
- On a network failure (fetch threw, or `navigator.onLine` is false) hand the entry to the held queue (Task 15) and show `savedHeld`. On a validation error from the server, show the server's message next to the form and keep everything typed.
- Leaving the form with typed data asks for confirmation.

Do not show money totals on this screen. Staff are recording pounds.

Check at the extremes: one cultivar with only tops; ten cultivars with both types and two splits, on a 375px phone and a 1024px tablet.

Commit: `feat(consign): dropoff grid with locked prices and term split`.

---

### Task 13: Weigh and Screening views

**Files:**
- Create: `src/js/consign/views/weigh.js`, `src/js/consign/views/screen.js`
- Modify: `src/js/consign/main.js`, `src/css/consign.css`

**Weigh** (`#/weigh/<lotId>`): shows farm, cultivar, type, dropped date; one big number box; Save calls `setWeight` with `actor` from `consign_actor`. If the dropoff has other unweighed lots, after saving offer "Next: <cultivar type>" so a whole dropoff is weighed in one pass.

**Screening** (`#/screen/<lotId>`): load the lot through `dropoff` (find it in `lots`).

- Header band: **Before** = intake lb, and **Left to screen** = `money.remainder_lbs`. Previous runs listed underneath, each with a void button (reason prompt → `voidRow` table `run`).
- **Pounds pulled**, pre-filled with what is left, and a `Whole lot` toggle (on by default; turning it off clears the box and sets `finishes_lot` false).
- Output boxes, large, in this order for tops: **Final tops**, **Turned to smalls**, **Biomass**, **Mold**. For smalls: **Final smalls**, **Biomass**, **Mold**.
- A live check bar under the boxes, using the same rule as the server. Import nothing from `workers/`; re-implement the two lines (`tolerance = max(0.5, 1% of pulled)`, `diff = pulled − sum of outputs`) in `format.js` with a comment pointing at `workers/src/lib/consign-ledger.js`. Green "Adds up" when `|diff| ≤ tolerance`; red "Off by X lb (allowed Y lb)" otherwise. Save is disabled while red.
- **This finishes the lot** tick, on when `Whole lot` is on.
- Note field. Save calls `saveScreenRun` with a `client_key` made when the view opened. Same saved / held / validation behaviour as the dropoff view.

Commit: `feat(consign): weigh and screening screens with live add-up check`.

---

### Task 14: Farm page, payment, owner mode

**Files:**
- Create: `src/js/consign/views/farm.js`, `src/js/consign/views/pay.js`, `src/js/consign/owner.js`
- Modify: `src/js/consign/main.js`, `src/css/consign.css`

**Farm page** (`#/farm/<id>`), from `farm`:

1. Banner: the balance as one large number, worded `Owed` or `Credit to us`, with `Estimate` when `totals.estimate`, and paid-to-date beneath.
2. **Price points**: a card per cultivar with tops and smalls price. Locked for staff.
3. **Dropoffs**, newest first, one card each: date and time, dropped by, note, then a line per lot with a status chip (colour + word), pounds dropped, term, and once screened the after numbers (final, to smalls, biomass, mold). Sold-term lots show on hand and sold, with an **Add sold pounds** button (pounds, main or smalls, date → `saveSold`). Each lot and each dropoff has a void button (reason required).
4. **Payments**: date, amount, method, reference, each with a void button.

**Payment** (`#/pay/<farmId?>`): pick farm if not given; shows the current balance; amount, date (default today, local), method (check, cash, transfer), reference, note; `savePayment` with a `client_key`.

**Owner mode** (`owner.js`): the top-bar Owner button asks for the owner password, stores it with `setOwnerPw`, and marks `document.body.dataset.owner = '1'`. In owner mode the farm page also shows: edit farm (name, contact, default term, language, active), add price point (cultivar, type, price, effective date, "apply to lots waiting on a price" tick), and per lot "change term / price" (`setLotTerms`). Home shows an **Add farm** button. If an owner call returns the owner error, clear the stored password and say so. Never render the owner password or keep it past the tab.

Void buttons use a small dialog (reason text required), not `window.confirm`.

Commit: `feat(consign): farm page, payments and owner mode`.

---

### Task 15: Held entries (no signal)

**Files:**
- Create: `src/js/consign/queue.js`
- Create: `tests/consign-queue.test.mjs`
- Modify: `src/js/consign/main.js`, the three views that save (`dropoff`, `screen`, `pay`), plus `weigh`

Stage 1 uses `localStorage` for the held queue (key `consign_held_v1`); entries are a few hundred bytes. This replaces "IndexedDB" in design section 9; the behaviour the design asks for is unchanged.

`queue.js` is written so it can be tested without a browser: it takes a storage object and a sender.

```js
export function makeQueue({ storage, send, key = 'consign_held_v1' }) {
  const read = () => { try { return JSON.parse(storage.getItem(key) || '[]'); } catch { return []; } };
  const write = (rows) => { try { storage.setItem(key, JSON.stringify(rows)); return true; } catch { return false; } };
  return {
    list: read,
    /** Returns false when the entry could not be kept (storage full or blocked). */
    hold(action, body) { const rows = read(); rows.push({ action, body, held_at: Date.now() }); return write(rows); },
    /** Send held entries oldest first. Stops at the first network failure. Drops entries the server rejects, returning them. */
    async flush() {
      const rejected = [];
      let rows = read();
      while (rows.length) {
        const [head, ...rest] = rows;
        try { await send(head.action, head.body); }
        catch (e) {
          if (e && e.network) break;
          rejected.push({ ...head, error: String(e && e.message || e) });
        }
        rows = rest; write(rows);
      }
      return { left: read().length, rejected };
    },
  };
}
```

Careful: on a network failure the loop must `break` before `rows = rest`. Write it so the failing entry stays at the head. The tests below pin this.

**Tests** (`tests/consign-queue.test.mjs`, plain `node:test`, a `Map`-backed fake storage):

1. `hold` then `list` returns the entry; a storage that throws on `setItem` makes `hold` return false.
2. `flush` sends in order and empties the queue.
3. A network error on the second entry leaves the second and third entries held, in order.
4. A server rejection (non-network error) drops that entry, reports it in `rejected`, and continues.
5. Each held body keeps its `client_key`, so a resend after a lost response cannot double-save (assert the key passed to `send` equals the one held).

Wiring: `api.js` `call` marks fetch failures with `err.network = true`. Views call `queue.hold(action, body)` on a network error; if `hold` returns false, show a blocking error telling the user to write the numbers down. `main.js` flushes on load, on the `online` event, and when the `#heldChip` ("2 held") is tapped; rejected entries are shown with the server's reason so nothing disappears silently.

Run `node --test tests/consign-queue.test.mjs`. Expected: 5 pass. Commit: `feat(consign): held entries queue for saves with no signal`.

---

### Task 16: Browser spec

**Files:**
- Create: `tests/consign.spec.js`

Model it on `tests/bagtag.spec.js` (spawns `python -m http.server`, context-level guards). Required guards, at the **context** level so new tabs are covered too:

```js
await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
```

Then route `**/api/consign**` to an in-memory fake that answers the actions used, and `**/api/orders**` `validatePassword` for the gate. Seed `localStorage` with `ro_api_password` and `ro-lang` in `addInitScript`. Fixture data uses `Farm A`, `Alpha`, `Beta` and made-up prices.

Specs:

1. **One-line dropoff (EN):** pick farm, add Alpha, type tops weight, save. The request body has one line with a `client_key`; "Saved" appears only after the fake responds (delay the fake 300 ms and assert the button reads Saving meanwhile).
2. **Ten cultivars with both types (ES, 375×812):** fill all, split one line across terms; no horizontal scroll (`document.documentElement.scrollWidth <= clientWidth`); the posted body has 21 lines.
3. **Screening add-up:** outputs off by 10 lb show the red bar and a disabled Save; fixing the number turns it green and saves with `finishes_lot: true`.
4. **No signal:** the fake aborts the save; the held chip shows 1; when the fake recovers and the chip is tapped, the same `client_key` is sent and the chip clears.
5. **Staff cannot edit prices:** no price inputs exist on the dropoff or farm page without owner mode.
6. At the end of every spec: `expect(blocked).toEqual([])` is not required, but assert no request reached a `workers.dev` host un-aborted (the guard guarantees it; the assertion documents it).

Run: `npx playwright test tests/consign.spec.js --project=chromium`. Expected: all pass. Kill the http server in `afterAll`. Commit: `test(consign): browser spec for dropoff, screening and held saves`.

---

### Task 17: Ready-to-ship gate

**Step 1:** Add a nav link to the new page where the old Consignment link sits (`src/pages/index.html` near line 78; check `wholesale.html` and `complaints.html` sidebars too). Label it `Consignment (new)` / `Consignación (nueva)` and leave the old link in place as `Consignment archive`.

**Step 2:** Run everything CI runs, plus the spec:

```bash
npm run lint
npm test
npm run stamp:check
npx playwright test tests/consign.spec.js --project=chromium
```

Expected: all green, zero lint errors.

**Step 3:** `cd workers && npm run deploy -- --dry-run`. Expected: the dry run lists `env.DB`. Do not deploy.

**Step 4:** Search the diff for anything that should not be in a client-facing repo: `git diff origin/master --stat` and `git diff origin/master | grep -inE "\$[0-9]{3,}|password *=|secret"`. Expected: no real names, prices or secret values.

**Step 5:** Use superpowers:requesting-code-review on the branch diff. Fix what it finds; re-run Step 2.

**Step 6:** Stop. Report to the hub session: branch name, commit count, test counts, and the ship checklist below. Do not push.

---

### Task 18: Ship (only on Koa's yes in the hub session)

1. Push the branch and open a PR to `master`; wait for CI.
2. Set the owner secret (Koa types the value): `cd workers && npx wrangler secret put CONSIGN_OWNER_PASSWORD --config wrangler.toml --env=""`. Add its name to the secrets comment in `workers/wrangler.toml`.
3. Apply the migration before the worker: `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0066-consign-lots.sql`.
4. Merge the PR, then `cd workers && npm run deploy`. Check `/api/consign?action=farms` returns an empty list with the password and refuses without it.
5. Koa adds farms and price points in owner mode (they are never put in the repo), then enters one real dropoff.
6. Wiki (farm repo): rewrite `wiki/operations/sop-consignment-intake.md` for the new screens, mark `/intake-consignment` retired, update `wiki/sales/consignment.md`, `wiki/tasks/todo.md` and `wiki/log.md`.

---

## Deviations from the design, on purpose

- `cl_lots.closed_at` and the "This finishes the lot" tick replace "closed when pulled equals intake", because a re-weigh at screening rarely matches the intake weight exactly.
- `cl_sold.kind` (`main` / `smalls`) lets a consignment tops lot record sales of its screened-down smalls at the smalls price.
- `client_key` on dropoffs, runs, sold entries and payments makes resends safe.
- Held entries use `localStorage`, not IndexedDB.
- `cl_farm_access` is left for stage 4.
