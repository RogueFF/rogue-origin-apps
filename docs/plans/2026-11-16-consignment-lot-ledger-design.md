# Consignment lot ledger: design

Date: 2026-11-16
Status: design approved by Koa in brainstorm; no code written yet
Replaces: the 2026-02 consignment app (`src/pages/consignment.html`, `consignment-d1.js`), which stays as a read-only archive

## 1. Why

The live consignment app records an intake as one weight and one price, infers sales from inventory counts, and prices every sold pound at the most recent intake price. It cannot hold what actually happens in the barn:

- A dropoff usually has several cultivars, each with tops and smalls.
- Product is often dropped off before it is weighed.
- Product is screened later, usually when an order needs it, and screening changes the pounds: some tops become smalls, some become biomass, some is mold.
- A farm is sometimes paid on dropoff, and the screened weights then leave a credit owed back to us.
- A farm can have part of its product on consignment and part bought outright.

Goals, in order:

1. A staff app that records dropoffs with before and after numbers.
2. A page per farm where the farm sees its own price points, dropoffs, screening results and payments.

## 2. Words

| Word | Meaning |
|---|---|
| Farm | A partner farm that drops off product. |
| Dropoff | One visit by one farm. Date and time are stamped by the server. |
| Lot | One cultivar, one type (tops or smalls), one term, inside a dropoff. The unit that carries a price and a weight. |
| Term | How a lot becomes owed: `dropoff` (owed for what was dropped off) or `sold` (owed only as it sells). |
| Screening run | One pass of screening on a lot: pounds pulled and what came out. |
| Price point | The agreed price per pound for a farm, cultivar and type. |

## 3. Lot steps

1. **Dropped off.** Farm, cultivar, type, term, note. Weight may be empty.
2. **Weighed.** Intake weight entered, on the spot or days later.
3. **Screened.** One or more screening runs. Usually one run covers the whole lot; a second run is allowed when only part was done.
4. **Closed.** Screened pounds pulled equal the intake weight.

A screening run records:

- Tops lot: pounds pulled, final tops, turned to smalls, biomass, mold.
- Smalls lot: pounds pulled, final smalls, biomass, mold.

The outputs must add up to the pounds pulled within a tolerance (default 0.5 lb or 1%, whichever is larger; the difference is stored on the run). Outside the tolerance the run cannot be saved.

## 4. Terms and partial consignment

- Each farm has a default term.
- Each lot carries its own term, copied from the farm default and changeable on the dropoff screen.
- A cultivar line can be split by pounds, for example part bought outright (`dropoff`) and the rest on consignment (`sold`). A split makes two lots of the same cultivar and type with different terms.
- Changing a lot's term after a payment has been recorded needs the owner role and is written to the change history.

Assumption to confirm at build: "a portion on consignment" means a split by pounds or by cultivar at dropoff, not a term that changes over time.

## 5. Price points

- Stored per farm, cultivar and type, with an effective date.
- Staff see the price locked. Only the owner role can add or change a price point.
- A lot copies its price at dropoff. A later price change applies to later dropoffs only.
- A cultivar with no price point can still be dropped off. The lot is flagged "needs price" and counts as zero owed until the owner sets it.
- Tops that screen down to smalls are paid at that farm's smalls price for the cultivar, copied onto the lot at dropoff (or flagged "needs price").

## 6. Money

Nothing is stored as a balance. Every figure is computed from lots, screening runs, sold entries and payments.

Payable pounds for a lot:

- Not screened: intake weight at the lot price, shown as an estimate.
- Partly screened: screened outputs at their prices plus the unscreened remainder at the lot price, shown as an estimate.
- Fully screened: final tops (or final smalls) at the lot price, plus turned-to-smalls at the smalls price. Biomass and mold pay nothing.

Owed for a farm:

- `dropoff` lots: payable pounds × price.
- `sold` lots: sold pounds × price. Sold pounds are entered against the lot and cannot exceed its payable pounds. The rest shows as on hand.
- Balance = owed − payments. A balance below zero is shown as a credit owed to us and carries forward. It is never clamped to zero.

Payments record date, amount, method, reference number and a note.

Balances start fresh for the 2026 crop. Nothing is imported from the old tables.

## 7. Data model (D1)

New tables, prefixed `cl_` so they sit beside the old `consignment_*` tables:

| Table | Key columns |
|---|---|
| `cl_farms` | name, contact, default_term, active, lang |
| `cl_price_points` | farm_id, cultivar, type, price_per_lb, effective_from |
| `cl_dropoffs` | farm_id, dropped_at (server time), dropped_by, note, source (app, paper, telegram) |
| `cl_lots` | dropoff_id, cultivar, type, term, intake_lbs (nullable), weighed_at, price_per_lb, smalls_price_per_lb, note, note_visible, voided_at, void_reason |
| `cl_screen_runs` | lot_id, run_at, pulled_lbs, final_lbs, to_smalls_lbs, biomass_lbs, mold_lbs, diff_lbs, note, voided_at |
| `cl_sold` | lot_id, sold_on, lbs, note, voided_at |
| `cl_payments` | farm_id, paid_on, amount, method, reference, note, voided_at |
| `cl_history` | table, row_id, action, before, after, actor, at |
| `cl_farm_access` | farm_id, token_hash, pin_hash, failed_tries, locked_until, revoked_at |

Rules:

- Rows are voided with a reason, never deleted.
- A dropoff with its lots is written in one D1 batch: all rows or none.
- Dates default to Pacific time, not UTC.

## 8. API

Staff route `/api/consign` (shared password, as on the current page):

- Reads: farms, one farm (balance, lots, payments, price points), open work (waiting to weigh, waiting on screening, needs price), one dropoff.
- Writes: save dropoff, set intake weight, save screening run, save sold entry, save payment, void row.
- Owner only (second secret): save farm, save price point, change a lot's term or price, issue or revoke farm access.

Vendor route `/api/consign-farm` (token + PIN, never the shared password):

- One read that returns only the farm bound to the token: balance, price points, dropoffs with lot status and screening results, payments, on-hand and sold pounds for `sold` lots, notes marked visible.
- Never returns other farms, internal notes, sale prices or buyers.
- PIN is set on first open. Five wrong tries lock the link for 15 minutes.

## 9. Staff screens

Big cards, colour-coded steps, English and Spanish, built for a tablet or phone.

1. **Home.** Cards: Waiting to be weighed, Waiting on screening, Needs a price. Buttons: New dropoff, Record payment.
2. **Dropoff.** Pick the farm once. One row per cultivar with Tops lb and Smalls lb boxes side by side, each with its locked price underneath and a term chip. Boxes may be left empty. A row can be split by term. One dropoff note and a note per row.
3. **Screening.** Pick a dropoff and a cultivar. The before number sits at the top; the output boxes show a running "adds up" or "off by X lb".
4. **Farm page.** Balance or credit, lots by step, payments, price points (locked for staff).
5. **Saves.** "Saved" shows only after the server confirms. With no signal the entry is held in IndexedDB and sent when the signal returns; held entries are listed on Home.

## 10. Printout and photo upload

- A blank paper sheet with the same grid and screening boxes, and a QR code that ties the sheet to a dropoff (or opens a new one).
- A photo of a filled sheet is read into the dropoff or screening screen. Nothing is saved until a person checks the numbers and confirms. Low-confidence boxes are marked.
- Reuses the crew board photo pipeline where it fits.

## 11. Telegram

Timber (farm-bridge) gets tools over the staff route:

- Log a dropoff, set weights, add a screening run, record a payment.
- Answer "what do we owe this farm" from the live ledger, leading with the current balance.
- Writes are read back for a yes before they are saved.

## 12. Vendor page

Installable page (web app manifest), read-only, English or Spanish:

1. Where we stand: owed to the farm, or credit owed back, with the last payment date.
2. Price points per cultivar.
3. Dropoffs, newest first, each lot with a status chip, pounds dropped and, once screened, the after numbers. Unscreened figures are labelled "estimate".
4. Payments.
5. On hand and sold pounds, for `sold` lots only.

Access: the owner issues a long private link per farm. The farm opens it, sets a 4-digit PIN and adds the page to the home screen. The owner can revoke or reissue the link from the farm page.

## 13. Testing

- Money maths against a real SQLite database (not a SQL-substring mock): paid on dropoff then screened lower (credit), split screening, price change mid-season, `sold` term, a lot split across terms, needs-price lots, voided rows.
- Handler tests for all-or-nothing dropoff saves and the screening tolerance.
- Access tests: a farm token can never return another farm's data; lockout after wrong PINs; a revoked link stops working.
- Browser tests of the tablet flow in both languages, at the smallest and largest realistic dropoff (one line, and ten cultivars with both types). All API calls are stubbed at the context level so no test writes to production.

## 14. Build stages

Each stage ships and is used before the next starts.

1. Staff app: tables, dropoff grid, weighing, screening, farm page, payments, price points. Retires `/intake-consignment`.
2. Printout and photo upload.
3. Telegram tools.
4. Vendor page with link and PIN.

## 15. Left out on purpose

- Shopify pool sync and automatic sale detection.
- Sale prices, margins and buyers.
- Tracing a lot into trimmed batches or orders.
- Emailed statements.
- Importing old intakes, sales and payments.

## 16. Open items

- Confirm the meaning of partial consignment (section 4).
- Opening balance per farm: zero, or a typed-in carry-over credit.
- Whether biomass ever has a price for any farm (the model allows adding one later).
- Who holds the owner secret besides Koa.
