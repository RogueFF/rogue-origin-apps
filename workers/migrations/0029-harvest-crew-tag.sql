-- Which cutting crew a zone session belongs to.
--
-- 2026 runs two cutting crews, and they can be in the same zone at once. Zone
-- sessions were global: scanning ANY sign closed whichever session was open, so
-- crew B entering Z7 closed crew A's Z4, and crew A's next trailer arrived with
-- no open session to attach to — landing outside the 6-minute grace and
-- recording no attribution at all, which drops those bins off every lot.
--
-- The tag rides on the crew lead's phone (an rf_crew cookie, set once by
-- scanning a Crew A / Crew B card), because the zone signs are printed and
-- laminated for the season and cannot carry it.
--
-- NULLABLE ON PURPOSE. A phone with no crew tag is a legitimate state — a spare
-- handset, a cleared cookie, a new phone mid-season — and the scoping treats
-- NULL as its own crew: an untagged phone never closes a tagged crew's session,
-- and a tagged crew never closes an untagged one. Degrading to today's
-- behaviour is fine; silently stealing another crew's session is not.
ALTER TABLE harvest_scan_log ADD COLUMN crew TEXT;

-- The hot lookup is "this crew's open session", and after that "any open
-- session in this zone" at the barn.
CREATE INDEX IF NOT EXISTS idx_harvest_scan_open_crew
  ON harvest_scan_log (crew, closed_at, is_test);
