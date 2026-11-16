-- Each trimmer sees their own numbers (Koa 2026-11-16: "a quick app where they
-- can each view their own numbers"). Opened by a personal QR card, so the token
-- is the only key a crew member ever holds; it unlocks that one person's rows.
--
-- Rows are loaded from the RO-TST-003 per-cell hourly sheets once a day
-- (password-locked load). Rank is computed at read time among that day's
-- full-day rows, so a later correction re-ranks everyone.

CREATE TABLE IF NOT EXISTS crew_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crew_days (
  work_date TEXT NOT NULL,
  person_id INTEGER NOT NULL REFERENCES crew_people(id),
  cell TEXT,
  cultivar TEXT,
  hours_json TEXT NOT NULL,
  tops_g REAL NOT NULL,
  work_min INTEGER NOT NULL,
  full_day INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  PRIMARY KEY (work_date, person_id)
);

CREATE INDEX IF NOT EXISTS idx_crew_days_person ON crew_days (person_id, work_date);

CREATE TABLE IF NOT EXISTS crew_day_meta (
  work_date TEXT PRIMARY KEY,
  target_lb_hr REAL,
  room_lb_hr REAL,
  note TEXT
);
