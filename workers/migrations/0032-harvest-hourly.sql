-- Harvest hourly crew log — one row per barn per hour, reported by the barn
-- foreman over SMS. Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
--
-- The row IS the state machine: it is inserted when the prompt goes out
-- (pending), moves to nudged after one reminder, and ends complete or missing.
-- Every cron tick decides what to do from status + timestamps, so a late or
-- doubled tick never sends twice.
--
-- barn is stored directly. harvest_scan_log derives barn from bay to keep two
-- columns from disagreeing; there is no bay here, so the rule is not broken.

CREATE TABLE IF NOT EXISTS harvest_hourly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  harvest_date TEXT NOT NULL,                  -- Pacific civil date YYYY-MM-DD
  hour_start TEXT NOT NULL,                    -- 'HH:00' Pacific, the hour being reported
  barn TEXT NOT NULL CHECK (barn IN ('upper', 'bottom')),
  cutters INTEGER,
  cutter_water_spiders INTEGER,                -- field side
  drivers INTEGER,
  hangers INTEGER,
  hanging_water_spiders INTEGER,               -- barn side
  racks INTEGER,
  notes TEXT,
  raw_reply TEXT,                              -- latest inbound text, verbatim
  reported_by TEXT,                            -- E.164 phone
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'nudged', 'complete', 'missing')),
  asked_at TEXT,
  nudged_at TEXT,
  answered_at TEXT,
  is_test INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (harvest_date, hour_start, barn, is_test)
);

CREATE INDEX IF NOT EXISTS idx_harvest_hourly_day
  ON harvest_hourly(harvest_date, barn, is_test);

-- Who gets texted. EMPEZAR sets active=1, PARAR (or the auto-stop) clears it.
CREATE TABLE IF NOT EXISTS harvest_foremen (
  phone TEXT PRIMARY KEY,                      -- E.164, e.g. +15415551234
  name TEXT NOT NULL,
  barn TEXT NOT NULL CHECK (barn IN ('upper', 'bottom')),
  active INTEGER NOT NULL DEFAULT 0,
  active_since TEXT,
  lang TEXT NOT NULL DEFAULT 'es',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Twilio retries deliveries; the MessageSid makes a redelivery a no-op.
CREATE TABLE IF NOT EXISTS harvest_sms_inbox (
  message_sid TEXT PRIMARY KEY,
  from_phone TEXT NOT NULL,
  body TEXT,
  received_at TEXT DEFAULT (datetime('now'))
);
