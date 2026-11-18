-- Cell log -> Hourly entry fill (Koa 2026-11-18, via the hub: "yes, have it fill
-- hourly entry automatically ... would like to implement digitally once built
-- out and tested"). The barn TV line board and End of day read only
-- monthly_production, so a cell day needed double entry.
--
-- fill_source on monthly_production: NULL = typed by hand on Hourly entry (as
-- every row before this); 'cells' = filled from the cell log. A hand row is never
-- overwritten by the fill, and a hand save on a filled row makes it a hand row.
--
-- cell_fill_days: the switch, per day, OFF unless a row says enabled = 1. Turned
-- on and off from the Cell hourly log page (farm password).

ALTER TABLE monthly_production ADD COLUMN fill_source TEXT;

CREATE TABLE IF NOT EXISTS cell_fill_days (
  production_date TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
