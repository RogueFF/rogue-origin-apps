-- Notes against a supersack.
--
-- Append-only, one row per note, rather than an editable field on the sack.
-- A note is an observation made at a moment ("wet spot at the bottom", "mold
-- flagged", "bag re-tied") and the moment matters as much as the text — an
-- overwritable field loses the history and invites someone to quietly replace
-- an inconvenient observation. Same reasoning as the harvest log's
-- honest-gaps-over-clean-numbers rule.
--
-- Sack-level. Lot-level observations belong in farm/harvest-log.md, which is
-- where the board rounds and the gaps already live.

CREATE TABLE IF NOT EXISTS harvest_sack_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sack_id TEXT NOT NULL,                       -- FK -> harvest_sacks.sack_id
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  is_test INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_harvest_sack_notes_sack
  ON harvest_sack_notes(sack_id, created_at);
