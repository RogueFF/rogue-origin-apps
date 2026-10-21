-- Grove bins: a planned monthly use per lane.
-- Koa 2026-10-20: "~1500/month is a good start … we can update next time we
-- order based off the updated burn rate." The 10 lb lane's ledger counts
-- scan-outs (sales side), but bags are consumed at bagging, so a plan the
-- office sets beats the ledger until the measured rate is trusted.
-- Read by laneStatus (workers/src/lib/bin-math.js): > 0 overrides ledger,
-- seed and season, and one month becomes the suggested order. 0 = off.
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0047-kanban-bin-plan.sql

ALTER TABLE kanban_bin_config ADD COLUMN plan_per_month REAL NOT NULL DEFAULT 0;
