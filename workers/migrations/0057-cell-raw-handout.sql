-- Raw hand-out and weigh-back per cell (Koa 2026-11-10: "Build the screen entry
-- now"; design doc §2d, SOP-028). The water spider weighs raw on the bench scale
-- and types the grams on rawout.html.
--
-- A lot is one order's raw at one cell: opened by the first hand-out, topped up
-- by more hand-outs of the same cultivar, closed by the weigh-back (0 g when
-- nothing is left). Yield is never stored: it is worked out when read, from the
-- cell's scale pickups inside the lot (scale cells) or the hourly log (others).
-- New tables only, IF NOT EXISTS: running this twice is harmless.
CREATE TABLE IF NOT EXISTS cell_raw_lots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      TEXT NOT NULL,
  production_date TEXT NOT NULL,                -- YYYY-MM-DD, Pacific, the day it opened
  cultivar        TEXT NOT NULL,
  bag             TEXT,                         -- qOz..lb1, the cell screen's keys
  bags            INTEGER NOT NULL DEFAULT 1,
  opened_at       TEXT NOT NULL DEFAULT (datetime('now')),   -- UTC, same form as scale_marks.ts
  closed_at       TEXT                          -- NULL = raw still at the cell
);
CREATE INDEX IF NOT EXISTS idx_cell_raw_lots_station ON cell_raw_lots (station_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_cell_raw_lots_date ON cell_raw_lots (production_date);

CREATE TABLE IF NOT EXISTS cell_raw (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id       INTEGER NOT NULL REFERENCES cell_raw_lots (id),
  kind         TEXT NOT NULL CHECK (kind IN ('out', 'back')),
  grams        REAL NOT NULL CHECK (grams >= 0),
  suggested_g  REAL,                            -- what the chart said to bring (hand-outs)
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cell_raw_lot ON cell_raw (lot_id);
