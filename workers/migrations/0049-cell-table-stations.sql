-- Cell table scales: registered stations with a device token, a stable flag,
-- and a log of settled weights.
-- Koa 2026-11-05: "All parts have arrived for our test scale, now we just need
-- software with it." Design: wiki operations/plans/2026-11-02-cell-software-design.md §3.
--
-- Read by setScaleWeight / getScaleWeight (workers/src/handlers/production/scale.js):
--   * a station registered here with kind = 'table' must send
--     Authorization: Bearer <token>; only the SHA-256 hex of the token is stored.
--     Register one with: node workers/scripts/scale-station-sql.mjs (prints the INSERT).
--   * an unregistered station (line1, the QC bag scale) keeps the old behaviour:
--     no token, 3 s stale.
--   * scale_events gets one row per settled weight that moved 0.2 g or more.
--
-- Run ONCE. The ALTER TABLE is not idempotent in SQLite (a second run fails on
-- the duplicate column; the CREATEs are safe to repeat).
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0049-cell-table-stations.sql

ALTER TABLE scale_readings ADD COLUMN stable INTEGER;

CREATE TABLE IF NOT EXISTS scale_stations (
  station_id    TEXT PRIMARY KEY,
  label         TEXT,
  kind          TEXT NOT NULL DEFAULT 'table',   -- 'table' needs a token; 'qc' is the bag-station scale
  token_hash    TEXT,                            -- SHA-256 hex of the device token
  stale_after_s INTEGER NOT NULL DEFAULT 45,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scale_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  ts         TEXT NOT NULL DEFAULT (datetime('now')),
  weight_kg  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scale_events_station ON scale_events (station_id, id);
