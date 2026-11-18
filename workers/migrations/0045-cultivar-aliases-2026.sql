-- 0045: every 2026 floor spelling gets a cultivar alias (Koa, 2026-10-06).
--
-- The hourly-entry dropdown now offers every 2026 cultivar on the Super Sack
-- product, spelled "2026 - <Cultivar> / <Harvest Type>". The wholesale
-- burn-down joins monthly_production to this table on an EXACT match, and only
-- 9 of those 55 spellings had a row, so production logged under any other 2026
-- strain counted toward no order. Each row below maps a spelling to the
-- cultivar whose name it carries exactly. The four that differ (Rainbow GMO,
-- Orange/Blue Pineapple -> *-quik, Payton's -> peytons-strawberries) were
-- already in from 0039 / the products import and are not repeated here.
-- INSERT OR IGNORE: safe to re-run.

INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Angel Cake / Sungrown', 'angel-cake', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Animal Muffins / Sungrown', 'animal-muffins', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Cream Cake / Sungrown', 'cream-cake', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Critical Berries / Sungrown', 'critical-berries', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Daiquiri Factory / Sungrown', 'daiquiri-factory', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Demi Glaze / Sungrown', 'demi-glaze', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Forbidden / Sungrown', 'forbidden', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - GMO Belly / Sungrown', 'gmo-belly', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - GMO Gas / Sungrown', 'gmo-gas', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Goat Butter / Sungrown', 'goat-butter', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Gravy Train / Sungrown', 'gravy-train', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Key Lime CBG / Sungrown', 'key-lime-cbg', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - King Kush / Sungrown', 'king-kush', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Kush Mintz / Sungrown', 'kush-mintz', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Lavender BC / Sungrown', 'lavender-bc', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Lavender Snowcone / Sungrown', 'lavender-snowcone', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Legendary Banana Mac / Sungrown', 'legendary-banana-mac', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Legendary OG / Sungrown', 'legendary-og', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Lemon / Sungrown', 'lemon', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Limey Lifter / Sungrown', 'limey-lifter', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Mandarin Chocolate / Sungrown', 'mandarin-chocolate', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Mountain Apple / Sungrown', 'mountain-apple', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Orange Fritter / Sungrown', 'orange-fritter', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Platinum / Sungrown', 'platinum', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Platinum Delicata / Sungrown', 'platinum-delicata', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Platinum India / Sungrown', 'platinum-india', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Platinum M A4 / Sungrown', 'platinum-m-a4', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Puff Pastries / Sungrown', 'puff-pastries', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Purple Snowman / Greenhouse', 'purple-snow', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Purple Snowman / Sungrown', 'purple-snow', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Rainbow Cake / Sungrown', 'rainbow-cake', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Rocket Sauce / Sungrown', 'rocket-sauce', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Runtz / Sungrown', 'runtz', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Runtz Bravo / Sungrown', 'runtz-bravo', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Sauciere / Sungrown', 'sauciere', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Smelly Jelly / Sungrown', 'smelly-jelly', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Snickerdoodle / Sungrown', 'snickerdoodle', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Sour Diesel / Sungrown', 'sour-diesel', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Sour Suver Haze / Sungrown', 'sour-suver-haze', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Spruce Dough / Sungrown', 'spruce-dough', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Strawberry Cream / Sungrown', 'strawberry-cream', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Strawberry Doughnuts / Sungrown', 'strawberry-doughnuts', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Strawberry Fritter / Sungrown', 'strawberry-fritter', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Strawberry Sauce / Sungrown', 'strawberry-sauce', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Tahitian / Sungrown', 'tahitian', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Tropicana Cherry / Sungrown', 'tropicana-cherry', 2026, 'manual');
