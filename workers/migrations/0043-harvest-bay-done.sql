-- When a bay's takedown was finished, per cultivar and fill.
--
-- Koa, 2026-10-05: Sour Lifter from two or three zones hangs in every bay and
-- the sticks carry no zone, so takedown now picks a BAY, not a zone lot. The
-- crew closes out a bay, not a lot: "Bay 9 is down".
--
-- KEYED ON THE FILL. A bay is refilled many times a season; `fill_start` is the
-- first load of the fill this row closes (UTC, SQLite text, as harvest_scan_log
-- writes it), so finishing bay 9 today never hides next week's bay 9. A fill
-- is the bay's loads with no gap of FILL_GAP_DAYS between them (bay-fills.js).
-- PER CULTIVAR AND CUT because one fill can hold two (a retail lot beside Sour
-- Lifter, or a 2nd cut hung beside a 1st).
--
-- A LOT FINISHES BY ITSELF once every bay holding its loads is down: the worker
-- stamps its harvest_scan_log.takedown_done_at then, and clears it on reopen.
-- Deleting the row is the reopen; nothing else reads it.
--
-- Applied by hand, before the deploy:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0043-harvest-bay-done.sql
CREATE TABLE IF NOT EXISTS harvest_bay_done (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bay        INTEGER NOT NULL,
  cultivar   TEXT NOT NULL,
  cut_number INTEGER NOT NULL DEFAULT 1,
  fill_start TEXT NOT NULL,
  done_at    TEXT NOT NULL DEFAULT (datetime('now')),
  is_test    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bay, cultivar, cut_number, fill_start, is_test)
);
