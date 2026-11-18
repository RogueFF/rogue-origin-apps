# Consignment lot ledger, stage 4: the farm's own page

Design: `2026-11-16-consignment-lot-ledger-design.md` sections 7, 8 and 12. Stages 1 to 3 are live.
Branch: `feat/consign-vendor-page` (from master at e540c8f7).

## Goal

Each partner farm opens a private link, sets a 4-digit PIN, and sees only its own numbers: where the balance stands, its price points, its dropoffs with before and after weights, its payments, and on-hand and sold pounds for lots owed as sold. Read-only. English or Spanish. The owner creates, replaces and turns off the link from the staff app.

## Rules that do not bend

1. **One farm only.** Every query on the farm route is filtered by the farm id bound to the token. The farm id never comes from the request.
2. **Allowlist output.** The reply is built field by field in one pure function. No `SELECT *` row is ever spread into it. A new column added later must not leak by default.
3. **Never in the reply:** other farms, internal notes (a lot note shows only when `note_visible = 1`; dropoff notes and payment notes never), staff names (`dropped_by`, actors), `client_key`, history, void reasons, voided rows, the farm's contact field, sale prices, buyers.
4. **Same money as the staff page.** Totals come from `lotMoney` and `farmTotals` in `workers/src/lib/consign-ledger.js`. No second copy of the maths.
5. **The two doors stay separate.** The shared apps password does not open `/api/consign-farm`. A farm token and PIN do not open `/api/consign`.
6. **No real names or prices in the repo.** Fixtures use `Farm A`, `Farm B`, `Alpha`, made-up prices.
7. **No `.gitleaks.toml` edits.** If the secret scan flags something, rename it. If that is not possible, stop and report.
8. **No live writes.** Tests use `node:sqlite` and stubbed routes. Browser tests abort any request to `workers.dev` at the context level.

## Access model

- **Token:** 32 random bytes, base64url, made by the Worker when the owner issues a link. Only `sha256(token)` is stored. The token is shown to the owner once and cannot be read back; a lost link means a new link.
- **Link:** `…/src/pages/consign-farm.html#k=<token>`. The token rides in the URL fragment, so it is not sent to GitHub Pages or in a referrer. The page sends it to the Worker in the POST body only, never in a query string.
- **PIN:** exactly 4 digits, set by the farm on first open. Stored as `HMAC-SHA256(key = raw token, message = "<access id>:<pin>")`, hex. The database alone cannot be used to guess a PIN, because the raw token is not in it. (PBKDF2 is left out on purpose: its cost would count against the Worker CPU limit and a 4-digit PIN gains little from it.)
- **Lockout:** 5 wrong PINs in a row lock the link for 15 minutes. The count is raised with one atomic `UPDATE … SET failed_tries = failed_tries + 1`. While locked, a correct PIN is refused too and the reply says how many minutes are left. A correct PIN, or the lock running out, resets the count.
- **Replace and turn off:** issuing a new link revokes every earlier link for that farm in the same batch (new PIN needed). Revoke turns the link off with no replacement.
- **Unknown, revoked or malformed token:** one generic `UNAUTHORIZED` reply, same shape for all three, compared in constant time where a compare happens.
- **No session.** The page asks for the PIN each time it opens and keeps it in memory only. Every read sends token + PIN.

## Tasks

### Task 1: migration 0067

`workers/migrations/0067-consign-farm-access.sql`:

```sql
CREATE TABLE IF NOT EXISTS cl_farm_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES cl_farms(id),
  token_hash TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  failed_tries INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  pin_set_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_farm_access_farm ON cl_farm_access (farm_id, revoked_at);
```

Add it to the test helper `tests/helpers/consign-sqlite.mjs` and to `tests/consign-schema.test.mjs`. Do not apply it to the remote database; the hub does that at ship.

### Task 2: access library (pure, tested first)

`workers/src/lib/consign-access.js`: `newToken()`, `tokenHash(token)`, `pinHash(token, accessId, pin)`, `validPin(pin)` (string of exactly 4 digits), `lockState(row, now)` returning `{ locked, minutes_left }`, constants `MAX_TRIES = 5`, `LOCK_MINUTES = 15`. WebCrypto only. Tests in `tests/consign-access.test.mjs`.

### Task 3: the farm view builder (pure, tested first)

`workers/src/lib/consign-farm-view.js`: `farmView({ farm, price_points, dropoffs, lots, runs, sold, payments, today })` returns exactly:

- `farm`: `name`, `lang`
- `totals`: `balance`, `owed`, `paid`, `estimate`, `last_payment_on`
- `price_points`: `cultivar`, `type`, `price_per_lb`
- `dropoffs` (newest first): `id`, `dropped_at`, and `lots`: `id`, `cultivar`, `type`, `term`, `status`, `intake_lbs`, `price_per_lb`, `smalls_price_per_lb`, `needs_price`, `estimate`, `owed`, after numbers once screened (`final_lbs`, `to_smalls_lbs`, `biomass_lbs`, `mold_lbs`), for `sold` lots `sold_lbs` and `on_hand_lbs`, and `note` only when `note_visible`
- `payments`: `paid_on`, `amount`, `method`, `reference`

Tests feed rows that carry sentinel strings in every forbidden field (`INTERNAL-NOTE`, `STAFF-NAME`, `CLIENT-KEY`, `VOID-REASON`, `CONTACT`) and assert none appears in `JSON.stringify(view)`, and that the key set of every object equals the allowlist exactly.

### Task 4: the farm route

`workers/src/handlers/consign-farm-d1.js`, route `/api/consign-farm` (exact match, registered in `workers/src/index.js`; add it to the endpoint list). POST only. No `requireAuth`. Actions:

- `status` `{ token }` → `{ needs_pin, locked, minutes_left, lang }`. Nothing else: no farm name before the PIN.
- `setPin` `{ token, pin }` → only while `pin_hash IS NULL`; the UPDATE carries `WHERE pin_hash IS NULL` so two racing calls cannot both win. Then returns the view.
- `view` `{ token, pin }` → checks lock, checks PIN, updates `last_seen_at`, returns `farmView(...)`.

Handler tests (`tests/consign-farm-handler.test.mjs`, real SQLite): two farms with different cultivars, prices, notes and payments; each token returns only its own farm (scan the reply for the other farm's name, cultivar and sentinel values); wrong PIN five times locks, sixth try with the right PIN is refused, after 15 minutes (injected clock) it works; revoked link is refused; reissue kills the old link and its PIN; `setPin` twice is refused; a body carrying `farm_id` for the other farm changes nothing; the shared password alone gets `UNAUTHORIZED`; a farm token sent to `/api/consign` gets `UNAUTHORIZED`; totals equal the staff `farm` action for the same data; voided dropoffs, lots, runs and payments are absent.

### Task 5: owner actions on the staff route

In `workers/src/handlers/consign-d1.js`, owner-only (add to `OWNER_ACTIONS`):

- `issueFarmAccess` `{ farm_id }` → revokes earlier rows, inserts a new one, returns `{ token }` once. Writes a `cl_history` row with no token and no hash.
- `revokeFarmAccess` `{ farm_id }` → sets `revoked_at` on live rows.

The staff `farm` read gains `access`: `{ active, pin_set, issued_at, last_seen_at, locked }` or `null`. Never a hash.

Check whether a lot's `note_visible` can be set anywhere today. If not, add it to the owner-only `setLotTerms` action and to the lot editor in owner mode as a tick: "Show this note to the farm".

### Task 6: staff page, "Farm's page" card

On the farm view of `consign.html`, in owner mode only: a card showing link state (none, waiting for PIN, in use with last opened date, locked, off) with **Create link**, **New link** (confirm: the old link stops working) and **Turn off**. After create, show the link once with **Copy** and a QR code (reuse the QR code already used for the paper sheets), plus one line: "This link is shown once. Send it to the farm yourself." EN/ES in `labels.js`. The link is never stored in the browser.

### Task 7: the farm page

`src/pages/consign-farm.html`, `src/js/consign-farm/*`, `src/css/consign-farm.css` using the same teal and sage tokens as `src/css/consign.css` (deep teal, mid teal, mist, sage; red for attention only). Not behind `page-gate.js`. Not linked from `index.html` or any nav. `<meta name="robots" content="noindex, nofollow">` and `<meta name="referrer" content="no-referrer">`. No third-party scripts.

Screens:

1. **No link or bad link:** "This link is not active. Ask Rogue Origin for a new one."
2. **Set PIN** (first open): two 4-digit entries that must match, large keypad-friendly inputs (`inputmode="numeric"`).
3. **Enter PIN:** wrong PIN shows tries left; locked shows minutes left.
4. **The page**, large distinct cards in this order: Where we stand (one big number: "We owe you" or "Credit owed to Rogue Origin", an *Estimate* tag when any lot is unscreened, last payment date) → Price points → Dropoffs, newest first, each lot with a status chip, pounds in, and after numbers once screened → Payments → On hand and sold (only when the farm has `sold` lots).

Language starts from `farm.lang`, with an EN/ES switch. Money and weights use the existing `src/js/consign/format.js`.

**Home screen:** the token must survive "Add to Home Screen" on iOS and Android. An installed iOS app does not share storage with Safari and a static manifest `start_url` cannot carry a per-farm token, so: ship **no static manifest**, add the `apple-mobile-web-app-capable` and `theme-color` meta tags, and never strip the `#k=` fragment from the URL, so the saved shortcut is the full link. State in the handback that this is not proven on a real phone; the hub will ask Koa to try it.

Check `sw.js`: if the page would be picked up by the service worker, make sure the token and the API replies are never cached, and bump `CACHE_VERSION` only if a precached file changed.

Browser tests `tests/consign-farm.spec.js`: set PIN, enter PIN, wrong PIN, locked, revoked, bad link; EN and ES; 375 px and 1024 px; smallest content (one lot, no payments) and largest (ten cultivars, tops and smalls, some screened, some needing a price, a credit balance, eight payments). No horizontal scroll at 375 px. Screenshots of each state saved for the hub.

### Task 8: finish

`npm run lint`, `npm test`, stage then `npm run stamp`, `npm run stamp:check`, the Playwright consign specs. Commit on the branch. Do not push, open a PR, apply the migration or deploy.

## Ship order (hub, on Koa's yes)

1. Apply migration 0067 to the remote database.
2. Deploy the Worker.
3. Merge the PR (Pages).
4. Koa creates one link in owner mode and tries it on a real phone, including Add to Home Screen.

## Not in this stage

Emailed statements, the farm entering anything, push notifications, showing biomass value, opening balances.
