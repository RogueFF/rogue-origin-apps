# Tag & Desk — end-to-end walkthrough, 2026-09-15

Koa: "take a look at the kanban app, make sure all steps work to print/order/etc."

## How it was checked

- **Live page (read-only):** https://rogueff.github.io/rogue-origin-apps/src/pages/tag-desk.html loads with no console errors; the six `src/js/tag-desk/*.js` files Pages serves are byte-identical to `origin/master`; Order, Cards, Print, Grove and Tag all render live data.
- **Every write path against the mock API** (the Sep 2 fixtures in `tests/fixtures/tag-desk/`): the 5 existing browser tests, the 17 model tests, and a 25-step walkthrough that clicks every button the desk and the Tag have.

## Results by flow

**Tag (phone scan)**
- Scan a fresh card → queued once at the suggested qty ✅
- Re-scan a queued card → "Already on the list", no second add ✅
- Undo → removed; Queue again → back at the suggested qty ✅
- **+1 then Undo +1 → was setting the qty to 1** ❌ → **fixed** (see below) ✅
- Red card → "OUT", note `RED CARD`, desk shows the red bar ✅
- Grove card → "Requested from Damon"; unknown id → "Card not recognised" ✅
- EN | ES toggle ✅

**Order (desk)**
- +/− quantity, Add, Add all in "About to run out" ✅
- Remove → toast Undo restores the same qty ✅
- "Stocked" on Check the shelf hides the card; Undo brings it back ✅
- Copy Uline list → clipboard holds the `MODEL QTY` paste text ✅
- Send to Uline cart → opens Uline Quick Order with the list ✅
- Amazon cart link / Open N pages (one tab per queued item) · Walmart cart link ✅
- Mark N ordered → receipt; Undo order restores every card at its qty ✅
- Receive one item / whole order · Not shipped → back to "About to run out" ✅
- Shelf sweep dialog: Add inside it queues; Print checklist prints ✅

**Print**
- Single card → one 6×4 in card (576×384 px) in the print area, rest of the page hidden, QR = `tag-desk.html?flag=<id>` ✅
- Red card format → red card, QR ends `&red=1` ✅
- Vendor batch → every unprinted card for that vendor (Amazon: 44) ✅
- Grove sheet format → 8.5×11 sheet ✅
- **Cancelling the print dialog still marks the cards printed** ⚠️ (open question 2)

**Tag + Order together**
- **Scan a card after Mark ordered → it goes back in the cart** ❌ (open question 1)

**Cards + editor**
- Filter chips, vendor/zone selects, search ✅
- Edit levels → Save sends the full row (the worker overwrites the whole row) ✅
- + Add card → `add` with no id, card appears ✅
- Hide card → gone, Undo restores · Delete forever → confirm, then `delete` ✅

**Grove**
- Ask Damon again (at most once a day per card) · Mark ordered · Receive bins (2,500 bags ÷ 200 = 13 bin cards) ✅

**Everything else**
- Spanish and English sweeps of all five views: no `undefined` / `NaN` / `[object` ✅
- Theme toggle changes the page (light ↔ dark) ✅
- No page errors across the whole run ✅

## Bug fixed — Tag "Undo +1"

`src/js/tag-desk/main.js` kept the model it loaded when the Tag opened and never refreshed it after its own writes (the shared `reload()` only refreshes `render.js`'s copy). Undo +1 computed `qty − 1` from the *pre-scan* quantity: card #23, suggested 2 → +1 → 3 → Undo +1 → **1**. The same stale copy fed Queue again, Try again and the urgent flag.

Fix: the Tag route reloads through its own `refresh()`, which rebinds the model it reads. Regression test: `tests/tag-desk.spec.js` — "+1 then Undo +1 lands back on what the scan queued, not on 1" (it picks a card with suggested ≥ 3 and checks two stacked +1s).

## Update, same day — Koa: "push it live and build both fixes"

- **Undo +1** shipped (`82b273ff`).
- **Already on order.** A scan now reads the order history, which every phone can see. If the card was ordered within its lead time plus 2 days (`ON_ORDER_GRACE_DAYS`), the Tag says **"Already on order · arrives <date>"** and queues nothing. **"Tell the desk it's urgent"** still queues it with the note `URGENT`, and the **red card still fires**. Once the window passes, a scan queues normally again. This only covers cards printed from the new page; shelf cards that still point to `kanban.html` go through the old page.
- **Print.** After the print dialog closes, the desk asks **"Did all N cards print?"**. Only Yes takes them off the to-print list; No or Cancel leaves them on it.
- Tests: model 18/18 (new: on-order window, red card, cart wins, 2-week lead), browser 8/8 (new: on-order scan + urgent + red, print No/Yes), walkthrough 25/25.

The questions below are kept as they were asked.

## Open questions for Koa

1. **Found and reproduced: scanning a card that is already on order queues it again, so it can be ordered twice.** Mark Uline ordered, then scan one of those cards: the Tag says "Queued" and the card is back in the cart at the suggested qty. The desk gets no sign it was already ordered. The Tag's "Already on order" screen exists but never shows on a real scan, because receipts live only in the desk browser's storage and the phone cannot see them. This breaks the "never over-order" rule. Suggested fix: the Tag reads the order history (already loaded) and treats an order placed within the card's lead time as "on order". It needs Koa's OK because it changes what a floor scan does.
2. **Cancel still counts as printed.** Chrome fires `afterprint` whether the job prints or is cancelled. A cancelled 44-card Amazon batch clears 44 orange "to print" dots, and the next person sees "✓ printed" for cards that never came out. That bites during the 98-card reprint. **Recommendation:** after the dialog closes, ask "Did the N cards print?" and mark them only on Yes. About five lines in `printCards`.
3. **The cards on the shelves still point to the old page** (`kanban.html?flag=`). The Print tab shows 98 to reprint. Until they are reprinted, scans go through the old page, which adds up re-scans (the desk flags these as "N scans stacked").

## Seen on the live data (not code)

- Uline: **Shipping Pallets ×3** has no Uline number, so it is not in the paste list. Add it by hand or add the model number to the card.
- Grove: 4 open requests with Damon. **10 lb since Aug 11 (35 days, no confirmation)** and **1 lb since Sep 2 (13 days)**.

## Incident during the check

One walkthrough step opened a second browser tab that the mock did not cover, so it reached the live API. It added **card #111 (Medium Nitrile Gloves ×4, `addedBy: tag`) to the live Uline cart at 18:53:45 UTC**. The row was removed at about 18:55 UTC. The cart was read back and matched the six real rows from 14:29–14:31. Nothing was ordered. That same step's first result ("not re-queued") came from the live API, not the mock, and was thrown out. The re-run with the mock covering the tab showed the re-queue in open question 1. The walkthrough script now blocks every call to the live worker.
