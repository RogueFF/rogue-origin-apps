-- 0064 harvest_cultivars — the lot board's after-harvest track.
--
-- Everything is harvested, so the board stops following lots through
-- test -> cut -> dry -> sack and starts following CULTIVARS through
-- photos -> website. Photos, the listing and the post-harvest potency COA are
-- per cultivar, not per zone planting, so they get their own row here instead
-- of being copied onto every lot of the cultivar.
--
-- harvest_lots is untouched: it keeps each lot's pre-harvest (ODA) test and
-- COA links, and its old stage as the record of how the season ended.

CREATE TABLE IF NOT EXISTS harvest_cultivars (
  cultivar_slug TEXT PRIMARY KEY,
  cultivar      TEXT NOT NULL,
  -- not_sent | sent | photos_done | on_website
  stage         TEXT NOT NULL DEFAULT 'not_sent',
  post_sent     TEXT,            -- sample dropped at the lab for the post-harvest COA
  post_date     TEXT,            -- post-harvest COA report date
  post_thc      REAL,            -- dried-flower Total THC %
  post_cbd      REAL,            -- dried-flower Total CBD %
  url           TEXT,            -- the product page, once it is listed
  notes         TEXT,
  docs          TEXT NOT NULL DEFAULT '[]',   -- JSON array of {label, ref}: post-harvest COAs
  updated_at    TEXT,
  updated_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_harvest_cultivars_stage ON harvest_cultivars(stage);

-- One row per cultivar on the board. INSERT OR IGNORE so a re-run never
-- clobbers a card that has already moved.
INSERT OR IGNORE INTO harvest_cultivars (cultivar_slug, cultivar, updated_by)
  SELECT cultivar_slug, MIN(cultivar), 'migration'
    FROM harvest_lots
   GROUP BY cultivar_slug;
