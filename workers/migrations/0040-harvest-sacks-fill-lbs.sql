-- A bag's own weight when it is not a full sack (Koa, 2026-09-28).
--
-- NULL means a full sack for its crop year (see workers/src/lib/sack-weight.js:
-- 37 lb through 2025, 35 lb from 2026). The last bag of a lot goes out light and
-- the crew had been typing its weight into the tag's note; this is that number
-- where the ledger and the allocator can add it up.
--
-- Backfill: the six weights already written in notes, all on unopened bags, so
-- no allocation has used them yet. 26-RAINGQ-C2-6 says only "not a full 37Lbs",
-- with no number, so it is left NULL and its note stands.
--
-- Applied by hand (no migrations_dir in wrangler.toml), ALTER first:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file migrations/0040-harvest-sacks-fill-lbs.sql

ALTER TABLE harvest_sacks ADD COLUMN fill_lbs REAL;

UPDATE harvest_sacks SET fill_lbs = 17 WHERE sack_id = '26-OF-4' AND is_test = 0;
UPDATE harvest_sacks SET fill_lbs = 18 WHERE sack_id = '26-ORNGPQ-11' AND is_test = 0;
UPDATE harvest_sacks SET fill_lbs = 25 WHERE sack_id = '26-PURPSNOW-13' AND is_test = 0;
UPDATE harvest_sacks SET fill_lbs = 30 WHERE sack_id = '26-MANCHOC-10' AND is_test = 0;
UPDATE harvest_sacks SET fill_lbs = 42 WHERE sack_id = '26-MANCHOC-11' AND is_test = 0;
