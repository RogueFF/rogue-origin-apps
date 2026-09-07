-- Which drying bay a trailer load was hung into.
--
-- Until now the bay was written exactly ONCE, at takedown, onto
-- harvest_sacks.bay. So the barn grid could show what came OUT of each bay and
-- had no way at all to answer "what is drying in bay 5 right now" — the scan
-- log has two event types, 'enter' and 'barn_load', and neither carried a bay.
--
-- ON THE LOAD ROW, NOT THE SESSION. A bay takes material from several lots
-- (Koa, 2026-09-03: "there will probably be multiple takedowns within the same
-- bay"), and one lot spreads across several bays. A bay column on the 'enter'
-- row would model one bay per lot: wrong the first time a bay takes two zones,
-- and wrong in a way that still passes tests. The barn_load row is already the
-- many-to-many — lot x bay x when x how many bins.
--
-- NULLABLE ON PURPOSE, same reasoning as crew in 0029. The bins are the thing
-- that must never be lost: the ledger counts them by joining on
-- attributed_zone_session_id, so a rejected submission drops them off the lot
-- entirely. An old bookmark that posts no bay still logs its load.
ALTER TABLE harvest_scan_log ADD COLUMN bay INTEGER;

-- The rack board reads every load that has a bay, for the season, in time
-- order — it has to group a bay's loads into fills, and a fill boundary is only
-- visible in the ordering.
CREATE INDEX IF NOT EXISTS idx_harvest_scan_bay
  ON harvest_scan_log (bay, season, is_test, occurred_at);
