-- Changeovers in Continuous mode (Koa 2026-11-11: "If he has a whole supersack,
-- how will we track the changeover?"). Between rounds the cell can change
-- cultivar: the leftover raw of the old cultivar is weighed first, on the cell
-- scale (in parts, like End of day) or typed from the bench scale for a big
-- partial supersack. Those weighs are cell_eod 'raw' rows tagged with the
-- cultivar they were, and a changeover opens a cell_eod 'window' like End of day
-- does, so its scale readings are never tops, pickups or NOT RECORDING.
-- End of day leftover-raw saves take a cultivar too, so tops/sack can be worked
-- out per cultivar.
--
--   cultivar: the cultivar the leftover raw is (window: the cultivar changed FROM)
--   reason:   'eod' | 'changeover'   (NULL = End of day, rows saved before this)
--   source:   'scale' | 'bench'      (NULL = scale)
--
-- Plain ALTERs: run once (a second run fails on the duplicate column, harmlessly).
ALTER TABLE cell_eod ADD COLUMN cultivar TEXT;
ALTER TABLE cell_eod ADD COLUMN reason TEXT;
ALTER TABLE cell_eod ADD COLUMN source TEXT;
