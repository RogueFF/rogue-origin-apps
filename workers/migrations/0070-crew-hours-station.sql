-- People inside the cell hourly log (Koa 2026-11-18, via the hub: "I like the
-- previous layout... make entries repeatable, and easy").
--
-- station_id: the cell_roster station a typed hour was worked at (cell keeps the
--             cell's number for display; sheet rows have no station).
-- seq:        order on the cell within the hour: 1 = started the hour there,
--             2 = took over (a cover). The next hour carries over the last one.
--
-- cell_hourly.tops_lbs is no longer typed: the Worker derives it as the sum of
-- the typed people-hours at that station and slot, so there is one number.

ALTER TABLE crew_hours ADD COLUMN station_id TEXT;
ALTER TABLE crew_hours ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_crew_hours_station ON crew_hours (work_date, station_id, slot);
