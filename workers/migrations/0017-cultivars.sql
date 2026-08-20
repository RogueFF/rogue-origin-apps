-- Canonical cultivar dimension + alias map, and the FKs that make order_items
-- and production_runs point at it.
-- Design: docs/plans/2026-08-19-order-blocks-design.md
--
-- WHY NOW:
-- 0014 left order_items.cultivar as free text because the only cultivar
-- catalogue was the `products` table, and the plan was to read it through
-- /api/barcode?action=products. Both were retired hours later (0016), so that
-- source no longer exists. Rather than resurrect a table that was deliberately
-- dropped, this promotes the part that was actually needed — the cultivar
-- names — into a proper dimension. The design doc already called this "the
-- right eventual answer"; losing products just moved it forward.
--
-- WHY AN ALIAS TABLE:
-- The same cultivar is spelled three different ways across this database:
--   monthly_production.cultivar1  '2025 - Sour Lifter / Sungrown'
--   harvest_sacks.cultivar        'Sour Lifter'
--   products.sku (now gone)       'SLIFT-FLWR-SUN-TOP-1-OZ-2025'
-- There was no dimension table and no shared normalizer, so the old workaround
-- was bidirectional substring matching (the retired orders/coa.js), which
-- silently counted "Sour Lifter" toward "Lifter". The lead-time engine reads
-- per-cultivar trim rates out of monthly_production and must join on something
-- exact, or it attaches the wrong rate to the wrong cultivar. That is the
-- single largest correctness risk in the whole feature.
--
-- SEED SOURCES:
--   42 canonical cultivars = 36 from the products backup
--     (~/Desktop/rogue-scrub-backup/dropped-tables-2026-08-19/ops-products.json)
--     unioned with 33 distinct names in monthly_production; 21 appear in both.
--   78 aliases: every literal production string, plus each canonical name.
--   'LOG' is dropped as junk.
--
-- SIX DELIBERATE MERGES, listed so they can be argued with:
--   Sugar Cookez (Cookies) -> Sugar Cookez
--   Lifter (Early Harvest) -> Lifter
--   Bubba Kush 18 / 59 (HT) / 66 / 66 (HT) -> Bubba Kush
-- The Bubba Kush merge is the valuable one: the catalogue sells "Bubba Kush",
-- production only ever recorded numbered phenos, so before this the sellable
-- cultivar had zero rate history and would have priced off the farm-average
-- fallback. Now it inherits all four.
--
-- crop_year is kept on the alias so the engine can prefer same-year history
-- (2025 Lifter trims differently from 2023 Lifter) and widen to all years only
-- when the current year is too thin to be meaningful.

CREATE TABLE IF NOT EXISTS cultivars (
  id          TEXT PRIMARY KEY,            -- slug, e.g. 'sour-lifter'
  name        TEXT NOT NULL UNIQUE,        -- display name, e.g. 'Sour Lifter'
  sku_prefix  TEXT,                        -- 'SLIFT', from the retired catalogue
  active      INTEGER NOT NULL DEFAULT 1,  -- 0 hides it from the order picker
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cultivar_aliases (
  alias       TEXT PRIMARY KEY,            -- the literal string as some table spells it
  cultivar_id TEXT NOT NULL,
  crop_year   INTEGER,                     -- parsed from the production string; NULL if absent
  source      TEXT NOT NULL CHECK (source IN ('production','products','harvest','manual')),
  FOREIGN KEY (cultivar_id) REFERENCES cultivars(id)
);

CREATE INDEX IF NOT EXISTS idx_cultivar_aliases_cultivar ON cultivar_aliases(cultivar_id);

-- ---- cultivars (42 canonical) ----
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('alium-og', 'Alium OG', 'AOG');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('apple-crisp', 'Apple Crisp', 'AC');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('berry-bliss', 'Berry Bliss', 'BB');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('blue-laguna', 'Blue Laguna', 'BL');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('blueve', 'Blueve', 'BLUEVE');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('bubba-kush', 'Bubba Kush', 'BK');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('cake-berry-brulee', 'Cake Berry Brulee', 'CBB');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('catnip', 'Catnip', 'CATNIP');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('critical-berries', 'Critical Berries', 'CB');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('dream-weaver', 'Dream Weaver', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('elektra', 'Elektra', 'ELEK');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('fruity-pebbles', 'Fruity Pebbles', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('godfather-og', 'Godfather OG', 'GOG');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('golden-berries', 'Golden Berries', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('hawaiian-haze', 'Hawaiian Haze', 'HH');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('legendary-kush', 'Legendary Kush', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('legendary-platinum-og', 'Legendary Platinum OG', 'LPOG');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('lemon-cookie-dough', 'Lemon Cookie Dough', 'LCD');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('lemon-octane', 'Lemon Octane', 'LO');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('lifter', 'Lifter', 'LIFT');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('orange-fritter', 'Orange Fritter', 'OF');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('paradise-og', 'Paradise OG', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('passion-fruit-og', 'Passion Fruit OG', 'PFOG');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('pineapple-express', 'Pineapple Express', 'PE');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('pineapple-sugar-cookies', 'Pineapple Sugar Cookies', 'PSC');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('purple-frosty', 'Purple Frosty', 'PF');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('raspberry-bear-claw', 'Raspberry Bear Claw', 'RBC');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('royal-fruit-snacks', 'Royal Fruit Snacks', NULL);
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('royal-og', 'Royal OG', 'ROG');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sapphire-kush', 'Sapphire Kush', 'SK');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('skunk-candez', 'Skunk Candez', 'SKUNKCAND');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sour-brulee', 'Sour Brulee', 'SBRUL');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sour-chem', 'Sour Chem', 'SCHEM');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sour-lifter', 'Sour Lifter', 'SLIFT');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sour-special-sauce', 'Sour Special Sauce', 'SSPEC');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sour-suver-haze', 'Sour Suver Haze', 'SSUV');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('strawberry-cookies', 'Strawberry Cookies', 'STRAW');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sugar-cookez', 'Sugar Cookez', 'SUGCOOK');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('sugar-shaker', 'Sugar Shaker', 'SUGSHAKE');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('super-sour-space-candy', 'Super Sour Space Candy', 'SSSC');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('trump-blues', 'Trump Blues', 'TB');
INSERT OR IGNORE INTO cultivars (id, name, sku_prefix) VALUES ('white-cbg', 'White CBG', 'CBG');

-- ---- cultivar_aliases (78) ----
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2023 - Legendary Kush / Sungrown', 'legendary-kush', 2023, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2023 - Lifter / Sungrown', 'lifter', 2023, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Bubba Kush 18 / Sungrown', 'bubba-kush', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Bubba Kush 59 (HT) / Sungrown', 'bubba-kush', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Bubba Kush 66 (HT) / Sungrown', 'bubba-kush', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Bubba Kush 66 / Sungrown', 'bubba-kush', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Dream Weaver / Sungrown', 'dream-weaver', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Fruity Pebbles / Sungrown', 'fruity-pebbles', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Godfather OG / Sungrown', 'godfather-og', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Golden Berries / Sungrown', 'golden-berries', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Lifter / Sungrown', 'lifter', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Paradise OG / Sungrown', 'paradise-og', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2024 - Royal Fruit Snacks / Sungrown', 'royal-fruit-snacks', 2024, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Berry Bliss / Sungrown', 'berry-bliss', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Blue Laguna / Sungrown', 'blue-laguna', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Cake Berry Brulee / Sungrown', 'cake-berry-brulee', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Catnip / Sungrown', 'catnip', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Critical Berries / Sungrown', 'critical-berries', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Elektra / Sungrown', 'elektra', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Godfather OG / Sungrown', 'godfather-og', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Hawaiian Haze / Sungrown', 'hawaiian-haze', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Legendary Platinum OG / Sungrown', 'legendary-platinum-og', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Lemon Cookie Dough / Sungrown', 'lemon-cookie-dough', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Lifter (Early Harvest) / Sungrown', 'lifter', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Lifter / Sungrown', 'lifter', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Passion Fruit OG / Sungrown', 'passion-fruit-og', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Purple Frosty / Sungrown', 'purple-frosty', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Royal OG / Sungrown', 'royal-og', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sapphire Kush / Sungrown', 'sapphire-kush', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Skunk Candez / Sungrown', 'skunk-candez', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sour Chem / Sungrown', 'sour-chem', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sour Lifter / Sungrown', 'sour-lifter', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sour Suver Haze / Sungrown', 'sour-suver-haze', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Strawberry Cookies / Sungrown', 'strawberry-cookies', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sugar Cookez (Cookies) / Sungrown', 'sugar-cookez', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('2025 - Sugar Shaker / Sungrown', 'sugar-shaker', 2025, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Alium OG', 'alium-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Apple Crisp', 'apple-crisp', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Berry Bliss', 'berry-bliss', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Blue Laguna', 'blue-laguna', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Blueve', 'blueve', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Bubba Kush', 'bubba-kush', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Cake Berry Brulee', 'cake-berry-brulee', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Catnip', 'catnip', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Critical Berries', 'critical-berries', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Dream Weaver', 'dream-weaver', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Elektra', 'elektra', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Fruity Pebbles', 'fruity-pebbles', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Godfather OG', 'godfather-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Golden Berries', 'golden-berries', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Hawaiian Haze', 'hawaiian-haze', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Legendary Kush', 'legendary-kush', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Legendary Platinum OG', 'legendary-platinum-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Lemon Cookie Dough', 'lemon-cookie-dough', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Lemon Octane', 'lemon-octane', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Lifter', 'lifter', NULL, 'production');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Orange Fritter', 'orange-fritter', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Paradise OG', 'paradise-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Passion Fruit OG', 'passion-fruit-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Pineapple Express', 'pineapple-express', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Pineapple Sugar Cookies', 'pineapple-sugar-cookies', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Purple Frosty', 'purple-frosty', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Raspberry Bear Claw', 'raspberry-bear-claw', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Royal Fruit Snacks', 'royal-fruit-snacks', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Royal OG', 'royal-og', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sapphire Kush', 'sapphire-kush', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Skunk Candez', 'skunk-candez', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sour Brulee', 'sour-brulee', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sour Chem', 'sour-chem', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sour Lifter', 'sour-lifter', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sour Special Sauce', 'sour-special-sauce', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sour Suver Haze', 'sour-suver-haze', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Strawberry Cookies', 'strawberry-cookies', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sugar Cookez', 'sugar-cookez', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Sugar Shaker', 'sugar-shaker', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Super Sour Space Candy', 'super-sour-space-candy', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('Trump Blues', 'trump-blues', NULL, 'products');
INSERT OR IGNORE INTO cultivar_aliases (alias, cultivar_id, crop_year, source) VALUES ('White CBG', 'white-cbg', NULL, 'products');

-- ---- repoint order_items and production_runs at the dimension ----
--
-- Both tables were created empty by 0014 minutes ago and still hold zero rows,
-- so this is a recreate, not a data migration. SQLite cannot add a foreign key
-- with ALTER TABLE, and a free-text cultivar column on an order line is exactly
-- the defect this migration exists to remove: it lets someone sell a cultivar
-- that no rate, no alias and no catalogue entry knows about.
--
-- Everything else about the two tables is unchanged from 0014 — same columns,
-- same CHECKs, same partial unique indexes, same reasoning. Only `cultivar TEXT`
-- becomes `cultivar_id TEXT NOT NULL REFERENCES cultivars(id)`.

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS production_runs;

CREATE TABLE order_items (
  id               TEXT PRIMARY KEY,           -- 'OI-<13-digit ms>'
  order_id         TEXT NOT NULL,
  cultivar_id      TEXT NOT NULL,
  form             TEXT NOT NULL CHECK (form IN ('tops','smalls')),
  qty_lbs          REAL NOT NULL,              -- canonical; everything reads this
  entered_qty      REAL,                       -- what the human typed
  entered_unit     TEXT CHECK (entered_unit IN ('lb','kg')),
  unit_price       REAL DEFAULT 0,             -- per entered_unit, not per lb
  sku              TEXT,
  external_line_id TEXT,                       -- reserved for Shopify sync
  sort_order       INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id)    REFERENCES orders(id),
  FOREIGN KEY (cultivar_id) REFERENCES cultivars(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_cultivar ON order_items(cultivar_id, form);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_external
  ON order_items(external_line_id) WHERE external_line_id IS NOT NULL;

CREATE TABLE production_runs (
  id                 TEXT PRIMARY KEY,         -- 'PR-<13-digit ms>'
  cultivar_id        TEXT NOT NULL,            -- no form: a run yields both
  rank               TEXT NOT NULL,            -- fractional index, not INTEGER
  dedicated_order_id TEXT,                     -- NULL = pooled
  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','done')),
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (dedicated_order_id) REFERENCES orders(id),
  FOREIGN KEY (cultivar_id)        REFERENCES cultivars(id)
);

CREATE INDEX IF NOT EXISTS idx_production_runs_rank     ON production_runs(rank);
CREATE INDEX IF NOT EXISTS idx_production_runs_cultivar ON production_runs(cultivar_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_runs_pooled
  ON production_runs(cultivar_id) WHERE dedicated_order_id IS NULL;
