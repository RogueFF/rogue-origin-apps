-- What each cell job was (Koa 2026-11-09, made-to-order retail trial): the cell
-- screen picks a cultivar and a bag size for the order, and the target follows
-- the bag size. A finished job already posts a 'pickup' mark (migration 0050);
-- that mark now also carries the order's cultivar, bag size and the job's
-- working time (pauses left out), so the hourly log and later pace-per-cultivar
-- reports know what each job was. All NULL on tare marks and older pickups.
--
--   bag: qOz | hOz | oz1 | qLb | hLb | lb1   (fill-weight standards, net)
--
-- Run ONCE: ALTER TABLE ADD COLUMN is not idempotent in SQLite. The Worker
-- still saves the plain mark if this hasn't been applied yet.
-- Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0052-cell-job-order.sql

ALTER TABLE scale_marks ADD COLUMN cultivar TEXT;
ALTER TABLE scale_marks ADD COLUMN bag TEXT;
ALTER TABLE scale_marks ADD COLUMN cycle_s INTEGER;
