-- Quality checks per cell, by batch (Koa 2026-11-09): each cell starts the day
-- at batch 1; once its four checks are scored, the next check is batch 2, and so
-- on. Kept apart from cell_hourly on purpose: quality is not tied to the hour or
-- to weights, so the crew isn't watching pounds while they check.
--
-- Four checks, each scored 1 to 4: trim job, stems cut right, no mold, no
-- insects. "3-4 is passing quality, 1-2 is needing to be redone". Same scale and
-- wording as the paper quality sheet (scripts/throughput-test-pdf.py --test q).
-- NULL = not scored yet. `quality` is the batch's overall result, kept up to date
-- by setCellQuality (workers/src/handlers/production/cell-hourly.js): 'fail'
-- (redo) if any check is 1 or 2, 'pass' once all four are 3 or 4, NULL otherwise.
-- A redone batch is checked again as the next batch; the fail stays on record.
--
-- Safe to run twice. Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0051-cell-quality-checks.sql

CREATE TABLE IF NOT EXISTS cell_quality (
  production_date TEXT NOT NULL,
  station_id      TEXT NOT NULL,
  batch_no        INTEGER NOT NULL CHECK (batch_no BETWEEN 1 AND 500),
  cultivar        TEXT,
  q_trim          INTEGER CHECK (q_trim BETWEEN 1 AND 4),
  q_stems         INTEGER CHECK (q_stems BETWEEN 1 AND 4),
  q_mold          INTEGER CHECK (q_mold BETWEEN 1 AND 4),
  q_insects       INTEGER CHECK (q_insects BETWEEN 1 AND 4),
  quality         TEXT CHECK (quality IN ('pass', 'fail')),
  checked_by      TEXT,
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (production_date, station_id, batch_no)
);
