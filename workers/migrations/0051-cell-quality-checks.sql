-- Four quality checks per cell-hour, each scored 1 to 4, plus who checked.
-- Koa 2026-11-09: trim job, stems cut right, no mold, no insects; "3-4 is
-- passing quality, 1-2 is needing to be redone". Same scale and wording as the
-- paper quality sheet (scripts/throughput-test-pdf.py --test q). NULL = not scored.
-- The existing `quality` column stays as the hour's overall result, kept up to
-- date by setCellHourly (workers/src/handlers/production/cell-hourly.js):
-- 'fail' (redo) if any check is 1 or 2, 'pass' once all four are 3 or 4, NULL
-- otherwise. The grid, the 5 kg tracker and older callers keep reading it.
--
-- Run ONCE: ALTER TABLE ADD COLUMN is not idempotent in SQLite.
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0051-cell-quality-checks.sql

ALTER TABLE cell_hourly ADD COLUMN q_trim INTEGER CHECK (q_trim BETWEEN 1 AND 4);
ALTER TABLE cell_hourly ADD COLUMN q_stems INTEGER CHECK (q_stems BETWEEN 1 AND 4);
ALTER TABLE cell_hourly ADD COLUMN q_mold INTEGER CHECK (q_mold BETWEEN 1 AND 4);
ALTER TABLE cell_hourly ADD COLUMN q_insects INTEGER CHECK (q_insects BETWEEN 1 AND 4);
ALTER TABLE cell_hourly ADD COLUMN checked_by TEXT;
