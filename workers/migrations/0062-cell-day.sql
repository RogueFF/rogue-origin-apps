-- Cell 1 Phase 1 daily scorecard, capture side (Koa 2026-11-11, "Yes, fully
-- automatic": no paper, no photo). Phase 1 proves Cell 1 over 5 shift days from
-- Thu 11/12 (wiki cell-conversion.md, "Phase 1 run plan"). What can't be worked
-- out later from scale_events / scale_marks / cell_quality is written here.
--
-- New tables only, IF NOT EXISTS: running this twice is harmless. Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0062-cell-day.sql
-- Until it is applied the cell screen's End of day panel says "not set up yet"
-- and the crons skip the episode log; nothing else changes.

-- End-of-day weighs on the cell's own scale (lib/cell-eod.js). Not scale_marks:
-- its kind CHECK only allows 'tare' and 'pickup', and these must never reach the
-- tops / pickup logic anyway.
--   window = the lead opened the End of day panel (ts) and left it (ended_at).
--            Scale readings inside a window are never tops (cell-auto.js), never
--            NOT RECORDING (untracked.js). A window never closed ends 30 min on.
--   raw    = leftover raw, net grams. Several per day are summed: the cell
--            scale tops out at 2 kg, so a big leftover is weighed in parts.
--   tote   = the fall-through tote's contents, net grams, summed the same way.
-- batt_mv: the scale node's battery when it was saved (scale_readings keeps only
-- the latest), so a past day's end-of-day battery can still be read.
CREATE TABLE IF NOT EXISTS cell_eod (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      TEXT NOT NULL,
  production_date TEXT NOT NULL,                -- YYYY-MM-DD, Pacific
  kind            TEXT NOT NULL CHECK (kind IN ('window', 'raw', 'tote')),
  grams           REAL CHECK (grams IS NULL OR grams >= 0),
  batt_mv         INTEGER,
  ts              TEXT NOT NULL DEFAULT (datetime('now')),   -- UTC, same form as scale_events.ts
  ended_at        TEXT,                         -- window only
  undone_at       TEXT                          -- raw/tote: Undo within 10 min
);
CREATE INDEX IF NOT EXISTS idx_cell_eod_station ON cell_eod (station_id, production_date);

-- Which sacks scanned out today went to this cell: the lead ticks them on the
-- End of day panel (no change to /salida). A sack goes to one cell per day.
CREATE TABLE IF NOT EXISTS cell_sacks (
  production_date TEXT NOT NULL,
  sack_id         TEXT NOT NULL,
  station_id      TEXT NOT NULL,
  ticked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (production_date, sack_id)
);
CREATE INDEX IF NOT EXISTS idx_cell_sacks_station ON cell_sacks (station_id, production_date);

-- History of the episodes the 5-minute crons see (lib/scale-watch.js). The live
-- state columns (scale_stations.down_since, untracked_since) are cleared on
-- recovery and only set once Telegram took the alert; this keeps every episode,
-- whether or not a message went out.
--   offline   = scale silent SILENT_MIN+ in shift (from_ts = its last post,
--               to_ts = the post it came back with)
--   untracked = NOT RECORDING: gaining weight with no job on a reporting tablet
--               (to_ts = when it recorded a job again)
CREATE TABLE IF NOT EXISTS scale_episodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('offline', 'untracked')),
  from_ts     TEXT NOT NULL,
  to_ts       TEXT,                             -- NULL = still going
  why         TEXT                              -- untracked: noScreen | tabletOff | noJob
);
CREATE INDEX IF NOT EXISTS idx_scale_episodes_station ON scale_episodes (station_id, from_ts);
