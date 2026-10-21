-- Grove bins: the order cycle per lane.
-- Koa 2026-10-21: "I'd like to hold enough stock to order every 2 weeks."
-- Read by laneStatus (workers/src/lib/bin-math.js): one order covers
-- order_days of use (rounded up to 100, floored at MOQ). 0 = default:
-- 30 days with a plan_per_month, 120 without (one Grove custom run).
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0048-kanban-bin-order-days.sql

ALTER TABLE kanban_bin_config ADD COLUMN order_days INTEGER NOT NULL DEFAULT 0;
