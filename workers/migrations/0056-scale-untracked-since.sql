-- Trimming with no job on the screen (Koa 2026-11-10: "Anything we can do to make
-- sure everything is entered correctly with hard restrictions is what we need").
-- The 5-minute cron tells Koa once per episode when a cell's scale is gaining
-- weight but no job is running on a reporting tablet (lib/untracked.js). This is
-- when that message went out; cleared once the cell records a job again.
--
-- ALTER TABLE ADD COLUMN can't be repeated: apply ONCE, by hand, after 0055.
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0056-scale-untracked-since.sql
-- Until it is applied the cron sends nothing for this; the Cells board still shows it.

ALTER TABLE scale_stations ADD COLUMN untracked_since TEXT;
