-- Fill the four harvested GH1 lots from their pre-harvest COAs.
-- Source: raw/coas/2026/*.pdf (Pinnacle Analytics, ORELAP #4152).
-- test_date = Date Sampled; the reported date is kept in the note.

UPDATE harvest_lots SET test_date = '2026-08-05', thc = 0.137, notes = 'PASSED pre-harvest at 0.137% Total THC (limit 0.3%).
Sampled 2026-08-05, reported 2026-08-07 by Pinnacle Analytics.
Sample GH1-2026-005 / lab ID C-H-390-G4110. Total CBD 4.87%.
Harvested 2026-08-12 with the rest of the house.', docs = '[{"label": "Pre-harvest COA (GH1-2026-005)", "ref": "raw/coas/2026/GH1A-Legendary-Banana-Mac-PreHarvest-2026.pdf"}]', updated_at = '2026-08-07T00:00:00.000Z', updated_by = 'coa-import' WHERE lot_id = 'rogue-gh1a-legendary-banana-mac';
UPDATE harvest_lots SET test_date = '2026-08-05', thc = 0.185, notes = 'PASSED pre-harvest at 0.185% Total THC (limit 0.3%).
Sampled 2026-08-05, reported 2026-08-07 by Pinnacle Analytics.
Sample GH1-2026-004 / lab ID C-H-390-G4109. Total CBD 6.25%.
Harvested 2026-08-12 with the rest of the house.', docs = '[{"label": "Pre-harvest COA (GH1-2026-004)", "ref": "raw/coas/2026/GH1B-Strawberry-Doughnuts-PreHarvest-2026.pdf"}]', updated_at = '2026-08-07T00:00:00.000Z', updated_by = 'coa-import' WHERE lot_id = 'rogue-gh1b-strawberry-doughnuts';
UPDATE harvest_lots SET test_date = '2026-08-05', thc = 0.201, notes = 'PASSED pre-harvest at 0.201% Total THC (limit 0.3%).
Sampled 2026-08-05, reported 2026-08-07 by Pinnacle Analytics.
Sample GH1-2026-002 / lab ID C-H-390-G4107. Total CBD 7.27%.
Harvested 2026-08-12 with the rest of the house.', docs = '[{"label": "Pre-harvest COA (GH1-2026-002)", "ref": "raw/coas/2026/GH1D-Gravy-Train-PreHarvest-2026.pdf"}]', updated_at = '2026-08-07T00:00:00.000Z', updated_by = 'coa-import' WHERE lot_id = 'rogue-gh1d-gravy-train';
UPDATE harvest_lots SET test_date = '2026-08-05', thc = 0.0, notes = 'PASSED pre-harvest at 0.0% Total THC (limit 0.3%).
Sampled 2026-08-05, reported 2026-08-07 by Pinnacle Analytics.
Sample GH1-2026-001 / lab ID C-H-390-G4106. Total CBD 4.13%.
Harvested 2026-08-12 with the rest of the house.', docs = '[{"label": "Pre-harvest COA (GH1-2026-001)", "ref": "raw/coas/2026/GH1E-Purple-Snowman-PreHarvest-2026.pdf"}]', updated_at = '2026-08-07T00:00:00.000Z', updated_by = 'coa-import' WHERE lot_id = 'rogue-gh1e-purple-snowman';
