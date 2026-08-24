-- Bag numbers restart at 1 for each cultivar (Koa 2026-08-24).
--
-- Was one global sequence per season (26-0001 … 26-3965). Now each cultivar
-- counts from 1 and the code keeps them apart: 26-SL-1, 26-L-1, 26-DG-1.
-- Unpadded — "1, 2, 3", not "0001".
--
-- The old UNIQUE(season, serial) has to go, and not just because it is
-- redundant: it would actively REJECT the second cultivar's bag #1 as a
-- duplicate. Replaced by UNIQUE(season, cultivar_code, serial), which is what
-- now guarantees two bags never share a number.
--
-- Trade-off accepted: the number alone no longer identifies a bag. 26-SL-1 and
-- 26-L-1 are different sacks, so the cultivar code is part of the identity and
-- lookups need it. In exchange, per-cultivar totals read straight off the last
-- number instead of needing a query.

ALTER TABLE harvest_sacks ADD COLUMN cultivar_code TEXT;

-- Backfill anything already tagged so the new index can be built. Only test
-- rows exist at this point; real harvest has not started.
UPDATE harvest_sacks SET cultivar_code = 'XX' WHERE cultivar_code IS NULL;

DROP INDEX IF EXISTS idx_harvest_sacks_season_serial;

CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_sacks_season_cv_serial
  ON harvest_sacks(season, cultivar_code, serial);

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_cultivar_code
  ON harvest_sacks(cultivar_code);
