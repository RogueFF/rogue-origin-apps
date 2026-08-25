-- Where a bag's tops/smalls figures came from.
--
-- Nobody weighs a bag's output individually. The trim floor reports a daily
-- total per strain, so a bag's share is that total split across the bags of
-- that strain opened the same day.
--
-- The split is EQUAL, and that is exact rather than approximate here: every
-- supersack is filled TO 37 lb (Koa 2026-08-25), so the bags genuinely are the
-- same size. Equal division would be a guess if fill weights varied; it is not.
--
-- Still recorded as 'allocated', not 'measured'. The daily total is real; the
-- per-bag figure is a share of it. Yield/plant, tops:smalls and lot comparisons
-- all rest on these numbers, and a share-out wearing the clothes of a
-- measurement is exactly the failure the pending-constants rule exists to stop.
-- 'measured' is kept for the rare bag actually weighed on its own.

ALTER TABLE harvest_sacks ADD COLUMN weights_source TEXT;   -- 'allocated' | 'measured'
ALTER TABLE harvest_sacks ADD COLUMN weights_allocated_at TEXT;

-- Anything already carrying weights was typed in by hand.
UPDATE harvest_sacks SET weights_source = 'measured'
WHERE weights_source IS NULL AND opened_at IS NOT NULL
  AND (tops_lbs IS NOT NULL OR smalls_lbs IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_opened_day
  ON harvest_sacks(opened_at, cultivar);
