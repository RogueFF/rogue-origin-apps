# Grove rack: day one

Walk it top to bottom. Design: `docs/plans/2026-10-14-grove-bins-design.md`.

## 1. Before anything (the back end)
- [ ] **Migration 0046 on remote:** `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0046-kanban-bins.sql`. Cards 21, 54, 56, 69 and 99 must already exist, or the whole file rolls back.
- [ ] **Worker deployed** from `workers/`: `npx wrangler deploy` (not the root `npm run deploy`).
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
- [ ] **Recount** that lane so the test request's hold doesn't sit on it. (Skip if an order really is due.)

## 5. Two weeks later
- [ ] Compare the ledger against the Shopify counters (SQL in the Flow guide).
- [ ] If they match, Nathan turns off the old Flow and archives the "Grove Bags" product.

## 6. Questions to settle on day one
- [ ] Bags per box for the custom sizes.
- [ ] Where the open bin lives: rack or bench (default: **bench**).
- [ ] Do 1/4 lb and 1/2 lb really use the **1 LB** bag? The recipe seed assumes they do.

## 7. Wiki
- [ ] Log the go-live in the farm wiki `wiki/log.md` and close the Grove todo.
