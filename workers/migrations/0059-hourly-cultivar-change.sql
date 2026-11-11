-- 0059: a cultivar change partway through an hour (Koa, 2026-11-10).
-- The cells switch cultivar mid-hour; the crew enters the switch time and the
-- second cultivar's tops. tops_lbs1 stays the hour's TOTAL, so every total
-- (dashboard, labor, rates, wholesale crew) reads exactly as before; only the
-- per-cultivar rollups split the hour (lib/cultivar-parts.js):
--   cultivar1        tops_lbs1 - change_tops_lbs
--   change_cultivar  change_tops_lbs
-- Crew hours and smalls (one number per hour) split by change_share: the part
-- of the slot's working minutes after change_at, worked out on write.
ALTER TABLE monthly_production ADD COLUMN change_at TEXT;          -- 'HH:MM', 24 h, Pacific
ALTER TABLE monthly_production ADD COLUMN change_cultivar TEXT;
ALTER TABLE monthly_production ADD COLUMN change_tops_lbs REAL;
ALTER TABLE monthly_production ADD COLUMN change_share REAL;       -- 0..1, after the change
