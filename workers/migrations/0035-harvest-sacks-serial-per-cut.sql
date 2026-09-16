-- Bag numbers restart for each cut.
--
-- Koa, 2026-09-16: first cut and second cut are numbered separately — Rainbow
-- GMO Quik's first cut is #1-#15, and its second cut starts again at #1. The
-- cut is printed large on the tag so two bags with the same number can be told
-- apart. (The Super Sack Inventory split the two cuts into separate variants the
-- same day.)
--
-- The sack id keeps the two apart: a first-cut bag stays "26-RAINGQ-1", exactly
-- as the 15 bags already tagged read, and any later cut carries the cut in the
-- id — "26-RAINGQ-C2-1". So no printed QR changes.
--
-- The serial is now unique per season, cultivar AND cut. The old index would
-- refuse second-cut #1 while first-cut #1 exists. Loosening an index is safe to
-- apply before the code that needs it: the running worker still allocates one
-- sequence per cultivar, which satisfies the new index as well.
DROP INDEX IF EXISTS idx_harvest_sacks_season_cv_serial;

CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_sacks_season_cv_cut_serial
  ON harvest_sacks(season, cultivar_code, cut_number, serial);
