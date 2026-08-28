-- 0025 Total CBD alongside Total THC.
-- The COAs report both; the board only kept THC, which is the compliance
-- number but not the one that says what the lot is worth.

ALTER TABLE harvest_lots ADD COLUMN cbd REAL;

-- Backfill from the COAs already on file (raw/coas/2026/).
UPDATE harvest_lots SET cbd = 4.87 WHERE lot_id = 'rogue-gh1a-legendary-banana-mac';
UPDATE harvest_lots SET cbd = 6.25 WHERE lot_id = 'rogue-gh1b-strawberry-doughnuts';
UPDATE harvest_lots SET cbd = 7.27 WHERE lot_id = 'rogue-gh1d-gravy-train';
UPDATE harvest_lots SET cbd = 4.13 WHERE lot_id = 'rogue-gh1e-purple-snowman';
UPDATE harvest_lots SET cbd = 1.87 WHERE lot_id = 'rogue-z8-rainbow-gmo-quik';
