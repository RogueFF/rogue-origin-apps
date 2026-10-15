# Grove rack: day one

Walk it top to bottom. Design: `docs/plans/2026-10-14-grove-bins-design.md`.

## 1. Before anything (the back end)
- [ ] **Migration 0046 on remote:** `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0046-kanban-bins.sql`. Cards 21, 54, 56, 69 and 99 must already exist, or the whole file rolls back.
- [ ] **Worker deployed** from `workers/`: `npx wrangler deploy` (not the root `npm run deploy`).
- [ ] **`WEBHOOK_SECRET` bound** on the production worker before the Flow goes on: `cd workers && npx wrangler secret list` must show it. `orderUsage` only logs a warning when it is unset, so without it the endpoint is open to anyone.
- [ ] **Flow on**, following `docs/guides/grove-shopify-flow.md`. Leave the old "Grove Bags" Flow running too.
- [ ] **Recipes seeded:** `node scripts/grove-seed-recipes.mjs <sales-by-variant.csv>`, review, apply.
- [ ] **Last year seeded:** `node scripts/grove-seed-usage.mjs <monthly.csv> > /tmp/seed.sql`, check the totals it prints (1 oz about 600 a month, about 1,000 in Nov), apply.

## 2. Count the rack
- [ ] Count the **sealed** bins of each size. Don't count the open bin.
- [ ] Desk → **Grove** → each lane → **Recount** → enter the bins.

## 3. Set up each lane
- [ ] **Settings:** bags per box from the packing slip, and bin size as the crew splits it (10 lb: 100 per box, 50 per bin).
- [ ] **Lane kit** → print the 3 pages → laminate.
- [ ] Header card on the lane. Red **ORDER** card buried at bin N (the number on the tape label). Red tape on the lane wall at that height.
- [ ] Lane colours: **orange** 1 oz · **teal** 1/4 & 1/2 oz · **violet** 1 lb · **olive** 1 lb blank · **slate** 10 lb.

## 4. Prove the loop (one lane)
- [ ] Scan one red card with a phone → the red **PEDIR** page opens.
- [ ] Damon gets the email → he taps **Mark as ordered**.
- [ ] The Desk shows the request closed and an order in the history.
- [ ] After the test close, log a **Receive with 0 boxes** on that lane, with the current sealed bin count as leftovers. That writes a receive event, which re-arms the ledger trigger, and adds no order row because boxes = 0. A recount would not do it: by design, a recount does not lift the hold an "ordered" request puts on the lane. (Skip if an order really is due.)

## 5. Two weeks later
- [ ] Compare the ledger against the Shopify counters (SQL in the Flow guide).
- [ ] If they match, Nathan turns off the old Flow and archives the "Grove Bags" product.

## 5b. Email intake (so Receive stops being a manual step)
Full steps: `docs/guides/grove-email-intake.md`.
- [ ] Migration 0047 on remote, `TRACK17_KEY` + `TELEGRAM_KOA_CHAT_ID` bound, worker deployed.
- [ ] Gmail filter: Grove's order address → label **Grove/Orders**.
- [ ] Apps Script `RO Grove Mail Poller` with `WORKER_URL` + `WEBHOOK_SECRET`, trigger every 5 minutes.
- [ ] 17TRACK account; webhook URL set to `…/api/kanban?action=trackingEvent`.
- [ ] Drag one real Grove order email onto the label → the lane tile reads "N on order · arrives ~date". Then the shipping email → "shipped · UPS 1Z…". Then the delivery → Koa gets the "delivered · lane now ~N bags" line and the lane re-baselines by itself.
- [ ] If a mail lands in **Grove/Review**: Receive by hand on the Desk, then **Mark as handled** in the strip. Drop the email into `tests/fixtures/grove-mail/` so the parser learns it.

## 6. Questions to settle on day one
- [ ] Bags per box for the custom sizes.
- [ ] Where the open bin lives: rack or bench (default: **bench**).
- [ ] Do 1/4 lb and 1/2 lb really use the **1 LB** bag? The recipe seed assumes they do.

## 7. Wiki
- [ ] Log the go-live in the farm wiki `wiki/log.md` and close the Grove todo.
