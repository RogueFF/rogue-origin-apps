-- Four quality checks per cell-hour instead of one pass/fail.
-- Koa 2026-11-09: "Trim Job, Cut Stems, Mold, and Insect check. each one can be
-- pressed to pass/fail". NULL = not checked yet.
-- The existing `quality` column stays as the overall result, kept up to date by
-- setCellHourly (workers/src/handlers/production/cell-hourly.js): 'fail' if any
-- check fails, 'pass' once all four pass, NULL otherwise. The page's grid, the
-- 5 kg tracker and anything else reading `quality` keep working unchanged.
--
-- Run ONCE: ALTER TABLE ADD COLUMN is not idempotent in SQLite.
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0051-cell-quality-checks.sql

ALTER TABLE cell_hourly ADD COLUMN q_trim TEXT CHECK (q_trim IN ('pass', 'fail'));
ALTER TABLE cell_hourly ADD COLUMN q_stems TEXT CHECK (q_stems IN ('pass', 'fail'));
ALTER TABLE cell_hourly ADD COLUMN q_mold TEXT CHECK (q_mold IN ('pass', 'fail'));
ALTER TABLE cell_hourly ADD COLUMN q_insects TEXT CHECK (q_insects IN ('pass', 'fail'));
