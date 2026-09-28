-- Make every 2026 harvest lot able to print a tag that lands on a Super Sack
-- Inventory variant. Audited 2026-09-28 against the live variant list and
-- Koa's 2026-09-16 variant export.
--
-- 1. McLOUGHLIN CULTIVARS HAD NO ROW. 19 cultivars on McLoughlin harvest lots
--    (most already `cleared`) were missing from `cultivars`, so cultivarCode()
--    would refuse at PRINT TAG and no tag could print at all. Registered here
--    with the prefix their Shopify sack SKU already uses (ACA-SG-C1-SUPRSAK-2026
--    -> ACA), the same rule 0026 followed. None collides with an existing
--    sku_prefix. active=0: grown for harvest, not in the wholesale order picker.
--    The variant titles match these names exactly, so no alias is needed.
--
-- 2. THREE LOT NAMES DIFFER FROM THE VARIANT TITLE. Recorded without a cut, so
--    one row serves both 1st and 2nd Cut (see aliasedTitles()).
--      Orange Pineapple Quik -> "2026 - Orange Pineapple / Sungrown"  (OPQ SKU)
--      Blue Pineapple Quik   -> "2026 - Blue Pineapple / Sungrown"    (BPQ SKU)
--      Peyton's Strawberries -> "2026 - Payton's Strawberries / Sungrown" (PST)
--    The Q in OPQ/BPQ is the Quik line, so these are not a prefix guess of the
--    Platinum / Platinum M A4 kind. 11 Orange Pineapple Quik sacks had already
--    failed to count before this alias existed; inventory_sweep pays them.
--
-- Data only, no worker deploy. Applied by hand, one statement at a time:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file migrations/0039-supersack-tag-shopify-links-2026.sql

INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('angel-cake', 'Angel Cake', 'ACA', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('cream-cake', 'Cream Cake', 'CC', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('daiquiri-factory', 'Daiquiri Factory', 'DF', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('forbidden', 'Forbidden', 'FOR', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('gmo-gas', 'GMO Gas', 'GG', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('goat-butter', 'Goat Butter', 'GBU', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('king-kush', 'King Kush', 'KK', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('kush-mintz', 'Kush Mintz', 'KM', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('lavender-bc', 'Lavender BC', 'LB', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('lavender-snowcone', 'Lavender Snowcone', 'LS', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('legendary-og', 'Legendary OG', 'LOG', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('peytons-strawberries', 'Peyton''s Strawberries', 'PST', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('platinum-delicata', 'Platinum Delicata', 'PD', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('platinum-india', 'Platinum India', 'PI', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('runtz', 'Runtz', 'RUN', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('runtz-bravo', 'Runtz Bravo', 'RB', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('smelly-jelly', 'Smelly Jelly', 'SJ', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('sour-diesel', 'Sour Diesel', 'SDI', 0);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix, active) VALUES ('tropicana-cherry', 'Tropicana Cherry', 'TC', 0);

INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Orange Pineapple / Sungrown', 'orange-pineapple-quik', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Blue Pineapple / Sungrown', 'blue-pineapple-quik', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Payton''s Strawberries / Sungrown', 'peytons-strawberries', 2026, 'manual');
