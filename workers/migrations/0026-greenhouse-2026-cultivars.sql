-- Two 2026 greenhouse cultivars that exist in Shopify's supersack inventory but
-- never made it into the cultivars dimension (0017 seeded from the 2025
-- catalogue and production sheets, which predate them). Until now their sacks
-- sat in getCoverage's skippedSkus with no cultivar to land on.
--
-- Prefixes follow the sack SKUs Shopify already uses (GT-GH-SUPRSAK-2026,
-- LBM-GH-SUPRSAK-2026); neither collides with an existing sku_prefix. The
-- aliases are the sack variant titles, which is the spelling the production
-- sheet will adopt when trimming starts — add the production string then if it
-- differs. Source is 'manual' because no production, products or harvest row
-- carries these names yet.
--
-- Applied by hand (no migrations_dir in wrangler.toml), one statement at a time:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --command "<stmt>"

INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('gravy-train', 'Gravy Train', 'GT');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('legendary-banana-mac', 'Legendary Banana Mac', 'LBM');

INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Gravy Train / Greenhouse', 'gravy-train', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Gravy Train', 'gravy-train', NULL, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2026 - Legendary Banana Mac / Greenhouse', 'legendary-banana-mac', 2026, 'manual');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Legendary Banana Mac', 'legendary-banana-mac', NULL, 'manual');
