-- Cultivar on the zone-entry row.
--
-- A harvest lot is zone x cultivar x cut. Most zones hold a single cultivar, so
-- zone alone identified the lot — but Z8, Z10, Z14, Z15 and R1 are trial/split
-- zones holding 2 to 15 cultivars each. Without this column, a cut of "Demi
-- Glaze" and a cut of "Tahitian" from the same Z10 trial collapse into one lot,
-- which defeats the point of running the trial.
--
-- The zone sign's QR now shows a cultivar picker for those zones before opening
-- the session; single-cultivar zones auto-fill and skip the picker.
--
-- Cut numbering keys on (zone, cultivar) for the same reason: Z10 "Lemon" cut 1
-- is independent of Z10 "Rocket Sauce" cut 1.

ALTER TABLE harvest_scan_log ADD COLUMN cultivar TEXT;

CREATE INDEX IF NOT EXISTS idx_harvest_scan_log_zone_cultivar
  ON harvest_scan_log(zone, cultivar);
