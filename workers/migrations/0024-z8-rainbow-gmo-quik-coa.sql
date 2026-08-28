-- Z8 Rainbow GMO Quik: first field pre-harvest result of 2026.
-- Source: raw/coas/2026/Z8-Rainbow-GMO-Quik-PreHarvest-2026.pdf
-- Stage/date/THC/doc were entered through the board itself; this only
-- fills the note with the sample and lab IDs, and only if still empty.
UPDATE harvest_lots SET notes = 'Sampled 2026-08-11, reported 2026-08-14 by Pinnacle Analytics.
Sample Field-2026-001 / lab ID C-H-390-G4121. Total CBD 1.87%.
First field result of the season.' WHERE lot_id = 'rogue-z8-rainbow-gmo-quik' AND (notes IS NULL OR notes = '');
