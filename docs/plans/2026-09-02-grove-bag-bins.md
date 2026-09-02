# Grove Bag Bins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give each Grove bag size an on-hand count kept by scanning a card per opened bin, and fire the existing Damon reorder email at a reorder point computed from burn rate, a 75-day lead, and a 2,500 MOQ.

**Architecture:** Two new D1 tables (`kanban_bin_config`, `kanban_bins`), a pure math module, a new handler file `kanban-bins.js` whose actions are mounted in the existing kanban router, a short `/k/<token>` scan route, a Grove panel + bin-card print size in `kanban.html`, and a tile on the Ops Hub. Design: `docs/plans/2026-09-02-grove-bag-bins-design.md`.

**Tech Stack:** Cloudflare Worker (ES modules, D1/SQLite), vanilla JS pages on GitHub Pages, `node --test` for unit tests (`tests/*.test.mjs` only), wrangler for deploy.

**Repo:** `C:\Users\Koasm\Desktop\Dev\rogue-origin-apps`, branch `feat/grove-bag-bins` (design doc already committed). All paths below are relative to that root. Run tests with `npm test`. Deploy the worker with `cd workers && npx wrangler deploy` (never root `npm run deploy`). Front-end ships by pushing `master`.

**Conventions to respect:**
- Worker helpers: `query/queryOne/execute/insert/update` from `workers/src/lib/db.js`; `successResponse/parseBody/getQueryParams` from `lib/response.js`; `createError('VALIDATION_ERROR'|'NOT_FOUND', msg)` from `lib/errors.js`.
- SQLite `datetime('now')` timestamps have no `Z`; append `'Z'` before `new Date()` (see `getAllAnalytics`).
- The card update path is a full-row overwrite, so never add columns to `kanban_cards`.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Migration 0027

**Files:**
- Create: `workers/migrations/0027-kanban-bins.sql`

**Step 1: Write the migration**

```sql
-- Grove bag bins — per-bin scan count for MOQ-constrained bags
-- See docs/plans/2026-09-02-grove-bag-bins-design.md
--
-- Custom Grove bags carry a 2,500 MOQ per size and a ~75-day lead. Bags are
-- split into ~200-bag bins on receipt; each bin gets a card whose QR is scanned
-- when the bin is opened. On-hand = sealed bins. Nothing is added to
-- kanban_cards because updateCard is a full-row overwrite.

CREATE TABLE IF NOT EXISTS kanban_bin_config (
  card_id          INTEGER PRIMARY KEY,
  bags_per_bin     INTEGER NOT NULL DEFAULT 200,
  lead_days        INTEGER NOT NULL DEFAULT 75,
  safety_days      INTEGER NOT NULL DEFAULT 30,
  moq              INTEGER NOT NULL DEFAULT 2500,
  seed_per_month   REAL    NOT NULL,            -- used until >= 3 bins have been opened
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kanban_bins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  bin_no        INTEGER NOT NULL,                -- 1..N within a lot
  lot           TEXT,
  bag_count     INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sealed',  -- sealed | opened | void
  token         TEXT NOT NULL,                   -- 10 chars, in the QR
  received_at   TEXT DEFAULT (datetime('now')),
  received_by   TEXT,
  opened_at     TEXT,
  opened_by     TEXT,
  void_reason   TEXT,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_token ON kanban_bins(token);
CREATE INDEX IF NOT EXISTS idx_kb_card_status ON kanban_bins(card_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_opened ON kanban_bins(card_id, opened_at);
```

**Step 2: Sanity-check the SQL parses**

Run: `cd workers && npx wrangler d1 execute rogue-origin-db --local --file=migrations/0027-kanban-bins.sql`
Expected: three "Executed" statements, no error. (Local only; the remote apply is Task 10.)

**Step 3: Commit**

```bash
git add workers/migrations/0027-kanban-bins.sql
git commit -m "feat(kanban): migration 0027 — bin config + bins tables for Grove bags"
```

---

### Task 2: Pure math module (TDD)

**Files:**
- Create: `workers/src/lib/bag-math.js`
- Test: `tests/bag-math.test.mjs`

**Step 1: Write the failing tests**

```js
/**
 * Unit tests for the Grove bag-bin math. Pure functions only; the D1 side is
 * integration surface (design doc §12).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBagStatus, splitIntoBins, makeBinToken } from '../workers/src/lib/bag-math.js';

const NOW = new Date('2026-09-02T12:00:00Z');
const cfg = { bagsPerBin: 200, leadDays: 75, safetyDays: 30, moq: 2500, seedPerMonth: 600 };

function bins(sealed, opened = []) {
  const out = [];
  for (let i = 0; i < sealed; i++) out.push({ bagCount: 200, status: 'sealed', openedAt: null });
  for (const daysAgo of opened) {
    const d = new Date(NOW.getTime() - daysAgo * 86400000).toISOString();
    out.push({ bagCount: 200, status: 'opened', openedAt: d });
  }
  return out;
}

test('on-hand counts only sealed bins', () => {
  const s = computeBagStatus(cfg, bins(9, [3, 10]), NOW);
  assert.equal(s.onHand, 1800);
  assert.equal(s.binsSealed, 9);
  assert.equal(s.binsOpened, 2);
});

test('rate comes from the seed until three bins have been opened', () => {
  const s = computeBagStatus(cfg, bins(9, [3, 10]), NOW);
  assert.equal(s.rateSource, 'seed');
  assert.ok(Math.abs(s.ratePerDay - 600 / 30.4) < 1e-9);
});

test('rate switches to scans at three opened bins in the trailing 56 days', () => {
  const s = computeBagStatus(cfg, bins(9, [3, 10, 20]), NOW);
  assert.equal(s.rateSource, 'scans');
  assert.ok(Math.abs(s.ratePerDay - 600 / 56) < 1e-9);
});

test('opened bins older than 56 days do not count toward the scan rate', () => {
  const s = computeBagStatus(cfg, bins(9, [3, 10, 70]), NOW);
  assert.equal(s.rateSource, 'seed');
});

test('reorder point is lead + safety days of use', () => {
  const s = computeBagStatus(cfg, bins(20), NOW);
  const rate = 600 / 30.4;
  assert.ok(Math.abs(s.reorderPoint - rate * 105) < 1e-6);
  assert.ok(Math.abs(s.leadDemand - rate * 75) < 1e-6);
});

test('status is order at or below the reorder point', () => {
  assert.equal(computeBagStatus(cfg, bins(10), NOW).status, 'order');   // 2000 <= 2072
  assert.equal(computeBagStatus(cfg, bins(20), NOW).status, 'ok');      // 4000
});

test('status is soon when the order-by date is within 14 days', () => {
  // 11 bins = 2200 on hand; leadDemand ~1480; (2200-1480)/19.7 ≈ 36 d → ok
  assert.equal(computeBagStatus(cfg, bins(11), NOW).status, 'ok');
  // 8 bins = 1600 < reorder point → order, not soon
  assert.equal(computeBagStatus(cfg, bins(8), NOW).status, 'order');
  // A config with no safety: 8 bins 1600, leadDemand 1480 → orderBy in ~6 d → soon
  const s = computeBagStatus({ ...cfg, safetyDays: 0 }, bins(8), NOW);
  assert.equal(s.status, 'soon');
});

test('dates are ISO days and order-by may be in the past', () => {
  const s = computeBagStatus(cfg, bins(2), NOW);
  assert.match(s.runOutDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(s.orderByDate < '2026-09-02');
});

test('suggested qty is the MOQ or ~4 months of use rounded up to 100, whichever is larger', () => {
  assert.equal(computeBagStatus(cfg, bins(20), NOW).suggestedQty, 2500);
  const heavy = { ...cfg, seedPerMonth: 1000, moq: 0 };
  // 1000/30.4*120 = 3947 → 4000
  assert.equal(computeBagStatus(heavy, bins(20), NOW).suggestedQty, 4000);
});

test('zero rate does not divide by zero', () => {
  const s = computeBagStatus({ ...cfg, seedPerMonth: 0 }, bins(5), NOW);
  assert.equal(s.ratePerDay, 0);
  assert.equal(s.runOutDate, null);
  assert.equal(s.orderByDate, null);
  assert.equal(s.status, 'ok');
});

test('splitIntoBins fills full bins then one partial', () => {
  assert.deepEqual(splitIntoBins(2500, 200), [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 100]);
  assert.deepEqual(splitIntoBins(400, 200), [200, 200]);
  assert.deepEqual(splitIntoBins(150, 200), [150]);
  assert.throws(() => splitIntoBins(0, 200));
  assert.throws(() => splitIntoBins(100, 0));
});

test('bin tokens are 10 unambiguous uppercase chars', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = makeBinToken();
    assert.match(t, /^[A-HJ-NP-Z2-9]{10}$/);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
});
```

**Step 2: Run to verify failure**

Run: `node --test tests/bag-math.test.mjs`
Expected: fails with `Cannot find module '../workers/src/lib/bag-math.js'`.

**Step 3: Implement**

```js
/**
 * Grove bag-bin math. Pure — no D1, no Date.now(); the caller passes `now`.
 * See docs/plans/2026-09-02-grove-bag-bins-design.md §4.
 */

const DAYS_PER_MONTH = 30.4;
const RATE_WINDOW_DAYS = 56;
const MIN_SCANS_FOR_RATE = 3;
const SOON_DAYS = 14;
const COVER_MONTHS_FOR_SUGGEST = 4;

const DAY_MS = 86400000;

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{bagsPerBin:number, leadDays:number, safetyDays:number, moq:number, seedPerMonth:number}} cfg
 * @param {Array<{bagCount:number, status:string, openedAt:string|null}>} bins
 * @param {Date} now
 */
export function computeBagStatus(cfg, bins, now) {
  const sealed = bins.filter((b) => b.status === 'sealed');
  const opened = bins.filter((b) => b.status === 'opened' && b.openedAt);
  const onHand = sealed.reduce((s, b) => s + Number(b.bagCount || 0), 0);

  const cutoff = now.getTime() - RATE_WINDOW_DAYS * DAY_MS;
  const recent = opened.filter((b) => new Date(b.openedAt).getTime() >= cutoff);

  let ratePerDay;
  let rateSource;
  if (recent.length >= MIN_SCANS_FOR_RATE) {
    ratePerDay = recent.reduce((s, b) => s + Number(b.bagCount || 0), 0) / RATE_WINDOW_DAYS;
    rateSource = 'scans';
  } else {
    ratePerDay = Number(cfg.seedPerMonth || 0) / DAYS_PER_MONTH;
    rateSource = 'seed';
  }

  const leadDemand = ratePerDay * cfg.leadDays;
  const reorderPoint = ratePerDay * (cfg.leadDays + cfg.safetyDays);

  let runOutDate = null;
  let orderByDate = null;
  let daysToOrderBy = null;
  if (ratePerDay > 0) {
    runOutDate = isoDay(new Date(now.getTime() + (onHand / ratePerDay) * DAY_MS));
    daysToOrderBy = (onHand - leadDemand) / ratePerDay;
    orderByDate = isoDay(new Date(now.getTime() + daysToOrderBy * DAY_MS));
  }

  const coverBags = ratePerDay * DAYS_PER_MONTH * COVER_MONTHS_FOR_SUGGEST;
  const suggestedQty = Math.max(Number(cfg.moq || 0), Math.ceil(coverBags / 100) * 100);

  let status = 'ok';
  if (ratePerDay > 0) {
    if (onHand <= reorderPoint) status = 'order';
    else if (daysToOrderBy <= SOON_DAYS) status = 'soon';
  }

  return {
    onHand,
    binsSealed: sealed.length,
    binsOpened: opened.length,
    ratePerDay,
    ratePerWeek: ratePerDay * 7,
    rateSource,
    leadDemand,
    reorderPoint,
    weeksOfCover: ratePerDay > 0 ? onHand / ratePerDay / 7 : null,
    runOutDate,
    orderByDate,
    suggestedQty,
    status,
  };
}

/** Split a received bag count into bin sizes: full bins, then one partial. */
export function splitIntoBins(bags, bagsPerBin) {
  bags = Math.floor(Number(bags));
  bagsPerBin = Math.floor(Number(bagsPerBin));
  if (!(bags > 0)) throw new Error('bags must be a positive integer');
  if (!(bagsPerBin > 0)) throw new Error('bagsPerBin must be a positive integer');
  const out = [];
  let left = bags;
  while (left > 0) {
    const n = Math.min(bagsPerBin, left);
    out.push(n);
    left -= n;
  }
  return out;
}

// No 0/O/1/I so a token can be read back off a card by eye if a QR is damaged.
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeBinToken() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}
```

**Step 4: Run tests**

Run: `node --test tests/bag-math.test.mjs`
Expected: 12 passing. If the `soon` test fails, print `computeBagStatus({...cfg, safetyDays:0}, bins(8), NOW)` and check `daysToOrderBy` — the numbers in the test comments are the spec; fix the code, not the test.

**Step 5: Commit**

```bash
git add workers/src/lib/bag-math.js tests/bag-math.test.mjs
git commit -m "feat(kanban): pure bag-bin math — on-hand, burn rate, reorder point, order-by"
```

---

### Task 3: Email body with bag facts (TDD)

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js:551-568` (`buildReorderEmailBody`)
- Test: `tests/reorder-email-body.test.mjs` (append)

**Step 1: Append failing tests**

```js
// --- bag-bin facts (design 2026-09-02 §9) --------------------------------

const bag = {
  onHand: 1800, binsSealed: 9, ratePerWeek: 140, rateSource: 'scans',
  runOutDate: '2026-11-20', orderByDate: '2026-09-15', leadDays: 75,
  suggestedQty: 2500, moq: 2500,
};

test('bag facts lead the body when supplied', () => {
  const body = buildReorderEmailBody(card, url, bag);
  assert.match(body, /reorder point reached/);
  assert.match(body, /On hand:\s+1,800 bags \(9 sealed bins\)/);
  assert.match(body, /Using:\s+~140 \/ week \(from bin scans\)/);
  assert.match(body, /Runs out:\s+~2026-11-20/);
  assert.match(body, /Lead time:\s+75 days\s+→\s+order by 2026-09-15/);
  assert.match(body, /Suggest:\s+2,500 \(MOQ\)/);
  assert.ok(body.indexOf('On hand') < body.indexOf('Location'), 'numbers come before the card facts');
});

test('seed-rate facts say so, and no-MOQ cards do not claim one', () => {
  const body = buildReorderEmailBody(card, url, { ...bag, rateSource: 'seed', moq: 0, suggestedQty: 400 });
  assert.match(body, /\(estimated from sales\)/);
  assert.match(body, /Suggest:\s+400 ≈ 4 months of cover/);
  assert.doesNotMatch(body, /MOQ/);
});

test('two-argument form is unchanged', () => {
  assert.doesNotMatch(buildReorderEmailBody(card, url), /On hand/);
});
```

Check the top of the existing test file for the names of the fixture card and URL variables (`card`, `url` or similar) and use those names.

**Step 2: Run to verify failure**

Run: `node --test tests/reorder-email-body.test.mjs`
Expected: the three new tests fail (`On hand` not found).

**Step 3: Implement**

Replace `buildReorderEmailBody` with:

```js
export function buildReorderEmailBody(card, confirmUrl, bag = null) {
  const facts = [
    ['Item', card.item],
    ['Order', card.order_qty],
    ['Location', card.crumbtrail],
    ['Supplier', card.supplier],
  ].filter(([, v]) => v);

  const intro = bag
    ? `${card.item} — reorder point reached.\n\n${bagFactsBlock(bag)}\n\n`
    : `${card.item} was flagged for reorder in the supply closet.\n\n`;

  return (
    intro +
    facts.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nOnce you've placed the order, mark it done here:\n${confirmUrl}\n\n` +
    `Until then, re-scanning this card won't send another email.\n\n` +
    `— Rogue Origin supply kanban`
  );
}

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/** The numbers Damon needs against an MOQ, aligned in a fixed-width block. */
function bagFactsBlock(bag) {
  const rateNote = bag.rateSource === 'scans' ? 'from bin scans' : 'estimated from sales';
  const suggest = bag.moq > 0 && bag.suggestedQty <= bag.moq
    ? `${fmtInt(bag.suggestedQty)} (MOQ)`
    : `${fmtInt(bag.suggestedQty)} ≈ 4 months of cover`;
  const rows = [
    ['On hand:', `${fmtInt(bag.onHand)} bags (${bag.binsSealed} sealed bins)`],
    ['Using:', `~${fmtInt(bag.ratePerWeek)} / week (${rateNote})`],
    ['Runs out:', bag.runOutDate ? `~${bag.runOutDate}` : 'unknown'],
    ['Lead time:', `${bag.leadDays} days  →  order by ${bag.orderByDate || 'now'}`],
    ['Suggest:', suggest],
  ];
  return rows.map(([k, v]) => k.padEnd(14) + v).join('\n');
}
```

Note the MOQ suggest line: when `suggestedQty` equals the MOQ, say `(MOQ)`; when the 4-month cover exceeds the MOQ it prints the larger number with `≈ 4 months of cover`. Adjust the second new test if you decide on different wording, but keep the two facts distinguishable.

**Step 4: Run all tests**

Run: `npm test`
Expected: all pass (existing 6 + 3 new in this file, plus the rest).

**Step 5: Commit**

```bash
git add workers/src/handlers/kanban-d1.js tests/reorder-email-body.test.mjs
git commit -m "feat(kanban): reorder email carries on-hand, burn rate, order-by, suggested qty"
```

---

### Task 4: Let `raiseReorderRequest` carry bag facts, and log Grove orders on close

**Files:**
- Modify: `workers/src/handlers/kanban-d1.js` — `raiseReorderRequest` (~472), `notifyReorderHandler` (~572), `closeReorderRequest` (~634)

**Step 1: Thread `bag` through**

- `async function raiseReorderRequest(card, env, ctx, bag = null)` — pass `bag` to both `notifyReorderHandler(...)` calls (retry path and create path).
- `async function notifyReorderHandler(env, card, requestId, closeToken, bag = null)` — `text: buildReorderEmailBody(card, confirmUrl, bag)`.
- Export `raiseReorderRequest` (add `export` in front) so `kanban-bins.js` can call it.

**Step 2: Write a `kanban_orders` row on close**

In `closeReorderRequest`, after the `update(...)` that sets `status: 'ordered'`, add:

```js
  // Grove never passes through the Friday cart, so until now closing a request
  // left kanban_orders untouched and every Grove card read orderCount: 0 in
  // analytics. Record the order here so cadence works for this lane too.
  const card = await queryOne(
    env.DB,
    `SELECT k.id, k.item, k.supplier, k.order_qty AS orderQty
       FROM kanban_reorder_requests r JOIN kanban_cards k ON k.id = r.card_id
      WHERE r.id = ?`,
    [row.id]
  );
  if (card) {
    const qty = body.qty ? Math.max(1, Math.floor(Number(body.qty))) : 1;
    await insert(env.DB, 'kanban_orders', {
      vendor: card.supplier || 'Grove',
      placed_by: body.closedBy ? String(body.closedBy).slice(0, 100) : 'email-link',
      items_json: JSON.stringify([{ cardId: card.id, item: card.item, qty }]),
    });
  }
```

**Step 3: Run tests**

Run: `npm test`
Expected: all pass (no behaviour under test changed).

**Step 4: Commit**

```bash
git add workers/src/handlers/kanban-d1.js
git commit -m "feat(kanban): reorder request accepts bag facts; closing a Grove request logs the order"
```

---

### Task 5: Bin handlers + router wiring

**Files:**
- Create: `workers/src/handlers/kanban-bins.js`
- Modify: `workers/src/handlers/kanban-d1.js` router (~970–993) and imports (top of file)

**Step 1: Write the handler module**

```js
/**
 * Grove bag bins — receive, open (scan), void, status.
 * Design: docs/plans/2026-09-02-grove-bag-bins-design.md
 *
 * Mounted inside the /api/kanban router (see kanban-d1.js) so the front-end
 * keeps one API_URL. The scan target /k/<token> is served by handleBinScan.
 */
import { query, queryOne, insert, update, transaction } from '../lib/db.js';
import { successResponse, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { computeBagStatus, splitIntoBins, makeBinToken } from '../lib/bag-math.js';

const PUBLIC_BASE = (env) => env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

function rowToCfg(r) {
  return {
    cardId: r.card_id,
    bagsPerBin: r.bags_per_bin,
    leadDays: r.lead_days,
    safetyDays: r.safety_days,
    moq: r.moq,
    seedPerMonth: r.seed_per_month,
  };
}

function rowToBin(b) {
  return {
    id: b.id, cardId: b.card_id, binNo: b.bin_no, lot: b.lot, bagCount: b.bag_count,
    status: b.status, token: b.token,
    receivedAt: b.received_at ? b.received_at + (b.received_at.endsWith('Z') ? '' : 'Z') : null,
    receivedBy: b.received_by,
    openedAt: b.opened_at ? b.opened_at + (b.opened_at.endsWith('Z') ? '' : 'Z') : null,
    openedBy: b.opened_by, voidReason: b.void_reason,
  };
}

async function loadCfg(env, cardId) {
  const r = await queryOne(env.DB, 'SELECT * FROM kanban_bin_config WHERE card_id = ?', [cardId]);
  return r ? rowToCfg(r) : null;
}

async function loadBins(env, cardId) {
  const rows = await query(env.DB, 'SELECT * FROM kanban_bins WHERE card_id = ? ORDER BY lot, bin_no', [cardId]);
  return rows.map(rowToBin);
}

/** Full status object for one card: config + math + bins + open request. */
export async function statusForCard(env, card, now = new Date()) {
  const cfg = await loadCfg(env, card.id);
  if (!cfg) return null;
  const bins = await loadBins(env, card.id);
  const math = computeBagStatus(cfg, bins, now);
  const open = await queryOne(
    env.DB,
    `SELECT id, requested_at AS requestedAt, notify_state AS notifyState
       FROM kanban_reorder_requests WHERE card_id = ? AND status = 'open'`,
    [card.id]
  );
  return {
    cardId: card.id,
    item: card.item,
    crumbtrail: card.crumbtrail || '',
    config: cfg,
    ...math,
    openRequest: open ? { ...open, requestedAt: open.requestedAt + 'Z' } : null,
    bins,
  };
}

/** GET ?action=getBagStatus[&cardId=] */
export async function getBagStatus(request, env) {
  const { cardId } = getQueryParams(request);
  const where = cardId ? 'WHERE k.id = ?' : '';
  const cards = await query(
    env.DB,
    `SELECT k.id, k.item, k.supplier, k.crumbtrail
       FROM kanban_cards k JOIN kanban_bin_config c ON c.card_id = k.id ${where}
      ORDER BY k.item`,
    cardId ? [Number(cardId)] : []
  );
  const out = [];
  for (const c of cards) out.push(await statusForCard(env, c));
  return successResponse({ success: true, cards: out, count: out.length });
}

/** GET ?action=getBins&cardId=&status=sealed|opened|void|all */
export async function getBins(request, env) {
  const { cardId, status = 'all', lot } = getQueryParams(request);
  if (!cardId) throw createError('VALIDATION_ERROR', 'cardId is required');
  let bins = await loadBins(env, Number(cardId));
  if (status !== 'all') bins = bins.filter((b) => b.status === status);
  if (lot) bins = bins.filter((b) => b.lot === lot);
  return successResponse({ success: true, bins, count: bins.length });
}

/** POST ?action=setBinConfig {cardId, bagsPerBin?, leadDays?, safetyDays?, moq?, seedPerMonth?} */
export async function setBinConfig(body, env) {
  const cardId = Number(body.cardId);
  if (!cardId) throw createError('VALIDATION_ERROR', 'cardId is required');
  const card = await queryOne(env.DB, 'SELECT id FROM kanban_cards WHERE id = ?', [cardId]);
  if (!card) throw createError('NOT_FOUND', `Card ${cardId} not found`);

  const num = (v, name, min) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw createError('VALIDATION_ERROR', `${name} must be a number >= ${min}`);
    return n;
  };
  const patch = {
    bags_per_bin: num(body.bagsPerBin, 'bagsPerBin', 1),
    lead_days: num(body.leadDays, 'leadDays', 0),
    safety_days: num(body.safetyDays, 'safetyDays', 0),
    moq: num(body.moq, 'moq', 0),
    seed_per_month: num(body.seedPerMonth, 'seedPerMonth', 0),
  };
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  const existing = await loadCfg(env, cardId);
  if (existing) {
    if (Object.keys(patch).length) {
      await update(env.DB, 'kanban_bin_config', { ...patch, updated_at: new Date().toISOString() }, 'card_id = ?', [cardId]);
    }
  } else {
    if (patch.seed_per_month === undefined) throw createError('VALIDATION_ERROR', 'seedPerMonth is required for a new config');
    await insert(env.DB, 'kanban_bin_config', { card_id: cardId, ...patch });
  }
  return successResponse({ success: true, config: await loadCfg(env, cardId) });
}

/** POST ?action=receiveBins {cardId, bags, bagsPerBin?, lot?, receivedBy?} */
export async function receiveBins(body, env) {
  const cardId = Number(body.cardId);
  if (!cardId) throw createError('VALIDATION_ERROR', 'cardId is required');
  const cfg = await loadCfg(env, cardId);
  if (!cfg) throw createError('VALIDATION_ERROR', `Card ${cardId} has no bin config — set it first`);

  const bagsPerBin = body.bagsPerBin ? Number(body.bagsPerBin) : cfg.bagsPerBin;
  let sizes;
  try { sizes = splitIntoBins(body.bags, bagsPerBin); }
  catch (e) { throw createError('VALIDATION_ERROR', e.message); }
  if (sizes.length > 100) throw createError('VALIDATION_ERROR', 'That would create more than 100 bins');

  const lot = body.lot ? String(body.lot).slice(0, 80) : new Date().toISOString().slice(0, 10);
  const receivedBy = body.receivedBy ? String(body.receivedBy).slice(0, 100) : null;

  const statements = sizes.map((n, i) => ({
    sql: 'INSERT INTO kanban_bins (card_id, bin_no, lot, bag_count, token, received_by) VALUES (?, ?, ?, ?, ?, ?)',
    params: [cardId, i + 1, lot, n, makeBinToken(), receivedBy],
  }));
  await transaction(env.DB, statements);

  const bins = (await loadBins(env, cardId)).filter((b) => b.lot === lot);
  return successResponse({ success: true, lot, bins, count: bins.length });
}

/** POST ?action=voidBin {binId, reason} */
export async function voidBin(body, env) {
  const binId = Number(body.binId);
  if (!binId) throw createError('VALIDATION_ERROR', 'binId is required');
  const reason = body.reason ? String(body.reason).slice(0, 200) : null;
  const row = await queryOne(env.DB, 'SELECT id, status FROM kanban_bins WHERE id = ?', [binId]);
  if (!row) throw createError('NOT_FOUND', 'Bin not found');
  if (row.status === 'void') return successResponse({ success: true, alreadyVoid: true });
  await update(env.DB, 'kanban_bins', { status: 'void', void_reason: reason }, 'id = ?', [binId]);
  return successResponse({ success: true, alreadyVoid: false });
}

/**
 * POST ?action=openBin {token, openedBy?}
 * Idempotent per bin. After opening, recompute and raise the reorder request
 * if on-hand is at or below the reorder point. `raise` is injected so this
 * module does not import kanban-d1.js (which imports this one).
 */
export async function openBin(body, env, ctx, raise) {
  const token = String(body.token || '').trim().toUpperCase();
  if (!token) throw createError('VALIDATION_ERROR', 'token is required');

  const bin = await queryOne(env.DB, 'SELECT * FROM kanban_bins WHERE token = ?', [token]);
  if (!bin) throw createError('NOT_FOUND', 'Bin not recognised');
  const card = await queryOne(
    env.DB,
    'SELECT id, item, supplier, order_qty, crumbtrail FROM kanban_cards WHERE id = ?',
    [bin.card_id]
  );

  let outcome;
  if (bin.status === 'void') outcome = 'void';
  else if (bin.status === 'opened') outcome = 'already_open';
  else {
    await update(
      env.DB, 'kanban_bins',
      { status: 'opened', opened_at: new Date().toISOString(), opened_by: body.openedBy ? String(body.openedBy).slice(0, 100) : null },
      'id = ? AND status = ?', [bin.id, 'sealed']
    );
    outcome = 'opened';
  }

  const status = await statusForCard(env, card);
  let request = null;
  if (outcome === 'opened' && status.status === 'order' && !status.openRequest) {
    const bag = {
      onHand: status.onHand, binsSealed: status.binsSealed, ratePerWeek: status.ratePerWeek,
      rateSource: status.rateSource, runOutDate: status.runOutDate, orderByDate: status.orderByDate,
      leadDays: status.config.leadDays, suggestedQty: status.suggestedQty, moq: status.config.moq,
    };
    const res = await raise(card, env, ctx, bag);
    request = (await res.json()).request || null;
    status.openRequest = request ? { id: request.id, requestedAt: request.requestedAt, notifyState: 'pending' } : null;
  }

  return successResponse({
    success: true,
    outcome,
    bin: rowToBin({ ...bin, status: outcome === 'opened' ? 'opened' : bin.status }),
    card: { id: card.id, item: card.item, crumbtrail: card.crumbtrail },
    status: { onHand: status.onHand, binsSealed: status.binsSealed, weeksOfCover: status.weeksOfCover, status: status.status, orderByDate: status.orderByDate, openRequest: status.openRequest },
    requestRaised: Boolean(request),
  });
}

/** Build the /k/<token> URL a bin card's QR encodes. */
export function binScanUrl(env, token) {
  return `${PUBLIC_BASE(env)}/k/${token}`;
}

// ---------------------------------------------------------------- /k/<token>

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * GET /k/<token> — the bin card's QR target. Serves a page that POSTs openBin
 * and shows the result. GET itself changes nothing (same rule as the email
 * link); the phone's browser does the write.
 */
export async function handleBinScan(request, env) {
  const url = new URL(request.url);
  const token = url.pathname.replace(/^\/k\//, '').trim().toUpperCase().slice(0, 10);
  const api = `${PUBLIC_BASE(env)}/api/kanban?action=openBin`;
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bin opened</title><style>` +
    `body{font-family:system-ui,sans-serif;background:#faf8f5;color:#1f2a20;margin:0;padding:24px;display:flex;min-height:100vh;align-items:center;justify-content:center}` +
    `.card{background:#fff;border:1px solid #e2ddd3;border-radius:14px;padding:28px;max-width:420px;width:100%;text-align:center}` +
    `h1{font-size:22px;margin:0 0 8px}.big{font-size:44px;font-weight:800;margin:12px 0 4px}.sub{color:#5f6b60}` +
    `.ok{color:#3e7a4e}.warn{color:#bd4a28}.muted{color:#8f9263;font-size:13px;margin-top:16px}` +
    `</style></head><body><div class="card" id="c"><h1>Opening bin…</h1><div class="sub">Token ${esc(token)}</div></div>` +
    `<script>(function(){var c=document.getElementById('c');` +
    `fetch(${JSON.stringify(api)},{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:${JSON.stringify(token)}})})` +
    `.then(function(r){return r.json()}).then(function(r){var d=r.data||r;if(!d.success){c.innerHTML='<h1 class=warn>'+(d.error||'Scan failed')+'</h1>';return;}` +
    `var s=d.status,o=d.outcome,h='';` +
    `if(o==='void'){h='<h1 class=warn>This bin was voided</h1>';}` +
    `else{h='<h1>'+d.card.item+'</h1><div class=sub>'+(o==='opened'?'Bin '+d.bin.binNo+' opened':'Bin '+d.bin.binNo+' was already opened '+(d.bin.openedAt||'').slice(0,10))+'</div>';` +
    `h+='<div class=big>'+s.binsSealed+' bin'+(s.binsSealed===1?'':'s')+' left</div><div class=sub>~'+s.onHand.toLocaleString()+' bags'+(s.weeksOfCover!=null?' · ~'+Math.round(s.weeksOfCover)+' weeks of cover':'')+'</div>';` +
    `if(d.requestRaised)h+='<div class="sub warn" style="margin-top:12px">Reorder request sent to Damon.</div>';` +
    `else if(s.openRequest)h+='<div class="sub warn" style="margin-top:12px">Reorder already requested '+(s.openRequest.requestedAt||'').slice(0,10)+'.</div>';` +
    `else if(s.status==='soon')h+='<div class="sub warn" style="margin-top:12px">Order by '+s.orderByDate+'.</div>';}` +
    `h+='<div class=muted>You can close this page.</div>';c.innerHTML=h;})` +
    `.catch(function(e){c.innerHTML='<h1 class=warn>Could not reach the server</h1><div class=sub>'+e.message+'</div>';});})();</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
```

Note on `openBin`'s `raise` argument: `raiseReorderRequest` returns a `Response` (via `successResponse`), so the code reads it back with `res.json()`. Check `successResponse` in `lib/response.js:27` — if it wraps the payload as `{ success, data }`, use `(await res.json()).data.request`. Verify before assuming.

**Step 2: Wire the router**

In `kanban-d1.js`, add the import near the top:

```js
import { getBagStatus, getBins, setBinConfig, receiveBins, voidBin, openBin } from './kanban-bins.js';
```

and in the `actions` object add, after the reorder entries:

```js
    // Grove bag bins — see design doc 2026-09-02
    getBagStatus: () => getBagStatus(request, env),
    getBins: () => getBins(request, env),
    setBinConfig: () => setBinConfig(body, env),
    receiveBins: () => receiveBins(body, env),
    voidBin: () => voidBin(body, env),
    openBin: () => openBin(body, env, ctx, raiseReorderRequest),
```

**Step 3: Route `/k/`**

In `workers/src/index.js`, import `handleBinScan` from `./handlers/kanban-bins.js` and add, next to the `/z/` branch:

```js
      } else if (path.startsWith('/k/')) {
        // Grove bin-card QR target — short so the QR on a bag-bin card stays
        // low-version. See docs/plans/2026-09-02-grove-bag-bins-design.md
        response = await handleBinScan(request, env, ctx);
```

**Step 4: Local smoke test**

Run: `cd workers && npx wrangler dev` (in a second terminal) then:

```bash
curl -s "http://localhost:8787/api/kanban?action=getBagStatus"
```
Expected: `{"success":true,"cards":[],"count":0}` (local DB has the tables from Task 1 but no config). If the local D1 has no `kanban_cards`, `setBinConfig` will 404 — that is fine; production is the real test in Task 10.

Also: `curl -s http://localhost:8787/k/ABCDEFGHJK | head -c 200` — expect an HTML page.

**Step 5: Lint + tests**

Run: `npm run lint && npm test`
Expected: clean, all pass.

**Step 6: Commit**

```bash
git add workers/src/handlers/kanban-bins.js workers/src/handlers/kanban-d1.js workers/src/index.js
git commit -m "feat(kanban): bin handlers — receive, open (scan), void, status; /k/ scan route"
```

---

### Task 6: Bin card print size in `kanban.html`

**Files:**
- Modify: `src/pages/kanban.html` — `cardHtml` (~1650), `getPrintCSS` (~2214), add `printBinCards()`

**Step 1: Add a `bin` branch to `cardHtml`**

Immediately before the `if (size === 'full')` branch add:

```js
  // Bin card (8.5x11): one per ~200-bag bin of Grove bags. QR opens /k/<token>.
  // c must carry: item, crumbtrail, bin {binNo, binCount, bagCount, lot, token, scanUrl}
  if (size === 'bin') {
    var b = c.bin;
    var bqr = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=' + encodeURIComponent(b.scanUrl);
    return '<div class="kanban full-card bin-card neutral"><div class="kanban-border"></div><div class="kanban-inner"></div>' +
      '<div class="full-content">' +
      '<div class="full-header"><h3>' + esc(c.item) + '</h3></div>' +
      '<div class="full-loc">' + esc(c.crumbtrail || '') + '</div>' +
      '<div class="bin-no">BIN ' + b.binNo + ' <small>of ' + b.binCount + '</small></div>' +
      '<div class="bin-meta">' + b.bagCount + ' bags · lot ' + esc(b.lot || '') + '</div>' +
      '<div class="bin-qr"><img src="' + bqr + '"></div>' +
      '<div class="bin-scan">SCAN WHEN YOU OPEN THIS BIN<br><span>ESCANEA AL ABRIR ESTE CONTENEDOR</span></div>' +
      '<div class="bin-token">' + esc(b.token) + '</div>' +
      '</div><img class="kanban-logo" src="' + logoUrl + '"></div>';
  }
```

**Step 2: Add `bin` CSS to `getPrintCSS`**

Add a branch `else if (size === 'bin')` that returns the same string as the `full` branch (copy it) with these additions appended before the closing quote:

```js
      '.kanban.full-card.neutral{background:#faf8f5 !important;color:#1f2a20 !important}' +
      '.bin-no{font-size:96px;font-weight:900;line-height:1;margin:10px 0 4px}.bin-no small{font-size:36px;font-weight:700}' +
      '.bin-meta{font-size:28px;font-weight:700;margin-bottom:24px}' +
      '.bin-qr{background:#fff;border:6px solid #e4aa4f;border-radius:14px;width:4.6in;height:4.6in;display:flex;align-items:center;justify-content:center;margin-bottom:20px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.bin-qr img{width:94%;height:94%}' +
      '.bin-scan{text-align:center;text-transform:uppercase;font-weight:800;font-size:30px;line-height:1.2}.bin-scan span{font-size:20px;font-weight:600;opacity:.8}' +
      '.bin-token{margin-top:auto;font-family:ui-monospace,monospace;font-size:20px;letter-spacing:4px;opacity:.7}' +
```

Simplest approach: in the `full` branch, change the condition to `size === 'full' || size === 'bin'` and append the bin rules to that same string — they are inert for `full`.

**Step 3: Add `printBinCards`**

Next to `printOneCard`:

```js
// Print one full-sheet card per bin. bins: [{binNo, bagCount, lot, token, scanUrl}], card: the kanban card.
function printBinCards(card, bins) {
  var pages = bins.map(function(b, i) {
    var c = { item: card.item, crumbtrail: card.crumbtrail, bin: { binNo: b.binNo, binCount: bins.length, bagCount: b.bagCount, lot: b.lot, token: b.token, scanUrl: b.scanUrl } };
    return '<div class="page"><div class="page-inner">' + cardHtml(c, 'neutral', 'front', 'bin') + '</div></div>';
  });
  var html = '<!DOCTYPE html><html><head><title>Bin Cards</title><style>' + getPrintCSS('bin') + '</style></head><body>' +
    '<div class="no-print"><button onclick="window.print()" style="background:#668971;color:#fff">Print</button>' +
    '<button onclick="window.close()" style="background:#62758d;color:#fff">Close</button>' +
    '<span style="margin-left:12px;color:#8f9263">' + pages.length + ' page(s) • BIN CARDS</span></div>' +
    '<div class="print-wrapper" style="padding-top:50px">' + pages.join('') + '</div></body></html>';
  var win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}
```

**Step 4: Verify in the browser**

Open `src/pages/kanban.html` via the project's dev server (see `.claude/launch.json` or `npm run preview` notes), open the console and run:

```js
printBinCards({item:'Custom 1 Oz Bags', crumbtrail:'Grove Rack > A-1'}, [{binNo:1,bagCount:200,lot:'test',token:'ABCDEFGHJK',scanUrl:'https://rogue-origin-api.roguefamilyfarms.workers.dev/k/ABCDEFGHJK'}])
```

Expected: a print window with one page, big "BIN 1 of 1", a large QR, the bilingual scan line. Screenshot it.

**Step 5: Commit**

```bash
git add src/pages/kanban.html
git commit -m "feat(kanban): full-sheet bin card print size for Grove bag bins"
```

---

### Task 7: Grove panel in `kanban.html`

**Files:**
- Modify: `src/pages/kanban.html` — HTML after `supplierTabs` (~line 61–88), JS after `setSupplierTab`, a few CSS rules in the page `<style>`

**Step 1: Mount point**

Just above `<div id="gridView" ...>` (~line 88) add:

```html
    <section id="grovePanel" class="grove-panel" style="display:none"></section>
```

Page CSS (add near the other `.supplier-tab` rules):

```css
.grove-panel{margin:0 0 16px;padding:14px 16px;border:1px solid #e2ddd3;border-radius:12px;background:#fff}
.grove-panel h2{font-size:15px;margin:0 0 10px;display:flex;align-items:center;gap:10px}
.grove-row{display:grid;grid-template-columns:1.4fr repeat(5,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #f0ece4;font-size:13px}
.grove-row:first-of-type{border-top:0}
.grove-row b{font-size:14px}
.grove-row small{display:block;color:#8f9263;font-size:11px}
.grove-pill{padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;text-transform:uppercase}
.grove-pill.ok{background:#e4efe6;color:#3e7a4e}.grove-pill.soon{background:#fbeccf;color:#9a6a12}.grove-pill.order{background:#f6d9cf;color:#bd4a28}
.grove-actions button{margin-left:4px}
@media (max-width:800px){.grove-row{grid-template-columns:1fr 1fr;font-size:12px}}
```

**Step 2: Render logic**

```js
// ---------------------------------------------------------------- Grove bag bins
var groveStatus = null;

function loadGrovePanel() {
  fetch(API_URL + '?action=getBagStatus')
    .then(function(r) { return r.json(); })
    .then(function(r) { groveStatus = r.cards || []; renderGrovePanel(); })
    .catch(function() { groveStatus = null; renderGrovePanel(); });
}

function grovePanelVisible() {
  return activeSupplierFilter.toLowerCase() === 'grove' || new URLSearchParams(location.search).get('panel') === 'grove';
}

function renderGrovePanel() {
  var el = document.getElementById('grovePanel');
  if (!grovePanelVisible()) { el.style.display = 'none'; return; }
  el.style.display = '';
  if (!groveStatus) { el.innerHTML = '<h2>Grove bags</h2><div class="muted">Bin status unavailable.</div>'; return; }
  var rows = groveStatus.map(function(s) {
    var rate = s.ratePerWeek ? Math.round(s.ratePerWeek) + '/wk <small>' + (s.rateSource === 'scans' ? 'from scans' : 'seed rate') + '</small>' : '—';
    var cover = s.weeksOfCover != null ? s.weeksOfCover.toFixed(1) + ' wk' : '—';
    var req = s.openRequest ? '<small>requested ' + fmtReqDate(s.openRequest.requestedAt) + ' · ' + esc(s.openRequest.notifyState) + '</small>' : '';
    return '<div class="grove-row">' +
      '<div><b>' + esc(s.item) + '</b><small>' + esc(s.crumbtrail) + '</small></div>' +
      '<div>' + s.binsSealed + ' sealed<small>' + s.binsOpened + ' opened</small></div>' +
      '<div><b>' + s.onHand.toLocaleString() + '</b><small>on hand</small></div>' +
      '<div>' + rate + '</div>' +
      '<div>' + cover + '<small>reorder at ' + Math.round(s.reorderPoint).toLocaleString() + '</small></div>' +
      '<div><span class="grove-pill ' + s.status + '">' + s.status + '</span><small>' + (s.orderByDate ? 'order by ' + s.orderByDate : '') + '</small>' + req + '</div>' +
      '<div class="grove-actions">' +
        '<button class="btn small" onclick="groveReceive(' + s.cardId + ')">Receive</button>' +
        '<button class="btn small" onclick="grovePrint(' + s.cardId + ')">Print cards</button>' +
        '<button class="btn small" onclick="groveVoid(' + s.cardId + ')">Void bin</button>' +
        '<button class="btn small" onclick="groveSettings(' + s.cardId + ')">Settings</button>' +
      '</div></div>';
  });
  el.innerHTML = '<h2>Grove bags <small class="muted">scan a bin card when you open it</small></h2>' + (rows.join('') || '<div class="muted">No bin-tracked cards yet — use Settings on a Grove card.</div>');
}

function grovePost(action, payload) {
  return fetch(API_URL + '?action=' + action, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
    .then(function(r) { return r.json(); })
    .then(function(r) { if (!r.success) throw new Error(r.error || action + ' failed'); return r; });
}

function groveReceive(cardId) {
  var s = groveStatus.filter(function(x) { return x.cardId === cardId; })[0];
  var bags = prompt('How many bags arrived for ' + s.item + '?');
  if (!bags) return;
  var per = prompt('Bags per bin?', s.config.bagsPerBin);
  if (!per) return;
  var lot = prompt('Lot / order reference (optional)', new Date().toISOString().slice(0, 10)) || '';
  grovePost('receiveBins', { cardId: cardId, bags: Number(bags), bagsPerBin: Number(per), lot: lot })
    .then(function(r) {
      toast('Created ' + r.count + ' bins for ' + s.item, 'ok');
      loadGrovePanel();
      if (confirm('Print ' + r.count + ' bin cards now?')) openBinPrint(s, r.bins);
    })
    .catch(function(e) { toast(e.message, 'err'); });
}

function openBinPrint(s, bins) {
  var base = API_URL.replace(/\/api\/kanban$/, '');
  printBinCards({ item: s.item, crumbtrail: s.crumbtrail }, bins.map(function(b) {
    return { binNo: b.binNo, bagCount: b.bagCount, lot: b.lot, token: b.token, scanUrl: base + '/k/' + b.token };
  }));
}

function grovePrint(cardId) {
  var s = groveStatus.filter(function(x) { return x.cardId === cardId; })[0];
  var lots = {};
  s.bins.forEach(function(b) { if (b.status === 'sealed') lots[b.lot] = (lots[b.lot] || 0) + 1; });
  var names = Object.keys(lots);
  if (!names.length) { toast('No sealed bins to print', 'err'); return; }
  var lot = names.length === 1 ? names[0] : prompt('Which lot? ' + names.map(function(n) { return n + ' (' + lots[n] + ')'; }).join(', '), names[names.length - 1]);
  if (!lot) return;
  openBinPrint(s, s.bins.filter(function(b) { return b.status === 'sealed' && b.lot === lot; }));
}

function groveVoid(cardId) {
  var s = groveStatus.filter(function(x) { return x.cardId === cardId; })[0];
  var sealed = s.bins.filter(function(b) { return b.status === 'sealed'; });
  if (!sealed.length) { toast('No sealed bins', 'err'); return; }
  var token = prompt('Token printed on the bin card to void (' + sealed.length + ' sealed):');
  if (!token) return;
  var bin = sealed.filter(function(b) { return b.token === token.trim().toUpperCase(); })[0];
  if (!bin) { toast('No sealed bin with that token', 'err'); return; }
  var reason = prompt('Reason?', 'damaged') || '';
  grovePost('voidBin', { binId: bin.id, reason: reason })
    .then(function() { toast('Bin ' + bin.binNo + ' voided', 'ok'); loadGrovePanel(); })
    .catch(function(e) { toast(e.message, 'err'); });
}

function groveSettings(cardId) {
  var s = groveStatus.filter(function(x) { return x.cardId === cardId; })[0];
  var c = s.config;
  var seed = prompt('Seed usage (bags per month, used until 3 bins are scanned)', c.seedPerMonth); if (seed === null) return;
  var lead = prompt('Lead time (days)', c.leadDays); if (lead === null) return;
  var safety = prompt('Safety buffer (days)', c.safetyDays); if (safety === null) return;
  var moq = prompt('MOQ (0 = none)', c.moq); if (moq === null) return;
  var per = prompt('Bags per bin', c.bagsPerBin); if (per === null) return;
  grovePost('setBinConfig', { cardId: cardId, seedPerMonth: seed, leadDays: lead, safetyDays: safety, moq: moq, bagsPerBin: per })
    .then(function() { toast('Settings saved', 'ok'); loadGrovePanel(); })
    .catch(function(e) { toast(e.message, 'err'); });
}
```

`prompt()`/`confirm()` are deliberate: the page already uses them elsewhere and the panel is used a few times a season. Do not build modals for this.

**Step 3: Hook it in**

- In `onLoad` (~line 913) after `loadAnalytics();` add `loadGrovePanel();`.
- At the end of `setSupplierTab` (~978) add `renderGrovePanel();`.
- In `handleFlagParam` or right after `onLoad`, if `?panel=grove` is present, call `setSupplierTab('Grove')` so the tab and panel both show.

**Step 4: Verify in the browser**

Load the page against production (`API_URL` is already production). Click the Grove tab. Expected: the panel shows "No bin-tracked cards yet" (config is seeded in Task 10). No console errors. Screenshot.

**Step 5: Commit**

```bash
git add src/pages/kanban.html
git commit -m "feat(kanban): Grove bags panel — bins, on-hand, cover, order-by; receive / print / void / settings"
```

---

### Task 8: Ops Hub tile

**Files:**
- Modify: `src/js/hub/api.js` (add one export), `src/js/hub/sections.js` (add `renderGrove`), `src/js/hub/main.js:212-226` (`loadSide`), `src/pages/index.html:115-119` (new section), `src/css/hub.css` (one grid rule)

**Step 1: API**

```js
export const getBagStatus = () => apiGet('kanban', 'getBagStatus');
```

**Step 2: Section in `index.html`**

After the Watchlist `</section>` add:

```html
    <section class="sec" id="sec-grove">
      <div class="sec-head"><h2>Grove bags</h2><span class="sec-meta">2,500 MOQ · 75-day lead</span>
        <div class="sec-actions"><button class="icon-btn collapse" aria-expanded="true" aria-label="Collapse section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div></div>
      <div class="sec-body watch-grid" id="groveBody"><div class="card tile"><div class="label">Grove bags</div><div class="value">—</div></div></div>
    </section>
```

**Step 3: Renderer in `sections.js`**

```js
// ---------------------------------------------------------------- Grove bags

export function renderGrove(g) {
  const host = $('groveBody');
  if (!host) return;
  if (!g) { host.innerHTML = tile({ label: 'Grove bags', value: '—', sub: '<span class="err">Unavailable</span>' }); return; }
  const cards = (g.cards || []).filter((c) => c.config && c.config.moq > 0);
  if (!cards.length) { host.innerHTML = tile({ label: 'Grove bags', value: '—', sub: '<span class="muted">No bin-tracked sizes yet</span>' }); return; }
  const kind = { ok: 'good', soon: 'warn', order: 'bad' };
  const text = { ok: 'OK', soon: 'Order soon', order: 'Order now' };
  host.innerHTML = cards.map((c) => `<a class="card-link" href="kanban.html?panel=grove">${tile({
    label: c.item.replace(/^Custom\s+/i, '').replace(/\s+Bags$/i, ''),
    value: c.weeksOfCover != null ? c.weeksOfCover.toFixed(0) : '—',
    unit: 'wk cover',
    sub: `${statusDot(kind[c.status] || 'none', text[c.status] || c.status)} <span class="muted">${int(c.onHand)} bags · ${c.binsSealed} bins${c.orderByDate ? ` · order by ${esc(c.orderByDate.slice(5))}` : ''}</span>`,
  })}</a>`).join('');
}
```

Check `hub.css` line ~270 for `.status.bad`; if only `good|warn|none` exist, add `.status.bad { color: var(--bad); }`.

**Step 4: `loadSide`**

Add `grove: api.getBagStatus(),` to the `settle` map, `state.grove = r.grove;` and `renderGrove(state.grove);`. Import `renderGrove` where the other renderers are imported.

**Step 5: Verify**

Run the hub via the preview server, confirm the section renders "No bin-tracked sizes yet" with no console errors, and that collapse persists on reload. `npm run lint:dashboard` clean. Screenshot.

**Step 6: Commit**

```bash
git add src/js/hub/api.js src/js/hub/sections.js src/js/hub/main.js src/pages/index.html src/css/hub.css
git commit -m "feat(hub): Grove bags tile — weeks of cover, status, order-by per size"
```

---

### Task 9: Full test + lint pass, push branch

**Step 1:** `npm run lint && npm test` — all clean.
**Step 2:** `git push -u origin feat/grove-bag-bins`.
**Step 3:** Open a PR against `master` titled `feat: Grove bag bins — scan-per-bin count and MOQ-aware reorder` with the design doc linked. Body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Front-end and worker are two deploys: the worker must go first (Task 10) so the new page never calls a missing action.

---

### Task 10: Deploy, migrate, seed (production — do with Koa present)

**Step 1: Drift check**

```bash
git fetch origin && git rev-list --left-right --count master...origin/master
```
Expected `0 0` on master before merging. Merge the PR, then `git checkout master && git pull`.

**Step 2: Apply the migration** (statements one at a time if the file fails atomically):

```bash
cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0027-kanban-bins.sql
```

**Step 3: Deploy the worker**

```bash
cd workers && npx wrangler deploy
```

**Step 4: Seed config** (values from design §4; supplier must already read exactly `Grove`):

```bash
API=https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban
for row in '21 600 75 2500' '56 350 75 2500' '54 450 75 2500' '99 90 7 0' '69 100 7 0'; do
  set -- $row
  curl -s -X POST "$API?action=setBinConfig" -H 'Content-Type: text/plain' \
    -d "{\"cardId\":$1,\"seedPerMonth\":$2,\"leadDays\":$3,\"moq\":$4,\"bagsPerBin\":200,\"safetyDays\":30}"; echo
done
curl -s "$API?action=getBagStatus" | head -c 600
```
Expected: five configs; status shows `binsSealed: 0` and `status: 'order'` for each (nothing received yet — that is correct and is why the count comes next). Card 69's seed of 100/mo is a placeholder until the first count.

**Step 5: Bootstrap counts** — Koa counts sealed bags per size (not the bin in use), then on the kanban page → Grove tab → Receive per size with lot `count 2026-09` → Print cards → tape one card on each 200-bag bin.

**Step 6: Prove the loop** — scan one bin card. Expected on the phone: item name, "N bins left", weeks of cover. On the panel: sealed −1, opened +1. Check `getReorderRequests?status=open` did not gain a row unless that size is genuinely below its point.

**Step 7: Push master** so Pages serves the new page (`git push origin master`).

---

### Task 11: Wiki + memory (farm repo `C:\Users\Koasm\Documents\RogueFamilyFarms`)

- Create `wiki/operations/grove-bag-bins.md`: what the crew does (scan when you open a bin), what Damon does (email → order → mark as ordered), the seed rates table with its source and date, the reorder-point formula in one line, and the bootstrapping steps. Link `[[operations/uline-reorder-cadence]]`, `[[operations/tech-stack]]`, `[[sales/demand-segmentation]]`.
- Add to `wiki/index.md` under operations; add a `[2026-09-02] DESIGN:` line to `wiki/log.md`.
- `wiki/tasks/todo.md`: one item for the production bootstrap (Task 10 steps 5–6), `[scope:apps]`; one item to re-export Shopify sales Sep–Dec so the seed rates get a harvest-season view.
- Commit on the farm repo: `wiki: Grove bag bins — scan-per-bin count, MOQ-aware reorder`.
