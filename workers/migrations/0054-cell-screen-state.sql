-- What each cell's screen is doing right now, so other computers can see it
-- (Koa 2026-11-09: "once everything renders on the cell 1 tablet, id like to see
-- it pop up on other's computers"). The cell tablet posts this on every job
-- change and every 30 s (setCellState); the Cells board reads it with the live
-- scale weight (cellBoard). One row per station, overwritten each time.
--
-- Times are Worker epoch ms, never the tablet's clock: clock_start is when the
-- job's working clock would have read 0 (now - the tablet's elapsed time) while
-- it runs; clock_ms is the frozen value while paused or finished. finished_at is
-- when the job first reached 'finished', kept until it leaves that phase (the
-- bag is lifted for pickup).
--
-- Safe to run twice. Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0054-cell-screen-state.sql

CREATE TABLE IF NOT EXISTS cell_screen_state (
  station_id     TEXT PRIMARY KEY,
  phase          TEXT NOT NULL CHECK (phase IN ('idle', 'armed', 'running', 'finished')),
  cultivar       TEXT,
  bag            TEXT,
  target_g       REAL,
  clock_start    INTEGER,
  clock_ms       INTEGER,
  paused         INTEGER NOT NULL DEFAULT 0,
  pause_note     TEXT,
  finished_net_g REAL,
  finished_at    INTEGER,
  updated_at     INTEGER NOT NULL
);
