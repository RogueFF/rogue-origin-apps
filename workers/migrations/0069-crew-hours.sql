-- Person-first hourly entry (Koa 2026-11-17, via the hub: "Yes, build it").
-- One row per person per hour, kept apart by where it came from:
--   src = 'sheet'  rows from the RO-TST-003 paper sheets (crewLoadDay)
--   src = 'typed'  rows a lead types on crew-hourly.html during the day
-- For a person and hour, a typed row wins over a sheet row. crew_days stays the
-- per-person day that Mis números and the crew board read; it is rebuilt from
-- these rows after every save or sheet load, so there is one source of truth.
--
-- Slots use the sheet's keys with a plain hyphen: 7-8, 8-9, 9-10, 10-11, 11-12,
-- 12-1, 1-2, 2-3, 3-4, 4-4:30.

CREATE TABLE IF NOT EXISTS crew_hours (
  work_date TEXT NOT NULL,
  person_id INTEGER NOT NULL REFERENCES crew_people(id),
  slot TEXT NOT NULL,
  src TEXT NOT NULL CHECK (src IN ('sheet', 'typed')),
  cell TEXT,
  g REAL NOT NULL DEFAULT 0,
  min INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (work_date, person_id, slot, src)
);

CREATE INDEX IF NOT EXISTS idx_crew_hours_day ON crew_hours (work_date);

-- The sheet's own full/part-day call, kept so a day with no typed hours still
-- ranks exactly as the sheet said. NULL = no sheet row for that person and day.
ALTER TABLE crew_days ADD COLUMN sheet_full_day INTEGER;
UPDATE crew_days SET sheet_full_day = full_day;

-- Backfill: every hour already loaded from the sheets becomes a sheet row.
-- Slot keys are normalized (en dash to hyphen, a trailing note such as " SL" dropped).
INSERT OR IGNORE INTO crew_hours (work_date, person_id, slot, src, cell, g, min)
SELECT d.work_date, d.person_id,
       TRIM(CASE WHEN INSTR(REPLACE(json_extract(j.value, '$.slot'), '–', '-'), ' ') > 0
                 THEN SUBSTR(REPLACE(json_extract(j.value, '$.slot'), '–', '-'), 1, INSTR(REPLACE(json_extract(j.value, '$.slot'), '–', '-'), ' ') - 1)
                 ELSE REPLACE(json_extract(j.value, '$.slot'), '–', '-') END),
       'sheet', d.cell,
       COALESCE(json_extract(j.value, '$.g'), 0),
       COALESCE(json_extract(j.value, '$.min'), 0)
  FROM crew_days d, json_each(d.hours_json) j
 WHERE COALESCE(json_extract(j.value, '$.min'), 0) > 0 OR COALESCE(json_extract(j.value, '$.g'), 0) > 0;
